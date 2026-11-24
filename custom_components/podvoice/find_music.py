"""Panel services for Find musik B: Spotify search, Stemning/Humør and the add-on's AI picks.

Everything shown is a real Spotify object found through PodConnect's own search services (``search_tracks``,
``search_playlists``) for the one loaded PodConnect account; nothing is invented here. Spotify's Web API (February
2026) caps a search at 10 rows and has removed recommendations, featured and editorial playlists, new releases,
categories and related artists: none of those is used. Search answers are cached per account and query for ten
minutes and top artists for six hours (the account's quota is shared with PodConnect and the add-on), concurrent
equal reads share one call, and a rate limit pauses this module's Spotify reads for two minutes instead of retrying.

- ``podvoice.music_search``: a free-text search (tracks or playlists) or one Stemning/Humør theme (playlists).
- ``podvoice.music_moods``: the Stemning and Humør themes, the add-on's own tables (podview_mood.THEMES and
  podview_feeling.THEMES, kept equal by tests/unit/test_podview_find_music.py). No Spotify call.
- ``podvoice.music_picks``: »AI-valgt«. The PodVoice add-on owns the AI (its OpenAI key and the mood selector's
  allowance); it is asked on loopback (``POST /view/api/find-music/picks``, the addon_bridge pattern) for search
  ideas and honest reasons, from the local date and hour, the panel's weather entity and the top artist names. The
  playlists come from PodConnect search here. A stopped add-on is ``addon_unavailable`` within seconds, and search
  and moods keep working without it.

Only an active, signed-in Home Assistant user (the panel's kiosk user need not be an admin) may call them.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any

import voluptuous as vol
from aiohttp import ClientError, ClientTimeout
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import HomeAssistantError, Unauthorized
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.util import dt as dt_util

DOMAIN = "podvoice"
PODCONNECT = "podconnect"
_LOGGER = logging.getLogger(__name__)

ADDON_PICKS = "http://127.0.0.1:8098/view/api/find-music/picks"
ADDON_TIMEOUT_S = 8
ADDON_MAX_BYTES = 16384
# Spotify Web API, February 2026: a search returns at most 10 rows.
SEARCH_LIMIT = 10
SEARCH_TTL_S = 600.0
ARTISTS_TTL_S = 6 * 3600.0
PICKS_TTL_S = 3600.0
PICKS_FAILED_TTL_S = 300.0
RATE_LIMIT_PAUSE_S = 120.0
READ_BUDGET_S = 10
CACHE_ENTRIES = 64
SHELF_ITEMS = 12
QUERIES_PER_SHELF = 2

_TRACK = re.compile(r"^spotify:track:[A-Za-z0-9]{22}$")
_PLAYLIST = re.compile(r"^spotify:playlist:[A-Za-z0-9]{22}$")
_IMAGE = re.compile(
    r"^https://(?:i\.scdn\.co|image-cdn-fa\.spotifycdn\.com|image-cdn-ak\.spotifycdn\.com)"
    r"/image/[A-Za-z0-9_-]{1,128}$"
)

# Stemning: podvoice/gatekeeper/podview_mood.py THEMES; Humør: podview_feeling.py THEMES (title, search query).
THEMES: dict[str, dict[str, tuple[str, str]]] = {
    "mood": {
        "morning_acoustic": ("En rolig morgen", "morning acoustic"),
        "evening_jazz": ("Rolig aften", "evening jazz"),
        "cooking": ("Musik til madlavningen", "cooking"),
        "italian": ("En italiensk aften", "italian dinner"),
        "indie": ("Indie i baggrunden", "indie"),
        "calm": ("En rolig stund", "calm acoustic"),
    },
    "feeling": {
        "jazz_lounge": ("Jazz & lounge", "jazz lounge"),
        "hiphop_rnb": ("Hiphop & R&B", "hip hop r&b"),
        "pop_dance": ("Pop & dance", "dance pop"),
        "relaxed_pop": ("Afslappet pop", "chill pop"),
        "deep_house": ("Deep house", "deep house"),
        "jazz_classics": ("Jazzklassikere", "jazz classics"),
        "lounge": ("Lounge", "lounge music"),
        "nineties_techno": ("90\u2019er-techno", "90s techno"),
        "party": ("Festmusik", "festmusik"),
    },
}
# The old Find musik's own names for the two collections (podview/index.html, its refinement buttons).
GROUP_LABELS = {"mood": "Stemning", "feeling": "Humør"}
THEME_IDS = tuple(theme for group in THEMES.values() for theme in group)
SLOTS = ("moment", "daypart", "artist", "season")
ADDON_ERRORS = {"ai_unavailable", "ai_failed"}


def _query(value: Any) -> str:
    if not isinstance(value, str):
        raise vol.Invalid("query must be text")
    query = " ".join(value.split())
    if not 1 <= len(query) <= 160:
        raise vol.Invalid("query must contain 1 to 160 characters")
    return query


def _query_or_theme(value: dict) -> dict:
    if ("query" in value) == ("theme" in value):
        raise vol.Invalid("give a query or a theme")
    return value


SEARCH_SCHEMA = vol.Schema(
    vol.All(
        vol.Schema(
            {
                vol.Optional("query"): _query,
                vol.Optional("theme"): vol.In(THEME_IDS),
                vol.Optional("kind", default="track"): vol.In(("track", "playlist")),
            }
        ),
        _query_or_theme,
    )
)
MOODS_SCHEMA = vol.Schema({})
PICKS_SCHEMA = vol.Schema(
    {vol.Optional("weather_entity"): vol.All(str, vol.Match(r"^weather\.[a-z0-9_]{1,200}$"))}
)


class _RateLimited(Exception):
    pass


class _Unavailable(Exception):
    def __init__(self, error: str) -> None:
        super().__init__(error)
        self.error = error


def podconnect_account(hass: HomeAssistant) -> str | None:
    """The one loaded PodConnect account (its search services require it), or None."""
    loaded = [
        entry
        for entry in hass.config_entries.async_entries(PODCONNECT)
        if entry.state is ConfigEntryState.LOADED and isinstance(entry.entry_id, str)
    ]
    if len(loaded) > 1:
        loaded = [
            entry
            for entry in loaded
            if getattr(getattr(entry, "runtime_data", None), "active", False)
        ]
    return loaded[0].entry_id if len(loaded) == 1 else None


def day_part(hour: int) -> str:
    """The add-on's own day parts (podview_mood.day_part)."""
    if 5 <= hour < 12:
        return "morning"
    if 12 <= hour < 18:
        return "afternoon"
    return "evening" if hour >= 18 else "night"


