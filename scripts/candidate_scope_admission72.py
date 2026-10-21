#!/usr/bin/env python3
"""Exact72 admission stays closed until final canonical assets and independent review bind it."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission71 as previous
except ModuleNotFoundError:
    import candidate_scope_admission71 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "85a296a7394b621e76533cc4365e435fd9017743"
KIND = "podview72_semantic_presentation_and_optional_ai"
VERSION = 49
ASSET_COUNT = 200
MAX_ASSET_TOTAL_BYTES = 34 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission72.py"
MANIFEST = "scripts/podview72-admission-reviewed.json"
RECORD_MARKER = "<!-- podview72-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG
POLICY = previous.POLICY | frozenset({PROFILE, MANIFEST})
TOOLING = previous.TOOLING | frozenset(
    {"AGENTS.md", "CLAUDE.md", "docs/AGENTKONTRAKT.md", "docs/MOTION.md"}
)
TOOLING = TOOLING | frozenset(
    {
        "scripts/build-assets.mjs",
        "scripts/build-scripts.mjs",
        "package.json",
        "package-lock.json",
        ".gitignore",
        "scripts/live_confirmation_eval.py",
        "scripts/live_semantic_completion_eval.py",
    }
)
TOOLING = TOOLING | frozenset(
    {
        "scripts/dev.mjs",
        "scripts/check-ui-palette.mjs",
        "scripts/check-ui-tokens.mjs",
        "docs/RADIO-LOGO-SOURCES.json",
        "docs/USER-DESIGN-ANSWERS-2026-10-20.json",
    }
)
TOOLING = TOOLING | frozenset(
    [
        "docs/COMPONENT-LIBRARY.md",
        "docs/RADIO-LOGO-SOURCES.json",
        "docs/USER-DESIGN-ANSWERS-2026-10-20.json",
        "docs/component-library-registry.json",
        "scripts/build-assets.mjs",
        "scripts/check-ui-palette.mjs",
        "scripts/check-ui-tokens.mjs",
        "scripts/dev.mjs",
        "scripts/live-fixture.mjs",
    ]
)
TOOLING = TOOLING | frozenset(
    [
        "docs/COMPONENT-LIBRARY.md",
        "docs/RADIO-LOGO-SOURCES.json",
        "docs/USER-DESIGN-ANSWERS-2026-10-20.json",
        "docs/component-library-registry.json",
        "scripts/build-assets.mjs",
        "scripts/check-ui-palette.mjs",
        "scripts/check-ui-tokens.mjs",
        "scripts/dev.mjs",
        "scripts/live-fixture.mjs",
    ]
)
TOOLING = TOOLING | frozenset(
    [
        "docs/COMPONENT-LIBRARY.md",
        "docs/RADIO-LOGO-SOURCES.json",
        "docs/USER-DESIGN-ANSWERS-2026-10-20.json",
        "docs/component-library-registry.json",
        "scripts/build-assets.mjs",
        "scripts/check-ui-palette.mjs",
        "scripts/check-ui-tokens.mjs",
        "scripts/dev.mjs",
        "scripts/live-fixture.mjs",
    ]
)
TOOLING = TOOLING | frozenset(
    [
        "docs/COMPONENT-LIBRARY.md",
        "docs/RADIO-LOGO-SOURCES.json",
        "docs/USER-DESIGN-ANSWERS-2026-10-20.json",
        "docs/component-library-registry.json",
        "scripts/build-assets.mjs",
        "scripts/check-ui-palette.mjs",
        "scripts/check-ui-tokens.mjs",
        "scripts/dev.mjs",
        "scripts/live-fixture.mjs",
    ]
)
FIELDS = previous.FIELDS

DOMAINS = ("ha_tools", "physical_output")  # Final classifier must match exact candidate.
PRODUCTION = frozenset(
    [
        "podvoice/gatekeeper/__main__.py",
        "podvoice/gatekeeper/config.py",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/podview_enrichment.py",
        "podvoice/gatekeeper/podview_presentation.py",
        "podvoice/gatekeeper/podview_receipts.py",
        "podvoice/gatekeeper/podview_theme_art.py",
        "podvoice/gatekeeper/podview_visual_grant.py",
        "podvoice/gatekeeper/static/podview/answer-widget.js",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/assets/icons/grip-vertical.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/pause-fill.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/play-fill.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/room-door.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/room-kitchen.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/room-sofa.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/skip-end-fill.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/skip-start-fill.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/volume-mute.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/volume-up-fill.svg",
        "podvoice/gatekeeper/static/podview/flow-controller.js",
        "podvoice/gatekeeper/static/podview/frame-layout.css",
        "podvoice/gatekeeper/static/podview/index.html",
        "podvoice/gatekeeper/static/podview/library-catalog.js",
        "podvoice/gatekeeper/static/podview/library.bundle.js",
        "podvoice/gatekeeper/static/podview/library.css",
        "podvoice/gatekeeper/static/podview/library.html",
        "podvoice/gatekeeper/static/podview/library.js",
        "podvoice/gatekeeper/static/podview/live-answer-view.js",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
        "podvoice/gatekeeper/static/podview/live-home-view.js",
        "podvoice/gatekeeper/static/podview/live-media-view.js",
        "podvoice/gatekeeper/static/podview/live-music-selection-view.js",
        "podvoice/gatekeeper/static/podview/live-music-view.js",
        "podvoice/gatekeeper/static/podview/live-music.css",
        "podvoice/gatekeeper/static/podview/local-robot-view.js",
        "podvoice/gatekeeper/static/podview/music-fixture.js",
        "podvoice/gatekeeper/static/podview/music-results.js",
        "podvoice/gatekeeper/static/podview/music-selection-model.js",
        "podvoice/gatekeeper/static/podview/player-view.js",
        "podvoice/gatekeeper/static/podview/podview.bundle.js",
        "podvoice/gatekeeper/static/podview/podview.css",
        "podvoice/gatekeeper/static/podview/podvoice-view.js",
        "podvoice/gatekeeper/static/podview/preview-scenes.js",
        "podvoice/gatekeeper/static/podview/radio-model.js",
        "podvoice/gatekeeper/static/podview/radio-view.js",
        "podvoice/gatekeeper/static/podview/robot-control-panel.js",
        "podvoice/gatekeeper/static/podview/scene-model.js",
        "podvoice/gatekeeper/static/podview/speaker-output-view.js",
        "podvoice/gatekeeper/static/podview/spotify-artwork.js",
        "podvoice/gatekeeper/static/podview/timer-model.js",
        "podvoice/gatekeeper/static/podview/timer-notice.css",
        "podvoice/gatekeeper/static/podview/timer-notice.js",
        "podvoice/gatekeeper/static/podview/timer-view.js",
        "podvoice/gatekeeper/static/podview/ui-kit.css",
        "podvoice/gatekeeper/static/podview/ui/answer-auto-return.js",
        "podvoice/gatekeeper/static/podview/ui/components.css",
        "podvoice/gatekeeper/static/podview/ui/conclusion-disclosure.js",
        "podvoice/gatekeeper/static/podview/ui/kit.js",
        "podvoice/gatekeeper/static/podview/ui/library/components.js",
        "podvoice/gatekeeper/static/podview/ui/library/library.css",
        "podvoice/gatekeeper/static/podview/ui/library/visual-components.js",
        "podvoice/gatekeeper/static/podview/ui/motion.js",
        "podvoice/gatekeeper/static/podview/ui/notification-queue.js",
        "podvoice/gatekeeper/static/podview/ui/page-lifecycle.js",
        "podvoice/gatekeeper/static/podview/ui/pressed-state.js",
        "podvoice/gatekeeper/static/podview/ui/resource-tile.js",
        "podvoice/gatekeeper/static/podview/ui/robot-motion.js",
        "podvoice/gatekeeper/static/podview/ui/screen-lifecycle.js",
        "podvoice/gatekeeper/static/podview/ui/scroll-edges.js",
        "podvoice/gatekeeper/static/podview/ui/touch-intent.js",
        "podvoice/gatekeeper/static/podview/vehicle-model.js",
        "podvoice/gatekeeper/static/podview/vehicle-view.js",
        "podvoice/gatekeeper/static/podview/voice-surface.js",
        "podvoice/gatekeeper/static/podview/weather-observation.js",
        "podvoice/gatekeeper/static/podview/weather-view.js",
        "podvoice/gatekeeper/static/podview/widget-model.js",
        "podvoice/gatekeeper/static/podview/widget-redesign.css",
        "podvoice/gatekeeper/static/podview/widget-view.css",
        "podvoice/gatekeeper/static/podview/widget-view.js",
        "podvoice/gatekeeper/tools.py",
    ]
)
REQUIRED_TESTS = frozenset(
    [
        "tests/integration/test_podview_theme_art_route.py",
        "tests/integration/test_presentation_live_pipeline.py",
        "tests/podview/canonical-next-configured-city.test.mjs",
        "tests/podview/canonical-next-live-answer-view.test.mjs",
        "tests/podview/canonical-next-live-media-view-source.test.mjs",
        "tests/podview/canonical-next-live-media-view.test.mjs",
        "tests/podview/canonical-next-music-card-appearance.test.mjs",
        "tests/podview/canonical-next-music-expiry-recovery.test.mjs",
        "tests/podview/canonical-next-music-flow.test.mjs",
        "tests/podview/canonical-next-music-selection-source.test.mjs",
        "tests/podview/canonical-next-music-selection.test.mjs",
        "tests/podview/canonical-next-native-music-controls.test.mjs",
        "tests/podview/canonical-next-native-presentation-components.test.mjs",
        "tests/podview/canonical-next-player-view-source.test.mjs",
        "tests/podview/canonical-next-player-view.test.mjs",
        "tests/podview/canonical-next-presentation-answers.test.mjs",
        "tests/podview/canonical-next-radio-model.test.mjs",
        "tests/podview/canonical-next-radio-view.test.mjs",
        "tests/podview/canonical-next-robot-control-panel.test.mjs",
        "tests/podview/canonical-next-robot-history-view.test.mjs",
        "tests/podview/canonical-next-timer-model.test.mjs",
        "tests/podview/canonical-next-timer-overview.test.mjs",
        "tests/podview/canonical-next-vehicle-view.test.mjs",
        "tests/podview/canonical-next-visual-history.test.mjs",
        "tests/podview/canonical-next-voice-surface.test.mjs",
        "tests/podview/canonical-next-weather-ai-advice.test.mjs",
        "tests/podview/canonical-next-weather-observation.test.mjs",
        "tests/podview/canonical-next-weather-view.test.mjs",
        "tests/podview/canonical-next-widget-loading.test.mjs",
        "tests/podview/canonical-packet-first-read-reconciliation.test.mjs",
        "tests/podview/canonical-packet-motion.test.mjs",
        "tests/podview/canonical-packet-music-card-appearance.test.mjs",
        "tests/podview/canonical-packet-player-view.test.mjs",
        "tests/podview/canonical-packet-robot-control-panel.test.mjs",
        "tests/podview/canonical-packet-shared-music-results.test.mjs",
        "tests/podview/canonical-packet-timer-access.test.mjs",
        "tests/podview/canonical-packet-visual-history.test.mjs",
        "tests/podview/helpers/dom-attributes.mjs",
        "tests/podview/music-selection.test.mjs",
        "tests/podview/podvoice-view.test.mjs",
        "tests/podview/robot-domain-authority.test.mjs",
        "tests/podview/room-fixture.mjs",
        "tests/podview/root-account-visibility.test.mjs",
        "tests/podview/root-activity-gesture.test.mjs",
        "tests/podview/root-album-cover.test.mjs",
        "tests/podview/root-answer-auto-return.test.mjs",
        "tests/podview/root-answer-expiry-focus.test.mjs",
        "tests/podview/root-answer-explanation.test.mjs",
        "tests/podview/root-answer-timer-composition.test.mjs",
        "tests/podview/root-build-assets.test.mjs",
        "tests/podview/root-collection-selection.test.mjs",
        "tests/podview/root-component-library.test.mjs",
        "tests/podview/root-conclusion-disclosure.test.mjs",
        "tests/podview/root-configured-city.test.mjs",
        "tests/podview/root-connection-presentation.test.mjs",
        "tests/podview/root-controller-bootstrap-recovery.test.mjs",
        "tests/podview/root-controller-continuity.test.mjs",
        "tests/podview/root-controller-peer-recovery.test.mjs",
        "tests/podview/root-controller-retained-cards.test.mjs",
        "tests/podview/root-conversation-flow.test.mjs",
        "tests/podview/root-danish-time-presentation.test.mjs",
        "tests/podview/root-deferred-local-details.test.mjs",
        "tests/podview/root-dev-qa-guard.test.mjs",
        "tests/podview/root-feedback-duration.test.mjs",
        "tests/podview/root-first-read-reconciliation.test.mjs",
        "tests/podview/root-four-music-tabs.test.mjs",
        "tests/podview/root-gesture-blur.test.mjs",
        "tests/podview/root-gestures.test.mjs",
        "tests/podview/root-ha-home-observation.test.mjs",
        "tests/podview/root-ha-ingress-transport.test.mjs",
        "tests/podview/root-history-hydration.test.mjs",
        "tests/podview/root-history-renderer.test.mjs",
        "tests/podview/root-history-retention.test.mjs",
        "tests/podview/root-kit.test.mjs",
        "tests/podview/root-lazy-detail-view.test.mjs",
        "tests/podview/root-library-catalog.test.mjs",
        "tests/podview/root-light-controls.test.mjs",
        "tests/podview/root-light-journey.test.mjs",
        "tests/podview/root-live-answer-view.test.mjs",
        "tests/podview/root-live-control-view.test.mjs",
        "tests/podview/root-live-media-view.test.mjs",
        "tests/podview/root-live-queue-occurrence.test.mjs",
        "tests/podview/root-loading-account-terminal.test.mjs",
        "tests/podview/root-local-music-receipt.test.mjs",
        "tests/podview/root-local-robot-view.test.mjs",
        "tests/podview/root-media-account-picker.test.mjs",
        "tests/podview/root-media-observation.test.mjs",
        "tests/podview/root-mood-playlists.test.mjs",
        "tests/podview/root-mood-preview.test.mjs",
        "tests/podview/root-motion.test.mjs",
        "tests/podview/root-music-card-appearance.test.mjs",
        "tests/podview/root-music-deferred-renewal.test.mjs",
        "tests/podview/root-music-expiry-recovery.test.mjs",
        "tests/podview/root-music-flow.test.mjs",
        "tests/podview/root-music-refresh-feedback.test.mjs",
        "tests/podview/root-music-renewal-provider-downstream.test.mjs",
        "tests/podview/root-music-renewal-provider.test.mjs",
        "tests/podview/root-music-renewal-stale-source.test.mjs",
        "tests/podview/root-music-selection.test.mjs",
        "tests/podview/root-native-music-controls.test.mjs",
        "tests/podview/root-native-presentation-components.test.mjs",
        "tests/podview/root-navigation-labels.test.mjs",
        "tests/podview/root-notification-queue.test.mjs",
        "tests/podview/root-offline-browsing.test.mjs",
        "tests/podview/root-overview-activity-model.test.mjs",
        "tests/podview/root-overview-facts.test.mjs",
        "tests/podview/root-overview-inactive-grid.test.mjs",
        "tests/podview/root-overview-media-cards.test.mjs",
        "tests/podview/root-overview-media-values.test.mjs",
        "tests/podview/root-overview-priorities.test.mjs",
        "tests/podview/root-page-lifecycle.test.mjs",
        "tests/podview/root-player-detail-navigation.test.mjs",
        "tests/podview/root-player-dom-delta.test.mjs",
        "tests/podview/root-player-view.test.mjs",
        "tests/podview/root-podvoice-view.test.mjs",
        "tests/podview/root-presentation-answers.test.mjs",
        "tests/podview/root-pressed-state.test.mjs",
        "tests/podview/root-preview-scenes.test.mjs",
        "tests/podview/root-queue-order.test.mjs",
        "tests/podview/root-radio-model.test.mjs",
        "tests/podview/root-radio-view.test.mjs",
        "tests/podview/root-retained-widget-delta.test.mjs",
        "tests/podview/root-robot-control-panel.test.mjs",
        "tests/podview/root-robot-control-renewal.test.mjs",
        "tests/podview/root-robot-domain-authority.test.mjs",
        "tests/podview/root-robot-history-view.test.mjs",
        "tests/podview/root-robot-motion.test.mjs",
        "tests/podview/root-robot-overview-action.test.mjs",
        "tests/podview/root-robot-overview-tile.test.mjs",
        "tests/podview/root-robot-renewal.test.mjs",
        "tests/podview/root-robot-resource-detail.test.mjs",
        "tests/podview/root-robot-setting-labels.test.mjs",
        "tests/podview/root-room-media-binding.test.mjs",
        "tests/podview/root-scene-model.test.mjs",
        "tests/podview/root-screen-lifecycle.test.mjs",
        "tests/podview/root-script-delivery.test.mjs",
        "tests/podview/root-scroll-edges.test.mjs",
        "tests/podview/root-shared-music-results.test.mjs",
        "tests/podview/root-speaker-output-idle.test.mjs",
        "tests/podview/root-speaker-output-view.test.mjs",
        "tests/podview/root-spotify-artwork.test.mjs",
        "tests/podview/root-timer-access.test.mjs",
        "tests/podview/root-timer-dom-delta.test.mjs",
        "tests/podview/root-timer-model.test.mjs",
        "tests/podview/root-timer-notice.test.mjs",
        "tests/podview/root-timer-overview.test.mjs",
        "tests/podview/root-topbar.test.mjs",
        "tests/podview/root-touch-intent.test.mjs",
        "tests/podview/root-transport-recovery.test.mjs",
        "tests/podview/root-typography-contract.test.mjs",
        "tests/podview/root-ui-palette-check.test.mjs",
        "tests/podview/root-ui-token-check.test.mjs",
        "tests/podview/root-vehicle-view.test.mjs",
        "tests/podview/root-visual-history.test.mjs",
        "tests/podview/root-visual-pending.test.mjs",
        "tests/podview/root-voice-surface.test.mjs",
        "tests/podview/root-weather-ai-advice.test.mjs",
        "tests/podview/root-weather-fact-display.test.mjs",
        "tests/podview/root-weather-hour-order.test.mjs",
        "tests/podview/root-weather-observation.test.mjs",
        "tests/podview/root-weather-presentation-display.test.mjs",
        "tests/podview/root-weather-view.test.mjs",
        "tests/podview/root-weather-wind.test.mjs",
        "tests/podview/root-widget-loading.test.mjs",
        "tests/podview/root-widget-model.test.mjs",
        "tests/podview/weather-fact-display.test.mjs",
        "tests/podview/weather-hour-order.test.mjs",
        "tests/unit/test_candidate_scope_admission71.py",
        "tests/unit/test_candidate_scope_admission72.py",
        "tests/unit/test_podview_presentation.py",
        "tests/unit/test_podview_theme_art.py",
        "tests/unit/test_podview_visual_grant.py",
        "tests/unit/test_podview_visual_value.py",
    ]
)
HA_RUNTIME = previous.HA_RUNTIME
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission71.py": "00153eb678b300808985fa343d014038ddc32614b22beeb188aa0d1ded269667",
    "scripts/podvoice71-admission-reviewed.json": "5fda116fabbedc6d505fc33622c2a63cb52d4337cf2aaaf0d75edadb9eb5cab6",
}
REVIEWER = "/root/ai_review61"
MANIFEST_SHA = "4036107f7e1ec032f86958626cf492014fac273514e0136c322d5ce5d192595f"
PROFILE_AST = "09b589805810baa587b619151db10178f8cf3699b48772e182f54813111a007a"


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodView72 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodView72 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodView72 record must be an object")
    return record


def _strip_cover_policy_option(source: str) -> str:
    """Admit only the two exact default-off option/schema pairs, never values/grants."""
    for key in ("podview_theme_art_policy", "podview_visual_grant"):
        option = f'  {key}: ""\n'
        schema = f'  {key}: "str?"\n'
        if source.count(option) != 1 or source.count(schema) != 1:
            return source
    for key in ("podview_theme_art_policy", "podview_visual_grant"):
        source = source.replace(f'  {key}: ""\n', "", 1)
        source = source.replace(f'  {key}: "str?"\n', "", 1)
    return source


def config_only(root: Path) -> bool:
    """Only add-on versions and exact default-off AI option/schema pairs; HA stays0.1.5."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            _strip_cover_policy_option(safe_file(root, name).decode())
            if name == "podvoice/config.yaml"
            else safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.72"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.72"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.72"'),
            (
                "custom_components/podvoice/manifest.json",
                r'^  "version": "[^"\n]+",$',
                '  "version": "0.1.5",',
            ),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match72(root: Path, runtime: dict, count: object) -> bool:
    """Exact canonical200 asset inventory; path/hash/byte ceiling are fail closed."""
    if type(count) is not int or count != ASSET_COUNT:
        return False
    raw = safe_file(root, STATIC + "asset-manifest.json")
    inventory = json.loads(raw, object_pairs_hook=legacy._unique_record)
    if set(inventory) != {"schema", "files"} or inventory["schema"] != "podview.assets.v1":
        return False
    rows = inventory["files"]
    if not isinstance(rows, list) or len(rows) != ASSET_COUNT:
        return False
    names = set()
    total = 0
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"path", "sha256"}:
            return False
        name = row["path"]
        if (
            not isinstance(name, str)
            or not name
            or name.startswith("/")
            or "\\" in name
            or any(part in {"", ".", ".."} for part in name.split("/"))
        ):
            return False
        full = STATIC + name
        if full in names or name == "asset-manifest.json":
            return False
        names.add(full)
        data = safe_file(root, full)
        total += len(data)
        if sha(data) != row["sha256"] or runtime.get(full) != row["sha256"]:
            return False
    assets = {name for name in runtime if name.startswith(STATIC)}
    return assets == names | {STATIC + "asset-manifest.json"} and total <= MAX_ASSET_TOTAL_BYTES


