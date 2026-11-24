"""Actual HA transport and ingress for account-owned music observations, inert I/O."""

import asyncio
import copy
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import httpx
import pytest
from integration.test_podview_bridge import owner

from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE
from gatekeeper.podview_music import project_owner
from gatekeeper.tools import ToolRouter
from gatekeeper.web import create_app


def timestamp(offset=0):
    return (datetime.now(UTC) + timedelta(seconds=offset)).isoformat()


def item():
    return {
        "type": "track",
        "uri": "spotify:track:duplicate",
        "name": "Song",
        "artists": ["Artist"],
        "duration_ms": 123000,
        "token": "SECRET",
    }


def payload(kind, account="account-alpha"):
    result = {
        "ok": True,
        "schema": f"podconnect.{kind}.v1",
        "config_entry_id": account,
        "owner_epoch": "a" * 32,
        "secret": "SECRET",
    }
    if kind == "playback":
        result.update(
            poll_sequence=4,
            observation={
                "status": "fresh",
                "observed_at": timestamp(),
                "age_ms": 0,
                "max_age_ms": 15000,
                "source": "spotify_web_api",
                "token": "SECRET",
            },
            playback={
                "state": "playing",
                "target": {
                    "kind": "spotify_device",
                    "target_id": "device-one",
                    "name": "Kitchen",
                    "token": "SECRET",
                },
                "item": item(),
                "progress_ms": 1000,
                "provider_changed_at_ms": 1234,
                "shuffle": False,
                "repeat": "off",
                "artwork": "https://secret.invalid",
            },
            physical_result_verified=False,
        )
    else:
        snapshot = "a" * 32 + ":queue:1"
        result.update(
            snapshot_id=snapshot,
            observed_at=timestamp(),
            scope="account",
            coverage="provider_response",
            relation_to_playback="not_atomic",
            currently_playing=item(),
            items=[{**item(), "option_id": f"{snapshot}:{index}"} for index in range(2)],
            returned_count=2,
            truncated=False,
        )
    return result


class Rig:
    def __init__(self):
        self.calls = []
        self.values = {kind: payload(kind) for kind in ("playback", "queue")}
        self.liked_account_override = None
        self.search_account_override = None
        self.hook = None
        self.client = httpx.AsyncClient(transport=httpx.MockTransport(self.request))
        self.router = ToolRouter(None, supervisor_token="server-only", client=self.client)
        self.router._discovery = replace(
            self.router._discovery,
            podconnect_services=frozenset({"get_playback_snapshot", "get_queue", "liked"}),
        )
        self.router._refresh_podconnect_services = AsyncMock(
            side_effect=AssertionError("must not refresh")
        )
        self.session, _ = owner()
        self.app = create_app(StatusHub(), {"kitchen": self.session}, tools=self.router)

    async def request(self, request):
        self.calls.append((request.method, request.url.path, json.loads(request.content)))
        assert request.headers["Authorization"] == "Bearer server-only"
        if self.hook:
            await self.hook()
        kind = "queue" if "get_queue" in request.url.path else "playback"
        if "search_tracks" in request.url.path:
            body = json.loads(request.content)
            account = self.search_account_override or body.get("config_entry_id")
            value = {
                "ok": True,
                "schema": "podconnect.search_tracks.v1",
                "config_entry_id": account,
                "source": "spotify_web_api",
                "query": body["query"],
                "coverage": "spotify_search_sample",
                "limit": body["limit"],
                "source_sample_count": 2,
                "returned_count": 2,
                "source_has_more": True,
                "tracks": [
                    {
                        "name": f"Song {index}",
                        "artist": "Artist",
                        "uri": f"spotify:track:{str(index).zfill(22)}",
                        "artwork": {
                            "kind": "album_cover",
                            "provider": "spotify",
                            "url": "https://i.scdn.co/image/ab67616d0000b2730123456789abcdef",
                        },
                    }
                    for index in range(2)
                ],
                "access_token": "SECRET",
            }
        elif "liked" in request.url.path:
            account = self.liked_account_override or json.loads(request.content).get(
                "config_entry_id", "account-alpha"
            )
            value = {
                "config_entry_id": account,
                "tracks": [
                    {
                        "name": "Song",
                        "artist": "Artist",
                        "uri": "spotify:track:one",
                        "artwork": {
                            "kind": "album_cover",
                            "provider": "spotify",
                            "url": "https://i.scdn.co/image/ab67616d0000b2730123456789abcdef",
                        },
                    }
                ],
            }
        else:
            value = self.values[kind]
        return httpx.Response(200, json={"service_response": value})


