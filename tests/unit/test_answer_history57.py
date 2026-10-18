"""Immutable historical display is separate from current receipt authority."""

import asyncio
from types import SimpleNamespace

import pytest
from aiohttp.test_utils import make_mocked_request
from unit.test_podview_receipts import offer, selected_store

from gatekeeper.podview import BRIDGE, _answers


async def admit(store, owner, session="first", call="call"):
    assert offer(store, owner=owner, session_id=session, call_id=call)
    await store._selection
    return store.snapshot("kitchen", owner)["items"][0]


async def test_history_survives_expiry_and_new_session_but_exact_revoke_removes_old_only():
    now = [0.0]
    store = selected_store(clock=lambda: now[0])
    owner = object()
    first = await admit(store, owner)
    now[0] = 121
    assert store.snapshot("kitchen", owner)["items"] == []
    assert store.source("kitchen", first["receiptId"], owner) is None
    assert store.history("kitchen", owner)["items"][0]["receiptId"] == first["receiptId"]
    second = await admit(store, owner, "second")
    store.revoke("kitchen", owner, "first", 1)
    assert [r["receiptId"] for r in store.history("kitchen", owner)["items"]] == [
        second["receiptId"]
    ]
    store.complete("kitchen", owner, "second", 1)
    assert len(store.history("kitchen", owner)["items"]) == 1


async def test_pending_unselected_and_foreign_owner_are_never_historical():
    store = selected_store()
    owner = object()
    assert offer(store, owner=owner)
    assert store.history("kitchen", owner)["items"] == []
    await store._selection
    assert len(store.history("kitchen", owner)["items"]) == 1
    assert store.history("kitchen", object())["items"] == []
    assert store.history("kitchen", owner)["items"] == []


async def test_latest20_immutable_records_and_boot_close_bounds():
    store = selected_store()
    owner = object()
    store.bind_history_boot("boot")
    for n in range(22):
        await admit(store, owner, str(n))
    history = store.history("kitchen", owner)
    assert len(history["items"]) == 20
    assert set(history["items"][0]) == {
        "receiptId",
        "family",
        "title",
        "observedAt",
        "content",
        "provenance",
    }
    history["items"][0]["content"]["summary"] = "changed"
    assert store.history("kitchen", owner)["items"][0]["content"]["summary"] != "changed"
    store.bind_history_boot("next")
    assert store.history("kitchen", owner)["items"] == []
    await admit(store, owner, "new")
    store.close()
    assert store.history("kitchen", owner)["items"] == []


async def test_existing_route_history_boundary_and_source_stays_expired():
    now = [0.0]
    store = selected_store(clock=lambda: now[0])
    owner = object()
    row = await admit(store, owner)
    now[0] = 121
    bridge = SimpleNamespace(
        tools=SimpleNamespace(podview_receipts=store), sessions={"kitchen": owner}, boot_id="boot"
    )

    def request(path, headers=None, remote="127.0.0.1"):
        req = make_mocked_request("GET", path, headers=headers or {})
        req._cache["remote"] = remote
        req.app[BRIDGE] = bridge
        return req

    response = await _answers(request("/view/api/answers?room=kitchen&history=1"))
    assert response.status == 200
    import json

    result = json.loads(response.text)
    assert result["schema"] == "podview.answer-history.v1" and result["bootId"] == "boot"
    assert result["items"][0]["receiptId"] == row["receiptId"]
    assert response.headers["Cache-Control"] == "no-store"
    for path in [
        "?history=2",
        "?history=1&history=1",
        "?history=1&room=other",
        "?history=1&extra=1",
    ]:
        assert (await _answers(request("/view/api/answers" + path))).status >= 400
    assert (
        await _answers(request("/view/api/answers?history=1", {"Sec-Fetch-Site": "cross-site"}))
    ).status == 403
    assert (
        await _answers(request("/view/api/answers?history=1", remote="192.0.2.1"))
    ).status == 403
    assert len(store.history("kitchen", owner)["items"]) == 1


