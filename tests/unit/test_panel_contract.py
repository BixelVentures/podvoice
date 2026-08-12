"""Locks for safety guidance that must be visible without reading add-on logs."""

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


def test_living_room_test_script_is_visible_in_panel():
    html = PANEL.read_text()

    assert 'id="stuetest_script"' in html
    assert 'id="a_start"' in html
    assert 'fetch("api/stuetest"' in html
    assert 'fetch("api/stuetest/start"' in html
    assert "Fysisk stuetest" in html
    assert "Næste handling" in html


def test_documented_mic_baseline_is_visible_in_panel():
    html = PANEL.read_text()

    assert 'id="s_mic_channel"' in html
    assert 'id="s_mic_gain"' in html
    assert 'id="s_openai_noise"' in html
    assert "AGC-less channel 1" in html
    assert "gain 4" in html
    assert "ingen ekstra OpenAI-støjfiltrering" in html
    assert 'gpt-realtime-2.1">GPT Realtime 2.1 (quality standard)' in html
    assert "separat diagnostisk transcript" in html
    assert "turn: input transcript" in html
    assert "noiseSuppression: false" in html
    assert "autoGainControl: false" in html
    assert 'type: "mic_config"' in html
