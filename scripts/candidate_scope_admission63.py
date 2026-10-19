#!/usr/bin/env python3
"""Strict63 admission remains closed until independent review bindings are present."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission56 as asset_contract
    from scripts import candidate_scope_admission62 as previous
except ModuleNotFoundError:
    import candidate_scope_admission56 as asset_contract
    import candidate_scope_admission62 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "382c8275125fda4742c8f5947bb1ceed0e3b102d"
KIND = "podview63_robot_voice_music_continuity"
VERSION = 40
ASSET_COUNT = 143
MAX_ASSET_TOTAL_BYTES = 18 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission63.py"
MANIFEST = "scripts/podview63-admission-reviewed.json"
RECORD_MARKER = "<!-- podview63-admission"
STATIC = previous.STATIC
CONFIG = frozenset({"podvoice/config.yaml", "podvoice/gatekeeper/__init__.py", "pyproject.toml"})
POLICY = previous.POLICY | frozenset({PROFILE, MANIFEST})
TOOLING = previous.TOOLING | frozenset({"scripts/live_semantic_completion_eval.py"})
FIELDS = previous.FIELDS

DOMAINS = ("physical_output", "realtime_semantics")
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/static/podview/frame-layout.css",
        "podvoice/gatekeeper/__main__.py",
        "podvoice/gatekeeper/device_control.py",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/speaker-output-view.js",
        "podvoice/gatekeeper/static/podview/ui/library/library.css",
        "podvoice/gatekeeper/static/podview/live-home-view.js",
        "podvoice/gatekeeper/static/podview/live-music-selection-view.js",
        "podvoice/gatekeeper/thin.py",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/podview_enrichment.py",
        "podvoice/gatekeeper/podview_controls.py",
        "podvoice/gatekeeper/podview_feeling.py",
        "podvoice/gatekeeper/static/podview/player-view.js",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
        "podvoice/gatekeeper/diagnostic_retention.py",
        "podvoice/gatekeeper/cleaning_journal.py",
        "podvoice/gatekeeper/static/podview/widget-redesign.css",
        "podvoice/gatekeeper/live_prompt.py",
        "podvoice/gatekeeper/static/podview/robot-control-panel.js",
        "podvoice/gatekeeper/tools.py",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/integration/test_podview_playlist_refresh.py",
        "tests/podview/root-component-library.test.mjs",
        "tests/podview/canonical-next-collection-selection.test.mjs",
        "tests/podview/root-native-music-controls.test.mjs",
        "tests/integration/test_thin_live_wake_led.py",
        "tests/integration/test_podview_mood_playlists.py",
        "tests/integration/test_thin_automatic_diagnostics.py",
        "tests/integration/test_thin_playback_targets.py",
        "tests/unit/test_candidate_scope_admission62.py",
        "tests/unit/test_diagnostic_retention.py",
        "tests/unit/test_dev_cycle.py",
        "tests/integration/test_podview_playlist_resilience.py",
        "tests/podview/root-robot-control-panel.test.mjs",
        "tests/podview/root-robot-history-view.test.mjs",
        "tests/podview/root-speaker-output-view.test.mjs",
        "tests/unit/test_live_semantic_completion_eval.py",
        "tests/podview/canonical-next-robot-history-view.test.mjs",
        "tests/podview/root-live-control-view.test.mjs",
        "tests/podview/canonical-next-robot-control-panel.test.mjs",
        "tests/podview/canonical-next-native-music-controls.test.mjs",
        "tests/integration/test_thin_mcp_recovery.py",
        "tests/podview/root-collection-selection.test.mjs",
        "tests/podview/canonical-next-player-view.test.mjs",
        "tests/podview/canonical-next-player-view-source.test.mjs",
        "tests/podview/root-player-view.test.mjs",
        "tests/integration/test_thin_timer_end_to_end.py",
        "tests/integration/test_podview_robot_suggestions.py",
        "tests/unit/test_candidate_scope_admission63.py",
    }
)
ASSET_CHANGES = frozenset(
    {
        "frame-layout.css",
        "robot-control-panel.js",
        "speaker-output-view.js",
        "live-home-view.js",
        "widget-redesign.css",
        "live-control-view.js",
        "ui/library/library.css",
        "live-music-selection-view.js",
        "player-view.js",
    }
)

HA_RUNTIME = previous.HA_RUNTIME
# CLOSED TEMPLATE: bindings and complete source/test inventories await source freeze and independent exact-tree review.
REVIEWER = "root-independent-review-20261019"
MANIFEST_SHA = "e1e1c6eaf8937a379edf02e1c4f5465d5918ed868875efdc76b1bc0efbb2d874"
PROFILE_AST = "8c1ba29a6c838f70353ab3d70b4b481b4459cbfa27ba162bab73c592c0f13a22"
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission62.py": "534841160a7a7ecb541361053d27863f01f75e5d56671e4bb060070635f45dd8",
    "scripts/podview62-admission-reviewed.json": "06dcfa274d054e3a7a05b6ede8c7665545238bf42395caad905ab0050087ca43",
}


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodVoice63 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodVoice63 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodVoice63 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Only the existing add-on version trio changes to63; HA configuration is exact62."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.63"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.63"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.63"'),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match63(root: Path, runtime: dict, count: object) -> bool:
    """Keep strict 143-file/18 MiB checks; only exact independently reviewed assets may differ62."""
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
    return actual - {"podvoice/gatekeeper/__init__.py"} == PRODUCTION


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
        or manifest["schema"] != "podvoice63.admission.v1"
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
        or not assets_match63(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodVoice63 admission"
            if valid
            else "missing or invalid PodVoice63 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodVoice63 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print("candidate admission stopped: PV62 review bindings are not complete", file=sys.stderr)
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
