"""Scoped paired HTTP tasks reuse actual robot effect owner; no live home calls."""

import asyncio
import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration.test_cleaning_journal import bind
from integration.test_podview_bridge import owner
from unit.test_device_control import ROBOT, Rig

from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE, PodViewBridge
from gatekeeper.podview_controls import TouchControls, policy
from gatekeeper.web import create_app


def config():
    return {
        "roomId": "kitchen",
        "music": [
            {
                "accountId": "account",
                "targetId": "speaker",
                "actions": ["pause", "volume"],
                "maxVolume": 40,
            }
        ],
        "vacuum": [{"entityId": ROBOT, "actions": ["settings", "start", "reuse"]}],
    }


def setup_body(bridge, domain="vacuum", **extra):
    return {
        "bootId": bridge.boot_id,
        "roomId": "kitchen",
        "domain": domain,
        "target": {"entityId": ROBOT}
        if domain == "vacuum"
        else {"accountId": "account", "kind": "spotify_device", "targetId": "speaker"},
        **extra,
    }


def action_body(offer, option, args=None):
    return {key: offer[key] for key in ("bootId", "roomId", "taskId", "revision")} | {
        "requestId": "one-request",
        "optionId": option["id"],
        "args": args or {},
    }


@pytest.fixture
async def fixture(tmp_path):
    rig = Rig()
    bind(rig, tmp_path / "history.json")
    session, _ = owner()
    bridge = PodViewBridge({"kitchen": session}, rig.router, control_policy=json.dumps(config()))
    token = bridge.grant_timer_control("kitchen")
    yield rig, bridge, token
    await rig.client.aclose()


@pytest.mark.parametrize(
    "change",
    ["empty", "extra", "wrongdomain", "duplicated", "booleanvolume", "wildcard", "missingroom"],
)
def test_admin_policy_is_closed(change):
    data = config()
    if change == "empty":
        assert policy("") == {}
        return
    if change == "extra":
        data["admin"] = True
    if change == "wrongdomain":
        data["music"][0]["actions"] = ["turn_on"]
    if change == "duplicated":
        data["music"] *= 2
    if change == "booleanvolume":
        data["music"][0]["maxVolume"] = True
    if change == "wildcard":
        data["vacuum"][0]["entityId"] = "*"
    if change == "missingroom":
        del data["roomId"]
    assert policy(json.dumps(data)) == {}


async def test_real_robot_setup_choice_start_and_unknown_replay(fixture):
    rig, bridge, token = fixture
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"], offer
    assert "capability_token" not in json.dumps(offer)
    assert "map_fingerprint" not in json.dumps(offer)
    assert not rig.writes
    choice = next(row for row in offer["options"] if row["argsSchema"]["kind"] == "choice")
    command = action_body(offer, choice, {"choiceId": choice["argsSchema"]["choices"][0]["id"]})
    result = await bridge.controls.action(command, token)
    assert result["outcome"] == "accepted", result
    assert len(rig.writes) == 1
    assert await bridge.controls.action(command, token) == result
    assert len(rig.writes) == 1
    assert (await bridge.controls.action({**command, "requestId": "new"}, token))[
        "error"
    ] == "stale_action"
    offer = await bridge.controls.setup(setup_body(bridge), token)
    start_option = next(row for row in offer["options"] if row["action"] == "start")
    command = action_body(
        offer,
        start_option,
        {"areaIds": [start_option["argsSchema"]["areas"][0]["id"]], "repeat": 2},
    )
    command["requestId"] = "start"
    assert (await bridge.controls.action(command, token))["outcome"] == "accepted"
    assert len(rig.writes) == 2
    recipe = rig.router._device_control.cleaning_history()["items"][0]
    reuse = await bridge.controls.setup(setup_body(bridge, recipeId=recipe["id"]), token)
    assert reuse["ok"] and len(reuse["options"]) == 1
    reused = action_body(reuse, reuse["options"][0])
    reused["requestId"] = "reuse"
    assert (await bridge.controls.action(reused, token))["outcome"] == "accepted"
    assert len(rig.writes) == 6


