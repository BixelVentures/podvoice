"""Actual HA transport and ingress for account-owned music observations, inert I/O."""

import asyncio
import copy
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import httpx
import pytest
from aiohttp.test_utils import TestClient, TestServer
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


async def test_ingress_contract_preserves_freshness_duplicates_and_has_no_controls(rig):
    async with TestClient(TestServer(rig.app)) as client:
        capabilities = (await (await client.get("/view/api/snapshot")).json())["capabilities"]
        assert "playback" in capabilities["musicRead"] and "queue" in capabilities["musicRead"]
        assert capabilities["musicActions"] == []
        assert (await client.get("/view/api/music?kind=playback")).status == 400
        assert (
            await client.get("/view/api/music?room=other&kind=queue&account=account-alpha")
        ).status == 409
        assert (
            await client.get(
                "/view/api/music?kind=queue&account=account-alpha",
                headers={"Sec-Fetch-Site": "cross-site"},
            )
        ).status == 403
        for _ in range(2):
            response = await client.get("/view/api/music?kind=playback&account=account-alpha")
            public = await response.json()
            assert public["schema"] == "podview.room-playback.v1"
            assert public["status"] == "unavailable" and public["data"] is None
        assert rig.calls == []  # No room binding: do not read account-wide playback.
        for _ in range(2):
            response = await client.get("/view/api/music?kind=queue&account=account-alpha")
            queue = (await response.json())["data"]
            assert queue["observed_at"] == rig.values["queue"]["observed_at"]
            assert queue["items"][0]["uri"] == queue["items"][1]["uri"]
            assert queue["items"][0]["option_id"] != queue["items"][1]["option_id"]
            assert queue["scope"] == "account" and queue["relation_to_playback"] == "not_atomic"
        assert len(rig.calls) == 1
        response = await client.get("/view/api/music?kind=liked&account=account-alpha")
        library = await response.json()
        assert library["data"]["config_entry_id"] == "account-alpha"
        assert library["data"]["tracks"][0]["artwork"]["url"].startswith("https://i.scdn.co/image/")
        assert rig.calls[-1] == (
            "POST",
            "/core/api/services/podconnect/liked",
            {"config_entry_id": "account-alpha"},
        )
        assert len(rig.calls) == 2
        assert not rig.session.tools.timers.command.await_count


async def test_passive_speakers_route_reuses_view_guard_and_exact_account_query(rig, monkeypatch):
    from gatekeeper import podview

    seen = []

    async def read_catalogue(bridge, room, account, owner_binding, *, token):
        seen.append((bridge, room, account, owner_binding(), token))
        return {"ok": False, "schema": "podview.speaker-catalogue.v1", "status": "unavailable"}

    monkeypatch.setattr(podview.podview_speakers, "read_catalogue", read_catalogue)
    async with TestClient(TestServer(rig.app)) as client:
        for query in (
            "kind=speakers",
            "kind=speakers&account=",
            "kind=speakers&account=account-alpha&account=account-alpha",
            "kind=speakers&account=account-alpha&query=refresh",
            "kind=speakers&account=account-alpha&room=kitchen&room=kitchen",
            "kind=speakers&account=account-alpha&room=other&room=kitchen",
            "kind=speakers&kind=speakers&account=account-alpha",
        ):
            assert (await client.get(f"/view/api/music?{query}")).status == 400
        assert not seen
        denied = await client.get(
            "/view/api/music?kind=speakers&account=account-alpha",
            headers={"Sec-Fetch-Site": "cross-site"},
        )
        assert denied.status == 403 and not seen
        response = await client.get(
            "/view/api/music?kind=speakers&account=account-alpha&room=kitchen"
        )
        assert response.status == 200
        assert response.headers["Cache-Control"] == "no-store"
        assert (await response.json())["schema"] == "podview.speaker-catalogue.v1"
    assert seen == [
        (
            rig.app[BRIDGE],
            "kitchen",
            "account-alpha",
            (podview._music_binding(rig.app[BRIDGE], "kitchen"), True),
            "",
        )
    ]
    assert rig.calls == []


