"""Bounded analysis of completed recordings; never participates in a voice turn.

The separate transcription model provides diagnostic text, not acoustic proof.
Provider VAD offsets describe submitted audio, not wall time or physical speech.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import io
import json
import math
import os
import re
import stat
import sys
import time
import wave
from array import array
from pathlib import Path
from typing import Any

import httpx

from .provider_budget import PROVIDER_BUDGET, BudgetLease, ProviderBudgetUnavailable

MODEL = "gpt-4o-transcribe"
MAX_SECONDS = 8
DEADLINE_SECONDS = 45
_START = "provider_input_audio_buffer_speech_started"
_STOP = "provider_input_audio_buffer_speech_stopped"
_ID = re.compile(r"[0-9A-Za-z_-]{1,80}\Z")


def _read(directory: Path, name: str, maximum: int) -> bytes:
    """Open only a bounded regular file directly below the trusted capture directory."""
    folder = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=folder)
        with os.fdopen(fd, "rb") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
                raise ValueError("Optagelsesfilen er ugyldig eller for stor.")
            data = source.read(maximum + 1)
            if len(data) > maximum or len(data) != info.st_size:
                raise ValueError("Optagelsesfilen ændrede størrelse under læsning.")
            return data
    finally:
        os.close(folder)


def _pcm(data: bytes, rate: int) -> bytes:
    with wave.open(io.BytesIO(data), "rb") as source:
        if (
            source.getnchannels() != 1
            or source.getsampwidth() != 2
            or source.getframerate() != rate
            or source.getcomptype() != "NONE"
            or not 0 < source.getnframes() <= rate * 60
        ):
            raise ValueError("Lydformatet er ikke den forventede mono PCM16-optagelse.")
        pcm = source.readframes(source.getnframes())
        if len(pcm) != source.getnframes() * 2:
            raise ValueError("Lydoptagelsen er afkortet.")
        return pcm


def _wav(pcm: bytes, rate: int) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(rate)
        target.writeframes(pcm)
    return output.getvalue()


def _metrics(pcm: bytes, rate: int) -> dict[str, Any]:
    samples = array("h")
    samples.frombytes(pcm)
    if sys.byteorder != "little":
        samples.byteswap()
    window = rate // 50
    envelope = []
    for offset in range(0, len(samples), window):
        block = samples[offset : offset + window]
        envelope.append(round(math.sqrt(sum(int(x) ** 2 for x in block) / len(block)), 1))
    return {
        "samples": len(samples),
        "rate": rate,
        "duration_ms": round(len(samples) * 1000 / rate),
        "sha256_pcm": hashlib.sha256(pcm).hexdigest(),
        "rms_20ms": envelope,
        "peak_pct": round(max((abs(int(x)) for x in samples), default=0) * 100 / 32768, 2),
        "zero_samples": samples.count(0),
    }


def prepare(directory: Path, trace_id: str) -> tuple[dict[str, Any], list[bytes]]:
    if not isinstance(trace_id, str) or not _ID.fullmatch(trace_id):
        raise ValueError("Ugyldigt optagelses-id.")
    manifest_bytes = _read(directory, trace_id + ".json", 1024 * 1024)
    manifest = json.loads(manifest_bytes)
    if (
        not isinstance(manifest, dict)
        or manifest.get("id") != trace_id
        or not manifest.get("finished_at")
    ):
        raise ValueError("Optagelsen er ikke afsluttet.")
    events = manifest.get("events")
    if (
        not isinstance(events, list)
        or len(events) > 4096
        or not all(isinstance(e, dict) for e in events)
    ):
        raise ValueError("Optagelsens tidslinje er ugyldig.")
    if any(e.get("event") in {"capture_limit", "provider_trace_truncated"} for e in events):
        raise ValueError("Optagelsen eller dens tidslinje er afkortet.")
    starts = [e for e in events if e.get("event") == _START]
    if not starts:
        raise ValueError("Første input mangler providerens lydgrænser.")
    first = starts[0]
    item, generation = first.get("item_id"), first.get("generation")
    if not isinstance(item, str) or not item or type(generation) is not int:
        raise ValueError("Første inputs ejerskab mangler.")
    stops = [
        e
        for e in events
        if e.get("event") == _STOP
        and e.get("item_id") == item
        and e.get("generation") == generation
    ]
    if len(stops) != 1 or sum(e.get("item_id") == item for e in starts) != 1:
        raise ValueError("Første inputs grænser er ikke entydige.")
    stop = stops[0]
    first_index, stop_index = events.index(first), events.index(stop)
    if stop_index <= first_index:
        raise ValueError("Første inputs events står i forkert rækkefølge.")
    connected = [e for e in events if e.get("event") == "provider_connected"]
    if (
        len(connected) != 1
        or connected[0] not in events[:first_index]
        or connected[0].get("provider_generation") != generation
    ):
        raise ValueError("Optagelsen har ikke én entydig providerforbindelse.")
    if any(e.get("event") == _START for e in events[first_index + 1 : stop_index]):
        raise ValueError("Første input overlapper et andet provider-item.")
    if any(
        e.get("event") in {"input_quarantine_started", "playback_requested", "playback_started"}
        or "clear" in str(e.get("event", ""))
        or (
            e.get("event", "").startswith("provider_")
            and type(e.get("generation")) is int
            and e["generation"] != generation
        )
        for e in events[: stop_index + 1]
    ):
        raise ValueError("Lydurets oprindelse er usikker før første input.")
    begin, end = first.get("audio_start_ms"), stop.get("audio_end_ms")
    if type(begin) is not int or type(end) is not int or not 0 <= begin < end <= MAX_SECONDS * 1000:
        raise ValueError("Første input mangler gyldige provider-offsets.")
    provider_file = _read(directory, trace_id + "-provider.wav", 60 * 24000 * 2 + 4096)
    device_file = _read(directory, trace_id + "-device.wav", 60 * 16000 * 2 + 4096)
    provider, device = _pcm(provider_file, 24000), _pcm(device_file, 16000)
    if end * 24 * 2 > len(provider):
        raise ValueError("Første input ligger uden for den gemte lyd.")
    stages = manifest.get("stages", {})
    if any(
        stages.get(name, {}).get("samples") != len(pcm) // 2
        for name, pcm in (("provider", provider), ("device", device))
    ):
        raise ValueError("Lydfilerne matcher ikke manifestets sampleantal.")
    segments = [
        ("first_provider_item", provider[begin * 48 : end * 48], 24000),
        ("provider_context", provider[: MAX_SECONDS * 24000 * 2], 24000),
        ("device_context", device[: MAX_SECONDS * 16000 * 2], 16000),
    ]
    report = {
        "trace_id": trace_id,
        "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "provider_file_sha256": hashlib.sha256(provider_file).hexdigest(),
        "device_file_sha256": hashlib.sha256(device_file).hexdigest(),
        "item_id": item,
        "generation": generation,
        "audio_start_ms": begin,
        "audio_end_ms": end,
        "model": MODEL,
        "physical_proof": False,
        "note": "Transskription er en ny modelfortolkning, ikke akustisk bevis. De to kontekstspor har separate lydure; provider-sporet kan indeholde syntetisk stilhed.",
        "segments": [{"name": name, **_metrics(pcm, rate)} for name, pcm, rate in segments],
    }
    return report, [_wav(pcm, rate) for _, pcm, rate in segments]


class AudioAnalysis:
    """One key-global diagnostic job; same trace is cached, never automatically retried."""

    def __init__(self, directory: Path, api_key: str, *, transport=None, budget=PROVIDER_BUDGET):
        self.directory, self._key = directory, api_key
        self._transport, self._budget = transport, budget
        self._task: asyncio.Task | None = None
        self._result: dict[str, Any] = {"status": "idle"}
        self._finished = 0.0

    def status(self) -> dict[str, Any]:
        if self._finished and time.monotonic() - self._finished > 1800:
            self._result = {"status": "idle"}
            self._finished = 0.0
        return copy.deepcopy(self._result)

    def start(self, trace_id: str) -> dict[str, Any]:
        if not self._key:
            return {"status": "unavailable", "error": "OpenAI er ikke konfigureret."}
        if not isinstance(trace_id, str) or not _ID.fullmatch(trace_id):
            return {"status": "invalid", "error": "Ugyldigt optagelses-id."}
        existing = self.status()
        if existing.get("trace_id") == trace_id:
            return existing
        if self._task is not None and not self._task.done():
            return {"status": "busy", "error": "En lydanalyse er allerede i gang."}
        try:
            lease = self._budget.diagnostic_started(self._key)
        except ProviderBudgetUnavailable:
            return {"status": "busy", "error": "En samtale eller anden diagnose er i gang."}
        self._result = {"status": "running", "trace_id": trace_id}
        self._finished = 0.0
        self._task = asyncio.create_task(self._run(trace_id, lease))
        self._task.add_done_callback(lambda task: self._finish(task, trace_id, lease))
        return self.status()

    def _finish(self, task: asyncio.Task, trace_id: str, lease: BudgetLease) -> None:
        # A task cancelled before its first instruction never enters _run's finally.
        if task is self._task:
            if task.cancelled():
                self._result = {"status": "cancelled", "trace_id": trace_id}
            self._finished = time.monotonic()
        self._budget.release(lease)

    async def _run(self, trace_id: str, lease: BudgetLease) -> None:
        try:
            async with asyncio.timeout(DEADLINE_SECONDS):
                report, files = await asyncio.to_thread(prepare, self.directory, trace_id)
                async with httpx.AsyncClient(
                    timeout=15, transport=self._transport, follow_redirects=False
                ) as client:
                    for segment, wav_data in zip(report["segments"], files, strict=True):
                        async with client.stream(
                            "POST",
                            "https://api.openai.com/v1/audio/transcriptions",
                            headers={"Authorization": "Bearer " + self._key},
                            data={"model": MODEL, "language": "da", "response_format": "json"},
                            files={"file": ("segment.wav", wav_data, "audio/wav")},
                        ) as response:
                            response.raise_for_status()
                            body = bytearray()
                            async for chunk in response.aiter_bytes(chunk_size=4096):
                                body.extend(chunk)
                                if len(body) > 16384:
                                    raise ValueError("Transskriptionssvaret er for stort.")
                            decoded = json.loads(body)
                            text = decoded.get("text") if isinstance(decoded, dict) else None
                            if not isinstance(text, str) or len(text) > 4000:
                                raise ValueError("Transskriptionssvaret er ugyldigt.")
                            segment["transcript"] = text
                self._result = {"status": "completed", **report}
        except asyncio.CancelledError:
            self._result = {"status": "cancelled", "trace_id": trace_id}
            raise
        except (ValueError, OSError, wave.Error):
            self._result = {
                "status": "failed",
                "trace_id": trace_id,
                "error": "Optagelsen eller analyseresultatet bestod ikke valideringen.",
            }
        except (TimeoutError, httpx.HTTPError):
            self._result = {
                "status": "failed",
                "trace_id": trace_id,
                "error": "Transskription fejlede eller nåede tidsgrænsen. Ingen automatisk gentagelse.",
            }
        except Exception:
            self._result = {
                "status": "failed",
                "trace_id": trace_id,
                "error": "Analysen fejlede. Optagelsen er uændret.",
            }

    async def close(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