@pytest.mark.parametrize(
    "family",
    [
        "concise",
        "comparison",
        "choices",
        "chart",
        "steps",
        "checklist",
        "fact-card",
        "answer-timeline",
        "simple-diagram",
        "sourced-image",
    ],
)
def test_all10_final_typed_answers_keep_exact_content_after_owner_expiry(family, monkeypatch):
    import json
    import time
    from datetime import datetime

    from unit.test_podview_presentation import context, message
    from unit.test_weather_result import weather_payload

    from gatekeeper.podview_receipts import VisualReceiptOwner

    now = [0.0]
    sink = VisualReceiptOwner(clock=lambda: now[0])
    owner = object()
    payload = message(family)
    if family in {"fact-card", "chart"}:
        weather = weather_payload()
        stamp = datetime.fromisoformat(weather["data"]["result"]["retrieved_at"]).timestamp()
        monkeypatch.setattr(time, "time", lambda: stamp)
        args = context(owner)
        args.pop("message")
        args.pop("response_id")
        args.pop("question_context")
        assert sink.offer(**args, call_id="weather", tool_name="weather_forecast", result=weather)
        payload["presentation"].update(
            origin="owner_sources",
            sourceCalls=["weather"],
            content={
                "facts" if family == "fact-card" else "items": [
                    {"callId": "weather", "field": "temperature"}
                ]
            },
        )
    assert sink.offer_completed_answer(**context(owner, message=json.dumps(payload)))
    row = sink.snapshot("kitchen", owner)["items"][0]
    now[0] = 121
    assert sink.source("kitchen", row["receiptId"], owner) is None
    archived = sink.history("kitchen", owner)["items"][0]
    assert archived["content"] == row["content"]
    assert archived["observedAt"] == row["observedAt"]
    assert archived["family"] == family
    assert archived["provenance"] == {"kind": row["provenance"]["kind"]}


async def test_revoke_during_held_selector_does_not_publish_archive():
    from gatekeeper.podview_receipts import VisualReceiptOwner

    entered = asyncio.Event()
    release = asyncio.Event()

    async def select(data, **kwargs):
        entered.set()
        await release.wait()
        return {"content": data}

    sink = VisualReceiptOwner()
    sink.configure_selector(SimpleNamespace(available=True, select=select))
    owner = object()
    assert offer(sink, owner=owner)
    await entered.wait()
    sink.revoke("kitchen", owner, "session", 1)
    release.set()
    await sink._selection
    assert sink.history("kitchen", owner)["items"] == []


async def test_actual_bridge_snapshot_history_revision_survives_empty_owner_and_advances_on_revoke(
    tmp_path,
):
    from integration.test_podview_bridge import owner as owner_fixture

    from gatekeeper.podview import PodViewBridge

    session, _ = owner_fixture()
    sink = selected_store()
    tools = SimpleNamespace(podview_receipts=sink)
    bridge = PodViewBridge({"kitchen": session}, tools, assets=tmp_path)
    before = bridge.snapshot("kitchen")["answerHistoryRevision"]
    row = await admit(sink, session)
    shown = bridge.snapshot("kitchen")["answerHistoryRevision"]
    assert bridge.snapshot("kitchen")["answerHistoryReceiptIds"] == [row["receiptId"]]
    assert shown > before
    sink.revoke("kitchen", session, "first", 1)
    after = bridge.snapshot("kitchen")["answerHistoryRevision"]
    assert after > shown
    assert sink.history("kitchen", session)["items"] == []
    assert sink.source("kitchen", row["receiptId"], session) is None
    await admit(sink, session, "new")
    replacement = PodViewBridge({"kitchen": session}, tools, assets=tmp_path)
    assert replacement.boot_id != bridge.boot_id
    assert sink.history("kitchen", session)["items"] == []


async def test_archive_whole_record_bound_rejects_oversize_without_partial_truncation():
    sink = selected_store()
    owner = object()
    await admit(sink, owner)
    state = sink._rooms["kitchen"]
    import copy

    row = copy.deepcopy(state["items"][0]["item"])
    row["receiptId"] = "b" * 32
    row["content"]["summary"] = "ø" * 65536
    before = sink.history("kitchen", owner)
    sink._archive_display("kitchen", state, row)
    assert sink.history("kitchen", owner) == before


async def test_append_keeps_removal_epoch_but_eviction_and_exact_revoke_advance_it():
    sink = selected_store()
    owner = object()
    for n in range(20):
        await admit(sink, owner, str(n))
        assert sink.history("kitchen", owner)["removalRevision"] == 0
    before = sink.history("kitchen", owner)
    await admit(sink, owner, "20")
    evicted = sink.history("kitchen", owner)
    assert evicted["revision"] > before["revision"]
    assert evicted["removalRevision"] == 1 and len(evicted["items"]) == 20
    assert evicted["receiptIds"] == [row["receiptId"] for row in evicted["items"]]
    assert set(before["receiptIds"]) - set(evicted["receiptIds"]) == {before["receiptIds"][-1]}
    assert len(set(before["receiptIds"]) & set(evicted["receiptIds"])) == 19
    assert (
        sink.history("kitchen", owner, include_items=False)["receiptIds"] == evicted["receiptIds"]
    )
    sink.revoke("kitchen", object(), "20", 1)
    assert sink.history("kitchen", owner) == evicted
    sink.revoke("kitchen", owner, "20", 1)
    revoked = sink.history("kitchen", owner)
    assert revoked["removalRevision"] == 2 and len(revoked["items"]) == 19
    assert sink.history("kitchen", object())["removalRevision"] == 3
