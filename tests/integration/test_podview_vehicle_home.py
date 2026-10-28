"""Actual existing /home handler and cache with inert source readers; no sockets."""

import asyncio
import copy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from aiohttp import web
from aiohttp.test_utils import make_mocked_request

from gatekeeper import podview


def rig(monkeypatch):
    clock = [1_800_000_000.0]
    monkeypatch.setattr(podview.time, "time", lambda: clock[0])
    monkeypatch.setattr(podview, "_guard", AsyncMock(return_value=None))
    source = ["exact-source-1", True]
    value = {
        "status": "observed",
        "source": "home_assistant_state",
        "observedAt": clock[0] - 10,
        "entityIds": ["sensor.car_battery"],
        "data": {"batteryPercent": 72},
    }
    tools = SimpleNamespace(
        podview_home_available=lambda: False,
        podview_home_binding=lambda: None,
        podview_home_read=AsyncMock(return_value={"status": "unavailable", "items": []}),
        podview_weather_available=lambda: False,
        podview_weather_binding=lambda: None,
        podview_weather_read=AsyncMock(return_value={"status": "unavailable", "data": None}),
        podview_vehicle_available=lambda: source[1],
        podview_vehicle_binding=lambda: source[0],
        podview_vehicle_read=AsyncMock(side_effect=lambda: copy.deepcopy(value)),
    )
    bridge = SimpleNamespace(
        tools=tools,
        sessions={"room": object()},
        boot_id="boot-1",
        _home_cache={},
        _home_busy=False,
        _home_inflight=None,
        _weather_source_cache=None,
        _home_revision=0,
        read_lights=AsyncMock(return_value={}),
    )
    app = web.Application()
    app[podview.BRIDGE] = bridge

    def request():
        return make_mocked_request("GET", "/view/api/home", app=app)

    return bridge, tools, source, value, clock, request


async def test_actual_home_includes_passive_vehicle_and_coalesces_cache_without_timestamp_refresh(
    monkeypatch,
):
    bridge, tools, _, value, clock, request = rig(monkeypatch)
    first = json.loads((await podview._home(request())).text)
    assert first["vehicle"] == value
    assert first["vehicle"]["observedAt"] == clock[0] - 10
    second = json.loads((await podview._home(request())).text)
    assert second == first and tools.podview_vehicle_read.await_count == 1
    assert first["vacuum"] == {"status": "unavailable", "items": []}
    assert first["weather"] == {"status": "unavailable", "data": None}
    assert not bridge._home_busy


async def test_cached_vehicle_cannot_outlive_source_age_even_within_five_second_read_cache(
    monkeypatch,
):
    _, tools, _, value, clock, request = rig(monkeypatch)
    first = json.loads((await podview._home(request())).text)
    clock[0] += 901
    value["status"] = "stale"
    expired = json.loads((await podview._home(request())).text)
    assert expired["vehicle"]["status"] == "stale"
    assert expired["vehicle"]["observedAt"] == first["vehicle"]["observedAt"]
    assert tools.podview_vehicle_read.await_count == 2


async def test_policy_revocation_bypasses_existing_home_cache_and_retains_no_vehicle_authority(
    monkeypatch,
):
    _, tools, source, _, _, request = rig(monkeypatch)
    assert json.loads((await podview._home(request())).text)["vehicle"]["status"] == "observed"
    source[1] = False
    revoked = json.loads((await podview._home(request())).text)
    assert revoked["vehicle"] == {"status": "unavailable", "data": None}
    assert tools.podview_vehicle_read.await_count == 2
    assert "actions" not in json.dumps(revoked)


