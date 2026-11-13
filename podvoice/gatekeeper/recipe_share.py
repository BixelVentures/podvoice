"""Recipes shared with Share → Home Assistant in the Companion app.

The app fires the HA event ``mobile_app.share`` for the signed-in user; no upload code or
custom shortcut is involved. The link goes through the same import as every other upload
(duplicates, extraction, upload history), and the outcome is pushed back to the phone that
shared it with its own ``notify.mobile_app_*`` service.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import re
import unicodedata
from collections.abc import Callable
from typing import Any

from .recipe_import import import_link
from .recipe_submissions import shared_recipe_url

_LOG = logging.getLogger("podvoice.recipes")
SHARE_EVENT = "mobile_app.share"
NO_LINK = "Ingen link i det delte. Del opskriftens side fra Safari eller Chrome"
UNAVAILABLE = "Opskriften kunne ikke gemmes lige nu. Prøv igen"
_SPECIAL = str.maketrans({"æ": "ae", "Æ": "AE", "ø": "o", "Ø": "O", "å": "a", "Å": "A", "ß": "ss"})


def slugify(value: object) -> str:
    """Home Assistant's slug of a device name ("Mads' iPhone" → "mads_iphone")."""
    if not isinstance(value, str):
        return ""
    text = unicodedata.normalize("NFKD", value.translate(_SPECIAL))
    text = text.encode("ascii", "ignore").decode().lower()
    text = re.sub(r"['\"]", "", text)  # A typographic apostrophe is already dropped above.
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")


def shared_link(data: dict) -> str | None:
    """The first link in what the phone shared: page URL, shared text, typed text, subject."""
    fields = [data.get(key) for key in ("url", "text", "entered", "subject")]
    return shared_recipe_url({"urls": [value for value in fields if isinstance(value, str)]})


def notify_candidates(data: dict, devices: list[dict]) -> list[str]:
    """notify service names that may belong to the sharing phone, best first."""
    names: list[str] = []
    ids = {
        value
        for key in ("sourceDevicePermanentID", "device_id", "sourceDeviceID")
        if isinstance((value := data.get(key)), str) and value
    }
    for device in devices:
        identifiers = device.get("identifiers") if isinstance(device, dict) else None
        if not isinstance(identifiers, list):
            continue
        if any(
            isinstance(pair, list) and len(pair) == 2 and pair[0] == "mobile_app" and pair[1] in ids
            for pair in identifiers
        ):
            # The notify service is named after the registration name, not a later rename.
            names += [slugify(device.get("name")), slugify(device.get("name_by_user"))]
    names += [slugify(data.get("sourceDeviceID")), slugify(data.get("sourceDeviceName"))]
    return [f"mobile_app_{name}" for name in dict.fromkeys(names) if name]


@contextlib.asynccontextmanager
async def supervisor_socket():
    """Home Assistant's websocket API through the Supervisor proxy."""
    import aiohttp

    async with aiohttp.ClientSession() as session:
        async with session.ws_connect(
            "ws://supervisor/core/websocket", max_msg_size=8 * 1024 * 1024, heartbeat=30
        ) as socket:
            yield socket


class RecipeShares:
    """One HA websocket subscription to ``mobile_app.share``; reconnects with backoff."""

    def __init__(self, store, token: Callable[[], str], connect: Callable[[], Any]):
        self.store = store
        self.token = token
        self.connect = connect
        self._tasks: set[asyncio.Task] = set()
        self._replies: dict[int, asyncio.Future] = {}
        self._next_id = 100
        self.socket: Any = None

    async def run(self) -> None:
        attempt = 0
        while True:
            try:
                async with self.connect() as socket:
                    self.socket = socket
                    await self._authenticate(socket)
                    await socket.send_json(
                        {"id": 1, "type": "subscribe_events", "event_type": SHARE_EVENT}
                    )
                    _LOG.info("recipe_share stage=subscribe outcome=ready")
                    attempt = 0
                    self._replies = {}
                    async for message in self._messages(socket):
                        self._dispatch(message)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                _LOG.warning(
                    "recipe_share stage=connection outcome=unavailable error_class=%s",
                    type(error).__name__,
                )
            await asyncio.sleep((1, 2, 5, 10, 30)[min(attempt, 4)])
            attempt += 1

    async def aclose(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)

    async def _authenticate(self, socket) -> None:
        if (await socket.receive_json()).get("type") != "auth_required":
            raise ValueError("auth_protocol")
        await socket.send_json({"type": "auth", "access_token": self.token()})
        if (await socket.receive_json()).get("type") != "auth_ok":
            raise ValueError("auth_denied")

    @staticmethod
    async def _messages(socket):
        while True:
            message = await socket.receive_json()
            if not isinstance(message, dict):
                raise ValueError("invalid_message")
            yield message

    def _dispatch(self, message: dict) -> None:
        if message.get("type") == "result":
            identifier = message.get("id")
            reply = self._replies.pop(identifier, None) if type(identifier) is int else None
            if reply is not None and not reply.done():
                reply.set_result(message)
            elif message.get("id") == 1 and message.get("success") is not True:
                raise ValueError("subscribe_denied")
            return
        event = message.get("event")
        if message.get("type") != "event" or not isinstance(event, dict):
            return
        data = event.get("data")
        if event.get("event_type") == SHARE_EVENT and isinstance(data, dict):
            task = asyncio.create_task(self.handle(data))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    async def _call(self, command: dict) -> Any:
        self._next_id += 1
        identifier = self._next_id
        reply = asyncio.get_running_loop().create_future()
        self._replies[identifier] = reply
        await self.socket.send_json({**command, "id": identifier})
        async with asyncio.timeout(10):
            message = await reply
        if message.get("success") is not True:
            raise ValueError("command_failed")
        return message.get("result")

    async def handle(self, data: dict) -> str:
        """Import the shared link and tell the phone. Returns the message it was sent."""
        url = shared_link(data)
        if url is None:
            message = NO_LINK
            _LOG.info("recipe_share stage=link outcome=missing")
        else:
            try:
                message = (await import_link(self.store, url))["message"]
            except (OSError, ValueError, TypeError, KeyError):
                message = UNAVAILABLE
        await self.notify(data, message)
        return message

    async def notify(self, data: dict, message: str) -> None:
        try:
            devices = await self._call({"type": "config/device_registry/list"})
            services = await self._call({"type": "get_services"})
            notify = services.get("notify", {}) if isinstance(services, dict) else {}
            target = next(
                (name for name in notify_candidates(data, devices or []) if name in notify), None
            )
            if target is None:
                _LOG.warning("recipe_share stage=notify outcome=no_device")
                return
            await self._call(
                {
                    "type": "call_service",
                    "domain": "notify",
                    "service": target,
                    "service_data": {"title": "PodView", "message": message},
                }
            )
            _LOG.info("recipe_share stage=notify outcome=sent")
        except (OSError, ValueError, TimeoutError, AttributeError) as error:
            _LOG.warning(
                "recipe_share stage=notify outcome=failed error_class=%s", type(error).__name__
            )
