"""Current HA administrator to the fixed PodVoice add-on owner, via Supervisor stdin."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import secrets
import time

from aiohasupervisor.models import AddonState
from homeassistant.components.hassio.const import DATA_HASSIO_SUPERVISOR_USER
from homeassistant.components.hassio.handler import get_supervisor_client
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError

ADDON = "23375871_podvoice"  # This installation's reviewed Supervisor identity.


class ControllerAdmin:
    def __init__(self, hass: HomeAssistant):
        self.hass = hass
        self._lock = asyncio.Lock()
        self._pending: tuple[str, str, str, str, asyncio.Future] | None = None

    async def _current_admin(self, call: ServiceCall) -> None:
        context = call.context
        if not context.user_id or context.parent_id is not None:
            raise HomeAssistantError("current administrator required")
        user = await self.hass.auth.async_get_user(context.user_id)
        if user is None or not user.is_active or not user.is_admin or user.system_generated:
            raise HomeAssistantError("current administrator required")

    async def request(self, call: ServiceCall, action: str) -> dict:
        await self._current_admin(call)
        room = call.data["room"]
        async with self._lock:
            client = get_supervisor_client(self.hass)
            info = await client.addons.addon_info(ADDON)
            if info.slug != ADDON or info.state != AddonState.STARTED or info.stdin is not True:
                raise HomeAssistantError("PodVoice administrator channel unavailable")
            code = secrets.token_urlsafe(32) if action == "provision" else None
            nonce, key = secrets.token_hex(16), secrets.token_hex(32)
            command = {
                "schema": 1,
                "action": action,
                "room": room,
                "nonce": nonce,
                "key": key,
                "expires": time.time() + 12,
            }
            if code is not None:
                command["code"] = code
            # Supervisor's Docker attach writer appends the single line terminator.
            raw = json.dumps(command, separators=(",", ":")).encode()
            if len(raw) > 1024:
                raise HomeAssistantError("administrator command too large")
            future = asyncio.get_running_loop().create_future()
            self._pending = (nonce, key, action, room, future)
            try:
                await self._current_admin(call)
                await client.addons.write_addon_stdin(ADDON, raw)
                try:
                    outcome = await asyncio.wait_for(future, timeout=12)
                except TimeoutError as exc:
                    raise HomeAssistantError("administrator outcome unknown") from exc
                await self._current_admin(call)  # Revocation during await cannot reveal a code.
                if outcome != "committed":
                    raise HomeAssistantError("administrator action unavailable")
                return (
                    {"ok": True, "room": room, "code": code} if code else {"ok": True, "room": room}
                )
            finally:
                self._pending = None

    async def receipt(self, call: ServiceCall) -> None:
        supervisor = self.hass.data.get(DATA_HASSIO_SUPERVISOR_USER)
        context = call.context
        if (
            supervisor is None
            or not supervisor.is_active
            or not supervisor.system_generated
            or context.parent_id is not None
            or context.user_id != supervisor.id
        ):
            return
        pending = self._pending
        if pending is None:
            return
        nonce, key, action, room, future = pending
        data = call.data
        if (
            data["nonce"] != nonce
            or data["action"] != action
            or data["room"] != room
            or data["outcome"] not in ("committed", "unavailable")
            or future.done()
        ):
            return
        message = f"{nonce}:{action}:{room}:{data['outcome']}".encode()
        expected = hmac.new(bytes.fromhex(key), message, hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, data["mac"]):
            future.set_result(data["outcome"])
