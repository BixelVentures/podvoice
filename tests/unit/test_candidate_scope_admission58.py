"""Talk58 exact admission preserves published57 and rejects unreviewed drift."""

import json
import os
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission57 as published57
from scripts import candidate_scope_admission58 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED57_MERGE = "8dd2f725ff43e1d1bcb0d2ea35d3ae64b055b0c5"
PUBLISHED57_TREE = "08264d653b84261af1c65af428d93319e78e8f74"


@pytest.fixture(scope="module")
def historical57_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published57") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED57_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED57_TREE], cwd=target, check=True)
    return target


PUBLISHED58_MERGE = "78d9dc7528b964d2986e50eee31ecdd0d942571b"
PUBLISHED58_TREE = "b1bb80eed2ee54a2dd6e5b15b7e0a4044b6f19d5"


@pytest.fixture(scope="module")
def historical58_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published58") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED58_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED58_TREE], cwd=target, check=True)
    return target


def test_58_exact_scope_and_history(historical58_root):
    assert admission.BASE == PUBLISHED57_MERGE
    assert admission.VERSION == 35
    assert admission.KIND == "talk58_pending_receipt_lifecycle"
    assert admission.DOMAINS == ("unclassified_runtime",)
    assert admission.PRODUCTION == {"podvoice/gatekeeper/static/index.html"}
    assert admission.REQUIRED_TESTS == {
        "tests/browser/daily_ui.cjs",
        "tests/browser/talk_text_contract.cjs",
        "tests/unit/test_live_alpha_settings.py",
        "tests/unit/test_panel_contract.py",
        "tests/unit/test_candidate_scope_admission57.py",
        "tests/unit/test_candidate_scope_admission58.py",
        "tests/unit/test_ci_promotion.py",
        "tests/unit/test_dev_cycle.py",
    }
    assert admission.HA_RUNTIME == published57.HA_RUNTIME
    assert admission.CONFIG == {
        "podvoice/config.yaml",
        "podvoice/gatekeeper/__init__.py",
        "pyproject.toml",
    }
    assert admission.ASSET_COUNT == 143
    assert admission.IMMUTABLE.items() >= published57.IMMUTABLE.items()
    assert admission.strict.pins_match(historical58_root, admission.IMMUTABLE)
    assert admission.config_only(historical58_root)
    report = admission.legacy.inspect_repository(historical58_root, admission.BASE)
    assert report.domains == admission.DOMAINS
    effective = admission.legacy._visual_repository_changes(historical58_root, admission.BASE)
    assert admission.production_scope_matches(effective)
    assert {p for p in effective if p.startswith("tests/")} == admission.REQUIRED_TESTS
    assert admission.change_scope_matches(effective, set(admission.REQUIRED_TESTS))
    bindings = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert len({bool(value) for value in bindings}) == 1
    assert admission.inspect_repository(historical58_root, admission.BASE).passed == all(bindings)


def test_58_manifest_exact_inventory(historical58_root):
    manifest = json.loads(admission.safe_file(historical58_root, admission.MANIFEST))
    assert manifest["schema"] == "podvoice58.admission.v1"
    assert manifest["base"] == admission.BASE
    assert manifest["asset_count"] == admission.ASSET_COUNT == 143
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert (
        set(manifest["runtime"])
        == admission.strict.runtime_inventory(historical58_root) | admission.HA_RUNTIME
    )
    assert set(manifest["config"]) == admission.CONFIG
    assert set(manifest["policy"]) == admission.POLICY - {admission.PROFILE, admission.MANIFEST}
    assert set(manifest["tooling"]) == admission.TOOLING
    for group in ("production", "regressions", "runtime", "config", "policy", "tooling"):
        assert admission.strict.pins_match(historical58_root, manifest[group])
    assert admission.assets_match58(historical58_root, manifest["runtime"], manifest["asset_count"])


def test_published57_accepted_and_cannot_authorize58(historical57_root):
    assert published57.inspect_repository(historical57_root, published57.BASE).passed
    record = published57.record_at(historical57_root)
    report = admission.legacy.inspect_repository(historical57_root, admission.BASE)
    assert record is not None
    assert not admission.validate(historical57_root, report, PUBLISHED57_MERGE, record)


