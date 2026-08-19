"""Tool router: model function-calls -> local tools + Home Assistant via MCP.

Replaces the hand-rolled REST bridge (ha_tools.py, deleted in Phase 3): instead
of curated service wrappers + a home-grown discovery/allowlist layer, Home
Assistant's own MCP server decides which tools exist and which entities they may
touch (Settings > Voice assistants > exposed entities). PodVoice adds only what
HA cannot provide:

- ``get_time`` — local wall clock (HA's configured timezone), always available.
- kitchen timers (``set_timer``/``list_timers``/``cancel_timer``) — they ring ON
  the Voice PE, so they must live here.

Everything else (lights, climate, covers, lists, scripts — including a web-search
script if one is exposed to Assist) arrives as MCP tools and is passed to the
model verbatim. Dispatch never raises: errors fold into ``{"ok": False}`` so the
model is never left waiting.
"""

from __future__ import annotations

import asyncio
import datetime
import json
import logging
import time
import zoneinfo

import httpx

from . import constants as C
from .mcp_client import HomeAssistantMCP, McpError

log = logging.getLogger("podvoice.tools")

_TOOLS_TTL_S = 600.0  # re-fetch the MCP tool list at most this stale
_RETRY_S = 30.0  # after a failed fetch, don't hammer HA — retry at this pace
_WEB_HINTS = ("search", "søg", "web", "google", "nyheder", "news", "sport")
_WEATHER_HINTS = ("vejr", "weather", "forecast", "udsigt", "temperatur", "temperature")
_MUSIC_HINTS = (
    "music",
    "musik",
    "media",
    "spotify",
    "podconnect",
    "play",
    "pause",
    "next",
    "volume",
    "lydstyrke",
)
_STANDARD_CAPABILITY_HINTS = {
    "home": "Aktivér Home Assistants MCP Server-integration, og eksponér enheder under Settings → Voice assistants → Expose.",
    "web_search": "Eksponér husets Gemini-/søgeagent som script eller Assist-værktøj i Home Assistant/MCP.",
    "weather": "Eksponér HA's weather-entity eller et vejr-script til Assist/MCP. Brug hjemmets lokation som standard.",
    "music": "Eksponér PodConnect Control/media_player og podconnect.*-services til Assist/MCP. Brug HA til Spotify-søgning, transport, bibliotek og historik; PodConnect Speakers URL/token er kun til ducking/stop/release.",
}

_PODCONNECT_DATA_TOOLS = {
    "podconnect_recently_played": (
        "recently_played",
        "Fetch the signed-in user's recently played Spotify tracks, newest first. "
        "Use this for 'what was the last song I played/heard?' and listening history. "
        "Returns {tracks:[{name,artist,uri}]}; this is private Spotify data, never use web instead.",
    ),
    "podconnect_top_tracks": (
        "top_tracks",
        "Fetch the signed-in user's Spotify top tracks. Returns "
        "{tracks:[{name,artist,uri}]}; this is private Spotify library data.",
    ),
    "podconnect_liked": (
        "liked",
        "Fetch the signed-in user's Spotify Liked Songs. Returns "
        "{tracks:[{name,artist,uri}]}; this is private Spotify library data.",
    ),
}

# Danish day/month names for the spoken get_time summary (strftime is locale-dependent
# and the Alpine container has no da_DK locale — hardcoding is the reliable way).
_WEEKDAYS_DA = ("mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag")
_MONTHS_DA = (
    "januar",
    "februar",
    "marts",
    "april",
    "maj",
    "juni",
    "juli",
    "august",
    "september",
    "oktober",
    "november",
    "december",
)

_CLOCK_HOURS_DA = (
    "tolv",
    "et",
    "to",
    "tre",
    "fire",
    "fem",
    "seks",
    "syv",
    "otte",
    "ni",
    "ti",
    "elleve",
)
_NUMBERS_DA = {
    1: "et",
    2: "to",
    3: "tre",
    4: "fire",
    5: "fem",
    6: "seks",
    7: "syv",
    8: "otte",
    9: "ni",
    10: "ti",
    11: "elleve",
    12: "tolv",
    13: "tretten",
    14: "fjorten",
    15: "femten",
    16: "seksten",
    17: "sytten",
    18: "atten",
    19: "nitten",
    20: "tyve",
    30: "tredive",
    40: "fyrre",
    50: "halvtreds",
}


