"""Alpha opt-in persistence and entrypoint wiring without a provider connection."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from gatekeeper import settings


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


def test_physical_builder_retains_realtime_and_reads_saved_flag_at_wake(monkeypatch, tmp_path):
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
    session = main._build_session(
        cfg,
        RoomMap("puck.local", "r0"),
        Mock(),
        None,
        Mock(),
        reply_token="token",
        live_audio=manager,
    )
    assert session.brain is realtime
    assert session.live_brain is live_factory.return_value
    assert session.full_duplex is False
    assert session.live_audio is manager
    assert session.live_reply_url == "http://192.0.2.1:8098/reply/live/{stream_id}.wav?t=token"
    assert session.reply_url == "http://192.0.2.1:8098/reply/r0.flac?t=token"
    assert session.live_enabled() is False
    settings.save_settings({"live_alpha": True}, path)
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
    assert "live_enabled=_live_alpha_enabled" in talk


def test_talk_submitted_is_not_rejected_or_presented_as_acknowledged():
    html = Path("podvoice/gatekeeper/static/index.html").read_text()
    branch = html.split('else if (ev.status === "submitted")', 1)[1].split("} else {", 1)[0]
    assert "Sendt til Live; ingen separat modtagelseskvittering" in branch
    assert 'input.value = ""' in branch
    assert "input.value = pending.text" not in branch
    assert 'id="s_live_alpha" type="checkbox"' in html
    assert 'var FIELDS = ["live_alpha",' in html
    assert "fra næste samtale" in html
