"""Integration tests for the Ingress web panel API (aiohttp test client)."""

from __future__ import annotations

import asyncio
import json

from aiohttp.test_utils import TestClient, TestServer

from gatekeeper.events import EventType
from gatekeeper.hub import StatusHub
from gatekeeper.web import create_app


class _StubSM:
    def __init__(self) -> None:
        self.posted: list = []

    async def post(self, ev) -> None:
        self.posted.append(ev)


class _StubPlayback:
    def __init__(self) -> None:
        self.tones = 0

    async def play_tone(self, pcm: bytes) -> None:
        self.tones += 1


class _StubSession:
    def __init__(self, room: str) -> None:
        self.room = room
        self.sm = _StubSM()
        self.playback = _StubPlayback()


def _client(hub: StatusHub, sessions: dict) -> TestClient:
    return TestClient(TestServer(create_app(hub, sessions)))


async def test_status_and_health():
    hub = StatusHub(simulate=True)
    hub.set_state("kitchen", "AI_SPEAKING")
    async with _client(hub, {"kitchen": _StubSession("kitchen")}) as client:
        r = await client.get("/api/status")
        assert r.status == 200
        body = await r.json()
        assert body["simulate"] is True
        assert body["rooms"][0]["state"] == "AI_SPEAKING"

        h = await client.get("/health")
        assert h.status == 200
        assert (await h.json())["status"] in ("ok", "degraded")


async def test_models_endpoint():
    payload = {
        "default": "gemini-2.5-flash-native-audio-preview-12-2025",
        "source": "static",
        "models": [
            {
                "id": "gemini-2.5-flash-native-audio-preview-12-2025",
                "label": "2.5 native audio",
                "live": True,
            },
            {"id": "gemini-3.5-flash", "label": "3.5 Flash", "live": False},
        ],
    }
    app = create_app(StatusHub(), {}, models_provider=lambda provider=None: payload)
    async with TestClient(TestServer(app)) as client:
        r = await client.get("/api/models")
        body = await r.json()
        assert body["default"].startswith("gemini-2.5-flash-native-audio")
        live = [m for m in body["models"] if m["live"]]
        assert any(m["id"] == "gemini-3.5-flash" and not m["live"] for m in body["models"])
        assert live and live[0]["live"] is True


async def test_models_endpoint_absent_provider():
    async with TestClient(TestServer(create_app(StatusHub(), {}))) as client:
        r = await client.get("/api/models")
        assert (await r.json())["models"] == []


async def test_control_actions():
    hub = StatusHub()
    stub = _StubSession("kitchen")
    async with _client(hub, {"kitchen": stub}) as client:
        r = await client.post("/api/control", json={"room": "kitchen", "action": "listen"})
        assert (await r.json())["ok"] is True
        assert stub.sm.posted[-1].type is EventType.WAKE_WORD

        r = await client.post("/api/control", json={"room": "kitchen", "action": "stop"})
        assert (await r.json())["ok"] is True
        assert stub.sm.posted[-1].type is EventType.CLOSURE_TOKEN

        r = await client.post("/api/control", json={"room": "kitchen", "action": "test_tone"})
        assert (await r.json())["ok"] is True
        assert stub.playback.tones == 1

        r = await client.post("/api/control", json={"room": "nope", "action": "listen"})
        assert r.status == 404

        r = await client.post("/api/control", json={"room": "kitchen", "action": "bogus"})
        assert r.status == 400


async def test_settings_get_set_and_restart():
    store = {"provider": "gemini", "duck_level": 5}

    def get_settings():
        return dict(store)

    def set_settings(body):
        store.update(body)
        return dict(store)

    async def on_restart():
        return True

    app = create_app(
        StatusHub(), {}, settings_get=get_settings, settings_set=set_settings, on_restart=on_restart
    )
    async with TestClient(TestServer(app)) as client:
        r = await client.get("/api/settings")
        assert (await r.json())["provider"] == "gemini"

        r = await client.post("/api/settings", json={"provider": "openai", "duck_level": 9})
        body = await r.json()
        assert body["ok"] is True and body["settings"]["provider"] == "openai"
        assert store["duck_level"] == 9

        r = await client.post("/api/restart", json={})
        assert (await r.json())["ok"] is True


