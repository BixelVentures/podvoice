"""Combined provider/identity59 exact admission preserves published58 and rejects unreviewed drift."""

import json
import os
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission58 as published58
from scripts import candidate_scope_admission59 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED58_MERGE = "78d9dc7528b964d2986e50eee31ecdd0d942571b"
PUBLISHED58_TREE = "b1bb80eed2ee54a2dd6e5b15b7e0a4044b6f19d5"


PUBLISHED59_MERGE = "fcfdbbd775d7d04640254545cf21ffc302a0b9d8"
PUBLISHED59_TREE = "4b823b6f4a3dde66e7a43090f9f58b22b97827cb"


@pytest.fixture(scope="module")
def historical59_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published59") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED59_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED59_TREE], cwd=target, check=True)
    return target


@pytest.fixture(scope="module")
def historical58_root(tmp_path_factory, historical59_root):
    target = tmp_path_factory.mktemp("published58") / "repo"
    subprocess.run(
        ["git", "clone", "--quiet", "--shared", str(historical59_root), str(target)], check=True
    )
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED58_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED58_TREE], cwd=target, check=True)
    return target


def test_59_exact_scope_and_history(historical59_root):
    assert admission.BASE == PUBLISHED58_MERGE
    assert admission.VERSION == 36
    assert admission.KIND == "provider59_status_identity_state_retention"
    assert admission.DOMAINS == ("unclassified_runtime",)
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/static/podview/timer-view.js",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/index.html",
        "podvoice/gatekeeper/static/podview/weather-view.js",
        "podvoice/gatekeeper/hub.py",
        "podvoice/gatekeeper/static/podview/live-home-view.js",
        "podvoice/gatekeeper/static/podview/widget-view.js",
    }
    assert admission.REQUIRED_TESTS == {
        "tests/browser/live_status.cjs",
        "tests/browser/wake_words.cjs",
        "tests/podview/runtime-identity.test.mjs",
        "tests/unit/test_candidate_scope_admission59.py",
        "tests/podview/root-timer-overview.test.mjs",
        "tests/podview/account-visibility.test.mjs",
        "tests/podview/canonical-next-timer-overview.test.mjs",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_runtime_identity_status.py",
        "tests/podview/root-weather-view.test.mjs",
        "tests/podview/root-robot-history-view.test.mjs",
        "tests/podview/root-timer-access.test.mjs",
        "tests/podview/canonical-next-robot-history-view.test.mjs",
        "tests/unit/test_candidate_scope_admission58.py",
        "tests/podview/canonical-next-weather-view.test.mjs",
        "tests/unit/test_panel_contract.py",
    }
    assert admission.HA_RUNTIME == published58.HA_RUNTIME
    assert admission.CONFIG == {
        "podvoice/config.yaml",
        "podvoice/gatekeeper/__init__.py",
        "pyproject.toml",
    }
    assert admission.ASSET_COUNT == 143
    assert admission.IMMUTABLE.items() >= published58.IMMUTABLE.items()
    assert admission.strict.pins_match(historical59_root, admission.IMMUTABLE)
    assert admission.config_only(historical59_root)
    report = admission.legacy.inspect_repository(historical59_root, admission.BASE)
    assert report.domains == admission.DOMAINS
    effective = admission.legacy._visual_repository_changes(historical59_root, admission.BASE)
    assert admission.production_scope_matches(effective)
    assert {p for p in effective if p.startswith("tests/")} == admission.REQUIRED_TESTS
    assert admission.change_scope_matches(effective, set(admission.REQUIRED_TESTS))
    bindings = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert len({bool(value) for value in bindings}) == 1
    assert admission.inspect_repository(historical59_root, admission.BASE).passed == all(bindings)


