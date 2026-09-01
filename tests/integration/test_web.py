"""Integration tests for the Ingress web panel API (aiohttp test client)."""

from __future__ import annotations

import asyncio
import json
import time
from unittest.mock import Mock

import pytest
from aiohttp.test_utils import TestClient, TestServer, make_mocked_request
from multidict import CIMultiDict

from gatekeeper.events import EventType
from gatekeeper.history import History
from gatekeeper.hub import StatusHub
from gatekeeper.web import (
    _capability_details,
    _protocol_owner_eval,
    _protocol_owner_source_allowed,
    create_app,
)


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
        self.stops: list[str] = []

    async def stop(self, reason: str = "stop") -> None:
        self.stops.append(reason)


class _StubTools:
    def capabilities(self) -> dict:
        return {
            "tools": [
                "get_time",
                "GetLiveContext",
                "google_web_sogning",
                "weather_forecast",
                "HassMediaPause",
            ],
            "count": 5,
            "time": True,
            "timers": False,
            "home": True,
            "web_search": True,
            "weather": True,
            "music": True,
            "roles": {
                "time": ["get_time"],
                "timers": [],
                "home": ["GetLiveContext", "HassMediaPause"],
                "web_search": ["google_web_sogning"],
                "weather": ["weather_forecast"],
                "music": ["HassMediaPause"],
            },
            "discovery": {"fetched_at": time.time()},
        }


def _client(hub: StatusHub, sessions: dict) -> TestClient:
    return TestClient(TestServer(create_app(hub, sessions)))


def test_capability_verification_requires_available_exact_current_tool_success():
    now = time.time()
    base = {
        "capabilities": {
            "web_search": True,
            "roles": {"web_search": ["google_web_sogning"]},
            "discovery": {"fetched_at": now - 5},
        },
        "tool_activity": [
            {"name": "google_web_sogning", "ok": True, "empty": False, "ts": now - 2},
            {"name": "google_web_sogning_alias", "ok": True, "empty": False, "ts": now},
        ],
    }
    assert _capability_details(base)["web_search"]["verified"] is True
    base["capabilities"]["discovery"]["fetched_at"] = now + 1
    assert _capability_details(base)["web_search"]["verified"] is False
    base["capabilities"]["web_search"] = False
    assert _capability_details(base)["web_search"]["verified"] is False

    transport_only = {
        "capabilities": {
            "music": False,
            "roles": {
                "music": [],
                "music_playback": [],
                "music_transport": ["HassMediaPause"],
            },
            "discovery": {"fetched_at": now - 5},
        },
        "tool_activity": [{"name": "HassMediaPause", "ok": True, "empty": False, "ts": now - 2}],
    }
    details = _capability_details(transport_only)
    assert details["music"]["available"] is False
    assert details["music"]["verified"] is False


async def test_status_and_health():
    hub = StatusHub()
    hub.set_state("kitchen", "AI_SPEAKING")
    app = create_app(hub, {"kitchen": _StubSession("kitchen")}, tools=_StubTools())
    async with TestClient(TestServer(app)) as client:
        r = await client.get("/api/status")
        assert r.status == 200
        body = await r.json()
        assert body["version"]
        assert "simulate" not in body
        assert body["rooms"][0]["state"] == "AI_SPEAKING"
        assert body["capabilities"]["web_search"] is True
        assert body["capabilities"]["music"] is True
        assert body["capability_details"]["web_search"]["available"] is True
        assert body["capability_details"]["web_search"]["verified"] is False
        assert body["service_details"]["openai"]["reason"]
        assert body["diagnostic_active"] is False

        h = await client.get("/health")
        assert h.status == 200
        health = await h.json()
        assert health["status"] in ("ok", "degraded")
        assert health["version"] == body["version"]
        assert health["capabilities"]["tools"] == body["capabilities"]["tools"]


async def test_status_exposes_same_diagnostic_owner_as_voice_and_talk_readiness():
    app = create_app(StatusHub(), {}, diagnostic_status=lambda: True)
    async with TestClient(TestServer(app)) as client:
        body = await (await client.get("/api/status")).json()
    assert body["diagnostic_active"] is True
    assert "midlertidigt låst" in body["diagnostic_reason"]


