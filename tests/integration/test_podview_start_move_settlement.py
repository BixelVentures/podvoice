"""Exact retained START/MOVE receipts remain private until a current source read."""

import asyncio
import copy
import hashlib
import json
import time
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_bridge import owner
from integration.test_podview_controls import action_body
from integration.test_podview_playback_controls import read, retained_room_receipt
from integration.test_podview_room_move_caller import (
    ACTUAL_BINDING,
    configuration,
    install_actual_playback,
)
from unit.test_device_control import Rig
from unit.test_podview_speakers import payload

from gatekeeper import podview_room_media, podview_speakers
from gatekeeper.podview import BRIDGE, PodViewBridge, _music_binding
from gatekeeper.podview_room_media import binding

pytest_plugins = [
    "integration.test_podview_playback_controls",
    "integration.test_podview_music_selection",
]


def control_settlement(identity, *, status="confirmed"):
    return {
        "schema": "podconnect.command_settlement.v1",
        "status": status,
        **identity,
        "observation": (
            {"source": "native_bound_state", "effect_revision": "12", "prepare_id": "c" * 32}
            if status == "confirmed"
            else None
        ),
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("document", [False, True])
async def test_actual_selected_action_retains_exact_identity_without_public_operation_id(
    rig, document
):
    bridge = rig.app[BRIDGE]
    identity = {"owner_epoch": "a" * 32, "command_sequence": 1, "request_id": "a" * 32 + ":1"}
    bridge.controls.music.execute_track.return_value = {
        "schema": "podconnect.command.v1",
        "config_entry_id": "account-alpha",
        "action": "play_track",
        "target": {"kind": "spotify_device", "target_id": "device-one"},
        "room_id": "native-room",
        "homepod_id": "homepod-id",
        **identity,
        "outcome": "accepted",
        "accepted_selected_content": True,
        "start_operation_id": "c" * 32,
    }
    headers = {"Cookie": "podview_control=grant", "X-PodView-Request": "1"}
    other = {**headers, "X-PodView-Music-Document": "2" * 32}
    if document:
        headers["X-PodView-Music-Document"] = "1" * 32
    search = "/view/api/music?kind=search&account=account-alpha&query=jazz"
    async with TestClient(TestServer(rig.app)) as client:
        source = await (
            await client.get(
                search,
                headers=headers,
            )
        ).json()
        offer = await (
            await client.post(
                "/view/api/music/selection/setup",
                headers=headers,
                json={
                    "bootId": bridge.boot_id,
                    "roomId": "kitchen",
                    "candidateSetId": source["candidateSet"]["candidateSetId"],
                    "target": {
                        "accountId": "account-alpha",
                        "kind": "spotify_device",
                        "targetId": "device-one",
                    },
                },
            )
        ).json()
        action = {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "taskId": offer["taskId"],
            "revision": offer["revision"],
            "optionId": offer["options"][0]["id"],
            "requestId": "selected-one",
            "confirmedVolumePercent": 35,
        }

        async def send():
            return await (
                await client.post("/view/api/music/selection/actions", headers=headers, json=action)
            ).json()

        if document:
            execute = bridge.controls.music.execute_track
            entered, release = asyncio.Event(), asyncio.Event()

            async def held(*args):
                entered.set()
                await release.wait()
                return execute.return_value

            execute.side_effect = held
            pending = asyncio.create_task(send())
            try:
                await asyncio.wait_for(entered.wait(), 2)
                async with client.get(search, headers=other) as response:
                    assert response.status == 429
                    assert (await response.json())["error"] == "music_busy"
            finally:
                release.set()
                first = await pending
            retained = bridge.music_selection.sources[offer["candidateSetId"]]
            retained["deadline"] = time.monotonic() - 1
            async with client.get(search, headers=other) as response:
                assert response.status == 200
                assert (await response.json())["candidateSet"]["candidateSetId"] != offer[
                    "candidateSetId"
                ]
            assert bridge.music_selection.sources[offer["candidateSetId"]] is retained
        else:
            first = await send()
        again = await send()
    assert first == again and first["outcome"] == "accepted"
    assert "start_operation_id" not in json.dumps(first)
    assert bridge.controls.music.execute_track.await_count == 1
    assert (
        bridge.music_selection.settlement_identity(
            bridge, "kitchen", "grant", "selected-one", "account-alpha"
        )
        == identity
    )


def selected_receipt(rig, *, request_id="selected-one"):
    bridge = rig.bridge
    bridge.controls.policy["music"][0]["actions"].append("play_track")
    bridge.controls.policy["music"][0]["maxVolume"] = 40
    current_binding = binding(bridge, "kitchen", "account-alpha")
    assert rig.value["output"]["binding"]["binding_id"] != current_binding["bindingId"]
    grant = bridge._grant_for_token("kitchen", rig.token)
    context = {
        "roomId": "kitchen",
        "revisionScope": "music_selection",
        "query": "jazz",
        "sessionId": "touch-session",
        "turnId": "touch-turn",
        "taskId": "touch-task",
        "inputRevision": 1,
        "revision": 1,
    }
    bridge._touch_music_contexts[
        (
            "kitchen",
            "account-alpha",
            "jazz",
            hashlib.sha256(rig.token.encode()).hexdigest(),
        )
    ] = (time.monotonic() + 60, context)
    source = {
        "context": context,
        "binding": _music_binding(bridge, "kitchen"),
    }
    task = {
        "id": "selected-task",
        "candidateSetId": "selected-source",
        "context": source["context"],
        "ownerBinding": source["binding"],
        "authority": (rig.session, getattr(rig.session, "_epoch", None), "answer", grant),
        "account": "account-alpha",
        "target": "device-one",
        "maxVolume": 40,
        "nativeBinding": ("r0", "42"),
        "action": "play_track",
    }
    bridge.music_selection.tasks[task["id"]] = task
    bridge.music_selection.sources[task["candidateSetId"]] = source
    identity = {"request_id": "a" * 32 + ":1", "command_sequence": 1, "owner_epoch": "a" * 32}
    receipt = (
        "fingerprint",
        {"outcome": "accepted", "requestId": request_id},
        {
            "task": task,
            "source": source,
            "controls": bridge.controls,
            "music": bridge.controls.music,
            "policy": bridge.controls.policy,
            "policy_bytes": json.dumps(bridge.controls.policy, sort_keys=True),
            "tools": bridge.tools,
            "binding_id": current_binding["bindingId"],
            "identity": identity,
        },
    )
    bridge.music_selection.receipts[(task["id"], request_id)] = receipt
    return identity


@pytest.mark.asyncio
async def test_actual_move_action_retains_identity_only_after_confirmed_destination(monkeypatch):
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
    identity = {"owner_epoch": "a" * 32, "command_sequence": 1, "request_id": "a" * 32 + ":1"}

    class Move:
        available = True

        def binding(self):
            return rig.router.podview_music_binding()

        setup = AsyncMock(
            return_value=SimpleNamespace(
                deadline=9999999999,
                wire={
                    "owner_epoch": identity["owner_epoch"],
                    "move_offer": {"native_incarnation": "c" * 32},
                },
            )
        )
        move = AsyncMock(
            return_value={
                "schema": "podconnect.command.v1",
                "config_entry_id": "account",
                "action": "move_existing_session",
                "target": {"kind": "spotify_device", "target_id": "speaker"},
                "room_id": "r1",
                "homepod_id": "43",
                "outcome": "accepted",
                "accepted_room_move": True,
                "move_operation_id": "d" * 32,
                **identity,
            }
        )

    bridge.controls.move = Move()

    async def confirmed(_bridge, task, _result, _current):
        rule = bridge.controls.policy["music"][1]
        bridge._music_destinations[("kitchen", "account")] = {
            "policy": bridge.controls.policy,
            "session": bridge.sessions["kitchen"],
            "binding": bridge.tools.podview_music_destination_binding(),
            "engine": "speaker",
            "rule": rule,
            "room": "r1",
            "homepod": "43",
            "revision": 1,
        }
        actual = binding(bridge, "kitchen", "account")
        task["move_source_scope"] = (actual["targetId"], actual["bindingId"])
        return True

    monkeypatch.setattr(podview_room_media, "confirm_move_destination", confirmed)
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
    assert setup["ok"]
    action = action_body(setup, setup["options"][0])
    action["requestId"] = "move-one"
    first = await bridge.controls.action(action, token)
    assert first["outcome"] == "accepted"
    assert (await bridge.controls.action(action, token))["error"] == "stale_action"
    assert bridge.controls.move.move.await_count == 1
    assert "move_operation_id" not in json.dumps(first)
    assert bridge.controls.settlement_identity("kitchen", token, "move-one", "account") == identity
    await rig.client.aclose()


@pytest.mark.asyncio
async def test_selected_start_reads_only_exact_current_receipt_and_source(controls_rig):
    rig = controls_rig
    identity = selected_receipt(rig)
    rig.expected_args.update(request_id=identity["request_id"], command_sequence=1)
    rig.value["settlement"] = control_settlement(identity)
    body = await read(rig, receipt_request_id="selected-one")
    assert body["settlement"] == {
        "requestId": "selected-one",
        **identity,
        "status": "confirmed",
        "effect": {"source": "native_bound_state", "effect_revision": "12"},
    }
    assert "prepare_id" not in json.dumps(body)
    original = rig.bridge.controls.policy
    rig.bridge.controls.policy = copy.deepcopy(original)
    rig.expected_args.pop("request_id")
    rig.expected_args.pop("command_sequence")
    rig.value.pop("settlement")
    assert (await read(rig, receipt_request_id="selected-one"))["settlement"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["room", "homepod", "owner", "config"])
async def test_selected_start_does_not_settle_foreign_scope(controls_rig, change):
    rig = controls_rig
    rule = rig.bridge.controls.policy["music"][0]
    if change in ("room", "homepod"):
        foreign = {**rule, "actions": ["move_existing_session"]}
        foreign["nativeRoomId" if change == "room" else "nativeHomepodId"] = (
            "r1" if change == "room" else "43"
        )
        rig.bridge.controls.policy["music"].append(foreign)
    identity = selected_receipt(rig)
    rig.expected_args.update(request_id=identity["request_id"], command_sequence=1)
    rig.value["settlement"] = control_settlement(identity)
    if change == "room":
        rig.value["output"]["binding"]["native_room_id"] = "r1"
    elif change == "homepod":
        rig.value["output"]["binding"]["homepod_id"] = "43"
    elif change == "owner":
        rig.value["settlement"]["owner_epoch"] = "c" * 32
    else:

        async def change_config():
            rule["maxVolume"] = 39

        rig.aggregate_hook = change_config
    body = await read(rig, receipt_request_id="selected-one")
    if change in ("room", "homepod"):
        assert body["status"] == "observed"
    assert body["settlement"] is None


@pytest.mark.asyncio
async def test_selected_start_replacement_during_read_never_publishes(controls_rig):
    rig = controls_rig
    identity = selected_receipt(rig)
    rig.expected_args.update(request_id=identity["request_id"], command_sequence=1)
    rig.value["settlement"] = control_settlement(identity)

    async def replace():
        key = ("selected-task", "selected-one")
        rig.bridge.music_selection.receipts[key] = tuple(
            [*rig.bridge.music_selection.receipts[key]]
        )

    rig.aggregate_hook = replace
    assert (await read(rig, receipt_request_id="selected-one"))["settlement"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change",
    ["unknown", "grant", "source", "session", "touch_context", "fence", "new_y", "collision"],
)
async def test_selected_receipt_fails_closed_after_authority_or_source_changes(
    controls_rig, change
):
    rig = controls_rig
    selected_receipt(rig)
    bridge = rig.bridge
    if change == "unknown":
        key = ("selected-task", "selected-one")
        old = bridge.music_selection.receipts[key]
        bridge.music_selection.receipts[key] = (old[0], {**old[1], "outcome": "unknown"}, old[2])
    elif change == "grant":
        bridge.revoke("kitchen")
    elif change == "source":
        bridge.music_selection.sources["selected-source"] = dict(
            bridge.music_selection.sources["selected-source"]
        )
    elif change == "session":
        bridge.sessions["kitchen"] = object()
    elif change == "touch_context":
        bridge._touch_music_contexts.clear()
    elif change == "fence":
        bridge._music_move_fence.add(("kitchen", "account-alpha"))
    elif change == "new_y":
        bridge.music_selection.receipts[("other-task", "selected-one")] = (
            "other",
            {"outcome": "accepted", "requestId": "selected-one"},
            {},
        )
    else:
        # A touch and a selection receipt with the same selector is ambiguous.
        retained_room_receipt(rig, request_id="selected-one")
        source = bridge.music_selection.sources["selected-source"]
        source["binding"] = _music_binding(bridge, "kitchen")
        bridge.music_selection.tasks["selected-task"]["ownerBinding"] = source["binding"]
    body = await read(rig, receipt_request_id="selected-one")
    assert body["settlement"] is None
    assert "request_id" not in rig.calls[-1][2]


@pytest.mark.asyncio
async def test_move_receipt_uses_new_confirmed_binding_not_old_read_closure(controls_rig):
    rig = controls_rig
    bridge, controls = rig.bridge, rig.bridge.controls
    source_rule = controls.policy["music"][0]
    source_rule["default"] = True
    destination_rule = {
        **source_rule,
        "nativeRoomId": "r1",
        "nativeHomepodId": "43",
        "actions": ["move_existing_session"],
        "default": False,
    }
    controls.policy["music"].append(destination_rule)
    bridge._music_destinations[("kitchen", "account-alpha")] = {
        "policy": controls.policy,
        "session": bridge.sessions["kitchen"],
        "binding": bridge.tools.podview_music_destination_binding(),
        "engine": "device-one",
        "rule": destination_rule,
        "room": "r1",
        "homepod": "43",
        "revision": 1,
    }
    new = binding(bridge, "kitchen", "account-alpha")
    rig.value["output"]["binding"].update(
        native_room_id="r1", homepod_id="43", binding_id=new["bindingId"]
    )
    rig.value["controls"]["binding_id"] = new["bindingId"]
    grant = bridge._grant_for_token("kitchen", rig.token)
    controls.move = SimpleNamespace(available=True, binding=bridge.tools.podview_music_binding)
    task = {
        "id": "move-task",
        "room": "kitchen",
        "domain": "music",
        "token": rig.token,
        "target": {"accountId": "account-alpha"},
        "rule": destination_rule,
        "actual_binding": {"bindingId": "b" * 64},
        "actual_current": lambda: False,
        "move_grant": grant,
        "move_policy": controls.policy,
        "move_binding": controls.move.binding(),
        "move_revision": controls._owner_revision("kitchen", "music"),
        "move_source_scope": ("device-one", new["bindingId"]),
        "move_rule_identity": controls._move_rule_identity(destination_rule),
    }
    task["binding"] = controls._binding("kitchen", "music")
    controls.tasks[task["id"]] = task
    identity = {"request_id": "a" * 32 + ":1", "command_sequence": 1, "owner_epoch": "a" * 32}
    controls.receipts[("kitchen", rig.token, "move-one")] = (
        "fingerprint",
        {"outcome": "accepted"},
        0,
        {
            "task": task,
            "policy": controls.policy,
            "music": controls.music,
            "grant": grant,
            "binding_id": new["bindingId"],
            "move_confirmed": True,
            "identity": identity,
        },
    )
    assert not controls._receipt_current(task, rig.token)
    assert (
        controls.settlement_identity("kitchen", rig.token, "move-one", "account-alpha") == identity
    )
    rig.expected_args.update(request_id=identity["request_id"], command_sequence=1)
    rig.value["settlement"] = control_settlement(identity)
    assert (await read(rig, receipt_request_id="move-one"))["settlement"]["status"] == "confirmed"

    async def retire_destination():
        bridge._music_destinations.pop(("kitchen", "account-alpha"))

    rig.aggregate_hook = retire_destination
    assert (await read(rig, receipt_request_id="move-one"))["settlement"] is None
    assert controls.settlement_identity("kitchen", rig.token, "move-one", "account-alpha") is None


@pytest.mark.asyncio
@pytest.mark.parametrize("extra_native_actions", [False, True])
@pytest.mark.parametrize("alias_change", [None, "incarnation", "registry"])
async def test_real_move_confirmation_controls_projection_and_second_move(
    monkeypatch, extra_native_actions, alias_change
):
    await _real_move_confirmation_case(monkeypatch, extra_native_actions, alias_change)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "refresh_change",
    [
        None,
        "idle",
        "mcp_metadata",
        "unknown",
        "client",
        "token",
        "schema",
        "policy",
        "session",
        "mcp_owner",
        "mcp_epoch",
        "target_contracts",
    ],
)
async def test_confirmed_move_keeps_authority_after_identical_real_service_refresh(
    monkeypatch, refresh_change
):
    await _real_move_confirmation_case(
        monkeypatch, False, None, refresh_services=True, refresh_change=refresh_change
    )


