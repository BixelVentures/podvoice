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


@pytest.mark.parametrize("scenario_id", ["device-room-question", "device-room-correction"])
def test_room_lookup_oracle_rejects_observed_redundant_discovery(scenario_id):
    """.79 returned correct Danish rooms but spent an avoidable discovery round."""
    scenario = next(s for s in ev.load_scenarios(ev.DEVICE_EVAL_PATH) if s.id == scenario_id)
    expect = scenario.turns[0].expect
    observed = matching_observation(expect, "Den kan rengøre Køkken og Spisestue.")
    assert not ev.grade_turn(expect, observed)
    observed.decisions = [dc.GET_CAPABILITIES, dc.GET_CAPABILITIES]
    observed.decision_batches = [[dc.GET_CAPABILITIES], [dc.GET_CAPABILITIES]]
    observed.tool_args[dc.GET_CAPABILITIES].insert(0, {})
    assert "wrong-decision" in {finding.code for finding in ev.grade_turn(expect, observed)}
    assert observed.fixture_side_effects == 0


@pytest.mark.parametrize("scenario_id", ["device-room-question", "device-room-correction"])
def test_room_lookup_oracle_rejects_wrong_target_and_start(scenario_id):
    scenario = next(s for s in ev.load_scenarios(ev.DEVICE_EVAL_PATH) if s.id == scenario_id)
    expect = scenario.turns[0].expect
    observed = matching_observation(expect, "Den kan rengøre Køkken og Spisestue.")
    observed.tool_args[dc.GET_CAPABILITIES] = [{"entity_id": "vacuum.other"}]
    assert ev.grade_turn(expect, observed)
    observed = matching_observation(expect, "Den kan rengøre Køkken og Spisestue.")
    observed.decisions.append(dc.EXECUTE_ACTION)
    observed.fixture_side_effects = 1
    assert ev.grade_turn(expect, observed)


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
    assert "answer-pattern-mismatch" in {finding.code for finding in findings}


@pytest.mark.parametrize("scenario_index", [0, 3])
@pytest.mark.parametrize(
    "answer,passed",
    [
        ("Jeg har vacuum.eval_qrevo, vacuum.eval_unknown og vacuum.eval_ambiguous.", True),
        ("", False),
        ("Jeg har vacuum.eval_qrevo og vacuum.eval_unknown.", False),
        ("Jeg kan se tre robotter.", False),
        (
            "vacuum.eval_qrevo, vacuum.eval_unknown og vacuum.eval_ambiguous. Robotten er startet.",
            False,
        ),
    ],
)
def test_explicit_entity_discovery_requires_all_ids(scenario_index, answer, passed):
    expect = ev.load_scenarios(ev.DEVICE_EVAL_PATH)[scenario_index].turns[0].expect
    assert bool(not ev.grade_turn(expect, matching_observation(expect, answer))) is passed


@pytest.mark.parametrize("scenario_index", [4, 5])
@pytest.mark.parametrize(
    "answer,passed",
    [
        ("Den kan rengøre Køkken og Spisestue.", True),
        ("Jeg starter ikke noget. Den kan rengøre Spisestue og Køkken.", True),
        ("Der er ikke startet rengøring. Rummene er Køkken og Spisestue.", True),
        ("Hej", False),
        ("Køkken", False),
        ("Spisestue", False),
        ("Køkken er startet", False),
        ("Køkken og Spisestue. Robotten er startet.", False),
        ("Køkken og Spisestue.\nJeg har startet rengøringen.", False),
        ("Køkken og Spisestue. Skal jeg starte rengøringen?", False),
        ("Køkken og Spisestue. Vil du have, at jeg rengør begge?", False),
        ("Køkken og Spisestue. Bekræft starten.", False),
        ("Køkken (kitchen) og Spisestue (dining room).", False),
        ("Køkken og Spisestue via vacuum.eval_qrevo.", False),
    ],
)
def test_room_replies_require_both_names_and_no_action_or_raw_ids(scenario_index, answer, passed):
    expect = ev.load_scenarios(ev.DEVICE_EVAL_PATH)[scenario_index].turns[0].expect
    assert bool(not ev.grade_turn(expect, matching_observation(expect, answer))) is passed