def test_59_manifest_exact_inventory(historical59_root):
    manifest = json.loads(admission.safe_file(historical59_root, admission.MANIFEST))
    assert manifest["schema"] == "podvoice59.admission.v1"
    assert manifest["base"] == admission.BASE
    assert manifest["asset_count"] == admission.ASSET_COUNT == 143
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert (
        set(manifest["runtime"])
        == admission.strict.runtime_inventory(historical59_root) | admission.HA_RUNTIME
    )
    assert set(manifest["config"]) == admission.CONFIG
    assert set(manifest["policy"]) == admission.POLICY - {admission.PROFILE, admission.MANIFEST}
    assert set(manifest["tooling"]) == admission.TOOLING
    for group in ("production", "regressions", "runtime", "config", "policy", "tooling"):
        assert admission.strict.pins_match(historical59_root, manifest[group])
    assert admission.assets_match59(historical59_root, manifest["runtime"], manifest["asset_count"])


def test_published58_accepted_and_cannot_authorize59(historical58_root):
    assert published58.inspect_repository(historical58_root, published58.BASE).passed
    record = published58.record_at(historical58_root)
    report = admission.legacy.inspect_repository(historical58_root, admission.BASE)
    assert record is not None
    assert not admission.validate(historical58_root, report, PUBLISHED58_MERGE, record)


