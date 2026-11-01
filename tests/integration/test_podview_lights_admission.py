"""Actual HA request admission owns policy-bound lights without screen pairing."""

import json
from unittest.mock import AsyncMock

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
    scope = {"user": request.headers.get("Test-User", "a" * 32), "active": True}
    reset = podview._HA_REQUEST.set(scope)
    try:
        return await handler(request)
    finally:
        scope["active"] = False
        podview._HA_REQUEST.reset(reset)


def app_for(bridge, *, middleware=trusted_ingress_fixture):
    app = web.Application(middlewares=[middleware])
    app[BRIDGE] = bridge
    app.router.add_get("/view/api/snapshot", podview._snapshot)
    app.router.add_get("/view/api/events", podview._events)
    app.router.add_get("/view/api/home", podview._home)
    app.router.add_post("/view/api/control/setup", podview._control)
    app.router.add_post("/view/api/control/action", podview._control)
    return app


async def test_ingress_snapshot_and_sse_light_scope_needs_no_named_cookie(tmp_path):
    bridge, tools, profiles, _, _ = rig(tmp_path, control_policy=POLICY)
    tools.podview_lights_actions = lambda: ["light.turn_on"]
    assert not hasattr(tools, "_discovery")
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
        assert actor["capabilities"]["controlSetup"] == ["light"]
        assert paired["capabilities"]["controlSetup"] == ["light"]
        assert actor["capabilities"]["musicMoveRecovery"] == []
        assert paired["capabilities"]["musicMoveRecovery"] == []
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
        assert snap["capabilities"]["musicMoveRecovery"] == []
        stream.close()


@pytest.mark.parametrize("reason", ["no_policy", "source_closed"])
async def test_ingress_still_requires_light_policy_and_available_source(tmp_path, reason):
    bridge, tools, profiles, _, _ = rig(
        tmp_path, control_policy="" if reason == "no_policy" else POLICY
    )
    tools.podview_lights_actions = lambda: ["light.turn_on"]
    _, token = profiles[0]
    if reason == "source_closed":
        tools.podview_lights_available = lambda: False
    async with TestClient(TestServer(app_for(bridge))) as client:
        body = await (
            await client.get("/view/api/snapshot", cookies={"podview_control": token})
        ).json()
        assert body["capabilities"]["controlSetup"] == []
        assert body["admission"]["kind"] == "ha_ingress"


async def test_ingress_home_uses_policy_context_not_named_cookie_placement(tmp_path):
    bridge, tools, profiles, _, _ = rig(tmp_path, control_policy=POLICY)
    tools.podview_home_available = lambda: False
    tools.podview_home_binding = lambda: None
    tools.podview_home_read = AsyncMock(return_value={"status": "unavailable", "items": []})
    async with TestClient(TestServer(app_for(bridge))) as client:
        first = await (await client.get("/view/api/home")).json()
        # The iPad screen's saved placement is living; HA starts from configured kitchen.
        paired = await (
            await client.get("/view/api/home", cookies={"podview_control": profiles[1][1]})
        ).json()
        assert (
            first["lights"]["scope"]["areaId"] == paired["lights"]["scope"]["areaId"] == "kitchen"
        )
        assert first["lights"]["scope"]["bindingId"] == paired["lights"]["scope"]["bindingId"]
        other = await (await client.get("/view/api/home?lightArea=living")).json()
        assert other["lights"]["scope"]["areaId"] == "living"
        assert other["lightPlacement"]["areaId"] == "kitchen"
        assert other["lights"]["scope"]["isOwnArea"] is False
        assert (
            bridge._controller_registry.placement(
                profiles[1][0], "room", bridge.controller_pin("room")
            )["areaId"]
            == "living"
        )


