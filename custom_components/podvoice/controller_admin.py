"""Current HA administrator to the fixed PodVoice add-on owner, via Supervisor stdin."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import re
import secrets
import time

from aiohasupervisor.models import AddonState
from homeassistant.components.hassio.const import DATA_HASSIO_SUPERVISOR_USER
from homeassistant.components.hassio.handler import get_supervisor_client
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError

ADDON = "23375871_podvoice"  # This installation's reviewed Supervisor identity.


def _unique(pairs):
    row = {}
    for key, value in pairs:
        if key in row:
            raise ValueError("duplicate receipt field")
        row[key] = value
    return row


def _valid_pending(row):
    return (
        type(row) is dict
        and set(row) == {"requestId", "name", "matchSignal", "expiresIn", "status"}
        and type(row["requestId"]) is str
        and re.fullmatch(r"[a-f0-9]{32}", row["requestId"]) is not None
        and type(row["name"]) is str
        and 1 <= len(row["name"]) <= 80
        and type(row["matchSignal"]) is str
        and re.fullmatch(r"[A-Z0-9]{6}", row["matchSignal"]) is not None
        and type(row["expiresIn"]) is int
        and 0 <= row["expiresIn"] <= 300
        and row["status"] in ("pending", "approved")
    )


def _valid_result(action, room, value):
    if type(value) is not dict or value.get("room") != room:
        return False
    if action == "list":
        pending, enrolled = value.get("pending"), value.get("enrolled")
        return (
            set(value) == {"ok", "room", "pending", "enrolled"}
            and value["ok"] is True
            and type(pending) is list
            and len(pending) <= 8
            and all(_valid_pending(row) for row in pending)
            and type(enrolled) is list
            and len(enrolled) <= 2
            and all(
                type(row) is dict
                and set(row) == {"id", "name", "room", "persistent", "expiresAt", "status"}
                and type(row["id"]) is str
                and re.fullmatch(r"[a-f0-9]{32}", row["id"]) is not None
                and type(row["name"]) is str
                and len(row["name"]) <= 80
                and row["room"] == room
                and type(row["persistent"]) is bool
                and (row["expiresAt"] is None or type(row["expiresAt"]) in (int, float))
                and row["status"] == "active"
                for row in enrolled
            )
        )
    if action == "prepare":
        return set(value) == {
            "room",
            "requestId",
            "name",
            "matchSignal",
            "expiresIn",
            "status",
        } and _valid_pending({key: item for key, item in value.items() if key != "room"})
    if action == "approve":
        return (
            set(value) == {"ok", "room", "status", "requestId", "name"}
            and value["ok"] is True
            and value["status"] == "approved"
            and type(value["requestId"]) is str
            and re.fullmatch(r"[a-f0-9]{32}", value["requestId"]) is not None
            and type(value["name"]) is str
            and 1 <= len(value["name"]) <= 80
        )
    if action == "revoke_identity":
        return (
            set(value) == {"ok", "room", "identity"}
            and value["ok"] is True
            and type(value["identity"]) is str
            and re.fullmatch(r"[a-f0-9]{32}", value["identity"]) is not None
        )
    return action == "revoke" and set(value) == {"ok", "room"} and value["ok"] is True


class ControllerAdmin:
    def __init__(self, hass: HomeAssistant, entry=None):
        self.hass = hass
        self.entry = entry
        self._lock = asyncio.Lock()
        self._pending: tuple[str, str, str, str, asyncio.Future] | None = None

    async def _current_admin(self, call: ServiceCall) -> None:
        context = call.context
        if not context.user_id or context.parent_id is not None:
            raise HomeAssistantError("current administrator required")
        user = await self.hass.auth.async_get_user(context.user_id)
        if user is None or not user.is_active or not user.is_admin or user.system_generated:
            raise HomeAssistantError("current administrator required")
        if self.entry is not None:
            if self.hass.config_entries.async_get_entry(self.entry.entry_id) is not self.entry:
                raise HomeAssistantError("current PodVoice entry required")
            rooms = [
                item["endpoint"]
                for item in self.entry.data["endpoints"]
                if item["kind"] == "voice_pe" and item["endpoint"] == call.data["room"]
            ]
            if len(rooms) != 1:
                raise HomeAssistantError("current PodVoice room required")

    async def _exchange(self, call: ServiceCall, action: str, **fields) -> dict:
        client = get_supervisor_client(self.hass)
        try:
            info = await client.addons.addon_info(ADDON)
        except Exception as exc:
            raise HomeAssistantError("PodVoice administrator channel unavailable") from exc
        if info.slug != ADDON or info.state != AddonState.STARTED or info.stdin is not True:
            raise HomeAssistantError("PodVoice administrator channel unavailable")
        # This is the authorization linearization immediately before Supervisor write.
        await self._current_admin(call)
        room = call.data["room"]
        nonce, key = secrets.token_hex(16), secrets.token_hex(32)
        command = {
            "schema": 1,
            "action": action,
            "room": room,
            "nonce": nonce,
            "key": key,
            "expires": time.time() + 8,
            **fields,
        }
        raw = json.dumps(command, separators=(",", ":")).encode()
        if len(raw) > 1024:
            raise HomeAssistantError("administrator command too large")
        future = asyncio.get_running_loop().create_future()
        self._pending = (nonce, key, action, room, future)
        try:
            try:
                await client.addons.write_addon_stdin(ADDON, raw)
            except Exception as exc:
                raise HomeAssistantError("administrator outcome unknown") from exc
            try:
                outcome, payload = await asyncio.wait_for(future, timeout=10)
            except TimeoutError as exc:
                raise HomeAssistantError("administrator outcome unknown") from exc
            await self._current_admin(call)
            if outcome != "committed":
                raise HomeAssistantError("administrator action unavailable")
            if not _valid_result(action, room, payload):
                raise HomeAssistantError("administrator response invalid")
            return payload
        finally:
            self._pending = None

    async def request(self, call: ServiceCall, action: str) -> dict:
        await self._current_admin(call)
        room = call.data["room"]
        async with self._lock:
            if action == "approve":
                request_id = call.data["request_id"]
                prepared = await self._exchange(call, "prepare", request_id=request_id)
                if (
                    prepared.get("requestId") != request_id
                    or prepared.get("room") != room
                    or prepared.get("status") != "pending"
                ):
                    raise HomeAssistantError("pending browser request unavailable")
                await self._current_admin(call)
                try:
                    approved = await self._exchange(call, "approve", request_id=request_id)
                    if approved["requestId"] != request_id:
                        raise HomeAssistantError("administrator response invalid")
                    return approved
                except HomeAssistantError as exc:
                    if str(exc) != "administrator outcome unknown":
                        raise
                    # A lost ACK may follow a committed mutation. Read state; never resend it.
                    rows = await self._exchange(call, "list")
                    if any(
                        row.get("requestId") == request_id and row.get("status") == "approved"
                        for row in rows.get("pending", [])
                    ):
                        return {"ok": True, "room": room, "requestId": request_id}
                    raise
            if action == "revoke_identity":
                identity = call.data["identity"]
                try:
                    revoked = await self._exchange(call, action, identity=identity)
                    if revoked["identity"] != identity:
                        raise HomeAssistantError("administrator response invalid")
                    return revoked
                except HomeAssistantError as exc:
                    if str(exc) != "administrator outcome unknown":
                        raise
                    rows = await self._exchange(call, "list")
                    if not any(row.get("id") == identity for row in rows.get("enrolled", [])):
                        return {"ok": True, "room": room, "identity": identity}
                    raise
            if action in ("list", "revoke"):
                return await self._exchange(call, action)
            raise HomeAssistantError("unsupported administrator action")

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
        payload = data.get("payload")
        if not isinstance(payload, str) or len(payload.encode()) > 8192:
            return
        message = json.dumps(
            [nonce, action, room, data["outcome"], payload], separators=(",", ":")
        ).encode()
        expected = hmac.new(bytes.fromhex(key), message, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, data["mac"]):
            return
        try:
            result = json.loads(payload, object_pairs_hook=_unique)
        except (ValueError, UnicodeError):
            return
        if not isinstance(result, dict):
            return
        future.set_result((data["outcome"], result))
