"""Real progressing HTTP discovery must obey the existing absolute operation budget."""

import asyncio
import contextlib
import copy
import json
import time

import httpx

# The existing composed peer and actual adapter fixtures keep the shared ownership path.
import pytest
from test_talk_webrtc import finish, setup
from test_thin_live import build, emit, until
from test_thin_mcp_recovery import URL, FaultServer, actual_probe_loop, eventually, router_for
from unit.test_openai_live import call, created, terminal

from gatekeeper import constants as C
from gatekeeper.hub import StatusHub
from gatekeeper.live_prompt import live_instructions
from gatekeeper.mcp_client import HomeAssistantMCP
from gatekeeper.prompt import SYSTEM_PROMPT_DA
from gatekeeper.talk import run_talk
from gatekeeper.tools import ToolRouter


class ProgressPeer:
    def __init__(self):
        self.methods = []
        self.tasks = []
        self.writers = []
        self.errors = []
        self.inject = False
        self.entered = asyncio.Event()
        self.stop_progress = asyncio.Event()
        self.release = asyncio.Event()
        self.chunks = 0
        self.first_chunk_at = None
        self.last_chunk_at = None
        self.revision = "v1"

    async def handle(self, reader, writer):
        self.tasks.append(asyncio.current_task())
        self.writers.append(writer)
        try:
            raw = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 2)
            lines = raw.decode().split("\r\n")
            assert lines[0] == "POST /api/mcp/assist HTTP/1.1"
            headers = dict(line.split(": ", 1) for line in lines[1:] if ": " in line)
            body = json.loads(await reader.readexactly(int(headers["Content-Length"])))
            method = body["method"]
            self.methods.append(method)
            if method == "tools/list" and self.inject:
                self.inject = False
                self.revision = "v2"
                writer.write(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                    b"Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
                )
                while not self.stop_progress.is_set():
                    writer.write(b"1\r\n \r\n")
                    await writer.drain()
                    self.chunks += 1
                    self.last_chunk_at = time.monotonic()
                    if self.first_chunk_at is None:
                        self.first_chunk_at = self.last_chunk_at
                    self.entered.set()
                    try:
                        await asyncio.wait_for(self.stop_progress.wait(), 0.2)
                    except TimeoutError:
                        pass
                await self.release.wait()
                return
            if method == "initialize":
                result = {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "Inert loopback peer", "version": "1"},
                }
            elif method == "notifications/initialized":
                writer.write(
                    b"HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                )
                await writer.drain()
                return
            elif method == "tools/list":
                result = {
                    "tools": [
                        {
                            "name": "GetLiveContext",
                            "description": "Inert read-only context",
                            "inputSchema": {
                                "type": "object",
                                "title": self.revision,
                                "additionalProperties": False,
                            },
                        }
                    ]
                }
            else:
                assert method == "tools/call"
                assert body["params"] == {"name": "GetLiveContext", "arguments": {}}
                result = {"content": [{"type": "text", "text": "Inert context"}]}
            payload = json.dumps({"jsonrpc": "2.0", "id": body["id"], "result": result}).encode()
            writer.write(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
                + str(len(payload)).encode()
                + b"\r\nConnection: close\r\n\r\n"
                + payload
            )
            await writer.drain()
        except (ConnectionError, asyncio.IncompleteReadError):
            pass
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.errors.append(exc)
        finally:
            writer.close()
            with contextlib.suppress(ConnectionError):
                await asyncio.wait_for(writer.wait_closed(), 2)


async def test_actual_http_progressing_discovery_total_deadline_recovers_fresh_schema():
    peer = ProgressPeer()
    server = await asyncio.start_server(peer.handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    url = f"http://127.0.0.1:{port}/api/mcp/assist"
    probe = loop = pending = None
    # Exact production timeout values. The test changes no runtime setting or clock.
    async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=3.0)) as client:
        mcp = HomeAssistantMCP(url, "inert-loopback-token", client)
        router = ToolRouter(mcp, client=client, hub=StatusHub())
        try:
            async with asyncio.timeout(20):
                await router.start()
                assert router.healthy and mcp.initialized
                old = copy.deepcopy(router.declarations())
                peer.inject = True
                probe = asyncio.create_task(router.probe())
                await asyncio.wait_for(peer.entered.wait(), 1)
                assert router._fetch_lock.locked() and router.declarations() == old
                pending = asyncio.create_task(
                    router.dispatch(
                        "GetLiveContext",
                        {},
                        expected_declaration_sha256=router.declaration_hashes(old)[
                            "GetLiveContext"
                        ],
                    )
                )
                started = time.monotonic()
                assert not await asyncio.wait_for(probe, C.TOOL_TIMEOUT_S + 1)
                assert time.monotonic() - started >= C.TOOL_TIMEOUT_S - 0.5
                assert peer.chunks >= 30
                assert peer.last_chunk_at - peer.first_chunk_at >= 8
                assert not peer.stop_progress.is_set()  # peer progressed until client cancellation
                assert peer.methods.count("initialize") == 1
                assert (await asyncio.wait_for(pending, 1))["error_kind"] == "stale_schema"
                assert not router._fetch_lock.locked()
                assert peer.methods.count("tools/call") == 1
                failed = router.discovery_status()
                assert not router.healthy and not mcp.initialized
                assert failed["retry_state"] == "retrying" and failed["retry_delay_s"] == 1
                assert "MCP declaration admission failed" in failed["last_error"]
                assert router.declarations() == []
                loop = asyncio.create_task(actual_probe_loop(router))
                await eventually(lambda: router.healthy, seconds=1.8)
                assert peer.methods.count("initialize") == 2
                assert peer.methods.count("tools/list") == 3
                assert peer.methods.count("tools/call") == 2  # explicit read-only probes only
                fresh = router.declarations()
                assert fresh[0]["parameters"]["title"] == "v2" and fresh != old
                assert router.discovery_status()["retry_state"] == "ready"
                assert not peer.errors
        finally:
            peer.stop_progress.set()
            peer.release.set()
            server.close()
            await server.wait_closed()
            for task in (loop, probe, pending):
                if task is not None and not task.done():
                    task.cancel()
            await asyncio.wait_for(
                asyncio.gather(
                    *(t for t in (loop, probe, pending) if t is not None), return_exceptions=True
                ),
                2,
            )
            for writer in peer.writers:
                writer.close()
            peer_results = await asyncio.wait_for(
                asyncio.gather(*peer.tasks, return_exceptions=True), 2
            )
            assert not any(isinstance(result, BaseException) for result in peer_results)
            assert not peer.errors
            assert all(t.done() for t in peer.tasks) and not server.is_serving()


