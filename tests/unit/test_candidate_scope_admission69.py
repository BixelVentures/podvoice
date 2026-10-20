"""PV69 keeps the native rearm delta and existing release routes closed."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission69 as admission

ROOT = Path(__file__).resolve().parents[2]


def test_69_profile_is_exact_native_nonce_rearm_and_version_only():
    assert admission.BASE == "8cbca02897b8f59cbfd3392ef965b523b6d1db10"
    assert admission.VERSION == 46
    assert admission.KIND == "podvoice69_timer_rearm_nonce_boundary"
    assert admission.PROFILE == "scripts/candidate_scope_admission69.py"
    assert admission.MANIFEST == "scripts/podview69-admission-reviewed.json"
    assert admission.DOMAINS == ("rearm",)
    assert admission.PRODUCTION == {"podvoice/gatekeeper/voicepe.py"}
    assert admission.REQUIRED_TESTS == {
        "tests/integration/test_ha_timer_native_output.py",
        "tests/unit/test_candidate_scope_admission69.py",
    }
    assert admission.config_only(ROOT)


def test_69_preserves_ui_inventory_and_all_frozen_68_pins():
    assert admission.ASSET_COUNT == admission.previous.ASSET_COUNT == 143
    assert admission.MAX_ASSET_TOTAL_BYTES == admission.previous.MAX_ASSET_TOTAL_BYTES
    assert admission.ASSET_CHANGES == frozenset()
    assert admission.HA_RUNTIME == admission.previous.HA_RUNTIME
    assert admission.IMMUTABLE.items() >= admission.previous.IMMUTABLE.items()
    for path in (
        "scripts/candidate_scope_admission68.py",
        "scripts/podview68-admission-reviewed.json",
    ):
        assert admission.sha(admission.safe_file(ROOT, path)) == admission.IMMUTABLE[path]
    production = admission.PRODUCTION | admission.CONFIG
    assert admission.production_scope_matches(production)
    assert not admission.production_scope_matches(production | {"podvoice/gatekeeper/thin.py"})


def test_69_missing_approval_stops_before_repository_evaluation(monkeypatch):
    monkeypatch.setattr(admission, "REVIEWER", "")
    monkeypatch.setattr(
        admission,
        "inspect_repository",
        lambda *_args: (_ for _ in ()).throw(AssertionError("unapproved scope evaluated")),
    )
    assert admission.main(["--base", admission.BASE]) == 2


def test_69_complete_bindings_are_all_or_nothing_and_match_actual_source():
    pins = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert all(pins) or not any(pins)
    if not any(pins):
        return
    assert admission.REVIEWER == "/root/alarm_led_contract"
    raw = admission.safe_file(ROOT, admission.MANIFEST)
    assert admission.sha(raw) == admission.MANIFEST_SHA
    assert (
        admission.strict.ast_sha(admission.safe_file(ROOT, admission.PROFILE), "PROFILE_AST")
        == admission.PROFILE_AST
    )
    manifest = json.loads(raw)
    assert manifest["schema"] == "podvoice69.admission.v1"
    assert manifest["base"] == admission.BASE
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert manifest["asset_count"] == admission.ASSET_COUNT


def test_69_both_existing_dispatchers_add_only_the_new_base_route():
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    local = (ROOT / "scripts/dev_cycle.py").read_text()
    assert (
        f'if [ "$candidate_base" = "{admission.BASE}" ]; then\n'
        '            python3 scripts/candidate_scope_admission69.py --base "$candidate_base"'
    ) in workflow
    assert (f'"{admission.BASE}": "scripts/candidate_scope_admission69.py",') in local
    assert 'python3 scripts/candidate_scope_admission68.py --base "$candidate_base"' in workflow
    assert '"scripts/candidate_scope_admission32.py"' in local
    assert 'python3 scripts/candidate_scope_admission32.py --base "$candidate_base"' in workflow


# Published69 assertions run against the published69 tree, not a later UI release.
@pytest.fixture(scope="module", autouse=True)
def historical69_source_root(tmp_path_factory):
    global ROOT
    original_root = ROOT
    target = tmp_path_factory.mktemp("published69-source") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(
        ["git", "checkout", "--quiet", "d21c267817ce6744dfd59efeafb13a186f5fb78d"],
        cwd=target,
        check=True,
    )
    ROOT = target
    try:
        yield target
    finally:
        ROOT = original_root
