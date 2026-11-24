"""Read-only projection of the sole owner's typed, evidence-bound AI brief."""

from __future__ import annotations

import copy
import hashlib
import json
import math
import time
from datetime import datetime

from .podview_weather import MAX_RETRIEVAL_AGE_S, observation_is_current

_FIELDS = {
    "schema",
    "receiptId",
    "roomId",
    "sessionId",
    "turnId",
    "taskId",
    "inputRevision",
    "providerGeneration",
    "validUntil",
    "summary",
    "summaryKind",
    "weatherReceiptId",
    "evidenceFactIds",
    "weather",
}
_CORE = ("source", "location", "units", "current", "stateUpdatedAt", "forecastType", "forecast")


def _text(value: object, limit: int) -> bool:
    return isinstance(value, str) and 0 < len(value) <= limit and value.isprintable()


def _read_voice_brief(tools: object, room: str, owner: object) -> dict | None:
    """The owner checks session/turn/task/current/completed lifetime; never AI text."""
    sink = getattr(tools, "podview_receipts", None)
    reader = getattr(sink, "read_weather_brief", None)
    if reader is None or owner is None:
        return None
    try:
        value = reader(room, owner)
        if (
            not isinstance(value, dict)
            or set(value) != _FIELDS
            or value["schema"] != "podview.weather-brief.v1"
            or value["roomId"] != room
            or value["summaryKind"] != "ai_advice"
            or not _text(value["summary"], 240)
            or any(
                not _text(value[key], 160)
                for key in ("receiptId", "weatherReceiptId", "sessionId", "turnId", "taskId")
            )
            or any(
                type(value[key]) is not int or value[key] < 0
                for key in ("inputRevision", "providerGeneration")
            )
            or type(value["validUntil"]) not in (int, float)
            or not math.isfinite(value["validUntil"])
            or value["validUntil"] <= time.time()
            or not isinstance(value["evidenceFactIds"], list)
            or not 1 <= len(value["evidenceFactIds"]) <= 12
            or any(not _text(fact, 160) for fact in value["evidenceFactIds"])
            or len(set(value["evidenceFactIds"])) != len(value["evidenceFactIds"])
        ):
            return None
        weather = value["weather"]
        if (
            not isinstance(weather, dict)
            or weather.get("status") != "observed"
            or not observation_is_current(weather)
        ):
            return None
        data = weather["data"]
        retrieved = datetime.fromisoformat(data["retrievedAt"]).timestamp()
        if value["validUntil"] > retrieved + MAX_RETRIEVAL_AGE_S:
            return None
        return copy.deepcopy(value)
    except Exception:
        return None


def read_brief(tools: object, room: str, owner: object) -> dict | None:
    """Preserve current voice advice; otherwise read an independently owned brief."""
    voice = _read_voice_brief(tools, room, owner)
    if voice is not None:
        return voice
    passive = getattr(tools, "podview_weather_advice", None)
    if passive is None:
        return None
    from .podview_weather_advice import validated_brief

    try:
        return validated_brief(
            passive.read_brief(room),
            room,
            boot_id=passive.boot_id,
            source_is_current=observation_is_current,
            source_token=token,
            now=time.time(),
        )
    except Exception:
        return None


def token(value: dict | None) -> str | None:
    """Bind cache to all immutable owner/evidence/body fields, not just its label."""
    if value is None:
        return None
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False).encode()).hexdigest()
