"""Real HTTP owner composition with inert provider; no sockets or HA."""

import asyncio
import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from aiohttp.test_utils import make_mocked_request
from integration.test_podview_bridge import owner
from unit.test_passive_weather_advice import observation

from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE, _home
from gatekeeper.podview_weather_http import weather_advice
from gatekeeper.web import create_app


def request(app, method, path, body=None):
    raw = json.dumps(body).encode() if body is not None else None
    headers = (
        {
            "X-PodView-Request": "1",
            "Content-Type": "application/json",
            "Content-Length": str(len(raw)),
        }
        if raw is not None
        else {}
    )
    value = make_mocked_request(
        method,
        path,
        app=app,
        headers=headers,
        transport=SimpleNamespace(
            get_extra_info=lambda key, default=None: (
                ("127.0.0.1", 1234) if key == "peername" else default
            )
        ),
    )
    if raw is not None:
        value._read_bytes = raw
    return value


def setup(provider=None):
    provider = provider or SimpleNamespace(
        available=True, generate=AsyncMock(return_value={"summary": None, "evidenceFactIds": []})
    )
    tools = SimpleNamespace(
        podview_weather_provider=provider,
        podview_home_available=lambda: False,
        podview_home_binding=lambda: None,
        podview_home_read=AsyncMock(return_value={"status": "unavailable", "items": []}),
        podview_weather_available=lambda: True,
        podview_weather_binding=lambda: "source-owner",
        podview_weather_read=AsyncMock(return_value=observation()),
    )
    session, _ = owner()
    app = create_app(StatusHub(), {"kitchen": session}, tools=tools, locked=True)
    return app, tools, provider


async def test_home_no_paid_work_post_dedup_and_exact_binding():
    app, tools, provider = setup()
    first = json.loads((await _home(request(app, "GET", "/view/api/home"))).text)
    cap = first["weatherAdvice"]
    assert cap["status"] == "idle" and isinstance(cap["sourceRetrievedAt"], float)
    provider.generate.assert_not_awaited()
    body = {k: cap[k] for k in ("bootId", "roomId", "weatherKey")}
    response = await weather_advice(request(app, "POST", "/view/api/weather-advice", body))
    assert response.status == 200 and json.loads(response.text)["status"] == "pending"
    again = await weather_advice(request(app, "POST", "/view/api/weather-advice", body))
    assert json.loads(again.text)["requestId"] == json.loads(response.text)["requestId"]
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert provider.generate.await_count == 1
    second = json.loads((await _home(request(app, "GET", "/view/api/home"))).text)
    assert second["weatherAdvice"]["weatherKey"] == cap["weatherKey"]
    assert tools.podview_weather_read.await_count == 1
    stale = await weather_advice(
        request(app, "POST", "/view/api/weather-advice", {**body, "weatherKey": "f" * 64})
    )
    assert stale.status == 409
    injected = await weather_advice(
        request(app, "POST", "/view/api/weather-advice", {**body, "forecast": []})
    )
    assert injected.status == 409
    await tools.podview_weather_advice.close()


async def test_revoked_source_cancels_pending_and_never_publishes_late():
    app, tools, provider = setup()
    gate = asyncio.Event()

    async def generate(content, *, current):
        await gate.wait()
        return {"summary": "En lun dag.", "evidenceFactIds": [content["facts"][0]["id"]]}

    provider.generate.side_effect = generate
    cap = json.loads((await _home(request(app, "GET", "/view/api/home"))).text)["weatherAdvice"]
    body = {k: cap[k] for k in ("bootId", "roomId", "weatherKey")}
    await weather_advice(request(app, "POST", "/view/api/weather-advice", body))
    await asyncio.sleep(0)
    tools.podview_weather_available = lambda: False
    gate.set()
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert tools.podview_weather_advice.read_brief("kitchen") is None
    assert (
        await weather_advice(request(app, "POST", "/view/api/weather-advice", body))
    ).status == 409
    await tools.podview_weather_advice.close()


