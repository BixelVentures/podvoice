"""Locks for safety guidance that must be visible without reading add-on logs."""

import json
from pathlib import Path

PANEL = Path(__file__).parents[2] / "podvoice" / "gatekeeper" / "static" / "index.html"


def test_groundtest_hidden_action_rows_override_flex_display():
    html = PANEL.read_text()
    assert "#g_actions[hidden], #g_final_actions[hidden] { display: none; }" in html
    for element_id in ("g_actions", "g_final_actions"):
        assert f'id="{element_id}" class="crow" hidden' in html


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
    assert 'testCase.close_mode === "semantic"' in html
    assert "Når opfølgningssvaret er helt færdigt: sig ingenting og vent i stilhed." in html
    assert "Nabu må sige højst ét kort farvel eller" not in html
    assert "fem med en afslutningssætning, fem med fire sekunders stilhed" in html
    assert 'id="g_final_actions"' in html
    assert 'fetch("api/groundtest/final-wake"' in html
    assert "10 samtaler målt — sidste rearm-bevis mangler" in html
    assert "30 fysiske ytringer" not in html
    assert "Uden nyt wake-ord" in html
    assert "dens wake beviser den forrige rearm" in html
    assert "De seneste 12 lydbeviser beholdes lokalt" in html
    assert "inden to minutter" in html


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
    assert 'id="eval_protocol_owner"' in html
    assert 'id="eval_golden"' in html
    assert 'id="eval_replay"' in html
    assert 'id="eval_numeric_ab"' in html
    assert 'id="eval_result"' in html
    assert 'fetch("api/eval/live"' in html
    assert 'fetch("api/eval/live?run_id="' in html
    assert 'fetch("api/eval/replay"' in html
    assert 'fetch("api/eval/protocol-owner"' in html


def test_protocol_owner_probe_has_one_canonical_locked_polling_trigger():
    html = PANEL.read_text()
    handler_start = html.index("protocolOwnerButton.onclick = async function ()")
    handler_end = html.index("goldenButton.onclick", handler_start)
    handler = html[handler_start:handler_end]

    assert html.count('id="eval_protocol_owner"') == 1
    assert html.count('fetch("api/eval/protocol-owner"') == 1
    assert html.count("body:'{\"max_cost_usd\":5}'") == 1
    assert 'headers:{"Content-Type":"application/json"}' in html
    assert "protocolOwnerButton.disabled = disabled;" in html
    assert handler.index("setButtonsDisabled(true)") < handler.index(
        'fetch("api/eval/protocol-owner"'
    )
    assert handler.index('fetch("api/eval/protocol-owner"') < handler.index(
        "await poll(data.run_id, generation, data.deadline_s)"
    )
    assert "finally { if (generation === pollGeneration) setButtonsDisabled(false); }" in handler
    assert 'data.status === "running" || data.status === "busy"' in html
    assert "poll(data.run_id, generation, data.deadline_s)" in html
    assert 'fetch("api/eval/live?run_id=" + encodeURIComponent(runId)' in html
    assert 'data.kind === "protocol-owner"' in html
    assert 'data.decision === "GO_TO_RELEASE_GATE"' in html
    assert 'data.classification === "protocol-owner-proven"' in html
    assert "Fysisk golden chain og 10/10 mangler stadig." in html
    assert '"Årsag: " + (finding.message' in html
    assert "data.prompt_source" in html
    assert "brugerdefineret prompt" in html
    assert "kan ikke styre hjemmet, musik eller timere" in html
    assert "audio-model-nondeterminism" in html
    assert "semantic-audio-consistent" in html
    assert "text-contract-failure" in html
    assert "trace-provenance-mismatch" in html
    assert "tool-schema-mismatch" in html
    assert "Nabu og Talk låses" in html
    assert "$5" in html and "$0,128" not in html
    assert "første sikre scenariesvar er providerpreflight" in html
    assert 'window.addEventListener("podvoice-diagnostic"' in html
    assert 'setState("systemtest", "pill-degraded")' in html
    assert "data.diagnostic_active" in html


