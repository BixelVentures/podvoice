"""Exact NEXT51 inventory and fail-closed draft bindings; published50 stays immutable."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission50 as published50
from scripts import candidate_scope_admission51 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED50_MERGE = "e2e9552459f920385f4228b80ce9a35750b072a5"
PUBLISHED50_TREE = "55a92b36f887614926ece2ac3110e1102f60c480"


@pytest.fixture(scope="module")
def historical50_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published50") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED50_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED50_TREE], cwd=target, check=True)
    return target


def test_51_exact_scope_and_history():
    assert admission.BASE == PUBLISHED50_MERGE
    assert admission.VERSION == 28
    assert admission.KIND == "podview51_queue_viewport"
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/widget-redesign.css",
    }
    assert admission.REQUIRED_TESTS == {
        "tests/unit/test_candidate_scope_admission51.py",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_candidate_scope_admission50.py",
    }
    assert admission.IMMUTABLE.items() >= published50.IMMUTABLE.items()
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


def test_51_manifest_exact_inventory():
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert manifest["schema"] == "podvoice51.admission.v1"
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
    assert admission.assets_match51(ROOT, manifest["runtime"], manifest["asset_count"])


def test_published50_accepted_and_cannot_authorize51(historical50_root):
    assert published50.inspect_repository(historical50_root, published50.BASE).passed
    record = published50.record_at(historical50_root)
    report = admission.legacy.inspect_repository(historical50_root, admission.BASE)
    assert record is not None
    assert not admission.validate(historical50_root, report, PUBLISHED50_MERGE, record)


@pytest.mark.parametrize("binding", ["BASE", "REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_51_cli_closed_with_missing_binding(monkeypatch, capsys, binding):
    monkeypatch.setattr(admission, binding, "")
    assert admission.main(["--base", PUBLISHED50_MERGE]) == 2
    assert "review bindings are not complete" in capsys.readouterr().err


def test_51_full_validator_accepts_51_schema_and_rejects_50(monkeypatch):
    """Exercise schema admission after all signature preconditions, without signing files."""
    reviewer = "Synthetic test-only reviewer"
    raw_manifest = admission.safe_file(ROOT, admission.MANIFEST)
    manifest_sha = admission.sha(raw_manifest)
    monkeypatch.setattr(admission, "REVIEWER", reviewer)
    monkeypatch.setattr(admission, "MANIFEST_SHA", manifest_sha)
    monkeypatch.setattr(
        admission,
        "PROFILE_AST",
        admission.strict.ast_sha(admission.safe_file(ROOT, admission.PROFILE), "PROFILE_AST"),
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
    report = admission.legacy.inspect_repository(ROOT, admission.BASE)
    assert admission.validate(ROOT, report, admission.BASE, record)

    # Rebind the altered payload's digest so rejection specifically tests its schema.
    wrong = json.loads(raw_manifest)
    wrong["schema"] = "podvoice50.admission.v1"
    wrong_raw = json.dumps(wrong).encode()
    real_safe_file = admission.safe_file
    monkeypatch.setattr(
        admission,
        "safe_file",
        lambda root, name: wrong_raw if name == admission.MANIFEST else real_safe_file(root, name),
    )
    monkeypatch.setattr(admission, "MANIFEST_SHA", admission.sha(wrong_raw))
    record["manifest_fingerprint"] = admission.sha(wrong_raw)
    assert not admission.validate(ROOT, report, admission.BASE, record)