def production_scope_matches(effective: set[str]) -> bool:
    actual = {p for p in effective if p.startswith(legacy._PRODUCTION_PREFIXES)}
    return actual - CONFIG == PRODUCTION


def change_scope_matches(effective: set[str], tests: set[str]) -> bool:
    allowed = (
        PRODUCTION | tests | POLICY | CONFIG | TOOLING | {"podvoice/CHANGELOG.md", "docs/STATUS.md"}
    )
    return effective <= allowed


def validate(root: Path, report: legacy.CandidateScope, base_tip: str, record: dict) -> bool:
    if (
        not DOMAINS
        or not PRODUCTION
        or not REVIEWER.strip()
        or not IMMUTABLE
        or not MANIFEST_SHA
        or not PROFILE_AST
        or set(record) != FIELDS
        or type(record["version"]) is not int
        or record["version"] != VERSION
        or record["kind"] != KIND
        or record["reviewer"] != REVIEWER
        or record["domains"] != list(DOMAINS)
        or report.domains != DOMAINS
        or base_tip != BASE
        or report.base != BASE
        or record["base_tip"] != BASE
        or record["merge_base"] != BASE
        or any(
            not isinstance(record[k], str) or not record[k].strip()
            for k in FIELDS - {"version", "domains"}
        )
        or not strict.pins_match(root, IMMUTABLE)
        or strict.ast_sha(safe_file(root, PROFILE), "PROFILE_AST") != PROFILE_AST
    ):
        return False
    raw = safe_file(root, MANIFEST)
    if sha(raw) != MANIFEST_SHA:
        return False
    manifest = json.loads(raw, object_pairs_hook=legacy._unique_record)
    if (
        set(manifest)
        != {
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
        or manifest["schema"] != "podview72.admission.v1"
        or manifest["base"] != BASE
    ):
        return False
    prod, tests, runtime, config, policy, tooling = (
        manifest[k] for k in ("production", "regressions", "runtime", "config", "policy", "tooling")
    )
    if (
        not all(
            strict.pins_match(root, pins)
            for pins in (prod, tests, runtime, config, policy, tooling)
        )
        or set(prod) != PRODUCTION
        or set(tests) != REQUIRED_TESTS
        or set(config) != CONFIG
        or set(policy) != POLICY - {PROFILE, MANIFEST}
        or set(tooling) != TOOLING
        or ha_runtime_inventory(root) != HA_RUNTIME
        or set(runtime) != strict.runtime_inventory(root) | HA_RUNTIME
        or not set(prod) <= set(runtime)
        or any(not p.startswith("tests/") for p in tests)
        or not config_only(root)
        or not assets_match72(root, runtime, manifest["asset_count"])
    ):
        return False
    effective = legacy._visual_repository_changes(root, BASE)
    if (
        not production_scope_matches(effective)
        or {p for p in effective if p.startswith("tests/")} != set(tests)
        or not REQUIRED_TESTS <= effective
        or not change_scope_matches(effective, set(tests))
    ):
        return False
    ignored = legacy._git(
        root,
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "-z",
        "--",
        *legacy._PRODUCTION_PREFIXES,
        "scripts/",
    )
    if any(p and not ("/__pycache__/" in p and p.endswith(".pyc")) for p in ignored.split("\0")):
        return False
    for name in effective:
        safe_file(root, name)
    return (
        record["fingerprint"] == legacy.production_fingerprint(root, BASE, BASE, tuple(prod))
        and record["regression_fingerprint"]
        == legacy.regression_fingerprint(root, BASE, BASE, tuple(tests))
        and record["runtime_fingerprint"] == strict.fingerprint(root, runtime)
        and record["config_fingerprint"] == strict.fingerprint(root, CONFIG)
        and record["policy_fingerprint"] == strict.fingerprint(root, POLICY)
        and record["tooling_fingerprint"] == strict.fingerprint(root, TOOLING)
        and record["manifest_fingerprint"] == MANIFEST_SHA
    )


def inspect_repository(root: Path, base: str) -> legacy.CandidateScope:
    report = legacy.inspect_repository(root, base)
    try:
        record = record_at(root)
        base_tip = legacy._git(root, "rev-parse", f"{base}^{{commit}}").strip()
        valid = record is not None and validate(root, report, base_tip, record)
        return replace(
            report,
            passed=valid,
            reason="exact reviewed PodView72 admission"
            if valid
            else "missing or invalid PodView72 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodView72 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print("candidate admission stopped: PV72 review bindings are not complete", file=sys.stderr)
        return 2
    try:
        root = Path(legacy._git(Path.cwd(), "rev-parse", "--show-toplevel").strip())
        report = inspect_repository(root, args.base)
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"candidate admission stopped: {exc}", file=sys.stderr)
        return 2
    print(
        json.dumps(asdict(report), indent=2)
        if args.json
        else f"candidate-scope {'PASS' if report.passed else 'FAIL'}: {report.reason}"
    )
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
