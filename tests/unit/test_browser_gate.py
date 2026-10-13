"""Owner/inventory regressions. No Chromium or provider launch in unit workers."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest
from scripts import browser_gate, dev_cycle


def fixture_root(tmp_path: Path, source: str) -> tuple[Path, Path, str]:
    node = shutil.which("node")
    assert node is not None, "Node is required for the test-only ownership preloader regression"
    directory = tmp_path / "tests/browser"
    directory.mkdir(parents=True)
    registry = Path(__file__).resolve().parents[1] / "browser/ownership_registry.cjs"
    (directory / "ownership_registry.cjs").write_bytes(registry.read_bytes())
    (directory / "probe.cjs").write_text(source)
    panel = tmp_path / "podvoice/gatekeeper/static"
    panel.mkdir(parents=True)
    (panel / "index.html").write_text("fixture HTML; no copied controller")
    proof = tmp_path / "proof"
    proof.mkdir()
    return tmp_path, proof, node


def test_inventory_and_serial_gate_binding(monkeypatch, tmp_path):
    assert browser_gate.INVENTORY == ("live_status", "daily_ui", "wake_words", "settings_dirty")
    assert all(
        (Path(__file__).resolve().parents[1] / "browser" / (name + ".cjs")).is_file()
        for name in browser_gate.INVENTORY
    )
    observed = []
    monkeypatch.setattr(dev_cycle, "sibling_tool", lambda _python, name: name)
    monkeypatch.setattr(
        dev_cycle, "run_parallel", lambda *_args: observed.append("parallel-joined")
    )
    monkeypatch.setattr(
        dev_cycle, "browser_recipe", lambda _root, _env, bound: observed.append(bound)
    )
    monkeypatch.setattr(dev_cycle, "diff_check", lambda *_args: observed.append("scope-check"))
    snapshot = dev_cycle.ScopeSnapshot(
        "head", "base", ("tests/browser/settings_dirty.cjs",), "", ()
    )
    dev_cycle.run_release(tmp_path, {}, sys.executable, snapshot)
    assert observed == ["parallel-joined", 240, "scope-check"]
    assert not dev_cycle.browser_scope(["podvoice/gatekeeper/thin.py"])
    assert dev_cycle.browser_scope(["podvoice/gatekeeper/static/index.html"])
    caches = dev_cycle.cache_paths(tmp_path, "ui-browser")
    assert "ui-browser" in dev_cycle.GATE_CACHE_STAGES
    assert caches["browser"] == tmp_path / "browser/ui-browser"
    assert caches["browser-proof"] == tmp_path / "browser-proof/ui-browser"


SPAWN = """const cp=require('node:child_process');
const child=cp.spawn(process.env.PODVOICE_TEST_CHROMIUM,
 ['-c','import sys; sys.stdin.read()'],{detached:true,stdio:['pipe','ignore','ignore']});
child.on('exit',()=>{child.stdin.destroy();});
"""


def release_registered_child(monkeypatch):
    original = browser_gate.Registry.receive

    def receive(self, line):
        original(self, line)
        entry = json.loads(line)
        if entry.get("kind") == "launch" and not self.failure:
            # This test owns the real fixture child. Release only after the actual
            # preloader registry and native identity have admitted its group.
            os.kill(entry["pid"], signal.SIGTERM)

    monkeypatch.setattr(browser_gate.Registry, "receive", receive)


def test_actual_preloader_records_real_group_and_joins(monkeypatch, tmp_path):
    root, proof, node = fixture_root(tmp_path, SPAWN)
    release_registered_child(monkeypatch)
    receipt = browser_gate.run_worker(
        root, dict(os.environ), node, sys.executable, "probe", 15, proof
    )
    assert receipt["status"] == "PASS"
    assert receipt["cleanup_complete"] is True
    assert len(receipt["joined_groups"]) == 1
    assert all(not browser_gate.group_exists(group) for group in receipt["joined_groups"])
    assert receipt["registered_groups"][0]["parent"] > 1


def test_failed_registry_is_failure_with_bounded_owned_worker_join(tmp_path):
    source = """require('node:fs').writeSync(Number(process.env.PODVOICE_BROWSER_REGISTRY_FD),
 JSON.stringify({kind:'launch',nonce:'wrong-owner',worker:process.pid,sequence:1,pid:1,group:1})+'\\n');
