"""Scoped paired HTTP tasks reuse actual robot effect owner; no live home calls."""

import asyncio
import hashlib
import json
import time
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration.test_cleaning_journal import bind
from integration.test_ha_timer_flow import build as build_ha_timers
from integration.test_podview_bridge import owner
from integration.test_podview_music import Rig as MusicReadRig
from integration.test_podview_music import payload as playback_payload
from integration.test_podview_music_control import Rig as MusicRig
from integration.test_podview_music_control import content_owner, room_owner
from unit.test_device_control import MAP, MODE, ROBOT, Rig

from gatekeeper.events import State
from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE, PodViewBridge
from gatekeeper.podview_controls import TouchControls, policy
from gatekeeper.podview_music import project_owner
from gatekeeper.web import create_app

ACTUAL_BINDING_ID = "b" * 64


def actual_playback_response(request, *, target="speaker", homepod="42"):
    """Explicit Control aggregate fixture, independent of PodView policy/defaults."""
    assert json.loads(request.content) == {"config_entry_id": "account", "include_output": True}
    source = playback_payload("playback", "account")
    source["playback"]["target"]["target_id"] = target
    projected = project_owner("playback", source, "account")
    assert projected["ok"]
    value = {
        **projected["data"],
        "schema": "podconnect.playback.v2",
        "output": {
            "status": "observed",
            "reason": None,
            "binding": {
                "target_id": target,
                "native_room_id": "native-room",
                "homepod_id": homepod,
                "binding_id": ACTUAL_BINDING_ID,
                "valid_until": time.time() + 5,
            },
        },
    }
    return httpx.Response(200, json={"service_response": value})


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
        else {
            "accountId": "account",
            "kind": "spotify_device",
            "targetId": "speaker",
            "expectedBindingId": ACTUAL_BINDING_ID,
        },
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
    original_client = rig.client

    async def routed(request):
        if request.url.path.endswith("/get_playback_snapshot"):
            if getattr(rig, "playback_hook", None) is not None:
                await rig.playback_hook()
            return actual_playback_response(request)
        return await rig.request(request)

    rig.client = httpx.AsyncClient(transport=httpx.MockTransport(routed))
    bind(rig, tmp_path / "history.json")
    rig.router._client = rig.client
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services | {"get_playback_snapshot"},
    )
    session, _ = owner()
    configured = config()
    configured["music"][0].update(nativeRoomId="native-room", nativeHomepodId="42")
    bridge = PodViewBridge({"kitchen": session}, rig.router, control_policy=json.dumps(configured))
    token = bridge.grant_timer_control("kitchen")
    yield rig, bridge, token
    await rig.client.aclose()
    await original_client.aclose()


@pytest.fixture
async def offline_direct(tmp_path):
    """Real bounded owners on inert HA/PodConnect transports; no Voice PE link."""
    timer_manager, _, timer_client, timer_tools, timer_calls, _ = build_ha_timers()
    timers = timer_tools.timers
    timers.bindings.clear()
    timers.ready.clear()
    timers.snapshots.clear()
    timers.observed_at.clear()
    # The registered HA response, not a Voice PE handshake, must establish the
    # native endpoint before any browser controller grant can be minted.
    refreshed = await timers.refresh_registered(
        "kitchen", expected_kind="voice_pe", live_identity=None
    )
    assert refreshed["ok"] and timers.available("kitchen")
    assert timer_calls and all("action" not in call for call in timer_calls)

    robot = Rig()
    bind(robot, tmp_path / "cleaning-journal.json")
    music = MusicRig()
    room_owner(music)
    original_music_client = music.client

    async def routed_music(request):
        if request.url.path.endswith("/get_playback_snapshot"):
            return actual_playback_response(request, target="device", homepod="42")
        return await music.handle(request)

    music.client = httpx.AsyncClient(transport=httpx.MockTransport(routed_music))
    music.tools._client = music.client
    music.tools._discovery = replace(
        music.tools._discovery,
        podconnect_services=music.tools._discovery.podconnect_services | {"get_playback_snapshot"},
    )
    music.tools._device_control = robot.router._device_control
    session, _ = owner()
    session._active = False
    session.sm.state = State.IDLE
    session.tools.timers = timers
    configured = {
        "roomId": "kitchen",
        "music": [
            {
                "accountId": "account",
                "targetId": "device",
                "nativeRoomId": "native-room",
                "nativeHomepodId": "42",
                "actions": ["next", "play_track"],
                "maxVolume": 40,
            }
        ],
        "vacuum": [{"entityId": ROBOT, "actions": ["start"]}],
    }
    code = "a" * 43  # Explicit administrator-provisioned one-use pairing input.
    app = create_app(
        StatusHub(),
        {"kitchen": session},
        tools=music.tools,
        podview_control_policy=json.dumps(configured),
        podview_pairing_room="kitchen",
        podview_pairing_sha256=hashlib.sha256(code.encode()).hexdigest(),
        podview_pairing_store=tmp_path / "used",
        podview_controller_enabled=True,
        podview_controller_days=30,
        podview_controller_generation="c" * 64,
        podview_controller_store=tmp_path / "controllers" / "registry.json",
    )
    async with TestClient(TestServer(app)) as client:
        yield client, app[BRIDGE], code, timer_manager, timer_client, timers, robot, music
    await timer_client.aclose()
    await robot.client.aclose()
    await music.client.aclose()
    await original_music_client.aclose()


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
    assert reuse["ok"] and {row["action"] for row in reuse["options"]} == {"reuse", "start"}
    reused = action_body(reuse, next(row for row in reuse["options"] if row["action"] == "reuse"))
    reused["requestId"] = "reuse"
    assert (await bridge.controls.action(reused, token))["outcome"] == "accepted"
    assert len(rig.writes) == 6


