"""Real placement + bridge/HTTP seams, with inert source and no HA effects."""

import asyncio
import hashlib
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from gatekeeper import podview, podview_lights
from gatekeeper.podview import BRIDGE, PodViewBridge


def rig(tmp_path, *, control_policy=""):
    timers = SimpleNamespace(
        available=lambda room: True,
        snapshots={"room": {"epoch": "a" * 32, "timers": [], "finished": []}},
        bindings={"room": ("voice_pe", "native-room")},
    )
    session = SimpleNamespace(tools=SimpleNamespace(timers=timers))
    source = ["source-1"]
    areas = [
        {"areaId": "kitchen", "areaName": "Køkken"},
        {"areaId": "living", "areaName": "Stue"},
        {"areaId": "office", "areaName": "Kontor"},
    ]
    tools = SimpleNamespace(
        podview_lights_available=lambda: True,
        podview_lights_binding=lambda: tuple(source),
        podview_lights_areas=AsyncMock(side_effect=lambda: list(areas)),
    )

    async def read(scope, current):
        assert current()
        return podview_lights.project_area_lights(
            scope=scope,
            source_epoch=hashlib.sha256(repr(tuple(source)).encode()).hexdigest(),
            area={
                "areaId": scope.area_id,
                "areaName": next(a["areaName"] for a in areas if a["areaId"] == scope.area_id),
                "entityIds": ["light." + scope.area_id],
            },
            states=[{"entity_id": "light." + scope.area_id, "state": "on", "attributes": {}}],
            observed_at=time.time(),
        )

    tools.podview_lights_read = AsyncMock(side_effect=read)
    bridge = PodViewBridge(
        {"room": session},
        tools=tools,
        control_policy=control_policy,
        controller_enabled=True,
        controller_generation="a" * 64,
        controller_store=tmp_path / "controllers.json",
    )
    registry = bridge._controller_registry
    pin = bridge.controller_pin("room")
    profiles = []
    for name, area in (("Mac", "kitchen"), ("iPad", "living")):
        _, identity, _ = registry.enroll("room", pin, name=name)
        registry.set_placement(
            identity,
            "room",
            pin,
            area_id=area,
            expected_revision=0,
            valid_area_ids=[a["areaId"] for a in areas],
            administrator=True,
        )
        profiles.append((identity, bridge.grant_timer_control("room", identity)))
    return bridge, tools, profiles, source, areas


async def test_profile_partition_other_area_navigation_preserves_own_and_cache_age(tmp_path):
    bridge, tools, profiles, _, _ = rig(tmp_path)
    first = await bridge.read_lights("room", profiles[0][1], cache=True)
    second = await bridge.read_lights("room", profiles[1][1], cache=True)
    assert first["scope"]["areaId"] == "kitchen"
    assert second["scope"]["areaId"] == "living"
    assert first["scope"]["bindingId"] != second["scope"]["bindingId"]
    assert await bridge.read_lights("room", profiles[0][1], cache=True) == first
    assert tools.podview_lights_read.await_count == 2
    browsed = await bridge.read_lights("room", profiles[0][1], areaId="living", cache=True)
    assert browsed["scope"]["isOwnArea"] is False
    await bridge.read_lights("room", profiles[0][1], areaId="office", cache=True)
    assert len([k for k in bridge._lights_cache if k[1] == profiles[0][0]]) == 2
    assert await bridge.read_lights("room", profiles[0][1], cache=True) == first
    # Command setup/action gets a fresh source snapshot, never that HTTP cache.
    fresh = await bridge.read_lights("room", profiles[0][1])
    assert fresh["observedAt"] >= first["observedAt"]
    assert bridge.light_placement("room", profiles[0][1])["areaId"] == "kitchen"


