"""PV70 admits only the reviewed idle-close/input delta and preserves existing routes."""

import json
from pathlib import Path

from scripts import candidate_scope_admission70 as admission

ROOT = Path(__file__).resolve().parents[2]


def test_70_profile_is_exact_idle_input_boundary_and_version_only():
    assert admission.BASE == "d21c267817ce6744dfd59efeafb13a186f5fb78d"
    assert admission.VERSION == 47
    assert admission.KIND == "podvoice70_idle_preclose_input_boundary"
    assert admission.PROFILE == "scripts/candidate_scope_admission70.py"
    assert admission.MANIFEST == "scripts/podview70-admission-reviewed.json"
    assert admission.DOMAINS == ("realtime_semantics",)
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/thin.py",
        "podvoice/gatekeeper/live_prompt.py",
    }
    assert admission.REQUIRED_TESTS == {
        "tests/integration/test_thin_live_resumed_input_preclose.py",
        "tests/integration/test_thin_timer_end_to_end.py",
        "tests/unit/test_live_prompt.py",
        "tests/unit/test_candidate_scope_admission69.py",
        "tests/unit/test_candidate_scope_admission70.py",
    }
    assert admission.config_only(ROOT)


def test_70_preserves_ui_inventory_and_all_frozen_69_pins():
    assert admission.ASSET_COUNT == admission.previous.ASSET_COUNT == 143
    assert admission.MAX_ASSET_TOTAL_BYTES == admission.previous.MAX_ASSET_TOTAL_BYTES
    assert admission.ASSET_CHANGES == frozenset()
    assert admission.HA_RUNTIME == admission.previous.HA_RUNTIME
    assert admission.IMMUTABLE.items() >= admission.previous.IMMUTABLE.items()
    for path in (
        "scripts/candidate_scope_admission69.py",
        "scripts/podview69-admission-reviewed.json",
    ):
        assert admission.sha(admission.safe_file(ROOT, path)) == admission.IMMUTABLE[path]
    production = admission.PRODUCTION | admission.CONFIG
    assert admission.production_scope_matches(production)
    assert not admission.production_scope_matches(production | {"podvoice/gatekeeper/voicepe.py"})


def test_70_missing_approval_stops_before_repository_evaluation(monkeypatch):
    monkeypatch.setattr(admission, "REVIEWER", "")
    monkeypatch.setattr(
        admission,
        "inspect_repository",
        lambda *_args: (_ for _ in ()).throw(AssertionError("unapproved scope evaluated")),
    )
    assert admission.main(["--base", admission.BASE]) == 2


def test_70_complete_bindings_are_all_or_nothing_and_match_actual_source():
    pins = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert all(pins) or not any(pins)
    if not any(pins):
        return
    assert admission.REVIEWER.strip()
    raw = admission.safe_file(ROOT, admission.MANIFEST)
    assert admission.sha(raw) == admission.MANIFEST_SHA
    assert (
        admission.strict.ast_sha(admission.safe_file(ROOT, admission.PROFILE), "PROFILE_AST")
        == admission.PROFILE_AST
    )
    manifest = json.loads(raw)
    assert manifest["schema"] == "podvoice70.admission.v1"
    assert manifest["base"] == admission.BASE
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert manifest["asset_count"] == admission.ASSET_COUNT


def test_70_both_existing_dispatchers_add_only_the_new_base_route():
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    local = (ROOT / "scripts/dev_cycle.py").read_text()
    assert (
        f'if [ "$candidate_base" = "{admission.BASE}" ]; then\n'
        '            python3 scripts/candidate_scope_admission70.py --base "$candidate_base"'
    ) in workflow
    assert (f'"{admission.BASE}": "scripts/candidate_scope_admission70.py",') in local
    assert 'python3 scripts/candidate_scope_admission69.py --base "$candidate_base"' in workflow
    assert '"scripts/candidate_scope_admission32.py"' in local
    assert 'python3 scripts/candidate_scope_admission32.py --base "$candidate_base"' in workflow