async def test_catalogue_ingress_rejects_different_source_account_without_echo_or_tracks(rig):
    rig.liked_account_override = "account-other"
    async with TestClient(TestServer(rig.app)) as client:
        response = await client.get("/view/api/music?kind=liked&account=account-alpha")
        public = await response.json()
        assert not public["ok"]
        assert "data" not in public and "account-other" not in json.dumps(public)
        assert len(rig.calls) == 1
        assert not rig.session.tools.timers.command.await_count


async def test_search_ingress_binds_actual_query_results_to_account_session_task_and_revision(rig):
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services | {"search_tracks"},
    )
    async with TestClient(TestServer(rig.app)) as client:
        assert (await client.get("/view/api/music?kind=search&query=jazz")).status == 400
        assert (await client.get("/view/api/music?kind=search&account=account-alpha")).status == 400
        assert (
            await client.get(
                "/view/api/music?kind=search&account=account-alpha&query=jazz&query=rock"
            )
        ).status == 400
        response = await client.get(
            "/view/api/music?kind=search&account=account-alpha&query=%20jazz%20guitar%20"
        )
        result = await response.json()
        assert response.status == 200 and result["ok"], result
        assert result["data"]["query"] == "jazz guitar"
        assert result["data"]["config_entry_id"] == "account-alpha"
        assert result["data"]["source"] == "spotify_web_api"
        assert [row["name"] for row in result["data"]["tracks"]] == ["Song 0", "Song 1"]
        assert "access_token" not in json.dumps(result)
        context = result["candidateSet"]
        assert context["schema"] == "podview.music-search-context.v1"
        assert context["roomId"] == "kitchen"
        current = await (await client.get("/view/api/snapshot")).json()
        assert context["revision"] == current["answers"]["revision"]
        assert context["revisionScope"] == "answer_task"
        assert context["sessionId"] == current["voice"]["sessionId"]
        assert context["taskId"] == current["answers"]["taskId"]
        assert context["inputRevision"] == current["answers"]["inputRevision"]
        assert context["configEntryId"] == "account-alpha"
        assert context["source"] == "spotify_web_api"
        assert context["query"] == "jazz guitar"
        assert len(context["candidateSetId"]) == 64
        assert "actions" not in result and "option_id" not in json.dumps(result)
        from gatekeeper.podview import _music_search_candidate_set

        altered = copy.deepcopy(result["data"])
        altered["tracks"][0]["name"] = "Different actual result"
        assert (
            _music_search_candidate_set(
                {key: value for key, value in context.items() if key != "candidateSetId"}, altered
            )["candidateSetId"]
            != context["candidateSetId"]
        )
        assert rig.calls[-1] == (
            "POST",
            "/core/api/services/podconnect/search_tracks",
            {"config_entry_id": "account-alpha", "query": "jazz guitar", "limit": 3},
        )
        assert not rig.session.tools.timers.command.await_count


async def test_search_discards_results_if_room_session_changes_in_flight(rig):
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services | {"search_tracks"},
    )
    entered, release = asyncio.Event(), asyncio.Event()

    async def hold():
        entered.set()
        await release.wait()

    rig.hook = hold
    async with TestClient(TestServer(rig.app)) as client:
        task = asyncio.create_task(
            client.get("/view/api/music?kind=search&account=account-alpha&query=actual")
        )
        await asyncio.wait_for(entered.wait(), 1)
        rig.app[BRIDGE].sessions["kitchen"] = copy.copy(rig.session)
        release.set()
        response = await task
        assert response.status == 503
        assert not (await response.json())["ok"]
        assert rig.app[BRIDGE]._music_cache == {}


async def test_search_discards_results_if_answer_task_revision_changes_in_flight(rig):
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services | {"search_tracks"},
    )
    entered, release = asyncio.Event(), asyncio.Event()

    async def hold():
        entered.set()
        await release.wait()

    rig.hook = hold
    receipt_owner = rig.router.podview_receipts
    async with TestClient(TestServer(rig.app)) as client:
        task = asyncio.create_task(
            client.get("/view/api/music?kind=search&account=account-alpha&query=actual")
        )
        await asyncio.wait_for(entered.wait(), 1)
        receipt_owner.snapshot = lambda room, session: {
            "revision": 1,
            "items": [
                {"taskId": "new-task", "inputRevision": 2, "sessionId": "s1", "turnId": "s1:1"}
            ],
        }
        release.set()
        response = await task
        assert response.status == 503
        assert not (await response.json())["ok"]
        assert rig.app[BRIDGE]._music_cache == {}


