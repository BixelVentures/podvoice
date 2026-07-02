"""Tool bridge: model function-calls -> Home Assistant services.

PodVoice is just an AI voice front-end with **generic Home Assistant access**:
- a few curated convenience tools (lights, switches, scenes, climate, covers, to-do),
- ``list_home`` / ``list_services`` to discover entities + their services, and
- ``home_call`` to invoke ANY HA service on an allowed entity.

Everything else — music/speakers (PodConnect), a vacuum (Roborock), a fan, a lock —
is reached the SAME generic way (``list_services`` + ``home_call``). PodVoice contains
no device-specific integration logic; it only speaks Home Assistant. Only entities you
expose (settings ``exposed``) can be controlled, like HA Assist's expose model.

httpx-only; dispatch never raises (errors fold into ``{"ok": False}``) so the
model is never left waiting.
"""

from __future__ import annotations

import asyncio
import datetime
import json
import logging
import re
import time
import zoneinfo

import httpx

from . import constants as C

log = logging.getLogger(__name__)

_COVER_ACTIONS = {"open": "open_cover", "close": "close_cover", "stop": "stop_cover"}
_SERVICES_TTL_S = 600.0  # re-fetch the /services catalog at most this stale (integrations change)

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


def _field_info(f: dict) -> dict:
    """Compact field hint for list_services: description + required + select values.

    Surfaces a service field's valid inputs so the model calls it correctly — e.g.
    podconnect.play_from_library.source = liked | top_tracks | recent — and whether the
    field is REQUIRED, so the model never sends a malformed call (the old missing-'text'
    400 on conversation.process).
    """
    out: dict = {}
    if isinstance(f, dict):
        desc = f.get("description")
        if desc:
            out["description"] = desc
        if f.get("required"):
            out["required"] = True
        opts = ((f.get("selector") or {}).get("select") or {}).get("options")
        if opts:
            out["values"] = [o.get("value", o) if isinstance(o, dict) else o for o in opts]
    return out


def _iter_fields(fields: object):
    """Yield (name, field) pairs, flattening HA collapsible 'section' fields one level
    (advanced/collapsed groups nest their real fields under a 'fields' sub-dict)."""
    if isinstance(fields, dict):
        for name, f in fields.items():
            if isinstance(f, dict) and isinstance(f.get("fields"), dict):
                yield from _iter_fields(f["fields"])
            else:
                yield name, f


def _response_mode_of(info: object) -> str:
    """HA's tri-state response support for a service: none | optional | only.

    Tells the model when return_response is forbidden / allowed / mandatory, so home_call
    can auto-correct the flag instead of 400-ing on a guess.
    """
    resp = info.get("response") if isinstance(info, dict) else None
    if not resp:
        return "none"
    return "optional" if (isinstance(resp, dict) and resp.get("optional")) else "only"


def _normalize_service_response(payload: object) -> tuple[str | None, object, bool]:
    """Promote HA's intent/assist speech envelope to a short ``summary`` — SHAPE-driven,
    never service-name-driven.

    Recognizes exactly ONE HA-wide convention: ``payload[response][speech][plain][speech]``
    (emitted by every conversation/intent agent), and returns that string as the summary.
    Also reports ``is_error`` when ``response_type == 'error'`` so a failed agent (timeout,
    "couldn't reach the service") is surfaced as a failure, not a cheerful answer. Any other
    shape (track lists, search results, query data) passes through unchanged (summary=None).
    Never reshapes or drops ``data``; every access is guarded so a surprise shape can't raise.
    VERIFY: HA intent-response envelope (response.speech.plain.speech / response_type).
    """
    is_error = False
    if isinstance(payload, dict):
        # Require the HA `response` wrapper — don't promote a stray top-level
        # speech.plain.speech that just happens to be in some service's data.
        inner = payload.get("response")
        if isinstance(inner, dict):
            is_error = inner.get("response_type") == "error"
            speech = inner.get("speech")
            plain = speech.get("plain") if isinstance(speech, dict) else None
            text = plain.get("speech") if isinstance(plain, dict) else None
            if isinstance(text, str) and text.strip():
                return text.strip(), payload, is_error
    return None, payload, is_error


