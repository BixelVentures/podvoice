"""Actual root HTTP → owner reads → one aggregate set → native context facade, inert I/O."""

import asyncio
import copy
import json
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_music_selection import rig  # noqa: F401

from gatekeeper.podview import BRIDGE
from gatekeeper.podview_mood import configured_mood_selector

HEADERS = {"Cookie": "podview_control=grant", "X-PodView-Request": "1"}


@pytest.fixture
async def mood_rig(rig):  # noqa: F811 - imported pytest fixture
    router, bridge = rig.router, rig.app[BRIDGE]
    router._discovery = replace(
        router._discovery,
        podconnect_services=router._discovery.podconnect_services
        | {"search_playlists", "get_context_play_controls"},
    )
    router.podview_mood_selector = SimpleNamespace(
        available=True,
        select=AsyncMock(return_value=["cooking", "italian", "calm"]),
        room_kind="kitchen",
    )
    router.podview_mood_context = AsyncMock(return_value={"hour": 18, "roomKind": "kitchen"})
    bridge.controls.policy["music"][0]["actions"].append("play_context")
    controls = copy.deepcopy(bridge.controls.music.setup_track.return_value)
    controls["data"].update(context_play_supported=True, actions=["play_context"])
    bridge.controls.music.setup_context = AsyncMock(return_value=controls)
    bridge.controls.music.execute_context = AsyncMock(return_value={"outcome": "accepted"})
    rig.playlist_epoch = "a" * 32
    rig.playlist_account = "account-alpha"
    rig.playlist_same = False
    old = rig.client

    async def request(req):
        if "search_playlists" not in req.url.path:
            return await rig.request(req)
        data = json.loads(req.content)
        rig.calls.append(("POST", req.url.path, data))
        suffix = {
            "cooking": "a",
            "italian dinner": "b",
            "calm acoustic": "c",
            "morning acoustic": "d",
            "evening jazz": "e",
        }[data["query"]]
        if rig.playlist_same:
            suffix = "a"
        return httpx.Response(
            200,
            json={
                "service_response": {
                    "ok": True,
                    "schema": "podconnect.search_playlists.v1",
                    "config_entry_id": rig.playlist_account,
                    "owner_epoch": rig.playlist_epoch,
                    "source": "spotify_web_api",
                    "query": data["query"],
                    "limit": 3,
                    "returned_count": 1,
                    "playlists": [
                        {"uri": "spotify:playlist:" + suffix * 22, "name": f"Real {suffix}"}
                    ],
                }
            },
        )

    rig.client = router._client = httpx.AsyncClient(transport=httpx.MockTransport(request))
    await old.aclose()
    return rig


async def mood(client, refresh=False):
    return await (
        await client.get(
            "/view/api/music?kind=mood&account=account-alpha" + ("&refresh=1" if refresh else ""),
            headers=HEADERS,
        )
    ).json()


async def test_three_owned_themes_one_real_source_and_retained_until_refresh(mood_rig):
    bridge = mood_rig.app[BRIDGE]
    async with TestClient(TestServer(mood_rig.app)) as client:
        first = await mood(client)
        assert first["ok"] and len(first["data"]["tracks"]) == 3
        assert first["candidateSet"]["sourceKind"] == "mood"
        assert len(first["candidateSet"]["items"]) == 3
        assert len(bridge.music_selection.sources) == 1
        assert all(row["uri"].startswith("spotify:playlist:") for row in first["data"]["tracks"])
        assert [row["themeArt"] for row in first["data"]["tracks"]] == [
            "assets/kitchen.png",
            "assets/italian.png",
            "assets/lake.png",
        ]
        second = await mood(client)
        assert second["data"]["tracks"] == first["data"]["tracks"]
        assert mood_rig.router.podview_mood_selector.select.await_count == 1
        assert len([call for call in mood_rig.calls if "search_playlists" in call[1]]) == 6
        assert mood_rig.router.podview_mood_selector.select.await_args.args == (
            {"hour": 18, "roomKind": "kitchen"},
        )
        refreshed = await mood(client, True)
        assert refreshed["ok"] and len(bridge.music_selection.sources) == 1
        assert mood_rig.router.podview_mood_selector.select.await_count == 2


