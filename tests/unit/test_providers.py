"""Provider factory + model listing (OpenAI-only after the v2 overhaul)."""

from __future__ import annotations

from gatekeeper.config import from_options
from gatekeeper.console import list_models
from gatekeeper.openai_realtime import DEFAULT_MODEL, FULL_MODEL, make_session


def _cfg(**kw):
    base = {"openai_api_key": "o", "rooms": []}
    base.update(kw)
    return from_options(base)


def test_make_session_defaults_to_mini():
    s = make_session(_cfg())
    assert type(s).__name__ == "OpenAIRealtimeSession"
    assert s.model == DEFAULT_MODEL == "gpt-realtime-2.1-mini"


def test_make_session_explicit_model_override():
    assert make_session(_cfg(), model=FULL_MODEL).model == "gpt-realtime-2.1"


def test_force_mini_clamps_every_session():
    # The cost guard: with force_mini on, even an explicit big-model pick runs mini.
    cfg = _cfg(force_mini=True, openai_model=FULL_MODEL)
    assert make_session(cfg).model == DEFAULT_MODEL
    assert make_session(cfg, model=FULL_MODEL).model == DEFAULT_MODEL


def test_list_models_static():
    m = list_models(_cfg())
    assert m["provider"] == "openai"
    assert any(x["id"] == "gpt-realtime-2.1-mini" for x in m["models"])
    assert any(x["id"] == "gpt-realtime-2.1" for x in m["models"])
    assert all(x["live"] for x in m["models"])  # all OpenAI realtime models do voice
