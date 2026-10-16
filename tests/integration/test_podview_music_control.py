"""Real ToolRouter owner/client binding and inert HA response-service transport."""

import asyncio
import json
import time
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from gatekeeper import podview_music_control as module
from gatekeeper.podview_music_control import MusicControlFacade
from gatekeeper.tools import ToolRouter


def controls():
    return {
        "ok": True,
        "schema": "podconnect.controls.v1",
        "config_entry_id": "account",
        "owner_epoch": "a" * 32,
        "poll_sequence": 7,
        "next_command_sequence": 3,
        "target": {
            "kind": "spotify_device",
            "target_id": "device",
            "name": "Kitchen",
            "token": "SECRET",
        },
        "observation": {
            "status": "fresh",
            "source": "spotify_web_api",
            "observed_at": datetime.now(UTC).isoformat(),
            "age_ms": 0,
            "max_age_ms": 15000,
            "token": "SECRET",
        },
        "actions": ["resume", "next", "previous", "volume"],
        "volume_percent": 30,
        "status": "ready",
        "physical_result_verified": False,
        "token": "SECRET",
    }


class Rig:
    def __init__(self):
        self.calls = []
        self.value = controls()
        self.hook = None
        self.raw = None
        self.code = 200
        self.mutate_receipt = None
        self.mutate_preparation = None
        self.client = httpx.AsyncClient(transport=httpx.MockTransport(self.handle))
        self.tools = ToolRouter(None, client=self.client, supervisor_token="server-only")
        self.tools._discovery = replace(
            self.tools._discovery,
            podconnect_services=frozenset({"get_playback_controls", "control_playback"}),
        )
        self.tools._refresh_podconnect_services = AsyncMock(
            side_effect=AssertionError("no refresh")
        )
        self.facade = MusicControlFacade(self.tools)

    async def handle(self, request):
        args = json.loads(request.content)
        self.calls.append((request.method, request.url.path, dict(request.url.params), args))
        assert request.headers["Authorization"] == "Bearer server-only"
        if self.hook:
            await self.hook()
        if self.raw is not None:
            return httpx.Response(self.code, content=self.raw)
        if request.url.path.endswith(
            (
                "get_playback_controls",
                "get_track_play_controls",
                "get_context_play_controls",
                "get_room_playback_controls",
                "get_room_volume_controls",
                "get_room_content_controls",
            )
        ):
            value = self.value
        elif request.url.path.endswith("prepare_room_selected_content"):
            value = {
                "ok": True,
                "schema": "podconnect.room_content_preparation.v1",
                "config_entry_id": args["config_entry_id"],
                "owner_epoch": args["owner_epoch"],
                "request_id": args["request_id"],
                "command_sequence": args["command_sequence"],
                "action": args["action"],
                "target": {"kind": "spotify_device", "target_id": args["target_id"]},
                "room_id": args["room_id"],
                "homepod_id": args["homepod_id"],
                "state": "staged",
                "retry_allowed": False,
                "physical_result_verified": False,
            }
            if self.mutate_preparation:
                self.mutate_preparation(value)
        elif request.url.path.endswith("cancel_room_content_preparation"):
            value = {"ok": True, "schema": "podconnect.room_content_preparation_cancel.v1"}
        else:
            room = request.url.path.endswith("control_room_playback")
            volume = request.url.path.endswith("control_room_volume")
            selected = request.url.path.endswith("start_room_selected_content")
            value = {
                "ok": True,
                "schema": "podconnect.command.v1",
                "config_entry_id": args["config_entry_id"],
                "owner_epoch": args["owner_epoch"],
                "request_id": args["request_id"],
                "command_sequence": args["command_sequence"],
                "action": args["action"],
                "target": {"kind": "spotify_device", "target_id": args["target_id"]},
                "outcome": "accepted",
                "provider_request_accepted": not (room or volume or selected),
                **(
                    {
                        "accepted_selected_content": True,
                        "start_operation_id": "d" * 32,
                        "start_volume_percent": 35,
                        "room_id": args["room_id"],
                        "homepod_id": args["homepod_id"],
                    }
                    if selected
                    else {}
                ),
                **({"accepted_native": True} if room else {}),
                **(
                    {
                        "protocol_accepted": True,
                        "reservation_accepted": True,
                        "possible_effect": True,
                        "volume_operation_state": "protocol_accepted",
                    }
                    if volume
                    else {}
                ),
                "retry_allowed": False,
                "physical_result_verified": False,
                "observe_after_poll_sequence": args["expected_poll_sequence"],
                **({} if room or volume or selected else {"token": "SECRET"}),
            }
            if self.mutate_receipt:
                self.mutate_receipt(value)
        return httpx.Response(self.code, json={"service_response": value, "token": "SECRET"})

    async def offer(self):
        result = await self.facade.setup("account", "device", lambda: True)
        assert result["ok"], result
        return result["data"]


