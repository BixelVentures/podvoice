"""Provider factory + provider-aware model listing."""

from __future__ import annotations

from gatekeeper.config import from_options
from gatekeeper.console import list_models
from gatekeeper.providers import make_session


def _cfg(**kw):
    base = {"gemini_api_key": "g", "openai_api_key": "o", "rooms": []}
    base.update(kw)
    return from_options(base)


def test_make_session_picks_provider_by_config():
    assert type(make_session(_cfg(provider="openai"))).__name__ == "OpenAIRealtimeSession"
    assert type(make_session(_cfg(provider="gemini"))).__name__ == "GeminiLiveSession"


def test_make_session_explicit_override():
    assert type(make_session(_cfg(), provider="openai")).__name__ == "OpenAIRealtimeSession"


def test_list_models_openai_static_and_live():
    m = list_models(_cfg(), provider="openai")
    assert m["provider"] == "openai"
    assert any(x["id"] == "gpt-realtime-2" for x in m["models"])
    assert all(x["live"] for x in m["models"])  # all OpenAI realtime models do voice


def test_list_models_gemini_static_without_key():
    m = list_models(_cfg(gemini_api_key=""), provider="gemini")
    assert m["provider"] == "gemini"
    assert m["models"] and m["source"].startswith("static")
