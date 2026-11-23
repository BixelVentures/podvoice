"""Websocket commands the PodView panel uses as an ordinary (non-admin) HA user.

Timers are read and pushed from the native timer bridge; the panel reports its own
errors into the HA log (rate limited) and sends a heartbeat the wall-screen sensor shows.
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Callable
from datetime import datetime
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.util import dt as dt_util

DOMAIN = "podvoice"
_REGISTERED_KEY = "podvoice_panel_ws_registered"
_HEALTH_KEY = "podvoice_panel_health"
_REPORTS_KEY = "podvoice_panel_reports"
# Panel reports go to the same logger as the panel registration.
_PANEL_LOGGER = logging.getLogger(f"{__package__}.panel")
REPORT_KINDS = ("error", "unhandledrejection", "boundary", "remount", "frames", "load")
REPORTS_PER_MINUTE = 10
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]+")


def utcnow() -> datetime:
    """Module-level clock, so tests can move time for the heartbeat sensor."""
    return dt_util.utcnow()


def monotonic() -> float:
    """Module-level clock, so tests can refill the report rate limit."""
    return time.monotonic()


def _clip(limit: int) -> Callable[[Any], str]:
    """Accept any string and keep at most ``limit`` characters (a report is never refused)."""

    def validate(value: Any) -> str:
        if not isinstance(value, str):
            raise vol.Invalid("expected a string")
        return value[:limit]

    return validate


def _clean(value: str | None, limit: int) -> str:
    return _CONTROL.sub(" ", value or "").strip()[:limit]


class PanelHealth:
    """Last heartbeat from the wall panel and the bundle the integration serves."""

    def __init__(self) -> None:
        self.last_heartbeat: datetime | None = None
        self.bundle: str | None = None
        self.uptime_s: int | None = None
        self.room: str | None = None
        self.screen: str | None = None
        self.expected_bundle: str | None = None
        self._listeners: list[Callable[[], None]] = []

    @property
    def stale(self) -> bool:
        return self.is_stale(self.bundle)

    def is_stale(self, bundle: str | None) -> bool:
        # Without a served bundle a reload cannot help, so nothing is called stale.
        return bundle is not None and self.expected_bundle is not None and (
            bundle != self.expected_bundle
        )

    def listen(self, listener: Callable[[], None]) -> Callable[[], None]:
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener) if listener in self._listeners else None

    def _changed(self) -> None:
        for listener in list(self._listeners):
            listener()

    def set_expected_bundle(self, bundle: str | None) -> None:
        if bundle != self.expected_bundle:
            self.expected_bundle = bundle
            self._changed()

    def heartbeat(self, bundle: str, uptime_s: int, room: str | None, screen: str | None) -> None:
        self.last_heartbeat = utcnow()
        self.bundle, self.uptime_s, self.room, self.screen = bundle, uptime_s, room, screen
        self._changed()


def panel_health(hass: HomeAssistant) -> PanelHealth:
    """One store per HA run: it outlives an entry reload, like the websocket commands."""
    health = hass.data.get(_HEALTH_KEY)
    if health is None:
        health = hass.data[_HEALTH_KEY] = PanelHealth()
    return health


def _bridge(hass: HomeAssistant) -> Any:
    bridge = hass.data.get(DOMAIN)
    return bridge if callable(getattr(bridge, "snapshot", None)) else None


@callback
def async_register_panel_websocket(hass: HomeAssistant) -> None:
    """Register the commands once per HA run; handlers find the current bridge per call."""
    if hass.data.get(_REGISTERED_KEY):
        return
    hass.data[_REGISTERED_KEY] = True
    panel_health(hass)
    for command in (ws_timer_read, ws_timer_subscribe, ws_panel_report, ws_panel_heartbeat):
        websocket_api.async_register_command(hass, command)


ENDPOINT = vol.All(str, vol.Length(min=1, max=80))


@websocket_api.websocket_command(
    {vol.Required("type"): "podvoice/timer_read", vol.Required("endpoint"): ENDPOINT}
)
@callback
def ws_timer_read(hass: HomeAssistant, connection: Any, msg: dict) -> None:
    bridge = _bridge(hass)
    if bridge is None:
        connection.send_result(msg["id"], {"ok": False, "error": "endpoint_unavailable"})
        return
    connection.send_result(msg["id"], bridge.snapshot(msg["endpoint"]))


@websocket_api.websocket_command(
    {vol.Required("type"): "podvoice/timer_subscribe", vol.Required("endpoint"): ENDPOINT}
)
@callback
def ws_timer_subscribe(hass: HomeAssistant, connection: Any, msg: dict) -> None:
    bridge, endpoint, msg_id = _bridge(hass), msg["endpoint"], msg["id"]
    if bridge is None or endpoint not in getattr(bridge, "devices", {}):
        connection.send_error(msg_id, websocket_api.ERR_NOT_FOUND, "Timer endpoint unavailable")
        return
    state = {"active": True, "pending": False}

    @callback
    def send() -> None:
        state["pending"] = False
        if state["active"]:
            connection.send_message(websocket_api.event_message(msg_id, bridge.snapshot(endpoint)))

    @callback
    def changed(_endpoint: str) -> None:
        # Coalesce: one snapshot per loop iteration however many events arrived.
        if state["active"] and not state["pending"]:
            state["pending"] = True
            hass.loop.call_soon(send)

    unsubscribe = bridge.subscribe(endpoint, changed)

    @callback
    def stop() -> None:
        state["active"] = False
        unsubscribe()

    connection.subscriptions[msg_id] = stop
    connection.send_result(msg_id)
    connection.send_message(websocket_api.event_message(msg_id, bridge.snapshot(endpoint)))


class _ReportLimit:
    """Token bucket for panel reports, global for the HA run."""

    def __init__(self) -> None:
        self.tokens = float(REPORTS_PER_MINUTE)
        self.updated = monotonic()
        self.suppressed = 0

    def take(self) -> bool:
        now = monotonic()
        rate = REPORTS_PER_MINUTE / 60
        self.tokens = min(REPORTS_PER_MINUTE, self.tokens + (now - self.updated) * rate)
        self.updated = now
        if self.tokens < 1:
            self.suppressed += 1
            return False
        self.tokens -= 1
        return True


@websocket_api.websocket_command(
    {
        vol.Required("type"): "podvoice/panel_report",
        vol.Required("kind"): vol.In(REPORT_KINDS),
        vol.Required("message"): _clip(500),
        vol.Optional("detail"): vol.Any(None, _clip(2000)),
        vol.Optional("bundle"): vol.Any(None, _clip(64)),
        vol.Optional("room"): vol.Any(None, _clip(128)),
    }
)
@callback
def ws_panel_report(hass: HomeAssistant, connection: Any, msg: dict) -> None:
    limit = hass.data.get(_REPORTS_KEY)
    if limit is None:
        limit = hass.data[_REPORTS_KEY] = _ReportLimit()
    if not limit.take():
        connection.send_result(msg["id"], {"logged": False})
        return
    level = logging.INFO if msg["kind"] == "frames" else logging.WARNING
    if limit.suppressed:
        _PANEL_LOGGER.warning("%d PodView reports suppressed", limit.suppressed)
        limit.suppressed = 0
    detail = _clean(msg.get("detail"), 2000)
    _PANEL_LOGGER.log(
        level,
        "PodView %s (bundle %s, room %s): %s%s",
        msg["kind"],
        _clean(msg.get("bundle"), 64) or "-",
        _clean(msg.get("room"), 128) or "-",
        _clean(msg["message"], 500),
        f" | {detail}" if detail else "",
    )
    connection.send_result(msg["id"], {"logged": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "podvoice/panel_heartbeat",
        vol.Required("bundle"): vol.All(str, vol.Length(max=64)),
        vol.Required("uptime_s"): vol.All(vol.Coerce(int), vol.Range(min=0, max=100_000_000)),
        vol.Optional("room"): vol.Any(None, vol.All(str, vol.Length(max=128))),
        vol.Optional("screen"): vol.Any(None, vol.All(str, vol.Length(max=32))),
    }
)
@callback
def ws_panel_heartbeat(hass: HomeAssistant, connection: Any, msg: dict) -> None:
    health = panel_health(hass)
    health.heartbeat(
        _clean(msg["bundle"], 64),
        msg["uptime_s"],
        _clean(msg.get("room"), 128) or None,
        _clean(msg.get("screen"), 32) or None,
    )
    connection.send_result(
        msg["id"], {"expected_bundle": health.expected_bundle, "stale": health.stale}
    )