@pytest.mark.parametrize("expiry", ["max_age", "forecast_boundary"])
async def test_expired_source_cache_changes_binding_without_paid_refresh(expiry):
    app, tools, provider = setup()
    first = json.loads((await _home(request(app, "GET", "/view/api/home"))).text)
    bridge = app[BRIDGE]
    stamp, binding, old, deadline = bridge._weather_source_cache
    if expiry == "max_age":
        bridge._weather_source_cache = (stamp - 901, binding, old, deadline)
        bridge._home_cache["kitchen"] = (0, None, first)
    else:
        # Retained deadline must defeat even the fresh five-second home cache.
        bridge._weather_source_cache = (stamp, binding, old, time.time() - 1)
    tools.podview_weather_read.return_value = observation()
    second = json.loads((await _home(request(app, "GET", "/view/api/home"))).text)
    assert second["weatherAdvice"]["weatherKey"] != first["weatherAdvice"]["weatherKey"]
    assert tools.podview_weather_read.await_count == 2
    provider.generate.assert_not_awaited()
    await tools.podview_weather_advice.close()


async def test_distinct_fresh_weather_can_generate_without_local_quota_or_cooldown(
    tmp_path,
):
    import httpx

    from gatekeeper.podview_weather_advice import MODEL, FastWeatherAdviceProvider
    from gatekeeper.podview_weather_budget import WeatherAllowance
    from gatekeeper.provider_budget import ProviderBudgetCoordinator

    entered, release = asyncio.Event(), asyncio.Event()
    calls = []

    async def respond(request):
        calls.append(request)
        entered.set()
        await release.wait()
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
                                    {
                                        "summary": "Tag en trøje med på turen - skyerne bliver hængende.",
                                        "evidenceFactIds": ["current:temperature"],
                                    }
                                ),
                            }
                        ],
                    }
                ],
            },
        )

    allowance = WeatherAllowance.provision(tmp_path / "weather.json")
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        provider = FastWeatherAdviceProvider(
            client,
            "inert-fixture",
            model=MODEL,
            allowance=allowance,
            budget=ProviderBudgetCoordinator(),
        )
        app, tools, _ = setup(provider)
        initial = json.loads((await _home(request(app, "GET", "/view/api/home"))).text)
        body = {key: initial["weatherAdvice"][key] for key in ("bootId", "roomId", "weatherKey")}
        posted = json.loads(
            (await weather_advice(request(app, "POST", "/view/api/weather-advice", body))).text
        )
        try:
            await asyncio.wait_for(entered.wait(), timeout=3)
            assert allowance.remaining > 0 and provider.available
            pending = json.loads((await _home(request(app, "GET", "/view/api/home"))).text)
            assert pending["weatherAdvice"]["status"] == "pending"
            assert pending["weatherAdvice"]["availability"] == "available"
        finally:
            release.set()
            await asyncio.gather(
                *(record["task"] for record in tools.podview_weather_advice.records.values())
            )
        ready = json.loads((await _home(request(app, "GET", "/view/api/home"))).text)
        assert ready["weatherAdvice"]["status"] == "ready"
        assert ready["weatherAdvice"]["availability"] == "available"
        assert ready["weather"]["data"]["passiveAdvice"]["status"] == "ready"
        repeated = json.loads(
            (await weather_advice(request(app, "POST", "/view/api/weather-advice", body))).text
        )
        assert repeated["requestId"] == posted["requestId"] and repeated["status"] == "ready"
        assert len(calls) == 1
        bridge = app[BRIDGE]
        bridge._weather_source_cache = None
        old_cache = bridge._home_cache["kitchen"]
        bridge._home_cache["kitchen"] = (0, old_cache[1], old_cache[2])
        tools.podview_weather_read.return_value = observation()
        refreshed = json.loads((await _home(request(app, "GET", "/view/api/home"))).text)
        assert refreshed["weatherAdvice"]["weatherKey"] != body["weatherKey"]
        assert refreshed["weatherAdvice"]["status"] == "idle"
        assert refreshed["weatherAdvice"]["availability"] == "available"
        assert "passiveAdvice" not in refreshed["weather"]["data"]
        blocked = {key: refreshed["weatherAdvice"][key] for key in body}
        refused = json.loads(
            (await weather_advice(request(app, "POST", "/view/api/weather-advice", blocked))).text
        )
        assert refused["status"] == "pending" and refused["requestId"] != posted["requestId"]
        await asyncio.gather(
            *(record["task"] for record in tools.podview_weather_advice.records.values())
        )
        assert len(calls) == 2
        tools.podview_weather_available = lambda: False
        revoked = json.loads((await _home(request(app, "GET", "/view/api/home"))).text)
        assert revoked["weatherAdvice"]["availability"] == "unavailable"
        await tools.podview_weather_advice.close()