# One template render gives each entity's HA Area (the area registry isn't in the REST
# /states; this is the REST-friendly way to read it).
_AREA_TEMPLATE = (
    "{% set out = namespace(x=[]) %}"
    "{% for s in states %}"
    "{% set out.x = out.x + [[s.entity_id, area_name(s.entity_id)]] %}"
    "{% endfor %}"
    "{{ out.x | tojson }}"
)


class HAToolBridge:
    """Maps model tool calls onto Home Assistant services. Satisfies ToolBridgeLike."""

    def __init__(
        self,
        supervisor_token: str,
        client: httpx.AsyncClient,
        *,
        exposed: list[str] | tuple[str, ...] = (),
        timers=None,  # TimerManager — local kitchen timers ("sæt en timer på ti minutter")
    ) -> None:
        self._client = client
        self._has_ha = bool(supervisor_token)
        self._ha_headers = {
            "Authorization": f"Bearer {supervisor_token}",
            "Content-Type": "application/json",
        }
        self._exposed = [e.strip().lower() for e in exposed if e and e.strip()]
        self._timers = timers
        self._services_cache: list | None = None  # memoized /services catalog (TTL'd)
        self._services_ts: float = 0.0
        self._tz: datetime.tzinfo | None = None  # memoized HA-configured timezone (get_time)

    # ------------------------------------------------------------------ allowlist
    def _allowed(self, entity_id: str | None) -> bool:
        eid = (entity_id or "").lower()
        if not eid or "." not in eid:
            return False
        return eid in self._exposed or eid.split(".")[0] in self._exposed

    # ------------------------------------------------------------------ declarations
    def declarations(self) -> list[dict]:
        # get_time is LOCAL (no HA call) and always available — "hvad er klokken?" must
        # never fail with "det kan jeg ikke slå op her". Answers with HA's configured
        # timezone (the container itself may run UTC).
        decls: list[dict] = [
            {
                "name": "get_time",
                "description": "The current local time and date (clock, weekday, date). "
                "Call this whenever the user asks what time it is, today's date or weekday.",
                "parameters": {"type": "object", "properties": {}},
            }
        ]
        if self._timers is not None:
            # Local kitchen timers — no HA dependency. The expiry rings ON the Voice PE
            # ("Din timer er færdig!"), so the model must never claim it can't set timers.
            decls += [
                {
                    "name": "set_timer",
                    "description": "Start a countdown timer that will ring on this speaker "
                    "when it finishes (e.g. 'sæt en timer på 10 minutter'). Confirm the "
                    "duration back to the user in Danish.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "seconds": {
                                "type": "integer",
                                "description": "Duration in seconds (e.g. 10 minutes = 600).",
                            },
                            "label": {
                                "type": "string",
                                "description": "Optional short label, e.g. 'pasta'.",
                            },
                        },
                        "required": ["seconds"],
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
        if self._has_ha:
            ent = {
                "type": "object",
                "properties": {"entity_id": {"type": "string", "description": "Target entity_id."}},
                "required": ["entity_id"],
            }
            decls += [
                {
                    "name": "list_home",
                    "description": "List the Home Assistant entities you are allowed to control "
                    "(with their friendly names and current state). Call this first to find ids.",
                    "parameters": {"type": "object", "properties": {}},
                },
                {
                    "name": "list_services",
                    "description": "Discover the available services AND their parameters for the "
                    "domains you can control — use this to find any action (e.g. a lock's "
                    "lock/unlock, a climate set_temperature, a cover's open/close, a vacuum's "
                    "segment cleaning, or a media_player's play_media), then run them with "
                    "home_call. A service with returns_response:true gives data back (e.g. a "
                    "search or history lookup) — call it via home_call with return_response:true. "
                    "Optionally pass a domain to narrow it.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "domain": {"type": "string", "description": "optional, e.g. vacuum"}
                        },
                    },
                },
                {
                    "name": "turn_on",
                    "description": "Turn an entity ON (light/switch/etc).",
                    "parameters": ent,
                },
                {"name": "turn_off", "description": "Turn an entity OFF.", "parameters": ent},
                {
                    "name": "set_light",
                    "description": "Set a light's brightness/colour.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "entity_id": {"type": "string"},
                            "brightness_pct": {"type": "integer", "description": "0-100"},
                            "color_name": {"type": "string", "description": "CSS colour name"},
                        },
                        "required": ["entity_id"],
                    },
                },
                {"name": "activate_scene", "description": "Activate a scene.", "parameters": ent},
                {
                    "name": "set_temperature",
                    "description": "Set a climate/thermostat target temperature.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "entity_id": {"type": "string"},
                            "temperature": {"type": "number"},
                        },
                        "required": ["entity_id", "temperature"],
                    },
                },
                {
                    "name": "cover_control",
                    "description": "Open/close/stop a cover (blinds/garage).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "entity_id": {"type": "string"},
                            "action": {"type": "string", "enum": list(_COVER_ACTIONS)},
                        },
                        "required": ["entity_id", "action"],
                    },
                },
                {
                    "name": "add_todo",
                    "description": "Add an item to a to-do / shopping list.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "list": {"type": "string", "description": "todo.* entity_id"},
                            "item": {"type": "string"},
                        },
                        "required": ["list", "item"],
                    },
                },
                {
                    "name": "home_call",
                    "description": "Call ANY Home Assistant service for anything beyond the tools "
                    "above — a lock, cover, climate, fan, vacuum, or a media_player — OR a data "
                    "service that RETURNS info (set return_response=true), e.g. a search or a "
                    "history lookup. Pass entity_id for entity services; for account-level "
                    "services leave it out (the domain must be exposed). Use list_services to "
                    "find a domain's services + fields — never guess a service or field name.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "domain": {
                                "type": "string",
                                "description": "e.g. lock, climate, cover, media_player, vacuum",
                            },
                            "service": {
                                "type": "string",
                                "description": "e.g. unlock, set_temperature, open_cover, start",
                            },
                            "entity_id": {
                                "type": "string",
                                "description": "target entity (omit for account-level services)",
                            },
                            "data": {
                                "type": "object",
                                "description": "extra service data (optional)",
                            },
                            "return_response": {
                                "type": "boolean",
                                "description": "true to read data back from a service that returns it",
                            },
                        },
                        "required": ["domain", "service"],
                    },
                },
            ]
        return decls

    # ------------------------------------------------------------------ HA helpers
    @staticmethod
    def _raise_for_status(r: httpx.Response) -> None:
        """Like raise_for_status, but include HA's error body so the model can self-correct
        (e.g. a 400 says exactly which field is missing) instead of a bare status code."""
        if r.status_code >= 400:
            detail = r.text.strip()[:400] or r.reason_phrase
            raise RuntimeError(f"HA {r.status_code}: {detail}")

    async def call_service(self, domain: str, service: str, data: dict) -> list:
        url = f"{C.SUPERVISOR_CORE_API}/services/{domain}/{service}"
        r = await self._client.post(url, json=data, headers=self._ha_headers)
        self._raise_for_status(r)
        return r.json()

    async def call_service_response(self, domain: str, service: str, data: dict) -> object:
        """Call a service that RETURNS data (HA response service) and return its payload.

        Uses ``?return_response``; HA replies ``{changed_states, service_response}``.
        """
        url = f"{C.SUPERVISOR_CORE_API}/services/{domain}/{service}?return_response"
        r = await self._client.post(url, json=data, headers=self._ha_headers)
        self._raise_for_status(r)
        body = r.json()
        if isinstance(body, dict) and "service_response" in body:
            return body["service_response"]
        return body

    async def _home_call(self, args: dict) -> dict:
        """Generic HA service call. Entity services need an exposed entity_id; account-
        level services need the domain exposed.

        Returns the ONE flat contract (see module docstring): success-with-data is
        ``{ok, summary?, data}`` (summary = the spoken answer when HA emits a speech
        envelope; data = the full payload), empty success adds ``empty``, and a plain
        action is ``{ok, summary:'Done.', data:{changed}}``. ``return_response`` is
        auto-corrected from HA's response mode so a guess can't 400.
        """
        # HA domains/services are lowercase snake_case; normalize so the allowlist gate,
        # the response-mode lookup, and the outgoing URL all agree (a mixed-case guess
        # would otherwise pass the gate but skip auto-correct and 404).
        domain = (args.get("domain") or "").strip().lower()
        service = (args.get("service") or "").strip().lower()
        if not domain or not service:
            return {
                "ok": False,
                "error_kind": "bad_args",
                "error": "home_call needs domain + service.",
                "hint": "Provide both 'domain' and 'service'.",
            }
        data = dict(args.get("data") or {})
        eid = (args.get("entity_id") or "").strip()
        if eid:
            if not self._allowed(eid):
                return {
                    "ok": False,
                    "error_kind": "denied",
                    "error": f"'{eid}' is not exposed (add it in Settings).",
                }
            data["entity_id"] = eid
        elif domain not in self._allowed_domains():
            # Account-level call (no entity_id): allowed if the bare domain OR any of its
            # entities is exposed — so exposing media_player.kitchen also enables the
            # domain's account-level data services (e.g. history) without surprise denials.
            return {
                "ok": False,
                "error_kind": "denied",
                "error": f"domain '{domain}' is not exposed — expose it (or one of its "
                "entities) in Settings to allow account-level calls.",
            }
        # Auto-correct return_response from HA's own metadata: force it for response-ONLY
        # services; for NONE drop it ONLY if the model didn't explicitly ask (a stale/
        # incomplete catalog must never silently discard an explicitly-requested response).
        explicit = bool(args.get("return_response"))
        want = explicit
        mode = await self._response_mode(domain, service)
        if mode == "only":
            want = True
        elif mode == "none" and not explicit:
            want = False
        if want:
            payload = await self.call_service_response(domain, service, data)
            summary, body, is_error = _normalize_service_response(payload)
            if is_error:
                # The conversation/intent agent failed — surface it as a failure (so Status
                # doesn't count it ok) while keeping its message for the model to relay.
                return {
                    "ok": False,
                    "error_kind": "intent_error",
                    "error": summary or "the agent reported an error",
                    "data": body,
                    "hint": "The agent (e.g. search) failed — relay its message or try again.",
                }
            out: dict = {"ok": True, "data": body}
            if summary:
                out["summary"] = summary
            elif body is None or body == {} or body == []:
                # Genuinely-empty containers/None = "no results" (model says so plainly).
                # Falsy scalars (0, False, "") are REAL data and must not be flagged empty.
                out["empty"] = True
            return out
        changed = await self.call_service(domain, service, data)
        return {"ok": True, "summary": "Done.", "data": {"changed": changed}}

    async def _services_raw(self) -> list:
        """GET /services, cached with a TTL so mid-session integration changes are picked up
        (and invalidated on a 404, see dispatch). Best-effort: returns [] if unavailable so
        callers degrade to the model's own flags."""
        fresh = (
            self._services_cache is not None
            and (time.monotonic() - self._services_ts) < _SERVICES_TTL_S
        )
        if not fresh:
            try:
                r = await self._client.get(
                    f"{C.SUPERVISOR_CORE_API}/services", headers=self._ha_headers
                )
                self._raise_for_status(r)
                self._services_cache = r.json()
                self._services_ts = time.monotonic()
            except Exception as e:
                log.info("services catalog unavailable: %s", e)
                return self._services_cache or []
        return self._services_cache or []

    async def _response_mode(self, domain: str, service: str) -> str | None:
        """'none' | 'optional' | 'only' for a service, or None if unknown (cold cache /
        service not found) — callers then fall back to the model's flag."""
        for entry in await self._services_raw():
            if entry.get("domain") != domain:
                continue
            info = (entry.get("services") or {}).get(service)
            return _response_mode_of(info) if isinstance(info, dict) else None
        return None

    async def _get_timezone(self) -> datetime.tzinfo:
        """HA's configured timezone (memoized). The add-on container itself typically runs
        UTC, so the wall clock the household lives by comes from HA's /config. Falls back
        to the container's local zone if HA is unreachable."""
        if self._tz is not None:
            return self._tz
        if self._has_ha:
            try:
                r = await self._client.get(
                    f"{C.SUPERVISOR_CORE_API}/config", headers=self._ha_headers
                )
                self._raise_for_status(r)
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
        spoken = (
            f"Klokken er {now:%H:%M}, {_WEEKDAYS_DA[now.weekday()]} den "
            f"{now.day}. {_MONTHS_DA[now.month - 1]} {now.year}."
        )
        return {
            "ok": True,
            "summary": spoken,
            "data": {
                "time": f"{now:%H:%M}",
                "date": f"{now:%Y-%m-%d}",
                "weekday": _WEEKDAYS_DA[now.weekday()],
                "iso": now.isoformat(timespec="seconds"),
            },
        }

    async def _list_home(self) -> dict:
        r = await self._client.get(f"{C.SUPERVISOR_CORE_API}/states", headers=self._ha_headers)
        r.raise_for_status()
        out = []
        for s in r.json():
            eid = s.get("entity_id", "")
            if self._allowed(eid):
                out.append(
                    {
                        "entity_id": eid,
                        "name": s.get("attributes", {}).get("friendly_name", eid),
                        "state": s.get("state"),
                    }
                )
        return {"ok": True, "entities": out[:100]}

    async def list_entities(self) -> dict:
        """All HA entities (id, name, domain, area) for the panel's Home-control picker.

        NOT a model tool and NOT allowlist-filtered — the panel needs the full list to
        choose what to expose. Area comes from one best-effort template render.
        """
        if not self._has_ha:
            return {
                "ok": False,
                "entities": [],
                "domains": [],
                "error": "No Home Assistant token. Reinstall the add-on (uninstall → install) so "
                "Supervisor grants core-API access (homeassistant_api), then restart.",
            }
        r = await self._client.get(f"{C.SUPERVISOR_CORE_API}/states", headers=self._ha_headers)
        r.raise_for_status()
        areas: dict[str, str] = {}
        try:
            tr = await self._client.post(
                f"{C.SUPERVISOR_CORE_API}/template",
                json={"template": _AREA_TEMPLATE},
                headers=self._ha_headers,
            )
            tr.raise_for_status()
            for eid, area in json.loads(tr.text):
                if area:
                    areas[eid] = area
        except Exception as e:  # areas are a nice-to-have; entities still list without them
            log.info("area lookup unavailable: %s", e)
        ents, domains = [], set()
        for s in r.json():
            eid = s.get("entity_id", "")
            if "." not in eid:
                continue
            dom = eid.split(".")[0]
            domains.add(dom)
            ents.append(
                {
                    "entity_id": eid,
                    "name": s.get("attributes", {}).get("friendly_name", eid),
                    "domain": dom,
                    "area": areas.get(eid),
                }
            )
        ents.sort(key=lambda e: ((e["area"] or "~"), e["domain"], e["name"]))
        return {"ok": True, "entities": ents, "domains": sorted(domains)}

    def _allowed_domains(self) -> set[str]:
        return {e.split(".")[0] if "." in e else e for e in self._exposed}

    async def _list_services(self, domain: str | None = None) -> dict:
        allowed = self._allowed_domains()
        out: dict = {}
        for entry in await self._services_raw():
            d = entry.get("domain")
            if d not in allowed or (domain and d != domain):
                continue
            out[d] = {
                svc: {
                    # name -> {description?, required?, values?} so the model knows valid
                    # inputs AND which fields are mandatory (e.g. conversation.process.text).
                    "fields": {
                        name: _field_info(f) for name, f in _iter_fields(info.get("fields"))
                    },
                    # returns_response (bool, back-compat) + tri-state response_mode tell the
                    # model when home_call needs return_response (none|optional|only).
                    "returns_response": bool(info.get("response")),
                    "response_mode": _response_mode_of(info),
                }
                for svc, info in (entry.get("services") or {}).items()
            }
        return {"ok": True, "services": out}

    # ------------------------------------------------------------------ dispatch
    @staticmethod
    def _error_result(e: Exception) -> dict:
        """Fold an exception into the standard failure dict: {ok, error_kind, status?,
        error, hint}. Parses the 'HA <code>: <body>' raised by _raise_for_status so the
        model gets an actionable error (it can fix args and retry in-turn)."""
        msg = str(e)
        out: dict = {"ok": False, "error_kind": "http", "error": msg}
        m = re.match(r"HA (\d+):", msg)
        if m:
            out["status"] = int(m.group(1))
            out["error_kind"] = f"ha_{m.group(1)}"
        out["hint"] = (
            "Use list_services to check the exact service name, required fields and "
            "response mode, then retry with corrected arguments."
        )
        return out

    def _log_tool(self, name: str, args: dict, result: dict) -> None:
        """One line per dispatched tool so the owner can debug from the Log tab (secrets
        are masked by the global redactor)."""
        target = ""
        if name == "home_call":
            target = f" {args.get('domain')}.{args.get('service')}"
        elif args.get("entity_id") or args.get("list"):
            target = f" {args.get('entity_id') or args.get('list')}"
        if result.get("ok"):
            log.info("tool %s%s -> %s", name, target, "empty" if result.get("empty") else "ok")
        else:
            log.warning(
                "tool %s%s -> FAILED kind=%s status=%s",
                name,
                target,
                result.get("error_kind"),
                result.get("status"),
            )

    async def dispatch(self, name: str, args: dict) -> dict:
        # Hard time-bound: _dispatch must always return within TOOL_TIMEOUT_S so the model
        # always gets a result (and speaks a Danish failure) instead of freezing the turn.
        try:
            result = await asyncio.wait_for(self._dispatch(name, args), timeout=C.TOOL_TIMEOUT_S)
        except TimeoutError:  # asyncio.TimeoutError is an alias for TimeoutError on 3.11+
            result = {
                "ok": False,
                "error_kind": "timeout",
                "error": "the service took too long to respond",
            }
        self._log_tool(name, args, result)
        return result

    async def _dispatch(self, name: str, args: dict) -> dict:
        try:
            if name == "get_time":  # local, no HA gate — the clock always answers
                return await self._get_time()
            # Local kitchen timers — no HA gate; the expiry rings on the Voice PE.
            if self._timers is not None and name in ("set_timer", "list_timers", "cancel_timer"):
                if name == "set_timer":
                    return self._timers.set_timer(
                        int(args.get("seconds", 0)), str(args.get("label", "") or "")
                    )
                if name == "list_timers":
                    return self._timers.list_timers()
                return self._timers.cancel_timer(args.get("id"))
            if name == "list_home":
                return await self._list_home()
            if name == "list_services":
                return await self._list_services(args.get("domain"))
            if name == "home_call":  # own gating (optional entity + return_response)
                return await self._home_call(args)

            # All remaining tools act on an entity that must be exposed.
            if name == "add_todo":
                eid = args["list"]
            else:
                eid = args.get("entity_id", "")
            if not self._allowed(eid):
                return {
                    "ok": False,
                    "error_kind": "denied",
                    "error": f"'{eid}' is not exposed to PodVoice (add it in Settings).",
                }

            if name == "turn_on":
                changed = await self.call_service("homeassistant", "turn_on", {"entity_id": eid})
            elif name == "turn_off":
                changed = await self.call_service("homeassistant", "turn_off", {"entity_id": eid})
            elif name == "set_light":
                data = {"entity_id": eid}
                if "brightness_pct" in args:
                    data["brightness_pct"] = args["brightness_pct"]
                if "color_name" in args:
                    data["color_name"] = args["color_name"]
                changed = await self.call_service("light", "turn_on", data)
            elif name == "activate_scene":
                changed = await self.call_service("scene", "turn_on", {"entity_id": eid})
            elif name == "set_temperature":
                changed = await self.call_service(
                    "climate",
                    "set_temperature",
                    {"entity_id": eid, "temperature": args["temperature"]},
                )
            elif name == "cover_control":
                svc = _COVER_ACTIONS.get(args.get("action", ""))
                if not svc:
                    return {
                        "ok": False,
                        "error_kind": "bad_args",
                        "error": f"unknown cover action {args.get('action')}",
                    }
                changed = await self.call_service("cover", svc, {"entity_id": eid})
            elif name == "add_todo":
                changed = await self.call_service(
                    "todo", "add_item", {"entity_id": eid, "item": args["item"]}
                )
            else:
                return {"ok": False, "error_kind": "bad_args", "error": f"unknown tool {name}"}
        except Exception as e:  # broad on purpose - never leave the model waiting
            result = self._error_result(e)
            if result.get("status") == 404:  # service/entity gone -> catalog may be stale
                self._services_cache = None
            return result
        # Uniform success contract (same shape as home_call): the model reads 'summary'.
        return {"ok": True, "summary": "Done.", "data": {"changed": changed}}
