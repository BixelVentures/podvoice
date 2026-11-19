"""Find musik shelves: the household's own Spotify library plus a few AI-chosen shelves.

One owner per PodVoice process. Library reads and AI plans are cached per account and
PodConnect owner epoch; a request is answered from last-known data at once while one
bounded background refresh (at most two concurrent PodConnect reads) renews what has
expired. A rate limit or failure keeps the cached shelves and backs off; it never
stampedes the shared Spotify quota. AI shelves exist only when the existing mood
selector and its budget allow a call, and every reason line is composed here from the
real facts the model cited, never from model text.
"""

from __future__ import annotations

import asyncio
import contextlib
import math
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from .podview_mood import SHELF_BASIS, day_part
from .podview_music import normalize_search_query

SCHEMA = "podview.music_shelves.v1"
ZONE = ZoneInfo("Europe/Copenhagen")
RECENT_TTL = 300.0
LIBRARY_TTL = 6 * 3600.0
BACKOFF_BASE = 120.0
RATE_LIMIT_BASE = 600.0
BACKOFF_MAX = 4 * 3600.0
AI_RETRY = 1800.0
FIRST_READ_WAIT = 8.0
MAX_ITEMS = 120
SHELF_ITEMS = 12
QUICK = 6

# Source key -> (PodConnect service, arguments, schema, list key, ttl)
LIBRARY: dict[str, tuple[str, dict, str, str, float]] = {
    "recent": (
        "recent_contexts",
        {"limit": 12},
        "podconnect.recent_contexts.v1",
        "contexts",
        RECENT_TTL,
    ),
    "artists": (
        "top_artists",
        {"limit": 12, "time_range": "medium_term"},
        "podconnect.top_artists.v1",
        "artists",
        LIBRARY_TTL,
    ),
    "albums": ("saved_albums", {"limit": 20}, "podconnect.saved_albums.v1", "albums", LIBRARY_TTL),
    "shows": ("saved_shows", {"limit": 20}, "podconnect.saved_shows.v1", "shows", LIBRARY_TTL),
    "playlists": (
        "get_user_playlists",
        {"limit": 20},
        "podconnect.user_playlists.v1",
        "playlists",
        LIBRARY_TTL,
    ),
}
_URI = re.compile(r"^spotify:(playlist|album|artist|show):[A-Za-z0-9]{22}$")
_IMAGE_PATH = re.compile(r"^/image/[A-Za-z0-9_-]{1,128}$")
_PLAYED_AT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$")
_HOSTS = frozenset({"i.scdn.co", "image-cdn-fa.spotifycdn.com", "image-cdn-ak.spotifycdn.com"})

WEEKDAYS = ("mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag")
DAY_PARTS = {"morning": "morgen", "afternoon": "eftermiddag", "evening": "aften", "night": "nat"}
DAY_PART_TITLES = {
    "morning": "Til morgenen",
    "afternoon": "Til eftermiddagen",
    "evening": "Til aftenen",
    "night": "Til natten",
}
# HA weather conditions -> (reason phrase, short badge word, title words that fit).
WEATHER = {
    "rainy": ("det regner", "regn", {"regn", "regnvejr", "regnvejrs", "våd", "grå"}),
    "pouring": ("det øsregner", "regn", {"regn", "regnvejr", "regnvejrs", "øsregn", "grå"}),
    "lightning-rainy": ("der er torden og regn", "torden", {"torden", "regn", "regnvejr"}),
    "lightning": ("der er torden", "torden", {"torden"}),
    "snowy": ("det sner", "sne", {"sne", "snevejr", "hvid", "vinter"}),
    "snowy-rainy": ("der falder slud", "slud", {"slud", "grå"}),
    "hail": ("det hagler", "hagl", {"hagl", "grå"}),
    "sunny": ("solen skinner", "sol", {"sol", "solskin", "solrig", "solskins", "lys"}),
    "clear-night": ("det er en klar nat", "klar nat", {"klar", "stjerne", "stjerner"}),
    "cloudy": ("det er overskyet", "skyer", {"skyer", "overskyet", "grå"}),
    "partlycloudy": ("det er let skyet", "skyer", {"skyer", "skyet", "grå"}),
    "fog": ("det er tåget", "tåge", {"tåge", "tåget", "grå"}),
    "windy": ("det blæser", "blæst", {"blæst", "blæsende", "vind"}),
    "windy-variant": ("det blæser", "blæst", {"blæst", "blæsende", "vind"}),
}
_WEATHER_WORDS = re.compile(
    r"regn|øsregn|torden|sne|slud|hagl|solskin|\bsol|tåge|blæs|storm|\bvind|skyer|skyet|overskyet"
)
_SEASON_WORDS = {
    "jul": lambda d: d.month == 11 or (d.month == 12 and d.day <= 26),
    "advent": lambda d: d.month == 11 or (d.month == 12 and d.day <= 24),
    "sommer": lambda d: d.month in (6, 7, 8),
    "vinter": lambda d: d.month in (12, 1, 2),
    "forår": lambda d: d.month in (3, 4, 5),
    "efterår": lambda d: d.month in (9, 10, 11),
    "påske": lambda d: False,
    "nytår": lambda d: (d.month == 12 and d.day >= 27) or (d.month == 1 and d.day <= 2),
}
_DAY_PART_WORDS = {
    "morgen": {"morning"},
    "formiddag": {"morning"},
    "morgenmad": {"morning"},
    "frokost": {"morning", "afternoon"},
    "eftermiddag": {"afternoon"},
    "aftensmad": {"afternoon", "evening"},
    "aften": {"evening"},
    "nat": {"night", "evening"},
}


