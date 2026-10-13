import pytest
from unit._candidate_scope_git import (
    _coupled_repo,
    _passive_burst_ui_hil_repo,
)


def test_native_quiet_coupling_rejects_other_surfaces_even_with_fresh_review(tmp_path):
    from scripts.candidate_scope import inspect_repository, production_fingerprint

    _source, base, _git, record, write = _coupled_repo(
        tmp_path, ("audio_input", "physical_output"), native_quiet=True
    )

    def refresh_review():
        report = inspect_repository(tmp_path, base)
        write(
            {
                **record,
                "fingerprint": production_fingerprint(
                    tmp_path, base, base, report.production_files
                ),
            }
        )

    for name in (
        "podvoice/gatekeeper/voicepe.py",
        "podvoice/gatekeeper/audio_analysis.py",
        "podvoice/gatekeeper/openai_live.py",
        "esphome/audio.cpp",
    ):
        extra = tmp_path / name
        extra.write_text("changed = True\n")
        refresh_review()
        assert not inspect_repository(tmp_path, base).passed
        extra.unlink()
    # Thin alone cannot claim the native policy exception.
    helper = tmp_path / "podvoice/gatekeeper/live_idle.py"
    helper.unlink()
    refresh_review()
    assert not inspect_repository(tmp_path, base).passed
    helper.write_text("known = True\n")
    # Adding the optional sink requires both its own and adapter round-trip tests.
    (tmp_path / "podvoice/gatekeeper/audio_trace.py").write_text("trace = True\n")
    refresh_review()
    assert not inspect_repository(tmp_path, base).passed
    (tmp_path / "tests/unit/test_audio_trace.py").write_text("def test_trace(): pass\n")
    assert not inspect_repository(tmp_path, base).passed
    (tmp_path / "tests/integration/test_thin_activity_observer.py").write_text(
        "def test_observer(): pass\n"
    )
    assert inspect_repository(tmp_path, base).passed


def test_exact_reviewed_coupling_binds_effective_staged_and_worktree_bytes(tmp_path):
    from scripts.candidate_scope import inspect_repository

    source, base, git, _record, _write = _coupled_repo(tmp_path)
    source.write_text(source.read_text() + "playback_extra = 2\n")
    assert not inspect_repository(tmp_path, base).passed
    git("add", ".")
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "domains",
    [
        ("physical_output", "realtime_semantics", "rearm"),
        ("audio_input", "ha_tools", "physical_output", "realtime_semantics", "rearm"),
    ],
)
def test_stop_whole_chain_requires_exact_review_and_preserves_fail_closed_guards(tmp_path, domains):
    from scripts.candidate_scope import inspect_repository

    source, base, _git, record, write = _coupled_repo(tmp_path, domains)
    assert inspect_repository(tmp_path, base).domains == domains
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed  # no automatic multidomain exemption
    write(record)
    for key, value in (
        ("fingerprint", "stale"),
        ("base_tip", "old"),
        ("merge_base", "old"),
        ("domains", list(domains[:-1])),
        ("reviewer", ""),
    ):
        write({**record, key: value})
        assert not inspect_repository(tmp_path, base).passed
    write(record)
    original = source.read_text()
    source.write_text(original + "changed = True\n")
    assert not inspect_repository(tmp_path, base).passed
    source.write_text(original)
    assert inspect_repository(tmp_path, base).passed
    (tmp_path / "tests/test_device.py").unlink()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("flag", ["--assume-unchanged", "--skip-worktree"])
def test_passive_burst_hidden_required_regression_cannot_revert_or_mutate(tmp_path, flag):
    from scripts.candidate_scope import inspect_repository

    base, git, record, write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    name = "tests/unit/test_acoustic_hil.py"
    path = tmp_path / name
    git("add", name)
    git("update-index", flag, name)
    path.write_text(path.read_text() + "unreviewed = True\n")
    write(record)
    assert not inspect_repository(tmp_path, base).passed
    refresh()
    assert inspect_repository(tmp_path, base).passed
    path.write_text(git("show", f"{base}:{name}") + "\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("mutation", ["content", "mode", "delete", "untracked", "symlink"])
def test_passive_burst_regression_fingerprint_binds_whole_inventory(tmp_path, mutation):
    from scripts.candidate_scope import inspect_repository, production_fingerprint

    base, git, record, write, _refresh = _passive_burst_ui_hil_repo(tmp_path)
    path = tmp_path / "tests/unit/test_other.py"
    if mutation == "content":
        git("update-index", "--assume-unchanged", "tests/unit/test_other.py")
        path.write_text(path.read_text() + "new_assertion = True\n")
    elif mutation == "mode":
        path.chmod(0o755)
    elif mutation == "delete":
        path.unlink()
        git("add", "tests/unit/test_other.py")
    elif mutation == "untracked":
        (path.parent / "test_new_untracked.py").write_text("assert False\n")
    else:
        target = tmp_path.parent / (tmp_path.name + "-linked-test")
        target.write_text(path.read_text())
        path.unlink()
        path.symlink_to(target)
    report = inspect_repository(tmp_path, base)
    write(
        {
            **record,
            "fingerprint": production_fingerprint(tmp_path, base, base, report.production_files),
        }
    )
    assert not inspect_repository(tmp_path, base).passed


def test_passive_burst_presence_denies_missing_and_wholesale_legacy_records(tmp_path):
    from scripts.candidate_scope import inspect_repository, production_fingerprint

    base, git, record, write, _refresh = _passive_burst_ui_hil_repo(tmp_path)
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed
    for version in (1, 2):
        legacy = {k: v for k, v in record.items() if k not in {"kind", "regression_fingerprint"}}
        if version == 2:
            legacy["kind"] = "passive_diagnostic_ui"
        write({**legacy, "version": version})
        assert not inspect_repository(tmp_path, base).passed
    provider = "podvoice/gatekeeper/openai_live.py"
    (tmp_path / provider).write_text("mic_gate MCP playback response.done rearm\n")
    git("add", provider)
    report = inspect_repository(tmp_path, base)
    assert len(report.domains) == 5
    generic = {k: v for k, v in record.items() if k not in {"kind", "regression_fingerprint"}}
    write(
        {
            **generic,
            "version": 1,
            "domains": list(report.domains),
            "fingerprint": production_fingerprint(tmp_path, base, base, report.production_files),
        }
    )
    assert not inspect_repository(tmp_path, base).passed
