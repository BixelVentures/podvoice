#!/usr/bin/env python3
"""Strict66 admission remains closed until independent review bindings are present."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission56 as asset_contract
    from scripts import candidate_scope_admission65 as previous
except ModuleNotFoundError:
    import candidate_scope_admission56 as asset_contract
    import candidate_scope_admission65 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "2c585fabdaaf52895a103db698988477eed098a4"
KIND = "podview66_idle_destination_timer_progress_robot_recovery"
VERSION = 43
ASSET_COUNT = 143
MAX_ASSET_TOTAL_BYTES = 18 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission66.py"
MANIFEST = "scripts/podview66-admission-reviewed.json"
RECORD_MARKER = "<!-- podview66-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG | frozenset({"custom_components/podvoice/manifest.json"})
POLICY = previous.POLICY | frozenset({PROFILE, MANIFEST})
TOOLING = previous.TOOLING
FIELDS = previous.FIELDS

DOMAINS = ("physical_output",)
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/static/podview/live-media-view.js",
        "podvoice/gatekeeper/static/podview/music-results.js",
        "podvoice/gatekeeper/podview_speakers.py",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/robot-control-panel.js",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/static/podview/speaker-output-view.js",
        "podvoice/gatekeeper/diagnostic_retention.py",
        "podvoice/gatekeeper/static/podview/music-selection-model.js",
        "podvoice/gatekeeper/podview_music_selection.py",
        "podvoice/gatekeeper/static/podview/live-music-selection-view.js",
        "podvoice/gatekeeper/static/podview/podvoice-transport.js",
        "podvoice/gatekeeper/podview_controls.py",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
        "podvoice/gatekeeper/podview_room_media.py",
        "podvoice/gatekeeper/thin.py",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/unit/test_diagnostic_retention.py",
        "tests/podview/controller-continuity.test.mjs",
        "tests/podview/root-speaker-output-view.test.mjs",
        "tests/podview/canonical-next-music-selection.test.mjs",
        "tests/integration/test_podview_idle_destination.py",
        "tests/integration/test_thin_timer_end_to_end.py",
        "tests/integration/test_ha_timer_native_output.py",
        "tests/podview/root-collection-selection.test.mjs",
        "tests/podview/canonical-next-collection-selection.test.mjs",
        "tests/podview/root-live-media-view.test.mjs",
        "tests/podview/root-shared-music-results.test.mjs",
        "tests/podview/root-live-control-view.test.mjs",
        "tests/podview/canonical-next-robot-control-panel.test.mjs",
        "tests/podview/root-robot-control-panel.test.mjs",
        "tests/integration/test_thin_automatic_diagnostics.py",
        "tests/unit/test_music_selection_owner.py",
        "tests/integration/test_podview_controls.py",
        "tests/podview/root-music-selection.test.mjs",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_candidate_scope_admission66.py",
    }
)
ASSET_CHANGES = frozenset(
    {
        "podvoice-transport.js",
        "speaker-output-view.js",
        "music-results.js",
        "live-control-view.js",
        "robot-control-panel.js",
        "music-selection-model.js",
        "live-music-selection-view.js",
        "live-media-view.js",
    }
)

HA_RUNTIME = previous.HA_RUNTIME
# CLOSED TEMPLATE: bindings and complete source/test inventories await source freeze and independent exact-tree review.
REVIEWER = "/root/astra_actual_ui_acceptance_audit"
MANIFEST_SHA = "20deac962931fdd747dc1abbcae7e54d2abf069e7da7c8bcf6745d1936607e2b"
PROFILE_AST = "1175e673e6642d38a979c6d6b72912e700e5da28aa9e9ca595a3f2b5bd214688"
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission65.py": "03e84501ab219d2246c157a07185ffbaa4521b0a321f0ad165c793262000ad0f",
    "scripts/podview65-admission-reviewed.json": "ed264ce19f593c1d04f36cc87b2025f21a61eaf3d2f2c49a51b81d21e52dd36f",
}


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodVoice66 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodVoice66 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodVoice66 record must be an object")
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
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.66"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.66"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.66"'),
            (
                "custom_components/podvoice/manifest.json",
                r'^  "version": "[^"\n]+",$',
                '  "version": "0.1.5",',
            ),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match66(root: Path, runtime: dict, count: object) -> bool:
    """Keep strict 143-file/18 MiB checks; only exact independently reviewed assets may differ65."""
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
        or manifest["schema"] != "podvoice66.admission.v1"
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
        or not assets_match66(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodVoice66 admission"
            if valid
            else "missing or invalid PodVoice66 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodVoice66 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print("candidate admission stopped: PV66 review bindings are not complete", file=sys.stderr)
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
