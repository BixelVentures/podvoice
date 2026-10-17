#!/usr/bin/env python3
"""Exact additive39 admission for HA-approved persistent browser profiles."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission38 as previous
except ModuleNotFoundError:
    import candidate_scope_admission38 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "f0e3d62a5677050d2373f691a61cd733b3dd5be6"
KIND = "podvoice39_ha_approved_persistent_browser_profiles"
VERSION = 16
PROFILE = "scripts/candidate_scope_admission39.py"
MANIFEST = "scripts/podview39-admission-reviewed.json"
RECORD_MARKER = "<!-- podview39-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG | frozenset({"custom_components/podvoice/manifest.json"})
POLICY = frozenset(
    {PROFILE, MANIFEST, "scripts/dev_cycle.py", ".github/workflows/ci.yml", "AGENTS.md"}
)
TOOLING = previous.TOOLING
FIELDS = previous.FIELDS

DOMAINS = ("ha_tools",)
PRODUCTION = frozenset(
    {
        "custom_components/podvoice/__init__.py",
        "custom_components/podvoice/config_flow.py",
        "custom_components/podvoice/controller_admin.py",
        "custom_components/podvoice/services.yaml",
        "custom_components/podvoice/strings.json",
        "custom_components/podvoice/translations/da.json",
        "custom_components/podvoice/translations/en.json",
        "podvoice/gatekeeper/__main__.py",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/podview_admin_transport.py",
        "podvoice/gatekeeper/podview_continuity.py",
        "podvoice/gatekeeper/podview_controller_admin.py",
        "podvoice/gatekeeper/podview_controls.py",
        "podvoice/gatekeeper/podview_music_selection.py",
        "podvoice/gatekeeper/podview_queue.py",
        "podvoice/gatekeeper/podview_speakers.py",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/podvoice-transport.js",
        "podvoice/gatekeeper/static/podview/setup.html",
        "podvoice/gatekeeper/static/podview/setup.js",
    }
)
HA_RUNTIME = previous.HA_RUNTIME
REQUIRED_TESTS = frozenset(
    {
        "tests/ha_framework/test_controller_admin_services.py",
        "tests/integration/test_podview_admin_provision.py",
        "tests/integration/test_podview_controller_continuity.py",
        "tests/integration/test_podview_device_approval.py",
        "tests/integration/test_podview_music_selection.py",
        "tests/integration/test_podview_room_move_voice.py",
        "tests/unit/test_ha_controller_admin.py",
        "tests/unit/test_ha_controller_registration.py",
        "tests/unit/test_candidate_scope_admission38.py",
        "tests/unit/test_candidate_scope_admission39.py",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_ci_scope.py",
    }
)
# Lead fills approval only after an independent review of the final composition.
REVIEWER = "Independent /root/profiles_owner_review source and /root/controller_registry_review admission39"
MANIFEST_SHA = "6952f3a8dd3d19141a50c59900df78d5b6bc1e65de93bc7e03d904e1f3d8f434"
PROFILE_AST = "db8e57b5e71de2da13af3789cf8ca76ec7e33ca7290a2182d7d086fec085aa54"
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission38.py": "7463aa9eefebc509d7b23b321e08d747b6b18e35e640e09f9a5091a72ee62c8d",
    "scripts/podview38-admission-reviewed.json": "6d302077ce3c3152c029073b0d318d151dd15990b62795a41fab266bc46a99f0",
}


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodVoice39 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodVoice39 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodVoice39 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Only the existing version trio and HA integration package version change."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.39"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.39"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.39"'),
            (
                "custom_components/podvoice/manifest.json",
                r'^  "version": "[^"\n]+",$',
                '  "version": "0.1.3",',
            ),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def production_scope_matches(effective: set[str]) -> bool:
    actual = {p for p in effective if p.startswith(legacy._PRODUCTION_PREFIXES)}
    return (
        actual
        - {
            "podvoice/gatekeeper/__init__.py",
            "custom_components/podvoice/manifest.json",
        }
        == PRODUCTION
    )


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
        or manifest["schema"] != "podvoice39.admission.v1"
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
            reason="exact reviewed PodVoice39 admission"
            if valid
            else "missing or invalid PodVoice39 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodVoice39 admission")


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
