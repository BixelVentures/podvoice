"""Bounded real-owner fallback semantics; HTTP, model and household I/O inert."""

# ruff: noqa: F811 - imported pytest fixtures intentionally shadowed
import asyncio
import copy
import hashlib
import json
from types import SimpleNamespace

import httpx
import pytest
from integration.test_podview_feeling_playlists import feeling_rig, read  # noqa: F401
from integration.test_podview_mood_playlists import mood_rig  # noqa: F401
from integration.test_podview_music_selection import rig  # noqa: F401

from gatekeeper.podview import BRIDGE

PRIMARY = {
    "feeling": ["funk", "peaceful acoustic", "sing along classics"],
    "mood": ["cooking", "italian dinner", "calm acoustic"],
}
BROADER = {
    "feeling": ["feel good", "acoustic", "classics"],
    "mood": ["dinner", "italian", "acoustic"],
}


@pytest.fixture
async def catalogue(feeling_rig):
    r = feeling_rig
    state = SimpleNamespace(
        rig=r,
        calls=[],
        empty=set(),
        rows={},
        http={},
        malformed=set(),
        foreign=set(),
        blocked=set(),
        entered=asyncio.Event(),
        gate=asyncio.Event(),
        cleaned=[],
    )

    def row(query):
        return {
            "uri": "spotify:playlist:" + hashlib.sha256(query.encode()).hexdigest()[:22],
            "name": "Observed source fixture " + query,
        }

    state.row = row

    async def response(req):
        assert req.method == "POST" and req.url.path.endswith(
            "/services/podconnect/search_playlists"
        )
        args = json.loads(req.content)
        query = args["query"]
        state.calls.append(query)
        assert args["config_entry_id"] == "account-alpha" and args["limit"] == 3
        if query in state.blocked:
            state.entered.set()
            try:
                await state.gate.wait()
            finally:
                state.cleaned.append(query)
        if query in state.http:
            return httpx.Response(state.http[query], json={"error": "inert failure"})
        rows = copy.deepcopy(state.rows.get(query, [] if query in state.empty else [row(query)]))
        if query in state.malformed:
            rows = [{"uri": "spotify:track:" + "a" * 22, "name": "Wrong source kind"}]
        return httpx.Response(
            200,
            json={
                "service_response": {
                    "ok": True,
                    "schema": "podconnect.search_playlists.v1",
                    "config_entry_id": "account-alpha",
                    "owner_epoch": "b" * 32 if query in state.foreign else r.playlist_epoch,
                    "source": "spotify_web_api",
                    "query": query,
                    "limit": 3,
                    "returned_count": len(rows),
                    "playlists": rows,
                }
            },
        )

    old = r.router._client
    client = httpx.AsyncClient(transport=httpx.MockTransport(response))
    r.router._client = client
    try:
        yield state
    finally:
        r.router._client = old
        await client.aclose()


def no_effects(catalogue):
    r = catalogue.rig
    assert r.app[BRIDGE].controls.music.execute_context.await_count == 0
    assert r.app[BRIDGE].controls.music.setup_context.await_count == 0
    assert r.router.podview_mood_selector.select.await_count <= 1


@pytest.mark.parametrize("kind", ["mood", "feeling"])
@pytest.mark.parametrize("missing", [1, 3, "collision"])
async def test_empty_or_colliding_primary_gets_one_bounded_real_source_broadening(
    catalogue, kind, missing
):
    c = catalogue
    if missing == "collision":
        c.rows.update({query: [c.row("same")] for query in PRIMARY[kind]})
    else:
        c.empty.update(PRIMARY[kind][:missing])
    result = await read(c.rig, kind=kind)
    assert result["ok"] is True, result
    assert len(result["data"]["tracks"]) == 3
    assert len({row["uri"] for row in result["data"]["tracks"]}) == 3
    assert sorted(c.calls) == sorted(PRIMARY[kind] + BROADER[kind])
    retained = getattr(c.rig.app[BRIDGE], "_" + kind + "_retained")
    assert len(retained["queries"]) == 3
    assert all(query in PRIMARY[kind] + BROADER[kind] for query in retained["queries"].values())
    no_effects(c)


