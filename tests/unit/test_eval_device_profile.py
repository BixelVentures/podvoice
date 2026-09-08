"""Optional fixture evaluation never enables or dispatches the live HA adapter."""

import asyncio
import copy

import pytest
from unit.test_eval_harness import _known_provider_budget, _production_snapshot

from gatekeeper import device_control as dc
from gatekeeper import eval_harness as ev
from gatekeeper.provider_budget import ProviderBudgetUnavailable
from gatekeeper.tools import ToolRouter
from gatekeeper.voice import TurnComplete, Usage


def admitted():
    return ev._admit_eval_tools(
        ev.load_scenarios(ev.DEVICE_EVAL_PATH),
        _production_snapshot() + copy.deepcopy(dc._DECLARATIONS),
        fixture_path=ev.DEVICE_EVAL_PATH,
    )


def fixture():
    admission = admitted()
    return ev.SafeEvalTools(
        admission.declarations,
        admitted_names=set(admission.contracts),
        fixture_contracts=admission.contracts,
    )


async def test_canonical_sequence_exact_single_use_and_terminal():
    tools = fixture()
    contracts = ev.load_fixture_contracts(ev.DEVICE_EVAL_PATH)
    tools.begin_turn("one")
    assert (await tools.dispatch(dc.GET_CAPABILITIES, {"entity_id": "vacuum.eval_qrevo"}))["ok"]
    actions = contracts[dc.EXECUTE_ACTION].cases[:4]
    assert not (await tools.dispatch(dc.EXECUTE_ACTION, actions[1].args))["ok"]
    for case in actions:
        assert await tools.dispatch(dc.EXECUTE_ACTION, case.args) == case.result
    assert tools.fixture_side_effects == 4
    assert not (await tools.dispatch(dc.EXECUTE_ACTION, actions[-1].args))["ok"]
    assert not (await tools.dispatch(dc.GET_CAPABILITIES, {"entity_id": "vacuum.eval_qrevo"}))["ok"]
    assert tools.fixture_side_effects == 4


async def test_unknown_start_cannot_be_retried_or_rearmed_by_read():
    tools = fixture()
    tools.begin_turn("one")
    await tools.dispatch(dc.GET_CAPABILITIES, {"entity_id": "vacuum.eval_unknown"})
    action = ev.load_fixture_contracts(ev.DEVICE_EVAL_PATH)[dc.EXECUTE_ACTION].cases[-1]
    assert (await tools.dispatch(dc.EXECUTE_ACTION, action.args))[
        "error_kind"
    ] == "device_outcome_unknown"
    tools.finish_turn()
    tools.begin_turn("two")
    assert not (await tools.dispatch(dc.GET_CAPABILITIES, {"entity_id": "vacuum.eval_unknown"}))[
        "ok"
    ]
    assert not (await tools.dispatch(dc.EXECUTE_ACTION, action.args))["ok"]
    assert tools.fixture_side_effects == 0


async def test_profile_refuses_real_targets_and_other_declared_tools():
    tools = fixture()
    assert (await tools.dispatch(dc.GET_CAPABILITIES, {"entity_id": "vacuum.real_home"}))[
        "error_kind"
    ] == "eval_fixture_args_mismatch"
    assert (await tools.dispatch("HassTurnOn", {"area": "stue", "domain": ["light"]}))[
        "error_kind"
    ] == "eval_tool_refused"
    assert not (await ev.SafeEvalTools().dispatch(dc.GET_CAPABILITIES, {}))["ok"]
    assert tools.fixture_side_effects == 0


def test_default_profile_and_device_schemas_are_separate_and_detached():
    default = ev.load_scenarios()
    assert all(not scenario.id.startswith("device-") for scenario in default)
    before = _production_snapshot()
    result = admitted()
    assert set(result.contracts) == dc.TOOL_NAMES | {"end_conversation"}
    assert (
        ev._capability_metadata(result, ev.load_scenarios(ev.DEVICE_EVAL_PATH))["profile_complete"]
        is False
    )
    result.declarations[-1]["description"] = "mutated"
    assert _production_snapshot() == before
    assert ev.MAX_EVAL_RESPONSE_EDGES_PER_TURN == 4


def test_profile_selector_cannot_mix_with_default_or_accept_arbitrary_names():
    service = ev.LiveEvalService()
    for ids in ({ev.DEVICE_EVAL_PROFILE, "time-followup"}, {"device-sequence"}):
        assert service.start(api_key="secret", scenario_ids=ids)["status"] == "invalid"


