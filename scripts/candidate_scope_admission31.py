#!/usr/bin/env python3
"""Exact PodView31 admission above the unchanged historical admission policies."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission as previous
except ModuleNotFoundError:
    import candidate_scope_admission as previous

legacy = previous.legacy
sha = previous.sha
ast_sha = previous.ast_sha

BASE = "0e56c593c6ce9a3e1666b5fd535d3424cc691b9c"
KIND = "podview31_mood_playlist_ui"
VERSION = 6
DOMAINS = (
    "ha_tools",
    "physical_output",
    "realtime_semantics",
)  # Actual staged delta includes the new mood request's reasoning field.
PROFILE = "scripts/candidate_scope_admission31.py"
MANIFEST = "scripts/podview31-admission-reviewed.json"
RECORD_MARKER = "<!-- podview31-admission"
MANIFEST_SHA = "881cfac0f8189a44bf62d4dd975dced09b120a1684452acb1535ce4c5c1fa665"
PROFILE_AST = "cffe20c2ce8fab096be8c9f0784134e1b10bf6d4b08b52ec640ec1e00e303163"
STATIC = previous.STATIC
IMMUTABLE = {
    "scripts/candidate_scope.py": "98280acb2f4b9736ba135ef83217f409c864bb190d359aee476fe7a991a37b75",
    "scripts/candidate_scope_admission.py": "033f0e269129ec9f0b9bc353fc114f79100dd40f98868e25c856e50d8749de01",
    "scripts/podview30-admission-reviewed.json": "ac9b6a75ca687dc93aa7357f7d8291777516a71e09116929aa1e99c7b3fa4fd8",
}
BACKEND = frozenset(
    "podvoice/gatekeeper/" + name + ".py"
    for name in (
        "__main__",
        "config",
        "podview",
        "podview_controls",
        "podview_enrichment",
        "podview_mood",
        "podview_mood_budget",
        "podview_mood_setup",
        "podview_music",
        "podview_music_control",
        "podview_music_selection",
        "podview_receipts",
        "podview_research",
        "podview_weather",
        "thin",
        "tools",
    )
)
CONFIG = frozenset({"podvoice/config.yaml", "podvoice/gatekeeper/__init__.py", "pyproject.toml"})
EXTRA_PRODUCTION = frozenset({"podvoice/gatekeeper/static/index.html"})
REQUIRED_PRODUCTION = BACKEND | EXTRA_PRODUCTION | {STATIC + "asset-manifest.json"}
REQUIRED_TESTS = frozenset(
    {
        "tests/unit/test_candidate_scope_admission31.py",
        "tests/unit/test_candidate_scope_admission.py",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_mood_selector.py",
        "tests/unit/test_mood_ongoing_budget.py",
        "tests/unit/test_mood_ongoing_selector.py",
        "tests/unit/test_mood_provision_operator.py",
        "tests/unit/test_mood_setup.py",
        "tests/integration/test_podview_mood_playlists.py",
        "tests/integration/test_podview_music_control.py",
        "tests/podview/root-mood-playlists.test.mjs",
        "tests/podview/ingress-kiosk.test.mjs",
        "tests/podview/root-ingress-kiosk.test.mjs",
    }
)
POLICY = frozenset({PROFILE, MANIFEST, "scripts/dev_cycle.py", ".github/workflows/ci.yml"})
TOOLING = frozenset({"scripts/provision_mood_budget.py"})
FIELDS = previous.FIELDS | {"runtime_fingerprint", "tooling_fingerprint"}


def safe_file(root: Path, name: str) -> bytes:
    if not isinstance(name, str) or "\\" in name or any(ord(c) < 32 for c in name):
        raise ValueError("escaped source path")
    return previous.safe_file(root, name)


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


def record_at(root: Path) -> dict | None:
    """A separate record preserves the historical 30 review without reusing it."""
    text = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in text:
        return None
    if text.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodView31 record")
    parts = text.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodView31 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodView31 record must be an object")
    return record


def fingerprint(root: Path, paths: dict | frozenset | set) -> str:
    return sha(json.dumps([(p, sha(safe_file(root, p))) for p in sorted(paths)]).encode())


def policy_fingerprint(root: Path) -> str:
    return fingerprint(root, POLICY)


def runtime_inventory(root: Path) -> set[str]:
    """Bind all gatekeeper source, including ignored additions and retained legacy."""
    paths = set()
    for prefix in ("podvoice/gatekeeper/",):
        directory = root / prefix
        if not directory.exists():
            continue
        if directory.is_symlink():
            raise ValueError("symlink runtime root")
        for path in directory.rglob("*"):
            if not (path.is_file() or path.is_symlink()):
                continue
            name = path.relative_to(root).as_posix()
            if "/__pycache__/" in name and name.endswith(".pyc"):
                continue
            paths.add(name)
    return paths


def version_only(before: str, after: str, pattern: str, expected: str) -> bool:
    return (
        len(re.findall(pattern, before, re.M)) == 1
        and re.findall(pattern, after, re.M) == [expected]
        and re.sub(pattern, "VERSION", before, flags=re.M)
        == re.sub(pattern, "VERSION", after, flags=re.M)
    )


def config_only(root: Path) -> bool:
    """Only the two explicitly empty mood options/schemas and 31 version are new."""
    name = "podvoice/config.yaml"
    before = legacy._git(root, "show", f"{BASE}:{name}")
    after = safe_file(root, name).decode()
    options = ("podview_mood_policy", "podview_mood_setup_policy")
    allowed = [
        line for option in options for line in (f'  {option}: ""\n', f'  {option}: "str?"\n')
    ]
    lines = after.splitlines(keepends=True)
    if lines.count("options:\n") != 1 or lines.count("schema:\n") != 1:
        return False
    options_at, schema_at = lines.index("options:\n"), lines.index("schema:\n")
    if options_at >= schema_at:
        return False
    for option in options:
        if (
            f'  {option}: ""\n' not in lines[options_at:schema_at]
            or f'  {option}: "str?"\n' not in lines[schema_at:]
            or sum(line.startswith(f"  {option}:") for line in after.splitlines()) != 2
        ):
            return False
    for line in allowed:
        if after.count(line) != 1 or line in before:
            return False
        after = after.replace(line, "", 1)
    if not version_only(before, after, r'^version: "[^"\n]+"$', 'version: "2.0.31"'):
        return False
    for name, pattern, expected in (
        ("podvoice/gatekeeper/__init__.py", r'^__version__ = "[^"\n]+"$', '__version__ = "2.0.31"'),
        ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.31"'),
    ):
        if not version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        ):
            return False
    return True


def assets_match(root: Path, runtime: dict, count: object) -> bool:
    if type(count) is not int or not 130 <= count <= 160:
        return False
    assets = {p for p in runtime_inventory(root) if p.startswith(STATIC)}
    if len(assets) != count + 1:
        return False
    data = json.loads(
        safe_file(root, STATIC + "asset-manifest.json"), object_pairs_hook=legacy._unique_record
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
        and sum(len(safe_file(root, p)) for p in assets) <= 16 * 1024 * 1024
    )


def validate(root: Path, report: legacy.CandidateScope, base_tip: str, record: dict) -> bool:
    if (
        set(record) != FIELDS
        or type(record["version"]) is not int
        or record["version"] != VERSION
        or record["kind"] != KIND
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
        or any(sha(safe_file(root, p)) != digest for p, digest in IMMUTABLE.items())
        or ast_sha(safe_file(root, PROFILE), "PROFILE_AST") != PROFILE_AST
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
        or manifest["schema"] != "podview31.admission.v2"
        or manifest["base"] != BASE
    ):
        return False
    prod, tests, runtime, config, policy, tooling = (
        manifest[k] for k in ("production", "regressions", "runtime", "config", "policy", "tooling")
    )
    if (
        not all(pins_match(root, pins) for pins in (prod, tests, runtime, config, policy, tooling))
        or not REQUIRED_PRODUCTION <= set(prod)
        or not REQUIRED_TESTS <= set(tests)
        or set(config) != CONFIG
        or set(policy) != POLICY - {PROFILE, MANIFEST}
        or set(tooling) != TOOLING
        or set(runtime) != runtime_inventory(root)
        or not set(prod) <= set(runtime)
        or any(p not in BACKEND | EXTRA_PRODUCTION and not p.startswith(STATIC) for p in prod)
        or any(not p.startswith("tests/") for p in tests)
        or not config_only(root)
        or not assets_match(root, runtime, manifest["asset_count"])
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
    effective = legacy._visual_repository_changes(root, BASE)
    if (
        {p for p in effective if p.startswith(legacy._PRODUCTION_PREFIXES)}
        - {"podvoice/gatekeeper/__init__.py"}
        != set(prod)
        or not REQUIRED_TESTS <= effective
        or not TOOLING <= effective
        or not {p for p in effective if p.startswith("tests/")} <= set(tests)
        or any(
            p not in set(prod) | set(tests) | POLICY | TOOLING | CONFIG | {"podvoice/CHANGELOG.md"}
            and not p.startswith("docs/")
            for p in effective
        )
    ):
        return False
    for name in effective:
        safe_file(root, name)
    return (
        record["fingerprint"] == legacy.production_fingerprint(root, BASE, BASE, tuple(prod))
        and record["regression_fingerprint"]
        == legacy.regression_fingerprint(root, BASE, BASE, tuple(tests))
        and record["runtime_fingerprint"] == fingerprint(root, runtime)
        and record["config_fingerprint"] == fingerprint(root, CONFIG)
        and record["policy_fingerprint"] == policy_fingerprint(root)
        and record["tooling_fingerprint"] == fingerprint(root, TOOLING)
        and record["manifest_fingerprint"] == MANIFEST_SHA
    )


def requires31(root: Path, base: str) -> bool:
    names = {
        "podvoice/gatekeeper/" + name + ".py"
        for name in ("podview_mood", "podview_mood_budget", "podview_mood_setup")
    } | TOOLING
    baseline = legacy._base_inventory(root, base)
    # An ignored new source is still copied into the image. Git's ordinary
    # untracked inventory must not turn this candidate into a legacy fallback.
    for name in names:
        path = root / name
        if (path.exists() or path.is_symlink()) and name not in baseline:
            return True
    before = legacy._git(root, "show", f"{base}:podvoice/config.yaml")
    after = safe_file(root, "podvoice/config.yaml").decode()
    return (
        any(
            option in after and option not in before
            for option in ("podview_mood_policy", "podview_mood_setup_policy")
        )
    ) or bool(names & legacy._visual_repository_changes(root, base))


def inspect_repository(root: Path, base: str) -> legacy.CandidateScope:
    report = previous.inspect_repository(root, base)
    try:
        record = record_at(root)
        if record is None or record.get("kind") != KIND:
            if requires31(root, base):
                return replace(
                    report, passed=False, reason="PodView31 requires its exact independent review"
                )
            return report
        valid = validate(
            root, report, legacy._git(root, "rev-parse", f"{base}^{{commit}}").strip(), record
        )
        return replace(
            report,
            passed=valid,
            reason="exact reviewed PodView31 admission" if valid else "invalid PodView31 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodView31 admission")


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
