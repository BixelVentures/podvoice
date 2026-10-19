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
