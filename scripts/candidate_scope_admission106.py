#!/usr/bin/env python3
"""Exact106 admission for current robot activity."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission105 as previous
except ModuleNotFoundError:
    import candidate_scope_admission105 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "0458f59108a099a0bb898becdd14941ed885b535"
KIND = "podvoice106_current_robot_activity"
VERSION = 83
FIRMWARE_PRODUCTION = frozenset()
ASSET_COUNT = 215
MAX_ASSET_TOTAL_BYTES = 34 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission106.py"
MANIFEST = "scripts/podview106-admission-reviewed.json"
RECORD_MARKER = "<!-- podvoice106-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG
POLICY = frozenset(
    {
        PROFILE,
        MANIFEST,
        "podvoice/CHANGELOG.md",
        ".github/workflows/ci.yml",
        "scripts/dev_cycle.py",
    }
)
TOOLING = frozenset()
FIELDS = previous.FIELDS
DOMAINS = ("ha_tools", "physical_output")
PRODUCTION = frozenset(
    [
        "podvoice/gatekeeper/device_control.py",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/podview_robot.py",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/home-model.js",
        "podvoice/gatekeeper/static/podview/index.html",
        "podvoice/gatekeeper/static/podview/library.bundle.js",
        "podvoice/gatekeeper/static/podview/live-home-view.js",
        "podvoice/gatekeeper/static/podview/podview.bundle.js",
        "podvoice/gatekeeper/static/podview/robot-control-panel.js",
        "podvoice/gatekeeper/static/podview/robot-observation.js",
        "podvoice/gatekeeper/static/podview/vehicle-view.js",
    ]
)
REQUIRED_TESTS = frozenset(
    [
        "tests/integration/test_robot_current_activity.py",
        "tests/podview/canonical-next-robot-control-panel.test.mjs",
        "tests/podview/canonical-packet-robot-control-panel.test.mjs",
        "tests/podview/root-robot-control-panel.test.mjs",
        "tests/podview/root-robot-history-view.test.mjs",
        "tests/podview/root-robot-observation.test.mjs",
        "tests/podview/root-vehicle-view.test.mjs",
        "tests/unit/test_podview_current_activity.py",
    ]
)

HA_RUNTIME = previous.HA_RUNTIME
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission105.py": "582ad660f9e7e1302724ac7f8a6f8de30d3047f806fc99b991025d4d422da54a"
}

# Filled only after independent exact-tree review. Admission remains fail-closed.
REVIEWER = "/root/admin_race_review"
MANIFEST_SHA = "d57a20688e82112e4f6b93a50daa4eb3e67c8165ad6e051dfc3a989c24c6eca4"
PROFILE_AST = "02c7712c020c79909710f2a898b3e95418b106876b27d1a591f785a1ce995732"


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodVoice106 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodVoice106 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodVoice106 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Allow only the 2.0.106 version update."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.106"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.106"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.106"'),
            (
                "custom_components/podvoice/manifest.json",
                r'^  "version": "[^"\n]+",$',
                '  "version": "0.1.9",',
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
        or manifest["schema"] != "podvoice106.admission.v1"
        or manifest["base"] != BASE
    ):
        return False
    prod, tests, runtime, config, policy, tooling = (
        manifest[k] for k in ("production", "regressions", "runtime", "config", "policy", "tooling")
    )
    if (
        not all(strict.pins_match(root, pins) for pins in (prod, tests, runtime, config, policy))
        or set(prod) != PRODUCTION
        or set(tests) != REQUIRED_TESTS
        or set(config) != CONFIG
        or set(policy) != POLICY - {PROFILE, MANIFEST}
        or not isinstance(tooling, dict)
        or tooling != {}
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
            reason="exact reviewed PodVoice106 current robot activity admission"
            if valid
            else "missing or invalid PodVoice106 current robot activity admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(
            report, passed=False, reason="malformed PodVoice106 current robot activity admission"
        )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print(
            "candidate admission stopped: PV106 exact-review bindings are incomplete",
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
