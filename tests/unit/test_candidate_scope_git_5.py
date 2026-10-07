import pytest
from unit._candidate_scope_git import (
    _coupled_repo,
    _passive_burst_ui_hil_repo,
    _passive_diagnostic_ui_repo,
)


def test_native_quiet_coupling_requires_exact_review_and_complete_regressions(tmp_path):
    from scripts.candidate_scope import inspect_repository

    source, base, _git, record, write = _coupled_repo(
        tmp_path, ("audio_input", "physical_output"), native_quiet=True
    )
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed
    for key, value in (
        ("fingerprint", "stale"),
        ("base_tip", "old"),
        ("merge_base", "old"),
        ("domains", ["physical_output"]),
        ("reviewer", ""),
        ("rationale", ""),
    ):
        write({**record, key: value})
        assert not inspect_repository(tmp_path, base).passed
    write(record)
    original = source.read_text()
    source.write_text(original + "changed = True\n")
    assert not inspect_repository(tmp_path, base).passed
    source.write_text(original)
    for name in (
        "tests/unit/test_live_idle.py",
        "tests/integration/test_thin_live_idle.py",
        "tests/integration/test_thin_live_quiet_close.py",
    ):
        regression = tmp_path / name
        contents = regression.read_text()
        regression.unlink()
        assert not inspect_repository(tmp_path, base).passed
        regression.write_text(contents)
    assert inspect_repository(tmp_path, base).passed


def test_passive_v2_record_discriminator_is_strict_and_cannot_use_v1_admission(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, _git, record, write, _refresh = _passive_diagnostic_ui_repo(tmp_path)
    for change in (
        {"version": 3},
        {"version": True},
        {"kind": "unknown"},
        {"kind": None},
        {"extra": "unapproved"},
    ):
        write({**record, **change})
        assert not inspect_repository(tmp_path, base).passed
    write({k: v for k, v in record.items() if k != "kind"})
    assert not inspect_repository(tmp_path, base).passed
    write({k: (1 if k == "version" else v) for k, v in record.items() if k != "kind"})
    assert not inspect_repository(tmp_path, base).passed


def test_passive_v2_rejects_symlink_sources_and_regressions_before_and_after_target_mutation(
    tmp_path,
):
    from scripts.candidate_scope import (
        _PASSIVE_DIAGNOSTIC_UI_REGRESSIONS,
        _PASSIVE_DIAGNOSTIC_UI_SURFACES,
        inspect_repository,
    )

    base, _git, _record, _write, refresh = _passive_diagnostic_ui_repo(tmp_path)
    metadata = tmp_path / "podvoice/gatekeeper/__init__.py"
    metadata.write_text('__version__ = "2.0.1"\n')
    for name in _PASSIVE_DIAGNOSTIC_UI_SURFACES | _PASSIVE_DIAGNOSTIC_UI_REGRESSIONS:
        path = tmp_path / name
        original = path.read_text()
        target = tmp_path.parent / (tmp_path.name + "-external-source")
        target.write_text(original)
        path.unlink()
        path.symlink_to(target)
        refresh()
        assert not inspect_repository(tmp_path, base).passed, name
        target.write_text(original + "unreviewed_external = True\n")
        assert not inspect_repository(tmp_path, base).passed, name
        path.unlink()
        path.write_text(original)
    refresh()
    assert inspect_repository(tmp_path, base).passed


def test_passive_burst_nonrequired_test_link_binds_effective_target(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, _git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    path = tmp_path / "tests/unit/test_other.py"
    target = tmp_path.parent / (tmp_path.name + "-linked-test")
    target.write_text(path.read_text())
    path.unlink()
    path.symlink_to(target)
    refresh()
    assert inspect_repository(tmp_path, base).passed
    target.write_text("unreviewed = True\n")
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "partner",
    [
        "podvoice/gatekeeper/audio_trace.py",
        "podvoice/gatekeeper/static/index.html",
    ],
)
@pytest.mark.parametrize("flag", ["--assume-unchanged", "--skip-worktree"])
def test_passive_burst_presence_uses_effective_hidden_changes(tmp_path, partner, flag):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, _refresh = _passive_burst_ui_hil_repo(tmp_path)
    # Restore all owners, then hide only the two actual coupled changes.
    for name in (
        "podvoice/gatekeeper/audio_trace.py",
        "podvoice/gatekeeper/acoustic_hil.py",
        "podvoice/gatekeeper/static/index.html",
    ):
        (tmp_path / name).write_text(git("show", f"{base}:{name}") + "\n")
        git("add", name)
    for name in ("podvoice/gatekeeper/acoustic_hil.py", partner):
        git("update-index", flag, name)
        (tmp_path / name).write_text((tmp_path / name).read_text() + "hidden = True\n")
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed


def test_passive_burst_metadata_mode_must_match_baseline(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, _git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    path = tmp_path / "podvoice/gatekeeper/__init__.py"
    path.write_text('__version__ = "2.0.2"\n')
    path.chmod(0o755)
    refresh()
    assert not inspect_repository(tmp_path, base).passed
    path.chmod(0o644)
    refresh()
    assert inspect_repository(tmp_path, base).passed
