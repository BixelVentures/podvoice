"""Bounded, no-side-effect evaluation harness for PodVoice Realtime.

The scenario runner is deliberately independent of Talk and Voice PE.  Both adapters
can implement :class:`ConversationDriver`, so the same oracle grades provider-only,
Talk, simulated Voice PE and (eventually) hardware-observed runs.  The included live
driver exercises the real OpenAI Realtime protocol with production prompt/config but
dispatches only to :class:`SafeEvalTools`; it can never reach HA, MCP or PodConnect.

Live evaluation is opt-in.  It is suitable for an authenticated add-on endpoint through
``LiveEvalService.run`` or for ``python -m gatekeeper.eval_harness --live`` inside the
add-on.  The API key is read from the environment and never appears in artifacts.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import hashlib
import json
import os
import pathlib
import re
import time
import unicodedata
import uuid
import wave
from dataclasses import asdict, dataclass, field
from typing import Any, ClassVar, Protocol

from . import constants as C
from .config import load_config
from .execution_policy import ExecutionContext, ExecutionPolicy, Risk
from .openai_realtime import (
    DEFAULT_MODEL,
    DEFAULT_VOICE,
    MAX_OUTPUT_TOKENS,
    OpenAIRealtimeSession,
)
from .prompt import PROMPT_VERSION, SYSTEM_PROMPT_DA
from .provider_budget import PROVIDER_BUDGET, BudgetLease, ProviderBudgetCoordinator
from .thin import (
    APPROVE_ACTION_DECLARATION,
    END_CONVERSATION_DECLARATION,
    WAIT_FOR_USER_DECLARATION,
)
from .voice import (
    AudioChunk,
    InputTranscript,
    OutputTranscript,
    SilentToolComplete,
    ToolCall,
    ToolRoundComplete,
    TurnComplete,
    Usage,
)

SCENARIOS_PATH = pathlib.Path(__file__).with_name("eval_scenarios.json")
RESERVED_TOOLS = {"end_conversation", "wait_for_user", "approve_action"}
RESERVED_DECLARATIONS = (
    END_CONVERSATION_DECLARATION,
    WAIT_FOR_USER_DECLARATION,
    APPROVE_ACTION_DECLARATION,
)
SAFE_EVAL_HIGH_RISK_TOOL = "EvalUnlockDoor"


def _schema_sha256(declarations: list[dict[str, Any]] | tuple[dict[str, Any], ...]) -> str:
    return hashlib.sha256(
        json.dumps(
            declarations,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()


@dataclass(frozen=True)
class TurnExpectation:
    decision: str | None = None
    decisions: tuple[str, ...] = ()
    decision_batches: tuple[tuple[str, ...], ...] = ()
    allowed_decisions: tuple[str, ...] = ()
    direct_answer: bool = False
    allow_direct: bool = False
    forbid: tuple[str, ...] = ()
    answer_any: tuple[str, ...] = ()
    answer_all: tuple[str, ...] = ()
    answer_patterns: tuple[str, ...] = ()
    tool_args: dict[str, dict[str, Any]] = field(default_factory=dict)
    tool_outcomes: dict[str, tuple[str, ...]] = field(default_factory=dict)
    fixture_side_effects: int | None = None
    remain_open: bool = True


@dataclass(frozen=True)
class EvalTurn:
    text: str
    expect: TurnExpectation


@dataclass(frozen=True)
class EvalScenario:
    id: str
    description: str
    turns: tuple[EvalTurn, ...]


@dataclass(frozen=True)
class AudioReplayFixture:
    trace_id: str
    turn_index: int
    pcm: bytes
    rate: int
    duration_ms: int
    sha256: str
    diagnostic_transcript: str
    exact_sample_offsets: bool
    room_context: str = ""
    source_tool_schema_sha256: str | None = None


@dataclass
class TurnObservation:
    turn_id: str
    session_id: str
    accepted: bool = True
    decisions: list[str] = field(default_factory=list)
    decision_batches: list[list[str]] = field(default_factory=list)
    tool_args: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    tool_results: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    fixture_side_effects: int = 0
    answer: str = ""
    response_status: str = "completed"
    error: str | None = None
    remain_open: bool = True
    elapsed_ms: int | None = None
    first_audio_ms: int | None = None
    diagnostic_transcript: str = ""
    usage: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class Finding:
    code: str
    message: str


@dataclass
class TurnResult:
    turn_id: str
    text: str
    passed: bool
    observation: TurnObservation
    findings: list[Finding]


@dataclass
class ScenarioResult:
    scenario_id: str
    passed: bool
    session_id: str
    turns: list[TurnResult]


class ConversationDriver(Protocol):
    """Small seam implemented by provider, Talk and Voice PE eval adapters."""

    async def open(self, *, run_id: str, scenario_id: str) -> str: ...

    async def submit_text(self, *, turn_id: str, text: str) -> TurnObservation: ...

    async def close(self) -> None: ...


def load_scenarios(path: pathlib.Path = SCENARIOS_PATH) -> tuple[EvalScenario, ...]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("schema_version") != 1:
        raise ValueError("unsupported eval scenario schema")
    seen: set[str] = set()
    scenarios: list[EvalScenario] = []
    for entry in raw.get("scenarios", []):
        scenario_id = str(entry.get("id") or "")
        if not scenario_id or scenario_id in seen:
            raise ValueError(f"missing or duplicate scenario id: {scenario_id!r}")
        seen.add(scenario_id)
        turns: list[EvalTurn] = []
        for row in entry.get("turns", []):
            text = str(row.get("text") or "").strip()
            if not text:
                raise ValueError(f"{scenario_id}: empty turn")
            expected = row.get("expect") or {}
            answer_patterns = tuple(expected.get("answer_patterns") or ())
            for pattern in answer_patterns:
                re.compile(pattern)
            turns.append(
                EvalTurn(
                    text=text,
                    expect=TurnExpectation(
                        decision=expected.get("decision"),
                        decisions=tuple(expected.get("decisions") or ()),
                        decision_batches=tuple(
                            tuple(batch) for batch in (expected.get("decision_batches") or ())
                        ),
                        allowed_decisions=tuple(expected.get("allowed_decisions") or ()),
                        direct_answer=bool(expected.get("direct_answer", False)),
                        allow_direct=bool(expected.get("allow_direct", False)),
                        forbid=tuple(expected.get("forbid") or ()),
                        answer_any=tuple(expected.get("answer_any") or ()),
                        answer_all=tuple(expected.get("answer_all") or ()),
                        answer_patterns=answer_patterns,
                        tool_args={
                            str(name): dict(args)
                            for name, args in (expected.get("tool_args") or {}).items()
                        },
                        tool_outcomes={
                            str(name): tuple(outcomes)
                            for name, outcomes in (expected.get("tool_outcomes") or {}).items()
                        },
                        fixture_side_effects=expected.get("fixture_side_effects"),
                        remain_open=bool(expected.get("remain_open", True)),
                    ),
                )
            )
        if not turns:
            raise ValueError(f"{scenario_id}: no turns")
        scenarios.append(
            EvalScenario(scenario_id, str(entry.get("description") or ""), tuple(turns))
        )
    return tuple(scenarios)


def match_scenario_turn(text: str) -> tuple[EvalScenario, int] | None:
    """Match only an exact known eval utterance; never infer production intent."""
    needle = _normalise(text)
    matches = [
        (scenario, index)
        for scenario in load_scenarios()
        for index, turn in enumerate(scenario.turns)
        if _normalise(turn.text) == needle
    ]
    return matches[0] if len(matches) == 1 else None


def _normalise(value: str) -> str:
    folded = unicodedata.normalize("NFKD", value.casefold())
    return " ".join(re.sub(r"[^a-z0-9æøå]+", " ", folded).split())


def grade_turn(expect: TurnExpectation, observed: TurnObservation) -> list[Finding]:
    findings: list[Finding] = []
    if not observed.accepted:
        findings.append(Finding("not-accepted", "Inputtet blev ikke provider-kvitteret."))
    if observed.error:
        findings.append(Finding("provider-error", observed.error))
    if observed.response_status != "completed":
        findings.append(
            Finding("response-status", f"Providerstatus var {observed.response_status!r}.")
        )
    decisions = observed.decisions
    allowed = set(expect.allowed_decisions)
    if expect.direct_answer:
        if decisions:
            findings.append(
                Finding(
                    "wrong-decision",
                    f"Forventede ét direkte svar uden værktøj, fik {decisions}.",
                )
            )
    elif expect.decisions:
        if decisions != list(expect.decisions):
            findings.append(
                Finding(
                    "wrong-decision-order",
                    f"Forventede beslutningerne {list(expect.decisions)}, fik {decisions}.",
                )
            )
    elif expect.decision:
        if decisions != [expect.decision]:
            findings.append(
                Finding(
                    "wrong-decision",
                    f"Forventede præcis {expect.decision}, fik {decisions or 'ingen beslutning'}.",
                )
            )
    elif allowed and not (
        (expect.allow_direct and not decisions) or (len(decisions) == 1 and decisions[0] in allowed)
    ):
        findings.append(
            Finding("wrong-decision", f"Forventede én af {sorted(allowed)}, fik {decisions}.")
        )
    forbidden = sorted(set(decisions).intersection(expect.forbid))
    if forbidden:
        findings.append(Finding("forbidden-decision", f"Forbudte kald: {forbidden}."))
    if expect.decision_batches and observed.decision_batches != [
        list(batch) for batch in expect.decision_batches
    ]:
        findings.append(
            Finding(
                "wrong-decision-batches",
                f"Forventede batchrækkefølgen {list(expect.decision_batches)}, "
                f"fik {observed.decision_batches}.",
            )
        )
    for name, expected_args in expect.tool_args.items():
        actual_args = observed.tool_args.get(name, [])
        if expected_args not in actual_args:
            findings.append(
                Finding(
                    "wrong-tool-args",
                    f"Forventede {name} med {expected_args}, fik {actual_args or 'ingen kald'}.",
                )
            )
    for name, expected_outcomes in expect.tool_outcomes.items():
        actual_outcomes = tuple(
            _tool_result_outcome(result) for result in observed.tool_results.get(name, [])
        )
        if actual_outcomes != expected_outcomes:
            findings.append(
                Finding(
                    "wrong-tool-outcome",
                    f"Forventede {name}-udfald {list(expected_outcomes)}, "
                    f"fik {list(actual_outcomes)}.",
                )
            )
    if (
        expect.fixture_side_effects is not None
        and observed.fixture_side_effects != expect.fixture_side_effects
    ):
        findings.append(
            Finding(
                "wrong-fixture-side-effects",
                f"Forventede {expect.fixture_side_effects} sikre fixture-effekter, "
                f"fik {observed.fixture_side_effects}.",
            )
        )
    answer = _normalise(observed.answer)
    if expect.answer_any and not any(_normalise(x) in answer for x in expect.answer_any):
        findings.append(
            Finding("answer-missing-any", f"Svaret matchede ingen af {list(expect.answer_any)}.")
        )
    missing = [x for x in expect.answer_all if _normalise(x) not in answer]
    if missing:
        findings.append(Finding("answer-missing-all", f"Svaret manglede {missing}."))
    if expect.answer_patterns and not any(
        re.search(pattern, answer) for pattern in expect.answer_patterns
    ):
        findings.append(
            Finding(
                "answer-pattern-mismatch",
                "Svaret havde ikke den forventede betydningsrækkefølge.",
            )
        )
    if observed.remain_open is not expect.remain_open:
        findings.append(
            Finding(
                "wrong-lifecycle",
                f"Forventede remain_open={expect.remain_open}, fik {observed.remain_open}.",
            )
        )
    return findings


def _tool_result_outcome(result: dict[str, Any]) -> str:
    """Reduce a safe fixture result to a stable semantic/mechanical outcome."""
    error_kind = result.get("error_kind")
    if isinstance(error_kind, str) and error_kind:
        return error_kind
    data = result.get("data")
    if isinstance(data, dict) and data.get("decision") == "approved_action":
        return "approved_action"
    return "ok" if result.get("ok") is True else "failed"


@dataclass
class EvalBudget:
    max_turns: int = 20
    max_reserved_tokens: int = 30_000
    # Total-run bounds are deliberately distinct from the rolling TPM throttle.
    # Four fresh sessions repeat the prompt/tool schema and legitimately exceed 30k
    # total tokens even when split safely across multiple one-minute windows.
    max_actual_tokens: int = 80_000
    max_cost_usd: float = 0.25
    turns: int = 0
    reserved_tokens: int = 0
    actual_tokens: int = 0
    cost_usd: float = 0.0
    rate_limit_wait_s: float = 0.0

    def reserve(self, responses: int = 2) -> None:
        requested = responses * MAX_OUTPUT_TOKENS
        if self.turns + 1 > self.max_turns:
            raise RuntimeError("eval turn budget exhausted")
        if self.reserved_tokens + requested > self.max_reserved_tokens:
            raise RuntimeError("eval response-token reservation budget exhausted")
        self.turns += 1
        self.reserved_tokens += requested

    def record(self, usage: dict[str, int]) -> None:
        # Cached counts are a breakdown of input, not extra tokens.
        tokens = sum(
            max(0, int(usage.get(key, 0)))
            for key in (
                "input_text_tokens",
                "input_audio_tokens",
                "output_text_tokens",
                "output_audio_tokens",
            )
        )
        self.actual_tokens += tokens
        # Current gpt-realtime-2.1 USD / token. This is an explicit bounded guard,
        # not billing truth; artifacts retain token counts so rates can be revised.
        rates = {
            "input_text_tokens": 4.0 / 1_000_000,
            "input_audio_tokens": 32.0 / 1_000_000,
            "cached_text_tokens": 0.4 / 1_000_000,
            "cached_audio_tokens": 0.4 / 1_000_000,
            "output_text_tokens": 24.0 / 1_000_000,
            "output_audio_tokens": 64.0 / 1_000_000,
        }
        cached_text = max(0, int(usage.get("cached_text_tokens", 0)))
        cached_audio = max(0, int(usage.get("cached_audio_tokens", 0)))
        billable = {
            **usage,
            "input_text_tokens": max(0, int(usage.get("input_text_tokens", 0)) - cached_text),
            "input_audio_tokens": max(0, int(usage.get("input_audio_tokens", 0)) - cached_audio),
        }
        self.cost_usd += sum(
            max(0, int(billable.get(key, 0))) * rate for key, rate in rates.items()
        )
        if self.actual_tokens > self.max_actual_tokens:
            raise RuntimeError("eval actual-token budget exhausted")
        if self.cost_usd > self.max_cost_usd:
            raise RuntimeError("eval cost budget exhausted")


class SafeEvalTools:
    """Production-shaped declarations and policy with no external clients.

    The evaluator deliberately implements the same *mechanical* confirmation boundary
    as production instead of returning success for every declared tool.  A sensitive
    proposal creates an opaque, server-held challenge and has zero fixture effects.
    Only the exact immediately following eval turn may consume that challenge once.
    Nothing in this class imports or constructs HA, MCP or PodConnect clients.
    """

    _RESULTS: ClassVar[dict[str, dict[str, Any]]] = {
        "google_web_sogning": {
            "ok": True,
            "summary": "FCK vandt to nul i den seneste kamp.",
            "data": {
                "result": "FCK vandt 2-0 i den seneste kamp.",
                "sources": ["https://example.invalid/fixed-eval-source"],
            },
        },
        "HassTurnOn": {"ok": True, "summary": "Tændt."},
    }

    def __init__(
        self,
        declarations: list[dict[str, Any]] | None = None,
        *,
        include_sensitive_fixture: bool = False,
    ) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.fixture_side_effects = 0
        self._turn_serial = 0
        self._active_turn_id: str | None = None
        self._session_id = f"safe-eval-{uuid.uuid4().hex}"
        self._policy = ExecutionPolicy(
            trusted_tools={
                "get_time": Risk.READ_ONLY,
                "google_web_sogning": Risk.READ_ONLY,
                "HassTurnOn": Risk.LOW_RISK,
            }
        )
        if declarations is None:
            self._declarations = self._safe_declarations()
            if not include_sensitive_fixture:
                self._declarations = [
                    item
                    for item in self._declarations
                    if item.get("name") != SAFE_EVAL_HIGH_RISK_TOOL
                ]
        else:
            self._declarations = [
                json.loads(json.dumps(item))
                for item in declarations
                if item.get("name") not in RESERVED_TOOLS
            ]
            if include_sensitive_fixture and not any(
                item.get("name") == SAFE_EVAL_HIGH_RISK_TOOL for item in self._declarations
            ):
                fixture = next(
                    item
                    for item in self._safe_declarations()
                    if item["name"] == SAFE_EVAL_HIGH_RISK_TOOL
                )
                self._declarations.append(fixture)
            self._declarations.extend(dict(item) for item in RESERVED_DECLARATIONS)

    @staticmethod
    def _safe_declarations() -> list[dict[str, Any]]:
        return [
            {
                "name": "get_time",
                "description": "Read precisely requested current local time fields. "
                "weekday is the day name; week_number is the numbered ISO week. "
                "Never confuse them.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "fields": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "enum": ["time", "date", "weekday", "week_number"],
                            },
                            "minItems": 1,
                            "uniqueItems": True,
                        }
                    },
                    "required": ["fields"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "google_web_sogning",
                "description": "Search current external facts such as sport and news.",
                "parameters": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "HassTurnOn",
                "description": "Turn on a Home Assistant entity. Eval result only.",
                "parameters": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                    "required": ["name"],
                    "additionalProperties": False,
                },
            },
            {
                "name": SAFE_EVAL_HIGH_RISK_TOOL,
                "description": (
                    "Unlock the named door lock. This is a sensitive access action and "
                    "must receive server-held confirmation before execution. Eval only."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                    "required": ["name"],
                    "additionalProperties": False,
                },
            },
            dict(END_CONVERSATION_DECLARATION),
            dict(WAIT_FOR_USER_DECLARATION),
            dict(APPROVE_ACTION_DECLARATION),
        ]

    def declarations(self) -> list[dict[str, Any]]:
        return json.loads(json.dumps(self._declarations))

    def begin_turn(self, turn_id: str) -> None:
        if self._active_turn_id is not None:
            raise RuntimeError("safe eval turn already active")
        self._turn_serial += 1
        self._active_turn_id = turn_id
        self._policy.begin_turn(ExecutionContext(self._session_id, turn_id))

    def finish_turn(self) -> None:
        self._active_turn_id = None

    def _challenge(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        if self._active_turn_id is None:
            return {
                "ok": False,
                "error_kind": "approval_denied",
                "error": "sensitive eval proposal outside an active turn",
            }
        denied = self._policy.authorize(
            name,
            args,
            description="Unlock a named door lock.",
            context=ExecutionContext(self._session_id, self._active_turn_id),
        )
        if denied is None:  # The exact eval tool must always be classified sensitive.
            raise RuntimeError("safe eval sensitive tool was not challenged")
        return denied

    def _approve(self, args: dict[str, Any]) -> dict[str, Any]:
        challenge_id = args.get("challenge_id")
        if (
            self._active_turn_id is None
            or set(args) != {"challenge_id"}
            or not isinstance(challenge_id, str)
        ):
            return {
                "ok": False,
                "error_kind": "approval_denied",
                "error": "eval challenge is changed, expired, replayed, or out of turn",
            }
        context = ExecutionContext(self._session_id, self._active_turn_id)
        approved = self._policy.confirm(challenge_id, confirmation_context=context)
        if approved is None:
            return {
                "ok": False,
                "error_kind": "approval_denied",
                "error": "eval challenge is changed, expired, replayed, or out of turn",
            }
        denied = self._policy.authorize(
            approved.action,
            approved.args,
            description="Unlock a named door lock.",
            context=approved.context,
            approval_token=approved.token,
        )
        if denied is not None:
            return denied
        self.fixture_side_effects += 1
        return {
            "ok": True,
            "summary": "Den bekræftede testhandling blev udført i fixturet.",
            "data": {
                "decision": "approved_action",
                "tool": approved.action,
                "args": json.loads(json.dumps(approved.args)),
            },
        }

    async def dispatch(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((name, dict(args)))
        if name == SAFE_EVAL_HIGH_RISK_TOOL:
            return self._challenge(name, args)
        if name == "approve_action":
            return self._approve(args)
        if name == "get_time":
            values: dict[str, tuple[str, Any]] = {
                "time": ("Klokken er fjorten.", "14:00"),
                "date": ("Datoen er den 17. august 2026.", "2026-08-17"),
                "weekday": ("I dag er det mandag.", "mandag"),
                "week_number": ("Det er uge 34.", 34),
            }
            fields = args.get("fields")
            if (
                not isinstance(fields, list)
                or not fields
                or any(field not in values for field in fields)
                or len(set(fields)) != len(fields)
            ):
                return {
                    "ok": False,
                    "error_kind": "bad_args",
                    "error": "invalid eval time fields",
                }
            return {
                "ok": True,
                "summary": " ".join(values[field][0] for field in fields),
                "data": {
                    "requested_fields": fields,
                    **{field: values[field][1] for field in fields},
                },
            }
        result = self._RESULTS.get(name)
        if result is None:
            return {
                "ok": False,
                "error_kind": "eval_tool_refused",
                "error": "Eval-harnessen nægter alle ikke-fixturerede værktøjer.",
            }
        if name == "HassTurnOn":
            self.fixture_side_effects += 1
        return json.loads(json.dumps(result))


def read_pcm_fixture(path: pathlib.Path) -> tuple[bytes, int]:
    """Load a consented captured fixture; reject formats unlike PodVoice's mono PCM16."""
    with wave.open(str(path), "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2:
            raise ValueError("PCM eval fixture must be mono 16-bit WAV")
        rate = source.getframerate()
        if rate not in (16_000, 24_000):
            raise ValueError("PCM eval fixture must be 16 kHz device or 24 kHz provider audio")
        return source.readframes(source.getnframes()), rate


async def pace_pcm(
    pcm: bytes,
    rate: int,
    sink,
    *,
    frame_ms: int = 20,
    sleep=asyncio.sleep,
) -> None:
    """Stream captured speech at wall-clock pace instead of unrealistically dumping a file."""
    if rate not in (16_000, 24_000) or frame_ms <= 0:
        raise ValueError("unsupported PCM pacing configuration")
    frame_bytes = max(2, rate * 2 * frame_ms // 1000)
    for offset in range(0, len(pcm), frame_bytes):
        await sink(pcm[offset : offset + frame_bytes])
        await sleep(frame_ms / 1000)


async def run_scenario(
    driver: ConversationDriver,
    scenario: EvalScenario,
    *,
    run_id: str,
    budget: EvalBudget,
    turn_timeout_s: float = 20.0,
) -> ScenarioResult:
    session_id = ""
    results: list[TurnResult] = []
    try:
        session_id = await driver.open(run_id=run_id, scenario_id=scenario.id)
        for index, turn in enumerate(scenario.turns, start=1):
            budget.reserve()
            turn_id = f"{scenario.id}-{index}-{uuid.uuid4().hex[:8]}"
            try:
                async with asyncio.timeout(turn_timeout_s):
                    observed = await driver.submit_text(turn_id=turn_id, text=turn.text)
            except TimeoutError:
                observed = TurnObservation(
                    turn_id=turn_id,
                    session_id=session_id,
                    accepted=False,
                    error=f"turn timeout after {turn_timeout_s:g}s",
                    response_status="timeout",
                )
            if observed.session_id != session_id:
                observed.error = (
                    f"session changed from {session_id} to {observed.session_id} inside scenario"
                )
            budget.record(observed.usage)
            findings = grade_turn(turn.expect, observed)
            results.append(TurnResult(turn_id, turn.text, not findings, observed, findings))
            if not observed.remain_open:
                break
    finally:
        await driver.close()
    return ScenarioResult(
        scenario.id, all(result.passed for result in results), session_id, results
    )


class _ReadyRealtimeSession(OpenAIRealtimeSession):
    """Expose the real session.updated edge without polling or production edits."""

    def __post_init__(self) -> None:  # dataclass does not call this on the base today
        self.ready = asyncio.Event()

    async def _flush_preconnect_audio(self) -> None:
        self.ready.set()
        await super()._flush_preconnect_audio()


class LiveRealtimeDriver:
    """Real provider adapter; no Thin/HA dependencies and no side effects."""

    def __init__(
        self,
        api_key: str,
        *,
        model: str = DEFAULT_MODEL,
        voice: str = DEFAULT_VOICE,
        instructions: str = SYSTEM_PROMPT_DA,
        tool_declarations: list[dict[str, Any]] | None = None,
        room_context: str = "Evalrum. Alle værktøjsresultater er faste testdata.",
        interrupt_response: bool = True,
        include_sensitive_fixture: bool = False,
        budget_lease: BudgetLease | None = None,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.voice = voice
        self.instructions = instructions
        self.tools = SafeEvalTools(
            tool_declarations,
            include_sensitive_fixture=include_sensitive_fixture,
        )
        self.room_context = room_context
        self.interrupt_response = interrupt_response
        self.budget_lease = budget_lease
        self.session: _ReadyRealtimeSession | None = None
        self.events: asyncio.Queue[Any] = asyncio.Queue()
        self.reader: asyncio.Task[None] | None = None
        self.session_id = ""
        self.is_open = False

    async def open(self, *, run_id: str, scenario_id: str) -> str:
        self.session_id = f"{run_id}:{scenario_id}:{uuid.uuid4().hex[:8]}"
        self.session = _ReadyRealtimeSession(
            api_key=self.api_key,
            model=self.model,
            budget_role="eval",
            budget_lease=self.budget_lease,
            voice=self.voice,
            instructions=self.instructions,
            input_rate=24_000,
            preset="responsive",
            interrupt_response=self.interrupt_response,
            noise="off",
            room_context=self.room_context,
            tool_declarations=self.tools.declarations(),
        )
        # Base dataclass does not invoke a subclass post-init unless declared there.
        self.session.ready = asyncio.Event()
        # ThinSession places the same hard ceiling around production connects.  The
        # standalone evaluator must not inherit aiohttp's multi-minute default.
        async with asyncio.timeout(C.CONNECT_TIMEOUT_S):
            await self.session.connect()
            self.reader = asyncio.create_task(self._read_events(), name="podvoice-live-eval-reader")
            await self.session.ready.wait()
        self.is_open = True
        return self.session_id

    async def _read_events(self) -> None:
        assert self.session is not None
        try:
            async for event in self.session.events():
                await self.events.put(event)
        except Exception as exc:
            await self.events.put(exc)

    async def submit_text(self, *, turn_id: str, text: str) -> TurnObservation:
        if not self.is_open or self.session is None:
            raise RuntimeError("live eval session is not open")
        started = time.monotonic()
        self.tools.begin_turn(turn_id)
        try:
            await self.session.send_text(text)
            return await self._collect_turn(turn_id=turn_id, started=started)
        finally:
            self.tools.finish_turn()

    async def submit_audio(self, *, turn_id: str, pcm: bytes, rate: int) -> TurnObservation:
        """Replay exact provider PCM at real-time pace into a fresh Realtime session."""
        if not self.is_open or self.session is None:
            raise RuntimeError("live eval session is not open")
        if rate != 24_000 or not pcm:
            raise ValueError("audio replay requires non-empty 24 kHz provider PCM")
        started = time.monotonic()
        self.tools.begin_turn(turn_id)
        try:
            await pace_pcm(pcm, rate, self.session.send_audio)
            return await self._collect_turn(turn_id=turn_id, started=started)
        finally:
            self.tools.finish_turn()

    async def _dispatch_tool_batch(
        self,
        calls: list[ToolCall],
        observed: TurnObservation,
    ) -> None:
        """Execute one completed provider batch with the safe production ordering rules."""
        session = self.session
        if session is None:
            raise RuntimeError("live eval session is not open")
        calls = sorted(calls, key=lambda call: call.batch_index)
        observed.decision_batches.append([call.name for call in calls])
        for call in calls:
            observed.decisions.append(call.name)
            observed.tool_args.setdefault(call.name, []).append(call.args)

        # approve_action represents the whole confirmation turn. A sibling call makes
        # the boundary ambiguous, so no member of the batch may have a fixture effect.
        approval_mixed = len(calls) != 1 and any(call.name == "approve_action" for call in calls)
        responses: list[dict[str, Any]] = []
        if approval_mixed:
            for call in calls:
                result = {
                    "ok": False,
                    "error_kind": "approval_denied",
                    "error": "approve_action must be the only tool in its completed response",
                }
                observed.tool_results.setdefault(call.name, []).append(result)
                responses.append({"id": call.id, "name": call.name, "response": result})
        else:
            non_lifecycle: list[tuple[ToolCall, dict[str, Any]]] = []
            for call in calls:
                if call.name not in {"end_conversation", "wait_for_user"}:
                    result = await self.tools.dispatch(call.name, call.args)
                    non_lifecycle.append((call, result))
            needs_confirmation = any(
                result.get("error_kind") == "needs_confirmation" for _call, result in non_lifecycle
            )
            by_call_id = {call.id: result for call, result in non_lifecycle}
            for call in calls:
                suppress = False
                if call.name == "end_conversation":
                    if needs_confirmation:
                        result = {
                            "ok": False,
                            "error_kind": "close_blocked_pending_confirmation",
                            "error": "pending sensitive action keeps the eval session open",
                        }
                    else:
                        result = {"ok": True, "data": {"decision": call.name}}
                        observed.remain_open = False
                elif call.name == "wait_for_user":
                    result = {"ok": True, "data": {"decision": call.name}}
                    suppress = True
                else:
                    result = by_call_id[call.id]
                observed.tool_results.setdefault(call.name, []).append(result)
                responses.append(
                    {
                        "id": call.id,
                        "name": call.name,
                        "response": result,
                        "suppress_response": suppress,
                    }
                )
        await session.send_tool_results(responses)
        observed.fixture_side_effects = self.tools.fixture_side_effects

    async def _collect_turn(self, *, turn_id: str, started: float) -> TurnObservation:
        session = self.session
        if session is None:
            raise RuntimeError("live eval session is not open")
        observed = TurnObservation(turn_id=turn_id, session_id=self.session_id)
        output: list[str] = []
        usage = Usage()
        tool_round_seen = False
        pending_batches: dict[str, dict[int, ToolCall]] = {}
        while True:
            event = await self.events.get()
            if isinstance(event, Exception):
                observed.error = str(event)
                observed.response_status = "failed"
                break
            if isinstance(event, ToolCall):
                batch_id = str(event.batch_id or "")
                if (
                    not batch_id
                    or not event.response_id
                    or batch_id != event.response_id
                    or event.batch_size < 1
                    or event.batch_index < 0
                    or event.batch_index >= event.batch_size
                ):
                    observed.error = "invalid or uncorrelated completed tool batch"
                    observed.response_status = "failed"
                    break
                batch = pending_batches.setdefault(batch_id, {})
                if event.batch_index in batch or (
                    batch and next(iter(batch.values())).batch_size != event.batch_size
                ):
                    observed.error = "duplicate or inconsistent completed tool batch"
                    observed.response_status = "failed"
                    break
                batch[event.batch_index] = event
                # Anything spoken before the decision is a private preamble.
                output.clear()
            elif isinstance(event, ToolRoundComplete):
                response_id = str(event.response_id or "")
                committed_batch = pending_batches.get(response_id)
                if (
                    not response_id
                    or committed_batch is None
                    or not committed_batch
                    or len(committed_batch) != next(iter(committed_batch.values())).batch_size
                    or any(call.response_id != response_id for call in committed_batch.values())
                ):
                    observed.error = "missing, stale, or mismatched tool commit edge"
                    observed.response_status = "failed"
                    break
                await self._dispatch_tool_batch(list(committed_batch.values()), observed)
                pending_batches.pop(response_id, None)
                tool_round_seen = True
                output.clear()
            elif isinstance(event, OutputTranscript):
                # The provider emits deltas. Only the result response is authoritative.
                if tool_round_seen or not observed.decisions:
                    output.append(event.text)
            elif isinstance(event, InputTranscript):
                observed.diagnostic_transcript = event.text
            elif isinstance(event, AudioChunk) and observed.first_audio_ms is None:
                if tool_round_seen or not observed.decisions:
                    observed.first_audio_ms = round((time.monotonic() - started) * 1000)
            elif isinstance(event, Usage):
                usage = Usage(
                    **{key: getattr(usage, key) + getattr(event, key) for key in asdict(usage)}
                )
            elif isinstance(event, SilentToolComplete):
                if pending_batches:
                    observed.error = "tool batch completed without its exact commit edge"
                    observed.response_status = "failed"
                    break
                break
            elif isinstance(event, TurnComplete):
                if pending_batches:
                    observed.error = "tool response ended before its exact commit edge"
                    observed.response_status = "failed"
                    break
                observed.response_status = event.status
                observed.error = event.error
                break
        observed.answer = "".join(output).strip()
        observed.fixture_side_effects = self.tools.fixture_side_effects
        observed.elapsed_ms = round((time.monotonic() - started) * 1000)
        observed.usage = asdict(usage)
        return observed

    async def close(self) -> None:
        self.is_open = False
        if self.session is not None:
            with contextlib.suppress(Exception):
                await self.session.close()
        if self.reader is not None:
            self.reader.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.reader
        self.reader = None
        self.session = None
        while not self.events.empty():
            self.events.get_nowait()


class LiveEvalService:
    """Serialized, resumable live-eval job owned by the add-on process.

    ``run`` remains the synchronous CLI/test seam.  The panel uses ``start`` and
    ``status`` so an HA Ingress timeout, reload or retry cannot cancel the provider
    run or overwrite its result with a misleading busy error.
    """

    def __init__(
        self,
        *,
        sleep=asyncio.sleep,
        monotonic=time.monotonic,
        tpm_soft_limit: int = 25_000,
        next_scenario_reserve: int = 15_000,
        production_headroom: int = 15_000,
        max_run_s: float = 300.0,
        provider_budget: ProviderBudgetCoordinator = PROVIDER_BUDGET,
    ) -> None:
        self._lock = asyncio.Lock()
        self._sleep = sleep
        self._monotonic = monotonic
        # Tier-1 is 40k TPM. A measured fresh PodVoice session is roughly 14-15k,
        # so keep a full 15k headroom for one real household conversation.
        self._tpm_soft_limit = tpm_soft_limit
        self._next_scenario_reserve = next_scenario_reserve
        self._production_headroom = production_headroom
        self._provider_budget = provider_budget
        self._max_run_s = max_run_s
        self._job: asyncio.Task[None] | None = None
        self._active_run_id: str | None = None
        self._active_kind: str | None = None
        self._started_at: float | None = None
        self._last_report: dict[str, Any] | None = None

    @staticmethod
    def _new_run_id() -> str:
        return f"eval-{int(time.time())}-{uuid.uuid4().hex[:6]}"

    def start(
        self,
        *,
        api_key: str,
        scenario_ids: set[str] | None = None,
        model: str = DEFAULT_MODEL,
        voice: str = DEFAULT_VOICE,
        instructions: str = SYSTEM_PROMPT_DA,
        tool_declarations: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        if self._job is not None and not self._job.done():
            return {
                "ok": False,
                "status": "busy",
                "run_id": self._active_run_id,
                "started_at": self._started_at,
                "error": "En live-evaluering kører allerede.",
            }
        known = {scenario.id for scenario in load_scenarios()}
        unknown = (scenario_ids or set()).difference(known)
        if scenario_ids is not None and (not scenario_ids or unknown):
            return {
                "ok": False,
                "status": "invalid",
                "error": "Et eller flere eval-scenarier er ukendte.",
            }
        run_id = self._new_run_id()
        self._active_run_id = run_id
        self._active_kind = "preflight"
        self._started_at = time.time()
        self._job = asyncio.create_task(
            self._run_background(
                run_id=run_id,
                api_key=api_key,
                scenario_ids=scenario_ids,
                model=model,
                voice=voice,
                instructions=instructions,
                tool_declarations=tool_declarations,
            ),
            name=f"podvoice-live-eval-{run_id}",
        )
        return {
            "ok": True,
            "status": "running",
            "run_id": run_id,
            "started_at": self._started_at,
        }

    def start_replay(
        self,
        *,
        api_key: str,
        fixture: AudioReplayFixture,
        scenario: EvalScenario,
        turn_index: int,
        repeats: int = 3,
        model: str = DEFAULT_MODEL,
        voice: str = DEFAULT_VOICE,
        instructions: str = SYSTEM_PROMPT_DA,
        tool_declarations: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Start an exact provider-audio replay with no production tool dispatch."""
        if self._job is not None and not self._job.done():
            return {
                "ok": False,
                "status": "busy",
                "run_id": self._active_run_id,
                "started_at": self._started_at,
                "error": "En live-evaluering kører allerede.",
            }
        if (
            repeats < 1
            or repeats > 5
            or fixture.rate != 24_000
            or not fixture.pcm
            or len(fixture.pcm) > fixture.rate * 2 * 8
            or hashlib.sha256(fixture.pcm).hexdigest() != fixture.sha256
            or turn_index < 0
            or turn_index >= len(scenario.turns)
        ):
            return {"ok": False, "status": "invalid", "error": "Ugyldigt replay-bevis."}
        run_id = self._new_run_id()
        self._active_run_id = run_id
        self._active_kind = "audio-replay"
        self._started_at = time.time()
        self._job = asyncio.create_task(
            self._run_background(
                operation="replay",
                run_id=run_id,
                api_key=api_key,
                fixture=fixture,
                scenario=scenario,
                turn_index=turn_index,
                repeats=repeats,
                model=model,
                voice=voice,
                instructions=instructions,
                tool_declarations=tool_declarations,
            ),
            name=f"podvoice-audio-replay-{run_id}",
        )
        return {
            "ok": True,
            "status": "running",
            "kind": "audio-replay",
            "run_id": run_id,
            "started_at": self._started_at,
        }

    async def _run_background(self, **kwargs: Any) -> None:
        run_id = str(kwargs["run_id"])
        operation = str(kwargs.pop("operation", "scenarios"))
        try:
            if operation == "replay":
                self._last_report = await self.run_replay(**kwargs)
            else:
                self._last_report = await self.run(**kwargs)
        except asyncio.CancelledError:
            self._last_report = {
                "ok": False,
                "status": "cancelled",
                "run_id": run_id,
                "error": "Live-evalueringen blev afbrudt, da add-on stoppede.",
            }
            raise
        except Exception as exc:  # defensive job boundary; run normally reports failures
            message = str(exc)
            secret = str(kwargs.get("api_key") or "")
            if secret:
                message = message.replace(secret, "[REDACTED]")
            self._last_report = {
                "ok": False,
                "status": "failed",
                "run_id": run_id,
                "error": message[:500] or type(exc).__name__,
            }
        finally:
            if self._active_run_id == run_id:
                self._active_run_id = None
                self._active_kind = None
                self._started_at = None

    async def run_replay(
        self,
        *,
        api_key: str,
        fixture: AudioReplayFixture,
        scenario: EvalScenario,
        turn_index: int,
        repeats: int,
        model: str = DEFAULT_MODEL,
        voice: str = DEFAULT_VOICE,
        instructions: str = SYSTEM_PROMPT_DA,
        tool_declarations: list[dict[str, Any]] | None = None,
        run_id: str | None = None,
    ) -> dict[str, Any]:
        if self._lock.locked():
            return {
                "ok": False,
                "status": "busy",
                "run_id": self._active_run_id,
                "error": "En live-evaluering kører allerede.",
            }
        async with self._lock:
            run_id = run_id or self._new_run_id()
            expected_turn = scenario.turns[turn_index]
            budget = EvalBudget(max_actual_tokens=100_000, max_cost_usd=0.30)
            effective_prompt = (instructions or SYSTEM_PROMPT_DA).strip()
            prompt_is_default = effective_prompt == SYSTEM_PROMPT_DA.strip()
            effective_declarations = SafeEvalTools(tool_declarations).declarations()
            prompt_metadata = {
                "prompt_source": "default" if prompt_is_default else "custom",
                "prompt_version": PROMPT_VERSION if prompt_is_default else None,
                "prompt_sha256": hashlib.sha256(effective_prompt.encode()).hexdigest(),
                "tool_schema_sha256": _schema_sha256(effective_declarations),
                "production_tool_schema_sha256": _schema_sha256(effective_declarations),
                "reserved_tool_schema_sha256": _schema_sha256(RESERVED_DECLARATIONS),
                "tool_schema_profile": "production-replay",
            }
            schema_match = (
                None
                if fixture.source_tool_schema_sha256 is None
                else fixture.source_tool_schema_sha256 == prompt_metadata["tool_schema_sha256"]
            )
            if schema_match is False:
                return {
                    "ok": False,
                    "status": "complete",
                    "kind": "audio-replay",
                    "run_id": run_id,
                    "model": model,
                    **prompt_metadata,
                    "classification": "tool-schema-mismatch",
                    "control": None,
                    "trials": [],
                    "trace": {
                        "id": fixture.trace_id,
                        "turn_index": fixture.turn_index,
                        "sha256": fixture.sha256,
                        "source_tool_schema_sha256": fixture.source_tool_schema_sha256,
                        "schema_match": False,
                    },
                    "budget": asdict(budget),
                }
            token_window_started = self._monotonic()
            token_window_used = 0

            async def pace_new_session() -> None:
                nonlocal token_window_started, token_window_used
                elapsed = self._monotonic() - token_window_started
                if elapsed >= 60.0:
                    token_window_started = self._monotonic()
                    token_window_used = 0
                elif token_window_used + self._next_scenario_reserve > self._tpm_soft_limit:
                    wait_s = max(0.0, 60.5 - elapsed)
                    if wait_s:
                        await self._sleep(wait_s)
                        budget.rate_limit_wait_s += wait_s
                    token_window_started = self._monotonic()
                    token_window_used = 0

            async def one(index: int, *, audio: bool) -> TurnResult:
                nonlocal token_window_used
                await pace_new_session()
                provider_lease = self._provider_budget.reserve_eval(
                    api_key,
                    model,
                    tokens=self._next_scenario_reserve,
                    production_headroom=self._production_headroom,
                )
                before_tokens = budget.actual_tokens
                driver: LiveRealtimeDriver | None = None
                try:
                    budget.reserve()
                    driver = LiveRealtimeDriver(
                        api_key,
                        model=model,
                        voice=voice,
                        instructions=effective_prompt,
                        tool_declarations=tool_declarations,
                        room_context=fixture.room_context,
                        interrupt_response=False,
                        budget_lease=provider_lease,
                    )
                    await driver.open(run_id=run_id, scenario_id=scenario.id)
                    turn_id = f"{scenario.id}-{'audio' if audio else 'control'}-{index}"
                    async with asyncio.timeout(25.0):
                        observed = (
                            await driver.submit_audio(
                                turn_id=turn_id, pcm=fixture.pcm, rate=fixture.rate
                            )
                            if audio
                            else await driver.submit_text(turn_id=turn_id, text=expected_turn.text)
                        )
                finally:
                    if driver is not None:
                        await driver.close()
                    self._provider_budget.release(provider_lease)
                budget.record(observed.usage)
                token_window_used += budget.actual_tokens - before_tokens
                findings = grade_turn(expected_turn.expect, observed)
                return TurnResult(
                    observed.turn_id,
                    expected_turn.text,
                    not findings,
                    observed,
                    findings,
                )

            control: TurnResult | None = None
            trials: list[TurnResult] = []
            try:
                async with asyncio.timeout(self._max_run_s):
                    control = await one(0, audio=False)
                    for index in range(1, repeats + 1):
                        trials.append(await one(index, audio=True))
            except Exception as exc:
                message = str(exc).replace(api_key, "[REDACTED]")[:500]
                return {
                    "ok": False,
                    "status": "failed",
                    "kind": "audio-replay",
                    "run_id": run_id,
                    "model": model,
                    **prompt_metadata,
                    "error": message or type(exc).__name__,
                    "control": asdict(control) if control else None,
                    "trials": [asdict(result) for result in trials],
                    "budget": asdict(budget),
                }
            passed = sum(result.passed for result in trials)
            classification = (
                "prompt-or-tool-contract-failure"
                if control is not None and not control.passed
                else "audio-replay-consistent"
                if passed == repeats
                else "audio-specific-failure"
                if passed == 0
                else "audio-model-nondeterminism"
            )
            return {
                "ok": bool(control and control.passed and passed == repeats),
                "status": "complete",
                "kind": "audio-replay",
                "run_id": run_id,
                "model": model,
                **prompt_metadata,
                "trace": {
                    "id": fixture.trace_id,
                    "turn_index": fixture.turn_index,
                    "duration_ms": fixture.duration_ms,
                    "sha256": fixture.sha256,
                    "diagnostic_transcript": fixture.diagnostic_transcript,
                    "exact_sample_offsets": fixture.exact_sample_offsets,
                    "source_tool_schema_sha256": fixture.source_tool_schema_sha256,
                    "schema_match": schema_match,
                },
                "expected": {"scenario_id": scenario.id, "text": expected_turn.text},
                "classification": classification,
                "control": asdict(control) if control else None,
                "trials": [asdict(result) for result in trials],
                "budget": asdict(budget),
            }

    def status(self, run_id: str | None = None) -> dict[str, Any]:
        if self._job is not None and not self._job.done():
            if run_id is None or run_id == self._active_run_id:
                return {
                    "ok": True,
                    "status": "running",
                    "run_id": self._active_run_id,
                    "kind": self._active_kind,
                    "started_at": self._started_at,
                }
        if self._last_report is not None and (
            run_id is None or run_id == self._last_report.get("run_id")
        ):
            return dict(self._last_report)
        return {
            "ok": False,
            "status": "not_found" if run_id else "idle",
            "run_id": run_id,
            "error": "Evalueringen findes ikke." if run_id else None,
        }

    async def aclose(self) -> None:
        if self._job is None or self._job.done():
            return
        self._job.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._job

    async def run(
        self,
        *,
        api_key: str,
        scenario_ids: set[str] | None = None,
        model: str = DEFAULT_MODEL,
        voice: str = DEFAULT_VOICE,
        instructions: str = SYSTEM_PROMPT_DA,
        tool_declarations: list[dict[str, Any]] | None = None,
        run_id: str | None = None,
    ) -> dict[str, Any]:
        if self._lock.locked():
            return {
                "ok": False,
                "status": "busy",
                "run_id": self._active_run_id,
                "error": "En live-evaluering kører allerede.",
            }
        async with self._lock:
            run_id = run_id or self._new_run_id()
            budget = EvalBudget()
            selected = [
                scenario
                for scenario in load_scenarios()
                if scenario_ids is None or scenario.id in scenario_ids
            ]
            if not selected:
                return {
                    "ok": False,
                    "status": "invalid",
                    "error": "Ingen kendte eval-scenarier blev valgt.",
                }
            effective_prompt = (instructions or SYSTEM_PROMPT_DA).strip()
            prompt_is_default = effective_prompt == SYSTEM_PROMPT_DA.strip()
            production_declarations = SafeEvalTools(tool_declarations).declarations()
            eval_declarations = SafeEvalTools(
                tool_declarations,
                include_sensitive_fixture=True,
            ).declarations()
            prompt_metadata = {
                "prompt_source": "default" if prompt_is_default else "custom",
                "prompt_version": PROMPT_VERSION if prompt_is_default else None,
                "prompt_sha256": hashlib.sha256(effective_prompt.encode()).hexdigest(),
                "tool_schema_sha256": _schema_sha256(eval_declarations),
                "production_tool_schema_sha256": _schema_sha256(production_declarations),
                "reserved_tool_schema_sha256": _schema_sha256(RESERVED_DECLARATIONS),
                "tool_schema_profile": "production-plus-safe-sensitive-fixture",
            }
            results: list[ScenarioResult] = []
            token_window_started = self._monotonic()
            token_window_used = 0
            try:
                async with asyncio.timeout(self._max_run_s):
                    for scenario in selected:
                        elapsed = self._monotonic() - token_window_started
                        if elapsed >= 60.0:
                            token_window_started = self._monotonic()
                            token_window_used = 0
                        elif token_window_used + self._next_scenario_reserve > self._tpm_soft_limit:
                            wait_s = max(0.0, 60.5 - elapsed)
                            if wait_s:
                                await self._sleep(wait_s)
                                budget.rate_limit_wait_s += wait_s
                            token_window_started = self._monotonic()
                            token_window_used = 0
                        before_tokens = budget.actual_tokens
                        provider_lease = self._provider_budget.reserve_eval(
                            api_key,
                            model,
                            tokens=self._next_scenario_reserve,
                            production_headroom=self._production_headroom,
                        )
                        try:
                            driver = LiveRealtimeDriver(
                                api_key,
                                model=model,
                                voice=voice,
                                instructions=effective_prompt,
                                tool_declarations=tool_declarations,
                                include_sensitive_fixture=True,
                                budget_lease=provider_lease,
                            )
                            results.append(
                                await run_scenario(driver, scenario, run_id=run_id, budget=budget)
                            )
                        finally:
                            self._provider_budget.release(provider_lease)
                        token_window_used += budget.actual_tokens - before_tokens
            except Exception as exc:
                message = str(exc)
                if api_key:
                    message = message.replace(api_key, "[REDACTED]")
                message = message[:500]
                return {
                    "ok": False,
                    "status": "failed",
                    "run_id": run_id,
                    "model": model,
                    **prompt_metadata,
                    "error": message or type(exc).__name__,
                    "results": [asdict(result) for result in results],
                    "budget": asdict(budget),
                }
            return {
                "ok": all(result.passed for result in results),
                "status": "complete",
                "run_id": run_id,
                "model": model,
                **prompt_metadata,
                "results": [asdict(result) for result in results],
                "budget": asdict(budget),
            }


async def _main(args: argparse.Namespace) -> int:
    if not args.live:
        print(json.dumps({"scenarios": [asdict(s) for s in load_scenarios()]}, ensure_ascii=False))
        return 0
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        # In Home Assistant the secret normally lives in /data/options.json rather
        # than the process environment. load_config never logs or returns it in output.
        api_key = load_config().openai_api_key
    if not api_key:
        raise SystemExit("OpenAI-nøglen mangler; live-eval er kun opt-in")
    report = await LiveEvalService().run(
        api_key=api_key,
        scenario_ids=set(args.scenario) if args.scenario else None,
        model=args.model,
    )
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.artifact:
        await asyncio.to_thread(pathlib.Path(args.artifact).write_text, rendered, encoding="utf-8")
    print(rendered)
    return 0 if report["ok"] else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="PodVoice no-side-effect Realtime eval")
    parser.add_argument("--live", action="store_true", help="call the real Realtime provider")
    parser.add_argument("--scenario", action="append", help="scenario id (repeatable)")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--artifact", help="write a redacted JSON report")
    return asyncio.run(_main(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
