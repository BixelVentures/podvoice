"""Real paired queue broker with separate effect-free staging and commit."""

import copy
import time
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest
from integration.test_podview_music_selection import rig as rig
from integration.test_podview_queue_occurrence import accepted, action
from integration.test_podview_queue_occurrence import source as legacy_source
from integration.test_podview_room_move_caller import ACTUAL_BINDING, actual_playback

from gatekeeper.podview import BRIDGE
from gatekeeper.podview_queue import ACTION

SERVICES = {"get_room_queue_controls", "prepare_room_queue", "control_room_queue"}


def source():
    value = legacy_source()
    value.update(schema="podconnect.room_queue_controls.v1", purpose="queue_occurrence_v1")
    value["queue"] = {
        k: value["native"][k]
        for k in ("observation_id", "session_id", "queue_revision", "expires_in_ms")
    }
    value["native"] = dict(
        account_user_id="native-account",
        target_id="device-one",
        room_id="native-room",
        homepod_id="7",
        connection_id="native-connection",
        session_id="native-session",
        alias_incarnation="d" * 32,
        alias_registry="e" * 64,
        alias_revision=0,
    )
    value["route"] = dict(
        process="11111111-1111-4111-8111-111111111111",
        device_id="7",
        device_incarnation="1",
        session_epoch="1",
        route_revision="0",
        selection_revision="0",
        input_generation="1",
        input_item_id="1",
        input_path_digest="c" * 64,
    )
    return value


def staged(request):
    return {
        "ok": True,
        "schema": "podconnect.room_queue_preparation.v1",
        "purpose": "queue_occurrence_v1",
        **{
            k: copy.deepcopy(request[k])
            for k in (
                "config_entry_id",
                "owner_epoch",
                "request_id",
                "command_sequence",
                "native",
                "route",
            )
        },
        "prepare_id": "f" * 32,
        "expires_after_ms": 4000,
        "queue": copy.deepcopy(request["args"]),
        "writer_proof": dict(
            native_process=dict(
                boot_id="22222222-2222-4222-8222-222222222222", pid="123", proc_start_ticks="456"
            ),
            writer_fd="0",
            pipe_identity=dict(device="1", inode="2", type="fifo"),
            source_epoch="0",
            open_generation="1",
            input_path_digest="c" * 64,
        ),
        "physical_result_verified": False,
    }


def prepare(rig):
    bridge = rig.app[BRIDGE]
    rig.values["playback"] = actual_playback("account-alpha", "device-one", "native-room", "7")
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services | SERVICES,
    )
    bridge._grants["kitchen"] = ("grant", time.monotonic() + 600)
    rule = bridge.controls.policy["music"][0]
    rule["nativeHomepodId"] = "7"
    rule["actions"].append(ACTION)

    async def read(_client, _token, service, request):
        if service == "get_room_queue_controls":
            return source()
        if service == "prepare_room_queue":
            return staged(request)
        assert service == "control_room_queue"
        return accepted(request)

    bridge.controls.music._read = AsyncMock(side_effect=read)
    request = dict(
        bootId=bridge.boot_id,
        roomId="kitchen",
        accountId="account-alpha",
        targetId="device-one",
        expectedBindingId=ACTUAL_BINDING,
    )
    return bridge, request


async def test_exact_duplicate_occurrence_stages_then_commits_once_without_browser_authority(rig):
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")
    assert offer["ok"] and offer["items"][0]["uri"] == offer["items"][1]["uri"]
    assert offer["expectedBindingId"] == ACTUAL_BINDING
    assert "native" not in offer and "route" not in offer and "writer_proof" not in offer
    body = action(offer)
    result = await bridge.queue.action(body, "grant")
    assert result["outcome"] == "accepted"
    assert await bridge.queue.action(body, "grant") == result
    calls = bridge.controls.music._read.await_args_list
    assert [call.args[2] for call in calls] == [
        "get_room_queue_controls",
        "prepare_room_queue",
        "control_room_queue",
    ]
    preparation, commit = calls[1].args[3], calls[2].args[3]
    assert preparation["args"]["occurrence_id"] == body["optionId"]
    assert "uri" not in preparation["args"] and "position" not in preparation["args"]
    assert commit == {**preparation, "prepare_id": "f" * 32}
    assert "volume_percent" not in commit and "start_volume" not in commit
    assert rig.calls and all(
        call[2] == {"config_entry_id": "account-alpha", "include_output": True}
        for call in rig.calls
    )


