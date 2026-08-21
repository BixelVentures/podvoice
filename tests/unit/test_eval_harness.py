from __future__ import annotations

import asyncio
import pathlib
import re
import wave

import pytest

import gatekeeper.eval_harness as eval_harness
from gatekeeper.eval_harness import (
    AudioReplayFixture,
    EvalBudget,
    Finding,
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


def test_core_scenarios_are_valid_and_cover_context_tools_and_close():
    scenarios = load_scenarios()
    assert {s.id for s in scenarios} == {
        "arithmetic-followup",
        "time-followup",
        "semantic-close",
        "web-routing",
    }
    assert any(len(s.turns) > 1 for s in scenarios)
    decisions = {turn.expect.decision for scenario in scenarios for turn in scenario.turns}
    assert {"end_conversation", "get_time"} <= decisions
    assert any(turn.expect.direct_answer for scenario in scenarios for turn in scenario.turns)


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
            answer=answer,
        )
        assert grade_turn(expected, observed) == []
    wrong_winner = TurnObservation(
        turn_id="turn",
        session_id="session",
        decisions=["google_web_sogning"],
        answer="Silkeborg vandt 2-0 over FCK.",
    )
    assert {finding.code for finding in grade_turn(expected, wrong_winner)} == {
        "answer-pattern-mismatch"
    }


def test_scenario_loader_rejects_an_invalid_answer_pattern(tmp_path: pathlib.Path):
    path = tmp_path / "invalid.json"
    path.write_text(
        '{"schema_version":1,"scenarios":[{"id":"broken","turns":['
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
    assert {"end_conversation", "wait_for_user"} <= {
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
    ]
    tools = SafeEvalTools(production)
    declarations = tools.declarations()
    assert declarations[0]["name"] == "HassDangerousWrite"
    assert [item["name"] for item in declarations].count("end_conversation") == 1
    assert declarations[-2]["parameters"]["additionalProperties"] is False


def test_budget_hard_stops_before_an_unbounded_live_run():
    budget = EvalBudget(max_turns=1, max_reserved_tokens=2048, max_actual_tokens=10)
    budget.reserve()
    budget.record({"input_text_tokens": 4, "output_audio_tokens": 4})
    with pytest.raises(RuntimeError, match="turn budget"):
        budget.reserve()
    with pytest.raises(RuntimeError, match="actual-token"):
        budget.record({"input_text_tokens": 3})


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

    result = await run_scenario(
        HungDriver(), scenario, run_id="run", budget=EvalBudget(), turn_timeout_s=0.01
    )
    assert result.passed is False
    assert isinstance(result.turns[0].findings[0], Finding)
    assert {f.code for f in result.turns[0].findings} >= {
        "not-accepted",
        "provider-error",
        "response-status",
    }


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


async def test_live_service_reports_the_exact_effective_prompt_identity(monkeypatch):
    async def fake_run(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        assert driver.instructions == "min aktive prompt"
        assert driver.model == "gpt-realtime-test"
        assert driver.voice == "marin"
        return ScenarioResult(scenario.id, True, "session", [])

    monkeypatch.setattr(eval_harness, "run_scenario", fake_run)
    report = await LiveEvalService().run(
        api_key="secret",
        scenario_ids={"web-routing"},
        model="gpt-realtime-test",
        voice="marin",
        instructions="min aktive prompt",
    )
    assert report["ok"] is True
    assert report["prompt_source"] == "custom"
    assert report["prompt_version"] is None
    assert len(report["prompt_sha256"]) == 64
    assert len(report["tool_schema_sha256"]) == 64
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
                "input_text_tokens": 16_000,
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
    )
    report = await service.run(
        api_key="secret",
        scenario_ids={"arithmetic-followup", "time-followup", "semantic-close"},
    )
    assert report["ok"] is True
    # 16k + the conservative 15k next-scenario reserve exceeds the 30k soft
    # window, so every following fresh session waits for a new minute.
    assert waits == [60.5, 60.5]
    assert report["budget"]["rate_limit_wait_s"] == 121.0
    assert report["budget"]["actual_tokens"] == 48_000


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
    service = LiveEvalService(sleep=fake_sleep, monotonic=lambda: clock[0])
    report = await service.run(
        api_key="secret", scenario_ids={"arithmetic-followup", "time-followup"}
    )
    assert report["ok"] is True
    # 25k eval ceiling leaves 15k of the 40k Tier-1 window for a measured
    # ordinary PodVoice session, so two fresh eval sessions cannot share a minute.
    assert waits == [60.5]


async def test_live_service_background_job_survives_requests_and_retains_result(monkeypatch):
    release = asyncio.Event()

    async def fake_run(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        await release.wait()
        return ScenarioResult(scenario.id, True, "session", [])

    monkeypatch.setattr(eval_harness, "run_scenario", fake_run)
    service = LiveEvalService()
    started = service.start(api_key="secret", scenario_ids={"web-routing"})
    assert started["status"] == "running"
    run_id = started["run_id"]
    assert service.status(run_id)["status"] == "running"

    duplicate = service.start(api_key="secret", scenario_ids={"web-routing"})
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
    service = LiveEvalService()
    started = service.start(api_key="secret", scenario_ids={"web-routing"})
    await asyncio.sleep(0)
    await service.aclose()
    report = service.status(started["run_id"])
    assert report["status"] == "cancelled"
    assert service.status()["status"] == "cancelled"


def test_live_service_rejects_mixed_known_and_unknown_scenarios():
    service = LiveEvalService()
    report = service.start(api_key="secret", scenario_ids={"web-routing", "not-a-real-scenario"})
    assert report["status"] == "invalid"
    assert service.status()["status"] == "idle"


async def test_live_service_whole_job_timeout_is_retained_as_failure(monkeypatch):
    async def hung_run(driver, scenario, *, run_id, budget, turn_timeout_s=20.0):
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    monkeypatch.setattr(eval_harness, "run_scenario", hung_run)
    service = LiveEvalService(max_run_s=0.01)
    started = service.start(api_key="secret", scenario_ids={"web-routing"})
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
    report = await LiveEvalService().run_replay(
        api_key="secret",
        fixture=fixture,
        scenario=scenario,
        turn_index=0,
        repeats=3,
        tool_declarations=declarations,
    )

    assert report["ok"] is True
    assert report["classification"] == "audio-replay-consistent"
    assert len(opened) == 4  # one text control + three independent audio sessions
    assert audio_seen == [pcm, pcm, pcm]
    assert report["trace"]["sha256"] == fixture.sha256
    assert all(trial["observation"]["diagnostic_transcript"] for trial in report["trials"])


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
    report = LiveEvalService().start_replay(
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
    report = await LiveEvalService().run_replay(
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
