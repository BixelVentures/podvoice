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
        if request.url.path.endswith(("get_playback_controls", "get_track_play_controls")):
            value = self.value
        else:
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
                "provider_request_accepted": True,
                "retry_allowed": False,
                "physical_result_verified": False,
                "observe_after_poll_sequence": args["expected_poll_sequence"],
                "token": "SECRET",
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


def native_proof():
    return {
        "schema": "podconnect.start_volume.v1",
        "ready": True,
        "engine_device_id": "device",
        "room_id": "native-room",
        "homepod_id": "homepod-id",
        "policy_revision": "b" * 64,
        "start_volume_percent": 37,
        "mode": "fresh_start",
        "output_selected": False,
        "output_volume_percent": 75,
        "alias_binding": {
            "ready": True,
            "room_id": "old-room",
            "incarnation": "alias-1",
            "registry": "registry-1",
            "token": "SECRET",
        },
        "token": "SECRET",
    }


def track_owner(rig):
    rig.tools._discovery = replace(
        rig.tools._discovery,
        podconnect_services=rig.tools._discovery.podconnect_services | {"get_track_play_controls"},
    )
    rig.value.update(actions=["play_track"], track_play_supported=True, native_start=native_proof())


async def test_native_read_proof_and_exact_start_arguments_reach_control_once(rig):
    track_owner(rig)
    offer = await rig.facade.setup_track(
        "account", "device", "native-room", "homepod-id", lambda: True
    )
    assert offer["ok"]
    assert "SECRET" not in json.dumps(offer)
    assert rig.calls[0][3] == {
        "config_entry_id": "account",
        "kind": "spotify_device",
        "target_id": "device",
        "room_id": "native-room",
    }
    result = await rig.facade.execute_track(
        offer["data"], "spotify:track:" + "A" * 22, 40, lambda: True
    )
    assert result["outcome"] == "accepted"
    assert len(rig.calls) == 2
    assert rig.calls[1][3]["args"] == {
        "track_uri": "spotify:track:" + "A" * 22,
        "max_volume": 40,
        "room_id": "native-room",
        "homepod_id": "homepod-id",
        "start_policy_revision": "b" * 64,
        "alias_incarnation": "alias-1",
    }


@pytest.mark.parametrize(
    "change",
    [
        "missing",
        "engine",
        "room",
        "homepod",
        "revision",
        "boolean_volume",
        "selected",
        "alias",
        "same_room",
    ],
)
async def test_native_read_rejects_missing_changed_and_invalid_proof(rig, change):
    track_owner(rig)
    proof = rig.value["native_start"]
    if change == "missing":
        del rig.value["native_start"]
    elif change in {"engine", "room", "homepod", "revision"}:
        proof[
            {
                "engine": "engine_device_id",
                "room": "room_id",
                "homepod": "homepod_id",
                "revision": "policy_revision",
            }[change]
        ] = "wrong"
    elif change == "boolean_volume":
        proof["start_volume_percent"] = True
    elif change == "selected":
        proof["mode"] = "same_session"
    elif change == "alias":
        proof["alias_binding"]["ready"] = False
    else:
        proof.update(mode="same_session", output_selected=True)
    result = await rig.facade.setup_track(
        "account", "device", "native-room", "homepod-id", lambda: True
    )
    assert not result["ok"]
    assert len(rig.calls) == 1
    assert rig.calls[0][1].endswith("get_track_play_controls")


@pytest.mark.parametrize("change", ["policy_above_cap", "missing", "expired"])
async def test_native_execute_fails_before_command_without_valid_policy(rig, change):
    track_owner(rig)
    offer = await rig.facade.setup_track(
        "account", "device", "native-room", "homepod-id", lambda: True
    )
    value = offer["data"]
    if change == "missing":
        del value["native_start"]
    elif change == "expired":
        value["valid_until"] = time.time() - 1
    else:
        value["native_start"]["start_volume_percent"] = 41
    rig.calls.clear()
    result = await rig.facade.execute_track(value, "spotify:track:" + "A" * 22, 40, lambda: True)
    assert result["outcome"] == "rejected"
    assert not rig.calls
