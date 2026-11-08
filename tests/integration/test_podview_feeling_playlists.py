"""Humør uses the genuine bounded playlist route and owner; all I/O is inert."""

# ruff: noqa: F811 - imported pytest fixtures intentionally shadowed
import asyncio
import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from integration import test_podview_mood_playlists as existing
from integration.test_podview_mood_playlists import mood_rig  # noqa: F401
from integration.test_podview_music_selection import rig  # noqa: F401
from multidict import CIMultiDict, MultiDict

from gatekeeper.podview import BRIDGE, _music
from gatekeeper.podview_feeling import THEMES


@pytest.fixture
async def feeling_rig(mood_rig):
    rig = mood_rig
    old = rig.client
    rig.feeling_bad_uri = False
    rig.feeling_block = None
    rig.feeling_entered = asyncio.Event()

    async def request(req):
        if "search_playlists" not in req.url.path:
            return await rig.request(req)
        args = json.loads(req.content)
        rig.calls.append(("POST", req.url.path, args))
        themes = list(THEMES.values())
        matches = [i for i, theme in enumerate(themes) if theme["query"] == args["query"]]
        if not matches:
            return await old._transport.handle_async_request(req)
        index = matches[0]
        rig.feeling_entered.set()
        if rig.feeling_block is not None:
            await rig.feeling_block.wait()
        suffix = "a" if rig.playlist_same else chr(ord("a") + index)
        return httpx.Response(
            200,
            json={
                "service_response": {
                    "ok": True,
                    "schema": "podconnect.search_playlists.v1",
                    "config_entry_id": rig.playlist_account,
                    "owner_epoch": (
                        "a" * 32
                        if rig.playlist_epoch == "foreign" and index != 0
                        else rig.playlist_epoch
                    ),
                    "source": "spotify_web_api",
                    "query": args["query"],
                    "limit": 3,
                    "returned_count": 1,
                    "playlists": [
                        {
                            "uri": (
                                "spotify:track:" if rig.feeling_bad_uri else "spotify:playlist:"
                            )
                            + suffix * 22,
                            "name": f"Real {suffix}",
                        }
                    ],
                }
            },
        )

    rig.client = rig.router._client = httpx.AsyncClient(transport=httpx.MockTransport(request))
    # Keep old only as an inert transport for existing contextual mood queries.
    rig.feeling_old_client = old
    yield rig
    await old.aclose()


def req(rig, *, kind="feeling", refresh=False, renew=False, cookie="grant", document=None):
    query = MultiDict(kind=kind, account="account-alpha")
    if refresh:
        query["refresh"] = "1"
    if renew:
        query["renew"] = "1"
    return SimpleNamespace(
        app=rig.app,
        query=query,
        cookies={"podview_control": cookie},
        remote="127.0.0.1",
        headers=CIMultiDict({"X-PodView-Music-Document": document} if document else {}),
        method="GET",
    )


async def read(rig, **kwargs):
    return json.loads((await _music(req(rig, **kwargs))).body)


async def test_actual_subjective_playlists_work_without_ai_selector_and_change_only_explicitly(
    feeling_rig,
):
    rig = feeling_rig
    selector = rig.router.podview_mood_selector
    rig.router.podview_mood_selector = None
    assert "feeling" in rig.router.podview_music_reads()
    assert "mood" not in rig.router.podview_music_reads()
    first = await read(rig)
    assert first["ok"] and first["candidateSet"]["sourceKind"] == "feeling"
    rows = first["data"]["tracks"]
    assert [row["themeId"] for row in rows] == ["jazz_lounge", "hiphop_rnb", "pop_dance"]
    assert all(row["uri"].startswith("spotify:playlist:") for row in rows)
    assert all(row["themeArt"] == THEMES[row["themeId"]]["image"] for row in rows)
    again, renewed = await read(rig), await read(rig, renew=True)
    assert again["data"]["tracks"] == renewed["data"]["tracks"] == rows
    refreshed = await read(rig, refresh=True)
    assert refreshed["ok"] and refreshed["data"]["tracks"] != rows
    assert [row["themeId"] for row in refreshed["data"]["tracks"]] == [
        "relaxed_pop",
        "deep_house",
        "jazz_classics",
    ]
    assert selector.select.await_count == rig.router.podview_mood_context.await_count == 0
    assert rig.app[BRIDGE].controls.music.execute_context.await_count == 0


