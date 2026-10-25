"""Actual ToolRouter read transport and current grants for passive v3 controls."""

import asyncio
import copy
import json
import time
from dataclasses import replace
from datetime import datetime

import httpx
import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_music import Rig, payload, timestamp

from gatekeeper import podview_music
from gatekeeper.podview import BRIDGE
from gatekeeper.podview_room_media import read_playback


@pytest.fixture
async def controls_rig():
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
                "actions": ["pause", "resume", "next", "previous", "volume"],
                "maxVolume": 20,
            }
        ],
    }
    rig.value = podview_music.project_owner("playback", payload("playback"), "account-alpha")[
        "data"
    ]
    rig.value["schema"] = "podconnect.playback.v3"
    until = time.time() + 5
    rig.value["output"] = {
        "status": "observed",
        "reason": None,
        "binding": {
            "target_id": "device-one",
            "native_room_id": "r0",
            "homepod_id": "42",
            "binding_id": "b" * 64,
            "valid_until": until,
        },
    }
    rig.value["controls"] = {
        "status": "observed",
        "reason": None,
        "binding_id": "b" * 64,
        "valid_until": until,
        "supported_actions": ["pause", "resume", "next", "previous", "volume"],
        "volume": {"base_percent": 27, "effective_percent": 10},
    }
    rig.token = rig.bridge.grant_timer_control("kitchen")
    rig.owner_binding = rig.router.podview_music_binding
    rig.aggregate_hook = None
    old = rig.client

    async def receive(request):
        body = json.loads(request.content)
        rig.calls.append((request.method, request.url.path, body))
        assert request.headers["Authorization"] == "Bearer server-only"
        assert request.url.path.endswith("get_playback_snapshot")
        assert body == {
            "config_entry_id": "account-alpha",
            "include_output": True,
            "include_controls": True,
        }
        if rig.aggregate_hook:
            await rig.aggregate_hook()
        return httpx.Response(200, json={"service_response": copy.deepcopy(rig.value)})

    rig.router._client = rig.client = httpx.AsyncClient(transport=httpx.MockTransport(receive))
    await old.aclose()
    yield rig
    await rig.client.aclose()


async def read(rig, *, token=None):
    response = await read_playback(
        rig.bridge,
        "kitchen",
        "account-alpha",
        rig.owner_binding,
        include_controls=True,
        token=rig.token if token is None else token,
    )
    assert response.headers["Cache-Control"] == "no-store"
    return json.loads(response.body)


def assert_passive(rig):
    assert len(rig.calls) == 1
    assert not rig.bridge.controls.tasks
    assert not rig.bridge.music_selection.tasks
    assert not rig.bridge.queue.tasks
    assert not rig.router._refresh_podconnect_services.await_count
    assert not rig.session.tools.timers.command.await_count


def assert_no_control(body):
    assert body["controls"] == {
        "status": "unavailable",
        "reason": "control_not_granted",
        "binding_id": None,
        "valid_until": None,
        "supported_actions": [],
        "volume": None,
    }
    assert body["permissions"] == {"actions": [], "maxVolume": None}


@pytest.mark.parametrize("maximum,actual", [(20, 27), (40, 100)])
async def test_v3_exact_public_projection_has_actual_volume_and_no_executable_offer(
    controls_rig, maximum, actual
):
    rig = controls_rig
    rig.bridge.controls.policy["music"][0]["maxVolume"] = maximum
    rig.value["controls"]["volume"]["base_percent"] = actual
    grant = rig.bridge._grant_for_token("kitchen", rig.token)
    grants = dict(rig.bridge._grants)
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
        "controls",
        "permissions",
    }
    assert body["schema"] == "podview.room-playback.v3"
    expected = {
        k: copy.deepcopy(v) for k, v in rig.value.items() if k not in {"output", "controls"}
    }
    expected["schema"] = "podconnect.playback.v1"
    assert body["data"] == expected
    assert body["status"] == "observed" and body["reason"] is None
    controls = body["controls"]
    assert set(controls) == {
        "status",
        "reason",
        "binding_id",
        "valid_until",
        "supported_actions",
        "volume",
    }
    assert (controls["status"], controls["reason"]) == ("observed", None)
    assert controls["binding_id"] == body["binding"]["bindingId"] == "b" * 64
    assert time.time() < controls["valid_until"] <= body["binding"]["validUntil"]
    assert controls["valid_until"] <= rig.value["controls"]["valid_until"]
    assert controls["volume"] == {"base_percent": actual, "effective_percent": 10}
    assert set(body["permissions"]) == {"actions", "maxVolume"}
    assert body["permissions"]["maxVolume"] == maximum
    assert set(body["permissions"]["actions"]) == {"pause", "resume", "next", "previous", "volume"}
    assert controls["supported_actions"] == body["permissions"]["actions"]
    assert rig.bridge._grant_for_token("kitchen", rig.token) is grant
    assert rig.bridge._grants == grants
    assert rig.token not in json.dumps(body) and "SECRET" not in json.dumps(body)
    assert_passive(rig)


