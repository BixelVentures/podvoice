"""Real BrowserLink + Thin Alpha contract; provider and playback edges are simulated."""

import pytest
from test_thin_live import build, until

from gatekeeper.live_audio import LiveAudioError
from gatekeeper.openai_live import LiveAudioChunk
from gatekeeper.talk import BrowserLink


async def test_browser_live_wav_capability_allows_wake_and_stop_then_new_identity():
    wire = []

    async def send_json(event):
        wire.append(event)

    async def send_bytes(data):
        pass

    link = BrowserLink(send_json, send_bytes)
    link.supports_live_webrtc = False  # Historical WAV adapter regression.
    session, sdk, _, _, _ = build(device=link)
    await session.start()
    try:
        await session.wake()
        assert session._active and session.live_alpha
        assert sdk.factory_calls
        old_stream = session._live_stream
        generation = session.brain._connection_generation
        await session._on_live_event(LiveAudioChunk(b"\x01\x00" * 1920, generation))
        await until(lambda: any(e.get("type") == "play" for e in wire))
        play = next(e for e in wire if e.get("type") == "play")
        assert f"/{old_stream.id}.wav" in play["url"]
        link.media_state(True, play["playback_id"])
        await until(lambda: session._device_playing)
        await session.stop()
        assert old_stream.cancelled
        with pytest.raises(LiveAudioError):
            old_stream.append(b"\x01\x00")
        assert any(e.get("type") == "stop_playback" for e in wire)
        await session.wake()
        assert session._active and session.live_alpha
        assert session._live_stream.id != old_stream.id
        # A late old browser callback cannot mark the next stream as playing.
        link.media_state(True, play["playback_id"])
        assert not session._device_playing
    finally:
        await session.aclose()
