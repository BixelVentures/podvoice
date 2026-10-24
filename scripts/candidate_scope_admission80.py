#!/usr/bin/env python3
"""Exact80 admission stays closed until final source and independent review bind it."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission79 as previous
except ModuleNotFoundError:
    import candidate_scope_admission79 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "dbd6949dcddce6487f04d89d4ef051213e6f4d35"
KIND = "podview80_actual_output_enrollment"
VERSION = 57
ASSET_COUNT = 203
MAX_ASSET_TOTAL_BYTES = 34 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission80.py"
MANIFEST = "scripts/podview80-admission-reviewed.json"
RECORD_MARKER = "<!-- podview80-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG
POLICY = previous.POLICY | frozenset({PROFILE, MANIFEST})
TOOLING = previous.TOOLING | frozenset(
    {
        "docs/MEDIA-OBSERVATION-CONTRACT-PROPOSAL.md",
        "docs/qa-actual-playback-20261024/ACTUAL-PLAYBACK-PINS.json",
        "docs/qa-actual-playback-20261024/HANDOFF.md",
        "docs/qa-actual-playback-20261024/TESTS.log",
        "docs/qa-actual-playback-20261024/UI-REVIEW.md",
        "docs/qa-enrollment-next/ENROLLMENT-AUTH-CLEANUP-ADDENDUM.md",
        "docs/qa-enrollment-next/ENROLLMENT-AUTH-HANDOFF.md",
        "docs/qa-enrollment-next/ENROLLMENT-AUTH-PINS.json",
        "docs/qa-enrollment-next/ENROLLMENT-COMBINED-HANDOFF.md",
        "docs/qa-enrollment-next/ENROLLMENT-COMBINED-PINS.json",
        "docs/qa-enrollment-next/ENROLLMENT-SETUP-UI.md",
        "docs/qa-enrollment-next/ENROLLMENT-WEATHER-BASE.json",
        "docs/qa-enrollment-next/QA-TESTS.log",
        "docs/qa-enrollment-next/SETUP-ENTRY-1280-GEOMETRY.json",
        "docs/qa-enrollment-next/SETUP-ENTRY-FIX-GEOMETRY.json",
        "docs/qa-enrollment-next/TESTS.log",
        "docs/qa-enrollment-next/marked-entry/ENROLLMENT-MARKED-ENTRY.md",
        "docs/qa-enrollment-next/marked-entry/ENROLLMENT-MARKED-PINS.json",
        "docs/qa-enrollment-next/marked-entry/HANDOFF.md",
        "docs/qa-enrollment-next/marked-entry/TESTS.log",
        "docs/qa-enrollment-next/marked-entry/screenshots/enrollment-marked-destination.jpg",
        "docs/qa-enrollment-next/marked-entry/screenshots/enrollment-marked-entry.jpg",
        "docs/qa-enrollment-next/screenshots/setup-after.jpg",
        "docs/qa-enrollment-next/screenshots/setup-before.jpg",
        "docs/qa-enrollment-next/screenshots/setup-entry-1280-scrolled.jpg",
        "docs/qa-enrollment-next/screenshots/setup-entry-1280-top.jpg",
        "docs/qa-enrollment-next/screenshots/setup-entry-destination.jpg",
        "docs/qa-enrollment-next/screenshots/setup-entry-fixed.jpg",
        "docs/qa-enrollment-next/screenshots/setup-entry.jpg",
        "docs/qa-enrollment-next/screenshots/setup-linked.jpg",
        "docs/qa-enrollment-next/screenshots/setup-pending.jpg",
        "docs/qa-recovery-20261024/ACTUAL-OUTPUT-CONTROLS-PINS.json",
        "docs/qa-recovery-20261024/ACTUAL-OUTPUT-CONTROLS.md",
        "docs/qa-recovery-20261024/CONNECTION.md",
        "docs/qa-recovery-20261024/INTEGRATED-CHECKPOINT.json",
        "docs/qa-recovery-20261024/INTEGRATED-RECOVERY.md",
        "docs/qa-ui22/MEDIA-V2-BROWSER-20261024.md",
        "docs/qa-ui22/NAVIGATION-RECOVERY-20261024.md",
        "docs/qa-ui22/PLAYER-OWNER-STATE-MAPPING-20261024.md",
        "docs/qa-ui22/screenshots/media-v2-account-1280.jpg",
        "docs/qa-ui22/screenshots/media-v2-final-account-1280.jpg",
        "docs/qa-ui22/screenshots/media-v2-final-alias-fixed-1280.jpg",
        "docs/qa-ui22/screenshots/media-v2-final-alias-fixed-980.jpg",
        "docs/qa-ui22/screenshots/media-v2-final-output-1280.jpg",
        "docs/qa-ui22/screenshots/media-v2-final-stale-980.jpg",
        "docs/qa-ui22/screenshots/media-v2-idle-1280.jpg",
        "docs/qa-ui22/screenshots/media-v2-library-paused.jpg",
        "docs/qa-ui22/screenshots/media-v2-library-stale.jpg",
        "docs/qa-ui22/screenshots/media-v2-offline-980.jpg",
        "docs/qa-ui22/screenshots/media-v2-playing-1280.jpg",
        "docs/qa-ui22/screenshots/media-v2-stale-detail-980.jpg",
        "docs/qa-ui22/screenshots/media-v2-unavailable-1280.jpg",
        "docs/qa-ui22/screenshots/navigation-final-offline-1280.jpg",
        "docs/qa-ui22/screenshots/navigation-final-offline-980.jpg",
        "docs/qa-ui22/screenshots/navigation-radio-offline-980.jpg",
        "docs/qa-ui22/screenshots/navigation-tesla-offline-1280.jpg",
        "docs/qa-ui22/screenshots/topbar-slots-connected-1280.jpg",
        "docs/qa-ui22/screenshots/topbar-slots-offline-1280.jpg",
        "docs/qa-ui22/screenshots/topbar-slots-offline-980.jpg",
        "scripts/enrollment-fixture.mjs",
        "scripts/media-v2-fixture.mjs",
        "scripts/navigation-recovery-fixture.mjs",
    }
)
FIELDS = previous.FIELDS

# Inventory is derived from immutable UI80 and the exact diff against BASE.
# Blank review bindings deliberately cannot admit this prepared candidate.
DOMAINS = ("ha_tools", "physical_output")
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/podview_controls.py",
        "podvoice/gatekeeper/podview_music.py",
        "podvoice/gatekeeper/podview_queue.py",
        "podvoice/gatekeeper/podview_room_media.py",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/control-model.js",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
        "podvoice/gatekeeper/static/podview/live-media-view.js",
        "podvoice/gatekeeper/static/podview/live-queue-view.js",
        "podvoice/gatekeeper/static/podview/media-observation.js",
        "podvoice/gatekeeper/static/podview/player-view.js",
        "podvoice/gatekeeper/static/podview/podview.bundle.js",
        "podvoice/gatekeeper/static/podview/podview.css",
        "podvoice/gatekeeper/static/podview/podvoice-transport.js",
        "podvoice/gatekeeper/static/podview/setup.css",
        "podvoice/gatekeeper/static/podview/setup.html",
        "podvoice/gatekeeper/static/podview/setup.js",
        "podvoice/gatekeeper/static/podview/speaker-output-view.js",
        "podvoice/gatekeeper/static/podview/ui-kit.css",
        "podvoice/gatekeeper/static/podview/ui/library/library.css",
        "podvoice/gatekeeper/static/podview/widget-view.js",
        "podvoice/gatekeeper/tools.py",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/integration/test_podview_controls.py",
        "tests/integration/test_podview_ha_ingress60.py",
        "tests/integration/test_podview_music.py",
        "tests/integration/test_podview_queue_occurrence.py",
        "tests/integration/test_podview_room_move_caller.py",
        "tests/integration/test_podview_room_move_voice.py",
        "tests/integration/test_podview_room_queue.py",
        "tests/integration/test_queue_controller_boundary.py",
        "tests/integration/test_room_media_binding.py",
        "tests/podview/canonical-next-live-media-view.test.mjs",
        "tests/podview/canonical-next-native-music-controls.test.mjs",
        "tests/podview/canonical-next-player-view.test.mjs",
        "tests/podview/canonical-next-room-media-binding.test.mjs",
        "tests/podview/canonical-next-transport-recovery.test.mjs",
        "tests/podview/canonical-packet-player-view.test.mjs",
        "tests/podview/podvoice-transport.test.mjs",
        "tests/podview/queue-occurrence.test.mjs",
        "tests/podview/root-configured-speaker-label.test.mjs",
        "tests/podview/root-control-model.test.mjs",
        "tests/podview/root-enrollment-fixture.test.mjs",
        "tests/podview/root-live-media-view.test.mjs",
        "tests/podview/root-live-queue-fixture.test.mjs",
        "tests/podview/root-live-queue-occurrence.test.mjs",
        "tests/podview/root-live-queue-view.test.mjs",
        "tests/podview/root-media-observation-v2.test.mjs",
        "tests/podview/root-media-v2-fixture.test.mjs",
        "tests/podview/root-named-controller-enrollment.test.mjs",
        "tests/podview/root-native-music-controls.test.mjs",
        "tests/podview/root-player-view.test.mjs",
        "tests/podview/root-podvoice-transport.test.mjs",
        "tests/podview/root-robot-control-renewal.test.mjs",
        "tests/podview/root-robot-renewal.test.mjs",
        "tests/podview/root-room-media-binding.test.mjs",
        "tests/podview/root-screen-settings.test.mjs",
        "tests/podview/root-setup-kit.test.mjs",
        "tests/podview/root-speaker-output-view.test.mjs",
        "tests/podview/root-topbar-slots.test.mjs",
        "tests/podview/root-topbar.test.mjs",
        "tests/podview/root-transport-recovery.test.mjs",
        "tests/podview/transport-recovery.test.mjs",
        "tests/unit/test_candidate_scope_admission79.py",
        "tests/unit/test_candidate_scope_admission80.py",
        "tests/unit/test_dev_cycle.py",
    }
)

HA_RUNTIME = previous.HA_RUNTIME
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission79.py": "8aaa829467cafd3f759983aa8fdf7b83d582584ad5c11d50a249771f1c011887",
    "scripts/podview79-admission-reviewed.json": "165803494c442eb6edaa7eec961ea164444a25b57bad07957690d2fdb0a22950",
}


# Closed until independent exact-tree review binds the final candidate.
REVIEWER = "/root/sol61_release75_review"
MANIFEST_SHA = "387a63d839012ee777d1e3b63aa1f879248ac8e1aeffe8be04e437a9e4eac45c"
PROFILE_AST = "71a7ff37cc6411b18c1d6a511db2ebaa710be8121318690e4443c26e9e98e79a"


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodView80 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodView80 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodView80 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Exact add-on80 trio and separately delivered HA component0.1.6 metadata."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.80"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.80"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.80"'),
            (
                "custom_components/podvoice/manifest.json",
                r'^  "version": "[^"\n]+",$',
                '  "version": "0.1.6",',
            ),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match80(root: Path, runtime: dict, count: object) -> bool:
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
        or manifest["schema"] != "podview80.admission.v1"
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
        or not assets_match80(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodView80 admission"
            if valid
            else "missing or invalid PodView80 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodView80 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not BASE or not REVIEWER or not MANIFEST_SHA or not PROFILE_AST:
        print("candidate admission stopped: PV80 review bindings are not complete", file=sys.stderr)
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
