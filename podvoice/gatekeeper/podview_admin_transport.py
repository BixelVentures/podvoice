"""Bounded Supervisor stdin commands delivered to the existing PodView owner."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
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
    action = value.get("action") if isinstance(value, dict) else None
    expected = {"schema", "action", "room", "nonce", "key", "expires"}
    if action == "provision":
        expected.add("code")
    elif action in ("approve", "prepare"):
        expected.add("request_id")
    elif action == "revoke_identity":
        expected.add("identity")
    if (
        not isinstance(value, dict)
        or set(value) != expected
        or type(value["schema"]) is not int
        or value["schema"] != 1
        or action
        not in ("provision", "revoke", "recover", "list", "prepare", "approve", "revoke_identity")
        or not isinstance(value["room"], str)
        or not 1 <= len(value["room"]) <= 160
        or not isinstance(value["nonce"], str)
        or re.fullmatch(r"[a-f0-9]{32}", value["nonce"]) is None
        or not isinstance(value["key"], str)
        or re.fullmatch(r"[a-f0-9]{64}", value["key"]) is None
        or type(value["expires"]) not in (int, float)
        or not time.time() <= value["expires"] <= time.time() + 15
        or (action == "provision") != ("code" in value)
        or (
            "code" in value
            and (
                not isinstance(value["code"], str)
                or re.fullmatch(r"[A-Za-z0-9_-]{43}", value["code"]) is None
            )
        )
        or (
            "request_id" in value
            and (
                not isinstance(value["request_id"], str)
                or re.fullmatch(r"[a-f0-9]{32}", value["request_id"]) is None
            )
        )
        or (
            "identity" in value
            and (
                not isinstance(value["identity"], str)
                or re.fullmatch(r"[a-f0-9]{32}", value["identity"]) is None
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
            result: dict = {}
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
                elif command["action"] in ("revoke", "recover"):
                    recovering = command["action"] == "recover"
                    if recovering and self.bridge.controls.policy.get("roomId") != room:
                        raise ValueError("room policy unavailable")
                    binding = self.bridge.controller_owner(room) if recovering else None
                    pin = self.bridge.controller_pin(room) if recovering else ""
                    if recovering:
                        # Fence existing browser authority before the first disk await.
                        self.bridge._controller_enabled = False
                        self.bridge._pairing_hash = ""
                        self.bridge._grants.clear()
                        self.bridge._controller_grants.clear()
                    row = await asyncio.to_thread(self.state.load)
                    if (
                        row is None
                        or row["room"] != room
                        or self.bridge._controller_registry is None
                    ):
                        raise ValueError("owner unavailable")
                    self.bridge._controller_enabled = False
                    self.bridge._pairing_hash = ""
                    self.bridge._grants.clear()
                    self.bridge._controller_grants.clear()
                    if row["enabled"]:
                        await asyncio.to_thread(
                            self.state.disable, room, command["nonce"], command["expires"]
                        )
                    else:
                        await asyncio.to_thread(
                            self.state.accept_profile_command,
                            room,
                            row["pin"],
                            command["nonce"],
                            command["expires"],
                            allow_disabled=True,
                        )
                    if not self.bridge.revoke(room):
                        raise ValueError("registry revoke failed")
                    if recovering and (
                        not self.bridge.controller_owner_current(room, binding)
                        or self.bridge.controller_pin(room) != pin
                    ):
                        raise ValueError("room owner changed")
                    reopened, registry = await asyncio.to_thread(
                        self.state.profiles,
                        room,
                        pin if recovering else row["pin"],
                        self.registry_path,
                    )
                    if recovering and (
                        not self.bridge.controller_owner_current(room, binding)
                        or self.bridge.controller_pin(room) != pin
                    ):
                        raise ValueError("room owner changed")
                    self.bridge._controller_registry = registry
                    self.bridge._controller_enabled = reopened["enabled"]
                    self.bridge._controller_admin_state = self.state
                    result = {"ok": True, "room": room}
                else:
                    row = await asyncio.to_thread(self.state.load)
                    if (
                        row is None
                        or row["room"] != room
                        or self.bridge._controller_registry is None
                    ):
                        raise ValueError("profile owner unavailable")
                    registry = self.bridge._controller_registry
                    if command["action"] == "revoke_identity":
                        active = registry.list_enrollments(room, row["pin"])
                        if not any(
                            item["id"] == command["identity"] and item["status"] == "active"
                            for item in active
                        ):
                            raise ValueError("profile unavailable")
                        target_slot = (room, command["identity"])
                        self.bridge._grants.pop(target_slot, None)
                        self.bridge._controller_grants.pop(target_slot, None)
                        self.bridge.fence_controller(room, command["identity"])
                        disk_task = None
                        try:
                            if row["enabled"]:
                                disk_task = asyncio.create_task(
                                    asyncio.to_thread(
                                        self.state.disable,
                                        room,
                                        command["nonce"],
                                        command["expires"],
                                    )
                                )
                            else:
                                disk_task = asyncio.create_task(
                                    asyncio.to_thread(
                                        self.state.accept_profile_command,
                                        room,
                                        row["pin"],
                                        command["nonce"],
                                        command["expires"],
                                        allow_disabled=True,
                                    )
                                )
                            await asyncio.shield(disk_task)
                            disk_task = None
                            if not self.bridge.revoke_controller(room, command["identity"]):
                                raise ValueError("registry revoke failed")
                            if row["enabled"]:
                                disk_task = asyncio.create_task(
                                    asyncio.to_thread(
                                        self.state.profiles, room, row["pin"], self.registry_path
                                    )
                                )
                                reopened, _ = await asyncio.shield(disk_task)
                                disk_task = None
                                # Keep the object bound to other pending requests.
                                self.bridge._controller_registry = registry
                                self.bridge._controller_enabled = reopened["enabled"]
                                self.bridge._controller_admin_state = self.state
                            self.bridge.unfence_controller(room, command["identity"])
                        except asyncio.CancelledError:
                            self.bridge._controller_enabled = False
                            self.bridge._controller_revocation_failed.add(room)
                            # Shielded executor writes may outlive cancellation. Let
                            # the active write finish before fencing its final state.
                            if disk_task is not None:
                                try:
                                    await asyncio.shield(disk_task)
                                except (OSError, ValueError, TypeError, KeyError):
                                    pass
                            try:
                                current = await asyncio.to_thread(self.state.load)
                                if current is not None and current["enabled"]:
                                    await asyncio.to_thread(
                                        self.state.disable,
                                        room,
                                        secrets.token_hex(16),
                                        time.time() + 12,
                                    )
                            except (OSError, ValueError, TypeError, KeyError):
                                _LOG.error("podvoice admin cancellation fence unavailable")
                            raise
                        except (OSError, ValueError, TypeError, KeyError):
                            self.bridge._controller_enabled = False
                            self.bridge._controller_revocation_failed.add(room)
                            raise
                        # A prior room-wide close/failure is a durable fence. Revoking
                        # one identity never reopens its still-live siblings.
                        result = {"ok": True, "room": room, "identity": command["identity"]}
                    elif command["action"] == "list":
                        pending = []
                        if row["enabled"]:
                            try:
                                pending = self.bridge.list_controller_requests(room)["pending"]
                            except ValueError:
                                pass  # Offline owner cannot create a claimable request.
                        enrolled = registry.list_enrollments(room, row["pin"])
                        result = {
                            "ok": True,
                            "room": room,
                            "pending": pending[:8],
                            "enrolled": [item for item in enrolled if item["status"] == "active"][
                                :2
                            ],
                        }
                    else:
                        if not row["enabled"] or self.bridge.controls.policy.get("roomId") != room:
                            raise ValueError("room policy unavailable")
                        binding = self.bridge.controller_owner(room)
                        pin = self.bridge.controller_pin(room)
                        if row["pin"] != pin:
                            raise ValueError("room owner changed")
                        if command["action"] == "prepare":
                            rows = self.bridge.list_controller_requests(room)
                            matches = [
                                item
                                for item in rows["pending"]
                                if item["requestId"] == command["request_id"]
                            ]
                            if len(matches) != 1:
                                raise ValueError("pending request unavailable")
                            result = {"room": room, **matches[0]}
                        else:
                            await asyncio.to_thread(
                                self.state.accept_profile_command,
                                room,
                                pin,
                                command["nonce"],
                                command["expires"],
                            )
                            if (
                                not self.bridge.controller_owner_current(room, binding)
                                or self.bridge.controller_pin(room) != pin
                            ):
                                raise ValueError("room owner changed")
                            approved = self.bridge.approve_controller_request(
                                room, command["request_id"], registry
                            )
                            result = {"room": room, **approved}
                outcome = "committed"
            except (OSError, ValueError, TypeError, KeyError):
                _LOG.warning(_REJECTED)
            command["_result"] = result
            await self._receipt(command, outcome)

    async def _receipt(self, command: dict, outcome: str):
        if not self.token:
            return
        encoded = json.dumps(command.get("_result", {}), separators=(",", ":"), allow_nan=False)
        message = json.dumps(
            [command["nonce"], command["action"], command["room"], outcome, encoded],
            separators=(",", ":"),
        ).encode()
        mac = hmac.new(bytes.fromhex(command["key"]), message, hashlib.sha256).hexdigest()
        payload = {
            "nonce": command["nonce"],
            "action": command["action"],
            "room": command["room"],
            "outcome": outcome,
            "payload": encoded,
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
