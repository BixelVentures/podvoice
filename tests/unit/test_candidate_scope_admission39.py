"""Exact39 admission remains closed until its final review bindings are supplied."""

import json
from pathlib import Path

import pytest
from scripts import candidate_scope_admission39 as admission

ROOT = Path(__file__).parents[2]


def test_39_profile_is_additive_and_uses_only_the_existing_version_trio():
    assert admission.BASE == "f0e3d62a5677050d2373f691a61cd733b3dd5be6"
    assert admission.DOMAINS == ("ha_tools",)
    assert admission.PRODUCTION == {
        "custom_components/podvoice/__init__.py",
        "custom_components/podvoice/config_flow.py",
        "custom_components/podvoice/controller_admin.py",
        "custom_components/podvoice/services.yaml",
        "custom_components/podvoice/strings.json",
        "custom_components/podvoice/translations/da.json",
        "custom_components/podvoice/translations/en.json",
        "podvoice/gatekeeper/__main__.py",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/podview_admin_transport.py",
        "podvoice/gatekeeper/podview_continuity.py",
        "podvoice/gatekeeper/podview_controller_admin.py",
        "podvoice/gatekeeper/podview_controls.py",
        "podvoice/gatekeeper/podview_music_selection.py",
        "podvoice/gatekeeper/podview_queue.py",
        "podvoice/gatekeeper/podview_speakers.py",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/podvoice-transport.js",
        "podvoice/gatekeeper/static/podview/setup.html",
        "podvoice/gatekeeper/static/podview/setup.js",
    }
    assert admission.strict.pins_match(ROOT, admission.IMMUTABLE)
    assert admission.IMMUTABLE.items() >= admission.previous.IMMUTABLE.items()
    assert admission.CONFIG == admission.previous.CONFIG | {
        "custom_components/podvoice/manifest.json"
    }
    assert admission.config_only(ROOT)


def test_39_draft_manifest_has_exact_changed_production_and_regression_paths():
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert manifest["schema"] == "podvoice39.admission.v1"
    assert manifest["base"] == admission.BASE
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert set(manifest["config"]) == admission.CONFIG
    assert manifest["asset_count"] == 135


def test_39_rejects_unreviewed_ha_manifest_fields(monkeypatch):
    original = admission.safe_file

    def changed(root, name):
        data = original(root, name)
        if name == "custom_components/podvoice/manifest.json":
            return data.replace(b'"local_push"', b'"cloud_push"', 1)
        return data

    monkeypatch.setattr(admission, "safe_file", changed)
    assert not admission.config_only(ROOT)


@pytest.fixture
def reviewed_draft(monkeypatch):
    """Synthetic complete approval proves exact39 validation without signing it."""
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
        "rationale": "Synthetic complete exact39 validation only.",
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


def test_39_complete_synthetic_exact39_admission_accepts(reviewed_draft):
    report, record = reviewed_draft
    assert admission.validate(ROOT, report, admission.BASE, record)


@pytest.mark.parametrize("pin", ["REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_39_missing_approval_binding_rejects(reviewed_draft, monkeypatch, pin):
    report, record = reviewed_draft
    monkeypatch.setattr(admission, pin, "")
    assert not admission.validate(ROOT, report, admission.BASE, record)