async def test_accepted_history_draft_maps_current_ids_and_only_explicit_start_moves(fixture):
    rig, bridge, token = fixture
    device = rig.router._device_control
    offered = await device.display_setup(ROBOT, ("podview:seed", "history-source"))
    cap = device._display_tickets[offered["capability_token"]]
    recipe = {
        "vacuum_entity_id": ROBOT,
        "device_identity": cap.identity,
        "map_entity_id": cap.map_entity,
        "map_name": cap.map_name,
        "map_fingerprint": cap.map_fingerprint,
        "mapping_identity": cap.mapping_identity,
        "area_ids": ["kitchen"],
        "segments": [16],
        "repeat": 2,
        "verified_settings": [
            {"entity_id": ROBOT, "value": "balanced"},
            {"entity_id": MODE, "value": "vacuum_and_mop"},
        ],
    }
    record = device._cleaning_journal.begin(recipe)
    device._cleaning_journal.accepted(record)

    offer = await bridge.controls.setup(setup_body(bridge, recipeId=record), token)
    assert offer["ok"], offer
    assert not rig.writes
    start = next(row for row in offer["options"] if row["action"] == "start")
    draft = offer["setup"]["historyDraft"]
    assert draft == {
        "source": "accepted_start_history",
        "optionId": start["id"],
        "areaIds": [
            next(row["id"] for row in start["argsSchema"]["areas"] if row["label"] == "Køkkenalrum")
        ],
        "repeat": 2,
    }
    public = json.dumps(offer)
    assert '"area_ids"' not in public and '"verified_settings"' not in public
    dining = next(row["id"] for row in start["argsSchema"]["areas"] if row["label"] == "Spisestue")
    action = action_body(offer, start, {"areaIds": [dining], "repeat": 3})
    result = await bridge.controls.action(action, token)
    assert result["outcome"] == "accepted", result
    assert rig.writes == [
        ("services/select/select_option", {"entity_id": MODE, "option": "vacuum_and_mop"}),
        ("services/vacuum/set_fan_speed", {"entity_id": ROBOT, "fan_speed": "balanced"}),
        (
            "services/vacuum/send_command",
            {
                "entity_id": ROBOT,
                "command": "app_segment_clean",
                "params": [{"segments": [17], "repeat": 3}],
            },
        ),
    ]


async def test_history_reuse_only_remains_locked_and_old_area_ids_are_invalid(fixture):
    rig, bridge, token = fixture
    device = rig.router._device_control
    offered = await device.display_setup(ROBOT, ("podview:seed", "history-source"))
    cap = device._display_tickets[offered["capability_token"]]
    recipe = {
        "vacuum_entity_id": ROBOT,
        "device_identity": cap.identity,
        "map_entity_id": cap.map_entity,
        "map_name": cap.map_name,
        "map_fingerprint": cap.map_fingerprint,
        "mapping_identity": cap.mapping_identity,
        "area_ids": ["kitchen"],
        "segments": [16],
        "repeat": 1,
        "verified_settings": [],
    }
    record = device._cleaning_journal.begin(recipe)
    device._cleaning_journal.accepted(record)
    first = await bridge.controls.setup(setup_body(bridge, recipeId=record), token)
    old_area = first["setup"]["historyDraft"]["areaIds"][0]
    second = await bridge.controls.setup(setup_body(bridge, recipeId=record), token)
    second_start = next(row for row in second["options"] if row["action"] == "start")
    assert old_area != second["setup"]["historyDraft"]["areaIds"][0]
    stale = action_body(second, second_start, {"areaIds": [old_area], "repeat": 1})
    assert (await bridge.controls.action(stale, token))["error"] == "invalid_arguments"
    assert not rig.writes

    bridge.controls.policy["vacuum"][0]["actions"] = ["reuse"]
    locked = await bridge.controls.setup(setup_body(bridge, recipeId=record), token)
    assert locked["ok"] and len(locked["options"]) == 1
    assert locked["options"][0]["action"] == "reuse"
    assert locked["options"][0]["argsSchema"] == {"kind": "none"}
    assert "historyDraft" not in locked["setup"]
    assert not rig.writes