async def test_snapshot_is_captured_only_inside_diagnostic_lease_and_not_mutated(monkeypatch):
    ledger = _known_provider_budget()
    production = _production_snapshot()
    original = copy.deepcopy(production)
    captured = []

    def snapshot():
        assert ledger.diagnostic_is_active("secret")
        return production

    async def run(**kwargs):
        assert ledger.diagnostic_is_active("secret")
        assert kwargs["_device_fixture"]
        captured.extend(kwargs["tool_declarations"])
        return {"status": "complete", "selected_ok": True, "results": []}

    service = ev.LiveEvalService(provider_budget=ledger, production_tool_snapshot=snapshot)
    monkeypatch.setattr(service, "run", run)
    report = await service.run_device_control(
        api_key="secret", run_id="test", scenario_ids={ev.DEVICE_EVAL_PROFILE}
    )
    assert production == original
    assert [row for row in captured if row["name"] in dc.TOOL_NAMES] == dc._DECLARATIONS
    assert report["production_tool_schema_sha256"] != report["candidate_enabled_tool_schema_sha256"]
    assert report["production_router_schema_sha256"] == ToolRouter._schema_sha256_for_declarations(
        production
    )
    assert report["candidate_router_schema_sha256"] == ToolRouter._schema_sha256_for_declarations(
        captured
    )
    assert not report["candidate_contract_passed"]  # a green but empty report is not proof
    assert report["physical_result_verified"] is False
    assert not ledger.diagnostic_is_active("secret")


@pytest.mark.parametrize("failure", ["snapshot", "run", "cancel", "collision"])
async def test_all_terminal_paths_release_diagnostic_lease(monkeypatch, failure):
    ledger = _known_provider_budget()

    def snapshot():
        if failure == "snapshot":
            raise ValueError("snapshot failed")
        result = _production_snapshot()
        if failure == "collision":
            result.append({"name": dc.GET_CAPABILITIES, "parameters": {}})
        return result

    async def run(**kwargs):
        if failure == "cancel":
            raise asyncio.CancelledError
        raise ValueError("run failed")

    service = ev.LiveEvalService(provider_budget=ledger, production_tool_snapshot=snapshot)
    monkeypatch.setattr(service, "run", run)
    with pytest.raises(asyncio.CancelledError if failure == "cancel" else ValueError):
        await service.run_device_control(api_key="secret")
    assert not ledger.diagnostic_is_active("secret")


async def test_active_production_session_prevents_snapshot():
    ledger = _known_provider_budget()
    lease = ledger.production_started("secret", "gpt-realtime-test")

    def forbidden():
        raise AssertionError("snapshot must not happen while production owns key")

    service = ev.LiveEvalService(provider_budget=ledger, production_tool_snapshot=forbidden)
    try:
        with pytest.raises(ProviderBudgetUnavailable):
            await service.run_device_control(api_key="secret")
    finally:
        ledger.release(lease)


async def test_nine_edge_profile_requires_guard_and_stops_before_next_dollar():
    budget = ev.EvalBudget(max_reserved_tokens=100_000)
    with pytest.raises(ValueError):
        ev.LiveRealtimeDriver("", response_edges=ev.DEVICE_EVAL_RESPONSE_EDGES)
    driver = ev.LiveRealtimeDriver(
        "", response_edges=ev.DEVICE_EVAL_RESPONSE_EDGES, cost_budget=budget
    )
    budget.reserve_device_turn()
    assert budget.reserved_tokens == 9 * ev.MAX_OUTPUT_TOKENS
    assert budget.max_cost_usd == 5
    budget.cost_usd = 4.01
    with pytest.raises(RuntimeError, match="budget_exhausted"):
        await driver.prepare_response_capacity()
    assert driver.session is None


@pytest.mark.parametrize("duplicate", [False, True])
async def test_real_collector_records_each_usage_once_before_next_response(duplicate):
    budget = ev.EvalBudget(max_reserved_tokens=100_000)
    driver = ev.LiveRealtimeDriver("", response_edges=9, cost_budget=budget)
    driver.session = object()
    usage = Usage(response_id="paid-edge", input_text_tokens=100, provider_total_tokens=100)
    driver.events.put_nowait(usage)
    if duplicate:
        driver.events.put_nowait(usage)
        with pytest.raises(RuntimeError, match="provider_usage_unknown"):
            await driver._collect_turn(turn_id="one", started=0)
    else:
        driver.events.put_nowait(
            TurnComplete(status="completed", response_id="paid-edge", generation=1)
        )
        observed = await driver._collect_turn(turn_id="one", started=0)
        assert observed.usage["provider_total_tokens"] == 100
    assert budget.actual_tokens == 100
    assert budget.cost_usd == pytest.approx(0.0004)


