"""Local HTTP delivery causality; no providers, real time speed benchmark or actions."""

import asyncio
import json
from datetime import datetime
from types import SimpleNamespace

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from unit.test_podview_presentation import context
from unit.test_weather_result import weather_payload

from gatekeeper import podview
from gatekeeper.podview_receipts import VisualReceiptOwner


class HeldHeartbeat:
    def __init__(self):
        self.entered = asyncio.Event()
        self.release = asyncio.Event()

    def __getattr__(self, name):
        return getattr(asyncio, name)

    async def sleep(self, delay):
        assert delay == 1
        self.entered.set()
        await self.release.wait()

    async def wait_for(self, awaitable, timeout):  # noqa: ASYNC109 - match asyncio fixture API
        if timeout != 1:
            return await asyncio.wait_for(awaitable, timeout)
        self.entered.set()
        event = asyncio.create_task(awaitable)
        heartbeat = asyncio.create_task(self.release.wait())
        try:
            done, _ = await asyncio.wait([event, heartbeat], return_when=asyncio.FIRST_COMPLETED)
            if event in done:
                return event.result()
            raise TimeoutError
        finally:
            for task in (event, heartbeat):
                task.cancel()
            await asyncio.gather(event, heartbeat, return_exceptions=True)


async def frame(response):
    lines = []
    while True:
        line = await response.content.readline()
        if line == b"\n":
            return json.loads(next(x[6:] for x in lines if x.startswith(b"data: ")))
        if not line:
            raise AssertionError("SSE closed")
        lines.append(line)


def publish(sink, room="kitchen", typed=True):
    if typed:
        return sink.offer_completed_answer(**context(object(), room_id=room))
    weather = weather_payload()
    return sink.offer(
        object(),
        room_id=room,
        session_id="session",
        session_epoch=1,
        turn_id="turn",
        provider_generation=1,
        task_id="task",
        input_revision=1,
        call_id="call",
        tool_name="weather_forecast",
        result=weather,
        current=lambda: True,
        direct_weather=True,
    )


async def client_for(sink):
    bridge = SimpleNamespace(
        sessions={"kitchen": object(), "office": object()},
        tools=SimpleNamespace(podview_receipts=sink),
        _streams=0,
        boot_id="boot",
    )
    bridge.snapshot = lambda room, token, *, light_token="": {
        "revision": sink.snapshot(room)["revision"],
        "answers": sink.snapshot(room),
        "roomId": room,
    }
    app = web.Application()
    app[podview.BRIDGE] = bridge
    app.router.add_get("/events", podview._events)
    client = TestClient(TestServer(app, shutdown_timeout=0.01))
    await client.start_server()
    return client, bridge


@pytest.mark.parametrize("typed", [False, True])
async def test_http_publication_wakes_before_held_heartbeat(monkeypatch, typed):
    clock = HeldHeartbeat()
    monkeypatch.setattr(podview, "asyncio", clock)
    sink = VisualReceiptOwner()
    if not typed:
        from gatekeeper import podview_weather

        stamp = datetime.fromisoformat(
            weather_payload()["data"]["result"]["retrieved_at"]
        ).timestamp()
        monkeypatch.setattr(podview_weather.time, "time", lambda: stamp)
    client, bridge = await client_for(sink)
    try:
        response = await client.get("/events?room=kitchen")
        first = await frame(response)
        await clock.entered.wait()
        assert publish(sink, typed=typed)
        second = await asyncio.wait_for(frame(response), 0.3)
        assert second["answers"]["items"] and second["revision"] > first["revision"]
        assert not clock.release.is_set()
    finally:
        await client.close()
    assert bridge._streams == 0 and not sink._subscribers


async def test_room_isolation_multistream_and_no_replay_notification(monkeypatch):
    clock = HeldHeartbeat()
    monkeypatch.setattr(podview, "asyncio", clock)
    sink = VisualReceiptOwner()
    client, _ = await client_for(sink)
    try:
        responses = [
            await client.get("/events?room=" + room) for room in ["kitchen", "kitchen", "office"]
        ]
        for response in responses:
            await frame(response)
        await clock.entered.wait()
        kitchen = [asyncio.create_task(frame(r)) for r in responses[:2]]
        office = asyncio.create_task(frame(responses[2]))
        assert publish(sink)
        for task in kitchen:
            assert (await asyncio.wait_for(task, 0.3))["answers"]["items"]
        await asyncio.sleep(0)
        assert not office.done()
        # Invalid publication is observationally inert.
        events = list(sink._subscribers)
        for event in events:
            event.clear()
        assert not sink.offer_completed_answer(**context(object(), current=lambda: False))
        await asyncio.sleep(0)
        assert not any(event.is_set() for event in events)
        office.cancel()
        await asyncio.gather(office, return_exceptions=True)
    finally:
        await client.close()
    assert not sink._subscribers


