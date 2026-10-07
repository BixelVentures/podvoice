"""Actual gate dependency eligibility; temporary test repositories remain legal."""

import contextlib
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from scripts import dev_cycle
from scripts.dev_cycle import DevCycleError, require_durable_storage, validate_gate_storage

ACTUAL_GIT = dev_cycle._git


@pytest.fixture(scope="module")
def external_venv(tmp_path_factory):
    root = tmp_path_factory.mktemp("storage-external-venv")
    subprocess.run(
        [sys.executable, "-m", "venv", "--without-pip", "--symlinks", str(root)],
        check=True,
        timeout=10,
        capture_output=True,
    )
    return str(root / "bin" / "python")


@pytest.fixture
def storage(monkeypatch, tmp_path, external_venv):
    root = tmp_path / "durable" / "checkout"
    common = root / ".git"
    objects = common / "objects"
    objects.mkdir(parents=True)
    cache = tmp_path / "durable" / "cache"
    temporary = tmp_path / "os-temp"
    monkeypatch.setattr(dev_cycle, "temporary_storage_roots", lambda: (temporary,))
    monkeypatch.delenv("GIT_ALTERNATE_OBJECT_DIRECTORIES", raising=False)
    monkeypatch.setattr(
        dev_cycle,
        "_git",
        lambda _root, *args: str(common if "--git-common-dir" in args else objects),
    )
    return SimpleNamespace(
        root=root,
        common=common,
        objects=objects,
        cache=cache,
        temporary=temporary,
        python=external_venv,
    )


def test_external_real_venv_keeps_logical_bin_despite_interpreter_symlink(storage):
    # This fixture is a real venv even when CI's pytest runs in setup-python.
    # Its executable symlink must not replace its distinct runtime identity.
    assert Path(storage.python).is_symlink()
    assert (Path(storage.python).parent.parent / "pyvenv.cfg").is_file()
    validate_gate_storage(storage.root, storage.python, storage.cache)


@pytest.mark.parametrize("part", ["Documents", "Desktop", "OneDrive-work", "CloudStorage"])
def test_synced_checkout_is_rejected_before_git_or_python(storage, monkeypatch, part):
    monkeypatch.setattr(dev_cycle, "_git", lambda *_args: pytest.fail("Git must not start"))
    with pytest.raises(DevCycleError, match="checkout uses synchronized storage"):
        validate_gate_storage(storage.root.parent / part / "repo", storage.python, storage.cache)


def test_unsynced_worktree_cannot_hide_synced_common_git(storage, monkeypatch):
    common = storage.root.parent / "Documents" / "repo" / ".git"
    monkeypatch.setattr(dev_cycle, "_git", lambda *_args: str(common))
    with pytest.raises(DevCycleError, match="common Git uses synchronized storage"):
        validate_gate_storage(storage.root, storage.python, storage.cache)


@pytest.mark.parametrize("owner", ["checkout", "venv", "cache"])
def test_ephemeral_gate_dependency_is_rejected(storage, owner):
    root, python, cache = storage.root, storage.python, storage.cache
    if owner == "checkout":
        root = storage.temporary / "clone"
    elif owner == "venv":
        python = str(storage.temporary / "venv" / "bin" / "python")
    else:
        cache = storage.temporary / "cache"
    with pytest.raises(DevCycleError, match="temporary storage"):
        validate_gate_storage(root, python, cache)


def test_checkout_local_venv_cannot_be_gate_toolchain(storage):
    with pytest.raises(DevCycleError, match="external to the checkout"):
        validate_gate_storage(storage.root, str(storage.root / ".venv/bin/python"), storage.cache)


