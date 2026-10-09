import ast
import contextlib
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from scripts import dev_cycle
from scripts.dev_cycle import (
    DevCycleError,
    GateLock,
    ScopeSnapshot,
    Stage,
    changed_files,
    diff_check,
    load_lifecycle_smoke,
    preflight,
    preflight_fingerprint,
    require_unchanged_scope,
    run_parallel,
    run_release,
    run_unit_batches,
    select_lifecycle_tests,
    select_tests,
    sibling_tool,
    tool_environment,
    unit_batches,
    unit_stage,
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
    assert "pull_request:" in trigger_block
    assert "push:\n    branches:\n      - main" in trigger_block
    assert "packages: write" in trigger_block
    assert "cancel-in-progress: false" in trigger_block


def test_ci_arm_build_runs_in_parallel_and_publishes_versioned_main_image():
    workflow = (Path(__file__).parents[2] / ".github" / "workflows" / "ci.yml").read_text()
    build = workflow.split("  build-addon:\n", maxsplit=1)[1].split(
        "  publish-addon:\n", maxsplit=1
    )[0]
    publish = workflow.split("  publish-addon:\n", maxsplit=1)[1]
    qemu = "      - uses: docker/setup-qemu-action@v3\n"
    buildx = "      - uses: docker/setup-buildx-action@v3\n"
    build_push = "      - uses: docker/build-push-action@v6\n"

    assert not build.startswith("    needs:")
    assert build.count(qemu) == build.count(buildx) == build.count(build_push) == 1
    assert build.index(qemu) < build.index(buildx) < build.index(build_push)
    assert "dorny/paths-filter@v3" in build
    login = "      - uses: docker/login-action@v3\n"
    assert build.count(login) == 1
    assert build.index(login) < build.index(build_push)
    assert "github.event_name == 'pull_request'" in build
    assert "build-${{ steps.artifact.outputs.context_sha }}" in build
    assert "ghcr.io/bixelventures/aarch64-addon-podvoice:" in build
    assert "cache-from: type=gha,scope=podvoice-aarch64" in build
    assert "cache-to:" not in build
    assert "needs: [lint-test, ui-browser]" in publish
    assert "github.event_name == 'push'" in publish
    assert "Publish exact tested main image" in publish
    assert "docker/build-push-action@v6" in publish
    assert "org.opencontainers.image.revision=${{ github.sha }}" in publish
    assert "PODVOICE_GIT_SHA=${{ github.sha }}" in publish
    assert "sha-${{ github.sha }}" in publish
    assert "Refuse an existing release version" in publish
    assert 'if [ "$inspect_status" -eq 0 ]' in publish
    assert '"manifest unknown"' in publish and '"not found"' in publish
    assert 'exit "$inspect_status"' in publish
    assert "steps.publish.outputs.digest" in publish
    manifest = (Path(__file__).parents[2] / "podvoice" / "config.yaml").read_text()
    assert "image: ghcr.io/bixelventures/{arch}-addon-podvoice" in manifest


def test_ci_optional_cache_cannot_hold_required_image_publication_open():
    workflow = (Path(__file__).parents[2] / ".github" / "workflows" / "ci.yml").read_text()
    build, publish = workflow.split("  build-addon:\n", maxsplit=1)[1].split(
        "  publish-addon:\n", maxsplit=1
    )
    for job in (build, publish):
        assert "cache-from: type=gha,scope=podvoice-aarch64" in job
        assert "cache-to:" not in job
        assert "continue-on-error" not in job
        assert "|| true" not in job
        assert "platforms: linux/arm64" in job
        assert "docker/login-action@v3" in job
        assert "docker/build-push-action@v6" in job
    fork_guard = "github.event.pull_request.head.repo.full_name == github.repository"
    assert build.count(fork_guard) == 2
    assert "needs: [lint-test, ui-browser]" in publish
    assert "push: true" in publish
    assert "Refuse an existing release version" in publish
    assert "Record published digest" in publish


def test_dev_cycle_has_no_redundant_pytest_collection_pass():
    source = Path(dev_cycle.__file__).read_text(encoding="utf-8")
    assert "--collect-only" not in source
    assert "run_parallel(root, env, stages)" in source


def test_parallel_stages_start_together_and_receive_isolated_caches(tmp_path: Path):
    first = tmp_path / "first"
    second = tmp_path / "second"
    outputs = [tmp_path / "env-a.json", tmp_path / "env-b.json"]

    env = os.environ.copy()
    env["PODVOICE_DEV_CACHE"] = str(tmp_path / "cache")
    stage_envs = [
        {"OWN": str(first), "OTHER": str(second), "OUT": str(outputs[0])},
        {"OWN": str(second), "OTHER": str(first), "OUT": str(outputs[1])},
    ]
    stages = []
    for index, values in enumerate(stage_envs):
        stage_name = f"stage-{index}"
        stage_python = tmp_path / f"stage-{index}.py"
        stage_python.write_text(
            "import json,os,time\n"
            "from pathlib import Path\n"
            f"own=Path({values['OWN']!r}); other=Path({values['OTHER']!r})\n"
            "own.touch()\n"
            "deadline=time.monotonic()+2\n"
            "while not other.exists() and time.monotonic() < deadline: time.sleep(0.01)\n"
            "assert other.exists()\n"
            f"Path({values['OUT']!r}).write_text(json.dumps({{k:os.environ[k] for k in "
            "('PYTHONPYCACHEPREFIX','MYPY_CACHE_DIR','RUFF_CACHE_DIR','PYTEST_ADDOPTS')}))\n",
            encoding="utf-8",
        )
        stages.append(Stage(stage_name, (sys.executable, str(stage_python)), 3))
    run_parallel(tmp_path, env, stages)
    caches = [json.loads(path.read_text(encoding="utf-8")) for path in outputs]
    assert caches[0] != caches[1]
    assert all(str(tmp_path / "cache") in value for row in caches for value in row.values())


def test_parallel_timeout_is_structured_and_stops_process_group(tmp_path: Path):
    env = os.environ.copy()
    env["PODVOICE_DEV_CACHE"] = str(tmp_path / "cache")
    with pytest.raises(DevCycleError, match="timed out"):
        run_parallel(
            tmp_path,
            env,
            [Stage("wedged", (sys.executable, "-c", "import time; time.sleep(10)"), 0)],
        )


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
        "tests/unit/test_field_canary.py",
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
    assert len(nodes) == len(set(nodes)) == 16

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


def test_preflight_fingerprint_is_stable_and_invalidated_by_dependency_input(tmp_path: Path):
    python = tmp_path / "venv" / "bin" / "python"
    python.parent.mkdir(parents=True)
    python.write_text("python", encoding="utf-8")
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text("version='1'", encoding="utf-8")
    first = preflight_fingerprint(tmp_path, str(python), "3.12")
    assert preflight_fingerprint(tmp_path, str(python), "3.12") == first
    pyproject.write_text("version='2'", encoding="utf-8")
    assert preflight_fingerprint(tmp_path, str(python), "3.12") != first


def test_scope_change_invalidates_focused_result():
    before = ScopeSnapshot("head", "base", ("a.py",), "index", (("a.py", "old"),))
    after = ScopeSnapshot("head", "base", ("a.py",), "index", (("a.py", "new"),))
    with pytest.raises(DevCycleError, match="scope moved"):
        require_unchanged_scope(before, after)


def test_release_runs_candidate_scope_against_frozen_merge_base(monkeypatch, tmp_path):
    captured = []

    monkeypatch.setattr("scripts.dev_cycle.sibling_tool", lambda _python, name: name)
    monkeypatch.setattr(
        "scripts.dev_cycle.run_parallel",
        lambda _root, _env, stages: captured.extend(stages),
    )
    monkeypatch.setattr("scripts.dev_cycle.diff_check", lambda *_args: None)

    run_release(
        tmp_path,
        {},
        "python",
        ScopeSnapshot("head", "frozen-base", (), "", ()),
    )

    scope = next(stage for stage in captured if stage.name == "candidate-scope")
    assert scope.command == (
        "python",
        "scripts/candidate_scope.py",
        "--base",
        "frozen-base",
    )


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


def test_full_fast_scope_keeps_all_suites_in_isolated_bounded_workers(monkeypatch, tmp_path):
    from scripts.dev_cycle import FAST_TIMEOUT_S, run_fast

    stages = []
    monkeypatch.setattr("scripts.dev_cycle._git", lambda *args: "")
    monkeypatch.setattr("scripts.dev_cycle.sibling_tool", lambda _, name: name)
    monkeypatch.setattr(
        "scripts.dev_cycle.run_parallel", lambda root, env, selected: stages.extend(selected)
    )
    monkeypatch.setattr("scripts.dev_cycle.diff_check", lambda *args: None)
    run_fast(tmp_path, {}, "python", ScopeSnapshot("h", "b", ("esphome/podvoice.yaml",), "", ()))
    unit, integration = stages
    assert unit == unit_stage("python", FAST_TIMEOUT_S)
    assert integration == dev_cycle.integration_stage("python", FAST_TIMEOUT_S)


@pytest.mark.parametrize("count", [1, 3, 4, 9])
def test_unit_batches_cover_every_default_test_module_once(tmp_path, count):
    unit = tmp_path / "tests/unit"
    unit.mkdir(parents=True)
    expected = []
    for index in reversed(range(count)):
        name = f"test_module_{index}.py" if index % 2 else f"module_{index}_test.py"
        path = unit / name
        path.write_text("", encoding="utf-8")
        expected.append(path.relative_to(tmp_path).as_posix())
    (unit / "helper.py").write_text("", encoding="utf-8")
    batches = unit_batches(tmp_path)
    flattened = [path for batch in batches for path in batch]
    assert sorted(flattened) == sorted(expected)
    assert len(flattened) == len(set(flattened)) == count
    assert batches == unit_batches(tmp_path)
    assert len(batches) == min(dev_cycle.UNIT_BATCH_COUNT, count)


def test_real_git_scope_cases_remain_intact_and_use_all_eight_unit_children():
    root = Path(__file__).parents[2]
    unit = root / "tests/unit"
    shards = [f"tests/unit/test_candidate_scope_git_{index}.py" for index in range(1, 9)]
    batches = unit_batches(root)
    flattened = [name for batch in batches for name in batch]
    assert all(flattened.count(name) == 1 for name in shards)
    assert len({index for index, batch in enumerate(batches) if set(shards) & set(batch)}) == 8
    assert "tests/unit/_candidate_scope_git.py" not in flattened

    definitions = []
    for name in [
        "test_candidate_scope.py",
        "_candidate_scope_git.py",
        *[Path(p).name for p in shards],
    ]:
        nodes = ast.parse((unit / name).read_text()).body
        functions = [node for node in nodes if isinstance(node, ast.FunctionDef)]
        if name == "_candidate_scope_git.py":
            assert all(node.name.startswith("_") for node in functions)
        else:
            assert all(node.name.startswith("test_") for node in functions)
            for node in functions:
                is_git = any(argument.arg == "tmp_path" for argument in node.args.args)
                assert is_git == name.startswith("test_candidate_scope_git_")
        definitions.extend(functions)
    names = [node.name for node in definitions]
    assert len(names) == len(set(names))
    inventory = [
        (node.name, ast.dump(node, include_attributes=False))
        for node in sorted(definitions, key=lambda node: node.name)
    ]
    # Original relocation inventory from 28bac091c2415740… was bound to
    # 2cdd76fec4c21335635d8d1a7602d28f131f5237660500d837b3811b1ed3b2d8.
    # Reviewed extension: the physical_output/realtime_semantics pair in
    # _coupled_repo and shard 8's stop-whole-chain parameter decorator only.
    # Still binds every function body, helper and parameter decorator;
    # never derive the expected value from the newly exported test modules.
    digest = hashlib.sha256(json.dumps(inventory, separators=(",", ":")).encode()).hexdigest()
    assert digest == "9b8a704707f72d1ad0f03ba5d8941a68ade3a59d53a915c23fff7f5ffde82676"


@pytest.mark.parametrize("bound", [120, 240])
def test_eight_unit_children_keep_per_child_bounds_and_derive_total_owner_bound(bound):
    assert dev_cycle.UNIT_BATCH_COUNT == 8
    assert dev_cycle.FAST_TIMEOUT_S == 120
    assert dev_cycle.RELEASE_TIMEOUT_S == 240
    stage = unit_stage("python", bound)
    assert stage.command == (
        "python",
        "scripts/dev_cycle.py",
        "unit-worker",
        "--unit-timeout",
        str(bound),
    )
    assert stage.timeout == 8 * (bound + 4) + dev_cycle.COLLECTION_TIMEOUT_S


def test_unit_worker_without_tests_fails_closed(tmp_path):
    with pytest.raises(DevCycleError, match="no test modules"):
        unit_batches(tmp_path)


@pytest.mark.parametrize("failure", [None, 1, 2, 8])
def test_unit_worker_is_sequential_preserves_output_and_stops_after_failure(
    monkeypatch, tmp_path, capsys, failure
):
    batches = tuple((f"tests/unit/test_{index}.py",) for index in range(8))
    monkeypatch.setattr(dev_cycle, "unit_batches", lambda root: batches)
    monkeypatch.setattr(dev_cycle.os, "killpg", lambda *_args: None)
    started = []
    previous = []

    def launch(command, **kwargs):
        assert not previous or previous[-1].returncode is not None
        started.append(tuple(command))
        assert command[4:6] == ("-x", "--tb=short")
        kwargs["stdout"].write(f"details for batch {len(started)}\n")
        assert kwargs["start_new_session"]
        process = SimpleNamespace(pid=100 + len(started), returncode=None)

        def wait(*, timeout):
            assert timeout == 240
            process.returncode = 1 if len(started) == failure else 0
            return process.returncode

        process.wait = wait
        process.poll = lambda: process.returncode
        previous.append(process)
        return process

    monkeypatch.setattr(dev_cycle.subprocess, "Popen", launch)
    if failure is None:
        run_unit_batches(tmp_path, {}, "python", 240)
    else:
        with pytest.raises(DevCycleError, match=f"batch {failure} failed"):
            run_unit_batches(tmp_path, {}, "python", 240)
    assert len(started) == (8 if failure is None else failure)
    assert [command[-1] for command in started] == [batch[0] for batch in batches[: len(started)]]
    assert f"details for batch {len(started)}" in capsys.readouterr().out


def test_unit_batch_timeout_kills_its_stubborn_child_group(monkeypatch, tmp_path):
    unit = tmp_path / "tests/unit"
    unit.mkdir(parents=True)
    (unit / "test_one.py").write_text("", encoding="utf-8")
    worker = tmp_path / "fake-python"
    worker.write_text(
        f"#!{sys.executable}\n"
        "import os,signal,subprocess,sys,time\n"
        "from pathlib import Path\n"
        "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
        "child=subprocess.Popen([sys.executable,'-c',"
        "'import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(30)'])\n"
        "Path('child.pid').write_text(str(child.pid))\n"
        "Path('child.group').write_text(str(os.getpgid(child.pid)))\n"
        "print('timeout-child-started',flush=True)\n"
        "time.sleep(30)\n",
        encoding="utf-8",
    )
    worker.chmod(0o755)
    delivered = []
    processes = []
    real_killpg, real_popen = os.killpg, subprocess.Popen

    def kill_group(group, sig):
        real_killpg(group, sig)
        delivered.append((group, sig))

    def launch(*args, **kwargs):
        process = real_popen(*args, **kwargs)
        processes.append(process)
        return process

    monkeypatch.setattr(dev_cycle.os, "killpg", kill_group)
    monkeypatch.setattr(dev_cycle.subprocess, "Popen", launch)
    started = time.monotonic()
    with pytest.raises(DevCycleError, match="batch 1 timed out after 2s"):
        run_unit_batches(tmp_path, os.environ.copy(), str(worker), 2)
    assert time.monotonic() - started < 8
    child_group = int((tmp_path / "child.group").read_text())
    assert child_group == processes[0].pid
    assert (child_group, signal.SIGKILL) in delivered
    assert processes[0].returncode == -signal.SIGKILL


def test_worker_sigterm_kills_active_child_group_and_prevents_next_batch(monkeypatch, tmp_path):
    monkeypatch.setattr(dev_cycle, "unit_batches", lambda root: (("first.py",), ("second.py",)))
    started, killed = [], []
    original_handler = signal.getsignal(signal.SIGTERM)
    process = SimpleNamespace(pid=123, returncode=None)

    def kill_group(group, sig):
        killed.append((group, sig))
        process.returncode = -sig

    def wait(*, timeout):
        assert timeout == 240
        signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)

    def launch(command, **kwargs):
        started.append(command)
        assert kwargs["start_new_session"]
        return process

    process.wait = wait
    process.poll = lambda: process.returncode
    monkeypatch.setattr(dev_cycle.subprocess, "Popen", launch)
    monkeypatch.setattr(dev_cycle.os, "killpg", kill_group)
    with pytest.raises(DevCycleError, match="unit worker interrupted"):
        run_unit_batches(tmp_path, {}, "python", 240)
    assert len(started) == 1
    assert killed[0] == (process.pid, signal.SIGKILL)
    assert signal.getsignal(signal.SIGTERM) == original_handler


