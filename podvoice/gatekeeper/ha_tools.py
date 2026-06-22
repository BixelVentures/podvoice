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

import logging

import httpx

from . import constants as C

log = logging.getLogger(__name__)

_COVER_ACTIONS = {"open": "open_cover", "close": "close_cover", "stop": "stop_cover"}


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
                    "run them with home_call. Optionally pass a domain to narrow it.",
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
                    "description": "Call ANY Home Assistant service on an allowed entity — for "
                    "anything beyond the tools above: music/speakers (media_player.play_media, "
                    "search_media, media_pause, volume_set), a vacuum, fan, lock, humidifier, … "
                    "Use list_home for entity ids and list_services for a domain's services/fields.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "domain": {
                                "type": "string",
                                "description": "e.g. media_player, vacuum",
                            },
                            "service": {
                                "type": "string",
                                "description": "e.g. play_media, start",
                            },
                            "entity_id": {"type": "string"},
                            "data": {
                                "type": "object",
                                "description": "extra service data (optional)",
                            },
                        },
                        "required": ["domain", "service", "entity_id"],
                    },
                },
            ]
        return decls

    # ------------------------------------------------------------------ HA helpers
    async def call_service(self, domain: str, service: str, data: dict) -> list:
        url = f"{C.SUPERVISOR_CORE_API}/services/{domain}/{service}"
        r = await self._client.post(url, json=data, headers=self._ha_headers)
        r.raise_for_status()
        return r.json()

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
                svc: {"fields": list((info.get("fields") or {}).keys())}
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
            elif name == "home_call":
                data = dict(args.get("data") or {})
                data["entity_id"] = eid
                changed = await self.call_service(args["domain"], args["service"], data)
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
