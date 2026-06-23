"""GeminiLiveSession.events() resumes seamlessly across go_away / drops (PLAN §5.8).

SDK-free: we drive events() with fake session objects and stub reconnect(), so the
same resilience is proven for BOTH the console and the Voice PE room pipeline.
"""

from __future__ import annotations

from gatekeeper.gemini import GeminiLiveSession
from gatekeeper.voice import AudioChunk, GoAway


class _GoAway:
    def __init__(self, t):
        self.time_left = t


class _Resp:
    def __init__(self, data=None, go_away=None):
        self.data = data
        self.go_away = go_away
        self.tool_call = None
        self.server_content = None
        self.session_resumption_update = None


class _Sess:
    def __init__(self, responses, on_done=None):
        self._responses = responses
        self._on_done = on_done

    async def receive(self):
        for r in self._responses:
            yield r
        if self._on_done:
            self._on_done()


async def test_events_resume_across_go_away():
    s = GeminiLiveSession(api_key="k", model="m", config={})
    sess1 = _Sess([_Resp(go_away=_GoAway(1.0))])  # server says it's going away
    sess2 = _Sess([_Resp(data=b"hi")], on_done=lambda: setattr(s, "_session", None))
    s._session = sess1

    async def fake_reconnect():  # stands in for close()+connect() with the resume handle
        s._session = sess2

    s.reconnect = fake_reconnect  # type: ignore[assignment]

    evs = [ev async for ev in s.events()]
    kinds = [type(e).__name__ for e in evs]

    assert "GoAway" in kinds and "AudioChunk" in kinds
    assert kinds.index("GoAway") < kinds.index("AudioChunk")  # resumed AFTER go_away
    assert any(isinstance(e, AudioChunk) and e.pcm == b"hi" for e in evs)
    assert any(isinstance(e, GoAway) for e in evs)


async def test_events_resume_on_dropped_socket():
    s = GeminiLiveSession(api_key="k", model="m", config={})

    class _Boom:
        async def receive(self):
            raise ConnectionError("socket dropped")
            yield  # pragma: no cover - makes this an async generator

    sess2 = _Sess([_Resp(data=b"back")], on_done=lambda: setattr(s, "_session", None))
    s._session = _Boom()

    async def fake_reconnect():
        s._session = sess2

    s.reconnect = fake_reconnect  # type: ignore[assignment]

    evs = [ev async for ev in s.events()]
    assert any(isinstance(e, AudioChunk) and e.pcm == b"back" for e in evs)  # recovered
