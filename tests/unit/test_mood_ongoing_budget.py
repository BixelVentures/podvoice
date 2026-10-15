"""Durability and calendar admission only; no model/provider/device I/O."""

import asyncio
import fcntl
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest

from gatekeeper.podview_enrichment import RequestAllowance
from gatekeeper.podview_mood_budget import OngoingAllowance, OngoingPolicy


class Clock:
    def __init__(self, text="2026-01-10T10:00:00"):
        self.set(text)

    def set(self, text):
        self.value = (
            datetime.fromisoformat(text).replace(tzinfo=ZoneInfo("Europe/Copenhagen")).timestamp()
        )

    def __call__(self):
        return self.value


def setup(tmp_path, daily=2, monthly=3):
    path, policy, clock = (
        tmp_path / "podview-mood-budget.json",
        OngoingPolicy(daily, monthly, "TEST-ONLY"),
        Clock(),
    )
    assert OngoingAllowance.provision(path, policy, clock=clock)
    allowance = OngoingAllowance.open(path, policy, clock=clock)
    assert allowance is not None
    return path, policy, clock, allowance


def state(path):
    return json.loads(path.read_text())


def test_open_never_provisions_or_migrates_and_policy_has_no_count_defaults(tmp_path):
    path, policy = tmp_path / "budget.json", OngoingPolicy(2, 3, "TEST")
    assert OngoingAllowance.open(path, policy) is None
    assert list(tmp_path.iterdir()) == []
    for daily, monthly in ((True, 20), (0, 20), (21, 100), (20, 19), (20, 201)):
        with pytest.raises(ValueError):
            OngoingPolicy(daily, monthly, "TEST")


def test_daily_monthly_rollover_restart_and_no_unused_carry(tmp_path):
    path, policy, clock, owner = setup(tmp_path)
    assert owner.reserve() and owner.reserve() and not owner.reserve()
    assert state(path)["total_used"] == 2
    restarted = OngoingAllowance.open(path, policy, clock=clock)
    assert restarted is not None and restarted.remaining == 0 and not restarted.reserve()
    clock.set("2026-01-11T00:00:00")
    assert restarted.remaining == 1 and restarted.reserve() and not restarted.reserve()
    clock.set("2026-01-20T12:00:00")
    assert restarted.remaining == 0 and not restarted.reserve()
    clock.set("2026-02-01T00:00:00")
    assert restarted.reserve()
    value = state(path)
    assert (value["day_used"], value["month_used"], value["total_used"]) == (1, 1, 4)
    assert restarted.remaining == 1  # unused days do not accumulate capacity


def test_provision_is_idempotent_not_a_restart_or_policy_refill(tmp_path):
    path, policy, clock, owner = setup(tmp_path)
    assert owner.reserve()
    before = path.read_bytes()
    assert OngoingAllowance.provision(path, policy, clock=clock)
    assert path.read_bytes() == before
    for changed in (replace(policy, approval_ref="ANOTHER"), replace(policy, monthly_limit=4)):
        assert not OngoingAllowance.provision(path, changed, clock=clock)
        assert OngoingAllowance.open(path, changed, clock=clock) is None
        assert path.read_bytes() == before


def test_persistent_clock_rollback_never_reopens_an_earlier_period(tmp_path):
    path, policy, clock, owner = setup(tmp_path)
    assert owner.reserve()
    clock.set("2026-01-11T01:00:00")
    assert owner.reserve()
    before = path.read_bytes()
    clock.set("2026-01-10T20:00:00")
    assert owner.remaining == 0 and not owner.reserve()
    assert OngoingAllowance.open(path, policy, clock=clock) is None
    assert not OngoingAllowance.provision(path, policy, clock=clock)
    assert path.read_bytes() == before
    clock.set("2026-01-11T01:00:00")
    assert owner.reserve() and not owner.reserve()  # remaining monthly capacity only