@pytest.mark.parametrize("invalid", ["unknown", "foreign", "changed_map", "unsupported_setting"])
async def test_history_draft_requires_current_accepted_recipe(fixture, invalid):
    rig, bridge, token = fixture
    device = rig.router._device_control
    offered = await device.display_setup(ROBOT, ("podview:seed", "history-source"))
    cap = device._display_tickets[offered["capability_token"]]
    recipe = {
        "vacuum_entity_id": ROBOT,
        "device_identity": cap.identity,
        "map_entity_id": cap.map_entity,
        "map_name": cap.map_name,
        "map_fingerprint": cap.map_fingerprint,
        "mapping_identity": cap.mapping_identity,
        "area_ids": ["kitchen"],
        "segments": [16],
        "repeat": 1,
        "verified_settings": [],
    }
    if invalid == "foreign":
        recipe["vacuum_entity_id"] = "vacuum.other"
    if invalid == "unsupported_setting":
        recipe["verified_settings"] = [{"entity_id": MODE, "value": "obsolete_mode"}]
    record = device._cleaning_journal.begin(recipe)
    if invalid != "unknown":
        device._cleaning_journal.accepted(record)
    if invalid == "changed_map":
        rig.states[MAP]["state"] = "Upstairs"
    result = await bridge.controls.setup(setup_body(bridge, recipeId=record), token)
    assert result["ok"] is False and result["error"] == "setup_unavailable"
    assert result["retryAllowed"] is False
    assert not rig.writes


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
    rig, bridge, token = fixture

    class Music:
        room_available = True
        room_start_available = False

        def binding(self):
            return (self,)

        async def setup_room(self, account, target, room, homepod, current):
            return {
                "ok": True,
                "data": {
                    "actions": ["pause", "next"],
                    "volume_percent": None,
                    "valid_until": time.time() + 15,
                },
            }

        execute_room = AsyncMock(return_value={"outcome": "unknown"})

    music = bridge.controls.music = Music()
    music.tools = bridge.tools
    offer = await bridge.controls.setup(setup_body(bridge, "music"), token)
    assert offer["ok"], offer
    assert {o["action"] for o in offer["options"]} == {"pause"}
    command = action_body(offer, offer["options"][0], {"percent": 41})
    assert (await bridge.controls.action(command, token))["error"] == "invalid_arguments"
    command["args"] = {}
    # Both callers await actual-output revalidation before either can consume the
    # task. The receipt/current/busy fence must still permit only one send.
    entered, ready, release = 0, asyncio.Event(), asyncio.Event()

    async def held_output():
        nonlocal entered
        entered += 1
        if entered == 2:
            ready.set()
        await release.wait()

    rig.playback_hook = held_output
    calls = [asyncio.create_task(bridge.controls.action(command, token)) for _ in range(2)]
    try:
        await asyncio.wait_for(ready.wait(), 2)
    finally:
        release.set()
    one, two = await asyncio.gather(*calls)
    rig.playback_hook = None
    assert one == two and one["outcome"] == "unknown"
    assert music.execute_room.await_count == 1
    assert (await bridge.controls.action({**command, "requestId": "fresh"}, token))[
        "error"
    ] == "stale_action"
    offer = await bridge.controls.setup(setup_body(bridge, "music"), token)
    bridge.sessions["kitchen"] = owner()[0]
    assert (await bridge.controls.action(action_body(offer, offer["options"][0]), token))[
        "error"
    ] == "stale_action"
    assert music.execute_room.await_count == 1


async def test_room_volume_uses_same_task_ceiling_and_duplicate_receipt(fixture):
    _, bridge, token = fixture
    bridge.controls.policy["music"][0]["actions"] = ["volume"]

    class Music:
        room_available = False
        volume_available = True
        room_start_available = False

        def binding(self):
            return (self,)

        async def setup_volume(self, account, target, room, homepod, current):
            assert (account, target, room, homepod) == (
                "account",
                "speaker",
                "native-room",
                "42",
            )
            return {
                "ok": True,
                "data": {
                    "actions": ["volume"],
                    "volume_state": {"base_percent": 27},
                    "valid_until": time.time() + 15,
                },
            }

        setup_room = AsyncMock()
        execute_volume = AsyncMock(return_value={"outcome": "unknown"})

    music = bridge.controls.music = Music()
    music.tools = bridge.tools
    offer = await bridge.controls.setup(setup_body(bridge, "music"), token)
    assert offer["ok"] and offer["setup"]["volume"] == 27
    option = offer["options"][0]
    assert option["action"] == "volume" and option["argsSchema"]["max"] == 40
    music.setup_room.assert_not_awaited()
    invalid = action_body(offer, option, {"percent": 41})
    assert (await bridge.controls.action(invalid, token))["error"] == "invalid_arguments"
    for bad in (True, -1, 1.5):
        assert (await bridge.controls.action(action_body(offer, option, {"percent": bad}), token))[
            "error"
        ] == "invalid_arguments"
    command = action_body(offer, option, {"percent": 0})
    first, duplicate = await asyncio.gather(
        bridge.controls.action(command, token), bridge.controls.action(command, token)
    )
    assert first == duplicate and first["outcome"] == "unknown"
    music.execute_volume.assert_awaited_once()
    assert music.execute_volume.await_args.args[1] == 0
    assert (await bridge.controls.action({**command, "requestId": "fresh"}, token))[
        "error"
    ] == "stale_action"


