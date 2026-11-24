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
            "podview_control_policy": "owner-policy",
            "podview_visual_policy": "owner-visual-policy",
            "podview_research_visual_policy": "completed_receipts_v1",
        },
    )
    monkeypatch.setattr(settings, "_resolve", lambda path: tmp_path / "settings.json")
    monkeypatch.setattr(
        settings,
        "load_settings",
        lambda path: {
            "podview_control_policy": "attacker-policy",
            "podview_visual_policy": "attacker-visual-policy",
            "podview_research_visual_policy": "attacker-research-policy",
        },
    )
    loaded = config.load_config()
    assert loaded.podview_control_policy == "owner-policy"
    assert loaded.podview_visual_policy == "owner-visual-policy"
    assert loaded.podview_research_visual_policy == "completed_receipts_v1"
    monkeypatch.setattr(config, "load_options", lambda path=None: {})
    loaded = config.load_config()
    assert loaded.podview_control_policy == ""
    assert loaded.podview_visual_policy == ""
    assert loaded.podview_research_visual_policy == ""
    denied = config.from_options(
        {
            "settings_source_untrusted": True,
            "podview_control_policy": "owner-policy",
            "podview_visual_policy": "owner-visual-policy",
            "podview_research_visual_policy": "completed_receipts_v1",
        }
    )
    assert denied.podview_control_policy == ""
    assert denied.podview_visual_policy == ""
    assert denied.podview_research_visual_policy == ""
