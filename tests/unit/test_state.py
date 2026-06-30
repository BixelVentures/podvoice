"""Unit tests for the state machine (PLAN.md §7, §7.1, §7.7).

The whole transition table is verified row-by-row against the spec, including
ignored events (same state, empty action list). ``_decide`` is pure so it can be
called directly; the run loop is exercised for the race and teardown scenarios.
"""

from __future__ import annotations

import asyncio

import pytest

from gatekeeper import constants as C
from gatekeeper.events import (
    Action,
    ActionKind,
    Event,
    EventType,
    State,
)
from gatekeeper.state import StateMachine


class RecordingEffects:
    """An Effects implementation that records every (action, room) applied."""

    def __init__(self) -> None:
        self.applied: list[tuple[Action, str | None]] = []

    async def apply(self, action: Action, room: str | None) -> None:
        self.applied.append((action, room))

    @property
    def kinds(self) -> list[ActionKind]:
        return [a.kind for a, _ in self.applied]


def make_sm() -> StateMachine:
    return StateMachine(RecordingEffects(), room="kitchen")


def ev(et: EventType, kind: str | None = None) -> Event:
    payload = {"kind": kind} if kind is not None else None
    return Event(type=et, payload=payload)


D = C.DUCK_LEVEL
L = C.LOUNGE_LEVEL
TL = C.TTL_LISTENING_MS
TG = C.TTL_LOUNGE_MS
WIN = C.LOUNGE_WINDOW_S

K = ActionKind

