from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import pytest

from gatekeeper import podview_weather_budget as budget


def setup(tmp_path):
    now = [datetime(2026, 10, 23, tzinfo=UTC).timestamp()]
    path = tmp_path / "weather.json"
    allowance = budget.WeatherAllowance.provision(path, clock=lambda: now[0])
    assert allowance is not None
    return path, now, allowance


def test_restart_cooldown_and_no_refund(tmp_path):
    path, now, allowance = setup(tmp_path)
    assert allowance.available and allowance.remaining == 96
    assert allowance.reserve()
    restarted = budget.WeatherAllowance.provision(path, clock=lambda: now[0])
    assert restarted is not None and not restarted.available
    now[0] += 899
    assert not restarted.reserve()
    now[0] += 1
    assert restarted.remaining == 95
    assert restarted.reserve()  # Failed provider sends have no refund API.
    assert budget._read(path)["used"] == 2


def test_concurrent_instances_share_one_attempt(tmp_path):
    path, now, _ = setup(tmp_path)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(
            pool.map(
                lambda _: budget.WeatherAllowance(path, clock=lambda: now[0]).reserve(), range(32)
            )
        )
    assert sum(results) == 1
    assert budget._read(path)["used"] == 1


def test_daily_rollover_never_bypasses_cooldown(tmp_path):
    path, now, allowance = setup(tmp_path)
    for _ in range(96):
        assert allowance.reserve()
        now[0] += 900
    assert budget._read(path)["used"] == 96
    now[0] -= 1
    assert not allowance.reserve()
    now[0] += 1
    assert allowance.remaining == 96
    assert allowance.reserve()
    assert budget._read(path)["used"] == 1


def test_rollback_and_corruption_fail_closed(tmp_path):
    path, now, allowance = setup(tmp_path)
    assert allowance.reserve()
    now[0] -= 1
    assert not allowance.reserve()
    assert budget.WeatherAllowance.provision(path, clock=lambda: now[0]) is None
    path.write_text("{}")
    assert not allowance.available and not allowance.reserve()
    assert budget.WeatherAllowance.provision(path, clock=lambda: now[0]) is None


def test_write_failure_no_send_and_marker_crash_never_refills(tmp_path, monkeypatch):
    path, now, allowance = setup(tmp_path)

    def failed(*args):
        raise OSError("disk failure")

    monkeypatch.setattr(budget.os, "replace", failed)
    assert not allowance.reserve()
    assert budget._read(path)["used"] == 0
    fresh = tmp_path / "fresh.json"
    assert budget.WeatherAllowance.provision(fresh, clock=lambda: now[0]) is None
    monkeypatch.undo()
    assert budget.WeatherAllowance.provision(fresh, clock=lambda: now[0]) is None


def test_post_replace_sync_failure_consumes_attempt(tmp_path, monkeypatch):
    path, _now, allowance = setup(tmp_path)
    monkeypatch.setattr(budget, "_sync_directory", lambda _: (_ for _ in ()).throw(OSError()))
    assert not allowance.reserve()
    monkeypatch.undo()
    assert budget._read(path)["used"] == 1
    assert not allowance.reserve()


@pytest.mark.asyncio
async def test_async_reserves_durably(tmp_path):
    path, _, allowance = setup(tmp_path)
    assert await allowance.reserve_async()
    assert budget._read(path)["used"] == 1
    assert not await allowance.reserve_async()


def test_availability_never_reads_filesystem(tmp_path, monkeypatch):
    _path, now, allowance = setup(tmp_path)

    def forbidden(*args, **kwargs):
        raise AssertionError("availability must not touch disk")

    monkeypatch.setattr(budget, "_read", forbidden)
    monkeypatch.setattr(budget, "_lock", forbidden)
    assert allowance.available and allowance.remaining == 96
    now[0] -= 1
    assert not allowance.available


def test_stale_hint_cannot_admit_second_instance(tmp_path):
    path, now, first = setup(tmp_path)
    second = budget.WeatherAllowance.provision(path, clock=lambda: now[0])
    assert second is not None
    assert first.reserve()
    assert second.available  # Advisory only; the shared ledger owns admission.
    assert not second.reserve()
    assert not second.available
