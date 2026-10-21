"""No real provider: finite grant admission, replay and durable failure regressions."""

import asyncio
import fcntl
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import httpx
import pytest

from gatekeeper import podview_visual_grant as grants
from gatekeeper.podview_enrichment import RequestAllowance
from gatekeeper.provider_budget import ProviderBudgetCoordinator


def policy(**changes):
    value = {
        "purpose": "podview_visual_v1",
        "model": "gpt-6-luna",
        "max_requests": 20,
        "grant_id": "a" * 32,
        "approval_ref": "test-approval-20261021-visual-1",
    }
    value.update(changes)
    return json.dumps(value)


@pytest.fixture
def client():
    def unexpected(request):
        pytest.fail("grant startup must never contact a provider")

    return httpx.AsyncClient(transport=httpx.MockTransport(unexpected))


def start(client, directory, raw=None, key="fake-key"):
    return grants.configured_visual_selector(
        client,
        key,
        '{"model":"gpt-6-luna","max_requests":20}',
        directory / "podview-visual-budget.json",
        policy() if raw is None else raw,
    )


def files(directory):
    return {path.name: path.read_bytes() for path in directory.iterdir() if path.is_file()}


def paths(directory):
    approval = hashlib.sha256(json.loads(policy())["approval_ref"].encode()).hexdigest()
    return (
        directory / f"podview-visual-approval-{approval}.approval",
        directory / f"podview-visual-grant-{'a' * 32}.approval",
        directory / f"podview-visual-grant-{'a' * 32}.json",
    )


@pytest.mark.parametrize(
    "raw",
    [
        " ",
        "{}",
        "[]",
        policy(max_requests=True),
        policy(max_requests=0),
        policy(max_requests=21),
        policy(max_requests=1.0),
        policy(model="other"),
        policy(purpose="mood"),
        policy(grant_id="../unsafe"),
        policy(approval_ref=""),
        policy(approval_ref="x" * 161),
        policy(approval_ref="ref with space"),
        policy(extra=True),
        policy()[:-1] + ',"max_requests":20}',
        "x" * 1025,
    ],
)
def test_invalid_explicit_grant_never_falls_back_or_writes(client, tmp_path, raw):
    assert start(client, tmp_path, raw) is None
    assert list(tmp_path.iterdir()) == []


def test_missing_key_has_no_durable_effect(client, tmp_path):
    assert start(client, tmp_path, key="") is None
    assert list(tmp_path.iterdir()) == []


def test_empty_option_preserves_exact_legacy_admission(client, tmp_path):
    selector = start(client, tmp_path, "")
    assert selector is not None and selector.allowance.remaining == 20
    assert not any("grant-" in name or "approval-" in name for name in files(tmp_path))
    assert start(client, tmp_path, "") is None


def test_one_startup_bundle_legacy_bytes_untouched_and_unused_lost(client, tmp_path):
    legacy = tmp_path / "podview-visual-budget.json"
    assert RequestAllowance.prepare(legacy, 20) is not None
    before = files(tmp_path)
    selector = start(client, tmp_path)
    assert selector is not None and selector.available and selector.allowance.remaining == 20
    assert all((tmp_path / name).read_bytes() == content for name, content in before.items())
    reserved = files(tmp_path)
    # Restart loses the still-unused in-memory20, with no refund or refill.
    assert start(client, tmp_path) is None
    assert files(tmp_path) == reserved
    assert [selector.allowance.reserve() for _ in range(21)] == [True] * 20 + [False]
    assert not selector.available
    assert start(client, tmp_path) is None


@pytest.mark.parametrize(
    "changes",
    [
        {"max_requests": 19},
        {"approval_ref": "different-approval"},
        {"grant_id": "b" * 32},
    ],
)
def test_changed_binding_or_reused_approval_fails_closed(client, tmp_path, changes):
    assert start(client, tmp_path) is not None
    before = files(tmp_path)
    assert start(client, tmp_path, policy(**changes)) is None
    assert all((tmp_path / name).read_bytes() == data for name, data in before.items())
    assert not (tmp_path / f"podview-visual-grant-{'b' * 32}.json").exists()


def test_distinct_explicit_approval_and_id_are_separate_finite_grant(client, tmp_path):
    assert start(client, tmp_path) is not None
    selector = start(
        client,
        tmp_path,
        policy(grant_id="b" * 32, approval_ref="new-human-approval", max_requests=1),
    )
    assert selector is not None and selector.allowance.remaining == 1
    assert selector.allowance.reserve() and not selector.allowance.reserve()
    assert (
        start(
            client,
            tmp_path,
            policy(grant_id="b" * 32, approval_ref="new-human-approval", max_requests=1),
        )
        is None
    )


@pytest.mark.parametrize("index", [0, 1, 2])
def test_missing_or_partial_files_are_not_repaired(client, tmp_path, index):
    assert start(client, tmp_path) is not None
    target = paths(tmp_path)[index]
    target.unlink()
    before = files(tmp_path)
    assert start(client, tmp_path) is None
    assert files(tmp_path) == before and not target.exists()


@pytest.mark.parametrize("kind", ["partial", "symlink", "hardlink", "fifo"])
@pytest.mark.parametrize("index", [0, 1, 2])
def test_corrupt_or_nonregular_durable_files_fail_closed(client, tmp_path, index, kind):
    assert start(client, tmp_path) is not None
    target = paths(tmp_path)[index]
    target.unlink()
    if kind == "partial":
        target.write_bytes(b"{")
    elif kind == "symlink":
        target.symlink_to(tmp_path / "missing-target")
    elif kind == "hardlink":
        other = tmp_path / "other"
        other.write_bytes(b"{}")
        os.link(other, target)
    else:
        os.mkfifo(target)
    assert start(client, tmp_path) is None
    assert os.path.lexists(target)


