"""Exact38 admission rejects drift and never inherits historical37 approval."""

import json
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest
from scripts import candidate_scope_admission38 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED38 = "f0e3d62a5677050d2373f691a61cd733b3dd5be6"


@pytest.fixture(scope="module")
def historical38_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published38") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED38], cwd=target, check=True)
    return target


@pytest.fixture(scope="module")
def report(historical38_root):
    return admission.legacy.inspect_repository(historical38_root, admission.BASE)


@pytest.fixture
def reviewed_draft(monkeypatch, report, historical38_root):
    """Synthetic approval exercises exact validation; it never signs the candidate."""
    raw = admission.safe_file(historical38_root, admission.MANIFEST)
    manifest = json.loads(raw)
    monkeypatch.setattr(admission, "REVIEWER", "synthetic-independent-review")
    monkeypatch.setattr(admission, "MANIFEST_SHA", admission.sha(raw))
    monkeypatch.setattr(
        admission,
        "PROFILE_AST",
        admission.strict.ast_sha(
            admission.safe_file(historical38_root, admission.PROFILE), "PROFILE_AST"
        ),
    )
    record = {
        "version": admission.VERSION,
        "kind": admission.KIND,
        "base_tip": admission.BASE,
        "merge_base": admission.BASE,
        "domains": list(admission.DOMAINS),
        "reviewer": admission.REVIEWER,
        "rationale": "Synthetic complete exact38 validation only.",
        "fingerprint": admission.legacy.production_fingerprint(
            historical38_root, admission.BASE, admission.BASE, tuple(manifest["production"])
        ),
        "regression_fingerprint": admission.legacy.regression_fingerprint(
            historical38_root, admission.BASE, admission.BASE, tuple(manifest["regressions"])
        ),
        "runtime_fingerprint": admission.strict.fingerprint(historical38_root, manifest["runtime"]),
        "config_fingerprint": admission.strict.fingerprint(historical38_root, admission.CONFIG),
        "policy_fingerprint": admission.strict.fingerprint(historical38_root, admission.POLICY),
        "tooling_fingerprint": admission.strict.fingerprint(historical38_root, admission.TOOLING),
        "manifest_fingerprint": admission.MANIFEST_SHA,
    }
    return report, record


def test_38_timer_scope_and_assets_are_checked_against_published38(historical38_root):
    assert admission.BASE == "e4c2966197ac28aa6e86a0df55e7f461203df269"
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/ha_timers.py",
        "podvoice/gatekeeper/thin.py",
    }
    assert admission.IMMUTABLE.items() >= admission.previous.IMMUTABLE.items()
    assert admission.strict.pins_match(historical38_root, admission.IMMUTABLE)
    assert admission.config_only(historical38_root)
    manifest = json.loads(admission.safe_file(historical38_root, admission.MANIFEST))
    assert manifest["asset_count"] == 135
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS


def test_published38_stays_admitted_and_current_successor_is_not_38(historical38_root, report):
    assert admission.inspect_repository(historical38_root, admission.BASE).passed
    assert not admission.inspect_repository(ROOT, admission.BASE).passed


def test_complete_synthetic_exact38_accepts(reviewed_draft, historical38_root):
    report, record = reviewed_draft
    assert admission.validate(historical38_root, report, admission.BASE, record)


@pytest.mark.parametrize("pin", ["REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_missing_approval_never_inherits_37(reviewed_draft, historical38_root, monkeypatch, pin):
    report, record = reviewed_draft
    monkeypatch.setattr(admission, pin, "")
    assert not admission.validate(historical38_root, report, admission.BASE, record)


@pytest.mark.parametrize(
    "field",
    ["fingerprint", "regression_fingerprint", "runtime_fingerprint", "policy_fingerprint"],
)
def test_changed_exact_fingerprint_rejects(reviewed_draft, historical38_root, field):
    report, record = reviewed_draft
    assert not admission.validate(
        historical38_root, report, admission.BASE, {**record, field: "0" * 64}
    )


@pytest.mark.parametrize("base", [admission.previous.BASE, "f" * 40])
def test_historical_or_unknown_base_cannot_borrow_38(reviewed_draft, historical38_root, base):
    report, record = reviewed_draft
    assert not admission.validate(historical38_root, replace(report, base=base), base, record)


@pytest.mark.parametrize(
    "path",
    [
        "podvoice/gatekeeper/ha_timers.py",
        "podvoice/gatekeeper/thin.py",
        "scripts/candidate_scope_admission37.py",
        "scripts/podview37-admission-reviewed.json",
        "podvoice/config.yaml",
    ],
)
def test_runtime_historical_or_setting_mutation_rejects(
    reviewed_draft, historical38_root, monkeypatch, path
):
    report, record = reviewed_draft
    original = admission.strict.safe_file

    def changed(root, name):
        data = original(root, name)
        return data + b"\nunreviewed: true\n" if name == path else data

    monkeypatch.setattr(admission.strict, "safe_file", changed)
    assert not admission.validate(historical38_root, report, admission.BASE, record)


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
