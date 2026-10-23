"""Actual snapshot/SSE keeps ingress authority and adds only paired light admission."""

import json

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from test_podview_lights_bridge import rig

from gatekeeper import podview
from gatekeeper.podview import BRIDGE

POLICY = json.dumps(
    {
        "roomId": "room",
        "music": [],
        "vacuum": [],
        "light": [{"areaId": "kitchen", "actions": ["turn_on"]}],
    }
)


@web.middleware
async def trusted_ingress_fixture(request, handler):
    scope = {"user": "a" * 32, "active": True}
    reset = podview._HA_REQUEST.set(scope)
    try:
        return await handler(request)
    finally:
        scope["active"] = False
        podview._HA_REQUEST.reset(reset)


def app_for(bridge):
    app = web.Application(middlewares=[trusted_ingress_fixture])
    app[BRIDGE] = bridge
    app.router.add_get("/view/api/snapshot", podview._snapshot)
    app.router.add_get("/view/api/events", podview._events)
    return app


async def test_ingress_snapshot_and_sse_add_only_current_named_cookie_light_scope(tmp_path):
    bridge, tools, profiles, _, _ = rig(tmp_path, control_policy=POLICY)
    tools.podview_lights_actions = lambda: ["light.turn_on"]
    async with TestClient(TestServer(app_for(bridge))) as client:
        actor = await (await client.get("/view/api/snapshot")).json()
        paired = await (
            await client.get("/view/api/snapshot", cookies={"podview_control": profiles[0][1]})
        ).json()
        assert (
            actor["admission"]
            == paired["admission"]
            == {"kind": "ha_ingress", "authenticated": True}
        )
        assert actor["capabilities"]["controlSetup"] == []
        assert paired["capabilities"]["controlSetup"] == ["light"]
        # Adding the screen's light scope never switches another domain to its token.
        for field in ("timerActions", "musicActions", "musicSelection", "queueSelection"):
            assert paired["capabilities"][field] == actor["capabilities"][field]
        assert paired["revision"] == actor["revision"]
        assert paired["capabilities"]["homeRead"] == ["light"]
        stream = await client.get("/view/api/events", cookies={"podview_control": profiles[0][1]})
        assert (await stream.content.readline()).strip() == b"event: snapshot"
        await stream.content.readline()
        snap = json.loads((await stream.content.readline()).decode().removeprefix("data: "))
        assert snap["capabilities"]["controlSetup"] == ["light"]
        stream.close()


@pytest.mark.parametrize(
    "reason", ["no_policy", "unbound", "revoked", "source_closed", "expired", "foreign_cookie"]
)
async def test_light_observation_or_ingress_actor_never_grants_setup(tmp_path, reason):
    bridge, tools, profiles, _, _ = rig(
        tmp_path, control_policy="" if reason == "no_policy" else POLICY
    )
    tools.podview_lights_actions = lambda: ["light.turn_on"]
    identity, token = profiles[0]
    if reason == "unbound":
        bridge._controller_registry.set_placement(
            identity,
            "room",
            bridge.controller_pin("room"),
            area_id=None,
            expected_revision=1,
            valid_area_ids=[],
            administrator=True,
        )
    elif reason == "revoked":
        bridge._controller_grants.clear()
    elif reason == "source_closed":
        tools.podview_lights_available = lambda: False
    elif reason == "expired":
        slot = bridge._grant_slot("room", token)
        bridge._grants[slot] = (*bridge._grants[slot][:-1], 0)
    elif reason == "foreign_cookie":
        token = "not-a-controller"
    async with TestClient(TestServer(app_for(bridge))) as client:
        body = await (
            await client.get("/view/api/snapshot", cookies={"podview_control": token})
        ).json()
        assert body["capabilities"]["controlSetup"] == []
        assert body["admission"]["kind"] == "ha_ingress"
