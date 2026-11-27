"""Find musik's panel services (search, activities, AI picks) in a real HA core, for a non-admin user."""

import unittest
from unittest.mock import patch

import ha_fixture as fixture
import voluptuous as vol
from aiohttp import ClientSession, web
from aiohttp.test_utils import TestServer
from custom_components.podvoice import find_music
from homeassistant.core import Context, SupportsResponse
from homeassistant.exceptions import HomeAssistantError, Unauthorized

ACCOUNT = "podconnect-entry"
TRACK = "spotify:track:" + "A" * 22
COVER = {"kind": "album_cover", "provider": "spotify", "url": "https://i.scdn.co/image/abc"}
PLAN = {
    "ok": True,
    "schema": "podview.find_music_picks.v1",
    "shelves": [
        {
            "slot": "moment",
            "title": "Regnvejr og torsdag aften",
            "why": "Fordi det regner og det er torsdag aften.",
            "queries": ["rainy evening jazz", "cozy acoustic"],
        },
        {
            "slot": "season",
            "title": "Op mod jul",
            "why": "Fordi der er 35 dage til jul.",
            "queries": ["jul"],
        },
    ],
}


def playlist(index):
    return "spotify:playlist:" + str(index).rjust(22, "P")


class FindMusicFrameworkTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await fixture.PodVoiceFramework.asyncSetUp(self)
        self.calls = []
        self.limited = False

        async def search_tracks(call):
            self.calls.append(("search_tracks", dict(call.data)))
            if self.limited:
                raise HomeAssistantError("Spotify rate limited search; try again later")
            return {
                "ok": True,
                "schema": "podconnect.search_tracks.v1",
                "config_entry_id": call.data["config_entry_id"],
                "source": "spotify_web_api",
                "query": call.data["query"],
                "coverage": "spotify_search_sample",
                "limit": call.data["limit"],
                "tracks": [
                    {"name": "Holocene", "artist": "Bon Iver", "uri": TRACK, "artwork": COVER}
                ],
            }

        async def search_playlists(call):
            self.calls.append(("search_playlists", dict(call.data)))
            base = len([c for c in self.calls if c[0] == "search_playlists"]) * 10
            return {
                "ok": True,
                "schema": "podconnect.search_playlists.v1",
                "config_entry_id": call.data["config_entry_id"],
                "owner_epoch": "epoch",
                "source": "spotify_web_api",
                "query": call.data["query"],
                "limit": call.data["limit"],
                "playlists": [
                    {"uri": playlist(base + i), "name": f"{call.data['query']} {i}"}
                    for i in range(3)
                ],
                "returned_count": 3,
            }

        async def top_artists(call):
            self.calls.append(("top_artists", dict(call.data)))
            return {
                "ok": True,
                "schema": "podconnect.top_artists.v1",
                "config_entry_id": call.data["config_entry_id"],
                "artists": [
                    {"id": "x" * 22, "uri": "spotify:artist:" + "x" * 22, "name": "Bon Iver"}
                ],
            }

        for name, handler in (
            ("search_tracks", search_tracks),
            ("search_playlists", search_playlists),
            ("top_artists", top_artists),
        ):
            self.hass.services.async_register(
                "podconnect", name, handler, supports_response=SupportsResponse.ONLY
            )
        self.hass.states.async_set("weather.hjem", "rainy", {"temperature": 6.4})
        patcher = patch.object(find_music, "podconnect_account", lambda hass: ACCOUNT)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.addon_requests = []
        self.addon_answer = PLAN

        async def picks(request):
            self.addon_requests.append((dict(request.headers), await request.json()))
            return web.json_response(self.addon_answer)

        app = web.Application()
        app.router.add_post("/view/api/find-music/picks", picks)
        self.addon = TestServer(app, host="127.0.0.1")
        await self.addon.start_server()
        self.addAsyncCleanup(self.addon.close)
        patcher = patch.object(
            find_music, "ADDON_PICKS", str(self.addon.make_url("/view/api/find-music/picks"))
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        # HA's shared session resolves through zeroconf, which a networkless CI container lacks.
        session = ClientSession()
        self.addAsyncCleanup(session.close)
        patcher = patch.object(find_music, "async_get_clientsession", return_value=session)
        patcher.start()
        self.addCleanup(patcher.stop)

    async def call(self, service, data, context=None):
        return await self.hass.services.async_call(
            "podvoice",
            service,
            data,
            blocking=True,
            return_response=True,
            context=context or Context(user_id=self.viewer.id),
        )

    async def test_registered_and_refused_without_a_user(self):
        for name in ("music_search", "music_activities", "music_picks"):
            self.assertIn(name, self.hass.data["podvoice_panel_services"])
            with self.assertRaises(Unauthorized):
                await self.call(name, {"query": "x"} if name == "music_search" else {}, Context())
        self.assertEqual(self.calls, [])

    async def test_a_non_admin_searches_spotify_with_at_most_ten_rows_once(self):
        self.assertFalse(self.viewer.is_admin)
        result = await self.call("music_search", {"query": "  bon   iver "})
        self.assertEqual(
            result,
            {
                "ok": True,
                "kind": "track",
                "query": "bon iver",
                "items": [
                    {
                        "kind": "track",
                        "uri": TRACK,
                        "name": "Holocene",
                        "byline": "Bon Iver",
                        "artwork": "https://i.scdn.co/image/abc",
                    }
                ],
            },
        )
        await self.call("music_search", {"query": "Bon Iver"})
        self.assertEqual(
            self.calls,
            [("search_tracks", {"config_entry_id": ACCOUNT, "query": "bon iver", "limit": 10})],
        )

    async def test_an_activity_searches_its_playlists(self):
        result = await self.call("music_search", {"activity": "cooking"})
        self.assertTrue(result["ok"])
        self.assertEqual(
            (result["kind"], result["query"], result["activity"]),
            ("playlist", "cooking", "cooking"),
        )
        self.assertEqual(len(result["items"]), 3)
        self.assertEqual(self.calls[0][1]["limit"], 10)
        with self.assertRaises(vol.Invalid):
            await self.call("music_search", {"activity": "invented"})
        with self.assertRaises(vol.Invalid):
            await self.call("music_search", {"activity": "focus", "query": "x"})

    async def test_the_walls_last_activities_are_kept_per_user_without_spotify(self):
        self.assertEqual(await self.call("music_activities", {}), {"ok": True, "history": []})
        for used in ("focus", "sleep", "focus", "party", "hygge", "workout"):
            result = await self.call("music_activities", {"used": used})
        self.assertEqual(
            [row["activity"] for row in result["history"]], ["workout", "hygge", "party", "focus"]
        )
        self.assertTrue(all(row["at"] for row in result["history"]))
        # Another wall (another signed-in user) has its own history.
        other = Context(user_id=self.admin.id)
        self.assertEqual((await self.call("music_activities", {}, other))["history"], [])
        with self.assertRaises(vol.Invalid):
            await self.call("music_activities", {"used": "invented"})
        self.assertEqual(self.calls, [])

    async def test_a_rate_limit_is_said_and_pauses_spotify_reads(self):
        self.limited = True
        self.assertEqual((await self.call("music_search", {"query": "a"}))["error"], "rate_limited")
        self.limited = False
        self.assertEqual((await self.call("music_search", {"query": "b"}))["error"], "rate_limited")
        self.assertEqual(len(self.calls), 1)

    async def test_ai_picks_are_real_playlists_with_the_addons_reasons(self):
        result = await self.call("music_picks", {"weather_entity": "weather.hjem"})
        self.assertTrue(result["ok"])
        self.assertEqual([shelf["id"] for shelf in result["shelves"]], ["ai_moment", "ai_season"])
        moment = result["shelves"][0]
        self.assertEqual(moment["why"], "Fordi det regner og det er torsdag aften.")
        self.assertEqual(len(moment["items"]), 6)
        self.assertTrue(all(item["kind"] == "playlist" for item in moment["items"]))
        headers, facts = self.addon_requests[0]
        self.assertEqual(headers.get("X-PodView-Request"), "1")
        self.assertEqual(set(facts), {"date", "hour", "weather", "artists"})
        self.assertEqual(facts["weather"], {"condition": "rainy", "temperature": 6.4})
        self.assertEqual(facts["artists"], ["Bon Iver"])
        searches = [data for name, data in self.calls if name == "search_playlists"]
        self.assertEqual({data["limit"] for data in searches}, {10})
        # Cached: a reopened panel asks neither the add-on nor Spotify again.
        await self.call("music_picks", {"weather_entity": "weather.hjem"})
        self.assertEqual(len(self.addon_requests), 1)
        self.assertEqual(len([c for c in self.calls if c[0] == "search_playlists"]), len(searches))

    async def test_without_the_addon_ai_picks_say_so_and_search_still_works(self):
        await self.addon.close()
        result = await self.call("music_picks", {})
        self.assertEqual(result, {"ok": False, "error": "addon_unavailable", "shelves": []})
        self.assertTrue((await self.call("music_search", {"query": "jazz"}))["ok"])

    async def test_ai_unavailable_in_the_addon_is_passed_on(self):
        self.addon_answer = {"ok": False, "error": "ai_unavailable"}
        result = await self.call("music_picks", {})
        self.assertEqual(result, {"ok": False, "error": "ai_unavailable", "shelves": []})
        self.assertFalse(any(name == "search_playlists" for name, _ in self.calls))
