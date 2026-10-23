#!/usr/bin/env python3
"""Exact78 admission stays closed until final source and independent review bind it."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission77 as previous
except ModuleNotFoundError:
    import candidate_scope_admission77 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "a537077b0ecb31a9def0759cf5a5c44873f0ec85"
KIND = "podview78_basic_flows"
VERSION = 55
ASSET_COUNT = 203
MAX_ASSET_TOTAL_BYTES = 34 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission78.py"
MANIFEST = "scripts/podview78-admission-reviewed.json"
RECORD_MARKER = "<!-- podview78-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG
POLICY = previous.POLICY | frozenset({PROFILE, MANIFEST})
TOOLING = previous.TOOLING | frozenset(
    {
        "docs/qa-ui78/BASIC-FLOW-FROZEN-HANDOFF.md",
        "docs/qa-ui78/BASIC-FLOW-SOURCE-PINS.json",
        "docs/qa-ui78/BASIC-NATIVE-FLOWS-METADATA.json",
        "docs/qa-ui78/BASIC-NATIVE-FLOWS-REVIEW.md",
        "docs/qa-ui78/screenshots/basic-robot-corrected-footer.jpg",
        "docs/qa-ui78/screenshots/basic-robot-corrected-rooms.jpg",
        "docs/qa-ui78/screenshots/basic-robot-library-corrected.jpg",
        "docs/qa-ui78/screenshots/basic-robot-reopen-pending.jpg",
        "docs/qa-ui78/screenshots/basic-speakers-error-final.jpg",
        "docs/qa-ui78/screenshots/basic-speakers-expired-final.jpg",
        "docs/qa-ui78/screenshots/basic-speakers-ready.jpg",
        "docs/qa-ui78/screenshots/basic-speakers-recovered-final.jpg",
        "docs/qa-ui78/screenshots/basic-speakers-retained-refresh.jpg",
        "docs/qa-ui78/screenshots/basic-top-first.jpg",
        "docs/qa-ui78/screenshots/basic-top-second.jpg",
        "scripts/artwork-diagnostic.mjs",
        "scripts/basic-flow-diagnostic.mjs",
    }
)
FIELDS = previous.FIELDS

# Inventory is derived from immutable UI78 and the exact diff against BASE.
# Blank review bindings deliberately cannot admit this prepared candidate.
DOMAINS = ("ha_tools", "physical_output")
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/podview_weather_advice.py",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
        "podvoice/gatekeeper/static/podview/live-music-view.js",
        "podvoice/gatekeeper/static/podview/music-recommendation-model.js",
        "podvoice/gatekeeper/static/podview/podview.bundle.js",
        "podvoice/gatekeeper/static/podview/podview.css",
        "podvoice/gatekeeper/static/podview/robot-control-panel.js",
        "podvoice/gatekeeper/static/podview/speaker-output-view.js",
        "podvoice/gatekeeper/static/podview/ui-kit.css",
        "podvoice/gatekeeper/static/podview/ui/components.css",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/podview/canonical-next-robot-control-panel.test.mjs",
        "tests/podview/canonical-next-transport-recovery.test.mjs",
        "tests/podview/canonical-packet-robot-control-panel.test.mjs",
        "tests/podview/root-account-playlists-catalogue.test.mjs",
        "tests/podview/root-artwork-diagnostic-fixture.test.mjs",
        "tests/podview/root-basic-flow-diagnostic.test.mjs",
        "tests/podview/root-component-library.test.mjs",
        "tests/podview/root-configured-speaker-label.test.mjs",
        "tests/podview/root-music-recommendation-model.test.mjs",
        "tests/podview/root-robot-control-panel.test.mjs",
        "tests/podview/root-speaker-output-view.test.mjs",
        "tests/podview/root-transport-recovery.test.mjs",
        "tests/podview/transport-recovery.test.mjs",
        "tests/unit/test_candidate_scope_admission77.py",
        "tests/unit/test_candidate_scope_admission78.py",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_passive_weather_advice.py",
    }
)

HA_RUNTIME = previous.HA_RUNTIME
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission77.py": "d91c6b2eaae881f36ce8062bd94c8a4facc2929cebd77a740203401dd993db28",
    "scripts/podview77-admission-reviewed.json": "357d19d343fa3422bdd99d8b5958e95562543b2df1f389060a8bae6c639461a1",
}


# Closed until independent exact-tree review binds the final candidate.
REVIEWER = "/root/sol61_release75_review"
MANIFEST_SHA = "d574ac689d1cbce82335f3ff99d2d87e245aa19fa229fd477e16c9d2abf284bc"
PROFILE_AST = "ca61e5f67bacd5b10badd56a1857c22adc809dd57eceb843479a2a9ad732a56e"


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodView78 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodView78 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodView78 record must be an object")
    return record


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
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.78"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.78"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.78"'),
            (
                "custom_components/podvoice/manifest.json",
                r'^  "version": "[^"\n]+",$',
                '  "version": "0.1.5",',
            ),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match78(root: Path, runtime: dict, count: object) -> bool:
    """Exact canonical203 asset inventory; path/hash/byte ceiling are fail closed."""
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
        or manifest["schema"] != "podview78.admission.v1"
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
        or not assets_match78(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodView78 admission"
            if valid
            else "missing or invalid PodView78 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodView78 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print("candidate admission stopped: PV76 review bindings are not complete", file=sys.stderr)
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