def _number_da(value: int) -> str:
    if value in _NUMBERS_DA:
        return _NUMBERS_DA[value]
    tens, ones = divmod(value, 10)
    one_word = "en" if ones == 1 else _NUMBERS_DA[ones]
    return f"{one_word}og{_NUMBERS_DA[tens * 10]}"


def _spoken_clock(hour: int, minute: int) -> str:
    """Natural Danish clock speech; never make the voice model pronounce ``17:59``."""
    current = _CLOCK_HOURS_DA[hour % 12]
    following = _CLOCK_HOURS_DA[(hour + 1) % 12]
    if minute == 0:
        return f"Klokken er {current}."
    if minute == 15:
        return f"Klokken er kvart over {current}."
    if minute == 30:
        return f"Klokken er halv {following}."
    if minute == 45:
        return f"Klokken er kvart i {following}."
    if minute < 30:
        unit = "minut" if minute == 1 else "minutter"
        return f"Klokken er {_number_da(minute)} {unit} over {current}."
    remaining = 60 - minute
    unit = "minut" if remaining == 1 else "minutter"
    return f"Klokken er {_number_da(remaining)} {unit} i {following}."


def _mcp_result_to_contract(result: dict) -> dict:
    """Fold an MCP tools/call result into the one flat contract the prompt teaches:
    ``{ok, summary?, data?}`` on success, ``{ok: False, error_kind, error}`` on
    ``isError``. Text content that parses as JSON rides in ``data``; plain text is
    the spoken ``summary``."""
    texts = [
        c.get("text", "")
        for c in (result.get("content") or [])
        if isinstance(c, dict) and c.get("type") == "text"
    ]
    text = "\n".join(t for t in texts if t).strip()
    if result.get("isError"):
        return {
            "ok": False,
            "error_kind": "tool_error",
            "error": text or "the tool reported an error",
        }
    out: dict = {"ok": True}
    structured = result.get("structuredContent")
    if structured is not None:
        out["data"] = structured
    if text:
        try:
            parsed = json.loads(text)
        except (json.JSONDecodeError, ValueError):
            out["summary"] = text
        else:
            out.setdefault("data", parsed)
    if "summary" not in out and "data" not in out:
        out["empty"] = True
    return out


