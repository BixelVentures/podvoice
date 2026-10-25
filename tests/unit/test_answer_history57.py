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


def transcript_request(
    bridge, query="?room=kitchen&history=segments", *, headers=None, remote="127.0.0.1"
):
    request = make_mocked_request("GET", "/view/api/answers" + query, headers=headers or {})
    request._cache["remote"] = remote
    request.app[BRIDGE] = bridge
    return request


async def test_saved_live_transcript_segments_are_read_without_completed_answer(tmp_path):
    import json

    from gatekeeper.history import History
    from gatekeeper.hub import StatusHub

    history = History(tmp_path / "history.jsonl")
    hub = StatusHub(history=history)
    for room, direction, text, ts, session, generation in [
        ("kitchen", "out", "Hello", 1, "first", 1),
        ("kitchen", "out", " there", 2, "first", 1),
        ("kitchen", "in", "Stop", 3, "first", 1),
        ("kitchen", "out", "Okay", 4, "first", 1),
        ("kitchen", "out", "Reconnect", 5, "first", 2),
        ("other", "out", "Foreign room", 6, "first", 2),
        ("talk", "out", "Talk text", 7, "first", 2),
        ("kitchen", "out", "Next wake", 8, "second", 1),
    ]:
        hub.transcript_fragment(
            room, direction, text, ts=ts, session=session, generation=generation
        )
    history.append("kitchen", "out", "Legacy turn", ts=9, session="second")
    restored = History(tmp_path / "history.jsonl")
    owner = object()
    sink = selected_store()
    bridge = SimpleNamespace(
        history=restored,
        tools=SimpleNamespace(podview_receipts=sink),
        sessions={"kitchen": owner},
        boot_id="boot",
    )
    before = await _answers(transcript_request(bridge, "?room=kitchen&history=1"))
    assert json.loads(before.text)["items"] == []
    response = await _answers(transcript_request(bridge))
    assert response.status == 200
    result = json.loads(response.text)
    assert set(result) == {"schema", "roomId", "bootId", "items"}
    assert result["schema"] == "podview.transcript-history.v1"
    assert result["roomId"] == "kitchen" and result["bootId"] == "boot"
    assert response.headers["Cache-Control"] == "no-store"
    rows = result["items"]
    assert [row["text"] for row in rows] == ["Next wake", "Reconnect", "Okay", "Hello there"]
    assert [row["sessionId"] for row in rows] == ["second", "first", "first", "first"]
    assert [row["generation"] for row in rows] == [1, 2, 1, 1]
    assert rows[-1]["ts"] == 1 and rows[-1]["endTs"] == 2
    assert rows[-1]["fragmentCount"] == 2
    saved = {
        row["segment_id"]
        for conv in restored.conversations(room="kitchen")
        for row in conv["turns"]
        if row.get("kind") == "segment"
    }
    assert all(row["segmentId"] in saved for row in rows)
    assert all(
        set(row) == {"segmentId", "sessionId", "generation", "ts", "endTs", "text", "fragmentCount"}
        for row in rows
    )
    assert sink.history("kitchen", owner)["items"] == []
    assert sink.snapshot("kitchen", owner)["items"] == []
    restored.clear(room="kitchen")
    assert json.loads((await _answers(transcript_request(bridge))).text)["items"] == []


def saved_transcript_bridge(tmp_path):
    from gatekeeper.history import History

    history = History(tmp_path / "history.jsonl")
    history.append_fragment("kitchen", "out", "Saved words", session="session", generation=1, ts=1)
    return SimpleNamespace(
        history=history,
        tools=SimpleNamespace(podview_receipts=selected_store()),
        sessions={"kitchen": object()},
        boot_id="boot",
    )


async def test_transcript_projection_receives_the_existing_app_history_instance(tmp_path):
    import json

    from gatekeeper.hub import StatusHub
    from gatekeeper.web import create_app

    saved = saved_transcript_bridge(tmp_path)
    app = create_app(
        StatusHub(history=saved.history), saved.sessions, tools=saved.tools, history=saved.history
    )
    assert app[BRIDGE].history is saved.history
    response = await _answers(transcript_request(app[BRIDGE]))
    assert json.loads(response.text)["items"][0]["text"] == "Saved words"


