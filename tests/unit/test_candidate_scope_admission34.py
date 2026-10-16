"""PodView34 navigation admission fails closed until independent exact-tree review."""

import json
from pathlib import Path

import pytest
from scripts import candidate_scope_admission34 as admission

SOURCE = Path(__file__).parents[2]


def test_closed_navigation_inventory_and_historical_pins():
    assert admission.PRODUCTION == {"podvoice/gatekeeper/static/index.html"}
    assert admission.REQUIRED_TESTS == {
        "tests/integration/test_podview_pairing_navigation.py",
        "tests/unit/test_candidate_scope_admission34.py",
        "tests/unit/test_dev_cycle.py",
    }
    assert admission.POLICY == {
        "scripts/candidate_scope_admission34.py",
        "scripts/podview34-admission-reviewed.json",
        "scripts/dev_cycle.py",
        ".github/workflows/ci.yml",
    }
    for name, digest in admission.IMMUTABLE.items():
        assert admission.sha((SOURCE / name).read_bytes()) == digest


def test_unreviewed_candidate_rejects_even_with_complete_old_approval(monkeypatch):
    monkeypatch.setattr(admission, "REVIEWER", "")
    report = admission.legacy.CandidateScope(
        "head", admission.BASE, (), (), admission.DOMAINS, True, "historical PASS"
    )
    monkeypatch.setattr(admission.previous, "inspect_repository", lambda *_args: report)
    inspected = admission.inspect_repository(SOURCE, admission.BASE)
    assert not inspected.passed
    assert "PodView34" in inspected.reason


@pytest.mark.parametrize(
    "name",
    ["REVIEWER", "MANIFEST_SHA", "PROFILE_AST"],
)
def test_empty_review_pin_always_rejects(monkeypatch, name):
    monkeypatch.setattr(admission, name, "")
    report = admission.legacy.CandidateScope(
        "head", admission.BASE, (), (), admission.DOMAINS, False, "synthetic"
    )
    record = {field: "synthetic" for field in admission.FIELDS}
    record.update(
        version=admission.VERSION,
        kind=admission.KIND,
        reviewer="synthetic",
        domains=list(admission.DOMAINS),
        base_tip=admission.BASE,
        merge_base=admission.BASE,
    )
    assert not admission.validate(SOURCE, report, admission.BASE, record)


def test_record_parser_rejects_duplicate_or_malformed_json(tmp_path):
    status = tmp_path / "docs/STATUS.md"
    status.parent.mkdir()
    status.write_text("No navigation approval\n")
    assert admission.record_at(tmp_path) is None
    status.write_text(admission.RECORD_MARKER + " {} -->\n" + admission.RECORD_MARKER)
    with pytest.raises(ValueError, match="duplicate"):
        admission.record_at(tmp_path)
    status.write_text(admission.RECORD_MARKER + " {bad} -->")
    with pytest.raises(json.JSONDecodeError):
        admission.record_at(tmp_path)


def test_reviewed_manifest_has_closed_schema():
    manifest = json.loads((SOURCE / admission.MANIFEST).read_text())
    assert manifest["schema"] == "podview34.admission.v1"
    assert manifest["base"] == admission.BASE
    assert set(manifest) == {
        "schema",
        "base",
        "production",
        "regressions",
        "runtime",
        "config",
        "policy",
        "tooling",
        "asset_count",
    }


def test_actual34_caller_preserves_historical_dispatch(monkeypatch, tmp_path):
    from tests.unit.test_dev_cycle import (
        test_release_runs_candidate_scope_against_frozen_merge_base,
    )

    test_release_runs_candidate_scope_against_frozen_merge_base(
        monkeypatch,
        tmp_path,
        admission.BASE,
        admission.PROFILE,
    )