async def test_pairing_scope_target_and_stale_setup_fail_closed(fixture):
    rig, bridge, token = fixture
    assert bridge.snapshot("kitchen")["capabilities"]["controlSetup"] == []
    assert bridge.snapshot("kitchen", token)["capabilities"]["controlSetup"] == ["vacuum"]
    assert (await bridge.controls.setup(setup_body(bridge), "wrong"))["error"] == "scope_not_paired"
    altered = setup_body(bridge)
    altered["target"] = {"entityId": "vacuum.other"}
    assert (await bridge.controls.setup(altered, token))["error"] == "target_not_granted"
    offer = await bridge.controls.setup(setup_body(bridge), token)
    bridge.revoke("kitchen")
    assert (await bridge.controls.action(action_body(offer, offer["options"][0]), token))[
        "error"
    ] == "stale_action"
    assert not rig.writes


async def test_music_single_send_ceiling_unknown_and_delayed_owner(fixture):
    _, bridge, token = fixture

    class Music:
        available = True

        def binding(self):
            return (self,)

        async def setup(self, account, target, current):
            return {
                "ok": True,
                "data": {
                    "actions": ["pause", "next", "volume"],
                    "volume_percent": 20,
                    "valid_until": time.time() + 15,
                },
            }

        execute = AsyncMock(return_value={"outcome": "unknown"})

    music = bridge.controls.music = Music()
    music.tools = bridge.tools
    offer = await bridge.controls.setup(setup_body(bridge, "music"), token)
    assert {o["action"] for o in offer["options"]} == {"pause", "volume"}
    volume = next(o for o in offer["options"] if o["action"] == "volume")
    command = action_body(offer, volume, {"percent": 41})
    assert (await bridge.controls.action(command, token))["error"] == "invalid_arguments"
    command["args"]["percent"] = 40
    one, two = await asyncio.gather(
        bridge.controls.action(command, token), bridge.controls.action(command, token)
    )
    assert one == two and one["outcome"] == "unknown"
    assert music.execute.await_count == 1
    assert (await bridge.controls.action({**command, "requestId": "fresh"}, token))[
        "error"
    ] == "stale_action"
    offer = await bridge.controls.setup(setup_body(bridge, "music"), token)
    bridge.sessions["kitchen"] = owner()[0]
    assert (await bridge.controls.action(action_body(offer, offer["options"][0]), token))[
        "error"
    ] == "stale_action"
    assert music.execute.await_count == 1


async def test_real_routes_require_existing_csrf_and_explicit_scope(fixture):
    rig, _, _ = fixture
    session, _ = owner()
    app = create_app(
        StatusHub(),
        {"kitchen": session},
        tools=rig.router,
        podview_control_policy=json.dumps(config()),
    )
    async with TestClient(TestServer(app)) as client:
        bridge = app[BRIDGE]
        body = setup_body(bridge)
        assert (await client.post("/view/api/control/setup", json=body)).status == 403
        headers = {"X-PodView-Request": "1"}
        response = await client.post("/view/api/control/setup", json=body, headers=headers)
        assert (await response.json())["error"] == "scope_not_paired"
        assert (
            await client.post(
                "/view/api/control/setup",
                json=body,
                headers={**headers, "Sec-Fetch-Site": "cross-site"},
            )
        ).status == 403
    assert not rig.writes


async def test_actual_pair_cookie_can_only_execute_scoped_server_offer(fixture, tmp_path):
    import hashlib

    rig, _, _ = fixture
    session, _ = owner()
    code = "x" * 43
    app = create_app(
        StatusHub(),
        {"kitchen": session},
        tools=rig.router,
        podview_control_policy=json.dumps(config()),
        podview_pairing_room="kitchen",
        podview_pairing_sha256=hashlib.sha256(code.encode()).hexdigest(),
        podview_pairing_store=tmp_path / "used",
    )
    headers = {"X-PodView-Request": "1"}
    async with TestClient(TestServer(app)) as client:
        paired = await client.post(
            "/view/api/pair", json={"roomId": "kitchen", "code": code}, headers=headers
        )
        assert paired.status == 200
        offer = await (
            await client.post(
                "/view/api/control/setup", json=setup_body(app[BRIDGE]), headers=headers
            )
        ).json()
        assert offer["ok"]
        option = next(o for o in offer["options"] if o["action"] == "start")
        command = action_body(
            offer, option, {"areaIds": [option["argsSchema"]["areas"][0]["id"]], "repeat": 1}
        )
        result = await (
            await client.post("/view/api/control/actions", json=command, headers=headers)
        ).json()
        assert result["outcome"] == "accepted"
        assert len(rig.writes) == 1
        repeated = await (
            await client.post("/view/api/control/actions", json=command, headers=headers)
        ).json()
        assert repeated == result and len(rig.writes) == 1
        assert not any(
            secret in json.dumps(result) for secret in (code, "test-token", "capability_token")
        )


