"""Private bounded persistence with inert data and no providers/household calls."""

import asyncio
import json
import os
import threading

import pytest

from gatekeeper import podview_client_diagnostics as module
from gatekeeper.podview_controls import failure

UUID = "01234567-0123-4567-89ab-0123456789ab"
SETUP_REASONS = (
    "busy",
    "scope_not_paired",
    "target_not_granted",
    "stale_setup",
    "setup_capacity",
    "setup_unavailable",
    "invalid_setup",
    "invalid_target",
)


def value(index=0, **changes):
    return {
        "schema": "podview.client-diagnostics.v1",
        "batchId": f"{index:08x}-0123-4567-89ab-0123456789ab",
        "roomId": "PRIVATE_room",
        "bootId": "b" * 32,
        "uiBuild": None,
        "records": [{"stage": "request", "code": "timeout", "seq": 1, "ageMs": 0}],
        **changes,
    }


def parsed(index=0, **changes):
    return module.parse_batch(json.dumps(value(index, **changes)).encode())


@pytest.mark.parametrize("reason", SETUP_REASONS)
@pytest.mark.parametrize("stage", ["control_setup", "volume_setup"])
async def test_setup_failure_code_survives_existing_store_and_read(store, reason, stage):
    owner, _ = store
    source = failure(reason)
    assert source == {"ok": False, "error": reason, "retryAllowed": False}
    row = {
        "stage": stage,
        "code": source["error"],
        "seq": 1,
        "ageMs": 0,
        "endpoint": "control/setup",
        "httpStatus": 200,
        "current": stage == "volume_setup",
        "durationMs": 179,
    }
    batch = parsed(records=[row])
    assert (await owner.append(batch, "principal", lambda: True))["stored"] is True
    result = await owner.read(batch.room, 0, lambda: True)
    assert result["records"][0]["row"] == row


@pytest.mark.parametrize("reason", SETUP_REASONS)
def test_setup_failure_code_does_not_admit_unknown_or_private_variants(reason):
    with pytest.raises(module.DiagnosticFailure) as error:
        parsed(
            records=[{"stage": "control_setup", "code": reason + "_PRIVATE", "seq": 1, "ageMs": 0}]
        )
    assert error.value.status == 400 and "PRIVATE" not in str(error.value)


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(module, "runtime_artifact_identity", lambda: ("rootfs-v1", "c" * 64))
    clock = [1000000.0]
    result = module.ClientDiagnosticsStore(
        tmp_path / "private" / "records.json", clock=lambda: clock[0]
    )
    return result, clock


@pytest.mark.parametrize(
    "key,bad",
    [
        ("seq", True),
        ("seq", 0),
        ("ageMs", -1),
        ("ageMs", module.MAX_AGE_MS + 1),
        ("durationMs", 120001),
        ("count", 65),
        ("httpStatus", 99),
        ("current", 1),
        ("stage", ["request"]),
        ("code", "PRIVATE"),
        ("endpoint", "https://PRIVATE"),
        ("kind", {}),
        ("requestId", "PRIVATE"),
        ("requestRef", "f" * 16),
        ("restored", False),
    ],
)
def test_closed_rows_reject_private_or_wrong_types(key, bad):
    body = value()
    body["records"][0][key] = bad
    with pytest.raises(module.DiagnosticFailure) as error:
        module.parse_batch(json.dumps(body).encode())
    assert error.value.status == 400 and "PRIVATE" not in str(error.value)


@pytest.mark.parametrize(
    "raw", [b'{"schema":1,"schema":2}', b'{"records":[NaN]}', b"[" * 2000, b"{}" * 5000]
)
def test_json_duplicates_nonfinite_depth_and_bound_are_rejected(raw):
    with pytest.raises(module.DiagnosticFailure):
        module.parse_batch(raw)


@pytest.mark.parametrize("encoding", ["utf-16", "utf-32"])
def test_wire_json_requires_utf8_instead_of_json_autodetection(encoding):
    with pytest.raises(module.DiagnosticFailure) as error:
        module.parse_batch(json.dumps(value()).encode(encoding))
    assert error.value.status == 400


