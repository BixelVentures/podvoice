"""Source contracts for the operational panel, settings and passive diagnosis."""

from pathlib import Path

PANEL = Path(__file__).parents[2] / "podvoice" / "gatekeeper" / "static" / "index.html"


def test_raw_device_ip_has_a_live_setup_warning():
    html = PANEL.read_text()

    assert 'id="s_room_warning"' in html
    assert 'role="alert"' in html
    assert "function isRawIpv4" in html
    assert "updateAddressWarning" in html
    assert "podvoice-pe-123456.local" in html
    assert "Brug et <code>.local</code>-navn eller en fast IP-adresse." in html


def test_duplicate_light_legend_and_dead_transcript_ui_are_gone():
    html = PANEL.read_text()

    assert "What the light ring means" not in html
    assert "function addTranscript" not in html
    assert 'getElementById("tx")' not in html


def test_panel_header_shows_running_version_from_status():
    html = PANEL.read_text()

    assert 'if (data && data.version) bits.push("v" + data.version);' in html
    assert 'connected ? "status live" : "status forbinder…"' in html


def test_panel_has_no_production_simulation_control_or_status():
    html = PANEL.read_text().lower()
    assert "s_simulate" not in html
    assert "simulation mode" not in html
    assert '"simulate"' not in html


def test_service_status_is_live_and_names_runtime_truths():
    html = PANEL.read_text()

    assert "JSON.stringify([services || {}, details || {}, !!diagnosticActive])" in html
    assert "lastStatus.service_details[ev.name] = ev.detail" in html
    assert '"wake-klar"' in html
    assert '"ikke verificeret"' in html
    assert '"standby - ikke prøvet"' in html
    assert '"klar ved seneste samtale"' in html
    assert '"ratebegrænset"' in html


def test_test_tab_can_arm_one_local_physical_audio_trace():
    html = PANEL.read_text()
    assert "Lydbevis" in html
    assert "Optag næste samtale" in html
    assert 'fetch("api/audio-trace/arm"' in html
    assert 'fetch("api/audio-trace"' in html


def test_test_tab_shows_automatic_audio_free_lifecycle_timeline():
    html = PANEL.read_text()
    assert "Seneste samtaletidslinje" in html
    assert 'id="lifecycle_timeline"' in html
    assert "renderLifecycle(data.timeline_activity || [])" in html
    assert "Wake → provider klar:" in html
    assert "Tur: tekst " in html
    assert "Lukning → rearm-kvittering:" in html
    for event in (
        "wake_received",
        "provider_connected",
        "speech_stopped",
        "tool_result",
        "playback_started",
        "close_requested",
        "wake_rearmed",
    ):
        assert event in html


def test_actual_mic_preferences_remain_without_baseline_tutorial():
    html = PANEL.read_text()

    assert 'id="s_mic_channel"' in html
    assert 'id="s_mic_gain"' in html
    assert 'id="s_openai_noise"' in html
    assert "AGC-less channel 1" in html
    assert 'gpt-realtime-2.1">GPT Realtime 2.1 (standardkvalitet)' in html
    assert "Registrerede ord er en transskription, som kan være forkert." in html
    assert "noiseSuppression: false" in html
    assert "autoGainControl: false" in html
    assert 'type: "mic_config"' in html


def test_panel_uses_complete_accessible_tab_contract():
    html = PANEL.read_text()

    for name in ("home", "talk", "history", "settings"):
        assert f'id="tab-{name}"' in html
        assert f'aria-controls="pane-{name}"' in html
        assert f'id="pane-{name}"' in html
    assert 'id="tab-test"' not in html
    assert 'aria-controls="pane-test"' not in html
    assert '<details class="adv" id="pane-test"' in html
    assert '<summary id="diagnostics-summary">Fejlfinding</summary>' in html
    assert (
        html.index('id="pane-settings"')
        < html.index('id="s_advanced"')
        < html.index('id="pane-test"')
    )
    assert 'role="tabpanel"' in html
    assert 'aria-selected="true"' in html
    assert 'e.key === "ArrowRight"' in html
    assert 'e.key === "ArrowLeft"' in html
    assert ":focus-visible" in html
    assert "min-height:44px" in html
    assert "prefers-reduced-motion: reduce" in html


def test_talk_wakes_only_after_successful_capture_and_releases_tracks():
    html = PANEL.read_text()

    assert "return false;" in html
    assert "if (started) sendWake();" in html
    assert 'if (!wsReady) { micStop(); setState("offline"' in html
    assert "micBtn.disabled = !wsReady;" in html
    assert (
        'window.addEventListener("pagehide", function () { closeLivePeer(); micStop(); });' in html
    )
    assert (
        'window.addEventListener("beforeunload", function () { closeLivePeer(); micStop(); });'
        in html
    )
    assert (
        "wsReady = false; micBtn.disabled = true; closeLivePeer(); micStop(); stopReply(false); "
        'setState("offline"' in html
    )
    assert 'if (ev.state === "IDLE") { endTurn(); micStop(); }' in html
    assert 'micBtn.setAttribute("aria-pressed", "true")' in html
    assert "Talk-mikrofonen understøttes ikke inde i dette Home Assistant-panel" in html
    assert "Indstillinger → Apps → Home Assistant → Mikrofon" in html
    assert 'id="cplay"' in html


