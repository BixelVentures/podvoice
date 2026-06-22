"""Voice PE diagnostics — the S1/S2 spikes as in-panel, server-side checks.

Runs against the configured device over the ESPHome native API (aioesphomeapi,
lazy-imported) so the panel can offer click-only setup instead of CLI spikes.
Every function returns a plain dict (never raises) so the panel always gets a
friendly result, even with no device / no aioesphomeapi installed.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time

from . import audio as audio_mod
from . import constants as C

_LOG = logging.getLogger("podvoice.diag")

SAMPLE_WIDTH = 2


def resolve_target(settings: dict, room: str | None = None) -> tuple[str | None, str]:
    """Pick (voicepe_host, noise_psk) from saved settings — pure, unit-testable."""
    rooms = settings.get("rooms") or []
    match = None
    if room:
        match = next(
            (r for r in rooms if r.get("room") == room or r.get("voicepe_host") == room), None
        )
    elif rooms:
        match = rooms[0]
    host = (match or {}).get("voicepe_host") or settings.get("voicepe_host") or None
    psk = (match or {}).get("voicepe_noise_psk") or settings.get("voicepe_noise_psk") or ""
    return host, psk


async def _client(host: str, psk: str):
    from aioesphomeapi import APIClient  # lazy: module imports without the SDK

    client = APIClient(host, C.ESPHOME_API_PORT, "", noise_psk=psk or None)
    await client.connect(login=True)
    return client


async def check_status(host: str | None, psk: str) -> dict:
    """Is the Voice PE reachable over the encrypted native API?"""
    if not host:
        return {"ok": False, "error": "No Voice PE host set — add a room in Settings first."}
    client = None
    try:
        client = await _client(host, psk)
        info = await client.device_info()
        return {
            "ok": True,
            "host": host,
            "name": getattr(info, "name", host),
            "esphome": getattr(info, "esphome_version", "?"),
        }
    except Exception as e:
        return {"ok": False, "host": host, "error": str(e)}
    finally:
        if client is not None:
            with contextlib.suppress(Exception):
                await client.disconnect()


async def run_s1(host: str | None, psk: str, seconds: float = 15.0) -> dict:
    """S1: measure continuity of the raw mic stream (PLAN §4.2)."""
    if not host:
        return {"ok": False, "error": "No Voice PE host set — add a room in Settings first."}
    frames: list[tuple[float, int]] = []
    client = None
    try:
        client = await _client(host, psk)

        async def handle_audio(data: bytes, *_a: object) -> None:  # VERIFY: (data, end)
            frames.append((time.monotonic(), len(data)))

        async def _noop(*_a: object, **_k: object):
            return None

        unsub = client.subscribe_voice_assistant(
            handle_start=_noop, handle_stop=_noop, handle_audio=handle_audio
        )
        await asyncio.sleep(seconds)
        unsub()
    except Exception as e:
        return {"ok": False, "host": host, "error": str(e)}
    finally:
        if client is not None:
            with contextlib.suppress(Exception):
                await client.disconnect()

    if len(frames) < 2:
        return {
            "ok": False,
            "verdict": "no-audio",
            "frames": len(frames),
            "hint": "No audio received. Trigger the device (wake word / button) and make sure it "
            "is NOT added to HA Assist (PodVoice must own the mic).",
        }
    span = frames[-1][0] - frames[0][0]
    audio_s = sum(n for _, n in frames) / SAMPLE_WIDTH / C.GEMINI_INPUT_RATE
    gaps = [(frames[i][0] - frames[i - 1][0]) * 1000 for i in range(1, len(frames))]
    big = [g for g in gaps if g > 60]
    continuity = (audio_s / span * 100) if span else 0.0
    passed = not big and continuity > 95 and span >= seconds * 0.8
    return {
        "ok": True,
        "verdict": "pass" if passed else "gaps",
        "frames": len(frames),
        "seconds": round(span, 1),
        "continuity_pct": round(continuity, 1),
        "gaps_over_60ms": len(big),
        "max_gap_ms": round(max(gaps), 1),
        "hint": ""
        if passed
        else "Gaps detected — likely needs the custom-firmware continuous-stream "
        "mechanism (PLAN §4.2 Option C/B).",
    }


async def run_s2(host: str | None, psk: str, seconds: float = 1.2) -> dict:
    """S2: play a test tone out the Voice PE speaker (PLAN §4.5). Judge by ear."""
    if not host:
        return {"ok": False, "error": "No Voice PE host set — add a room in Settings first."}
    client = None
    try:
        client = await _client(host, psk)

        async def _noop(*_a: object, **_k: object):
            return None

        client.subscribe_voice_assistant(handle_start=_noop, handle_stop=_noop, handle_audio=None)
        tone = audio_mod.error_tone(C.GEMINI_OUTPUT_RATE)  # short 24 kHz tone
        reps = max(1, int(seconds / (len(tone) / SAMPLE_WIDTH / C.GEMINI_OUTPUT_RATE)))
        chunk = C.GEMINI_OUTPUT_RATE * SAMPLE_WIDTH * 20 // 1000  # 20 ms
        for _ in range(reps):
            for i in range(0, len(tone), chunk):
                client.send_voice_assistant_audio(tone[i : i + chunk])  # VERIFY: sync method
                await asyncio.sleep(0.02)
        await asyncio.sleep(0.3)
    except Exception as e:
        return {"ok": False, "host": host, "error": str(e)}
    finally:
        if client is not None:
            with contextlib.suppress(Exception):
                await client.disconnect()
    return {
        "ok": True,
        "verdict": "played",
        "hint": "Did you hear the tone on the Voice PE speaker?",
    }
