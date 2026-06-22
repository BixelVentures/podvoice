"""Tool bridge: model function-calls -> Home Assistant services.

Surfaces:
- **Home control** — a curated, *allowlisted* set of tools (lights, switches,
  scenes, climate, covers, vacuum/etc via home_call, to-do). Only entities you
  expose (settings ``exposed``) can be controlled — like HA Assist's expose model.
- **Music** — ONE ``music`` tool that controls the room's PodConnect Control
  media_player (Spotify + speaker) through standard HA services. PodVoice does NOT
  speak PodConnect's own HTTP interface; its only PodConnect contact is the
  Attention duck (handled in the orchestrator, not here).

httpx-only; dispatch never raises (errors fold into ``{"ok": False}``) so the
model is never left waiting.
"""

from __future__ import annotations

import logging

import httpx

from . import constants as C

log = logging.getLogger(__name__)

_COVER_ACTIONS = {"open": "open_cover", "close": "close_cover", "stop": "stop_cover"}


def _first_playable(obj: object) -> dict | None:
    """First playable BrowseMedia in a search_media response (result[0], best match)."""
    if isinstance(obj, dict):
        if obj.get("media_content_id") and obj.get("can_play", True):
            return obj
        for v in obj.values():
            found = _first_playable(v)
            if found:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = _first_playable(v)
            if found:
                return found
    return None


# Music transport verbs -> HA media_player services (run on the Control entity).
_MUSIC_TRANSPORT = {
    "pause": "media_pause",
    "resume": "media_play",
    "stop": "media_stop",
    "next": "media_next_track",
    "previous": "media_previous_track",
}


