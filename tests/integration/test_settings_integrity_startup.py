"""Actual main/Web recovery admission and failed atomic Save, with inert I/O."""

from __future__ import annotations

import asyncio
import json
import os

import pytest
from integration.test_main_settings_save_contract import (
    _active_contract,
    _actual_main_app,
    _device_contract,
    _preferences,
)

from gatekeeper import settings as S
from gatekeeper.web import CONSOLE, LIVE_EVAL, TALK


@pytest.mark.parametrize("initial_live", [False, True])
async def test_untrusted_source_starts_actual_panel_without_default_conversation_owner(
    tmp_path, monkeypatch, initial_live
):
    path, options = tmp_path / "settings.json", tmp_path / "options.json"
    options.write_text(json.dumps({"openai_api_key": "inert-settings-contract"}))
    path.write_text(json.dumps({"settings_version": 12, "live_alpha": initial_live}))
    previous = path.read_bytes()
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    async with _actual_main_app(monkeypatch, tmp_path / "untrusted-boot", options) as actual:
        assert actual.cfg.settings_source_untrusted and actual.cfg.settings_error
        assert not actual.sessions and not actual.built_sessions
        assert actual.app[CONSOLE] is None and actual.app[TALK] is None
        assert actual.app[LIVE_EVAL] is None
        result = await actual.client.get("/api/settings")
        body = await result.json()
        assert result.status == 409 and body["ok"] is False
        assert body["settings_source_untrusted"] is True and "engine" not in body
        assert body["error"]
        status = await (await actual.client.get("/api/status")).json()
        assert any(url.endswith("/api/attention") for _, url in actual.requests)
        for service in ("voicepe", "openai"):
            assert status["services"][service] == "down"
            assert status["service_details"][service]["source"] == "settings"
            assert actual.cfg.settings_error in status["service_details"][service]["reason"]
        count = len(actual.configure_calls)
        result = await actual.client.post(
            "/api/settings", json={"rooms": [], "live_alpha": not initial_live}
        )
        assert result.status == 400 and (await result.json())["ok"] is False
        assert len(actual.configure_calls) == count and path.read_bytes() == previous
        assert not any("api.openai.com" in url for _, url in actual.requests)
    assert path.read_bytes() == previous


@pytest.mark.parametrize("initial_live", [False, True])
async def test_known_room_fault_remains_repairable_and_preserves_talk_settings(
    tmp_path, monkeypatch, initial_live
):
    path, options = tmp_path / "settings.json", tmp_path / "options.json"
    options.write_text(json.dumps({"openai_api_key": "inert-settings-contract"}))
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    original = _preferences(path, initial_live)
    damaged = {**original, "rooms": [{"room": "kitchen"}]}
    path.write_text(json.dumps(damaged))
    previous = path.read_bytes()
    async with _actual_main_app(monkeypatch, tmp_path / "room-fault-boot", options) as actual:
        assert actual.cfg.settings_error and not actual.cfg.settings_source_untrusted
        assert not actual.sessions
        assert callable(actual.app[CONSOLE]) and callable(actual.app[TALK])
        result = await actual.client.get("/api/settings")
        body = await result.json()
        assert result.status == 200 and body["rooms"] == damaged["rooms"]
        assert body["live_alpha"] is initial_live and body["settings_error"]
        assert path.read_bytes() == previous
        result = await actual.client.post("/api/settings", json={"rooms": original["rooms"]})
        saved = (await result.json())["settings"]
        assert result.status == 200 and saved["live_alpha"] is initial_live
        assert "settings_error" not in saved
        assert path.with_name(path.name + ".bak").read_bytes() == previous
        assert not actual.sessions  # Save is not a room lifecycle owner; fresh boot required
    async with _actual_main_app(monkeypatch, tmp_path / "repaired-boot", options) as actual:
        assert not actual.cfg.settings_error and not actual.cfg.settings_source_untrusted
        assert set(actual.sessions) == {"kitchen", "bedroom"}
        assert (await (await actual.client.get("/api/settings")).json())[
            "live_alpha"
        ] is initial_live


