#!/usr/bin/env python3
"""Strict43 admission remains closed until independent review bindings are present."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission41 as previous
except ModuleNotFoundError:
    import candidate_scope_admission41 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "4f183f19689fcf87f90d26c6a14a8e6e153d93c1"
KIND = "podview43_visual_followup"
VERSION = 20
ASSET_COUNT = 143
MAX_ASSET_TOTAL_BYTES = 18 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission43.py"
MANIFEST = "scripts/podview43-admission-reviewed.json"
RECORD_MARKER = "<!-- podview43-admission"
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
TOOLING = previous.TOOLING | frozenset({"scripts/browser_gate.py"})
FIELDS = previous.FIELDS

DOMAINS = ("physical_output",)  # Derived from exact CI157-merge-to-43 candidate diff.
# Exact runtime files from the reviewed three-asset visual delta plus its generated manifest.
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/podview_music_control.py",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
        "podvoice/gatekeeper/static/podview/ui/library/library.css",
        "podvoice/gatekeeper/static/podview/widget-redesign.css",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/integration/test_podview_music_control.py",
        "tests/podview/root-live-control-view.test.mjs",
        "tests/unit/test_candidate_scope_admission43.py",
        "tests/unit/test_ci_scope.py",
        "tests/unit/test_dev_cycle.py",
    }
)
HA_RUNTIME = previous.HA_RUNTIME
# Base, review, manifest and AST bindings remain unset until actual CI157 merge and review.
REVIEWER = "Independent /root/release_readiness PV43 composition and exact-tree admission review"
MANIFEST_SHA = "2b6717271a3ac90d3a6687a12784a07715dcc8d1ee6072569c7877aca61a9b52"
PROFILE_AST = "8e9485c3ac1b513b3d2f988c59ce9579899aeaba0b12b32320d98c51ca313f08"
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission41.py": "4fb7e3fa5b8bc876cc286b804cd1e7a6cd3b2059d2980e2a8cdf6834d6d06395",
    "scripts/podview41-admission-reviewed.json": "d496c074b3787057371b95d62eae8e85bd4a4071c807477f345db3fa77ae8b43",
    "scripts/candidate_scope_admission42.py": "9a3766f4d69867b720e927a7e637c6d813041f0b0fdbe425e9e4245dccd51c6c",
    "scripts/podview42-admission-reviewed.json": "7eb9c88dacf75c78509dc05ea58e5cdb77cfdedecbe1888f54458bfedc662150",
}


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodVoice43 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodVoice43 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodVoice43 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Only the existing add-on version trio changes to43."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.43"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.43"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.43"'),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match43(root: Path, runtime: dict, count: object) -> bool:
    """Keep strict asset checks with an 18 MiB cap for the reviewed 143-file UI."""
    if type(count) is not int or count != ASSET_COUNT:
        return False
    assets = {p for p in strict.runtime_inventory(root) if p.startswith(STATIC)}
    if len(assets) != count + 1:
        return False
    data = json.loads(
        safe_file(root, STATIC + "asset-manifest.json"),
        object_pairs_hook=legacy._unique_record,
    )
    if set(data) != {"schema", "files"} or data["schema"] != "podview.assets.v1":
        return False
    rows = data["files"]
    if not isinstance(rows, list) or len(rows) != count:
        return False
    names = set()
    for row in rows:
        if (
            not isinstance(row, dict)
            or set(row) != {"path", "sha256"}
            or not isinstance(row["path"], str)
        ):
            return False
        name = STATIC + row["path"]
        if name in names or runtime.get(name) != row["sha256"]:
            return False
        safe_file(root, name)
        names.add(name)
    return (
        names == assets - {STATIC + "asset-manifest.json"}
        and all(len(safe_file(root, p)) <= 4 * 1024 * 1024 for p in assets)
        and sum(len(safe_file(root, p)) for p in assets) <= MAX_ASSET_TOTAL_BYTES
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
        or manifest["schema"] != "podvoice43.admission.v1"
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
        or not assets_match43(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodVoice43 admission"
            if valid
            else "missing or invalid PodVoice43 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodVoice43 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print("candidate admission stopped: PV43 review bindings are not complete", file=sys.stderr)
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
