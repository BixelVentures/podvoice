#!/usr/bin/env python3
"""Exact75 admission stays closed until final source and independent review bind it."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission74 as previous
except ModuleNotFoundError:
    import candidate_scope_admission74 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "3f50a1c29433ff5f34bb04c8928d23f41c90abe0"
KIND = "podview75_ui22"
VERSION = 52
ASSET_COUNT = 200
MAX_ASSET_TOTAL_BYTES = 34 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission75.py"
MANIFEST = "scripts/podview75-admission-reviewed.json"
RECORD_MARKER = "<!-- podview75-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG
POLICY = previous.POLICY | frozenset({PROFILE, MANIFEST})
TOOLING = previous.TOOLING
FIELDS = previous.FIELDS

# Inventory is derived from immutable UI22 and the exact diff against BASE.
# Blank review bindings deliberately cannot admit this prepared candidate.
DOMAINS = ("ha_tools", "physical_output")
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/index.html",
        "podvoice/gatekeeper/static/podview/library-catalog.js",
        "podvoice/gatekeeper/static/podview/library.bundle.js",
        "podvoice/gatekeeper/static/podview/live-home-view.js",
        "podvoice/gatekeeper/static/podview/live-media-view.js",
        "podvoice/gatekeeper/static/podview/live-music-selection-view.js",
        "podvoice/gatekeeper/static/podview/live-queue-view.js",
        "podvoice/gatekeeper/static/podview/local-robot-view.js",
        "podvoice/gatekeeper/static/podview/music-results.js",
        "podvoice/gatekeeper/static/podview/player-view.js",
        "podvoice/gatekeeper/static/podview/podview.bundle.js",
        "podvoice/gatekeeper/static/podview/podview.css",
        "podvoice/gatekeeper/static/podview/podvoice-view.js",
        "podvoice/gatekeeper/static/podview/preview-scenes.js",
        "podvoice/gatekeeper/static/podview/radio-view.js",
        "podvoice/gatekeeper/static/podview/robot-control-panel.js",
        "podvoice/gatekeeper/static/podview/scene-model.js",
        "podvoice/gatekeeper/static/podview/speaker-output-view.js",
        "podvoice/gatekeeper/static/podview/timer-view.js",
        "podvoice/gatekeeper/static/podview/ui-kit.css",
        "podvoice/gatekeeper/static/podview/ui/library/components.js",
        "podvoice/gatekeeper/static/podview/ui/library/visual-components.js",
        "podvoice/gatekeeper/static/podview/ui/resource-tile.js",
        "podvoice/gatekeeper/static/podview/vehicle-view.js",
        "podvoice/gatekeeper/static/podview/voice-surface.js",
        "podvoice/gatekeeper/static/podview/weather-view.js",
        "podvoice/gatekeeper/static/podview/widget-model.js",
        "podvoice/gatekeeper/static/podview/widget-redesign.css",
        "podvoice/gatekeeper/static/podview/widget-view.js",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/podview/canonical-next-answer-explanation.test.mjs",
        "tests/podview/canonical-next-collection-selection.test.mjs",
        "tests/podview/canonical-next-four-music-tabs.test.mjs",
        "tests/podview/canonical-next-live-media-view.test.mjs",
        "tests/podview/canonical-next-music-expiry-recovery.test.mjs",
        "tests/podview/canonical-next-music-selection.test.mjs",
        "tests/podview/canonical-next-robot-control-panel.test.mjs",
        "tests/podview/canonical-next-timer-overview.test.mjs",
        "tests/podview/canonical-next-visual-history.test.mjs",
        "tests/podview/canonical-next-voice-surface.test.mjs",
        "tests/podview/canonical-next-weather-view.test.mjs",
        "tests/podview/canonical-next-widget-loading.test.mjs",
        "tests/podview/canonical-packet-first-read-reconciliation.test.mjs",
        "tests/podview/canonical-packet-robot-control-panel.test.mjs",
        "tests/podview/canonical-packet-shared-music-results.test.mjs",
        "tests/podview/canonical-packet-visual-history.test.mjs",
        "tests/podview/helpers/render-owned-album-cover.mjs",
        "tests/podview/music-expiry-recovery.test.mjs",
        "tests/podview/music-selection.test.mjs",
        "tests/podview/root-album-cover.test.mjs",
        "tests/podview/root-answer-explanation.test.mjs",
        "tests/podview/root-answer-timer-composition.test.mjs",
        "tests/podview/root-collection-selection.test.mjs",
        "tests/podview/root-configured-speaker-label.test.mjs",
        "tests/podview/root-connection-presentation.test.mjs",
        "tests/podview/root-first-read-reconciliation.test.mjs",
        "tests/podview/root-four-music-tabs.test.mjs",
        "tests/podview/root-history-renderer.test.mjs",
        "tests/podview/root-library-catalog.test.mjs",
        "tests/podview/root-light-journey.test.mjs",
        "tests/podview/root-live-media-view.test.mjs",
        "tests/podview/root-live-queue-occurrence.test.mjs",
        "tests/podview/root-local-robot-view.test.mjs",
        "tests/podview/root-mood-playlists.test.mjs",
        "tests/podview/root-music-cache.test.mjs",
        "tests/podview/root-music-expiry-recovery.test.mjs",
        "tests/podview/root-music-selection.test.mjs",
        "tests/podview/root-native-presentation-components.test.mjs",
        "tests/podview/root-overview-facts.test.mjs",
        "tests/podview/root-overview-inactive-grid.test.mjs",
        "tests/podview/root-overview-media-cards.test.mjs",
        "tests/podview/root-overview-media-values.test.mjs",
        "tests/podview/root-overview-priorities.test.mjs",
        "tests/podview/root-player-detail-navigation.test.mjs",
        "tests/podview/root-player-dom-delta.test.mjs",
        "tests/podview/root-preview-scenes.test.mjs",
        "tests/podview/root-radio-view.test.mjs",
        "tests/podview/root-retained-widget-delta.test.mjs",
        "tests/podview/root-robot-control-panel.test.mjs",
        "tests/podview/root-robot-overview-tile.test.mjs",
        "tests/podview/root-screen-settings.test.mjs",
        "tests/podview/root-shared-music-results.test.mjs",
        "tests/podview/root-speaker-output-view.test.mjs",
        "tests/podview/root-timer-dom-delta.test.mjs",
        "tests/podview/root-timer-overview.test.mjs",
        "tests/podview/root-topbar.test.mjs",
        "tests/podview/root-vehicle-view.test.mjs",
        "tests/podview/root-visual-history.test.mjs",
        "tests/podview/root-voice-surface.test.mjs",
        "tests/podview/root-weather-view.test.mjs",
        "tests/podview/root-widget-loading.test.mjs",
        "tests/unit/test_candidate_scope_admission74.py",
        "tests/unit/test_candidate_scope_admission75.py",
        "tests/unit/test_dev_cycle.py",
    }
)

HA_RUNTIME = previous.HA_RUNTIME
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission74.py": "c30998695db1176b7fbd1ce00010fa39960053496f3282d4a133f673a8e887f7",
    "scripts/podview74-admission-reviewed.json": "3f13ac9e9956411ae732a3fb5df110654a4e3baba4466e78276babdbfd428602",
}
# Deliberately unbound: no prepared draft may claim final reviewed admission.
REVIEWER = "/root/sol61_release75_review"
MANIFEST_SHA = "8458873f2ae66191e566fccc67e6fe53a711da4c4295d9c27f0da62ac30a82bc"
PROFILE_AST = "ec7a7df6e5319a98cf22cb157a6bf524ab0c54942896c069bdd23765eaba7af9"


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodView75 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodView75 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodView75 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Only the exact add-on version trio changes; HA integration remains0.1.5."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.75"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.75"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.75"'),
            (
                "custom_components/podvoice/manifest.json",
                r'^  "version": "[^"\n]+",$',
                '  "version": "0.1.5",',
            ),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


assets_match75 = previous.assets_match74


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
        or manifest["schema"] != "podview75.admission.v1"
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
        or not assets_match75(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodView75 admission"
            if valid
            else "missing or invalid PodView75 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodView75 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print("candidate admission stopped: PV75 review bindings are not complete", file=sys.stderr)
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