async def _real_move_confirmation_case(
    monkeypatch, extra_native_actions, alias_change, *, refresh_services=False, refresh_change=None
):
    rig = Rig()
    session, _ = owner()
    config = configuration()
    if refresh_services:
        for rule in config["music"]:
            rule["actions"].extend(["play_queue_occurrence", "play_track"])
    bridge = PodViewBridge({"kitchen": session}, rig.router, control_policy=json.dumps(config))
    actual = install_actual_playback(rig)

    import httpx
    from integration.test_podview_music_control import controls, room_owner

    dto = SimpleNamespace(tools=rig.router, value=controls())
    room_owner(dto)
    dto.value.update(actions=["pause", "resume", "next", "previous"], poll_sequence=4)
    if extra_native_actions:
        dto.value["actions"] += ["seek", "shuffle", "repeat"]
    dto.value["target"]["target_id"] = "speaker"
    dto.value.update(room_id="r1", homepod_id="43")
    dto.value["native"].update(
        target_id="speaker", room_id="r1", homepod_id="43", alias_incarnation="a" * 32
    )
    dto.value["route"]["device_id"] = "43"
    if refresh_services:
        rig.router._discovery = replace(
            rig.router._discovery,
            podconnect_services=rig.router._discovery.podconnect_services
            | {
                "get_targets",
                "get_room_queue_controls",
                "prepare_room_queue",
                "control_room_queue",
                "get_room_content_controls",
                "prepare_room_selected_content",
                "start_room_selected_content",
                "cancel_room_content_preparation",
            },
        )
    # Real HA service metadata, including the required target-read contract.
    service_metadata = {
        name: {"fields": {}} for name in sorted(rig.router._discovery.podconnect_services)
    }
    if refresh_services:
        service_metadata["get_targets"] = {
            "fields": {
                "config_entry_id": {
                    "required": False,
                    "selector": {"config_entry": {"integration": "podconnect"}},
                }
            },
            "response": {"optional": False},
        }
    service_reads = []
    original = rig.request
    native_reads = []

    async def request(req):
        if req.method == "GET" and req.url.path.endswith("/services"):
            service_reads.append(req.url.path)
            return httpx.Response(
                200, json=[{"domain": "podconnect", "services": service_metadata}]
            )
        args = json.loads(req.content)
        if req.url.path.endswith("get_playback_snapshot"):
            value = copy.deepcopy(actual)
            if not args.get("include_output"):
                value.pop("output")
                value["schema"] = "podconnect.playback.v1"
            return httpx.Response(200, json={"service_response": value})
        if req.url.path.endswith("get_room_playback_controls"):
            native_reads.append(args)
            return httpx.Response(200, json={"service_response": dto.value})
        return await original(req)

    rig.client._transport = httpx.MockTransport(request)
    if refresh_services:
        await type(rig.router)._refresh_podconnect_services(rig.router)
    token = bridge.grant_timer_control("kitchen")
    source = payload()
    source["targets"][-1]["target_id"] = "speaker"
    monkeypatch.setattr(
        podview_speakers, "read_service", AsyncMock(side_effect=lambda *_: copy.deepcopy(source))
    )
    destination = podview_speakers.project(
        source, boot=bridge.boot_id, room="kitchen", account="account", default_room="r0"
    )["speakers"][1]
    identity = {"owner_epoch": "a" * 32, "command_sequence": 1, "request_id": "a" * 32 + ":1"}

    class Move:
        available = True

        def binding(self):
            return rig.router.podview_music_binding()

        setup = AsyncMock(
            return_value=SimpleNamespace(
                deadline=9999999999,
                wire={
                    "owner_epoch": identity["owner_epoch"],
                    "poll_sequence": 4,
                    "move_offer": {"native_incarnation": "c" * 32},
                },
            )
        )
        move = AsyncMock(
            return_value={
                "schema": "podconnect.command.v1",
                "config_entry_id": "account",
                "action": "move_existing_session",
                "target": {"kind": "spotify_device", "target_id": "speaker"},
                "room_id": "r1",
                "homepod_id": "43",
                "outcome": "accepted",
                "accepted_room_move": True,
                "move_operation_id": "d" * 32,
                **identity,
            }
        )

    bridge.controls.move = Move()

    async def perform_move(*args, **kwargs):
        actual["output"]["binding"].update(native_room_id="r1", homepod_id="43")
        for row in source["targets"][:2]:
            row["binding"]["room_id"] = "r1"
        source["targets"][2]["selected"] = False
        source["targets"][3]["selected"] = True
        if alias_change is not None:
            changed = "e" * (32 if alias_change == "incarnation" else 64)
            for row in source["targets"][:2]:
                row["binding"][alias_change] = changed
            dto.value["native"]["alias_" + alias_change] = changed
        return bridge.controls.move.move.return_value

    bridge.controls.move.move.side_effect = perform_move
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
    assert setup["ok"]
    action = action_body(setup, setup["options"][0])
    action["requestId"] = "move-one"
    first = await bridge.controls.action(action, token)
    proof_rejected = extra_native_actions or alias_change is not None
    assert first["outcome"] == ("unknown" if proof_rejected else "accepted")
    assert bridge.controls.move.move.await_count == 1
    assert native_reads == [
        {
            "config_entry_id": "account",
            "kind": "spotify_device",
            "target_id": "speaker",
            "room_id": "r1",
            "homepod_id": "43",
        }
    ]
    assert (("kitchen", "account") in bridge._music_move_fence) is proof_rejected
    assert ("music" in bridge.controls.domains("kitchen", token)) is (not proof_rejected)
    if proof_rejected:
        assert not bridge._music_destinations
    else:
        assert binding(bridge, "kitchen", "account")["nativeRoomId"] == "r1"
        if refresh_services:
            before = bridge.snapshot("kitchen", token)
            assert "music" in before["capabilities"]["controlSetup"]
            assert before["capabilities"]["queueSelection"] is True
            old_discovery = rig.router._discovery
            old_client, old_token = rig.router._client, rig.router._token
            old_preference = bridge._music_destinations[("kitchen", "account")]
            native_owner = copy.deepcopy(dto.value["native"])
            old_offer = await bridge.controls.setup(
                {
                    "bootId": bridge.boot_id,
                    "roomId": "kitchen",
                    "domain": "music",
                    "target": {
                        "accountId": "account",
                        "kind": "spotify_device",
                        "targetId": "speaker",
                        "speakerId": podview_speakers.project(
                            source,
                            boot=bridge.boot_id,
                            room="kitchen",
                            account="account",
                            default_room="r0",
                        )["speakers"][0]["speakerId"],
                        "expectedBindingId": ACTUAL_BINDING,
                    },
                },
                token,
            )
            assert old_offer["ok"]
            await type(rig.router)._refresh_podconnect_services(rig.router)
            assert len(service_reads) == 2
            assert rig.router._client is old_client and rig.router._token == old_token
            assert rig.router._discovery.podconnect_services == old_discovery.podconnect_services
            assert rig.router._discovery.target_contracts == old_discovery.target_contracts
            assert rig.router._discovery.schema_sha256 == old_discovery.schema_sha256
            assert bridge._grant_current("kitchen", token)
            assert dto.value["native"] == native_owner
            assert bridge._music_destinations[("kitchen", "account")] is old_preference
            old_action = action_body(old_offer, old_offer["options"][0])
            old_action["requestId"] = "old-offer-after-refresh"
            stale = await bridge.controls.action(old_action, token)
            assert stale["ok"] is False and stale["error"] == "stale_action"
            assert bridge.controls.move.move.await_count == 1
            if refresh_change == "unknown":
                bridge._music_move_fence.add(("kitchen", "account"))
            elif refresh_change == "client":
                rig.router._client = httpx.AsyncClient(transport=httpx.MockTransport(request))
            elif refresh_change == "token":
                rig.router._token = "different-test-token"
            elif refresh_change == "schema":
                rig.router._discovery = replace(rig.router._discovery, schema_sha256="e" * 64)
            elif refresh_change == "policy":
                bridge.controls.policy = copy.deepcopy(bridge.controls.policy)
            elif refresh_change == "session":
                bridge.sessions["kitchen"] = owner()[0]
            elif refresh_change == "mcp_owner":
                rig.router._mcp = SimpleNamespace(initialized=False)
            elif refresh_change == "mcp_epoch":
                rig.router._mcp_epoch += 1
            elif refresh_change == "target_contracts":
                contracts = dict(rig.router._discovery.target_contracts)
                contracts["podconnect_get_targets"] = "e" * 64
                rig.router._discovery = replace(
                    rig.router._discovery, target_contracts=tuple(sorted(contracts.items()))
                )
            elif refresh_change == "idle":
                actual["playback"].update(state="no_active_playback", target=None, item=None)
            elif refresh_change == "mcp_metadata":
                # Equal-content MCP metadata publication, not a replacement
                # connected MCP owner. This rig has no live MCP client/probe.
                discovery = rig.router._discovery
                rig.router._discovery = replace(discovery, generation=discovery.generation + 1)
            after = bridge.snapshot("kitchen", token)
            if refresh_change not in {None, "idle", "mcp_metadata"}:
                assert ("kitchen", "account") in bridge._music_move_fence
                assert "music" not in after["capabilities"]["controlSetup"]
                assert after["capabilities"]["queueSelection"] is False
                assert bridge.controls.move.move.await_count == 1
                if refresh_change == "client":
                    await rig.router._client.aclose()
                await rig.client.aclose()
                return
            assert "music" in after["capabilities"]["controlSetup"]
            assert after["capabilities"]["queueSelection"] is True
            assert after["capabilities"]["musicSelection"] is True
            catalogue = await podview_speakers.read_catalogue(
                bridge, "kitchen", "account", lambda: "owner", token=token
            )
            assert catalogue["ok"] and all(row["startSelectable"] for row in catalogue["speakers"])
            assert not bridge._music_move_fence
            assert binding(bridge, "kitchen", "account")["nativeRoomId"] == "r1"
            if refresh_change == "idle":
                assert bridge.controls.move.move.await_count == 1
                await rig.client.aclose()
                return
        return_destination = podview_speakers.project(
            source, boot=bridge.boot_id, room="kitchen", account="account", default_room="r0"
        )["speakers"][0]
        second = await bridge.controls.setup(
            {
                "bootId": bridge.boot_id,
                "roomId": "kitchen",
                "domain": "music",
                "target": {
                    "accountId": "account",
                    "kind": "spotify_device",
                    "targetId": "speaker",
                    "speakerId": return_destination["speakerId"],
                    "expectedBindingId": ACTUAL_BINDING,
                },
            },
            token,
        )
        assert second["ok"], second
        assert second["options"][0]["action"] == "move_existing_session"
    await rig.client.aclose()