@pytest.mark.parametrize(
    "policy,source,expected",
    [
        (["pause", "volume"], ["pause", "next", "volume"], {"pause", "volume"}),
        (["pause", "next", "volume"], ["next"], {"next"}),
        (["pause"], ["next", "volume"], set()),
    ],
)
async def test_permissions_intersect_exact_rule_and_source_capabilities(
    controls_rig, policy, source, expected
):
    rig = controls_rig
    rig.bridge.controls.policy["music"][0]["actions"] = policy
    rig.value["controls"]["supported_actions"] = source
    body = await read(rig)
    assert set(body["controls"]["supported_actions"]) == expected
    assert set(body["permissions"]["actions"]) == expected
    assert body["permissions"]["maxVolume"] == (20 if "volume" in expected else None)
    assert body["controls"]["volume"] == {"base_percent": 27, "effective_percent": 10}
    assert_passive(rig)


async def test_rule_without_volume_retains_actual_volume_without_ceiling(controls_rig):
    rig = controls_rig
    rig.bridge.controls.policy["music"][0]["actions"] = ["pause"]
    body = await read(rig)
    assert body["permissions"] == {"actions": ["pause"], "maxVolume": None}
    assert body["controls"]["supported_actions"] == ["pause"]
    assert body["controls"]["volume"] == {"base_percent": 27, "effective_percent": 10}
    assert_passive(rig)


async def test_volume_unavailable_retains_allowed_transport_action(controls_rig):
    rig = controls_rig
    rig.value["controls"].update(
        reason="volume_unavailable", volume=None, supported_actions=["pause"]
    )
    body = await read(rig)
    assert body["controls"]["status"] == "observed"
    assert body["controls"]["reason"] == "volume_unavailable"
    assert body["controls"]["volume"] is None
    assert body["controls"]["supported_actions"] == ["pause"]
    assert body["permissions"] == {"actions": ["pause"], "maxVolume": None}
    assert_passive(rig)


@pytest.mark.parametrize("change", ["missing", "unknown", "expired", "replaced"])
async def test_invalid_current_grant_redacts_controls_but_retains_metadata(controls_rig, change):
    rig = controls_rig
    token = rig.token
    if change == "missing":
        token = ""
    elif change == "unknown":
        token = "unknown-controller"
    elif change == "expired":
        grant = rig.bridge._grants["kitchen"]
        rig.bridge._grants["kitchen"] = (*grant[:-1], time.monotonic() - 1)
    else:
        rig.bridge.grant_timer_control("kitchen")
    grants = dict(rig.bridge._grants)
    body = await read(rig, token=token)
    assert body["status"] == "observed" and body["data"]["playback"]["item"]["name"] == "Song"
    assert_no_control(body)
    assert rig.bridge._grants == grants
    assert_passive(rig)


