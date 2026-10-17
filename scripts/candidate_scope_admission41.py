#!/usr/bin/env python3
"""Exact additive41 admission for the canonical PodView UI bundle."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission40 as previous
except ModuleNotFoundError:
    import candidate_scope_admission40 as previous

legacy = previous.legacy
strict = previous.strict
sha = previous.sha
safe_file = previous.safe_file
BASE = "6799ee3d65cb67fb406346c565dc206e08cbf0da"
KIND = "podvoice41_canonical_podview_ui_bundle"
VERSION = 18
ASSET_COUNT = 143
MAX_ASSET_TOTAL_BYTES = 18 * 1024 * 1024
PROFILE = "scripts/candidate_scope_admission41.py"
MANIFEST = "scripts/podview41-admission-reviewed.json"
RECORD_MARKER = "<!-- podview41-admission"
STATIC = previous.STATIC
CONFIG = frozenset({"podvoice/config.yaml", "podvoice/gatekeeper/__init__.py", "pyproject.toml"})
POLICY = frozenset(
    {
        PROFILE,
        MANIFEST,
        "scripts/dev_cycle.py",
        ".github/workflows/ci.yml",
        "docs/component-library-registry.json",
    }
)
TOOLING = previous.TOOLING | frozenset({"scripts/browser_gate.py"})
FIELDS = previous.FIELDS

DOMAINS = ("physical_output",)
# Exact changed UI files are frozen from the candidate diff; no directory allowance.
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/static/podview/answer-widget.js",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/assets/icons/boombox.svg",
        "podvoice/gatekeeper/static/podview/assets/icons/car-front.svg",
        "podvoice/gatekeeper/static/podview/assets/vehicle-gray-model-y-2023.png",
        "podvoice/gatekeeper/static/podview/assets/weather-sky-soft.png",
        "podvoice/gatekeeper/static/podview/flow-controller.js",
        "podvoice/gatekeeper/static/podview/frame-layout.css",
        "podvoice/gatekeeper/static/podview/index.html",
        "podvoice/gatekeeper/static/podview/live-answer-view.js",
        "podvoice/gatekeeper/static/podview/live-control-view.js",
        "podvoice/gatekeeper/static/podview/live-home-view.js",
        "podvoice/gatekeeper/static/podview/live-media-view.js",
        "podvoice/gatekeeper/static/podview/live-music-selection-view.js",
        "podvoice/gatekeeper/static/podview/live-music.css",
        "podvoice/gatekeeper/static/podview/media-observation.js",
        "podvoice/gatekeeper/static/podview/player-view.js",
        "podvoice/gatekeeper/static/podview/preview-scenes.js",
        "podvoice/gatekeeper/static/podview/radio-model.js",
        "podvoice/gatekeeper/static/podview/radio-view.js",
        "podvoice/gatekeeper/static/podview/robot-control-panel.js",
        "podvoice/gatekeeper/static/podview/robot-observation.js",
        "podvoice/gatekeeper/static/podview/scene-model.js",
        "podvoice/gatekeeper/static/podview/timer-view.js",
        "podvoice/gatekeeper/static/podview/ui/components.css",
        "podvoice/gatekeeper/static/podview/ui/library/components.js",
        "podvoice/gatekeeper/static/podview/ui/library/library.css",
        "podvoice/gatekeeper/static/podview/ui/library/visual-components.js",
        "podvoice/gatekeeper/static/podview/ui/scroll-edges.js",
        "podvoice/gatekeeper/static/podview/vehicle-model.js",
        "podvoice/gatekeeper/static/podview/vehicle-view.js",
        "podvoice/gatekeeper/static/podview/voice-surface.js",
        "podvoice/gatekeeper/static/podview/weather-observation.js",
        "podvoice/gatekeeper/static/podview/weather-view.js",
        "podvoice/gatekeeper/static/podview/widget-model.js",
        "podvoice/gatekeeper/static/podview/widget-redesign.css",
        "podvoice/gatekeeper/static/podview/widget-view.js",
    }
)
HA_RUNTIME = previous.HA_RUNTIME
REQUIRED_TESTS = frozenset(
    {
        "tests/podview/canonical-next-answer-explanation.test.mjs",
        "tests/podview/canonical-next-configured-city.test.mjs",
        "tests/podview/canonical-next-four-music-tabs.test.mjs",
        "tests/podview/canonical-next-live-answer-view.test.mjs",
        "tests/podview/canonical-next-live-media-view.test.mjs",
        "tests/podview/canonical-next-loading-account-terminal.test.mjs",
        "tests/podview/canonical-next-music-card-appearance.test.mjs",
        "tests/podview/canonical-next-music-flow.test.mjs",
        "tests/podview/canonical-next-music-selection.test.mjs",
        "tests/podview/canonical-next-native-music-controls.test.mjs",
        "tests/podview/canonical-next-native-presentation-components.test.mjs",
        "tests/podview/canonical-next-player-view.test.mjs",
        "tests/podview/canonical-next-podvoice-view.test.mjs",
        "tests/podview/canonical-next-presentation-answers.test.mjs",
        "tests/podview/canonical-next-radio-model.test.mjs",
        "tests/podview/canonical-next-radio-view.test.mjs",
        "tests/podview/canonical-next-robot-control-panel.test.mjs",
        "tests/podview/canonical-next-robot-history-view.test.mjs",
        "tests/podview/canonical-next-robot-observation.test.mjs",
        "tests/podview/canonical-next-robot-resource-detail.test.mjs",
        "tests/podview/canonical-next-robot-setting-labels.test.mjs",
        "tests/podview/canonical-next-room-media-binding.test.mjs",
        "tests/podview/canonical-next-timer-model.test.mjs",
        "tests/podview/canonical-next-timer-overview.test.mjs",
        "tests/podview/canonical-next-vehicle-view.test.mjs",
        "tests/podview/canonical-next-visual-history.test.mjs",
        "tests/podview/canonical-next-voice-surface.test.mjs",
        "tests/podview/canonical-next-weather-ai-advice.test.mjs",
        "tests/podview/canonical-next-weather-observation.test.mjs",
        "tests/podview/canonical-next-weather-view.test.mjs",
        "tests/podview/canonical-next-weather-wind.test.mjs",
        "tests/podview/canonical-next-widget-loading.test.mjs",
        "tests/podview/canonical-next-widget-model.test.mjs",
        "tests/podview/canonical-room-fixture.mjs",
        "tests/podview/fixtures/feeling-route.json",
        "tests/podview/root-component-library.test.mjs",
        "tests/unit/test_candidate_scope_admission41.py",
        "tests/unit/test_ci_scope.py",
        "tests/unit/test_dev_cycle.py",
    }
)
# Lead fills approval only after an independent review of the final composition.
REVIEWER = "Independent /root/astra_robot_component_unification exact41 tooling review"
MANIFEST_SHA = "6a4377b34127bba69602843509193880ba36ed863dcce5aeda6846a20ef7ad42"
PROFILE_AST = "baba3cc9b65419acf3de60b52e3aac57c7de11f834c28fd64d5c27002b5a00d3"
IMMUTABLE = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission40.py": "66732564afd110d8e815b82644938581382f69e48d1cf48b5ea25cb160fdfec9",
    "scripts/podview40-admission-reviewed.json": "cbe7de00e2e9a4d2a9880a85779c857e092ba5fb9cc2a5839fa926ca17fc7a01",
}


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodVoice41 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodVoice41 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodVoice41 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Only the existing add-on version trio changes to41."""
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.41"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.41"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.41"'),
        )
    )