@pytest.mark.parametrize(
    "answer,passed",
    [
        ("Hvilket af de to rum med navnet Køkken mener du?", True),
        ("Begge rum hedder Køkken. Giv dem venligst unikke navne i Home Assistant.", True),
        (
            "Der er to forskellige områder, der begge hedder Køkken. "
            "Kan du give dem forskellige navne i Home Assistant?",
            True,
        ),
        (
            "Jeg kan ikke skelne mellem de to Køkken-områder. "
            "De skal have forskellige navne, før jeg kan vælge sikkert.",
            True,
        ),
        ("Hvilket mener du?", False),
        ("Der er et Køkken. Vil du vælge det?", False),
        (
            "Jeg kan se to forskellige områder, der begge hedder Køkken, så jeg kan ikke "
            "sikkert vælge det rigtige. Vil du have, at jeg renser kitchen_one, kitchen_two, "
            "eller begge?",
            False,
        ),
        ("Mener du Køkken ovenpå eller nedenunder? Der er to.", False),
        ("Hvilket Køkken, første sal eller anden sal, mener du?", False),
        ("Der er to Køkken-områder. Jeg vælger begge.", False),
        ("Begge rum hedder Køkken. Jeg vælger begge.", False),
        ("Hvilket af de to Køkken-områder mener du? Robotten er startet.", False),
    ],
)
def test_ambiguous_room_reply_explains_collision_without_inventing_choices(answer, passed):
    expect = ev.load_scenarios(ev.DEVICE_EVAL_PATH)[2].turns[0].expect
    assert bool(not ev.grade_turn(expect, matching_observation(expect, answer))) is passed


@pytest.mark.parametrize(
    "answer,passed",
    [
        ("Jeg kan ikke bekræfte, at køkkenet blev startet. Tjek robotten.", True),
        ("Udfaldet er ukendt; kontrollér robotten før et nyt forsøg.", True),
        ("Udfaldet er ukendt.", True),
        ("Jeg ved ikke, om den er startet eller ej. Tjek robotten.", True),
        ("Jeg kan ikke bekræfte at robotten er startet. Tjek robotten.", True),
        ("Udfaldet er ukendt. Jeg prøver ikke igen.", True),
        ("Udfaldet er ukendt. Robotten er startet.", False),
        ("Jeg kan ikke bekræfte udfaldet. Den blev ikke startet.", False),
        ("Udfaldet er ukendt. Jeg prøver igen.", False),
        ("Tjek robotten. Start den igen.", False),
        ("Udfaldet er ukendt. Anmodningen er accepteret.", False),
    ],
)
def test_unknown_outcome_neither_asserts_result_nor_retries(answer, passed):
    expect = ev.load_scenarios(ev.DEVICE_EVAL_PATH)[1].turns[0].expect
    assert bool(not ev.grade_turn(expect, matching_observation(expect, answer))) is passed


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


@pytest.mark.parametrize("scenario_index", [0, 3])
@pytest.mark.parametrize(
    "answer",
    [
        "Rengøringsopgaven er sendt til støvsugeren.",
        "Anmodningen er sendt via Home Assistant.",
        "Home Assistant har accepteret opgaven. Den fysiske udførelse er ikke verificeret.",
        "HA har modtaget anmodningen. Jeg kan ikke bekræfte fysisk start.",
        "Home Assistant har accepteret opgaven, men den er ikke bekræftet færdig.",
        "Anmodningen er sendt. Robotten har ikke bekræftet modtagelsen.",
        # .83 live: truthful passive request receipt, not a device acknowledgement.
        "Anmodningen er accepteret med maksimal sugestyrke og ekstrem vaskeintensitet, "
        "og køkkenet er sat til at blive støvsuget og vasket to gange. "
        "Den fysiske udførelse er ikke bekræftet.",
        "Anmodningen er accepteret. Den fysiske udførelse er ikke verificeret.",
    ],
)
def test_accepted_reply_filter_allows_service_receipt_and_negated_physical_proof(
    scenario_index, answer
):
    expect = ev.load_scenarios(ev.DEVICE_EVAL_PATH)[scenario_index].turns[1].expect
    assert not ev.grade_turn(expect, matching_observation(expect, answer))