def _text(value: Any, maximum: int = 256) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    return text if 1 <= len(text) <= maximum else None


def _artwork(value: Any) -> str | None:
    url = value.get("url") if isinstance(value, dict) else None
    return url if isinstance(url, str) and _IMAGE.fullmatch(url) else None


def project_search(kind: str, value: Any, account: str, query: str) -> list[dict]:
    """Closed rows from one PodConnect search envelope (search_tracks.v1 / search_playlists.v1)."""
    track = kind == "track"
    schema = "podconnect.search_tracks.v1" if track else "podconnect.search_playlists.v1"
    rows = value.get("tracks" if track else "playlists") if isinstance(value, dict) else None
    if (
        not isinstance(value, dict)
        or value.get("ok") is not True
        or value.get("schema") != schema
        or value.get("config_entry_id") != account
        or value.get("source") != "spotify_web_api"
        or value.get("query") != query
        or not isinstance(rows, list)
        or len(rows) > SEARCH_LIMIT
    ):
        raise ValueError("unreadable search")
    pattern = _TRACK if track else _PLAYLIST
    items: list[dict] = []
    for row in rows:
        name = _text(row.get("name")) if isinstance(row, dict) else None
        uri = row.get("uri") if isinstance(row, dict) else None
        if name is None or not isinstance(uri, str) or pattern.fullmatch(uri) is None:
            raise ValueError("unreadable row")
        if any(item["uri"] == uri for item in items):
            continue
        items.append(
            {
                "kind": kind,
                "uri": uri,
                "name": name,
                "byline": _text(row.get("artist"), 512) if track else None,
                "artwork": _artwork(row.get("artwork")),
            }
        )
    return items