def _season(day: date) -> str:
    return {12: "vinter", 1: "vinter", 2: "vinter", 3: "forår", 4: "forår", 5: "forår"}.get(
        day.month, "sommer" if day.month in (6, 7, 8) else "efterår"
    )


def _days_to_christmas(day: date) -> int | None:
    eve = date(day.year, 12, 24)
    return (eve - day).days if day.month in (11, 12) and day <= eve else None


def facts_for(now: datetime, weather: dict | None, artists: list[str]) -> dict:
    """The only inputs an AI shelf may rest on: clock, calendar, weather, top artists."""
    local = now.astimezone(ZONE)
    facts: dict[str, Any] = {
        "weekday": WEEKDAYS[local.weekday()],
        "dayPart": day_part(local.hour),
        "hour": local.hour,
        "date": local.date().isoformat(),
        "season": _season(local.date()),
    }
    christmas = _days_to_christmas(local.date())
    if christmas is not None:
        facts["daysToChristmas"] = christmas
    if isinstance(weather, dict) and weather.get("condition") in WEATHER:
        facts["weather"] = {"condition": weather["condition"]}
        temperature = weather.get("temperature")
        if isinstance(temperature, int | float) and math.isfinite(temperature):
            facts["weather"]["temperature"] = round(temperature)
    if artists:
        facts["topArtists"] = artists[:5]
    return facts


def _join(parts: list[str]) -> str:
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " og " + parts[-1]


def honest_basis(slot: str, basis: list[str], facts: dict) -> list[str]:
    """Only facts that exist are cited; each slot cites what it is by definition."""
    available = {"weekday", "day_part", "season"}
    if "weather" in facts:
        available.add("weather")
    if facts.get("topArtists"):
        available.add("top_artists")
    required = {"daypart": "day_part", "season": "season", "artist": "top_artists"}.get(slot)
    cited = [item for item in basis if item in available and item in SHELF_BASIS]
    if required is not None and required not in cited:
        if required not in available:
            return []
        cited.insert(0, required)
    if slot == "artist":
        cited = ["top_artists"]
    return list(dict.fromkeys(cited))


