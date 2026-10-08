"""Actual store/predecessor recovery; schema11 and explicit Alpha remain unchanged."""

from __future__ import annotations

import json
import os
import stat

import pytest
from unit.test_settings_integrity import _config, _preferences, _source

from gatekeeper import settings as S
from gatekeeper.config import from_options
from gatekeeper.diag import resolve_target


@pytest.mark.parametrize("live_alpha", [False, True])
def test_atomic_save_keeps_exact_previous_bytes_and_named_205_rollback(
    tmp_path, monkeypatch, live_alpha
):
    path, values = _source(tmp_path, live_alpha)
    # Whitespace/Unicode are part of the rollback file, not a reconstructed dict.
    path.write_bytes((json.dumps(values, ensure_ascii=False, indent=3) + "\r\n").encode())
    previous = path.read_bytes()
    old_config = _config(monkeypatch, tmp_path, path)
    backup = path.with_name(path.name + ".bak")
    saved = S.save_settings({"live_alpha": not live_alpha, "podconnect_token": S.SECRET_MASK}, path)
    assert backup.read_bytes() == previous
    assert S.load_settings(path) == saved
    assert saved["podconnect_token"] == values["podconnect_token"]
    assert saved["live_alpha"] is not live_alpha and saved["settings_version"] == 11
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert stat.S_IMODE(backup.stat().st_mode) == 0o600
    assert not list(tmp_path.glob(".podvoice.json*"))
    # Explicit restoration of the compatible 2.0.5 source, no image/Supervisor claim.
    path.write_bytes(backup.read_bytes())
    assert _config(monkeypatch, tmp_path, path) == old_config
    assert S.load_settings(path)["live_alpha"] is live_alpha


@pytest.mark.parametrize("edge", ["backup", "source"])
def test_replace_refusal_preserves_source_and_cleans_only_owned_temporaries(
    tmp_path, monkeypatch, edge
):
    path, _ = _source(tmp_path, False)
    previous = path.read_bytes()
    backup = path.with_name(path.name + ".bak")
    destination = backup if edge == "backup" else path
    replace = os.replace
    calls = []
    original_error = PermissionError("inert selected replace refusal")

    def selected_replace(source, target):
        calls.append(target)
        if target == destination:
            raise original_error
        return replace(source, target)

    monkeypatch.setattr(os, "replace", selected_replace)
    with pytest.raises(PermissionError) as caught:
        S.save_settings({"live_alpha": True}, path)
    assert caught.value is original_error
    assert calls == ([backup] if edge == "backup" else [backup, path])
    assert path.read_bytes() == previous
    if edge == "source":
        assert backup.read_bytes() == previous  # backup may refresh before failed source commit
    else:
        assert not backup.exists()
    assert not list(tmp_path.glob(".podvoice.json*"))


@pytest.mark.parametrize(
    "rooms",
    [
        [{"room": 123, "voicepe_host": "one.local"}],
        [{"room": "one", "voicepe_host": 123}],
        [{"room": " ", "voicepe_host": "one.local"}],
        [{"room": "one", "voicepe_host": " "}],
    ],
)
def test_room_identities_require_complete_nonempty_strings_before_backup(tmp_path, rooms):
    path, _ = _source(tmp_path, True)
    previous = path.read_bytes()
    with pytest.raises(ValueError):
        S.save_settings({"rooms": rooms}, path)
    assert path.read_bytes() == previous
    assert not path.with_name(path.name + ".bak").exists()


@pytest.mark.parametrize(
    "bad_rooms",
    [
        [{"room": "broken"}],
        [
            {"room": "same", "voicepe_host": "one.local"},
            {"room": "same", "voicepe_host": "two.local"},
        ],
    ],
)
@pytest.mark.parametrize("live_alpha", [False, True])
def test_known_json_room_fault_quarantines_rooms_but_preserves_repairable_preferences(
    tmp_path, monkeypatch, bad_rooms, live_alpha
):
    path, values = _source(tmp_path, live_alpha)
    values["rooms"] = bad_rooms
    path.write_text(json.dumps(values))
    previous = path.read_bytes()
    loaded = S.load_settings(path)
    cfg = _config(monkeypatch, tmp_path, path)
    assert loaded["settings_error"] and not loaded.get("settings_source_untrusted", False)
    assert loaded["rooms"] == bad_rooms and loaded["live_alpha"] is live_alpha
    assert cfg.rooms == () and cfg.settings_error and not cfg.settings_source_untrusted
    assert cfg.system_prompt == values["system_prompt"]
    assert resolve_target(loaded) == (None, "")
    assert path.read_bytes() == previous
    repaired = S.save_settings({"rooms": _preferences(live_alpha)["rooms"]}, path)
    assert "settings_error" not in repaired and "settings_source_untrusted" not in repaired
    assert repaired["live_alpha"] is live_alpha
    assert path.with_name(path.name + ".bak").read_bytes() == previous
    assert len(_config(monkeypatch, tmp_path, path).rooms) == 2


