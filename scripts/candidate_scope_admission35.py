#!/usr/bin/env python3
"""Rejecting PodView35 admission scaffold; lead must bind final exact scope."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission34 as previous
except ModuleNotFoundError:
    import candidate_scope_admission34 as previous

legacy = previous.legacy
sha = previous.sha
safe_file = previous.safe_file
BASE = "e4d19282aaa18ddc2d5d1f04b6c7de84c0823d8b"
KIND = "podview35_composed_candidate_pending"
VERSION = 10
PROFILE = "scripts/candidate_scope_admission35.py"
MANIFEST = "scripts/podview35-admission-reviewed.json"
RECORD_MARKER = "<!-- podview35-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG
POLICY = frozenset({PROFILE, MANIFEST, "scripts/dev_cycle.py", ".github/workflows/ci.yml"})
TOOLING = previous.TOOLING
FIELDS = previous.FIELDS

# Independent review fills these only after the final combined diff is frozen.
# Blank pins always reject, including when an old approval record is present.
DOMAINS = ()
PRODUCTION = frozenset()
REQUIRED_TESTS = frozenset({"tests/unit/test_candidate_scope_admission35.py"})
REVIEWER = ""
MANIFEST_SHA = ""
PROFILE_AST = ""
DELETED_PRODUCTION = {
    "podvoice/gatekeeper/static/podview/flow.html": "ffe2df29e9db0b99f1777ab17fdbecbfcd2099fb377375c7d7b865dbabf0c9d4",
    "podvoice/gatekeeper/static/podview/flow.js": "b462c8de356eac701f8ca0ab99db73353b9d31df6ceea8b24595ef3cd9e62e08",
    "podvoice/gatekeeper/static/podview/flow.css": "13058f93b1f5286da29761e88760424e869050549e9d0521457a5ecb70f04a6d",
}

IMMUTABLE: dict[str, str] = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission34.py": "f28d5cbec1bb9323f42f1e2f132044976e072f7849e3d4e9c8a66e0779dde305",
    "scripts/podview34-admission-reviewed.json": "35b97bcbf4578504360a9be40210444a1fd4d0df27067283882e4b121d738d2f",
    "tests/unit/test_candidate_scope_admission34.py": "e20c983bba02f70848b302e66fcb0da6a9e3d8fd5f8b924ddd8b1e8c8038f05a",
}


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodView35 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodView35 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodView35 record must be an object")
    return record


def config_yaml_only(before: str, after: str) -> bool:
    """Admit only version35 and the exact default-empty city setting/schema."""
    replacements = (
        ('version: "2.0.34"\n', 'version: "2.0.35"\n'),
        (
            '  podview_mood_setup_policy: ""\n',
            '  podview_mood_setup_policy: ""\n  podview_weather_city: ""\n',
        ),
        (
            '  podview_mood_setup_policy: "str?"\n',
            '  podview_mood_setup_policy: "str?"\n  podview_weather_city: "str?"\n',
        ),
    )
    for old, new in replacements:
        if before.count(old) != 1:
            return False
        before = before.replace(old, new, 1)
    return after == before


def config_only(root: Path) -> bool:
    """Bind the version trio and exact city addition to the published34 base."""
    if not config_yaml_only(
        legacy._git(root, "show", f"{BASE}:podvoice/config.yaml"),
        safe_file(root, "podvoice/config.yaml").decode(),
    ):
        return False
    return all(
        previous.previous.previous.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.35"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.35"'),
        )
    )


def deleted_production_matches(root: Path) -> bool:
    """Bind only the three reviewed no-flow removals to exact base bytes and absence."""
    if set(DELETED_PRODUCTION) != {
        "podvoice/gatekeeper/static/podview/flow.html",
        "podvoice/gatekeeper/static/podview/flow.js",
        "podvoice/gatekeeper/static/podview/flow.css",
    }:
        return False
    for name, expected in DELETED_PRODUCTION.items():
        if not isinstance(expected, str) or len(expected) != 64:
            return False
        try:
            base_bytes = legacy._git(root, "show", f"{BASE}:{name}").encode()
        except RuntimeError:
            return False
        if sha(base_bytes) != expected:
            return False
        path = root
        for part in name.split("/"):
            path /= part
            if path.is_symlink():
                return False
        if path.exists():
            return False
    return True


def production_scope_matches(effective: set[str]) -> bool:
    actual = {p for p in effective if p.startswith(legacy._PRODUCTION_PREFIXES)}
    expected = PRODUCTION | set(DELETED_PRODUCTION)
    return (
        not (PRODUCTION & set(DELETED_PRODUCTION))
        and actual - {"podvoice/gatekeeper/__init__.py"} == expected
        and set(DELETED_PRODUCTION) <= actual
    )


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
        or manifest["schema"] != "podview35.admission.v1"
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
        or not deleted_production_matches(root)
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
        if name not in DELETED_PRODUCTION:
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
            reason="exact reviewed PodView35 admission"
            if valid
            else "missing or invalid PodView35 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodView35 admission")


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
