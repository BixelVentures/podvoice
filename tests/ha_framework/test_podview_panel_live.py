"""Svar and Radio pushed over a real HA websocket to a non-admin user, never through a recorded service call."""

import asyncio
import unittest
from unittest.mock import patch

import test_controller_admin_services as fixture
import test_podview_panel_addon_bridge as answers_fixture
import test_podview_panel_ws as ws_fixture
from aiohttp import ClientSession, web
from aiohttp.test_utils import TestServer
from custom_components.podvoice import addon_bridge, answers_live, music_bridge, radio_live

ROOM = fixture.ROOM
LIVE_RECEIPT = "c" * 32


def live_state(token, revision=1, items=()):
    return {
        "schema": "podview.answers-live.v1",
        "token": token,
        "snapshot": {
            "bootId": "boot-a",
            "roomId": ROOM,
            "voice": {"sessionId": "s1", "active": True},
            "capabilities": {"answerRead": True, "researchVisual": False},
            "answers": {"revision": revision, "sessionId": "s1", "turnId": "t1"},
            "answerHistoryRevision": 1,
            "answerHistoryRemovalRevision": 0,
            "answerHistoryReceiptIds": [answers_fixture.RECEIPT],
        },
        "live": {
            "schema": "podview.answers.v1",
            "roomId": ROOM,
            "revision": revision,
            "items": list(items),
        },
    }


class LivePushTests(unittest.IsolatedAsyncioTestCase):
    # The websocket helpers of the panel's own websocket tests (not their tests).
    panel_config = ws_fixture.PanelWebsocketTests.panel_config
    connect = ws_fixture.PanelWebsocketTests.connect
    send = ws_fixture.PanelWebsocketTests.send
    receive = ws_fixture.PanelWebsocketTests.receive
    call = ws_fixture.PanelWebsocketTests.call

    async def asyncSetUp(self):
        await ws_fixture.PanelWebsocketTests.asyncSetUp(self)
        self.live_reads, self.history_reads = [], 0
        self.states = asyncio.Queue()
        self.addon_up = True

        async def live(request):
            if not self.addon_up:
                return web.Response(status=502, text="down")
            self.live_reads.append(dict(request.query))
            return web.json_response(await self.states.get())

        async def history(request):
            self.history_reads += 1
            return web.json_response(answers_fixture.HISTORY)

        app = web.Application()
        app.router.add_get("/view/api/answers/live", live)
        app.router.add_get("/view/api/answers", history)
        self.addon = TestServer(app, host="127.0.0.1")
        await self.addon.start_server()
        self.addAsyncCleanup(self.addon.close)
        session = ClientSession()
        self.addAsyncCleanup(session.close)
        for target, name, value in (
            (answers_live, "ADDON_LIVE", str(self.addon.make_url("/view/api/answers/live"))),
            (addon_bridge, "ADDON_ANSWERS", str(self.addon.make_url("/view/api/answers"))),
            (answers_live, "async_get_clientsession", lambda *_: session),
            (addon_bridge, "async_get_clientsession", lambda *_: session),
            (answers_live, "RETRY_S", (0.05,)),
        ):
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.service_calls = []
        self.hass.bus.async_listen(
            "call_service", lambda event: self.service_calls.append(event.data)
        )

    async def event(self, msg_id, wait=3):
        reply = await self.receive(wait)
        self.assertEqual((reply["id"], reply["type"]), (msg_id, "event"))
        return reply["event"]

    async def test_the_live_answer_and_the_history_are_pushed_without_a_service_call(self):
        await self.states.put(live_state("a" * 32))
        msg_id = await self.send(type="podvoice/answers_subscribe", room=ROOM)
        self.assertTrue((await self.receive())["success"])
        first = await self.event(msg_id)
        self.assertTrue(first["ok"])
        self.assertEqual(first["history"], answers_fixture.HISTORY)
        self.assertEqual(first["snapshot"]["roomId"], ROOM)
        self.assertEqual(self.live_reads[0], {"after": "", "room": ROOM})
        # GPT-Live speaks: a new live answer; the history did not move, so it is not read again.
        row = {"receiptId": LIVE_RECEIPT, "family": "fact-card"}
        await self.states.put(live_state("b" * 32, revision=2, items=[row]))
        second = await self.event(msg_id)
        self.assertEqual(second["live"]["items"], [row])
        self.assertEqual(self.history_reads, 1)
        self.assertEqual(self.live_reads[1]["after"], "a" * 32)
        # An unchanged answer (the add-on's 25 s wait ran out) pushes nothing.
        await self.states.put(live_state("b" * 32, revision=2, items=[row]))
        await asyncio.sleep(0.2)
        self.assertEqual(self.service_calls, [])

    async def test_a_stopped_addon_is_pushed_honestly_and_read_again(self):
        self.addon_up = False
        msg_id = await self.send(type="podvoice/answers_subscribe", room=ROOM)
        self.assertTrue((await self.receive())["success"])
        self.assertEqual(await self.event(msg_id), {"ok": False, "error": "addon_unavailable"})
        self.addon_up = True
        await self.states.put(live_state("a" * 32))
        self.assertTrue((await self.event(msg_id))["ok"])

    async def test_the_last_subscriber_leaving_stops_the_reads(self):
        await self.states.put(live_state("a" * 32))
        msg_id = await self.send(type="podvoice/answers_subscribe", room=ROOM)
        self.assertTrue((await self.receive())["success"])
        await self.event(msg_id)
        await self.call(type="unsubscribe_events", subscription=msg_id)
        await asyncio.sleep(0.05)
        self.assertNotIn(ROOM, self.hass.data.get(answers_live._KEY, {}))

    async def test_radio_is_pushed_on_change_and_after_a_command(self):
        reads = []
        states = [
            {"ok": True, "available": False, "reason": "unreachable"},
            {"ok": True, "available": False, "reason": "unreachable"},
            {"ok": True, "available": False, "reason": "unauthorized"},
        ]

        async def state(_self):
            reads.append(1)
            return states[min(len(reads), len(states)) - 1]

        with (
            patch.object(music_bridge.Radio, "state", state),
            patch.object(radio_live, "INTERVAL_S", 30),
        ):
            self.hass.data.pop(radio_live._KEY, None)
            msg_id = await self.send(type="podvoice/radio_subscribe")
            self.assertTrue((await self.receive())["success"])
            self.assertEqual((await self.event(msg_id))["reason"], "unreachable")
            radio_live.poke(self.hass)
            await asyncio.sleep(0.05)
            # The same state again is not pushed; a changed one is.
            radio_live.poke(self.hass)
            self.assertEqual((await self.event(msg_id))["reason"], "unauthorized")
            self.assertEqual(len(reads), 3)
        self.assertEqual(self.service_calls, [])


if __name__ == "__main__":
    unittest.main()