def test_dst_repeated_local_hour_is_not_a_second_day(tmp_path):
    path, _, clock, owner = setup(tmp_path)
    # Two different UTC instants within the repeated local02hour, same Copenhagen day.
    clock.value = datetime.fromisoformat("2026-10-25T00:30:00+00:00").timestamp()
    assert owner.reserve()
    clock.value = datetime.fromisoformat("2026-10-25T01:30:00+00:00").timestamp()
    assert owner.reserve() and not owner.reserve()
    assert state(path)["day"] == "2026-10-25" and state(path)["day_used"] == 2


def test_concurrent_owners_cannot_overspend_or_lose_successful_reservations(tmp_path):
    path, policy, clock, _ = setup(tmp_path)
    owners = [OngoingAllowance.open(path, policy, clock=clock) for _ in range(24)]
    with ThreadPoolExecutor(max_workers=12) as pool:
        accepted = list(pool.map(lambda owner: owner.reserve(), owners))
    count = sum(accepted)
    assert 1 <= count <= 2
    assert (
        state(path)["day_used"] == state(path)["month_used"] == state(path)["total_used"] == count
    )


def test_contended_same_purpose_lock_rejects_without_wait_or_write(tmp_path):
    path, _, _, owner = setup(tmp_path)
    before = path.read_bytes()
    with path.with_suffix(".lock").open("r+") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert not owner.reserve()
    assert path.read_bytes() == before


@pytest.mark.parametrize("mutation", ["missing", "malformed", "period", "boolean", "wrong_policy"])
def test_damaged_state_is_never_reinitialized_or_refilled(tmp_path, mutation):
    path, policy, clock, owner = setup(tmp_path)
    if mutation == "missing":
        path.unlink()
    elif mutation == "malformed":
        path.write_text('{"version":2,"version":1}')
    else:
        value = state(path)
        value[
            {"period": "day", "boolean": "day_used", "wrong_policy": "policy_sha256"}[mutation]
        ] = {"period": "2026-01-09", "boolean": True, "wrong_policy": "0" * 64}[mutation]
        path.write_text(json.dumps(value))
    assert not owner.reserve()
    assert OngoingAllowance.open(path, policy, clock=clock) is None
    assert not OngoingAllowance.provision(path, policy, clock=clock)


@pytest.mark.parametrize("special", ["symlink", "hardlink", "fifo"])
def test_non_regular_or_linked_state_fails_closed_without_blocking(tmp_path, special):
    path, policy, clock, owner = setup(tmp_path)
    saved = tmp_path / "saved.json"
    path.rename(saved)
    if special == "symlink":
        path.symlink_to(saved)
    elif special == "hardlink":
        os.link(saved, path)
    else:
        os.mkfifo(path)
    assert not owner.reserve()
    assert OngoingAllowance.open(path, policy, clock=clock) is None


def test_failure_before_commit_never_admits_and_failure_after_commit_never_refunds(tmp_path):
    path, _, _, owner = setup(tmp_path)
    before = path.read_bytes()
    with patch(
        "gatekeeper.podview_mood_budget.os.replace", side_effect=OSError("inert disk failure")
    ):
        assert not owner.reserve()
    assert path.read_bytes() == before
    with patch(
        "gatekeeper.podview_mood_budget._directory_sync",
        side_effect=OSError("inert post-commit failure"),
    ):
        assert not owner.reserve()
    assert state(path)["total_used"] == 1
    assert owner.reserve() and not owner.reserve()


