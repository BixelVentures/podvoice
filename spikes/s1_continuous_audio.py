#!/usr/bin/env python3
"""Spike S1 — continuous-audio mechanism (PLAN.md §4.2, risk RX1).

Run this against a REAL custom-firmware Voice PE to settle the project's #1
unknown: can we get a sustained, gap-free 16 kHz / 16-bit / mono PCM stream out
of the device over the ESPHome native API to an external client?

It connects with the Noise PSK, subscribes to the voice-assistant audio stream
(passing ``handle_audio`` auto-enables API audio), then measures every frame:
size, inter-frame gap, effective sample rate, and gap events. You trigger the
device (press the center button / say the wake word, or rely on
``voice_assistant.start_continuous`` in the firmware) and watch the numbers.

EXIT CRITERION (PLAN §4.2 / §12 Phase 1): sustained gap-free 16 kHz for the full
duration (default 10 min), with the mute switch correctly zeroing/stopping it.

Usage::

    pip install -r spikes/requirements.txt
    PODVOICE_NOISE_PSK=<base64-psk> python spikes/s1_continuous_audio.py --host voice-pe.local
    # or: python spikes/s1_continuous_audio.py --host 192.168.1.42 --psk <psk> --duration 600

Then physically trigger the device and (optionally) toggle the mute switch.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import os
import signal
import time

from aioesphomeapi import APIClient  # VERIFY: import path / version (pin in requirements)

GAP_WARN_MS_DEFAULT = 60.0  # an inter-frame gap above this is flagged
EXPECTED_RATE_HZ = 16000
SAMPLE_WIDTH = 2  # 16-bit


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="PodVoice spike S1 — continuous audio")
    p.add_argument("--host", required=True, help="Voice PE host/IP (e.g. voice-pe.local)")
    p.add_argument("--port", type=int, default=6053, help="ESPHome native API port")
    p.add_argument("--psk", default=None, help="Noise PSK (or set PODVOICE_NOISE_PSK)")
    p.add_argument("--duration", type=float, default=600.0, help="measurement seconds")
    p.add_argument("--gap-ms", type=float, default=GAP_WARN_MS_DEFAULT, help="gap warn threshold")
    return p.parse_args()


def _report(frames: list[tuple[float, int]], gap_ms: float, duration: float) -> int:
    if len(frames) < 2:
        print("\nNO AUDIO RECEIVED. The device never streamed frames.")
        print("→ Trigger it (button / wake word) while the spike runs, and confirm PodVoice")
        print("  is the sole voice-assistant client (device NOT added to HA Assist). RX2.")
        return 1

    t0 = frames[0][0]
    t_last = frames[-1][0]
    span = t_last - t0
    total_bytes = sum(n for _, n in frames)
    audio_s = total_bytes / SAMPLE_WIDTH / EXPECTED_RATE_HZ
    gaps_ms = [(frames[i][0] - frames[i - 1][0]) * 1000 for i in range(1, len(frames))]
    big = [g for g in gaps_ms if g > gap_ms]
    sizes = [n for _, n in frames]

    print("\n================ S1 RESULTS ================")
    print(f"frames received      : {len(frames)}")
    print(f"wall-clock span      : {span:.1f}s (target {duration:.0f}s)")
    print(f"audio delivered      : {audio_s:.1f}s of 16 kHz PCM")
    print(f"continuity ratio     : {audio_s / span * 100:.1f}%  (100% == real-time, gap-free)")
    print(
        f"frame size bytes     : min {min(sizes)} / max {max(sizes)} / mean {sum(sizes) // len(sizes)}"
    )
    print(f"inter-frame gap ms   : min {min(gaps_ms):.1f} / max {max(gaps_ms):.1f}")
    print(f"gaps > {gap_ms:.0f}ms        : {len(big)}")
    if big:
        print(
            f"  worst gaps (ms)    : {', '.join(f'{g:.0f}' for g in sorted(big, reverse=True)[:10])}"
        )

    ok = not big and audio_s / span > 0.95 and span >= duration * 0.9
    print(
        "\nVERDICT:", "PASS — gap-free continuous stream ✅" if ok else "FAIL — see gaps above ❌"
    )
    if not ok:
        print("→ Option A (start_continuous) likely shows gaps at user-silence boundaries.")
        print("  Try Option C (hold STREAMING_MICROPHONE) or B (custom mic streamer). PLAN §4.2.")
    print("============================================")
    return 0 if ok else 2


async def _run(args: argparse.Namespace) -> int:
    psk = args.psk or os.environ.get("PODVOICE_NOISE_PSK") or None
    client = APIClient(args.host, args.port, "", noise_psk=psk)
    frames: list[tuple[float, int]] = []
    stop = asyncio.Event()

    async def handle_audio(data: bytes, *_rest: object) -> None:  # VERIFY: (data, end) shape
        frames.append((time.monotonic(), len(data)))

    async def handle_start(*_a: object, **_k: object):  # VERIFY: VA start cb
        return None

    async def handle_stop(*_a: object, **_k: object) -> None:  # VERIFY: VA stop cb
        return None

    await client.connect(login=True)
    info = await client.device_info()
    print(f"connected: {info.name} (esphome {getattr(info, 'esphome_version', '?')})")
    unsub = client.subscribe_voice_assistant(
        handle_start=handle_start, handle_stop=handle_stop, handle_audio=handle_audio
    )
    print("subscribed (API audio enabled).")
    print(">>> TRIGGER THE DEVICE NOW: press the center button or say the wake word. <<<")
    print(f"measuring for {args.duration:.0f}s — Ctrl-C to stop early ...")

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop.set)

    async def _progress() -> None:
        while not stop.is_set():
            await asyncio.sleep(5)
            print(f"  ... {len(frames)} frames so far")

    prog = asyncio.create_task(_progress())
    with contextlib.suppress(asyncio.TimeoutError):
        await asyncio.wait_for(stop.wait(), timeout=args.duration)
    prog.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await prog
    unsub()
    await client.disconnect()
    return _report(frames, args.gap_ms, args.duration)


def main() -> None:
    raise SystemExit(asyncio.run(_run(_parse_args())))


if __name__ == "__main__":
    main()
