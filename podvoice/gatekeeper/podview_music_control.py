"""Scoped direct-device transport through the existing PodConnect command owner.

The HTTP broker owns paired room/action/volume permission and keeps offers server-side.
Its current callback must also bind the original setup's facade binding. This module
never discovers services, chooses targets, retries commands or owns provider secrets.
"""

from __future__ import annotations

import asyncio
import json
import math
import re
import time
import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Any

from . import constants as C

_TIMEOUT_S = 8
_TRACK_TIMEOUT_S = 16  # Native Control owns a bounded 14-second prepare/commit/send.
_MAX_BYTES = 65536
_SERVICES = frozenset({"get_playback_controls", "control_playback"})
_ROOM_SERVICES = frozenset({"get_room_playback_controls", "control_room_playback"})
_VOLUME_SERVICES = frozenset({"get_room_volume_controls", "control_room_volume"})
_ROOM_ACTIONS = frozenset({"pause", "resume", "next", "previous"})
_VOLUME_STATES = frozenset(
    {
        "prepared",
        "pending_claim",
        "reserved",
        "pending",
        "admitted_pending",
        "protocol_accepted",
        "rejected_before_admission",
        "expired_before_admission",
        "cancelled_before_admission",
        "unknown",
    }
)
_NATIVE_KEYS = frozenset(
    {
        "account_user_id",
        "target_id",
        "room_id",
        "homepod_id",
        "connection_id",
        "session_id",
        "alias_incarnation",
        "alias_registry",
        "alias_revision",
    }
)
_ROUTE_KEYS = frozenset(
    {
        "process",
        "device_id",
        "device_incarnation",
        "session_epoch",
        "route_revision",
        "selection_revision",
        "input_generation",
        "input_item_id",
        "input_path_digest",
    }
)
_ROOM_KEYS = frozenset(
    {
        "ok",
        "schema",
        "config_entry_id",
        "owner_epoch",
        "poll_sequence",
        "next_command_sequence",
        "observation",
        "target",
        "actions",
        "volume_percent",
        "track_play_supported",
        "status",
        "physical_result_verified",
        "native",
        "route",
        "room_id",
        "homepod_id",
        "volume_supported",
        "volume_unavailable_reason",
    }
)
_VOLUME_KEYS = (_ROOM_KEYS - {"volume_supported", "volume_unavailable_reason"}) | {"volume_state"}
_ACTIONS = frozenset(
    {"pause", "resume", "next", "previous", "volume", "play_track", "play_context"}
)
_ERRORS = frozenset(
    {
        "unavailable",
        "stale",
        "busy",
        "authentication_required",
        "forbidden",
        "rate_limited",
        "malformed_response",
        "owner_replaced",
        "target_not_current",
        "invalid_target",
        "capabilities_unavailable",
        "invalid_arguments",
        "stale_owner",
        "invalid_request_identity",
        "request_reused",
        "stale_command",
        "command_sequence_gap",
        "stale_observation",
        "awaiting_observation",
        "unsupported_action",
        "volume_above_approved_limit",
        "outcome_unknown",
        "native_start_unavailable",
        "native_start_policy_changed",
        "native_account_unproven",
        "room_transport_unavailable",
        "room_transport_expired",
        "invalid_room_identity",
    }
)


def _text(value: Any, maximum: int = 1024) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= maximum:
        raise ValueError("invalid identifier")
    return value


def _integer(value: Any, minimum: int = 1, maximum: int = 2**53 - 1) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("invalid integer")
    return value


