"""The opt-in data gate uses production schemas/selection, synthetic source only."""

import asyncio
import hashlib
import json

import pytest

from gatekeeper import eval_harness as ev
from gatekeeper.data_result import select_track_result, tool_result_size
from gatekeeper.tools import ToolRouter


def snapshot():
    return ToolRouter._compose_declarations([], {"recently_played", "top_tracks", "liked"})


def test_data_manifest_admits_exact_production_schema_without_new_tools():
    scenarios = ev.load_scenarios(ev.DATA_EVAL_PATH)
    assert len(scenarios) == 6
    assert sum(len(s.turns) for s in scenarios) == 7
    admission = ev._admit_eval_tools(scenarios, snapshot(), fixture_path=ev.DATA_EVAL_PATH)
    for declaration in snapshot():
        assert declaration in admission.declarations
    assert len(admission.contracts) == 3
    assert not ev._capability_metadata(admission, scenarios)["profile_complete"]
    assert not any(s.id.startswith("data-") for s in ev.load_scenarios())


async def test_fixture_dispatch_runs_shipped_selector_and_refuses_unlisted_calls():
    scenarios = ev.load_scenarios(ev.DATA_EVAL_PATH)
    admission = ev._admit_eval_tools(scenarios, snapshot(), fixture_path=ev.DATA_EVAL_PATH)
    tools = ev.SafeEvalTools(
        admission.declarations,
        admitted_names=set(admission.contracts),
        fixture_contracts=admission.contracts,
    )
    for name, contract in admission.contracts.items():
        for case in contract.cases:
            result = await tools.dispatch(name, case.args)
            assert result == select_track_result(case.result["data"], case.args.get("limit", 5))
            assert tool_result_size(result) <= 2048
        assert (await tools.dispatch(name, {"limit": 2}))[
            "error_kind"
        ] == "eval_fixture_args_mismatch"
    assert (await tools.dispatch("HassMediaSearchAndPlay", {}))["error_kind"] == "eval_tool_refused"
    assert tools.fixture_side_effects == 0


async def test_data_profile_background_is_opt_in_and_cannot_approve_full_release(monkeypatch):
    service = ev.LiveEvalService()
    calls = []

    async def fake_run(**kwargs):
        calls.append(kwargs)
        return {
            "ok": True,
            "status": "complete",
            "selected_ok": True,
            "release_preflight_passed": False,
            "results": [],
        }

    monkeypatch.setattr(service, "run", fake_run)
    mixed = service.start(
        api_key="fixture",
        scenario_ids={ev.DATA_EVAL_PROFILE, "time-followup"},
        tool_declarations=snapshot(),
    )
    assert mixed["status"] == "invalid"
    response = service.start(
        api_key="fixture", scenario_ids={ev.DATA_EVAL_PROFILE}, tool_declarations=snapshot()
    )
    assert response["status"] == "running"
    await service._job
    assert calls[0]["_data_fixture"] is True
    assert calls[0]["scenario_ids"] is None
    assert calls[0]["tool_declarations"] == snapshot()
    report = service._reports_by_run_id[response["run_id"]]
    assert report["kind"] == ev.DATA_EVAL_PROFILE
    assert report["physical_result_verified"] is False
    assert report["release_preflight_passed"] is False


@pytest.mark.parametrize("limit", [None, 0, 51, "1"])
def test_manifest_case_args_remain_schema_valid(limit, tmp_path):
    raw = json.loads(ev.DATA_EVAL_PATH.read_text())
    raw["fixture_contracts"][0]["cases"][0]["args"] = {"limit": limit}
    path = tmp_path / "invalid.json"
    path.write_text(json.dumps(raw))
    with pytest.raises(ValueError, match="schema"):
        ev._admit_eval_tools(ev.load_scenarios(path), snapshot(), fixture_path=path)


@pytest.mark.parametrize(
    "scenario_id,answer,passed",
    [
        ("data-latest", "Din seneste sang var Nordlys af Testorkestret.", True),
        ("data-latest", "Nordlys af Testorkestret, men listen er afkortet og for stor.", False),
        ("data-five", "Nordlys, Morgenro, Sommerregn, Aftenlys og Havblik.", True),
        (
            "data-five",
            "Nordlys, Morgenro, Sommerregn, Aftenlys og Havblik, men listen er afkortet.",
            False,
        ),
        (
            "data-no-timestamps",
            "Jeg kan ikke se historikken for i går, fordi afspilningstidspunkter mangler.",
            True,
        ),
        ("data-no-timestamps", "Jeg kan kun se seneste sange uden præcise tidspunkter.", True),
        ("data-no-timestamps", "I går afspillede du Nordlys; du hørte ikke Morgenro.", False),
        ("data-no-timestamps", "Du hørte Nordlys i går, men nogle tidspunkter mangler.", False),
        (
            "data-no-play-counts",
            "Jeg kan ikke se, hvor mange gange du har afspillet Nordlys.",
            True,
        ),
        (
            "data-no-play-counts",
            "Jeg kan ikke se antallet af afspilninger; gentagelser er ikke med.",
            True,
        ),
        ("data-no-play-counts", "Du har afspillet Nordlys 22 gange, ikke 21.", False),
        (
            "data-no-play-counts",
            "Jeg kan ikke se hele historikken, men du har afspillet den toogtyve gange.",
            False,
        ),
    ],
)
def test_data_answer_oracle_rejects_reviewed_false_positives(scenario_id, answer, passed):
    scenario = next(s for s in ev.load_scenarios(ev.DATA_EVAL_PATH) if s.id == scenario_id)
    expect = scenario.turns[0].expect
    contracts = ev.load_fixture_contracts(ev.DATA_EVAL_PATH)
    observation = ev.TurnObservation(turn_id="one", session_id="same", answer=answer)
    for name, args in expect.tool_args.items():
        case = next(case for case in contracts[name].cases if case.args == args)
        observation.decisions.append(name)
        observation.tool_args[name] = [args]
        observation.tool_results[name] = [select_track_result(case.result["data"], args["limit"])]
    findings = ev.grade_turn(expect, observation)
    assert (not findings) is passed
    if not passed:
        assert any(finding.code == "answer-pattern-mismatch" for finding in findings)


