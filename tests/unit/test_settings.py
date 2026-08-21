"""Panel settings store + config merge."""

from __future__ import annotations

import json

from gatekeeper import settings as S
from gatekeeper.config import load_config


def test_defaults_and_roundtrip(tmp_path):
    p = tmp_path / "podvoice.json"
    d = S.load_settings(p)
    assert d["engine"] == "thin" and d["rooms"] == [] and d["duck_level"] == 0
    assert d["mic_channel"] == 1 and d["mic_gain"] == 16
    assert d["openai_noise"] == "off"

    saved = S.save_settings({"engine": "thin", "duck_level": 7, "bogus": "x"}, p)
    assert saved["engine"] == "thin" and saved["duck_level"] == 7
    assert "bogus" not in saved  # only known keys are kept

    assert S.load_settings(p)["engine"] == "thin"


def test_corrupt_file_falls_back(tmp_path):
    p = tmp_path / "podvoice.json"
    p.write_text("{ not json")
    assert S.load_settings(p)["engine"] == "thin"


def test_legacy_lifecycle_settings_cannot_be_resurrected(tmp_path):
    p = tmp_path / "podvoice.json"
    p.write_text(
        json.dumps(
            {
                "settings_version": S.SETTINGS_VERSION,
                "engine": "classic",
                "speaker_path": "direct",
                "full_duplex": True,
            }
        )
    )
    loaded = S.load_settings(p)
    assert loaded["engine"] == "thin"
    assert loaded["speaker_path"] == "announce"
    assert loaded["full_duplex"] is False
    saved = S.save_settings({"engine": "classic", "speaker_path": "auto", "full_duplex": True}, p)
    assert saved["engine"] == "thin"
    assert saved["speaker_path"] == "announce"
    assert saved["full_duplex"] is False


def test_load_config_merges_settings_with_keys(tmp_path, monkeypatch):
    sp = tmp_path / "podvoice.json"
    S.save_settings({"engine": "thin", "podconnect_base_url": "http://x:8099"}, sp)
    monkeypatch.setattr(S, "SETTINGS_PATH", sp)

    opts = tmp_path / "options.json"
    opts.write_text(json.dumps({"openai_api_key": "o"}))

    cfg = load_config(opts)
    assert cfg.engine == "thin"  # from settings
    assert cfg.openai_api_key == "o"  # from options (keys only)
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
                "openai_model": "gpt-realtime-2",  # pre-2.1 model must not survive
                # identity settings that MUST survive the reset
                "engine": "thin",
                "rooms": [{"voicepe_host": "1.2.3.4", "room": "r0"}],
            }
        )
    )
    d = S.load_settings(p)
    assert d["watchdog_ms"] == S.DEFAULTS["watchdog_ms"]  # reset
    assert d["lounge_window_s"] == S.DEFAULTS["lounge_window_s"]  # reset
    assert d["openai_noise"] == "off"  # Voice PE channel 1 already has XMOS NS
    assert d["mic_gain"] == 16  # reset to the physically measured desk baseline
    assert d["openai_model"] == "gpt-realtime-2.1"  # quality-first default
    assert d["engine"] == "thin"  # kept
    assert d["rooms"] == [{"voicepe_host": "1.2.3.4", "room": "r0"}]  # kept
    # re-stamped: a value saved AFTER the migration sticks (no repeated resets)
    S.save_settings({"watchdog_ms": 5000}, p)
    assert S.load_settings(p)["watchdog_ms"] == 5000


def test_dropped_gemini_keys_are_ignored(tmp_path):
    """A pre-overhaul file full of gemini_*/provider keys loads clean — the unknown
    keys are simply not merged (no crash, no resurrection)."""
    p = tmp_path / "podvoice.json"
    p.write_text(
        json.dumps(
            {
                "settings_version": S.SETTINGS_VERSION,
                "provider": "gemini",
                "gemini_model": "gemini-2.5-flash-native-audio-preview-12-2025",
                "gemini_vad_start": "low",
                "duck_level": 15,
            }
        )
    )
    d = S.load_settings(p)
    assert "provider" not in d and "gemini_model" not in d
    assert d["duck_level"] == 15


