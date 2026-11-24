"""The add-on's cleaning journal, read by the PodVoice integration for the HA panel's Robot screen.

``GET /view/api/robot-journal`` answers on the PodView port for a loopback caller (Home Assistant Core
on the host network, like the answers read): the owner receipts device_control.cleaning_history()
keeps (cleaning_journal.py), per vacuum, with the same display projection the wall page's home read
uses (podview._home_history). Read-only: an ID here never carries action authority, and nothing is
started, changed or retried. A journal that cannot be read is ``unavailable``, never empty.
"""

from __future__ import annotations

from aiohttp import web

SCHEMA = "podview.robot-journal.v1"


def project(history: object) -> dict:
    """The journal's records grouped by vacuum through the home read's own validation."""
    from .podview import _home_history

    unavailable = {"schema": SCHEMA, "status": "unavailable", "items": []}
    if not isinstance(history, dict) or history.get("status") != "observed":
        return unavailable
    rows = history.get("items")
    if not isinstance(rows, list) or len(rows) > 3:
        return unavailable
    items: list[dict] = []
    vacuums: list[str] = []
    for row in rows:
        recipe = row.get("recipe") if isinstance(row, dict) else None
        entity = recipe.get("vacuum_entity_id") if isinstance(recipe, dict) else None
        if not isinstance(entity, str):
            return unavailable
        if entity not in vacuums:
            vacuums.append(entity)
    for entity in vacuums:
        own = {
            **history,
            "items": [row for row in rows if row["recipe"]["vacuum_entity_id"] == entity],
        }
        projected = _home_history(own, entity)
        if projected["status"] != "observed":
            return unavailable
        items.extend({**item, "entityId": entity} for item in projected["items"])
    return {"schema": SCHEMA, "status": "observed", "items": items}


async def robot_journal_http(request: web.Request) -> web.Response:
    from .podview import BRIDGE, _error, _guard

    denied = await _guard(request)
    if denied is not None:
        return denied
    if request.query:
        return _error("unknown_query", 400)
    owner = getattr(request.app[BRIDGE].tools, "_device_control", None)
    try:
        history = owner.cleaning_history() if owner is not None else None
    except Exception:  # A disabled or changed owner is an unavailable journal, never an empty one.
        history = None
    return web.json_response(project(history), headers={"Cache-Control": "no-store"})
