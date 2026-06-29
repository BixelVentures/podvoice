"""LED ring feedback — a PURE state -> light-command mapping.

The Voice PE LED ring is driven entirely off-device: PodVoice sends a light_command
over the native API on every state transition (the stock voice_assistant on_* LED
phases are dead under ``use_wake_word:false``). Keeping the mapping pure makes it
unit-testable exactly like ``state._decide`` — no I/O here.

Precedence: ERROR > MUTED > state colour. Colours are RGB floats in 0..1 (the shape
aioesphomeapi ``light_command`` expects). Brightness is a 0..1 target; voicepe scales
it to the user's configured ring brightness as a floor so the slider still matters.
"""

from __future__ import annotations

from dataclasses import dataclass

from .events import State


@dataclass(frozen=True)
class LedCmd:
    on: bool
    rgb: tuple[float, float, float] = (0.0, 0.0, 0.0)
    brightness: float = 0.0  # 0..1
    blink: bool = False  # caller may animate (error); a solid colour is the safe floor


# HA cyan-blue (the "I am streaming you" colour), matching upstream's listening hue.
_CYAN = (0.094, 0.733, 0.949)
_GREEN = (0.470, 0.863, 0.549)  # assistant speaking — distinct hue from listening


def led_command_for(state: State, *, muted: bool = False, error: bool = False) -> LedCmd:
    """Map (state, muted, error) -> the LED ring command. Pure."""
    if error:
        return LedCmd(True, (1.0, 0.0, 0.0), 1.0, blink=True)  # red double-blink
    if muted:
        return LedCmd(True, (1.0, 0.12, 0.12), 0.4)  # solid red = muted/silent
    if state is State.LISTENING:
        return LedCmd(True, _CYAN, 0.8)  # post-wake, mic streaming
    if state is State.AI_SPEAKING:
        return LedCmd(True, _GREEN, 0.9)  # speaking (barge-in affordance)
    if state is State.LOUNGE_WINDOW:
        return LedCmd(True, _CYAN, 0.35)  # grace/follow-up: dim cyan
    return LedCmd(False)  # IDLE / asleep: ring OFF = "not streaming" privacy signal
