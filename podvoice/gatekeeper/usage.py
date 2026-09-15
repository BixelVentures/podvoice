"""Usage telemetry + cost estimate (Phase 1.5 — non-optional for a family device).

Every ``response.done`` carries token counts (voice.Usage). The meter accumulates
them per day, estimates USD from the published Realtime prices, persists across
restarts to the add-on's /data, and pushes two sensors into Home Assistant so
spend is visible on any dashboard:

- ``sensor.podvoice_cost_today``  (USD, resets at midnight)
- ``sensor.podvoice_cost_month``  (USD, calendar month)

Prices are an ESTIMATE (per 1M tokens, checked 2026-07 against secondary sources;
OpenAI's pricing page is the truth — see docs/realtime-config.md). Estimating a
few percent off is fine: the sensor exists to make a runaway day VISIBLE, not to
reconcile an invoice.
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime
import json
import logging
import math
import os
import pathlib

from . import constants as C
from .voice import Usage

_LOG = logging.getLogger("podvoice.usage")

USAGE_PATH = pathlib.Path("/data/podvoice-usage.json")

# USD per 1M tokens (model-id prefix -> rates). Longest prefix wins.
PRICES: dict[str, dict[str, float]] = {
    "gpt-realtime-2.1-mini": {
        "text_in": 0.60,
        "text_cached": 0.06,
        "text_out": 2.40,
        "audio_in": 10.00,
        "audio_cached": 0.30,
        "audio_out": 20.00,
    },
    "gpt-realtime": {  # gpt-realtime-2.1 / -2 / legacy — the "full" tier
        "text_in": 4.00,
        "text_cached": 0.40,
        "text_out": 24.00,
        "audio_in": 32.00,
        "audio_cached": 0.40,
        "audio_out": 64.00,
    },
}

_KEEP_DAYS = 92  # ~3 months of daily rows is plenty for a home dashboard
GPT_LIVE_TRANSCRIBE_USD_PER_MINUTE = 0.017
# Official model pages verified 2026-09-11. Voice seconds and Responses billing
# are separate. Never send these models through the Realtime price fallback.
# https://developers.openai.com/api/docs/models/gpt-live-1
# https://developers.openai.com/api/docs/models/gpt-5.6-luna
GPT_LIVE_USD_PER_MINUTE = 0.05
LIVE_PRICING_CHECKED = "2026-09-11"


def _live_backend_cost(model: str, usage: dict | None) -> tuple[float | None, str]:
    if usage is None:
        return None, "usage_missing"
    if model != "gpt-5.6-luna":
        return None, "model_price_unknown"
    if usage.get("service_tier") != "default":
        return None, "service_tier_unknown_or_unpriced"
    details = usage.get("input_tokens_details")
    if not isinstance(details, dict):
        return None, "cache_details_missing"
    cached, written = details.get("cached_tokens"), details.get("cache_write_tokens")
    if (
        type(cached) is not int
        or type(written) is not int
        or min(cached, written) < 0
        or cached + written > usage["input_tokens"]
    ):
        return None, "cache_details_invalid"
    if usage["input_tokens"] > 272000:
        return None, "long_context_price_not_implemented"
    uncached = usage["input_tokens"] - cached - written
    return (
        (uncached * 0.20 + cached * 0.02 + written * 0.25 + usage["output_tokens"] * 1.20)
        / 1_000_000,
        "standard_rates_estimate",
    )


def _valid_live_identity(session_id: str, generation: int, model: str) -> bool:
    return (
        isinstance(session_id, str)
        and 0 < len(session_id) <= 256
        and type(generation) is int
        and generation >= 0
        and isinstance(model, str)
        and 0 < len(model) <= 128
    )


def estimate_usd(model: str, u: Usage) -> float:
    """Estimated USD for one response's usage block."""
    rates = PRICES["gpt-realtime"]
    for prefix in sorted(PRICES, key=len, reverse=True):
        if model.startswith(prefix):
            rates = PRICES[prefix]
            break
    # Cached tokens are INCLUDED in input_*_tokens upstream — bill the cached part
    # at the cached rate and only the remainder at the full input rate.
    text_in = max(0, u.input_text_tokens - u.cached_text_tokens)
    audio_in = max(0, u.input_audio_tokens - u.cached_audio_tokens)
    usd = (
        text_in * rates["text_in"]
        + u.cached_text_tokens * rates["text_cached"]
        + audio_in * rates["audio_in"]
        + u.cached_audio_tokens * rates["audio_cached"]
        + u.output_text_tokens * rates["text_out"]
        + u.output_audio_tokens * rates["audio_out"]
        + u.input_image_tokens * max(rates["text_in"], rates["audio_in"])
        + u.unattributed_input_tokens * max(rates["text_in"], rates["audio_in"])
        + u.unattributed_output_tokens * max(rates["text_out"], rates["audio_out"])
    )
    return usd / 1_000_000