@pytest.fixture
async def rig():
    value = Rig()
    yield value
    await value.client.aclose()


async def test_exact_services_canonical_sequence_projection_and_no_discovery_mutation(rig):
    discovery = rig.tools._discovery
    declarations = rig.tools.declarations()
    offered = await rig.offer()
    assert "SECRET" not in json.dumps(offered)
    assert offered["observation"] == {
        k: v for k, v in rig.value["observation"].items() if k != "token"
    }
    result = await rig.facade.execute(offered, "volume", {"percent": 42}, lambda: True)
    assert result["outcome"] == "accepted" and result["provider_request_accepted"] is True
    assert result["retry_allowed"] is False and result["physical_result_verified"] is False
    assert "SECRET" not in json.dumps(result)
    assert rig.calls == [
        (
            "POST",
            "/core/api/services/podconnect/get_playback_controls",
            {"return_response": ""},
            {"config_entry_id": "account", "kind": "spotify_device", "target_id": "device"},
        ),
        (
            "POST",
            "/core/api/services/podconnect/control_playback",
            {"return_response": ""},
            {
                "config_entry_id": "account",
                "kind": "spotify_device",
                "target_id": "device",
                "owner_epoch": "a" * 32,
                "expected_poll_sequence": 7,
                "request_id": "a" * 32 + ":3",
                "command_sequence": 3,
                "action": "volume",
                "args": {"percent": 42},
            },
        ),
    ]
    assert rig.tools._discovery is discovery
    assert rig.tools.declarations() == declarations
    assert rig.tools._refresh_podconnect_services.await_count == 0


@pytest.mark.parametrize("change", ["service", "token", "closed", "current"])
async def test_unavailable_admission_never_posts(rig, change):
    offered = await rig.offer()
    rig.calls.clear()
    if change == "service":
        rig.tools._discovery = replace(
            rig.tools._discovery, podconnect_services=frozenset({"control_playback"})
        )
    elif change == "token":
        rig.tools._token = ""
    elif change == "closed":
        await rig.client.aclose()

    def current():
        return change != "current"

    assert not (await rig.facade.setup("account", "device", current))["ok"]
    result = await rig.facade.execute(offered, "resume", {}, current)
    assert result["outcome"] == "rejected"
    assert rig.calls == []


@pytest.mark.parametrize("change", ["discovery", "token", "epoch", "client", "current"])
async def test_pending_read_and_command_cannot_publish_replaced_owners(rig, change):
    offered = await rig.offer()
    alive = [True]
    replacement = httpx.AsyncClient(transport=httpx.MockTransport(rig.handle))

    async def mutate():
        if change == "discovery":
            rig.tools._discovery = replace(rig.tools._discovery)
        elif change == "token":
            rig.tools._token += "changed"
        elif change == "epoch":
            rig.tools._services_epoch += 1
        elif change == "client":
            rig.tools._client = replacement
        else:
            alive[0] = False

    try:
        rig.hook = mutate
        result = await rig.facade.execute(offered, "resume", {}, lambda: alive[0])
        assert result["outcome"] == "unknown"
        assert result["retry_allowed"] is False
    finally:
        await replacement.aclose()


async def test_setup_rechecks_equal_discovery_replacement_after_await(rig):
    async def mutate():
        rig.tools._discovery = replace(rig.tools._discovery)

    rig.hook = mutate
    assert not (await rig.facade.setup("account", "device", lambda: True))["ok"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("config_entry_id", "other"),
        ("owner_epoch", ""),
        ("poll_sequence", True),
        ("next_command_sequence", 0),
        ("next_command_sequence", 2**53),
        ("target", {"kind": "configured_alias", "target_id": "device"}),
        ("actions", ["resume", "pause"]),
        ("actions", ["next", "next"]),
        ("actions", ["transfer"]),
        ("volume_percent", True),
        ("physical_result_verified", True),
    ],
)
async def test_owner_controls_fail_closed_on_malformed_or_unbound_fields(rig, field, value):
    rig.value[field] = value
    assert not (await rig.facade.setup("account", "device", lambda: True))["ok"]


