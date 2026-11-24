"""PodView panel websocket commands over a real HA websocket, as a non-admin user."""

import asyncio
import unittest
from datetime import timedelta
from unittest.mock import patch

import test_controller_admin_services as fixture
import test_podview_panel as panel_fixture
from aiohttp.test_utils import TestClient, TestServer
from custom_components.podvoice import binary_sensor, panel_ws
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_component import DATA_INSTANCES
from homeassistant.util import dt as dt_util

ROOM = fixture.ROOM


class PanelWebsocketTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await panel_fixture.PodViewPanelTests.asyncSetUp(self)
        self.assertFalse(self.viewer.is_admin)
        self.assertFalse(self.viewer.system_generated)
        self.client = TestClient(TestServer(self.hass.http.app, host="127.0.0.1"))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)
        self.ws = await self.connect(self.viewer)
        self.next_id = 0
        self.digest = self.panel_config()["bundle"]

    def panel_config(self):
        from homeassistant.components import frontend

        return self.hass.data[frontend.DATA_PANELS]["podview"].config

    async def connect(self, user):
        refresh = await self.hass.auth.async_create_refresh_token(
            user, client_id="http://localhost"
        )
        token = self.hass.auth.async_create_access_token(refresh)
        ws = await self.client.ws_connect("/api/websocket")
        self.addAsyncCleanup(ws.close)
        self.assertEqual((await ws.receive_json())["type"], "auth_required")
        await ws.send_json({"type": "auth", "access_token": token})
        self.assertEqual((await ws.receive_json())["type"], "auth_ok")
        return ws

    async def send(self, **message):
        self.next_id += 1
        await self.ws.send_json({"id": self.next_id, **message})
        return self.next_id

    async def receive(self, wait=3):
        async with asyncio.timeout(wait):
            return await self.ws.receive_json()

    async def call(self, **message):
        msg_id = await self.send(**message)
        reply = await self.receive()
        self.assertEqual(reply["id"], msg_id)
        return reply

    async def timer(self, action, request_id, **data):
        bridge = self.hass.data["podvoice"]
        service = (
            "timer_command_v2"
            if self.hass.services.has_service("podvoice", "timer_command_v2")
            else "timer_command"
        )
        return await self.hass.services.async_call(
            "podvoice",
            service,
            {
                "endpoint": ROOM,
                "epoch": bridge.epoch,
                "request_id": request_id,
                "action": action,
                **data,
            },
            blocking=True,
            return_response=True,
        )

    async def timer_status(self):
        return await self.hass.services.async_call(
            "podvoice", "timer_status", {"endpoint": ROOM}, blocking=True, return_response=True
        )

    async def test_timer_subscribe_pushes_a_full_snapshot_on_every_change(self):
        msg_id = await self.send(type="podvoice/timer_subscribe", endpoint=ROOM)
        result = await self.receive()
        self.assertEqual(
            (result["id"], result["type"], result["success"]), (msg_id, "result", True)
        )
        initial = await self.receive()
        self.assertEqual((initial["id"], initial["type"]), (msg_id, "event"))
        self.assertEqual(initial["event"], await self.timer_status())
        self.assertEqual(initial["event"]["timers"], [])
        started = await self.timer("start", "ws-pasta", seconds=600, name="pasta")
        self.assertTrue(started["ok"])
        event = await self.receive()
        self.assertEqual(event["id"], msg_id)
        self.assertEqual([timer["id"] for timer in event["event"]["timers"]], [started["id"]])
        self.assertEqual(event["event"]["timers"][0]["name"], "pasta")
        self.assertEqual(event["event"], await self.timer_status())
        await self.timer("cancel", "ws-cancel", timer_id=started["id"])
        event = await self.receive()
        self.assertEqual(event["event"]["timers"], [])
        # The native event and the command result are coalesced into one snapshot.
        with self.assertRaises(TimeoutError):
            await self.receive(wait=0.3)
        reply = await self.call(type="unsubscribe_events", subscription=msg_id)
        self.assertTrue(reply["success"])
        again = await self.timer("start", "ws-again", seconds=600)
        await self.timer("cancel", "ws-again-cancel", timer_id=again["id"])
        with self.assertRaises(TimeoutError):
            await self.receive(wait=0.3)

    async def test_timer_read_matches_the_status_service_and_survives_no_bridge(self):
        started = await self.timer("start", "ws-read", seconds=600, name="te")
        reply = await self.call(type="podvoice/timer_read", endpoint=ROOM)
        self.assertTrue(reply["success"])
        self.assertEqual(reply["result"], await self.timer_status())
        self.assertEqual(reply["result"]["timers"][0]["id"], started["id"])
        msg_id = await self.send(type="podvoice/timer_subscribe", endpoint=ROOM)
        self.assertTrue((await self.receive())["success"])
        await self.receive()
        await self.timer("cancel", "ws-read-cancel", timer_id=started["id"])
        self.assertEqual((await self.receive())["event"]["timers"], [])
        from custom_components.podvoice import async_unload_entry

        self.assertTrue(await async_unload_entry(self.hass, self.entry))
        # The subscriber learns once that the endpoint went away, so it can resubscribe.
        gone = await self.receive()
        self.assertEqual(gone["id"], msg_id)
        self.assertEqual(
            (gone["event"]["ok"], gone["event"]["error"]), (False, "endpoint_unavailable")
        )
        reply = await self.call(type="podvoice/timer_read", endpoint=ROOM)
        self.assertEqual(reply["result"], {"ok": False, "error": "endpoint_unavailable"})
        reply = await self.call(type="podvoice/timer_subscribe", endpoint=ROOM)
        self.assertFalse(reply["success"])
        self.assertEqual(reply["error"]["code"], "not_found")

    async def test_panel_report_is_logged_clean_then_rate_limited(self):
        clock = [1000.0]
        with (
            patch.object(panel_ws, "monotonic", lambda: clock[0]),
            self.assertLogs("custom_components.podvoice.panel", "INFO") as logs,
        ):
            reply = await self.call(
                type="podvoice/panel_report",
                kind="error",
                message="boom\nsecond line\x1b[31m" + "x" * 600,
                detail="at render (Vejr.tsx:12)\r\n",
                bundle=self.digest,
                room="kitchen",
            )
            self.assertEqual(reply["result"], {"logged": True})
            for _ in range(9):
                reply = await self.call(
                    type="podvoice/panel_report", kind="remount", message="again"
                )
                self.assertEqual(reply["result"], {"logged": True})
            for _ in range(2):
                reply = await self.call(type="podvoice/panel_report", kind="error", message="flood")
                self.assertEqual(reply["result"], {"logged": False})
            clock[0] += 6.5  # One token back at ten per minute.
            reply = await self.call(type="podvoice/panel_report", kind="frames", message="slow")
            self.assertEqual(reply["result"], {"logged": True})
            reply = await self.call(type="podvoice/panel_report", kind="error", message="flood")
            self.assertEqual(reply["result"], {"logged": False})
        records = logs.records
        self.assertEqual(len(records), 12)
        first = records[0].getMessage()
        self.assertEqual(records[0].levelname, "WARNING")
        self.assertIn("PodView error", first)
        self.assertIn(self.digest, first)
        self.assertIn("boom second line [31m", first)
        self.assertNotIn("\n", first)
        self.assertNotIn("\x1b", first)
        self.assertNotIn("x" * 490, first)  # Message capped at 500 characters.
        self.assertIn("at render (Vejr.tsx:12)", first)
        self.assertEqual(records[10].getMessage(), "2 PodView reports suppressed")
        self.assertEqual(records[10].levelname, "WARNING")
        self.assertEqual(records[11].levelname, "INFO")
        self.assertIn("PodView frames", records[11].getMessage())
        output = "\n".join(record.getMessage() for record in records)
        self.assertNotIn(self.viewer.id, output)
        reply = await self.call(type="podvoice/panel_report", kind="unknown", message="x")
        self.assertFalse(reply["success"])

    def sensor(self):
        entity_id = er.async_get(self.hass).async_get_entity_id(
            "binary_sensor", "podvoice", f"{self.entry.entry_id}_podview_wall_online"
        )
        self.assertIsNotNone(entity_id)
        entity = self.hass.data[DATA_INSTANCES]["binary_sensor"].get_entity(entity_id)
        return entity_id, entity

    async def heartbeat(self, bundle, **extra):
        reply = await self.call(type="podvoice/panel_heartbeat", bundle=bundle, **extra)
        self.assertTrue(reply["success"], reply)
        await self.hass.async_block_till_done()
        return reply["result"]

    async def test_heartbeat_drives_the_wall_online_sensor_without_a_row_per_beat(self):
        entity_id, entity = self.sensor()
        state = self.hass.states.get(entity_id)
        self.assertEqual(state.state, "off")
        self.assertEqual(state.attributes["device_class"], "connectivity")
        self.assertEqual(state.attributes["friendly_name"], "PodView væg online")
        self.assertEqual(
            binary_sensor.PodViewWallOnline._unrecorded_attributes,
            frozenset({"last_heartbeat", "uptime_s"}),
        )
        start = dt_util.utcnow()
        clock = [start]
        with patch.object(panel_ws, "utcnow", lambda: clock[0]):
            result = await self.heartbeat(self.digest, uptime_s=42, room="kitchen", screen="hjem")
            self.assertEqual(result, {"expected_bundle": self.digest, "stale": False})
            state = self.hass.states.get(entity_id)
            self.assertEqual(state.state, "on")
            self.assertEqual(
                {key: state.attributes[key] for key in binary_sensor_attributes()},
                {
                    "last_heartbeat": start.isoformat(),
                    "bundle": self.digest,
                    "expected_bundle": self.digest,
                    "stale": False,
                    "uptime_s": 42,
                    "room": "kitchen",
                },
            )
            written = state.last_updated
            # Same bundle and room within ten minutes: no new state row.
            clock[0] = start + timedelta(minutes=5)
            await self.heartbeat(self.digest, uptime_s=342, room="kitchen")
            self.assertEqual(self.hass.states.get(entity_id).last_updated, written)
            clock[0] = start + timedelta(minutes=10, seconds=1)
            await self.heartbeat(self.digest, uptime_s=601, room="kitchen")
            state = self.hass.states.get(entity_id)
            self.assertNotEqual(state.last_updated, written)
            self.assertEqual(state.attributes["uptime_s"], 601)
            # An old bundle is stale at once.
            result = await self.heartbeat("0123456789ab", uptime_s=602, room="kitchen")
            self.assertEqual(result, {"expected_bundle": self.digest, "stale": True})
            state = self.hass.states.get(entity_id)
            self.assertEqual((state.state, state.attributes["stale"]), ("on", True))
            self.assertEqual(state.attributes["bundle"], "0123456789ab")
            last = clock[0]
            # The 30 s check keeps it on below 180 s and turns it off after.
            clock[0] = last + timedelta(seconds=179)
            entity._tick(clock[0])
            self.assertEqual(self.hass.states.get(entity_id).state, "on")
            clock[0] = last + timedelta(seconds=181)
            entity._tick(clock[0])
            state = self.hass.states.get(entity_id)
            self.assertEqual(state.state, "off")
            self.assertEqual(state.attributes["last_heartbeat"], last.isoformat())
        result = await self.heartbeat(self.digest, uptime_s=0)
        self.assertEqual(self.hass.states.get(entity_id).state, "on")
        self.assertIsNone(self.hass.states.get(entity_id).attributes["room"])

    async def test_heartbeat_follows_a_new_bundle_after_reload(self):
        entity_id, _ = self.sensor()
        old = self.digest
        await self.heartbeat(old, uptime_s=1)
        self.icon.write_bytes(b"<svg/>")
        await self.reload()
        await self.hass.async_block_till_done()
        new = self.panel_config()["bundle"]
        self.assertNotEqual(new, old)
        result = await self.heartbeat(old, uptime_s=2)
        self.assertEqual(result, {"expected_bundle": new, "stale": True})
        state = self.hass.states.get(entity_id)
        self.assertEqual(
            (state.attributes["expected_bundle"], state.attributes["stale"]), (new, True)
        )

    async def reload(self):
        await panel_fixture.PodViewPanelTests.reload(self)

    def panel(self):
        return panel_fixture.PodViewPanelTests.panel(self)


def binary_sensor_attributes():
    return ("last_heartbeat", "bundle", "expected_bundle", "stale", "uptime_s", "room")


if __name__ == "__main__":
    unittest.main()
