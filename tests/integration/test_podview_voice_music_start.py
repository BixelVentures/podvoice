"""A12: voice "play calm music in the kitchen" starts through PodView's room START.

Field log 12 Nov 09:47: HassMediaSearchAndPlay(name="Køkkenalrum HomePod") failed
with unresolved_target because HA has no media_player of that name; the room is a
PodConnect configured alias that only PodView's own start path knows.
"""

from dataclasses import replace
from unittest.mock import AsyncMock

import pytest
from integration.test_podview_idle_destination import destination_rig  # noqa: F401
from integration.test_podview_music_selection import rig as music_rig  # noqa: F401

from gatekeeper.execution_policy import ExecutionContext
from gatekeeper.tools import _CanonicalEntity

CONTEXT = ExecutionContext("voice-session", "turn-1", "live")


def _expose_media_intent(router):
    declaration = {
        "name": "HassMediaSearchAndPlay",
        "description": "Search and play media",
        "parameters": {"type": "object"},
    }
    router._discovery = replace(
        router._discovery,
        mcp_tools=(declaration,),
        mcp_names=frozenset({"HassMediaSearchAndPlay"}),
        retry_state="ready",
        last_error=None,
    )


@pytest.fixture
def voice(destination_rig):  # noqa: F811
    rig, bridge, *_ = destination_rig
    _expose_media_intent(rig.router)
    assert rig.router._podview_music_owner is bridge
    return rig, bridge


@pytest.mark.parametrize(
    "spoken", ["Køkkenalrum HomePod", "køkkenet", "Køkken", "KØKKENALRUM", "i køkkenet"]
)
async def test_room_name_aliases_start_through_podview_room_start(voice, spoken):
    rig, bridge = voice
    facade = bridge.controls.music
    result = await rig.router.dispatch(
        "HassMediaSearchAndPlay",
        {"search_query": "rolig musik", "name": spoken},
        execution_context=CONTEXT,
    )
    assert result["ok"] is True, result
    assert result["data"]["room"] == "Køkkenalrum"
    assert result["data"]["path"] == "podview_room_start"
    assert result["data"]["account_id"] == "account-alpha"
    # The exact configured default room row: same account, engine and HomePod as touch.
    args = facade.setup_track.await_args.args
    assert args[:4] == ("account-alpha", "device-one", "r0", "42")
    sent = facade.execute_track.await_args.args
    assert sent[1] == "spotify:track:" + "0" * 22
    assert sent[2] == 40  # the policy row's max volume, as for a PodView card
    assert any(call[1].endswith("/search_tracks") for call in rig.calls)
    assert not bridge.music_selection.tasks
    assert ("music",) not in bridge.controls.busy


async def test_other_configured_room_uses_destination_start(voice):
    rig, bridge = voice
    facade = bridge.controls.music
    result = await rig.router.dispatch(
        "HassMediaSearchAndPlay",
        {"search_query": "rolig musik", "name": "soveværelset"},
        execution_context=CONTEXT,
    )
    assert facade.setup_track.await_args.args[:4] == ("account-alpha", "device-one", "r1", "43")
    facade.execute_track.assert_awaited_once()
    assert result["data"]["room"] == "Soveværelse"
    assert not bridge.music_selection.tasks


async def test_no_room_uses_this_walls_configured_room(voice):
    rig, bridge = voice
    result = await rig.router.dispatch(
        "HassMediaSearchAndPlay", {"search_query": "jazz"}, execution_context=CONTEXT
    )
    assert result["ok"] is True
    assert bridge.controls.music.setup_track.await_args.args[2:4] == ("r0", "42")


async def test_unknown_room_is_a_clear_danish_refusal_and_sends_nothing(voice):
    rig, bridge = voice
    result = await rig.router.dispatch(
        "HassMediaSearchAndPlay",
        {"search_query": "rolig musik", "name": "Garagen"},
        execution_context=CONTEXT,
    )
    assert result["ok"] is False
    assert result["error_kind"] == "unknown_room"
    assert result["error"] == (
        "Jeg kender ikke rummet 'Garagen'. PodView kan spille musik i: Køkkenalrum, Soveværelse."
    )
    assert result["known_rooms"] == ["Køkkenalrum", "Soveværelse"]
    bridge.controls.music.setup_track.assert_not_awaited()
    bridge.controls.music.execute_track.assert_not_awaited()
    assert not any(call[1].endswith("/search_tracks") for call in rig.calls)