@pytest.fixture
async def rig():
    value = Rig()
    yield value
    await value.client.aclose()


async def test_actual_transport_exact_services_accounts_and_unmodified_discovery(rig):
    before = rig.router._discovery
    declarations = rig.router.declarations()
    for kind in ("playback", "queue"):
        assert not (await rig.router.podview_read(kind))["ok"]
        for account in ("", True, [], "x" * 1025):
            assert not (await rig.router.podview_read(kind, account))["ok"]
        result = await rig.router.podview_read(kind, "account-alpha")
        assert result["ok"]
        assert "SECRET" not in json.dumps(result)
        assert "https://" not in json.dumps(result)
        assert result["data"]["owner_epoch"] == "a" * 32
        assert result["data"]["config_entry_id"] == "account-alpha"
    assert rig.calls == [
        (
            "POST",
            "/core/api/services/podconnect/get_playback_snapshot",
            {"config_entry_id": "account-alpha"},
        ),
        (
            "POST",
            "/core/api/services/podconnect/get_queue",
            {"config_entry_id": "account-alpha", "limit": 20},
        ),
    ]
    assert rig.router._discovery is before
    assert rig.router.declarations() == declarations
    assert not rig.router._refresh_podconnect_services.await_count
    library = await rig.router.podview_read("liked", "account-alpha")
    assert library["ok"]
    assert library["data"]["tracks"][0]["artwork"]["provider"] == "spotify"
    assert rig.calls[-1] == (
        "POST",
        "/core/api/services/podconnect/liked",
        {"config_entry_id": "account-alpha"},
    )
    legacy = await rig.router.podview_read("liked")
    assert legacy["ok"]
    assert rig.calls[-1] == ("POST", "/core/api/services/podconnect/liked", {})
    rig.liked_account_override = "account-alpha"
    assert not (await rig.router.podview_read("liked", "account-beta"))["ok"]
    rig.liked_account_override = None
    assert not (await rig.router.podview_read("liked", "x" * 1025))["ok"]
    rig.router._discovery = replace(before, podconnect_services=frozenset())
    assert rig.router.podview_music_reads() == []
    assert not (await rig.router.podview_read("queue", "account-alpha"))["ok"]
    assert len(rig.calls) == 5


async def test_search_transport_requires_advertised_service_and_exact_account_query(rig):
    original = rig.router._discovery
    assert "search" not in rig.router.podview_music_reads()
    rig.router._discovery = replace(
        original,
        podconnect_services=original.podconnect_services | {"search_tracks"},
    )
    reads = rig.router.podview_music_reads()
    assert "search" in reads
    for query in (None, " ", "x" * 161, 12):
        assert not (await rig.router.podview_read("search", "account-alpha", query))["ok"]
    assert not (await rig.router.podview_read("search", query="jazz"))["ok"]
    assert rig.calls == []

    result = await rig.router.podview_read("search", "account-alpha", "  jazz guitar  ")
    assert result["ok"]
    assert result["data"]["config_entry_id"] == "account-alpha"
    assert result["data"]["query"] == "jazz guitar"
    assert result["data"]["source"] == "spotify_web_api"
    assert result["data"]["coverage"] == "spotify_search_sample"
    assert len(result["data"]["tracks"]) == 2
    assert result["data"]["tracks"][0]["artwork"]["provider"] == "spotify"
    assert "SECRET" not in json.dumps(result)
    assert rig.calls[-1] == (
        "POST",
        "/core/api/services/podconnect/search_tracks",
        {"config_entry_id": "account-alpha", "query": "jazz guitar", "limit": 3},
    )
    rig.search_account_override = "account-other"
    assert not (await rig.router.podview_read("search", "account-alpha", "jazz guitar"))["ok"]
    rig.search_account_override = None
    rig.router._discovery = replace(original, podconnect_services=frozenset())
    assert "search" not in rig.router.podview_music_reads()


