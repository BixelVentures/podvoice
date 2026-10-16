#!/usr/bin/env python3
"""Rejecting PodView36 composed admission until exact review."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission35 as previous
except ModuleNotFoundError:
    import candidate_scope_admission35 as previous

legacy = previous.legacy
strict = previous.strict  # PodView31 owns the inherited strict helpers.
sha = previous.sha
safe_file = previous.safe_file
BASE = "ed0fbc41d9ab2a9fcdbf0648d2ee0839abd1befd"
KIND = "podview36_queue_admin_robot_and_presentation"
VERSION = 13
PROFILE = "scripts/candidate_scope_admission36.py"
MANIFEST = "scripts/podview36-admission-reviewed.json"
RECORD_MARKER = "<!-- podview36-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG
POLICY = frozenset(
    {
        PROFILE,
        MANIFEST,
        "scripts/dev_cycle.py",
        ".github/workflows/ci.yml",
        "docs/COMPONENT-LIBRARY.md",
        "docs/component-library-registry.json",
    }
)
TOOLING = previous.TOOLING | frozenset({"scripts/check_podview_admin_stdin.sh"})
FIELDS = previous.FIELDS

# Independent review fills these only after the final combined diff is frozen.
# Blank pins always reject, including when an old approval record is present.
DOMAINS = ("ha_tools", "physical_output")
PRODUCTION = frozenset(
    {
        "custom_components/podvoice/__init__.py",
        "custom_components/podvoice/config_flow.py",
        "custom_components/podvoice/controller_admin.py",
        "custom_components/podvoice/manifest.json",
        "custom_components/podvoice/services.yaml",
        "custom_components/podvoice/strings.json",
        "custom_components/podvoice/translations/da.json",
        "custom_components/podvoice/translations/en.json",
        "podvoice/gatekeeper/__main__.py",
        "podvoice/gatekeeper/device_control.py",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/podview_admin_transport.py",
        "podvoice/gatekeeper/podview_continuity.py",
        "podvoice/gatekeeper/podview_controller_admin.py",
        "podvoice/gatekeeper/podview_controls.py",
        "podvoice/gatekeeper/podview_presentation.py",
        "podvoice/gatekeeper/podview_queue.py",
        "podvoice/gatekeeper/podview_queue_scope.py",
        "podvoice/gatekeeper/podview_music_control.py",
        "podvoice/gatekeeper/robot_settings.py",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/control-model.js",
        "podvoice/gatekeeper/static/podview/robot-control-panel.js",
        "podvoice/gatekeeper/static/podview/setup.html",
        "podvoice/gatekeeper/static/podview/ui/library/components.js",
        "podvoice/gatekeeper/static/podview/ui/library/visual-components.js",
        "podvoice/gatekeeper/static/podview/visual-content.js",
    }
)
HA_RUNTIME = frozenset(
    {
        "custom_components/podvoice/__init__.py",
        "custom_components/podvoice/config_flow.py",
        "custom_components/podvoice/controller_admin.py",
        "custom_components/podvoice/manifest.json",
        "custom_components/podvoice/services.yaml",
        "custom_components/podvoice/strings.json",
        "custom_components/podvoice/timer_bridge.py",
        "custom_components/podvoice/translations/da.json",
        "custom_components/podvoice/translations/en.json",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/ha_framework/test_controller_admin_services.py",
        "tests/ha_framework/test_options_flow_http.py",
        "tests/integration/test_podview_admin_provision.py",
        "tests/integration/test_podview_room_queue.py",
        "tests/unit/test_ha_controller_admin.py",
        "tests/unit/test_ha_controller_registration.py",
        "tests/unit/test_podview_queue_scope.py",
        "tests/integration/test_podview_queue_occurrence.py",
        "tests/integration/test_presentation_album_cover_pipeline.py",
        "tests/integration/test_presentation_live_pipeline.py",
        "tests/integration/test_queue_controller_boundary.py",
        "tests/integration/test_robot_settings_ui_contract.py",
        "tests/podview/helpers/render-owned-album-cover.mjs",
        "tests/podview/helpers/render-owned-chart.mjs",
        "tests/podview/root-album-cover.test.mjs",
        "tests/podview/root-control-model.test.mjs",
        "tests/podview/root-robot-control-panel.test.mjs",
        "tests/podview/root-signed-chart.test.mjs",
        "tests/unit/test_candidate_scope_admission35.py",
        "tests/unit/test_candidate_scope_admission36.py",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_podview_album_cover.py",
        "tests/unit/test_podview_presentation.py",
        "tests/unit/test_robot_extended_settings.py",
        "tests/unit/test_robot_setting_labels.py",
        "tests/unit/test_release_contract.py",
    }
)
REVIEWER = "Independent /root/final_scope_audit combined36 source SHA-256 1db64d9b81645c43d0aea5cc398debed7a0b43ef6154043b91d84abfe9c2cdc9; /root/queue_gateway_review CI631 fixture SHA-256 4ecbae2b4b29c238a3a007af903ab4ff72e9658d752350624386ce277443642b"
MANIFEST_SHA = "a9c7b62a3961a4d3f9d03fe615f0cfb5fbc64ae9c7b287b86f825e0f0b9f9139"
PROFILE_AST = "89577877a5bddd314310cf26532d736b00e20dee670b2ee714225bf304461a24"
IMMUTABLE: dict[str, str] = previous.IMMUTABLE | {
    "scripts/candidate_scope_admission35.py": "87e0973b4c460a1732f8f4b66767a73c03c4f473ede980359883f0206549e6c8",
    "scripts/podview35-admission-reviewed.json": "2261f8e95cba54c93f87a5e56227488789690a1b4b5ae01d2bda403cfc5dd4a3",
}
DELETED_PRODUCTION: dict[str, str] = {}


def record_at(root: Path) -> dict | None:
    source = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in source:
        return None
    if source.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodView36 record")
    parts = source.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodView36 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodView36 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Only 36 versions, the fixed stdin channel, and HA manifest 0.1.2."""
    before = legacy._git(root, "show", f"{BASE}:podvoice/config.yaml")
    after = safe_file(root, "podvoice/config.yaml").decode()
    stdin_line = "stdin: true              # fixed HA-admin command channel to the add-on owner\n"
    anchor = (
        "homeassistant_api: true   # SUPERVISOR_TOKEN for the HA tool bridge\n"
        + stdin_line
        + 'hassio_api: true          # lets the panel "Save & restart" the add-on itself\n'
    )
    if after.count(stdin_line) != 1 or after.count(anchor) != 1 or stdin_line in before:
        return False
    if not strict.version_only(
        before,
        after.replace(stdin_line, "", 1),
        r'^version: "[^"\n]+"$',
        'version: "2.0.36"',
    ):
        return False
    if not strict.version_only(
        legacy._git(root, "show", f"{BASE}:custom_components/podvoice/manifest.json"),
        safe_file(root, "custom_components/podvoice/manifest.json").decode(),
        r'^  "version": "[^"\n]+",$',
        '  "version": "0.1.2",',
    ):
        return False
    return all(
        strict.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.36"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.36"'),
        )
    )


def ha_runtime_inventory(root: Path) -> set[str]:
    """Inventory the entire existing HA integration without changing old gates."""
    directory = root / "custom_components/podvoice"
    if directory.is_symlink():
        raise ValueError("symlink HA runtime root")
    return {
        path.relative_to(root).as_posix()
        for path in directory.rglob("*")
        if (path.is_file() or path.is_symlink())
        and not ("/__pycache__/" in path.as_posix() and path.suffix == ".pyc")
    }


def production_scope_matches(effective: set[str]) -> bool:
    actual = {p for p in effective if p.startswith(legacy._PRODUCTION_PREFIXES)}
    return actual - {"podvoice/gatekeeper/__init__.py"} == PRODUCTION


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
        or manifest["schema"] != "podview36.admission.v1"
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
    report = previous.inspect_repository(root, base)
    try:
        record = record_at(root)
        base_tip = legacy._git(root, "rev-parse", f"{base}^{{commit}}").strip()
        valid = record is not None and validate(root, report, base_tip, record)
        return replace(
            report,
            passed=valid,
            reason="exact reviewed PodView36 admission"
            if valid
            else "missing or invalid PodView36 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodView36 admission")


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
