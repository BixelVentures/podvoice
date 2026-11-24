"""The panel's room cleaning services in the pinned HA cores: rooms from HA's own area mapping,
settings, starts and the journal, with every rule enforced by the integration for a non-admin
viewer (and never for an anonymous caller)."""

import unittest

import test_controller_admin_services as fixture
import voluptuous as vol
from homeassistant.core import Context
from homeassistant.exceptions import HomeAssistantError, Unauthorized
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

SERVICES = ("robot_cleaning_state", "robot_setting", "robot_start", "vehicle_history")
# pause, stop, return, fan speed, resume and clean_area.
FEATURES = 4 | 8 | 16 | 32 | 8192 | 16384


class PodViewRobotCleaningTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await fixture.ControllerAdminServiceFrameworkTests.asyncSetUp(self)
        self.entry = self.hass.config_entries.async_entries("podvoice")[0]
        self.calls = []

        async def record(call):
            self.calls.append((call.domain, call.service, dict(call.data)))

        for service in ("clean_area", "set_fan_speed", "send_command", "start"):
            self.hass.services.async_register("vacuum", service, record)
        self.hass.services.async_register("select", "select_option", record)
        self.viewer_context = Context(user_id=self.viewer.id)

    async def call(self, service, context=None, **data):
        return await self.hass.services.async_call(
            "podvoice",
            service,
            data,
            blocking=True,
            return_response=True,
            context=context or self.viewer_context,
        )

    def add_robot(self, state="docked"):
        areas = ar.async_get(self.hass)
        self.kitchen = areas.async_create("Køkken").id
        self.living = areas.async_create("Stue").id
        self.office = areas.async_create("Kontor").id
        device = dr.async_get(self.hass).async_get_or_create(
            config_entry_id=self.entry.entry_id,
            identifiers={("podvoice_test", "robot")},
            name="Qrevo",
        )
        registry = er.async_get(self.hass)
        registry.async_get_or_create(
            "vacuum", "podvoice_test", "robot", device_id=device.id, suggested_object_id="qrevo"
        )
        for key, object_id in (("cleaning_mode", "qrevo_mode"), ("selected_map", "qrevo_map")):
            registry.async_get_or_create(
                "select",
                "podvoice_test",
                f"robot-{key}",
                device_id=device.id,
                suggested_object_id=object_id,
                translation_key=key,
            )
        registry.async_update_entity_options(
            "vacuum.qrevo",
            "vacuum",
            {
                "area_mapping": {
                    self.kitchen: ["1_16"],
                    self.living: ["1_17", "1_18"],
                    self.office: ["2_20"],
                },
                "last_seen_segments": [
                    {"id": "1_16", "name": "Kitchen", "group": "Stueplan"},
                    {"id": "1_17", "name": "Living", "group": "Stueplan"},
                    {"id": "1_18", "name": "Hall", "group": "Stueplan"},
                    {"id": "2_20", "name": "Office", "group": "1. sal"},
                ],
            },
        )
        self.set_vacuum(state)
        self.hass.states.async_set(
            "select.qrevo_mode", "vac_and_mop", {"options": ["vacuum", "mop", "vac_and_mop"]}
        )
        self.hass.states.async_set(
            "select.qrevo_map", "Stueplan", {"options": ["Stueplan", "1. sal"]}
        )

    def set_vacuum(self, state, fan_speed="balanced"):
        self.hass.states.async_set(
            "vacuum.qrevo",
            state,
            {
                "supported_features": FEATURES,
                "friendly_name": "Qrevo",
                "fan_speed": fan_speed,
                "fan_speed_list": ["quiet", "balanced", "turbo"],
            },
        )

    async def offer(self):
        return await self.call("robot_cleaning_state", entity_id="vacuum.qrevo")

    def start_data(self, offer, **extra):
        return {
            "entity_id": "vacuum.qrevo",
            "area_ids": [self.kitchen],
            "expected_state": "docked",
            "revision": offer["revision"],
            **extra,
        }

    async def test_services_are_registered_for_signed_in_users_only(self):
        for service in SERVICES:
            self.assertTrue(self.hass.services.has_service("podvoice", service))
        self.add_robot()
        with self.assertRaises(Unauthorized):
            await self.call("robot_cleaning_state", Context(), entity_id="vacuum.qrevo")
        with self.assertRaises(Unauthorized):
            await self.call("robot_start", Context(), **self.start_data({"revision": "a" * 64}))
        with self.assertRaises(Unauthorized):
            await self.call("vehicle_history", Context(), device_id="car")
        self.assertEqual(self.calls, [])

    async def test_viewer_reads_the_active_floor_rooms_and_settings(self):
        self.add_robot()
        offer = await self.offer()
        self.assertEqual(offer["mapName"], "Stueplan")
        self.assertEqual(
            offer["rooms"],
            [{"id": self.kitchen, "name": "Køkken"}, {"id": self.living, "name": "Stue"}],
        )
        self.assertTrue(offer["startable"])
        self.assertFalse(offer["blocked"])
        self.assertEqual(offer["repeat"], {"min": 1, "max": 1})
        keys = {row["key"]: row for row in offer["settings"]}
        self.assertEqual(keys["cleaning_mode"]["current"], "vac_and_mop")
        self.assertEqual(keys["suction"]["options"], ["quiet", "balanced", "turbo"])
        self.assertEqual(keys["map"]["options"], ["Stueplan", "1. sal"])
        # No add-on on this network: its journal is honestly unavailable, the panel's own is empty.
        self.assertEqual(offer["journal"]["addon"], "addon_unavailable")
        self.assertEqual(offer["journal"]["items"], [])

    async def test_viewer_starts_with_settings_first_and_the_journal_records_it(self):
        self.add_robot()
        offer = await self.offer()
        answer = await self.call(
            "robot_start",
            **self.start_data(offer, settings={"cleaning_mode": "vacuum", "suction": "turbo"}),
        )
        self.assertEqual(answer["outcome"], "accepted")
        self.assertEqual(answer["applied"], ["cleaning_mode", "suction"])
        self.assertEqual(
            self.calls,
            [
                ("select", "select_option", {"entity_id": "select.qrevo_mode", "option": "vacuum"}),
                ("vacuum", "set_fan_speed", {"entity_id": "vacuum.qrevo", "fan_speed": "turbo"}),
                (
                    "vacuum",
                    "clean_area",
                    {"entity_id": "vacuum.qrevo", "cleaning_area_id": [self.kitchen]},
                ),
            ],
        )
        [item] = (await self.offer())["journal"]["items"]
        self.assertEqual(item["outcome"], "accepted")
        self.assertEqual(item["areaNames"], ["Køkken"])
        self.assertEqual(item["settings"], {"cleaning_mode": "vacuum", "suction": "turbo"})
        self.assertTrue(item["reusable"])
        # The recipe can be started again as it was, and only as it was.
        self.calls.clear()
        offer = await self.offer()
        changed = await self.call(
            "robot_start",
            **self.start_data(offer, recipe_id=item["id"], settings={"cleaning_mode": "mop"}),
        )
        self.assertEqual(changed, {"outcome": "rejected", "reason": "recipe_changed"})
        same = await self.call(
            "robot_start",
            **self.start_data(offer, recipe_id=item["id"], settings=item["settings"]),
        )
        self.assertEqual(same["outcome"], "accepted")

    async def test_refusals_send_nothing(self):
        self.add_robot()
        offer = await self.offer()
        cases = [
            ({"area_ids": [self.office]}, "unknown_room"),
            ({"settings": {"suction": "max"}}, "unsupported_setting"),
            ({"revision": "b" * 64}, "changed_observation"),
            ({"expected_state": "idle"}, "changed_observation"),
        ]
        for extra, reason in cases:
            with self.subTest(reason=reason, extra=extra):
                answer = await self.call("robot_start", **self.start_data(offer, **extra))
                self.assertEqual(answer, {"outcome": "rejected", "reason": reason})
        self.set_vacuum("cleaning")
        answer = await self.call("robot_start", **self.start_data(offer, expected_state="cleaning"))
        self.assertEqual(answer, {"outcome": "rejected", "reason": "not_ready"})
        self.assertEqual(self.calls, [])

    async def test_a_new_floor_changes_the_offer_the_user_saw(self):
        self.add_robot()
        offer = await self.offer()
        self.hass.states.async_set(
            "select.qrevo_map", "1. sal", {"options": ["Stueplan", "1. sal"]}
        )
        answer = await self.call("robot_start", **self.start_data(offer))
        self.assertEqual(answer, {"outcome": "rejected", "reason": "changed_observation"})
        self.assertEqual((await self.offer())["rooms"], [{"id": self.office, "name": "Kontor"}])
        self.assertEqual(self.calls, [])

    async def test_setting_from_the_value_the_user_saw(self):
        self.add_robot()
        base = {"entity_id": "vacuum.qrevo", "key": "suction", "setting_entity_id": "vacuum.qrevo"}
        stale = await self.call("robot_setting", **base, value="turbo", expected_current="quiet")
        self.assertEqual(stale, {"outcome": "rejected", "reason": "changed_observation"})
        other = await self.call(
            "robot_setting",
            **{**base, "setting_entity_id": "select.qrevo_mode"},
            value="turbo",
            expected_current="balanced",
        )
        self.assertEqual(other, {"outcome": "rejected", "reason": "unsupported_setting"})
        self.assertEqual(self.calls, [])
        answer = await self.call(
            "robot_setting", **base, value="turbo", expected_current="balanced"
        )
        self.assertEqual(answer, {"outcome": "accepted"})
        self.assertEqual(
            self.calls,
            [("vacuum", "set_fan_speed", {"entity_id": "vacuum.qrevo", "fan_speed": "turbo"})],
        )

    async def test_the_floor_changes_only_while_the_robot_rests(self):
        self.add_robot("cleaning")
        answer = await self.call(
            "robot_setting",
            entity_id="vacuum.qrevo",
            key="map",
            setting_entity_id="select.qrevo_map",
            value="1. sal",
            expected_current="Stueplan",
        )
        self.assertEqual(answer, {"outcome": "rejected", "reason": "not_ready"})
        self.assertEqual(self.calls, [])

    async def test_an_unknown_start_blocks_the_next_one(self):
        self.add_robot()

        async def silent(call):
            raise HomeAssistantError("no answer")

        self.hass.services.async_register("vacuum", "clean_area", silent)
        offer = await self.offer()
        first = await self.call("robot_start", **self.start_data(offer))
        self.assertEqual(first["outcome"], "unknown")
        offer = await self.offer()
        self.assertTrue(offer["blocked"])
        self.assertEqual(offer["journal"]["items"][0]["outcome"], "unknown")
        again = await self.call("robot_start", **self.start_data(offer))
        self.assertEqual(again, {"outcome": "rejected", "reason": "previous_unknown"})

    async def test_invalid_requests_never_reach_the_rules(self):
        self.add_robot()
        with self.assertRaises((HomeAssistantError, vol.Invalid)):
            await self.call("robot_start", **self.start_data({"revision": "a" * 64}, repeat=4))
        with self.assertRaises((HomeAssistantError, vol.Invalid)):
            await self.call(
                "robot_setting",
                entity_id="vacuum.qrevo",
                key="volume",
                setting_entity_id="vacuum.qrevo",
                value="1",
            )

    async def test_vehicle_history_without_a_car(self):
        self.assertEqual(
            await self.call("vehicle_history", device_id="car"), {"status": "unknown", "items": []}
        )