async def test_playlist_artwork_flag_is_sent_only_for_advertised_live_capability(rig):
    advertised = False
    requests = []

    async def handler(request):
        requests.append(
            (
                request.method,
                request.url.path,
                json.loads(request.content) if request.content else {},
            )
        )
        if request.url.path.endswith("/services"):
            fields = {"config_entry_id": {}, "query": {}, "limit": {}}
            if advertised:
                fields["include_artwork"] = {"required": False}
            return httpx.Response(
                200,
                json=[
                    {
                        "domain": "podconnect",
                        "services": {
                            "search_playlists": {"fields": fields},
                            "get_playback_snapshot": {},
                        },
                    }
                ],
            )
        return httpx.Response(
            200,
            json={
                "service_response": {
                    "ok": True,
                    "schema": "podconnect.search_playlists.v1",
                    "config_entry_id": "account-alpha",
                    "owner_epoch": "a" * 32,
                    "source": "spotify_web_api",
                    "query": "jazz",
                    "limit": 3,
                    "returned_count": 0,
                    "playlists": [],
                }
            },
        )

    old_client = rig.router._client
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    rig.router._client = client
    try:
        # Control 0.10.17 exposes no field. Discovery retains legacy arguments.
        await type(rig.router)._refresh_podconnect_services(rig.router)
        assert not rig.router._discovery.playlist_search_artwork
        await rig.router.podview_read("playlist_search", "account-alpha", "jazz")
        assert requests[-1][2] == {"config_entry_id": "account-alpha", "query": "jazz", "limit": 3}

        # Control 0.10.18 advertises the flag through HA /services.
        advertised = True
        await type(rig.router)._refresh_podconnect_services(rig.router)
        assert rig.router._discovery.playlist_search_artwork
        await rig.router.podview_read("playlist_search", "account-alpha", "jazz")
        assert requests[-1][2] == {
            "config_entry_id": "account-alpha",
            "query": "jazz",
            "limit": 3,
            "include_artwork": True,
        }

        # A subsequent discovery without the field withdraws it atomically.
        advertised = False
        await type(rig.router)._refresh_podconnect_services(rig.router)
        assert not rig.router._discovery.playlist_search_artwork
        await rig.router.podview_read("playlist_search", "account-alpha", "jazz")
        assert "include_artwork" not in requests[-1][2]
    finally:
        rig.router._client = old_client
        await client.aclose()


@pytest.mark.parametrize("kind", ["playback", "queue"])
@pytest.mark.parametrize("fault", ["account", "stale", "schema", "malformed", "oversized", "error"])
def test_closed_owner_projection_rejects_untrusted_or_stale_results(kind, fault):
    raw = payload(kind)
    if fault == "account":
        raw["config_entry_id"] = "other"
    elif fault == "stale":
        if kind == "playback":
            raw["observation"]["observed_at"] = timestamp(-60)
        else:
            raw["observed_at"] = timestamp(-60)
    elif fault == "schema":
        raw["schema"] = "future"
    elif fault == "malformed":
        if kind == "playback":
            raw["playback"]["state"] = {}
        else:
            raw["items"][1]["option_id"] = raw["items"][0]["option_id"]
    elif fault == "oversized":
        if kind == "playback":
            raw["playback"]["item"]["name"] = "x" * 1025
        else:
            raw["items"] *= 11
    else:
        raw = {"ok": False, "error_kind": "rate_limited", "error": "Bearer SECRET"}
    result = project_owner(kind, raw, "account-alpha")
    assert not result["ok"] and "SECRET" not in json.dumps(result)


