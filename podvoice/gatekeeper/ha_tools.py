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

import json
import logging

import httpx

from . import constants as C

log = logging.getLogger(__name__)

_COVER_ACTIONS = {"open": "open_cover", "close": "close_cover", "stop": "stop_cover"}


def _field_info(f: dict) -> dict:
    """Compact field hint for list_services: description + select values (if any).

    Surfaces a service field's valid inputs so the model calls it correctly — e.g.
    podconnect.play_from_library.source = liked | top_tracks | recent.
    """
    out: dict = {}
    if isinstance(f, dict):
        desc = f.get("description")
        if desc:
            out["description"] = desc
        opts = ((f.get("selector") or {}).get("select") or {}).get("options")
        if opts:
            out["values"] = [o.get("value", o) if isinstance(o, dict) else o for o in opts]
    return out


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
    ) -> None:
        self._client = client
        self._has_ha = bool(supervisor_token)
        self._ha_headers = {
            "Authorization": f"Bearer {supervisor_token}",
            "Content-Type": "application/json",
        }
        self._exposed = [e.strip().lower() for e in exposed if e and e.strip()]

    # ------------------------------------------------------------------ allowlist
    def _allowed(self, entity_id: str | None) -> bool:
        eid = (entity_id or "").lower()
        if not eid or "." not in eid:
            return False
        return eid in self._exposed or eid.split(".")[0] in self._exposed

    # ------------------------------------------------------------------ declarations
    def declarations(self) -> list[dict]:
        decls: list[dict] = []
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
                    "domains you can control — use this to find any action (e.g. a media_player's "
                    "play_media/search_media, a vacuum's room/segment cleaning, fan speed), then "
                    "run them with home_call. A service with returns_response:true gives data back "
                    "(e.g. listening history) — call it via home_call with return_response:true. "
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
                    "description": "Call ANY Home Assistant service — for anything beyond the tools "
                    "above: music/speakers (media_player.play_media, search_media, media_pause, "
                    "volume_set), a vacuum, fan, lock, … OR a data service that RETURNS info "
                    "(set return_response=true), e.g. media_player.search_media or a listening-"
                    "history service. Pass entity_id for entity services; for account-level "
                    "services leave it out (the domain must be exposed). Use list_services to "
                    "find a domain's services + fields.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "domain": {
                                "type": "string",
                                "description": "e.g. media_player, vacuum, podconnect",
                            },
                            "service": {
                                "type": "string",
                                "description": "e.g. play_media, start, top_tracks",
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
        level services need the domain exposed. ``return_response`` reads data back."""
        domain, service = args.get("domain"), args.get("service")
        if not domain or not service:
            return {"ok": False, "error": "home_call needs domain + service."}
        data = dict(args.get("data") or {})
        eid = (args.get("entity_id") or "").strip()
        if eid:
            if not self._allowed(eid):
                return {"ok": False, "error": f"'{eid}' is not exposed (add it in Settings)."}
            data["entity_id"] = eid
        elif domain.lower() not in self._exposed:
            return {
                "ok": False,
                "error": f"domain '{domain}' is not exposed — add it in Settings to allow "
                "account-level calls without an entity_id.",
            }
        if args.get("return_response"):
            return {"ok": True, "response": await self.call_service_response(domain, service, data)}
        changed = await self.call_service(domain, service, data)
        return {"ok": True, "changed": changed}

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
        r = await self._client.get(f"{C.SUPERVISOR_CORE_API}/services", headers=self._ha_headers)
        r.raise_for_status()
        allowed = self._allowed_domains()
        out: dict = {}
        for entry in r.json():
            d = entry.get("domain")
            if d not in allowed or (domain and d != domain):
                continue
            out[d] = {
                svc: {
                    # name -> {description?, values?} so the model knows valid inputs
                    # (e.g. play_from_library.source = liked|top_tracks|recent).
                    "fields": {
                        name: _field_info(f) for name, f in (info.get("fields") or {}).items()
                    },
                    # HA marks data-returning services with a "response" block. Surfacing it
                    # tells the model to call home_call with return_response=true to read it
                    # (e.g. podconnect.top_tracks / recently_played).
                    "returns_response": bool(info.get("response")),
                }
                for svc, info in (entry.get("services") or {}).items()
            }
        return {"ok": True, "services": out}

    # ------------------------------------------------------------------ dispatch
    async def dispatch(self, name: str, args: dict) -> dict:
        try:
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
                    return {"ok": False, "error": f"unknown cover action {args.get('action')}"}
                changed = await self.call_service("cover", svc, {"entity_id": eid})
            elif name == "add_todo":
                changed = await self.call_service(
                    "todo", "add_item", {"entity_id": eid, "item": args["item"]}
                )
            else:
                return {"ok": False, "error": f"unknown tool {name}"}
        except Exception as e:  # broad on purpose - never leave the model waiting
            log.warning("tool %s failed: %s", name, e)
            return {"ok": False, "error": str(e)}
        return {"ok": True, "changed": changed}
