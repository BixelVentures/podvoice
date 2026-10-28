#!/usr/bin/env python3
"""Exact97 admission for the reviewed combined music and PodView candidate."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission96 as previous
except ModuleNotFoundError:
    import candidate_scope_admission96 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "8ecd76bc3603fccdd94066212a66d5138e0cebd5"
KIND = "podvoice97_music_catalogue_recovery"
VERSION = 74
FIRMWARE_PRODUCTION = frozenset()
ASSET_COUNT = 215
MAX_ASSET_TOTAL_BYTES = 34 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission97.py"
MANIFEST = "scripts/podview97-admission-reviewed.json"
RECORD_MARKER = "<!-- podvoice97-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG
POLICY = frozenset(
    {
        PROFILE,
        MANIFEST,
        ".github/workflows/ci.yml",
        "AGENTS.md",
        "docs/ARKITEKTUR.md",
        "docs/INVARIANTER.md",
        "docs/POD-SYSTEM-STANDARD.md",
        "docs/PRODUKTMÅL.md",
        "docs/README.md",
        "docs/component-library-registry.json",
        "scripts/dev_cycle.py",
    }
)
TOOLING = frozenset({"scripts/build-scripts.mjs"})
FIELDS = previous.FIELDS
DOMAINS = ("ha_tools", "physical_output")
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/__main__.py",
        "podvoice/gatekeeper/config.py",
        "podvoice/gatekeeper/history.py",
        "podvoice/gatekeeper/mood_diagnostics.py",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/podview_receipts.py",
        "podvoice/gatekeeper/podview_room_media.py",
        "podvoice/gatekeeper/podview_vehicle.py",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/ha-home-observation.js",
        "podvoice/gatekeeper/static/podview/index.html",
        "podvoice/gatekeeper/static/podview/library.bundle.js",
        "podvoice/gatekeeper/static/podview/light-room-view.js",
        "podvoice/gatekeeper/static/podview/live-answer-view.js",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
        "podvoice/gatekeeper/static/podview/live-music-selection-view.js",
        "podvoice/gatekeeper/static/podview/owner-answers.js",
        "podvoice/gatekeeper/static/podview/player-view.js",
        "podvoice/gatekeeper/static/podview/podview.bundle.js",
        "podvoice/gatekeeper/static/podview/podview.css",
        "podvoice/gatekeeper/static/podview/robot-control-panel.js",
        "podvoice/gatekeeper/static/podview/scene-model.js",
        "podvoice/gatekeeper/static/podview/ui-kit.css",
        "podvoice/gatekeeper/static/podview/ui/components.css",
        "podvoice/gatekeeper/static/podview/vehicle-view.js",
        "podvoice/gatekeeper/static/podview/weather-view.js",
        "podvoice/gatekeeper/static/podview/widget-redesign.css",
        "podvoice/gatekeeper/static/podview/widget-view.js",
        "podvoice/gatekeeper/tools.py",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/integration/test_mood_diagnostics_route.py",
        "tests/integration/test_pod_system_music_journey.py",
        "tests/integration/test_podview_mood_playlists.py",
        "tests/integration/test_podview_mood_preview.py",
        "tests/integration/test_podview_playlist_resilience.py",
        "tests/integration/test_podview_queue_occurrence.py",
        "tests/integration/test_podview_room_move_caller.py",
        "tests/integration/test_podview_start_move_settlement.py",
        "tests/integration/test_podview_vehicle_home.py",
        "tests/podview/answer-history-integration-history-read-state.test.mjs",
        "tests/podview/answer-history-integration-live-answer-view.test.mjs",
        "tests/podview/answer-history-integration-live-control-view.test.mjs",
        "tests/podview/answer-history-integration-owner-answers.test.mjs",
        "tests/podview/answer-history-integration-scene-model.test.mjs",
        "tests/podview/answer-history-integration-transcript-history-view.test.mjs",
        "tests/podview/answer-history-integration-visual-history.test.mjs",
        "tests/podview/canonical-field88-screen-settings.test.mjs",
        "tests/podview/hue-status-placement.browser.mjs",
        "tests/podview/hue-status-placement.html",
        "tests/podview/root-live-light-area-host.test.mjs",
        "tests/podview/root-live-media-queue-lifecycle.test.mjs",
        "tests/podview/root-player-view.test.mjs",
        "tests/podview/root-screen-settings.test.mjs",
        "tests/podview/root-script-delivery.test.mjs",
        "tests/podview/root-second-move-lifecycle.test.mjs",
        "tests/podview/root-toast-local-replacement.test.mjs",
        "tests/podview/root-toast-retry-grid.test.mjs",
        "tests/podview/root-vehicle-view.test.mjs",
        "tests/podview/root-weather-view.test.mjs",
        "tests/unit/test_answer_history57.py",
        "tests/unit/test_podview_receipts.py",
        "tests/unit/test_podview_vehicle.py",
    }
)
HA_RUNTIME = previous.HA_RUNTIME
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission96.py": "004acd81939422ff37879c4d46306eb82b83eedac80c4b411e19cbbdfe03032a"
}

# Filled only after independent exact-tree review. Admission remains fail-closed.
REVIEWER = "/root/review_catalogue_join"
MANIFEST_SHA = "ff2039d1f90a0dda9bbee8f8a95fc4be94002e89a9db64c8d7d5b370925a35a5"
PROFILE_AST = "11ae93f2366e2641734a7c61743c88e69d5ef108b72d1a167f62e32802cc032e"


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodVoice97 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodVoice97 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodVoice97 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Allow version97 plus the reviewed passive vehicle policy option only."""
    addon = safe_file(root, "podvoice/config.yaml").decode()
    option = '  podview_vehicle_read_policy: ""\n'
    schema = '  podview_vehicle_read_policy: "str?"\n'
    if addon.count(option) != 1 or addon.count(schema) != 1:
        return False
    addon_without_vehicle = addon.replace(option, "").replace(schema, "")
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            addon_without_vehicle
            if name == "podvoice/config.yaml"
            else safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.97"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.97"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.97"'),
            (
                "custom_components/podvoice/manifest.json",
                r'^  "version": "[^"\n]+",$',
                '  "version": "0.1.7",',
            ),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory
assets_match91 = previous.assets_match91


def production_scope_matches(effective: set[str]) -> bool:
    actual = {p for p in effective if p.startswith(legacy._PRODUCTION_PREFIXES)}
    return actual - CONFIG == PRODUCTION


def production_runtime_match(production: set[str], runtime: set[str]) -> bool:
    return production - runtime == FIRMWARE_PRODUCTION


def change_scope_matches(effective: set[str], tests: set[str]) -> bool:
    allowed = PRODUCTION | tests | POLICY | CONFIG | TOOLING | {"docs/STATUS.md"}
    return effective <= allowed


def validate(root: Path, report: legacy.CandidateScope, base_tip: str, record: dict) -> bool:
    if (
        not DOMAINS
        or not REVIEWER.strip()
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
        or manifest["schema"] != "podvoice97.admission.v1"
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
        or not production_runtime_match(set(prod), set(runtime))
        or any(not p.startswith("tests/") for p in tests)
        or not config_only(root)
        or not assets_match91(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodVoice97 music catalogue admission"
            if valid
            else "missing or invalid PodVoice97 music catalogue admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(
            report, passed=False, reason="malformed PodVoice97 music catalogue admission"
        )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print(
            "candidate admission stopped: PV97 independent review bindings are incomplete",
            file=sys.stderr,
        )
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
