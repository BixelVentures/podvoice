"""Two actual ingress clients share only current read completion, never authority."""

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from aiohttp import ClientError, ClientSession
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_bridge import owner

from gatekeeper import podview
from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE
from gatekeeper.web import create_app


@asynccontextmanager
async def rig(domain, monkeypatch, *, outcome=None):
    entered, release = asyncio.Event(), asyncio.Event()
    session, timers = owner()
    timers.command.side_effect = AssertionError("NoActions")
    timers.dispatch.side_effect = AssertionError("NoActions")
    source = ["source-a"]

    async def held(*args):
        entered.set()
        await release.wait()
        if outcome is not None:
            raise outcome
        if domain == "home":
            return {"status": "unavailable", "items": []}
        return {"ok": True, "data": {"config_entry_id": "account-a", "targets": []}}

    read = AsyncMock(side_effect=held)
    weather = AsyncMock(return_value={"status": "unavailable", "data": None})
    tools = SimpleNamespace(
        podview_home_available=lambda: False,
        podview_home_binding=lambda: source[0],
        podview_home_read=read,
        podview_weather_available=lambda: False,
        podview_weather_binding=lambda: source[0],
        podview_weather_read=weather,
        podview_music_reads=lambda: ["targets"],
        podview_music_binding=lambda: source[0],
        podview_read=read,
    )
    app = create_app(StatusHub(), {"kitchen": session, "other": owner()[0]}, tools=tools)
    bridge = app[BRIDGE]
    tasks, arrived = {}, {name: asyncio.Event() for name in ("first", "second")}
    original_guard = podview._guard

    async def guard(request):
        name = request.headers.get("X-Read-Probe")
        if name in arrived:
            tasks[name] = asyncio.current_task()
            arrived[name].set()
        return await original_guard(request)

    monkeypatch.setattr(podview, "_guard", guard)
    route = (
        "/view/api/home?room=kitchen"
        if domain == "home"
        else "/view/api/music?room=kitchen&kind=targets&account=account-a"
    )
    requests = []
    async with TestClient(TestServer(app)) as first_client, ClientSession() as second_client:
        # Observe one HTTP attempt; aiohttp otherwise retries a disconnected GET.
        first_client.session._retry_connection = False
        second_client._retry_connection = False

        def begin(name, *, url=route, cookie=""):
            client = first_client if name == "first" else second_client
            location = url if name == "first" else first_client.make_url(url)
            task = asyncio.create_task(
                client.get(
                    location,
                    headers={"X-Read-Probe": name, "Cookie": "podview_control=" + cookie},
                )
            )
            requests.append(task)
            return task

        state = SimpleNamespace(
            app=app,
            bridge=bridge,
            source=source,
            read=read,
            timers=timers,
            entered=entered,
            release=release,
            tasks=tasks,
            arrived=arrived,
            begin=begin,
            route=route,
            client=first_client,
            second_client=second_client,
        )
        try:
            yield state
        finally:
            release.set()
            await asyncio.gather(*requests, return_exceptions=True)
            timers.dispatch.assert_not_awaited()
            timers.command.assert_not_awaited()


@pytest.mark.parametrize("domain", ["home", "targets"])
async def test_same_key_two_clients_share_one_read_and_original_cache(monkeypatch, domain):
    async with rig(domain, monkeypatch) as r:
        first = r.begin("first")
        await r.entered.wait()
        second = r.begin("second")
        await r.arrived["second"].wait()
        assert not second.done()
        r.release.set()
        responses = await asyncio.gather(first, second)
        bodies = [await response.json() for response in responses]
        assert [response.status for response in responses] == [200, 200]
        assert bodies[0] == bodies[1]
        cache = r.bridge._home_cache if domain == "home" else r.bridge._music_cache
        original = next(iter(cache.values()))
        stamp = original[0]
        third = await r.second_client.get(r.client.make_url(r.route))
        assert third.status == 200
        assert await third.json() == bodies[0]
        assert next(iter(cache.values())) is original and original[0] == stamp
        assert r.read.await_count == 1
        assert r.bridge._home_inflight is None and r.bridge._targets_inflight is None
        assert not r.bridge._home_busy and not r.bridge._music_busy


