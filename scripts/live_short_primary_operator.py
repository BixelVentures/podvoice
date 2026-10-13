#!/usr/bin/env python3
"""Private two-case short-primary proposal (new pause approval pending); existing handoff owns admission/child execution.

Root prepares with HA running; actual stopped confirmation enters only through stdin.
Root guarantees restoration in finally after any actual pause; no stopped-start retry.
No retry. Synthetic protocol evidence never proves physical Voice PE.
"""

import argparse
import hashlib
import importlib.util
import json
import math
import os
import secrets
import select
import signal
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

BATCH_S = 90
PAUSE_LIMIT_S = 180.0
RESTORE_RESERVE_S = 60.0
START_GATE_WAIT_S = 120.0
START_GATE_MAX_BYTES = 4096
CASE_PLAN = {
    "candidate": ("explicit-close", "pure-thanks"),
    "baseline": (),
}


def digest(path, maximum=100_000_000):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > maximum:
        raise ValueError("invalid_pinned_file")
    h = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(65536), b""):
            h.update(block)
    return h.hexdigest()


def verify(pins, handoff):
    for name, expected in pins["files"].items():
        if digest(Path(name)) != expected:
            raise ValueError("file_pin_changed")
    if sorted(str(p) for p in Path(pins["sdk_root"]).rglob("*.py")) != pins["sdk_inventory"]:
        raise ValueError("sdk_inventory_changed")
    for label, root in pins["roots"].items():
        handoff.ROOT = Path(root)
        if handoff.source_fingerprint() != pins["source_fingerprints"][label]:
            raise ValueError("source_pin_changed")
    if any(
        name in os.environ
        for name in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "PYTHONPATH", "PYTHONHOME")
    ):
        raise ValueError("unreviewed_environment_override")


def verify_retained_baseline(pins):
    """Retain one immutable paid observation under the reviewed grade-only audit."""
    retained = pins["retained_baseline"]
    audit = json.loads(Path(retained["audit"]).read_bytes())
    report = json.loads(Path(retained["report"]).read_bytes())
    expected = json.loads(Path(retained["expected_startup"]).read_bytes())
    current = json.loads(Path(pins["expected_startup"]["baseline"]).read_bytes())
    result = audit["corrected_offline_assessment"]
    if (
        audit["original_report_sha256"] != digest(Path(retained["report"]))
        or audit["timeline_sha256"] != digest(Path(retained["timeline"]))
        or audit["grade_only_AST_proof"] is not True
        or audit["old_guarded_binding_matches_frozen_expected"] is not True
        or audit["provider_invoked"] is not False
        or result["verdict"] != "FAIL"
        or result["recognized"] is not True
        or result["end_calls"] != 0
        or report["case"] != "explicit-close"
        or report["variant"] != "baseline"
        or not all(
            report[k] is True
            for k in (
                "clean_shutdown",
                "usage_complete",
                "audio_evidence_complete",
                "timing_valid",
                "fixtures_complete",
                "opening_answered",
            )
        )
    ):
        raise ValueError("retained_baseline_not_proved")
    if {k: v for k, v in expected.items() if k != "source_sha256"} != {
        k: v for k, v in current.items() if k != "source_sha256"
    }:
        raise ValueError("retained_baseline_effective_configuration_changed")
    changed = {
        k
        for k in expected["source_sha256"]
        if expected["source_sha256"][k] != current["source_sha256"].get(k)
    }
    if set(expected["source_sha256"]) != set(current["source_sha256"]) or changed != {
        "scripts/live_semantic_completion_eval.py"
    }:
        raise ValueError("retained_baseline_runtime_changed")


