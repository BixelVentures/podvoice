"""Real-Git boundaries for the exact schema/startup/MCP-health V2 profile."""

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from scripts.candidate_scope import (
    _LIVE_SCHEMA_HEALTH_REGRESSIONS,
    _LIVE_SCHEMA_HEALTH_REQUIRED,
    inspect_repository,
    production_fingerprint,
    regression_fingerprint,
)

_POLICY = "scripts/candidate_scope.py"
_METADATA = "podvoice/gatekeeper/__init__.py"
_OTHER_SOURCE = "podvoice/gatekeeper/unrelated.py"
_OTHER_TEST = "tests/unit/test_unrelated.py"


def _repo(root):
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=root, text=True).strip()

    def put(name, text):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    git("init", "-q")
    git("config", "user.name", "Scope Test")
    git("config", "user.email", "scope@example.invalid")
    for name in _LIVE_SCHEMA_HEALTH_REQUIRED | _LIVE_SCHEMA_HEALTH_REGRESSIONS:
        put(name, "" if name in _LIVE_SCHEMA_HEALTH_REQUIRED else "baseline = True\n")
    put(_METADATA, '__version__ = "2.0.21"\n')
    put(_OTHER_SOURCE, "unrelated = True\n")
    put(_OTHER_TEST, "def test_unrelated(): pass\n")
    policy = put(_POLICY, "")
    shutil.copyfile(Path(__file__).parents[2] / _POLICY, policy)
    git("add", ".")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    for name in _LIVE_SCHEMA_HEALTH_REQUIRED:
        put(name, "changed = True\n")
    put(
        "podvoice/gatekeeper/thin.py", 'events = ("MCP", "playback", "end_conversation", "rearm")\n'
    )
    for name in _LIVE_SCHEMA_HEALTH_REGRESSIONS:
        put(name, "def test_changed_contract(): assert 1 + 1 == 2\n")
    git("add", "podvoice/gatekeeper/tools.py")

    def write(record):
        return put(
            "docs/STATUS.md", "<!-- candidate-scope-coupling\n" + json.dumps(record) + "\n-->\n"
        )

    def refresh():
        report = inspect_repository(root, base)
        record = {
            "version": 2,
            "kind": "live_schema_startup_mcp_health",
            "base_tip": base,
            "merge_base": base,
            "domains": ["ha_tools", "physical_output", "realtime_semantics", "rearm"],
            "fingerprint": production_fingerprint(root, base, base, report.production_files),
            "regression_fingerprint": regression_fingerprint(root, base, base, report.test_files),
            "policy_fingerprint": hashlib.sha256(policy.read_bytes()).hexdigest(),
            "reviewer": "independent-reviewer",
            "rationale": "Actual schema snapshot and health ownership reviewed end to end.",
        }
        write(record)
        return record

    assert not inspect_repository(root, base).passed
    record = refresh()
    assert inspect_repository(root, base).passed
    return base, git, put, write, refresh, record


