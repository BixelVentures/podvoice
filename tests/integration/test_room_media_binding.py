"""Actual ingress and Control aggregate: metadata is independent of command grants."""

import asyncio
import copy
import json
import time
from types import SimpleNamespace

import httpx
import pytest
from integration.test_podview_music import Rig, payload
from multidict import MultiDict

from gatekeeper import podview_music
from gatekeeper.podview import BRIDGE, _music
from gatekeeper.podview_room_media import expected_actual, resolve_actual


@pytest.fixture
async def room_rig():
    rig = Rig()
    rig.bridge = rig.app[BRIDGE]
    rig.bridge.controls.policy = {
        "roomId": "kitchen",
        "vacuum": [],
        "light": [],
        "music": [
            {
                "accountId": "account-alpha",
                "targetId": "device-one",
                "nativeRoomId": "r0",
                "nativeHomepodId": "42",
                "actions": ["pause"],
                "maxVolume": 40,
            }
        ],
    }
    rig.value = podview_music.project_owner("playback", payload("playback"), "account-alpha")[
        "data"
    ]
    rig.value["schema"] = "podconnect.playback.v2"
    rig.value["output"] = {
        "status": "observed",
        "reason": None,
        "binding": {
            "target_id": "device-one",
            "native_room_id": "r0",
            "homepod_id": "42",
            "binding_id": "b" * 64,
            "valid_until": time.time() + 5,
        },
    }
    rig.aggregate_hook = None
    old = rig.client

    async def receive(request):
        rig.calls.append((request.method, request.url.path, json.loads(request.content)))
        assert request.url.path.endswith("get_playback_snapshot")
        assert json.loads(request.content) == {
            "config_entry_id": "account-alpha",
            "include_output": True,
        }
        if rig.aggregate_hook:
            await rig.aggregate_hook()
        return httpx.Response(200, json={"service_response": copy.deepcopy(rig.value)})

    rig.router._client = rig.client = httpx.AsyncClient(transport=httpx.MockTransport(receive))
    await old.aclose()
    yield rig
    await rig.client.aclose()


async def read(rig):
    req = SimpleNamespace(
        app=rig.app,
        query=MultiDict(kind="playback", account="account-alpha"),
        remote="127.0.0.1",
        headers={},
        method="GET",
    )
    return json.loads((await _music(req)).body)


@pytest.mark.parametrize("state", ["playing", "paused"])
async def test_actual_aggregate_projects_without_command_read_or_grant(room_rig, state):
    rig = room_rig
    rig.value["playback"]["state"] = state
    expected = {k: copy.deepcopy(v) for k, v in rig.value.items() if k != "output"}
    expected["schema"] = "podconnect.playback.v1"
    body = await read(rig)
    assert set(body) == {
        "ok",
        "schema",
        "bootId",
        "roomId",
        "configEntryId",
        "status",
        "reason",
        "binding",
        "data",
    }
    assert body["schema"] == "podview.room-playback.v2"
    assert body["status"] == "observed" and body["reason"] is None
    assert body["data"] == expected
    assert set(body["binding"]) == {
        "roomId",
        "accountId",
        "targetId",
        "nativeRoomId",
        "nativeHomepodId",
        "bindingId",
        "validUntil",
    }
    assert body["binding"]["bindingId"] == "b" * 64
    assert len(rig.calls) == 1
    assert not rig.bridge._grants and not rig.bridge.controls.tasks


@pytest.mark.parametrize("reason", ["route_unavailable", "ambiguous_output", "owner_changed"])
async def test_account_metadata_survives_independent_output_failure(room_rig, reason):
    rig = room_rig
    rig.value["output"] = {"status": "unavailable", "reason": reason, "binding": None}
    body = await read(rig)
    assert body["status"] == "account_observed" and body["reason"] == reason
    assert body["binding"] is None and body["data"]["playback"]["item"]["name"] == "Song"