@pytest.mark.parametrize("change", ["old", "future", "age", "maximum", "source"])
async def test_source_freshness_is_verified_not_retimestamped(rig, change):
    obs = rig.value["observation"]
    if change in {"old", "future"}:
        obs["observed_at"] = (
            datetime.now(UTC) + timedelta(seconds=-16 if change == "old" else 6)
        ).isoformat()
    else:
        obs.update(
            {
                "age": {"age_ms": 15001},
                "maximum": {"max_age_ms": 16000},
                "source": {"source": "optimistic"},
            }[change]
        )
    assert not (await rig.facade.setup("account", "device", lambda: True))["ok"]


async def test_reported_age_deadline_and_source_deadline_cannot_renew_at_execution(
    rig, monkeypatch
):
    now = time.time()
    monkeypatch.setattr(module.time, "time", lambda: now)
    rig.value["observation"]["age_ms"] = 14900
    offered = await rig.offer()
    assert offered["valid_until"] <= now + 0.1
    rig.calls.clear()
    monkeypatch.setattr(module.time, "time", lambda: now + 0.2)
    assert (await rig.facade.execute(offered, "resume", {}, lambda: True))["outcome"] == "rejected"
    assert rig.calls == []


@pytest.mark.parametrize(
    "action,args",
    [
        ("transfer", {}),
        ("volume", {"percent": True}),
        ("volume", {"percent": 101}),
        ("resume", {"uri": "secret"}),
    ],
)
async def test_unoffered_actions_and_invalid_args_never_send(rig, action, args):
    offered = await rig.offer()
    rig.calls.clear()
    assert (await rig.facade.execute(offered, action, args, lambda: True))["outcome"] == "rejected"
    assert rig.calls == []


@pytest.mark.parametrize("outcome", ["timeout", "cancel", "http", "json", "oversize"])
async def test_possible_send_failures_remain_unknown_with_one_post(rig, outcome, monkeypatch):
    offered = await rig.offer()
    rig.calls.clear()
    entered = asyncio.Event()

    async def hold():
        entered.set()
        await asyncio.Event().wait()

    if outcome in {"timeout", "cancel"}:
        rig.hook = hold
        monkeypatch.setattr(module, "_TIMEOUT_S", 0.02)
    elif outcome == "http":
        rig.code, rig.raw = 500, b"SECRET"
    elif outcome == "json":
        rig.raw = b"SECRET"
    else:
        rig.raw = b"x" * 65537
    task = asyncio.create_task(rig.facade.execute(offered, "next", {}, lambda: True))
    if outcome == "cancel":
        await entered.wait()
        task.cancel()
    result = await task
    assert result["outcome"] == "unknown" and result["retry_allowed"] is False
    assert "SECRET" not in json.dumps(result)
    assert len(rig.calls) == 1


@pytest.mark.parametrize(
    "field,value",
    [
        ("request_id", "other"),
        ("command_sequence", 4),
        ("owner_epoch", "other"),
        ("physical_result_verified", True),
        ("retry_allowed", True),
        ("target", {"kind": "spotify_device", "target_id": "other"}),
    ],
)
async def test_mismatched_owner_receipt_never_becomes_acceptance(rig, field, value):
    offered = await rig.offer()
    rig.mutate_receipt = lambda receipt: receipt.update({field: value})
    result = await rig.facade.execute(offered, "next", {}, lambda: True)
    assert result["outcome"] == "unknown"


async def test_exact_owner_rejection_is_preserved_without_provider_detail(rig):
    offered = await rig.offer()
    rig.mutate_receipt = lambda receipt: receipt.update(
        ok=False,
        outcome="rejected",
        provider_request_accepted=False,
        error_kind="stale_command",
        error="SECRET",
    )
    result = await rig.facade.execute(offered, "next", {}, lambda: True)
    assert result["outcome"] == "rejected" and result["error_kind"] == "stale_command"
    assert "SECRET" not in json.dumps(result)


@pytest.mark.parametrize(
    "owner",
    [
        None,
        object(),
        SimpleNamespace(),
        SimpleNamespace(_token="token"),
        SimpleNamespace(_token="token", _client=object(), _discovery=None),
    ],
)
async def test_absent_or_partial_tools_owner_is_unavailable_without_throwing(owner):
    facade = MusicControlFacade(owner)
    assert facade.available is False
    assert facade.binding()[-1] is False
    assert (await facade.setup("account", "device", lambda: True))["outcome"] == "rejected"


