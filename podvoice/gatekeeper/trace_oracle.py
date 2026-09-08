"""Mechanical scoring for recorded PodVoice conversation traces.

The oracle deliberately judges event causality, not Danish meaning.  A correct tool
call or answer can still be lucky when the input transcript is wrong, so callers must
pair this result with audio/transcript evaluation before approving a physical run.

Both Talk and Voice PE use :class:`ThinSession`; ``normalise_contract`` removes only
adapter-specific edges so their shared lifecycle shapes can be compared without
pretending that Talk proves wake, microphone, speaker, or rearm hardware.
"""

from __future__ import annotations

from collections import Counter, defaultdict
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
    "speech_started": "speech_started_or_interrupted",
    "user_speech_stopped": "speech_stopped",
    "assistant_audio_started": "response_audio_started",
    "reply_playback_started": "playback_started",
    "reply_playback_finished": "playback_finished",
    "session_close_requested": "close_requested",
    "session_closed": "capture_finished",
    "talk_ready": "followup_ready",
}


_OWNER_MARKERS = frozenset(
    "accepted_input_turn rejected_input_quarantined input_quarantine_started "
    "input_quarantine_resolved conversation_item_deleted response_create_pre_wire "
    "response_create_sent".split()
)
_OWNER_RELEVANT = _OWNER_MARKERS | frozenset(
    "speech_started speech_started_or_interrupted speech_stopped "
    "half_duplex_input_discarded input_audio_buffer_committed "
    "conversation_item_added conversation_item_created response_created response_done "
    "response_output_item_added response_output_item_done response_audio_started tool_call".split()
)
_TurnKey = tuple[int, str]


def _owner_name(event: Mapping[str, Any]) -> str:
    return str(event.get("event") or "").removeprefix("provider_")


def _owner_id(event: Mapping[str, Any], *names: str) -> str:
    values = (event.get(name) for name in names)
    return next(
        (
            str(value)
            for value in values
            if isinstance(value, (str, int)) and value and not isinstance(value, bool)
        ),
        "",
    )


def _provider_generation(event: Mapping[str, Any]) -> int | None:
    values = (event.get(name) for name in ("generation", "provider_generation"))
    return next(
        (value for value in values if isinstance(value, int) and not isinstance(value, bool)),
        None,
    )


