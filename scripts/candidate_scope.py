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


# One exact reviewed chain: sole Live startup/settings/UI plus native idle alarm.
# Names of adjacent owners do not grant other provider, prompt, tool or I/O surfaces.
# Required regressions must actually differ from the base; their complete effective
# bytes are independently reviewed and fingerprint-bound, not merely present.
_LIVE_STARTUP_IDLE_ALARM_REQUIRED = {
    "esphome/components/podvoice_reply/__init__.py",
    "esphome/components/podvoice_reply/podvoice_reply.h",
    "esphome/components/podvoice_reply/stop_context.h",
    "esphome/podvoice-live-alpha.yaml",
    "esphome/podvoice.yaml",
    "esphome/voice-pe-podvoice-base.yaml",
    "podvoice/gatekeeper/__main__.py",
    "podvoice/gatekeeper/config.py",
    "podvoice/gatekeeper/settings.py",
    "podvoice/gatekeeper/static/index.html",
    "podvoice/gatekeeper/thin.py",
    "podvoice/gatekeeper/voicepe.py",
}
_LIVE_STARTUP_IDLE_ALARM_REGRESSIONS = {
    "tests/firmware/boot_package_regression.py",
    "tests/browser/daily_ui.cjs",
    "tests/browser/settings_dirty.cjs",
    "tests/browser/settings_repair_contract.cjs",
    "tests/firmware/activity_wire_test.cpp",
    "tests/firmware/idle_timer_output_test.cpp",
    "tests/firmware/live_stop_pipeline_test.cpp",
    "tests/firmware/stop_idle_recovery_test.cpp",
    "tests/firmware/stop_pipeline_test.cpp",
    "tests/firmware/stop_retry_test.cpp",
    "tests/integration/test_ha_timer_flow.py",
    "tests/integration/test_ha_timer_native_output.py",
    "tests/integration/test_main_saved_live_selection.py",
    "tests/integration/test_main_settings_save_contract.py",
    "tests/integration/test_settings_integrity_startup.py",
    "tests/integration/test_thin.py",
    "tests/unit/test_button_firmware.py",
    "tests/unit/test_firmware_contract.py",
    "tests/unit/test_live_alpha_settings.py",
    "tests/unit/test_panel_contract.py",
    "tests/unit/test_settings_atomic_commit.py",
    "tests/unit/test_settings_integrity.py",
    "tests/unit/test_stop_word.py",
    "tests/unit/test_voicepe_contract.py",
}


_LIVE_STARTUP_IDLE_ALARM_SCOPE_REGRESSIONS = {
    "tests/unit/test_candidate_scope_live_startup_idle_alarm.py",
}


