from __future__ import annotations

import asyncio
import pathlib
import wave

import pytest

from gatekeeper.eval_harness import (
    EvalBudget,
    Finding,
    SafeEvalTools,
    TurnExpectation,
    TurnObservation,
    grade_turn,
    load_scenarios,
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
    assert {"continue_conversation", "end_conversation", "get_time"} <= decisions


def test_oracle_requires_exact_decision_answer_and_lifecycle():
    expected = TurnExpectation(
        decision="continue_conversation", answer_any=("84", "fireogfirs"), remain_open=True
    )
    good = TurnObservation(
        turn_id="t",
        session_id="s",
        decisions=["continue_conversation"],
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


async def test_safe_eval_router_never_dispatches_unknown_tools():
    tools = SafeEvalTools()
    assert {"continue_conversation", "end_conversation", "wait_for_user"} <= {
        declaration["name"] for declaration in tools.declarations()
    }
    assert (await tools.dispatch("get_time", {}))["ok"] is True
    refused = await tools.dispatch("unlock_front_door", {"entity": "lock.front"})
    assert refused == {
        "ok": False,
        "error_kind": "eval_tool_refused",
        "error": "Eval-harnessen nægter alle ikke-fixturerede værktøjer.",
    }
    assert tools.calls[-1][0] == "unlock_front_door"


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
                decisions=["continue_conversation"],
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
