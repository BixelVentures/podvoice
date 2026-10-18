"""PV47 strict scope preserves published46 and remains closed until final review."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission46 as published46
from scripts import candidate_scope_admission47 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED46_MERGE = "26438cdefac88c8bac071e8089636cd823c7a891"
PUBLISHED46_TREE = "294425524e8d8f5718ae688482a05cfff15d445a"


@pytest.fixture(scope="module")
def historical46_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published46") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED46_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED46_TREE], cwd=target, check=True)
    return target


PUBLISHED47_MERGE = "8604704df3175b9b34acca654a92bfe0305437c0"
PUBLISHED47_TREE = "fe17a88a4b26405a56eadc36476f15e1c5b4d4a3"


@pytest.fixture(scope="module")
def historical47_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published47") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED47_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED47_TREE], cwd=target, check=True)
    return target


def test_47_profile_preserves_history_and_limits_the_visual_delta(historical47_root):
    assert admission.BASE == PUBLISHED46_MERGE
    bindings = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert len({bool(value) for value in bindings}) == 1
    if all(bindings):
        assert (
            admission.sha(admission.safe_file(historical47_root, admission.MANIFEST))
            == admission.MANIFEST_SHA
        )
        assert (
            admission.strict.ast_sha(
                admission.safe_file(historical47_root, admission.PROFILE), "PROFILE_AST"
            )
            == admission.PROFILE_AST
        )
        assert admission.inspect_repository(historical47_root, admission.BASE).passed
    assert admission.VERSION == 24
    assert admission.KIND == "podview47_robot_and_locality"
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/locality_data/CREDITS.txt",
        "podvoice/gatekeeper/locality_data/GEONAMES-README.txt",
        "podvoice/gatekeeper/locality_data/localities.json",
        "podvoice/gatekeeper/locality_data/manifest.json",
        "podvoice/gatekeeper/offline_locality.py",
        "podvoice/gatekeeper/podview_locality.py",
        "podvoice/gatekeeper/podview_weather.py",
        "podvoice/gatekeeper/podview_weather_brief.py",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
        "podvoice/gatekeeper/static/podview/live-home-view.js",
        "podvoice/gatekeeper/static/podview/weather-observation.js",
        "podvoice/gatekeeper/static/podview/weather-view.js",
        "podvoice/gatekeeper/tools.py",
    }
    assert admission.REQUIRED_TESTS == {
        "tests/fixtures/offline-locality/geonames-DK.zip",
        "tests/podview/canonical-next-weather-view.test.mjs",
        "tests/podview/controller-peer-recovery.test.mjs",
        "tests/podview/robot-domain-authority.test.mjs",
        "tests/podview/transport-recovery.test.mjs",
        "tests/unit/test_candidate_scope_admission42.py",
        "tests/unit/test_candidate_scope_admission43.py",
        "tests/unit/test_candidate_scope_admission46.py",
        "tests/unit/test_candidate_scope_admission47.py",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_locality_backend.py",
        "tests/unit/test_offline_locality.py",
    }
    assert admission.ASSET_COUNT == 143
    assert admission.strict.pins_match(historical47_root, admission.IMMUTABLE)
    assert admission.IMMUTABLE.items() >= admission.previous.IMMUTABLE.items()
    assert admission.IMMUTABLE["scripts/candidate_scope_admission46.py"]
    assert admission.IMMUTABLE["scripts/podview46-admission-reviewed.json"]


def test_47_manifest_has_exact_inventories(historical47_root):
    manifest = json.loads(admission.safe_file(historical47_root, admission.MANIFEST))
    assert manifest["schema"] == "podvoice47.admission.v1"
    assert manifest["base"] == admission.BASE
    assert manifest["asset_count"] == admission.ASSET_COUNT
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert (
        set(manifest["runtime"])
        == admission.strict.runtime_inventory(historical47_root) | admission.HA_RUNTIME
    )
    assert set(manifest["config"]) == admission.CONFIG
    assert set(manifest["policy"]) == admission.POLICY - {admission.PROFILE, admission.MANIFEST}
    assert set(manifest["tooling"]) == admission.TOOLING
    for group in ("production", "regressions", "runtime", "config", "policy", "tooling"):
        assert admission.strict.pins_match(historical47_root, manifest[group])
    assert admission.assets_match47(historical47_root, manifest["runtime"], manifest["asset_count"])


def test_published46_remains_accepted_and_47_rejects_its_snapshot(historical46_root):
    assert published46.inspect_repository(historical46_root, published46.BASE).passed
    old_record = published46.record_at(historical46_root)
    old_report = admission.legacy.inspect_repository(historical46_root, admission.BASE)
    assert old_record is not None
    assert not admission.validate(historical46_root, old_report, PUBLISHED46_MERGE, old_record)


def test_47_cli_stops_when_reviewer_binding_is_missing(monkeypatch, capsys):
    monkeypatch.setattr(admission, "REVIEWER", "")
    assert admission.main(["--base", admission.BASE]) == 2
    assert "review bindings are not complete" in capsys.readouterr().err
