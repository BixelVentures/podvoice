from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import pathlib
import re
import wave

import pytest

import gatekeeper.eval_harness as eval_harness
from gatekeeper.eval_harness import (
    SAFE_EVAL_HIGH_RISK_TOOL,
    AudioReplayFixture,
    EvalBudget,
    LiveEvalService,
    SafeEvalTools,
    ScenarioResult,
    TurnExpectation,
    TurnObservation,
    grade_turn,
    load_scenarios,
    match_scenario_turn,
    pace_pcm,
    read_pcm_fixture,
    run_scenario,
)
from gatekeeper.openai_realtime import DEFAULT_MODEL, OpenAIRealtimeSession
from gatekeeper.provider_budget import ProviderBudgetCoordinator, ProviderBudgetUnavailable
from gatekeeper.thin import (
    APPROVE_ACTION_DECLARATION,
    END_CONVERSATION_DECLARATION,
    WAIT_FOR_USER_DECLARATION,
)


async def test_live_cli_is_retired_before_service_budget_or_provider(monkeypatch, capsys):
    class ForbiddenService:
        def __init__(self, *args, **kwargs):
            raise AssertionError("live CLI must not instantiate the eval service")

    monkeypatch.setattr(eval_harness, "LiveEvalService", ForbiddenService)

    result = await eval_harness._main(
        argparse.Namespace(
            live=True,
            scenario=["web-routing"],
            model=DEFAULT_MODEL,
            artifact="must-not-exist.json",
        )
    )

    report = json.loads(capsys.readouterr().out)
    assert result == 2
    assert report["status"] == "blocked"
    assert report["classification"] == "eval-admission-blocked"
    assert "add-on-panelets Test-fane" in report["error"]


def _known_provider_budget() -> ProviderBudgetCoordinator:
    ledger = ProviderBudgetCoordinator()
    for model in (DEFAULT_MODEL, "gpt-realtime-test"):
        ledger.update_rate_limits(
            "secret",
            model,
            [{"name": "tokens", "limit": 40_000, "remaining": 40_000, "reset_seconds": 60}],
        )
    return ledger


def _production_snapshot() -> list[dict]:
    return SafeEvalTools().declarations()


def test_core_scenarios_are_valid_and_cover_context_tools_and_close():
    scenarios = load_scenarios()
    assert {s.id for s in scenarios} == {
        "arithmetic-followup",
        "time-followup",
        "semantic-close",
        "web-routing",
        "sensitive-confirmation",
        "sensitive-action-with-close",
        "low-risk-action-then-close",
    }
    assert any(len(s.turns) > 1 for s in scenarios)
    decisions = {turn.expect.decision for scenario in scenarios for turn in scenario.turns}
    assert {"end_conversation", "get_time"} <= decisions
    assert any(turn.expect.direct_answer for scenario in scenarios for turn in scenario.turns)


def test_every_scenario_tool_name_has_one_explicit_canonical_fixture_contract():
    scenarios = load_scenarios()
    contracts = eval_harness.load_fixture_contracts()
    required = {name for scenario in scenarios for name in scenario.exact_tool_names}

    assert required == set(contracts)
    assert all(contract.risk for contract in contracts.values())
    assert all(contract.cases for contract in contracts.values())
    assert all(case.result for contract in contracts.values() for case in contract.cases)


def test_tool_admission_filters_injected_production_tools_without_substring_aliases():
    scenario = next(row for row in load_scenarios() if row.id == "web-routing")
    declarations = SafeEvalTools().declarations()
    declarations.extend(
        [
            {
                "name": "get_time_alias",
                "description": "must never satisfy exact get_time",
                "parameters": {"type": "object"},
            },
            {
                "name": "InjectedProductionMutation",
                "description": "must never enter safe eval",
                "parameters": {"type": "object"},
            },
        ]
    )

    admission = eval_harness._admit_eval_tools([scenario], declarations)

    assert {"get_time", "google_web_sogning", "InjectedProductionMutation"} <= {
        row["name"] for row in admission.declarations
    }
    assert set(admission.contracts) == {"get_time", "google_web_sogning"}


@pytest.mark.parametrize(
    "failure",
    [
        "missing_snapshot",
        "duplicate",
        "alias_only",
        "remote_ref",
        "bad_args",
        "reserved_collision",
        "eval_fixture_collision",
    ],
)
async def test_invalid_tool_admission_is_structured_and_precedes_budget_or_socket(
    monkeypatch, failure
):
    scenario = next(row for row in load_scenarios() if row.id == "web-routing")
    declarations: list[dict] | None = SafeEvalTools().declarations()
    if failure == "missing_snapshot":
        declarations = None
    assert declarations is None or isinstance(declarations, list)
    if declarations is None:
        get_time = web = {}
    else:
        get_time = next(row for row in declarations if row["name"] == "get_time")
        web = next(row for row in declarations if row["name"] == "google_web_sogning")
    if failure == "duplicate":
        assert declarations is not None
        declarations.append(json.loads(json.dumps(get_time)))
    elif failure == "alias_only":
        declarations = [
            {**json.loads(json.dumps(web)), "name": "google_web_sogning_alias"},
            get_time,
        ]
    elif failure == "remote_ref":
        web["parameters"] = {"$ref": "https://example.invalid/schema.json"}
    elif failure == "bad_args":
        web["parameters"] = {
            "type": "object",
            "properties": {"query": {"type": "integer"}},
            "required": ["query"],
            "additionalProperties": False,
        }
    elif failure == "reserved_collision":
        reserved = next(row for row in declarations or [] if row["name"] == "end_conversation")
        reserved["description"] = "mutated reserved schema"
    elif failure == "eval_fixture_collision":
        assert declarations is not None
        declarations.append(
            next(
                json.loads(json.dumps(row))
                for row in SafeEvalTools._safe_declarations()
                if row["name"] == SAFE_EVAL_HIGH_RISK_TOOL
            )
        )

    ledger = ProviderBudgetCoordinator()

    def forbidden_budget(*args, **kwargs):
        raise AssertionError("admission failure must precede every provider lease")

    class ForbiddenSocket:
        def __init__(self, **kwargs):
            raise AssertionError("admission failure must precede every provider socket")

    monkeypatch.setattr(ledger, "reserve_eval", forbidden_budget)
    monkeypatch.setattr(eval_harness, "_ReadyRealtimeSession", ForbiddenSocket)

    report = await LiveEvalService(provider_budget=ledger).run(
        api_key="secret",
        scenario_ids={scenario.id},
        tool_declarations=declarations,
    )

    assert report["ok"] is False
    assert report["status"] == "blocked"
    assert report["classification"] == "eval-admission-blocked"
    assert report["blocked"]["stage"] == "tool_admission"
    assert report["results"] == []
    assert ledger.snapshot("secret", DEFAULT_MODEL)["eval_trials"] == 0


