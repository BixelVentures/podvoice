"""Observed19Oct playlist rows replayed through the real route; all I/O inert.

Source: normal HA podconnect.search_playlists reads, limit3, one account/epoch.
Only the account/epoch are replaced by fixture aliases. Playlist URI/name rows
are preserved. This proves software behavior on observed data, not live audio.
"""

# ruff: noqa: F811 - imported pytest fixtures intentionally shadowed
import json

import httpx
from integration.test_podview_feeling_playlists import feeling_rig, read  # noqa: F401
from integration.test_podview_mood_playlists import mood_rig  # noqa: F401
from integration.test_podview_music_selection import rig  # noqa: F401

from gatekeeper import podview_feeling
from gatekeeper.podview import BRIDGE

OBSERVED_SOURCE_ROWS = {
    "feel good funk": [],
    "funk": [
        {
            "uri": "spotify:playlist:01ShyhH6iluuvP0fcMcwWz",
            "name": "Top 100 Funk Songs of All Time",
        },
    ],
    "peaceful acoustic": [
        {
            "uri": "spotify:playlist:1llWqBMzdp3rKItC7cTtWY",
            "name": "FEEL GOOD YOGA FLOW",
        },
        {"uri": "spotify:playlist:6bZZjVMaDsWcNJJt9onSeR", "name": "Calm Mornings"},
    ],
    "sing along classics": [
        {
            "uri": "spotify:playlist:2bcXAuCKRtXYslHVa1ZLhl",
            "name": "SHOWER PLAYLIST 🚿 SONGS EVERYONE KNOWS",
        },
        {"uri": "spotify:playlist:4rMLB8C6Y6MW5434efUzIA", "name": "Syng med"},
    ],
}


async def test_observed_energy_query_controls_complete_source_publication(feeling_rig):
    assert podview_feeling.THEMES["energy"] == {
        "title": "Mere energi",
        "query": "funk",
        "image": "assets/indie.png",
    }
    assert podview_feeling.THEMES["calm"]["query"] == "peaceful acoustic"
    assert podview_feeling.THEMES["familiar"]["query"] == "sing along classics"
    themes = podview_feeling.THEMES
    calls = []
    original = feeling_rig.router._client

    async def recorded(req):
        assert req.method == "POST"
        assert req.url.path.endswith("/services/podconnect/search_playlists")
        args = json.loads(req.content)
        assert args["config_entry_id"] == "account-alpha" and args["limit"] == 3
        assert args["query"] in OBSERVED_SOURCE_ROWS
        calls.append(args["query"])
        rows = OBSERVED_SOURCE_ROWS[args["query"]]
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
    assert sorted(calls) == sorted(["funk", "peaceful acoustic", "sing along classics"])
    assert result["ok"] is True
    bridge = feeling_rig.app[BRIDGE]
    assert feeling_rig.router.podview_mood_selector.select.await_count == 0
    assert feeling_rig.router.podview_mood_context.await_count == 0
    assert bridge.controls.music.execute_context.await_count == 0
    assert result["candidateSet"]["sourceKind"] == "feeling"
    assert len(bridge.music_selection.sources) == 1
    assert not bridge.music_selection.tasks
    rows = result["data"]["tracks"]
    assert [row["themeId"] for row in rows] == ["energy", "calm", "familiar"]
    assert len({row["uri"] for row in rows}) == 3
    assert [row["uri"] for row in rows] == [
        OBSERVED_SOURCE_ROWS[query][0]["uri"]
        for query in ["funk", "peaceful acoustic", "sing along classics"]
    ]
    assert all(row["themeTitle"] == themes[row["themeId"]]["title"] for row in rows)
    assert all(row["themeArt"] == themes[row["themeId"]]["image"] for row in rows)
