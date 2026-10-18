"""Normal HA60 exact admission preserves published59 and rejects unreviewed drift."""

import json
import os
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission59 as published59
from scripts import candidate_scope_admission60 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED59_MERGE = "fcfdbbd775d7d04640254545cf21ffc302a0b9d8"
PUBLISHED59_TREE = "4b823b6f4a3dde66e7a43090f9f58b22b97827cb"


@pytest.fixture(scope="module")
def historical59_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published59") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED59_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED59_TREE], cwd=target, check=True)
    return target


def test_60_exact_scope_and_history():
    assert admission.BASE == PUBLISHED59_MERGE
    assert admission.VERSION == 37
    assert admission.KIND == "normal60_ha_access_passive_playback"
    assert admission.DOMAINS == ("physical_output",)
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/static/index.html",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/podview_controls.py",
        "podvoice/gatekeeper/podview_room_media.py",
        "podvoice/gatekeeper/podview_music_control.py",
        "podvoice/gatekeeper/static/podview/podvoice-transport.js",
        "podvoice/gatekeeper/podview_queue.py",
        "podvoice/gatekeeper/podview.py",
    }
    assert admission.REQUIRED_TESTS == {
        "tests/unit/test_candidate_scope_admission59.py",
        "tests/integration/test_room_media_binding.py",
        "tests/integration/test_podview_voice_continuation.py",
        "tests/integration/test_podview_mood_playlists.py",
        "tests/integration/test_podview_pairing_navigation.py",
        "tests/unit/test_candidate_scope_admission60.py",
        "tests/unit/test_dev_cycle.py",
        "tests/integration/test_podview_ha_ingress60.py",
        "tests/podview/transport-recovery.test.mjs",
        "tests/podview/canonical-next-transport-recovery.test.mjs",
        "tests/podview/ha-ingress-transport.test.mjs",
    }
    assert admission.HA_RUNTIME == published59.HA_RUNTIME
    assert admission.CONFIG == {
        "podvoice/config.yaml",
        "podvoice/gatekeeper/__init__.py",
        "pyproject.toml",
    }
    assert admission.ASSET_COUNT == 143
    assert admission.IMMUTABLE.items() >= published59.IMMUTABLE.items()
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


def test_60_manifest_exact_inventory():
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert manifest["schema"] == "podvoice60.admission.v1"
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
    assert admission.assets_match60(ROOT, manifest["runtime"], manifest["asset_count"])


def test_published59_accepted_and_cannot_authorize60(historical59_root):
    assert published59.inspect_repository(historical59_root, published59.BASE).passed
    record = published59.record_at(historical59_root)
    report = admission.legacy.inspect_repository(historical59_root, admission.BASE)
    assert record is not None
    assert not admission.validate(historical59_root, report, PUBLISHED59_MERGE, record)


@pytest.mark.parametrize("binding", ["BASE", "REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_60_cli_closed_with_missing_binding(monkeypatch, capsys, binding):
    monkeypatch.setattr(admission, binding, "")
    assert admission.main(["--base", PUBLISHED59_MERGE]) == 2
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


def test_60_full_validator_accepts_60_and_rejects_59_schema(monkeypatch, synthetic_record):
    report = admission.legacy.inspect_repository(ROOT, admission.BASE)
    assert admission.validate(ROOT, report, admission.BASE, synthetic_record)
    wrong = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    wrong["schema"] = "podvoice59.admission.v1"
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
        "podvoice/gatekeeper/static/podview/music-results.js",
        "podvoice/gatekeeper/talk.py",
    ],
)
def test_60_rejects_actual_unreviewed_production_drift(synthetic_record, name):
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
        (PUBLISHED59_MERGE, "candidate_scope_admission60.py"),
        (published59.BASE, "candidate_scope_admission59.py"),
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
    "name", ["scripts/candidate_scope_admission59.py", "scripts/podview59-admission-reviewed.json"]
)
def test_60_cannot_rebaseline_immutable_published59(synthetic_record, name):
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
def test_60_rejects_unreviewed_bytes_inside_the_allowed_owner(synthetic_record, name):
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


def test_60_asset_membership_and_reviewed_changes():
    assert admission.ASSET_CHANGES == {"podvoice-transport.js"}
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert admission.assets_match60(ROOT, manifest["runtime"], 143)
    for invalid_count in (True, 142, 144):
        assert not admission.assets_match60(ROOT, manifest["runtime"], invalid_count)


def test_60_unreviewed_asset_cannot_be_rebaselined_by_manifest():
    name = admission.STATIC + "music-results.js"
    manifest_name = admission.STATIC + "asset-manifest.json"
    original = {p: admission.safe_file(ROOT, p) for p in (name, manifest_name)}
    runtime = json.loads(admission.safe_file(ROOT, admission.MANIFEST))["runtime"]
    try:
        (ROOT / name).write_bytes(original[name] + b"\n")
        assets = json.loads(original[manifest_name])
        for row in assets["files"]:
            if row["path"] == "music-results.js":
                row["sha256"] = admission.sha(admission.safe_file(ROOT, name))
        (ROOT / manifest_name).write_text(json.dumps(assets, indent=2) + "\n")
        runtime.update({p: admission.sha(admission.safe_file(ROOT, p)) for p in original})
        assert admission.asset_contract.assets_match56(ROOT, runtime, 143)
        assert not admission.assets_match60(ROOT, runtime, 143)
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
def test_60_rejects_any_unreviewed_admin_ingress_configuration(replacement):
    path = ROOT / "podvoice/config.yaml"
    before = path.read_bytes()
    try:
        source = before.decode().replace("panel_admin: true", replacement)
        assert source != before.decode()
        path.write_text(source)
        assert not admission.config_only(ROOT)
    finally:
        path.write_bytes(before)