async def test_oversized_custom_prompt_blocks_live_eval_before_diagnostic_or_socket(monkeypatch):
    ledger = ProviderBudgetCoordinator()

    class ForbiddenSocket:
        def __init__(self, **_kwargs):
            raise AssertionError("prompt admission must precede every provider socket")

    monkeypatch.setattr(eval_harness, "_ReadyRealtimeSession", ForbiddenSocket)
    prompt = "ø" * (eval_harness.MAX_LIVE_EVAL_PROMPT_BYTES // 2 + 1)
    report = await LiveEvalService(provider_budget=ledger).run(
        api_key="secret",
        scenario_ids={"web-routing"},
        instructions=prompt,
        tool_declarations=SafeEvalTools().declarations(),
    )
    assert report["status"] == "blocked"
    assert report["classification"] == "eval-admission-blocked"
    assert report["blocked"]["stage"] == "prompt_admission"
    assert ledger.diagnostic_is_active("secret") is False


def test_audio_replay_matches_only_an_exact_known_eval_utterance():
    matched = match_scenario_turn("Hvad er klokken?")
    assert matched is not None
    assert matched[0].id == "time-followup"
    assert matched[1] == 0
    assert match_scenario_turn("Hvad er klokken måske") is None


def test_web_oracle_accepts_spoken_words_or_digits_but_still_requires_winner():
    scenario = next(s for s in load_scenarios() if s.id == "web-routing")
    expected = scenario.turns[0].expect
    for answer in (
        "FCK vandt 2-0.",
        "FCK vandt kampen med to nul.",
        "Kampen endte 2-0 til FC København.",
    ):
        observed = TurnObservation(
            turn_id="turn",
            session_id="session",
            decisions=["google_web_sogning"],
            tool_args={"google_web_sogning": [{"query": "FCK seneste kamp"}]},
            tool_results={
                "google_web_sogning": [
                    {"ok": True, "summary": "FCK vandt to nul i den seneste kamp."}
                ]
            },
            answer=answer,
        )
        assert grade_turn(expected, observed) == []
    wrong_winner = TurnObservation(
        turn_id="turn",
        session_id="session",
        decisions=["google_web_sogning"],
        tool_args={"google_web_sogning": [{"query": "FCK seneste kamp"}]},
        tool_results={
            "google_web_sogning": [{"ok": True, "summary": "FCK vandt to nul i den seneste kamp."}]
        },
        answer="Silkeborg vandt 2-0 over FCK.",
    )
    assert {finding.code for finding in grade_turn(expected, wrong_winner)} == {
        "answer-pattern-mismatch"
    }


def test_web_oracle_rejects_wrong_fixture_args_even_when_answer_is_lucky():
    scenario = next(s for s in load_scenarios() if s.id == "web-routing")
    observed = TurnObservation(
        turn_id="turn",
        session_id="session",
        decisions=["google_web_sogning"],
        tool_args={"google_web_sogning": [{"query": "Silkeborg seneste kamp"}]},
        tool_results={
            "google_web_sogning": [
                {
                    "ok": False,
                    "error_kind": "eval_fixture_args_mismatch",
                    "summary": "Fixtureargumenterne matchede ikke.",
                }
            ]
        },
        answer="FCK vandt 2-0.",
    )

    assert {finding.code for finding in grade_turn(scenario.turns[0].expect, observed)} == {
        "wrong-tool-args",
        "wrong-tool-outcome",
    }


def test_scenario_loader_rejects_an_invalid_answer_pattern(tmp_path: pathlib.Path):
    path = tmp_path / "invalid.json"
    path.write_text(
        '{"schema_version":2,"fixture_contracts":[],"scenarios":['
        '{"id":"broken","exact_tool_names":[],"turns":['
        '{"text":"test","expect":{"answer_patterns":["("]}}]}]}',
        encoding="utf-8",
    )
    with pytest.raises(re.error):
        load_scenarios(path)


def test_oracle_requires_exact_decision_answer_and_lifecycle():
    expected = TurnExpectation(
        direct_answer=True, answer_any=("84", "fireogfirs"), remain_open=True
    )
    good = TurnObservation(
        turn_id="t",
        session_id="s",
        decisions=[],
        answer="Svaret er fireogfirs.",
    )
    assert grade_turn(expected, good) == []

    bad = TurnObservation(
        turn_id="t",
        session_id="s",
        decisions=["end_conversation"],
        answer="Farvel.",
        remain_open=False,
    )
    assert {f.code for f in grade_turn(expected, bad)} == {
        "wrong-decision",
        "answer-missing-any",
        "wrong-lifecycle",
    }


def test_oracle_requires_the_model_selected_temporal_field():
    expected = TurnExpectation(
        decision="get_time",
        tool_args={"get_time": {"fields": ["weekday"]}},
        answer_any=("mandag",),
    )
    good = TurnObservation(
        turn_id="t",
        session_id="s",
        decisions=["get_time"],
        tool_args={"get_time": [{"fields": ["weekday"]}]},
        answer="I dag er det mandag.",
    )
    assert grade_turn(expected, good) == []

    wrong_field = TurnObservation(
        turn_id="t",
        session_id="s",
        decisions=["get_time"],
        tool_args={"get_time": [{"fields": ["week_number"]}]},
        answer="Det er uge 34.",
    )
    assert {finding.code for finding in grade_turn(expected, wrong_field)} == {
        "wrong-tool-args",
        "answer-missing-any",
    }


async def test_safe_eval_router_never_dispatches_unknown_tools():
    tools = SafeEvalTools()
    assert {"end_conversation", "wait_for_user", "approve_action"} <= {
        declaration["name"] for declaration in tools.declarations()
    }
    assert "continue_conversation" not in {
        declaration["name"] for declaration in tools.declarations()
    }
    weekday = await tools.dispatch("get_time", {"fields": ["weekday"]})
    assert weekday == {
        "ok": True,
        "summary": "I dag er det mandag.",
        "data": {"requested_fields": ["weekday"], "weekday": "mandag"},
    }
    assert (await tools.dispatch("get_time", {}))["error_kind"] == "bad_args"
    refused = await tools.dispatch("unlock_front_door", {"entity": "lock.front"})
    assert refused == {
        "ok": False,
        "error_kind": "eval_tool_refused",
        "error": "Eval-harnessen nægter alle ikke-fixturerede værktøjer.",
    }
    assert tools.calls[-1][0] == "unlock_front_door"


def test_safe_eval_can_expose_exact_production_schema_without_dispatching_it():
    production = [
        {
            "name": "HassDangerousWrite",
            "description": "production-shaped but never dispatched",
            "parameters": {"type": "object", "properties": {}},
        },
        {"name": "end_conversation", "description": "must be replaced"},
        {"name": "wait_for_user", "description": "must be replaced"},
        {"name": "approve_action", "description": "must be replaced"},
    ]
    tools = SafeEvalTools(production)
    declarations = tools.declarations()
    assert declarations[0]["name"] == "HassDangerousWrite"
    assert [item["name"] for item in declarations].count("end_conversation") == 1
    assert declarations[-3:] == [
        END_CONVERSATION_DECLARATION,
        WAIT_FOR_USER_DECLARATION,
        APPROVE_ACTION_DECLARATION,
    ]
    production_canonical = [
        production[0],
        END_CONVERSATION_DECLARATION,
        WAIT_FOR_USER_DECLARATION,
        APPROVE_ACTION_DECLARATION,
    ]
    digest = lambda value: hashlib.sha256(  # noqa: E731 - compact contract assertion
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    assert digest(declarations) == digest(production_canonical)


def test_sensitive_fixture_exists_only_in_explicit_semantic_eval_profile():
    default_names = {item["name"] for item in SafeEvalTools().declarations()}
    semantic_names = {
        item["name"] for item in SafeEvalTools(include_sensitive_fixture=True).declarations()
    }
    assert SAFE_EVAL_HIGH_RISK_TOOL not in default_names
    assert SAFE_EVAL_HIGH_RISK_TOOL in semantic_names


async def test_safe_eval_sensitive_challenge_is_next_turn_one_shot_and_has_no_real_client():
    tools = SafeEvalTools(include_sensitive_fixture=True)
    assert not any(hasattr(tools, name) for name in ("ha", "mcp", "podconnect"))

    tools.begin_turn("proposal")
    proposal = await tools.dispatch(SAFE_EVAL_HIGH_RISK_TOOL, {"name": "hoveddøren"})
    tools.finish_turn()
    assert proposal["error_kind"] == "needs_confirmation"
    assert "challenge_id" not in proposal
    challenge_id = proposal["approval"]["challenge_id"]
    assert tools.fixture_side_effects == 0

    tools.begin_turn("approval")
    approved = await tools.dispatch("approve_action", {"challenge_id": challenge_id})
    replay = await tools.dispatch("approve_action", {"challenge_id": challenge_id})
    tools.finish_turn()
    assert approved["data"]["decision"] == "approved_action"
    assert replay["error_kind"] == "approval_denied"
    assert tools.fixture_side_effects == 1


async def test_safe_eval_dispatch_requires_exact_admitted_name_and_canonical_args():
    scenario = next(row for row in load_scenarios() if row.id == "low-risk-action-then-close")
    admission = eval_harness._admit_eval_tools([scenario], _production_snapshot())
    tools = SafeEvalTools(
        admission.declarations,
        admitted_names=set(admission.contracts),
        fixture_contracts=admission.contracts,
    )

    wrong_name = await tools.dispatch("HassTurnOnAlias", {"name": "stuen"})
    wrong_args = await tools.dispatch("HassTurnOn", {"name": "køkkenet"})
    exact = await tools.dispatch("HassTurnOn", {"name": "stuen"})

    assert wrong_name["error_kind"] == "eval_tool_refused"
    assert wrong_args["error_kind"] == "eval_fixture_args_mismatch"
    assert exact["ok"] is True
    assert tools.fixture_side_effects == 1


async def test_safe_eval_changed_and_expired_challenges_fail_closed():
    tools = SafeEvalTools(include_sensitive_fixture=True)
    tools.begin_turn("proposal")
    proposal = await tools.dispatch(SAFE_EVAL_HIGH_RISK_TOOL, {"name": "hoveddøren"})
    tools.finish_turn()
    challenge_id = proposal["approval"]["challenge_id"]

    tools.begin_turn("changed")
    changed = await tools.dispatch("approve_action", {"challenge_id": challenge_id + "-changed"})
    tools.finish_turn()
    assert changed["error_kind"] == "approval_denied"
    assert tools.fixture_side_effects == 0

    tools.begin_turn("late")
    expired = await tools.dispatch("approve_action", {"challenge_id": challenge_id})
    tools.finish_turn()
    assert expired["error_kind"] == "approval_denied"
    assert tools.fixture_side_effects == 0


async def test_safe_eval_allows_at_most_one_distinct_approval_in_one_turn():
    tools = SafeEvalTools(include_sensitive_fixture=True)
    tools.begin_turn("proposal")
    first = await tools.dispatch(SAFE_EVAL_HIGH_RISK_TOOL, {"name": "hoveddøren"})
    second = await tools.dispatch(SAFE_EVAL_HIGH_RISK_TOOL, {"name": "bagdøren"})
    tools.finish_turn()

    tools.begin_turn("approval")
    approved = await tools.dispatch(
        "approve_action", {"challenge_id": first["approval"]["challenge_id"]}
    )
    denied = await tools.dispatch(
        "approve_action", {"challenge_id": second["approval"]["challenge_id"]}
    )
    tools.finish_turn()
    assert approved["data"]["decision"] == "approved_action"
    assert denied["error_kind"] == "approval_denied"
    assert tools.fixture_side_effects == 1


def test_semantic_security_scenarios_assert_decisions_outcomes_and_lifecycle_not_prose():
    scenarios = {scenario.id: scenario for scenario in load_scenarios()}
    proposal, approval = scenarios["sensitive-confirmation"].turns
    assert proposal.expect.tool_outcomes == {SAFE_EVAL_HIGH_RISK_TOOL: ("needs_confirmation",)}
    assert proposal.expect.fixture_side_effects == 0
    assert proposal.expect.answer_any == () and proposal.expect.answer_patterns == ()
    assert approval.expect.decision == "approve_action"
    assert approval.expect.tool_outcomes == {"approve_action": ("approved_action",)}
    assert approval.expect.remain_open is True

    sensitive_close = scenarios["sensitive-action-with-close"].turns[0].expect
    assert "end_conversation" in sensitive_close.forbid
    assert sensitive_close.remain_open is True

    safe_close = scenarios["low-risk-action-then-close"].turns[0].expect
    assert safe_close.decisions == ("HassTurnOn", "end_conversation")
    assert safe_close.decision_batches == (("HassTurnOn",), ("end_conversation",))
    assert safe_close.remain_open is False


async def test_safe_live_batch_blocks_close_when_sensitive_action_needs_confirmation():
    sent: list[list[dict]] = []

    class FakeSession:
        async def send_tool_results(self, results):
            sent.append(results)

    driver = eval_harness.LiveRealtimeDriver("secret", include_sensitive_fixture=True)
    driver.session = FakeSession()  # type: ignore[assignment]
    driver.tools.begin_turn("proposal")
    observed = TurnObservation(turn_id="proposal", session_id="session")
    await driver._dispatch_tool_batch(
        [
            eval_harness.ToolCall(
                "risk",
                SAFE_EVAL_HIGH_RISK_TOOL,
                {"name": "hoveddøren"},
                batch_id="batch",
                batch_index=0,
                batch_size=2,
            ),
            eval_harness.ToolCall(
                "close",
                "end_conversation",
                {},
                batch_id="batch",
                batch_index=1,
                batch_size=2,
            ),
        ],
        observed,
    )
    driver.tools.finish_turn()
    assert observed.remain_open is True
    assert observed.fixture_side_effects == 0
    assert observed.tool_results[SAFE_EVAL_HIGH_RISK_TOOL][0]["error_kind"] == (
        "needs_confirmation"
    )
    assert observed.tool_results["end_conversation"][0]["error_kind"] == (
        "close_blocked_pending_confirmation"
    )
    assert len(sent) == 1 and len(sent[0]) == 2


async def test_safe_live_driver_consumes_nested_production_challenge_on_next_turn_once():
    sent: list[list[dict]] = []

    class FakeSession:
        async def send_tool_results(self, results):
            sent.append(results)

    driver = eval_harness.LiveRealtimeDriver("secret", include_sensitive_fixture=True)
    driver.session = FakeSession()  # type: ignore[assignment]

    driver.tools.begin_turn("proposal")
    proposal_observed = TurnObservation(turn_id="proposal", session_id="session")
    await driver._dispatch_tool_batch(
        [
            eval_harness.ToolCall(
                "risk",
                SAFE_EVAL_HIGH_RISK_TOOL,
                {"name": "hoveddøren"},
                batch_id="proposal-batch",
            )
        ],
        proposal_observed,
    )
    driver.tools.finish_turn()
    proposal_result = sent[0][0]["response"]
    challenge_id = proposal_result["approval"]["challenge_id"]
    assert "challenge_id" not in proposal_result
    assert proposal_observed.fixture_side_effects == 0

    driver.tools.begin_turn("confirmation")
    approval_observed = TurnObservation(turn_id="confirmation", session_id="session")
    await driver._dispatch_tool_batch(
        [
            eval_harness.ToolCall(
                "approve",
                "approve_action",
                {"challenge_id": challenge_id},
                batch_id="approval-batch",
            )
        ],
        approval_observed,
    )
    await driver._dispatch_tool_batch(
        [
            eval_harness.ToolCall(
                "replay",
                "approve_action",
                {"challenge_id": challenge_id},
                batch_id="replay-batch",
            )
        ],
        approval_observed,
    )
    driver.tools.finish_turn()
    assert approval_observed.tool_results["approve_action"][0]["data"]["decision"] == (
        "approved_action"
    )
    assert approval_observed.tool_results["approve_action"][1]["error_kind"] == ("approval_denied")
    assert approval_observed.fixture_side_effects == 1


@pytest.mark.parametrize("marker_id", [None, "wrong-response"])
async def test_live_collect_requires_exact_nonempty_tool_commit_edge_before_fixture_effect(
    marker_id,
):
    sent: list[list[dict]] = []

    class FakeSession:
        async def send_tool_results(self, results):
            sent.append(results)

    driver = eval_harness.LiveRealtimeDriver("secret")
    driver.session = FakeSession()  # type: ignore[assignment]
    driver.events.put_nowait(
        eval_harness.ToolCall(
            "low",
            "HassTurnOn",
            {"name": "stuen"},
            response_id="response-one",
            batch_id="response-one",
        )
    )
    if marker_id is not None:
        driver.events.put_nowait(eval_harness.ToolRoundComplete(response_id=marker_id))
    else:
        driver.events.put_nowait(
            eval_harness.TurnComplete(status="completed", response_id="response-one")
        )
    observed = await driver._collect_turn(turn_id="turn", started=0.0)
    assert observed.response_status == "failed"
    assert observed.fixture_side_effects == 0
    assert sent == []


async def test_live_collect_dispatches_fixture_only_after_matching_tool_commit_edge():
    sent: list[list[dict]] = []

    class FakeSession:
        async def send_tool_results(self, results):
            sent.append(results)

    driver = eval_harness.LiveRealtimeDriver("secret")
    driver.session = FakeSession()  # type: ignore[assignment]
    driver.events.put_nowait(
        eval_harness.ToolCall(
            "low",
            "HassTurnOn",
            {"name": "stuen"},
            response_id="response-one",
            batch_id="response-one",
        )
    )
    driver.events.put_nowait(eval_harness.ToolRoundComplete(response_id="response-one"))
    driver.events.put_nowait(
        eval_harness.TurnComplete(status="completed", response_id="answer-one")
    )
    observed = await driver._collect_turn(turn_id="turn", started=0.0)
    assert observed.response_status == "completed"
    assert observed.fixture_side_effects == 1
    assert observed.decision_batches == [["HassTurnOn"]]
    assert len(sent) == 1


async def test_live_collect_persists_per_response_top_totals_and_residual():
    driver = eval_harness.LiveRealtimeDriver("secret")
    driver.session = object()  # type: ignore[assignment]
    driver.events.put_nowait(
        eval_harness.Usage(
            response_id="resp-observed",
            input_text_tokens=700,
            output_text_tokens=100,
            provider_input_tokens=900,
            provider_output_tokens=120,
            provider_total_tokens=1_020,
            unattributed_input_tokens=200,
            unattributed_output_tokens=20,
        )
    )
    driver.events.put_nowait(
        eval_harness.TurnComplete(status="completed", response_id="resp-observed")
    )
    observed = await driver._collect_turn(turn_id="turn", started=0.0)
    assert observed.usage["provider_total_tokens"] == 1_020
    assert observed.response_usage == [
        {
            "response_id": "resp-observed",
            "input_text_tokens": 700,
            "input_audio_tokens": 0,
            "input_image_tokens": 0,
            "cached_text_tokens": 0,
            "cached_audio_tokens": 0,
            "output_text_tokens": 100,
            "output_audio_tokens": 0,
            "provider_input_tokens": 900,
            "provider_output_tokens": 120,
            "provider_total_tokens": 1_020,
            "unattributed_input_tokens": 200,
            "unattributed_output_tokens": 20,
        }
    ]


async def test_live_collect_stops_third_tool_round_before_fixture_effect_or_fourth_response():
    sent: list[list[dict]] = []

    class FakeSession:
        async def send_tool_results(self, results):
            sent.append(results)

    driver = eval_harness.LiveRealtimeDriver("secret")
    driver.session = FakeSession()  # type: ignore[assignment]
    for index in range(1, 4):
        response_id = f"response-{index}"
        driver.events.put_nowait(
            eval_harness.ToolCall(
                f"call-{index}",
                "HassTurnOn",
                {"name": "stuen"},
                response_id=response_id,
                batch_id=response_id,
            )
        )
        driver.events.put_nowait(eval_harness.ToolRoundComplete(response_id=response_id))
    observed = await driver._collect_turn(turn_id="turn", started=0.0)
    assert observed.response_status == "failed"
    assert observed.error == "eval provider response-edge budget exhausted"
    assert observed.fixture_side_effects == 2
    assert len(sent) == 2


async def test_live_collect_pure_wait_requires_marker_then_completes_silently():
    sent: list[list[dict]] = []

    class FakeSession:
        async def send_tool_results(self, results):
            sent.append(results)

    driver = eval_harness.LiveRealtimeDriver("secret")
    driver.session = FakeSession()  # type: ignore[assignment]
    driver.events.put_nowait(
        eval_harness.ToolCall(
            "wait",
            "wait_for_user",
            {},
            response_id="wait-response",
            batch_id="wait-response",
        )
    )
    driver.events.put_nowait(eval_harness.ToolRoundComplete(response_id="wait-response"))
    driver.events.put_nowait(eval_harness.SilentToolComplete(call_ids=("wait",)))
    observed = await driver._collect_turn(turn_id="turn", started=0.0)
    assert observed.response_status == "completed"
    assert observed.remain_open is True
    assert observed.decisions == ["wait_for_user"]
    assert observed.fixture_side_effects == 0
    assert sent[0][0]["suppress_response"] is True


def test_budget_hard_stops_before_an_unbounded_live_run():
    budget = EvalBudget(max_turns=1, max_reserved_tokens=3072, max_actual_tokens=10)
    budget.reserve()
    budget.record({"input_text_tokens": 4, "output_audio_tokens": 4})
    with pytest.raises(RuntimeError, match="turn budget"):
        budget.reserve()
    with pytest.raises(RuntimeError, match="actual-token"):
        budget.record({"input_text_tokens": 3})


def test_budget_reserves_worst_case_response_cost_before_provider_edge():
    budget = EvalBudget(
        max_turns=10,
        max_reserved_tokens=20 * eval_harness.MAX_OUTPUT_TOKENS,
        max_actual_tokens=100_000,
        max_cost_usd=5.0,
    )
    budget.cost_usd = 3.2
    with pytest.raises(RuntimeError, match="budget_exhausted"):
        budget.reserve(responses=2)
    assert budget.turns == 0
    assert budget.reserved_tokens == 0


async def test_budget_exhaustion_refuses_first_turn_before_provider_open():
    class NeverOpened:
        opened = 0

        async def open(self, **_kwargs):
            self.opened += 1
            raise AssertionError("provider socket must not open")

        async def submit_text(self, **_kwargs):
            raise AssertionError("provider response must not start")

        async def close(self):
            return None

    driver = NeverOpened()
    budget = EvalBudget(
        max_turns=1,
        max_reserved_tokens=3 * eval_harness.MAX_OUTPUT_TOKENS,
        max_actual_tokens=100_000,
        max_cost_usd=5.0,
    )
    budget.cost_usd = 2.01
    with pytest.raises(RuntimeError, match="budget_exhausted"):
        await run_scenario(
            driver,
            load_scenarios()[0],
            run_id="budget-stop",
            budget=budget,
        )
    assert driver.opened == 0


async def test_captured_pcm_hook_validates_and_paces_device_audio(tmp_path: pathlib.Path):
    target = tmp_path / "danish-device.wav"
    with wave.open(str(target), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16_000)
        wav.writeframes(b"\x01\x00" * 640)  # 40 ms
    pcm, rate = read_pcm_fixture(target)
    chunks: list[bytes] = []
    sleeps: list[float] = []

    async def sink(chunk: bytes) -> None:
        chunks.append(chunk)

    async def no_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    await pace_pcm(pcm, rate, sink, sleep=no_sleep)
    assert list(map(len, chunks)) == [640, 640]
    assert sleeps == [0.02, 0.02]


async def test_runner_uses_one_session_and_event_driven_driver_results():
    scenario = load_scenarios()[0]

    class ScriptedDriver:
        def __init__(self) -> None:
            self.session_id = "session-one"
            self.calls = 0
            self.closed = False

        async def open(self, *, run_id: str, scenario_id: str) -> str:
            assert run_id == "run" and scenario_id == "arithmetic-followup"
            return self.session_id

        async def submit_text(self, *, turn_id: str, text: str) -> TurnObservation:
            self.calls += 1
            await asyncio.sleep(0)
            return TurnObservation(
                turn_id=turn_id,
                session_id=self.session_id,
                decisions=[],
                answer="Fireogfirs." if self.calls == 1 else "Halvfems.",
            )

        async def close(self) -> None:
            self.closed = True

    driver = ScriptedDriver()
    result = await run_scenario(driver, scenario, run_id="run", budget=EvalBudget())
    assert result.passed is True
    assert driver.calls == 2 and driver.closed is True
    assert all(turn.observation.session_id == "session-one" for turn in result.turns)


async def test_runner_timeout_is_a_failure_not_a_retry():
    scenario = load_scenarios()[3]

    class HungDriver:
        async def open(self, *, run_id: str, scenario_id: str) -> str:
            return "hung"

        async def submit_text(self, *, turn_id: str, text: str) -> TurnObservation:
            await asyncio.Event().wait()
            raise AssertionError("unreachable")

        async def close(self) -> None:
            return None

    with pytest.raises(RuntimeError, match=r"provider_or_transport_failure.*timeout"):
        await run_scenario(
            HungDriver(), scenario, run_id="run", budget=EvalBudget(), turn_timeout_s=0.01
        )


async def test_runner_aborts_semantic_429_before_followup_without_text_false_positive():
    scenario = load_scenarios()[0]

    class CapacityDriver:
        def __init__(self):
            self.calls = 0
            self.closed = False

        async def open(self, *, run_id: str, scenario_id: str) -> str:
            return "capacity-session"

        async def submit_text(self, *, turn_id: str, text: str) -> TurnObservation:
            self.calls += 1
            return TurnObservation(
                turn_id=turn_id,
                session_id="capacity-session",
                accepted=False,
                response_status="failed",
                error=(
                    "OpenAI rejected response.create: rate_limit_exceeded · tokens · "
                    "TPM capacity exhausted"
                ),
            )

        async def close(self) -> None:
            self.closed = True

    driver = CapacityDriver()
    with pytest.raises(RuntimeError, match="diagnostic_capacity"):
        await run_scenario(driver, scenario, run_id="run", budget=EvalBudget())
    assert driver.calls == 1
    assert driver.closed is True
    assert (
        eval_harness._is_provider_capacity_rejection("Modellen sagde: rate limit er et teknisk ord")
        is False
    )


async def test_runner_capacity_failure_carries_completed_partial_turn_evidence():
    scenario = load_scenarios()[0]

    class PartialDriver:
        async def open(self, *, run_id: str, scenario_id: str) -> str:
            return "partial-session"

        async def submit_text(self, *, turn_id: str, text: str) -> TurnObservation:
            return TurnObservation(
                turn_id=turn_id,
                session_id="partial-session",
                accepted=False,
                response_status="failed",
                error="rate_limit_exceeded · 429",
                fixture_side_effects=2,
                response_usage=[
                    {"response_id": f"r-{index}", "provider_total_tokens": tokens}
                    for index, tokens in enumerate((5_623, 5_613, 5_676, 5_709, 5_774), 1)
                ],
                provider_trace=[
                    {
                        "kind": "response_done",
                        "status": "completed",
                        "usage": {"total_tokens": tokens},
                    }
                    for tokens in (5_623, 5_613, 5_676, 5_709, 5_774)
                ],
            )

        async def close(self) -> None:
            return None

    with pytest.raises(eval_harness.ScenarioExecutionError) as raised:
        await run_scenario(PartialDriver(), scenario, run_id="run", budget=EvalBudget())
    partial = raised.value.result
    assert len(partial.turns) == 1
    assert [
        row["provider_total_tokens"] for row in partial.turns[0].observation.response_usage
    ] == [5_623, 5_613, 5_676, 5_709, 5_774]
    assert partial.turns[0].observation.fixture_side_effects == 2


async def test_timeout_preserves_active_bounded_trace_and_usage():
    driver = eval_harness.LiveRealtimeDriver("secret")
    driver.session_id = "timeout-session"
    driver.session = object()  # type: ignore[assignment]
    driver._record_provider_trace({"kind": "response_created", "response_id": "r1"})
    driver.events.put_nowait(
        eval_harness.Usage(
            response_id="r1",
            provider_input_tokens=900,
            provider_output_tokens=100,
            provider_total_tokens=1_000,
            input_text_tokens=900,
            output_text_tokens=100,
        )
    )
    with pytest.raises(TimeoutError):
        await driver._collect_turn(turn_id="turn", started=0.0, semantic_timeout_s=0.001)
    partial = driver.take_partial_observation(
        turn_id="turn", status="timeout", error="turn timeout after 0.001s"
    )
    assert partial.usage["provider_total_tokens"] == 1_000
    assert partial.response_usage[0]["response_id"] == "r1"
    assert partial.provider_trace[0]["kind"] == "response_created"


@pytest.mark.parametrize("failure_stage", ["capacity_before_wire", "transport_after_pre_wire"])
async def test_generic_pre_response_failures_preserve_partial_trace(failure_stage):
    scenario = load_scenarios()[0]

    class FailingDriver:
        def __init__(self) -> None:
            self.session_id = "failure-session"
            self.trace: list[dict] = []

        async def open(self, *, run_id: str, scenario_id: str) -> str:
            return self.session_id

        async def prepare_response_capacity(self) -> None:
            self.trace.append({"kind": "capacity_check", "admitted": False})
            if failure_stage == "capacity_before_wire":
                raise ProviderBudgetUnavailable("rate_limit_capacity · no capacity")

        async def submit_text_bounded(self, **_kwargs):
            self.trace.append({"kind": "response_create_pre_wire", "request_id": "opaque"})
            raise ConnectionError("socket closed during response send")

        def take_partial_observation(
            self, *, turn_id: str, status: str, error: str
        ) -> TurnObservation:
            return TurnObservation(
                turn_id=turn_id,
                session_id=self.session_id,
                accepted=False,
                response_status=status,
                error=error,
                provider_trace=list(self.trace),
            )

        async def close(self) -> None:
            return None

    with pytest.raises(eval_harness.ScenarioExecutionError) as raised:
        await run_scenario(FailingDriver(), scenario, run_id="run", budget=EvalBudget())
    trace = raised.value.result.turns[0].observation.provider_trace
    assert trace[0]["kind"] == "capacity_check"
    if failure_stage == "capacity_before_wire":
        assert all(row["kind"] != "response_create_pre_wire" for row in trace)
        assert "diagnostic_capacity" in str(raised.value)
    else:
        assert trace[-1]["kind"] == "response_create_pre_wire"
        assert "provider_or_transport_failure" in str(raised.value)


def test_provider_trace_is_bounded_sanitized_and_marks_truncation():
    driver = eval_harness.LiveRealtimeDriver("secret", capacity_monotonic=lambda: 1.0)
    for index in range(200):
        driver._record_provider_trace(
            {
                "kind": "synthetic",
                "index": index,
                "nonfinite": float("nan"),
                "long": "x" * 500,
            }
        )
    observed = driver.take_partial_observation(turn_id="turn", status="failed", error="synthetic")
    assert len(observed.provider_trace) == 128
    assert observed.provider_trace[-1] == {"kind": "trace_truncated", "dropped": 73}
    assert observed.provider_trace[0]["nonfinite"] == "nonfinite"
    assert len(observed.provider_trace[0]["long"]) == 96


async def test_live_service_semantic_429_stops_all_later_scenarios(monkeypatch):
    calls: list[str] = []

    async def scripted_run(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        calls.append(scenario.id)
        if len(calls) == 2:
            raise RuntimeError(
                "diagnostic_capacity · OpenAI rejected response.create: "
                "rate_limit_exceeded · tokens"
            )
        return ScenarioResult(scenario.id, True, "completed-before-capacity", [])

    monkeypatch.setattr(eval_harness, "run_scenario", scripted_run)
    report = await LiveEvalService(provider_budget=ProviderBudgetCoordinator()).run(
        api_key="secret",
        scenario_ids={"arithmetic-followup", "time-followup", "web-routing"},
        tool_declarations=_production_snapshot(),
    )

    assert report["ok"] is False
    assert report["classification"] == "diagnostic-capacity"
    assert len(calls) == 2
    assert len(report["results"]) == 1


async def test_live_service_persists_partial_scenario_and_trace_budget_mismatch(monkeypatch):
    async def partial_failure(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        observation = TurnObservation(
            turn_id="time-2",
            session_id="partial-time",
            accepted=False,
            response_status="failed",
            error="rate_limit_exceeded · 429",
            fixture_side_effects=2,
            tool_results={
                "get_time": [
                    {"ok": True, "data": {"iso": "2026-08-23T12:00:00+02:00"}},
                    {"ok": True, "data": {"iso": "2026-08-23T12:00:01+02:00"}},
                ]
            },
            provider_trace=[
                {
                    "kind": "response_done",
                    "status": "completed",
                    "usage": {"total_tokens": tokens},
                }
                for tokens in (5_623, 5_613, 5_676, 5_709, 5_774)
            ],
        )
        result = ScenarioResult(
            scenario.id,
            False,
            "partial-time",
            [
                eval_harness.TurnResult(
                    "time-2",
                    "Og hvilken ugedag er det?",
                    False,
                    observation,
                    [eval_harness.Finding("provider-terminal", "429")],
                )
            ],
        )
        raise eval_harness.ScenarioExecutionError("diagnostic_capacity · 429", result)

    monkeypatch.setattr(eval_harness, "run_scenario", partial_failure)
    report = await LiveEvalService(provider_budget=ProviderBudgetCoordinator()).run(
        api_key="secret",
        scenario_ids={"time-followup"},
        tool_declarations=_production_snapshot(),
    )
    assert report["classification"] == "diagnostic-capacity"
    assert len(report["results"]) == 1
    assert len(report["results"][0]["turns"][0]["observation"]["provider_trace"]) == 5
    assert report["results"][0]["turns"][0]["observation"]["fixture_side_effects"] == 2
    assert report["provider_provenance"] == {
        "trace_event_count": 5,
        "trace_completed_tokens": 28_395,
        "budget_actual_tokens": 0,
        "trace_minus_budget_tokens": 28_395,
        "trace_truncated_events": 0,
    }


async def test_runner_timeout_never_submits_a_followup_into_the_hung_response():
    scenario = load_scenarios()[0]  # two-turn contextual arithmetic scenario

    class FirstTurnHangs:
        def __init__(self):
            self.calls = 0
            self.closed = False

        async def open(self, *, run_id: str, scenario_id: str) -> str:
            return "hung-multiturn"

        async def submit_text(self, *, turn_id: str, text: str) -> TurnObservation:
            self.calls += 1
            await asyncio.Event().wait()
            raise AssertionError("unreachable")

        async def close(self) -> None:
            self.closed = True

    driver = FirstTurnHangs()
    with pytest.raises(RuntimeError, match=r"provider_or_transport_failure.*timeout"):
        await run_scenario(driver, scenario, run_id="run", budget=EvalBudget(), turn_timeout_s=0.01)
    assert driver.calls == 1
    assert driver.closed is True


async def test_live_service_transport_failure_stops_all_later_scenarios(monkeypatch):
    calls: list[str] = []

    async def scripted_run(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        calls.append(scenario.id)
        if len(calls) == 2:
            raise RuntimeError(
                "provider_or_transport_failure · status=timeout · turn timeout after 20s"
            )
        return ScenarioResult(scenario.id, True, "completed-before-timeout", [])

    monkeypatch.setattr(eval_harness, "run_scenario", scripted_run)
    report = await LiveEvalService(provider_budget=ProviderBudgetCoordinator()).run(
        api_key="secret",
        scenario_ids={"arithmetic-followup", "time-followup", "web-routing"},
        tool_declarations=_production_snapshot(),
    )

    assert report["ok"] is False
    assert report["classification"] == "provider-or-eval-failure"
    assert len(calls) == 2
    assert len(report["results"]) == 1


async def test_runner_closes_driver_when_open_fails():
    class BrokenDriver:
        def __init__(self) -> None:
            self.closed = False

        async def open(self, *, run_id: str, scenario_id: str) -> str:
            raise ConnectionError("connect failed")

        async def submit_text(self, *, turn_id: str, text: str) -> TurnObservation:
            raise AssertionError("unreachable")

        async def close(self) -> None:
            self.closed = True

    driver = BrokenDriver()
    with pytest.raises(ConnectionError, match="connect failed"):
        await run_scenario(driver, load_scenarios()[0], run_id="run", budget=EvalBudget())
    assert driver.closed is True


async def test_live_driver_connect_timeout_still_closes_partial_session(monkeypatch):
    closed = asyncio.Event()

    async def hung_connect(self) -> None:
        await asyncio.Event().wait()

    async def observed_close(self) -> None:
        closed.set()

    monkeypatch.setattr(eval_harness.C, "CONNECT_TIMEOUT_S", 0.01)
    monkeypatch.setattr(eval_harness._ReadyRealtimeSession, "connect", hung_connect)
    monkeypatch.setattr(eval_harness._ReadyRealtimeSession, "close", observed_close)
    driver = eval_harness.LiveRealtimeDriver("secret")
    with pytest.raises(TimeoutError):
        await run_scenario(driver, load_scenarios()[0], run_id="run", budget=EvalBudget())
    assert closed.is_set()


async def test_live_driver_three_turn_allowance_paces_outside_semantic_timeout():
    clock = [0.0]
    waits: list[float] = []

    async def fake_sleep(delay: float) -> None:
        waits.append(delay)
        clock[0] += delay

    ledger = ProviderBudgetCoordinator(monotonic=lambda: clock[0])
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 40_000, "reset_seconds": 60}],
    )
    diagnostic = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret", "model", tokens=15_000, production_headroom=0, diagnostic_lease=diagnostic
    )
    driver = eval_harness.LiveRealtimeDriver(
        "secret",
        model="model",
        budget_lease=lease,
        provider_budget=ledger,
        capacity_sleep=fake_sleep,
        capacity_monotonic=lambda: clock[0],
        capacity_deadline=1_000.0,
    )

    # Turn one is already admitted. Two subsequent near-cap turns each wait for
    # the exact authoritative window reset while retaining the same eval ownership.
    for _turn in range(2):
        ledger.update_rate_limits(
            "secret",
            "model",
            [{"name": "tokens", "limit": 40_000, "remaining": 14_000, "reset_seconds": 60}],
        )
        ledger.account_usage(
            "secret", "model", 14_000, lease=lease, provider_reservation_observed=True
        )
        await driver.prepare_response_capacity()

    expected = 1_000 / (40_000 / 60) + 0.05
    assert waits == [pytest.approx(expected), pytest.approx(expected)]
    assert ledger.snapshot("secret", "model")["eval_trials"] == 1
    assert ledger.release(lease) is True
    assert ledger.release(diagnostic) is True


async def test_field_429_chain_paces_exact_tool_edge_then_sends_one_create():
    """eval-1787479390-7aa3ed: used34805 + requested5769 at a 40k/min bucket."""
    clock = [0.0]
    waits: list[float] = []

    async def advance(delay: float) -> None:
        waits.append(delay)
        clock[0] += delay

    class Wire:
        closed = False

        def __init__(self) -> None:
            self.sent: list[dict] = []

        async def send_json(self, payload: dict) -> None:
            self.sent.append(payload)

    ledger = ProviderBudgetCoordinator(monotonic=lambda: clock[0])
    diagnostic = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret",
        "model",
        tokens=15_000,
        production_headroom=0,
        diagnostic_lease=diagnostic,
    )
    ledger.account_usage("secret", "model", 34_805, lease=lease)
    driver = eval_harness.LiveRealtimeDriver(
        "secret",
        model="model",
        budget_lease=lease,
        provider_budget=ledger,
        capacity_sleep=advance,
        capacity_monotonic=lambda: clock[0],
        capacity_deadline=100.0,
    )
    session = OpenAIRealtimeSession(
        api_key="secret",
        model="model",
        budget_role="eval",
        budget_lease=lease,
        provider_budget=ledger,
        before_response_create=driver.prepare_response_capacity,
    )
    wire = Wire()
    session._ws = wire  # type: ignore[assignment]
    session._next_response_capacity_tokens = 5_769

    await session._send_response_create()

    assert waits == [pytest.approx(574 / (40_000 / 60) + 0.05)]
    assert [item["type"] for item in wire.sent] == ["response.create"]
    session._cancel_ack_watchdogs()
    assert ledger.release(lease) is True
    assert ledger.release(diagnostic) is True


