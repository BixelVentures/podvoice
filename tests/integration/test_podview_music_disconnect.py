"""Existing HTTP adapter proves disconnect uncertainty without effects/replay."""

import asyncio
from datetime import UTC, datetime

import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_music_selection import rig  # noqa: F401

from gatekeeper.podview import BRIDGE


@pytest.mark.parametrize("revoke", [False, True])
async def test_client_disconnect_does_not_replay_or_revoke_admitted_selection(rig, revoke):  # noqa: F811
    bridge, facade = rig.app[BRIDGE], rig.app[BRIDGE].controls.music
    async with TestClient(TestServer(rig.app)) as client:
        headers = {"Cookie": "podview_control=grant", "X-PodView-Request": "1"}
        search = await (
            await client.get(
                "/view/api/music?kind=search&account=account-alpha&query=jazz",
                headers={"Cookie": "podview_control=grant"},
            )
        ).json()
        offer = await (
            await client.post(
                "/view/api/music/selection/setup",
                headers=headers,
                json={
                    "bootId": bridge.boot_id,
                    "roomId": "kitchen",
                    "candidateSetId": search["candidateSet"]["candidateSetId"],
                    "target": {
                        "accountId": "account-alpha",
                        "kind": "spotify_device",
                        "targetId": "device-one",
                    },
                },
            )
        ).json()
        observed = dict(facade.setup_track.return_value["data"])
        observed.pop("valid_until")
        observed["observation"] = {
            "status": "fresh",
            "observed_at": datetime.now(UTC).isoformat(),
            "age_ms": 0,
            "max_age_ms": 15000,
            "source": "podconnect_coordinator",
        }
        calls = []
        entered, release, completed = asyncio.Event(), asyncio.Event(), asyncio.Event()

        async def owner_service(_client, _token, service, request):
            calls.append((service, request))
            if service == "get_room_content_controls":
                return observed
            if service == "prepare_room_selected_content":
                entered.set()
                await release.wait()
                return {
                    "ok": True,
                    "schema": "podconnect.room_content_preparation.v1",
                    "config_entry_id": request["config_entry_id"],
                    "owner_epoch": request["owner_epoch"],
                    "request_id": request["request_id"],
                    "command_sequence": request["command_sequence"],
                    "action": request["action"],
                    "target": {"kind": "spotify_device", "target_id": request["target_id"]},
                    "room_id": request["room_id"],
                    "homepod_id": request["homepod_id"],
                    "state": "staged",
                    "retry_allowed": False,
                    "physical_result_verified": False,
                }
            if service == "start_room_selected_content":
                assert not revoke
                completed.set()
                return {
                    "ok": True,
                    "schema": "podconnect.command.v1",
                    **{
                        key: request[key]
                        for key in (
                            "config_entry_id",
                            "owner_epoch",
                            "request_id",
                            "command_sequence",
                            "action",
                        )
                    },
                    "target": {"kind": "spotify_device", "target_id": request["target_id"]},
                    "outcome": "accepted",
                    "retry_allowed": False,
                    "physical_result_verified": False,
                    "provider_request_accepted": False,
                    "accepted_selected_content": True,
                    "start_operation_id": "d" * 32,
                    "start_volume_percent": 35,
                    "room_id": request["room_id"],
                    "homepod_id": request["homepod_id"],
                }
            assert service == "cancel_room_content_preparation"
            completed.set()
            return {"ok": True}

        del facade.setup_track
        del facade.execute_track
        facade._read = owner_service
        action = {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "taskId": offer["taskId"],
            "revision": offer["revision"],
            "requestId": "revoke-during-stage",
            "optionId": offer["options"][0]["id"],
            "confirmedVolumePercent": 35,
        }
        # TestClient cancels/closes the actual HTTP request after admission;
        # the production-default aiohttp handler remains the effect owner.
        pending = asyncio.create_task(
            client.post(
                "/view/api/music/selection/actions",
                headers=headers,
                json=action,
            )
        )
        await asyncio.wait_for(entered.wait(), 1)
        pending.cancel()
        await asyncio.gather(pending, return_exceptions=True)
        if revoke:
            bridge._grants.clear()
        release.set()
        await asyncio.wait_for(completed.wait(), 1)
        assert [name for name, _ in calls] == [
            "get_room_content_controls",
            "prepare_room_selected_content",
            "cancel_room_content_preparation" if revoke else "start_room_selected_content",
        ]
        if not revoke:
            cached = await (
                await client.post(
                    "/view/api/music/selection/actions",
                    headers=headers,
                    json=action,
                )
            ).json()
            assert cached["outcome"] == "accepted"
            assert cached["retryAllowed"] is False and cached["physicalResultVerified"] is False
            assert len(calls) == 3