@pytest.mark.parametrize("binding", ["BASE", "REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_58_cli_closed_with_missing_binding(monkeypatch, capsys, binding):
    monkeypatch.setattr(admission, binding, "")
    assert admission.main(["--base", PUBLISHED57_MERGE]) == 2
    assert "review bindings are not complete" in capsys.readouterr().err


@pytest.fixture
def synthetic_record(monkeypatch, historical58_root):
    """Transient validator preconditions only; never persisted as review authority."""
    reviewer = "Synthetic test-only reviewer"
    manifest_sha = admission.sha(admission.safe_file(historical58_root, admission.MANIFEST))
    monkeypatch.setattr(admission, "REVIEWER", reviewer)
    monkeypatch.setattr(admission, "MANIFEST_SHA", manifest_sha)
    monkeypatch.setattr(
        admission,
        "PROFILE_AST",
        admission.strict.ast_sha(
            admission.safe_file(historical58_root, admission.PROFILE), "PROFILE_AST"
        ),
    )
    return {
        "version": admission.VERSION,
        "kind": admission.KIND,
        "reviewer": reviewer,
        "domains": list(admission.DOMAINS),
        "base_tip": admission.BASE,
        "merge_base": admission.BASE,
        "rationale": "Synthetic validator regression; never persisted as admission authority.",
        "fingerprint": admission.legacy.production_fingerprint(
            historical58_root, admission.BASE, admission.BASE, tuple(admission.PRODUCTION)
        ),
        "regression_fingerprint": admission.legacy.regression_fingerprint(
            historical58_root, admission.BASE, admission.BASE, tuple(admission.REQUIRED_TESTS)
        ),
        "runtime_fingerprint": admission.strict.fingerprint(
            historical58_root,
            admission.strict.runtime_inventory(historical58_root) | admission.HA_RUNTIME,
        ),
        "config_fingerprint": admission.strict.fingerprint(historical58_root, admission.CONFIG),
        "policy_fingerprint": admission.strict.fingerprint(historical58_root, admission.POLICY),
        "tooling_fingerprint": admission.strict.fingerprint(historical58_root, admission.TOOLING),
        "manifest_fingerprint": manifest_sha,
    }


def test_58_full_validator_accepts_58_and_rejects_57_schema(
    monkeypatch, synthetic_record, historical58_root
):
    report = admission.legacy.inspect_repository(historical58_root, admission.BASE)
    assert admission.validate(historical58_root, report, admission.BASE, synthetic_record)
    wrong = json.loads(admission.safe_file(historical58_root, admission.MANIFEST))
    wrong["schema"] = "podvoice57.admission.v1"
    wrong_raw = json.dumps(wrong).encode()
    real_safe_file = admission.safe_file
    monkeypatch.setattr(
        admission,
        "safe_file",
        lambda root, name: wrong_raw if name == admission.MANIFEST else real_safe_file(root, name),
    )
    monkeypatch.setattr(admission, "MANIFEST_SHA", admission.sha(wrong_raw))
    synthetic_record["manifest_fingerprint"] = admission.sha(wrong_raw)
    assert not admission.validate(historical58_root, report, admission.BASE, synthetic_record)


@pytest.mark.parametrize(
    "name",
    [
        "custom_components/podvoice/display_devices.py",
        "podvoice/gatekeeper/static/podview/weather-view.js",
        "podvoice/gatekeeper/talk.py",
    ],
)
def test_58_rejects_actual_unreviewed_production_drift(synthetic_record, name, historical58_root):
    report = admission.legacy.inspect_repository(historical58_root, admission.BASE)
    assert admission.validate(historical58_root, report, admission.BASE, synthetic_record)
    path = historical58_root / name
    before = path.read_bytes()
    try:
        path.write_bytes(before + b"\n")
        effective = admission.legacy._visual_repository_changes(historical58_root, admission.BASE)
        assert not admission.production_scope_matches(effective)
        assert not admission.change_scope_matches(effective, set(admission.REQUIRED_TESTS))
        assert not admission.validate(historical58_root, report, admission.BASE, synthetic_record)
    finally:
        path.write_bytes(before)


@pytest.mark.parametrize(
    "base,profile",
    [
        (PUBLISHED57_MERGE, "candidate_scope_admission58.py"),
        (published57.BASE, "candidate_scope_admission57.py"),
        ("a97b6658f3d5cd20a5c5d0396a3c07253eae5963", "candidate_scope_admission56.py"),
    ],
)
def test_actual_ci_shell_routes_exact_published_base(tmp_path, base, profile):
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    block = workflow.split('          candidate_base="', 1)[1].split("\n\n  lint-test:", 1)[0]
    script = 'candidate_base="' + block
    shim = tmp_path / "python3"
    shim.write_text("#!/bin/sh\nprintf '%s\\n' \"$@\"\n")
    shim.chmod(0o700)
    result = subprocess.run(
        ["/bin/sh", "-eu", "-c", script],
        env={**os.environ, "PATH": str(tmp_path), "CI_DIFF_BASE": base},
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.splitlines() == ["scripts/" + profile, "--base", base]


@pytest.mark.parametrize(
    "name", ["scripts/candidate_scope_admission57.py", "scripts/podview57-admission-reviewed.json"]
)
def test_58_cannot_rebaseline_immutable_published57(synthetic_record, name, historical58_root):
    report = admission.legacy.inspect_repository(historical58_root, admission.BASE)
    assert admission.validate(historical58_root, report, admission.BASE, synthetic_record)
    path = historical58_root / name
    before = path.read_bytes()
    try:
        path.write_bytes(before + b"\n")
        assert not admission.strict.pins_match(historical58_root, admission.IMMUTABLE)
        assert not admission.validate(historical58_root, report, admission.BASE, synthetic_record)
    finally:
        path.write_bytes(before)
