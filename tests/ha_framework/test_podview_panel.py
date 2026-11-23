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
LOADER = b"import('./podview-panel.js');\n"
ICON = b"<svg xmlns='http://www.w3.org/2000/svg'/>"


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
        self.loader = self.frontend_dir / panel.LOADER_NAME
        self.loader.write_bytes(LOADER)
        (self.frontend_dir / "podview-panel.css").write_bytes(b"body{}")
        self.icon = self.frontend_dir / "assets" / "icons" / "sun.svg"
        self.icon.parent.mkdir(parents=True)
        self.icon.write_bytes(ICON)
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
            resource.canonical
            for resource in self.hass.http.app.router.resources()
            if isinstance(resource, web.StaticResource)
            and resource.canonical.startswith(panel.URL_BASE)
        ]

    def expected_digest(self):
        digest = hashlib.sha256()
        for path in sorted(
            (p for p in self.frontend_dir.rglob("*") if p.is_file()),
            key=lambda p: p.relative_to(self.frontend_dir).as_posix(),
        ):
            relative = path.relative_to(self.frontend_dir).as_posix()
            digest.update(relative.encode() + b"\0" + path.read_bytes())
        return digest.hexdigest()[:12]

    async def client(self):
        client = TestClient(TestServer(self.hass.http.app, host="127.0.0.1"))
        await client.start_server()
        self.addAsyncCleanup(client.close)
        return client

    async def reload(self):
        from custom_components.podvoice import async_setup_entry, async_unload_entry

        self.assertTrue(await async_unload_entry(self.hass, self.entry))
        self.assertIsNone(self.panel())
        self.assertTrue(await async_setup_entry(self.hass, self.entry))

    async def test_setup_registers_iframe_custom_panel_with_versioned_loader(self):
        registered = self.panel()
        self.assertIsNotNone(registered)
        response = registered.to_response()
        self.assertEqual(response["component_name"], "custom")
        self.assertEqual(response["url_path"], "podview")
        self.assertEqual(response["title"], "PodView")
        self.assertEqual(response["icon"], "mdi:tablet-dashboard")
        self.assertFalse(response["require_admin"])
        config = response["config"]
        digest = self.expected_digest()
        custom = config.pop("_panel_custom")
        # Devices and the integration version are the ones HA registered.
        devices = self.hass.data["podvoice"].devices
        self.assertEqual(
            config,
            {
                "integration_version": "0.1.25",
                "bundle": digest,
                "endpoints": [
                    {
                        "endpoint": item["endpoint"],
                        "name": item["name"],
                        "device_id": devices[item["endpoint"]],
                    }
                    for item in self.entry.data["endpoints"]
                ],
                "weather_entity": None,
                "default_area": None,
                "idle_home_seconds": 120,
                "heartbeat_seconds": 60,
            },
        )
        self.assertTrue(config["endpoints"])
        self.assertEqual(custom["name"], "podview-panel")
        self.assertTrue(custom["embed_iframe"])
        self.assertFalse(custom["trust_external"])
        if supports_safe_area():
            self.assertTrue(custom["handle_safe_area"])
        self.assertEqual(
            custom["module_url"], f"/podvoice_static/frontend/{digest}/podview-loader.js"
        )
        self.assertEqual(self.static_routes(), [f"/podvoice_static/frontend/{digest}"])
        # Timer services are unaffected by the panel.
        self.assertTrue(self.hass.services.has_service("podvoice", "timer_command"))

    async def test_every_asset_is_served_under_the_digest_with_long_cache(self):
        base = f"/podvoice_static/frontend/{self.expected_digest()}"
        client = await self.client()
        for path, body, kind in (
            ("podview-loader.js", LOADER, "javascript"),
            ("podview-panel.js", BUNDLE, "javascript"),
            ("podview-panel.css", b"body{}", "css"),
            ("assets/icons/sun.svg", ICON, "svg"),
        ):
            async with client.get(f"{base}/{path}") as response:
                self.assertEqual(response.status, 200, path)
                self.assertEqual(await response.read(), body)
                self.assertIn("max-age", response.headers.get("Cache-Control", ""), path)
                self.assertIn(kind, response.headers.get("Content-Type", ""), path)
        # The old unversioned route is gone.
        async with client.get("/podvoice_static/frontend/podview-panel.js") as response:
            self.assertEqual(response.status, 404)

    async def test_reload_adds_one_route_per_digest_and_a_changed_asset_changes_the_url(self):
        before = self.panel().config["_panel_custom"]["module_url"]
        await self.reload()
        self.assertEqual(self.panel().config["_panel_custom"]["module_url"], before)
        self.assertEqual(len(self.static_routes()), 1)
        # Only an icon changes: the whole bundle still gets a new URL.
        self.icon.write_bytes(ICON + b"<!-- next release -->")
        await self.reload()
        digest = self.expected_digest()
        after = self.panel().config["_panel_custom"]["module_url"]
        self.assertNotEqual(after, before)
        self.assertEqual(after, f"/podvoice_static/frontend/{digest}/podview-loader.js")
        self.assertEqual(self.panel().config["bundle"], digest)
        self.assertEqual(len(self.static_routes()), 2)
        await self.reload()
        self.assertEqual(len(self.static_routes()), 2)
        client = await self.client()
        async with client.get(
            f"/podvoice_static/frontend/{digest}/assets/icons/sun.svg"
        ) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(await response.read(), ICON + b"<!-- next release -->")
            self.assertIn("max-age", response.headers.get("Cache-Control", ""))

    async def test_new_options_reach_the_panel_config_without_reload(self):
        self.hass.config_entries.async_update_entry(
            self.entry,
            options={
                "weather_entity": "weather.home",
                "default_area": "kitchen",
                "idle_home_seconds": 300,
            },
        )
        await self.hass.async_block_till_done()
        config = self.panel().config
        self.assertEqual(config["weather_entity"], "weather.home")
        self.assertEqual(config["default_area"], "kitchen")
        self.assertEqual(config["idle_home_seconds"], 300)
        self.hass.config_entries.async_update_entry(self.entry, options={"idle_home_seconds": 0})
        await self.hass.async_block_till_done()
        config = self.panel().config
        self.assertEqual((config["weather_entity"], config["idle_home_seconds"]), (None, 0))
        self.assertEqual(len(self.static_routes()), 1)

    async def test_unload_removes_panel_only_when_unload_proceeds(self):
        from custom_components.podvoice import async_unload_entry

        bridge = self.hass.data["podvoice"]
        busy = {"timers": [{"id": "inert"}], "finished": []}
        with patch.object(type(bridge), "snapshot", return_value=busy):
            self.assertFalse(await async_unload_entry(self.hass, self.entry))
        self.assertIsNotNone(self.panel())
        self.assertTrue(await async_unload_entry(self.hass, self.entry))
        self.assertIsNone(self.panel())

    async def test_missing_loader_or_bundle_skips_panel_without_breaking_setup(self):
        from custom_components.podvoice import async_setup_entry, async_unload_entry

        for missing in (self.loader, self.bundle):
            content = missing.read_bytes()
            self.assertTrue(await async_unload_entry(self.hass, self.entry))
            missing.unlink()
            with self.assertLogs("custom_components.podvoice.panel", "WARNING") as logs:
                self.assertTrue(await async_setup_entry(self.hass, self.entry))
            self.assertIn("bundle missing", "\n".join(logs.output))
            self.assertIsNone(self.panel())
            self.assertTrue(self.hass.services.has_service("podvoice", "timer_command"))
            missing.write_bytes(content)