@pytest.mark.parametrize("domain", ["home", "targets"])
@pytest.mark.parametrize("replacement", ["session", "source", "boot", "bridge", "auth"])
async def test_waiter_rechecks_current_owner_and_auth(monkeypatch, domain, replacement):
    async with rig(domain, monkeypatch) as r:
        first = r.begin("first")
        await r.entered.wait()
        second = r.begin("second")
        await r.arrived["second"].wait()
        if replacement == "session":
            r.bridge.sessions["kitchen"] = owner()[0]
        elif replacement == "source":
            r.source[0] = "source-b"
        elif replacement == "boot":
            r.bridge.boot_id = "changed-boot"
        elif replacement == "bridge":
            # Swap the app's owner without modifying the existing read's tools.
            with pytest.warns(DeprecationWarning):
                r.app[BRIDGE] = podview.PodViewBridge(r.bridge.sessions, tools=r.bridge.tools)
        else:
            monkeypatch.setattr(podview, "_trusted", lambda remote: False)
        r.release.set()
        responses = await asyncio.gather(first, second)
        assert responses[1].status == (403 if replacement == "auth" else 503)
        body = await responses[1].json()
        assert body["error"] == (
            "ingress_required"
            if replacement == "auth"
            else domain.replace("targets", "music") + "_unavailable"
        )
        assert r.read.await_count == 1
        assert r.bridge._home_inflight is None and r.bridge._targets_inflight is None


@pytest.mark.parametrize("domain", ["home", "targets"])
@pytest.mark.parametrize("outcome", [RuntimeError("inert source failure"), TimeoutError()])
async def test_owner_error_or_timeout_never_dispatches_again(monkeypatch, domain, outcome):
    async with rig(domain, monkeypatch, outcome=outcome) as r:
        first = r.begin("first")
        await r.entered.wait()
        second = r.begin("second")
        await r.arrived["second"].wait()
        r.release.set()
        responses = await asyncio.gather(first, second)
        assert [response.status for response in responses] == [200, 200]
        bodies = [await response.json() for response in responses]
        assert bodies[0] == bodies[1]
        if domain == "home":
            assert bodies[1]["vacuum"]["status"] == "unavailable"
        else:
            assert bodies[1]["error"] == "music_unavailable"
        assert r.read.await_count == 1


@pytest.mark.parametrize("domain", ["home", "targets"])
@pytest.mark.parametrize("cancelled", ["first", "second"])
async def test_cancellation_settles_waiters_without_cancelling_other_owner(
    monkeypatch, domain, cancelled
):
    async with rig(domain, monkeypatch) as r:
        first = r.begin("first")
        await r.entered.wait()
        second = r.begin("second")
        await r.arrived["second"].wait()
        completion = (r.bridge._home_inflight if domain == "home" else r.bridge._targets_inflight)[
            1
        ]
        r.tasks[cancelled].cancel()
        cancelled_request = first if cancelled == "first" else second
        with pytest.raises(ClientError):
            await cancelled_request
        if cancelled == "second":
            assert not completion.done() and not first.done()
            r.release.set()
            assert (await first).status == 200
        else:
            assert (await second).status == 503
        assert r.read.await_count == 1
        assert r.bridge._home_inflight is None and r.bridge._targets_inflight is None
        assert not r.bridge._home_busy and not r.bridge._music_busy


@pytest.mark.parametrize("domain", ["home", "targets"])
async def test_follower_deadline_does_not_cancel_owner_or_retry(monkeypatch, domain):
    async with rig(domain, monkeypatch) as r:
        original = asyncio

        class ShortJoinDeadline:
            def __getattr__(self, name):
                return getattr(original, name)

            async def wait_for(self, value, timeout):  # noqa: ASYNC109 - match asyncio adapter
                # Only shorten this test's follower wait, not source I/O or any other loop.
                if original.isfuture(value):
                    assert timeout == (8 if domain == "home" else 10)
                    timeout = 0.01
                return await original.wait_for(value, timeout)

        monkeypatch.setattr(podview, "asyncio", ShortJoinDeadline())
        first = r.begin("first")
        await r.entered.wait()
        second = r.begin("second")
        assert (await second).status == 503
        completion = (r.bridge._home_inflight if domain == "home" else r.bridge._targets_inflight)[
            1
        ]
        assert not completion.done() and not first.done()
        r.release.set()
        assert (await first).status == 200
        assert r.read.await_count == 1