def reason_for(basis: list[str], facts: dict) -> tuple[str, str] | None:
    """(one-line Danish reason, short badge word), composed only from cited facts."""
    parts: list[str] = []
    shorts: list[str] = []
    if "weather" in basis and "weather" in facts:
        phrase, short, _ = WEATHER[facts["weather"]["condition"]]
        parts.append(phrase)
        shorts.append(short)
    weekday = "weekday" in basis
    part = "day_part" in basis
    if weekday or part:
        words = [facts["weekday"]] if weekday else []
        if part:
            words.append(DAY_PARTS[facts["dayPart"]])
        parts.append("det er " + " ".join(words))
        shorts.append(DAY_PARTS[facts["dayPart"]] if part else facts["weekday"])
    if "season" in basis:
        christmas = facts.get("daysToChristmas")
        if christmas == 0:
            parts.append("det er juleaften")
        elif christmas is not None:
            parts.append(f"der er {christmas} {'dag' if christmas == 1 else 'dage'} til jul")
        else:
            parts.append("det er " + facts["season"])
        shorts.append("jul" if christmas is not None else facts["season"])
    if "top_artists" in basis and facts.get("topArtists"):
        parts.append("I hører meget " + facts["topArtists"][0])
        shorts.append(facts["topArtists"][0][:24])
    if not parts:
        return None
    return "Fordi " + _join(parts) + ".", shorts[0]


def fallback_title(slot: str, facts: dict) -> str:
    if slot == "artist":
        return "Fordi I hører " + facts["topArtists"][0]
    if slot == "daypart":
        return DAY_PART_TITLES[facts["dayPart"]]
    if slot == "season":
        if facts.get("daysToChristmas") is not None:
            return "Op mod jul"
        return {"vinter": "Til vinteren", "forår": "Til foråret", "sommer": "Til sommeren"}.get(
            facts["season"], "Til efteråret"
        )
    return f"Til {facts['weekday']} {DAY_PARTS[facts['dayPart']]}"


def _day_part_words_true(lower: str, part: str) -> bool:
    # Longest word first, so "aftensmad" is judged as itself and not as "aften".
    for word in sorted(_DAY_PART_WORDS, key=len, reverse=True):
        pattern = r"\b" + word + r"\w*"
        if re.search(pattern, lower):
            if part not in _DAY_PART_WORDS[word]:
                return False
            lower = re.sub(pattern, " ", lower)
    return True


def honest_title(slot: str, title: Any, facts: dict) -> str:
    """The model's title only when every fact-like word in it is true right now."""
    if slot == "artist" or not isinstance(title, str):
        return fallback_title(slot, facts)
    text = " ".join(title.split())
    lower = text.lower()
    today = date.fromisoformat(facts["date"])
    weather = facts.get("weather")
    allowed_weather = WEATHER[weather["condition"]][2] if weather else set()
    honest = (
        1 <= len(text) <= 40
        and re.fullmatch(r"[\w .,:'\u2019&!?-]+", text) is not None
        and not re.search(r"\d", text)
        and all(day == facts["weekday"] for day in WEEKDAYS if day in lower)
        and _day_part_words_true(lower, facts["dayPart"])
        and all(rule(today) for word, rule in _SEASON_WORDS.items() if word in lower)
        and all(
            any(word.startswith(match.group().strip()) for word in allowed_weather)
            or any(match.group().strip() in word for word in allowed_weather)
            for match in _WEATHER_WORDS.finditer(lower)
        )
    )
    return text if honest else fallback_title(slot, facts)


def _artwork(value: Any) -> str | None:
    if not isinstance(value, dict) or set(value) != {"kind", "provider", "url"}:
        return None
    url = value.get("url")
    if (
        value.get("provider") != "spotify"
        or not isinstance(value.get("kind"), str)
        or not isinstance(url, str)
        or not 1 <= len(url) <= 512
    ):
        return None
    try:
        parsed = urlsplit(url)
        if (
            parsed.scheme != "https"
            or parsed.hostname not in _HOSTS
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port is not None
            or parsed.query
            or parsed.fragment
            or not _IMAGE_PATH.fullmatch(parsed.path)
            or url != f"https://{parsed.hostname}{parsed.path}"
        ):
            return None
    except ValueError:
        return None
    return url


def _text(value: Any, maximum: int = 256) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError("invalid text")
    return value


def _item(row: Any, kind: str, *, byline: Any = None, played: Any = None) -> dict:
    if not isinstance(row, dict):
        raise ValueError("invalid row")
    uri = _text(row.get("uri"), 64)
    if _URI.fullmatch(uri) is None or uri.split(":")[1] != kind:
        raise ValueError("invalid uri")
    item: dict[str, Any] = {"uri": uri, "kind": kind, "name": _text(row.get("name"))}
    if isinstance(byline, str) and byline.strip() and len(byline) <= 512:
        item["byline"] = byline
    if isinstance(played, str) and _PLAYED_AT.fullmatch(played):
        item["lastPlayedAt"] = played
    artwork = _artwork(row.get("artwork"))
    if artwork is not None:
        item["artwork"] = artwork
    return item


