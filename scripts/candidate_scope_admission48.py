#!/usr/bin/env python3
"""Strict48 admission remains closed until independent review bindings are present."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission47 as previous
except ModuleNotFoundError:
    import candidate_scope_admission47 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "8604704df3175b9b34acca654a92bfe0305437c0"
KIND = "podview48_delegated_presentation"
VERSION = 25
ASSET_COUNT = 143
MAX_ASSET_TOTAL_BYTES = 18 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission48.py"
MANIFEST = "scripts/podview48-admission-reviewed.json"
RECORD_MARKER = "<!-- podview48-admission"
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

DOMAINS = ("unclassified_runtime",)  # Derived from the exact published47-to48 delta.
# Exact delegated-presentation scheduling delta; no asset changes.
PRODUCTION = frozenset({"podvoice/gatekeeper/podview_receipts.py"})
REQUIRED_TESTS = frozenset(
    {
        "tests/podview/transport-recovery.test.mjs",
        "tests/unit/test_dev_cycle.py",
        "tests/integration/test_podview_receipt_hooks.py",
        "tests/integration/test_delegated_presentation_selector48.py",
        "tests/unit/test_candidate_scope_admission48.py",
        "tests/unit/test_candidate_scope_admission47.py",
    }
)
HA_RUNTIME = previous.HA_RUNTIME
# Signature bindings remain closed until independent PV48 review.
REVIEWER = "Independent /root/ui41_source_review NEXT48 CI672 fixture and binding review"
MANIFEST_SHA = "30200037226c4161dc40d57b5b685266f4a15d7a64a0eed84ffd63f4cd89fd5c"
PROFILE_AST = "0f9dcfcc7cf6bae140cd84c869a05024782b84d91d1dc539f57f0d38992cd1a3"
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission47.py": "217dccb6d6ed3c021ab5bdcf4ea8ae0967660d6823f027f14e7ce54e8ea65240",
    "scripts/podview47-admission-reviewed.json": "72c3b19ecfad538ae947334b9139be00eb83ba73d632b384a68e101bb68a8189",
}


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodVoice48 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodVoice48 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodVoice48 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Only the existing add-on version trio changes to48."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.48"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.48"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.48"'),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match48(root: Path, runtime: dict, count: object) -> bool:
    """Retain the reviewed 143-file inventory and strict 18 MiB asset cap."""
    return previous.assets_match47(root, runtime, count)


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
        or manifest["schema"] != "podvoice48.admission.v1"
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
        or not assets_match48(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodVoice48 admission"
            if valid
            else "missing or invalid PodVoice48 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodVoice48 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print("candidate admission stopped: PV48 review bindings are not complete", file=sys.stderr)
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
