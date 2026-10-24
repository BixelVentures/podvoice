"""Inert ingress proof: a selected source row reaches the one-use owner command."""

import asyncio
from dataclasses import replace
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import httpx
import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_music import Rig

from gatekeeper.execution_policy import ExecutionContext
from gatekeeper.live_prompt import live_confirmation_instructions, live_instructions
from gatekeeper.podview import (
    BRIDGE,
    PodViewBridge,
    _music_binding,
    _music_search_context,
    _selection_source_current,
)
from gatekeeper.podview_continuity import ControllerRegistry


@pytest.fixture
async def rig():
    value = Rig()
    services = value.router._discovery.podconnect_services | {
        "search_tracks",
        "get_playback_controls",
        "get_room_content_controls",
        "prepare_room_selected_content",
        "start_room_selected_content",
        "cancel_room_content_preparation",
    }
    value.router._discovery = replace(value.router._discovery, podconnect_services=services)
    bridge = value.app[BRIDGE]
    bridge._grant_current = lambda room, token: room == "kitchen" and token == "grant"
    bridge._grants["kitchen"] = ("grant",)
    bridge.controls.policy = {
        "roomId": "kitchen",
        "vacuum": [],
        "music": [
            {
                "accountId": "account-alpha",
                "targetId": "device-one",
                "actions": ["play_track"],
                "maxVolume": 40,
                "nativeRoomId": "native-room",
                "nativeHomepodId": "homepod-id",
            }
        ],
    }
    facade = bridge.controls.music
    facade.setup_track = AsyncMock(
        return_value={
            "ok": True,
            "data": {
                "ok": True,
                "schema": "podconnect.room_content_controls.v1",
                "config_entry_id": "account-alpha",
                "owner_epoch": "a" * 32,
                "poll_sequence": 4,
                "next_command_sequence": 1,
                "target": {"kind": "spotify_device", "target_id": "device-one"},
                "room_id": "native-room",
                "homepod_id": "homepod-id",
                "actions": ["play_track"],
                "start_offer": {
                    "schema": "podconnect.room_content_offer.v1",
                    "offer_id": "a" * 32,
                    "binding_id": "b" * 64,
                    "native_incarnation": "c" * 32,
                    "policy_revision": "d" * 64,
                    "start_volume_percent": 35,
                    "expires_after_ms": 5000,
                },
                "status": "ready",
                "valid_until": 9999999999,
                "physical_result_verified": False,
            },
        }
    )
    facade.execute_track = AsyncMock(
        return_value={"outcome": "accepted", "accepted_selected_content": True}
    )
    yield value
    await value.client.aclose()


async def test_paired_search_choice_same_option_and_one_provider_send(rig):
    async with TestClient(TestServer(rig.app)) as client:
        headers = {"Cookie": "podview_control=grant", "X-PodView-Request": "1"}
        search = await client.get(
            "/view/api/music?kind=search&account=account-alpha&query=jazz",
            headers={"Cookie": "podview_control=grant"},
        )
        body = await search.json()
        assert body["ok"] and body["candidateSet"]["revisionScope"] == "music_selection"
        assert not any(call[1].endswith("get_playback_controls") for call in rig.calls)
        assert len(body["candidateSet"]["candidateSetId"]) == 64
        bridge = rig.app[BRIDGE]
        setup = await client.post(
            "/view/api/music/selection/setup",
            headers=headers,
            json={
                "bootId": bridge.boot_id,
                "roomId": "kitchen",
                "candidateSetId": body["candidateSet"]["candidateSetId"],
                "target": {
                    "accountId": "account-alpha",
                    "kind": "spotify_device",
                    "targetId": "device-one",
                },
            },
        )
        offer = await setup.json()
        assert offer["ok"] and len(offer["options"]) == 2
        assert "spotify:track:" not in str(offer)
        action = {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "taskId": offer["taskId"],
            "revision": offer["revision"],
            "optionId": offer["options"][1]["id"],
            "requestId": "one",
            "confirmedVolumePercent": 35,
        }
        first = await (
            await client.post("/view/api/music/selection/actions", headers=headers, json=action)
        ).json()
        second = await (
            await client.post("/view/api/music/selection/actions", headers=headers, json=action)
        ).json()
        assert first == second and first["outcome"] == "accepted"
        assert rig.app[BRIDGE].controls.music.execute_track.await_count == 1
        sent = rig.app[BRIDGE].controls.music.execute_track.await_args.args
        assert sent[1] == "spotify:track:" + "0" * 21 + "1"
        assert sent[2] == 40
        assert offer["startVolumePercent"] == 35
        assert "observedVolumePercent" not in offer


