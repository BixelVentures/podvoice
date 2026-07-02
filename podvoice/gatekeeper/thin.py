"""Track B — the THIN engine: the model owns the conversation (PLAN-BEAT-GEMINI.md).

One ``ThinSession`` per room. Our responsibilities shrink to exactly four things:
wake gate (privacy — the mic streams ONLY between wake and conversation end),
raw audio transport, the HA tool bridge, and ducking + LED. Everything the old
engine decided client-side — turn-taking, barge-in, "is the user done", polite
closure, follow-up windows — is delegated to the provider's server VAD
(GPT-Realtime-2: ``semantic_vad`` with ``interrupt_response`` + ``idle_timeout_ms``).

The state space collapses to three: IDLE (asleep, mic off) · ACTIVE (one open
conversation: listening and speaking interleave freely) · error (transient,
audible, always lands back in IDLE). No decision table — live signals drive
the few effects directly.

Playback truth: reply audio goes out via the proven announce path for now; the
playout clock approximates the heard position from the media player's ANNOUNCING
edge + wall time, and reports it to the server on barge-in via
``conversation.item.truncate`` — so the model's memory matches the ears in the
room. (The B1 direct speaker path upgrades this to byte-exact acks later.)
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time

from . import constants as C
from .events import Event, EventType, State
from .gemini import (
    AudioChunk,
    Idle,
    InputTranscript,
    Interrupted,
    OutputTranscript,
    ToolCall,
    ToolCallCancellation,
    TurnComplete,
)
from .led import led_command_for
from .playout import PlayoutClock
from .podconnect import AttentionDown, UnknownRoom, Unsupervised

_LOG = logging.getLogger("podvoice.thin")

# Server-side "the user went quiet, conversation is over" signal. Replaces the old
# client-side lounge window + listen-idle timers with one provider-owned number.
IDLE_TIMEOUT_MS = 8000
# Hard ceiling on one conversation (the provider caps sessions at 60 min; close cleanly
# well before so the family never hits a mid-sentence provider cut).
MAX_CONVERSATION_S = 20 * 60
# Pipeline heartbeat cadence (replaces the old per-turn watchdogs): if the provider
# reader has died while a conversation is open, say so and go home.
HEARTBEAT_S = 5.0


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
        gemini,
        voicepe,
        playback,
        tools=None,
        hub=None,
        speech=None,
        reply_bus=None,
        reply_url: str | None = None,
        duck_level: int = C.DUCK_LEVEL,
    ) -> None:
        self.room = room
        self.attention = attention
        self.heartbeat = heartbeat
        self.gemini = gemini
        self.voicepe = voicepe
        self.playback = playback  # sim/console fallback sink only
        self.tools = tools
        self.hub = hub
        self.speech = speech
        self.reply_bus = reply_bus
        self.reply_url = reply_url
        self.duck_level = duck_level

        self.sm = _Mini(self)
        self.playout = PlayoutClock()
        self._active = False  # one conversation open?
        self._speaking = False  # assistant audio currently announced/playing
        self._muted = False
        self._closing = False
        self._reader: asyncio.Task | None = None
        self._pump: asyncio.Task | None = None
        self._beat: asyncio.Task | None = None
        self._tasks: list[asyncio.Task] = []
        self._tool_lock = asyncio.Lock()
        self._tool_tasks: dict[str, asyncio.Task] = {}
        self._playback_t0: float | None = None  # monotonic when the device started playing
        self._last_item: str | None = None
        self._conv_started = 0.0
        self._buf_in: list[str] = []  # user transcript deltas (flushed per utterance)
        self._buf_out: list[str] = []  # assistant transcript deltas (flushed per turn)

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

    # ------------------------------------------------------------- lifecycle
    async def start(self) -> None:
        await self.voicepe.start()
        if self.hub is not None:
            self.hub.set_connected(self.room, True)
            self.hub.set_service("voicepe", "up")
        self.playback.start()

    async def aclose(self) -> None:
        self._closing = True
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
        if self._muted or self._active or self._closing:
            return
        self._active = True
        self._conv_started = time.monotonic()
        self.sm.state = State.LISTENING
        self._set_led(State.LISTENING)  # instantly — before the WS connect
        self._hub_state("LISTENING", "👋 Vågnede — samtalen er åben")
        # Duck for the WHOLE conversation (no per-turn pumping — one calm level).
        self.heartbeat.start(self.room, self.duck_level, C.TTL_LISTENING_MS)
        if self.hub is not None:
            self.hub.incr("sessions")
            self.hub.set_level(self.room, self.duck_level)
        if hasattr(self.voicepe, "abort_va"):
            await self.voicepe.abort_va()
        if hasattr(self.voicepe, "start_streaming"):
            await self.voicepe.start_streaming()
        try:
            await asyncio.wait_for(self.gemini.connect(), timeout=C.CONNECT_TIMEOUT_S)
        except Exception as e:
            _LOG.warning("thin: provider connect failed: %s", e)
            await self._fail("connection")
            return
        if self.reply_bus is not None:
            self.reply_bus.clear(self.room)
        self._reader = self._spawn(self._read_events(), "thin-reader")
        self._pump = self._spawn(self._pump_mic(), "thin-pump")
        self._beat = self._spawn(self._heartbeat(), "thin-beat")

    async def stop(self, reason: str = "stop") -> None:
        """Close the conversation NOW (stop word/button/panel/mute/idle)."""
        if not self._active:
            return
        _LOG.info("thin: closing conversation (%s) [room=%s]", reason, self.room)
        await self._silence_device()
        await self._teardown(release_music=True)
        self._hub_state("IDLE", "💤 Samtale slut — musikken er tilbage")

    async def _fail(self, kind: str) -> None:
        """Audible error -> clean IDLE. One sound, one activity line, no dead ends."""
        if self.hub is not None:
            self.hub.activity(self.room, "⚠️ Fejl — lukker samtalen")
        await self._silence_device()
        await self._speak_error(kind)
        await self._teardown(release_music=True)
        self._set_led(State.IDLE, error=True)
        self._hub_state("IDLE", None)

    async def _teardown(self, *, release_music: bool) -> None:
        self._active = False
        self._speaking = False
        self.sm.state = State.IDLE
        for t in (self._reader, self._pump, self._beat):
            if t is not None and not t.done():
                t.cancel()
        self._reader = self._pump = self._beat = None
        for t in self._tool_tasks.values():
            t.cancel()
        self._tool_tasks.clear()
        if self.reply_bus is not None:
            self.reply_bus.end(self.room)
        if hasattr(self.voicepe, "stop_streaming"):
            with contextlib.suppress(Exception):
                await self.voicepe.stop_streaming()
        with contextlib.suppress(Exception):
            await self.gemini.close()
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

    # ------------------------------------------------------------- audio pumps
    async def _pump_mic(self) -> None:
        """Every mic frame goes to the model while the conversation is open — the
        server VAD owns turn-taking. Guarded: one audible failure, never a dead room."""
        try:
            async for frame in self.voicepe.pcm_frames():
                if not self._active:
                    continue  # drain quietly; stream stop is in flight
                try:
                    await self.gemini.send_audio(frame)
                except Exception as e:
                    _LOG.warning("thin: provider send failed (%s)", e)
                    await self._fail("connection")
                    return
        except asyncio.CancelledError:
            raise

    async def _read_events(self) -> None:
        try:
            async for ev in self.gemini.events():
                await self._on_event(ev)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            _LOG.warning("thin: provider reader died (%s)", e)
            if self._active:
                await self._fail("connection")

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
            if time.monotonic() - self._conv_started > MAX_CONVERSATION_S:
                _LOG.info("thin: conversation hit the max duration — closing politely")
                await self.stop(reason="max_duration")
                return

    # ------------------------------------------------------------- provider events
    async def _on_event(self, ev) -> None:
        if isinstance(ev, AudioChunk):
            self._on_reply_audio(ev)
        elif isinstance(ev, Interrupted):
            await self._on_interrupted()
        elif isinstance(ev, TurnComplete):
            if self.reply_bus is not None:
                self.reply_bus.end(self.room)
            self._flush_transcript("out")
            # Conversation stays OPEN (continued conversation, free) — LED back to
            # "listening". The server's idle timeout decides when it's really over.
            if self._active:
                self._speaking = False
                self.sm.state = State.LISTENING
                self._set_led(State.LISTENING)
                self._hub_state("LISTENING", None)
        elif isinstance(ev, Idle):
            await self.stop(reason="idle")
        elif isinstance(ev, ToolCall):
            if self.hub is not None:
                self.hub.incr("tool_calls")
            task = asyncio.create_task(self._run_tool(ev), name=f"thin-tool-{ev.id}")
            self._tool_tasks[ev.id] = task

            def _untrack(_t: asyncio.Task, _id: str = ev.id) -> None:
                self._tool_tasks.pop(_id, None)

            task.add_done_callback(_untrack)
        elif isinstance(ev, ToolCallCancellation):
            for call_id in ev.ids:
                pending = self._tool_tasks.pop(call_id, None)
                if pending is not None and not pending.done():
                    pending.cancel()
        elif isinstance(ev, InputTranscript):
            self._buf_in.append(ev.text)
            if self.hub is not None:
                self.hub.transcript_delta(self.room, "in", ev.text)
            self._flush_transcript("in")  # OpenAI sends ONE completed utterance
        elif isinstance(ev, OutputTranscript):
            self._buf_out.append(ev.text)
            if self.hub is not None:
                self.hub.transcript_delta(self.room, "out", ev.text)

    def _flush_transcript(self, direction: str) -> None:
        buf = self._buf_in if direction == "in" else self._buf_out
        if buf and self.hub is not None:
            self.hub.transcript(self.room, direction, "".join(buf))
        buf.clear()

    def _on_reply_audio(self, ev: AudioChunk) -> None:
        if self.reply_bus is None or not self.reply_url:
            self._spawn(self.playback.play(ev.pcm), "thin-play")  # sim/console
            return
        first = not self._speaking
        if first:
            self._speaking = True
            self.sm.state = State.AI_SPEAKING
            self.playout.reset()
            self._playback_t0 = None
            self.reply_bus.start(self.room)
            self._set_led(State.AI_SPEAKING)
            self._hub_state("AI_SPEAKING", "💬 Svarer")
            self._spawn(self.voicepe.play_url(self.reply_url), "thin-announce")
        self.reply_bus.push(self.room, ev.pcm)
        item = ev.item_id or self._last_item or "reply"
        self._last_item = item
        self.playout.on_sent(item, len(ev.pcm))

    async def _on_interrupted(self) -> None:
        """The user talked over the reply: silence the device NOW and tell the server
        exactly how much was HEARD, so its memory matches the room's ears."""
        await self._silence_device()
        self._sync_playout()
        item = self.playout.current_item() or self._last_item
        if item and hasattr(self.gemini, "truncate"):
            with contextlib.suppress(Exception):
                await self.gemini.truncate(item, self.playout.heard_ms(item))
        self._buf_out.clear()  # the cancelled tail was never heard — don't persist it
        if self.hub is not None:
            self.hub.incr("barge_ins")
        if self._active:
            self._speaking = False
            self.sm.state = State.LISTENING
            self._set_led(State.LISTENING)
            self._hub_state("LISTENING", "✋ Afbrudt — lytter")

    async def _run_tool(self, tc: ToolCall) -> None:
        if self.tools is None:
            result: dict = {"ok": False, "error": "no tools configured"}
        else:
            result = await self.tools.dispatch(tc.name, tc.args)
        if self.hub is not None:
            self.hub.incr("tool_ok" if result.get("ok") else "tool_error")
        async with self._tool_lock:
            with contextlib.suppress(Exception):
                await self.gemini.send_tool_results(
                    [{"id": tc.id, "name": tc.name, "response": result}]
                )

    # ------------------------------------------------------------- device signals
    def _on_wake_cb(self) -> None:
        self._spawn(self.wake(), "thin-wake")

    def _on_device_event(self, room: str, state: object) -> None:
        etype = getattr(state, "event_type", None) or getattr(state, "event", None)
        if etype in ("wake_okay_nabu", "wake"):
            self._spawn(self.wake(), "thin-wake")
        elif etype in ("wake_stop", "single_press") and self._active:
            self._spawn(self.stop(reason="stop"), "thin-stop")

    def _on_media_state(self, announcing: bool) -> None:
        """ANNOUNCING edge = playback ground truth for the playout clock + green LED."""
        if announcing:
            self._playback_t0 = time.monotonic()
        else:
            self._sync_playout()
            self._playback_t0 = None

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

    async def _reassert_device(self) -> None:
        if self._active:
            if hasattr(self.voicepe, "start_streaming"):
                await self.voicepe.start_streaming()
        elif hasattr(self.voicepe, "stop_streaming"):
            await self.voicepe.stop_streaming()
        self._set_led(self.sm.state)

    # ------------------------------------------------------------- helpers
    def _sync_playout(self) -> None:
        """Advance the playout clock by wall time since playback started (announce
        path approximation; the B1 direct path replaces this with byte-exact acks)."""
        if self._playback_t0 is not None:
            elapsed = time.monotonic() - self._playback_t0
            self.playout.set_played(int(elapsed * C.GEMINI_OUTPUT_RATE * C.SAMPLE_WIDTH))

    async def _silence_device(self) -> None:
        if self.reply_bus is not None:
            self.reply_bus.end(self.room)
        if hasattr(self.voicepe, "stop_playback"):
            with contextlib.suppress(Exception):
                await self.voicepe.stop_playback()
        self.playback.flush()

    async def _speak_error(self, kind: str) -> None:
        """The error, out loud, in the assistant's own voice (tone as last resort)."""
        from . import audio as audio_mod

        pcm = None
        if self.speech is not None:
            with contextlib.suppress(Exception):
                pcm = await self.speech.say(C.ERROR_PHRASES.get(kind, C.FALLBACK_CONNECTION))
        if self.reply_bus is not None and self.reply_url:
            self.reply_bus.clear(self.room)
            self.reply_bus.start(self.room)
            self.reply_bus.push(self.room, pcm or audio_mod.error_tone(C.GEMINI_OUTPUT_RATE))
            self.reply_bus.end(self.room)
            with contextlib.suppress(Exception):
                await self.voicepe.play_url(self.reply_url)

    def _set_led(self, state: State, *, error: bool = False) -> None:
        if not hasattr(self.voicepe, "set_light"):
            return
        cmd = led_command_for(state, muted=self._muted, error=error)
        self._spawn(self.voicepe.set_light(cmd.on, cmd.rgb, cmd.brightness), "thin-led")

    def _hub_state(self, name: str, activity: str | None) -> None:
        if self.hub is None:
            return
        self.hub.set_state(self.room, name)
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
