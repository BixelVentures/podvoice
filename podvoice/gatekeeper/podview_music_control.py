"""Scoped direct-device transport through the existing PodConnect command owner.

The HTTP broker owns paired room/action/volume permission and keeps offers server-side.
Its current callback must also bind the original setup's facade binding. This module
never discovers services, chooses targets, retries commands or owns provider secrets.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import re
import time
import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Any, cast

import httpx

from . import constants as C

_START_LOG = logging.getLogger("podvoice.music_start")

_TIMEOUT_S = 8
_TRACK_TIMEOUT_S = 16  # Native Control owns a bounded 14-second prepare/commit/send.
_PREPARE_TIMEOUT_S = 35  # Detached metadata staging may take 30 seconds.
_MAX_BYTES = 65536
_SERVICES = frozenset({"get_playback_controls", "control_playback"})
_ROOM_SERVICES = frozenset({"get_room_playback_controls", "control_room_playback"})
_VOLUME_SERVICES = frozenset({"get_room_volume_controls", "control_room_volume"})
_CONTENT_SERVICES = frozenset(
    {
        "get_room_content_controls",
        "prepare_room_selected_content",
        "start_room_selected_content",
        "cancel_room_content_preparation",
    }
)
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
        "native_account_claim_required",
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
        or (schema != "podconnect.room_controls.v1" and {"pause", "resume"}.issubset(actions))
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


def _room_projection(
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


def _room_controls(value, account, target, room, homepod, *, offered=False) -> dict:
    """Executable offers retain their original readiness requirement."""
    projected = _room_projection(value, account, target, room, homepod, offered=offered)
    if not projected["actions"] or projected["status"] != "ready":
        raise ValueError("invalid room owner")
    return projected


def _room_observation(value, account, target, room, homepod) -> dict:
    """Exact current route proof only; never return executable offer fields."""
    projected = _room_projection(value, account, target, room, homepod)
    return {
        key: projected[key]
        for key in ("owner_epoch", "poll_sequence", "valid_until", "native", "route")
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


def _content_controls(value: Any, account: str, target: str, room: str, homepod: str) -> dict:
    """Keep only the native selected-content descriptor and its original read lifetime."""
    required = {
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
        "start_offer",
        "physical_result_verified",
    }
    if (
        not isinstance(value, dict)
        or set(value) != required
        or value.get("ok") is not True
        or value.get("schema") != "podconnect.room_content_controls.v1"
        or value.get("config_entry_id") != account
        or value.get("room_id") != room
        or value.get("homepod_id") != homepod
        or value.get("physical_result_verified") is not False
        or value.get("target") != {"kind": "spotify_device", "target_id": target}
        or value.get("status") not in {"ready", "awaiting_observation", "sequence_exhausted"}
    ):
        raise ValueError("invalid selected-content owner")
    _text(value["owner_epoch"], 128)
    _integer(value["poll_sequence"])
    if value["status"] == "sequence_exhausted":
        if value["next_command_sequence"] is not None:
            raise ValueError("invalid exhausted sequence")
    else:
        _integer(value["next_command_sequence"])
    actions = value["actions"]
    if (
        not isinstance(actions, list)
        or len(actions) > 2
        or any(action not in {"play_track", "play_context"} for action in actions)
        or len(set(actions)) != len(actions)
        or (value["status"] != "ready" and actions)
    ):
        raise ValueError("invalid selected-content actions")
    observation = value["observation"]
    if (
        not isinstance(observation, dict)
        or set(observation) != {"status", "observed_at", "age_ms", "max_age_ms", "source"}
        or observation["status"] != "fresh"
    ):
        raise ValueError("invalid selected-content observation")
    _text(observation["source"], 128)
    maximum = _integer(observation["max_age_ms"], 1, 15000)
    age = _integer(observation["age_ms"], 0, maximum)
    stamp = datetime.fromisoformat(_text(observation["observed_at"], 64))
    now = time.time()
    if stamp.tzinfo is None or not -5 <= now - stamp.timestamp() < maximum / 1000:
        raise ValueError("stale selected-content observation")
    offer = value["start_offer"]
    if (
        not isinstance(offer, dict)
        or set(offer)
        != {
            "schema",
            "offer_id",
            "binding_id",
            "native_incarnation",
            "policy_revision",
            "start_volume_percent",
            "expires_after_ms",
        }
        or offer["schema"] != "podconnect.room_content_offer.v1"
    ):
        raise ValueError("invalid native start descriptor")
    for key, length in (
        ("offer_id", 32),
        ("binding_id", 64),
        ("native_incarnation", 32),
        ("policy_revision", 64),
    ):
        if (
            not isinstance(offer[key], str)
            or re.fullmatch(f"[a-f0-9]{{{length}}}", offer[key]) is None
        ):
            raise ValueError("invalid native start descriptor")
    if type(offer["start_volume_percent"]) is not int or offer["start_volume_percent"] != 35:
        raise ValueError("invalid fresh-start policy")
    expiry = _integer(offer["expires_after_ms"], 1, 5000)
    deadline = min(
        stamp.timestamp() + maximum / 1000, now + (maximum - age) / 1000, now + expiry / 1000
    )
    if value["status"] == "ready" and (not actions or deadline <= now):
        raise ValueError("expired selected-content offer")
    return {**value, "valid_until": deadline}


def _content_receipt(value: Any, identity: dict, room: str, homepod: str) -> dict:
    required = set(identity) | {
        "ok",
        "outcome",
        "provider_request_accepted",
        "retry_allowed",
        "physical_result_verified",
        "accepted_selected_content",
        "start_operation_id",
        "start_volume_percent",
        "room_id",
        "homepod_id",
    }
    if (
        not isinstance(value, dict)
        or not required <= set(value) <= required | {"error_kind", "observe_after_poll_sequence"}
        or any(value.get(key) != expected for key, expected in identity.items())
        or value.get("room_id") != room
        or value.get("homepod_id") != homepod
        or value.get("outcome") not in {"accepted", "unknown", "rejected"}
        or value.get("ok") is not (value.get("outcome") == "accepted")
        or value.get("accepted_selected_content") is not (value.get("outcome") == "accepted")
        or value.get("provider_request_accepted") is not False
        or value.get("retry_allowed") is not False
        or value.get("physical_result_verified") is not False
    ):
        raise ValueError("invalid selected-content receipt")
    operation = value["start_operation_id"]
    volume = value["start_volume_percent"]
    if value["outcome"] == "accepted":
        if (
            not isinstance(operation, str)
            or re.fullmatch(r"[a-f0-9]{32}", operation) is None
            or type(volume) is not int
            or volume != 35
            or "error_kind" in value
        ):
            raise ValueError("incomplete selected-content start")
    elif value["outcome"] == "rejected":
        if operation is not None or volume is not None:
            raise ValueError("invalid rejected selected-content start")
    elif (
        operation is not None
        and (not isinstance(operation, str) or re.fullmatch(r"[a-f0-9]{32}", operation) is None)
    ) or (volume is not None and (type(volume) is not int or volume != 35)):
        raise ValueError("invalid unknown selected-content facts")
    result = {key: value[key] for key in required}
    if "observe_after_poll_sequence" in value:
        result["observe_after_poll_sequence"] = _integer(value["observe_after_poll_sequence"], 0)
    if value["outcome"] != "accepted":
        kind = value.get("error_kind")
        result["error_kind"] = kind if isinstance(kind, str) and kind in _ERRORS else "unavailable"
    return result


def _preparation_receipt(value: Any, identity: dict, room: str, homepod: str) -> dict:
    required = set(identity) | {
        "ok",
        "room_id",
        "homepod_id",
        "state",
        "retry_allowed",
        "physical_result_verified",
    }
    if (
        not isinstance(value, dict)
        or not required <= set(value) <= required | {"error_kind"}
        or value.get("schema") != "podconnect.room_content_preparation.v1"
        or any(value.get(key) != expected for key, expected in identity.items() if key != "schema")
        or value.get("room_id") != room
        or value.get("homepod_id") != homepod
        or value.get("state") not in {"staged", "rejected", "cancelled", "unknown", "expired"}
        or value.get("ok") is not (value.get("state") == "staged")
        or value.get("retry_allowed") is not False
        or value.get("physical_result_verified") is not False
        or (value.get("state") == "staged" and "error_kind" in value)
    ):
        raise ValueError("invalid selected-content preparation")
    return value


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
    def _transport_available(self) -> bool:
        try:
            token = getattr(self.tools, "_token", None)
            client = getattr(self.tools, "_client", None)
            return bool(
                isinstance(token, str)
                and token
                and client is not None
                and getattr(client, "is_closed", None) is False
                and callable(getattr(self.tools, "podview_music_binding", None))
            )
        except Exception:
            return False

    @property
    def available(self) -> bool:
        discovery = getattr(self.tools, "_discovery", None)
        return bool(
            self._transport_available
            and _SERVICES <= getattr(discovery, "podconnect_services", frozenset())
        )

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
        discovery = getattr(self.tools, "_discovery", None)
        return bool(
            self._transport_available
            and _CONTENT_SERVICES <= getattr(discovery, "podconnect_services", frozenset())
        )

    @property
    def track_available(self) -> bool:
        return self.room_start_available

    @property
    def context_available(self) -> bool:
        return self.room_start_available

    def binding(self) -> tuple:
        try:
            if self._transport_available:
                return (id(self.tools), *self.tools.podview_music_binding(), True)
        except Exception:
            pass
        return (id(self.tools), None, False)

    def _current(self, binding: tuple, current: Callable[[], bool]) -> bool:
        try:
            return (
                binding[-1] is True
                and self._transport_available
                and binding == self.binding()
                and bool(current())
            )
        except Exception:
            return False

    async def _read(self, client: Any, token: str, service: str, args: dict) -> Any:
        # Match only these existing owner deadlines; never change the shared client.
        budget = {
            "prepare_room_selected_content": _PREPARE_TIMEOUT_S,
            "start_room_selected_content": _TRACK_TIMEOUT_S,
            "control_room_playback": 20,
            "control_room_volume": 20,
        }.get(service)
        options = {"timeout": httpx.Timeout(budget, connect=3)} if budget is not None else {}
        async with client.stream(
            "POST",
            f"{C.SUPERVISOR_CORE_API}/services/podconnect/{service}?return_response",
            headers={"Authorization": f"Bearer {token}"},
            json=args,
            follow_redirects=False,
            **options,
        ) as response:
            if response.status_code != 200:
                raise ValueError("service unavailable")
            raw = bytearray()
            async for chunk in response.aiter_bytes(8192):
                raw.extend(chunk)
                if len(raw) > _MAX_BYTES:
                    raise ValueError("response too large")
        if service in {"get_room_queue_controls", "prepare_room_queue", "control_room_queue"}:
            from .podview_queue_scope import unique_members

            payload = json.loads(raw, object_pairs_hook=unique_members)
        else:
            payload = json.loads(raw)
        return payload.get("service_response") if isinstance(payload, dict) else None

    async def setup(self, account: str, target: str, current: Callable[[], bool]) -> dict:
        try:
            _text(account)
            _text(target)
            if not self.available:
                return _failure("unavailable")
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

    async def execute_room(
        self,
        offered: dict,
        action: str,
        current: Callable[[], bool],
        *,
        receipt_current: Callable[[], bool] | None = None,
    ) -> dict:
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
            if not self._current(binding, receipt_current or current):
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
        self,
        offered: dict,
        percent: int,
        current: Callable[[], bool],
        *,
        receipt_current: Callable[[], bool] | None = None,
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
            if not self._current(binding, receipt_current or current):
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
        """Read the one-use native START35 descriptor for an exact destination."""
        try:
            account, target = _text(account), _text(target)
            room, homepod = _text(room, 128), _text(homepod, 128)
            binding = self.binding()
            if not self.room_start_available or not self._current(binding, current):
                return _failure("unavailable")
            async with asyncio.timeout(_TIMEOUT_S):
                result = await self._read(
                    self.tools._client,
                    self.tools._token,
                    "get_room_content_controls",
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
            if (
                isinstance(result, dict)
                and set(result) == {"ok", "error_kind", "retry_allowed", "physical_result_verified"}
                and result["ok"] is False
                and result["error_kind"] == "native_account_claim_required"
                and result["retry_allowed"] is False
                and result["physical_result_verified"] is False
            ):
                return _failure("native_account_claim_required")
            value = _content_controls(result, account, target, room, homepod)
            action = "play_context" if context else "play_track"
            if value["status"] != "ready" or action not in value["actions"]:
                return _failure("unsupported_action")
            return {"ok": True, "data": value}
        except Exception:
            return _failure("unavailable")

    async def observe_room(
        self,
        account: str,
        target: str,
        room: str,
        homepod: str,
        current: Callable[[], bool],
    ) -> dict:
        """Read exact room proof independently of executable command readiness."""
        try:
            _text(account)
            _text(target)
            _text(room, 128)
            _text(homepod, 128)
            binding = self.binding()
            if (
                not self._transport_available
                or "get_room_playback_controls"
                not in getattr(getattr(self.tools, "_discovery", None), "podconnect_services", ())
                or not self._current(binding, current)
            ):
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
            if (
                isinstance(result, dict)
                and set(result) == {"ok", "error_kind", "retry_allowed", "reason"}
                and result["ok"] is False
                and result["error_kind"] == "room_transport_unavailable"
                and result["retry_allowed"] is False
                and result["reason"] == "claim_unavailable"
            ):
                # Only this closed absence permits account-only display. Foreign,
                # malformed or stale route proofs remain generic unavailability.
                return _failure("claim_unavailable")
            return {"ok": True, "data": _room_observation(result, account, target, room, homepod)}
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
            if not self.available:
                return _failure("unavailable")
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
        """Send only an exact selected URI through the native START35 service."""
        possible_send = False
        prepared = False
        preparation_sent = False
        identity: dict = {}
        room = homepod = ""
        started = time.monotonic()
        phase: str | None = None
        phase_started = started
        phase_body: dict | None = None
        diagnostic_error = "none"
        final_result: dict = {}

        def finish(result: dict) -> dict:
            nonlocal final_result
            final_result = result
            return result

        def emit(marker: str, at: float, value: dict, state: str, error_class: str) -> None:
            request_id = identity.get("request_id")
            request_ref = (
                hashlib.sha256(request_id.encode()).hexdigest()[:16] if request_id else "none"
            )
            poll = value.get("observe_after_poll_sequence")
            if type(poll) is not int or not 0 <= poll <= 2**53 - 1:
                poll = None
            kind = value.get("error_kind")
            kind = kind if isinstance(kind, str) and kind in _ERRORS else "none"
            native_match = (
                bool(room and homepod)
                and value.get("room_id") == room
                and value.get("homepod_id") == homepod
            )
            _START_LOG.info(
                "%s request_ref=%s elapsed_ms=%d state=%s error_class=%s error_kind=%s "
                "accepted=%s native_identity_match=%s poll_floor=%s possible_send=%s prepared=%s",
                marker,
                request_ref,
                max(0, int((time.monotonic() - at) * 1000)),
                state,
                error_class,
                kind,
                state == "accepted" and value.get("accepted_selected_content") is True,
                native_match,
                poll,
                possible_send,
                prepared,
            )

        try:
            account = _text(controls.get("config_entry_id"))
            target = _text(controls.get("target", {}).get("target_id"))
            room = _text(controls.get("room_id"), 128)
            homepod = _text(controls.get("homepod_id"), 128)
            if not self.room_start_available:
                return finish(_failure("unavailable"))
            value = _content_controls(
                {k: v for k, v in controls.items() if k != "valid_until"},
                account,
                target,
                room,
                homepod,
            )
            fixed = controls.get("valid_until")
            if type(fixed) not in (int, float):
                return finish(_failure("stale"))
            fixed = cast(int | float, fixed)
            if not math.isfinite(fixed) or fixed > value["valid_until"] or fixed <= time.time():
                return finish(_failure("stale"))
            action = "play_context" if context else "play_track"
            if value["status"] != "ready" or action not in value["actions"]:
                return finish(_failure("unsupported_action"))
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
                return finish(_failure("invalid_arguments"))
            if type(max_volume) is not int or not 35 <= max_volume <= 100:
                return finish(_failure("volume_above_approved_limit"))
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
                "command_sequence": sequence,
                "request_id": identity["request_id"],
                "action": action,
                "args": {"context_uri" if context else "track_uri": uri, "max_volume": max_volume},
                "room_id": room,
                "homepod_id": homepod,
                "start_offer": dict(value["start_offer"]),
            }
            binding = self.binding()
            client, token = self.tools._client, self.tools._token
            async with asyncio.timeout(_PREPARE_TIMEOUT_S):
                if not self._current(binding, current) or time.time() >= fixed:
                    return finish(_failure("owner_replaced", identity=identity))
                preparation_sent = True
                phase, phase_started = "selected_start_prepare", time.monotonic()
                phase_body = None
                preparation = await self._read(
                    client, token, "prepare_room_selected_content", request
                )
            phase_body = preparation if isinstance(preparation, dict) else None
            staged = _preparation_receipt(preparation, identity, room, homepod)
            emit("selected_start_prepare", phase_started, staged, staged["state"], "none")
            phase = None
            if staged["state"] != "staged":
                return finish(
                    _failure(
                        "unavailable", possible_send=staged["state"] == "unknown", identity=identity
                    )
                )
            prepared = True
            # The callback owns the actual task, source, revision, option and human
            # grant. Its post-stage check is the last PV admission before commit.
            if not self._current(binding, current):
                await self._cancel_content_preparation(client, token, request)
                return finish(_failure("owner_replaced", identity=identity))
            async with asyncio.timeout(_TRACK_TIMEOUT_S):
                if not self._current(binding, current):
                    await self._cancel_content_preparation(client, token, request)
                    return finish(_failure("owner_replaced", identity=identity))
                possible_send = True
                phase, phase_started = "selected_start_commit", time.monotonic()
                phase_body = None
                result = await self._read(client, token, "start_room_selected_content", request)
            phase_body = result if isinstance(result, dict) else None
            if not self._current(binding, current):
                await self._cancel_content_preparation(client, token, request)
                return finish(_failure("owner_replaced", possible_send=True, identity=identity))
            receipt = _content_receipt(result, identity, room, homepod)
            emit("selected_start_commit", phase_started, receipt, receipt["outcome"], "none")
            phase = None
            return finish(receipt)
        except (Exception, asyncio.CancelledError) as exc:
            diagnostic_error = (
                "cancelled"
                if isinstance(exc, asyncio.CancelledError)
                else "timeout"
                if isinstance(exc, TimeoutError)
                else "invalid_response"
                if isinstance(exc, ValueError)
                else "exception"
            )
            if prepared or preparation_sent:
                await self._cancel_content_preparation(client, token, request)
            return finish(_failure("unavailable", possible_send=possible_send, identity=identity))

        finally:
            if phase is not None:
                emit(phase, phase_started, phase_body or {}, "unvalidated", diagnostic_error)
            emit(
                "selected_start_receipt",
                started,
                final_result,
                final_result.get("outcome", "unknown"),
                diagnostic_error,
            )

    async def _cancel_content_preparation(self, client: Any, token: str, request: dict) -> None:
        """Best-effort retire an exact staged operation without a new sequence."""
        offer = request["start_offer"]
        cancellation = {
            "config_entry_id": request["config_entry_id"],
            "owner_epoch": request["owner_epoch"],
            "command_sequence": request["command_sequence"],
            "request_id": request["request_id"],
            "offer_id": offer["offer_id"],
            "binding_id": offer["binding_id"],
        }
        try:
            async with asyncio.timeout(_TIMEOUT_S):
                await self._read(client, token, "cancel_room_content_preparation", cancellation)
        except (Exception, asyncio.CancelledError):
            pass

    async def execute_context(self, controls, uri, max_volume, current):
        return await self.execute_track(controls, uri, max_volume, current, context=True)