@pytest.mark.parametrize("change", ["replacement", "equivalent_replacement", "expiry"])
async def test_grant_identity_and_expiry_are_rechecked_after_await(controls_rig, change):
    rig = controls_rig

    async def mutate():
        if change == "replacement":
            rig.bridge.grant_timer_control("kitchen")
        else:
            grant = rig.bridge._grants["kitchen"]
            rig.bridge._grants["kitchen"] = (
                tuple(list(grant))
                if change == "equivalent_replacement"
                else (*grant[:-1], time.monotonic() - 1)
            )

    rig.aggregate_hook = mutate
    body = await read(rig)
    assert body["data"]["playback"]["item"]["name"] == "Song"
    assert_no_control(body)
    assert_passive(rig)


@pytest.mark.parametrize(
    "change",
    [
        "foreign_account",
        "foreign_target",
        "foreign_binding",
        "aggregate_extra",
        "control_extra",
        "control_token",
        "control_sequence",
        "unknown_action",
        "duplicate_action",
        "bad_volume",
        "missing_volume",
        "extended_deadline",
    ],
)
async def test_malformed_control_aggregate_cannot_publish_metadata_or_authority(
    controls_rig, change
):
    rig = controls_rig
    controls = rig.value["controls"]
    if change == "foreign_account":
        rig.value["config_entry_id"] = "other"
    elif change == "foreign_target":
        rig.value["output"]["binding"]["target_id"] = "other"
    elif change == "foreign_binding":
        controls["binding_id"] = "c" * 64
    elif change == "aggregate_extra":
        rig.value["private"] = "PRIVATE"
    elif change in {"control_extra", "control_token", "control_sequence"}:
        key = {
            "control_extra": "extra",
            "control_token": "token",
            "control_sequence": "next_command_sequence",
        }[change]
        controls[key] = "PRIVATE"
    elif change == "unknown_action":
        controls["supported_actions"] = ["prepare"]
    elif change == "duplicate_action":
        controls["supported_actions"] = ["pause", "pause"]
    elif change == "bad_volume":
        controls["volume"]["base_percent"] = True
    elif change == "missing_volume":
        controls["volume"].pop("effective_percent")
    else:
        controls["valid_until"] += 1
    body = await read(rig)
    assert body["status"] == "unavailable"
    assert body["data"] is body["binding"] is None
    assert body["controls"]["volume"] is None
    assert body["permissions"] == {"actions": [], "maxVolume": None}
    assert "PRIVATE" not in json.dumps(body)
    assert_passive(rig)


@pytest.mark.parametrize(
    "change", ["source_bound", "renewed_source_bound", "expired_source", "expired_controls"]
)
async def test_control_freshness_cannot_renew_original_source_or_control_deadline(
    controls_rig, change
):
    rig = controls_rig
    if change == "expired_controls":
        rig.value["controls"]["valid_until"] = time.time() - 1
    else:
        rig.value["observation"]["observed_at"] = timestamp(
            -20 if change == "expired_source" else -14
        )
        if change == "source_bound":
            source_until = (
                datetime.fromisoformat(rig.value["observation"]["observed_at"]).timestamp() + 15
            )
            rig.value["output"]["binding"]["valid_until"] = source_until
            rig.value["controls"]["valid_until"] = source_until
    body = await read(rig)
    if change == "source_bound":
        source_until = (
            datetime.fromisoformat(rig.value["observation"]["observed_at"]).timestamp() + 15
        )
        assert body["status"] == "observed"
        assert time.time() < body["controls"]["valid_until"] <= source_until
        assert body["binding"]["validUntil"] <= source_until
    else:
        assert body["controls"]["volume"] is None
        assert body["controls"]["supported_actions"] == []
        assert body["permissions"] == {"actions": [], "maxVolume": None}
        if change == "expired_source":
            assert body["status"] == "unavailable" and body["reason"] == "stale_observation"
            assert body["data"] is None
    assert_passive(rig)


