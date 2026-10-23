"""Account library -> fresh native context offer -> one inert command, no Spotify I/O."""

import copy
from dataclasses import replace
from unittest.mock import AsyncMock

import httpx
import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration import test_podview_music_selection as selection_cases

from gatekeeper.podview import BRIDGE

rig = selection_cases.rig
HEADERS = {"Cookie": "podview_control=grant", "X-PodView-Request": "1"}
URL = "/view/api/music?kind=account_playlists&account=account-alpha"


def catalogue():
    return {
        "ok": True,
        "schema": "podconnect.user_playlists.v1",
        "config_entry_id": "account-alpha",
        "owner_epoch": "a" * 32,
        "source": "spotify_web_api",
        "coverage": "first_page",
        "limit": 20,
        "returned_count": 1,
        "source_has_more": True,
        "playlists": [{"uri": "spotify:playlist:" + "p" * 22, "name": "My playlist"}],
    }


@pytest.fixture
async def account_rig(rig):
    rig.catalogue = catalogue()
    old_client = rig.client
    original = rig.request

    async def request(req):
        if req.url.path.endswith("/get_user_playlists"):
            import json

            rig.calls.append((req.method, req.url.path, json.loads(req.content)))
            assert req.headers["Authorization"] == "Bearer server-only"
            if rig.hook:
                await rig.hook()
            return httpx.Response(200, json={"service_response": copy.deepcopy(rig.catalogue)})
        return await original(req)

    rig.client = httpx.AsyncClient(transport=httpx.MockTransport(request))
    rig.router._client = rig.client
    await old_client.aclose()
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services | {"get_user_playlists"},
    )
    bridge = rig.app[BRIDGE]
    bridge.controls.policy["music"][0]["actions"] = ["play_context"]
    observed = copy.deepcopy(bridge.controls.music.setup_track.return_value)
    observed["data"]["actions"] = ["play_context"]
    bridge.controls.music.setup_context = AsyncMock(return_value=observed)
    bridge.controls.music.execute_context = AsyncMock(
        return_value={"outcome": "accepted", "accepted_selected_content": True}
    )
    return rig


async def setup(client, bridge, data):
    return await client.post(
        "/view/api/music/selection/setup",
        headers=HEADERS,
        json={
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "candidateSetId": data["candidateSet"]["candidateSetId"],
            "candidateIds": [data["candidateSet"]["items"][0]["id"]],
            "target": {
                "accountId": "account-alpha",
                "kind": "spotify_device",
                "targetId": "device-one",
            },
        },
    )


async def test_library_to_fresh_context_once(account_rig):
    rig = account_rig
    bridge = rig.app[BRIDGE]
    async with TestClient(TestServer(rig.app)) as client:
        response = await client.get(URL, headers=HEADERS)
        data = await response.json()
        assert response.status == 200 and data["ok"]
        assert data["data"] == catalogue()
        assert data["candidateSet"]["sourceKind"] == "account_playlists"
        assert rig.calls[0][2] == {"config_entry_id": "account-alpha", "limit": 20}
        bridge.controls.music.setup_context.assert_not_awaited()
        bridge.controls.music.execute_context.assert_not_awaited()
        offer = await (await setup(client, bridge, data)).json()
        assert offer["ok"] and offer["startVolumePercent"] == 35
        assert offer["options"][0]["artist"] == "Playliste"
        action = {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "taskId": offer["taskId"],
            "revision": offer["revision"],
            "optionId": offer["options"][0]["id"],
            "requestId": "playlist-one",
            "confirmedVolumePercent": 35,
        }
        first = await (
            await client.post("/view/api/music/selection/actions", headers=HEADERS, json=action)
        ).json()
        second = await (
            await client.post("/view/api/music/selection/actions", headers=HEADERS, json=action)
        ).json()
        assert first == second and first["outcome"] == "accepted"
        assert bridge.controls.music.execute_context.await_count == 1
        assert (
            bridge.controls.music.execute_context.await_args.args[1]
            == catalogue()["playlists"][0]["uri"]
        )
        bridge.controls.music.execute_track.assert_not_awaited()


async def test_old_catalogue_epoch_never_gets_new_context_authority(account_rig):
    bridge = account_rig.app[BRIDGE]
    async with TestClient(TestServer(account_rig.app)) as client:
        data = await (await client.get(URL, headers=HEADERS)).json()
        bridge.controls.music.setup_context.return_value["data"]["owner_epoch"] = "b" * 32
        result = await (await setup(client, bridge, data)).json()
        assert not result["ok"]
        assert not bridge.music_selection.tasks
        bridge.controls.music.execute_context.assert_not_awaited()


@pytest.mark.parametrize("suffix", ["&account=other", "&query=anything", "&unexpected=1"])
async def test_closed_library_query_never_sends(account_rig, suffix):
    async with TestClient(TestServer(account_rig.app)) as client:
        result = await client.get(URL + suffix, headers=HEADERS)
        assert result.status == 400
        assert not account_rig.calls


async def test_stale_read_loses_candidate_and_read_only_has_no_offer(account_rig):
    bridge = account_rig.app[BRIDGE]

    async def supersede():
        bridge._advance_music_source("grant")

    account_rig.hook = supersede
    async with TestClient(TestServer(account_rig.app)) as client:
        data = await (await client.get(URL, headers=HEADERS)).json()
        assert data["ok"] and "candidateSet" not in data
        assert not bridge.music_selection.sources
        account_rig.hook = None
        bridge.controls.policy["music"] = []
        data = await (await client.get(URL, headers=HEADERS)).json()
        assert data["ok"] and "candidateSet" not in data
        bridge.controls.music.setup_context.assert_not_awaited()
        bridge.controls.music.execute_context.assert_not_awaited()


async def test_owner_binding_revoked_during_read(account_rig):
    async def revoke():
        account_rig.router._discovery = replace(
            account_rig.router._discovery, podconnect_services=frozenset()
        )

    account_rig.hook = revoke
    async with TestClient(TestServer(account_rig.app)) as client:
        response = await client.get(URL, headers=HEADERS)
        assert response.status == 503
        assert not account_rig.app[BRIDGE].music_selection.sources
