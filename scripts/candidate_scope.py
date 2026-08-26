#!/usr/bin/env python3
"""Reject PodVoice candidates that mix independent production risk domains."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class CandidateScope:
    head: str
    base: str
    production_files: tuple[str, ...]
    test_files: tuple[str, ...]
    domains: tuple[str, ...]
    passed: bool
    reason: str


_PRODUCTION_PREFIXES = ("podvoice/gatekeeper/", "esphome/")
_IGNORED_PRODUCTION_FILES = {
    "podvoice/CHANGELOG.md",
    "podvoice/config.yaml",
    "podvoice/build.yaml",
}
_DOMAIN_PATTERNS = {
    "rearm": re.compile(
        r"rearm|wake[_ -]?latch|wake[_ -]?detector|micro_wake_word|continuity|next_wake",
        re.IGNORECASE,
    ),
    "physical_output": re.compile(
        r"playback|reply_player|reply_play|announcement|resampler|mixer|speaker|flac|"
        r"volume|rotary|encoder|dial|mute|unmute",
        re.IGNORECASE,
    ),
    "audio_input": re.compile(
        r"\bvad\b|mic[_ -]?(?:gate|gain|channel|frame)|noise|speech_started|speech_stopped",
        re.IGNORECASE,
    ),
    "realtime_semantics": re.compile(
        r"openai|realtime|response\.(?:created|done)|semantic|prompt|tool_call|transcript",
        re.IGNORECASE,
    ),
    "ha_tools": re.compile(
        r"\bmcp\b|home assistant|hass|tool_wire|execution_policy", re.IGNORECASE
    ),
}


def classify_candidate(changes: Sequence[str], production_diff: str) -> CandidateScope:
    production = tuple(
        sorted(
            path
            for path in changes
            if path not in _IGNORED_PRODUCTION_FILES
            and (path.startswith(_PRODUCTION_PREFIXES) or path == "esphome/podvoice.yaml")
        )
    )
    tests = tuple(sorted(path for path in changes if path.startswith("tests/")))
    # Comments explain adjacent invariants and routinely name other domains. They are
    # evidence for reviewers, not executable scope; classifying them made a volume-only
    # change look semantic merely because its comment said "gain semantics".
    code_lines: list[str] = []
    for line in production_diff.splitlines():
        body = line[1:] if line.startswith(("+", "-")) else line
        if body.lstrip().startswith(("#", "//")):
            continue
        code_lines.append(body)
    production_code = "\n".join(code_lines)
    domains = {
        name for name, pattern in _DOMAIN_PATTERNS.items() if pattern.search(production_code)
    }
    if production and not domains:
        domains.add("unclassified_runtime")

    if len(domains) > 1:
        passed = False
        reason = "candidate mixes independent production domains: " + ", ".join(sorted(domains))
    elif production and not tests:
        passed = False
        reason = "production candidate has no changed regression test"
    elif not production:
        passed = True
        reason = "no production runtime or firmware change"
    else:
        passed = True
        reason = f"single production domain: {next(iter(domains))}"

    return CandidateScope(
        head="",
        base="",
        production_files=production,
        test_files=tests,
        domains=tuple(sorted(domains)),
        passed=passed,
        reason=reason,
    )


def _git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-c", "core.quotepath=false", *args],
        cwd=root,
        text=True,
        capture_output=True,
        timeout=20,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout


def inspect_repository(root: Path, base: str) -> CandidateScope:
    head = _git(root, "rev-parse", "HEAD").strip()
    merge_base = _git(root, "merge-base", "HEAD", base).strip()
    changes: set[str] = set()
    diffs: list[str] = []
    for args in (
        ("diff", "--name-only", f"{merge_base}...HEAD"),
        ("diff", "--name-only"),
        ("diff", "--name-only", "--cached"),
        ("ls-files", "--others", "--exclude-standard"),
    ):
        changes.update(line for line in _git(root, *args).splitlines() if line)
    for args in (
        ("diff", "--unified=0", f"{merge_base}...HEAD", "--", "podvoice/gatekeeper", "esphome"),
        ("diff", "--unified=0", "--", "podvoice/gatekeeper", "esphome"),
        ("diff", "--cached", "--unified=0", "--", "podvoice/gatekeeper", "esphome"),
    ):
        diffs.append(_git(root, *args))
    result = classify_candidate(sorted(changes), "\n".join(diffs))
    return CandidateScope(
        head=head,
        base=merge_base,
        production_files=result.production_files,
        test_files=result.test_files,
        domains=result.domains,
        passed=result.passed,
        reason=result.reason,
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="origin/main")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        root = Path(_git(Path.cwd(), "rev-parse", "--show-toplevel").strip())
        report = inspect_repository(root, args.base)
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
        print(f"candidate scope stopped: {exc}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(asdict(report), indent=2))
    else:
        verdict = "PASS" if report.passed else "FAIL"
        print(f"candidate-scope {verdict}: {report.reason}")
        print(f"head={report.head} base={report.base}")
        print("production=" + (", ".join(report.production_files) or "none"))
        print("tests=" + (", ".join(report.test_files) or "none"))
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
