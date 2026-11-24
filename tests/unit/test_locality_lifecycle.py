"""Inert real-owner locality lifecycle regressions."""

import asyncio
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from test_locality_backend import Resolver, client

from gatekeeper import podview as P
from gatekeeper import podview_locality as L
from gatekeeper import podview_weather as W
from gatekeeper.tools import ToolRouter


@pytest.fixture
def clock(monkeypatch):
    now = [1802822400.0]
    monkeypatch.setattr(L, "time", SimpleNamespace(time=lambda: now[0], monotonic=time.monotonic))
    monkeypatch.setattr(W, "time", SimpleNamespace(time=lambda: now[0]))
    monkeypatch.setattr(P, "time", SimpleNamespace(time=lambda: now[0], monotonic=lambda: now[0]))
    monkeypatch.setattr(L, "_resolver", Resolver())
    return now


def router(c=None):
    r = ToolRouter(None, client=c or client(), supervisor_token="inert-token")
    r.podview_weather_binding = lambda: ("owner", id(r._discovery))
    r.podview_weather_available = lambda: True
    r._podview_weather_read = AsyncMock(
        return_value={
            "status": "observed",
            "data": {"location": "fallback", "hourly": {"location": "fallback"}},
        }
    )
    return r


@pytest.mark.parametrize("delay", [0.05, 1.9])
async def test_first_fast_weather_does_not_wait_and_next_read_gets_completed_config(clock, delay):
    r = router()
    started = asyncio.Event()

    async def get(*a, **kw):
        started.set()
        await asyncio.sleep(delay)
        return httpx.Response(200, json={"latitude": 55, "longitude": 10})

    r._client.get.side_effect = get
    before = time.monotonic()
    first = await r.podview_weather_read()
    assert time.monotonic() - before < 0.2
    assert "displayLocation" not in first["data"]
    await started.wait()
    await r.podview_locality._task
    clock[0] += 16
    second = await r.podview_weather_read()
    assert second["data"]["displayLocation"]["name"] == "Ved Testby"
    assert second["data"]["displayLocation"] == second["data"]["hourly"]["displayLocation"]
    await r.podview_locality.aclose()


async def test_coalesce_pending_preserves_then_invalid_clears(clock):
    r = router()
    await r.podview_weather_read()
    await r.podview_locality._task
    original = (await r.podview_weather_read())["data"]["displayLocation"]
    clock[0] += 16
    release = asyncio.Event()

    async def invalid(*a, **kw):
        await release.wait()
        return httpx.Response(200, json={})

    r._client.get.side_effect = invalid
    results = await asyncio.gather(*(r.podview_weather_read() for _ in range(8)))
    assert all(x["data"]["displayLocation"] == original for x in results)
    assert r._client.get.call_count == 2
    release.set()
    await r.podview_locality._task
    assert r.podview_locality._label is None
    await r.podview_locality.aclose()


@pytest.mark.parametrize("change", ["token", "client", "discovery", "availability"])
async def test_owner_switch_cannot_reuse_or_revive(clock, change):
    r = router()
    await r.podview_weather_read()
    await r.podview_locality._task
    clock[0] += 16
    entered = asyncio.Event()
    release = asyncio.Event()

    async def late(*a, **kw):
        entered.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            await release.wait()
        return httpx.Response(200, json={"latitude": 55, "longitude": 10})

    r._client.get.side_effect = late
    await r.podview_weather_read()
    await entered.wait()
    old = r.podview_locality._task
    if change == "token":
        r._token = "new"
    elif change == "client":
        r._client = client()
    elif change == "discovery":
        r._discovery = object()
    else:
        r.podview_weather_available = lambda: False
    changed = await r.podview_weather_read()
    assert changed.get("data") is None or "displayLocation" not in changed["data"]
    assert r.podview_locality._task is old
    release.set()
    await asyncio.gather(old, return_exceptions=True)
    assert r.podview_locality._label is None
    await r.podview_locality.aclose()


