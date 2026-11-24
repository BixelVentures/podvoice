"""Radio on the panel, pushed: PodConnect Speakers' radio state over HA's websocket.

``podvoice/radio_subscribe`` (any signed-in HA user, also non-admin) replaces the page's 5 s
``podvoice.radio_state`` poll, which HA recorded as a service call on the Green's slow eMMC. While at least one
panel is subscribed, this module reads Speakers' radio API (music_bridge.Radio, the same read as radio_state) every
5 s, at once after a radio command (``poke``) and when a PodConnect speaker starts or stops playing, and pushes the
state only when it changed. The read is a plain HTTP read from HA Core to Speakers: nothing goes to HA's state
machine, the event bus or the recorder.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant, callback

from . import music_bridge

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry

_KEY = "podvoice_radio_live"
_REGISTERED_KEY = "podvoice_radio_live_registered"
INTERVAL_S = 5.0


class RadioWatch:
    """One reader while anyone is subscribed; the last state for a new subscriber."""

    def __init__(self, hass: HomeAssistant, read: Callable[[], Any] | None = None) -> None:
        self.hass = hass
        self._read = read or music_bridge.Radio(hass).state
        self.listeners: list[Callable[[dict], None]] = []
        self.last: dict | None = None
        self._task: asyncio.Task | None = None
        self._wake = asyncio.Event()
        self._unlisten: Callable[[], None] | None = None

    def add(self, listener: Callable[[dict], None]) -> Callable[[], None]:
        self.listeners.append(listener)
        if self.last is not None:
            listener(self.last)
        if self._task is None:
            self._unlisten = self.hass.bus.async_listen(EVENT_STATE_CHANGED, self._speaker_changed)
            self._task = self.hass.async_create_background_task(self._run(), "podvoice radio live")

        def remove() -> None:
            if listener in self.listeners:
                self.listeners.remove(listener)
            if not self.listeners:
                self.stop()

        return remove

    def stop(self) -> None:
        if self._unlisten is not None:
            self._unlisten()
            self._unlisten = None
        if self._task is not None:
            self._task.cancel()
            self._task = None
        self.last = None

    @callback
    def poke(self) -> None:
        self._wake.set()

    @callback
    def _speaker_changed(self, event: Event) -> None:
        entity_id = event.data.get("entity_id", "")
        if not entity_id.startswith("media_player."):
            return
        old, new = event.data.get("old_state"), event.data.get("new_state")

        def playing_radio(state: Any) -> bool:
            return (
                state is not None
                and state.state == "playing"
                and state.attributes.get("podconnect_source") == "radio"
            )

        if playing_radio(old) != playing_radio(new):
            self._wake.set()

    async def _run(self) -> None:
        while self.listeners:
            self._wake.clear()
            state = await self._read()
            if state != self.last and self.listeners:
                self.last = state
                for listener in list(self.listeners):
                    listener(state)
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=INTERVAL_S)


def watch(hass: HomeAssistant) -> RadioWatch:
    held = hass.data.get(_KEY)
    if held is None:
        held = hass.data[_KEY] = RadioWatch(hass)
    return held


@callback
def poke(hass: HomeAssistant) -> None:
    """A radio command was sent: read the radio again now (only while a panel is subscribed)."""
    held = hass.data.get(_KEY)
    if held is not None:
        held.poke()


@websocket_api.websocket_command({vol.Required("type"): "podvoice/radio_subscribe"})
@callback
def ws_radio_subscribe(hass: HomeAssistant, connection: Any, msg: dict) -> None:
    user = getattr(connection, "user", None)
    if user is None or not user.is_active:
        connection.send_error(msg["id"], websocket_api.ERR_UNAUTHORIZED, "Signed-in user required")
        return
    msg_id = msg["id"]
    state = {"active": True}

    @callback
    def send(pushed: dict) -> None:
        if state["active"]:
            connection.send_message(websocket_api.event_message(msg_id, pushed))

    connection.send_result(msg_id)
    remove = watch(hass).add(send)

    @callback
    def stop() -> None:
        state["active"] = False
        remove()

    connection.subscriptions[msg_id] = stop


async def async_setup_services(hass: HomeAssistant, entry: ConfigEntry) -> list[str]:
    """Register the websocket command once per HA run (it outlives an entry reload); no services."""
    if not hass.data.get(_REGISTERED_KEY):
        hass.data[_REGISTERED_KEY] = True
        websocket_api.async_register_command(hass, ws_radio_subscribe)
    return []