async def test_v11331_field_gap_uses_provider_total_and_waits_exactly_once():
    """Details=33,455 but provider totals=35,743; next edge requests 5,692."""
    clock = [0.0]
    waits: list[float] = []

    async def advance(delay: float) -> None:
        waits.append(delay)
        clock[0] += delay

    class Wire:
        closed = False

        def __init__(self) -> None:
            self.sent: list[dict] = []

        async def send_json(self, payload: dict) -> None:
            self.sent.append(payload)

    ledger = ProviderBudgetCoordinator(monotonic=lambda: clock[0])
    diagnostic = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret", "model", tokens=15_000, production_headroom=0, diagnostic_lease=diagnostic
    )
    usage = OpenAIRealtimeSession._usage_of(
        {
            "response": {
                "id": "field-aggregate",
                "usage": {
                    "total_tokens": 35_743,
                    "input_tokens": 32_000,
                    "output_tokens": 3_743,
                    "input_token_details": {"text_tokens": 30_000},
                    "output_token_details": {"text_tokens": 3_455},
                },
            }
        }
    )
    assert usage is not None
    assert usage.provider_total_tokens == 35_743
    assert usage.input_text_tokens + usage.output_text_tokens == 33_455
    assert usage.unattributed_input_tokens + usage.unattributed_output_tokens == 2_288
    ledger.account_usage("secret", "model", usage.provider_total_tokens, lease=lease)
    driver = eval_harness.LiveRealtimeDriver(
        "secret",
        model="model",
        budget_lease=lease,
        provider_budget=ledger,
        capacity_sleep=advance,
        capacity_monotonic=lambda: clock[0],
        capacity_deadline=100.0,
    )
    session = OpenAIRealtimeSession(
        api_key="secret",
        model="model",
        budget_role="eval",
        budget_lease=lease,
        provider_budget=ledger,
        before_response_create=driver.prepare_response_capacity,
    )
    wire = Wire()
    session._ws = wire  # type: ignore[assignment]
    session._next_response_capacity_tokens = 5_692

    await session._send_response_create()

    assert waits == [pytest.approx(1_435 / (40_000 / 60) + 0.05)]
    assert [item["type"] for item in wire.sent] == ["response.create"]
    session._cancel_ack_watchdogs()
    assert ledger.release(lease) is True
    assert ledger.release(diagnostic) is True


