"""Composed MCP recovery through shipped owners; mocked peers are not physical proof."""

import ast
import asyncio
import contextlib
import copy
import json
import time
from pathlib import Path

import httpx
import pytest
from test_talk_webrtc import finish, setup
from test_thin_live import build, emit, until
from unit.test_openai_live import call, created, terminal

from gatekeeper import tools as tools_module
from gatekeeper.hub import StatusHub
from gatekeeper.live_prompt import live_instructions
from gatekeeper.mcp_client import HomeAssistantMCP, McpError
from gatekeeper.openai_live import LiveToolBatch
from gatekeeper.prompt import SYSTEM_PROMPT_DA
from gatekeeper.talk import run_talk
from gatekeeper.tools import ToolRouter


def results(sdk):
    return [
        json.loads(c.kwargs["item"]["output"])
        for c in sdk.response.item.create.await_args_list
        if "output" in c.kwargs["item"]
    ]


URL = "http://fixture.invalid/api/mcp/assist"


class FaultServer:
    def __init__(self):
        self.requests = []
        self.list_failures = 0
        self.call_failure = False
        self.revision = "v1"
        self.paged = False
        self.page_entered = asyncio.Event()
        self.page_release = asyncio.Event()
        self.hold_page = False
        self.fail_page = False
        self.inflight = 0
        self.max_inflight = 0

    async def handle(self, request):
        assert str(request.url) == URL
        body = json.loads(request.content)
        method, rid = body["method"], body.get("id")
        self.requests.append(
            {
                "method": method,
                "params": copy.deepcopy(body.get("params")),
                "time": time.monotonic(),
            }
        )
        self.inflight += 1
        self.max_inflight = max(self.max_inflight, self.inflight)
        try:
            if method == "notifications/initialized":
                assert request.headers["MCP-Protocol-Version"] == "2025-06-18"
                return httpx.Response(202)
            if method == "initialize":
                assert "MCP-Protocol-Version" not in request.headers
                result = {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "Home Assistant", "version": "2026.8.2"},
                }
            elif method == "tools/list":
                if self.list_failures:
                    self.list_failures -= 1
                    return httpx.Response(502, text="synthetic Core restarting")
                context = {
                    "name": "GetLiveContext",
                    "description": "Fixture context",
                    "inputSchema": {
                        "type": "object",
                        "title": self.revision,
                        "additionalProperties": False,
                    },
                }
                state = {
                    "name": "HassGetState",
                    "description": "Fixture state",
                    "inputSchema": {"type": "object", "additionalProperties": False},
                }
                if self.paged and not body["params"].get("cursor"):
                    result = {"tools": [context], "nextCursor": "second"}
                elif self.paged:
                    assert body["params"]["cursor"] == "second"
                    self.page_entered.set()
                    if self.hold_page:
                        await asyncio.wait_for(self.page_release.wait(), 2)
                    if self.fail_page:
                        return httpx.Response(502, text="synthetic page interruption")
                    result = {"tools": [state]}
                else:
                    result = {"tools": [context, state]}
            elif method == "tools/call":
                if self.call_failure and body["params"]["name"] == "HassGetState":
                    return httpx.Response(502, text="synthetic MCP connection lost")
                result = {"content": [{"type": "text", "text": "Fixture live state"}]}
            else:
                raise AssertionError(method)
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": rid, "result": result})
        finally:
            self.inflight -= 1

    def count(self, method, name=None):
        return sum(
            r["method"] == method and (name is None or (r["params"] or {}).get("name") == name)
            for r in self.requests
        )


def actual_probe_loop(router):
    source = Path(tools_module.__file__).with_name("__main__.py").read_text()
    tree = ast.parse(source)
    matches = [
        n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == "_probe_loop"
    ]
    assert len(matches) == 1, "Exactly one shipped recovery-loop owner is required"
    node = matches[0]
    module = ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[]))
    scope = {"asyncio": asyncio, "contextlib": contextlib, "tools": router}
    exec(compile(module, "actual-shipped-probe-loop", "exec"), scope)
    return scope["_probe_loop"]()


async def finish_probes(server, *tasks):
    server.page_release.set()
    owned = [task for task in tasks if task is not None]
    for task in owned:
        task.cancel()
    await asyncio.wait_for(asyncio.gather(*owned, return_exceptions=True), 1)


