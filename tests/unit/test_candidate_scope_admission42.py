"""PV42 admission stays closed until the merged41 base and review are bound."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission41 as published41
from scripts import candidate_scope_admission42 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED41_BASE = "6799ee3d65cb67fb406346c565dc206e08cbf0da"
PUBLISHED41_TREE = "5e6ccbf186bf5c4abc9a32845afed4ca94dda80d"
PUBLISHED42_MERGE = "405e0a657cc54e3cb56283bcd9f3bfd9a72837eb"
PUBLISHED42_TREE = "ba60e44fab625061aede741d9ddf687691259cfd"


@pytest.fixture(scope="module")
def historical41_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published41") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED41_BASE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED41_TREE], cwd=target, check=True)
    return target


@pytest.fixture(scope="module")
def historical42_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published42") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED42_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED42_TREE], cwd=target, check=True)
    return target


def test_42_profile_preserves_exact41_and_contains_only_room_observation_delta(historical42_root):
    assert admission.BASE == "fa7a3d1d5f09d31aa04e842dbce22f8654f2eca5"
    approval_bindings = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert len({bool(value) for value in approval_bindings}) == 1
    assert admission.DOMAINS == ("physical_output",)
    assert admission.VERSION == 19
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/podview_music_control.py",
        "podvoice/gatekeeper/podview_room_media.py",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
    }
    assert admission.REQUIRED_TESTS == {
        "tests/integration/test_podview_room_move_caller.py",
        "tests/integration/test_room_media_binding.py",
        "tests/podview/canonical-next-native-music-controls.test.mjs",
        "tests/podview/canonical-next-podvoice-view.test.mjs",
        "tests/unit/test_candidate_scope_admission41.py",
        "tests/unit/test_candidate_scope_admission42.py",
        "tests/unit/test_ci_scope.py",
        "tests/unit/test_dev_cycle.py",
    }
    assert admission.ASSET_COUNT == 143
    assert admission.strict.pins_match(historical42_root, admission.IMMUTABLE)
    assert admission.IMMUTABLE.items() >= published41.IMMUTABLE.items()


def test_42_draft_manifest_has_exact_changed_inventories(historical42_root):
    root = historical42_root
    manifest = json.loads(admission.safe_file(root, admission.MANIFEST))
    assert manifest["schema"] == "podvoice42.admission.v1"
    assert manifest["base"] == admission.BASE
    assert manifest["asset_count"] == admission.ASSET_COUNT
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert set(manifest["runtime"]) == (
        admission.strict.runtime_inventory(root) | admission.HA_RUNTIME
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


def test_published41_snapshot_remains_accepted_and_42_stub_fails_closed(historical41_root):
    assert published41.inspect_repository(historical41_root, published41.BASE).passed
    report = published41.legacy.inspect_repository(historical41_root, published41.BASE)
    assert not admission.validate(historical41_root, report, PUBLISHED41_BASE, {})


def test_42_cli_stops_when_reviewer_binding_is_missing(monkeypatch, capsys):
    monkeypatch.setattr(admission, "REVIEWER", "")
    assert admission.main(["--base", admission.BASE]) == 2
    assert "review bindings are not complete" in capsys.readouterr().err
