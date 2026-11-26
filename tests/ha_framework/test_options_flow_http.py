"""Real HA HTTP options requests: PodView's panel settings, for administrators only.

Run inside the pinned HA image with no network, mounted read-only at /candidate.
No HA packages/classes/auth/request middleware are replaced or stubbed.
"""

import copy
import json
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
from homeassistant.core import HomeAssistant

ROOT = Path(__file__).resolve().parents[2]
URL = "/api/config/config_entries/options/flow"


class OptionsHTTPTests(unittest.IsolatedAsyncioTestCase):
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

    async def open(self, user=None):
        """The options flow opens on PodView's panel settings (pairing and its profiles are gone)."""
        status, body = await self.request(data={"handler": self.entry.entry_id}, user=user)
        self.assertEqual(status, 200, body)
        return URL + "/" + body["flow_id"], body

    async def test_viewer_http_and_direct_no_request_context_cannot_start(self):
        # Real HA require_admin returns a plaintext 401 before the flow runs.
        # Keep the shared helper strict JSON for normal flow responses.
        async with self.client.post(
            URL,
            json={"handler": self.entry.entry_id},
            headers=self.headers[self.viewer.id],
        ) as response:
            self.assertEqual(response.status, 401)
            self.assertEqual(response.content_type, "text/plain")
            self.assertTrue((await response.text()).strip())
        result = await self.hass.config_entries.options.async_init(
            self.entry.entry_id, context={"user_id": self.admin.id}
        )
        self.assertEqual(result["reason"], "admin_required")

    async def test_podview_settings_are_stored_beside_existing_options(self):
        path, body = await self.open()
        self.assertEqual((body["type"], body["step_id"]), ("form", "podview"))
        fields = {field["name"]: field for field in body["data_schema"]}
        self.assertEqual(
            set(fields), {"weather_entity", "default_area", "idle_home_seconds", "photo_album_url"}
        )
        self.assertEqual(fields["photo_album_url"]["selector"]["text"]["type"], "url")
        self.assertEqual(fields["weather_entity"]["selector"]["entity"]["domain"], ["weather"])
        self.assertIn("area", fields["default_area"]["selector"])
        number = fields["idle_home_seconds"]["selector"]["number"]
        self.assertEqual((number["min"], number["max"], number["step"]), (0, 3600, 10))
        self.assertEqual(fields["idle_home_seconds"]["default"], 120)
        status, body = await self.request(
            path, {"weather_entity": "weather.home", "idle_home_seconds": 300}
        )
        self.assertEqual((status, body["type"]), (200, "create_entry"), body)
        self.assertEqual(
            dict(self.entry.options),
            {"retained": "unchanged", "weather_entity": "weather.home", "idle_home_seconds": 300},
        )
        self.assertEqual(dict(self.entry.data), self.original)
        # Clearing a selection removes the setting; other options stay.
        path, body = await self.open()
        status, body = await self.request(path, {"idle_home_seconds": 0})
        self.assertEqual((status, body["type"]), (200, "create_entry"), body)
        self.assertEqual(
            dict(self.entry.options), {"retained": "unchanged", "idle_home_seconds": 0}
        )

    async def test_the_shared_album_link_is_checked_and_an_old_one_refused_in_danish(self):
        path, _ = await self.open()
        old = "https://www.icloud.com/sharedalbum/#B0aGWZuqDGJjmgk"
        status, body = await self.request(path, {"idle_home_seconds": 120, "photo_album_url": old})
        self.assertEqual((status, body["type"]), (200, "form"), body)
        self.assertEqual(body["errors"], {"photo_album_url": "old_album_link"})
        status, body = await self.request(
            path, {"idle_home_seconds": 120, "photo_album_url": "https://example.com/album"}
        )
        self.assertEqual(body["errors"], {"photo_album_url": "invalid_album_link"})
        self.assertEqual(dict(self.entry.options), {"retained": "unchanged"})
        link = "https://photos.icloud.com/shared/album/0TestGuid0Abcdefghijk"
        status, body = await self.request(path, {"idle_home_seconds": 120, "photo_album_url": link})
        self.assertEqual((status, body["type"]), (200, "create_entry"), body)
        self.assertEqual(self.entry.options["photo_album_url"], link)
        # An empty link is no album: the option goes and Ro keeps its own photo.
        path, _ = await self.open()
        status, body = await self.request(path, {"idle_home_seconds": 120, "photo_album_url": ""})
        self.assertNotIn("photo_album_url", self.entry.options)
        translations = json.loads(
            (ROOT / "custom_components/podvoice/translations/da.json").read_text(encoding="utf-8")
        )
        self.assertIn("Kopiér link", translations["options"]["error"]["old_album_link"])

    async def test_podview_settings_refused_for_viewer_and_other_admin(self):
        async with self.client.post(
            URL, json={"handler": self.entry.entry_id}, headers=self.headers[self.viewer.id]
        ) as response:
            self.assertEqual(response.status, 401)
        path, body = await self.open()
        self.assertEqual(body["step_id"], "podview")
        _, body = await self.request(path, {"idle_home_seconds": 600}, user=self.other)
        self.assertEqual(body["reason"], "admin_required")
        self.assertEqual(dict(self.entry.options), {"retained": "unchanged"})


if __name__ == "__main__":
    unittest.main()
