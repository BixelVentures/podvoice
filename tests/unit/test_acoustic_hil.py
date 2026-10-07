from __future__ import annotations

import asyncio
import hashlib
import math
import struct
import wave
from pathlib import Path

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
    assert played[0].wav_sha256 == hashlib.sha256(wake.read_bytes()).hexdigest()
    assert played[0].pcm_sha256 == hashlib.sha256(b"\x01\x00" * 640).hexdigest()


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


@pytest.mark.parametrize("mutation", ["replace", "delete", "format"])
@pytest.mark.parametrize("boundary", ["observer", "sink"])
async def test_prepared_clips_cannot_change_after_any_external_await(tmp_path, mutation, boundary):
    first = _wav(tmp_path / "first.wav", samples=640)
    second = _wav(tmp_path / "second.wav", samples=320)
    original_hashes = [hashlib.sha256(path.read_bytes()).hexdigest() for path in (first, second)]
    chunks, sleeps = [], []
    changed = False

    def mutate():
        nonlocal changed
        if changed:
            return
        changed = True
        for path in (first, second):
            if mutation == "delete":
                path.unlink()
            elif mutation == "format":
                _wav(path, rate=48000, samples=48000, channels=2)
            else:
                _wav(path, samples=16000)

    async def observe(_name, _timeout):
        if boundary == "observer":
            mutate()
        return True

    async def sink(pcm, rate):
        chunks.append((pcm, rate))
        if boundary == "sink":
            mutate()

    async def no_sleep(seconds):
        sleeps.append(seconds)

    runner = AcousticHilRunner(sink, observe, sleep=no_sleep, max_clip_s=0.2, max_corpus_s=0.2)
    played = await runner.run(
        [AcousticStep(first, wait_for="playback_finished"), AcousticStep(second)]
    )
    assert changed
    assert [receipt.wav_sha256 for receipt in played] == original_hashes
    assert [receipt.samples for receipt in played] == [640, 320]
    assert [receipt.pcm_sha256 for receipt in played] == [
        hashlib.sha256(b"\x01\x00" * count).hexdigest() for count in (640, 320)
    ]
    assert all(rate == 16000 for _pcm, rate in chunks)
    assert b"".join(pcm for pcm, _rate in chunks) == b"\x01\x00" * 960
    assert sum(sleeps) == pytest.approx(960 / 16000)


@pytest.mark.parametrize("missing_bytes", [1, 2])
async def test_truncated_pcm_is_rejected_before_any_external_await(tmp_path, missing_bytes):
    clip = _wav(tmp_path / "truncated.wav")
    clip.write_bytes(clip.read_bytes()[:-missing_bytes])

    async def forbidden(*_args):
        raise AssertionError("invalid input must not reach an observer or sink")

    runner = AcousticHilRunner(forbidden, forbidden)
    with pytest.raises(AcousticHilError, match=r"truncated|misaligned"):
        await runner.run([AcousticStep(clip, wait_for="playback_finished")])


async def test_oversized_snapshot_uses_bounded_read_before_any_external_await(
    tmp_path, monkeypatch
):
    clip = tmp_path / "oversized.wav"
    clip.write_bytes(b"x" * 100000)
    reads = []
    original_open = Path.open

    class ReadProbe:
        def __enter__(self):
            self.source = original_open(clip, "rb")
            return self

        def __exit__(self, *args):
            self.source.close()

        def read(self, size):
            reads.append(size)
            return self.source.read(size)

    monkeypatch.setattr(Path, "open", lambda _path, _mode: ReadProbe())

    async def forbidden(*_args):
        raise AssertionError("oversize input must fail before playback")

    runner = AcousticHilRunner(forbidden, forbidden, max_clip_s=0.2, max_corpus_s=0.2)
    with pytest.raises(AcousticHilError, match=r"bounded.*storage limit"):
        await runner.run([AcousticStep(clip, wait_for="playback_finished")])
    assert reads == [math.ceil(0.2 * 48000 * 2) + 65536 + 1]


async def test_snapshot_storage_budget_is_shared_across_the_corpus(tmp_path):
    clips = [_wav(tmp_path / f"clip-{index}.wav") for index in range(2)]
    for clip in clips:
        clip.write_bytes(clip.read_bytes() + b"metadata" * 6250)

    async def forbidden(*_args):
        raise AssertionError("corpus storage must fail before playback")

    runner = AcousticHilRunner(forbidden, forbidden, max_clip_s=0.2, max_corpus_s=0.2)
    with pytest.raises(AcousticHilError, match=r"bounded.*storage limit"):
        await runner.run([AcousticStep(path, wait_for="playback_finished") for path in clips])


