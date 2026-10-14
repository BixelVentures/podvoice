"""Causal tests for the optional visual selector; all HTTP synthetic."""

import asyncio
import json
from unittest.mock import AsyncMock

import httpx
import pytest
from unit.test_podview_receipts import offer

from gatekeeper.podview_enrichment import (
    MODEL,
    RequestAllowance,
    VisualSelector,
    configured_selector,
)
from gatekeeper.podview_receipts import VisualReceiptOwner
from gatekeeper.provider_budget import ProviderBudgetCoordinator, ProviderBudgetUnavailable


def content():
    return {
        "summary": "Observation",
        "facts": [
            {
                "id": "f",
                "label": "Temperatur",
                "value": "12 °C",
                "detail": "Observeret",
                "sourceId": "s",
            }
        ],
        "sources": [
            {
                "id": "s",
                "kind": "owner_receipt",
                "receiptId": "a" * 32,
                "label": "HA",
                "scope": "tool_result",
            }
        ],
    }


def result(selected):
    return httpx.Response(
        200,
        json={
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": json.dumps(selected)}],
                }
            ],
        },
    )


async def test_empty_and_untrusted_policy_never_calls_provider(tmp_path):
    hits = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: hits.append(request))
    ) as client:
        for policy in [
            "",
            "{}",
            '{"model":"gpt-6-luna","max_requests":true}',
            '{"model":"gpt-6-sol","max_requests":20}',
            '{"model":"gpt-6-luna","max_requests":21}',
            '{"model":"gpt-6-luna","max_requests":20,"extra":1}',
        ]:
            assert configured_selector(client, "test-key", policy, tmp_path / "budget") is None
        selector = VisualSelector(client, "test-key", MODEL)
        assert await selector.select(content(), current=lambda: True) is None
        assert hits == []


async def test_selection_keeps_owner_bytes_and_charges_attempt_before_send(tmp_path):
    path = tmp_path / "budget"

    def respond(request):
        assert json.loads(path.read_text())["used"] == 1
        body = json.loads(request.content)
        assert body["store"] is False and body["reasoning"] == {"effort": "none"}
        assert body["max_output_tokens"] == 256 and len(request.content) <= 4096
        assert "tools" not in body
        return result({"show": True, "fact_ids": ["f"]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        selector = VisualSelector(
            client,
            "test-key",
            MODEL,
            allowance=RequestAllowance.prepare(path, 1),
            budget=ProviderBudgetCoordinator(),
        )
        assert (await selector.select(content(), current=lambda: True))["content"] == content()
        assert await selector.select(content(), current=lambda: True) is None
    assert json.loads(path.read_text())["used"] == 1
    assert RequestAllowance.prepare(path, 1) is None  # restarting does not refill


@pytest.mark.parametrize(
    "selected",
    [
        {"show": False, "fact_ids": []},
        {"show": True, "fact_ids": ["unknown"]},
        {"show": True, "fact_ids": ["f", "f"]},
        {"show": 1, "fact_ids": ["f"]},
        {"show": True, "fact_ids": ["f"], "html": "<img src=https://bad>"},
    ],
)
async def test_refusal_and_unclosed_selection_decline(tmp_path, selected):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: result(selected))
    ) as client:
        selector = VisualSelector(
            client,
            "test-key",
            MODEL,
            allowance=RequestAllowance.prepare(tmp_path / "budget", 1),
            budget=ProviderBudgetCoordinator(),
        )
        assert await selector.select(content(), current=lambda: True) is None


def test_budget_corruption_missing_after_init_and_exhaustion_fail_closed(tmp_path):
    path = tmp_path / "budget.json"
    allowance = RequestAllowance.prepare(path, 2)
    assert allowance.reserve()
    path.unlink()
    assert RequestAllowance.prepare(path, 2) is None
    path.write_text('{"version":1,"used":true}')
    assert RequestAllowance.prepare(path, 2) is None
    path.write_text('{"version":1,"used":2}')
    assert RequestAllowance.prepare(path, 2) is None


