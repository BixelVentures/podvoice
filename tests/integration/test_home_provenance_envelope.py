"""Home envelope retains the actual caller room/boot independently of music authority."""

import asyncio
import copy
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
from aiohttp.test_utils import TestClient, TestServer, make_mocked_request
from integration.test_podview_bridge import owner
from unit.test_weather_result import _dual_weather_fixture, _retention_facts

from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE, _home
from gatekeeper.web import create_app


async def test_home_scope_uses_requested_existing_room_and_actual_boot_without_music_claim():
    weather = {"status": "observed", "data": _retention_facts()}
    tools = SimpleNamespace(
        podview_home_available=lambda: False,
        podview_home_binding=lambda: None,
        podview_home_read=AsyncMock(return_value={"status": "unavailable", "items": []}),
        podview_weather_available=lambda: True,
        podview_weather_binding=lambda: "synthetic_weather_owner",
        podview_weather_read=AsyncMock(return_value=weather),
    )
    first, _ = owner()
    second, _ = owner()
    app = create_app(StatusHub(), {"kitchen": first, "study": second}, tools=tools, locked=True)

    def request(path):
        return make_mocked_request(
            "GET",
            path,
            app=app,
            transport=SimpleNamespace(
                get_extra_info=lambda key, default=None: (
                    ("127.0.0.1", 1234) if key == "peername" else default
                )
            ),
        )

    reply = await _home(request("/view/api/home?room=study"))
    assert reply.status == 200
    result = json.loads(reply.text)
    assert result["roomId"] == "study"
    assert result["bootId"] == app[BRIDGE].boot_id
    assert result["weather"] == {**weather, "lastKnown": None}
    assert "lastKnown" not in weather
    assert result["vacuum"]["status"] == "unavailable"
    assert (await _home(request("/view/api/home?room=missing"))).status == 409
    assert tools.podview_weather_read.await_count == 1


async def test_home_actual_assist_failure_retains_weather_for_fresh_client():
    fixture = _dual_weather_fixture()
    for payload in fixture.forecast_payloads.values():
        payload["data"]["result"]["entity_id"] = "weather.inert"
    async with httpx.AsyncClient(transport=httpx.MockTransport(fixture.respond)) as native:
        router = await fixture.router(native)
        session, _ = owner()
        app = create_app(StatusHub(), {"kitchen": session}, tools=router, locked=True)
        async with TestClient(TestServer(app)) as client:
            first_response = await client.get("/view/api/home?room=kitchen")
            first = await first_response.json()
            assert first_response.status == 200 and first["weather"]["status"] == "observed"
            facts = copy.deepcopy(first["weather"]["data"])
            fixture.forecast_payloads["daily"]["data"] = {
                "success": False,
                "error": "inert_provider_failure",
            }
            await asyncio.sleep(5.1)  # Natural existing five-second aggregate cache expiry.
            failed_response = await client.get("/view/api/home?room=kitchen")
            failed = await failed_response.json()
            assert failed_response.status == 200
            assert failed["bootId"] == first["bootId"] and failed["roomId"] == first["roomId"]
            assert (
                failed["weather"]["status"] == "unavailable" and failed["weather"]["data"] is None
            )
            retained = failed["weather"].get("lastKnown")
            assert retained is not None, "fresh client loses last-known facts after native failure"
            assert retained["data"]["current"] == facts["current"]
            assert retained["data"]["retrievedAt"] == facts["retrievedAt"]
            assert retained["data"]["stateUpdatedAt"] == facts["stateUpdatedAt"]
            assert retained["data"]["observationScope"] == facts["observationScope"]
            assert first["weather"]["lastKnown"] is None
            assert [call["params"]["arguments"] for call in fixture.calls] == [
                {"forecast_type": "daily"},
                {"forecast_type": "hourly"},
                {"forecast_type": "daily"},
            ]
            assert not router._refresh.await_count and not router._dispatch.await_count


