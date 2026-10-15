"""Actual Thin submission and ingress receipt boundaries, with offline providers."""

import asyncio
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_bridge import owner
from integration.test_thin import LiveFake, _build, _build_talk_session, _wait_until
from integration.test_thin_live import build, emit, until
from unit.test_openai_live import call, created, terminal
from unit.test_podview_receipts import offer, selected_store

from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE
from gatekeeper.podview_enrichment import MODEL, RequestAllowance, VisualSelector
from gatekeeper.podview_receipts import VisualReceiptOwner
from gatekeeper.provider_budget import ProviderBudgetCoordinator
from gatekeeper.voice import ToolCall, ToolRoundComplete, UserSpeechStopped
from gatekeeper.web import create_app


@pytest.mark.parametrize("surface", ["voicepe", "talk", "live"])
@pytest.mark.parametrize(
    "outcome",
    [
        "current",
        "normal_close",
        "privacy_close",
        "error_close",
        "next_input",
        "failed",
        "session",
        "revision",
        "sink_failed",
    ],
)
async def test_receipts_follow_actual_successful_current_submission(surface, outcome):
    store = selected_store()
    entered, release, completed = asyncio.Event(), asyncio.Event(), asyncio.Event()
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
            "name": "google_web_sogning",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        }
    ]

    async def dispatch(*args, **kwargs):
        return {"ok": True, "data": 2004}

    tools.dispatch = dispatch
    if surface != "live":
        provider.take_submitted_tool_results = lambda: provider.sent_tool_results[-1]
    original = provider.send_tool_results

    async def send(*args, **kwargs):
        entered.set()
        await release.wait()
        if outcome == "failed":
            completed.set()
            raise RuntimeError("offline submission failed")
        result = await original(*args, **kwargs)
        completed.set()
        return result

    provider.send_tool_results = send
    if outcome == "sink_failed":

        def broken(*args, **kwargs):
            raise RuntimeError("optional sink failed")

        store.offer = broken
    await session.start()
    try:
        await session.wake()
        if surface == "live":
            await emit(sdk, created(), call(name="google_web_sogning", arguments="{}"), terminal())
        else:
            provider.emit(
                UserSpeechStopped(),
                ToolCall(
                    "call",
                    "google_web_sogning",
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
        assert store.snapshot("kitchen")["items"] == []
        if outcome == "session":
            session._history_session = "replacement"
        elif outcome == "revision":
            if surface == "live":
                session._live_input_revision += 1
            else:
                session._closure_turn.superseded = True
        release.set()
        await asyncio.wait_for(completed.wait(), 2)
        if surface == "live":
            await until(lambda: not session._tool_tasks)
        else:
            await _wait_until(lambda: not session._tool_tasks)
        if store._selection is not None:
            await store._selection
        items = store.snapshot("kitchen")["items"]
        assert bool(items) is (
            outcome in {"current", "normal_close", "privacy_close", "error_close", "next_input"}
        ), getattr(provider, "sent_tool_results", "live")
        if items:
            assert items[0]["content"]["facts"][0]["value"] == "2004"
            assert items[0]["sessionId"] == session._history_session
            if outcome == "next_input":
                if surface == "live":
                    session._live_input_revision += 1
                else:
                    session._closure_turn.superseded = True
                assert store.snapshot("kitchen")["items"] == []
            await session.stop(
                reason={
                    "normal_close": "model-close",
                    "privacy_close": "privacy",
                    "error_close": "error:connection",
                }.get(outcome, "stop")
            )
            retained = store.snapshot("kitchen")
            assert bool(retained["items"]) is (outcome == "normal_close")
            if outcome == "normal_close":
                assert retained["readOnlyCompleted"] is True
                app = create_app(StatusHub(), {"kitchen": session}, tools=tools)
                # Actual bridge shape after voice closes: no live session identity.
                snapshot = app[BRIDGE].snapshot("kitchen")
                assert snapshot["voice"]["sessionId"] is None
                assert snapshot["answers"]["sessionId"] == items[0]["sessionId"]
                assert snapshot["answers"]["readOnlyCompleted"] is True
                await session.wake()
                assert store.snapshot("kitchen")["items"] == []
        if outcome == "sink_failed":
            assert session._active  # Presentation failure cannot close the conversation.
    finally:
        release.set()
        await session.aclose()


async def test_actual_ingress_answers_sources_context_room_and_expiry():
    session, _ = owner()
    alive = [True]
    store = selected_store()
    assert offer(store, owner=session, session_id="s1", current=lambda: alive[0])
    await store._selection
    tools = SimpleNamespace(podview_receipts=store)
    app = create_app(StatusHub(), {"kitchen": session, "bedroom": owner()[0]}, tools=tools)
    async with TestClient(TestServer(app)) as client:
        snapshot = await (await client.get("/view/api/snapshot?room=kitchen")).json()
        assert snapshot["capabilities"]["answerRead"] is True
        answers = await (await client.get("/view/api/answers?room=kitchen")).json()
        item = answers["items"][0]
        assert snapshot["answers"] == {
            "revision": answers["revision"],
            **{key: item[key] for key in ("sessionId", "turnId", "taskId", "inputRevision")},
        }
        path = "/view/api/sources/" + item["receiptId"]
        source = await client.get(path + "?room=kitchen")
        assert source.headers["Cache-Control"] == "no-store"
        assert (await source.json())["externalSourcesProvided"] is False
        assert (await client.get(path + "?room=bedroom")).status == 404
        assert (await client.get(path + "?room=unknown")).status == 404
        assert (
            await client.get(path + "?room=kitchen", headers={"Sec-Fetch-Site": "cross-site"})
        ).status == 403
        assert (await client.get("/view/api/sources/not-an-id?room=kitchen")).status == 404
        alive[0] = False
        assert (await client.get(path + "?room=kitchen")).status == 404
        newer = await (await client.get("/view/api/snapshot?room=kitchen")).json()
        assert newer["answers"]["revision"] > snapshot["answers"]["revision"]
        assert newer["answers"]["sessionId"] is None
        assert newer["revision"] > snapshot["revision"]
    assert not offer(store)  # Real application cleanup closes the optional owner.


async def test_replaced_session_object_cannot_keep_old_receipt_even_if_old_active():
    session, _ = owner()
    store = selected_store()
    assert offer(store, owner=session, session_id="s1")
    await store._selection
    app = create_app(
        StatusHub(), {"kitchen": session}, tools=SimpleNamespace(podview_receipts=store)
    )
    async with TestClient(TestServer(app)) as client:
        old = await (await client.get("/view/api/answers")).json()
        receipt = old["items"][0]["receiptId"]
        app[BRIDGE].sessions["kitchen"] = owner()[0]
        assert session._active
        assert (await (await client.get("/view/api/answers")).json())["items"] == []
        assert (await client.get("/view/api/sources/" + receipt)).status == 404


async def test_real_native_provider_receipt_requires_matching_item_ack_and_generation():
    from integration.test_thin import _AdapterQueueWS

    from gatekeeper.openai_realtime import OpenAIRealtimeSession

    brain = OpenAIRealtimeSession(api_key="fixture")
    results = [
        {"id": "answer", "name": "google_web_sogning", "response": {"ok": True, "data": 2004}}
    ]
    assert await brain.send_tool_results(results) is False
    assert brain.take_submitted_tool_results() == []
    ws = _AdapterQueueWS()
    brain._ws = ws
    brain._active_response = True
    brain._cancelled_tool_calls.add("answer")
    assert await brain.send_tool_results(results) is False
    assert brain.take_submitted_tool_results() == []
    assert ws.sent == []

    async def receive():
        async for _ in brain.events():
            pass

    reader = asyncio.create_task(receive())
    submission = asyncio.create_task(brain.send_tool_results(results))
    try:
        await _wait_until(lambda: bool(ws.sent))
        assert brain.take_submitted_tool_results() == []
        assert not submission.done()
        await ws.emit({"type": "conversation.item.added", "item": ws.sent[0]["item"]})
        assert await submission is False  # Existing speech-continuation return semantics unchanged.
        assert brain.take_submitted_tool_results() == results
        assert brain.take_submitted_tool_results() == []
        submission = asyncio.create_task(brain.send_tool_results(results))
        await _wait_until(lambda: len(ws.sent) == 2)
        await ws.emit({"type": "conversation.item.added", "item": ws.sent[1]["item"]})
        await submission
        brain._connection_generation += 1
        assert brain.take_submitted_tool_results() == []
    finally:
        submission.cancel()
        reader.cancel()
        await asyncio.gather(submission, reader, return_exceptions=True)
        await brain.close()


@pytest.mark.parametrize("mixed", [False, True])
async def test_native_receipt_plain_output_cannot_interrupt_exact_ack_bookkeeping(mixed):
    import json

    from integration.test_thin import _AdapterQueueWS

    from gatekeeper.openai_realtime import OpenAIRealtimeSession

    brain = OpenAIRealtimeSession(api_key="fixture")
    ws = _AdapterQueueWS()
    brain._ws = ws
    results = [{"id": "plain", "name": "google_web_sogning", "response": "plain result"}]
    if mixed:
        results.append(
            {
                "id": "catalog",
                "name": "podconnect_get_targets",
                "response": {"data": "x" * 3000},
            }
        )
    brain._outstanding_tool_calls.update(result["id"] for result in results)
    brain._tool_call_result_limits = {result["id"]: 4096 for result in results}
    continuations = []

    async def continuation():
        assert not brain._outstanding_tool_calls
        assert not brain._tool_call_result_limits
        continuations.append(True)

    brain._create_tool_result_response = continuation

    async def receive():
        async for _ in brain.events():
            pass

    reader = asyncio.create_task(receive())
    submission = asyncio.create_task(brain.send_tool_results(results))
    try:
        await _wait_until(lambda: len(ws.sent) == len(results))
        assert not submission.done()
        assert brain._outstanding_tool_calls == {result["id"] for result in results}
        for sent in ws.sent:
            await ws.emit({"type": "conversation.item.added", "item": sent["item"]})
        assert await submission is False
        assert continuations == [True]
        receipt = brain.take_submitted_tool_results()
        if mixed:
            assert len(ws.sent[1]["item"]["output"].encode()) > 2048
            assert receipt == [{**results[1], "response": json.loads(ws.sent[1]["item"]["output"])}]
        else:
            assert receipt == []
        assert brain.take_submitted_tool_results() == []
    finally:
        submission.cancel()
        reader.cancel()
        await asyncio.gather(submission, reader, return_exceptions=True)
        await brain.close()


@pytest.mark.parametrize("decision", ["disabled", "decline", "timeout", "refusal"])
async def test_ingress_does_not_export_unselected_answers_or_sources(decision):
    from unittest.mock import AsyncMock

    session, _ = owner()
    store = VisualReceiptOwner()
    if decision != "disabled":
        selector = AsyncMock()
        selector.select.return_value = None
        if decision == "timeout":
            selector.select.side_effect = TimeoutError("bounded provider timeout")
        store.configure_selector(selector)
    assert offer(store, owner=session, session_id="s1")
    receipt = store._rooms["kitchen"]["items"][0]["item"]["receiptId"]
    if store._selection is not None:
        await store._selection
    app = create_app(
        StatusHub(), {"kitchen": session}, tools=SimpleNamespace(podview_receipts=store)
    )
    async with TestClient(TestServer(app)) as client:
        answers = await (await client.get("/view/api/answers")).json()
        assert answers["items"] == []
        assert (await client.get("/view/api/sources/" + receipt)).status == 404
        snapshot = await (await client.get("/view/api/snapshot")).json()
        assert snapshot["answers"]["sessionId"] is None


async def test_actual_live_completed_query_selects_exact_whole_source_unit_and_renders(tmp_path):
    session, sdk, _, tools, _ = build()
    query = "Hvilken mulighed tager 35 minutter?"
    first, relevant = "Første mulighed tager 12 minutter.", "Anden mulighed tager 35 minutter."
    dispatched, model_requests = [], []
    dispatched_event = asyncio.Event()
    store = VisualReceiptOwner()

    def respond(request):
        body = json.loads(request.content)
        supplied = json.loads(body["input"][1]["content"])
        assert supplied["queryContext"] == {"tool": "google_web_sogning", "query": query}
        assert supplied["summary"] == query
        assert [fact["value"] for fact in supplied["facts"]] == [first, relevant]
        model_requests.append(body)
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": json.dumps(
                                    {"show": True, "fact_ids": [supplied["facts"][1]["id"]]}
                                ),
                            }
                        ],
                    }
                ],
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        store.configure_selector(
            VisualSelector(
                client,
                "synthetic-key",
                MODEL,
                allowance=RequestAllowance.prepare(tmp_path / "budget", 1),
                budget=ProviderBudgetCoordinator(),
            )
        )
        store.configure_research_mode("completed_receipts_v1")
        tools.podview_receipts = store
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

        async def dispatch(name, args, **kwargs):
            dispatched.append((name, args))
            dispatched_event.set()
            return {
                "ok": True,
                "data": {"success": True, "result": {"output": first + " " + relevant}},
            }

        tools.dispatch = dispatch
        await session.start()
        try:
            await session.wake()
            await emit(
                sdk,
                created(),
                call(name="google_web_sogning", arguments=json.dumps({"query": query})),
                terminal(),
            )
            await asyncio.wait_for(dispatched_event.wait(), 2)
            await until(lambda: not session._tool_tasks)
            if store._selection is not None:
                await store._selection
            assert dispatched == [("google_web_sogning", {"query": query})]
            assert len(model_requests) == 1
            answers = store.snapshot("kitchen")
            assert len(answers["items"]) == 1
            assert [fact["value"] for fact in answers["items"][0]["content"]["facts"]] == [relevant]
            await session.stop(reason="model-close")
            answers = store.snapshot("kitchen")
            app = create_app(StatusHub(), {"kitchen": session}, tools=tools)
            snapshot = app[BRIDGE].snapshot("kitchen")
            assert snapshot["voice"]["sessionId"] is None
            assert snapshot["answers"]["readOnlyCompleted"] is True
            helper = Path(__file__).parents[1] / "podview/helpers/render-owned-visual.mjs"
            result = await asyncio.to_thread(
                subprocess.run,
                ["node", str(helper)],
                input=json.dumps(
                    {
                        "answers": answers,
                        "snapshot": snapshot,
                        "now": __import__("time").time() * 1000,
                        "expectedQuery": query,
                        "expectedValue": relevant,
                    }
                ),
                text=True,
                capture_output=True,
            )
            assert result.returncode == 0, result.stderr
            assert json.loads(result.stdout)["actions"] == []
        finally:
            await session.aclose()
            await store.aclose()


