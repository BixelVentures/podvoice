"""Shared rig: two configured PodView rooms with a native destination proof (no tests here)."""

import copy
import time
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest
from integration.test_podview_music_selection import rig as music_rig  # noqa: F401
from unit.test_podview_speakers import payload

from gatekeeper import podview_speakers
from gatekeeper.podview import BRIDGE


@pytest.fixture
async def destination_rig(music_rig, monkeypatch):  # noqa: F811
    rig = music_rig
    bridge = rig.app[BRIDGE]
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services | {"get_targets"},
    )
    reads = rig.router.podview_music_reads
    monkeypatch.setattr(rig.router, "podview_music_reads", lambda: [*reads(), "targets"])
    original = bridge.controls.policy["music"][0]
    original.update(nativeRoomId="r0", nativeHomepodId="42", default=True)
    alternate = {**original, "nativeRoomId": "r1", "nativeHomepodId": "43", "default": False}
    bridge.controls.policy["music"].append(alternate)
    native = payload()
    native["config_entry_id"] = "account-alpha"
    read = AsyncMock(side_effect=lambda *_args: copy.deepcopy(native))
    monkeypatch.setattr(podview_speakers, "read_service", read)
    speaker = podview_speakers.project(
        native, boot=bridge.boot_id, room="kitchen", account="account-alpha", default_room=None
    )["speakers"][1]
    controls = bridge.controls.music.setup_track.return_value["data"]
    controls.update(room_id="r1", homepod_id="43")
    controls["start_offer"]["native_incarnation"] = "a" * 32
    proof = {
        "native": {
            "room_id": "r1",
            "homepod_id": "43",
            "target_id": "device-one",
            "alias_incarnation": "a" * 32,
            "alias_registry": "b" * 64,
        },
        "route": {"device_id": "43"},
        "owner_epoch": "a" * 32,
        "poll_sequence": 4,
        "valid_until": time.time() + 60,
    }
    bridge.controls.music.observe_room = AsyncMock(return_value={"ok": True, "data": proof})
    yield rig, bridge, native, speaker, read, proof