def test_panel_has_explicit_nonphysical_profile_and_no_activation_claim():
    source = (ev.pathlib.Path(ev.__file__).parent / "static" / "index.html").read_text()
    assert 'startLiveEval(["device-control"], 1)' in source
    assert "Test Roborock — simuleret robot" in source
    assert "Ingen HA-handlinger sendt, ingen aktivering" in source


async def test_middle_settings_can_commute_without_reordering_mode_or_start():
    tools = fixture()
    tools.begin_turn("one")
    await tools.dispatch(dc.GET_CAPABILITIES, {"entity_id": "vacuum.eval_qrevo"})
    cases = ev.load_fixture_contracts(ev.DEVICE_EVAL_PATH)[dc.EXECUTE_ACTION].cases
    for index in (0, 4, 5, 3):
        assert await tools.dispatch(dc.EXECUTE_ACTION, cases[index].args) == cases[index].result
    assert tools.fixture_side_effects == 4
    assert not (await tools.dispatch(dc.EXECUTE_ACTION, cases[3].args))["ok"]


def matching_observation(expect, answer):
    return ev.TurnObservation(
        turn_id="one",
        session_id="fixture",
        accepted=True,
        response_status="completed",
        decisions=list(expect.decisions or (expect.decision,)),
        decision_batches=[list(batch) for batch in expect.decision_batches],
        tool_args={name: [args] for name, args in expect.tool_args.items()},
        tool_results={
            name: [
                {"ok": outcome == "ok", **({} if outcome == "ok" else {"error_kind": outcome})}
                for outcome in outcomes
            ]
            for name, outcomes in expect.tool_outcomes.items()
        },
        fixture_side_effects=expect.fixture_side_effects,
        remain_open=expect.remain_open,
        answer=answer,
    )


@pytest.mark.parametrize("scenario_index", [1, 2])
@pytest.mark.parametrize(
    "answer",
    [
        "",
        "Robotten er startet, og rengøringen er færdig.",
        "Jeg har startet rengøringen.",
        "Udfaldet er ukendt, men rengøringen er færdig.",
    ],
)
def test_negative_reply_oracles_reject_empty_or_false_success(scenario_index, answer):
    expect = ev.load_scenarios(ev.DEVICE_EVAL_PATH)[scenario_index].turns[0].expect
    findings = ev.grade_turn(expect, matching_observation(expect, answer))
    assert [finding.code for finding in findings] == ["answer-pattern-mismatch"]


@pytest.mark.parametrize(
    "scenario_index,answer",
    [
        (1, "Jeg kan ikke bekræfte starten. Tjek robotten før et nyt forsøg."),
        (2, "Hvilket af de to rum med navnet køkken mener du?"),
    ],
)
def test_negative_reply_oracles_accept_truthful_uncertainty_and_clarification(
    scenario_index, answer
):
    expect = ev.load_scenarios(ev.DEVICE_EVAL_PATH)[scenario_index].turns[0].expect
    assert not ev.grade_turn(expect, matching_observation(expect, answer))


def test_accepted_job_reply_is_not_physical_completion():
    expect = ev.load_scenarios(ev.DEVICE_EVAL_PATH)[0].turns[1].expect
    assert not ev.grade_turn(
        expect, matching_observation(expect, "Rengøringsopgaven er sendt til støvsugeren.")
    )
    assert ev.grade_turn(
        expect, matching_observation(expect, "Jeg har gennemført rengøringen to gange.")
    )


async def test_failed_discovery_never_spends_another_turn_or_carries_extra_audio_context():
    budget = ev.EvalBudget(max_turns=2, max_reserved_tokens=100_000)

    class Driver:
        _cost_budget = budget

        def __init__(self):
            self.calls = []
            self.closed = False

        async def open(self, **kwargs):
            return "fixture"

        async def submit_text(self, *, turn_id, text):
            self.calls.append(text)
            return ev.TurnObservation(
                turn_id,
                "fixture",
                accepted=True,
                response_status="completed",
                remain_open=True,
                answer="Forkert svar uden det krævede opslag.",
            )

        async def close(self):
            self.closed = True

    driver = Driver()
    scenario = ev.load_scenarios(ev.DEVICE_EVAL_PATH)[0]
    with pytest.raises(ev.ScenarioExecutionError) as error:
        await ev.run_scenario(driver, scenario, run_id="fixture", budget=budget, response_edges=9)
    assert driver.calls == [scenario.turns[0].text]
    assert driver.closed
    assert not error.value.result.passed
    assert len(error.value.result.turns) == 1
    assert budget.turns == 1
