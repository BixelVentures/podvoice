"""Strict66 exact admission preserves published65 and rejects unreviewed drift."""

import json
import os
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission65 as published65
from scripts import candidate_scope_admission66 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED65_MERGE = "ffab41c96c2e0047bb992e10f6da323f03ce431a"
PUBLISHED65_TREE = "8a72ed5c79eb863c78822cf7beb0b72a4ebd0bde"


@pytest.fixture(scope="module")
def historical65_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published65") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED65_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED65_TREE], cwd=target, check=True)
    return target


def test_66_exact_scope_and_history():
    assert admission.BASE == "2c585fabdaaf52895a103db698988477eed098a4"
    assert admission.VERSION == 43
    assert admission.KIND == "podview66_idle_destination_timer_progress_robot_recovery"
    assert admission.DOMAINS == ("physical_output",)
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/static/podview/live-media-view.js",
        "podvoice/gatekeeper/static/podview/music-results.js",
        "podvoice/gatekeeper/podview_speakers.py",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/robot-control-panel.js",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/static/podview/speaker-output-view.js",
        "podvoice/gatekeeper/diagnostic_retention.py",
        "podvoice/gatekeeper/static/podview/music-selection-model.js",
        "podvoice/gatekeeper/podview_music_selection.py",
        "podvoice/gatekeeper/static/podview/live-music-selection-view.js",
        "podvoice/gatekeeper/static/podview/podvoice-transport.js",
        "podvoice/gatekeeper/podview_controls.py",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
        "podvoice/gatekeeper/podview_room_media.py",
        "podvoice/gatekeeper/thin.py",
    }
    assert admission.REQUIRED_TESTS == {
        "tests/unit/test_diagnostic_retention.py",
        "tests/podview/controller-continuity.test.mjs",
        "tests/podview/root-speaker-output-view.test.mjs",
        "tests/podview/canonical-next-music-selection.test.mjs",
        "tests/integration/test_podview_idle_destination.py",
        "tests/integration/test_thin_timer_end_to_end.py",
        "tests/integration/test_ha_timer_native_output.py",
        "tests/podview/root-collection-selection.test.mjs",
        "tests/podview/canonical-next-collection-selection.test.mjs",
        "tests/podview/root-live-media-view.test.mjs",
        "tests/podview/root-shared-music-results.test.mjs",
        "tests/podview/root-live-control-view.test.mjs",
        "tests/podview/canonical-next-robot-control-panel.test.mjs",
        "tests/podview/root-robot-control-panel.test.mjs",
        "tests/integration/test_thin_automatic_diagnostics.py",
        "tests/unit/test_music_selection_owner.py",
        "tests/integration/test_podview_controls.py",
        "tests/podview/root-music-selection.test.mjs",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_candidate_scope_admission66.py",
    }
    assert admission.HA_RUNTIME == published65.HA_RUNTIME
    assert admission.CONFIG == {
        "podvoice/config.yaml",
        "podvoice/gatekeeper/__init__.py",
        "pyproject.toml",
        "custom_components/podvoice/manifest.json",
    }
    assert admission.ASSET_COUNT == 143
    assert admission.IMMUTABLE.items() >= published65.IMMUTABLE.items()
    assert admission.strict.pins_match(ROOT, admission.IMMUTABLE)
    assert admission.config_only(ROOT)
    report = admission.legacy.inspect_repository(ROOT, admission.BASE)
    assert report.domains == admission.DOMAINS
    effective = admission.legacy._visual_repository_changes(ROOT, admission.BASE)
    assert admission.production_scope_matches(effective)
    assert {p for p in effective if p.startswith("tests/")} == admission.REQUIRED_TESTS
    assert admission.change_scope_matches(effective, set(admission.REQUIRED_TESTS))
    bindings = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert len({bool(value) for value in bindings}) == 1
    assert admission.inspect_repository(ROOT, admission.BASE).passed == all(bindings)