async def test_live_eval_endpoint_is_bounded_and_never_handles_a_key():
    calls: list[tuple[str, object]] = []

    async def live_eval(*, action="start", scenario_ids=None, run_id=None):
        calls.append((action, scenario_ids if action == "start" else run_id))
        if action == "start":
            return {"ok": True, "status": "running", "run_id": "eval-test"}
        return {"ok": True, "status": "complete", "run_id": run_id, "results": []}

    app = create_app(StatusHub(), {}, live_eval=live_eval)
    async with TestClient(TestServer(app)) as client:
        response = await client.post(
            "/api/eval/live", json={"scenario_ids": ["arithmetic-followup"]}
        )
        assert response.status == 202
        body = await response.json()
        assert body["run_id"] == "eval-test"
        assert calls == [("start", {"arithmetic-followup"})]
        assert "key" not in json.dumps(body).lower()

        status_response = await client.get("/api/eval/live?run_id=eval-test")
        assert status_response.status == 200
        assert (await status_response.json())["status"] == "complete"
        assert calls[-1] == ("status", "eval-test")

        invalid = await client.post("/api/eval/live", json={"scenario_ids": [1]})
        assert invalid.status == 400
        assert len(calls) == 2


async def test_live_eval_endpoint_forwards_five_bounded_repeats():
    calls: list[dict] = []

    async def live_eval(*, action="start", scenario_ids=None, run_id=None, repeats=1):
        calls.append(
            {
                "action": action,
                "scenario_ids": scenario_ids,
                "run_id": run_id,
                "repeats": repeats,
            }
        )
        return {"ok": True, "status": "running", "run_id": "eval-golden"}

    app = create_app(StatusHub(), {}, live_eval=live_eval)
    async with TestClient(TestServer(app)) as client:
        response = await client.post(
            "/api/eval/live",
            json={"scenario_ids": ["arithmetic-followup-observed"], "repeats": 5},
        )

    assert response.status == 202
    assert calls == [
        {
            "action": "start",
            "scenario_ids": {"arithmetic-followup-observed"},
            "run_id": None,
            "repeats": 5,
        }
    ]


@pytest.mark.parametrize("repeats", [0, 6, True, 1.5, "5"])
async def test_live_eval_endpoint_rejects_invalid_repeats_before_callback(repeats):
    called = False

    async def live_eval(**kwargs):
        nonlocal called
        called = True
        return {"ok": True, "status": "running", "run_id": "must-not-run"}

    app = create_app(StatusHub(), {}, live_eval=live_eval)
    async with TestClient(TestServer(app)) as client:
        response = await client.post("/api/eval/live", json={"repeats": repeats})

    assert response.status == 400
    assert called is False


async def test_live_eval_api_preserves_targeted_truth_separate_from_release_evidence():
    async def live_eval(*, action="start", scenario_ids=None, run_id=None):
        assert action == "start"
        assert scenario_ids == {"low-risk-action-then-close"}
        return {
            "ok": False,
            "status": "complete",
            "run_id": "eval-targeted",
            "selected_ok": True,
            "profile_complete": False,
            "release_preflight_passed": False,
            "semantic_profile_covered": ["low-risk-action-then-close"],
            "results": [],
        }

    app = create_app(StatusHub(), {}, live_eval=live_eval)
    async with TestClient(TestServer(app)) as client:
        response = await client.post(
            "/api/eval/live", json={"scenario_ids": ["low-risk-action-then-close"]}
        )
        assert response.status == 200
        body = await response.json()

    assert body["selected_ok"] is True
    assert body["profile_complete"] is False
    assert body["release_preflight_passed"] is False
    assert body["ok"] is False


async def test_live_eval_api_preserves_failed_full_scope_separate_from_coverage():
    async def live_eval(*, action="start", scenario_ids=None, run_id=None):
        assert action == "start"
        assert scenario_ids is None
        return {
            "ok": False,
            "status": "complete",
            "run_id": "eval-full-failed",
            "selected_ok": False,
            "profile_complete": True,
            "coverage_complete": False,
            "release_preflight_passed": False,
            "results": [],
        }

    app = create_app(StatusHub(), {}, live_eval=live_eval)
    async with TestClient(TestServer(app)) as client:
        response = await client.post("/api/eval/live", json={})
        assert response.status == 200
        body = await response.json()

    assert body["selected_ok"] is False
    assert body["profile_complete"] is True
    assert body["coverage_complete"] is False
    assert body["release_preflight_passed"] is False
    assert body["ok"] is False


