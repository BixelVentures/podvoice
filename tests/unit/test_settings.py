"""Panel settings store + config merge."""

from __future__ import annotations

import json

from gatekeeper import settings as S
from gatekeeper.config import load_config


def test_defaults_and_roundtrip(tmp_path):
    p = tmp_path / "podvoice.json"
    d = S.load_settings(p)
    assert d["provider"] == "gemini" and d["rooms"] == [] and d["duck_level"] == 0

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


def test_stale_tuning_reset_on_version_bump(tmp_path):
    """A saved file from before SETTINGS_VERSION gets its TUNING_KEYS dropped (one-time
    reset) while identity settings survive, and is re-stamped so it only happens once."""
    p = tmp_path / "podvoice.json"
    p.write_text(
        json.dumps(
            {
                # stale tuning that historically kept overriding retuned defaults
                "watchdog_ms": 800,
                "lounge_window_s": 0,
                "openai_noise": "near_field",
                # identity settings that MUST survive the reset
                "provider": "openai",
                "exposed": ["light.stue"],
                "rooms": [{"voicepe_host": "1.2.3.4", "room": "r0"}],
            }
        )
    )
    d = S.load_settings(p)
    assert d["watchdog_ms"] == S.DEFAULTS["watchdog_ms"]  # reset
    assert d["lounge_window_s"] == S.DEFAULTS["lounge_window_s"]  # reset
    assert d["openai_noise"] == "far_field"  # reset
    assert d["provider"] == "openai" and d["exposed"] == ["light.stue"]  # kept
    # re-stamped: a value saved AFTER the migration sticks (no repeated resets)
    S.save_settings({"watchdog_ms": 5000}, p)
    assert S.load_settings(p)["watchdog_ms"] == 5000


def test_current_version_tuning_survives(tmp_path):
    """A file already at SETTINGS_VERSION keeps its tuning (the reset is one-time)."""
    p = tmp_path / "podvoice.json"
    p.write_text(json.dumps({"settings_version": S.SETTINGS_VERSION, "duck_level": 15}))
    assert S.load_settings(p)["duck_level"] == 15