async def test_second_browser_search_keeps_first_browser_candidate_live(rig, tmp_path):
    bridge = rig.app[BRIDGE]
    bridge._controller_enabled = True
    bridge._controller_registry = ControllerRegistry(
        tmp_path / "controllers" / "registry.json", "c" * 64, 30
    )
    bridge._controller_registry.initialize()
    bridge._grant_current = PodViewBridge._grant_current.__get__(bridge)
    bridge._grants.pop("kitchen", None)  # Remove the fixture's abbreviated fake legacy grant.
    pin = bridge.controller_pin("kitchen")
    _, mac_id, _ = bridge._controller_registry.enroll("kitchen", pin, name="Mac", persistent=True)
    _, display_id, _ = bridge._controller_registry.enroll(
        "kitchen", pin, name="Display", persistent=True
    )
    mac_grant = bridge.grant_timer_control("kitchen", mac_id)
    display_grant = bridge.grant_timer_control("kitchen", display_id)
    async with TestClient(TestServer(rig.app)) as client:
        first = await (
            await client.get(
                "/view/api/music?kind=search&account=account-alpha&query=jazz",
                headers={"Cookie": f"podview_control={mac_grant}"},
            )
        ).json()
        second = await (
            await client.get(
                "/view/api/music?kind=search&account=account-alpha&query=jazz",
                headers={"Cookie": f"podview_control={display_grant}"},
            )
        ).json()
        first_id = first["candidateSet"]["candidateSetId"]
        second_id = second["candidateSet"]["candidateSetId"]
        assert first_id != second_id
        assert first_id in bridge.music_selection.sources
        assert second_id in bridge.music_selection.sources
        first_offer = await (
            await client.post(
                "/view/api/music/selection/setup",
                headers={"Cookie": f"podview_control={mac_grant}", "X-PodView-Request": "1"},
                json={
                    "bootId": bridge.boot_id,
                    "roomId": "kitchen",
                    "candidateSetId": first_id,
                    "target": {
                        "accountId": "account-alpha",
                        "kind": "spotify_device",
                        "targetId": "device-one",
                    },
                },
            )
        ).json()
        assert first_offer["ok"]
        assert second_id in bridge.music_selection.sources


async def test_real_prepare_revokes_paired_grant_before_any_selected_commit(rig):
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

        async def owner_service(_client, _token, service, request):
            calls.append((service, request))
            if service == "get_room_content_controls":
                return observed
            if service == "prepare_room_selected_content":
                bridge._grants.clear()
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
            assert service == "cancel_room_content_preparation"
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
        result = await (
            await client.post("/view/api/music/selection/actions", headers=headers, json=action)
        ).json()
        assert not result["ok"]
        assert [service for service, _ in calls] == [
            "get_room_content_controls",
            "prepare_room_selected_content",
            "cancel_room_content_preparation",
        ]


def test_old_search_guard_preserves_newer_touch_context(rig):
    bridge = rig.app[BRIDGE]
    old = _music_search_context(
        bridge, "kitchen", "account-alpha", "first", "grant", mint_touch=True
    )
    assert old["revisionScope"] == "music_selection"
    source = {"context": old, "binding": _music_binding(bridge, "kitchen")}
    newer = _music_search_context(
        bridge, "kitchen", "account-alpha", "second", "grant", mint_touch=True
    )
    saved = dict(bridge._touch_music_contexts)
    assert newer != old
    assert not _selection_source_current(bridge, source, "kitchen", "grant")
    assert bridge._touch_music_contexts == saved
    assert _music_search_context(bridge, "kitchen", "account-alpha", "second", "grant") == newer


