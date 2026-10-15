"""Actual Thin completed tool result to direct-weather receipt, offline providers."""

import asyncio
from datetime import datetime

import pytest
from integration.test_thin import LiveFake, _build, _build_talk_session, _wait_until
from integration.test_thin_live import build, emit, until
from unit.test_openai_live import call, created, terminal
from unit.test_weather_result import weather_payload

from gatekeeper.podview_receipts import VisualReceiptOwner
from gatekeeper.voice import ToolCall, ToolRoundComplete, UserSpeechStopped


@pytest.mark.parametrize("surface", ["voicepe", "talk", "live"])
@pytest.mark.parametrize("outcome", ["normal", "failed_submit", "next_input"])
async def test_completed_structured_weather_actual_thin_submission(surface, outcome, monkeypatch):
    from gatekeeper import podview_weather

    payload = weather_payload()
    stamp = datetime.fromisoformat(payload["data"]["result"]["retrieved_at"]).timestamp()
    monkeypatch.setattr(podview_weather.time, "time", lambda: stamp)
    store = VisualReceiptOwner()
    if surface == "live":
        session, sdk, _, tools, _ = build()
        provider = session.live_brain
    else:
        provider = LiveFake()
        session = (_build_talk_session(provider) if surface == "talk" else _build(provider))[0]
        tools = session.tools
    tools.podview_receipts = store
    tools.declarations = lambda: [
        {
            "name": "weather_forecast",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        }
    ]

    async def dispatch(*a, **k):
        from gatekeeper.weather_result import compact_weather_result

        return compact_weather_result("weather_forecast", payload)

    tools.dispatch = dispatch
    if surface != "live":
        provider.take_submitted_tool_results = lambda: provider.sent_tool_results[-1]
    original = provider.send_tool_results
    entered = asyncio.Event()
    release = asyncio.Event()
    done = asyncio.Event()

    async def submit(*a, **k):
        entered.set()
        await release.wait()
        if outcome == "failed_submit":
            done.set()
            raise RuntimeError("synthetic failed submit")
        result = await original(*a, **k)
        done.set()
        return result

    provider.send_tool_results = submit
    await session.start()
    try:
        await session.wake()
        if surface == "live":
            await emit(sdk, created(), call(name="weather_forecast", arguments="{}"), terminal())
        else:
            provider.emit(
                UserSpeechStopped(),
                ToolCall(
                    "weather",
                    "weather_forecast",
                    {},
                    response_id="r1",
                    batch_id="r1",
                    batch_index=0,
                    batch_size=1,
                    generation=1,
                ),
                ToolRoundComplete("r1", generation=1),
            )
        await asyncio.wait_for(entered.wait(), 2)
        assert not store.snapshot("kitchen")["items"]
        if outcome == "next_input":
            if surface == "live":
                session._live_input_revision += 1
            else:
                session._closure_turn.superseded = True
        release.set()
        await asyncio.wait_for(done.wait(), 2)
        await (
            until(lambda: not session._tool_tasks)
            if surface == "live"
            else _wait_until(lambda: not session._tool_tasks)
        )
        items = store.snapshot("kitchen")["items"]
        assert bool(items) == (outcome == "normal")
        assert store._selection is None
        if items:
            assert items[0]["content"]["facts"][0]["value"] == "15.1 °C"
            await session.stop(reason="model-close")
            assert store.snapshot("kitchen")["readOnlyCompleted"] is True
            await session.wake()
            assert not store.snapshot("kitchen")["items"]
    finally:
        release.set()
        await session.aclose()