def test_test_tab_exposes_symmetric_numeric_followup_ab_without_answer_hints():
    html = PANEL.read_text()
    payload = 'var payload = {mode:"numeric-followup-ab",turn_index:1,repeats:5,text_repeats:5};'
    button_start = html.index('id="eval_numeric_ab"')
    button_end = html.index("</button>", button_start)
    button_markup = html[button_start:button_end]

    assert "Sammenlign numerisk opfølgning: tekst ↔ lyd 5×" in button_markup  # noqa: RUF001
    assert html.count(payload) == 1
    assert "numericAbButton.disabled = disabled;" in html
    assert 'id="eval_numeric_preview"' in html
    assert "data.text_repeats_requested === 5" in html
    assert "data.audio_repeats_requested === 5" in html
    assert "Numerisk A/B-kandidat før start: trace " in html
    assert 'source.podvoice_version || "mangler"' in html
    assert 'source.artifact_identity_kind || "mangler"' in html
    assert "shortHash(source.artifact_sha256)" in html
    assert 'data.kind === "semantic-audio-ab"' in html
    assert "data.controls || []" in html
    assert "data.trace || {}" in html
    assert "trace.source_provenance || {}" in html
    assert "trace.replay_provenance || {}" in html
    assert "trace.provenance_match === true" in html
    assert "trace.provenance_mismatches.join" in html
    assert "data.text_repeats_completed" in html
    assert "data.audio_repeats_completed" in html
    assert "data.decision" in html
    assert "Samlet prisloft: $5; ingen eksterne effekter" in html
    assert "84" not in button_markup and "90" not in button_markup


def test_semantic_audio_ab_panel_fails_closed_for_malformed_or_stale_report_contract():
    html = PANEL.read_text()
    contract_start = html.index("function semanticAudioAbPassed(data)")
    contract_end = html.index("function renderRunning(data)", contract_start)
    contract = html[contract_start:contract_end]
    render_start = html.index("function render(data)")
    render_end = html.index("function poll", render_start)
    render = html[render_start:render_end]

    required_guards = (
        'data.kind === "semantic-audio-ab"',
        "data.ok === true",
        'data.decision === "GO_TO_PHYSICAL_CANARY"',
        'data.classification === "semantic-audio-consistent"',
        "trace.provenance_match === true",
        "data.text_repeats_completed === 5",
        "data.audio_repeats_completed === 5",
        "Array.isArray(controls) && controls.length === 5",
        "result.passed === true",
        "Array.isArray(trials) && trials.length === 5",
    )
    for guard in required_guards:
        assert guard in contract

    assert "var replayPassed = isSemanticAb ? semanticAudioAbPassed(data)" in render
    assert '"line " + (replayPassed ? "out" : "in")' in render
    assert 'isSemanticAb ? " BLOKERET"' in render
    assert '(data.ok ? "out" : "in")' not in render


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
    assert "Hårdt samlet prisloft: $5" in html
    assert "Ingen eksterne effekter" in html
    assert html.count(expected_profile) == 1
    assert "return startLiveEval(closeScenarioIds);" in html
    assert "return startLiveEval(null);" in html
    assert "if (scenarioIds) payload.scenario_ids = scenarioIds;" in html
    assert "if (repeats) payload.repeats = repeats;" in html
    assert "button.disabled = disabled; goldenButton.disabled = disabled;" in html
    assert "replayButton.disabled = disabled;" in html

    manifest = json.loads((PANEL.parents[1] / "eval_scenarios.json").read_text())
    scenarios = {scenario["id"]: scenario for scenario in manifest["scenarios"]}
    assert sum(len(scenarios[scenario_id]["turns"]) for scenario_id in scenario_ids) == 8


