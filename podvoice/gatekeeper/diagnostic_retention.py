"""Bounded content-free metadata kept separately from private audio retention."""

from __future__ import annotations

import hashlib
import json
import math
import pathlib
import re
import time

DIAGNOSTIC_AGE_S = 14 * 24 * 60 * 60
DIAGNOSTIC_BYTES = 32 * 1024 * 1024
_EVENTS = {
    "live_activity_observed",
    "live_backend_started",
    "live_backend_complete",
    "live_batch_diagnostic",
    "live_idle_diagnostic",
    "capture_finished",
    "button_pressed",
    "wake_received",
    "teardown_complete",
    "session_started",
    "wake_detected",
    "button_start",
    "teardown_completed",
    "tool_started",
    "tool_finished",
    "session_closed",
    "close_requested",
    "provider_connected",
    "live_session_ready",
    "live_sideband_ready",
    "live_terminal_backend_settled",
    "live_opening_failed_during_close",
    "tool_result_submit_failed",
    "tool_result_stale",
    "wake_rearmed",
    "wake_rearm_recovered",
    "rearm_blocked_incomplete_teardown",
    "teardown_step_failed",
    "teardown_step_timeout",
    "playback_started",
    "playback_finished",
}
_REASONS = {
    "sequence_gap",
    "arrival_gap",
    "source_gap",
    "input_not_advancing",
    "external_reset",
    "baseline",
    "pending_work",
    "invalid_clock",
    "not_native",
    "not_current_arrival",
    "invalid_counter",
    "empty_chain_not_established",
    "empty_snapshot_has_no_preserved_coverage",
    "zero_source_coverage_not_established",
    "input_not_quiet",
    "input_observation_aged",
    "malformed_observation",
    "provisional_without_baseline",
    "discontinuous_observation",
    "arrival_lag",
    "provisional_output",
    "no_consumed_quiet_anchor",
    "owner_changed",
    "stale_observation",
    "quiet_window_incomplete",
    "ready",
    "quiet",
    "active",
    "unknown",
    "no_observation",
    "invalid_native_observation",
    "observed",
    "unknown_or_stale_input",
    "input_observation_discontinuity",
    "missing_stale_or_changed_owner",
}
_TEARDOWN_EVENTS = {"teardown_step_failed", "teardown_step_timeout"}
_TEARDOWN_STEPS = {
    "attention-release",
    "error-speech",
    "heartbeat-stop",
    "live-opening-settle",
    "live-rotation-io-settle",
    "orphan-silence",
    "provider-close",
    "silence-after-error",
    "silence-device",
    "silence-device-retry",
    "stop-context-disable",
    "stop-streaming",
    "wake-rearm",
}
_IDENTITIES = {
    "session_id",
    "response_id",
    "delegation_id",
    "playback_id",
    "close_id",
    "rearm_token",
}
_LIVE_BATCH_STAGES = {
    "admission",
    "lock_wait",
    "classify_batch",
    "prepare_call",
    "approve_dispatch",
    "dispatch",
    "dispatch_returned",
    "result_publish",
    "terminal_bookkeeping",
    "result_submit",
}
_LIVE_BATCH_OUTCOMES = {"started", "done", "returned", "result_ready", "failed"}
_LIVE_REFS = {"response_ref", "call_ref", "wire_tool_ref", "effective_tool_ref"}


def _loss_number(manifest: dict, key: str) -> int:
    value = manifest.get(key, 0)
    return value if type(value) is int and value >= 0 else 0


def _loss_counts(manifest: dict, key: str, names: set[str]) -> dict[str, int]:
    values = manifest.get(key)
    if not isinstance(values, dict):
        return {}
    return {
        name: value
        for name, value in values.items()
        if name in names and type(value) is int and value >= 0
    }


