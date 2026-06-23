"""Per-provider tuning knobs flow into the session configs (Gemini VAD / OpenAI)."""

from __future__ import annotations

from gatekeeper.config import from_options
from gatekeeper.gemini import build_config
from gatekeeper.openai_realtime import OpenAIRealtimeSession
from gatekeeper.settings import load_settings, save_settings


def test_build_config_includes_gemini_vad():
    cfg = from_options({"gemini_vad_start": "low", "gemini_silence_ms": 700})
    aad = build_config(cfg)["realtime_input_config"]["automatic_activity_detection"]
    assert aad["start_of_speech_sensitivity"] == "low"
    assert aad["end_of_speech_sensitivity"] == "high"  # default
    assert aad["silence_duration_ms"] == 700


def test_openai_session_semantic_with_noise():
    s = OpenAIRealtimeSession(api_key="k", turn="semantic_vad", eagerness="low", noise="far_field")
    inp = s._session_update()["session"]["audio"]["input"]
    assert inp["turn_detection"]["type"] == "semantic_vad"
    assert inp["turn_detection"]["eagerness"] == "low"
    assert inp["noise_reduction"] == {"type": "far_field"}


def test_openai_session_server_vad_threshold():
    s = OpenAIRealtimeSession(api_key="k", turn="server_vad", threshold=0.45, silence_ms=600)
    td = s._session_update()["session"]["audio"]["input"]["turn_detection"]
    assert td["type"] == "server_vad"
    assert td["threshold"] == 0.45
    assert td["silence_duration_ms"] == 600


def test_openai_session_turn_none_and_noise_off():
    s = OpenAIRealtimeSession(api_key="k", turn="none", noise="off")
    inp = s._session_update()["session"]["audio"]["input"]
    assert inp["turn_detection"] is None
    assert "noise_reduction" not in inp


def test_web_search_off_by_default_then_on():
    cfg = from_options({})
    assert "tools" not in build_config(cfg)  # no web search, no function tools
    cfg = from_options({"web_search": True})
    tools = build_config(cfg)["tools"]
    assert {"google_search": {}} in tools  # Gemini native search appended

    s = OpenAIRealtimeSession(api_key="k", web_search=True)
    assert {"type": "web_search"} in s._session_update()["session"]["tools"]
    s2 = OpenAIRealtimeSession(api_key="k", web_search=False)
    assert "tools" not in s2._session_update()["session"]


def test_settings_roundtrip_new_keys(tmp_path):
    p = tmp_path / "s.json"
    save_settings(
        {"openai_turn": "server_vad", "gemini_vad_end": "low", "openai_threshold": 0.3}, p
    )
    s = load_settings(p)
    assert s["openai_turn"] == "server_vad"
    assert s["gemini_vad_end"] == "low"
    assert s["openai_threshold"] == 0.3
