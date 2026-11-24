"""Voice "move the music to room X" works without any paired screen (production since 2.1.42).

The add-on is built as in production (create_app with the administrator's control policy) and
no controller grant, pairing or HA ingress actor exists. The voice tools run through the
router's real entry point; the move goes out as the panel's own ``podvoice.music_move`` call.
"""

import json
from dataclasses import replace
from unittest.mock import AsyncMock

import httpx
import pytest
from integration.test_podview_bridge import owner

from gatekeeper.execution_policy import ExecutionContext
from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE
from gatekeeper.tools import ToolRouter
from gatekeeper.web import create_app

ACCOUNT = "account-alpha"
KITCHEN, OFFICE, KIDS = "media_player.kokkenalrum", "media_player.kontor", "media_player.frida"
PLAYERS = {KITCHEN: "r0", OFFICE: "r1", KIDS: "r2"}


def policy(*, office_moves=True):
    def row(native, homepod, actions, default=False):
        return {
            "accountId": ACCOUNT,
            "targetId": "speaker",
            "nativeRoomId": native,
            "nativeHomepodId": homepod,
            "actions": actions,
            "maxVolume": 40,
            "default": default,
        }

    move = ["pause", "volume", "move_existing_session"]
    return {
        "roomId": "kitchen",
        "music": [
            row("r0", "42", move, default=True),
            row("r1", "43", move if office_moves else ["pause", "volume"]),
            # Frida's room has no rule at all: it is never offered.
        ],
        "vacuum": [],
    }


def player(entity, state="idle", **attributes):
    names = {KITCHEN: "Køkkenalrum", OFFICE: "Kontor", KIDS: "Frida"}
    return {
        "entity_id": entity,
        "state": state,
        "attributes": {
            "friendly_name": names[entity],
            "podconnect_source": "spotify",
            **attributes,
        },
    }


class Rig:
    def __init__(self, control_policy=None):
        self.calls = []
        self.states = {
            KITCHEN: player(KITCHEN, "playing", podconnect_account="own"),
            OFFICE: player(OFFICE),
            KIDS: player(KIDS),
        }
        self.move_answer = {"ok": True, "outcome": "accepted"}
        self.move_status = 200
        self.client = httpx.AsyncClient(transport=httpx.MockTransport(self.request))
        self.router = ToolRouter(None, supervisor_token="server-only", client=self.client)
        self.router._discovery = replace(
            self.router._discovery,
            podconnect_services=frozenset({"get_targets", "move_playback"}),
        )
        self.router._device_control._ws_read = self.ws_read
        self.session, _ = owner()
        self.app = create_app(
            StatusHub(),
            {"kitchen": self.session},
            tools=self.router,
            podview_control_policy=json.dumps(control_policy or policy()),
        )
        self.bridge = self.app[BRIDGE]

    async def ws_read(self, command):
        assert command["type"] == "config/entity_registry/get_entries"
        return {
            entity: {
                "unique_id": f"{ACCOUNT}_room_{room}",
                "platform": "podconnect",
                "disabled_by": None,
            }
            for entity, room in PLAYERS.items()
            if entity in command["entity_ids"]
        }

    async def request(self, request):
        assert request.headers["Authorization"] == "Bearer server-only"
        path = request.url.path
        body = json.loads(request.content) if request.content else None
        self.calls.append((request.method, path, body))
        if path == "/core/api/template":
            return httpx.Response(200, text=json.dumps(list(PLAYERS)))
        if path.startswith("/core/api/states/"):
            return httpx.Response(200, json=self.states[path.removeprefix("/core/api/states/")])
        if path == "/core/api/services/podvoice/music_move":
            assert request.url.query == b"return_response"
            return httpx.Response(self.move_status, json={"service_response": self.move_answer})
        raise AssertionError(path)

    def moves(self):
        return [body for _, path, body in self.calls if path.endswith("/podvoice/music_move")]


async def offer(rig, context):
    return await rig.router.dispatch(
        "podview_music_options", {"purpose": "move_existing_session"}, execution_context=context
    )


async def confirmed_move(rig, option_label="Flyt til Kontor", guard=None, turn=1):
    proposal = ExecutionContext("s1", f"live:1:proposal-{turn}", "live")
    sent = len(rig.moves())
    offered = await offer(rig, proposal)
    assert offered["ok"], offered
    option = next(row for row in offered["data"]["options"] if row["label"] == option_label)
    args = {
        "purpose": "move_existing_session",
        "taskId": offered["data"]["taskId"],
        "revision": 1,
        "optionId": option["id"],
    }
    pending = await rig.router.dispatch(
        "podview_music_select_option", args, execution_context=proposal
    )
    assert pending["needs_confirmation"], pending
    assert len(rig.moves()) == sent  # Nothing moves before the separate confirmation.
    held = rig.router.execution_policy.peek_live_challenge(
        pending["approval"]["challenge_id"], session_id="s1"
    )
    assert held is not None and "Kontor" in held.confirmation_json
    approval = rig.router.execution_policy.confirm_live(
        pending["approval"]["challenge_id"],
        confirmation_context=ExecutionContext("s1", f"live:1:confirmation-{turn}", "live"),
        expected_arguments_sha256=pending["arguments_sha256"],
    )
    assert approval is not None
    return await rig.router.dispatch(
        approval.action,
        approval.args,
        execution_context=approval.context,
        approval_token=approval.token,
        execution_guard=guard,
    )