class HAToolBridge:
    """Maps model tool calls onto Home Assistant services. Satisfies ToolBridgeLike.

    Music is exposed as ONE tool (``music``) that drives the room's PodConnect Control
    media_player via standard HA services — PodVoice never speaks PodConnect's own HTTP
    interface (that stays PodConnect's; PodVoice's only PodConnect contact is the
    Attention duck, handled elsewhere).
    """

    def __init__(
        self,
        supervisor_token: str,
        client: httpx.AsyncClient,
        *,
        exposed: list[str] | tuple[str, ...] = (),
        room_players: dict[str, str] | None = None,
    ) -> None:
        self._client = client
        self._has_ha = bool(supervisor_token)
        self._ha_headers = {
            "Authorization": f"Bearer {supervisor_token}",
            "Content-Type": "application/json",
        }
        self._exposed = [e.strip().lower() for e in exposed if e and e.strip()]
        # room name (lowered) -> HA Control media_player entity (the music target).
        self._room_players = {
            (k or "").strip().lower(): v.strip()
            for k, v in (room_players or {}).items()
            if v and v.strip()
        }

    # ------------------------------------------------------------------ allowlist
    def _allowed(self, entity_id: str | None) -> bool:
        eid = (entity_id or "").lower()
        if not eid or "." not in eid:
            return False
        # Configured room media_players are implicitly allowed (the user set them up).
        if eid in (p.lower() for p in self._room_players.values()):
            return True
        return eid in self._exposed or eid.split(".")[0] in self._exposed

    def _resolve_player(self, room: str | None, entity_id: str | None) -> str | None:
        """Pick the media_player for play_music: explicit id > named room > sole room."""
        if entity_id:
            return entity_id
        if room:
            eid = self._room_players.get(room.strip().lower())
            if eid:
                return eid
        if len(self._room_players) == 1:
            return next(iter(self._room_players.values()))
        return None

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
                    "domains you can control — use this to find advanced actions (e.g. a vacuum's "
                    "room/segment cleaning, fan speed, or mop/water mode), then call them with "
                    "home_call. Optionally pass a domain to narrow it.",
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
                    "name": "music",
                    "description": "THE single tool for music on the PodConnect speakers (Spotify). "
                    "Use it for everything: action='play' to search & start a song/artist/playlist "
                    "by name (query) or an exact uri; 'pause'/'resume'/'stop'; 'next'/'previous'; "
                    "'volume' (volume_pct 0-100). Targets the named room's speaker (or entity_id).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "action": {
                                "type": "string",
                                "enum": [
                                    "play",
                                    "pause",
                                    "resume",
                                    "stop",
                                    "next",
                                    "previous",
                                    "volume",
                                ],
                            },
                            "query": {
                                "type": "string",
                                "description": "play: song/artist/playlist",
                            },
                            "uri": {
                                "type": "string",
                                "description": "play: exact uri (skips search)",
                            },
                            "volume_pct": {"type": "integer", "description": "volume: 0-100"},
                            "room": {"type": "string", "description": "which speaker/room"},
                            "entity_id": {"type": "string", "description": "media_player override"},
                        },
                        "required": ["action"],
                    },
                },
                {
                    "name": "home_call",
                    "description": "Call ANY Home Assistant service on an allowed entity — for "
                    "devices beyond the tools above (vacuum, fan, lock, humidifier, …). "
                    "Examples: vacuum.start, vacuum.return_to_base, vacuum.set_fan_speed, "
                    "fan.set_percentage, lock.lock. Use list_home to find entity ids.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "domain": {"type": "string", "description": "e.g. vacuum, fan, lock"},
                            "service": {
                                "type": "string",
                                "description": "e.g. start, return_to_base",
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

    async def _music(self, args: dict) -> dict:
        """The single music tool: play/pause/resume/stop/next/previous/volume on ONE speaker.

        Everything runs through HA media_player services on the room's PodConnect Control
        entity. For ``play`` a free-text query is resolved via ``media_player.search_media``
        (Control's play_media wants a URI) — search-and-play plays result[0].
        """
        eid = self._resolve_player(args.get("room"), args.get("entity_id"))
        if not eid:
            return {
                "ok": False,
                "error": "No speaker for that room — set the room's media_player in Settings "
                "(or pass entity_id).",
            }
        if not self._allowed(eid):
            return {
                "ok": False,
                "error": f"'{eid}' is not exposed to PodVoice (add it in Settings).",
            }
        action = (args.get("action") or "").lower()
        if action == "play":
            uri = (args.get("uri") or "").strip()
            query = (args.get("query") or "").strip()
            if not uri and not query:
                return {"ok": False, "error": "music play needs a query (song/artist) or uri."}
            ctype = "music"
            if not uri:
                uri, ctype = await self._search_uri(eid, query)
                if not uri:
                    return {"ok": False, "error": f"No music matched '{query}'."}
            await self.call_service(
                "media_player",
                "play_media",
                {"entity_id": eid, "media_content_type": ctype, "media_content_id": uri},
            )
            return {"ok": True, "action": "play", "played": uri, "entity_id": eid}
        if action == "volume":
            vol = max(0, min(100, int(args.get("volume_pct", 0)))) / 100
            await self.call_service(
                "media_player", "volume_set", {"entity_id": eid, "volume_level": vol}
            )
            return {"ok": True, "action": "volume", "entity_id": eid}
        svc = _MUSIC_TRANSPORT.get(action)
        if not svc:
            return {"ok": False, "error": f"unknown music action {action!r}"}
        await self.call_service("media_player", svc, {"entity_id": eid})
        return {"ok": True, "action": action, "entity_id": eid}

    async def _search_uri(self, entity_id: str, query: str) -> tuple[str, str]:
        """Resolve a free-text query to (uri, media_type) via media_player.search_media."""
        url = f"{C.SUPERVISOR_CORE_API}/services/media_player/search_media?return_response"
        r = await self._client.post(
            url, json={"entity_id": entity_id, "search_query": query}, headers=self._ha_headers
        )
        r.raise_for_status()
        item = _first_playable(r.json())
        if not item:
            return "", "music"
        return item.get("media_content_id") or "", item.get("media_content_type") or "music"

    # ------------------------------------------------------------------ dispatch
    async def dispatch(self, name: str, args: dict) -> dict:
        try:
            if name == "list_home":
                return await self._list_home()
            if name == "list_services":
                return await self._list_services(args.get("domain"))
            if name == "music":
                return await self._music(args)

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
