#!/usr/bin/env python3
"""Fast, fail-fast local feedback without changing the release gate."""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

COLLECTION_TIMEOUT_S = 15
FAST_TIMEOUT_S = 120
RELEASE_TIMEOUT_S = 240
UNIT_BATCH_COUNT = 8
REST_BATCH_COUNT = 2
INTEGRATION_COHORT_COUNT = 2
INTEGRATION_SDK_MODULE = "tests/integration/test_thin_live_ten_cycles.py"
GATE_CACHE_STAGES = frozenset(
    {
        "ruff",
        "format",
        "mypy",
        "unit",
        "integration",
        "pytest",
        "candidate-scope",
        "ruff-format",
        "ui-browser",
    }
)
RELEASE_CONTRACT = "tests/unit/test_release_contract.py"
FULL_SUITE_MARKER = "tests"
LIFECYCLE_SMOKE_MANIFEST = "scripts/lifecycle_smoke.txt"
LIFECYCLE_RUNTIME_FILES = frozenset(
    {
        "podvoice/gatekeeper/openai_realtime.py",
        "podvoice/gatekeeper/playback.py",
        "podvoice/gatekeeper/playout.py",
        "podvoice/gatekeeper/reply.py",
        "podvoice/gatekeeper/talk.py",
        "podvoice/gatekeeper/thin.py",
        "podvoice/gatekeeper/trace_oracle.py",
        "podvoice/gatekeeper/voice.py",
        "podvoice/gatekeeper/voicepe.py",
    }
)
LIFECYCLE_WORKFLOW_FILES = frozenset(
    {
        "scripts/__init__.py",
        "scripts/dev",
        "scripts/dev_cycle.py",
        "scripts/field_canary.py",
        LIFECYCLE_SMOKE_MANIFEST,
    }
)
LIFECYCLE_FIRMWARE_FILES = frozenset(
    {
        "esphome/podvoice.yaml",
        "esphome/voice-pe-podvoice-base.yaml",
    }
)


class DevCycleError(RuntimeError):
    """Expected, actionable development-loop failure."""


@dataclass(frozen=True)
class ScopeSnapshot:
    """Exact git/file scope that a gate evaluated."""

    head: str
    merge_base: str
    changes: tuple[str, ...]
    index_entries: str
    worktree_hashes: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class Stage:
    name: str
    command: tuple[str, ...]
    timeout: int


def unit_batches(root: Path) -> tuple[tuple[str, ...], ...]:
    """Collect every default pytest unit module once in deterministic batches."""
    files = sorted(
        path.relative_to(root).as_posix()
        for path in (root / "tests/unit").rglob("*.py")
        if path.name.startswith("test_") or path.name.endswith("_test.py")
    )
    if not files:
        raise DevCycleError("unit worker found no test modules")
    return tuple(
        tuple(files[index::UNIT_BATCH_COUNT]) for index in range(min(UNIT_BATCH_COUNT, len(files)))
    )


def run_ci_unit_shard(root: Path, env: dict[str, str], python: str, shard: int) -> int:
    """Run one existing deterministic partition on its own CI runner."""
    batches = unit_batches(root)
    if not 1 <= shard <= len(batches):
        raise DevCycleError(f"unit shard {shard} has no partition")
    batch = batches[shard - 1]
    print(f"CI unit shard {shard}/{len(batches)}: {len(batch)} modules", flush=True)
    return subprocess.call(
        (
            python,
            "-m",
            "pytest",
            "-v",
            "--maxfail=1",
            "-o",
            "faulthandler_timeout=60",
            *batch,
            "--durations=15",
            "--durations-min=1",
        ),
        cwd=root,
        env=env,
    )


def rest_test_batches(root: Path) -> tuple[tuple[str, ...], ...]:
    """Partition every non-unit, non-HA pytest module once in stable order."""
    files = sorted(
        path.relative_to(root).as_posix()
        for path in (root / "tests").rglob("*.py")
        if (path.name.startswith("test_") or path.name.endswith("_test.py"))
        and not path.relative_to(root).is_relative_to(Path("tests/unit"))
        and not path.relative_to(root).is_relative_to(Path("tests/ha_framework"))
    )
    if not files:
        raise DevCycleError("remaining-test worker found no test modules")
    return tuple(
        tuple(files[index::REST_BATCH_COUNT]) for index in range(min(REST_BATCH_COUNT, len(files)))
    )


def run_ci_rest_shard(root: Path, env: dict[str, str], python: str, shard: int) -> int:
    """Run one deterministic remainder partition with the original pytest options."""
    batches = rest_test_batches(root)
    if not 1 <= shard <= len(batches):
        raise DevCycleError(f"remaining-test shard {shard} has no partition")
    batch = batches[shard - 1]
    print(f"CI remaining-test shard {shard}/{len(batches)}: {len(batch)} modules", flush=True)
    return subprocess.call(
        (
            python,
            "-m",
            "pytest",
            "-v",
            "--maxfail=1",
            "-o",
            "faulthandler_timeout=60",
            *batch,
            "--durations=15",
            "--durations-min=1",
        ),
        cwd=root,
        env=env,
    )


def unit_stage(python: str, timeout: int) -> Stage:
    """One outer owner; each sequential pytest child retains its existing bound."""
    return Stage(
        "unit",
        (python, "scripts/dev_cycle.py", "unit-worker", "--unit-timeout", str(timeout)),
        UNIT_BATCH_COUNT * (timeout + 4) + COLLECTION_TIMEOUT_S,
    )


def run_unit_batches(root: Path, env: dict[str, str], python: str, timeout: int) -> None:
    """Release pytest's collected state between batches; stop at the first failure."""
    process: subprocess.Popen[str] | None = None

    def interrupted(signum: int, _frame: object) -> None:
        # Outer run_parallel owns this worker's group. Its child has a separate
        # group, so kill that group before the worker exits on cancellation.
        if process is not None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
        raise DevCycleError(f"unit worker interrupted by signal {signum}")

    previous_handlers = {
        sig: signal.signal(sig, interrupted) for sig in (signal.SIGTERM, signal.SIGINT)
    }
    try:
        for index, batch in enumerate(unit_batches(root), 1):
            command = (python, "-m", "pytest", "-q", "-x", "--tb=short", *batch)
            print(f"unit batch {index}: {len(batch)} modules, {timeout}s bound", flush=True)
            with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as output:
                try:
                    process = subprocess.Popen(
                        command,
                        cwd=root,
                        env=env,
                        text=True,
                        stdout=output,
                        stderr=subprocess.STDOUT,
                        start_new_session=True,
                    )
                    try:
                        result = process.wait(timeout=timeout)
                    except subprocess.TimeoutExpired as exc:
                        _stop_process_group(process)
                        raise DevCycleError(
                            f"unit batch {index} timed out after {timeout}s"
                        ) from exc
                    if result:
                        raise DevCycleError(f"unit batch {index} failed ({result})")
                finally:
                    if process is not None:
                        _stop_process_group(process)
                        with contextlib.suppress(ProcessLookupError):
                            os.killpg(process.pid, signal.SIGKILL)
                    process = None
                    output.seek(0)
                    for line in output.read().rstrip().splitlines():
                        print(f"[unit batch {index}] {line}", flush=True)
    finally:
        for sig, handler in previous_handlers.items():
            signal.signal(sig, handler)


