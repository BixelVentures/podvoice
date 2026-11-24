"""Touch control policy parsing and closed voice ingress; no live home calls."""

import json
import time
from dataclasses import replace
from types import SimpleNamespace

import httpx
import pytest
from integration.test_cleaning_journal import bind
from integration.test_podview_bridge import owner
from integration.test_podview_music import payload as playback_payload
from unit.test_device_control import ROBOT, Rig

from gatekeeper.podview import PodViewBridge
from gatekeeper.podview_controls import TouchControls, policy
from gatekeeper.podview_music import project_owner

ACTUAL_BINDING_ID = "b" * 64


def actual_playback_response(request, *, target="speaker", homepod="42", item_uri=None, poll=4):
    """Explicit Control aggregate fixture, independent of PodView policy/defaults."""
    assert json.loads(request.content) == {"config_entry_id": "account", "include_output": True}
    source = playback_payload("playback", "account")
    source["poll_sequence"] = poll
    source["playback"]["target"]["target_id"] = target
    if item_uri is not None:
        source["playback"]["item"]["uri"] = item_uri
    projected = project_owner("playback", source, "account")
    assert projected["ok"]
    value = {
        **projected["data"],
        "schema": "podconnect.playback.v2",
        "output": {
            "status": "observed",
            "reason": None,
            "binding": {
                "target_id": target,
                "native_room_id": "native-room",
                "homepod_id": homepod,
                "binding_id": ACTUAL_BINDING_ID,
                "valid_until": time.time() + 5,
            },
        },
    }
    return httpx.Response(200, json={"service_response": value})


def config():
    return {
        "roomId": "kitchen",
        "music": [
            {
                "accountId": "account",
                "targetId": "speaker",
                "actions": ["pause", "volume"],
                "maxVolume": 40,
            }
        ],
        "vacuum": [{"entityId": ROBOT, "actions": ["settings", "start", "reuse"]}],
    }


@pytest.fixture
async def fixture(tmp_path):
    rig = Rig()
    original_client = rig.client

    async def routed(request):
        if request.url.path.endswith("/get_playback_snapshot"):
            if getattr(rig, "playback_hook", None) is not None:
                await rig.playback_hook()
            return actual_playback_response(request)
        return await rig.request(request)

    rig.client = httpx.AsyncClient(transport=httpx.MockTransport(routed))
    bind(rig, tmp_path / "history.json")
    rig.router._client = rig.client
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services | {"get_playback_snapshot"},
    )
    session, _ = owner()
    configured = config()
    configured["music"][0].update(nativeRoomId="native-room", nativeHomepodId="42")
    bridge = PodViewBridge({"kitchen": session}, rig.router, control_policy=json.dumps(configured))
    yield rig, bridge
    await rig.client.aclose()
    await original_client.aclose()


@pytest.mark.parametrize(
    "change",
    ["empty", "extra", "wrongdomain", "duplicated", "booleanvolume", "wildcard", "missingroom"],
)
def test_admin_policy_is_closed(change):
    data = config()
    if change == "empty":
        assert policy("") == {}
        return
    if change == "extra":
        data["admin"] = True
    if change == "wrongdomain":
        data["music"][0]["actions"] = ["turn_on"]
    if change == "duplicated":
        data["music"] *= 2
    if change == "booleanvolume":
        data["music"][0]["maxVolume"] = True
    if change == "wildcard":
        data["vacuum"][0]["entityId"] = "*"
    if change == "missingroom":
        del data["roomId"]
    assert policy(json.dumps(data)) == {}


def test_native_room_binding_is_additive_and_legacy_transport_survives():
    original = config()
    original["music"][0]["actions"] = ["pause", "resume", "play_track"]
    # Legacy configuration still parses, but cannot authorize a native track start.
    assert policy(json.dumps(original)) == original
    updated = config()
    updated["music"][0].update(
        actions=["play_track"],
        nativeRoomId="native-stable-room",
        nativeHomepodId="homepod-stable-id",
    )
    assert policy(json.dumps(updated)) == updated
    for field, value in (("nativeRoomId", ""), ("nativeHomepodId", True)):
        malformed = config()
        malformed["music"][0].update(nativeRoomId="native-room", nativeHomepodId="homepod-id")
        malformed["music"][0][field] = value
        assert policy(json.dumps(malformed)) == {}
    partial = config()
    partial["music"][0]["nativeRoomId"] = "native-room"
    assert policy(json.dumps(partial)) == {}


def test_legacy_track_rule_does_not_open_selection_without_native_binding():
    tools = object()
    bridge = SimpleNamespace(
        tools=tools,
        _grant_current=lambda room, token: token == "grant",
        _music_move_fence=set(),
    )
    music = SimpleNamespace(tools=tools, track_available=True, room_start_available=True)
    original = config()
    original["music"][0]["actions"] = ["pause", "play_track"]
    controls = TouchControls(bridge, json.dumps(original), music)
    assert not controls.selection_allowed("kitchen", "grant")
    original["music"][0].update(nativeRoomId="native-room", nativeHomepodId="homepod-id")
    controls = TouchControls(bridge, json.dumps(original), music)
    assert controls.selection_allowed("kitchen", "grant")
    assert not controls.selection_allowed("kitchen", "revoked")


def test_room_start_and_queue_ingress_stay_closed_until_native_contract(fixture):
    _, bridge = fixture
    bridge.controls.policy["music"][0]["actions"] += ["play_track", "play_queue_occurrence"]
    assert bridge.controls.music.room_start_available is False
    assert not bridge.voice_music_available()
    assert not bridge.queue.available
