"""The sole production conversation engine for Voice PE and the Talk surface.

One physical wake opens one ``ThinSession`` epoch and one OpenAI Realtime session.
Realtime owns language, turn meaning, tool choice and semantic end intent. This module
owns the deterministic half-duplex transport: mic gate, announcement playback, music
attention, atomic teardown and wake rearm. Voice PE production output is the firmware-
correlated FLAC announcement path; Talk uses the same lifecycle through its browser I/O
adapter. See ``docs/INVARIANTER.md`` for the binding cross-component contract.
"""

from __future__ import annotations

import array
import asyncio
import contextlib
import hashlib
import logging
import time
from dataclasses import dataclass

from . import audio as audio_mod
from . import constants as C
from .events import Event, EventType, State
from .led import led_command_for
from .playout import PlayoutClock
from .podconnect import AttentionDown, UnknownRoom, Unsupervised
from .prompt import PROMPT_VERSION, SYSTEM_PROMPT_DA
from .voice import (
    AudioChunk,
    Idle,
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
)

_LOG = logging.getLogger("podvoice.thin")

# Hard ceiling on one conversation (the provider caps sessions at 60 min; close cleanly
# well before so the family never hits a mid-sentence provider cut). Configurable per
# session via max_session_s (Settings: max_session_min) — this is only the default.
MAX_CONVERSATION_S = 15 * 60
# Hard ceiling on how long a single reply may claim to be playing. Without it, a stuck
# ANNOUNCING state would hold the conversation (and the music duck) open forever — the
# idle close is our only closer, so it must never be blocked indefinitely.
MAX_REPLY_PLAY_S = 180.0
# Fixed error speech must be heard before teardown, but a broken media pipeline must
# never wedge the close transaction indefinitely.
FIXED_PLAYBACK_START_TIMEOUT_S = 2.0
FIXED_PLAYBACK_FINISH_GRACE_S = 3.0
# Pipeline heartbeat cadence (replaces the old per-turn watchdogs): if the provider
# reader has died while a conversation is open, say so and go home.
HEARTBEAT_S = 5.0
# Barge-in blip filter: a speech_started that ends again within this window (cough,
# clatter, echo residue) is a FALSE interruption — playback continues. Real speech
# sustains past it and silences the device. (LiveKit ships 0.5 s; we start tighter.)
BARGE_DEBOUNCE_S = 0.6
# Client-side idle close, default (Settings: idle_timeout_s). With the conservative
# preset (server_vad) the SERVER also closes idle conversations via idle_timeout_ms;
# this fallback is the belt for semantic_vad and for a server that never says so.
IDLE_FALLBACK_S = 25.0
END_CONVERSATION_TOOL = "end_conversation"
CONTINUE_CONVERSATION_TOOL = "continue_conversation"
WAIT_FOR_USER_TOOL = "wait_for_user"
END_CONVERSATION_DECLARATION = {
    "name": END_CONVERSATION_TOOL,
    "description": (
        "Signal that the user's clear, audible meaning is to end the current voice "
        "conversation. Decide from meaning and conversation context, never from a keyword. "
        "A clear polite wrap-up after a completed request is end intent; the previous "
        "turn's topic or tool must not override the latest user's meaning. "
        "Never use it for unclear, noisy or fragmentary input, ordinary questions, embedded "
        "politeness, background speech, a media stop, or merely mentioning a farewell. If "
        "the user is addressing the assistant but end intent is uncertain, ask for a repeat. "
        "After the tool result, follow the system prompt's short Danish farewell rule."
    ),
    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
}
CONTINUE_CONVERSATION_DECLARATION = {
    "name": CONTINUE_CONVERSATION_TOOL,
    "description": (
        "Signal that the user's latest clear meaning is to continue the current voice "
        "conversation, and speak the complete short answer in the SAME response as this "
        "tool call. Use this lifecycle signal for direct answers and clarifications that "
        "need no other tool. Never use it when the user clearly wants to end the "
        "conversation, when speech is background/not addressed, or as a substitute for "
        "a Home Assistant, web, music, timer or other required action tool."
    ),
    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
}
WAIT_FOR_USER_DECLARATION = {
    "name": WAIT_FOR_USER_TOOL,
    "description": (
        "Use only when detected speech is clearly background, directed at someone else, "
        "or not clearly addressed to the assistant. This is a silent no-op: after the "
        "tool result, produce no audio or text and wait for the next user turn. Never use "
        "it when the user is clearly addressing the assistant but the words are unclear; "
        "ask the user to repeat instead. This tool is exclusive for its turn and must "
        "never be called together with another tool."
    ),
    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
}


@dataclass
class _ClosureTurn:
    """Closure evidence for exactly one user turn and its model response.

    Provider input transcription is asynchronous and can land before *or after*
    response.done.  Evidence therefore accumulates and is reconciled after every
    event; it is never consumed merely because one event happened to arrive first.
    """

    serial: int
    # Wall-clock evidence from the physical/provider VAD boundary.  The completed
    # input transcription may arrive after the model has already answered, so its
    # persistence timestamp must come from here rather than event-arrival order.
    user_finished_at: float | None = None
    semantic_end: bool = False
    response_done: bool = False
    superseded: bool = False
    confirmed: bool = False
    fallback_started: bool = False


# Echo shield: while the device is playing OUR reply, mic frames are NOT forwarded to
# the model. The 0.83 field test showed residual speaker audio getting transcribed as
# the user and making the model answer itself in a loop — while the real user went
# unheard. Both XMOS channels are AEC-processed, but half-duplex remains the shipped
# safety rail until a separate interruption/duplex gate proves otherwise.
ECHO_GATE_TAIL_S = 0.35  # keep the shield up briefly after playback ends (room reverb)
TURN_CUE_TAIL_S = 0.08  # the quiet cue needs less reverb shielding than spoken audio
FOLLOWUP_EDGE_GRACE_S = 0.5  # let ANNOUNCING arrive before painting the follow-up ring
ANNOUNCE_PREARM_S = (
    1.5  # cover announce -> ANNOUNCING-edge fully: field log 11:20 showed sound+state
)
# arriving 0.8-1.1 s after the announce — the old 0.5 s left an unshielded gap that
# let the reply's own first words fire speech_started and KILL the reply at 0 ms.

# ---------------------------------------------------------------- direct PCM path (B1-2b)
# Raw 24 kHz PCM straight down the open API connection into the VA speaker. No HTTP
# fetch, no FLAC encode, no announce round-trip — and, the reason this exists, the
# device reports back the EXACT moment the last byte left the DAC (reply_played), so the
# echo shield stops estimating playback duration and starts knowing it.
DIRECT_CHUNK = 1024  # == VA's RECEIVE_SIZE; keeps each protobuf frame small and smooth
DIRECT_LEAD_S = 0.15
# How far ahead of real time we may buffer on the device. Two hard limits set this:
#   UPPER: SPEAKER_BUFFER_SIZE is 16 KB (0.34 s @ 48000 B/s) and on_audio DROPS a whole
#          chunk when it would overflow ("Cannot receive audio, buffer is full") — lost
#          words, not a stutter. 0.15 s leaves >2x headroom.
#   LOWER: this lead IS the barge-in cost. request_stop() does nothing for the speaker
#          path (its STREAMING_RESPONSE branch is entirely #ifdef USE_MEDIA_PLAYER and
#          media_player_ is nullptr here), so "stop" means "stop sending" and whatever
#          is already buffered still plays. 0.15 s is the worst-case overhang — still
#          ~15x faster than Gemini's ~2.2 s, and the puck's own wake-word hush (armed
#          automatically by upstream's activate_stop_word_once on our TTS_START) keeps
#          cutting "stop" locally at ~51 ms, unchanged.
DIRECT_PLAYED_GRACE_S = 2.0  # wait this long past the expected end for reply_played


class _Mini:
    """Tiny ``sm``-compatible shim so the existing panel/web controls keep working
    (they post WAKE_WORD / CLOSURE_TOKEN events at ``session.sm``)."""

    def __init__(self, owner: ThinSession) -> None:
        self._owner = owner
        self.state: State = State.IDLE

    async def post(self, event: Event) -> None:
        if event.type in (EventType.WAKE_WORD, EventType.BUTTON_PRESS):
            await self._owner.wake()
        elif event.type in (EventType.CLOSURE_TOKEN, EventType.ERROR):
            await self._owner.stop(reason=event.kind or "stop")


