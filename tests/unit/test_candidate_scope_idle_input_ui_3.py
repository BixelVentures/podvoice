"""Effective tree and whole fingerprints: unchanged permanent strict idle-input UI regressions."""

import pytest
from scripts.candidate_scope import (
    _NATIVE_IDLE_INPUT_UI_REGRESSIONS,
    _NATIVE_IDLE_INPUT_UI_REQUIRED,
    inspect_repository,
    production_fingerprint,
)
from unit._candidate_scope_idle_input_ui import (
    _IDLE_METHODS,
    _KIND,
    _METADATA,
    _OTHER_TEST,
    _idle_input_ui_repo,
    _thin_idle_methods,
)


@pytest.mark.parametrize("flag", ["--assume-unchanged", "--skip-worktree"])
def test_native_idle_input_ui_binds_hidden_test_changes_and_denies_reverted_regression(
    tmp_path, flag
):
    base, git, record, write, refresh = _idle_input_ui_repo(tmp_path)
    name = "tests/integration/test_thin_live_ten_cycles.py"
    path = tmp_path / name
    git("add", name)
    git("update-index", flag, name)
    path.write_text(path.read_text() + "unreviewed = True\n")
    write(record)
    assert not inspect_repository(tmp_path, base).passed
    refresh()
    assert inspect_repository(tmp_path, base).passed
    path.write_bytes((git("show", f"{base}:{name}") + "\n").encode())
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("mutation", ["hidden_content", "mode", "delete", "untracked", "symlink"])
def test_native_idle_input_ui_regression_fingerprint_covers_whole_effective_inventory(
    tmp_path, mutation
):
    base, git, record, write, _refresh = _idle_input_ui_repo(tmp_path)
    path = tmp_path / _OTHER_TEST
    if mutation == "hidden_content":
        git("update-index", "--assume-unchanged", _OTHER_TEST)
        path.write_text(path.read_text() + "unreviewed = True\n")
    elif mutation == "mode":
        path.chmod(0o755)
    elif mutation == "delete":
        path.unlink()
        git("add", _OTHER_TEST)
    elif mutation == "untracked":
        (path.parent / "test_untracked.py").write_text("assert False\n")
    else:
        target = tmp_path.parent / (tmp_path.name + "-linked-other-test")
        target.write_bytes(path.read_bytes())
        path.unlink()
        path.symlink_to(target)
    report = inspect_repository(tmp_path, base)
    # Re-pinning production alone cannot conceal a stale entire test tree.
    write(
        {
            **record,
            "fingerprint": production_fingerprint(tmp_path, base, base, report.production_files),
        }
    )
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("flag", ["--assume-unchanged", "--skip-worktree"])
def test_native_idle_input_ui_rejects_hidden_extra_production_and_metadata_drift(tmp_path, flag):
    base, git, _record, _write, refresh = _idle_input_ui_repo(tmp_path)
    extra = "podvoice/gatekeeper/voicepe.py"
    git("update-index", flag, extra)
    (tmp_path / extra).write_text("unrelated_owner = True\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed
    (tmp_path / extra).write_text(git("show", f"{base}:{extra}") + "\n")
    metadata = tmp_path / _METADATA
    metadata.write_text('__version__ = "2.0.5"\n')
    git("add", _METADATA)
    git("update-index", flag, _METADATA)
    metadata.write_text(metadata.read_text() + "runtime = True\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed
    metadata.write_text('__version__ = "2.0.5"\n')
    refresh()
    # Preserve the actual failed layout: unstaged HTML precedes cached metadata
    # and Thin; the generic matcher sees one domain, but deleting review cannot
    # downgrade the effective changed owner pair to ordinary PASS.
    observed = inspect_repository(tmp_path, base)
    assert observed.domains == ("audio_input",) and not observed.passed
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed
    effective = {name: (tmp_path / name).read_bytes() for name in _NATIVE_IDLE_INPUT_UI_REQUIRED}
    git("add", "podvoice/gatekeeper/static/index.html")
    refresh()
    positive = inspect_repository(tmp_path, base)
    assert positive.domains == ("audio_input", "rearm") and positive.passed
    assert effective == {name: (tmp_path / name).read_bytes() for name in effective}
    assert metadata.read_bytes() == b'__version__ = "2.0.5"\n'


@pytest.mark.parametrize(
    "payload",
    [
        '__version__ = "2.0.4"\n',
        '__version__ = "2.0.5"\nruntime = True\n',
        '__version__ = "2.0.5"\r\n',
        '__version__ = "2.0.5"',
        '__version__ = "2.0.5"\n\n',
        '__version__ = "2.0.5"\rruntime = True\n',
    ],
)
def test_native_idle_input_ui_rejects_effective_metadata_opposition_and_byte_drift(
    tmp_path, payload
):
    base, git, _record, _write, refresh = _idle_input_ui_repo(tmp_path)
    metadata = tmp_path / _METADATA
    metadata.write_text('__version__ = "2.0.5"\n')
    git("add", _METADATA)
    metadata.write_bytes(payload.encode())
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_native_idle_input_ui_ref_advance_invalidates_even_same_effective_tree(tmp_path):
    base, git, _record, _write, _refresh = _idle_input_ui_repo(tmp_path)
    git("reset", "--mixed", "HEAD")  # Ref moves; all effective candidate bytes stay unchanged.
    git("commit", "--allow-empty", "-qm", "advanced HEAD")
    current = git("rev-parse", "HEAD")
    assert current != base
    assert not inspect_repository(tmp_path, current).passed


def test_native_idle_input_ui_v4_never_downgrades_strict_v3_burst_chain(tmp_path):
    from unit._candidate_scope_git import _passive_burst_ui_hil_repo

    base, _git, record, write, _refresh = _passive_burst_ui_hil_repo(tmp_path)
    write({**record, "version": 4, "kind": _KIND})
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("flag", ["--assume-unchanged", "--skip-worktree"])
@pytest.mark.parametrize("record_version", [None, 1, 2, 3])
def test_native_idle_owner_review_cannot_be_bypassed_by_hidden_pair_missing_tests_or_extra_owner(
    tmp_path, flag, record_version
):
    base, git, record, write, refresh = _idle_input_ui_repo(
        tmp_path,
        baseline_thin=_thin_idle_methods({}),
        candidate_thin=_thin_idle_methods(dict.fromkeys(_IDLE_METHODS, 1)),
        stage_html=True,
    )
    # Stage base bytes then hide the real effective changes; also remove every
    # required regression and add an unrelated owner. None may disable presence.
    for name in _NATIVE_IDLE_INPUT_UI_REQUIRED:
        candidate = (tmp_path / name).read_bytes()
        (tmp_path / name).write_text(git("show", f"{base}:{name}") + "\n")
        git("add", name)
        git("update-index", flag, name)
        (tmp_path / name).write_bytes(candidate)
    for name in _NATIVE_IDLE_INPUT_UI_REGRESSIONS:
        (tmp_path / name).unlink()
    (tmp_path / _OTHER_TEST).write_text("changed = True\n")
    events = "PLAYBACK" if record_version is None else "PLAYBACK REARM"
    (tmp_path / "podvoice/gatekeeper/voicepe.py").write_text(f"events = {events!r}\n")
    record = refresh()
    report = inspect_repository(tmp_path, base)
    assert report.domains == (
        ("physical_output",) if record_version is None else ("physical_output", "rearm")
    )
    if record_version is None:
        (tmp_path / "docs/STATUS.md").unlink()
    elif record_version == 1:
        write(
            {
                k: 1 if k == "version" else v
                for k, v in record.items()
                if k not in {"kind", "regression_fingerprint"}
            }
        )
    else:
        write(
            {
                **record,
                "version": record_version,
                "kind": "passive_diagnostic_ui" if record_version == 2 else "passive_burst_ui_hil",
            }
        )
    assert not inspect_repository(tmp_path, base).passed