def test_eval_budget_uses_provider_total_and_conservatively_prices_residual():
    budget = EvalBudget(max_actual_tokens=2_000, max_cost_usd=1.0)
    budget.record(
        {
            "provider_total_tokens": 1_250,
            "input_text_tokens": 700,
            "input_audio_tokens": 200,
            "input_image_tokens": 50,
            "output_text_tokens": 100,
            "output_audio_tokens": 20,
            "unattributed_input_tokens": 150,
            "unattributed_output_tokens": 30,
        }
    )
    assert budget.actual_tokens == 1_250
    assert budget.cost_usd == pytest.approx(
        (700 * 4 + 200 * 32 + 50 * 32 + 100 * 24 + 20 * 64 + 150 * 32 + 30 * 64) / 1_000_000
    )


async def test_capacity_sleep_is_outside_semantic_timeout_but_inside_driver_deadline():
    clock = [0.0]

    async def advance(delay: float) -> None:
        clock[0] += delay

    ledger = ProviderBudgetCoordinator(monotonic=lambda: clock[0])
    diagnostic = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret", "model", tokens=15_000, production_headroom=0, diagnostic_lease=diagnostic
    )
    ledger.account_usage("secret", "model", 39_900, lease=lease)
    driver = eval_harness.LiveRealtimeDriver(
        "secret",
        model="model",
        budget_lease=lease,
        provider_budget=ledger,
        capacity_sleep=advance,
        capacity_monotonic=lambda: clock[0],
        capacity_deadline=100.0,
    )
    driver.session = object()  # type: ignore[assignment]

    collecting = asyncio.create_task(
        driver._collect_turn(
            turn_id="turn",
            started=0.0,
            semantic_timeout_s=20.0,
        )
    )
    await asyncio.sleep(0)
    await driver.prepare_response_capacity(15_000)
    driver.events.put_nowait(eval_harness.TurnComplete(status="completed", response_id="answer"))
    observed = await collecting

    assert clock[0] > 20.0
    assert observed.response_status == "completed"
    assert ledger.release(lease) is True
    assert ledger.release(diagnostic) is True