def test_global_python_and_forged_venv_config_are_rejected(storage, monkeypatch):
    python = storage.root.parent / "fake-venv/bin/python"
    python.parent.mkdir(parents=True)
    with pytest.raises(DevCycleError, match="external venv"):
        validate_gate_storage(storage.root, str(python), storage.cache)
    (python.parent.parent / "pyvenv.cfg").write_text("home = base\n")
    python.write_text("#!/bin/sh\n")
    python.chmod(0o755)
    monkeypatch.setattr(
        dev_cycle,
        "_run",
        lambda *_args, **_kwargs: SimpleNamespace(
            stdout=json.dumps([sys.base_prefix, sys.base_prefix])
        ),
    )
    with pytest.raises(DevCycleError, match="does not execute"):
        validate_gate_storage(storage.root, str(python), storage.cache)


def write_alternate(objects, target):
    info = objects / "info"
    info.mkdir(parents=True, exist_ok=True)
    (info / "alternates").write_text(str(target) + "\n")


def test_relative_alternates_are_checked_transitively_and_cycles_fail_closed(storage):
    other = storage.objects.parent / "other-objects"
    other.mkdir()
    write_alternate(storage.objects, "../other-objects")
    validate_gate_storage(storage.root, storage.python, storage.cache)
    write_alternate(other, storage.root.parent / "Documents" / "shared-objects")
    with pytest.raises(DevCycleError, match="Git objects uses synchronized storage"):
        validate_gate_storage(storage.root, storage.python, storage.cache)
    write_alternate(other, storage.objects)
    with pytest.raises(DevCycleError, match="cyclic"):
        validate_gate_storage(storage.root, storage.python, storage.cache)


def test_alternates_symlink_and_inherited_relative_path_cannot_hide_sync(storage, monkeypatch):
    info = storage.objects / "info"
    info.mkdir()
    synced = storage.root.parent / "Documents" / "alternate-file"
    synced.parent.mkdir()
    synced.write_text("")
    (info / "alternates").symlink_to(synced)
    with pytest.raises(DevCycleError, match="Git alternates file uses synchronized storage"):
        validate_gate_storage(storage.root, storage.python, storage.cache)
    (info / "alternates").unlink()
    monkeypatch.setenv("GIT_ALTERNATE_OBJECT_DIRECTORIES", "../Documents/objects")
    with pytest.raises(DevCycleError, match="Git objects uses synchronized storage"):
        validate_gate_storage(storage.root, storage.python, storage.cache)


def test_storage_symlink_cannot_hide_ephemeral_root(storage):
    storage.temporary.mkdir()
    link = storage.root.parent / "linked-cache"
    link.symlink_to(storage.temporary)
    with pytest.raises(DevCycleError, match="temporary storage"):
        require_durable_storage(link, "cache")


@pytest.mark.parametrize("mode", ["fast", "lifecycle", "release"])
def test_actual_gate_entrypoint_refuses_before_cache_lock_preflight_or_stages(
    storage, monkeypatch, mode
):
    monkeypatch.setattr(dev_cycle, "repository_root", lambda _cwd: storage.temporary / "repo")
    monkeypatch.setattr(
        dev_cycle, "tool_environment", lambda *_args: pytest.fail("cache must not start")
    )
    monkeypatch.setattr(dev_cycle, "GateLock", lambda *_args: pytest.fail("lock must not start"))
    monkeypatch.setattr(
        dev_cycle, "preflight", lambda *_args: pytest.fail("preflight must not start")
    )
    for name in ("run_fast", "run_lifecycle", "run_release"):
        monkeypatch.setattr(dev_cycle, name, lambda *_args: pytest.fail("stage must not start"))
    assert dev_cycle.main([mode]) == 2


def test_default_cache_is_durable_without_additional_environment_configuration(
    monkeypatch, tmp_path
):
    monkeypatch.delenv("PODVOICE_DEV_CACHE", raising=False)
    monkeypatch.setenv("PODVOICE_PYTHON", sys.executable)
    monkeypatch.setattr(dev_cycle.Path, "home", lambda: tmp_path / "home")
    env, python = dev_cycle.tool_environment(tmp_path / "repo")
    assert python == sys.executable
    assert Path(env["PODVOICE_DEV_CACHE"]) == tmp_path / "home/.cache/podvoice-dev"
    assert "podvoice-dev-gate.lock" not in env["PODVOICE_DEV_CACHE"]