def content_free_manifest(manifest: dict) -> dict:
    """Deny strings by default, even when they happen to look like an enum."""
    events = []
    for event in manifest.get("events", [])[-2048:]:
        if not isinstance(event, dict) or event.get("event") not in _EVENTS:
            continue
        clean = {"event": event["event"]}
        for key, value in event.items():
            if not isinstance(key, str) or len(key) > 64:
                continue
            if key in _IDENTITIES and isinstance(value, str):
                clean[key + "_hash"] = hashlib.sha256(value.encode()).hexdigest()
            elif event["event"] == "live_batch_diagnostic" and key in _LIVE_REFS:
                if isinstance(value, str) and re.fullmatch(r"sha256:[0-9a-f]{16}", value):
                    clean[key] = value
            elif event["event"] == "live_batch_diagnostic" and key in {"stage", "outcome"}:
                allowed = _LIVE_BATCH_STAGES if key == "stage" else _LIVE_BATCH_OUTCOMES
                if isinstance(value, str) and value in allowed:
                    clean[key] = value
            elif event["event"] == "live_batch_diagnostic" and key in {
                "batch_generation",
                "completed_results",
                "successful_results",
            }:
                if type(value) is int and 0 <= value < 2**63:
                    clean[key] = value
            elif event["event"] == "live_backend_complete" and key == "status":
                if isinstance(value, str) and value in {"completed", "failed", "incomplete"}:
                    clean[key] = value
            elif key == "step" and event["event"] in _TEARDOWN_EVENTS:
                if isinstance(value, str) and value in _TEARDOWN_STEPS:
                    clean[key] = value
            elif (
                key == "reason" and event["event"] in _TEARDOWN_EVENTS and value == "total-deadline"
            ):
                clean[key] = value
            elif (
                key == "reason"
                and isinstance(value, str)
                and value
                in {
                    "stop",
                    "stop-word",
                    "model-close",
                    "model-close-silent",
                    "idle-fallback",
                }
            ):
                clean[key] = value
            elif key in {
                "idle_blocker",
                "idle_reset_reason",
                "activity_input_state",
                "idle_shadow_output_blocker",
                "idle_shadow_output_reset_reason",
                "idle_shadow_vad_state",
                "idle_shadow_vad_reason",
            }:
                if isinstance(value, str) and value in _REASONS:
                    clean[key] = value
            elif (
                key == "at_ms"
                or key.startswith(("idle_", "activity_"))
                or key
                in {
                    "provider_generation",
                    "audio_generation",
                    "turn_id",
                    "active",
                    "closing",
                }
            ):
                if type(value) in (bool, int) or (type(value) is float and math.isfinite(value)):
                    clean[key] = value
        events.append(clean)
    session = manifest.get("metadata", {}).get("session_id")
    return {
        "schema": 1,
        "content_free": True,
        "dropped_events": _loss_number(manifest, "dropped_events"),
        "incomplete": bool(
            manifest.get("incomplete")
            or manifest.get("dropped_commands")
            or manifest.get("dropped_events")
            or manifest.get("drop_accounting_incomplete")
        ),
        "dropped_commands": _loss_number(manifest, "dropped_commands"),
        "drop_accounting_incomplete": bool(manifest.get("drop_accounting_incomplete")),
        "loss_scope": manifest.get("loss_scope")
        if manifest.get("loss_scope") in {"capture_and_history", "history_events"}
        else "unknown",
        "dropped_command_kinds": _loss_counts(
            manifest,
            "dropped_command_kinds",
            {"audio", "event", "diagnostic", "begin", "finish", "proof", "shutdown", "other"},
        ),
        "dropped_audio_packets": _loss_counts(
            manifest,
            "dropped_audio_packets",
            {"device", "provider", "speaker", "wake_reference", "other"},
        ),
        "dropped_audio_bytes": _loss_counts(
            manifest,
            "dropped_audio_bytes",
            {"device", "provider", "speaker", "wake_reference", "other"},
        ),
        "session_hash": hashlib.sha256(session.encode()).hexdigest()
        if isinstance(session, str)
        else None,
        "saved_at": time.time(),
        "events": events,
    }


def retain_diagnostics(path: pathlib.Path, *, reserve: int = 0) -> None:
    files = sorted(path.glob("*.diagnostic"), key=lambda item: item.stat().st_mtime)
    total = sum(item.stat().st_size for item in files)
    now = time.time()
    for item in files:
        if total + reserve <= DIAGNOSTIC_BYTES and now - item.stat().st_mtime <= DIAGNOSTIC_AGE_S:
            continue
        total -= item.stat().st_size
        item.unlink(missing_ok=True)


def save_diagnostics(path: pathlib.Path, manifest: dict) -> None:
    # Hash filename too: no caller-controlled path or identifying title reaches disk.
    key = hashlib.sha256(str(manifest["id"]).encode()).hexdigest()
    target = path / (key + ".diagnostic")
    temporary = path / (key + ".diagnostic_tmp")
    encoded = json.dumps(content_free_manifest(manifest), separators=(",", ":")).encode()
    if len(encoded) > DIAGNOSTIC_BYTES:
        raise ValueError("diagnostic_budget_exceeded")
    retain_diagnostics(path, reserve=len(encoded))
    try:
        temporary.write_bytes(encoded)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