def test_talk_v2_commits_only_acknowledged_text_and_detects_stale_sockets():
    html = PANEL.read_text()

    assert 'ev.type === "hello" && ev.protocol === 2' in html
    assert 'ev.type === "command_result"' in html
    assert "pendingText[commandId] = { text: t }" in html
    assert "if (sendBtn.disabled || diagnosticActive || !talkVisible()) return;" in html
    assert 'logLine("in", "you", pending.text)' in html
    assert 'logLine("in", "you", t)' not in html
    assert "Date.now() - lastPong > 15000" in html
    assert "generation !== socketGeneration" in html
    assert "playback_id: playbackId" in html
    assert "owner.playbackId === ev.playback_id" in html
    assert "(!currentPlaybackId || currentPlaybackId === ev.playback_id)" in html
    assert "var stopped = valid && stopReply(false);" in html
    assert "if (stopped) { pendingLiveRotation = null; endTurn(); }" in html
    assert 'micStop(); stopReply(false); setState("offline"' in html


def test_panel_does_not_claim_unverified_stop_and_labels_capability_truth():
    html = PANEL.read_text()

    assert "silences it instantly" not in html
    assert "Øjeblikkelig stilhed" not in html
    assert 'toast("Kommando modtaget")' in html
    assert 'verified ? "verificeret" : ok ? "fundet" : known ? "mangler" : "ukendt"' in html
    assert 'SVC_LABEL[name] + ": " + label' in html
    assert "Home Assistant forbinder igen" in html
    assert "discovery.last_error" in html
    assert "discovery.next_retry_at" in html
    assert "genstart PodVoice" not in html


def test_effective_model_and_custom_turn_controls_are_explicit():
    html = PANEL.read_text()

    assert 'id="s_model_effective"' in html
    assert "Realtime-model efter genstart: GPT Realtime 2.1 mini (tvunget)" in html
    assert 'id="s_custom_turn"' in html
    for field in (
        "openai_turn",
        "openai_threshold",
        "openai_prefix_ms",
        "openai_silence_ms",
        "openai_eagerness",
    ):
        assert f'id="s_{field}"' in html
    assert 'custom.hidden = !f("turn_preset")' in html


def test_partial_room_mapping_is_never_silently_discarded():
    html = PANEL.read_text()

    assert "if (!valid) return null;" in html
    assert "Udfyld både Voice PE-adresse og PodConnect-rum" in html
    assert "reportValidity()" in html


def test_panel_removes_complete_conversation_test_owners_and_automatic_fetches():
    html = PANEL.read_text()
    removed_ids = (
        "eval_live",
        "eval_audio_idle",
        "eval_protocol_owner",
        "eval_golden",
        "eval_close",
        "eval_quiet_thanks",
        "eval_device",
        "eval_data",
        "eval_replay",
        "eval_numeric_ab",
        "eval_numeric_preview",
        "eval_result",
        "g_start",
        "g_test",
        "g_actions",
        "g_final_actions",
        "g_hint",
        "a_start",
        "a_refresh",
        "stuetest_script",
        "acceptance",
    )
    for element_id in removed_ids:
        assert f'id="{element_id}"' not in html
        assert f'getElementById("{element_id}")' not in html
    for endpoint in ("api/eval/", "api/groundtest", "api/stuetest", "api/acceptance"):
        assert endpoint not in html
    for owner in (
        "Guided physical baseline",
        "Living-room acceptance evidence",
        "Bounded live Realtime preflight",
    ):
        assert owner not in html
    for heading in (
        "Maskinel Realtime-preflight",
        ">Grundtest<",
        "Teknisk evidens og den gamle stuetest",
    ):
        assert heading not in html


def test_removed_test_owners_preserve_operational_controls_and_audio_evidence():
    html = PANEL.read_text()
    for element_id in (
        "tab-talk",
        "ctext",
        "csend",
        "cmic",
        "cstop",
        "tab-settings",
        "s_save",
        "s_saverestart",
        "s_system_prompt",
        "trace_arm",
        "trace_cancel",
        "trace_analyse",
        "trace_analysis",
        "lifecycle_timeline",
        "vp_status",
        "vp_s1",
        "vp_s2",
        "vp_result",
    ):
        assert f'id="{element_id}"' in html
    for owner in (
        "In-panel talk console",
        "Settings page",
        "Local conversation diagnostics",
        "Voice PE setup diagnostics",
    ):
        assert owner in html
    assert 'fetch("api/audio-trace/arm"' in html
    assert 'fetch("api/audio-analysis"' in html
    assert '"Test højttaler", "test_speaker"' in html
