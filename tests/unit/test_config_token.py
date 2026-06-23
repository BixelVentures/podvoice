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
