import pytest
from unit._candidate_scope_git import (
    _coupled_repo,
    _passive_burst_ui_hil_repo,
    _passive_diagnostic_ui_repo,
)


def test_audio_analysis_requires_exact_review_and_cannot_include_runtime_paths(tmp_path):
    from scripts.candidate_scope import inspect_repository, production_fingerprint

    source, base, _git, record, write = _coupled_repo(tmp_path, ("audio_input", "physical_output"))
    assert inspect_repository(tmp_path, base).passed
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed
    write(record)
    original = source.read_text()
    source.write_text(original + "changed = True\n")
    assert not inspect_repository(tmp_path, base).passed
    source.write_text(original)
    for name in (
        "podvoice/gatekeeper/thin.py",
        "podvoice/gatekeeper/voicepe.py",
        "esphome/audio.cpp",
    ):
        extra = tmp_path / name
        extra.write_text("changed = True\n")
        report = inspect_repository(tmp_path, base)
        # Even a freshly signed fingerprint cannot grant this surface exception.
        write(
            {
                **record,
                "fingerprint": production_fingerprint(
                    tmp_path, base, base, report.production_files
                ),
            }
        )
        assert not inspect_repository(tmp_path, base).passed
        extra.unlink()
    write(record)
    assert inspect_repository(tmp_path, base).passed

    # Same event-name tuple in web.py alone does not enter the analyzer exception.
    source.write_text("")
    _git("add", "podvoice/gatekeeper/audio_analysis.py")
    (tmp_path / "podvoice/gatekeeper/web.py").write_text(original)
    _git("add", "podvoice/gatekeeper/web.py")
    report = inspect_repository(tmp_path, base)
    assert report.domains == ("audio_input", "physical_output")
    assert "podvoice/gatekeeper/audio_analysis.py" not in report.production_files
    write(
        {
            **record,
            "fingerprint": production_fingerprint(tmp_path, base, base, report.production_files),
        }
    )
    assert not inspect_repository(tmp_path, base).passed


def test_reviewed_coupling_rejects_changed_base_and_missing_regression(tmp_path):
    from scripts.candidate_scope import inspect_repository

    _source, base, git, _record, _write = _coupled_repo(tmp_path)
    git("commit", "--allow-empty", "-qm", "new base")
    assert not inspect_repository(tmp_path, "HEAD").passed
    (tmp_path / "tests/test_device.py").unlink()
    assert not inspect_repository(tmp_path, base).passed


def test_passive_v2_cannot_erase_all_anchors_and_reuse_old_generic_tuple(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, refresh = _passive_diagnostic_ui_repo(tmp_path)
    for name in (
        "podvoice/gatekeeper/diagnostic_retention.py",
        "tests/unit/test_diagnostic_retention.py",
        "tests/browser/daily_ui.cjs",
    ):
        content = git("show", f"{base}:{name}")
        (tmp_path / name).write_text(content + ("\n" if content else ""))
        git("add", name)
    provider = "podvoice/gatekeeper/openai_live.py"
    (tmp_path / provider).write_text("mic_gate MCP playback response.done rearm\n")
    git("add", provider)
    refreshed = refresh()
    assert refreshed["version"] == 2 and refreshed["kind"] == "passive_diagnostic_ui"
    report = inspect_repository(tmp_path, base)
    assert len(report.domains) == 5
    assert not report.passed


def test_passive_burst_ui_hil_required_changes_are_effective_and_regular(tmp_path):
    from scripts.candidate_scope import (
        _PASSIVE_BURST_UI_HIL_REGRESSIONS,
        _PASSIVE_BURST_UI_HIL_REQUIRED,
        inspect_repository,
    )

    base, git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    for name in _PASSIVE_BURST_UI_HIL_REQUIRED | _PASSIVE_BURST_UI_HIL_REGRESSIONS:
        path = tmp_path / name
        original = path.read_bytes()
        git("add", name)
        path.write_text(git("show", f"{base}:{name}") + "\n")
        refresh()
        assert not inspect_repository(tmp_path, base).passed, (name, "staged-only")
        path.unlink()
        refresh()
        assert not inspect_repository(tmp_path, base).passed, (name, "deleted")
        external = tmp_path.parent / f"{tmp_path.name}-outside"
        external.write_bytes(original)
        path.symlink_to(external)
        refresh()
        assert not inspect_repository(tmp_path, base).passed, (name, "symlink")
        external.write_bytes(original + b"changed external\n")
        assert not inspect_repository(tmp_path, base).passed, (name, "mutated-link")
        path.unlink()
        path.write_bytes(original)
    refresh()
    assert inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("flag", ["--assume-unchanged", "--skip-worktree"])
def test_passive_burst_hidden_extra_owner_cannot_join_fresh_review(tmp_path, flag):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    name = "podvoice/gatekeeper/openai_live.py"
    git("update-index", flag, name)
    (tmp_path / name).write_text("unrelated_provider = True\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed
