"""Real-Git exact composition, stale bytes and owner-boundary regressions for v5."""

import json
import subprocess

import pytest
from scripts.candidate_scope import (
    _LIVE_STARTUP_IDLE_ALARM_REGRESSIONS,
    _LIVE_STARTUP_IDLE_ALARM_REQUIRED,
    _LIVE_STARTUP_IDLE_ALARM_SCOPE_REGRESSIONS,
    inspect_repository,
    production_fingerprint,
    regression_fingerprint,
)

_METADATA = "podvoice/gatekeeper/__init__.py"
_THIN = "podvoice/gatekeeper/thin.py"
_OTHER_OWNER = "podvoice/gatekeeper/openai_live.py"
_OTHER_TEST = "tests/unit/test_other.py"
_IDLE_OWNER = "class ThinSession:\n    def _sync_live_idle_input(self):\n        return 1\n"


def _repo(root):
    def git(*args):
        result = subprocess.run(
            ["git", *args], cwd=root, text=True, capture_output=True, timeout=20, check=True
        )
        return result.stdout.rstrip("\n")

    def put(name, text):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    git("init", "-q")
    git("config", "user.name", "Scope Test")
    git("config", "user.email", "scope@example.invalid")
    for name in _LIVE_STARTUP_IDLE_ALARM_REQUIRED | _LIVE_STARTUP_IDLE_ALARM_REGRESSIONS:
        put(name, _IDLE_OWNER if name == _THIN else "baseline = True\n")
    put(_METADATA, '__version__ = "2.0.20"\n')
    put(_OTHER_OWNER, "baseline = True\n")
    put(_OTHER_TEST, "def test_other():\n    assert 2 + 2 == 4\n")
    git("add", ".")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    for name in _LIVE_STARTUP_IDLE_ALARM_REQUIRED:
        put(name, "changed = True\n")
    put(
        _THIN,
        _IDLE_OWNER + 'observed = ("speech_stopped", "playback", "end_conversation", "rearm")\n',
    )
    for name in _LIVE_STARTUP_IDLE_ALARM_REGRESSIONS:
        put(name, "def test_changed_contract():\n    assert 'ready' != 'offline'\n")
    git("add", _THIN)  # Both staged and unstaged effective files participate.
    (root / "docs").mkdir()

    def write(record):
        put("docs/STATUS.md", "<!-- candidate-scope-coupling\n" + json.dumps(record) + "\n-->\n")

    def refresh():
        report = inspect_repository(root, base)
        record = {
            "version": 5,
            "kind": "live_startup_native_idle_alarm",
            "base_tip": base,
            "merge_base": base,
            "domains": list(report.domains),
            "fingerprint": production_fingerprint(root, base, base, report.production_files),
            "regression_fingerprint": regression_fingerprint(root, base, base, report.test_files),
            "reviewer": "independent-fixture-reviewer",
            "rationale": "Exact sole-Live startup/settings/UI plus native idle alarm; owners preserved.",
        }
        write(record)
        return record

    assert not inspect_repository(root, base).passed
    record = refresh()
    assert inspect_repository(root, base).passed
    return base, git, put, write, refresh, record


def test_live_startup_idle_alarm_requires_exact_review_and_pinned_surface_inventory(tmp_path):
    base, _git, _put, write, _refresh, record = _repo(tmp_path)
    report = inspect_repository(tmp_path, base)
    assert report.reason == "exact reviewed coupling: live_startup_native_idle_alarm"
    assert len(_LIVE_STARTUP_IDLE_ALARM_REQUIRED) == 12
    assert len(_LIVE_STARTUP_IDLE_ALARM_REGRESSIONS) == 24
    assert set(report.production_files) == _LIVE_STARTUP_IDLE_ALARM_REQUIRED
    assert set(report.test_files) == _LIVE_STARTUP_IDLE_ALARM_REGRESSIONS
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed
    write(record)
    assert inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "key,value",
    [
        ("version", True),
        ("version", "5"),
        ("version", 5.0),
        ("version", 1),
        ("version", 2),
        ("version", 3),
        ("version", 4),
        ("version", 6),
        ("kind", "unknown"),
        ("base_tip", "stale"),
        ("merge_base", "stale"),
        ("domains", ["audio_input", "rearm"]),
        ("fingerprint", "stale"),
        ("regression_fingerprint", "stale"),
        ("reviewer", " "),
        ("rationale", ""),
        ("extra", "unapproved"),
    ],
)
def test_live_startup_idle_alarm_rejects_stale_or_unknown_record(tmp_path, key, value):
    base, _git, _put, write, _refresh, record = _repo(tmp_path)
    write({**record, key: value})
    assert not inspect_repository(tmp_path, base).passed