async def test_queue_read_matches_actual_registered_control_identity_schema(rig):
    bridge, request = prepare(rig)
    original = bridge.controls.music._read.side_effect

    async def strict_control(client, token, service, request):
        # Control room_identity requires this field before its read handler runs.
        if service == "get_room_queue_controls":
            assert request["kind"] == "spotify_device"
        return await original(client, token, service, request)

    bridge.controls.music._read.side_effect = strict_control
    assert (await bridge.queue.offer(request, "grant"))["ok"]


async def test_actual_native_control_receipt_is_accepted_without_provider_send_claim(rig):
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")
    original = bridge.controls.music._read.side_effect

    async def native_control(client, token, service, request):
        value = await original(client, token, service, request)
        if service == "control_room_queue":
            value.update(provider_request_accepted=False, accepted_native=True)
        return value

    bridge.controls.music._read.side_effect = native_control
    assert (await bridge.queue.action(action(offer), "grant"))["outcome"] == "accepted"


async def test_revoked_grant_after_detached_staging_never_dispatches_commit(rig):
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")

    async def revoke(_client, _token, service, request):
        assert service == "prepare_room_queue"
        bridge._grants.clear()
        return staged(request)

    bridge.controls.music._read.side_effect = revoke
    result = await bridge.queue.action(action(offer), "grant")
    assert result["outcome"] == "rejected"
    assert bridge.controls.music._read.await_count == 2  # Read + stage, never commit.
    assert not bridge.controls.busy


@pytest.mark.parametrize(
    "mutation", ["owner", "route", "writer", "selection", "expiry", "unknown-field", "old-schema"]
)
async def test_unproven_preparation_has_zero_effect_dispatch(rig, mutation):
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")

    async def corrupt(_client, _token, service, request):
        assert service == "prepare_room_queue"
        reply = staged(request)
        if mutation == "owner":
            reply["native"]["alias_revision"] += 1
        elif mutation == "route":
            reply["route"]["selection_revision"] = "2"
        elif mutation == "writer":
            reply["writer_proof"]["input_path_digest"] = "0" * 64
        elif mutation == "selection":
            reply["queue"]["occurrence_id"] = offer["items"][0]["id"]
        elif mutation == "expiry":
            reply["expires_after_ms"] = 0
        elif mutation == "unknown-field":
            reply["assume_ready"] = True
        else:
            reply["schema"] = "podconnect.native_queue_commit.v1"
        return reply

    bridge.controls.music._read.side_effect = corrupt
    assert (await bridge.queue.action(action(offer), "grant"))["outcome"] == "rejected"
    assert bridge.controls.music._read.await_count == 2


async def test_unknown_commit_is_consumed_and_never_retried(rig):
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")
    original = bridge.controls.music._read.side_effect

    async def lose_response(client, token, service, request):
        if service == "control_room_queue":
            raise TimeoutError("inert lost commit response")
        return await original(client, token, service, request)

    bridge.controls.music._read.side_effect = lose_response
    body = action(offer)
    assert (await bridge.queue.action(body, "grant"))["outcome"] == "unknown"
    assert (await bridge.queue.action(body, "grant"))["outcome"] == "unknown"
    assert bridge.controls.music._read.await_count == 3


@pytest.mark.parametrize("missing", sorted(SERVICES))
async def test_partial_or_legacy_service_stack_cannot_offer_queue_actions(rig, missing):
    bridge, request = prepare(rig)
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services - {missing},
    )
    assert not bridge.queue.available
    assert not (await bridge.queue.offer(request, "grant"))["ok"]
    bridge.controls.music._read.assert_not_awaited()


@pytest.mark.parametrize("phase", ["offer", "action"])
async def test_changed_actual_output_rejects_previous_binding_without_rewriting_intent(rig, phase):
    bridge, request = prepare(rig)
    rule = bridge.controls.policy["music"][0]
    rule["default"] = True
    bridge.controls.policy["music"].append(
        {**rule, "nativeRoomId": "other-room", "nativeHomepodId": "8", "default": False}
    )
    configured = copy.deepcopy(bridge.controls.policy)
    intent = copy.deepcopy(bridge._music_destinations)
    offer = await bridge.queue.offer(request, "grant") if phase == "action" else None
    rig.values["playback"]["output"]["binding"].update(
        native_room_id="other-room", homepod_id="8", binding_id="c" * 64
    )
    if phase == "offer":
        assert not (await bridge.queue.offer(request, "grant"))["ok"]
        bridge.controls.music._read.assert_not_awaited()
    else:
        assert (await bridge.queue.action(action(offer), "grant"))["outcome"] == "rejected"
        assert [call.args[2] for call in bridge.controls.music._read.await_args_list] == [
            "get_room_queue_controls"
        ]
    assert bridge.controls.policy == configured
    assert bridge._music_destinations == intent