def test_catalogue_artwork_is_optional_closed_and_host_allowlisted():
    from gatekeeper.podview_music import _artwork

    valid = {
        "kind": "album_cover",
        "provider": "spotify",
        "url": "https://i.scdn.co/image/ab67616d0000b2730123456789abcdef",
    }
    assert _artwork(valid) == valid
    for url in (
        "http://i.scdn.co/image/id",
        "https://example.com/image/id",
        "https://user@i.scdn.co/image/id",
        "https://i.scdn.co/image/id?token=x",
        "https://i.scdn.co/image/../id",
    ):
        assert _artwork({**valid, "url": url}) is None
    assert _artwork({**valid, "authorization": "secret"}) is None


@pytest.mark.parametrize("kind", ["playback", "queue"])
def test_owner_projection_preserves_only_valid_optional_artwork(kind):
    raw = payload(kind)
    image = "https://i.scdn.co/image/ab67616d0000b2730123456789abcdef"
    item_value = raw["playback"]["item"] if kind == "playback" else raw["items"][0]
    item_value["artwork"] = {"kind": "album_cover", "provider": "spotify", "url": image}
    result = project_owner(kind, raw, "account-alpha")
    projected = (
        result["data"]["playback"]["item"] if kind == "playback" else result["data"]["items"][0]
    )
    assert projected["artwork"]["url"] == image
    item_value["artwork"] = {
        "kind": "album_cover",
        "provider": "spotify",
        "url": "https://evil.example/x",
    }
    malformed = project_owner(kind, raw, "account-alpha")
    projected = (
        malformed["data"]["playback"]["item"]
        if kind == "playback"
        else malformed["data"]["items"][0]
    )
    assert "artwork" not in projected


def test_search_projection_accepts_only_exact_actual_source_rows():
    raw = {
        "ok": True,
        "schema": "podconnect.search_tracks.v1",
        "config_entry_id": "account-alpha",
        "source": "spotify_web_api",
        "query": "jazz guitar",
        "coverage": "spotify_search_sample",
        "limit": 3,
        "source_sample_count": 1,
        "returned_count": 1,
        "source_has_more": True,
        "tracks": [
            {
                "name": "Real result",
                "artist": "Artist",
                "uri": "spotify:track:0123456789abcdefghijkl",
                "artwork": {
                    "kind": "album_cover",
                    "provider": "spotify",
                    "url": "https://i.scdn.co/image/ab67616d0000b2730123456789abcdef",
                },
            }
        ],
        "access_token": "SECRET",
    }
    projected = project_owner("search", raw, "account-alpha", query="  jazz guitar ")
    assert projected["ok"]
    assert projected["data"]["query"] == "jazz guitar"
    assert projected["data"]["tracks"][0]["artwork"]["provider"] == "spotify"
    assert "SECRET" not in json.dumps(projected)
    assert not project_owner("search", raw, "account-other", query="jazz guitar")["ok"]
    assert not project_owner("search", raw, "account-alpha", query="different query")["ok"]
    for field, value in (
        ("source", "fixture"),
        ("coverage", "complete_catalogue"),
        ("limit", 20),
        ("returned_count", 2),
    ):
        broken = copy.deepcopy(raw)
        broken[field] = value
        assert not project_owner("search", broken, "account-alpha", query="jazz guitar")["ok"]
    broken = copy.deepcopy(raw)
    broken["tracks"][0]["uri"] = "spotify:track:arbitrary"
    assert not project_owner("search", broken, "account-alpha", query="jazz guitar")["ok"]


async def test_cancelled_transport_is_joined_and_never_publishes(rig):
    entered, cancelled = asyncio.Event(), asyncio.Event()

    async def hold():
        entered.set()
        try:
            await asyncio.Future()
        finally:
            cancelled.set()

    rig.hook = hold
    task = asyncio.create_task(rig.router.podview_read("queue", "account-alpha"))
    await asyncio.wait_for(entered.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancelled.is_set()
    assert not rig.app[BRIDGE]._music_cache


async def test_bounded_response_body_is_not_projected_or_cached_as_success(rig):
    rig.values["queue"]["ignored"] = "x" * 270000
    result = await rig.router.podview_read("queue", "account-alpha")
    assert not result["ok"]
    assert "ignored" not in json.dumps(result)