def _resolve(path: pathlib.Path | None) -> pathlib.Path:
    if path is not None:
        return path
    env = os.environ.get("PODVOICE_USAGE")
    return pathlib.Path(env) if env else USAGE_PATH


class UsageMeter:
    """Accumulates per-day token/cost totals; persists; pushes HA sensors.

    All entry points are best-effort: metering must never break a conversation.
    """

    def __init__(
        self,
        supervisor_token: str = "",
        client=None,  # httpx.AsyncClient (shared with the tool bridge)
        *,
        path: pathlib.Path | None = None,
    ) -> None:
        self._path = _resolve(path)
        self._token = supervisor_token
        self._client = client
        self._days: dict[str, dict] = {}
        self._live_sessions: dict[str, dict] = {}
        self._live_responses: dict[str, dict] = {}
        self._push_task: asyncio.Task | None = None
        try:
            if self._path.exists():
                data = json.loads(self._path.read_text())
                if isinstance(data.get("days"), dict):
                    self._days = data["days"]
                if isinstance(data.get("live_sessions"), dict):
                    self._live_sessions = data["live_sessions"]
                if isinstance(data.get("live_responses"), dict):
                    self._live_responses = data["live_responses"]
        except Exception as e:  # corrupt file must not stop the add-on
            _LOG.warning("could not read %s: %s — starting fresh", self._path, e)

    # ------------------------------------------------------------------ record
    def add(self, model: str, u: Usage, *, room: str = "?") -> float:
        """Record Realtime response usage; transcription duration is recorded separately."""
        usd = estimate_usd(model, u)
        day = self._days.setdefault(
            datetime.date.today().isoformat(),
            {"usd": 0.0, "audio_in": 0, "audio_out": 0, "text_in": 0, "text_out": 0},
        )
        day["usd"] = round(day["usd"] + usd, 6)
        day["audio_in"] += u.input_audio_tokens
        day["audio_out"] += u.output_audio_tokens
        day["text_in"] += u.input_text_tokens
        day["text_out"] += u.output_text_tokens
        self._prune()
        self._save()
        _LOG.info(
            "usage [%s %s]: +%d audio-in +%d audio-out tokens (~$%.4f) — today ~$%.2f",
            room,
            model,
            u.input_audio_tokens,
            u.output_audio_tokens,
            usd,
            self.today_usd(),
        )
        self._schedule_push()
        return usd

    def add_transcription_seconds(self, seconds: float, *, room: str = "?") -> float:
        """Conservatively record separately billed live input transcription duration."""
        seconds = max(0.0, float(seconds))
        if seconds == 0:
            return 0.0
        usd = seconds / 60.0 * GPT_LIVE_TRANSCRIBE_USD_PER_MINUTE
        day = self._days.setdefault(
            datetime.date.today().isoformat(),
            {"usd": 0.0, "audio_in": 0, "audio_out": 0, "text_in": 0, "text_out": 0},
        )
        day["usd"] = round(day.get("usd", 0.0) + usd, 6)
        day["transcription_seconds"] = round(
            float(day.get("transcription_seconds", 0.0)) + seconds, 3
        )
        day["transcription_usd"] = round(float(day.get("transcription_usd", 0.0)) + usd, 6)
        self._prune()
        self._save()
        _LOG.info(
            "usage [%s gpt-live-transcribe]: +%.3fs (~$%.6f) — today ~$%.2f",
            room,
            seconds,
            usd,
            self.today_usd(),
        )
        self._schedule_push()
        return usd

    def _live_day(self, date: str) -> dict:
        return self._days.setdefault(
            date, {"usd": 0.0, "audio_in": 0, "audio_out": 0, "text_in": 0, "text_out": 0}
        )

    def add_live_seconds(
        self,
        seconds: float | None,
        *,
        session_id: str,
        generation: int,
        model: str = "gpt-live-1",
        final: bool = False,
        backend_complete: bool = True,
        room: str = "?",
    ) -> float | None:
        """Record a cumulative snapshot once; finalization is separate from cost.

        Units are attributed to the date first observed for this session. Older
        snapshots cannot lower the counter or undo finalization. A contradictory
        final count remains explicitly incomplete instead of becoming a refund.
        """
        if (
            not _valid_live_identity(session_id, generation, model)
            or (
                seconds is not None
                and (type(seconds) not in (int, float) or not math.isfinite(seconds) or seconds < 0)
            )
            or type(final) is not bool
            or type(backend_complete) is not bool
        ):
            return None
        key = json.dumps([session_id, generation, model], separators=(",", ":"))
        record = self._live_sessions.get(key)
        if record is not None and (final or not record["final"]):
            # Pending work in an interim snapshot is not terminal lost usage.
            # Only a final snapshot can resolve it; stale interim events cannot
            # undo a completed session's accounting.
            if final or not backend_complete:
                record["backend_complete"] = backend_complete
            self._save()
            self._schedule_push()
        if seconds is None:
            if record is None:
                self._live_sessions[key] = {
                    "session_id": session_id,
                    "generation": generation,
                    "model": model,
                    "room": room,
                    "day": datetime.date.today().isoformat(),
                    "seconds": None,
                    "final": False,
                    "usd": None,
                    "conflict": False,
                    "pricing_checked": LIVE_PRICING_CHECKED,
                    "pricing_basis": "usage_missing",
                    "backend_complete": backend_complete,
                }
                self._live_day(self._live_sessions[key]["day"])
                self._prune()
                self._save()
                self._schedule_push()
            return None
        if record is not None and record["final"]:
            if final and seconds != record["seconds"]:
                record["conflict"] = True
                self._save()
                self._schedule_push()
            return 0.0 if record["usd"] is not None else None
        if record is None:
            record = {
                "session_id": session_id,
                "generation": generation,
                "model": model,
                "room": room,
                "day": datetime.date.today().isoformat(),
                "seconds": 0.0,
                "final": False,
                "usd": None,
                "conflict": False,
                "pricing_checked": LIVE_PRICING_CHECKED,
                "backend_complete": backend_complete,
            }
            self._live_sessions[key] = record
        previous = float(record["seconds"] or 0)
        if seconds < previous:
            if final:
                record["conflict"] = True
                self._save()
                self._schedule_push()
            return 0.0 if record["usd"] is not None else None
        record["seconds"] = float(seconds)
        record["final"] = final
        known = model == "gpt-live-1"
        delta = (seconds - previous) / 60.0 * GPT_LIVE_USD_PER_MINUTE if known else None
        record["usd"] = seconds / 60.0 * GPT_LIVE_USD_PER_MINUTE if known else None
        record["pricing_basis"] = "per_second_estimate" if known else "model_price_unknown"
        day = self._live_day(record["day"])
        day["live_voice_seconds"] = float(day.get("live_voice_seconds", 0)) + seconds - previous
        if delta is not None:
            day["live_voice_usd"] = float(day.get("live_voice_usd", 0)) + delta
            day["usd"] = round(float(day["usd"]) + delta, 9)
        self._prune()
        self._save()
        self._schedule_push()
        return delta

    def add_live_backend_usage(
        self,
        response_id: str,
        usage: dict | None,
        *,
        session_id: str,
        generation: int,
        model: str = "gpt-5.6-luna",
        room: str = "?",
    ) -> float | None:
        """Persist exact completed-response units; missing pricing is never free.

        A repeated identical terminal is inert across restarts. A missing-usage
        placeholder may be filled once by a later exact terminal snapshot.
        """
        if (
            not _valid_live_identity(session_id, generation, model)
            or not isinstance(response_id, str)
            or not 0 < len(response_id) <= 256
        ):
            return None
        valid = isinstance(usage, dict) and all(
            type(usage.get(field)) is int and usage[field] >= 0
            for field in ("input_tokens", "output_tokens", "total_tokens")
        )
        if valid and usage is not None:
            valid = usage["total_tokens"] == usage["input_tokens"] + usage["output_tokens"]
        units = None
        if valid and usage is not None:
            units = {
                field: usage[field] for field in ("input_tokens", "output_tokens", "total_tokens")
            }
            details = usage.get("input_tokens_details")
            if isinstance(details, dict):
                units["input_tokens_details"] = {
                    field: details[field]
                    for field in ("cached_tokens", "cache_write_tokens")
                    if type(details.get(field)) is int and details[field] >= 0
                }
            if usage.get("service_tier") in ("default", "priority", "flex", "auto"):
                units["service_tier"] = usage["service_tier"]
        key = json.dumps([session_id, generation, model, response_id], separators=(",", ":"))
        old = self._live_responses.get(key)
        if old is not None and old["usage"] is not None:
            if units is not None and old["usage"] != units:
                old["conflict"] = True
                self._save()
                self._schedule_push()
            return 0.0 if old["usd"] is not None else None
        usd, basis = _live_backend_cost(model, units)
        record: dict = {
            "session_id": session_id,
            "generation": generation,
            "model": model,
            "response_id": response_id,
            "room": room,
            "day": old["day"] if old else datetime.date.today().isoformat(),
            "usage": units,
            "usd": usd,
            "pricing_basis": basis,
            "pricing_checked": LIVE_PRICING_CHECKED,
            "conflict": False,
        }
        self._live_responses[key] = record
        day = self._live_day(record["day"])
        if units is not None:
            day["live_backend_tokens"] = (
                int(day.get("live_backend_tokens", 0)) + units["total_tokens"]
            )
        if usd is not None:
            day["live_backend_usd"] = float(day.get("live_backend_usd", 0)) + usd
            day["usd"] = round(float(day["usd"]) + usd, 9)
        self._prune()
        self._save()
        self._schedule_push()
        return usd

    def live_cost_status(self, period: str = "today") -> dict:
        if period not in ("today", "month"):
            raise ValueError("period must be today or month")
        date = datetime.date.today().isoformat()
        prefix = date if period == "today" else date[:7]
        voices = [r for r in self._live_sessions.values() if r["day"].startswith(prefix)]
        responses = [r for r in self._live_responses.values() if r["day"].startswith(prefix)]
        unknown = sum(r["usd"] is None or r.get("conflict", False) for r in voices + responses)
        unfinalized = sum(not r["final"] for r in voices)
        backend_incomplete = sum(not r.get("backend_complete", True) for r in voices)
        return {
            "has_live_usage": bool(voices or responses),
            "cost_complete": not unknown and not unfinalized and not backend_incomplete,
            "live_backend_sessions_incomplete": backend_incomplete,
            "unpriced_live_records": unknown,
            "live_sessions_unfinalized": unfinalized,
            "live_voice_seconds": sum(r["seconds"] or 0 for r in voices),
            "live_voice_units_unknown": sum(r["seconds"] is None for r in voices),
            "live_backend_tokens": sum(
                (r["usage"] or {}).get("total_tokens", 0) for r in responses
            ),
            "known_cost_usd": self.today_usd() if period == "today" else self.month_usd(),
        }

    def today_usd(self) -> float:
        return float(self._days.get(datetime.date.today().isoformat(), {}).get("usd", 0.0))

    def month_usd(self) -> float:
        prefix = datetime.date.today().strftime("%Y-%m")
        return float(sum(d.get("usd", 0.0) for k, d in self._days.items() if k.startswith(prefix)))

    # ------------------------------------------------------------------ plumbing
    def _prune(self) -> None:
        if len(self._days) <= _KEEP_DAYS:
            return
        for k in sorted(self._days)[: len(self._days) - _KEEP_DAYS]:
            del self._days[k]
        for ledger in (self._live_sessions, self._live_responses):
            for key in list(ledger):
                if ledger[key]["day"] not in self._days:
                    del ledger[key]

    def _save(self) -> None:
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(
                json.dumps(
                    {
                        "days": self._days,
                        "live_sessions": self._live_sessions,
                        "live_responses": self._live_responses,
                    },
                    indent=1,
                )
            )
        except Exception as e:
            _LOG.debug("usage save failed: %s", e)

    def _schedule_push(self) -> None:
        """Debounced HA-sensor push (a burst of responses = one POST pair)."""
        if not self._token or self._client is None:
            return
        if self._push_task is not None and not self._push_task.done():
            return
        try:
            self._push_task = asyncio.get_running_loop().create_task(self._push_soon())
        except RuntimeError:  # no loop (unit tests) — sensors just don't push
            pass

    async def _push_soon(self) -> None:
        await asyncio.sleep(10)
        await self.push_sensors()

    async def push_sensors(self) -> None:
        """POST the two cost sensors into HA (REST states API, best-effort)."""
        if not self._token or self._client is None:
            return
        headers = {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}
        month = datetime.date.today().strftime("%Y-%m")
        sensors: dict[str, dict] = {
            "sensor.podvoice_cost_today": {
                "state": f"{self.today_usd():.2f}",
                "attributes": {
                    "unit_of_measurement": "USD",
                    "friendly_name": "PodVoice cost today",
                    "icon": "mdi:cash",
                    "estimate": True,
                },
            },
            "sensor.podvoice_cost_month": {
                "state": f"{self.month_usd():.2f}",
                "attributes": {
                    "unit_of_measurement": "USD",
                    "friendly_name": f"PodVoice cost {month}",
                    "icon": "mdi:cash-multiple",
                    "estimate": True,
                },
            },
        }
        for entity_id, body in sensors.items():
            status = self.live_cost_status("today" if entity_id.endswith("today") else "month")
            if status["has_live_usage"]:
                body["attributes"].update(status)
                if not status["cost_complete"]:
                    body["state"] = "unknown"
            with contextlib.suppress(Exception):  # HA down must never break a conversation
                await self._client.post(
                    f"{C.SUPERVISOR_CORE_API}/states/{entity_id}", json=body, headers=headers
                )