async def test_boolean_receipt_sequence_cannot_impersonate_command_one(rig):
    rig.value["next_command_sequence"] = 1
    offered = await rig.offer()
    rig.mutate_receipt = lambda receipt: receipt.update(command_sequence=True)
    result = await rig.facade.execute(offered, "next", {}, lambda: True)
    assert result["outcome"] == "unknown"
    assert len(rig.calls) == 2


def content_owner(rig, *, action="play_track"):
    rig.tools._discovery = replace(
        rig.tools._discovery,
        podconnect_services=rig.tools._discovery.podconnect_services
        | {
            "get_room_content_controls",
            "prepare_room_selected_content",
            "start_room_selected_content",
            "cancel_room_content_preparation",
        },
    )
    rig.value = {
        "ok": True,
        "schema": "podconnect.room_content_controls.v1",
        "config_entry_id": "account",
        "owner_epoch": "a" * 32,
        "poll_sequence": 7,
        "next_command_sequence": 3,
        "observation": {
            "status": "fresh",
            "observed_at": datetime.now(UTC).isoformat(),
            "age_ms": 0,
            "max_age_ms": 15000,
            "source": "podconnect_coordinator",
        },
        "target": {"kind": "spotify_device", "target_id": "device"},
        "room_id": "native-room",
        "homepod_id": "42",
        "actions": [action],
        "status": "ready",
        "start_offer": {
            "schema": "podconnect.room_content_offer.v1",
            "offer_id": "b" * 32,
            "binding_id": "c" * 64,
            "native_incarnation": "d" * 32,
            "policy_revision": "e" * 64,
            "start_volume_percent": 35,
            "expires_after_ms": 5000,
        },
        "physical_result_verified": False,
    }


async def test_selected_track_exact_start_service_and_complete_receipt(rig):
    content_owner(rig)
    offer = await rig.facade.setup_track("account", "device", "native-room", "42", lambda: True)
    assert offer["ok"] and len(offer["data"]) == 15
    assert rig.calls[0][3] == {
        "config_entry_id": "account",
        "kind": "spotify_device",
        "target_id": "device",
        "room_id": "native-room",
        "homepod_id": "42",
    }
    uri = "spotify:track:" + "A" * 22
    result = await rig.facade.execute_track(offer["data"], uri, 40, lambda: True)
    assert result["ok"] and result["accepted_selected_content"] is True
    assert result["provider_request_accepted"] is False
    assert len(rig.calls) == 3
    assert rig.calls[1][1].endswith("prepare_room_selected_content")
    assert rig.calls[2][1].endswith("start_room_selected_content")
    assert rig.calls[1][3] == rig.calls[2][3]
    request = rig.calls[2][3]
    assert len(request) == 12
    assert request["args"] == {"track_uri": uri, "max_volume": 40}
    assert request["start_offer"] == rig.value["start_offer"]
    assert request["room_id"] == "native-room" and request["homepod_id"] == "42"


@pytest.mark.parametrize(
    "change",
    [
        "missing",
        "foreign_room",
        "foreign_target",
        "boolean_volume",
        "bad_hex",
        "extra",
        "no_action",
        "stale",
        "sequence_bool",
    ],
)
async def test_selected_read_rejects_invalid_owner_without_command(rig, change):
    content_owner(rig)
    if change == "missing":
        del rig.value["start_offer"]
    elif change == "foreign_room":
        rig.value["room_id"] = "other"
    elif change == "foreign_target":
        rig.value["target"]["target_id"] = "other"
    elif change == "boolean_volume":
        rig.value["start_offer"]["start_volume_percent"] = True
    elif change == "bad_hex":
        rig.value["start_offer"]["binding_id"] = "wrong"
    elif change == "extra":
        rig.value["active_device"] = "not-authority"
    elif change == "no_action":
        rig.value["actions"] = []
    elif change == "stale":
        rig.value["observation"]["age_ms"] = 15000
    else:
        rig.value["next_command_sequence"] = True
    result = await rig.facade.setup_track("account", "device", "native-room", "42", lambda: True)
    assert not result["ok"] and len(rig.calls) == 1


