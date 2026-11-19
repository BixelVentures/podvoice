"""Find musik shelves over the real HA transport and ingress, inert Spotify and provider.

GET /view/api/music/shelves -> closed shelves + one choice set -> the existing room content
setup/action flow starts an album/artist/show/playlist context once on the room's speaker.
"""

import copy
import json
from dataclasses import replace
from unittest.mock import AsyncMock

import httpx
import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration import test_podview_music_selection as selection_cases
from music_shelves_fixture import NEW_SERVICES, FakeShelfSelector, reply

from gatekeeper.podview import BRIDGE

rig = selection_cases.rig
HEADERS = {"Cookie": "podview_control=grant", "X-PodView-Request": "1"}
URL = "/view/api/music/shelves?room=kitchen&account=account-alpha"
SHELF_SERVICES = NEW_SERVICES | {"search_playlists", "get_user_playlists"}


@pytest.fixture
async def shelves_rig(rig):
    rig.shelf_calls = []
    rig.limited = False
    rig.shelf_services = set(SHELF_SERVICES)
    old_client = rig.client
    original = rig.request

    async def request(req):
        service = req.url.path.rsplit("/", 1)[-1]
        if service in SHELF_SERVICES:
            body = json.loads(req.content)
            rig.shelf_calls.append((service, body))
            assert req.headers["Authorization"] == "Bearer server-only"
            if rig.limited:
                return httpx.Response(500, text="Spotify rate limited top artists; try again later")
            return httpx.Response(200, json={"service_response": reply(service, body)})
        return await original(req)

    rig.client = httpx.AsyncClient(transport=httpx.MockTransport(request))
    rig.router._client = rig.client
    await old_client.aclose()
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services | rig.shelf_services,
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


def tile(data, name):
    return next(index for index, item in enumerate(data["items"]) if item["name"] == name)


async def start(client, bridge, data, index, request_id="shelf-one"):
    item = next(row for row in data["candidateSet"]["items"] if row["index"] == index)
    offer = await (
        await client.post(
            "/view/api/music/selection/setup",
            headers=HEADERS,
            json={
                "bootId": bridge.boot_id,
                "roomId": "kitchen",
                "candidateSetId": data["candidateSet"]["candidateSetId"],
                "candidateIds": [item["id"]],
                "target": {
                    "accountId": "account-alpha",
                    "kind": "spotify_device",
                    "targetId": "device-one",
                },
            },
        )
    ).json()
    assert offer["ok"], offer
    action = {
        "bootId": bridge.boot_id,
        "roomId": "kitchen",
        "taskId": offer["taskId"],
        "revision": offer["revision"],
        "optionId": offer["options"][0]["id"],
        "requestId": request_id,
        "confirmedVolumePercent": offer["startVolumePercent"],
    }
    result = await client.post("/view/api/music/selection/actions", headers=HEADERS, json=action)
    return offer, await result.json()


async def test_shelves_read_then_one_tap_starts_the_album_context_once(shelves_rig):
    rig = shelves_rig
    bridge = rig.app[BRIDGE]
    async with TestClient(TestServer(rig.app)) as client:
        response = await client.get(URL, headers=HEADERS)
        data = await response.json()
        assert response.status == 200 and data["ok"]
        assert data["schema"] == "podview.music_shelves.v1"
        assert response.headers["Cache-Control"] == "no-store"
        assert [shelf["id"] for shelf in data["shelves"]] == [
            "artists",
            "recent",
            "albums",
            "podcasts",
        ]
        assert "access_token" not in json.dumps(data)
        assert data["candidateSet"]["sourceKind"] == "shelves"
        assert len(data["candidateSet"]["items"]) == len(data["items"])
        # The provider is read once per source; the album is started through the room flow.
        services = sorted(service for service, _ in rig.shelf_calls)
        assert services == sorted(NEW_SERVICES)
        album = tile(data, "Blue")
        offer, first = await start(client, bridge, data, album)
        assert offer["options"][0] == {**offer["options"][0], "label": "Blue", "artist": "Album"}
        assert first["outcome"] == "accepted"
        execute = bridge.controls.music.execute_context
        assert execute.await_count == 1
        assert execute.await_args.args[1] == data["items"][album]["uri"]
        assert execute.await_args.args[1].startswith("spotify:album:")
        bridge.controls.music.execute_track.assert_not_awaited()


