"""HA-originated card data continued under real voice approval, inert native I/O."""

import asyncio
from dataclasses import replace

import httpx
import pytest
from integration.test_podview_ha_ingress60 import HEADERS, ingress, post  # noqa: F401
from integration.test_podview_music import Rig as MusicReadRig
from integration.test_podview_music_control import content_owner
from integration.test_thin_live import build as build_live

from gatekeeper import podview
from gatekeeper.execution_policy import ExecutionContext


@pytest.fixture
async def card(ingress):  # noqa: F811
    r = ingress
    session, _sdk, _flag, _tools, _link = build_live()
    session.tools = r.music.tools
    r.bridge.sessions["kitchen"] = r.session = session
    assert not session._active
    content_owner(r.music)
    r.music.tools._discovery = replace(
        r.music.tools._discovery,
        podconnect_services=r.music.tools._discovery.podconnect_services | {"search_tracks"},
    )
    reader = MusicReadRig()
    original = r.music.client

    async def transport(request):
        if request.url.path.endswith("/search_tracks"):
            return await reader.request(request)
        return await r.music.handle(request)

    r.music.client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    r.music.tools._client = r.music.client
    try:
        response = await r.client.get(
            "/view/api/music?kind=search&account=account&query=jazz", headers=HEADERS
        )
        search = await response.json()
        assert search["ok"]
        r.offer = await post(
            r,
            "/view/api/music/selection/setup",
            {
                "bootId": r.bridge.boot_id,
                "roomId": "kitchen",
                "candidateSetId": search["candidateSet"]["candidateSetId"],
                "target": {"accountId": "account", "kind": "spotify_device", "targetId": "device"},
            },
        )
        assert r.offer["ok"], r.offer
        assert not r.bridge._grants and podview._HA_REQUEST.get() is None
        assert not list(r.bridge._room_grants("kitchen"))
        origin = (session._history_session, session._epoch)
        await session.start()
        await session.wake()
        assert session._active and session.live_alpha
        assert (session._history_session, session._epoch) != origin
        r.current = [True]
        r.proposal = ExecutionContext(session._history_session, "live:1:proposal", "live")
        r.args = {
            "taskId": r.offer["taskId"],
            "revision": r.offer["revision"],
            "optionId": r.offer["options"][1]["id"],
            "confirmedVolumePercent": 35,
        }
        yield r
    finally:
        await session.aclose()
        await original.aclose()
        await reader.client.aclose()


def starts(r):
    return [c for c in r.music.calls if c[1].endswith("start_room_selected_content")]


async def approve(r):
    router = r.music.tools
    options = await router.dispatch(
        "podview_music_options",
        {},
        execution_context=r.proposal,
        execution_guard=lambda: r.current[0],
    )
    assert options["ok"], options
    assert options["data"]["options"] == r.offer["options"]
    pending = await router.dispatch(
        "podview_music_select_option",
        r.args,
        execution_context=r.proposal,
        execution_guard=lambda: r.current[0],
    )
    assert pending["needs_confirmation"] and not starts(r)
    approved = router.execution_policy.confirm_live(
        pending["approval"]["challenge_id"],
        confirmation_context=ExecutionContext(r.proposal.session_id, "live:1:confirmation", "live"),
        expected_arguments_sha256=pending["arguments_sha256"],
    )
    assert approved is not None
    return approved


async def execute(r, approved, **overrides):
    return await r.music.tools.dispatch(
        approved.action,
        overrides.pop("args", approved.args),
        execution_context=overrides.pop("context", approved.context),
        approval_token=overrides.pop("token", approved.token),
        execution_guard=lambda: r.current[0],
        **overrides,
    )


async def test_ha_card_uses_same_options_and_native_start_after_voice_approval(card):
    r = card
    assert r.bridge.voice_music_available()
    approved = await approve(r)
    result = await execute(r, approved)
    assert result["ok"] and result["data"]["outcome"] == "accepted", result
    assert result["data"]["physicalResultVerified"] is False
    assert len(starts(r)) == 1
    sent = starts(r)[0][3]
    assert (sent["room_id"], sent["homepod_id"], sent["target_id"]) == (
        "native-room",
        "42",
        "device",
    )
    assert sent["args"] == {"track_uri": "spotify:track:" + "0" * 21 + "1", "max_volume": 40}
    assert not (await execute(r, approved))["ok"] and len(starts(r)) == 1
    assert not r.bridge._grants and podview._HA_REQUEST.get() is None


