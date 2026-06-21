"""Unit tests for the Attention heartbeat (PLAN.md §7.3).

Fast: tiny periods, no jitter, short real sleeps just long enough for a few
beats. Behavior is asserted by counting recorded engage calls on FakeAttention.
"""

from __future__ import annotations

import asyncio

from fakes.fake_attention import FakeAttention

from gatekeeper.heartbeat import Heartbeat
from gatekeeper.podconnect import AttentionDown

PERIOD_MS = 10


def _hb(att: FakeAttention) -> Heartbeat:
    # rand=0 -> no jitter -> deterministic 10ms cadence.
    return Heartbeat(att, period_ms=PERIOD_MS, jitter_ms=0, rand=lambda: 0.0)


async def test_beats_at_period_then_stop_halts():
    att = FakeAttention()
    hb = _hb(att)
    hb.start("kitchen", 5, 2000)
    await asyncio.sleep(0.055)  # ~5-6 beats
    await hb.stop()
    n_at_stop = len(att.engage_calls)
    assert n_at_stop >= 3, f"expected several beats, got {n_at_stop}"
    # All beats targeted the started room/level.
    assert all(c["room"] == "kitchen" and c["level"] == 5 for c in att.engage_calls)

    await asyncio.sleep(0.05)  # no further beats after stop
    assert len(att.engage_calls) == n_at_stop


async def test_retarget_fires_immediate_beat_at_new_level():
    att = FakeAttention()
    hb = _hb(att)
    hb.start("kitchen", 5, 2000)
    await asyncio.sleep(0)  # let the immediate-ish start loop run once
    before = len(att.engage_calls)

    hb.retarget("kitchen", 35, 8000)
    await asyncio.sleep(0.003)  # only a few ms — well under one period
    # An engage at the new level appeared almost immediately.
    new_calls = att.engage_calls[before:]
    assert any(c["level"] == 35 and c["ttl_ms"] == 8000 for c in new_calls), new_calls

    await hb.stop()


async def test_no_stale_generation_engage_after_stop():
    att = FakeAttention()
    hb = _hb(att)
    hb.start("kitchen", 5, 2000)
    await asyncio.sleep(0.025)
    await hb.stop()
    count = len(att.engage_calls)
    # Give any stale in-flight beat a chance to (wrongly) fire.
    await asyncio.sleep(0.04)
    assert len(att.engage_calls) == count


async def test_backoff_under_failure_does_not_crash_and_rate_drops():
    att = FakeAttention(raise_exc=AttentionDown("down"))
    hb = _hb(att)
    hb.start("kitchen", 5, 2000)
    # Backoff base is 0.5s, so within 0.1s we expect very few attempts
    # (one immediate, then a 0.5s backoff sleep) — far fewer than 10ms cadence.
    await asyncio.sleep(0.1)
    failing_count = len(att.engage_calls)
    assert failing_count <= 3, f"expected backoff to throttle, got {failing_count}"
    assert hb._task is not None and not hb._task.done()  # loop survived

    await hb.stop()


async def test_recovers_normal_cadence_after_failure_clears():
    att = FakeAttention(raise_exc=AttentionDown("down"))
    hb = _hb(att)
    hb.start("kitchen", 5, 2000)
    await asyncio.sleep(0.02)  # one failing attempt, now backing off
    att.raise_exc = None
    # First retry after backoff (~0.5s) succeeds and resets cadence to 10ms.
    await asyncio.sleep(0.55)
    resumed = len(att.engage_calls)
    await asyncio.sleep(0.05)  # should add several fast beats now
    assert len(att.engage_calls) > resumed

    await hb.stop()