async def test_unrelated_timer_tick_does_not_invalidate_same_search_task(rig):
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services | {"search_tracks"},
    )
    entered, release = asyncio.Event(), asyncio.Event()

    async def hold():
        entered.set()
        await release.wait()

    rig.hook = hold
    async with TestClient(TestServer(rig.app)) as client:
        before = await (await client.get("/view/api/snapshot")).json()
        task = asyncio.create_task(
            client.get("/view/api/music?kind=search&account=account-alpha&query=actual")
        )
        await asyncio.wait_for(entered.wait(), 1)
        rig.session.tools.timers.snapshots["kitchen"]["timers"][0]["seconds_left"] -= 1
        release.set()
        response = await task
        result = await response.json()
        after = await (await client.get("/view/api/snapshot")).json()
        assert response.status == 200 and result["ok"]
        assert after["revision"] > before["revision"]
        assert result["candidateSet"]["revision"] == after["answers"]["revision"]


@pytest.mark.parametrize(
    "change", ["discovery", "client", "token", "services", "session", "session_tools", "tools"]
)
async def test_no_old_read_or_cache_publication_after_owner_change(rig, change):
    entered, release = asyncio.Event(), asyncio.Event()
    old_client = rig.client

    async def hold():
        entered.set()
        await release.wait()

    rig.hook = hold
    async with TestClient(TestServer(rig.app)) as client:
        task = asyncio.create_task(client.get("/view/api/music?kind=queue&account=account-alpha"))
        await asyncio.wait_for(entered.wait(), 1)
        if change == "discovery":
            rig.router._discovery = replace(rig.router._discovery)
        elif change == "client":
            rig.router._client = httpx.AsyncClient(transport=httpx.MockTransport(rig.request))
        elif change == "token":
            rig.router._token = ""
        elif change == "services":
            rig.router._discovery = replace(rig.router._discovery, podconnect_services=frozenset())
        elif change == "session":
            rig.app[BRIDGE].sessions["kitchen"] = copy.copy(rig.session)
        elif change == "session_tools":
            rig.session.tools = copy.copy(rig.session.tools)
        else:
            rig.app[BRIDGE].tools = ToolRouter(None)
        release.set()
        assert not (await (await task).json())["ok"]
        assert rig.app[BRIDGE]._music_cache == {}
    if rig.router._client is not old_client:
        await rig.router._client.aclose()


@pytest.mark.parametrize("kind", ["queue", "liked"])
@pytest.mark.parametrize("change", ["discovery", "token", "session", "revoked"])
async def test_existing_music_caches_are_retired_when_binding_changes(rig, kind, change):
    query = f"/view/api/music?kind={kind}" + ("&account=account-alpha" if kind == "queue" else "")
    async with TestClient(TestServer(rig.app)) as client:
        assert (await (await client.get(query)).json())["ok"]
        if change == "discovery":
            rig.router._discovery = replace(rig.router._discovery)
        elif change == "token":
            rig.router._token = ""
        elif change == "session":
            rig.session._history_session = "new-session"
        else:
            rig.router._discovery = replace(rig.router._discovery, podconnect_services=frozenset())
        result = await (await client.get(query)).json()
        if change in {"token", "revoked"}:
            assert not result["ok"]
            assert len(rig.calls) == 1
        else:
            assert result["ok"] and len(rig.calls) == 2


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


async def test_observed_revocation_cannot_restore_old_cache_when_credentials_return(rig):
    async with TestClient(TestServer(rig.app)) as client:
        query = "/view/api/music?kind=liked"
        assert (await (await client.get(query)).json())["ok"]
        rig.router._token = ""
        assert not (await (await client.get(query)).json())["ok"]
        assert not rig.app[BRIDGE]._music_cache
        rig.router._token = "server-only"
        assert (await (await client.get(query)).json())["ok"]
        assert len(rig.calls) == 2


async def test_bounded_response_body_is_not_projected_or_cached_as_success(rig):
    rig.values["queue"]["ignored"] = "x" * 270000
    async with TestClient(TestServer(rig.app)) as client:
        result = await (await client.get("/view/api/music?kind=queue&account=account-alpha")).json()
        assert not result["ok"]
        assert "ignored" not in json.dumps(result)