async def test_idle_touch_card_remains_usable_after_actual_fresh_voice_wake(card):
    r = card
    command = {
        "bootId": r.bridge.boot_id,
        "roomId": "kitchen",
        **r.args,
        "requestId": "touch-after-wake",
    }
    result = await post(r, "/view/api/music/selection/actions", command)
    assert result["ok"] and result["outcome"] == "accepted", result
    assert len(starts(r)) == 1


async def test_origin_actor_record_does_not_authorize_voice(card):
    r = card
    r.bridge._ha_actors.clear()
    approved = await approve(r)
    result = await execute(r, approved)
    assert result["ok"] and len(starts(r)) == 1


@pytest.mark.parametrize(
    "change", ["session", "room", "turn_mode", "option", "revision", "volume", "token"]
)
async def test_voice_context_arguments_and_approval_remain_exact(card, change):
    r = card
    approved = await approve(r)
    args, context, token = dict(approved.args), approved.context, approved.token
    if change == "session":
        context = ExecutionContext("another-session", approved.context.turn_id, "live")
    elif change == "room":
        r.bridge.sessions = {"another-room": r.session}
    elif change == "turn_mode":
        context = ExecutionContext(r.proposal.session_id, approved.context.turn_id, "turn")
    elif change == "option":
        args["optionId"] = r.offer["options"][0]["id"]
    elif change == "revision":
        args["revision"] += 1
    elif change == "volume":
        args["confirmedVolumePercent"] = 36
    else:
        token = "not-an-approval"
    result = await execute(r, approved, args=args, context=context, token=token)
    assert not result["ok"] and not starts(r)


@pytest.mark.parametrize(
    "change",
    [
        "current",
        "owner",
        "epoch",
        "history",
        "task",
        "source",
        "policy",
        "native",
        "privacy",
        "closing",
        "expiry",
    ],
)
async def test_held_voice_revalidation_rejects_changed_owner_or_card(card, change):
    r = card
    approved = await approve(r)
    entered, release = asyncio.Event(), asyncio.Event()

    async def held_read():
        entered.set()
        await release.wait()

    r.music.hook = held_read
    pending = asyncio.create_task(execute(r, approved))
    try:
        await asyncio.wait_for(entered.wait(), 2)
        if change == "current":
            r.current[0] = False
        elif change == "owner":
            r.music.tools._token = "replaced-server-owner"
        elif change == "epoch":
            r.session._epoch = "new-epoch"
        elif change == "history":
            r.session._history_session = "another-session"
        elif change == "task":
            r.bridge.music_selection.tasks.pop(r.offer["taskId"])
        elif change == "source":
            r.bridge.music_selection.sources.clear()
        elif change == "policy":
            r.bridge.controls.policy["music"][0]["actions"].remove("play_track")
        elif change == "privacy":
            r.session._muted = True
        elif change == "closing":
            r.session._transport_closing = True
        elif change == "expiry":
            source_id = r.bridge.music_selection.tasks[r.offer["taskId"]]["candidateSetId"]
            r.bridge.music_selection.sources[source_id]["deadline"] = 0
        else:
            r.music.value["homepod_id"] = "another-homepod"
    finally:
        release.set()
    result = await asyncio.wait_for(pending, 2)
    assert not result["ok"] and not starts(r)


async def test_voice_and_touch_share_one_consumption_and_unknown_cannot_replay(card):
    r = card
    approved = await approve(r)
    entered, release = asyncio.Event(), asyncio.Event()

    async def held_read():
        entered.set()
        await release.wait()

    r.music.hook = held_read
    pending = asyncio.create_task(execute(r, approved))
    try:
        await asyncio.wait_for(entered.wait(), 2)
        touch = {
            "bootId": r.bridge.boot_id,
            "roomId": "kitchen",
            **r.args,
            "requestId": "touch-while-voice-pending",
        }
        assert not (await post(r, "/view/api/music/selection/actions", touch))["ok"]
        r.music.hook = None
        r.music.mutate_receipt = lambda receipt: receipt.update(outcome="unknown", ok=False)
    finally:
        release.set()
    result = await asyncio.wait_for(pending, 2)
    assert not result["ok"] and result["data"]["outcome"] == "unknown", result
    assert len(starts(r)) == 1
    assert not (await execute(r, approved))["ok"]
    assert not (await post(r, "/view/api/music/selection/actions", touch))["ok"]
    assert len(starts(r)) == 1


async def test_multiple_room_cards_fail_closed_without_guessing_selected_task(card):
    r = card
    task = r.bridge.music_selection.tasks[r.offer["taskId"]]
    r.bridge.music_selection.tasks["another-task"] = {**task, "id": "another-task"}
    result = await r.music.tools.dispatch(
        "podview_music_options", {}, execution_context=r.proposal, execution_guard=lambda: True
    )
    assert not result["ok"] and not starts(r)