# Each row: (current_state, event, expected_next_state, expected_action_kinds)
TABLE = [
    # --- IDLE ---  (wake opens the device mic-forward via STREAM_START)
    (
        State.IDLE,
        ev(EventType.WAKE_WORD),
        State.LISTENING,
        [K.STREAM_START, K.OPEN_WS, K.GATE_OPEN, K.HB_START],
    ),
    (
        State.IDLE,
        ev(EventType.BUTTON_PRESS),
        State.LISTENING,
        [K.STREAM_START, K.OPEN_WS, K.GATE_OPEN, K.HB_START],
    ),
    (State.IDLE, ev(EventType.GEMINI_TURN_COMPLETE), State.IDLE, []),
    (State.IDLE, ev(EventType.LOCAL_VOICE_DETECTED), State.IDLE, []),
    (State.IDLE, ev(EventType.CLOSURE_TOKEN, "stop"), State.IDLE, []),
    (State.IDLE, ev(EventType.ERROR), State.IDLE, []),
    # --- LISTENING ---
    (
        State.LISTENING,
        ev(EventType.GEMINI_RESPONDING),
        State.AI_SPEAKING,
        [K.GATE_MUTE, K.PLAYBACK_ARM],  # mic muted while the AI speaks (no self-interrupt)
    ),
    (
        State.LISTENING,
        ev(EventType.GEMINI_TURN_COMPLETE),
        State.LOUNGE_WINDOW,
        [K.GATE_SHUT, K.HB_RETARGET, K.START_LOUNGE_VAD, K.START_LOUNGE_TIMER],
    ),
    (
        State.LISTENING,
        ev(EventType.CLOSURE_TOKEN, "stop"),
        State.IDLE,
        [K.STREAM_STOP, K.GATE_SHUT, K.HB_STOP, K.RELEASE, K.CLOSE_WS],
    ),
    (
        State.LISTENING,
        ev(EventType.WATCHDOG_TIMEOUT),
        State.IDLE,
        [
            K.STREAM_STOP,
            K.STOP_LOUNGE_VAD,
            K.CANCEL_LOUNGE_TIMER,
            K.PLAYBACK_STOP,
            K.GATE_SHUT,
            K.HB_STOP,
            K.RELEASE,
            K.CLOSE_WS,
            K.ERROR_TONE,
        ],
    ),
    (
        State.LISTENING,
        ev(EventType.ERROR),
        State.IDLE,
        [
            K.STREAM_STOP,
            K.STOP_LOUNGE_VAD,
            K.CANCEL_LOUNGE_TIMER,
            K.PLAYBACK_STOP,
            K.GATE_SHUT,
            K.HB_STOP,
            K.RELEASE,
            K.CLOSE_WS,
            K.ERROR_TONE,
        ],
    ),
    (State.LISTENING, ev(EventType.LOCAL_VOICE_DETECTED), State.LISTENING, []),
    (State.LISTENING, ev(EventType.GEMINI_INTERRUPTED), State.LISTENING, []),
    # --- AI_SPEAKING ---
    (
        State.AI_SPEAKING,
        ev(EventType.GEMINI_TURN_COMPLETE),
        State.LOUNGE_WINDOW,
        [K.GATE_SHUT, K.HB_RETARGET, K.START_LOUNGE_VAD, K.START_LOUNGE_TIMER],
    ),
    (
        State.AI_SPEAKING,
        ev(EventType.GEMINI_INTERRUPTED),
        State.LISTENING,
        [K.PLAYBACK_STOP, K.GATE_OPEN],
    ),
    # A hardware re-wake while speaking is a barge-in too (stream stays ON).
    (
        State.AI_SPEAKING,
        ev(EventType.WAKE_WORD),
        State.LISTENING,
        [K.PLAYBACK_STOP, K.GATE_OPEN],
    ),
    (
        State.AI_SPEAKING,
        ev(EventType.CLOSURE_TOKEN, "vent"),
        State.IDLE,
        [K.STREAM_STOP, K.PLAYBACK_STOP, K.GATE_SHUT, K.HB_STOP, K.RELEASE, K.CLOSE_WS],
    ),
    (
        State.AI_SPEAKING,
        ev(EventType.WATCHDOG_TIMEOUT),
        State.IDLE,
        [
            K.STREAM_STOP,
            K.STOP_LOUNGE_VAD,
            K.CANCEL_LOUNGE_TIMER,
            K.PLAYBACK_STOP,
            K.GATE_SHUT,
            K.HB_STOP,
            K.RELEASE,
            K.CLOSE_WS,
            K.ERROR_TONE,
        ],
    ),
    (
        State.AI_SPEAKING,
        ev(EventType.ERROR),
        State.IDLE,
        [
            K.STREAM_STOP,
            K.STOP_LOUNGE_VAD,
            K.CANCEL_LOUNGE_TIMER,
            K.PLAYBACK_STOP,
            K.GATE_SHUT,
            K.HB_STOP,
            K.RELEASE,
            K.CLOSE_WS,
            K.ERROR_TONE,
        ],
    ),
    (State.AI_SPEAKING, ev(EventType.LOCAL_VOICE_DETECTED), State.AI_SPEAKING, []),
    # --- LOUNGE_WINDOW ---
    (
        State.LOUNGE_WINDOW,
        ev(EventType.LOCAL_VOICE_DETECTED),
        State.LISTENING,
        [K.STOP_LOUNGE_VAD, K.CANCEL_LOUNGE_TIMER, K.GATE_OPEN, K.HB_RETARGET],
    ),
    (
        State.LOUNGE_WINDOW,
        ev(EventType.CLOSURE_TOKEN, "tak"),
        State.IDLE,
        [
            K.STREAM_STOP,
            K.STOP_LOUNGE_VAD,
            K.CANCEL_LOUNGE_TIMER,
            K.GATE_SHUT,
            K.HB_STOP,
            K.RELEASE,
            K.CLOSE_WS,
        ],
    ),
    (
        State.LOUNGE_WINDOW,
        ev(EventType.LOUNGE_TIMEOUT),
        State.IDLE,
        [K.STREAM_STOP, K.STOP_LOUNGE_VAD, K.GATE_SHUT, K.HB_STOP, K.RELEASE, K.CLOSE_WS],
    ),
    (
        State.LOUNGE_WINDOW,
        ev(EventType.WATCHDOG_TIMEOUT),
        State.IDLE,
        [
            K.STREAM_STOP,
            K.STOP_LOUNGE_VAD,
            K.CANCEL_LOUNGE_TIMER,
            K.PLAYBACK_STOP,
            K.GATE_SHUT,
            K.HB_STOP,
            K.RELEASE,
            K.CLOSE_WS,
            K.ERROR_TONE,
        ],
    ),
    (
        State.LOUNGE_WINDOW,
        ev(EventType.ERROR),
        State.IDLE,
        [
            K.STREAM_STOP,
            K.STOP_LOUNGE_VAD,
            K.CANCEL_LOUNGE_TIMER,
            K.PLAYBACK_STOP,
            K.GATE_SHUT,
            K.HB_STOP,
            K.RELEASE,
            K.CLOSE_WS,
            K.ERROR_TONE,
        ],
    ),
    (State.LOUNGE_WINDOW, ev(EventType.GEMINI_TURN_COMPLETE), State.LOUNGE_WINDOW, []),
]


