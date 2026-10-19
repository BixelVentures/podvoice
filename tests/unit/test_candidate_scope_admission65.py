"""Strict65 exact admission preserves published64 and rejects unreviewed drift."""

import json
import os
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission64 as published64
from scripts import candidate_scope_admission65 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED64_MERGE = "eead19bcf86e958fdb78321fdd54549d393698c8"
PUBLISHED64_TREE = "3b70095bd43f9af063c8a2e19e7c057f1553ac93"


@pytest.fixture(scope="module")
def historical64_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published64") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED64_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED64_TREE], cwd=target, check=True)
    return target


def test_65_exact_scope_and_history():
    assert admission.BASE == PUBLISHED64_MERGE
    assert admission.VERSION == 42
    assert admission.KIND == "podview65_ui_cover_controller_talk_continuity"
    assert admission.DOMAINS == ("ha_tools", "physical_output")
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/podview_music.py",
        "podvoice/gatekeeper/static/podview/ui/library/library.css",
        "custom_components/podvoice/controller_admin.py",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/openai_live.py",
        "podvoice/gatekeeper/static/podview/live-media-view.js",
        "podvoice/gatekeeper/static/podview/player-view.js",
        "podvoice/gatekeeper/thin.py",
        "podvoice/gatekeeper/static/index.html",
        "podvoice/gatekeeper/static/podview/widget-redesign.css",
        "podvoice/gatekeeper/static/podview/widget-view.js",
        "podvoice/gatekeeper/static/podview/frame-layout.css",
        "podvoice/gatekeeper/static/podview/control-model.js",
        "podvoice/gatekeeper/static/podview/music-results.js",
        "podvoice/gatekeeper/podview_admin_transport.py",
        "podvoice/gatekeeper/static/podview/ui/motion.js",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
        "podvoice/gatekeeper/static/podview/ui/components.css",
        "custom_components/podvoice/services.yaml",
        "podvoice/gatekeeper/static/podview/live-home-view.js",
        "podvoice/gatekeeper/podview_controls.py",
        "podvoice/gatekeeper/static/podview/live-music-selection-view.js",
        "podvoice/gatekeeper/static/podview/music-selection-model.js",
        "podvoice/gatekeeper/tools.py",
        "podvoice/gatekeeper/static/podview/robot-control-panel.js",
        "custom_components/podvoice/__init__.py",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "custom_components/podvoice/config_flow.py",
        "podvoice/gatekeeper/talk.py",
        "podvoice/gatekeeper/static/podview/spotify-artwork.js",
    }
    assert admission.REQUIRED_TESTS == {
        "tests/podview/root-live-control-view.test.mjs",
        "tests/integration/test_thin_live.py",
        "tests/ha_framework/test_controller_admin_services.py",
        "tests/podview/root-spotify-artwork.test.mjs",
        "tests/browser/talk_exit_contract.cjs",
        "tests/podview/root-player-dom-delta.test.mjs",
        "tests/unit/test_dev_cycle.py",
        "tests/podview/root-live-media-view.test.mjs",
        "tests/integration/test_thin_live_failed_close_cleanup.py",
        "tests/unit/test_candidate_scope_admission64.py",
        "tests/podview/canonical-next-collection-selection.test.mjs",
        "tests/integration/test_podview_mood_playlists.py",
        "tests/podview/root-robot-control-panel.test.mjs",
        "tests/integration/test_talk_rotation.py",
        "tests/podview/root-first-read-reconciliation.test.mjs",
        "tests/podview/root-weather-view.test.mjs",
        "tests/unit/test_ha_controller_admin.py",
        "tests/integration/test_talk_webrtc_browser.py",
        "tests/integration/test_podview_music.py",
        "tests/podview/root-mood-playlists.test.mjs",
        "tests/podview/root-control-model.test.mjs",
        "tests/integration/test_podview_admin_provision.py",
        "tests/podview/root-motion.test.mjs",
        "tests/podview/root-shared-music-results.test.mjs",
        "tests/integration/test_podview_controls.py",
        "tests/integration/test_podview_mood_preview.py",
        "tests/integration/test_podview_playlist_refresh.py",
        "tests/podview/root-collection-selection.test.mjs",
        "tests/unit/test_podview_playlist_artwork.py",
        "tests/unit/test_candidate_scope_admission65.py",
        "tests/integration/test_talk_webrtc.py",
        "tests/unit/test_openai_live.py",
        "tests/podview/canonical-next-robot-control-panel.test.mjs",
        "tests/podview/mood-preview.test.mjs",
    }
    assert admission.HA_RUNTIME == published64.HA_RUNTIME
    assert admission.CONFIG == {
        "podvoice/config.yaml",
        "podvoice/gatekeeper/__init__.py",
        "pyproject.toml",
        "custom_components/podvoice/manifest.json",
    }
    assert admission.ASSET_COUNT == 143
    assert admission.IMMUTABLE.items() >= published64.IMMUTABLE.items()
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


