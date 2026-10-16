"""Closed native/physical queue scope; browser metadata is never effect authority."""

from __future__ import annotations

import copy
import re
import uuid

PURPOSE = "queue_occurrence_v1"
NATIVE_KEYS = frozenset(
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
ROUTE_KEYS = frozenset(
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
WRITER_KEYS = frozenset(
    {
        "native_process",
        "writer_fd",
        "pipe_identity",
        "source_epoch",
        "open_generation",
        "input_path_digest",
    }
)


def _object(value, keys):
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError("invalid queue scope fields")


def _decimal(value, minimum=0, maximum=2**64 - 1):
    if (
        not isinstance(value, str)
        or re.fullmatch(r"0|[1-9][0-9]{0,19}", value) is None
        or not minimum <= int(value) <= maximum
    ):
        raise ValueError("invalid queue counter")


def _hex(value, length):
    if not isinstance(value, str) or re.fullmatch(rf"[a-f0-9]{{{length}}}", value) is None:
        raise ValueError("invalid queue digest")


def _uuid(value):
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise ValueError("invalid queue process")


def owner_identity(native, route, *, target, room, homepod):
    """Validate a read-only exact-room observation, without granting an effect."""
    _object(native, NATIVE_KEYS)
    _object(route, ROUTE_KEYS)
    for key in NATIVE_KEYS - {"alias_revision"}:
        text = native[key]
        maximum = 160 if key == "account_user_id" else 255
        if (
            not isinstance(text, str)
            or not 1 <= len(text) <= maximum
            or any(ord(c) < 32 or ord(c) > 126 or c in '\\"' for c in text)
        ):
            raise ValueError("invalid queue native identity")
    if (native["target_id"], native["room_id"], native["homepod_id"]) != (target, room, homepod):
        raise ValueError("foreign queue owner")
    if type(native["alias_revision"]) is not int or not 0 <= native["alias_revision"] < 2**53:
        raise ValueError("invalid queue alias revision")
    _decimal(homepod, 1)
    _hex(native["alias_incarnation"], 32)
    _hex(native["alias_registry"], 64)
    _uuid(route["process"])
    for key in ROUTE_KEYS - {"process", "input_path_digest"}:
        _decimal(route[key], 0 if key in {"route_revision", "selection_revision"} else 1)
    if route["device_id"] != homepod:
        raise ValueError("foreign queue route")
    _hex(route["input_path_digest"], 64)
    return copy.deepcopy({"native": native, "route": route})


def owner_scope(native, route, writer, *, target, room, homepod):
    """Validate copied owner proof only; this does not establish current custody."""
    projected = owner_identity(native, route, target=target, room=room, homepod=homepod)
    _object(writer, WRITER_KEYS)
    process = writer["native_process"]
    _object(process, {"boot_id", "pid", "proc_start_ticks"})
    _uuid(process["boot_id"])
    _decimal(process["pid"], 1, 2**31 - 1)
    _decimal(process["proc_start_ticks"], 1)
    _decimal(writer["writer_fd"], 0, 2**31 - 1)
    _decimal(writer["source_epoch"])
    _decimal(writer["open_generation"], 1)
    pipe = writer["pipe_identity"]
    _object(pipe, {"device", "inode", "type"})
    _decimal(pipe["device"], 1)
    _decimal(pipe["inode"], 1)
    if pipe["type"] != "fifo" or writer["input_path_digest"] != route["input_path_digest"]:
        raise ValueError("foreign queue pipe")
    return {**projected, "writer_proof": copy.deepcopy(writer)}


def unique_members(pairs):
    """Reject duplicate nested JSON members before the closed shape validators."""
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate queue authority field")
        value[key] = item
    return value
