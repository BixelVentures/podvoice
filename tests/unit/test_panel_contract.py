"""Locks for safety guidance that must be visible without reading add-on logs."""

import json
from pathlib import Path

PANEL = Path(__file__).parents[2] / "podvoice" / "gatekeeper" / "static" / "index.html"


def test_raw_device_ip_has_a_live_setup_warning():
    html = PANEL.read_text()

    assert 'id="s_room_warning"' in html
    assert 'role="alert"' in html
    assert "function isRawIpv4" in html
    assert "updateAddressWarning" in html
    assert "podvoice-pe-123456.local" in html
    assert "DHCP-reservation" in html


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
    assert '"forbundet - wake afprøves"' in html
    assert '"standby - ikke prøvet"' in html
    assert '"klar ved seneste samtale"' in html
    assert '"ratebegrænset"' in html


def test_living_room_test_script_is_visible_in_panel():
    html = PANEL.read_text()

    assert 'id="stuetest_script"' in html
    assert 'id="a_start"' in html
    assert 'fetch("api/stuetest"' in html
    assert 'fetch("api/stuetest/start"' in html
    assert "Fysisk stuetest" in html
    assert "Næste handling" in html


def test_guided_groundtest_keeps_each_followup_uninterrupted_before_verdict():
    html = PANEL.read_text()

    assert 'id="g_start"' in html
    assert 'id="g_test"' in html
    assert 'fetch("api/groundtest"' in html
    assert 'fetch("api/groundtest/start"' in html
    assert 'fetch("api/groundtest/result"' in html
    assert "Kan ikke testes nu" in html
    for outcome in ("correct", "wrong_hearing", "wrong_answer", "no_response", "blocked"):
        assert f'data-outcome="{outcome}"' in html
    assert "Forkert hørt" in html
    assert "Forkert svar" in html
    assert "Intet skete" in html
    assert "Rør ikke panelet under samtalen" in html
    assert "3. Sig: “Farvel.”" in html
    assert "Uden nyt wake-ord" in html
    assert "næste trin beviser straks rearm" in html


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
    assert "Wake → Realtime klar:" in html
    assert "Tur: tekst " in html
    assert "Lukning → wake klar:" in html
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


def test_documented_mic_baseline_is_visible_in_panel():
    html = PANEL.read_text()

    assert 'id="s_mic_channel"' in html
    assert 'id="s_mic_gain"' in html
    assert 'id="s_openai_noise"' in html
    assert "AGC-less channel 1" in html
    assert "gain 16" in html
    assert "ingen ekstra OpenAI-støjfiltrering" in html
    assert 'gpt-realtime-2.1">GPT Realtime 2.1 (quality standard)' in html
    assert "separat diagnostisk transcript" in html
    assert "turn: input transcript" in html
    assert "noiseSuppression: false" in html
    assert "autoGainControl: false" in html
    assert 'type: "mic_config"' in html