async def test_diagnostic_exclusion_without_blocking_other_model_voice(tmp_path):
    coordinator = ProviderBudgetCoordinator()
    diagnostic = coordinator.diagnostic_started("test-key")
    hits = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: hits.append(request))
    ) as client:
        selector = VisualSelector(
            client, "test-key", MODEL, allowance=RequestAllowance(2), budget=coordinator
        )
        assert await selector.select(content(), current=lambda: True) is None
        assert hits == [] and not (tmp_path / "budget").exists()
    coordinator.release(diagnostic)
    visual = coordinator.production_started("test-key", MODEL, tokens=8192)
    voice = coordinator.production_started("test-key", "gpt-6-sol")
    assert coordinator.has_capacity(voice, 15000)
    with pytest.raises(ProviderBudgetUnavailable):
        coordinator.diagnostic_started("test-key")
    coordinator.release(voice)
    coordinator.release(visual)
    coordinator.release(coordinator.diagnostic_started("test-key"))


async def test_offer_is_nonblocking_and_ai_is_only_suggestion_owner():
    release = asyncio.Event()

    async def select(data, **kwargs):
        await release.wait()
        return {"family": "fact-card", "content": data}

    selector = AsyncMock()
    selector.select.side_effect = select
    store = VisualReceiptOwner()
    store.configure_selector(selector)
    assert offer(store)
    before = store.snapshot("kitchen")
    assert before["items"] == []
    await asyncio.sleep(0)
    assert not store._selection.done()
    release.set()
    await store._selection
    after = store.snapshot("kitchen")
    assert after["items"][0]["displaySuggested"] is True
    assert after["revision"] == before["revision"] + 1
    store.close()


@pytest.mark.parametrize("change", ["turn", "revision", "owner", "expiry", "close"])
async def test_late_selection_cannot_cross_current_owner_or_expiry(change):
    release = asyncio.Event()
    now = [0.0]

    async def select(data, **kwargs):
        try:
            await release.wait()
        except asyncio.CancelledError:
            await release.wait()
        return {"family": "fact-card", "content": data}

    selector = AsyncMock()
    selector.select.side_effect = select
    store = VisualReceiptOwner(clock=lambda: now[0])
    store.configure_selector(selector)
    owner = object()
    assert offer(store, owner=owner)
    await asyncio.sleep(0)
    pending = store._selection
    if change == "turn":
        assert offer(store, owner=owner, turn_id="new", task_id="answer:new")
    elif change == "revision":
        assert offer(store, owner=owner, input_revision=3)
    elif change == "owner":
        assert offer(store, owner=object())
    elif change == "expiry":
        now[0] = 121
    else:
        store.close()
    release.set()
    await pending
    assert all(not row["displaySuggested"] for row in store.snapshot("kitchen")["items"])
    store.close()


@pytest.mark.parametrize("kind", ["budget_fifo", "marker_fifo", "lock_fifo", "budget_link"])
def test_special_allowance_files_fail_without_workers(tmp_path, kind):
    import os

    path = tmp_path / "budget.json"
    if kind == "budget_fifo":
        os.mkfifo(path)
    elif kind == "marker_fifo":
        os.mkfifo(path.with_suffix(".initialized"))
    elif kind == "lock_fifo":
        os.mkfifo(path.with_suffix(".lock"))
    else:
        original = tmp_path / "other"
        original.write_text('{"version":1,"used":0}')
        os.link(original, path)
    assert RequestAllowance.prepare(path, 20) is None


async def test_owner_revoked_before_send_debits_no_http(tmp_path):
    hits = []
    values = iter([True, False])
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: hits.append(request))
    ) as client:
        allowance = RequestAllowance(1)
        selector = VisualSelector(
            client, "test-key", MODEL, allowance=allowance, budget=ProviderBudgetCoordinator()
        )
        assert await selector.select(content(), current=lambda: next(values)) is None
        assert hits == [] and allowance.remaining == 0


@pytest.mark.parametrize("operation", ["fsync", "replace"])
def test_failed_durable_commit_never_admits_budget(tmp_path, monkeypatch, operation):
    import gatekeeper.podview_enrichment as module

    path = tmp_path / "budget.json"
    original = getattr(module.os, operation)

    def fail(*args, **kwargs):
        raise OSError("synthetic disk failure")

    monkeypatch.setattr(module.os, operation, fail)
    assert RequestAllowance.prepare(path, 20) is None
    monkeypatch.setattr(module.os, operation, original)
    # Existing marker means an interrupted commit cannot silently reset the budget.
    assert RequestAllowance.prepare(path, 20) is None
    assert not list(tmp_path.glob("podview-allowance-*"))