async def test_expiry_timeout_and_server_cleanup(clock):
    r = router()
    await r.podview_weather_read()
    await r.podview_locality._task
    label = r.podview_locality._label.copy()
    assert label["validUntil"] - label["observedAt"] == 60
    clock[0] += 60

    async def timeout(*a, **kw):
        raise httpx.ReadTimeout("inert")

    r._client.get.side_effect = timeout
    assert "displayLocation" not in (await r.podview_weather_read())["data"]
    await r.podview_locality._task
    assert r.podview_locality._label is None
    from aiohttp import web

    app = web.Application()
    P.mount(app, {}, r)
    entered = asyncio.Event()

    async def held(*a, **kw):
        entered.set()
        await asyncio.Event().wait()

    r._client.get.side_effect = held
    await r.podview_weather_read()
    await entered.wait()
    task = r.podview_locality._task
    app.freeze()
    await app.cleanup()
    assert task.cancelled() and r.podview_locality._task is None
    await r.podview_weather_read()
    assert r.podview_locality._task is None


def test_closed_ttl_contract_accepts_legacy_and_rejects_over_60(clock):
    label = dict(
        name="Ved Testby",
        source="ha_home_geonames",
        scope="ha_home",
        method="nearest_populated_place",
        datasetVersion=L.DATASET_SHA,
        observedAt=clock[0],
        validUntil=clock[0] + 30,
    )
    assert L.valid_label(label)
    label["validUntil"] = clock[0] + 60
    assert L.valid_label(label)
    label["validUntil"] += 0.001
    assert not L.valid_label(label)


@pytest.mark.parametrize("outcome", ["denied", "ambiguous"])
async def test_failed_refresh_revokes_still_valid_label(clock, monkeypatch, outcome):
    r = router()
    await r.podview_weather_read()
    await r.podview_locality._task
    clock[0] += 16
    if outcome == "denied":
        r._client.get.return_value = httpx.Response(401, json={})
    else:
        monkeypatch.setattr(
            L, "_resolver", SimpleNamespace(resolve=lambda *a: {"status": "unknown"})
        )
    await r.podview_weather_read()
    await r.podview_locality._task
    assert r.podview_locality._label is None
    await r.podview_locality.aclose()


async def test_old_http_completion_cannot_cancel_new_owner_task(clock):
    r = router()
    entered = asyncio.Event()
    release = asyncio.Event()

    async def held_weather():
        entered.set()
        await release.wait()
        return {"status": "observed", "data": {"location": "fallback"}}

    r._podview_weather_read = held_weather
    old_http = asyncio.create_task(r.podview_weather_read())
    await entered.wait()
    await r.podview_locality._task
    r._token = "replacement"
    r._podview_weather_read = AsyncMock(return_value={"status": "observed", "data": {}})
    config_release = asyncio.Event()

    async def held_config(*a, **kw):
        await config_release.wait()
        return httpx.Response(200, json={"latitude": 55, "longitude": 10})

    r._client.get.side_effect = held_config
    await r.podview_weather_read()
    new_task = r.podview_locality._task
    release.set()
    assert (await old_http)["status"] == "unavailable"
    assert r.podview_locality._task is new_task and not new_task.cancelled()
    config_release.set()
    await new_task
    assert r.podview_locality._label["name"] == "Ved Testby"
    await r.podview_locality.aclose()


async def test_http_cancellation_does_not_own_global_locality_lifetime(clock):
    r = router()
    entered = asyncio.Event()
    release = asyncio.Event()

    async def held_config(*a, **kw):
        entered.set()
        await release.wait()
        return httpx.Response(200, json={"latitude": 55, "longitude": 10})

    async def held_weather():
        await asyncio.Event().wait()

    r._client.get.side_effect = held_config
    r._podview_weather_read = held_weather
    http = asyncio.create_task(r.podview_weather_read())
    await entered.wait()
    http.cancel()
    await asyncio.gather(http, return_exceptions=True)
    task = r.podview_locality._task
    assert not task.done()
    release.set()
    await task
    assert r.podview_locality._label is not None
    await r.podview_locality.aclose()
