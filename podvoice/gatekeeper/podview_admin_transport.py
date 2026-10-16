"""Bounded Supervisor stdin commands delivered to the existing PodView owner."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import time
from pathlib import Path

import httpx

from .podview_controller_admin import ControllerAdminState

_LOG = logging.getLogger("podvoice.admin")
_REJECTED = "podvoice admin stdin rejected"


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate field")
        result[key] = value
    return result


def _command(raw: bytes) -> dict:
    if len(raw) > 1024:
        raise ValueError("oversize command")
    value = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique)
    if (
        not isinstance(value, dict)
        or set(value)
        not in (
            {"schema", "action", "room", "nonce", "key", "expires"},
            {"schema", "action", "room", "nonce", "key", "expires", "code"},
        )
        or type(value["schema"]) is not int
        or value["schema"] != 1
        or value["action"] not in ("provision", "revoke")
        or not isinstance(value["room"], str)
        or not 1 <= len(value["room"]) <= 160
        or not isinstance(value["nonce"], str)
        or re.fullmatch(r"[a-f0-9]{32}", value["nonce"]) is None
        or not isinstance(value["key"], str)
        or re.fullmatch(r"[a-f0-9]{64}", value["key"]) is None
        or type(value["expires"]) not in (int, float)
        or not time.time() <= value["expires"] <= time.time() + 15
        or (value["action"] == "provision") != ("code" in value)
        or (
            "code" in value
            and (
                not isinstance(value["code"], str)
                or re.fullmatch(r"[A-Za-z0-9_-]{43}", value["code"]) is None
            )
        )
    ):
        raise ValueError("invalid command")
    return value


class AdminStdinTransport:
    def __init__(
        self,
        bridge,
        state: ControllerAdminState | None,
        registry_path: Path,
        token: str,
    ):
        self.bridge = bridge
        self.state = state
        self.registry_path = registry_path
        self.token = token
        self._buffer = bytearray()
        self._tasks: set[asyncio.Task] = set()
        self._lock = asyncio.Lock()
        self._listening = False

    def start(self):
        loop = asyncio.get_running_loop()
        try:
            os.set_blocking(0, False)
            loop.add_reader(0, self._readable)
        except (OSError, ValueError, NotImplementedError):
            _LOG.error("podvoice admin stdin unavailable")
            return
        self._listening = True

    def close(self):
        if self._listening:
            asyncio.get_running_loop().remove_reader(0)
            self._listening = False
        for task in self._tasks:
            task.cancel()

    def _readable(self):
        try:
            chunk = os.read(0, 4096)
        except BlockingIOError:
            return
        except OSError:
            self.close()
            return
        if not chunk:
            self.close()
            return
        self._buffer.extend(chunk)
        if len(self._buffer) > 1024 and b"\n" not in self._buffer:
            self._buffer.clear()
            _LOG.warning(_REJECTED)
            return
        rejected = False
        while b"\n" in self._buffer:
            raw, _, tail = self._buffer.partition(b"\n")
            self._buffer = bytearray(tail)
            if self._tasks:
                rejected = True
                continue
            task = asyncio.create_task(self.process(bytes(raw)), name="podview-admin-command")
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
        if rejected:
            _LOG.warning(_REJECTED)
        if len(self._buffer) > 1024:
            self._buffer.clear()
            _LOG.warning(_REJECTED)

    async def process(self, raw: bytes):
        try:
            command = _command(raw)
        except (ValueError, UnicodeError):
            _LOG.warning(_REJECTED)
            return
        async with self._lock:
            outcome = "unavailable"
            try:
                if time.time() >= command["expires"]:
                    raise ValueError("expired command")
                if self.state is None or not self.token:
                    raise ValueError("owner unavailable")
                room = command["room"]
                if command["action"] == "provision":
                    if self.bridge.controls.policy.get("roomId") != room:
                        raise ValueError("room policy unavailable")
                    binding = self.bridge.controller_owner(room)
                    pin = self.bridge.controller_pin(room)
                    # Disable all browser authority before the first awaited disk step.
                    self.bridge._controller_enabled = False
                    self.bridge._pairing_hash = ""
                    self.bridge._grants.clear()
                    self.bridge._controller_grants.clear()
                    row, registry = await asyncio.to_thread(
                        self.state.provision,
                        room,
                        pin,
                        command["code"],
                        self.registry_path,
                        command["nonce"],
                        command["expires"],
                    )
                    if (
                        not self.bridge.controller_owner_current(room, binding)
                        or self.bridge.controller_pin(room) != pin
                    ):
                        raise ValueError("room owner changed")
                    # The durable state and registry are authoritative before any ACK.
                    self.bridge._controller_enabled = True
                    self.bridge._controller_days = 30
                    self.bridge._controller_registry = registry
                    self.bridge._controller_admin_state = self.state
                    self.bridge._pairing_room = room
                    self.bridge._pairing_hash = row["digest"]
                    self.bridge._pairing_attempts = 0
                    self.bridge._pairing_deadline = time.monotonic() + max(
                        0, row["deadline"] - time.time()
                    )
                else:
                    row = await asyncio.to_thread(self.state.load)
                    if row is None or not row["enabled"] or row["room"] != room:
                        raise ValueError("owner unavailable")
                    self.bridge._controller_enabled = False
                    self.bridge._pairing_hash = ""
                    await asyncio.to_thread(
                        self.state.disable, room, command["nonce"], command["expires"]
                    )
                    if not self.bridge.revoke(room):
                        raise ValueError("registry revoke failed")
                    self.bridge._controller_enabled = False
                    self.bridge._controller_admin_state = None
                    self.bridge._pairing_hash = ""
                outcome = "committed"
            except (OSError, ValueError, TypeError, KeyError):
                _LOG.warning(_REJECTED)
            await self._receipt(command, outcome)

    async def _receipt(self, command: dict, outcome: str):
        if not self.token:
            return
        message = f"{command['nonce']}:{command['action']}:{command['room']}:{outcome}".encode()
        mac = hmac.new(bytes.fromhex(command["key"]), message, hashlib.sha256).hexdigest()
        payload = {
            "nonce": command["nonce"],
            "action": command["action"],
            "room": command["room"],
            "outcome": outcome,
            "mac": mac,
        }
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                response = await client.post(
                    "http://supervisor/core/api/services/podvoice/controller_receipt",
                    headers={"Authorization": f"Bearer {self.token}"},
                    json=payload,
                )
                response.raise_for_status()
        except (httpx.HTTPError, OSError):
            _LOG.warning("podvoice admin receipt unavailable")
