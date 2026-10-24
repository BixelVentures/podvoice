"""Inert idle destination selection: no MOVE, exact START, observed publication."""

import asyncio
import copy
import time
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_music_selection import rig as music_rig  # noqa: F401
from unit.test_podview_speakers import payload

from gatekeeper import podview_room_media, podview_speakers
from gatekeeper.podview import BRIDGE

HEADERS = {"Cookie": "podview_control=grant", "X-PodView-Request": "1"}


@pytest.fixture
async def destination_rig(music_rig, monkeypatch):  # noqa: F811
    rig = music_rig
    bridge = rig.app[BRIDGE]
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services | {"get_targets"},
    )
    reads = rig.router.podview_music_reads
    monkeypatch.setattr(rig.router, "podview_music_reads", lambda: [*reads(), "targets"])
    original = bridge.controls.policy["music"][0]
    original.update(nativeRoomId="r0", nativeHomepodId="42", default=True)
    alternate = {**original, "nativeRoomId": "r1", "nativeHomepodId": "43", "default": False}
    bridge.controls.policy["music"].append(alternate)
    native = payload()
    native["config_entry_id"] = "account-alpha"
    read = AsyncMock(side_effect=lambda *_args: copy.deepcopy(native))
    monkeypatch.setattr(podview_speakers, "read_service", read)
    speaker = podview_speakers.project(
        native, boot=bridge.boot_id, room="kitchen", account="account-alpha", default_room=None
    )["speakers"][1]
    controls = bridge.controls.music.setup_track.return_value["data"]
    controls.update(room_id="r1", homepod_id="43")
    controls["start_offer"]["native_incarnation"] = "a" * 32
    proof = {
        "native": {
            "room_id": "r1",
            "homepod_id": "43",
            "target_id": "device-one",
            "alias_incarnation": "a" * 32,
            "alias_registry": "b" * 64,
        },
        "route": {"device_id": "43"},
        "owner_epoch": "a" * 32,
        "poll_sequence": 4,
        "valid_until": time.time() + 60,
    }
    bridge.controls.music.observe_room = AsyncMock(return_value={"ok": True, "data": proof})
    yield rig, bridge, native, speaker, read, proof


async def setup(client, bridge, speaker_id, headers=None):
    headers = headers or HEADERS
    source = await (
        await client.get(
            "/view/api/music?kind=search&account=account-alpha&query=jazz", headers=headers
        )
    ).json()
    return await client.post(
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
                "speakerId": speaker_id,
            },
        },
    )


def action(bridge, offer):
    return {
        "bootId": bridge.boot_id,
        "roomId": "kitchen",
        "taskId": offer["taskId"],
        "revision": offer["revision"],
        "optionId": offer["options"][0]["id"],
        "requestId": "one",
        "confirmedVolumePercent": 35,
    }


async def test_idle_catalogue_start_permission_is_separate_from_move(destination_rig):
    _, bridge, _, _, _, _ = destination_rig
    catalogue = await podview_speakers.read_catalogue(
        bridge, "kitchen", "account-alpha", lambda: "owner", token="grant"
    )
    assert catalogue["ok"]
    assert all(row["startSelectable"] for row in catalogue["speakers"])
    assert not any(row["selectable"] for row in catalogue["speakers"])
    bridge.controls.policy["music"][1]["actions"] = ["move_existing_session"]
    catalogue = await podview_speakers.read_catalogue(
        bridge, "kitchen", "account-alpha", lambda: "owner", token="grant"
    )
    assert catalogue["speakers"][1]["startSelectable"] is False


@pytest.mark.parametrize(
    "invalid", ["move_only", "context_only", "foreign", "raw_room", "unavailable"]
)
async def test_idle_setup_cannot_promote_ungranted_or_unknown_destination(destination_rig, invalid):
    rig, bridge, native, speaker, _, _ = destination_rig
    identifier = speaker["speakerId"]
    if invalid == "move_only":
        bridge.controls.policy["music"][1]["actions"] = ["move_existing_session"]
    elif invalid == "context_only":
        bridge.controls.policy["music"][1]["actions"] = ["play_context"]
    elif invalid == "foreign":
        bridge.controls.policy["music"][1]["accountId"] = "other"
    elif invalid == "raw_room":
        identifier = "r1"
    else:
        native["targets"][3]["query_up"] = False
    async with TestClient(TestServer(rig.app)) as client:
        result = await setup(client, bridge, identifier)
        assert result.status == 403
    bridge.controls.music.setup_track.assert_not_awaited()
    bridge.controls.music.execute_track.assert_not_awaited()
    assert not bridge._music_destinations


