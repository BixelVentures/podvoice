"""Actual Thin submission and ingress receipt boundaries, with offline providers."""

import asyncio
from types import SimpleNamespace

import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_bridge import owner
from integration.test_thin import LiveFake, _build, _build_talk_session, _wait_until
from integration.test_thin_live import build, emit, until
from unit.test_openai_live import call, created, terminal
from unit.test_podview_receipts import offer

from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE
from gatekeeper.podview_receipts import VisualReceiptOwner
from gatekeeper.voice import ToolCall, ToolRoundComplete, UserSpeechStopped
from gatekeeper.web import create_app


@pytest.mark.parametrize("surface", ["voicepe", "talk", "live"])
@pytest.mark.parametrize("outcome", ["current", "failed", "session", "revision", "sink_failed"])
async def test_receipts_follow_actual_successful_current_submission(surface, outcome):
    store = VisualReceiptOwner()
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
        items = store.snapshot("kitchen")["items"]
        assert bool(items) is (outcome == "current"), getattr(provider, "sent_tool_results", "live")
        if items:
            assert items[0]["content"]["facts"][0]["value"] == "2004"
            assert items[0]["sessionId"] == session._history_session
            await session.stop()
            assert store.snapshot("kitchen")["items"] == []
        if outcome == "sink_failed":
            assert session._active  # Presentation failure cannot close the conversation.
    finally:
        release.set()
        await session.aclose()


async def test_actual_ingress_answers_sources_context_room_and_expiry():
    session, _ = owner()
    alive = [True]
    store = VisualReceiptOwner()
    assert offer(store, owner=session, session_id="s1", current=lambda: alive[0])
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
    store = VisualReceiptOwner()
    assert offer(store, owner=session, session_id="s1")
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
