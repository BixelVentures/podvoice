"""Same ingress read facade without write authority; inert existing HA transport."""

# ruff: noqa: F811 - imported pytest fixtures intentionally shadowed by test arguments
import asyncio
import json
from types import SimpleNamespace

import pytest
from integration.test_podview_mood_playlists import mood_rig  # noqa: F401
from integration.test_podview_music_selection import rig  # noqa: F401
from multidict import MultiDict

from gatekeeper.podview import BRIDGE, _music


def request(rig, *, account="account-alpha", refresh=False, renew=False, cookie="", **kwargs):
    query = MultiDict(kind="mood", account=account)
    if refresh:
        query["refresh"] = "1"
    if renew:
        query["renew"] = "1"
    return SimpleNamespace(
        app=rig.app,
        query=query,
        cookies={"podview_control": cookie},
        remote=kwargs.get("remote", "127.0.0.1"),
        headers=kwargs.get("headers", {}),
        method="GET",
    )


async def read(rig, **kwargs):
    response = await _music(request(rig, **kwargs))
    return json.loads(response.body)


def unpaired(rig):
    bridge = rig.app[BRIDGE]
    bridge._grants.clear()
    bridge.controls.policy["music"] = []
    return bridge


async def test_unpaired_preview_no_cookie_no_write_discovery_and_no_minted_authority(mood_rig):
    from dataclasses import replace

    bridge = unpaired(mood_rig)
    mood_rig.router._discovery = replace(
        mood_rig.router._discovery,
        podconnect_services=mood_rig.router._discovery.podconnect_services
        - {"get_context_play_controls", "control_playback", "get_track_play_controls"},
    )
    bridge.music_selection.sources["existing"] = {"preserved": True}
    bridge.music_selection.tasks["existing"] = {"preserved": True}
    body = await read(mood_rig)
    assert body["ok"] and body["schema"] == "podview.mood-preview.v1", body
    assert len(body["data"]["tracks"]) == 3 and body["preview"]["readOnly"] is True
    assert set(body) == {"ok", "schema", "preview", "data"}
    assert "mood" in bridge.snapshot("kitchen")["capabilities"]["musicRead"]
    assert not bridge.snapshot("kitchen")["capabilities"]["musicSelection"]
    assert bridge.music_selection.sources == {"existing": {"preserved": True}}
    assert bridge.music_selection.tasks == {"existing": {"preserved": True}}
    assert bridge._touch_music_contexts == {}
    assert mood_rig.router.podview_mood_selector.select.await_count == 1
    assert bridge.controls.music.execute_context.await_count == 0
    assert bridge.controls.music.setup_context.await_count == 0


async def test_preview_retains_validated_playlist_cover(mood_rig):
    unpaired(mood_rig)
    mood_rig.playlist_artwork = True

    body = await read(mood_rig)

    assert body["ok"] is True
    assert all(
        row["artwork"]
        == {
            "kind": "playlist_cover",
            "provider": "spotify",
            "url": "https://i.scdn.co/image/cover",
        }
        for row in body["data"]["tracks"]
    )


async def test_initial_and_renew_retain_exact_cards_only_refresh_selects_again(mood_rig):
    unpaired(mood_rig)
    first = await read(mood_rig)
    again = await read(mood_rig)
    renewed = await read(mood_rig, renew=True)
    assert first["data"]["tracks"] == again["data"]["tracks"] == renewed["data"]["tracks"]
    assert mood_rig.router.podview_mood_selector.select.await_count == 1
    assert (await read(mood_rig, refresh=True))["ok"]
    assert mood_rig.router.podview_mood_selector.select.await_count == 2


@pytest.mark.parametrize(
    "kwargs",
    [
        {"remote": "192.0.2.4"},
        {"headers": {"Sec-Fetch-Site": "cross-site"}},
    ],
)
async def test_invalid_ingress_before_ai_spend(mood_rig, kwargs):
    unpaired(mood_rig)
    assert not (await read(mood_rig, **kwargs))["ok"]
    assert mood_rig.router.podview_mood_selector.select.await_count == 0


