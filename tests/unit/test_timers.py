"""Kitchen timers: set/list/cancel + the expiry announce (0.67)."""

from __future__ import annotations

import asyncio

from gatekeeper.timers import MAX_TIMERS, TimerManager


def _manager():
    rung: list[str] = []

    async def announce(label: str) -> None:
        rung.append(label)

    return TimerManager(announce), rung


async def test_set_list_cancel():
    tm, rung = _manager()
    r = tm.set_timer(600, "pasta")
    assert r["ok"] and r["seconds"] == 600
    listed = tm.list_timers()["timers"]
    assert listed[0]["label"] == "pasta" and 595 <= listed[0]["remaining_s"] <= 600
    assert tm.cancel_timer(r["id"])["ok"] is True
    assert tm.list_timers()["timers"] == []
    assert rung == []  # cancelled timers never ring
    await tm.aclose()


async def test_expiry_announces():
    tm, rung = _manager()
    tm.set_timer(1, "æg")
    await asyncio.sleep(1.3)
    assert rung == ["æg"]
    assert tm.list_timers()["timers"] == []  # expired timers are gone
    await tm.aclose()


async def test_cancel_without_id_takes_next_to_expire():
    tm, _ = _manager()
    tm.set_timer(600, "senere")
    first = tm.set_timer(60, "først")
    r = tm.cancel_timer()  # spoken case: "annuller timeren"
    assert r["ok"] and r["id"] == first["id"]
    await tm.aclose()


async def test_bounds():
    tm, _ = _manager()
    assert tm.set_timer(0)["ok"] is False
    for _ in range(MAX_TIMERS):
        assert tm.set_timer(600)["ok"] is True
    assert tm.set_timer(600)["ok"] is False  # cap
    await tm.aclose()
