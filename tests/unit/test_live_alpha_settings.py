"""Alpha opt-in persistence and entrypoint wiring without a provider connection."""

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


def test_alpha_defaults_off_and_never_revives_legacy(tmp_path):
    path = tmp_path / "settings.json"
    assert settings.load_settings(path)["live_alpha"] is False
    saved = settings.save_settings({"live_alpha": True, "full_duplex": True}, path)
    assert saved["live_alpha"] is True
    assert settings.load_settings(path)["live_alpha"] is True
    assert saved["full_duplex"] is False
    assert saved["engine"] == "thin"
    assert saved["speaker_path"] == "announce"
    settings.save_settings({"live_alpha": False}, path)
    assert settings.load_settings(path)["live_alpha"] is False


@pytest.mark.parametrize("value", ["true", "false", 1, None, [], {}])
def test_alpha_requires_explicit_boolean(tmp_path, value):
    path = tmp_path / "settings.json"
    with pytest.raises(ValueError, match="live_alpha: expected true/false"):
        settings.save_settings({"live_alpha": value}, path)
    path.write_text(json.dumps({"live_alpha": value}))
    assert settings.load_settings(path)["live_alpha"] is False


def test_physical_builder_retains_realtime_and_exact_run_selection_callback(monkeypatch, tmp_path):
    from gatekeeper import __main__ as main
    from gatekeeper import thin
    from gatekeeper.config import Config, RoomMap

    path = tmp_path / "settings.json"
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    live_factory = Mock(return_value=SimpleNamespace())
    monkeypatch.setitem(
        sys.modules, "gatekeeper.openai_live", SimpleNamespace(OpenAILiveSession=live_factory)
    )
    realtime = SimpleNamespace()
    monkeypatch.setattr(main, "make_session", Mock(return_value=realtime))
    monkeypatch.setattr(main, "_host_ip_for", lambda host: "192.0.2.1")
    monkeypatch.setattr(thin, "ThinSession", lambda **kwargs: SimpleNamespace(**kwargs))
    cfg = Config("http://attention", "", "", (), openai_api_key="test", system_prompt="Tilpasset")
    manager = object()
    selected = Mock(return_value=False)
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
    assert session.brain is realtime
    assert session.live_brain is live_factory.return_value
    assert session.full_duplex is False
    assert session.live_audio is manager
    assert session.live_reply_url == "http://192.0.2.1:8098/reply/live/{stream_id}.wav?t=token"
    assert session.reply_url == "http://192.0.2.1:8098/reply/r0.flac?t=token"
    assert session.live_enabled is selected
    assert session.live_enabled() is False
    settings.save_settings({"live_alpha": True}, path)
    assert session.live_enabled() is False  # builder does not own persistence refresh
    selected.return_value = True
    assert session.live_enabled() is True
    assert session.brain is realtime  # saving only changes next-wake selection
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
    assert "Sendt til Live; ingen separat modtagelseskvittering" in branch
    assert 'input.value = ""' in branch
    assert "input.value = pending.text" not in branch
    assert 'id="s_live_alpha" type="checkbox"' in html
    assert 'var FIELDS = ["live_alpha",' in html
    assert "fra næste samtale" in html


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
    assert cfg.live_alpha is enabled
    monkeypatch.setenv("PODVOICE_SETTINGS", str(tmp_path / "other.json"))
    assert cfg.settings_path == path and cfg.live_alpha is enabled


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
    assert initial["live_alpha"] is False and not initial.get("settings_source_untrusted")
    assert strict["settings_source_untrusted"] and strict["settings_error"]
    assert not path.parent.joinpath(path.name + ".bak").is_file()