@pytest.mark.parametrize("invalid", ["duration", "format", "truncated"])
async def test_invalid_later_clip_cannot_start_the_valid_first_clip(tmp_path, invalid):
    first = _wav(tmp_path / "valid.wav", samples=640)
    later = _wav(
        tmp_path / "later.wav",
        samples=4800 if invalid == "duration" else 640,
        channels=2 if invalid == "format" else 1,
    )
    if invalid == "truncated":
        later.write_bytes(later.read_bytes()[:-2])

    async def forbidden(*_args):
        raise AssertionError("the complete corpus must pass before any playback")

    runner = AcousticHilRunner(forbidden, forbidden, max_clip_s=0.2, max_corpus_s=0.2)
    with pytest.raises(AcousticHilError):
        await runner.run([AcousticStep(first), AcousticStep(later)])


@pytest.mark.parametrize("boundary", ["observer", "sink"])
async def test_cancellation_during_external_await_stops_without_later_submission(
    tmp_path, boundary
):
    clip = _wav(tmp_path / "cancel.wav", samples=640)
    entered = asyncio.Event()
    hold = asyncio.Event()
    chunks = []

    async def observe(_name, _timeout):
        if boundary == "observer":
            entered.set()
            await hold.wait()
        return True

    async def sink(pcm, rate):
        chunks.append((pcm, rate))
        if boundary == "sink":
            entered.set()
            await hold.wait()

    runner = AcousticHilRunner(sink, observe)
    task = asyncio.create_task(runner.run([AcousticStep(clip, wait_for="playback_finished")]))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        clip.unlink()  # All source handles were closed before either awaited boundary.
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert len(chunks) == (0 if boundary == "observer" else 1)
    finally:
        hold.set()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize("limit", ["max_clip_s", "max_corpus_s"])
def test_infinite_duration_cannot_disable_snapshot_bounds(limit):
    async def unused(*_args):
        raise AssertionError("no I/O")

    with pytest.raises(AcousticHilError, match="finite"):
        AcousticHilRunner(unused, unused, **{limit: float("inf")})


@pytest.mark.parametrize("boundary", ["observer", "sink"])
@pytest.mark.parametrize("mutation", ["replace", "remove"])
async def test_step_sequence_is_frozen_before_external_await(tmp_path, boundary, mutation):
    first = _wav(tmp_path / "first.wav", samples=160)
    second = _wav(tmp_path / "second.wav", samples=160)
    steps = [
        AcousticStep(first, wait_for="start"),
        AcousticStep(second, wait_for="playback_finished"),
    ]
    waits, chunks = [], []

    def mutate():
        if mutation == "replace":
            steps[1:] = [AcousticStep(second)]
        else:
            steps[1:] = []

    async def observe(name, _timeout):
        waits.append(name)
        if name == "start" and boundary == "observer":
            mutate()
        return name == "start"  # Required original physical edge is absent.

    async def sink(pcm, _rate):
        chunks.append(pcm)
        if boundary == "sink":
            mutate()

    async def no_sleep(_seconds):
        pass

    with pytest.raises(AcousticHilError, match="playback_finished"):
        await AcousticHilRunner(sink, observe, sleep=no_sleep).run(steps)
    assert waits == ["start", "playback_finished"]
    assert b"".join(chunks) == b"\x01\x00" * 160


@pytest.mark.parametrize("ancillary", [32700, 40000, 65500])
async def test_valid_ancillary_chunks_have_one_exact_aggregate_metadata_limit(tmp_path, ancillary):
    clips = [_wav(tmp_path / f"metadata-{index}.wav", samples=160) for index in range(2)]
    for clip in clips:
        data = clip.read_bytes()
        data = data[:36] + b"JUNK" + struct.pack("<I", ancillary) + b"x" * ancillary + data[36:]
        data = data[:4] + struct.pack("<I", len(data) - 8) + data[8:]
        clip.write_bytes(data)
    chunks = []

    async def sink(pcm, _rate):
        chunks.append(pcm)

    async def observe(*_args):
        raise AssertionError("no observer steps in this corpus")

    async def no_sleep(_seconds):
        pass

    runner = AcousticHilRunner(sink, observe, sleep=no_sleep, max_clip_s=1, max_corpus_s=1)
    if sum(clip.stat().st_size - 320 for clip in clips) <= 65536:
        played = await runner.run([AcousticStep(clip) for clip in clips])
        assert len(played) == 2
        assert b"".join(chunks) == b"\x01\x00" * 320
    else:
        with pytest.raises(AcousticHilError, match="metadata storage limit"):
            await runner.run([AcousticStep(clip) for clip in clips])
        assert chunks == []
