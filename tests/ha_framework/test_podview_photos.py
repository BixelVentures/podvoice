"""Ro's shared album in the pinned HA cores: the option, the sensor, podvoice.photos and the authenticated view.

The CloudKit side is a fake built from tests/fixtures/icloud_album (no network); everything Home Assistant owns
(auth, signed paths, the HTTP view, the options flow, the entity) is real.
"""

import json
import os
import unittest
from pathlib import Path
from types import SimpleNamespace

import ha_fixture as fixture
from aiohttp.test_utils import TestClient, TestServer
from custom_components.podvoice import photos, photos_cloud
from homeassistant.core import Context
from homeassistant.exceptions import Unauthorized

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "icloud_album"
LINK = "https://photos.icloud.com/shared/album/0TestGuid0Abcdefghijk"
JPEG = b"\xff\xd8\xff\xe0" + b"1" * 256


def records(*names):
    out = []
    for name in names:
        out.extend(json.loads((FIXTURES / name).read_text())["zones"][0]["records"])
    return out


class FakeCloud:
    """CloudAlbum's surface, answering from the fixtures."""

    def __init__(self, guid):
        self.guid = guid
        self.share = SimpleNamespace(title="HA podview")
        self.polls = 0

    async def changes(self, sync_token, masters=None):
        self.polls += 1
        found = records("changes_full_page1.json", "changes_full_page2.json")
        return photos_cloud.read_changes(found, "sync-1", sync_token is None)

    async def download(self, url):
        return JPEG


class PodViewPhotoTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await fixture.PodVoiceFramework.asyncSetUp(self)
        self.entry = self.hass.config_entries.async_entries("podvoice")[0]
        self.album = photos.album_of(self.hass)
        self.assertIsNotNone(self.album)
        self.album._cloud_factory = FakeCloud
        refresh = await self.hass.auth.async_create_refresh_token(
            self.viewer, client_id="http://localhost"
        )
        self.bearer = {
            "Authorization": "Bearer " + self.hass.auth.async_create_access_token(refresh)
        }
        self.client = TestClient(TestServer(self.hass.http.app, host="127.0.0.1"))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)

    async def call(self, service, user=None):
        return await self.hass.services.async_call(
            "podvoice",
            service,
            {},
            blocking=True,
            return_response=True,
            context=Context(user_id=(user or self.viewer).id),
        )

    async def configure(self):
        self.hass.config_entries.async_update_entry(self.entry, options={photos.OPTION: LINK})
        await self.hass.async_block_till_done()

    async def test_without_a_link_nothing_polls_and_the_list_is_empty(self):
        answer = await self.call("photos")
        self.assertEqual((answer["configured"], answer["photos"]), (False, []))
        state = self.hass.states.get("sensor.podview_fotoalbum")
        self.assertIsNotNone(state)
        self.assertEqual(state.state, "unknown")
        with self.assertRaises(Unauthorized):
            await self.hass.services.async_call(
                "podvoice", "photos", {}, blocking=True, return_response=True, context=Context()
            )

    async def test_the_album_reaches_the_list_the_sensor_and_the_view(self):
        await self.configure()
        answer = await self.call("photos_refresh")
        self.assertEqual(answer["album"], "HA podview")
        self.assertEqual([photo["id"] for photo in answer["photos"]], ["A-2", "A-1"])
        first = answer["photos"][1]
        self.assertEqual((first["width"], first["height"], first["portrait"]), (1536, 2048, True))
        self.assertTrue(first["url"].startswith("/api/podvoice/photos/A-1?v="))
        self.assertIn("authSig=", first["url"])
        cached = self.hass.config.path("podvoice", "photos", "A-1.jpg")
        self.assertTrue(await self.hass.async_add_executor_job(os.path.isfile, cached))

        state = self.hass.states.get("sensor.podview_fotoalbum")
        self.assertEqual(state.state, "2")
        self.assertEqual(state.attributes["album"], "HA podview")
        self.assertEqual(state.attributes["link"], "https://photos.icloud.com/shared/album/…")
        self.assertIsNone(state.attributes["last_error"])
        self.assertNotIn("0TestGuid", json.dumps(dict(state.attributes)))

        # The signed URL needs no header; the ETag answers 304 and the copy is immutable.
        async with self.client.get(first["url"]) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.content_type, "image/jpeg")
            self.assertEqual(await response.read(), JPEG)
            etag = response.headers["ETag"]
            self.assertIn("immutable", response.headers["Cache-Control"])
        async with self.client.get(first["url"], headers={"If-None-Match": etag}) as response:
            self.assertEqual(response.status, 304)
        async with self.client.get("/api/podvoice/photos/A-1", headers=self.bearer) as response:
            self.assertEqual(response.status, 200)
        # No auth, a tampered signature, or an id the album does not have.
        async with self.client.get("/api/podvoice/photos/A-1") as response:
            self.assertEqual(response.status, 401)
        async with self.client.get(first["url"].replace("A-1?", "A-2?")) as response:
            self.assertEqual(response.status, 401)
        async with self.client.get("/api/podvoice/photos/A-9", headers=self.bearer) as response:
            self.assertEqual(response.status, 404)
        async with self.client.get("/api/podvoice/photos/..%2Fx", headers=self.bearer) as response:
            self.assertIn(response.status, (400, 404))  # HA refuses the path itself, else the view.

    async def test_removing_the_link_stops_the_album(self):
        await self.configure()
        await self.call("photos_refresh")
        self.hass.config_entries.async_update_entry(self.entry, options={})
        await self.hass.async_block_till_done()
        answer = await self.call("photos")
        self.assertEqual((answer["configured"], answer["photos"]), (False, []))


if __name__ == "__main__":
    unittest.main()
