"""Compile shipped activity observers and the real firmware wire publisher."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[2]


@pytest.mark.parametrize("harness", ["activity_observer_test.cpp", "activity_wire_test.cpp"])
def test_firmware_observer_measurements_are_identified_and_never_control_audio(tmp_path, harness):
    include = tmp_path / "include"
    for name in (
        "core/component.h",
        "core/helpers.h",
        "components/speaker_source/speaker_source_media_player.h",
        "components/mixer/speaker/mixer_speaker.h",
        "components/resampler/speaker/resampler_speaker.h",
        "components/micro_wake_word/micro_wake_word.h",
        "components/switch/switch.h",
        "components/text_sensor/text_sensor.h",
    ):
        path = include / "esphome" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('#include "stop_stubs.h"\n')
    compiler = shutil.which("c++")
    assert compiler
    binary = tmp_path / "activity-test"
    subprocess.run(
        [
            compiler,
            "-std=c++17",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-pthread",
            "-DUSE_PODVOICE_ACTIVITY_OBSERVER",
            "-DUSE_MICRO_WAKE_WORD_VAD",
            "-I",
            str(include),
            "-I",
            str(ROOT),
            "-I",
            str(ROOT / "tests/firmware"),
            "-I",
            str(ROOT / "esphome/components/podvoice_reply"),
            str(ROOT / "tests/firmware" / harness),
            "-o",
            str(binary),
        ],
        check=True,
    )
    result = subprocess.run([str(binary)], check=True, capture_output=True, text=True)
    if harness == "activity_wire_test.cpp":
        event = json.loads(result.stdout)
        assert set(event) == {
            "v",
            "owner",
            "context_generation",
            "seq",
            "source_ms",
            "input",
            "output",
        }
        assert event["v"] == 1 and len(event["owner"]) == 32
        assert event["context_generation"] == 1 and event["source_ms"] == 300
        assert event["input"]["state"] == "active"
        assert event["input"]["inference_ms"] == 210
        assert event["input"]["sample_end"] == 960
        assert event["output"]["reply_token"] == "a" * 32
        assert event["output"]["peak"] == 100
        assert event["output"]["sum_squares"] == 20000
        assert event["output"]["consumed_frames"] == 2
        assert event["output"]["frame_end"] == 4
        assert "drain_confirmed" not in event["output"]
