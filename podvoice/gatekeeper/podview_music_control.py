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
from collections.abc import Callable
from datetime import datetime
from typing import Any

from . import constants as C

_TIMEOUT_S = 8
_MAX_BYTES = 65536
_SERVICES = frozenset({"get_playback_controls", "control_playback"})
_ACTIONS = frozenset({"pause", "resume", "next", "previous", "volume", "play_track"})
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


def _controls(value: Any, account: str, target: str, *, offered: bool = False) -> dict:
    if (
        not isinstance(value, dict)
        or value.get("ok") is not True
        or value.get("schema") != "podconnect.controls.v1"
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
        or len(actions) > 6
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
        "schema": "podconnect.controls.v1",
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
        "status": status,
        "valid_until": deadline,
        "physical_result_verified": False,
    }


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
    def track_available(self) -> bool:
        return bool(
            self.available
            and "get_track_play_controls"
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

    async def setup_track(self, account: str, target: str, current: Callable[[], bool]) -> dict:
        """Read an exact fresh device and known volume from the provider owner."""
        try:
            _text(account)
            _text(target)
            if not self.track_available:
                return _failure("unavailable")
            binding = self.binding()
            client, token = self.tools._client, self.tools._token
            if not self._current(binding, current):
                return _failure("unavailable")
            async with asyncio.timeout(_TIMEOUT_S):
                result = await self._read(
                    client,
                    token,
                    "get_track_play_controls",
                    {"config_entry_id": account, "kind": "spotify_device", "target_id": target},
                )
            if not self._current(binding, current):
                return _failure("owner_replaced")
            data = _controls(result, account, target)
            if not data["track_play_supported"] or data["actions"] != ["play_track"]:
                return _failure("unsupported_action")
            return {"ok": True, "data": data}
        except Exception:
            return _failure("unavailable")

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
        self, controls: dict, uri: str, max_volume: int, current: Callable[[], bool]
    ) -> dict:
        """Send a broker-selected track once through the same exact device owner."""
        possible_send = False
        identity: dict = {}
        try:
            account = _text(controls.get("config_entry_id"))
            target = _text(controls.get("target", {}).get("target_id"))
            value = _controls(controls, account, target, offered=True)
            if (
                value["status"] != "ready"
                or not value["track_play_supported"]
                or value["actions"] != ["play_track"]
            ):
                return _failure("unsupported_action")
            if (
                not isinstance(uri, str)
                or re.fullmatch(r"spotify:track:[A-Za-z0-9]{22}", uri) is None
            ):
                return _failure("invalid_arguments")
            if (
                type(max_volume) is not int
                or not 0 <= max_volume <= 100
                or value["volume_percent"] is None
                or value["volume_percent"] > max_volume
            ):
                return _failure("volume_above_approved_limit")
            sequence, epoch = value["next_command_sequence"], value["owner_epoch"]
            identity = {
                "schema": "podconnect.command.v1",
                "config_entry_id": account,
                "owner_epoch": epoch,
                "request_id": f"{epoch}:{sequence}",
                "command_sequence": sequence,
                "action": "play_track",
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
                "action": "play_track",
                "args": {"track_uri": uri, "max_volume": max_volume},
            }
            binding = self.binding()
            client, token = self.tools._client, self.tools._token
            async with asyncio.timeout(_TIMEOUT_S):
                if not self._current(binding, current):
                    return _failure("owner_replaced", identity=identity)
                possible_send = True
                result = await self._read(client, token, "control_playback", request)
            if not self._current(binding, current):
                return _failure("owner_replaced", possible_send=True, identity=identity)
            return _receipt(result, identity)
        except (Exception, asyncio.CancelledError):
            return _failure("unavailable", possible_send=possible_send, identity=identity)
