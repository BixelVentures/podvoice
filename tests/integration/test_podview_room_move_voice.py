"""Voice MOVE shares the paired server option and Live's later-turn approval."""

import copy
import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from integration.test_podview_bridge import owner
from integration.test_podview_room_move_caller import configuration, install_actual_playback
from unit.test_device_control import Rig
from unit.test_podview_speakers import payload

from gatekeeper import podview_room_media, podview_speakers
from gatekeeper.execution_policy import ExecutionContext
from gatekeeper.live_prompt import live_confirmation_instructions, live_instructions
from gatekeeper.podview import PodViewBridge


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change",
    [
        "none",
        "answer",
        "grant",
        "alias",
        "policy",
        "session",
        "unknown",
        "second_profile",
        "profile_revoked",
    ],
)
async def test_voice_move_exact_option_later_confirmation_and_causal_fences(
    monkeypatch, tmp_path, change
):
    rig = Rig()
    session, _ = owner()
    session._history_session = "s1"
    config = configuration()
    if change == "none":
        config["music"].append(
            {
                **config["music"][1],
                "nativeRoomId": "r2",
                "nativeHomepodId": "44",
            }
        )
    profiled = change in {"second_profile", "profile_revoked"}
    bridge = PodViewBridge(
        {"kitchen": session},
        rig.router,
        control_policy=json.dumps(config),
        controller_enabled=profiled,
        controller_generation="c" * 64,
        controller_store=tmp_path / "controllers" / "registry.json" if profiled else None,
    )
    install_actual_playback(rig)
    if profiled:
        registry = bridge._controller_registry
        registry.initialize()
        _, first_identity, _ = registry.enroll(
            "kitchen", bridge.controller_pin("kitchen"), name="Mac", persistent=True
        )
        first_token = bridge.grant_timer_control("kitchen", first_identity)
    else:
        first_token = bridge.grant_timer_control("kitchen")
    source = payload()
    source["targets"][-1]["target_id"] = "speaker"
    if change == "none":
        source["targets"].insert(
            2,
            {
                "kind": "configured_alias",
                "target_id": "r2",
                "name": "Arbejdsværelse",
                "homepod_id": "44",
                "binding": copy.deepcopy(source["targets"][0]["binding"]),
            },
        )
        source["targets"].insert(
            -1,
            {
                "kind": "observed_output",
                "target_id": "44",
                "name": "Actual office",
                "selected": False,
                "needs_auth": False,
                "query_up": True,
                "read_only": True,
            },
        )
    monkeypatch.setattr(podview_speakers, "read_service", AsyncMock(return_value=source))
    answer = {
        "sessionId": "s1",
        "turnId": "original",
        "taskId": "answer-1",
        "inputRevision": 2,
        "revision": 4,
    }
    voice = {"sessionId": "s1", "turnId": "proposal"}
    bridge.snapshot = lambda _room, _token="": {"answers": answer, "voice": voice}

    class Move:
        available = True

        def binding(self):
            return rig.router.podview_music_binding()

        setup = AsyncMock(
            return_value=SimpleNamespace(
                deadline=time.monotonic() + 5,
                wire={"owner_epoch": "owner", "poll_sequence": 1},
            )
        )
        move = AsyncMock(return_value={"outcome": "accepted", "accepted_room_move": True})

    bridge.controls.move = Move()
    rig.router.podview_music_reads = lambda: ["targets", "playback"]
    proof = AsyncMock(return_value=True)
    monkeypatch.setattr(podview_room_media, "confirm_move_destination", proof)

    def owner_binding():
        return rig.router.podview_music_binding()

    passive = await podview_speakers.read_catalogue(bridge, "kitchen", "account", owner_binding)
    paired = await podview_speakers.read_catalogue(
        bridge, "kitchen", "account", owner_binding, token=first_token
    )
    assert not passive["moveAvailable"]
    assert all(not row["selectable"] for row in passive["speakers"])
    assert paired["moveAvailable"] and sum(row["selectable"] for row in paired["speakers"]) == (
        2 if change == "none" else 1
    )
    proposal = ExecutionContext("s1", "live:1:proposal", "live")
    offered = await rig.router.dispatch(
        "podview_music_options",
        {"purpose": "move_existing_session"},
        execution_context=proposal,
    )
    assert offered["ok"], offered
    options = offered["data"]["options"]
    assert len(options) == (2 if change == "none" else 1)
    if change == "none":
        assert len(bridge.controls.tasks) == 2
    destination = podview_speakers.project(
        source, boot=bridge.boot_id, room="kitchen", account="account", default_room="r0"
    )["speakers"][1]
    option_id = "move:" + destination["speakerId"]
    assert option_id in {row["id"] for row in options}
    assert "nativeRoomId" not in str(offered) and "homepodId" not in str(offered)
    args = {
        "purpose": "move_existing_session",
        "taskId": offered["data"]["taskId"],
        "revision": 1,
        "optionId": option_id,
    }
    pending = await rig.router.dispatch(
        "podview_music_select_option", args, execution_context=proposal
    )
    assert pending["needs_confirmation"]
    held = rig.router.execution_policy.peek_live_challenge(
        pending["approval"]["challenge_id"], session_id="s1"
    )
    assert held is not None and destination["name"] in held.confirmation_json
    _, prompt = live_confirmation_instructions(*live_instructions(""), held)
    assert destination["name"] in prompt and '"purpose": "move_existing_session"' in prompt
    assert bridge.controls.move.move.await_count == 0
    if change == "answer":
        answer["revision"] += 1
    elif change == "grant":
        bridge.revoke("kitchen")
    elif change in {"second_profile", "profile_revoked"}:
        _, second_identity, _ = registry.enroll(
            "kitchen", bridge.controller_pin("kitchen"), name="iPad", persistent=True
        )
        second_token = bridge.grant_timer_control("kitchen", second_identity)
        assert bridge._grant_current("kitchen", first_token)
        assert bridge._grant_current("kitchen", second_token)
        if change == "profile_revoked":
            assert bridge.revoke_controller("kitchen", first_identity)
            assert not bridge._grant_current("kitchen", first_token)
            assert bridge._grant_current("kitchen", second_token)
    elif change == "alias":
        monkeypatch.setattr(podview_speakers, "read_service", AsyncMock(return_value=None))
    elif change == "policy":
        bridge.controls.policy = json.loads(json.dumps(bridge.controls.policy))
    elif change == "session":
        session._active = False
    elif change == "unknown":
        bridge.controls.move.move.return_value = {"outcome": "unknown"}
    voice["turnId"] = "confirmation"
    approval = rig.router.execution_policy.confirm_live(
        pending["approval"]["challenge_id"],
        confirmation_context=ExecutionContext("s1", "live:1:confirmation", "live"),
        expected_arguments_sha256=pending["arguments_sha256"],
    )
    assert approval is not None
    result = await rig.router.dispatch(
        approval.action,
        approval.args,
        execution_context=approval.context,
        approval_token=approval.token,
    )
    if change in {"answer", "grant", "alias", "policy", "session", "profile_revoked"}:
        assert result["ok"] is False
        bridge.controls.move.move.assert_not_awaited()
    elif change == "unknown":
        assert result["data"]["outcome"] == "unknown"
        assert ("kitchen", "account") in bridge._music_move_fence
    else:
        assert result["ok"] and result["data"]["outcome"] == "accepted"
        bridge.controls.move.move.assert_awaited_once()
        proof.assert_awaited_once()
        assert (
            await rig.router.dispatch(
                "podview_music_select_option", args, execution_context=proposal
            )
            != result
        )
    await rig.client.aclose()


