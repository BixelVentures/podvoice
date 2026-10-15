#!/usr/bin/env python3
"""Exact additive PodView30 admission; preserve historical policy byte for byte."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import sys
from dataclasses import asdict, replace
from pathlib import Path, PurePosixPath

try:
    from scripts import candidate_scope as legacy
except ModuleNotFoundError:
    import candidate_scope as legacy

BASE = "beed27b0528917e4872516a53d88bedb17d3d6ed"
KIND = "podview_native_source_ui_parity"
VERSION = 5
DOMAINS = ("ha_tools", "physical_output")
PROFILE = "scripts/candidate_scope_admission.py"
MANIFEST = "scripts/podview30-admission-reviewed.json"
STATIC = "podvoice/gatekeeper/static/podview/"
LEGACY_SHA = "98280acb2f4b9736ba135ef83217f409c864bb190d359aee476fe7a991a37b75"
LEGACY_AST = "ce01e442628ee644a176c1d97609b2dc02e9aa3bcf55e22366c2a8d1743ea788"
MANIFEST_SHA = "607f50a785409ad16deb77fc7cbbe8446ceae7161fb0e58a3666cd328b31545c"
PROFILE_AST = "8f10b13bd8da1bd14cc3f9f1cee4d0e2f320eaeb2d9552fc02a523cfc34e7c42"
REQUIRED_PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/podview_controls.py",
        "podvoice/gatekeeper/podview_music_control.py",
        "podvoice/gatekeeper/podview_music_selection.py",
        "podvoice/gatekeeper/podview_weather.py",
        "podvoice/gatekeeper/static/index.html",
        STATIC + "asset-manifest.json",
        STATIC + "ingress-kiosk.js",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/integration/test_podview_bridge.py",
        "tests/integration/test_podview_controls.py",
        "tests/integration/test_podview_music_control.py",
        "tests/integration/test_podview_music_selection.py",
        "tests/integration/test_podview_collection_selection.py",
        "tests/unit/test_music_selection_owner.py",
        "tests/unit/test_weather_result.py",
        "tests/podview/ingress-kiosk.test.mjs",
        "tests/unit/test_candidate_scope_admission.py",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_candidate_scope_music_selection.py",
        "tests/fixtures/candidate_scope/music-selection-e272d.json",
    }
)
POLICY = frozenset({PROFILE, MANIFEST, "scripts/dev_cycle.py", ".github/workflows/ci.yml"})
FIELDS = frozenset(
    {
        "version",
        "kind",
        "base_tip",
        "merge_base",
        "domains",
        "fingerprint",
        "regression_fingerprint",
        "policy_fingerprint",
        "config_fingerprint",
        "manifest_fingerprint",
        "reviewer",
        "rationale",
    }
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def ast_sha(data: bytes, exclude: str | None = None) -> str:
    tree = ast.parse(data)
    if exclude:
        matches = [
            n
            for n in tree.body
            if isinstance(n, ast.Assign)
            and len(n.targets) == 1
            and isinstance(n.targets[0], ast.Name)
            and n.targets[0].id == exclude
        ]
        if len(matches) != 1:
            raise ValueError("ambiguous policy AST pin")
        tree.body.remove(matches[0])
    return sha(ast.dump(tree, include_attributes=False).encode())


def safe_file(root: Path, name: str) -> bytes:
    path = PurePosixPath(name)
    if (
        not name
        or path.is_absolute()
        or str(path) != name
        or any(p in {".", ".."} for p in path.parts)
    ):
        raise ValueError("noncanonical path")
    current = root
    for part in path.parts:
        current /= part
        if current.is_symlink():
            raise ValueError("symlink")
    if not current.is_file() or current.stat().st_mode & 0o111:
        raise ValueError("deleted, executable or nonregular file")
    return current.read_bytes()


def record_at(root: Path) -> dict | None:
    text = (root / "docs/STATUS.md").read_text()
    marker = "<!-- candidate-scope-coupling"
    if marker not in text:
        return None
    if text.count(marker) != 1:
        raise ValueError("duplicate record")
    parts = text.split(marker, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("record must be an object")
    return record


def policy_fingerprint(root: Path) -> str:
    return sha(json.dumps([(p, sha(safe_file(root, p))) for p in sorted(POLICY)]).encode())


def pins_match(root: Path, pins: dict) -> bool:
    return (
        isinstance(pins, dict)
        and bool(pins)
        and all(
            isinstance(p, str)
            and isinstance(digest, str)
            and re.fullmatch(r"[0-9a-f]{64}", digest)
            and sha(safe_file(root, p)) == digest
            for p, digest in pins.items()
        )
    )


def validate(root: Path, report: legacy.CandidateScope, base_tip: str, record: dict) -> bool:
    if (
        set(record) != FIELDS
        or type(record["version"]) is not int
        or record["version"] != VERSION
        or record["kind"] != KIND
        or report.domains != DOMAINS
        or record["domains"] != list(DOMAINS)
        or base_tip != BASE
        or report.base != BASE
        or record["base_tip"] != BASE
        or record["merge_base"] != BASE
        or any(
            not isinstance(record[k], str) or not record[k].strip()
            for k in FIELDS - {"version", "domains"}
        )
    ):
        return False
    previous = safe_file(root, "scripts/candidate_scope.py")
    if (
        sha(previous) != LEGACY_SHA
        or ast_sha(previous) != LEGACY_AST
        or ast_sha(safe_file(root, PROFILE), "PROFILE_AST") != PROFILE_AST
    ):
        return False
    raw = safe_file(root, MANIFEST)
    if sha(raw) != MANIFEST_SHA:
        return False
    manifest = json.loads(raw, object_pairs_hook=legacy._unique_record)
    if (
        set(manifest)
        != {"schema", "base", "production", "regressions", "runtime", "policy", "asset_count"}
        or manifest["schema"] != "podview30.admission.v1"
        or manifest["base"] != BASE
        or type(manifest["asset_count"]) is not int
        or manifest["asset_count"] != 130
    ):
        return False
    prod, tests, runtime, policy = [
        manifest[k] for k in ("production", "regressions", "runtime", "policy")
    ]
    if not all(pins_match(root, pins) for pins in (prod, tests, runtime, policy)):
        return False
    if (
        not REQUIRED_PRODUCTION <= set(prod)
        or not REQUIRED_TESTS <= set(tests)
        or not set(prod) <= set(runtime)
        or set(policy) != POLICY - {PROFILE, MANIFEST}
        or any(not p.startswith("tests/") for p in tests)
        or any(p not in REQUIRED_PRODUCTION and not p.startswith(STATIC) for p in prod)
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
    )
    if any(p and not ("/__pycache__/" in p and p.endswith(".pyc")) for p in ignored.split("\0")):
        return False
    effective = legacy._visual_repository_changes(root, BASE)
    metadata = {"podvoice/gatekeeper/__init__.py", "podvoice/config.yaml", "pyproject.toml"}
    changed_prod = {p for p in effective if p.startswith(legacy._PRODUCTION_PREFIXES)}
    if (
        changed_prod - {"podvoice/gatekeeper/__init__.py"} != set(prod)
        or not REQUIRED_TESTS <= effective
        or not {p for p in effective if p.startswith("tests/")} <= set(tests)
        or any(
            p not in set(prod) | set(tests) | POLICY | metadata | {"podvoice/CHANGELOG.md"}
            and not p.startswith("docs/")
            for p in effective
        )
    ):
        return False
    for p in effective:
        safe_file(root, p)  # Reject every deletion/symlink/executable, including tests/docs.
    for p in metadata & effective:
        before = legacy._git(root, "show", f"{BASE}:{p}")
        after = safe_file(root, p).decode()
        pattern = (
            r'^__version__ = "\d+\.\d+\.\d+"$'
            if p.endswith("__init__.py")
            else r'^version: "\d+\.\d+\.\d+"$'
            if p.endswith(".yaml")
            else r'^version = "\d+\.\d+\.\d+"$'
        )
        if (
            len(re.findall(pattern, before, re.M)) != 1
            or len(re.findall(pattern, after, re.M)) != 1
            or re.sub(pattern, "VERSION", before, flags=re.M)
            != re.sub(pattern, "VERSION", after, flags=re.M)
        ):
            return False
    assets = {
        str(p.relative_to(root))
        for p in (root / STATIC).rglob("*")
        if p.is_file() or p.is_symlink()
    }
    if assets != {p for p in runtime if p.startswith(STATIC)} or len(assets) != 131:
        return False
    asset_manifest = json.loads(
        safe_file(root, STATIC + "asset-manifest.json"), object_pairs_hook=legacy._unique_record
    )
    if (
        set(asset_manifest) != {"schema", "files"}
        or asset_manifest["schema"] != "podview.assets.v1"
        or not isinstance(asset_manifest["files"], list)
        or len(asset_manifest["files"]) != 130
    ):
        return False
    listed = set()
    for item in asset_manifest["files"]:
        if not isinstance(item, dict) or set(item) != {"path", "sha256"}:
            return False
        name = STATIC + item["path"]
        if name in listed or runtime.get(name) != item["sha256"]:
            return False
        listed.add(name)
    if listed != assets - {STATIC + "asset-manifest.json"}:
        return False
    if (
        any(len(safe_file(root, p)) > 4 * 1024 * 1024 for p in assets)
        or sum(len(safe_file(root, p)) for p in assets) > 16 * 1024 * 1024
    ):
        return False
    return (
        record["fingerprint"] == legacy.production_fingerprint(root, BASE, BASE, tuple(prod))
        and record["regression_fingerprint"]
        == legacy.regression_fingerprint(root, BASE, BASE, tuple(tests))
        and record["policy_fingerprint"] == policy_fingerprint(root)
        and record["config_fingerprint"] == sha(safe_file(root, "podvoice/config.yaml"))
        and record["manifest_fingerprint"] == MANIFEST_SHA
    )


def inspect_repository(root: Path, base: str) -> legacy.CandidateScope:
    report = legacy.inspect_repository(root, base)  # Actual unchanged classifier and legacy guards.
    try:
        record = record_at(root)
        if record is None or record.get("kind") != KIND:
            return report
        valid = validate(
            root, report, legacy._git(root, "rev-parse", f"{base}^{{commit}}").strip(), record
        )
        return replace(
            report,
            passed=valid,
            reason="exact reviewed PodView30 admission" if valid else "invalid PodView30 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodView30 admission")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        root = Path(legacy._git(Path.cwd(), "rev-parse", "--show-toplevel").strip())
        record = record_at(root)
        if record is None or record.get("kind") != KIND:
            return legacy.main(argv)
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