async def test_dedup_window_does_not_stop_automatic_logging_after_128_batches(store):
    owner, clock = store
    for index in range(129):
        clock[0] += 10
        assert (await owner.append(parsed(index), "principal", lambda: True))["stored"]
    before = owner.path.read_bytes()
    restarted = module.ClientDiagnosticsStore(owner.path, clock=lambda: clock[0])
    assert (await restarted.append(parsed(128), "principal", lambda: True))["duplicate"] is True
    assert owner.path.read_bytes() == before
    with pytest.raises(module.DiagnosticFailure) as error:
        await restarted.append(parsed(128, uiBuild="changed"), "principal", lambda: True)
    assert error.value.status == 409
    data = json.loads(owner.path.read_bytes())
    assert len(data["batches"]) <= 31 and len(data["records"]) == 129
    clock[0] += 301
    assert (await restarted.append(parsed(128), "principal", lambda: True))["duplicate"] is False


async def test_genuinely_full_unexpired_dedup_backstop_remains_closed(store):
    owner, clock = store
    with owner._locked() as directory:
        data = owner._load(directory)
        data["batches"] = [
            {
                "key": f"{index:064x}",
                "digest": "d" * 64,
                "principalRef": "a" * 16,
                "receivedAtMs": int(clock[0] * 1000) - 61000,
                "count": 1,
            }
            for index in range(128)
        ]
        owner._write(directory, data)
    before = owner.path.read_bytes()
    with pytest.raises(module.DiagnosticFailure) as error:
        await owner.append(parsed(), "principal", lambda: True)
    assert error.value.status == 429 and owner.path.read_bytes() == before


async def test_restart_same_batch_hashes_correlation_and_is_durable(store):
    owner, clock = store
    body = value()
    body["records"][0].update(requestId=UUID, current=False, count=0)
    batch = module.parse_batch(json.dumps(body).encode())
    ack = await owner.append(batch, "ha:PRIVATE_user", lambda: True)
    assert ack["stored"] is True and ack["duplicate"] is False
    raw = owner.path.read_bytes()
    assert b"PRIVATE" not in raw and UUID.encode() not in raw
    assert owner.path.stat().st_mode & 0o777 == 0o600
    assert owner.path.parent.stat().st_mode & 0o777 == 0o700
    restarted = module.ClientDiagnosticsStore(owner.path, clock=lambda: clock[0])
    assert await restarted.append(batch, "ha:PRIVATE_user", lambda: True) == {
        **ack,
        "duplicate": True,
    }
    assert restarted.path.read_bytes() == raw
    result = await restarted.read("PRIVATE_room", 0, lambda: True)
    assert result["records"][0]["row"]["current"] is False
    assert result["records"][0]["artifactKind"] == "rootfs-v1"
    assert result["records"][0]["artifactSha256"] == "c" * 64


async def test_rate_limits_survive_restart_and_are_global_and_per_principal(store):
    owner, clock = store
    await owner.append(parsed(), "one", lambda: True)
    restarted = module.ClientDiagnosticsStore(owner.path, clock=lambda: clock[0])
    with pytest.raises(module.DiagnosticFailure) as error:
        await restarted.append(parsed(1), "one", lambda: True)
    assert error.value.status == 429
    for index in range(1, 12):
        await restarted.append(parsed(index), str(index), lambda: True)
    with pytest.raises(module.DiagnosticFailure) as error:
        await restarted.append(parsed(12), "new", lambda: True)
    assert error.value.status == 429
    clock[0] += 61
    assert (await restarted.append(parsed(12), "one", lambda: True))["stored"]