async def test_live_eval_endpoint_reports_unavailable_and_busy():
    async with TestClient(TestServer(create_app(StatusHub(), {}))) as client:
        unavailable = await client.post("/api/eval/live", json={})
        assert unavailable.status == 501

    async def busy(*, action="start", scenario_ids=None, run_id=None):
        return {
            "ok": False,
            "status": "busy",
            "run_id": "eval-active",
            "error": "already running",
        }

    async with TestClient(TestServer(create_app(StatusHub(), {}, live_eval=busy))) as client:
        response = await client.post("/api/eval/live", json={})
        assert response.status == 409
        assert (await response.json())["run_id"] == "eval-active"


async def test_live_eval_status_rejects_unknown_or_malformed_run_ids():
    async def live_eval(*, action="start", scenario_ids=None, run_id=None):
        return {"ok": False, "status": "not_found", "run_id": run_id}

    async with TestClient(TestServer(create_app(StatusHub(), {}, live_eval=live_eval))) as client:
        malformed = await client.get("/api/eval/live?run_id=wrong")
        assert malformed.status == 400
        missing = await client.get("/api/eval/live?run_id=eval-missing")
        assert missing.status == 404


async def test_protocol_owner_probe_accepts_only_explicit_fixed_cap_and_filters_report():
    calls: list[dict] = []
    private = "sk-private-provider-value"

    async def live_eval(**kwargs):
        calls.append(kwargs)
        return {
            "ok": True,
            "status": "running",
            "kind": "protocol-owner",
            "run_id": "eval-protocol-123",
            "started_at": 1.25,
            "deadline_s": 30,
            "api_key": private,
            "text": "private transcript",
            "pcm": "private audio",
            "trace": {"private": True},
        }

    app = create_app(StatusHub(), {}, live_eval=live_eval, locked=False)
    async with TestClient(TestServer(app)) as client:
        response = await client.post(
            "/api/eval/protocol-owner",
            data='{"max_cost_usd":5}',
            headers={"Content-Type": "application/json"},
        )
        raw = await response.text()

    assert response.status == 202
    assert json.loads(raw) == {
        "ok": True,
        "status": "running",
        "kind": "protocol-owner",
        "run_id": "eval-protocol-123",
        "started_at": 1.25,
        "deadline_s": 30,
    }
    assert calls == [{"action": "protocol-owner", "max_cost_usd": 5.0}]
    assert private not in raw
    assert "transcript" not in raw
    assert "audio" not in raw
    assert "trace" not in raw


@pytest.mark.parametrize(
    "payload",
    [
        "{}",
        '{"max_cost_usd":4}',
        '{"max_cost_usd":6}',
        '{"max_cost_usd":5.0}',
        '{"max_cost_usd":5e0}',
        '{"max_cost_usd":"5"}',
        '{"max_cost_usd":true}',
        '{"max_cost_usd":null}',
        '{"max_cost_usd":5,"text":"hello"}',
        '{"max_cost_usd":5,"max_cost_usd":5}',
        "[]",
        "not-json",
    ],
)
async def test_protocol_owner_probe_rejects_noncanonical_confirmation_before_service(payload):
    called = False

    async def live_eval(**kwargs):
        nonlocal called
        called = True
        return {"ok": True, "status": "running"}

    app = create_app(StatusHub(), {}, live_eval=live_eval)
    async with TestClient(TestServer(app)) as client:
        response = await client.post(
            "/api/eval/protocol-owner",
            data=payload,
            headers={"Content-Type": "application/json"},
        )

    assert response.status == 400
    assert called is False


async def test_protocol_owner_probe_rejects_wrong_content_type_and_large_body():
    called = False

    async def live_eval(**kwargs):
        nonlocal called
        called = True
        return {"ok": True, "status": "running"}

    app = create_app(StatusHub(), {}, live_eval=live_eval)
    async with TestClient(TestServer(app)) as client:
        wrong_type = await client.post("/api/eval/protocol-owner", data='{"max_cost_usd":5}')
        too_large = await client.post(
            "/api/eval/protocol-owner",
            data='{"max_cost_usd":5}' + (" " * 129),
            headers={"Content-Type": "application/json"},
        )

    assert wrong_type.status == 415
    assert too_large.status == 413
    assert called is False