async def test_notification_during_write_is_not_lost(monkeypatch):
    sink = VisualReceiptOwner()
    original = web.StreamResponse.write
    published = False

    async def write(response, data):
        nonlocal published
        await original(response, data)
        if not published:
            published = True
            assert publish(sink)

    monkeypatch.setattr(web.StreamResponse, "write", write)
    clock = HeldHeartbeat()
    monkeypatch.setattr(podview, "asyncio", clock)
    client, _ = await client_for(sink)
    try:
        response = await client.get("/events?room=kitchen")
        assert not (await frame(response))["answers"]["items"]
        assert (await asyncio.wait_for(frame(response), 0.3))["answers"]["items"]
        assert not clock.release.is_set()
    finally:
        await client.close()
    assert not sink._subscribers


async def test_heartbeat_still_projects_fresh_revocation(monkeypatch):
    clock = HeldHeartbeat()
    monkeypatch.setattr(podview, "asyncio", clock)
    sink = VisualReceiptOwner()
    assert publish(sink)
    client, _ = await client_for(sink)
    try:
        response = await client.get("/events?room=kitchen")
        assert (await frame(response))["answers"]["items"]
        await clock.entered.wait()
        sink._rooms.clear()  # No publication: heartbeat must still observe revocation.
        clock.release.set()
        assert not (await asyncio.wait_for(frame(response), 0.3))["answers"]["items"]
    finally:
        await client.close()


async def test_write_fault_cleanup(monkeypatch):
    sink = VisualReceiptOwner()

    async def fail(*args):
        raise ConnectionResetError

    monkeypatch.setattr(web.StreamResponse, "write", fail)
    client, bridge = await client_for(sink)
    try:
        response = await client.get("/events?room=kitchen")
        assert await response.read() == b""
        assert bridge._streams == 0 and not sink._subscribers
    finally:
        await client.close()


async def test_loop_thread_dispatch_and_broken_observer_do_not_change_acceptance():
    sink = VisualReceiptOwner()
    event = sink.subscribe("kitchen")
    await asyncio.to_thread(sink._notify, "kitchen")
    await asyncio.wait_for(event.wait(), 0.3)
    sink.unsubscribe(event)

    class ClosedLoop:
        def call_soon_threadsafe(self, *args):
            raise RuntimeError("loop closed")

    sink._subscribers[asyncio.Event()] = ("kitchen", ClosedLoop())
    assert publish(sink)
    assert sink.snapshot("kitchen")["items"]


async def test_subscription_bound_and_closed_owner():
    sink = VisualReceiptOwner()
    events = [sink.subscribe("kitchen") for _ in range(8)]
    assert all(events) and sink.subscribe("office") is None
    sink.unsubscribe(events[0])
    assert sink.subscribe("office") is not None
    sink.close()
    assert sink.subscribe("kitchen") is None


async def test_http_guard_denies_before_subscription(monkeypatch):
    sink = VisualReceiptOwner()
    monkeypatch.setattr(podview, "_trusted", lambda remote: False)
    client, bridge = await client_for(sink)
    try:
        response = await client.get("/events?room=kitchen")
        assert response.status == 403
        assert bridge._streams == 0 and not sink._subscribers
    finally:
        await client.close()


async def test_wake_uses_fresh_projection_after_read_authority_lost(monkeypatch):
    clock = HeldHeartbeat()
    monkeypatch.setattr(podview, "asyncio", clock)
    sink = VisualReceiptOwner()
    client, bridge = await client_for(sink)
    projection = bridge.snapshot
    allowed = True

    def snapshot(room, token, *, light_token=""):
        result = projection(room, token, light_token=light_token)
        if not allowed:
            result["answers"] = {"items": []}
            result["controller"] = False
        return result

    bridge.snapshot = snapshot
    try:
        response = await client.get("/events?room=kitchen")
        await frame(response)
        await clock.entered.wait()
        allowed = False
        assert publish(sink)
        result = await asyncio.wait_for(frame(response), 0.3)
        assert result["answers"]["items"] == [] and result["controller"] is False
    finally:
        await client.close()
    assert not sink._subscribers
