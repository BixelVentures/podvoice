"""Exact NEXT49 inventory and fail-closed draft bindings; published48 stays immutable."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission48 as published48
from scripts import candidate_scope_admission49 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED48_MERGE = "d6c1cfe7c761a80056771af5f9ccccbc1fdd2437"
PUBLISHED48_TREE = "1f31630a93c549230d796ec4790e6815fd2c3172"


@pytest.fixture(scope="module")
def historical48_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published48") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED48_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED48_TREE], cwd=target, check=True)
    return target


def test_49_exact_scope_and_history():
    assert admission.BASE == PUBLISHED48_MERGE
    assert admission.VERSION == 26
    assert admission.KIND == "podview49_locality_lifecycle"
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/static/podview/weather-observation.js",
        "podvoice/gatekeeper/tools.py",
        "podvoice/gatekeeper/podview_locality.py",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
    }
    assert admission.REQUIRED_TESTS == {
        "tests/unit/test_candidate_scope_admission49.py",
        "tests/unit/test_candidate_scope_admission48.py",
        "tests/unit/test_locality_lifecycle.py",
        "tests/unit/test_locality_backend.py",
        "tests/unit/test_dev_cycle.py",
        "tests/podview/canonical-next-weather-view.test.mjs",
    }
    assert admission.IMMUTABLE.items() >= published48.IMMUTABLE.items()
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
    if all(bindings):
        assert admission.inspect_repository(ROOT, admission.BASE).passed
    else:
        assert not admission.inspect_repository(ROOT, admission.BASE).passed


def test_49_manifest_exact_inventory():
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert manifest["schema"] == "podvoice49.admission.v1"
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
    assert admission.assets_match49(ROOT, manifest["runtime"], manifest["asset_count"])


def test_published48_accepted_and_cannot_authorize49(historical48_root):
    assert published48.inspect_repository(historical48_root, published48.BASE).passed
    record = published48.record_at(historical48_root)
    report = admission.legacy.inspect_repository(historical48_root, admission.BASE)
    assert record is not None
    assert not admission.validate(historical48_root, report, PUBLISHED48_MERGE, record)


@pytest.mark.parametrize("binding", ["BASE", "REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_49_cli_closed_with_missing_binding(monkeypatch, capsys, binding):
    monkeypatch.setattr(admission, binding, "")
    assert admission.main(["--base", PUBLISHED48_MERGE]) == 2
    assert "review bindings are not complete" in capsys.readouterr().err