@pytest.mark.asyncio
async def test_voice_move_rejects_model_destination_and_volume_slots():
    rig = Rig()
    session, _ = owner()
    bridge = PodViewBridge(
        {"kitchen": session}, rig.router, control_policy=json.dumps(configuration())
    )
    bridge.grant_timer_control("kitchen")
    bad = await rig.router.dispatch(
        "podview_music_select_option",
        {
            "purpose": "move_existing_session",
            "taskId": "forged",
            "revision": 1,
            "optionId": "move:" + "a" * 64,
            "confirmedVolumePercent": 90,
        },
        execution_context=ExecutionContext("s1", "live:1", "live"),
    )
    assert bad["ok"] is False
    await rig.client.aclose()


@pytest.mark.asyncio
async def test_live_generic_alias_transfer_cannot_bypass_purpose_bound_move():
    rig = Rig()
    rig.router.declarations = lambda: [{"name": "podconnect_move_playback"}]
    rig.router._dispatch = AsyncMock()
    result = await rig.router.dispatch(
        "podconnect_move_playback",
        {"config_entry_id": "account", "kind": "configured_alias", "target_id": "r1"},
        execution_context=ExecutionContext("s1", "live:1", "live"),
    )
    assert result["error_kind"] == "room_move_requires_exact_owner"
    rig.router._dispatch.assert_not_awaited()
    await rig.client.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("stale_input", [False, True])
async def test_fresh_wake_move_without_prior_answer_uses_exact_later_turn_token(
    monkeypatch, stale_input
):
    rig = Rig()
    session, _ = owner()
    session._history_session = "s1"
    bridge = PodViewBridge(
        {"kitchen": session}, rig.router, control_policy=json.dumps(configuration())
    )
    install_actual_playback(rig)
    bridge.grant_timer_control("kitchen")
    source = payload()
    source["targets"][-1]["target_id"] = "speaker"
    monkeypatch.setattr(podview_speakers, "read_service", AsyncMock(return_value=source))
    voice = {"sessionId": "s1", "turnId": "proposal"}
    bridge.snapshot = lambda _room, _token="": {"answers": {}, "voice": voice}

    class Move:
        available = True

        def binding(self):
            return rig.router.podview_music_binding()

        setup = AsyncMock(return_value=SimpleNamespace(deadline=time.monotonic() + 5))
        move = AsyncMock(return_value={"outcome": "accepted", "accepted_room_move": True})

    bridge.controls.move = Move()
    monkeypatch.setattr(
        podview_room_media, "confirm_move_destination", AsyncMock(return_value=True)
    )
    proposal = ExecutionContext("s1", "live:1:proposal", "live")
    options = await rig.router.dispatch(
        "podview_music_options",
        {"purpose": "move_existing_session"},
        execution_context=proposal,
    )
    assert options["ok"]
    args = {
        "purpose": "move_existing_session",
        "taskId": options["data"]["taskId"],
        "revision": 1,
        "optionId": options["data"]["options"][0]["id"],
    }
    pending = await rig.router.dispatch(
        "podview_music_select_option", args, execution_context=proposal
    )
    assert pending["needs_confirmation"]
    voice["turnId"] = "confirmation"
    approval = rig.router.execution_policy.confirm_live(
        pending["approval"]["challenge_id"],
        confirmation_context=ExecutionContext("s1", "live:1:confirmation", "live"),
        expected_arguments_sha256=pending["arguments_sha256"],
    )
    assert approval is not None
    result = await rig.router.dispatch(
        approval.action,
        approval.args,
        execution_context=approval.context,
        approval_token=approval.token,
        execution_guard=lambda: not stale_input,
    )
    assert result["ok"] is not stale_input
    if stale_input:
        bridge.controls.move.move.assert_not_awaited()
    else:
        bridge.controls.move.move.assert_awaited_once()
    await rig.client.aclose()