async def test_audio_and_volume_options_share_one_consumed_touch_task(fixture):
    _, bridge, token = fixture

    class Music:
        room_available = True
        volume_available = True
        room_start_available = False

        def binding(self):
            return (self,)

        async def setup_room(self, account, target, room, homepod, current):
            return {
                "ok": True,
                "data": {
                    "actions": ["pause"],
                    "valid_until": time.time() + 15,
                },
            }

        async def setup_volume(self, account, target, room, homepod, current):
            return {
                "ok": True,
                "data": {
                    "actions": ["volume"],
                    "volume_state": {"base_percent": 27},
                    "valid_until": time.time() + 15,
                },
            }

        execute_room = AsyncMock(return_value={"outcome": "accepted"})
        execute_volume = AsyncMock(return_value={"outcome": "accepted"})

    music = bridge.controls.music = Music()
    music.tools = bridge.tools
    offer = await bridge.controls.setup(setup_body(bridge, "music"), token)
    assert {row["action"] for row in offer["options"]} == {"pause", "volume"}
    volume = next(row for row in offer["options"] if row["action"] == "volume")
    pause = next(row for row in offer["options"] if row["action"] == "pause")
    assert (await bridge.controls.action(action_body(offer, volume, {"percent": 30}), token))[
        "outcome"
    ] == "accepted"
    music.execute_volume.assert_awaited_once()
    music.execute_room.assert_not_awaited()
    assert (await bridge.controls.action({**action_body(offer, pause), "requestId": "new"}, token))[
        "error"
    ] == "stale_action"


async def test_volume_only_missing_exact_owner_cannot_publish_empty_setup(fixture):
    _, bridge, token = fixture
    bridge.controls.policy["music"][0]["actions"] = ["volume"]

    class Music:
        room_available = False
        volume_available = True
        room_start_available = False

        def binding(self):
            return (self,)

        setup_room = AsyncMock()
        setup_volume = AsyncMock(return_value={"ok": False, "outcome": "rejected"})

    music = bridge.controls.music = Music()
    music.tools = bridge.tools
    assert "music" in bridge.controls.domains("kitchen", token)
    assert (await bridge.controls.setup(setup_body(bridge, "music"), token)) == {
        "ok": False,
        "error": "setup_unavailable",
        "retryAllowed": False,
    }
    assert not bridge.controls.tasks
    music.setup_room.assert_not_awaited()
    music.setup_volume.assert_awaited_once()


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
        room_available = True
        tools = bridge.tools
        setup_room = AsyncMock()

        def binding(self):
            return (self,)

    music = bridge.controls.music = Music()
    assert "music" in bridge.controls.domains("kitchen", token)
    bridge.tools = object()
    assert "music" not in bridge.controls.domains("kitchen", token)
    assert (await bridge.controls.setup(setup_body(bridge, "music"), token))[
        "error"
    ] == "scope_not_paired"
    music.setup_room.assert_not_awaited()


def test_room_start_and_queue_ingress_stay_closed_until_native_contract(fixture):
    _, bridge, token = fixture
    bridge.controls.policy["music"][0]["actions"] += ["play_track", "play_queue_occurrence"]
    assert bridge.controls.music.room_start_available is False
    assert not bridge.controls.selection_allowed("kitchen", token)
    assert not bridge.voice_music_available()
    assert not bridge.queue.available
    assert bridge.queue.rules("kitchen", token) == []


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
    assert [r["action"] for r in offer["options"] if r["action"] != "set_option"] == [action]
    assert all(r["action"] in {action, "set_option"} for r in offer["options"])
    assert all(
        r.get("settingKey") in {"cleaning_mode", "mop_intensity", "mop_mode", "suction"}
        for r in offer["options"]
        if r["action"] == "set_option"
    )
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
    bridge = SimpleNamespace(
        tools=tools,
        _grant_current=lambda room, token: token == "grant",
        _music_move_fence=set(),
    )
    music = SimpleNamespace(tools=tools, track_available=True, room_start_available=True)
    original = config()
    original["music"][0]["actions"] = ["pause", "play_track"]
    controls = TouchControls(bridge, json.dumps(original), music)
    assert not controls.selection_allowed("kitchen", "grant")
    original["music"][0].update(nativeRoomId="native-room", nativeHomepodId="homepod-id")
    controls = TouchControls(bridge, json.dumps(original), music)
    assert controls.selection_allowed("kitchen", "grant")
    assert not controls.selection_allowed("kitchen", "revoked")


async def _pair_offline_controller(client, code):
    response = await client.post(
        "/view/api/pair",
        json={"roomId": "kitchen", "code": code},
        headers={"X-PodView-Request": "1"},
    )
    assert response.status == 200, await response.text()
    assert (await response.json())["controllerEnrolled"] is True
    credential = response.cookies["podview_controller"].value
    grant = response.cookies["podview_control"].value
    return credential, grant


