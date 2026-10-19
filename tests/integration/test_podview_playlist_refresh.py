"""Actual route via inert ports: no sockets, providers, grants or household effects."""

# ruff: noqa: F811 - imported pytest fixture names are injection points
import itertools
import json

import httpx
import pytest
from aiohttp.test_utils import make_mocked_request
from integration.test_podview_mood_playlists import mood_rig  # noqa:F401
from integration.test_podview_music_selection import rig  # noqa:F401

from gatekeeper.podview import BRIDGE, _mood_music
from gatekeeper.podview_feeling import assign_playlists


async def direct(r, reason=""):
    request = make_mocked_request(
        "GET",
        "/view/api/music?kind=mood&account=account-alpha" + ("&" + reason + "=1" if reason else ""),
        headers={"Cookie": "podview_control=grant"},
        app=r.app,
    )
    return json.loads((await _mood_music(request, r.app[BRIDGE], "kitchen")).body)


async def test_full_music_route_preserves_validated_playlist_cover(mood_rig):
    mood_rig.playlist_artwork = True

    result = await direct(mood_rig)

    assert result["ok"] is True
    assert all(
        row["artwork"]
        == {
            "kind": "playlist_cover",
            "provider": "spotify",
            "url": "https://i.scdn.co/image/cover",
        }
        for row in result["data"]["tracks"]
    )


@pytest.mark.parametrize(
    "case",
    [
        "nine-primary",
        "broader-new",
        "insufficient-new",
        "renew-frozen",
        "bad-source",
        "auth",
        "rate",
        "http5xx",
        "foreign-epoch",
        "quota-fallback",
    ],
)
async def test_actual_refresh_uses_best_genuine_set_with_existing_bounds(
    mood_rig, monkeypatch, case
):
    r = mood_rig
    queries = []
    primary = (
        {
            "cooking": ["a", "d", "g"],
            "italian dinner": ["b", "e", "h"],
            "calm acoustic": ["c", "f", "i"],
        }
        if case
        in {
            "nine-primary",
            "renew-frozen",
            "bad-source",
            "auth",
            "rate",
            "http5xx",
            "foreign-epoch",
            "quota-fallback",
        }
        else {"cooking": ["a"], "italian dinner": ["b"], "calm acoustic": ["c"]}
    )
    broad = (
        {"dinner": ["d"], "italian": ["e"], "acoustic": ["f"]}
        if case == "broader-new"
        else {"dinner": ["a"], "italian": ["b"], "acoustic": ["c"]}
    )

    async def read(kind, account=None, query=None):
        queries.append(query)
        if len(queries) > 3:
            if case == "bad-source":
                return {"ok": False}
            if case in {"auth", "rate", "http5xx"}:
                status = {"auth": 403, "rate": 429, "http5xx": 503}[case]
                raise httpx.HTTPStatusError(
                    "source failure",
                    request=httpx.Request("POST", "https://invalid.test"),
                    response=httpx.Response(status),
                )
        letters = (primary | broad)[query]
        return {
            "ok": True,
            "data": {
                "config_entry_id": account,
                "owner_epoch": (
                    "foreign"
                    if case == "foreign-epoch" and len(queries) > 3 and query == "cooking"
                    else r.playlist_epoch
                ),
                "source": "spotify_web_api",
                "playlists": [
                    {"uri": "spotify:playlist:" + letter * 22, "name": "Source " + letter}
                    for letter in letters
                ],
            },
        }

    monkeypatch.setattr(r.router, "podview_read", read)
    before = await direct(r)
    assert before["ok"]
    if case == "quota-fallback":
        r.router.podview_mood_selector.available = False
    after = await direct(r, "renew" if case == "renew-frozen" else "refresh")
    if case in {"bad-source", "auth", "rate", "http5xx", "foreign-epoch"}:
        assert not after["ok"]
        assert len(queries) == 6
        return
    assert after["ok"]
    a = {row["uri"] for row in before["data"]["tracks"]}
    b = {row["uri"] for row in after["data"]["tracks"]}
    assert len(b) == 3
    if case in {"nine-primary", "broader-new", "quota-fallback"}:
        assert not a & b
    else:
        assert a == b
    assert len(queries) == (9 if case in {"broader-new", "insufficient-new"} else 6)
    assert r.router.podview_mood_selector.select.await_count == (
        1 if case in {"renew-frozen", "quota-fallback"} else 2
    )
    assert r.app[BRIDGE].controls.music.execute_context.await_count == 0


def test_helper_exhaustive_small_lists_matches_minimum_overlap_and_stable_source_order():
    lists = [[], ["a"], ["b"], ["a", "c"], ["a", "b", "c"], ["c", "b", "a"]]
    for raw in itertools.product(lists, repeat=3):
        candidates = [[({"uri": letter}, "query") for letter in rows] for rows in raw]
        for old in [frozenset(), frozenset("abc"), frozenset("ab")]:
            matches = [rows for rows in itertools.product(*raw) if len(set(rows)) == 3]
            expected = (
                min(matches, key=lambda rows: sum(uri in old for uri in rows)) if matches else None
            )
            actual = assign_playlists(candidates, old)
            assert (
                tuple(row["uri"] for row, _ in actual) if actual is not None else None
            ) == expected
    assert assign_playlists([[({"uri": str(i)}, "q") for i in range(7)]] * 3) is None


async def test_frozen_renewal_preserves_new_nonfirst_rows_after_explicit_refresh(
    mood_rig, monkeypatch
):
    r = mood_rig
    queries = []
    samples = {
        "cooking": ["a", "d", "g"],
        "italian dinner": ["b", "e", "h"],
        "calm acoustic": ["c", "f", "i"],
    }

    async def read(kind, account=None, query=None):
        queries.append(query)
        return {
            "ok": True,
            "data": {
                "config_entry_id": account,
                "owner_epoch": r.playlist_epoch,
                "source": "spotify_web_api",
                "playlists": [
                    {"uri": "spotify:playlist:" + letter * 22, "name": "Source " + letter}
                    for letter in samples[query]
                ],
            },
        }

    monkeypatch.setattr(r.router, "podview_read", read)
    initial = await direct(r)
    refreshed = await direct(r, "refresh")
    renewed = await direct(r, "renew")
    assert initial["ok"] and refreshed["ok"] and renewed["ok"]
    assert initial["data"]["tracks"] != refreshed["data"]["tracks"]
    assert refreshed["data"]["tracks"] == renewed["data"]["tracks"]
    assert len(queries) == 9
    assert r.router.podview_mood_selector.select.await_count == 2