async def test_home_retention_scope_recovery_denial_and_delivery_expiry(monkeypatch):
    import gatekeeper.podview_weather as weather_module

    data = _retention_facts()
    binding = ["weather-owner", True]
    tools = SimpleNamespace(
        podview_home_available=lambda: False,
        podview_home_binding=lambda: None,
        podview_home_read=AsyncMock(return_value={"status": "unavailable", "items": []}),
        podview_weather_available=lambda: binding[1],
        podview_weather_binding=lambda: binding[0],
        podview_weather_read=AsyncMock(return_value={"status": "observed", "data": data}),
    )
    first, _ = owner()
    second, _ = owner()
    app = create_app(StatusHub(), {"kitchen": first, "study": second}, tools=tools, locked=True)
    bridge = app[BRIDGE]
    async with TestClient(TestServer(app)) as client:

        async def home(room="kitchen", *, fresh=True):
            if fresh:
                bridge._home_cache.clear()
            response = await client.get("/view/api/home?room=" + room)
            assert response.status == 200
            return (await response.json())["weather"]

        assert (await home())["lastKnown"] is None
        tools.podview_weather_read.return_value = {"status": "unavailable", "data": None}
        retained = (await home())["lastKnown"]
        assert retained["data"]["current"] == data["current"]
        assert (await home("study"))["lastKnown"] is None
        assert (await home())["lastKnown"] == retained
        # A caller denied before delivery cannot delete another actor's slot.
        denied_request = make_mocked_request(
            "GET",
            "/view/api/home?room=kitchen",
            app=app,
            transport=SimpleNamespace(
                get_extra_info=lambda key, default=None: (
                    ("203.0.113.1", 1234) if key == "peername" else default
                )
            ),
        )
        assert (await _home(denied_request)).status == 403
        assert (await home())["lastKnown"] == retained
        # Existing aggregate cache still rechecks the original deadline on delivery.
        original_retained = weather_module.retained_facts
        monkeypatch.setattr(
            weather_module,
            "retained_facts",
            lambda value: original_retained(value, now=retained["validUntil"]),
        )
        assert (await home(fresh=False))["lastKnown"] is None
        monkeypatch.setattr(weather_module, "retained_facts", original_retained)
        assert (await home())["lastKnown"] is None
        # Actual observed recovery replaces history; later owner/boot revocation clears.
        tools.podview_weather_read.return_value = {"status": "observed", "data": data}
        assert (await home())["status"] == "observed"
        tools.podview_weather_read.return_value = {"status": "unavailable", "data": None}
        binding[0] = "replacement-owner"
        assert (await home())["lastKnown"] is None
        tools.podview_weather_read.return_value = {"status": "observed", "data": data}
        await home()
        tools.podview_weather_read.return_value = {"status": "unavailable", "data": None}
        bridge.boot_id = "replacement-boot"
        assert (await home())["lastKnown"] is None
        tools.podview_weather_read.return_value = {"status": "observed", "data": data}
        await home()
        tools.podview_weather_read.return_value = {"status": "unavailable", "data": None}
        binding[1] = False
        assert (await home())["lastKnown"] is None
        binding[1] = True
        assert (await home())["lastKnown"] is None


async def test_home_actual_assist_weather_expires_during_independent_light_read():
    fixture = _dual_weather_fixture()
    updated = datetime.now(UTC) - timedelta(seconds=7198)
    for payload in fixture.forecast_payloads.values():
        payload["data"]["result"].update(
            entity_id="weather.inert", state_updated_at=updated.isoformat()
        )
    async with httpx.AsyncClient(transport=httpx.MockTransport(fixture.respond)) as native:
        router = await fixture.router(native)
        session, _ = owner()
        app = create_app(StatusHub(), {"kitchen": session}, tools=router, locked=True)
        bridge = app[BRIDGE]
        held_observed = []

        async def held_lights(*args, **kwargs):
            source = bridge._home_cache["kitchen"][2]["weather"]
            assert source["status"] == "observed"
            held_observed.append(source["data"]["current"])
            remaining = updated.timestamp() + 7200 - datetime.now(UTC).timestamp()
            assert remaining > 0
            await asyncio.sleep(remaining + 0.05)
            return {}

        bridge.read_lights = held_lights
        async with TestClient(TestServer(app)) as client:
            response = await client.get("/view/api/home?room=kitchen")
            result = await response.json()
            assert response.status == 200
            assert held_observed == [{"condition": "partlycloudy", "temperature": 15.1}]
            assert result["weather"] == {"status": "unavailable", "data": None, "lastKnown": None}
            assert "kitchen" not in bridge._weather_fact_history
            assert len(fixture.calls) == 2
            router._refresh.assert_not_awaited()
            router._dispatch.assert_not_awaited()
