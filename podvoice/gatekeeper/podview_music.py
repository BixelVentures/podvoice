"""Closed display projections of PodConnect's account-owned observation contracts."""

from __future__ import annotations

import json
import time
from datetime import datetime
from typing import Any

SERVICES = {"playback": "get_playback_snapshot", "queue": "get_queue"}
_ERRORS = frozenset(
    {
        "unavailable",
        "stale",
        "busy",
        "authentication_required",
        "forbidden",
        "rate_limited",
        "malformed_response",
    }
)


def unavailable(kind: str = "unavailable") -> dict:
    return {"ok": False, "error_kind": kind, "retryAllowed": False}


def _text(value: Any, maximum: int = 1024) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= maximum:
        raise ValueError("invalid text")
    return value


def _number(value: Any, *, nullable: bool = True) -> int | None:
    if value is None and nullable:
        return None
    if type(value) is not int or not 0 <= value < 2**53:
        raise ValueError("invalid number")
    return value


def _timestamp(value: Any, max_age_ms: int) -> str:
    source = _text(value, 64)
    stamp = datetime.fromisoformat(source)
    if stamp.tzinfo is None or not -5000 <= (time.time() - stamp.timestamp()) * 1000 <= max_age_ms:
        raise ValueError("stale timestamp")
    return source


def _item(value: Any) -> dict | None:
    if value is None:
        return None
    if not isinstance(value, dict) or value.get("type") not in ("track", "episode"):
        raise ValueError("invalid item")
    kind = value["type"]
    uri = _text(value.get("uri"))
    if not uri.startswith(f"spotify:{kind}:") or not uri.removeprefix(f"spotify:{kind}:"):
        raise ValueError("invalid uri")
    artists = value.get("artists")
    if not isinstance(artists, list) or len(artists) > 20:
        raise ValueError("invalid artists")
    return {
        "type": kind,
        "uri": uri,
        "name": _text(value.get("name")),
        "artists": [_text(v) for v in artists],
        "duration_ms": _number(value.get("duration_ms")),
    }


def project_owner(kind: str, value: Any, account: str | None) -> dict:
    """Preserve source provenance, copying only fields admitted by the v1 contracts."""
    try:
        _text(account)
        if kind not in SERVICES or not isinstance(value, dict):
            return unavailable()
        if value.get("ok") is not True:
            error = value.get("error_kind")
            return unavailable(
                error if isinstance(error, str) and error in _ERRORS else "unavailable"
            )
        if (
            value.get("config_entry_id") != account
            or value.get("schema") != f"podconnect.{kind}.v1"
        ):
            raise ValueError("wrong account or schema")
        epoch = _text(value.get("owner_epoch"), 128)
        result: dict[str, Any] = {
            "ok": True,
            "schema": value["schema"],
            "config_entry_id": account,
            "owner_epoch": epoch,
        }
        if kind == "playback":
            sequence = _number(value.get("poll_sequence"), nullable=False)
            if (
                sequence is None
                or sequence < 1
                or value.get("physical_result_verified") is not False
            ):
                raise ValueError("missing poll provenance")
            observation = value.get("observation")
            if (
                not isinstance(observation, dict)
                or observation.get("status") != "fresh"
                or observation.get("source") != "spotify_web_api"
            ):
                raise ValueError("missing observation")
            maximum = _number(observation.get("max_age_ms"), nullable=False)
            age = _number(observation.get("age_ms"), nullable=False)
            if maximum is None or age is None or not 0 < maximum <= 15000 or age > maximum:
                return unavailable("stale")
            stamp = _timestamp(observation.get("observed_at"), maximum)
            playback = value.get("playback")
            if not isinstance(playback, dict):
                raise ValueError("missing playback")
            state = playback.get("state")
            projected: dict[str, Any]
            if state == "no_active_playback":
                if playback.get("target") is not None or playback.get("item") is not None:
                    raise ValueError("contradictory empty playback")
                projected = {"state": state, "target": None, "item": None}
            elif state in ("playing", "paused"):
                target = playback.get("target")
                if target is not None:
                    if not isinstance(target, dict) or target.get("kind") != "spotify_device":
                        raise ValueError("invalid target")
                    target = {
                        "kind": "spotify_device",
                        "target_id": _text(target.get("target_id")),
                        "name": None if target.get("name") is None else _text(target["name"]),
                    }
                shuffle, repeat = playback.get("shuffle"), playback.get("repeat")
                if (shuffle is not None and type(shuffle) is not bool) or repeat not in (
                    None,
                    "off",
                    "track",
                    "context",
                ):
                    raise ValueError("invalid controls observation")
                projected = {
                    "state": state,
                    "target": target,
                    "item": _item(playback.get("item")),
                    "progress_ms": _number(playback.get("progress_ms")),
                    "provider_changed_at_ms": _number(playback.get("provider_changed_at_ms")),
                    "shuffle": shuffle,
                    "repeat": repeat,
                }
            else:
                raise ValueError("unsupported state")
            result.update(
                poll_sequence=sequence,
                observation={
                    "status": "fresh",
                    "observed_at": stamp,
                    "age_ms": age,
                    "max_age_ms": maximum,
                    "source": "spotify_web_api",
                },
                playback=projected,
                physical_result_verified=False,
            )
        else:
            snapshot = _text(value.get("snapshot_id"), 256)
            if not snapshot.startswith(epoch + ":queue:"):
                raise ValueError("wrong queue owner")
            if (
                value.get("scope") != "account"
                or value.get("coverage") != "provider_response"
                or value.get("relation_to_playback") != "not_atomic"
            ):
                raise ValueError("invalid queue coverage")
            rows = value.get("items")
            if (
                not isinstance(rows, list)
                or len(rows) > 20
                or type(value.get("returned_count")) is not int
                or value["returned_count"] != len(rows)
                or type(value.get("truncated")) is not bool
            ):
                raise ValueError("invalid queue")
            items = []
            for index, row in enumerate(rows):
                item = _item(row)
                if item is None or row.get("option_id") != f"{snapshot}:{index}":
                    raise ValueError("invalid occurrence identity")
                items.append({"option_id": row["option_id"], **item})
            result.update(
                snapshot_id=snapshot,
                observed_at=_timestamp(value.get("observed_at"), 15000),
                scope="account",
                coverage="provider_response",
                relation_to_playback="not_atomic",
                currently_playing=_item(value.get("currently_playing")),
                items=items,
                returned_count=len(items),
                truncated=value["truncated"],
            )
        if len(json.dumps(result, allow_nan=False).encode()) > 65536:
            raise ValueError("response exceeds budget")
        return {"ok": True, "data": result}
    except (ValueError, TypeError, KeyError, OverflowError):
        return unavailable("malformed_response")
