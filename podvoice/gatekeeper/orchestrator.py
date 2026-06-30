"""Per-room orchestrator — wires every component to the state machine (PLAN.md §7).

A ``RoomSession`` owns one Voice PE, one Gemini session, the attention heartbeat,
the gatekeeper, playback, and the state machine. It implements the state
machine's ``Effects`` protocol (``apply``) and runs the audio-ingest and
Gemini-event loops, translating real-world signals into state-machine events.

The session is fully dependency-injected, so it runs against the test fakes
(FakeAttention / FakeVoicePELink / FakeGeminiSession) without any SDKs.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

from . import audio as audio_mod
from . import constants as C
from .events import Action, ActionKind, Event, EventType, State
from .gemini import (
    AudioChunk,
    GoAway,
    InputTranscript,
    Interrupted,
    OutputTranscript,
    ToolCall,
    TurnComplete,
)
from .led import led_command_for
from .podconnect import AttentionDown, UnknownRoom, Unsupervised
from .state import StateMachine
from .voice import UserSpeechStopped

_LOG = logging.getLogger("podvoice.orchestrator")


class RoomSession:
    def __init__(
        self,
        *,
        room: str,
        attention,
        heartbeat,
        gatekeeper,
        gemini,
        voicepe,
        playback,
        tools=None,
        watchdog=None,
        bargein=None,
        hub=None,
        reply_bus=None,  # ReplyBus for the media_player announce path (speaker-out)
        reply_url: str | None = None,  # the device-reachable /reply/<room>.wav URL
        lounge_window_s: int = C.LOUNGE_WINDOW_S,
        duck_level: int = C.DUCK_LEVEL,
        lounge_level: int = C.LOUNGE_LEVEL,
        vad_threshold: float = C.VAD_THRESHOLD,
        enable_watchdog: bool = True,
        full_duplex: bool = True,
    ) -> None:
        self.room = room
        self.attention = attention
        self.heartbeat = heartbeat
        self.gatekeeper = gatekeeper
        self.gemini = gemini
        self.voicepe = voicepe
        self.playback = playback
        self.tools = tools
        self.watchdog = watchdog
        self.bargein = bargein
        self.hub = hub
        self.reply_bus = reply_bus
        self.reply_url = reply_url
        self.duck_level = duck_level
        self.lounge_level = lounge_level
        self.lounge_window_s = lounge_window_s
        self.enable_watchdog = enable_watchdog and watchdog is not None

        if hub is not None:
            hub.register_room(room)

        # Observer drives the hub AND the LED ring (LED works even with no hub).
        self.sm = StateMachine(
            self,
            room=room,
            lounge_window_s=lounge_window_s,
            duck_level=duck_level,
            lounge_level=lounge_level,
            full_duplex=full_duplex,
            observer=self._on_transition,
        )
        self._lounge_vad = audio_mod.LoungeVAD(threshold=vad_threshold)
        self._lounge_vad_on = False
        self._lounge_timer: asyncio.Task | None = None
        self._listen_timer: asyncio.Task | None = None  # auto-close a stuck LISTENING session
        self._reader: asyncio.Task | None = None
        self._tasks: list[asyncio.Task] = []
        self._responded = False  # whether GEMINI_RESPONDING was posted this turn
        self._out_buf: list[str] = []  # AI transcript deltas, coalesced + flushed per turn
        self._in_buf: list[str] = []  # user transcript deltas, coalesced + flushed per turn
        self._keepalive_task: asyncio.Task | None = None  # re-asserts the device mic-forward
        self._muted = False  # device mute state (LED override)

        # Route device wake/button events into the state machine.
        if hasattr(voicepe, "on_event"):
            voicepe.on_event = self._on_device_event
        # Re-assert the device stream + LED for the current state on every reconnect.
        if hasattr(voicepe, "on_reconnect"):
            voicepe.on_reconnect = self._reassert_device
        # Wake word (via voice_assistant.start -> handle_start) -> WAKE_WORD event.
        if hasattr(voicepe, "on_wake"):
            voicepe.on_wake = self._on_wake

    def audio_health(self) -> dict | None:
        """Live S1 read: is the device streaming mic audio to THIS running session?

        Returns None if there's nothing to read (so the caller can fall back to a
        standalone probe). This avoids a competing diag subscription — PodVoice's
        room session already owns the single voice_assistant slot, so a separate
        run_s1 connection would be rejected and falsely report "no audio".
        """
        vp = self.voicepe
        if not hasattr(vp, "frames_in"):
            return None
        frames = vp.frames_in
        if frames <= 0:
            return {
                "ok": False,
                "frames": 0,
                "error": "Device reachable but no mic audio yet. Make sure it's NOT in "
                "HA Assist (PodVoice must own the mic), and that the firmware has "
                "podvoice_audio (Phase 1).",
            }
        age = max(0.0, asyncio.get_event_loop().time() - vp.last_audio_ts)
        return {
            "ok": age < 5.0,
            "frames": frames,
            "bytes": vp.bytes_in,
            "age_s": round(age, 1),
            "note": "live session is receiving gap-free device audio"
            if age < 5.0
            else f"audio stalled (last frame {age:.0f}s ago)",
        }

    # ------------------------------------------------------------------ lifecycle
    def _on_transition(self, old, new, event) -> None:
        if self.hub is not None:
            self.hub.set_state(self.room, new.name)
            if old.name == "IDLE" and new.name == "LISTENING":
                self.hub.incr("sessions")
        # The idle-close timer only guards LISTENING; cancel it the moment we leave
        # (model started responding, went to grace, or closed).
        if new is not State.LISTENING:
            self._cancel_listen_timer()
        # Repaint the LED ring for the new state (error events flash red first).
        is_err = event.type in (EventType.ERROR, EventType.WATCHDOG_TIMEOUT)
        self._paint_led(new, error=is_err)

    def _paint_led(self, state: State, *, error: bool = False) -> None:
        """Schedule a best-effort LED ring update (observer is sync; set_light is async).

        An error/watchdog event flashes red, then SETTLES to the real state colour a
        beat later. Without the settle, an error that transitions straight to IDLE
        paints led_command_for(IDLE, error=True) = red and — since IDLE is terminal and
        error overrides the idle=off colour — the ring stays stuck red forever."""
        if not hasattr(self.voicepe, "set_light"):
            return
        cmd = led_command_for(state, muted=self._muted, error=error)
        self._schedule_light(cmd.on, cmd.rgb, cmd.brightness)
        if error:
            self._schedule_task(self._settle_led())

    def _schedule_light(self, on: bool, rgb: tuple[float, float, float], brightness: float) -> None:
        self._schedule_task(self.voicepe.set_light(on, rgb, brightness))

    def _schedule_task(self, coro) -> None:
        task = asyncio.ensure_future(coro)
        self._tasks.append(task)
        task.add_done_callback(lambda t: self._tasks.remove(t) if t in self._tasks else None)

    async def _settle_led(self) -> None:
        """After an error flash, repaint the CURRENT live state without the error overlay
        so the ring can't get stuck red. Reads sm.state live, so a re-wake during the
        flash still wins (it settles to cyan, not back to off)."""
        await asyncio.sleep(1.2)
        cmd = led_command_for(self.sm.state, muted=self._muted, error=False)
        with contextlib.suppress(Exception):
            await self.voicepe.set_light(cmd.on, cmd.rgb, cmd.brightness)

    async def _reassert_device(self) -> None:
        """On (re)connect, match the device to the CURRENT state: stream + LED. Reading
        the live state (not a cached snapshot) avoids leaking audio after a reconnect."""
        active = self.sm.state in (State.LISTENING, State.AI_SPEAKING, State.LOUNGE_WINDOW)
        if active:
            await self.voicepe.start_streaming()
            self._start_keepalive()
        else:
            await self.voicepe.stop_streaming()
        self._paint_led(self.sm.state)

    def _start_keepalive(self) -> None:
        if self._keepalive_task is None or self._keepalive_task.done():
            self._keepalive_task = asyncio.create_task(
                self._keepalive_loop(), name=f"keepalive-{self.room}"
            )

    def _stop_keepalive(self) -> None:
        if self._keepalive_task is not None:
            self._keepalive_task.cancel()
            self._keepalive_task = None

    async def _keepalive_loop(self) -> None:
        """Re-assert the device mic-forward while a session is active so the device's
        dead-man safety timer never fires mid-conversation."""
        try:
            while True:
                await asyncio.sleep(C.STREAM_KEEPALIVE_S)
                with contextlib.suppress(Exception):
                    await self.voicepe.start_streaming()
        except asyncio.CancelledError:
            raise

    async def start(self) -> None:
        await self.voicepe.start()
        if self.hub is not None:
            self.hub.set_connected(self.room, True)
            self.hub.set_service("voicepe", "up")
        self.playback.start()
        self._tasks = [
            asyncio.create_task(self.sm.run(), name=f"sm-{self.room}"),
            asyncio.create_task(self._ingest(), name=f"ingest-{self.room}"),
        ]
        if self.enable_watchdog:
            self._tasks.append(asyncio.create_task(self._watchdog_loop(), name=f"wd-{self.room}"))

    async def aclose(self) -> None:
        self._cancel_lounge_timer()
        self._cancel_listen_timer()
        self._stop_keepalive()
        # Best-effort: stop the device mic-forward + turn the ring off so a dead add-on
        # never leaves the device streaming or the LED stuck mid-conversation.
        with contextlib.suppress(Exception):
            if hasattr(self.voicepe, "stop_streaming"):
                await self.voicepe.stop_streaming()
        with contextlib.suppress(Exception):
            if hasattr(self.voicepe, "set_light"):
                await self.voicepe.set_light(False, (0.0, 0.0, 0.0), 0.0)
        await self._stop_reader()
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await t
        self._tasks = []
        with contextlib.suppress(Exception):
            await self.heartbeat.stop()
        with contextlib.suppress(Exception):
            await self.attention.release(self.room)  # restore music on shutdown
        with contextlib.suppress(Exception):
            await self.playback.aclose()
        with contextlib.suppress(Exception):
            await self.gemini.close()
        with contextlib.suppress(Exception):
            await self.voicepe.aclose()

    # ------------------------------------------------------------------ Effects
    async def apply(self, action: Action, room: str | None) -> None:
        k = action.kind
        if k is ActionKind.OPEN_WS:
            await self.gemini.connect()
            self._start_reader()
            if self.hub is not None:
                self.hub.set_service("gemini", "up")
        elif k is ActionKind.CLOSE_WS:
            await self._stop_reader()
            if self.watchdog is not None:
                self.watchdog.disarm()
            with contextlib.suppress(Exception):
                await self.gemini.close()
        elif k is ActionKind.ENGAGE:
            await self._safe_attention(
                self.attention.engage(self.room, action.level, action.ttl_ms)
            )
        elif k is ActionKind.RELEASE:
            await self._safe_attention(self.attention.release(self.room))
            if self.hub is not None:
                self.hub.incr("attention_releases")
                self.hub.set_level(self.room, 100)
        elif k is ActionKind.HB_START:
            self.heartbeat.start(self.room, action.level, action.ttl_ms)
            if self.hub is not None:
                self.hub.incr("attention_engages")
                self.hub.set_level(self.room, action.level)
        elif k is ActionKind.HB_RETARGET:
            self.heartbeat.retarget(self.room, action.level, action.ttl_ms)
            if self.hub is not None:
                self.hub.incr("attention_engages")
                self.hub.set_level(self.room, action.level)
        elif k is ActionKind.HB_STOP:
            await self.heartbeat.stop()
        elif k is ActionKind.GATE_OPEN:
            self.gatekeeper.set_silence(False)
            self.gatekeeper.open()
            self._responded = False
            self._out_buf = []  # fresh turn — drop any stale transcript fragments
            self._in_buf = []
            self._start_listen_timer()  # never sit in LISTENING forever (wake-then-nothing)
            # NB: do NOT arm the TTFR watchdog here. Gate-open is the START of the
            # user's turn; arming now counts the user's own speaking time as model
            # latency and aborts every turn at WATCHDOG_MS. We arm at end-of-user-
            # speech instead (UserSpeechStopped, see _on_gemini_event).
        elif k is ActionKind.GATE_SHUT:
            self.gatekeeper.shut()
        elif k is ActionKind.GATE_MUTE:
            # While the AI speaks: shut the gate AND send silence (not real mic) so
            # echo/noise can't trip the provider VAD and self-interrupt the reply.
            self.gatekeeper.shut()
            self.gatekeeper.set_silence(True)
        elif k is ActionKind.PLAYBACK_ARM:
            self.playback.start()
            if self.reply_bus is not None and self.reply_url:
                self.reply_bus.start(self.room)  # fresh reply audio stream
                # Tell the device to fetch + play the reply URL (announce path).
                self._schedule_task(self.voicepe.play_url(self.reply_url))
        elif k is ActionKind.PLAYBACK_STOP:
            self.playback.flush()
            if self.reply_bus is not None:
                self.reply_bus.end(self.room)  # close the announce stream (barge-in / teardown)
        elif k is ActionKind.START_LOUNGE_TIMER:
            self._start_lounge_timer(action.timeout_s or self.lounge_window_s)
        elif k is ActionKind.CANCEL_LOUNGE_TIMER:
            self._cancel_lounge_timer()
        elif k is ActionKind.START_LOUNGE_VAD:
            self._lounge_vad.reset()
            self._lounge_vad_on = True
            self.gatekeeper.set_silence(True)  # shut gate now sends silence to keep WS warm
        elif k is ActionKind.STOP_LOUNGE_VAD:
            self._lounge_vad_on = False
            self.gatekeeper.set_silence(False)
        elif k is ActionKind.ERROR_TONE:
            await self.playback.play_tone(audio_mod.error_tone(C.GEMINI_OUTPUT_RATE))
        elif k is ActionKind.STREAM_START:
            # Wake opened the gate. First abort the stock voice_assistant turn the wake
            # triggered (so its turn-audio can't collide with podvoice_audio), THEN start
            # our continuous stream + keep the dead-man timer fresh.
            if hasattr(self.voicepe, "abort_va"):
                await self.voicepe.abort_va()
            if hasattr(self.voicepe, "start_streaming"):
                await self.voicepe.start_streaming()
            self._start_keepalive()
        elif k is ActionKind.STREAM_STOP:
            # Session ended (closure / grace expiry / error): stop the mic forward.
            self._stop_keepalive()
            if hasattr(self.voicepe, "stop_streaming"):
                await self.voicepe.stop_streaming()

    async def _safe_attention(self, coro) -> None:
        """Run an attention call best-effort: ducking degrades, never blocks."""
        try:
            await coro
            if self.hub is not None:
                self.hub.set_service("podconnect", "up")
        except (AttentionDown, Unsupervised):
            _LOG.warning("attention unavailable for room %s — continuing un-ducked", self.room)
            if self.hub is not None:
                self.hub.set_service("podconnect", "degraded")
        except UnknownRoom:
            _LOG.error("unknown PodConnect room %s (check the Voice-PE->room map)", self.room)
            if self.hub is not None:
                self.hub.set_service("podconnect", "degraded")

    # ------------------------------------------------------------------ ingest loop
    async def _ingest(self) -> None:
        async for frame in self.voicepe.pcm_frames():
            if self._lounge_vad_on and self._lounge_vad.feed(frame):
                self._lounge_vad_on = False
                await self.sm.post(Event(EventType.LOCAL_VOICE_DETECTED, self.room))
            await self.gatekeeper.offer(frame)

    # ------------------------------------------------------------------ gemini loop
    def _start_reader(self) -> None:
        if self._reader is not None and not self._reader.done():
            return
        self._reader = asyncio.create_task(self._read_gemini(), name=f"gemini-{self.room}")

    async def _stop_reader(self) -> None:
        if self._reader is not None and not self._reader.done():
            self._reader.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reader
        self._reader = None

    async def _read_gemini(self) -> None:
        try:
            async for ev in self.gemini.events():
                await self._on_gemini_event(ev)
        except asyncio.CancelledError:
            raise
        except Exception:
            _LOG.exception("gemini reader error for room %s", self.room)
            await self.sm.post(Event(EventType.ERROR, self.room))

    async def _on_gemini_event(self, ev) -> None:
        if isinstance(ev, AudioChunk):
            if not self._responded:
                self._responded = True
                await self.sm.post(Event(EventType.GEMINI_RESPONDING, self.room))
            if self.watchdog is not None:
                self.watchdog.on_output()
            if self.reply_bus is not None:
                self.reply_bus.push(self.room, ev.pcm)  # -> /reply WAV stream -> device speaker
            else:
                await self.playback.play(ev.pcm)  # sim/console fallback
        elif isinstance(ev, OutputTranscript):
            if self.watchdog is not None:
                self.watchdog.on_output()
            self._out_buf.append(ev.text)  # coalesce: flushed as one turn on TurnComplete
            if self.hub is not None:
                self.hub.transcript_delta(self.room, "out", ev.text)
        elif isinstance(ev, InputTranscript):
            if self.watchdog is not None:
                self.watchdog.on_output()
            self._in_buf.append(ev.text)  # coalesce: flushed as one turn on UserSpeechStopped
            self._start_listen_timer()  # the user is engaged — push the idle-close back
            if self.hub is not None:
                self.hub.transcript_delta(self.room, "in", ev.text)
            await self._maybe_barge_in(ev.text)
        elif isinstance(ev, ToolCall):
            if self.watchdog is not None:
                self.watchdog.on_output()  # a tool call IS the model's first response
            if self.hub is not None:
                self.hub.incr("tool_calls")
            await self._handle_tool(ev)
        elif isinstance(ev, TurnComplete):
            if self.reply_bus is not None:
                self.reply_bus.end(self.room)  # reply done -> close the announce WAV stream
            if self._out_buf and self.hub is not None:  # persist the whole reply as ONE turn
                self.hub.transcript(self.room, "out", "".join(self._out_buf))
            self._out_buf = []
            if self.watchdog is not None:
                self.watchdog.disarm()
                if self.hub is not None and self.watchdog.samples:
                    self.hub.set_latency(self.room, self.watchdog.samples[-1] * 1000)
            await self.sm.post(Event(EventType.GEMINI_TURN_COMPLETE, self.room))
        elif isinstance(ev, UserSpeechStopped):
            if self._in_buf and self.hub is not None:  # persist the whole utterance as ONE turn
                self.hub.transcript(self.room, "in", "".join(self._in_buf))
            self._in_buf = []
            # End of the user's turn: NOW the model owes us a reply within WATCHDOG_MS.
            # This is the correct arming point for the time-to-first-response watchdog.
            if self.watchdog is not None:
                self.watchdog.arm(self.room)
        elif isinstance(ev, Interrupted):
            self._out_buf = []  # the partial reply was cancelled — don't persist a fragment
            self.playback.flush()
            await self.sm.post(Event(EventType.GEMINI_INTERRUPTED, self.room))
        elif isinstance(ev, GoAway):
            # events() resumes the session transparently (make-before-break) and keeps
            # yielding on the SAME reader — so we must NOT reconnect/restart here, or we'd
            # double-connect. Just note it (and keep ducking; transport stays up).
            _LOG.info("Gemini go_away (%.1fs left) — auto-resuming", ev.time_left or 0.0)

    async def _maybe_barge_in(self, text: str) -> None:
        if self.bargein is None:
            return
        kind = self.bargein.classify_token(text)
        if kind and self.bargein.fire():
            if self.hub is not None:
                self.hub.incr("barge_ins")
            token = "stop" if kind == "hard" else "tak"
            await self.sm.post(Event(EventType.CLOSURE_TOKEN, self.room, {"kind": token}))

    async def _handle_tool(self, tc: ToolCall) -> None:
        if self.tools is None:
            result: dict = {"ok": False, "error_kind": "no_tools", "error": "no tools configured"}
        else:
            result = await self.tools.dispatch(tc.name, tc.args)
        if self.hub is not None:  # distinguish the outcomes (ok / empty / error) on Status
            if not result.get("ok"):
                self.hub.incr("tool_error")
            elif result.get("empty"):
                self.hub.incr("tool_empty")
            else:
                self.hub.incr("tool_ok")
        await self.gemini.send_tool_results([{"id": tc.id, "name": tc.name, "response": result}])

    # ------------------------------------------------------------------ device events
    def _on_wake(self) -> None:
        """Device wake (handle_start) -> drive a WAKE_WORD into the state machine."""
        asyncio.create_task(self.sm.post(Event(EventType.WAKE_WORD, self.room)))  # noqa: RUF006

    def _on_device_event(self, room: str, state: object) -> None:
        # VERIFY: ESPHome event-entity state shape (event_type attribute name).
        etype = getattr(state, "event_type", None) or getattr(state, "event", None)
        if etype is None:
            return
        if etype in ("wake_okay_nabu", "wake"):
            ev = Event(EventType.WAKE_WORD, room)
        elif etype == "single_press":
            ev = Event(EventType.BUTTON_PRESS, room)
        elif etype == "wake_stop":
            ev = Event(EventType.CLOSURE_TOKEN, room, {"kind": "stop"})
        else:
            _LOG.debug("ignoring device event_type=%r for room %s", etype, room)
            return
        asyncio.create_task(self.sm.post(ev))  # noqa: RUF006

    # ------------------------------------------------------------------ timers / watchdog
    def _start_lounge_timer(self, timeout_s: float) -> None:
        self._cancel_lounge_timer()
        self._lounge_timer = asyncio.create_task(
            self._lounge_timeout(timeout_s), name=f"lounge-{self.room}"
        )

    def _cancel_lounge_timer(self) -> None:
        if self._lounge_timer is not None and not self._lounge_timer.done():
            self._lounge_timer.cancel()
        self._lounge_timer = None

    async def _lounge_timeout(self, timeout_s: float) -> None:
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.sleep(timeout_s)
            await self.sm.post(Event(EventType.LOUNGE_TIMEOUT, self.room))

    def _start_listen_timer(self) -> None:
        """(Re)arm the idle-close timer for the LISTENING state."""
        self._cancel_listen_timer()
        self._listen_timer = asyncio.create_task(
            self._listen_timeout(), name=f"listen-{self.room}"
        )

    def _cancel_listen_timer(self) -> None:
        if self._listen_timer is not None and not self._listen_timer.done():
            self._listen_timer.cancel()
        self._listen_timer = None

    async def _listen_timeout(self) -> None:
        """If LISTENING goes quiet for LISTEN_IDLE_S (wake-then-nothing, or a wedged
        turn), close the session cleanly so it can't stay listening + ducking forever."""
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.sleep(C.LISTEN_IDLE_S)
            _LOG.info("listen idle-timeout for room %s — closing session", self.room)
            await self.sm.post(Event(EventType.CLOSURE_TOKEN, self.room, {"kind": "idle"}))

    async def _watchdog_loop(self, interval: float = 0.05) -> None:
        while True:
            await asyncio.sleep(interval)
            reason = self.watchdog.check()
            if reason:
                _LOG.warning("watchdog %s for room %s", reason, self.room)
                if self.hub is not None:
                    self.hub.incr("watchdog_aborts")
                self.watchdog.disarm()
                await self.sm.post(Event(EventType.WATCHDOG_TIMEOUT, self.room))