def test_unused_bundle_is_lost_on_restart_and_lock_is_nonblocking(tmp_path):
    import fcntl

    path = tmp_path / "budget.json"
    with path.with_suffix(".lock").open("w") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert RequestAllowance.prepare(path, 20) is None
    allowance = RequestAllowance.prepare(path, 20)
    assert allowance.remaining == 20
    assert RequestAllowance.prepare(path, 20) is None
    for _ in range(20):
        assert allowance.reserve()
    assert not allowance.reserve()


async def test_same_turn_new_receipt_invalidates_pending_selection():
    release = asyncio.Event()

    async def select(data, **kwargs):
        await release.wait()
        return {"family": "fact-card", "content": data}

    selector = AsyncMock()
    selector.select.side_effect = select
    store = VisualReceiptOwner()
    store.configure_selector(selector)
    owner = object()
    assert offer(store, owner=owner)
    await asyncio.sleep(0)
    assert offer(store, owner=owner, call_id="second")
    release.set()
    await store._selection
    assert store.snapshot("kitchen")["items"] == []
    assert all(not item["displaySuggested"] for item in store.snapshot("kitchen")["items"])
    assert selector.select.await_count == 1
    await store.aclose()


async def test_source_expiry_beats_receipt_ttl(monkeypatch):
    from datetime import datetime

    from unit.test_weather_result import weather_payload

    from gatekeeper import podview_weather

    payload = weather_payload()
    stamp = datetime.fromisoformat(payload["data"]["result"]["retrieved_at"]).timestamp()
    wall = [stamp + 899]
    monkeypatch.setattr(podview_weather.time, "time", lambda: wall[0])
    release = asyncio.Event()

    async def select(data, **kwargs):
        await release.wait()
        return {"family": "fact-card", "content": data}

    selector = AsyncMock()
    selector.select.side_effect = select
    store = VisualReceiptOwner(clock=lambda: 0)
    store.configure_selector(selector)
    assert offer(store, tool_name="weather_forecast", result=payload)
    await asyncio.sleep(0)
    wall[0] += 2
    release.set()
    await store._selection
    assert store.snapshot("kitchen")["items"] == []
    await store.aclose()


async def test_cleanup_waits_for_selection_cancellation_without_publication():
    started, cancelled, release = asyncio.Event(), asyncio.Event(), asyncio.Event()

    async def select(data, **kwargs):
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            await release.wait()
            return {"family": "fact-card", "content": data}

    selector = AsyncMock()
    selector.select.side_effect = select
    store = VisualReceiptOwner()
    store.configure_selector(selector)
    assert offer(store)
    await started.wait()
    closing = asyncio.create_task(store.aclose())
    await cancelled.wait()
    assert not closing.done()
    release.set()
    await closing
    assert store._selection.done()
    assert store.snapshot("kitchen")["items"] == []


async def test_rate_limit_stops_optional_requests_without_retry():
    hits = []

    def respond(request):
        hits.append(request)
        return httpx.Response(429)

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        allowance = RequestAllowance(20)
        selector = VisualSelector(
            client, "test-key", MODEL, allowance=allowance, budget=ProviderBudgetCoordinator()
        )
        assert await selector.select(content(), current=lambda: True) is None
        assert await selector.select(content(), current=lambda: True) is None
        assert len(hits) == 1 and allowance.remaining == 19


@pytest.mark.parametrize("status", [200, 429])
async def test_snapshot_capability_revokes_on_exhaustion_rate_limit_and_close(status):
    from types import SimpleNamespace

    from integration.test_podview_bridge import owner

    from gatekeeper.podview import PodViewBridge

    def respond(request):
        return result({"show": False, "fact_ids": []}) if status == 200 else httpx.Response(429)

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        selector = VisualSelector(
            client,
            "test-key",
            MODEL,
            allowance=RequestAllowance(20 if status == 429 else 1),
            budget=ProviderBudgetCoordinator(),
        )
        store = VisualReceiptOwner()
        store.configure_selector(selector)
        session, _ = owner()
        bridge = PodViewBridge({"kitchen": session}, tools=SimpleNamespace(podview_receipts=store))
        assert bridge.snapshot("kitchen")["capabilities"]["visualEnrichment"] is True
        assert await selector.select(content(), current=lambda: True) is None
        assert bridge.snapshot("kitchen")["capabilities"]["visualEnrichment"] is False
        assert selector.allowance.remaining == (19 if status == 429 else 0)
        store.close()
        assert store.selection_enabled is False
