import pytest
from unit._candidate_scope_git import (
    _automatic_diagnostics_repo,
    _bounded_live_closing_repo,
    _coupled_repo,
    _passive_burst_ui_hil_repo,
)


def test_reviewed_coupling_rejects_untracked_files_and_content_changes(tmp_path):
    from scripts.candidate_scope import inspect_repository

    _source, base, _git, _record, _write = _coupled_repo(tmp_path)
    added = tmp_path / "podvoice/gatekeeper/new\nfile.py"
    added.write_text("playback = 2\n")
    assert not inspect_repository(tmp_path, base).passed
    added.write_text("playback = 3\n")
    assert not inspect_repository(tmp_path, base).passed


def test_reviewed_coupling_hashes_unchanged_baseline_even_with_hidden_index_flags(tmp_path):
    from scripts.candidate_scope import inspect_repository

    _source, base, git, _record, _write = _coupled_repo(tmp_path)
    hidden = tmp_path / "esphome/other.h"
    for flag in ("assume-unchanged", "skip-worktree"):
        git("update-index", "--" + flag, "esphome/other.h")
        hidden.write_text("changed effective firmware bytes\n")
        assert not inspect_repository(tmp_path, base).passed
        hidden.write_text("baseline\n")
        git("update-index", "--no-" + flag, "esphome/other.h")
        assert inspect_repository(tmp_path, base).passed


def test_arbitrary_four_domain_candidate_cannot_reuse_diagnostics_coupling(tmp_path):
    from scripts.candidate_scope import _AUTOMATIC_DIAGNOSTIC_REQUIRED, inspect_repository

    _source, base, _git, _record, _write, refresh = _automatic_diagnostics_repo(tmp_path)
    # Even all required test filenames and a new exact review cannot turn a
    # four-domain engine change alone into the approved end-to-end observer chain.
    for name in _AUTOMATIC_DIAGNOSTIC_REQUIRED - {"podvoice/gatekeeper/thin.py"}:
        (tmp_path / name).unlink()
    refresh()
    report = inspect_repository(tmp_path, base)
    assert report.domains == ("ha_tools", "physical_output", "realtime_semantics", "rearm")
    assert not report.passed


def test_bounded_live_closing_requires_exact_tree_review_and_base(tmp_path):
    from scripts.candidate_scope import inspect_repository

    source, base, _git, record, write, _refresh = _bounded_live_closing_repo(tmp_path)
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed
    for key, value in (
        ("version", 2),
        ("fingerprint", "stale"),
        ("base_tip", "old"),
        ("merge_base", "old"),
        ("domains", ["audio_input", "physical_output"]),
        ("reviewer", ""),
        ("rationale", ""),
    ):
        write({**record, key: value})
        assert not inspect_repository(tmp_path, base).passed, key
    write(record)
    assert inspect_repository(tmp_path, base).passed
    source.write_text(source.read_text() + "changed_after_review = True\n")
    assert not inspect_repository(tmp_path, base).passed


def test_bounded_live_closing_requires_each_causal_regression(tmp_path):
    from scripts.candidate_scope import _BOUNDED_LIVE_CLOSING_REGRESSIONS, inspect_repository

    _source, base, _git, _record, _write, refresh = _bounded_live_closing_repo(tmp_path)
    for name in _BOUNDED_LIVE_CLOSING_REGRESSIONS:
        path = tmp_path / name
        contents = path.read_text()
        path.unlink()
        refresh()  # A fresh production fingerprint cannot excuse a missing test.
        assert not inspect_repository(tmp_path, base).passed, name
        path.write_text(contents)
    refresh()
    assert inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "extra",
    [
        "podvoice/gatekeeper/openai_live.py",
        "podvoice/gatekeeper/tools.py",
        "podvoice/gatekeeper/live_prompt.py",
        "podvoice/gatekeeper/voicepe.py",
        "esphome/components/podvoice_audio/podvoice_audio.cpp",
    ],
)
def test_passive_burst_extra_owner_never_falls_through_with_fresh_record(tmp_path, extra):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    path = tmp_path / extra
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("mic_gate MCP playback response.done rearm\n")
    git("add", extra)
    refresh()
    assert len(inspect_repository(tmp_path, base).domains) == 5
    assert not inspect_repository(tmp_path, base).passed
    for omitted in (
        "podvoice/gatekeeper/audio_trace.py",
        "podvoice/gatekeeper/acoustic_hil.py",
        "tests/unit/test_audio_trace_burst.py",
        "tests/browser/daily_ui.cjs",
    ):
        (tmp_path / omitted).write_text(git("show", f"{base}:{omitted}") + "\n")
        git("add", omitted)
    refresh()
    assert not inspect_repository(tmp_path, base).passed
