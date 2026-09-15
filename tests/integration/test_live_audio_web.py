import asyncio

import pytest
from aiohttp import ClientPayloadError
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
    request.transport.close.assert_called()
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