@pytest.mark.parametrize("change", ["placement", "source", "revoke"])
async def test_held_read_cannot_publish_after_placement_source_or_profile_change(tmp_path, change):
    bridge, tools, profiles, source, _ = rig(tmp_path)
    entered, release = asyncio.Event(), asyncio.Event()
    original = tools.podview_lights_read.side_effect

    async def held(scope, current):
        value = await original(scope, current)
        entered.set()
        await release.wait()
        return value

    tools.podview_lights_read.side_effect = held
    pending = asyncio.create_task(bridge.read_lights("room", profiles[0][1], cache=True))
    await entered.wait()
    identity, _token = profiles[0]
    if change == "source":
        source[0] = "replacement"
    elif change == "placement":
        bridge._controller_registry.set_placement(
            identity,
            "room",
            bridge.controller_pin("room"),
            area_id="living",
            expected_revision=1,
            valid_area_ids=["living"],
            administrator=True,
        )
    else:
        bridge._controller_grants.clear()
    release.set()
    assert (await pending)["status"] == "unavailable"
    assert bridge._lights_cache == {}
    assert bridge.light_placement("room", "ha:actor") is None


async def test_renamed_deleted_areas_and_expiry_do_not_keep_old_projection(tmp_path):
    bridge, tools, profiles, _, areas = rig(tmp_path)
    token = profiles[0][1]
    first = await bridge.read_lights("room", token, cache=True)
    areas[0]["areaName"] = "Nyt køkken"
    renamed = await bridge.read_lights("room", token, cache=True)
    assert renamed["scope"]["areaName"] == "Nyt køkken"
    assert tools.podview_lights_read.await_count == 2
    areas.pop(0)
    assert (await bridge.read_lights("room", token, cache=True))["status"] == "unbound"
    assert (await bridge.read_lights("room", token, areaId="living"))["status"] == "unbound"
    assert first["scope"]["areaId"] == "kitchen"
    assert (await bridge.read_lights("room", "", cache=True))["status"] == "unbound"


@pytest.mark.parametrize(
    "error",
    [
        httpx.ConnectError("inert"),
        httpx.HTTPStatusError(
            "inert", request=httpx.Request("GET", "http://inert"), response=httpx.Response(401)
        ),
    ],
)
async def test_home_route_light_transport_failure_retains_other_domain_data(tmp_path, error):
    bridge, tools, profiles, _, _ = rig(tmp_path)
    tools.podview_home_available = lambda: False
    tools.podview_home_binding = lambda: None
    tools.podview_home_read = AsyncMock(return_value={"status": "unavailable", "items": []})
    tools.podview_lights_areas.side_effect = error
    app = web.Application()
    app[BRIDGE] = bridge
    app.router.add_get("/view/api/home", podview._home)
    async with TestClient(TestServer(app)) as client:
        response = await client.get(
            "/view/api/home?room=room", cookies={"podview_control": profiles[0][1]}
        )
        assert response.status == 200
        body = await response.json()
        assert body["lights"]["status"] == "unavailable"
        assert body["vacuum"] == {"status": "unavailable", "items": []}
        assert body["weather"] == {"status": "unavailable", "data": None}
        assert "lights" not in bridge._home_cache["room"][2]


async def test_ingress_light_setup_and_action_keep_ha_actor_instead_of_named_cookie(
    tmp_path, monkeypatch
):
    bridge, _, profiles, _, _ = rig(tmp_path)
    seen = []

    async def setup(body, token):
        seen.append(token)
        return {"ok": True}

    bridge.controls.setup = setup
    bridge.controls.action = setup
    bridge.controls.tasks["control:inert"] = {"domain": "light"}
    monkeypatch.setattr(podview, "_request_token", lambda request, room: "ha:actor")
    app = web.Application()
    app[BRIDGE] = bridge
    app.router.add_post("/view/api/control/setup", podview._control)
    app.router.add_post("/view/api/control/actions", podview._control)
    async with TestClient(TestServer(app)) as client:
        for path, body in (
            ("setup", {"roomId": "room", "domain": "light"}),
            ("actions", {"roomId": "room", "taskId": "control:inert"}),
        ):
            response = await client.post(
                "/view/api/control/" + path,
                json=body,
                cookies={"podview_control": profiles[0][1]},
                headers={"X-PodView-Request": "1"},
            )
            assert response.status == 200
        assert seen == ["ha:actor", "ha:actor"]
