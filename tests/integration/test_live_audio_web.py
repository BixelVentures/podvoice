import asyncio
import socket

import pytest
from aiohttp import ClientPayloadError, web
from aiohttp.test_utils import TestClient, TestServer

from gatekeeper.hub import StatusHub
from gatekeeper.live_audio import LiveAudioError, LiveAudioStreams, live_wav_header
from gatekeeper.web import create_app


def client_for(streams):
    return TestClient(
        TestServer(create_app(StatusHub(), {}, live_audio=streams, reply_token="secret"))
    )


def path(stream):
    return f"/reply/live/{stream.id}.wav?t=secret"


async def test_auth_and_range_rejections_do_not_claim_stream():
    streams = LiveAudioStreams()
    stream = streams.open("session")
    async with client_for(streams) as client:
        assert (await client.get(path(stream).replace("secret", "wrong"))).status == 403
        assert (await client.get(path(stream), headers={"Range": "bytes=1-"})).status == 416
        assert not stream.claimed
        stream.append(b"\x01\x02")
        stream.finish()
        response = await client.get(path(stream))
        assert response.status == 200
        assert response.headers["Content-Type"] == "audio/wav"
        assert await response.read() == live_wav_header() + b"\x01\x02"
        assert (await client.get(path(stream))).status == 404


async def test_streams_before_finish_and_rejects_double_fetch():
    streams = LiveAudioStreams()
    stream = streams.open("session")
    async with client_for(streams) as client:
        response = await client.get(path(stream))
        assert await response.content.readexactly(44) == live_wav_header()
        assert (await client.get(path(stream))).status == 409
        stream.append(b"\x11\x22")
        assert await asyncio.wait_for(response.content.readexactly(2), 1) == b"\x11\x22"
        assert not response.content.at_eof()
        stream.append(b"\x33\x44")
        stream.finish()
        assert await response.read() == b"\x33\x44"


async def test_idle_peer_disconnect_cancels_resource_and_late_producer():
    streams = LiveAudioStreams()
    stream = streams.open("session")
    async with client_for(streams) as client:
        response = await client.get(path(stream))
        await response.content.readexactly(44)
        response.close()
        await asyncio.wait_for(stream.wait_cancelled(), 2)
        assert stream.fault in {"http_disconnect", "http_cancelled"}
        with pytest.raises(LiveAudioError):
            stream.append(b"\x11\x22")
        assert (await client.get(path(stream))).status == 404


async def test_cancel_aborts_http_and_stale_request_cannot_take_next_stream():
    streams = LiveAudioStreams()
    stream = streams.open("old")
    async with client_for(streams) as client:
        response = await client.get(path(stream))
        await response.content.readexactly(44)
        stream.cancel("hardware_stop")
        with pytest.raises(ClientPayloadError):
            await asyncio.wait_for(response.read(), 1)
        assert stream.fault == "hardware_stop"
        new = streams.open("new")
        new.append(b"\xab\xcd")
        new.finish()
        assert (await client.get(path(stream))).status == 404
        fresh = await client.get(path(new))
        assert await fresh.read() == live_wav_header() + b"\xab\xcd"


async def test_cancel_discards_real_tcp_backpressure_before_peer_reads_and_next_stream_drains():
    """Handler completion alone must not leave cancelled audio queued on its socket."""
    streams = LiveAudioStreams()
    old = streams.open("old")
    new = streams.open("new")
    app = create_app(StatusHub(), {}, live_audio=streams, reply_token="secret")
    observed = {}
    handler_exited = asyncio.Event()

    @web.middleware
    async def observe_transport(request, handler):
        if request.match_info.get("stream_id") != old.id:
            return await handler(request)
        transport = request.transport
        native_socket = transport.get_extra_info("socket")
        native_socket.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 4096)
        transport.set_write_buffer_limits(high=4096, low=1024)
        observed.update(transport=transport, socket=native_socket)
        try:
            return await handler(request)
        finally:
            handler_exited.set()

    app.middlewares.append(observe_transport)
    producer = None
    peer = socket.socket()
    peer.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024)
    peer.setblocking(False)
    loop = asyncio.get_running_loop()
    async with TestClient(TestServer(app)) as client:
        try:
            await loop.sock_connect(peer, (client.server.host, client.server.port))
            await loop.sock_sendall(
                peer, f"GET {path(old)} HTTP/1.1\r\nHost: localhost\r\n\r\n".encode()
            )
            async with asyncio.timeout(5):
                headers = b""
                while b"\r\n\r\n" not in headers:
                    part = await loop.sock_recv(peer, 256)
                    assert part, "server closed before sending the WAV response"
                    headers += part
                assert headers.startswith(b"HTTP/1.1 200")

                async def fill():
                    for index in range(32):
                        await old.append_wait(
                            b"\x51\x6a" * 24000,
                            timeout_s=5,
                            current=lambda: not old.cancelled,
                        )
                        observed["accepted"] = index + 1
                        await asyncio.sleep(0)

                producer = asyncio.create_task(fill())
                previous = None
                stable_since = None
                # Pause peer reads until both writer and producer really stall.
                # A transient positive queue may still drain into kernel buffers.
                while True:
                    current = (
                        observed["transport"].get_write_buffer_size(),
                        observed.get("accepted"),
                    )
                    if current[0] >= 16384 and current == previous:
                        if stable_since is None:
                            stable_since = loop.time()
                        if loop.time() - stable_since >= 0.3:
                            break
                    else:
                        stable_since = None
                    previous = current
                    await asyncio.sleep(0.01)
                assert not producer.done()
                assert not handler_exited.is_set()
                assert observed["socket"].fileno() != -1

                old.cancel("hardware_stop")
                await handler_exited.wait()
                # No peer reads may release the blocked transport before proof.
                async with asyncio.timeout(1):
                    while observed["socket"].fileno() != -1:  # noqa: ASYNC110 - no public transport-close awaitable
                        await asyncio.sleep(0.01)
                assert observed["transport"].get_write_buffer_size() == 0
                assert not new.cancelled
                with pytest.raises(LiveAudioError):
                    old.append(b"\x01\x02")
                assert (await client.get(path(old))).status == 404
                pcm = bytes(range(256)) * 100
                new.append(pcm)
                new.finish()
                fresh = await client.get(path(new))
                assert await fresh.read() == live_wav_header() + pcm
                assert not new.cancelled
        finally:
            if producer is not None:
                producer.cancel()
                await asyncio.gather(producer, return_exceptions=True)
            peer.close()
            streams.close()
            if observed and observed["socket"].fileno() != -1:
                observed["transport"].abort()