async def test_binding_change_during_held_read_discards_old_vehicle_and_no_automatic_replay(
    monkeypatch,
):
    bridge, tools, source, _, _, request = rig(monkeypatch)
    entered, release = asyncio.Event(), asyncio.Event()

    async def held():
        entered.set()
        await release.wait()
        return {
            "status": "observed",
            "source": "home_assistant_state",
            "observedAt": 1_799_999_999,
            "entityIds": ["sensor.car_battery"],
            "data": {"batteryPercent": 99},
        }

    tools.podview_vehicle_read.side_effect = held
    task = asyncio.create_task(podview._home(request()))
    await entered.wait()
    source[0] = "new-source"
    release.set()
    response = await task
    assert response.status == 200
    assert json.loads(response.text)["vehicle"] == {"status": "unavailable", "data": None}
    assert tools.podview_vehicle_read.await_count == 1 and not bridge._home_busy


async def test_duplicate_home_waiters_join_one_vehicle_read(monkeypatch):
    _, tools, _, value, _, request = rig(monkeypatch)
    entered, release = asyncio.Event(), asyncio.Event()

    async def held():
        entered.set()
        await release.wait()
        return value

    tools.podview_vehicle_read.side_effect = held
    first = asyncio.create_task(podview._home(request()))
    await entered.wait()
    second = asyncio.create_task(podview._home(request()))
    await asyncio.sleep(0)
    release.set()
    results = await asyncio.gather(first, second)
    assert json.loads(results[0].text) == json.loads(results[1].text)
    assert tools.podview_vehicle_read.await_count == 1


async def test_unauthorized_request_reads_no_vehicle_source(monkeypatch):
    _, tools, _, _, _, request = rig(monkeypatch)
    monkeypatch.setattr(
        podview,
        "_guard",
        AsyncMock(return_value=web.json_response({"error": "denied"}, status=403)),
    )
    assert (await podview._home(request())).status == 403
    assert tools.podview_vehicle_read.await_count == 0


@pytest.mark.parametrize("cached", [False, True])
@pytest.mark.parametrize("revoke", ["source", "session", "authorization", "age"])
async def test_final_lights_await_cannot_release_revoked_vehicle(cached, revoke, monkeypatch):
    bridge, tools, source, _, clock, request = rig(monkeypatch)
    if cached:
        assert (await podview._home(request())).status == 200
    entered, release = asyncio.Event(), asyncio.Event()

    async def held(*args, **kwargs):
        entered.set()
        await release.wait()
        return {}

    bridge.read_lights.side_effect = held
    task = asyncio.create_task(podview._home(request()))
    await entered.wait()
    if revoke == "source":
        source[0] = "new-owner"
    elif revoke == "session":
        bridge.sessions["room"] = object()
    elif revoke == "age":
        clock[0] += 901
    else:
        monkeypatch.setattr(
            podview,
            "_guard",
            AsyncMock(return_value=web.json_response({"error": "denied"}, status=403)),
        )
    release.set()
    response = await task
    assert response.status == (403 if revoke == "authorization" else 503)
    assert "vehicle" not in response.text and "batteryPercent" not in response.text
    assert not bridge._home_busy
    assert tools.podview_vehicle_read.await_count == 1


async def test_actual_snapshot_advertises_only_configured_read_without_creating_command_domain():
    import httpx
    from integration.test_podview_bridge import owner

    from gatekeeper.podview import PodViewBridge
    from gatekeeper.tools import ToolRouter

    called = []

    def no_network(request):
        called.append(request)
        raise AssertionError("snapshot must perform no source I/O")

    async with httpx.AsyncClient(transport=httpx.MockTransport(no_network)) as client:
        tools = ToolRouter(None, client=client, supervisor_token="test-only")
        session, _ = owner()
        bridge = PodViewBridge({"room": session}, tools=tools)
        assert "vehicle" not in bridge.snapshot("room")["capabilities"]["homeRead"]
        tools.configure_podview_vehicle_read(
            json.dumps(
                {
                    "configEntryId": "entry-a",
                    "deviceId": "device-a",
                    "entities": {"batteryPercent": "sensor.car_battery"},
                }
            )
        )
        result = bridge.snapshot("room")
        assert "vehicle" in result["capabilities"]["homeRead"]
        assert "vehicle" not in bridge.controls.domains("room", "")
        assert called == []
