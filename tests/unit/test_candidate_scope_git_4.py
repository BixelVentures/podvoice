import pytest
from unit._candidate_scope_git import (
    _automatic_diagnostics_repo,
    _bounded_live_closing_repo,
    _coupled_repo,
    _passive_burst_ui_hil_repo,
    _passive_diagnostic_ui_repo,
)


def test_reviewed_coupling_rejects_malformed_duplicate_or_unapproved_records(tmp_path):
    from scripts.candidate_scope import inspect_repository

    _source, base, _git, record, write = _coupled_repo(tmp_path)
    for key, value in (
        ("version", 2),
        ("reviewer", ""),
        ("rationale", ""),
        ("fingerprint", "wrong"),
        ("domains", ["ha_tools", "physical_output", "rearm"]),
        ("unknown", True),
    ):
        write({**record, key: value})
        assert not inspect_repository(tmp_path, base).passed
    write(record)
    status = tmp_path / "docs/STATUS.md"
    valid = status.read_text()
    for invalid in (
        valid + valid,
        valid.replace('"version": 1', '"version": 1, "version": 1'),
        "<!-- candidate-scope-coupling\n{bad}\n-->",
    ):
        status.write_text(invalid)
        assert not inspect_repository(tmp_path, base).passed


def test_automatic_diagnostics_requires_all_chain_regressions(tmp_path):
    from scripts.candidate_scope import _AUTOMATIC_DIAGNOSTIC_REGRESSIONS, inspect_repository

    _source, base, _git, _record, _write, refresh = _automatic_diagnostics_repo(tmp_path)
    for name in _AUTOMATIC_DIAGNOSTIC_REGRESSIONS:
        path = tmp_path / name
        contents = path.read_text()
        path.unlink()
        refresh()
        assert not inspect_repository(tmp_path, base).passed, name
        path.write_text(contents)
    refresh()
    assert inspect_repository(tmp_path, base).passed


def test_bounded_live_closing_cannot_admit_deleted_owner_or_extra_domain(tmp_path):
    from scripts.candidate_scope import inspect_repository

    source, base, _git, _record, _write, refresh = _bounded_live_closing_repo(tmp_path)
    (tmp_path / "podvoice/gatekeeper/openai_live.py").write_text(source.read_text())
    source.unlink()  # Tracked deletion is still a changed path, but no live owner.
    refresh()
    assert not inspect_repository(tmp_path, base).passed
    source.write_text('events = ["mic_frame", "playback", "response.done", "rearm"]\n')
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("missing", ["unchanged", "deleted"])
def test_passive_diagnostic_ui_requires_changed_and_present_regressions(tmp_path, missing):
    from scripts.candidate_scope import _PASSIVE_DIAGNOSTIC_UI_REGRESSIONS, inspect_repository

    base, git, _record, _write, refresh = _passive_diagnostic_ui_repo(tmp_path)
    for name in _PASSIVE_DIAGNOSTIC_UI_REGRESSIONS:
        path = tmp_path / name
        original = path.read_text()
        if missing == "unchanged":
            path.write_text(git("show", f"{base}:{name}") + "\n")
        else:
            path.unlink()
        refresh()  # A fresh production review cannot substitute an actual regression.
        assert not inspect_repository(tmp_path, base).passed, name
        path.write_text(original)
    refresh()
    assert inspect_repository(tmp_path, base).passed


def test_passive_burst_optional_retention_needs_its_effective_regression(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    name = "podvoice/gatekeeper/diagnostic_retention.py"
    path = tmp_path / name
    path.write_text(path.read_text() + "bounded = True\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed
    test = tmp_path / "tests/unit/test_diagnostic_retention.py"
    test.write_text(test.read_text() + "assert bounded\n")
    refresh()
    assert inspect_repository(tmp_path, base).passed
    git("add", "tests/unit/test_diagnostic_retention.py")
    test.write_text(git("show", f"{base}:tests/unit/test_diagnostic_retention.py") + "\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_isolated_hil_does_not_trigger_passive_burst_presence_guard(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, _refresh = _passive_burst_ui_hil_repo(tmp_path)
    for name in ("podvoice/gatekeeper/audio_trace.py", "podvoice/gatekeeper/static/index.html"):
        (tmp_path / name).write_text(git("show", f"{base}:{name}") + "\n")
        git("add", name)
    (tmp_path / "docs/STATUS.md").unlink()
    report = inspect_repository(tmp_path, base)
    assert report.production_files == ("podvoice/gatekeeper/acoustic_hil.py",)
    assert report.passed
