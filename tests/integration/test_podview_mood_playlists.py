"""Actual root HTTP → owner reads → one aggregate set → native context facade, inert I/O."""

import asyncio
import copy
import json
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_account_playlists import payload as account_playlists_payload
from integration.test_podview_music_selection import rig  # noqa: F401
from multidict import CIMultiDict

from gatekeeper import podview
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
    controls["data"].update(actions=["play_context"])
    bridge.controls.music.setup_context = AsyncMock(return_value=controls)
    bridge.controls.music.execute_context = AsyncMock(
        return_value={"outcome": "accepted", "accepted_selected_content": True}
    )
    rig.playlist_epoch = "a" * 32
    rig.playlist_account = "account-alpha"
    rig.playlist_same = False
    rig.playlist_artwork = False
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
            "indie": "k",
            # The same admitted bounded search port supports explicit-refresh broadening.
            "dinner": "f",
            "italian": "g",
            "acoustic": "h",
            "jazz": "i",
            "alternative": "j",
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
                    "owner_epoch": (
                        "a" * 32
                        if rig.playlist_epoch == "other" and suffix != "a"
                        else rig.playlist_epoch
                    ),
                    "source": "spotify_web_api",
                    "query": data["query"],
                    "limit": 3,
                    "returned_count": 1,
                    "playlists": [
                        {
                            **{
                                "uri": "spotify:playlist:" + suffix * 22,
                                "name": f"Real {suffix}",
                            },
                            **(
                                {
                                    "artwork": {
                                        "kind": "playlist_cover",
                                        "provider": "spotify",
                                        "url": "https://i.scdn.co/image/cover",
                                    }
                                }
                                if rig.playlist_artwork
                                else {}
                            ),
                        }
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


@pytest.mark.parametrize("order", ["targets-first", "mood-first", "owner-change"])
async def test_same_actor_scoped_targets_and_library_during_actual_mood(
    mood_rig, monkeypatch, order
):
    router, bridge = mood_rig.router, mood_rig.app[BRIDGE]
    bridge._grant_current = podview.PodViewBridge._grant_current.__get__(bridge)
    bridge._grants.clear()
    router._discovery = replace(
        router._discovery,
        podconnect_services=router._discovery.podconnect_services
        | {"get_targets", "get_user_playlists"},
        target_contracts=(("podconnect_get_targets", "a" * 64),),
    )
    upstream = mood_rig.client._transport
    services = ("search_playlists", "get_targets", "get_user_playlists")
    entered = {name: asyncio.Event() for name in services}
    release = {name: asyncio.Event() for name in services}
    count = dict.fromkeys(services, 0)
    arrived = {name: asyncio.Event() for name in ("library", "join")}
    original_guard = podview._guard

    async def guard(request):
        if (probe := request.headers.get("X-Read-Probe")) in arrived:
            arrived[probe].set()
        return await original_guard(request)

    async def owner_read(request):
        service = request.url.path.rsplit("/", 1)[-1]
        if service not in entered:
            return await upstream.handle_async_request(request)
        args = json.loads(request.content)
        assert args["config_entry_id"] == "account-alpha"
        assert request.headers["Authorization"] == "Bearer server-only"
        count[service] += 1
        entered[service].set()
        await release[service].wait()
        if service == "search_playlists":
            return await upstream.handle_async_request(request)
        if service == "get_user_playlists":
            assert args["limit"] == 20
            value = account_playlists_payload()
        else:
            assert args == {"config_entry_id": "account-alpha"}
            value = {
                "config_entry_id": "account-alpha",
                "errors": {},
                "targets": [
                    {
                        "kind": "spotify_device",
                        "target_id": target,
                        "name": name,
                        "restricted": False,
                    }
                    for target, name in (("device-one", "Kitchen"), ("foreign", "Other room"))
                ],
            }
        return httpx.Response(200, json={"service_response": value})

    @web.middleware
    async def supervisor_ingress(request, handler):
        return await handler(request.clone(remote="172.30.32.2"))

    mood_rig.app.middlewares.insert(0, supervisor_ingress)
    monkeypatch.setattr(podview, "_guard", guard)
    monkeypatch.setattr(mood_rig.client, "_transport", httpx.MockTransport(owner_read))
    async with TestClient(TestServer(mood_rig.app)) as client:
        tasks = []

        def begin(kind, *, probe="", account="account-alpha", user="a" * 32):
            headers = {"X-Remote-User-Id": user, "X-Read-Probe": probe}
            if kind != "targets":
                headers["X-PodView-Music-Document"] = "a" * 32
            task = asyncio.create_task(
                client.get(
                    f"/view/api/music?room=kitchen&kind={kind}&account={account}", headers=headers
                )
            )
            tasks.append(task)
            return task

        async def await_event(event):
            await asyncio.wait_for(event.wait(), timeout=2)

        try:
            mood_read = begin("mood")
            await await_event(entered["search_playlists"])
            denied = await begin("targets", user="b" * 32)
            assert denied.status == 429 and (await denied.json())["error"] == "music_busy"
            targets = begin("targets")
            try:
                await await_event(entered["get_targets"])
            except TimeoutError:
                if targets.done():
                    denied = await targets
                    pytest.fail(
                        f"scoped targets denied with HTTP {denied.status}: {await denied.json()}"
                    )
                raise
            library = begin("account_playlists", probe="library")
            await await_event(arrived["library"])
            assert bridge._music_busy and not mood_read.done() and not library.done()
            assert count["get_user_playlists"] == 0

            if order == "mood-first":
                release["search_playlists"].set()
                assert (await (await mood_read).json())["ok"] is True
                await await_event(entered["get_user_playlists"])
                assert bridge._mood_inflight is None and bridge._music_busy
            join = begin("targets", probe="join")
            await await_event(arrived["join"])
            wrong_account = await begin("targets", account="other")
            assert (
                wrong_account.status == 429
                and (await wrong_account.json())["error"] == "music_busy"
            )
            assert count["get_targets"] == 1 and not join.done()
            duplicate = await begin("targets", account="account-alpha&account=other")
            assert duplicate.status == 429 and (await duplicate.json())["error"] == "music_busy"
            if order == "owner-change":
                mood_rig.session._epoch = getattr(mood_rig.session, "_epoch", 0) + 1
            release["get_targets"].set()
            first, second = await asyncio.gather(targets, join)
            assert bridge._music_busy, (
                "targets must leave whichever primary read owns the lane alone"
            )

            if order == "owner-change":
                assert first.status == second.status == 503
                assert (
                    (await first.json())["error"]
                    == (await second.json())["error"]
                    == "music_unavailable"
                )
                assert not any(key[1] == "targets" for key in bridge._music_cache)
            else:
                assert first.status == second.status == 200
                one, two = await first.json(), await second.json()
                assert one == two and one["ok"] is True
                assert [row["targetId"] for row in one["data"]["targets"]] == ["device-one"]
                assert one["roomBinding"]["targetId"] == "device-one"
            release["search_playlists"].set()
            release["get_user_playlists"].set()
            library_result = await library
            if order == "owner-change":
                assert library_result.status == 409
                assert count["get_user_playlists"] == 0
            else:
                assert library_result.status == 200 and (await library_result.json())["ok"] is True
                assert count["get_user_playlists"] == 1
                assert (await (await mood_read).json())["ok"] is True
            assert count["get_targets"] == 1
            assert bridge._targets_inflight is None and not bridge._music_busy
            assert not bridge.music_selection.tasks
            bridge.controls.music.setup_context.assert_not_awaited()
            bridge.controls.music.execute_context.assert_not_awaited()
        finally:
            for gate in release.values():
                gate.set()
            await asyncio.gather(*tasks, return_exceptions=True)


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
        assert len([call for call in mood_rig.calls if "search_playlists" in call[1]]) == 9
        assert mood_rig.router.podview_mood_selector.select.await_args.args == (
            {"hour": 18, "roomKind": "kitchen"},
        )
        refreshed = await mood(client, True)
        assert refreshed["ok"] and len(bridge.music_selection.sources) == 1
        assert mood_rig.router.podview_mood_selector.select.await_count == 2
        assert not {row["uri"] for row in first["data"]["tracks"]} & {
            row["uri"] for row in refreshed["data"]["tracks"]
        }
        assert len([call for call in mood_rig.calls if "search_playlists" in call[1]]) == 18


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
            "confirmedVolumePercent": 35,
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
        body = await mood(client)
        assert body["ok"] and body["schema"] == "podview.mood-preview.v1"
        assert "candidateSet" not in body
        assert not bridge.music_selection.sources and not bridge.music_selection.tasks
        assert bridge.controls.music.execute_context.await_count == 0


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
            "confirmedVolumePercent": offer["startVolumePercent"],
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
        assert len([call for call in mood_rig.calls if "search_playlists" in call[1]]) == 9


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
                elif mutation == "epoch" and query == "cooking":
                    result["data"]["owner_epoch"] = "other"
                elif mutation == "account":
                    result["data"]["config_entry_id"] = "other"
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
            "evening jazz",
            "cooking",
            "italian dinner",
            "indie",
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


async def test_mood_fallback_uses_fresh_time_to_choose_spotify_playlists(mood_rig):
    router = mood_rig.router
    router.podview_mood_selector.select.return_value = None
    selected = []
    async with TestClient(TestServer(mood_rig.app)) as client:
        for hour, theme in [(7, "morning_acoustic"), (14, "indie"), (20, "evening_jazz")]:
            router.podview_mood_context.return_value = {"hour": hour, "roomKind": "kitchen"}
            result = await mood(client, bool(selected))
            assert result["ok"], result
            tracks = result["data"]["tracks"]
            assert len(tracks) == 3
            assert tracks[0]["themeId"] == theme
            selected.append({track["uri"] for track in tracks})
        assert all(len(uris) == 3 for uris in selected)
        assert len({frozenset(uris) for uris in selected}) == 3, (
            "time changes the actual playlist selection, not only its order"
        )


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
        if query not in gates:
            await asyncio.Event().wait()
        queries.append(query)
        if len(queries) == 3:
            entered.set()
        try:
            await release.wait()
            await gates[query].wait()
            result = await original(kind, account, query)
            if mutation == "account":
                result["data"]["config_entry_id"] = "other"
            elif mutation == "epoch" and query == "cooking":
                result["data"]["owner_epoch"] = "other"
            return result
        finally:
            finished.append(query)
            completed[query].set()

    router.podview_read = blocked
    request = SimpleNamespace(
        app=mood_rig.app,
        query={"account": "account-alpha"},
        cookies={"podview_control": "grant"},
        headers=CIMultiDict(),
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
        if query not in {"cooking", "italian dinner", "calm acoustic"}:
            await asyncio.Event().wait()
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
        app=mood_rig.app,
        query={"account": "account-alpha"},
        cookies={"podview_control": "grant"},
        headers=CIMultiDict(),
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


async def test_mood_total_deadline_joins_reads_and_preserves_retained_content(
    mood_rig, monkeypatch
):
    """Drive deadline expiry at a barrier; no elapsed-time performance assertion."""
    from gatekeeper import podview

    bridge, router = mood_rig.app[BRIDGE], mood_rig.router
    request = SimpleNamespace(
        app=mood_rig.app,
        query={"account": "account-alpha"},
        cookies={"podview_control": "grant"},
        headers=CIMultiDict(),
    )
    assert json.loads((await podview._mood_music(request, bridge, "kitchen")).body)["ok"]
    retained = bridge._mood_retained
    retained_rows = copy.deepcopy(retained["rows"])
    request.query["refresh"] = "1"
    original_read, real_timeout = router.podview_read, asyncio.timeout
    deadlines, entered, cleaned, queries = [], asyncio.Event(), [], []

    def capture_timeout(delay):
        manager = real_timeout(delay)
        if 0 < delay <= 10:
            deadlines.append(manager)
        return manager

    async def blocked(kind, account=None, query=None):
        if kind != "playlist_search":
            return await original_read(kind, account, query)
        if query not in {"cooking", "italian dinner", "calm acoustic"}:
            await asyncio.Event().wait()
        queries.append(query)
        if len(queries) == 3:
            entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            await asyncio.sleep(0)
            assert bridge._music_busy
            cleaned.append(query)

    monkeypatch.setattr(podview.asyncio, "timeout", capture_timeout)
    router.podview_read = blocked
    task = asyncio.create_task(podview._mood_music(request, bridge, "kitchen"))
    try:
        await asyncio.wait_for(entered.wait(), 2)  # Deadlock guard only.
        assert len(deadlines) == 1 and len(queries) == 3
        deadlines[0].reschedule(asyncio.get_running_loop().time())
        result = json.loads((await task).body)
        assert result == {
            "ok": False,
            "error": "mood_unavailable",
            "retryAllowed": False,
        }
        assert sorted(cleaned) == sorted(queries) and len(cleaned) == 3
        assert not bridge._music_busy and not bridge.music_selection.sources
        assert not bridge.music_selection.tasks and bridge._mood_retained is retained
        assert retained["rows"] == retained_rows
        assert router.podview_mood_selector.select.await_count == 2
        assert bridge.controls.music.execute_context.await_count == 0
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def test_mood_speculative_reads_overlap_model_and_publish_only_selected(mood_rig):
    from gatekeeper.podview import _mood_music

    bridge, router = mood_rig.app[BRIDGE], mood_rig.router
    original = router.podview_read
    model_started, all_reads, release = asyncio.Event(), asyncio.Event(), asyncio.Event()
    queries = []

    async def model(*args, **kwargs):
        model_started.set()
        await release.wait()
        return ["cooking", "italian", "calm"]

    async def read(kind, account=None, query=None):
        if kind == "playlist_search":
            queries.append(query)
            if len(queries) == 6:
                all_reads.set()
            await release.wait()
        return await original(kind, account, query)

    router.podview_mood_selector.select.side_effect = model
    router.podview_read = read
    request = SimpleNamespace(
        app=mood_rig.app,
        query={"account": "account-alpha"},
        cookies={"podview_control": "grant"},
        headers=CIMultiDict(),
    )
    task = asyncio.create_task(_mood_music(request, bridge, "kitchen"))
    try:
        await asyncio.wait_for(asyncio.gather(model_started.wait(), all_reads.wait()), 2)
        assert len(queries) == 6 and not task.done()
        release.set()
        response = await task
        body = json.loads(response.body)
        assert body["ok"]
        assert [r["themeId"] for r in body["data"]["tracks"]] == ["cooking", "italian", "calm"]
        assert router.podview_mood_selector.select.await_count == 1
        assert len(queries) == 6
    finally:
        release.set()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize("cancel", [False, True])
async def test_mood_speculation_fences_owner_and_joins_cancelled_reads(mood_rig, cancel):
    from gatekeeper.podview import _mood_music

    bridge, router = mood_rig.app[BRIDGE], mood_rig.router
    started, release = asyncio.Event(), asyncio.Event()
    active = set()

    async def model(*args, **kwargs):
        await release.wait()
        return ["cooking", "italian", "calm"]

    async def read(kind, account=None, query=None):
        if kind != "playlist_search":
            raise AssertionError(kind)
        active.add(query)
        if len(active) == 6:
            started.set()
        try:
            await release.wait()
            return {"ok": True, "data": {}}
        finally:
            active.remove(query)

    router.podview_mood_selector.select.side_effect = model
    router.podview_read = read
    request = SimpleNamespace(
        app=mood_rig.app,
        query={"account": "account-alpha"},
        cookies={"podview_control": "grant"},
        headers=CIMultiDict(),
    )
    task = asyncio.create_task(_mood_music(request, bridge, "kitchen"))
    await asyncio.wait_for(started.wait(), 2)
    if cancel:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    else:
        bridge._advance_music_source("grant")
        release.set()
        response = await task
        assert not json.loads(response.body)["ok"]
    assert not active
    assert not bridge._music_busy
    assert not bridge.music_selection.sources


@pytest.mark.parametrize("failure", ["selected", "unselected_slow"])
async def test_mood_speculative_selected_failure_and_unselected_cancellation(mood_rig, failure):
    from gatekeeper.podview import _mood_music

    bridge, router = mood_rig.app[BRIDGE], mood_rig.router
    original = router.podview_read
    cancelled = asyncio.Event()
    queries = []

    async def model(*args, **kwargs):
        await asyncio.sleep(0)
        return ["cooking", "italian", "calm"]

    async def read(kind, account=None, query=None):
        if kind != "playlist_search":
            return await original(kind, account, query)
        queries.append(query)
        if failure == "selected" and query == "cooking":
            raise RuntimeError("failed selected search")
        if failure == "unselected_slow" and query == "indie":
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        return await original(kind, account, query)

    router.podview_mood_selector.select.side_effect = model
    router.podview_read = read
    request = SimpleNamespace(
        app=mood_rig.app,
        query={"account": "account-alpha"},
        cookies={"podview_control": "grant"},
        headers=CIMultiDict(),
    )
    response = await asyncio.wait_for(_mood_music(request, bridge, "kitchen"), 2)
    body = json.loads(response.body)
    assert len(queries) == 6
    if failure == "selected":
        assert not body["ok"] and not bridge.music_selection.sources
    else:
        assert body["ok"] and cancelled.is_set()


async def test_mood_speculation_broadens_only_if_needed_with_nine_read_limit(mood_rig):
    from gatekeeper.podview import _mood_music

    bridge = mood_rig.app[BRIDGE]
    mood_rig.playlist_same = True
    request = SimpleNamespace(
        app=mood_rig.app,
        query={"account": "account-alpha"},
        cookies={"podview_control": "grant"},
        headers=CIMultiDict(),
    )
    body = json.loads((await _mood_music(request, bridge, "kitchen")).body)
    assert not body["ok"] and body["error"] == "mood_catalogue_empty"
    calls = [call for call in mood_rig.calls if "search_playlists" in call[1]]
    assert len(calls) == 9
    assert [call[2]["query"] for call in calls[6:]] == ["dinner", "italian", "acoustic"]
    assert mood_rig.router.podview_mood_selector.select.await_count == 1
    assert not bridge.music_selection.sources
