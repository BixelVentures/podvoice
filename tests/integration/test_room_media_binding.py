"""Actual ingress and Control aggregate: metadata is independent of command grants."""

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