@pytest.mark.parametrize(
    "change", ["expired", "boolean_limit", "low_ceiling", "wrong_uri", "bad_offer"]
)
async def test_selected_execute_rejects_without_send(rig, change):
    content_owner(rig)
    offer = (await rig.facade.setup_track("account", "device", "native-room", "42", lambda: True))[
        "data"
    ]
    uri, ceiling = "spotify:track:" + "A" * 22, 40
    if change == "expired":
        offer["valid_until"] = time.time() - 1
    elif change == "boolean_limit":
        ceiling = True
    elif change == "low_ceiling":
        ceiling = 34
    elif change == "wrong_uri":
        uri = "spotify:playlist:" + "A" * 22
    else:
        offer["start_offer"]["binding_id"] = "wrong"
    rig.calls.clear()
    result = await rig.facade.execute_track(offer, uri, ceiling, lambda: True)
    assert not result["ok"] and result["outcome"] == "rejected" and not rig.calls


async def test_selected_context_uses_same_native_service_and_playlist_only(rig):
    content_owner(rig, action="play_context")
    offer = await rig.facade.setup_context("account", "device", "native-room", "42", lambda: True)
    assert offer["ok"]
    uri = "spotify:playlist:" + "P" * 22
    result = await rig.facade.execute_context(offer["data"], uri, 40, lambda: True)
    assert result["accepted_selected_content"] is True
    assert rig.calls[0][1].endswith("get_room_content_controls")
    assert rig.calls[1][3] == rig.calls[2][3]
    assert rig.calls[2][3]["args"] == {"context_uri": uri, "max_volume": 40}
    assert "accepted_native" not in result and "protocol_accepted" not in result


@pytest.mark.parametrize(
    "change", ["missing_complete", "false_complete", "bad_operation", "wrong_room", "provider_true"]
)
async def test_selected_receipt_never_promotes_partial_or_foreign_acceptance(rig, change):
    content_owner(rig)
    offer = (await rig.facade.setup_track("account", "device", "native-room", "42", lambda: True))[
        "data"
    ]

    def mutate(receipt):
        if change == "missing_complete":
            del receipt["accepted_selected_content"]
        elif change == "false_complete":
            receipt["accepted_selected_content"] = False
        elif change == "bad_operation":
            receipt["start_operation_id"] = None
        elif change == "wrong_room":
            receipt["room_id"] = "other"
        else:
            receipt["provider_request_accepted"] = True

    rig.mutate_receipt = mutate
    result = await rig.facade.execute_track(offer, "spotify:track:" + "A" * 22, 40, lambda: True)
    assert result["outcome"] == "unknown" and not result["ok"]
    assert [call[1].rsplit("/", 1)[-1] for call in rig.calls[1:]] == [
        "prepare_room_selected_content",
        "start_room_selected_content",
        "cancel_room_content_preparation",
    ]


async def test_revoked_task_after_detached_preparation_cancels_without_commit(rig):
    content_owner(rig)
    offer = (await rig.facade.setup_track("account", "device", "native-room", "42", lambda: True))[
        "data"
    ]
    current_owner = True

    async def after_prepare():
        nonlocal current_owner
        if rig.calls[-1][1].endswith("prepare_room_selected_content"):
            current_owner = False

    rig.hook = after_prepare
    result = await rig.facade.execute_track(
        offer, "spotify:track:" + "A" * 22, 40, lambda: current_owner
    )
    assert result["outcome"] == "rejected"
    assert [call[1].rsplit("/", 1)[-1] for call in rig.calls[1:]] == [
        "prepare_room_selected_content",
        "cancel_room_content_preparation",
    ]
    assert set(rig.calls[-1][3]) == {
        "config_entry_id",
        "owner_epoch",
        "command_sequence",
        "request_id",
        "offer_id",
        "binding_id",
    }


async def test_revoked_task_after_commit_send_cancels_exact_operation_as_unknown(rig):
    content_owner(rig)
    offer = (await rig.facade.setup_track("account", "device", "native-room", "42", lambda: True))[
        "data"
    ]
    current_owner = True

    async def after_commit():
        nonlocal current_owner
        if rig.calls[-1][1].endswith("start_room_selected_content"):
            current_owner = False

    rig.hook = after_commit
    result = await rig.facade.execute_track(
        offer, "spotify:track:" + "A" * 22, 40, lambda: current_owner
    )
    assert result["outcome"] == "unknown" and result["retry_allowed"] is False
    assert [call[1].rsplit("/", 1)[-1] for call in rig.calls[1:]] == [
        "prepare_room_selected_content",
        "start_room_selected_content",
        "cancel_room_content_preparation",
    ]
    request, cancellation = rig.calls[2][3], rig.calls[3][3]
    assert cancellation == {
        "config_entry_id": request["config_entry_id"],
        "owner_epoch": request["owner_epoch"],
        "command_sequence": request["command_sequence"],
        "request_id": request["request_id"],
        "offer_id": request["start_offer"]["offer_id"],
        "binding_id": request["start_offer"]["binding_id"],
    }