def test_schema_health_accepts_only_exact_review_and_optional_version_metadata(tmp_path):
    base, _, put, _, refresh, _ = _repo(tmp_path)
    report = inspect_repository(tmp_path, base)
    assert set(report.production_files) == _LIVE_SCHEMA_HEALTH_REQUIRED
    assert report.reason == "exact reviewed coupling: live_schema_startup_mcp_health"
    put(_METADATA, '__version__ = "2.0.22"\n')
    refresh()
    assert inspect_repository(tmp_path, base).passed
    put(_METADATA, '__version__ = "2.0.22"\nextra = True\n')
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "key,value",
    [
        ("version", True),
        ("version", 1),
        ("version", 3),
        ("kind", "unknown"),
        ("kind", "passive_diagnostic_ui"),
        ("base_tip", "stale"),
        ("merge_base", "stale"),
        ("domains", ["ha_tools", "realtime_semantics"]),
        ("fingerprint", "stale"),
        ("regression_fingerprint", "stale"),
        ("policy_fingerprint", "stale"),
        ("reviewer", " "),
        ("rationale", ""),
        ("extra", "unapproved"),
    ],
)
def test_schema_health_rejects_wrong_or_stale_record(tmp_path, key, value):
    base, _, _, write, _, record = _repo(tmp_path)
    write({**record, key: value})
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "name", sorted(_LIVE_SCHEMA_HEALTH_REQUIRED | _LIVE_SCHEMA_HEALTH_REGRESSIONS)
)
@pytest.mark.parametrize("boundary", ["reversed", "deleted", "symlink"])
def test_schema_health_requires_effectively_changed_regular_owners_and_regressions(
    tmp_path, name, boundary
):
    base, git, _, _, refresh, _ = _repo(tmp_path)
    path = tmp_path / name
    if boundary == "reversed":
        git("add", name)
        path.write_text(
            git("show", f"{base}:{name}")
            + ("\n" if name in _LIVE_SCHEMA_HEALTH_REGRESSIONS else "")
        )
    elif boundary == "deleted":
        path.unlink()
    else:
        target = tmp_path / "external-target"
        target.write_bytes(path.read_bytes())
        path.unlink()
        path.symlink_to(target)
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "name",
    [
        "podvoice/gatekeeper/voicepe.py",
        "podvoice/gatekeeper/static/index.html",
        "esphome/podvoice.yaml",
        "custom_components/podvoice/new.py",
        _OTHER_SOURCE,
    ],
)
def test_schema_health_rejects_extra_owner_even_with_refreshed_review_and_hidden_flags(
    tmp_path, name
):
    base, git, put, _, refresh, _ = _repo(tmp_path)
    if name == _OTHER_SOURCE:
        git("update-index", "--assume-unchanged", name)
    put(name, 'observed = "MCP playback end_conversation rearm"\n')
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("name", [_OTHER_SOURCE, _OTHER_TEST, _POLICY])
@pytest.mark.parametrize("flag", ["--assume-unchanged", "--skip-worktree"])
def test_schema_health_whole_tree_and_policy_hash_reject_hidden_mutation(tmp_path, name, flag):
    base, git, _, _, _, _ = _repo(tmp_path)
    git("update-index", flag, name)
    path = tmp_path / name
    path.write_text(path.read_text() + "unreviewed = True\n")
    assert not inspect_repository(tmp_path, base).passed


def test_schema_health_rejects_missing_duplicate_markers_and_duplicate_json_keys(tmp_path):
    base, _, _, write, _, record = _repo(tmp_path)
    status = tmp_path / "docs/STATUS.md"
    status.unlink()
    assert not inspect_repository(tmp_path, base).passed
    write(record)
    status.write_text(status.read_text() * 2)
    assert not inspect_repository(tmp_path, base).passed
    write(record)
    status.write_text(status.read_text().replace('"version": 2,', '"version": 2, "version": 2,'))
    assert not inspect_repository(tmp_path, base).passed


def test_schema_health_requires_every_record_field(tmp_path):
    base, _, _, write, _, record = _repo(tmp_path)
    for key in record:
        write({name: value for name, value in record.items() if name != key})
        assert not inspect_repository(tmp_path, base).passed, key


@pytest.mark.parametrize("boundary", ["deleted", "symlink"])
def test_schema_health_policy_must_be_present_and_regular(tmp_path, boundary):
    base, _, _, _, refresh, _ = _repo(tmp_path)
    policy = tmp_path / _POLICY
    data = policy.read_bytes()
    policy.unlink()
    if boundary == "symlink":
        target = tmp_path / "policy-target"
        target.write_bytes(data)
        policy.symlink_to(target)
        refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_schema_health_binds_base_tip_even_when_merge_base_remains_same(tmp_path):
    base, git, _, _, _, _ = _repo(tmp_path)
    other_tip = git(
        "commit-tree", git("rev-parse", f"{base}^{{tree}}"), "-p", base, "-m", "new base tip"
    )
    assert git("merge-base", "HEAD", other_tip) == base
    assert not inspect_repository(tmp_path, other_tip).passed


@pytest.mark.parametrize("boundary", ["deleted", "symlink"])
def test_schema_health_rejects_additional_changed_test_even_after_refreshed_review(
    tmp_path, boundary
):
    base, _, _, _, refresh, _ = _repo(tmp_path)
    path = tmp_path / _OTHER_TEST
    data = path.read_bytes()
    path.unlink()
    if boundary == "symlink":
        target = tmp_path / "additional-test-target"
        target.write_bytes(data)
        path.symlink_to(target)
    refresh()
    assert not inspect_repository(tmp_path, base).passed
