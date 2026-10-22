#!/usr/bin/env python3
"""Exact73 admission stays closed until final source and independent review bind it."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission72 as previous
except ModuleNotFoundError:
    import candidate_scope_admission72 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "c9b04906f7f3386ea404fbf5deca9011489936a1"
KIND = "podvoice73_live_native_talk_recovery"
VERSION = 50
ASSET_COUNT = 200
MAX_ASSET_TOTAL_BYTES = 34 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission73.py"
MANIFEST = "scripts/podvoice73-admission-reviewed.json"
RECORD_MARKER = "<!-- podvoice73-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG
POLICY = previous.POLICY | frozenset({PROFILE, MANIFEST})
TOOLING = previous.TOOLING | frozenset(
    {"AGENTS.md", "CLAUDE.md", "docs/AGENTKONTRAKT.md", "docs/MOTION.md"}
)
TOOLING = TOOLING | frozenset(
    {
        "scripts/build-assets.mjs",
        "scripts/build-scripts.mjs",
        "package.json",
        "package-lock.json",
        ".gitignore",
        "scripts/live_confirmation_eval.py",
        "scripts/live_semantic_completion_eval.py",
    }
)
TOOLING = TOOLING | frozenset(
    {
        "scripts/dev.mjs",
        "scripts/check-ui-palette.mjs",
        "scripts/check-ui-tokens.mjs",
        "docs/RADIO-LOGO-SOURCES.json",
        "docs/USER-DESIGN-ANSWERS-2026-10-20.json",
    }
)
TOOLING = TOOLING | frozenset(
    [
        "docs/COMPONENT-LIBRARY.md",
        "docs/RADIO-LOGO-SOURCES.json",
        "docs/USER-DESIGN-ANSWERS-2026-10-20.json",
        "docs/component-library-registry.json",
        "scripts/build-assets.mjs",
        "scripts/check-ui-palette.mjs",
        "scripts/check-ui-tokens.mjs",
        "scripts/dev.mjs",
        "scripts/live-fixture.mjs",
    ]
)
TOOLING = TOOLING | frozenset(
    [
        "docs/COMPONENT-LIBRARY.md",
        "docs/RADIO-LOGO-SOURCES.json",
        "docs/USER-DESIGN-ANSWERS-2026-10-20.json",
        "docs/component-library-registry.json",
        "scripts/build-assets.mjs",
        "scripts/check-ui-palette.mjs",
        "scripts/check-ui-tokens.mjs",
        "scripts/dev.mjs",
        "scripts/live-fixture.mjs",
    ]
)
TOOLING = TOOLING | frozenset(
    [
        "docs/COMPONENT-LIBRARY.md",
        "docs/RADIO-LOGO-SOURCES.json",
        "docs/USER-DESIGN-ANSWERS-2026-10-20.json",
        "docs/component-library-registry.json",
        "scripts/build-assets.mjs",
        "scripts/check-ui-palette.mjs",
        "scripts/check-ui-tokens.mjs",
        "scripts/dev.mjs",
        "scripts/live-fixture.mjs",
    ]
)
TOOLING = TOOLING | frozenset(
    [
        "docs/COMPONENT-LIBRARY.md",
        "docs/RADIO-LOGO-SOURCES.json",
        "docs/USER-DESIGN-ANSWERS-2026-10-20.json",
        "docs/component-library-registry.json",
        "scripts/build-assets.mjs",
        "scripts/check-ui-palette.mjs",
        "scripts/check-ui-tokens.mjs",
        "scripts/dev.mjs",
        "scripts/live-fixture.mjs",
    ]
)
FIELDS = previous.FIELDS

DOMAINS = ("physical_output",)  # Current exact diff classifier result; must match final candidate.
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/__main__.py",
        "podvoice/gatekeeper/constants.py",
        "podvoice/gatekeeper/talk.py",
        "podvoice/gatekeeper/thin.py",
        "podvoice/gatekeeper/tools.py",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/browser/talk_text_contract.cjs",
        "tests/firmware/idle_timer_output_test.cpp",
        "tests/integration/test_live_error_admission.py",
        "tests/integration/test_talk_webrtc.py",
        "tests/integration/test_thin_live.py",
        "tests/integration/test_thin_live_admission_trace.py",
        "tests/unit/test_podconnect_target_tools.py",
        "tests/unit/test_candidate_scope_admission73.py",
    }
)
HA_RUNTIME = previous.HA_RUNTIME
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission72.py": "ba4c54881b55565f830905dd2ec636cd447cbb70cea35065b6672a3ee2afbec3",
    "scripts/podview72-admission-reviewed.json": "4036107f7e1ec032f86958626cf492014fac273514e0136c322d5ce5d192595f",
}
REVIEWER = "/root/voice_closure_fix"
MANIFEST_SHA = "2ad1ab3429224796053f3d168158b160b274744be021b2db884c23b63153a092"
PROFILE_AST = "04a81c35c2ace2061abe76157fcac0069009446e71f67f06b07fd16a3a2031f2"


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodVoice73 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodVoice73 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodVoice73 record must be an object")
    return record


def _strip_cover_policy_option(source: str) -> str:
    """Admit only the two exact default-off option/schema pairs, never values/grants."""
    for key in ("podview_theme_art_policy", "podview_visual_grant"):
        option = f'  {key}: ""\n'
        schema = f'  {key}: "str?"\n'
        if source.count(option) != 1 or source.count(schema) != 1:
            return source
    for key in ("podview_theme_art_policy", "podview_visual_grant"):
        source = source.replace(f'  {key}: ""\n', "", 1)
        source = source.replace(f'  {key}: "str?"\n', "", 1)
    return source


def config_only(root: Path) -> bool:
    """Only the exact add-on version trio changes; HA integration remains0.1.5."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.73"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.73"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.73"'),
            (
                "custom_components/podvoice/manifest.json",
                r'^  "version": "[^"\n]+",$',
                '  "version": "0.1.5",',
            ),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match73(root: Path, runtime: dict, count: object) -> bool:
    """Exact canonical200 asset inventory; path/hash/byte ceiling are fail closed."""
    if type(count) is not int or count != ASSET_COUNT:
        return False
    raw = safe_file(root, STATIC + "asset-manifest.json")
    inventory = json.loads(raw, object_pairs_hook=legacy._unique_record)
    if set(inventory) != {"schema", "files"} or inventory["schema"] != "podview.assets.v1":
        return False
    rows = inventory["files"]
    if not isinstance(rows, list) or len(rows) != ASSET_COUNT:
        return False
    names = set()
    total = 0
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"path", "sha256"}:
            return False
        name = row["path"]
        if (
            not isinstance(name, str)
            or not name
            or name.startswith("/")
            or "\\" in name
            or any(part in {"", ".", ".."} for part in name.split("/"))
        ):
            return False
        full = STATIC + name
        if full in names or name == "asset-manifest.json":
            return False
        names.add(full)
        data = safe_file(root, full)
        total += len(data)
        if sha(data) != row["sha256"] or runtime.get(full) != row["sha256"]:
            return False
    assets = {name for name in runtime if name.startswith(STATIC)}
    return assets == names | {STATIC + "asset-manifest.json"} and total <= MAX_ASSET_TOTAL_BYTES


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
        or manifest["schema"] != "podvoice73.admission.v1"
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
        or not assets_match73(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodVoice73 admission"
            if valid
            else "missing or invalid PodVoice73 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodVoice73 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print("candidate admission stopped: PV73 review bindings are not complete", file=sys.stderr)
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