def test_live_startup_idle_alarm_rejects_missing_or_duplicate_review_fields(tmp_path):
    base, _git, put, write, _refresh, record = _repo(tmp_path)
    for key in record:
        write({k: v for k, v in record.items() if k != key})
        assert not inspect_repository(tmp_path, base).passed, key
    duplicate = json.dumps(record)[:-1] + ', "reviewer": "another"}'
    put("docs/STATUS.md", "<!-- candidate-scope-coupling\n" + duplicate + "\n-->\n")
    assert not inspect_repository(tmp_path, base).passed
    write(record)
    status = tmp_path / "docs/STATUS.md"
    status.write_text(status.read_text() * 2)
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "name", [_THIN, "tests/integration/test_ha_timer_native_output.py", _OTHER_TEST]
)
@pytest.mark.parametrize("hidden", [False, True])
def test_live_startup_idle_alarm_binds_effective_production_and_all_test_bytes(
    tmp_path, name, hidden
):
    base, git, _put, _write, _refresh, record = _repo(tmp_path)
    if hidden:
        git("update-index", "--assume-unchanged", name)
    path = tmp_path / name
    path.write_text(path.read_text() + "tampered = True\n")
    fingerprint = regression_fingerprint if name.startswith("tests/") else production_fingerprint
    key = "regression_fingerprint" if name.startswith("tests/") else "fingerprint"
    assert fingerprint(tmp_path, base, base, ()) != record[key]
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "name", sorted(_LIVE_STARTUP_IDLE_ALARM_REQUIRED | _LIVE_STARTUP_IDLE_ALARM_REGRESSIONS)
)
def test_live_startup_idle_alarm_requires_every_effectively_changed_owner_and_regression(
    tmp_path, name
):
    base, git, _put, _write, refresh, _record = _repo(tmp_path)
    (tmp_path / name).write_text(git("show", f"{base}:{name}") + "\n")
    refresh()  # Even a fresh byte-binding cannot admit an incomplete chain.
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "name", [_OTHER_OWNER, _OTHER_TEST, "esphome/extra.h", "tests/unit/test_extra.py"]
)
@pytest.mark.parametrize("hidden", [False, True])
def test_live_startup_idle_alarm_rejects_extra_effective_surfaces_even_after_rebinding(
    tmp_path, name, hidden
):
    base, git, put, _write, refresh, _record = _repo(tmp_path)
    if hidden and name in {_OTHER_OWNER, _OTHER_TEST}:
        git("update-index", "--skip-worktree", name)
    put(name, "unapproved = True\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("name", [_THIN, "tests/firmware/idle_timer_output_test.cpp"])
@pytest.mark.parametrize("mutation", ["deleted", "symlink", "mode"])
def test_live_startup_idle_alarm_rejects_deleted_symlinked_or_stale_mode_paths(
    tmp_path, name, mutation
):
    base, _git, put, _write, refresh, _record = _repo(tmp_path)
    path = tmp_path / name
    if mutation == "mode":
        path.chmod(0o755)
    else:
        data = path.read_text()
        path.unlink()
        if mutation == "symlink":
            target = put("fixture-target", data)
            path.symlink_to(target)
    assert not inspect_repository(tmp_path, base).passed
    if mutation != "mode":
        refresh()
        assert not inspect_repository(tmp_path, base).passed


def test_live_startup_idle_alarm_permits_only_its_named_scope_regression(tmp_path):
    base, _git, put, _write, refresh, _record = _repo(tmp_path)
    assert _LIVE_STARTUP_IDLE_ALARM_SCOPE_REGRESSIONS == {
        "tests/unit/test_candidate_scope_live_startup_idle_alarm.py"
    }
    put(
        next(iter(_LIVE_STARTUP_IDLE_ALARM_SCOPE_REGRESSIONS)),
        "def test_scope():\n    assert True\n",
    )
    refresh()
    assert inspect_repository(tmp_path, base).passed


def test_live_startup_idle_alarm_allows_only_effective_version_metadata(tmp_path):
    base, git, put, _write, refresh, _record = _repo(tmp_path)
    put(_METADATA, '__version__ = "2.0.21"\n')
    refresh()
    assert inspect_repository(tmp_path, base).passed
    git("add", _METADATA)
    git("update-index", "--assume-unchanged", _METADATA)
    put(_METADATA, '__version__ = "2.0.21"\nrun_unreviewed_code()\n')
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_live_startup_idle_alarm_cannot_swallow_changed_idle_input_owner(tmp_path):
    base, _git, put, _write, refresh, _record = _repo(tmp_path)
    path = tmp_path / _THIN
    put(_THIN, path.read_text().replace("return 1", "return 2"))
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_live_startup_idle_alarm_binds_actual_base_tip_even_when_merge_base_is_unchanged(tmp_path):
    base, git, put, _write, _refresh, record = _repo(tmp_path)
    git("restore", "--staged", ".")
    git("branch", "review-base", base)
    git("checkout", "-qb", "new-base", base)
    put("base-note.md", "new base tip\n")
    git("add", "base-note.md")
    git("commit", "-qm", "advance base")
    tip = git("rev-parse", "HEAD")
    git("checkout", "review-base")
    report = inspect_repository(tmp_path, tip)
    assert report.base == base
    # Isolate base-tip drift: effective production/tests and merge base are unchanged.
    assert (
        production_fingerprint(tmp_path, base, base, report.production_files)
        == record["fingerprint"]
    )
    assert (
        regression_fingerprint(tmp_path, base, base, report.test_files)
        == record["regression_fingerprint"]
    )
    assert not report.passed