def test_current_version_tuning_survives(tmp_path):
    """A file already at SETTINGS_VERSION keeps its tuning (the reset is one-time)."""
    p = tmp_path / "podvoice.json"
    p.write_text(json.dumps({"settings_version": S.SETTINGS_VERSION, "duck_level": 15}))
    assert S.load_settings(p)["duck_level"] == 15


def test_v4_drops_a_stale_full_duplex_flag(tmp_path):
    from gatekeeper.settings import DEFAULTS, load_settings

    """0.68-era experiment flags must never survive into the gated world: a saved
    full_duplex=True silently disabled the echo shield on 0.92+ (field 2026-08-06)."""
    import json

    p = tmp_path / "s.json"
    p.write_text(
        json.dumps({"settings_version": 3, "full_duplex": True, "openai_turn": "semantic_vad"})
    )
    s = load_settings(p)
    assert s["full_duplex"] is False  # reset by the upgrade
    assert s["openai_turn"] == DEFAULTS["openai_turn"]


def test_current_and_raw_config_cannot_enable_voicepe_full_duplex(tmp_path):
    """Half-duplex is a production invariant, not a persisted preference.

    Talk enables browser duplex in its adapter wiring. A current-version settings file
    or a raw options dict must never lower the physical puck's echo shield.
    """
    from gatekeeper.config import from_options

    p = tmp_path / "s.json"
    p.write_text(json.dumps({"settings_version": S.SETTINGS_VERSION, "full_duplex": True}))
    assert S.load_settings(p)["full_duplex"] is False
    assert from_options({"full_duplex": True, "mic_channel": 0}).full_duplex is False


def test_saved_prompt_naming_dead_tools_is_dropped(tmp_path):
    """0.88 class: a saved prompt that teaches list_home/list_services/home_call tells
    the model to call tools deleted in the MCP switch. Drop it, whoever edited it."""
    import json

    from gatekeeper.settings import DEFAULTS, load_settings

    p = tmp_path / "s.json"
    p.write_text(
        json.dumps(
            {
                "settings_version": 4,
                "system_prompt": "Du er PodVoice. Brug list_services til at finde tjenesten.",
            }
        )
    )
    s = load_settings(p)
    assert s["system_prompt"] == DEFAULTS["system_prompt"]  # stale prompt discarded


def test_a_genuinely_custom_prompt_survives(tmp_path):
    """Only DEAD-tool prompts are dropped — the owner's own wording must stay."""
    import json

    from gatekeeper.settings import load_settings

    p = tmp_path / "s.json"
    mine = "Du er PodVoice. Sig altid 'hej med dig' først."
    p.write_text(json.dumps({"settings_version": 4, "system_prompt": mine}))
    assert load_settings(p)["system_prompt"] == mine


def test_speaker_path_defaults_to_the_proven_announce_path():
    """1.11.1: the direct path wedges the device on real hardware.

    VA reaches RESPONSE_FINISHED but never fires on_tts_stream_end, because it waits for
    the speaker to report finished and that speaker is SHARED with external_media_player,
    which keeps it running. voice_assistant_phase then sticks at 5 ("replying"), the ring
    spins forever and the next question gets no answer. Until the firmware side is fixed,
    nothing may select the direct path by default — including a settings file written
    under 1.11.0, which is why speaker_path stays in TUNING_KEYS."""
    from gatekeeper.config import from_options
    from gatekeeper.settings import DEFAULTS, TUNING_KEYS

    assert DEFAULTS["speaker_path"] == "announce"
    assert from_options({}).speaker_path == "announce"
    assert from_options(dict(DEFAULTS)).speaker_path == "announce"
    assert "speaker_path" in TUNING_KEYS  # a saved "auto" is dropped on upgrade
    # A stale/explicit override cannot resurrect the stock-VA-dependent experiment.
    assert from_options({"speaker_path": "auto"}).speaker_path == "announce"
    assert from_options({"speaker_path": "direct"}).speaker_path == "announce"
