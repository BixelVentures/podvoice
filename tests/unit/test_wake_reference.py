"""Diagnostic references never enter a normal microphone or provider path."""

import base64
import json
import zlib

import pytest

from gatekeeper.wake_reference import WakeReferenceAssembler

OWNER = "0123456789abcdef0123456789abcdef"
SESSION = "private-session"


def chunks(pcm=b"\x01\x00" * 400, **overrides):
    """Frozen firmware v1: whole-snapshot offsets and IEEE CRC repeat per chunk."""
    count = (len(pcm) + 767) // 768
    metadata = {
        "v": 1,
        "status": "ok",
        "owner": OWNER,
        "generation": 7,
        "epoch": 2,
        "detector_run": 3,
        "sample_start": 4000,
        "sample_end": 4000 + len(pcm) // 2,
        "detected_ms": 998,
        "delivered_ms": 999,
        "captured_ms": 1000,
        "expires_ms": 16000,
        "total": count,
        "bytes": len(pcm),
        "crc32": f"{zlib.crc32(pcm):08x}",
    }
    metadata.update(overrides)
    return [
        {
            **metadata,
            "seq": index,
            "pcm": base64.b64encode(pcm[index * 768 : (index + 1) * 768]).decode(),
        }
        for index in range(count)
    ]


def started():
    assembler = WakeReferenceAssembler()
    connection = object()
    assembler.begin(OWNER, 7, now=100, connection=connection, epoch=99, session_id=SESSION)
    return assembler, connection


def feed(assembler, bound_connection, data, *, now=101, **context):
    return assembler.feed(
        json.dumps(data),
        now=now,
        **{"connection": bound_connection, "epoch": 99, "session_id": SESSION, **context},
    )


@pytest.mark.parametrize("size", [2, 768, 800, 48000])
def test_complete_bounded_reference_exact_bytes_and_metadata_once(size):
    assembler, connection = started()
    pcm = bytes(index % 256 for index in range(size))
    records = chunks(pcm)
    for row in records[:-1]:
        assert feed(assembler, connection, row) is None
    result = feed(assembler, connection, records[-1])
    assert result.pcm == pcm
    assert result.metadata["sample_end"] - result.metadata["sample_start"] == size // 2
    assert result.metadata["generation"] == 7
    assert "pcm" not in result.metadata and "seq" not in result.metadata
    assert repr(result) == "CompletedWakeReference()"
    assert assembler.snapshot() == {
        "state": "complete",
        "error": None,
        "received_chunks": len(records),
        "received_bytes": size,
        "total_chunks": len(records),
    }
    assert not assembler._pcm
    assert feed(assembler, connection, records[-1]) is None


def test_explicit_missing_is_metadata_only_and_clock_wrap_is_valid():
    assembler, connection = started()
    row = chunks(b"\0\0")[0]
    row.update(status="missing", sample_end=4000, total=0, bytes=0, pcm="", crc32="00000000")
    row.update(captured_ms=0xFFFFFFF0, expires_ms=(0xFFFFFFF0 + 15000) & 0xFFFFFFFF)
    result = feed(assembler, connection, row)
    assert result.pcm == b"" and result.metadata["status"] == "missing"
    assert assembler.snapshot()["state"] == "missing"


@pytest.mark.parametrize(
    "context",
    [
        {"connection": object()},
        {"epoch": 98},
        {"session_id": "next-session"},
    ],
)
def test_current_host_identity_must_match_request_and_failure_releases_audio(context):
    assembler, connection = started()
    rows = chunks()
    feed(assembler, connection, rows[0])
    assert feed(assembler, connection, rows[1], **context) is None
    assert assembler.snapshot()["error"] == "host_identity"
    assert not assembler._pcm


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("owner", "f" * 32),
        ("generation", 8),
        ("generation", True),
        ("v", True),
        ("v", 2),
        ("epoch", -1),
        ("detector_run", 2**32),
        ("captured_ms", 2**32),
        ("expires_ms", 16001),
        ("sample_start", -1),
        ("sample_end", 2**64),
        ("sample_end", 4399),
        ("bytes", 48002),
        ("bytes", 799),
        ("bytes", True),
        ("total", 64),
        ("seq", -1),
        ("seq", True),
        ("total", 0),
        ("crc32", "FFFFFFFF"),
        ("status", "secret-status"),
        ("pcm", "secret-not-base64"),
        ("pcm", base64.b64encode(b"x" * 769).decode()),
        ("pcm", base64.b64encode(b"x").decode()),
    ],
)
def test_invalid_schema_is_contained_and_seals_request(field, value):
    assembler, connection = started()
    row = chunks()[0]
    row[field] = value
    assert feed(assembler, connection, row) is None
    assert assembler.snapshot()["state"] == "invalid"
    assert not assembler._pcm
    assert feed(assembler, connection, chunks()[0]) is None


