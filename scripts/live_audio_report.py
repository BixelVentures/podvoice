#!/usr/bin/env python3
"""Offline PCM sample-clock report; energy is not speech or playback evidence.

No API, playback, transcription, silence threshold, or runtime policy. JSON summary
and CSV windows retain exact sample bounds; the final partial window is included.
"""

from __future__ import annotations

import argparse
import array
import csv
import hashlib
import json
import math
import sys
import wave
from pathlib import Path


def measure_pcm(pcm: bytes, sample_rate: int, window_ms: int = 20) -> tuple[dict, list[dict]]:
    if sample_rate <= 0 or window_ms <= 0 or sample_rate * window_ms % 1000:
        raise ValueError("window must contain an exact positive number of samples")
    if len(pcm) % 2:
        raise ValueError("PCM16 requires complete samples")
    samples = array.array("h", pcm)
    if sys.byteorder != "little":
        samples.byteswap()
    count = len(samples)
    width = sample_rate * window_ms // 1000
    windows = []
    zero_runs = []
    zero_start = None
    first_nonzero = None
    last_nonzero = None
    for index, value in enumerate(samples):
        if value == 0:
            if zero_start is None:
                zero_start = index
        else:
            if first_nonzero is None:
                first_nonzero = index
            last_nonzero = index
            if zero_start is not None:
                zero_runs.append({"start_sample": zero_start, "end_sample": index})
                zero_start = None
    if zero_start is not None:
        zero_runs.append({"start_sample": zero_start, "end_sample": count})
    for start in range(0, count, width):
        block = samples[start : start + width]
        rms = math.sqrt(sum(value * value for value in block) / len(block))
        windows.append(
            {
                "start_sample": start,
                "end_sample": start + len(block),
                "start_s": start / sample_rate,
                "end_s": (start + len(block)) / sample_rate,
                "rms_dbfs": 20 * math.log10(rms / 32768) if rms else None,
                "peak_abs": max(map(abs, block)),
                "zero_samples": block.count(0),
                "rail_samples": sum(value in (-32768, 32767) for value in block),
            }
        )
    tail_start = 0 if last_nonzero is None else last_nonzero + 1
    summary = {
        "sample_rate": sample_rate,
        "channels": 1,
        "bits_per_sample": 16,
        "samples": count,
        "pcm_bytes": len(pcm),
        "pcm_sha256": hashlib.sha256(pcm).hexdigest(),
        "duration_s": count / sample_rate,
        "window_ms": window_ms,
        "window_samples": width,
        "windows": len(windows),
        "first_nonzero_sample": first_nonzero,
        "last_nonzero_sample": last_nonzero,
        "zero_samples": sum(window["zero_samples"] for window in windows),
        "rail_samples": sum(window["rail_samples"] for window in windows),
        "peak_abs": max(map(abs, samples), default=0),
        "trailing_exact_zero_samples": count - tail_start,
        "trailing_exact_zero_s": (count - tail_start) / sample_rate,
        "exact_zero_runs": zero_runs,
        "semantic_farewell_verified": False,
        "physical_playback_verified": False,
        "clock": "WAV sample offsets only; no inferred mapping to provider wall time",
    }
    return summary, windows


def report_wav(path: Path, window_ms: int = 20) -> tuple[dict, list[dict]]:
    with wave.open(str(path), "rb") as reader:
        if (
            reader.getnchannels() != 1
            or reader.getsampwidth() != 2
            or reader.getcomptype() != "NONE"
        ):
            raise ValueError("expected uncompressed mono PCM16 WAV")
        pcm = reader.readframes(reader.getnframes())
        if len(pcm) != reader.getnframes() * 2:
            raise ValueError("truncated WAV data")
        summary, windows = measure_pcm(pcm, reader.getframerate(), window_ms)
    summary["source"] = str(path.resolve())
    return summary, windows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wav", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--window-ms", type=int, default=20)
    args = parser.parse_args()
    summary, windows = report_wav(args.wav, args.window_ms)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    with (args.output_dir / "windows.csv").open("w", newline="") as output:
        if windows:
            writer = csv.DictWriter(output, fieldnames=list(windows[0]))
            writer.writeheader()
            writer.writerows(windows)
    print(json.dumps({key: value for key, value in summary.items() if key != "exact_zero_runs"}))


if __name__ == "__main__":
    main()
