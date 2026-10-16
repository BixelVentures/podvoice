#!/usr/bin/env python3
"""Rejecting PodView36 queue admission until exact composed source review."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission35 as previous
except ModuleNotFoundError:
    import candidate_scope_admission35 as previous

legacy = previous.legacy
strict = previous.strict  # PodView31 owns the inherited strict helpers.
sha = previous.sha
safe_file = previous.safe_file
BASE = "ed0fbc41d9ab2a9fcdbf0648d2ee0839abd1befd"
KIND = "podview36_exact_queue_occurrence"
VERSION = 11
PROFILE = "scripts/candidate_scope_admission36.py"
MANIFEST = "scripts/podview36-admission-reviewed.json"
RECORD_MARKER = "<!-- podview36-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG
POLICY = frozenset(
    {
        PROFILE,
        MANIFEST,
        "scripts/dev_cycle.py",
        ".github/workflows/ci.yml",
        "docs/COMPONENT-LIBRARY.md",
        "docs/component-library-registry.json",
    }
)
TOOLING = previous.TOOLING
FIELDS = previous.FIELDS

# Independent review fills these only after the final combined diff is frozen.
# Blank pins always reject, including when an old approval record is present.
DOMAINS = ("physical_output",)
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/podview_queue.py",
        "podvoice/gatekeeper/podview_queue_scope.py",
        "podvoice/gatekeeper/podview_music_control.py",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/integration/test_podview_room_queue.py",
        "tests/unit/test_podview_queue_scope.py",
        "tests/integration/test_podview_queue_occurrence.py",
        "tests/integration/test_queue_controller_boundary.py",
        "tests/unit/test_candidate_scope_admission36.py",
    }
)
REVIEWER = (
    "Independent GPT-6 Sol /root/queue_native_review; exact36 composed source/admission review"
)
MANIFEST_SHA = "3b38dc42d5390ab2b52f4d7aca36e39dfd818e02a468f79abfdfefda6b1fcfdf"
PROFILE_AST = "026511f27c32cc66d8a661f6dfbb8f89ce89b8e95c9406a1e9010b8c86b0f70e"
IMMUTABLE: dict[str, str] = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission35.py": "87e0973b4c460a1732f8f4b66767a73c03c4f473ede980359883f0206549e6c8",
    "scripts/podview35-admission-reviewed.json": "2261f8e95cba54c93f87a5e56227488789690a1b4b5ae01d2bda403cfc5dd4a3",
    "tests/unit/test_candidate_scope_admission35.py": "29a0d40f20255bfcbd0d02dbed22319c9436aa22d8818114b6dad975e7374943",
}
DELETED_PRODUCTION: dict[str, str] = {}


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodView36 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodView36 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodView36 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Only the three version strings may change from the published35 base."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.36"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.36"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.36"'),
        )
    )


def production_scope_matches(effective: set[str]) -> bool:
    actual = {p for p in effective if p.startswith(legacy._PRODUCTION_PREFIXES)}
    return actual - {"podvoice/gatekeeper/__init__.py"} == PRODUCTION


def change_scope_matches(effective: set[str], tests: set[str]) -> bool:
    allowed = (
        PRODUCTION
        | set(DELETED_PRODUCTION)
        | tests
        | POLICY
        | CONFIG
        | TOOLING
        | {"podvoice/CHANGELOG.md", "docs/STATUS.md"}
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
        or manifest["schema"] != "podview36.admission.v1"
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
        or set(runtime) != strict.runtime_inventory(root)
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
    report = previous.inspect_repository(root, base)
    try:
        record = record_at(root)
        base_tip = legacy._git(root, "rev-parse", f"{base}^{{commit}}").strip()
        valid = record is not None and validate(root, report, base_tip, record)
        return replace(
            report,
            passed=valid,
            reason="exact reviewed PodView36 admission"
            if valid
            else "missing or invalid PodView36 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodView36 admission")


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