def project_library(source: str, value: Any, account: str) -> tuple[str, list[dict]]:
    """(owner epoch, closed items) from one PodConnect library envelope, or ValueError."""
    _service, _args, schema, key, _ttl = LIBRARY[source]
    if (
        not isinstance(value, dict)
        or value.get("ok") is not True
        or value.get("schema") != schema
        or value.get("config_entry_id") != account
        or value.get("source") != "spotify_web_api"
    ):
        raise ValueError("invalid envelope")
    epoch = _text(value.get("owner_epoch"), 128)
    rows = value.get(key)
    if not isinstance(rows, list) or len(rows) > 20 or value.get("returned_count") != len(rows):
        raise ValueError("invalid rows")
    items = []
    for row in rows:
        if source == "recent":
            kind = row.get("type") if isinstance(row, dict) else None
            if kind not in ("playlist", "album", "artist", "show"):
                raise ValueError("invalid context")
            items.append(_item(row, kind, played=row.get("last_played_at")))
        elif source == "artists":
            items.append(_item(row, "artist"))
        elif source == "albums":
            items.append(_item(row, "album", byline=row.get("artist")))
        elif source == "shows":
            items.append(_item(row, "show", byline=row.get("publisher")))
        else:
            items.append(_item(row, "playlist"))
    if len({item["uri"] for item in items}) != len(items):
        raise ValueError("duplicate items")
    return epoch, items


def project_search(value: Any, account: str, query: str) -> tuple[str, list[dict]]:
    if (
        not isinstance(value, dict)
        or value.get("ok") is not True
        or value.get("schema") != "podconnect.search_playlists.v1"
        or value.get("config_entry_id") != account
        or value.get("source") != "spotify_web_api"
        or value.get("query") != query
    ):
        raise ValueError("invalid search")
    epoch = _text(value.get("owner_epoch"), 128)
    rows = value.get("playlists")
    if not isinstance(rows, list) or len(rows) > 20 or value.get("returned_count") != len(rows):
        raise ValueError("invalid search rows")
    return epoch, [_item(row, "playlist") for row in rows]


Reader = Callable[[str, str, dict], Awaitable[dict]]


@dataclass
class _Source:
    items: list[dict] | None = None
    fetched: float = -math.inf
    unsupported: bool = False


@dataclass
class _Plan:
    """One AI answer for a day part: titles, honest reasons and the searched playlists."""

    facts: dict
    shelves: list[dict]
    results: dict[str, list[dict] | None] = field(default_factory=dict)


@dataclass
class _Account:
    epoch: str | None = None
    sources: dict[str, _Source] = field(default_factory=lambda: {k: _Source() for k in LIBRARY})
    plans: dict[tuple[str, str], _Plan] = field(default_factory=dict)
    seasons: dict[str, dict] = field(default_factory=dict)
    ai_retry: dict[tuple[str, str], float] = field(default_factory=dict)
    backoff_until: float = 0.0
    backoff_step: int = 0
    task: asyncio.Task | None = None
    attempted: bool = False


class _RateLimited(Exception):
    pass


class _Failed(Exception):
    pass


