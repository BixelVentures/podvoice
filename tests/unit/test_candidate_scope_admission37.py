"""Exact37 rejects drift while preserving frozen historical profiles."""

import json
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest
from scripts import candidate_scope_admission37 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED37 = "3c95be311fe1622655ab8bf028d697523343e480"


@pytest.fixture(scope="module")
def historical37_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published37") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED37], cwd=target, check=True)
    return target


@pytest.fixture(scope="module")
def report(historical37_root):
    return admission.legacy.inspect_repository(historical37_root, admission.BASE)


@pytest.fixture
def reviewed_draft(monkeypatch, report, historical37_root):
    """Synthetic approval exercises validation; it never signs the real candidate."""
    raw = admission.safe_file(historical37_root, admission.MANIFEST)
    manifest = json.loads(raw)
    monkeypatch.setattr(admission, "REVIEWER", "synthetic-independent-review")
    monkeypatch.setattr(admission, "MANIFEST_SHA", admission.sha(raw))
    monkeypatch.setattr(
        admission,
        "PROFILE_AST",
        admission.strict.ast_sha(
            admission.safe_file(historical37_root, admission.PROFILE), "PROFILE_AST"
        ),
    )
    record = {
        "version": admission.VERSION,
        "kind": admission.KIND,
        "base_tip": admission.BASE,
        "merge_base": admission.BASE,
        "domains": list(admission.DOMAINS),
        "reviewer": admission.REVIEWER,
        "rationale": "Synthetic complete exact37 validation only.",
        "fingerprint": admission.legacy.production_fingerprint(
            historical37_root, admission.BASE, admission.BASE, tuple(manifest["production"])
        ),
        "regression_fingerprint": admission.legacy.regression_fingerprint(
            historical37_root, admission.BASE, admission.BASE, tuple(manifest["regressions"])
        ),
        "runtime_fingerprint": admission.strict.fingerprint(historical37_root, manifest["runtime"]),
        "config_fingerprint": admission.strict.fingerprint(historical37_root, admission.CONFIG),
        "policy_fingerprint": admission.strict.fingerprint(historical37_root, admission.POLICY),
        "tooling_fingerprint": admission.strict.fingerprint(historical37_root, admission.TOOLING),
        "manifest_fingerprint": admission.MANIFEST_SHA,
    }
    return report, record


def test_37_exact_assets_and_version_are_checked_against_published37(historical37_root):
    assert admission.BASE == "aa49d94e588974683ad3b9ad4b6d34da81676b58"
    assert admission.PRODUCTION == {
        admission.STATIC + "widget-redesign.css",
        admission.STATIC + "asset-manifest.json",
    }
    assert admission.HA_RUNTIME == admission.previous.HA_RUNTIME
    assert admission.IMMUTABLE.items() >= admission.previous.IMMUTABLE.items()
    assert admission.strict.pins_match(historical37_root, admission.IMMUTABLE)
    assert admission.config_only(historical37_root)
    css = admission.safe_file(historical37_root, admission.STATIC + "widget-redesign.css").decode()
    assert "width:390px;height:auto;min-height:136px" in css


def test_published37_stays_admitted_and_current_successor_is_not_37(report, historical37_root):
    assert admission.inspect_repository(historical37_root, admission.BASE).passed
    assert not admission.inspect_repository(ROOT, admission.BASE).passed


def test_complete_synthetic_exact37_accepts(reviewed_draft, historical37_root):
    report, record = reviewed_draft
    assert admission.validate(historical37_root, report, admission.BASE, record)


@pytest.mark.parametrize("pin", ["REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_missing_approval_never_inherits_36(reviewed_draft, historical37_root, monkeypatch, pin):
    report, record = reviewed_draft
    monkeypatch.setattr(admission, pin, "")
    assert not admission.validate(historical37_root, report, admission.BASE, record)


@pytest.mark.parametrize(
    "field", ["fingerprint", "regression_fingerprint", "runtime_fingerprint", "policy_fingerprint"]
)
def test_changed_exact_fingerprint_rejects(reviewed_draft, historical37_root, field):
    report, record = reviewed_draft
    assert not admission.validate(
        historical37_root, report, admission.BASE, {**record, field: "0" * 64}
    )


@pytest.mark.parametrize("base", [admission.previous.BASE, "f" * 40])
def test_historical_or_unknown_base_cannot_borrow_37(reviewed_draft, historical37_root, base):
    report, record = reviewed_draft
    assert not admission.validate(historical37_root, replace(report, base=base), base, record)


@pytest.mark.parametrize(
    "path",
    [
        "podvoice/gatekeeper/thin.py",
        "custom_components/podvoice/controller_admin.py",
        "scripts/candidate_scope_admission36.py",
        "scripts/podview36-admission-reviewed.json",
        "podvoice/config.yaml",
    ],
)
def test_runtime_historical_or_setting_mutation_rejects(
    reviewed_draft, historical37_root, monkeypatch, path
):
    report, record = reviewed_draft
    original = admission.strict.safe_file

    def changed(root, name):
        data = original(root, name)
        return data + b"\nunreviewed: true\n" if name == path else data

    monkeypatch.setattr(admission.strict, "safe_file", changed)
    assert not admission.validate(historical37_root, report, admission.BASE, record)


@pytest.mark.parametrize("path", ["podvoice/gatekeeper/new.py", "scripts/unreviewed.py"])
def test_added_unknown_owner_or_tool_cannot_hide_behind_reviewed_assets(path):
    effective = (
        admission.PRODUCTION
        | admission.CONFIG
        | admission.POLICY
        | admission.REQUIRED_TESTS
        | {"docs/STATUS.md", "podvoice/CHANGELOG.md"}
    )
    assert admission.change_scope_matches(effective, admission.REQUIRED_TESTS)
    assert not admission.change_scope_matches(effective | {path}, admission.REQUIRED_TESTS)
    if path.startswith("podvoice/"):
        assert not admission.production_scope_matches(effective | {path})