def _controls(
    value: Any,
    account: str,
    target: str,
    *,
    offered: bool = False,
    schema: str = "podconnect.controls.v1",
) -> dict:
    if (
        not isinstance(value, dict)
        or value.get("ok") is not True
        or value.get("schema") != schema
        or value.get("config_entry_id") != account
        or value.get("physical_result_verified") is not False
    ):
        raise ValueError("invalid owner controls")
    epoch = _text(value.get("owner_epoch"), 128)
    poll = _integer(value.get("poll_sequence"))
    status = value.get("status")
    if status not in {"ready", "awaiting_observation", "sequence_exhausted"}:
        raise ValueError("invalid owner status")
    sequence = value.get("next_command_sequence")
    if status == "sequence_exhausted":
        if sequence is not None:
            raise ValueError("invalid exhausted sequence")
    else:
        sequence = _integer(sequence)
    destination = value.get("target")
    if (
        not isinstance(destination, dict)
        or destination.get("kind") != "spotify_device"
        or destination.get("target_id") != target
    ):
        raise ValueError("wrong target")
    name = destination.get("name")
    if name is not None:
        name = _text(name)
    observation = value.get("observation")
    if (
        not isinstance(observation, dict)
        or observation.get("source") != "spotify_web_api"
        or observation.get("status") != "fresh"
    ):
        raise ValueError("missing source")
    maximum = _integer(observation.get("max_age_ms"), 1, 15000)
    age = _integer(observation.get("age_ms"), 0, maximum)
    timestamp = _text(observation.get("observed_at"), 64)
    stamp = datetime.fromisoformat(timestamp)
    now = time.time()
    if stamp.tzinfo is None or not -5 <= now - stamp.timestamp() < maximum / 1000:
        raise ValueError("stale source")
    deadline = min(stamp.timestamp() + maximum / 1000, now + (maximum - age) / 1000)
    if offered:
        fixed: Any = value.get("valid_until")
        if type(fixed) not in (int, float) or not math.isfinite(fixed) or fixed > deadline:
            raise ValueError("invalid offer deadline")
        deadline = fixed
    if deadline <= now:
        raise ValueError("expired source")
    actions = value.get("actions")
    if (
        not isinstance(actions, list)
        or len(actions) > 7
        or any(not isinstance(action, str) or action not in _ACTIONS for action in actions)
        or len(set(actions)) != len(actions)
        or {"pause", "resume"}.issubset(actions)
        or (status != "ready" and actions)
    ):
        raise ValueError("invalid actions")
    volume = value.get("volume_percent")
    if volume is not None:
        volume = _integer(volume, 0, 100)
    if "volume" in actions and volume is None:
        raise ValueError("unobserved volume capability")
    track_play_supported = value.get("track_play_supported") is True
    return {
        "ok": True,
        "schema": schema,
        "config_entry_id": account,
        "owner_epoch": epoch,
        "poll_sequence": poll,
        "next_command_sequence": sequence,
        "target": {"kind": "spotify_device", "target_id": target, "name": name},
        "observation": {
            "status": "fresh",
            "source": "spotify_web_api",
            "observed_at": timestamp,
            "age_ms": age,
            "max_age_ms": maximum,
        },
        "actions": list(actions),
        "volume_percent": volume,
        "track_play_supported": track_play_supported,
        "context_play_supported": value.get("context_play_supported") is True,
        "status": status,
        "valid_until": deadline,
        "physical_result_verified": False,
    }


def _room_controls(
    value: Any, account: str, target: str, room: str, homepod: str, *, offered: bool = False
) -> dict:
    """Project only the exact Control/native room and OwnTone route offer."""
    projected = _controls(
        value, account, target, offered=offered, schema="podconnect.room_controls.v1"
    )
    native, route = value.get("native"), value.get("route")
    scope = {"target_id": target, "room_id": room, "homepod_id": homepod}
    if (
        set(value)
        != (_ROOM_KEYS | {"valid_until", "context_play_supported"} if offered else _ROOM_KEYS)
        or not isinstance(value.get("target"), dict)
        or set(value["target"]) != {"kind", "target_id", "name"}
        or not isinstance(value.get("observation"), dict)
        or set(value["observation"]) != {"status", "observed_at", "age_ms", "max_age_ms", "source"}
        or value.get("room_id") != room
        or value.get("homepod_id") != homepod
        or re.fullmatch(r"0|[1-9][0-9]{0,19}", homepod) is None
        or int(homepod) >= 2**64
        or value.get("volume_percent") is not None
        or value.get("track_play_supported") is not False
        or value.get("volume_supported") is not False
        or value.get("volume_unavailable_reason") != "room_volume_not_supported"
        or not isinstance(native, dict)
        or set(native) != _NATIVE_KEYS
        or not isinstance(route, dict)
        or set(route) != _ROUTE_KEYS
        or any(native[k] != expected for k, expected in scope.items())
        or not all(
            isinstance(native[k], str) and 1 <= len(native[k]) <= 1024
            for k in _NATIVE_KEYS - {"alias_revision"}
        )
        or type(native["alias_revision"]) is not int
        or not 0 <= native["alias_revision"] < 2**53
        or re.fullmatch(r"[a-f0-9]{64}", native["alias_registry"]) is None
        or route.get("device_id") != homepod
        or not isinstance(route.get("process"), str)
        or str(uuid.UUID(route["process"])) != route["process"]
        or any(
            not isinstance(route[k], str)
            or re.fullmatch(r"0|[1-9][0-9]{0,19}", route[k]) is None
            or int(route[k]) >= 2**64
            for k in _ROUTE_KEYS - {"process", "input_path_digest"}
        )
        or not isinstance(route.get("input_path_digest"), str)
        or re.fullmatch(r"[a-f0-9]{64}", route["input_path_digest"]) is None
        or any(action not in _ROOM_ACTIONS for action in projected["actions"])
        or not projected["actions"]
        or projected["status"] != "ready"
    ):
        raise ValueError("invalid room owner")
    return {
        **projected,
        "room_id": room,
        "homepod_id": homepod,
        "native": {key: native[key] for key in _NATIVE_KEYS},
        "route": {key: route[key] for key in _ROUTE_KEYS},
        "volume_supported": False,
        "volume_unavailable_reason": "room_volume_not_supported",
    }


