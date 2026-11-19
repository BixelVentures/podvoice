"""Find musik shelves owner: order, caching/TTL, backoff, degradation and AI honesty."""

import asyncio
from datetime import datetime

import pytest
from music_shelves_fixture import (
    ACCOUNT,
    AI_SHELVES,
    NEW_SERVICES,
    FakeShelfSelector,
    recent_contexts,
    reply,
)

from gatekeeper import podview_music_shelves as shelves_module
from gatekeeper.podview_music_shelves import (
    ZONE,
    MusicShelves,
    candidate_rows,
    facts_for,
    honest_basis,
    honest_title,
    reason_for,
)

THURSDAY_1413 = datetime(2026, 11, 19, 14, 13, tzinfo=ZONE).timestamp()
ALL = NEW_SERVICES | {"search_playlists", "get_user_playlists"}
RAIN = {"condition": "rainy", "temperature": 8.2}


class Clock:
    def __init__(self, wall=THURSDAY_1413):
        self.wall, self.mono = wall, 1000.0

    def advance(self, seconds):
        self.wall += seconds
        self.mono += seconds


class Reader:
    def __init__(self, services=ALL, *, fail=None, limited=False):
        self.services, self.fail, self.limited = set(services), fail, limited
        self.calls: list[tuple[str, dict]] = []
        self.active = self.peak = 0
        self.override: dict[str, dict] = {}

    async def __call__(self, service, account, args):
        self.calls.append((service, dict(args)))
        self.active += 1
        self.peak = max(self.peak, self.active)
        try:
            await asyncio.sleep(0)
            if service not in self.services:
                return {"ok": False, "error_kind": "unsupported"}
            if self.limited:
                return {"ok": False, "error_kind": "rate_limited"}
            if self.fail == service:
                return {"ok": False, "error_kind": "unavailable"}
            data = self.override.get(service) or reply(
                service, {**args, "config_entry_id": account}
            )
            return {"ok": True, "data": data}
        finally:
            self.active -= 1


def owner(clock):
    return MusicShelves(clock=lambda: clock.wall, monotonic=lambda: clock.mono)


async def weather():
    return dict(RAIN)


async def read(shelves, reader, selector=None, services=ALL, **extra):
    return await shelves.read(
        ACCOUNT,
        reader=reader,
        available=set(services),
        selector=selector,
        weather=weather,
        **extra,
    )


async def settle(shelves):
    for state in shelves._accounts.values():
        if state.task is not None:
            await state.task


def titles(result):
    return [shelf["title"] for shelf in result["shelves"]]


async def test_page_order_matches_concept_b_with_ai_and_library():
    clock, reader, selector = Clock(), Reader(), FakeShelfSelector()
    shelves = owner(clock)
    result = await read(shelves, reader, selector)
    assert [shelf["id"] for shelf in result["shelves"]] == [
        "ai_moment",
        "artists",
        "ai_artist",
        "recent",
        "ai_daypart",
        "albums",
        "ai_season",
        "podcasts",
    ]
    assert titles(result)[:3] == [
        "Til en regnvejrs-torsdag",
        "Jeres kunstnere",
        "Fordi I hører Nina Simone",
    ]
    moment = result["shelves"][0]
    assert moment["ai"] is True
    assert moment["why"] == "Fordi det regner og det er torsdag eftermiddag."
    assert result["shelves"][1]["shape"] == "round"
    assert result["shelves"][1]["why"] == "Det, I spiller mest"
    assert result["shelves"][-1]["why"] == "Dem, I har gemt"
    season = result["shelves"][6]
    assert season["title"] == "Op mod jul" and season["why"] == "Fordi der er 35 dage til jul."
    # Six quick picks: AI at the 2nd and 6th place, the newest recent contexts around them.
    quick = result["quick"]
    assert len(quick) == 6
    assert [q.get("ai") for q in quick] == [None, "regn", None, None, None, "eftermiddag"]
    items = result["items"]
    assert items[quick[0]["item"]]["name"] == "Kind of Blue"
    assert items[quick[2]["item"]]["name"] == "Søndagsmorgen"
    # One AI call for the day part; its facts are only clock, calendar, weather and artists.
    assert len(selector.calls) == 1
    facts = selector.calls[0]
    assert facts["slots"] == ["moment", "artist", "daypart", "season"]
    assert facts["weekday"] == "torsdag" and facts["dayPart"] == "afternoon"
    assert facts["weather"] == {"condition": "rainy", "temperature": 8}
    assert facts["daysToChristmas"] == 35
    assert facts["topArtists"][0] == "Nina Simone"
    assert result["ownerEpoch"] == "a" * 32


