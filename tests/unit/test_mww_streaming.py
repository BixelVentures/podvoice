"""Compile real pinned model code; only TFLite inference/platform are simulated."""

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[2]
SOURCE = ROOT / "esphome/components/micro_wake_word"


@pytest.mark.parametrize(
    "harness",
    [
        "mww_streaming_test.cpp",
        "mww_stop_gate_test.cpp",
        "mww_event_test.cpp",
        "wake_audio_boundary_test.cpp",
    ],
)
def test_actual_streaming_model_load_cooldown_and_warm_inference(tmp_path, harness):
    manifest = json.loads((SOURCE / "UPSTREAM.json").read_text())
    assert manifest["version"] == "2026.6.2"
    for name in ("streaming_model.cpp", "preprocessor_settings.h"):
        assert hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() == manifest["sha256"][name]
    include = tmp_path / "include"
    for name in (
        "esphome/core/preferences.h",
        "esphome/core/helpers.h",
        "esphome/core/log.h",
        "tensorflow/lite/core/c/common.h",
        "tensorflow/lite/micro/micro_interpreter.h",
        "tensorflow/lite/micro/micro_mutable_op_resolver.h",
        "esphome/core/automation.h",
        "esphome/core/component.h",
        "esphome/core/defines.h",
        "esphome/core/static_task.h",
        "esphome/core/application.h",
        "esphome/core/hal.h",
        "esphome/components/microphone/microphone_source.h",
        "esphome/components/ring_buffer/ring_buffer.h",
        "esphome/components/audio/audio_transfer_buffer.h",
        "freertos/event_groups.h",
        "frontend.h",
        "frontend_util.h",
        "esphome/components/api/api_pb2.h",
        "esphome/components/api/api_connection.h",
        "esphome/components/voice_assistant/voice_assistant.h",
    ):
        path = include / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('#include "mww_platform_stubs.h"\n')
    component_dir = tmp_path / "tree/esphome/components"
    component_dir.mkdir(parents=True)
    (component_dir / "micro_wake_word").symlink_to(SOURCE, target_is_directory=True)
    compiler = shutil.which("c++")
    assert compiler
    binary = tmp_path / "streaming-test"
    subprocess.run(
        [
            compiler,
            "-std=c++17",
            "-DUSE_ESP32",
            "-DUSE_VOICE_ASSISTANT",
            "-I",
            str(ROOT / "esphome/components/podvoice_audio"),
            "-I",
            str(tmp_path / "tree"),
            "-I",
            str(include),
            "-I",
            str(ROOT / "tests/firmware"),
            "-I",
            str(SOURCE),
            str(SOURCE / "streaming_model.cpp"),
            *(
                [str(SOURCE / "micro_wake_word.cpp")]
                if harness in ("mww_event_test.cpp", "wake_audio_boundary_test.cpp")
                else []
            ),
            *(
                [str(ROOT / "esphome/components/podvoice_audio/podvoice_audio.cpp")]
                if harness == "wake_audio_boundary_test.cpp"
                else []
            ),
            str(ROOT / "tests/firmware" / harness),
            "-o",
            str(binary),
        ],
        check=True,
    )
    subprocess.run([str(binary)], check=True)
