#!/usr/bin/env python3
"""Internal serial UI recipe; called by fast/release and required CI, never runtime."""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import selectors
import shutil
import signal
import subprocess
import sys
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path

from scripts.dev_cycle import (
    cache_paths,
    configured_cache_root,
    require_durable_storage,
    validate_cache_storage,
)

INVENTORY = ("live_status", "daily_ui", "wake_words", "settings_dirty")
NODE_VERSION = "v24.19.0"
PLAYWRIGHT_VERSION = "1.62.1"
CHROMIUM_REVISION = "1234"
CLEANUP_SECONDS = 15


class BrowserGateError(RuntimeError):
    """Missing proof or failed assertions, including incomplete cleanup."""


@dataclass(frozen=True)
class Identity:
    pid: int
    parent: int
    group: int
    born: tuple[int, ...]
    uid: int


def identity(pid: int) -> Identity | None:
    """Read only the known PID, with native sub-second birth identity."""
    if sys.platform == "linux":
        try:
            directory = Path("/proc") / str(pid)
            stat = (directory / "stat").read_text().rsplit(") ", 1)[1].split()
            return Identity(
                pid, int(stat[1]), int(stat[2]), (int(stat[19]),), directory.stat().st_uid
            )
        except FileNotFoundError:
            return None
    if sys.platform == "darwin":
        # Actual SDK sys/proc_info.h: proc_bsdinfo / PROC_PIDTBSDINFO=3.
        class BSDInfo(ctypes.Structure):
            _fields_ = (
                [
                    (name, ctypes.c_uint32)
                    for name in (
                        "flags",
                        "status",
                        "xstatus",
                        "pid",
                        "ppid",
                        "uid",
                        "gid",
                        "ruid",
                        "rgid",
                        "svuid",
                        "svgid",
                        "reserved",
                    )
                ]
                + [("comm", ctypes.c_char * 16), ("name", ctypes.c_char * 32)]
                + [(name, ctypes.c_uint32) for name in ("nfiles", "pgid", "jobc", "tdev", "tpgid")]
                + [
                    ("nice", ctypes.c_int32),
                    ("seconds", ctypes.c_uint64),
                    ("micros", ctypes.c_uint64),
                ]
            )

        library = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
        library.proc_pidinfo.argtypes = (
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_uint64,
            ctypes.c_void_p,
            ctypes.c_int,
        )
        library.proc_pidinfo.restype = ctypes.c_int
        info = BSDInfo()
        size = library.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
        if size == 0 and ctypes.get_errno() in (0, 3):
            return None
        if size != ctypes.sizeof(info):
            raise BrowserGateError("known process identity could not be verified")
        return Identity(pid, info.ppid, info.pgid, (info.seconds, info.micros), info.uid)
    raise BrowserGateError("UI browser ownership requires Linux or macOS")


def group_exists(group: int) -> bool:
    try:
        os.killpg(group, 0)
        return True
    except ProcessLookupError:
        return False


def dependencies(root: Path, env: dict[str, str]) -> tuple[str, str]:
    node = env.get("PODVOICE_NODE") or shutil.which("node", path=env.get("PATH"))
    if not node:
        raise BrowserGateError("missing pinned Node 24.19.0")
    # This preflight loads metadata only; it does not launch or install a browser.
    script = """const fs=require('node:fs'),path=require('node:path');
const pkg=require('playwright/package.json');
const core=require('playwright-core/package.json');
const dir=path.dirname(require.resolve('playwright-core/package.json'));
const browser=JSON.parse(fs.readFileSync(path.join(dir,'browsers.json'))).browsers.find(x=>x.name==='chromium');
console.log(JSON.stringify({node:process.version,playwright:pkg.version,core:core.version,revision:browser.revision,executable:require('playwright').chromium.executablePath()}));"""
    try:
        result = subprocess.run(
            [node, "-e", script],
            cwd=root / "tests/browser",
            env=env,
            capture_output=True,
            text=True,
            check=True,
            timeout=15,
        )
        proof = json.loads(result.stdout)
        valid = (
            proof["node"] == NODE_VERSION
            and proof["playwright"] == PLAYWRIGHT_VERSION
            and proof["core"] == PLAYWRIGHT_VERSION
            and proof["revision"] == CHROMIUM_REVISION
        )
        executable = Path(proof["executable"]).resolve(strict=True)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        raise BrowserGateError(
            "missing/mismatched pinned Node, Playwright or Chromium; provision development dependencies explicitly"
        ) from exc
    browser_cache = cache_paths(configured_cache_root(env, root), "ui-browser")["browser"]
    if (
        not valid
        or not executable.is_relative_to(browser_cache.resolve())
        or not os.access(executable, os.X_OK)
    ):
        raise BrowserGateError(
            "pinned browser must exist inside the declared durable browser cache"
        )
    return node, str(executable)