@pytest.mark.parametrize("change", ["alias", "grant", "rule"])
async def test_idle_destination_is_freshly_revalidated_before_one_use_start(
    destination_rig, change
):
    rig, bridge, native, speaker, _, _ = destination_rig
    async with TestClient(TestServer(rig.app)) as client:
        offer = await (await setup(client, bridge, speaker["speakerId"])).json()
        assert offer["destination"] == {"speakerId": speaker["speakerId"], "name": "Soveværelse"}
        assert set(offer["target"]) == {"kind", "targetId"}
        assert not bridge._music_destinations
        bridge.controls.music.execute_track.assert_not_awaited()
        if change == "alias":
            for row in native["targets"][:2]:
                row["binding"]["registry"] = "e" * 64
        elif change == "grant":
            bridge._grant_current = lambda *_args: False
        else:
            bridge.controls.policy["music"][1]["actions"] = ["move_existing_session"]
        await client.post(
            "/view/api/music/selection/actions", headers=HEADERS, json=action(bridge, offer)
        )
    bridge.controls.music.execute_track.assert_not_awaited()
    assert not bridge._music_destinations


@pytest.mark.parametrize(
    "outcome",
    ["accepted", "unknown", "rejected", "bad_route", "bad_registry", "stale_poll", "raise"],
)
async def test_start_destination_changes_only_after_fresh_joined_proof(destination_rig, outcome):
    rig, bridge, native, speaker, _, proof = destination_rig
    sends = []

    async def send(controls, uri, ceiling, current):
        assert current()
        assert controls["room_id"] == "r1" and controls["homepod_id"] == "43"
        assert (
            podview_room_media.binding(bridge, "kitchen", "account-alpha")["nativeRoomId"] == "r0"
        )
        sends.append((uri, ceiling))
        if outcome == "raise":
            raise OSError("lost command response")
        for row in native["targets"][:2]:
            row["binding"]["room_id"] = "r1"
        native["targets"][2]["selected"] = False
        native["targets"][3]["selected"] = True
        if outcome == "bad_route":
            proof["route"]["device_id"] = "42"
        if outcome == "bad_registry":
            proof["native"]["alias_registry"] = "e" * 64
        if outcome == "stale_poll":
            proof["poll_sequence"] = 3
        result = outcome if outcome in {"unknown", "rejected"} else "accepted"
        return {"outcome": result, "accepted_selected_content": result == "accepted"}

    bridge.controls.music.execute_track.side_effect = send
    async with TestClient(TestServer(rig.app)) as client:
        offer = await (await setup(client, bridge, speaker["speakerId"])).json()
        body = action(bridge, offer)
        first = await (
            await client.post("/view/api/music/selection/actions", headers=HEADERS, json=body)
        ).json()
        await client.post("/view/api/music/selection/actions", headers=HEADERS, json=body)
        assert len(sends) == 1
        assert first["physicalResultVerified"] is False
        if outcome == "accepted":
            scope = podview_room_media.binding(bridge, "kitchen", "account-alpha")
            assert scope["nativeRoomId"] == "r1" and scope["nativeHomepodId"] == "43"
            assert not bridge._music_move_fence
        else:
            assert not bridge._music_destinations
            assert bool(bridge._music_move_fence) is (outcome != "rejected")


