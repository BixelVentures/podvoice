import os
import subprocess
from pathlib import Path

import pytest
from scripts import dev_cycle
from scripts.dev_cycle import (
    DevCycleError,
    GateLock,
    ScopeSnapshot,
    changed_files,
    diff_check,
    preflight,
    require_unchanged_scope,
    select_tests,
    sibling_tool,
    tool_environment,
)

TRACKED_TESTS = [
    "tests/integration/test_thin.py",
    "tests/unit/test_dev_cycle.py",
    "tests/unit/test_release_contract.py",
    "tests/unit/test_voicepe_contract.py",
    "tests/unit/test_voicepe_wake.py",
]


def test_ci_runs_for_prs_and_main_pushes_without_feature_branch_duplicates():
    workflow = (Path(__file__).parents[2] / ".github" / "workflows" / "ci.yml").read_text()
    trigger_block = workflow.split("\njobs:", maxsplit=1)[0]
    assert (
        trigger_block
        == """name: CI

on:
  pull_request:
  push:
    branches:
      - main
"""
    )


def test_ci_arm_build_uses_buildx_driver_after_tests_and_before_gha_cache_export():
    workflow = (Path(__file__).parents[2] / ".github" / "workflows" / "ci.yml").read_text()
    build = workflow.split("  build-addon:\n", maxsplit=1)[1]
    qemu = "      - uses: docker/setup-qemu-action@v3\n"
    buildx = "      - uses: docker/setup-buildx-action@v3\n"
    build_push = "      - uses: docker/build-push-action@v6\n"

    assert build.startswith("    needs: lint-test\n")
    assert build.count(qemu) == build.count(buildx) == build.count(build_push) == 1
    assert build.index(qemu) < build.index(buildx) < build.index(build_push)
    assert "          cache-from: type=gha\n" in build
    assert "          cache-to: type=gha,mode=max\n" in build


def test_non_runtime_change_uses_small_contract_smoke():
    tests, reason = select_tests(["docs/ARKITEKTUR.md"], TRACKED_TESTS)
    assert tests == ["tests/unit/test_release_contract.py"]
    assert reason == "non-runtime files only"


def test_changed_test_is_selected_with_release_contract():
    tests, _reason = select_tests(["tests/integration/test_thin.py"], TRACKED_TESTS)
    assert tests == [
        "tests/integration/test_thin.py",
        "tests/unit/test_release_contract.py",
    ]


def test_dev_script_change_runs_workflow_contract():
    tests, _reason = select_tests(["scripts/dev_cycle.py"], TRACKED_TESTS)
    assert tests == [
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_release_contract.py",
    ]


def test_direct_runtime_contract_is_selected_without_claiming_release():
    tests, reason = select_tests(["podvoice/gatekeeper/voicepe.py"], TRACKED_TESTS)
    assert tests == [
        "tests/unit/test_release_contract.py",
        "tests/unit/test_voicepe_contract.py",
        "tests/unit/test_voicepe_wake.py",
    ]
    assert "full suite still required" in reason


@pytest.mark.parametrize(
    "path",
    [
        "podvoice/gatekeeper/new_module.py",
        "podvoice/gatekeeper/static/panel.js",
        "podvoice/run.sh",
        "podvoice/gatekeeper/eval_scenarios.json",
        "scripts/release_build.py",
        "spikes/unknown-production-input.bin",
    ],
)
def test_unknown_production_impact_falls_back_to_full_suite(path: str):
    tests, reason = select_tests([path], TRACKED_TESTS)
    assert tests == ["tests"]
    assert reason


def test_release_surface_falls_back_to_full_suite():
    tests, reason = select_tests(["pyproject.toml"], TRACKED_TESTS)
    assert tests == ["tests"]
    assert "release/build/firmware" in reason


def test_gate_lock_rejects_second_process_wide_owner(tmp_path: Path):
    lock_path = tmp_path / "gate.lock"
    with GateLock(lock_path):
        with pytest.raises(DevCycleError, match="gate already running"):
            with GateLock(lock_path):
                pass


def test_invalid_base_fails_closed_instead_of_hiding_committed_diff(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    def fail_merge_base(_root: Path, *args: str, **_kwargs: object) -> str:
        if args and args[0] == "merge-base":
            raise DevCycleError("invalid base")
        return ""

    monkeypatch.setattr(dev_cycle, "_git", fail_merge_base)
    with pytest.raises(DevCycleError, match="invalid base"):
        changed_files(tmp_path, "does-not-exist")


def test_tool_environment_has_no_global_python_fallback(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    monkeypatch.delenv("PODVOICE_PYTHON", raising=False)
    monkeypatch.setenv("PODVOICE_DEV_CACHE", str(tmp_path / "cache"))
    with pytest.raises(DevCycleError, match="no project Python configured"):
        tool_environment(tmp_path)


def test_tools_must_live_beside_selected_python(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    selected_bin = tmp_path / "selected" / "bin"
    selected_bin.mkdir(parents=True)
    python = selected_bin / "python"
    python.write_text("", encoding="utf-8")
    python.chmod(0o755)
    global_bin = tmp_path / "global"
    global_bin.mkdir()
    global_ruff = global_bin / "ruff"
    global_ruff.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    global_ruff.chmod(0o755)
    monkeypatch.setenv("PATH", str(global_bin))

    with pytest.raises(DevCycleError, match="missing ruff beside"):
        sibling_tool(str(python), "ruff")


def test_preflight_rejects_non_312_python(tmp_path: Path):
    fake_python = tmp_path / "python"
    fake_python.write_text("#!/bin/sh\necho 3.11\n", encoding="utf-8")
    fake_python.chmod(0o755)
    with pytest.raises(DevCycleError, match=r"require Python 3\.12"):
        preflight(tmp_path, os.environ.copy(), str(fake_python))


def test_scope_change_invalidates_focused_result():
    before = ScopeSnapshot("head", "base", ("a.py",), "index", (("a.py", "old"),))
    after = ScopeSnapshot("head", "base", ("a.py",), "index", (("a.py", "new"),))
    with pytest.raises(DevCycleError, match="scope moved"):
        require_unchanged_scope(before, after)


def test_diff_check_covers_committed_staged_and_unstaged(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    commands: list[list[str]] = []

    def record(command, **_kwargs):
        commands.append(list(command))
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(dev_cycle, "_run", record)
    diff_check(tmp_path, os.environ.copy(), "base-sha")
    assert commands == [
        ["git", "diff", "--check", "base-sha...HEAD"],
        ["git", "diff", "--cached", "--check"],
        ["git", "diff", "--check"],
    ]