def test_panel_uses_complete_accessible_tab_contract():
    html = PANEL.read_text()

    for name in ("home", "talk", "test", "history", "settings"):
        assert f'id="tab-{name}"' in html
        assert f'aria-controls="pane-{name}"' in html
        assert f'id="pane-{name}"' in html
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
    assert 'window.addEventListener("pagehide", micStop)' in html
    assert 'window.addEventListener("beforeunload", micStop)' in html
    assert (
        "wsReady = false; micBtn.disabled = true; micStop(); stopReply(false); "
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
    assert "if (sendBtn.disabled || diagnosticActive) return;" in html
    assert 'logLine("in", "you", pending.text)' in html
    assert 'logLine("in", "you", t)' not in html
    assert "Date.now() - lastPong > 15000" in html
    assert "generation !== socketGeneration" in html
    assert "playback_id: playbackId" in html
    assert "ev.playback_id === currentPlaybackId" in html
    assert "stopReply(false); endTurn();" in html
    assert 'micStop(); stopReply(false); setState("offline"' in html


def test_test_tab_exposes_bounded_live_realtime_preflight():
    html = PANEL.read_text()

    assert 'id="eval_live"' in html
    assert 'id="eval_replay"' in html
    assert 'id="eval_result"' in html
    assert 'fetch("api/eval/live"' in html
    assert 'fetch("api/eval/live?run_id="' in html
    assert 'fetch("api/eval/replay"' in html
    assert 'data.status === "running" || data.status === "busy"' in html
    assert "poll(data.run_id, generation, data.deadline_s)" in html
    assert '"Årsag: " + (finding.message' in html
    assert "data.prompt_source" in html
    assert "brugerdefineret prompt" in html
    assert "kan ikke styre hjemmet, musik eller timere" in html
    assert "audio-model-nondeterminism" in html
    assert "tool-schema-mismatch" in html
    assert "Nabu og Talk låses" in html
    assert "$5" in html and "$0,128" not in html
    assert "første sikre scenariesvar er providerpreflight" in html
    assert 'window.addEventListener("podvoice-diagnostic"' in html
    assert 'setState("systemtest", "pill-degraded")' in html
    assert "data.diagnostic_active" in html


def test_test_tab_exposes_exact_eight_turn_semantic_close_profile():
    html = PANEL.read_text()
    scenario_ids = [
        "context-followup-then-close",
        "explicit-stop-conversation",
        "media-stop-remains-open",
        "semantic-close",
        "explicit-short-close",
    ]
    expected_profile = """var closeScenarioIds = [
    "context-followup-then-close",
    "explicit-stop-conversation",
    "media-stop-remains-open",
    "semantic-close",
    "explicit-short-close"
  ];"""

    assert 'id="eval_close"' in html
    assert "Test samtaleafslutning (8 ture)" in html
    assert "præcis 5 scenarier og 8 ture" in html
    assert "samme-session-kontekst" in html
    assert "mediestop som negativ kontrol" in html
    assert "Hårdt samlet prisloft: $5" in html
    assert "Ingen eksterne effekter" in html
    assert html.count(expected_profile) == 1
    assert "return startLiveEval(closeScenarioIds);" in html
    assert "return startLiveEval(null);" in html
    assert "JSON.stringify({scenario_ids:scenarioIds})" in html
    assert "button.disabled = disabled; closeButton.disabled = disabled;" in html
    assert "replayButton.disabled = disabled;" in html

    manifest = json.loads((PANEL.parents[1] / "eval_scenarios.json").read_text())
    scenarios = {scenario["id"]: scenario for scenario in manifest["scenarios"]}
    assert sum(len(scenarios[scenario_id]["turns"]) for scenario_id in scenario_ids) == 8


def test_targeted_eval_can_never_render_as_full_release_preflight():
    html = PANEL.read_text()

    assert 'typeof data.selected_ok === "boolean"' in html
    assert 'typeof data.profile_complete === "boolean"' in html
    assert 'typeof data.coverage_complete === "boolean"' in html
    assert 'typeof data.release_preflight_passed === "boolean"' in html
    assert "data.release_preflight_passed === true &&" in html
    assert "selectedOk && profileComplete && coverageComplete" in html
    assert "data.coverage_complete === true" in html
    assert "Fuld profil valgt: " in html
    assert "Dækning gennemført: " in html
    assert "Fuld profil: " not in html
    assert "var targeted = hasReleaseTruth && !profileComplete;" in html
    assert '"line " + (releasePassed ? "out" : "in")' in html
    assert "MÅLRETTET DIAGNOSE BESTÅET \u2013 IKKE FULD PREFLIGHT" in html
    assert "Denne delkørsel er kun diagnose" in html
    assert "RAPPORT MANGLER RELEASE-KONTRAKT" in html


def test_failed_full_eval_is_not_presented_as_a_targeted_diagnosis():
    html = PANEL.read_text()

    # Full-vs-targeted is selected-scope truth, not whether the selected run passed.
    assert "var targeted = hasReleaseTruth && !profileComplete;" in html
    assert "targeted ? (selectedOk ?" in html
    assert '(releasePassed ? "✓ MASKINEL PREFLIGHT BESTÅET"' in html


def test_panel_rejects_inconsistent_release_true_without_complete_coverage():
    html = PANEL.read_text()

    # Even a malformed report claiming release=true remains non-green unless the
    # independent selected/profile/coverage truths all agree.
    assert "data.release_preflight_passed === true &&" in html
    assert "selectedOk && profileComplete && coverageComplete" in html
    assert '"line " + (releasePassed ? "out" : "in")' in html


def test_panel_does_not_claim_unverified_stop_and_labels_capability_truth():
    html = PANEL.read_text()

    assert "silences it instantly" not in html
    assert "Øjeblikkelig stilhed" not in html
    assert "endnu ikke fysisk godkendt" in html
    assert 'verified ? "verificeret" : ok ? "fundet" : "mangler"' in html
    assert 'SVC_LABEL[name] + ": " + label' in html
    assert "Home Assistant forbinder igen" in html
    assert "discovery.last_error" in html
    assert "discovery.next_retry_at" in html
    assert "genstart PodVoice" not in html


def test_effective_model_and_custom_turn_controls_are_explicit():
    html = PANEL.read_text()

    assert 'id="s_model_effective"' in html
    assert "Effektiv model: GPT Realtime 2.1 mini (tvunget)" in html
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
