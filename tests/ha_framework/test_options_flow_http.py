"""Real HA2026.8.2 HTTP options requests; only the final admin service is inert.

Run inside the pinned HA image with no network, mounted read-only at /candidate.
No HA packages/classes/auth/request middleware are replaced or stubbed.
"""

import asyncio
import copy
import unittest
from contextlib import AsyncExitStack
from pathlib import Path
from tempfile import TemporaryDirectory

from aiohttp.test_utils import TestClient, TestServer
from homeassistant import auth, bootstrap, loader
from homeassistant.auth.const import GROUP_ID_ADMIN, GROUP_ID_USER
from homeassistant.components.config.config_entries import (
    OptionManagerFlowIndexView,
    OptionManagerFlowResourceView,
)
from homeassistant.components.http import HomeAssistantHTTP
from homeassistant.config_entries import ConfigEntries
from homeassistant.const import __version__
from homeassistant.core import HomeAssistant, SupportsResponse
from homeassistant.exceptions import HomeAssistantError

ROOT = Path(__file__).resolve().parents[2]
URL = "/api/config/config_entries/options/flow"
CODE = "inert_fixture_only_" + "A" * 32


class OptionsHTTPTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.assertEqual(__version__, "2026.8.2")
        self.stack = AsyncExitStack()
        await self.stack.__aenter__()
        self.addAsyncCleanup(self.stack.aclose)
        temp = self.stack.enter_context(TemporaryDirectory())
        (Path(temp) / "custom_components").symlink_to(ROOT / "custom_components")
        self.hass = HomeAssistant(temp)
        self.stack.push_async_callback(self.hass.async_stop, force=True)
        self.hass.config.skip_pip = True
        loader.async_setup(self.hass)
        self.hass.config_entries = ConfigEntries(self.hass, {})
        self.assertTrue(await bootstrap.async_load_base_functionality(self.hass))
        self.hass.auth = await auth.auth_manager_from_config(self.hass, [], [])
        self.owner = await self.hass.auth.async_create_user(
            "Owner fixture", group_ids=[GROUP_ID_ADMIN]
        )
        self.admin = await self.hass.auth.async_create_user(
            "Admin fixture", group_ids=[GROUP_ID_ADMIN]
        )
        self.assertTrue(self.owner.is_owner)
        self.assertFalse(self.admin.is_owner)
        self.other = await self.hass.auth.async_create_user(
            "Other admin", group_ids=[GROUP_ID_ADMIN]
        )
        self.viewer = await self.hass.auth.async_create_user(
            "Viewer fixture", group_ids=[GROUP_ID_USER]
        )
        self.headers = {}
        for user in (self.admin, self.other, self.viewer):
            refresh = await self.hass.auth.async_create_refresh_token(
                user, client_id="http://localhost"
            )
            self.headers[user.id] = {
                "Authorization": "Bearer " + self.hass.auth.async_create_access_token(refresh)
            }
        from homeassistant.setup import async_setup_component

        self.assertTrue(
            await async_setup_component(
                self.hass,
                "podvoice",
                {
                    "podvoice": {
                        "endpoints": [
                            {
                                "endpoint": "configured-alpha",
                                "name": "Configured room label",
                                "kind": "voice_pe",
                                "identity": "02:00:00:00:00:01",
                            },
                            {
                                "endpoint": "talk",
                                "name": "Talk fixture",
                                "kind": "talk",
                                "identity": "inert-talk",
                            },
                        ]
                    }
                },
            )
        )
        await self.hass.async_block_till_done()
        self.entry = self.hass.config_entries.async_entries("podvoice")[0]
        self.original = copy.deepcopy(dict(self.entry.data))
        self.hass.config_entries.async_update_entry(self.entry, options={"retained": "unchanged"})
        self.calls = []
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        self.release.set()
        self.addAsyncCleanup(self.release.set)
        self.bad = None

        async def service(call):
            self.calls.append(call)
            self.entered.set()
            await self.release.wait()
            if self.bad == "error":
                raise HomeAssistantError("inert failure")
            if self.bad == "room":
                return {"ok": True, "room": "foreign", "code": CODE}
            result = {"ok": True, "room": call.data["room"]}
            if call.service == "controller_provision":
                result["code"] = CODE
            return result

        for action in ("provision", "revoke"):
            self.hass.services.async_register(
                "podvoice",
                f"controller_{action}",
                service,
                supports_response=SupportsResponse.ONLY,
            )
        self.hass.http = HomeAssistantHTTP(
            self.hass, None, None, None, ["127.0.0.1"], 0, [], "modern"
        )
        await self.hass.http.async_initialize(
            cors_origins=[],
            use_x_forwarded_for=False,
            login_threshold=-1,
            is_ban_enabled=False,
            use_x_frame_options=True,
        )
        self.hass.http.register_view(OptionManagerFlowIndexView(self.hass.config_entries.options))
        self.hass.http.register_view(
            OptionManagerFlowResourceView(self.hass.config_entries.options)
        )
        self.client = TestClient(TestServer(self.hass.http.app, host="127.0.0.1"))
        await self.client.start_server()
        self.stack.push_async_callback(self.client.close)

    async def request(self, path=URL, data=None, user=None, method="POST"):
        async with self.client.request(
            method, path, json=data, headers=self.headers[(user or self.admin).id]
        ) as response:
            return response.status, await response.json()

    async def begin(self, action="provision"):
        status, body = await self.request(data={"handler": self.entry.entry_id})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["step_id"], "init")
        room_field = next(field for field in body["data_schema"] if field["name"] == "room")
        self.assertIn("configured-alpha", str(room_field))
        self.assertNotIn("talk", str(room_field))
        path = URL + "/" + body["flow_id"]
        status, body = await self.request(path, {"room": "configured-alpha", "action": action})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["step_id"], "confirm")
        return path

    async def test_actual_authenticated_http_provision_once_and_preserves_entry(self):
        path = await self.begin()
        status, body = await self.request(path, {"confirm": True})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["step_id"], "paired")
        self.assertEqual(
            body["description_placeholders"],
            {"room": "Configured room label", "code": CODE},
        )
        self.assertEqual(len(self.calls), 1)
        call = self.calls[0]
        self.assertEqual(call.data, {"room": "configured-alpha"})
        self.assertEqual(call.context.user_id, self.admin.id)
        self.assertIsNone(call.context.parent_id)
        _, done = await self.request(path, {})
        self.assertEqual(done["type"], "create_entry")
        self.assertEqual(dict(self.entry.data), self.original)
        self.assertEqual(dict(self.entry.options), {"retained": "unchanged"})
        self.assertNotIn(CODE, repr(self.entry.as_dict()))

    async def test_revoke_has_no_code(self):
        path = await self.begin("revoke")
        _, body = await self.request(path, {"confirm": True})
        self.assertEqual(body["step_id"], "revoked")
        self.assertEqual(self.calls[0].service, "controller_revoke")
        self.assertNotIn(CODE, repr(body))

    async def test_viewer_http_and_direct_no_request_context_cannot_start(self):
        status, _ = await self.request(data={"handler": self.entry.entry_id}, user=self.viewer)
        self.assertEqual(status, 403)
        result = await self.hass.config_entries.options.async_init(
            self.entry.entry_id, context={"user_id": self.admin.id}
        )
        self.assertEqual(result["reason"], "admin_required")
        self.assertEqual(self.calls, [])

    async def test_other_admin_cannot_take_over_flow(self):
        path = await self.begin()
        _, body = await self.request(path, {"confirm": True}, user=self.other)
        self.assertEqual(body["reason"], "admin_required")
        self.assertEqual(self.calls, [])

    async def test_foreign_room_and_unconfirmed_submission_have_no_effect(self):
        _, body = await self.request(data={"handler": self.entry.entry_id})
        path = URL + "/" + body["flow_id"]
        status, _ = await self.request(path, {"room": "talk", "action": "provision"})
        self.assertEqual(status, 400)
        path = await self.begin()
        _, body = await self.request(path, {"confirm": False})
        self.assertEqual(body["errors"], {"base": "confirmation_required"})
        self.assertEqual(self.calls, [])

    async def test_owner_revoked_during_await_cannot_receive_code(self):
        path = await self.begin()
        self.release.clear()
        pending = asyncio.create_task(self.request(path, {"confirm": True}))
        await asyncio.wait_for(self.entered.wait(), 2)
        await self.hass.auth.async_deactivate_user(self.admin)
        self.release.set()
        _, body = await pending
        self.assertEqual(body["reason"], "admin_required")
        self.assertNotIn(CODE, repr(body))
        self.assertEqual(len(self.calls), 1)

    def rebind_physical_endpoint(self):
        changed = copy.deepcopy(dict(self.entry.data))
        changed["endpoints"][0]["identity"] = "02:00:00:00:00:02"
        self.hass.config_entries.async_update_entry(self.entry, data=changed)
        self.assertIs(self.hass.config_entries.async_get_entry(self.entry.entry_id), self.entry)

    async def test_same_room_label_physical_rebind_before_confirm_denied(self):
        path = await self.begin()
        self.rebind_physical_endpoint()
        _, body = await self.request(path, {"confirm": True})
        self.assertEqual(body["reason"], "no_rooms")
        self.assertEqual(self.calls, [])

    async def test_same_room_label_physical_rebind_during_await_hides_code(self):
        path = await self.begin()
        self.release.clear()
        pending = asyncio.create_task(self.request(path, {"confirm": True}))
        await asyncio.wait_for(self.entered.wait(), 2)
        self.rebind_physical_endpoint()
        self.release.set()
        _, body = await pending
        self.assertEqual(body["reason"], "admin_required")
        self.assertNotIn(CODE, repr(body))
        self.assertEqual(len(self.calls), 1)

    async def test_parallel_confirmation_has_one_backend_request(self):
        path = await self.begin()
        self.release.clear()
        pending = asyncio.create_task(self.request(path, {"confirm": True}))
        await asyncio.wait_for(self.entered.wait(), 2)
        _, second = await self.request(path, {"confirm": True})
        self.assertEqual(second["reason"], "request_finished")
        self.release.set()
        await pending
        self.assertEqual(len(self.calls), 1)

    async def test_code_is_not_replayed_by_options_get(self):
        path = await self.begin()
        _, first = await self.request(path, {"confirm": True})
        self.assertEqual(first["description_placeholders"]["code"], CODE)
        _, after = await self.request(path, method="GET")
        self.assertNotIn(CODE, repr(after))
        self.assertEqual(after["type"], "create_entry")
        self.assertEqual(len(self.calls), 1)

    async def test_get_confirmation_is_read_only(self):
        path = await self.begin()
        _, body = await self.request(path, method="GET")
        self.assertEqual(body["step_id"], "confirm")
        self.assertEqual(self.calls, [])

    async def test_malformed_or_failed_service_never_shows_code(self):
        for bad in ("room", "error"):
            self.bad = bad
            path = await self.begin()
            _, body = await self.request(path, {"confirm": True})
            self.assertEqual(body["reason"], "request_unconfirmed")
            self.assertNotIn(CODE, repr(body))


if __name__ == "__main__":
    unittest.main()
