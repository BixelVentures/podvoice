"""Sample accounting regressions independent of any runtime silence policy."""

import importlib.util
import math
import struct
import wave
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "live_audio_report", Path(__file__).resolve().parents[2] / "scripts/live_audio_report.py"
)
assert spec and spec.loader
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


def test_exact_zero_runs_partial_frame_and_sample_clock():
    values = [0, 0, 100, -100, 0, 0, 0]
    summary, windows = report.measure_pcm(struct.pack("<7h", *values), 1000, 4)
    assert summary["samples"] == 7 and summary["duration_s"] == 0.007
    assert summary["first_nonzero_sample"] == 2 and summary["last_nonzero_sample"] == 3
    assert summary["exact_zero_runs"] == [
        {"start_sample": 0, "end_sample": 2},
        {"start_sample": 4, "end_sample": 7},
    ]
    assert summary["trailing_exact_zero_samples"] == 3
    assert summary["zero_samples"] == 5
    assert [(w["start_sample"], w["end_sample"]) for w in windows] == [(0, 4), (4, 7)]
    assert windows[0]["rms_dbfs"] == pytest.approx(20 * math.log10(math.sqrt(5000) / 32768))
    assert windows[1]["rms_dbfs"] is None


@pytest.mark.parametrize("values,tail", [([], 0), ([0, 0], 2), ([0, 1], 0), ([1, 0], 1)])
def test_empty_allzero_and_one_lsb_are_not_confused_with_speech(values, tail):
    summary, _ = report.measure_pcm(struct.pack(f"<{len(values)}h", *values), 24000)
    assert summary["trailing_exact_zero_samples"] == tail
    assert not summary["semantic_farewell_verified"]
    assert not summary["physical_playback_verified"]


def test_signed_extrema_and_invalid_frames():
    summary, windows = report.measure_pcm(struct.pack("<3h", -32768, 32767, -1), 24000)
    assert summary["peak_abs"] == 32768 and summary["rail_samples"] == 2
    assert windows[0]["rail_samples"] == 2
    with pytest.raises(ValueError, match="complete samples"):
        report.measure_pcm(b"\x00", 24000)
    with pytest.raises(ValueError, match="exact positive"):
        report.measure_pcm(b"", 44100, 1)


def test_wav_reader_preserves_sample_rate_and_rejects_stereo(tmp_path):
    path = tmp_path / "fixture.wav"
    with wave.open(str(path), "wb") as writer:
        writer.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
        writer.writeframes(struct.pack("<3h", 1, -2, 0))
    summary, _ = report.report_wav(path)
    assert summary["samples"] == 3 and summary["sample_rate"] == 24000
    with wave.open(str(path), "wb") as writer:
        writer.setparams((2, 2, 24000, 0, "NONE", "not compressed"))
        writer.writeframes(bytes(8))
    with pytest.raises(ValueError, match="mono PCM16"):
        report.report_wav(path)
