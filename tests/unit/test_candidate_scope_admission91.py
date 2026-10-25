"""The PodView91 successor remains closed until an independent exact-tree review."""

import json
from pathlib import Path

from scripts import candidate_scope_admission91 as admission

ROOT = Path(__file__).resolve().parents[2]


def test_91_uses_exact_published_90_base_and_historical_pins():
    assert admission.BASE == "65fe801a8bb587ba42518ce4dbb04ee39b59fd76"
    assert admission.legacy._git(ROOT, "rev-parse", f"{admission.BASE}^{{tree}}").strip() == (
        "58f550af185e8ab2f325bdba4db680e297a69da1"
    )
    assert admission.VERSION == 68
    assert admission.strict.pins_match(ROOT, admission.IMMUTABLE)
    assert admission.previous.PROFILE not in admission.PRODUCTION
    assert {admission.previous.PROFILE, admission.previous.MANIFEST} <= admission.POLICY


def test_91_dispatch_preserves_90_and_earlier_routes():
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    local = (ROOT / "scripts/dev_cycle.py").read_text()
    assert (
        f'if [ "$candidate_base" = "{admission.BASE}" ]; then\n'
        '            python3 scripts/candidate_scope_admission91.py --base "$candidate_base"'
        in workflow
    )
    assert f'"{admission.BASE}": "scripts/candidate_scope_admission91.py"' in local
    assert (
        f'elif [ "$candidate_base" = "{admission.previous.BASE}" ]; then\n'
        '            python3 scripts/candidate_scope_admission90.py --base "$candidate_base"'
        in workflow
    )
    assert f'"{admission.previous.BASE}": "scripts/candidate_scope_admission90.py"' in local
    assert 'python3 scripts/candidate_scope_admission89.py --base "$candidate_base"' in workflow


def test_91_exact_scope_requires_complete_review_bindings():
    bindings = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert all(bindings) or not any(bindings)
    manifest = json.loads((ROOT / admission.MANIFEST).read_text())
    assert manifest["schema"] == "podview91.admission.v1"
    assert manifest["base"] == admission.BASE
    sections = {
        "production": admission.PRODUCTION,
        "regressions": admission.REQUIRED_TESTS,
        "runtime": admission.strict.runtime_inventory(ROOT) | admission.HA_RUNTIME,
        "config": admission.CONFIG,
        "policy": admission.POLICY - {admission.PROFILE, admission.MANIFEST},
        "tooling": admission.TOOLING,
    }
    assert {name: set(manifest[name]) for name in sections} == sections
    assert all(admission.strict.pins_match(ROOT, manifest[name]) for name in sections)
    assert manifest["asset_count"] == 203
    effective = admission.legacy._visual_repository_changes(ROOT, admission.BASE)
    assert admission.production_scope_matches(effective)
    assert {path for path in effective if path.startswith("tests/")} == admission.REQUIRED_TESTS
    assert admission.change_scope_matches(effective, set(admission.REQUIRED_TESTS))
    if not any(bindings):
        assert admission.main(["--base", admission.BASE]) == 2
        assert not admission.inspect_repository(ROOT, admission.BASE).passed
    else:
        assert (
            admission.sha(admission.safe_file(ROOT, admission.MANIFEST)) == admission.MANIFEST_SHA
        )
        assert (
            admission.strict.ast_sha(admission.safe_file(ROOT, admission.PROFILE), "PROFILE_AST")
            == admission.PROFILE_AST
        )
        record = admission.record_at(ROOT)
        assert record is not None
        assert record["reviewer"] == admission.REVIEWER
        assert record["manifest_fingerprint"] == admission.MANIFEST_SHA
        assert admission.inspect_repository(ROOT, admission.BASE).passed
        assert admission.main(["--base", admission.BASE]) == 0


def test_91_unknown_paths_and_partial_bindings_fail_closed(monkeypatch):
    assert not admission.change_scope_matches({"podvoice/gatekeeper/unreviewed_91.py"}, set())
    for missing in ("REVIEWER", "MANIFEST_SHA", "PROFILE_AST"):
        for name in ("REVIEWER", "MANIFEST_SHA", "PROFILE_AST"):
            monkeypatch.setattr(admission, name, "" if name == missing else "fixture-binding")
        assert admission.main(["--base", admission.BASE]) == 2
