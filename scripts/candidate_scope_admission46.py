#!/usr/bin/env python3
"""Strict46 admission remains closed until independent review bindings are present."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission45 as previous
except ModuleNotFoundError:
    import candidate_scope_admission45 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "e5e9ec495061e6b3f97f6555a28dafecdeceed3f"
KIND = "podview46_visual_followup"
VERSION = 23
ASSET_COUNT = 143
MAX_ASSET_TOTAL_BYTES = 18 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission46.py"
MANIFEST = "scripts/podview46-admission-reviewed.json"
RECORD_MARKER = "<!-- podview46-admission"
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

DOMAINS = ("physical_output",)  # Derived from legacy.inspect_repository on the exact45-to-46 diff.
# Exact two changed canonical UI modules plus their generated manifest.
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/static/podview/podvoice-transport.js",
        "podvoice/gatekeeper/static/podview/widget-view.js",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/podview/account-visibility.test.mjs",
        "tests/podview/controller-peer-recovery.test.mjs",
        "tests/podview/canonical-next-four-music-tabs.test.mjs",
        "tests/podview/canonical-next-music-selection.test.mjs",
        "tests/podview/music-selection.test.mjs",
        "tests/podview/root-music-selection.test.mjs",
        "tests/podview/root-speaker-output-view.test.mjs",
        "tests/unit/test_candidate_scope_admission45.py",
        "tests/unit/test_candidate_scope_admission46.py",
        "tests/unit/test_dev_cycle.py",
    }
)
HA_RUNTIME = previous.HA_RUNTIME
# Signature bindings remain closed until independent PV46 review.
REVIEWER = "Independent /root/release_readiness PV46 exact composition and admission review"
MANIFEST_SHA = "21d21579bae3371aa47ba7a33c8b3601bf7468dfb701a5e7f22f0e4c9ebd57bc"
PROFILE_AST = "b8ef7204eabbdd282d9a6c73dd06ea9c5ceed018d4b246f8f4939a585d57b254"
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission45.py": "303549ffaa4eb9933e6eafaaca1c2b7db430fde6b2d539dd50f990b66f9d6c85",
    "scripts/podview45-admission-reviewed.json": "dce344d42c30ad600942875f5bb0f5baf82c74e948cf4705a6b95c9cd0ba9fb9",
    "scripts/candidate_scope_admission44.py": "33c4acd2767e899014b12e923a3ed7423695d11f5433577252dd3ffb66e4999d",
    "scripts/podview44-admission-reviewed.json": "12defc84efc96dc6137a4b548f873f6cd748b2d3903209374d83215160e0002b",
    "scripts/candidate_scope_admission41.py": "4fb7e3fa5b8bc876cc286b804cd1e7a6cd3b2059d2980e2a8cdf6834d6d06395",
    "scripts/podview41-admission-reviewed.json": "d496c074b3787057371b95d62eae8e85bd4a4071c807477f345db3fa77ae8b43",
    "scripts/candidate_scope_admission42.py": "9a3766f4d69867b720e927a7e637c6d813041f0b0fdbe425e9e4245dccd51c6c",
    "scripts/podview42-admission-reviewed.json": "7eb9c88dacf75c78509dc05ea58e5cdb77cfdedecbe1888f54458bfedc662150",
    "scripts/candidate_scope_admission43.py": "68fc7ca46890e3f58cfc95850b95a3dc62d8651aafe50a4f722ae346d66631ae",
    "scripts/podview43-admission-reviewed.json": "cd55dc02e51116eed0bc19f5209174cad2d523495b28a0273aa916b91022cb54",
}


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodVoice46 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodVoice46 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodVoice46 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Only the existing add-on version trio changes to46."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.46"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.46"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.46"'),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match46(root: Path, runtime: dict, count: object) -> bool:
    """Retain the reviewed 143-file inventory and strict 18 MiB asset cap."""
    return previous.assets_match45(root, runtime, count)


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
        or manifest["schema"] != "podvoice46.admission.v1"
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
        or not assets_match46(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodVoice46 admission"
            if valid
            else "missing or invalid PodVoice46 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodVoice46 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print("candidate admission stopped: PV46 review bindings are not complete", file=sys.stderr)
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
