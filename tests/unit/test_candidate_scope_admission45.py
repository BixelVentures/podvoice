"""PV45 strict scope preserves published44 and stays closed until final review."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission44 as published44
from scripts import candidate_scope_admission45 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED44_MERGE = "383a72f1170ebf97ac8ef7f121c933cd731dd311"
PUBLISHED44_TREE = "25ab9fc49a59cf2288bf317f6e13e9e40ae9edb2"


@pytest.fixture(scope="module")
def historical44_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published44") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED44_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED44_TREE], cwd=target, check=True)
    return target


def test_45_profile_preserves_history_and_limits_the_visual_delta():
    assert admission.BASE == "383a72f1170ebf97ac8ef7f121c933cd731dd311"
    bindings = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert len({bool(value) for value in bindings}) == 1
    assert admission.VERSION == 22
    assert admission.KIND == "podview45_visual_followup"
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/static/podview/live-answer-view.js",
        "podvoice/gatekeeper/static/podview/live-music-selection-view.js",
        "podvoice/gatekeeper/static/podview/live-music-view.js",
        "podvoice/gatekeeper/static/podview/music-results.js",
        "podvoice/gatekeeper/static/podview/podvoice-transport.js",
        "podvoice/gatekeeper/static/podview/weather-view.js",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
    }
    assert admission.REQUIRED_TESTS == {
        "tests/podview/answer-expiry-focus.test.mjs",
        "tests/podview/music-deferred-renewal.test.mjs",
        "tests/podview/music-expiry-recovery.test.mjs",
        "tests/podview/music-renewal-provider-downstream.test.mjs",
        "tests/podview/music-renewal-provider.test.mjs",
        "tests/podview/music-renewal-stale-source.test.mjs",
        "tests/podview/transport-recovery.test.mjs",
        "tests/podview/weather-hour-order.test.mjs",
        "tests/podview/canonical-next-live-answer-view.test.mjs",
        "tests/unit/test_candidate_scope_admission44.py",
        "tests/unit/test_candidate_scope_admission45.py",
        "tests/unit/test_dev_cycle.py",
    }
    assert admission.ASSET_COUNT == 143
    assert admission.strict.pins_match(ROOT, admission.IMMUTABLE)
    assert admission.IMMUTABLE.items() >= admission.previous.IMMUTABLE.items()
    assert admission.IMMUTABLE["scripts/candidate_scope_admission44.py"]
    assert admission.IMMUTABLE["scripts/podview44-admission-reviewed.json"]


def test_45_draft_manifest_has_exact_inventories():
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert manifest["schema"] == "podvoice45.admission.v1"
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
    assert admission.strict.pins_match(ROOT, manifest["production"])
    assert admission.strict.pins_match(ROOT, manifest["regressions"])
    assert admission.strict.pins_match(ROOT, manifest["config"])
    assert admission.strict.pins_match(ROOT, manifest["policy"])
    assert admission.strict.pins_match(ROOT, manifest["tooling"])
    assert admission.strict.pins_match(ROOT, manifest["runtime"])
    assert admission.assets_match45(ROOT, manifest["runtime"], manifest["asset_count"])


def test_published44_remains_accepted_and_45_rejects_its_snapshot(historical44_root):
    assert published44.inspect_repository(historical44_root, published44.BASE).passed
    old_record = published44.record_at(historical44_root)
    old_report = admission.legacy.inspect_repository(historical44_root, admission.BASE)
    assert old_record is not None
    assert not admission.validate(historical44_root, old_report, PUBLISHED44_MERGE, old_record)


def test_45_cli_stops_when_reviewer_binding_is_missing(monkeypatch, capsys):
    monkeypatch.setattr(admission, "REVIEWER", "")
    assert admission.main(["--base", admission.BASE]) == 2
    assert "review bindings are not complete" in capsys.readouterr().err