def report_identity(report_path, label, pins):
    timeline = report_path.parent / "timeline.jsonl"
    if timeline.stat().st_size > 2_000_000 or timeline.is_symlink():
        raise ValueError("invalid_timeline")
    rows = [json.loads(line) for line in timeline.read_bytes().splitlines()]
    accepted = [row for row in rows if row.get("kind") == "startup_identity_accepted"]
    expected = json.loads(Path(pins["expected_startup"][label]).read_bytes())
    if (
        len(accepted) != 1
        or accepted[0].get("guarded") is not True
        or accepted[0].get("binding") != expected
    ):
        raise ValueError("pre_provider_startup_guard_not_proved")
    identity = [row for row in rows if row.get("kind") == "semantic_evaluation_identity"]
    if len(identity) != 1 or any(
        identity[0].get(field) != value
        for field, value in {
            "variant": "baseline",
            "sdk": pins["sdk_version"],
            "observation_s": 45.0,
            "starts": 1,
            "manifest_sha256": pins["manifest_sha256"],
        }.items()
    ):
        raise ValueError("evaluation_identity_changed")


class BatchExpired(BaseException):
    pass


class OperatorCancelled(BaseException):
    pass


def _unique_control_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate_start_control_field")
        result[key] = value
    return result


def receive_start_control(fd, deadline, *, now=time.monotonic, wait=select.select, read=os.read):
    """One bounded stdin message; no socket, credential, file or provider access."""
    payload = bytearray()
    while True:
        remaining = deadline - now()
        if remaining <= 0:
            raise ValueError("start_control_expired")
        ready, _, _ = wait([fd], [], [], remaining)
        if not ready:
            raise ValueError("start_control_expired")
        fragment = read(fd, START_GATE_MAX_BYTES + 1 - len(payload))
        if not fragment:
            raise ValueError("start_control_eof")
        payload.extend(fragment)
        if len(payload) > START_GATE_MAX_BYTES:
            raise ValueError("start_control_too_large")
        if b"\n" in payload:
            if payload.count(b"\n") != 1 or not payload.endswith(b"\n"):
                raise ValueError("duplicate_or_trailing_start_control")
            try:
                return json.loads(payload.decode("utf-8"), object_pairs_hook=_unique_control_fields)
            except (UnicodeError, json.JSONDecodeError) as exc:
                raise ValueError("invalid_start_control") from exc


