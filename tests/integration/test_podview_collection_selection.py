"""Source-shaped inert collection reads exercise the existing one-use play broker."""

import asyncio
import copy
from dataclasses import replace

import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration import test_podview_music_selection as selection_fixture

from gatekeeper.podview import BRIDGE

rig = selection_fixture.rig

HEADERS = {"Cookie": "podview_control=grant", "X-PodView-Request": "1"}
TARGET = {"accountId": "account-alpha", "kind": "spotify_device", "targetId": "device-one"}


def library(count=7, account="account-alpha"):
    return {
        "ok": True,
        "data": {
            "config_entry_id": account,
            "tracks": [
                {
                    "name": f"Actual {i}",
                    "artist": "Actual artist",
                    "uri": "spotify:track:" + str(i).zfill(22),
                }
                for i in range(count)
            ],
        },
        "selection": {
            "requested_limit": 20,
            "source_sample_count": count,
            "returned_count": count,
            "more_in_sample": False,
            "size_limited": False,
        },
    }


def install_library(rig, *, body=None, hook=None):
    original = rig.router.podview_read
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services
        | {"top_tracks", "recently_played"},
    )

    async def read(kind, account=None, query=None):
        if kind in {"recent", "top", "liked"}:
            if hook:
                await hook()
            return copy.deepcopy(body if body is not None else library())
        return await original(kind, account, query)

    rig.router.podview_read = read
    return original


def setup_body(bridge, source, ids):
    return {
        "bootId": bridge.boot_id,
        "roomId": "kitchen",
        "candidateSetId": source["candidateSetId"],
        "candidateIds": ids,
        "target": TARGET,
    }


@pytest.mark.parametrize("kind", ["top", "recent", "liked"])
async def test_exact_collection_occurrences_offer_and_execute_opaque_ids_once(rig, kind):
    install_library(rig)
    bridge = rig.app[BRIDGE]
    async with TestClient(TestServer(rig.app)) as client:
        body = await (
            await client.get(f"/view/api/music?kind={kind}&account=account-alpha", headers=HEADERS)
        ).json()
        source = body["candidateSet"]
        assert source["sourceKind"] == kind
        assert [item["index"] for item in source["items"]] == list(range(7))
        assert "uri" not in str(source["items"])
        ids = [source["items"][i]["id"] for i in [3, 4, 5]]
        offer = await (
            await client.post(
                "/view/api/music/selection/setup",
                headers=HEADERS,
                json=setup_body(bridge, source, ids),
            )
        ).json()
        assert [row["label"] for row in offer["options"]] == ["Actual 3", "Actual 4", "Actual 5"]
        action = {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "taskId": offer["taskId"],
            "revision": offer["revision"],
            "optionId": offer["options"][1]["id"],
            "requestId": "one",
            "confirmedVolumePercent": 35,
        }
        bridge.controls.music.execute_track.return_value = {"outcome": "unknown"}
        first = await (
            await client.post("/view/api/music/selection/actions", headers=HEADERS, json=action)
        ).json()
        again = await (
            await client.post("/view/api/music/selection/actions", headers=HEADERS, json=action)
        ).json()
        assert first["outcome"] == "unknown" and first == again and first["retryAllowed"] is False
        assert bridge.controls.music.execute_track.await_count == 1
        assert bridge.controls.music.execute_track.call_args.args[1] == "spotify:track:" + str(
            4
        ).zfill(22)