def test_unit_stage_bounds_all_batches_and_worker_bypasses_parent_gate_lock(monkeypatch, tmp_path):
    stage = unit_stage("python", 240)
    assert stage.command == (
        "python",
        "scripts/dev_cycle.py",
        "unit-worker",
        "--unit-timeout",
        "240",
    )
    assert stage.timeout == dev_cycle.UNIT_BATCH_COUNT * 244 + dev_cycle.COLLECTION_TIMEOUT_S
    captured = []
    monkeypatch.setattr(dev_cycle, "run_unit_batches", lambda *args: captured.append(args))
    monkeypatch.setattr(dev_cycle, "tool_environment", lambda root: pytest.fail("nested preflight"))
    monkeypatch.chdir(tmp_path)
    assert dev_cycle.main(["unit-worker", "--unit-timeout", "240"]) == 0
    assert captured[0][0] == tmp_path.resolve()
    assert captured[0][-1] == 240


@pytest.mark.parametrize("working_directory", (".", "subdirectory"))
def test_file_entry_bootstraps_browser_recipe_and_preserves_error_owner(
    tmp_path, working_directory
):
    root = Path(__file__).parents[2]
    checkout = tmp_path / "checkout"
    for name in ("scripts/__init__.py", "scripts/dev_cycle.py", "scripts/browser_gate.py"):
        target = checkout / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((root / name).read_bytes())
    (checkout / "tests/browser").mkdir(parents=True)
    (checkout / "subdirectory").mkdir()
    driver = checkout / "scripts/file_entry_probe.py"
    driver.write_text(
        r"""
import importlib
import json
import os
import runpy
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
original_cwd = Path.cwd()
assert str(root) not in sys.path
assert "scripts.dev_cycle" not in sys.modules
# Match scripts/dev's file-entry path without pytest's checkout-root import setup.
sys.path.insert(0, str(root / "scripts"))
sys.argv = [str(root / "scripts/dev_cycle.py"), "--help"]
try:
    runpy.run_path(sys.argv[0], run_name="__main__")
except SystemExit as exc:
    assert exc.code == 0
else:
    raise AssertionError("actual CLI help did not exit")

entry = sys.modules["scripts.dev_cycle"]
assert entry.__name__ == "__main__"
assert Path(entry.__file__).resolve() == root / "scripts/dev_cycle.py"
assert importlib.import_module("scripts.dev_cycle") is entry
browser = importlib.import_module("scripts.browser_gate")
for name in ("cache_paths", "configured_cache_root", "require_durable_storage", "validate_cache_storage"):
    assert getattr(browser, name) is getattr(entry, name)
    assert getattr(browser, name).__globals__["DevCycleError"] is entry.DevCycleError

launches = []
def forbidden_worker(*args, **kwargs):
    launches.append(args)
    raise AssertionError("browser must not launch on refused dependencies/storage")
browser.run_worker = forbidden_worker
try:
    entry.browser_recipe(root / "Documents", os.environ.copy(), 120)
except entry.DevCycleError as exc:
    assert type(exc) is entry.DevCycleError
    assert "browser checkout uses synchronized storage" in str(exc)
else:
    raise AssertionError("actual storage refusal was lost across module owners")

# Only bypass storage in this isolated ephemeral fixture to reach dependency preflight.
browser.require_durable_storage = lambda path, owner: path
browser.validate_cache_storage = lambda path: None
missing_node = root / "intentionally-missing-pinned-node"
assert not missing_node.exists()
env = dict(os.environ, PODVOICE_NODE=str(missing_node))
try:
    entry.browser_recipe(root, env, 120)
except entry.DevCycleError as exc:
    assert type(exc) is entry.DevCycleError
    assert "missing/mismatched pinned Node, Playwright or Chromium" in str(exc)
    assert isinstance(exc.__cause__, browser.BrowserGateError)
    assert isinstance(exc.__cause__.__cause__, FileNotFoundError)
else:
    raise AssertionError("missing pinned dependency was not refused")
assert not launches
assert Path.cwd() == original_cwd
print(json.dumps({"same_owner": True, "storage_refused": True, "dependency_refused": True, "browser_launches": len(launches), "cwd": str(original_cwd)}))
"""
    )
    cwd = (checkout / working_directory).resolve()
    result = subprocess.run(
        [sys.executable, "-I", "-B", str(driver)],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
        timeout=15,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert not result.stderr
    assert json.loads(result.stdout.splitlines()[-1]) == {
        "same_owner": True,
        "storage_refused": True,
        "dependency_refused": True,
        "browser_launches": 0,
        "cwd": str(cwd),
    }


@pytest.mark.parametrize("missing", ["sdk", "remainder", "both"])
def test_integration_cohorts_refuse_missing_required_inventory(tmp_path, missing):
    directory = tmp_path / "tests/integration"
    directory.mkdir(parents=True)
    if missing == "remainder":
        (directory / "test_thin_live_ten_cycles.py").write_text("")
    elif missing == "sdk":
        (directory / "test_other.py").write_text("")
    with pytest.raises(DevCycleError, match="requires"):
        dev_cycle.integration_batches(tmp_path)


def test_integration_cohorts_cover_all_default_modules_once_and_preserve_nodes(tmp_path):
    directory = tmp_path / "tests/integration"
    directory.mkdir(parents=True)
    for name in ["test_thin_live_ten_cycles.py", "z_test.py", "test_a.py"]:
        (directory / name).write_text(
            "import pytest\n@pytest.mark.parametrize('value', [1, 2])\n"
            "def test_case(value): assert value\n"
        )
    (directory / "helper.py").write_text("raise RuntimeError('must not collect')\n")
    batches = dev_cycle.integration_batches(tmp_path)
    assert batches[0] == (dev_cycle.INTEGRATION_SDK_MODULE,)
    assert len(batches) == 2 and batches == dev_cycle.integration_batches(tmp_path)
    expected = sorted(
        str(p.relative_to(tmp_path)) for p in directory.glob("*.py") if p.name != "helper.py"
    )
    flattened = [name for batch in batches for name in batch]
    assert sorted(flattened) == expected and len(flattened) == len(set(flattened))

    def collect(paths):
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "--collect-only", "-q", "-o", "addopts=", *paths],
            cwd=tmp_path,
            capture_output=True,
            text=True,
            timeout=15,
            check=True,
        )
        return [line for line in result.stdout.splitlines() if "::" in line]

    whole = collect(["tests/integration"])
    parts = [node for batch in batches for node in collect(batch)]
    assert sorted(parts) == sorted(whole) and len(parts) == len(set(parts)) == 6


