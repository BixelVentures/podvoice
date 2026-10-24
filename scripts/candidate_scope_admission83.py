#!/usr/bin/env python3
"""Exact83 admission stays closed until final source and independent review bind it."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission82 as previous
except ModuleNotFoundError:
    import candidate_scope_admission82 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "8884c78573384c436bfa0287c135d584fd929ce8"
KIND = "podview83_music_service"
VERSION = 60
ASSET_COUNT = 203
MAX_ASSET_TOTAL_BYTES = 34 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission83.py"
MANIFEST = "scripts/podview83-admission-reviewed.json"
RECORD_MARKER = "<!-- podview83-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG
POLICY = previous.POLICY | frozenset({PROFILE, MANIFEST})
TOOLING = previous.TOOLING | frozenset(
    {
        "docs/qa-ui22/THREE-CYCLE-ACCEPTANCE-20261024.md",
        "docs/qa-music-remote-20261024/screenshots/night-final-library-stale.jpg",
        "docs/UI-DELIVERY-GOAL.md",
        "docs/qa-music-remote-20261024/screenshots/night-final-library-paused.jpg",
        "docs/qa-music-remote-20261024/screenshots/night-final-unconfirmed-1280.jpg",
        "docs/qa-music-remote-20261024/screenshots/night-final-confirmed-1280.jpg",
        "docs/qa-music-remote-20261024/MUSIC-REMOTE-PINS.json",
        "docs/qa-music-remote-20261024/screenshots/night-final-alias-paused-980.jpg",
        "docs/qa-ui22/FEEDBACK-EVIDENCE.md",
        "docs/qa-music-remote-20261024/HANDOFF.md",
        "docs/qa-ui22/NIGHT-MUSIC-REMOTE-UI-20261024.md",
        "docs/qa-music-remote-20261024/screenshots/night-final-expired-volume-980.jpg",
        "docs/qa-ui22/CONTROL-READINESS-20261024.md",
        "docs/qa-music-remote-20261024/SYNTAX.log",
        "docs/qa-ui22/feedback-status.json",
        "docs/qa-music-remote-20261024/TESTS.log",
        "docs/qa-ui22/FEEDBACK-COUNT.md",
        "docs/qa-music-remote-20261024/NIGHT-MUSIC-REMOTE-UI-20261024.md",
        "docs/qa-ui22/NIGHT-MUSIC-REMOTE-20261024.md",
        "docs/qa-music-remote-20261024/screenshots/night-final-pending-1280.jpg",
        "scripts/music-remote-night-fixture.mjs",
    }
)
FIELDS = previous.FIELDS

# Inventory is derived from the reviewed83 composition and exact diff against BASE.
# Blank review bindings deliberately cannot admit this prepared candidate.
DOMAINS = ("ha_tools", "physical_output")
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/static/podview/speaker-output-view.js",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/live-music-selection-view.js",
        "podvoice/gatekeeper/podview_controls.py",
        "podvoice/gatekeeper/static/podview/live-media-view.js",
        "podvoice/gatekeeper/static/podview/podview.bundle.js",
        "podvoice/gatekeeper/podview_room_media.py",
        "podvoice/gatekeeper/static/podview/player-view.js",
        "podvoice/gatekeeper/podview_music_selection.py",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/podview/canonical-next-room-media-binding.test.mjs",
        "tests/integration/test_podview_music_disconnect.py",
        "tests/podview/transport-recovery.test.mjs",
        "tests/unit/test_dev_cycle.py",
        "tests/podview/root-player-view.test.mjs",
        "tests/podview/root-speaker-output-view.test.mjs",
        "tests/podview/canonical-next-player-view.test.mjs",
        "tests/podview/canonical-packet-player-view.test.mjs",
        "tests/unit/test_candidate_scope_admission82.py",
        "tests/podview/root-room-media-binding.test.mjs",
        "tests/integration/test_podview_controls.py",
        "tests/podview/root-live-media-view.test.mjs",
        "tests/podview/root-named-controller-enrollment.test.mjs",
        "tests/podview/canonical-next-transport-recovery.test.mjs",
        "tests/integration/test_podview_idle_destination.py",
        "tests/podview/canonical-next-live-media-view.test.mjs",
        "tests/podview/root-collection-selection.test.mjs",
        "tests/integration/test_podview_music_selection.py",
        "tests/podview/root-native-music-controls.test.mjs",
        "tests/podview/root-transport-recovery.test.mjs",
        "tests/podview/canonical-next-collection-selection.test.mjs",
        "tests/unit/test_candidate_scope_admission83.py",
        "tests/podview/canonical-next-native-music-controls.test.mjs",
        "tests/podview/canonical-next-player-view-source.test.mjs",
    }
)

HA_RUNTIME = previous.HA_RUNTIME
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission82.py": "f6fcc6b2eaa7e61b14943b5333ab9a72c060cb6a625d4fb413715fc16b586cfa",
    "scripts/podview82-admission-reviewed.json": "b8008af9444b7e2cfdccc87f931543fd053c1ca3f601ec930ec1b498ac5c4f42",
}

# Closed until independent exact-tree review binds the final candidate.
REVIEWER = "/root/sol61_release75_review"
MANIFEST_SHA = "9c94fe0c6737412be5c4856bafffd0b71ea1b2d51ef107e4ef0e6a1da761c610"
PROFILE_AST = "aaf81f42d2e1d40c0cd793bbbd552de839cf75752a2d1122606d6b6cf7b74bbe"


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodView83 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodView83 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodView83 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Exact add-on83 trio and separately delivered HA component0.1.6 metadata."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.83"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.83"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.83"'),
            (
                "custom_components/podvoice/manifest.json",
                r'^  "version": "[^"\n]+",$',
                '  "version": "0.1.6",',
            ),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match83(root: Path, runtime: dict, count: object) -> bool:
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
        or manifest["schema"] != "podview83.admission.v1"
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
        or not assets_match83(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodView83 admission"
            if valid
            else "missing or invalid PodView83 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodView83 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print("candidate admission stopped: PV83 review bindings are not complete", file=sys.stderr)
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