def integration_batches(root: Path) -> tuple[tuple[str, ...], ...]:
    """Keep the actual ten-cycle module and exhaustive remainder in two cohorts."""
    files = sorted(
        path.relative_to(root).as_posix()
        for path in (root / "tests/integration").rglob("*.py")
        if path.name.startswith("test_") or path.name.endswith("_test.py")
    )
    if INTEGRATION_SDK_MODULE not in files:
        raise DevCycleError("integration worker requires the actual SDK ten-cycle module")
    remainder = tuple(path for path in files if path != INTEGRATION_SDK_MODULE)
    if not remainder:
        raise DevCycleError("integration worker requires a nonempty remainder cohort")
    return ((INTEGRATION_SDK_MODULE,), remainder)


def integration_stage(python: str, timeout: int) -> Stage:
    """One outer owner, two sequential children with unchanged individual bounds."""
    return Stage(
        "integration",
        (
            python,
            "scripts/dev_cycle.py",
            "integration-worker",
            "--integration-timeout",
            str(timeout),
        ),
        INTEGRATION_COHORT_COUNT * (timeout + 4) + COLLECTION_TIMEOUT_S,
    )


def _integration_identity(pid: int):
    # Reuse the native reader only; no browser/dependency process is launched.
    from scripts.browser_gate import BrowserGateError, identity

    try:
        return identity(pid)
    except BrowserGateError as exc:
        raise DevCycleError(str(exc)) from exc


def _finish_integration_child(process: subprocess.Popen[str], admitted) -> None:
    """Join the exact child; never signal an unknown, reused or leaderless group."""
    from scripts.browser_gate import group_exists

    def signal_owned(sig: int) -> None:
        current = _integration_identity(process.pid)
        if admitted is not None and current is None:
            # Native disappearance can precede a waitable exit after KILL.
            # Signal nothing; the retained Popen must still be joined below.
            return
        if admitted is None or current != admitted:
            raise DevCycleError("integration child identity changed; group signal refused")
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            pass
        except OSError as exc:
            raise DevCycleError(f"integration child signal failed: {exc}") from exc

    deadline = time.monotonic() + 4
    if process.poll() is None:
        signal_owned(signal.SIGTERM)
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            signal_owned(signal.SIGKILL)
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired as exc:
                raise DevCycleError("integration child did not join after SIGKILL") from exc
    else:
        process.wait(timeout=2)
    while group_exists(process.pid) and time.monotonic() < deadline:
        time.sleep(0.01)
    if group_exists(process.pid):
        # wait/poll may reap the leader. A surviving group is not new authority
        # to signal an unregistered descendant or a newly reused leader PID.
        raise DevCycleError("integration child group remains after terminal join; signal refused")


def run_integration_batches(root: Path, env: dict[str, str], python: str, timeout: int) -> None:
    """Run both complete cohorts serially; preserve failure and bounded cleanup."""
    batches = integration_batches(root)
    interrupted_by = None
    cancellation_failure = None
    cleaning = False
    process = None
    admitted = None

    def interrupted(signum: int, _frame: object) -> None:
        nonlocal interrupted_by, cancellation_failure
        interrupted_by = signum
        # The outer owner gives this worker only two seconds before KILL.
        # Stop its separately grouped child immediately, even during cleanup.
        if process is not None and process.poll() is None:
            current = _integration_identity(process.pid)
            if admitted is None or current != admitted:
                if not cleaning:
                    raise DevCycleError("integration cancellation identity changed; signal refused")
            else:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except OSError as exc:
                    error = DevCycleError(f"integration cancellation signal failed: {exc}")
                    if not cleaning:
                        raise error from exc
                    cancellation_failure = error
        if not cleaning:
            raise DevCycleError(f"integration worker interrupted by signal {signum}")

    watched = {signal.SIGTERM, signal.SIGINT}
    previous_handlers = {sig: signal.signal(sig, interrupted) for sig in watched}
    try:
        for index, batch in enumerate(batches, 1):
            cleaning = False
            if interrupted_by is not None:
                raise DevCycleError(f"integration worker interrupted by signal {interrupted_by}")
            process = None
            admitted = None
            failure = None
            started = time.monotonic()
            print(f"integration cohort {index}: {len(batch)} modules, {timeout}s bound", flush=True)
            with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as output:
                try:
                    # Cancellation cannot strand a spawned child before its
                    # Popen/native identity is retained by the cleanup owner.
                    previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, watched)
                    try:
                        process = subprocess.Popen(
                            (
                                python,
                                "-c",
                                "import os,signal,sys; "
                                "signal.pthread_sigmask(signal.SIG_UNBLOCK,{signal.SIGTERM,signal.SIGINT}); "
                                "os.execv(sys.executable,[sys.executable,'-m','pytest',*sys.argv[1:]])",
                                "-q",
                                "-x",
                                "--tb=short",
                                *batch,
                            ),
                            cwd=root,
                            env=env,
                            text=True,
                            stdout=output,
                            stderr=subprocess.STDOUT,
                            start_new_session=True,
                        )
                        admitted = _integration_identity(process.pid)
                        if admitted is None:
                            if process.poll() is None:
                                raise DevCycleError(
                                    "integration child admission identity is missing"
                                )
                        elif (
                            admitted.pid != process.pid
                            or admitted.parent != os.getpid()
                            or admitted.group != process.pid
                            or admitted.uid != os.getuid()
                        ):
                            admitted = None
                            raise DevCycleError("integration child admission identity is invalid")
                    finally:
                        signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)
                    try:
                        result = process.wait(timeout=timeout)
                    except subprocess.TimeoutExpired as exc:
                        raise DevCycleError(
                            f"integration cohort {index} timed out after {timeout}s"
                        ) from exc
                    if result:
                        raise DevCycleError(f"integration cohort {index} failed ({result})")
                except BaseException as exc:
                    failure = exc
                    raise
                finally:
                    cleaning = True
                    try:
                        if process is not None:
                            try:
                                _finish_integration_child(process, admitted)
                            except DevCycleError as exc:
                                if failure is None:
                                    raise
                                failure.add_note(f"integration cleanup: {exc}")
                                print(f"integration cleanup: {exc}", flush=True)
                        if cancellation_failure is not None:
                            if failure is None:
                                raise cancellation_failure
                            failure.add_note(f"integration cleanup: {cancellation_failure}")
                            print(f"integration cleanup: {cancellation_failure}", flush=True)
                    finally:
                        output.seek(0)
                        for line in output.read().rstrip().splitlines():
                            print(f"[integration cohort {index}] {line}", flush=True)
                        print(
                            f"integration cohort {index}: {time.monotonic() - started:.2f}s",
                            flush=True,
                        )
                    if interrupted_by is not None and failure is None:
                        raise DevCycleError(
                            f"integration worker interrupted by signal {interrupted_by}"
                        )
    finally:
        for sig, handler in previous_handlers.items():
            signal.signal(sig, handler)


