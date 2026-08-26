"""Mechanical scoring for recorded PodVoice conversation traces.

The oracle deliberately judges event causality, not Danish meaning.  A correct tool
call or answer can still be lucky when the input transcript is wrong, so callers must
pair this result with audio/transcript evaluation before approving a physical run.

Both Talk and Voice PE use :class:`ThinSession`; ``normalise_contract`` removes only
adapter-specific edges so their shared lifecycle shapes can be compared without
pretending that Talk proves wake, microphone, speaker, or rearm hardware.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

Adapter = Literal["talk", "voicepe"]
Severity = Literal["error", "warning"]


@dataclass(frozen=True)
class TraceIssue:
    code: str
    message: str
    severity: Severity = "error"
    event_index: int | None = None


@dataclass(frozen=True)
class TraceReport:
    adapter: Adapter
    issues: tuple[TraceIssue, ...]
    contract: tuple[str, ...]
    event_count: int
    user_turns: int

    @property
    def passed(self) -> bool:
        return not any(issue.severity == "error" for issue in self.issues)

    @property
    def errors(self) -> tuple[TraceIssue, ...]:
        return tuple(issue for issue in self.issues if issue.severity == "error")


@dataclass(frozen=True)
class ContractComparison:
    matches: bool
    talk: tuple[str, ...]
    voicepe: tuple[str, ...]
    first_difference: int | None


_ALIASES = {
    "talk_wake": "wake_received",
    "session_ready": "provider_connected",
    "provider_ready": "provider_connected",
    "user_speech_stopped": "speech_stopped",
    "assistant_audio_started": "response_audio_started",
    "reply_playback_started": "playback_started",
    "reply_playback_finished": "playback_finished",
    "session_close_requested": "close_requested",
    "session_closed": "capture_finished",
    "talk_ready": "followup_ready",
}


def _events(trace: Mapping[str, Any] | Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    if isinstance(trace, Mapping):
        value = trace.get("events", [])
    else:
        value = trace
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return []
    return [event for event in value if isinstance(event, Mapping)]


def _name(event: Mapping[str, Any]) -> str:
    raw = str(event.get("event") or "")
    return _ALIASES.get(raw, raw)


def _decision(event: Mapping[str, Any]) -> str:
    name = str(event.get("name") or "")
    if name == "continue_conversation":
        return "decision:continue"
    if name == "end_conversation":
        return "decision:end"
    if name == "wait_for_user":
        return "decision:wait"
    return "decision:domain"


def normalise_contract(
    trace: Mapping[str, Any] | Sequence[Mapping[str, Any]], *, adapter: Adapter
) -> tuple[str, ...]:
    """Return the shared, ordered ThinSession contract represented by a trace.

    Physical-only capture/rearm edges are excluded from comparison but remain strict
    Voice PE requirements in :class:`TraceOracle`. Consecutive duplicate telemetry is
    retained so a doubled playback or close cannot accidentally compare equal.
    """

    contract: list[str] = []
    for event in _events(trace):
        name = _name(event)
        if name == "wake_received":
            contract.append("session_open")
        elif name == "provider_connected":
            contract.append("provider_ready")
        elif name == "speech_stopped":
            contract.append("user_turn_end")
        elif name == "transcript_complete" and event.get("direction") == "in":
            contract.append("user_text")
        elif name == "tool_call":
            contract.append(_decision(event))
        elif name == "response_audio_started":
            contract.append("answer_started")
        elif name == "transcript_complete" and event.get("direction") == "out":
            contract.append("answer_text")
        elif name == "playback_started":
            contract.append("playback_started")
        elif name == "playback_finished":
            contract.append("playback_finished")
        elif name == "followup_ready":
            contract.append("followup_ready")
        elif name == "close_requested":
            contract.append("close_requested")
        elif name == "capture_finished":
            contract.append("session_closed")
    return tuple(contract)


def compare_normalised_contracts(
    talk: Mapping[str, Any] | Sequence[Mapping[str, Any]],
    voicepe: Mapping[str, Any] | Sequence[Mapping[str, Any]],
) -> ContractComparison:
    talk_contract = normalise_contract(talk, adapter="talk")
    voicepe_contract = normalise_contract(voicepe, adapter="voicepe")
    first_difference = None
    for index, pair in enumerate(zip(talk_contract, voicepe_contract, strict=False)):
        if pair[0] != pair[1]:
            first_difference = index
            break
    if first_difference is None and len(talk_contract) != len(voicepe_contract):
        first_difference = min(len(talk_contract), len(voicepe_contract))
    return ContractComparison(
        matches=talk_contract == voicepe_contract,
        talk=talk_contract,
        voicepe=voicepe_contract,
        first_difference=first_difference,
    )


class TraceOracle:
    """Score one trace against mechanical lifecycle invariants.

    ``strict_physical`` requires modern Voice PE playback/rearm evidence *and* the
    subsequent genuine wake edge. An ACK-only trace can never claim a golden chain.
    It can be disabled only to analyse historical traces.
    """

    def __init__(
        self,
        *,
        adapter: Adapter,
        strict_physical: bool = True,
        minimum_user_turns: int = 1,
        require_semantic_close: bool = False,
    ) -> None:
        self.adapter = adapter
        self.strict_physical = strict_physical
        self.minimum_user_turns = max(0, int(minimum_user_turns))
        self.require_semantic_close = require_semantic_close

    def score(self, trace: Mapping[str, Any] | Sequence[Mapping[str, Any]]) -> TraceReport:
        events = _events(trace)
        issues: list[TraceIssue] = []
        names = [_name(event) for event in events]
        counts = Counter(names)

        if not events:
            issues.append(TraceIssue("events_missing", "Trace has no structured events"))
            return TraceReport(self.adapter, tuple(issues), (), 0, 0)

        previous_ms = -1.0
        for index, event in enumerate(events):
            name = _name(event)
            if not name:
                issues.append(
                    TraceIssue("event_name_missing", "Event has no name", event_index=index)
                )
            at_ms = event.get("at_ms")
            if not isinstance(at_ms, (int, float)):
                issues.append(
                    TraceIssue(
                        "event_time_missing", "Event has no numeric at_ms", event_index=index
                    )
                )
                continue
            if float(at_ms) < previous_ms:
                issues.append(
                    TraceIssue(
                        "event_time_reversed",
                        "Event timestamps move backwards",
                        event_index=index,
                    )
                )
            previous_ms = max(previous_ms, float(at_ms))

        self._require_once(names, "wake_received", issues)
        self._require_once(names, "provider_connected", issues)
        self._ordered(names, "wake_received", "provider_connected", issues)

        user_turns = counts["speech_stopped"]
        if user_turns < self.minimum_user_turns:
            issues.append(
                TraceIssue(
                    "user_turns_missing",
                    f"Expected at least {self.minimum_user_turns} completed user turn(s), got {user_turns}",
                )
            )
        if counts["speech_started_or_interrupted"] != counts["speech_stopped"]:
            issues.append(
                TraceIssue(
                    "speech_edges_unbalanced",
                    "Speech start/stop edges are not balanced",
                )
            )

        input_texts = [
            str(event.get("text") or "").strip()
            for event in events
            if _name(event) == "transcript_complete" and event.get("direction") == "in"
        ]
        if user_turns and len(input_texts) < user_turns:
            issues.append(
                TraceIssue(
                    "input_transcript_missing",
                    "At least one completed user turn has no non-empty diagnostic transcript",
                )
            )
        if any(not text for text in input_texts):
            issues.append(TraceIssue("input_transcript_empty", "An input transcript is empty"))

        self._playback_pairs(events, names, issues)
        self._closure(events, names, issues)

        if self.adapter == "voicepe":
            self._audio_boundaries(
                events,
                names,
                issues,
                require_contract=self.strict_physical,
            )
            self._voicepe(trace, names, issues)

        return TraceReport(
            adapter=self.adapter,
            issues=tuple(issues),
            contract=normalise_contract(events, adapter=self.adapter),
            event_count=len(events),
            user_turns=user_turns,
        )

    @staticmethod
    def _require_once(names: list[str], name: str, issues: list[TraceIssue]) -> None:
        count = names.count(name)
        if count != 1:
            issues.append(
                TraceIssue(
                    f"{name}_count",
                    f"Expected exactly one {name}, got {count}",
                )
            )

    @staticmethod
    def _ordered(names: list[str], before: str, after: str, issues: list[TraceIssue]) -> None:
        if before in names and after in names and names.index(before) > names.index(after):
            issues.append(
                TraceIssue(
                    f"{before}_after_{after}",
                    f"{before} must happen before {after}",
                    event_index=names.index(before),
                )
            )

    @staticmethod
    def _playback_pairs(
        events: list[Mapping[str, Any]], names: list[str], issues: list[TraceIssue]
    ) -> None:
        playback_events = [
            (index, event, names[index])
            for index, event in enumerate(events)
            if names[index] in ("playback_started", "playback_finished")
        ]
        identified = any(event.get("playback_id") for _, event, _ in playback_events)
        if identified:
            active: dict[str, tuple[int, str | None, str | None]] = {}
            pairs = 0
            for index, event, name in playback_events:
                playback_id = str(event.get("playback_id") or "")
                if not playback_id:
                    issues.append(
                        TraceIssue(
                            "playback_id_missing",
                            "An identified trace contains a playback edge without an id",
                            event_index=index,
                        )
                    )
                    continue
                session_id = str(event.get("session_id") or "") or None
                turn_id = str(event.get("turn_id") or "") or None
                if name == "playback_started":
                    if playback_id in active:
                        issues.append(
                            TraceIssue(
                                "playback_double_start",
                                f"Playback {playback_id} started twice",
                                event_index=index,
                            )
                        )
                    active[playback_id] = (index, session_id, turn_id)
                    continue
                started = active.pop(playback_id, None)
                if started is None:
                    issues.append(
                        TraceIssue(
                            "playback_finish_without_start",
                            f"Playback {playback_id} finished without its matching start",
                            event_index=index,
                        )
                    )
                    continue
                _, start_session, start_turn = started
                if (start_session, start_turn) != (session_id, turn_id):
                    issues.append(
                        TraceIssue(
                            "playback_owner_mismatch",
                            f"Playback {playback_id} crossed session/turn ownership",
                            event_index=index,
                        )
                    )
                    continue
                pairs += 1
            for playback_id, (index, _session, _turn) in active.items():
                issues.append(
                    TraceIssue(
                        "playback_finish_missing",
                        f"Playback {playback_id} never finished",
                        event_index=index,
                    )
                )
            if names.count("response_audio_started") and not pairs:
                issues.append(
                    TraceIssue(
                        "physical_playback_missing",
                        "Model audio exists but no owned physical playback pair was observed",
                    )
                )
            return

        # Historical traces predate playback identity. Keep their weaker adjacency
        # analysis for diagnosis, but they cannot prove cross-turn ownership.
        playing = False
        pairs = 0
        for index, name in enumerate(names):
            if name == "playback_started":
                if playing:
                    issues.append(
                        TraceIssue(
                            "playback_double_start",
                            "Playback started twice without finishing",
                            event_index=index,
                        )
                    )
                playing = True
            elif name == "playback_finished":
                if not playing:
                    issues.append(
                        TraceIssue(
                            "playback_finish_without_start",
                            "Playback finished without a matching start",
                            event_index=index,
                        )
                    )
                else:
                    pairs += 1
                playing = False
        if playing:
            issues.append(TraceIssue("playback_finish_missing", "Playback never finished"))
        if names.count("response_audio_started") and not pairs:
            issues.append(
                TraceIssue(
                    "physical_playback_missing",
                    "Model audio exists but no complete physical playback pair was observed",
                )
            )

    def _closure(
        self,
        events: list[Mapping[str, Any]],
        names: list[str],
        issues: list[TraceIssue],
    ) -> None:
        closes = [index for index, name in enumerate(names) if name == "close_requested"]
        if len(closes) != 1:
            issues.append(
                TraceIssue(
                    "close_requested_count", f"Expected exactly one close, got {len(closes)}"
                )
            )
        end_calls = [
            index
            for index, event in enumerate(events)
            if _name(event) == "tool_call" and event.get("name") == "end_conversation"
        ]
        if self.require_semantic_close and len(end_calls) != 1:
            issues.append(
                TraceIssue(
                    "semantic_end_count",
                    f"Expected exactly one semantic end decision, got {len(end_calls)}",
                )
            )
        if end_calls and closes and end_calls[0] > closes[0]:
            issues.append(
                TraceIssue(
                    "semantic_end_after_close",
                    "Semantic end decision arrived after transport close",
                    event_index=end_calls[0],
                )
            )
        if closes and "playback_finished" in names:
            last_finish = max(i for i, name in enumerate(names) if name == "playback_finished")
            if last_finish > closes[0]:
                issues.append(
                    TraceIssue(
                        "close_before_playback_finished",
                        "Transport close began before physical playback finished",
                        event_index=closes[0],
                    )
                )

    @staticmethod
    def _audio_boundaries(
        events: list[Mapping[str, Any]],
        names: list[str],
        issues: list[TraceIssue],
        *,
        require_contract: bool,
    ) -> None:
        """Reject stale/reversed generations and provider audio through a closed gate."""
        last_generation: int | None = None
        last_boundary: int | None = None
        gate_closed_at: tuple[int, int | None, int | None] | None = None
        valid_reasons = {"speech-stopped", "followup-open", "rearm-ack"}

        for index, (event, name) in enumerate(zip(events, names, strict=True)):
            generation = event.get("audio_generation")
            if isinstance(generation, int):
                if last_generation is not None and generation < last_generation:
                    issues.append(
                        TraceIssue(
                            "audio_generation_reversed",
                            "Audio generation moved backwards",
                            event_index=index,
                        )
                    )
                last_generation = (
                    generation if last_generation is None else max(last_generation, generation)
                )

            if name == "audio_boundary_cut":
                reason = str(event.get("reason") or "")
                if reason not in valid_reasons:
                    issues.append(
                        TraceIssue(
                            "audio_boundary_reason_invalid",
                            f"Unexpected audio boundary reason: {reason or '<missing>'}",
                            event_index=index,
                        )
                    )
                if not isinstance(generation, int):
                    issues.append(
                        TraceIssue(
                            "audio_boundary_generation_missing",
                            "Audio boundary has no concrete generation",
                            event_index=index,
                        )
                    )
                elif last_boundary is not None and generation <= last_boundary:
                    issues.append(
                        TraceIssue(
                            "audio_boundary_not_advanced",
                            "Audio boundary did not advance its generation",
                            event_index=index,
                        )
                    )
                if isinstance(generation, int):
                    last_boundary = generation

            if name == "mic_gate_closed":
                provider_offset = event.get("provider_sample_offset")
                gate_closed_at = (
                    index,
                    int(provider_offset) if isinstance(provider_offset, int) else None,
                    generation if isinstance(generation, int) else None,
                )
                continue

            if gate_closed_at is None:
                continue
            closed_index, closed_offset, closed_generation = gate_closed_at
            provider_offset = event.get("provider_sample_offset")
            if (
                closed_offset is not None
                and isinstance(provider_offset, int)
                and provider_offset > closed_offset
            ):
                issues.append(
                    TraceIssue(
                        "provider_audio_while_mic_gate_closed",
                        "Provider input advanced while the half-duplex gate was closed",
                        event_index=index,
                    )
                )
                closed_offset = provider_offset
                gate_closed_at = (closed_index, closed_offset, closed_generation)
            if name == "mic_gate_opened":
                if (
                    closed_generation is not None
                    and isinstance(generation, int)
                    and generation <= closed_generation
                ):
                    issues.append(
                        TraceIssue(
                            "mic_gate_open_without_audio_boundary",
                            "Mic gate reopened without a fresh audio generation",
                            event_index=index,
                        )
                    )
                gate_closed_at = None

        if not require_contract:
            return

        accepted_stops = [
            index
            for index, event in enumerate(events)
            if names[index] == "speech_stopped" and event.get("accepted") is True
        ]
        all_stops = [index for index, name in enumerate(names) if name == "speech_stopped"]
        if len(accepted_stops) != len(all_stops):
            issues.append(
                TraceIssue(
                    "accepted_speech_boundary_missing",
                    "Every physical speech_stopped must be an accepted state transition",
                )
            )

        for position, stop_index in enumerate(accepted_stops):
            window_end = (
                accepted_stops[position + 1] if position + 1 < len(accepted_stops) else len(events)
            )
            closes = [
                index
                for index in range(stop_index + 1, window_end)
                if names[index] == "mic_gate_closed"
            ]
            cuts = [
                index
                for index in range(stop_index + 1, window_end)
                if names[index] == "audio_boundary_cut"
                and events[index].get("reason") == "speech-stopped"
            ]
            if len(closes) != 1 or len(cuts) != 1 or not (stop_index < closes[0] < cuts[0]):
                issues.append(
                    TraceIssue(
                        "speech_boundary_sequence_invalid",
                        "Accepted speech_stopped must close the mic and cut exactly one generation",
                        event_index=stop_index,
                    )
                )

        followup_opens = [
            index
            for index, event in enumerate(events)
            if names[index] == "mic_gate_opened" and event.get("reason") == "followup"
        ]
        followup_cuts = [
            index
            for index, event in enumerate(events)
            if names[index] == "audio_boundary_cut" and event.get("reason") == "followup-open"
        ]
        if len(followup_opens) != len(followup_cuts):
            issues.append(
                TraceIssue(
                    "followup_boundary_count",
                    "Each physical follow-up open must own exactly one audio boundary",
                )
            )
        for open_index in followup_opens:
            prior_finish = max(
                (index for index in range(open_index) if names[index] == "playback_finished"),
                default=-1,
            )
            owned_cuts = [index for index in followup_cuts if prior_finish < index < open_index]
            if prior_finish < 0 or len(owned_cuts) != 1:
                issues.append(
                    TraceIssue(
                        "followup_open_before_physical_boundary",
                        "Follow-up opened without playback finish and its exact audio cut",
                        event_index=open_index,
                    )
                )

        wake_opens = [
            index
            for index, event in enumerate(events)
            if names[index] == "mic_gate_opened" and event.get("reason") == "wake"
        ]
        if len(wake_opens) != 1:
            issues.append(
                TraceIssue(
                    "wake_mic_gate_open_count",
                    f"Expected exactly one wake mic-gate open, got {len(wake_opens)}",
                )
            )

        rearm_cuts = [
            index
            for index, event in enumerate(events)
            if names[index] == "audio_boundary_cut" and event.get("reason") == "rearm-ack"
        ]
        rearm_events = [index for index, name in enumerate(names) if name == "wake_rearm_recovered"]
        if len(rearm_cuts) != 1 or len(rearm_events) != 1 or rearm_cuts[0] > rearm_events[0]:
            issues.append(
                TraceIssue(
                    "rearm_audio_boundary_sequence",
                    "Recovered rearm must expose exactly one prior correlated audio cut",
                )
            )
        elif not (
            isinstance(events[rearm_cuts[0]].get("rearm_token"), int)
            and isinstance(events[rearm_events[0]].get("rearm_token"), int)
        ):
            issues.append(
                TraceIssue(
                    "rearm_token_missing",
                    "Rearm cut and recovered ACK must expose concrete firmware tokens",
                )
            )
        elif events[rearm_cuts[0]]["rearm_token"] != events[rearm_events[0]]["rearm_token"]:
            issues.append(
                TraceIssue(
                    "rearm_token_mismatch",
                    "Rearm audio cut and recovered ACK have different firmware tokens",
                    event_index=rearm_events[0],
                )
            )

    def _voicepe(
        self,
        trace: Mapping[str, Any] | Sequence[Mapping[str, Any]],
        names: list[str],
        issues: list[TraceIssue],
    ) -> None:
        self._require_once(names, "capture_started", issues)
        self._require_once(names, "capture_finished", issues)
        self._ordered(names, "capture_started", "wake_received", issues)
        self._ordered(names, "close_requested", "capture_finished", issues)
        if self.strict_physical:
            self._require_once(names, "teardown_complete", issues)
            self._require_once(names, "wake_rearm_recovered", issues)
            self._require_once(names, "next_wake_received", issues)
            self._require_once(names, "next_session_opened", issues)
            self._ordered(names, "close_requested", "wake_rearm_recovered", issues)
            self._ordered(names, "teardown_complete", "wake_rearm_recovered", issues)
            self._ordered(names, "wake_rearm_recovered", "capture_finished", issues)
            self._ordered(names, "capture_finished", "next_wake_received", issues)
            self._ordered(names, "next_wake_received", "next_session_opened", issues)
            for failure in (
                "teardown_step_timeout",
                "teardown_step_failed",
                "mic_stream_stop_failed",
                "rearm_blocked_incomplete_teardown",
                "playback_fault",
                "wake_rejected_incomplete_teardown",
            ):
                if failure in names:
                    issues.append(
                        TraceIssue(
                            "incomplete_physical_teardown",
                            f"Physical chain contains failure event: {failure}",
                            event_index=names.index(failure),
                        )
                    )
            if isinstance(trace, Mapping):
                events = trace.get("events") or []
                wake: Mapping[str, Any] = next(
                    (event for event in events if event.get("event") == "next_wake_received"),
                    {},
                )
                session: Mapping[str, Any] = next(
                    (event for event in events if event.get("event") == "next_session_opened"),
                    {},
                )
                attempt_id = wake.get("attempt_id")
                if not attempt_id or session.get("attempt_id") != attempt_id:
                    issues.append(
                        TraceIssue(
                            "next_session_attempt_mismatch",
                            "Next provider session is not bound to the exact physical wake attempt",
                        )
                    )
                if not session.get("history_session"):
                    issues.append(
                        TraceIssue(
                            "next_history_session_missing",
                            "Next provider session has no fresh conversation identity",
                        )
                    )
                if not isinstance(session.get("provider_generation"), int):
                    issues.append(
                        TraceIssue(
                            "next_provider_generation_missing",
                            "Next provider session has no concrete provider generation",
                        )
                    )

        if isinstance(trace, Mapping):
            stages = trace.get("stages")
            if not isinstance(stages, Mapping):
                issues.append(
                    TraceIssue("audio_stages_missing", "Voice PE trace has no audio stages")
                )
                return
            for stage in ("device", "provider"):
                metrics = stages.get(stage)
                if not isinstance(metrics, Mapping) or int(metrics.get("samples") or 0) <= 0:
                    issues.append(
                        TraceIssue(
                            f"{stage}_audio_missing",
                            f"Voice PE trace has no {stage} audio samples",
                        )
                    )
            expected_rates = {"device": 16000, "provider": 24000, "speaker": 24000}
            for stage, expected in expected_rates.items():
                metrics = stages.get(stage)
                if isinstance(metrics, Mapping) and int(metrics.get("rate") or 0) != expected:
                    issues.append(
                        TraceIssue(
                            f"{stage}_rate_unexpected",
                            f"Expected {stage} at {expected} Hz",
                        )
                    )
