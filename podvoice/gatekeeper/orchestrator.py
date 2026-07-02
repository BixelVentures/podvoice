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
    ToolCallCancellation,
    TurnComplete,
)
from .led import led_command_for
from .podconnect import AttentionDown, UnknownRoom, Unsupervised
from .state import StateMachine
from .voice import UserSpeechStopped

# Extra playback margin after the reply's estimated duration before we declare the
# turn "done" (device fetch + decode + mixer latency). See _on_gemini_event/TurnComplete.
PLAYBACK_TAIL_S = 0.5

_LOG = logging.getLogger("podvoice.orchestrator")

# Friendly per-state lines for the panel's live activity feed.
_ACTIVITY_LABELS = {
    "LISTENING": "🎙️ Listening to you",
    "THINKING": "🤔 Thinking…",
    "AI_SPEAKING": "💬 Assistant replying",
    "LOUNGE_WINDOW": "⏳ Follow-up window (grace)",
    "IDLE": "💤 Idle — waiting for “Okay Nabu” (music restored)",
}


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
        reply_url: str | None = None,  # the device-reachable /reply/<room>.flac URL
        reply_streaming: bool = False,  # reply FLAC streams live (no post-generation playback lag)
        speaker_path: str = "announce",  # "announce" (HTTP/FLAC via media_player, proven) |
        # "direct" (raw PCM down the native API into the VA speaker — 0.67 firmware)
        lounge_window_s: int = C.LOUNGE_WINDOW_S,
        duck_level: int = C.DUCK_LEVEL,
        lounge_level: int = C.LOUNGE_LEVEL,
        vad_threshold: float = C.VAD_THRESHOLD,
        enable_watchdog: bool = True,
        full_duplex: bool = False,  # default half-duplex (continued conversation)
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
        self.reply_streaming = reply_streaming
        self.speaker_path = speaker_path
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
        self._responded = False  # whether MODEL_RESPONDING was posted this turn
        self._out_buf: list[str] = []  # AI transcript deltas, coalesced + flushed per turn
        self._in_buf: list[str] = []  # user transcript deltas, coalesced + flushed per turn
        self._keepalive_task: asyncio.Task | None = None  # re-asserts the device mic-forward
        self._muted = False  # device mute state (LED override)
        self._turn_done_timer: asyncio.Task | None = None  # delayed MODEL_TURN_COMPLETE (playback)
        self._closing = False  # aclose() in progress — suppress task-restart callbacks
        self._ingest_error_posted = False  # one ERROR per failure episode, not per frame
        self._tool_lock = asyncio.Lock()  # serialize tool-result sends (dispatches run async)
        self._tool_tasks: dict[str, asyncio.Task] = {}  # in-flight dispatches by call id
        self._direct_sender: asyncio.Task | None = None  # direct-path reply pump (0.67)
        self._preroll_armed = False  # replay the mic run-up ONLY on a cold wake (see below)

        # Route device wake/button events into the state machine.
        if hasattr(voicepe, "on_event"):
            voicepe.on_event = self._on_device_event
        # Device media-player state -> ground truth for "the reply finished PLAYING".
        if hasattr(voicepe, "on_media_state"):
            voicepe.on_media_state = self._on_media_announcing
        # Hardware mute switch -> red ring + close any live session (family-visible truth).
        if hasattr(voicepe, "on_mute"):
            voicepe.on_mute = self._on_mute
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
                self.hub.activity(self.room, "👋 Woke up — listening")
            elif event.type in (EventType.ERROR, EventType.WATCHDOG_TIMEOUT):
                self.hub.activity(self.room, "⚠️ Error / timeout — closing")
            elif new.name in _ACTIVITY_LABELS and new is not old:
                self.hub.activity(self.room, _ACTIVITY_LABELS[new.name])
        # The idle-close timer only guards LISTENING; cancel it the moment we leave
        # (model started responding, went to grace, or closed).
        if new is not State.LISTENING:
            self._cancel_listen_timer()
        # Disarm the on-device "stop" wake model whenever a reply ends, however it ends
        # (armed in PLAYBACK_ARM; the enable/disable services are idempotent).
        if old is State.AI_SPEAKING and new is not State.AI_SPEAKING:
            if hasattr(self.voicepe, "set_stop_word"):
                self._schedule_task(self.voicepe.set_stop_word(False))
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
        task.add_done_callback(self._reap_task)

    def _reap_task(self, task: asyncio.Task) -> None:
        """Untrack a finished background task AND surface its exception — a swallowed raise
        in a scheduled LED/attention/reply coro is otherwise invisible (impossible to
        debug remotely for a non-technical owner)."""
        if task in self._tasks:
            self._tasks.remove(task)
        if not task.cancelled():
            exc = task.exception()
            if exc is not None:
                _LOG.warning("background task failed: %s", exc, exc_info=exc)

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
            self._spawn_ingest(),
        ]
        if self.enable_watchdog:
            self._tasks.append(asyncio.create_task(self._watchdog_loop(), name=f"wd-{self.room}"))

    def _spawn_ingest(self) -> asyncio.Task:
        """Start the mic-ingest loop WITH a death watch. The old bare task meant any
        uncaught exception killed the room's hearing permanently and silently — the
        single riskiest failure in the codebase (0.66 audit C1)."""
        task = asyncio.create_task(self._ingest(), name=f"ingest-{self.room}")
        task.add_done_callback(self._ingest_died)
        return task

    def _ingest_died(self, task: asyncio.Task) -> None:
        if task in self._tasks:
            self._tasks.remove(task)
        if self._closing or task.cancelled():
            return
        exc = task.exception()
        _LOG.error("mic ingest died for room %s (%s) — RESTARTING", self.room, exc)
        if self.hub is not None:
            self.hub.activity(self.room, "🎤 Mikrofon-flowet genstartede efter en fejl")
        self._tasks.append(self._spawn_ingest())

    async def aclose(self) -> None:
        self._closing = True  # suppress the ingest death-watch restart
        self._cancel_lounge_timer()
        self._cancel_listen_timer()
        self._cancel_turn_done_timer()
        self._cancel_direct_sender()
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
            # Bound the connect: a hung TLS handshake on the WAKE path would otherwise wedge
            # the session with no recovery (the watchdog isn't armed until end-of-speech).
            try:
                await asyncio.wait_for(self.gemini.connect(), timeout=C.CONNECT_TIMEOUT_S)
            except Exception as e:  # timeout or connect error
                _LOG.warning("provider connect failed/timed out: %s", e)
                if self.hub is not None:
                    self.hub.set_service("gemini", "down")
                    self.hub.activity(self.room, "⚠️ Kunne ikke nå assistenten")
                await self.sm.post(Event(EventType.ERROR, self.room))
                return
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
            # Fire-and-forget: the heartbeat holds the duck authoritatively, so a slow duck
            # POST must not stall the state-machine apply loop (blocks every transition).
            self._schedule_task(
                self._safe_attention(self.attention.engage(self.room, action.level, action.ttl_ms))
            )
        elif k is ActionKind.RELEASE:
            self._schedule_task(self._safe_attention(self.attention.release(self.room)))
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
            self._ingest_error_posted = False  # new turn — a fresh failure may speak again
            # Replay the buffered run-up ONLY on a cold wake (the ~1s gap between the cyan
            # ring and the provider WS connect). On a lounge re-open the WS is already up
            # (no gap) AND the buffer may hold the tail/echo of the reply just spoken —
            # replaying it there fed the model its own voice as your words, which is what
            # produced the garbage "you" turns (0.66/0.68 field regression). Plain open.
            if self._preroll_armed and hasattr(self.gatekeeper, "open_with_preroll"):
                await self.gatekeeper.open_with_preroll()
            else:
                self.gatekeeper.open()
            self._preroll_armed = False
            self._responded = False
            self._out_buf = []  # fresh turn — drop any stale transcript fragments
            self._in_buf = []
            if self.reply_bus is not None:
                # Drop stale reply audio NOW (turn start), before this turn's reply can
                # arrive — so PLAYBACK_ARM's start() no longer races the front-loaded audio.
                self.reply_bus.clear(self.room)
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
                if self.speaker_path == "direct" and hasattr(self.voicepe, "begin_direct_reply"):
                    # 0.67: pump raw PCM straight down the native API (no HTTP/FLAC).
                    self._start_direct_sender()
                else:
                    # Tell the device to fetch + play the reply URL (announce path) —
                    # and verify it actually fetched, re-announcing once if not.
                    self._schedule_task(self._announce_with_retry())
                if self.hub is not None:
                    self.hub.activity(self.room, "🔊 Playing reply on the speaker")
                # Arm the on-device "stop" wake model for the duration of the reply
                # (0.67 firmware): saying "stop" now interrupts even while it talks.
                if hasattr(self.voicepe, "set_stop_word"):
                    self._schedule_task(self.voicepe.set_stop_word(True))
        elif k is ActionKind.PLAYBACK_STOP:
            self.playback.flush()
            self._cancel_turn_done_timer()  # the turn is over NOW (stop / barge-in / error)
            self._cancel_direct_sender()
            if self.reply_bus is not None:
                self.reply_bus.end(self.room)  # close the announce stream (barge-in / teardown)
            if self.speaker_path == "direct" and hasattr(self.voicepe, "abort_va"):
                # Direct path: voice_assistant.stop tears the speaker stream instantly.
                with contextlib.suppress(Exception):
                    await self.voicepe.abort_va()
            # The device may also hold a fetched announce reply — send a real media_player
            # STOP at the announcement. Inline (not scheduled): the ERROR_TONE announce
            # that can follow in the same action list must hit the wire AFTER this stop.
            if hasattr(self.voicepe, "stop_playback"):
                with contextlib.suppress(Exception):
                    await self.voicepe.stop_playback()
            if hasattr(self.voicepe, "set_stop_word"):
                self._schedule_task(self.voicepe.set_stop_word(False))
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
            await self._play_error_audible(action.reason or "connection")
        elif k is ActionKind.STREAM_START:
            # Wake opened the gate. First abort the stock voice_assistant turn the wake
            # triggered (so its turn-audio can't collide with podvoice_audio), THEN start
            # our continuous stream + keep the dead-man timer fresh.
            _LOG.info("stream start [room=%s] — abort_va + start_streaming", self.room)
            if self.hub is not None:
                self.hub.activity(self.room, "📡 Mic stream started")
            if hasattr(self.voicepe, "abort_va"):
                await self.voicepe.abort_va()
            if hasattr(self.voicepe, "start_streaming"):
                await self.voicepe.start_streaming()
            self._start_keepalive()
        elif k is ActionKind.STREAM_STOP:
            # Session ended (closure / grace expiry / error): stop the mic forward.
            self._stop_keepalive()
            if hasattr(self.gatekeeper, "clear_preroll"):
                self.gatekeeper.clear_preroll()  # never leak run-up audio across sessions
            if hasattr(self.voicepe, "stop_streaming"):
                await self.voicepe.stop_streaming()

    # ------------------------------------------------------------------ direct path (0.67)
    def _start_direct_sender(self) -> None:
        self._cancel_direct_sender()
        self._direct_sender = asyncio.create_task(
            self._direct_send_loop(), name=f"direct-{self.room}"
        )

    def _cancel_direct_sender(self) -> None:
        if self._direct_sender is not None and not self._direct_sender.done():
            self._direct_sender.cancel()
        self._direct_sender = None

    async def _direct_send_loop(self) -> None:
        """Pump the reply bus into VoiceAssistantAudio frames, paced to real time.

        The device's VA speaker buffer is 16 KB (~0.33 s at 24 kHz/16-bit): sending
        faster than playback drops chunks silently, so we keep at most ~0.25 s of
        headroom in flight. When the bus ends (generation done), we close the stream
        and — since sends were paced — playback finishes ~buffer-depth later, which is
        when we post MODEL_TURN_COMPLETE. Cancellation (stop/barge-in) skips the
        graceful close; PLAYBACK_STOP's abort_va already silenced the device."""
        loop = asyncio.get_event_loop()
        if not await self.voicepe.begin_direct_reply():
            _LOG.warning("direct path unavailable — falling back to announce for %s", self.room)
            await self._announce_with_retry()
            return
        byte_rate = float(C.GEMINI_OUTPUT_RATE * C.SAMPLE_WIDTH)
        sent = 0
        t0 = loop.time()
        try:
            while True:
                try:
                    chunk = await self.reply_bus.next_chunk(self.room, timeout_s=30.0)
                except EOFError:
                    break
                if chunk is None:  # 30 s with no audio and no end — a wedged reply
                    _LOG.warning("direct reply for %s never ended — closing stream", self.room)
                    break
                # Pace: sleep whenever we're more than 0.25 s ahead of real time.
                ahead = sent / byte_rate - (loop.time() - t0)
                if ahead > 0.25:
                    await asyncio.sleep(ahead - 0.25)
                for i in range(0, len(chunk), 2048):  # stay well under the 16 KB buffer
                    self.voicepe.send_direct_pcm(chunk[i : i + 2048])
                sent += len(chunk)
            await self.voicepe.end_direct_reply()
            # Sends were paced, so the device finishes ~its buffer depth after the last
            # frame: fire the turn-done a tail later (media-state may still beat it).
            self._start_turn_done_timer(PLAYBACK_TAIL_S)
        except asyncio.CancelledError:
            raise  # stop/barge-in: abort_va silenced the device; no graceful close
        except Exception as e:
            _LOG.warning("direct send loop failed for %s: %s", self.room, e)
            await self.sm.post(Event(EventType.ERROR, self.room))

    async def _announce_with_retry(self, retry_after_s: float = 2.5) -> None:
        """Announce the reply URL and verify the device actually FETCHED it.

        A dropped announce used to mean total silence with no trace ("went deaf").
        The web layer bumps a per-room fetch counter on every /reply GET; if it
        hasn't moved after ``retry_after_s`` and we're still speaking, re-announce
        once and say so in the activity feed."""
        can_track = hasattr(self.reply_bus, "fetch_count")
        before = self.reply_bus.fetch_count(self.room) if can_track else 0
        await self.voicepe.play_url(self.reply_url)
        if not can_track:
            return
        await asyncio.sleep(retry_after_s)
        if self.sm.state is not State.AI_SPEAKING:
            return  # turn already over (stopped / interrupted) — nothing to rescue
        if self.reply_bus.fetch_count(self.room) == before:
            _LOG.warning("device never fetched the reply for room %s — re-announcing", self.room)
            if self.hub is not None:
                self.hub.activity(self.room, "🔇 Enheden hentede ikke svaret — prøver igen")
            await self.voicepe.play_url(self.reply_url)

    async def _play_error_audible(self, reason: str = "connection") -> None:
        """Say the error OUT LOUD on the device via the WORKING announce path.

        The old path (playback.play_tone -> play_pcm -> send_voice_assistant_audio) is
        architecturally dead on the Voice PE, so every error was silent: the music just
        snapped back and the room got stillness — which reads as being ignored. Push a
        short tone + the matching pre-rendered Danish clip through the reply bus and
        announce it. ``reason`` picks the honest message: a watchdog "timeout" says
        "det tog for lang tid — prøv igen" instead of blaming the wifi (which trains
        the family to distrust the connection for a merely-slow model). Falls back to
        the local tone path in sim/console mode (no reply bus)."""
        # A clean earcon, NOT robotic TTS. The pre-rendered macOS clips were embarrassing
        # quality; proper spoken errors need neural TTS generated offline (a follow-up).
        # The tone says "something went wrong" without sounding broken.
        tone = audio_mod.error_tone(C.GEMINI_OUTPUT_RATE)
        if self.reply_bus is not None and self.reply_url:
            self.reply_bus.clear(self.room)
            self.reply_bus.start(self.room)
            self.reply_bus.push(self.room, tone)
            self.reply_bus.end(self.room)
            with contextlib.suppress(Exception):
                await self.voicepe.play_url(self.reply_url)
            if self.hub is not None:
                label = "⏳ Timeout" if reason == "timeout" else "🔴 Forbindelsesfejl"
                self.hub.activity(self.room, f"{label} — tone afspillet")
        else:
            await self.playback.play_tone(tone)

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
        seen_audio = False
        async for frame in self.voicepe.pcm_frames():
            if not seen_audio:
                seen_audio = True
                if self.hub is not None:
                    self.hub.activity(self.room, "✅ Hearing audio from the device")
            if self._lounge_vad_on and self._lounge_vad.feed(frame):
                self._lounge_vad_on = False
                await self.sm.post(Event(EventType.LOCAL_VOICE_DETECTED, self.room))
            try:
                await self.gatekeeper.offer(frame)
            except Exception as e:
                # A dead provider socket raises here on EVERY frame while the gate is
                # open. Drop the frame, surface ONE audible ERROR (the teardown shuts
                # the gate, which stops the raising), and keep the loop alive.
                if not self._ingest_error_posted:
                    self._ingest_error_posted = True
                    _LOG.warning("provider send failed mid-stream (%s) — posting ERROR", e)
                    await self.sm.post(Event(EventType.ERROR, self.room))

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
                await self.sm.post(Event(EventType.MODEL_RESPONDING, self.room))
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
            # Classify on the ACCUMULATED utterance, not the delta: "tak" arriving as
            # its own delta after "sluk lyset" must not read as a standalone closure.
            await self._maybe_barge_in("".join(self._in_buf))
        elif isinstance(ev, ToolCall):
            if self.watchdog is not None:
                self.watchdog.on_output()  # a tool call IS the model's first response
                # While WE run the tool, the model is waiting on US — neither the 1.5s
                # stall clock nor the 3s TTFR window may tick during a legitimate
                # 3-9s lookup. Widen to the tool budget ("Senegal": 0.65 only moved
                # the abort cliff from 1.5s to 3s; this removes it).
                self.watchdog.expect_response(C.TOOL_WATCHDOG_S)
            if self.hub is not None:
                self.hub.incr("tool_calls")
            # Dispatch on a task so the reader keeps consuming audio/interrupts while a
            # slow tool runs (the inline await froze barge-in + transcripts for up to
            # 9s, and serialized the parallel calls the system prompt asks for).
            task = asyncio.create_task(self._run_tool(ev), name=f"tool-{ev.id}")
            self._tool_tasks[ev.id] = task
            self._tasks.append(task)
            task.add_done_callback(self._reap_task)

            def _untrack(_t: asyncio.Task, _id: str = ev.id) -> None:
                self._tool_tasks.pop(_id, None)

            task.add_done_callback(_untrack)
        elif isinstance(ev, ToolCallCancellation):
            # The user barged in mid-tool (Gemini Live rescinds the calls): cancel the
            # pending dispatches so a stale result is never submitted post-interrupt.
            for call_id in ev.ids:
                pending = self._tool_tasks.pop(call_id, None)
                if pending is not None and not pending.done():
                    pending.cancel()
                    _LOG.info("tool call %s cancelled by barge-in", call_id)
        elif isinstance(ev, TurnComplete):
            # Flush the USER turn FIRST (before the reply) so History reads you -> assistant.
            # OpenAI's complete input transcript lands AFTER speech_stopped, so the
            # UserSpeechStopped flush ran on an empty buffer — catch it here.
            self._flush_user_turn()
            est_playback_s = 0.0
            if self.reply_bus is not None:
                turn_bytes = (
                    self.reply_bus.take_turn_bytes(self.room)  # read AND reset (see reply.py)
                    if hasattr(self.reply_bus, "take_turn_bytes")
                    else 0
                )
                # GENERATION is done, but the device only STARTS playing the audio around
                # now (announce: served when end() closes the stream; streaming: the device
                # still BUFFERS the whole fetch and plays it after). Either way the estimate
                # must be the FULL reply duration — the 0.68 streaming special-case used just
                # the 1 s prebuffer, so the follow-up window opened ~1.5 s into a longer reply
                # and the lounge VAD heard the reply itself → self-answer loop + garbage
                # "you" turns (0.68 field regression). Always use the byte count.
                est_playback_s = turn_bytes / float(C.GEMINI_OUTPUT_RATE * C.SAMPLE_WIDTH)
                self.reply_bus.end(self.room)  # reply done -> close the announce stream
            if self._out_buf and self.hub is not None:  # persist the whole reply as ONE turn
                self.hub.transcript(self.room, "out", "".join(self._out_buf))
            self._out_buf = []
            if self.watchdog is not None:
                self.watchdog.disarm()
                if self.hub is not None and self.watchdog.samples:
                    self.hub.set_latency(self.room, self.watchdog.samples[-1] * 1000)
            # Hold MODEL_TURN_COMPLETE until the reply has actually FINISHED PLAYING.
            # Posting it at generation end opened the lounge window while the speaker
            # was still talking — the lounge VAD then heard the assistant's own reply
            # and re-opened LISTENING, so it answered itself in a loop (0.64 field bug).
            if self.speaker_path == "direct" and self._direct_sender is not None:
                pass  # the paced direct sender fires turn-done when playback truly ends
            elif est_playback_s > 0.05 or (self.reply_streaming and self.reply_bus is not None):
                self._start_turn_done_timer(min(est_playback_s, 60.0) + PLAYBACK_TAIL_S)
            else:
                await self.sm.post(Event(EventType.MODEL_TURN_COMPLETE, self.room))
        elif isinstance(ev, UserSpeechStopped):
            self._flush_user_turn()  # Gemini streams deltas that are all in by end-of-speech
            # Drive the state machine into THINKING (distinct LED) so the gap before the
            # reply's first audio doesn't look like "still listening".
            await self.sm.post(Event(EventType.USER_SPEECH_STOPPED, self.room))
            # End of the user's turn: NOW the model owes us a reply within WATCHDOG_MS.
            # This is the correct arming point for the time-to-first-response watchdog.
            if self.watchdog is not None:
                self.watchdog.arm(self.room)
        elif isinstance(ev, Interrupted):
            self._out_buf = []  # the partial reply was cancelled — don't persist a fragment
            self.playback.flush()
            await self.sm.post(Event(EventType.MODEL_INTERRUPTED, self.room))
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

    async def _run_tool(self, tc: ToolCall) -> None:
        """Dispatch one tool concurrently with the event loop; result sends are
        serialized (one WS write at a time) and the watchdog is reset to the normal
        response window once OUR part is done."""
        await self._handle_tool(tc)
        if self.watchdog is not None:
            # The post-tool answer now has to be reasoned + generated (seconds of
            # legitimate silence). Back to the normal TTFR window.
            self.watchdog.expect_response()

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
        async with self._tool_lock:  # dispatches run concurrently; WS writes must not
            await self.gemini.send_tool_results(
                [{"id": tc.id, "name": tc.name, "response": result}]
            )

    def _flush_user_turn(self) -> None:
        """Persist the buffered user utterance as ONE 'in' turn, then clear.

        Called on BOTH UserSpeechStopped and TurnComplete because the two providers
        deliver the input transcript at different times: Gemini streams deltas that are
        all in by end-of-speech (UserSpeechStopped), while OpenAI sends ONE complete
        transcript that arrives AFTER speech_stopped (so it's only present by
        TurnComplete). Idempotent — whichever trigger holds the text flushes it; the
        other finds an empty buffer. This is why History was showing assistant turns
        with no matching 'you' turn: the old single flush ran before the text existed.
        """
        if self._in_buf and self.hub is not None:
            self.hub.transcript(self.room, "in", "".join(self._in_buf))
        self._in_buf = []

    # ------------------------------------------------------------------ device events
    def _on_media_announcing(self, announcing: bool) -> None:
        """Device media-player state: the announcement pipeline started/stopped.

        When the reply's generation is done (turn-done timer armed) and the device
        reports the announcement FINISHED, the turn is really over — fire
        MODEL_TURN_COMPLETE now instead of waiting out the byte-estimate. The estimate
        timer stays as the backstop for devices/firmwares that don't report state."""
        if announcing or self._turn_done_timer is None:
            return
        _LOG.info(
            "device reports announcement finished for %s — turn done (ground truth)", self.room
        )
        self._cancel_turn_done_timer()
        self._schedule_task(self.sm.post(Event(EventType.MODEL_TURN_COMPLETE, self.room)))

    def _on_mute(self, muted: bool) -> None:
        """Hardware mute switch observed over the API: paint the ring red and close any
        live session. Without this the family flips the switch, wake silently dies, the
        ring stays dark, and the only possible reading is 'it's broken'."""
        if muted == self._muted:
            return
        self._muted = muted
        self._paint_led(self.sm.state)
        if self.hub is not None:
            self.hub.activity(
                self.room,
                "🔇 Mikrofonen er slukket på kontakten" if muted else "🎙️ Mikrofonen er tændt igen",
            )
        if muted and self.sm.state is not State.IDLE:
            self._schedule_task(
                self.sm.post(Event(EventType.CLOSURE_TOKEN, self.room, {"kind": "mute"}))
            )

    def _on_wake(self) -> None:
        """Device wake (handle_start) -> drive a WAKE_WORD into the state machine."""
        self._prepaint_wake_led()
        asyncio.create_task(self.sm.post(Event(EventType.WAKE_WORD, self.room)))  # noqa: RUF006

    def _prepaint_wake_led(self) -> None:
        """Paint the ring cyan the INSTANT wake arrives. The WAKE action list awaits the
        provider WS connect (~1 s) before the observer repaints, and that dark second
        reads as "did it even hear me?" (0.64 field feedback). Idempotent — the observer
        repaint that follows paints the same colour. A cold wake also arms the pre-roll
        replay (only the cold-wake gate_open has the connect gap worth covering)."""
        if self.sm.state is State.IDLE:
            self._preroll_armed = True
            self._paint_led(State.LISTENING)

    def _on_device_event(self, room: str, state: object) -> None:
        # VERIFY: ESPHome event-entity state shape (event_type attribute name).
        etype = getattr(state, "event_type", None) or getattr(state, "event", None)
        if etype is None:
            return
        if etype in ("wake_okay_nabu", "wake"):
            self._prepaint_wake_led()
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

    def _start_turn_done_timer(self, delay_s: float) -> None:
        """Post MODEL_TURN_COMPLETE after the reply has finished PLAYING (not merely
        generating). Cancelled by PLAYBACK_STOP (stop / barge-in / error teardown)."""
        self._cancel_turn_done_timer()
        self._turn_done_timer = asyncio.create_task(
            self._turn_done_after(delay_s), name=f"turndone-{self.room}"
        )

    def _cancel_turn_done_timer(self) -> None:
        if self._turn_done_timer is not None and not self._turn_done_timer.done():
            self._turn_done_timer.cancel()
        self._turn_done_timer = None

    async def _turn_done_after(self, delay_s: float) -> None:
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.sleep(delay_s)
            await self.sm.post(Event(EventType.MODEL_TURN_COMPLETE, self.room))

    def _start_listen_timer(self) -> None:
        """(Re)arm the idle-close timer for the LISTENING state."""
        self._cancel_listen_timer()
        self._listen_timer = asyncio.create_task(self._listen_timeout(), name=f"listen-{self.room}")

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