async def eventually(predicate, seconds=5):
    async with asyncio.timeout(seconds):
        while not predicate():  # noqa: ASYNC110 - observe actual asynchronous owner state
            await asyncio.sleep(0.005)


async def router_for(server, client):
    mcp = HomeAssistantMCP(URL, "public-inert-test-token", client)
    router = ToolRouter(mcp, client=client, hub=StatusHub())
    await router.start()
    return router


async def test_startup_repeated_list_failures_actual_automatic_schedule():
    server = FaultServer()
    server.list_failures = 2
    async with httpx.AsyncClient(transport=httpx.MockTransport(server.handle)) as client:
        router = await router_for(server, client)
        assert not router.healthy and router.declarations() == []
        assert router.discovery_status()["retry_delay_s"] == 1
        loop = asyncio.create_task(actual_probe_loop(router))
        try:
            await eventually(lambda: server.count("tools/list") == 2)
            assert router.declarations() == []
            assert router.discovery_status()["retry_delay_s"] == 2
            await eventually(lambda: router.healthy)
            assert router.discovery_status()["retry_state"] == "ready"
            assert server.count("initialize") == 3 and server.count("tools/list") == 3
            assert server.count("tools/call", "GetLiveContext") == 1
            lists = [r["time"] for r in server.requests if r["method"] == "tools/list"]
            assert lists[1] - lists[0] >= 0.95 and lists[2] - lists[1] >= 1.95
            assert server.max_inflight == 1
        finally:
            loop.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await loop


async def test_atomic_pagination_failure_then_full_fresh_admission():
    server = FaultServer()
    async with httpx.AsyncClient(transport=httpx.MockTransport(server.handle)) as client:
        router = await router_for(server, client)
        old = copy.deepcopy(router.declarations())
        server.revision = "v2"
        server.paged = server.hold_page = server.fail_page = True
        probe = asyncio.create_task(router.probe())
        try:
            await asyncio.wait_for(server.page_entered.wait(), 1)
            assert router.declarations() == old
            server.page_release.set()
            assert not await asyncio.wait_for(probe, 1)
            assert router.declarations() == [] and not router._mcp.initialized
            before = server.count("tools/call", "HassGetState")
            denied = await router.dispatch(
                "HassGetState",
                {},
                expected_declaration_sha256=router.declaration_hashes(old)["HassGetState"],
            )
            assert denied["ok"] is False and server.count("tools/call", "HassGetState") == before
            server.fail_page = server.hold_page = False
            assert await router.probe()
            assert (
                next(d for d in router.declarations() if d["name"] == "GetLiveContext")[
                    "parameters"
                ]["title"]
                == "v2"
            )
            assert {d["name"] for d in router.declarations()} == {"GetLiveContext", "HassGetState"}
        finally:
            await finish_probes(server, probe)


