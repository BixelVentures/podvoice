"""Direct typed weather presentation never reopens a model allowance."""

import asyncio
import copy
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from unit.test_podview_receipts import offer
from unit.test_weather_result import weather_payload

from gatekeeper.podview_enrichment import RequestAllowance
from gatekeeper.podview_receipts import VisualReceiptOwner
from gatekeeper.thin import _direct_weather_input


@pytest.fixture
def weather(monkeypatch):
    from gatekeeper import podview_weather

    payload = weather_payload()
    stamp = datetime.fromisoformat(payload["data"]["result"]["retrieved_at"]).timestamp()
    monkeypatch.setattr(podview_weather.time, "time", lambda: stamp)
    return payload


def put(store, weather, **kwargs):
    return offer(store, tool_name="weather_forecast", result=weather, direct_weather=True, **kwargs)


def test_exact_direct_fields_without_selector_no_spend_or_generated_claim(weather):
    store = VisualReceiptOwner()
    before = copy.deepcopy(weather)
    assert put(store, weather)
    item = store.snapshot("kitchen")["items"][0]
    assert [f["value"] for f in item["content"]["facts"]] == ["15.1 °C", "partlycloudy"]
    assert item["provenance"]["kind"] == "ha_weather" and store._selection is None
    assert weather == before and "AI" not in str(item)
    assert store.source("bedroom", item["receiptId"]) is None
    source = store.source("kitchen", item["receiptId"])
    assert (
        source["facts"] == item["content"]["facts"] and source["externalSourcesProvided"] is False
    )


def test_exhausted_selector_cannot_be_called_or_refilled(weather):
    allowance = RequestAllowance(0)
    selector = SimpleNamespace(
        available=False,
        select=AsyncMock(side_effect=AssertionError("model forbidden")),
        allowance=allowance,
    )
    store = VisualReceiptOwner()
    store.configure_selector(selector)
    assert put(store, weather)
    assert len(store.snapshot("kitchen")["items"]) == 1
    assert (
        store._selection is None and selector.select.await_count == 0 and allowance.remaining == 0
    )


@pytest.mark.parametrize("mutation", ["failed", "malformed", "foreign_tool", "no_trusted_hint"])
def test_ambiguous_failed_unrelated_and_unhinted_candidates_never_display(weather, mutation):
    store = VisualReceiptOwner()
    kwargs = {"tool_name": "weather_forecast", "result": weather, "direct_weather": True}
    if mutation == "failed":
        kwargs["result"] = {"ok": False}
    elif mutation == "malformed":
        kwargs["result"] = {"ok": True, "data": {"temperature": 12}}
    elif mutation == "foreign_tool":
        kwargs.update(tool_name="google_web_sogning", result={"ok": True, "data": 2004})
    else:
        kwargs["direct_weather"] = False
    offer(store, **kwargs)
    assert not store.snapshot("kitchen")["items"] and store._selection is None


def test_stale_duplicate_source_expiry_and_stop_revoke(weather):
    now = [0.0]
    alive = [True]
    owner = object()
    store = VisualReceiptOwner(clock=lambda: now[0])
    assert not put(store, weather, current=lambda: False)
    assert put(store, weather, owner=owner, current=lambda: alive[0])
    receipt = store.snapshot("kitchen")["items"][0]["receiptId"]
    assert not put(store, weather, owner=owner)
    alive[0] = False
    assert store.snapshot("kitchen")["items"] == [] and store.source("kitchen", receipt) is None
    alive[0] = True
    assert put(store, weather, owner=owner, call_id="fresh")
    now[0] = 120
    assert store.snapshot("kitchen")["items"] == []


def test_normal_close_seals_without_extending_and_new_input_or_stop_revokes(weather):
    now = [0.0]
    active = [True]
    read = [True]
    owner = object()
    store = VisualReceiptOwner(clock=lambda: now[0])
    assert put(
        store,
        weather,
        owner=owner,
        current=lambda: active[0],
        read_current=lambda completed: read[0],
    )
    store.complete("kitchen", owner, "session", 1)
    active[0] = False
    assert store.snapshot("kitchen")["readOnlyCompleted"] is True
    read[0] = False
    assert not store.snapshot("kitchen")["items"]
    read[0] = True
    active[0] = True
    assert put(
        store,
        weather,
        owner=owner,
        call_id="next",
        current=lambda: active[0],
        read_current=lambda completed: read[0],
    )
    store.revoke("kitchen", owner, "session", 1)
    assert not store.snapshot("kitchen")["items"]


async def test_enabled_negative_ai_is_never_overruled_after_exhaustion(weather):
    selector = SimpleNamespace(available=True, select=AsyncMock(return_value=None))
    store = VisualReceiptOwner()
    store.configure_selector(selector)
    owner = object()
    assert put(store, weather, owner=owner)
    assert not store.snapshot("kitchen")["items"]
    await store._selection
    selector.available = False
    assert put(store, weather, owner=owner, call_id="next")
    assert not store.snapshot("kitchen")["items"] and selector.select.await_count == 1


async def test_inflight_ai_never_gets_deterministic_override(weather):
    entered = asyncio.Event()
    release = asyncio.Event()
    selector = SimpleNamespace(available=True)

    async def selecting(*args, **kwargs):
        selector.available = False
        entered.set()
        await release.wait()
        return None

    selector.select = selecting
    store = VisualReceiptOwner()
    store.configure_selector(selector)
    owner = object()
    assert put(store, weather, owner=owner)
    await entered.wait()
    assert put(store, weather, owner=owner, call_id="next")
    assert not store.snapshot("kitchen")["items"]
    release.set()
    await store._selection
    assert not store.snapshot("kitchen")["items"]


@pytest.mark.parametrize("args", [{}, {"forecast_type": "daily"}, {"forecast_type": "hourly"}])
def test_existing_closed_weather_input_signal(args):
    assert _direct_weather_input("weather_forecast", args)


@pytest.mark.parametrize(
    "name,args",
    [
        ("google_web_sogning", {}),
        ("weather_forecast", {"query": "weather"}),
        ("weather_forecast", {"forecast_type": []}),
        ("weather_forecast", {"forecast_type": "guess"}),
        ("weather_forecast", None),
    ],
)
def test_unknown_ancillary_input_is_not_a_presentation_signal(name, args):
    assert not _direct_weather_input(name, args)


@pytest.mark.parametrize("kind", ["mixed", "wrong_call_id", "no_signal"])
def test_actual_thin_sink_rejects_mixed_or_unbound_presentation_signal(weather, kind):
    from gatekeeper.thin import ThinSession
    from gatekeeper.weather_result import compact_weather_result

    store = VisualReceiptOwner()
    session = SimpleNamespace(
        tools=SimpleNamespace(podview_receipts=store), room="kitchen", _history_session="session"
    )
    results = [
        {
            "id": "actual",
            "name": "weather_forecast",
            "response": compact_weather_result("weather_forecast", weather),
        }
    ]
    if kind == "mixed":
        results.append(
            {
                "id": "ancillary",
                "name": "google_web_sogning",
                "response": {"ok": True, "data": 2004},
            }
        )
    ThinSession._offer_visual_receipts(
        session,
        results,
        epoch=1,
        session_id="session",
        turn_id="turn",
        provider_generation=1,
        input_revision=2,
        task_id="task",
        current=lambda: True,
        weather_calls=None
        if kind == "no_signal"
        else {"different"}
        if kind == "wrong_call_id"
        else {"actual"},
    )
    assert not store.snapshot("kitchen")["items"] and store._selection is None