def test_missing_both_bindings_cannot_rebaseline_existing_bundle(client, tmp_path):
    assert start(client, tmp_path, policy(max_requests=1)) is not None
    for path in paths(tmp_path)[:2]:
        path.unlink()
    assert start(client, tmp_path) is None
    assert not paths(tmp_path)[0].exists() and not paths(tmp_path)[1].exists()


def test_crash_after_bindings_before_reservation_conservatively_loses_grant(client, tmp_path):
    with patch.object(RequestAllowance, "prepare", return_value=None):
        assert start(client, tmp_path) is None
    assert all(path.exists() for path in paths(tmp_path)[:2])
    assert not paths(tmp_path)[2].exists()
    before = files(tmp_path)
    assert start(client, tmp_path) is None
    assert files(tmp_path) == before
    assert not paths(tmp_path)[2].exists()


def test_marker_without_ledger_never_refunds_after_interruption(client, tmp_path):
    assert start(client, tmp_path) is not None
    paths(tmp_path)[2].unlink()
    assert start(client, tmp_path) is None


def test_concurrent_startups_reserve_at_most_one_bundle(client, tmp_path):
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: start(client, tmp_path), range(2)))
    assert sum(selector is not None for selector in results) == 1
    assert start(client, tmp_path) is None


def test_grant_is_supervisor_only_and_corrupt_settings_deny_it(monkeypatch, tmp_path):
    from gatekeeper import config, settings

    monkeypatch.setattr(settings, "_resolve", lambda path: tmp_path / "settings.json")
    monkeypatch.setattr(
        settings, "load_settings", lambda path: {"podview_visual_grant": "attacker"}
    )
    monkeypatch.setattr(
        config, "load_options", lambda path=None: {"podview_visual_grant": policy()}
    )
    assert config.load_config().podview_visual_grant == policy()
    monkeypatch.setattr(config, "load_options", lambda path=None: {})
    assert config.load_config().podview_visual_grant == ""
    assert (
        config.from_options(
            {"settings_source_untrusted": True, "podview_visual_grant": policy()}
        ).podview_visual_grant
        == ""
    )


def test_symlink_data_directory_is_not_admitted(client, tmp_path):
    actual = tmp_path / "actual"
    actual.mkdir()
    linked = tmp_path / "linked"
    linked.symlink_to(actual, target_is_directory=True)
    assert start(client, linked) is None
    assert list(actual.iterdir()) == []


def test_locked_first_reservation_loses_grant_without_refill(client, tmp_path):
    prepare = RequestAllowance.prepare

    def locked_prepare(path, maximum):
        with path.with_suffix(".lock").open("w") as guard:
            fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return prepare(path, maximum)

    with patch.object(RequestAllowance, "prepare", side_effect=locked_prepare):
        assert start(client, tmp_path) is None
    assert not paths(tmp_path)[2].exists()
    before = files(tmp_path)
    assert start(client, tmp_path) is None
    assert files(tmp_path) == before


@pytest.mark.parametrize("outcome", ["network_unknown", "cancel", "refusal"])
async def test_attempt_outcomes_never_refund_grant_or_legacy(tmp_path, outcome):
    from unit.test_podview_visual_value import content

    calls = []

    def respond(request):
        calls.append(request)
        assert json.loads(paths(tmp_path)[2].read_text())["used"] == 1
        if outcome == "network_unknown":
            raise httpx.ReadError("synthetic unknown outcome")
        if outcome == "cancel":
            raise asyncio.CancelledError
        return httpx.Response(429)

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        selector = start(client, tmp_path, policy(max_requests=1))
        assert selector is not None
        selector.budget = ProviderBudgetCoordinator()
        if outcome == "cancel":
            with pytest.raises(asyncio.CancelledError):
                await selector.select(content(), current=lambda: True)
        else:
            assert await selector.select(content(), current=lambda: True) is None
        assert len(calls) == 1 and selector.allowance.remaining == 0
        assert await selector.select(content(), current=lambda: True) is None
        assert len(calls) == 1
        assert start(client, tmp_path, policy(max_requests=1)) is None
        assert not (tmp_path / "podview-visual-budget.json").exists()


def test_complete_reservation_file_loss_never_reopens_same_approval(client, tmp_path):
    raw = policy(max_requests=1)
    selector = start(client, tmp_path, raw)
    assert selector is not None and selector.allowance.reserve()
    assert not selector.allowance.reserve()
    ledger = paths(tmp_path)[2]
    for path in (ledger, ledger.with_suffix(".initialized"), ledger.with_suffix(".lock")):
        path.unlink()
    before = files(tmp_path)
    assert all(path.exists() for path in paths(tmp_path)[:2])
    for _ in range(3):
        assert start(client, tmp_path, raw) is None
        assert files(tmp_path) == before
    assert not ledger.exists()


def test_complete_but_rolled_back_counter_never_reopens_bound_grant(client, tmp_path):
    selector = start(client, tmp_path)
    assert selector is not None
    assert all(selector.allowance.reserve() for _ in range(20))
    ledger = paths(tmp_path)[2]
    assert json.loads(ledger.read_text())["used"] == 20
    ledger.write_text('{"version":1,"used":1}')
    before = files(tmp_path)
    assert start(client, tmp_path) is None
    assert files(tmp_path) == before