async def test_opaque_context_option_uses_existing_native_owner_once(mood_rig):
    bridge = mood_rig.app[BRIDGE]
    async with TestClient(TestServer(mood_rig.app)) as client:
        body = await mood(client)
        assert body["ok"], body
        offer = await (
            await client.post(
                "/view/api/music/selection/setup",
                headers=HEADERS,
                json={
                    "bootId": bridge.boot_id,
                    "roomId": "kitchen",
                    "candidateSetId": body["candidateSet"]["candidateSetId"],
                    "candidateIds": [row["id"] for row in body["candidateSet"]["items"]],
                    "target": {
                        "accountId": "account-alpha",
                        "kind": "spotify_device",
                        "targetId": "device-one",
                    },
                },
            )
        ).json()
        assert offer["ok"] and len(offer["options"]) == 3, offer
        assert "spotify:playlist:" not in str(offer)
        task = bridge.music_selection.tasks[offer["taskId"]]
        assert task["action"] == "play_context"
        action = {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "taskId": offer["taskId"],
            "revision": offer["revision"],
            "requestId": "one",
            "optionId": offer["options"][1]["id"],
            "confirmedVolumePercent": 30,
        }
        first = await (
            await client.post("/view/api/music/selection/actions", headers=HEADERS, json=action)
        ).json()
        second = await (
            await client.post("/view/api/music/selection/actions", headers=HEADERS, json=action)
        ).json()
        assert first == second and first["outcome"] == "accepted", first
        facade = bridge.controls.music
        assert facade.execute_context.await_count == 1 and facade.execute_track.await_count == 0
        assert facade.execute_context.await_args.args[1] == "spotify:playlist:" + "b" * 22


@pytest.mark.parametrize("field", ["playlist_epoch", "playlist_account", "playlist_same"])
async def test_malformed_or_changed_owner_no_partial_sources(mood_rig, field):
    setattr(mood_rig, field, True if field == "playlist_same" else "other")
    async with TestClient(TestServer(mood_rig.app)) as client:
        assert not (await mood(client))["ok"]
        assert not mood_rig.app[BRIDGE].music_selection.sources
        assert mood_rig.app[BRIDGE].controls.music.execute_context.await_count == 0


async def test_track_grant_cannot_authorize_playlist(mood_rig):
    bridge = mood_rig.app[BRIDGE]
    bridge.controls.policy["music"][0]["actions"] = ["play_track"]
    async with TestClient(TestServer(mood_rig.app)) as client:
        assert not (await mood(client))["ok"]
        assert mood_rig.router.podview_mood_selector.select.await_count == 0


async def test_default_off_no_allowance_old_visual_policy_cannot_activate(tmp_path):
    client = SimpleNamespace()
    for policy in ("", '{"model":"gpt-6-luna","max_requests":20}'):
        assert configured_mood_selector(client, "key", policy, tmp_path / "mood.json") is None
    assert list(tmp_path.iterdir()) == []


async def test_owner_change_during_model_does_not_lookup_or_register(mood_rig):
    async def changed(content, *, current):
        mood_rig.app[BRIDGE]._grants.clear()
        return ["cooking", "italian", "calm"]

    mood_rig.router.podview_mood_selector.select.side_effect = changed
    async with TestClient(TestServer(mood_rig.app)) as client:
        assert not (await mood(client))["ok"]
        assert not mood_rig.app[BRIDGE].music_selection.sources
        assert not any("search_playlists" in call[1] for call in mood_rig.calls)


async def test_default_off_runtime_does_not_read_playlist_or_model(rig):  # noqa: F811
    assert rig.router.podview_mood_selector is None
    async with TestClient(TestServer(rig.app)) as client:
        assert not (await mood(client))["ok"]
    assert rig.calls == []


