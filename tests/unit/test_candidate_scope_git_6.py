import pytest
from unit._candidate_scope_git import (
    _bounded_live_closing_repo,
    _passive_burst_ui_hil_repo,
    _passive_diagnostic_ui_repo,
)


@pytest.mark.parametrize(
    "name",
    [
        "podvoice/gatekeeper/live_prompt.py",
        "podvoice/gatekeeper/tools.py",
        "podvoice/gatekeeper/eval_audio_idle/new.pcm",
        "podvoice/gatekeeper/eval_audio_idle/new.py",
        "esphome/components/mixer/speaker/mixer_speaker.cpp",
        "esphome/voice-pe-podvoice-base.yaml",
    ],
)
def test_bounded_live_closing_rejects_unknown_surface_even_after_new_review(tmp_path, name):
    from scripts.candidate_scope import inspect_repository

    _source, base, _git, _record, _write, refresh = _bounded_live_closing_repo(tmp_path)
    path = tmp_path / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("unrelated = True\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_passive_diagnostic_ui_requires_exact_tree_review(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, _git, record, write, _refresh = _passive_diagnostic_ui_repo(tmp_path)
    status = tmp_path / "docs/STATUS.md"
    status.unlink()
    assert not inspect_repository(tmp_path, base).passed
    for key, value in (
        ("fingerprint", "stale"),
        ("base_tip", "stale"),
        ("merge_base", "stale"),
        ("reviewer", " "),
        ("rationale", ""),
        ("domains", ["physical_output", "rearm"]),
    ):
        write({**record, key: value})
        assert not inspect_repository(tmp_path, base).passed, key
    write(record)
    source = tmp_path / "podvoice/gatekeeper/audio_trace.py"
    source.write_text(source.read_text() + "unreviewed = True\n")
    assert not inspect_repository(tmp_path, base).passed


def test_passive_diagnostic_ui_requires_all_owner_surfaces_and_exact_domains(tmp_path):
    from scripts.candidate_scope import _PASSIVE_DIAGNOSTIC_UI_REQUIRED, inspect_repository

    base, git, _record, _write, refresh = _passive_diagnostic_ui_repo(tmp_path)
    for name in _PASSIVE_DIAGNOSTIC_UI_REQUIRED:
        path = tmp_path / name
        original = path.read_text()
        path.unlink()
        refresh()
        assert not inspect_repository(tmp_path, base).passed, name
        path.write_text(git("show", f"{base}:{name}"))
        refresh()
        assert not inspect_repository(tmp_path, base).passed, name
        path.write_text(original)
    source = tmp_path / "podvoice/gatekeeper/thin.py"
    source.write_text('events = "mic_gate response.done MCP playback rearm"\n')
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_passive_diagnostic_ui_optional_init_must_be_version_metadata_only(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, _git, _record, _write, refresh = _passive_diagnostic_ui_repo(tmp_path)
    metadata = tmp_path / "podvoice/gatekeeper/__init__.py"
    metadata.write_text('__version__ = "2.0.1"\n')
    refresh()
    assert inspect_repository(tmp_path, base).passed
    metadata.write_text(metadata.read_text() + "runtime = True\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_passive_diagnostic_ui_rejects_regression_reverted_only_in_worktree(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, refresh = _passive_diagnostic_ui_repo(tmp_path)
    name = "tests/browser/daily_ui.cjs"
    git("add", name)
    (tmp_path / name).write_text(git("show", f"{base}:{name}") + "\n")
    refresh()
    report = inspect_repository(tmp_path, base)
    assert name in report.test_files  # Staged and unstaged paths alone are insufficient.
    assert not report.passed


@pytest.mark.parametrize("flag", ["--assume-unchanged", "--skip-worktree"])
def test_passive_burst_hidden_metadata_runtime_cannot_use_staged_version_proof(tmp_path, flag):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    name = "podvoice/gatekeeper/__init__.py"
    path = tmp_path / name
    path.write_text('__version__ = "2.0.2"\n')
    git("add", name)
    git("update-index", flag, name)
    path.write_text(path.read_text() + "runtime = True\n")
    refresh()  # Both fingerprints see these bytes; version proof must reject them.
    assert not inspect_repository(tmp_path, base).passed
    path.write_text('__version__ = "2.0.2"\n')
    refresh()
    assert inspect_repository(tmp_path, base).passed
