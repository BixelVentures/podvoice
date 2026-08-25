#!/usr/bin/env python3
"""Fast, fail-fast local feedback without changing the release gate."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

COLLECTION_TIMEOUT_S = 15
FAST_TIMEOUT_S = 120
RELEASE_TIMEOUT_S = 240
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


def tool_environment(root: Path) -> tuple[dict[str, str], str]:
    cache_root = Path(
        os.environ.get(
            "PODVOICE_DEV_CACHE",
            str(Path(tempfile.gettempdir()) / f"podvoice-dev-cache-{os.getuid()}"),
        )
    )
    pycache = cache_root / "pycache"
    mypy_cache = cache_root / "mypy"
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


class GateLock:
    """One machine-wide owner for pytest/mypy/git gate work."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or Path(
            os.environ.get(
                "PODVOICE_GATE_LOCK",
                str(Path(tempfile.gettempdir()) / "podvoice-dev-gate.lock"),
            )
        )
        self._handle = None

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
    lowered_parts = {part.lower() for part in root.parts}
    if lowered_parts.intersection({"documents", "desktop", "onedrive", "icloud drive"}):
        warnings.append(
            f"checkout is under a commonly synchronized folder ({root}); use ~/Developer/PodVoice or /tmp"
        )

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
    _run(
        [python, "-c", read_probe, *probe_files],
        cwd=root,
        env=env,
        timeout=COLLECTION_TIMEOUT_S,
        capture=True,
    )
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


def collect(root: Path, env: dict[str, str], python: str, tests: Sequence[str]) -> None:
    _run(
        [python, "-m", "pytest", "--collect-only", "-q", *tests],
        cwd=root,
        env=env,
        timeout=COLLECTION_TIMEOUT_S,
        capture=True,
    )


def run_fast(
    root: Path,
    env: dict[str, str],
    python: str,
    snapshot: ScopeSnapshot,
) -> None:
    changes = list(snapshot.changes)
    tracked_tests = _git(root, "ls-files", "tests/**/test_*.py").splitlines()
    tests, reason = select_tests(changes, tracked_tests)
    print(f"focused/partial scope: {', '.join(tests)} ({reason})", flush=True)

    ruff = sibling_tool(python, "ruff")
    changed_python = [path for path in changes if path.endswith(".py") and (root / path).is_file()]
    if changed_python:
        _run([ruff, "check", *changed_python], cwd=root, env=env, timeout=30)
        _run([ruff, "format", "--check", *changed_python], cwd=root, env=env, timeout=30)
    if any(path.startswith("podvoice/gatekeeper/") for path in changes):
        mypy = sibling_tool(python, "mypy")
        _run([mypy, "podvoice/gatekeeper"], cwd=root, env=env, timeout=60)
    collect(root, env, python, tests)
    _run(
        [python, "-m", "pytest", "-q", *tests],
        cwd=root,
        env=env,
        timeout=int(os.environ.get("PODVOICE_FAST_TIMEOUT", FAST_TIMEOUT_S)),
    )
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
    if changed_python:
        _run([ruff, "check", *changed_python], cwd=root, env=env, timeout=30)
        _run([ruff, "format", "--check", *changed_python], cwd=root, env=env, timeout=30)
    if any(path in LIFECYCLE_RUNTIME_FILES for path in changes):
        mypy = sibling_tool(python, "mypy")
        _run([mypy, "podvoice/gatekeeper"], cwd=root, env=env, timeout=60)
    collect(root, env, python, tests)
    _run(
        [python, "-m", "pytest", "-q", *tests],
        cwd=root,
        env=env,
        timeout=int(os.environ.get("PODVOICE_FAST_TIMEOUT", FAST_TIMEOUT_S)),
    )
    diff_check(root, env, snapshot.merge_base)


def run_release(
    root: Path,
    env: dict[str, str],
    python: str,
    snapshot: ScopeSnapshot,
) -> None:
    ruff = sibling_tool(python, "ruff")
    mypy = sibling_tool(python, "mypy")
    _run([ruff, "check", "."], cwd=root, env=env, timeout=60)
    _run([ruff, "format", "--check", "."], cwd=root, env=env, timeout=60)
    _run([mypy, "podvoice/gatekeeper"], cwd=root, env=env, timeout=90)
    collect(root, env, python, [FULL_SUITE_MARKER])
    _run(
        [python, "-m", "pytest", "-q"],
        cwd=root,
        env=env,
        timeout=int(os.environ.get("PODVOICE_RELEASE_TIMEOUT", RELEASE_TIMEOUT_S)),
    )
    diff_check(root, env, snapshot.merge_base)
    print(
        "local release gate green; exact-commit CI and ARM64 image are still required", flush=True
    )


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "mode",
        choices=("preflight", "fast", "lifecycle", "release"),
        nargs="?",
        default="fast",
    )
    parser.add_argument("--base", default=os.environ.get("PODVOICE_BASE", "origin/main"))
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    started = time.monotonic()
    try:
        root = repository_root(Path.cwd())
        env, python = tool_environment(root)
        with GateLock():
            warnings = preflight(root, env, python)
            for warning in warnings:
                print(f"warning: {warning}", file=sys.stderr)
            if args.mode in {"fast", "lifecycle", "release"}:
                before = scope_snapshot(root, args.base)
                if args.mode == "fast":
                    run_fast(root, env, python, before)
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
    raise SystemExit(main())