class Registry:
    def __init__(self, worker: subprocess.Popen[bytes], nonce: str) -> None:
        self.worker = worker
        self.nonce = nonce
        self.worker_identity = identity(worker.pid)
        if (
            self.worker_identity is None
            or self.worker_identity.parent != os.getpid()
            or self.worker_identity.group != worker.pid
        ):
            raise BrowserGateError("new worker ownership could not be verified")
        self.sequence = 0
        self.ready = False
        self.groups: dict[int, Identity] = {}
        self.failure: str | None = None

    def receive(self, line: bytes) -> None:
        try:
            entry = json.loads(line)
            if (
                entry.get("nonce") != self.nonce
                or entry.get("worker") != self.worker.pid
                or entry.get("sequence") != self.sequence
            ):
                raise BrowserGateError("registry invocation/sequence mismatch")
            self.sequence += 1
            if entry["kind"] == "ready" and not self.ready:
                self.ready = True
            elif entry["kind"] == "launch" and self.ready:
                pid = entry["pid"]
                if (
                    not isinstance(pid, int)
                    or pid <= 1
                    or entry["group"] != pid
                    or pid in self.groups
                ):
                    raise BrowserGateError("invalid browser group registration")
                owner = identity(pid)
                if (
                    owner is None
                    or owner.parent != self.worker.pid
                    or owner.group != pid
                    or owner.uid != os.getuid()
                ):
                    raise BrowserGateError("browser launch owner could not be verified")
                self.groups[pid] = owner
            else:
                raise BrowserGateError("invalid registry event")
        except (ValueError, KeyError, TypeError, BrowserGateError) as exc:
            self.failure = str(exc)

    def fresh_worker(self) -> bool:
        return self.worker.poll() is None and identity(self.worker.pid) == self.worker_identity

    def signal_browser(self, group: int, sig: int) -> None:
        admitted = self.groups.get(group)
        if admitted is None:
            raise BrowserGateError(
                "incomplete cleanup: browser group was not admitted; no kill authorized"
            )
        current = identity(group)
        if current is None or admitted.pid != group or admitted.group != group:
            valid = False
        elif self.worker.poll() is None:
            # The original live worker and direct-parent admission remain exact.
            valid = (
                self.fresh_worker() and current == admitted and current.parent == self.worker.pid
            )
        else:
            # A tracked terminal worker may leave its admitted detached child
            # adopted by the OS. Only PPID can change; never trust a raw PGID.
            valid = (current.pid, current.group, current.born, current.uid) == (
                admitted.pid,
                admitted.group,
                admitted.born,
                admitted.uid,
            )
        if not valid:
            raise BrowserGateError(
                "incomplete cleanup: orphan browser owner is unverifiable; no kill authorized"
            )
        os.killpg(group, sig)

    def cleanup(self, canceled: bool) -> list[int]:
        """SDK TERM grace, then fresh owned browser groups and worker join.

        A leaderless group is failure. Never kill by stale PGID alone. Cleanup
        still joins the independently proven worker when a browser is unknown.
        """
        failures: list[str] = []
        if canceled and self.fresh_worker():
            self.worker.send_signal(signal.SIGTERM)
        graceful = time.monotonic() + 3
        while canceled and self.worker.poll() is None and time.monotonic() < graceful:
            time.sleep(0.02)
        for sig in (signal.SIGTERM, signal.SIGKILL):
            for group in self.groups:
                if group_exists(group):
                    try:
                        self.signal_browser(group, sig)
                    except (OSError, BrowserGateError) as exc:
                        failures.append(str(exc))
            bound = time.monotonic() + 3
            while any(group_exists(group) for group in self.groups) and time.monotonic() < bound:
                time.sleep(0.02)
        if self.worker.poll() is None:
            if not self.fresh_worker():
                failures.append("incomplete cleanup: worker ownership changed")
            else:
                os.killpg(self.worker.pid, signal.SIGTERM)
                try:
                    self.worker.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    if not self.fresh_worker():
                        failures.append("incomplete cleanup: worker ownership changed")
                    else:
                        os.killpg(self.worker.pid, signal.SIGKILL)
                        self.worker.wait(timeout=2)
        if any(group_exists(group) for group in self.groups) or group_exists(self.worker.pid):
            failures.append("incomplete cleanup: process group did not join")
        if failures:
            raise BrowserGateError("; ".join(dict.fromkeys(failures)))
        return list(self.groups)


