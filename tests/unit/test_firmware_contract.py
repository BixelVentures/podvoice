"""Static locks for the single PodVoice lifecycle in the Voice PE firmware."""

from pathlib import Path

ROOT = Path(__file__).parents[2]
OVERLAY = ROOT / "esphome" / "podvoice.yaml"
BASE = ROOT / "esphome" / "voice-pe-podvoice-base.yaml"


def test_vendored_base_has_auditable_provenance():
    yaml = BASE.read_text()
    assert "772f2b9c8a881899a6f7b44d997aa6093c7e8aa7" in yaml
    assert "b68a8e8df8dc5471bf23706503c04c736182d93aa7a0c78724331146b2dc2c68" in yaml
    assert "ref: dev" not in yaml
    # The compiled voice_kit source is pinned. Audio assets still follow upstream's
    # official URL until they can be vendored as binary release artifacts.


def test_firmware_has_one_wake_owner_and_zero_stock_assist_starts():
    base = BASE.read_text()
    overlay = OVERLAY.read_text()
    combined = base + "\n" + overlay

    assert combined.count("on_wake_word_detected:") == 1
    assert "voice_assistant.start:" not in combined
    assert base.count("event_type: wake_okay_nabu") == 1
    assert base.count("id(pv_audio).begin_conversation();") == 1
    assert not any(line.startswith("micro_wake_word:") for line in overlay.splitlines())


def test_clean_channel_is_explicit_and_old_direct_handshake_is_absent():
    overlay = OVERLAY.read_text()
    assert "podvoice_channel_v1" in overlay
    assert "same_breath_v1" in overlay
    assert "wake_audio_boundary_v1" in overlay
    assert "deterministic_rearm_v1" in overlay
    assert "physical_rearm_ack_v1" in overlay
    assert "continuous_rearm_v1" in overlay
    assert "event_type: podvoice_wake_rearmed" in overlay
    assert "podvoice_playback_events_v1" in overlay
    assert "action: podvoice_reply_expect" in overlay
    assert "action: podvoice_reply_cancel" in overlay
    assert "event_type: podvoice_playback_started" in overlay
    assert "event_type: podvoice_playback_finished" in overlay
    assert "event_type: podvoice_playback_fault" in overlay
    assert "announcement_resampling_speaker).has_buffered_data()" in overlay
    assert "decibel_reduction: 0" in overlay  # !extend must preserve upstream music restore
    stream_stop = overlay.split("action: podvoice_stream_stop", 1)[1].split(
        "action: podvoice_rearm_wake_word", 1
    )[0]
    assert "script.stop: podvoice_finish_reply" in stream_stop
    assert "id(podvoice_reply_phase) = 0" in stream_stop
    assert "podvoice_direct_prepare" not in overlay
    assert "direct_speaker_v3" not in overlay


def test_wake_boundary_keeps_only_short_bridge_and_keepalive_never_trims_live_speech():
    """Only physical wake may trim audio; it preserves same-breath word onset."""
    base = BASE.read_text()
    source = (ROOT / "esphome" / "components" / "podvoice_audio" / "podvoice_audio.cpp").read_text()
    begin = source.split("void PodVoiceAudio::begin_conversation()", 1)[1].split(
        "void PodVoiceAudio::start_streaming()", 1
    )[0]
    keepalive = source.split("void PodVoiceAudio::start_streaming()", 1)[1].split(
        "void PodVoiceAudio::stop_streaming()", 1
    )[0]

    assert base.count("id(pv_audio).begin_conversation();") == 1
    assert "WAKE_BRIDGE_MS" in begin
    assert "ring_buffer_->read" in begin
    assert "ring_buffer_->reset()" not in begin
    assert "ring_buffer_->reset()" not in keepalive


def test_each_detection_is_single_use_and_healthy_rearm_preserves_detector_continuity():
    base = BASE.read_text()
    overlay = OVERLAY.read_text()
    assert "stop_after_detection: false" in base
    assert "return !id(podvoice_conversation_active);" in base
    assert "id(podvoice_conversation_active) = true;" in base
    assert "id: podvoice_conversation_active" in overlay
    assert "action: podvoice_rearm_wake_word" in overlay
    rearm = overlay.split("action: podvoice_rearm_wake_word", 1)[1].split(
        "# RUNTIME audio tuning", 1
    )[0]
    healthy = rearm.split("else:", 1)[0]
    assert "podvoice_detector_continuity_proven" in healthy
    assert "micro_wake_word.stop:" not in healthy
    assert "micro_wake_word.start:" not in healthy
    assert "micro_wake_word.stop:" in rearm
    assert "micro_wake_word.start:" in rearm
    assert "wait_until:" in rearm
    assert "event_type: podvoice_wake_rearmed" in rearm
    assert "event_type: podvoice_wake_rearm_recovered" in rearm
    assert "event_type: podvoice_wake_rearm_fault" in rearm
    assert "id(podvoice_conversation_active) = false;" in rearm
    assert base.count("id(podvoice_detector_continuity_proven) = true;") == 1
    voice_assistant = base.split("voice_assistant:\n", 1)[1]
    connected = voice_assistant.split("on_client_connected:", 1)[1].split(
        "on_client_disconnected:", 1
    )[0]
    disconnected = voice_assistant.split("on_client_disconnected:", 1)[1].split(
        "on_error:", 1
    )[0]
    assert connected.index("id(podvoice_detector_continuity_proven) = false;") < connected.index(
        "micro_wake_word.start:"
    )
    assert "id(podvoice_detector_continuity_proven) = false;" in disconnected


def test_local_preroll_rolls_while_gated_and_clears_at_teardown():
    source = (ROOT / "esphome" / "components" / "podvoice_audio" / "podvoice_audio.cpp").read_text()
    stop = source.split("void PodVoiceAudio::stop_streaming()", 1)[1].split(
        "void PodVoiceAudio::set_mic_gain", 1
    )[0]
    gated = source.split("if (!connected)", 1)[1].split("// Drain up to", 1)[0]
    assert "ring_buffer_->reset()" in stop
    assert "client == nullptr" in gated
    assert "!this->user_enabled_" not in gated


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