def await_stopped_start(*, now=time.monotonic, receive=receive_start_control, emit=print, fd=None):
    """Provider starts only after root's current, nonce-bound actual HA stop evidence."""
    created = now()
    nonce = secrets.token_urlsafe(32)
    emit(
        json.dumps(
            {
                "phase": "key_in_memory_awaiting_actual_ha_stop",
                "start_nonce": nonce,
                "start_gate_expires_monotonic": created + START_GATE_WAIT_S,
                "provider_started": False,
            }
        ),
        flush=True,
    )
    control = receive(sys.stdin.fileno() if fd is None else fd, created + START_GATE_WAIT_S)
    current = now()
    if current >= created + START_GATE_WAIT_S:
        raise ValueError("start_control_expired")
    if not isinstance(control, dict) or set(control) != {
        "phase",
        "start_nonce",
        "pause_started_monotonic",
        "stopped_confirmed",
    }:
        raise ValueError("invalid_start_control_fields")
    started = control["pause_started_monotonic"]
    if (
        control["phase"] != "ha_stopped"
        or control["stopped_confirmed"] is not True
        or not isinstance(control["start_nonce"], str)
        or not secrets.compare_digest(control["start_nonce"], nonce)
        or type(started) not in (int, float)
        or not math.isfinite(started)
        or not created <= started <= current
    ):
        raise ValueError("stale_future_or_unconfirmed_start_control")
    provider_deadline = started + PAUSE_LIMIT_S - RESTORE_RESERVE_S
    if provider_deadline - current < 70:
        raise ValueError("actual_stop_has_no_safe_child_budget")
    return started, provider_deadline


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pins", required=True, type=Path)
    parser.add_argument("--pins-sha256", required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--exclusive-provider-window", action="store_true")
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--new-180s-pause-approved", action="store_true")
    args = parser.parse_args()
    if digest(args.pins, 2_000_000) != args.pins_sha256:
        parser.error("reviewed pins changed")
    pins = json.loads(args.pins.read_bytes())
    handoff_path = Path(pins["handoff_path"])
    if digest(handoff_path) != pins["files"][str(handoff_path)]:
        parser.error("reviewed handoff changed")
    spec = importlib.util.spec_from_file_location("private_handoff", handoff_path)
    handoff = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(handoff)
    verify(pins, handoff)
    verify_retained_baseline(pins)
    if args.check_only:
        print("Operator, sources, SDK and shared fixtures pinned; no admission or provider.")
        return 0
    if not args.new_180s_pause_approved:
        parser.error("new human-approved 180s pause required before stopped-start gate")
    if not args.exclusive_provider_window or args.output is None or args.output.exists():
        parser.error("exclusive stopped-provider window and a new output required")
    key = None
    results = []
    original_verify = handoff.verify_sources
    previous_alarm = None
    started = None
    provider_deadline = None
    previous_cancel = {}

    def cancel(*_):
        raise OperatorCancelled()

    for name in (signal.SIGINT, signal.SIGTERM):
        previous_cancel[name] = signal.signal(name, cancel)
    try:
        key = handoff.receive_key()  # Prepare while HA runs; unchanged one-use receiver closes.
        if key is None:
            print("No key admitted; no provider started.")
            return 2
        started, provider_deadline = await_stopped_start()
        args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
        deadline = min(time.monotonic() + BATCH_S, provider_deadline)
        if deadline <= time.monotonic():
            raise ValueError("new_pause_provider_deadline_expired")

        def expire(*_):
            raise BatchExpired()

        previous_alarm = signal.signal(signal.SIGALRM, expire)
        signal.setitimer(signal.ITIMER_REAL, max(0.001, deadline - time.monotonic()))
        for label in ("candidate", "baseline"):
            destination = args.output / label
            destination.mkdir(mode=0o700)
            for case in CASE_PLAN[label]:
                verify(pins, handoff)
                verify_retained_baseline(pins)
                handoff.ROOT = Path(pins["roots"][label])
                handoff.TRIALS = (("baseline", case),)
                handoff.BATCH_S = max(0, deadline - time.monotonic())
                child_args = SimpleNamespace(
                    source_sha256=pins["source_fingerprints"][label],
                    manifest_sha256=pins["manifest_sha256"],
                    fixtures=Path(pins["fixtures"]),
                    output=destination,
                    expected_startup=Path(pins["expected_startup"][label]),
                )

                def guarded_sources(child_args):
                    selected_root = handoff.ROOT
                    verify(pins, handoff)
                    handoff.ROOT = selected_root
                    original_verify(child_args)

                handoff.verify_sources = guarded_sources
                code, summaries = handoff.run_batch(child_args, key)
                results.extend(dict(source=label, **row) for row in summaries)
                if len(summaries) != 1 or not summaries[0]["safe_to_continue"]:
                    return 3
                report_identity(Path(summaries[0]["report"]), label, pins)
                # Each fresh case must pass; the already observed positive FAIL is retained.
                if code != 0:
                    return 3
        return 0
    except (
        BatchExpired,
        OperatorCancelled,
        OSError,
        ValueError,
        TimeoutError,
        subprocess.TimeoutExpired,
    ):
        print("Operator stopped; root must restore HA if paused and verify remote cleanup.")
        return 3
    finally:
        key = None
        handoff.verify_sources = original_verify
        if previous_alarm is not None:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous_alarm)
        for name, previous in previous_cancel.items():
            signal.signal(name, previous)
        if args.output.exists():
            with (args.output / "operator-summary.json").open("x") as target:
                json.dump(
                    {
                        "trials": results,
                        "restore_production_required": True,
                        "actual_pause_start_monotonic": started,
                        "provider_work_deadline_monotonic": provider_deadline,
                        "restoration_required_by_monotonic": started + PAUSE_LIMIT_S,
                        "reserved_restore_s": RESTORE_RESERVE_S,
                        "permission_basis": "NEW_180S_PAUSE_REQUIRES_HUMAN_ACCEPTANCE",
                    },
                    target,
                    indent=2,
                )
            (args.output / "operator-summary.json").chmod(0o600)


if __name__ == "__main__":
    raise SystemExit(main())
