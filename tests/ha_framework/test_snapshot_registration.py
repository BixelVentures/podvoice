"""Pinned HA service registry contract; inert identities and empty registries."""

import unittest

import test_controller_admin_services as fixture
import voluptuous as vol
from homeassistant.core import Context
from homeassistant.exceptions import HomeAssistantError


class SnapshotRegistrationTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = fixture.ControllerAdminServiceFrameworkTests.asyncSetUp

    async def test_registered_snapshot_services_are_scoped_and_removed_on_unload(self):
        from custom_components.podvoice import async_unload_entry

        requests = {
            "robot_snapshot": {
                "entity_id": "vacuum.inert",
                "config_entry_id": "inert",
                "device_id": "inert",
                "unique_id": "inert",
                "model": "inert",
            },
            "robot_water_snapshot": {
                "entity_id": "vacuum.inert",
                "config_entry_id": "inert",
                "device_id": "inert",
                "unique_id": "inert",
                "model": "inert",
            },
            "vehicle_snapshot": {
                "config_entry_id": "inert",
                "device_id": "inert",
                "entities": {},
            },
        }
        for service, data in requests.items():
            with self.subTest(service=service):
                self.assertTrue(self.hass.services.has_service("podvoice", service))
                for context in (Context(), Context(user_id=self.admin.id)):
                    with self.assertRaises(HomeAssistantError) as caught:
                        await self.hass.services.async_call(
                            "podvoice",
                            service,
                            data,
                            blocking=True,
                            return_response=True,
                            context=context,
                        )
                    self.assertNotIn("inert", str(caught.exception))
                if service in {"robot_snapshot", "robot_water_snapshot"}:
                    result = await self.hass.services.async_call(
                        "podvoice",
                        service,
                        data,
                        blocking=True,
                        return_response=True,
                        context=Context(user_id=self.supervisor.id),
                    )
                    self.assertEqual(
                        result,
                        {
                            "schema": "podview.robot_water.v1"
                            if service == "robot_water_snapshot"
                            else "podview.robot_job.v1",
                            "status": "unavailable",
                        },
                    )
                else:
                    with self.assertRaises(HomeAssistantError) as caught:
                        await self.hass.services.async_call(
                            "podvoice",
                            service,
                            data,
                            blocking=True,
                            return_response=True,
                            context=Context(user_id=self.supervisor.id),
                        )
                    self.assertEqual(str(caught.exception), "Vehicle snapshot unavailable")
                with self.assertRaises(vol.Invalid):
                    await self.hass.services.async_call(
                        "podvoice",
                        service,
                        {**data, "extra": "inert"},
                        blocking=True,
                        return_response=True,
                        context=Context(user_id=self.supervisor.id),
                    )
                with self.assertRaises(HomeAssistantError):
                    await self.hass.services.async_call(
                        "podvoice",
                        service,
                        data,
                        blocking=True,
                        context=Context(user_id=self.supervisor.id),
                    )
        entry = self.hass.config_entries.async_entries("podvoice")[0]
        self.assertTrue(await async_unload_entry(self.hass, entry))
        for service in requests:
            self.assertFalse(self.hass.services.has_service("podvoice", service))