async def test_replaced_music_tools_cannot_admit_new_setup_on_old_facade(fixture):
    _, bridge, token = fixture

    class Music:
        available = True
        tools = bridge.tools
        setup = AsyncMock()

        def binding(self):
            return (self,)

    music = bridge.controls.music = Music()
    assert "music" in bridge.controls.domains("kitchen", token)
    bridge.tools = object()
    assert "music" not in bridge.controls.domains("kitchen", token)
    assert (await bridge.controls.setup(setup_body(bridge, "music"), token))[
        "error"
    ] == "scope_not_paired"
    music.setup.assert_not_awaited()


async def test_only_permanently_dead_grants_retire_receipt_capacity(fixture):
    _, bridge, token = fixture
    controls = bridge.controls
    for number in range(1024):
        controls.receipts[("kitchen", token, str(number))] = ("fingerprint", {"outcome": "unknown"})
    timers = bridge.sessions["kitchen"].tools.timers
    available = timers.available
    timers.available = lambda room: False
    controls._retire_receipts()
    assert len(controls.receipts) == 1024  # Temporary outage must not permit replay.
    timers.available = available
    old_grant = bridge._grants["kitchen"]
    bridge._grants["kitchen"] = (*old_grant[:-1], time.monotonic() - 1)
    controls._retire_receipts()
    assert controls.receipts == {}
    fresh = bridge.grant_timer_control("kitchen")
    assert fresh != token
    assert (await controls.setup(setup_body(bridge), fresh))["ok"]
    assert (await controls.setup(setup_body(bridge), token))["error"] == "scope_not_paired"
    controls.receipts[("kitchen", fresh, "one")] = ("fingerprint", {"outcome": "unknown"})
    bridge.revoke("kitchen")
    controls._retire_receipts()
    assert controls.receipts == {}


@pytest.mark.parametrize(
    "action,service,feature",
    [("pause", "pause", 4), ("stop", "stop", 8), ("return", "return_to_base", 16)],
)
async def test_active_vacuum_exact_native_service_and_duplicate_once(
    fixture, action, service, feature
):
    rig, bridge, token = fixture
    bridge.controls.policy["vacuum"][0]["actions"] += ["pause", "stop", "return"]
    rig.states[ROBOT]["state"] = "cleaning"
    rig.states[ROBOT]["attributes"]["supported_features"] = feature
    owner = rig.router._device_control
    assert not owner._display_tickets
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"] and offer["setup"] == {"mapName": None}, offer
    assert [r["action"] for r in offer["options"]] == [action]
    assert not owner._display_tickets and not owner._tickets
    body = action_body(offer, offer["options"][0])
    result = await bridge.controls.action(body, token)
    assert result["outcome"] == "accepted" and result["physicalResultVerified"] is False
    assert await bridge.controls.action(body, token) == result
    assert rig.writes == [("services/vacuum/" + service, {"entity_id": ROBOT})]


@pytest.mark.parametrize(
    "change", ["state", "feature", "registry", "token", "generation", "deadline", "grant"]
)
async def test_active_vacuum_rechecks_original_owner_before_send(fixture, change):
    rig, bridge, token = fixture
    bridge.controls.policy["vacuum"][0]["actions"] = ["stop"]
    rig.states[ROBOT]["state"] = "cleaning"
    rig.states[ROBOT]["attributes"]["supported_features"] = 8
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"], offer
    if change == "state":
        rig.states[ROBOT]["state"] = "docked"
    if change == "feature":
        rig.states[ROBOT]["attributes"]["supported_features"] = 0
    if change == "registry":
        rig.registry[ROBOT]["unique_id"] = "replacement"
    if change == "token":
        rig.router._device_control._token = "replacement"
    if change == "generation":
        rig.configure(False)
    if change == "deadline":
        bridge.controls.tasks[offer["taskId"]]["vacuum_transport_offer"]["deadline"] = 0
    if change == "grant":
        bridge.revoke("kitchen")
    result = await bridge.controls.action(action_body(offer, offer["options"][0]), token)
    assert not result["ok"] and result.get("outcome") != "accepted"
    assert not rig.writes


