"""OpenAI Realtime — THE provider module (model id, session config, lifecycle, events).

Emits the typed voice.py events, so the engines / console / panel consume one
interface. Implemented directly on aiohttp's WebSocket client (already a
dependency) against the documented JSON protocol — more stable than betting on
the openai SDK's evolving Python surface.

GPT-Live-1 readiness: when its API opens, the migration is a model string plus
new event handlers HERE — nothing upstream changes (see docs/realtime-config.md).

Re-verified 2026-07 against developers.openai.com (GA surface; beta removed
2026-05-12; gpt-realtime-2.1 / -2.1-mini released 2026-07-06):
- wss://api.openai.com/v1/realtime?model=...  (Authorization: Bearer; NO OpenAI-Beta header)
- session.update has session.type "realtime", audio nested under audio.input/output
- OpenAI audio/pcm is **24 kHz only** in AND out — so we upsample the 16 kHz mic
- turn_detection: server_vad (threshold/prefix_padding_ms/silence_duration_ms)
  | semantic_vad (eagerness); idle_timeout_ms exists but is a re-prompt trigger,
  never sent (see _server_vad); event names as used below.
Items that could drift are marked # VERIFY.
"""

from __future__ import annotations

import base64
import json
import logging
from collections import deque
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field

import aiohttp

from . import constants as C
from .audio import StreamResampler, resample_pcm16
from .prompt import SYSTEM_PROMPT_DA
from .voice import (
    AudioChunk,
    InputTranscript,
    Interrupted,
    OutputTranscript,
    SilentToolComplete,
    ToolCall,
    ToolRoundComplete,
    TurnComplete,
    Usage,
    UserSpeechStarted,
    UserSpeechStopped,
    VoiceEvent,
)

_LOG = logging.getLogger("podvoice.openai")

_URL = "wss://api.openai.com/v1/realtime"
OPENAI_RATE = 24000  # OpenAI audio/pcm is 24 kHz for both directions (VERIFY: 16k unsupported)
FULL_MODEL = "gpt-realtime-2.1"
MINI_MODEL = "gpt-realtime-2.1-mini"
# Product goal = best voice understanding first. OpenAI describes 2.1 as its highest-
# reasoning Realtime model and mini as the distilled speed/cost variant. Mini remains
# an explicit cost guard, but must not silently define the quality baseline.
DEFAULT_MODEL = FULL_MODEL
DEFAULT_VOICE = "marin"  # VERIFY: a current realtime voice name
TRANSCRIPTION_MODEL = "gpt-live-transcribe"
TRANSCRIPTION_PROMPT_DA = (
    "Dansk tale til en hjemmeassistent. Bevar navne, sangtitler, kunstnere, "
    "sportsklubber og akronymer ordret, blandt andet AGF, FCK, Brøndby, Nabu, "
    "Home Assistant, PodVoice, PodConnect og Spotify."
)
# Preserve a complete privacy-gated utterance even when DNS/TLS/session.update is slow.
# Twelve seconds of 16 kHz mono PCM is only ~384 KiB and is cleared on every close.
PRECONNECT_AUDIO_MAX_S = 12.0
# Realtime defaults max_output_tokens to "inf" (4096 on the session API). The
# server reserves output capacity when each response is created, so a short
# tool/farewell round could request ~5.5k TPM despite producing one spoken word.
# PodVoice's contract is at most two short spoken sentences; 1024 leaves ample
# room for low-effort reasoning + tool JSON while cutting the reservation by 75%.
MAX_OUTPUT_TOKENS = 1024

# The panel's model/voice selector set (all voice-capable; small fixed list).
STATIC_MODELS = [
    {"id": FULL_MODEL, "label": "GPT Realtime 2.1 (quality standard)", "live": True},
    {"id": MINI_MODEL, "label": "GPT Realtime 2.1 mini (cost mode)", "live": True},
    {"id": "gpt-realtime-2", "label": "GPT Realtime 2", "live": True},
]
STATIC_VOICES = ["marin", "cedar", "alloy", "echo", "shimmer"]


def _rid(ev: dict) -> str:
    """Best-effort response id from any event shape (or '?' if absent)."""
    r = ev.get("response")
    if isinstance(r, dict) and r.get("id"):
        return str(r["id"])
    return str(ev.get("response_id") or "?")


