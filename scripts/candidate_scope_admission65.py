#!/usr/bin/env python3
"""Strict65 admission remains closed until independent review bindings are present."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission56 as asset_contract
    from scripts import candidate_scope_admission64 as previous
except ModuleNotFoundError:
    import candidate_scope_admission56 as asset_contract
    import candidate_scope_admission64 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "eead19bcf86e958fdb78321fdd54549d393698c8"
KIND = "podview65_ui_cover_controller_talk_continuity"
VERSION = 42
ASSET_COUNT = 143
MAX_ASSET_TOTAL_BYTES = 18 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission65.py"
MANIFEST = "scripts/podview65-admission-reviewed.json"
RECORD_MARKER = "<!-- podview65-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG | frozenset({"custom_components/podvoice/manifest.json"})
POLICY = previous.POLICY | frozenset({PROFILE, MANIFEST})
TOOLING = previous.TOOLING
FIELDS = previous.FIELDS

DOMAINS = ("ha_tools", "physical_output")
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/podview_music.py",
        "podvoice/gatekeeper/static/podview/ui/library/library.css",
        "custom_components/podvoice/controller_admin.py",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/openai_live.py",
        "podvoice/gatekeeper/static/podview/live-media-view.js",
        "podvoice/gatekeeper/static/podview/player-view.js",
        "podvoice/gatekeeper/thin.py",
        "podvoice/gatekeeper/static/index.html",
        "podvoice/gatekeeper/static/podview/widget-redesign.css",
        "podvoice/gatekeeper/static/podview/widget-view.js",
        "podvoice/gatekeeper/static/podview/frame-layout.css",
        "podvoice/gatekeeper/static/podview/control-model.js",
        "podvoice/gatekeeper/static/podview/music-results.js",
        "podvoice/gatekeeper/podview_admin_transport.py",
        "podvoice/gatekeeper/static/podview/ui/motion.js",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
        "podvoice/gatekeeper/static/podview/ui/components.css",
        "custom_components/podvoice/services.yaml",
        "podvoice/gatekeeper/static/podview/live-home-view.js",
        "podvoice/gatekeeper/podview_controls.py",
        "podvoice/gatekeeper/static/podview/live-music-selection-view.js",
        "podvoice/gatekeeper/static/podview/music-selection-model.js",
        "podvoice/gatekeeper/tools.py",
        "podvoice/gatekeeper/static/podview/robot-control-panel.js",
        "custom_components/podvoice/__init__.py",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "custom_components/podvoice/config_flow.py",
        "podvoice/gatekeeper/talk.py",
        "podvoice/gatekeeper/static/podview/spotify-artwork.js",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/podview/root-player-dom-delta.test.mjs",
        "tests/podview/root-first-read-reconciliation.test.mjs",
        "tests/podview/canonical-next-collection-selection.test.mjs",
        "tests/podview/root-mood-playlists.test.mjs",
        "tests/unit/test_candidate_scope_admission65.py",
        "tests/podview/root-robot-control-panel.test.mjs",
        "tests/integration/test_talk_webrtc.py",
        "tests/podview/canonical-next-robot-control-panel.test.mjs",
        "tests/podview/mood-preview.test.mjs",
        "tests/integration/test_talk_rotation.py",
        "tests/integration/test_talk_webrtc_browser.py",
        "tests/podview/root-collection-selection.test.mjs",
        "tests/unit/test_dev_cycle.py",
        "tests/podview/root-shared-music-results.test.mjs",
        "tests/unit/test_openai_live.py",
        "tests/integration/test_podview_admin_provision.py",
        "tests/integration/test_thin_live.py",
        "tests/podview/root-control-model.test.mjs",
        "tests/integration/test_podview_controls.py",
        "tests/podview/root-weather-view.test.mjs",
        "tests/podview/root-live-media-view.test.mjs",
        "tests/integration/test_podview_playlist_refresh.py",
        "tests/podview/root-spotify-artwork.test.mjs",
        "tests/integration/test_podview_mood_playlists.py",
        "tests/integration/test_podview_music.py",
        "tests/podview/root-motion.test.mjs",
        "tests/unit/test_ha_controller_admin.py",
        "tests/unit/test_candidate_scope_admission64.py",
        "tests/unit/test_podview_playlist_artwork.py",
        "tests/podview/root-live-control-view.test.mjs",
        "tests/integration/test_podview_mood_preview.py",
        "tests/ha_framework/test_controller_admin_services.py",
    }
)
ASSET_CHANGES = frozenset(
    {
        "control-model.js",
        "robot-control-panel.js",
        "frame-layout.css",
        "widget-redesign.css",
        "live-media-view.js",
        "player-view.js",
        "live-home-view.js",
        "live-control-view.js",
        "live-music-selection-view.js",
        "spotify-artwork.js",
        "ui/library/library.css",
        "music-results.js",
        "ui/motion.js",
        "music-selection-model.js",
        "ui/components.css",
        "widget-view.js",
    }
)

HA_RUNTIME = previous.HA_RUNTIME
# CLOSED TEMPLATE: bindings and complete source/test inventories await source freeze and independent exact-tree review.
REVIEWER = "/root/astra_actual_ui_acceptance_audit"
MANIFEST_SHA = "f28f38ac4c1b70803b2f531d019e5c4e063ef5e1aa7dc2ad3576337d3c027085"
PROFILE_AST = "00ade9bbf0199804c0ee08ac408dcecf88d2b77d00bbd89a3f7fbf0644e297ed"
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission64.py": "a0de725fb53480423817b600051c2a17445bb71d625e56bd3d5ed549c73d2793",
    "scripts/podview64-admission-reviewed.json": "4f06f19ebf25f868b4ebb6c1e6d50642e02860e23fb2aadc3ff3eb736b3686e7",
}


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodVoice65 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodVoice65 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodVoice65 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Only add-on version trio and HA integration package version change."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.65"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.65"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.65"'),
            (
                "custom_components/podvoice/manifest.json",
                r'^  "version": "[^"\n]+",$',
                '  "version": "0.1.5",',
            ),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match65(root: Path, runtime: dict, count: object) -> bool:
    """Keep strict 143-file/18 MiB checks; only exact independently reviewed assets may differ64."""
    if not asset_contract.assets_match56(root, runtime, count):
        return False
    baseline = json.loads(legacy._git(root, "show", f"{BASE}:{STATIC}asset-manifest.json"))
    original = {STATIC + row["path"]: row["sha256"] for row in baseline["files"]}
    assets = {name for name in runtime if name.startswith(STATIC)}
    if assets != set(original) | {STATIC + "asset-manifest.json"}:
        return False
    return all(
        runtime[name] == digest
        for name, digest in original.items()
        if name.removeprefix(STATIC) not in ASSET_CHANGES
    )


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
        or manifest["schema"] != "podvoice65.admission.v1"
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
        or not assets_match65(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodVoice65 admission"
            if valid
            else "missing or invalid PodVoice65 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodVoice65 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print("candidate admission stopped: PV65 review bindings are not complete", file=sys.stderr)
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