@pytest.mark.parametrize("raw", ["~/.cache/custom", "../shared-cache"])
def test_guard_admits_exact_cache_created_by_environment_and_stage(storage, monkeypatch, raw):
    home = storage.root.parent / "user-home"
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("PODVOICE_DEV_CACHE", raw)
    monkeypatch.setenv("PODVOICE_PYTHON", storage.python)
    expected = (
        home / ".cache/custom" if raw.startswith("~") else storage.root.parent / "shared-cache"
    )
    admitted = dev_cycle.configured_cache_root(os.environ, storage.root)
    assert admitted == expected
    validate_gate_storage(storage.root, storage.python, admitted)
    env, _python = dev_cycle.tool_environment(storage.root)
    stage = dev_cycle._stage_environment(env, "unit")
    assert Path(env["PODVOICE_DEV_CACHE"]) == admitted
    assert (admitted / "pycache").is_dir()
    assert Path(stage["RUFF_CACHE_DIR"]) == admitted / "ruff/unit"
    assert (admitted / "ruff/unit").is_dir()
    assert not (storage.root / "~").exists()


def test_preflight_mode_keeps_existing_read_only_scope(storage, monkeypatch):
    observed = []
    monkeypatch.setattr(dev_cycle, "repository_root", lambda _cwd: storage.temporary / "repo")
    monkeypatch.setattr(
        dev_cycle, "validate_gate_storage", lambda *_args: pytest.fail("gate-only guard")
    )
    monkeypatch.setattr(dev_cycle, "tool_environment", lambda _root: ({}, "python"))
    monkeypatch.setattr(dev_cycle, "GateLock", contextlib.nullcontext)
    monkeypatch.setattr(dev_cycle, "preflight", lambda *_args: observed.append("preflight") or [])
    monkeypatch.setattr(
        dev_cycle, "scope_snapshot", lambda *_args: pytest.fail("no source/test gate")
    )
    assert dev_cycle.main(["preflight"]) == 0
    assert observed == ["preflight"]


def test_nonregular_alternates_are_rejected_without_blocking_read(storage):
    info = storage.objects / "info"
    info.mkdir()
    os.mkfifo(info / "alternates")
    with pytest.raises(DevCycleError, match="regular file"):
        validate_gate_storage(storage.root, storage.python, storage.cache)


def init_actual_git(storage, monkeypatch):
    for key in (
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_DIR",
        "GIT_COMMON_DIR",
    ):
        monkeypatch.delenv(key, raising=False)
    subprocess.run(
        ["git", "init", "-q", str(storage.root)], check=True, timeout=5, capture_output=True
    )
    monkeypatch.setattr(dev_cycle, "_git", ACTUAL_GIT)


def test_actual_git_standalone_objects_and_real_external_venv_pass_admission(storage, monkeypatch):
    init_actual_git(storage, monkeypatch)
    validate_gate_storage(storage.root, storage.python, storage.cache)


@pytest.mark.parametrize("key", ["GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"])
def test_actual_git_inherited_object_dependencies_are_rejected(storage, monkeypatch, key):
    init_actual_git(storage, monkeypatch)
    target = storage.root.parent / "Documents" / "external-objects"
    target.mkdir(parents=True)
    monkeypatch.setenv(key, str(target))
    with pytest.raises(DevCycleError, match="Git objects uses synchronized storage"):
        validate_gate_storage(storage.root, storage.python, storage.cache)


