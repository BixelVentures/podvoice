"""Actual aggregate route, inert owner reads; source collisions are not missing data."""

# ruff: noqa: F811 - imported pytest fixtures intentionally shadowed
import itertools

import pytest
from integration.test_podview_feeling_playlists import feeling_rig, read  # noqa: F401
from integration.test_podview_mood_playlists import mood_rig  # noqa: F401
from integration.test_podview_music_selection import rig  # noqa: F401

from gatekeeper.podview import BRIDGE

QUERIES = ["feel good funk", "peaceful acoustic", "sing along classics"]


@pytest.mark.parametrize(
    "lists,expect",
    [
        ([["a", "c"], ["b"], ["a"]], ["c", "b", "a"]),
        ([["a", "b"], ["a", "c"], ["a"]], ["b", "c", "a"]),
        ([["a", "b", "c"], ["a", "b", "c"], ["a", "b", "c"]], ["a", "b", "c"]),
        ([["a"], ["a"], ["b"]], None),
        ([["a"], [], ["b"]], None),
        ([["a", "a", "c"], ["b"], ["a"]], ["c", "b", "a"]),
    ],
)
async def test_existing_candidates_require_complete_distinct_assignment(
    feeling_rig, monkeypatch, lists, expect
):
    r = feeling_rig
    original = r.router.podview_read

    async def altered(kind, account=None, query=None):
        value = await original(kind, account, query)
        if kind == "playlist_search":
            value["data"]["playlists"] = [
                {"uri": "spotify:playlist:" + x * 22, "name": "Real " + x}
                for x in lists[QUERIES.index(query)]
            ]
        return value

    monkeypatch.setattr(r.router, "podview_read", altered)
    body = await read(r)
    assert len([x for x in r.calls if "search_playlists" in x[1]]) == 3
    assert r.router.podview_mood_selector.select.await_count == 0
    assert r.app[BRIDGE].controls.music.execute_context.await_count == 0
    if expect is None:
        assert body["error"] == "feeling_catalogue_empty"
        assert not r.app[BRIDGE].music_selection.sources
    else:
        assert body["ok"] is True, body
        assert [x["uri"] for x in body["data"]["tracks"]] == [
            "spotify:playlist:" + x * 22 for x in expect
        ]
        assert [x["themeId"] for x in body["data"]["tracks"]] == ["energy", "calm", "familiar"]
        # Exact frozen rows stay unchanged on renew, even where another full assignment exists.
        again = await read(r, renew=True)
        assert again["data"]["tracks"] == body["data"]["tracks"]


async def test_all_admitted_three_result_combinations_obey_matching(feeling_rig, monkeypatch):
    r = feeling_rig
    original = r.router.podview_read
    lists = []

    async def altered(kind, account=None, query=None):
        value = await original(kind, account, query)
        if kind == "playlist_search":
            value["data"]["playlists"] = [
                {"uri": "spotify:playlist:" + x * 22, "name": "Real " + x}
                for x in lists[QUERIES.index(query)]
            ]
        return value

    monkeypatch.setattr(r.router, "podview_read", altered)
    subsets = [list(s) for n in range(4) for s in itertools.combinations("abc", n)]
    for lists in itertools.product(subsets, repeat=3):
        possible = next((c for c in itertools.product(*lists) if len(set(c)) == 3), None)
        r.app[BRIDGE]._feeling_retained = None
        body = await read(r)
        if possible is None:
            assert body["error"] == "feeling_catalogue_empty", (lists, body)
        else:
            assert body["ok"], (lists, body)
            assert [row["uri"] for row in body["data"]["tracks"]] == [
                "spotify:playlist:" + x * 22 for x in possible
            ]
    assert r.router.podview_mood_selector.select.await_count == 0
    assert r.app[BRIDGE].controls.music.execute_context.await_count == 0