def _rstatus(ev: dict) -> str:
    """response.done status ('completed' | 'cancelled' | 'failed' | ...) or '?'."""
    r = ev.get("response")
    if isinstance(r, dict) and r.get("status"):
        return str(r["status"])
    return "?"


def _rerror(ev: dict) -> str | None:
    """Best-effort human-readable error attached to a failed response."""
    response = ev.get("response")
    if not isinstance(response, dict):
        return None
    details = response.get("status_details")
    if not isinstance(details, dict):
        return None
    error = details.get("error")
    if isinstance(error, dict):
        message = error.get("message") or error.get("code") or error.get("type")
        return str(message) if message else None
    reason = details.get("reason")
    return str(reason) if reason else None


@dataclass
class OpenAIRealtimeSession:
    """One OpenAI Realtime WebSocket. Satisfies voice.VoiceSession."""

    api_key: str
    model: str = DEFAULT_MODEL
    voice: str = DEFAULT_VOICE
    instructions: str = ""  # empty -> built-in SYSTEM_PROMPT_DA
    # WHERE this session physically is. Without it the model cannot target the room's
    # own speaker and HA rejects media calls with "multiple targets" (field 14:36).
    room_context: str = ""
    # Sample rate of the audio WE are fed. The puck sends 16 kHz (firmware), but the
    # browser can capture natively at OpenAI's own 24 kHz — and then every resampling
    # step is pure damage. Field 2026-08-07: browser 48k -> nearest-neighbour 16k ->
    # upsample 24k made Danish barely intelligible, while the same mic through a
    # no-resampling tool understood everything.
    input_rate: int = C.INPUT_RATE
    tool_declarations: list[dict] | None = None
    language: str = "da"
    # Turn detection: a PRESET (conservative/responsive) or "custom" via the raw knobs.
    # conservative = server_vad tuned hard-to-interrupt, so residual echo past the XMOS
    # AEC doesn't read as user barge-in (the self-interruption bug); responsive =
    # semantic_vad, easiest to talk over. Tunable live in Settings — no redeploy.
    preset: str = "responsive"  # conservative | responsive | custom
    turn: str = "semantic_vad"  # custom: server_vad | semantic_vad | none
    threshold: float = 0.5  # custom, server_vad only
    prefix_ms: int = 300  # custom, server_vad only
    silence_ms: int = 500  # custom, server_vad only
    eagerness: str = "auto"  # custom, semantic_vad: auto | low | medium | high
    # Half-duplex Voice PE keeps this false: a server-side speech edge must never
    # cancel an answer whose physical playback has not even begun. Talk/browser AEC
    # explicitly enables it as the separate full-duplex proving surface.
    interrupt_response: bool = True
    # Source-specific. Voice PE channel 1 already contains XMOS AEC+IC+NS, so its
    # default is off; Talk disables browser NS/AGC and uses OpenAI far_field instead.
    noise: str = "off"  # near_field | far_field | off
    # RETIRED knob: kept for settings compatibility, NEVER sent to the server
    # (idle_timeout_ms is a re-prompt trigger, not a closer — see _server_vad).
    idle_timeout_s: int = 25
    # Optional one-shot diagnostic observer. It receives the EXACT 24 kHz PCM bytes
    # appended to the provider input buffer, after resampling and immediately before
    # base64/WebSocket transport. Disabled during normal operation.
    audio_observer: Callable[[bytes, int], None] | None = field(
        default=None, init=False, repr=False
    )
    _http: aiohttp.ClientSession | None = field(default=None, init=False, repr=False)
    _ws: aiohttp.ClientWebSocketResponse | None = field(default=None, init=False, repr=False)
    # High-quality 16k->24k resampler, rebuilt per connect() so filter state is fresh.
    _resampler: StreamResampler | None = field(default=None, init=False, repr=False)
    # Realtime rejects response.create while a response is active. A function call arrives
    # mid-response, so we submit the output now but DEFER response.create until response.done.
    _active_response: bool = field(default=False, init=False, repr=False)
    _pending_create: bool = field(default=False, init=False, repr=False)
    # At least one tool in the current function-call response needs a spoken result.
    # A pure wait_for_user round records its function output but intentionally creates
    # no assistant response, eliminating cross-turn silence state in ThinSession.
    _tool_result_response_required: bool = field(default=False, init=False, repr=False)
    # A semantic-end result must produce exactly one final spoken farewell and no
    # further tool calls. Normal tool results stay auto to preserve multi-step work.
    _force_no_tools_followup: bool = field(default=False, init=False, repr=False)
    _silent_tool_call_ids: set[str] = field(default_factory=set, init=False, repr=False)
    _outstanding_tool_calls: set[str] = field(default_factory=set, init=False, repr=False)
    _cancelled_tool_calls: set[str] = field(default_factory=set, init=False, repr=False)
    _deliberate_close: bool = field(default=False, init=False, repr=False)
    # True once the server ACCEPTED our session.update (hard-fail guard, 0.77 class).
    _configured: bool = field(default=False, init=False, repr=False)
    # Mic audio can arrive before Realtime has accepted session.update. Dropping it makes
    # "Okay Nabu hvad er klokken" become only "...klokken" unless the user pauses after
    # the wake word. Keep a short raw-input buffer and replay it once the server is ready.
    _preconnect_audio: deque[bytes] = field(default_factory=deque, init=False, repr=False)
    _preconnect_audio_bytes: int = field(default=0, init=False, repr=False)
    # Realtime emits both speech_stopped and committed for the same VAD turn.  The
    # engine needs one boundary, not two state transitions/latency samples.
    _speech_stop_emitted: bool = field(default=False, init=False, repr=False)

    def _turn_detection(self) -> dict | None:
        """Build the turn_detection block from the preset (or the custom knobs).

        Field names verified 2026-07: threshold / prefix_padding_ms /
        silence_duration_ms / idle_timeout_ms (server_vad); eagerness (semantic_vad).
        """
        if self.preset == "conservative":
            # Retuned 2026-08-07 on field evidence. The old 0.7 threshold existed to
            # stop residual speaker echo from firing speech_started — a job now done by
            # the echo shield AND the device's own wake-word hush. What the high
            # threshold DID cost was the start of every SHORT utterance: detection fired
            # late, and only 300 ms of pre-roll was kept, so "Okay Nabu" became
            # "Tailam" and "Men hvad?" vanished — on BOTH the puck and a clean Mac mic,
            # which is what proves it was never the microphone.
            #   threshold 0.45: catch quiet/short speech from the first syllable
            #   prefix 800 ms : keep enough pre-roll that nothing is clipped
            #   silence 500 ms: OpenAI's documented baseline; 200 ms faster feedback
            #                   without raising the speech threshold or clipping onset
            return self._server_vad(threshold=0.45, prefix_ms=800, silence_ms=500)
        if self.preset == "responsive":
            return {
                "type": "semantic_vad",
                "eagerness": "auto",
                "create_response": True,
                "interrupt_response": self.interrupt_response,
            }
        # custom — raw knobs
        if self.turn == "none":
            return None
        if self.turn == "semantic_vad":
            return {
                "type": "semantic_vad",
                "eagerness": self.eagerness or "auto",
                "create_response": True,
                "interrupt_response": self.interrupt_response,
            }
        return self._server_vad(
            threshold=float(self.threshold),
            prefix_ms=int(self.prefix_ms),
            silence_ms=int(self.silence_ms),
        )

    def _server_vad(self, *, threshold: float, prefix_ms: int, silence_ms: int) -> dict:
        td = {
            "type": "server_vad",
            "threshold": threshold,
            "prefix_padding_ms": prefix_ms,
            "silence_duration_ms": silence_ms,
            "create_response": True,
            "interrupt_response": self.interrupt_response,
        }
        # idle_timeout_ms is DELIBERATELY NOT SENT (ARKITEKTUR.md, modprøve A3):
        # the GA docs define it as a RE-PROMPT trigger — on timeout the server commits
        # empty audio and the MODEL GENERATES A RESPONSE ITSELF (possibly with tool
        # calls) — an unsolicited-action race, the exact Gemini sin we refuse. The
        # engine's client-side idle fallback covers conversation close for BOTH VAD
        # modes, so the field is redundant as a closer and dangerous as a feature.
        return td

    def _session_update(self) -> dict:
        audio_input: dict = {
            "format": {"type": "audio/pcm", "rate": OPENAI_RATE},
            # Official OpenAI guidance now says to start realtime transcription with
            # gpt-live-transcribe. It uses `languages`, never singular `language`, and
            # accepts a prompt for names/acronyms. This asynchronous transcript is
            # diagnostic guidance; the Realtime model itself consumes audio directly.
            "transcription": {
                "model": TRANSCRIPTION_MODEL,
                "languages": [self.language],
                "prompt": TRANSCRIPTION_PROMPT_DA,
            },
            "turn_detection": self._turn_detection(),
        }
        if self.noise and self.noise != "off":
            audio_input["noise_reduction"] = {"type": self.noise}  # near_field | far_field
        session: dict = {
            "type": "realtime",  # speech-to-speech (vs "transcription")
            "output_modalities": ["audio"],
            "max_output_tokens": MAX_OUTPUT_TOKENS,
            # OpenAI recommends low as the production voice-agent starting point:
            # responsive, while retaining basic reasoning and tool selection.
            "reasoning": {"effort": "low"},
            # Every fresh user turn must produce an explicit tool decision. Direct
            # answers use Thin's continue_conversation no-op in the same audio response;
            # semantic close uses end_conversation; real actions use their own tool.
            # Tool-result follow-ups override this to auto so multi-step work remains
            # possible and the final spoken result is not forced into a tool loop.
            "tool_choice": "required",
            "instructions": (self.instructions or SYSTEM_PROMPT_DA)
            + (f"\n\nRUM\n{self.room_context}" if self.room_context else ""),
            "audio": {
                "input": audio_input,
                "output": {
                    "format": {"type": "audio/pcm", "rate": OPENAI_RATE},
                    "voice": self.voice,
                },
            },
        }
        tools: list[dict] = []
        if self.tool_declarations:
            # Gemini-style {name,description,parameters} -> OpenAI {type:function, ...}.
            tools += [
                {
                    "type": "function",
                    "name": d.get("name"),
                    "description": d.get("description"),
                    "parameters": d.get("parameters"),
                }
                for d in self.tool_declarations
            ]
        if tools:
            session["tools"] = tools
        return {"type": "session.update", "session": session}

    async def connect(self) -> None:
        self._configured = False  # fresh socket -> fresh accept required
        # Fresh socket -> fresh state machine (a prior session may have died mid-response).
        self._active_response = False
        self._pending_create = False
        self._tool_result_response_required = False
        self._force_no_tools_followup = False
        self._silent_tool_call_ids.clear()
        self._outstanding_tool_calls.clear()
        self._cancelled_tool_calls.clear()
        self._speech_stop_emitted = False
        self._resampler = (
            None
            if self.input_rate == OPENAI_RATE
            else StreamResampler(self.input_rate, OPENAI_RATE)  # fresh filter state
        )
        self._http = aiohttp.ClientSession()
        self._ws = await self._http.ws_connect(
            f"{_URL}?model={self.model}",
            headers={"Authorization": f"Bearer {self.api_key}"},  # no OpenAI-Beta in GA
            heartbeat=20,
            max_msg_size=0,  # audio frames can be large
        )
        await self._ws.send_json(self._session_update())

    async def send_audio(self, pcm16k: bytes) -> None:
        if self._ws is None or not self._configured:
            self._buffer_preconnect_audio(pcm16k)
            return
        await self._send_audio_now(pcm16k)

    async def clear_input_audio(self) -> None:
        """Reset a half-open provider VAD buffer at a half-duplex answer boundary."""
        self._preconnect_audio.clear()
        self._preconnect_audio_bytes = 0
        self._speech_stop_emitted = False
        if self._ws is not None:
            await self._ws.send_json({"type": "input_audio_buffer.clear"})

    def _buffer_preconnect_audio(self, pcm: bytes) -> None:
        if not pcm:
            return
        self._preconnect_audio.append(bytes(pcm))
        self._preconnect_audio_bytes += len(pcm)
        max_bytes = int(self.input_rate * C.SAMPLE_WIDTH * PRECONNECT_AUDIO_MAX_S)
        while self._preconnect_audio_bytes > max_bytes and self._preconnect_audio:
            self._preconnect_audio_bytes -= len(self._preconnect_audio.popleft())

    async def _flush_preconnect_audio(self) -> None:
        if not self._preconnect_audio:
            return
        buffered_bytes = self._preconnect_audio_bytes
        frames = 0
        while self._preconnect_audio:
            pcm = self._preconnect_audio.popleft()
            self._preconnect_audio_bytes -= len(pcm)
            await self._send_audio_now(pcm)
            frames += 1
        buffered_ms = buffered_bytes * 1000 // max(1, self.input_rate * C.SAMPLE_WIDTH)
        _LOG.info("flushed %dms preconnect audio (%d frame(s))", buffered_ms, frames)

    async def _send_audio_now(self, pcm16k: bytes) -> None:
        if self._ws is None:
            self._buffer_preconnect_audio(pcm16k)
            return
        if self.input_rate == OPENAI_RATE:
            # Already native: touching it could only make it worse.
            if self.audio_observer is not None:
                self.audio_observer(pcm16k, OPENAI_RATE)
            b64 = base64.b64encode(pcm16k).decode("ascii")
            await self._ws.send_json({"type": "input_audio_buffer.append", "audio": b64})
            return
        # 16 kHz -> 24 kHz through the stateful soxr resampler (falls back to linear).
        if self._resampler is not None:
            pcm = self._resampler.process(pcm16k)
        else:
            pcm = resample_pcm16(pcm16k, C.INPUT_RATE, OPENAI_RATE)
        if not pcm:  # streaming resampler may hold a sub-frame tail; nothing to send yet
            return
        if self.audio_observer is not None:
            self.audio_observer(pcm, OPENAI_RATE)
        b64 = base64.b64encode(pcm).decode("ascii")
        await self._ws.send_json({"type": "input_audio_buffer.append", "audio": b64})

    async def send_text(self, text: str) -> None:
        if self._ws is None:
            return
        await self._ws.send_json(
            {
                "type": "conversation.item.create",
                "item": {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": text}],
                },
            }
        )
        await self._ws.send_json({"type": "response.create"})

    async def send_tool_results(self, results: list) -> bool:
        if self._ws is None:
            return False
        submitted = 0
        for r in results:
            call_id = str(r.get("id") or "")
            if call_id in self._cancelled_tool_calls:
                self._cancelled_tool_calls.discard(call_id)
                _LOG.info("turn: dropping late result for cancelled tool call %s", call_id)
                continue
            resp = r.get("response")
            output = resp if isinstance(resp, str) else json.dumps(resp)
            await self._ws.send_json(
                {
                    "type": "conversation.item.create",
                    "item": {
                        "type": "function_call_output",
                        "call_id": r.get("id"),
                        "output": output,
                    },
                }
            )
            self._outstanding_tool_calls.discard(call_id)
            if bool(r.get("suppress_response")):
                self._silent_tool_call_ids.add(call_id)
            else:
                self._tool_result_response_required = True
                if r.get("name") == "end_conversation":
                    self._force_no_tools_followup = True
            submitted += 1
        if submitted == 0:
            return False
        # Asking for a response while one is still active errors out (and the model never
        # speaks). If the function-call response hasn't finished yet, defer until response.done.
        if self._active_response or self._outstanding_tool_calls:
            self._pending_create = True
            _LOG.info(
                "turn: tool results submitted with response active=%s outstanding=%d "
                "-> DEFER create (%d result(s))",
                self._active_response,
                len(self._outstanding_tool_calls),
                len(results),
            )
            return False
        else:
            self._pending_create = False
            if self._tool_result_response_required:
                _LOG.info(
                    "turn: tool results submitted while idle -> create NOW (%d result(s))",
                    len(results),
                )
                self._tool_result_response_required = False
                self._silent_tool_call_ids.clear()
                await self._create_tool_result_response()
                return False
            else:
                _LOG.info("turn: silent tool result recorded -> no response.create")
                self._silent_tool_call_ids.clear()
                return True

    async def events(self) -> AsyncIterator[VoiceEvent]:
        if self._ws is None:
            return
        self._deliberate_close = False
        try:
            async for ev in self._iter_events():
                yield ev
        finally:
            # On any exit (incl. a socket drop mid-response) don't carry stale state into
            # the next socket, or tool calls would defer forever / fire a spurious create.
            self._active_response = False
            self._pending_create = False
            self._tool_result_response_required = False
            self._force_no_tools_followup = False
            self._silent_tool_call_ids.clear()
            self._outstanding_tool_calls.clear()
            self._cancelled_tool_calls.clear()
        # aiohttp's WS iterator ENDS SILENTLY when the socket closes — no exception. A
        # normal-looking return here therefore meant the room sat in LISTENING, music
        # ducked, with a dead brain and no error until the idle timeout (0.66 audit H3).
        # Raise so the orchestrator's reader posts ERROR -> audible clip + clean IDLE.
        if not self._deliberate_close:
            raise ConnectionError("OpenAI realtime socket closed unexpectedly")

    async def _iter_events(self) -> AsyncIterator[VoiceEvent]:
        assert self._ws is not None
        # Per-stream turn tracking (diagnostics for cross-wired answers): the id of the
        # response currently being created, and the id we last logged as "speaking".
        cur_rid: str | None = None
        spoke_rid: str | None = None
        async for msg in self._ws:
            if msg.type is not aiohttp.WSMsgType.TEXT:
                continue
            try:
                ev = json.loads(msg.data)
            except (json.JSONDecodeError, ValueError):
                continue
            t = ev.get("type")
            if t == "response.created":
                self._active_response = True
                cur_rid = _rid(ev)
                _LOG.info(
                    "turn: response.created id=%s (active=True pending=%s)",
                    cur_rid,
                    self._pending_create,
                )
            elif t == "response.output_audio.delta":  # VERIFY: GA event name
                d = ev.get("delta")
                if d:
                    drid = _rid(ev)
                    if drid != spoke_rid:  # first audio chunk of this response
                        spoke_rid = drid
                        if drid != "?" and cur_rid not in ("?", None) and drid != cur_rid:
                            _LOG.warning(
                                "turn: ANSWER CROSSING — audio for response %s but current is %s",
                                drid,
                                cur_rid,
                            )
                        else:
                            _LOG.info("turn: speaking response %s", drid)
                    # item_id feeds the Track-B playout clock -> conversation.item.truncate.
                    yield AudioChunk(base64.b64decode(d), item_id=ev.get("item_id"))
            elif t == "response.output_audio_transcript.delta":
                yield OutputTranscript(ev.get("delta", ""))
            elif t == "conversation.item.input_audio_transcription.completed":
                # ONLY the completed (final) transcript drives the displayed line. We used to
                # ALSO emit on '.delta', but the console renders one bubble per event (no
                # accumulation), so delta + completed showed the same utterance twice.
                text = ev.get("transcript", "")
                if text:
                    _LOG.info("turn: input transcript %r", text)
                yield InputTranscript(text)
            elif t == "response.function_call_arguments.done":
                call_id = str(ev.get("call_id") or "")
                if call_id:
                    self._outstanding_tool_calls.add(call_id)
                    # This response cannot be a user-visible turn boundary even when
                    # every tool is slow and no result has arrived by response.done.
                    self._pending_create = True
                try:
                    args = json.loads(ev.get("arguments") or "{}")
                except (json.JSONDecodeError, ValueError):
                    args = {}
                _LOG.info(
                    "turn: tool-call name=%s call_id=%s (response %s)",
                    ev.get("name"),
                    ev.get("call_id"),
                    _rid(ev),
                )
                yield ToolCall(ev.get("call_id", ""), ev.get("name", ""), args)
            elif t == "input_audio_buffer.speech_started":
                # Full-duplex Talk treats every speech edge as an interruption even
                # after generation has outrun physical playback.  Half-duplex Voice PE
                # must never cancel here: Thin clears the crossed VAD buffer and keeps
                # the response authoritative until the physical playback gate closes.
                if self.interrupt_response and self._active_response:
                    _LOG.info("turn: barge-in (speech_started) over active response")
                    self._active_response = False
                    self._pending_create = False
                    self._tool_result_response_required = False
                    self._force_no_tools_followup = False
                    self._silent_tool_call_ids.clear()
                if self.interrupt_response:
                    self._cancelled_tool_calls.update(self._outstanding_tool_calls)
                    self._outstanding_tool_calls.clear()
                self._speech_stop_emitted = False
                if self.interrupt_response:
                    yield Interrupted()
                else:
                    yield UserSpeechStarted()
            elif t == "input_audio_buffer.speech_stopped":
                # The user finished their turn — arm the TTFR watchdog from HERE (the
                # model should now reply within WATCHDOG_MS). Arming at wake/gate-open
                # would count the user's own speaking time as latency and abort every
                # turn before a reply is even possible.
                if not self._speech_stop_emitted:
                    self._speech_stop_emitted = True
                    yield UserSpeechStopped()
            elif t == "input_audio_buffer.timeout_triggered":
                # Can only fire if idle_timeout_ms were sent — which we never do.
                # If it EVER appears, the server is about to generate an unsolicited
                # response: log loudly, do NOT treat as a clean close.
                _LOG.warning("unexpected timeout_triggered (idle_timeout_ms not sent!)")
            elif t == "input_audio_buffer.committed":
                # Belt-and-suspenders fallback for manual commits/providers that do
                # not emit speech_stopped.  For normal VAD this is the SAME boundary,
                # so never publish it twice.
                if not self._speech_stop_emitted:
                    self._speech_stop_emitted = True
                    yield UserSpeechStopped()
            elif t == "response.done":
                self._active_response = False
                usage = self._usage_of(ev)
                if usage is not None:
                    yield usage
                rid, status = _rid(ev), _rstatus(ev)
                if status not in ("?", "completed"):
                    # A failed/cancelled function-call response is not permission to
                    # manufacture either a spoken result or a silent success. Cancel
                    # its late tool outputs and expose the provider failure to Thin.
                    self._pending_create = False
                    self._tool_result_response_required = False
                    self._force_no_tools_followup = False
                    self._cancelled_tool_calls.update(self._outstanding_tool_calls)
                    self._outstanding_tool_calls.clear()
                    self._silent_tool_call_ids.clear()
                    yield TurnComplete(status=status, error=_rerror(ev))
                    continue
                if (
                    self._pending_create
                    and not self._outstanding_tool_calls
                    and self._ws is not None
                ):
                    # This response.done only closed the function-call response. Fire the
                    # deferred follow-up that speaks the result, and DON'T end the turn here
                    # (the follow-up response's own response.done is the real end-of-turn).
                    self._pending_create = False
                    if not self._tool_result_response_required:
                        _LOG.info(
                            "turn: response.done id=%s status=%s -> silent tool round complete",
                            rid,
                            status,
                        )
                        call_ids = tuple(sorted(self._silent_tool_call_ids))
                        self._silent_tool_call_ids.clear()
                        yield SilentToolComplete(call_ids=call_ids)
                        continue
                    self._tool_result_response_required = False
                    self._silent_tool_call_ids.clear()
                    _LOG.info(
                        "turn: response.done id=%s status=%s -> firing DEFERRED create (turn stays open)",
                        rid,
                        status,
                    )
                    await self._create_tool_result_response()
                    # Do not emit TurnComplete: the room has not received its answer
                    # yet.  Still publish an explicit provider-neutral edge so Thin
                    # clears the tool-decision state.  Without this marker the final
                    # answer's TurnComplete was mistaken for another tool decision and
                    # its fully generated PCM stayed forever in the held announce
                    # buffer (physical 1.13.0 follow-up failure, 2026-08-14 12:00).
                    yield ToolRoundComplete()
                    continue
                if self._pending_create and self._outstanding_tool_calls:
                    _LOG.info(
                        "turn: response.done id=%s status=%s -> waiting for %d tool result(s)",
                        rid,
                        status,
                        len(self._outstanding_tool_calls),
                    )
                    continue
                _LOG.info("turn: response.done id=%s status=%s -> TurnComplete", rid, status)
                # Old fakes/providers omit response.status. Preserve compatibility by
                # treating an absent value as completed, while carrying every explicit
                # failed/cancelled state through the provider-neutral contract.
                yield TurnComplete(
                    status=status if status != "?" else "completed",
                    error=_rerror(ev),
                )

            elif t == "session.updated":
                self._configured = True
                _LOG.info(
                    "session.updated ACCEPTED model=%s transcription=%s language=%s "
                    "preset=%s noise=%s input_rate=%s",
                    self.model,
                    TRANSCRIPTION_MODEL,
                    self.language,
                    self.preset,
                    self.noise,
                    self.input_rate,
                )
                await self._flush_preconnect_audio()
            elif t == "error":
                err = ev.get("error") or {}
                if not self._configured:
                    # The 0.77 class: ONE bad field rejects the WHOLE session.update —
                    # prompt, tools and VAD silently never apply. Never run untuned:
                    # die loudly so the engine fails audibly and the log names the field.
                    _LOG.error("session.update REJECTED — failing loudly: %s", err)
                    raise RuntimeError(f"session.update rejected: {err.get('message', err)}")
                _LOG.warning("openai realtime error: %s", err)

    async def _create_tool_result_response(self) -> None:
        """Create one result response with the correct lifecycle tool policy."""
        if self._ws is None:
            return
        tool_choice = "none" if self._force_no_tools_followup else "auto"
        self._force_no_tools_followup = False
        await self._ws.send_json(
            {"type": "response.create", "response": {"tool_choice": tool_choice}}
        )

    @staticmethod
    def _usage_of(ev: dict) -> Usage | None:
        """Token counts from a response.done event (verified GA shape 2026-07:
        response.usage.{input_token_details{text_tokens,audio_tokens,cached_tokens,
        cached_tokens_details{...}},output_token_details{text_tokens,audio_tokens}})."""
        r = ev.get("response")
        u = r.get("usage") if isinstance(r, dict) else None
        if not isinstance(u, dict):
            return None
        ind = u.get("input_token_details") or {}
        outd = u.get("output_token_details") or {}
        cached = ind.get("cached_tokens_details") or {}
        return Usage(
            input_text_tokens=int(ind.get("text_tokens") or 0),
            input_audio_tokens=int(ind.get("audio_tokens") or 0),
            cached_text_tokens=int(cached.get("text_tokens") or 0),
            cached_audio_tokens=int(cached.get("audio_tokens") or 0),
            output_text_tokens=int(outd.get("text_tokens") or 0),
            output_audio_tokens=int(outd.get("audio_tokens") or 0),
        )

    async def reconnect(self) -> None:
        await self.close()
        await self.connect()

    async def truncate(self, item_id: str, audio_end_ms: int) -> None:
        """Tell the server how much of an assistant item the user ACTUALLY heard
        before barging in (Track B). The server drops the unheard audio AND its
        transcript from the conversation, so follow-ups reference only heard
        content. ``audio_end_ms`` comes from the playout clock, never from the
        receive position (we buffer ahead of playback)."""
        if self._ws is None:
            return
        await self._ws.send_json(
            {
                "type": "conversation.item.truncate",
                "item_id": item_id,
                "content_index": 0,
                "audio_end_ms": max(0, int(audio_end_ms)),
            }
        )
        _LOG.info("truncated item %s at %dms (heard position)", item_id, audio_end_ms)

    async def close(self) -> None:
        self._deliberate_close = True
        self._preconnect_audio.clear()
        self._preconnect_audio_bytes = 0
        if self._ws is not None:
            await self._ws.close()
            self._ws = None
        if self._http is not None:
            await self._http.close()
            self._http = None


