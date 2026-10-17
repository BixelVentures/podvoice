"""PV46 strict scope preserves published45 and remains closed until final review."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission45 as published45
from scripts import candidate_scope_admission46 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED45_MERGE = "e5e9ec495061e6b3f97f6555a28dafecdeceed3f"
PUBLISHED45_TREE = "6c30d5a493255d9f00ac5ae6bcade3698dab80ae"


@pytest.fixture(scope="module")
def historical45_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published45") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED45_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED45_TREE], cwd=target, check=True)
    return target


def test_46_profile_preserves_history_and_limits_the_visual_delta():
    assert admission.BASE == PUBLISHED45_MERGE
    bindings = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert len({bool(value) for value in bindings}) == 1
    if all(bindings):
        assert (
            admission.sha(admission.safe_file(ROOT, admission.MANIFEST)) == admission.MANIFEST_SHA
        )
        assert (
            admission.strict.ast_sha(admission.safe_file(ROOT, admission.PROFILE), "PROFILE_AST")
            == admission.PROFILE_AST
        )
        assert admission.inspect_repository(ROOT, admission.BASE).passed
    assert admission.VERSION == 23
    assert admission.KIND == "podview46_visual_followup"
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/static/podview/podvoice-transport.js",
        "podvoice/gatekeeper/static/podview/widget-view.js",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
    }
    assert admission.REQUIRED_TESTS == {
        "tests/podview/account-visibility.test.mjs",
        "tests/podview/controller-peer-recovery.test.mjs",
        "tests/podview/canonical-next-four-music-tabs.test.mjs",
        "tests/podview/canonical-next-music-selection.test.mjs",
        "tests/podview/music-selection.test.mjs",
        "tests/podview/root-music-selection.test.mjs",
        "tests/podview/root-speaker-output-view.test.mjs",
        "tests/unit/test_candidate_scope_admission45.py",
        "tests/unit/test_candidate_scope_admission46.py",
        "tests/unit/test_dev_cycle.py",
    }
    assert admission.ASSET_COUNT == 143
    assert admission.strict.pins_match(ROOT, admission.IMMUTABLE)
    assert admission.IMMUTABLE.items() >= admission.previous.IMMUTABLE.items()
    assert admission.IMMUTABLE["scripts/candidate_scope_admission45.py"]
    assert admission.IMMUTABLE["scripts/podview45-admission-reviewed.json"]


def test_46_manifest_has_exact_inventories():
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert manifest["schema"] == "podvoice46.admission.v1"
    assert manifest["base"] == admission.BASE
    assert manifest["asset_count"] == admission.ASSET_COUNT
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
    assert admission.assets_match46(ROOT, manifest["runtime"], manifest["asset_count"])


def test_published45_remains_accepted_and_46_rejects_its_snapshot(historical45_root):
    assert published45.inspect_repository(historical45_root, published45.BASE).passed
    old_record = published45.record_at(historical45_root)
    old_report = admission.legacy.inspect_repository(historical45_root, admission.BASE)
    assert old_record is not None
    assert not admission.validate(historical45_root, old_report, PUBLISHED45_MERGE, old_record)


def test_46_cli_stops_when_reviewer_binding_is_missing(monkeypatch, capsys):
    monkeypatch.setattr(admission, "REVIEWER", "")
    assert admission.main(["--base", admission.BASE]) == 2
    assert "review bindings are not complete" in capsys.readouterr().err
