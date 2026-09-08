"""The real adapter must wait for the current firmware stop, not command-send."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from gatekeeper.voicepe import VoicePELink


def link():
    result = VoicePELink("test.local", "key", room="kitchen")
    result._client = SimpleNamespace()
    result._reply_status_key = 42
    result._call_service = AsyncMock(return_value=True)
    return result


def status(device, token, state):
    from aioesphomeapi.model import TextSensorState

    device._on_state(TextSensorState(key=42, state=f"{token}:{state}", missing_state=False))


async def test_stop_waits_for_matching_pipeline_ack_and_deduplicates_word():
    device = link()
    events = []
    device.on_event = lambda room, ev: events.append(ev)
    await device.play_url("http://reply", playback_id="p1")
    token = device._reply_token
    status(device, token, "started")
    status(device, token, "stop_detected")
    status(device, token, "stop_detected")
    stopping = asyncio.create_task(device.stop_playback())
    await asyncio.sleep(0)
    status(device, "old-token", "stopped")
    assert not stopping.done()
    status(device, token, "stopped_word")
    assert await stopping is True
    assert [e.event_type for e in events] == ["wake_stop"]
    assert events[0].playback_id == "p1"


async def test_stopped_word_replaces_a_lost_detection_and_never_finishes_normally():
    device = link()
    events, playback = [], []
    device.on_event = lambda room, ev: events.append(ev)
    device.on_media_state = lambda *args: playback.append(args)
    await device.play_url("http://reply", playback_id="p1")
    token = device._reply_token
    status(device, token, "started")
    status(device, token, "stopped_word")
    status(device, token, "finished")
    assert [e.event_type for e in events] == ["wake_stop"]
    assert playback == [(True, "p1")]


async def test_late_token_cannot_stop_next_playback():
    device = link()
    events = []
    device.on_event = lambda room, ev: events.append(ev)
    await device.play_url("http://reply", playback_id="p1")
    old = device._reply_token
    status(device, old, "started")
    status(device, old, "finished")
    await device.play_url("http://reply", playback_id="p2")
    status(device, old, "stopped_word")
    assert not events
    assert device._reply_token != old


async def test_cancel_without_reply_is_correlated_and_no_send_is_not_success():
    device = link()
    pending = asyncio.create_task(device.stop_playback())
    await asyncio.sleep(0)
    token = device._reply_token
    assert token
    assert not pending.done()
    status(device, token, "stopped")
    assert await pending
    device._call_service.return_value = False
    assert not await device.stop_playback()


def test_shipped_firmware_state_arbitrates_late_play_finish_and_stop(tmp_path):
    import shutil
    import subprocess
    from pathlib import Path

    root = Path(__file__).parents[2]
    compiler = shutil.which("c++")
    assert compiler, "A C++ compiler is required for the shipped firmware state regression"
    binary = tmp_path / "stop-reply-test"
    subprocess.run(
        [
            compiler,
            "-std=c++17",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-I",
            str(root / "esphome/components/podvoice_reply"),
            str(root / "tests/firmware/stop_reply_test.cpp"),
            "-o",
            str(binary),
        ],
        check=True,
    )
    subprocess.run([str(binary)], check=True)


def test_shipped_firmware_waits_for_producer_mixer_and_output_fence(tmp_path):
    import shutil
    import subprocess
    from pathlib import Path

    root = Path(__file__).parents[2]
    include = tmp_path / "include"
    for name in (
        "core/component.h",
        "components/speaker_source/speaker_source_media_player.h",
        "components/mixer/speaker/mixer_speaker.h",
        "components/resampler/speaker/resampler_speaker.h",
        "components/micro_wake_word/streaming_model.h",
        "components/text_sensor/text_sensor.h",
    ):
        path = include / "esphome" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('#include "stop_stubs.h"\n')
    compiler = shutil.which("c++")
    assert compiler
    binary = tmp_path / "stop-pipeline-test"
    subprocess.run(
        [
            compiler,
            "-std=c++17",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-I",
            str(include),
            "-I",
            str(root / "tests/firmware"),
            "-I",
            str(root / "esphome/components/podvoice_reply"),
            str(root / "tests/firmware/stop_pipeline_test.cpp"),
            "-o",
            str(binary),
        ],
        check=True,
    )
    subprocess.run([str(binary)], check=True)


async def test_orphan_status_after_first_cancel_is_retargeted_on_bounded_retry():
    device = link()
    orphan = "b" * 32
    first = asyncio.create_task(device.stop_playback())
    await asyncio.sleep(0)
    first_token = device._reply_token
    status(device, orphan, "started")
    assert not first.done()
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    retry = asyncio.create_task(device.stop_playback())
    await asyncio.sleep(0)
    assert device._reply_token == orphan != first_token
    status(device, first_token, "stopped")
    assert not retry.done()
    status(device, orphan, "stopped")
    assert await retry


async def test_disconnect_releases_stop_waiter_as_failure():
    device = link()
    pending = asyncio.create_task(device.stop_playback())
    await asyncio.sleep(0)
    await device._on_disconnect()
    assert await pending is False


async def test_cancel_for_old_playback_cannot_stop_current_reply():
    device = link()
    await device.play_url("http://reply", playback_id="current")
    device._call_service.reset_mock()
    assert not await device.stop_playback(playback_id="old")
    device._call_service.assert_not_called()
    pending = asyncio.create_task(device.stop_playback(playback_id="current"))
    await asyncio.sleep(0)
    status(device, device._reply_token, "stopped")
    assert await pending