def _volume_controls(
    value: Any, account: str, target: str, room: str, homepod: str, *, offered: bool = False
) -> dict:
    """Retain only the exact native volume owner, never generic Spotify volume."""
    if not isinstance(value, dict) or value.get("volume_percent") is not None:
        raise ValueError("invalid volume controls")
    projected = _controls(
        {**value, "volume_percent": 0},
        account,
        target,
        offered=offered,
        schema="podconnect.room_volume_controls.v1",
    )
    native, route, state = value.get("native"), value.get("route"), value.get("volume_state")
    scope = {"target_id": target, "room_id": room, "homepod_id": homepod}
    if (
        set(value)
        != (_VOLUME_KEYS | {"valid_until", "context_play_supported"} if offered else _VOLUME_KEYS)
        or not isinstance(value.get("target"), dict)
        or set(value["target"]) != {"kind", "target_id", "name"}
        or not isinstance(value.get("observation"), dict)
        or set(value["observation"]) != {"status", "observed_at", "age_ms", "max_age_ms", "source"}
        or value.get("room_id") != room
        or value.get("homepod_id") != homepod
        or re.fullmatch(r"0|[1-9][0-9]{0,19}", homepod) is None
        or int(homepod) >= 2**64
        or value.get("track_play_supported") is not False
        or not isinstance(native, dict)
        or set(native) != _NATIVE_KEYS
        or not isinstance(route, dict)
        or set(route) != _ROUTE_KEYS
        or any(native[k] != expected for k, expected in scope.items())
        or not all(
            isinstance(native[k], str) and 1 <= len(native[k]) <= 1024
            for k in _NATIVE_KEYS - {"alias_revision"}
        )
        or type(native["alias_revision"]) is not int
        or not 0 <= native["alias_revision"] < 2**53
        or re.fullmatch(r"[a-f0-9]{64}", native["alias_registry"]) is None
        or route.get("device_id") != homepod
        or not isinstance(route.get("process"), str)
        or str(uuid.UUID(route["process"])) != route["process"]
        or any(
            not isinstance(route[k], str)
            or re.fullmatch(r"0|[1-9][0-9]{0,19}", route[k]) is None
            or int(route[k]) >= 2**64
            for k in _ROUTE_KEYS - {"process", "input_path_digest"}
        )
        or not isinstance(route.get("input_path_digest"), str)
        or re.fullmatch(r"[a-f0-9]{64}", route["input_path_digest"]) is None
        or not isinstance(state, dict)
        or set(state)
        != {"base_revision", "attention_revision", "base_percent", "effective_percent"}
        or any(
            not isinstance(state[k], str)
            or re.fullmatch(r"0|[1-9][0-9]{0,19}", state[k]) is None
            or int(state[k]) >= 2**64
            for k in ("base_revision", "attention_revision")
        )
        or any(
            type(state[k]) is not int or not 0 <= state[k] <= 100
            for k in ("base_percent", "effective_percent")
        )
        or projected["actions"] != ["volume"]
        or projected["status"] != "ready"
    ):
        raise ValueError("invalid volume owner")
    return {
        **projected,
        "volume_percent": None,
        "room_id": room,
        "homepod_id": homepod,
        "native": {key: native[key] for key in _NATIVE_KEYS},
        "route": {key: route[key] for key in _ROUTE_KEYS},
        "volume_state": dict(state),
    }


def native_start(value: Any, target: str, room: str, homepod: str) -> dict:
    """Closed projection of the native owner's room/start-volume readiness proof."""
    if (
        not isinstance(value, dict)
        or value.get("schema") != "podconnect.start_volume.v1"
        or value.get("ready") is not True
        or value.get("engine_device_id") != target
        or value.get("room_id") != room
        or value.get("homepod_id") != homepod
        or not isinstance(value.get("policy_revision"), str)
        or re.fullmatch(r"[a-f0-9]{64}", value["policy_revision"]) is None
        or value.get("mode") not in {"fresh_start", "same_session"}
        or type(value.get("output_selected")) is not bool
    ):
        raise ValueError("invalid native start proof")
    _text(room, 128)
    _text(homepod, 128)
    start = _integer(value.get("start_volume_percent"), 0, 100)
    output = _integer(value.get("output_volume_percent"), 0, 100)
    binding = value.get("alias_binding")
    if not isinstance(binding, dict) or binding.get("ready") is not True:
        raise ValueError("native alias unavailable")
    alias = {key: _text(binding.get(key), 128) for key in ("room_id", "incarnation", "registry")}
    if value["mode"] == "same_session" and (
        not value["output_selected"] or alias["room_id"] != room
    ):
        raise ValueError("native session unavailable")
    return {
        "schema": "podconnect.start_volume.v1",
        "ready": True,
        "engine_device_id": target,
        "room_id": room,
        "homepod_id": homepod,
        "policy_revision": value["policy_revision"],
        "start_volume_percent": start,
        "mode": value["mode"],
        "output_selected": value["output_selected"],
        "output_volume_percent": output,
        "alias_binding": {"ready": True, **alias},
    }