async def test_live_driver_intra_session_wait_rejects_physical_diagnostic_conflict():
    clock = [0.0]
    ledger = ProviderBudgetCoordinator(monotonic=lambda: clock[0])
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 40_000, "reset_seconds": 60}],
    )
    diagnostic = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret", "model", tokens=15_000, production_headroom=0, diagnostic_lease=diagnostic
    )
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 14_000, "reset_seconds": 60}],
    )
    ledger.account_usage("secret", "model", 14_000, lease=lease, provider_reservation_observed=True)

    conflict: list[str] = []

    async def physical_arrives(delay: float) -> None:
        clock[0] += delay
        try:
            ledger.production_started("secret", "model")
        except ProviderBudgetUnavailable as exc:
            conflict.append(str(exc))

    driver = eval_harness.LiveRealtimeDriver(
        "secret",
        model="model",
        budget_lease=lease,
        provider_budget=ledger,
        capacity_sleep=physical_arrives,
        capacity_monotonic=lambda: clock[0],
        capacity_deadline=1_000.0,
    )
    await driver.prepare_response_capacity()

    snapshot = ledger.snapshot("secret", "model")
    assert conflict and "diagnostic_busy" in conflict[0]
    assert snapshot["production_sessions"] == 0
    assert snapshot["eval_trials"] == 1
    assert ledger.release(lease) is True
    assert ledger.release(diagnostic) is True


