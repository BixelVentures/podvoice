"""A real Home Assistant with the PodVoice integration set up (shared by the framework tests)."""

import asyncio
import unittest
from contextlib import AsyncExitStack
from pathlib import Path
from tempfile import TemporaryDirectory

from homeassistant import auth, bootstrap, loader
from homeassistant.auth.const import GROUP_ID_ADMIN, GROUP_ID_USER
from homeassistant.config_entries import ConfigEntries
from homeassistant.const import __version__
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

# HA 2026.11 moved the constant (hassio.const -> http.const); the key is unchanged.
SUPERVISOR_USER_KEY = "hassio_supervisor_user"

ROOT = Path(__file__).resolve().parents[2]
ROOM = "configured-alpha"
ADDON = "23375871_podvoice"


class PodVoiceFramework(unittest.IsolatedAsyncioTestCase):
    async def cancel_task(self, task):
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def asyncSetUp(self):
        self.assertIn(__version__, {"2026.8.2", "2026.11.1"})  # both CI-pinned versions
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
        self.viewer = await self.hass.auth.async_create_user(
            "Viewer fixture", group_ids=[GROUP_ID_USER]
        )
        self.supervisor = await self.hass.auth.async_create_system_user(
            "Supervisor fixture", group_ids=[GROUP_ID_ADMIN]
        )
        self.hass.data[SUPERVISOR_USER_KEY] = self.supervisor
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
        # The retired wall-screen pairing left no admin services behind (2.1.45).
        for service in (
            "controller_list",
            "controller_approve",
            "controller_revoke_identity",
            "controller_revoke",
            "controller_recover",
            "controller_placement",
            "controller_receipt",
        ):
            self.assertFalse(self.hass.services.has_service("podvoice", service))