def test_test_tab_exposes_exact_five_by_five_golden_semantic_profile():
    html = PANEL.read_text()
    manifest = json.loads((PANEL.parents[1] / "eval_scenarios.json").read_text())
    scenarios = {scenario["id"]: scenario for scenario in manifest["scenarios"]}
    golden = scenarios["arithmetic-followup-observed"]

    assert 'id="eval_golden"' in html
    assert "Test golden-chain-semantik 5×" in html  # noqa: RUF001 - exact UI copy
    assert 'var goldenScenarioIds = ["arithmetic-followup-observed"];' in html
    assert "return startLiveEval(goldenScenarioIds, 5);" in html
    assert len(golden["turns"]) == 5
    assert [turn["text"] for turn in golden["turns"]] == [
        "Hvad er tolv gange syv?",
        "Læg seks til.",
        "Hvad er klokken lige nu?",
        "Og hvilken ugedag er det lige nu?",
        "Tak, det var alt for denne test.",
    ]


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
    assert 'toast("Kommando modtaget")' in html
    assert 'verified ? "verificeret" : ok ? "fundet" : "mangler"' in html
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


def test_quiet_thanks_button_runs_only_the_twelve_turn_profile_under_existing_lock():
    html = PANEL.read_text()
    assert 'id="eval_quiet_thanks"' in html
    assert 'return startLiveEval(["quiet-thanks"], 1);' in html
    assert "quietThanksButton.disabled = disabled;" in html
    manifest = json.loads((PANEL.parents[1] / "eval_quiet_thanks_scenarios.json").read_text())
    assert sum(len(s["turns"]) for s in manifest["scenarios"]) == 12
    assert "Test stille tak og opfølgning (12 ture)" in html


def test_audio_idle_probe_has_one_fixed_synthetic_trigger_and_existing_poll():
    html = PANEL.read_text()
    start = html.index("audioIdleButton.onclick = async function ()")
    end = html.index("numericAbButton.onclick", start)
    handler = html[start:end]
    assert html.count('id="eval_audio_idle"') == 1
    assert "Højst fem faste, syntetiske lydklip" in html
    assert "Ingen lyd fra dit hjem" in html
    assert 'body:\'{"action":"audio-idle-probe"}\'' in handler
    assert handler.index("setButtonsDisabled(true)") < handler.index("fetch(")
    assert "await poll(data.run_id, generation, 12)" in handler
    assert "setButtonsDisabled(false)" in handler
    assert "Ukendt er usikkerhed" in html
    assert "audioIdleButton.disabled = disabled" in html


def test_audio_idle_reload_renders_retained_identity_without_provider_dispatch():
    import shutil
    import subprocess

    import pytest

    node = shutil.which("node")
    if node is None:
        pytest.skip("Node required for shipped diagnostic render")
    html = PANEL.read_text()
    script = html.split(
        "// ---- Bounded live Realtime preflight; fixed tools, no HA/MCP side effects ----", 1
    )[1].split("</script>", 1)[0]
    harness = r"""
const assert=require('node:assert/strict');
class Element {
 constructor(){this.children=[];this.textContent='';this.disabled=false;}
 appendChild(e){this.children.push(e);return e;}
 set innerHTML(value){this.children=[];this.textContent='';}
}
const elements=new Map();
const document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},
 createElement(){return new Element();},createTextNode(text){let e=new Element();e.textContent=text;return e;}};
const window={setTimeout};
const calls=[];
const retained={kind:'audio-idle-probe',status:'failed',run_id:'eval-visible-identity',probe_used:true,
 judge_sha256:'source-binding-visible',results:[{case:'quiet',verdict:'unknown',elapsed_s:1.18,
 returned_model:'gpt-audio-1.5',reason:'finish_reason_not_stop'}]};
async function fetch(url,options){calls.push({url,options});return {async json(){return url.includes('?kind=')?retained:{status:'idle'};}};}
function text(e){return e.textContent+e.children.map(text).join(' ');}
"""
    assertions = r"""
setImmediate(()=>{
 try {
  assert.deepEqual(calls.map(x=>x.url),['api/eval/live','api/eval/live?kind=audio-idle-probe']);
  assert(calls.every(x=>!x.options.method)); // Recovery is GET only, never dispatch.
  const rendered=text(elements.get('eval_result'));
  for(const value of ['eval-visible-identity','source-binding-visible','gpt-audio-1.5','1.18','finish_reason_not_stop'])assert(rendered.includes(value),value);
  assert.equal(elements.get('eval_audio_idle').disabled,true);
  assert(elements.get('eval_result').children.some(e=>e.href==='api/eval/live?run_id=eval-visible-identity'));
  console.log('RETAINED_REPORT_RENDERED');
 } catch(e){console.error(e);process.exitCode=1;}
});
"""
    result = subprocess.run(
        [node, "-e", harness + script + assertions], capture_output=True, text=True, timeout=5
    )
    assert result.returncode == 0, result.stderr
    assert "RETAINED_REPORT_RENDERED" in result.stdout


