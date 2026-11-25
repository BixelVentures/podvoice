"""The passive AI weather advice, read and started by the PodVoice integration for the HA panel's Vejr screen.

``GET /view/api/weather-advice`` reads the advice for the add-on's current weather (never starts anything);
``POST`` with an empty JSON object starts it once for that weather (``WeatherAdviceOwner.request(start=True)``:
one paid request per weather binding, never replayed; a second POST for the same weather returns the same
record). Both answer on the PodView port for a loopback caller (Home Assistant Core on the host network, like the
answers read). The weather is the add-on's own bounded read of Home Assistant (``tools.podview_weather_read``),
so the browser never supplies source data and the owner binds the advice to it. Every answer is closed:
``{"ok": true, "status": idle|pending|ready|error|unavailable, "summary": str|null, "validUntil": float|null}``.
``unavailable`` without an OpenAI key, without a current weather read or without an owner; nothing is invented.
"""

from __future__ import annotations

import asyncio
import time

from aiohttp import web

STATUSES = {"idle", "pending", "ready", "error", "unavailable"}
READ_TIMEOUT_S = 8
# One weather read serves the reads that follow it (the panel asks again while the advice is pending).
WEATHER_REUSE_S = 60


def _answer(
    status: str, summary: str | None = None, valid_until: float | None = None
) -> web.Response:
    return web.json_response(
        {"ok": True, "status": status, "summary": summary, "validUntil": valid_until},
        headers={"Cache-Control": "no-store"},
    )


async def _weather(bridge, tools) -> dict | None:
    """The add-on's current weather, reused for a minute while its binding stands."""
    binding = tools.podview_weather_binding()
    cached = getattr(bridge, "_advice_weather", None)
    if (
        cached is not None
        and cached[1] == binding
        and time.monotonic() - cached[0] < WEATHER_REUSE_S
    ):
        return cached[2]
    try:
        weather = await asyncio.wait_for(tools.podview_weather_read(), READ_TIMEOUT_S)
    except Exception:  # No answer from Home Assistant: no advice, never a guess.
        return None
    if not isinstance(weather, dict) or weather.get("status") != "observed":
        return None
    bridge._advice_weather = (time.monotonic(), binding, weather)
    return weather


async def weather_advice_http(request: web.Request) -> web.Response:
    from .podview import BRIDGE, _error, _guard, _room

    denied = await _guard(request)
    if denied is not None:
        return denied
    bridge = request.app[BRIDGE]
    room = _room(request, bridge)
    if (
        room is None
        or set(request.query) - {"room"}
        or any(len(request.query.getall(key)) != 1 for key in request.query)
    ):
        return _error("unknown_room", 404)
    start = request.method == "POST"
    if start:
        if request.content_length is None or request.content_length > 64:
            return _error("invalid_weather_request", 400)
        if (await request.read()).strip() != b"{}":
            return _error("invalid_weather_request", 400)
    tools, boot = bridge.tools, bridge.boot_id
    owner = getattr(tools, "podview_weather_advice", None)
    if owner is None or not tools.podview_weather_available():
        return _answer("unavailable")
    weather = await _weather(bridge, tools)
    if weather is None:
        return _answer("unavailable")
    binding, session = tools.podview_weather_binding(), bridge.sessions.get(room)
    provider = owner.provider

    def current() -> bool:
        return bool(
            request.app[BRIDGE] is bridge
            and bridge.tools is tools
            and bridge.boot_id == boot
            and bridge.sessions.get(room) is session
            and getattr(tools, "podview_weather_advice", None) is owner
            and getattr(owner, "provider", None) is provider
            and tools.podview_weather_binding() == binding
            and tools.podview_weather_available()
        )

    try:
        wire = owner.request(boot, room, weather, current=current, start=start)
    except (ValueError, TypeError, KeyError):  # Weather too old, without facts or not current.
        return _answer("unavailable")
    status = wire.get("status")
    if wire.get("requestId") is None:
        # Nothing started for this weather yet: a read says whether a start could run.
        return _answer("idle" if not start and provider.available else "unavailable")
    if status not in STATUSES:
        return _answer("unavailable")
    if status != "ready":
        return _answer(status)
    return _answer("ready", wire.get("summary"), wire.get("validUntil"))