@pytest.mark.parametrize("proof_ok", [True, False])
async def test_room_effect_custody_survives_held_post_start_proof_and_second_controller(
    destination_rig, proof_ok
):
    rig, bridge, native, speaker, _, proof = destination_rig
    bridge._grants[("kitchen", "second")] = ("second-grant",)
    bridge._grant_current = lambda room, token: (
        room == "kitchen" and token in {"grant", "second-grant"}
    )
    second_headers = {"Cookie": "podview_control=second-grant", "X-PodView-Request": "1"}
    ready, release = asyncio.Event(), asyncio.Event()
    template = copy.deepcopy(bridge.controls.music.setup_track.return_value)

    async def exact_setup(account, engine, room, homepod, current):
        assert current()
        response = copy.deepcopy(template)
        response["data"].update(room_id=room, homepod_id=homepod)
        return response

    async def send(*_args):
        for row in native["targets"][:2]:
            row["binding"]["room_id"] = "r1"
        native["targets"][2]["selected"] = False
        native["targets"][3]["selected"] = True
        return {"outcome": "accepted", "accepted_selected_content": True}

    async def held_proof(*_args):
        if _args[2] == "r0":
            return {"ok": False}
        ready.set()
        await release.wait()
        if not proof_ok:
            proof["route"]["device_id"] = "42"
        return {"ok": True, "data": proof}

    bridge.controls.music.setup_track.side_effect = exact_setup
    bridge.controls.music.execute_track.side_effect = send
    bridge.controls.music.observe_room.side_effect = held_proof
    original = podview_speakers.project(
        native, boot=bridge.boot_id, room="kitchen", account="account-alpha", default_room=None
    )["speakers"][0]
    async with TestClient(TestServer(rig.app)) as client:
        first = await (await setup(client, bridge, speaker["speakerId"])).json()
        second = await (await setup(client, bridge, original["speakerId"], second_headers)).json()
        assert first["ok"] and second["ok"]
        second_task = bridge.music_selection.tasks[second["taskId"]]
        first_request = asyncio.create_task(
            client.post(
                "/view/api/music/selection/actions", headers=HEADERS, json=action(bridge, first)
            )
        )
        await asyncio.wait_for(ready.wait(), 1)
        try:
            assert not bridge._music_move_fence and not bridge._music_destinations
            again = await client.post(
                "/view/api/music/selection/setup",
                headers=second_headers,
                json={
                    "bootId": bridge.boot_id,
                    "roomId": "kitchen",
                    "candidateSetId": second["candidateSetId"],
                    "target": {
                        "accountId": "account-alpha",
                        "kind": "spotify_device",
                        "targetId": "device-one",
                        "speakerId": original["speakerId"],
                    },
                },
            )
            assert again.status == 429
            assert bridge.music_selection.busy("kitchen") and "kitchen" in bridge.controls.busy
            blocked = await (
                await client.post(
                    "/view/api/music/selection/actions",
                    headers=second_headers,
                    json=action(bridge, second),
                )
            ).json()
            assert blocked["outcome"] == "rejected" and second_task["consumed"] is False
            read = await client.get(
                "/view/api/music?kind=search&account=account-alpha&query=new",
                headers=second_headers,
            )
            assert read.status == 429
            await client.get("/view/api/music?kind=playback&account=account-alpha", headers=HEADERS)
            assert bridge.music_selection.busy("kitchen") and "kitchen" in bridge.controls.busy
            assert bridge.controls.music.execute_track.await_count == 1
            assert bridge.music_selection.tasks[first["taskId"]]["consumed"] is True
        finally:
            release.set()
            response = await first_request
            assert (await response.json())["outcome"] == "accepted"
        assert not bridge.music_selection.inflight and not bridge.controls.busy
        assert bool(bridge._music_move_fence) is not proof_ok
        assert bool(bridge._music_destinations) is proof_ok
        assert bridge.controls.music.execute_track.await_count == 1


async def test_cancellation_during_actual_post_start_proof_keeps_uncertainty_fence(destination_rig):
    rig, bridge, native, speaker, _, _ = destination_rig
    entered = asyncio.Event()

    async def send(*_args):
        for row in native["targets"][:2]:
            row["binding"]["room_id"] = "r1"
        native["targets"][2]["selected"] = False
        native["targets"][3]["selected"] = True
        return {"outcome": "accepted", "accepted_selected_content": True}

    async def held_proof(*_args):
        entered.set()
        await asyncio.Future()

    bridge.controls.music.execute_track.side_effect = send
    bridge.controls.music.observe_room.side_effect = held_proof
    async with TestClient(TestServer(rig.app)) as client:
        offer = await (await setup(client, bridge, speaker["speakerId"])).json()
    task = bridge.music_selection.tasks[offer["taskId"]]
    source = bridge.music_selection.sources[task["candidateSetId"]]
    controls = bridge.controls.music.setup_track.return_value["data"]

    async def fresh():
        return controls

    async def send_once(observed, uri, ceiling, current):
        return await podview_room_media.execute_selected_destination(
            bridge, "kitchen", task, observed, uri, ceiling, current
        )

    pending = asyncio.create_task(
        bridge.music_selection.execute(
            task_id=task["id"],
            revision=offer["revision"],
            option_id=offer["options"][0]["id"],
            request_id="cancel-proof",
            confirmed_volume=35,
            context=source["context"],
            owner_binding=source["binding"],
            authority=task["authority"],
            current=lambda: True,
            fresh_controls=fresh,
            send_once=send_once,
            effect_busy=bridge.controls.busy,
        )
    )
    await asyncio.wait_for(entered.wait(), 1)
    assert bridge.music_selection.busy("kitchen") and "kitchen" in bridge.controls.busy
    pending.cancel()
    result = await pending
    assert result["outcome"] == "unknown" and result["retryAllowed"] is False
    assert bridge._music_move_fence == {("kitchen", "account-alpha")}
    assert not bridge._music_destinations
    assert not bridge.music_selection.inflight and not bridge.controls.busy
    assert bridge.controls.music.execute_track.await_count == 1


