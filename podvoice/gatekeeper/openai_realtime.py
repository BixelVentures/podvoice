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
from collections.abc import AsyncIterator
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
    ToolCall,
    TurnComplete,
    Usage,
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
PRECONNECT_AUDIO_MAX_S = 3.0  # wake tail + first words while session.update is still pending

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
    preset: str = "conservative"  # conservative | responsive | custom
    turn: str = "semantic_vad"  # custom: server_vad | semantic_vad | none
    threshold: float = 0.5  # custom, server_vad only
    prefix_ms: int = 300  # custom, server_vad only
    silence_ms: int = 500  # custom, server_vad only
    eagerness: str = "auto"  # custom, semantic_vad: auto | low | medium | high
    # Source-specific. Voice PE channel 1 already contains XMOS AEC+IC+NS, so its
    # default is off; Talk disables browser NS/AGC and uses OpenAI far_field instead.
    noise: str = "off"  # near_field | far_field | off
    # RETIRED knob: kept for settings compatibility, NEVER sent to the server
    # (idle_timeout_ms is a re-prompt trigger, not a closer — see _server_vad).
    idle_timeout_s: int = 25
    _http: aiohttp.ClientSession | None = field(default=None, init=False, repr=False)
    _ws: aiohttp.ClientWebSocketResponse | None = field(default=None, init=False, repr=False)
    # High-quality 16k->24k resampler, rebuilt per connect() so filter state is fresh.
    _resampler: StreamResampler | None = field(default=None, init=False, repr=False)
    # Realtime rejects response.create while a response is active. A function call arrives
    # mid-response, so we submit the output now but DEFER response.create until response.done.
    _active_response: bool = field(default=False, init=False, repr=False)
    _pending_create: bool = field(default=False, init=False, repr=False)
    _deliberate_close: bool = field(default=False, init=False, repr=False)
    # True once the server ACCEPTED our session.update (hard-fail guard, 0.77 class).
    _configured: bool = field(default=False, init=False, repr=False)
    # Mic audio can arrive before Realtime has accepted session.update. Dropping it makes
    # "Okay Nabu hvad er klokken" become only "...klokken" unless the user pauses after
    # the wake word. Keep a short raw-input buffer and replay it once the server is ready.
    _preconnect_audio: deque[bytes] = field(default_factory=deque, init=False, repr=False)
    _preconnect_audio_bytes: int = field(default=0, init=False, repr=False)

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
            #   silence 700 ms: unchanged — Danish turn-taking is the world's slowest
            return self._server_vad(threshold=0.45, prefix_ms=800, silence_ms=700)
        if self.preset == "responsive":
            return {
                "type": "semantic_vad",
                "eagerness": "auto",
                "create_response": True,
                "interrupt_response": True,
            }
        # custom — raw knobs
        if self.turn == "none":
            return None
        if self.turn == "semantic_vad":
            return {
                "type": "semantic_vad",
                "eagerness": self.eagerness or "auto",
                "create_response": True,
                "interrupt_response": True,
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
            "interrupt_response": True,
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

    async def send_tool_results(self, results: list, *, create: bool = True) -> None:
        if self._ws is None:
            return
        for r in results:
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
        if not create:
            # A pure acknowledgement (end_conversation): the model already SAID its
            # goodbye in the same response as the tool call — requesting another
            # response here was the double-"Farvel." field bug.
            _LOG.info("turn: tool results submitted, no response requested (%d)", len(results))
            return
        # Asking for a response while one is still active errors out (and the model never
        # speaks). If the function-call response hasn't finished yet, defer until response.done.
        if self._active_response:
            self._pending_create = True
            _LOG.info(
                "turn: tool results submitted while active -> DEFER create (%d result(s))",
                len(results),
            )
        else:
            _LOG.info(
                "turn: tool results submitted while idle -> create NOW (%d result(s))", len(results)
            )
            await self._ws.send_json({"type": "response.create"})

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
                # UNCONDITIONAL (ARKITEKTUR §5.1): generation finishes faster than
                # real time, so _active_response drops BEFORE most of the reply has
                # audibly PLAYED — gating here made tail/duplex barge-in unreachable.
                # Spurious-idle safety lives in the ENGINE's debounce guard instead
                # (it only silences when something is actually speaking/playing).
                if self._active_response:
                    _LOG.info("turn: barge-in (speech_started) over active response")
                    self._active_response = False
                    self._pending_create = False
                yield Interrupted()
            elif t == "input_audio_buffer.speech_stopped":
                # The user finished their turn — arm the TTFR watchdog from HERE (the
                # model should now reply within WATCHDOG_MS). Arming at wake/gate-open
                # would count the user's own speaking time as latency and abort every
                # turn before a reply is even possible.
                yield UserSpeechStopped()
            elif t == "input_audio_buffer.timeout_triggered":
                # Can only fire if idle_timeout_ms were sent — which we never do.
                # If it EVER appears, the server is about to generate an unsolicited
                # response: log loudly, do NOT treat as a clean close.
                _LOG.warning("unexpected timeout_triggered (idle_timeout_ms not sent!)")
            elif t == "input_audio_buffer.committed":
                # Belt-and-suspenders end-of-user-turn signal (fires for both
                # server_vad and semantic_vad). Re-arming the watchdog is harmless.
                yield UserSpeechStopped()
            elif t == "response.done":
                self._active_response = False
                usage = self._usage_of(ev)
                if usage is not None:
                    yield usage
                rid, status = _rid(ev), _rstatus(ev)
                if self._pending_create and self._ws is not None:
                    # This response.done only closed the function-call response. Fire the
                    # deferred follow-up that speaks the result, and DON'T end the turn here
                    # (the follow-up response's own response.done is the real end-of-turn).
                    self._pending_create = False
                    _LOG.info(
                        "turn: response.done id=%s status=%s -> firing DEFERRED create (turn stays open)",
                        rid,
                        status,
                    )
                    await self._ws.send_json({"type": "response.create"})
                    continue
                _LOG.info("turn: response.done id=%s status=%s -> TurnComplete", rid, status)
                yield TurnComplete()
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
        idle_timeout_s=getattr(cfg, "idle_timeout_s", 25),
    )
