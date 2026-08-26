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


def test_fresh_ha_package_fetches_podvoice_audio_without_local_copy():
    yaml = OVERLAY.read_text()
    external = yaml.split("external_components:", 1)[1].split("podvoice_audio:", 1)[0]

    assert "type: git" in external
    assert "url: https://github.com/BixelVentures/podvoice" in external
    assert "ref: 385b71c4f1d3285f130390d8735849268427add3" in external
    assert "path: esphome/components" in external
    assert "refresh: 0s" in external
    assert "\n  - source: { type: local, path: components }" not in external


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
    assert "physical_rearm_audio_progress_v1" in overlay
    assert "correlated_reset_rearm_v2" in overlay
    assert "podvoice_build_11345" in overlay
    assert "podvoice_build_11344" not in overlay
    assert "podvoice_build_11343" not in overlay
    assert "podvoice_playback_events_v1" in overlay
    assert "correlated_playback_v2" in overlay
    assert "action: podvoice_reply_expect" in overlay
    assert "action: podvoice_reply_play" in overlay
    assert "action: podvoice_reply_cancel" in overlay
    assert "action: podvoice_reply_silence" in overlay
    assert "id: podvoice_playback_ack" in overlay
    expect = overlay.split("action: podvoice_reply_expect", 1)[1].split(
        "action: podvoice_reply_play", 1
    )[0]
    play = overlay.split("action: podvoice_reply_play", 1)[1].split(
        "action: podvoice_reply_cancel", 1
    )[0]
    cancel = overlay.split("action: podvoice_reply_cancel", 1)[1].split(
        "# RUNTIME audio tuning", 1
    )[0]
    finish = overlay.split("- id: podvoice_finish_reply", 1)[1].split("# --- Phase 2", 1)[0]
    assert "token: int" in expect
    assert "media_player.is_announcing: podvoice_reply_player" in expect
    assert '":armed"' in expect
    assert expect.index("media_player.is_announcing") < expect.index(
        "id(podvoice_reply_token) = token"
    )
    assert "id(podvoice_reply_token) = token" in expect
    assert "id(podvoice_reply_phase) != 0" in expect
    assert "podvoice_reply_resampling_speaker).is_running()" in expect
    assert "url: string" in play
    assert "id(podvoice_reply_phase) = 2" in play
    assert "id(podvoice_last_play_token) != token" in play
    assert "id(podvoice_last_play_token) = token" in play
    assert ".set_media_url(url)" in play
    assert play.index("id(podvoice_reply_phase) = 2") < play.index(".set_media_url(url)")
    reserved_foreign = overlay.split("An announcement arriving while only reserved", 1)[1].split(
        '- lambda: "return id(podvoice_reply_phase) == 2;"', 1
    )[0]
    assert "id(podvoice_reply_phase) == 1" in reserved_foreign
    assert '":fault"' in reserved_foreign
    assert "id(podvoice_reply_token) == token" in cancel
    assert "script.stop: podvoice_reply_reservation_timeout" in cancel
    assert "id: podvoice_reply_player" in cancel
    assert "id(podvoice_reply_phase) = 5" in cancel
    silence = overlay.split("action: podvoice_reply_silence", 1)[1].split(
        "# RUNTIME audio tuning", 1
    )[0]
    assert "id(podvoice_reply_token) = token" in silence
    assert "id(podvoice_reply_phase) = 5" in silence
    assert "id: podvoice_cancel_reply" in silence
    cancel_reply = overlay.split("- id: podvoice_cancel_reply", 1)[1].split(
        "- id: podvoice_recover_wake_word", 1
    )[0]
    assert "podvoice_reply_resampling_speaker).has_buffered_data()" in cancel_reply
    assert "podvoice_reply_resampling_speaker).is_running()" in cancel_reply
    assert "id(podvoice_reply_phase) == 5" in cancel_reply
    assert "id(podvoice_reply_token) == token" in cancel_reply
    assert '":cancelled"' in cancel_reply
    assert '":fault"' in cancel_reply
    stream_stop = overlay.split("action: podvoice_stream_stop", 1)[1].split(
        "action: podvoice_rearm_wake_word", 1
    )[0]
    assert "pv_audio).stop_streaming" in stream_stop
    assert "podvoice_reply_phase" not in stream_stop
    assert "podvoice_reply_player" not in stream_stop
    rearm = overlay.split("action: podvoice_rearm_wake_word", 1)[1].split(
        "action: podvoice_reply_expect", 1
    )[0]
    assert "id: podvoice_rearm_after_silence" in rearm
    rearm_silence = overlay.split("- id: podvoice_rearm_after_silence", 1)[1].split(
        "- id: podvoice_recover_wake_word", 1
    )[0]
    assert "podvoice_reply_resampling_speaker).has_buffered_data()" in rearm_silence
    assert "podvoice_reply_resampling_speaker).is_running()" in rearm_silence
    assert "id: podvoice_recover_wake_word" in rearm_silence
    assert '":fault"' in rearm_silence
    reservation_timeout = overlay.split("- id: podvoice_reply_reservation_timeout", 1)[1].split(
        "- id: podvoice_recover_wake_word", 1
    )[0]
    assert "delay: 3s" in reservation_timeout
    assert "id(podvoice_reply_phase) == 1" in reservation_timeout
    assert "id(podvoice_reply_token) == token" in reservation_timeout
    assert '":fault"' in reservation_timeout
    assert "parameters:\n      token: int" in finish
    assert '":started"' in overlay
    assert '":finished"' in finish
    assert '":fault"' in finish
    assert "id(podvoice_reply_phase) == 4" in finish
    assert "id(podvoice_reply_token) == token" in finish
    assert "podvoice_reply_resampling_speaker).has_buffered_data()" in overlay
    assert "id: podvoice_reply_player" in overlay
    assert "internal: true" in overlay
    assert "id: podvoice_reply_http_source" in overlay
    private_player = overlay.split(
        "  - platform: speaker_source\n    id: podvoice_reply_player", 1
    )[1].split("id: !extend external_media_player", 1)[0]
    assert "podvoice_reply_resampling_speaker" in private_player
    assert "podvoice_reply_http_source" in private_player
    assert "external_media_player" not in private_player
    assert "decibel_reduction: 0" in overlay  # !extend must preserve upstream music restore
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


