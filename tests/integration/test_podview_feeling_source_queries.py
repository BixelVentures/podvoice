"""Vibe uses exact query-specific rows projected through the normal inert owner transport."""

# ruff: noqa: F811 - imported pytest fixtures intentionally shadowed
import json

import httpx
from integration.test_podview_feeling_playlists import feeling_rig, read  # noqa: F401
from integration.test_podview_mood_playlists import mood_rig  # noqa: F401
from integration.test_podview_music_selection import rig  # noqa: F401

from gatekeeper import podview_feeling
from gatekeeper.podview import BRIDGE

SOURCE_ROWS = {
    "jazz lounge": [
        {"uri": "spotify:playlist:" + "a" * 22, "name": "Playlist from the jazz query"},
    ],
    "hip hop r&b": [
        {"uri": "spotify:playlist:" + "b" * 22, "name": "Playlist from the hip-hop query"},
    ],
    "dance pop": [
        {"uri": "spotify:playlist:" + "c" * 22, "name": "Playlist from the dance query"},
    ],
}


async def test_vibe_queries_control_complete_source_publication(feeling_rig):
    themes = podview_feeling.THEMES
    calls = []
    original = feeling_rig.router._client

    async def recorded(req):
        assert req.method == "POST"
        assert req.url.path.endswith("/services/podconnect/search_playlists")
        args = json.loads(req.content)
        assert args["config_entry_id"] == "account-alpha" and args["limit"] == 3
        assert args["query"] in SOURCE_ROWS
        calls.append(args["query"])
        rows = SOURCE_ROWS[args["query"]]
        return httpx.Response(
            200,
            json={
                "service_response": {
                    "ok": True,
                    "schema": "podconnect.search_playlists.v1",
                    "config_entry_id": "account-alpha",
                    "owner_epoch": feeling_rig.playlist_epoch,
                    "source": "spotify_web_api",
                    "query": args["query"],
                    "limit": 3,
                    "returned_count": len(rows),
                    "playlists": rows,
                }
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(recorded))
    feeling_rig.router._client = client
    try:
        result = await read(feeling_rig)
    finally:
        feeling_rig.router._client = original
        await client.aclose()
    assert sorted(calls) == sorted(SOURCE_ROWS)
    assert result["ok"] is True
    bridge = feeling_rig.app[BRIDGE]
    assert feeling_rig.router.podview_mood_selector.select.await_count == 0
    assert feeling_rig.router.podview_mood_context.await_count == 0
    assert bridge.controls.music.execute_context.await_count == 0
    assert result["candidateSet"]["sourceKind"] == "feeling"
    assert len(bridge.music_selection.sources) == 1
    assert not bridge.music_selection.tasks
    rows = result["data"]["tracks"]
    assert [row["themeId"] for row in rows] == ["jazz_lounge", "hiphop_rnb", "pop_dance"]
    assert len({row["uri"] for row in rows}) == 3
    assert [row["uri"] for row in rows] == [SOURCE_ROWS[query][0]["uri"] for query in SOURCE_ROWS]
    assert [row["name"] for row in rows] == [sample[0]["name"] for sample in SOURCE_ROWS.values()]
    assert all(row["themeTitle"] == themes[row["themeId"]]["title"] for row in rows)
    assert all(row["themeArt"] == themes[row["themeId"]]["image"] for row in rows)