class ToolRouter:
    """Local tools + HA-MCP tools behind the ToolBridgeLike surface
    (``declarations()`` / ``dispatch()``) the engines and console already use."""

    def __init__(
        self,
        mcp: HomeAssistantMCP | None,
        *,
        supervisor_token: str = "",
        client: httpx.AsyncClient | None = None,
        timers=None,  # TimerManager — local kitchen timers
        hub=None,  # StatusHub — the panel's "home control" service dot
    ) -> None:
        self._mcp = mcp
        self._token = supervisor_token
        self._client = client
        self._timers = timers
        self._hub = hub
        self._mcp_tools: list[dict] = []  # cached MCP declarations (OpenAI shape)
        self._mcp_names: set[str] = set()
        self._podconnect_services: set[str] = set()
        self._fetched_at = 0.0
        self._fetch_lock = asyncio.Lock()
        self._tz: datetime.tzinfo | None = None

    # ------------------------------------------------------------------ startup
    healthy: bool = True  # last REAL-probe outcome; wake speaks up when False

    async def start(self) -> None:
        """Fetch the MCP tool list once at boot. Failure degrades to local-only
        tools with a LOUD log line — a silent no-tool assistant is the old bug."""
        await self._refresh(force=True)
        await self.probe()
        if self._mcp is not None and not self._mcp_tools:
            log.warning(
                "MCP tools unavailable at startup — home control is OFF until %s answers "
                "(enable the 'Model Context Protocol Server' integration in HA, and check "
                "ha_mcp_url/ha_mcp_token in Settings)",
                getattr(self._mcp, "url", "?"),
            )

    async def _refresh_podconnect_services(self) -> None:
        """Discover PodConnect Control's real HA services.

        HA's MCP surface exposes entities/intents, but response-returning integration
        services are not guaranteed to become MCP tools. PodConnect deliberately ships
        recently_played/top_tracks/liked as REST-callable AI data services, so bridge
        exactly those names — and only advertise ones HA says are installed.
        """
        if not self._token or self._client is None:
            return
        try:
            response = await self._client.get(
                f"{C.SUPERVISOR_CORE_API}/services",
                headers={"Authorization": f"Bearer {self._token}"},
            )
            response.raise_for_status()
            domains = response.json()
            if isinstance(domains, dict):
                domains = domains.get("services", [])
            discovered: set[str] = set()
            for domain in domains if isinstance(domains, list) else []:
                if not isinstance(domain, dict) or domain.get("domain") != "podconnect":
                    continue
                services = domain.get("services") or {}
                names = services.keys() if isinstance(services, dict) else services
                discovered = {str(name) for name in names}
                break
            self._podconnect_services = discovered
            log.info(
                "PodConnect Control data services: %s",
                ", ".join(sorted(self._podconnect_services)) or "none",
            )
        except Exception as e:
            log.info("PodConnect Control service discovery unavailable: %s", e)

    async def _refresh(self, *, force: bool = False) -> None:
        if self._mcp is None:
            return
        async with self._fetch_lock:
            age = time.monotonic() - self._fetched_at
            if not force and self._mcp_tools and age < _TOOLS_TTL_S:
                return
            if not force and not self._mcp_tools and age < _RETRY_S:
                return  # recent failure — don't hammer
            try:
                tools = await self._mcp.list_tools()
            except Exception as e:
                self._fetched_at = time.monotonic()
                if self._hub is not None:
                    self._hub.set_service("mcp", "down")
                log.warning("MCP tools/list failed: %s", e)
                return
            self._mcp_tools = [
                {
                    "name": t.get("name", ""),
                    "description": t.get("description", "") or t.get("name", ""),
                    "parameters": t.get("inputSchema") or {"type": "object", "properties": {}},
                }
                for t in tools
                if t.get("name")
            ]
            self._mcp_names = {t["name"] for t in self._mcp_tools}
            self._fetched_at = time.monotonic()
            if self._hub is not None:
                self._hub.set_service("mcp", "up" if self._mcp_tools else "degraded")
            log.info(
                "MCP tools: %d from HA (%s)",
                len(self._mcp_tools),
                ", ".join(sorted(self._mcp_names)) or "none",
            )

    async def probe(self) -> bool:
        """PROVE home control by touching a REAL read-only tool. A tool COUNT lies:
        HassTurnOn/GetLiveContext exist as tools even with ZERO exposed entities
        (modprøve A2 — 'lam men lyder rask'). Called at boot and periodically."""
        # HACS can add/reload Control independently of this add-on. Refresh its
        # services with the normal ten-minute probe; transient HA failures preserve
        # the last proven service set instead of silently removing music tools.
        await self._refresh_podconnect_services()
        ok = False
        if self._mcp is not None and "GetLiveContext" not in self._mcp_names:
            # A boot during an HA restart leaves an EMPTY tool list (tools/list failed
            # while core was down). Re-fetch here so the 10-min loop SELF-HEALS home
            # control instead of staying lame until someone restarts the add-on.
            await self._refresh(force=True)
        if self._mcp is not None and "GetLiveContext" in self._mcp_names:
            try:
                r = await self.dispatch("GetLiveContext", {})
                ok = bool(r.get("ok")) and bool(r.get("data") or r.get("summary"))
            except Exception as e:
                log.warning("MCP probe failed: %s", e)
        if ok != self.healthy:
            log.warning("home-control probe: %s", "RECOVERED" if ok else "FAILED (no live context)")
        self.healthy = ok
        if self._hub is not None and self._mcp is not None:
            self._hub.set_service("mcp", "up" if ok else "degraded")
        return ok

    # ------------------------------------------------------------------ declarations
    def declarations(self) -> list[dict]:
        decls: list[dict] = [
            {
                "name": "get_time",
                "description": "The current local time and date (clock, weekday, date). "
                "Use only when the latest user turn directly asks for the time, date, "
                "or weekday. Never repeat this tool merely because the previous turn "
                "used it. If the latest turn instead wraps up the conversation, use the "
                "conversation-ending tool rather than get_time.",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            }
        ]
        if self._timers is not None:
            decls += [
                {
                    "name": "set_timer",
                    "description": "Start a countdown timer that will ring on this speaker "
                    "when it finishes. Pass the duration EXACTLY as the user said it, split "
                    "into minutes and seconds — 'ti minutter' -> minutes=10; 'halvandet "
                    "minut' -> minutes=1, seconds=30. Do NOT convert units yourself. "
                    "Confirm the duration back to the user in Danish.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "minutes": {
                                "type": "integer",
                                "description": "Minutes part of the duration (0 if none).",
                            },
                            "seconds": {
                                "type": "integer",
                                "description": "Seconds part of the duration (0 if none).",
                            },
                            "label": {
                                "type": "string",
                                "description": "Optional short label, e.g. 'pasta'.",
                            },
                        },
                    },
                },
                {
                    "name": "list_timers",
                    "description": "List the currently running timers with remaining time.",
                    "parameters": {"type": "object", "properties": {}},
                },
                {
                    "name": "cancel_timer",
                    "description": "Cancel a running timer. Without an id, cancels the one "
                    "expiring next.",
                    "parameters": {
                        "type": "object",
                        "properties": {"id": {"type": "integer", "description": "Timer id."}},
                    },
                },
            ]
        for tool_name, (service_name, description) in _PODCONNECT_DATA_TOOLS.items():
            if service_name in self._podconnect_services:
                decls.append(
                    {
                        "name": tool_name,
                        "description": description,
                        "parameters": {"type": "object", "properties": {}},
                    }
                )
        local_names = {d["name"] for d in decls}
        decls += [t for t in self._mcp_tools if t["name"] not in local_names]
        return decls

    def capabilities(self) -> dict:
        """Panel/debug view of what the assistant can *actually* call right now.

        Service dots are too coarse: "MCP up" only says Home Assistant answered,
        not whether a search agent or music tools are exposed to Assist. This keeps
        the product goal visible in the panel instead of hidden in add-on logs.
        """
        decls = self.declarations()
        names = [str(d.get("name", "")) for d in decls if d.get("name")]

        def has_any(hints: tuple[str, ...]) -> bool:
            for d in decls:
                hay = f"{d.get('name', '')} {d.get('description', '')}".lower()
                if any(h in hay for h in hints):
                    return True
            return False

        caps = {
            "tools": names,
            "count": len(names),
            "time": "get_time" in names,
            "timers": any(n in names for n in ("set_timer", "list_timers", "cancel_timer")),
            "home": bool(self._mcp_names),
            "web_search": has_any(_WEB_HINTS),
            "weather": has_any(_WEATHER_HINTS),
            "music": has_any(_MUSIC_HINTS),
        }
        missing = [
            key for key in ("home", "web_search", "weather", "music") if not bool(caps.get(key))
        ]
        caps["missing"] = missing
        caps["setup_hints"] = {key: _STANDARD_CAPABILITY_HINTS[key] for key in missing}
        caps["sources"] = {
            "time": "podvoice_local",
            "timers": "podvoice_local",
            "home": "ha_mcp" if caps["home"] else "missing",
            "web_search": "ha_mcp" if caps["web_search"] else "missing",
            "weather": "ha_mcp" if caps["weather"] else "missing",
            "music": "ha_mcp" if caps["music"] else "missing",
        }
        return caps

    # ------------------------------------------------------------------ dispatch
    async def dispatch(self, name: str, args: dict) -> dict:
        # Hard time-bound so a slow/wedged HA can never hang the conversational turn.
        try:
            result = await asyncio.wait_for(self._dispatch(name, args), timeout=C.TOOL_TIMEOUT_S)
        except TimeoutError:
            result = {
                "ok": False,
                "error_kind": "timeout",
                "error": "the service took too long to respond",
            }
        self._log_tool(name, result, args)
        return result

    async def _dispatch(self, name: str, args: dict) -> dict:
        try:
            if name == "get_time":  # local, always available — the clock never fails
                return await self._get_time()
            if self._timers is not None and name in ("set_timer", "list_timers", "cancel_timer"):
                if name == "set_timer":
                    # minutes+seconds as SEPARATE fields: a voice model doing its own
                    # unit arithmetic is how "ti minutter" becomes an hour.
                    total = int(args.get("minutes", 0) or 0) * 60 + int(args.get("seconds", 0) or 0)
                    return self._timers.set_timer(total, str(args.get("label", "") or ""))
                if name == "list_timers":
                    return self._timers.list_timers()
                return self._timers.cancel_timer(args.get("id"))
            if name in _PODCONNECT_DATA_TOOLS:
                return await self._podconnect_data(name)
            if self._mcp is None:
                return {
                    "ok": False,
                    "error_kind": "no_mcp",
                    "error": "home control is not connected",
                }
            if name not in self._mcp_names:
                await self._refresh(force=True)  # a reload may have added the tool
            if name not in self._mcp_names:
                return {"ok": False, "error_kind": "bad_args", "error": f"unknown tool {name}"}
            result = await self._mcp.call_tool(name, args or {})
            return _mcp_result_to_contract(result)
        except McpError as e:
            self._fetched_at = 0.0  # connection-shaped failure -> re-list on next call
            return {
                "ok": False,
                "error_kind": "mcp",
                "error": str(e),
                "hint": "Home Assistant's MCP server did not accept the call — check the "
                "tool name and arguments, or retry.",
            }
        except Exception as e:  # broad on purpose — never leave the model waiting
            return {"ok": False, "error_kind": "internal", "error": str(e)}

    async def _podconnect_data(self, tool_name: str) -> dict:
        """Call one documented PodConnect Control response service through HA."""
        service_name = _PODCONNECT_DATA_TOOLS[tool_name][0]
        if service_name not in self._podconnect_services:
            await self._refresh_podconnect_services()
        if service_name not in self._podconnect_services:
            return {
                "ok": False,
                "error_kind": "unavailable",
                "error": f"PodConnect Control service podconnect.{service_name} is not installed",
                "hint": "Install/update PodConnect Control in HACS and reload the integration.",
            }
        if not self._token or self._client is None:
            return {
                "ok": False,
                "error_kind": "no_ha_api",
                "error": "Home Assistant API access is unavailable",
            }
        response = await self._client.post(
            f"{C.SUPERVISOR_CORE_API}/services/podconnect/{service_name}?return_response",
            headers={"Authorization": f"Bearer {self._token}"},
            json={},
        )
        response.raise_for_status()
        payload = response.json()
        data = payload.get("service_response", {}) if isinstance(payload, dict) else {}
        tracks = data.get("tracks") if isinstance(data, dict) else None
        return {
            "ok": True,
            "data": data,
            **({"empty": True} if isinstance(tracks, list) and not tracks else {}),
        }

    # ------------------------------------------------------------------ helpers
    async def _get_timezone(self) -> datetime.tzinfo:
        """HA's configured timezone (memoized). The add-on container itself runs UTC,
        so the wall clock the household lives by comes from HA's /config. Falls back
        to the container's local zone if HA is unreachable."""
        if self._tz is not None:
            return self._tz
        if self._token and self._client is not None:
            try:
                r = await self._client.get(
                    f"{C.SUPERVISOR_CORE_API}/config",
                    headers={"Authorization": f"Bearer {self._token}"},
                )
                r.raise_for_status()
                name = r.json().get("time_zone")
                if name:
                    self._tz = zoneinfo.ZoneInfo(name)
                    return self._tz
            except Exception as e:  # tz lookup must never break the clock
                log.info("HA timezone unavailable (%s) — using container local time", e)
        self._tz = datetime.datetime.now().astimezone().tzinfo or datetime.UTC
        return self._tz

    async def _get_time(self) -> dict:
        """Local wall-clock time + date, with a ready-to-speak Danish summary."""
        now = datetime.datetime.now(await self._get_timezone())
        spoken = _spoken_clock(now.hour, now.minute)
        return {
            "ok": True,
            "summary": spoken,
            "data": {
                "spoken_time": spoken,
                "time": f"{now:%H:%M}",
                "date": f"{now:%Y-%m-%d}",
                "weekday": _WEEKDAYS_DA[now.weekday()],
                "iso": now.isoformat(timespec="seconds"),
            },
        }

    def _log_tool(self, name: str, result: dict, args: dict | None = None) -> None:
        """One bounded evidence line per tool: query plus the contract GPT received."""
        try:
            evidence = json.dumps(
                {
                    "args": args or {},
                    "result": {
                        key: result.get(key)
                        for key in ("ok", "empty", "summary", "data", "error_kind", "error")
                        if key in result
                    },
                },
                ensure_ascii=False,
                default=str,
            )
        except (TypeError, ValueError):
            evidence = "<kunne ikke serialiseres>"
        if len(evidence) > 4000:
            evidence = evidence[:4000] + "…"
        if result.get("ok"):
            log.info(
                "tool %s -> %s evidence=%s",
                name,
                "empty" if result.get("empty") else "ok",
                evidence,
            )
        else:
            log.warning(
                "tool %s -> FAILED kind=%s: %s evidence=%s",
                name,
                result.get("error_kind"),
                result.get("error"),
                evidence,
            )
