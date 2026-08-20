from __future__ import annotations

import asyncio
import wave

import pytest

from gatekeeper.acoustic_hil import AcousticHilError, AcousticHilRunner, AcousticStep


def _wav(path, *, rate=16000, samples=1600, channels=1, width=2):
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(width)
        wav.setframerate(rate)
        wav.writeframes(b"\x01\x00" * samples * channels)
    return path


async def test_acoustic_runner_streams_pcm_in_time_and_waits_on_read_only_edges(tmp_path):
    wake = _wav(tmp_path / "wake-question.wav", samples=640)
    followup = _wav(tmp_path / "followup.wav", samples=320)
    waits = []
    chunks = []
    sleeps = []

    async def wait_event(name: str, wait_limit: float) -> bool:
        waits.append((name, wait_limit))
        return True

    async def sink(pcm: bytes, rate: int) -> None:
        chunks.append((pcm, rate))

    async def no_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    runner = AcousticHilRunner(sink, wait_event, sleep=no_sleep, chunk_ms=20)
    played = await runner.run(
        [
            AcousticStep(wake),
            AcousticStep(followup, wait_for="playback_finished", timeout_s=9),
        ]
    )

    assert [clip.wav.name for clip in played] == ["wake-question.wav", "followup.wav"]
    assert waits == [("playback_finished", 9)]
    assert chunks and all(rate == 16000 for _, rate in chunks)
    assert sum(len(pcm) for pcm, _ in chunks) == (640 + 320) * 2
    assert sum(sleeps) == pytest.approx((640 + 320) / 16000)


async def test_acoustic_runner_stops_before_followup_when_physical_edge_is_missing(tmp_path):
    first = _wav(tmp_path / "first.wav")
    second = _wav(tmp_path / "second.wav")
    chunks = []

    async def wait_event(_name: str, _timeout: float) -> bool:
        return False

    async def sink(pcm: bytes, _rate: int) -> None:
        chunks.append(pcm)

    async def no_sleep(_seconds: float) -> None:
        return None

    runner = AcousticHilRunner(sink, wait_event, sleep=no_sleep)
    with pytest.raises(AcousticHilError, match="playback_finished"):
        await runner.run([AcousticStep(first), AcousticStep(second, wait_for="playback_finished")])
    assert sum(len(chunk) for chunk in chunks) == 1600 * 2


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"channels": 2}, "mono PCM16"),
        ({"width": 1}, "mono PCM16"),
        ({"rate": 8000}, "sample rate"),
        ({"samples": 0}, "duration"),
    ],
)
def test_acoustic_runner_rejects_unsafe_or_unrepresentative_audio(tmp_path, kwargs, message):
    fixture = _wav(tmp_path / "bad.wav", **kwargs)

    async def sink(_pcm: bytes, _rate: int) -> None:
        return None

    async def wait_event(_name: str, _timeout: float) -> bool:
        return True

    runner = AcousticHilRunner(sink, wait_event)
    with pytest.raises(AcousticHilError, match=message):
        runner.inspect(fixture)


def test_acoustic_runner_bounds_total_corpus_before_playback(tmp_path):
    first = _wav(tmp_path / "first.wav", samples=1600)
    second = _wav(tmp_path / "second.wav", samples=1600)
    third = _wav(tmp_path / "third.wav", samples=1600)

    async def sink(_pcm: bytes, _rate: int) -> None:
        raise AssertionError("must validate before playback")

    async def wait_event(_name: str, _timeout: float) -> bool:
        return True

    runner = AcousticHilRunner(sink, wait_event, max_clip_s=0.2, max_corpus_s=0.15)
    with pytest.raises(AcousticHilError, match="corpus"):
        # The constructor keeps the corpus bound >= one allowed clip; three exceed it.
        asyncio.run(runner.run([AcousticStep(first), AcousticStep(second), AcousticStep(third)]))