def _stage_environment(env: dict[str, str], stage: str) -> dict[str, str]:
    """Give concurrent tools isolated caches under one persistent external root."""
    cache_root = configured_cache_root(env, Path.cwd())
    directories = cache_paths(cache_root, stage)
    stage_env = dict(env)
    for key, directory in (
        ("PYTHONPYCACHEPREFIX", directories["pycache"]),
        ("MYPY_CACHE_DIR", directories["mypy"]),
        ("RUFF_CACHE_DIR", directories["ruff"]),
    ):
        directory.mkdir(parents=True, exist_ok=True)
        stage_env[key] = str(directory)
    pytest_cache = directories["pytest"]
    pytest_cache.mkdir(parents=True, exist_ok=True)
    existing_pytest_options = stage_env.get("PYTEST_ADDOPTS", "").strip()
    cache_option = f"-o cache_dir={pytest_cache}"
    stage_env["PYTEST_ADDOPTS"] = " ".join(
        option for option in (existing_pytest_options, cache_option) if option
    )
    return stage_env


def _stop_process_group(process: subprocess.Popen[str]) -> None:
    """Stop a stage and every child it spawned; never leak a gate after failure."""
    if process.poll() is not None:
        return
    with contextlib.suppress(ProcessLookupError):
        os.killpg(process.pid, signal.SIGTERM)
    with contextlib.suppress(subprocess.TimeoutExpired):
        process.wait(timeout=2)
    if process.poll() is None:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
        with contextlib.suppress(subprocess.TimeoutExpired):
            process.wait(timeout=2)