class FindMusic:
    """One per integration entry: the shared caches and the add-on call."""

    def __init__(
        self, hass: HomeAssistant, *, monotonic: Callable[[], float] = time.monotonic
    ) -> None:
        self.hass = hass
        self.monotonic = monotonic
        self._cache: dict[tuple, tuple[float, Any]] = {}
        self._inflight: dict[tuple, asyncio.Future] = {}
        self._paused_until = 0.0
        self._picks: dict[tuple, tuple[float, dict]] = {}

    # ---- PodConnect ---------------------------------------------------------------------------------------------

    async def _podconnect(self, service: str, data: dict) -> Any:
        if self.monotonic() < self._paused_until:
            raise _RateLimited(service)
        if not self.hass.services.has_service(PODCONNECT, service):
            raise _Unavailable("podconnect_unavailable")
        try:
            async with asyncio.timeout(READ_BUDGET_S):
                return await self.hass.services.async_call(
                    PODCONNECT, service, data, blocking=True, return_response=True
                )
        except TimeoutError as error:
            raise _Unavailable("podconnect_unavailable") from error
        except vol.Invalid as error:
            raise _Unavailable("unreadable") from error
        except HomeAssistantError as error:
            # PodConnect says »rate limited« in its own words; the text is never shown or logged.
            if "rate limit" in str(error).lower():
                self._paused_until = self.monotonic() + RATE_LIMIT_PAUSE_S
                raise _RateLimited(service) from error
            raise _Unavailable("podconnect_unavailable") from error

    async def _cached(self, key: tuple, ttl: float, read: Callable[[], Awaitable[Any]]) -> Any:
        """One read per key and TTL; concurrent equal reads share it; failures are not cached."""
        hit = self._cache.get(key)
        if hit is not None and hit[0] > self.monotonic():
            return hit[1]
        pending = self._inflight.get(key)
        if pending is None:
            pending = asyncio.ensure_future(read())
            self._inflight[key] = pending
            pending.add_done_callback(lambda _done: self._inflight.pop(key, None))
        value = await asyncio.shield(pending)
        now = self.monotonic()
        self._cache = {k: v for k, v in self._cache.items() if v[0] > now}
        while len(self._cache) >= CACHE_ENTRIES:
            self._cache.pop(next(iter(self._cache)))
        self._cache[key] = (now + ttl, value)
        return value

    async def search_items(self, account: str, kind: str, query: str) -> list[dict]:
        service = "search_tracks" if kind == "track" else "search_playlists"
        data: dict[str, Any] = {"config_entry_id": account, "query": query, "limit": SEARCH_LIMIT}
        if kind == "playlist":
            data["include_artwork"] = True

        async def read() -> list[dict]:
            response = await self._podconnect(service, data)
            try:
                return project_search(kind, response, account, query)
            except ValueError as error:
                raise _Unavailable("unreadable") from error

        return await self._cached(("search", account, kind, query.casefold()), SEARCH_TTL_S, read)

    async def top_artists(self, account: str) -> list[str]:
        """The account's top artist names (PodConnect top_artists), or none: never a guess."""

        async def read() -> list[str]:
            response = await self._podconnect(
                "top_artists", {"config_entry_id": account, "limit": 5, "time_range": "short_term"}
            )
            rows = response.get("artists") if isinstance(response, dict) else None
            if (
                not isinstance(response, dict)
                or response.get("schema") != "podconnect.top_artists.v1"
                or response.get("config_entry_id") != account
                or not isinstance(rows, list)
            ):
                raise _Unavailable("unreadable")
            names = [_text(row.get("name"), 128) for row in rows[:5] if isinstance(row, dict)]
            return [name for name in names if name]

        try:
            return await self._cached(("artists", account), ARTISTS_TTL_S, read)
        except (_Unavailable, _RateLimited):
            return []

    # ---- Services -----------------------------------------------------------------------------------------------

    async def search(self, data: dict) -> dict:
        theme = data.get("theme")
        if theme is not None:
            group = next(name for name, themes in THEMES.items() if theme in themes)
            kind, query = "playlist", THEMES[group][theme][1]
        else:
            kind, query = data.get("kind", "track"), data["query"]
        base = {"kind": kind, "query": query, **({"theme": theme} if theme else {})}
        account = podconnect_account(self.hass)
        if account is None:
            return {"ok": False, "error": "account_unavailable", **base, "items": []}
        try:
            items = await self.search_items(account, kind, query)
        except _RateLimited:
            return {"ok": False, "error": "rate_limited", **base, "items": []}
        except _Unavailable as error:
            return {"ok": False, "error": error.error, **base, "items": []}
        return {"ok": True, **base, "items": items}

    @staticmethod
    def moods() -> dict:
        return {
            "ok": True,
            "groups": [
                {
                    "id": group,
                    "label": GROUP_LABELS[group],
                    "themes": [
                        {"id": key, "title": title} for key, (title, _query) in themes.items()
                    ],
                }
                for group, themes in THEMES.items()
            ],
        }

    def _weather(self, entity_id: str | None) -> dict | None:
        state = self.hass.states.get(entity_id) if entity_id else None
        if state is None or state.state in ("unknown", "unavailable"):
            return None
        temperature = state.attributes.get("temperature")
        if (
            isinstance(temperature, bool)
            or not isinstance(temperature, int | float)
            or not math.isfinite(temperature)
            or not -80 <= temperature <= 80
        ):
            temperature = None
        return {"condition": state.state[:40], "temperature": temperature}

    async def _ask_addon(self, facts: dict) -> dict:
        """One loopback call to the add-on; never raises, never retries."""
        session = async_get_clientsession(self.hass)
        try:
            async with session.post(
                ADDON_PICKS,
                json=facts,
                headers={"X-PodView-Request": "1"},
                allow_redirects=False,
                timeout=ClientTimeout(total=ADDON_TIMEOUT_S),
            ) as response:
                if response.content_type != "application/json":
                    return {"ok": False, "error": "addon_unavailable"}
                body = bytearray()
                async for chunk in response.content.iter_chunked(8192):
                    body.extend(chunk)
                    if len(body) > ADDON_MAX_BYTES:
                        return {"ok": False, "error": "unreadable"}
                payload = json.loads(body)
                status = response.status
        except (ClientError, TimeoutError, ValueError):
            return {"ok": False, "error": "addon_unavailable"}
        if not isinstance(payload, dict):
            return {"ok": False, "error": "unreadable"}
        if status != 200 or payload.get("ok") is not True:
            error = payload.get("error")
            if status == 200 and error in ADDON_ERRORS:
                return {"ok": False, "error": error}
            return {"ok": False, "error": "addon_unavailable" if status >= 500 else "addon_refused"}
        return payload

    @staticmethod
    def _plan(payload: dict) -> list[dict] | None:
        shelves = payload.get("shelves")
        if payload.get("schema") != "podview.find_music_picks.v1" or not isinstance(shelves, list):
            return None
        plan = []
        for shelf in shelves[: len(SLOTS)]:
            if not isinstance(shelf, dict):
                return None
            title, why = _text(shelf.get("title"), 48), _text(shelf.get("why"), 200)
            queries = shelf.get("queries")
            if (
                shelf.get("slot") not in SLOTS
                or title is None
                or why is None
                or not isinstance(queries, list)
            ):
                return None
            clean = [
                query for query in (_text(q, 60) for q in queries[:QUERIES_PER_SHELF]) if query
            ]
            if clean:
                plan.append({"slot": shelf["slot"], "title": title, "why": why, "queries": clean})
        return plan

    async def picks(self, weather_entity: str | None) -> dict:
        account = podconnect_account(self.hass)
        if account is None:
            return {"ok": False, "error": "account_unavailable", "shelves": []}
        now = dt_util.now()
        today = now.date().isoformat()
        key = (account, today, day_part(now.hour), weather_entity)
        cached = self._picks.get(key)
        if cached is not None and cached[0] > self.monotonic():
            return cached[1]
        facts = {
            "date": today,
            "hour": now.hour,
            "weather": self._weather(weather_entity),
            "artists": await self.top_artists(account),
        }
        answer = await self._ask_addon(facts)
        if answer.get("ok") is not True:
            failed = {"ok": False, "error": answer["error"], "shelves": []}
            if answer["error"] in ADDON_ERRORS:
                # The add-on does not ask its model again for half an hour; a reopened panel does not ask either.
                self._picks[key] = (self.monotonic() + PICKS_FAILED_TTL_S, failed)
            return failed
        plan = self._plan(answer)
        if plan is None:
            return {"ok": False, "error": "unreadable", "shelves": []}
        shelves = []
        used: set[str] = set()
        try:
            for shelf in plan:
                found = await asyncio.gather(
                    *(self.search_items(account, "playlist", query) for query in shelf["queries"])
                )
                items = []
                for item in (row for rows in found for row in rows):
                    if item["uri"] not in used and len(items) < SHELF_ITEMS:
                        used.add(item["uri"])
                        items.append(item)
                if items:
                    shelves.append(
                        {
                            "id": "ai_" + shelf["slot"],
                            "title": shelf["title"],
                            "why": shelf["why"],
                            "items": items,
                        }
                    )
        except _RateLimited:
            return {"ok": False, "error": "rate_limited", "shelves": []}
        except _Unavailable as error:
            return {"ok": False, "error": error.error, "shelves": []}
        result = {"ok": True, "shelves": shelves}
        self._picks = {k: v for k, v in self._picks.items() if k[1] == today}
        self._picks[key] = (self.monotonic() + PICKS_TTL_S, result)
        return result


