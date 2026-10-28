"""Exact configured destination is the only paired MOVE option."""

import json
import time
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from integration.test_podview_bridge import owner
from integration.test_podview_controls import action_body
from integration.test_podview_music import payload as playback_payload
from unit.test_device_control import Rig
from unit.test_podview_speakers import payload

from gatekeeper import podview_room_media, podview_speakers
from gatekeeper.podview import PodViewBridge
from gatekeeper.podview_controls import policy
from gatekeeper.podview_music import project_owner

ACTUAL_BINDING = "b" * 64


def actual_playback(account="account", target="speaker", room="r0", homepod="42"):
    """Control observation supplied independently of the room's DEFAULT/NEXT intent."""
    raw = playback_payload("playback", account)
    raw["playback"]["target"]["target_id"] = target
    value = project_owner("playback", raw, account)["data"]
    value["schema"] = "podconnect.playback.v2"
    value["output"] = {
        "status": "observed",
        "reason": None,
        "binding": {
            "target_id": target,
            "native_room_id": room,
            "homepod_id": homepod,
            "binding_id": ACTUAL_BINDING,
            "valid_until": time.time() + 4,
        },
    }
    return value


def install_actual_playback(rig):
    """Use the real passive router with an inert Control aggregate response."""
    value = actual_playback()
    original = rig.request

    async def request(req):
        if req.url.path == "/core/api/services/podconnect/get_playback_snapshot":
            assert json.loads(req.content) == {"config_entry_id": "account", "include_output": True}
            return httpx.Response(200, json={"service_response": value})
        return await original(req)

    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services | {"get_playback_snapshot"},
    )
    rig.client._transport = httpx.MockTransport(request)
    return value


def configuration():
    return {
        "roomId": "kitchen",
        "music": [
            {
                "accountId": "account",
                "targetId": "speaker",
                "nativeRoomId": "r0",
                "nativeHomepodId": "42",
                "actions": ["pause", "volume", "move_existing_session"],
                "maxVolume": 40,
                "default": True,
            },
            {
                "accountId": "account",
                "targetId": "speaker",
                "nativeRoomId": "r1",
                "nativeHomepodId": "43",
                "actions": ["pause", "volume", "move_existing_session"],
                "maxVolume": 40,
                "default": False,
            },
        ],
        "vacuum": [],
    }


