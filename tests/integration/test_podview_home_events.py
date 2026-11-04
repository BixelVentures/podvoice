"""Real HA WebSocket protocol → existing bridge/SSE/HTTP, with inert HA effects."""

import asyncio
import json
import time
from contextlib import asynccontextmanager

import aiohttp
import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer
from unit.test_device_control import ROBOT

pytest_plugins = ["integration.test_podview_controls"]


class HAEvents:
    def __init__(self):
        self.sockets = []
        self.ready = asyncio.Queue()
        self.auth = []
        self.subscriptions = []

    async def serve(self, request):
        socket = web.WebSocketResponse()
        await socket.prepare(request)
        self.sockets.append(socket)
        await socket.send_json({"type": "auth_required"})
        self.auth.append(await socket.receive_json())
        await socket.send_json({"type": "auth_ok"})
        for identifier in range(1, 5):
            command = await socket.receive_json()
            self.subscriptions.append(command)
            assert command["id"] == identifier and command["type"] == "subscribe_events"
            # This event must survive the subscription ACK phase.
            if identifier == 4:
                await self.event(ROBOT, socket=socket)
            await socket.send_json({"id": identifier, "type": "result", "success": True})
        self.ready.put_nowait(socket)
        async for _ in socket:
            pass
        return socket

    async def event(self, entity, *, socket=None):
        await (socket or self.sockets[-1]).send_json(
            {
                "id": 1,
                "type": "event",
                "event": {"event_type": "state_changed", "data": {"entity_id": entity}},
            }
        )


@asynccontextmanager
async def source(bridge):
    events = HAEvents()
    app = web.Application()
    app.router.add_get("/ws", events.serve)
    async with TestServer(app) as server, aiohttp.ClientSession() as session:

        @asynccontextmanager
        async def connect():
            async with session.ws_connect(server.make_url("/ws")) as socket:
                yield socket

        bridge.tools.home_event_connect = connect
        bridge.start_home_events()
        await asyncio.wait_for(events.ready.get(), 3)
        await until(lambda: bridge._home_event_revisions["vacuum"] >= 2)
        try:
            yield events
        finally:
            await bridge.stop_home_events()
            assert bridge._home_event_task is None
            assert not bridge._home_event_wakes


async def until(predicate):
    async with asyncio.timeout(3):
        while not predicate():  # noqa: ASYNC110 - observe the real asynchronous WS owner
            await asyncio.sleep(0.005)


async def snapshot(stream):
    async with asyncio.timeout(3):
        while True:
            line = await stream.content.readline()
            if line.startswith(b"data: "):
                return json.loads(line[6:])


async def test_external_ha_event_wakes_sse_refreshes_real_home_and_reconnects(offline_direct):
    client, bridge, _, _, _, _, robot, _ = offline_direct
    robot.states[ROBOT]["state"] = "cleaning"
    robot.states[ROBOT]["attributes"]["supported_features"] = 4 | 8 | 16
    token = bridge.grant_timer_control("kitchen")
    headers = {"Cookie": f"podview_control={token}"}
    async with source(bridge) as events:
        first = await (await client.get("/view/api/home", headers=headers)).json()
        assert first["vacuum"]["items"][0]["state"] == "cleaning"
        original = first["sourceRevision"]
        # This owner has no admitted vehicle source. A private domain event may
        # neither change its public watermark nor wake its SSE request.
        bridge.home_events_changed({"vehicle"})
        assert bridge.home_source_revision("kitchen", token) == original
        stream = await client.get("/view/api/events", headers=headers)
        assert (await snapshot(stream))["homeRevision"] == original
        before = dict(bridge._home_event_revisions)
        await events.event("sensor.unrelated")
        await asyncio.sleep(0.03)
        assert bridge._home_event_revisions == before
        robot.states[ROBOT]["state"] = "paused"
        await events.event(ROBOT)
        changed = await snapshot(stream)
        assert changed["homeRevision"]["scope"] == original["scope"]
        assert changed["homeRevision"]["revision"] > original["revision"]
        fresh = await (await client.get("/view/api/home", headers=headers)).json()
        assert fresh["sourceRevision"] == changed["homeRevision"]
        assert fresh["vacuum"]["items"][0]["state"] == "paused"
        assert not robot.writes
        stream.close()
        previous = bridge._home_event_revisions["vacuum"]
        await events.sockets[-1].close()
        await asyncio.wait_for(events.ready.get(), 3)
        await until(lambda: bridge._home_event_revisions["vacuum"] > previous)
        assert len(events.auth) == 2
        assert all(
            row == {"type": "auth", "access_token": bridge.tools._token} for row in events.auth
        )
        assert len(events.subscriptions) == 8


