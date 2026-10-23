"""Authenticated explicit passive weather generation over server-owned evidence."""

from __future__ import annotations

import copy

from aiohttp import web

from . import podview_weather
from .podview_weather_advice import closed_json, source_body


def capability(bridge, room, weather):
    owner = getattr(bridge.tools, "podview_weather_advice", None)
    result = {
        "schema": "podview.weather-advice-capability.v1",
        "bootId": bridge.boot_id,
        "roomId": room,
        "weatherKey": None,
        "source": None,
        "sourceRetrievedAt": None,
        "validUntil": None,
        "availability": "unavailable",
        "status": "unavailable",
    }
    if owner is None:
        return result
    try:
        binding, _ = owner.binding(bridge.boot_id, room, weather)
        result.update(binding)
        wire = owner.request(bridge.boot_id, room, weather, current=lambda: True)
        can_start = owner.provider.available
        # A durable debit closes NEXT-generation admission, not the exact
        # already-admitted task's pending/ready read capability.
        retained = wire["requestId"] is not None and wire["status"] in {"pending", "ready"}
        result["status"] = "idle" if wire["requestId"] is None and can_start else wire["status"]
        result["availability"] = "available" if can_start or retained else "unavailable"
    except (ValueError, TypeError, KeyError):
        pass
    return result


async def weather_advice(request):
    from .podview import BRIDGE, _error, _guard, _room

    denied = await _guard(request)
    if denied is not None:
        return denied
    bridge = request.app[BRIDGE]
    room = _room(request, bridge)
    if room is None:
        return _error("room_required")
    if request.content_length is None or request.content_length > 1024:
        return _error("invalid_weather_request")
    try:
        body = closed_json(await request.read())
        if not isinstance(body, dict) or set(body) != {"bootId", "roomId", "weatherKey"}:
            raise ValueError("body")
        if any(not isinstance(body[k], str) for k in body):
            raise ValueError("body")
    except (ValueError, TypeError):
        return _error("invalid_weather_request")
    tools, boot = bridge.tools, bridge.boot_id
    owner = getattr(tools, "podview_weather_advice", None)
    cached = bridge._home_cache.get(room)
    if owner is None or cached is None:
        return _error("weather_advice_unavailable", 503)
    weather = copy.deepcopy(cached[2].get("weather"))
    binding = tools.podview_weather_binding()
    advice_owner = owner
    provider = advice_owner.provider
    provider_binding = (
        (provider._key, provider.model, provider.allowance, provider.budget)
        if hasattr(provider, "_key")
        else None
    )
    session = bridge.sessions.get(room)
    try:
        evidence, _ = owner.binding(boot, room, weather)
    except (ValueError, TypeError, KeyError):
        return _error("weather_advice_unavailable", 503)
    if body != {k: evidence[k] for k in ("bootId", "roomId", "weatherKey")}:
        return _error("stale_weather_binding", 409)

    def current():
        fresh = bridge._home_cache.get(room)
        return bool(
            bridge.tools is tools
            and bridge.boot_id == boot
            and bridge.sessions.get(room) is session
            and session is not None
            and getattr(tools, "podview_weather_advice", None) is owner
            and advice_owner.provider is provider
            and (
                provider_binding is None
                or provider_binding
                == (provider._key, provider.model, provider.allowance, provider.budget)
            )
            and tools.podview_weather_binding() == binding
            and tools.podview_weather_available()
            and fresh is not None
            and podview_weather.observation_is_current(fresh[2].get("weather"))
            and source_body(fresh[2]["weather"]["data"]) == source_body(weather["data"])
        )

    if not current():
        owner.invalidate(room)
        return _error("stale_weather_binding", 409)
    value = owner.request(boot, room, weather, current=current, start=True)
    # Invalidate only presentation cache, not evidence. GET refresh remains unpaid.
    bridge._home_cache[room] = (0, cached[1], cached[2])
    return web.json_response(value, headers={"Cache-Control": "no-store"})