async def test_foreign_account_response_fails_closed_after_selection(mood_rig):
    bridge = unpaired(mood_rig)
    assert not (await read(mood_rig, account="foreign"))["ok"]
    assert mood_rig.router.podview_mood_selector.select.await_count == 1
    assert not bridge.music_selection.sources and not bridge.music_selection.tasks
    assert bridge._touch_music_contexts == {}


async def test_changed_owner_during_model_does_not_publish_or_mint(mood_rig):
    bridge = unpaired(mood_rig)

    async def changed(*args, **kwargs):
        bridge._music_source_generation += 1
        return ["cooking", "italian", "calm"]

    mood_rig.router.podview_mood_selector.select.side_effect = changed
    assert not (await read(mood_rig))["ok"]
    assert not bridge.music_selection.sources and not bridge.music_selection.tasks
    assert not any("search_playlists" in call[1] for call in mood_rig.calls)


async def test_preview_cancellation_joins_child_reads_and_releases_busy(mood_rig):
    bridge = unpaired(mood_rig)
    entered = asyncio.Event()
    cleaned = asyncio.Event()
    old = mood_rig.router.podview_read

    async def blocked(kind, *args, **kwargs):
        if kind != "playlist_search":
            return await old(kind, *args, **kwargs)
        entered.set()
        try:
            await asyncio.Future()
        finally:
            cleaned.set()

    mood_rig.router.podview_read = blocked
    task = asyncio.create_task(read(mood_rig))
    await asyncio.wait_for(entered.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cleaned.is_set() and not bridge._music_busy
    assert not bridge.music_selection.sources and not bridge.music_selection.tasks


async def test_preview_cannot_mint_play_offer_even_with_forged_id_and_cookie(mood_rig):
    from unittest.mock import AsyncMock

    from gatekeeper.podview import _music_selection

    bridge = unpaired(mood_rig)
    assert (await read(mood_rig))["ok"]
    req = request(mood_rig, cookie="grant")
    req.method = "POST"
    req.content_length = 256
    req.content_type = "application/json"
    req.headers = {"X-PodView-Request": "1"}
    req.json = AsyncMock(
        return_value={
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "candidateSetId": "a" * 64,
            "candidateIds": ["b" * 24],
            "target": {
                "accountId": "account-alpha",
                "kind": "spotify_device",
                "targetId": "device-one",
            },
        }
    )
    result = await _music_selection(req)
    assert result.status == 403
    assert not bridge.music_selection.tasks
    assert bridge.controls.music.setup_context.await_count == 0
    assert bridge.controls.music.execute_context.await_count == 0


async def test_preview_deadline_cancels_and_joins_all_reads(mood_rig, monkeypatch):
    bridge = unpaired(mood_rig)
    old = mood_rig.router.podview_read
    entered = []
    cleaned = []

    async def blocked(kind, *args, **kwargs):
        if kind != "playlist_search":
            return await old(kind, *args, **kwargs)
        entered.append(args)
        try:
            await asyncio.Future()
        finally:
            cleaned.append(args)

    mood_rig.router.podview_read = blocked
    timeout = asyncio.timeout
    monkeypatch.setattr(asyncio, "timeout", lambda _: timeout(0.02))
    assert not (await read(mood_rig))["ok"]
    assert len(entered) == len(cleaned) == 6 and not bridge._music_busy
    assert not bridge.music_selection.sources


async def test_foreign_playlist_response_never_publishes_preview(mood_rig):
    bridge = unpaired(mood_rig)
    mood_rig.playlist_account = "foreign-account"
    assert not (await read(mood_rig))["ok"]
    assert not bridge.music_selection.sources and not bridge.music_selection.tasks


async def test_real_grant_keeps_existing_write_path(mood_rig):
    body = await read(mood_rig, cookie="grant")
    assert body["ok"] and "candidateSet" in body and "preview" not in body
    assert len(mood_rig.app[BRIDGE].music_selection.sources) == 1