def test_66_manifest_exact_inventory():
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert manifest["schema"] == "podvoice66.admission.v1"
    assert manifest["base"] == admission.BASE
    assert manifest["asset_count"] == admission.ASSET_COUNT == 143
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert (
        set(manifest["runtime"]) == admission.strict.runtime_inventory(ROOT) | admission.HA_RUNTIME
    )
    assert set(manifest["config"]) == admission.CONFIG
    assert set(manifest["policy"]) == admission.POLICY - {admission.PROFILE, admission.MANIFEST}
    assert set(manifest["tooling"]) == admission.TOOLING
    for group in ("production", "regressions", "runtime", "config", "policy", "tooling"):
        assert admission.strict.pins_match(ROOT, manifest[group])
    assert admission.assets_match66(ROOT, manifest["runtime"], manifest["asset_count"])


def test_published65_accepted_and_cannot_authorize66(historical65_root):
    assert published65.inspect_repository(historical65_root, published65.BASE).passed
    record = published65.record_at(historical65_root)
    report = admission.legacy.inspect_repository(historical65_root, admission.BASE)
    assert record is not None
    assert not admission.validate(historical65_root, report, PUBLISHED65_MERGE, record)


@pytest.mark.parametrize("binding", ["BASE", "REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_66_cli_closed_with_missing_binding(monkeypatch, capsys, binding):
    monkeypatch.setattr(admission, binding, "")
    assert admission.main(["--base", PUBLISHED65_MERGE]) == 2
    assert "review bindings are not complete" in capsys.readouterr().err


@pytest.fixture
def synthetic_record(monkeypatch):
    """Transient validator preconditions only; never persisted as review authority."""
    reviewer = "Synthetic test-only reviewer"
    manifest_sha = admission.sha(admission.safe_file(ROOT, admission.MANIFEST))
    monkeypatch.setattr(admission, "REVIEWER", reviewer)
    monkeypatch.setattr(admission, "MANIFEST_SHA", manifest_sha)
    monkeypatch.setattr(
        admission,
        "PROFILE_AST",
        admission.strict.ast_sha(admission.safe_file(ROOT, admission.PROFILE), "PROFILE_AST"),
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
            ROOT, admission.BASE, admission.BASE, tuple(admission.PRODUCTION)
        ),
        "regression_fingerprint": admission.legacy.regression_fingerprint(
            ROOT, admission.BASE, admission.BASE, tuple(admission.REQUIRED_TESTS)
        ),
        "runtime_fingerprint": admission.strict.fingerprint(
            ROOT, admission.strict.runtime_inventory(ROOT) | admission.HA_RUNTIME
        ),
        "config_fingerprint": admission.strict.fingerprint(ROOT, admission.CONFIG),
        "policy_fingerprint": admission.strict.fingerprint(ROOT, admission.POLICY),
        "tooling_fingerprint": admission.strict.fingerprint(ROOT, admission.TOOLING),
        "manifest_fingerprint": manifest_sha,
    }


def test_66_full_validator_accepts_66_and_rejects_65_schema(monkeypatch, synthetic_record):
    report = admission.legacy.inspect_repository(ROOT, admission.BASE)
    assert admission.validate(ROOT, report, admission.BASE, synthetic_record)
    wrong = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    wrong["schema"] = "podvoice65.admission.v1"
    wrong_raw = json.dumps(wrong).encode()
    real_safe_file = admission.safe_file
    monkeypatch.setattr(
        admission,
        "safe_file",
        lambda root, name: wrong_raw if name == admission.MANIFEST else real_safe_file(root, name),
    )
    monkeypatch.setattr(admission, "MANIFEST_SHA", admission.sha(wrong_raw))
    synthetic_record["manifest_fingerprint"] = admission.sha(wrong_raw)
    assert not admission.validate(ROOT, report, admission.BASE, synthetic_record)


@pytest.mark.parametrize(
    "name",
    [
        "custom_components/podvoice/display_devices.py",
        "podvoice/gatekeeper/static/podview/owner-answers.js",
        "podvoice/gatekeeper/voicepe.py",
    ],
)
def test_66_rejects_actual_unreviewed_production_drift(synthetic_record, name):
    report = admission.legacy.inspect_repository(ROOT, admission.BASE)
    assert admission.validate(ROOT, report, admission.BASE, synthetic_record)
    path = ROOT / name
    before = path.read_bytes()
    try:
        path.write_bytes(before + b"\n")
        effective = admission.legacy._visual_repository_changes(ROOT, admission.BASE)
        assert not admission.production_scope_matches(effective)
        assert not admission.change_scope_matches(effective, set(admission.REQUIRED_TESTS))
        assert not admission.validate(ROOT, report, admission.BASE, synthetic_record)
    finally:
        path.write_bytes(before)


@pytest.mark.parametrize(
    "base,profile",
    [
        ("2c585fabdaaf52895a103db698988477eed098a4", "candidate_scope_admission66.py"),
        (published65.BASE, "candidate_scope_admission65.py"),
        (published65.previous.BASE, "candidate_scope_admission64.py"),
        ("b39498a0c6b965395d8b20ea8387e7c546f7c663", "candidate_scope_admission57.py"),
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
    "name", ["scripts/candidate_scope_admission65.py", "scripts/podview65-admission-reviewed.json"]
)
def test_66_cannot_rebaseline_immutable_published65(synthetic_record, name):
    report = admission.legacy.inspect_repository(ROOT, admission.BASE)
    assert admission.validate(ROOT, report, admission.BASE, synthetic_record)
    path = ROOT / name
    before = path.read_bytes()
    try:
        path.write_bytes(before + b"\n")
        assert not admission.strict.pins_match(ROOT, admission.IMMUTABLE)
        assert not admission.validate(ROOT, report, admission.BASE, synthetic_record)
    finally:
        path.write_bytes(before)


@pytest.mark.parametrize("name", sorted(admission.PRODUCTION))
def test_66_rejects_unreviewed_bytes_inside_the_allowed_owner(synthetic_record, name):
    report = admission.legacy.inspect_repository(ROOT, admission.BASE)
    assert admission.validate(ROOT, report, admission.BASE, synthetic_record)
    path = ROOT / name
    before = path.read_bytes()
    try:
        path.write_bytes(before + b"\n")
        effective = admission.legacy._visual_repository_changes(ROOT, admission.BASE)
        assert admission.production_scope_matches(effective)
        assert not admission.validate(ROOT, report, admission.BASE, synthetic_record)
    finally:
        path.write_bytes(before)


def test_66_asset_membership_and_reviewed_changes():
    assert admission.ASSET_CHANGES == {
        "podvoice-transport.js",
        "speaker-output-view.js",
        "music-results.js",
        "live-control-view.js",
        "robot-control-panel.js",
        "music-selection-model.js",
        "live-music-selection-view.js",
        "live-media-view.js",
    }
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert admission.assets_match66(ROOT, manifest["runtime"], 143)
    for invalid_count in (True, 142, 144):
        assert not admission.assets_match66(ROOT, manifest["runtime"], invalid_count)


def test_66_unreviewed_asset_cannot_be_rebaselined_by_manifest():
    name = admission.STATIC + "owner-answers.js"
    manifest_name = admission.STATIC + "asset-manifest.json"
    original = {p: admission.safe_file(ROOT, p) for p in (name, manifest_name)}
    runtime = json.loads(admission.safe_file(ROOT, admission.MANIFEST))["runtime"]
    try:
        (ROOT / name).write_bytes(original[name] + b"\n")
        assets = json.loads(original[manifest_name])
        for row in assets["files"]:
            if row["path"] == "owner-answers.js":
                row["sha256"] = admission.sha(admission.safe_file(ROOT, name))
        (ROOT / manifest_name).write_text(json.dumps(assets, indent=2) + "\n")
        runtime.update({p: admission.sha(admission.safe_file(ROOT, p)) for p in original})
        assert admission.asset_contract.assets_match56(ROOT, runtime, 143)
        assert not admission.assets_match66(ROOT, runtime, 143)
    finally:
        for p, data in original.items():
            (ROOT / p).write_bytes(data)


@pytest.mark.parametrize(
    "replacement",
    [
        "panel_admin: false",
        "panel_admin: true\npanel_admin: true",
        "panel_admin: true\nprivileged: true",
    ],
)
def test_66_rejects_any_unreviewed_admin_ingress_configuration(replacement):
    path = ROOT / "podvoice/config.yaml"
    before = path.read_bytes()
    try:
        source = before.decode().replace("panel_admin: true", replacement)
        assert source != before.decode()
        path.write_text(source)
        assert not admission.config_only(ROOT)
    finally:
        path.write_bytes(before)
