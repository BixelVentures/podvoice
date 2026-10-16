"""Actual normal Live event→Thin owner→receipt wiring. Offline SDK, no audible claim."""

import asyncio
import json
import subprocess
import time
from pathlib import Path

import pytest
from integration.test_thin_live import build, emit, until
from unit.test_openai_live import created, envelope, terminal
from unit.test_podview_presentation import CONTENTS, message

from gatekeeper.podview_receipts import VisualReceiptOwner


def assistant_item(text, **updates):
    item = {
        "type": "message",
        "id": "message-one",
        "role": "assistant",
        "status": "completed",
        "content": [{"type": "output_text", "text": text, "annotations": []}],
    }
    item.update(updates)
    return envelope("response.output_item.done", item=item, output_index=0, sequence_number=2)


@pytest.mark.parametrize(
    "family", [family for family in CONTENTS if family not in {"fact-card", "chart"}]
)
async def test_actual_normal_completed_backend_path_publishes_each_canonical_format_without_extra_request(
    family,
):
    session, sdk, _, tools, _ = build()
    store = tools.podview_receipts = VisualReceiptOwner()
    await session.start()
    try:
        await session.wake()
        if family == "sourced-image":
            await session.submit_text(
                "Hvordan virker cyklens kæde og pedaler?", command_id="bike-input"
            )
        creates = sdk.response.create.await_count
        await emit(sdk, created(), assistant_item(json.dumps(message(family))), terminal())
        await until(lambda: bool(store.snapshot(session.room, session)["items"]))
        row = store.snapshot(session.room, session)["items"][0]
        assert row["family"] == family and row["allowedActions"] == []
        assert (
            row["taskId"] == "answer:d1"
            and row["providerGeneration"] == session.brain._connection_generation
        )
        assert sdk.response.create.await_count == creates
        assert not tools.calls and store._selector is None
        assert (
            "spoken" in session.brain.instructions
            or "spoken" in sdk.session.start.await_args.kwargs["session"]["instructions"]
        )
    finally:
        await session.aclose()


@pytest.mark.parametrize(
    "mutation",
    [
        "duplicate",
        "refusal",
        "nonassistant",
        "partial",
        "failed",
        "malformed",
        "oversize",
        "newinput",
    ],
)
async def test_actual_provider_terminal_rejects_ambiguous_unfinished_or_stale_messages(mutation):
    session, sdk, _, tools, _ = build()
    store = tools.podview_receipts = VisualReceiptOwner()
    await session.start()
    try:
        await session.wake()
        text = json.dumps(message())
        item = assistant_item(text)
        if mutation == "refusal":
            item["event"]["item"]["content"] = [{"type": "refusal", "refusal": "No"}]
        if mutation == "nonassistant":
            item["event"]["item"]["role"] = "user"
        if mutation == "partial":
            item["event"]["item"]["status"] = "in_progress"
        if mutation == "malformed":
            item = assistant_item("{bad}")
        if mutation == "oversize":
            item = assistant_item("x" * 2049)
        await emit(sdk, created(), item)
        if mutation == "duplicate":
            await emit(sdk, item)
        if mutation == "newinput":
            await until(lambda: bool(session._live_backend_revisions))
            session._live_input_revision += 1
        await emit(sdk, terminal(status="failed" if mutation == "failed" else "completed"))
        await until(lambda: session.brain.backend_sequence >= 1 and not session.brain._responses)
        assert not store.snapshot(session.room, session)["items"]
    finally:
        await session.aclose()


async def test_actual_accepted_tool_then_different_response_same_delegation_preserves_source_and_no_extra_continuation():
    from unit.test_openai_live import call

    session, sdk, _, tools, _ = build()
    store = tools.podview_receipts = VisualReceiptOwner()
    tools.declarations = lambda: [
        {
            "name": "google_web_sogning",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
                "additionalProperties": False,
            },
        }
    ]

    async def dispatch(*args, **kwargs):
        return {
            "ok": True,
            "data": {
                "success": True,
                "result": {"output": "En cykelkæde overfører kraft fra pedalerne til baghjulet."},
            },
        }

    tools.dispatch = dispatch
    await session.start()
    try:
        await session.wake()
        await emit(
            sdk,
            created(),
            call(
                name="google_web_sogning",
                arguments=json.dumps({"query": "Hvordan virker en cykelkæde?"}),
            ),
            terminal(),
        )
        await until(
            lambda: (
                sdk.response.create.await_count == 1
                and bool(store._rooms.get(session.room, {}).get("source_registry"))
            )
        )
        data = message("fact-card")
        data["presentation"].update(
            origin="owner_sources",
            sourceCalls=["c1"],
            content={"facts": [{"callId": "c1", "field": "excerpt:0"}]},
        )
        await emit(sdk, created("r2"), assistant_item(json.dumps(data)), terminal("r2"))
        await until(lambda: bool(store.snapshot(session.room, session)["items"]))
        row = store.snapshot(session.room, session)["items"][0]
        assert row["taskId"] == "answer:d1" and row["turnId"].endswith(":r1")
        assert row["provenance"]["kind"] == "owner_sources"
        assert (
            row["content"]["facts"][0]["value"]
            == "En cykelkæde overfører kraft fra pedalerne til baghjulet."
        )
        assert sdk.response.create.await_count == 1
    finally:
        await session.aclose()


