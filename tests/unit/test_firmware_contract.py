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
    active = "\n".join(line for line in external.splitlines() if not line.lstrip().startswith("#"))
    audio_source = next(
        block for block in active.split("  - source:") if "components: [podvoice_audio]" in block
    )
    assert "ref: cde7945b06f28f544762368689c8638cedffa3a6" in audio_source
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
    assert base.count("id(pv_audio).begin_conversation(boundary)") == 1
    assert "id(mww).wake_audio_position()" in base
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
    assert "podvoice_build_11378_wakeboundary1" in overlay
    assert "podvoice_playback_events_v1" in overlay
    assert "action: podvoice_reply_play" in overlay
    assert "action: podvoice_reply_cancel" in overlay
    assert "correlated_local_stop_v1" in overlay
    assert "correlated_stop_context_v2" in overlay
    assert "action: podvoice_stop_context" in overlay
    assert "id: podvoice_reply_status" in overlay
    assert "id(pv_reply).play(token, url, session, generation)" in overlay
    assert "id(pv_reply).cancel(token)" in overlay
    assert "decibel_reduction: 0" in overlay
    stream_stop = overlay.split("action: podvoice_stream_stop", 1)[1].split(
        "action: podvoice_rearm_wake_word", 1
    )[0]
    assert "pv_audio).stop_streaming()" in stream_stop
    assert "pv_reply).rearmed()" not in stream_stop
    assert "podvoice_direct_prepare" not in overlay
    assert "direct_speaker_v3" not in overlay


def test_wake_boundary_uses_detector_position_and_keepalive_never_trims_live_speech():
    """Only physical wake may trim audio; it preserves same-breath word onset."""
    base = BASE.read_text()
    source = (ROOT / "esphome" / "components" / "podvoice_audio" / "podvoice_audio.cpp").read_text()
    begin = source.split("bool PodVoiceAudio::begin_conversation(", 1)[1].split(
        "void PodVoiceAudio::start_streaming()", 1
    )[0]
    keepalive = source.split("void PodVoiceAudio::start_streaming()", 1)[1].split(
        "void PodVoiceAudio::stop_streaming()", 1
    )[0]

    assert base.count("id(pv_audio).begin_conversation(boundary)") == 1
    assert "id(mww).wake_audio_position()" in base
    assert "WAKE_BRIDGE_MS" not in source
    assert "claim_wake_audio" in begin
    assert "ring_buffer_->read" in begin
    assert "ring_buffer_->reset()" not in begin
    assert "ring_buffer_->reset()" not in keepalive


def test_each_detection_is_single_use_and_rearm_always_resets_detector():
    base = BASE.read_text()
    overlay = OVERLAY.read_text()
    assert "stop_after_detection: false" in base
    assert 'return !id(podvoice_conversation_active) && wake_word != "Stop";' in base
    assert "id(podvoice_conversation_active) = id(pv_reply).begin_conversation();" in base
    assert "id: podvoice_conversation_active" in overlay
    assert "action: podvoice_rearm_wake_word" in overlay
    rearm_action = overlay.split("action: podvoice_rearm_wake_word", 1)[1].split(
        "# RUNTIME audio tuning", 1
    )[0]
    recovery = (
        overlay.split("script:\n", 1)[1]
        .split("- id: podvoice_recover_wake_word", 1)[1]
        .split("# --- Phase 2:", 1)[0]
    )
    assert "podvoice_detector_continuity_proven" not in rearm_action
    assert "frames_written()" not in rearm_action
    assert "id: podvoice_recover_wake_word" in rearm_action
    assert "pv_reply).ready_to_rearm()" in rearm_action
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


def test_stop_owner_and_observers_fetch_the_reviewed_immutable_component_tree():
    import hashlib

    external = (
        OVERLAY.read_text().split("external_components:", 1)[1].split("\npodvoice_audio:", 1)[0]
    )
    active = "\n".join(line for line in external.splitlines() if not line.lstrip().startswith("#"))
    assert "type: local" not in active
    stop_source = active.split("components: [podvoice_reply, micro_wake_word]", 1)[0]
    assert "type: git" in stop_source
    assert "url: https://github.com/BixelVentures/podvoice" in stop_source
    assert "path: esphome/components" in stop_source
    assert "ref: cde7945b06f28f544762368689c8638cedffa3a6" in stop_source
    assert active.count("ref: cde7945b06f28f544762368689c8638cedffa3a6") == 2
    observers = active.split("components: [mixer, resampler, speaker_source]", 1)[0]
    assert "ref: 305b51059dc0c7391b95896f359a6c7f64548f16" in observers
    files = sorted(
        p
        for name in ("micro_wake_word", "podvoice_reply", "podvoice_audio")
        for p in (ROOT / "esphome/components" / name).rglob("*")
        if p.is_file() and "__pycache__" not in p.parts
    )
    assert len(files) == 18
    manifest = "".join(
        str(p.relative_to(ROOT)) + "\0" + hashlib.sha256(p.read_bytes()).hexdigest() + "\n"
        for p in files
    )
    assert hashlib.sha256(manifest.encode()).hexdigest() == (
        "aa98ec79df140b455a63fb7970666e717d530941c118e57ef4797daf8dc401c1"
    )


def test_output_fence_uses_one_ordered_mixer_callback():
    source = (ROOT / "esphome/components/mixer/speaker/mixer_speaker.cpp").read_text()
    callback = source.split("void MixerSpeaker::setup()", 1)[1].split(
        "void MixerSpeaker::loop()", 1
    )[0]
    assert callback.index("podvoice_consumed_frames_.fetch_add") < callback.index(
        "atomic_subtract_clamped(this->frames_in_pipeline_"
    )
    owner = (ROOT / "esphome/components/podvoice_reply/podvoice_reply.h").read_text()
    assert "add_audio_output_callback" not in owner
    assert "output_frames_" not in owner
    assert "fence_anchor_ = mixer_->podvoice_consumed_frames()" in owner