async def test_ai_items_are_real_search_hits_deduplicated_and_bounded():
    clock, reader = Clock(), Reader()
    answer = [dict(row, queries=["same query"]) for row in AI_SHELVES]
    result = await read(owner(clock), reader, FakeShelfSelector(answer))
    searches = [args["query"] for service, args in reader.calls if service == "search_playlists"]
    assert searches == ["same query"]
    ai = [shelf for shelf in result["shelves"] if shelf["ai"]]
    # The same three playlists cannot fill two shelves: the first AI shelf keeps them.
    assert len(ai) == 1
    uris = [result["items"][i]["uri"] for i in ai[0]["items"]]
    assert all(uri.startswith("spotify:playlist:") for uri in uris)
    assert len(result["items"]) <= shelves_module.MAX_ITEMS


async def test_no_ai_means_no_ai_shelves_and_no_ai_badges():
    clock, reader = Clock(), Reader()
    result = await read(owner(clock), reader, None)
    assert not any(shelf["ai"] for shelf in result["shelves"])
    assert not any("ai" in quick for quick in result["quick"])
    assert titles(result) == ["Jeres kunstnere", "Fortsæt med at lytte", "Gemte album", "Podcasts"]
    assert not any(service == "search_playlists" for service, _ in reader.calls)


async def test_exhausted_or_failed_ai_never_fakes_a_reason():
    clock, reader = Clock(), Reader()
    exhausted = FakeShelfSelector(available=False)
    result = await read(owner(clock), reader, exhausted)
    assert exhausted.calls == [] and not any(shelf["ai"] for shelf in result["shelves"])
    clock2 = Clock()
    failing = FakeShelfSelector()
    failing.answer = "unusable"  # not a list: the model answer could not be used
    shelves = owner(clock2)
    result = await read(shelves, Reader(), failing)
    assert not any(shelf["ai"] for shelf in result["shelves"])
    # A failed AI answer is not retried for every page open (budget), only later.
    await read(shelves, Reader(), failing)
    assert len(failing.calls) == 1


def test_reason_is_composed_only_from_cited_real_facts():
    now = datetime.fromtimestamp(THURSDAY_1413, ZONE)
    facts = facts_for(now, RAIN, ["Nina Simone"])
    assert reason_for(["weather", "weekday", "day_part"], facts) == (
        "Fordi det regner og det er torsdag eftermiddag.",
        "regn",
    )
    # No weather observed: weather can be neither cited nor phrased.
    dry = facts_for(now, None, [])
    assert "weather" not in dry
    assert honest_basis("moment", ["weather"], dry) == []
    assert reason_for(honest_basis("moment", ["weather"], dry), dry) is None
    assert honest_basis("moment", ["weather", "weekday"], dry) == ["weekday"]
    # Each slot cites what it is by definition; an artist shelf needs real top artists.
    assert honest_basis("artist", [], facts) == ["top_artists"]
    assert honest_basis("artist", ["weather"], dry) == []
    assert reason_for(["top_artists"], facts) == ("Fordi I hører meget Nina Simone.", "Nina Simone")
    summer = facts_for(datetime(2026, 7, 3, 9, 0, tzinfo=ZONE), None, [])
    assert reason_for(["season"], summer) == ("Fordi det er sommer.", "sommer")
    assert reason_for(["day_part"], summer) == ("Fordi det er morgen.", "morgen")


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Til en regnvejrs-torsdag", "Til en regnvejrs-torsdag"),
        ("Solskin på en torsdag", "Til torsdag eftermiddag"),  # it is raining
        ("Fredagsbar", "Til torsdag eftermiddag"),  # it is Thursday
        ("Til aftensmaden kl. 17", "Til torsdag eftermiddag"),  # no invented clock times
        ("Rolig aften", "Til torsdag eftermiddag"),  # it is afternoon
        ("Sommerhygge", "Til torsdag eftermiddag"),  # it is November
        ("Til aftensmaden", "Til aftensmaden"),
        ("Grå dag, varm lyd", "Grå dag, varm lyd"),
        ("x" * 41, "Til torsdag eftermiddag"),
    ],
)
def test_ai_titles_with_untrue_facts_fall_back_to_a_true_title(title, expected):
    facts = facts_for(datetime.fromtimestamp(THURSDAY_1413, ZONE), RAIN, ["Nina Simone"])
    assert honest_title("moment", title, facts) == expected
    assert honest_title("artist", "Fordi I elsker techno", facts) == "Fordi I hører Nina Simone"
    assert honest_title("season", "Op mod jul", facts) == "Op mod jul"


