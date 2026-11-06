"""Queue terminal traces exercise the real broker with inert existing service owners."""

import asyncio
import hashlib
import logging
from unittest.mock import Mock

import pytest
from integration.test_podview_queue_occurrence import action, prepare
from integration.test_podview_queue_occurrence import rig as rig

from gatekeeper import podview_queue


def records(caplog):
    return [r.getMessage() for r in caplog.records if r.name == podview_queue.__name__]


async def test_queue_trace_receipt_and_cached_invocation_are_distinct(rig, caplog):
    caplog.set_level(logging.INFO, logger=podview_queue.__name__)
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")
    body = action(offer, request="private-request-id")
    result = await bridge.queue.action(body, "grant")
    assert result["outcome"] == "accepted"
    assert await bridge.queue.action(body, "grant") == result
    assert bridge.controls.music._read.await_count == 4
    logs = records(caplog)
    assert len(logs) == 4
    assert "phase=request" in logs[0] and "stage=validation dispatched=false" in logs[0]
    assert "stage=validate_receipt dispatched=true outcome=accepted kind=none" in logs[1]
    assert "stage=cached_receipt dispatched=false outcome=accepted kind=none" in logs[3]
    ref = hashlib.sha256(body["requestId"].encode()).hexdigest()[:16]
    assert all(f"request_ref={ref}" in line for line in logs)
    for secret in (
        "private-request-id",
        "grant",
        offer["taskId"],
        "account-alpha",
        "device-one",
        "spotify:",
    ):
        assert all(secret not in line for line in logs)


@pytest.mark.parametrize(
    "service,error,stage,dispatched,outcome,kind",
    [
        ("get_room_queue_controls", TimeoutError, "read_queue", False, "rejected", "timeout"),
        ("prepare_room_queue", ValueError, "prepare_queue", False, "rejected", "invalid_response"),
        (
            "prepare_room_queue",
            asyncio.CancelledError,
            "prepare_queue",
            False,
            "rejected",
            "cancelled",
        ),
        ("control_room_queue", TimeoutError, "dispatch", True, "unknown", "timeout"),
        ("control_room_queue", asyncio.CancelledError, "dispatch", True, "unknown", "cancelled"),
        ("control_room_queue", RuntimeError, "dispatch", True, "unknown", "exception"),
    ],
)
async def test_queue_trace_preserves_pre_send_and_possible_send_outcomes(
    rig, caplog, service, error, stage, dispatched, outcome, kind
):
    caplog.set_level(logging.INFO, logger=podview_queue.__name__)
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")
    original = bridge.controls.music._read.side_effect

    async def fail_at(client, token, called, payload):
        if called == service:
            raise error("private token/URI/payload must not be logged")
        return await original(client, token, called, payload)

    bridge.controls.music._read.side_effect = fail_at
    body = action(offer)
    result = await bridge.queue.action(body, "grant")
    assert result == {
        "ok": False,
        "requestId": body["requestId"],
        "outcome": outcome,
        "retryAllowed": False,
        "physicalResultVerified": False,
    }
    assert not bridge.controls.busy
    calls = bridge.controls.music._read.await_count
    assert await bridge.queue.action(body, "grant") == result
    assert bridge.controls.music._read.await_count == calls
    logs = records(caplog)
    assert (
        f"stage={stage} dispatched={str(dispatched).lower()} outcome={outcome} kind={kind}"
        in logs[1]
    )
    assert "stage=cached_receipt dispatched=false" in logs[3]
    assert all("private" not in line and "payload" not in line for line in logs)


async def test_invalid_queue_trace_is_request_not_admission(rig, caplog):
    caplog.set_level(logging.INFO, logger=podview_queue.__name__)
    bridge, _ = prepare(rig)
    result = await bridge.queue.action({"requestId": {"secret": "raw payload"}}, "grant")
    assert result["outcome"] == "rejected"
    assert bridge.controls.music._read.await_count == 0
    logs = records(caplog)
    assert len(logs) == 2
    assert "phase=request" in logs[0]
    assert "request_ref=none stage=validation dispatched=false outcome=rejected" in logs[1]
    assert "secret" not in " ".join(logs)


async def test_queue_trace_sink_failure_cannot_change_dispatch_or_receipt(rig, monkeypatch):
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")
    sink = Mock(side_effect=RuntimeError("inert unavailable log sink"))
    monkeypatch.setattr(podview_queue._LOGGER, "info", sink)
    result = await bridge.queue.action(action(offer), "grant")
    assert result["outcome"] == "accepted"
    assert bridge.controls.music._read.await_count == 4
    assert sink.call_count == 2
    assert not bridge.controls.busy


@pytest.mark.parametrize("malformed", [False, True])
async def test_queue_trace_validates_terminal_native_receipt(rig, caplog, malformed):
    caplog.set_level(logging.INFO, logger=podview_queue.__name__)
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")
    original = bridge.controls.music._read.side_effect

    async def terminal_reply(client, token, called, payload):
        value = await original(client, token, called, payload)
        if called == "control_room_queue":
            value.update(ok=False, outcome="rejected", accepted_native=False)
            if malformed:
                value["request_id"] = "private-foreign-request"
        return value

    bridge.controls.music._read.side_effect = terminal_reply
    result = await bridge.queue.action(action(offer), "grant")
    outcome = "unknown" if malformed else "rejected"
    kind = "invalid_response" if malformed else "none"
    assert result["outcome"] == outcome
    assert bridge.controls.music._read.await_count == 4
    assert not bridge.controls.busy
    logs = records(caplog)
    assert f"stage=validate_receipt dispatched=true outcome={outcome} kind={kind}" in logs[1]
    assert "private-foreign-request" not in " ".join(logs)