@pytest.mark.parametrize("domain", ["home", "targets"])
async def test_different_read_key_keeps_existing_busy_fence(monkeypatch, domain):
    async with rig(domain, monkeypatch) as r:
        first = r.begin("first")
        await r.entered.wait()
        route = (
            r.route.replace("kitchen", "other")
            if domain == "home"
            else r.route.replace("account-a", "account-b")
        )
        response = await r.begin("second", url=route)
        assert response.status == 429
        assert (await response.json())["error"] == (
            "home_busy" if domain == "home" else "music_busy"
        )
        r.release.set()
        assert (await first).status == 200 and r.read.await_count == 1


async def test_home_projects_each_controllers_lights_after_join(monkeypatch):
    async with rig("home", monkeypatch) as r:

        async def lights(room, token, area, **kwargs):
            return {"lights": {"status": "observed", "controller": token, "area": area}}

        r.bridge.read_lights = AsyncMock(side_effect=lights)
        first = r.begin("first", cookie="controller-a", url=r.route + "&lightArea=area-a")
        await r.entered.wait()
        second = r.begin("second", cookie="controller-b", url=r.route + "&lightArea=area-b")
        await r.arrived["second"].wait()
        r.release.set()
        bodies = [await response.json() for response in await asyncio.gather(first, second)]
        assert [body["lights"]["controller"] for body in bodies] == ["controller-a", "controller-b"]
        assert [body["lights"]["area"] for body in bodies] == ["area-a", "area-b"]
        assert r.bridge.read_lights.await_count == 2 and r.read.await_count == 1
        assert "lights" not in r.bridge._home_cache["kitchen"][2]


async def test_targets_are_room_scoped_separately_after_join(monkeypatch):
    async with rig("targets", monkeypatch) as r:
        scope = podview.podview_room_media.scope_targets
        calls = []

        def project(result, bridge, room, account):
            calls.append((bridge, room, account))
            return scope(result, bridge, room, account)

        monkeypatch.setattr(podview.podview_room_media, "scope_targets", project)
        first = r.begin("first")
        await r.entered.wait()
        second = r.begin("second")
        await r.arrived["second"].wait()
        r.release.set()
        responses = await asyncio.gather(first, second)
        assert [response.status for response in responses] == [200, 200]
        assert calls == [(r.bridge, "kitchen", "account-a")] * 2
        assert r.read.await_count == 1


async def test_home_waiter_rechecks_owner_after_its_own_light_read(monkeypatch):
    async with rig("home", monkeypatch) as r:

        async def lights(room, token, area, **kwargs):
            if token == "controller-b":
                r.bridge.sessions[room] = owner()[0]
            return {"lights": {"status": "unavailable"}}

        r.bridge.read_lights = AsyncMock(side_effect=lights)
        first = r.begin("first", cookie="controller-a")
        await r.entered.wait()
        second = r.begin("second", cookie="controller-b")
        await r.arrived["second"].wait()
        r.release.set()
        responses = await asyncio.gather(first, second)
        assert [response.status for response in responses] == [200, 503]
        assert r.read.await_count == 1 and r.bridge.read_lights.await_count == 2


async def test_targets_capacity_keeps_existing_429_without_a_read(monkeypatch):
    import time

    async with rig("targets", monkeypatch) as r:
        binding = podview._music_binding(r.bridge, "kitchen")
        for index in range(16):
            r.bridge._music_cache[("kitchen", "targets", f"other-{index}", None, None)] = (
                time.monotonic(),
                binding,
                {"ok": True, "data": {"targets": []}},
                15,
            )
        response = await r.begin("second")
        assert response.status == 429
        assert (await response.json())["error"] == "music_capacity"
        r.read.assert_not_awaited()
        assert r.bridge._targets_inflight is None
