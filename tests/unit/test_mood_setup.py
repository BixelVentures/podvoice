"""Explicit cold setup transport: consume once, never bootstrap by policy alone."""

import hashlib
import json

import pytest

from gatekeeper import podview_mood_setup as setup
from gatekeeper.podview_mood_budget import OngoingAllowance, OngoingPolicy


@pytest.fixture
def inputs(tmp_path):
    policy = {
        "purpose": "podview_mood_v1",
        "mode": "ongoing",
        "model": "gpt-6-luna",
        "daily_limit": 20,
        "monthly_limit": 200,
        "timezone": "Europe/Copenhagen",
        "room_kind": "kitchen",
        "approval_ref": setup.APPROVAL_REF,
    }
    request = {
        "approval_ref": setup.APPROVAL_REF,
        "policy_sha256": OngoingPolicy.parse(policy).fingerprint,
        "operator_nonce": "a" * 32,
        "expected_finite_sha256": "",
    }
    return tmp_path / "settings.json", policy, request


def apply(inputs):
    path, policy, request = inputs
    return setup.setup_mood_budget(path, json.dumps(policy), json.dumps(request))


def test_default_empty_never_provisions_or_creates_state(inputs, monkeypatch):
    path, policy, _ = inputs
    monkeypatch.setattr(
        OngoingAllowance, "provision", lambda *a, **k: pytest.fail("default provisioned")
    )
    assert setup.setup_mood_budget(path, json.dumps(policy), "")
    assert list(path.parent.iterdir()) == []


def test_cold_setup_repeat_and_restart_only_open_without_reset(inputs, monkeypatch):
    assert apply(inputs)
    path, policy, _ = inputs
    ledger = path.parent / "podview-mood-budget.json"
    owner = OngoingAllowance.open(ledger, OngoingPolicy.parse(policy))
    assert owner.reserve()
    before = ledger.read_bytes()
    monkeypatch.setattr(OngoingAllowance, "provision", lambda *a, **k: pytest.fail("reprovisioned"))
    assert apply(inputs) and apply(inputs)
    assert ledger.read_bytes() == before
    assert json.loads(before)["total_used"] == 1


@pytest.mark.parametrize(
    "lost",
    [
        "ledger",
        "marker",
        "receipt",
        "corrupt_marker",
        "corrupt_receipt",
        "pending",
        "ledger_and_marker",
    ],
)
def test_loss_corruption_partial_state_cannot_recreate_or_refill(inputs, lost):
    assert apply(inputs)
    path, _, _ = inputs
    ledger = path.parent / "podview-mood-budget.json"
    marker = ledger.with_suffix(".initialized")
    receipt = path.parent / "podview-mood-setup.json"
    if lost == "ledger":
        ledger.unlink()
    elif lost == "marker":
        marker.unlink()
    elif lost == "ledger_and_marker":
        ledger.unlink()
        marker.unlink()
    elif lost == "receipt":
        receipt.unlink()
    elif lost == "corrupt_marker":
        marker.write_bytes(b"wrong")
    elif lost == "corrupt_receipt":
        receipt.write_bytes(b"{}")
    else:
        value = json.loads(receipt.read_bytes())
        value["state"] = "pending"
        receipt.write_text(json.dumps(value))
    before = ledger.read_bytes() if ledger.exists() else None
    assert not apply(inputs)
    assert (ledger.read_bytes() if ledger.exists() else None) == before


@pytest.mark.parametrize("changed", ["nonce", "room", "approval", "limits", "path"])
def test_changed_request_policy_or_unknown_path_is_rejected(inputs, changed):
    assert apply(inputs)
    path, policy, request = inputs
    if changed == "nonce":
        request["operator_nonce"] = "b" * 32
    elif changed == "room":
        policy["room_kind"] = "other"  # same quota fingerprint; full saved policy still bound
    elif changed == "approval":
        request["approval_ref"] = "another"
    elif changed == "limits":
        policy["daily_limit"] = 1
    else:
        request["path"] = "/unknown/other-ledger.json"
    assert not apply(inputs)
    assert not (path.parent / "other-ledger.json").exists()


def test_finite_migration_exact_hash_carries_all_prepaid20(inputs):
    path, policy, request = inputs
    ledger = path.parent / "podview-mood-budget.json"
    ledger.write_bytes(b'{"version":1,"used":20}')
    ledger.with_suffix(".initialized").write_bytes(b"podview-mood-allowance-v1")
    request["expected_finite_sha256"] = hashlib.sha256(ledger.read_bytes()).hexdigest()
    assert apply(inputs)
    state = json.loads(ledger.read_bytes())
    assert state["day_used"] == state["month_used"] == state["total_used"] == 20
    assert not OngoingAllowance.open(ledger, OngoingPolicy.parse(policy)).reserve()
    assert apply(inputs)