async def test_restart_unavailable_without_handler():
    async with TestClient(TestServer(create_app(StatusHub(), {}))) as client:
        r = await client.post("/api/restart", json={})
        assert r.status == 501


async def test_voicepe_diag_endpoints():
    async def status(room=None):
        return {"ok": True, "name": "VP", "room": room}

    async def s1(room=None):
        return {"ok": True, "verdict": "pass", "continuity_pct": 99.0}

    async def s2(room=None):
        return {"ok": True, "verdict": "played"}

    app = create_app(StatusHub(), {}, diag={"status": status, "s1": s1, "s2": s2})
    async with TestClient(TestServer(app)) as client:
        assert (await (await client.get("/api/voicepe/status")).json())["name"] == "VP"
        assert (await (await client.post("/api/voicepe/s1")).json())["verdict"] == "pass"
        assert (await (await client.post("/api/voicepe/s2")).json())["verdict"] == "played"


async def test_voicepe_diag_unavailable():
    async with TestClient(TestServer(create_app(StatusHub(), {}))) as client:
        r = await client.get("/api/voicepe/status")
        assert r.status == 501


async def test_locked_panel_blocks_non_ingress_sources():
    """When locked, panel/API routes 403 for LAN peers; /health stays open. The test
    client connects from 127.0.0.1 (trusted), so the pure source check carries the
    LAN-blocking assertion."""
    from gatekeeper.web import source_allowed

    # the pure gate: ingress + loopback yes, LAN no
    assert source_allowed("127.0.0.1") is True
    assert source_allowed("::1") is True
    assert source_allowed("172.30.32.2") is True  # HA ingress proxy
    assert source_allowed("192.168.86.30") is False  # random wifi client
    assert source_allowed(None) is False
    assert source_allowed("not-an-ip") is False

    # locked app still serves loopback (the test client) and /health
    app = create_app(StatusHub(), {}, locked=True)
    async with TestClient(TestServer(app)) as client:
        assert (await client.get("/api/status")).status == 200
        assert (await client.get("/health")).status == 200


async def test_reply_requires_token():
    from gatekeeper.reply import ReplyBus

    bus = ReplyBus()
    bus.start("kitchen")
    bus.push("kitchen", b"\x00\x01" * 1200)
    bus.end("kitchen")
    app = create_app(StatusHub(), {}, reply_bus=bus, reply_token="sekret", locked=True)
    async with TestClient(TestServer(app)) as client:
        r = await client.get("/reply/kitchen.flac")
        assert r.status == 403  # no token -> blocked (even from loopback)
        r = await client.get("/reply/kitchen.flac?t=wrong")
        assert r.status == 403
        r = await client.get("/reply/kitchen.flac?t=sekret")
        assert r.status == 200
        assert r.headers["Content-Type"] in ("audio/flac", "audio/wav")
        assert bus.fetch_count("kitchen") == 1  # only the authorized fetch counts


async def test_reply_streaming_mode_serves_chunked_flac():
    """With reply_streaming on, /reply streams a live-encoded FLAC (no Content-Length)."""
    import shutil

    import pytest

    if shutil.which("flac") is None:
        pytest.skip("flac CLI not installed")
    from gatekeeper.reply import ReplyBus

    bus = ReplyBus()
    bus.start("kitchen")
    bus.push("kitchen", b"\x00\x01" * 2400)
    bus.end("kitchen")
    app = create_app(StatusHub(), {}, reply_bus=bus, settings_get=lambda: {"reply_streaming": True})
    async with TestClient(TestServer(app)) as client:
        r = await client.get("/reply/kitchen.flac")
        assert r.status == 200
        assert r.headers["Content-Type"] == "audio/flac"
        body = await r.read()
        assert body.startswith(b"fLaC")  # a real FLAC stream, encoded live


async def test_sse_stream_delivers_events():
    hub = StatusHub()
    async with _client(hub, {}) as client:
        resp = await client.get("/api/events")
        assert resp.status == 200

        async def _read_state() -> dict:
            while True:
                line = await resp.content.readline()
                if line.startswith(b"data:"):
                    ev = json.loads(line[len(b"data:") :].strip())
                    if ev.get("type") == "state":
                        return ev

        hub.set_state("kitchen", "LISTENING")
        ev = await asyncio.wait_for(_read_state(), timeout=2)
        assert ev["state"] == "LISTENING"
        resp.close()