@pytest.mark.parametrize("temperatures", [[15.1], [-5.2], [-5.2, 3.1], [-12.0, -5.2], [0.0]])
async def test_actual_accepted_weather_tool_projects_source_chart_without_model_numbers(
    temperatures,
):
    from datetime import UTC, datetime, timedelta

    from unit.test_openai_live import call
    from unit.test_weather_result import weather_payload

    session, sdk, _, tools, _ = build()
    store = tools.podview_receipts = VisualReceiptOwner()
    tools.declarations = lambda: [
        {
            "name": "weather_forecast",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        }
    ]
    weather_results = []
    stamp = datetime.now(UTC)
    for index, temperature in enumerate(temperatures):
        weather = weather_payload(1)
        weather["data"]["result"].update(
            retrieved_at=stamp.isoformat(),
            state_updated_at=stamp.isoformat(),
            temperature=temperature,
            location=f"Måling {index}",
        )
        weather["data"]["result"]["forecast"][0]["datetime"] = (
            stamp + timedelta(hours=1)
        ).isoformat()
        weather_results.append(weather)
    responses = iter(weather_results)

    async def dispatch(*args, **kwargs):
        return next(responses)

    tools.dispatch = dispatch
    await session.start()
    try:
        await session.wake()
        call_ids = [f"c{index}" for index in range(len(temperatures))]
        await emit(
            sdk,
            created(),
            *(
                call(call_id=call_id, name="weather_forecast", arguments="{}")
                for call_id in call_ids
            ),
            terminal(),
        )
        await until(
            lambda: (
                sdk.response.create.await_count == 1
                and bool(store._rooms.get(session.room, {}).get("source_registry"))
            )
        )
        data = message("chart")
        data["presentation"].update(
            origin="owner_sources",
            sourceCalls=call_ids,
            content={
                "items": [{"callId": call_id, "field": "temperature"} for call_id in call_ids]
            },
        )
        await emit(sdk, created("r2"), assistant_item(json.dumps(data)), terminal("r2"))
        await until(
            lambda: any(
                row.get("schema") == "podview.presentation.v1"
                for row in store.snapshot(session.room, session)["items"]
            )
        )
        row = store.snapshot(session.room, session)["items"][0]
        assert row["family"] == "chart"
        assert [item["value"] for item in row["content"]["items"]] == temperatures
        assert [item["label"] for item in row["content"]["items"]] == [
            f"Måling {i}" for i in range(len(temperatures))
        ]
        assert row["content"]["unit"] == "°C" and row["provenance"]["kind"] == "owner_sources"
        records = store._rooms[session.room]["source_registry"]
        assert row["provenance"]["receiptIds"] == [
            records[call_id]["item"]["receiptId"] for call_id in call_ids
        ]
        assert [
            records[call_id]["weather"]["data"]["current"]["temperature"] for call_id in call_ids
        ] == temperatures
        # Join actual accepted tools + normal final owner with shipped browser admission
        # and the existing pv-answer → pv-data-chart path. No provider/browser pixels.
        from gatekeeper.hub import StatusHub
        from gatekeeper.podview import BRIDGE
        from gatekeeper.web import create_app

        app = create_app(StatusHub(), {session.room: session}, tools=tools)
        snapshot = app[BRIDGE].snapshot(session.room)
        rendered = await asyncio.to_thread(
            subprocess.run,
            ["node", str(Path(__file__).parents[1] / "podview/helpers/render-owned-chart.mjs")],
            input=json.dumps(
                {
                    "answers": store.snapshot(session.room, session),
                    "snapshot": snapshot,
                    "now": time.time() * 1000,
                    "expectedValues": temperatures,
                }
            ),
            text=True,
            capture_output=True,
            timeout=10,
        )
        assert rendered.returncode == 0, rendered.stderr
        assert json.loads(rendered.stdout)["values"] == temperatures
        assert json.loads(rendered.stdout)["actions"] == []
        assert sdk.response.create.await_count == 1
    finally:
        await session.aclose()


@pytest.mark.parametrize(
    "inputs",
    [
        [],
        ["Lav italiensk tomatsuppe"],
        ["Hvordan virker cyklens kæde?", "Lav italiensk tomatsuppe"],
    ],
)
async def test_actual_image_context_uses_only_exact_current_user_input(inputs):
    session, sdk, _, tools, _ = build()
    store = tools.podview_receipts = VisualReceiptOwner()
    await session.start()
    try:
        await session.wake()
        for i, text in enumerate(inputs):
            await session.submit_text(text, command_id=f"current-{i}")
        payload = message("sourced-image")
        payload["presentation"].update(title="Cyklens pedaler", summary="Kæden driver baghjulet")
        await emit(sdk, created(), assistant_item(json.dumps(payload)), terminal())
        await until(lambda: bool(store.snapshot(session.room, session)["items"]))
        assert store.snapshot(session.room, session)["items"][0]["family"] == "concise"
        assert not tools.calls
    finally:
        await session.aclose()
