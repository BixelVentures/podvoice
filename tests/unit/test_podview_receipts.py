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


async def test_bound_history_restarts_only_passive_projection_and_exact_revoke(tmp_path):
    from gatekeeper.history import History

    path = tmp_path / "history.jsonl"
    history = History(path)
    store = selected_store()
    store.bind_history(history)
    store.bind_history_boot("oldboot")
    first_owner = object()
    assert offer(store, owner=first_owner)
    await store._selection
    original = store.history("kitchen", first_owner)["items"][0]
    assert (original["sessionId"], original["turnId"]) == ("session", "turn")
    assert store.history_persistence_status() == "saved"
    store.close()
    restored = VisualReceiptOwner()
    restored.bind_history(History(path))
    restored.bind_history_boot("newboot")
    new_owner = object()
    assert restored.history("kitchen", new_owner)["items"] == [original]
    assert restored.snapshot("kitchen", new_owner)["items"] == []
    assert restored.source("kitchen", original["receiptId"], new_owner) is None
    before = restored.history("kitchen", new_owner)
    restored.revoke("kitchen", first_owner, "session", 1)
    assert restored.history("kitchen", new_owner) == before
    restored.revoke("kitchen", new_owner, "session", 1)
    assert restored.history("kitchen", new_owner)["items"] == []
    again = VisualReceiptOwner()
    again.bind_history(History(path))
    assert again.history("kitchen", object())["items"] == []


async def test_bound_history_clear_invalidates_memory_and_failed_save_is_honest(
    tmp_path, monkeypatch
):
    from gatekeeper.history import History

    history = History(tmp_path / "history.jsonl")
    store = selected_store()
    store.bind_history(history)
    owner = object()
    assert offer(store, owner=owner)
    await store._selection
    prior = store.history("kitchen", owner)
    assert history.clear("kitchen")
    empty = store.history("kitchen", owner)
    assert empty["items"] == [] and empty["removalRevision"] > prior["removalRevision"]
    import gatekeeper.history as history_module

    monkeypatch.setattr(
        history_module.os, "replace", lambda *args: (_ for _ in ()).throw(OSError("disk"))
    )
    assert offer(store, owner=owner, session_id="new")
    await store._selection
    assert store.history_persistence_status() == "not_saved"
    restarted = VisualReceiptOwner()
    restarted.bind_history(History(history._path))
    assert restarted.history("kitchen", owner)["items"] == []


async def test_durable_history_stale_admission_and_owner_replacement_never_restore_authority(
    tmp_path,
):
    from gatekeeper.history import History

    path = tmp_path / "history.jsonl"
    history = History(path)
    sink = selected_store()
    sink.bind_history(history)
    owner = object()
    assert not offer(sink, owner=owner, current=lambda: False)
    assert history.visual_snapshots("kitchen") == []
    assert offer(sink, owner=owner)
    await sink._selection
    admitted = sink.history("kitchen", owner)
    foreign = object()
    assert sink.history("kitchen", foreign)["items"] == []
    restarted = VisualReceiptOwner()
    restarted.bind_history(History(path))
    assert restarted.history("kitchen", owner)["items"] == []
    assert sink.history("kitchen", foreign)["removalRevision"] > admitted["removalRevision"]


async def test_clear_fences_late_refinement_of_an_already_archived_display(tmp_path):
    import copy

    from gatekeeper.history import History

    history = History(tmp_path / "history.jsonl")
    sink = selected_store()
    sink.bind_history(history)
    owner = object()
    assert offer(sink, owner=owner)
    await sink._selection
    state = sink._rooms["kitchen"]
    old_item = copy.deepcopy(state["items"][0]["item"])
    assert history.clear("kitchen")
    sink._archive_display("kitchen", state, old_item, replace_existing=True)
    assert sink.history("kitchen", owner)["items"] == []
    assert History(history._path).visual_snapshots("kitchen") == []


async def test_failed_owner_removal_never_reimports_old_disk_rows_or_claims_saved(
    tmp_path, monkeypatch
):
    import gatekeeper.history as history_module

    history = history_module.History(tmp_path / "history.jsonl")
    sink = selected_store()
    sink.bind_history(history)
    first_owner, replacement = object(), object()
    assert offer(sink, owner=first_owner)
    await sink._selection
    original = sink.history("kitchen", first_owner)["items"][0]
    with monkeypatch.context() as failed_io:
        failed_io.setattr(
            history_module.os, "replace", lambda *args: (_ for _ in ()).throw(OSError("disk"))
        )
        assert sink.history("kitchen", replacement)["items"] == []
    assert offer(sink, owner=replacement, session_id="replacement")
    await sink._selection
    current = sink.history("kitchen", replacement)["items"]
    assert len(current) == 1 and current[0]["receiptId"] != original["receiptId"]
    assert sink.history_persistence_status() == "not_saved"
    # Failed deletion is truthfully not durable; no silent retry or reimport follows.
    assert history.visual_snapshots("kitchen")[0]["display"] == {
        k: v for k, v in original.items() if k not in {"sessionId", "turnId"}
    }
    assert history.clear("kitchen")
    assert sink.history("kitchen", replacement)["items"] == []
    assert sink.history_persistence_status() == "not_saved"


async def test_history_sync_reads_all_rooms_in_one_storage_capture(tmp_path, monkeypatch):
    from gatekeeper.history import History

    history = History(tmp_path / "history.jsonl")
    sink = selected_store()
    sink.bind_history(history)
    owner = object()
    for room in ["kitchen", "bedroom"]:
        assert offer(sink, owner=owner, room_id=room)
        await sink._selection
    before = {room: sink.history(room, owner)["items"] for room in ["kitchen", "bedroom"]}
    assert history.clear("bedroom")
    original = history._storage_lines
    reads = []

    def storage():
        reads.append(True)
        return original()

    monkeypatch.setattr(history, "_storage_lines", storage)
    assert sink.history("kitchen", owner)["items"] == before["kitchen"]
    assert sink.history("bedroom", owner)["items"] == []
    assert len(reads) == 1