@pytest.mark.parametrize(
    ("hour", "order"),
    [
        (0, [0, 1, 2]),
        (10, [0, 1, 2]),
        (11, [1, 2, 0]),
        (16, [1, 2, 0]),
        (17, [2, 0, 1]),
        (23, [2, 0, 1]),
    ],
)
async def test_local_time_starts_three_distinct_sets_without_ai(
    feeling_rig, monkeypatch, hour, order
):
    rig = feeling_rig
    selector = rig.router.podview_mood_selector
    rig.router.podview_mood_selector = None
    clock = AsyncMock(return_value={"structuredContent": {"time": f"{hour:02}:00"}})
    monkeypatch.setattr(rig.router, "_mcp", SimpleNamespace(call_tool=clock, initialized=False))
    monkeypatch.setattr(rig.router, "declarations", lambda: [{"name": "GetDateTime"}])
    first = await read(rig)
    clock.return_value = {"structuredContent": {"time": "12:00"}}
    renewed = await read(rig, renew=True)
    assert renewed["data"]["tracks"] == first["data"]["tracks"]
    assert renewed["refreshAvailable"] is True
    second = await read(rig, refresh=True)
    third = await read(rig, refresh=True)
    groups = [
        ["jazz_lounge", "hiphop_rnb", "pop_dance"],
        ["relaxed_pop", "deep_house", "jazz_classics"],
        ["lounge", "nineties_techno", "party"],
    ]
    all_uris = set()
    for index, page in enumerate((first, second, third)):
        assert page["ok"] and page["candidateSet"]["sourceKind"] == "feeling"
        rows = page["data"]["tracks"]
        assert [row["themeId"] for row in rows] == groups[order[index]]
        assert not all_uris.intersection(row["uri"] for row in rows)
        all_uris.update(row["uri"] for row in rows)
        assert page["refreshAvailable"] is (index < 2)
    bridge = rig.app[BRIDGE]
    retained = bridge._feeling_retained
    calls = rig.calls.copy()
    active_source = bridge.music_selection.sources.copy()
    assert (await read(rig, refresh=True))["error"] == "feeling_exhausted"
    assert rig.calls == calls
    assert bridge._feeling_retained is retained
    assert bridge.music_selection.sources == active_source
    renewed = await read(rig, renew=True)
    assert renewed["data"]["tracks"] == third["data"]["tracks"]
    assert renewed["refreshAvailable"] is False
    clock.assert_awaited_once()
    assert clock.await_args.args == ("GetDateTime", {})
    assert selector.select.await_count == rig.router.podview_mood_context.await_count == 0
    assert bridge.controls.music.execute_context.await_count == 0


@pytest.mark.parametrize("replaced", ["binding", "owner_epoch"])
async def test_same_daypart_initial_reuses_rows_but_new_owner_can_browse_again(
    feeling_rig, replaced
):
    rig = feeling_rig
    await read(rig)
    await read(rig, refresh=True)
    final = await read(rig, refresh=True)
    assert final["refreshAvailable"] is False
    parallel_open = await read(rig)
    assert parallel_open["data"]["tracks"] == final["data"]["tracks"]
    assert parallel_open["refreshAvailable"] is False
    if replaced == "binding":
        rig.router._services_epoch += 1
    else:
        rig.playlist_epoch = "b" * 32
    renewed = await read(rig, renew=True)
    assert renewed["data"]["tracks"] == final["data"]["tracks"]
    assert renewed["refreshAvailable"] is True
    next_page = await read(rig, refresh=True)
    assert next_page["ok"] is True
    assert next_page["data"]["tracks"] != final["data"]["tracks"]


async def test_contextual_and_subjective_retained_caches_are_separate(feeling_rig):
    first = await read(feeling_rig)
    mood = await read(feeling_rig, kind="mood")
    assert mood["ok"] and mood["data"]["tracks"] != first["data"]["tracks"]
    assert (await read(feeling_rig))["data"]["tracks"] == first["data"]["tracks"]
    await read(feeling_rig, refresh=True)
    assert (await read(feeling_rig, kind="mood"))["data"]["tracks"] == mood["data"]["tracks"]
    assert feeling_rig.router.podview_mood_selector.select.await_count == 1


async def test_track_only_grant_gets_read_only_subjective_preview_without_task_or_effect(
    feeling_rig,
):
    bridge = feeling_rig.app[BRIDGE]
    bridge.controls.policy["music"][0]["actions"] = ["play_track"]
    body = await read(feeling_rig)
    assert body["ok"] and body["schema"] == "podview.feeling-preview.v1"
    assert body["preview"]["readOnly"] and "candidateSet" not in body
    assert not bridge.music_selection.sources and not bridge.music_selection.tasks
    assert bridge.controls.music.execute_context.await_count == 0


@pytest.mark.parametrize(
    "mutation", ["playlist_epoch", "playlist_account", "playlist_same", "feeling_bad_uri"]
)
async def test_bad_source_never_publishes_partial_playlist_authority(feeling_rig, mutation):
    setattr(
        feeling_rig,
        mutation,
        True if mutation in {"playlist_same", "feeling_bad_uri"} else "foreign",
    )
    assert not (await read(feeling_rig))["ok"]
    assert not feeling_rig.app[BRIDGE].music_selection.sources
    assert not feeling_rig.app[BRIDGE].music_selection.tasks
    assert feeling_rig.app[BRIDGE].controls.music.execute_context.await_count == 0


async def test_owner_replaced_while_parallel_searches_are_held_cannot_publish(feeling_rig):
    rig = feeling_rig
    rig.feeling_block = asyncio.Event()
    task = asyncio.create_task(read(rig))
    await asyncio.wait_for(rig.feeling_entered.wait(), 1)
    rig.app[BRIDGE]._grants.clear()
    rig.feeling_block.set()
    assert not (await task)["ok"]
    assert not rig.app[BRIDGE].music_selection.sources
    assert rig.app[BRIDGE]._music_busy is False


