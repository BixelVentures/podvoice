"""Supervisor token resolution: env first, graceful when absent (PLAN add-on auth)."""

from __future__ import annotations

from gatekeeper.config import _supervisor_token


def test_token_from_env(monkeypatch):
    monkeypatch.setenv("SUPERVISOR_TOKEN", "tok-123")
    assert _supervisor_token() == "tok-123"


def test_token_absent_is_empty_not_crash(monkeypatch):
    monkeypatch.delenv("SUPERVISOR_TOKEN", raising=False)
    # No s6 container_environment file on a dev box -> empty, never raises.
    assert _supervisor_token() == ""


def test_podview_authority_only_comes_from_supervisor_options(monkeypatch, tmp_path):
    import gatekeeper.config as config
    import gatekeeper.settings as settings

    monkeypatch.setattr(
        config,
        "load_options",
        lambda path=None: {
            "podview_pairing_room": "owner-room",
            "podview_pairing_sha256": "a" * 64,
        },
    )
    monkeypatch.setattr(settings, "_resolve", lambda path: tmp_path / "settings.json")
    monkeypatch.setattr(
        settings,
        "load_settings",
        lambda path: {"podview_pairing_room": "attacker-room", "podview_pairing_sha256": "b" * 64},
    )
    loaded = config.load_config()
    assert loaded.podview_pairing_room == "owner-room"
    assert loaded.podview_pairing_sha256 == "a" * 64
    monkeypatch.setattr(config, "load_options", lambda path=None: {})
    loaded = config.load_config()
    assert loaded.podview_pairing_room == loaded.podview_pairing_sha256 == ""
    denied = config.from_options(
        {
            "settings_source_untrusted": True,
            "podview_pairing_room": "owner-room",
            "podview_pairing_sha256": "a" * 64,
        }
    )
    assert denied.podview_pairing_room == denied.podview_pairing_sha256 == ""
