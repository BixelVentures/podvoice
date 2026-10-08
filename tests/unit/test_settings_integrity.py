"""Settings-file integrity against actual schema11 load/save/Config; no runtime I/O."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from gatekeeper import settings as S
from gatekeeper.config import load_config

ROLLBACK_VERSION = "2.0.5"
ROLLBACK_MAIN = "d01d956b20294aa037ac9da9981f5535bb32cb78"
ROLLBACK_ROOTFS = "1c4532c4004ce939526c20c64db75f9f487b72a70e19f1b3401bcb61b52ac8b1"


def _preferences(live_alpha, *, version=11):
    return {
        "settings_version": version,
        "live_alpha": live_alpha,
        "system_prompt": "Min personlige danske svarstil.",
        "wake_word": "hey_chat",
        "podconnect_token": "inert-private-token",
        "ha_mcp_token": "inert-ha-token",
        "voicepe_noise_psk": "inert-native-key",
        "rooms": [
            {"room": "kitchen", "voicepe_host": "fixture-one.local"},
            {"room": "bedroom", "voicepe_host": "fixture-two.local"},
        ],
        "duck_level": 13,
        "mic_gain": 24,
        "idle_timeout_s": 7,
        "watchdog_ms": 6500,
    }


def _source(tmp_path, live_alpha, *, version=11):
    path = tmp_path / "podvoice.json"
    values = _preferences(live_alpha, version=version)
    path.write_text(json.dumps(values, indent=2))
    return path, values


def _config(monkeypatch, tmp_path, path):
    options = tmp_path / "options.json"
    options.write_text(json.dumps({"openai_api_key": "inert-config-key"}))
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    monkeypatch.setenv("PODVOICE_OPTIONS", str(options))
    monkeypatch.setenv("SUPERVISOR_TOKEN", "inert-supervisor-token")
    return load_config(options)


@pytest.mark.parametrize("live_alpha", [False, True])
@pytest.mark.parametrize("contents", [None, "{}"])
def test_missing_or_empty_object_accepts_explicit_alpha_without_new_defaults(
    tmp_path, live_alpha, contents
):
    path = tmp_path / "podvoice.json"
    if contents is not None:
        path.write_text(contents)
    before = path.read_bytes() if path.exists() else None
    loaded = S.load_settings(path)
    assert loaded["live_alpha"] is False and loaded["settings_version"] == 11
    assert (path.read_bytes() if path.exists() else None) == before
    saved = S.save_settings({"live_alpha": live_alpha}, path)
    assert saved["live_alpha"] is live_alpha and saved["settings_version"] == 11
    assert S.load_settings(path) == saved


@pytest.mark.parametrize("live_alpha", [False, True])
@pytest.mark.parametrize("version", [9, 10, 11])
def test_legacy_read_projects_existing_policy_without_rewriting_source(
    tmp_path, live_alpha, version
):
    path, source = _source(tmp_path, live_alpha, version=version)
    before = path.read_bytes()
    loaded = S.load_settings(path)
    assert path.read_bytes() == before
    assert S.SETTINGS_VERSION == loaded["settings_version"] == 11
    assert loaded["live_alpha"] is live_alpha
    for key in (
        "system_prompt",
        "wake_word",
        "podconnect_token",
        "ha_mcp_token",
        "voicepe_noise_psk",
        "rooms",
    ):
        assert loaded[key] == source[key]
    # Preserve the already documented policies, not a new generic version reset.
    if version == 9:
        for key in ("duck_level", "mic_gain", "idle_timeout_s", "watchdog_ms"):
            assert loaded[key] == S.DEFAULTS[key]
    else:
        for key in ("duck_level", "mic_gain", "watchdog_ms"):
            assert loaded[key] == source[key]
        assert loaded["idle_timeout_s"] == (4 if version == 10 else source["idle_timeout_s"])
    assert S.load_settings(path) == loaded and path.read_bytes() == before


@pytest.mark.parametrize("live_alpha", [False, True])
def test_invalid_save_v10_preserves_unmigrated_bytes_and_preferences(tmp_path, live_alpha):
    path, source = _source(tmp_path, live_alpha, version=10)
    before = path.read_bytes()
    with pytest.raises(ValueError):
        S.save_settings({"live_alpha": "true"}, path)
    assert path.read_bytes() == before
    assert json.loads(path.read_text()) == source


@pytest.mark.parametrize("live_alpha", [False, True])
@pytest.mark.parametrize(
    "kind", ["corrupt", "empty-file", "wrong-shape", "future", "duplicate-key"]
)
def test_untrusted_existing_source_refuses_save_without_overwriting(tmp_path, live_alpha, kind):
    path, values = _source(tmp_path, live_alpha)
    if kind == "corrupt":
        path.write_text('{"live_alpha":')
    elif kind == "empty-file":
        path.write_text("")
    elif kind == "wrong-shape":
        path.write_text("[]")
    elif kind == "future":
        path.write_text(json.dumps({**values, "settings_version": 12}))
    else:
        text = json.dumps(values)
        path.write_text(text[:-1] + ',"live_alpha":' + json.dumps(not live_alpha) + "}")
    before = path.read_bytes()
    with pytest.raises(ValueError) as caught:
        S.save_settings({"live_alpha": not live_alpha}, path)
    assert str(caught.value) and "inert-private-token" not in str(caught.value)
    assert path.read_bytes() == before


@pytest.mark.parametrize("live_alpha", [False, True])
def test_client_cannot_write_future_settings_version(tmp_path, live_alpha):
    path, _ = _source(tmp_path, live_alpha)
    before = path.read_bytes()
    with pytest.raises(ValueError):
        S.save_settings({"settings_version": 12}, path)
    assert path.read_bytes() == before


@pytest.mark.parametrize("live_alpha", [False, True])
@pytest.mark.parametrize("kind", ["partial", "duplicate-room", "duplicate-host"])
def test_invalid_room_save_preserves_all_existing_rooms_and_alpha(tmp_path, live_alpha, kind):
    path, source = _source(tmp_path, live_alpha)
    before = path.read_bytes()
    rooms = [dict(row) for row in source["rooms"]]
    if kind == "partial":
        rooms.append({"voicepe_host": "unfinished.local"})
    elif kind == "duplicate-room":
        rooms[1]["room"] = rooms[0]["room"]
    else:
        rooms[1]["voicepe_host"] = rooms[0]["voicepe_host"]
    with pytest.raises(ValueError):
        S.save_settings({"rooms": rooms}, path)
    assert path.read_bytes() == before
    assert S.load_settings(path)["rooms"] == source["rooms"]
    assert S.load_settings(path)["live_alpha"] is live_alpha


@pytest.mark.parametrize("live_alpha", [False, True])
@pytest.mark.parametrize("kind", ["duplicate-room", "duplicate-host"])
def test_persisted_duplicate_rooms_cannot_admit_competing_config_owners(
    tmp_path, monkeypatch, live_alpha, kind
):
    path, values = _source(tmp_path, live_alpha)
    rooms = [dict(row) for row in values["rooms"]]
    field = "room" if kind == "duplicate-room" else "voicepe_host"
    rooms[1][field] = rooms[0][field]
    path.write_text(json.dumps({**values, "rooms": rooms}))
    before = path.read_bytes()
    try:
        cfg = _config(monkeypatch, tmp_path, path)
    except ValueError as exc:
        assert str(exc)  # Explicit configuration refusal, not silently choosing a row.
    else:
        assert all(getattr(room, field) != rooms[0][field] for room in cfg.rooms)
    assert path.read_bytes() == before


@pytest.mark.parametrize("live_alpha", [False, True])
@pytest.mark.parametrize("failure", ["partial-write", "replace"])
def test_failed_commit_preserves_original_bytes_and_effective_config(
    tmp_path, monkeypatch, live_alpha, failure
):
    path, _ = _source(tmp_path, live_alpha)
    before = path.read_bytes()
    cfg = _config(monkeypatch, tmp_path, path)
    calls = []
    with monkeypatch.context() as patch:
        if failure == "partial-write":
            original = Path.write_text

            def interrupted_write(target, text, *args, **kwargs):
                calls.append(str(target))
                original(target, text[: max(1, len(text) // 2)], *args, **kwargs)
                raise OSError("inert interrupted settings write")

            patch.setattr(Path, "write_text", interrupted_write)
        else:

            def refused_replace(source, destination, *args, **kwargs):
                calls.append((str(source), str(destination)))
                raise OSError("inert settings replace refusal")

            patch.setattr(os, "replace", refused_replace)
        with pytest.raises(OSError):
            S.save_settings({"live_alpha": not live_alpha}, path)
    assert calls  # The selected actual write/commit edge must really be attempted.
    assert path.read_bytes() == before
    assert _config(monkeypatch, tmp_path, path) == cfg
    assert S.load_settings(path)["live_alpha"] is live_alpha


@pytest.mark.parametrize("live_alpha", [False, True])
def test_named_205_byte_backup_restores_compatible_config_and_preferences(
    tmp_path, monkeypatch, live_alpha
):
    path, values = _source(tmp_path, live_alpha)
    before, cfg = path.read_bytes(), _config(monkeypatch, tmp_path, path)
    # Fixture custody represents pre-change add-on-data backup, not an invented
    # product backup API or evidence of real Supervisor/artifact rollback.
    backup = tmp_path / f"podvoice-{ROLLBACK_VERSION}-{ROLLBACK_MAIN[:12]}.json"
    backup.write_bytes(before)
    saved = S.save_settings(
        {"live_alpha": not live_alpha, "rooms": [], "podconnect_token": S.SECRET_MASK}, path
    )
    for key, value in values.items():
        if key not in {"live_alpha", "rooms"}:
            assert saved[key] == value
    assert S.load_settings(path)["live_alpha"] is (not live_alpha)
    path.write_bytes(backup.read_bytes())
    assert path.read_bytes() == backup.read_bytes() == before
    assert _config(monkeypatch, tmp_path, path) == cfg
    loaded = S.load_settings(path)
    for key, value in values.items():
        assert loaded[key] == value
    assert loaded["live_alpha"] is live_alpha and loaded["settings_version"] == 11
