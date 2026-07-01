"""Event, State and Action vocabulary shared across the gatekeeper.

The state machine (state.py) consumes ``Event``s from a single queue and, via a
PURE decision function, emits ``Action``s that an effects handler executes. This
keeps the transition logic fully unit-testable without any I/O.
"""

from __future__ import annotations

import enum
import time
from dataclasses import dataclass, field


class State(enum.Enum):
    IDLE = "idle"
    LISTENING = "listening"
    THINKING = "thinking"  # end-of-user-speech -> first reply audio (distinct LED so a slow
    # reply doesn't look like "still listening" — the #1 "feels finished" cue)
    AI_SPEAKING = "ai_speaking"
    LOUNGE_WINDOW = "lounge_window"


class EventType(enum.Enum):
    WAKE_WORD = enum.auto()
    BUTTON_PRESS = enum.auto()
    USER_SPEECH_STOPPED = enum.auto()  # provider end-of-user-speech -> LISTENING -> THINKING
    GEMINI_RESPONDING = enum.auto()  # first model audio chunk of a turn
    GEMINI_TURN_COMPLETE = enum.auto()
    GEMINI_INTERRUPTED = enum.auto()
    CLOSURE_TOKEN = enum.auto()  # payload["kind"] in {"stop","vent","stille","tak"}
    LOUNGE_TIMEOUT = enum.auto()
    LOCAL_VOICE_DETECTED = enum.auto()
    WATCHDOG_TIMEOUT = enum.auto()
    ERROR = enum.auto()


@dataclass(frozen=True)
class Event:
    type: EventType
    room: str | None = None
    payload: dict | None = None
    ts: float = field(default_factory=time.monotonic)

    @property
    def kind(self) -> str | None:
        """Closure-token kind, if any (e.g. ``stop`` / ``vent`` / ``tak``)."""
        if self.payload is None:
            return None
        return self.payload.get("kind")


class ActionKind(enum.Enum):
    OPEN_WS = enum.auto()
    CLOSE_WS = enum.auto()
    ENGAGE = enum.auto()  # level, ttl_ms
    RELEASE = enum.auto()
    HB_START = enum.auto()  # level, ttl_ms
    HB_RETARGET = enum.auto()  # level, ttl_ms
    HB_STOP = enum.auto()
    GATE_OPEN = enum.auto()
    GATE_SHUT = enum.auto()
    GATE_MUTE = enum.auto()  # shut the gate AND send silence (while the AI is speaking)
    PLAYBACK_ARM = enum.auto()
    PLAYBACK_STOP = enum.auto()
    START_LOUNGE_TIMER = enum.auto()  # timeout_s
    CANCEL_LOUNGE_TIMER = enum.auto()
    START_LOUNGE_VAD = enum.auto()
    STOP_LOUNGE_VAD = enum.auto()
    ERROR_TONE = enum.auto()
    STREAM_START = enum.auto()  # tell the Voice PE to START forwarding mic (wake-gate open)
    STREAM_STOP = enum.auto()  # tell the Voice PE to STOP forwarding mic (back to wake-only)


@dataclass(frozen=True)
class Action:
    kind: ActionKind
    level: int | None = None
    ttl_ms: int | None = None
    timeout_s: float | None = None


# --- Action constructors (terse, keep transition tables readable) ---
def open_ws() -> Action:
    return Action(ActionKind.OPEN_WS)


def close_ws() -> Action:
    return Action(ActionKind.CLOSE_WS)


def engage(level: int, ttl_ms: int) -> Action:
    return Action(ActionKind.ENGAGE, level=level, ttl_ms=ttl_ms)


def release() -> Action:
    return Action(ActionKind.RELEASE)


def hb_start(level: int, ttl_ms: int) -> Action:
    return Action(ActionKind.HB_START, level=level, ttl_ms=ttl_ms)


def hb_retarget(level: int, ttl_ms: int) -> Action:
    return Action(ActionKind.HB_RETARGET, level=level, ttl_ms=ttl_ms)


def hb_stop() -> Action:
    return Action(ActionKind.HB_STOP)


def gate_open() -> Action:
    return Action(ActionKind.GATE_OPEN)


def gate_shut() -> Action:
    return Action(ActionKind.GATE_SHUT)


def gate_mute() -> Action:
    """Shut the gate and send silence (not real mic) — used while the AI is speaking,
    so residual echo / ambient noise can't trip the provider's VAD and self-interrupt
    the reply."""
    return Action(ActionKind.GATE_MUTE)


def playback_arm() -> Action:
    return Action(ActionKind.PLAYBACK_ARM)


def playback_stop() -> Action:
    return Action(ActionKind.PLAYBACK_STOP)


def start_lounge_timer(timeout_s: float) -> Action:
    return Action(ActionKind.START_LOUNGE_TIMER, timeout_s=timeout_s)


def cancel_lounge_timer() -> Action:
    return Action(ActionKind.CANCEL_LOUNGE_TIMER)


def start_lounge_vad() -> Action:
    return Action(ActionKind.START_LOUNGE_VAD)


def stop_lounge_vad() -> Action:
    return Action(ActionKind.STOP_LOUNGE_VAD)


def error_tone() -> Action:
    return Action(ActionKind.ERROR_TONE)


def stream_start() -> Action:
    return Action(ActionKind.STREAM_START)


def stream_stop() -> Action:
    return Action(ActionKind.STREAM_STOP)
