"""Widget61 exact admission preserves published61 and rejects unreviewed drift."""

import json
import os
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission61 as published61
from scripts import candidate_scope_admission62 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED61_MERGE = "79b8fe8cdd3d2ee55e811cd76ac9f37e067cae48"
PUBLISHED61_TREE = "3ec826aae34edf504ce66b7b2ccdc42b0d8c7ace"


@pytest.fixture(scope="module")
def historical61_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published61") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED61_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED61_TREE], cwd=target, check=True)
    return target


def test_62_exact_scope_and_history():
    assert admission.BASE == PUBLISHED61_MERGE
    assert admission.VERSION == 39
    assert admission.KIND == "podview62_retained_ui_playlist_resilience"
    assert admission.DOMAINS == ("physical_output",)
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/static/podview/live-home-view.js",
        "podvoice/gatekeeper/static/podview/player-view.js",
        "podvoice/gatekeeper/podview_feeling.py",
        "podvoice/gatekeeper/static/podview/timer-view.js",
        "podvoice/gatekeeper/static/podview/timer-notice.js",
        "podvoice/gatekeeper/static/podview/ui/library/visual-components.js",
        "podvoice/gatekeeper/static/podview/index.html",
        "podvoice/gatekeeper/static/podview/widget-redesign.css",
        "podvoice/gatekeeper/static/podview/music-results.js",
        "podvoice/gatekeeper/static/podview/ui/resource-tile.js",
        "podvoice/gatekeeper/static/podview/ui/scroll-edges.js",
        "podvoice/gatekeeper/static/podview/widget-view.js",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/weather-view.js",
        "podvoice/gatekeeper/static/podview/spotify-artwork.js",
        "podvoice/gatekeeper/static/podview/live-media-view.js",
        "podvoice/gatekeeper/static/podview/podvoice-transport.js",
        "podvoice/gatekeeper/static/podview/ui/library/components.js",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
    }
    assert admission.REQUIRED_TESTS == {
        "tests/podview/canonical-next-live-media-view-source.test.mjs",
        "tests/podview/root-podvoice-transport.test.mjs",
        "tests/integration/test_podview_feeling_source_queries.py",
        "tests/podview/root-timer-access.test.mjs",
        "tests/podview/root-spotify-artwork.test.mjs",
        "tests/podview/root-speaker-output-idle.test.mjs",
        "tests/podview/music-selection.test.mjs",
        "tests/podview/root-timer-dom-delta.test.mjs",
        "tests/podview/root-setup-access.test.mjs",
        "tests/podview/root-player-view.test.mjs",
        "tests/unit/test_candidate_scope_admission62.py",
        "tests/integration/test_mood_diagnostics_route.py",
        "tests/integration/test_podview_playlist_resilience.py",
        "tests/podview/root-music-selection.test.mjs",
        "tests/podview/root-music-flow.test.mjs",
        "tests/podview/canonical-next-music-card-appearance.test.mjs",
        "tests/podview/canonical-next-transport-recovery.test.mjs",
        "tests/unit/test_dev_cycle.py",
        "tests/podview/root-native-music-controls.test.mjs",
        "tests/podview/root-robot-renewal.test.mjs",
        "tests/podview/root-player-dom-delta.test.mjs",
        "tests/podview/root-configured-speaker-label.test.mjs",
        "tests/podview/canonical-next-player-view-source.test.mjs",
        "tests/podview/root-robot-history-view.test.mjs",
        "tests/unit/test_candidate_scope_admission61.py",
        "tests/podview/root-first-read-reconciliation.test.mjs",
        "tests/podview/canonical-next-player-view.test.mjs",
        "tests/podview/account-visibility.test.mjs",
        "tests/podview/root-widget-model.test.mjs",
        "tests/podview/root-setup-timer-receiver.test.mjs",
        "tests/podview/root-music-cache.test.mjs",
        "tests/podview/root-scroll-edges.test.mjs",
        "tests/podview/root-live-media-view.test.mjs",
        "tests/podview/root-retained-widget-delta.test.mjs",
        "tests/podview/root-timer-model.test.mjs",
        "tests/podview/canonical-next-widget-loading.test.mjs",
        "tests/podview/root-podvoice-view.test.mjs",
        "tests/integration/test_podview_feeling_matching.py",
        "tests/podview/root-live-control-view.test.mjs",
        "tests/podview/root-collection-selection.test.mjs",
        "tests/podview/root-shared-music-results.test.mjs",
        "tests/podview/root-weather-view.test.mjs",
        "tests/podview/canonical-next-visual-history.test.mjs",
        "tests/podview/queue-occurrence.test.mjs",
        "tests/podview/root-weather-presentation-display.test.mjs",
        "tests/podview/canonical-next-live-media-view.test.mjs",
    }
    assert admission.HA_RUNTIME == published61.HA_RUNTIME
    assert admission.CONFIG == {
        "podvoice/config.yaml",
        "podvoice/gatekeeper/__init__.py",
        "pyproject.toml",
    }
    assert admission.ASSET_COUNT == 143
    assert admission.IMMUTABLE.items() >= published61.IMMUTABLE.items()
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