async def test_offline_cold_registered_ha_owner_runs_same_music_robot_and_timer_routes(
    offline_direct,
):
    client, bridge, code, manager, _timer_client, timers, robot, music = offline_direct
    unpaired = await (await client.get("/view/api/snapshot")).json()
    assert unpaired["voice"]["phase"] == "IDLE" and unpaired["voice"]["active"] is False
    assert unpaired["timers"]["status"] == "observed"
    assert unpaired["capabilities"]["timerActions"] == []
    assert unpaired["capabilities"]["controlSetup"] == []
    assert not robot.writes and not music.calls and manager.starts == 0

    credential, grant = await _pair_offline_controller(client, code)
    headers = {"X-PodView-Request": "1", "Cookie": f"podview_control={grant}"}
    paired = await (await client.get("/view/api/snapshot", headers=headers)).json()
    assert paired["voice"] == unpaired["voice"]
    assert paired["capabilities"]["controlSetup"] == ["music", "vacuum"]
    assert paired["capabilities"]["timerActions"] == ["timer.start", "timer.cancel"]
    assert timers.bindings["kitchen"] == (
        "voice_pe",
        "02:00:00:00:00:01",
        "genuine-fixture-device",
    )

    music_target = {
        "accountId": "account",
        "kind": "spotify_device",
        "targetId": "device",
        "expectedBindingId": ACTUAL_BINDING_ID,
    }
    music_body = {
        "bootId": bridge.boot_id,
        "roomId": "kitchen",
        "domain": "music",
        "target": music_target,
    }
    wrong_target = {**music_body, "target": {**music_target, "targetId": "foreign"}}
    denied = await (
        await client.post("/view/api/control/setup", json=wrong_target, headers=headers)
    ).json()
    assert denied["error"] == "target_not_granted" and not music.calls
    offer = await (
        await client.post("/view/api/control/setup", json=music_body, headers=headers)
    ).json()
    assert offer["ok"] and [option["action"] for option in offer["options"]] == ["next"]
    command = action_body(offer, offer["options"][0])
    result = await (
        await client.post("/view/api/control/actions", json=command, headers=headers)
    ).json()
    assert result["outcome"] == "accepted" and result["physicalResultVerified"] is False
    repeated = await (
        await client.post("/view/api/control/actions", json=command, headers=headers)
    ).json()
    assert repeated == result
    assert [call[1].rsplit("/", 1)[-1] for call in music.calls] == [
        "get_room_playback_controls",
        "control_room_playback",
    ]
    assert music.calls[-1][3]["room_id"] == "native-room"
    assert music.calls[-1][3]["homepod_id"] == "42"

    robot_body = setup_body(bridge)
    wrong_robot = {**robot_body, "target": {"entityId": "vacuum.foreign"}}
    denied = await (
        await client.post("/view/api/control/setup", json=wrong_robot, headers=headers)
    ).json()
    assert denied["error"] == "target_not_granted" and not robot.writes
    robot_offer = await (
        await client.post("/view/api/control/setup", json=robot_body, headers=headers)
    ).json()
    assert robot_offer["ok"]
    start = next(option for option in robot_offer["options"] if option["action"] == "start")
    robot_command = action_body(
        robot_offer,
        start,
        {"areaIds": [start["argsSchema"]["areas"][0]["id"]], "repeat": 2},
    )
    robot_command["requestId"] = "robot-start"
    robot_result = await (
        await client.post("/view/api/control/actions", json=robot_command, headers=headers)
    ).json()
    assert robot_result["outcome"] == "accepted"
    assert robot_result["physicalResultVerified"] is False
    assert (
        await (
            await client.post("/view/api/control/actions", json=robot_command, headers=headers)
        ).json()
        == robot_result
    )
    assert len(robot.writes) == 1

    timer_snapshot = await (await client.get("/view/api/snapshot", headers=headers)).json()
    timer_command = {
        "bootId": bridge.boot_id,
        "roomId": "kitchen",
        "taskId": f"timers:{timer_snapshot['timers']['epoch']}",
        "revision": timer_snapshot["revision"],
        "requestId": "timer-start",
        "action": "timer.start",
        "args": {"seconds": 60, "name": "Prøvetimer"},
    }
    timer_result = await (
        await client.post("/view/api/actions", json=timer_command, headers=headers)
    ).json()
    assert timer_result["outcome"] == "accepted"
    assert timer_result["physicalResultVerified"] is False
    assert (
        await (await client.post("/view/api/actions", json=timer_command, headers=headers)).json()
        == timer_result
    )
    assert manager.starts == 1
    assert bridge.sessions["kitchen"]._active is False  # No physical Voice PE or alarm claim.
    assert credential != grant


async def test_offline_registered_owner_renew_stale_and_revoke_fence_all_actions(offline_direct):
    client, bridge, code, _manager, _timer_client, timers, robot, music = offline_direct
    credential, grant = await _pair_offline_controller(client, code)
    grant_headers = {"X-PodView-Request": "1", "Cookie": f"podview_control={grant}"}
    old_offer = await (
        await client.post("/view/api/control/setup", json=setup_body(bridge), headers=grant_headers)
    ).json()
    assert old_offer["ok"]
    old_command = action_body(old_offer, old_offer["options"][0])
    timers.observed_at["kitchen"] -= 16
    assert (await (await client.get("/view/api/snapshot", headers=grant_headers)).json())[
        "capabilities"
    ]["controlSetup"] == []
    renewal = await client.post(
        "/view/api/controller/renew",
        json={"roomId": "kitchen"},
        headers={"X-PodView-Request": "1", "Cookie": f"podview_controller={credential}"},
    )
    assert renewal.status == 403
    assert (
        await (
            await client.post("/view/api/control/actions", json=old_command, headers=grant_headers)
        ).json()
    )["error"] == "stale_action"
    assert not robot.writes and not music.calls

    assert (
        await timers.refresh_registered("kitchen", expected_kind="voice_pe", live_identity=None)
    )["ok"]
    renewal = await client.post(
        "/view/api/controller/renew",
        json={"roomId": "kitchen"},
        headers={"X-PodView-Request": "1", "Cookie": f"podview_controller={credential}"},
    )
    assert renewal.status == 200
    fresh = renewal.cookies["podview_control"].value
    assert fresh != grant
    assert bridge._grant_current("kitchen", fresh)
    assert bridge.revoke("kitchen")
    assert not bridge._grant_current("kitchen", fresh)
    denied = await client.post(
        "/view/api/controller/renew",
        json={"roomId": "kitchen"},
        headers={"X-PodView-Request": "1", "Cookie": f"podview_controller={credential}"},
    )
    assert denied.status == 403 and not robot.writes and not music.calls


