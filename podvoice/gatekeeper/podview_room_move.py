"""Explicit retained-session MOVE consumer; no discovery or target selection.

Server callers retain MoveOffer objects and supply the actual task/grant guard.
No effect capability exists until reviewed private policy/deadlines are supplied.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import re
import secrets
import time
from dataclasses import dataclass
from datetime import datetime

from . import constants as C

_SERVICES = frozenset(
    {
        "get_room_move_controls",
        "prepare_room_move_playback",
        "move_room_playback",
        "cancel_room_move_preparation",
    }
)
_ACTION = "move_existing_session"


def _object(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError("invalid move envelope")
    return value


def _text(value, maximum=1024):
    if not isinstance(value, str) or not 1 <= len(value) <= maximum:
        raise ValueError("invalid move identity")
    return value


def _integer(value, minimum=0, maximum=2**53 - 1):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("invalid move number")
    return value


def _hex(value, length):
    if not isinstance(value, str) or not re.fullmatch(f"[a-f0-9]{{{length}}}", value):
        raise ValueError("invalid move digest")
    return value


def _digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, allow_nan=False).encode()
    ).hexdigest()


def controls(value, account, engine, room, homepod, policy, started):
    _object(
        value,
        {
            "ok",
            "schema",
            "config_entry_id",
            "owner_epoch",
            "poll_sequence",
            "next_command_sequence",
            "observation",
            "target",
            "room_id",
            "homepod_id",
            "actions",
            "status",
            "move_offer",
            "physical_result_verified",
        },
    )
    if (
        value["ok"] is not True
        or value["schema"] != "podconnect.room_move_controls.v1"
        or value["config_entry_id"] != account
        or value["room_id"] != room
        or value["homepod_id"] != homepod
        or value["physical_result_verified"] is not False
        or value["status"] != "ready"
        or value["actions"] != [_ACTION]
        or value["target"] != {"kind": "spotify_device", "target_id": engine}
    ):
        raise ValueError("move unavailable")
    _text(value["owner_epoch"], 128)
    _integer(value["poll_sequence"], 1)
    _integer(value["next_command_sequence"], 1)
    observed = _object(
        value["observation"],
        {"status", "observed_at", "age_ms", "max_age_ms", "source"},
    )
    maximum = _integer(observed["max_age_ms"], 1, 15000)
    age = _integer(observed["age_ms"], 0, maximum)
    stamp = datetime.fromisoformat(_text(observed["observed_at"], 64))
    if (
        stamp.tzinfo is None
        or observed["status"] != "fresh"
        or observed["source"] != "spotify_web_api"
        or not -5 <= time.time() - stamp.timestamp() < maximum / 1000
    ):
        raise ValueError("stale move observation")
    offer = _object(
        value["move_offer"],
        {
            "schema",
            "offer_id",
            "binding_id",
            "native_incarnation",
            "policy_revision",
            "session_volume_percent",
            "expires_after_ms",
        },
    )
    if (
        offer["schema"] != "podconnect.room_output_move_offer.v1"
        or offer["policy_revision"] != policy
    ):
        raise ValueError("unreviewed move policy")
    _hex(offer["offer_id"], 32)
    _hex(offer["binding_id"], 64)
    _hex(offer["native_incarnation"], 32)
    _integer(offer["session_volume_percent"], 0, 100)
    deadline = min(
        started + _integer(offer["expires_after_ms"], 1, 5000) / 1000,
        time.monotonic() + (maximum - age) / 1000,
        time.monotonic() + stamp.timestamp() + maximum / 1000 - time.time(),
    )
    if deadline <= time.monotonic():
        raise ValueError("expired move offer")
    return copy.deepcopy(value), deadline


def preparation(value, body, *, cancelled=False):
    if not isinstance(value, dict) or set(value) - {"error_kind"} != {
        "ok",
        "schema",
        "config_entry_id",
        "owner_epoch",
        "request_id",
        "command_sequence",
        "action",
        "target",
        "room_id",
        "homepod_id",
        "state",
        "retry_allowed",
        "physical_result_verified",
    }:
        raise ValueError("invalid move preparation")
    schema = (
        "podconnect.room_move_preparation_cancel.v1"
        if cancelled
        else "podconnect.room_move_preparation.v1"
    )
    if (
        value["schema"] != schema
        or value["retry_allowed"] is not False
        or value["physical_result_verified"] is not False
    ):
        raise ValueError("wrong preparation family")
    _integer(value["command_sequence"], 1)
    for key in (
        "config_entry_id",
        "owner_epoch",
        "request_id",
        "command_sequence",
        "action",
        "room_id",
        "homepod_id",
    ):
        if value[key] != body[key]:
            raise ValueError("changed preparation identity")
    if value["target"] != {"kind": "spotify_device", "target_id": body["target_id"]}:
        raise ValueError("wrong preparation target")
    if (
        value["state"] not in {"staged", "rejected", "cancelled", "unknown", "expired"}
        or type(value["ok"]) is not bool
        or value["ok"]
        is not (value["state"] == ("cancelled" if cancelled else "staged"))
    ):
        raise ValueError("invalid preparation outcome")
    if "error_kind" in value:
        _text(value["error_kind"], 160)
    return value["state"]


def completion(value, body):
    if not isinstance(value, dict) or set(value) - {
        "error_kind",
        "observe_after_poll_sequence",
    } != {
        "ok",
        "schema",
        "config_entry_id",
        "owner_epoch",
        "request_id",
        "command_sequence",
        "action",
        "target",
        "outcome",
        "provider_request_accepted",
        "retry_allowed",
        "physical_result_verified",
        "accepted_room_move",
        "move_operation_id",
        "session_volume_percent",
        "room_id",
        "homepod_id",
    }:
        raise ValueError("invalid move completion")
    if value["schema"] != "podconnect.command.v1" or any(
        value[k] is not False
        for k in (
            "provider_request_accepted",
            "retry_allowed",
            "physical_result_verified",
        )
    ):
        raise ValueError("wrong move receipt")
    _integer(value["command_sequence"], 1)
    for key in (
        "config_entry_id",
        "owner_epoch",
        "request_id",
        "command_sequence",
        "action",
        "room_id",
        "homepod_id",
    ):
        if value[key] != body[key]:
            raise ValueError("changed move identity")
    if value["target"] != {"kind": "spotify_device", "target_id": body["target_id"]}:
        raise ValueError("wrong move engine")
    accepted = value["outcome"] == "accepted"
    if (
        value["outcome"] not in {"accepted", "rejected", "unknown"}
        or value["ok"] is not accepted
        or value["accepted_room_move"] is not accepted
    ):
        raise ValueError("invalid move acceptance")
    operation, volume = value["move_operation_id"], value["session_volume_percent"]
    if operation is not None:
        _hex(operation, 32)
    if volume is not None:
        _integer(volume, 0, 100)
    if accepted and (
        operation is None or volume != body["move_offer"]["session_volume_percent"]
    ):
        raise ValueError("move did not preserve observed session volume")
    if value["outcome"] == "rejected" and (operation is not None or volume is not None):
        raise ValueError("unproven early rejection")
    if "error_kind" in value:
        _text(value["error_kind"], 160)
    if "observe_after_poll_sequence" in value:
        _integer(value["observe_after_poll_sequence"])
    return copy.deepcopy(value)


def _failure(outcome="rejected"):
    return {
        "ok": False,
        "outcome": outcome,
        "retryAllowed": False,
        "physicalResultVerified": False,
    }


@dataclass(eq=False, frozen=True)
class MoveOffer:
    handle: str
    wire: dict
    fingerprint: str
    deadline: float
    binding: tuple


class RoomMoveFacade:
    def __init__(self, tools, *, policy_revision=None):
        self.tools = tools
        self.policy = policy_revision
        self._offers, self._owners, self._highwater, self._reads = {}, {}, {}, {}

    @property
    def available(self):
        return bool(
            isinstance(self.policy, str)
            and re.fullmatch("[a-f0-9]{64}", self.policy)
            and _SERVICES <= self.tools._discovery.podconnect_services
            and self.tools._client is not None
            and not self.tools._client.is_closed
            and self.tools._token
        )

    def binding(self):
        return self.tools.podview_music_binding()

    def current(self, binding, guard):
        try:
            return self.available and self.binding() == binding and bool(guard())
        except Exception:  # noqa: BLE001 -- an external task-owner guard fails closed
            return False

    async def _read(self, client, token, service, args):
        if service not in _SERVICES:
            raise ValueError("unsupported move service")
        seconds = (
            16
            if service == "move_room_playback"
            else 1
            if service == "cancel_room_move_preparation"
            else 8
        )

        def pairs(items):
            result = {}
            for key, value in items:
                if key in result:
                    raise ValueError("duplicate move field")
                result[key] = value
            return result

        async with client.stream(
            "POST",
            f"{C.SUPERVISOR_CORE_API}/services/podconnect/{service}?return_response",
            headers={"Authorization": f"Bearer {token}"},
            json=args,
            follow_redirects=False,
            timeout=seconds,
        ) as response:
            if response.status_code != 200:
                raise ValueError("move service unavailable")
            raw = bytearray()
            async for chunk in response.aiter_bytes(8192):
                raw.extend(chunk)
                if len(raw) > 65536:
                    raise ValueError("move response too large")
        payload = json.loads(
            raw,
            object_pairs_hook=pairs,
            parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite")),
        )
        return payload.get("service_response") if isinstance(payload, dict) else None

    async def _guarded_read(
        self, client, token, service, body, binding, guard, seconds
    ):
        async def admitted_read():
            if not self.current(binding, guard):
                raise ValueError("move owner revoked before transport")
            return await self._read(client, token, service, body)

        task = asyncio.create_task(admitted_read())
        try:
            async with asyncio.timeout(seconds):
                while not task.done():
                    if not self.current(binding, guard):
                        raise ValueError("move owner revoked")
                    await asyncio.wait({task}, timeout=0.05)
                return await task
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def setup(self, account, engine, room, homepod, current):
        try:
            for value in (account, engine, room, homepod):
                _text(value)
            if (
                not re.fullmatch("[1-9][0-9]{0,19}", homepod)
                or int(homepod) > 2**64 - 1
            ):
                return None
            binding = self.binding()
            if not self.current(binding, current):
                return None
            serial = self._reads.get(account, 0) + 1
            if account not in self._reads and len(self._reads) >= 64:
                return None
            self._reads[account] = serial
            started = time.monotonic()
            async with asyncio.timeout(8):
                result = await self._read(
                    self.tools._client,
                    self.tools._token,
                    "get_room_move_controls",
                    {
                        "config_entry_id": account,
                        "kind": "spotify_device",
                        "target_id": engine,
                        "room_id": room,
                        "homepod_id": homepod,
                    },
                )
            if not self.current(binding, current) or self._reads[account] != serial:
                return None
            wire, deadline = controls(
                result, account, engine, room, homepod, self.policy, started
            )
            epoch = wire["owner_epoch"]
            if self._owners.get(account) != epoch:
                self._owners[account] = epoch
                self._highwater[account] = 0
                self._offers = {
                    k: o
                    for k, o in self._offers.items()
                    if o.wire["config_entry_id"] != account
                }
            self._offers = {
                k: o
                for k, o in self._offers.items()
                if o.deadline > time.monotonic() and o.binding == binding
            }
            if len(self._offers) >= 64:
                return None
            offer = MoveOffer(
                secrets.token_hex(16), wire, _digest(wire), deadline, binding
            )
            self._offers[offer.handle] = offer
            return offer
        except Exception:  # noqa: BLE001 -- source failures return no offer, never a target fallback
            return None

    async def _cancel(self, client, token, body):
        args = {
            k: body[k]
            for k in (
                "config_entry_id",
                "owner_epoch",
                "command_sequence",
                "request_id",
            )
        }
        args.update(
            offer_id=body["move_offer"]["offer_id"],
            binding_id=body["move_offer"]["binding_id"],
        )
        try:
            async with asyncio.timeout(1):
                await self._read(client, token, "cancel_room_move_preparation", args)
        except Exception:  # noqa: BLE001 -- best-effort exact cleanup never releases an unknown fence
            return

    async def move(self, offer, current):
        if (
            not isinstance(offer, MoveOffer)
            or self._offers.pop(offer.handle, None) is not offer
        ):
            return _failure()
        try:
            wire = offer.wire
            if (
                _digest(wire) != offer.fingerprint
                or time.monotonic() >= offer.deadline
                or not self.current(offer.binding, current)
                or self._owners.get(wire["config_entry_id"]) != wire["owner_epoch"]
                or wire["next_command_sequence"]
                <= self._highwater.get(wire["config_entry_id"], 0)
            ):
                return _failure()
        except (ValueError, TypeError, KeyError):
            return _failure()
        body = {
            k: copy.deepcopy(wire[k])
            for k in (
                "config_entry_id",
                "owner_epoch",
                "room_id",
                "homepod_id",
                "move_offer",
            )
        }
        body.update(
            kind="spotify_device",
            target_id=wire["target"]["target_id"],
            expected_poll_sequence=wire["poll_sequence"],
            command_sequence=wire["next_command_sequence"],
            request_id=f"{wire['owner_epoch']}:{wire['next_command_sequence']}",
            action=_ACTION,
            args={},
        )
        self._highwater[body["config_entry_id"]] = body["command_sequence"]
        client, token = self.tools._client, self.tools._token
        dispatched = False
        cancel_sent = False

        async def cancel_once():
            nonlocal cancel_sent
            if not cancel_sent:
                cancel_sent = True
                await self._cancel(client, token, body)

        try:
            prepared = await self._guarded_read(
                client,
                token,
                "prepare_room_move_playback",
                body,
                offer.binding,
                current,
                8,
            )
            phase = preparation(prepared, body)
            if phase != "staged":
                await cancel_once()
                return _failure("unknown" if phase == "unknown" else "rejected")
            if not self.current(offer.binding, current):
                await cancel_once()
                return _failure()
            # Actual trusted PV task/grant guard is immediately before the sole
            # physical commit; the exact canonical12 is retained unchanged.
            dispatched = True
            result = await self._guarded_read(
                client,
                token,
                "move_room_playback",
                body,
                offer.binding,
                current,
                16,
            )
            parsed = completion(result, body)
            if not self.current(offer.binding, current):
                await cancel_once()
                return _failure("unknown")
            return parsed
        except asyncio.CancelledError:
            await cancel_once()
            raise
        except Exception:  # noqa: BLE001 -- uncertain send is consumed; there is no retry/fallback
            await cancel_once()
            return _failure("unknown" if dispatched else "rejected")