async def test_late_cancel_after_normal_finish_cannot_abort_next_keepalive_request():
    streams = LiveAudioStreams()
    old = streams.open("old")
    new = streams.open("new")
    transports = {}
    old_handler_exited = asyncio.Event()
    app = create_app(StatusHub(), {}, live_audio=streams, reply_token="secret")

    @web.middleware
    async def observe_transport(request, handler):
        stream_id = request.match_info.get("stream_id")
        transports[stream_id] = request.transport
        try:
            return await handler(request)
        finally:
            if stream_id == old.id:
                old_handler_exited.set()

    app.middlewares.append(observe_transport)
    async with TestClient(TestServer(app)) as client, asyncio.timeout(5):
        old.append(b"\x11\x22")
        old.finish()
        first = await client.get(path(old))
        assert await first.read() == live_wav_header() + b"\x11\x22"
        await old_handler_exited.wait()
        second = await client.get(path(new))
        assert await second.content.readexactly(44) == live_wav_header()
        assert transports[old.id] is transports[new.id]
        old.cancel("late_old_stop")
        pcm = b"\x33\x44" * 12000
        new.append(pcm)
        new.finish()
        assert await second.read() == pcm
        assert not new.cancelled


async def test_unconfigured_live_route_does_not_enter_flac_bus():
    async with client_for(None) as client:
        assert (await client.get("/reply/live/missing.wav?t=secret")).status == 503


@pytest.mark.parametrize("stop_mode", ["cancel", "timeout"])
async def test_blocked_writer_is_cancelled_with_exact_transport_and_next_stream_survives(
    monkeypatch,
    stop_mode,
):
    from aiohttp.test_utils import make_mocked_request

    from gatekeeper import web as audio_web

    streams = LiveAudioStreams()
    stream = streams.open("blocked")
    stream.append(b"\xaa\xbb")
    other = streams.open("next")
    other.append(b"\x11\x22")
    blocked = asyncio.Event()
    cancelled = asyncio.Event()

    class BlockedResponse:
        def __init__(self, **kwargs):
            pass

        def enable_chunked_encoding(self):
            pass

        async def prepare(self, request):
            pass

        async def write(self, pcm):
            if len(pcm) == 44:
                return
            blocked.set()
            try:
                await asyncio.Future()
            finally:
                cancelled.set()

    monkeypatch.setattr(audio_web.web, "StreamResponse", BlockedResponse)
    if stop_mode == "timeout":
        monkeypatch.setattr(audio_web, "LIVE_HTTP_WRITE_TIMEOUT_S", 0.03)
    request = make_mocked_request(
        "GET",
        path(stream),
        match_info={"stream_id": stream.id},
        app=create_app(StatusHub(), {}, live_audio=streams),
    )
    request.transport.is_closing.return_value = False
    handler = asyncio.create_task(audio_web._live_audio(request))
    await asyncio.wait_for(blocked.wait(), 1)
    if stop_mode == "cancel":
        stream.cancel("hardware_stop")
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(handler, 1)
    else:
        await asyncio.wait_for(handler, 1)
    assert cancelled.is_set()
    request.transport.abort.assert_called()
    request.transport.close.assert_not_called()
    assert stream.fault == ("hardware_stop" if stop_mode == "cancel" else "http_write_timeout")
    assert not other.cancelled
    assert await streams.claim(other.id).next_chunk() == b"\x11\x22"


async def test_browser_initial_range_streams_without_seek_or_replay():
    """Chrome sends bytes=0- before native WAV demux; 416 prevents all playback."""
    streams = LiveAudioStreams()
    stream = streams.open("browser")
    async with client_for(streams) as client:
        response = await client.get(path(stream), headers={"Range": "bytes=0-"})
        assert response.status == 200
        assert "Content-Range" not in response.headers
        assert response.headers["Accept-Ranges"] == "none"
        assert await response.content.readexactly(44) == live_wav_header()
        stream.append(b"\x12\x34" * 2400)
        assert await response.content.readexactly(4800) == b"\x12\x34" * 2400
        assert not response.content.at_eof()
        assert not stream.finished
        duplicate = await client.get(path(stream), headers={"Range": "bytes=0-"})
        assert duplicate.status == 409
        stream.finish()
        assert await response.read() == b""
        stale = await client.get(path(stream), headers={"Range": "bytes=0-"})
        assert stale.status == 404


@pytest.mark.parametrize("byte_range", ["bytes=1-", "bytes=-10", "bytes=0-10", "bytes=0-,1-"])
async def test_browser_seek_ranges_never_claim_live_stream(byte_range):
    streams = LiveAudioStreams()
    stream = streams.open("browser")
    async with client_for(streams) as client:
        response = await client.get(path(stream), headers={"Range": byte_range})
        assert response.status == 416
        assert not stream.claimed