def test_actual_integration_default_inventory_is_exhaustive_and_unit_inventory_unchanged():
    root = Path(__file__).parents[2]
    expected = sorted(
        str(p.relative_to(root))
        for p in (root / "tests/integration").rglob("*.py")
        if p.name.startswith("test_") or p.name.endswith("_test.py")
    )
    flattened = [name for batch in dev_cycle.integration_batches(root) for name in batch]
    assert sorted(flattened) == expected and len(flattened) == len(set(flattened))
    assert dev_cycle.INTEGRATION_SDK_MODULE in flattened
    assert dev_cycle.UNIT_BATCH_COUNT == 8


@pytest.mark.parametrize("bound", [120, 240])
def test_integration_stage_uses_same_bounds_and_single_parent_lock(monkeypatch, tmp_path, bound):
    stage = dev_cycle.integration_stage("python", bound)
    assert stage.name == "integration"
    assert stage.command == (
        "python",
        "scripts/dev_cycle.py",
        "integration-worker",
        "--integration-timeout",
        str(bound),
    )
    assert stage.timeout == 2 * (bound + 4) + 15
    calls = []
    monkeypatch.setattr(dev_cycle, "run_integration_batches", lambda *args: calls.append(args))
    monkeypatch.setattr(
        dev_cycle, "tool_environment", lambda *args: pytest.fail("nested preflight")
    )
    monkeypatch.setattr(dev_cycle, "GateLock", lambda: pytest.fail("nested GateLock"))
    monkeypatch.chdir(tmp_path)
    assert dev_cycle.main(["integration-worker", "--integration-timeout", str(bound)]) == 0
    assert calls[0] == (tmp_path.resolve(), os.environ.copy(), sys.executable, bound)