@pytest.mark.parametrize(
    "bad",
    [
        None,
        [],
        ["foreign"],
        [True],
        ["spotify:track:" + "A" * 22],
        "id",
        ["duplicate", "duplicate"],
        "duplicate_known",
        "too_many_known",
    ],
)
async def test_client_uri_foreign_duplicate_or_missing_ids_never_mint_offer(rig, bad):
    install_library(rig)
    bridge = rig.app[BRIDGE]
    async with TestClient(TestServer(rig.app)) as client:
        source = (
            await (
                await client.get(
                    "/view/api/music?kind=liked&account=account-alpha", headers=HEADERS
                )
            ).json()
        )["candidateSet"]
        if bad == "duplicate_known":
            bad = [source["items"][0]["id"]] * 2
        elif bad == "too_many_known":
            bad = [item["id"] for item in source["items"][:4]]
        body = setup_body(bridge, source, bad)
        if bad is None:
            body.pop("candidateIds")
        response = await client.post("/view/api/music/selection/setup", headers=HEADERS, json=body)
        assert response.status == 400
        assert bridge.controls.music.setup_track.await_count == 0
        assert not bridge.music_selection.tasks


async def test_passive_cached_collection_never_promotes_source_without_new_paired_read(rig):
    calls = []

    async def seen():
        calls.append(1)

    install_library(rig, hook=seen)
    bridge = rig.app[BRIDGE]
    async with TestClient(TestServer(rig.app)) as client:
        url = "/view/api/music?kind=liked&account=account-alpha"
        passive = await (await client.get(url)).json()
        assert "candidateSet" not in passive and not bridge.music_selection.sources
        paired = await (await client.get(url, headers=HEADERS)).json()
        assert len(calls) == 2 and paired["candidateSet"]["sourceKind"] == "liked"
        old = paired["candidateSet"]
        newer = await (await client.get(url, headers=HEADERS)).json()
        assert old["candidateSetId"] != newer["candidateSet"]["candidateSetId"]
        response = await client.post(
            "/view/api/music/selection/setup",
            headers=HEADERS,
            json=setup_body(bridge, old, [old["items"][0]["id"]]),
        )
        assert response.status == 409


@pytest.mark.parametrize("change", ["grant", "grant_replaced", "session", "owner", "account"])
async def test_collection_read_rejects_crossed_source_owner_or_grant(rig, change):
    bridge = rig.app[BRIDGE]

    async def mutate():
        if change == "grant":
            bridge.revoke("kitchen")
            bridge._grant_current = lambda *_: False
        elif change == "grant_replaced":
            bridge._grants["kitchen"] = ("grant", "replacement")
        elif change == "session":
            bridge.sessions["kitchen"]._epoch = "replacement"
        elif change == "owner":
            rig.router._services_epoch = getattr(rig.router, "_services_epoch", 0) + 1

    install_library(
        rig, body=library(account="foreign") if change == "account" else None, hook=mutate
    )
    async with TestClient(TestServer(rig.app)) as client:
        result = await (
            await client.get("/view/api/music?kind=liked&account=account-alpha", headers=HEADERS)
        ).json()
        assert "candidateSet" not in result
        assert not bridge.music_selection.sources


async def test_inflight_collection_read_is_serialized_before_newer_source_replaces_it(rig):
    install_library(rig)
    read = rig.router.podview_read
    entered, release = asyncio.Event(), asyncio.Event()
    reads = 0

    async def held(kind, account=None, query=None):
        nonlocal reads
        result = await read(kind, account, query)
        if kind == "liked":
            reads += 1
            if reads == 1:
                entered.set()
                await release.wait()
        return result

    rig.router.podview_read = held
    bridge = rig.app[BRIDGE]
    async with TestClient(TestServer(rig.app)) as client:
        url = "/view/api/music?kind=liked&account=account-alpha"
        old = asyncio.create_task(client.get(url, headers=HEADERS))
        await asyncio.wait_for(entered.wait(), 2)
        try:
            busy = await client.get(url, headers=HEADERS)
            assert busy.status == 429 and (await busy.json())["error"] == "music_busy"
        finally:
            release.set()
        first = await (await old).json()
        old_id = first["candidateSet"]["candidateSetId"]
        newer = await (await client.get(url, headers=HEADERS)).json()
        new_id = newer["candidateSet"]["candidateSetId"]
        assert new_id != old_id and reads == 2
        assert list(bridge.music_selection.sources) == [new_id]