@pytest.mark.parametrize("kind", ["mood", "feeling"])
async def test_all_sources_empty_stays_honest_after_exactly_six_reads(catalogue, kind):
    c = catalogue
    c.empty.update(PRIMARY[kind] + BROADER[kind])
    result = await read(c.rig, kind=kind)
    assert result["error"] == kind + "_catalogue_empty"
    assert len(c.calls) == 6
    assert not c.rig.app[BRIDGE].music_selection.sources
    no_effects(c)


@pytest.mark.parametrize("failure", [401, 403, 429, 500, "malformed", "foreign_epoch"])
async def test_invalid_primary_never_triggers_provider_fallback(catalogue, failure):
    c = catalogue
    query = PRIMARY["feeling"][0]
    if isinstance(failure, int):
        c.http[query] = failure
    else:
        getattr(c, "malformed" if failure == "malformed" else "foreign").add(query)
    result = await read(c.rig)
    assert result["ok"] is False
    assert 1 <= len(c.calls) <= 3
    assert set(c.calls) <= set(PRIMARY["feeling"])
    assert not c.rig.app[BRIDGE].music_selection.sources
    no_effects(c)


@pytest.mark.parametrize("kind", ["mood", "feeling"])
@pytest.mark.parametrize("mutation", ["removed", "renamed", "foreign_epoch"])
async def test_frozen_renewal_uses_chosen_query_and_never_substitutes(catalogue, kind, mutation):
    c = catalogue
    c.empty.update(PRIMARY[kind])
    first = await read(c.rig, kind=kind)
    assert first["ok"]
    bridge = c.rig.app[BRIDGE]
    retained = getattr(bridge, "_" + kind + "_retained")
    chosen = list(retained["queries"].values())
    assert sorted(chosen) == sorted(BROADER[kind])
    c.calls.clear()
    if mutation == "removed":
        c.rows[chosen[0]] = [c.row("different playlist")]
    elif mutation == "renamed":
        c.rows[chosen[0]] = [dict(c.row(chosen[0]), name="Changed real name")]
    else:
        c.foreign.add(chosen[0])
    failed = await read(c.rig, kind=kind, renew=True)
    assert failed["error"] == kind + "_refresh_required"
    assert sorted(c.calls) == sorted(chosen) and len(c.calls) == 3
    assert getattr(bridge, "_" + kind + "_retained") is retained
    assert retained["rows"] == first["data"]["tracks"]
    assert not bridge.music_selection.sources and not bridge.music_selection.tasks
    no_effects(c)


@pytest.mark.parametrize("kind", ["mood", "feeling"])
async def test_failed_refresh_retains_read_metadata_without_stale_action_authority(catalogue, kind):
    c = catalogue
    first = await read(c.rig, kind=kind)
    bridge = c.rig.app[BRIDGE]
    retained = getattr(bridge, "_" + kind + "_retained")
    c.http.update(
        {query: 403 for query in PRIMARY[kind] + ["sing along pop", "soft acoustic", "happy indie"]}
    )
    failed = await read(c.rig, kind=kind, refresh=True)
    assert failed["ok"] is False
    assert getattr(bridge, "_" + kind + "_retained") is retained
    assert retained["rows"] == first["data"]["tracks"]
    assert not bridge.music_selection.sources and not bridge.music_selection.tasks
    assert c.rig.router.podview_mood_selector.select.await_count <= (2 if kind == "mood" else 0)
    assert bridge.controls.music.execute_context.await_count == 0


@pytest.mark.parametrize(
    "failure",
    [
        "budget",
        "selection_none",
        "selection_exception",
        "clock_none",
        "clock_exception",
        "invalid_ids",
    ],
)
async def test_ai_unavailable_does_not_disable_music_or_retry_model(catalogue, failure):
    c = catalogue
    selector = c.rig.router.podview_mood_selector
    if failure == "budget":
        selector.available = False
    elif failure == "selection_none":
        selector.select.return_value = None
    elif failure == "selection_exception":
        selector.select.side_effect = RuntimeError("inert model unavailable")
    elif failure == "clock_none":
        c.rig.router.podview_mood_context.return_value = None
    elif failure == "clock_exception":
        c.rig.router.podview_mood_context.side_effect = RuntimeError("inert clock unavailable")
    else:
        selector.select.return_value = ["foreign", "foreign", "foreign"]
    result = await read(c.rig, kind="mood")
    assert result["ok"] is True
    assert [row["themeId"] for row in result["data"]["tracks"]] == ["cooking", "italian", "calm"]
    assert len(c.calls) == 3
    assert selector.select.await_count == int(
        failure not in {"budget", "clock_none", "clock_exception"}
    )
    no_effects(c)