def start_volume(proof: dict) -> int:
    """Same native session retains manual volume; fresh starts use its fixed policy."""
    return (
        proof["output_volume_percent"]
        if proof["mode"] == "same_session"
        else proof["start_volume_percent"]
    )


def _failure(kind: str, *, possible_send: bool = False, identity: dict | None = None) -> dict:
    return {
        **(identity or {}),
        "ok": False,
        "outcome": "unknown" if possible_send else "rejected",
        "error_kind": "outcome_unknown" if possible_send else kind,
        "provider_request_accepted": False,
        "retry_allowed": False,
        "physical_result_verified": False,
    }


def _receipt(value: Any, identity: dict) -> dict:
    if not isinstance(value, dict):
        raise ValueError("invalid receipt")
    _integer(value.get("command_sequence"))
    if not isinstance(value, dict) or any(
        value.get(key) != expected for key, expected in identity.items()
    ):
        raise ValueError("mismatched receipt")
    outcome = value.get("outcome")
    accepted = outcome == "accepted"
    if (
        outcome not in {"accepted", "unknown", "rejected"}
        or value.get("ok") is not accepted
        or value.get("provider_request_accepted") is not accepted
        or value.get("retry_allowed") is not False
        or value.get("physical_result_verified") is not False
    ):
        raise ValueError("invalid receipt")
    result = {
        **identity,
        "ok": accepted,
        "outcome": outcome,
        "provider_request_accepted": accepted,
        "retry_allowed": False,
        "physical_result_verified": False,
    }
    if "observe_after_poll_sequence" in value:
        result["observe_after_poll_sequence"] = _integer(value["observe_after_poll_sequence"], 0)
    if not accepted:
        kind = value.get("error_kind")
        result["error_kind"] = kind if isinstance(kind, str) and kind in _ERRORS else "unavailable"
    return result


def _room_receipt(value: Any, identity: dict) -> dict:
    """Native admission is not a WebAPI send or physical speaker proof."""
    if isinstance(value, dict):
        _integer(value.get("command_sequence"))
    if not isinstance(value, dict) or any(value.get(k) != v for k, v in identity.items()):
        raise ValueError("mismatched room receipt")
    outcome = value.get("outcome")
    if (
        set(value)
        - (
            set(identity)
            | {
                "ok",
                "outcome",
                "accepted_native",
                "provider_request_accepted",
                "retry_allowed",
                "physical_result_verified",
                "error_kind",
                "observe_after_poll_sequence",
            }
        )
        or not (
            set(identity)
            | {
                "ok",
                "outcome",
                "accepted_native",
                "provider_request_accepted",
                "retry_allowed",
                "physical_result_verified",
            }
        )
        <= set(value)
        or outcome not in {"accepted", "rejected", "unknown"}
        or value.get("ok") is not (outcome == "accepted")
        or value.get("accepted_native") is not (outcome == "accepted")
        or value.get("provider_request_accepted") is not False
        or value.get("retry_allowed") is not False
        or value.get("physical_result_verified") is not False
        or (outcome == "accepted" and "error_kind" in value)
    ):
        raise ValueError("invalid room receipt")
    result = {
        **identity,
        "ok": outcome == "accepted",
        "outcome": outcome,
        "accepted_native": outcome == "accepted",
        "provider_request_accepted": False,
        "retry_allowed": False,
        "physical_result_verified": False,
    }
    if "observe_after_poll_sequence" in value:
        result["observe_after_poll_sequence"] = _integer(value["observe_after_poll_sequence"], 0)
    if outcome != "accepted":
        kind = value.get("error_kind")
        result["error_kind"] = kind if isinstance(kind, str) and kind in _ERRORS else "unavailable"
    return result


