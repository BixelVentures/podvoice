"""Find musik's AI picks in the add-on: synthetic provider only, honest reasons, one call per context."""

import ast
import json
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from gatekeeper.podview import BRIDGE
from gatekeeper.podview_enrichment import MODEL, RequestAllowance
from gatekeeper.podview_find_music import (
    FindMusicPlanner,
    configured_planner,
    facts_for,
    find_music_picks_http,
    honest_title,
    parse_request,
)
from gatekeeper.podview_mood import MoodSelector
from gatekeeper.provider_budget import ProviderBudgetCoordinator

ROOT = Path(__file__).resolve().parents[2]
REQUEST = {
    "date": "2026-11-19",  # a Thursday
    "hour": 19,
    "weather": {"condition": "rainy", "temperature": 6.4},
    "artists": ["Bon Iver", "Phoebe Bridgers"],
}
SPOTIFY_REMOVED = (
    "recommendations",
    "featured-playlists",
    "featured_playlists",
    "new-releases",
    "new_releases",
    "categories",
    "related-artists",
    "related_artists",
)


def model_answer(shelves):
    return httpx.Response(
        200,
        json={
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": json.dumps({"shelves": shelves})}],
                }
            ],
        },
    )


SHELVES = [
    {
        "slot": "moment",
        "title": "Regnvejr og torsdag aften",
        "basis": ["weather", "weekday", "day_part"],
        "queries": ["rainy evening jazz", "  cozy   acoustic ", "x" * 200],
    },
    {
        "slot": "artist",
        "title": "Ignored for artists",
        "basis": [],
        "queries": ["indie folk"],
    },
    # A dishonest title (it is not summer, not Monday) falls back to the slot's own title.
    {
        "slot": "daypart",
        "title": "Sommer mandag morgen",
        "basis": ["weather"],
        "queries": ["dinner"],
    },
    {"slot": "season", "title": "Op mod jul", "basis": ["season"], "queries": ["christmas"]},
]


def selector(client, tmp_path, requests=3):
    return MoodSelector(
        client,
        "inert-key",
        MODEL,
        allowance=RequestAllowance.prepare(tmp_path / "mood", requests, purpose="mood"),
        budget=ProviderBudgetCoordinator(),
    )


async def test_one_model_call_per_context_with_honest_titles_and_reasons(tmp_path):
    sent = []

    def receive(request):
        assert request.url == "https://api.openai.com/v1/responses"
        body = json.loads(request.content)
        facts = json.loads(body["input"][1]["content"])
        sent.append(facts)
        assert body["store"] is False and "tools" not in body
        return model_answer(SHELVES)

    async with httpx.AsyncClient(transport=httpx.MockTransport(receive)) as client:
        planner = configured_planner(selector(client, tmp_path))
        assert planner is not None
        first = await planner.plan(parse_request(REQUEST))
        again = await planner.plan(parse_request(REQUEST))
    assert first == again and len(sent) == 1
    # The model sees only coarse facts: no Spotify data, account or room.
    assert set(sent[0]) == {
        "weekday",
        "dayPart",
        "hour",
        "date",
        "season",
        "daysToChristmas",
        "weather",
        "topArtists",
        "slots",
    }
    assert sent[0]["weekday"] == "torsdag" and sent[0]["dayPart"] == "evening"
    assert sent[0]["weather"] == {"condition": "rainy", "temperature": 6}
    assert sent[0]["slots"] == ["moment", "artist", "daypart", "season"]
    assert first["ok"] is True and first["schema"] == "podview.find_music_picks.v1"
    shelves = {shelf["slot"]: shelf for shelf in first["shelves"]}
    assert [shelf["slot"] for shelf in first["shelves"]] == [
        "moment",
        "daypart",
        "artist",
        "season",
    ]
    assert shelves["moment"] == {
        "slot": "moment",
        "title": "Regnvejr og torsdag aften",
        "why": "Fordi det regner og det er torsdag aften.",
        # Normalized, bounded queries; an over-long one is dropped.
        "queries": ["rainy evening jazz", "cozy acoustic"],
    }
    assert shelves["artist"]["title"] == "Fordi I hører Bon Iver"
    assert shelves["artist"]["why"] == "Fordi I hører meget Bon Iver."
    assert shelves["daypart"]["title"] == "Til aftenen"
    assert shelves["daypart"]["why"] == "Fordi det regner og det er aften."
    assert shelves["season"] == {
        "slot": "season",
        "title": "Op mod jul",
        "why": "Fordi der er 35 dage til jul.",
        "queries": ["christmas"],
    }


async def test_a_failed_plan_is_not_asked_again_and_no_allowance_means_no_call(tmp_path):
    hits = []

    def broken(request):
        hits.append(request)
        return httpx.Response(500)

    async with httpx.AsyncClient(transport=httpx.MockTransport(broken)) as client:
        planner = FindMusicPlanner(selector(client, tmp_path))
        assert await planner.plan(parse_request(REQUEST)) == {"ok": False, "error": "ai_failed"}
        assert await planner.plan(parse_request(REQUEST)) == {"ok": False, "error": "ai_failed"}
        assert len(hits) == 1
        spent = FindMusicPlanner(selector(client, tmp_path))
        spent.shared.allowance = RequestAllowance(0)
        assert await spent.plan(parse_request(REQUEST)) == {"ok": False, "error": "ai_unavailable"}
        assert len(hits) == 1
    assert configured_planner(None) is None
    assert configured_planner(SimpleNamespace(model=MODEL, allowance=RequestAllowance(1))) is None