def test_audio_idle_stale_recovery_cannot_overwrite_new_button_attempt():
    import shutil
    import subprocess

    import pytest

    node = shutil.which("node")
    if node is None:
        pytest.skip("Node required for shipped diagnostic ordering")
    html = PANEL.read_text()
    script = html.split(
        "// ---- Bounded live Realtime preflight; fixed tools, no HA/MCP side effects ----", 1
    )[1].split("</script>", 1)[0]
    harness = r"""
const assert=require('node:assert/strict');
class Element {
 constructor(){this.children=[];this.textContent='';this.disabled=false;}
 appendChild(e){this.children.push(e);return e;}
 set innerHTML(value){this.children=[];this.textContent='';}
}
const elements=new Map();
const document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},
 createElement(){return new Element();},createTextNode(text){let e=new Element();e.textContent=text;return e;}};
const window={setTimeout};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
const entered=deferred(),release=deferred(),newPost=deferred(),calls=[];
const oldReport={kind:'audio-idle-probe',status:'failed',run_id:'eval-OLD-report',probe_used:true,results:[]};
async function delayAt(stage,value){if(stage===phase){entered.resolve();await release.promise;}return value;}
async function fetch(url,options){
 calls.push({url,options});
 if(options.method==='POST')return newPost.promise;
 if(url.includes('?kind='))return delayAt('kind_response',{json:()=>delayAt('kind_json',oldReport)});
 return delayAt('initial_response',{json:()=>delayAt('initial_json',{status:'idle'})});
}
function text(e){return e.textContent+e.children.map(text).join(' ');}
"""
    assertions = r"""
(async()=>{
 await entered.promise;
 const button=elements.get('eval_audio_idle');
 const newer=button.onclick(); // Actual shipped handler establishes a newer generation.
 assert.equal(button.disabled,true);
 assert.equal(calls.filter(x=>x.options.method==='POST').length,1);
 release.resolve();await new Promise(setImmediate);
 assert.equal(text(elements.get('eval_result')).includes('eval-OLD-report'),false);
 assert.equal(button.disabled,true);
 if(phase.startsWith('initial'))assert.equal(calls.some(x=>x.url.includes('?kind=')),false);
 newPost.resolve({json:async()=>({kind:'audio-idle-probe',status:'failed',results:[{case:'new-attempt',verdict:'unknown',reason:'new-attempt'}]})});
 await newer;
 assert.equal(button.disabled,false); // Old recovery must not set the one-shot-used flag.
 assert(text(elements.get('eval_result')).includes('new-attempt'));
 assert.equal(text(elements.get('eval_result')).includes('eval-OLD-report'),false);
 console.log('STALE_RECOVERY_INERT');
})().catch(e=>{console.error(e);process.exitCode=1;});
"""
    for phase in ("initial_response", "initial_json", "kind_response", "kind_json"):
        result = subprocess.run(
            [node, "-e", "const phase=" + json.dumps(phase) + ";" + harness + script + assertions],
            capture_output=True,
            text=True,
            timeout=5,
        )
        assert result.returncode == 0, (phase, result.stderr)
        assert "STALE_RECOVERY_INERT" in result.stdout, phase
