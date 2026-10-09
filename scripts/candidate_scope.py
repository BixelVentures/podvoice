#!/usr/bin/env python3
"""Reject PodVoice candidates that mix independent production risk domains."""

from __future__ import annotations

import argparse
import ast
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


_PRODUCTION_PREFIXES = ("podvoice/gatekeeper/", "esphome/", "custom_components/podvoice/")
_IGNORED_PRODUCTION_FILES = {
    "podvoice/CHANGELOG.md",
    "podvoice/config.yaml",
    "podvoice/build.yaml",
}
_DOMAIN_PATTERNS = {
    "rearm": re.compile(
        r"rearm|wake[_ -]?latch|wake[_ -]?detector|micro_wake_word|"
        r"(?:wake|detector|mic|microphone)[_ -]?continuity|next_wake",
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

_AUDIO_ANALYSIS_SURFACES = {
    "podvoice/gatekeeper/__init__.py",
    "podvoice/gatekeeper/__main__.py",
    "podvoice/gatekeeper/audio_analysis.py",
    "podvoice/gatekeeper/web.py",
    "podvoice/gatekeeper/static/index.html",
}

_NATIVE_QUIET_SURFACES = {
    "podvoice/gatekeeper/__init__.py",
    "podvoice/gatekeeper/thin.py",
    "podvoice/gatekeeper/live_idle.py",
    "podvoice/gatekeeper/audio_trace.py",
}
_NATIVE_QUIET_REGRESSIONS = {
    "tests/unit/test_live_idle.py",
    "tests/integration/test_thin_live_idle.py",
    "tests/integration/test_thin_live_quiet_close.py",
}
_NATIVE_QUIET_TRACE_REGRESSIONS = {
    "tests/unit/test_audio_trace.py",
    "tests/integration/test_thin_activity_observer.py",
}

# One reviewed observation chain: native wake reference -> Thin/provider evidence
# -> bounded local recording -> honest artifact consumers. Domain words describe
# observed events, not permission to mix unrelated tools/prompts/lifecycle changes.
_AUTOMATIC_DIAGNOSTIC_SURFACES = {
    "podvoice/gatekeeper/__init__.py",
    "podvoice/gatekeeper/__main__.py",
    "podvoice/gatekeeper/audio_analysis.py",
    "podvoice/gatekeeper/audio_trace.py",
    "podvoice/gatekeeper/openai_live.py",
    "podvoice/gatekeeper/static/index.html",
    "podvoice/gatekeeper/thin.py",
    "podvoice/gatekeeper/trace_oracle.py",
    "podvoice/gatekeeper/voicepe.py",
    "podvoice/gatekeeper/wake_reference.py",
    "esphome/components/micro_wake_word/micro_wake_word.cpp",
    "esphome/components/micro_wake_word/wake_audio_clock.h",
    "esphome/components/podvoice_audio/__init__.py",
    "esphome/components/podvoice_audio/podvoice_audio.cpp",
    "esphome/components/podvoice_audio/podvoice_audio.h",
    "esphome/components/podvoice_reply/podvoice_reply.h",
    "esphome/podvoice-live-alpha.yaml",
    "esphome/podvoice.yaml",
    "esphome/voice-pe-podvoice-base.yaml",
}
_AUTOMATIC_DIAGNOSTIC_REQUIRED = {
    "podvoice/gatekeeper/audio_trace.py",
    "podvoice/gatekeeper/thin.py",
    "podvoice/gatekeeper/voicepe.py",
    "podvoice/gatekeeper/wake_reference.py",
    "podvoice/gatekeeper/openai_live.py",
    "esphome/components/micro_wake_word/wake_audio_clock.h",
    "esphome/components/podvoice_audio/podvoice_audio.cpp",
}
_AUTOMATIC_DIAGNOSTIC_REGRESSIONS = {
    "tests/unit/test_audio_trace_automatic.py",
    "tests/integration/test_thin_automatic_diagnostics.py",
    "tests/unit/test_voicepe_wake_reference.py",
    "tests/unit/test_wake_reference.py",
    "tests/unit/test_openai_live.py",
    "tests/firmware/wake_reference_test.cpp",
    "tests/unit/test_mww_streaming.py",
    "tests/unit/test_live_wav_firmware.py",
    "tests/unit/test_firmware_contract.py",
    "tests/firmware/boot_package_regression.py",
    "tests/unit/test_audio_analysis.py",
    "tests/unit/test_trace_oracle.py",
    "tests/browser/audio_analysis_visibility.cjs",
}

# One reviewed chain: existing native PCM/source fence -> visible closing TX ->
# one Thin-owned bounded judge -> existing preservation/finalizer. These exact
# support surfaces and fixed probe inputs are not a general three-domain waiver.
_BOUNDED_LIVE_CLOSING_SURFACES = {
    "podvoice/gatekeeper/__init__.py",
    "podvoice/gatekeeper/__main__.py",
    "podvoice/gatekeeper/eval_harness.py",
    "podvoice/gatekeeper/live_audio_judge.py",
    "podvoice/gatekeeper/live_idle.py",
    "podvoice/gatekeeper/openai_live.py",
    "podvoice/gatekeeper/settings.py",
    "podvoice/gatekeeper/static/index.html",
    "podvoice/gatekeeper/thin.py",
    "podvoice/gatekeeper/usage.py",
    "podvoice/gatekeeper/voicepe.py",
    "podvoice/gatekeeper/web.py",
    "esphome/components/closing_led.upstream.json",
    "esphome/components/esp32_rmt_led_strip/__init__.py",
    "esphome/components/esp32_rmt_led_strip/led_strip.cpp",
    "esphome/components/esp32_rmt_led_strip/led_strip.h",
    "esphome/components/esp32_rmt_led_strip/light.py",
    "esphome/components/podvoice_audio/__init__.py",
    "esphome/components/podvoice_audio/podvoice_audio.cpp",
    "esphome/components/podvoice_audio/podvoice_audio.h",
    "esphome/podvoice-live-alpha.yaml",
    "esphome/podvoice.yaml",
    "podvoice/gatekeeper/eval_audio_idle/manifest.json",
    "podvoice/gatekeeper/eval_audio_idle/boundary_directed.pcm",
    "podvoice/gatekeeper/eval_audio_idle/directed_over_tv.pcm",
    "podvoice/gatekeeper/eval_audio_idle/peter_aside.pcm",
    "podvoice/gatekeeper/eval_audio_idle/quiet.pcm",
    "podvoice/gatekeeper/eval_audio_idle/tv.pcm",
}
_BOUNDED_LIVE_CLOSING_REQUIRED = {
    "podvoice/gatekeeper/thin.py",
    "podvoice/gatekeeper/live_idle.py",
    "podvoice/gatekeeper/live_audio_judge.py",
    "podvoice/gatekeeper/openai_live.py",
    "podvoice/gatekeeper/voicepe.py",
    "esphome/components/podvoice_audio/podvoice_audio.cpp",
    "esphome/components/podvoice_audio/podvoice_audio.h",
    "esphome/components/esp32_rmt_led_strip/led_strip.cpp",
    "esphome/components/esp32_rmt_led_strip/led_strip.h",
    "esphome/podvoice-live-alpha.yaml",
    "esphome/podvoice.yaml",
}
_BOUNDED_LIVE_CLOSING_REGRESSIONS = {
    "tests/integration/test_thin_closing_attempt.py",
    "tests/unit/test_callback_source.py",
    "tests/unit/test_voicepe_closing.py",
    "tests/unit/test_live_closure_receipt.py",
    "tests/unit/test_packaged_live_audio_judge.py",
    "tests/unit/test_closing_activation.py",
    "tests/unit/test_closing_rmt_hook.py",
    "tests/unit/test_mww_streaming.py",
    "tests/unit/test_firmware_contract.py",
    "tests/unit/test_live_wav_firmware.py",
    "tests/unit/test_live_usage.py",
    "tests/firmware/callback_source_test.cpp",
    "tests/firmware/closing_source_test.cpp",
    "tests/firmware/closing_rmt_hook.py",
}

# Removing the audio judge couples model END admission to the same native close
# and cleanup owner. Admit that reviewed add-on-only chain, never a general
# semantics/rearm waiver or changes to firmware, VAD, transport or HA tools.
_NATIVE_APP_CLOSING_SURFACES = {
    "podvoice/gatekeeper/__init__.py",
    "podvoice/gatekeeper/live_prompt.py",
    "podvoice/gatekeeper/static/index.html",
    "podvoice/gatekeeper/thin.py",
    "podvoice/gatekeeper/voicepe.py",
}
_NATIVE_APP_CLOSING_REQUIRED = {
    "podvoice/gatekeeper/live_prompt.py",
    "podvoice/gatekeeper/thin.py",
    "podvoice/gatekeeper/voicepe.py",
}
_NATIVE_APP_CLOSING_REGRESSIONS = {
    "tests/integration/test_thin_live.py",
    "tests/integration/test_thin_live_idle_preclose.py",
    "tests/integration/test_thin_panel_status.py",
    "tests/unit/test_voicepe_closing.py",
}

# Passive loss accounting and read-only daily UI name lifecycle/tool owners.
# Admit only this reviewed observation chain; no provider, prompt, adapter or
# firmware surface can join it through the broader existing coupling tuples.
_PASSIVE_DIAGNOSTIC_UI_REQUIRED = {
    "podvoice/gatekeeper/audio_trace.py",
    "podvoice/gatekeeper/diagnostic_retention.py",
    "podvoice/gatekeeper/static/index.html",
    "podvoice/gatekeeper/thin.py",
}
_PASSIVE_DIAGNOSTIC_UI_SURFACES = _PASSIVE_DIAGNOSTIC_UI_REQUIRED | {
    "podvoice/gatekeeper/__init__.py",
}
_PASSIVE_DIAGNOSTIC_UI_REGRESSIONS = {
    "tests/unit/test_audio_trace_automatic.py",
    "tests/unit/test_diagnostic_retention.py",
    "tests/integration/test_thin_automatic_diagnostics.py",
    "tests/unit/test_panel_contract.py",
    "tests/browser/daily_ui.cjs",
    "tests/browser/live_status.cjs",
    "tests/browser/wake_words.cjs",
}

# Reviewed passive startup-burst recording, immutable local HIL fixtures and
# read-only UI. This is a new exact tree, not an extension of the v2 chain.
_PASSIVE_BURST_UI_HIL_REQUIRED = {
    "podvoice/gatekeeper/audio_trace.py",
    "podvoice/gatekeeper/acoustic_hil.py",
    "podvoice/gatekeeper/static/index.html",
}
_PASSIVE_BURST_UI_HIL_SURFACES = _PASSIVE_BURST_UI_HIL_REQUIRED | {
    "podvoice/gatekeeper/__init__.py",
    "podvoice/gatekeeper/diagnostic_retention.py",
}
_PASSIVE_BURST_UI_HIL_REGRESSIONS = {
    "tests/unit/test_audio_trace_burst.py",
    "tests/unit/test_audio_trace_automatic.py",
    "tests/integration/test_thin_provider_audio_trace.py",
    "tests/unit/test_acoustic_hil.py",
    "tests/unit/test_panel_contract.py",
    "tests/browser/daily_ui.cjs",
    "tests/browser/live_status.cjs",
}
_PASSIVE_BURST_RETENTION_REGRESSION = "tests/unit/test_diagnostic_retention.py"


# Exact reviewed Thin app-idle input protection plus passive daily UI. Names of
# native events in UI labels do not grant adapter, firmware or semantic authority.
_NATIVE_IDLE_INPUT_UI_REQUIRED = {
    "podvoice/gatekeeper/thin.py",
    "podvoice/gatekeeper/static/index.html",
}
_NATIVE_IDLE_INPUT_UI_SURFACES = _NATIVE_IDLE_INPUT_UI_REQUIRED | {
    "podvoice/gatekeeper/__init__.py",
}
_NATIVE_IDLE_INPUT_UI_REGRESSIONS = {
    "tests/integration/test_thin_live_idle.py",
    "tests/integration/test_thin_live_idle_preclose.py",
    "tests/integration/test_thin_live_idle_protection.py",
    "tests/integration/test_thin_live_resumed_input_preclose.py",
    "tests/integration/test_thin_live_ten_cycles.py",
    "tests/integration/test_thin_panel_status.py",
    "tests/browser/daily_ui.cjs",
    "tests/integration/test_talk_webrtc_browser.py",
}


# Character matching without autojunk can become quadratic on large repeated diffs.
# Above this bound, include whole changed lines: extra domains require review, but
# no executable scope is lost and fingerprint/coupling checks remain unchanged.
_MAX_FINE_DIFF_CHARS = 10_000


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
    # Only actual hunk contents can establish the metadata exemption. Added
    # unary expressions such as +++call() are code, not diff file headers.
    version_removed: list[str] = []
    version_added: list[str] = []
    in_hunk = False
    valid_version_hunks = True
    for line in production_diff.split("\n"):
        if line.startswith("diff --git "):
            in_hunk = False
        elif line.startswith("@@ "):
            in_hunk = True
        elif in_hunk and line.startswith("-"):
            version_removed.append(line[1:])
        elif in_hunk and line.startswith("+"):
            version_added.append(line[1:])
        elif in_hunk and line not in ("", "\\ No newline at end of file"):
            # Repository inspection uses unified=0. A context/unprefixed line
            # can conceal code after universal-newline conversion of bare CR.
            valid_version_hunks = False
    version_assignment = re.compile(r"__version__\s*=\s*(['\"])\d+\.\d+\.\d+\1")
    if (
        production == ("podvoice/gatekeeper/__init__.py",)
        and valid_version_hunks
        and len(version_removed) == len(version_added) == 1
        and version_assignment.fullmatch(version_removed[0])
        and version_assignment.fullmatch(version_added[0])
    ):
        return CandidateScope("", "", (), tests, (), True, "version metadata only")
    old_code = "\n".join(line for line in removed if not line.lstrip().startswith(("#", "//")))
    new_code = "\n".join(line for line in added if not line.lstrip().startswith(("#", "//")))
    large_diff = len(old_code) + len(new_code) > _MAX_FINE_DIFF_CHARS
    # This exact field names the native encrypted transport key, not audio filtering.
    # Normalize classification text only; raw tree/review fingerprints stay unchanged.
    old_code = re.sub(r"\bvoicepe_noise_psk\b", "voicepe_psk", old_code)
    new_code = re.sub(r"\bvoicepe_noise_psk\b", "voicepe_psk", new_code)
    if large_diff:
        production_code = old_code + "\n" + new_code
    else:
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
        capture_output=True,
        timeout=20,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(
            result.stderr.decode("utf-8", errors="replace").strip()
            or f"git {' '.join(args)} failed"
        )
    # CR inside an added Git line must never become a fabricated diff boundary.
    return result.stdout.decode("utf-8")


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


def _base_inventory(root: Path, merge_base: str) -> dict[str, tuple[str, str]]:
    entries = {}
    for entry in _git(root, "ls-tree", "-r", "-z", "--full-tree", merge_base).split("\0"):
        if entry:
            info, name = entry.split("\t", 1)
            mode, _kind, oid = info.split(" ")
            entries[name] = (mode, oid)
    return entries


def _effective_file(root: Path, name: str) -> tuple[str, bytes]:
    path = root / name
    if path.is_symlink():
        return "120000", os.readlink(path).encode()
    if path.is_file():
        return ("100755" if path.stat().st_mode & 0o111 else "100644"), path.read_bytes()
    if not path.exists():
        return "deleted", b""
    raise RuntimeError(f"unsupported candidate file type: {name}")


def _requires_passive_burst_ui_hil(root: Path, merge_base: str) -> bool:
    # The reviewed observation combination cannot downgrade to a legacy record
    # or pass the ordinary single-domain classifier by deleting the record.
    base = _base_inventory(root, merge_base)
    algorithm = _git(root, "rev-parse", "--show-object-format").strip()
    changed = set()
    for name in _PASSIVE_BURST_UI_HIL_REQUIRED:
        mode, data = _effective_file(root, name)
        if mode == "deleted" and name not in base:
            continue
        oid = hashlib.new(algorithm, b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if base.get(name) != (mode, oid):
            changed.add(name)
    return "podvoice/gatekeeper/acoustic_hil.py" in changed and bool(
        changed & {"podvoice/gatekeeper/audio_trace.py", "podvoice/gatekeeper/static/index.html"}
    )


def _native_idle_input_ui_review_requirements(root: Path, merge_base: str) -> tuple[bool, bool]:
    # Effective owner surfaces, not lexical hits, test presence or index flags,
    # decide whether a record is mandatory. Keep legacy review validators intact.
    base = _base_inventory(root, merge_base)
    algorithm = _git(root, "rev-parse", "--show-object-format").strip()
    changed = set()
    current = {}
    for name in _NATIVE_IDLE_INPUT_UI_REQUIRED:
        mode, data = _effective_file(root, name)
        current[name] = (mode, data)
        if mode == "deleted" and name not in base:
            continue
        oid = hashlib.new(algorithm, b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if base.get(name) != (mode, oid):
            changed.add(name)
    if changed != _NATIVE_IDLE_INPUT_UI_REQUIRED:
        return False, False
    name = "podvoice/gatekeeper/thin.py"
    mode, data = current[name]
    if mode not in {"100644", "100755"}:
        raise ValueError("native idle input owner must be a regular Python file")
    before = b""
    if name in base:
        if base[name][0] not in {"100644", "100755"}:
            raise ValueError("unknown baseline native idle input owner")
        result = subprocess.run(
            ["git", "cat-file", "blob", base[name][1]],
            cwd=root,
            capture_output=True,
            timeout=20,
            check=False,
        )
        if result.returncode:
            raise RuntimeError("could not read baseline native idle input owner blob")
        before = result.stdout

    identifiers = (
        b"ThinSession",
        b"_live_idle_input_currency",
        b"_live_idle_quiet_owner",
        b"_sync_live_idle_input",
    )
    if not any(identifier in source for identifier in identifiers for source in (before, data)):
        # Older unrelated review fixtures may be raw domain text. Only absence
        # on BOTH sides proves these particular method-owner maps absent.
        return True, False

    def owners(source: bytes) -> dict[str, str]:
        tree = ast.parse(source)
        classes = [
            n for n in ast.walk(tree) if isinstance(n, ast.ClassDef) and n.name == "ThinSession"
        ]
        if len(classes) > 1 or (classes and classes[0] not in tree.body):
            raise ValueError("ambiguous ThinSession owner")
        targets = {"_live_idle_input_currency", "_live_idle_quiet_owner", "_sync_live_idle_input"}
        direct = classes[0].body if classes else ()
        pending = list(direct)
        methods = {}
        while pending:
            node = pending.pop()
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.name in targets:
                    if node not in direct or node.name in methods:
                        raise ValueError("ambiguous native idle input method owner")
                    methods[node.name] = ast.dump(node, include_attributes=False)
                # Locals in any method do not bind the enclosing class namespace.
                continue
            if isinstance(node, ast.ClassDef):
                if node.name in targets:
                    raise ValueError("class overwrites native idle input method owner")
                # The nested class name binds here; its body has its own scope.
                continue
            if isinstance(node, ast.Lambda):
                continue
            if (
                isinstance(node, (ast.ExceptHandler, ast.MatchAs, ast.MatchStar))
                and node.name in targets
            ) or (isinstance(node, ast.MatchMapping) and node.rest in targets):
                raise ValueError("captured native idle input method owner")
            if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
                if node.id in targets:
                    raise ValueError("overwritten native idle input method owner")
            if isinstance(node, (ast.Import, ast.ImportFrom)) and any(
                (alias.asname or alias.name.split(".")[0]) in targets for alias in node.names
            ):
                raise ValueError("imported native idle input method owner")
            pending.extend(ast.iter_child_nodes(node))
        return methods

    return True, owners(before) != owners(data)


def _effective_changes(root: Path, merge_base: str, paths: Sequence[str]) -> set[str]:
    # Compare effective bytes/modes directly with Git blobs. Diff flags can hide
    # a required regression or an extra owner; opposing index/worktree changes
    # can also name a file which is actually unchanged from the reviewed base.
    base = _base_inventory(root, merge_base)
    tracked = _git(root, "ls-files", "-z").split("\0")
    untracked = _git(root, "ls-files", "-z", "--others", "--exclude-standard").split("\0")
    names = {
        name
        for name in (*base, *tracked, *untracked, *paths)
        if name.startswith((*_PRODUCTION_PREFIXES, "tests/"))
        and name not in _IGNORED_PRODUCTION_FILES
    }
    algorithm = _git(root, "rev-parse", "--show-object-format").strip()
    changed = set()
    for name in names:
        mode, data = _effective_file(root, name)
        oid = hashlib.new(algorithm, b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if base.get(name) != (mode, oid):
            changed.add(name)
    return changed


def regression_fingerprint(
    root: Path, base_tip: str, merge_base: str, paths: Sequence[str] = ()
) -> str:
    """Bind v3 review to every effective test, including hidden flags/deletions."""
    tracked = _git(root, "ls-files", "-z").split("\0")
    untracked = _git(root, "ls-files", "-z", "--others", "--exclude-standard").split("\0")
    inventory = {
        name
        for name in (
            *_base_inventory(root, merge_base),
            *tracked,
            *untracked,
            *paths,
            *_PASSIVE_BURST_UI_HIL_REGRESSIONS,
        )
        if name.startswith("tests/")
    }
    manifest = []
    for name in sorted(inventory):
        mode, data = _effective_file(root, name)
        if mode == "120000":
            # A non-required test symlink still must bind its effective contents,
            # not just the target spelling. Required regressions deny links below.
            path = root / name
            data += b"\0" + (path.read_bytes() if path.is_file() else b"missing target")
        manifest.append((name, mode, hashlib.sha256(data).hexdigest()))
    payload = {"base_tip": base_tip, "merge_base": merge_base, "files": manifest}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def _effective_version_metadata_only(root: Path, merge_base: str, name: str) -> bool:
    baseline = _base_inventory(root, merge_base).get(name)
    mode, current = _effective_file(root, name)
    if baseline is None or mode not in {"100644", "100755"} or mode != baseline[0]:
        return False
    result = subprocess.run(
        ["git", "cat-file", "blob", baseline[1]],
        cwd=root,
        capture_output=True,
        timeout=20,
        check=False,
    )
    if result.returncode:
        raise RuntimeError("could not read baseline version metadata blob")
    # Preserve every other byte, including line endings. Git diff can hide
    # effective runtime code behind a staged version and hidden index flags.
    before, after = result.stdout.split(b"\n"), current.split(b"\n")
    if len(before) != len(after):
        return False
    changes = [(old, new) for old, new in zip(before, after, strict=True) if old != new]
    version = re.compile(rb"__version__[ \t]*=[ \t]*(['\"])\d+\.\d+\.\d+\1")
    return len(changes) == 1 and all(version.fullmatch(line) for line in changes[0])


def _reviewed_passive_burst_ui_hil(
    root: Path, report: CandidateScope, base_tip: str, record: dict
) -> bool:
    fields = {
        "version",
        "kind",
        "base_tip",
        "merge_base",
        "domains",
        "fingerprint",
        "regression_fingerprint",
        "reviewer",
        "rationale",
    }
    if (
        set(record) != fields
        or record["kind"] != "passive_burst_ui_hil"
        or record["domains"] != ["ha_tools"]
        or report.domains != ("ha_tools",)
        or any(
            not isinstance(record[key], str) or not record[key].strip()
            for key in fields - {"version", "domains"}
        )
        or record["base_tip"] != base_tip
        or record["merge_base"] != report.base
    ):
        return False
    effective = _effective_changes(
        root, report.base, (*report.production_files, *report.test_files)
    )
    production = {name for name in effective if name.startswith(_PRODUCTION_PREFIXES)} | set(
        report.production_files
    )
    regressions = set(_PASSIVE_BURST_UI_HIL_REGRESSIONS)
    if "podvoice/gatekeeper/diagnostic_retention.py" in production:
        regressions.add(_PASSIVE_BURST_RETENTION_REGRESSION)
    if (
        not _PASSIVE_BURST_UI_HIL_REQUIRED <= effective
        or not production <= _PASSIVE_BURST_UI_HIL_SURFACES
        or not regressions <= effective
        or any(
            not (root / name).is_file() or (root / name).is_symlink()
            for name in production | regressions
        )
    ):
        return False
    metadata = "podvoice/gatekeeper/__init__.py"
    if metadata in production and not _effective_version_metadata_only(root, report.base, metadata):
        return False
    return record["fingerprint"] == production_fingerprint(
        root, base_tip, report.base, report.production_files
    ) and record["regression_fingerprint"] == regression_fingerprint(
        root, base_tip, report.base, report.test_files
    )


def _reviewed_native_idle_input_passive_ui(
    root: Path, report: CandidateScope, base_tip: str, record: dict
) -> bool:
    fields = {
        "version",
        "kind",
        "base_tip",
        "merge_base",
        "domains",
        "fingerprint",
        "regression_fingerprint",
        "reviewer",
        "rationale",
    }
    if (
        set(record) != fields
        or record["kind"] != "native_idle_input_passive_ui"
        or record["domains"] != ["audio_input", "rearm"]
        or report.domains != ("audio_input", "rearm")
        or any(
            not isinstance(record[key], str) or not record[key].strip()
            for key in fields - {"version", "domains"}
        )
        or record["base_tip"] != base_tip
        or record["merge_base"] != report.base
    ):
        return False
    effective = _effective_changes(
        root, report.base, (*report.production_files, *report.test_files)
    )
    production = {name for name in effective if name.startswith(_PRODUCTION_PREFIXES)} | set(
        report.production_files
    )
    if (
        not _NATIVE_IDLE_INPUT_UI_REQUIRED <= effective
        or not production <= _NATIVE_IDLE_INPUT_UI_SURFACES
        or not _NATIVE_IDLE_INPUT_UI_REGRESSIONS <= effective
        or any(
            not (root / name).is_file() or (root / name).is_symlink()
            for name in production | _NATIVE_IDLE_INPUT_UI_REGRESSIONS
        )
    ):
        return False
    metadata = "podvoice/gatekeeper/__init__.py"
    if metadata in production and not _effective_version_metadata_only(root, report.base, metadata):
        return False
    return record["fingerprint"] == production_fingerprint(
        root, base_tip, report.base, report.production_files
    ) and record["regression_fingerprint"] == regression_fingerprint(
        root, base_tip, report.base, report.test_files
    )


def reviewed_coupling(root: Path, report: CandidateScope, base_tip: str) -> CandidateScope:
    status = root / "docs/STATUS.md"
    text = status.read_text() if status.exists() else ""
    marker = "<!-- candidate-scope-coupling"
    strict_v3_required = _requires_passive_burst_ui_hil(root, report.base)
    failed = replace(report, passed=False, reason="invalid or stale reviewed coupling record")
    try:
        idle_ui_required, strict_v4_required = _native_idle_input_ui_review_requirements(
            root, report.base
        )
    except (SyntaxError, UnicodeError, ValueError):
        return failed
    if marker not in text:
        if strict_v3_required:
            return replace(
                report, passed=False, reason="passive_burst_ui_hil requires strict v3 review"
            )
        if idle_ui_required:
            return replace(report, passed=False, reason="changed Thin+UI requires exact review")
        return report
    records = re.findall(r"<!-- candidate-scope-coupling\n(.*?)\n-->", text, re.DOTALL)
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
    if not isinstance(record, dict) or type(record.get("version")) is not int:
        return failed
    if record["version"] == 4:
        if strict_v3_required or not _reviewed_native_idle_input_passive_ui(
            root, report, base_tip, record
        ):
            return failed
        return replace(
            report, passed=True, reason="exact reviewed coupling: native_idle_input_passive_ui"
        )
    if strict_v4_required and not strict_v3_required:
        return failed
    if record["version"] == 3:
        if not _reviewed_passive_burst_ui_hil(root, report, base_tip, record):
            return failed
        return replace(report, passed=True, reason="exact reviewed coupling: passive_burst_ui_hil")
    if strict_v3_required:
        return failed
    passive_diagnostic_ui_v2 = record["version"] == 2
    if passive_diagnostic_ui_v2:
        if set(record) != fields | {"kind"} or record["kind"] != "passive_diagnostic_ui":
            return failed
    elif record["version"] != 1 or set(record) != fields:
        return failed
    # Reading input/playback event names for a completed-recording report spans
    # both classifier domains. It still needs an independent exact-tree review;
    # this admission never extends to the conversation engine, adapters or firmware.
    reviewed_audio_analysis = (
        report.domains == ("audio_input", "physical_output")
        and "podvoice/gatekeeper/audio_analysis.py" in report.production_files
        and set(report.production_files) <= _AUDIO_ANALYSIS_SURFACES
    )
    # Native inactivity necessarily combines fresh input with consumed output.
    # Admit only the shared Thin policy and its observation sink, with the real
    # helper and full close-chain regressions. This is still an exact-tree review,
    # not a generic admission for input/output changes or firmware/adapters.
    quiet_regressions = _NATIVE_QUIET_REGRESSIONS
    if "podvoice/gatekeeper/audio_trace.py" in report.production_files:
        quiet_regressions = quiet_regressions | _NATIVE_QUIET_TRACE_REGRESSIONS
    reviewed_native_quiet = (
        report.domains == ("audio_input", "physical_output")
        and {"podvoice/gatekeeper/thin.py", "podvoice/gatekeeper/live_idle.py"}
        <= set(report.production_files)
        and set(report.production_files) <= _NATIVE_QUIET_SURFACES
        and quiet_regressions <= set(report.test_files)
        and all((root / path).is_file() for path in quiet_regressions)
    )
    reviewed_automatic_diagnostics = (
        report.domains == ("ha_tools", "physical_output", "realtime_semantics", "rearm")
        and _AUTOMATIC_DIAGNOSTIC_REQUIRED <= set(report.production_files)
        and all((root / path).is_file() for path in _AUTOMATIC_DIAGNOSTIC_REQUIRED)
        and set(report.production_files) <= _AUTOMATIC_DIAGNOSTIC_SURFACES
        and _AUTOMATIC_DIAGNOSTIC_REGRESSIONS <= set(report.test_files)
        and all((root / path).is_file() for path in _AUTOMATIC_DIAGNOSTIC_REGRESSIONS)
    )
    reviewed_bounded_live_closing = (
        report.domains == ("audio_input", "physical_output", "realtime_semantics")
        and _BOUNDED_LIVE_CLOSING_REQUIRED <= set(report.production_files)
        and all((root / path).is_file() for path in _BOUNDED_LIVE_CLOSING_REQUIRED)
        and set(report.production_files) <= _BOUNDED_LIVE_CLOSING_SURFACES
        and _BOUNDED_LIVE_CLOSING_REGRESSIONS <= set(report.test_files)
        and all((root / path).is_file() for path in _BOUNDED_LIVE_CLOSING_REGRESSIONS)
    )
    reviewed_native_app_closing = (
        report.domains == ("realtime_semantics", "rearm")
        and _NATIVE_APP_CLOSING_REQUIRED <= set(report.production_files)
        and all((root / path).is_file() for path in _NATIVE_APP_CLOSING_REQUIRED)
        and set(report.production_files) <= _NATIVE_APP_CLOSING_SURFACES
        and _NATIVE_APP_CLOSING_REGRESSIONS <= set(report.test_files)
        and all((root / path).is_file() for path in _NATIVE_APP_CLOSING_REGRESSIONS)
    )
    native_timer_bridge = {
        "custom_components/podvoice/__init__.py",
        "custom_components/podvoice/config_flow.py",
        "custom_components/podvoice/manifest.json",
        "custom_components/podvoice/services.yaml",
        "custom_components/podvoice/timer_bridge.py",
    }
    native_timer_runtime = {
        "podvoice/gatekeeper/__init__.py",
        "podvoice/gatekeeper/__main__.py",
        "podvoice/gatekeeper/eval_harness.py",
        "podvoice/gatekeeper/eval_scenarios.json",
        "podvoice/gatekeeper/execution_policy.py",
        "podvoice/gatekeeper/ha_timers.py",
        "podvoice/gatekeeper/static/index.html",
        "podvoice/gatekeeper/talk.py",
        "podvoice/gatekeeper/thin.py",
        "podvoice/gatekeeper/tools.py",
        "podvoice/gatekeeper/voicepe.py",
        "podvoice/gatekeeper/web.py",
    }
    native_timer_regressions = {
        "tests/unit/test_ha_timer_bridge.py",
        "tests/unit/test_eval_harness.py",
        "tests/integration/test_ha_timer_flow.py",
        "tests/integration/test_talk.py",
        "tests/browser/talk_exit_contract.cjs",
    }
    reviewed_native_timers = (
        report.domains == ("ha_tools", "physical_output", "realtime_semantics", "rearm")
        and native_timer_bridge | {"podvoice/gatekeeper/ha_timers.py"}
        <= set(report.production_files)
        and set(report.production_files) <= native_timer_runtime | native_timer_bridge
        and native_timer_regressions <= set(report.test_files)
        and all((root / path).is_file() for path in native_timer_regressions | native_timer_bridge)
    )
    # Unchanged idle-input owners still require exact Thin+UI review even when
    # classification already admits the candidate's single domain.
    reviewed_single_domain_idle_ui = (
        record["version"] == 1
        and idle_ui_required
        and not strict_v4_required
        and report.passed
        and len(report.domains) == 1
    )
    passive_metadata_only = True
    metadata = "podvoice/gatekeeper/__init__.py"
    if passive_diagnostic_ui_v2 and metadata in report.production_files:
        metadata_diff = "\n".join(
            _git(root, *args)
            for args in (
                ("diff", "--unified=0", f"{report.base}...HEAD", "--", metadata),
                ("diff", "--unified=0", "--", metadata),
                ("diff", "--cached", "--unified=0", "--", metadata),
            )
        )
        passive_metadata_only = (
            classify_candidate([metadata], metadata_diff).reason == "version metadata only"
        )
    passive_effective_changes = set()
    if passive_diagnostic_ui_v2:
        # Opposing staged/unstaged hunks can name a path whose effective bytes
        # are back at the merge base. Such a path is not a changed regression/owner.
        passive_effective_changes.update(
            _git(root, "diff", "--name-only", "-z", report.base).split("\0")
        )
        passive_effective_changes.update(
            _git(root, "ls-files", "-z", "--others", "--exclude-standard").split("\0")
        )
    reviewed_passive_diagnostic_ui = (
        passive_diagnostic_ui_v2
        and _PASSIVE_DIAGNOSTIC_UI_REQUIRED <= set(report.production_files)
        and report.domains == ("ha_tools", "physical_output", "rearm")
        and set(report.production_files) <= _PASSIVE_DIAGNOSTIC_UI_SURFACES
        and _PASSIVE_DIAGNOSTIC_UI_REQUIRED <= passive_effective_changes
        and all(
            (root / path).is_file() and not (root / path).is_symlink()
            for path in report.production_files
        )
        and _PASSIVE_DIAGNOSTIC_UI_REGRESSIONS <= set(report.test_files)
        and _PASSIVE_DIAGNOSTIC_UI_REGRESSIONS <= passive_effective_changes
        and all(
            (root / path).is_file() and not (root / path).is_symlink()
            for path in _PASSIVE_DIAGNOSTIC_UI_REGRESSIONS
        )
        and passive_metadata_only
    )
    if (
        type(record["version"]) is not int
        or record["version"] not in (1, 2)
        or record["base_tip"] != base_tip
        or record["merge_base"] != report.base
        or record["domains"] != list(report.domains)
        or (passive_diagnostic_ui_v2 and not reviewed_passive_diagnostic_ui)
        or (
            not reviewed_audio_analysis
            and not reviewed_native_quiet
            and not reviewed_automatic_diagnostics
            and not reviewed_bounded_live_closing
            and not reviewed_native_app_closing
            and not reviewed_passive_diagnostic_ui
            and not reviewed_native_timers
            and not reviewed_single_domain_idle_ui
            and report.domains
            not in {
                ("physical_output", "rearm"),
                ("ha_tools", "realtime_semantics"),
                # Playback-result semantics can change without changing rearm;
                # admission still requires the exact independent review below.
                ("physical_output", "realtime_semantics"),
                # Alpha separates keyword eligibility from playback admission and
                # model-owned closure; the exact independent review remains required.
                ("physical_output", "realtime_semantics", "rearm"),
                # The approved Stop contract spans warm firmware inference, listening
                # admission, physical silence/rearm and model-owned semantic closure.
                # This tuple still needs the exact independent whole-tree review below.
                ("audio_input", "ha_tools", "physical_output", "realtime_semantics", "rearm"),
            }
        )
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
        (
            "diff",
            "--unified=0",
            f"{merge_base}...HEAD",
            "--",
            "podvoice/gatekeeper",
            "esphome",
            "custom_components/podvoice",
        ),
        (
            "diff",
            "--unified=0",
            "--",
            "podvoice/gatekeeper",
            "esphome",
            "custom_components/podvoice",
        ),
        (
            "diff",
            "--cached",
            "--unified=0",
            "--",
            "podvoice/gatekeeper",
            "esphome",
            "custom_components/podvoice",
        ),
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