async def test_protocol_owner_probe_rejects_missing_ambiguous_and_trailing_framing():
    called = False

    async def live_eval(**kwargs):
        nonlocal called
        called = True
        return {"ok": True, "status": "running"}

    transport = Mock()
    transport.get_extra_info.side_effect = lambda name, default=None: (
        ("127.0.0.1", 43210) if name == "peername" else default
    )
    app = create_app(StatusHub(), {}, live_eval=live_eval)
    missing = make_mocked_request(
        "POST",
        "/api/eval/protocol-owner",
        headers={"Content-Type": "application/json"},
        app=app,
        transport=transport,
    )
    ambiguous = make_mocked_request(
        "POST",
        "/api/eval/protocol-owner",
        headers=CIMultiDict(
            [
                ("Content-Type", "application/json"),
                ("Content-Length", "18"),
                ("Content-Length", "18"),
            ]
        ),
        app=app,
        transport=transport,
    )

    class SplitTrailingPayload:
        async def readexactly(self, size):
            assert size == 18
            return b'{"max_cost_usd":5}'

        async def read(self, size=-1):
            assert size == 1
            return b" "

    trailing = make_mocked_request(
        "POST",
        "/api/eval/protocol-owner",
        headers={"Content-Type": "application/json", "Content-Length": "18"},
        app=app,
        transport=transport,
        payload=SplitTrailingPayload(),
    )
    chunked = make_mocked_request(
        "POST",
        "/api/eval/protocol-owner",
        headers={"Content-Type": "application/json", "Transfer-Encoding": "chunked"},
        app=app,
        transport=transport,
    )

    responses = [
        await _protocol_owner_eval(request) for request in (missing, ambiguous, trailing, chunked)
    ]
    assert [response.status for response in responses] == [400, 400, 400, 400]
    assert called is False


async def test_protocol_owner_probe_is_unavailable_without_service():
    app = create_app(StatusHub(), {})
    async with TestClient(TestServer(app)) as client:
        response = await client.post(
            "/api/eval/protocol-owner",
            data='{"max_cost_usd":5}',
            headers={"Content-Type": "application/json"},
        )
        body = await response.json()
    assert response.status == 501
    assert body["status"] == "unavailable"


async def test_protocol_owner_probe_busy_and_failure_never_leak_service_details(caplog):
    private = "sk-do-not-log-this"

    async def busy(**kwargs):
        return {"ok": False, "status": "busy", "error": private, "trace": private}

    async def failed(**kwargs):
        raise RuntimeError(private)

    busy_app = create_app(StatusHub(), {}, live_eval=busy)
    async with TestClient(TestServer(busy_app)) as client:
        busy_response = await client.post(
            "/api/eval/protocol-owner",
            data='{"max_cost_usd":5}',
            headers={"Content-Type": "application/json"},
        )
        busy_text = await busy_response.text()
    failed_app = create_app(StatusHub(), {}, live_eval=failed)
    async with TestClient(TestServer(failed_app)) as client:
        failed_response = await client.post(
            "/api/eval/protocol-owner",
            data='{"max_cost_usd":5}',
            headers={"Content-Type": "application/json"},
        )
        failed_text = await failed_response.text()

    assert busy_response.status == 409
    assert failed_response.status == 502
    assert private not in busy_text
    assert private not in failed_text
    assert private not in caplog.text


async def test_protocol_owner_probe_is_ingress_or_loopback_only_even_when_panel_is_open():
    assert _protocol_owner_source_allowed("127.0.0.1") is True
    assert _protocol_owner_source_allowed("::1") is True
    assert _protocol_owner_source_allowed("172.30.32.2") is True
    assert _protocol_owner_source_allowed("172.30.32.3") is False
    assert _protocol_owner_source_allowed("192.168.86.30") is False
    assert _protocol_owner_source_allowed(None) is False
    assert _protocol_owner_source_allowed("not-an-ip") is False

    called = False

    async def live_eval(**kwargs):
        nonlocal called
        called = True
        return {"ok": True, "status": "running"}

    transport = Mock()
    transport.get_extra_info.side_effect = lambda name, default=None: (
        ("192.168.86.30", 43210) if name == "peername" else default
    )
    app = create_app(StatusHub(), {}, live_eval=live_eval, locked=False)
    request = make_mocked_request(
        "POST",
        "/api/eval/protocol-owner",
        headers={
            "Content-Type": "application/json",
            "X-Forwarded-For": "172.30.32.2",
        },
        app=app,
        transport=transport,
    )
    response = await _protocol_owner_eval(request)

    assert response.status == 403
    assert called is False


