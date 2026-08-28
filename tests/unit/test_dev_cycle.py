import os
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from scripts import dev_cycle
from scripts.dev_cycle import (
    DevCycleError,
    GateLock,
    ScopeSnapshot,
    changed_files,
    diff_check,
    load_lifecycle_smoke,
    preflight,
    require_unchanged_scope,
    select_lifecycle_tests,
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


def test_lifecycle_manifest_is_tracked_explicit_and_covers_each_mechanical_boundary():
    root = Path(__file__).parents[2]
    tracked = [str(path.relative_to(root)) for path in root.glob("tests/**/test_*.py")]
    nodes = load_lifecycle_smoke(root, tracked)

    expected_nodes = (
        "tests/unit/test_firmware_contract.py",
        "tests/unit/test_voicepe_wake.py",
        "tests/unit/test_trace_oracle.py",
        "tests/unit/test_audio_trace.py::test_next_physical_wake_and_provider_session_complete_cross_session_proof",
        "tests/unit/test_audio_trace.py::test_failed_immediate_post_rearm_session_cannot_be_proven_by_a_later_attempt",
        "tests/unit/test_audio_trace.py::test_attempt_rejected_before_finish_cannot_be_completed_by_a_later_wake",
        "tests/unit/test_provider_tool_commit_gate.py",
        "tests/unit/test_provider_ack_readiness.py::test_response_created_exposes_exact_semantic_end_response_id",
        "tests/unit/test_provider_ack_readiness.py::test_raw_done_before_created_preserves_terminal_request_source",
        "tests/unit/test_reply.py",
        "tests/unit/test_playout.py",
        "tests/unit/test_voicepe_contract.py",
        "tests/unit/test_provider_tuning.py::test_semantic_end_result_forces_one_tool_free_farewell_response",
        "tests/integration/test_talk.py",
        "tests/integration/test_thin.py",
    )
    assert nodes == expected_nodes
    assert len(nodes) == len(set(nodes)) == 15

    # v1.13.46 restores the public v1.13.43 playback baseline. The full VoicePE and
    # Thin modules above replace these removed private-player/token-specific cases;
    # stale manifest names must never become an accidental release prerequisite.
    retired_private_nodes = (
        "test_correlated_playback_ack_carries_exact_playback_id",
        "test_correlated_playback_rejects_superseded_duplicate_and_out_of_order_edges",
        "test_correlated_playback_fault_and_disconnect_fail_closed",
        "test_correlated_reply_uses_one_device_owned_play_command",
        "test_stop_playback_uses_exact_firmware_owned_cancel",
        "test_stop_playback_waits_for_exact_drained_cancel_ack",
        "test_rebooted_device_cancel_fault_falls_back_to_orphan_silence",
        "test_actual_voicepe_token_ack_drives_exact_thin_lease_and_fault_close",
        "test_in_spec_physical_cancel_drain_completes_before_rearm_without_retry",
    )
    assert not any(retired in node for retired in retired_private_nodes for node in nodes)

    provider_contract = (root / "tests/unit/test_provider_ack_readiness.py").read_text()
    provider_case = provider_contract.split(
        "async def test_response_created_exposes_exact_semantic_end_response_id():", 1
    )[1].split("\nasync def test_", 1)[0]
    for assertion in (
        'assert audio.response_id == "semantic-final"',
        "assert audio.generation is None",
        'assert done.response_id == "semantic-final"',
        'assert done.purpose == "semantic_end"',
        "assert done.generation is None",
        'assert done.source_call_id == "end-source"',
    ):
        assert assertion in provider_case

    raw_done_case = provider_contract.split(
        "async def test_raw_done_before_created_preserves_terminal_request_source():", 1
    )[1].split("\nasync def test_", 1)[0]
    for assertion in (
        "assert not any(isinstance(event, ResponseStarted) for event in events)",
        'assert done.response_id == "terminal-out-of-order"',
        'assert done.purpose == "semantic_end"',
        'assert done.source_call_id == "end-out-of-order"',
    ):
        assert assertion in raw_done_case


@pytest.mark.parametrize(
    "path",
    [
        "podvoice/gatekeeper/prompt.py",
        "podvoice/gatekeeper/tools.py",
        "podvoice/gatekeeper/eval_harness.py",
        "podvoice/gatekeeper/constants.py",
        "podvoice/gatekeeper/static/index.html",
        "podvoice/config.yaml",
        "tests/unit/test_eval_harness.py",
    ],
)
def test_lifecycle_smoke_fails_closed_outside_mechanical_ownership(path: str):
    with pytest.raises(DevCycleError, match=r"does not cover|does not own"):
        select_lifecycle_tests([path], ["tests/unit/test_trace_oracle.py"])


def test_changed_covered_test_file_runs_whole_file_not_only_named_nodes():
    nodes = [
        "tests/integration/test_thin.py::test_one",
        "tests/integration/test_thin.py::test_two",
        "tests/unit/test_trace_oracle.py",
    ]
    assert select_lifecycle_tests(["tests/integration/test_thin.py"], nodes) == [
        "tests/integration/test_thin.py",
        "tests/unit/test_trace_oracle.py",
    ]


def test_lifecycle_smoke_allows_only_explicit_runtime_firmware_and_docs_surfaces():
    nodes = ["tests/unit/test_trace_oracle.py"]
    selected = select_lifecycle_tests(
        [
            "podvoice/gatekeeper/thin.py",
            "podvoice/gatekeeper/openai_realtime.py",
            "podvoice/gatekeeper/voicepe.py",
            "esphome/podvoice.yaml",
            "esphome/components/podvoice_audio/podvoice_audio.cpp",
            "docs/EVALUERING.md",
        ],
        nodes,
    )
    assert selected == nodes


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


def test_preflight_rejects_non_312_python(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    gib = 1024**3
    monkeypatch.setattr(
        dev_cycle.shutil,
        "disk_usage",
        lambda _root: SimpleNamespace(total=100 * gib, used=50 * gib, free=50 * gib),
    )
    fake_python = tmp_path / "python"
    fake_python.write_text("#!/bin/sh\necho 3.11\n", encoding="utf-8")
    fake_python.chmod(0o755)
    with pytest.raises(DevCycleError, match=r"require Python 3\.12"):
        preflight(tmp_path, os.environ.copy(), str(fake_python))


def test_preflight_read_probe_is_bounded_and_skips_missing_files():
    source = Path(dev_cycle.__file__).read_text(encoding="utf-8")
    assert "for p in sys.argv[1:] if Path(p).is_file()" in source
    assert '[python, "-c", read_probe, *probe_files]' in source
    assert '[python, "-c", read_probe, *tracked]' not in source


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
