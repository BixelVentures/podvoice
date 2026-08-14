"""Static locks for the single PodVoice lifecycle in the Voice PE firmware."""

from pathlib import Path

ROOT = Path(__file__).parents[2]
OVERLAY = ROOT / "esphome" / "podvoice.yaml"
BASE = ROOT / "esphome" / "voice-pe-podvoice-base.yaml"


def test_vendored_base_has_auditable_provenance():
    yaml = BASE.read_text()
    assert "772f2b9c8a881899a6f7b44d997aa6093c7e8aa7" in yaml
    assert "b68a8e8df8dc5471bf23706503c04c736182d93aa7a0c78724331146b2dc2c68" in yaml


def test_firmware_has_one_wake_owner_and_zero_stock_assist_starts():
    base = BASE.read_text()
    overlay = OVERLAY.read_text()
    combined = base + "\n" + overlay

    assert combined.count("on_wake_word_detected:") == 1
    assert "voice_assistant.start:" not in combined
    assert base.count("event_type: wake_okay_nabu") == 1
    assert "id(pv_audio).start_streaming();" in base
    assert not any(line.startswith("micro_wake_word:") for line in overlay.splitlines())


def test_clean_channel_is_explicit_and_old_direct_handshake_is_absent():
    overlay = OVERLAY.read_text()
    assert "podvoice_channel_v1" in overlay
    assert "same_breath_v1" in overlay
    assert "podvoice_direct_prepare" not in overlay
    assert "direct_speaker_v3" not in overlay


def test_wake_ack_is_visual_not_a_control_announcement():
    overlay = OVERLAY.read_text()
    base = BASE.read_text()
    assert "id: !extend wake_sound" in overlay
    assert "restore_mode: ALWAYS_OFF" in overlay
    wake = base.split("on_wake_word_detected:", 1)[1].split("\nselect:", 1)[0]
    assert "play_sound" not in wake
    assert "delay:" not in wake


def test_center_button_never_starts_stock_assist():
    base = BASE.read_text()
    click = base.split("on_multi_click:", 1)[1].split("\n    - timing:", 1)[0]
    assert "- voice_assistant.start:" not in click
    assert "event_type: single_press" in click