async def test_voice_uses_same_playlist_option_ids_and_existing_confirmation_owner(mood_rig):
    from gatekeeper.execution_policy import ExecutionContext

    bridge, router = mood_rig.app[BRIDGE], mood_rig.router
    async with TestClient(TestServer(mood_rig.app)) as client:
        body = await mood(client)
        offer = await (
            await client.post(
                "/view/api/music/selection/setup",
                headers=HEADERS,
                json={
                    "bootId": bridge.boot_id,
                    "roomId": "kitchen",
                    "candidateSetId": body["candidateSet"]["candidateSetId"],
                    "candidateIds": [row["id"] for row in body["candidateSet"]["items"]],
                    "target": {
                        "accountId": "account-alpha",
                        "kind": "spotify_device",
                        "targetId": "device-one",
                    },
                },
            )
        ).json()
        proposal = ExecutionContext("s1", "live:1:proposal", "live")
        available = await router.dispatch("podview_music_options", {}, execution_context=proposal)
        assert available["ok"] and available["data"]["options"] == offer["options"]
        args = {
            "taskId": offer["taskId"],
            "revision": offer["revision"],
            "optionId": offer["options"][1]["id"],
            "confirmedVolumePercent": offer["observedVolumePercent"],
        }
        pending = await router.dispatch(
            "podview_music_select_option", args, execution_context=proposal
        )
        assert pending["needs_confirmation"]
        assert bridge.controls.music.execute_context.await_count == 0
        confirmation = ExecutionContext("s1", "live:1:confirmation", "live")
        approved = router.execution_policy.confirm_live(
            pending["approval"]["challenge_id"],
            confirmation_context=confirmation,
            expected_arguments_sha256=pending["arguments_sha256"],
        )
        assert approved is not None
        result = await router.dispatch(
            approved.action,
            approved.args,
            execution_context=approved.context,
            approval_token=approved.token,
        )
        assert result["ok"] and result["data"]["outcome"] == "accepted"
        assert bridge.controls.music.execute_context.await_count == 1
        assert bridge.controls.music.execute_track.await_count == 0


async def test_automatic_renew_without_retained_server_rows_never_spends_model_allowance(mood_rig):
    async with TestClient(TestServer(mood_rig.app)) as client:
        body = await (
            await client.get(
                "/view/api/music?kind=mood&account=account-alpha&renew=1", headers=HEADERS
            )
        ).json()
        assert not body["ok"]
    assert mood_rig.router.podview_mood_selector.select.await_count == 0


async def test_owner_epoch_renew_revalidates_exact_playlists_without_model_or_content_change(
    mood_rig,
):
    async with TestClient(TestServer(mood_rig.app)) as client:
        first = await mood(client)
        mood_rig.playlist_epoch = "c" * 32
        mood_rig.values["playback"]["owner_epoch"] = "c" * 32
        renewed = await (
            await client.get(
                "/view/api/music?kind=mood&account=account-alpha&renew=1", headers=HEADERS
            )
        ).json()
        assert renewed["ok"], renewed
        assert renewed["data"]["tracks"] == first["data"]["tracks"]
        assert mood_rig.router.podview_mood_selector.select.await_count == 1
        assert len([call for call in mood_rig.calls if "search_playlists" in call[1]]) == 6