def test_multidestination_policy_requires_unique_default_and_native_pair():
    value = configuration()
    assert policy(json.dumps(value)) == value
    assert (
        podview_room_media.room_bindings(
            SimpleNamespace(
                controls=SimpleNamespace(policy=value),
                sessions={"kitchen": object()},
                tools=SimpleNamespace(podview_music_binding=lambda: ("owner",)),
            ),
            "kitchen",
        )[0]["nativeRoomId"]
        == "r0"
    )
    value["music"][0]["default"] = False
    assert policy(json.dumps(value)) == {}
    value["music"][0]["default"] = True
    value["music"][1]["nativeHomepodId"] = "42"
    value["music"][1]["nativeRoomId"] = "r0"
    assert policy(json.dumps(value)) == {}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "revoke_during_read,late_receipt", [(False, False), (True, False), (False, True)]
)
async def test_actual_touch_task_uses_fresh_exact_alias_and_consumes_move(
    monkeypatch, revoke_during_read, late_receipt
):
    rig = Rig()
    session, _ = owner()
    bridge = PodViewBridge(
        {"kitchen": session}, rig.router, control_policy=json.dumps(configuration())
    )
    install_actual_playback(rig)
    token = bridge.grant_timer_control("kitchen")
    source = payload()
    source["targets"][-1]["target_id"] = "speaker"
    reads = 0

    async def read_service(_tools, _account):
        nonlocal reads
        reads += 1
        if revoke_during_read and reads == 2:
            bridge.revoke("kitchen")
        return source

    monkeypatch.setattr(podview_speakers, "read_service", read_service)
    destination = podview_speakers.project(
        source, boot=bridge.boot_id, room="kitchen", account="account", default_room="r0"
    )["speakers"][1]
    offer = SimpleNamespace(
        deadline=time.monotonic() + 5,
        wire={
            "owner_epoch": "owner",
            "poll_sequence": 1,
            "move_offer": {"native_incarnation": "a" * 32},
        },
    )

    class Move:
        available = True
        tools = rig.router

        def binding(self):
            return rig.router.podview_music_binding()

        setup = AsyncMock(return_value=offer)
        move = AsyncMock(return_value={"outcome": "accepted", "accepted_room_move": True})

    bridge.controls.move = Move()
    proof = AsyncMock(return_value=True)
    monkeypatch.setattr(podview_room_media, "confirm_move_destination", proof)
    body = {
        "bootId": bridge.boot_id,
        "roomId": "kitchen",
        "domain": "music",
        "target": {
            "accountId": "account",
            "kind": "spotify_device",
            "targetId": "speaker",
            "speakerId": destination["speakerId"],
            "expectedBindingId": ACTUAL_BINDING,
        },
    }
    bridge.controls.policy["music"][1]["targetId"] = "foreign-engine"
    foreign = {**body, "target": {**body["target"], "targetId": "foreign-engine"}}
    assert (await bridge.controls.setup(foreign, token))["error"] == "target_not_granted"
    bridge.controls.policy["music"][1]["targetId"] = "speaker"
    setup = await bridge.controls.setup(body, token)
    assert setup["ok"], setup
    assert setup["expectedBindingId"] == ACTUAL_BINDING
    assert setup["options"] == [
        {
            "id": "move:" + destination["speakerId"],
            "label": "Flyt til Soveværelse",
            "action": "move_existing_session",
            "argsSchema": {"kind": "none"},
        }
    ]
    bridge.controls.move.setup.assert_not_awaited()
    action = action_body(setup, setup["options"][0])
    if late_receipt:

        async def complete_after_snapshot_expiry(*args, receipt_current):
            task = bridge.controls.tasks[setup["taskId"]]
            task["deadline"] = 0
            task["actual_binding"]["validUntil"] = 0
            assert not args[1]()
            assert receipt_current()
            return {"outcome": "accepted", "accepted_room_move": True}

        bridge.controls.move.move.side_effect = complete_after_snapshot_expiry

        async def confirm_retained(*args):
            assert args[-1]()
            return True

        proof.side_effect = confirm_retained
    result = await bridge.controls.action(action, token)
    if revoke_during_read:
        assert result["outcome"] == "rejected" and not bridge._music_move_fence
        bridge.controls.move.setup.assert_not_awaited()
        bridge.controls.move.move.assert_not_awaited()
        await rig.client.aclose()
        return
    assert result["outcome"] == "accepted"
    bridge.controls.move.setup.assert_awaited_once()
    assert bridge.controls.move.setup.await_args.args[:4] == ("account", "speaker", "r1", "43")
    if late_receipt:
        assert (await bridge.controls.action(action, token))["error"] == "stale_action"
    else:
        assert await bridge.controls.action(action, token) == result
    bridge.controls.move.move.assert_awaited_once()
    proof.assert_awaited_once()
    assert not bridge._music_move_fence
    await rig.client.aclose()


@pytest.mark.asyncio
async def test_unknown_move_keeps_all_other_music_effects_closed(monkeypatch):
    rig = Rig()
    session, _ = owner()
    bridge = PodViewBridge(
        {"kitchen": session}, rig.router, control_policy=json.dumps(configuration())
    )
    install_actual_playback(rig)
    token = bridge.grant_timer_control("kitchen")
    source = payload()
    source["targets"][-1]["target_id"] = "speaker"
    monkeypatch.setattr(podview_speakers, "read_service", AsyncMock(return_value=source))
    destination = podview_speakers.project(
        source, boot=bridge.boot_id, room="kitchen", account="account", default_room="r0"
    )["speakers"][1]

    class Move:
        available = True

        def binding(self):
            return rig.router.podview_music_binding()

        setup = AsyncMock(return_value=SimpleNamespace(deadline=time.monotonic() + 5))
        move = AsyncMock(return_value={"outcome": "unknown"})

    bridge.controls.move = Move()
    body = {
        "bootId": bridge.boot_id,
        "roomId": "kitchen",
        "domain": "music",
        "target": {
            "accountId": "account",
            "kind": "spotify_device",
            "targetId": "speaker",
            "speakerId": destination["speakerId"],
            "expectedBindingId": ACTUAL_BINDING,
        },
    }
    setup = await bridge.controls.setup(body, token)
    assert setup["ok"]
    result = await bridge.controls.action(action_body(setup, setup["options"][0]), token)
    assert result["outcome"] == "unknown" and result["retryAllowed"] is False
    assert bridge._music_move_fence == {("kitchen", "account")}
    assert "music" not in bridge.controls.domains("kitchen", token)
    await rig.client.aclose()


