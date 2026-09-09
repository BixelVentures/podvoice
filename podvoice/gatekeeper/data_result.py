"""Bounded data selection, never interpretation of a user's words or intent."""

from __future__ import annotations

import json

MAX_TOOL_RESULT_BYTES = 2_048
DEFAULT_DATA_LIMIT = 5


def tool_result_json(response: object) -> str:
    """The exact tool-output encoding sent to the provider (not schema encoding)."""
    return (
        response
        if isinstance(response, str)
        else json.dumps(response, ensure_ascii=False, separators=(",", ":"))
    )


def tool_result_size(response: object) -> int:
    return len(tool_result_json(response).encode("utf-8"))


def data_limit(args: dict) -> int:
    """Validate even direct router calls; bool/float are not integer limits."""
    limit = args.get("limit", DEFAULT_DATA_LIMIT)
    if set(args) - {"limit"} or type(limit) is not int or not 1 <= limit <= 50:
        raise ValueError("limit must be an integer from 1 to 50; no other filters are supported")
    return limit


def select_track_result(data: object, limit: int) -> dict:
    """Keep whole source rows in source order, with explicit *sample* coverage.

    No sorting, deduplication, date filtering or inferred library totals. Unknown
    fields remain intact; malformed rows fail instead of being silently skipped.
    """
    if not isinstance(data, dict):
        return _invalid_tracks()
    if data.get("ok") is False or data.get("success") is False or data.get("error"):
        return {"ok": False, "error_kind": "source_error", "data": data}
    if not isinstance(data.get("tracks"), list):
        return _invalid_tracks()
    tracks = data["tracks"]
    if any(
        not isinstance(row, dict)
        or any(
            not isinstance(row.get(key), str) or not row[key].strip()
            for key in ("name", "artist", "uri")
        )
        for row in tracks
    ):
        return _invalid_tracks()
    selected = tracks[:limit]
    selection = {
        "requested_limit": limit,
        "source_sample_count": len(tracks),
        "returned_count": len(selected),
        "more_in_sample": len(tracks) > len(selected),
        "size_limited": False,
        "coverage": "Source sample only; not a complete library or timestamped play history.",
    }
    result = {"ok": True, "data": {**data, "tracks": selected}, "selection": selection}
    if not tracks:
        result["empty"] = True
    while tool_result_size(result) > MAX_TOOL_RESULT_BYTES and selected:
        selected.pop()
        selection.update(returned_count=len(selected), more_in_sample=True, size_limited=True)
    if (tracks and not selected) or tool_result_size(result) > MAX_TOOL_RESULT_BYTES:
        return {
            "ok": False,
            "error_kind": "result_too_large",
            "error": "No complete requested record fits within the result limit.",
        }
    return result


def _invalid_tracks() -> dict:
    return {
        "ok": False,
        "error_kind": "invalid_result",
        "error": "The source did not return a valid track list; this is not an empty library.",
    }