@pytest.mark.parametrize("external_cancel", [False, True])
async def test_service_discovery_deadline_or_external_cancel_preserves_mcp_domain(
    external_cancel, monkeypatch
):
    server = FaultServer()
    entered, release, cancelled = asyncio.Event(), asyncio.Event(), asyncio.Event()
    hold = False

    async def handle(request):
        if request.method == "GET":
            assert request.url.path.endswith("/services")
            if hold:
                entered.set()
                try:
                    await release.wait()
                except asyncio.CancelledError:
                    cancelled.set()
                    raise
            return httpx.Response(
                200, json=[{"domain": "podconnect", "services": {"recently_played": {}}}]
            )
        return await server.handle(request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        router = ToolRouter(
            HomeAssistantMCP(URL, "inert-token", client),
            client=client,
            supervisor_token="inert-token",
            hub=StatusHub(),
        )
        await router.start()
        before, epoch = router.discovery_status(), router._mcp_epoch
        assert "podconnect_recently_played" in {d["name"] for d in router.declarations()}
        hold = True
        monkeypatch.setattr(C, "TOOL_TIMEOUT_S", 1 if external_cancel else 0.03)
        task = asyncio.create_task(router._refresh_podconnect_services())
        try:
            await asyncio.wait_for(entered.wait(), 1)
            if external_cancel:
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await task
                assert router.discovery_status() == before
            else:
                await asyncio.wait_for(task, 1)
                assert "podconnect_recently_played" not in {
                    d["name"] for d in router.declarations()
                }
                assert router.discovery_status()["generation"] > before["generation"]
            assert cancelled.is_set()
            assert router.healthy and router._mcp.initialized and router._mcp_epoch == epoch
            assert not router._recovery_wakeup.is_set()
            assert router._discovery.mcp_names == {"GetLiveContext", "HassGetState"}
            assert server.count("tools/call") == 1
        finally:
            release.set()
            if not task.done():
                task.cancel()
            results = await asyncio.gather(task, return_exceptions=True)
            assert all(
                not isinstance(r, BaseException) or isinstance(r, asyncio.CancelledError)
                for r in results
            )


@pytest.mark.parametrize("external_cancel", [False, True])
async def test_mcp_discovery_external_cancel_or_late_epoch_cannot_publish(
    external_cancel, monkeypatch
):
    server = FaultServer()
    async with httpx.AsyncClient(transport=httpx.MockTransport(server.handle)) as client:
        router = await router_for(server, client)
        before, epoch = router.discovery_status(), router._mcp_epoch
        monkeypatch.setattr(C, "TOOL_TIMEOUT_S", 1)
        server.paged = server.hold_page = True
        task = asyncio.create_task(router._refresh(force=True))
        try:
            await asyncio.wait_for(server.page_entered.wait(), 1)
            if external_cancel:
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await task
                assert router.discovery_status() == before and router._mcp_epoch == epoch
                assert router.healthy and router._mcp.initialized
                assert not router._recovery_wakeup.is_set()
            else:
                from gatekeeper.mcp_client import McpError

                router._record_discovery_failure(McpError("newer failure", connection_shaped=True))
                failed = router.discovery_status()
                server.page_release.set()
                await asyncio.wait_for(task, 1)
                assert router.discovery_status() == failed
                assert not router.healthy and not router._mcp.initialized
                assert router._mcp_epoch == epoch + 1 and router.declarations() == []
            assert not router._fetch_lock.locked() and server.inflight == 0
            assert server.count("tools/call") == 1
        finally:
            server.page_release.set()
            if not task.done():
                task.cancel()
            results = await asyncio.gather(task, return_exceptions=True)
            assert all(
                not isinstance(r, BaseException) or isinstance(r, asyncio.CancelledError)
                for r in results
            )


@pytest.mark.parametrize("browser", [False, True])
async def test_discovery_deadline_preserves_actual_active_adapter_and_new_wake(
    browser, monkeypatch
):
    server = FaultServer()
    wire = owner = None
    async with httpx.AsyncClient(transport=httpx.MockTransport(server.handle)) as client:
        router = await router_for(server, client)
        if browser:
            wire, link, session, _, _ = setup()
            sdk = wire.sdk
            owner = asyncio.create_task(run_talk(wire, session, link))
        else:
            session, sdk, _, _, link = build()
            await session.start()
        session.tools = router
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
            await wake("first")
            schema = copy.deepcopy(session.brain.tool_declarations)
            hashes = dict(session._tool_declaration_hashes)
            generation = session.brain._connection_generation
            monkeypatch.setattr(C, "TOOL_TIMEOUT_S", 0.03)
            server.paged = server.hold_page = True
            assert not await router.probe()
            assert server.page_entered.is_set() and server.inflight == 0
            assert (
                not router.healthy
                and not router._mcp.initialized
                and not router._fetch_lock.locked()
            )
            assert session._active and session._close_task is None
            assert (
                session.brain.tool_declarations == schema
                and session._tool_declaration_hashes == hashes
            )
            assert (
                session.brain._connection_generation == generation and len(sdk.factory_calls) == 1
            )
            await emit(
                sdk,
                created("stale"),
                call("stale-call", name="HassGetState", arguments="{}"),
                terminal("stale"),
            )
            await until(lambda: sdk.response.item.create.await_count == 1)
            assert not json.loads(sdk.response.item.create.await_args.kwargs["item"]["output"])[
                "ok"
            ]
            assert server.count("tools/call", "HassGetState") == 0
            assert (await session.submit_text("Hvad er to plus to?", "direct"))[
                "status"
            ] == "submitted"
            await emit(
                sdk, created("direct", delegation="direct"), terminal("direct", delegation="direct")
            )
            await until(lambda: "direct" in session._live_backend_revisions)
            assert session._active and session.brain._connection_generation == generation
            server.hold_page = False
            server.revision = "v2"
            assert await router.probe()
            assert (
                session.brain.tool_declarations == schema
                and session._tool_declaration_hashes == hashes
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
        finally:
            server.page_release.set()
            if owner:
                await finish(wire, owner)
            else:
                await session.aclose()