async def test_owner_replaced_during_ai_failure_cannot_fall_back_to_music(catalogue):
    c = catalogue

    async def changed(*args, **kwargs):
        c.rig.app[BRIDGE]._grants.clear()
        raise RuntimeError("owner changed")

    c.rig.router.podview_mood_selector.select.side_effect = changed
    result = await read(c.rig, kind="mood")
    assert result["ok"] is False and not c.calls
    assert not c.rig.app[BRIDGE].music_selection.sources
    no_effects(c)


async def test_broader_reads_share_existing_total_deadline_and_join_cancellation(
    catalogue, monkeypatch
):
    c = catalogue
    c.empty.update(PRIMARY["feeling"])
    c.blocked.update(BROADER["feeling"])
    timers = []
    real_timeout = asyncio.timeout

    def capture(seconds):
        timer = real_timeout(seconds)
        if seconds == 10:
            timers.append(timer)
        return timer

    monkeypatch.setattr(asyncio, "timeout", capture)
    task = asyncio.create_task(read(c.rig))
    await asyncio.wait_for(c.entered.wait(), 1)
    assert len(timers) == 1
    timers[0].reschedule(asyncio.get_running_loop().time())
    result = await task
    assert result["error"] == "feeling_unavailable"
    assert len(c.calls) == 6
    assert sorted(c.cleaned) == sorted(BROADER["feeling"])
    assert not c.rig.app[BRIDGE]._music_busy and not c.rig.app[BRIDGE].music_selection.sources
    no_effects(c)


@pytest.mark.parametrize("kind", ["mood", "feeling"])
async def test_successful_frozen_renewal_reads_only_its_published_broader_queries(catalogue, kind):
    c = catalogue
    c.empty.update(PRIMARY[kind])
    first = await read(c.rig, kind=kind)
    assert first["ok"]
    retained = getattr(c.rig.app[BRIDGE], "_" + kind + "_retained")
    queries = list(retained["queries"].values())
    before_model = c.rig.router.podview_mood_selector.select.await_count
    c.calls.clear()
    renewed = await read(c.rig, kind=kind, renew=True)
    assert renewed["ok"] and renewed["data"]["tracks"] == first["data"]["tracks"]
    assert sorted(c.calls) == sorted(queries) and len(c.calls) == 3
    assert c.rig.router.podview_mood_selector.select.await_count == before_model
    no_effects(c)


async def test_ai_quota_exhaustion_reuses_existing_closed_theme_ids_without_another_model_call(
    catalogue,
):
    c = catalogue
    selector = c.rig.router.podview_mood_selector
    selector.select.return_value = ["morning_acoustic", "evening_jazz", "indie"]
    first = await read(c.rig, kind="mood")
    assert first["ok"]
    selector.available = False
    c.calls.clear()
    refreshed = await read(c.rig, kind="mood", refresh=True)
    assert refreshed["ok"]
    assert [row["themeId"] for row in refreshed["data"]["tracks"]] == [
        "morning_acoustic",
        "evening_jazz",
        "indie",
    ]
    assert c.calls == [
        "morning acoustic",
        "evening jazz",
        "indie",
        "acoustic",
        "jazz",
        "alternative",
    ]
    assert selector.select.await_count == 1
    assert {row["uri"] for row in refreshed["data"]["tracks"]} == {
        c.row(query)["uri"] for query in ("acoustic", "jazz", "alternative")
    }
    assert not {row["uri"] for row in first["data"]["tracks"]} & {
        row["uri"] for row in refreshed["data"]["tracks"]
    }
    no_effects(c)


@pytest.mark.parametrize("kind", ["mood", "feeling"])
@pytest.mark.parametrize("failure", ["malformed", "foreign_epoch"])
async def test_broader_source_still_needs_current_exact_owner_and_closed_projection(
    catalogue, kind, failure
):
    c = catalogue
    c.empty.update(PRIMARY[kind])
    getattr(c, "malformed" if failure == "malformed" else "foreign").add(BROADER[kind][0])
    result = await read(c.rig, kind=kind)
    assert result["ok"] is False and len(c.calls) == 6
    assert not c.rig.app[BRIDGE].music_selection.sources
    no_effects(c)