def run_worker(
    root: Path,
    env: dict[str, str],
    node: str,
    executable: str,
    name: str,
    timeout: int,
    proof: Path,
) -> dict[str, object]:
    nonce = uuid.uuid4().hex
    read_fd, write_fd = os.pipe()
    os.set_blocking(read_fd, False)
    worker_env = dict(
        env,
        PODVOICE_BROWSER_NONCE=nonce,
        PODVOICE_BROWSER_REGISTRY_FD=str(write_fd),
        PODVOICE_TEST_CHROMIUM=executable,
        PODVOICE_BROWSER_PROOF="1",
        PODVOICE_UI_PROOF_DIR=str(proof),
    )
    worker: subprocess.Popen[bytes] | None = None
    registry: Registry | None = None
    failure: str | None = None
    worker_failure: str | None = None
    registry_failure: str | None = None
    joined: list[int] = []
    cleanup_complete = False
    pending = b""
    started = time.monotonic()
    previous: dict[int, object] = {}
    canceled = False

    def cancel(_sig: int, _frame: object) -> None:
        nonlocal canceled
        canceled = True

    try:
        for sig in (signal.SIGINT, signal.SIGTERM):
            previous[sig] = signal.signal(sig, cancel)
        with (proof / "worker.log").open("wb") as output:
            worker = subprocess.Popen(
                [
                    node,
                    "--require",
                    str(root / "tests/browser/ownership_registry.cjs"),
                    str(root / "tests/browser" / (name + ".cjs")),
                ],
                cwd=root,
                env=worker_env,
                stdout=output,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                pass_fds=(write_fd,),
            )
            os.close(write_fd)
            write_fd = -1
            registry = Registry(worker, nonce)
            with selectors.DefaultSelector() as selector:
                selector.register(read_fd, selectors.EVENT_READ)
                while True:
                    for _key, _mask in selector.select(0.02):
                        chunk = os.read(read_fd, 4096)
                        pending += chunk
                        if len(pending) > 16384:
                            raise BrowserGateError("oversized ownership registry")
                        while b"\n" in pending:
                            line, pending = pending.split(b"\n", 1)
                            registry.receive(line)
                    if registry.failure:
                        registry_failure = registry.failure
                        raise BrowserGateError(registry.failure)
                    if canceled or time.monotonic() - started > timeout:
                        canceled = True
                        raise BrowserGateError("worker canceled or exceeded its own bound")
                    if worker.poll() is not None:
                        # Drain any final records already written before worker exit.
                        while True:
                            try:
                                chunk = os.read(read_fd, 4096)
                            except BlockingIOError:
                                break
                            if not chunk:
                                break
                            pending += chunk
                            while b"\n" in pending:
                                line, pending = pending.split(b"\n", 1)
                                registry.receive(line)
                        if worker.returncode != 0:
                            worker_failure = (
                                f"browser assertions failed (worker exit {worker.returncode})"
                            )
                        if pending or registry.failure or not registry.ready or not registry.groups:
                            registry_failure = "missing/failed browser owner registry"
                            if registry.failure:
                                registry_failure += ": " + registry.failure
                        terminal_failures = [
                            value for value in (worker_failure, registry_failure) if value
                        ]
                        if terminal_failures:
                            raise BrowserGateError("; ".join(terminal_failures))
                        break
    except (OSError, BrowserGateError, KeyboardInterrupt) as exc:
        failure = str(exc)
        canceled = True
    finally:
        try:
            if registry is not None:
                joined = registry.cleanup(canceled)
                cleanup_complete = bool(joined) and registry.failure is None
            elif worker is not None:
                # No proven browser registry: no browser group kill/PASS.
                failure = "incomplete cleanup: registry owner was never established"
        except (OSError, BrowserGateError, subprocess.TimeoutExpired) as exc:
            failure = ((failure + "; ") if failure else "") + str(exc)
        os.close(read_fd)
        if write_fd >= 0:
            os.close(write_fd)
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    receipt: dict[str, object] = {
        "worker": name,
        "nonce": nonce,
        "status": "FAIL" if failure else "PASS",
        "failure": failure,
        "worker_returncode": None if worker is None else worker.returncode,
        "worker_failure": worker_failure,
        "registry_failure": registry_failure,
        "cleanup_complete": cleanup_complete,
        "joined_groups": joined,
        "registered_groups": []
        if registry is None
        else [asdict(value) for value in registry.groups.values()],
        "html_sha256": hashlib.sha256(
            (root / "podvoice/gatekeeper/static/index.html").read_bytes()
        ).hexdigest(),
        "node": NODE_VERSION,
        "playwright": PLAYWRIGHT_VERSION,
        "chromium_revision": CHROMIUM_REVISION,
    }
    (proof / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    if failure:
        raise BrowserGateError(f"{name}: {failure}; receipt={proof / 'receipt.json'}")
    return receipt


def run_browser_gate(root: Path, env: dict[str, str], timeout: int) -> None:
    if timeout not in (120, 240):
        raise BrowserGateError("browser worker bound must be 120 or 240 seconds")
    require_durable_storage(root, "browser checkout")
    cache = configured_cache_root(env, root)
    validate_cache_storage(cache)
    paths = cache_paths(cache, "ui-browser")
    actual_env = dict(env, PLAYWRIGHT_BROWSERS_PATH=str(paths["browser"]))
    node, executable = dependencies(root, actual_env)
    try:
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            capture_output=True,
            text=True,
            check=True,
            timeout=15,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError) as exc:
        raise BrowserGateError("browser candidate Git identity could not be verified") from exc
    source_paths = [
        "podvoice/gatekeeper/static/index.html",
        "scripts/browser_gate.py",
        "scripts/dev_cycle.py",
        "tests/browser/ownership_registry.cjs",
        "tests/browser/package.json",
        "tests/browser/package-lock.json",
        ".github/workflows/ci.yml",
        "podvoice/config.yaml",
    ]
    source_paths.extend("tests/browser/" + name + ".cjs" for name in INVENTORY)
    source_hashes = {
        path: hashlib.sha256((root / path).read_bytes()).hexdigest() for path in source_paths
    }
    for name in INVENTORY:
        if not (root / "tests/browser" / (name + ".cjs")).is_file():
            raise BrowserGateError("browser inventory incomplete")
    invocation = paths["browser-proof"] / uuid.uuid4().hex
    require_durable_storage(invocation, "browser proof")
    invocation.mkdir(parents=True, mode=0o700)
    candidate = {
        "head": head,
        "source_sha256": source_hashes,
        "inventory": INVENTORY,
        "worker_bound_seconds": timeout,
        "cleanup_bound_seconds": CLEANUP_SECONDS,
        "status": "RUNNING",
    }
    candidate_receipt = invocation / "candidate.json"
    candidate_receipt.write_text(json.dumps(candidate, indent=2) + "\n")
    try:
        for name in INVENTORY:
            proof = invocation / name
            proof.mkdir(mode=0o700)
            run_worker(root, actual_env, node, executable, name, timeout, proof)
        after = {
            path: hashlib.sha256((root / path).read_bytes()).hexdigest() for path in source_paths
        }
        if after != source_hashes:
            raise BrowserGateError("browser candidate source moved during proof")
    except BaseException as exc:
        candidate.update(status="FAIL", failure=str(exc))
        candidate_receipt.write_text(json.dumps(candidate, indent=2) + "\n")
        raise
    candidate["status"] = "PASS"
    candidate_receipt.write_text(json.dumps(candidate, indent=2) + "\n")
    print(f"UI browser workers joined; receipts: {invocation}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker-timeout", type=int, choices=(120, 240), default=240)
    args = parser.parse_args()
    try:
        run_browser_gate(Path.cwd(), dict(os.environ), args.worker_timeout)
    except (BrowserGateError, OSError) as exc:
        print(f"UI browser gate FAIL: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