async def test_idle_is_account_fact_not_physical_release(room_rig):
    rig = room_rig
    rig.value["playback"] = {"state": "no_active_playback", "item": None, "target": None}
    rig.value["output"] = {"status": "unavailable", "reason": "route_unavailable", "binding": None}
    body = await read(rig)
    assert (body["status"], body["reason"], body["binding"]) == ("idle", None, None)
    assert body["data"]["playback"]["state"] == "no_active_playback"


@pytest.mark.parametrize(
    "change",
    [
        "foreign_account",
        "foreign_target",
        "extra",
        "secret_item",
        "bad_id",
        "nan_expiry",
        "bad_reason",
        "v1",
    ],
)
async def test_malformed_aggregate_never_leaks_metadata_or_authority(room_rig, change):
    rig = room_rig
    if change == "foreign_account":
        rig.value["config_entry_id"] = "other"
    elif change == "foreign_target":
        rig.value["output"]["binding"]["target_id"] = "other"
    elif change == "extra":
        rig.value["secret"] = "PRIVATE"
    elif change == "secret_item":
        rig.value["playback"]["item"]["secret"] = "PRIVATE"
    elif change == "bad_id":
        rig.value["output"]["binding"]["binding_id"] = "bad"
    elif change == "nan_expiry":
        rig.value["output"]["binding"]["valid_until"] = float("nan")
    elif change == "bad_reason":
        rig.value["output"] = {"status": "unavailable", "reason": "command_busy", "binding": None}
    else:
        rig.value["schema"] = "podconnect.playback.v1"
    body = await read(rig)
    assert body["status"] == "unavailable" and body["data"] is body["binding"] is None
    assert "PRIVATE" not in json.dumps(body)


@pytest.mark.parametrize("change", ["not_admitted", "duplicate_rule", "expired"])
async def test_valid_metadata_does_not_grant_unknown_output(room_rig, change):
    rig = room_rig
    if change == "not_admitted":
        rig.value["output"]["binding"]["native_room_id"] = "r9"
    elif change == "duplicate_rule":
        rig.bridge.controls.policy["music"] *= 2
    else:
        rig.value["output"]["binding"]["valid_until"] = time.time() - 1
    body = await read(rig)
    assert body["status"] == "account_observed" and body["binding"] is None
    assert body["reason"] == ("route_unavailable" if change == "expired" else "output_not_admitted")


async def test_external_alias_change_uses_actual_not_default_or_next(room_rig):
    rig = room_rig
    other = {
        **rig.bridge.controls.policy["music"][0],
        "nativeRoomId": "r1",
        "nativeHomepodId": "43",
        "default": False,
    }
    rig.bridge.controls.policy["music"][0]["default"] = True
    rig.bridge.controls.policy["music"].append(other)
    rig.value["output"]["binding"].update(native_room_id="r1", homepod_id="43", binding_id="c" * 64)
    body = await read(rig)
    assert body["binding"]["nativeRoomId"] == "r1" and body["binding"]["nativeHomepodId"] == "43"
    assert not rig.bridge._music_destinations
    assert (
        await expected_actual(rig.bridge, "kitchen", "account-alpha", "b" * 64, lambda: True)
        is None
    )
    assert (
        await expected_actual(rig.bridge, "kitchen", "account-alpha", "c" * 64, lambda: True)
        is not None
    )


@pytest.mark.parametrize("change", ["boot", "session", "policy", "tools", "revoked"])
async def test_late_owner_or_authority_change_cannot_publish(room_rig, change):
    rig = room_rig
    live = True

    async def mutate():
        nonlocal live
        if change == "boot":
            rig.bridge.boot_id = "new"
        elif change == "session":
            rig.bridge.sessions["kitchen"] = object()
        elif change == "policy":
            rig.bridge.controls.policy["music"][0]["maxVolume"] = 12
        elif change == "tools":
            rig.bridge.tools = object()
        else:
            live = False

    rig.aggregate_hook = mutate
    result = await resolve_actual(
        rig.bridge, "kitchen", "account-alpha", lambda: 1, current=lambda: live
    )
    assert result["status"] == "unavailable" and result["reason"] == "owner_changed"
    assert result["data"] is result["binding"] is None


