"""Single-provider migration and entrypoint wiring without a provider connection."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from gatekeeper import settings


@pytest.mark.asyncio
@pytest.mark.parametrize("enabled", [False, True])
async def test_boot_prepares_pure_sdk_only_for_saved_alpha(monkeypatch, enabled):
    from gatekeeper import __main__ as main
    from gatekeeper import openai_live

    preparation = AsyncMock()
    monkeypatch.setattr(openai_live, "prepare_live_sdk", preparation)
    await main._prepare_saved_live_alpha(enabled)
    assert preparation.await_count == int(enabled)


@pytest.mark.asyncio
async def test_boot_import_failure_keeps_settings_available(monkeypatch):
    from gatekeeper import __main__ as main
    from gatekeeper import openai_live

    preparation = AsyncMock(side_effect=ImportError("synthetic missing dependency"))
    monkeypatch.setattr(openai_live, "prepare_live_sdk", preparation)
    await main._prepare_saved_live_alpha(True)
    preparation.assert_awaited_once()


def test_live_defaults_and_stale_off_never_revive_legacy(tmp_path):
    path = tmp_path / "settings.json"
    assert settings.load_settings(path)["live_alpha"] is True
    saved = settings.save_settings({"live_alpha": True, "full_duplex": True}, path)
    assert saved["live_alpha"] is True
    assert settings.load_settings(path)["live_alpha"] is True
    assert saved["full_duplex"] is False
    assert saved["engine"] == "thin"
    assert saved["speaker_path"] == "announce"
    settings.save_settings({"live_alpha": False}, path)
    assert settings.load_settings(path)["live_alpha"] is True


@pytest.mark.parametrize("value", ["true", "false", 1, None, [], {}])
def test_alpha_requires_explicit_boolean(tmp_path, value):
    path = tmp_path / "settings.json"
    with pytest.raises(ValueError, match="live_alpha: expected true/false"):
        settings.save_settings({"live_alpha": value}, path)
    path.write_text(json.dumps({"live_alpha": value}))
    assert settings.load_settings(path)["live_alpha"] is True


def test_physical_builder_constructs_only_live_and_exact_run_callback(monkeypatch, tmp_path):
    from gatekeeper import __main__ as main
    from gatekeeper import thin
    from gatekeeper.config import Config, RoomMap

    path = tmp_path / "settings.json"
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    live_factory = Mock(return_value=SimpleNamespace())
    monkeypatch.setitem(
        sys.modules, "gatekeeper.openai_live", SimpleNamespace(OpenAILiveSession=live_factory)
    )
    monkeypatch.setattr(main, "_host_ip_for", lambda host: "192.0.2.1")
    monkeypatch.setattr(thin, "ThinSession", lambda **kwargs: SimpleNamespace(**kwargs))
    cfg = Config("http://attention", "", "", (), openai_api_key="test", system_prompt="Tilpasset")
    manager = object()
    selected = Mock(return_value=True)
    session = main._build_session(
        cfg,
        RoomMap("puck.local", "r0"),
        Mock(),
        None,
        Mock(),
        reply_token="token",
        live_audio=manager,
        live_enabled=selected,
    )
    assert session.brain is session.live_brain
    assert session.live_brain is live_factory.return_value
    assert session.full_duplex is False
    assert session.live_audio is manager
    assert session.live_reply_url == "http://192.0.2.1:8098/reply/live/{stream_id}.wav?t=token"
    assert session.reply_url == "http://192.0.2.1:8098/reply/r0.flac?t=token"
    assert session.live_enabled is selected
    assert session.live_enabled() is True
    settings.save_settings({"live_alpha": True}, path)
    assert session.live_enabled() is True  # builder does not own persistence refresh
    selected.return_value = True
    assert session.live_enabled() is True
    assert session.brain is session.live_brain  # saving only changes next-wake selection
    assert (
        "# BRUGERTILPASSET VEJLEDNING\nTilpasset"
        in live_factory.call_args.kwargs["backend_instructions"]
    )
    assert "Delegation policy:" in live_factory.call_args.kwargs["instructions"]
    assert live_factory.call_args.kwargs["input_rate"] == 16000


def test_talk_alpha_uses_browser_rate_and_ingress_relative_route():
    source = Path("podvoice/gatekeeper/__main__.py").read_text()
    talk = source[source.index("    def _make_talk") : source.index("    live_eval = None")]
    assert "input_rate=OPENAI_RATE" in talk
    assert 'live_reply_url="reply/live/{stream_id}.wav"' in talk
    assert "live_enabled=read_live_alpha" in talk


def test_talk_submitted_is_not_rejected_or_presented_as_acknowledged():
    html = Path("podvoice/gatekeeper/static/index.html").read_text()
    branch = html.split('else if (ev.status === "submitted")', 1)[1].split("} else {", 1)[0]
    assert 'logLine("in", "you", pending.text)' in branch
    assert "ingen separat modtagelseskvittering" not in branch
    assert 'input.value = ""' in branch
    assert "input.value = pending.text" not in branch
    assert 'id="s_live_alpha" type="checkbox"' not in html
    assert 'var FIELDS = ["live_alpha",' not in html
    assert "Voice PE og Talk bruger GPT-Live" in html


@pytest.mark.parametrize("enabled", [False, True])
def test_config_selection_and_address_share_one_boot_read(tmp_path, monkeypatch, enabled):
    from gatekeeper.config import load_config

    options = tmp_path / "options.json"
    options.write_text('{"openai_api_key":"inert-selection-test"}')
    path = tmp_path / "settings.json"
    settings.save_settings({"live_alpha": enabled}, path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("PODVOICE_SETTINGS", "settings.json")
    original = settings._read_source
    calls = []

    def read(source):
        calls.append(source)
        return original(source)

    monkeypatch.setattr(settings, "_read_source", read)
    cfg = load_config(options)
    assert calls == [path]
    assert cfg.settings_path == path and cfg.settings_path.is_absolute()
    monkeypatch.setenv("PODVOICE_SETTINGS", str(tmp_path / "other.json"))
    assert cfg.settings_path == path


def test_postboot_presence_uses_same_source_read_and_preserves_initial_missing_policy(
    tmp_path, monkeypatch
):
    path = tmp_path / "missing.json"
    original = settings._read_source
    calls = []

    def read(source):
        calls.append(source)
        return original(source)

    def forbidden_exists(_self):
        raise AssertionError("second existence admission is forbidden")

    monkeypatch.setattr(settings, "_read_source", read)
    monkeypatch.setattr(Path, "exists", forbidden_exists)
    initial = settings.load_settings(path)
    strict = settings.load_settings(path, require_existing=True)
    assert calls == [path, path]
    assert initial["live_alpha"] is True and not initial.get("settings_source_untrusted")
    assert strict["settings_source_untrusted"] and strict["settings_error"]
    assert not path.parent.joinpath(path.name + ".bak").is_file()


@pytest.mark.parametrize("legacy_mode", [False, True])
def test_single_provider_migration_is_read_only_preserves_values_and_exact_rollback(
    tmp_path, legacy_mode
):

    path = tmp_path / "settings.json"
    legacy = {
        "settings_version": settings.SETTINGS_VERSION,
        "live_alpha": legacy_mode,
        "engine": "classic",
        "rooms": [{"voicepe_host": "saved.local", "room": "Kitchen"}],
        "system_prompt": "Min tilpassede vejledning",
        "mic_gain": 23,
        "idle_timeout_s": 7,
        "openai_voice": "cedar",
        "openai_model": "gpt-realtime-2.1-mini",
        "force_mini": True,
        "openai_threshold": 0.7,
        "ha_mcp_token": "inert-rollback-secret",
    }
    previous = json.dumps(legacy, indent=1).encode()
    path.write_bytes(previous)
    loaded = settings.load_settings(path)
    assert path.read_bytes() == previous  # loading cannot overwrite rollback bytes
    assert loaded["live_alpha"] is True and loaded["engine"] == "thin"
    for key in legacy.keys() - {"live_alpha", "engine"}:
        assert loaded[key] == legacy[key]  # no tuning, voice, room, secret or prompt migration
    saved = settings.save_settings({"live_alpha": False, "duck_level": 9}, path)
    assert saved["live_alpha"] is True and saved["duck_level"] == 9
    for key in legacy.keys() - {"live_alpha", "engine"}:
        assert saved[key] == legacy[key]
    assert path.with_name(path.name + ".bak").read_bytes() == previous
    assert settings.masked(saved)["ha_mcp_token"] == settings.SECRET_MASK


@pytest.mark.asyncio
async def test_same_native_and_talk_brains_read_saved_ceiling_at_each_next_connect(tmp_path):
    from test_openai_live import SDK

    from gatekeeper.__main__ import _make_live_brain
    from gatekeeper.config import from_options

    path = tmp_path / "settings.json"
    key = "synthetic-factory-ceiling-key"
    cfg = from_options({"openai_api_key": key}, settings_path=path)
    native = _make_live_brain(cfg, [], input_rate=16000)
    talk = _make_live_brain(cfg, [], input_rate=24000)
    native.client_factory = SDK().factory
    talk.client_factory = SDK().factory
    ledger = native.provider_budget
    assert talk.provider_budget is ledger
    await native.connect()
    assert ledger.snapshot(key, native.backend_model)["limit"] == 40_000
    ledger.account_usage(key, native.backend_model, 12_365, lease=native._lease)
    settings.save_settings({"openai_backend_tpm": 1_000_000}, path, provider_api_key=key)
    assert ledger.snapshot(key, native.backend_model)["limit"] == 40_000
    assert ledger.lease_is_active(native._lease)
    await native.close()
    await native.connect()  # same retained native brain, next wake
    assert ledger.snapshot(key, native.backend_model)["limit"] == 1_000_000
    assert ledger.snapshot(key, native.backend_model)["authoritative"] is False
    assert ledger.snapshot(key, native.backend_model)["remaining"] < 1_000_000
    await native.close()
    await talk.connect()  # already-created Talk brain uses the same admission binding
    assert ledger.snapshot(key, talk.backend_model)["limit"] == 1_000_000
    await talk.close()
    changed = from_options({"openai_api_key": "other-factory-key"}, settings_path=path)
    other = _make_live_brain(changed, [], input_rate=24000)
    other.client_factory = SDK().factory
    await other.connect()
    assert other.provider_budget is ledger
    assert ledger.snapshot(changed.openai_api_key, other.backend_model)["limit"] == 40_000
    await other.close()
    native.api_key = "swapped-existing-brain-key"
    await native.connect()
    assert ledger.snapshot(native.api_key, native.backend_model)["limit"] == 40_000
    await native.close()