@pytest.mark.parametrize("change", ["unknown", "false_staged", "foreign_room", "extra"])
async def test_untrusted_preparation_never_commits(rig, change):
    content_owner(rig)
    offer = (await rig.facade.setup_track("account", "device", "native-room", "42", lambda: True))[
        "data"
    ]

    def mutate(preparation):
        if change == "unknown":
            preparation.update(ok=False, state="unknown")
        elif change == "false_staged":
            preparation["ok"] = False
        elif change == "foreign_room":
            preparation["room_id"] = "other"
        else:
            preparation["source_url"] = "forbidden"

    rig.mutate_preparation = mutate
    result = await rig.facade.execute_track(offer, "spotify:track:" + "A" * 22, 40, lambda: True)
    assert not result["ok"]
    assert not any(call[1].endswith("start_room_selected_content") for call in rig.calls)


def room_owner(rig):
    rig.tools._discovery = replace(
        rig.tools._discovery,
        podconnect_services=rig.tools._discovery.podconnect_services
        | {"get_room_playback_controls", "control_room_playback"},
    )
    rig.value.update(
        schema="podconnect.room_controls.v1",
        actions=["next"],
        volume_percent=None,
        volume_supported=False,
        volume_unavailable_reason="room_volume_not_supported",
        track_play_supported=False,
        room_id="native-room",
        homepod_id="42",
        native={
            "account_user_id": "native-account",
            "target_id": "device",
            "room_id": "native-room",
            "homepod_id": "42",
            "connection_id": "connection",
            "session_id": "session",
            "alias_incarnation": "incarnation",
            "alias_registry": "b" * 64,
            "alias_revision": 3,
        },
        route={
            "process": "11111111-1111-4111-8111-111111111111",
            "device_id": "42",
            "device_incarnation": "1",
            "session_epoch": "2",
            "route_revision": "3",
            "selection_revision": "4",
            "input_generation": "5",
            "input_item_id": "6",
            "input_path_digest": "a" * 64,
        },
    )
    rig.value.pop("token")
    rig.value["target"].pop("token")
    rig.value["observation"].pop("token")


async def test_room_audio4_uses_only_exact_services_and_native_receipt(rig):
    room_owner(rig)
    offer = await rig.facade.setup_room("account", "device", "native-room", "42", lambda: True)
    assert offer["ok"], offer
    assert "SECRET" not in json.dumps(offer)
    result = await rig.facade.execute_room(offer["data"], "next", lambda: True)
    assert result["outcome"] == "accepted"
    assert result["accepted_native"] is True
    assert result["provider_request_accepted"] is False
    assert result["physical_result_verified"] is False
    assert [call[1].rsplit("/", 1)[-1] for call in rig.calls] == [
        "get_room_playback_controls",
        "control_room_playback",
    ]
    assert rig.calls[0][3] == {
        "config_entry_id": "account",
        "kind": "spotify_device",
        "target_id": "device",
        "room_id": "native-room",
        "homepod_id": "42",
    }
    request = rig.calls[1][3]
    assert request["native"] == offer["data"]["native"]
    assert request["route"] == offer["data"]["route"]
    assert request["args"] == {}
    assert request["action"] == "next"


@pytest.mark.parametrize("change", ["route", "native", "volume", "service", "extra"])
async def test_room_owner_mismatch_never_falls_back_to_webapi(rig, change):
    room_owner(rig)
    if change == "route":
        rig.value["route"]["input_path_digest"] = "Z" * 64
    elif change == "native":
        rig.value["native"]["homepod_id"] = "foreign"
    elif change == "volume":
        rig.value["actions"].append("volume")
    elif change == "extra":
        rig.value["token"] = "SECRET"
    else:
        rig.tools._discovery = replace(
            rig.tools._discovery,
            podconnect_services=frozenset({"get_playback_controls", "control_playback"}),
        )
    result = await rig.facade.setup_room("account", "device", "native-room", "42", lambda: True)
    assert result["ok"] is False
    assert not any(call[1].endswith("control_playback") for call in rig.calls)


