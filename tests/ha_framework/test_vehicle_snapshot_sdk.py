"""Pinned HA SDK request contract; all API calls are inert AsyncMocks."""

import importlib.util
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import test_controller_admin_services as fixture
import voluptuous as vol
from homeassistant.const import __version__
from homeassistant.core import Context
from homeassistant.helpers.service import async_get_all_descriptions
from tesla_fleet_api.const import Method
from tesla_fleet_api.exceptions import NotFound, PreconditionFailed

SPEC = importlib.util.spec_from_file_location(
    "vehicle_snapshot_sdk",
    Path(__file__).resolve().parents[2] / "custom_components/podvoice/vehicle_snapshot.py",
)
snapshot = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(snapshot)


class VehicleSnapshotSDKTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_fixed_cached_get_on_existing_sdk_owner(self):
        self.assertIn(__version__, {"2026.8.2", "2026.11.1"})  # both CI-pinned versions
        api = SimpleNamespace(_request=AsyncMock(return_value={"response": {}}))
        vehicle = SimpleNamespace(api=api, vin="INERT_PRIVATE_VIN")
        self.assertEqual(await snapshot._cached_read(vehicle), {"response": {}})
        api._request.assert_awaited_once_with(
            Method.GET, "api/1/vehicles/INERT_PRIVATE_VIN/vehicle_data_cached"
        )

    async def test_actual_baseexception_errors_become_private_safe_terminal_codes(self):
        for error, code in ((NotFound, 404), (PreconditionFailed, 412)):
            with self.subTest(error=error):
                api = SimpleNamespace(_request=AsyncMock(side_effect=error("PRIVATE_PAYLOAD")))
                with self.assertRaises(snapshot.SnapshotReadError) as caught:
                    await snapshot._cached_read(SimpleNamespace(api=api, vin="INERT_PRIVATE_VIN"))
                self.assertEqual(caught.exception.status, code)
                self.assertNotIn("PRIVATE", str(caught.exception))
                self.assertEqual(api._request.await_count, 1)


class VehicleSnapshotServiceTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = fixture.ControllerAdminServiceFrameworkTests.asyncSetUp

    async def test_legacy_call_stays_compatible_and_advertised_opt_in_returns_eta(self):
        from custom_components.podvoice.vehicle_snapshot import VehicleSnapshot

        description = (await async_get_all_descriptions(self.hass))["podvoice"]["vehicle_snapshot"]
        eta_field = description["fields"]["include_charge_eta"]
        self.assertIs(eta_field["required"], False)
        self.assertIn("boolean", eta_field["selector"])

        entities = {
            "batteryPercent": "sensor.battery",
            "charging": "sensor.charging",
            "powerKw": "sensor.power",
            "endsAt": "sensor.eta",
        }
        base = {"config_entry_id": "fleet", "device_id": "car", "entities": entities}
        observed = int(time.time()) - 30
        coordinator = SimpleNamespace(
            data={
                "charge_state_timestamp": observed * 1000,
                "charge_state_battery_level": 72,
                "charge_state_charging_state": "Charging",
                "charge_state_charger_power": 11,
                "charge_state_minutes_to_full_charge": 45,
            }
        )
        runtime, vehicle, api = object(), object(), object()
        inert_owner = (
            SimpleNamespace(entry_id="fleet"),
            runtime,
            vehicle,
            api,
            coordinator,
            tuple(entities.items()),
        )

        async def call(**options):
            return await self.hass.services.async_call(
                "podvoice",
                "vehicle_snapshot",
                {**base, **options},
                blocking=True,
                return_response=True,
                context=Context(user_id=self.supervisor.id),
            )

        with patch.object(VehicleSnapshot, "_resolve", return_value=inert_owner):
            legacy = await call()
            self.assertEqual(legacy["status"], "observed")
            self.assertEqual(
                legacy["data"],
                {"batteryPercent": 72, "charging": {"status": "charging", "powerKw": 11}},
            )
            self.assertNotIn("charging.endsAt", legacy["fieldObservedAt"])
            self.assertEqual(await call(include_charge_eta=False), legacy)
            with self.assertRaises(vol.Invalid):
                await call(include_charge_eta="true")
            opted_in = await call(include_charge_eta=True)
            self.assertEqual(opted_in["data"]["charging"]["endsAt"], observed + 45 * 60)
            self.assertEqual(opted_in["fieldObservedAt"]["charging.endsAt"], observed)
            self.assertNotIn("charging.endsAt", opted_in["historicalFields"])
