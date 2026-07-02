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


def test_tool_window_survives_slow_lookup(fake_clock):
    """A 3-9s tool is legitimate (TOOL_TIMEOUT_S=9): the widened window must not abort
    mid-lookup (the "Senegal" bug — 0.65 only moved the cliff from 1.5s to 3s)."""
    wd = _watchdog(fake_clock)
    wd.arm("turn-1")
    wd.on_output()  # tool call received = first output
    wd.expect_response(C.TOOL_WATCHDOG_S)  # our dispatch starts — widen the window
    fake_clock.advance(C.TOOL_TIMEOUT_S - 1.0)  # an 8s lookup, still inside its budget
    assert wd.check() is None
    wd.expect_response()  # result submitted -> back to the normal TTFR window
    fake_clock.advance(C.WATCHDOG_MS / 1000.0 - 0.5)
    assert wd.check() is None
    fake_clock.advance(1.0)  # but a truly dead post-tool answer still trips
    assert wd.check() == "ttfr"


def test_expect_response_survives_tool_gap(fake_clock):
    """After a tool call the post-tool answer needs reasoning time (> stall). expect_response
    resets to the TTFR window so the stall watchdog doesn't kill a tool-using turn."""
    wd = _watchdog(fake_clock)
    wd.arm("turn-1")
    wd.on_output()  # first audio (the acknowledgment)
    wd.on_output()  # tool call
    wd.expect_response()  # tool result submitted -> a fresh response is coming
    fake_clock.advance(C.STREAM_STALL_MS / 1000.0 + 0.2)  # past the OLD stall window
    assert wd.check() is None  # not killed — waiting on the post-tool answer
    fake_clock.advance(C.WATCHDOG_MS / 1000.0)  # but a genuinely dead follow-up still trips
    assert wd.check() == "ttfr"


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


def test_closure_only_on_pure_politeness():
    """Politeness embedded in a command must NOT close the session mid-turn."""
    bi = BargeIn()
    # pure politeness phrases -> close
    assert bi.classify_token("Tak!") == "close"
    assert bi.classify_token("mange tak") == "close"
    assert bi.classify_token("tusind tak") == "close"
    assert bi.classify_token("tak for hjælpen") == "close"
    assert bi.classify_token("det var alt, tak") == "close"
    assert bi.classify_token("ok tak") == "close"
    # "tak" inside a real command -> NOT a closure (the command must survive)
    assert bi.classify_token("sluk lyset, tak") is None
    assert bi.classify_token("tænd for musikken tak") is None
    assert bi.classify_token("skru op for varmen, tak") is None
    # hard stop still fires even inside a longer utterance
    assert bi.classify_token("nej stop det der") == "hard"


# --- BargeIn cooldown -------------------------------------------------------
def test_fire_cooldown(fake_clock):
    bi = BargeIn(clock=fake_clock.time)
    assert bi.fire() is True  # first ever fire passes
    assert bi.fire() is False  # immediate second within cooldown is gated
    fake_clock.advance(C.BARGE_COOLDOWN_MS / 1000.0 + 0.01)
    assert bi.fire() is True  # past cooldown -> allowed again