def test_wrong_finite_hash_consumes_pending_and_cannot_retry(inputs):
    path, _, request = inputs
    ledger = path.parent / "podview-mood-budget.json"
    ledger.write_bytes(b'{"version":1,"used":20}')
    ledger.with_suffix(".initialized").write_bytes(b"podview-mood-allowance-v1")
    request["expected_finite_sha256"] = "0" * 64
    assert not apply(inputs)
    request["expected_finite_sha256"] = hashlib.sha256(ledger.read_bytes()).hexdigest()
    assert not apply(inputs)
    assert json.loads(ledger.read_bytes()) == {"version": 1, "used": 20}


def test_provision_failure_and_restart_never_retries_consumed_request(inputs, monkeypatch):
    calls = []
    monkeypatch.setattr(OngoingAllowance, "provision", lambda *a, **k: calls.append(1) or False)
    assert not apply(inputs) and not apply(inputs)
    assert calls == [1]


def test_complete_receipt_write_failure_stays_pending_without_reprovision(inputs, monkeypatch):
    monkeypatch.setattr(setup, "_atomic_write", lambda *a, **k: (_ for _ in ()).throw(OSError()))
    assert not apply(inputs)
    monkeypatch.setattr(OngoingAllowance, "provision", lambda *a, **k: pytest.fail("reprovisioned"))
    assert not apply(inputs)


def test_relative_settings_path_and_nonempty_invalid_requests_rejected(inputs):
    path, policy, request = inputs
    assert not setup.setup_mood_budget(
        type(path)("settings.json"), json.dumps(policy), json.dumps(request)
    )
    assert not setup.setup_mood_budget(path, json.dumps(policy), "{}")
    assert list(path.parent.iterdir()) == []


def test_setup_authority_only_from_supervisor_never_panel_settings(inputs, monkeypatch):
    import gatekeeper.config as config
    import gatekeeper.settings as settings

    path, _, _ = inputs
    monkeypatch.setattr(settings, "_resolve", lambda _: path)
    monkeypatch.setattr(
        settings, "load_settings", lambda _: {"podview_mood_setup_policy": "attacker"}
    )
    monkeypatch.setattr(config, "load_options", lambda _: {})
    assert config.load_config().podview_mood_setup_policy == ""
    monkeypatch.setattr(config, "load_options", lambda _: {"podview_mood_setup_policy": "operator"})
    assert config.load_config().podview_mood_setup_policy == "operator"
    assert (
        config.from_options(
            {"settings_source_untrusted": True, "podview_mood_setup_policy": "operator"}
        ).podview_mood_setup_policy
        == ""
    )


@pytest.mark.parametrize("ready", [False, True])
def test_setup_call_precedes_selector_and_failed_setup_disables_it(ready, tmp_path):
    import ast
    from pathlib import Path
    from types import SimpleNamespace

    source = (Path(__file__).parents[2] / "podvoice/gatekeeper/__main__.py").read_text()
    tree = ast.parse(source)
    setup_call = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "setup_mood_budget"
    )
    assignment = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Assign)
        and any(
            isinstance(target, ast.Attribute)
            and target.attr == "podview_mood_selector"
            and isinstance(target.value, ast.Name)
            and target.value.id == "tools"
            for target in node.targets
        )
    )
    assert setup_call.lineno < assignment.lineno
    assert [ast.unparse(arg) for arg in setup_call.args] == [
        "settings_path",
        "cfg.podview_mood_policy",
        "cfg.podview_mood_setup_policy",
    ]
    calls = []
    selected = object()

    def factory(*args):
        calls.append(args)
        return selected

    tools = SimpleNamespace()
    client = object()
    cfg = SimpleNamespace(openai_api_key="fixture-key", podview_mood_policy="fixture-policy")
    settings_path = tmp_path / "settings.json"
    namespace = dict(
        tools=tools,
        configured_mood_selector=factory,
        mood_setup_ready=ready,
        ha_client=client,
        cfg=cfg,
        settings_path=settings_path,
    )
    # Execute the actual shipped assignment, independent of its line wrapping.
    exec(
        compile(ast.Module(body=[assignment], type_ignores=[]), "shipped-startup", "exec"),
        namespace,
    )
    if ready:
        assert tools.podview_mood_selector is selected
        assert calls == [
            (
                client,
                cfg.openai_api_key,
                cfg.podview_mood_policy,
                settings_path.parent / "podview-mood-budget.json",
            )
        ]
    else:
        assert tools.podview_mood_selector is None
        assert calls == []


def test_receipt_symlink_rejected_without_touching_target(inputs, tmp_path):
    target = tmp_path / "foreign"
    target.write_bytes(b"unchanged")
    (tmp_path / "podview-mood-setup.json").symlink_to(target)
    assert not apply(inputs) and target.read_bytes() == b"unchanged"
    assert not (tmp_path / "podview-mood-budget.json").exists()


@pytest.mark.parametrize("state", ["complete", "pending"])
def test_clearing_setup_cannot_bypass_durable_consumption(inputs, state):
    assert apply(inputs)
    path, policy, _ = inputs
    receipt = path.parent / "podview-mood-setup.json"
    value = json.loads(receipt.read_bytes())
    value["state"] = state
    receipt.write_text(json.dumps(value))
    assert not setup.setup_mood_budget(path, json.dumps(policy), "")
