"""Real Core 2026.8.2 service dispatch with an inert Supervisor writer.

Run in the pinned Home Assistant image with no network and an empty config.
The actual PodVoice setup, ServiceRegistry, Context and auth store stay in use.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import unittest
from contextlib import AsyncExitStack
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from aiohasupervisor.models import AddonState
from aiohttp.test_utils import TestClient, TestServer
from homeassistant import auth, bootstrap, loader
from homeassistant.auth.const import GROUP_ID_ADMIN, GROUP_ID_USER
from homeassistant.components.config.config_entries import (
    OptionManagerFlowIndexView,
    OptionManagerFlowResourceView,
)
from homeassistant.components.hassio.const import DATA_HASSIO_SUPERVISOR_USER
from homeassistant.components.http import HomeAssistantHTTP
from homeassistant.config_entries import ConfigEntries
from homeassistant.const import __version__
from homeassistant.core import Context, HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.setup import async_setup_component

ROOT = Path(__file__).resolve().parents[2]
ROOM = "configured-alpha"
ADDON = "23375871_podvoice"


class ControllerAdminServiceFrameworkTests(unittest.IsolatedAsyncioTestCase):
    async def cancel_task(self, task):
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

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
        self.admin = await self.hass.auth.async_create_user(
            "Admin fixture", group_ids=[GROUP_ID_ADMIN]
        )
        self.viewer = await self.hass.auth.async_create_user(
            "Viewer fixture", group_ids=[GROUP_ID_USER]
        )
        self.supervisor = await self.hass.auth.async_create_system_user(
            "Supervisor fixture", group_ids=[GROUP_ID_ADMIN]
        )
        self.hass.data[DATA_HASSIO_SUPERVISOR_USER] = self.supervisor
        self.writes = []
        self.written = asyncio.Event()

        async def addon_info(slug):
            self.assertEqual(slug, ADDON)
            return SimpleNamespace(slug=slug, state=AddonState.STARTED, stdin=True)

        async def write_addon_stdin(slug, raw):
            self.assertEqual(slug, ADDON)
            self.writes.append(json.loads(raw))
            self.written.set()

        client = SimpleNamespace(
            addons=SimpleNamespace(addon_info=addon_info, write_addon_stdin=write_addon_stdin)
        )
        self.stack.enter_context(
            patch(
                "custom_components.podvoice.controller_admin.get_supervisor_client",
                return_value=client,
            )
        )
        self.assertTrue(
            await async_setup_component(
                self.hass,
                "podvoice",
                {
                    "podvoice": {
                        "endpoints": [
                            {
                                "endpoint": ROOM,
                                "name": "Configured fixture room",
                                "kind": "voice_pe",
                                "identity": "02:00:00:00:00:01",
                            }
                        ]
                    }
                },
            )
        )
        await self.hass.async_block_till_done()
        self.assertIn("podvoice", self.hass.data)
        for service in ("controller_provision", "controller_revoke", "controller_receipt"):
            self.assertTrue(self.hass.services.has_service("podvoice", service))

    async def invoke(self, service, context):
        return await self.hass.services.async_call(
            "podvoice",
            service,
            {"room": ROOM},
            blocking=True,
            return_response=True,
            context=context,
        )

    async def receipt(self, command, context, *, mac=None):
        message = f"{command['nonce']}:{command['action']}:{command['room']}:committed".encode()
        valid_mac = hmac.new(bytes.fromhex(command["key"]), message, hashlib.sha256).hexdigest()
        await self.hass.services.async_call(
            "podvoice",
            "controller_receipt",
            {
                "nonce": command["nonce"],
                "action": command["action"],
                "room": command["room"],
                "outcome": "committed",
                "mac": valid_mac if mac is None else mac,
            },
            blocking=True,
            context=context,
        )

    async def test_core_rejects_missing_nonadmin_indirect_and_system_admin_before_stdin(self):
        for context in (
            Context(),
            Context(user_id=self.viewer.id),
            Context(user_id=self.admin.id, parent_id="automation-parent"),
            Context(user_id=self.supervisor.id),
        ):
            for service in ("controller_provision", "controller_revoke"):
                with self.subTest(context=context.user_id, service=service):
                    with self.assertRaises(HomeAssistantError):
                        await self.invoke(service, context)
        self.assertEqual(self.writes, [])

    async def test_core_awaits_exact_supervisor_receipt_before_returning_code(self):
        task = asyncio.create_task(
            self.invoke("controller_provision", Context(user_id=self.admin.id))
        )
        self.addAsyncCleanup(self.cancel_task, task)
        await asyncio.wait_for(self.written.wait(), 3)
        self.assertFalse(task.done())
        self.assertEqual(len(self.writes), 1)
        command = self.writes[0]
        self.assertEqual((command["action"], command["room"]), ("provision", ROOM))
        await self.receipt(command, Context(user_id=self.admin.id))
        await self.receipt(command, Context(user_id=self.supervisor.id), mac="0" * 64)
        self.assertFalse(task.done())
        await self.receipt(command, Context(user_id=self.supervisor.id))
        result = await asyncio.wait_for(task, 3)
        self.assertEqual(result, {"ok": True, "room": ROOM, "code": command["code"]})
        await self.receipt(command, Context(user_id=self.supervisor.id))
        self.assertEqual(len(self.writes), 1)

    async def test_core_awaits_revoke_without_returning_a_code(self):
        task = asyncio.create_task(self.invoke("controller_revoke", Context(user_id=self.admin.id)))
        self.addAsyncCleanup(self.cancel_task, task)
        await asyncio.wait_for(self.written.wait(), 3)
        command = self.writes[0]
        self.assertEqual(command["action"], "revoke")
        self.assertNotIn("code", command)
        self.assertFalse(task.done())
        await self.receipt(command, Context(user_id=self.supervisor.id))
        self.assertEqual(await asyncio.wait_for(task, 3), {"ok": True, "room": ROOM})

    async def test_authenticated_http_options_flow_reaches_registered_service_and_receipt(self):
        """The real HTTP principal reaches the real service before showing a code."""
        entry = self.hass.config_entries.async_entries("podvoice")[0]
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
        client = TestClient(TestServer(self.hass.http.app, host="127.0.0.1"))
        await client.start_server()
        self.stack.push_async_callback(client.close)
        refresh = await self.hass.auth.async_create_refresh_token(
            self.admin, client_id="http://localhost"
        )
        headers = {"Authorization": "Bearer " + self.hass.auth.async_create_access_token(refresh)}
        base = "/api/config/config_entries/options/flow"

        async def post(path, data):
            async with client.post(path, json=data, headers=headers) as response:
                return response.status, await response.json()

        status, begin = await post(base, {"handler": entry.entry_id})
        self.assertEqual(status, 200, begin)
        self.assertEqual(begin["step_id"], "init")
        path = f"{base}/{begin['flow_id']}"
        status, selected = await post(path, {"room": ROOM, "action": "provision"})
        self.assertEqual(status, 200, selected)
        self.assertEqual(selected["step_id"], "confirm")
        self.assertEqual(self.writes, [])

        pending = asyncio.create_task(post(path, {"confirm": True}))
        self.addAsyncCleanup(self.cancel_task, pending)
        await asyncio.wait_for(self.written.wait(), 3)
        self.assertFalse(pending.done())
        self.assertEqual(len(self.writes), 1)
        command = self.writes[0]
        self.assertEqual((command["action"], command["room"]), ("provision", ROOM))
        await self.receipt(command, Context(user_id=self.supervisor.id))
        status, body = await asyncio.wait_for(pending, 3)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["step_id"], "paired")
        self.assertEqual(
            body["description_placeholders"],
            {"room": "Configured fixture room", "code": command["code"]},
        )
        self.assertNotIn(command["code"], repr(entry.as_dict()))


if __name__ == "__main__":
    unittest.main()
