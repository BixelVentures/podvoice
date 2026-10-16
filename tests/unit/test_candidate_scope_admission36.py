"""The queue-only 36 gate stays closed until an independent exact-tree review."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission36 as admission

ROOT = Path(__file__).parents[2]
EXPECTED_PRODUCTION = {
    "podvoice/gatekeeper/podview_queue.py",
    "podvoice/gatekeeper/podview_queue_scope.py",
    "podvoice/gatekeeper/podview_music_control.py",
}
EXPECTED_TESTS = {
    "tests/integration/test_podview_room_queue.py",
    "tests/unit/test_podview_queue_scope.py",
    "tests/integration/test_podview_queue_occurrence.py",
    "tests/integration/test_queue_controller_boundary.py",
    "tests/unit/test_candidate_scope_admission36.py",
}


def test_36_is_exact_queue_delta_from_published_35():
    assert admission.BASE == "ed0fbc41d9ab2a9fcdbf0648d2ee0839abd1befd"
    assert admission.KIND == "podview36_exact_queue_occurrence"
    assert admission.VERSION == 11
    assert admission.DOMAINS == ("physical_output",)
    assert admission.PRODUCTION == EXPECTED_PRODUCTION
    assert admission.REQUIRED_TESTS == EXPECTED_TESTS
    assert admission.DELETED_PRODUCTION == {}
    assert admission.production_scope_matches(
        EXPECTED_PRODUCTION | {"podvoice/gatekeeper/__init__.py"}
    )
    assert not admission.production_scope_matches(
        EXPECTED_PRODUCTION - {next(iter(EXPECTED_PRODUCTION))}
    )
    assert not admission.production_scope_matches(
        EXPECTED_PRODUCTION | {"podvoice/gatekeeper/unreviewed.py"}
    )
    allowed = (
        EXPECTED_PRODUCTION
        | EXPECTED_TESTS
        | admission.CONFIG
        | admission.POLICY
        | admission.TOOLING
        | {"podvoice/CHANGELOG.md", "docs/STATUS.md"}
    )
    assert admission.change_scope_matches(allowed, EXPECTED_TESTS)
    assert not admission.change_scope_matches(
        allowed | {"podvoice/gatekeeper/unreviewed.py"}, EXPECTED_TESTS
    )


def test_historical_35_gate_and_pins_are_immutable():
    for name in (
        "scripts/candidate_scope_admission35.py",
        "scripts/podview35-admission-reviewed.json",
        "tests/unit/test_candidate_scope_admission35.py",
    ):
        assert admission.sha(admission.safe_file(ROOT, name)) == admission.IMMUTABLE[name]
    assert admission.IMMUTABLE.items() >= admission.previous.IMMUTABLE.items()


def test_ci_dispatch_adds_only_exact_36_base_before_historical_branches():
    name = ".github/workflows/ci.yml"
    before = admission.legacy._git(ROOT, "show", f"{admission.BASE}:{name}")
    expected = before.replace(
        "Exact candidate admission (historical31/32, strict34, pending35)",
        "Exact candidate admission (historical31/32, strict34/35, pending36)",
        1,
    ).replace(
        '          if [ "$candidate_base" = "e4d19282aaa18ddc2d5d1f04b6c7de84c0823d8b" ]; then\n',
        '          if [ "$candidate_base" = "ed0fbc41d9ab2a9fcdbf0648d2ee0839abd1befd" ]; then\n'
        '            python3 scripts/candidate_scope_admission36.py --base "$candidate_base"\n'
        '          elif [ "$candidate_base" = "e4d19282aaa18ddc2d5d1f04b6c7de84c0823d8b" ]; then\n',
        1,
    )
    assert expected != before
    assert admission.safe_file(ROOT, name).decode() == expected


def test_version_trio_only_changes_exact_35_versions():
    assert admission.config_only(ROOT)
    for name, pattern, expected in (
        ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.36"'),
        ("podvoice/gatekeeper/__init__.py", r'^__version__ = "[^"\n]+"$', '__version__ = "2.0.36"'),
        ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.36"'),
    ):
        before = admission.legacy._git(ROOT, "show", f"{admission.BASE}:{name}")
        after = admission.safe_file(ROOT, name).decode()
        assert admission.strict.version_only(before, after, pattern, expected)
        assert not admission.strict.version_only(
            before, after + "unreviewed: true\n", pattern, expected
        )


def test_asset_inventory_is_byte_identical_to_35():
    static = admission.STATIC
    assets = sorted(p for p in admission.strict.runtime_inventory(ROOT) if p.startswith(static))
    assert len(assets) == 136  # manifest plus the 135 approved assets
    for name in assets:
        assert admission.sha(admission.safe_file(ROOT, name)) == admission.sha(
            subprocess.check_output(["git", "show", f"{admission.BASE}:{name}"], cwd=ROOT)
        )


def test_unreviewed_manifest_and_approval_cannot_admit():
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
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
    assert manifest["schema"] == "podview36.admission.v1"
    assert manifest["base"] == admission.BASE
    if not any((admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)):
        assert all(
            not manifest[key]
            for key in ("production", "regressions", "runtime", "config", "policy", "tooling")
        )
        assert manifest["asset_count"] == 0
        assert not admission.inspect_repository(ROOT, admission.BASE).passed
    else:
        assert all((admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST))
        assert (
            admission.sha(admission.safe_file(ROOT, admission.MANIFEST)) == admission.MANIFEST_SHA
        )
        assert (
            admission.strict.ast_sha(admission.safe_file(ROOT, admission.PROFILE), "PROFILE_AST")
            == admission.PROFILE_AST
        )
        assert set(manifest["production"]) == EXPECTED_PRODUCTION
        assert set(manifest["regressions"]) == EXPECTED_TESTS
        assert manifest["asset_count"] == 135


@pytest.mark.parametrize("missing", ["REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_partial_approval_pins_reject(monkeypatch, missing):
    for name in ("REVIEWER", "MANIFEST_SHA", "PROFILE_AST"):
        monkeypatch.setattr(admission, name, "" if name == missing else "a" * 64)
    record = {name: "fixture" for name in admission.FIELDS}
    record.update(
        version=admission.VERSION,
        kind=admission.KIND,
        base_tip=admission.BASE,
        merge_base=admission.BASE,
        domains=list(admission.DOMAINS),
        reviewer=admission.REVIEWER,
    )
    report = admission.legacy.CandidateScope(
        "head", admission.BASE, (), (), admission.DOMAINS, True, "fixture"
    )
    assert not admission.validate(ROOT, report, admission.BASE, record)