@pytest.mark.parametrize("first", ["idle", "old_poll", "owner_changed", "grant_revoked"])
async def test_accepted_start_waits_only_for_fresh_passive_destination_facts(
    destination_rig, monkeypatch, first
):
    rig, bridge, native, speaker, _, _ = destination_rig
    original_read = bridge.tools.podview_read
    accepted, reads, sends = False, 0, 0

    async def read(kind, account, *args, **kwargs):
        nonlocal reads
        result = await original_read(kind, account, *args, **kwargs)
        if accepted and kind == "playback":
            reads += 1
            if reads == 1:
                result = copy.deepcopy(result)
                if first == "idle":
                    result["data"]["playback"] = {
                        "state": "no_active_playback",
                        "target": None,
                        "item": None,
                    }
                elif first == "old_poll":
                    result["data"]["poll_sequence"] = 3
                elif first == "owner_changed":
                    result["data"]["owner_epoch"] = "e" * 32
                else:
                    bridge._grants.clear()
        return result

    async def send(*_args):
        nonlocal accepted, sends
        accepted, sends = True, sends + 1
        for row in native["targets"][:2]:
            row["binding"]["room_id"] = "r1"
        native["targets"][2]["selected"] = False
        native["targets"][3]["selected"] = True
        return {
            "outcome": "accepted",
            "accepted_selected_content": True,
            "observe_after_poll_sequence": 4,
        }

    monkeypatch.setattr(bridge.tools, "podview_read", read)
    bridge.controls.music.execute_track.side_effect = send
    async with TestClient(TestServer(rig.app)) as client:
        offer = await (await setup(client, bridge, speaker["speakerId"])).json()
        body = action(bridge, offer)
        result = await (
            await client.post(
                "/view/api/music/selection/actions",
                headers=HEADERS,
                json=body,
            )
        ).json()
        assert result["physicalResultVerified"] is False
        assert sends == 1
        if first in {"idle", "old_poll"}:
            assert bridge._music_destinations[("kitchen", "account-alpha")]["room"] == "r1"
            assert not bridge._music_move_fence
            assert reads == 2
            await client.post("/view/api/music/selection/actions", headers=HEADERS, json=body)
            assert sends == 1 and reads == 2
        else:
            assert not bridge._music_destinations
            assert reads == 1
            assert bridge._music_move_fence


async def test_cancellation_during_passive_retry_joins_read_and_keeps_uncertainty_fence(
    destination_rig,
):
    rig, bridge, native, speaker, _, _ = destination_rig
    entered, retired = asyncio.Event(), asyncio.Event()
    reads = 0
    original_read = bridge.tools.podview_read

    async def send(*_args):
        for row in native["targets"][:2]:
            row["binding"]["room_id"] = "r1"
        native["targets"][2]["selected"] = False
        native["targets"][3]["selected"] = True
        return {"outcome": "accepted", "accepted_selected_content": True}

    async def held_read(kind, account, *args, **kwargs):
        nonlocal reads
        reads += 1
        if reads == 1:
            result = await original_read(kind, account, *args, **kwargs)
            result["data"]["playback"] = {
                "state": "no_active_playback",
                "target": None,
                "item": None,
            }
            return result
        entered.set()
        try:
            await asyncio.Future()
        finally:
            retired.set()

    bridge.controls.music.execute_track.side_effect = send
    async with TestClient(TestServer(rig.app)) as client:
        offer = await (await setup(client, bridge, speaker["speakerId"])).json()
    task = bridge.music_selection.tasks[offer["taskId"]]
    source = bridge.music_selection.sources[task["candidateSetId"]]
    controls = bridge.controls.music.setup_track.return_value["data"]

    async def fresh():
        return controls

    async def send_once(observed, uri, ceiling, current):
        return await podview_room_media.execute_selected_destination(
            bridge, "kitchen", task, observed, uri, ceiling, current
        )

    bridge.tools.podview_read = held_read
    pending = asyncio.create_task(
        bridge.music_selection.execute(
            task_id=task["id"],
            revision=offer["revision"],
            option_id=offer["options"][0]["id"],
            request_id="cancel-proof",
            confirmed_volume=35,
            context=source["context"],
            owner_binding=source["binding"],
            authority=task["authority"],
            current=lambda: True,
            fresh_controls=fresh,
            send_once=send_once,
            effect_busy=bridge.controls.busy,
        )
    )
    await asyncio.wait_for(entered.wait(), 1)
    assert bridge.music_selection.busy("kitchen") and "kitchen" in bridge.controls.busy
    pending.cancel()
    result = await pending
    assert result["outcome"] == "unknown" and result["retryAllowed"] is False
    assert bridge._music_move_fence == {("kitchen", "account-alpha")}
    assert not bridge._music_destinations
    assert not bridge.music_selection.inflight and not bridge.controls.busy
    assert bridge.controls.music.execute_track.await_count == 1

    assert retired.is_set() and reads == 2
