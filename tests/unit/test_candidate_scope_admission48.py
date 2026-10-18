"""Exact NEXT48 inventory and fail-closed draft bindings; published47 stays immutable."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission47 as published47
from scripts import candidate_scope_admission48 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED47_MERGE = "8604704df3175b9b34acca654a92bfe0305437c0"
PUBLISHED47_TREE = "fe17a88a4b26405a56eadc36476f15e1c5b4d4a3"


@pytest.fixture(scope="module")
def historical47_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published47") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED47_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED47_TREE], cwd=target, check=True)
    return target


def test_48_exact_scope_and_history():
    assert admission.BASE == PUBLISHED47_MERGE
    assert admission.VERSION == 25
    assert admission.KIND == "podview48_delegated_presentation"
    assert admission.PRODUCTION == {"podvoice/gatekeeper/podview_receipts.py"}
    assert admission.REQUIRED_TESTS == {
        "tests/integration/test_podview_receipt_hooks.py",
        "tests/integration/test_delegated_presentation_selector48.py",
        "tests/unit/test_candidate_scope_admission47.py",
        "tests/unit/test_candidate_scope_admission48.py",
        "tests/unit/test_dev_cycle.py",
    }
    assert admission.IMMUTABLE.items() >= published47.IMMUTABLE.items()
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


def test_48_manifest_exact_inventory():
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert manifest["schema"] == "podvoice48.admission.v1"
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
    assert admission.assets_match48(ROOT, manifest["runtime"], manifest["asset_count"])


def test_published47_accepted_and_cannot_authorize48(historical47_root):
    assert published47.inspect_repository(historical47_root, published47.BASE).passed
    record = published47.record_at(historical47_root)
    report = admission.legacy.inspect_repository(historical47_root, admission.BASE)
    assert record is not None
    assert not admission.validate(historical47_root, report, PUBLISHED47_MERGE, record)


@pytest.mark.parametrize("binding", ["BASE", "REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_48_cli_closed_with_missing_binding(monkeypatch, capsys, binding):
    monkeypatch.setattr(admission, binding, "")
    assert admission.main(["--base", PUBLISHED47_MERGE]) == 2
    assert "review bindings are not complete" in capsys.readouterr().err