def test_62_manifest_exact_inventory():
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert manifest["schema"] == "podvoice62.admission.v1"
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
    assert admission.assets_match62(ROOT, manifest["runtime"], manifest["asset_count"])


def test_published61_accepted_and_cannot_authorize62(historical61_root):
    assert published61.inspect_repository(historical61_root, published61.BASE).passed
    record = published61.record_at(historical61_root)
    report = admission.legacy.inspect_repository(historical61_root, admission.BASE)
    assert record is not None
    assert not admission.validate(historical61_root, report, PUBLISHED61_MERGE, record)


@pytest.mark.parametrize("binding", ["BASE", "REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_62_cli_closed_with_missing_binding(monkeypatch, capsys, binding):
    monkeypatch.setattr(admission, binding, "")
    assert admission.main(["--base", PUBLISHED61_MERGE]) == 2
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


def test_62_full_validator_accepts_62_and_rejects_61_schema(monkeypatch, synthetic_record):
    report = admission.legacy.inspect_repository(ROOT, admission.BASE)
    assert admission.validate(ROOT, report, admission.BASE, synthetic_record)
    wrong = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    wrong["schema"] = "podvoice61.admission.v1"
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
        "podvoice/gatekeeper/talk.py",
    ],
)
def test_62_rejects_actual_unreviewed_production_drift(synthetic_record, name):
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
        (PUBLISHED61_MERGE, "candidate_scope_admission62.py"),
        (published61.BASE, "candidate_scope_admission61.py"),
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
    "name", ["scripts/candidate_scope_admission61.py", "scripts/podview61-admission-reviewed.json"]
)
def test_62_cannot_rebaseline_immutable_published61(synthetic_record, name):
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
def test_62_rejects_unreviewed_bytes_inside_the_allowed_owner(synthetic_record, name):
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


def test_62_asset_membership_and_reviewed_changes():
    assert admission.ASSET_CHANGES == {
        "timer-view.js",
        "podvoice-transport.js",
        "timer-notice.js",
        "player-view.js",
        "live-control-view.js",
        "ui/library/visual-components.js",
        "index.html",
        "widget-view.js",
        "weather-view.js",
        "music-results.js",
        "widget-redesign.css",
        "ui/resource-tile.js",
        "ui/library/components.js",
        "live-home-view.js",
        "ui/scroll-edges.js",
        "live-media-view.js",
        "spotify-artwork.js",
    }
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert admission.assets_match62(ROOT, manifest["runtime"], 143)
    for invalid_count in (True, 142, 144):
        assert not admission.assets_match62(ROOT, manifest["runtime"], invalid_count)


def test_62_unreviewed_asset_cannot_be_rebaselined_by_manifest():
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
        assert not admission.assets_match62(ROOT, runtime, 143)
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
def test_62_rejects_any_unreviewed_admin_ingress_configuration(replacement):
    path = ROOT / "podvoice/config.yaml"
    before = path.read_bytes()
    try:
        source = before.decode().replace("panel_admin: true", replacement)
        assert source != before.decode()
        path.write_text(source)
        assert not admission.config_only(ROOT)
    finally:
        path.write_bytes(before)