async def test_room_read_cannot_publish_after_discovery_replacement(rig):
    room_owner(rig)

    async def replace_owner():
        rig.tools._discovery = replace(rig.tools._discovery)

    rig.hook = replace_owner
    result = await rig.facade.setup_room("account", "device", "native-room", "42", lambda: True)
    assert result["ok"] is False
    assert [call[1].rsplit("/", 1)[-1] for call in rig.calls] == ["get_room_playback_controls"]


@pytest.mark.parametrize("change", ["boolean_sequence", "malformed", "owner_changed"])
async def test_room_possible_send_is_unknown_without_replay(rig, change):
    room_owner(rig)
    offered = (await rig.facade.setup_room("account", "device", "native-room", "42", lambda: True))[
        "data"
    ]
    rig.calls.clear()
    if change == "boolean_sequence":
        rig.mutate_receipt = lambda value: value.update(command_sequence=True)
        offered["next_command_sequence"] = 1
    elif change == "malformed":
        rig.raw = b"{malformed"
    else:

        async def mutate():
            rig.tools._services_epoch += 1

        rig.hook = mutate
    result = await rig.facade.execute_room(offered, "next", lambda: True)
    assert result["outcome"] == "unknown"
    assert result["retry_allowed"] is False
    assert len(rig.calls) == 1
    assert rig.calls[0][1].endswith("control_room_playback")


async def test_audio4_owner_replaced_after_send_stays_consumed_unknown_without_content_cancel(rig):
    room_owner(rig)
    offered = (await rig.facade.setup_room("account", "device", "native-room", "42", lambda: True))[
        "data"
    ]
    current_owner = True

    async def after_audio4():
        nonlocal current_owner
        if rig.calls[-1][1].endswith("control_room_playback"):
            current_owner = False

    rig.hook = after_audio4
    rig.calls.clear()
    result = await rig.facade.execute_room(offered, "next", lambda: current_owner)
    assert result["outcome"] == "unknown" and result["retry_allowed"] is False
    assert [call[1].rsplit("/", 1)[-1] for call in rig.calls] == ["control_room_playback"]


def volume_owner(rig):
    room_owner(rig)
    rig.tools._discovery = replace(
        rig.tools._discovery,
        podconnect_services=rig.tools._discovery.podconnect_services
        | {"get_room_volume_controls", "control_room_volume"},
    )
    rig.value.update(
        schema="podconnect.room_volume_controls.v1",
        actions=["volume"],
        volume_state={
            "base_revision": "0",
            "attention_revision": "12",
            "base_percent": 27,
            "effective_percent": 15,
        },
    )
    del rig.value["volume_supported"]
    del rig.value["volume_unavailable_reason"]


async def test_room_volume_exact_services_percent_zero_and_distinct_receipt(rig):
    volume_owner(rig)
    offer = await rig.facade.setup_volume("account", "device", "native-room", "42", lambda: True)
    assert offer["ok"], offer
    assert len(rig.value) == 18 and "volume_supported" not in offer["data"]
    assert offer["data"]["volume_percent"] is None
    result = await rig.facade.execute_volume(offer["data"], 0, lambda: True)
    assert result["outcome"] == "accepted"
    assert (
        result["protocol_accepted"]
        is result["reservation_accepted"]
        is result["possible_effect"]
        is True
    )
    assert result["provider_request_accepted"] is result["physical_result_verified"] is False
    assert "accepted_native" not in result and "volume_percent" not in result
    assert [call[1].rsplit("/", 1)[-1] for call in rig.calls] == [
        "get_room_volume_controls",
        "control_room_volume",
    ]
    request = rig.calls[1][3]
    assert set(request) == {
        "config_entry_id",
        "kind",
        "target_id",
        "room_id",
        "homepod_id",
        "native",
        "route",
        "volume_state",
        "owner_epoch",
        "expected_poll_sequence",
        "command_sequence",
        "request_id",
        "action",
        "args",
    }
    assert request["volume_state"] == rig.value["volume_state"]
    assert request["args"] == {"percent": 0}
    assert request["request_id"] == "a" * 32 + ":3"
    assert not any(call[1].endswith("control_playback") for call in rig.calls)