setInterval(()=>{},1000);"""
    root, proof, node = fixture_root(tmp_path, source)
    with pytest.raises(browser_gate.BrowserGateError, match="mismatch"):
        browser_gate.run_worker(root, dict(os.environ), node, sys.executable, "probe", 15, proof)
    receipt = json.loads((proof / "receipt.json").read_text())
    assert receipt["status"] == "FAIL"
    assert receipt["cleanup_complete"] is False
    assert receipt["joined_groups"] == []


def test_cancel_before_launch_cannot_pass(monkeypatch, tmp_path):
    root, proof, node = fixture_root(tmp_path, "setInterval(()=>{},1000);")
    original = browser_gate.Registry.receive

    def receive(self, line):
        original(self, line)
        if json.loads(line)["kind"] == "ready":
            os.kill(os.getpid(), signal.SIGTERM)

    monkeypatch.setattr(browser_gate.Registry, "receive", receive)
    with pytest.raises(browser_gate.BrowserGateError, match="canceled"):
        browser_gate.run_worker(root, dict(os.environ), node, sys.executable, "probe", 15, proof)
    receipt = json.loads((proof / "receipt.json").read_text())
    assert receipt["status"] == "FAIL"
    assert receipt["cleanup_complete"] is False


def test_cleanup_failure_overrides_green_assertions(monkeypatch, tmp_path):
    root, proof, node = fixture_root(tmp_path, SPAWN)
    release_registered_child(monkeypatch)
    original = browser_gate.Registry.cleanup

    def cleanup(self, canceled):
        original(self, canceled)
        raise browser_gate.BrowserGateError("injected cleanup failure")

    monkeypatch.setattr(browser_gate.Registry, "cleanup", cleanup)
    with pytest.raises(browser_gate.BrowserGateError, match="injected cleanup failure"):
        browser_gate.run_worker(root, dict(os.environ), node, sys.executable, "probe", 15, proof)
    receipt = json.loads((proof / "receipt.json").read_text())
    assert receipt["status"] == "FAIL"
    assert receipt["cleanup_complete"] is False


def test_unverifiable_orphan_boundary_never_kills_registered_group(monkeypatch):
    # Directly owned worker remains alive, so this tests the opposite browser
    # identity boundary without deliberately leaving actual orphan processes.
    with subprocess.Popen(
        [sys.executable, "-c", "import sys; sys.stdin.read()"],
        stdin=subprocess.PIPE,
        start_new_session=True,
    ) as worker:
        registry = browser_gate.Registry(worker, "owned-invocation")
        registry.groups[worker.pid] = registry.worker_identity
        called = []
        original_identity = browser_gate.identity
        monkeypatch.setattr(
            browser_gate,
            "identity",
            lambda pid: None if pid == worker.pid else original_identity(pid),
        )
        monkeypatch.setattr(browser_gate.os, "killpg", lambda *args: called.append(args))
        with pytest.raises(browser_gate.BrowserGateError, match="unverifiable"):
            registry.signal_browser(worker.pid, signal.SIGKILL)
        assert called == []
        assert worker.poll() is None
        worker.stdin.close()
        worker.wait(timeout=5)


# Pipe-independent inert child: surviving Node exit is the actual orphan case.
# Its lifetime is bounded; actual preloader admission authorizes fixture custody.
DETACHED_INERT = """const cp=require('node:child_process');
process.on('SIGTERM',()=>{});
process.on('SIGUSR2',()=>process.exit(0));
const child=cp.spawn(process.env.PODVOICE_TEST_CHROMIUM,
 ['-c','import time; time.sleep(30)'],{detached:true,stdio:'ignore'});
