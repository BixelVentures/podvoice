"""Offline command bounds; a flag is operator acknowledgement, never stop proof."""

import importlib.util
import json
from pathlib import Path

import pytest


@pytest.fixture
def command():
    path = Path(__file__).parents[2] / "scripts" / "provision_mood_budget.py"
    spec = importlib.util.spec_from_file_location("mood_operator", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def operator_files(tmp_path):
    policy = {
        "purpose": "podview_mood_v1", "mode": "ongoing", "model": "gpt-6-luna",
        "daily_limit": 20, "monthly_limit": 200, "timezone": "Europe/Copenhagen",
        "room_kind": "kitchen", "approval_ref": "call_995d972f52084767a6f728e3706488da",
    }
    path = tmp_path / "policy.json"
    path.write_text(json.dumps(policy))
    return policy, path, tmp_path / "podview-mood-budget.json"


@pytest.mark.parametrize("mutation", ["approval_ref", "daily_limit", "monthly_limit", "extra"])
def test_operator_rejects_contract_change_without_touching_ledger(command, operator_files, mutation):
    policy, path, ledger = operator_files
    policy[mutation] = "other" if mutation == "approval_ref" else 1
    path.write_text(json.dumps(policy))
    with pytest.raises(SystemExit) as rejected:
        command.main(["--ledger", str(ledger), "--policy-file", str(path), "--owner-stopped"])
    assert rejected.value.code == 1
    assert not ledger.exists() and not ledger.with_suffix(".initialized").exists()


def test_operator_requires_stop_acknowledgement(command, operator_files):
    _, path, ledger = operator_files
    with pytest.raises(SystemExit):
        command.main(["--ledger", str(ledger), "--policy-file", str(path)])
    assert not ledger.exists()


def test_operator_cold_bootstrap_and_idempotence_do_not_reserve(command, operator_files):
    _, path, ledger = operator_files
    args = ["--ledger", str(ledger), "--policy-file", str(path), "--owner-stopped"]
    assert command.main(args) == 0
    before = ledger.read_bytes()
    assert json.loads(before)["total_used"] == 0
    assert command.main(args) == 0 and ledger.read_bytes() == before


def test_operator_finite_requires_exact_hash_and_carries_all_prepaid(command, operator_files):
    import hashlib

    _, path, ledger = operator_files
    ledger.write_bytes(b'{"version":1,"used":20}')
    ledger.with_suffix(".initialized").write_bytes(b"podview-mood-allowance-v1")
    before = ledger.read_bytes()
    args = ["--ledger", str(ledger), "--policy-file", str(path), "--owner-stopped"]
    with pytest.raises(SystemExit):
        command.main(args)
    assert ledger.read_bytes() == before
    assert command.main([*args, "--expected-finite-sha256", hashlib.sha256(before).hexdigest()]) == 0
    state = json.loads(ledger.read_bytes())
    assert state["day_used"] == state["month_used"] == state["total_used"] == 20
