"""Tool bridge: model function-calls -> Home Assistant services + PodConnect API.

Two surfaces:
- **Home Assistant** — a curated, *allowlisted* set of tools (lights, switches,
  scenes, climate, covers, media transport/volume, to-do). Only entities you
  expose (settings ``exposed``) can be controlled — like HA Assist's expose model.
- **PodConnect** — a single GENERIC passthrough (``podconnect``) to PodConnect's
  HTTP API, so every current and future feature is reachable without hardcoding.

httpx-only; dispatch never raises (errors fold into ``{"ok": False}``) so the
model is never left waiting.
"""

from __future__ import annotations

import logging

import httpx

from . import constants as C

log = logging.getLogger(__name__)

_MEDIA_ACTIONS = {
    "play": "media_play",
    "pause": "media_pause",
    "stop": "media_stop",
    "next": "media_next_track",
    "previous": "media_previous_track",
    "volume_up": "volume_up",
    "volume_down": "volume_down",
}
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


# Documented PodConnect endpoints (the passthrough still allows any path — future-proof).
# IMPORTANT: PodConnect is the LOCAL transport/volume/duck engine only. It CANNOT search for
# or start a specific song — /api/play merely RESUMES whatever was last loaded. To play a
# specific artist/song/playlist, use the `play_music` tool (Home Assistant Web API) instead.
_PODCONNECT_HELP = (
    "Control music TRANSPORT & VOLUME on the local PodConnect engine. Call GET endpoints first "
    "to learn current state and room ids. Known endpoints: GET /api/state; GET /api/rooms; "
    "POST /api/stop?room=<id> (stop/pause); PUT /api/volume {volume:0-100, room?} (set volume); "
    "POST /api/release?room=<id>; GET /api/outputs, POST /api/outputs/set; GET /api/discover. "
    "POST /api/play only RESUMES the last track on a room — it does NOT accept a song/query and "
    "must NOT be used to choose what to play. To play a specific song/artist/playlist, use the "
    "`play_music` tool, NOT this. Any other path also works for transport/state."
)


class HAToolBridge:
    """Maps model tool calls onto HA services + PodConnect. Satisfies ToolBridgeLike."""

    def __init__(
        self,
        supervisor_token: str,
        client: httpx.AsyncClient,
        *,
        podconnect_base_url: str = "",
        podconnect_token: str = "",
        exposed: list[str] | tuple[str, ...] = (),
        room_players: dict[str, str] | None = None,
    ) -> None:
        self._client = client
        self._has_ha = bool(supervisor_token)
        self._ha_headers = {
            "Authorization": f"Bearer {supervisor_token}",
            "Content-Type": "application/json",
        }
        self._pc_base = (podconnect_base_url or "").rstrip("/")
        self._pc_headers = {"X-PodConnect-Token": podconnect_token} if podconnect_token else {}
        self._exposed = [e.strip().lower() for e in exposed if e and e.strip()]
        # room name (lowered) -> HA Control media_player entity for play-by-query.
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
                {
                    "name": "media_control",
                    "description": "Control a media player.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "entity_id": {"type": "string"},
                            "action": {"type": "string", "enum": list(_MEDIA_ACTIONS)},
                        },
                        "required": ["entity_id", "action"],
                    },
                },
                {
                    "name": "set_volume",
                    "description": "Set a media player's volume (0-100).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "entity_id": {"type": "string"},
                            "volume_pct": {"type": "integer"},
                        },
                        "required": ["entity_id", "volume_pct"],
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
                    "name": "play_music",
                    "description": "Play a specific song/artist/playlist on ONE speaker, by name. "
                    "Searches the PodConnect Control Web API and plays the best match — use it for "
                    "ALL 'play X' requests, NOT the podconnect tool. Targets the named room's "
                    "speaker (or pass entity_id). You may pass an exact 'uri' (e.g. "
                    "spotify:track:...) to skip the search.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "e.g. 'Dua Lipa'"},
                            "room": {"type": "string", "description": "room name (which speaker)"},
                            "entity_id": {"type": "string", "description": "media_player override"},
                            "uri": {"type": "string", "description": "optional exact media URI"},
                        },
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
        if self._pc_base:
            decls.append(
                {
                    "name": "podconnect",
                    "description": _PODCONNECT_HELP,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "method": {"type": "string", "enum": ["GET", "POST", "PUT", "DELETE"]},
                            "path": {"type": "string", "description": "e.g. /api/play"},
                            "body": {"type": "object", "description": "JSON body (optional)"},
                        },
                        "required": ["method", "path"],
                    },
                }
            )
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

    async def _play_music(self, args: dict) -> dict:
        """Play a song/artist/uri on ONE speaker via HA's Web API (NOT PodConnect).

        Content selection lives in the PodConnect Control HACS integration. Its
        ``media_player.play_media`` wants a Spotify URI, so a free-text query is first
        resolved through ``media_player.search_media`` (search-and-play: play result[0]).
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
        uri = (args.get("uri") or "").strip()
        query = (args.get("query") or "").strip()
        if not uri and not query:
            return {"ok": False, "error": "play_music needs a query (song/artist) or uri."}
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
        return {"ok": True, "played": uri, "query": query or None, "entity_id": eid}

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

    async def _pc_call(self, method: str, path: str, body: dict | None) -> dict:
        if not self._pc_base:
            return {"ok": False, "error": "PodConnect not configured"}
        p = path if path.startswith("/") else "/" + path
        r = await self._client.request(
            method.upper(), self._pc_base + p, json=body or None, headers=self._pc_headers
        )
        r.raise_for_status()
        try:
            return {"ok": True, "result": r.json()}
        except ValueError:
            return {"ok": True, "result": r.text[:800]}

    # ------------------------------------------------------------------ dispatch
    async def dispatch(self, name: str, args: dict) -> dict:
        try:
            if name == "podconnect":
                return await self._pc_call(args["method"], args["path"], args.get("body"))
            if name == "list_home":
                return await self._list_home()
            if name == "list_services":
                return await self._list_services(args.get("domain"))
            if name == "play_music":
                return await self._play_music(args)

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
            elif name == "media_control":
                svc = _MEDIA_ACTIONS.get(args.get("action", ""))
                if not svc:
                    return {"ok": False, "error": f"unknown media action {args.get('action')}"}
                changed = await self.call_service("media_player", svc, {"entity_id": eid})
            elif name == "set_volume":
                vol = max(0, min(100, int(args["volume_pct"]))) / 100
                changed = await self.call_service(
                    "media_player", "volume_set", {"entity_id": eid, "volume_level": vol}
                )
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
