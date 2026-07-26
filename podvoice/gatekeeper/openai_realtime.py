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
- turn_detection: server_vad (threshold/prefix_padding_ms/silence_duration_ms/
  idle_timeout_ms) | semantic_vad (eagerness); event names as used below.
Items that could drift are marked # VERIFY.
"""

from __future__ import annotations

import base64
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import aiohttp

from . import constants as C
from .audio import StreamResampler, resample_pcm16
from .prompt import SYSTEM_PROMPT_DA
from .voice import (
    AudioChunk,
    Idle,
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
DEFAULT_MODEL = "gpt-realtime-2.1-mini"  # distilled 2.1 — home control at family-budget cost
FULL_MODEL = "gpt-realtime-2.1"  # opt-in when mini proves too weak (Settings/Talk picker)
DEFAULT_VOICE = "marin"  # VERIFY: a current realtime voice name

# The panel's model/voice selector set (all voice-capable; small fixed list).
STATIC_MODELS = [
    {"id": DEFAULT_MODEL, "label": "GPT Realtime 2.1 mini (standard)", "live": True},
    {"id": FULL_MODEL, "label": "GPT Realtime 2.1", "live": True},
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
    # far_field: the Voice PE mic is across a room, not a headset — this is the right
    # noise-reduction profile for a shared living space (near_field assumed close talk).
    noise: str = "far_field"  # near_field | far_field | off
    # Server-side conversation-idle close (server_vad only — semantic_vad has no
    # idle_timeout_ms; the engine's client-side fallback covers that mode).
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

    def _turn_detection(self) -> dict | None:
        """Build the turn_detection block from the preset (or the custom knobs).

        Field names verified 2026-07: threshold / prefix_padding_ms /
        silence_duration_ms / idle_timeout_ms (server_vad); eagerness (semantic_vad).
        """
        if self.preset == "conservative":
            # Hard to interrupt: a HIGH energy threshold means residual speaker echo
            # (already ~cancelled by the XMOS AEC) can't fire speech_started; a longer
            # end-of-speech silence forgives Danish mid-sentence pauses.
            return self._server_vad(threshold=0.7, prefix_ms=300, silence_ms=700)
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
        if self.idle_timeout_s > 0:
            # The server closes the conversation for us: idle_timeout_ms after the last
            # reply finishes playing, input_audio_buffer.timeout_triggered arrives ->
            # the engine goes home. (server_vad only; clamped >=5s in config.py.)
            td["idle_timeout_ms"] = int(self.idle_timeout_s * 1000)
        return td

    def _session_update(self) -> dict:
        audio_input: dict = {
            "format": {"type": "audio/pcm", "rate": OPENAI_RATE},
            # gpt-4o-mini-transcribe (verified in the GA enum 2026-07) transcribes Danish
            # far better than whisper-1. The transcript is not just display: the engine's
            # end-phrase fallback ("det var det") reads it, so quality matters.
            "transcription": {"model": "gpt-4o-mini-transcribe", "language": self.language},
            "turn_detection": self._turn_detection(),
        }
        if self.noise and self.noise != "off":
            audio_input["noise_reduction"] = {"type": self.noise}  # near_field | far_field
        session: dict = {
            "type": "realtime",  # speech-to-speech (vs "transcription")
            "output_modalities": ["audio"],
            "instructions": self.instructions or SYSTEM_PROMPT_DA,
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
        # Fresh socket -> fresh state machine (a prior session may have died mid-response).
        self._active_response = False
        self._pending_create = False
        self._resampler = StreamResampler(C.INPUT_RATE, OPENAI_RATE)  # fresh filter state
        self._http = aiohttp.ClientSession()
        self._ws = await self._http.ws_connect(
            f"{_URL}?model={self.model}",
            headers={"Authorization": f"Bearer {self.api_key}"},  # no OpenAI-Beta in GA
            heartbeat=20,
            max_msg_size=0,  # audio frames can be large
        )
        await self._ws.send_json(self._session_update())

    async def send_audio(self, pcm16k: bytes) -> None:
        if self._ws is None:
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
                yield InputTranscript(ev.get("transcript", ""))
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
                # A barge-in only counts when a reply is ACTUALLY playing — otherwise
                # this is just the user starting their normal turn (LISTENING), not an
                # interruption. Gating on _active_response is what makes the open-mic
                # full-duplex path safe: ambient noise while idle-listening can't fire a
                # spurious "interrupt". The server cancels the active response itself.
                if self._active_response:
                    _LOG.info("turn: barge-in (speech_started) over active reply")
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
                _LOG.info("turn: server idle timeout -> conversation over")
                yield Idle()
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
            elif t == "error":
                _LOG.warning("openai realtime error: %s", ev.get("error"))

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
) -> OpenAIRealtimeSession:
    """Build the one voice brain from a Config (the old multi-provider factory).

    This module is the whole provider surface: model id, session config,
    connection lifecycle and event handling live here. A future GPT-Live-1
    migration is a new model string + event handlers in this file only.
    """
    chosen = model or cfg.openai_model
    if getattr(cfg, "force_mini", False):
        chosen = DEFAULT_MODEL  # cost guard: every session runs the mini model
    return OpenAIRealtimeSession(
        api_key=cfg.openai_api_key,
        model=chosen,
        voice=voice or cfg.openai_voice or DEFAULT_VOICE,
        instructions=cfg.system_prompt,
        tool_declarations=tool_declarations,
        preset=getattr(cfg, "turn_preset", "conservative"),
        turn=cfg.openai_turn,
        threshold=cfg.openai_threshold,
        prefix_ms=cfg.openai_prefix_ms,
        silence_ms=cfg.openai_silence_ms,
        eagerness=cfg.openai_eagerness,
        noise=cfg.openai_noise,
        idle_timeout_s=getattr(cfg, "idle_timeout_s", 25),
    )
