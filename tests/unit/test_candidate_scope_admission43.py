"""PV43 exact-tree admission is closed until the actual CI157 base and review bind."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission42 as published42
from scripts import candidate_scope_admission43 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED42_BASE = "405e0a657cc54e3cb56283bcd9f3bfd9a72837eb"
PUBLISHED42_TREE = "ba60e44fab625061aede741d9ddf687691259cfd"
PUBLISHED43_MERGE = "3f3628a6a847a322a0aa49788b56dd65836d1986"
PUBLISHED43_TREE = "4e9f3d07df8ce7ebc1ba592f8b6dfd32b75b4052"


@pytest.fixture(scope="module")
def historical42_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published42") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED42_BASE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED42_TREE], cwd=target, check=True)
    return target


@pytest.fixture(scope="module")
def historical43_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published43") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED43_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED43_TREE], cwd=target, check=True)
    return target


def test_43_profile_preserves_history_and_limits_the_visual_delta(historical43_root):
    assert admission.BASE == "4f183f19689fcf87f90d26c6a14a8e6e153d93c1"
    bindings = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert len({bool(value) for value in bindings}) == 1
    assert admission.VERSION == 20
    assert admission.KIND == "podview43_visual_followup"
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/podview_music_control.py",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
        "podvoice/gatekeeper/static/podview/ui/library/library.css",
        "podvoice/gatekeeper/static/podview/widget-redesign.css",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
    }
    assert admission.REQUIRED_TESTS == {
        "tests/integration/test_podview_music_control.py",
        "tests/integration/test_talk_webrtc.py",
        "tests/podview/root-live-control-view.test.mjs",
        "tests/unit/test_candidate_scope_admission43.py",
        "tests/unit/test_ci_scope.py",
        "tests/unit/test_dev_cycle.py",
    }
    assert admission.ASSET_COUNT == 143
    assert admission.strict.pins_match(historical43_root, admission.IMMUTABLE)
    assert admission.IMMUTABLE.items() >= admission.previous.IMMUTABLE.items()
    assert admission.IMMUTABLE["scripts/candidate_scope_admission42.py"]
    assert admission.IMMUTABLE["scripts/podview42-admission-reviewed.json"]


def test_43_draft_manifest_has_exact_inventories(historical43_root):
    root = historical43_root
    manifest = json.loads(admission.safe_file(root, admission.MANIFEST))
    assert manifest["schema"] == "podvoice43.admission.v1"
    assert manifest["base"] == admission.BASE
    assert manifest["asset_count"] == admission.ASSET_COUNT
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert (
        set(manifest["runtime"]) == admission.strict.runtime_inventory(root) | admission.HA_RUNTIME
    )
    assert set(manifest["config"]) == admission.CONFIG
    assert set(manifest["policy"]) == admission.POLICY - {
        admission.PROFILE,
        admission.MANIFEST,
    }
    assert set(manifest["tooling"]) == admission.TOOLING
    if admission.MANIFEST_SHA:
        assert admission.MANIFEST_SHA == admission.sha(
            admission.safe_file(root, admission.MANIFEST)
        )
        assert admission.PROFILE_AST == admission.strict.ast_sha(
            admission.safe_file(root, admission.PROFILE), "PROFILE_AST"
        )


def test_published42_remains_accepted_and_43_rejects_the_old_snapshot(historical42_root):
    assert published42.inspect_repository(historical42_root, published42.BASE).passed
    old_record = published42.record_at(historical42_root)
    old_report = published42.legacy.inspect_repository(historical42_root, published42.BASE)
    assert old_record is not None
    assert not admission.validate(historical42_root, old_report, PUBLISHED42_BASE, old_record)


def test_43_cli_stops_when_reviewer_binding_is_missing(monkeypatch, capsys):
    monkeypatch.setattr(admission, "REVIEWER", "")
    assert admission.main(["--base", admission.BASE]) == 2
    assert "review bindings are not complete" in capsys.readouterr().err
