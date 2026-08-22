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
import hashlib
import json
import logging
import math
import time
import zoneinfo
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

from . import constants as C
from .execution_policy import ExecutionContext, ExecutionPolicy, Risk
from .mcp_client import HomeAssistantMCP, McpError
from .tool_wire import compact_json_size, realtime_function_tool, realtime_tools_wire_size

log = logging.getLogger("podvoice.tools")

_TOOLS_TTL_S = 600.0
_RECOVERY_BACKOFF_S = (1.0, 2.0, 5.0, 10.0, 30.0, 60.0)
# Realtime receives these declarations in every new session.  These caps leave bounded
# room for Prompt V6, conversation audio/text and tool results while comfortably
# admitting the observed HA 1.26 surface (19 dynamic tools).  A larger integration
# surface must be deliberately curated/exposed instead of silently consuming context.
_MAX_MCP_TOOLS = 64
_MAX_MCP_TOOL_BYTES = 24 * 1024
_MAX_MCP_TOTAL_BYTES = 96 * 1024
_MAX_MCP_SCHEMA_DEPTH = 20
_STANDARD_CAPABILITY_HINTS = {
    "home": "Aktivér Home Assistants MCP Server-integration, og eksponér enheder under Settings → Voice assistants → Expose.",
    "web_search": "Eksponér husets Gemini-/søgeagent som script eller Assist-værktøj i Home Assistant/MCP.",
    "weather": "Eksponér HA's weather-entity eller et vejr-script til Assist/MCP. Brug hjemmets lokation som standard.",
    "music": "Eksponér PodConnect Control/media_player og podconnect.*-services til Assist/MCP. Brug HA til Spotify-søgning, transport, bibliotek og historik; PodConnect Speakers URL/token er kun til ducking/stop/release.",
}

# Capability claims are product contracts, not fuzzy search results.  Descriptions are
# model-facing prose and must never turn a coincidental word (for example the timer
# phrase "expiring next") into an available home capability.
_TOOL_CAPABILITY_ROLES: dict[str, frozenset[str]] = {
    "GetLiveContext": frozenset({"home_read"}),
    "HassGetState": frozenset({"home_read"}),
    "HassTurnOn": frozenset({"home_control"}),
    "HassTurnOff": frozenset({"home_control"}),
    "HassLightSet": frozenset({"home_control"}),
    "HassClimateGetTemperature": frozenset({"home_read"}),
    "HassClimateSetTemperature": frozenset({"home_control"}),
    "HassGetCurrentDate": frozenset({"home_read"}),
    "HassGetCurrentTime": frozenset({"home_read"}),
    "HassGetWeather": frozenset({"home_read", "weather"}),
    "weather_forecast": frozenset({"weather"}),
    "google_web_sogning": frozenset({"web_search"}),
    "HassMediaSearchAndPlay": frozenset({"music_search", "music_playback"}),
    "HassMediaPause": frozenset({"music_transport"}),
    "HassMediaUnpause": frozenset({"music_transport"}),
    "HassMediaNext": frozenset({"music_transport"}),
    "HassMediaPrevious": frozenset({"music_transport"}),
    "HassSetVolume": frozenset({"music_transport"}),
    "HassSetVolumeRelative": frozenset({"music_transport"}),
    "HassMediaPlayerMute": frozenset({"music_transport"}),
    "HassMediaPlayerUnmute": frozenset({"music_transport"}),
    "HassVacuumStart": frozenset({"home_control"}),
    "HassVacuumReturnToBase": frozenset({"home_control"}),
    "HassVacuumCleanArea": frozenset({"home_control"}),
    "podconnect_recently_played": frozenset({"music_history"}),
    "podconnect_top_tracks": frozenset({"music_history"}),
    "podconnect_liked": frozenset({"music_history"}),
}
_RESERVED_PROVIDER_TOOL_NAMES = frozenset({"end_conversation", "wait_for_user", "approve_action"})

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
_TIME_FIELDS = ("time", "date", "weekday", "week_number")
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


@dataclass(frozen=True, slots=True)
class _CanonicalEntity:
    """One exact HA state used by both authorization and intent dispatch."""

    entity_id: str
    domain: str
    state: str
    attributes: dict[str, Any]


@dataclass(frozen=True, slots=True)
class _PreparedExecution:
    args: dict[str, Any]
    trusted_risk: Risk | None
    error: dict[str, Any] | None = None
    batch_args: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True, slots=True)
class _DiscoverySnapshot:
    """One atomically published view used by declarations and panel readiness."""

    generation: int
    mcp_tools: tuple[dict[str, Any], ...]
    mcp_names: frozenset[str]
    podconnect_services: frozenset[str]
    fetched_at: float | None
    endpoint: str | None
    api_id: str | None
    server_info: dict[str, Any]
    schema_sha256: str | None
    last_error: str | None
    retry_state: str
    retry_attempt: int
    retry_delay_s: float | None
    next_retry_at: float | None