@pytest.mark.parametrize(
    "state,event,exp_next,exp_kinds",
    TABLE,
    ids=[f"{r[0].name}+{r[1].type.name}({r[1].kind})" for r in TABLE],
)
def test_decide_table(state, event, exp_next, exp_kinds):
    sm = make_sm()
    new, actions = sm._decide(state, event)
    assert new is exp_next
    assert [a.kind for a in actions] == exp_kinds


def _by_kind(actions: list[Action], kind: ActionKind) -> Action:
    for a in actions:
        if a.kind is kind:
            return a
    raise AssertionError(f"no action {kind}")


def test_decide_hb_start_params():
    sm = make_sm()
    _, actions = sm._decide(State.IDLE, ev(EventType.WAKE_WORD))
    hb = _by_kind(actions, ActionKind.HB_START)
    assert (hb.level, hb.ttl_ms) == (D, TL)


def test_decide_lounge_retarget_and_timer_params():
    sm = make_sm()
    _, actions = sm._decide(State.AI_SPEAKING, ev(EventType.GEMINI_TURN_COMPLETE))
    hb = _by_kind(actions, ActionKind.HB_RETARGET)
    assert (hb.level, hb.ttl_ms) == (L, TG)
    timer = _by_kind(actions, ActionKind.START_LOUNGE_TIMER)
    assert timer.timeout_s == WIN


def test_decide_lounge_to_listening_retarget_is_duck():
    sm = make_sm()
    _, actions = sm._decide(State.LOUNGE_WINDOW, ev(EventType.LOCAL_VOICE_DETECTED))
    hb = _by_kind(actions, ActionKind.HB_RETARGET)
    assert (hb.level, hb.ttl_ms) == (D, TL)


def test_decide_is_pure_does_not_mutate_state():
    sm = make_sm()
    assert sm.state is State.IDLE
    sm._decide(State.AI_SPEAKING, ev(EventType.GEMINI_TURN_COMPLETE))
    assert sm.state is State.IDLE  # unchanged by a pure call


async def _drive(sm: StateMachine, events: list[Event]) -> None:
    """Post events, run the loop until the queue drains, then cancel."""
    task = asyncio.create_task(sm.run())
    for e in events:
        await sm.post(e)
    # block until the loop has processed every queued event (run() calls
    # task_done() per event), keeping the test fully deterministic.
    await sm.q.join()
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


async def test_race_turn_complete_then_local_voice():
    """turn_complete from AI_SPEAKING then LOCAL_VOICE_DETECTED ends in LISTENING."""
    eff = RecordingEffects()
    sm = StateMachine(eff, room="kitchen")
    sm.state = State.AI_SPEAKING
    await _drive(
        sm,
        [
            ev(EventType.GEMINI_TURN_COMPLETE),
            ev(EventType.LOCAL_VOICE_DETECTED),
        ],
    )
    assert sm.state is State.LISTENING
    assert ActionKind.GATE_OPEN in eff.kinds
    retargets = [a for a, _ in eff.applied if a.kind is ActionKind.HB_RETARGET]
    # the final retarget (re-opening to LISTENING) must duck back to duck_level.
    assert any(a.level == D and a.ttl_ms == TL for a in retargets)


@pytest.mark.parametrize("start", [State.LISTENING, State.AI_SPEAKING, State.LOUNGE_WINDOW])
async def test_error_teardown_from_every_non_idle_state(start):
    eff = RecordingEffects()
    sm = StateMachine(eff, room="kitchen")
    sm.state = start
    await _drive(sm, [ev(EventType.ERROR)])
    assert sm.state is State.IDLE
    for required in (
        ActionKind.HB_STOP,
        ActionKind.RELEASE,
        ActionKind.CLOSE_WS,
        ActionKind.ERROR_TONE,
    ):
        assert required in eff.kinds
    # release happens after hb_stop (generation-guard ordering, §7.3).
    assert eff.kinds.index(ActionKind.HB_STOP) < eff.kinds.index(ActionKind.RELEASE)


async def test_room_is_threaded_through_effects():
    eff = RecordingEffects()
    sm = StateMachine(eff, room="kitchen")
    await _drive(sm, [ev(EventType.WAKE_WORD)])
    assert all(room == "kitchen" for _, room in eff.applied)