@pytest.mark.parametrize(
    "change",
    ["boot", "session", "policy", "policy_identity", "tools", "music_owner", "source_owner"],
)
async def test_late_owner_or_policy_change_cannot_publish_scoped_facts(controls_rig, change):
    rig = controls_rig

    async def mutate():
        if change == "boot":
            rig.bridge.boot_id = "new"
        elif change == "session":
            rig.bridge.sessions["kitchen"] = object()
        elif change == "policy":
            rig.bridge.controls.policy["music"][0]["maxVolume"] = 12
        elif change == "policy_identity":
            rig.bridge.controls.policy = copy.deepcopy(rig.bridge.controls.policy)
        elif change == "tools":
            rig.bridge.tools = object()
        elif change == "music_owner":
            rig.bridge.controls.music = object()
        else:
            rig.router._discovery = replace(rig.router._discovery)

    rig.aggregate_hook = mutate
    body = await read(rig)
    assert body["status"] == "unavailable" and body["reason"] == "owner_changed"
    assert body["data"] is body["binding"] is None
    assert body["controls"]["volume"] is None
    assert body["permissions"] == {"actions": [], "maxVolume": None}
    assert_passive(rig)


async def test_cancelled_control_read_propagates_without_retry_or_effect(controls_rig):
    rig = controls_rig
    entered = asyncio.Event()
    grants = dict(rig.bridge._grants)

    async def hold():
        entered.set()
        await asyncio.Event().wait()

    rig.aggregate_hook = hold
    task = asyncio.create_task(read(rig))
    await asyncio.wait_for(entered.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert rig.bridge._grants == grants
    assert_passive(rig)


@pytest.mark.parametrize("paired", [True, False])
async def test_actual_music_http_opt_in_forwards_current_cookie_and_one_ha_read(
    controls_rig, paired
):
    rig = controls_rig
    grants = dict(rig.bridge._grants)
    headers = {"Cookie": f"podview_control={rig.token}"} if paired else {}
    async with TestClient(TestServer(rig.app)) as client:
        response = await client.get(
            "/view/api/music?kind=playback&account=account-alpha&room=kitchen&include_controls=1",
            headers=headers,
        )
        assert response.status == 200
        assert response.headers["Cache-Control"] == "no-store"
        assert "Set-Cookie" not in response.headers
        body = await response.json()
    assert body["schema"] == "podview.room-playback.v3"
    assert body["data"]["schema"] == "podconnect.playback.v1"
    assert body["data"]["playback"]["item"]["name"] == "Song"
    if paired:
        assert body["controls"]["volume"] == {"base_percent": 27, "effective_percent": 10}
        assert body["permissions"]["maxVolume"] == 20
        assert "volume" in body["permissions"]["actions"]
    else:
        assert_no_control(body)
    assert rig.bridge._grants == grants
    assert_passive(rig)


@pytest.mark.parametrize(
    "query",
    [
        "kind=playback&account=account-alpha&include_controls=1&include_controls=1",
        "kind=playback&account=account-alpha&include_controls=0",
        "kind=playback&account=account-alpha&include_controls=true",
        "kind=playback&account=account-alpha&include_controls=",
        "kind=queue&account=account-alpha&include_controls=1",
        "kind=playback&account=account-alpha&include_controls=1&unexpected=1",
        "kind=playback&account=account-alpha&include_controls=1&token=PRIVATE",
        "kind=playback&account=account-alpha&include_controls=1&command_sequence=1",
        "kind=playback&kind=playback&account=account-alpha&include_controls=1",
        "kind=playback&account=account-alpha&account=account-alpha&include_controls=1",
        "kind=playback&account=account-alpha&room=kitchen&room=kitchen&include_controls=1",
        "kind=playback&include_controls=1",
    ],
)
async def test_actual_music_http_rejects_invalid_opt_in_without_ha_read(controls_rig, query):
    rig = controls_rig
    grants = dict(rig.bridge._grants)
    async with TestClient(TestServer(rig.app)) as client:
        response = await client.get(
            f"/view/api/music?{query}", headers={"Cookie": f"podview_control={rig.token}"}
        )
        assert response.status == 400
        body = await response.json()
        assert body == {"ok": False, "error": "invalid_query", "retryAllowed": False}
        assert "Set-Cookie" not in response.headers
    assert not rig.calls and not rig.bridge.controls.tasks
    assert not rig.bridge.queue.tasks and not rig.bridge.music_selection.tasks
    assert rig.bridge._grants == grants
    assert not rig.session.tools.timers.command.await_count
