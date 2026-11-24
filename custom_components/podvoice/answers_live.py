"""Svar on the panel, pushed: the live answer while GPT-Live speaks and the saved answers, over HA's websocket.

``podvoice/answers_subscribe`` (any signed-in HA user, also non-admin) replaces the page's 30 s
``podvoice.answers_snapshot`` poll, which HA recorded as a service call on the Green's slow eMMC. While at least
one panel is subscribed to a room, this module keeps one long poll open to the PodVoice add-on on loopback
(``GET /view/api/answers/live``, podview_answers_live.py: it answers as soon as the add-on's answer state changes,
else after 25 s). Each new state is pushed to every subscriber: the identity fields the wall page validates the
live answer against, the live answers themselves (``podview.answers.v1``) and, whenever the history revision
moved, the saved answers (read with addon_bridge.read_answers, the same read as answers_snapshot). Nothing is
written to HA's state machine, the event bus or the recorder; the answer content is never logged.

A stopped or busy add-on is an honest ``{"ok": false, "error": "addon_unavailable"}`` push; the module tries again
after 2, 4 … 30 s while someone is subscribed, and stops reading when the last subscriber leaves.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

import voluptuous as vol
from aiohttp import ClientError, ClientTimeout
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from . import addon_bridge

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry

DOMAIN = "podvoice"
_LOGGER = logging.getLogger(__name__)
_KEY = "podvoice_answers_live"
_REGISTERED_KEY = "podvoice_answers_live_registered"

ADDON_LIVE = "http://127.0.0.1:8098/view/api/answers/live"
LIVE_SCHEMA = "podview.answers-live.v1"
ANSWERS_SCHEMA = "podview.answers.v1"
# The add-on waits at most 25 s before it answers an unchanged state.
TIMEOUT_S = 35
# Three live answers of at most 64 KiB each (the add-on's own limits), plus the identity fields.
MAX_BYTES = 3 * 65536 + 65536
RETRY_S = (2, 4, 8, 16, 30)
# An add-on that answers an unchanged state at once (no wake left) is read again no sooner than this.
MIN_INTERVAL_S = 2.0
TOKEN = re.compile(r"^[a-f0-9]{32}$")
ROOM = vol.All(str, vol.Length(min=1, max=80))


def _live_shape(value: object) -> bool:
    """The add-on's closed envelope; the panel validates every live answer itself (owner-answers.js)."""
    if not isinstance(value, dict) or value.get("schema") != LIVE_SCHEMA:
        return False
    token, snapshot, live = value.get("token"), value.get("snapshot"), value.get("live")
    if (
        not isinstance(token, str)
        or TOKEN.fullmatch(token) is None
        or not isinstance(snapshot, dict)
    ):
        return False
    if live is None:
        return True
    return (
        isinstance(live, dict)
        and live.get("schema") == ANSWERS_SCHEMA
        and isinstance(live.get("items"), list)
        and len(live["items"]) <= 3
    )


async def read_live(hass: HomeAssistant, room: str | None, after: str) -> dict[str, Any]:
    """One long-poll read of the add-on's live answer state; never raises."""
    params = {"after": after, **({"room": room} if room else {})}
    session = async_get_clientsession(hass)
    try:
        async with session.get(
            ADDON_LIVE,
            params=params,
            allow_redirects=False,
            timeout=ClientTimeout(total=TIMEOUT_S),
        ) as response:
            if response.content_type != "application/json":
                return {"ok": False, "error": "addon_unavailable"}
            body = bytearray()
            async for chunk in response.content.iter_chunked(65536):
                body.extend(chunk)
                if len(body) > MAX_BYTES:
                    return {"ok": False, "error": "unreadable"}
            payload = json.loads(body)
            status = response.status
    except (ClientError, TimeoutError, ValueError):
        return {"ok": False, "error": "addon_unavailable"}
    if status != 200:
        error = payload.get("error") if isinstance(payload, dict) else None
        if error in addon_bridge.ADDON_ERRORS:
            return {"ok": False, "error": error}
        return {"ok": False, "error": "addon_unavailable" if status >= 500 else "addon_refused"}
    if not _live_shape(payload):
        return {"ok": False, "error": "unreadable"}
    return {"ok": True, **payload}


