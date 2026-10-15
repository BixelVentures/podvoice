"""Optional visual receipt ownership, exact source projection and bounded retention."""

import copy

from unit.test_weather_result import weather_payload

from gatekeeper.podview_receipts import VisualReceiptOwner


def offer(store, **overrides):
    args = dict(
        owner=object(),
        room_id="kitchen",
        session_id="session",
        session_epoch=1,
        turn_id="turn",
        provider_generation=1,
        task_id="answer:turn",
        input_revision=2,
        call_id="call",
        tool_name="google_web_sogning",
        result={"ok": True, "data": 2004},
        current=lambda: True,
    )
    args.update(overrides)
    return store.offer(**args)


class SelectKnownFacts:
    available = True

    async def select(self, data, **kwargs):
        return {"family": "fact-card", "content": data}


def selected_store(**kwargs):
    store = VisualReceiptOwner(**kwargs)
    store.configure_selector(SelectKnownFacts())
    return store


def pending_items(store):
    # Projection/retention tests inspect the private receipt store. These facts
    # are not publicly admitted until the asynchronous selector accepts them.
    state = store._current("kitchen")
    return [row["item"] for row in state["items"]] if state else []


async def test_scalar_has_explicit_receipt_citation_not_invented_web_url():
    store = selected_store()
    assert offer(store)
    assert store.snapshot("kitchen")["items"] == []
    await store._selection
    item = store.snapshot("kitchen")["items"][0]
    assert item["displaySuggested"] is True
    assert item["content"]["facts"][0]["value"] == "2004"
    source = item["content"]["sources"][0]
    assert source["kind"] == "owner_receipt" and "url" not in source
    receipt = store.source("kitchen", source["receiptId"])
    assert receipt["externalSourcesProvided"] is False
    assert store.source("bedroom", source["receiptId"]) is None
    receipt["facts"][0]["value"] = "changed"
    assert store.source("kitchen", source["receiptId"])["facts"][0]["value"] == "2004"


def test_unknown_tools_results_errors_and_large_text_never_become_cards():
    store = VisualReceiptOwner()
    for result in [
        {"ok": False, "data": "secret"},
        {"ok": True, "data": {"token": "secret"}},
        {"ok": True, "data": "x" * 81},
        {"ok": True, "data": True},
    ]:
        assert not offer(store, result=result)
    assert not offer(store, tool_name="arbitrary_tool")
    assert not offer(store, result={"ok": True, "data": {"success": False, "result": 2004}})
    assert pending_items(store) == []


def test_stale_current_exception_close_and_expiry_discard_receipts():
    now = [0.0]
    alive = [True]
    store = VisualReceiptOwner(clock=lambda: now[0])
    assert offer(store, current=lambda: alive[0])
    receipt = pending_items(store)[0]["receiptId"]
    alive[0] = False
    assert pending_items(store) == []
    assert store.source("kitchen", receipt) is None
    assert not offer(store, current=lambda: False)
    assert not offer(store, current=lambda: 1 / 0)
    assert offer(store)
    now[0] = 121
    assert pending_items(store) == []
    store.close()
    assert not offer(store)


def test_owner_turn_and_input_replacement_remove_old_sources_and_dedupe_is_bounded():
    store = VisualReceiptOwner()
    owner = object()
    assert offer(store, owner=owner)
    old = pending_items(store)[0]["receiptId"]
    assert not offer(store, owner=owner)
    for number in range(1, 32):
        assert offer(store, owner=owner, call_id=f"call{number}")
    assert not offer(store, owner=owner, call_id="overflow")
    assert len(pending_items(store)) == 3
    assert offer(store, owner=owner, input_revision=3)
    assert len(pending_items(store)) == 1
    assert store.source("kitchen", old) is None
    assert offer(store, owner=object())
    assert len(pending_items(store)) == 1


def test_owner_rechecked_after_projection():
    store = VisualReceiptOwner()
    states = iter([True, False])
    assert not offer(store, current=lambda: next(states))
    assert pending_items(store) == []