async def test_cached_shelves_are_served_at_once_and_refresh_in_background():
    clock, reader = Clock(), Reader()
    shelves = owner(clock)
    first = await read(shelves, reader, FakeShelfSelector())
    calls = len(reader.calls)
    assert first["refreshing"] is False
    # Within every TTL: no provider call at all.
    clock.advance(120)
    again = await read(shelves, reader, FakeShelfSelector())
    assert len(reader.calls) == calls and again["shelves"] == first["shelves"]
    # Recent contexts expire after five minutes; the cached page is answered immediately.
    clock.advance(200)
    reader.override["recent_contexts"] = recent_contexts()
    reader.override["recent_contexts"]["contexts"][0]["name"] = "Ny afspilning"
    stale = await read(shelves, reader, FakeShelfSelector())
    assert stale["refreshing"] is True
    assert stale["items"][stale["quick"][0]["item"]]["name"] == "Kind of Blue"
    await settle(shelves)
    assert [service for service, _ in reader.calls[calls:]] == ["recent_contexts"]
    fresh = await read(shelves, reader, FakeShelfSelector())
    assert fresh["items"][fresh["quick"][0]["item"]]["name"] == "Ny afspilning"
    # Six hours later the library sources renew too.
    clock.advance(6 * 3600)
    await read(shelves, reader, FakeShelfSelector())
    await settle(shelves)
    renewed = {service for service, _ in reader.calls[calls + 1 :]}
    assert {"top_artists", "saved_albums", "saved_shows", "recent_contexts"} <= renewed


async def test_ai_plan_is_per_day_part_and_season_per_day():
    clock, reader, selector = Clock(), Reader(), FakeShelfSelector()
    shelves = owner(clock)
    await read(shelves, reader, selector)
    clock.advance(3600)  # still afternoon: no new AI call
    await read(shelves, reader, selector)
    await settle(shelves)
    assert len(selector.calls) == 1
    clock.advance(3 * 3600)  # evening: a new plan, but today's season shelf is kept
    result = await read(shelves, reader, selector)
    await settle(shelves)
    result = await read(shelves, reader, selector)
    assert len(selector.calls) == 2
    assert selector.calls[1]["slots"] == ["moment", "artist", "daypart"]
    assert selector.calls[1]["dayPart"] == "evening"
    assert "Op mod jul" in titles(result)


async def test_rate_limit_keeps_cached_shelves_and_backs_off():
    clock, reader = Clock(), Reader()
    shelves = owner(clock)
    first = await read(shelves, reader, FakeShelfSelector())
    clock.advance(301)
    reader.limited = True
    stale = await read(shelves, reader, FakeShelfSelector())
    await settle(shelves)
    calls = len(reader.calls)
    # Still the last-known page, and no new call while backing off (10 minutes first).
    for _ in range(5):
        clock.advance(60)
        again = await read(shelves, reader, FakeShelfSelector())
        assert again["shelves"] == first["shelves"] == stale["shelves"]
    assert len(reader.calls) == calls
    clock.advance(600)
    await read(shelves, reader, FakeShelfSelector())
    await settle(shelves)
    assert len(reader.calls) == calls + 1  # one honest retry, then twice as long
    clock.advance(700)
    await read(shelves, reader, FakeShelfSelector())
    assert len(reader.calls) == calls + 1