@pytest.mark.parametrize("features", [True, None, "4", -1, 2**40, 0])
async def test_active_vacuum_unsupported_or_malformed_feature_never_offered(fixture, features):
    rig, bridge, token = fixture
    bridge.controls.policy["vacuum"][0]["actions"] = ["pause"]
    rig.states[ROBOT]["state"] = "cleaning"
    rig.states[ROBOT]["attributes"]["supported_features"] = features
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert not offer.get("options")
    assert not rig.writes


async def test_active_vacuum_cancel_after_possible_send_is_terminal_unknown(fixture):
    rig, bridge, token = fixture
    bridge.controls.policy["vacuum"][0]["actions"] = ["pause"]
    rig.states[ROBOT]["state"] = "cleaning"
    rig.states[ROBOT]["attributes"]["supported_features"] = 4
    offer = await bridge.controls.setup(setup_body(bridge), token)

    async def cancel():
        raise asyncio.CancelledError()

    rig.write_hook = cancel
    body = action_body(offer, offer["options"][0])
    result = await bridge.controls.action(body, token)
    assert result["outcome"] == "unknown" and not result["retryAllowed"]
    assert await bridge.controls.action(body, token) == result
    assert len(rig.writes) == 1


async def test_active_vacuum_revocation_during_registry_read_sends_nothing(fixture):
    rig, bridge, token = fixture
    bridge.controls.policy["vacuum"][0]["actions"] = ["stop"]
    rig.states[ROBOT]["state"] = "cleaning"
    rig.states[ROBOT]["attributes"]["supported_features"] = 8
    offer = await bridge.controls.setup(setup_body(bridge), token)

    async def replacement():
        rig.router._device_control._token = "new"
        return rig.registry

    rig.router._device_control._registry.side_effect = replacement
    result = await bridge.controls.action(action_body(offer, offer["options"][0]), token)
    assert result["outcome"] == "rejected"
    assert not rig.writes


@pytest.mark.parametrize("advanced", [False, True])
async def test_idle_robot_can_return_without_hiding_supported_cleaning_setup(fixture, advanced):
    rig, bridge, token = fixture
    bridge.controls.policy["vacuum"][0]["actions"] = ["return"] + (
        ["settings", "start"] if advanced else []
    )
    rig.states[ROBOT]["state"] = "idle"
    rig.states[ROBOT]["attributes"]["supported_features"] = 16
    if not advanced:
        rig.maps = []
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"], offer
    actions = [row["action"] for row in offer["options"]]
    assert "return" in actions
    assert ("start" in actions) == advanced
    assert ("set_option" in actions) == advanced
    option = next(row for row in offer["options"] if row["action"] == "return")
    assert (await bridge.controls.action(action_body(offer, option), token))[
        "outcome"
    ] == "accepted"
    assert rig.writes == [("services/vacuum/return_to_base", {"entity_id": ROBOT})]
    if not advanced:
        assert not rig.router._device_control._display_tickets


def test_native_room_binding_is_additive_and_legacy_transport_survives():
    original = config()
    original["music"][0]["actions"] = ["pause", "resume", "play_track"]
    # Legacy configuration still parses, but cannot authorize a native track start.
    assert policy(json.dumps(original)) == original
    updated = config()
    updated["music"][0].update(
        actions=["play_track"],
        nativeRoomId="native-stable-room",
        nativeHomepodId="homepod-stable-id",
    )
    assert policy(json.dumps(updated)) == updated
    for field, value in (("nativeRoomId", ""), ("nativeHomepodId", True)):
        malformed = config()
        malformed["music"][0].update(nativeRoomId="native-room", nativeHomepodId="homepod-id")
        malformed["music"][0][field] = value
        assert policy(json.dumps(malformed)) == {}
    partial = config()
    partial["music"][0]["nativeRoomId"] = "native-room"
    assert policy(json.dumps(partial)) == {}


def test_legacy_track_rule_does_not_open_selection_without_native_binding():
    tools = object()
    bridge = SimpleNamespace(tools=tools, _grant_current=lambda room, token: token == "grant")
    music = SimpleNamespace(tools=tools, track_available=True)
    original = config()
    original["music"][0]["actions"] = ["pause", "play_track"]
    controls = TouchControls(bridge, json.dumps(original), music)
    assert not controls.selection_allowed("kitchen", "grant")
    original["music"][0].update(nativeRoomId="native-room", nativeHomepodId="homepod-id")
    controls = TouchControls(bridge, json.dumps(original), music)
    assert controls.selection_allowed("kitchen", "grant")
    assert not controls.selection_allowed("kitchen", "revoked")
