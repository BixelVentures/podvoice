"""Closed display projections of PodConnect's account-owned observation contracts."""

from __future__ import annotations

import json
import re
import time
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

SERVICES = {
    "playback": "get_playback_snapshot",
    "queue": "get_queue",
    "search": "search_tracks",
}
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
_ARTWORK_PATH = re.compile(r"^/image/[A-Za-z0-9_-]{1,128}$")
_TRACK_URI = re.compile(r"^spotify:track:[A-Za-z0-9]{22}$")


def normalize_search_query(value: Any) -> str:
    """Keep search text bounded and literal; it is never interpreted as markup."""
    if not isinstance(value, str):
        raise ValueError("invalid search query")
    query = value.strip()
    if not 1 <= len(query) <= 160:
        raise ValueError("invalid search query")
    return query


def _artwork(value: Any, *, kind: str = "album_cover") -> dict | None:
    """Accept only PodConnect's optional Spotify image reference; never arbitrary URLs."""
    if not isinstance(value, dict) or set(value) != {"kind", "provider", "url"}:
        return None
    url = value.get("url")
    if not isinstance(url, str) or not 1 <= len(url) <= 512:
        return None
    try:
        parsed = urlsplit(url)
        if (
            value.get("kind") != kind
            or value.get("provider") != "spotify"
            or parsed.scheme != "https"
            or parsed.hostname != "i.scdn.co"
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port is not None
            or parsed.query
            or parsed.fragment
            or not _ARTWORK_PATH.fullmatch(parsed.path)
            or (kind == "playlist_cover" and url != f"https://i.scdn.co{parsed.path}")
        ):
            return None
    except ValueError:
        return None
    return {"kind": kind, "provider": "spotify", "url": url}


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
    projected = {
        "type": kind,
        "uri": uri,
        "name": _text(value.get("name")),
        "artists": [_text(v) for v in artists],
        "duration_ms": _number(value.get("duration_ms")),
    }
    if kind == "track":
        artwork = _artwork(value.get("artwork"))
        if artwork is not None:
            projected["artwork"] = artwork
    return projected


def project_owner(kind: str, value: Any, account: str | None, *, query: str | None = None) -> dict:
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
        expected_schema = (
            "podconnect.search_tracks.v1" if kind == "search" else f"podconnect.{kind}.v1"
        )
        if value.get("config_entry_id") != account or value.get("schema") != expected_schema:
            raise ValueError("wrong account or schema")
        if kind == "search":
            expected_query = normalize_search_query(query)
            actual_query = normalize_search_query(value.get("query"))
            limit = value.get("limit")
            rows = value.get("tracks")
            if (
                actual_query != expected_query
                or value.get("source") != "spotify_web_api"
                or value.get("coverage") != "spotify_search_sample"
                or type(limit) is not int
                or limit != 3
                or not isinstance(rows, list)
                or len(rows) > limit
                or type(value.get("source_sample_count")) is not int
                or value["source_sample_count"] != len(rows)
                or type(value.get("returned_count")) is not int
                or value["returned_count"] != len(rows)
                or (
                    value.get("source_has_more") is not None
                    and type(value.get("source_has_more")) is not bool
                )
            ):
                raise ValueError("invalid search sample")
            tracks = []
            for row in rows:
                if not isinstance(row, dict) or set(row) - {"name", "artist", "uri", "artwork"}:
                    raise ValueError("invalid search track")
                track: dict[str, Any] = {
                    "name": _text(row.get("name"), 256),
                    "artist": _text(row.get("artist"), 512),
                    "uri": _text(row.get("uri"), 64),
                }
                if not _TRACK_URI.fullmatch(track["uri"]):
                    raise ValueError("invalid search URI")
                artwork = _artwork(row.get("artwork"))
                if artwork is not None:
                    track["artwork"] = artwork
                tracks.append(track)
            search_result: dict[str, Any] = {
                "ok": True,
                "data": {
                    "ok": True,
                    "schema": value["schema"],
                    "config_entry_id": account,
                    "source": "spotify_web_api",
                    "query": actual_query,
                    "coverage": "spotify_search_sample",
                    "limit": limit,
                    "source_sample_count": len(tracks),
                    "returned_count": len(tracks),
                    "source_has_more": value["source_has_more"],
                    "tracks": tracks,
                },
            }
            if len(json.dumps(search_result, allow_nan=False).encode()) > 65536:
                raise ValueError("search response exceeds budget")
            return search_result
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