@pytest.mark.parametrize(
    "shelves",
    [
        [{"slot": "invented", "title": "x", "basis": [], "queries": ["jazz"]}],
        [{"slot": "moment", "title": "x", "basis": ["mood"], "queries": ["jazz"]}],
        [{"slot": "moment", "title": "x", "basis": [], "queries": []}],
        [{"slot": "moment", "title": "x", "basis": [], "queries": ["jazz"], "uri": "spotify:x"}],
    ],
)
async def test_model_output_outside_the_closed_shape_is_no_plan(tmp_path, shelves):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: model_answer(shelves))
    ) as client:
        planner = FindMusicPlanner(selector(client, tmp_path))
        assert await planner.plan(parse_request(REQUEST)) == {"ok": False, "error": "ai_failed"}


@pytest.mark.parametrize(
    "change",
    [
        {"hour": 24},
        {"hour": True},
        {"date": "19-11-2026"},
        {"artists": ["a"] * 6},
        {"weather": {"condition": "rainy"}},
        {"weather": {"condition": "rainy", "temperature": float("nan")}},
        {"extra": 1},
    ],
)
def test_the_request_is_closed(change):
    with pytest.raises(ValueError):
        parse_request({**REQUEST, **change})


def test_unknown_weather_is_no_fact_and_titles_must_be_true():
    request = parse_request(
        {**REQUEST, "weather": {"condition": "exceptional", "temperature": None}}
    )
    assert request["weather"] is None
    facts = facts_for(date(2026, 7, 4), 9, {"condition": "sunny", "temperature": 24}, [])
    assert "daysToChristmas" not in facts and facts["season"] == "sommer"
    assert honest_title("moment", "Solskin til lørdag morgen", facts) == "Solskin til lørdag morgen"
    assert honest_title("moment", "Regnvejr til lørdag morgen", facts) == "Til lørdag morgen"
    assert honest_title("moment", "Fredag aften", facts) == "Til lørdag morgen"


async def picks_client(tools):
    app = web.Application()
    app[BRIDGE] = SimpleNamespace(tools=tools)
    app.router.add_post("/view/api/find-music/picks", find_music_picks_http)
    client = TestClient(TestServer(app, host="127.0.0.1"))
    await client.start_server()
    return client


async def test_the_endpoint_answers_home_assistant_on_loopback_only(tmp_path):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: model_answer(SHELVES))
    ) as provider:
        tools = SimpleNamespace(podview_mood_selector=selector(provider, tmp_path))
        client = await picks_client(tools)
        try:
            headers = {"X-PodView-Request": "1"}
            response = await client.post(
                "/view/api/find-music/picks", json=REQUEST, headers=headers
            )
            body = await response.json()
            assert response.status == 200 and body["ok"] is True and len(body["shelves"]) == 4
            refused = await client.post("/view/api/find-music/picks", json=REQUEST)
            assert refused.status == 403
            ingress = await client.post(
                "/view/api/find-music/picks",
                json=REQUEST,
                headers={**headers, "X-Remote-User-Id": "a" * 32},
            )
            assert ingress.status == 403
            invalid = await client.post(
                "/view/api/find-music/picks", json={**REQUEST, "room": "x"}, headers=headers
            )
            assert invalid.status == 400
        finally:
            await client.close()


async def test_without_the_mood_selector_the_endpoint_says_ai_unavailable():
    client = await picks_client(SimpleNamespace(podview_mood_selector=None))
    try:
        response = await client.post(
            "/view/api/find-music/picks", json=REQUEST, headers={"X-PodView-Request": "1"}
        )
        assert await response.json() == {"ok": False, "error": "ai_unavailable"}
    finally:
        await client.close()


def _integration_constant(name):
    tree = ast.parse((ROOT / "custom_components/podvoice/find_music.py").read_text())
    for node in tree.body:
        targets = [node.target] if isinstance(node, ast.AnnAssign) else getattr(node, "targets", [])
        if any(getattr(target, "id", None) == name for target in targets):
            return ast.literal_eval(node.value)
    raise AssertionError(name)


def test_every_activity_tile_has_one_fixed_playlist_search():
    activities = _integration_constant("ACTIVITIES")
    assert list(activities) == ["cooking", "focus", "hygge", "party", "sleep", "workout"]
    assert [title for title, _query in activities.values()] == [
        "Madlavning",
        "Fokus",
        "Hygge",
        "Fest",
        "Godnat",
        "Træning",
    ]
    assert all(1 <= len(query) <= 60 for _title, query in activities.values())


def test_the_integration_searches_at_most_ten_rows_and_never_a_removed_endpoint():
    assert _integration_constant("SEARCH_LIMIT") == 10
    source = (ROOT / "custom_components/podvoice/find_music.py").read_text()
    tree = ast.parse(source)
    tree.body = tree.body[1:]  # The module docstring names the removed endpoints it avoids.
    code = ast.unparse(tree)
    services = {
        node.value
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Constant)
        and node.value in {"search_tracks", "search_playlists", "top_artists", "top_tracks"}
    }
    assert services == {"search_tracks", "search_playlists", "top_artists"}
    for removed in SPOTIFY_REMOVED:
        assert removed not in code
    addon = (ROOT / "podvoice/gatekeeper/podview_find_music.py").read_text()
    for removed in SPOTIFY_REMOVED:
        assert removed not in addon
