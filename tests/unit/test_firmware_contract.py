"""Static locks for the firmware graph that Python-side device mocks cannot see."""

from pathlib import Path

FIRMWARE = Path(__file__).parents[2] / "esphome" / "podvoice.yaml"


def test_direct_voice_reply_owns_its_resampler_and_mixer_source():
    """Regression for 1.11.0's endless RESPONSE_FINISHED state.

    The external media player must not own either node whose lifecycle Voice Assistant
    waits on. A dedicated resampler alone is insufficient because ResamplerSpeaker
    delegates has_buffered_data() to its output; that output must therefore also be a
    dedicated, finite-timeout mixer source.
    """
    yaml = FIRMWARE.read_text()

    assert "speaker: voice_assistant_resampling_speaker" in yaml
    assert "id: voice_assistant_resampling_speaker" in yaml
    assert "output_speaker: voice_assistant_mixing_input" in yaml
    assert "id: voice_assistant_mixing_input" in yaml
    assert "timeout: 500ms" in yaml
    assert "id(voice_assistant_resampling_speaker).set_audio_stream_info(" in yaml
    assert "direct_speaker_v3" in yaml
    assert "podvoice_direct_prepare" in yaml


def test_announce_player_speaker_is_not_reused_by_voice_assistant():
    yaml = FIRMWARE.read_text()
    voice_assistant = yaml.split("\nvoice_assistant:\n", 1)[1].split("\n# Upstream ships wifi", 1)[
        0
    ]

    assert "speaker: announcement_resampling_speaker" not in voice_assistant
    assert "id(announcement_resampling_speaker).set_audio_stream_info(" not in voice_assistant