def _history_mark(snapshot: dict) -> tuple:
    return (
        snapshot.get("bootId"),
        snapshot.get("roomId"),
        snapshot.get("answerHistoryRevision"),
        snapshot.get("answerHistoryRemovalRevision"),
    )


class RoomWatch:
    """One add-on long poll per room while anyone is subscribed; the last state for a new subscriber."""

    def __init__(self, hass: HomeAssistant, room: str | None, done: Callable[[], None]) -> None:
        self.hass = hass
        self.room = room
        self.listeners: list[Callable[[dict], None]] = []
        self.last: dict | None = None
        self._done = done
        self._task: asyncio.Task | None = None

    def add(self, listener: Callable[[dict], None]) -> Callable[[], None]:
        self.listeners.append(listener)
        if self.last is not None:
            listener(self.last)
        if self._task is None:
            self._task = self.hass.async_create_background_task(
                self._run(), f"podvoice answers live {self.room or '-'}"
            )

        def remove() -> None:
            if listener in self.listeners:
                self.listeners.remove(listener)
            if not self.listeners:
                self.stop()

        return remove

    def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None
        self._done()

    def _push(self, state: dict) -> None:
        self.last = state
        for listener in list(self.listeners):
            listener(state)

    async def _run(self) -> None:
        token, mark, history, failures = "", None, None, 0
        loop = asyncio.get_running_loop()
        while self.listeners:
            started = loop.time()
            result = await read_live(self.hass, self.room, token)
            if not self.listeners:
                return
            if not result["ok"]:
                # The code only; never the answer or the room's content.
                _LOGGER.debug("PodVoice live answer read failed: %s", result["error"])
                if self.last is None or self.last.get("error") != result["error"]:
                    self._push({"ok": False, "error": result["error"]})
                token, mark, history = "", None, None
                await asyncio.sleep(RETRY_S[min(failures, len(RETRY_S) - 1)])
                failures += 1
                continue
            failures = 0
            if result["token"] == token:
                if loop.time() - started < MIN_INTERVAL_S:
                    await asyncio.sleep(MIN_INTERVAL_S)
                continue
            token = result["token"]
            snapshot = result["snapshot"]
            if _history_mark(snapshot) != mark:
                saved = await addon_bridge.read_answers(self.hass, self.room)
                if saved["ok"]:
                    history, mark = saved["history"], _history_mark(snapshot)
                else:
                    history, mark = None, None
                    _LOGGER.debug("PodVoice answers read failed: %s", saved["error"])
            self._push(
                {"ok": True, "snapshot": snapshot, "live": result["live"], "history": history}
            )


def _watches(hass: HomeAssistant) -> dict[str, RoomWatch]:
    return hass.data.setdefault(_KEY, {})


@websocket_api.websocket_command(
    {vol.Required("type"): "podvoice/answers_subscribe", vol.Optional("room"): ROOM}
)
@callback
def ws_answers_subscribe(hass: HomeAssistant, connection: Any, msg: dict) -> None:
    user = getattr(connection, "user", None)
    if user is None or not user.is_active:
        connection.send_error(msg["id"], websocket_api.ERR_UNAUTHORIZED, "Signed-in user required")
        return
    msg_id, room = msg["id"], msg.get("room")
    watches = _watches(hass)
    key = room or ""
    watch = watches.get(key)
    if watch is None:
        watch = watches[key] = RoomWatch(hass, room, lambda: watches.pop(key, None))
    state = {"active": True}

    @callback
    def send(pushed: dict) -> None:
        if state["active"]:
            connection.send_message(websocket_api.event_message(msg_id, pushed))

    connection.send_result(msg_id)
    remove = watch.add(send)

    @callback
    def stop() -> None:
        state["active"] = False
        remove()

    connection.subscriptions[msg_id] = stop


async def async_setup_services(hass: HomeAssistant, entry: ConfigEntry) -> list[str]:
    """Register the websocket command once per HA run (it outlives an entry reload); no services."""
    if not hass.data.get(_REGISTERED_KEY):
        hass.data[_REGISTERED_KEY] = True
        websocket_api.async_register_command(hass, ws_answers_subscribe)
    return []
