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
        if "liked" in request.url.path:
            value = {"tracks": [{"name": "Song", "artist": "Artist", "uri": "spotify:track:one"}]}
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
    rig.router._discovery = replace(before, podconnect_services=frozenset())
    assert rig.router.podview_music_reads() == []
    assert not (await rig.router.podview_read("queue", "account-alpha"))["ok"]
    assert len(rig.calls) == 2


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
            data = (await response.json())["data"]
            assert (
                data["observation"]["observed_at"]
                == rig.values["playback"]["observation"]["observed_at"]
            )
            assert data["poll_sequence"] == 4 and data["physical_result_verified"] is False
        assert len(rig.calls) == 2  # No bridge playback success cache.
        for _ in range(2):
            response = await client.get("/view/api/music?kind=queue&account=account-alpha")
            queue = (await response.json())["data"]
            assert queue["observed_at"] == rig.values["queue"]["observed_at"]
            assert queue["items"][0]["uri"] == queue["items"][1]["uri"]
            assert queue["items"][0]["option_id"] != queue["items"][1]["option_id"]
            assert queue["scope"] == "account" and queue["relation_to_playback"] == "not_atomic"
        assert len(rig.calls) == 3
        assert not rig.session.tools.timers.command.await_count


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
