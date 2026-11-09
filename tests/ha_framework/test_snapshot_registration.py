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

    async def test_native_timer_v2_alias_schema_receipts_and_unload(self):
        from custom_components.podvoice import async_unload_entry
        from homeassistant.components.api import async_services_json
        from podvoice.gatekeeper.ha_timers import HomeAssistantTimers

        bridge = self.hass.data["podvoice"]
        endpoint = next(iter(bridge.devices))
        common = {"endpoint": endpoint, "epoch": bridge.epoch}

        async def call(service, **data):
            return await self.hass.services.async_call(
                "podvoice",
                service,
                {**common, **data},
                blocking=True,
                return_response=True,
                context=Context(user_id=self.supervisor.id),
            )

        self.assertTrue(self.hass.services.has_service("podvoice", "timer_command_v2"))
        adapter = HomeAssistantTimers(None, "")
        adapter.discover(await async_services_json(self.hass))
        self.assertEqual(adapter.command_service, "timer_command_v2")
        start = {"request_id": "alias-start", "action": "start", "seconds": 120}
        created = await call("timer_command", **start)
        self.assertTrue(created["ok"])
        self.assertEqual(await call("timer_command_v2", **start), created)
        self.assertEqual(await call("timer_command_v2", lookup_only=True, **start), created)
        row = bridge.snapshot(endpoint)["timers"][0]
        adjust = {
            "request_id": "alias-adjust",
            "action": "adjust",
            "timer_id": row["id"],
            "delta_seconds": -60,
            "expected_revision": row["revision"],
        }
        with self.assertRaises(vol.Invalid):
            await call("timer_command", **adjust)
        for bad in (True, "60", 0, 1.5):
            with self.subTest(delta=bad), self.assertRaises(vol.Invalid):
                await call("timer_command_v2", **{**adjust, "delta_seconds": bad})
        with self.assertRaises(vol.Invalid):
            await call("timer_command_v2", lookup_only="true", **adjust)
        result = await call("timer_command_v2", **adjust)
        self.assertTrue(result["ok"])
        self.assertEqual(result["id"], created["id"])
        self.assertEqual(result["seconds_left"], 60)
        self.assertGreater(int(result["revision"]), int(row["revision"]))
        self.assertEqual(await call("timer_command_v2", lookup_only=True, **adjust), result)
        await call("timer_command", request_id="alias-cancel", action="cancel", timer_id=row["id"])
        # Historical adjust lookup survives disappearance and stale revision.
        self.assertEqual(await call("timer_command_v2", lookup_only=True, **adjust), result)
        missing = await call(
            "timer_command_v2", **{**adjust, "request_id": "missing", "lookup_only": True}
        )
        self.assertEqual(missing["error"], "request_not_found")
        entry = self.hass.config_entries.async_entries("podvoice")[0]
        self.assertTrue(await async_unload_entry(self.hass, entry))
        self.assertFalse(self.hass.services.has_service("podvoice", "timer_command_v2"))

    async def test_missing_native_adjust_method_registers_v1_only(self):
        from unittest.mock import patch

        from custom_components.podvoice import async_setup_entry, async_unload_entry

        bridge = self.hass.data["podvoice"]
        entry = self.hass.config_entries.async_entries("podvoice")[0]
        self.assertTrue(await async_unload_entry(self.hass, entry))
        with patch.object(bridge.manager, "add_time", None):
            self.assertTrue(await async_setup_entry(self.hass, entry))
            self.assertTrue(self.hass.services.has_service("podvoice", "timer_command"))
            self.assertFalse(self.hass.services.has_service("podvoice", "timer_command_v2"))
