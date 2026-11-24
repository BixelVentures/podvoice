"""The panel's robot and car services, registered by the integration in the pinned HA cores."""

import unittest

import ha_fixture as fixture
import voluptuous as vol
from homeassistant.core import Context
from homeassistant.exceptions import HomeAssistantError, Unauthorized
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

SERVICES = ("robot_panel_state", "robot_command", "vehicle_panel_state", "vehicle_command")
FEATURES = 4 | 8 | 16 | 8192


class PodViewRobotVehicleServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await fixture.PodVoiceFramework.asyncSetUp(self)
        self.entry = self.hass.config_entries.async_entries("podvoice")[0]
        self.calls = []

        async def record(call):
            self.calls.append((call.service, dict(call.data)))

        for service in ("pause", "start", "stop", "return_to_base"):
            self.hass.services.async_register("vacuum", service, record)

    async def call(self, service, context, **data):
        return await self.hass.services.async_call(
            "podvoice", service, data, blocking=True, return_response=True, context=context
        )

    def add_vacuum(self, state="cleaning"):
        entry_id = self.entry.entry_id
        device = dr.async_get(self.hass).async_get_or_create(
            config_entry_id=entry_id, identifiers={("podvoice_test", "robot")}, name="Qrevo"
        )
        registry = er.async_get(self.hass)
        registry.async_get_or_create(
            "vacuum", "podvoice_test", "robot", device_id=device.id, suggested_object_id="qrevo"
        )
        registry.async_get_or_create(
            "sensor",
            "podvoice_test",
            "robot-battery",
            device_id=device.id,
            suggested_object_id="qrevo_battery",
            translation_key="battery",
        )
        self.hass.states.async_set(
            "vacuum.qrevo", state, {"supported_features": FEATURES, "friendly_name": "Qrevo"}
        )
        self.hass.states.async_set("sensor.qrevo_battery", "87", {"unit_of_measurement": "%"})

    async def test_services_are_registered_and_removed_with_the_entry(self):
        from custom_components.podvoice import async_setup_entry, async_unload_entry

        for service in SERVICES:
            self.assertTrue(self.hass.services.has_service("podvoice", service))
        self.assertTrue(await async_unload_entry(self.hass, self.entry))
        for service in SERVICES:
            self.assertFalse(self.hass.services.has_service("podvoice", service))
        self.assertTrue(await async_setup_entry(self.hass, self.entry))

    async def test_signed_in_users_only(self):
        for service in ("robot_panel_state", "vehicle_panel_state"):
            with self.subTest(service=service), self.assertRaises(Unauthorized):
                await self.call(service, Context())

    async def test_robot_state_and_admitted_command_for_a_viewer(self):
        self.add_vacuum()
        viewer = Context(user_id=self.viewer.id)
        state = await self.call("robot_panel_state", viewer)
        [robot] = state["robots"]
        self.assertEqual(robot["entityId"], "vacuum.qrevo")
        self.assertEqual(robot["actions"], ["pause", "stop", "return"])
        self.assertEqual(
            [row["value"] for row in robot["telemetry"] if row["key"] == "battery"], [87.0]
        )
        answer = await self.call(
            "robot_command",
            viewer,
            entity_id="vacuum.qrevo",
            action="pause",
            expected_state="cleaning",
            expected_features=FEATURES,
        )
        self.assertEqual(answer, {"outcome": "accepted"})
        self.assertEqual(self.calls, [("pause", {"entity_id": "vacuum.qrevo"})])

    async def test_robot_command_from_a_changed_state_is_refused_unsent(self):
        self.add_vacuum("paused")
        answer = await self.call(
            "robot_command",
            Context(user_id=self.viewer.id),
            entity_id="vacuum.qrevo",
            action="pause",
            expected_state="cleaning",
            expected_features=FEATURES,
        )
        self.assertEqual(answer["outcome"], "rejected")
        self.assertEqual(self.calls, [])

    async def test_vehicle_services_without_a_tesla_car(self):
        viewer = Context(user_id=self.viewer.id)
        self.assertEqual(
            await self.call("vehicle_panel_state", viewer),
            {"schema": "podvoice.vehicle_panel.v1", "vehicles": []},
        )
        answer = await self.call("vehicle_command", viewer, device_id="car", action="lock")
        self.assertEqual(answer["outcome"], "rejected")
        self.assertEqual(answer["reason"], "vehicle_unavailable")
        with self.assertRaises((HomeAssistantError, vol.Invalid)):
            await self.call("vehicle_command", viewer, device_id="car", action="honk")
