#!/usr/bin/env python3
"""Reject PodVoice candidates that mix independent production risk domains."""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import re
import subprocess
import sys
from collections.abc import Sequence
from dataclasses import asdict, dataclass, replace
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
        r"playback|reply_player|reply_play|announcement|resampler|mixer|speaker_path|"
        r"play_(?:url|pcm)|flac|set_volume|volume_call|rotary|encoder|\bdial\b|"
        r"\bmute\b|\bunmute\b",
        re.IGNORECASE,
    ),
    "audio_input": re.compile(
        r"\bvad\b|mic[_ -]?(?:gate|gain|channel|frame)|noise|speech_started|speech_stopped",
        re.IGNORECASE,
    ),
    "realtime_semantics": re.compile(
        r"response\.(?:created|done)|ResponseStarted|TurnComplete|InputTranscript|"
        r"OutputTranscript|reasoning|semantic_vad|end_conversation|wait_for_user",
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
    # Classify the text that actually changed, not unchanged words carried on a
    # replaced line. Example: replacing ``get_time`` with ``GetDateTime`` must not
    # classify the unchanged sibling ``end_conversation`` as a semantic change.
    removed: list[str] = []
    added: list[str] = []
    for line in production_diff.splitlines():
        if line.startswith("---") or line.startswith("+++"):
            continue
        if line.startswith("-"):
            removed.append(line[1:])
        elif line.startswith("+"):
            added.append(line[1:])
    old_code = "\n".join(line for line in removed if not line.lstrip().startswith(("#", "//")))
    new_code = "\n".join(line for line in added if not line.lstrip().startswith(("#", "//")))
    changed_fragments: list[str] = []
    matcher = difflib.SequenceMatcher(a=old_code, b=new_code, autojunk=False)
    for tag, old_start, old_end, new_start, new_end in matcher.get_opcodes():
        if tag == "equal":
            continue
        changed_fragments.extend((old_code[old_start:old_end], new_code[new_start:new_end]))
    production_code = "\n".join(changed_fragments)
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


def production_fingerprint(root: Path, base_tip: str, merge_base: str, paths: Sequence[str]) -> str:
    """Bind review to effective files, including unstaged bytes and untracked additions."""
    # Git diff can hide assume-unchanged/skip-worktree files. Bind the entire
    # effective production tree, not merely paths reported as changed.
    tracked = _git(root, "ls-files", "-z").split("\0")
    inventory = {
        name
        for name in (*tracked, *paths)
        if name not in _IGNORED_PRODUCTION_FILES and name.startswith(_PRODUCTION_PREFIXES)
    }
    manifest = []
    for name in sorted(inventory):
        path = root / name
        if path.is_symlink():
            mode, data = "120000", os.readlink(path).encode()
        elif path.is_file():
            mode = "100755" if path.stat().st_mode & 0o111 else "100644"
            data = path.read_bytes()
        elif not path.exists():
            mode, data = "deleted", b""
        else:
            raise RuntimeError(f"unsupported production file type: {name}")
        manifest.append((name, mode, hashlib.sha256(data).hexdigest()))
    payload = {"base_tip": base_tip, "merge_base": merge_base, "files": manifest}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def reviewed_coupling(root: Path, report: CandidateScope, base_tip: str) -> CandidateScope:
    status = root / "docs/STATUS.md"
    text = status.read_text() if status.exists() else ""
    marker = "<!-- candidate-scope-coupling"
    if marker not in text:
        return report
    records = re.findall(r"<!-- candidate-scope-coupling\n(.*?)\n-->", text, re.DOTALL)
    failed = replace(report, passed=False, reason="invalid or stale reviewed coupling record")
    if text.count(marker) != 1 or len(records) != 1:
        return failed
    try:
        record = json.loads(records[0], object_pairs_hook=_unique_record)
    except (ValueError, TypeError):
        return failed
    fields = {
        "version",
        "base_tip",
        "merge_base",
        "domains",
        "fingerprint",
        "reviewer",
        "rationale",
    }
    if not isinstance(record, dict) or set(record) != fields:
        return failed
    if (
        type(record["version"]) is not int
        or record["version"] != 1
        or record["base_tip"] != base_tip
        or record["merge_base"] != report.base
        or record["domains"] != list(report.domains)
        or report.domains
        not in {
            ("physical_output", "rearm"),
            ("ha_tools", "realtime_semantics"),
            # The approved Stop contract spans warm firmware inference, listening
            # admission, physical silence/rearm and model-owned semantic closure.
            # This tuple still needs the exact independent whole-tree review below.
            ("audio_input", "ha_tools", "physical_output", "realtime_semantics", "rearm"),
        }
        or not any((root / path).is_file() for path in report.test_files)
        or not isinstance(record["reviewer"], str)
        or not record["reviewer"].strip()
        or not isinstance(record["rationale"], str)
        or not record["rationale"].strip()
        or record["fingerprint"]
        != production_fingerprint(root, base_tip, report.base, report.production_files)
    ):
        return failed
    return replace(
        report, passed=True, reason="exact reviewed coupling: " + ", ".join(report.domains)
    )


def _unique_record(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate coupling field")
        result[key] = value
    return result


def inspect_repository(root: Path, base: str) -> CandidateScope:
    head = _git(root, "rev-parse", "HEAD").strip()
    base_tip = _git(root, "rev-parse", f"{base}^{{commit}}").strip()
    merge_base = _git(root, "merge-base", "HEAD", base).strip()
    changes: set[str] = set()
    diffs: list[str] = []
    for args in (
        ("diff", "--name-only", "-z", f"{merge_base}...HEAD"),
        ("diff", "--name-only", "-z"),
        ("diff", "--name-only", "-z", "--cached"),
        ("ls-files", "-z", "--others", "--exclude-standard"),
    ):
        changes.update(name for name in _git(root, *args).split("\0") if name)
    for args in (
        ("diff", "--unified=0", f"{merge_base}...HEAD", "--", "podvoice/gatekeeper", "esphome"),
        ("diff", "--unified=0", "--", "podvoice/gatekeeper", "esphome"),
        ("diff", "--cached", "--unified=0", "--", "podvoice/gatekeeper", "esphome"),
    ):
        diffs.append(_git(root, *args))
    result = classify_candidate(sorted(changes), "\n".join(diffs))
    report = CandidateScope(
        head=head,
        base=merge_base,
        production_files=result.production_files,
        test_files=result.test_files,
        domains=result.domains,
        passed=result.passed,
        reason=result.reason,
    )
    return reviewed_coupling(root, report, base_tip)


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