_TARGETED_HA_INTENTS = {
    "HassTurnOn",
    "HassTurnOff",
    "HassClimateSetTemperature",
    "HassLightSet",
    "HassMediaSearchAndPlay",
    "HassMediaPause",
    "HassMediaUnpause",
    "HassMediaNext",
    "HassMediaPrevious",
    "HassSetVolume",
}
_EXACT_LOW_RISK_DOMAINS = {
    "HassLightSet": "light",
    "HassMediaSearchAndPlay": "media_player",
    "HassMediaPause": "media_player",
    "HassMediaUnpause": "media_player",
    "HassMediaNext": "media_player",
    "HassMediaPrevious": "media_player",
    "HassSetVolume": "media_player",
}
_TARGET_SELECTOR_KEYS = {
    "entity_id",
    "entity",
    "name",
    "target",
    "area",
    "area_id",
    "floor",
    "floor_id",
    "preferred_area_id",
    "preferred_floor_id",
    "device",
    "device_id",
    "device_class",
    "domain",
}
_ORDINARY_OPEN_COVER_CLASSES = {"awning", "blind", "curtain", "shade", "shutter"}
_ACCESS_OPEN_COVER_CLASSES = {"door", "garage", "gate", "window"}
_TEMPERATURE_KEYS = ("temperature", "target_temperature", "target_temp", "temp")


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
        execution_policy: ExecutionPolicy | None = None,
    ) -> None:
        self._mcp = mcp
        self._token = supervisor_token
        self._client = client
        self._timers = timers
        self._hub = hub
        self.execution_policy = execution_policy or ExecutionPolicy()
        self._discovery = _DiscoverySnapshot(
            generation=0,
            mcp_tools=(),
            mcp_names=frozenset(),
            podconnect_services=frozenset(),
            fetched_at=None,
            endpoint=self._safe_endpoint(getattr(mcp, "url", "")),
            api_id=self._mcp_api_id(mcp),
            server_info={},
            schema_sha256=None,
            last_error=None if mcp is None else "discovery_not_started",
            retry_state="disabled" if mcp is None else "starting",
            retry_attempt=0,
            retry_delay_s=None,
            next_retry_at=None,
        )
        self._fetch_lock = asyncio.Lock()
        self._recovery_wakeup = asyncio.Event()
        self._mcp_epoch = 0
        self._tz: datetime.tzinfo | None = None
        self._entity_index: dict[str, tuple[_CanonicalEntity, ...]] = {}
        self._entity_index_at = 0.0
        self._entity_lock = asyncio.Lock()

    # ------------------------------------------------------------------ startup
    healthy: bool = True  # last REAL-probe outcome; wake speaks up when False

    async def start(self) -> None:
        """Fetch the MCP tool list once at boot. Failure degrades to local-only
        tools with a LOUD log line — a silent no-tool assistant is the old bug."""
        await self.probe()
        if self._mcp is not None and not self._discovery.mcp_tools:
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
                if "services" not in domains:
                    raise ValueError("HA services response has no services list")
                domains = domains["services"]
            if not isinstance(domains, list) or not all(
                isinstance(domain, dict) for domain in domains
            ):
                raise ValueError("HA services response is not a list of objects")
            discovered: set[str] = set()
            for domain in domains:
                if domain.get("domain") != "podconnect":
                    continue
                if "services" not in domain:
                    raise ValueError("podconnect services are missing")
                services = domain["services"]
                if not isinstance(services, (dict, list)):
                    raise ValueError("podconnect services are malformed")
                names = services.keys() if isinstance(services, dict) else services
                if not all(isinstance(name, str) and name for name in names):
                    raise ValueError("podconnect service name is malformed")
                discovered = set(names)
                break
            snap = self._discovery
            self._discovery = _DiscoverySnapshot(
                generation=snap.generation + 1,
                mcp_tools=snap.mcp_tools,
                mcp_names=snap.mcp_names,
                podconnect_services=frozenset(discovered),
                fetched_at=snap.fetched_at,
                endpoint=snap.endpoint,
                api_id=snap.api_id,
                server_info=snap.server_info,
                schema_sha256=snap.schema_sha256,
                last_error=snap.last_error,
                retry_state=snap.retry_state,
                retry_attempt=snap.retry_attempt,
                retry_delay_s=snap.retry_delay_s,
                next_retry_at=snap.next_retry_at,
            )
            log.info(
                "PodConnect Control data services: %s",
                ", ".join(sorted(discovered)) or "none",
            )
        except Exception as e:
            snap = self._discovery
            self._discovery = _DiscoverySnapshot(
                generation=snap.generation + 1,
                mcp_tools=snap.mcp_tools,
                mcp_names=snap.mcp_names,
                podconnect_services=frozenset(),
                fetched_at=snap.fetched_at,
                endpoint=snap.endpoint,
                api_id=snap.api_id,
                server_info=snap.server_info,
                schema_sha256=snap.schema_sha256,
                last_error=snap.last_error,
                retry_state=snap.retry_state,
                retry_attempt=snap.retry_attempt,
                retry_delay_s=snap.retry_delay_s,
                next_retry_at=snap.next_retry_at,
            )
            log.info("PodConnect Control service discovery unavailable: %s", e)

    async def _refresh(self, *, force: bool = False) -> None:
        if self._mcp is None:
            return
        async with self._fetch_lock:
            snap = self._discovery
            epoch = self._mcp_epoch
            age = time.time() - snap.fetched_at if snap.fetched_at is not None else math.inf
            if not force and snap.mcp_tools and age < _TOOLS_TTL_S:
                return
            try:
                tools = self._compile_mcp_tools(await self._mcp.list_tools())
            except Exception as e:
                failure = (
                    e
                    if isinstance(e, McpError)
                    else McpError(f"MCP declaration admission failed: {e}", connection_shaped=True)
                )
                self._record_discovery_failure(failure)
                if self._hub is not None:
                    self._hub.set_service("mcp", "down")
                log.warning("MCP tools/list failed: %s", e)
                return
            if self._mcp_epoch != epoch:
                log.warning("discarding stale MCP tools/list success after a newer failure")
                return
            names = frozenset(t["name"] for t in tools)
            encoded = json.dumps(tools, sort_keys=True, separators=(",", ":")).encode()
            info = getattr(self._mcp, "server_info", {}) or {}
            self._discovery = _DiscoverySnapshot(
                generation=snap.generation + 1,
                mcp_tools=tuple(tools),
                mcp_names=names,
                podconnect_services=self._discovery.podconnect_services,
                fetched_at=time.time(),
                endpoint=self._safe_endpoint(getattr(self._mcp, "url", "")),
                api_id=self._mcp_api_id(self._mcp),
                server_info=dict(info),
                schema_sha256=hashlib.sha256(encoded).hexdigest(),
                last_error=None,
                retry_state="ready",
                retry_attempt=0,
                retry_delay_s=None,
                next_retry_at=None,
            )
            self._recovery_wakeup.clear()
            if self._hub is not None:
                self._hub.set_service("mcp", "up" if tools else "degraded")
            log.info(
                "MCP tools: %d from HA (%s)",
                len(tools),
                ", ".join(sorted(names)) or "none",
            )

    @staticmethod
    def _compile_mcp_tools(raw_tools: Any) -> list[dict[str, Any]]:
        """Validate the complete declaration page before it can become current."""
        if not isinstance(raw_tools, list):
            raise ValueError("MCP tools/list is not a list")
        if len(raw_tools) > _MAX_MCP_TOOLS:
            raise ValueError(f"MCP tools/list exceeds {_MAX_MCP_TOOLS} tools")
        compiled: list[dict[str, Any]] = []
        names: set[str] = set()
        for index, raw in enumerate(raw_tools):
            if not isinstance(raw, dict):
                raise ValueError(f"MCP tool[{index}] is not an object")
            name = raw.get("name")
            if (
                not isinstance(name, str)
                or not name.strip()
                or name != name.strip()
                or name in names
            ):
                raise ValueError(f"MCP tool[{index}] has a missing or duplicate name")
            if name in _RESERVED_PROVIDER_TOOL_NAMES:
                raise ValueError(f"MCP tool {name} collides with a reserved lifecycle tool")
            if "inputSchema" not in raw:
                raise ValueError(f"MCP tool {name} has no inputSchema")
            try:
                schema = json.loads(json.dumps(raw["inputSchema"]))
            except (TypeError, ValueError) as exc:
                raise ValueError(f"MCP tool {name} inputSchema is not JSON") from exc
            if not isinstance(schema, dict):
                raise ValueError(f"MCP tool {name} has no object inputSchema")
            if ToolRouter._json_depth(schema) > _MAX_MCP_SCHEMA_DEPTH:
                raise ValueError(f"MCP tool {name} schema exceeds depth {_MAX_MCP_SCHEMA_DEPTH}")
            description = raw["description"] if "description" in raw else name
            if not isinstance(description, str):
                raise ValueError(f"MCP tool {name} has a non-string description")
            try:
                Draft202012Validator.check_schema(schema)
            except SchemaError as exc:
                raise ValueError(f"MCP tool {name} has invalid schema: {exc.message}") from exc
            for node in ToolRouter._schema_nodes(schema):
                for keyword in ("$ref", "$dynamicRef"):
                    ref = node.get(keyword)
                    if isinstance(ref, str) and not ref.startswith("#"):
                        raise ValueError(f"MCP tool {name} uses non-local {keyword}")
            Draft202012Validator(schema)
            names.add(name)
            declaration = {
                "name": name,
                "description": description or name,
                "parameters": schema,
            }
            tool_bytes = compact_json_size(realtime_function_tool(declaration))
            if tool_bytes > _MAX_MCP_TOOL_BYTES:
                raise ValueError(f"MCP tool {name} exceeds {_MAX_MCP_TOOL_BYTES} bytes")
            compiled.append(declaration)
            if realtime_tools_wire_size(compiled) > _MAX_MCP_TOTAL_BYTES:
                raise ValueError(
                    f"MCP tools/list exceeds {_MAX_MCP_TOTAL_BYTES} serialized wire bytes"
                )
        return compiled

    @classmethod
    def _schema_nodes(cls, value: object):
        if isinstance(value, dict):
            yield value
            for child in value.values():
                yield from cls._schema_nodes(child)
        elif isinstance(value, list):
            for child in value:
                yield from cls._schema_nodes(child)

    @classmethod
    def _json_depth(cls, value: object) -> int:
        if isinstance(value, dict):
            return 1 + max((cls._json_depth(child) for child in value.values()), default=0)
        if isinstance(value, list):
            return 1 + max((cls._json_depth(child) for child in value), default=0)
        return 0

    def _record_discovery_failure(self, error: Exception | str) -> None:
        snap = self._discovery
        if isinstance(error, McpError) and error.connection_shaped and self._mcp is not None:
            reset = getattr(self._mcp, "reset_connection_state", None)
            if callable(reset):
                reset()
        self._mcp_epoch += 1
        attempt = snap.retry_attempt + 1
        delay = _RECOVERY_BACKOFF_S[min(attempt - 1, len(_RECOVERY_BACKOFF_S) - 1)]
        self._discovery = _DiscoverySnapshot(
            generation=snap.generation + 1,
            # Active sessions already copied their accepted schema. New sessions get
            # local-only declarations until a complete fresh page is admitted.
            mcp_tools=(),
            mcp_names=frozenset(),
            podconnect_services=frozenset(),
            fetched_at=time.time(),
            endpoint=snap.endpoint,
            api_id=snap.api_id,
            server_info=snap.server_info,
            schema_sha256=None,
            last_error=str(error)[:500],
            retry_state="retrying",
            retry_attempt=attempt,
            retry_delay_s=delay,
            next_retry_at=time.time() + delay,
        )
        self.healthy = False
        if self._hub is not None:
            self._hub.set_service("mcp", "down")
        self._recovery_wakeup.set()

    def next_probe_delay(self) -> float:
        snap = self._discovery
        if snap.retry_state == "retrying" and snap.next_retry_at is not None:
            return max(0.0, snap.next_retry_at - time.time())
        return _TOOLS_TTL_S

    async def wait_for_recovery_signal(self) -> None:
        await self._recovery_wakeup.wait()
        self._recovery_wakeup.clear()

    def discovery_status(self) -> dict[str, Any]:
        snap = self._discovery
        return {
            "generation": snap.generation,
            "fetched_at": snap.fetched_at,
            "endpoint": snap.endpoint,
            "api_id": snap.api_id,
            "server_info": dict(snap.server_info),
            "schema_sha256": snap.schema_sha256,
            "last_error": snap.last_error,
            "retry_state": snap.retry_state,
            "retry_attempt": snap.retry_attempt,
            "retry_delay_s": snap.retry_delay_s,
            "next_retry_at": snap.next_retry_at,
        }

    @staticmethod
    def _mcp_api_id(mcp: Any) -> str | None:
        endpoint = str(getattr(mcp, "url", "") or "")
        if not endpoint:
            return None
        path = urlsplit(endpoint).path or "/"
        if endpoint.startswith(C.SUPERVISOR_CORE_API):
            return "supervisor_core:mcp"
        return f"configured:{path}"

    @staticmethod
    def _safe_endpoint(endpoint: Any) -> str | None:
        raw = str(endpoint or "")
        if not raw:
            return None
        try:
            parsed = urlsplit(raw)
            host = parsed.hostname or ""
            if ":" in host:
                host = f"[{host}]"
            netloc = f"{host}:{parsed.port}" if parsed.port is not None else host
        except ValueError:
            return "invalid-configured-endpoint"
        return urlunsplit((parsed.scheme, netloc, parsed.path, "", ""))

    async def probe(self) -> bool:
        """PROVE home control by touching a REAL read-only tool. A tool COUNT lies:
        HassTurnOn/GetLiveContext exist as tools even with ZERO exposed entities
        (modprøve A2 — 'lam men lyder rask'). Called at boot and periodically."""
        # HACS can add/reload Control independently of this add-on. Refresh its
        # services on the same probe edge. A failed current read removes those tools
        # for the next session; an already-open session retains its detached schema.
        await self._refresh_podconnect_services()
        ok = False
        if self._mcp is not None:
            # Admission (complete list + schema compilation) happens before the read-only
            # live-context probe.  A rejected page can never be advertised to Realtime.
            await self._refresh(force=True)
        if (
            self._mcp is not None
            and self._discovery.retry_state == "ready"
            and "GetLiveContext" in self._discovery.mcp_names
        ):
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
                "description": "Read precisely requested current local time fields. You "
                "interpret the latest user turn and choose one or more fields: time is "
                "the clock, date is the calendar date, weekday is the day name "
                "(mandag-søndag), and week_number is the numbered ISO week. Never "
                "confuse weekday with week_number. Request only fields the latest turn "
                "asks for; do not inherit a field merely because the previous turn used "
                "it. If the latest turn wraps up the conversation, use the conversation-"
                "ending tool instead.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "fields": {
                            "type": "array",
                            "items": {"type": "string", "enum": list(_TIME_FIELDS)},
                            "minItems": 1,
                            "uniqueItems": True,
                            "description": "Only the temporal fields requested now.",
                        }
                    },
                    "required": ["fields"],
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
            if service_name in self._discovery.podconnect_services:
                decls.append(
                    {
                        "name": tool_name,
                        "description": description,
                        "parameters": {"type": "object", "properties": {}},
                    }
                )
        local_names = {d["name"] for d in decls}
        snapshot_tools = self._discovery.mcp_tools
        decls += [json.loads(json.dumps(t)) for t in snapshot_tools if t["name"] not in local_names]
        return decls

    def capabilities(self) -> dict:
        """Panel/debug view of what the assistant can *actually* call right now.

        Service dots are too coarse: "MCP up" only says Home Assistant answered,
        not whether a search agent or music tools are exposed to Assist. This keeps
        the product goal visible in the panel instead of hidden in add-on logs.
        """
        decls = self.declarations()
        names = [str(d.get("name", "")) for d in decls if d.get("name")]

        current = self._discovery.retry_state in {"ready", "disabled"}
        declared_roles: set[str] = set()
        role_tools: dict[str, list[str]] = {
            "time": ["get_time"] if "get_time" in names else [],
            "timers": [
                name for name in ("set_timer", "list_timers", "cancel_timer") if name in names
            ],
            "home": [],
            "web_search": [],
            "weather": [],
            "music": [],
            "home_read": [],
            "home_control": [],
            "music_history": [],
            "music_search": [],
            "music_playback": [],
            "music_transport": [],
        }
        if current:
            for name in names:
                for role in _TOOL_CAPABILITY_ROLES.get(name, ()):
                    declared_roles.add(role)
                    role_tools[role].append(name)
        role_tools["home"] = list(role_tools["home_control"])
        # The product pill promises that Nabu can actually find/start music.
        # Transport-only controls (pause, volume, next) remain useful detailed
        # capabilities, but must not turn the aggregate music promise green.
        role_tools["music"] = list(role_tools["music_playback"])

        caps = {
            "tools": names,
            "count": len(names),
            "time": "get_time" in names,
            "timers": any(n in names for n in ("set_timer", "list_timers", "cancel_timer")),
            "home": bool(role_tools["home"]),
            "web_search": "web_search" in declared_roles,
            "weather": "weather" in declared_roles,
            "music": bool(role_tools["music"]),
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
        caps["discovery"] = self.discovery_status()
        caps["roles"] = role_tools
        return caps

    # ------------------------------------------------------------------ dispatch
    async def dispatch(
        self,
        name: str,
        args: dict,
        *,
        execution_context: ExecutionContext | None = None,
        approval_token: str | None = None,
    ) -> dict:
        declaration = next((item for item in self.declarations() if item.get("name") == name), {})
        dispatch_args: dict[str, Any] = dict(args)
        # A stale active session may still know a tool after discovery was invalidated.
        # Never refresh-and-execute that now-undeclared name below the policy boundary.
        if not declaration:
            result = {"ok": False, "error_kind": "bad_args", "error": f"unknown tool {name}"}
            self._log_tool(name, result, dispatch_args)
            return result
        if declaration:
            prepared = await self._prepare_execution(name, dispatch_args)
            if prepared.error is not None:
                self._log_tool(name, prepared.error, dispatch_args)
                return prepared.error
            dispatch_args = prepared.args
            authorization_calls = prepared.batch_args or (dispatch_args,)
            for call_args in authorization_calls:
                denied = self.execution_policy.authorize(
                    name,
                    call_args,
                    description=str(declaration.get("description", "")),
                    context=execution_context,
                    approval_token=approval_token,
                    trusted_risk=prepared.trusted_risk,
                )
                if denied is not None:
                    self._log_tool(name, denied, call_args)
                    return denied
            if prepared.batch_args:
                return await self._dispatch_canonical_batch(name, prepared.batch_args)
        # Hard time-bound so a slow/wedged HA can never hang the conversational turn.
        try:
            result = await asyncio.wait_for(
                self._dispatch(name, dispatch_args), timeout=C.TOOL_TIMEOUT_S
            )
        except TimeoutError:
            result = {
                "ok": False,
                "error_kind": "timeout",
                "error": "the service took too long to respond",
            }
        self._log_tool(name, result, dispatch_args)
        return result

    async def _dispatch_canonical_batch(
        self, name: str, calls: tuple[dict[str, Any], ...]
    ) -> dict[str, Any]:
        """Execute a bounded room request as individually pinned HA intent calls."""
        results: list[dict[str, Any]] = []
        active_args: dict[str, Any] | None = None
        try:
            # One user tool-call gets one deadline. Never multiply the conversational
            # timeout by the number of lights in a room.
            async with asyncio.timeout(C.TOOL_TIMEOUT_S):
                for call_args in calls:
                    active_args = call_args
                    result = await self._dispatch(name, call_args)
                    self._log_tool(name, result, call_args)
                    results.append({"target": call_args["name"], "result": result})
                    active_args = None
        except TimeoutError:
            result = {
                "ok": False,
                "error_kind": "timeout",
                "error": "the room action exceeded the single tool deadline",
            }
            target = active_args["name"] if active_args else "remaining_targets"
            self._log_tool(name, result, active_args or {})
            results.append({"target": target, "result": result})
        failed = [item for item in results if not item["result"].get("ok")]
        if failed:
            return {
                "ok": False,
                "error_kind": "partial_failure",
                "error": "one or more exact Home Assistant targets failed",
                "data": {"results": results},
            }
        return {
            "ok": True,
            "summary": f"Handlingen blev udført på {len(results)} enheder.",
            "data": {"results": results},
        }

    async def approve_action(
        self,
        challenge_id: str,
        *,
        confirmation_context: ExecutionContext,
    ) -> dict:
        """Execute the server-held proposal released by a trusted later-turn signal.

        This method is intentionally not declared to the model. ThinSession may map a
        completed reserved approval signal to it; ordinary MCP calls cannot invoke it.
        """
        approved = self.execution_policy.confirm(
            challenge_id,
            confirmation_context=confirmation_context,
        )
        if approved is None:
            return {
                "ok": False,
                "error_kind": "approval_denied",
                "error": "the approval is stale, mismatched, or not from a later turn",
            }
        return await self.dispatch(
            approved.action,
            approved.args,
            execution_context=approved.context,
            approval_token=approved.token,
        )

    def begin_execution_turn(self, context: ExecutionContext) -> None:
        """Advance the one-turn approval window at Thin's trusted turn edge."""
        self.execution_policy.begin_turn(context)

    async def _prepare_execution(self, name: str, args: dict[str, Any]) -> _PreparedExecution:
        """Pin a target before policy and send those exact same arguments to HA.

        The model's ``domain``, friendly name, area and declaration description are
        routing hints, never authorization evidence.  For HA intents whose effect is
        target-dependent we require one state from HA's own ``/states`` response,
        replace every broad selector with that entity id, and classify only the
        canonical domain/state metadata.
        """
        if name not in _TARGETED_HA_INTENTS:
            return _PreparedExecution(dict(args), None)
        area = args.get("area") or args.get("area_id")
        if area not in (None, ""):
            return await self._prepare_area_execution(name, args, area)
        target = self._target_hint(args)
        if target is None:
            return self._target_error("missing_exact_target")
        entity = await self._resolve_entity(target)
        if entity is None:
            return self._target_error("unresolved_or_ambiguous_target")

        canonical_args = {
            key: value for key, value in args.items() if key not in _TARGET_SELECTOR_KEYS
        }
        # Home Assistant's intent matcher explicitly accepts an entity id in the
        # ``name`` slot.  This prevents a later friendly-name rename or duplicate from
        # redirecting the already-authorized call.
        canonical_args["name"] = entity.entity_id

        if name == "HassClimateSetTemperature":
            entity = await self._refresh_exact_entity(entity)
            if entity is None:
                return self._target_error("fresh_climate_state_unavailable")
            return self._prepare_climate(canonical_args, args, entity)
        if name in {"HassTurnOn", "HassTurnOff"} and set(canonical_args) != {"name"}:
            return self._target_error("unexpected_on_off_arguments")
        if expected_domain := _EXACT_LOW_RISK_DOMAINS.get(name):
            if entity.domain != expected_domain:
                return self._target_error("wrong_target_domain")
            return _PreparedExecution(canonical_args, Risk.LOW_RISK)
        return _PreparedExecution(canonical_args, self._on_off_risk(name, entity))

    async def _prepare_area_execution(
        self, name: str, args: dict[str, Any], area: Any
    ) -> _PreparedExecution:
        """Resolve room requests without ever broadening an optional named target."""
        if not isinstance(area, str):
            return self._target_error("broad_target_not_supported")
        if any(
            args.get(key) not in (None, "", [])
            for key in ("floor", "floor_id", "device", "device_id")
        ):
            return self._target_error("conflicting_broad_target")
        selectors = [args.get(key) for key in ("entity_id", "entity", "name", "target")]
        named = [value.strip() for value in selectors if isinstance(value, str) and value.strip()]
        if len(named) > 1 or any(
            isinstance(value, (list, dict)) for value in selectors if value is not None
        ):
            return self._target_error("ambiguous_named_area_target")

        # Domain is a routing constraint here, not a grant. Every returned entity is
        # independently checked against /states and authorized by its actual domain.
        domain_value = args.get("domain")
        if isinstance(domain_value, str):
            domains = {domain_value.strip().casefold()} if domain_value.strip() else set()
        elif isinstance(domain_value, list):
            domains = {
                str(value).strip().casefold() for value in domain_value if str(value).strip()
            }
        else:
            domains = set()

        if name in {"HassTurnOn", "HassTurnOff"}:
            if len(domains) != 1 or not domains <= {"light", "media_player"}:
                return self._target_error("area_requires_one_low_risk_domain")
            expected_domain = next(iter(domains))
        elif name == "HassClimateSetTemperature":
            expected_domain = "climate"
            if domains and domains != {expected_domain}:
                return self._target_error("wrong_area_domain")
        elif mapped_domain := _EXACT_LOW_RISK_DOMAINS.get(name):
            expected_domain = mapped_domain
            if domains and domains != {expected_domain}:
                return self._target_error("wrong_area_domain")
        else:
            return self._target_error("broad_target_not_supported")

        entities = await self._resolve_area_entities(area)
        exact = tuple(entity for entity in entities if entity.domain == expected_domain)
        if named:
            target_key = named[0].casefold()
            exact = tuple(
                entity
                for entity in exact
                if entity.entity_id.casefold() == target_key
                or str(entity.attributes.get("friendly_name") or "").strip().casefold()
                == target_key
            )
            if len(exact) != 1:
                return self._target_error("ambiguous_named_area_target")
        if not exact:
            return self._target_error("area_has_no_resolved_targets")
        if len(exact) > 16:
            return self._target_error("area_target_count_exceeds_limit")
        base = {key: value for key, value in args.items() if key not in _TARGET_SELECTOR_KEYS}
        if name in {"HassTurnOn", "HassTurnOff"} and base:
            return self._target_error("unexpected_on_off_arguments")
        calls = tuple({**base, "name": entity.entity_id} for entity in exact)
        if name == "HassClimateSetTemperature":
            if len(exact) != 1:
                return self._target_error("ambiguous_area_climate_target")
            fresh = await self._refresh_exact_entity(exact[0])
            if fresh is None:
                return self._target_error("fresh_climate_state_unavailable")
            return self._prepare_climate(calls[0], args, fresh)
        if expected_domain == "media_player" and len(exact) != 1:
            return self._target_error("ambiguous_area_media_target")
        if len(calls) == 1:
            return _PreparedExecution(calls[0], Risk.LOW_RISK)
        return _PreparedExecution(calls[0], Risk.LOW_RISK, batch_args=calls)

    @staticmethod
    def _target_hint(args: dict[str, Any]) -> str | None:
        # Areas/floors and lists can select multiple entities.  They cannot be pinned
        # from /states alone and therefore fail closed instead of creating a broad
        # approval challenge.
        broad = ("area", "area_id", "floor", "floor_id", "device", "device_id")
        if any(args.get(key) not in (None, "", []) for key in broad):
            return None
        domain = args.get("domain")
        if isinstance(domain, list):
            normalized_domains = {
                str(value).strip().casefold() for value in domain if str(value).strip()
            }
            if len(normalized_domains) != 1:
                return None
        elif domain is not None and not isinstance(domain, str):
            return None
        candidates = [args.get(key) for key in ("entity_id", "entity", "name", "target")]
        present = [
            value.strip() for value in candidates if isinstance(value, str) and value.strip()
        ]
        if len(present) != 1:
            return None
        if any(isinstance(value, (list, dict)) for value in candidates if value is not None):
            return None
        return present[0]

    @staticmethod
    def _target_error(reason: str) -> _PreparedExecution:
        return _PreparedExecution(
            {},
            None,
            {
                "ok": False,
                "error_kind": "unresolved_target",
                "reason": reason,
                "error": "the Home Assistant target could not be pinned to one exact entity",
            },
        )

    @staticmethod
    def _on_off_risk(name: str, entity: _CanonicalEntity) -> Risk | None:
        domain = entity.domain
        turning_on = name == "HassTurnOn"
        if domain in {"light", "media_player"}:
            return Risk.LOW_RISK
        if domain == "lock":
            # HA core maps TurnOn -> lock and TurnOff -> unlock.
            return Risk.LOW_RISK if turning_on else None
        if domain == "cover":
            # HA core maps TurnOn -> open and TurnOff -> close.  Opening is
            # frictionless only for an explicitly ordinary, non-access cover class.
            if not turning_on:
                return Risk.LOW_RISK
            device_class = str(entity.attributes.get("device_class") or "").casefold()
            if device_class in _ORDINARY_OPEN_COVER_CLASSES:
                return Risk.LOW_RISK
            if device_class in _ACCESS_OPEN_COVER_CLASSES:
                return None
            return None
        if domain == "valve":
            # HA core maps TurnOn -> open and TurnOff -> close.  Opening an unknown
            # valve is not generally reversible/safe; closing is conservative.
            return None if turning_on else Risk.LOW_RISK
        # Alarm panels are not part of HA core's HassTurnOn/Off handler.  Without an
        # exact declared arm/disarm tool contract, neither direction is granted here.
        return None

    def _prepare_climate(
        self,
        canonical_args: dict[str, Any],
        original_args: dict[str, Any],
        entity: _CanonicalEntity,
    ) -> _PreparedExecution:
        if entity.domain != "climate":
            return self._target_error("wrong_target_domain")
        supplied = [key for key in _TEMPERATURE_KEYS if key in original_args]
        if len(supplied) != 1:
            return self._target_error("missing_or_ambiguous_temperature")
        raw_requested = original_args[supplied[0]]
        if isinstance(raw_requested, bool) or not isinstance(raw_requested, (int, float)):
            return self._target_error("invalid_temperature")

        entity_unit = self._temperature_unit(
            entity.attributes.get("temperature_unit")
            or entity.attributes.get("unit_of_measurement")
        )
        requested_unit = self._temperature_unit(
            original_args.get("temperature_unit") or original_args.get("unit") or entity_unit
        )
        if entity_unit is None or requested_unit is None:
            return self._target_error("unknown_temperature_unit")
        requested_c = self._to_celsius(float(raw_requested), requested_unit)
        if requested_c is None:
            return self._target_error("invalid_temperature")

        # Only the existing target setpoint grounds a setpoint delta. Ambient
        # current_temperature cannot prove whether this is a +/-3 C change.
        current_raw = entity.attributes.get("temperature")
        if isinstance(current_raw, bool) or not isinstance(current_raw, (int, float)):
            return self._target_error("missing_current_temperature")
        current_c = self._to_celsius(float(current_raw), entity_unit)
        if current_c is None:
            return self._target_error("invalid_current_temperature")

        for key in (*_TEMPERATURE_KEYS, "temperature_unit", "unit"):
            canonical_args.pop(key, None)
        if set(canonical_args) != {"name"}:
            return self._target_error("unexpected_climate_arguments")
        canonical_args["temperature"] = self._from_celsius(requested_c, entity_unit)
        low_risk = 17.0 <= requested_c <= 24.0 and abs(requested_c - current_c) <= 3.0 + 1e-9
        return _PreparedExecution(canonical_args, Risk.LOW_RISK if low_risk else None)

    @staticmethod
    def _temperature_unit(value: Any) -> str | None:
        unit = str(value or "").strip().casefold()
        if unit in {"c", "°c", "celsius"}:
            return "c"
        if unit in {"f", "°f", "fahrenheit"}:
            return "f"
        return None

    @staticmethod
    def _to_celsius(value: float, unit: str) -> float | None:
        if not math.isfinite(value):
            return None
        return value if unit == "c" else (value - 32.0) * 5.0 / 9.0

    @staticmethod
    def _from_celsius(value: float, unit: str) -> float:
        converted = value if unit == "c" else value * 9.0 / 5.0 + 32.0
        return round(converted, 6)

    async def _resolve_entity(self, target_name: str) -> _CanonicalEntity | None:
        """Resolve exactly one entity from a fresh authoritative state snapshot."""
        if not self._token or self._client is None:
            return None
        async with self._entity_lock:
            try:
                response = await self._client.get(
                    f"{C.SUPERVISOR_CORE_API}/states",
                    headers={"Authorization": f"Bearer {self._token}"},
                )
                response.raise_for_status()
                payload = response.json()
                index = self._build_entity_index(payload)
            except Exception as exc:
                log.warning("HA entity resolution failed closed: %s", exc)
                return None
            self._entity_index = index
            self._entity_index_at = time.monotonic()
        matches = self._entity_index.get(target_name.strip().casefold(), ())
        return matches[0] if len(matches) == 1 else None

    async def _refresh_exact_entity(self, expected: _CanonicalEntity) -> _CanonicalEntity | None:
        """Fetch mutable state immediately before a frictionless climate grant."""
        if not self._token or self._client is None:
            return None
        try:
            response = await self._client.get(
                f"{C.SUPERVISOR_CORE_API}/states/{expected.entity_id}",
                headers={"Authorization": f"Bearer {self._token}"},
            )
            response.raise_for_status()
            index = self._build_entity_index([response.json()])
            matches = index.get(expected.entity_id.casefold(), ())
        except Exception as exc:
            log.warning("fresh HA entity resolution failed closed: %s", exc)
            return None
        if len(matches) != 1 or matches[0].domain != expected.domain:
            return None
        return matches[0]

    async def _resolve_area_entities(self, area: str) -> tuple[_CanonicalEntity, ...]:
        """Resolve an HA area to a bounded, exact state snapshot.

        ``area_entities`` is Home Assistant's documented registry-aware lookup.  Its
        output is treated only as candidate entity ids; each id must also exist in the
        separately validated /states snapshot before it can be authorized.
        """
        if not self._token or self._client is None or not area.strip():
            return ()
        # Populate/validate the state index first. A harmless impossible id avoids
        # granting anything while still exercising the same freshness boundary.
        await self._resolve_entity("podvoice.__area_preflight__")
        if not self._entity_index:
            return ()
        template = "{{ area_entities(" + json.dumps(area, ensure_ascii=False) + ") | tojson }}"
        try:
            response = await self._client.post(
                f"{C.SUPERVISOR_CORE_API}/template",
                headers={"Authorization": f"Bearer {self._token}"},
                json={"template": template},
            )
            response.raise_for_status()
            rendered = response.json()
            if isinstance(rendered, str):
                rendered = json.loads(rendered)
            if (
                not isinstance(rendered, list)
                or len(rendered) > 256
                or any(not isinstance(value, str) for value in rendered)
            ):
                raise ValueError("HA area template returned invalid targets")
        except Exception as exc:
            log.warning("HA area resolution failed closed: %s", exc)
            return ()
        resolved: list[_CanonicalEntity] = []
        seen: set[str] = set()
        for entity_id in rendered:
            key = entity_id.strip().casefold()
            matches = self._entity_index.get(key, ())
            if len(matches) != 1 or key in seen:
                continue
            seen.add(key)
            resolved.append(matches[0])
        return tuple(resolved)

    @staticmethod
    def _build_entity_index(payload: Any) -> dict[str, tuple[_CanonicalEntity, ...]]:
        if not isinstance(payload, list):
            raise ValueError("HA /states response is not a list")
        mapping: dict[str, list[_CanonicalEntity]] = {}
        seen_ids: set[str] = set()
        for raw in payload:
            if not isinstance(raw, dict):
                raise ValueError("HA /states contains a non-object")
            entity_id = raw.get("entity_id")
            attributes = raw.get("attributes")
            if (
                not isinstance(entity_id, str)
                or entity_id.count(".") != 1
                or not all(entity_id.split(".", 1))
                or not isinstance(attributes, dict)
                or entity_id.casefold() in seen_ids
            ):
                raise ValueError("HA /states contains a malformed or duplicate entity")
            seen_ids.add(entity_id.casefold())
            entity = _CanonicalEntity(
                entity_id=entity_id,
                domain=entity_id.split(".", 1)[0].casefold(),
                state=str(raw.get("state") or ""),
                attributes=dict(attributes),
            )
            friendly = attributes.get("friendly_name")
            names = [entity_id]
            if isinstance(friendly, str) and friendly.strip():
                names.append(friendly)
            for value in names:
                mapping.setdefault(value.strip().casefold(), []).append(entity)
        return {key: tuple(value) for key, value in mapping.items()}

    async def _dispatch(self, name: str, args: dict) -> dict:
        try:
            if name == "get_time":  # local, always available — the clock never fails
                return await self._get_time(args)
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
            if name not in self._discovery.mcp_names:
                await self._refresh(force=True)  # a reload may have added the tool
            if name not in self._discovery.mcp_names:
                return {"ok": False, "error_kind": "bad_args", "error": f"unknown tool {name}"}
            result = await self._mcp.call_tool(name, args or {})
            return _mcp_result_to_contract(result)
        except McpError as e:
            if e.connection_shaped:
                self._record_discovery_failure(e)
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
        if service_name not in self._discovery.podconnect_services:
            await self._refresh_podconnect_services()
        if service_name not in self._discovery.podconnect_services:
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

    async def _get_time(self, args: dict) -> dict:
        """Return only model-selected local time fields with a focused Danish summary.

        Realtime still owns interpretation: it chooses ``fields`` from the declared
        schema.  The tool only prevents unrelated temporal data from competing in the
        result, which is what made a physically clear ``ugedag`` answer become an ISO
        week number in the 1.13.24 field trace.
        """
        fields = args.get("fields")
        if (
            not isinstance(fields, list)
            or not fields
            or any(not isinstance(field, str) or field not in _TIME_FIELDS for field in fields)
            or len(set(fields)) != len(fields)
        ):
            return {
                "ok": False,
                "error_kind": "bad_args",
                "error": "fields must contain one or more unique values from "
                "time, date, weekday, week_number",
            }
        now = datetime.datetime.now(await self._get_timezone())
        weekday = _WEEKDAYS_DA[now.weekday()]
        values: dict[str, str | int] = {
            "time": f"{now:%H:%M}",
            "date": f"{now:%Y-%m-%d}",
            "weekday": weekday,
            "week_number": now.isocalendar().week,
        }
        summaries = {
            "time": _spoken_clock(now.hour, now.minute),
            "date": f"Datoen er den {now.day}. {_MONTHS_DA[now.month - 1]} {now.year}.",
            "weekday": f"I dag er det {weekday}.",
            "week_number": f"Det er uge {now.isocalendar().week}.",
        }
        return {
            "ok": True,
            "summary": " ".join(summaries[field] for field in fields),
            "data": {"requested_fields": fields, **{field: values[field] for field in fields}},
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