def make_session(
    cfg,
    *,
    model: str | None = None,
    voice: str | None = None,
    tool_declarations: list[dict] | None = None,
    room_context: str = "",
    input_rate: int = C.INPUT_RATE,
    noise: str | None = None,
    interrupt_response: bool = True,
) -> OpenAIRealtimeSession:
    """Build the one voice brain from a Config (the old multi-provider factory).

    This module is the whole provider surface: model id, session config,
    connection lifecycle and event handling live here. A future GPT-Live-1
    migration is a new model string + event handlers in this file only.
    """
    chosen = model or cfg.openai_model
    if getattr(cfg, "force_mini", False):
        chosen = MINI_MODEL  # explicit cost guard: every session runs the mini model
    return OpenAIRealtimeSession(
        api_key=cfg.openai_api_key,
        model=chosen,
        voice=voice or cfg.openai_voice or DEFAULT_VOICE,
        instructions=cfg.system_prompt,
        room_context=room_context,
        input_rate=input_rate,
        tool_declarations=tool_declarations,
        preset=getattr(cfg, "turn_preset", "conservative"),
        turn=cfg.openai_turn,
        threshold=cfg.openai_threshold,
        prefix_ms=cfg.openai_prefix_ms,
        silence_ms=cfg.openai_silence_ms,
        eagerness=cfg.openai_eagerness,
        noise=cfg.openai_noise if noise is None else noise,
        interrupt_response=interrupt_response,
        idle_timeout_s=getattr(cfg, "idle_timeout_s", 25),
    )
