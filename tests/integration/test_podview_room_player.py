"""The PodView player is the PodConnect room's own HA media_player, whoever started the music."""

import json
from dataclasses import replace
from unittest.mock import AsyncMock

import httpx
import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_bridge import owner

from gatekeeper import podview_room_player
from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE
from gatekeeper.tools import ToolRouter
from gatekeeper.web import create_app

ENTITY = "media_player.kokkenalrum"
UNIQUE = "account-alpha_room_r6"


def state(**changes):
    """A room started outside PodView, e.g. by HA play_media or the Spotify app."""
    attributes = {
        "podconnect_source": "spotify",
        "media_title": "Hey Jude",
        "media_artist": "The Beatles",
        "media_album_name": "1",
        "media_content_id": "spotify:track:" + "a" * 22,
        "entity_picture": "/api/media_player_proxy/media_player.kokkenalrum?token=t&cache=c",
        "media_duration": 431.0,
        "media_position": 12.5,
        "media_position_updated_at": "2026-11-12T18:00:00+00:00",
        "volume_level": 0.27,
        "friendly_name": "Køkkenalrum",
    }
    attributes.update(changes.pop("attributes", {}))
    return {"entity_id": ENTITY, "state": "playing", "attributes": attributes, **changes}


class Rig:
    def __init__(self):
        self.calls = []
        self.state = state()
        self.service_status = 200
        self.registry_reads = 0
        self.client = httpx.AsyncClient(transport=httpx.MockTransport(self.request))
        self.router = ToolRouter(None, supervisor_token="server-only", client=self.client)
        self.router._discovery = replace(
            self.router._discovery,
            podconnect_services=frozenset({"get_playback_snapshot", "get_queue"}),
        )
        self.router._refresh_podconnect_services = AsyncMock(side_effect=AssertionError)
        self.router._device_control._ws_read = self.ws_read
        self.session, _ = owner()
        self.app = create_app(StatusHub(), {"kitchen": self.session}, tools=self.router)
        self.bridge = self.app[BRIDGE]
        self.bridge.controls.policy = {
            "roomId": "kitchen",
            "vacuum": [],
            "light": [],
            "music": [
                {
                    "accountId": "account-alpha",
                    "targetId": "device-one",
                    "nativeRoomId": "r6",
                    "nativeHomepodId": "42",
                    "actions": ["pause", "resume", "next", "previous", "seek", "volume"],
                    "maxVolume": 40,
                }
            ],
        }
        self.token = self.bridge.grant_timer_control("kitchen")

    async def ws_read(self, command):
        self.registry_reads += 1
        assert command == {
            "type": "config/entity_registry/get_entries",
            "entity_ids": ["media_player.spotify_mads", ENTITY],
        }
        return {
            "media_player.spotify_mads": {"unique_id": "account-alpha", "platform": "podconnect"},
            ENTITY: {"unique_id": UNIQUE, "platform": "podconnect", "disabled_by": None},
        }

    async def request(self, request):
        assert request.headers["Authorization"] == "Bearer server-only"
        path = request.url.path
        body = json.loads(request.content) if request.content else None
        self.calls.append((request.method, path, body))
        if path == "/core/api/template":
            return httpx.Response(200, text=json.dumps(["media_player.spotify_mads", ENTITY]))
        if path == f"/core/api/states/{ENTITY}":
            return httpx.Response(200, json=self.state)
        if path.startswith("/core/api/services/media_player/"):
            return httpx.Response(self.service_status, json=[])
        if path.endswith("/get_playback_snapshot"):
            # PodConnect's account session: no output proof. The player must not need it.
            return httpx.Response(
                200, json={"service_response": {"ok": False, "error_kind": "stale"}}
            )
        if path.startswith("/core/api/media_player_proxy/"):
            return httpx.Response(200, content=b"\x89PNG", headers={"content-type": "image/png"})
        raise AssertionError(path)

    def services(self):
        return [
            (path.rsplit("/", 1)[1], body)
            for _, path, body in self.calls
            if "/services/media_player/" in path
        ]


@pytest.fixture
async def rig():
    value = Rig()
    yield value
    await value.client.aclose()


async def test_player_read_maps_room_state_without_output_proof(rig):
    body = await podview_room_player.read(rig.bridge, "kitchen", "account-alpha", rig.token)
    assert body["schema"] == "podview.room-player.v1"
    assert {key: body[key] for key in ("state", "source", "title", "artist", "album")} == {
        "state": "playing",
        "source": "spotify",
        "title": "Hey Jude",
        "artist": "The Beatles",
        "album": "1",
    }
    assert body["positionMs"] == 12500
    assert body["durationMs"] == 431000
    assert body["positionAt"] == 1794506400000
    assert body["volumePercent"] == 27
    assert body["actions"] == ["pause", "resume", "next", "previous", "seek", "volume"]
    assert body["maxVolume"] == 40
    assert body["artworkUrl"].startswith("music/player/artwork?room=kitchen&account=account-alpha")
    assert "token=t" not in json.dumps(body)
    assert body["session"] is None
    # The room entity wakes PodView on HA's own state_changed.
    assert ENTITY in rig.bridge.home_event_interests()["music"]


