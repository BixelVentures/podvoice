"""PV67 profile identity and source inventory are mechanically explicit."""

import json
from pathlib import Path

from scripts import candidate_scope_admission67 as admission


def test_67_profile_is_bound_to_published66_and_expected_version():
    assert admission.BASE == "f12537026e6ceb199932c5aa05d977e43a47920e"
    assert admission.VERSION == 44
    assert admission.PROFILE == "scripts/candidate_scope_admission67.py"
    assert admission.MANIFEST == "scripts/podview67-admission-reviewed.json"
    assert admission.REVIEWER == "/root/led_review_current"
    root = Path(__file__).resolve().parents[2]
    assert admission.MANIFEST_SHA == admission.sha(admission.safe_file(root, admission.MANIFEST))
    assert admission.PROFILE_AST == admission.strict.ast_sha(
        admission.safe_file(root, admission.PROFILE), "PROFILE_AST"
    )
    manifest = json.loads(admission.safe_file(root, admission.MANIFEST))
    assert manifest["schema"] == "podvoice67.admission.v1"
    assert manifest["base"] == admission.BASE
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert manifest["asset_count"] == admission.ASSET_COUNT == 143


def test_67_inventory_is_exact_for_composed_backend_timer_ui_and_regressions():
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/live_prompt.py",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/podview_music_control.py",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/frame-layout.css",
        "podvoice/gatekeeper/static/podview/music-results.js",
        "podvoice/gatekeeper/static/podview/player-view.js",
        "podvoice/gatekeeper/static/podview/podvoice-transport.js",
        "podvoice/gatekeeper/static/podview/robot-control-panel.js",
        "podvoice/gatekeeper/static/podview/timer-view.js",
        "podvoice/gatekeeper/static/podview/ui/components.css",
        "podvoice/gatekeeper/static/podview/ui/motion.js",
        "podvoice/gatekeeper/static/podview/widget-redesign.css",
        "podvoice/gatekeeper/static/podview/widget-view.js",
        "podvoice/gatekeeper/thin.py",
        "podvoice/gatekeeper/voicepe.py",
    }
    assert len(admission.REQUIRED_TESTS) == 26
    assert admission.REQUIRED_TESTS == {
        "tests/integration/test_ha_timer_native_output.py",
        "tests/integration/test_podview_bridge.py",
        "tests/integration/test_podview_music_control.py",
        "tests/integration/test_podview_music_selection.py",
        "tests/integration/test_thin_live_ten_cycles.py",
        "tests/integration/test_thin_live_idle_preclose.py",
        "tests/podview/canonical-packet-account-visibility.test.mjs",
        "tests/podview/canonical-packet-first-read-reconciliation.test.mjs",
        "tests/podview/canonical-packet-ha-ingress-transport.test.mjs",
        "tests/podview/canonical-packet-motion.test.mjs",
        "tests/podview/canonical-packet-music-card-appearance.test.mjs",
        "tests/podview/canonical-packet-player-view.test.mjs",
        "tests/podview/canonical-packet-robot-control-panel.test.mjs",
        "tests/podview/canonical-packet-shared-music-results.test.mjs",
        "tests/podview/canonical-packet-timer-access.test.mjs",
        "tests/podview/canonical-packet-visual-history.test.mjs",
        "tests/podview/account-visibility.test.mjs",
        "tests/podview/canonical-next-music-card-appearance.test.mjs",
        "tests/podview/canonical-next-visual-history.test.mjs",
        "tests/podview/root-first-read-reconciliation.test.mjs",
        "tests/podview/root-timer-access.test.mjs",
        "tests/unit/test_candidate_scope_admission67.py",
        "tests/unit/test_ci_promotion.py",
        "tests/unit/test_ci_scope.py",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_live_prompt.py",
    }
    assert "docs/MOTION.md" in admission.TOOLING
    assert {"AGENTS.md", "CLAUDE.md", "docs/AGENTKONTRAKT.md"} <= admission.TOOLING
    assert admission.ASSET_CHANGES == {
        "frame-layout.css",
        "music-results.js",
        "player-view.js",
        "podvoice-transport.js",
        "robot-control-panel.js",
        "timer-view.js",
        "ui/components.css",
        "ui/motion.js",
        "widget-redesign.css",
        "widget-view.js",
    }