@pytest.mark.asyncio
async def test_voice_move_without_any_screen_grant_moves_through_the_panels_service():
    rig = Rig()
    assert rig.bridge._grants == {} and rig.bridge._ha_actors == {}
    names = {row["name"] for row in rig.router.declarations()}
    assert {"podview_music_options", "podview_music_select_option"} <= names

    offered = await offer(rig, ExecutionContext("s1", "live:1:proposal", "live"))
    assert offered["ok"], offered
    # Only other rooms the policy lets the music move to: not the playing room, not Frida.
    assert [row["label"] for row in offered["data"]["options"]] == ["Flyt til Kontor"]
    assert offered["data"]["from"] == "Køkkenalrum"

    result = await confirmed_move(rig)
    assert result["ok"] is True, result
    assert result["data"]["outcome"] == "accepted"
    assert result["data"]["physical_result_verified"] is False
    assert rig.moves() == [{"entity_id": KITCHEN, "target_entity_id": OFFICE}]
    await rig.client.aclose()


@pytest.mark.asyncio
async def test_voice_move_offers_nothing_when_no_own_music_plays():
    rig = Rig()
    for attributes in ({"podconnect_account": "other"}, {"podconnect_source": "radio"}, None):
        rig.states[KITCHEN] = (
            player(KITCHEN, "playing", **attributes) if attributes else player(KITCHEN, "idle")
        )
        offered = await offer(rig, ExecutionContext("s1", "live:1:proposal", "live"))
        assert offered == {
            "ok": False,
            "error_kind": "nothing_playing",
            "error": offered["error"],
            "retry_allowed": False,
        }
    assert rig.moves() == []
    await rig.client.aclose()


@pytest.mark.asyncio
async def test_voice_move_follows_the_room_rules():
    rig = Rig(policy(office_moves=False))
    offered = await offer(rig, ExecutionContext("s1", "live:1:proposal", "live"))
    assert offered["ok"] is False
    assert rig.moves() == []
    await rig.client.aclose()


@pytest.mark.asyncio
async def test_voice_move_belongs_to_the_asking_voice_session():
    rig = Rig()
    # Another conversation, a non-Live context or an inactive session moves nothing.
    for context in (
        ExecutionContext("other", "live:1:proposal", "live"),
        ExecutionContext("s1", "live:1:proposal", "automation"),
    ):
        assert (await offer(rig, context))["ok"] is False
    rig.session._active = False
    assert (await offer(rig, ExecutionContext("s1", "live:1:proposal", "live")))["ok"] is False
    assert rig.moves() == []
    await rig.client.aclose()


@pytest.mark.asyncio
async def test_voice_move_stale_turn_and_unknown_outcome_never_resend():
    rig = Rig()
    stale = await confirmed_move(rig, guard=lambda: False)
    assert stale["ok"] is False and rig.moves() == []

    rig.move_status = 500
    unknown = await confirmed_move(rig, turn=2)
    assert unknown["ok"] is False and unknown["error_kind"] == "unknown_outcome"
    assert unknown["retry_allowed"] is False
    assert len(rig.moves()) == 1

    rig.move_status = 200
    rig.move_answer = {"ok": False, "outcome": "rejected", "reason": "other_account"}
    rejected = await confirmed_move(rig, turn=3)
    assert rejected["error_kind"] == "rejected"
    assert rejected["data"]["reason"] == "other_account"
    assert len(rig.moves()) == 2
    await rig.client.aclose()


@pytest.mark.asyncio
async def test_voice_move_option_is_used_once():
    rig = Rig()
    rig.router._refresh_podconnect_services = AsyncMock()
    assert (await confirmed_move(rig))["ok"] is True
    proposal = ExecutionContext("s1", "live:1:proposal", "live")
    again = await rig.router.dispatch(
        "podview_music_select_option",
        {"purpose": "move_existing_session", "taskId": "old", "revision": 1, "optionId": "x"},
        execution_context=proposal,
    )
    assert again["ok"] is False
    assert len(rig.moves()) == 1
    await rig.client.aclose()


@pytest.mark.asyncio
async def test_voice_move_rejects_model_destination_and_volume_slots():
    rig = Rig()
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
    assert rig.moves() == []
    await rig.client.aclose()


@pytest.mark.asyncio
async def test_live_generic_alias_transfer_cannot_bypass_the_room_rules():
    rig = Rig()
    rig.router.declarations = lambda: [{"name": "podconnect_move_playback"}]
    rig.router._dispatch = AsyncMock()
    result = await rig.router.dispatch(
        "podconnect_move_playback",
        {"config_entry_id": ACCOUNT, "kind": "configured_alias", "target_id": "r2"},
        execution_context=ExecutionContext("s1", "live:1", "live"),
    )
    assert result["error_kind"] == "room_move_requires_exact_owner"
    rig.router._dispatch.assert_not_awaited()
    await rig.client.aclose()