async def test_audio_replay_endpoint_uses_only_local_trace_and_known_eval_text():
    calls: list[dict] = []

    class Recorder:
        def snapshot(self):
            return {"latest": {"id": "trace-one", "room": "r0"}}

        def replay_turn(self, trace_id, *, turn_index=0):
            assert trace_id == "trace-one"
            return {
                "trace_id": trace_id,
                "room": "r0",
                "turn_index": turn_index,
                "rate": 24000,
                "pcm": b"\x01\x00" * 24000,
                "duration_ms": 1000,
                "sha256": "a" * 64,
                "diagnostic_transcript": "Hvad er klokken?",
                "exact_sample_offsets": True,
                "source_tool_schema_sha256": "c" * 64,
                "source_model": "gpt-realtime-2.1",
                "source_prompt_source": "default",
                "source_prompt_version": 6,
                "source_prompt_version_present": True,
                "source_prompt_sha256": "d" * 64,
                "source_room_context_sha256": "e" * 64,
                "source_podvoice_version": "1.13.51",
                "source_artifact_identity_kind": "rootfs-v1",
                "source_artifact_sha256": "f" * 64,
                "source_turn_preset": "responsive",
                "source_openai_noise": "off",
            }

    async def live_eval(**kwargs):
        calls.append(kwargs)
        return {
            "ok": True,
            "status": "running",
            "kind": "audio-replay",
            "run_id": "eval-replay",
        }

    brain = type("Brain", (), {"room_context": "Det præcise fysiske rum"})()
    session = type("Session", (), {"brain": brain})()
    app = create_app(
        StatusHub(),
        {"r0": session},
        live_eval=live_eval,
        audio_trace=Recorder(),
    )
    async with TestClient(TestServer(app)) as client:
        response = await client.post("/api/eval/replay", json={"repeats": 3})
        assert response.status == 202
        body = await response.json()
        assert body["kind"] == "audio-replay"
        assert calls[0]["action"] == "replay"
        assert calls[0]["scenario"].id == "time-followup"
        assert calls[0]["turn_index"] == 0
        assert calls[0]["repeats"] == 3
        assert calls[0]["fixture"].room_context == "Det præcise fysiske rum"
        assert calls[0]["fixture"].source_tool_schema_sha256 == "c" * 64
        assert calls[0]["fixture"].source_model == "gpt-realtime-2.1"
        assert calls[0]["fixture"].source_prompt_source == "default"
        assert calls[0]["fixture"].source_prompt_version == 6
        assert calls[0]["fixture"].source_prompt_version_present is True
        assert calls[0]["fixture"].source_prompt_sha256 == "d" * 64
        assert calls[0]["fixture"].source_room_context_sha256 == "e" * 64
        assert calls[0]["fixture"].source_turn_preset == "responsive"
        assert calls[0]["fixture"].source_openai_noise == "off"


async def test_numeric_followup_ab_endpoint_forwards_exact_symmetric_gate():
    calls: list[dict] = []

    class Recorder:
        def snapshot(self):
            return {"latest": {"id": "trace-followup", "room": "r0"}}

        def replay_turn(self, trace_id, *, turn_index=0):
            assert trace_id == "trace-followup"
            assert turn_index == 1
            return {
                "trace_id": trace_id,
                "room": "r0",
                "turn_index": turn_index,
                "rate": 24_000,
                "pcm": b"\x02\x00" * 24_000,
                "duration_ms": 1_000,
                "sha256": "b" * 64,
                "diagnostic_transcript": "Læg seks til.",
                "exact_sample_offsets": True,
                "source_tool_schema_sha256": "c" * 64,
                "source_model": "gpt-realtime-2.1",
                "source_prompt_source": "default",
                "source_prompt_version": 6,
                "source_prompt_version_present": True,
                "source_prompt_sha256": "d" * 64,
                "source_room_context_sha256": "e" * 64,
                "source_podvoice_version": "1.13.51",
                "source_artifact_identity_kind": "rootfs-v1",
                "source_artifact_sha256": "f" * 64,
                "source_turn_preset": "responsive",
                "source_openai_noise": "off",
            }

    async def live_eval(**kwargs):
        calls.append(kwargs)
        return {
            "ok": True,
            "status": "running",
            "kind": "semantic-audio-ab",
            "run_id": "eval-ab",
        }

    app = create_app(StatusHub(), {}, live_eval=live_eval, audio_trace=Recorder())
    async with TestClient(TestServer(app)) as client:
        response = await client.post(
            "/api/eval/replay",
            json={
                "mode": "numeric-followup-ab",
                "turn_index": 1,
                "repeats": 5,
                "text_repeats": 5,
            },
        )

    assert response.status == 202
    assert calls[0]["mode"] == "numeric-followup-ab"
    assert calls[0]["scenario"].id == "arithmetic-followup-observed"
    assert calls[0]["turn_index"] == 1
    assert calls[0]["repeats"] == 5
    assert calls[0]["text_repeats"] == 5
    assert calls[0]["fixture"].source_podvoice_version == "1.13.51"
    assert calls[0]["fixture"].source_artifact_identity_kind == "rootfs-v1"
    assert calls[0]["fixture"].source_artifact_sha256 == "f" * 64
    assert calls[0]["fixture"].source_turn_preset == "responsive"
    assert calls[0]["fixture"].source_openai_noise == "off"