async def test_offline_registered_owner_starts_selected_music_once_without_voice_turn(
    offline_direct,
):
    client, bridge, code, _manager, _timer_client, _timers, robot, music = offline_direct
    content_owner(music)
    music.tools._discovery = replace(
        music.tools._discovery,
        podconnect_services=music.tools._discovery.podconnect_services | {"search_tracks"},
    )
    reader = MusicReadRig()
    original_client = music.client

    async def selected_music_transport(request):
        if request.url.path.endswith("/search_tracks"):
            return await reader.request(request)
        if request.url.path.endswith("/get_playback_snapshot"):
            return actual_playback_response(request, target="device", homepod="42")
        return await music.handle(request)

    music.client = httpx.AsyncClient(transport=httpx.MockTransport(selected_music_transport))
    music.tools._client = music.client
    try:
        _credential, grant = await _pair_offline_controller(client, code)
        headers = {"X-PodView-Request": "1", "Cookie": f"podview_control={grant}"}
        snap = await (await client.get("/view/api/snapshot", headers=headers)).json()
        assert snap["voice"]["phase"] == "IDLE" and snap["voice"]["active"] is False
        assert snap["capabilities"]["musicSelection"] is True

        search = await (
            await client.get(
                "/view/api/music?kind=search&account=account&query=jazz",
                headers={"Cookie": f"podview_control={grant}"},
            )
        ).json()
        assert search["ok"] and search["candidateSet"]["revisionScope"] == "music_selection"
        assert search["candidateSet"]["sessionId"].startswith("touch:")
        assert not music.calls and len(reader.calls) == 1
        setup = {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "candidateSetId": search["candidateSet"]["candidateSetId"],
            "target": {"accountId": "account", "kind": "spotify_device", "targetId": "device"},
        }
        offer = await (
            await client.post("/view/api/music/selection/setup", json=setup, headers=headers)
        ).json()
        assert offer["ok"] and len(offer["options"]) == 2
        assert offer["startVolumePercent"] == 35
        command = {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "taskId": offer["taskId"],
            "revision": offer["revision"],
            "optionId": offer["options"][1]["id"],
            "requestId": "selected-track",
            "confirmedVolumePercent": 35,
        }
        result = await (
            await client.post("/view/api/music/selection/actions", json=command, headers=headers)
        ).json()
        assert result["outcome"] == "accepted" and result["physicalResultVerified"] is False
        assert (
            await (
                await client.post(
                    "/view/api/music/selection/actions", json=command, headers=headers
                )
            ).json()
            == result
        )
        starts = [call for call in music.calls if call[1].endswith("start_room_selected_content")]
        assert len(starts) == 1 and starts[0][3]["room_id"] == "native-room"
        assert starts[0][3]["homepod_id"] == "42"
        assert starts[0][3]["config_entry_id"] == "account"
        assert starts[0][3]["target_id"] == "device"
        assert starts[0][3]["args"] == {
            "track_uri": "spotify:track:" + "0" * 21 + "1",
            "max_volume": 40,
        }
        assert not robot.writes  # A music choice cannot dispatch a robot action.
    finally:
        await original_client.aclose()
        await reader.client.aclose()


@pytest.mark.parametrize(
    "state,features,actions",
    [
        ("docked", 16, ["start", "settings", "pause", "stop", "return"]),
        ("idle", 16, ["start", "settings", "pause"]),
    ],
)
async def test_unused_transport_cannot_shorten_editable_start_task(
    fixture, monkeypatch, state, features, actions
):
    from gatekeeper import podview_controls

    rig, bridge, token = fixture
    rig.states[ROBOT]["state"] = state
    rig.states[ROBOT]["attributes"]["supported_features"] = features
    bridge.controls.policy["vacuum"][0]["actions"] = actions
    clock = podview_controls.time
    elapsed = 0
    monkeypatch.setattr(
        podview_controls,
        "time",
        SimpleNamespace(
            monotonic=lambda: clock.monotonic() + elapsed,
            time=lambda: clock.time() + elapsed,
        ),
    )
    device = rig.router._device_control
    original = device.display_setup

    async def slow_read(*args, **kwargs):
        nonlocal elapsed
        offer = await original(*args, **kwargs)
        elapsed = 14  # Simulate read latency without sleeping or sending an effect.
        return offer

    monkeypatch.setattr(device, "display_setup", slow_read)
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"], offer
    assert any(option["action"] == "start" for option in offer["options"])
    assert not any(
        option["action"] in {"pause", "stop", "return", "resume"} for option in offer["options"]
    )
    remaining = offer["expiresAt"] - podview_controls.time.time()
    assert 100 < remaining <= 106, remaining
    assert bridge.controls._current(bridge.controls.tasks[offer["taskId"]], token)
    assert not rig.writes