def test_release_keeps_two_integration_cohorts_and_eight_unit_children(monkeypatch, tmp_path):
    stages = []
    monkeypatch.setattr(dev_cycle, "sibling_tool", lambda _, name: name)
    monkeypatch.setattr(
        dev_cycle, "run_parallel", lambda root, env, selected: stages.extend(selected)
    )
    monkeypatch.setattr(dev_cycle, "diff_check", lambda *args: None)
    monkeypatch.delenv("PODVOICE_RELEASE_TIMEOUT", raising=False)
    run_release(tmp_path, {}, "python", ScopeSnapshot("h", "b", (), "", ()))
    assert next(s for s in stages if s.name == "integration") == dev_cycle.integration_stage(
        "python", 240
    )
    assert next(s for s in stages if s.name == "unit") == unit_stage("python", 240)


@pytest.mark.parametrize("failure", [None, 1, 2])
def test_integration_worker_serializes_joins_and_preserves_first_failure(
    monkeypatch, tmp_path, capsys, failure
):
    from scripts import browser_gate

    batches = (("sdk.py",), ("other.py",))
    monkeypatch.setattr(dev_cycle, "integration_batches", lambda _: batches)
    monkeypatch.setattr(browser_gate, "group_exists", lambda _: False)
    started, processes = [], []
    identities = {}

    def launch(command, **kwargs):
        assert not processes or processes[-1].returncode is not None
        assert kwargs["cwd"] == tmp_path and kwargs["start_new_session"]
        assert command[1] == "-c"
        assert "os.execv(sys.executable" in command[2]
        assert command[3:6] == ("-q", "-x", "--tb=short")
        started.append(command)
        process = SimpleNamespace(pid=100 + len(started), returncode=None)
        identities[process.pid] = browser_gate.Identity(
            process.pid, os.getpid(), process.pid, (1, len(started)), os.getuid()
        )
        kwargs["stdout"].write(f"cohort-output-{len(started)}\n")

        def wait(*, timeout):
            assert timeout in (240, 2)
            process.returncode = 7 if len(started) == failure else 0
            return process.returncode

        process.wait = wait
        process.poll = lambda: process.returncode
        processes.append(process)
        return process

    monkeypatch.setattr(dev_cycle.subprocess, "Popen", launch)
    monkeypatch.setattr(dev_cycle, "_integration_identity", lambda pid: identities[pid])
    monkeypatch.setattr(
        dev_cycle.os, "killpg", lambda *args: pytest.fail("terminal child signaled")
    )
    if failure is None:
        dev_cycle.run_integration_batches(tmp_path, {}, "python", 240)
    else:
        with pytest.raises(DevCycleError, match=rf"cohort {failure} failed \(7\)"):
            dev_cycle.run_integration_batches(tmp_path, {}, "python", 240)
    assert len(started) == (failure or 2)
    assert f"cohort-output-{len(started)}" in capsys.readouterr().out


