"""Actual pinned HA coordinator/HomeTrait no-fetch regression, with inert I/O."""

import importlib.metadata
import importlib.util
import os
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

from homeassistant.components.hassio.const import DATA_HASSIO_SUPERVISOR_USER
from homeassistant.components.roborock.coordinator import RoborockDataUpdateCoordinator
from homeassistant.const import __version__
from roborock.data import CombinedMapInfo, MultiMapsListMapInfo, NamedRoomMapping
from roborock.data.v1.v1_code_mappings import RoborockInCleaning, RoborockStateCode
from roborock.devices.traits.v1.home import HomeTrait
from roborock.devices.traits.v1.map_content import MapContent
from roborock.devices.traits.v1.maps import MapsTrait
from roborock.devices.traits.v1.status import StatusTrait
from vacuum_map_parser_base.map_data import MapData

SOURCE = Path(
    os.environ.get(
        "ROBOT_SNAPSHOT_SOURCE",
        Path(__file__).resolve().parents[2] / "custom_components/podvoice/robot_snapshot.py",
    )
)
SPEC = importlib.util.spec_from_file_location("robot_snapshot_actual_sdk", SOURCE)
snapshot = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(snapshot)


class RobotSnapshotSDKTests(unittest.IsolatedAsyncioTestCase):
    async def build(self, missing_info=False):
        self.assertEqual(__version__, "2026.8.2")
        self.assertEqual(importlib.metadata.version("python-roborock"), "5.31.1")
        self.assertEqual(importlib.metadata.version("vacuum-map-parser-roborock"), "0.1.5")
        status = StatusTrait(NS())
        status.map_status = 3  # Exact SDK current_map property yields flag 0.
        status.in_cleaning = RoborockInCleaning.segment_clean_not_complete
        status.state = RoborockStateCode.segment_cleaning
        status.repeat = 2
        maps = MapsTrait(status)
        maps.map_info = None if missing_info else [MultiMapsListMapInfo(map_flag=0, name="Map")]
        maps.refresh = AsyncMock()
        old_data = MapData(25500, 1000)
        old_data.rooms = {16: object(), 17: object()}
        old_data.blocks = bytes([16, 17])
        old_data.additional_parameters.update(map_index=4, map_sequence=9)
        live = NS(
            map_data=None if missing_info else old_data,
            image_content=None,
            raw_api_response=None,
            refresh=AsyncMock(),
        )
        info = CombinedMapInfo(
            map_flag=0,
            name="Map",
            rooms=[
                NamedRoomMapping(segment_id=16, iot_id="inert16", raw_name="Room"),
                NamedRoomMapping(segment_id=17, iot_id="inert17", raw_name="Other"),
            ],
        )
        cache_data = NS(home_map_info={0: info}, home_map_content_base64={})
        home = HomeTrait(
            status,
            maps,
            live,
            NS(refresh=AsyncMock(), rooms=info.rooms),
            NS(get=AsyncMock(return_value=cache_data), set=AsyncMock()),
        )
        home._discovery_completed = True
        home._home_map_info = {0: info}
        home._home_map_content = {0: MapContent(map_data=old_data)}
        # Discovery is already complete; keep its external cache-loading port inert.
        home.discover_home = AsyncMock()
        coordinator = object.__new__(RoborockDataUpdateCoordinator)
        coordinator.properties_api = NS(status=status, maps=maps, home=home, map_content=live)
        coordinator.last_home_update = datetime.now(UTC) - timedelta(days=1)
        # ACTUAL HA method stamps last_home_update even when actual SDK refresh
        # takes its no-current-map-info early return without fetching content.
        await coordinator.update_map()
        self.assertLess((datetime.now(UTC) - coordinator.last_home_update).total_seconds(), 1)
        state = NS(state="cleaning", last_changed=datetime.now(UTC) - timedelta(seconds=10))
        request = dict(
            entity_id="vacuum.qrevo",
            config_entry_id="entry",
            device_id="robot",
            unique_id="duid_slug",
            model="roborock.vacuum.a75",
        )
        target = NS(
            **{
                key: request[key]
                for key in ("entity_id", "config_entry_id", "device_id", "unique_id")
            },
            platform="roborock",
            disabled_by=None,
        )
        owner = NS(
            duid_slug="duid_slug",
            properties_api=coordinator.properties_api,
            last_update_success=True,
            last_home_update=coordinator.last_home_update,
            _last_update_success_time=datetime.now(UTC),
        )
        entry = NS(domain="roborock", state="loaded", runtime_data={"robot": owner})
        supervisor = NS(is_active=True, is_admin=True, system_generated=True)
        hass = NS(
            data={DATA_HASSIO_SUPERVISOR_USER: supervisor},
            auth=NS(async_get_user=AsyncMock(return_value=supervisor)),
            config_entries=NS(async_get_entry=lambda _: entry),
            states=NS(get=lambda _: state),
        )
        handler = snapshot.make_robot_snapshot_handler(
            hass,
            lambda _: NS(async_get=lambda _: target),
            lambda _: NS(
                async_get=lambda _: NS(
                    manufacturer="Roborock", model=request["model"], config_entries={"entry"}
                )
            ),
        )
        call = NS(data=request, context=NS(user_id="supervisor", parent_id=None))
        return handler, call, home, live

    async def test_actual_no_fetch_branch_cannot_promote_persisted_segments(self):
        handler, call, home, live = await self.build(missing_info=True)
        self.assertEqual(list(home.home_map_content[0].map_data.blocks), [16, 17])
        live.refresh.assert_not_awaited()
        self.assertEqual(
            await handler(call), {"schema": "podview.robot_job.v1", "status": "unavailable"}
        )

    async def test_actual_successful_refresh_preserves_live_map_object_custody(self):
        handler, call, home, live = await self.build()
        live.refresh.assert_awaited_once()
        self.assertIs(home.home_map_content[0].map_data, live.map_data)
        result = await handler(call)
        self.assertEqual(result["status"], "observed")
        self.assertEqual(result["segmentIds"], [16, 17])
        self.assertEqual(result["repeat"], 2)

    async def test_restored_map_object_is_not_promoted_by_fresh_coordinator_clock(self):
        handler, call, home, live = await self.build()
        restored = MapData(25500, 1000)
        restored.rooms = dict(live.map_data.rooms)
        restored.blocks = live.map_data.blocks
        restored.additional_parameters.update(live.map_data.additional_parameters)
        home._home_map_content[0] = MapContent(map_data=restored)
        self.assertIsNot(home.home_map_content[0].map_data, live.map_data)
        self.assertEqual(
            await handler(call), {"schema": "podview.robot_job.v1", "status": "unavailable"}
        )
