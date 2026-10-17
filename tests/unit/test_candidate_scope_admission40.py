"""Exact40 browser timer admission preserves the reviewed39 baseline."""

import json
from pathlib import Path

import pytest
from scripts import candidate_scope_admission40 as admission

ROOT = Path(__file__).parents[2]


def test_40_scope_is_exact_and_additive_to_published39():
    assert admission.BASE == "97e4b44fd5299136e562d5eebf0076c8ebf83bb2"
    assert admission.DOMAINS == ("unclassified_runtime",)
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/setup.js",
    }
    assert admission.CONFIG == {
        "podvoice/config.yaml",
        "podvoice/gatekeeper/__init__.py",
        "pyproject.toml",
    }
    assert admission.strict.pins_match(ROOT, admission.IMMUTABLE)
    assert admission.IMMUTABLE.items() >= admission.previous.IMMUTABLE.items()
    assert admission.config_only(ROOT)


def test_40_draft_manifest_has_exact_inventory_keys():
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert manifest["schema"] == "podvoice40.admission.v1"
    assert manifest["base"] == admission.BASE
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert (
        set(manifest["runtime"]) == admission.strict.runtime_inventory(ROOT) | admission.HA_RUNTIME
    )
    assert set(manifest["config"]) == admission.CONFIG
    assert set(manifest["policy"]) == admission.POLICY - {admission.PROFILE, admission.MANIFEST}
    assert set(manifest["tooling"]) == admission.TOOLING
    assert manifest["asset_count"] == 135


@pytest.fixture
def reviewed_draft(monkeypatch):
    """Synthetic complete approval exercises exact40 validation without signing."""
    raw = admission.safe_file(ROOT, admission.MANIFEST)
    manifest = json.loads(raw)
    monkeypatch.setattr(admission, "REVIEWER", "synthetic-independent-review")
    monkeypatch.setattr(admission, "MANIFEST_SHA", admission.sha(raw))
    monkeypatch.setattr(
        admission,
        "PROFILE_AST",
        admission.strict.ast_sha(admission.safe_file(ROOT, admission.PROFILE), "PROFILE_AST"),
    )
    report = admission.legacy.inspect_repository(ROOT, admission.BASE)
    record = {
        "version": admission.VERSION,
        "kind": admission.KIND,
        "base_tip": admission.BASE,
        "merge_base": admission.BASE,
        "domains": list(admission.DOMAINS),
        "reviewer": admission.REVIEWER,
        "rationale": "Synthetic complete exact40 validation only.",
        "fingerprint": admission.legacy.production_fingerprint(
            ROOT, admission.BASE, admission.BASE, tuple(manifest["production"])
        ),
        "regression_fingerprint": admission.legacy.regression_fingerprint(
            ROOT, admission.BASE, admission.BASE, tuple(manifest["regressions"])
        ),
        "runtime_fingerprint": admission.strict.fingerprint(ROOT, manifest["runtime"]),
        "config_fingerprint": admission.strict.fingerprint(ROOT, admission.CONFIG),
        "policy_fingerprint": admission.strict.fingerprint(ROOT, admission.POLICY),
        "tooling_fingerprint": admission.strict.fingerprint(ROOT, admission.TOOLING),
        "manifest_fingerprint": admission.MANIFEST_SHA,
    }
    return report, record


def test_40_complete_synthetic_exact_admission_accepts(reviewed_draft):
    report, record = reviewed_draft
    assert admission.validate(ROOT, report, admission.BASE, record)


@pytest.mark.parametrize("pin", ["REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_40_missing_review_binding_rejects(reviewed_draft, monkeypatch, pin):
    report, record = reviewed_draft
    monkeypatch.setattr(admission, pin, "")
    assert not admission.validate(ROOT, report, admission.BASE, record)
