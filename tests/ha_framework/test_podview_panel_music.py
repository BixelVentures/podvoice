"""The panel's music services (queue, room move, radio) registered in a real HA core."""

import unittest
from unittest.mock import patch

import test_controller_admin_services as fixture
from custom_components.podvoice import music_bridge
from homeassistant.core import State, SupportsResponse
from homeassistant.exceptions import ServiceValidationError

ENTRY = "podconnect-entry"
OPTION = "a" * 24
URI = "spotify:track:" + "A" * 22
ROOMS = {"media_player.kokken": "kitchen", "media_player.stue": "living"}


class PodViewPanelMusicTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await fixture.ControllerAdminServiceFrameworkTests.asyncSetUp(self)
        self.calls = []
        for name, answer in {
            "get_playback_snapshot": {
                "output": {
                    "status": "observed",
                    "binding": {
                        "target_id": "engine",
                        "native_room_id": "kitchen",
                        "homepod_id": "hp1",
                    },
                }
            },
            "get_room_queue_controls": {
                "ok": True,
                "config_entry_id": ENTRY,
                "owner_epoch": "epoch",
                "poll_sequence": 3,
                "next_command_sequence": 5,
                "queue": {"observation_id": "c" * 32, "session_id": "s", "queue_revision": 1},
                "native": {},
                "route": {},
                "actions": ["play_queue_occurrence"],
                "truncated": False,
                "items": [
                    {
                        "option_id": OPTION,
                        "index": 0,
                        "uri": URI,
                        "name": "Holocene",
                        "artist": "Bon Iver",
                    }
                ],
            },
            "prepare_room_queue": {"ok": True, "prepare_id": "d" * 32, "request_id": "epoch:5"},
            "control_room_queue": {"ok": True, "outcome": "accepted"},
            "move_playback": {"kind": "configured_alias"},
        }.items():
            self.hass.services.async_register(
                "podconnect",
                name,
                self.answer(name, answer),
                supports_response=SupportsResponse.ONLY,
            )
        self.hass.states.async_set(
            "media_player.kokken",
            "playing",
            {"podconnect_source": "spotify", "podconnect_account": "own"},
        )
        self.hass.states.async_set("media_player.stue", "idle", {})

        def room_of(hass, entity_id):
            if entity_id not in ROOMS:
                return None
            return music_bridge.Room(entity_id, ENTRY, ROOMS[entity_id], hass.states.get(entity_id))

        # The registry lookup itself is unit-tested; here the rooms are given so the services run end to end.
        patcher = patch.object(music_bridge, "room_of", room_of)
        patcher.start()
        self.addCleanup(patcher.stop)

    def answer(self, name, value):
        async def handler(call):
            self.calls.append((name, dict(call.data)))
            return value

        return handler

    async def call(self, service, data):
        return await self.hass.services.async_call(
            "podvoice", service, data, blocking=True, return_response=True
        )

    async def test_services_are_registered_with_responses(self):
        for name in (
            "music_queue",
            "music_queue_play",
            "music_move",
            "radio_state",
            "radio_command",
        ):
            self.assertTrue(self.hass.services.has_service("podvoice", name), name)

    async def test_queue_and_choice_reach_podconnect_once(self):
        queue = await self.call("music_queue", {"entity_id": "media_player.kokken"})
        self.assertEqual(queue["status"], "ready")
        self.assertEqual(queue["items"][0]["title"], "Holocene")
        result = await self.call(
            "music_queue_play",
            {"entity_id": "media_player.kokken", "option_id": OPTION, "uri": URI},
        )
        self.assertEqual(result, {"ok": True, "outcome": "accepted"})
        self.assertEqual([name for name, _ in self.calls].count("control_room_queue"), 1)

    async def test_move_and_the_other_account_guard(self):
        moved = await self.call(
            "music_move",
            {"entity_id": "media_player.kokken", "target_entity_id": "media_player.stue"},
        )
        self.assertEqual(moved, {"ok": True, "outcome": "accepted"})
        self.assertEqual(
            self.calls[-1],
            (
                "move_playback",
                {"config_entry_id": ENTRY, "kind": "configured_alias", "target_id": "living"},
            ),
        )
        self.hass.states.async_set(
            "media_player.kokken", "playing", {"podconnect_account": "other"}
        )
        refused = await self.call(
            "music_move",
            {"entity_id": "media_player.kokken", "target_entity_id": "media_player.stue"},
        )
        self.assertEqual(refused["reason"], "other_account")
        self.assertIsInstance(self.hass.states.get("media_player.kokken"), State)

    async def test_bad_input_is_refused_by_the_schema(self):
        with self.assertRaises((ServiceValidationError, Exception)):
            await self.call(
                "music_queue_play", {"entity_id": "light.x", "option_id": "nope", "uri": "x"}
            )

    async def test_radio_without_podconnect_says_so(self):
        state = await self.call("radio_state", {})
        self.assertEqual(state, {"ok": True, "available": False, "reason": "not_configured"})
        result = await self.call("radio_command", {"action": "stop"})
        self.assertEqual(result["outcome"], "rejected")