@pytest.mark.parametrize("text_repeats", [0, 6, True, 1.5, "5"])
async def test_audio_replay_endpoint_rejects_invalid_text_repeat_count(text_repeats):
    class ForbiddenRecorder:
        def snapshot(self):
            raise AssertionError("invalid request must not read a trace")

    async def live_eval(**kwargs):
        raise AssertionError("invalid request must not reach eval")

    app = create_app(
        StatusHub(),
        {},
        live_eval=live_eval,
        audio_trace=ForbiddenRecorder(),
    )
    async with TestClient(TestServer(app)) as client:
        response = await client.post(
            "/api/eval/replay",
            json={"repeats": 1, "text_repeats": text_repeats},
        )

    assert response.status == 400


@pytest.mark.parametrize(
    "payload",
    [
        {"mode": "numeric-followup-ab", "turn_index": 0, "repeats": 5, "text_repeats": 5},
        {"mode": "numeric-followup-ab", "turn_index": 1, "repeats": 4, "text_repeats": 5},
        {"mode": "numeric-followup-ab", "turn_index": 1, "repeats": 5, "text_repeats": 4},
    ],
)
async def test_numeric_followup_ab_endpoint_rejects_noncanonical_shape(payload):
    class Recorder:
        def snapshot(self):
            return {"latest": {"id": "trace-followup", "room": "r0"}}

        def replay_turn(self, trace_id, *, turn_index=0):
            transcript = "Læg seks til." if turn_index == 1 else "Hvad er tolv gange syv?"
            return {
                "trace_id": trace_id,
                "room": "r0",
                "turn_index": turn_index,
                "rate": 24_000,
                "pcm": b"\x02\x00" * 24_000,
                "duration_ms": 1_000,
                "sha256": "b" * 64,
                "diagnostic_transcript": transcript,
                "exact_sample_offsets": True,
            }

    async def live_eval(**kwargs):
        raise AssertionError("noncanonical A/B must not reach eval")

    app = create_app(StatusHub(), {}, live_eval=live_eval, audio_trace=Recorder())
    async with TestClient(TestServer(app)) as client:
        response = await client.post("/api/eval/replay", json=payload)

    assert response.status == 400


async def test_audio_replay_endpoint_rejects_unknown_transcript_without_provider_call():
    class Recorder:
        def snapshot(self):
            return {"latest": {"id": "trace-unknown", "room": "r0"}}

        def replay_turn(self, trace_id, *, turn_index=0):
            return {
                "trace_id": trace_id,
                "room": "r0",
                "turn_index": turn_index,
                "rate": 24000,
                "pcm": b"\x00\x00" * 24000,
                "duration_ms": 1000,
                "sha256": "b" * 64,
                "diagnostic_transcript": "En ukendt testytring",
                "exact_sample_offsets": True,
            }

    async def live_eval(**kwargs):
        raise AssertionError("unknown traces must not reach the provider")

    app = create_app(StatusHub(), {}, live_eval=live_eval, audio_trace=Recorder())
    async with TestClient(TestServer(app)) as client:
        response = await client.post("/api/eval/replay", json={})
        assert response.status == 409
        assert "kendt sikker eval-ytring" in (await response.json())["error"]


