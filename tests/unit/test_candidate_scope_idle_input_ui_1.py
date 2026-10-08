"""Exact schema and review record: unchanged permanent strict idle-input UI regressions."""

import json

import pytest
from scripts.candidate_scope import (
    _NATIVE_IDLE_INPUT_UI_REGRESSIONS,
    _NATIVE_IDLE_INPUT_UI_REQUIRED,
    inspect_repository,
)
from unit._candidate_scope_idle_input_ui import (
    _idle_input_ui_repo,
)


def test_native_idle_input_ui_requires_record_and_accepts_only_exact_review(tmp_path):
    base, _git, record, write, _refresh = _idle_input_ui_repo(tmp_path)
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed
    write(record)
    report = inspect_repository(tmp_path, base)
    assert report.passed
    assert report.reason == "exact reviewed coupling: native_idle_input_passive_ui"
    assert set(report.production_files) == _NATIVE_IDLE_INPUT_UI_REQUIRED
    assert _NATIVE_IDLE_INPUT_UI_REGRESSIONS <= set(report.test_files)
    assert _NATIVE_IDLE_INPUT_UI_REGRESSIONS == {
        "tests/integration/test_thin_live_idle.py",
        "tests/integration/test_thin_live_idle_preclose.py",
        "tests/integration/test_thin_live_idle_protection.py",
        "tests/integration/test_thin_live_resumed_input_preclose.py",
        "tests/integration/test_thin_live_ten_cycles.py",
        "tests/integration/test_thin_panel_status.py",
        "tests/browser/daily_ui.cjs",
        "tests/integration/test_talk_webrtc_browser.py",
    }


@pytest.mark.parametrize(
    "key,value",
    [
        ("version", True),
        ("version", "4"),
        ("version", 4.0),
        ("version", 5),
        ("version", 3),
        ("version", 2),
        ("version", 1),
        ("kind", "unknown"),
        ("kind", "passive_burst_ui_hil"),
        ("kind", None),
        ("base_tip", "stale"),
        ("merge_base", "stale"),
        ("domains", ["rearm", "audio_input"]),
        ("domains", ["audio_input"]),
        ("domains", "audio_input,rearm"),
        ("fingerprint", "stale"),
        ("regression_fingerprint", "stale"),
        ("reviewer", " "),
        ("reviewer", None),
        ("rationale", ""),
        ("extra", "unapproved"),
    ],
)
def test_native_idle_input_ui_rejects_unknown_schema_version_and_stale_fields(tmp_path, key, value):
    base, _git, record, write, _refresh = _idle_input_ui_repo(tmp_path)
    write({**record, key: value})
    assert not inspect_repository(tmp_path, base).passed


def test_native_idle_input_ui_rejects_missing_duplicate_fields_and_duplicate_records(tmp_path):
    base, _git, record, write, _refresh = _idle_input_ui_repo(tmp_path)
    for key in record:
        write({k: v for k, v in record.items() if k != key})
        assert not inspect_repository(tmp_path, base).passed, key
    status = tmp_path / "docs/STATUS.md"
    duplicated = json.dumps(record)[:-1] + ', "reviewer": "second-reviewer"}'
    status.write_text("<!-- candidate-scope-coupling\n" + duplicated + "\n-->\n")
    assert not inspect_repository(tmp_path, base).passed
    write(record)
    status.write_text(status.read_text() * 2)
    assert not inspect_repository(tmp_path, base).passed
    write(record)
    assert inspect_repository(tmp_path, base).passed