def test_exact_finite_migration_carries_entire_prepaid_bundle_and_blocks_finite_reopen(tmp_path):
    path, clock = tmp_path / "budget.json", Clock()
    finite = RequestAllowance.prepare(path, 20, purpose="mood")
    assert finite is not None
    raw = path.read_bytes()
    policy = OngoingPolicy(20, 200, "FUTURE-TEST-APPROVAL")
    assert not OngoingAllowance.provision(path, policy, clock=clock)
    assert path.read_bytes() == raw
    assert not OngoingAllowance.provision(
        path, policy, clock=clock, expected_finite_sha256="0" * 64
    )
    assert OngoingAllowance.provision(
        path, policy, clock=clock, expected_finite_sha256=hashlib.sha256(raw).hexdigest()
    )
    owner = OngoingAllowance.open(path, policy, clock=clock)
    assert owner is not None and owner.remaining == 0 and not owner.reserve()
    assert RequestAllowance.prepare(path, 20, purpose="mood") is None
    clock.set("2026-01-11T00:00:00")
    assert owner.remaining == 20 and owner.reserve()
    assert state(path)["month_used"] == 21 and state(path)["total_used"] == 21


async def test_async_reservation_is_off_loop_and_cancelled_attempt_is_not_refunded(tmp_path):
    import threading

    path, _, _, owner = setup(tmp_path)
    started, release, completed = threading.Event(), threading.Event(), threading.Event()
    original = owner.reserve

    def held():
        started.set()
        release.wait(1)
        result = original()
        completed.set()
        return result

    owner.reserve = held
    task = asyncio.create_task(owner.reserve_async())
    assert await asyncio.to_thread(started.wait, 1)
    # Event loop is still usable while disk owner runs in its worker.
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    release.set()
    assert await asyncio.to_thread(completed.wait, 1)
    assert state(path)["total_used"] == 1


def test_initialization_crash_gap_is_sticky_fail_closed_not_a_free_reset(tmp_path):
    path, policy, clock = tmp_path / "budget.json", OngoingPolicy(2, 3, "TEST"), Clock()
    with patch(
        "gatekeeper.podview_mood_budget._atomic_write", side_effect=OSError("inert crash gap")
    ):
        assert not OngoingAllowance.provision(path, policy, clock=clock)
    assert path.with_suffix(".initialized").exists() and not path.exists()
    assert OngoingAllowance.open(path, policy, clock=clock) is None
    assert not OngoingAllowance.provision(path, policy, clock=clock)


@pytest.mark.parametrize("invalid_clock", [float("nan"), float("inf"), -1, True])
def test_invalid_budget_clock_never_spends_or_resets_state(tmp_path, invalid_clock):
    path, policy, _, owner = setup(tmp_path)
    before = path.read_bytes()
    owner.clock = lambda: invalid_clock
    assert owner.remaining == 0 and not owner.reserve()
    assert OngoingAllowance.open(path, policy, clock=lambda: invalid_clock) is None
    assert path.read_bytes() == before


def test_visual_allowance_cannot_be_migrated_into_mood_even_with_exact_file_hash(tmp_path):
    path, policy, clock = tmp_path / "budget.json", OngoingPolicy(2, 3, "TEST"), Clock()
    assert RequestAllowance.prepare(path, 2, purpose="visual") is not None
    raw = path.read_bytes()
    assert not OngoingAllowance.provision(
        path, policy, clock=clock, expected_finite_sha256=hashlib.sha256(raw).hexdigest()
    )
    assert path.read_bytes() == raw


def test_ongoing_class_cannot_inherit_finite_bundle_provisioning(tmp_path):
    assert OngoingAllowance.prepare(tmp_path / "budget.json", 20, purpose="mood") is None
    assert list(tmp_path.iterdir()) == []


def test_missing_calendar_timezone_fails_closed_without_a_utc_refill(tmp_path):
    from zoneinfo import ZoneInfoNotFoundError

    path, policy, clock, owner = setup(tmp_path)
    before = path.read_bytes()
    with patch(
        "gatekeeper.podview_mood_budget.ZoneInfo",
        side_effect=ZoneInfoNotFoundError("inert unavailable timezone"),
    ):
        assert owner.remaining == 0 and not owner.reserve()
        assert OngoingAllowance.open(path, policy, clock=clock) is None
    assert path.read_bytes() == before