@pytest.mark.parametrize("failure", ["duplicate", "gap", "metadata", "crc", "short", "overflow"])
def test_chunk_order_identity_and_whole_crc(failure):
    assembler, connection = started()
    rows = chunks()
    if failure == "crc":
        for row in rows:
            row["crc32"] = "00000000"
    if failure == "short":
        rows[1]["pcm"] = base64.b64encode(b"\0\0").decode()
    if failure == "overflow":
        rows[1]["pcm"] = rows[0]["pcm"]
    if failure == "gap":
        assert feed(assembler, connection, rows[1]) is None
    else:
        assert feed(assembler, connection, rows[0]) is None
        if failure == "duplicate":
            rows[1] = rows[0]
        if failure == "metadata":
            rows[1]["detected_ms"] += 1
        assert feed(assembler, connection, rows[1]) is None
    assert assembler.snapshot()["state"] == "invalid"
    assert not assembler._pcm


def test_missing_chunk_expires_from_original_request_not_last_chunk():
    assembler, connection = started()
    feed(assembler, connection, chunks()[0], now=114.9)
    assembler.expire(now=115)
    assert assembler.snapshot()["state"] == "expired"
    assert not assembler._pcm
    assert feed(assembler, connection, chunks()[1], now=115) is None


@pytest.mark.parametrize("now", [99, float("nan"), float("inf"), 10**400, True, None])
def test_invalid_host_time_drops_pending_reference(now):
    assembler, connection = started()
    assert feed(assembler, connection, chunks()[0], now=now) is None
    assert assembler.snapshot()["error"] == "host_clock"


@pytest.mark.parametrize(
    "raw",
    [
        "private-secret",
        "[1,2,3]",
        "null",
        "{" + '"pcm":"secret",' * 300 + "}",
        '{"pcm":"private-secret","pcm":"private-secret"}',
        "[" * 1024 + "]" * 1024,
    ],
)
def test_parser_failures_never_expose_payload_in_snapshot_or_exception(raw, caplog):
    assembler, connection = started()
    assert assembler.feed(raw, now=101, connection=connection, epoch=99, session_id=SESSION) is None
    report = json.dumps(assembler.snapshot())
    assert "secret" not in report and OWNER not in report and SESSION not in report
    assert len(report) < 180
    assert not assembler._pcm
    assert not caplog.records


@pytest.mark.parametrize(
    "overrides",
    [
        {"owner": "private-secret"},
        {"generation": True},
        {"generation": 0},
        {"generation": 2**31},
        {"now": float("nan")},
        {"connection": None},
        {"epoch": -1},
        {"session_id": "x" * 129},
    ],
)
def test_invalid_begin_is_bounded_diagnostic_state(overrides):
    assembler = WakeReferenceAssembler()
    assembler.begin(
        **{
            "owner": OWNER,
            "generation": 7,
            "now": 100,
            "connection": object(),
            "epoch": 99,
            "session_id": SESSION,
            **overrides,
        }
    )
    assert assembler.snapshot()["error"] == "invalid_request"
    assert "secret" not in json.dumps(assembler.snapshot())


@pytest.mark.parametrize("reason", ["mute", "disconnect", "rearm"])
def test_reset_discards_reference_and_late_callback_cannot_cross_next_request(reason):
    assembler, connection = started()
    rows = chunks()
    feed(assembler, connection, rows[0])
    assembler.reset()  # Host lifecycle owner uses the same reset for each boundary.
    assert assembler.snapshot()["state"] == "idle"
    assert feed(assembler, connection, rows[1]) is None
    assembler.begin("f" * 32, 8, now=102, connection=connection, epoch=102, session_id="next")
    assert feed(assembler, connection, rows[1], now=103, epoch=102, session_id="next") is None
    assert assembler.snapshot()["error"] == "request_identity"
    assert not assembler._pcm
