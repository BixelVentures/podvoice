"""Integration tests for the Ingress web panel API (aiohttp test client)."""

from __future__ import annotations

import asyncio
import copy
import json
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import pytest
from aiohttp.test_utils import TestClient, TestServer, make_mocked_request
from multidict import CIMultiDict

from gatekeeper.audio_trace import AudioTraceRecorder
from gatekeeper.events import EventType
from gatekeeper.history import History
from gatekeeper.hub import StatusHub
from gatekeeper.web import (
    _capability_details,
    _groundtest_payload,
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
        self.stop_hook: Callable[[str], None] | None = None
        self.idle_timeout_s = 4.0
        self.speaker_path = "announce"
        self._active = False
        self.brain = type(
            "StubBrain",
            (),
            {
                "model": "gpt-realtime-test",
                "preset": "semantic",
                "noise": "near_field",
                "instructions": "test prompt",
                "room_context": "test room",
            },
        )()
        self.voicepe = type(
            "StubVoicePE",
            (),
            {
                "firmware_build": "podvoice_build_test",
                "contract": {"ok": True},
                "_connection_generation": 7,
            },
        )()

    async def stop(self, reason: str = "stop") -> None:
        self.stops.append(reason)
        self._active = False
        if self.stop_hook is not None:
            self.stop_hook(reason)


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


def _groundtest_recorder(tmp_path: Path) -> AudioTraceRecorder:
    """A real bounded recorder, retaining the complete ten-cycle test run."""

    return AudioTraceRecorder(tmp_path / "groundtest-traces", max_seconds=60, keep=12)


def _groundtest_event(
    recorder: AudioTraceRecorder,
    *,
    at_ms: int,
    event_name: str,
    session_id: str,
    provider_generation: int,
    **details: Any,
) -> None:
    recorder.event(
        event_name,
        at_ms=at_ms,
        session_id=session_id,
        provider_generation=provider_generation,
        **details,
    )


def _emit_owned_groundtest_turn(
    recorder: AudioTraceRecorder,
    *,
    session_id: str,
    generation: int,
    number: int,
    start_ms: int,
    audio_generation: int,
    provider_offset: int,
    input_text: str,
    output_text: str | None,
    tool_name: str | None = None,
) -> int:
    """Emit one complete local -> provider -> playback ownership chain."""

    event = lambda at_ms, event_name, **details: _groundtest_event(  # noqa: E731
        recorder,
        at_ms=at_ms,
        event_name=event_name,
        session_id=session_id,
        provider_generation=generation,
        **details,
    )
    turn_id = f"{session_id}:turn-{number}"
    item_id = f"{session_id}:user-{number}"
    request_id = f"{session_id}:request-{number}"
    response_id = f"{session_id}:response-{number}"
    event(
        start_ms,
        "speech_started_or_interrupted",
        item_id=item_id,
        turn_id=turn_id,
        audio_generation=audio_generation,
        provider_sample_offset=provider_offset - 4000,
    )
    event(
        start_ms + 400,
        "speech_stopped",
        accepted=True,
        item_id=item_id,
        turn_id=turn_id,
        audio_generation=audio_generation,
        provider_sample_offset=provider_offset,
    )
    event(
        start_ms + 401,
        "mic_gate_closed",
        state="THINKING",
        turn_id=turn_id,
        audio_generation=audio_generation,
        provider_sample_offset=provider_offset,
    )
    event(
        start_ms + 402,
        "audio_boundary_cut",
        reason="speech-stopped",
        turn_id=turn_id,
        audio_generation=audio_generation + 1,
        provider_sample_offset=provider_offset,
    )
    event(
        start_ms + 420,
        "provider_input_audio_buffer_committed",
        item_id=item_id,
        generation=generation,
    )
    event(
        start_ms + 421,
        "provider_conversation_item_added",
        item_id=item_id,
        item_type="message",
        role="user",
        generation=generation,
    )
    event(
        start_ms + 422,
        "provider_accepted_input_turn",
        root_item_id=item_id,
        committed_item_id=item_id,
        turn_id=turn_id,
        generation=generation,
    )
    event(start_ms + 423, "transcript_complete", direction="in", text=input_text)
    event(
        start_ms + 430,
        "provider_response_create_sent",
        request_id=request_id,
        root_item_id=item_id,
        turn_id=turn_id,
        purpose="turn",
        generation=generation,
    )
    event(
        start_ms + 431,
        "provider_response_created",
        response_id=response_id,
        request_id=request_id,
        request_id_matched=True,
        root_item_id=item_id,
        turn_id=turn_id,
        purpose="turn",
        generation=generation,
    )

    audible_response_id = response_id
    if tool_name:
        event(
            start_ms + 450,
            "provider_response_done",
            response_id=response_id,
            status="completed",
            turn_id=turn_id,
            generation=generation,
        )
        call_id = f"{session_id}:call-{number}"
        event(
            start_ms + 451,
            "tool_call",
            name=tool_name,
            call_id=call_id,
            response_id=response_id,
            turn_id=turn_id,
            generation=generation,
        )
        if output_text is not None:
            result_request = f"{request_id}:tool"
            audible_response_id = f"{response_id}:tool"
            event(
                start_ms + 460,
                "provider_response_create_sent",
                request_id=result_request,
                root_item_id=item_id,
                turn_id=turn_id,
                purpose="tool-result",
                source_call_id=call_id,
                generation=generation,
            )
            event(
                start_ms + 461,
                "provider_response_created",
                response_id=audible_response_id,
                request_id=result_request,
                request_id_matched=True,
                root_item_id=item_id,
                turn_id=turn_id,
                purpose="tool-result",
                generation=generation,
            )

    if output_text is None:
        if not tool_name:
            event(
                start_ms + 470,
                "provider_response_done",
                response_id=response_id,
                status="completed",
                turn_id=turn_id,
                generation=generation,
            )
        return start_ms + 480

    event(
        start_ms + 470,
        "response_audio_started",
        response_id=audible_response_id,
        turn_id=turn_id,
        generation=generation,
    )
    event(start_ms + 520, "transcript_complete", direction="out", text=output_text)
    event(
        start_ms + 530,
        "provider_response_done",
        response_id=audible_response_id,
        status="completed",
        turn_id=turn_id,
        generation=generation,
    )
    playback_id = f"{session_id}:playback-{number}"
    event(
        start_ms + 600,
        "playback_started",
        playback_id=playback_id,
        turn_id=turn_id,
    )
    event(
        start_ms + 900,
        "playback_finished",
        playback_id=playback_id,
        turn_id=turn_id,
    )
    return start_ms + 900


def _emit_groundtest_trace(
    recorder: AudioTraceRecorder,
    *,
    room: str,
    session_id: str,
    generation: int,
    close_mode: str,
    provenance: dict[str, Any],
    silent_semantic_close: bool = False,
    prove_previous: bool = True,
) -> str:
    """Create the same complete manifest produced by one physical Voice PE cycle."""

    previous_manifest = recorder.snapshot().get("latest") or {}
    previous_rearms = [
        event
        for event in previous_manifest.get("events") or []
        if event.get("event") == "wake_rearm_recovered"
    ]
    previous_rearm = previous_rearms[-1] if previous_rearms else {}
    audio_base = int(previous_rearm.get("audio_generation") or 0)
    previous_token = previous_rearm.get("rearm_token")
    rearm_token = int(previous_token) + 1 if isinstance(previous_token, int) else 101
    attempt_id = f"physical-attempt-{generation}"
    if prove_previous:
        recorder.note_next_wake(room, attempt_id)
        recorder.prove_next_session(
            room,
            attempt_id,
            session_id,
            provider_generation=generation,
            previous_provider_generation=generation - 1,
        )
    trace_metadata = {
        **provenance,
        "wake_source": "physical_wake_callback",
        "wake_attempt_id": attempt_id,
    }
    assert recorder.begin(room, trace_metadata) is True
    # A strict physical result must contain actual bytes on all three observed seams.
    recorder.audio("device", b"\x01\x00" * 1600, 16_000)
    recorder.audio("provider", b"\x02\x00" * 2400, 24_000)
    recorder.audio("speaker", b"\x03\x00" * 2400, 24_000)

    event = lambda at_ms, event_name, **details: _groundtest_event(  # noqa: E731
        recorder,
        at_ms=at_ms,
        event_name=event_name,
        session_id=session_id,
        provider_generation=generation,
        **details,
    )
    event(
        1,
        "wake_received",
        source="physical_wake_callback",
        wake_attempt_id=attempt_id,
        audio_generation=audio_base,
    )
    event(
        2,
        "mic_gate_opened",
        reason="wake",
        state="LISTENING",
        audio_generation=audio_base,
        provider_sample_offset=0,
    )
    event(100, "provider_contract", tool_schema_sha256="schema-stable")
    event(200, "provider_connected")

    first_end = _emit_owned_groundtest_turn(
        recorder,
        session_id=session_id,
        generation=generation,
        number=1,
        start_ms=500,
        audio_generation=audio_base,
        provider_offset=8000,
        input_text="Hvad er klokken?",
        output_text="Klokken er tre.",
        tool_name="get_time",
    )
    event(
        first_end + 100,
        "audio_boundary_cut",
        reason="followup-open",
        audio_generation=audio_base + 2,
        provider_sample_offset=8000,
    )
    event(
        first_end + 101,
        "mic_gate_opened",
        reason="followup",
        state="LOUNGE_WINDOW",
        audio_generation=audio_base + 2,
        provider_sample_offset=8000,
    )
    second_end = _emit_owned_groundtest_turn(
        recorder,
        session_id=session_id,
        generation=generation,
        number=2,
        start_ms=first_end + 400,
        audio_generation=audio_base + 2,
        provider_offset=16_000,
        input_text="Og hvilken ugedag er det?",
        output_text="Det er onsdag.",
    )
    event(
        second_end + 100,
        "audio_boundary_cut",
        reason="followup-open",
        audio_generation=audio_base + 4,
        provider_sample_offset=16_000,
    )
    followup_open_ms = second_end + 101
    event(
        followup_open_ms,
        "mic_gate_opened",
        reason="followup",
        state="LOUNGE_WINDOW",
        audio_generation=audio_base + 4,
        provider_sample_offset=16_000,
    )

    if close_mode == "semantic":
        final_end = _emit_owned_groundtest_turn(
            recorder,
            session_id=session_id,
            generation=generation,
            number=3,
            start_ms=followup_open_ms + 300,
            audio_generation=audio_base + 4,
            provider_offset=20_000,
            input_text="Farvel.",
            output_text=None if silent_semantic_close else "Farvel.",
            tool_name="end_conversation",
        )
        terminal_turn = f"{session_id}:turn-3"
        semantic_marker_ms = final_end - 28 if silent_semantic_close else final_end + 1
        event(semantic_marker_ms, "semantic_end_requested", turn_id=terminal_turn)
        if silent_semantic_close:
            event(final_end - 20, "semantic_end_silent", turn_id=terminal_turn)
        else:
            event(final_end + 2, "endphrase_confirmed", turn_id=terminal_turn)
        close_reason = "model-close-silent" if silent_semantic_close else "model-close"
        close_ms = final_end + 100
        final_generation = audio_base + 6
    else:
        close_reason = "idle-fallback"
        close_ms = followup_open_ms + 4000
        final_generation = audio_base + 5

    close_id = f"close-{session_id}"
    event(close_ms, "close_requested", reason=close_reason, close_id=close_id)
    event(close_ms + 100, "teardown_complete", close_id=close_id)
    event(
        close_ms + 150,
        "audio_boundary_cut",
        reason="rearm-ack",
        close_id=close_id,
        audio_generation=final_generation,
        provider_sample_offset=20_000 if close_mode == "semantic" else 16_000,
        rearm_token=rearm_token,
    )
    event(
        close_ms + 200,
        "wake_rearm_recovered",
        close_id=close_id,
        audio_generation=final_generation,
        rearm_token=rearm_token,
    )
    manifest = recorder.finish(close_reason)
    assert manifest is not None
    manifest["events"][-1]["at_ms"] = close_ms + 250
    target = recorder.artifact(str(manifest["id"]), "manifest")
    assert target is not None
    target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    recorder._latest = manifest
    return str(manifest["id"])


def _tamper_groundtest_trace(
    recorder: AudioTraceRecorder,
    trace_id: str,
    mutate: Callable[[dict[str, Any]], None],
) -> None:
    target = recorder.artifact(trace_id, "manifest")
    assert target is not None
    manifest = json.loads(target.read_text(encoding="utf-8"))
    mutate(manifest)
    target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    if (recorder.snapshot().get("latest") or {}).get("id") == trace_id:
        recorder._latest = copy.deepcopy(manifest)


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


async def test_protocol_owner_panel_flow_starts_once_then_polls_existing_status():
    calls: list[dict] = []

    async def live_eval(**kwargs):
        calls.append(kwargs)
        if kwargs.get("action") == "protocol-owner":
            return {
                "ok": True,
                "status": "running",
                "kind": "protocol-owner",
                "run_id": "eval-protocol-panel",
                "deadline_s": 45,
            }
        return {
            "ok": True,
            "status": "complete",
            "kind": "protocol-owner",
            "run_id": kwargs.get("run_id"),
            "decision": "GO_TO_RELEASE_GATE",
            "classification": "protocol-owner-proven",
        }

    app = create_app(StatusHub(), {}, live_eval=live_eval, locked=False)
    async with TestClient(TestServer(app)) as client:
        started = await client.post(
            "/api/eval/protocol-owner",
            data='{"max_cost_usd":5}',
            headers={"Content-Type": "application/json"},
        )
        polled = await client.get("/api/eval/live?run_id=eval-protocol-panel")
        started_body = await started.json()
        polled_body = await polled.json()

    assert started.status == 202
    assert started_body["run_id"] == "eval-protocol-panel"
    assert polled.status == 200
    assert polled_body["classification"] == "protocol-owner-proven"
    assert calls == [
        {"action": "protocol-owner", "max_cost_usd": 5.0},
        {"action": "status", "run_id": "eval-protocol-panel"},
    ]


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
    recorder = _groundtest_recorder(tmp_path)
    session = _StubSession("kitchen")
    hub.set_connected("kitchen", True)
    app = create_app(
        hub,
        {"kitchen": session},
        tools=_StubTools(),
        history=hist,
        audio_trace=recorder,
    )
    async with TestClient(TestServer(app)) as client:
        response = await client.get("/api/groundtest")
        initial = await response.json()
        assert len(initial["steps"]) == 20
        assert len(initial["cases"]) == 10
        assert initial["steps"][0]["say"] == "Okay Nabu, hvad er klokken?"
        assert initial["steps"][1].get("new") is not True
        assert initial["cases"][0]["followup"] == "Og hvilken ugedag er det?"
        assert [case["close_mode"] for case in initial["cases"]] == [
            "semantic",
            "idle_timeout",
        ] * 5
        assert initial["summary"]["sentences"] == 25
        assert initial["run"]["started_at"] is None

        response = await client.post("/api/groundtest/start")
        started = await response.json()
        assert started["ok"] is True
        assert started["run"]["current_index"] == 0
        assert recorder.snapshot()["armed_room"] == "kitchen"

        now = time.time()
        history_session = "kitchen:cycle-1"
        hist.append("kitchen", "in", "Hvad er klokken?", ts=now, session=history_session)
        hist.append("kitchen", "out", "Klokken er tre.", ts=now + 0.1, session=history_session)
        hist.append(
            "kitchen",
            "in",
            "Og hvilken ugedag er det?",
            ts=now + 0.2,
            session=history_session,
        )
        hist.append("kitchen", "out", "Det er onsdag.", ts=now + 0.3, session=history_session)
        hist.append("kitchen", "in", "Farvel.", ts=now + 0.4, session=history_session)
        trace_id = _emit_groundtest_trace(
            recorder,
            room="kitchen",
            session_id=history_session,
            generation=1,
            close_mode="semantic",
            provenance=started["run"]["provenance"],
            silent_semantic_close=True,
        )
        hub.tool_call(
            "kitchen",
            "get_time",
            {"ok": True, "summary": "Klokken er tre.", "data": {"time": "15:00"}},
        )
        hub.set_latency("kitchen", 1234)
        hub.set_latency("kitchen", 1456)

        response = await client.post(
            "/api/groundtest/result",
            json={
                "run_id": started["run"]["run_id"],
                "case_id": started["run"]["case_id"],
                "index": 0,
                "outcome": "correct",
            },
        )
        rated = await response.json()

    assert response.status == 200
    assert rated["run"]["current_index"] == 1
    result = rated["run"]["results"][0]
    assert result["inputs"] == ["Hvad er klokken?", "Og hvilken ugedag er det?", "Farvel."]
    assert result["outputs"] == ["Klokken er tre.", "Det er onsdag."]
    assert result["says"] == [
        "Okay Nabu, hvad er klokken?",
        "Og hvilken ugedag er det?",
        "Farvel.",
    ]
    assert result["latency_ms"] == 1456
    assert result["latencies_ms"] == [1234, 1456]
    assert result["machine_ok"] is True, result["machine_issues"]
    assert result["trace_id"] == trace_id
    assert result["oracle_passed"] is True
    assert result["oracle_issues"] == []
    assert result["next_wake_verified"] is False
    assert result["measured_close_reason"] == "model-close-silent"
    assert result["accepted_speech_turns"] == 3
    assert session.stops == []
    assert recorder.snapshot()["armed_room"] == "kitchen"
    assert result["tools"][0]["args"] == {}
    assert result["tools"][0]["result"]["data"]["time"] == "15:00"
    assert rated["summary"]["counts"]["correct"] == 1


async def test_groundtest_rejects_skipping_the_active_conversation(tmp_path):
    hub = StatusHub()
    session = _StubSession("kitchen")
    recorder = _groundtest_recorder(tmp_path)
    hub.set_connected("kitchen", True)
    async with TestClient(
        TestServer(create_app(hub, {"kitchen": session}, audio_trace=recorder))
    ) as client:
        started = await (await client.post("/api/groundtest/start")).json()
        response = await client.post(
            "/api/groundtest/result",
            json={
                "run_id": started["run"]["run_id"],
                "case_id": started["run"]["case_id"],
                "index": 2,
                "outcome": "correct",
            },
        )
        body = await response.json()
    assert response.status == 409
    assert "aktive testsamtale" in body["error"]


async def test_groundtest_cannot_mark_a_half_finished_pair_correct(tmp_path):
    hub = StatusHub()
    hist = History(path=tmp_path / "history.jsonl")
    recorder = _groundtest_recorder(tmp_path)
    session = _StubSession("kitchen")
    hub.set_connected("kitchen", True)
    async with TestClient(
        TestServer(create_app(hub, {"kitchen": session}, history=hist, audio_trace=recorder))
    ) as client:
        started = await (await client.post("/api/groundtest/start")).json()
        now = time.time()
        hist.append("kitchen", "in", "Hvad er klokken?", ts=now)
        hist.append("kitchen", "out", "Klokken er tre.", ts=now + 0.1)
        response = await client.post(
            "/api/groundtest/result",
            json={
                "run_id": started["run"]["run_id"],
                "case_id": started["run"]["case_id"],
                "index": 0,
                "outcome": "correct",
            },
        )
        body = await response.json()

    assert response.status == 409
    assert "ikke helt lukket" in body["error"]
    assert "conversation_incomplete" in body["machine_issues"]


async def test_groundtest_rejects_the_wrong_close_owner_and_missing_teardown(tmp_path):
    hub = StatusHub()
    session = _StubSession("kitchen")
    recorder = _groundtest_recorder(tmp_path)
    hub.set_connected("kitchen", True)
    async with TestClient(
        TestServer(create_app(hub, {"kitchen": session}, audio_trace=recorder))
    ) as client:
        started = await (await client.post("/api/groundtest/start")).json()
        _emit_groundtest_trace(
            recorder,
            room="kitchen",
            session_id="kitchen:wrong-owner",
            generation=1,
            close_mode="idle_timeout",
            provenance=started["run"]["provenance"],
        )
        response = await client.post(
            "/api/groundtest/result",
            json={
                "run_id": started["run"]["run_id"],
                "case_id": started["run"]["case_id"],
                "index": 0,
                "outcome": "correct",
            },
        )
        wrong_owner = await response.json()
        assert response.status == 200
        assert wrong_owner["run"]["results"][0]["outcome"] == "system_failure"
        assert "close_mode_mismatch" in wrong_owner["run"]["results"][0]["machine_issues"]
        assert wrong_owner["run"]["completed_at"] is not None

        restarted = await (await client.post("/api/groundtest/start")).json()
        trace_id = _emit_groundtest_trace(
            recorder,
            room="kitchen",
            session_id="kitchen:no-teardown",
            generation=3,
            close_mode="semantic",
            provenance=restarted["run"]["provenance"],
        )
        _tamper_groundtest_trace(
            recorder,
            trace_id,
            lambda trace: trace.update(
                events=[event for event in trace["events"] if event["event"] != "teardown_complete"]
            ),
        )
        response = await client.post(
            "/api/groundtest/result",
            json={
                "run_id": restarted["run"]["run_id"],
                "case_id": restarted["run"]["case_id"],
                "index": 0,
                "outcome": "correct",
            },
        )
        no_teardown = await response.json()
        assert response.status == 200
        result = no_teardown["run"]["results"][0]
        assert result["outcome"] == "system_failure"
        assert "teardown_complete_count" in result["oracle_issues"]


async def test_groundtest_is_fail_fast_and_only_failure_cleanup_calls_stop(tmp_path):
    hub = StatusHub()
    session = _StubSession("kitchen")
    recorder = _groundtest_recorder(tmp_path)
    hub.set_connected("kitchen", True)
    async with TestClient(
        TestServer(create_app(hub, {"kitchen": session}, audio_trace=recorder))
    ) as client:
        started = await (await client.post("/api/groundtest/start")).json()
        response = await client.post(
            "/api/groundtest/result",
            json={
                "run_id": started["run"]["run_id"],
                "case_id": started["run"]["case_id"],
                "index": 0,
                "outcome": "wrong_hearing",
            },
        )
        body = await response.json()

    assert response.status == 200
    assert body["run"]["completed_at"] is not None
    assert body["run"]["failed_at"] is not None
    assert body["summary"]["passed"] is False
    assert session.stops == ["groundtest-aborted"]
    assert recorder.snapshot()["armed_room"] is None


async def test_groundtest_requires_exact_four_second_timeout_and_fresh_case_token(tmp_path):
    hub = StatusHub()
    session = _StubSession("kitchen")
    recorder = _groundtest_recorder(tmp_path)
    session.idle_timeout_s = 5
    hub.set_connected("kitchen", True)
    async with TestClient(
        TestServer(create_app(hub, {"kitchen": session}, audio_trace=recorder))
    ) as client:
        response = await client.post("/api/groundtest/start")
        assert response.status == 409
        assert "4 sekunder" in (await response.json())["error"]

        session.idle_timeout_s = 4
        started = await (await client.post("/api/groundtest/start")).json()
        response = await client.post(
            "/api/groundtest/result",
            json={
                "run_id": "stale-run",
                "case_id": started["run"]["case_id"],
                "index": 0,
                "outcome": "wrong_hearing",
            },
        )
        assert response.status == 409
        assert "forældet" in (await response.json())["error"]
        assert session.stops == []


async def test_groundtest_requires_and_automatically_arms_local_audio_evidence(tmp_path):
    hub = StatusHub()
    session = _StubSession("kitchen")
    hub.set_connected("kitchen", True)

    async with TestClient(TestServer(create_app(hub, {"kitchen": session}))) as client:
        response = await client.post("/api/groundtest/start")
        body = await response.json()
        assert response.status == 409
        assert "lydbevis" in body["error"].lower()

    recorder = _groundtest_recorder(tmp_path)
    async with TestClient(
        TestServer(create_app(hub, {"kitchen": session}, audio_trace=recorder))
    ) as client:
        response = await client.post("/api/groundtest/start")
        assert response.status == 200
        assert recorder.snapshot()["armed_room"] == "kitchen"


@pytest.mark.parametrize(
    ("mutation", "expected_issue"),
    [
        (
            lambda trace: trace.update(
                events=[
                    event
                    for event in trace["events"]
                    if event["event"] != "speech_started_or_interrupted"
                ]
            ),
            "speech_edges_unbalanced",
        ),
        (
            lambda trace: trace.update(
                events=[
                    event
                    for index, event in enumerate(trace["events"])
                    if not (event["event"] == "mic_gate_closed" and index < 20)
                ]
            ),
            "speech_boundary_sequence_invalid",
        ),
        (
            lambda trace: next(
                event for event in trace["events"] if event["event"] == "provider_response_created"
            ).update(root_item_id="foreign-user"),
            "provider_response_without_accepted_turn",
        ),
        (
            lambda trace: next(
                event for event in trace["events"] if event["event"] == "playback_finished"
            ).update(turn_id="foreign-turn"),
            "playback_owner_mismatch",
        ),
        (
            lambda trace: next(
                event for event in trace["events"] if event["event"] == "provider_response_created"
            ).update(generation=999),
            "stale_turn_generation",
        ),
        (
            lambda trace: trace["stages"].pop("provider"),
            "provider_audio_missing",
        ),
        (
            lambda trace: trace["stages"].pop("speaker"),
            "speaker_audio_missing",
        ),
        (
            lambda trace: next(
                event for event in trace["events"] if event["event"] == "speech_stopped"
            ).pop("provider_generation"),
            "provider_generation_mismatch",
        ),
        (
            lambda trace: [
                event.pop("audio_generation", None)
                for event in trace["events"]
                if event["event"] in {"wake_received", "wake_rearm_recovered"}
            ],
            "physical_wake_missing",
        ),
        (
            lambda trace: trace.update(
                events=[
                    event
                    for event in trace["events"]
                    if event["event"]
                    not in {
                        "provider_response_created",
                        "provider_response_done",
                        "response_audio_started",
                    }
                ]
            ),
            "turn_1_provider_response_missing",
        ),
        (
            lambda trace: trace["events"].insert(
                -1,
                copy.deepcopy(
                    next(
                        event for event in trace["events"] if event["event"] == "teardown_complete"
                    )
                ),
            ),
            "teardown_complete_count",
        ),
    ],
    ids=[
        "missing-speech-start",
        "missing-mic-close",
        "foreign-response-owner",
        "foreign-playback-owner",
        "stale-provider-generation",
        "missing-provider-audio",
        "missing-speaker-audio",
        "missing-local-generation",
        "missing-audio-generation",
        "missing-provider-response",
        "duplicate-teardown",
    ],
)
async def test_groundtest_complete_trace_faults_fail_the_run_instead_of_false_green(
    tmp_path,
    mutation: Callable[[dict[str, Any]], None],
    expected_issue: str,
):
    hub = StatusHub()
    session = _StubSession("kitchen")
    recorder = _groundtest_recorder(tmp_path)
    hub.set_connected("kitchen", True)
    async with TestClient(
        TestServer(create_app(hub, {"kitchen": session}, audio_trace=recorder))
    ) as client:
        started = await (await client.post("/api/groundtest/start")).json()
        trace_id = _emit_groundtest_trace(
            recorder,
            room="kitchen",
            session_id="kitchen:tampered",
            generation=1,
            close_mode="semantic",
            provenance=started["run"]["provenance"],
        )
        _tamper_groundtest_trace(recorder, trace_id, mutation)
        response = await client.post(
            "/api/groundtest/result",
            json={
                "run_id": started["run"]["run_id"],
                "case_id": started["run"]["case_id"],
                "index": 0,
                "outcome": "correct",
            },
        )
        body = await response.json()

    assert response.status == 200
    result = body["run"]["results"][0]
    assert result["outcome"] == "system_failure"
    assert result["machine_ok"] is False
    assert expected_issue in {*result["oracle_issues"], *result["machine_issues"]}
    assert body["run"]["completed_at"] is not None
    assert body["summary"]["passed"] is False


async def test_groundtest_cannot_claim_previous_cycle_rearm_from_an_unrelated_later_wake(
    tmp_path,
):
    hub = StatusHub()
    session = _StubSession("kitchen")
    recorder = _groundtest_recorder(tmp_path)
    hub.set_connected("kitchen", True)
    async with TestClient(
        TestServer(create_app(hub, {"kitchen": session}, audio_trace=recorder))
    ) as client:
        data = await (await client.post("/api/groundtest/start")).json()
        _emit_groundtest_trace(
            recorder,
            room="kitchen",
            session_id="kitchen:cycle-1",
            generation=1,
            close_mode="semantic",
            provenance=data["run"]["provenance"],
        )
        response = await client.post(
            "/api/groundtest/result",
            json={
                "run_id": data["run"]["run_id"],
                "case_id": data["run"]["case_id"],
                "index": 0,
                "outcome": "correct",
            },
        )
        assert response.status == 200
        data = await response.json()

        _emit_groundtest_trace(
            recorder,
            room="kitchen",
            session_id="kitchen:cycle-2",
            generation=3,
            close_mode="idle_timeout",
            provenance=data["run"]["provenance"],
            prove_previous=False,
        )
        response = await client.post(
            "/api/groundtest/result",
            json={
                "run_id": data["run"]["run_id"],
                "case_id": data["run"]["case_id"],
                "index": 1,
                "outcome": "correct",
            },
        )
        failed = await response.json()

    assert response.status == 200
    assert failed["run"]["completed_at"] is not None
    assert failed["run"]["results"][-1]["outcome"] == "system_failure"
    issues = set(failed["run"]["results"][-1]["machine_issues"])
    assert {"next_wake_received_count", "next_session_opened_count"} & issues


async def test_groundtest_rejects_a_3_8_second_close_as_not_the_configured_timeout(tmp_path):
    hub = StatusHub()
    session = _StubSession("kitchen")
    recorder = _groundtest_recorder(tmp_path)
    hub.set_connected("kitchen", True)
    async with TestClient(
        TestServer(create_app(hub, {"kitchen": session}, audio_trace=recorder))
    ) as client:
        # Advance once so the active case expects an idle timeout.
        data = await (await client.post("/api/groundtest/start")).json()
        _emit_groundtest_trace(
            recorder,
            room="kitchen",
            session_id="kitchen:semantic",
            generation=1,
            close_mode="semantic",
            provenance=data["run"]["provenance"],
        )
        data = await (
            await client.post(
                "/api/groundtest/result",
                json={
                    "run_id": data["run"]["run_id"],
                    "case_id": data["run"]["case_id"],
                    "index": 0,
                    "outcome": "correct",
                },
            )
        ).json()
        trace_id = _emit_groundtest_trace(
            recorder,
            room="kitchen",
            session_id="kitchen:early-timeout",
            generation=3,
            close_mode="idle_timeout",
            provenance=data["run"]["provenance"],
        )

        def close_early(trace: dict[str, Any]) -> None:
            close = next(event for event in trace["events"] if event["event"] == "close_requested")
            delta = 200
            close_index = trace["events"].index(close)
            for event in trace["events"][close_index:]:
                event["at_ms"] -= delta

        _tamper_groundtest_trace(recorder, trace_id, close_early)
        response = await client.post(
            "/api/groundtest/result",
            json={
                "run_id": data["run"]["run_id"],
                "case_id": data["run"]["case_id"],
                "index": 1,
                "outcome": "correct",
            },
        )
        failed = await response.json()

    assert response.status == 200
    result = failed["run"]["results"][-1]
    assert result["outcome"] == "system_failure"
    assert "timeout_duration" in result["machine_issues"]


@pytest.mark.parametrize("drop_final_wake_audio", [False, True])
async def test_groundtest_requires_exact_ten_of_ten_and_a_final_physical_wake(
    tmp_path, drop_final_wake_audio: bool
):
    hub = StatusHub()
    session = _StubSession("kitchen")
    recorder = _groundtest_recorder(tmp_path)
    hub.set_connected("kitchen", True)
    async with TestClient(
        TestServer(create_app(hub, {"kitchen": session}, audio_trace=recorder))
    ) as client:
        data = await (await client.post("/api/groundtest/start")).json()
        for index, case in enumerate(data["cases"]):
            generation = index * 2 + 1
            _emit_groundtest_trace(
                recorder,
                room="kitchen",
                session_id=f"kitchen:cycle-{index + 1}",
                generation=generation,
                close_mode=str(case["close_mode"]),
                provenance=data["run"]["provenance"],
                silent_semantic_close=index == 2,
            )
            response = await client.post(
                "/api/groundtest/result",
                json={
                    "run_id": data["run"]["run_id"],
                    "case_id": data["run"]["case_id"],
                    "index": index,
                    "outcome": "correct",
                },
            )
            assert response.status == 200, await response.text()
            data = await response.json()

        assert data["run"]["awaiting_final_wake"] is True
        assert data["run"]["completed_at"] is None
        assert data["summary"]["semantic_close_matched"] == 5
        assert data["summary"]["idle_timeout_matched"] == 5
        assert data["summary"]["next_wake_verified"] == 9
        assert data["summary"]["passed"] is False

        response = await client.post(
            "/api/groundtest/final-wake",
            json={
                "run_id": data["run"]["run_id"],
                "final_wake_id": data["run"]["final_wake_id"],
                "outcome": "correct",
            },
        )
        assert response.status == 409

        assert recorder.note_next_wake(
            "kitchen",
            "physical-attempt-final",
        )
        assert recorder.prove_next_session(
            "kitchen",
            "physical-attempt-final",
            "kitchen:final-wake",
            provider_generation=21,
            previous_provider_generation=20,
        )
        await asyncio.sleep(0.002)
        assert recorder.begin(
            "kitchen",
            {
                **data["run"]["provenance"],
                "wake_source": "physical_wake_callback",
                "wake_attempt_id": "physical-attempt-final",
            },
        )
        recorder.audio("device", b"\x01\x00" * 1600, 16_000)
        recorder.audio("provider", b"\x02\x00" * 2400, 24_000)
        recorder.audio("speaker", b"\x03\x00" * 2400, 24_000)
        _groundtest_event(
            recorder,
            at_ms=1,
            event_name="wake_received",
            session_id="kitchen:final-wake",
            provider_generation=21,
            source="physical_wake_callback",
            wake_attempt_id="physical-attempt-final",
            audio_generation=55,
        )
        _groundtest_event(
            recorder,
            at_ms=2,
            event_name="mic_gate_opened",
            session_id="kitchen:final-wake",
            provider_generation=21,
            reason="wake",
            state="LISTENING",
            audio_generation=55,
            provider_sample_offset=0,
        )
        _groundtest_event(
            recorder,
            at_ms=100,
            event_name="provider_contract",
            session_id="kitchen:final-wake",
            provider_generation=21,
            tool_schema_sha256="schema-stable",
        )
        _groundtest_event(
            recorder,
            at_ms=200,
            event_name="provider_connected",
            session_id="kitchen:final-wake",
            provider_generation=21,
        )
        final_turn_end = _emit_owned_groundtest_turn(
            recorder,
            session_id="kitchen:final-wake",
            generation=21,
            number=1,
            start_ms=500,
            audio_generation=55,
            provider_offset=8000,
            input_text="Er du klar?",
            output_text="Ja.",
        )
        final_epoch = "final-physical-epoch"
        final_turn = "kitchen:final-wake:turn-1"
        hub.timeline(
            "kitchen",
            "wake_received",
            session=final_epoch,
            session_id="kitchen:final-wake",
            source="physical_wake_callback",
            wake_attempt_id="physical-attempt-final",
            provider_generation=21,
            at_ms=0,
        )
        hub.timeline(
            "kitchen",
            "provider_connected",
            session=final_epoch,
            session_id="kitchen:final-wake",
            provider_generation=21,
            at_ms=200,
        )
        hub.timeline(
            "kitchen",
            "speech_stopped",
            session=final_epoch,
            session_id="kitchen:final-wake",
            provider_generation=21,
            turn_id=final_turn,
            accepted=True,
            at_ms=700,
        )
        hub.timeline(
            "kitchen",
            "playback_started",
            session=final_epoch,
            session_id="kitchen:final-wake",
            provider_generation=21,
            turn_id=final_turn,
            playback_id="final-p1",
            at_ms=1000,
        )
        hub.timeline(
            "kitchen",
            "playback_finished",
            session=final_epoch,
            session_id="kitchen:final-wake",
            provider_generation=21,
            turn_id=final_turn,
            playback_id="final-p1",
            at_ms=1300,
        )

        def final_cleanup(reason: str) -> None:
            assert reason == "groundtest-final-wake-cleanup"
            close_id = "close-final-control"
            _groundtest_event(
                recorder,
                at_ms=final_turn_end + 100,
                event_name="close_requested",
                session_id="kitchen:final-wake",
                provider_generation=21,
                reason=reason,
                close_id=close_id,
            )
            _groundtest_event(
                recorder,
                at_ms=final_turn_end + 200,
                event_name="teardown_complete",
                session_id="kitchen:final-wake",
                provider_generation=21,
                close_id=close_id,
            )
            _groundtest_event(
                recorder,
                at_ms=final_turn_end + 250,
                event_name="audio_boundary_cut",
                session_id="kitchen:final-wake",
                provider_generation=21,
                reason="rearm-ack",
                close_id=close_id,
                audio_generation=57,
                provider_sample_offset=8000,
                rearm_token=111,
            )
            _groundtest_event(
                recorder,
                at_ms=final_turn_end + 300,
                event_name="wake_rearm_recovered",
                session_id="kitchen:final-wake",
                provider_generation=21,
                close_id=close_id,
                audio_generation=57,
                rearm_token=111,
            )
            final_manifest = recorder.finish(reason)
            assert final_manifest is not None
            final_manifest["events"][-1]["at_ms"] = final_turn_end + 350
            if drop_final_wake_audio:
                next(
                    event for event in final_manifest["events"] if event["event"] == "wake_received"
                ).pop("audio_generation")
            final_target = recorder.artifact(str(final_manifest["id"]), "manifest")
            assert final_target is not None
            final_target.write_text(
                json.dumps(final_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            recorder._latest = final_manifest
            hub.timeline(
                "kitchen",
                "close_requested",
                session=final_epoch,
                session_id="kitchen:final-wake",
                reason=reason,
                close_id=close_id,
            )
            hub.timeline(
                "kitchen",
                "teardown_complete",
                session=final_epoch,
                session_id="kitchen:final-wake",
                close_id=close_id,
            )
            hub.timeline(
                "kitchen",
                "wake_rearm_recovered",
                session=final_epoch,
                session_id="kitchen:final-wake",
                close_id=close_id,
            )
            hub.set_state("kitchen", "IDLE")

        session.stop_hook = final_cleanup
        response = await client.post(
            "/api/groundtest/final-wake",
            json={
                "run_id": data["run"]["run_id"],
                "final_wake_id": data["run"]["final_wake_id"],
                "outcome": "correct",
            },
        )
        complete = await response.json()

    assert response.status == 200
    if drop_final_wake_audio:
        assert complete["summary"]["passed"] is False
        assert "final_physical_wake" in complete["run"]["final_wake"]["machine_issues"]
        return
    assert complete["summary"]["passed"] is True, complete["run"]["final_wake"]
    assert complete["summary"]["counts"]["correct"] == 10
    assert complete["summary"]["next_wake_verified"] == 10
    assert complete["run"]["results"][-1]["next_wake_verified"] is True
    assert complete["run"]["final_wake"]["history_session"] == "kitchen:final-wake"
    assert session.stops == ["groundtest-final-wake-cleanup"]


async def test_groundtest_owns_manual_audio_controls_while_running(tmp_path):
    hub = StatusHub()
    session = _StubSession("kitchen")
    recorder = _groundtest_recorder(tmp_path)
    hub.set_connected("kitchen", True)
    async with TestClient(
        TestServer(create_app(hub, {"kitchen": session}, audio_trace=recorder))
    ) as client:
        started = await client.post("/api/groundtest/start")
        assert started.status == 200
        armed = await client.post("/api/audio-trace/arm", json={"room": "kitchen"})
        cancelled = await client.post("/api/audio-trace/cancel")
        armed_body = await armed.json()
        cancelled_body = await cancelled.json()

    assert armed.status == 409
    assert cancelled.status == 409
    assert "aktive Grundtest" in armed_body["error"]
    assert "aktive Grundtest" in cancelled_body["error"]


def test_groundtest_summary_cannot_pass_nine_of_ten():
    hub = StatusHub()
    hub.start_groundtest(10, room="kitchen", provenance={"fingerprint": "same"})
    for index in range(9):
        hub.record_groundtest(
            index,
            "correct",
            {
                "machine_ok": True,
                "expected_close_mode": "semantic" if index % 2 == 0 else "idle_timeout",
                "close_reason_match": True,
                "runtime_fingerprint": "same",
                "tool_schema_sha256": "schema",
                "room": "kitchen",
                "timeline_session": f"s{index}",
                "provider_generation": index + 1,
                "wake_seq": index * 10 + 1,
                "rearm_seq": index * 10 + 9,
            },
        )
    hub.record_groundtest(
        9,
        "wrong_hearing",
        {
            "machine_ok": True,
            "expected_close_mode": "idle_timeout",
            "close_reason_match": True,
        },
    )
    summary = _groundtest_payload(hub)["summary"]
    assert summary["counts"]["correct"] == 9
    assert summary["passed"] is False


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
