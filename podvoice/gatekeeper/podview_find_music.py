"""Find musik's AI picks for the PodView panel: search ideas and honest reasons, never playlists.

The Home Assistant integration (custom_components/podvoice/find_music.py) posts the coarse real facts it has (the
local date and hour, the panel's weather entity, the account's top artist names) to
``POST /view/api/find-music/picks`` on loopback. This module asks the existing mood selector's provider (its
client, key, model and the same daily/monthly allowance: no new credential, switch or quota) for at most four
shelves, each with a short title, the facts it rests on and 1-3 Spotify playlist search queries. The playlists
themselves come only from PodConnect's Spotify search, run by the integration.

Every reason line is composed here from the facts the model cited, never from model text, and a model title is
kept only when every fact-like word in it is true right now. One plan per date, day part, weather and artists is
cached; a failed plan is not asked again for half an hour (no hidden retries on the shared allowance).
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import math
import re
import time
from collections.abc import Callable
from datetime import date
from typing import Any

import httpx

from .podview_enrichment import MODEL, RESERVED_TOKENS, VisualSelector, _closed_json
from .podview_mood import day_part
from .podview_music import normalize_search_query
from .provider_budget import ProviderBudgetUnavailable

SCHEMA = "podview.find_music_picks.v1"
PLAN_TTL = 3 * 3600.0
AI_RETRY = 1800.0
MAX_REQUEST_BYTES = 4096
MAX_RESPONSE_BYTES = 16384
MAX_PLANS = 8
MAX_ARTISTS = 5

SLOTS = ("moment", "daypart", "artist", "season")
BASIS = ("weather", "weekday", "day_part", "season", "top_artists")
WEEKDAYS = ("mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag")
DAY_PARTS = {"morning": "morgen", "afternoon": "eftermiddag", "evening": "aften", "night": "nat"}
DAY_PART_TITLES = {
    "morning": "Til morgenen",
    "afternoon": "Til eftermiddagen",
    "evening": "Til aftenen",
    "night": "Til natten",
}
# HA weather conditions -> (reason phrase, title words that fit).
WEATHER = {
    "rainy": ("det regner", {"regn", "regnvejr", "regnvejrs", "våd", "grå"}),
    "pouring": ("det øsregner", {"regn", "regnvejr", "regnvejrs", "øsregn", "grå"}),
    "lightning-rainy": ("der er torden og regn", {"torden", "regn", "regnvejr"}),
    "lightning": ("der er torden", {"torden"}),
    "snowy": ("det sner", {"sne", "snevejr", "hvid", "vinter"}),
    "snowy-rainy": ("der falder slud", {"slud", "grå"}),
    "hail": ("det hagler", {"hagl", "grå"}),
    "sunny": ("solen skinner", {"sol", "solskin", "solrig", "solskins", "lys"}),
    "clear-night": ("det er en klar nat", {"klar", "stjerne", "stjerner"}),
    "cloudy": ("det er overskyet", {"skyer", "overskyet", "grå"}),
    "partlycloudy": ("det er let skyet", {"skyer", "skyet", "grå"}),
    "fog": ("det er tåget", {"tåge", "tåget", "grå"}),
    "windy": ("det blæser", {"blæst", "blæsende", "vind"}),
    "windy-variant": ("det blæser", {"blæst", "blæsende", "vind"}),
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
_PROMPT = (
    "You choose music for a Danish family's wall screen. For each requested slot return a short "
    "Danish shelf title (at most 40 characters, sentence case, no emoji), the basis: which of the "
    "given facts the choice rests on, and 1-3 short Spotify playlist search queries (genre or mood "
    "words, Danish or English, no personal data). Slots: moment = this moment (weather, weekday, "
    "time of day); daypart = the time of day; artist = music in the spirit of the top artists; "
    "season = the season or the coming holiday. Mention only facts that are given: no weather "
    "words without weather, no other weekday, no clock times, habits or listening history."
)
_REQUEST_KEYS = {"date", "hour", "weather", "artists"}
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def season(day: date) -> str:
    if day.month in (12, 1, 2):
        return "vinter"
    if day.month in (3, 4, 5):
        return "forår"
    return "sommer" if day.month in (6, 7, 8) else "efterår"


def _days_to_christmas(day: date) -> int | None:
    eve = date(day.year, 12, 24)
    return (eve - day).days if day.month in (11, 12) and day <= eve else None


def parse_request(value: Any) -> dict:
    """The integration's closed fact request, or ValueError."""
    if not isinstance(value, dict) or set(value) != _REQUEST_KEYS:
        raise ValueError("invalid request")
    if not isinstance(value["date"], str) or _DATE.fullmatch(value["date"]) is None:
        raise ValueError("invalid date")
    today = date.fromisoformat(value["date"])
    hour = value["hour"]
    if type(hour) is not int or not 0 <= hour <= 23:
        raise ValueError("invalid hour")
    weather = value["weather"]
    if weather is not None:
        if not isinstance(weather, dict) or set(weather) != {"condition", "temperature"}:
            raise ValueError("invalid weather")
        temperature = weather["temperature"]
        if temperature is not None and (
            isinstance(temperature, bool)
            or not isinstance(temperature, int | float)
            or not math.isfinite(temperature)
            or not -80 <= temperature <= 80
        ):
            raise ValueError("invalid temperature")
        if weather["condition"] not in WEATHER:
            # An unknown condition is no fact: never cited.
            weather = None
    artists = value["artists"]
    if (
        not isinstance(artists, list)
        or len(artists) > MAX_ARTISTS
        or not all(isinstance(name, str) and 1 <= len(name.strip()) <= 128 for name in artists)
    ):
        raise ValueError("invalid artists")
    return {
        "date": today,
        "hour": hour,
        "weather": weather,
        "artists": [" ".join(name.split()) for name in artists],
    }