@pytest.mark.parametrize(
    "change", ["extra", "missing_state", "revision", "percent", "route", "service"]
)
async def test_room_volume_offer_fails_closed_without_generic_fallback(rig, change):
    volume_owner(rig)
    if change == "extra":
        rig.value["volume_supported"] = True
    elif change == "missing_state":
        del rig.value["volume_state"]
    elif change == "revision":
        rig.value["volume_state"]["base_revision"] = "01"
    elif change == "percent":
        rig.value["volume_state"]["effective_percent"] = True
    elif change == "route":
        rig.value["route"]["input_path_digest"] = "Z" * 64
    else:
        rig.tools._discovery = replace(
            rig.tools._discovery,
            podconnect_services=rig.tools._discovery.podconnect_services
            - {"get_room_volume_controls"},
        )
    result = await rig.facade.setup_volume("account", "device", "native-room", "42", lambda: True)
    assert result["ok"] is False
    assert not any(call[1].endswith("control_playback") for call in rig.calls)


@pytest.mark.parametrize(
    "change",
    [
        "boolean_sequence",
        "accepted_native",
        "reservation_only",
        "contradictory_rejection",
        "contradictory_state",
        "malformed",
        "owner_changed",
    ],
)
async def test_room_volume_possible_send_stays_consumed_unknown(rig, change):
    volume_owner(rig)
    offered = (
        await rig.facade.setup_volume("account", "device", "native-room", "42", lambda: True)
    )["data"]
    rig.calls.clear()
    if change == "boolean_sequence":
        rig.mutate_receipt = lambda value: value.update(command_sequence=True)
        offered["next_command_sequence"] = 1
    elif change == "accepted_native":
        rig.mutate_receipt = lambda value: value.update(accepted_native=True)
    elif change == "reservation_only":
        rig.mutate_receipt = lambda value: value.update(protocol_accepted=False)
    elif change == "contradictory_rejection":
        rig.mutate_receipt = lambda value: value.update(
            ok=False,
            outcome="rejected",
            protocol_accepted=False,
            volume_operation_state="rejected_before_admission",
        )
    elif change == "contradictory_state":
        rig.mutate_receipt = lambda value: value.update(
            volume_operation_state="rejected_before_admission"
        )
    elif change == "malformed":
        rig.raw = b"{malformed"
    else:

        async def replace_owner():
            rig.tools._services_epoch += 1

        rig.hook = replace_owner
    result = await rig.facade.execute_volume(offered, 100, lambda: True)
    assert result["outcome"] == "unknown" and result["retry_allowed"] is False
    assert len(rig.calls) == 1 and rig.calls[0][1].endswith("control_room_volume")


async def test_room_volume_real_pre_admission_rejection_remains_rejected(rig):
    volume_owner(rig)
    offered = (
        await rig.facade.setup_volume("account", "device", "native-room", "42", lambda: True)
    )["data"]
    rig.mutate_receipt = lambda value: value.update(
        ok=False,
        outcome="rejected",
        protocol_accepted=False,
        reservation_accepted=False,
        possible_effect=False,
        volume_operation_state="rejected_before_admission",
    )
    result = await rig.facade.execute_volume(offered, 30, lambda: True)
    assert result["outcome"] == "rejected" and result["possible_effect"] is False
    assert result["retry_allowed"] is False


async def test_rapid_volume_then_audio4_uses_fresh_shared_sequence_without_fallback(rig):
    volume_owner(rig)
    first = (await rig.facade.setup_volume("account", "device", "native-room", "42", lambda: True))[
        "data"
    ]
    assert (await rig.facade.execute_volume(first, 27, lambda: True))["outcome"] == "accepted"
    rig.value.update(
        schema="podconnect.room_controls.v1",
        actions=["next"],
        volume_supported=False,
        volume_unavailable_reason="room_volume_not_supported",
    )
    rig.value.pop("volume_state")
    rig.value["next_command_sequence"] = 4
    second = (await rig.facade.setup_room("account", "device", "native-room", "42", lambda: True))[
        "data"
    ]
    assert (await rig.facade.execute_room(second, "next", lambda: True))["outcome"] == "accepted"
    sends = [
        call[3]
        for call in rig.calls
        if call[1].endswith(("control_room_volume", "control_room_playback"))
    ]
    assert [(send["request_id"], send["action"]) for send in sends] == [
        ("a" * 32 + ":3", "volume"),
        ("a" * 32 + ":4", "next"),
    ]
    assert all(not call[1].endswith("control_playback") for call in rig.calls)