def project_playlists(value, account, query):
    """Closed exact owner playlist projection; never forward provider metadata to AI."""
    try:
        if (
            not isinstance(value, dict)
            or value.get("ok") is not True
            or value.get("schema") != "podconnect.search_playlists.v1"
            or value.get("config_entry_id") != account
            or value.get("source") != "spotify_web_api"
            or value.get("query") != normalize_search_query(query)
            or value.get("limit") != 3
        ):
            return unavailable("malformed_response")
        epoch = _text(value.get("owner_epoch"), 128)
        rows = value.get("playlists")
        if not isinstance(rows, list) or len(rows) > 3 or value.get("returned_count") != len(rows):
            return unavailable("malformed_response")
        projected = []
        for row in rows:
            if not isinstance(row, dict) or set(row) - {"uri", "name", "artwork"}:
                return unavailable("malformed_response")
            uri = _text(row.get("uri"), 64)
            if re.fullmatch(r"spotify:playlist:[A-Za-z0-9]{22}", uri) is None:
                return unavailable("malformed_response")
            playlist: dict[str, Any] = {"uri": uri, "name": _text(row.get("name"), 256)}
            artwork = _artwork(row.get("artwork"), kind="playlist_cover")
            if artwork is not None:
                playlist["artwork"] = artwork
            projected.append(playlist)
        return {
            "ok": True,
            "data": {
                "config_entry_id": account,
                "owner_epoch": epoch,
                "source": "spotify_web_api",
                "playlists": projected,
            },
        }
    except (ValueError, TypeError):
        return unavailable("malformed_response")


def project_account_playlists(value: Any, account: str | None) -> dict:
    """First-page account library evidence, never search or synthetic recommendations."""
    try:
        _text(account)
        if not isinstance(value, dict):
            raise ValueError("invalid library")
        if value.get("ok") is not True:
            error = value.get("error_kind")
            return unavailable(
                error if isinstance(error, str) and error in _ERRORS else "unavailable"
            )
        if (
            set(value)
            != {
                "ok",
                "schema",
                "config_entry_id",
                "owner_epoch",
                "source",
                "coverage",
                "limit",
                "returned_count",
                "source_has_more",
                "playlists",
            }
            or value["schema"] != "podconnect.user_playlists.v1"
            or value["config_entry_id"] != account
            or value["source"] != "spotify_web_api"
            or value["coverage"] != "first_page"
            or type(value["limit"]) is not int
            or value["limit"] != 20
            or type(value["source_has_more"]) is not bool
        ):
            raise ValueError("invalid library provenance")
        epoch = _text(value["owner_epoch"], 128)
        rows = value["playlists"]
        if (
            not isinstance(rows, list)
            or len(rows) > 20
            or type(value["returned_count"]) is not int
            or value["returned_count"] != len(rows)
        ):
            raise ValueError("invalid library count")
        playlists = []
        seen = set()
        for row in rows:
            if not isinstance(row, dict) or set(row) - {"uri", "name", "artwork"}:
                raise ValueError("invalid library row")
            uri = _text(row.get("uri"), 64)
            if re.fullmatch(r"spotify:playlist:[A-Za-z0-9]{22}", uri) is None or uri in seen:
                raise ValueError("invalid playlist identity")
            seen.add(uri)
            playlist: dict[str, Any] = {"uri": uri, "name": _text(row.get("name"), 256)}
            artwork = _artwork(row.get("artwork"), kind="playlist_cover")
            if artwork is not None:
                playlist["artwork"] = artwork
            playlists.append(playlist)
        result = {
            "ok": True,
            "data": {
                "ok": True,
                "schema": "podconnect.user_playlists.v1",
                "config_entry_id": account,
                "owner_epoch": epoch,
                "source": "spotify_web_api",
                "coverage": "first_page",
                "limit": 20,
                "returned_count": len(playlists),
                "source_has_more": value["source_has_more"],
                "playlists": playlists,
            },
        }
        if len(json.dumps(result, allow_nan=False).encode()) > 65536:
            raise ValueError("library exceeds budget")
        return result
    except (ValueError, TypeError, KeyError, OverflowError):
        return unavailable("malformed_response")