async def async_setup_services(hass: HomeAssistant, entry: ConfigEntry) -> list[str]:
    """Register this module's services; return their names so unload removes them."""
    owner = FindMusic(hass)

    async def signed_in(call: ServiceCall) -> None:
        # The panel's user (a non-admin kiosk user is fine); never an anonymous call.
        user_id = call.context.user_id
        user = await hass.auth.async_get_user(user_id) if user_id else None
        if user is None or not user.is_active:
            raise Unauthorized(context=call.context)

    async def search(call: ServiceCall) -> dict:
        await signed_in(call)
        return await owner.search(dict(call.data))

    async def moods(call: ServiceCall) -> dict:
        await signed_in(call)
        return owner.moods()

    async def picks(call: ServiceCall) -> dict:
        await signed_in(call)
        result = await owner.picks(call.data.get("weather_entity"))
        if not result["ok"]:
            # The code only; never facts, queries or the add-on's answer.
            _LOGGER.debug("Find musik AI picks unavailable: %s", result["error"])
        return result

    services = (
        ("music_search", search, SEARCH_SCHEMA),
        ("music_moods", moods, MOODS_SCHEMA),
        ("music_picks", picks, PICKS_SCHEMA),
    )
    for name, handler, schema in services:
        hass.services.async_register(
            DOMAIN, name, handler, schema=schema, supports_response=SupportsResponse.ONLY
        )
    return [name for name, _, _ in services]
