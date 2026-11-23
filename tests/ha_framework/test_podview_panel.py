"""PodView custom panel served from the integration, in the pinned HA cores."""

import hashlib
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import test_controller_admin_services as fixture
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from custom_components.podvoice import panel
from homeassistant.components import frontend, panel_custom

BUNDLE = b"customElements.define('podview-panel', class extends HTMLElement {});\n"


def supports_safe_area() -> bool:
    return panel._supports(panel_custom.async_register_panel, "handle_safe_area")


class PodViewPanelTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # The repo mount is read-only; the bundle lives in a writable temp dir.
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.frontend_dir = Path(temp.name)
        self.bundle = self.frontend_dir / panel.BUNDLE_NAME
        self.bundle.write_bytes(BUNDLE)
        patcher = patch.object(panel, "FRONTEND_DIR", self.frontend_dir)
        patcher.start()
        self.addCleanup(patcher.stop)
        await fixture.ControllerAdminServiceFrameworkTests.asyncSetUp(self)
        self.entry = self.hass.config_entries.async_entries("podvoice")[0]

    def panel(self):
        return self.hass.data.get(frontend.DATA_PANELS, {}).get("podview")

    def static_routes(self):
        # HA adds a StaticResource plus a plain GET route per registered path.
        return [
            resource
            for resource in self.hass.http.app.router.resources()
            if isinstance(resource, web.StaticResource) and resource.canonical == panel.URL_BASE
        ]

    async def reload(self):
        from custom_components.podvoice import async_setup_entry, async_unload_entry

        self.assertTrue(await async_unload_entry(self.hass, self.entry))
        self.assertIsNone(self.panel())
        self.assertTrue(await async_setup_entry(self.hass, self.entry))

    async def test_setup_registers_iframe_custom_panel_with_versioned_module(self):
        registered = self.panel()
        self.assertIsNotNone(registered)
        response = registered.to_response()
        self.assertEqual(response["component_name"], "custom")
        self.assertEqual(response["url_path"], "podview")
        self.assertEqual(response["title"], "PodView")
        self.assertEqual(response["icon"], "mdi:tablet-dashboard")
        self.assertFalse(response["require_admin"])
        config = response["config"]
        self.assertEqual(config["integration_version"], "0.1.25")
        # The timer endpoints the panel may address, each with its HA device.
        devices = self.hass.data["podvoice"].devices
        self.assertEqual(
            config["endpoints"],
            [
                {
                    "endpoint": item["endpoint"],
                    "name": item["name"],
                    "device_id": devices[item["endpoint"]],
                }
                for item in self.entry.data["endpoints"]
            ],
        )
        self.assertTrue(config["endpoints"])
        custom = config["_panel_custom"]
        self.assertEqual(custom["name"], "podview-panel")
        self.assertTrue(custom["embed_iframe"])
        self.assertFalse(custom["trust_external"])
        if supports_safe_area():
            self.assertTrue(custom["handle_safe_area"])
        digest = hashlib.sha256(BUNDLE).hexdigest()[:12]
        self.assertEqual(
            custom["module_url"], f"/podvoice_static/frontend/podview-panel.js?v={digest}"
        )
        self.assertEqual(len(self.static_routes()), 1)
        # Timer services are unaffected by the panel.
        self.assertTrue(self.hass.services.has_service("podvoice", "timer_command"))

    async def test_reload_keeps_one_static_route_and_busts_cache_on_new_bundle(self):
        before = self.panel().config["_panel_custom"]["module_url"]
        await self.reload()
        self.assertEqual(self.panel().config["_panel_custom"]["module_url"], before)
        self.bundle.write_bytes(BUNDLE + b"// next release\n")
        await self.reload()
        after = self.panel().config["_panel_custom"]["module_url"]
        self.assertNotEqual(after, before)
        self.assertRegex(after, r"^/podvoice_static/frontend/podview-panel\.js\?v=[0-9a-f]{12}$")
        self.assertEqual(len(self.static_routes()), 1)
        client = TestClient(TestServer(self.hass.http.app, host="127.0.0.1"))
        await client.start_server()
        self.addAsyncCleanup(client.close)
        async with client.get(after) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(await response.read(), BUNDLE + b"// next release\n")
            self.assertIn("max-age", response.headers.get("Cache-Control", ""))
            self.assertIn("javascript", response.headers.get("Content-Type", ""))

    async def test_unload_removes_panel_only_when_unload_proceeds(self):
        from custom_components.podvoice import async_unload_entry

        bridge = self.hass.data["podvoice"]
        busy = {"timers": [{"id": "inert"}], "finished": []}
        with patch.object(type(bridge), "snapshot", return_value=busy):
            self.assertFalse(await async_unload_entry(self.hass, self.entry))
        self.assertIsNotNone(self.panel())
        self.assertTrue(await async_unload_entry(self.hass, self.entry))
        self.assertIsNone(self.panel())

    async def test_missing_bundle_skips_panel_without_breaking_setup(self):
        from custom_components.podvoice import async_setup_entry, async_unload_entry

        self.assertTrue(await async_unload_entry(self.hass, self.entry))
        self.bundle.unlink()
        with self.assertLogs("custom_components.podvoice.panel", "WARNING") as logs:
            self.assertTrue(await async_setup_entry(self.hass, self.entry))
        self.assertIn("bundle missing", "\n".join(logs.output))
        self.assertIsNone(self.panel())
        self.assertTrue(self.hass.services.has_service("podvoice", "timer_command"))