class ThinSession:
    """One room, thin-engine mode. Mirrors RoomSession's outward surface
    (start/aclose/audio_health/sm/reply_bus/reply_url/voicepe/playback) so the
    web panel, diagnostics and __main__ wiring work unchanged."""

    def __init__(
        self,
        *,
        room: str,
        attention,
        heartbeat,
        brain,
        voicepe,
        playback,
        tools=None,
        hub=None,
        speech=None,
        reply_bus=None,
        reply_url: str | None = None,
        duck_level: int = C.DUCK_LEVEL,
        usage=None,  # UsageMeter — per-response token/cost telemetry (optional)
        speaker_path: str = "auto",  # "auto" (use direct iff the FIRMWARE advertises it)
        # | "announce" (force the HTTP/FLAC path) | "direct" (force PCM, for the sim/tests)
        full_duplex: bool = False,  # EXPERIMENTAL: mic stays open while the device plays
        # (XMOS AEC + conservative turn detection carry echo rejection; Phase 1.4 gates it)
        idle_timeout_s: float = IDLE_FALLBACK_S,
        max_session_s: float = MAX_CONVERSATION_S,
        audio_trace=None,  # one-shot local diagnostic recorder (physical Voice PE only)
    ) -> None:
        self.room = room
        self.attention = attention
        self.heartbeat = heartbeat
        self.brain = brain
        self.voicepe = voicepe
        self.playback = playback  # sim/console fallback sink only
        self.tools = tools
        self.hub = hub
        self.speech = speech
        self.reply_bus = reply_bus
        self.reply_url = reply_url
        self.duck_level = duck_level
        self.usage = usage
        self.audio_trace = audio_trace
        self.speaker_path = speaker_path
        self.full_duplex = full_duplex
        # Duplex is parked. It must not ride on the AGC-less ASR baseline: even though
        # channel 1 is still AEC-processed, it deliberately lacks AGC and has not
        # passed the physical open-mic interruption gate. Keep the echo shield up unless
        # the diagnostic enhanced channel 0 is explicitly selected.
        if self.full_duplex:
            channel = getattr(voicepe, "mic_channel", None)
            if channel is not None and int(channel) != 0:
                _LOG.error(
                    "thin: full_duplex REFUSED — it is not validated on the "
                    "AGC-less ASR baseline channel %s. Keeping the echo shield up.",
                    channel,
                )
                self.full_duplex = False
        self.idle_timeout_s = float(idle_timeout_s)
        self.max_session_s = float(max_session_s)

        self.sm = _Mini(self)
        self.playout = PlayoutClock()
        self._active = False  # one conversation open?
        self._speaking = False  # assistant audio currently announced/playing
        self._device_playing = False  # media_player ANNOUNCING — playback ground truth
        self._gate_until = 0.0  # echo-shield tail / pre-arm deadline (monotonic)
        self._gate_dropped = 0  # mic frames shielded during the current reply
        self._turn_had_tool = False  # response called a tool -> the reply stream stays open
        self._stop_sent_t: float | None = None  # stop-latency marker (ARKITEKTUR G1)
        self._stop_sent_epoch: float | None = None
        # Until when the reply we generated is still AUDIBLE (byte-derived). The shield
        # trusts this even if the device never reports that it is playing.
        self._reply_audible_until = 0.0
        # Direct PCM path (B1-2b). _direct is decided ONCE per reply, at its first chunk,
        # so a reply can never start on one path and finish on the other.
        self._direct = False
        self._direct_q: asyncio.Queue[bytes | None] | None = None
        self._direct_sent = 0  # bytes handed to the device this reply (playout ceiling)
        self._direct_task: asyncio.Task | None = None
        self._speech_tools: set[str] = set()  # tool calls whose result makes it SPEAK again
        self._heard_signal = False  # has this conversation carried real audio yet?
        self._goodbye: asyncio.Task | None = None  # armed close-after-goodbye (one per conv)
        self._close_task: asyncio.Task | None = None  # exactly one close transaction per epoch
        self._epoch = 0.0  # conversation identity (monotonic start) for armed tasks
        self._history_session = ""  # explicit wake/session boundary in persisted history
        self._teardown_lock = asyncio.Lock()  # wake must never race a teardown in flight
        self._rearm_retry_task: asyncio.Task | None = None
        self._rearm_retry_attempt = 0
        self._device_stream_fault = False
        self._muted = False
        self._closing = False
        self._reader: asyncio.Task | None = None
        self._pump: asyncio.Task | None = None
        self._beat: asyncio.Task | None = None
        self._keepalive: asyncio.Task | None = None  # re-asserts the device mic-forward
        self._tasks: list[asyncio.Task] = []
        self._tool_lock = asyncio.Lock()
        self._tool_tasks: dict[str, asyncio.Task] = {}
        self._semantic_end_call_ids: set[str] = set()
        self._continue_turns: dict[str, tuple[float, _ClosureTurn]] = {}
        self._wait_turns: dict[str, tuple[float, _ClosureTurn]] = {}
        self._playback_t0: float | None = None  # monotonic when the device started playing
        self._playback_started = asyncio.Event()
        self._playback_finished = asyncio.Event()
        self._last_item: str | None = None
        self._conv_started = 0.0
        self._speech_stop_t: float | None = None  # end-of-user-speech -> audible metric
        self._buf_in: list[str] = []  # user transcript deltas (flushed per utterance)
        self._buf_out: list[str] = []  # assistant transcript deltas (flushed per turn)
        # The proven announce path already buffers until generation is complete. Keep
        # each response's PCM here too, so a model that says "Jeg tjekker..." and THEN
        # calls a tool cannot leak that forbidden filler into the final FLAC.
        self._held_announce_pcm: list[bytes] = []
        self._held_announce_item: str | None = None
        self._last_user_utterance = ""  # tool-policy evidence for this user turn
        self._barge_task: asyncio.Task | None = None  # pending blip-debounced barge-in
        self._followup_task: asyncio.Task | None = None  # delayed turn-ready LED fallback
        self._turn_cue_appended = False  # this reply ends with the audible hand-over cue
        self._ending_conversation = False  # suppress "your turn" during a goodbye
        self._closure_serial = 0
        self._closure_turn: _ClosureTurn | None = None
        self._last_activity = 0.0  # monotonic — feeds the client-side idle fallback
        self._trace_reason = "teardown"

        # Capture the exact post-resample bytes that the provider receives. The hook
        # remains installed but is a no-op unless the owner explicitly arms one trace.
        if self.audio_trace is not None and hasattr(self.brain, "audio_observer"):
            self.brain.audio_observer = self._trace_provider_audio

        if hub is not None:
            hub.register_room(room)
        if hasattr(voicepe, "on_wake"):
            voicepe.on_wake = self._on_wake_cb
        if hasattr(voicepe, "on_event"):
            voicepe.on_event = self._on_device_event
        if hasattr(voicepe, "on_media_state"):
            voicepe.on_media_state = self._on_media_state
        if hasattr(voicepe, "on_mute"):
            voicepe.on_mute = self._on_mute
        if hasattr(voicepe, "on_reconnect"):
            voicepe.on_reconnect = self._reassert_device
        if hasattr(voicepe, "on_contract"):
            voicepe.on_contract = self._on_contract
        if hasattr(voicepe, "on_link"):
            voicepe.on_link = self._on_link

    # ------------------------------------------------------------- lifecycle
    async def start(self) -> None:
        await self.voicepe.start()
        # NO optimistic green here: start() only starts the reconnect LOOP. The panel
        # goes green from on_link(True) — a REAL completed connect (0.86 field bug:
        # device changed IP, dot stayed green for days while every wake died).
        self.playback.start()

    async def aclose(self) -> None:
        self._closing = True
        if self._rearm_retry_task is not None:
            self._rearm_retry_task.cancel()
            self._rearm_retry_task = None
        self._trace_reason = "shutdown"
        await self._teardown(release_music=True)
        with contextlib.suppress(Exception):
            if hasattr(self.voicepe, "set_light"):
                await self.voicepe.set_light(False, (0.0, 0.0, 0.0), 0.0)
        with contextlib.suppress(Exception):
            await self.playback.aclose()
        with contextlib.suppress(Exception):
            await self.voicepe.aclose()

    def audio_health(self) -> dict | None:
        vp = self.voicepe
        if not hasattr(vp, "frames_in"):
            return None
        frames = vp.frames_in
        if frames <= 0:
            return {"ok": False, "frames": 0, "error": "no mic audio received yet"}
        age = max(0.0, asyncio.get_event_loop().time() - vp.last_audio_ts)
        return {"ok": age < 5.0, "frames": frames, "bytes": vp.bytes_in, "age_s": round(age, 1)}

    # ------------------------------------------------------------- conversation
    async def wake(self) -> None:
        """Open ONE conversation: duck, stream mic, connect the brain. Idempotent."""
        if self._teardown_lock.locked():
            # A teardown is mid-flight: its remaining awaits (stop_streaming, brain
            # close, heartbeat stop, attention release, LED off) would otherwise land
            # ON TOP of the new conversation — music un-ducked, ring dark, mic gated.
            try:
                async with asyncio.timeout(3.0):
                    async with self._teardown_lock:
                        pass  # wait for the close to finish, then proceed
            except TimeoutError:
                _LOG.warning("thin: wake REFUSED — previous close is stuck [room=%s]", self.room)
                return
        if self._muted or self._active or self._closing:
            _LOG.info(
                "thin: wake IGNORED [room=%s] (muted=%s active=%s closing=%s)",
                self.room,
                self._muted,
                self._active,
                self._closing,
            )
            return
        _LOG.info(
            "thin: conversation open [room=%s] echo-shield=%s preset-mode=%s "
            "mic_channel=%s mic_gain=%s openai_noise=%s",
            self.room,
            "OFF (full_duplex)" if self.full_duplex else "ON",
            getattr(self.brain, "preset", "?"),
            getattr(self.voicepe, "mic_channel", "?"),
            getattr(self.voicepe, "mic_gain", "?"),
            getattr(self.brain, "noise", "?"),
        )
        self._conv_started = time.monotonic()
        self._epoch = self._conv_started  # identity for tasks armed by THIS conversation
        self._history_session = f"{self.room}:{time.time_ns()}"
        self._stop_sent_t = None
        self._stop_sent_epoch = None
        if self.audio_trace is not None:
            effective_prompt = (getattr(self.brain, "instructions", "") or SYSTEM_PROMPT_DA).strip()
            prompt_is_default = effective_prompt == SYSTEM_PROMPT_DA
            self.audio_trace.begin(
                self.room,
                {
                    "mic_channel": getattr(self.voicepe, "mic_channel", None),
                    "mic_gain": getattr(self.voicepe, "mic_gain", None),
                    "input_rate": getattr(self.brain, "input_rate", C.INPUT_RATE),
                    "model": getattr(self.brain, "model", None),
                    "turn_preset": getattr(self.brain, "preset", None),
                    "openai_noise": getattr(self.brain, "noise", None),
                    "speaker_path": self.speaker_path,
                    "same_breath": getattr(self.voicepe, "supports_same_breath", None),
                    "prompt_source": "default" if prompt_is_default else "custom",
                    "prompt_version": PROMPT_VERSION if prompt_is_default else None,
                    "prompt_sha256": hashlib.sha256(effective_prompt.encode()).hexdigest(),
                    "wake_audio_boundary": getattr(
                        self.voicepe, "supports_wake_audio_boundary", None
                    ),
                },
            )
        self._trace_event("wake_received")
        self._trace_reason = "teardown"
        self._active = True
        self._ending_conversation = False
        self._close_task = None
        self._playback_started.clear()
        self._playback_finished.clear()
        self._closure_serial = 0
        self._closure_turn = None
        self._semantic_end_call_ids.clear()
        self._continue_turns.clear()
        self._wait_turns.clear()
        self._turn_cue_appended = False
        self._last_user_utterance = ""
        self._last_activity = self._conv_started
        self.sm.state = State.LISTENING
        self._set_led(State.LISTENING)  # instantly — before the WS connect
        self._hub_state("LISTENING", "👋 Vågnede — samtalen er åben")
        # Duck for the WHOLE conversation (no per-turn pumping — one calm level).
        self.heartbeat.start(self.room, self.duck_level, C.TTL_LISTENING_MS)
        if self.hub is not None:
            self.hub.incr("sessions")
            self.hub.set_level(self.room, self.duck_level)
        # Do NOT drain here. same_breath_v1 starts the privacy-gated device stream at
        # the local wake edge, before its cue; the frames already queued now contain
        # the user's first words.  The queue is instead cleaned after every teardown,
        # once forwarding has stopped, so old-tail audio cannot cross conversations.
        if hasattr(self.voicepe, "start_streaming"):
            stream_started = await self.voicepe.start_streaming()
            if stream_started is False:
                self._device_stream_fault = True
                _LOG.error("thin: Voice PE refused mic-forward start [room=%s]", self.room)
                self._trace_event("mic_stream_start_failed")
                if self.hub is not None:
                    self.hub.set_service("voicepe", "down")
                await self._fail("device")
                return
            self._device_stream_fault = False
            if self.hub is not None:
                self.hub.set_service("voicepe", "up" if self._voicepe_contract_ok() else "degraded")
        # Tool declarations are part of session.update, which connect() sends. Setting
        # them afterwards made HA/PodConnect changes arrive one conversation late.
        decls = list(self.tools.declarations()) if self.tools is not None else []
        # Lifecycle semantics are available for every provider/session, but this
        # reserved signal is handled by ThinSession and never dispatched to HA.
        reserved = {
            END_CONVERSATION_TOOL,
            CONTINUE_CONVERSATION_TOOL,
            WAIT_FOR_USER_TOOL,
        }
        decls = [d for d in decls if d.get("name") not in reserved]
        decls.extend(
            (
                END_CONVERSATION_DECLARATION,
                CONTINUE_CONVERSATION_DECLARATION,
                WAIT_FOR_USER_DECLARATION,
            )
        )
        self.brain.tool_declarations = decls
        try:
            await asyncio.wait_for(self.brain.connect(), timeout=C.CONNECT_TIMEOUT_S)
        except Exception as e:
            _LOG.warning("thin: provider connect failed: %s", e)
            await self._fail("connection")
            return
        self._trace_event("provider_connected")
        if self.reply_bus is not None:
            self.reply_bus.clear(self.room)
        if self.tools is not None and getattr(self.tools, "healthy", True) is False:
            # Honest at the door (modprøve A2/F2): home control is provably down —
            # say it ONCE, keep the conversation open (chat/lookup still works).
            self._hub_state("LISTENING", "⚠️ Hjemmestyring nede — samtalen fortsætter")
            self._spawn(self._speak_home_unreachable(), "thin-home-warn")
        self._reader = self._spawn(self._read_events(), "thin-reader")
        self._pump = self._spawn(self._pump_mic(), "thin-pump")
        self._beat = self._spawn(self._heartbeat(), "thin-beat")
        self._keepalive = self._spawn(self._keepalive_mic(), "thin-keepalive")

    async def stop(self, reason: str = "stop") -> None:
        """Request one atomic close and wait without letting caller cancellation abort it."""
        task = self._request_close(reason)
        if task is not None:
            await asyncio.shield(task)

    def _request_close(self, reason: str, *, error_kind: str | None = None) -> asyncio.Task | None:
        """Compare-and-set the sole close transaction for this conversation epoch."""
        if self._close_task is not None and not self._close_task.done():
            return self._close_task
        if not self._active:
            return None
        epoch = self._epoch
        self._close_task = self._spawn(
            self._close_transaction(epoch=epoch, reason=reason, error_kind=error_kind),
            f"thin-close-{reason}",
        )
        return self._close_task

    async def _close_transaction(
        self, *, epoch: float, reason: str, error_kind: str | None = None
    ) -> None:
        if not self._active or epoch != self._epoch:
            return
        self._ending_conversation = True
        self._trace_reason = reason
        self._trace_event("close_requested", reason=reason)
        _LOG.info("thin: closing conversation (%s) [room=%s]", reason, self.room)
        await self._silence_device()
        if error_kind is not None:
            self._trace_event("failure", kind=error_kind)
            if self.hub is not None:
                self.hub.activity(self.room, "⚠️ Fejl — lukker samtalen")
            # Red is a bounded, truthful error indication while the error is spoken.
            # Once teardown/rearm completes, IDLE must be dark; a persistent red ring
            # made a healthy rearmed puck look permanently wedged in the room.
            self._set_led(State.IDLE, error=True)
            await self._speak_error(error_kind)
        await self._teardown(release_music=True)
        if error_kind is not None:
            self._set_led(State.IDLE)
            self._hub_state("IDLE", None)
        else:
            self._hub_state("IDLE", "💤 Samtale slut — musikken er tilbage")

    async def _fail(self, kind: str) -> None:
        """Audible error joins the same exactly-once close transaction as every stop."""
        reason = f"error:{kind}"
        self._trace_reason = reason
        task = self._request_close(reason, error_kind=kind)
        if task is not None:
            await asyncio.shield(task)

    async def _teardown(self, *, release_music: bool) -> None:
        async with self._teardown_lock:
            await self._teardown_locked(release_music=release_music)

    async def _teardown_locked(self, *, release_music: bool) -> None:
        self._active = False
        self._speaking = False
        self._device_playing = False
        self._gate_until = 0.0
        self._gate_dropped = 0
        self._turn_had_tool = False
        self._speech_tools.clear()
        self._held_announce_pcm.clear()
        self._held_announce_item = None
        self._turn_cue_appended = False
        self._ending_conversation = False
        self._closure_turn = None
        self._last_user_utterance = ""
        self._reply_audible_until = 0.0
        self._direct = False  # the next reply re-decides its path from scratch
        self._heard_signal = False
        self.sm.state = State.IDLE
        # NEVER cancel the task that is RUNNING this teardown (stop()/_fail() are called
        # from inside the reader/heartbeat tasks). Cancelling self meant CancelledError
        # fired at the first real await below and the rest of the teardown was silently
        # skipped: brain never closed (leaked session), the duck heartbeat never
        # stopped (music stuck quiet forever) and the LED stayed solid cyan — the
        # "locked, solid blue, can't talk to it" field failure. The calling task ends
        # naturally right after this returns.
        cur = asyncio.current_task()
        for t in (
            self._reader,
            self._pump,
            self._beat,
            self._keepalive,
            self._barge_task,
            self._followup_task,
            self._goodbye,
        ):
            if t is not None and t is not cur and not t.done():
                t.cancel()
        self._reader = self._pump = self._beat = None
        self._barge_task = self._followup_task = None
        self._goodbye = None
        for t in self._tool_tasks.values():
            t.cancel()
        self._tool_tasks.clear()
        self._semantic_end_call_ids.clear()
        self._continue_turns.clear()
        self._wait_turns.clear()
        if self.reply_bus is not None:
            self.reply_bus.end(self.room)
        if hasattr(self.voicepe, "stop_streaming"):
            try:
                stream_stopped = await self.voicepe.stop_streaming()
                if stream_stopped is False:
                    self._device_stream_fault = True
                    _LOG.error("thin: Voice PE refused mic-forward stop [room=%s]", self.room)
                    self._trace_event("mic_stream_stop_failed")
                    if self.hub is not None:
                        self.hub.set_service("voicepe", "down")
            except Exception as exc:
                _LOG.warning("thin: mic-forward stop failed [room=%s]: %s", self.room, exc)
        if hasattr(self.voicepe, "drain_mic"):
            stale = self.voicepe.drain_mic()
            if stale:
                _LOG.info("thin: cleared %d mic frames after conversation close", stale)
        with contextlib.suppress(Exception):
            await self.brain.close()
        if release_music:
            with contextlib.suppress(Exception):
                await self.heartbeat.stop()
            try:
                await self.attention.release(self.room)
                if self.hub is not None:
                    self.hub.incr("attention_releases")
                    self.hub.set_level(self.room, 100)
            except (AttentionDown, Unsupervised, UnknownRoom):
                pass
            except Exception:
                pass
        self._set_led(State.IDLE)
        # Firmware keeps its detector task alive and single-uses a conversation latch.
        # Reopen that latch only after provider, mic, reply path and attention are all
        # closed; firmware performs a stop/start cycle only as an explicit recovery.
        # During add-on shutdown (_closing) leave the puck stopped; the next native API
        # connection starts it through the firmware's normal client-connected hook.
        if not self._closing and hasattr(self.voicepe, "rearm_wake_word"):
            try:
                await self._rearm_device()
            except Exception as exc:
                _LOG.warning("thin: wake-word rearm failed [room=%s]: %s", self.room, exc)
                self._schedule_rearm_retry()
        if self.audio_trace is not None:
            try:
                self.audio_trace.finish(self._trace_reason)
            except Exception as exc:
                # Diagnostics may never wedge the real assistant teardown.
                _LOG.warning("thin: could not save audio trace: %s", exc)
        self._stop_sent_t = None
        self._stop_sent_epoch = None

    # ------------------------------------------------------------- audio pumps
    async def _pump_mic(self) -> None:
        """Every mic frame goes to the model while the conversation is open — the
        server VAD owns turn-taking. Guarded: one audible failure, never a dead room.

        Logs the mic LEVEL every ~5 s of forwarded audio: "frames are flowing" says
        nothing about what's IN them (the 2026-07-06 field bug: the firmware channel
        carried bytes but no usable speech — 12 s of talking produced zero provider
        events, and nothing pointed at the dead channel)."""
        sent = 0
        level_acc = 0.0
        try:
            async for frame in self.voicepe.pcm_frames():
                if not self._active:
                    continue  # drain quietly; stream stop is in flight
                if self.audio_trace is not None:
                    self.audio_trace.audio("device", frame, C.INPUT_RATE)
                if not self.full_duplex and (
                    self._speaking
                    or self._device_playing
                    or time.monotonic() < self._gate_until
                    or time.monotonic() < self._reply_audible_until
                ):
                    # Echo shield (half-duplex): the device is speaking — its own voice
                    # must never reach the model's ears. In full_duplex the shield is
                    # OFF: the XMOS AEC + the conservative turn preset carry echo
                    # rejection, and talking over the reply is a real barge-in.
                    self._gate_dropped += 1
                    continue
                try:
                    await self.brain.send_audio(frame)
                except Exception as e:
                    _LOG.warning("thin: provider send failed (%s)", e)
                    await self._fail("connection")
                    return
                samples = array.array("h")
                samples.frombytes(frame[: len(frame) // 2 * 2])
                if samples:
                    level_acc += sum(abs(s) for s in samples) / len(samples)
                sent += 1
                if sent % 250 == 0:  # ~5 s of 20 ms frames
                    avg = level_acc / 250
                    level_acc = 0.0
                    if avg >= 30:
                        self._heard_signal = True  # this conversation has real audio
                    _LOG.info(
                        "thin: mic level ~%d (avg |sample| over 5s)%s",
                        int(avg),
                        ""
                        if self._heard_signal
                        else " — still no real signal this conversation (check mic channel/gain)",
                    )
        except asyncio.CancelledError:
            raise

    async def _read_events(self) -> None:
        try:
            async for ev in self.brain.events():
                await self._on_event(ev)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            _LOG.warning("thin: provider reader died (%s)", e)
            if self._active:
                await self._fail("connection")

    async def _keepalive_mic(self) -> None:
        """Re-assert the device mic-forward while the conversation is open. The
        firmware's dead-man timer FORCE-STOPS the forward after 25 s without a fresh
        start — without this keepalive the assistant literally went deaf 25 s into
        every conversation, and Whisper then hallucinated turns ("Tak.", "Skål!")
        from the silence that the model happily acted on (0.78/0.80 field bug)."""
        while self._active:
            await asyncio.sleep(C.STREAM_KEEPALIVE_S)
            if self._active and hasattr(self.voicepe, "start_streaming"):
                try:
                    stream_started = await self.voicepe.start_streaming()
                except Exception as exc:
                    _LOG.warning("thin: mic-forward keepalive failed: %s", exc)
                    stream_started = False
                if stream_started is False and self._active:
                    self._device_stream_fault = True
                    self._trace_event("mic_stream_keepalive_failed")
                    if self.hub is not None:
                        self.hub.set_service("voicepe", "down")
                    await self._fail("device")
                    return

    async def _heartbeat(self) -> None:
        """Pipeline heartbeat: while a conversation is open, the reader must be alive
        and the conversation younger than the provider's hard cap."""
        while True:
            await asyncio.sleep(HEARTBEAT_S)
            if not self._active:
                continue
            dead = (self._reader is None or self._reader.done()) or (
                self._pump is None or self._pump.done()
            )
            if dead:
                _LOG.warning("thin: audio pipeline died while active — failing over")
                await self._fail("connection")
                return
            # Silence starts when the ROOM goes quiet. While the device is still
            # playing, the family is listening, not ignoring us — and the moment the
            # reply ends we give them the FULL window to answer (playback end sets
            # _last_activity). Field 2026-08-07: it "stopped suddenly" mid-thought.
            quiet = time.monotonic() - self._last_activity
            # _speaking means "the model is generating" — generation finishes long
            # before the device stops PLAYING, so closing on it alone truncated long
            # replies mid-sentence. Use the device's own playback truth, bounded.
            playing = self._device_playing and (
                self._playback_t0 is None or time.monotonic() - self._playback_t0 < MAX_REPLY_PLAY_S
            )
            if self._active and not self._speaking and not playing and quiet > self.idle_timeout_s:
                _LOG.info("thin: client-side idle fallback (%.0fs quiet) — closing", quiet)
                await self.stop(reason="idle-fallback")
                return
            if time.monotonic() - self._conv_started > self.max_session_s:
                _LOG.info("thin: conversation hit the max duration — closing politely")
                await self.stop(reason="max_duration")
                return

    # ------------------------------------------------------------- provider events
    async def _on_event(self, ev) -> None:
        self._last_activity = time.monotonic()
        if isinstance(ev, AudioChunk):
            self._on_reply_audio(ev)
        elif isinstance(ev, Interrupted):
            self._trace_event("speech_started_or_interrupted")
            self._start_barge_debounce()
        elif isinstance(ev, UserSpeechStarted):
            current = self._closure_turn
            if current is not None and any(
                turn is current
                for _epoch, turn in (*self._wait_turns.values(), *self._continue_turns.values())
            ):
                # A genuine new utterance supersedes any still-pending lifecycle
                # decision. Its delayed completion remains bound to the old turn.
                self._begin_closure_turn()
            # The provider deliberately did NOT cancel its response. In the shipped
            # half-duplex contract, only an edge that crosses an active answer gate is
            # discarded. Ordinary first/follow-up speech must remain untouched.
            crossed_answer_gate = not self.full_duplex and (
                self._speaking
                or self._device_playing
                or time.monotonic() < self._gate_until
                or time.monotonic() < self._reply_audible_until
            )
            self._trace_event(
                "half_duplex_input_discarded" if crossed_answer_gate else "speech_started"
            )
            if crossed_answer_gate and hasattr(self.brain, "clear_input_audio"):
                # Dropping subsequent mic frames with the provider VAD still open
                # would leave it stuck forever in speech_started.
                self._spawn(self.brain.clear_input_audio(), "thin-clear-half-duplex-input")
        elif isinstance(ev, ToolRoundComplete):
            # OpenAI had to wait for the function-call response.done before it
            # could request the spoken result.  This edge separates those two
            # responses.  Keep the announce stream private/open, but make the next
            # TurnComplete publish the actual result answer.
            self._turn_had_tool = False
            self._continue_turns.clear()
            self._wait_turns.clear()  # mixed normal/end tool dominates any wait call
            _LOG.info("thin: tool decision complete — result answer is now pending")
        elif isinstance(ev, SilentToolComplete):
            for call_id in ev.call_ids:
                self._complete_continue_turn(call_id)
                self._complete_silent_wait_turn(call_id)
        elif isinstance(ev, TurnComplete):
            self._trace_event(
                "response_done",
                had_tool=self._turn_had_tool,
                status=ev.status,
                error=ev.error,
            )
            if ev.status != "completed":
                self._continue_turns.clear()
                self._wait_turns.clear()
                turn = self._ensure_closure_turn()
                _LOG.warning(
                    "thin: provider response ended status=%s error=%s [turn=%d]",
                    ev.status,
                    ev.error or "-",
                    turn.serial,
                )
                if turn.semantic_end and not turn.superseded:
                    # Realtime already made the semantic decision. A failed final
                    # response is a transport failure, not permission to reinterpret
                    # the user's words or pretend an inaudible farewell completed.
                    if not turn.fallback_started:
                        turn.fallback_started = True
                        self._spawn(
                            self._fallback_semantic_goodbye(turn, ev.status, self._epoch),
                            "thin-semantic-goodbye-fallback",
                        )
                    return
                if ev.status == "cancelled":
                    # A real interruption cancelled this response. It is not an error
                    # and must never close a still-active conversation.
                    self._discard_failed_response()
                    if self._active:
                        self._enter_followup()
                    return
                await self._fail("connection")
                return
            if self._turn_had_tool or self._speech_tools:
                # This response called a tool: the model will speak AGAIN after the
                # result. Keep the reply stream OPEN so filler + answer play as ONE
                # continuous announce (the gap is silence-filled) — ending it here made
                # the follow-up announce CUT the filler mid-word ("Lige et øjebl-").
                self._turn_had_tool = False
                _LOG.info("thin: tool decision complete — waiting for the result answer")
            else:
                had_reply = self._speaking
                turn = self._ensure_closure_turn()
                turn.response_done = True
                self._reconcile_closure(turn)
                if had_reply and self._active and not self._ending_conversation:
                    cue = audio_mod.turn_tone(C.OUTPUT_RATE)
                    if self._direct and self._direct_q is not None:
                        self._direct_q.put_nowait(cue)
                    elif self.reply_bus is not None:
                        self._held_announce_pcm.append(cue)
                    cue_s = len(cue) / (C.OUTPUT_RATE * C.SAMPLE_WIDTH)
                    self._reply_audible_until += cue_s
                    self._turn_cue_appended = True
                if self._direct:
                    self._end_direct_stream()
                elif self.reply_bus is not None:
                    self._publish_held_announce()
                self._flush_transcript("out")
                if self._active:
                    self._speaking = False
                    if self._device_playing:
                        # Generation is done, but the room is still HEARING the answer.
                        # Keep green until the device reports the last byte played.
                        self.sm.state = State.AI_SPEAKING
                    elif had_reply:
                        # ANNOUNCING can land just after TurnComplete. A short grace
                        # avoids the old cyan flash over the first spoken words; if the
                        # device never reports playback, this still fails open cleanly.
                        self._schedule_followup_edge()
                    else:
                        self._enter_followup()
        elif isinstance(ev, Idle):
            self._trace_event("provider_idle")
            await self.stop(reason="idle")
        elif isinstance(ev, ToolCall):
            self._trace_event("tool_call", name=ev.name, call_id=ev.id)
            if ev.name == WAIT_FOR_USER_TOOL:
                self._trace_event("wait_for_user_requested", call_id=ev.id)
                self._wait_turns[ev.id] = (self._epoch, self._ensure_closure_turn())
            if ev.name == CONTINUE_CONVERSATION_TOOL:
                self._trace_event("continue_conversation_requested", call_id=ev.id)
                self._continue_turns[ev.id] = (
                    self._epoch,
                    self._ensure_closure_turn(),
                )
            if ev.name == END_CONVERSATION_TOOL:
                if ev.id in self._semantic_end_call_ids:
                    _LOG.info("thin: duplicate semantic end call ignored [call_id=%s]", ev.id)
                    self._trace_event("semantic_end_duplicate", call_id=ev.id)
                    return
                self._semantic_end_call_ids.add(ev.id)
                turn = self._ensure_closure_turn()
                turn.semantic_end = True
                # The function-call response is not the audible farewell. Its tool
                # result creates one final response; only that following TurnComplete
                # may authorize playback-finish -> teardown.
                turn.response_done = False
                self._ending_conversation = True
                self._trace_event("semantic_end_requested", call_id=ev.id, turn=turn.serial)
                _LOG.info(
                    "thin: provider requested semantic conversation end [turn=%d]", turn.serial
                )
            if ev.name == CONTINUE_CONVERSATION_TOOL:
                # Its complete answer is deliberately in this same response. Keep both
                # PCM and transcript private until the provider proves the lifecycle
                # result was recorded and emits SilentToolComplete.
                pass
            elif not self._direct:
                await self._discard_tool_preamble()
                # History represents what the room heard. The preamble was truncated
                # at zero and must not survive as a fake spoken assistant turn.
                self._buf_out.clear()
            else:
                # Direct replies have already reached the DAC. Preserve transcripts.
                self._flush_transcript("out")
            self._turn_had_tool = True
            if self.hub is not None:
                self.hub.incr("tool_calls")
            self._speech_tools.add(ev.id)
            task = asyncio.create_task(self._run_tool(ev), name=f"thin-tool-{ev.id}")
            self._tool_tasks[ev.id] = task

            def _untrack(_t: asyncio.Task, _id: str = ev.id) -> None:
                self._speech_tools.discard(_id)
                self._tool_tasks.pop(_id, None)
                if not self._speech_tools:
                    # All function outputs for this response have reached the provider.
                    # This also covers the adversarial ordering where response.done
                    # arrived before a slow mixed normal-tool + semantic-end result.
                    self._turn_had_tool = False

            task.add_done_callback(_untrack)
        elif isinstance(ev, UserSpeechStopped):
            if self._closure_turn is None or self._closure_turn.response_done:
                self._begin_closure_turn()
            turn = self._ensure_closure_turn()
            if turn.user_finished_at is None:
                turn.user_finished_at = time.time()
            self._trace_event("speech_stopped")
            self._speech_stop_t = time.monotonic()  # the clock the family actually feels
            if self._active and not self._speaking and not self._device_playing:
                # You stopped talking and it is working: amber. Without this the ring
                # stayed cyan and the room could not tell "listening" from "thinking".
                self.sm.state = State.THINKING
                self._set_led(State.THINKING)
                self._hub_state("THINKING", None)
            self._cancel_barge_debounce()
        elif isinstance(ev, InputTranscript):
            self._trace_event("input_transcript", text=ev.text[:500])
            self._buf_in.append(ev.text)
            self._last_user_utterance = ev.text.strip()
            if self.hub is not None:
                self.hub.transcript_delta(self.room, "in", ev.text)
            # Realtime can make the semantic tool decision and even finish its
            # farewell before this separate diagnostic transcript arrives.  Persist
            # the user turn at the earlier speech-stop boundary so History shows the
            # causal conversation order rather than websocket delivery order.
            transcript_turn = self._closure_turn
            self._flush_transcript(
                "in",
                ts=(transcript_turn.user_finished_at if transcript_turn is not None else None),
            )  # OpenAI sends ONE completed utterance
        elif isinstance(ev, Usage):
            if self.usage is not None:
                model = getattr(self.brain, "model", "?") or "?"
                self.usage.add(model, ev, room=self.room)
        elif isinstance(ev, OutputTranscript):
            self._buf_out.append(ev.text)
            if self.hub is not None:
                self.hub.transcript_delta(self.room, "out", ev.text)

    def _begin_closure_turn(self) -> _ClosureTurn:
        previous = self._closure_turn
        if previous is not None and not previous.confirmed:
            previous.superseded = True
            for call_id, (_epoch, turn) in tuple(self._continue_turns.items()):
                if turn is previous:
                    self._continue_turns.pop(call_id, None)
            for call_id, (_epoch, turn) in tuple(self._wait_turns.items()):
                if turn is previous:
                    self._wait_turns.pop(call_id, None)
            if previous.semantic_end:
                # The user kept talking before the semantic end completed. Never let
                # the old response's delayed TurnComplete close this fresh turn.
                self._ending_conversation = False
                if self._goodbye is not None and not self._goodbye.done():
                    self._goodbye.cancel()
                    self._goodbye = None
                self._turn_had_tool = False
        self._closure_serial += 1
        self._playback_started.clear()
        self._playback_finished.clear()
        self._closure_turn = _ClosureTurn(self._closure_serial)
        return self._closure_turn

    def _ensure_closure_turn(self) -> _ClosureTurn:
        return self._closure_turn or self._begin_closure_turn()

    def _reconcile_closure(self, turn: _ClosureTurn) -> None:
        """Combine same-turn evidence independent of provider event ordering."""
        if turn is not self._closure_turn or turn.superseded or turn.confirmed:
            return
        if not turn.semantic_end:
            return
        if not turn.response_done:
            return
        turn.confirmed = True
        _LOG.info("thin: semantic conversation end confirmed [turn=%d]", turn.serial)
        self._trace_event("endphrase_confirmed", source="provider-semantic", turn=turn.serial)
        if self._active:
            self._arm_goodbye("thin-semantic-end-reconciled")

    def _discard_failed_response(self) -> None:
        """Forget provider output that never became a completed audible response."""
        self._held_announce_pcm.clear()
        self._held_announce_item = None
        self._buf_out.clear()
        self._speaking = False
        self._turn_had_tool = False
        self._reply_audible_until = 0.0
        self._turn_cue_appended = False
        self.playout.reset()

    async def _fallback_semantic_goodbye(
        self, turn: _ClosureTurn, provider_status: str, epoch: float
    ) -> None:
        """Speak a cached farewell after Realtime accepted end intent but audio failed.

        The provider still owns the *meaning*: this path is reachable only after its
        reserved semantic ``end_conversation`` signal. PodVoice owns the mechanical
        guarantee that the acknowledged close is heard and physically drained before
        the one close transaction rearms the wake word.
        """
        self._discard_failed_response()
        self._trace_event(
            "semantic_end_reply_failed",
            status=provider_status,
            turn=turn.serial,
        )
        pcm: bytes | None = None
        if self.speech is not None:
            with contextlib.suppress(Exception):
                pcm = self.speech.cached(C.FALLBACK_GOODBYE)
        if (
            not self._active
            or epoch != self._epoch
            or turn is not self._closure_turn
            or turn.superseded
        ):
            return
        if not pcm:
            _LOG.error("thin: cached semantic goodbye unavailable — closing safely")
            self._trace_event("semantic_end_fallback_unavailable", turn=turn.serial)
            self._request_close("model-close-fallback-missing")
            return

        _LOG.warning(
            "thin: using cached semantic goodbye after provider status=%s [turn=%d]",
            provider_status,
            turn.serial,
        )
        self._trace_event("semantic_end_fallback", source="cached-voice", turn=turn.serial)
        self._on_reply_audio(AudioChunk(pcm, item_id="local-semantic-goodbye"))
        self._buf_out.append(C.FALLBACK_GOODBYE)
        turn.response_done = True
        self._reconcile_closure(turn)
        if self._direct:
            self._end_direct_stream()
        elif self.reply_bus is not None:
            self._publish_held_announce()
        self._flush_transcript("out")
        self._speaking = False

    def _flush_transcript(self, direction: str, *, ts: float | None = None) -> None:
        buf = self._buf_in if direction == "in" else self._buf_out
        if buf:
            self._trace_event("transcript_complete", direction=direction, text="".join(buf)[:1000])
        if buf and self.hub is not None:
            self.hub.transcript(
                self.room,
                direction,
                "".join(buf),
                ts=ts,
                session=self._history_session or None,
            )
        buf.clear()

    def _use_direct(self) -> bool:
        """Is the direct PCM path available RIGHT NOW?

        "auto" asks the DEVICE (voicepe.supports_direct, read from the event types the
        firmware advertises at connect) instead of trusting a saved setting. That is the
        0.70 lesson made structural: a stray speaker_path="direct" against announce-only
        firmware produced total silence, and no setting can cause that any more."""
        if self.speaker_path == "announce":
            return False
        if not hasattr(self.voicepe, "begin_direct_reply"):
            return False
        if self.speaker_path == "direct":
            return True  # forced (sim/tests)
        return bool(getattr(self.voicepe, "supports_direct", False))

    def _on_reply_audio(self, ev: AudioChunk) -> None:
        direct = self._direct if self._speaking else self._use_direct()
        if not direct and (self.reply_bus is None or not self.reply_url):
            self._spawn(self.playback.play(ev.pcm), "thin-play")  # sim/console
            return
        first = not self._speaking
        if first:
            self._trace_event("response_audio_started", item_id=ev.item_id)
            self._speaking = True
            self._direct = direct
            self._turn_cue_appended = False
            # New reply: start its audible window from now (plus the announce lead-in).
            # On the direct path there is no announce round-trip to cover, but the window
            # is still armed here — _direct_send_loop replaces it with the exact figure
            # the moment the first byte actually goes out.
            self._reply_audible_until = time.monotonic() + ANNOUNCE_PREARM_S
            self.sm.state = State.AI_SPEAKING
            self.playout.reset()
            self._playback_t0 = None
            # NOTE: the LED goes green when sound actually STARTS — on the announce path
            # that is the device's ANNOUNCING edge, on the direct path it is our first
            # sent byte. Both land in _on_media_state(True). The ring must be
            # simultaneous with the ears, not with the network.
            self._hub_state("AI_SPEAKING", "💬 Svarer")
            if direct:
                self._direct_sent = 0
                self._direct_q = asyncio.Queue()
                self._direct_task = self._spawn(self._direct_send_loop(), "thin-direct")
            else:
                self._held_announce_pcm.clear()
                self._held_announce_item = ev.item_id
        if direct:
            if self._direct_q is not None:
                self._direct_q.put_nowait(ev.pcm)
        else:
            if not self._held_announce_pcm:
                self._held_announce_item = ev.item_id
            self._held_announce_pcm.append(ev.pcm)
        # Extend the shield by this chunk's REAL duration. The device's "I am playing"
        # report can be late or absent (field 16:42: mic level ~426 mid-reply -> the
        # model heard itself, barged in, and truncated its own answer at 0 ms). The
        # byte count cannot lie: 24 kHz, 16-bit mono.
        chunk_s = len(ev.pcm) / (C.OUTPUT_RATE * C.SAMPLE_WIDTH)
        base = max(time.monotonic(), self._reply_audible_until)
        self._reply_audible_until = base + chunk_s
        item = ev.item_id or self._last_item or "reply"
        self._last_item = item
        self.playout.on_sent(item, len(ev.pcm))

    async def _discard_tool_preamble(self) -> None:
        """Drop speech generated before a tool call on the buffered announce path.

        The thinking LED is the progress signal.  Keeping the filler in model memory
        while the room never heard it also corrupts conversational state, so truncate
        the audio item at zero just like an immediate physical interruption.
        """
        if not self._held_announce_pcm:
            return
        item = self._held_announce_item or self._last_item
        self._held_announce_pcm.clear()
        self._held_announce_item = None
        self.playout.reset()
        self._reply_audible_until = 0.0
        if item and hasattr(self.brain, "truncate"):
            with contextlib.suppress(Exception):
                await self.brain.truncate(item, 0)
        _LOG.info("thin: discarded pre-tool speech before it reached the room")

    def _publish_held_announce(self) -> None:
        """Atomically expose only the final, complete response to the HTTP/FLAC path."""
        if self.reply_bus is None or not self._held_announce_pcm:
            return
        self.reply_bus.clear(self.room)
        self.reply_bus.start(self.room)
        for pcm in self._held_announce_pcm:
            if self.audio_trace is not None:
                self.audio_trace.audio("speaker", pcm, C.OUTPUT_RATE)
            self.reply_bus.push(self.room, pcm)
        self._held_announce_pcm.clear()
        self._held_announce_item = None
        self.reply_bus.end(self.room)
        self._spawn(self._announce_with_retry(), "thin-announce")

    async def _direct_send_loop(self) -> None:
        """Pump the reply to the device as paced raw PCM, then wait for its own
        "last byte left the DAC" report.

        Pacing is mandatory, not cosmetic: the device's on_audio drops a WHOLE chunk
        when its 16 KB buffer would overflow, which loses words silently. We therefore
        never run more than DIRECT_LEAD_S ahead of real time.
        """
        q = self._direct_q
        if q is None:
            return
        bytes_per_s = float(C.OUTPUT_RATE * C.SAMPLE_WIDTH)
        if not await self.voicepe.begin_direct_reply():
            _LOG.warning("thin: direct path could not open — falling back to announce")
            await self._fallback_to_announce(q)
            return
        t0: float | None = None
        sent = 0
        try:
            while True:
                chunk = await q.get()
                if chunk is None:  # end of reply
                    break
                for i in range(0, len(chunk), DIRECT_CHUNK):
                    piece = chunk[i : i + DIRECT_CHUNK]
                    if t0 is None:
                        # The first byte IS the start of sound. Everything the announce
                        # path hangs off the ANNOUNCING edge (green ring, the
                        # speech-stop->audible metric, the playout clock) hangs off this.
                        t0 = time.monotonic()
                        self._on_media_state(True)
                    while True:
                        ahead = (sent / bytes_per_s) - (time.monotonic() - t0)
                        if ahead <= DIRECT_LEAD_S:
                            break
                        await asyncio.sleep(min(ahead - DIRECT_LEAD_S, 0.05))
                    self.voicepe.send_direct_pcm(piece)
                    if self.audio_trace is not None:
                        self.audio_trace.audio("speaker", piece, C.OUTPUT_RATE)
                    sent += len(piece)
                    self._direct_sent = sent
                    # EXACT, not estimated: every byte we have handed over is audible
                    # until t0 + sent/rate. No device report needed to keep the shield up.
                    self._reply_audible_until = t0 + (sent / bytes_per_s) + ECHO_GATE_TAIL_S
        except asyncio.CancelledError:
            # Do NOT try to close the stream from here. CancelledError derives from
            # BaseException, so a second cancellation lands straight through any
            # suppress(Exception) and the TTS_STREAM_END would be skipped — the device
            # would sit in STREAMING_RESPONSE, never reach RESPONSE_FINISHED, never fire
            # reply_played, and _device_playing would stay True forever: a permanently
            # deaf mic with nothing in the log. _cancel_direct() owns the close, from a
            # task that is not the one being cancelled.
            raise
        await self.voicepe.end_direct_reply()
        if t0 is not None:
            await self._await_reply_played(t0 + sent / bytes_per_s)

    async def _fallback_to_announce(self, q: asyncio.Queue[bytes | None]) -> None:
        """The direct path failed to open mid-reply: replay everything queued so far
        down the proven announce path rather than dropping the answer on the floor."""
        if self.reply_bus is None or not self.reply_url:
            return
        self._direct = False
        self.reply_bus.clear(self.room)
        self.reply_bus.start(self.room)
        while not q.empty():
            chunk = q.get_nowait()
            if chunk is not None:
                self.reply_bus.push(self.room, chunk)
        self._spawn(self._announce_with_retry(), "thin-announce")

    async def _await_reply_played(self, expected_end: float) -> None:
        """Wait for the device's byte-exact reply_played. If it never lands, release the
        shield on the computed end time instead of leaving the mic deaf forever.

        This is the whole point of 2b: reply_played is GROUND TRUTH, and the computed end
        is now only a watchdog against a lost packet — not, as in 1.8.0, the primary
        mechanism guessing at something it could not observe."""
        await asyncio.sleep(max(0.0, expected_end - time.monotonic()) + DIRECT_PLAYED_GRACE_S)
        if self._device_playing:
            _LOG.warning("thin: no reply_played from the device — releasing on the computed end")
            self._on_media_state(False)

    def _cancel_direct(self) -> None:
        """Stop the direct reply NOW (barge-in, hush, teardown).

        Closing the stream is done HERE, from a task that is not the one being
        cancelled — see the CancelledError note in _direct_send_loop. Whatever the
        device already buffered (at most DIRECT_LEAD_S) still plays out, so we also
        guarantee the shield comes down even if reply_played never arrives."""
        task, self._direct_task = self._direct_task, None
        self._direct_q = None
        if task is None:
            return
        if not task.done():
            task.cancel()
        self._spawn(self._close_direct_stream(), "thin-direct-close")

    async def _close_direct_stream(self) -> None:
        with contextlib.suppress(Exception):
            await self.voicepe.end_direct_reply()
        await asyncio.sleep(DIRECT_LEAD_S + DIRECT_PLAYED_GRACE_S)
        if self._device_playing:
            _LOG.warning("thin: no reply_played after a stop — releasing the shield")
            self._on_media_state(False)

    def _end_direct_stream(self) -> None:
        """Generation finished — tell the pump there is no more audio coming."""
        if self._direct_q is not None:
            with contextlib.suppress(Exception):
                self._direct_q.put_nowait(None)

    def _start_barge_debounce(self) -> None:
        """speech_started during a reply: wait BARGE_DEBOUNCE_S before silencing. A
        blip (cough/clatter/echo residue) produces speech_stopped inside the window
        and the reply keeps playing — the announce buffer already holds it, so a
        server-side generation cancel costs nothing audible. Sustained speech is a
        real barge-in."""
        if not (self._speaking or self._device_playing):
            # Nothing is audibly playing: this speech_started is the user's NORMAL
            # turn start, not an interruption. This guard is ALSO the spurious-idle
            # safety for the provider's now-unconditional Interrupted (ARKITEKTUR §5).
            if self._active:
                self._begin_closure_turn()
                self._cancel_followup_edge()
                self._turn_cue_appended = False
                self.sm.state = State.LISTENING
                self._set_led(State.LISTENING)
                self._hub_state("LISTENING", "🎙️ Lytter")
            return
        if self._barge_task is not None and not self._barge_task.done():
            return
        if self.hub is not None:
            self.hub.activity(self.room, "👂 Mulig afbrydelse — lytter efter")
        self._barge_task = self._spawn(self._barge_after_debounce(), "thin-barge")

    async def _barge_after_debounce(self) -> None:
        await asyncio.sleep(BARGE_DEBOUNCE_S)
        await self._on_interrupted()

    def _cancel_barge_debounce(self) -> None:
        """speech_stopped landed inside the window — false alarm, keep playing."""
        if self._barge_task is not None and not self._barge_task.done():
            self._barge_task.cancel()
            if self.hub is not None:
                self.hub.incr("false_barges")
                self.hub.activity(self.room, "😮‍💨 Falsk alarm — spiller videre")
        self._barge_task = None

    async def _on_interrupted(self) -> None:
        """The user talked over the reply: silence the device NOW and tell the server
        exactly how much was HEARD, so its memory matches the room's ears."""
        await self._silence_device()
        self._sync_playout()
        item = self.playout.current_item() or self._last_item
        if item and hasattr(self.brain, "truncate"):
            with contextlib.suppress(Exception):
                await self.brain.truncate(item, self.playout.heard_ms(item))
        self._buf_out.clear()  # the cancelled tail was never heard — don't persist it
        if self.hub is not None:
            self.hub.incr("barge_ins")
        if self._active:
            self._speaking = False
            self.sm.state = State.LISTENING
            self._set_led(State.LISTENING)
            self._hub_state("LISTENING", "✋ Afbrudt — lytter")

    async def _announce_with_retry(self, retry_after_s: float = 2.5) -> None:
        # Pre-arm the echo shield: sound can start before the ANNOUNCING state lands.
        self._gate_until = max(self._gate_until, time.monotonic() + ANNOUNCE_PREARM_S)
        can_track = hasattr(self.reply_bus, "fetch_count")
        before = self.reply_bus.fetch_count(self.room) if can_track else 0
        await self.voicepe.play_url(self.reply_url)
        if not can_track:
            return
        await asyncio.sleep(retry_after_s)
        if not self._active or not self._speaking:
            return  # conversation ended meanwhile — re-announcing would serve 0 bytes
        if self._speaking and self.reply_bus.fetch_count(self.room) == before:
            _LOG.warning("thin: device never fetched the reply — re-announcing")
            if self.hub is not None:
                self.hub.activity(self.room, "🔇 Enheden hentede ikke svaret — prøver igen")
            await self.voicepe.play_url(self.reply_url)

    async def _run_tool(self, tc: ToolCall) -> None:
        tool_started = time.monotonic()
        result: dict
        if tc.name == END_CONVERSATION_TOOL:
            result = {
                "ok": True,
                "data": {"decision": END_CONVERSATION_TOOL},
            }
        elif tc.name == CONTINUE_CONVERSATION_TOOL:
            result = {
                "ok": True,
                "data": {"decision": CONTINUE_CONVERSATION_TOOL},
            }
        elif tc.name == WAIT_FOR_USER_TOOL:
            result = {
                "ok": True,
                "data": {"decision": WAIT_FOR_USER_TOOL},
            }
        elif self.tools is None:
            result = {"ok": False, "error": "no tools configured"}
        else:
            result = await self.tools.dispatch(tc.name, tc.args)
        self._trace_event(
            "tool_result",
            name=tc.name,
            ok=bool(result.get("ok")),
            empty=bool(result.get("empty")),
            duration_ms=round((time.monotonic() - tool_started) * 1000),
        )
        if self.hub is not None:
            if not result.get("ok"):
                self.hub.incr("tool_error")
            elif result.get("empty"):
                self.hub.incr("tool_empty")
            else:
                self.hub.incr("tool_ok")
            self.hub.tool_call(self.room, tc.name, result, tc.args)
            self.hub.activity(
                self.room, f"🔧 {tc.name} {'✓' if result.get('ok') else '✕'}"
            )  # tool calls visible in the feed (room card AND the Talk tab)
        async with self._tool_lock:
            try:
                tool_result: dict[str, object] = {
                    "id": tc.id,
                    "name": tc.name,
                    "response": result,
                }
                if tc.name in (WAIT_FOR_USER_TOOL, CONTINUE_CONVERSATION_TOOL):
                    # A background/no-addressee decision has no assistant response.
                    # OpenAI records the function output but deliberately does not
                    # issue response.create, so silence cannot leak across turns.
                    tool_result["suppress_response"] = True
                silent_complete = await self.brain.send_tool_results([tool_result])
            except Exception as exc:
                _LOG.warning("thin: submitting %s result failed: %s", tc.name, exc)
                self._trace_event("tool_result_submit_failed", name=tc.name)
                if self._active:
                    self._request_close("error:connection", error_kind="connection")
                return
        if silent_complete is True:
            if tc.name == CONTINUE_CONVERSATION_TOOL:
                self._complete_continue_turn(tc.id)
            elif tc.name == WAIT_FOR_USER_TOOL:
                self._complete_silent_wait_turn(tc.id)

    def _complete_continue_turn(self, call_id: str) -> None:
        """Publish a direct answer whose explicit lifecycle decision was continue.

        Realtime may emit audio and a function call in the same response. The provider
        records the inert function output without creating a second response; this edge
        publishes the already-buffered answer and returns to the follow-up window.
        """
        bound = self._continue_turns.pop(call_id, None)
        if bound is None:
            return
        epoch, turn = bound
        if (
            not self._active
            or self._ending_conversation
            or epoch != self._epoch
            or turn is not self._closure_turn
            or turn.superseded
        ):
            self._trace_event("continue_conversation_stale", call_id=call_id)
            return
        had_reply = self._speaking
        turn.response_done = True
        self._turn_had_tool = False
        if had_reply:
            cue = audio_mod.turn_tone(C.OUTPUT_RATE)
            if self._direct and self._direct_q is not None:
                self._direct_q.put_nowait(cue)
            elif self.reply_bus is not None:
                self._held_announce_pcm.append(cue)
            cue_s = len(cue) / (C.OUTPUT_RATE * C.SAMPLE_WIDTH)
            self._reply_audible_until += cue_s
            self._turn_cue_appended = True
        if self._direct:
            self._end_direct_stream()
        elif self.reply_bus is not None:
            self._publish_held_announce()
        self._flush_transcript("out")
        self._trace_event(
            "continue_conversation_complete",
            turn=turn.serial,
            had_reply=had_reply,
        )
        self._speaking = False
        if self._device_playing:
            self.sm.state = State.AI_SPEAKING
        elif had_reply:
            self._schedule_followup_edge()
        else:
            # A required continue decision without its promised same-response audio is
            # a provider contract failure, not a successful empty assistant turn.
            self._trace_event("continue_conversation_missing_reply", turn=turn.serial)
            self._request_close("error:connection", error_kind="connection")

    def _complete_silent_wait_turn(self, call_id: str) -> None:
        """Finish a provider-proven pure wait round without speech or closure."""
        bound = self._wait_turns.pop(call_id, None)
        if bound is None:
            return
        epoch, turn = bound
        if (
            not self._active
            or self._ending_conversation
            or epoch != self._epoch
            or turn is not self._closure_turn
            or turn.superseded
        ):
            self._trace_event("wait_for_user_stale", call_id=call_id)
            return
        if self._direct:
            self._end_direct_stream()
        self._discard_failed_response()
        turn.response_done = True
        self._trace_event("wait_for_user_complete", turn=turn.serial)
        self._enter_followup()

    def _arm_goodbye(self, name: str) -> None:
        """Arm the close-after-goodbye for THIS conversation only (one at a time)."""
        if self._goodbye is not None and not self._goodbye.done():
            self._goodbye.cancel()
        self._goodbye = self._spawn(self._close_after_goodbye(epoch=self._epoch), name)

    async def _close_after_goodbye(self, max_wait_s: float = 6.0, epoch: float = 0.0) -> None:
        """Playback-finish is primary; this is only a bounded missing-edge fallback."""
        deadline = time.monotonic() + max_wait_s
        # Buffered announce can begin noticeably after response.done. Never infer
        # "already silent" from the gap before its ANNOUNCING edge (the old 500 ms
        # race closed the socket before a delayed goodbye began playing).
        await asyncio.sleep(ANNOUNCE_PREARM_S)
        if epoch and epoch != self._epoch:
            _LOG.info("thin: stale goodbye ignored — a new conversation is live")
            return
        if not self._active:
            return
        explicit_edges = bool(getattr(self.voicepe, "supports_playback_events", False))
        if explicit_edges:
            # The firmware contract promises a correlated start+drained-finish pair.
            # A slow HTTP fetch is not silence: wait for its real start rather than
            # truncating the goodbye at the old 1.5 s heuristic.
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(
                    self._playback_started.wait(), timeout=max(0.0, deadline - time.monotonic())
                )
            if not self._active:
                return
        if self._device_playing:
            # `_on_media_state(False)` owns the normal edge. Retain a hard ceiling for
            # firmware that reports ANNOUNCING but loses its matching finished state.
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(
                    self._playback_finished.wait(), timeout=max(0.0, deadline - time.monotonic())
                )
        if explicit_edges and self._playback_started.is_set() and self._playback_finished.is_set():
            # The physical finish handler already owns model-close. It schedules the
            # close transaction asynchronously, so this watchdog can wake one event-
            # loop tick earlier while `_active` is still true. That is success, not a
            # missing-edge fault (field trace 20260819T145100-102).
            return
        if epoch == self._epoch and self._active:
            if explicit_edges:
                self._trace_event("playback_fault", reason="missing-start-or-finish")
            self._request_close("model-close")

    # ------------------------------------------------------------- device signals
    def _on_wake_cb(self) -> None:
        # A genuine detector callback is the strongest available runtime proof. A
        # cold-boot recovery remains amber only until this first physical wake.
        if hasattr(self.voicepe, "wake_readiness"):
            self.voicepe.wake_readiness = "proven"
        self._rearm_retry_attempt = 0
        if self._rearm_retry_task is not None:
            self._rearm_retry_task.cancel()
            self._rearm_retry_task = None
        if self.hub is not None and self._voicepe_contract_ok():
            self.hub.set_service("voicepe", "up")
        _LOG.info(
            "thin: wake signal [room=%s] (active=%s muted=%s closing=%s speaking=%s)",
            self.room,
            self._active,
            self._muted,
            self._closing,
            self._speaking,
        )
        if self._active:
            if self._ending_conversation:
                # A confirmed Farvel is a terminal transport transition. Keeping this
                # wake inside the old socket recreates the observed "Okay Nabu" as an
                # ordinary follow-up. Teardown/rearm must finish first.
                _LOG.info("thin: wake ignored while confirmed goodbye is closing")
                return
            if self._goodbye is not None and not self._goodbye.done():
                self._goodbye.cancel()  # they kept talking — do not close on the old goodbye
                self._goodbye = None
            # Button press / habitual re-wake mid-conversation: silence any reply and
            # keep listening (the proven firmware can't distinguish the two sources).
            self._last_activity = time.monotonic()
            self._cancel_followup_edge()
            if self._speaking or self._device_playing:
                self._spawn(self._silence_device(), "thin-hush")
            else:
                self._turn_cue_appended = False
                self.sm.state = State.LISTENING
                self._set_led(State.LISTENING)
                self._hub_state("LISTENING", "👂 Vågnede igen — lytter")
            return
        self._spawn(self.wake(), "thin-wake")

    def _on_device_event(self, room: str, state: object) -> None:
        etype = getattr(state, "event_type", None) or getattr(state, "event", None)
        if etype in ("wake_okay_nabu", "wake"):
            self._on_wake_cb()
        elif etype in ("wake_stop", "single_press") and self._active:
            self._spawn(self.stop(reason="stop"), "thin-stop")
        elif etype == "reply_played":
            # GROUND TRUTH from the firmware: VA reached RESPONSE_FINISHED, which it only
            # does once speaker_buffer_size_ == 0 AND !has_buffered_data() AND
            # !is_running() — the last byte has physically left the DAC. This is the
            # signal 1.8.0 had to estimate. Route it into the same handler the announce
            # path uses, so LED, playout clock, reverb tail and metrics stay identical.
            if self._device_playing:
                self._on_media_state(False)
        elif etype == "podvoice_playback_fault":
            _LOG.error("thin: firmware could not prove the announcement speaker drained")
            self._trace_event("playback_fault", reason="announcement-drain-timeout")
            self._device_playing = False
            self._playback_finished.set()
            self._reply_audible_until = 0.0
            self._playback_t0 = None
            if self._active:
                self._spawn(self.stop(reason="playback-fault"), "thin-playback-fault")

    def _on_media_state(self, announcing: bool) -> None:
        """ANNOUNCING edge = playback ground truth: playout clock, the GREEN ring
        (simultaneous with actual sound), and the real speech-stop->audible metric."""
        if announcing:
            self._trace_event("playback_started")
            self._playback_started.set()
            self._playback_finished.clear()
            self._device_playing = True  # echo shield UP: the room hears the assistant
            self._playback_t0 = time.monotonic()
            if self._active:
                self._cancel_followup_edge()
                self.sm.state = State.AI_SPEAKING
                if not self._ending_conversation:
                    self._set_led(State.AI_SPEAKING)
                if self._speech_stop_t is not None:
                    ttfr_ms = (time.monotonic() - self._speech_stop_t) * 1000
                    self._speech_stop_t = None
                    _LOG.info(
                        "thin: speech-stop -> audible = %.0f ms [room=%s]", ttfr_ms, self.room
                    )
                    if self.hub is not None:
                        self.hub.set_latency(self.room, ttfr_ms)
        else:
            self._trace_event("playback_finished", turn_cue=self._turn_cue_appended)
            was_speaking = self._speaking
            # On buffered announce, generation has already completed before physical
            # playback starts, so `_speaking` is normally false.  Compare the elapsed
            # playout with generated bytes to distinguish a local wake/stop hush from
            # a natural media-player finish; otherwise the model remembers words the
            # family never heard.
            self._sync_playout()
            unheard_threshold = int(0.15 * C.OUTPUT_RATE * C.SAMPLE_WIDTH)
            was_hushed = (
                not self._direct
                and self._playback_t0 is not None
                and self.playout.buffered_bytes > unheard_threshold
            )
            self._device_playing = False
            self._playback_finished.set()
            # The device REPORTING "done" is better evidence than our byte estimate —
            # trust it and release the window. The estimate only carries the shield
            # when that report never arrives (field 16:42).
            self._reply_audible_until = 0.0
            self._last_activity = time.monotonic()  # the room just went quiet: your turn
            if (was_speaking or was_hushed) and self._active:
                # Playback stopped while the model still had more to say: the FIRMWARE
                # silenced it because a wake word ("Okay Nabu" / "stop") was heard over
                # the reply — the puck's built-in hush, on the echo-cancelled channel,
                # with the mic still gated. Tell the model exactly how much was HEARD,
                # or it will believe the family heard the whole answer.
                _LOG.info("thin: reply hushed on the device — truncating at heard position")
                self._spawn(self._truncate_at_heard(), "thin-hush-truncate")
            if self._stop_sent_t is not None and self._stop_sent_epoch == self._epoch:
                _LOG.info(
                    "stop-latency: %d ms (silence command -> device silent)",
                    int((time.monotonic() - self._stop_sent_t) * 1000),
                )
            self._stop_sent_t = None
            self._stop_sent_epoch = None
            tail_s = TURN_CUE_TAIL_S if self._turn_cue_appended else ECHO_GATE_TAIL_S
            self._gate_until = time.monotonic() + tail_s
            self._spawn(self._end_echo_gate(tail_s), "thin-gate-end")
            self._sync_playout()
            self._playback_t0 = None
            turn = self._closure_turn
            if self._active and self._ending_conversation and turn is not None and turn.confirmed:
                self._request_close("model-close")
                return
            if self._active and not self._speaking and not self._ending_conversation:
                self._enter_followup()

    async def _truncate_at_heard(self) -> None:
        """Tell the provider what the room ACTUALLY heard after a device-side hush."""
        self._sync_playout()
        item = self.playout.current_item() or self._last_item
        if item and hasattr(self.brain, "truncate"):
            with contextlib.suppress(Exception):
                await self.brain.truncate(item, self.playout.heard_ms(item))
        self._buf_out.clear()  # the unheard tail must not be persisted as spoken
        self._speaking = False
        if self._active:
            self.sm.state = State.LISTENING
            self._set_led(State.LISTENING)
            self._hub_state("LISTENING", "🤫 Stoppet — jeg lytter")
        if self.hub is not None:
            self.hub.incr("barge_ins")

    async def _end_echo_gate(self, tail_s: float = ECHO_GATE_TAIL_S) -> None:
        """After the reverb tail: drop what the mic queued during the reply and report
        how much the shield absorbed — the assistant literally cannot hear itself."""
        await asyncio.sleep(tail_s)
        if self._device_playing:
            return  # a new reply started inside the tail — the shield is still up
        stale = self.voicepe.drain_mic() if hasattr(self.voicepe, "drain_mic") else 0
        self._trace_event(
            "echo_gate_released",
            tail_ms=round(tail_s * 1000),
            dropped=self._gate_dropped,
            drained=stale,
        )
        if self._gate_dropped or stale:
            _LOG.info(
                "thin: echo shield absorbed %d mic frames during the reply (+%d drained)",
                self._gate_dropped,
                stale,
            )
        self._gate_dropped = 0

    def _trace_provider_audio(self, pcm: bytes, rate: int) -> None:
        if self.audio_trace is not None:
            self.audio_trace.audio("provider", pcm, rate)

    def _trace_event(self, event_name: str, **details) -> None:
        if self.hub is not None and hasattr(self.hub, "timeline"):
            at_ms = (
                round((time.monotonic() - self._conv_started) * 1000)
                if self._conv_started
                else None
            )
            self.hub.timeline(
                self.room,
                event_name,
                session=f"{self._epoch:.6f}" if self._epoch else None,
                at_ms=at_ms,
                **details,
            )
        if self.audio_trace is not None:
            self.audio_trace.event(event_name, **details)

    def _enter_followup(self) -> None:
        """The room is quiet again: dim ring, open mic, one clear next-turn state."""
        if not self._active or self._speaking or self._device_playing or self._ending_conversation:
            return
        self._cancel_followup_edge()
        self.sm.state = State.LOUNGE_WINDOW
        self._set_led(State.LOUNGE_WINDOW)
        activity = "🔉 Bip — din tur" if self._turn_cue_appended else "🎙️ Din tur"
        self._hub_state("LOUNGE_WINDOW", activity, turn_cue=self._turn_cue_appended)
        self._last_activity = time.monotonic()

    def _schedule_followup_edge(self) -> None:
        self._cancel_followup_edge()

        async def _after_grace() -> None:
            await asyncio.sleep(FOLLOWUP_EDGE_GRACE_S)
            self._followup_task = None
            self._enter_followup()

        self._followup_task = self._spawn(_after_grace(), "thin-followup-edge")

    def _cancel_followup_edge(self) -> None:
        task, self._followup_task = self._followup_task, None
        if task is not None and task is not asyncio.current_task() and not task.done():
            task.cancel()

    def _on_mute(self, muted: bool) -> None:
        if muted == self._muted:
            return
        self._muted = muted
        self._set_led(self.sm.state)
        if self.hub is not None:
            self.hub.activity(
                self.room, "🔇 Mikrofonen er slukket" if muted else "🎙️ Mikrofonen er tændt"
            )
        if muted and self._active:
            self._spawn(self.stop(reason="mute"), "thin-mute")

    def _on_link(self, up: bool) -> None:
        """TRUE device-link state -> panel dot + a plain activity line. Before this,
        the dot went green at STARTUP (loop started != device reached) — a DHCP'd-away
        device looked healthy while every 'Okay Nabu' died silently."""
        if self.hub is None:
            return
        self.hub.set_connected(self.room, up)
        readiness = getattr(self.voicepe, "wake_readiness", "unknown")
        if not up or readiness == "fault":
            service_state = "down"
        elif readiness == "recovered":
            service_state = "degraded"
        else:
            service_state = "up" if self._voicepe_contract_ok() else "degraded"
        self.hub.set_service("voicepe", service_state)
        if not up:
            self._spawn_link_warning()

    def _spawn_link_warning(self, delay_s: float = 20.0) -> None:
        """Warn about a lost device — but only if it STAYS lost, and with advice that
        actually fits.

        A reflash or a Wi-Fi blip drops the link for a few seconds and heals itself;
        shouting about it trains the family to ignore the feed. And the old text told
        them to use the .local name even when the host was deliberately an IP (because
        .local does not resolve inside the add-on container) — advice that was wrong."""
        host = str(getattr(self.voicepe, "host", ""))
        is_ip = host.replace(".", "").isdigit()

        async def _warn() -> None:
            await asyncio.sleep(delay_s)
            if self.hub is None:
                return
            link_up = getattr(self.voicepe, "_client", None) is not None
            if link_up and self.sm.state is not State.IDLE:
                return  # already back — say nothing
            self.hub.activity(
                self.room,
                "🔌 Voice PE har været væk i 20 sekunder — tjek at den har strøm"
                + (
                    f" og stadig svarer på {host}"
                    if is_ip
                    else " (eller skift til enhedens IP-adresse i Setup)"
                ),
            )

        self._spawn(_warn(), "thin-link-warn")

    def _on_contract(self, contract: dict) -> None:
        """Firmware-contract report from the link (every reconnect) -> panel.

        The service dot goes amber and the activity feed names EXACTLY what the
        flashed firmware is missing, so an add-on/firmware mismatch is diagnosed
        at a glance instead of surfacing as a mystery field-test failure."""
        if self.hub is None:
            return
        ok = bool(contract.get("ok", True))
        readiness = getattr(self.voicepe, "wake_readiness", "unknown")
        status = (
            "down"
            if readiness == "fault" or self._device_stream_fault
            else "up"
            if ok and readiness == "proven"
            else "degraded"
        )
        self.hub.set_service("voicepe", status)
        missing = (
            list(contract.get("missing_required", []))
            + [e for e in contract.get("missing_entities", []) if e == "media_player"]
            + list(contract.get("missing_capabilities", []))
        )
        if not ok and missing:
            self.hub.activity(
                self.room,
                "⚠️ Firmware-mismatch: mangler " + ", ".join(missing) + " — genflash Voice PE",
            )

    async def _reassert_device(self) -> None:
        if self._active:
            if hasattr(self.voicepe, "start_streaming"):
                if await self.voicepe.start_streaming() is False:
                    self._device_stream_fault = True
                    raise RuntimeError("Voice PE kunne ikke åbne mic-forward")
                self._device_stream_fault = False
        else:
            if hasattr(self.voicepe, "stop_streaming"):
                if await self.voicepe.stop_streaming() is False:
                    self._device_stream_fault = True
                    if self.hub is not None:
                        self.hub.set_service("voicepe", "down")
                    raise RuntimeError("Voice PE kunne ikke lukke mic-forward")
            # A reconnect/restart after a crashed conversation must also clear the
            # firmware latch; otherwise the puck can be online yet permanently deaf.
            if not self._closing and hasattr(self.voicepe, "rearm_wake_word"):
                try:
                    await self._rearm_device()
                except Exception as exc:
                    _LOG.warning("thin: reconnect rearm failed [room=%s]: %s", self.room, exc)
                    self._schedule_rearm_retry()
        self._set_led(self.sm.state)

    def _voicepe_contract_ok(self) -> bool:
        contract = getattr(self.voicepe, "contract", None)
        return not isinstance(contract, dict) or bool(contract.get("ok", True))

    async def _rearm_device(self) -> str:
        """Reopen the firmware latch without confusing recovery with proof."""
        outcome = await self.voicepe.rearm_wake_word()
        # Test doubles and legacy implementations predate the explicit outcome and
        # represent a successful proven rearm when they return None.
        readiness = outcome if outcome in ("proven", "recovered") else "proven"
        if hasattr(self.voicepe, "wake_readiness"):
            self.voicepe.wake_readiness = readiness
        self._rearm_retry_attempt = 0
        if readiness == "proven":
            self._trace_event("wake_rearmed")
            _LOG.info("thin: wake continuity proven [room=%s]", self.room)
            if self.hub is not None:
                status = (
                    "down"
                    if self._device_stream_fault
                    else "up"
                    if self._voicepe_contract_ok()
                    else "degraded"
                )
                self.hub.set_service("voicepe", status)
        else:
            self._trace_event("wake_rearm_recovered")
            _LOG.warning(
                "thin: wake detector recovered; awaiting first physical proof [room=%s]",
                self.room,
            )
            if self.hub is not None:
                self.hub.set_service("voicepe", "degraded")
                self.hub.activity(
                    self.room,
                    "🟡 Wake-motor genstartet — klar, men bekræftes ved næste 'Okay Nabu'",
                )
        return readiness

    def _schedule_rearm_retry(self) -> None:
        """Keep a failed detector recoverable without requiring another reboot."""
        if self._closing or (
            self._rearm_retry_task is not None and not self._rearm_retry_task.done()
        ):
            return
        if hasattr(self.voicepe, "wake_readiness"):
            self.voicepe.wake_readiness = "fault"
        if self.hub is not None:
            self.hub.set_service("voicepe", "down")

        async def _retry() -> None:
            delays = (1.0, 2.0, 5.0, 10.0, 30.0, 60.0)
            while not self._closing:
                delay = delays[min(self._rearm_retry_attempt, len(delays) - 1)]
                self._rearm_retry_attempt += 1
                await asyncio.sleep(delay)
                try:
                    await self._rearm_device()
                    return
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    _LOG.warning(
                        "thin: wake rearm retry %d failed [room=%s]: %s",
                        self._rearm_retry_attempt,
                        self.room,
                        exc,
                    )
                    if hasattr(self.voicepe, "wake_readiness"):
                        self.voicepe.wake_readiness = "fault"
                    if self.hub is not None:
                        self.hub.set_service("voicepe", "down")

        task = self._spawn(_retry(), "thin-rearm-retry")
        self._rearm_retry_task = task

        def _clear(done: asyncio.Task) -> None:
            if self._rearm_retry_task is done:
                self._rearm_retry_task = None

        task.add_done_callback(_clear)

    # ------------------------------------------------------------- helpers
    def _sync_playout(self) -> None:
        """How much of the reply the room has actually HEARD — this is what the model is
        told on a barge-in, so an error here rewrites its memory of the conversation.

        Announce path: wall time since playback started, and nothing better exists —
        the device holds the whole FLAC and never reports progress.
        Direct path: bounded by what we have actually HANDED OVER. We pace to real time,
        so wall clock and bytes agree to within DIRECT_LEAD_S, but the byte count is the
        hard ceiling: the model must never be told the family heard audio that was still
        sitting in our own queue."""
        if self._playback_t0 is None:
            return
        elapsed = time.monotonic() - self._playback_t0
        played = int(elapsed * C.OUTPUT_RATE * C.SAMPLE_WIDTH)
        if self._direct:
            played = min(played, self._direct_sent)
        self.playout.set_played(played)

    async def _silence_device(self) -> None:
        # A stop-latency measurement only belongs to audible output in THIS epoch.
        # Marking every teardown let the next conversation's playback-finish close an
        # old marker and produced impossible 12-22 second "stop latency" values.
        if self._device_playing or self._reply_audible_until > time.monotonic():
            self._stop_sent_t = time.monotonic()
            self._stop_sent_epoch = self._epoch
        else:
            self._stop_sent_t = None
            self._stop_sent_epoch = None
        self._reply_audible_until = 0.0  # nothing of ours is audible after a stop
        # Direct path: "stop" means stop SENDING (request_stop() is a no-op for the
        # speaker path — its whole STREAMING_RESPONSE branch is #ifdef USE_MEDIA_PLAYER
        # and media_player_ is nullptr here). Cancelling the pump also sends
        # TTS_STREAM_END, so the device drains at most DIRECT_LEAD_S and then reports
        # reply_played normally — the shield still releases on real evidence.
        self._cancel_direct()
        if self.reply_bus is not None:
            self.reply_bus.end(self.room)
        if hasattr(self.voicepe, "stop_playback"):
            with contextlib.suppress(Exception):
                await self.voicepe.stop_playback()
        self.playback.flush()

    async def _play_oneshot(self, pcm: bytes, *, wait_for_physical_finish: bool = False) -> bool:
        """Play one short fixed clip (close cue, error line, spoken warning) on whichever
        audio path is live.

        ONE emitter for every sound the add-on makes. When the cues had their own copy of
        the announce sequence, adding a path meant remembering to wire each of them —
        and the ones that were forgotten simply went silent with no error anywhere."""
        if self._use_direct():
            if not await self.voicepe.begin_direct_reply():
                return False
            bytes_per_s = float(C.OUTPUT_RATE * C.SAMPLE_WIDTH)
            for i in range(0, len(pcm), DIRECT_CHUNK):
                piece = pcm[i : i + DIRECT_CHUNK]
                self.voicepe.send_direct_pcm(piece)
                await asyncio.sleep(len(piece) / bytes_per_s)  # realtime pace: never floods
            await self.voicepe.end_direct_reply()
            return True
        if self.reply_bus is None or not self.reply_url:
            return False
        if wait_for_physical_finish:
            self._playback_started.clear()
            self._playback_finished.clear()
        self.reply_bus.clear(self.room)
        self.reply_bus.start(self.room)
        self.reply_bus.push(self.room, pcm)
        self.reply_bus.end(self.room)
        await self.voicepe.play_url(self.reply_url)
        if not wait_for_physical_finish:
            return True
        try:
            await asyncio.wait_for(
                self._playback_started.wait(), timeout=FIXED_PLAYBACK_START_TIMEOUT_S
            )
        except TimeoutError:
            _LOG.error("thin: fixed speech never reported physical playback start")
            self._trace_event("fixed_playback_start_missing")
            return False
        duration_s = len(pcm) / float(C.OUTPUT_RATE * C.SAMPLE_WIDTH)
        try:
            await asyncio.wait_for(
                self._playback_finished.wait(),
                timeout=max(FIXED_PLAYBACK_FINISH_GRACE_S, duration_s + 1.0),
            )
            return True
        except TimeoutError:
            _LOG.error("thin: fixed speech never reported physical playback finish")
            self._trace_event("fixed_playback_finish_missing")
            return False

    async def _speak_home_unreachable(self) -> None:
        """One spoken heads-up when the MCP probe says home control is down."""
        if self.speech is None:
            return
        with contextlib.suppress(Exception):
            await self._play_oneshot(await self.speech.say(C.FALLBACK_HOME_UNREACHABLE))

    async def _speak_error(self, kind: str) -> None:
        """Play the error before teardown; wait for firmware truth when supported."""
        from . import audio as audio_mod

        pcm = None
        if self.speech is not None:
            with contextlib.suppress(Exception):
                pcm = await self.speech.say(C.ERROR_PHRASES.get(kind, C.FALLBACK_CONNECTION))
        try:
            await self._play_oneshot(
                pcm or audio_mod.error_tone(C.OUTPUT_RATE),
                wait_for_physical_finish=bool(
                    getattr(self.voicepe, "supports_playback_events", False)
                ),
            )
        except Exception as exc:
            _LOG.warning("thin: error speech failed [room=%s]: %s", self.room, exc)

    def _set_led(self, state: State, *, error: bool = False) -> None:
        if not hasattr(self.voicepe, "set_light"):
            return
        cmd = led_command_for(state, muted=self._muted, error=error)
        self._trace_event(
            "led_command",
            state=state.name,
            on=cmd.on,
            brightness=cmd.brightness,
            rgb=",".join(str(value) for value in cmd.rgb),
            error=error,
        )
        self._spawn(self.voicepe.set_light(cmd.on, cmd.rgb, cmd.brightness), "thin-led")

    def _hub_state(self, name: str, activity: str | None, *, turn_cue: bool = False) -> None:
        if self.hub is None:
            return
        self.hub.set_state(self.room, name, turn_cue=turn_cue)
        if activity:
            self.hub.activity(self.room, activity)

    def _spawn(self, coro, name: str) -> asyncio.Task:
        task = asyncio.create_task(coro, name=f"{name}-{self.room}")
        self._tasks.append(task)
        task.add_done_callback(self._reap)
        return task

    def _reap(self, task: asyncio.Task) -> None:
        if task in self._tasks:
            self._tasks.remove(task)
        if not task.cancelled():
            exc = task.exception()
            if exc is not None:
                _LOG.warning("thin background task failed: %s", exc, exc_info=exc)