def facts_for(today: date, hour: int, weather: dict | None, artists: list[str]) -> dict:
    """The only inputs an AI shelf may rest on: clock, calendar, weather, top artists."""
    facts: dict[str, Any] = {
        "weekday": WEEKDAYS[today.weekday()],
        "dayPart": day_part(hour),
        "hour": hour,
        "date": today.isoformat(),
        "season": season(today),
    }
    christmas = _days_to_christmas(today)
    if christmas is not None:
        facts["daysToChristmas"] = christmas
    if weather is not None and weather.get("condition") in WEATHER:
        facts["weather"] = {"condition": weather["condition"]}
        temperature = weather.get("temperature")
        if isinstance(temperature, int | float) and math.isfinite(temperature):
            facts["weather"]["temperature"] = round(temperature)
    if artists:
        facts["topArtists"] = artists[:MAX_ARTISTS]
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
    cited = [item for item in basis if item in available and item in BASIS]
    if required is not None and required not in cited:
        if required not in available:
            return []
        cited.insert(0, required)
    if slot == "artist":
        cited = ["top_artists"]
    return list(dict.fromkeys(cited))


def reason_for(basis: list[str], facts: dict) -> str | None:
    """One Danish reason line, composed only from the cited facts."""
    parts: list[str] = []
    if "weather" in basis and "weather" in facts:
        parts.append(WEATHER[facts["weather"]["condition"]][0])
    weekday = "weekday" in basis
    part = "day_part" in basis
    if weekday or part:
        words = [facts["weekday"]] if weekday else []
        if part:
            words.append(DAY_PARTS[facts["dayPart"]])
        parts.append("det er " + " ".join(words))
    if "season" in basis:
        christmas = facts.get("daysToChristmas")
        if christmas == 0:
            parts.append("det er juleaften")
        elif christmas is not None:
            parts.append(f"der er {christmas} {'dag' if christmas == 1 else 'dage'} til jul")
        else:
            parts.append("det er " + facts["season"])
    if "top_artists" in basis and facts.get("topArtists"):
        parts.append("I hører meget " + facts["topArtists"][0])
    if not parts:
        return None
    return "Fordi " + _join(parts) + "."


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
    allowed_weather = WEATHER[weather["condition"]][1] if weather else set()
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