def test_weather_facts_copy_only_actual_structured_fields(monkeypatch):
    from datetime import datetime

    from gatekeeper import podview_weather

    payload = weather_payload()
    stamp = datetime.fromisoformat(payload["data"]["result"]["retrieved_at"]).timestamp()
    monkeypatch.setattr(podview_weather.time, "time", lambda: stamp)
    payload["data"]["result"]["token"] = "private-token"
    before = copy.deepcopy(payload)
    store = VisualReceiptOwner()
    assert offer(store, tool_name="weather_forecast", result=payload)
    item = pending_items(store)[0]
    assert item["displaySuggested"] is False
    assert [f["value"] for f in item["content"]["facts"]] == ["15.1 °C", "partlycloudy"]
    assert "private-token" not in str(item)
    assert payload == before


def test_room_capacity_and_bad_identity_fail_closed():
    store = VisualReceiptOwner()
    assert not offer(store, input_revision=True)
    assert not offer(store, session_id="")
    for number in range(12):
        assert offer(store, room_id=str(number))
    assert not offer(store, room_id="overflow")


def test_packed_weather_preserves_source_age_and_expires_without_refresh(monkeypatch):
    from datetime import datetime

    from gatekeeper import podview_weather
    from gatekeeper.weather_result import compact_weather_result

    payload = weather_payload()
    stamp = datetime.fromisoformat(payload["data"]["result"]["retrieved_at"]).timestamp()
    now = [stamp + 899]
    monkeypatch.setattr(podview_weather.time, "time", lambda: now[0])
    packed = compact_weather_result("weather_forecast", payload)
    assert isinstance(packed["data"]["result"]["forecast"], dict)
    store = VisualReceiptOwner()
    assert offer(store, tool_name="weather_forecast", result=packed)
    item = pending_items(store)[0]
    assert item["provenance"]["retrievedAt"] == payload["data"]["result"]["retrieved_at"]
    assert item["provenance"]["validUntil"] == stamp + 900
    now[0] += 2
    assert pending_items(store) == []
    assert store.source("kitchen", item["receiptId"]) is None
    packed["data"]["result"]["forecast"]["returned_rows"] = 999
    now[0] = stamp
    assert not offer(store, tool_name="weather_forecast", result=packed)


def test_unselected_projection_never_exports_answer_or_source():
    store = VisualReceiptOwner()
    assert offer(store)
    receipt = pending_items(store)[0]["receiptId"]
    assert store.snapshot("kitchen")["items"] == []
    assert store.source("kitchen", receipt) is None


async def test_normal_completed_read_is_selected_only_bounded_and_revoked_by_source_or_owner_currency():
    active, currency, now = [True], [True], [0.0]
    owner = object()
    store = selected_store(clock=lambda: now[0])
    assert offer(
        store,
        owner=owner,
        current=lambda: active[0] and currency[0],
        read_current=lambda completed: currency[0] and (active[0] or completed),
    )
    await store._selection
    row = store.snapshot("kitchen")["items"][0]
    store.complete("kitchen", object(), "session", 1)
    assert "readOnlyCompleted" not in store.snapshot("kitchen")
    store.complete("kitchen", owner, "session", 1)
    active[0] = False
    assert store.snapshot("kitchen", owner)["readOnlyCompleted"] is True
    assert store.source("kitchen", row["receiptId"], owner) is not None
    currency[0] = False
    assert store.snapshot("kitchen", owner)["items"] == []
    assert store.source("kitchen", row["receiptId"], owner) is None
    currency[0] = active[0] = True
    assert offer(
        store,
        owner=owner,
        call_id="new",
        task_id="next-task",
        current=lambda: active[0],
        read_current=lambda completed: active[0] or completed,
    )
    await store._selection
    assert len(store.snapshot("kitchen")["items"]) == 1
    store.complete("kitchen", owner, "session", 1)
    active[0] = False
    now[0] = 121
    assert store.snapshot("kitchen", owner)["items"] == []


async def test_close_cannot_publish_an_unselected_pending_receipt():
    import asyncio

    gate = asyncio.Event()

    class HeldSelector:
        available = True

        async def select(self, data, **kwargs):
            await gate.wait()
            return {"content": data}

    active = [True]
    owner = object()
    store = VisualReceiptOwner()
    store.configure_selector(HeldSelector())
    assert offer(
        store,
        owner=owner,
        current=lambda: active[0],
        read_current=lambda completed: active[0] or completed,
    )
    await asyncio.sleep(0)
    store.complete("kitchen", owner, "session", 1)
    active[0] = False
    gate.set()
    await store._selection
    assert store.snapshot("kitchen")["items"] == []