async def test_room_without_start_permission_is_refused_before_search(voice):
    rig, bridge = voice
    bridge.controls.policy["music"][1]["actions"] = ["move_existing_session"]
    result = await rig.router.dispatch(
        "HassMediaSearchAndPlay",
        {"search_query": "rolig musik", "name": "Soveværelse"},
        execution_context=CONTEXT,
    )
    assert result["error_kind"] == "target_not_granted"
    assert "Soveværelse" in result["error"]
    bridge.controls.music.execute_track.assert_not_awaited()


def _room_speaker_entity(native, target="device-one"):
    """Control's HA context for the room setup's own Spotify target (Green 12 Nov)."""
    native["targets"].append(
        {
            "kind": "spotify_device",
            "target_id": target,
            "name": "Køkkenalrum HomePod",
            "restricted": False,
            "ha_context": {
                "entity_id": "media_player.podconnect_test",
                "name": "Køkkenalrum HomePod",
                "aliases": [],
                "area": {"id": "kokkenalrum", "name": "Køkkenalrum", "aliases": []},
            },
        }
    )


@pytest.fixture
def voice_entity(destination_rig):  # noqa: F811
    rig, bridge, native, *_ = destination_rig
    _expose_media_intent(rig.router)
    _room_speaker_entity(native)
    return rig, bridge


async def test_rooms_exact_speaker_entity_starts_through_podview_room_start(voice_entity):
    rig, bridge = voice_entity
    result = await rig.router.dispatch(
        "HassMediaSearchAndPlay",
        {"search_query": "rolig musik", "name": "media_player.podconnect_test"},
        execution_context=CONTEXT,
    )
    assert result["ok"] is True, result
    assert result["data"]["path"] == "podview_room_start"
    assert result["data"]["room"] == "Køkkenalrum"
    # The room setup's default row, exactly as "spil musik" without a room name.
    assert bridge.controls.music.setup_track.await_args.args[:4] == (
        "account-alpha",
        "device-one",
        "r0",
        "42",
    )
    bridge.controls.music.execute_track.assert_awaited_once()


async def test_rooms_speaker_ha_friendly_name_starts_through_podview(voice_entity, monkeypatch):
    rig, bridge = voice_entity
    entity = _CanonicalEntity(
        "media_player.podconnect_test", "media_player", "idle", {"friendly_name": "Køkken HP"}
    )
    monkeypatch.setattr(rig.router, "_resolve_entity", AsyncMock(return_value=entity))
    result = await rig.router.dispatch(
        "HassMediaSearchAndPlay",
        {"search_query": "rolig musik", "name": "Køkken HP"},
        execution_context=CONTEXT,
    )
    assert result["ok"] is True, result
    assert result["data"]["path"] == "podview_room_start"
    assert bridge.controls.music.setup_track.await_args.args[2:4] == ("r0", "42")


async def test_exact_ha_media_player_outside_the_room_setup_stays_generic(voice_entity):
    rig, bridge = voice_entity
    result = await rig.router.dispatch(
        "HassMediaSearchAndPlay",
        {"search_query": "rolig musik", "name": "media_player.stuen"},
        execution_context=CONTEXT,
    )
    assert result.get("error_kind") != "unknown_room"
    assert result.get("data", {}).get("path") != "podview_room_start"
    bridge.controls.music.setup_track.assert_not_awaited()


async def test_other_targets_entity_is_not_this_rooms_speaker(destination_rig):  # noqa: F811
    rig, bridge, native, *_ = destination_rig
    _expose_media_intent(rig.router)
    _room_speaker_entity(native, target="device-other")
    result = await rig.router.dispatch(
        "HassMediaSearchAndPlay",
        {"search_query": "rolig musik", "name": "media_player.podconnect_test"},
        execution_context=CONTEXT,
    )
    assert result.get("data", {}).get("path") != "podview_room_start"
    bridge.controls.music.setup_track.assert_not_awaited()