@pytest.mark.parametrize("browser", [False, True])
async def test_active_failure_dialog_schema_recovery_and_next_session(browser, monkeypatch):
    server = FaultServer()
    wire = task = loop = None
    async with httpx.AsyncClient(transport=httpx.MockTransport(server.handle)) as client:
        router = await router_for(server, client)
        if browser:
            wire, link, session, _, _ = setup()
            sdk = wire.sdk
        else:
            session, sdk, _, _, link = build()
        session.tools = router
        batches = []
        original = session._on_live_event

        async def capture(event):
            if isinstance(event, LiveToolBatch):
                batches.append(event)
            await original(event)

        monkeypatch.setattr(session, "_on_live_event", capture)
        session.live_brain.instructions, session.live_brain.backend_instructions = (
            live_instructions(SYSTEM_PROMPT_DA)
        )

        async def wake(command):
            if browser:
                wire.send("wake", command_id=command)
                await until(lambda: wire.result(command) is not None)
                assert wire.result(command)["status"] == "accepted"
            else:
                await session.wake()

        try:
            if browser:
                task = asyncio.create_task(run_talk(wire, session, link))
            else:
                await session.start()
            await wake("first")
            generation = session.brain._connection_generation
            schema = copy.deepcopy(session.brain.tool_declarations)
            hashes = dict(session._tool_declaration_hashes)
            server.call_failure = True
            await emit(
                sdk,
                created("failed"),
                call("failed-call", name="HassGetState", arguments="{}"),
                terminal("failed"),
            )
            await until(lambda: sdk.response.item.create.await_count == 1)
            failed = json.loads(sdk.response.item.create.await_args.kwargs["item"]["output"])
            assert failed["ok"] is False and failed["error_kind"] == "mcp"
            assert not router.healthy and not router._mcp.initialized
            assert session._active and session._close_task is None
            assert server.count("tools/call", "HassGetState") == 1
            # A subsequent model request from its immutable old schema is not retried.
            await emit(
                sdk,
                created("stale", delegation="d2"),
                call("stale-call", name="HassGetState", arguments="{}", delegation="d2"),
                terminal("stale", delegation="d2"),
            )
            await until(lambda: sdk.response.item.create.await_count == 2)
            stale = json.loads(sdk.response.item.create.await_args.kwargs["item"]["output"])
            assert stale["ok"] is False and server.count("tools/call", "HassGetState") == 1
            # Ordinary typed dialogue remains admitted through actual provider request.
            assert (await session.submit_text("Hvad er to plus to?", "direct-dialog"))[
                "status"
            ] == "submitted"
            await emit(
                sdk,
                created("direct", delegation="d3"),
                {
                    "type": "session.output_transcript.delta",
                    "delta": "Fire.",
                    "start_ms": 0,
                    "end_ms": 100,
                },
                terminal("direct", delegation="d3"),
            )
            await until(lambda: "direct" in session._live_backend_revisions)
            assert session._active and session.brain._connection_generation == generation
            server.call_failure = False
            loop = asyncio.create_task(actual_probe_loop(router))
            await eventually(lambda: router.healthy)
            assert (
                session.brain.tool_declarations == schema
                and session._tool_declaration_hashes == hashes
            )
            assert (
                session.brain._connection_generation == generation and len(sdk.factory_calls) == 1
            )
            # An explicit new model batch can use the recovered identical contract;
            # the failed call itself is never replayed by recovery.
            await emit(
                sdk,
                created("restored", delegation="restore"),
                call("restored-call", name="HassGetState", arguments="{}", delegation="restore"),
                terminal("restored", delegation="restore"),
            )
            await until(lambda: len(results(sdk)) == 3)
            assert (
                results(sdk)[-1]["ok"] is True and server.count("tools/call", "HassGetState") == 2
            )
            assert session._active and session.brain._connection_generation == generation
            server.revision = "v2"
            assert await router.probe()
            assert (
                session.brain.tool_declarations == schema
                and session._tool_declaration_hashes == hashes
            )
            # Same-name schema drift must never execute through stale session schema.
            before = server.count("tools/call", "GetLiveContext")
            await emit(
                sdk,
                created("drift", delegation="d4"),
                call("drift-call", name="GetLiveContext", arguments="{}", delegation="d4"),
                terminal("drift", delegation="d4"),
            )
            await until(lambda: len(results(sdk)) == 4)
            drift = results(sdk)[-1]
            assert (
                drift["error_kind"] == "stale_schema"
                and server.count("tools/call", "GetLiveContext") == before
            )
            await session.stop()
            assert sdk.session.close.await_count == 1
            await wake("fresh")
            assert session.brain._connection_generation > generation and len(sdk.factory_calls) == 2
            assert (
                next(d for d in session.brain.tool_declarations if d["name"] == "GetLiveContext")[
                    "parameters"
                ]["title"]
                == "v2"
            )
            before_calls = server.count("tools/call")
            before_outputs = len(results(sdk))
            await session._on_live_event(batches[0])  # actual completed old generation callback
            assert session._active and session._close_task is None
            assert (
                server.count("tools/call") == before_calls and len(results(sdk)) == before_outputs
            )
            await emit(
                sdk,
                created("fresh", delegation="d5"),
                call("fresh-call", name="GetLiveContext", arguments="{}", delegation="d5"),
                terminal("fresh", delegation="d5"),
            )
            await until(lambda: len(results(sdk)) == 5)
            assert results(sdk)[-1]["ok"] is True
            assert server.count("tools/call", "HassGetState") == 2
        finally:
            if loop:
                loop.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await loop
            if task:
                await finish(wire, task)
            else:
                await session.aclose()


async def test_idle_loss_automatic_recovery_without_action_retry():
    server = FaultServer()
    async with httpx.AsyncClient(transport=httpx.MockTransport(server.handle)) as client:
        router = await router_for(server, client)
        server.list_failures = 1
        assert not await router.probe()  # actual periodic read edge, no conversation owner
        assert router.declarations() == [] and not router._mcp.initialized
        loop = asyncio.create_task(actual_probe_loop(router))
        try:
            await eventually(lambda: router.healthy)
            assert server.count("initialize") == 2 and server.count("tools/list") == 3
            assert server.count("tools/call", "HassGetState") == 0
            assert server.count("tools/call", "GetLiveContext") == 2
        finally:
            loop.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await loop


