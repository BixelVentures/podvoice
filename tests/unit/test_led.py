"""The LED ring mapping is a pure function — test it like the state table."""

from __future__ import annotations

from gatekeeper.events import State
from gatekeeper.led import led_command_for


def test_idle_ring_is_off():
    cmd = led_command_for(State.IDLE)
    assert cmd.on is False  # "not streaming" privacy signal


def test_listening_is_bright_cyan():
    cmd = led_command_for(State.LISTENING)
    assert cmd.on is True and cmd.brightness >= 0.7
    assert cmd.rgb[2] > cmd.rgb[0]  # blue-dominant (cyan)


def test_speaking_distinct_from_listening():
    assert led_command_for(State.AI_SPEAKING).rgb != led_command_for(State.LISTENING).rgb


def test_grace_is_dim_cyan():
    grace = led_command_for(State.LOUNGE_WINDOW)
    listening = led_command_for(State.LISTENING)
    assert (
        grace.on is True and grace.rgb == listening.rgb and grace.brightness < listening.brightness
    )


def test_muted_overrides_state():
    cmd = led_command_for(State.LISTENING, muted=True)
    assert cmd.on is True and cmd.rgb[0] > cmd.rgb[2]  # red-dominant


def test_error_overrides_muted_and_state():
    cmd = led_command_for(State.AI_SPEAKING, muted=True, error=True)
    assert cmd.blink is True and cmd.rgb == (1.0, 0.0, 0.0)  # error wins
