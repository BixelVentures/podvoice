import json
from unittest.mock import Mock

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer, make_mocked_request

from gatekeeper.audio_trace import AudioTraceRecorder
from gatekeeper.hub import StatusHub
from gatekeeper.web import _audio_analysis_start, _audio_analysis_status, create_app


class Service:
    def __init__(self):
        self.calls = []
        self.closed = False

    def start(self, trace_id):
        self.calls.append(trace_id)
        return {"status": "running", "trace_id": trace_id}

    def status(self):
        return {"status": "idle"}

    async def close(self):
        self.closed = True


async def test_authenticated_job_start_status_and_cleanup(tmp_path):
    service = Service()
    app = create_app(
        StatusHub(), {}, audio_analysis=service, audio_trace=AudioTraceRecorder(tmp_path)
    )
    async with TestClient(TestServer(app)) as client:
        response = await client.post("/api/audio-analysis", json={"trace_id": "trace-1"})
        assert response.status == 202
        assert response.headers["Cache-Control"] == "no-store"
        assert (await response.json())["trace_id"] == "trace-1"
        response = await client.get("/api/audio-analysis")
        assert response.status == 200
        assert response.headers["Cache-Control"] == "no-store"
    assert service.calls == ["trace-1"]
    assert service.closed


@pytest.mark.parametrize(
    "method,handler", [("GET", _audio_analysis_status), ("POST", _audio_analysis_start)]
)
async def test_lan_open_panel_does_not_expose_analysis(method, handler, tmp_path):
    service = Service()
    app = create_app(
        StatusHub(),
        {},
        audio_analysis=service,
        audio_trace=AudioTraceRecorder(tmp_path),
        locked=False,
    )
    transport = Mock()
    transport.get_extra_info.side_effect = lambda name, default=None: (
        ("192.168.86.30", 42) if name == "peername" else default
    )
    request = make_mocked_request(
        method,
        "/api/audio-analysis",
        headers={"Content-Type": "application/json", "X-Forwarded-For": "172.30.32.2"},
        app=app,
        transport=transport,
    )
    with pytest.raises(web.HTTPForbidden):
        await handler(request)
    assert not service.calls


@pytest.mark.parametrize(
    "body,content_type,expected",
    [
        ("{}", "application/json", 400),
        ("not json", "application/json", 400),
        (json.dumps({"trace_id": "trace-1"}), "text/plain", 415),
        ("x" * 1025, "application/json", 413),
        (json.dumps({"trace_id": "trace-1", "other": "ignored"}), "application/json", 400),
    ],
)
async def test_bounded_explicit_json_request(tmp_path, body, content_type, expected):
    service = Service()
    app = create_app(
        StatusHub(), {}, audio_analysis=service, audio_trace=AudioTraceRecorder(tmp_path)
    )
    async with TestClient(TestServer(app)) as client:
        response = await client.post(
            "/api/audio-analysis", data=body, headers={"Content-Type": content_type}
        )
        assert response.status == expected
    assert not service.calls


async def test_active_capture_prevents_analysis_start(tmp_path):
    recorder = AudioTraceRecorder(tmp_path)
    recorder.arm("r0")
    recorder.begin("r0")
    service = Service()
    app = create_app(StatusHub(), {}, audio_analysis=service, audio_trace=recorder)
    async with TestClient(TestServer(app)) as client:
        response = await client.post("/api/audio-analysis", json={"trace_id": "trace-1"})
        assert response.status == 409
    assert not service.calls