@pytest.mark.parametrize(
    "relative", ["pycache", "mypy", "preflight", "ruff/unit", "pytest/integration"]
)
def test_existing_owned_cache_symlink_is_rejected_before_probe_lock_or_stage(
    storage, monkeypatch, relative
):
    target = storage.root.parent / "Documents" / "redirected-cache"
    target.mkdir(parents=True)
    alias = storage.cache / relative
    alias.parent.mkdir(parents=True)
    alias.symlink_to(target)
    monkeypatch.setenv("PODVOICE_PYTHON", storage.python)
    monkeypatch.setenv("PODVOICE_DEV_CACHE", str(storage.cache))
    monkeypatch.setattr(dev_cycle, "repository_root", lambda _cwd: storage.root)
    monkeypatch.setattr(
        dev_cycle, "_git", lambda *_args: pytest.fail("no Git probe before bad cache")
    )
    monkeypatch.setattr(dev_cycle, "_run", lambda *_args, **_kwargs: pytest.fail("no Python probe"))
    monkeypatch.setattr(
        dev_cycle, "tool_environment", lambda *_args: pytest.fail("no earlier mkdir")
    )
    monkeypatch.setattr(dev_cycle, "GateLock", lambda *_args: pytest.fail("no earlier lock"))
    monkeypatch.setattr(
        dev_cycle.subprocess, "Popen", lambda *_args, **_kwargs: pytest.fail("no earlier Popen")
    )
    assert dev_cycle.main(["release"]) == 2
    assert not (storage.cache / "pycache").exists() or relative == "pycache"


def test_cache_path_builder_covers_actual_declared_gate_stages(storage, monkeypatch):
    thin = storage.root / "podvoice/gatekeeper/thin.py"
    thin.parent.mkdir(parents=True)
    thin.write_text("pass\n")
    snapshot = SimpleNamespace(changes=("podvoice/gatekeeper/thin.py",), merge_base="base")
    observed = set()
    monkeypatch.setattr(
        dev_cycle,
        "run_parallel",
        lambda _root, _env, stages: observed.update(stage.name for stage in stages),
    )
    monkeypatch.setattr(dev_cycle, "diff_check", lambda *_args: None)
    monkeypatch.setattr(dev_cycle, "sibling_tool", lambda _python, name: name)
    monkeypatch.setattr(dev_cycle, "select_tests", lambda *_args: (["tests"], "full"))
    dev_cycle.run_fast(storage.root, {}, storage.python, snapshot)
    monkeypatch.setattr(
        dev_cycle, "select_tests", lambda *_args: (["tests/unit/test_gate_storage.py"], "focused")
    )
    dev_cycle.run_fast(storage.root, {}, storage.python, snapshot)
    monkeypatch.setattr(
        dev_cycle, "load_lifecycle_smoke", lambda *_args: ["tests/integration/test_thin.py"]
    )
    monkeypatch.setattr(
        dev_cycle, "select_lifecycle_tests", lambda *_args: ["tests/integration/test_thin.py"]
    )
    dev_cycle.run_lifecycle(storage.root, {}, storage.python, snapshot)
    dev_cycle.run_release(storage.root, {}, storage.python, snapshot)
    assert observed == dev_cycle.GATE_CACHE_STAGES
    for stage in observed:
        actual = dev_cycle._stage_environment({"PODVOICE_DEV_CACHE": str(storage.cache)}, stage)
        paths = dev_cycle.cache_paths(storage.cache, stage)
        assert Path(actual["PYTHONPYCACHEPREFIX"]) == paths["pycache"]
        assert Path(actual["MYPY_CACHE_DIR"]) == paths["mypy"]
        assert Path(actual["RUFF_CACHE_DIR"]) == paths["ruff"]
        assert f"cache_dir={paths['pytest']}" in actual["PYTEST_ADDOPTS"]


def test_cache_resolve_cycle_is_a_structured_gate_failure(storage, monkeypatch):
    loop = storage.root.parent / "cache-loop"
    loop.symlink_to(loop)
    monkeypatch.setenv("PODVOICE_DEV_CACHE", str(loop))
    monkeypatch.setattr(dev_cycle, "repository_root", lambda _cwd: storage.root)
    monkeypatch.setattr(
        dev_cycle, "tool_environment", lambda *_args: pytest.fail("no earlier mkdir")
    )
    assert dev_cycle.main(["fast"]) == 2
