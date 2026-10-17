"""PV44 strict scope preserves published43 and stays closed until final review."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission43 as published43
from scripts import candidate_scope_admission44 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED43_MERGE = "3f3628a6a847a322a0aa49788b56dd65836d1986"
PUBLISHED43_TREE = "4e9f3d07df8ce7ebc1ba592f8b6dfd32b75b4052"
PUBLISHED44_MERGE = "383a72f1170ebf97ac8ef7f121c933cd731dd311"
PUBLISHED44_TREE = "25ab9fc49a59cf2288bf317f6e13e9e40ae9edb2"


@pytest.fixture(scope="module")
def historical43_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published43") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED43_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED43_TREE], cwd=target, check=True)
    return target


@pytest.fixture(scope="module")
def historical44_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published44") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED44_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED44_TREE], cwd=target, check=True)
    return target


def test_44_profile_preserves_history_and_limits_the_visual_delta():
    assert admission.BASE == PUBLISHED43_MERGE
    bindings = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert len({bool(value) for value in bindings}) == 1
    assert admission.VERSION == 21
    assert admission.KIND == "podview44_visual_followup"
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/static/podview/live-control-view.js",
        "podvoice/gatekeeper/static/podview/live-media-view.js",
        "podvoice/gatekeeper/static/podview/player-view.js",
        "podvoice/gatekeeper/static/podview/speaker-output-view.js",
        "podvoice/gatekeeper/static/podview/ui/gestures.js",
        "podvoice/gatekeeper/static/podview/ui/library/library.css",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
    }
    assert admission.REQUIRED_TESTS == {
        "tests/podview/root-account-picker.test.mjs",
        "tests/podview/root-configured-speaker-label.test.mjs",
        "tests/podview/root-gesture-blur.test.mjs",
        "tests/podview/root-robot-renewal.test.mjs",
        "tests/unit/test_candidate_scope_admission44.py",
        "tests/unit/test_dev_cycle.py",
    }
    assert admission.ASSET_COUNT == 143
    assert admission.strict.pins_match(ROOT, admission.IMMUTABLE)
    assert admission.IMMUTABLE.items() >= admission.previous.IMMUTABLE.items()
    assert admission.IMMUTABLE["scripts/candidate_scope_admission43.py"]
    assert admission.IMMUTABLE["scripts/podview43-admission-reviewed.json"]


def test_44_draft_manifest_has_exact_inventories(historical44_root):
    root = historical44_root
    manifest = json.loads(admission.safe_file(root, admission.MANIFEST))
    assert manifest["schema"] == "podvoice44.admission.v1"
    assert manifest["base"] == admission.BASE
    assert manifest["asset_count"] == admission.ASSET_COUNT
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert (
        set(manifest["runtime"]) == admission.strict.runtime_inventory(root) | admission.HA_RUNTIME
    )
    assert set(manifest["config"]) == admission.CONFIG
    assert set(manifest["policy"]) == admission.POLICY - {admission.PROFILE, admission.MANIFEST}
    assert set(manifest["tooling"]) == admission.TOOLING
    assert admission.strict.pins_match(root, manifest["production"])
    assert admission.strict.pins_match(root, manifest["regressions"])
    assert admission.strict.pins_match(root, manifest["config"])
    assert admission.strict.pins_match(root, manifest["policy"])
    assert admission.strict.pins_match(root, manifest["tooling"])
    assert admission.strict.pins_match(root, manifest["runtime"])
    assert admission.assets_match44(root, manifest["runtime"], manifest["asset_count"])


def test_published43_remains_accepted_and_44_rejects_its_snapshot(historical43_root):
    assert published43.inspect_repository(historical43_root, published43.BASE).passed
    old_record = published43.record_at(historical43_root)
    old_report = admission.legacy.inspect_repository(historical43_root, admission.BASE)
    assert old_record is not None
    assert not admission.validate(historical43_root, old_report, PUBLISHED43_MERGE, old_record)


def test_44_cli_stops_when_reviewer_binding_is_missing(monkeypatch, capsys):
    monkeypatch.setattr(admission, "REVIEWER", "")
    assert admission.main(["--base", admission.BASE]) == 2
    assert "review bindings are not complete" in capsys.readouterr().err
