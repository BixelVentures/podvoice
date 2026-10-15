#!/usr/bin/env python3
"""Exact additive PodView33 clock/diagnostic admission; unreviewed pins reject."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

try:
    from scripts import candidate_scope_admission32 as previous
except ModuleNotFoundError:
    import candidate_scope_admission32 as previous

legacy = previous.legacy
sha = previous.sha
safe_file = previous.safe_file
BASE = "abe759678168ba6408e10ae0a8a3621249631d13"
KIND = "podview33_clock_bounded_diagnostics"
VERSION = 8
PROFILE = "scripts/candidate_scope_admission33.py"
MANIFEST = "scripts/podview33-admission-reviewed.json"
RECORD_MARKER = "<!-- podview33-admission"
STATIC = previous.STATIC
CONFIG = previous.CONFIG
POLICY = frozenset({PROFILE, MANIFEST, "scripts/dev_cycle.py", ".github/workflows/ci.yml"})
TOOLING = previous.TOOLING
FIELDS = previous.FIELDS

# Final combined diff, independent reviewer and all pins are filled only at freeze.
# Empty values reject; no historical approval or generic PASS admits this candidate.
DOMAINS = ("physical_output",)
PRODUCTION = frozenset(
    {
        "podvoice/gatekeeper/mood_diagnostics.py",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/podview_mood.py",
        "podvoice/gatekeeper/tools.py",
    }
)
REQUIRED_TESTS = frozenset(
    {
        "tests/unit/test_candidate_scope_admission33.py",
        "tests/unit/test_mood_diagnostics.py",
        "tests/integration/test_mood_diagnostics_route.py",
        "tests/unit/test_mood_clock_envelopes.py",
    }
)
REVIEWER = "Independent GPT-6 Sol /root/weather_data_acceptance_sol; exact33 assembled source/admission review"
MANIFEST_SHA = "3ac03a9cfc7d3befa074e732f76764005a463624f24551314282b54204c733a6"
PROFILE_AST = "f2172a3afed5487e058b2964d65b680f8828c5770c99e47af24fd2bc05d673ed"
IMMUTABLE: dict[str, str] = {
    "scripts/candidate_scope_admission.py": "033f0e269129ec9f0b9bc353fc114f79100dd40f98868e25c856e50d8749de01",
    "scripts/candidate_scope_admission31.py": "fd56f1d286e59793ded52d99cf9d428376e9d7ec73c9e08c681b6242245cef22",
    "scripts/candidate_scope_admission32.py": "3ebcbc6e8350880be0f6659522e0eaacb7df0e9e216d2eae105a591fbe221e29",
    "scripts/podview30-admission-reviewed.json": "ac9b6a75ca687dc93aa7357f7d8291777516a71e09116929aa1e99c7b3fa4fd8",
    "scripts/podview31-admission-reviewed.json": "881cfac0f8189a44bf62d4dd975dced09b120a1684452acb1535ce4c5c1fa665",
    "scripts/podview32-admission-reviewed.json": "91597306f95bf0e4a6ea54dcf5e680917ad1bed87dc1c80e09ca5e2c49707219",
    "tests/unit/_candidate_scope_git.py": "e27819e4a7f0daf56f4cbaac1479c8ff08524646d2aeed73336498feb79529de",
    "tests/unit/_candidate_scope_idle_input_ui.py": "521223e383d4d492f6a31539a3df7a1a260f9f02fa912422abf2ce8147948103",
    "tests/unit/test_candidate_scope.py": "d1d81af09646221d387e9cd894bbc1e9083eb9b0a93d31fb15215a61ed2ddfd3",
    "tests/unit/test_candidate_scope_admission.py": "5af18254f9b9ea176500345588db8b0d356843d094878393e510e20f5f7c0953",
    "tests/unit/test_candidate_scope_admission31.py": "b80b7e2771e0438119090cffb6e1e8528a46aa0928dbe86a4d728edb6344bc1a",
    "tests/unit/test_candidate_scope_admission32.py": "fcc79e5a046ee41f7fb23dbee6573c1ef5009296c8da3711332d7d0f3c36dafb",
    "tests/unit/test_candidate_scope_companion.py": "db6567d1fd40ec249a0bed14df7ecbe32b15d3c8a8f61ce40305eea9e2c515f2",
    "tests/unit/test_candidate_scope_crypto.py": "c849426b362e428978e74e2da35b3dc76302e919f7d7a4821823a02e48a34e68",
    "tests/unit/test_candidate_scope_git_1.py": "180ff1e92918f17f6d0249824e233f5e9dba452c5561345883103c1eae9b2c91",
    "tests/unit/test_candidate_scope_git_2.py": "c576daecf2ddd6fb158be85be4255701e2acd22541b8f4902d627186e654d195",
    "tests/unit/test_candidate_scope_git_3.py": "0a6227562cc969199e3cff8b4fa9ee55334eb6fc06a3fb39d55be4722afca1e7",
    "tests/unit/test_candidate_scope_git_4.py": "b50563a5d57b5ba4cd722b6800378262dc15b02197bae435357d0446d3738e98",
    "tests/unit/test_candidate_scope_git_5.py": "420ce6daf7ae0293412968465135509bb35a0bb9e3db47e1f3c0e40d1e9f163c",
    "tests/unit/test_candidate_scope_git_6.py": "77a1567547f1e8e670c33cb9a640fa457e0ea64f5e079ffa530b025dccdac8d9",
    "tests/unit/test_candidate_scope_git_7.py": "dbc86fd925602e60e4a19fe85b8f3c0b7ee772628e9acab87b4180eb01905d01",
    "tests/unit/test_candidate_scope_git_8.py": "db3b9a07dbc5a3bd2854456a50c3fb652ad2d01f5195ef6a350d21e76410214b",
    "tests/unit/test_candidate_scope_idle_input_ui_1.py": "d51584c2cfc98f823da52e5cedfea7858355919b16b8210677e0b89283555cff",
    "tests/unit/test_candidate_scope_idle_input_ui_2.py": "9a092ad5dbe13d4df05e698896154e501cbd453da904cd8c674c1fdcd304ad79",
    "tests/unit/test_candidate_scope_idle_input_ui_3.py": "813ec8c7bdf2b016a604daf9c8c0f533328e1d5e6c4b15c82c78e7d5ebc7f8f3",
    "tests/unit/test_candidate_scope_idle_input_ui_4.py": "43c54f7bb61741b1d20cad52297daf6bf5786dba5cc987ffb79e26c80f9359ab",
    "tests/unit/test_candidate_scope_live_startup_idle_alarm.py": "bdae150ca621151b402c181610ffa9040218e99dac6d6b47795663765eabe9b0",
    "tests/unit/test_candidate_scope_music_selection.py": "956df9566b32f4e393b463356ca6e2da856fa18fba47d2bd5507ec20853cfc11",
    "tests/unit/test_candidate_scope_podview.py": "67f67a42b47af8673c4f0a88b1508a5f159dbeae1a986786c041517fadbbdf8f",
    "tests/unit/test_candidate_scope_read_data.py": "8e7e52f7a0dada978589bbcd87509ed612bb6fea899747a2b673a147d4d70d42",
    "tests/unit/test_candidate_scope_schema_health.py": "c749a507b71988a0d93aa27c3c1d84812e969fe39e6e44fb65976a82cf74438d",
    "tests/unit/test_candidate_scope_visual.py": "0ffa674ea425a78f5ac59f79b34a57cedf79638a5a23f0bb5e48861d73f87f9d",
    "scripts/candidate_scope.py": "98280acb2f4b9736ba135ef83217f409c864bb190d359aee476fe7a991a37b75",
    "tests/fixtures/candidate_scope/music-selection-e272d.json": "227654e12214000a77301ff413e8a98d5e6596aa1099c2bdd2e6f3c751364bfa",
    "scripts/provision_mood_budget.py": "70590ecc4ebc717fc0c2b00d824c561b607510380582fe2baef5cfdd84e54fda",
    "scripts/revoke-podview-controller.py": "1cae1f9f516e5fed803425ebbf17e0e255052b983794b3e5f9556deb85226201",
}


def record_at(root: Path) -> dict | None:
    text = safe_file(root, "docs/STATUS.md").decode()
    if RECORD_MARKER not in text:
        return None
    if text.count(RECORD_MARKER) != 1:
        raise ValueError("duplicate PodView33 record")
    parts = text.split(RECORD_MARKER, 1)[1].split("-->", 1)
    if len(parts) != 2:
        raise ValueError("unclosed PodView33 record")
    record = json.loads(parts[0].strip(), object_pairs_hook=legacy._unique_record)
    if not isinstance(record, dict):
        raise ValueError("PodView33 record must be an object")
    return record


def config_only(root: Path) -> bool:
    """Only the three version strings may change from the published32 base."""
    return all(
        previous.previous.version_only(
            legacy._git(root, "show", f"{BASE}:{name}"),
            safe_file(root, name).decode(),
            pattern,
            expected,
        )
        for name, pattern, expected in (
            ("podvoice/config.yaml", r'^version: "[^"\n]+"$', 'version: "2.0.33"'),
            (
                "podvoice/gatekeeper/__init__.py",
                r'^__version__ = "[^"\n]+"$',
                '__version__ = "2.0.33"',
            ),
            ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.33"'),
        )
    )


def validate(root: Path, report: legacy.CandidateScope, base_tip: str, record: dict) -> bool:
    if (
        not DOMAINS
        or not PRODUCTION
        or not REVIEWER.strip()
        or not IMMUTABLE
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
        or not previous.previous.pins_match(root, IMMUTABLE)
        or previous.previous.ast_sha(safe_file(root, PROFILE), "PROFILE_AST") != PROFILE_AST
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
        or manifest["schema"] != "podview33.admission.v1"
        or manifest["base"] != BASE
    ):
        return False
    prod, tests, runtime, config, policy, tooling = (
        manifest[k] for k in ("production", "regressions", "runtime", "config", "policy", "tooling")
    )
    if (
        not all(
            previous.previous.pins_match(root, pins)
            for pins in (prod, tests, runtime, config, policy, tooling)
        )
        or set(prod) != PRODUCTION
        or set(tests) != REQUIRED_TESTS
        or set(config) != CONFIG
        or set(policy) != POLICY - {PROFILE, MANIFEST}
        or set(tooling) != TOOLING
        or set(runtime) != previous.previous.runtime_inventory(root)
        or not set(prod) <= set(runtime)
        or any(not p.startswith("tests/") for p in tests)
        or not config_only(root)
        or not previous.previous.assets_match(root, runtime, manifest["asset_count"])
    ):
        return False
    effective = legacy._visual_repository_changes(root, BASE)
    if (
        {p for p in effective if p.startswith(legacy._PRODUCTION_PREFIXES)}
        - {"podvoice/gatekeeper/__init__.py"}
        != PRODUCTION
        or {p for p in effective if p.startswith("tests/")} != set(tests)
        or not REQUIRED_TESTS <= effective
        or any(
            p not in PRODUCTION | set(tests) | POLICY | CONFIG | TOOLING | {"podvoice/CHANGELOG.md"}
            and not p.startswith("docs/")
            for p in effective
        )
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
        and record["runtime_fingerprint"] == previous.previous.fingerprint(root, runtime)
        and record["config_fingerprint"] == previous.previous.fingerprint(root, CONFIG)
        and record["policy_fingerprint"] == previous.previous.fingerprint(root, POLICY)
        and record["tooling_fingerprint"] == previous.previous.fingerprint(root, TOOLING)
        and record["manifest_fingerprint"] == MANIFEST_SHA
    )


def inspect_repository(root: Path, base: str) -> legacy.CandidateScope:
    report = previous.inspect_repository(root, base)
    try:
        record = record_at(root)
        # Historical bases have their own unchanged caller branch. This33 entry
        # never falls back to generic PASS, even with a missing record/version.
        base_tip = legacy._git(root, "rev-parse", f"{base}^{{commit}}").strip()
        valid = record is not None and validate(root, report, base_tip, record)
        return replace(
            report,
            passed=valid,
            reason="exact reviewed PodView33 admission"
            if valid
            else "missing or invalid PodView33 admission",
        )
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, AttributeError):
        return replace(report, passed=False, reason="malformed PodView33 admission")


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