def _volume_receipt(value: Any, identity: dict) -> dict:
    """Protocol acceptance is distinct from native AUDIO4 and WebAPI receipts."""
    if isinstance(value, dict):
        _integer(value.get("command_sequence"))
    required = set(identity) | {
        "ok",
        "outcome",
        "provider_request_accepted",
        "retry_allowed",
        "physical_result_verified",
        "protocol_accepted",
        "reservation_accepted",
        "possible_effect",
    }
    optional = {"error_kind", "observe_after_poll_sequence", "volume_operation_state"}
    if (
        not isinstance(value, dict)
        or not required <= set(value) <= required | optional
        or any(value.get(k) != v for k, v in identity.items())
        or value.get("outcome") not in {"accepted", "rejected", "unknown"}
        or any(
            type(value.get(k)) is not bool
            for k in (
                "ok",
                "provider_request_accepted",
                "retry_allowed",
                "physical_result_verified",
                "protocol_accepted",
                "reservation_accepted",
                "possible_effect",
            )
        )
        or value["ok"] is not (value["outcome"] == "accepted")
        or value["provider_request_accepted"] is not False
        or value["retry_allowed"] is not False
        or value["physical_result_verified"] is not False
        or (value["outcome"] == "rejected" and value["possible_effect"] is True)
        or (
            value["outcome"] == "accepted"
            and (
                value["protocol_accepted"] is not True
                or value["reservation_accepted"] is not True
                or value["possible_effect"] is not True
                or "error_kind" in value
            )
        )
        or (
            "volume_operation_state" in value
            and value["volume_operation_state"] not in _VOLUME_STATES
        )
        or (
            value["outcome"] == "accepted"
            and "volume_operation_state" in value
            and value["volume_operation_state"] != "protocol_accepted"
        )
    ):
        raise ValueError("invalid volume receipt")
    result = {key: value[key] for key in required}
    if "observe_after_poll_sequence" in value:
        result["observe_after_poll_sequence"] = _integer(value["observe_after_poll_sequence"], 0)
    if "volume_operation_state" in value:
        result["volume_operation_state"] = value["volume_operation_state"]
    if value["outcome"] != "accepted":
        kind = value.get("error_kind")
        result["error_kind"] = kind if isinstance(kind, str) and kind in _ERRORS else "unavailable"
    return result