@pytest.mark.parametrize("mutation", ["name", "removed", "account", "epoch"])
async def test_same_epoch_expired_source_must_revalidate_frozen_playlist_metadata(
    mood_rig, mutation
):
    bridge, router = mood_rig.app[BRIDGE], mood_rig.router
    async with TestClient(TestServer(mood_rig.app)) as client:
        first = await mood(client)
        retained = copy.deepcopy(bridge._mood_retained["rows"])
        source = bridge.music_selection.sources[first["candidateSet"]["candidateSetId"]]
        source["deadline"] = 0
        original = router.podview_read
        lookups = []

        async def changed(kind, account=None, query=None):
            result = await original(kind, account, query)
            if kind == "playlist_search":
                lookups.append(query)
                if mutation == "name":
                    for row in result.get("data", {}).get("playlists", []):
                        row["name"] += " renamed"
                elif mutation == "removed":
                    result["data"]["playlists"] = []
                else:
                    result["data"][
                        "config_entry_id" if mutation == "account" else "owner_epoch"
                    ] = "other"
            return result

        router.podview_read = changed
        result = await (
            await client.get(
                "/view/api/music?kind=mood&account=account-alpha&renew=1", headers=HEADERS
            )
        ).json()
        assert not result["ok"] and result["error"] == "mood_refresh_required"
        assert lookups == ["cooking", "italian dinner", "calm acoustic"]  # one bounded batch
        assert bridge.music_selection.sources == {} and bridge.music_selection.tasks == {}
        assert bridge._mood_retained["rows"] == retained
        assert router.podview_mood_selector.select.await_count == 1
        assert bridge.controls.music.execute_context.await_count == 0


async def test_same_epoch_renew_rechecks_all_three_exact_rows_before_reissuing_ids(mood_rig):
    bridge = mood_rig.app[BRIDGE]
    async with TestClient(TestServer(mood_rig.app)) as client:
        first = await mood(client)
        bridge.music_selection.sources[first["candidateSet"]["candidateSetId"]]["deadline"] = 0
        before = len(mood_rig.calls)
        renewed = await (
            await client.get(
                "/view/api/music?kind=mood&account=account-alpha&renew=1", headers=HEADERS
            )
        ).json()
        assert renewed["ok"]
        assert renewed["data"]["tracks"] == first["data"]["tracks"]
        assert renewed["candidateSet"]["candidateSetId"] != first["candidateSet"]["candidateSetId"]
        assert [
            call[2]["query"] for call in mood_rig.calls[before:] if "search_playlists" in call[1]
        ] == ["cooking", "italian dinner", "calm acoustic"]
        assert len(bridge.music_selection.sources) == 1
        assert mood_rig.router.podview_mood_selector.select.await_count == 1


async def test_morning_and_evening_are_real_query_themes_not_automatic_card_rotation(mood_rig):
    router = mood_rig.router
    router.podview_mood_context.return_value = {"hour": 7, "roomKind": "kitchen"}
    router.podview_mood_selector.select.return_value = ["morning_acoustic", "cooking", "calm"]
    async with TestClient(TestServer(mood_rig.app)) as client:
        morning = await mood(client)
        assert morning["ok"], morning
        assert morning["data"]["tracks"][0]["themeTitle"] == "En rolig morgen"
        assert morning["data"]["tracks"][0]["themeArt"] == "assets/morning-acoustic.png"
        assert morning["data"]["tracks"][0]["name"] == "Real d"
        assert [call[2]["query"] for call in mood_rig.calls if "search_playlists" in call[1]] == [
            "morning acoustic",
            "cooking",
            "calm acoustic",
        ]
        router.podview_mood_context.return_value = {"hour": 20, "roomKind": "kitchen"}
        router.podview_mood_selector.select.return_value = ["evening_jazz", "italian", "calm"]
        retained = await mood(client)
        assert retained["data"]["tracks"] == morning["data"]["tracks"]
        assert router.podview_mood_selector.select.await_count == 1
        evening = await mood(client, True)
        assert evening["ok"], evening
        assert evening["data"]["tracks"][0]["themeTitle"] == "Rolig aften"
        assert evening["data"]["tracks"][0]["themeArt"] == "assets/lake.png"
        assert evening["data"]["tracks"][0]["name"] == "Real e"
        assert router.podview_mood_selector.select.await_count == 2
        assert [
            call.args[0]["hour"] for call in router.podview_mood_selector.select.await_args_list
        ] == [7, 20]
        assert len(evening["data"]["tracks"]) == 3


