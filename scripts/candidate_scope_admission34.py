#!/usr/bin/env python3
"""Exact additive PodView34 navigation admission; unreviewed pins reject."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission33 as previous
except ModuleNotFoundError:
    import candidate_scope_admission33 as previous

legacy = previous.legacy
sha = previous.sha
safe_file = previous.safe_file
BASE = "8e7ff9bc9aaaf298a23c93e53bed90c672558b25"
KIND = "podview34_pairing_navigation_only"
VERSION = 9
PROFILE = "scripts/candidate_scope_admission34.py"
MANIFEST = "scripts/podview34-admission-reviewed.json"
RECORD_MARKER = "<!-- podview34-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG
POLICY = frozenset({PROFILE, MANIFEST, "scripts/dev_cycle.py", ".github/workflows/ci.yml"})
TOOLING = previous.TOOLING
FIELDS = previous.FIELDS

# Independent review fills these only after the final combined diff is frozen.
# Blank pins always reject, including when an old approval record is present.
DOMAINS = ("unclassified_runtime",)
PRODUCTION = frozenset({"podvoice/gatekeeper/static/index.html"})
REQUIRED_TESTS = frozenset(
    {
        "tests/integration/test_podview_pairing_navigation.py",
        "tests/unit/test_candidate_scope_admission34.py",
        "tests/unit/test_dev_cycle.py",
    }
)
REVIEWER = "Independent Codex /root/review34; exact34 source, admission, and artifact review"
MANIFEST_SHA = "35b97bcbf4578504360a9be40210444a1fd4d0df27067283882e4b121d738d2f"
PROFILE_AST = "d5d7916be7d198c3729e4fe39dc5d5110e318424d08cbed7b5d30c8af4243990"
IMMUTABLE: dict[str, str] = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission33.py": "711fe322bbc49d77e86f16f6731db288b799d5d92a979dca76e39250587a9dde",
    "scripts/podview33-admission-reviewed.json": "3ac03a9cfc7d3befa074e732f76764005a463624f24551314282b54204c733a6",
    "tests/unit/test_candidate_scope_admission33.py": "58ad4d9c3b71d288ea6dd3c7c1fe6faac99b8ab3666cbf7835e3e40a76a97489",
}


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodView34 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodView34 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodView34 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Only the three version strings may change from the published33 base."""
    return all(
        previous.previous.previous.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.34"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.34"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.34"'),
        )
    )


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
        or not previous.previous.previous.pins_match(root, IMMUTABLE)
        or previous.previous.previous.ast_sha(safe_file(root, PROFILE), "PROFILE_AST")
        != PROFILE_AST
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
        or manifest["schema"] != "podview34.admission.v1"
        or manifest["base"] != BASE
    ):
        return False
    prod, tests, runtime, config, policy, tooling = (
        manifest[k] for k in ("production", "regressions", "runtime", "config", "policy", "tooling")
    )
    if (
        not all(
            previous.previous.previous.pins_match(root, pins)
            for pins in (prod, tests, runtime, config, policy, tooling)
        )
        or set(prod) != PRODUCTION
        or set(tests) != REQUIRED_TESTS
        or set(config) != CONFIG
        or set(policy) != POLICY - {PROFILE, MANIFEST}
        or set(tooling) != TOOLING
        or set(runtime) != previous.previous.previous.runtime_inventory(root)
        or not set(prod) <= set(runtime)
        or any(not p.startswith("tests/") for p in tests)
        or not config_only(root)
        or not previous.previous.previous.assets_match(root, runtime, manifest["asset_count"])
    ):
        return False
    effective = legacy._visual_repository_changes(root, BASE)
    if (
        {p for p in effective if p.startswith(legacy._PRODUCTION_PREFIXES)}
        - {"podvoice/gatekeeper/__init__.py"}
        != PRODUCTION
        or {p for p in effective if p.startswith("tests/")} != set(tests)
        or not REQUIRED_TESTS <= effective
        or any(
            p not in PRODUCTION | set(tests) | POLICY | CONFIG | TOOLING | {"podvoice/CHANGELOG.md"}
            and p != "docs/STATUS.md"
            for p in effective
        )
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
        and record["runtime_fingerprint"] == previous.previous.previous.fingerprint(root, runtime)
        and record["config_fingerprint"] == previous.previous.previous.fingerprint(root, CONFIG)
        and record["policy_fingerprint"] == previous.previous.previous.fingerprint(root, POLICY)
        and record["tooling_fingerprint"] == previous.previous.previous.fingerprint(root, TOOLING)
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
            reason="exact reviewed PodView34 admission"
            if valid
            else "missing or invalid PodView34 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodView34 admission")


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
