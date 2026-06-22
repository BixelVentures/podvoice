"""Panel settings store + config merge."""

from __future__ import annotations

import json

from gatekeeper import settings as S
from gatekeeper.config import load_config


def test_defaults_and_roundtrip(tmp_path):
    p = tmp_path / "podvoice.json"
    d = S.load_settings(p)
    assert d["provider"] == "gemini" and d["rooms"] == [] and d["duck_level"] == 5

    saved = S.save_settings({"provider": "openai", "duck_level": 7, "bogus": "x"}, p)
    assert saved["provider"] == "openai" and saved["duck_level"] == 7
    assert "bogus" not in saved  # only known keys are kept

    assert S.load_settings(p)["provider"] == "openai"


def test_corrupt_file_falls_back(tmp_path):
    p = tmp_path / "podvoice.json"
    p.write_text("{ not json")
    assert S.load_settings(p)["provider"] == "gemini"


def test_load_config_merges_settings_with_keys(tmp_path, monkeypatch):
    sp = tmp_path / "podvoice.json"
    S.save_settings({"provider": "openai", "podconnect_base_url": "http://x:8099"}, sp)
    monkeypatch.setattr(S, "SETTINGS_PATH", sp)

    opts = tmp_path / "options.json"
    opts.write_text(json.dumps({"gemini_api_key": "g", "openai_api_key": "o"}))

    cfg = load_config(opts)
    assert cfg.provider == "openai"  # from settings
    assert cfg.gemini_api_key == "g" and cfg.openai_api_key == "o"  # from options (keys only)
    assert cfg.podconnect_base_url == "http://x:8099"
