"""Shared music rig: an owner-backed room with one configured music row (no tests here)."""

from dataclasses import replace
from unittest.mock import AsyncMock

import pytest
from integration.test_podview_music import Rig

from gatekeeper.podview import BRIDGE


@pytest.fixture
async def rig():
    value = Rig()
    services = value.router._discovery.podconnect_services | {
        "search_tracks",
        "get_playback_controls",
        "get_room_content_controls",
        "prepare_room_selected_content",
        "start_room_selected_content",
        "cancel_room_content_preparation",
    }
    value.router._discovery = replace(value.router._discovery, podconnect_services=services)
    bridge = value.app[BRIDGE]
    bridge.controls.policy = {
        "roomId": "kitchen",
        "vacuum": [],
        "music": [
            {
                "accountId": "account-alpha",
                "targetId": "device-one",
                "actions": ["play_track"],
                "maxVolume": 40,
                "nativeRoomId": "native-room",
                "nativeHomepodId": "homepod-id",
            }
        ],
    }
    facade = bridge.controls.music
    facade.setup_track = AsyncMock(
        return_value={
            "ok": True,
            "data": {
                "ok": True,
                "schema": "podconnect.room_content_controls.v1",
                "config_entry_id": "account-alpha",
                "owner_epoch": "a" * 32,
                "poll_sequence": 4,
                "next_command_sequence": 1,
                "target": {"kind": "spotify_device", "target_id": "device-one"},
                "room_id": "native-room",
                "homepod_id": "homepod-id",
                "actions": ["play_track"],
                "start_offer": {
                    "schema": "podconnect.room_content_offer.v1",
                    "offer_id": "a" * 32,
                    "binding_id": "b" * 64,
                    "native_incarnation": "c" * 32,
                    "policy_revision": "d" * 64,
                    "start_volume_percent": 35,
                    "expires_after_ms": 5000,
                },
                "status": "ready",
                "valid_until": 9999999999,
                "physical_result_verified": False,
            },
        }
    )
    facade.execute_track = AsyncMock(
        return_value={"outcome": "accepted", "accepted_selected_content": True}
    )
    yield value
    await value.client.aclose()
