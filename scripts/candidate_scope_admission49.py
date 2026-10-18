#!/usr/bin/env python3
"""Strict49 admission remains closed until independent review bindings are present."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission48 as previous
except ModuleNotFoundError:
    import candidate_scope_admission48 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "d6c1cfe7c761a80056771af5f9ccccbc1fdd2437"
KIND = "podview49_locality_lifecycle"
VERSION = 26
ASSET_COUNT = 143
MAX_ASSET_TOTAL_BYTES = 18 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission49.py"
MANIFEST = "scripts/podview49-admission-reviewed.json"
RECORD_MARKER = "<!-- podview49-admission"
STATIC = previous.STATIC
CONFIG = frozenset({"podvoice/config.yaml", "podvoice/gatekeeper/__init__.py", "pyproject.toml"})
POLICY = frozenset(
    {
        PROFILE,
        MANIFEST,
        "scripts/dev_cycle.py",
        ".github/workflows/ci.yml",
    }
)
TOOLING = previous.TOOLING | frozenset(
    {"scripts/browser_gate.py", "docs/component-library-registry.json"}
)
FIELDS = previous.FIELDS

DOMAINS = ("unclassified_runtime",)  # Derived from the exact published48-to49 delta.
# Exact reviewed locality lifecycle and display-validity delta.
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/static/podview/weather-observation.js",
        "podvoice/gatekeeper/tools.py",
        "podvoice/gatekeeper/podview_locality.py",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/unit/test_candidate_scope_admission49.py",
        "tests/unit/test_candidate_scope_admission48.py",
        "tests/unit/test_locality_lifecycle.py",
        "tests/unit/test_locality_backend.py",
        "tests/unit/test_dev_cycle.py",
        "tests/podview/canonical-next-weather-view.test.mjs",
    }
)
HA_RUNTIME = previous.HA_RUNTIME
# Signature bindings remain closed until independent PV49 review.
REVIEWER = (
    "Independent /root/astra_robot_component_unification NEXT49 source and admission draft review"
)
MANIFEST_SHA = "c087ffe4b87fa92b6bc20c7dbf6780572ffd3f51bea1cf1186277371e0f8ce04"
PROFILE_AST = "5b0f89ef4bc084ce200e24c3fd271d6cf0fc99c7974561be8871c028c06991b0"
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission48.py": "e29b777d6cda56264ab9c27c8fcc25f2049e34000ff01a7a5d4bae21101c218a",
    "scripts/podview48-admission-reviewed.json": "30200037226c4161dc40d57b5b685266f4a15d7a64a0eed84ffd63f4cd89fd5c",
}


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodVoice49 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodVoice49 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodVoice49 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Only the existing add-on version trio changes to49."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.49"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.49"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.49"'),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match49(root: Path, runtime: dict, count: object) -> bool:
    """Retain the reviewed 143-file inventory and strict 18 MiB asset cap."""
    return previous.assets_match48(root, runtime, count)


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
        or manifest["schema"] != "podvoice49.admission.v1"
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
        or not assets_match49(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodVoice49 admission"
            if valid
            else "missing or invalid PodVoice49 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodVoice49 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print("candidate admission stopped: PV49 review bindings are not complete", file=sys.stderr)
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
