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
        "mww_activity_test.cpp",
        "mww_stop_gate_test.cpp",
        "mww_event_test.cpp",
        "wake_audio_boundary_test.cpp",
        "wake_reference_test.cpp",
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
        "esphome/components/text_sensor/text_sensor.h",
        "esphome/components/switch/switch.h",
    ):
        path = include / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if name == "esphome/core/defines.h" and harness == "mww_activity_test.cpp":
            path.write_text(
                "#define USE_MICRO_WAKE_WORD_VAD\n#define USE_PODVOICE_ACTIVITY_OBSERVER\n"
            )
        elif name == "esphome/core/defines.h" and harness == "wake_reference_test.cpp":
            path.write_text("#define USE_PODVOICE_WAKE_REFERENCE\n")
        else:
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
                if harness
                in (
                    "mww_event_test.cpp",
                    "wake_audio_boundary_test.cpp",
                    "mww_activity_test.cpp",
                    "wake_reference_test.cpp",
                )
                else []
            ),
            *(
                [str(ROOT / "esphome/components/podvoice_audio/podvoice_audio.cpp")]
                if harness in ("wake_audio_boundary_test.cpp", "wake_reference_test.cpp")
                else []
            ),
            str(ROOT / "tests/firmware" / harness),
            "-o",
            str(binary),
        ],
        check=True,
    )
    result = subprocess.run([str(binary)], check=True, capture_output=True, text=True)
    if harness == "wake_reference_test.cpp":
        import base64
        import struct
        import zlib

        records = [json.loads(line) for line in result.stdout.splitlines()]
        assert len(records) == 67
        for group, start, end in ((records[:3], 0, 800), (records[3:66], 5000, 29000)):
            expected = struct.pack(f"<{end - start}h", *range(start, end))
            data = b"".join(base64.b64decode(item["pcm"], validate=True) for item in group)
            assert data == expected
            for seq, item in enumerate(group):
                assert item["seq"] == seq and item["total"] == len(group)
                assert item["bytes"] == len(expected)
                assert item["sample_start"] == start and item["sample_end"] == end
                assert item["crc32"] == f"{zlib.crc32(expected):08x}"
                assert item["detected_ms"] == 91 and item["delivered_ms"] == 99
                assert len(base64.b64decode(item["pcm"])) <= 768
                assert len(json.dumps(item)) <= 2048
        missing = records[-1]
        assert missing["status"] == "missing" and missing["pcm"] == ""
        assert missing["sample_start"] == missing["sample_end"] == 800
        assert missing["bytes"] == missing["total"] == missing["seq"] == 0
        assert missing["crc32"] == "00000000"
        from gatekeeper.wake_reference import WakeReferenceAssembler

        for group in (records[:3], records[3:66], records[66:]):
            assembler = WakeReferenceAssembler()
            connection = object()
            assembler.begin(
                group[0]["owner"],
                1,
                now=1.0,
                connection=connection,
                epoch=1.0,
                session_id="physical-wake",
            )
            completed = None
            for item in group:
                completed = assembler.feed(
                    json.dumps(item),
                    now=2.0,
                    connection=connection,
                    epoch=1.0,
                    session_id="physical-wake",
                )
            assert completed is not None
            assert len(completed.pcm) == group[0]["bytes"]
        assert "optional_psram_bytes=48000" in result.stderr
        print(result.stderr.strip())
