"""Calibration survives restart without enabling an unmeasured closing boundary."""

import pytest

from gatekeeper import __main__ as entry
from gatekeeper.settings import load_settings, save_settings
from gatekeeper.voicepe import LIVE_FIRMWARE_BUILD


def reference(marker=LIVE_FIRMWARE_BUILD):
    return f"marker:{marker}|sha256:{'a' * 64}|trace:near-f-112"


def test_recorded_guard_roundtrips_and_is_not_enabled_by_alpha_alone(tmp_path, monkeypatch):
    path = tmp_path / "settings.json"
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    save_settings({"live_alpha": True}, path)
    assert entry._saved_live_closing_guard() == (None, None)
    save_settings({"live_closing_guard_ms": 120, "live_closing_guard_ref": reference()}, path)
    assert entry._saved_live_closing_guard() == (0.120, reference())
    assert load_settings(path)["live_alpha"] is True
    save_settings({"live_closing_guard_ms": 0}, path)
    assert entry._saved_live_closing_guard() == (None, None)


@pytest.mark.parametrize(
    "milliseconds,ref",
    [
        (True, reference()),
        (2000, reference()),
        (-1, reference()),
        (100, ""),
        (100, reference("old-firmware")),
        (100, reference().replace("a" * 64, "a" * 63)),
        (100, reference().replace("near-f-112", "../unbound")),
    ],
)
def test_invalid_or_other_artifact_guard_never_admits(monkeypatch, milliseconds, ref):
    monkeypatch.setattr(
        entry,
        "load_settings",
        lambda _path=None: {
            "live_alpha": True,
            "live_closing_guard_ms": milliseconds,
            "live_closing_guard_ref": ref,
        },
    )
    assert entry._saved_live_closing_guard() == (None, None)


@pytest.mark.parametrize("value", [True, 2.5, "120", -1, 2000])
def test_save_rejects_noninteger_or_out_of_budget_guard(tmp_path, value):
    with pytest.raises(ValueError):
        save_settings({"live_closing_guard_ms": value}, tmp_path / "settings.json")