async def test_busy_rejected_search_does_not_replace_current_touch_context(rig):
    async with TestClient(TestServer(rig.app)) as client:
        bridge = rig.app[BRIDGE]
        headers = {"Cookie": "podview_control=grant"}
        first = await client.get(
            "/view/api/music?kind=search&account=account-alpha&query=first", headers=headers
        )
        assert (await first.json())["ok"]
        saved = dict(bridge._touch_music_contexts)
        bridge._music_busy = True
        try:
            rejected = await client.get(
                "/view/api/music?kind=search&account=account-alpha&query=second", headers=headers
            )
            assert rejected.status == 429
            assert (await rejected.json())["error"] == "music_busy"
        finally:
            bridge._music_busy = False
        assert bridge._touch_music_contexts == saved
        assert (
            _music_search_context(bridge, "kitchen", "account-alpha", "first", "grant")[
                "revisionScope"
            ]
            == "music_selection"
        )


async def test_raw_uri_and_unconfirmed_volume_never_reach_provider(rig):
    async with TestClient(TestServer(rig.app)) as client:
        headers = {"Cookie": "podview_control=grant", "X-PodView-Request": "1"}
        bridge = rig.app[BRIDGE]
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
        action = {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "taskId": offer["taskId"],
            "revision": offer["revision"],
            "optionId": offer["options"][0]["id"],
            "requestId": "one",
            "confirmedVolumePercent": 90,
        }
        denied = await (
            await client.post("/view/api/music/selection/actions", headers=headers, json=action)
        ).json()
        assert denied["outcome"] == "rejected"
        action["confirmedVolumePercent"] = 35
        action["track_uri"] = "spotify:track:" + "B" * 22
        invalid = await (
            await client.post("/view/api/music/selection/actions", headers=headers, json=action)
        ).json()
        assert invalid["error"] == "invalid_music_selection"
        assert rig.app[BRIDGE].controls.music.execute_track.await_count == 0


@pytest.mark.parametrize(
    "change", ["actions", "nativeRoomId", "nativeHomepodId", "targetId", "maxVolume"]
)
async def test_revoked_exact_rule_during_fresh_read_never_sends(rig, change):
    async with TestClient(TestServer(rig.app)) as client:
        headers = {"Cookie": "podview_control=grant", "X-PodView-Request": "1"}
        bridge = rig.app[BRIDGE]
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
        controls = bridge.controls.music.setup_track.return_value
        entered, release = asyncio.Event(), asyncio.Event()

        async def held_read(_account, _target, _room, _homepod, _current):
            entered.set()
            await release.wait()
            return controls

        bridge.controls.music.setup_track.side_effect = held_read
        pending = asyncio.create_task(
            client.post(
                "/view/api/music/selection/actions",
                headers=headers,
                json={
                    "bootId": bridge.boot_id,
                    "roomId": "kitchen",
                    "taskId": offer["taskId"],
                    "revision": offer["revision"],
                    "optionId": offer["options"][0]["id"],
                    "requestId": "held",
                    "confirmedVolumePercent": 35,
                },
            )
        )
        await asyncio.wait_for(entered.wait(), timeout=2)
        bridge.controls.policy["music"][0][change] = (
            ["pause"] if change == "actions" else 39 if change == "maxVolume" else "replacement"
        )
        release.set()
        denied = await (await pending).json()
        assert denied["outcome"] == "rejected"
        assert bridge.controls.music.execute_track.await_count == 0


async def test_non_integer_numeric_payload_is_rejected_without_server_error(rig):
    async with TestClient(TestServer(rig.app)) as client:
        headers = {"Cookie": "podview_control=grant", "X-PodView-Request": "1"}
        bridge = rig.app[BRIDGE]
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
        action = {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "taskId": offer["taskId"],
            "revision": offer["revision"],
            "optionId": offer["options"][0]["id"],
            "requestId": "bad-number",
            "confirmedVolumePercent": 35,
        }
        for key, bad in (("revision", float("nan")), ("confirmedVolumePercent", float("inf"))):
            response = await client.post(
                "/view/api/music/selection/actions",
                headers=headers,
                json={**action, key: bad},
            )
            assert response.status == 200
            assert (await response.json())["outcome"] == "rejected"
        assert bridge.controls.music.execute_track.await_count == 0


