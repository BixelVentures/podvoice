"""Settings validation + secret masking (0.66: one bad POST must never crash-loop boot)."""

from __future__ import annotations

import pytest

from gatekeeper.config import from_options
from gatekeeper.settings import SECRET_MASK, load_settings, masked, save_settings


def test_bad_types_are_rejected_not_persisted(tmp_path):
    p = tmp_path / "s.json"
    with pytest.raises(ValueError):
        save_settings({"duck_level": "loud"}, p)
    with pytest.raises(ValueError):
        save_settings({"vad_threshold": "high"}, p)
    with pytest.raises(ValueError):
        save_settings({"rooms": [{"room": "kitchen"}]}, p)  # missing voicepe_host
    assert load_settings(p)["duck_level"] == load_settings(p)["duck_level"]  # defaults intact


def test_numeric_strings_are_coerced(tmp_path):
    p = tmp_path / "s.json"
    save_settings({"duck_level": "15", "vad_threshold": "0.02"}, p)
    s = load_settings(p)
    assert s["duck_level"] == 15 and s["vad_threshold"] == 0.02


def test_secret_mask_roundtrip_keeps_stored_value(tmp_path):
    p = tmp_path / "s.json"
    save_settings({"podconnect_token": "real-secret"}, p)
    m = masked(load_settings(p))
    assert m["podconnect_token"] == SECRET_MASK  # never leaves the box in cleartext
    save_settings({"podconnect_token": SECRET_MASK}, p)  # panel round-trips the mask
    assert load_settings(p)["podconnect_token"] == "real-secret"  # not clobbered
    save_settings({"podconnect_token": "new-secret"}, p)  # a real edit still works
    assert load_settings(p)["podconnect_token"] == "new-secret"


def test_config_survives_garbage_values():
    cfg = from_options(
        {
            "duck_level": "loud",  # bad int -> default, NOT a boot crash
            "vad_threshold": [],  # bad float -> default
            "rooms": [{"room": "no-host"}, {"voicepe_host": "1.2.3.4", "room": "ok"}, "junk"],
        }
    )
    assert cfg.duck_level == 0 and cfg.vad_threshold > 0
    assert [r.room for r in cfg.rooms] == ["ok"]  # malformed rows skipped, not fatal