@pytest.mark.parametrize(
    "contents",
    [
        "{",
        "[]",
        '{"settings_version":12}',
        '{"settings_version":11,"rooms":[{"room":"one","room":"two","voicepe_host":"one.local"}]}',
    ],
)
def test_untrusted_source_projects_explicit_fault_and_never_admits_room_owners(
    tmp_path, monkeypatch, contents
):
    path = tmp_path / "podvoice.json"
    path.write_text(contents)
    previous = path.read_bytes()
    loaded = S.load_settings(path)
    cfg = _config(monkeypatch, tmp_path, path)
    assert loaded["settings_error"] and loaded["settings_source_untrusted"] is True
    assert cfg.settings_source_untrusted and cfg.settings_error and cfg.rooms == ()
    assert cfg.openai_api_key == "inert-config-key"  # options survive; no fake trusted source
    assert resolve_target(loaded) == (None, "")
    with pytest.raises(ValueError):
        S.save_settings({"rooms": [], "live_alpha": True}, path)
    assert path.read_bytes() == previous
    assert not path.with_name(path.name + ".bak").exists()


def test_direct_config_validation_does_not_silently_select_partial_or_last_room():
    cfg = from_options(
        {"rooms": [{"room": "missing-host"}, {"room": "valid", "voicepe_host": "one.local"}]}
    )
    assert cfg.rooms == () and cfg.settings_error and not cfg.settings_source_untrusted


@pytest.mark.parametrize("live_alpha", [False, True])
@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity", "1e309", "-1e309"])
def test_nonfinite_source_is_untrusted_and_never_overwrites_source_or_backup(
    tmp_path, monkeypatch, live_alpha, literal
):
    path = tmp_path / "podvoice.json"
    path.write_text(
        '{"settings_version":11,"live_alpha":'
        + json.dumps(live_alpha)
        + ',"vad_threshold":'
        + literal
        + "}"
    )
    backup = path.with_name(path.name + ".bak")
    backup.write_bytes(b'{"settings_version":11,"live_alpha":false}')
    source_before, backup_before = path.read_bytes(), backup.read_bytes()
    loaded = S.load_settings(path)
    cfg = _config(monkeypatch, tmp_path, path)
    assert loaded["settings_source_untrusted"] is True and loaded["settings_error"]
    assert cfg.settings_source_untrusted and cfg.rooms == ()
    with pytest.raises(ValueError):
        S.save_settings({"live_alpha": not live_alpha}, path)
    assert path.read_bytes() == source_before and backup.read_bytes() == backup_before
    assert not list(tmp_path.glob(".podvoice.json*"))


@pytest.mark.parametrize("live_alpha", [False, True])
@pytest.mark.parametrize(
    "case",
    ["nan-string", "inf-string", "negative-inf-string", "nan-number", "inf-integer", "nested-nan"],
)
def test_nonfinite_save_refuses_before_any_backup_or_write(tmp_path, live_alpha, case):
    path, _ = _source(tmp_path, live_alpha)
    backup = path.with_name(path.name + ".bak")
    backup.write_bytes(b'{"settings_version":11,"live_alpha":false}')
    source_before, backup_before = path.read_bytes(), backup.read_bytes()
    invalid = {
        "nan-string": {"vad_threshold": "nan"},
        "inf-string": {"vad_threshold": "Infinity"},
        "negative-inf-string": {"vad_threshold": "-Infinity"},
        "nan-number": {"vad_threshold": float("nan")},
        "inf-integer": {"duck_level": float("inf")},
        "nested-nan": {
            "rooms": [{"room": "kitchen", "voicepe_host": "one.local", "extra": float("nan")}]
        },
    }[case]
    with pytest.raises(ValueError):
        S.save_settings({"live_alpha": not live_alpha, **invalid}, path)
    assert path.read_bytes() == source_before and backup.read_bytes() == backup_before
    assert S.load_settings(path)["live_alpha"] is live_alpha
    assert not list(tmp_path.glob(".podvoice.json*"))


@pytest.mark.parametrize("live_alpha", [False, True])
@pytest.mark.parametrize("value", ["nan", "Infinity", "-Infinity", "1e309"])
def test_quoted_nonfinite_saved_float_cannot_admit_config_or_be_silently_merged(
    tmp_path, monkeypatch, live_alpha, value
):
    path, values = _source(tmp_path, live_alpha)
    values["vad_threshold"] = value
    path.write_text(json.dumps(values))
    previous = path.read_bytes()
    loaded = S.load_settings(path)
    cfg = _config(monkeypatch, tmp_path, path)
    assert loaded["settings_source_untrusted"] is True and loaded["settings_error"]
    assert cfg.settings_source_untrusted and cfg.rooms == ()
    with pytest.raises(ValueError):
        S.save_settings({"vad_threshold": 0.02, "live_alpha": not live_alpha}, path)
    assert path.read_bytes() == previous and not path.with_name(path.name + ".bak").exists()


@pytest.mark.parametrize("live_alpha", [False, True])
@pytest.mark.parametrize("value", ["0.02", "old-invalid-number"])
def test_saved_finite_numeric_string_and_existing_nonnumeric_fallback_are_unchanged(
    tmp_path, monkeypatch, live_alpha, value
):
    path, values = _source(tmp_path, live_alpha)
    values["vad_threshold"] = value
    path.write_text(json.dumps(values))
    previous = path.read_bytes()
    loaded = S.load_settings(path)
    cfg = _config(monkeypatch, tmp_path, path)
    assert "settings_error" not in loaded and not cfg.settings_source_untrusted
    assert loaded["vad_threshold"] == value and loaded["live_alpha"] is live_alpha
    assert cfg.vad_threshold == (0.02 if value == "0.02" else S.DEFAULTS["vad_threshold"])
    assert len(cfg.rooms) == 2 and path.read_bytes() == previous