async def test_live_service_reports_the_exact_effective_prompt_identity(monkeypatch):
    async def fake_run(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        assert driver.instructions == "min aktive prompt"
        assert driver.model == "gpt-realtime-test"
        assert driver.voice == "marin"
        assert {item["name"] for item in driver.tools.declarations()} == {
            item["name"] for item in _production_snapshot()
        }
        return ScenarioResult(scenario.id, True, "session", [])

    monkeypatch.setattr(eval_harness, "run_scenario", fake_run)
    report = await LiveEvalService(provider_budget=_known_provider_budget()).run(
        api_key="secret",
        scenario_ids={"web-routing"},
        tool_declarations=_production_snapshot(),
        model="gpt-realtime-test",
        voice="marin",
        instructions="min aktive prompt",
    )
    assert report["ok"] is True, report.get("error")
    assert report["prompt_source"] == "custom"
    assert report["prompt_version"] is None
    assert len(report["prompt_sha256"]) == 64
    assert len(report["tool_schema_sha256"]) == 64
    assert len(report["production_tool_schema_sha256"]) == 64
    assert len(report["reserved_tool_schema_sha256"]) == 64
    assert report["tool_schema_profile"] == "production-plus-safe-sensitive-fixture"
    assert report["tool_schema_sha256"] == report["production_tool_schema_sha256"]
    assert "min aktive prompt" not in str(report)


async def test_live_service_paces_fresh_sessions_below_tier_one_tpm(monkeypatch):
    clock = [0.0]
    waits: list[float] = []

    async def fake_sleep(delay: float) -> None:
        waits.append(delay)
        clock[0] += delay

    async def fake_run(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        budget.record(
            {
                "input_text_tokens": 14_000,
                "input_audio_tokens": 0,
                "output_text_tokens": 0,
                "output_audio_tokens": 0,
            }
        )
        return ScenarioResult(scenario.id, True, "session", [])

    monkeypatch.setattr(eval_harness, "run_scenario", fake_run)
    service = LiveEvalService(
        sleep=fake_sleep,
        monotonic=lambda: clock[0],
        tpm_soft_limit=30_000,
        next_scenario_reserve=15_000,
        provider_budget=_known_provider_budget(),
    )
    report = await service.run(
        api_key="secret",
        scenario_ids={"arithmetic-followup", "time-followup", "semantic-close"},
        tool_declarations=_production_snapshot(),
    )
    assert report["ok"] is True
    # One further 14k session fits beside the first; the third is paced into the
    # next window once used tokens plus the 15k reservation exceed 30k.
    assert waits == [60.5]
    assert report["budget"]["rate_limit_wait_s"] == 60.5
    assert report["budget"]["actual_tokens"] == 42_000


async def test_live_service_default_keeps_one_measured_session_of_tpm_headroom(monkeypatch):
    clock = [0.0]
    waits: list[float] = []

    async def fake_sleep(delay: float) -> None:
        waits.append(delay)
        clock[0] += delay

    async def fake_run(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        budget.record({"input_text_tokens": 14_500})
        return ScenarioResult(scenario.id, True, "session", [])

    monkeypatch.setattr(eval_harness, "run_scenario", fake_run)
    service = LiveEvalService(
        sleep=fake_sleep,
        monotonic=lambda: clock[0],
        provider_budget=_known_provider_budget(),
    )
    report = await service.run(
        api_key="secret",
        scenario_ids={"arithmetic-followup", "time-followup"},
        tool_declarations=_production_snapshot(),
    )
    assert report["ok"] is True
    # 25k eval ceiling leaves 15k of the 40k Tier-1 window for a measured
    # ordinary PodVoice session, so two fresh eval sessions cannot share a minute.
    assert waits == [60.5]


def test_default_deadline_mechanically_covers_full_tier_one_profile():
    scenarios = load_scenarios()
    sessions = len(scenarios)
    turns = sum(len(scenario.turns) for scenario in scenarios)
    response_edges = turns * eval_harness.MAX_EVAL_RESPONSE_EDGES_PER_TURN
    required = (
        (response_edges - 1) * eval_harness.LIVE_EVAL_RESET_GAP_S
        + turns * eval_harness.LIVE_EVAL_TURN_TIMEOUT_S
        + sessions * eval_harness.C.CONNECT_TIMEOUT_S
        + 30.0
    )
    service = LiveEvalService(provider_budget=_known_provider_budget())

    assert sessions == 7
    assert service._max_run_s == required
    assert 40 * 60 < service._max_run_s < 42 * 60


async def test_local_soft_window_wait_also_rolls_provider_without_double_wait(monkeypatch):
    clock = [100.0]
    waits: list[float] = []
    ledger = ProviderBudgetCoordinator(monotonic=lambda: clock[0])
    ledger.update_rate_limits(
        "secret",
        DEFAULT_MODEL,
        [{"name": "tokens", "limit": 40_000, "remaining": 40_000, "reset_seconds": 60}],
    )
    calls = 0

    async def advance(seconds: float):
        waits.append(seconds)
        clock[0] += seconds

    async def fake_run(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        nonlocal calls
        calls += 1
        budget.record({"input_text_tokens": 11_000})
        ledger.update_rate_limits(
            "secret",
            DEFAULT_MODEL,
            [
                {
                    "name": "tokens",
                    "limit": 40_000,
                    "remaining": 29_000,
                    "reset_seconds": 60,
                }
            ],
        )
        return ScenarioResult(scenario.id, True, "one-session", [])

    monkeypatch.setattr(eval_harness, "run_scenario", fake_run)
    report = await LiveEvalService(
        sleep=advance,
        monotonic=lambda: clock[0],
        provider_budget=ledger,
    ).run(
        api_key="secret",
        scenario_ids={"arithmetic-followup", "time-followup"},
        tool_declarations=_production_snapshot(),
    )

    assert report["ok"] is True
    assert calls == 2
    assert waits == [60.5]


async def test_full_seven_session_profile_accepts_measured_14_5k_each(monkeypatch):
    clock = [0.0]
    calls = 0

    async def advance(seconds: float):
        clock[0] += seconds

    async def fake_run(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        nonlocal calls
        calls += 1
        budget.record({"input_text_tokens": 14_500})
        return ScenarioResult(scenario.id, True, f"session-{calls}", [])

    monkeypatch.setattr(eval_harness, "run_scenario", fake_run)
    report = await LiveEvalService(
        sleep=advance,
        monotonic=lambda: clock[0],
        provider_budget=_known_provider_budget(),
    ).run(api_key="secret", tool_declarations=_production_snapshot())

    assert report["ok"] is True, report.get("error")
    assert calls == 7
    assert report["budget"]["actual_tokens"] == 101_500
    assert report["budget"]["max_actual_tokens"] == 540_000
    assert report["budget"]["max_cost_usd"] == pytest.approx(5.0)
    assert report["budget"]["mechanical_max_cost_usd"] == pytest.approx(36.0)
    assert report["deadline_s"] > report["budget"]["rate_limit_wait_s"]


async def test_live_eval_fails_closed_while_a_production_session_is_active(monkeypatch):
    ledger = _known_provider_budget()
    production = ledger.production_started("secret", DEFAULT_MODEL)
    called = False

    async def fake_run(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        nonlocal called
        called = True
        return ScenarioResult(scenario.id, True, "session", [])

    monkeypatch.setattr(eval_harness, "run_scenario", fake_run)
    report = await LiveEvalService(provider_budget=ledger).run(
        api_key="secret", scenario_ids={"web-routing"}, tool_declarations=_production_snapshot()
    )
    assert report["ok"] is False
    assert "production voice session" in report["error"]
    assert called is False
    assert ledger.release(production) is True


async def test_physical_session_attempt_during_eval_is_rejected_without_stopping_eval(monkeypatch):
    ledger = _known_provider_budget()
    calls = 0
    conflicts: list[str] = []

    async def fake_run(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        nonlocal calls
        calls += 1
        try:
            ledger.production_started("secret", DEFAULT_MODEL)
        except ProviderBudgetUnavailable as exc:
            conflicts.append(str(exc))
        return ScenarioResult(scenario.id, True, "session", [])

    monkeypatch.setattr(eval_harness, "run_scenario", fake_run)
    report = await LiveEvalService(provider_budget=ledger).run(
        api_key="secret",
        scenario_ids={"arithmetic-followup", "time-followup"},
        tool_declarations=_production_snapshot(),
    )
    assert report["ok"] is True
    assert calls == 2
    assert conflicts and all("diagnostic_busy" in item for item in conflicts)
    production = ledger.production_started("secret", DEFAULT_MODEL)
    assert ledger.release(production) is True


async def test_live_eval_waits_one_authoritative_reset_before_next_admission(monkeypatch):
    clock = [100.0]
    waits: list[float] = []
    ledger = ProviderBudgetCoordinator(monotonic=lambda: clock[0])
    ledger.update_rate_limits(
        "secret",
        DEFAULT_MODEL,
        [{"name": "tokens", "limit": 40_000, "remaining": 14_999, "reset_seconds": 3}],
    )
    calls = 0

    async def advance(seconds: float):
        waits.append(seconds)
        clock[0] += seconds

    async def fake_run(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        nonlocal calls
        calls += 1
        if calls == 1:
            ledger.update_rate_limits(
                "secret",
                DEFAULT_MODEL,
                [{"name": "tokens", "limit": 40_000, "remaining": 14_999, "reset_seconds": 3}],
            )
        return ScenarioResult(scenario.id, True, "after-provider-reset", [])

    monkeypatch.setattr(eval_harness, "run_scenario", fake_run)
    report = await LiveEvalService(
        sleep=advance,
        monotonic=lambda: clock[0],
        provider_budget=ledger,
    ).run(
        api_key="secret",
        scenario_ids={"web-routing", "arithmetic-followup"},
        tool_declarations=_production_snapshot(),
    )

    assert report["ok"] is True
    assert calls == 2
    expected = 1 / (40_000 / 60) + 0.05
    assert waits == [pytest.approx(expected)]
    assert report["budget"]["rate_limit_wait_s"] == pytest.approx(expected)
    assert ledger.snapshot("secret", DEFAULT_MODEL)["eval_trials"] == 0


async def test_physical_session_starting_during_reset_wait_is_diagnostic_busy(monkeypatch):
    clock = [100.0]
    ledger = ProviderBudgetCoordinator(monotonic=lambda: clock[0])
    ledger.update_rate_limits(
        "secret",
        DEFAULT_MODEL,
        [{"name": "tokens", "limit": 40_000, "remaining": 14_999, "reset_seconds": 3}],
    )
    conflict = None
    calls = 0

    async def physical_wake(seconds: float):
        nonlocal conflict
        clock[0] += seconds
        try:
            ledger.production_started("secret", DEFAULT_MODEL)
        except ProviderBudgetUnavailable as exc:
            conflict = str(exc)

    async def must_not_run(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            ledger.update_rate_limits(
                "secret",
                DEFAULT_MODEL,
                [{"name": "tokens", "limit": 40_000, "remaining": 14_999, "reset_seconds": 3}],
            )
        return ScenarioResult("web-routing", True, "after-exclusive-wait", [])

    monkeypatch.setattr(eval_harness, "run_scenario", must_not_run)
    report = await LiveEvalService(
        sleep=physical_wake,
        monotonic=lambda: clock[0],
        provider_budget=ledger,
    ).run(
        api_key="secret",
        scenario_ids={"web-routing", "arithmetic-followup"},
        tool_declarations=_production_snapshot(),
    )

    assert report["ok"] is True
    assert conflict and "diagnostic_busy" in conflict
    assert calls == 2


async def test_reset_wait_does_not_replay_a_completed_scenario(monkeypatch):
    clock = [100.0]
    ledger = ProviderBudgetCoordinator(monotonic=lambda: clock[0])
    ledger.update_rate_limits(
        "secret",
        DEFAULT_MODEL,
        [{"name": "tokens", "limit": 40_000, "remaining": 40_000, "reset_seconds": 5}],
    )
    completed: list[str] = []
    conflicts: list[str] = []

    async def fake_run(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        completed.append(scenario.id)
        ledger.update_rate_limits(
            "secret",
            DEFAULT_MODEL,
            [
                {
                    "name": "tokens",
                    "limit": 40_000,
                    "remaining": 14_999,
                    "reset_seconds": 5,
                }
            ],
        )
        return ScenarioResult(scenario.id, True, "completed-once", [])

    async def physical_wake(seconds: float):
        clock[0] += seconds
        try:
            ledger.production_started("secret", DEFAULT_MODEL)
        except ProviderBudgetUnavailable as exc:
            conflicts.append(str(exc))

    monkeypatch.setattr(eval_harness, "run_scenario", fake_run)
    report = await LiveEvalService(
        sleep=physical_wake,
        monotonic=lambda: clock[0],
        provider_budget=ledger,
    ).run(
        api_key="secret",
        scenario_ids={"arithmetic-followup", "time-followup"},
        tool_declarations=_production_snapshot(),
    )

    assert report["ok"] is True
    assert len(completed) == 2
    assert len(set(completed)) == 2
    assert conflicts and all("diagnostic_busy" in item for item in conflicts)


async def test_whole_run_timeout_bounds_provider_reset_wait(monkeypatch):
    ledger = ProviderBudgetCoordinator()
    ledger.update_rate_limits(
        "secret",
        DEFAULT_MODEL,
        [{"name": "tokens", "limit": 40_000, "remaining": 0, "reset_seconds": 60}],
    )
    calls = 0

    async def blocked_sleep(seconds: float):
        await asyncio.Event().wait()

    async def must_not_run(*args, **kwargs):
        nonlocal calls
        calls += 1
        ledger.update_rate_limits(
            "secret",
            DEFAULT_MODEL,
            [{"name": "tokens", "limit": 40_000, "remaining": 0, "reset_seconds": 60}],
        )
        return ScenarioResult("first", True, "completed-before-wait", [])

    monkeypatch.setattr(eval_harness, "run_scenario", must_not_run)
    report = await LiveEvalService(
        sleep=blocked_sleep,
        # The provider wait itself must be rejected against this tiny deadline.
        max_run_s=0.1,
        provider_budget=ledger,
    ).run(
        api_key="secret",
        scenario_ids={"web-routing", "arithmetic-followup"},
        tool_declarations=_production_snapshot(),
    )

    assert report["ok"] is False
    assert "provider reset wait exceeds the live eval deadline" in report["error"]
    assert calls == 1
    assert ledger.snapshot("secret", DEFAULT_MODEL)["eval_trials"] == 0
    assert ledger.diagnostic_is_active("secret") is False


async def test_live_service_background_job_survives_requests_and_retains_result(monkeypatch):
    release = asyncio.Event()

    async def fake_run(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        await release.wait()
        return ScenarioResult(scenario.id, True, "session", [])

    monkeypatch.setattr(eval_harness, "run_scenario", fake_run)
    service = LiveEvalService(provider_budget=_known_provider_budget())
    started = service.start(
        api_key="secret", scenario_ids={"web-routing"}, tool_declarations=_production_snapshot()
    )
    assert started["status"] == "running"
    run_id = started["run_id"]
    assert service.status(run_id)["status"] == "running"

    duplicate = service.start(
        api_key="secret", scenario_ids={"web-routing"}, tool_declarations=_production_snapshot()
    )
    assert duplicate["status"] == "busy"
    assert duplicate["run_id"] == run_id

    release.set()
    assert service._job is not None
    await service._job
    retained = service.status(run_id)
    assert retained["status"] == "complete"
    assert retained["ok"] is True
    assert service.status("eval-unknown")["status"] == "not_found"


async def test_live_service_cancel_is_explicit_and_does_not_leave_busy(monkeypatch):
    async def fake_run(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    monkeypatch.setattr(eval_harness, "run_scenario", fake_run)
    ledger = _known_provider_budget()
    service = LiveEvalService(provider_budget=ledger)
    started = service.start(
        api_key="secret", scenario_ids={"web-routing"}, tool_declarations=_production_snapshot()
    )
    await asyncio.sleep(0)
    await service.aclose()
    report = service.status(started["run_id"])
    assert report["status"] == "cancelled"
    assert service.status()["status"] == "cancelled"
    assert ledger.diagnostic_is_active("secret") is False


def test_live_service_rejects_mixed_known_and_unknown_scenarios():
    service = LiveEvalService(provider_budget=_known_provider_budget())
    report = service.start(api_key="secret", scenario_ids={"web-routing", "not-a-real-scenario"})
    assert report["status"] == "invalid"
    assert service.status()["status"] == "idle"


async def test_live_service_whole_job_timeout_is_retained_as_failure(monkeypatch):
    async def hung_run(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    monkeypatch.setattr(eval_harness, "run_scenario", hung_run)
    service = LiveEvalService(max_run_s=0.01, provider_budget=_known_provider_budget())
    started = service.start(
        api_key="secret", scenario_ids={"web-routing"}, tool_declarations=_production_snapshot()
    )
    assert service._job is not None
    await service._job
    report = service.status(started["run_id"])
    assert report["status"] == "failed"
    assert report["run_id"] == started["run_id"]


async def test_audio_replay_runs_text_control_and_exact_pcm_in_fresh_safe_sessions(monkeypatch):
    opened: list[str] = []
    audio_seen: list[bytes] = []

    class FakeDriver:
        def __init__(self, *args, tool_declarations=None, **kwargs):
            assert tool_declarations[0]["name"] == "get_time"

        async def open(self, *, run_id, scenario_id):
            session_id = f"{run_id}:{scenario_id}:{len(opened)}"
            opened.append(session_id)
            return session_id

        async def submit_text(self, *, turn_id, text):
            assert text == "Hvad er klokken?"
            return TurnObservation(
                turn_id=turn_id,
                session_id=opened[-1],
                decisions=["get_time"],
                tool_args={"get_time": [{"fields": ["time"]}]},
                answer="Klokken er fjorten.",
                usage={"input_text_tokens": 100},
            )

        async def submit_audio(self, *, turn_id, pcm, rate):
            assert rate == 24000
            audio_seen.append(pcm)
            return TurnObservation(
                turn_id=turn_id,
                session_id=opened[-1],
                decisions=["get_time"],
                tool_args={"get_time": [{"fields": ["time"]}]},
                answer="Klokken er fjorten.",
                diagnostic_transcript="Hvad er klokken?",
                usage={"input_text_tokens": 100},
            )

        async def close(self):
            return None

    monkeypatch.setattr(eval_harness, "LiveRealtimeDriver", FakeDriver)
    pcm = b"\x01\x00" * 24000
    fixture = AudioReplayFixture(
        trace_id="trace-one",
        turn_index=0,
        pcm=pcm,
        rate=24000,
        duration_ms=1000,
        sha256=eval_harness.hashlib.sha256(pcm).hexdigest(),
        diagnostic_transcript="Hvad er klokken?",
        exact_sample_offsets=True,
        room_context="Evalrum",
    )
    scenario = next(item for item in load_scenarios() if item.id == "time-followup")
    declarations = SafeEvalTools().declarations()
    report = await LiveEvalService(provider_budget=_known_provider_budget()).run_replay(
        api_key="secret",
        fixture=fixture,
        scenario=scenario,
        turn_index=0,
        repeats=3,
        tool_declarations=declarations,
    )

    assert report["ok"] is True
    assert report["classification"] == "audio-replay-consistent"
    assert report["tool_schema_profile"] == "production-replay"
    assert report["tool_schema_sha256"] == report["production_tool_schema_sha256"]
    assert len(opened) == 4  # one text control + three independent audio sessions
    assert audio_seen == [pcm, pcm, pcm]
    assert report["trace"]["sha256"] == fixture.sha256
    assert all(trial["observation"]["diagnostic_transcript"] for trial in report["trials"])
    assert report["transcription_budget"] == {
        "model": "gpt-live-transcribe",
        "audio_seconds": pytest.approx(3.0),
        "usd_per_minute": pytest.approx(0.017),
        "cost_usd": pytest.approx(0.00085),
    }
    assert report["budget"]["cost_usd"] >= report["transcription_budget"]["cost_usd"]


async def test_audio_replay_transcription_surcharge_can_block_before_provider_socket(monkeypatch):
    class ForbiddenDriver:
        def __init__(self, *_args, **_kwargs):
            raise AssertionError("budget stop must precede provider socket")

    monkeypatch.setattr(eval_harness, "LiveRealtimeDriver", ForbiddenDriver)
    monkeypatch.setattr(eval_harness, "GPT_LIVE_TRANSCRIBE_USD_PER_MINUTE", 200.0)
    pcm = b"\x00\x00" * 24_000
    fixture = AudioReplayFixture(
        trace_id="trace-cost",
        turn_index=0,
        pcm=pcm,
        rate=24_000,
        duration_ms=1_000,
        sha256=eval_harness.hashlib.sha256(pcm).hexdigest(),
        diagnostic_transcript="Hvad er klokken?",
        exact_sample_offsets=True,
    )
    scenario = next(item for item in load_scenarios() if item.id == "time-followup")
    ledger = _known_provider_budget()
    report = await LiveEvalService(provider_budget=ledger).run_replay(
        api_key="secret",
        fixture=fixture,
        scenario=scenario,
        turn_index=0,
        repeats=3,
        tool_declarations=SafeEvalTools().declarations(),
    )
    assert report["classification"] == "budget-exhausted"
    assert report["transcription_budget"]["cost_usd"] == pytest.approx(10.0)
    assert ledger.diagnostic_is_active("secret") is False


def test_audio_replay_start_fails_closed_on_tampered_pcm():
    fixture = AudioReplayFixture(
        trace_id="trace-one",
        turn_index=0,
        pcm=b"\x00\x00" * 24000,
        rate=24000,
        duration_ms=1000,
        sha256="0" * 64,
        diagnostic_transcript="Hvad er klokken?",
        exact_sample_offsets=True,
    )
    scenario = next(item for item in load_scenarios() if item.id == "time-followup")
    report = LiveEvalService(provider_budget=_known_provider_budget()).start_replay(
        api_key="secret", fixture=fixture, scenario=scenario, turn_index=0
    )
    assert report["status"] == "invalid"
    assert report["ok"] is False
    assert "replay" in report["error"].lower()


async def test_audio_replay_refuses_a_proven_different_source_tool_schema(monkeypatch):
    class ForbiddenDriver:
        def __init__(self, *args, **kwargs):
            raise AssertionError("schema mismatch must be rejected before provider connect")

    monkeypatch.setattr(eval_harness, "LiveRealtimeDriver", ForbiddenDriver)
    pcm = b"\x00\x00" * 24000
    fixture = AudioReplayFixture(
        trace_id="trace-schema",
        turn_index=0,
        pcm=pcm,
        rate=24000,
        duration_ms=1000,
        sha256=eval_harness.hashlib.sha256(pcm).hexdigest(),
        diagnostic_transcript="Hvad er klokken?",
        exact_sample_offsets=True,
        source_tool_schema_sha256="0" * 64,
    )
    scenario = next(item for item in load_scenarios() if item.id == "time-followup")
    report = await LiveEvalService(provider_budget=_known_provider_budget()).run_replay(
        api_key="secret",
        fixture=fixture,
        scenario=scenario,
        turn_index=0,
        repeats=3,
        tool_declarations=SafeEvalTools().declarations(),
    )
    assert report["ok"] is False
    assert report["classification"] == "tool-schema-mismatch"
    assert report["trace"]["schema_match"] is False
    assert report["budget"]["turns"] == 0