async def test_concurrent_probes_and_persistent_failure_remain_serial_bounded():
    server = FaultServer()
    async with httpx.AsyncClient(transport=httpx.MockTransport(server.handle)) as client:
        router = await router_for(server, client)
        server.paged = server.hold_page = True
        first = asyncio.create_task(router.probe())
        second = None
        try:
            await asyncio.wait_for(server.page_entered.wait(), 1)
            second = asyncio.create_task(router.probe())
            await asyncio.sleep(0)
            assert server.max_inflight == 1 and server.count("initialize") == 1
            server.page_release.set()
            assert await asyncio.wait_for(first, 1) and await asyncio.wait_for(second, 1)
            server.paged = server.hold_page = False
            server.list_failures = 8
            delays = []
            for _ in range(8):
                assert not await router.probe()
                delays.append(router.discovery_status()["retry_delay_s"])
                assert router.declarations() == []
            assert delays == [1, 2, 5, 10, 30, 60, 60, 60]
            assert server.count("tools/call", "HassGetState") == 0 and server.max_inflight == 1
        finally:
            await finish_probes(server, first, second)


@pytest.mark.parametrize("invalidate", ["schema", "execution"])
async def test_queued_read_checks_contract_and_execution_after_discovery_join(invalidate):
    server = FaultServer()
    async with httpx.AsyncClient(transport=httpx.MockTransport(server.handle)) as client:
        router = await router_for(server, client)
        old = copy.deepcopy(router.declarations())
        hashes = router.declaration_hashes(old)
        allowed = [True]
        server.paged = server.hold_page = True
        if invalidate == "schema":
            server.revision = "v2"
        probe = asyncio.create_task(router.probe())
        pending = None
        try:
            await asyncio.wait_for(server.page_entered.wait(), 1)
            before = server.count("tools/call", "GetLiveContext")
            pending = asyncio.create_task(
                router.dispatch(
                    "GetLiveContext",
                    {},
                    expected_declaration_sha256=hashes["GetLiveContext"],
                    execution_guard=lambda: allowed[0],
                )
            )
            await asyncio.sleep(0)
            assert not pending.done()
            if invalidate == "execution":
                allowed[0] = False
            server.page_release.set()
            assert await asyncio.wait_for(probe, 1)
            result = await asyncio.wait_for(pending, 1)
            assert result["ok"] is False and result["error_kind"] == (
                "stale_schema" if invalidate == "schema" else "stale_execution"
            )
            # Only the probe's explicit read is allowed; blocked queued work never reaches HTTP.
            assert server.count("tools/call", "GetLiveContext") == before + 1
            assert server.max_inflight == 1
        finally:
            await finish_probes(server, probe, pending)


async def test_declaration_copy_mutation_cannot_change_live_router_contract():
    server = FaultServer()
    async with httpx.AsyncClient(transport=httpx.MockTransport(server.handle)) as client:
        router = await router_for(server, client)
        original = router.declarations()
        detached = router.declarations()
        detached[0]["parameters"]["title"] = "forged"
        detached.clear()
        assert router.declarations() == original
        before = server.count("tools/call", "GetLiveContext")
        result = await router.dispatch(
            "GetLiveContext",
            {},
            expected_declaration_sha256=router.declaration_hashes(original)["GetLiveContext"],
        )
        assert result["ok"] is True and server.count("tools/call", "GetLiveContext") == before + 1


