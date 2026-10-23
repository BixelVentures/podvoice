#!/usr/bin/env python3
"""Exact79 admission stays closed until final source and independent review bind it."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission78 as previous
except ModuleNotFoundError:
    import candidate_scope_admission78 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "7742699ea8ca0c9b70498a7c2f63e86b039c3eed"
KIND = "podview79_quiet_lights_playback"
VERSION = 56
ASSET_COUNT = 203
MAX_ASSET_TOTAL_BYTES = 34 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission79.py"
MANIFEST = "scripts/podview79-admission-reviewed.json"
RECORD_MARKER = "<!-- podview79-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG
POLICY = previous.POLICY | frozenset({PROFILE, MANIFEST})
TOOLING = previous.TOOLING | frozenset(
    {
        "docs/LIGHTS-DRAFT-HANDOFF.md",
        "docs/LIGHTS-DRAFT-PIN.json",
        "docs/LIGHTS-NEXT-BACKEND-PIN.json",
        "docs/LIGHTS-NEXT-BACKEND.md",
        "docs/qa-ui79/ACCOUNT-OBSERVED-BROWSER-REVIEW.md",
        "docs/qa-ui79/IDLE-NEXT-OUTPUT-BROWSER-REVIEW.md",
        "docs/qa-ui79/LATE-SILENT-REVIEW-METADATA.json",
        "docs/qa-ui79/LIGHTS-FINAL-MODAL-GEOMETRY.json",
        "docs/qa-ui79/LIGHTS-SCOPED-BROWSER-REVIEW.md",
        "docs/qa-ui79/NEXT-HANDOFF.md",
        "docs/qa-ui79/NEXT-SOURCE-PINS.json",
        "docs/qa-ui79/SITES50-PUBLICATION.md",
        "docs/qa-ui79/TESTS.log",
        "docs/qa-ui79/screenshots/account-observed-detail.jpg",
        "docs/qa-ui79/screenshots/account-observed-library-reference.jpg",
        "docs/qa-ui79/screenshots/account-observed-overview-final.jpg",
        "docs/qa-ui79/screenshots/idle-output-persistent-final.jpg",
        "docs/qa-ui79/screenshots/lights-empty.jpg",
        "docs/qa-ui79/screenshots/lights-library-final.jpg",
        "docs/qa-ui79/screenshots/lights-library-passive-final.jpg",
        "docs/qa-ui79/screenshots/lights-offered-controls.jpg",
        "docs/qa-ui79/screenshots/lights-offered-final.jpg",
        "docs/qa-ui79/screenshots/lights-offered-final32.jpg",
        "docs/qa-ui79/screenshots/lights-other.jpg",
        "docs/qa-ui79/screenshots/lights-own.jpg",
        "docs/qa-ui79/screenshots/lights-passive-final.jpg",
        "docs/qa-ui79/screenshots/lights-passive-lamp.jpg",
        "docs/qa-ui79/screenshots/lights-ttl.jpg",
        "docs/qa-ui79/screenshots/robot-shared-controls-final.jpg",
        "scripts/account-observed-fixture.mjs",
        "scripts/lights-flow-fixture.mjs",
    }
)
TOOLING = TOOLING | frozenset(
    {
        "docs/qa-ui79/weather-overlay/TESTS.log",
        "docs/qa-ui79/weather-overlay/WEATHER-DEFERRED-BROWSER-REVIEW.md",
        "docs/qa-ui79/weather-overlay/WEATHER-DEFERRED-IMAGE-SHA256.txt",
        "docs/qa-ui79/weather-overlay/WEATHER-REQUESTING-FIXTURE-TRACE.txt",
        "docs/qa-ui79/weather-overlay/WEATHER-REQUESTING-PINS.json",
        "docs/qa-ui79/weather-overlay/screenshots/weather-library-pending-final.jpg",
        "docs/qa-ui79/weather-overlay/screenshots/weather-library-ready-final.jpg",
        "docs/qa-ui79/weather-overlay/screenshots/weather-ready-final.jpg",
        "docs/qa-ui79/weather-overlay/screenshots/weather-reopen-final.jpg",
        "docs/qa-ui79/weather-overlay/screenshots/weather-requesting-final.jpg",
        "scripts/weather-deferred-fixture.mjs",
    }
)
FIELDS = previous.FIELDS

# Inventory is derived from immutable UI79 and the exact diff against BASE.
# Blank review bindings deliberately cannot admit this prepared candidate.
DOMAINS = ("ha_tools", "physical_output")
PRODUCTION = frozenset(
    {
        "custom_components/podvoice/__init__.py",
        "custom_components/podvoice/config_flow.py",
        "custom_components/podvoice/controller_admin.py",
        "custom_components/podvoice/strings.json",
        "custom_components/podvoice/translations/da.json",
        "custom_components/podvoice/translations/en.json",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/podview_admin_transport.py",
        "podvoice/gatekeeper/podview_continuity.py",
        "podvoice/gatekeeper/podview_controls.py",
        "podvoice/gatekeeper/podview_light_control.py",
        "podvoice/gatekeeper/podview_lights.py",
        "podvoice/gatekeeper/podview_music_control.py",
        "podvoice/gatekeeper/podview_room_media.py",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/control-model.js",
        "podvoice/gatekeeper/static/podview/ha-home-observation.js",
        "podvoice/gatekeeper/static/podview/home-model.js",
        "podvoice/gatekeeper/static/podview/library.bundle.js",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
        "podvoice/gatekeeper/static/podview/live-home-view.js",
        "podvoice/gatekeeper/static/podview/live-media-view.js",
        "podvoice/gatekeeper/static/podview/media-observation.js",
        "podvoice/gatekeeper/static/podview/music-results.js",
        "podvoice/gatekeeper/static/podview/player-view.js",
        "podvoice/gatekeeper/static/podview/podview.bundle.js",
        "podvoice/gatekeeper/static/podview/podview.css",
        "podvoice/gatekeeper/static/podview/podvoice-transport.js",
        "podvoice/gatekeeper/static/podview/scene-model.js",
        "podvoice/gatekeeper/static/podview/speaker-output-view.js",
        "podvoice/gatekeeper/static/podview/ui/library/library.css",
        "podvoice/gatekeeper/static/podview/weather-view.js",
        "podvoice/gatekeeper/static/podview/widget-view.js",
        "podvoice/gatekeeper/tools.py",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/ha_framework/test_controller_admin_services.py",
        "tests/integration/test_podview_admin_placement.py",
        "tests/integration/test_podview_bridge.py",
        "tests/integration/test_podview_controller_continuity.py",
        "tests/integration/test_podview_controller_placement.py",
        "tests/integration/test_podview_light_controls.py",
        "tests/integration/test_podview_lights_admission.py",
        "tests/integration/test_podview_lights_bridge.py",
        "tests/integration/test_podview_lights_catalogue.py",
        "tests/integration/test_room_media_binding.py",
        "tests/podview/canonical-next-live-media-view.test.mjs",
        "tests/podview/canonical-next-room-media-binding.test.mjs",
        "tests/podview/canonical-next-visual-history.test.mjs",
        "tests/podview/canonical-next-weather-view.test.mjs",
        "tests/podview/canonical-packet-visual-history.test.mjs",
        "tests/podview/podvoice-transport.test.mjs",
        "tests/podview/root-account-observed-fixture.test.mjs",
        "tests/podview/root-ha-home-observation.test.mjs",
        "tests/podview/root-kit.test.mjs",
        "tests/podview/root-light-control-model.test.mjs",
        "tests/podview/root-light-controls.test.mjs",
        "tests/podview/root-light-journey.test.mjs",
        "tests/podview/root-lights-flow-fixture.test.mjs",
        "tests/podview/root-live-control-view.test.mjs",
        "tests/podview/root-live-light-area-host.test.mjs",
        "tests/podview/root-live-media-view.test.mjs",
        "tests/podview/root-overview-facts.test.mjs",
        "tests/podview/root-overview-media-values.test.mjs",
        "tests/podview/root-podvoice-transport.test.mjs",
        "tests/podview/root-robot-control-renewal.test.mjs",
        "tests/podview/root-robot-renewal.test.mjs",
        "tests/podview/root-room-media-binding.test.mjs",
        "tests/podview/root-scene-model.test.mjs",
        "tests/podview/root-speaker-output-idle.test.mjs",
        "tests/podview/root-speaker-output-view.test.mjs",
        "tests/podview/root-topbar.test.mjs",
        "tests/podview/root-visual-history.test.mjs",
        "tests/podview/root-weather-deferred-fixture.test.mjs",
        "tests/podview/root-weather-passive-lifecycle.test.mjs",
        "tests/podview/root-weather-view.test.mjs",
        "tests/unit/test_candidate_scope_admission78.py",
        "tests/unit/test_candidate_scope_admission79.py",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_ha_controller_admin.py",
        "tests/unit/test_ha_controller_registration.py",
        "tests/unit/test_ha_display_devices.py",
        "tests/unit/test_locality_lifecycle.py",
        "tests/unit/test_podview_lights.py",
        "tests/unit/test_podview_lights_tools.py",
        "tests/unit/test_podview_sse_wake.py",
    }
)

HA_RUNTIME = previous.HA_RUNTIME
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission78.py": "cfec9bfb4fa7aca97c5868828889c6f890e2799a34adc9e5ca2762a0f38a4938",
    "scripts/podview78-admission-reviewed.json": "d574ac689d1cbce82335f3ff99d2d87e245aa19fa229fd477e16c9d2abf284bc",
}


# Closed until independent exact-tree review binds the final candidate.
REVIEWER = "/root/sol61_release75_review"
MANIFEST_SHA = "165803494c442eb6edaa7eec961ea164444a25b57bad07957690d2fdb0a22950"
PROFILE_AST = "009494c22e14a7e00e81918a57929b04edb2171914d187614c9aeb3d4884f6a1"


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodView79 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodView79 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodView79 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Exact add-on79 trio and separately delivered HA component0.1.6 metadata."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.79"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.79"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.79"'),
            (
                "custom_components/podvoice/manifest.json",
                r'^  "version": "[^"\n]+",$',
                '  "version": "0.1.6",',
            ),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match79(root: Path, runtime: dict, count: object) -> bool:
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
        or manifest["schema"] != "podview79.admission.v1"
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
        or not assets_match79(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodView79 admission"
            if valid
            else "missing or invalid PodView79 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodView79 admission")


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
