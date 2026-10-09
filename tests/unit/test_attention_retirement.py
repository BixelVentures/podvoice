"""Only exact typed UPDATE retirement can end an attention renewal owner."""

import asyncio
import copy
import json
import uuid

import httpx
import pytest

from gatekeeper.heartbeat import Heartbeat
from gatekeeper.podconnect import AttentionClient, AttentionDown, AttentionLeaseRetired

PROCESS = "00000000-0000-4000-8000-000000000010"
SESSION = "00000000-0000-4000-8000-000000000020"
LEASE = {"session": SESSION, "expected": {"process": PROCESS, "revision": "1"}}


def receipt(lease=LEASE, room="kitchen"):
    return {
        "contract": "native_attention_v1",
        "outcome": "lease_retired",
        "room": room,
        "session": lease["session"],
        "expected": copy.deepcopy(lease["expected"]),
    }


@pytest.mark.parametrize(
    "case",
    [
        "exact",
        "begin",
        "legacy",
        "release",
        "plain",
        "list",
        "contract",
        "outcome",
        "room",
        "session",
        "process",
        "revision",
        "missing",
        "extra",
        "extra_expected",
        "malformed_session",
        "zero_session",
        "malformed_process",
        "zero_process",
        "noncanonical_revision",
        "zero_revision",
        "overflow_revision",
        "integer_revision",
        "huge_revision",
        "numeric_begin",
        "transport",
    ],
)
async def test_only_exact_original_update_is_terminal(case):
    lease = copy.deepcopy(LEASE)
    data = receipt()
    begin = case == "begin"
    if case in {"contract", "outcome", "room", "session"}:
        data[case] = "other"
    elif case in {"process", "revision"}:
        data["expected"][case] = "other"
    elif case == "missing":
        del data["session"]
    elif case == "extra":
        data["error"] = "unknown"
    elif case == "extra_expected":
        data["expected"]["extra"] = "unknown"
    elif case == "list":
        data = [data]
    elif case in {"malformed_session", "zero_session"}:
        lease["session"] = "x" * 36 if case == "malformed_session" else str(uuid.UUID(int=0))
        data = receipt(lease)
    elif case in {"malformed_process", "zero_process"}:
        lease["expected"]["process"] = (
            "x" * 36 if case == "malformed_process" else str(uuid.UUID(int=0))
        )
        data = receipt(lease)
    elif case.endswith("revision"):
        lease["expected"]["revision"] = {
            "noncanonical_revision": "01",
            "zero_revision": "0",
            "overflow_revision": str(2**64),
            "integer_revision": 1,
            "huge_revision": "1" * 10000,
        }[case]
        data = receipt(lease)
    elif case == "numeric_begin":
        begin = 0

    async def manager(request):
        if case == "transport":
            raise httpx.ReadTimeout("temporary outage", request=request)
        return (
            httpx.Response(409, text="attention owner stale or restoration pending")
            if case == "plain"
            else httpx.Response(409, json=data)
        )

    async with httpx.AsyncClient(
        base_url="http://inert", transport=httpx.MockTransport(manager)
    ) as http:
        att = AttentionClient("http://inert", client=http)
        with pytest.raises(AttentionDown) as caught:
            if case == "release":
                await att.release("kitchen", lease=lease)
            else:
                await att.engage(
                    "kitchen", 5, lease=None if case == "legacy" else lease, begin=begin
                )
        assert isinstance(caught.value, AttentionLeaseRetired) == (case == "exact")
        assert att.degraded
        if case == "exact":
            assert caught.value.room == "kitchen" and caught.value.lease == LEASE
            lease["expected"]["revision"] = "2"
            assert caught.value.lease == LEASE


