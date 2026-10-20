#!/usr/bin/env python3
"""Strict70 admission remains closed until independent review bindings are present."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission69 as previous
except ModuleNotFoundError:
    import candidate_scope_admission69 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "d21c267817ce6744dfd59efeafb13a186f5fb78d"
KIND = "podview70_canonical_ui_audio_delivery"
VERSION = 47
ASSET_COUNT = 191
MAX_ASSET_TOTAL_BYTES = 34 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission70.py"
MANIFEST = "scripts/podview70-admission-reviewed.json"
RECORD_MARKER = "<!-- podview70-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG | frozenset({"custom_components/podvoice/manifest.json"})
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
    }
)
FIELDS = previous.FIELDS

DOMAINS = ("ha_tools", "physical_output")
PRODUCTION = frozenset(
    [
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/static/podview/ambient.webp",
        "podvoice/gatekeeper/static/podview/answer-widget.js",
        "podvoice/gatekeeper/static/podview/app.js",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/assets/EDITORIAL-PHOTOS.md",
        "podvoice/gatekeeper/static/podview/assets/audio/README.md",
        "podvoice/gatekeeper/static/podview/assets/audio/timer-bell.wav",
        "podvoice/gatekeeper/static/podview/assets/bicycle-drivetrain-illustration.webp",
        "podvoice/gatekeeper/static/podview/assets/design-studies/answer-glass.png",
        "podvoice/gatekeeper/static/podview/assets/design-studies/answer-open.png",
        "podvoice/gatekeeper/static/podview/assets/design-studies/answer-question.png",
        "podvoice/gatekeeper/static/podview/assets/design-studies/answer.png",
        "podvoice/gatekeeper/static/podview/assets/design-studies/bottom-player.png",
        "podvoice/gatekeeper/static/podview/assets/design-studies/overview-first.png",
        "podvoice/gatekeeper/static/podview/assets/design-studies/overview-large.png",
        "podvoice/gatekeeper/static/podview/assets/design-studies/overview.png",
        "podvoice/gatekeeper/static/podview/assets/editorial-forest.jpg",
        "podvoice/gatekeeper/static/podview/assets/editorial-forest.webp",
        "podvoice/gatekeeper/static/podview/assets/editorial-ocean.jpg",
        "podvoice/gatekeeper/static/podview/assets/editorial-ocean.webp",
        "podvoice/gatekeeper/static/podview/assets/editorial-vinyl.jpg",
        "podvoice/gatekeeper/static/podview/assets/editorial-vinyl.webp",
        "podvoice/gatekeeper/static/podview/assets/fonts/OFL-Inter.txt",
        "podvoice/gatekeeper/static/podview/assets/fonts/README.md",
        "podvoice/gatekeeper/static/podview/assets/fonts/inter-latin-wght-normal.woff2",
        "podvoice/gatekeeper/static/podview/assets/icons/PHOSPHOR-LICENSE",
        "podvoice/gatekeeper/static/podview/assets/icons/README.md",
        "podvoice/gatekeeper/static/podview/assets/icons/arrow-left-long.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/arrow-left.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/arrow-refresh.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/boombox.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/car-front.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/card.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/check-circle-fill.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/check2.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/chevron-down.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/chevron-left.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/chevron-right.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/chevron-up.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/circle.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/cloud-rain.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/cloud-sun.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/cloud.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/dash.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/gear.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/lightbulb.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/mic.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/moon.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/music-note-beamed.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/paper-plane.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/pause-fill.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/pencil.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/pin-angle.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/play-fill.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/plus.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/provenance.json",
        "podvoice/gatekeeper/static/podview/assets/icons/robot.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/skip-end-fill.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/skip-start-fill.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/sliders.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/soundwave.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/speaker-output.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/sun.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/three-dots.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/timer.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/vacuum.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/volume-up-fill.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/x-lg.svg",
        "podvoice/gatekeeper/static/podview/assets/indie.webp",
        "podvoice/gatekeeper/static/podview/assets/italian.webp",
        "podvoice/gatekeeper/static/podview/assets/kitchen.webp",
        "podvoice/gatekeeper/static/podview/assets/lake.webp",
        "podvoice/gatekeeper/static/podview/assets/morning-acoustic.webp",
        "podvoice/gatekeeper/static/podview/assets/radio-p1.svg",
        "podvoice/gatekeeper/static/podview/assets/radio-p3.svg",
        "podvoice/gatekeeper/static/podview/assets/radio-p4-ostjylland.svg",
        "podvoice/gatekeeper/static/podview/assets/radio-p6-beat.svg",
        "podvoice/gatekeeper/static/podview/assets/radio-p8-jazz.svg",
        "podvoice/gatekeeper/static/podview/assets/vehicle-gray-model-y-2023.webp",
        "podvoice/gatekeeper/static/podview/assets/weather-sky-soft.webp",
        "podvoice/gatekeeper/static/podview/flow-controller.js",
        "podvoice/gatekeeper/static/podview/frame-layout.css",
        "podvoice/gatekeeper/static/podview/ha-home-observation.js",
        "podvoice/gatekeeper/static/podview/home-model.js",
        "podvoice/gatekeeper/static/podview/index.html",
        "podvoice/gatekeeper/static/podview/library-catalog.js",
        "podvoice/gatekeeper/static/podview/library.bundle.js",
        "podvoice/gatekeeper/static/podview/library.css",
        "podvoice/gatekeeper/static/podview/library.html",
        "podvoice/gatekeeper/static/podview/library.js",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
        "podvoice/gatekeeper/static/podview/live-home-view.js",
        "podvoice/gatekeeper/static/podview/live-media-view.js",
        "podvoice/gatekeeper/static/podview/live-music-selection-view.js",
        "podvoice/gatekeeper/static/podview/live-music-view.js",
        "podvoice/gatekeeper/static/podview/live-music.css",
        "podvoice/gatekeeper/static/podview/local-robot-view.js",
        "podvoice/gatekeeper/static/podview/media-observation.js",
        "podvoice/gatekeeper/static/podview/music-fixture.js",
        "podvoice/gatekeeper/static/podview/music-results.js",
        "podvoice/gatekeeper/static/podview/music-selection-model.js",
        "podvoice/gatekeeper/static/podview/ordbog.js",
        "podvoice/gatekeeper/static/podview/overview-activity-model.js",
        "podvoice/gatekeeper/static/podview/owner-answers.js",
        "podvoice/gatekeeper/static/podview/player-view.js",
        "podvoice/gatekeeper/static/podview/podview.bundle.js",
        "podvoice/gatekeeper/static/podview/podview.css",
        "podvoice/gatekeeper/static/podview/podvoice-transport.js",
        "podvoice/gatekeeper/static/podview/podvoice-view.js",
        "podvoice/gatekeeper/static/podview/preview-scenes.js",
        "podvoice/gatekeeper/static/podview/radio-model.js",
        "podvoice/gatekeeper/static/podview/radio-view.js",
        "podvoice/gatekeeper/static/podview/robot-control-panel.js",
        "podvoice/gatekeeper/static/podview/scene-model.js",
        "podvoice/gatekeeper/static/podview/spotify-artwork.js",
        "podvoice/gatekeeper/static/podview/style.css",
        "podvoice/gatekeeper/static/podview/timer-model.js",
        "podvoice/gatekeeper/static/podview/timer-notice.css",
        "podvoice/gatekeeper/static/podview/timer-notice.js",
        "podvoice/gatekeeper/static/podview/timer-view.js",
        "podvoice/gatekeeper/static/podview/ui/answer-auto-return.js",
        "podvoice/gatekeeper/static/podview/ui/components.css",
        "podvoice/gatekeeper/static/podview/ui/conclusion-disclosure.js",
        "podvoice/gatekeeper/static/podview/ui/gestures.js",
        "podvoice/gatekeeper/static/podview/ui/legacy-components.css",
        "podvoice/gatekeeper/static/podview/ui/library/components.js",
        "podvoice/gatekeeper/static/podview/ui/library/library.css",
        "podvoice/gatekeeper/static/podview/ui/library/visual-components.js",
        "podvoice/gatekeeper/static/podview/ui/motion.js",
        "podvoice/gatekeeper/static/podview/ui/page-lifecycle.js",
        "podvoice/gatekeeper/static/podview/ui/pressed-state.js",
        "podvoice/gatekeeper/static/podview/ui/resource-tile.js",
        "podvoice/gatekeeper/static/podview/ui/robot-motion.js",
        "podvoice/gatekeeper/static/podview/ui/screen-lifecycle.js",
        "podvoice/gatekeeper/static/podview/ui/scroll-edges.js",
        "podvoice/gatekeeper/static/podview/vehicle-model.js",
        "podvoice/gatekeeper/static/podview/vehicle-view.js",
        "podvoice/gatekeeper/static/podview/visual-examples.js",
        "podvoice/gatekeeper/static/podview/voice-surface.js",
        "podvoice/gatekeeper/static/podview/weather-view.js",
        "podvoice/gatekeeper/static/podview/widget-model.js",
        "podvoice/gatekeeper/static/podview/widget-redesign.css",
        "podvoice/gatekeeper/static/podview/widget-view.css",
        "podvoice/gatekeeper/static/podview/widget-view.js",
    ]
)
REQUIRED_TESTS = frozenset(
    [
        "tests/integration/test_podview_audio_asset.py",
        "tests/integration/test_podview_pairing_navigation.py",
        "tests/podview/account-visibility.test.mjs",
        "tests/podview/canonical-next-live-media-view-source.test.mjs",
        "tests/podview/canonical-next-live-media-view.test.mjs",
        "tests/podview/canonical-next-player-view-source.test.mjs",
        "tests/podview/canonical-next-player-view.test.mjs",
        "tests/podview/canonical-next-presentation-answers.test.mjs",
        "tests/podview/canonical-next-radio-model.test.mjs",
        "tests/podview/canonical-next-radio-view.test.mjs",
        "tests/podview/canonical-next-robot-control-panel.test.mjs",
        "tests/podview/canonical-next-robot-history-view.test.mjs",
        "tests/podview/canonical-next-timer-overview.test.mjs",
        "tests/podview/canonical-next-vehicle-view.test.mjs",
        "tests/podview/canonical-next-visual-history.test.mjs",
        "tests/podview/canonical-next-weather-view.test.mjs",
        "tests/podview/canonical-next-widget-loading.test.mjs",
        "tests/podview/canonical-packet-account-visibility.test.mjs",
        "tests/podview/canonical-packet-first-read-reconciliation.test.mjs",
        "tests/podview/canonical-packet-motion.test.mjs",
        "tests/podview/canonical-packet-player-view.test.mjs",
        "tests/podview/canonical-packet-robot-control-panel.test.mjs",
        "tests/podview/canonical-packet-shared-music-results.test.mjs",
        "tests/podview/canonical-packet-timer-access.test.mjs",
        "tests/podview/canonical-packet-visual-history.test.mjs",
        "tests/podview/fixtures/radio-logo-sources.json",
        "tests/podview/root-component-library.test.mjs",
        "tests/podview/root-first-read-reconciliation.test.mjs",
        "tests/podview/root-history-renderer.test.mjs",
        "tests/podview/root-live-control-view.test.mjs",
        "tests/podview/root-live-media-view.test.mjs",
        "tests/podview/root-mood-playlists.test.mjs",
        "tests/podview/root-motion.test.mjs",
        "tests/podview/root-player-dom-delta.test.mjs",
        "tests/podview/root-player-view.test.mjs",
        "tests/podview/root-retained-widget-delta.test.mjs",
        "tests/podview/root-robot-control-panel.test.mjs",
        "tests/podview/root-robot-history-view.test.mjs",
        "tests/podview/root-robot-motion.test.mjs",
        "tests/podview/root-shared-music-results.test.mjs",
        "tests/podview/root-speaker-output-idle.test.mjs",
        "tests/podview/root-timer-access.test.mjs",
        "tests/podview/root-timer-dom-delta.test.mjs",
        "tests/podview/root-timer-notice.test.mjs",
        "tests/podview/root-timer-overview.test.mjs",
        "tests/podview/root-weather-view.test.mjs",
        "tests/podview/visual-pending.test.mjs",
        "tests/unit/test_candidate_scope_admission69.py",
        "tests/unit/test_candidate_scope_admission70.py",
    ]
)
ASSET_CHANGES = frozenset()

HA_RUNTIME = previous.HA_RUNTIME
# CLOSED TEMPLATE: bindings and complete source/test inventories await source freeze and independent exact-tree review.
REVIEWER = "/root/conversation_flows"
MANIFEST_SHA = "cd682f56b22b97a540a772da3e06bb74e0ec3e0eee75a1b5b96ff7946eedb7e3"
PROFILE_AST = "556c69a60c916928cdcca197fade9ffad09ad8fc86170365f82ba96131bb8139"
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission69.py": "f56897091a633ae82f39fa7702f6be49f0733b2d2e01393bdac58e87670799dc",
    "scripts/podview69-admission-reviewed.json": "13f6e113a2d12b74a1ebcd599eec38d06f280f6054d2b7ad3db290f173fd3e00",
}


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodVoice70 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodVoice70 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodVoice70 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Only add-on version trio changes; HA integration version remains0.1.5."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.70"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.70"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.70"'),
            (
                "custom_components/podvoice/manifest.json",
                r'^  "version": "[^"\n]+",$',
                '  "version": "0.1.5",',
            ),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match70(root: Path, runtime: dict, count: object) -> bool:
    """Exact canonical191 asset inventory; path/hash/byte ceiling are fail closed."""
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
        or manifest["schema"] != "podvoice70.admission.v1"
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
        or not assets_match70(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodVoice70 admission"
            if valid
            else "missing or invalid PodVoice70 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodVoice70 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print("candidate admission stopped: PV70 review bindings are not complete", file=sys.stderr)
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