async def test_dirty_burst_does_not_starve_or_fence_a_held_home_read(offline_direct, monkeypatch):
    client, bridge, _, _, _, _, robot, _ = offline_direct
    robot.states[ROBOT]["state"] = "cleaning"
    async with source(bridge) as events:
        entered, release = asyncio.Event(), asyncio.Event()
        original = bridge.tools.podview_home_read

        async def held():
            result = await original()
            entered.set()
            await release.wait()
            return result

        monkeypatch.setattr(bridge.tools, "podview_home_read", held)
        captured = bridge.home_source_revision("kitchen", "")
        read = asyncio.create_task(client.get("/view/api/home"))
        await asyncio.wait_for(entered.wait(), 2)
        mutation = dict(bridge.controls.mutations)
        for _ in range(6):
            await events.event(ROBOT)
        await until(
            lambda: (
                bridge.home_source_revision("kitchen", "")["revision"] >= captured["revision"] + 6
            )
        )
        release.set()
        response = await asyncio.wait_for(read, 2)
        assert response.status == 200
        early = await response.json()
        assert early["sourceRevision"] == captured
        assert early["vacuum"]["status"] == "observed"
        # More telemetry can arrive after publication: the old read was useful,
        # but its dirty cache cannot serve the coalesced followup.
        robot.states[ROBOT]["state"] = "paused"
        await events.event(ROBOT)
        await until(
            lambda: (
                bridge.home_source_revision("kitchen", "")["revision"] > captured["revision"] + 6
            )
        )
        latest = await (await client.get("/view/api/home")).json()
        assert latest["vacuum"]["items"][0]["state"] == "paused"
        assert latest["sourceRevision"]["revision"] > captured["revision"]
        assert bridge.controls.mutations == mutation
        assert not robot.writes


async def test_wrong_subscription_ack_never_marks_source_ready_and_logs_safe_stage(
    offline_direct, caplog
):
    _, bridge, _, _, _, _, _, _ = offline_direct
    disconnected = asyncio.Event()

    async def refused(request):
        socket = web.WebSocketResponse()
        await socket.prepare(request)
        await socket.send_json({"type": "auth_required"})
        await socket.receive_json()
        await socket.send_json({"type": "auth_ok"})
        for _ in range(4):
            await socket.receive_json()
        await socket.send_json({"id": 99, "type": "result", "success": True})
        async for _ in socket:
            pass
        disconnected.set()
        return socket

    app = web.Application()
    app.router.add_get("/ws", refused)
    async with TestServer(app) as server, aiohttp.ClientSession() as session:

        @asynccontextmanager
        async def connect():
            async with session.ws_connect(server.make_url("/ws")) as socket:
                yield socket

        bridge.tools.home_event_connect = connect
        bridge.start_home_events()
        try:
            await asyncio.wait_for(disconnected.wait(), 2)
            await until(lambda: "stage=subscribe_ack" in caplog.text)
            assert not any(bridge._home_event_revisions.values())
            assert "stage=subscribe_ack outcome=unavailable error_class=ValueError" in caplog.text
            assert bridge.tools._token not in caplog.text
            assert ROBOT not in caplog.text
        finally:
            await bridge.stop_home_events()


@pytest.mark.parametrize("cache_first", [False, True])
async def test_event_during_final_light_await_preserves_captured_vehicle_read(
    offline_direct, monkeypatch, cache_first
):
    client, bridge, _, _, _, _, robot, _ = offline_direct
    robot.states[ROBOT]["state"] = "cleaning"
    monkeypatch.setattr(bridge.tools, "podview_vehicle_available", lambda: True)
    monkeypatch.setattr(bridge.tools, "podview_vehicle_binding", lambda: ("stable-vehicle-owner",))

    async def vehicle():
        return {
            "status": "observed",
            "source": "home_assistant_state",
            "observedAt": time.time(),
            "entityIds": ["sensor.car_battery"],
            "data": {"batteryPercent": 72},
        }

    monkeypatch.setattr(bridge.tools, "podview_vehicle_read", vehicle)
    async with source(bridge) as events:
        if cache_first:
            assert (await client.get("/view/api/home")).status == 200
        entered, release = asyncio.Event(), asyncio.Event()

        async def lights(*args, **kwargs):
            entered.set()
            await release.wait()
            return {}

        monkeypatch.setattr(bridge, "read_lights", lights)
        captured = bridge.home_source_revision("kitchen", "")
        read = asyncio.create_task(client.get("/view/api/home"))
        await asyncio.wait_for(entered.wait(), 2)
        robot.states[ROBOT]["state"] = "paused"
        await events.event(ROBOT)
        await until(
            lambda: bridge.home_source_revision("kitchen", "")["revision"] > captured["revision"]
        )
        release.set()
        response = await asyncio.wait_for(read, 2)
        assert response.status == 200
        value = await response.json()
        assert value["sourceRevision"] == captured
        assert value["vehicle"]["status"] == "observed"
        latest = await (await client.get("/view/api/home")).json()
        assert latest["vacuum"]["items"][0]["state"] == "paused"
        assert latest["sourceRevision"]["revision"] > captured["revision"]
        assert not robot.writes


async def test_final_app_shutdown_drains_listener_and_late_sse_cannot_restart_it(offline_direct):
    client, bridge, _, _, _, _, _, _ = offline_direct
    async with source(bridge):
        stream = await client.get("/view/api/events")
        await snapshot(stream)
        running = bridge._home_event_task
        assert running is not None and not running.done()
        try:
            await client.server.app.shutdown()
            assert running.done()
            assert bridge._home_event_task is None
            # A snapshot may already be in a stream's shutdown/drain path.
            bridge.snapshot("kitchen")
            bridge.start_home_events()
            await asyncio.sleep(0)
            assert bridge._home_event_task is None
        finally:
            stream.close()