def test_65_manifest_exact_inventory():
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert manifest["schema"] == "podvoice65.admission.v1"
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
    assert admission.assets_match65(ROOT, manifest["runtime"], manifest["asset_count"])


def test_published64_accepted_and_cannot_authorize65(historical64_root):
    assert published64.inspect_repository(historical64_root, published64.BASE).passed
    record = published64.record_at(historical64_root)
    report = admission.legacy.inspect_repository(historical64_root, admission.BASE)
    assert record is not None
    assert not admission.validate(historical64_root, report, PUBLISHED64_MERGE, record)


@pytest.mark.parametrize("binding", ["BASE", "REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_65_cli_closed_with_missing_binding(monkeypatch, capsys, binding):
    monkeypatch.setattr(admission, binding, "")
    assert admission.main(["--base", PUBLISHED64_MERGE]) == 2
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


def test_65_full_validator_accepts_65_and_rejects_64_schema(monkeypatch, synthetic_record):
    report = admission.legacy.inspect_repository(ROOT, admission.BASE)
    assert admission.validate(ROOT, report, admission.BASE, synthetic_record)
    wrong = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    wrong["schema"] = "podvoice64.admission.v1"
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
def test_65_rejects_actual_unreviewed_production_drift(synthetic_record, name):
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
        (PUBLISHED64_MERGE, "candidate_scope_admission65.py"),
        (published64.BASE, "candidate_scope_admission64.py"),
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
    "name", ["scripts/candidate_scope_admission64.py", "scripts/podview64-admission-reviewed.json"]
)
def test_65_cannot_rebaseline_immutable_published64(synthetic_record, name):
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
def test_65_rejects_unreviewed_bytes_inside_the_allowed_owner(synthetic_record, name):
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


def test_65_asset_membership_and_reviewed_changes():
    assert admission.ASSET_CHANGES == {
        "control-model.js",
        "robot-control-panel.js",
        "frame-layout.css",
        "widget-redesign.css",
        "live-media-view.js",
        "player-view.js",
        "live-home-view.js",
        "live-control-view.js",
        "live-music-selection-view.js",
        "spotify-artwork.js",
        "ui/library/library.css",
        "music-results.js",
        "ui/motion.js",
        "music-selection-model.js",
        "ui/components.css",
        "widget-view.js",
    }
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert admission.assets_match65(ROOT, manifest["runtime"], 143)
    for invalid_count in (True, 142, 144):
        assert not admission.assets_match65(ROOT, manifest["runtime"], invalid_count)


def test_65_unreviewed_asset_cannot_be_rebaselined_by_manifest():
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
        assert not admission.assets_match65(ROOT, runtime, 143)
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
def test_65_rejects_any_unreviewed_admin_ingress_configuration(replacement):
    path = ROOT / "podvoice/config.yaml"
    before = path.read_bytes()
    try:
        source = before.decode().replace("panel_admin: true", replacement)
        assert source != before.decode()
        path.write_text(source)
        assert not admission.config_only(ROOT)
    finally:
        path.write_bytes(before)


# Published65 assertion bodies stay byte-exact against their actual source.
@pytest.fixture(scope="module", autouse=True)
def historical65_source_root(tmp_path_factory):
    global ROOT
    original_root = ROOT
    target = tmp_path_factory.mktemp("published65-source") / "repo"
    subprocess.run(
        ["git", "clone", "--quiet", "--shared", str(original_root), str(target)], check=True
    )
    subprocess.run(
        ["git", "checkout", "--quiet", "ffab41c96c2e0047bb992e10f6da323f03ce431a"],
        cwd=target,
        check=True,
    )
    subprocess.run(
        ["git", "read-tree", "--reset", "-u", "8a72ed5c79eb863c78822cf7beb0b72a4ebd0bde"],
        cwd=target,
        check=True,
    )
    ROOT = target
    try:
        yield target
    finally:
        ROOT = original_root