def _ownership_enabled(events: Sequence[Mapping[str, Any]]) -> bool:
    for event in events:
        name = _owner_name(event)
        if name in _OWNER_MARKERS or _owner_id(event, "root_item_id"):
            return True
        if name in {
            "speech_started",
            "speech_started_or_interrupted",
            "speech_stopped",
            "half_duplex_input_discarded",
        } and _owner_id(event, "item_id"):
            return True
    return False


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
        require_next_session: bool | None = None,
        require_turn_ownership: bool = False,
    ) -> None:
        self.adapter = adapter
        self.strict_physical = strict_physical
        self.minimum_user_turns = max(0, int(minimum_user_turns))
        self.require_semantic_close = require_semantic_close
        self.require_next_session = (
            strict_physical if require_next_session is None else bool(require_next_session)
        )
        self.require_turn_ownership = bool(require_turn_ownership)

    def score(self, trace: Mapping[str, Any] | Sequence[Mapping[str, Any]]) -> TraceReport:
        events = _events(trace)
        issues: list[TraceIssue] = []
        names = [_name(event) for event in events]
        counts = Counter(names)

        if not events:
            issues.append(TraceIssue("events_missing", "Trace has no structured events"))
            return TraceReport(self.adapter, tuple(issues), (), 0, 0)

        for index, name in enumerate(names):
            if name == "provider_trace_truncated":
                issues.append(
                    TraceIssue(
                        "provider_trace_truncated",
                        "Provider ancestry was truncated; this trace cannot prove lifecycle",
                        event_index=index,
                    )
                )

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

        owned_turns = self._turn_ownership(events, names, issues)
        if self.require_turn_ownership and owned_turns is None:
            issues.append(
                TraceIssue(
                    "turn_ownership_missing",
                    "Trace has no complete local-to-provider turn ownership evidence",
                )
            )
        user_turns = counts["speech_stopped"] if owned_turns is None else owned_turns
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
        self._speech_windows(events, names, issues)

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
    def _turn_ownership(
        events: list[Mapping[str, Any]],
        names: list[str],
        issues: list[TraceIssue],
    ) -> int | None:
        """Prove local turn -> provider item -> request -> response ownership."""

        if not _ownership_enabled(events):
            return None

        marks: defaultdict[_TurnKey, defaultdict[str, list[int]]] = defaultdict(
            lambda: defaultdict(list)
        )
        item_sets: defaultdict[_TurnKey, defaultdict[str, set[str]]] = defaultdict(
            lambda: defaultdict(set)
        )
        item_roots: dict[_TurnKey, _TurnKey] = {}
        raw_items: list[tuple[str, int, int, str]] = []
        requests_raw: list[tuple[int, Mapping[str, Any]]] = []
        responses_raw: list[tuple[int, Mapping[str, Any]]] = []
        dependents: list[tuple[int, Mapping[str, Any], str]] = []
        followups: list[int] = []
        active_generation: int | None = None

        def fail(code: str, message: str, index: int | None = None) -> None:
            issues.append(TraceIssue(code, message, event_index=index))

        def mark(key: _TurnKey, stage: str, index: int, item_id: str = "") -> None:
            marks[key][stage].append(index)
            if item_id:
                item_sets[key][stage].add(item_id)

        def bind(item: _TurnKey, root: _TurnKey, index: int) -> None:
            previous = item_roots.get(item)
            if previous is not None and previous != root:
                fail("turn_ownership_conflict", f"Item {item[1]} has two roots", index)
            item_roots[item] = root

        for index, event in enumerate(events):
            name = _owner_name(event)
            if names[index] == "provider_connected":
                active_generation = _provider_generation(event)
                continue
            if name == "mic_gate_opened" and event.get("reason") == "followup":
                followups.append(index)
                continue
            user_item = name in {"conversation_item_added", "conversation_item_created"} and (
                event.get("role") == "user" or event.get("item_type") == "input_audio"
            )
            tool_item = (
                name in {"response_output_item_added", "response_output_item_done"}
                and event.get("item_type") == "function_call"
            )
            if name not in _OWNER_RELEVANT and not user_item and not tool_item:
                continue
            generation = _provider_generation(event)
            if generation is None:
                fail("turn_generation_missing", "Ownership event has no generation", index)
                continue
            if active_generation is None:
                active_generation = generation
            elif generation != active_generation:
                fail("stale_turn_generation", "Ownership event uses a stale generation", index)

            root_id = _owner_id(event, "root_item_id", "input_item_id", "item_id")
            key = (generation, root_id) if root_id else None
            stage = (
                "local_accept"
                if name == "speech_stopped" and event.get("accepted") is True
                else "local_reject"
                if name == "half_duplex_input_discarded"
                else "quarantine_start"
                if name == "input_quarantine_started"
                else "quarantine_done"
                if name == "rejected_input_quarantined"
                else "quarantine_resolved"
                if name == "input_quarantine_resolved"
                else "accepted"
                if name == "accepted_input_turn"
                else ""
            )
            if stage:
                if key is None:
                    fail("provider_item_without_local_turn", f"{name} omitted item id", index)
                    continue
                mark(key, stage, index)
                committed = _owner_id(event, "committed_item_id")
                if stage == "accepted" and committed:
                    bind((generation, committed), key, index)
            elif name == "input_audio_buffer_committed":
                item_id = _owner_id(event, "item_id")
                raw_items.append(("commit", index, generation, item_id))
            elif user_item:
                item_id = _owner_id(event, "item_id")
                raw_items.append(("user_item", index, generation, item_id))
            elif name == "conversation_item_deleted":
                item_id = _owner_id(event, "item_id")
                if key is None or not item_id:
                    fail("rejected_item_not_deleted", "Delete ACK omitted ownership", index)
                else:
                    bind((generation, item_id), key, index)
                    mark(key, "delete", index, item_id)
            elif name == "response_create_sent":
                requests_raw.append((index, event))
            elif name == "response_created":
                responses_raw.append((index, event))
            elif name in {"response_done", "response_audio_started"}:
                dependents.append((index, event, name))
            elif name == "tool_call" or tool_item:
                dependents.append((index, event, name))

        for stage, index, generation, item_id in raw_items:
            if not item_id:
                fail("provider_item_without_local_turn", f"{stage} omitted item id", index)
                continue
            key = item_roots.get((generation, item_id), (generation, item_id))
            mark(key, stage, index, item_id)

        accepted = {key for key, stages in marks.items() if stages["accepted"]}
        rejected = {
            key
            for key, stages in marks.items()
            if any(
                stages[stage] for stage in ("local_reject", "quarantine_start", "quarantine_done")
            )
        }
        for key in accepted & rejected:
            fail("turn_ownership_conflict", f"Turn {key[1]} is accepted and rejected")
        for key, stages in marks.items():
            if stages["local_accept"] and key not in accepted:
                fail("accepted_turn_authorization_missing", f"Turn {key[1]} was not accepted")
            if (stages["commit"] or stages["user_item"]) and key not in accepted | rejected:
                fail("provider_item_without_local_turn", f"Provider item {key[1]} has no owner")

        def one(key: _TurnKey, stage: str, code: str) -> int | None:
            rows = marks[key][stage]
            if len(rows) != 1:
                fail(
                    code, f"Turn {key[1]} has {len(rows)} {stage} edges", rows[0] if rows else None
                )
                return None
            return rows[0]

        accepted_turns: dict[_TurnKey, str] = {}
        for key in accepted:
            accepted_index = one(key, "accepted", "accepted_turn_authorization_missing")
            is_text = (
                accepted_index is not None and events[accepted_index].get("input_kind") == "text"
            )
            indexes = [
                one(key, "local_accept", "provider_item_without_local_turn"),
                one(key, "user_item", "accepted_turn_missing_provider_item"),
                accepted_index,
            ]
            if not is_text:
                indexes.insert(1, one(key, "commit", "accepted_turn_missing_provider_item"))
            values = [index for index in indexes if index is not None]
            turn_id = (
                _owner_id(events[accepted_index], "turn_id", "turn")
                if accepted_index is not None
                else ""
            )
            accepted_turns[key] = turn_id
            if not turn_id:
                fail("provider_response_without_accepted_turn", f"Turn {key[1]} omitted turn id")
            if len(values) == len(indexes) and not (
                values[0] < min(values[1:-1]) <= max(values[1:-1]) <= values[-1]
            ):
                fail("provider_item_without_local_turn", f"Turn {key[1]} ownership is out of order")

        requests: dict[str, tuple[int, _TurnKey, str, str]] = {}
        for index, event in requests_raw:
            request_id = _owner_id(event, "request_id")
            root_id = _owner_id(event, "root_item_id")
            generation = _provider_generation(event)
            turn_id = _owner_id(event, "turn_id", "turn")
            purpose = _owner_id(event, "purpose")
            key = (generation, root_id) if generation is not None and root_id else None
            if not request_id or key is None or not turn_id or not purpose:
                fail(
                    "provider_response_without_accepted_turn",
                    "Response request omitted owner",
                    index,
                )
                continue
            if request_id in requests:
                fail("duplicate_initial_response_request", f"Request {request_id} repeated", index)
                continue
            requests[request_id] = (index, key, turn_id, purpose)
            if key in rejected:
                fail(
                    "rejected_turn_created_response",
                    f"Rejected turn {key[1]} requested response",
                    index,
                )
                continue
            if key not in accepted or accepted_turns.get(key) != turn_id:
                fail(
                    "provider_response_without_accepted_turn",
                    f"Request {request_id} has no turn",
                    index,
                )
                continue
            if index <= marks[key]["accepted"][0]:
                fail(
                    "provider_response_without_accepted_turn",
                    f"Request {request_id} is early",
                    index,
                )
            if purpose == "turn" and not _owner_id(event, "source_call_id"):
                mark(key, "initial_request", index)

        for key in accepted:
            initial = marks[key]["initial_request"]
            if len(initial) != 1:
                fail(
                    "duplicate_initial_response_request"
                    if len(initial) > 1
                    else "accepted_turn_missing_initial_response_request",
                    f"Turn {key[1]} has {len(initial)} initial requests",
                )

        owned: dict[str, tuple[int, _TurnKey]] = {}
        request_responses: Counter[str] = Counter()
        for index, event in responses_raw:
            response_id = _owner_id(event, "response_id")
            request_id = _owner_id(event, "request_id")
            request = requests.get(request_id)
            generation = _provider_generation(event)
            root_id = _owner_id(event, "root_item_id")
            key = (generation, root_id) if generation is not None and root_id else None
            if key in rejected:
                fail(
                    "rejected_turn_created_response",
                    f"Rejected turn {key[1]} created response",
                    index,
                )
            valid = (
                bool(response_id)
                and request is not None
                and event.get("request_id_matched") is True
                and request[0] < index
                and key == request[1]
                and _owner_id(event, "turn_id", "turn") == request[2]
                and _owner_id(event, "purpose") == request[3]
            )
            input_generation = event.get("input_generation")
            if isinstance(input_generation, int) and not isinstance(input_generation, bool):
                valid = valid and key is not None and input_generation == key[0]
            if not valid or request is None:
                fail(
                    "provider_response_without_accepted_turn",
                    f"Response {response_id or '?'} is unowned",
                    index,
                )
                continue
            request_responses[request_id] += 1
            if response_id in owned or request_responses[request_id] > 1:
                fail("duplicate_provider_response", f"Response {response_id} repeated", index)
            else:
                owned[response_id] = (index, request[1])

        provider_terminals: defaultdict[str, list[tuple[int, str]]] = defaultdict(list)
        for index, event, kind in dependents:
            if kind == "response_done" and str(event.get("event") or "").startswith("provider_"):
                response_id = _owner_id(event, "response_id")
                if response_id:
                    provider_terminals[response_id].append(
                        (index, _owner_id(event, "status") or "?")
                    )

        for index, event, kind in dependents:
            response_id = _owner_id(event, "response_id")
            owner = owned.get(response_id)
            if owner is None or owner[0] >= index:
                fail(
                    "tool_call_without_owned_response"
                    if kind
                    in {"tool_call", "response_output_item_added", "response_output_item_done"}
                    else "provider_response_without_accepted_turn",
                    f"Event has no owned response {response_id or '?'}",
                    index,
                )
                continue
            if kind == "tool_call":
                terminals = [row for row in provider_terminals[response_id] if row[0] < index]
                if len(terminals) != 1 or terminals[0][1] != "completed":
                    fail(
                        "tool_call_from_uncompleted_response",
                        f"Tool call escaped response {response_id} before completed",
                        index,
                    )

        cleanup = (
            "local_reject",
            "quarantine_start",
            "commit",
            "user_item",
            "delete",
            "quarantine_done",
            "quarantine_resolved",
        )
        for key in rejected:
            indexes = [one(key, stage, "rejected_item_not_deleted") for stage in cleanup]
            values = [index for index in indexes if index is not None]
            same_items = (
                bool(item_sets[key]["commit"])
                and item_sets[key]["commit"]
                == item_sets[key]["user_item"]
                == item_sets[key]["delete"]
            )
            ordered = len(values) == len(cleanup) and (
                values[0]
                <= values[1]
                < min(values[2], values[3])
                <= max(values[2], values[3])
                < values[4]
                < values[5]
                < values[6]
            )
            done = indexes[5]
            expected = events[done].get("committed_item_count") if done is not None else None
            count_ok = not isinstance(expected, int) or expected == len(item_sets[key]["commit"])
            if not (same_items and ordered and count_ok):
                fail("rejected_item_not_deleted", f"Turn {key[1]} cleanup is incomplete")
            start, resolved = indexes[1], indexes[6]
            premature = next(
                (
                    opened
                    for opened in followups
                    if start is not None and resolved is not None and start < opened < resolved
                ),
                None,
            )
            if premature is not None:
                fail(
                    "followup_open_before_rejected_turn_cleanup",
                    f"Follow-up opened before {key[1]} cleanup",
                    premature,
                )

        return len(accepted)

    @staticmethod
    def _speech_windows(
        events: list[Mapping[str, Any]], names: list[str], issues: list[TraceIssue]
    ) -> None:
        """Room-idle may never race an unfinished provider-VAD turn.

        Explicit stop, provider/device failure and max-duration remain authoritative
        bounded closers even if the provider never supplies its matching stop edge.
        """
        speech_started_at: int | None = None
        for index, (event, name) in enumerate(zip(events, names, strict=True)):
            if name == "speech_started_or_interrupted":
                if speech_started_at is None:
                    speech_started_at = index
                continue
            if name == "speech_stopped":
                speech_started_at = None
                continue
            if (
                name == "close_requested"
                and speech_started_at is not None
                and event.get("reason") == "idle-fallback"
            ):
                issues.append(
                    TraceIssue(
                        "close_during_open_speech",
                        "Transport close began while provider VAD still had an open user turn",
                        event_index=index,
                    )
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
            self._ordered(names, "close_requested", "wake_rearm_recovered", issues)
            self._ordered(names, "teardown_complete", "wake_rearm_recovered", issues)
            self._ordered(names, "wake_rearm_recovered", "capture_finished", issues)
            if self.require_next_session:
                self._require_once(names, "next_wake_received", issues)
                self._require_once(names, "next_session_opened", issues)
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
            if self.require_next_session and isinstance(trace, Mapping):
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
