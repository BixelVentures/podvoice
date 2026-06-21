#!/usr/bin/env python3
"""Spike S2 — 24 kHz speaker-playback latency (PLAN.md §4.5, risk RX3).

Run against a REAL Voice PE to settle whether we can play Gemini's 24 kHz PCM
dialogue out the device speaker with low enough latency and no underruns,
sustainably alongside continuous mic capture.

It generates a test tone and streams it to the device via
``send_voice_assistant_audio`` (the low-latency raw-PCM path, PLAN §4.5 Path 3),
in real-time-sized chunks, timing the send leg and reporting throughput. The
operator LISTENS for: (a) the tone starting promptly, (b) clean audio with no
clicks/dropouts/underruns. True mouth-to-ear latency needs an external mic and a
loopback; this measures the controllable software leg and surfaces underruns.

EXIT CRITERION (PLAN §4.5 / §12 Phase 1): <300 ms added latency, no underruns,
stable while mic capture runs.

Usage::

    pip install -r spikes/requirements.txt
    PODVOICE_NOISE_PSK=<psk> python spikes/s2_playback_latency.py --host voice-pe.local
    # options: --freq 440 --seconds 3 --rate 24000 --chunk-ms 20
"""

from __future__ import annotations

import argparse
import array
import asyncio
import math
import os
import time

from aioesphomeapi import APIClient  # VERIFY: import path / version

SAMPLE_WIDTH = 2


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="PodVoice spike S2 — playback latency")
    p.add_argument("--host", required=True, help="Voice PE host/IP")
    p.add_argument("--port", type=int, default=6053)
    p.add_argument("--psk", default=None, help="Noise PSK (or PODVOICE_NOISE_PSK)")
    p.add_argument("--freq", type=float, default=440.0, help="tone frequency Hz")
    p.add_argument("--seconds", type=float, default=3.0, help="tone duration")
    p.add_argument("--rate", type=int, default=24000, help="PCM sample rate (Gemini = 24000)")
    p.add_argument("--chunk-ms", type=int, default=20, help="chunk size for real-time pacing")
    p.add_argument(
        "--no-pace", action="store_true", help="send as fast as possible (throughput test)"
    )
    return p.parse_args()


def _make_tone(rate: int, freq: float, seconds: float, amp: float = 0.3) -> bytes:
    n = int(rate * seconds)
    fade = int(rate * 0.01)  # 10 ms fades to avoid clicks
    out = array.array("h")
    for i in range(n):
        env = min(1.0, i / fade) * min(1.0, (n - i) / fade)
        out.append(int(amp * env * 32767 * math.sin(2 * math.pi * freq * i / rate)))
    return out.tobytes()


async def _run(args: argparse.Namespace) -> int:
    psk = args.psk or os.environ.get("PODVOICE_NOISE_PSK") or None
    client = APIClient(args.host, args.port, "", noise_psk=psk)

    await client.connect(login=True)
    info = await client.device_info()
    print(f"connected: {info.name}")

    # The device must have an active voice-assistant session to accept audio; some
    # firmwares require a started pipeline. Subscribe so the device knows we're here.
    async def _noop(*_a: object, **_k: object):  # VERIFY: VA cb signatures
        return None

    client.subscribe_voice_assistant(handle_start=_noop, handle_stop=_noop, handle_audio=None)

    tone = _make_tone(args.rate, args.freq, args.seconds)
    chunk_bytes = max(2, (args.rate * args.chunk_ms // 1000) * SAMPLE_WIDTH)
    chunks = [tone[i : i + chunk_bytes] for i in range(0, len(tone), chunk_bytes)]
    audio_s = len(tone) / SAMPLE_WIDTH / args.rate
    period = args.chunk_ms / 1000.0

    print(
        f">>> LISTEN to the Voice PE speaker now — a {args.freq:.0f} Hz tone for {audio_s:.1f}s <<<"
    )
    print(
        f"streaming {len(chunks)} chunks ({args.chunk_ms} ms each) via send_voice_assistant_audio ..."
    )

    t_start = time.monotonic()
    for i, ch in enumerate(chunks):
        # VERIFY: send_voice_assistant_audio(data: bytes) — sync client method (PLAN §6 A.4).
        client.send_voice_assistant_audio(ch)
        if not args.no_pace:
            target = t_start + (i + 1) * period
            sleep = target - time.monotonic()
            if sleep > 0:
                await asyncio.sleep(sleep)
    send_s = time.monotonic() - t_start

    await asyncio.sleep(0.5)
    await client.disconnect()

    print("\n================ S2 RESULTS ================")
    print(f"audio duration       : {audio_s:.2f}s")
    print(
        f"send wall-clock      : {send_s:.2f}s  ({'paced real-time' if not args.no_pace else 'unpaced'})"
    )
    print(f"throughput ratio     : {audio_s / send_s:.2f}x real-time (>=1.0 means it keeps up)")
    print("\nOPERATOR CHECKLIST (you must judge by ear):")
    print("  [ ] tone started promptly after the stream began (<300 ms feel)")
    print("  [ ] no clicks / dropouts / underruns through the whole tone")
    print("  [ ] still clean when run alongside the S1 capture spike")
    print("If unpaced send is much slower than the audio duration, the device/path can't")
    print("sustain real-time 24 kHz → consider the resampler-speaker path (PLAN §4.5 Path 3).")
    print("============================================")
    return 0


def main() -> None:
    raise SystemExit(asyncio.run(_run(_parse_args())))


if __name__ == "__main__":
    main()