def test_data_manifest_does_not_put_answer_text_in_tool_forbid_field():
    for scenario in ev.load_scenarios(ev.DATA_EVAL_PATH):
        for turn in scenario.turns:
            assert not turn.expect.forbid


@pytest.mark.parametrize(
    "change", [None, "model", "prompt_sha256", "production_tool_schema_sha256"]
)
def test_data_run_preserves_full_report_only_for_same_production_contract(change):
    service = ev.LiveEvalService()
    full = {
        "run_id": "full",
        "status": "complete",
        "release_preflight_passed": True,
        "prompt_sha256": "prompt",
        "production_tool_schema_sha256": "production",
        "reserved_tool_schema_sha256": "reserved",
        "eval_room_context_sha256": "room",
        "scenario_manifest_sha256": "default-manifest",
        "full_profile_tool_schema_sha256": "default-tools",
    }
    kwargs = {"model": "gpt-realtime-test", "voice": "marin"}
    service._retain_report(full, kwargs=kwargs, requested_full_profile=True)
    previous = dict(service._last_full_report)
    data = {
        **full,
        "run_id": "data",
        "kind": ev.DATA_EVAL_PROFILE,
        "release_preflight_passed": False,
        "scenario_manifest_sha256": "data-manifest",
        "full_profile_tool_schema_sha256": "data-tools",
    }
    if change == "model":
        kwargs["model"] = "different-model"
    elif change:
        data[change] = "changed"
    service._retain_report(data, kwargs=kwargs, requested_full_profile=False)
    if change is None:
        assert service._last_full_report == previous
        assert service._last_full_candidate_identity == previous["candidate_identity_sha256"]
    else:
        assert service._last_full_report is None
        assert service._last_full_candidate_identity is None
    assert service._reports_by_run_id["data"]["release_preflight_passed"] is False
    assert service._reports_by_run_id["full"] == previous


@pytest.mark.parametrize("terminal", ["blocked", "cancelled", "failed"])
@pytest.mark.parametrize("changed", [False, True])
async def test_data_terminal_paths_preserve_only_same_production_evidence(
    monkeypatch, terminal, changed
):
    service = ev.LiveEvalService()
    declarations = []  # Data admission must fail without PodConnect; no live call.
    kwargs = {
        "api_key": "fixture",
        "tool_declarations": declarations,
        "model": ev.DEFAULT_MODEL,
        "voice": ev.DEFAULT_VOICE,
    }
    full = {
        "run_id": "full",
        "status": "complete",
        "release_preflight_passed": True,
        "prompt_sha256": hashlib.sha256(ev.SYSTEM_PROMPT_DA.strip().encode()).hexdigest(),
        "production_tool_schema_sha256": ev._schema_sha256(
            ev.SafeEvalTools(declarations).declarations()
        ),
        "reserved_tool_schema_sha256": ev._schema_sha256(ev.RESERVED_DECLARATIONS),
        "eval_room_context_sha256": hashlib.sha256(ev.SAFE_EVAL_ROOM_CONTEXT.encode()).hexdigest(),
    }
    service._retain_report(full, kwargs=kwargs, requested_full_profile=True)
    previous = dict(service._last_full_report)
    if changed:
        kwargs["tool_declarations"] = snapshot()
        # Still force real early admission failure, now at the prompt boundary.
        kwargs["instructions"] = "x" * (ev.MAX_LIVE_EVAL_PROMPT_BYTES + 1)
    if terminal != "blocked":

        async def fail_run(**_kwargs):
            if terminal == "cancelled":
                raise asyncio.CancelledError
            raise RuntimeError("synthetic diagnostic failure")

        monkeypatch.setattr(service, "run", fail_run)
    operation = service._run_background(
        operation=ev.DATA_EVAL_PROFILE, run_id="data-terminal", **kwargs
    )
    if terminal == "cancelled":
        with pytest.raises(asyncio.CancelledError):
            await operation
    else:
        await operation
    report = service._reports_by_run_id["data-terminal"]
    assert report["status"] == terminal
    assert report["kind"] == ev.DATA_EVAL_PROFILE
    assert report["physical_result_verified"] is False
    assert not report.get("release_preflight_passed")
    assert service._last_full_report == (None if changed else previous)
    assert service._reports_by_run_id["full"] == previous