async def test_cancelled_read_propagates_without_retry_or_effect(room_rig):
    rig = room_rig
    entered = asyncio.Event()

    async def hold():
        entered.set()
        await asyncio.Event().wait()

    rig.aggregate_hook = hold
    task = asyncio.create_task(read(rig))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(rig.calls) == 1 and not rig.bridge._grants


async def test_expired_original_metadata_is_stale_not_fresh_from_output(room_rig):
    from integration.test_podview_music import timestamp

    rig = room_rig
    rig.value["observation"]["observed_at"] = timestamp(-20)
    body = await read(rig)
    assert body["status"] == "unavailable" and body["reason"] == "stale_observation"
    assert body["data"] is body["binding"] is None


async def test_observation_proof_cannot_extend_original_account_expiry(room_rig):
    from integration.test_podview_music import timestamp

    rig = room_rig
    rig.value["observation"]["observed_at"] = timestamp(-14)
    body = await read(rig)
    assert body["status"] == "observed"
    assert time.time() < body["binding"]["validUntil"] < time.time() + 1.1


@pytest.mark.parametrize("field", ["target", "item"])
async def test_valid_nullable_account_fields_are_not_fabricated(room_rig, field):
    rig = room_rig
    rig.value["playback"][field] = None
    rig.value["output"] = {"status": "unavailable", "reason": "route_unavailable", "binding": None}
    body = await read(rig)
    assert body["status"] == "account_observed" and body["data"]["playback"][field] is None
    assert body["binding"] is None


async def test_policy_revocation_after_resolution_invalidates_retained_closure(room_rig):
    rig = room_rig
    result = await expected_actual(rig.bridge, "kitchen", "account-alpha", "b" * 64, lambda: True)
    assert result is not None and result["current"]()
    rig.bridge.controls.policy["music"] = []
    assert not result["current"]()


async def test_playback_failures_log_only_fixed_reasons(caplog, monkeypatch):
    import logging

    from gatekeeper import podview_room_media

    secret = "PRIVATE-TRACK-ACCOUNT-TOKEN"

    class Tools:
        async def podview_read(self, *args, **kwargs):
            if self.response == "raise":
                raise RuntimeError(secret)
            return self.response

    tools = Tools()
    controls = SimpleNamespace(policy={"roomId": "kitchen", "music": []}, music=object())
    bridge = SimpleNamespace(
        tools=tools, controls=controls, boot_id="boot", sessions={"kitchen": object()}
    )

    async def attempt():
        result = await resolve_actual(bridge, "kitchen", secret, lambda: "owner")
        assert result["status"] == "unavailable"
        assert result["reason"] == "account_unavailable"

    with caplog.at_level(logging.WARNING, logger="podvoice.podview"):
        tools.response = {"ok": False, "error_kind": "rate_limited", "private": secret}
        await attempt()
        tools.response = {"ok": False, "error_kind": secret}
        await attempt()
        tools.response = {"ok": True, "data": {"secret": secret}}
        monkeypatch.setattr(
            podview_room_media.podview_music,
            "project_playback_output",
            lambda *_: {"ok": False, "error_kind": "malformed_response"},
        )
        await attempt()
        tools.response = "raise"
        await attempt()

    assert "source=owner reason=rate_limited" in caplog.text
    assert "source=owner reason=unavailable" in caplog.text
    assert "source=projection reason=malformed_response" in caplog.text
    assert "source=exception reason=unavailable" in caplog.text
    assert secret not in caplog.text

    def broken_logger(*args, **kwargs):
        raise RuntimeError(secret)

    monkeypatch.setattr(podview_room_media._LOG, "warning", broken_logger)
    tools.response = {"ok": False, "error_kind": "rate_limited"}
    await attempt()
    tools.response = "raise"
    await attempt()