@pytest.mark.parametrize("changed", [None, "pid", "parent", "group", "born", "uid"])
def test_integration_cleanup_rejects_unknown_or_changed_native_identity(monkeypatch, changed):
    from dataclasses import replace

    from scripts import browser_gate

    admitted = browser_gate.Identity(123, os.getpid(), 123, (1, 2), os.getuid())
    current = (
        None
        if changed is None
        else replace(admitted, **{changed: (9, 9) if changed == "born" else 999})
    )
    process = SimpleNamespace(pid=123, poll=lambda: None)
    monkeypatch.setattr(dev_cycle, "_integration_identity", lambda _: current)
    monkeypatch.setattr(dev_cycle.os, "killpg", lambda *args: pytest.fail("unowned group signaled"))
    with pytest.raises(DevCycleError, match="identity changed"):
        dev_cycle._finish_integration_child(process, None if changed is None else admitted)


def test_terminal_surviving_leaderless_group_is_not_signaled(monkeypatch):
    from scripts import browser_gate

    process = SimpleNamespace(pid=123, poll=lambda: 0, wait=lambda **kwargs: 0)
    clock = iter([0, 5])
    monkeypatch.setattr(dev_cycle.time, "monotonic", lambda: next(clock))
    monkeypatch.setattr(browser_gate, "group_exists", lambda _: True)
    monkeypatch.setattr(
        dev_cycle.os, "killpg", lambda *args: pytest.fail("leaderless group signaled")
    )
    with pytest.raises(DevCycleError, match="group remains"):
        dev_cycle._finish_integration_child(process, None)


@pytest.mark.parametrize("exit_code", [0, 7])
def test_integration_cancel_at_terminal_join_preserves_failure_and_prevents_next_cohort(
    monkeypatch, tmp_path, capsys, exit_code
):
    from scripts import browser_gate

    monkeypatch.setattr(dev_cycle, "integration_batches", lambda _: (("sdk.py",), ("other.py",)))
    monkeypatch.setattr(browser_gate, "group_exists", lambda _: False)
    process = SimpleNamespace(pid=123, returncode=None)
    joined, started = [], []
    original = signal.getsignal(signal.SIGTERM)

    def wait(*, timeout):
        if timeout == 240:
            process.returncode = exit_code
        else:
            joined.append(process.pid)
            signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
        return process.returncode

    process.wait = wait
    process.poll = lambda: process.returncode

    def launch(command, **kwargs):
        started.append(command)
        kwargs["stdout"].write("terminal-primary-output\n")
        return process

    monkeypatch.setattr(dev_cycle.subprocess, "Popen", launch)
    monkeypatch.setattr(
        dev_cycle,
        "_integration_identity",
        lambda _: browser_gate.Identity(123, os.getpid(), 123, (1, 2), os.getuid()),
    )
    monkeypatch.setattr(
        dev_cycle.os, "killpg", lambda *args: pytest.fail("terminal child signaled")
    )
    pattern = r"failed \(7\)" if exit_code else "interrupted"
    with pytest.raises(DevCycleError, match=pattern):
        dev_cycle.run_integration_batches(tmp_path, {}, "python", 240)
    assert len(started) == 1 and joined == [123]
    assert "terminal-primary-output" in capsys.readouterr().out
    assert signal.getsignal(signal.SIGTERM) == original


