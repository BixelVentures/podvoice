import pytest
from unit._candidate_scope_git import (
    _automatic_diagnostics_repo,
    _coupled_repo,
    _passive_burst_ui_hil_repo,
)


def test_reviewed_coupling_rejects_deletion_mode_and_symlink_changes(tmp_path):
    from scripts.candidate_scope import inspect_repository

    source, base, _git, _record, _write = _coupled_repo(tmp_path)
    source.chmod(0o755)
    assert not inspect_repository(tmp_path, base).passed
    source.unlink()
    assert not inspect_repository(tmp_path, base).passed
    source.symlink_to("missing-target")
    assert not inspect_repository(tmp_path, base).passed


def test_automatic_diagnostics_coupling_requires_exact_tree_review(tmp_path):
    from scripts.candidate_scope import inspect_repository

    source, base, _git, record, write, _refresh = _automatic_diagnostics_repo(tmp_path)
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed
    for key, value in (
        ("fingerprint", "changed"),
        ("base_tip", "stale"),
        ("merge_base", "stale"),
        ("reviewer", ""),
        ("rationale", ""),
        ("domains", ["ha_tools", "physical_output"]),
    ):
        write({**record, key: value})
        assert not inspect_repository(tmp_path, base).passed
    write(record)
    source.write_text(source.read_text() + "unreviewed = True\n")
    assert not inspect_repository(tmp_path, base).passed


def test_native_app_close_requires_exact_reviewed_chain_and_regressions(tmp_path):
    import json
    import subprocess

    from scripts.candidate_scope import (
        _NATIVE_APP_CLOSING_REGRESSIONS,
        inspect_repository,
        production_fingerprint,
    )

    def git(*args):
        return subprocess.check_output(["git", *args], cwd=tmp_path, text=True).strip()

    git("init", "-q")
    git("config", "user.name", "Scope Test")
    git("config", "user.email", "scope@example.invalid")
    for name in ("thin.py", "live_prompt.py", "voicepe.py"):
        path = tmp_path / "podvoice/gatekeeper" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("")
    git("add", ".")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    for name, text in (
        ("thin.py", "end_conversation rearm\n"),
        ("live_prompt.py", "end_conversation\n"),
        ("voicepe.py", "native_cancel = True\n"),
    ):
        (tmp_path / "podvoice/gatekeeper" / name).write_text(text)
    for name in _NATIVE_APP_CLOSING_REGRESSIONS:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("def test_close(): pass\n")
    git("add", ".")
    report = inspect_repository(tmp_path, base)
    assert report.domains == ("realtime_semantics", "rearm")
    assert not report.passed
    status = tmp_path / "docs/STATUS.md"
    status.parent.mkdir()

    def write_record():
        current = inspect_repository(tmp_path, base)
        record = {
            "version": 1,
            "base_tip": base,
            "merge_base": base,
            "domains": list(current.domains),
            "fingerprint": production_fingerprint(tmp_path, base, base, current.production_files),
            "reviewer": "independent-reviewer",
            "rationale": "One model END/native close cleanup chain; no audio judge.",
        }
        status.write_text("<!-- candidate-scope-coupling\n" + json.dumps(record) + "\n-->\n")

    write_record()
    assert inspect_repository(tmp_path, base).passed
    thin = tmp_path / "podvoice/gatekeeper/thin.py"
    original = thin.read_text()
    thin.write_text(original + "changed = True\n")
    assert not inspect_repository(tmp_path, base).passed  # Stale whole-tree review.
    thin.write_text(original)
    for name in _NATIVE_APP_CLOSING_REGRESSIONS:
        path = tmp_path / name
        path.unlink()
        write_record()
        assert not inspect_repository(tmp_path, base).passed
        path.write_text("def test_close(): pass\n")
    for name, text in (
        ("podvoice/gatekeeper/other.py", "end_conversation\n"),
        ("esphome/new.cpp", "rearm\n"),
        ("podvoice/gatekeeper/thin.py", "end_conversation rearm MCP\n"),
        ("podvoice/gatekeeper/thin.py", "end_conversation rearm mic_gate\n"),
    ):
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        prior = path.read_text() if path.exists() else None
        path.write_text(text)
        write_record()  # Even a newly pinned review cannot widen this admission.
        assert not inspect_repository(tmp_path, base).passed
        if prior is None:
            path.unlink()
        else:
            path.write_text(prior)
    write_record()
    assert inspect_repository(tmp_path, base).passed


def test_passive_burst_ui_hil_strict_record_and_stale_identity(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, _git, record, write, _refresh = _passive_burst_ui_hil_repo(tmp_path)
    for key, value in (
        ("version", True),
        ("version", 4),
        ("version", "3"),
        ("kind", "passive_diagnostic_ui"),
        ("kind", None),
        ("base_tip", "stale"),
        ("merge_base", "stale"),
        ("domains", ["physical_output"]),
        ("domains", "ha_tools"),
        ("fingerprint", "stale"),
        ("regression_fingerprint", "stale"),
        ("reviewer", " "),
        ("rationale", ""),
        ("reviewer", 3),
        ("extra", "unapproved"),
    ):
        write({**record, key: value})
        assert not inspect_repository(tmp_path, base).passed, key
    for key in record:
        write({k: v for k, v in record.items() if k != key})
        assert not inspect_repository(tmp_path, base).passed, key
    for version in (1, 2):
        write({**record, "version": version})
        assert not inspect_repository(tmp_path, base).passed
        legacy = {k: v for k, v in record.items() if k not in {"kind", "regression_fingerprint"}}
        if version == 2:
            legacy["kind"] = "passive_diagnostic_ui"
        write({**legacy, "version": version})
        assert not inspect_repository(tmp_path, base).passed
    write(record)
    assert inspect_repository(tmp_path, base).passed


def test_passive_burst_optional_version_is_only_metadata_and_regular(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, _git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    path = tmp_path / "podvoice/gatekeeper/__init__.py"
    path.write_text('__version__ = "2.0.2"\n')
    refresh()
    assert inspect_repository(tmp_path, base).passed
    path.write_text(path.read_text() + "runtime = True\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed
    target = tmp_path.parent / (tmp_path.name + "-version")
    target.write_text('__version__ = "2.0.2"\n')
    path.unlink()
    path.symlink_to(target)
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "payload",
    [
        '__version__ = "2.0.1"\n',
        '__version__ = "2.0.1"\nruntime = True\n',
        '__version__ = "2.0.2"\r\n',
        '__version__ = "2.0.2"',
        '__version__ = "2.0.2"\n\n',
        '__version__ = "2.0.2"\rruntime = True\n',
    ],
)
def test_passive_burst_metadata_effective_opposition_and_newlines_fail_closed(tmp_path, payload):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    name = "podvoice/gatekeeper/__init__.py"
    path = tmp_path / name
    path.write_text('__version__ = "2.0.2"\n')
    git("add", name)
    path.write_bytes(payload.encode())
    refresh()
    assert not inspect_repository(tmp_path, base).passed
