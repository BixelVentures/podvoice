#!/usr/bin/env python3
"""Exact76 admission stays closed until final source and independent review bind it."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission75 as previous
except ModuleNotFoundError:
    import candidate_scope_admission75 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "64028590b1a45008bbb0f8e77e6b2fbe81fc9c06"
KIND = "podview76_ui_weather"
VERSION = 53
ASSET_COUNT = 202
MAX_ASSET_TOTAL_BYTES = 34 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission76.py"
MANIFEST = "scripts/podview76-admission-reviewed.json"
RECORD_MARKER = "<!-- podview76-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG
POLICY = previous.POLICY | frozenset({PROFILE, MANIFEST})
TOOLING = previous.TOOLING
FIELDS = previous.FIELDS

# Inventory is derived from immutable UI76 and the exact diff against BASE.
# Blank review bindings deliberately cannot admit this prepared candidate.
DOMAINS = ("ha_tools", "physical_output", "realtime_semantics")
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/__main__.py",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/podview_weather_advice.py",
        "podvoice/gatekeeper/podview_weather_brief.py",
        "podvoice/gatekeeper/podview_weather_budget.py",
        "podvoice/gatekeeper/podview_weather_http.py",
        "podvoice/gatekeeper/tools.py",
        "podvoice/gatekeeper/static/podview/answer-widget.js",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/assets/icons/README.md",
        "podvoice/gatekeeper/static/podview/assets/icons/house.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/image-square.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/provenance.json",
        "podvoice/gatekeeper/static/podview/home-model.js",
        "podvoice/gatekeeper/static/podview/index.html",
        "podvoice/gatekeeper/static/podview/library-catalog.js",
        "podvoice/gatekeeper/static/podview/library.bundle.js",
        "podvoice/gatekeeper/static/podview/library.js",
        "podvoice/gatekeeper/static/podview/live-home-view.js",
        "podvoice/gatekeeper/static/podview/live-media-view.js",
        "podvoice/gatekeeper/static/podview/live-music-selection-view.js",
        "podvoice/gatekeeper/static/podview/music-results.js",
        "podvoice/gatekeeper/static/podview/player-view.js",
        "podvoice/gatekeeper/static/podview/podview.bundle.js",
        "podvoice/gatekeeper/static/podview/podview.css",
        "podvoice/gatekeeper/static/podview/podvoice-transport.js",
        "podvoice/gatekeeper/static/podview/preview-scenes.js",
        "podvoice/gatekeeper/static/podview/radio-view.js",
        "podvoice/gatekeeper/static/podview/robot-control-panel.js",
        "podvoice/gatekeeper/static/podview/timer-view.js",
        "podvoice/gatekeeper/static/podview/ui-kit.css",
        "podvoice/gatekeeper/static/podview/ui/library/components.js",
        "podvoice/gatekeeper/static/podview/ui/resource-tile.js",
        "podvoice/gatekeeper/static/podview/vehicle-view.js",
        "podvoice/gatekeeper/static/podview/weather-observation.js",
        "podvoice/gatekeeper/static/podview/weather-view.js",
        "podvoice/gatekeeper/static/podview/widget-redesign.css",
        "podvoice/gatekeeper/static/podview/widget-view.js",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/integration/test_passive_weather_http.py",
        "tests/podview/canonical-next-collection-selection.test.mjs",
        "tests/podview/canonical-next-live-media-view.test.mjs",
        "tests/podview/canonical-next-player-view.test.mjs",
        "tests/podview/canonical-next-robot-control-panel.test.mjs",
        "tests/podview/canonical-next-vehicle-view.test.mjs",
        "tests/podview/canonical-next-weather-ai-advice.test.mjs",
        "tests/podview/canonical-next-weather-view.test.mjs",
        "tests/podview/canonical-packet-first-read-reconciliation.test.mjs",
        "tests/podview/canonical-packet-player-view.test.mjs",
        "tests/podview/canonical-packet-robot-control-panel.test.mjs",
        "tests/podview/canonical-packet-shared-music-results.test.mjs",
        "tests/podview/canonical-packet-timer-access.test.mjs",
        "tests/podview/podvoice-transport.test.mjs",
        "tests/podview/root-collection-selection.test.mjs",
        "tests/podview/root-first-read-reconciliation.test.mjs",
        "tests/podview/root-history-renderer.test.mjs",
        "tests/podview/root-kit.test.mjs",
        "tests/podview/root-library-catalog.test.mjs",
        "tests/podview/root-library-radio-connection.test.mjs",
        "tests/podview/root-live-media-view.test.mjs",
        "tests/podview/root-live-timer-fixture.test.mjs",
        "tests/podview/root-player-view.test.mjs",
        "tests/podview/root-podvoice-transport.test.mjs",
        "tests/podview/root-preview-scenes.test.mjs",
        "tests/podview/root-radio-connection-feedback.test.mjs",
        "tests/podview/root-robot-control-panel.test.mjs",
        "tests/podview/root-robot-overview-tile.test.mjs",
        "tests/podview/root-screen-settings.test.mjs",
        "tests/podview/root-shared-music-results.test.mjs",
        "tests/podview/root-speaker-selection-description.test.mjs",
        "tests/podview/root-timer-access.test.mjs",
        "tests/podview/root-timer-dom-delta.test.mjs",
        "tests/podview/root-topbar.test.mjs",
        "tests/podview/root-vehicle-view.test.mjs",
        "tests/podview/root-weather-ai-advice.test.mjs",
        "tests/podview/root-weather-passive-lifecycle.test.mjs",
        "tests/podview/root-weather-view.test.mjs",
        "tests/unit/test_candidate_scope_admission75.py",
        "tests/unit/test_candidate_scope_admission76.py",
        "tests/unit/test_locality_lifecycle.py",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_passive_weather_advice.py",
        "tests/unit/test_weather_advice_budget.py",
    }
)

HA_RUNTIME = previous.HA_RUNTIME
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission75.py": "61b87b8f799f1854a453f14cc5cd57fd99d6003f76f1548601719a0b0d14f3b5",
    "scripts/podview75-admission-reviewed.json": "8458873f2ae66191e566fccc67e6fe53a711da4c4295d9c27f0da62ac30a82bc",
}


# Closed until independent exact-tree review binds the final candidate.
REVIEWER = "/root/sol61_release75_review"
MANIFEST_SHA = "5d3f031b21d14ea680afbc3ad1f2e409b0c5b05c08a34c8dc418b8a0a9656b2d"
PROFILE_AST = "49143df2734ee01f87de6b3be00a6081e43ac649e4408fb1d6453f3094d196ee"


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodView76 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodView76 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodView76 record must be an object")
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
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.76"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.76"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.76"'),
            (
                "custom_components/podvoice/manifest.json",
                r'^  "version": "[^"\n]+",$',
                '  "version": "0.1.5",',
            ),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match76(root: Path, runtime: dict, count: object) -> bool:
    """Exact canonical202 asset inventory; path/hash/byte ceiling are fail closed."""
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
        or manifest["schema"] != "podview76.admission.v1"
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
        or not assets_match76(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodView76 admission"
            if valid
            else "missing or invalid PodView76 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodView76 admission")


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