@pytest.mark.parametrize("surface", ["voicepe", "talk", "live"])
@pytest.mark.parametrize("close_kind", ["normal", "stop", "privacy", "error:connection"])
@pytest.mark.parametrize("seal_first", [False, True])
async def test_visual_reads_follow_synchronous_close_barrier(
    monkeypatch, surface, close_kind, seal_first
):
    """Read/source revocation must precede awaited device teardown and close-task reuse."""
    import sys

    hooks = sys.modules[__name__]
    builder_name = {"voicepe": "_build", "talk": "_build_talk_session", "live": "build"}[surface]
    original = getattr(hooks, builder_name)

    def wrapped(*args, **kwargs):
        result = original(*args, **kwargs)
        session = result[0]
        silence_entered, release_silence = asyncio.Event(), asyncio.Event()
        actual_silence = session._silence_device

        async def silence():
            silence_entered.set()
            await release_silence.wait()
            await actual_silence()

        session._silence_device = silence

        async def stop(reason="stop"):
            store = session.tools.podview_receipts
            items = store.snapshot("kitchen")["items"]
            assert items
            receipt = items[0]["receiptId"]
            first = "model-close" if seal_first or close_kind == "normal" else close_kind
            task = session._request_close(
                first, error_kind="connection" if first == "error:connection" else None
            )
            try:
                await asyncio.wait_for(silence_entered.wait(), 2)
                assert session._active and session._transport_closing
                if seal_first:
                    assert store.snapshot("kitchen")["items"]
                    assert store.source("kitchen", receipt) is not None
                    second = "model-close" if close_kind == "normal" else close_kind
                    assert (
                        session._request_close(
                            second,
                            error_kind="connection" if second == "error:connection" else None,
                        )
                        is task
                    )
                expected = close_kind == "normal"
                assert bool(store.snapshot("kitchen")["items"]) is expected
                assert (store.source("kitchen", receipt) is not None) is expected
            finally:
                release_silence.set()
                if task is not None:
                    await task
            assert bool(store.snapshot("kitchen")["items"]) is expected
            assert (store.source("kitchen", receipt) is not None) is expected
            # The reused base hook expects explicit-stop cleanup on return.
            store.revoke("kitchen", session, session._history_session, session._epoch)

        session.stop = stop
        return result

    monkeypatch.setattr(hooks, builder_name, wrapped)
    await test_receipts_follow_actual_successful_current_submission(surface, "current")
