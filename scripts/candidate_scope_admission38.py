#!/usr/bin/env python3
"""Exact additive38 admission for authenticated HA timer reads."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission37 as previous
except ModuleNotFoundError:
    import candidate_scope_admission37 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "e4c2966197ac28aa6e86a0df55e7f461203df269"
KIND = "podvoice38_authenticated_timer_status_boot_binding"
VERSION = 15
PROFILE = "scripts/candidate_scope_admission38.py"
MANIFEST = "scripts/podview38-admission-reviewed.json"
RECORD_MARKER = "<!-- podview38-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG
POLICY = frozenset({PROFILE, MANIFEST, "scripts/dev_cycle.py", ".github/workflows/ci.yml"})
TOOLING = previous.TOOLING
FIELDS = previous.FIELDS

DOMAINS = ("physical_output",)
PRODUCTION = frozenset({"podvoice/gatekeeper/ha_timers.py", "podvoice/gatekeeper/thin.py"})
HA_RUNTIME = previous.HA_RUNTIME
REQUIRED_TESTS = frozenset(
    {
        "tests/integration/test_ha_timer_flow.py",
        "tests/integration/test_podview_controls.py",
        "tests/unit/test_candidate_scope_admission37.py",
        "tests/unit/test_candidate_scope_admission38.py",
        "tests/unit/test_dev_cycle.py",
    }
)
# Lead fills approval only after an independent review of the final composition.
REVIEWER = "Independent /root/attention_ci_review exact38 source/composition review"
MANIFEST_SHA = "6d302077ce3c3152c029073b0d318d151dd15990b62795a41fab266bc46a99f0"
PROFILE_AST = "3d9b026b98ec4cd5b0e9b449b27514439c5d8759b489ea26c1c926308f422acc"
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission37.py": "8f9798a1518cdbe9f5be35e8195f90362d856ed690562ed9b708807477e910cd",
    "scripts/podview37-admission-reviewed.json": "d28bdd64379387b041c2fb5ff6038f60793099520f15d298dcd6793cdfd39a90",
}


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodVoice38 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodVoice38 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodVoice38 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Only the existing version trio changes from published37 to38."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.38"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.38"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.38"'),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


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
        or manifest["schema"] != "podvoice38.admission.v1"
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
        or not strict.assets_match(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodVoice38 admission"
            if valid
            else "missing or invalid PodVoice38 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodVoice38 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
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
