"""Robot and Bil on the panel, pushed: ``podvoice/robot_subscribe`` and ``podvoice/vehicle_subscribe``.

They replace the page's polls of ``podvoice.robot_panel_state`` (every 30 s, 5 s while cleaning) and
``podvoice.vehicle_panel_state`` (every 30 s), which HA recorded as service calls on the Green's slow eMMC. While at
least one panel is subscribed, the same read as the service (robot_vehicle_control.py) is made when one of the
watched entities changes (the vacuum and its sensors; the car's roles), debounced, and once a minute (a reading's
age changes without an event); the result is pushed only when it changed. Listening to HA's state events and
pushing over the websocket write nothing to the recorder. Any signed-in, active HA user may subscribe, as to the
services.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant, callback

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry

_LOGGER = logging.getLogger(__name__)
READS_KEY = "podvoice_panel_reads"
_WATCH_KEY = "podvoice_panel_watch"
_REGISTERED_KEY = "podvoice_panel_live_registered"
DEBOUNCE_S = 0.4
REFRESH_S = 60.0
EVENT_ENTITY_REGISTRY_UPDATED = "entity_registry_updated"

Read = Callable[[], Awaitable[dict]]
Watched = Callable[[], set[str]]


class PanelWatch:
    """One reader while anyone is subscribed; the last state for a new subscriber."""

    def __init__(self, hass: HomeAssistant, read: Read, watched: Watched) -> None:
        self.hass = hass
        self._read = read
        self._watched = watched
        self.listeners: list[Callable[[dict], None]] = []
        self.last: dict | None = None
        self.entities: set[str] = set()
        self._unlisten: list[Callable[[], None]] = []
        self._timer: asyncio.TimerHandle | None = None
        self._task: asyncio.Task | None = None
        self._again = False
        self.reads: tuple | None = None

    def add(self, listener: Callable[[dict], None]) -> Callable[[], None]:
        self.listeners.append(listener)
        if self.last is not None:
            listener(self.last)
        if not self._unlisten:
            bus = self.hass.bus
            self._unlisten = [
                bus.async_listen(EVENT_STATE_CHANGED, self._state_changed),
                bus.async_listen(EVENT_ENTITY_REGISTRY_UPDATED, self._registry_changed),
            ]
            self.refresh()

        def remove() -> None:
            if listener in self.listeners:
                self.listeners.remove(listener)
            if not self.listeners:
                self.stop()

        return remove

    def stop(self) -> None:
        for unlisten in self._unlisten:
            unlisten()
        self._unlisten = []
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        if self._task is not None:
            self._task.cancel()
            self._task = None
        self.last = None

    @callback
    def _state_changed(self, event: Event) -> None:
        if event.data.get("entity_id") in self.entities:
            self._schedule(DEBOUNCE_S)

    @callback
    def _registry_changed(self, _event: Event) -> None:
        self._schedule(DEBOUNCE_S)

    def _schedule(self, delay: float) -> None:
        if not self.listeners:
            return
        if self._timer is not None:
            if delay >= REFRESH_S:
                return  # An earlier read is already planned.
            self._timer.cancel()
        self._timer = self.hass.loop.call_later(delay, self.refresh)

    @callback
    def refresh(self) -> None:
        self._timer = None
        if not self.listeners:
            return
        if self._task is not None and not self._task.done():
            self._again = (
                True  # One more read when this one ends: the change may be newer than its read.
            )
            return
        self._task = self.hass.async_create_background_task(self._run(), "podvoice panel live")

    async def _run(self) -> None:
        try:
            state = await self._read()
            self.entities = self._watched()
        except Exception:  # A failed read keeps the last state; the next change reads again.
            _LOGGER.debug("PodView panel live read failed", exc_info=True)
            state = None
        if state is not None and state != self.last and self.listeners:
            self.last = state
            for listener in list(self.listeners):
                listener(state)
        if self._again:
            self._again = False
            self._schedule(0)
        else:
            self._schedule(REFRESH_S)


def watch(hass: HomeAssistant, kind: str) -> PanelWatch | None:
    """The running watch for one kind; rebuilt when an entry setup registered new reads (robot_vehicle_control)."""
    reads = hass.data.get(READS_KEY, {}).get(kind)
    if reads is None:
        return None
    held = hass.data.setdefault(_WATCH_KEY, {})
    current = held.get(kind)
    if current is None or current.reads is not reads:
        if current is not None:
            current.stop()
        current = held[kind] = PanelWatch(hass, *reads)
        current.reads = reads
    return current


def _subscribe(kind: str) -> Callable[[HomeAssistant, Any, dict], None]:
    @callback
    def handler(hass: HomeAssistant, connection: Any, msg: dict) -> None:
        user = getattr(connection, "user", None)
        if user is None or not user.is_active:
            connection.send_error(
                msg["id"], websocket_api.ERR_UNAUTHORIZED, "Signed-in user required"
            )
            return
        held = watch(hass, kind)
        if held is None:
            connection.send_error(
                msg["id"], websocket_api.ERR_NOT_FOUND, "PodVoice panel not ready"
            )
            return
        msg_id = msg["id"]
        state = {"active": True}

        @callback
        def send(pushed: dict) -> None:
            if state["active"]:
                connection.send_message(websocket_api.event_message(msg_id, pushed))

        connection.send_result(msg_id)
        remove = held.add(send)

        @callback
        def stop() -> None:
            state["active"] = False
            remove()

        connection.subscriptions[msg_id] = stop

    return handler


ws_robot_subscribe = websocket_api.websocket_command(
    {vol.Required("type"): "podvoice/robot_subscribe"}
)(_subscribe("robot"))
ws_vehicle_subscribe = websocket_api.websocket_command(
    {vol.Required("type"): "podvoice/vehicle_subscribe"}
)(_subscribe("vehicle"))


async def async_setup_services(hass: HomeAssistant, entry: ConfigEntry) -> list[str]:
    """Register the websocket commands once per HA run (they outlive an entry reload); no services."""
    if not hass.data.get(_REGISTERED_KEY):
        hass.data[_REGISTERED_KEY] = True
        for command in (ws_robot_subscribe, ws_vehicle_subscribe):
            websocket_api.async_register_command(hass, command)
    return []