@pytest.mark.parametrize("boundary", ["retarget", "stop"])
async def test_late_terminal_response_is_inert_after_owner_generation_changes(boundary):
    entered, allow, canceled = asyncio.Event(), asyncio.Event(), asyncio.Event()
    requests, notifications = [], []
    mode = ["admit"]

    async def manager(request):
        if request.method == "GET":
            return httpx.Response(
                200,
                json={"rooms": {"kitchen": {"challenge": {"process": PROCESS, "revision": "0"}}}},
            )
        body = json.loads(request.content)
        requests.append(body)
        if not body["begin"] and mode[0] == "hold":
            entered.set()
            try:
                await allow.wait()
            except asyncio.CancelledError:
                canceled.set()
                await allow.wait()
            return httpx.Response(409, json=receipt(body))
        return httpx.Response(
            200,
            json={
                "contract": "native_attention_v1",
                "challenge": {"process": PROCESS, "revision": "1"},
            },
        )

    async with httpx.AsyncClient(
        base_url="http://inert", transport=httpx.MockTransport(manager)
    ) as http:
        hb = Heartbeat(AttentionClient("http://inert", client=http), period_ms=10000, jitter_ms=0)
        stops = []
        hb.start_with_retirement("kitchen", 5, 4000, notifications.append)
        try:
            async with asyncio.timeout(2):
                while not hb._admitted:  # noqa: ASYNC110 - observe actual admission completion
                    await asyncio.sleep(0)
            original = hb.lease
            mode[0] = "hold"
            hb.retarget("kitchen", 35, 8000)
            old = hb._beat_task
            await asyncio.wait_for(entered.wait(), 2)
            if boundary == "retarget":
                hb.retarget("kitchen", 5, 4000)
            else:
                stops.append(asyncio.create_task(hb.stop()))
            await asyncio.wait_for(canceled.wait(), 2)
            assert not old.done() and notifications == []
            mode[0] = "admit"
            allow.set()
            await asyncio.wait_for(asyncio.shield(old), 2)
            assert notifications == [] and hb.lease == original
            if stops:
                await asyncio.wait_for(stops[0], 2)
            else:
                await asyncio.wait_for(asyncio.shield(hb._beat_task), 2)
                # Current retarget generation may still report this SAME original lease.
                mode[0] = "hold"
                assert await hb._beat_once(hb._target) is None
                assert notifications == [original]
        finally:
            allow.set()
            await hb.stop()
            if stops:
                await asyncio.gather(*stops)
        assert not hb._stopping_tasks and not hb._retired_beats


async def test_immediate_retirement_fences_periodic_renewal_already_waiting_for_io_lock():
    entered, allow = asyncio.Event(), asyncio.Event()
    requests, notifications = [], []

    async def manager(request):
        if request.method == "GET":
            return httpx.Response(
                200,
                json={"rooms": {"kitchen": {"challenge": {"process": PROCESS, "revision": "0"}}}},
            )
        body = json.loads(request.content)
        requests.append(body)
        if body["begin"]:
            return httpx.Response(
                200,
                json={
                    "contract": "native_attention_v1",
                    "challenge": {"process": PROCESS, "revision": "1"},
                },
            )
        if asyncio.current_task() is hb._beat_task:
            entered.set()
            await allow.wait()
            return httpx.Response(409, json=receipt(body))
        return httpx.Response(
            200,
            json={
                "contract": "native_attention_v1",
                "challenge": {"process": PROCESS, "revision": "1"},
            },
        )

    async with httpx.AsyncClient(
        base_url="http://inert", transport=httpx.MockTransport(manager)
    ) as http:
        hb = Heartbeat(AttentionClient("http://inert", client=http), period_ms=1, jitter_ms=0)

        def notified(lease):
            assert hb._target is None and hb._gen > target.generation
            assert hb.lease == original and hb._admitted
            notifications.append(lease)

        hb.start_with_retirement("kitchen", 5, 4000, notified)
        periodic = hb._task
        try:
            async with asyncio.timeout(2):
                while not hb._admitted:  # noqa: ASYNC110 - observe actual admission completion
                    await asyncio.sleep(0)
            original = hb.lease
            hb.retarget("kitchen", 35, 8000)
            immediate, target = hb._beat_task, hb._target
            await asyncio.wait_for(entered.wait(), 2)
            # The actual periodic loop must queue behind the actual immediate owner.
            async with asyncio.timeout(2):
                while not hb._io_lock._waiters:  # noqa: ASYNC110 - actual FIFO lock waiter
                    await asyncio.sleep(0)
            before = len(requests)
            allow.set()
            assert await asyncio.wait_for(asyncio.shield(immediate), 2) is None
            await asyncio.wait_for(asyncio.shield(periodic), 2)
            assert len(requests) == before and notifications == [original]
            assert hb._task is periodic and hb._beat_task is immediate
            assert hb.lease == original
        finally:
            allow.set()
            await hb.stop()
        assert periodic.done() and immediate.done()
        assert not hb._stopping_tasks and not hb._retired_beats