async def test_voice_reads_same_option_and_needs_later_turn_approval(rig):
    async with TestClient(TestServer(rig.app)) as client:
        headers = {"Cookie": "podview_control=grant", "X-PodView-Request": "1"}
        bridge = rig.app[BRIDGE]
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
        router = rig.router
        proposal = ExecutionContext("s1", "live:1:proposal", "live")
        available = await router.dispatch("podview_music_options", {}, execution_context=proposal)
        assert available["ok"]
        assert available["data"]["options"] == offer["options"]
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
        assert bridge.controls.music.execute_track.await_count == 0
        held = router.execution_policy.peek_live_challenge(
            pending["approval"]["challenge_id"], session_id="s1"
        )
        assert held is not None
        _, confirmation_prompt = live_confirmation_instructions(*live_instructions(""), held)
        assert '"song": "Song 1"' in confirmation_prompt
        assert '"output": "device-one"' in confirmation_prompt
        assert '"account_id": "account-alpha"' in confirmation_prompt
        assert '"volume_percent": 35' in confirmation_prompt
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
        assert bridge.controls.music.execute_track.await_count == 1
        assert bridge.controls.music.execute_track.await_args.args[1] == (
            "spotify:track:" + "0" * 21 + "1"
        )


async def test_voice_answer_task_survives_only_original_receipt_on_later_turn(rig):
    bridge = rig.app[BRIDGE]
    context = {
        "schema": "podview.music-search-context.v1",
        "bootId": bridge.boot_id,
        "roomId": "kitchen",
        "revision": 4,
        "revisionScope": "answer_task",
        "sessionId": "s1",
        "turnId": "s1:1",
        "taskId": "answer-1",
        "inputRevision": 2,
        "configEntryId": "account-alpha",
        "source": "spotify_web_api",
        "query": "jazz",
    }
    binding = _music_binding(bridge, "kitchen")
    identifier = bridge.music_selection.register(
        context,
        {"tracks": [{"uri": "spotify:track:" + "0" * 22, "name": "Song 0", "artist": "Artist"}]},
        binding,
    )
    assert identifier is not None
    grant = bridge._grants["kitchen"]
    offer = bridge.music_selection.offer(
        identifier=identifier,
        context=context,
        owner_binding=binding,
        account="account-alpha",
        target="device-one",
        native_binding=("native-room", "homepod-id"),
        observed_controls=bridge.controls.music.setup_track.return_value["data"],
        approved_max_volume=40,
        authority=(rig.session, None, "answer-1", grant),
        current=lambda: True,
    )
    assert offer is not None
    answer = {
        "sessionId": "s1",
        "turnId": "s1:1",
        "taskId": "answer-1",
        "inputRevision": 2,
        "revision": 4,
    }
    bridge.snapshot = lambda _room, _token="": {
        "voice": {"sessionId": "s1", "turnId": "s1:2"},
        "answers": answer,
    }
    later_turn = ExecutionContext("s1", "live:2:proposal", "live")
    options = await rig.router.dispatch("podview_music_options", {}, execution_context=later_turn)
    assert options["ok"] and options["data"]["options"] == offer["options"]
    answer["revision"] = 5
    expired = await rig.router.dispatch("podview_music_options", {}, execution_context=later_turn)
    assert not expired["ok"]
    assert bridge.controls.music.execute_track.await_count == 0


@pytest.mark.parametrize("case", ["exact", "generic", "extra", "unknown", "malformed", "stale"])
async def test_real_controls_get_facade_and_route_preserve_only_current_account_claim(rig, case):
    bridge, facade = rig.app[BRIDGE], rig.app[BRIDGE].controls.music
    refusal = {
        "ok": False,
        "error_kind": "native_account_claim_required",
        "retry_allowed": False,
        "physical_result_verified": False,
    }
    if case == "generic":
        refusal["error_kind"] = "native_start_unavailable"
    if case == "extra":
        refusal["private"] = "SECRET"
    if case == "unknown":
        refusal["error_kind"] = "outcome_unknown"
    if case == "malformed":
        refusal["ok"] = 0
    original = rig.request
    seen = []

    async def request(req):
        if req.url.path.endswith("/get_room_content_controls"):
            assert req.method == "POST" and dict(req.url.params) == {"return_response": ""}
            seen.append(req.url.path)
            if case == "stale":
                bridge._grants.clear()
            return httpx.Response(200, json={"service_response": refusal})
        return await original(req)

    del facade.setup_track
    async with httpx.AsyncClient(transport=httpx.MockTransport(request)) as backend:
        rig.router._client = backend
        async with TestClient(TestServer(rig.app)) as client:
            headers = {"Cookie": "podview_control=grant", "X-PodView-Request": "1"}
            source = await (
                await client.get(
                    "/view/api/music?kind=search&account=account-alpha&query=jazz", headers=headers
                )
            ).json()
            response = await client.post(
                "/view/api/music/selection/setup",
                headers=headers,
                json={
                    "bootId": bridge.boot_id,
                    "roomId": "kitchen",
                    "candidateSetId": source["candidateSet"]["candidateSetId"],
                    "target": {
                        "accountId": "account-alpha",
                        "kind": "spotify_device",
                        "targetId": "device-one",
                    },
                },
            )
            result = await response.json()
    assert len(seen) == 1
    assert result["ok"] is False and result["retryAllowed"] is False
    assert result["error"] == (
        "native_account_claim_required" if case == "exact" else "music_selection_unavailable"
    )
    assert "SECRET" not in str(result)
    assert not facade.execute_track.await_count