child.on('exit',()=>process.exit(0));
"""


def cleanup_admitted_fixture(admissions, proof):
    """Fixture custody only; never rewrites the actual gate's failing receipt.

    After tracked worker exit only PPID may change by OS adoption; the exact
    admitted PID/birth/group/UID stays required before every signal. A live
    worker must remain fresh. Unknown/reused/leaderless identities fail closed.
    The separate rescue receipt cannot count as orphan gate acceptance.
    """
    started = time.monotonic()
    deadline = started + browser_gate.CLEANUP_SECONDS
    gate_receipt = proof / "receipt.json"
    gate_before = gate_receipt.read_bytes() if gate_receipt.exists() else None
    rescued, complete = [], False
    try:
        for registry, admitted in admissions:
            item = {
                "admitted": {
                    "pid": admitted.pid,
                    "parent": admitted.parent,
                    "group": admitted.group,
                    "born": admitted.born,
                    "uid": admitted.uid,
                },
                "signals": [],
                "joined": False,
            }
            rescued.append(item)
            for sig in (signal.SIGTERM, signal.SIGKILL):
                if not browser_gate.group_exists(admitted.group):
                    break
                current = browser_gate.identity(admitted.pid)
                assert current is not None, "unverifiable fixture leader; no kill authorized"
                assert (current.pid, current.group, current.born, current.uid) == (
                    admitted.pid,
                    admitted.group,
                    admitted.born,
                    admitted.uid,
                ), "fixture identity changed; no kill authorized"
                terminal = registry.worker.poll() is not None
                assert terminal or registry.fresh_worker(), (
                    "fixture worker changed; no kill authorized"
                )
                assert current.parent == admitted.parent or terminal, (
                    "fixture parent changed before tracked worker exit; no kill authorized"
                )
                item["signals"].append(
                    {
                        "signal": int(sig),
                        "pid": current.pid,
                        "parent": current.parent,
                        "group": current.group,
                        "born": current.born,
                        "uid": current.uid,
                        "tracked_worker_terminal": terminal,
                    }
                )
                os.killpg(admitted.group, sig)
                join_bound = min(deadline, time.monotonic() + 3)
                while browser_gate.group_exists(admitted.group) and time.monotonic() < join_bound:
                    time.sleep(0.01)
            assert not browser_gate.group_exists(admitted.group), "known fixture group did not join"
            item["joined"] = True
            if registry.worker.poll() is None:
                assert registry.fresh_worker(), "fixture worker changed; no kill authorized"
                os.killpg(registry.worker.pid, signal.SIGKILL)
                registry.worker.wait(timeout=min(2, max(0.01, deadline - time.monotonic())))
            assert not browser_gate.group_exists(registry.worker.pid), "fixture worker did not join"
        assert time.monotonic() < deadline, "fixture custody exceeded existing cleanup bound"
        complete = True
    finally:
        gate_after = gate_receipt.read_bytes() if gate_receipt.exists() else None
        (proof / "fixture-rescue.json").write_text(
            json.dumps(
                {
                    "purpose": "test-fixture custody only; never gate/orphan acceptance",
                    "status": "CUSTODY_JOINED" if complete else "CUSTODY_INCOMPLETE",
                    "elapsed_seconds": time.monotonic() - started,
                    "bound_seconds": browser_gate.CLEANUP_SECONDS,
                    "gate_receipt_unchanged": gate_before == gate_after,
                    "gate_receipt_sha256": hashlib.sha256(gate_after).hexdigest()
                    if gate_after
                    else None,
                    "groups": rescued,
                },
                indent=2,
            )
            + "\n"
        )
        assert gate_before == gate_after, "fixture rescue must preserve actual failing gate receipt"


def observe_admitted_fixture(monkeypatch, action):
    original = browser_gate.Registry.receive
    admissions = []

    def receive(self, line):
        original(self, line)
        entry = json.loads(line)
        if entry.get("kind") == "launch" and not self.failure:
            admitted = self.groups[entry["pid"]]
            admissions.append((self, admitted))
            action(self)

    monkeypatch.setattr(browser_gate.Registry, "receive", receive)
    return admissions


def test_actual_detached_group_cancel_joins_admitted_identity(monkeypatch, tmp_path):
    root, proof, node = fixture_root(tmp_path, DETACHED_INERT)
    admissions = observe_admitted_fixture(
        monkeypatch, lambda _registry: os.kill(os.getpid(), signal.SIGTERM)
    )
    signals = []
    original_signal = browser_gate.Registry.signal_browser

    def signal_browser(self, group, sig):
        signals.append((group, sig, self.fresh_worker(), browser_gate.identity(group)))
        return original_signal(self, group, sig)

    monkeypatch.setattr(browser_gate.Registry, "signal_browser", signal_browser)
    started = time.monotonic()
    try:
        with pytest.raises(browser_gate.BrowserGateError, match="canceled"):
            browser_gate.run_worker(
                root, dict(os.environ), node, sys.executable, "probe", 15, proof
            )
        receipt = json.loads((proof / "receipt.json").read_text())
        assert len(admissions) == 1
        registry, admitted = admissions[0]
        assert receipt["status"] == "FAIL", "cancellation must never report PASS"
        assert receipt["cleanup_complete"] is True
        assert receipt["joined_groups"] == [admitted.group]
        assert "incomplete cleanup" not in receipt["failure"]
        assert signals == [(admitted.group, signal.SIGTERM, True, admitted)]
        assert registry.worker.poll() is not None
        assert not browser_gate.group_exists(admitted.group)
        assert not browser_gate.group_exists(registry.worker.pid)
        assert time.monotonic() - started < browser_gate.CLEANUP_SECONDS
    finally:
        cleanup_admitted_fixture(admissions, proof)


def test_actual_admitted_orphan_after_worker_exit_requires_bounded_join(monkeypatch, tmp_path):
    """Expected RED on current gate; never xfail/skip or easier cancel proof."""
    root, proof, node = fixture_root(tmp_path, DETACHED_INERT)
    admissions = observe_admitted_fixture(
        monkeypatch, lambda registry: registry.worker.send_signal(signal.SIGUSR2)
    )
    started = time.monotonic()
    try:
        # Admitted actual detached launch -> tracked Node exit -> live orphan.
        # Current fresh_worker veto throws; acceptance requires actual known join.
        receipt = browser_gate.run_worker(
            root, dict(os.environ), node, sys.executable, "probe", 15, proof
        )
        assert len(admissions) == 1
        registry, admitted = admissions[0]
        assert registry.worker.poll() == 0
        assert receipt["status"] == "PASS"
        assert receipt["cleanup_complete"] is True
        assert receipt["joined_groups"] == [admitted.group]
        assert not browser_gate.group_exists(admitted.group)
        assert not browser_gate.group_exists(registry.worker.pid)
        assert time.monotonic() - started < browser_gate.CLEANUP_SECONDS
    finally:
        # Known fixture custody prevents a RED repro leaking its child. It does
        # not turn FAIL/incomplete_cleanup in receipt.json into PASS.
        cleanup_admitted_fixture(admissions, proof)


@pytest.mark.parametrize("terminal", [False, True])
@pytest.mark.parametrize("change", ["unknown", "leaderless", "pid", "group", "birth", "uid"])
def test_signal_browser_rejects_unknown_or_changed_admitted_identity(monkeypatch, terminal, change):
    """Known admission never grants authority to a missing/reused/different leader."""
    from dataclasses import replace
    from types import SimpleNamespace

    worker_pid, leader_pid = 41001, 41002
    worker_owner = browser_gate.Identity(worker_pid, os.getpid(), worker_pid, (100, 1), os.getuid())
    leader_owner = browser_gate.Identity(leader_pid, worker_pid, leader_pid, (100, 2), os.getuid())
    current = {worker_pid: worker_owner, leader_pid: leader_owner}
    worker = SimpleNamespace(pid=worker_pid, poll=lambda: 0 if terminal else None)
    monkeypatch.setattr(browser_gate, "identity", current.get)
    signals = []
    monkeypatch.setattr(browser_gate.os, "killpg", lambda *args: signals.append(args))
    registry = browser_gate.Registry(worker, "exact-invocation")
    registry.receive(
        json.dumps(
            {"kind": "ready", "nonce": registry.nonce, "worker": worker_pid, "sequence": 0}
        ).encode()
    )
    registry.receive(
        json.dumps(
            {
                "kind": "launch",
                "nonce": registry.nonce,
                "worker": worker_pid,
                "sequence": 1,
                "pid": leader_pid,
                "group": leader_pid,
            }
        ).encode()
    )
    assert registry.failure is None and registry.groups[leader_pid] == leader_owner
    target = leader_pid
    if change == "unknown":
        target += 1
    elif change == "leaderless":
        current[leader_pid] = None
        monkeypatch.setattr(browser_gate, "group_exists", lambda _group: True)
    else:
        updates = {
            "pid": leader_pid + 1,
            "group": leader_pid + 1,
            "birth": (100, 3),
            "uid": os.getuid() + 1,
        }
        current[leader_pid] = replace(
            leader_owner, **{("born" if change == "birth" else change): updates[change]}
        )
    with pytest.raises(browser_gate.BrowserGateError, match="no kill authorized"):
        registry.signal_browser(target, signal.SIGKILL)
    assert signals == []


@pytest.mark.parametrize("change", ["parent", "worker_birth"])
def test_live_worker_retains_exact_freshness_and_parent_boundary(monkeypatch, change):
    from dataclasses import replace
    from types import SimpleNamespace

    worker_pid, leader_pid = 41001, 41002
    worker_owner = browser_gate.Identity(worker_pid, os.getpid(), worker_pid, (100, 1), os.getuid())
    leader_owner = browser_gate.Identity(leader_pid, worker_pid, leader_pid, (100, 2), os.getuid())
    current = {worker_pid: worker_owner, leader_pid: leader_owner}
    worker = SimpleNamespace(pid=worker_pid, poll=lambda: None)
    monkeypatch.setattr(browser_gate, "identity", current.get)
    signals = []
    monkeypatch.setattr(browser_gate.os, "killpg", lambda *args: signals.append(args))
    registry = browser_gate.Registry(worker, "live-invocation")
    registry.receive(
        json.dumps(
            {"kind": "ready", "nonce": registry.nonce, "worker": worker_pid, "sequence": 0}
        ).encode()
    )
    registry.receive(
        json.dumps(
            {
                "kind": "launch",
                "nonce": registry.nonce,
                "worker": worker_pid,
                "sequence": 1,
                "pid": leader_pid,
                "group": leader_pid,
            }
        ).encode()
    )
    assert registry.failure is None
    if change == "parent":
        current[leader_pid] = replace(leader_owner, parent=1)
    else:
        current[worker_pid] = replace(worker_owner, born=(100, 3))
    with pytest.raises(browser_gate.BrowserGateError, match="no kill authorized"):
        registry.signal_browser(leader_pid, signal.SIGTERM)
    assert signals == []


@pytest.mark.parametrize("mismatch", ["nonce", "sequence"])
def test_stale_registry_record_cannot_admit_signal_authority(monkeypatch, mismatch):
    from types import SimpleNamespace

    worker_pid, leader_pid = 41001, 41002
    current = {
        worker_pid: browser_gate.Identity(
            worker_pid, os.getpid(), worker_pid, (100, 1), os.getuid()
        ),
        leader_pid: browser_gate.Identity(
            leader_pid, worker_pid, leader_pid, (100, 2), os.getuid()
        ),
    }
    monkeypatch.setattr(browser_gate, "identity", current.get)
    signals = []
    monkeypatch.setattr(browser_gate.os, "killpg", lambda *args: signals.append(args))
    registry = browser_gate.Registry(
        SimpleNamespace(pid=worker_pid, poll=lambda: 0), "current-invocation"
    )
    registry.receive(
        json.dumps(
            {"kind": "ready", "nonce": registry.nonce, "worker": worker_pid, "sequence": 0}
        ).encode()
    )
    entry = {
        "kind": "launch",
        "nonce": registry.nonce,
        "worker": worker_pid,
        "sequence": 1,
        "pid": leader_pid,
        "group": leader_pid,
    }
    entry[mismatch] = "old-invocation" if mismatch == "nonce" else 0
    registry.receive(json.dumps(entry).encode())
    assert registry.failure == "registry invocation/sequence mismatch"
    assert registry.groups == {}
    with pytest.raises(browser_gate.BrowserGateError, match="not admitted"):
        registry.signal_browser(leader_pid, signal.SIGTERM)
    assert signals == []


@pytest.mark.parametrize("assertion_failure", [False, True])
def test_prelaunch_exit_retains_primary_failure_and_registry_deficiency(
    tmp_path, assertion_failure
):
    source = (
        "require('node:assert/strict').equal(1,2,'fixture prelaunch assertion');"
        if assertion_failure
        else "process.exit(0);"
    )
    root, proof, node = fixture_root(tmp_path, source)
    with pytest.raises(
        browser_gate.BrowserGateError, match="missing/failed browser owner registry"
    ):
        browser_gate.run_worker(root, dict(os.environ), node, sys.executable, "probe", 15, proof)
    receipt = json.loads((proof / "receipt.json").read_text())
    assert receipt["status"] == "FAIL" and receipt["cleanup_complete"] is False
    assert receipt["registered_groups"] == [] and receipt["joined_groups"] == []
    assert receipt["registry_failure"] == "missing/failed browser owner registry"
    if assertion_failure:
        assert receipt["worker_returncode"] == 1
        assert receipt["worker_failure"] == "browser assertions failed (worker exit 1)"
        assert receipt["failure"].startswith(receipt["worker_failure"])
        assert "fixture prelaunch assertion" in (proof / "worker.log").read_text()
    else:
        assert receipt["worker_returncode"] == 0 and receipt["worker_failure"] is None
        assert receipt["failure"] == receipt["registry_failure"]


def test_terminal_parent_adoption_never_caches_authority_for_later_signal(monkeypatch):
    from dataclasses import replace
    from types import SimpleNamespace

    worker_pid, leader_pid = 41001, 41002
    worker_owner = browser_gate.Identity(worker_pid, os.getpid(), worker_pid, (100, 1), os.getuid())
    leader_owner = browser_gate.Identity(leader_pid, worker_pid, leader_pid, (100, 2), os.getuid())
    current = {worker_pid: worker_owner, leader_pid: leader_owner}
    terminal = False
    worker = SimpleNamespace(pid=worker_pid, poll=lambda: 0 if terminal else None)
    monkeypatch.setattr(browser_gate, "identity", current.get)
    signals = []
    monkeypatch.setattr(browser_gate.os, "killpg", lambda *args: signals.append(args))
    registry = browser_gate.Registry(worker, "adopted-invocation")
    registry.receive(
        json.dumps(
            {"kind": "ready", "nonce": registry.nonce, "worker": worker_pid, "sequence": 0}
        ).encode()
    )
    registry.receive(
        json.dumps(
            {
                "kind": "launch",
                "nonce": registry.nonce,
                "worker": worker_pid,
                "sequence": 1,
                "pid": leader_pid,
                "group": leader_pid,
            }
        ).encode()
    )
    assert registry.failure is None
    terminal = True
    current[leader_pid] = replace(leader_owner, parent=1)
    registry.signal_browser(leader_pid, signal.SIGTERM)
    assert signals == [(leader_pid, signal.SIGTERM)]
    current[leader_pid] = replace(current[leader_pid], born=(100, 3))
    with pytest.raises(browser_gate.BrowserGateError, match="no kill authorized"):
        registry.signal_browser(leader_pid, signal.SIGKILL)
    assert signals == [(leader_pid, signal.SIGTERM)]