async def test_acceptance_report_is_conservative(tmp_path):
    hub = StatusHub()
    hub.set_service("openai", "up")
    hub.set_service("voicepe", "up")
    hub.set_service("podconnect", "up")
    hub.set_service("mcp", "up")
    hub.register_room("kitchen")
    hub.set_connected("kitchen", True)
    hub.set_state("kitchen", "LISTENING")
    hub.set_state("kitchen", "THINKING")
    hub.set_state("kitchen", "AI_SPEAKING")
    hub.set_state("kitchen", "LOUNGE_WINDOW", turn_cue=True)
    hub.set_state("kitchen", "IDLE")
    hub.set_latency("kitchen", 1234)
    hub.incr("tool_calls")
    hub.incr("tool_ok")
    hub.tool_call("kitchen", "light_turn_on", {"ok": True})
    hub.tool_call("kitchen", "google_web_sogning", {"ok": True}, {"query": "AGF næste kamp"})
    hub.tool_call("kitchen", "weather_forecast", {"ok": True}, {"location": "hjemme"})
    hub.tool_call("kitchen", "HassMediaPause", {"ok": True})
    hist = History(path=tmp_path / "history.jsonl")
    hist.append("kitchen", "in", "Hvad er klokken?", ts=1)
    hist.append("kitchen", "out", "Klokken er otte.", ts=2)
    hist.append("kitchen", "in", "Hvor spiller AGF?", ts=3)
    hist.append("kitchen", "out", "Det tjekker jeg.", ts=4)
    app = create_app(hub, {"kitchen": _StubSession("kitchen")}, tools=_StubTools(), history=hist)
    async with TestClient(TestServer(app)) as client:
        r = await client.get("/api/acceptance")
        body = await r.json()
    assert body["status"] == "evidence-present"
    assert body["does_not_replace_physical_matrix"] is True
    assert "fysiske oplevelse" in body["next_action"]
    assert all(c["ok"] for c in body["checks"])
    by_key = {c["key"]: c for c in body["checks"]}
    assert "turn_cue=ja" in by_key["turntaking_states"]["detail"]
    assert [t["name"] for t in body["tool_activity"]] == [
        "light_turn_on",
        "google_web_sogning",
        "weather_forecast",
        "HassMediaPause",
    ]
    assert body["latest_voice_conversation"]["room"] == "kitchen"


async def test_stuetest_start_makes_acceptance_ignore_old_evidence(tmp_path):
    hub = StatusHub()
    hub.set_service("openai", "up")
    hub.set_service("voicepe", "up")
    hub.set_service("podconnect", "up")
    hub.set_service("mcp", "up")
    hub.register_room("kitchen")
    hub.set_connected("kitchen", True)
    hub.set_state("kitchen", "LISTENING")
    hub.set_state("kitchen", "AI_SPEAKING")
    hub.set_state("kitchen", "IDLE")
    hub.set_latency("kitchen", 1234)
    hub.incr("tool_calls")
    hub.incr("tool_ok")
    hist = History(path=tmp_path / "history.jsonl")
    hist.append("kitchen", "in", "Hvad er klokken?", ts=1)
    hist.append("kitchen", "out", "Klokken er otte.", ts=2)
    hist.append("kitchen", "in", "Hvor spiller AGF?", ts=3)
    hist.append("kitchen", "out", "Det tjekker jeg.", ts=4)
    app = create_app(hub, {"kitchen": _StubSession("kitchen")}, tools=_StubTools(), history=hist)
    async with TestClient(TestServer(app)) as client:
        r = await client.post("/api/stuetest/start")
        start = await r.json()
        assert start["ok"] is True

        r = await client.get("/api/acceptance")
        body = await r.json()

    assert body["status"] == "missing-evidence"
    assert body["started_at"] == start["started_at"]
    assert body["next_action"].startswith("Næste:")
    by_key = {c["key"]: c for c in body["checks"]}
    assert by_key["tool_calls"]["ok"] is False  # old metrics are below the baseline
    assert by_key["voice_history"]["ok"] is False  # old persisted history is ignored
    assert by_key["latency"]["ok"] is False  # old room latency is ignored too
    assert by_key["turntaking_states"]["ok"] is False  # old state transitions are ignored
    assert body["metrics"]["tool_calls"] == 0


async def test_stuetest_endpoint_exposes_the_physical_matrix():
    async with TestClient(TestServer(create_app(StatusHub(), {}))) as client:
        r = await client.get("/api/stuetest")
        body = await r.json()
    assert r.status == 200
    assert "Fysisk stuetest" in body["title"]
    keys = [s["key"] for s in body["steps"]]
    assert keys == ["turntaking", "web", "weather", "followup", "home", "music"]
    assert "stop" not in keys
    assert any("Okay Nabu" in s["say"] for s in body["steps"])
    assert any("AGF" in s["say"] for s in body["steps"])
    assert any(s["evidence"] == ["music_tool_call"] for s in body["steps"])