class MusicControlFacade:
    """A bounded transport, never a grant or a second command owner."""

    def __init__(self, tools: Any) -> None:
        self.tools = tools

    @property
    def available(self) -> bool:
        try:
            token = getattr(self.tools, "_token", None)
            client = getattr(self.tools, "_client", None)
            discovery = getattr(self.tools, "_discovery", None)
            return bool(
                isinstance(token, str)
                and token
                and client is not None
                and getattr(client, "is_closed", None) is False
                and _SERVICES <= getattr(discovery, "podconnect_services", frozenset())
                and callable(getattr(self.tools, "podview_music_binding", None))
            )
        except Exception:
            return False

    @property
    def room_available(self) -> bool:
        discovery = getattr(self.tools, "_discovery", None)
        return bool(
            self.available
            and _ROOM_SERVICES <= getattr(discovery, "podconnect_services", frozenset())
        )

    @property
    def volume_available(self) -> bool:
        discovery = getattr(self.tools, "_discovery", None)
        return bool(
            self.available
            and _VOLUME_SERVICES <= getattr(discovery, "podconnect_services", frozenset())
        )

    @property
    def room_start_available(self) -> bool:
        # A separate native fresh-start contract must replace the old URI path.
        return False

    @property
    def track_available(self) -> bool:
        return bool(
            self.available
            and "get_track_play_controls"
            in getattr(getattr(self.tools, "_discovery", None), "podconnect_services", frozenset())
        )

    @property
    def context_available(self) -> bool:
        return bool(
            self.available
            and "get_context_play_controls"
            in getattr(getattr(self.tools, "_discovery", None), "podconnect_services", frozenset())
        )

    def binding(self) -> tuple:
        try:
            if self.available:
                return (id(self.tools), *self.tools.podview_music_binding(), True)
        except Exception:
            pass
        return (id(self.tools), None, False)

    def _current(self, binding: tuple, current: Callable[[], bool]) -> bool:
        try:
            return (
                binding[-1] is True
                and self.available
                and binding == self.binding()
                and bool(current())
            )
        except Exception:
            return False

    async def _read(self, client: Any, token: str, service: str, args: dict) -> Any:
        async with client.stream(
            "POST",
            f"{C.SUPERVISOR_CORE_API}/services/podconnect/{service}?return_response",
            headers={"Authorization": f"Bearer {token}"},
            json=args,
            follow_redirects=False,
        ) as response:
            if response.status_code != 200:
                raise ValueError("service unavailable")
            raw = bytearray()
            async for chunk in response.aiter_bytes(8192):
                raw.extend(chunk)
                if len(raw) > _MAX_BYTES:
                    raise ValueError("response too large")
        payload = json.loads(raw)
        return payload.get("service_response") if isinstance(payload, dict) else None

    async def setup(self, account: str, target: str, current: Callable[[], bool]) -> dict:
        try:
            _text(account)
            _text(target)
            binding = self.binding()
            client, token = self.tools._client, self.tools._token
            if not self._current(binding, current):
                return _failure("unavailable")
            async with asyncio.timeout(_TIMEOUT_S):
                result = await self._read(
                    client,
                    token,
                    "get_playback_controls",
                    {
                        "config_entry_id": account,
                        "kind": "spotify_device",
                        "target_id": target,
                    },
                )
            if not self._current(binding, current):
                return _failure("owner_replaced")
            return {"ok": True, "data": _controls(result, account, target)}
        except Exception:
            return _failure("unavailable")

    async def setup_room(
        self,
        account: str,
        target: str,
        room: str,
        homepod: str,
        current: Callable[[], bool],
    ) -> dict:
        """Read the exact current room route; never offer generic WebAPI controls."""
        try:
            _text(account)
            _text(target)
            _text(room, 128)
            _text(homepod, 128)
            binding = self.binding()
            if not self.room_available or not self._current(binding, current):
                return _failure("unavailable")
            client, token = self.tools._client, self.tools._token
            async with asyncio.timeout(_TIMEOUT_S):
                result = await self._read(
                    client,
                    token,
                    "get_room_playback_controls",
                    {
                        "config_entry_id": account,
                        "kind": "spotify_device",
                        "target_id": target,
                        "room_id": room,
                        "homepod_id": homepod,
                    },
                )
            if not self._current(binding, current):
                return _failure("owner_replaced")
            return {"ok": True, "data": _room_controls(result, account, target, room, homepod)}
        except Exception:
            return _failure("unavailable")

    async def execute_room(self, offered: dict, action: str, current: Callable[[], bool]) -> dict:
        """Send one bound native AUDIO4 command and retain an unknown possible send."""
        possible_send = False
        identity: dict = {}
        try:
            account = _text(offered.get("config_entry_id"))
            target = _text(offered.get("target", {}).get("target_id"))
            room = _text(offered.get("room_id"), 128)
            homepod = _text(offered.get("homepod_id"), 128)
            if not self.room_available:
                return _failure("unavailable")
            value = _room_controls(offered, account, target, room, homepod, offered=True)
            if action not in _ROOM_ACTIONS or action not in value["actions"]:
                return _failure("unsupported_action")
            sequence, epoch = value["next_command_sequence"], value["owner_epoch"]
            identity = {
                "schema": "podconnect.command.v1",
                "config_entry_id": account,
                "owner_epoch": epoch,
                "request_id": f"{epoch}:{sequence}",
                "command_sequence": sequence,
                "action": action,
                "target": {"kind": "spotify_device", "target_id": target},
            }
            request = {
                "config_entry_id": account,
                "kind": "spotify_device",
                "target_id": target,
                "owner_epoch": epoch,
                "expected_poll_sequence": value["poll_sequence"],
                "request_id": identity["request_id"],
                "command_sequence": sequence,
                "action": action,
                "args": {},
                "room_id": room,
                "homepod_id": homepod,
                "native": value["native"],
                "route": value["route"],
            }
            binding = self.binding()
            client, token = self.tools._client, self.tools._token
            async with asyncio.timeout(20):  # Control's same-room command owns up to 18s.
                if not self._current(binding, current):
                    return _failure("owner_replaced", identity=identity)
                possible_send = True
                result = await self._read(client, token, "control_room_playback", request)
            if not self._current(binding, current):
                return _failure("owner_replaced", possible_send=True, identity=identity)
            return _room_receipt(result, identity)
        except (Exception, asyncio.CancelledError):
            return _failure("unavailable", possible_send=possible_send, identity=identity)

    async def setup_volume(
        self, account: str, target: str, room: str, homepod: str, current: Callable[[], bool]
    ) -> dict:
        try:
            _text(account)
            _text(target)
            if not self.volume_available:
                return _failure("unavailable")
            binding = self.binding()
            if not self._current(binding, current):
                return _failure("unavailable")
            async with asyncio.timeout(_TIMEOUT_S):
                result = await self._read(
                    self.tools._client,
                    self.tools._token,
                    "get_room_volume_controls",
                    {
                        "config_entry_id": account,
                        "kind": "spotify_device",
                        "target_id": target,
                        "room_id": _text(room, 128),
                        "homepod_id": _text(homepod, 128),
                    },
                )
            if not self._current(binding, current):
                return _failure("owner_replaced")
            return {"ok": True, "data": _volume_controls(result, account, target, room, homepod)}
        except Exception:
            return _failure("unavailable")

    async def execute_volume(
        self, offered: dict, percent: int, current: Callable[[], bool]
    ) -> dict:
        possible_send = False
        identity: dict = {}
        try:
            account = _text(offered.get("config_entry_id"))
            target = _text(offered.get("target", {}).get("target_id"))
            room = _text(offered.get("room_id"), 128)
            homepod = _text(offered.get("homepod_id"), 128)
            if type(percent) is not int or not 0 <= percent <= 100 or not self.volume_available:
                return _failure("unavailable")
            value = _volume_controls(offered, account, target, room, homepod, offered=True)
            sequence, epoch = value["next_command_sequence"], value["owner_epoch"]
            identity = {
                "schema": "podconnect.command.v1",
                "config_entry_id": account,
                "owner_epoch": epoch,
                "request_id": f"{epoch}:{sequence}",
                "command_sequence": sequence,
                "action": "volume",
                "target": {"kind": "spotify_device", "target_id": target},
            }
            request = {
                "config_entry_id": account,
                "kind": "spotify_device",
                "target_id": target,
                "room_id": room,
                "homepod_id": homepod,
                "native": value["native"],
                "route": value["route"],
                "volume_state": value["volume_state"],
                "owner_epoch": epoch,
                "expected_poll_sequence": value["poll_sequence"],
                "command_sequence": sequence,
                "request_id": identity["request_id"],
                "action": "volume",
                "args": {"percent": percent},
            }
            binding = self.binding()
            async with asyncio.timeout(20):
                if not self._current(binding, current):
                    return _failure("owner_replaced", identity=identity)
                possible_send = True
                result = await self._read(
                    self.tools._client, self.tools._token, "control_room_volume", request
                )
            if not self._current(binding, current):
                return _failure("owner_replaced", possible_send=True, identity=identity)
            return _volume_receipt(result, identity)
        except (Exception, asyncio.CancelledError):
            return _failure("unavailable", possible_send=possible_send, identity=identity)

    async def setup_track(
        self,
        account: str,
        target: str,
        room: str,
        homepod: str,
        current: Callable[[], bool],
        *,
        context: bool = False,
    ) -> dict:
        """Read exact account/device and configured native room/output readiness."""
        try:
            _text(account)
            _text(target)
            if not (self.context_available if context else self.track_available):
                return _failure("unavailable")
            binding = self.binding()
            client, token = self.tools._client, self.tools._token
            if not self._current(binding, current):
                return _failure("unavailable")
            async with asyncio.timeout(_TIMEOUT_S):
                result = await self._read(
                    client,
                    token,
                    "get_context_play_controls" if context else "get_track_play_controls",
                    {
                        "config_entry_id": account,
                        "kind": "spotify_device",
                        "target_id": target,
                        "room_id": _text(room, 128),
                    },
                )
            if not self._current(binding, current):
                return _failure("owner_replaced")
            data = _controls(result, account, target)
            if not data["context_play_supported" if context else "track_play_supported"] or data[
                "actions"
            ] != ["play_context" if context else "play_track"]:
                return _failure("unsupported_action")
            data["native_start"] = native_start(result.get("native_start"), target, room, homepod)
            return {"ok": True, "data": data}
        except Exception:
            return _failure("unavailable")

    async def observe_room(self, account, target, room, homepod, current):
        """Read existing exact native proof without granting/depending on action readiness."""
        try:
            _text(account)
            _text(target)
            if not self.track_available:
                return _failure("unavailable")
            binding = self.binding()
            if not self._current(binding, current):
                return _failure("unavailable")
            async with asyncio.timeout(_TIMEOUT_S):
                result = await self._read(
                    self.tools._client,
                    self.tools._token,
                    "get_track_play_controls",
                    {
                        "config_entry_id": account,
                        "kind": "spotify_device",
                        "target_id": target,
                        "room_id": _text(room, 128),
                    },
                )
            if not self._current(binding, current):
                return _failure("owner_replaced")
            data = _controls(result, account, target)
            proof = native_start(result.get("native_start"), target, room, homepod)
            return {
                "ok": True,
                "data": {
                    "owner_epoch": data["owner_epoch"],
                    "poll_sequence": data["poll_sequence"],
                    "valid_until": data["valid_until"],
                    "native_start": proof,
                },
            }
        except Exception:
            return _failure("unavailable")

    async def setup_context(self, account, target, room, homepod, current):
        return await self.setup_track(account, target, room, homepod, current, context=True)

    async def execute(
        self, offered: dict, action: str, args: dict, current: Callable[[], bool]
    ) -> dict:
        possible_send = False
        identity: dict = {}
        try:
            account = _text(offered.get("config_entry_id"))
            target = _text(offered.get("target", {}).get("target_id"))
            value = _controls(offered, account, target, offered=True)
            if value["status"] != "ready" or action not in value["actions"]:
                return _failure("unsupported_action")
            if not isinstance(args, dict) or set(args) != (
                {"percent"} if action == "volume" else set()
            ):
                return _failure("invalid_arguments")
            if action == "volume":
                _integer(args["percent"], 0, 100)
            sequence, epoch = value["next_command_sequence"], value["owner_epoch"]
            identity = {
                "schema": "podconnect.command.v1",
                "config_entry_id": account,
                "owner_epoch": epoch,
                "request_id": f"{epoch}:{sequence}",
                "command_sequence": sequence,
                "action": action,
                "target": {"kind": "spotify_device", "target_id": target},
            }
            request = {
                "config_entry_id": account,
                "kind": "spotify_device",
                "target_id": target,
                "owner_epoch": epoch,
                "expected_poll_sequence": value["poll_sequence"],
                "request_id": identity["request_id"],
                "command_sequence": sequence,
                "action": action,
                "args": dict(args),
            }
            binding = self.binding()
            client, token = self.tools._client, self.tools._token
            async with asyncio.timeout(_TIMEOUT_S):
                if not self._current(binding, current):
                    return _failure("owner_replaced", identity=identity)
                possible_send = True  # No await between this guard and the sole POST.
                result = await self._read(client, token, "control_playback", request)
            if not self._current(binding, current):
                return _failure("owner_replaced", possible_send=True, identity=identity)
            return _receipt(result, identity)
        except (Exception, asyncio.CancelledError):
            return _failure("unavailable", possible_send=possible_send, identity=identity)

    async def execute_track(
        self,
        controls: dict,
        uri: str,
        max_volume: int,
        current: Callable[[], bool],
        *,
        context: bool = False,
    ) -> dict:
        """Send a broker-selected track once through the same exact device owner."""
        possible_send = False
        identity: dict = {}
        try:
            account = _text(controls.get("config_entry_id"))
            target = _text(controls.get("target", {}).get("target_id"))
            value = _controls(controls, account, target, offered=True)
            proof = controls.get("native_start", {})
            proof = native_start(proof, target, proof.get("room_id"), proof.get("homepod_id"))
            if (
                value["status"] != "ready"
                or not value["context_play_supported" if context else "track_play_supported"]
                or value["actions"] != ["play_context" if context else "play_track"]
            ):
                return _failure("unsupported_action")
            if (
                not isinstance(uri, str)
                or re.fullmatch(
                    r"spotify:playlist:[A-Za-z0-9]{22}"
                    if context
                    else r"spotify:track:[A-Za-z0-9]{22}",
                    uri,
                )
                is None
            ):
                return _failure("invalid_arguments")
            if (
                type(max_volume) is not int
                or not 0 <= max_volume <= 100
                or value["volume_percent"] is None
                or value["volume_percent"] > max_volume
                or proof["start_volume_percent"] > max_volume
                or start_volume(proof) > max_volume
            ):
                return _failure("volume_above_approved_limit")
            sequence, epoch = value["next_command_sequence"], value["owner_epoch"]
            identity = {
                "schema": "podconnect.command.v1",
                "config_entry_id": account,
                "owner_epoch": epoch,
                "request_id": f"{epoch}:{sequence}",
                "command_sequence": sequence,
                "action": "play_context" if context else "play_track",
                "target": {"kind": "spotify_device", "target_id": target},
            }
            request = {
                "config_entry_id": account,
                "kind": "spotify_device",
                "target_id": target,
                "owner_epoch": epoch,
                "expected_poll_sequence": value["poll_sequence"],
                "request_id": identity["request_id"],
                "command_sequence": sequence,
                "action": "play_context" if context else "play_track",
                "args": {
                    "context_uri" if context else "track_uri": uri,
                    "max_volume": max_volume,
                    "room_id": proof["room_id"],
                    "homepod_id": proof["homepod_id"],
                    "start_policy_revision": proof["policy_revision"],
                    "alias_incarnation": proof["alias_binding"]["incarnation"],
                },
            }
            binding = self.binding()
            client, token = self.tools._client, self.tools._token
            async with asyncio.timeout(_TRACK_TIMEOUT_S):
                if not self._current(binding, current):
                    return _failure("owner_replaced", identity=identity)
                possible_send = True
                result = await self._read(client, token, "control_playback", request)
            if not self._current(binding, current):
                return _failure("owner_replaced", possible_send=True, identity=identity)
            return _receipt(result, identity)
        except (Exception, asyncio.CancelledError):
            return _failure("unavailable", possible_send=possible_send, identity=identity)

    async def execute_context(self, controls, uri, max_volume, current):
        return await self.execute_track(controls, uri, max_volume, current, context=True)