def test_integration_timeout_joins_actual_stubborn_child_and_same_group_descendant(
    monkeypatch, tmp_path, capsys
):
    from scripts import browser_gate

    monkeypatch.setattr(dev_cycle, "integration_batches", lambda _: (("sdk.py",), ("other.py",)))
    worker = tmp_path / "fake-python"
    worker.write_text(
        f"#!{sys.executable}\n"
        "import os,signal,subprocess,sys,time\n"
        "from pathlib import Path\n"
        "signal.pthread_sigmask(signal.SIG_UNBLOCK,{signal.SIGTERM,signal.SIGINT})\n"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN)\n"
        "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)'])\n"
        "def reap(sig,frame):\n"
        " try: os.waitpid(child.pid,os.WNOHANG)\n"
        " except ChildProcessError: pass\n"
        "signal.signal(signal.SIGCHLD,reap)\n"
        "Path('child.pid').write_text(str(child.pid))\n"
        "Path('child.group').write_text(str(os.getpgid(child.pid)))\n"
        "print('owned-child-started',flush=True)\n"
        "time.sleep(30)\n"
    )
    worker.chmod(0o755)
    processes = []
    custody = []
    original_popen = subprocess.Popen

    def launch(*args, **kwargs):
        process = original_popen(*args, **kwargs)
        processes.append(process)
        receipt = {"process": process, "leader": None, "descendant": None}
        custody.append(receipt)
        receipt["leader"] = browser_gate.identity(process.pid)
        leader = receipt["leader"]
        assert leader is not None and leader.parent == os.getpid()
        assert leader.group == process.pid and leader.uid == os.getuid()
        deadline = time.monotonic() + 1
        while receipt["descendant"] is None and time.monotonic() < deadline:
            path = tmp_path / "child.pid"
            if path.exists():
                raw = path.read_text()
                if raw.isdecimal():
                    child = browser_gate.identity(int(raw))
                    if child is not None:
                        assert child.parent == leader.pid and child.group == leader.group
                        assert child.uid == leader.uid
                        receipt["descendant"] = child
            if receipt["descendant"] is None:
                time.sleep(0.005)
        assert receipt["descendant"] is not None, "fixture descendant custody was not admitted"
        return process

    monkeypatch.setattr(dev_cycle.subprocess, "Popen", launch)
    try:
        started = time.monotonic()
        with pytest.raises(DevCycleError, match="cohort 1 timed out after 1s"):
            dev_cycle.run_integration_batches(tmp_path, os.environ.copy(), str(worker), 1)
        assert time.monotonic() - started < 7
        assert len(processes) == 1 and processes[0].returncode == -signal.SIGKILL
        assert int((tmp_path / "child.group").read_text()) == processes[0].pid
        assert browser_gate.identity(int((tmp_path / "child.pid").read_text())) is None
        assert not browser_gate.group_exists(processes[0].pid)
        assert "owned-child-started" in capsys.readouterr().out
    finally:
        _rescue_integration_fixture(custody)


def test_integration_worker_live_cancel_joins_actual_child_before_return(monkeypatch, tmp_path):
    from scripts import browser_gate

    monkeypatch.setattr(dev_cycle, "integration_batches", lambda _: (("sdk.py",), ("other.py",)))
    worker = tmp_path / "fake-python"
    worker.write_text(
        f"#!{sys.executable}\nimport os,signal,time\n"
        "signal.pthread_sigmask(signal.SIG_UNBLOCK,{signal.SIGTERM,signal.SIGINT})\n"
        "os.kill(os.getppid(),signal.SIGTERM)\ntime.sleep(30)\n"
    )
    worker.chmod(0o755)
    processes = []
    custody = []
    real_popen = subprocess.Popen

    def launch(*args, **kwargs):
        process = real_popen(*args, **kwargs)
        processes.append(process)
        receipt = {"process": process, "leader": None, "descendant": None}
        custody.append(receipt)
        receipt["leader"] = browser_gate.identity(process.pid)
        leader = receipt["leader"]
        assert leader is not None and leader.parent == os.getpid()
        assert leader.group == process.pid and leader.uid == os.getuid()
        return process

    monkeypatch.setattr(dev_cycle.subprocess, "Popen", launch)
    try:
        with pytest.raises(DevCycleError, match="interrupted by signal"):
            dev_cycle.run_integration_batches(tmp_path, os.environ.copy(), str(worker), 120)
        assert len(processes) == 1 and processes[0].returncode == -signal.SIGKILL
        assert not browser_gate.group_exists(processes[0].pid)
    finally:
        _rescue_integration_fixture(custody)


def test_integration_rechecks_native_birth_before_escalating_signal(monkeypatch):
    from dataclasses import replace

    from scripts import browser_gate

    admitted = browser_gate.Identity(123, os.getpid(), 123, (1, 2), os.getuid())
    readings = iter([admitted, replace(admitted, born=(9, 9))])
    monkeypatch.setattr(dev_cycle, "_integration_identity", lambda _: next(readings))
    delivered = []
    monkeypatch.setattr(dev_cycle.os, "killpg", lambda group, sig: delivered.append((group, sig)))

    def wait(**kwargs):
        raise subprocess.TimeoutExpired("owned-child", 2)

    process = SimpleNamespace(pid=123, poll=lambda: None, wait=wait)
    with pytest.raises(DevCycleError, match="identity changed"):
        dev_cycle._finish_integration_child(process, admitted)
    assert delivered == [(123, signal.SIGTERM)]


def test_integration_actual_child_exec_restores_signals_and_canonical_import_context(
    monkeypatch, tmp_path
):
    from scripts import browser_gate

    directory = tmp_path / "tests/integration"
    directory.mkdir(parents=True)
    (tmp_path / "podvoice").mkdir()
    (tmp_path / "podvoice/canonical_fixture.py").write_text("VALUE=42\n")
    (tmp_path / "pyproject.toml").write_text(
        '[tool.pytest.ini_options]\npythonpath=["podvoice","tests"]\n'
    )
    (directory / "test_thin_live_ten_cycles.py").write_text(
        "import signal\nfrom canonical_fixture import VALUE\n"
        "def test_unmasked():\n"
        " assert VALUE == 42\n"
        " assert not {signal.SIGTERM,signal.SIGINT} & signal.pthread_sigmask(signal.SIG_BLOCK,[])\n"
    )
    (directory / "test_other.py").write_text("def test_other(): assert True\n")
    processes = []
    real_popen = subprocess.Popen

    def launch(*args, **kwargs):
        process = real_popen(*args, **kwargs)
        processes.append(process)
        return process

    monkeypatch.setattr(dev_cycle.subprocess, "Popen", launch)
    dev_cycle.run_integration_batches(tmp_path, os.environ.copy(), sys.executable, 15)
    assert len(processes) == 2
    assert all(p.returncode == 0 and not browser_gate.group_exists(p.pid) for p in processes)


