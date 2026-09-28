"""Actual SDK/TCP terminal cleanup; the local peer deliberately never closes TCP."""

import asyncio
import base64
import hashlib
import json
import socket
import struct

import openai
import pytest
import websockets
from openai import AsyncOpenAI
from openai.types.live.session_closed_event import SessionClosedEvent

from gatekeeper.openai_live import OpenAILiveSession
from gatekeeper.provider_budget import ProviderBudgetCoordinator


def frame(payload, opcode=1):
    size = len(payload)
    prefix = bytes([0x80 | opcode])
    if size < 126:
        prefix += bytes([size])
    elif size < 65536:
        prefix += b"\x7e" + struct.pack("!H", size)
    else:
        prefix += b"\x7f" + struct.pack("!Q", size)
    return prefix + payload


async def read_frame(reader):
    first, second = await reader.readexactly(2)
    size = second & 127
    if size == 126:
        size = struct.unpack("!H", await reader.readexactly(2))[0]
    elif size == 127:
        size = struct.unpack("!Q", await reader.readexactly(8))[0]
    mask = await reader.readexactly(4) if second & 128 else None
    data = await reader.readexactly(size)
    if mask:
        data = bytes(byte ^ mask[i % 4] for i, byte in enumerate(data))
    return first & 15, data


class Peer:
    def __init__(self, mode):
        self.mode = mode
        self.release = asyncio.Event()
        self.closed = asyncio.Event()
        self.close_seen = asyncio.Event()
        self.handlers = set()
        self.errors = []
        self.number = 0

    async def handle(self, reader, writer):
        task = asyncio.current_task()
        self.handlers.add(task)
        self.number += 1
        number = self.number
        try:
            request = await reader.readuntil(b"\r\n\r\n")
            headers = dict(
                line.split(b": ", 1) for line in request.split(b"\r\n")[1:] if b": " in line
            )
            accept = base64.b64encode(
                hashlib.sha1(
                    headers[b"Sec-WebSocket-Key"] + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
                ).digest()
            )
            writer.write(
                b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
                b"Connection: Upgrade\r\nSec-WebSocket-Accept: " + accept + b"\r\n\r\n"
            )
            await writer.drain()
            opcode, command = await read_frame(reader)
            assert opcode == 1 and json.loads(command)["type"] == "session.start"
            session = {
                "id": f"local-{number}",
                "model": "gpt-live-1",
                "status": "active",
                "expires_at": 2000000000,
            }
            writer.write(
                frame(
                    json.dumps(
                        {
                            "type": "session.started",
                            "event_id": f"start-{number}",
                            "session": session,
                        }
                    ).encode()
                )
            )
            await writer.drain()
            opcode, command = await read_frame(reader)
            assert opcode == 1 and json.loads(command)["type"] == "session.close"
            terminal = {
                "type": "session.closed",
                "event_id": f"end-{number}",
                "reason": "close_requested",
                "session": session,
                "usage": {"seconds": 1.25},
            }
            SessionClosedEvent.model_validate(terminal)
            writer.write(frame(json.dumps(terminal).encode()))
            await writer.drain()
            if self.mode.startswith("writer"):
                writer.transport.pause_reading()
            else:
                opcode, payload = await read_frame(reader)
                assert opcode == 8
                self.close_seen.set()
                if self.mode == "tcp_stall":
                    writer.write(frame(payload, 8))
                    await writer.drain()
            await self.release.wait()
        except (asyncio.IncompleteReadError, ConnectionResetError):
            pass  # Expected when the finalized owner aborts its exact TCP connection.
        except BaseException as exc:
            self.errors.append(exc)
        finally:
            writer.transport.abort()
            await writer.wait_closed()
            self.handlers.discard(task)
            self.closed.set()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mode", ["handshake_stall", "tcp_stall", "writer_pending", "writer_cancel", "close_cancel"]
)
async def test_finalized_actual_sdk_closes_owned_tcp_without_peer_shutdown(mode):
    assert openai.__version__ == "3.13.0" and websockets.__version__ == "15.0.1"
    peer = Peer(mode)
    server = await asyncio.start_server(peer.handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    budget = ProviderBudgetCoordinator()
    clients = []

    def factory(**kwargs):
        client = AsyncOpenAI(**kwargs, websocket_base_url=f"ws://127.0.0.1:{port}")
        clients.append(client)
        return client

    session = OpenAILiveSession(
        "local-synthetic-no-secret",
        tool_declarations=[],
        client_factory=factory,
        provider_budget=budget,
        timeout_s=2,
    )
    old = None
    writers = []
    try:
        for generation in (1, 2):
            await session.connect()
            connection = session._connection
            current = connection._connection
            reader = session._reader
            if old is not None:
                assert current is not old and current.transport is not old.transport
                old.transport.abort()  # Delayed old cleanup while new socket is live.
                await old.wait_closed()
                assert not current.connection_lost_waiter.done()
                assert session._finalized_generation is None
            await session.request_close()
            await asyncio.wait_for(session._closed.wait(), 1)
            assert session.final_usage_seconds == 1.25
            assert session._finalized_generation == generation
            if mode.startswith("writer"):
                current.transport.get_extra_info("socket").setsockopt(
                    socket.SOL_SOCKET, socket.SO_SNDBUF, 4096
                )
                current.transport.set_write_buffer_limits(high=8192, low=4096)
                # Real SDK append/send/drain; stand in for a writer already in flight.
                writer = asyncio.create_task(
                    connection.session.input_audio.append(audio="eA==" * (2 * 1024 * 1024))
                )
                writers.append(writer)
                for _ in range(100):
                    if current.transport.get_write_buffer_size() > 8192:
                        break
                    await asyncio.sleep(0.01)
                assert current.transport.get_write_buffer_size() > 8192 and not writer.done()
                if mode == "writer_cancel":
                    writer.cancel()
                    await asyncio.gather(writer, return_exceptions=True)
            # The peer never releases/finishes a graceful TCP close. This completes
            # only by the production local-owner path, not by a timed peer fallback.
            if mode == "close_cancel":
                waiting = asyncio.Event()

                async def terminal_wait(waiting=waiting):
                    waiting.set()
                    await asyncio.Future()

                session._closed.wait = terminal_wait
                closing = asyncio.create_task(session.close())
                await waiting.wait()
                closing.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await closing
            else:
                await asyncio.wait_for(session.close(), 1)
            assert not peer.release.is_set()
            assert reader.done() and session._reader is None
            assert current.connection_lost_waiter.done()
            assert current.transport.get_write_buffer_size() == 0
            await asyncio.gather(*writers, return_exceptions=True)
            assert all(task.done() for task in writers)
            await session.close()  # Duplicate close remains idempotent.
            assert not budget.snapshot(session.api_key, session.backend_model)[
                "production_sessions"
            ]
            old = current
    finally:
        if session._connection is not None:
            session._connection._connection.transport.abort()
        peer.release.set()
        await asyncio.gather(*writers, return_exceptions=True)
        await asyncio.gather(*list(peer.handlers), return_exceptions=True)
        server.close()
        await server.wait_closed()
        for client in clients:
            await client.close()
    assert not peer.errors
    assert not peer.handlers
