"""Unit tests for the latency watchdog + barge-in detector (PLAN §8.1 / §8.2)."""

from __future__ import annotations

import pytest

from gatekeeper import constants as C
from gatekeeper.watchdog import BargeIn, TurnWatchdog, normalize


async def _noop_abort(reason: str, elapsed: float) -> None:  # pragma: no cover
    return None


def _watchdog(fake_clock) -> TurnWatchdog:
    return TurnWatchdog(_noop_abort, clock=fake_clock.time)


# --- TurnWatchdog -----------------------------------------------------------
def test_ttfr_abort_on_silence(fake_clock):
    wd = _watchdog(fake_clock)
    wd.arm("turn-1")
    assert wd.check() is None
    fake_clock.advance(C.WATCHDOG_MS / 1000.0 + 0.05)  # past 800 ms, no output
    assert wd.check() == "ttfr"


def test_no_over_trigger_when_progressing(fake_clock):
    wd = _watchdog(fake_clock)
    wd.arm("turn-1")
    wd.on_output()  # progressing -> TTFR permanently disarmed
    fake_clock.advance(5.0)  # well past ttfr; a slow-but-progressing answer
    assert wd.check() != "ttfr"
    # ...but a progressing stream that goes silent past the stall limit trips.
    fake_clock.advance(C.STREAM_STALL_MS / 1000.0 + 0.05)
    assert wd.check() == "stall"


def test_stall_window(fake_clock):
    wd = _watchdog(fake_clock)
    wd.arm("turn-1")
    wd.on_output()
    fake_clock.advance(C.STREAM_STALL_MS / 1000.0 - 0.1)  # below stall
    assert wd.check() is None
    fake_clock.advance(0.2)  # now above stall
    assert wd.check() == "stall"


def test_check_none_when_not_armed(fake_clock):
    wd = _watchdog(fake_clock)
    assert wd.check() is None
    fake_clock.advance(100.0)
    assert wd.check() is None


def test_disarm_stops_aborts(fake_clock):
    wd = _watchdog(fake_clock)
    wd.arm("turn-1")
    wd.disarm()
    fake_clock.advance(100.0)
    assert wd.check() is None


def test_ttfr_sample_recorded(fake_clock):
    wd = _watchdog(fake_clock)
    wd.arm("turn-1")
    fake_clock.advance(0.4)
    wd.on_output()
    assert len(wd.samples) == 1
    assert wd.samples[0] == pytest.approx(0.4)
    # subsequent output does not add a second TTFR sample
    fake_clock.advance(0.1)
    wd.on_output()
    assert len(wd.samples) == 1
    assert wd.p90() == pytest.approx(0.4)


# --- normalize / classify_token --------------------------------------------
def test_normalize_folds_danish():
    assert normalize("STÅ") == "sta"
    assert normalize("æble") == "aeble"
    assert normalize("brød") == "broed"
    assert normalize("Tak!") == "tak "


def test_classify_token():
    bi = BargeIn()
    assert bi.classify_token("stop") == "hard"
    assert bi.classify_token("vent") == "hard"
    assert bi.classify_token("stille") == "hard"
    assert bi.classify_token("tak") == "close"
    assert bi.classify_token("stop nu") == "hard"
    # whole-word only: substrings must NOT fire
    assert bi.classify_token("ventil") is None
    assert bi.classify_token("eventuelt") is None
    assert bi.classify_token("fortak") is None
    assert bi.classify_token("") is None


# --- BargeIn cooldown -------------------------------------------------------
def test_fire_cooldown(fake_clock):
    bi = BargeIn(clock=fake_clock.time)
    assert bi.fire() is True  # first ever fire passes
    assert bi.fire() is False  # immediate second within cooldown is gated
    fake_clock.advance(C.BARGE_COOLDOWN_MS / 1000.0 + 0.01)
    assert bi.fire() is True  # past cooldown -> allowed again