class DeadlineServer(FaultServer):
    """HA accepted a mutation, but its reply stalls past the router deadline."""

    def __init__(self, *, room=False):
        super().__init__()
        self.effects = []
        self.stall_target = "light.two" if room else "light.one"
        self.call_entered = asyncio.Event()
        self.call_cancelled = asyncio.Event()
        self.release_call = asyncio.Event()
        self.stall_service = False
        self.service_calls = []

    async def handle(self, request):
        path = request.url.path
        if path.endswith("/states"):
            return httpx.Response(
                200,
                json=[
                    {"entity_id": name, "state": "off", "attributes": {}}
                    for name in ("light.one", "light.two")
                ],
            )
        if path.endswith("/template"):
            return httpx.Response(200, json=["light.one", "light.two"])
        if path.endswith("/services"):
            services = {"recently_played": {}}
            if self.stall_service:
                fixture = Path(__file__).parents[1] / "fixtures/podconnect_target_services.json"
                services.update(json.loads(fixture.read_text())["services"])
            return httpx.Response(200, json=[{"domain": "podconnect", "services": services}])
        if "/services/podconnect/" in path:
            assert self.stall_service
            self.service_calls.append(path.rsplit("/", 1)[1])
            self.call_entered.set()
            await self.release_call.wait()
            return httpx.Response(200, json={"service_response": {"tracks": []}})
        body = json.loads(request.content)
        if body["method"] == "tools/call" and body["params"]["name"] == "HassTurnOn":
            assert request.headers["MCP-Protocol-Version"] == "2025-06-18"
            target = body["params"]["arguments"]["name"]
            self.effects.append(target)
            if target == self.stall_target:
                self.call_entered.set()
                try:
                    await self.release_call.wait()
                except asyncio.CancelledError:
                    self.call_cancelled.set()
                    raise
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": body["id"],
                    "result": {"content": [{"type": "text", "text": "Fixture accepted"}]},
                },
            )
        response = await super().handle(request)
        if body["method"] == "tools/list":
            payload = response.json()
            payload["result"]["tools"].append(
                {"name": "HassTurnOn", "description": "Turn on", "inputSchema": {}}
            )
            return httpx.Response(200, json=payload)
        return response


async def deadline_router(server, client):
    mcp = HomeAssistantMCP(URL, "public-inert-test-token", client)
    router = ToolRouter(mcp, supervisor_token="public-inert-test-token", client=client)
    await router.start()
    assert router.healthy
    return router


@pytest.mark.parametrize("room", [False, True])
async def test_mcp_router_deadline_recovers_without_replaying_accepted_action(room, monkeypatch):
    from gatekeeper import constants as C

    monkeypatch.setattr(C, "TOOL_TIMEOUT_S", 0.02)
    server = DeadlineServer(room=room)
    loop = None
    async with httpx.AsyncClient(transport=httpx.MockTransport(server.handle)) as client:
        router = await deadline_router(server, client)
        session_schema = router.declarations()
        session_hashes = router.declaration_hashes(session_schema)
        args = {"area": "Fixture room", "domain": ["light"]} if room else {"name": "light.one"}
        result = await router.dispatch(
            "HassTurnOn", args, expected_declaration_sha256=session_hashes["HassTurnOn"]
        )
        assert server.call_entered.is_set() and server.call_cancelled.is_set()
        assert result["error_kind"] == ("partial_failure" if room else "timeout")
        if room:
            assert result["data"]["results"][0]["result"]["ok"] is True
            assert result["data"]["results"][1]["result"]["error_kind"] == "timeout"
        accepted = ["light.one", "light.two"] if room else ["light.one"]
        assert server.effects == accepted
        assert not router.healthy and not router._mcp.initialized
        assert router.discovery_status()["retry_state"] == "retrying"
        assert router.discovery_status()["retry_delay_s"] == 1
        assert router._recovery_wakeup.is_set()
        assert "HassTurnOn" not in {item["name"] for item in router.declarations()}
        assert router.declaration_hashes(session_schema) == session_hashes
        # No restart, schema replacement in the active session, or action replay:
        # the actual shipped owner performs fresh discovery plus a read-only probe.
        try:
            loop = asyncio.create_task(actual_probe_loop(router))
            await eventually(lambda: router.healthy)
            assert server.count("initialize") == 2
            assert router.discovery_status()["retry_state"] == "ready"
            next_schema = router.declarations()
            read = await router.dispatch(
                "HassGetState",
                {},
                expected_declaration_sha256=router.declaration_hashes(next_schema)["HassGetState"],
            )
            assert read["ok"] is True and server.count("tools/call", "HassGetState") == 1
            assert server.effects == accepted
            assert router.declaration_hashes(session_schema) == session_hashes
        finally:
            await finish_probes(server, loop)