@pytest.mark.parametrize("mutation", [None, "account", "epoch", "session", "grant"])
async def test_playlist_batch_enters_all_reads_before_release_and_fences_publication(
    mood_rig, mutation
):
    from gatekeeper.podview import _mood_music

    bridge, router = mood_rig.app[BRIDGE], mood_rig.router
    original = router.podview_read
    entered, release = asyncio.Event(), asyncio.Event()
    queries, finished = [], []
    gates = {query: asyncio.Event() for query in ("cooking", "italian dinner", "calm acoustic")}
    completed = {query: asyncio.Event() for query in gates}

    async def blocked(kind, account=None, query=None):
        if kind != "playlist_search":
            return await original(kind, account, query)
        queries.append(query)
        if len(queries) == 3:
            entered.set()
        try:
            await release.wait()
            await gates[query].wait()
            result = await original(kind, account, query)
            if mutation in ("account", "epoch"):
                result["data"]["config_entry_id" if mutation == "account" else "owner_epoch"] = (
                    "other"
                )
            return result
        finally:
            finished.append(query)
            completed[query].set()

    router.podview_read = blocked
    request = SimpleNamespace(
        query={"account": "account-alpha"}, cookies={"podview_control": "grant"}
    )
    task = asyncio.create_task(_mood_music(request, bridge, "kitchen"))
    try:
        # Timeout is only a deadlock guard: proof is the barrier, never elapsed time.
        await asyncio.wait_for(entered.wait(), 2)
        assert queries == ["cooking", "italian dinner", "calm acoustic"]
        assert not finished and not task.done() and not bridge.music_selection.sources
        if mutation == "session":
            bridge.sessions["kitchen"] = SimpleNamespace(session_id="replacement")
        elif mutation == "grant":
            bridge._grants.clear()
        release.set()
        for query in reversed(queries):
            gates[query].set()
            await asyncio.wait_for(completed[query].wait(), 2)
        response = await task
        body = json.loads(response.body)
        assert len(finished) == 3 and not bridge._music_busy
        if mutation is None:
            assert body["ok"]
            assert [row["themeId"] for row in body["data"]["tracks"]] == [
                "cooking",
                "italian",
                "calm",
            ]
            assert len(bridge.music_selection.sources) == 1
        else:
            assert not body["ok"] and not bridge.music_selection.sources
            assert not bridge.music_selection.tasks
        assert router.podview_mood_selector.select.await_count == 1
        assert bridge.controls.music.execute_context.await_count == 0
    finally:
        release.set()
        for gate in gates.values():
            gate.set()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize("failure", ["cancel", "read_error"])
async def test_playlist_batch_joins_child_cleanup_before_busy_fence_release(mood_rig, failure):
    from gatekeeper.podview import _mood_music

    bridge, router = mood_rig.app[BRIDGE], mood_rig.router
    original = router.podview_read
    entered, fail = asyncio.Event(), asyncio.Event()
    queries, cleaned = [], []

    async def blocked(kind, account=None, query=None):
        if kind != "playlist_search":
            return await original(kind, account, query)
        queries.append(query)
        if len(queries) == 3:
            entered.set()
        try:
            await fail.wait()
            if query == "cooking":
                raise ValueError("inert read failure")
            await asyncio.Event().wait()
        finally:
            await asyncio.sleep(0)
            assert bridge._music_busy
            cleaned.append(query)

    router.podview_read = blocked
    request = SimpleNamespace(
        query={"account": "account-alpha"}, cookies={"podview_control": "grant"}
    )
    task = asyncio.create_task(_mood_music(request, bridge, "kitchen"))
    try:
        await asyncio.wait_for(entered.wait(), 2)
        if failure == "cancel":
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            fail.set()
            assert not json.loads((await task).body)["ok"]
        assert set(cleaned) == set(queries) and len(cleaned) == 3
        assert not bridge._music_busy and not bridge.music_selection.sources
        assert not bridge.music_selection.tasks
        assert router.podview_mood_selector.select.await_count == 1
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)
