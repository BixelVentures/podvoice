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
        self._push_task: asyncio.Task | None = None
        try:
            if self._path.exists():
                data = json.loads(self._path.read_text())
                if isinstance(data.get("days"), dict):
                    self._days = data["days"]
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

    def _save(self) -> None:
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps({"days": self._days}, indent=1))
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
        sensors = {
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
            with contextlib.suppress(Exception):  # HA down must never break a conversation
                await self._client.post(
                    f"{C.SUPERVISOR_CORE_API}/states/{entity_id}", json=body, headers=headers
                )