def run_parallel(root: Path, env: dict[str, str], stages: Sequence[Stage]) -> None:
    """Run independent gates together and terminate siblings on the first failure."""
    if not stages:
        return
    running: dict[str, tuple[subprocess.Popen[str], TextIO, float, Stage]] = {}
    try:
        for stage in stages:
            stage_output: TextIO = tempfile.TemporaryFile(mode="w+", encoding="utf-8")
            process = subprocess.Popen(
                list(stage.command),
                cwd=root,
                env=_stage_environment(env, stage.name),
                text=True,
                stdout=stage_output,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            running[stage.name] = (process, stage_output, time.monotonic(), stage)

        while running:
            now = time.monotonic()
            for name, (process, captured_file, started, stage) in list(running.items()):
                elapsed = now - started
                if process.poll() is None and elapsed <= stage.timeout:
                    continue
                if process.poll() is None:
                    _stop_process_group(process)
                    failure: str | None = f"timed out after {stage.timeout}s"
                else:
                    failure = None if process.returncode == 0 else f"failed ({process.returncode})"
                captured_file.seek(0)
                captured = captured_file.read()
                if captured:
                    for line in captured.rstrip().splitlines():
                        print(f"[{name}] {line}", flush=True)
                captured_file.close()
                del running[name]
                print(f"{name}: {elapsed:.2f}s", flush=True)
                if failure is not None:
                    for (
                        sibling,
                        sibling_output,
                        _sibling_started,
                        _sibling_stage,
                    ) in running.values():
                        _stop_process_group(sibling)
                        sibling_output.close()
                    running.clear()
                    raise DevCycleError(f"{name} {failure}: {' '.join(stage.command)}")
            if running:
                time.sleep(0.02)
    finally:
        for process, captured_file, _started, _stage in running.values():
            _stop_process_group(process)
            captured_file.close()


def _run(
    command: Sequence[str],
    *,
    cwd: Path,
    env: dict[str, str],
    timeout: int,
    capture: bool = False,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            list(command),
            cwd=cwd,
            env=env,
            text=True,
            check=True,
            timeout=timeout,
            capture_output=capture,
        )
    except subprocess.TimeoutExpired as exc:
        rendered = " ".join(command)
        raise DevCycleError(f"timed out after {timeout}s: {rendered}") from exc
    except subprocess.CalledProcessError as exc:
        if capture:
            if exc.stdout:
                print(exc.stdout, end="", file=sys.stdout)
            if exc.stderr:
                print(exc.stderr, end="", file=sys.stderr)
        raise DevCycleError(f"command failed ({exc.returncode}): {' '.join(command)}") from exc


def _git(root: Path, *args: str, timeout: int = COLLECTION_TIMEOUT_S) -> str:
    result = _run(
        ["git", "-c", "core.quotepath=false", *args],
        cwd=root,
        env=os.environ.copy(),
        timeout=timeout,
        capture=True,
    )
    return result.stdout


def repository_root(start: Path) -> Path:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=start,
            text=True,
            capture_output=True,
            timeout=COLLECTION_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired as exc:
        raise DevCycleError(
            "git root lookup timed out; move the checkout off synchronized storage"
        ) from exc
    if result.returncode:
        raise DevCycleError("run this command inside a PodVoice git checkout")
    return Path(result.stdout.strip()).resolve()


def default_cache_root() -> Path:
    return Path.home() / ".cache" / "podvoice-dev"


def configured_cache_root(env: Mapping[str, str], root: Path) -> Path:
    """Use the same actual expanded/anchored directory for admission and writes."""
    try:
        path = Path(env.get("PODVOICE_DEV_CACHE", str(default_cache_root()))).expanduser()
        return (path if path.is_absolute() else root / path).resolve()
    except (OSError, RuntimeError) as exc:
        raise DevCycleError("cannot resolve the configured gate cache") from exc


def cache_paths(cache: Path, stage: str | None = None) -> dict[str, Path]:
    """Declared owner directories, shared by admission and actual cache writes."""
    directories = {
        owner: cache / owner
        for owner in ("pycache", "mypy", "ruff", "pytest", "preflight", "browser", "browser-proof")
    }
    if stage is not None:
        safe_stage = stage.replace("/", "-").replace(" ", "-")
        for owner in ("pycache", "mypy", "ruff", "pytest", "browser", "browser-proof"):
            directories[owner] /= safe_stage
    return directories


def validate_cache_storage(cache: Path) -> None:
    require_durable_storage(cache, "gate cache")
    for owner, directory in cache_paths(cache).items():
        require_durable_storage(directory, f"{owner} cache")
    for stage in sorted(GATE_CACHE_STAGES):
        for owner, directory in cache_paths(cache, stage).items():
            require_durable_storage(directory, f"{stage} {owner} cache")


def temporary_storage_roots() -> tuple[Path, ...]:
    return tuple(
        Path(name).resolve()
        for name in ("/tmp", "/var/tmp", "/var/folders", "/run", "/dev/shm", tempfile.gettempdir())
    )


def require_durable_storage(path: Path, owner: str) -> Path:
    try:
        resolved = path.resolve()
    except (OSError, RuntimeError) as exc:
        raise DevCycleError(f"cannot resolve {owner} storage: {path}") from exc
    parts = tuple(part.casefold() for part in resolved.parts)
    if any(
        part in {"documents", "desktop", "icloud drive", "mobile documents", "cloudstorage"}
        or part.startswith(("onedrive", "dropbox", "googledrive", "google drive"))
        for part in parts
    ):
        raise DevCycleError(
            f"{owner} uses synchronized storage: {resolved}; use durable local storage"
        )
    if any(resolved.is_relative_to(boundary) for boundary in temporary_storage_roots()):
        raise DevCycleError(
            f"{owner} uses temporary storage: {resolved}; use durable local storage"
        )
    return resolved


def validate_gate_storage(root: Path, configured_python: str, cache: Path) -> None:
    """Check actual gate dependencies before any cache, lock or stage is started."""
    root = require_durable_storage(root, "checkout")
    validate_cache_storage(cache)
    common = Path(_git(root, "rev-parse", "--path-format=absolute", "--git-common-dir").strip())
    require_durable_storage(common, "common Git")
    objects = Path(
        _git(root, "rev-parse", "--path-format=absolute", "--git-path", "objects").strip()
    )
    pending = [(objects, frozenset())]
    inherited = os.environ.get("GIT_ALTERNATE_OBJECT_DIRECTORIES", "")
    if inherited:
        if '"' in inherited or "\\" in inherited:
            raise DevCycleError("quoted inherited Git object alternates cannot be verified")
        pending.extend(
            (Path(name) if Path(name).is_absolute() else root / name, frozenset())
            for name in inherited.split(os.pathsep)
            if name
        )
    visited: set[Path] = set()
    while pending:
        path, ancestors = pending.pop()
        objects = require_durable_storage(path, "Git objects")
        if objects in ancestors:
            raise DevCycleError("cyclic Git object alternates cannot be verified")
        if objects in visited:
            continue
        if len(visited) >= 32 or len(ancestors) >= 16:
            raise DevCycleError("Git object alternates exceed the bounded storage inspection")
        visited.add(objects)
        if not objects.is_dir():
            raise DevCycleError(f"Git objects directory is unavailable: {objects}")
        alternate_file = objects / "info" / "alternates"
        require_durable_storage(alternate_file, "Git alternates file")
        if (
            alternate_file.exists() or alternate_file.is_symlink()
        ) and not alternate_file.is_file():
            raise DevCycleError("Git object alternates must be a regular file")
        if alternate_file.is_file():
            try:
                with alternate_file.open(encoding="utf-8") as handle:
                    alternate_text = handle.read(65537)
            except (OSError, UnicodeError) as exc:
                raise DevCycleError("cannot read Git object alternates") from exc
            if len(alternate_text) > 65536:
                raise DevCycleError("Git object alternates exceed the bounded storage inspection")
            for line in alternate_text.splitlines():
                if not line:
                    continue
                if line.startswith('"'):
                    try:
                        line = json.loads(line)
                    except (ValueError, TypeError) as exc:
                        raise DevCycleError(
                            "quoted Git object alternate cannot be verified"
                        ) from exc
                    if not isinstance(line, str):
                        raise DevCycleError("Git object alternate must be a path")
                target = Path(line)
                if not target.is_absolute():
                    target = objects / target
                pending.append((target, ancestors | {objects}))
    # Resolve the bin directory, never the executable's symlink into Homebrew.
    python_path = Path(configured_python).expanduser()
    if not python_path.is_absolute():
        python_path = root / python_path
    venv_root = require_durable_storage(python_path.parent, "Python venv").parent
    if venv_root.is_relative_to(root):
        raise DevCycleError("gate Python venv must be external to the checkout")
    config = require_durable_storage(venv_root / "pyvenv.cfg", "Python venv config")
    if not config.is_file():
        raise DevCycleError(f"gate Python must belong to an external venv: {python_path}")
    if not python_path.is_file() or not os.access(python_path, os.X_OK):
        raise DevCycleError(f"selected external venv Python is not executable: {python_path}")
    prefix = _run(
        [
            str(python_path),
            "-c",
            "import json,sys; print(json.dumps([sys.prefix,sys.base_prefix]))",
        ],
        cwd=root,
        env=os.environ.copy(),
        timeout=5,
        capture=True,
    ).stdout.strip()
    try:
        active, base = json.loads(prefix)
        valid = Path(active).resolve() == venv_root and active != base
    except (ValueError, TypeError, OSError, RuntimeError) as exc:
        raise DevCycleError("could not verify the selected external Python venv") from exc
    if not valid:
        raise DevCycleError("selected Python does not execute in the declared external venv")


def tool_environment(root: Path) -> tuple[dict[str, str], str]:
    cache_root = configured_cache_root(os.environ, root)
    directories = cache_paths(cache_root)
    pycache = directories["pycache"]
    mypy_cache = directories["mypy"]
    pycache.mkdir(parents=True, exist_ok=True)
    mypy_cache.mkdir(parents=True, exist_ok=True)

    configured_python = os.environ.get("PODVOICE_PYTHON")
    local_python = root / ".venv" / "bin" / "python"
    if configured_python:
        configured_path = Path(configured_python).expanduser()
        python_path = configured_path if configured_path.is_absolute() else root / configured_path
    elif local_python.is_file():
        python_path = local_python
    else:
        raise DevCycleError(
            "no project Python configured; set PODVOICE_PYTHON to a Python 3.12 venv executable"
        )
    if not python_path.is_file() or not os.access(python_path, os.X_OK):
        raise DevCycleError(f"PODVOICE_PYTHON is not executable: {python_path}")
    python = str(python_path)

    env = os.environ.copy()
    env["PODVOICE_DEV_CACHE"] = str(cache_root)
    env["PYTHONPYCACHEPREFIX"] = str(pycache)
    env["MYPY_CACHE_DIR"] = str(mypy_cache)
    env.pop("PYTHONDONTWRITEBYTECODE", None)
    return env, python


def sibling_tool(python: str, name: str) -> str:
    candidate = Path(python).parent / name
    if not candidate.is_file() or not os.access(candidate, os.X_OK):
        raise DevCycleError(
            f"missing {name} beside {python}; install both requirements files in that venv"
        )
    return str(candidate)


def preflight_fingerprint(root: Path, python: str, version: str) -> str:
    fingerprint = hashlib.sha256()
    fingerprint.update(str(Path(python).resolve()).encode())
    fingerprint.update(version.encode())
    for relative in (
        "pyproject.toml",
        "podvoice/requirements.txt",
        "podvoice/requirements-dev.txt",
        "scripts/dev_cycle.py",
    ):
        path = root / relative
        if path.is_file():
            fingerprint.update(relative.encode())
            fingerprint.update(path.read_bytes())
    return fingerprint.hexdigest()


class GateLock:
    """One machine-wide owner for pytest/mypy/git gate work."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or Path(
            os.environ.get(
                "PODVOICE_GATE_LOCK",
                str(Path(tempfile.gettempdir()) / "podvoice-dev-gate.lock"),
            )
        )
        self._handle: TextIO | None = None

    def __enter__(self) -> GateLock:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open("a+", encoding="utf-8")
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            handle.seek(0)
            owner = handle.read().strip() or "another development gate"
            handle.close()
            raise DevCycleError(f"gate already running: {owner}") from exc
        handle.seek(0)
        handle.truncate()
        handle.write(f"pid={os.getpid()} cwd={Path.cwd()} command={' '.join(sys.argv)}\n")
        handle.flush()
        self._handle = handle
        return self

    def __exit__(self, *_args: object) -> None:
        if self._handle is not None:
            fcntl.flock(self._handle.fileno(), fcntl.LOCK_UN)
            self._handle.close()
            self._handle = None


def preflight(root: Path, env: dict[str, str], python: str) -> list[str]:
    warnings: list[str] = []
    usage = shutil.disk_usage(root)
    free_pct = usage.free / usage.total * 100
    free_gib = usage.free / 1024**3
    if usage.free < 2 * 1024**3:
        raise DevCycleError(f"only {free_gib:.1f} GiB free; free disk space before running gates")
    if free_pct < 15 or free_gib < 15:
        warnings.append(
            f"low free disk: {free_gib:.1f} GiB ({free_pct:.1f}%); target at least 15% free"
        )

    version = _run(
        [python, "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
        cwd=root,
        env=env,
        timeout=5,
        capture=True,
    ).stdout.strip()
    if version != "3.12":
        raise DevCycleError(f"PodVoice gates require Python 3.12, selected toolchain is {version}")
    sibling_tool(python, "ruff")
    sibling_tool(python, "mypy")
    _git(root, "status", "--porcelain", "--untracked-files=no")
    # A preflight only needs to prove that representative repository files are
    # readable. Reading every tracked file made each gate hydrate the whole
    # checkout on synchronized storage and could consume the complete timeout
    # before any useful check started.
    probe_files = (
        "pyproject.toml",
        "scripts/dev_cycle.py",
        "podvoice/gatekeeper/thin.py",
    )
    read_probe = (
        "from pathlib import Path; import sys; "
        "[Path(p).open('rb').read(4096) for p in sys.argv[1:] if Path(p).is_file()]"
    )
    fingerprint = preflight_fingerprint(root, python, version)
    cache_file = cache_paths(configured_cache_root(env, root))["preflight"] / f"{fingerprint}.json"
    if not cache_file.is_file():
        _run(
            [python, "-c", read_probe, *probe_files],
            cwd=root,
            env=env,
            timeout=COLLECTION_TIMEOUT_S,
            capture=True,
        )
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = cache_file.with_suffix(f".{os.getpid()}.tmp")
        temporary.write_text(json.dumps({"python": version, "ok": True}), encoding="utf-8")
        temporary.replace(cache_file)
    write_probe = (
        "from pathlib import Path; import os,sys,tempfile; "
        "fd,p=tempfile.mkstemp(prefix='.podvoice-io-',dir=sys.argv[1]); "
        "os.write(fd,b'ok'); os.fsync(fd); os.close(fd); Path(p).unlink()"
    )
    _run([python, "-c", write_probe, str(root)], cwd=root, env=env, timeout=5, capture=True)
    return warnings


def resolve_merge_base(root: Path, base: str) -> str:
    merge_base = _git(root, "merge-base", "HEAD", base).strip()
    if not merge_base:
        raise DevCycleError(f"git returned no merge-base for {base!r}")
    return merge_base


def changed_files(root: Path, base: str, *, merge_base: str | None = None) -> list[str]:
    merge_base = merge_base or resolve_merge_base(root, base)
    names: set[str] = set()
    for args in (
        ("diff", "--name-only", f"{merge_base}...HEAD"),
        ("diff", "--name-only"),
        ("diff", "--name-only", "--cached"),
        ("ls-files", "--others", "--exclude-standard"),
    ):
        names.update(line for line in _git(root, *args).splitlines() if line)
    return sorted(names)


def scope_snapshot(root: Path, base: str) -> ScopeSnapshot:
    merge_base = resolve_merge_base(root, base)
    changes = tuple(changed_files(root, base, merge_base=merge_base))
    index_entries = _git(root, "ls-files", "--stage", "--", *changes) if changes else ""
    hashes: list[tuple[str, str]] = []
    for name in changes:
        path = root / name
        if path.is_symlink():
            hashes.append((name, f"symlink:{os.readlink(path)}"))
        elif path.is_file():
            hashes.append((name, hashlib.sha256(path.read_bytes()).hexdigest()))
        else:
            hashes.append((name, "missing"))
    return ScopeSnapshot(
        head=_git(root, "rev-parse", "HEAD").strip(),
        merge_base=merge_base,
        changes=changes,
        index_entries=index_entries,
        worktree_hashes=tuple(hashes),
    )


def require_unchanged_scope(before: ScopeSnapshot, after: ScopeSnapshot) -> None:
    if before != after:
        raise DevCycleError("changed scope moved while the gate ran; discard this result and rerun")


def diff_check(root: Path, env: dict[str, str], merge_base: str) -> None:
    for args in (
        ("diff", "--check", f"{merge_base}...HEAD"),
        ("diff", "--cached", "--check"),
        ("diff", "--check"),
    ):
        _run(["git", *args], cwd=root, env=env, timeout=30)


def load_lifecycle_smoke(root: Path, tracked_tests: Sequence[str]) -> tuple[str, ...]:
    """Load an auditable node-id manifest and reject stale or ambiguous entries."""
    manifest = root / LIFECYCLE_SMOKE_MANIFEST
    try:
        lines = manifest.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise DevCycleError(f"cannot read lifecycle smoke manifest: {manifest}") from exc
    nodes = tuple(
        line.strip() for line in lines if line.strip() and not line.lstrip().startswith("#")
    )
    if not nodes:
        raise DevCycleError("lifecycle smoke manifest is empty")
    if len(nodes) != len(set(nodes)):
        raise DevCycleError("lifecycle smoke manifest contains duplicate node ids")

    tracked = set(tracked_tests)
    invalid = [node for node in nodes if node.split("::", 1)[0] not in tracked]
    if invalid:
        raise DevCycleError(f"lifecycle smoke references untracked tests: {', '.join(invalid)}")
    return nodes


def select_lifecycle_tests(changes: Sequence[str], nodes: Sequence[str]) -> list[str]:
    """Select the fixed mechanical smoke and fail closed outside its ownership."""
    selected = set(nodes)
    covered_test_files = {node.split("::", 1)[0] for node in nodes}

    for path in changes:
        if path in LIFECYCLE_RUNTIME_FILES or path in LIFECYCLE_WORKFLOW_FILES:
            continue
        if path in LIFECYCLE_FIRMWARE_FILES or path.startswith(
            "esphome/components/podvoice_audio/"
        ):
            continue
        if path.startswith("docs/") or path in {"AGENTS.md", "CLAUDE.md", "README.md"}:
            continue
        if path.startswith("tests/") and path.endswith(".py"):
            if path not in covered_test_files and path != "tests/unit/test_dev_cycle.py":
                raise DevCycleError(
                    f"lifecycle smoke does not own changed test surface {path}; use fast or release"
                )
            # Run the entire changed test file so a newly added regression cannot sit
            # outside the fixed node-id list and produce a false focused green.
            selected = {node for node in selected if node.split("::", 1)[0] != path}
            selected.add(path)
            continue
        raise DevCycleError(
            f"lifecycle smoke does not cover changed surface {path}; use fast or release"
        )
    return sorted(selected)


def select_tests(changes: Sequence[str], tracked_tests: Sequence[str]) -> tuple[list[str], str]:
    test_set = set(tracked_tests)
    selected: set[str] = set()
    production_source_seen = False
    release_files = {
        "pyproject.toml",
        "config.example.yaml",
        "repository.yaml",
        "podvoice/requirements.txt",
        "podvoice/requirements-dev.txt",
        "podvoice/Dockerfile",
        "podvoice/build.yaml",
        "podvoice/config.yaml",
    }

    if not changes:
        return [RELEASE_CONTRACT], "no changes; smoke contract"

    for path in changes:
        if path in release_files or path.startswith("esphome/"):
            return [FULL_SUITE_MARKER], "release/build/firmware surface changed"
        if path.startswith("tests/") and path.endswith(".py"):
            selected.add(path)
            continue
        if path.startswith("tests/"):
            return [FULL_SUITE_MARKER], f"non-Python test input changed: {path}"
        file_path = Path(path)
        if file_path.parent == Path("podvoice/gatekeeper") and path.endswith(".py"):
            production_source_seen = True
            stem = file_path.stem
            direct = [
                candidate
                for candidate in test_set
                if Path(candidate).stem == f"test_{stem}"
                or Path(candidate).stem.startswith(f"test_{stem}_")
            ]
            if not direct:
                return [FULL_SUITE_MARKER], f"no direct impact test for {path}"
            selected.update(direct)
            continue
        if path.startswith("podvoice/"):
            return [FULL_SUITE_MARKER], f"unknown production surface changed: {path}"
        if path in {"scripts/__init__.py", "scripts/dev", "scripts/dev_cycle.py"}:
            if "tests/unit/test_dev_cycle.py" in test_set:
                selected.add("tests/unit/test_dev_cycle.py")
            continue
        if path.startswith("scripts/"):
            return [FULL_SUITE_MARKER], f"unclassified automation changed: {path}"
        if (
            path.startswith("docs/")
            or path.startswith(".github/")
            or path in {".gitignore", "AGENTS.md", "CLAUDE.md", "PLAN.md", "README.md"}
        ):
            continue
        return [FULL_SUITE_MARKER], f"unclassified repository surface changed: {path}"

    if not selected:
        return [RELEASE_CONTRACT], "non-runtime files only"
    if RELEASE_CONTRACT in test_set:
        selected.add(RELEASE_CONTRACT)
    reason = "changed tests and direct module contracts"
    if production_source_seen:
        reason += "; full suite still required before release"
    return sorted(selected), reason


def browser_scope(changes: Sequence[str]) -> bool:
    """Actual panel/controller, browser owners and required publication recipe."""
    return any(
        path.startswith(("podvoice/gatekeeper/static/", "tests/browser/"))
        or path
        in {
            "scripts/browser_gate.py",
            "scripts/dev_cycle.py",
            "tests/unit/test_browser_gate.py",
            ".github/workflows/ci.yml",
        }
        for path in changes
    )


def browser_recipe(root: Path, env: dict[str, str], timeout: int) -> None:
    # Serial owner after parallel stages: their 2s abort cannot kill browser cleanup.
    # Same internal recipe used by required CI; this is not a fourth local gate.
    from scripts.browser_gate import BrowserGateError, run_browser_gate

    try:
        run_browser_gate(root, env, timeout)
    except BrowserGateError as exc:
        raise DevCycleError(str(exc)) from exc


def run_fast(
    root: Path,
    env: dict[str, str],
    python: str,
    snapshot: ScopeSnapshot,
    requested_tests: Sequence[str] = (),
) -> None:
    changes = list(snapshot.changes)
    tracked_tests = _git(root, "ls-files", "tests/**/test_*.py").splitlines()
    if requested_tests:
        for node in requested_tests:
            if node.split("::", 1)[0] not in tracked_tests:
                raise DevCycleError(f"--test must name a tracked test module or node: {node}")
        tests = sorted(set(requested_tests))
        reason = "explicit development selection; full release coverage still required"
    else:
        tests, reason = select_tests(changes, tracked_tests)
    print(f"focused/partial scope: {', '.join(tests)} ({reason})", flush=True)

    ruff = sibling_tool(python, "ruff")
    changed_python = [path for path in changes if path.endswith(".py") and (root / path).is_file()]
    stages: list[Stage] = []
    if changed_python:
        stages.extend(
            (
                Stage("ruff", (ruff, "check", *changed_python), 30),
                Stage("format", (ruff, "format", "--check", *changed_python), 30),
            )
        )
    if any(path.startswith("podvoice/gatekeeper/") for path in changes):
        mypy = sibling_tool(python, "mypy")
        stages.append(Stage("mypy", (mypy, "podvoice/gatekeeper"), 60))
    timeout = int(os.environ.get("PODVOICE_FAST_TIMEOUT", FAST_TIMEOUT_S))
    # A full firmware/build scope exceeded the serial fast budget repeatedly.
    # Keep every test and the same per-worker bound; use release's isolated split.
    if tests == [FULL_SUITE_MARKER]:
        stages.append(unit_stage(python, timeout))
        stages.append(integration_stage(python, timeout))
    else:
        stages.append(Stage("pytest", (python, "-m", "pytest", "-q", *tests), timeout))
    run_parallel(root, env, stages)
    if not requested_tests and browser_scope(changes):
        browser_recipe(root, env, 120)
    diff_check(root, env, snapshot.merge_base)


def run_lifecycle(
    root: Path,
    env: dict[str, str],
    python: str,
    snapshot: ScopeSnapshot,
) -> None:
    changes = list(snapshot.changes)
    tracked_tests = _git(root, "ls-files", "tests/**/test_*.py").splitlines()
    nodes = load_lifecycle_smoke(root, tracked_tests)
    tests = select_lifecycle_tests(changes, nodes)
    print(
        "lifecycle focused/partial: deterministic mechanics only; "
        "not release, live eval, golden chain, or physical evidence",
        flush=True,
    )
    print(f"lifecycle smoke scope: {len(tests)} selectors", flush=True)

    ruff = sibling_tool(python, "ruff")
    changed_python = [path for path in changes if path.endswith(".py") and (root / path).is_file()]
    stages: list[Stage] = []
    if changed_python:
        stages.extend(
            (
                Stage("ruff", (ruff, "check", *changed_python), 30),
                Stage("format", (ruff, "format", "--check", *changed_python), 30),
            )
        )
    if any(path in LIFECYCLE_RUNTIME_FILES for path in changes):
        mypy = sibling_tool(python, "mypy")
        stages.append(Stage("mypy", (mypy, "podvoice/gatekeeper"), 60))
    stages.append(
        Stage(
            "pytest",
            (python, "-m", "pytest", "-q", *tests),
            int(os.environ.get("PODVOICE_FAST_TIMEOUT", FAST_TIMEOUT_S)),
        )
    )
    run_parallel(root, env, stages)
    diff_check(root, env, snapshot.merge_base)


def run_release(
    root: Path,
    env: dict[str, str],
    python: str,
    snapshot: ScopeSnapshot,
) -> None:
    ruff = sibling_tool(python, "ruff")
    mypy = sibling_tool(python, "mypy")
    release_timeout = int(os.environ.get("PODVOICE_RELEASE_TIMEOUT", RELEASE_TIMEOUT_S))
    style_worker = (
        "import subprocess,sys; "
        "subprocess.run([sys.argv[1],'check','.'],check=True); "
        "subprocess.run([sys.argv[1],'format','--check','.'],check=True)"
    )
    run_parallel(
        root,
        env,
        [
            Stage(
                "candidate-scope",
                (
                    python,
                    {
                        "a451d65a20290cc2c43b163c12abb52511a3ac57": "scripts/candidate_scope_admission109.py",
                        "2c46f3e6c70e531746a8afa2836eb2b07ac57b49": "scripts/candidate_scope_admission108.py",
                        "59413ce4734c3ca8d85cd458a75365520124048d": "scripts/candidate_scope_admission107.py",
                        "0458f59108a099a0bb898becdd14941ed885b535": "scripts/candidate_scope_admission106.py",
                        "425bb80f1441d76a55d18b32517e146c5f8e1757": "scripts/candidate_scope_admission105.py",
                        "fbf3c808432d370e12ae82024bc72a87d2e401c7": "scripts/candidate_scope_admission104.py",
                        "c5d90263fd4da106a1b573ab9fb1fd7d4e4fe3b6": "scripts/candidate_scope_admission103.py",
                        "97b9863b855446c20c043fdb0ab5ad1b37e99020": "scripts/candidate_scope_admission102.py",
                        "5844270ca7334f94f3f791c18b008259a77b12ae": "scripts/candidate_scope_admission101.py",
                        "58a65c12074203afcbcfbb39deb7de7cc3a4ac7a": "scripts/candidate_scope_admission100.py",
                        "574b38c684b2c838a6d011db6314f657535dab66": "scripts/candidate_scope_admission99.py",
                        "312562b66f2d2406e54a0ed22b80130f941f8417": "scripts/candidate_scope_admission98.py",
                        "8ecd76bc3603fccdd94066212a66d5138e0cebd5": "scripts/candidate_scope_admission97.py",
                        "f492f4cca291757677429019422823d263665132": "scripts/candidate_scope_admission96.py",
                        "e7cd9ded8aa99287eb0aae1305278e4e95b78f04": "scripts/candidate_scope_admission95.py",
                        "a49711ea3a81d8420b91ddd9407cf83ea45029c0": "scripts/candidate_scope_admission94.py",
                        "815c9a19e8369f14015ea597a46e63c80f4c9956": "scripts/candidate_scope_admission93.py",
                        "1606b2015f8c5dcd165505303a8968824ba83147": "scripts/candidate_scope_admission92.py",
                        "65fe801a8bb587ba42518ce4dbb04ee39b59fd76": "scripts/candidate_scope_admission91.py",
                        "5a9bb2b2da735399a1069f529ca4ace572779efb": "scripts/candidate_scope_admission90.py",
                        "ba10807df5c297881c360bd0510eb599b3d348aa": "scripts/candidate_scope_admission89.py",
                        "8d08c039b54ec5503b7e1d995b1faecc5213f50f": "scripts/candidate_scope_admission88.py",
                        "c5c34a2efb4fba70d186d735baa6a3d58dbf00b5": "scripts/candidate_scope_admission87.py",
                        "1945c899f067d46e9dd3b5d031c880573a102e0c": "scripts/candidate_scope_admission86.py",
                        "5538e34765d4418f60622446fa1bd32f292d7ff2": "scripts/candidate_scope_admission85.py",
                        "8648a99e5e524c20fca542ca0d62207dfeb904f4": "scripts/candidate_scope_admission84.py",
                        "8884c78573384c436bfa0287c135d584fd929ce8": "scripts/candidate_scope_admission83.py",
                        "ae3ea766485914e98bfc8a883301978971e103b7": "scripts/candidate_scope_admission82.py",
                        "7c1481f6682df89526081932c05d9bb5d83324f3": "scripts/candidate_scope_admission81.py",
                        "dbd6949dcddce6487f04d89d4ef051213e6f4d35": "scripts/candidate_scope_admission80.py",
                        "7742699ea8ca0c9b70498a7c2f63e86b039c3eed": "scripts/candidate_scope_admission79.py",
                        "a537077b0ecb31a9def0759cf5a5c44873f0ec85": "scripts/candidate_scope_admission78.py",
                        "5b753604c703e90f7fd5c63ea3ccd219ab814670": "scripts/candidate_scope_admission77.py",
                        "64028590b1a45008bbb0f8e77e6b2fbe81fc9c06": "scripts/candidate_scope_admission76.py",
                        "3f50a1c29433ff5f34bb04c8928d23f41c90abe0": "scripts/candidate_scope_admission75.py",
                        "0dfae681c18c104d98a1b91fe8b03f9ef8c75834": "scripts/candidate_scope_admission74.py",
                        "c9b04906f7f3386ea404fbf5deca9011489936a1": "scripts/candidate_scope_admission73.py",
                        "85a296a7394b621e76533cc4365e435fd9017743": "scripts/candidate_scope_admission72.py",
                        "0508f9d9d8ae39b2cc2328eec9e6f437a288ebf3": "scripts/candidate_scope_admission71.py",
                        "d21c267817ce6744dfd59efeafb13a186f5fb78d": "scripts/candidate_scope_admission70.py",
                        "8cbca02897b8f59cbfd3392ef965b523b6d1db10": "scripts/candidate_scope_admission69.py",
                        "f99be699315de44375bea46f1c667712dca21229": "scripts/candidate_scope_admission68.py",
                        "f12537026e6ceb199932c5aa05d977e43a47920e": "scripts/candidate_scope_admission67.py",
                        "2c585fabdaaf52895a103db698988477eed098a4": "scripts/candidate_scope_admission66.py",
                        "eead19bcf86e958fdb78321fdd54549d393698c8": "scripts/candidate_scope_admission65.py",
                        "fe3750cd47bd8f0d2d518fb5ccc51a380c17f65b": "scripts/candidate_scope_admission64.py",
                        "382c8275125fda4742c8f5947bb1ceed0e3b102d": "scripts/candidate_scope_admission63.py",
                        "79b8fe8cdd3d2ee55e811cd76ac9f37e067cae48": "scripts/candidate_scope_admission62.py",
                        "1db7642e1e67eb9a02c65ed95a2a4891b69e87bb": "scripts/candidate_scope_admission61.py",
                        "fcfdbbd775d7d04640254545cf21ffc302a0b9d8": "scripts/candidate_scope_admission60.py",
                        "78d9dc7528b964d2986e50eee31ecdd0d942571b": "scripts/candidate_scope_admission59.py",
                        "8dd2f725ff43e1d1bcb0d2ea35d3ae64b055b0c5": "scripts/candidate_scope_admission58.py",
                        "b39498a0c6b965395d8b20ea8387e7c546f7c663": "scripts/candidate_scope_admission57.py",
                        "a97b6658f3d5cd20a5c5d0396a3c07253eae5963": "scripts/candidate_scope_admission56.py",
                        "98006350907c329869ed60c2ea256f9eb1725393": "scripts/candidate_scope_admission55.py",
                        "c89d429937dbbbc1195b363f9dc531fa185e3d22": "scripts/candidate_scope_admission54.py",
                        "16fb39d8f780ae9b2925163027974e4952424217": "scripts/candidate_scope_admission53.py",
                        "2a93c1673fdf0d8051b877ced32fe51628e534e6": "scripts/candidate_scope_admission52.py",
                        "e2e9552459f920385f4228b80ce9a35750b072a5": "scripts/candidate_scope_admission51.py",
                        "9d8d72326569061f16c3af5724d6c9e54a9e661a": "scripts/candidate_scope_admission50.py",
                        "d6c1cfe7c761a80056771af5f9ccccbc1fdd2437": "scripts/candidate_scope_admission49.py",
                        "8604704df3175b9b34acca654a92bfe0305437c0": "scripts/candidate_scope_admission48.py",
                        "26438cdefac88c8bac071e8089636cd823c7a891": "scripts/candidate_scope_admission47.py",
                        "e5e9ec495061e6b3f97f6555a28dafecdeceed3f": "scripts/candidate_scope_admission46.py",
                        "383a72f1170ebf97ac8ef7f121c933cd731dd311": "scripts/candidate_scope_admission45.py",
                        "3f3628a6a847a322a0aa49788b56dd65836d1986": "scripts/candidate_scope_admission44.py",
                        "4f183f19689fcf87f90d26c6a14a8e6e153d93c1": "scripts/candidate_scope_admission43.py",
                        "fa7a3d1d5f09d31aa04e842dbce22f8654f2eca5": "scripts/candidate_scope_admission42.py",
                        "6799ee3d65cb67fb406346c565dc206e08cbf0da": "scripts/candidate_scope_admission41.py",
                        "97e4b44fd5299136e562d5eebf0076c8ebf83bb2": "scripts/candidate_scope_admission40.py",
                        "f0e3d62a5677050d2373f691a61cd733b3dd5be6": "scripts/candidate_scope_admission39.py",
                        "e4c2966197ac28aa6e86a0df55e7f461203df269": "scripts/candidate_scope_admission38.py",
                        "aa49d94e588974683ad3b9ad4b6d34da81676b58": "scripts/candidate_scope_admission37.py",
                        "ed0fbc41d9ab2a9fcdbf0648d2ee0839abd1befd": "scripts/candidate_scope_admission36.py",
                        "e4d19282aaa18ddc2d5d1f04b6c7de84c0823d8b": "scripts/candidate_scope_admission35.py",
                        "8e7ff9bc9aaaf298a23c93e53bed90c672558b25": "scripts/candidate_scope_admission34.py",
                        "abe759678168ba6408e10ae0a8a3621249631d13": "scripts/candidate_scope_admission33.py",
                        "0e56c593c6ce9a3e1666b5fd535d3424cc691b9c": "scripts/candidate_scope_admission31.py",
                    }.get(snapshot.merge_base, "scripts/candidate_scope_admission32.py"),
                    "--base",
                    snapshot.merge_base,
                ),
                30,
            ),
            Stage("ruff-format", (python, "-c", style_worker, ruff), 60),
            Stage("mypy", (mypy, "podvoice/gatekeeper"), 90),
            unit_stage(python, release_timeout),
            integration_stage(python, release_timeout),
        ],
    )
    if browser_scope(snapshot.changes):
        browser_recipe(root, env, 240)
    diff_check(root, env, snapshot.merge_base)
    print(
        "local release gate green; exact-commit CI and ARM64 image are still required", flush=True
    )


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "mode",
        choices=(
            "preflight",
            "fast",
            "lifecycle",
            "release",
            "unit-worker",
            "integration-worker",
            "unit-shard",
            "rest-shard",
        ),
        nargs="?",
        default="fast",
    )
    parser.add_argument("--base", default=os.environ.get("PODVOICE_BASE", "origin/main"))
    parser.add_argument(
        "--test",
        action="append",
        default=[],
        help="fast only: run this tracked pytest module/node (repeatable), not a release gate",
    )
    parser.add_argument(
        "--unit-timeout", type=int, default=RELEASE_TIMEOUT_S, help=argparse.SUPPRESS
    )
    parser.add_argument(
        "--integration-timeout", type=int, default=RELEASE_TIMEOUT_S, help=argparse.SUPPRESS
    )
    parser.add_argument("--shard", type=int)
    args = parser.parse_args(argv)
    if (args.mode in {"unit-shard", "rest-shard"}) != (args.shard is not None):
        parser.error("--shard is required only for shard modes")
    if args.mode == "unit-shard" and not 1 <= args.shard <= UNIT_BATCH_COUNT:
        parser.error(f"--shard must be between 1 and {UNIT_BATCH_COUNT} for unit-shard")
    if args.mode == "rest-shard" and not 1 <= args.shard <= REST_BATCH_COUNT:
        parser.error(f"--shard must be between 1 and {REST_BATCH_COUNT} for rest-shard")
    if args.test and args.mode != "fast":
        parser.error("--test is only available for fast development feedback")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    started = time.monotonic()
    try:
        if args.mode == "unit-shard":
            return run_ci_unit_shard(
                Path.cwd().resolve(), os.environ.copy(), sys.executable, args.shard
            )
        if args.mode == "rest-shard":
            return run_ci_rest_shard(
                Path.cwd().resolve(), os.environ.copy(), sys.executable, args.shard
            )
        if args.mode == "unit-worker":
            run_unit_batches(
                Path.cwd().resolve(), os.environ.copy(), sys.executable, args.unit_timeout
            )
            return 0
        if args.mode == "integration-worker":
            run_integration_batches(
                Path.cwd().resolve(), os.environ.copy(), sys.executable, args.integration_timeout
            )
            return 0
        root = repository_root(Path.cwd())
        if args.mode in {"fast", "lifecycle", "release"}:
            validate_gate_storage(
                root,
                os.environ.get("PODVOICE_PYTHON", str(root / ".venv" / "bin" / "python")),
                configured_cache_root(os.environ, root),
            )
        env, python = tool_environment(root)
        with GateLock():
            warnings = preflight(root, env, python)
            for warning in warnings:
                print(f"warning: {warning}", file=sys.stderr)
            if args.mode in {"fast", "lifecycle", "release"}:
                before = scope_snapshot(root, args.base)
                if args.mode == "fast":
                    run_fast(root, env, python, before, args.test)
                elif args.mode == "lifecycle":
                    run_lifecycle(root, env, python, before)
                else:
                    run_release(root, env, python, before)
                require_unchanged_scope(before, scope_snapshot(root, args.base))
        label = "focused/partial" if args.mode in {"fast", "lifecycle"} else args.mode
        print(f"{label} completed in {time.monotonic() - started:.1f}s", flush=True)
        return 0
    except DevCycleError as exc:
        print(f"dev cycle stopped: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    # The shell wrapper executes this file, including from checkout subdirectories.
    # Share its module owner with browser_gate rather than loading a second copy.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    sys.modules["scripts.dev_cycle"] = sys.modules[__name__]
    raise SystemExit(main())