@pytest.mark.asyncio
async def test_changed_actual_binding_rejects_move_before_staging_without_rewriting_intent(
    monkeypatch,
):
    rig = Rig()
    session, _ = owner()
    bridge = PodViewBridge(
        {"kitchen": session}, rig.router, control_policy=json.dumps(configuration())
    )
    actual = install_actual_playback(rig)
    token = bridge.grant_timer_control("kitchen")
    source = payload()
    source["targets"][-1]["target_id"] = "speaker"
    monkeypatch.setattr(podview_speakers, "read_service", AsyncMock(return_value=source))
    destination = podview_speakers.project(
        source, boot=bridge.boot_id, room="kitchen", account="account", default_room="r0"
    )["speakers"][1]

    class Move:
        available = True

        def binding(self):
            return rig.router.podview_music_binding()

        setup = AsyncMock()
        move = AsyncMock()

    bridge.controls.move = Move()
    setup = await bridge.controls.setup(
        {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "domain": "music",
            "target": {
                "accountId": "account",
                "kind": "spotify_device",
                "targetId": "speaker",
                "speakerId": destination["speakerId"],
                "expectedBindingId": ACTUAL_BINDING,
            },
        },
        token,
    )
    assert setup["ok"], setup
    configured = json.dumps(bridge.controls.policy, sort_keys=True)
    intent = dict(bridge._music_destinations)
    actual["output"]["binding"].update(native_room_id="r1", homepod_id="43", binding_id="c" * 64)
    result = await bridge.controls.action(action_body(setup, setup["options"][0]), token)
    assert result["ok"] is False and result["error"] == "stale_action"
    bridge.controls.move.setup.assert_not_awaited()
    bridge.controls.move.move.assert_not_awaited()
    assert json.dumps(bridge.controls.policy, sort_keys=True) == configured
    assert bridge._music_destinations == intent
    await rig.client.aclose()


@pytest.mark.asyncio
async def test_effective_destination_requires_new_matching_account_alias_and_native_read(
    monkeypatch,
):
    from integration.test_podview_music import payload as playback_payload

    account, engine = "account-alpha", "device-one"
    raw = playback_payload("playback", account)
    source = payload()
    source["config_entry_id"] = account
    source["targets"][-1]["target_id"] = engine
    for row in source["targets"][:2]:
        row["binding"]["room_id"] = "r1"
    source["targets"][2]["selected"] = False
    source["targets"][3]["selected"] = True
    monkeypatch.setattr(podview_speakers, "read_service", AsyncMock(return_value=source))
    destination = podview_speakers.project(
        source, boot="boot", room="kitchen", account=account, default_room="r0"
    )["speakers"][1]
    configured = configuration()
    for row in configured["music"]:
        row["accountId"], row["targetId"] = account, engine
    policy_object = policy(json.dumps(configured))
    binding_owner = ("live-owner",)
    tools = SimpleNamespace(
        podview_read=AsyncMock(return_value={"ok": True, "data": raw}),
        podview_music_binding=lambda: binding_owner,
    )
    owner = source["targets"][1]["binding"]
    native = {
        "target_id": engine,
        "room_id": "r1",
        "homepod_id": "43",
        "alias_incarnation": owner["incarnation"],
        "alias_registry": owner["registry"],
    }
    route = {"device_id": "43"}
    music = SimpleNamespace(
        observe_room=AsyncMock(
            return_value={
                "ok": True,
                "data": {
                    "native": native,
                    "route": route,
                    "owner_epoch": "a" * 32,
                    "poll_sequence": 4,
                    "valid_until": time.time() + 5,
                },
            }
        )
    )
    bridge = SimpleNamespace(
        boot_id="boot",
        tools=tools,
        sessions={"kitchen": object()},
        controls=SimpleNamespace(policy=policy_object, music=music, tasks={"old": {}}),
        music_selection=SimpleNamespace(sources={"old": {}}, tasks={"old": {}}),
        queue=SimpleNamespace(tasks={"old": {}}),
        _music_cache={"old": {}},
        _music_destinations={},
        _music_move_fence=set(),
    )
    offer = SimpleNamespace(
        wire={
            "owner_epoch": "a" * 32,
            "poll_sequence": 4,
            "move_offer": {"native_incarnation": "a" * 32},
        }
    )
    task = {
        "id": "move-task",
        "room": "kitchen",
        "target": {"accountId": account, "targetId": engine},
        "move_destination": destination,
        "move_offer": offer,
        "rule": policy_object["music"][1],
    }
    assert await podview_room_media.confirm_move_destination(
        bridge, task, {"outcome": "accepted"}, lambda: True
    )
    assert podview_room_media.binding(bridge, "kitchen", account)["nativeRoomId"] == "r1"
    assert task["move_source_scope"][0] == engine
    assert bridge.controls.tasks == {"move-task": task} and not bridge.queue.tasks
    assert not bridge.music_selection.sources and not bridge._music_cache
    previous = bridge._music_destinations[("kitchen", account)]
    tools.podview_music_binding = lambda: ("replacement-owner",)
    assert podview_room_media.binding(bridge, "kitchen", account) is None
    assert bridge._music_destinations[("kitchen", account)] is previous
    assert bridge._music_move_fence == {("kitchen", account)}
    tools.podview_music_binding = lambda: binding_owner
    bridge._music_move_fence.clear()
    bridge._music_destinations.clear()
    route["device_id"] = "42"
    assert not await podview_room_media.confirm_move_destination(
        bridge, task, {"outcome": "accepted"}, lambda: True
    )
    assert podview_room_media.binding(bridge, "kitchen", account)["nativeRoomId"] == "r0"


