"""Pinned HA SDK request contract; all API calls are inert AsyncMocks."""

import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from homeassistant.const import __version__
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
        self.assertEqual(__version__, "2026.8.2")
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