@pytest.mark.parametrize(
    "state,features,actions",
    [
        ("cleaning", 8, ["stop"]),
        ("idle", 16, ["start", "settings", "return"]),
    ],
)
async def test_executable_native_transport_keeps_original_short_deadline(
    fixture, state, features, actions
):
    from gatekeeper import podview_controls

    rig, bridge, token = fixture
    rig.states[ROBOT]["state"] = state
    rig.states[ROBOT]["attributes"]["supported_features"] = features
    bridge.controls.policy["vacuum"][0]["actions"] = actions
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"], offer
    assert any(option["action"] in {"stop", "return"} for option in offer["options"])
    task = bridge.controls.tasks[offer["taskId"]]
    assert task["deadline"] == task["vacuum_transport_offer"]["deadline"]
    assert 0 < offer["expiresAt"] - podview_controls.time.time() <= 15
    assert not rig.writes


async def test_optional_volume_read_cannot_hold_available_transport_offer(fixture):
    _, bridge, token = fixture
    volume_entered, volume_cancelled = asyncio.Event(), asyncio.Event()

    class Music:
        room_available = True
        volume_available = True
        room_start_available = False

        def binding(self):
            return (self,)

        async def setup_room(self, account, target, room, homepod, current):
            await volume_entered.wait()
            return {
                "ok": True,
                "data": {"actions": ["pause"], "valid_until": time.time() + 15},
            }

        async def setup_volume(self, account, target, room, homepod, current):
            volume_entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                volume_cancelled.set()

    music = bridge.controls.music = Music()
    music.tools = bridge.tools
    offer = await asyncio.wait_for(bridge.controls.setup(setup_body(bridge, "music"), token), 1)
    assert offer["ok"], offer
    assert [row["action"] for row in offer["options"]] == ["pause"]
    assert volume_cancelled.is_set()
    assert "kitchen" not in bridge.controls.busy


@pytest.mark.parametrize("action", ["next", "volume"])
@pytest.mark.parametrize("change", ["expiry", "grant", "grant_expiry", "owner"])
async def test_dispatched_music_receipt_keeps_ownership_after_offer_expiry(
    offline_direct, action, change
):
    """Exact receipts outlive presentation TTL, never a revoked execution owner."""
    from integration.test_podview_music_control import controls, volume_owner

    _, bridge, _, _, _, _, _, music = offline_direct
    if action == "volume":
        music.value = controls()
        volume_owner(music)
    bridge.controls.policy["music"][0]["actions"] = [action]
    token = bridge.grant_timer_control("kitchen")
    body = setup_body(bridge, "music")
    body["target"]["targetId"] = "device"
    offer = await bridge.controls.setup(body, token)
    assert offer["ok"], offer
    task = bridge.controls.tasks[offer["taskId"]]
    command = action_body(offer, offer["options"][0], {"percent": 0} if action == "volume" else {})
    service = "control_room_volume" if action == "volume" else "control_room_playback"

    async def response_after_boundary():
        if not music.calls[-1][1].endswith(service):
            return
        task["deadline"] = 0
        task["actual_binding"]["validUntil"] = 0
        if change == "grant":
            bridge.revoke("kitchen")
        elif change == "grant_expiry":
            slot = bridge._grant_slot("kitchen", token)
            grant = bridge._grants[slot]
            bridge._grants[slot] = (*grant[:-1], 0)
        elif change == "owner":
            bridge.sessions["kitchen"] = owner()[0]

    music.hook = response_after_boundary
    result = await bridge.controls.action(command, token)
    assert result["outcome"] == ("accepted" if change == "expiry" else "unknown")
    assert result["physicalResultVerified"] is False and result["retryAllowed"] is False
    assert len([call for call in music.calls if call[1].endswith(service)]) == 1
    repeated = await bridge.controls.action(command, token)
    if change == "expiry":
        # Receipt settlement does not renew the task for another request.
        assert repeated["error"] == "stale_action"
    assert len([call for call in music.calls if call[1].endswith(service)]) == 1


@pytest.mark.parametrize("action", ["next", "volume"])
async def test_music_offer_expired_before_dispatch_never_sends(offline_direct, action):
    from integration.test_podview_music_control import controls, volume_owner

    _, bridge, _, _, _, _, _, music = offline_direct
    if action == "volume":
        music.value = controls()
        volume_owner(music)
    bridge.controls.policy["music"][0]["actions"] = [action]
    token = bridge.grant_timer_control("kitchen")
    body = setup_body(bridge, "music")
    body["target"]["targetId"] = "device"
    offer = await bridge.controls.setup(body, token)
    assert offer["ok"], offer
    bridge.controls.tasks[offer["taskId"]]["deadline"] = 0
    command = action_body(offer, offer["options"][0], {"percent": 0} if action == "volume" else {})
    assert (await bridge.controls.action(command, token))["error"] == "stale_action"
    assert not any(
        call[1].endswith(("control_room_volume", "control_room_playback")) for call in music.calls
    )


async def test_explicit_volume_read_has_separate_task_and_only_volume(fixture):
    _, bridge, token = fixture
    entered, release = asyncio.Event(), asyncio.Event()

    class Music:
        room_available = True
        volume_available = True
        room_start_available = False

        def binding(self):
            return (self,)

        setup_room = AsyncMock(side_effect=AssertionError("volume must not read transport"))

        async def setup_volume(self, account, target, room, homepod, current):
            entered.set()
            await release.wait()
            assert current()
            return {
                "ok": True,
                "data": {
                    "actions": ["volume"],
                    "valid_until": time.time() + 4,
                    "volume_state": {"base_percent": 20},
                },
            }

    music = bridge.controls.music = Music()
    music.tools = bridge.tools
    body = {**setup_body(bridge, "music"), "requestedAction": "volume"}
    pending = asyncio.create_task(bridge.controls.setup(body, token))
    done, _ = await asyncio.wait(
        {pending, asyncio.create_task(entered.wait())}, return_when=asyncio.FIRST_COMPLETED
    )
    if pending in done:
        assert (await pending)["ok"]  # Old endpoint rejects the explicit selector.
    release.set()
    offer = await pending
    assert offer["ok"], offer
    assert [row["action"] for row in offer["options"]] == ["volume"]
    assert offer["setup"]["volume"] == 20
    assert (
        bridge.controls.tasks[offer["taskId"]]["volume_offered"]["volume_state"]["base_percent"]
        == 20
    )
    music.setup_room.assert_not_awaited()