async def test_concurrent_requests_share_one_bounded_refresh():
    clock, reader = Clock(), Reader()
    shelves = owner(clock)
    results = await asyncio.gather(*(read(shelves, reader, FakeShelfSelector()) for _ in range(8)))
    assert all(result["shelves"] == results[0]["shelves"] for result in results)
    library = [service for service, _ in reader.calls if service != "search_playlists"]
    assert sorted(library) == sorted(NEW_SERVICES)
    assert reader.peak <= 2


async def test_older_control_without_new_services_degrades_gracefully():
    clock = Clock()
    old = {"search_playlists", "get_user_playlists"}
    result = await read(owner(clock), Reader(old), FakeShelfSelector(), services=old)
    ids = [shelf["id"] for shelf in result["shelves"]]
    assert "artists" not in ids and "recent" not in ids and "albums" not in ids
    assert "podcasts" not in ids and "ai_artist" not in ids
    assert "playlists" in ids and "ai_moment" in ids
    # A Control that lists a service but refuses it is treated the same, and not asked again.
    clock2, reader = Clock(), Reader({"get_user_playlists"})
    shelves = owner(clock2)
    result = await read(shelves, reader, None, services=ALL)
    assert [shelf["id"] for shelf in result["shelves"]] == ["playlists"]
    clock2.advance(7 * 3600)
    await read(shelves, reader, None, services=ALL)
    await settle(shelves)
    assert [s for s, _ in reader.calls].count("top_artists") == 1


async def test_owner_epoch_change_drops_everything_from_the_previous_owner():
    clock, reader = Clock(), Reader()
    shelves = owner(clock)
    await read(shelves, reader, None)
    clock.advance(301)
    reader.override["recent_contexts"] = recent_contexts(epoch="b" * 32)
    await read(shelves, reader, None)
    await settle(shelves)
    result = await read(shelves, reader, None)
    assert result["ownerEpoch"] == "b" * 32
    assert titles(result) == ["Fortsæt med at lytte"]
    await settle(shelves)


async def test_untrusted_artwork_and_malformed_rows_are_rejected():
    clock, reader = Clock(), Reader()
    bad = reply("saved_albums", {})
    bad["albums"][1]["artwork"]["url"] = "http://i.scdn.co/image/x"
    bad["albums"][2]["artwork"]["url"] = "https://evil.example/image/x"
    reader.override["saved_albums"] = bad
    result = await read(owner(clock), reader, None)
    albums = next(shelf for shelf in result["shelves"] if shelf["id"] == "albums")
    rows = [result["items"][index] for index in albums["items"]]
    assert "artwork" not in rows[1] and "artwork" not in rows[2]
    # The first album is also the newest recent context; one item per URI, first source wins.
    assert rows[0]["artwork"] == "https://i.scdn.co/image/recent0"
    clock2, reader2 = Clock(), Reader()
    broken = reply("top_artists", {})
    broken["artists"][0]["uri"] = "spotify:track:" + "x" * 22
    reader2.override["top_artists"] = broken
    result = await read(owner(clock2), reader2, None)
    assert "artists" not in [shelf["id"] for shelf in result["shelves"]]


def test_candidate_rows_carry_type_labels_not_creators():
    rows = candidate_rows(
        [
            {"uri": "spotify:album:" + "a" * 22, "kind": "album", "name": "A", "byline": "X"},
            {"uri": "spotify:show:" + "b" * 22, "kind": "show", "name": "B"},
        ]
    )
    assert rows == [
        {"uri": "spotify:album:" + "a" * 22, "name": "A", "artist": "Album"},
        {"uri": "spotify:show:" + "b" * 22, "name": "B", "artist": "Podcast"},
    ]