@pytest.mark.parametrize("binding", ["BASE", "REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_59_cli_closed_with_missing_binding(monkeypatch, capsys, binding):
    monkeypatch.setattr(admission, binding, "")
    assert admission.main(["--base", PUBLISHED58_MERGE]) == 2
    assert "review bindings are not complete" in capsys.readouterr().err


@pytest.fixture
def synthetic_record(monkeypatch, historical59_root):
    """Transient validator preconditions only; never persisted as review authority."""
    reviewer = "Synthetic test-only reviewer"
    manifest_sha = admission.sha(admission.safe_file(historical59_root, admission.MANIFEST))
    monkeypatch.setattr(admission, "REVIEWER", reviewer)
    monkeypatch.setattr(admission, "MANIFEST_SHA", manifest_sha)
    monkeypatch.setattr(
        admission,
        "PROFILE_AST",
        admission.strict.ast_sha(
            admission.safe_file(historical59_root, admission.PROFILE), "PROFILE_AST"
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
            historical59_root, admission.BASE, admission.BASE, tuple(admission.PRODUCTION)
        ),
        "regression_fingerprint": admission.legacy.regression_fingerprint(
            historical59_root, admission.BASE, admission.BASE, tuple(admission.REQUIRED_TESTS)
        ),
        "runtime_fingerprint": admission.strict.fingerprint(
            historical59_root,
            admission.strict.runtime_inventory(historical59_root) | admission.HA_RUNTIME,
        ),
        "config_fingerprint": admission.strict.fingerprint(historical59_root, admission.CONFIG),
        "policy_fingerprint": admission.strict.fingerprint(historical59_root, admission.POLICY),
        "tooling_fingerprint": admission.strict.fingerprint(historical59_root, admission.TOOLING),
        "manifest_fingerprint": manifest_sha,
    }


def test_59_full_validator_accepts_59_and_rejects_58_schema(
    monkeypatch, synthetic_record, historical59_root
):
    report = admission.legacy.inspect_repository(historical59_root, admission.BASE)
    assert admission.validate(historical59_root, report, admission.BASE, synthetic_record)
    wrong = json.loads(admission.safe_file(historical59_root, admission.MANIFEST))
    wrong["schema"] = "podvoice58.admission.v1"
    wrong_raw = json.dumps(wrong).encode()
    real_safe_file = admission.safe_file
    monkeypatch.setattr(
        admission,
        "safe_file",
        lambda root, name: wrong_raw if name == admission.MANIFEST else real_safe_file(root, name),
    )
    monkeypatch.setattr(admission, "MANIFEST_SHA", admission.sha(wrong_raw))
    synthetic_record["manifest_fingerprint"] = admission.sha(wrong_raw)
    assert not admission.validate(historical59_root, report, admission.BASE, synthetic_record)


@pytest.mark.parametrize(
    "name",
    [
        "custom_components/podvoice/display_devices.py",
        "podvoice/gatekeeper/static/podview/music-results.js",
        "podvoice/gatekeeper/talk.py",
    ],
)
def test_59_rejects_actual_unreviewed_production_drift(synthetic_record, name, historical59_root):
    report = admission.legacy.inspect_repository(historical59_root, admission.BASE)
    assert admission.validate(historical59_root, report, admission.BASE, synthetic_record)
    path = historical59_root / name
    before = path.read_bytes()
    try:
        path.write_bytes(before + b"\n")
        effective = admission.legacy._visual_repository_changes(historical59_root, admission.BASE)
        assert not admission.production_scope_matches(effective)
        assert not admission.change_scope_matches(effective, set(admission.REQUIRED_TESTS))
        assert not admission.validate(historical59_root, report, admission.BASE, synthetic_record)
    finally:
        path.write_bytes(before)


@pytest.mark.parametrize(
    "base,profile",
    [
        (PUBLISHED58_MERGE, "candidate_scope_admission59.py"),
        (published58.BASE, "candidate_scope_admission58.py"),
        ("b39498a0c6b965395d8b20ea8387e7c546f7c663", "candidate_scope_admission57.py"),
    ],
)
def test_actual_ci_shell_routes_exact_published_base(tmp_path, base, profile, historical59_root):
    workflow = (historical59_root / ".github/workflows/ci.yml").read_text()
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
    "name", ["scripts/candidate_scope_admission58.py", "scripts/podview58-admission-reviewed.json"]
)
def test_59_cannot_rebaseline_immutable_published58(synthetic_record, name, historical59_root):
    report = admission.legacy.inspect_repository(historical59_root, admission.BASE)
    assert admission.validate(historical59_root, report, admission.BASE, synthetic_record)
    path = historical59_root / name
    before = path.read_bytes()
    try:
        path.write_bytes(before + b"\n")
        assert not admission.strict.pins_match(historical59_root, admission.IMMUTABLE)
        assert not admission.validate(historical59_root, report, admission.BASE, synthetic_record)
    finally:
        path.write_bytes(before)


@pytest.mark.parametrize("name", sorted(admission.PRODUCTION))
def test_59_rejects_unreviewed_bytes_inside_the_allowed_owner(
    synthetic_record, name, historical59_root
):
    report = admission.legacy.inspect_repository(historical59_root, admission.BASE)
    assert admission.validate(historical59_root, report, admission.BASE, synthetic_record)
    path = historical59_root / name
    before = path.read_bytes()
    try:
        path.write_bytes(before + b"\n")
        effective = admission.legacy._visual_repository_changes(historical59_root, admission.BASE)
        assert admission.production_scope_matches(effective)
        assert not admission.validate(historical59_root, report, admission.BASE, synthetic_record)
    finally:
        path.write_bytes(before)


def test_59_asset_membership_and_reviewed_changes(historical59_root):
    assert admission.ASSET_CHANGES == {
        "timer-view.js",
        "widget-view.js",
        "live-home-view.js",
        "weather-view.js",
    }
    manifest = json.loads(admission.safe_file(historical59_root, admission.MANIFEST))
    assert admission.assets_match59(historical59_root, manifest["runtime"], 143)
    for invalid_count in (True, 142, 144):
        assert not admission.assets_match59(historical59_root, manifest["runtime"], invalid_count)


def test_59_unreviewed_asset_cannot_be_rebaselined_by_manifest(historical59_root):
    name = admission.STATIC + "music-results.js"
    manifest_name = admission.STATIC + "asset-manifest.json"
    original = {p: admission.safe_file(historical59_root, p) for p in (name, manifest_name)}
    runtime = json.loads(admission.safe_file(historical59_root, admission.MANIFEST))["runtime"]
    try:
        (historical59_root / name).write_bytes(original[name] + b"\n")
        assets = json.loads(original[manifest_name])
        for row in assets["files"]:
            if row["path"] == "music-results.js":
                row["sha256"] = admission.sha(admission.safe_file(historical59_root, name))
        (historical59_root / manifest_name).write_text(json.dumps(assets, indent=2) + "\n")
        runtime.update(
            {p: admission.sha(admission.safe_file(historical59_root, p)) for p in original}
        )
        assert admission.asset_contract.assets_match56(historical59_root, runtime, 143)
        assert not admission.assets_match59(historical59_root, runtime, 143)
    finally:
        for p, data in original.items():
            (historical59_root / p).write_bytes(data)