async def test_ha_light_setup_action_exact_target_unknown_receipt_and_user_fence(tmp_path):
    bridge, tools, profiles, _, _ = rig(tmp_path, control_policy=POLICY)
    tools.podview_lights_actions = lambda: ["light.turn_on"]
    writes = []

    async def execute(**values):
        assert values["current"]() and await values["preflight"]()
        writes.append(values)
        return {"outcome": "unknown"}

    tools.podview_lights_execute = execute
    async with TestClient(
        TestServer(app_for(bridge)), headers={"X-PodView-Request": "1"}
    ) as client:

        async def setup(area="kitchen", headers=None):
            return await (
                await client.post(
                    "/view/api/control/setup",
                    json={
                        "bootId": bridge.boot_id,
                        "roomId": "room",
                        "domain": "light",
                        "target": {"areaId": area},
                    },
                    headers=headers,
                )
            ).json()

        assert (await setup("living"))["ok"] is False
        offer = await setup()
        assert offer["ok"], offer
        command = {key: offer[key] for key in ("bootId", "roomId", "taskId", "revision")} | {
            "requestId": "one",
            "optionId": offer["options"][0]["id"],
            "args": {},
        }
        denied = await (
            await client.post(
                "/view/api/control/action",
                json=command,
                headers={"Test-User": "b" * 32},
                cookies={"podview_control": profiles[0][1]},
            )
        ).json()
        assert denied["ok"] is False and not writes
        result = await (await client.post("/view/api/control/action", json=command)).json()
        assert result["outcome"] == "unknown", result
        assert writes[0]["entity_ids"] == ("light.kitchen",)
        replay = await (await client.post("/view/api/control/action", json=command)).json()
        assert replay == result and len(writes) == 1


async def test_spoofed_ha_identity_without_trusted_peer_or_screen_cannot_control_lights(tmp_path):
    bridge, tools, _, _, _ = rig(tmp_path, control_policy=POLICY)
    tools.podview_lights_actions = lambda: ["light.turn_on"]
    headers = {"X-Remote-User-Id": "a" * 32, "X-PodView-Request": "1"}
    async with TestClient(
        TestServer(app_for(bridge, middleware=podview._ha_request_scope)), headers=headers
    ) as client:
        snapshot = await (await client.get("/view/api/snapshot")).json()
        assert snapshot["error"] == "invalid_ingress_identity"
        response = await (
            await client.post(
                "/view/api/control/setup",
                json={
                    "bootId": bridge.boot_id,
                    "roomId": "room",
                    "domain": "light",
                    "target": {"areaId": "kitchen"},
                },
            )
        ).json()
        assert response["error"] == "invalid_ingress_identity"
        assert not bridge._ha_actors


@pytest.mark.parametrize("change", ["policy_order", "policy_actions", "source"])
async def test_changed_ha_light_context_rejects_prepared_task_without_effect(tmp_path, change):
    bridge, tools, _, source, _ = rig(tmp_path, control_policy=POLICY)
    bridge.controls.policy["light"].append({"areaId": "living", "actions": ["turn_on"]})
    tools.podview_lights_actions = lambda: ["light.turn_on"]
    tools.podview_lights_execute = AsyncMock(return_value={"outcome": "accepted"})
    async with TestClient(
        TestServer(app_for(bridge)), headers={"X-PodView-Request": "1"}
    ) as client:
        offer = await (
            await client.post(
                "/view/api/control/setup",
                json={
                    "bootId": bridge.boot_id,
                    "roomId": "room",
                    "domain": "light",
                    "target": {"areaId": "kitchen"},
                },
            )
        ).json()
        assert offer["ok"], offer
        if change == "policy_order":
            bridge.controls.policy["light"].reverse()
        elif change == "policy_actions":
            bridge.controls.policy["light"][0]["actions"] = ["turn_off"]
        else:
            source[0] = "replacement"
        command = {key: offer[key] for key in ("bootId", "roomId", "taskId", "revision")} | {
            "requestId": "one",
            "optionId": offer["options"][0]["id"],
            "args": {},
        }
        response = await (await client.post("/view/api/control/action", json=command)).json()
        assert response["ok"] is False
        tools.podview_lights_execute.assert_not_awaited()


@pytest.mark.parametrize(
    "change", ["policy_order", "source", "session", "request_ended", "foreign_user"]
)
async def test_ha_light_context_is_bound_to_exact_request_policy_and_source(tmp_path, change):
    bridge, _, _, source, _ = rig(tmp_path, control_policy=POLICY)
    bridge.controls.policy["light"].append({"areaId": "living", "actions": ["turn_on"]})
    scope = {"user": "a" * 32, "active": True}
    reset = podview._HA_REQUEST.set(scope)
    try:
        token = bridge._ha_actor("room", scope["user"])
        before = bridge.light_placement("room", token)
        assert before["areaId"] == "kitchen"
        if change == "policy_order":
            bridge.controls.policy["light"].reverse()
        elif change == "source":
            source[0] = "source-2"
        elif change == "session":
            bridge.sessions["room"] = object()
        elif change == "request_ended":
            scope["active"] = False
        else:
            scope["user"] = "b" * 32
        assert bridge.light_placement("room", token) != before
        if change in {"session", "request_ended", "foreign_user"}:
            assert bridge.light_placement("room", token) is None
    finally:
        podview._HA_REQUEST.reset(reset)