class MusicShelves:
    """Last-known shelves per account; one bounded background refresh at a time."""

    def __init__(
        self,
        *,
        clock: Callable[[], float] = time.time,
        monotonic: Callable[[], float] = time.monotonic,
        concurrency: int = 2,
    ) -> None:
        self.clock, self.monotonic = clock, monotonic
        self.concurrency = concurrency
        self._accounts: dict[str, _Account] = {}
        self._semaphore: asyncio.Semaphore | None = None
        self.provider_calls = 0

    async def aclose(self) -> None:
        tasks = [state.task for state in self._accounts.values() if state.task is not None]
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(BaseException):
                await task

    def _state(self, account: str) -> _Account:
        state = self._accounts.get(account)
        if state is None:
            if len(self._accounts) >= 8:
                oldest = next(iter(self._accounts))
                if self._accounts[oldest].task is None:
                    del self._accounts[oldest]
            state = self._accounts[account] = _Account()
        return state

    def _now(self) -> datetime:
        return datetime.fromtimestamp(self.clock(), ZONE)

    def _stale(self, state: _Account, available: set[str], selector: Any) -> bool:
        now = self.monotonic()
        if now < state.backoff_until:
            return False
        if self._due(state, available):
            return True
        if selector is None or not getattr(selector, "available", False):
            return False
        if "search_playlists" not in available:
            return False
        plan_key = self._plan_key()
        plan = state.plans.get(plan_key)
        if plan is None:
            return state.ai_retry.get(plan_key, -math.inf) <= now
        return any(value is None for value in plan.results.values())

    def _wants_playlists(self, state: _Account, available: set[str]) -> bool:
        """Own playlists are the fallback shelf for a Control without recent contexts."""
        return "recent_contexts" not in available or state.sources["recent"].unsupported

    def _due(self, state: _Account, available: set[str]) -> list[str]:
        now = self.monotonic()
        return [
            key
            for key, (service, _args, _schema, _list, ttl) in LIBRARY.items()
            if service in available
            and not state.sources[key].unsupported
            and now - state.sources[key].fetched >= ttl
            and (key != "playlists" or self._wants_playlists(state, available))
        ]

    def _plan_key(self) -> tuple[str, str]:
        local = self._now()
        return local.date().isoformat(), day_part(local.hour)

    async def read(
        self,
        account: str,
        *,
        reader: Reader,
        available: set[str],
        selector: Any = None,
        weather: Callable[[], Awaitable[dict | None]] | None = None,
        current: Callable[[], bool] = lambda: True,
    ) -> dict:
        """Shelves from last-known data now; a stale cache refreshes in the background."""
        state = self._state(account)
        if state.task is None and self._stale(state, available, selector):
            state.task = asyncio.get_running_loop().create_task(
                self._refresh(account, state, reader, available, selector, weather, current)
            )
        if state.task is not None and not state.attempted:
            # Nothing was ever read for this account: wait (bounded) for the first data.
            with contextlib.suppress(TimeoutError, asyncio.CancelledError):
                await asyncio.wait_for(asyncio.shield(state.task), timeout=FIRST_READ_WAIT)
        projected = self.project(state, available, ai_enabled=selector is not None)
        projected["refreshing"] = state.task is not None and not state.task.done()
        return projected

    async def _call(self, reader: Reader, service: str, account: str, args: dict) -> dict:
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(self.concurrency)
        async with self._semaphore:
            self.provider_calls += 1
            try:
                result = await asyncio.wait_for(reader(service, account, args), timeout=12)
            except Exception as error:
                raise _Failed(service) from error
        if not isinstance(result, dict) or result.get("ok") is not True:
            kind = result.get("error_kind") if isinstance(result, dict) else None
            if kind == "rate_limited":
                raise _RateLimited(service)
            if kind == "unsupported":
                return {"unsupported": True}
            raise _Failed(service)
        return result

    def _accept_epoch(self, state: _Account, epoch: str) -> None:
        if state.epoch is not None and state.epoch != epoch:
            # A new Spotify owner: nothing cached for the previous one may be shown.
            fresh = _Account(epoch=epoch, task=state.task, attempted=state.attempted)
            state.__dict__.update(fresh.__dict__)
        state.epoch = epoch

    async def _refresh(self, account, state, reader, available, selector, weather, current):
        try:
            await self._refresh_library(account, state, reader, available)
            await self._refresh_ai(account, state, reader, available, selector, weather, current)
            state.backoff_step = 0
        except _RateLimited:
            delay = min(BACKOFF_MAX, RATE_LIMIT_BASE * 2**state.backoff_step)
            state.backoff_step += 1
            state.backoff_until = self.monotonic() + delay
        except _Failed:
            delay = min(BACKOFF_MAX, BACKOFF_BASE * 2**state.backoff_step)
            state.backoff_step += 1
            state.backoff_until = self.monotonic() + delay
        except Exception:
            state.backoff_until = self.monotonic() + BACKOFF_BASE
        finally:
            state.attempted = True
            state.task = None

    async def _refresh_library(self, account, state, reader, available) -> None:
        due = self._due(state, available)
        if not due:
            return

        async def one(key):
            service, args, _schema, _list, _ttl = LIBRARY[key]
            result = await self._call(reader, service, account, dict(args))
            if result.get("unsupported"):
                state.sources[key].unsupported = True
                return
            try:
                epoch, items = project_library(key, result.get("data"), account)
            except (ValueError, TypeError, KeyError) as error:
                raise _Failed(service) from error
            self._accept_epoch(state, epoch)
            state.sources[key] = _Source(items=items, fetched=self.monotonic())

        tasks = [asyncio.ensure_future(one(key)) for key in due]
        try:
            results = await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            for task in tasks:
                task.cancel()
        for result in results:
            if isinstance(result, _RateLimited):
                raise result
        for result in results:
            if isinstance(result, BaseException):
                raise _Failed("library") from result
        if self._due(state, available) == ["playlists"]:
            # Recent contexts turned out unsupported: the playlists fallback is due now.
            await self._refresh_library(account, state, reader, available)

    async def _refresh_ai(self, account, state, reader, available, selector, weather, current):
        if (
            selector is None
            or not getattr(selector, "available", False)
            or "search_playlists" not in available
        ):
            return
        key = self._plan_key()
        plan = state.plans.get(key)
        if plan is None:
            if state.ai_retry.get(key, -math.inf) > self.monotonic():
                return
            observed = None
            if weather is not None:
                with contextlib.suppress(Exception):
                    observed = await asyncio.wait_for(weather(), timeout=4)
            artists = [row["name"] for row in state.sources["artists"].items or []]
            facts = facts_for(self._now(), observed, artists)
            slots = ["moment", "daypart"]
            if artists:
                slots.insert(1, "artist")
            if key[0] not in state.seasons:
                slots.append("season")
            answer = await selector.shelves({**facts, "slots": slots}, current=current)
            if not isinstance(answer, list):
                state.ai_retry[key] = self.monotonic() + AI_RETRY
                return
            shelves = []
            for row in answer:
                basis = honest_basis(row["slot"], row["basis"], facts)
                reason = reason_for(basis, facts)
                queries = []
                for query in row["queries"]:
                    with contextlib.suppress(ValueError):
                        queries.append(normalize_search_query(query))
                if reason is None or not queries:
                    continue
                shelves.append(
                    {
                        "slot": row["slot"],
                        "title": honest_title(row["slot"], row["title"], facts),
                        "why": reason[0],
                        "short": reason[1],
                        "queries": queries[:3],
                    }
                )
            plan = _Plan(facts=facts, shelves=shelves)
            plan.results = {q: None for shelf in shelves for q in shelf["queries"]}
            # Keep only today's plans; yesterday's never reach the page.
            state.plans = {k: v for k, v in state.plans.items() if k[0] == key[0]}
            state.plans[key] = plan
            for shelf in shelves:
                if shelf["slot"] == "season" and key[0] not in state.seasons:
                    state.seasons = {key[0]: {**shelf, "plan": plan}}
        limit = 5 if "top_artists" in available else 3
        missing = [query for query, value in plan.results.items() if value is None]

        async def search(query):
            result = await self._call(
                reader, "search_playlists", account, {"query": query, "limit": limit}
            )
            if result.get("unsupported"):
                raise _Failed("search_playlists")
            try:
                epoch, items = project_search(result.get("data"), account, query)
            except (ValueError, TypeError, KeyError) as error:
                raise _Failed("search_playlists") from error
            self._accept_epoch(state, epoch)
            plan.results[query] = items

        tasks = [asyncio.ensure_future(search(query)) for query in missing]
        try:
            results = await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            for task in tasks:
                task.cancel()
        for result in results:
            if isinstance(result, _RateLimited):
                raise result
        for result in results:
            if isinstance(result, BaseException):
                raise _Failed("search") from result

    def project(self, state: _Account, available: set[str], *, ai_enabled: bool = True) -> dict:
        """Ordered, bounded shelves; empty or unavailable shelves are simply absent."""
        items: list[dict] = []
        index: dict[str, int] = {}

        def ref(item: dict) -> int | None:
            if item["uri"] in index:
                return index[item["uri"]]
            if len(items) >= MAX_ITEMS:
                return None
            index[item["uri"]] = len(items)
            items.append(item)
            return index[item["uri"]]

        def refs(rows: list[dict]) -> list[int]:
            result = []
            for row in rows:
                position = ref(row)
                if position is not None and position not in result:
                    result.append(position)
                if len(result) == SHELF_ITEMS:
                    break
            return result

        def library(key: str) -> list[dict]:
            source = state.sources[key]
            return [] if source.unsupported else (source.items or [])

        ai: dict[str, dict] = {}
        plan = state.plans.get(self._plan_key()) if ai_enabled else None
        today = self._plan_key()[0]
        season = state.seasons.get(today) if ai_enabled else None
        used: set[str] = set()
        for slot_plan in [*(plan.shelves if plan else []), *([season] if season else [])]:
            if slot_plan["slot"] in ai:
                continue
            owner = season["plan"] if slot_plan is season and season else plan
            rows: list[dict] = []
            for query in slot_plan["queries"]:
                for row in (owner.results.get(query) if owner else None) or []:
                    if row["uri"] not in used and row["uri"] not in {r["uri"] for r in rows}:
                        rows.append(row)
            rows = rows[:SHELF_ITEMS]
            if rows:
                used.update(row["uri"] for row in rows)
                ai[slot_plan["slot"]] = {**slot_plan, "rows": rows}

        recent = library("recent")
        quick_rows: list[tuple[dict, str | None]] = [(row, None) for row in recent]
        fill: list[tuple[dict, str | None]]
        ai_quick = [
            (shelf["rows"][0], shelf["short"])
            for slot in ("moment", "daypart")
            if (shelf := ai.get(slot)) is not None
        ]
        fill = [(row, None) for row in library("albums")]
        if self._wants_playlists(state, available):
            fill += [(row, None) for row in library("playlists")]
        chosen: list[tuple[dict, str | None]] = []
        seen: set[str] = set()
        positions = {1: 0, 5: 1}
        pool = iter(quick_rows + fill)
        for slot in range(QUICK):
            pick = None
            if slot in positions and positions[slot] < len(ai_quick):
                pick = ai_quick[positions[slot]]
            while pick is None or pick[0]["uri"] in seen:
                pick = next(pool, None)
                if pick is None:
                    break
            if pick is None:
                continue
            seen.add(pick[0]["uri"])
            chosen.append(pick)
        quick = []
        for row, short in chosen:
            position = ref(row)
            if position is not None:
                quick.append({"item": position, **({"ai": short} if short else {})})

        shelves: list[dict] = []

        def add(shelf_id, title, rows, *, why=None, is_ai=False, round_=False):
            refs_ = refs(rows)
            if refs_:
                shelves.append(
                    {
                        "id": shelf_id,
                        "title": title,
                        "ai": is_ai,
                        "why": why,
                        "shape": "round" if round_ else "square",
                        "items": refs_,
                    }
                )

        def add_ai(slot):
            shelf = ai.get(slot)
            if shelf is not None:
                add("ai_" + slot, shelf["title"], shelf["rows"], why=shelf["why"], is_ai=True)

        add_ai("moment")
        add(
            "artists", "Jeres kunstnere", library("artists"), why="Det, I spiller mest", round_=True
        )
        add_ai("artist")
        add("recent", "Fortsæt med at lytte", recent)
        add_ai("daypart")
        add("albums", "Gemte album", library("albums"))
        if self._wants_playlists(state, available):
            add("playlists", "Jeres playlister", library("playlists"))
        add_ai("season")
        add("podcasts", "Podcasts", library("shows"), why="Dem, I har gemt")
        return {
            "ownerEpoch": state.epoch,
            "items": items,
            "quick": quick,
            "shelves": shelves,
        }


def candidate_rows(items: list[dict]) -> list[dict]:
    """The selection broker's rows: URI, name and a type label (never a creator claim)."""
    label = {"playlist": "Playliste", "album": "Album", "artist": "Kunstner", "show": "Podcast"}
    return [{"uri": i["uri"], "name": i["name"], "artist": label[i["kind"]]} for i in items]