async def test_retention_count_byte_budget_paging_and_room_isolation(store, monkeypatch):
    owner, clock = store
    for index in range(34):
        clock[0] += 61
        await owner.append(
            parsed(
                index,
                records=[
                    {"stage": "browser", "code": "error", "seq": seq, "ageMs": 0}
                    for seq in range(1, 17)
                ],
            ),
            "principal",
            lambda: True,
        )
    data = json.loads(owner.path.read_bytes())
    assert len(data["records"]) <= 512 and owner.path.stat().st_size <= module.MAX_BYTES
    first = await owner.read("PRIVATE_room", 0, lambda: True)
    second = await owner.read("PRIVATE_room", first["nextAfter"], lambda: True)
    assert len(first["records"]) == 64 and first["hasMore"]
    assert second["records"][0]["serverSeq"] > first["nextAfter"]
    assert (await owner.read("other", 0, lambda: True))["records"] == []
    monkeypatch.setattr(module, "MAX_BYTES", owner.path.stat().st_size + 500)
    clock[0] += 61
    await owner.append(parsed(35), "principal", lambda: True)
    assert owner.path.stat().st_size <= module.MAX_BYTES
    clock[0] += module.MAX_AGE_MS / 1000 + 1
    assert (await owner.read("PRIVATE_room", 0, lambda: True))["records"] == []
    assert json.loads(owner.path.read_bytes())["batches"] == []


@pytest.mark.parametrize("unsafe", ["mode", "symlink", "corrupt", "fifo", "oversize"])
async def test_unsafe_or_corrupt_storage_never_resets_or_reflects_content(store, unsafe):
    owner, _ = store
    owner.path.parent.mkdir(mode=0o700)
    if unsafe == "symlink":
        target = owner.path.parent / "target"
        target.write_text("PRIVATE_secret")
        owner.path.symlink_to(target)
    elif unsafe == "fifo":
        os.mkfifo(owner.path, 0o600)
    else:
        owner.path.write_bytes(
            b"x" * (module.MAX_BYTES + 1) if unsafe == "oversize" else b"PRIVATE_secret"
        )
        owner.path.chmod(0o644 if unsafe == "mode" else 0o600)
    with pytest.raises(module.DiagnosticFailure) as error:
        await owner.append(parsed(), "principal", lambda: True)
    assert error.value.status == 503 and "PRIVATE" not in str(error.value)


@pytest.mark.parametrize("barrier", [1, 2, 3])
async def test_failed_file_directory_or_parent_sync_never_gets_fake_ack(
    store, monkeypatch, barrier
):
    owner, _ = store
    original, calls = module.os.fsync, []

    def fail(fd):
        calls.append(fd)
        if len(calls) >= barrier:
            raise OSError("PRIVATE_disk_error")
        return original(fd)

    monkeypatch.setattr(module.os, "fsync", fail)
    with pytest.raises(module.DiagnosticFailure):
        await owner.append(parsed(), "principal", lambda: True)
    # A renamed-but-not-directory-durable batch must still not get a duplicate ACK.
    with pytest.raises(module.DiagnosticFailure):
        await owner.append(parsed(), "principal", lambda: True)
    monkeypatch.setattr(module.os, "fsync", original)
    ack = await owner.append(parsed(), "principal", lambda: True)
    assert ack["stored"] and ack["duplicate"] is (barrier != 1)
    assert not list(owner.path.parent.glob("records.json.*[0-9a-f]"))


async def test_cancelled_http_waiter_keeps_worker_slot_and_current_guard(store, monkeypatch):
    owner, _ = store
    entered, release = threading.Event(), threading.Event()
    original = owner._load
    current = [True]

    def held(directory):
        entered.set()
        assert release.wait(5)
        return original(directory)

    monkeypatch.setattr(owner, "_load", held)
    pending = asyncio.create_task(owner.append(parsed(), "principal", lambda: current[0]))
    await asyncio.to_thread(entered.wait, 2)
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    with pytest.raises(module.DiagnosticFailure) as error:
        await owner.append(parsed(1), "principal", lambda: True)
    assert error.value.status == 429
    worker = owner._pending
    current[0] = False
    release.set()
    with pytest.raises(module.DiagnosticFailure):
        await worker
    assert not owner.path.exists()


async def test_startup_retention_is_durable_without_an_http_read(store):
    owner, clock = store
    await owner.append(parsed(), "principal", lambda: True)
    clock[0] += module.MAX_AGE_MS / 1000 + 1
    restarted = module.ClientDiagnosticsStore(owner.path, clock=lambda: clock[0])
    await restarted.prune()
    assert json.loads(owner.path.read_bytes())["records"] == []
    assert json.loads(owner.path.read_bytes())["batches"] == []