def project_playback_output(value: Any, account: str | None) -> dict:
    """Validate Control's aggregate without interpreting or renewing its facts."""
    import copy
    import math

    metadata_keys = {
        "ok",
        "schema",
        "config_entry_id",
        "owner_epoch",
        "poll_sequence",
        "observation",
        "playback",
        "physical_result_verified",
    }
    try:
        if not isinstance(value, dict) or set(value) != metadata_keys | {"output"}:
            raise ValueError("invalid aggregate")
        if value["schema"] != "podconnect.playback.v2":
            raise ValueError("invalid aggregate schema")
        metadata = {key: copy.deepcopy(value[key]) for key in metadata_keys}
        metadata["schema"] = "podconnect.playback.v1"
        if set(metadata["observation"]) != {
            "status",
            "source",
            "observed_at",
            "age_ms",
            "max_age_ms",
        }:
            raise ValueError("invalid observation")
        playback = metadata["playback"]
        keys = {"state", "target", "item"}
        if playback.get("state") != "no_active_playback":
            keys |= {"progress_ms", "provider_changed_at_ms", "shuffle", "repeat"}
        if set(playback) != keys:
            raise ValueError("invalid playback")
        observation = metadata["observation"]
        stamp = datetime.fromisoformat(observation["observed_at"])
        maximum, age = observation["max_age_ms"], observation["age_ms"]
        if (
            stamp.tzinfo is None
            or type(maximum) is not int
            or type(age) is not int
            or not 0 < maximum <= 15000
            or age < 0
        ):
            raise ValueError("invalid observation freshness")
        if age > maximum or stamp.timestamp() + maximum / 1000 < time.time():
            return unavailable("stale")
        checked = project_owner("playback", metadata, account)
        if not checked.get("ok"):
            return checked
        if metadata != checked["data"]:
            raise ValueError("noncanonical metadata")
        output = value["output"]
        if not isinstance(output, dict) or set(output) != {"status", "reason", "binding"}:
            raise ValueError("invalid output")
        if output["status"] == "unavailable":
            if output["binding"] is not None or output["reason"] not in {
                "route_unavailable",
                "ambiguous_output",
                "owner_changed",
            }:
                raise ValueError("invalid absent output")
        elif output["status"] == "observed":
            actual = output["binding"]
            if (
                output["reason"] is not None
                or not isinstance(actual, dict)
                or set(actual)
                != {"target_id", "native_room_id", "homepod_id", "binding_id", "valid_until"}
            ):
                raise ValueError("invalid actual output")
            for key in ("target_id", "native_room_id", "homepod_id"):
                _text(actual[key])
            if (
                not isinstance(actual["binding_id"], str)
                or re.fullmatch(r"[a-f0-9]{64}", actual["binding_id"]) is None
            ):
                raise ValueError("invalid output identity")
            if (
                re.fullmatch(r"0|[1-9][0-9]{0,19}", actual["homepod_id"]) is None
                or int(actual["homepod_id"]) >= 2**64
            ):
                raise ValueError("invalid output device")
            until = actual["valid_until"]
            if (
                type(until) not in (int, float)
                or not math.isfinite(until)
                or until > time.time() + 5
            ):
                raise ValueError("invalid output expiry")
            if playback.get("target", {}).get("target_id") != actual["target_id"]:
                raise ValueError("foreign output target")
        else:
            raise ValueError("invalid output status")
        return {
            "ok": True,
            "data": {
                **metadata,
                "schema": "podconnect.playback.v2",
                "output": copy.deepcopy(output),
            },
        }
    except (ValueError, TypeError, KeyError, AttributeError):
        return unavailable("malformed_response")


def project_playback_controls(value: Any, account: str | None) -> dict:
    """Closed opt-in Control v3 facts; no offers, effects or inferred settlement."""
    import copy
    import math

    try:
        if not isinstance(value, dict) or value.get("schema") != "podconnect.playback.v3":
            raise ValueError("invalid controls aggregate")
        legacy = {key: copy.deepcopy(item) for key, item in value.items() if key != "controls"}
        legacy["schema"] = "podconnect.playback.v2"
        checked = project_playback_output(legacy, account)
        if not checked.get("ok"):
            return checked
        controls = value["controls"]
        if not isinstance(controls, dict) or set(controls) != {
            "status",
            "reason",
            "binding_id",
            "valid_until",
            "supported_actions",
            "volume",
        }:
            raise ValueError("invalid controls shape")
        output = checked["data"]["output"]
        if controls["status"] == "unavailable":
            if (
                output["status"] != "unavailable"
                or controls["reason"] != output["reason"]
                or controls["binding_id"] is not None
                or controls["valid_until"] is not None
                or controls["supported_actions"] != []
                or controls["volume"] is not None
            ):
                raise ValueError("invalid unavailable controls")
        elif controls["status"] == "observed":
            if output["status"] != "observed":
                raise ValueError("controls without actual output")
            actual = output["binding"]
            until = controls["valid_until"]
            observation = checked["data"]["observation"]
            source_until = (
                datetime.fromisoformat(observation["observed_at"]).timestamp()
                + observation["max_age_ms"] / 1000
            )
            if (
                controls["binding_id"] != actual["binding_id"]
                or type(until) not in (int, float)
                or not math.isfinite(until)
                or until != actual["valid_until"]
                or until > source_until
            ):
                raise ValueError("foreign or renewed controls")
            if until <= time.time():
                return unavailable("stale")
            actions = controls["supported_actions"]
            if (
                not isinstance(actions, list)
                or any(
                    not isinstance(action, str)
                    or action not in {"pause", "resume", "next", "previous", "volume"}
                    for action in actions
                )
                or len(actions) != len(set(actions))
            ):
                raise ValueError("invalid observed actions")
            volume = controls["volume"]
            if controls["reason"] == "volume_unavailable":
                if volume is not None or "volume" in actions:
                    raise ValueError("unavailable volume is not a measurement")
            elif controls["reason"] is None:
                if (
                    not isinstance(volume, dict)
                    or set(volume) != {"base_percent", "effective_percent"}
                    or any(type(v) is not int or not 0 <= v <= 100 for v in volume.values())
                ):
                    raise ValueError("invalid actual volume")
            else:
                raise ValueError("invalid partial controls reason")
        else:
            raise ValueError("invalid controls status")
        result = {
            **checked["data"],
            "schema": "podconnect.playback.v3",
            "controls": copy.deepcopy(controls),
        }
        if len(json.dumps(result, allow_nan=False).encode()) > 65536:
            raise ValueError("controls aggregate exceeds budget")
        return {"ok": True, "data": result}
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
        return unavailable("malformed_response")