ha_runtime_inventory = previous.ha_runtime_inventory


def assets_match41(root: Path, runtime: dict, count: object) -> bool:
    """Keep strict asset checks with an 18 MiB cap for the reviewed 143-file UI."""
    if type(count) is not int or count != ASSET_COUNT:
        return False
    assets = {p for p in strict.runtime_inventory(root) if p.startswith(STATIC)}
    if len(assets) != count + 1:
        return False
    data = json.loads(
        safe_file(root, STATIC + "asset-manifest.json"),
        object_pairs_hook=legacy._unique_record,
    )
    if set(data) != {"schema", "files"} or data["schema"] != "podview.assets.v1":
        return False
    rows = data["files"]
    if not isinstance(rows, list) or len(rows) != count:
        return False
    names = set()
    for row in rows:
        if (
            not isinstance(row, dict)
            or set(row) != {"path", "sha256"}
            or not isinstance(row["path"], str)
        ):
            return False
        name = STATIC + row["path"]
        if name in names or runtime.get(name) != row["sha256"]:
            return False
        safe_file(root, name)
        names.add(name)
    return (
        names == assets - {STATIC + "asset-manifest.json"}
        and all(len(safe_file(root, p)) <= 4 * 1024 * 1024 for p in assets)
        and sum(len(safe_file(root, p)) for p in assets) <= MAX_ASSET_TOTAL_BYTES
    )


def production_scope_matches(effective: set[str]) -> bool:
    actual = {p for p in effective if p.startswith(legacy._PRODUCTION_PREFIXES)}
    return actual - {"podvoice/gatekeeper/__init__.py"} == PRODUCTION


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
        or manifest["schema"] != "podvoice41.admission.v1"
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
        or not assets_match41(root, runtime, manifest["asset_count"])
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
            reason="exact reviewed PodVoice41 admission"
            if valid
            else "missing or invalid PodVoice41 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodVoice41 admission")


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