def _model_body(facts: dict, slots: list[str]) -> bytes:
    body = {
        "model": MODEL,
        "store": False,
        "service_tier": "default",
        "reasoning": {"effort": "none"},
        "max_output_tokens": 600,
        "input": [
            {"role": "system", "content": _PROMPT},
            {"role": "user", "content": json.dumps({**facts, "slots": slots}, ensure_ascii=False)},
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "podview_find_music",
                "strict": True,
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "shelves": {
                            "type": "array",
                            "minItems": 1,
                            "maxItems": len(slots),
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "slot": {"type": "string", "enum": slots},
                                    "title": {"type": "string"},
                                    "basis": {
                                        "type": "array",
                                        "items": {"type": "string", "enum": list(BASIS)},
                                    },
                                    "queries": {
                                        "type": "array",
                                        "minItems": 1,
                                        "maxItems": 3,
                                        "items": {"type": "string"},
                                    },
                                },
                                "required": ["slot", "title", "basis", "queries"],
                            },
                        }
                    },
                    "required": ["shelves"],
                },
            }
        },
    }
    encoded = json.dumps(body).encode()
    if len(encoded) > MAX_REQUEST_BYTES:
        raise ValueError("bounded request required")
    return encoded


def _model_shelves(result: Any, slots: list[str]) -> list[dict] | None:
    rows = (
        result.get("shelves") if isinstance(result, dict) and set(result) == {"shelves"} else None
    )
    if not isinstance(rows, list) or not 1 <= len(rows) <= len(slots):
        return None
    seen: set[str] = set()
    shelves = []
    for row in rows:
        if (
            not isinstance(row, dict)
            or set(row) != {"slot", "title", "basis", "queries"}
            or row["slot"] not in slots
            or row["slot"] in seen
            or not isinstance(row["title"], str)
            or not isinstance(row["basis"], list)
            or not all(isinstance(item, str) and item in BASIS for item in row["basis"])
            or not isinstance(row["queries"], list)
            or not 1 <= len(row["queries"]) <= 3
            or not all(isinstance(query, str) for query in row["queries"])
        ):
            return None
        seen.add(row["slot"])
        shelves.append(row)
    return shelves


def compose(facts: dict, rows: list[dict]) -> list[dict]:
    """Closed shelves: honest title, a reason from cited facts, 1-3 normalized queries."""
    shelves = []
    for row in rows:
        reason = reason_for(honest_basis(row["slot"], row["basis"], facts), facts)
        queries: list[str] = []
        for query in row["queries"]:
            try:
                normalized = normalize_search_query(" ".join(query.split()))
            except ValueError:
                continue
            if len(normalized) <= 60 and normalized not in queries:
                queries.append(normalized)
        if reason is None or not queries:
            continue
        shelves.append(
            {
                "slot": row["slot"],
                "title": honest_title(row["slot"], row["title"], facts),
                "why": reason,
                "queries": queries[:3],
            }
        )
    order = {slot: index for index, slot in enumerate(SLOTS)}
    return sorted(shelves, key=lambda shelf: order[shelf["slot"]])