def test_integration_actual_file_entry_runs_both_cohorts_without_nested_gate(monkeypatch, tmp_path):
    root = Path(__file__).parents[2]
    for name in ("scripts/__init__.py", "scripts/dev_cycle.py", "scripts/browser_gate.py"):
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((root / name).read_bytes())
    directory = tmp_path / "tests/integration"
    directory.mkdir(parents=True)
    for name in ("test_thin_live_ten_cycles.py", "test_other.py"):
        (directory / name).write_text("def test_one(): assert True\n")
    # No .git, external storage/cache or GateLock preflight is needed by the
    # internal worker: its sole authoritative parent already admitted them.
    env = os.environ.copy()
    env.pop("PYTHONPATH", None)
    result = subprocess.run(
        [
            sys.executable,
            "scripts/dev_cycle.py",
            "integration-worker",
            "--integration-timeout",
            "15",
        ],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=35,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "integration cohort 1: 1 modules, 15s bound" in result.stdout
    assert "integration cohort 2: 1 modules, 15s bound" in result.stdout
    assert "nested" not in result.stderr and "stopped" not in result.stderr


def test_outer_stage_cancel_kills_and_joins_separately_grouped_integration_child(tmp_path):
    from scripts import browser_gate

    root = Path(__file__).parents[2]
    for name in ("scripts/__init__.py", "scripts/dev_cycle.py", "scripts/browser_gate.py"):
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((root / name).read_bytes())
    directory = tmp_path / "tests/integration"
    directory.mkdir(parents=True)
    (directory / "test_thin_live_ten_cycles.py").write_text(
        "import os,signal,time\nfrom pathlib import Path\n"
        "def test_held():\n"
        " signal.signal(signal.SIGTERM,signal.SIG_IGN)\n"
        " Path('held.pid').write_text(str(os.getpid()))\n"
        " time.sleep(30)\n"
    )
    (directory / "test_other.py").write_text(
        "from pathlib import Path\n"
        "def test_never_reached(): Path('second.started').write_text('unsafe')\n"
    )
    env = os.environ.copy()
    env.pop("PYTHONPATH", None)
    child_identity = None
    with subprocess.Popen(
        [
            sys.executable,
            "scripts/dev_cycle.py",
            "integration-worker",
            "--integration-timeout",
            "120",
        ],
        cwd=tmp_path,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=True,
    ) as worker:
        try:
            deadline = time.monotonic() + 15
            while not (tmp_path / "held.pid").exists() and time.monotonic() < deadline:
                assert worker.poll() is None
                time.sleep(0.01)
            assert (tmp_path / "held.pid").exists(), "actual pytest child did not enter"
            child_pid = int((tmp_path / "held.pid").read_text())
            child_identity = browser_gate.identity(child_pid)
            assert child_identity is not None
            assert child_identity.parent == worker.pid and child_identity.group == child_pid
            dev_cycle._stop_process_group(worker)
            assert worker.returncode == 2  # Handler cleanup finished before outer KILL.
            assert browser_gate.identity(child_pid) is None
            assert not browser_gate.group_exists(child_pid)
            assert not (tmp_path / "second.started").exists()
            output = worker.communicate(timeout=2)[0]
            assert "integration worker interrupted by signal" in output
        finally:
            dev_cycle._stop_process_group(worker)
            # Fixture custody can rescue only its exact admitted native leader
            # after the original worker is terminal; it cannot satisfy any
            # assertion above or authorize a stale/unknown/leaderless signal.
            if child_identity is not None and worker.poll() is not None:
                current = browser_gate.identity(child_identity.pid)
                if current is not None and (
                    current.pid,
                    current.group,
                    current.born,
                    current.uid,
                ) == (
                    child_identity.pid,
                    child_identity.group,
                    child_identity.born,
                    child_identity.uid,
                ):
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(current.group, signal.SIGKILL)


def test_cancel_during_cleanup_delivers_owned_kill_before_outer_two_second_deadline(
    monkeypatch, tmp_path
):
    from scripts import browser_gate

    monkeypatch.setattr(dev_cycle, "integration_batches", lambda _: (("sdk.py",), ("other.py",)))
    admitted = browser_gate.Identity(123, os.getpid(), 123, (1, 2), os.getuid())
    process = SimpleNamespace(pid=123, returncode=None)
    process.poll = lambda: process.returncode
    delivered, started = [], []

    def wait(*, timeout):
        raise subprocess.TimeoutExpired("actual-cohort", timeout)

    process.wait = wait

    def launch(command, **kwargs):
        started.append(command)
        return process

    def kill(group, sig):
        delivered.append((group, sig))
        process.returncode = -sig

    def finish(child, captured):
        assert child is process and captured == admitted
        signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
        # Source handler must signal immediately, before cleanup can block
        # waiting and before the unchanged outer2s owner could kill worker.
        assert delivered == [(123, signal.SIGKILL)]
        assert process.returncode == -signal.SIGKILL

    monkeypatch.setattr(dev_cycle.subprocess, "Popen", launch)
    monkeypatch.setattr(dev_cycle, "_integration_identity", lambda _: admitted)
    monkeypatch.setattr(dev_cycle, "_finish_integration_child", finish)
    monkeypatch.setattr(dev_cycle.os, "killpg", kill)
    with pytest.raises(DevCycleError, match="cohort 1 timed out after 120s"):
        dev_cycle.run_integration_batches(tmp_path, {}, "python", 120)
    assert len(started) == 1


def _rescue_integration_fixture(custody):
    """Independent fixture custody after assertions; never substitute gate proof."""
    from scripts import browser_gate

    primary = sys.exception()
    errors = []
    for receipt in custody:
        process, admitted = receipt["process"], receipt["leader"]
        deadline = time.monotonic() + 4
        try:
            for sig in (signal.SIGTERM, signal.SIGKILL):
                if process.poll() is not None:
                    break
                current = browser_gate.identity(process.pid)
                if admitted is None or current != admitted:
                    raise RuntimeError("fixture rescue refused unknown/reused leader")
                try:
                    os.killpg(current.group, sig)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=min(2, max(0, deadline - time.monotonic())))
                except subprocess.TimeoutExpired:
                    if sig == signal.SIGKILL:
                        raise RuntimeError("fixture leader did not join after KILL") from None
            process.wait(timeout=max(0, deadline - time.monotonic()))
            child = receipt["descendant"]
            if child is not None:
                current = browser_gate.identity(child.pid)
                if current is not None:
                    # A retained individual PID may be adopted only after its
                    # original Popen parent is terminal. This grants no signal
                    # authority over a surviving leaderless process GROUP.
                    if (current.pid, current.group, current.born, current.uid) != (
                        child.pid,
                        child.group,
                        child.born,
                        child.uid,
                    ):
                        raise RuntimeError("fixture descendant identity changed; signal refused")
                    try:
                        os.kill(current.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                while browser_gate.identity(child.pid) is not None and time.monotonic() < deadline:
                    time.sleep(0.005)
                if browser_gate.identity(child.pid) is not None:
                    raise RuntimeError("fixture descendant did not become terminal")
            while browser_gate.group_exists(process.pid) and time.monotonic() < deadline:
                time.sleep(0.005)
            if browser_gate.group_exists(process.pid):
                raise RuntimeError("fixture group survives; unknown/leaderless signal refused")
        except Exception as exc:
            errors.append(exc)
        finally:
            # Joining our retained Popen is always attempted, including when
            # native authority rejects a signal. A failed join stays a finding.
            try:
                process.wait(timeout=max(0, deadline - time.monotonic()))
            except Exception as exc:
                errors.append(exc)
    if errors:
        if primary is not None:
            for exc in errors:
                primary.add_note(f"independent fixture rescue: {exc}")
                print(f"independent fixture rescue: {exc}")
        else:
            raise RuntimeError("independent fixture rescue incomplete") from errors[0]


@pytest.mark.parametrize("cancel_during_cleanup", [False, True])
def test_integration_signal_denial_preserves_primary_timeout_and_stops_next_cohort(
    monkeypatch, tmp_path, capsys, cancel_during_cleanup
):
    from scripts import browser_gate

    monkeypatch.setattr(dev_cycle, "integration_batches", lambda _: (("sdk.py",), ("other.py",)))
    process = SimpleNamespace(pid=123, returncode=None)
    process.poll = lambda: process.returncode

    def wait(*, timeout):
        raise subprocess.TimeoutExpired("owned-child", timeout)

    process.wait = wait
    admitted = browser_gate.Identity(123, os.getpid(), 123, (1, 2), os.getuid())
    started = []

    def launch(command, **kwargs):
        started.append(command)
        kwargs["stdout"].write("timeout-before-cleanup-denial\n")
        return process

    def denied(group, sig):
        raise PermissionError("native signal denied")

    monkeypatch.setattr(dev_cycle.subprocess, "Popen", launch)
    monkeypatch.setattr(dev_cycle, "_integration_identity", lambda _: admitted)
    monkeypatch.setattr(dev_cycle.os, "killpg", denied)
    if cancel_during_cleanup:
        actual_finish = dev_cycle._finish_integration_child

        def finish(child, owner):
            signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
            actual_finish(child, owner)

        monkeypatch.setattr(dev_cycle, "_finish_integration_child", finish)
    with pytest.raises(DevCycleError, match="cohort 1 timed out after 120s") as error:
        dev_cycle.run_integration_batches(tmp_path, {}, "python", 120)
    assert len(started) == 1 and process.returncode is None
    assert any("child signal failed" in note for note in error.value.__notes__)
    if cancel_during_cleanup:
        assert any("cancellation signal failed" in note for note in error.value.__notes__)
    assert "timeout-before-cleanup-denial" in capsys.readouterr().out


@pytest.mark.parametrize(
    "fixture_name",
    [
        "test_integration_timeout_joins_actual_stubborn_child_and_same_group_descendant",
        "test_integration_worker_live_cancel_joins_actual_child_before_return",
    ],
)
def test_fixture_native_admission_error_retains_popen_and_attempts_bounded_join(
    monkeypatch, tmp_path, capsys, fixture_name
):
    from scripts import browser_gate

    process = SimpleNamespace(pid=123, returncode=None)
    process.poll = lambda: process.returncode
    waits, starts, signals = [], [], []

    def wait(*, timeout):
        waits.append(timeout)
        raise subprocess.TimeoutExpired("unknown-inert-fixture", timeout)

    process.wait = wait

    def launch(*args, **kwargs):
        starts.append(args)
        return process

    def failed_identity(_pid):
        raise RuntimeError("fixture native reader failed after Popen")

    def forbidden_signal(*args):
        signals.append(args)
        pytest.fail("unknown fixture identity granted signal authority")

    monkeypatch.setattr(dev_cycle.subprocess, "Popen", launch)
    monkeypatch.setattr(browser_gate, "identity", failed_identity)
    monkeypatch.setattr(dev_cycle.os, "killpg", forbidden_signal)
    monkeypatch.setattr(dev_cycle.os, "kill", forbidden_signal)
    fixture = globals()[fixture_name]
    with pytest.raises(RuntimeError, match="native reader failed after Popen") as error:
        if "descendant" in fixture_name:
            fixture(monkeypatch, tmp_path, capsys)
        else:
            fixture(monkeypatch, tmp_path)
    assert len(starts) == 1 and len(waits) == 1 and 0 <= waits[0] <= 4
    assert not signals and process.returncode is None
    assert any("independent fixture rescue" in note for note in error.value.__notes__)


def test_known_native_disappearance_still_joins_retained_popen_without_new_signal(monkeypatch):
    from scripts import browser_gate

    admitted = browser_gate.Identity(123, os.getpid(), 123, (1, 2), os.getuid())
    process = SimpleNamespace(pid=123, returncode=None)
    observed = []

    def poll():
        observed.append(("poll", None))
        return None

    def native(pid):
        assert pid == process.pid
        observed.append(("native", None))
        return None

    def wait(*, timeout):
        observed.append(("wait", timeout, -signal.SIGKILL))
        process.returncode = -signal.SIGKILL
        return process.returncode

    process.poll, process.wait = poll, wait
    monkeypatch.setattr(dev_cycle, "_integration_identity", native)
    monkeypatch.setattr(browser_gate, "group_exists", lambda _: False)
    monkeypatch.setattr(
        dev_cycle.os, "killpg", lambda *args: pytest.fail("new signal after native disappearance")
    )
    dev_cycle._finish_integration_child(process, admitted)
    assert observed == [("poll", None), ("native", None), ("wait", 2, -signal.SIGKILL)]
    assert process.returncode == -signal.SIGKILL


def test_cancellation_native_gap_joins_child_and_preserves_original_interruption(
    monkeypatch, tmp_path
):
    from scripts import browser_gate

    admitted = browser_gate.Identity(123, os.getpid(), 123, (1, 2), os.getuid())
    identities = iter([admitted, admitted, None])
    process = SimpleNamespace(pid=123, returncode=None)
    started, signals, joins = [], [], []
    process.poll = lambda: None

    def wait(*, timeout):
        if timeout == 120:
            signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
            pytest.fail("cancellation did not interrupt original wait")
        assert timeout == 2
        joins.append(process.pid)
        process.returncode = -signal.SIGKILL
        return process.returncode

    process.wait = wait

    def launch(command, **kwargs):
        started.append(command)
        return process

    monkeypatch.setattr(dev_cycle, "integration_batches", lambda _: (("sdk.py",), ("other.py",)))
    monkeypatch.setattr(dev_cycle.subprocess, "Popen", launch)
    monkeypatch.setattr(dev_cycle, "_integration_identity", lambda _: next(identities))
    monkeypatch.setattr(dev_cycle.os, "killpg", lambda group, sig: signals.append((group, sig)))
    monkeypatch.setattr(browser_gate, "group_exists", lambda _: False)
    with pytest.raises(DevCycleError, match="integration worker interrupted by signal 15") as error:
        dev_cycle.run_integration_batches(tmp_path, {}, "python", 120)
    assert len(started) == 1 and joins == [123]
    assert signals == [(123, signal.SIGKILL)]
    assert process.returncode == -signal.SIGKILL
    assert not getattr(error.value, "__notes__", [])