@pytest.mark.parametrize("stop", ["cancel", "guard", "newer_failure"])
async def test_mcp_deadline_does_not_override_stop_or_newer_failure(stop, monkeypatch):
    from gatekeeper import constants as C

    monkeypatch.setattr(C, "TOOL_TIMEOUT_S", 0.03)
    server = DeadlineServer()
    allowed = [True]
    async with httpx.AsyncClient(transport=httpx.MockTransport(server.handle)) as client:
        router = await deadline_router(server, client)
        before = router.discovery_status()
        dispatch = asyncio.create_task(
            router.dispatch("HassTurnOn", {"name": "light.one"}, execution_guard=lambda: allowed[0])
        )
        await asyncio.wait_for(server.call_entered.wait(), 1)
        if stop == "cancel":
            dispatch.cancel()
            with pytest.raises(asyncio.CancelledError):
                await dispatch
        else:
            if stop == "guard":
                allowed[0] = False
            else:
                router._record_discovery_failure(McpError("newer failure", connection_shaped=True))
                newer = router.discovery_status()
            assert (await dispatch)["error_kind"] == "timeout"
        assert server.effects == ["light.one"] and server.call_cancelled.is_set()
        after = router.discovery_status()
        if stop == "newer_failure":
            assert after == newer and after["retry_attempt"] == 1
        else:
            assert router.healthy and router._mcp.initialized
            assert after == before and not router._recovery_wakeup.is_set()


async def test_podconnect_service_deadline_preserves_healthy_mcp(monkeypatch):
    from gatekeeper import constants as C

    monkeypatch.setattr(C, "TOOL_TIMEOUT_S", 0.02)
    server = DeadlineServer()
    server.stall_service = True
    async with httpx.AsyncClient(transport=httpx.MockTransport(server.handle)) as client:
        router = await deadline_router(server, client)
        before = router.discovery_status()
        epoch = router._mcp_epoch
        for name, args, outcome in (
            ("podconnect_recently_played", {}, "timeout"),
            ("podconnect_get_targets", {}, "unknown_outcome"),
            (
                "podconnect_move_playback",
                {"config_entry_id": "A", "kind": "spotify_device", "target_id": "B"},
                "unknown_outcome",
            ),
        ):
            result = await router.dispatch(name, args)
            assert server.call_entered.is_set()
            assert result["error_kind"] == outcome
            current = router.discovery_status()
            # Target dispatch legitimately refreshes service discovery. It may
            # advance generation, but cannot reset MCP or enter failure/backoff.
            assert {k: v for k, v in current.items() if k != "generation"} == {
                k: v for k, v in before.items() if k != "generation"
            }
            assert current["generation"] >= before["generation"]
            assert router._mcp_epoch == epoch
            assert router.healthy and router._mcp.initialized
            assert not router._recovery_wakeup.is_set() and server.effects == []
        assert server.service_calls == ["recently_played", "get_targets", "move_playback"]
        # A room selector cannot turn this local service into a canonical MCP batch.
        after_services = router.discovery_status()
        rejected = await router.dispatch(
            "podconnect_move_playback",
            {
                "config_entry_id": "A",
                "kind": "spotify_device",
                "target_id": "B",
                "area": "Fixture room",
            },
        )
        assert rejected["error_kind"] == "bad_args"
        assert router.discovery_status() == after_services and server.effects == []
        assert len(server.service_calls) == 3


@pytest.mark.parametrize("new_owner", ["discovery", "client"])
async def test_retired_mcp_deadline_cannot_invalidate_fresh_discovery(new_owner, monkeypatch):
    from gatekeeper import constants as C

    monkeypatch.setattr(C, "TOOL_TIMEOUT_S", 0.06)
    server = DeadlineServer()
    async with httpx.AsyncClient(transport=httpx.MockTransport(server.handle)) as client:
        router = await deadline_router(server, client)
        old_generation = router.discovery_status()["generation"]
        # Public dispatch normally serializes this through _fetch_lock. Exercise
        # the retired inner operation explicitly so fresh discovery can publish
        # before its deadline callback; the callback must not gain fresh custody.
        dispatch = asyncio.create_task(router._dispatch_locked("HassTurnOn", {"name": "light.one"}))
        await asyncio.wait_for(server.call_entered.wait(), 1)
        if new_owner == "client":
            router._mcp = HomeAssistantMCP(URL, "public-inert-test-token", client)
        assert await router.probe()
        fresh = router.discovery_status()
        assert fresh["generation"] > old_generation
        assert (await dispatch)["error_kind"] == "timeout"
        assert router.discovery_status() == fresh
        assert router.healthy and router._mcp.initialized
        assert not router._recovery_wakeup.is_set()
        assert server.effects == ["light.one"] and server.call_cancelled.is_set()