async def test_groundtest_guides_ten_uninterrupted_conversations_and_captures_evidence(
    tmp_path,
):
    hub = StatusHub()
    hist = History(path=tmp_path / "history.jsonl")
    session = _StubSession("kitchen")
    app = create_app(hub, {"kitchen": session}, tools=_StubTools(), history=hist)
    async with TestClient(TestServer(app)) as client:
        response = await client.get("/api/groundtest")
        initial = await response.json()
        assert len(initial["steps"]) == 20
        assert len(initial["cases"]) == 10
        assert initial["steps"][0]["say"] == "Okay Nabu, hvad er klokken?"
        assert initial["steps"][1].get("new") is not True
        assert initial["cases"][0]["followup"] == "Og hvilken ugedag er det?"
        assert initial["run"]["started_at"] is None

        response = await client.post("/api/groundtest/start")
        started = await response.json()
        assert started["ok"] is True
        assert started["run"]["current_index"] == 0

        now = time.time()
        hist.append("kitchen", "in", "Hvad er klokken?", ts=now)
        hist.append("kitchen", "out", "Klokken er tre.", ts=now + 0.1)
        hist.append("kitchen", "in", "Og hvilken ugedag er det?", ts=now + 0.2)
        hist.append("kitchen", "out", "Det er onsdag.", ts=now + 0.3)
        hist.append("kitchen", "in", "Farvel.", ts=now + 0.4)
        hist.append("kitchen", "out", "Farvel.", ts=now + 0.5)
        hub.set_state("kitchen", "LISTENING")
        hub.set_state("kitchen", "IDLE")
        hub.tool_call(
            "kitchen",
            "get_time",
            {"ok": True, "summary": "Klokken er tre.", "data": {"time": "15:00"}},
        )
        hub.set_latency("kitchen", 1234)
        hub.set_latency("kitchen", 1456)

        response = await client.post(
            "/api/groundtest/result", json={"index": 0, "outcome": "correct"}
        )
        rated = await response.json()

    assert response.status == 200
    assert rated["run"]["current_index"] == 1
    result = rated["run"]["results"][0]
    assert result["inputs"] == ["Hvad er klokken?", "Og hvilken ugedag er det?", "Farvel."]
    assert result["outputs"] == ["Klokken er tre.", "Det er onsdag.", "Farvel."]
    assert result["says"] == [
        "Okay Nabu, hvad er klokken?",
        "Og hvilken ugedag er det?",
        "Farvel.",
    ]
    assert result["latency_ms"] == 1456
    assert result["latencies_ms"] == [1234, 1456]
    assert result["closed_room"] == "kitchen"
    assert session.stops == ["groundtest-verdict"]
    assert result["tools"][0]["args"] == {}
    assert result["tools"][0]["result"]["data"]["time"] == "15:00"
    assert rated["summary"]["counts"]["correct"] == 1


async def test_groundtest_rejects_skipping_the_active_conversation():
    hub = StatusHub()
    async with TestClient(TestServer(create_app(hub, {}))) as client:
        await client.post("/api/groundtest/start")
        response = await client.post(
            "/api/groundtest/result", json={"index": 2, "outcome": "correct"}
        )
        body = await response.json()
    assert response.status == 409
    assert "aktive testsamtale" in body["error"]


async def test_groundtest_cannot_mark_a_half_finished_pair_correct(tmp_path):
    hub = StatusHub()
    hist = History(path=tmp_path / "history.jsonl")
    async with TestClient(TestServer(create_app(hub, {}, history=hist))) as client:
        await client.post("/api/groundtest/start")
        now = time.time()
        hist.append("kitchen", "in", "Hvad er klokken?", ts=now)
        hist.append("kitchen", "out", "Klokken er tre.", ts=now + 0.1)
        response = await client.post(
            "/api/groundtest/result", json={"index": 0, "outcome": "correct"}
        )
        body = await response.json()

    assert response.status == 409
    assert "du har sagt farvel" in body["error"]


async def test_audio_trace_can_be_armed_only_for_a_real_room(tmp_path):
    from gatekeeper.audio_trace import AudioTraceRecorder

    recorder = AudioTraceRecorder(tmp_path)
    app = create_app(StatusHub(), {"r0": _StubSession("r0")}, audio_trace=recorder)
    async with TestClient(TestServer(app)) as client:
        response = await client.post("/api/audio-trace/arm", json={"room": "missing"})
        assert response.status == 400

        response = await client.post("/api/audio-trace/arm", json={"room": "r0"})
        body = await response.json()
        assert response.status == 200
        assert body["armed_room"] == "r0"

        response = await client.get("/api/audio-trace")
        assert (await response.json())["armed_room"] == "r0"

        response = await client.post("/api/audio-trace/cancel")
        assert (await response.json())["armed_room"] is None


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
