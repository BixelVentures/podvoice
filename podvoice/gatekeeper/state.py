"""The async state machine (PLAN.md §7, §7.1).

One explicit state machine drives everything. Events arrive on a single queue;
a PURE decision function (``_decide``) maps ``(state, event)`` to a next state
and an ordered list of ``Action``s; an ``Effects`` handler executes them. The
purity of ``_decide`` makes the whole transition table trivially unit-testable
without any I/O.
"""

from __future__ import annotations

import asyncio
import logging
import typing
from collections.abc import Callable

from . import constants as C
from .events import (
    Action,
    Event,
    EventType,
    State,
    cancel_lounge_timer,
    close_ws,
    error_tone,
    gate_mute,
    gate_open,
    gate_shut,
    hb_retarget,
    hb_start,
    hb_stop,
    open_ws,
    playback_arm,
    playback_stop,
    release,
    start_lounge_timer,
    start_lounge_vad,
    stop_lounge_vad,
    stream_start,
    stream_stop,
)

log = logging.getLogger(__name__)


class Effects(typing.Protocol):
    async def apply(self, action: Action, room: str | None) -> None: ...


class StateMachine:
    """Serialized, single-writer state machine for one room."""

    def __init__(
        self,
        effects: Effects,
        room: str | None = None,
        *,
        lounge_window_s: float = C.LOUNGE_WINDOW_S,
        duck_level: int = C.DUCK_LEVEL,
        lounge_level: int = C.LOUNGE_LEVEL,
        ttl_listening_ms: int = C.TTL_LISTENING_MS,
        ttl_lounge_ms: int = C.TTL_LOUNGE_MS,
        full_duplex: bool = True,
        observer: Callable[[State, State, Event], None] | None = None,
    ) -> None:
        self._effects = effects
        self._observer = observer
        self.room = room
        # True = keep the mic OPEN while the AI speaks so you can barge in by voice
        # (relies on the XMOS AEC removing the AI's own voice from the mic). False =
        # mute the mic while the AI speaks (half-duplex; safe fallback if AEC leaks).
        self.full_duplex = full_duplex
        self.lounge_window_s = lounge_window_s
        self.duck_level = duck_level
        self.lounge_level = lounge_level
        self.ttl_listening_ms = ttl_listening_ms
        self.ttl_lounge_ms = ttl_lounge_ms
        self.state: State = State.IDLE
        self.q: asyncio.Queue[Event] = asyncio.Queue()

    async def post(self, event: Event) -> None:
        await self.q.put(event)

    async def run(self) -> None:
        while True:
            event = await self.q.get()
            try:
                try:
                    new, actions = self._decide(self.state, event)
                except Exception:  # pragma: no cover - defensive, degrade never crash
                    log.exception("decide_failed", extra={"state": self.state, "event": event.type})
                    new, actions = State.IDLE, self._teardown()
                await self._apply(actions)
                # Put from->to+event IN the message (the default log format drops `extra`),
                # so the add-on Log tab actually shows the conversation flow for debugging.
                log.info(
                    "transition %s -> %s on %s%s [room=%s]",
                    self.state.value,
                    new.value,
                    event.type.name,
                    f" ({event.kind})" if event.kind else "",
                    self.room,
                )
                old, self.state = self.state, new
                if self._observer is not None and old is not new:
                    try:
                        self._observer(old, new, event)
                    except Exception:  # pragma: no cover - observer must never break the loop
                        log.exception("observer_failed", extra={"room": self.room})
            finally:
                self.q.task_done()

    def _teardown(self) -> list[Action]:
        """Full teardown + local error tone (the ERROR / WATCHDOG path)."""
        return [
            stream_stop(),  # stop the device mic forward on any teardown (privacy)
            stop_lounge_vad(),
            cancel_lounge_timer(),
            playback_stop(),
            gate_shut(),
            hb_stop(),
            release(),
            close_ws(),
            error_tone(),
        ]

    def _decide(self, state: State, event: Event) -> tuple[State, list[Action]]:
        """PURE transition function — no awaits, no I/O. Implements the §7.1 table."""
        et = event.type

        if state is State.IDLE:
            if et in (EventType.WAKE_WORD, EventType.BUTTON_PRESS):
                return State.LISTENING, [
                    stream_start(),  # wake opens the device mic forward (start of session)
                    open_ws(),
                    gate_open(),
                    hb_start(self.duck_level, self.ttl_listening_ms),
                ]
            return State.IDLE, []

        if state is State.LISTENING:
            if et is EventType.GEMINI_RESPONDING:
                # full_duplex: keep the mic OPEN so you can interrupt by voice (the XMOS
                # AEC keeps the AI's own voice out of the mic; only a genuinely active
                # reply is barge-interruptible — see openai_realtime). half-duplex falls
                # back to gate_mute (silence) to guarantee no self-interrupt.
                if self.full_duplex:
                    return State.AI_SPEAKING, [playback_arm()]
                return State.AI_SPEAKING, [gate_mute(), playback_arm()]
            if et is EventType.GEMINI_TURN_COMPLETE:
                # A turn ended while still listening (e.g. an empty/instant turn):
                # open the follow-up window rather than getting stuck.
                return State.LOUNGE_WINDOW, [
                    gate_shut(),
                    hb_retarget(self.lounge_level, self.ttl_lounge_ms),
                    start_lounge_vad(),
                    start_lounge_timer(self.lounge_window_s),
                ]
            # Button is a TOGGLE: a press while listening stops the session (like a
            # closure). IDLE+press starts it; any active state+press stops it.
            if et in (EventType.CLOSURE_TOKEN, EventType.BUTTON_PRESS):
                return State.IDLE, [stream_stop(), gate_shut(), hb_stop(), release(), close_ws()]
            if et in (EventType.WATCHDOG_TIMEOUT, EventType.ERROR):
                return State.IDLE, self._teardown()
            return State.LISTENING, []

        if state is State.AI_SPEAKING:
            if et is EventType.GEMINI_TURN_COMPLETE:
                return State.LOUNGE_WINDOW, [
                    gate_shut(),
                    hb_retarget(self.lounge_level, self.ttl_lounge_ms),
                    start_lounge_vad(),
                    start_lounge_timer(self.lounge_window_s),
                ]
            # A spoken-over barge-in (provider VAD) OR a hardware re-wake interrupt the
            # assistant and return to listening (stream stays ON). The BUTTON is a
            # toggle, so a press here STOPS the session (handled with CLOSURE below).
            if et in (EventType.GEMINI_INTERRUPTED, EventType.WAKE_WORD):
                return State.LISTENING, [playback_stop(), gate_open()]
            if et in (EventType.CLOSURE_TOKEN, EventType.BUTTON_PRESS):
                return State.IDLE, [
                    stream_stop(),
                    playback_stop(),
                    gate_shut(),
                    hb_stop(),
                    release(),
                    close_ws(),
                ]
            if et in (EventType.WATCHDOG_TIMEOUT, EventType.ERROR):
                return State.IDLE, self._teardown()
            return State.AI_SPEAKING, []

        if state is State.LOUNGE_WINDOW:
            # Follow-up within the grace window — local voice or a re-wake — re-opens
            # listening without a fresh "Okay Nabu". (The button is a toggle: a press
            # during grace STOPS the session, handled with CLOSURE below.)
            if et in (EventType.LOCAL_VOICE_DETECTED, EventType.WAKE_WORD):
                return State.LISTENING, [
                    stop_lounge_vad(),
                    cancel_lounge_timer(),
                    gate_open(),
                    hb_retarget(self.duck_level, self.ttl_listening_ms),
                ]
            # A late follow-up reply that starts after we already returned to grace.
            if et is EventType.GEMINI_RESPONDING:
                gate = gate_open() if self.full_duplex else gate_mute()
                return State.AI_SPEAKING, [
                    stop_lounge_vad(),
                    cancel_lounge_timer(),
                    gate,
                    playback_arm(),
                    hb_retarget(self.duck_level, self.ttl_listening_ms),
                ]
            if et in (EventType.CLOSURE_TOKEN, EventType.BUTTON_PRESS):
                return State.IDLE, [
                    stream_stop(),
                    stop_lounge_vad(),
                    cancel_lounge_timer(),
                    gate_shut(),
                    hb_stop(),
                    release(),
                    close_ws(),
                ]
            if et is EventType.LOUNGE_TIMEOUT:
                return State.IDLE, [
                    stream_stop(),  # grace expired -> stop forwarding, back to wake-only
                    stop_lounge_vad(),
                    gate_shut(),
                    hb_stop(),
                    release(),
                    close_ws(),
                ]
            if et in (EventType.WATCHDOG_TIMEOUT, EventType.ERROR):
                return State.IDLE, self._teardown()
            return State.LOUNGE_WINDOW, []

        # unreachable; degrade to IDLE rather than crash.
        return State.IDLE, []  # pragma: no cover

    async def _apply(self, actions: list[Action]) -> None:
        for a in actions:
            await self._effects.apply(a, self.room)
