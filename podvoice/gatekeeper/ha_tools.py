"""Tool bridge: Gemini function-calls -> Home Assistant services (PLAN.md §6 PART B.6).

Gemini speaks function calls; this module owns the small typed surface and the
HTTP plumbing to the HA core via the supervisor proxy. It is httpx-only (no
ESPHome / google-genai), so it imports cleanly in the unit suite.

Dispatch never raises: a failed service call is folded into an ``{"ok": False}``
result so the model is never left waiting on a tool response.
"""

from __future__ import annotations

import logging

import httpx

from . import constants as C

log = logging.getLogger(__name__)


class HAToolBridge:
    """Maps Gemini tool calls onto HA service calls. Satisfies ``ToolBridgeLike``."""

    def __init__(self, token: str, client: httpx.AsyncClient) -> None:
        self._client = client
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    def declarations(self) -> list[dict]:
        """Gemini ``function_declarations`` for the supported tools."""
        return [
            {
                "name": "add_todo",
                "description": ("Add an item to a Home Assistant to-do / shopping list."),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "list": {
                            "type": "string",
                            "description": "The to-do list entity_id, e.g. todo.shopping_list.",
                        },
                        "item": {
                            "type": "string",
                            "description": "The item text to add to the list.",
                        },
                    },
                    "required": ["list", "item"],
                },
            },
            {
                "name": "turn_on_light",
                "description": "Turn on a Home Assistant light.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "entity_id": {
                            "type": "string",
                            "description": "The light entity_id, e.g. light.kitchen.",
                        },
                    },
                    "required": ["entity_id"],
                },
            },
            {
                "name": "turn_off_light",
                "description": "Turn off a Home Assistant light.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "entity_id": {
                            "type": "string",
                            "description": "The light entity_id, e.g. light.kitchen.",
                        },
                    },
                    "required": ["entity_id"],
                },
            },
        ]

    async def call_service(self, domain: str, service: str, data: dict) -> list:
        """POST a HA service call via the supervisor core proxy; return the JSON."""
        url = f"{C.SUPERVISOR_CORE_API}/services/{domain}/{service}"
        r = await self._client.post(url, json=data, headers=self._headers)
        r.raise_for_status()
        return r.json()

    async def dispatch(self, name: str, args: dict) -> dict:
        """Run one tool by name. Never raises — errors become ``{"ok": False}``."""
        try:
            if name == "add_todo":
                # field name is `item` (VERIFIED, see PLAN §6 B.6 / todo integration)
                changed = await self.call_service(
                    "todo",
                    "add_item",
                    {"entity_id": args["list"], "item": args["item"]},
                )
            elif name == "turn_on_light":
                changed = await self.call_service(
                    "light", "turn_on", {"entity_id": args["entity_id"]}
                )
            elif name == "turn_off_light":
                changed = await self.call_service(
                    "light", "turn_off", {"entity_id": args["entity_id"]}
                )
            else:
                return {"ok": False, "error": f"unknown tool {name}"}
        except Exception as e:  # broad on purpose - never leave Gemini waiting
            log.warning("tool %s failed: %s", name, e)
            return {"ok": False, "error": str(e)}
        return {"ok": True, "changed": changed}