async def test_transcript_projection_bounds_whole_rows_and_actual_utf8_bytes(tmp_path):
    import json

    bridge = saved_transcript_bridge(tmp_path)
    bridge.history.clear()
    for generation in range(25):
        bridge.history.append_fragment(
            "kitchen", "out", str(generation), session="s", generation=generation, ts=generation
        )
    result = json.loads((await _answers(transcript_request(bridge))).text)
    assert [row["text"] for row in result["items"]] == [str(n) for n in range(24, 4, -1)]
    bridge.history.clear()
    text = "🚲" * 4000
    for generation in range(6):
        bridge.history.append_fragment(
            "kitchen", "out", text, session="s", generation=generation, ts=generation
        )
    response = await _answers(transcript_request(bridge))
    rows = json.loads(response.text)["items"]
    assert len(response.body) <= 65536 and len(rows) == 4
    assert all(row["text"] == text for row in rows)
    bridge.history.clear()
    bridge.history.append_fragment("kitchen", "out", "x" * 70000, session="s", generation=1, ts=1)
    assert json.loads((await _answers(transcript_request(bridge))).text)["items"] == []
    bridge.history.append_fragment(
        "kitchen", "out", "Older small segment", session="s", generation=0, ts=0
    )
    response = await _answers(transcript_request(bridge))
    assert len(response.body) <= 65536
    assert [row["text"] for row in json.loads(response.text)["items"]] == ["Older small segment"]


@pytest.mark.parametrize(
    "query,headers,remote",
    [
        ("?room=other&history=segments", {}, "127.0.0.1"),
        ("?room=kitchen&room=kitchen&history=segments", {}, "127.0.0.1"),
        ("?room=kitchen&history=segments&history=segments", {}, "127.0.0.1"),
        ("?room=kitchen&history=segments&extra=1", {}, "127.0.0.1"),
        ("?room=kitchen&history=segment", {}, "127.0.0.1"),
        ("?room=kitchen&history=segments", {"Sec-Fetch-Site": "cross-site"}, "127.0.0.1"),
        ("?room=kitchen&history=segments", {}, "192.0.2.1"),
        ("?room=kitchen&history=segments", {}, "172.30.32.2"),
    ],
)
async def test_transcript_projection_keeps_existing_read_admission(
    tmp_path, query, headers, remote
):
    bridge = saved_transcript_bridge(tmp_path)
    response = await _answers(transcript_request(bridge, query, headers=headers, remote=remote))
    assert response.status >= 400
    assert "Saved words" not in response.text


async def test_transcript_projection_does_not_expose_talk_or_without_answer_read(tmp_path):
    bridge = saved_transcript_bridge(tmp_path)
    bridge.sessions["talk"] = object()
    bridge.history.append_fragment("talk", "out", "Talk only", session="talk", generation=1, ts=2)
    response = await _answers(transcript_request(bridge, "?room=talk&history=segments"))
    assert response.status == 404 and "Talk only" not in response.text
    bridge.tools.podview_receipts = None
    assert (await _answers(transcript_request(bridge))).status == 404


@pytest.mark.parametrize("replacement", ["owner", "boot", "bridge"])
async def test_transcript_projection_rejects_replaced_read_owner(tmp_path, replacement):
    bridge = saved_transcript_bridge(tmp_path)
    request = transcript_request(bridge)
    original = bridge.history.conversations

    def replace(*args, **kwargs):
        result = original(*args, **kwargs)
        if replacement == "owner":
            bridge.sessions["kitchen"] = object()
        elif replacement == "boot":
            bridge.boot_id = "replacement"
        else:
            request.app[BRIDGE] = object()
        return result

    bridge.history.conversations = replace
    response = await _answers(request)
    assert response.status == 404 and "Saved words" not in response.text