# Exact schema discovery -> immutable Live startup -> shared Thin lifecycle chain.
# This named profile never grants a generic four-domain admission.
_LIVE_SCHEMA_HEALTH_REQUIRED = {
    "podvoice/gatekeeper/live_prompt.py",
    "podvoice/gatekeeper/openai_live.py",
    "podvoice/gatekeeper/thin.py",
    "podvoice/gatekeeper/tools.py",
}
_LIVE_SCHEMA_HEALTH_REGRESSIONS = {
    "tests/unit/test_live_prompt.py",
    "tests/unit/test_openai_live.py",
    "tests/integration/test_thin_live.py",
    "tests/integration/test_thin_mcp_recovery.py",
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


def _reviewed_live_startup_idle_alarm(
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
    domains = ("audio_input", "physical_output", "realtime_semantics", "rearm")
    if (
        set(record) != fields
        or record["kind"] != "live_startup_native_idle_alarm"
        or report.domains != domains
        or record["domains"] != list(domains)
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
    metadata = "podvoice/gatekeeper/__init__.py"
    regressions = {name for name in effective if name.startswith("tests/")}
    if (
        not regressions
        <= _LIVE_STARTUP_IDLE_ALARM_REGRESSIONS | _LIVE_STARTUP_IDLE_ALARM_SCOPE_REGRESSIONS
        or not _LIVE_STARTUP_IDLE_ALARM_REQUIRED <= effective
        or not production <= _LIVE_STARTUP_IDLE_ALARM_REQUIRED | {metadata}
        or not _LIVE_STARTUP_IDLE_ALARM_REGRESSIONS <= effective
        or any(
            not (root / name).is_file() or (root / name).is_symlink()
            for name in production | regressions | _LIVE_STARTUP_IDLE_ALARM_REGRESSIONS
        )
    ):
        return False
    if metadata in production and not _effective_version_metadata_only(root, report.base, metadata):
        return False
    return record["fingerprint"] == production_fingerprint(
        root, base_tip, report.base, report.production_files
    ) and record["regression_fingerprint"] == regression_fingerprint(
        root, base_tip, report.base, report.test_files
    )


def _reviewed_live_schema_startup_mcp_health(
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
        "policy_fingerprint",
        "reviewer",
        "rationale",
    }
    domains = ("ha_tools", "physical_output", "realtime_semantics", "rearm")
    if (
        set(record) != fields
        or record["kind"] != "live_schema_startup_mcp_health"
        or report.domains != domains
        or record["domains"] != list(domains)
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
    regressions = {name for name in effective if name.startswith("tests/")} | set(report.test_files)
    metadata = "podvoice/gatekeeper/__init__.py"
    policy = root / "scripts/candidate_scope.py"
    if (
        not _LIVE_SCHEMA_HEALTH_REQUIRED <= effective
        or not production <= _LIVE_SCHEMA_HEALTH_REQUIRED | {metadata}
        or not _LIVE_SCHEMA_HEALTH_REGRESSIONS <= effective
        or any(
            not (root / name).is_file() or (root / name).is_symlink()
            for name in production | regressions
        )
        or not policy.is_file()
        or policy.is_symlink()
    ):
        return False
    if metadata in production and not _effective_version_metadata_only(root, report.base, metadata):
        return False
    return (
        record["fingerprint"]
        == production_fingerprint(root, base_tip, report.base, report.production_files)
        and record["regression_fingerprint"]
        == regression_fingerprint(root, base_tip, report.base, report.test_files)
        and record["policy_fingerprint"] == hashlib.sha256(policy.read_bytes()).hexdigest()
    )


# Exact passive owner composition, including the existing DeviceControl POST journal.
_PODVIEW_OWNER_REQUIRED = {
    "podvoice/gatekeeper/__main__.py",
    "podvoice/gatekeeper/cleaning_journal.py",
    "podvoice/gatekeeper/device_control.py",
    "podvoice/gatekeeper/podview.py",
    "podvoice/gatekeeper/podview_music.py",
    "podvoice/gatekeeper/podview_weather.py",
    "podvoice/gatekeeper/tools.py",
}
_PODVIEW_OWNER_REGRESSIONS = {
    "tests/integration/test_cleaning_journal.py",
    "tests/integration/test_podview_bridge.py",
    "tests/integration/test_podview_music.py",
    "tests/unit/test_weather_result.py",
}
_PODVIEW_READ_METHODS = {
    "podview_home_available",
    "podview_home_binding",
    "podview_home_read",
    "_podview_weather_declaration",
    "podview_weather_available",
    "podview_weather_binding",
    "podview_weather_read",
    "podview_music_binding",
    "podview_music_reads",
    "podview_read",
}


def _owner_ast(source: bytes) -> ast.Module:
    return ast.parse(source)


def _ast_equal(before: ast.AST, after: ast.AST) -> bool:
    return ast.dump(before, include_attributes=False) == ast.dump(after, include_attributes=False)


def _remove_exact_imports(tree: ast.Module, statements: Sequence[str]) -> None:
    for statement in statements:
        expected = ast.parse(statement).body[0]
        matches = [node for node in tree.body if _ast_equal(node, expected)]
        if len(matches) != 1:
            raise ValueError("missing or duplicate adapter import")
        tree.body.remove(matches[0])


def _direct_class(tree: ast.Module, name: str) -> ast.ClassDef:
    matches = [
        node for node in ast.walk(tree) if isinstance(node, ast.ClassDef) and node.name == name
    ]
    if len(matches) != 1 or matches[0] not in tree.body:
        raise ValueError("ambiguous adapter class owner")
    return matches[0]


def _methods(owner: ast.ClassDef) -> dict:
    result = {}
    for node in owner.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name in result:
                raise ValueError("duplicate method owner")
            result[node.name] = node
    return result


def _remove_path_argument(method: ast.FunctionDef | ast.AsyncFunctionDef, name: str) -> None:
    args = method.args
    expected = ast.parse(f"def f(*, {name}: Path | None = None): pass").body[0]
    assert isinstance(expected, ast.FunctionDef)
    matches = [index for index, arg in enumerate(args.kwonlyargs) if arg.arg == name]
    if len(matches) != 1:
        raise ValueError("missing journal constructor argument")
    index = matches[0]
    if (
        not _ast_equal(args.kwonlyargs[index], expected.args.kwonlyargs[0])
        or not isinstance(args.kw_defaults[index], ast.Constant)
        or args.kw_defaults[index].value is not None
    ):
        raise ValueError("journal constructor contract changed")
    del args.kwonlyargs[index]
    del args.kw_defaults[index]


def _remove_call_keyword(tree: ast.AST, function: str, name: str, expression: str) -> None:
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == function
    ]
    if len(calls) != 1:
        raise ValueError("ambiguous constructor call")
    call = calls[0]
    keywords = [keyword for keyword in call.keywords if keyword.arg == name]
    if len(keywords) != 1 or not _ast_equal(
        keywords[0].value, ast.parse(expression, mode="eval").body
    ):
        raise ValueError("incorrect journal path binding")
    call.keywords.remove(keywords[0])


def _read_method_only(method: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
    # New display methods cannot replace voice owners through instance writes or
    # dynamic namespace mutation while their enclosing class looks unchanged.
    for node in ast.walk(method):
        if isinstance(node, ast.Attribute) and isinstance(node.ctx, (ast.Store, ast.Del)):
            raise ValueError("display read changes an attribute owner")
        if isinstance(node, ast.Attribute) and node.attr == "__dict__":
            raise ValueError("dynamic instance namespace")
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr
            in {
                "dispatch",
                "_dispatch_device",
                "_dispatch_canonical_batch",
                "_refresh_podconnect_services",
                "begin_execution_turn",
                "end_execution_turn",
                "authorize",
                "execute",
                "configure_device_control",
                "_issue",
            }
        ):
            raise ValueError("display read enters action or discovery owner")
        if isinstance(node, (ast.Global, ast.Nonlocal, ast.Import, ast.ImportFrom)):
            raise ValueError("display read changes namespace ownership")
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id
            in {"setattr", "delattr", "exec", "eval", "globals", "locals", "vars", "__import__"}
        ):
            raise ValueError("dynamic owner mutation")


def _method_header(node: ast.AST) -> tuple:
    def value(item):
        if isinstance(item, ast.AST):
            return ast.dump(item, include_attributes=False)
        if isinstance(item, list):
            return tuple(value(child) for child in item)
        return item

    return tuple((key, value(item)) for key, item in ast.iter_fields(node) if key != "body")


def _podview_owner_ast(root: Path, merge_base: str) -> bool:
    """Compare preserved AST in full; remove only explicitly admitted deltas."""

    def pair(name):
        return _owner_ast(
            _git(root, "show", f"{merge_base}:podvoice/gatekeeper/{name}.py").encode()
        ), _owner_ast((root / f"podvoice/gatekeeper/{name}.py").read_bytes())

    try:
        before, after = pair("__main__")
        _remove_call_keyword(
            after,
            "ToolRouter",
            "cleaning_journal_path",
            'settings_path.parent / "cleaning-journal.json"',
        )
        if not _ast_equal(before, after):
            return False
        for filename, class_name, allowed, imports in (
            (
                "tools",
                "ToolRouter",
                _PODVIEW_READ_METHODS,
                (
                    "from pathlib import Path",
                    "from . import podview_music",
                    "from .podview_weather import weather_projection",
                ),
            ),
            (
                "device_control",
                "DeviceControl",
                {"observe", "cleaning_history", "prepare", "execute"},
                (
                    "from pathlib import Path",
                    "from .cleaning_journal import CleaningJournal, JournalError",
                ),
            ),
        ):
            before, after = pair(filename)
            old_class, new_class = (
                _direct_class(before, class_name),
                _direct_class(after, class_name),
            )
            old_methods, new_methods = _methods(old_class), _methods(new_class)
            if not allowed <= new_methods.keys() or set(new_methods) - set(
                old_methods
            ) != allowed - set(old_methods):
                return False
            _remove_exact_imports(after, imports)
            constructor = new_methods["__init__"]
            argument = "cleaning_journal_path" if filename == "tools" else "journal_path"
            _remove_path_argument(constructor, argument)
            if filename == "tools":
                _remove_call_keyword(constructor, "DeviceControl", "journal_path", argument)
            else:
                expected = ast.parse("self._cleaning_journal = CleaningJournal(journal_path)").body[
                    0
                ]
                matches = [node for node in constructor.body if _ast_equal(node, expected)]
                if len(matches) != 1:
                    return False
                constructor.body.remove(matches[0])
            if not _ast_equal(old_methods["__init__"], constructor):
                return False
            for name in allowed:
                current = new_methods[name]
                if filename == "tools" or name in {"observe", "cleaning_history"}:
                    _read_method_only(current)
                if name in old_methods:
                    old = old_methods[name]
                    # Signatures/decorators are still owned by the original API.
                    if type(old) is not type(current) or _method_header(old) != _method_header(
                        current
                    ):
                        return False
                    old_class.body.remove(old)
                new_class.body.remove(current)
            if not _ast_equal(before, after):
                return False
        return True
    except (SyntaxError, UnicodeError, ValueError, KeyError, RuntimeError):
        return False


def _requires_podview_owner_adapters(root: Path, merge_base: str) -> bool:
    changed = _effective_changes(root, merge_base, ())
    return bool(
        changed
        & {
            "podvoice/gatekeeper/cleaning_journal.py",
            "podvoice/gatekeeper/podview_music.py",
            "podvoice/gatekeeper/podview_weather.py",
        }
    ) and bool(
        changed
        & {
            "podvoice/gatekeeper/tools.py",
            "podvoice/gatekeeper/device_control.py",
            "podvoice/gatekeeper/podview.py",
        }
    )


def _reviewed_podview_owner_adapters(
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
        "policy_fingerprint",
        "reviewer",
        "rationale",
    }
    if (
        set(record) != fields
        or type(record["version"]) is not int
        or record["version"] != 2
        or record["kind"] != "podview_owner_adapters"
        or record["domains"] != list(report.domains)
        or report.domains != ("ha_tools", "physical_output")
        or record["base_tip"] != base_tip
        or record["merge_base"] != report.base
        or any(
            not isinstance(record[key], str) or not record[key].strip()
            for key in fields - {"version", "domains"}
        )
    ):
        return False
    effective = _effective_changes(
        root, report.base, (*report.production_files, *report.test_files)
    )
    production = {name for name in effective if name.startswith(_PRODUCTION_PREFIXES)} | set(
        report.production_files
    )
    tests = {name for name in effective if name.startswith("tests/")} | set(report.test_files)
    metadata = "podvoice/gatekeeper/__init__.py"
    static = {name for name in production if name.startswith("podvoice/gatekeeper/static/podview/")}
    if (
        not _PODVIEW_OWNER_REQUIRED <= effective
        or not _PODVIEW_OWNER_REGRESSIONS <= effective
        or not production <= _PODVIEW_OWNER_REQUIRED | static | {metadata}
    ):
        return False
    policy = root / "scripts/candidate_scope.py"
    if (
        not policy.is_file()
        or policy.is_symlink()
        or any(
            not (root / name).is_file() or (root / name).is_symlink() for name in production | tests
        )
    ):
        return False
    if (
        len(static) > 128
        or any(
            Path(name).suffix.lower()
            not in {
                ".js",
                ".css",
                ".html",
                ".json",
                ".svg",
                ".png",
                ".jpg",
                ".jpeg",
                ".webp",
                ".woff",
                ".woff2",
            }
            or (root / name).stat().st_size > 4 * 1024 * 1024
            or (root / name).stat().st_mode & 0o111
            for name in static
        )
        or sum((root / name).stat().st_size for name in static) > 16 * 1024 * 1024
    ):
        return False
    if metadata in production and not _effective_version_metadata_only(root, report.base, metadata):
        return False
    return (
        _podview_owner_ast(root, report.base)
        and record["fingerprint"]
        == production_fingerprint(root, base_tip, report.base, report.production_files)
        and record["regression_fingerprint"]
        == regression_fingerprint(root, base_tip, report.base, report.test_files)
        and record["policy_fingerprint"] == hashlib.sha256(policy.read_bytes()).hexdigest()
    )


# PROPOSAL ONLY: append before reviewed_coupling; candidate gate is untouched.
_PODVIEW_SCOPED_REQUIRED = (
    _PODVIEW_OWNER_REQUIRED
    | {
        f"podvoice/gatekeeper/{name}.py"
        for name in (
            "config",
            "web",
            "thin",
            "openai_realtime",
            "podview_controls",
            "podview_music_control",
            "podview_vacuum_control",
            "podview_receipts",
        )
    }
    | {"custom_components/podvoice/timer_bridge.py"}
)
_PODVIEW_SCOPED_REGRESSIONS = _PODVIEW_OWNER_REGRESSIONS | {
    "tests/integration/test_podview_controls.py",
    "tests/integration/test_podview_device_setup.py",
    "tests/integration/test_podview_music_control.py",
    "tests/integration/test_podview_receipt_hooks.py",
    "tests/integration/test_ha_timer_flow.py",
    "tests/integration/ha_timer_bridge_runtime.py",
    "tests/unit/test_podview_receipts.py",
    "tests/unit/test_ha_timer_bridge.py",
    "tests/unit/test_config_token.py",
}


def _companion_statement(owner: ast.AST, source: str) -> None:
    expected = ast.parse(source).body[0]
    matches = []
    for node in ast.walk(owner):
        for _, value in ast.iter_fields(node):
            if isinstance(value, list):
                matches += [
                    (value, item)
                    for item in value
                    if isinstance(item, ast.AST) and _ast_equal(item, expected)
                ]
    if len(matches) != 1:
        raise ValueError("missing or duplicate exact companion statement")
    matches[0][0].remove(matches[0][1])


def _companion_methods(before: ast.Module, after: ast.Module, owner: str, names: set[str]) -> None:
    old_class, new_class = _direct_class(before, owner), _direct_class(after, owner)
    old, new = _methods(old_class), _methods(new_class)
    if not names <= new.keys() or new.keys() - old.keys() != names - old.keys():
        raise ValueError("unexpected companion method owner")
    for name in names:
        if name in old:
            if type(old[name]) is not type(new[name]) or _method_header(
                old[name]
            ) != _method_header(new[name]):
                raise ValueError("changed original method signature")
            old_class.body.remove(old[name])
        new_class.body.remove(new[name])


def _companion_string_argument(method: ast.FunctionDef, name: str) -> None:
    expected = ast.parse(f'def f(*, {name}: str = ""): pass').body[0]
    assert isinstance(expected, ast.FunctionDef)
    indices = [i for i, arg in enumerate(method.args.args) if arg.arg == name]
    if len(indices) != 1:
        raise ValueError("missing control policy argument")
    i = indices[0]
    default_index = i - (len(method.args.args) - len(method.args.defaults))
    if default_index < 0:
        raise ValueError("missing control policy default")
    default = method.args.defaults[default_index]
    if not _ast_equal(method.args.args[i], expected.args.kwonlyargs[0]) or not (
        isinstance(default, ast.Constant) and default.value == ""
    ):
        raise ValueError("changed control policy default")
    del method.args.args[i]
    del method.args.defaults[default_index]


def _podview_scoped_ast(root: Path, base: str) -> bool:
    def pair(path):
        return _owner_ast(_git(root, "show", f"{base}:{path}").encode()), _owner_ast(
            (root / path).read_bytes()
        )

    prefix = "podvoice/gatekeeper/"
    try:
        before, after = pair(prefix + "__main__.py")
        _remove_call_keyword(
            after,
            "ToolRouter",
            "cleaning_journal_path",
            'settings_path.parent / "cleaning-journal.json"',
        )
        _remove_call_keyword(
            after, "create_app", "podview_control_policy", "cfg.podview_control_policy"
        )
        if not _ast_equal(before, after):
            return False
        before, after = pair(prefix + "web.py")
        functions = [
            n for n in after.body if isinstance(n, ast.FunctionDef) and n.name == "create_app"
        ]
        if len(functions) != 1:
            return False
        _companion_string_argument(functions[0], "podview_control_policy")
        _remove_call_keyword(after, "mount_podview", "control_policy", "podview_control_policy")
        if not _ast_equal(before, after):
            return False
        before, after = pair(prefix + "config.py")
        _companion_statement(_direct_class(after, "Config"), 'podview_control_policy: str = ""')
        _remove_call_keyword(
            after,
            "Config",
            "podview_control_policy",
            'str(opts.get("podview_control_policy", "")) if not settings_source_untrusted else ""',
        )
        _companion_statement(
            after, 'merged["podview_control_policy"] = opts.get("podview_control_policy", "")'
        )
        if not _ast_equal(before, after):
            return False
        before, after = pair(prefix + "tools.py")
        _remove_exact_imports(
            after,
            (
                "from pathlib import Path",
                "from . import podview_music",
                "from .podview_weather import weather_projection",
                "from .podview_receipts import VisualReceiptOwner",
            ),
        )
        methods = _methods(_direct_class(after, "ToolRouter"))
        constructor = methods["__init__"]
        _remove_path_argument(constructor, "cleaning_journal_path")
        _remove_call_keyword(constructor, "DeviceControl", "journal_path", "cleaning_journal_path")
        _companion_statement(constructor, "self.podview_receipts = VisualReceiptOwner()")
        for name in _PODVIEW_READ_METHODS:
            _read_method_only(methods[name])
        _companion_methods(before, after, "ToolRouter", _PODVIEW_READ_METHODS)
        if not _ast_equal(before, after):
            return False
        before, after = pair(prefix + "device_control.py")
        _remove_exact_imports(
            after,
            (
                "from pathlib import Path",
                "from .cleaning_journal import CleaningJournal, JournalError",
            ),
        )
        methods = _methods(_direct_class(after, "DeviceControl"))
        _remove_path_argument(methods["__init__"], "journal_path")
        _companion_statement(
            methods["__init__"], "self._cleaning_journal = CleaningJournal(journal_path)"
        )
        _companion_statement(
            methods["__init__"], "self._display_tickets: dict[str, Capability] = {}"
        )
        _companion_statement(methods["configure"], "self._display_tickets.clear()")
        issue = methods["_issue"]
        test = ast.parse('capability.owner[0].startswith("podview:")', mode="eval").body
        branches = [n for n in issue.body if isinstance(n, ast.If) and _ast_equal(n.test, test)]
        if len(branches) != 1 or branches[0].orelse:
            return False
        issue.body.remove(branches[0])  # Original voice issuance tail remains AST-identical.
        for name in ("observe", "cleaning_history"):
            _read_method_only(methods[name])
        _companion_methods(
            before,
            after,
            "DeviceControl",
            {"observe", "cleaning_history", "display_setup", "prepare", "execute"},
        )
        if not _ast_equal(before, after):
            return False
        before, after = pair(prefix + "thin.py")
        _companion_methods(
            before,
            after,
            "ThinSession",
            {"_run_live_batch", "_submit_tool_batch_if_ready", "_offer_visual_receipts"},
        )
        if not _ast_equal(before, after):
            return False
        before, after = pair(prefix + "openai_realtime.py")
        _companion_statement(
            _direct_class(after, "OpenAIRealtimeSession"),
            "_display_tool_receipt: tuple[int, list[dict]] | None = field(default=None, init=False, repr=False)",
        )
        _companion_methods(
            before,
            after,
            "OpenAIRealtimeSession",
            {"send_tool_results", "take_submitted_tool_results"},
        )
        if not _ast_equal(before, after):
            return False
        before, after = pair("custom_components/podvoice/timer_bridge.py")
        _remove_exact_imports(after, ("import time",))
        methods = _methods(_direct_class(after, "TimerBridge"))
        for method, name, expression in (
            ("snapshot", "recent", "self._recent(endpoint)"),
            ("command", "accepted_at", "time.time()"),
        ):
            expected = ast.parse(expression, mode="eval").body
            matches = [
                (node, keyword)
                for node in ast.walk(methods[method])
                if isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and _ast_equal(node.func, ast.parse("self._reply", mode="eval").body)
                for keyword in node.keywords
                if keyword.arg == name and _ast_equal(keyword.value, expected)
            ]
            if len(matches) != 1:
                return False
            matches[0][0].keywords.remove(matches[0][1])
        _companion_methods(before, after, "TimerBridge", {"_recent"})
        return _ast_equal(before, after)
    except (SyntaxError, UnicodeError, ValueError, KeyError, RuntimeError):
        return False


def _scoped_config_only(root: Path, base: str) -> bool:
    path = root / "podvoice/config.yaml"
    if path.is_symlink() or not path.is_file():
        return False
    before, after = _git(root, "show", f"{base}:podvoice/config.yaml"), path.read_text()
    # Exact textual additions reject duplicate keys/tags and unrelated YAML changes.
    for header, statement in (
        ("options:\n", '  podview_control_policy: ""\n'),
        ("schema:\n", '  podview_control_policy: "str?"\n'),
    ):
        if after.count(statement) != 1 or after.count(header) != 1:
            return False
        block = re.split(r"\n(?=\S)", after.split(header, 1)[1], maxsplit=1)[0]
        if statement.rstrip("\n") not in block.splitlines():
            return False
        after = after.replace(statement, "", 1)
    version = r'^version: ([\'"]?)\d+\.\d+\.\d+\1$'
    old, new = re.search(version, before, re.MULTILINE), re.search(version, after, re.MULTILINE)
    if not old or not new:
        return False
    return (
        before[: old.start()] + "VERSION" + before[old.end() :]
        == after[: new.start()] + "VERSION" + after[new.end() :]
    )


def _scoped_manifest_only(root: Path, base: str, name: str) -> bool:
    try:
        old = json.loads(_git(root, "show", f"{base}:{name}"), object_pairs_hook=_unique_record)
        new = json.loads((root / name).read_bytes(), object_pairs_hook=_unique_record)
        if not isinstance(old, dict) or not isinstance(new, dict):
            return False
        versions = old.pop("version"), new.pop("version")
        return old == new and all(
            isinstance(v, str) and re.fullmatch(r"\d+\.\d+\.\d+", v) for v in versions
        )
    except (ValueError, KeyError, RuntimeError):
        return False


def _requires_podview_scoped_companion(root: Path, base: str) -> bool:
    return bool(
        _effective_changes(root, base, ())
        & {
            "podvoice/gatekeeper/podview_controls.py",
            "podvoice/gatekeeper/podview_receipts.py",
            "podvoice/gatekeeper/podview_music_control.py",
            "podvoice/gatekeeper/podview_vacuum_control.py",
        }
    )


def _reviewed_podview_scoped_companion(
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
        "policy_fingerprint",
        "config_fingerprint",
        "reviewer",
        "rationale",
    }
    if (
        set(record) != fields
        or type(record["version"]) is not int
        or record["version"] != 2
        or record["kind"] != "podview_scoped_companion"
        or record["domains"] != list(report.domains)
        or record["base_tip"] != base_tip
        or record["merge_base"] != report.base
        or any(
            not isinstance(record[k], str) or not record[k].strip()
            for k in fields - {"version", "domains"}
        )
    ):
        return False
    effective = _effective_changes(
        root, report.base, (*report.production_files, *report.test_files)
    )
    production = {p for p in effective if p.startswith(_PRODUCTION_PREFIXES)} | set(
        report.production_files
    )
    tests = {p for p in effective if p.startswith("tests/")} | set(report.test_files)
    static = {p for p in production if p.startswith("podvoice/gatekeeper/static/podview/")}
    metadata, manifest = (
        "podvoice/gatekeeper/__init__.py",
        "custom_components/podvoice/manifest.json",
    )
    if (
        not _PODVIEW_SCOPED_REQUIRED | _PODVIEW_SCOPED_REGRESSIONS <= effective
        or not production <= _PODVIEW_SCOPED_REQUIRED | static | {metadata, manifest}
    ):
        return False
    if any(
        not (root / p).is_file() or (root / p).is_symlink()
        for p in production | tests | {"scripts/candidate_scope.py", "podvoice/config.yaml"}
    ):
        return False
    if (
        len(static) > 128
        or any(
            Path(p).suffix.lower()
            not in {
                ".js",
                ".css",
                ".html",
                ".json",
                ".svg",
                ".png",
                ".jpg",
                ".jpeg",
                ".webp",
                ".woff",
                ".woff2",
            }
            or (root / p).stat().st_size > 4 * 1024 * 1024
            or (root / p).stat().st_mode & 0o111
            for p in static
        )
        or sum((root / p).stat().st_size for p in static) > 16 * 1024 * 1024
    ):
        return False
    if metadata in production and not _effective_version_metadata_only(root, report.base, metadata):
        return False
    if manifest in production and not _scoped_manifest_only(root, report.base, manifest):
        return False
    # Ignored build metadata cannot ride this reviewed composition.
    baseline = _base_inventory(root, report.base)
    for name in ("podvoice/build.yaml", "podvoice/Dockerfile", "podvoice/.dockerignore"):
        if name in baseline:
            mode, data = _effective_file(root, name)
            if (
                mode != baseline[name][0]
                or data != _git(root, "show", f"{report.base}:{name}").encode()
            ):
                return False
    return (
        _podview_scoped_ast(root, report.base)
        and _scoped_config_only(root, report.base)
        and record["fingerprint"]
        == production_fingerprint(root, base_tip, report.base, tuple(production))
        and record["regression_fingerprint"]
        == regression_fingerprint(root, base_tip, report.base, tuple(tests))
        and record["policy_fingerprint"]
        == hashlib.sha256((root / "scripts/candidate_scope.py").read_bytes()).hexdigest()
        and record["config_fingerprint"]
        == hashlib.sha256((root / "podvoice/config.yaml").read_bytes()).hexdigest()
    )


# Exact optional visual-selection follow-on. Existing profiles are unchanged.
def _visual_repository_changes(root: Path, base: str) -> set[str]:
    """Compare all repository paths, including hidden index changes and config."""
    baseline = _base_inventory(root, base)
    names = set(baseline)
    for args in (("ls-files", "-z"), ("ls-files", "-z", "--others", "--exclude-standard")):
        names.update(filter(None, _git(root, *args).split("\0")))
    names.add("podvoice/config.yaml")
    algorithm = _git(root, "rev-parse", "--show-object-format").strip()
    changed = set()
    for name in names:
        mode, data = _effective_file(root, name)
        if mode == "deleted" and name not in baseline:
            continue
        oid = hashlib.new(algorithm, b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if baseline.get(name) != (mode, oid):
            changed.add(name)
    return changed


def _visual_direct_function(tree: ast.Module, name: str) -> ast.AST:
    matches = [
        node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name
    ]
    if len(matches) != 1 or matches[0] not in tree.body:
        raise ValueError("ambiguous visual startup owner")
    return matches[0]


def _visual_insert_before(owner: ast.AST, sources: tuple[str, ...], anchor: str) -> None:
    """Remove one exact direct block at its approved position, never a callback."""
    body = getattr(owner, "body", [])
    expected = [ast.parse(source).body[0] for source in sources]
    target = ast.parse(anchor).body[0]
    indices = [index for index, node in enumerate(body) if _ast_equal(node, target)]
    if len(indices) != 1:
        raise ValueError("missing visual startup anchor")
    end = indices[0]
    start = end - len(expected)
    if start < 0 or not all(
        _ast_equal(a, b) for a, b in zip(body[start:end], expected, strict=True)
    ):
        raise ValueError("visual startup block moved")
    del body[start:end]


_PODVIEW_VISUAL_REQUIRED = {
    "podvoice/gatekeeper/__main__.py",
    "podvoice/gatekeeper/config.py",
    "podvoice/gatekeeper/podview.py",
    "podvoice/gatekeeper/podview_enrichment.py",
    "podvoice/gatekeeper/podview_receipts.py",
}
_PODVIEW_VISUAL_REGRESSIONS = {
    "tests/unit/test_podview_visual_value.py",
    "tests/unit/test_config_token.py",
    "tests/unit/test_podview_receipts.py",
    "tests/integration/test_podview_bridge.py",
}


def _podview_visual_ast(root: Path, base: str) -> bool:
    def pair(path):
        return _owner_ast(_git(root, "show", f"{base}:{path}").encode()), _owner_ast(
            (root / path).read_bytes()
        )

    prefix = "podvoice/gatekeeper/"
    try:
        before, after = pair(prefix + "__main__.py")
        _visual_insert_before(
            _visual_direct_function(after, "run"),
            (
                "from .podview_enrichment import configured_selector",
                """tools.podview_receipts.configure_selector(
            configured_selector(ha_client, cfg.openai_api_key, cfg.podview_visual_policy,
            settings_path.parent / "podview-visual-budget.json"))""",
            ),
            "tools.configure_device_control(load_settings(settings_path))",
        )
        if not _ast_equal(before, after):
            return False
        before, after = pair(prefix + "config.py")
        config_class = _direct_class(after, "Config")
        field = ast.parse('podview_visual_policy: str = ""').body[0]
        fields = [node for node in config_class.body if _ast_equal(node, field)]
        if len(fields) != 1:
            return False
        config_class.body.remove(fields[0])
        _remove_call_keyword(
            _visual_direct_function(after, "from_options"),
            "Config",
            "podview_visual_policy",
            'str(opts.get("podview_visual_policy", "")) if not settings_source_untrusted else ""',
        )
        _visual_insert_before(
            _visual_direct_function(after, "load_config"),
            ('merged["podview_visual_policy"] = opts.get("podview_visual_policy", "")',),
            'merged["podview_control_policy"] = opts.get("podview_control_policy", "")',
        )
        if not _ast_equal(before, after):
            return False
        before, after = pair(prefix + "podview.py")
        old_cleanup = ast.parse("sink.close()", mode="eval").body
        new_cleanup = ast.parse("await sink.aclose()", mode="eval").body
        old_capability = ast.parse("False", mode="eval").body
        new_capability = ast.parse(
            'bool(getattr(receipt_owner, "selection_enabled", False))', mode="eval"
        ).body
        counts = [0, 0]

        class RestoreApproved(ast.NodeTransformer):
            def visit_Await(self, node):
                if _ast_equal(node, new_cleanup):
                    counts[0] += 1
                    return old_cleanup
                return self.generic_visit(node)

            def visit_Dict(self, node):
                for index, key in enumerate(node.keys):
                    if isinstance(key, ast.Constant) and key.value == "visualEnrichment":
                        if not _ast_equal(node.values[index], new_capability):
                            raise ValueError("changed visual capability")
                        counts[1] += 1
                        node.values[index] = old_capability
                return self.generic_visit(node)

        RestoreApproved().visit(after)
        return counts == [1, 1] and _ast_equal(before, after)
    except (ValueError, SyntaxError, KeyError, RuntimeError):
        return False


def _visual_config_only(root: Path, base: str) -> bool:
    path = root / "podvoice/config.yaml"
    if path.is_symlink() or not path.is_file():
        return False
    before, after = _git(root, "show", f"{base}:podvoice/config.yaml"), path.read_text()
    for header, statement in (
        ("options:\n", '  podview_visual_policy: ""\n'),
        ("schema:\n", '  podview_visual_policy: "str?"\n'),
    ):
        if after.count(statement) != 1 or after.count(header) != 1:
            return False
        block = re.split(r"\n(?=\S)", after.split(header, 1)[1], maxsplit=1)[0]
        if statement.rstrip("\n") not in block.splitlines():
            return False
        after = after.replace(statement, "", 1)
    version = r"^version: ([\'\"]?)\d+\.\d+\.\d+\1$"
    old, new = re.search(version, before, re.MULTILINE), re.search(version, after, re.MULTILINE)
    return bool(
        old
        and new
        and before[: old.start()] + "VERSION" + before[old.end() :]
        == after[: new.start()] + "VERSION" + after[new.end() :]
    )


def _reviewed_podview_visual_selection(
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
        "policy_fingerprint",
        "config_fingerprint",
        "reviewer",
        "rationale",
    }
    if (
        set(record) != fields
        or type(record["version"]) is not int
        or record["version"] != 2
        or record["kind"] != "podview_visual_selection"
        or record["domains"] != list(report.domains)
        or record["base_tip"] != base_tip
        or record["merge_base"] != report.base
        or any(
            not isinstance(record[k], str) or not record[k].strip()
            for k in fields - {"version", "domains"}
        )
    ):
        return False
    effective = _visual_repository_changes(root, report.base)
    production = {p for p in effective if p.startswith(_PRODUCTION_PREFIXES)} | set(
        report.production_files
    )
    tests = {p for p in effective if p.startswith("tests/")} | set(report.test_files)
    static = {p for p in production if p.startswith("podvoice/gatekeeper/static/podview/")}
    metadata = "podvoice/gatekeeper/__init__.py"
    if (
        not _PODVIEW_VISUAL_REQUIRED | _PODVIEW_VISUAL_REGRESSIONS <= effective
        or not production <= _PODVIEW_VISUAL_REQUIRED | static | {metadata}
    ):
        return False
    if any(
        not (root / p).is_file() or (root / p).is_symlink()
        for p in production | tests | {"scripts/candidate_scope.py", "podvoice/config.yaml"}
    ):
        return False
    if (
        len(static) > 128
        or any(
            Path(p).suffix.lower()
            not in {
                ".js",
                ".css",
                ".html",
                ".json",
                ".svg",
                ".png",
                ".jpg",
                ".jpeg",
                ".webp",
                ".woff",
                ".woff2",
            }
            or (root / p).stat().st_size > 4 * 1024 * 1024
            or (root / p).stat().st_mode & 0o111
            for p in static
        )
        or sum((root / p).stat().st_size for p in static) > 16 * 1024 * 1024
    ):
        return False
    if metadata in production and not _effective_version_metadata_only(root, report.base, metadata):
        return False
    # No build/workflow/dependency or native-owner delta can ride this profile.
    for name in effective:
        if name not in production | tests | {
            "docs/STATUS.md",
            "scripts/candidate_scope.py",
            "podvoice/config.yaml",
            "pyproject.toml",
        } and not name.startswith("docs/"):
            return False
    if "pyproject.toml" in effective:
        if (root / "pyproject.toml").is_symlink() or not (root / "pyproject.toml").is_file():
            return False
        before = _git(root, "show", f"{report.base}:pyproject.toml")
        after = (root / "pyproject.toml").read_text()
        pattern = r'^version = "\d+\.\d+\.\d+"$'
        if (
            len(re.findall(pattern, before, re.MULTILINE)) != 1
            or len(re.findall(pattern, after, re.MULTILINE)) != 1
            or re.sub(pattern, 'version = "VERSION"', before, flags=re.MULTILINE)
            != re.sub(pattern, 'version = "VERSION"', after, flags=re.MULTILINE)
        ):
            return False
    return (
        _podview_visual_ast(root, report.base)
        and _visual_config_only(root, report.base)
        and record["fingerprint"]
        == production_fingerprint(root, base_tip, report.base, tuple(production))
        and record["regression_fingerprint"]
        == regression_fingerprint(root, base_tip, report.base, tuple(tests))
        and record["policy_fingerprint"]
        == hashlib.sha256((root / "scripts/candidate_scope.py").read_bytes()).hexdigest()
        and record["config_fingerprint"]
        == hashlib.sha256((root / "podvoice/config.yaml").read_bytes()).hexdigest()
    )


def reviewed_coupling(root: Path, report: CandidateScope, base_tip: str) -> CandidateScope:
    status = root / "docs/STATUS.md"
    text = status.read_text() if status.exists() else ""
    marker = "<!-- candidate-scope-coupling"
    strict_v3_required = _requires_passive_burst_ui_hil(root, report.base)
    podview_required = _requires_podview_owner_adapters(root, report.base)
    scoped_required = _requires_podview_scoped_companion(root, report.base)
    failed = replace(report, passed=False, reason="invalid or stale reviewed coupling record")
    try:
        idle_ui_required, strict_v4_required = _native_idle_input_ui_review_requirements(
            root, report.base
        )
    except (SyntaxError, UnicodeError, ValueError):
        return failed
    if marker not in text:
        if scoped_required:
            return replace(
                report,
                passed=False,
                reason="podview_scoped_companion requires exact independent review",
            )
        if podview_required:
            return replace(
                report,
                passed=False,
                reason="podview_owner_adapters requires exact independent review",
            )
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
    if record["version"] == 2 and record.get("kind") == "podview_visual_selection":
        if not _reviewed_podview_visual_selection(root, report, base_tip, record):
            return failed
        return replace(
            report, passed=True, reason="exact reviewed coupling: podview_visual_selection"
        )
    if record["version"] == 2 and record.get("kind") == "podview_scoped_companion":
        if not _reviewed_podview_scoped_companion(root, report, base_tip, record):
            return failed
        return replace(
            report, passed=True, reason="exact reviewed coupling: podview_scoped_companion"
        )
    if scoped_required:
        return failed
    if record["version"] == 2 and record.get("kind") == "podview_owner_adapters":
        if (
            strict_v3_required
            or strict_v4_required
            or not _reviewed_podview_owner_adapters(root, report, base_tip, record)
        ):
            return failed
        return replace(
            report, passed=True, reason="exact reviewed coupling: podview_owner_adapters"
        )
    if podview_required:
        return failed
    if record["version"] == 2 and record.get("kind") == "live_schema_startup_mcp_health":
        if (
            strict_v3_required
            or strict_v4_required
            or not _reviewed_live_schema_startup_mcp_health(root, report, base_tip, record)
        ):
            return failed
        return replace(
            report, passed=True, reason="exact reviewed coupling: live_schema_startup_mcp_health"
        )
    if record["version"] == 5:
        # This composition preserves the idle-input owners; changing them still
        # requires the existing strict v4 contract. It cannot swallow v3 surfaces.
        if (
            strict_v3_required
            or strict_v4_required
            or not _reviewed_live_startup_idle_alarm(root, report, base_tip, record)
        ):
            return failed
        return replace(
            report, passed=True, reason="exact reviewed coupling: live_startup_native_idle_alarm"
        )
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
