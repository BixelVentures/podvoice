"""Real HA WebSocket protocol → existing bridge home-event listener, inert HA effects."""

import asyncio
from contextlib import asynccontextmanager

import aiohttp
import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from integration.test_cleaning_journal import bind
from integration.test_podview_bridge import owner
from unit.test_device_control import ROBOT, Rig

from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE
from gatekeeper.web import create_app


@pytest.fixture
async def offline_direct(tmp_path):
    """Real robot owner on an inert HA transport; no Voice PE link or screen grant."""
    robot = Rig()
    bind(robot, tmp_path / "cleaning-journal.json")
    session, _ = owner()
    app = create_app(StatusHub(), {"kitchen": session}, tools=robot.router)
    async with TestClient(TestServer(app)) as client:
        yield client, app[BRIDGE], robot
    await robot.client.aclose()


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
        for identifier in range(1, 6):
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


async def test_external_ha_event_bumps_only_admitted_domain_and_reconnects(offline_direct):
    _, bridge, robot = offline_direct
    async with source(bridge) as events:
        before = dict(bridge._home_event_revisions)
        await events.event("sensor.unrelated")
        await asyncio.sleep(0.03)
        assert bridge._home_event_revisions == before
        robot.states[ROBOT]["state"] = "paused"
        await events.event(ROBOT)
        await until(lambda: bridge._home_event_revisions["vacuum"] > before["vacuum"])
        assert not robot.writes
        previous = bridge._home_event_revisions["vacuum"]
        await events.sockets[-1].close()
        await asyncio.wait_for(events.ready.get(), 3)
        await until(lambda: bridge._home_event_revisions["vacuum"] > previous)
        assert len(events.auth) == 2
        assert all(
            row == {"type": "auth", "access_token": bridge.tools._token} for row in events.auth
        )
        assert len(events.subscriptions) == 10


async def test_wrong_subscription_ack_never_marks_source_ready_and_logs_safe_stage(
    offline_direct, caplog
):
    _, bridge, _ = offline_direct
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


async def test_final_app_shutdown_drains_listener_and_late_start_cannot_restart_it(
    offline_direct,
):
    client, bridge, _ = offline_direct
    async with source(bridge):
        running = bridge._home_event_task
        assert running is not None and not running.done()
        await client.server.app.shutdown()
        assert running.done()
        assert bridge._home_event_task is None
        # A late snapshot or start request cannot recreate the closed listener.
        bridge.snapshot("kitchen")
        bridge.start_home_events()
        await asyncio.sleep(0)
        assert bridge._home_event_task is None
