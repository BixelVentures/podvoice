"""GET/POST /view/api/weather-advice: the passive AI weather advice for the HA panel's Vejr, on loopback."""

import asyncio
import copy
import time
from datetime import UTC, datetime
from types import SimpleNamespace

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from gatekeeper import podview_weather, podview_weather_brief
from gatekeeper.podview import BRIDGE
from gatekeeper.podview_weather_advice import WeatherAdviceOwner
from gatekeeper.podview_weather_advice_http import weather_advice_http

POST = {"X-PodView-Request": "1"}


def stamp(seconds):
    return datetime.fromtimestamp(seconds, UTC).isoformat()


def observation(now):
    return {
        "status": "observed",
        "data": {
            "source": "Met.no",
            "location": "Mårslet",
            "retrievedAt": stamp(now - 1),
            "stateUpdatedAt": stamp(now - 2),
            "units": {"temperature": "°C", "precipitation": "mm", "windSpeed": "km/h"},
            "current": {"temperature": 12, "condition": "cloudy"},
            "forecastType": "hourly",
            "forecast": [{"datetime": stamp(now + 3600), "temperature": 13, "condition": "rainy"}],
            "observationScope": {"entityId": "weather.home", "ownerEpoch": "a" * 64},
        },
    }


class Provider:
    available = True

    def __init__(self):
        self.calls = 0
        self.gate = asyncio.Event()

    async def generate(self, value, *, current):
        self.calls += 1
        await self.gate.wait()
        return {"summary": "Tag jakken med i dag.", "evidenceFactIds": ["current:temperature"]}


class Tools:
    def __init__(self, provider):
        self.reads = 0
        self.weather = observation(time.time())
        self.available = True
        self.podview_weather_advice = (
            WeatherAdviceOwner(
                provider,
                boot_id="boot",
                source_is_current=podview_weather.observation_is_current,
                source_token=podview_weather_brief.token,
            )
            if provider is not None
            else None
        )

    def podview_weather_available(self):
        return self.available

    def podview_weather_binding(self):
        return ("owner", 1)

    async def podview_weather_read(self):
        self.reads += 1
        return copy.deepcopy(self.weather)


async def client_for(tools):
    app = web.Application()
    app[BRIDGE] = SimpleNamespace(tools=tools, boot_id="boot", sessions={"kokken": object()})
    app.router.add_get("/view/api/weather-advice", weather_advice_http, allow_head=False)
    app.router.add_post("/view/api/weather-advice", weather_advice_http)
    client = TestClient(TestServer(app, host="127.0.0.1"))
    await client.start_server()
    return client


async def answer(response):
    assert response.status == 200
    assert response.headers["Cache-Control"] == "no-store"
    body = await response.json()
    assert set(body) == {"ok", "status", "summary", "validUntil"}
    return body


async def test_a_read_never_starts_and_a_start_runs_once_per_weather():
    provider = Provider()
    tools = Tools(provider)
    client = await client_for(tools)
    try:
        idle = await answer(await client.get("/view/api/weather-advice"))
        assert idle == {"ok": True, "status": "idle", "summary": None, "validUntil": None}
        assert provider.calls == 0
        started = await answer(await client.post("/view/api/weather-advice", json={}, headers=POST))
        assert started["status"] == "pending"
        again = await answer(await client.post("/view/api/weather-advice", json={}, headers=POST))
        assert again["status"] == "pending"
        await asyncio.sleep(0)
        assert provider.calls == 1, "a second start for the same weather is the same request"
        provider.gate.set()
        await asyncio.sleep(0.05)
        ready = await answer(await client.get("/view/api/weather-advice?room=kokken"))
        assert ready["status"] == "ready" and ready["summary"] == "Tag jakken med i dag."
        assert ready["validUntil"] > time.time()
        assert provider.calls == 1
        # The weather is read once and reused while the advice is asked for again.
        assert tools.reads == 1
    finally:
        await tools.podview_weather_advice.close()
        await client.close()


async def test_without_a_provider_or_weather_the_advice_is_honestly_unavailable():
    for tools in (Tools(None), Tools(Provider())):
        if tools.podview_weather_advice is not None:
            tools.available = False
        client = await client_for(tools)
        try:
            for method in ("get", "post"):
                kwargs = {"json": {}, "headers": POST} if method == "post" else {}
                body = await answer(
                    await getattr(client, method)("/view/api/weather-advice", **kwargs)
                )
                assert body == {
                    "ok": True,
                    "status": "unavailable",
                    "summary": None,
                    "validUntil": None,
                }
        finally:
            if tools.podview_weather_advice is not None:
                await tools.podview_weather_advice.close()
            await client.close()


async def test_old_weather_is_no_advice():
    provider = Provider()
    tools = Tools(provider)
    tools.weather = observation(time.time() - 3600)
    client = await client_for(tools)
    try:
        body = await answer(await client.post("/view/api/weather-advice", json={}, headers=POST))
        assert body["status"] == "unavailable" and provider.calls == 0
    finally:
        await tools.podview_weather_advice.close()
        await client.close()


async def test_only_home_assistant_on_loopback_with_a_closed_request():
    provider = Provider()
    tools = Tools(provider)
    client = await client_for(tools)
    try:
        assert (await client.post("/view/api/weather-advice", json={})).status == 403
        ingress = await client.get(
            "/view/api/weather-advice", headers={"X-Remote-User-Id": "a" * 32}
        )
        assert ingress.status == 403
        body = await client.post("/view/api/weather-advice", json={"start": True}, headers=POST)
        assert body.status == 400
        assert (await client.get("/view/api/weather-advice?room=stue")).status == 404
        assert (await client.get("/view/api/weather-advice?x=1")).status == 404
        assert provider.calls == 0
    finally:
        await tools.podview_weather_advice.close()
        await client.close()
