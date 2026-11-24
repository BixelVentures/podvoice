"""podvoice.answers_snapshot registered in the pinned HA cores, against an inert add-on on loopback."""

import unittest
from unittest.mock import patch

import test_controller_admin_services as fixture
import voluptuous as vol
from aiohttp import ClientSession, web
from aiohttp.test_utils import TestServer
from custom_components.podvoice import addon_bridge
from homeassistant.core import Context
from homeassistant.exceptions import Unauthorized

RECEIPT = "b" * 32
HISTORY = {
    "schema": "podview.answer-history.v1",
    "roomId": fixture.ROOM,
    "bootId": "boot-a",
    "revision": 1,
    "removalRevision": 0,
    "receiptIds": [RECEIPT],
    "items": [
        {
            "receiptId": RECEIPT,
            "family": "concise",
            "title": "Gemt svar",
            "observedAt": 1700000000,
            "content": {"summary": "Bevaret", "sources": []},
            "provenance": {"kind": "ai_explanation"},
        }
    ],
}


class AnswersBridgeFrameworkTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await fixture.ControllerAdminServiceFrameworkTests.asyncSetUp(self)
        self.queries = []

        async def answers(request):
            self.queries.append(dict(request.query))
            return web.json_response(HISTORY)

        app = web.Application()
        app.router.add_get("/view/api/answers", answers)
        self.addon = TestServer(app, host="127.0.0.1")
        await self.addon.start_server()
        self.addAsyncCleanup(self.addon.close)
        patcher = patch.object(
            addon_bridge, "ADDON_ANSWERS", str(self.addon.make_url("/view/api/answers"))
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        # HA's shared session resolves through zeroconf, which a networkless CI container lacks; the bridge's own
        # request (URL, query, deadline, reading) is unchanged.
        session = ClientSession()
        self.addAsyncCleanup(session.close)
        patcher = patch.object(addon_bridge, "async_get_clientsession", return_value=session)
        patcher.start()
        self.addCleanup(patcher.stop)

    async def answers(self, context, **data):
        return await self.hass.services.async_call(
            "podvoice",
            "answers_snapshot",
            data,
            blocking=True,
            return_response=True,
            context=context,
        )

    async def test_registered_with_the_panel_services(self):
        self.assertTrue(self.hass.services.has_service("podvoice", "answers_snapshot"))
        self.assertIn("answers_snapshot", self.hass.data["podvoice_panel_services"])

    async def test_the_recipe_catalog_is_registered_with_the_panel_services(self):
        self.assertTrue(self.hass.services.has_service("podvoice", "recipes_snapshot"))
        self.assertIn("recipes_snapshot", self.hass.data["podvoice_panel_services"])
        with self.assertRaises(Unauthorized):
            await self.hass.services.async_call(
                "podvoice",
                "recipes_snapshot",
                {},
                blocking=True,
                return_response=True,
                context=Context(),
            )

    async def test_a_signed_in_viewer_reads_the_saved_answers(self):
        result = await self.answers(Context(user_id=self.viewer.id), room=fixture.ROOM)
        self.assertEqual(result, {"ok": True, "history": HISTORY})
        self.assertEqual(self.queries, [{"history": "1", "room": fixture.ROOM}])

    async def test_no_user_no_answers(self):
        with self.assertRaises(Unauthorized):
            await self.answers(Context(), room=fixture.ROOM)
        self.assertEqual(self.queries, [])

    async def test_only_a_room_is_accepted(self):
        with self.assertRaises(vol.Invalid):
            await self.answers(Context(user_id=self.viewer.id), room=fixture.ROOM, url="x")
        with self.assertRaises(vol.Invalid):
            await self.answers(Context(user_id=self.viewer.id), room="")
        self.assertEqual(self.queries, [])

    async def test_a_stopped_addon_is_an_honest_answer_not_an_error(self):
        await self.addon.close()
        result = await self.answers(Context(user_id=self.viewer.id), room=fixture.ROOM)
        self.assertEqual(result, {"ok": False, "error": "addon_unavailable"})
        # Timers keep working without the add-on.
        self.assertTrue(self.hass.services.has_service("podvoice", "timer_status"))