async def test_cancelled_parallel_search_clears_busy_and_cannot_publish(feeling_rig):
    rig = feeling_rig
    rig.feeling_block = asyncio.Event()
    task = asyncio.create_task(read(rig))
    await asyncio.wait_for(rig.feeling_entered.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert rig.app[BRIDGE]._music_busy is False
    assert not rig.app[BRIDGE].music_selection.sources


async def test_missing_retained_renew_does_not_select_search_or_spend_ai(feeling_rig):
    assert not (await read(feeling_rig, renew=True))["ok"]
    assert not [call for call in feeling_rig.calls if "search_playlists" in call[1]]
    assert feeling_rig.router.podview_mood_selector.select.await_count == 0


async def test_same_actual_touch_and_voice_context_owner_for_subjective_playlists(
    feeling_rig, monkeypatch
):
    async def feeling(client, refresh=False):
        return await (
            await client.get(
                "/view/api/music?kind=feeling&account=account-alpha"
                + ("&refresh=1" if refresh else ""),
                headers=existing.HEADERS,
            )
        ).json()

    monkeypatch.setattr(existing, "mood", feeling)
    await existing.test_opaque_context_option_uses_existing_native_owner_once(feeling_rig)


async def test_genuine_voice_confirmation_uses_same_subjective_options(feeling_rig, monkeypatch):
    async def feeling(client, refresh=False):
        return await (
            await client.get(
                "/view/api/music?kind=feeling&account=account-alpha", headers=existing.HEADERS
            )
        ).json()

    monkeypatch.setattr(existing, "mood", feeling)
    await existing.test_voice_uses_same_playlist_option_ids_and_existing_confirmation_owner(
        feeling_rig
    )


async def test_actual_route_export_for_shared_ui_contract(feeling_rig):
    """Optional inert artifact composes the real Python route with the shared JS renderer."""
    import os
    from pathlib import Path

    bridge = feeling_rig.app[BRIDGE]
    paired = await read(feeling_rig)
    preview = await read(feeling_rig, cookie="")
    assert paired["ok"] and preview["ok"]
    fixture = {
        "evidence": "mocked_owner_io_actual_route_not_live",
        "paired": paired,
        "preview": preview,
        "snapshot": bridge.snapshot("kitchen", "grant"),
    }
    path = os.environ.get("PODVIEW_FEELING_TEST_ARTIFACT")
    if path:
        await asyncio.to_thread(Path(path).write_text, json.dumps(fixture))


@pytest.mark.parametrize("kind", ["feeling", "mood"])
async def test_other_document_refresh_cannot_replace_rows_for_expired_selection_renewal(
    feeling_rig, kind
):
    rig = feeling_rig
    bridge = rig.app[BRIDGE]
    first, other = "1" * 32, "2" * 32
    original = await read(rig, kind=kind, document=first)
    assert original["ok"], original
    rows = original["data"]["tracks"]
    other_initial = await read(rig, kind=kind, document=other)
    assert other_initial["ok"], other_initial
    assert other_initial["data"]["tracks"] == rows

    if kind == "mood":
        rig.router.podview_mood_selector.select.return_value = ["morning_acoustic", "indie", "calm"]
    refreshed = await read(rig, kind=kind, document=other, refresh=True)
    assert refreshed["ok"], refreshed
    assert refreshed["data"]["tracks"] != rows
    other_id = refreshed["candidateSet"]["candidateSetId"]
    first_id = original["candidateSet"]["candidateSetId"]
    bridge.music_selection.sources[first_id]["deadline"] = time.monotonic() - 1
    renewed = await read(rig, kind=kind, document=first, renew=True)
    assert renewed["ok"], renewed
    assert renewed["data"]["tracks"] == rows
    assert renewed["candidateSet"]["candidateSetId"] != first_id
    assert other_id in bridge.music_selection.sources
    assert bridge.controls.music.execute_context.await_count == 0


async def test_retained_playlist_document_capacity_preserves_unexpired_rows(
    feeling_rig, monkeypatch
):
    from gatekeeper import podview

    rig = feeling_rig
    bridge = rig.app[BRIDGE]
    monkeypatch.setattr(podview, "_PLAYLIST_DOCUMENT_RETENTION_LIMIT", 1)
    first, other = "1" * 32, "2" * 32
    initial = await read(rig, document=first)
    calls = len(rig.calls)
    assert (await read(rig, document=other))["error"] == "music_capacity"
    assert len(rig.calls) == calls
    assert (await read(rig, document=first, renew=True))["data"]["tracks"] == initial["data"][
        "tracks"
    ]
    ((key, (_, retained)),) = bridge._music_playlist_documents.items()
    bridge._music_playlist_documents[key] = (time.monotonic() - 1, retained)
    assert (await read(rig, document=other))["ok"]
    assert key not in bridge._music_playlist_documents
