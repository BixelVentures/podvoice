"""Selector-enabled actual Live → Thin → receipt contract; no external I/O."""

import asyncio
import json
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from integration.test_presentation_live_pipeline import assistant_item
from integration.test_thin_live import build, emit, until
from unit.test_openai_live import call, created, terminal
from unit.test_podview_presentation import CONTENTS, message
from unit.test_weather_result import weather_payload

from gatekeeper.podview_receipts import VisualReceiptOwner


@pytest.mark.parametrize("family", CONTENTS)
@pytest.mark.parametrize("selector_outcome", ["held", "accept", "deny", "budget_none"])
async def test_delegated_tool_final_owns_format_with_optional_selector_enabled(
    family, selector_outcome
):
    session, sdk, _, tools, _ = build()
    store = tools.podview_receipts = VisualReceiptOwner()
    release = asyncio.Event()

    async def select(content, **kwargs):
        if selector_outcome == "held":
            await release.wait()
        if selector_outcome in {"deny", "budget_none"}:
            return None
        return {"family": "fact-card", "content": content}

    selector = AsyncMock()
    selector.select.side_effect = select
    store.configure_selector(selector)
    tool = "weather_forecast"
    tools.declarations = lambda: [
        {
            "name": tool,
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        }
    ]
    weather = weather_payload(1)
    stamp = datetime.now(UTC)
    weather["data"]["result"].update(
        retrieved_at=stamp.isoformat(), state_updated_at=stamp.isoformat()
    )
    weather["data"]["result"]["forecast"][0]["datetime"] = (stamp + timedelta(hours=1)).isoformat()

    async def dispatch(*args, **kwargs):
        return weather

    tools.dispatch = dispatch
    await session.start()
    try:
        await session.wake()
        if family == "sourced-image":
            await session.submit_text(
                "Hvordan virker cyklens kæde og pedaler?", command_id="bike-input"
            )
        initial_creates = sdk.response.create.await_count
        await emit(sdk, created(), call(name=tool, arguments="{}"), terminal())
        await until(
            lambda: (
                sdk.response.create.await_count == initial_creates + 1
                and bool(store._rooms.get(session.room, {}).get("source_registry"))
            )
        )
        data = message(family)
        if family in {"fact-card", "chart"}:
            data["presentation"].update(
                origin="owner_sources",
                sourceCalls=["c1"],
                content=(
                    {"facts": [{"callId": "c1", "field": "temperature"}]}
                    if family == "fact-card"
                    else {"items": [{"callId": "c1", "field": "temperature"}]}
                ),
            )
        await emit(sdk, created("r2"), assistant_item(json.dumps(data)), terminal("r2"))
        await until(lambda: session.brain.backend_sequence >= 2 and not session.brain._responses)
        rows = store.snapshot(session.room, session)["items"]
        assert any(
            row.get("schema") == "podview.presentation.v1" and row["family"] == family
            for row in rows
        )
        selector.select.assert_not_awaited()
        assert store._selection is None
        assert sdk.response.create.await_count == initial_creates + 1
        assert rows[0]["allowedActions"] == [] and rows[0]["taskId"] == "answer:d1"
    finally:
        release.set()
        store.close()
        await session.aclose()


@pytest.mark.parametrize(
    "delegation,task",
    [(None, "answer:turn"), ("", "answer:"), ("other", "answer:turn"), ("x" * 161, "answer:turn")],
)
async def test_unbound_receipt_retains_optional_selector(delegation, task):
    from unit.test_podview_receipts import offer

    selector = AsyncMock()
    selector.select.side_effect = lambda data, **kwargs: {"family": "fact-card", "content": data}
    store = VisualReceiptOwner()
    store.configure_selector(selector)
    try:
        assert offer(store, delegation_id=delegation, task_id=task)
        assert store._selection is not None
        await store._selection
        selector.select.assert_awaited_once()
        assert store.snapshot("kitchen")["items"][0]["displaySuggested"] is True
    finally:
        store.close()


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
async def test_configured_selector_does_not_bypass_provider_final_guards(mutation, monkeypatch):
    from integration import test_presentation_live_pipeline as pipeline

    def configured_store():
        store = VisualReceiptOwner()
        selector = AsyncMock()
        selector.select.return_value = None
        store.configure_selector(selector)
        return store

    monkeypatch.setattr(pipeline, "VisualReceiptOwner", configured_store)
    await pipeline.test_actual_provider_terminal_rejects_ambiguous_unfinished_or_stale_messages(
        mutation
    )


async def test_research_opt_in_web_receipt_uses_normal_final_without_selector(monkeypatch):
    from integration import test_presentation_live_pipeline as pipeline

    selector = AsyncMock()
    selector.select.side_effect = AssertionError("delegated source must use its normal final")

    def configured_store():
        store = VisualReceiptOwner()
        store.configure_selector(selector)
        store.configure_research_mode("completed_receipts_v1")
        return store

    monkeypatch.setattr(pipeline, "VisualReceiptOwner", configured_store)
    await pipeline.test_actual_accepted_tool_then_different_response_same_delegation_preserves_source_and_no_extra_continuation()
    selector.select.assert_not_awaited()