class FindMusicPlanner:
    """AI plans on the mood selector's provider and allowance; one call per context, never retried."""

    def __init__(self, shared: VisualSelector, *, monotonic: Callable[[], float] = time.monotonic):
        self.shared = shared
        self.monotonic = monotonic
        self.plans: dict[tuple, tuple[float, list[dict]]] = {}
        self.retry: dict[tuple, float] = {}
        self.inflight: dict[tuple, asyncio.Task] = {}
        self.calls = 0

    @property
    def available(self) -> bool:
        return bool(getattr(self.shared, "available", False))

    async def plan(self, request: dict) -> dict:
        facts = facts_for(request["date"], request["hour"], request["weather"], request["artists"])
        weather = facts.get("weather", {}).get("condition")
        key = (facts["date"], facts["dayPart"], weather, tuple(facts.get("topArtists", ())))
        now = self.monotonic()
        cached = self.plans.get(key)
        if cached is not None and cached[0] > now:
            return {"ok": True, "schema": SCHEMA, "shelves": cached[1]}
        if self.retry.get(key, -math.inf) > now:
            return {"ok": False, "error": "ai_failed"}
        if not self.available:
            return {"ok": False, "error": "ai_unavailable"}
        task = self.inflight.get(key)
        if task is None:
            task = asyncio.get_running_loop().create_task(self._ask(facts))
            self.inflight[key] = task
            task.add_done_callback(lambda _done: self.inflight.pop(key, None))
        shelves = await asyncio.shield(task)
        now = self.monotonic()
        if not shelves:
            self.retry[key] = now + AI_RETRY
            return {"ok": False, "error": "ai_failed"}
        self.plans = {k: v for k, v in self.plans.items() if v[0] > now and k[0] == key[0]}
        while len(self.plans) >= MAX_PLANS:
            self.plans.pop(next(iter(self.plans)))
        self.plans[key] = (now + PLAN_TTL, shelves)
        return {"ok": True, "schema": SCHEMA, "shelves": shelves}

    async def _ask(self, facts: dict) -> list[dict] | None:
        slots = ["moment", "daypart"]
        if facts.get("topArtists"):
            slots.insert(1, "artist")
        slots.append("season")
        try:
            encoded = _model_body(facts, slots)
        except ValueError:
            return None
        result = await self._complete(encoded)
        rows = _model_shelves(result, slots) if result is not None else None
        return compose(facts, rows) if rows else None

    async def _complete(self, encoded: bytes) -> Any:
        """One budgeted, bounded Responses call on the shared provider; the parsed JSON or None."""
        shared, lease = self.shared, None
        try:
            async with asyncio.timeout(6):
                if not shared.available:
                    return None
                lease = shared.budget.production_started(shared._key, MODEL, tokens=RESERVED_TOKENS)
                if not shared.budget.has_capacity(lease, RESERVED_TOKENS):
                    return None
                allowance = shared.allowance
                if allowance is None:
                    return None
                reserve = getattr(allowance, "reserve_async", None)
                reserved = await reserve() if reserve is not None else allowance.reserve()
                if not reserved:
                    return None
                shared.budget.account_usage(shared._key, MODEL, RESERVED_TOKENS, lease=lease)
                self.calls += 1
                async with shared.client.stream(
                    "POST",
                    "https://api.openai.com/v1/responses",
                    content=encoded,
                    headers={
                        "Authorization": f"Bearer {shared._key}",
                        "Content-Type": "application/json",
                    },
                    timeout=5,
                    follow_redirects=False,
                ) as response:
                    if response.status_code == 429:
                        shared._disabled = True
                    response.raise_for_status()
                    raw = bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(raw) + len(chunk) > MAX_RESPONSE_BYTES:
                            return None
                        raw.extend(chunk)
            data = _closed_json(bytes(raw))
            if not isinstance(data, dict) or data.get("status") != "completed":
                return None
            messages = [m for m in data.get("output", []) if m.get("type") == "message"]
            if len(messages) != 1:
                return None
            parts = messages[0].get("content", [])
            if len(parts) != 1 or parts[0].get("type") != "output_text":
                return None
            return _closed_json(parts[0]["text"])
        except (
            httpx.HTTPError,
            TimeoutError,
            ProviderBudgetUnavailable,
            ValueError,
            TypeError,
            KeyError,
            AttributeError,
        ):
            return None
        finally:
            shared.budget.release(lease)


def configured_planner(shared: Any) -> FindMusicPlanner | None:
    """Only on the existing, explicitly configured mood selector (its key, model and allowance)."""
    if not isinstance(shared, VisualSelector) or shared.model != MODEL or shared.allowance is None:
        return None
    return FindMusicPlanner(shared)


def _loopback(remote: str | None) -> bool:
    try:
        return ipaddress.ip_address(remote or "").is_loopback
    except ValueError:
        return False


async def find_music_picks_http(request):
    """POST /view/api/find-music/picks: only Home Assistant Core on loopback (the integration)."""
    from aiohttp import web

    from .podview import BRIDGE, _error, _guard

    denied = await _guard(request)
    if denied is not None:
        return denied
    if not _loopback(request.remote) or any(
        name.lower() == "x-remote-user-id" for name in request.headers
    ):
        return _error("loopback_required", 403)
    try:
        raw = await request.content.read(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            raise ValueError("request too large")
        parsed = parse_request(_closed_json(raw))
    except (ValueError, TypeError, UnicodeError):
        return _error("invalid_request", 400)
    tools = request.app[BRIDGE].tools
    planner = getattr(tools, "podview_find_music", None)
    shared = getattr(tools, "podview_mood_selector", None)
    if planner is None or planner.shared is not shared:
        planner = configured_planner(shared)
        tools.podview_find_music = planner
    if planner is None:
        result: dict = {"ok": False, "error": "ai_unavailable"}
    else:
        result = await planner.plan(parsed)
    return web.json_response(result, headers={"Cache-Control": "no-store"})