@pytest.mark.parametrize("selector", [None, "pause", "", [], {"action": "volume"}])
async def test_volume_selector_is_closed(fixture, selector):
    rig, bridge, token = fixture
    body = {**setup_body(bridge, "music"), "requestedAction": selector}
    assert (await bridge.controls.setup(body, token))["error"] == "invalid_setup"
    assert not rig.writes


@pytest.mark.parametrize("domain", ["vacuum", "light", "music_move"])
async def test_volume_selector_rejects_other_domains_and_move(fixture, domain):
    rig, bridge, token = fixture
    body = setup_body(bridge, "music" if domain == "music_move" else domain)
    body["requestedAction"] = "volume"
    if domain == "music_move":
        body["target"]["speakerId"] = "a" * 64
    assert (await bridge.controls.setup(body, token))["error"] == "invalid_setup"
    assert not rig.writes


@pytest.mark.parametrize(
    "boundary", ["grant", "owner", "expiry", "cancel", "capacity", "unavailable"]
)
async def test_explicit_volume_retains_setup_boundaries(fixture, boundary):
    rig, bridge, token = fixture
    entered, release, cancelled = asyncio.Event(), asyncio.Event(), asyncio.Event()

    class Music:
        room_available = True
        volume_available = True
        room_start_available = False

        def binding(self):
            return (self,)

        setup_room = AsyncMock(side_effect=AssertionError("transport read"))

        async def setup_volume(self, account, target, room, homepod, current):
            entered.set()
            try:
                await release.wait()
            finally:
                cancelled.set()
            return {
                "ok": boundary != "unavailable",
                "data": {
                    "actions": ["volume"],
                    "valid_until": 0 if boundary == "expiry" else time.time() + 4,
                    "volume_state": {"base_percent": 20},
                },
            }

    music = bridge.controls.music = Music()
    music.tools = bridge.tools
    body = {**setup_body(bridge, "music"), "requestedAction": "volume"}
    if boundary == "capacity":
        # Exercise the existing task cap; no new volume-specific capacity.
        bridge.controls.tasks = {str(i): {"token": token} for i in range(64)}
        bridge.controls._current = lambda *args: True
        assert (await bridge.controls.setup(body, token))["error"] == "setup_capacity"
        assert not entered.is_set()
        return
    pending = asyncio.create_task(bridge.controls.setup(body, token))
    await entered.wait()
    if boundary == "grant":
        bridge.revoke("kitchen")
    elif boundary == "owner":
        bridge.sessions["kitchen"] = owner()[0]
    elif boundary == "cancel":
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending
        assert cancelled.is_set() and "kitchen" not in bridge.controls.busy
        assert not bridge.controls.tasks and not rig.writes
        return
    release.set()
    assert not (await pending)["ok"]
    assert not bridge.controls.tasks and not rig.writes
    assert "kitchen" not in bridge.controls.busy
    music.setup_room.assert_not_awaited()


async def test_explicit_volume_offer_does_not_borrow_transport_authority(offline_direct):
    from integration.test_podview_music_control import controls, volume_owner

    _, bridge, _, _, _, _, _, music = offline_direct
    music.value = controls()
    room_owner(music)
    room_value = dict(music.value)
    music.value = controls()
    volume_owner(music)
    volume_value = dict(music.value)
    original_handle = music.handle

    async def handle(request):
        music.value = (
            volume_value if request.url.path.endswith("get_room_volume_controls") else room_value
        )
        return await original_handle(request)

    music.handle = handle
    bridge.controls.policy["music"][0]["actions"] = ["next", "volume"]
    token = bridge.grant_timer_control("kitchen")
    body = setup_body(bridge, "music")
    body["target"]["targetId"] = "device"
    normal = await bridge.controls.setup(body, token)
    explicit = await bridge.controls.setup({**body, "requestedAction": "volume"}, token)
    assert normal["ok"] and explicit["ok"]
    assert normal["taskId"] != explicit["taskId"]
    assert [row["action"] for row in explicit["options"]] == ["volume"]
    assert bridge.controls._current(bridge.controls.tasks[normal["taskId"]], token)
    volume = explicit["options"][0]
    mixed = action_body(explicit, volume, {"percent": 10})
    mixed["taskId"] = normal["taskId"]
    assert (await bridge.controls.action(mixed, token))["error"] == "unknown_option"
    command = action_body(explicit, volume, {"percent": 10})
    receipt = await bridge.controls.action(command, token)
    assert receipt["outcome"] == "accepted"
    assert await bridge.controls.action(command, token) == receipt
    assert len([call for call in music.calls if call[1].endswith("control_room_volume")]) == 1