async def test_entity_lookup_is_cached(rig):
    for _ in range(3):
        await podview_room_player.read(rig.bridge, "kitchen", "account-alpha", rig.token)
    assert rig.registry_reads == 1
    assert sum(path == "/core/api/template" for _, path, _ in rig.calls) == 1


@pytest.mark.parametrize(
    "ha_state,expected",
    [("paused", "paused"), ("buffering", "buffering"), ("idle", "idle"), ("off", "unavailable")],
)
async def test_player_states(rig, ha_state, expected):
    rig.state = state(state=ha_state)
    body = await podview_room_player.read(rig.bridge, "kitchen", "account-alpha", rig.token)
    assert body["state"] == expected
    if expected in {"idle", "unavailable"}:
        assert body["title"] is None and body["artworkUrl"] is None


async def test_radio_uses_the_same_player(rig):
    rig.state = state(attributes={"podconnect_source": "radio", "media_title": "Radio"})
    body = await podview_room_player.read(rig.bridge, "kitchen", "account-alpha", rig.token)
    assert (body["source"], body["title"], body["state"]) == ("radio", "Radio", "playing")


async def test_no_grant_means_no_actions(rig):
    body = await podview_room_player.read(rig.bridge, "kitchen", "account-alpha", "not-a-grant")
    assert body["state"] == "playing"
    assert body["actions"] == [] and body["maxVolume"] is None
    result = await podview_room_player.command(
        rig.bridge, "kitchen", "account-alpha", "not-a-grant", "pause", None
    )
    assert result == {"outcome": "rejected", "error": "not_granted"}
    assert rig.services() == []


async def test_policy_limits_actions(rig):
    rig.bridge.controls.policy["music"][0]["actions"] = ["pause", "resume"]
    body = await podview_room_player.read(rig.bridge, "kitchen", "account-alpha", rig.token)
    assert body["actions"] == ["pause", "resume"]
    assert body["maxVolume"] is None
    result = await podview_room_player.command(
        rig.bridge, "kitchen", "account-alpha", rig.token, "next", None
    )
    assert result["outcome"] == "rejected"
    assert rig.services() == []


@pytest.mark.parametrize(
    "action,value,service,data",
    [
        ("pause", None, "media_pause", {}),
        ("resume", None, "media_play", {}),
        ("next", None, "media_next_track", {}),
        ("previous", None, "media_previous_track", {}),
        ("seek", 61500, "media_seek", {"seek_position": 61.5}),
        ("volume", 25, "volume_set", {"volume_level": 0.25}),
        ("volume", 90, "volume_set", {"volume_level": 0.4}),
    ],
)
async def test_each_tap_is_one_media_player_call(rig, action, value, service, data):
    result = await podview_room_player.command(
        rig.bridge, "kitchen", "account-alpha", rig.token, action, value
    )
    assert result == {"outcome": "accepted"}
    assert rig.services() == [(service, {"entity_id": ENTITY, **data})]


async def test_rejected_call_is_reported_once_and_never_retried(rig):
    rig.service_status = 400
    result = await podview_room_player.command(
        rig.bridge, "kitchen", "account-alpha", rig.token, "next", None
    )
    assert result == {"outcome": "rejected", "error": "ha_rejected"}
    assert rig.services() == [("media_next_track", {"entity_id": ENTITY})]


async def test_http_read_command_and_artwork(rig):
    cookie = {"Cookie": f"podview_control={rig.token}"}
    async with TestClient(TestServer(rig.app)) as client:
        response = await client.get(
            "/view/api/music?kind=playback&account=account-alpha&room=kitchen", headers=cookie
        )
        assert response.status == 200
        body = await response.json()
        assert body["state"] == "playing" and body["actions"]
        response = await client.post(
            "/view/api/music/player/actions",
            headers={**cookie, "X-PodView-Request": "1"},
            json={
                "bootId": rig.bridge.boot_id,
                "roomId": "kitchen",
                "account": "account-alpha",
                "action": "volume",
                "value": 30,
                "requestId": "tap-1",
            },
        )
        assert response.status == 200
        assert await response.json() == {"ok": True, "requestId": "tap-1", "outcome": "accepted"}
        rig.service_status = 500
        response = await client.post(
            "/view/api/music/player/actions",
            headers={**cookie, "X-PodView-Request": "1"},
            json={
                "bootId": rig.bridge.boot_id,
                "roomId": "kitchen",
                "account": "account-alpha",
                "action": "pause",
                "requestId": "tap-2",
            },
        )
        assert response.status == 409
        assert (await response.json())["outcome"] == "rejected"
        response = await client.get("/view/" + body["artworkUrl"].replace("music/", "api/music/"))
        assert response.status == 200
        assert response.content_type == "image/png"
    assert rig.services() == [
        ("volume_set", {"entity_id": ENTITY, "volume_level": 0.3}),
        ("media_pause", {"entity_id": ENTITY}),
    ]