@pytest.mark.parametrize("initial_live", [False, True])
async def test_failed_atomic_save_never_reconfigures_actual_active_owner(
    tmp_path, monkeypatch, initial_live
):
    path, options = tmp_path / "settings.json", tmp_path / "options.json"
    options.write_text(json.dumps({"openai_api_key": "inert-settings-contract"}))
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    _preferences(path, initial_live)
    previous = path.read_bytes()
    async with _actual_main_app(monkeypatch, tmp_path / "active-boot", options) as actual:
        session = actual.sessions["kitchen"]
        async with asyncio.timeout(20):
            await session.wake()
        owner, device = _active_contract(session), _device_contract(actual.tools)
        count = len(actual.configure_calls)
        replace = os.replace
        calls = []

        def fail_source(source, destination):
            if destination == path:
                calls.append((source, destination))
                raise PermissionError("inert source commit refusal")
            return replace(source, destination)

        with monkeypatch.context() as selected:
            selected.setattr(os, "replace", fail_source)
            result = await actual.client.post(
                "/api/settings", json={"live_alpha": not initial_live}
            )
            body = await result.json()
        assert result.status == 503 and body["ok"] is False and body["error"]
        assert len(calls) == 1 and path.read_bytes() == previous
        assert len(actual.configure_calls) == count
        assert _active_contract(session) == owner and _device_contract(actual.tools) == device
        assert session._active and session.live_alpha is initial_live
        assert S.load_settings(path)["live_alpha"] is initial_live


@pytest.mark.parametrize("initial_live", [False, True])
async def test_nonfinite_save_never_reconfigures_actual_active_owner(
    tmp_path, monkeypatch, initial_live
):
    path, options = tmp_path / "settings.json", tmp_path / "options.json"
    options.write_text(json.dumps({"openai_api_key": "inert-settings-contract"}))
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    _preferences(path, initial_live)
    previous = path.read_bytes()
    backup = path.with_name(path.name + ".bak")
    backup.write_bytes(b'{"settings_version":11,"live_alpha":false}')
    old_backup = backup.read_bytes()
    async with _actual_main_app(monkeypatch, tmp_path / "nonfinite-boot", options) as actual:
        session = actual.sessions["kitchen"]
        async with asyncio.timeout(20):
            await session.wake()
        owner, device = _active_contract(session), _device_contract(actual.tools)
        count = len(actual.configure_calls)
        for invalid in (
            {"vad_threshold": "nan"},
            {"vad_threshold": "Infinity"},
            {"vad_threshold": "-Infinity"},
            {"vad_threshold": float("nan")},
            {"duck_level": float("inf")},
            {"rooms": [{"room": "kitchen", "voicepe_host": "one.local", "extra": float("nan")}]},
        ):
            # Exercise shipped request parsing too: default JSON encoder emits bare constants.
            result = await actual.client.post(
                "/api/settings", json={"live_alpha": not initial_live, **invalid}
            )
            body = await result.json()
            assert result.status == 400 and body["ok"] is False and body["error"]
            assert path.read_bytes() == previous and backup.read_bytes() == old_backup
            assert len(actual.configure_calls) == count
            assert _active_contract(session) == owner and _device_contract(actual.tools) == device
            assert session._active and session.live_alpha is initial_live


@pytest.mark.parametrize("untrusted", [False, True])
async def test_actual_missing_key_probe_preserves_source_fault_only_when_untrusted(
    tmp_path, monkeypatch, untrusted
):
    path, options = tmp_path / "settings.json", tmp_path / "options.json"
    options.write_text("{}")
    path.write_text("{" if untrusted else '{"settings_version":11}')
    previous = path.read_bytes()
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    async with _actual_main_app(monkeypatch, tmp_path / "missing-key-boot", options) as actual:
        assert actual.cfg.openai_api_key == ""
        status = await (await actual.client.get("/api/status")).json()
        assert any(url.endswith("/api/attention") for _, url in actual.requests)
        detail = status["service_details"]["openai"]
        assert status["services"]["openai"] == "down"
        if untrusted:
            assert detail["source"] == "settings"
            assert actual.cfg.settings_error in detail["reason"]
            result = await actual.client.get("/api/settings")
            assert result.status == 409 and "engine" not in await result.json()
            assert actual.app[CONSOLE] is None and actual.app[TALK] is None
        else:
            assert detail["source"] == "konfiguration"
            assert detail["reason"] == "OpenAI API-nøgle mangler"
            assert not actual.cfg.settings_error
        assert path.read_bytes() == previous
