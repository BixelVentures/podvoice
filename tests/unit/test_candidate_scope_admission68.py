"""PV68 profile identity and source inventory are mechanically explicit."""

import json
from pathlib import Path

from scripts import candidate_scope_admission68 as admission


def test_68_profile_is_bound_to_published67_and_expected_version():
    assert admission.BASE == "f99be699315de44375bea46f1c667712dca21229"
    assert admission.VERSION == 45
    assert admission.PROFILE == "scripts/candidate_scope_admission68.py"
    assert admission.MANIFEST == "scripts/podview68-admission-reviewed.json"
    assert admission.REVIEWER == "/root/playlist_cover_projection"
    root = Path(__file__).resolve().parents[2]
    assert admission.MANIFEST_SHA == admission.sha(admission.safe_file(root, admission.MANIFEST))
    assert admission.PROFILE_AST == admission.strict.ast_sha(
        admission.safe_file(root, admission.PROFILE), "PROFILE_AST"
    )
    manifest = json.loads(admission.safe_file(root, admission.MANIFEST))
    assert manifest["schema"] == "podvoice68.admission.v1"
    assert manifest["base"] == admission.BASE
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert manifest["asset_count"] == admission.ASSET_COUNT == 143


def test_68_scope_keeps_all_ui_and_other_runtime_unchanged():
    assert admission.PRODUCTION == {"podvoice/gatekeeper/live_prompt.py"}
    assert admission.REQUIRED_TESTS == {
        "tests/unit/test_live_prompt.py",
        "tests/unit/test_candidate_scope_admission68.py",
    }
    assert admission.ASSET_CHANGES == frozenset()
    assert admission.DOMAINS == ("unclassified_runtime",)