@pytest.mark.parametrize(
    "change",
    [
        "display_expiry",
        "policy",
        "owner",
        "provider_binding",
        "source",
        "grant_expired",
        "provider_expired",
    ],
)
async def test_admitted_selection_retains_only_presentation_freshness_exemption(rig, change):
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

        async def owner_service(_client, _token, service, request):
            calls.append((service, request))
            if service == "get_room_content_controls":
                return observed
            if service == "prepare_room_selected_content":
                if change == "display_expiry":
                    task = bridge.music_selection.tasks[offer["taskId"]]
                    task["deadline"] = 0
                    source = bridge.music_selection.sources[task["candidateSetId"]]
                    source["deadline"] = 0
                    for key, (_, context) in list(bridge._touch_music_contexts.items()):
                        bridge._touch_music_contexts[key] = (0, context)
                elif change == "grant_expired":
                    bridge._grant_current = lambda *_: False
                elif change == "provider_binding":
                    rig.router.podview_music_binding = lambda: ("replacement",)
                elif change == "source":
                    task = bridge.music_selection.tasks[offer["taskId"]]
                    source = bridge.music_selection.sources[task["candidateSetId"]]
                    bridge.music_selection.sources[task["candidateSetId"]] = dict(source)
                elif change == "policy":
                    bridge.controls.policy["music"] = []
                elif change == "owner":
                    bridge.sessions["kitchen"] = object()
                return {
                    "ok": change != "provider_expired",
                    "schema": "podconnect.room_content_preparation.v1",
                    "config_entry_id": request["config_entry_id"],
                    "owner_epoch": request["owner_epoch"],
                    "request_id": request["request_id"],
                    "command_sequence": request["command_sequence"],
                    "action": request["action"],
                    "target": {"kind": "spotify_device", "target_id": request["target_id"]},
                    "room_id": request["room_id"],
                    "homepod_id": request["homepod_id"],
                    "state": "expired" if change == "provider_expired" else "staged",
                    "retry_allowed": False,
                    "physical_result_verified": False,
                }
            if service == "start_room_selected_content":
                assert change == "display_expiry"
                return {
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
                    "ok": True,
                    "retry_allowed": False,
                    "physical_result_verified": False,
                    "outcome": "accepted",
                    "provider_request_accepted": False,
                    "accepted_selected_content": True,
                    "start_operation_id": "d" * 32,
                    "start_volume_percent": 35,
                    "room_id": request["room_id"],
                    "homepod_id": request["homepod_id"],
                }
            assert service == "cancel_room_content_preparation"
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
        result = await (
            await client.post("/view/api/music/selection/actions", headers=headers, json=action)
        ).json()
        assert result["ok"] is (change == "display_expiry"), result
        assert result["retryAllowed"] is False
        assert result["physicalResultVerified"] is False
        expected = ["get_room_content_controls", "prepare_room_selected_content"]
        if change == "display_expiry":
            expected.append("start_room_selected_content")
            # Same consumed request remains readable after presentation expiry;
            # neither it nor a distinct request may dispatch again.
            cached = await (
                await client.post("/view/api/music/selection/actions", headers=headers, json=action)
            ).json()
            assert cached == result
            distinct = await (
                await client.post(
                    "/view/api/music/selection/actions",
                    headers=headers,
                    json={**action, "requestId": "distinct-after-consumption"},
                )
            ).json()
            assert not distinct["ok"]
        elif change != "provider_expired":
            expected.append("cancel_room_content_preparation")
        assert [service for service, _ in calls] == expected
