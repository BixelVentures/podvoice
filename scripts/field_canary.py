#!/usr/bin/env python3
"""Score one short physical PodVoice canary without claiming a release."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "podvoice"))

from gatekeeper.trace_oracle import TraceOracle  # noqa: E402


def score_canary(trace: dict, *, volume_check: str) -> tuple[bool, list[str]]:
    report = TraceOracle(
        adapter="voicepe",
        minimum_user_turns=4,
        require_semantic_close=True,
    ).score(trace)
    problems = [f"{issue.code}: {issue.message}" for issue in report.errors]
    if trace.get("reason") != "model-close":
        problems.append(
            f"close_reason: expected model-close, got {trace.get('reason') or 'missing'}"
        )
    if volume_check != "pass":
        problems.append(f"volume_control: physical dial check is {volume_check}")
    events = trace.get("events") if isinstance(trace.get("events"), list) else []
    names = [event.get("event") for event in events if isinstance(event, dict)]
    speech_stops = [index for index, name in enumerate(names) if name == "speech_stopped"]
    speech_starts = [
        index for index, name in enumerate(names) if name == "speech_started_or_interrupted"
    ]
    # The last turn is the semantic close and may intentionally close silently. Every
    # earlier turn must physically finish a reply before the next user turn begins.
    for turn, stop_index in enumerate(speech_stops[:-1], start=1):
        next_start = next((index for index in speech_starts if index > stop_index), len(names))
        if "playback_finished" not in names[stop_index + 1 : next_start]:
            problems.append(
                f"ordinary_turn_{turn}_reply: no physical playback finished before next user turn"
            )
    if any(event.get("event") == "provider_error" for event in events if isinstance(event, dict)):
        problems.append("provider_error: provider error occurred during the canary")
    return not problems, problems


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trace", type=Path)
    parser.add_argument(
        "--volume-check",
        choices=("pass", "fail", "not-run"),
        default="not-run",
        help="human observation: dial changed the active Nabu reply without breaking follow-up",
    )
    args = parser.parse_args(argv)
    try:
        trace = json.loads(args.trace.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"field canary stopped: {exc}", file=sys.stderr)
        return 2
    passed, problems = score_canary(trace, volume_check=args.volume_check)
    print(f"field-canary {'PASS' if passed else 'FAIL'}: {args.trace}")
    for problem in problems:
        print(f"- {problem}")
    if passed:
        print("- mechanical golden chain, physical volume check and next session are proven")
        print("- this is not 10/10 lifecycle or release approval")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