@pytest.mark.asyncio
async def test_inert_touch_move_a_b_a_then_current_controls(monkeypatch):
    """The real bridge consumes two moves and rebinds later JIT controls to A."""
    rig = Rig()
    session, _ = owner()
    config = configuration()
    for rule in config["music"]:
        rule["actions"] = ["pause", "resume", "volume", "move_existing_session"]
    bridge = PodViewBridge({"kitchen": session}, rig.router, control_policy=json.dumps(config))
    actual = install_actual_playback(rig)
    token = bridge.grant_timer_control("kitchen")
    source = payload()
    source["targets"][-1]["target_id"] = "speaker"
    raw = playback_payload("playback", "account")
    raw["playback"]["target"]["target_id"] = "speaker"

    async def passive_read(kind, account, **kwargs):
        return {"ok": True, "data": actual if kwargs.get("include_output") else raw}

    monkeypatch.setattr(rig.router, "podview_read", passive_read)
    monkeypatch.setattr(podview_speakers, "read_service", AsyncMock(return_value=source))
    writes = []

    class Music:
        room_available = volume_available = True
        room_start_available = _transport_available = False
        tools = rig.router

        def binding(self):
            return (self,)

        async def observe_room(self, account, engine, room, hp, current):
            assert current() and (account, engine) == ("account", "speaker")
            alias = next(
                row["binding"]
                for row in source["targets"]
                if row["kind"] == "configured_alias" and row["target_id"] == room
            )
            return {
                "ok": True,
                "data": {
                    "native": {
                        "target_id": engine,
                        "room_id": room,
                        "homepod_id": hp,
                        "alias_incarnation": alias["incarnation"],
                        "alias_registry": alias["registry"],
                    },
                    "route": {"device_id": hp},
                    "owner_epoch": raw["owner_epoch"],
                    "poll_sequence": raw["poll_sequence"],
                    "valid_until": time.time() + 5,
                },
            }

        async def setup_room(self, account, engine, room, hp, current):
            assert current() and (room, hp) == ("r0", "42")
            return {
                "ok": True,
                "data": {
                    "actions": ["pause", "resume"],
                    "volume_percent": None,
                    "valid_until": time.time() + 5,
                },
            }

        async def setup_volume(self, account, engine, room, hp, current):
            assert current() and (room, hp) == ("r0", "42")
            return {
                "ok": True,
                "data": {
                    "actions": ["volume"],
                    "volume_state": {"base_percent": 27},
                    "valid_until": time.time() + 5,
                },
            }

        async def execute_room(self, offer, action, current, *, receipt_current):
            assert current() and receipt_current()
            writes.append((action, "r0", "42"))
            return {"outcome": "accepted"}

        async def execute_volume(self, offer, percent, current, *, receipt_current):
            assert current() and receipt_current()
            writes.append(("volume", percent))
            return {"outcome": "accepted"}

    class Move:
        available = True
        tools = rig.router

        def binding(self):
            return rig.router.podview_music_binding()

        async def setup(self, account, engine, room, hp, current):
            assert current()
            return SimpleNamespace(
                deadline=time.monotonic() + 5,
                wire={
                    "owner_epoch": raw["owner_epoch"],
                    "poll_sequence": raw["poll_sequence"],
                    "move_offer": {"native_incarnation": "a" * 32},
                },
                destination=(room, hp),
            )

        async def move(self, offer, current, *, receipt_current):
            assert current() and receipt_current()
            room, hp = offer.destination
            writes.append(("move", room, hp))
            actual["output"]["binding"].update(
                native_room_id=room,
                homepod_id=hp,
                binding_id=("c" if room == "r1" else "d") * 64,
                valid_until=time.time() + 5,
            )
            for row in source["targets"]:
                if row["kind"] == "configured_alias":
                    row["binding"]["room_id"] = room
                if row["kind"] == "observed_output":
                    row["selected"] = row["target_id"] == hp
            return {"outcome": "accepted", "accepted_room_move": True}

    bridge.controls.music = Music()
    bridge.controls.move = Move()
    assert bridge.controls._move_revision("kitchen"), bridge.snapshot("kitchen")
    try:
        for index, (room, hp, current_binding) in enumerate(
            [("r1", "43", ACTUAL_BINDING), ("r0", "42", "c" * 64)]
        ):
            destination = next(
                row
                for row in podview_speakers.project(
                    source,
                    boot=bridge.boot_id,
                    room="kitchen",
                    account="account",
                    default_room=None,
                )["speakers"]
                if row["nativeRoomId"] == room
            )
            body = {
                "bootId": bridge.boot_id,
                "roomId": "kitchen",
                "domain": "music",
                "target": {
                    "accountId": "account",
                    "kind": "spotify_device",
                    "targetId": "speaker",
                    "speakerId": destination["speakerId"],
                    "expectedBindingId": current_binding,
                },
            }
            offer = await bridge.controls.setup(body, token)
            assert offer["ok"], (index, offer)
            command = action_body(offer, offer["options"][0]) | {"requestId": f"move-{index}"}
            result = await bridge.controls.action(command, token)
            assert result["outcome"] == "accepted", result
            assert not bridge._music_move_fence
            scope = podview_room_media.binding(bridge, "kitchen", "account")
            assert (scope["nativeRoomId"], scope["nativeHomepodId"]) == (room, hp)
        stale_target = {
            "accountId": "account",
            "kind": "spotify_device",
            "targetId": "speaker",
            "expectedBindingId": "c" * 64,
        }
        stale = await bridge.controls.setup(
            {
                "bootId": bridge.boot_id,
                "roomId": "kitchen",
                "domain": "music",
                "target": stale_target,
            },
            token,
        )
        assert not stale["ok"] and len(writes) == 2
        for action in ("pause", "resume", "volume"):
            target = {
                "accountId": "account",
                "kind": "spotify_device",
                "targetId": "speaker",
                "expectedBindingId": "d" * 64,
            }
            body = {
                "bootId": bridge.boot_id,
                "roomId": "kitchen",
                "domain": "music",
                "target": target,
                **({"requestedAction": "volume"} if action == "volume" else {}),
            }
            offer = await bridge.controls.setup(body, token)
            assert offer["ok"], (index, offer)
            option = next(row for row in offer["options"] if row["action"] == action)
            command = action_body(offer, option, {"percent": 20} if action == "volume" else {}) | {
                "requestId": f"control-{action}"
            }
            before = actual["playback"]["state"]
            result = await bridge.controls.action(command, token)
            assert result["outcome"] == "accepted" and result["physicalResultVerified"] is False, (
                result
            )
            assert actual["playback"]["state"] == before  # ACK is not an observation.
            if action in {"pause", "resume"}:
                observed = "paused" if action == "pause" else "playing"
                actual["playback"]["state"] = raw["playback"]["state"] = observed
                witness = await rig.router.podview_read("playback", "account", include_output=True)
                assert witness["data"]["playback"]["state"] == observed
                assert witness["data"]["output"]["binding"]["binding_id"] == "d" * 64
        assert writes == [
            ("move", "r1", "43"),
            ("move", "r0", "42"),
            ("pause", "r0", "42"),
            ("resume", "r0", "42"),
            ("volume", 20),
        ]
    finally:
        await rig.client.aclose()