def test_physical_dial_and_private_reply_share_one_live_volume():
    """The v1.13.43 dial behavior must survive the private reply path."""
    base = BASE.read_text()
    overlay = OVERLAY.read_text()
    dial = base.split("- id: control_volume", 1)[1].split("- id: control_group_volume", 1)[0]
    external_extension = overlay.split("- id: !extend external_media_player", 1)[1].split(
        "\nscript:", 1
    )[0]
    play = overlay.split("action: podvoice_reply_play", 1)[1].split(
        "action: podvoice_reply_cancel", 1
    )[0]

    assert "id: external_media_player" in dial
    assert "on_volume:" in external_extension
    assert "id(podvoice_reply_player)" in external_extension
    assert ".set_volume(id(external_media_player).volume)" in external_extension
    assert "volume_call.set_volume(id(external_media_player).volume)" in play
    assert play.index("volume_call.perform()") < play.index(".set_media_url(url)")
    private_player = overlay.split(
        "  - platform: speaker_source\n    id: podvoice_reply_player", 1
    )[1].split("id: !extend external_media_player", 1)[0]
    assert "volume_increment: 0.05" in private_player
    assert "volume_min: 0.4" in private_player
    assert "volume_max: 0.85" in private_player
    assert external_extension.index(".set_volume") < external_extension.index(
        "script.execute: control_leds"
    )


def test_each_detection_is_single_use_and_rearm_always_resets_detector():
    base = BASE.read_text()
    overlay = OVERLAY.read_text()
    assert "stop_after_detection: false" in base
    assert "return !id(podvoice_conversation_active);" in base
    assert "id(podvoice_conversation_active) = true;" in base
    assert "id: podvoice_conversation_active" in overlay
    assert "action: podvoice_rearm_wake_word" in overlay
    rearm_action = overlay.split("action: podvoice_rearm_wake_word", 1)[1].split(
        "# RUNTIME audio tuning", 1
    )[0]
    recovery = (
        overlay.split("script:\n", 1)[1]
        .split("- id: podvoice_recover_wake_word", 1)[1]
        .split("id: podvoice_finish_reply", 1)[0]
    )
    assert "podvoice_detector_continuity_proven" not in rearm_action
    assert "frames_written()" not in rearm_action
    assert "script.execute:\n            id: podvoice_rearm_after_silence" in rearm_action
    assert "script.execute:\n                id: podvoice_recover_wake_word" in overlay
    assert "token: int" in rearm_action
    assert "micro_wake_word.stop:" in recovery
    assert "micro_wake_word.start:" in recovery
    assert "frames_written()" in recovery
    assert "wait_until:" in recovery
    assert "podvoice_wake_rearmed" not in rearm_action + recovery
    assert 'return std::to_string(token) + ":recovered";' in recovery
    assert 'return std::to_string(token) + ":fault";' in recovery
    assert "id: podvoice_rearm_ack" in overlay
    assert "id(podvoice_conversation_active) = false;" not in rearm_action
    assert recovery.count("id(podvoice_conversation_active) = false;") == 1
    assert "correlated_reset_rearm_v2" in overlay
    assert base.count("id(podvoice_detector_continuity_proven) = true;") == 1
    voice_assistant = base.split("voice_assistant:\n", 1)[1]
    connected = voice_assistant.split("on_client_connected:", 1)[1].split(
        "on_client_disconnected:", 1
    )[0]
    disconnected = voice_assistant.split("on_client_disconnected:", 1)[1].split("on_error:", 1)[0]
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


def test_mains_powered_voice_link_disables_wifi_power_saving():
    overlay = OVERLAY.read_text()
    wifi = overlay.split("wifi:", 1)[1].split("globals:", 1)[0]
    assert "power_save_mode: none" in wifi


def test_center_button_never_starts_stock_assist():
    base = BASE.read_text()
    click = base.split("on_multi_click:", 1)[1].split("\n    - timing:", 1)[0]
    assert "- voice_assistant.start:" not in click
    assert "event_type: single_press" in click
