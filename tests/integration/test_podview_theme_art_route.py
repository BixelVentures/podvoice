"""Canonical music read and authenticated art route; all provider I/O is inert."""

# ruff: noqa: F811 - imported pytest fixtures intentionally shadowed by test arguments

import httpx
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_mood_playlists import mood_rig  # noqa: F401
from integration.test_podview_music_selection import rig  # noqa: F401
from unit.test_podview_theme_art import owner, response, webp


async def test_mood_reads_only_project_verified_cache_and_preserve_spotify_art(mood_rig, tmp_path):
    calls = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: calls.append(request) or response())
    ) as provider:
        art = owner(tmp_path, provider)
        mood_rig.router.podview_theme_art = art
        mood_rig.playlist_artwork = True
        async with TestClient(TestServer(mood_rig.app)) as client:
            route = "/view/api/music?kind=mood&account=account-alpha"
            cold = await (await client.get(route)).json()
            assert cold["ok"] and calls == []
            assert all(row["themeArt"].startswith("assets/") for row in cold["data"]["tracks"])
            cached = await art.generate("calm", current=lambda: True)
            warm = await (await client.get(route)).json()
            rows = {row["themeId"]: row for row in warm["data"]["tracks"]}
            cold_rows = {row["themeId"]: row for row in cold["data"]["tracks"]}
            assert rows["calm"]["themeArt"] == cached
            assert rows["calm"]["artwork"] == cold_rows["calm"]["artwork"]
            assert rows["calm"]["uri"] == cold_rows["calm"]["uri"]
            assert rows["cooking"]["themeArt"] == cold_rows["cooking"]["themeArt"]
            assert len(calls) == 1 and mood_rig.router.podview_mood_selector.select.await_count == 1
            digest = cached.rsplit("/", 1)[1][:-5]
            (art.store.directory / f"calm-{digest}.webp").unlink()
            missing = await (await client.get(route)).json()
            assert (
                next(row for row in missing["data"]["tracks"] if row["themeId"] == "calm")[
                    "themeArt"
                ]
                == cold_rows["calm"]["themeArt"]
            )
            assert len(calls) == 1


async def test_immutable_local_image_reuses_view_guard_and_never_generates(mood_rig, tmp_path):
    calls = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: calls.append(request) or response())
    ) as provider:
        art = owner(tmp_path, provider)
        mood_rig.router.podview_theme_art = art
        cached = await art.generate("calm", current=lambda: True)
        async with TestClient(TestServer(mood_rig.app)) as client:
            image = await client.get("/view/" + cached)
            assert image.status == 200 and await image.read() == webp()
            assert image.content_type == "image/webp"
            assert image.headers["X-PodView-Art-Provenance"] == "generated-theme-illustration"
            assert (
                "private" in image.headers["Cache-Control"]
                and "immutable" in image.headers["Cache-Control"]
            )
            assert (
                await client.get("/view/" + cached, headers={"Sec-Fetch-Site": "cross-site"})
            ).status == 403
            assert (await client.get("/view/theme-art/calm/" + "f" * 64 + ".webp")).status == 404
            assert (await client.get("/view/theme-art/unknown/" + "f" * 64 + ".webp")).status == 404
            assert (await client.get("/view/theme-art/calm/not-a-digest.webp")).status == 404
            assert (await client.get("/view/theme-art/calm/ledger.json")).status == 404
            assert len(calls) == 1
        assert art._closed is True


async def test_default_off_asset_route_does_not_adopt_static_or_read_arbitrary_files(mood_rig):
    async with TestClient(TestServer(mood_rig.app)) as client:
        result = await client.get("/view/theme-art/calm/" + "f" * 64 + ".webp")
        assert result.status == 404
        assert "image/webp" not in result.headers.get("Content-Type", "")
