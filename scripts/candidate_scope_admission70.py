#!/usr/bin/env python3
"""Strict70 admission remains closed until independent review bindings are present."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission56 as asset_contract
    from scripts import candidate_scope_admission69 as previous
except ModuleNotFoundError:
    import candidate_scope_admission56 as asset_contract
    import candidate_scope_admission69 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "d21c267817ce6744dfd59efeafb13a186f5fb78d"
KIND = "podvoice70_idle_preclose_input_boundary"
VERSION = 47
ASSET_COUNT = 143
MAX_ASSET_TOTAL_BYTES = 18 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission70.py"
MANIFEST = "scripts/podview70-admission-reviewed.json"
RECORD_MARKER = "<!-- podview70-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG | frozenset({"custom_components/podvoice/manifest.json"})
POLICY = previous.POLICY | frozenset({PROFILE, MANIFEST})
TOOLING = previous.TOOLING | frozenset(
    {
        "AGENTS.md",
        "CLAUDE.md",
        "docs/AGENTKONTRAKT.md",
        "docs/ARKITEKTUR.md",
        "docs/INVARIANTER.md",
        "docs/MOTION.md",
    }
)
FIELDS = previous.FIELDS

DOMAINS = ("realtime_semantics",)
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/thin.py",
        "podvoice/gatekeeper/live_prompt.py",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/integration/test_thin_live_resumed_input_preclose.py",
        "tests/integration/test_thin_timer_end_to_end.py",
        "tests/unit/test_live_prompt.py",
        "tests/unit/test_candidate_scope_admission70.py",
        "tests/unit/test_candidate_scope_admission69.py",
    }
)
ASSET_CHANGES = frozenset()

HA_RUNTIME = previous.HA_RUNTIME
# Independent final contextual-completion SOURCE GO; provider and delivery remain separate.
REVIEWER = "/root/review70"
MANIFEST_SHA = "3b68ba07bc706fca818c37666b805411a1066b128a8ebeaa0c7070afc854c9d7"
PROFILE_AST = "b52198f66ff4953e2f523b20e55a80ccc3e3924f283869722de2fb9fdd11ce08"
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission69.py": "f56897091a633ae82f39fa7702f6be49f0733b2d2e01393bdac58e87670799dc",
    "scripts/podview69-admission-reviewed.json": "13f6e113a2d12b74a1ebcd599eec38d06f280f6054d2b7ad3db290f173fd3e00",
}


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodVoice70 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodVoice70 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodVoice70 record must be an object")
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
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.70"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.70"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.70"'),
            (
                "custom_components/podvoice/manifest.json",
                r'^  "version": "[^"\n]+",$',
                '  "version": "0.1.5",',
            ),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match70(root: Path, runtime: dict, count: object) -> bool:
    """Keep strict 143-file/18 MiB checks; all UI assets remain byte-identical to69."""
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
        or manifest["schema"] != "podvoice70.admission.v1"
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
        or not assets_match70(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodVoice70 admission"
            if valid
            else "missing or invalid PodVoice70 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodVoice70 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print("candidate admission stopped: PV70 review bindings are not complete", file=sys.stderr)
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