@pytest.mark.parametrize("name", ["Radiofortællinger", "Nina Simone", "Søndagsmorgen"])
async def test_show_artist_and_playlist_contexts_start_through_the_same_flow(shelves_rig, name):
    bridge = shelves_rig.app[BRIDGE]
    async with TestClient(TestServer(shelves_rig.app)) as client:
        data = await (await client.get(URL, headers=HEADERS)).json()
        index = tile(data, name)
        _offer, result = await start(client, bridge, data, index)
        assert result["outcome"] == "accepted"
        uri = bridge.controls.music.execute_context.await_args.args[1]
        assert uri == data["items"][index]["uri"]


async def test_last_read_wins_and_the_cache_answers_without_new_provider_reads(shelves_rig):
    rig = shelves_rig
    bridge = rig.app[BRIDGE]
    async with TestClient(TestServer(rig.app)) as client:
        first = await (await client.get(URL, headers=HEADERS)).json()
        calls = len(rig.shelf_calls)
        second = await (await client.get(URL, headers=HEADERS)).json()
        assert len(rig.shelf_calls) == calls
        assert second["shelves"] == first["shelves"]
        assert second["candidateSet"]["candidateSetId"] != first["candidateSet"]["candidateSetId"]
        # The first page's set was retired by the newer read of the same document.
        assert first["candidateSet"]["candidateSetId"] not in bridge.music_selection.sources


async def test_ai_shelves_come_from_the_mood_selector_and_real_searches(shelves_rig):
    rig = shelves_rig
    selector = FakeShelfSelector()
    rig.router.podview_mood_selector = selector
    async with TestClient(TestServer(rig.app)) as client:
        data = await (await client.get(URL, headers=HEADERS)).json()
    assert len(selector.calls) == 1
    ai = [shelf for shelf in data["shelves"] if shelf["ai"]]
    assert ai and all(shelf["why"].startswith("Fordi ") for shelf in ai)
    searched = [body["query"] for service, body in rig.shelf_calls if service == "search_playlists"]
    assert searched and all(
        body["limit"] == 5 for s, body in rig.shelf_calls if s.startswith("search")
    )
    for shelf in ai:
        for index in shelf["items"]:
            assert data["items"][index]["uri"].startswith("spotify:playlist:")
    assert any("ai" in quick for quick in data["quick"])


async def test_read_only_screen_gets_shelves_without_a_choice_set(shelves_rig):
    bridge = shelves_rig.app[BRIDGE]
    bridge.controls.policy["music"] = []
    async with TestClient(TestServer(shelves_rig.app)) as client:
        data = await (await client.get(URL, headers=HEADERS)).json()
    assert data["ok"] and data["shelves"] and "candidateSet" not in data
    assert not bridge.music_selection.sources


async def test_rate_limited_control_keeps_last_known_shelves(shelves_rig):
    rig = shelves_rig
    bridge = rig.app[BRIDGE]
    async with TestClient(TestServer(rig.app)) as client:
        first = await (await client.get(URL, headers=HEADERS)).json()
        state = bridge.music_shelves._accounts["account-alpha"]
        for source in state.sources.values():
            source.fetched -= 7 * 3600
        rig.limited = True
        stale = await (await client.get(URL, headers=HEADERS)).json()
        if state.task is not None:
            await state.task
        assert state.backoff_until > 0
        calls = len(rig.shelf_calls)
        again = await (await client.get(URL, headers=HEADERS)).json()
        assert len(rig.shelf_calls) == calls
        assert stale["shelves"] == first["shelves"] == again["shelves"]


async def test_older_control_without_library_services_is_not_offered(shelves_rig):
    rig = shelves_rig
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services - SHELF_SERVICES
        | {"search_playlists"},
    )
    async with TestClient(TestServer(rig.app)) as client:
        response = await client.get(URL, headers=HEADERS)
        assert response.status == 503
        assert "shelves" not in rig.router.podview_music_reads()
        rig.router.podview_mood_selector = FakeShelfSelector()
        assert "shelves" in rig.router.podview_music_reads()
        data = await (await client.get(URL, headers=HEADERS)).json()
        assert [shelf["id"] for shelf in data["shelves"]] == [
            "ai_moment",
            "ai_daypart",
            "ai_season",
        ]


@pytest.mark.parametrize("suffix", ["&account=other", "&query=x", "&kind=mood"])
async def test_closed_query_never_reads(shelves_rig, suffix):
    async with TestClient(TestServer(shelves_rig.app)) as client:
        response = await client.get(URL + suffix, headers=HEADERS)
        assert response.status == 400
    assert shelves_rig.shelf_calls == []