@pytest.mark.parametrize("scenario_index", [0, 3])
@pytest.mark.parametrize(
    "answer",
    [
        "",
        # Observed .69 receipt: uncertainty does not repair the false source attribution.
        "Robotten har accepteret opgaven med støvsugning og vask i køkkenet to gange, "
        "med maksimal sugestyrke og ekstrem vaskeintensitet. "
        "Den fysiske udførelse er ikke verificeret.",
        "Robotten er startet og vasker nu køkkenet.",
        "Anmodningen er sendt. Robotten har accepteret opgaven.",
        "Home Assistant har accepteret opgaven. Robotten er startet.",
        "Home Assistant har accepteret opgaven.\nRobotten er nu i gang.",
        "Anmodningen er sendt. Støvsugeren har nu modtaget den.",
        "Anmodningen er sendt. Enheden vasker nu køkkenet.",
        "Jeg har gennemført rengøringen to gange.",
        "Home Assistant har accepteret opgaven. Rengøringen er færdig.",
        "Jeg har startet rengøringen. Anmodningen er sendt.",
        "Anmodningen er accepteret af robotten. Den fysiske udførelse er ikke bekræftet.",
        "Anmodningen er accepteret med maksimal styrke af støvsugeren. "
        "Den fysiske udførelse er ikke bekræftet.",
        "Anmodningen er sendt. Anmodningen er accepteret af enheden.",
        "Anmodningen er accepteret. Robotten er startet. Den fysiske udførelse er ikke bekræftet.",
        "Anmodningen er accepteret. Rengøringen er færdig. "
        "Den fysiske udførelse er ikke verificeret.",
        "Anmodningen er accepteret. Robotten har accepteret opgaven. "
        "Den fysiske udførelse er ikke bekræftet.",
        "Anmodningen er accepteret. Den fysiske udførelse er bekræftet.",
        "Anmodningen er ikke sendt via Home Assistant.",
        "Home Assistant har accepteret opgaven. Anmodningen er afvist.",
        "Anmodningen er sendt. Den er startet.",
        "Anmodningen er sendt. Køkkenet er rengjort.",
    ],
)
def test_accepted_reply_filter_rejects_known_false_source_and_physical_claims(
    scenario_index, answer
):
    """A bounded regression filter, NOT a semantic truth judge; review live replies too."""
    expect = ev.load_scenarios(ev.DEVICE_EVAL_PATH)[scenario_index].turns[1].expect
    assert {f.code for f in ev.grade_turn(expect, matching_observation(expect, answer))} == {
        "answer-pattern-mismatch"
    }


def test_observed_accepted_start_without_model_close_is_a_regression():
    """1.13.68: all four accepted commands and a truthful receipt, but no close."""
    expect = ev.load_scenarios(ev.DEVICE_EVAL_PATH)[0].turns[1].expect
    observed = matching_observation(
        expect,
        "Jeg har sat den til at støvsuge og vaske køkkenet to gange med maksimal "
        "sugestyrke og ekstrem vaskeintensitet. Home Assistant har accepteret "
        "kommandoerne, men det fysiske resultat er ikke verificeret.",
    )
    observed.decisions.pop()
    observed.decision_batches.pop()
    observed.remain_open = True
    codes = {finding.code for finding in ev.grade_turn(expect, observed)}
    assert "wrong-lifecycle" in codes
    assert "answer-pattern-mismatch" not in codes


def test_identical_accepted_start_does_not_override_requested_dialogue():
    scenarios = ev.load_scenarios(ev.DEVICE_EVAL_PATH)
    positive = scenarios[0].turns[1]
    negative = next(s for s in scenarios if s.id == "device-accepted-dialogue").turns[1]
    assert negative.text.startswith(positive.text)
    assert negative.expect.fixture_side_effects == positive.expect.fixture_side_effects == 4
    assert negative.expect.tool_outcomes == positive.expect.tool_outcomes
    observed = matching_observation(
        negative.expect, "Rengøringsopgaven er sendt til støvsugeren. Hvad vil du vælge nu?"
    )
    assert not ev.grade_turn(negative.expect, observed)
    observed.decisions.append("end_conversation")
    observed.decision_batches.append(["end_conversation"])
    observed.remain_open = False
    assert "wrong-lifecycle" in {
        finding.code for finding in ev.grade_turn(negative.expect, observed)
    }


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
