#!/usr/bin/env python3
"""Strict53 admission remains closed until independent review bindings are present."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission52 as previous
except ModuleNotFoundError:
    import candidate_scope_admission52 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "16fb39d8f780ae9b2925163027974e4952424217"
KIND = "podview53_music_state_copy"
VERSION = 30
ASSET_COUNT = 143
MAX_ASSET_TOTAL_BYTES = 18 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission53.py"
MANIFEST = "scripts/podview53-admission-reviewed.json"
RECORD_MARKER = "<!-- podview53-admission"
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

DOMAINS = ("unclassified_runtime",)  # Derived from the exact published52-to53 delta.
# Exact reviewed canonical empty/offline music status copy.
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/widget-view.js",
        "podvoice/gatekeeper/static/podview/music-results.js",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/unit/test_candidate_scope_admission53.py",
        "tests/podview/canonical-next-widget-loading.test.mjs",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_candidate_scope_admission52.py",
    }
)
HA_RUNTIME = previous.HA_RUNTIME
# Signature bindings remain closed until independent PV53 review.
REVIEWER = (
    "Independent /root/astra_technical_assessment NEXT53 source and admission metadata review"
)
MANIFEST_SHA = "66413614f432689ef34cc8d5e03c803fb3590b8b608e15559a5209965acab877"
PROFILE_AST = "1458477d1e9e2fdcbb747ed0c579ea6c0fff6e0876be715841b0af45cccd3627"
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission52.py": "88cfac8fafe9d8dd9710fe7c5da45e2c2514df91ab67627f7e1a4ffb64697b2a",
    "scripts/podview52-admission-reviewed.json": "6d888b9c5317c66b60897b7f0198bc4faa6ef0b3ffb465ecd9873c281de067f0",
}


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodVoice53 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodVoice53 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodVoice53 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Only the existing add-on version trio changes to53."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.53"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.53"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.53"'),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match53(root: Path, runtime: dict, count: object) -> bool:
    """Retain the reviewed 143-file inventory and strict 18 MiB asset cap."""
    return previous.assets_match52(root, runtime, count)


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
        or manifest["schema"] != "podvoice53.admission.v1"
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
        or not assets_match53(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodVoice53 admission"
            if valid
            else "missing or invalid PodVoice53 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodVoice53 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print("candidate admission stopped: PV53 review bindings are not complete", file=sys.stderr)
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
