"""Exact NEXT53 inventory and fail-closed draft bindings; published52 stays immutable."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission52 as published52
from scripts import candidate_scope_admission53 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED52_MERGE = "16fb39d8f780ae9b2925163027974e4952424217"
PUBLISHED52_TREE = "88450be6fc93c68bda4d1baf9495c7b27e9d0b15"
PUBLISHED53_MERGE = "c89d429937dbbbc1195b363f9dc531fa185e3d22"
PUBLISHED53_TREE = "eeeb07c3abf00e83ffe0c5020496e9c761f4fc3b"


@pytest.fixture(scope="module")
def historical52_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published52") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED52_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED52_TREE], cwd=target, check=True)
    return target


@pytest.fixture(scope="module")
def historical53_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published53") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED53_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED53_TREE], cwd=target, check=True)
    return target


def test_53_exact_scope_and_history(historical53_root):
    assert admission.BASE == PUBLISHED52_MERGE
    assert admission.VERSION == 30
    assert admission.KIND == "podview53_music_state_copy"
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/widget-view.js",
        "podvoice/gatekeeper/static/podview/music-results.js",
    }
    assert admission.REQUIRED_TESTS == {
        "tests/unit/test_candidate_scope_admission53.py",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_candidate_scope_admission52.py",
        "tests/podview/canonical-next-widget-loading.test.mjs",
    }
    assert admission.IMMUTABLE.items() >= published52.IMMUTABLE.items()
    assert admission.strict.pins_match(historical53_root, admission.IMMUTABLE)
    assert admission.config_only(historical53_root)
    report = admission.legacy.inspect_repository(historical53_root, admission.BASE)
    assert report.domains == admission.DOMAINS
    effective = admission.legacy._visual_repository_changes(historical53_root, admission.BASE)
    assert admission.production_scope_matches(effective)
    assert {p for p in effective if p.startswith("tests/")} == admission.REQUIRED_TESTS
    assert admission.change_scope_matches(effective, set(admission.REQUIRED_TESTS))
    bindings = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert len({bool(value) for value in bindings}) == 1
    if all(bindings):
        assert admission.inspect_repository(historical53_root, admission.BASE).passed
        assert not admission.inspect_repository(ROOT, admission.BASE).passed
    else:
        assert not admission.inspect_repository(ROOT, admission.BASE).passed


def test_53_manifest_exact_inventory(historical53_root):
    manifest = json.loads(admission.safe_file(historical53_root, admission.MANIFEST))
    assert manifest["schema"] == "podvoice53.admission.v1"
    assert manifest["base"] == admission.BASE
    assert manifest["asset_count"] == admission.ASSET_COUNT == 143
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert (
        set(manifest["runtime"])
        == admission.strict.runtime_inventory(historical53_root) | admission.HA_RUNTIME
    )
    assert set(manifest["config"]) == admission.CONFIG
    assert set(manifest["policy"]) == admission.POLICY - {admission.PROFILE, admission.MANIFEST}
    assert set(manifest["tooling"]) == admission.TOOLING
    for group in ("production", "regressions", "runtime", "config", "policy", "tooling"):
        assert admission.strict.pins_match(historical53_root, manifest[group])
    assert admission.assets_match53(historical53_root, manifest["runtime"], manifest["asset_count"])


def test_published52_accepted_and_cannot_authorize53(historical52_root):
    assert published52.inspect_repository(historical52_root, published52.BASE).passed
    record = published52.record_at(historical52_root)
    report = admission.legacy.inspect_repository(historical52_root, admission.BASE)
    assert record is not None
    assert not admission.validate(historical52_root, report, PUBLISHED52_MERGE, record)


@pytest.mark.parametrize("binding", ["BASE", "REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_53_cli_closed_with_missing_binding(monkeypatch, capsys, binding):
    monkeypatch.setattr(admission, binding, "")
    assert admission.main(["--base", PUBLISHED52_MERGE]) == 2
    assert "review bindings are not complete" in capsys.readouterr().err


def test_53_full_validator_accepts_53_schema_and_rejects_52(monkeypatch, historical53_root):
    """Exercise schema admission after all signature preconditions, without signing files."""
    reviewer = "Synthetic test-only reviewer"
    raw_manifest = admission.safe_file(historical53_root, admission.MANIFEST)
    manifest_sha = admission.sha(raw_manifest)
    monkeypatch.setattr(admission, "REVIEWER", reviewer)
    monkeypatch.setattr(admission, "MANIFEST_SHA", manifest_sha)
    monkeypatch.setattr(
        admission,
        "PROFILE_AST",
        admission.strict.ast_sha(
            admission.safe_file(historical53_root, admission.PROFILE), "PROFILE_AST"
        ),
    )
    record = {
        "version": admission.VERSION,
        "kind": admission.KIND,
        "reviewer": reviewer,
        "domains": list(admission.DOMAINS),
        "base_tip": admission.BASE,
        "merge_base": admission.BASE,
        "rationale": "Synthetic validator regression; never persisted as admission authority.",
        "fingerprint": admission.legacy.production_fingerprint(
            historical53_root, admission.BASE, admission.BASE, tuple(admission.PRODUCTION)
        ),
        "regression_fingerprint": admission.legacy.regression_fingerprint(
            historical53_root, admission.BASE, admission.BASE, tuple(admission.REQUIRED_TESTS)
        ),
        "runtime_fingerprint": admission.strict.fingerprint(
            historical53_root,
            admission.strict.runtime_inventory(historical53_root) | admission.HA_RUNTIME,
        ),
        "config_fingerprint": admission.strict.fingerprint(historical53_root, admission.CONFIG),
        "policy_fingerprint": admission.strict.fingerprint(historical53_root, admission.POLICY),
        "tooling_fingerprint": admission.strict.fingerprint(historical53_root, admission.TOOLING),
        "manifest_fingerprint": manifest_sha,
    }
    report = admission.legacy.inspect_repository(historical53_root, admission.BASE)
    assert admission.validate(historical53_root, report, admission.BASE, record)

    # Rebind the altered payload's digest so rejection specifically tests its schema.
    wrong = json.loads(raw_manifest)
    wrong["schema"] = "podvoice52.admission.v1"
    wrong_raw = json.dumps(wrong).encode()
    real_safe_file = admission.safe_file
    monkeypatch.setattr(
        admission,
        "safe_file",
        lambda root, name: wrong_raw if name == admission.MANIFEST else real_safe_file(root, name),
    )
    monkeypatch.setattr(admission, "MANIFEST_SHA", admission.sha(wrong_raw))
    record["manifest_fingerprint"] = admission.sha(wrong_raw)
    assert not admission.validate(historical53_root, report, admission.BASE, record)
