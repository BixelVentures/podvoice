"""Deterministic proof of the one-shot Realtime response-owner probe."""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import AsyncIterator
from typing import Any

import pytest

import gatekeeper.eval_harness as eval_harness
from gatekeeper.__main__ import _start_protocol_owner_eval
from gatekeeper.config import Config
from gatekeeper.eval_harness import LiveEvalService
from gatekeeper.openai_realtime import DEFAULT_MODEL, MINI_MODEL, OpenAIRealtimeSession
from gatekeeper.provider_budget import ProviderBudgetCoordinator
from gatekeeper.voice import (
    AudioChunk,
    InputQuarantineResolved,
    ResponseStarted,
    ToolCall,
    TurnComplete,
    Usage,
    UserSpeechStarted,
    UserSpeechStopped,
)

_END = object()
_API_KEY = "private-protocol-owner-key"
_GENERATION = 7
_CONVERSATION_ID = "conversation-shared"
_ACTIVE_VAD_CONFIG: dict[str, Any] = {
    "turn_preset": "custom",
    "openai_turn": "server_vad",
    "openai_threshold": 0.37,
    "openai_prefix_ms": 640,
    "openai_silence_ms": 780,
    "openai_eagerness": "high",
    "openai_noise": "near_field",
}


class _SleepRecorder:
    def __init__(self) -> None:
        self.calls: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)
        await asyncio.sleep(0)


class _ScriptedProtocolSession:
    """Production-shaped adapter fake; all causal output uses the public event seam."""

    def __init__(self, *, faults: frozenset[str], **kwargs: Any) -> None:
        self.faults = faults
        self.kwargs = kwargs
        self._observer = kwargs["provider_observer"]
        self._before_response_create = kwargs["before_response_create"]
        self._connection_generation = _GENERATION
        self._events: asyncio.Queue[Any] = asyncio.Queue()
        self.connected = asyncio.Event()
        self.connect_count = 0
        self.close_count = 0
        self.sent_text: list[tuple[str, str | None, int | None]] = []
        self.sent_audio: list[bytes] = []
        self.crossed_pcm_sent_during_response = False
        self.crossed_emitted = False
        self.quarantine_resolved = False
        self.fresh_started = False
        self.fresh_stopped = False
        self.silence_bytes = 0

    async def _emit(self, *events: Any) -> None:
        for event in events:
            self._events.put_nowait(event)
        # Let the probe's one reader task transfer every edge to its own queue.
        await asyncio.sleep(0)

    def _observe_response_start(
        self,
        *,
        root_item_id: str,
        committed_item_id: str,
        turn_id: int,
        request_id: str,
        response_id: str,
        conversation_id: str = _CONVERSATION_ID,
    ) -> None:
        common = {
            "root_item_id": root_item_id,
            "turn_id": turn_id,
            "generation": _GENERATION,
        }
        self._observer(
            {
                "kind": "accepted_input_turn",
                **common,
                "committed_item_id": committed_item_id,
            }
        )
        self._observer(
            {
                "kind": "response_create_pre_wire",
                **common,
                "request_id": request_id,
                "purpose": "turn",
            }
        )
        self._observer(
            {
                "kind": "response_create_sent",
                **common,
                "request_id": request_id,
                "purpose": "turn",
            }
        )
        self._observer(
            {
                "kind": "response_created",
                **common,
                "request_id": request_id,
                "request_id_matched": True,
                "response_id": response_id,
                "conversation_id": conversation_id,
                "input_generation": _GENERATION,
                "purpose": "turn",
            }
        )

    def _observe_response_done(self, response_id: str) -> None:
        self._observer(
            {
                "kind": "response_done",
                "response_id": response_id,
                "conversation_id": _CONVERSATION_ID,
                "generation": _GENERATION,
                "status": "completed",
            }
        )

    def _usage(self, response_id: str, phase: str) -> Usage | None:
        if f"missing_usage_{phase}" in self.faults:
            return None
        if "zero_usage" in self.faults:
            return Usage(response_id=response_id)
        if "inconsistent_usage" in self.faults:
            return Usage(
                response_id=response_id,
                input_text_tokens=2,
                output_audio_tokens=1,
                provider_input_tokens=2,
                provider_output_tokens=1,
                provider_total_tokens=4,
            )
        return Usage(
            response_id=response_id,
            input_text_tokens=2,
            output_audio_tokens=1,
            provider_input_tokens=2,
            provider_output_tokens=1,
            provider_total_tokens=3,
        )

    async def connect(self) -> None:
        self.connect_count += 1
        self.connected.set()

    async def events(self) -> AsyncIterator[Any]:
        while True:
            event = await self._events.get()
            if event is _END:
                return
            yield event

    async def send_text(
        self,
        text: str,
        *,
        item_id: str | None = None,
        turn_id: int | None = None,
    ) -> None:
        self.sent_text.append((text, item_id, turn_id))
        assert text == eval_harness.PROTOCOL_OWNER_BOOTSTRAP_TEXT
        assert item_id == "pv_protocol_bootstrap"
        assert turn_id == 0
        await self._before_response_create()
        self._observe_response_start(
            root_item_id=item_id,
            committed_item_id=item_id,
            turn_id=turn_id,
            request_id="bootstrap-request",
            response_id="bootstrap-response",
        )
        if "hang" in self.faults:
            return
        await self._emit(
            ResponseStarted(
                "bootstrap-response",
                generation=_GENERATION,
                request_id="bootstrap-request",
                root_item_id=item_id,
                turn_id=turn_id,
            ),
            AudioChunk(
                b"\x01\x00" * 480,
                item_id="bootstrap-assistant",
                response_id="bootstrap-response",
                generation=_GENERATION,
            ),
        )

    async def send_audio(self, pcm: bytes) -> None:
        self.sent_audio.append(bytes(pcm))
        if not self.quarantine_resolved:
            if not self.crossed_emitted:
                self.crossed_pcm_sent_during_response = True
                self.crossed_emitted = True
                await self._emit(UserSpeechStarted("crossed-span", _GENERATION))
            return

        if not self.fresh_started and any(pcm):
            self.fresh_started = True
            generation = _GENERATION - 1 if "stale_fresh_generation" in self.faults else _GENERATION
            await self._emit(UserSpeechStarted("fresh-span", generation))
            return

        if self.fresh_started and not self.fresh_stopped and not any(pcm):
            self.silence_bytes += len(pcm)
            required_s = eval_harness.PROTOCOL_OWNER_FRESH_SILENCE_S
            if self.kwargs["preset"] == "conservative" or (
                self.kwargs["preset"] == "custom" and self.kwargs["turn"] == "server_vad"
            ):
                effective_silence_ms = (
                    500 if self.kwargs["preset"] == "conservative" else self.kwargs["silence_ms"]
                )
                required_s = max(required_s, (effective_silence_ms + 250) / 1000)
            required = int(required_s * 24_000 * 2)
            if self.silence_bytes >= required:
                self.fresh_stopped = True
                await self._emit(UserSpeechStopped("fresh-span", _GENERATION))

    async def quarantine_input_turn(self, item_id: str, generation: int) -> None:
        assert (item_id, generation) == ("crossed-span", _GENERATION)
        committed_id = "crossed-committed"
        rows = [
            {
                "kind": "input_audio_buffer_committed",
                "item_id": committed_id,
                "generation": _GENERATION,
            },
            {
                "kind": "conversation_item_added",
                "item_id": committed_id,
                "role": "user",
                "item_type": "message",
                "generation": _GENERATION,
            },
            {
                "kind": "conversation_item_deleted",
                "item_id": (
                    "foreign-committed" if "foreign_delete_id" in self.faults else committed_id
                ),
                "generation": _GENERATION,
            },
            {
                "kind": "rejected_input_quarantined",
                "root_item_id": item_id,
                "generation": _GENERATION,
                "committed_item_count": 1,
            },
        ]
        if "duplicate_commit" in self.faults:
            rows.insert(1, dict(rows[0]))
        if "out_of_order_cleanup" in self.faults:
            rows[1], rows[2] = rows[2], rows[1]
        if "ghost_create_during_quarantine" in self.faults:
            rows.insert(
                -1,
                {
                    "kind": "response_create_sent",
                    "request_id": "ghost-request",
                    "root_item_id": item_id,
                    "turn_id": 99,
                    "generation": _GENERATION,
                    "purpose": "turn",
                },
            )
        for row in rows:
            self._observer(row)

        self.quarantine_resolved = True
        self._observe_response_done("bootstrap-response")
        if "clamp_capacity_after_bootstrap" in self.faults:
            result = self.kwargs["provider_budget"].clamp_unobserved_eval_completion(
                self.kwargs["budget_lease"]
            )
            assert result["reason"] == "unobserved_completion_clamped"
        terminal: list[Any] = []
        if "quarantine_stop" in self.faults:
            terminal.append(UserSpeechStopped(item_id, _GENERATION))
        terminal.append(InputQuarantineResolved(item_id, _GENERATION))
        usage = self._usage("bootstrap-response", "bootstrap")
        if usage is not None:
            terminal.append(usage)
            if "duplicate_usage" in self.faults:
                terminal.append(usage)
        terminal.append(
            TurnComplete(
                response_id="bootstrap-response",
                generation=_GENERATION,
                purpose="turn",
                # Usage, not rate-limit telemetry, is the billing authority.
                provider_rate_observed=False,
            )
        )
        if "duplicate_resolution" in self.faults:
            terminal.append(InputQuarantineResolved(item_id, _GENERATION))
        if "late_old_stop" in self.faults:
            terminal.append(UserSpeechStopped(item_id, _GENERATION))
        if "change_generation" in self.faults:
            self._connection_generation = _GENERATION + 1
        await self._emit(*terminal)

    async def accept_input_turn(self, item_id: str, turn_id: int, generation: int) -> None:
        assert (item_id, turn_id, generation) == ("fresh-span", 1, _GENERATION)
        await self._before_response_create()
        root_item_id = "foreign-root" if "foreign_response_root" in self.faults else item_id
        conversation_id = (
            "conversation-replaced" if "conversation_changed" in self.faults else _CONVERSATION_ID
        )
        self._observe_response_start(
            root_item_id=root_item_id,
            committed_item_id=item_id,
            turn_id=turn_id,
            request_id="fresh-request",
            response_id="fresh-response",
            conversation_id=conversation_id,
        )
        self._observe_response_done("fresh-response")
        response_generation = (
            _GENERATION - 1 if "stale_response_generation" in self.faults else _GENERATION
        )
        output: list[Any] = [
            ResponseStarted(
                "fresh-response",
                generation=response_generation,
                request_id="fresh-request",
                root_item_id=root_item_id,
                turn_id=turn_id,
            ),
            AudioChunk(
                b"\x02\x00" * 240,
                item_id="fresh-assistant",
                response_id="fresh-response",
                generation=response_generation,
            ),
        ]
        if "unexpected_tool" in self.faults:
            output.append(
                ToolCall(
                    "private-call-id",
                    "forbidden_tool",
                    {"private": "must-never-leak"},
                    response_id="fresh-response",
                    generation=_GENERATION,
                )
            )
        usage = self._usage("fresh-response", "fresh")
        if usage is not None:
            output.append(usage)
        output.append(
            TurnComplete(
                response_id="fresh-response",
                generation=response_generation,
                purpose="turn",
            )
        )
        if "duplicate_response" in self.faults:
            output.append(
                ResponseStarted(
                    "ghost-response",
                    generation=_GENERATION,
                    request_id="ghost-request",
                    root_item_id=item_id,
                    turn_id=turn_id,
                )
            )
        await self._emit(*output)

    async def close(self) -> None:
        self.close_count += 1
        self._events.put_nowait(_END)


class _SessionFactory:
    def __init__(self, *faults: str) -> None:
        self.faults = frozenset(faults)
        self.calls: list[dict[str, Any]] = []
        self.session: _ScriptedProtocolSession | None = None
        self.created = asyncio.Event()

    def __call__(self, **kwargs: Any) -> _ScriptedProtocolSession:
        self.calls.append(kwargs)
        assert self.session is None, "the probe must use exactly one adapter/socket"
        self.session = _ScriptedProtocolSession(faults=self.faults, **kwargs)
        self.created.set()
        return self.session


def _ledger() -> ProviderBudgetCoordinator:
    return ProviderBudgetCoordinator(default_limit=40_000)


@pytest.mark.parametrize("force_mini", [False, True])
def test_addon_forwards_exact_active_voice_config_to_protocol_probe(force_mini: bool) -> None:
    class Service:
        def __init__(self) -> None:
            self.calls: list[dict[str, Any]] = []

        def start_protocol_owner(self, **kwargs: Any) -> dict[str, Any]:
            self.calls.append(kwargs)
            return {"ok": True}

    cfg = Config(
        podconnect_base_url="",
        podconnect_token="",
        voicepe_noise_psk="",
        rooms=(),
        openai_api_key=_API_KEY,
        openai_model="configured-model",
        openai_voice="configured-voice",
        force_mini=force_mini,
        **_ACTIVE_VAD_CONFIG,
    )
    service = Service()

    assert _start_protocol_owner_eval(service, cfg, max_cost_usd=5.0) == {"ok": True}
    assert service.calls == [
        {
            "api_key": _API_KEY,
            "max_cost_usd": 5.0,
            "model": MINI_MODEL if force_mini else "configured-model",
            "voice": "configured-voice",
            **_ACTIVE_VAD_CONFIG,
        }
    ]


async def _run(*faults: str) -> tuple[dict[str, Any], _SessionFactory, ProviderBudgetCoordinator]:
    ledger = _ledger()
    factory = _SessionFactory(*faults)
    report = await LiveEvalService(
        sleep=_SleepRecorder(),
        provider_budget=ledger,
    ).run_protocol_owner(
        api_key=_API_KEY,
        max_cost_usd=5.0,
        session_factory=factory,
        **_ACTIVE_VAD_CONFIG,
    )
    return report, factory, ledger


async def test_protocol_owner_probe_proves_one_socket_quarantine_and_fresh_response() -> None:
    report, factory, ledger = await _run()
    session = factory.session
    assert session is not None

    assert report["ok"] is True
    assert report["status"] == "complete"
    assert report["decision"] == "GO_TO_RELEASE_GATE"
    assert report["classification"] == "protocol-owner-proven"
    assert report["checks"] == {
        "same_socket": True,
        "manual_input_response": True,
        "tools_advertised": 0,
        "bootstrap_responses": 1,
        "quarantined_spans": 1,
        "quarantined_items": 1,
        "quarantine_speech_stops": 0,
        "responses_during_quarantine": 0,
        "fresh_speech_starts": 1,
        "fresh_speech_stops": 1,
        "accepted_audio_turns": 1,
        "accepted_audio_responses": 1,
        "total_responses": 2,
        "usage_events": 2,
        "tool_events": 0,
        "capacity_wait_s": 0.0,
        "audio_seconds_max_reserved": eval_harness.PROTOCOL_OWNER_PROBE_MAX_AUDIO_S,
        "audio_seconds_sent": 4.3,
    }
    assert len(factory.calls) == session.connect_count == session.close_count == 1
    assert factory.calls[0]["manual_input_response"] is True
    assert factory.calls[0]["interrupt_response"] is False
    assert factory.calls[0]["input_rate"] == 24_000
    assert factory.calls[0]["preset"] == "custom"
    assert factory.calls[0]["turn"] == "server_vad"
    assert factory.calls[0]["threshold"] == 0.37
    assert factory.calls[0]["prefix_ms"] == 640
    assert factory.calls[0]["silence_ms"] == 780
    assert factory.calls[0]["eagerness"] == "high"
    assert factory.calls[0]["noise"] == "near_field"
    assert factory.calls[0]["tool_declarations"] == []
    assert factory.calls[0]["room_context"] == ""
    assert report["vad_config_valid"] is True
    assert report["turn_preset"] == "custom"
    assert report["openai_noise"] == "near_field"
    assert report["effective_turn_detection"] == "server_vad"
    assert report["effective_threshold"] == 0.37
    assert report["effective_prefix_ms"] == 640
    assert report["effective_silence_ms"] == 780
    assert report["effective_eagerness"] is None
    assert session.crossed_pcm_sent_during_response is True
    assert session.silence_bytes >= int(eval_harness.PROTOCOL_OWNER_FRESH_SILENCE_S * 24_000 * 2)
    assert report["budget"]["turns"] == 2
    assert report["budget"]["actual_tokens"] == 6
    assert report["budget"]["max_cost_usd"] == 5.0
    assert report["budget"]["cost_usd"] >= report["transcription_budget"]["reserved_cost_usd"]
    assert report["transcription_budget"]["audio_seconds_max"] == (
        eval_harness.PROTOCOL_OWNER_PROBE_MAX_AUDIO_S
    )
    assert ledger.snapshot(_API_KEY, DEFAULT_MODEL)["eval_trials"] == 0
    assert ledger.diagnostic_is_active(_API_KEY) is False
    rendered = json.dumps(report, sort_keys=True)
    assert _API_KEY not in rendered
    assert "must-never-leak" not in rendered
    assert "pcm" not in rendered.lower()


@pytest.mark.parametrize(
    "config",
    [
        {
            "turn_preset": "conservative",
            "openai_turn": "semantic_vad",
            "openai_threshold": 0.91,
            "openai_prefix_ms": 5,
            "openai_silence_ms": 9_000,
            "openai_eagerness": "high",
            "openai_noise": "off",
        },
        {
            "turn_preset": "responsive",
            "openai_turn": "server_vad",
            "openai_threshold": 0.12,
            "openai_prefix_ms": 4_000,
            "openai_silence_ms": 9_500,
            "openai_eagerness": "low",
            "openai_noise": "far_field",
        },
        _ACTIVE_VAD_CONFIG,
    ],
)
def test_protocol_owner_vad_config_matches_production_adapter(config: dict[str, Any]) -> None:
    resolved = eval_harness._protocol_owner_vad_config(**config)
    adapter = OpenAIRealtimeSession(
        api_key="unused",
        preset=config["turn_preset"],
        turn=config["openai_turn"],
        threshold=config["openai_threshold"],
        prefix_ms=config["openai_prefix_ms"],
        silence_ms=config["openai_silence_ms"],
        eagerness=config["openai_eagerness"],
        noise=config["openai_noise"],
        interrupt_response=False,
        manual_input_response=True,
    )
    effective_provider_config = {"turn_detection": adapter._turn_detection()}
    if config["openai_noise"] != "off":
        effective_provider_config["noise_reduction"] = {"type": config["openai_noise"]}
    expected_hash = hashlib.sha256(
        json.dumps(effective_provider_config, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    assert resolved.sha256 == expected_hash


@pytest.mark.parametrize("preset", ["conservative", "responsive"])
def test_protocol_owner_preset_hash_ignores_inactive_raw_knobs(preset: str) -> None:
    base: dict[str, Any] = {
        "turn_preset": preset,
        "openai_turn": "server_vad",
        "openai_threshold": 0.1,
        "openai_prefix_ms": 10,
        "openai_silence_ms": 100,
        "openai_eagerness": "low",
        "openai_noise": "off",
    }
    changed: dict[str, Any] = {
        **base,
        "openai_turn": "semantic_vad",
        "openai_threshold": 0.9,
        "openai_prefix_ms": 4_900,
        "openai_silence_ms": 9_900,
        "openai_eagerness": "high",
    }

    first = eval_harness._protocol_owner_vad_config(**base)
    second = eval_harness._protocol_owner_vad_config(**changed)
    assert first.sha256 == second.sha256
    assert first.max_audio_s == second.max_audio_s


@pytest.mark.parametrize(
    "config",
    [
        {**_ACTIVE_VAD_CONFIG, "openai_turn": "none"},
        {**_ACTIVE_VAD_CONFIG, "turn_preset": "invalid"},
        {**_ACTIVE_VAD_CONFIG, "openai_silence_ms": 10_001},
    ],
)
async def test_protocol_owner_probe_rejects_invalid_vad_before_provider_open(
    config: dict[str, Any],
) -> None:
    factory = _SessionFactory()
    report = await LiveEvalService(provider_budget=_ledger()).run_protocol_owner(
        api_key=_API_KEY,
        max_cost_usd=5.0,
        session_factory=factory,
        **config,
    )

    assert report["status"] == "invalid"
    assert report["error_code"] == "invalid-vad-config"
    assert factory.calls == []


async def test_protocol_owner_probe_rejects_unsupported_model_before_provider_open() -> None:
    factory = _SessionFactory()
    report = await LiveEvalService(provider_budget=_ledger()).run_protocol_owner(
        api_key=_API_KEY,
        max_cost_usd=5.0,
        model="unpriced-realtime-model",
        session_factory=factory,
        **_ACTIVE_VAD_CONFIG,
    )

    assert report["status"] == "invalid"
    assert report["classification"] == "eval-admission-blocked"
    assert report["error_code"] == "unsupported-model"
    assert factory.calls == []


async def test_protocol_owner_probe_reserves_custom_ten_second_server_vad() -> None:
    config = {**_ACTIVE_VAD_CONFIG, "openai_silence_ms": 10_000}
    factory = _SessionFactory()
    report = await LiveEvalService(
        sleep=_SleepRecorder(),
        provider_budget=_ledger(),
    ).run_protocol_owner(
        api_key=_API_KEY,
        max_cost_usd=5.0,
        session_factory=factory,
        **config,
    )

    assert report["ok"] is True
    assert report["effective_silence_ms"] == 10_000
    assert report["transcription_budget"]["audio_seconds_max"] == pytest.approx(18.26)
    assert report["transcription_budget"]["reserved_cost_usd"] == pytest.approx(
        18.26 / 60 * eval_harness.GPT_LIVE_TRANSCRIBE_USD_PER_MINUTE
    )
    assert report["budget"]["mechanical_max_cost_usd"] < 5.0
    assert factory.session is not None
    assert factory.session.silence_bytes >= int(10.25 * 24_000 * 2)


@pytest.mark.parametrize(
    ("fault", "error_code", "classification"),
    [
        ("quarantine_stop", "quarantine-stop-observed", "probe-inconclusive"),
        ("late_old_stop", "late-quarantine-stop", "protocol-owner-failure"),
        ("duplicate_resolution", "duplicate-quarantine-resolution", "protocol-owner-failure"),
        ("duplicate_commit", "quarantine-correlation-failed", "protocol-owner-failure"),
        ("out_of_order_cleanup", "quarantine-correlation-failed", "protocol-owner-failure"),
        ("foreign_delete_id", "quarantine-correlation-failed", "protocol-owner-failure"),
        (
            "ghost_create_during_quarantine",
            "ghost-response-during-quarantine",
            "protocol-owner-failure",
        ),
        ("stale_fresh_generation", "fresh-speech-start-invalid", "protocol-owner-failure"),
        ("change_generation", "provider-generation-changed", "protocol-owner-failure"),
        (
            "foreign_response_root",
            "accepted-response-correlation-failed",
            "protocol-owner-failure",
        ),
        (
            "stale_response_generation",
            "accepted-response-correlation-failed",
            "protocol-owner-failure",
        ),
        ("conversation_changed", "provider-conversation-changed", "protocol-owner-failure"),
        ("duplicate_response", "duplicate-or-ghost-response", "protocol-owner-failure"),
    ],
)
async def test_protocol_owner_probe_fails_closed_on_stale_duplicate_and_foreign_edges(
    fault: str,
    error_code: str,
    classification: str,
) -> None:
    report, factory, ledger = await _run(fault)

    assert report["ok"] is False
    assert report["decision"] == "BLOCKED"
    assert report["classification"] == classification
    assert report["error_code"] == error_code
    assert factory.session is not None and factory.session.close_count == 1
    assert ledger.snapshot(_API_KEY, DEFAULT_MODEL)["eval_trials"] == 0
    assert ledger.diagnostic_is_active(_API_KEY) is False


@pytest.mark.parametrize(
    "fault",
    [
        "missing_usage_bootstrap",
        "missing_usage_fresh",
        "zero_usage",
        "inconsistent_usage",
    ],
)
async def test_protocol_owner_probe_requires_positive_matching_provider_usage(fault: str) -> None:
    report, _factory, ledger = await _run(fault)

    assert report["ok"] is False
    assert report["error_code"] == "provider-usage-unknown"
    assert ledger.snapshot(_API_KEY, DEFAULT_MODEL)["eval_trials"] == 0
    assert ledger.diagnostic_is_active(_API_KEY) is False


async def test_protocol_owner_probe_rejects_duplicate_usage() -> None:
    report, _factory, _ledger_instance = await _run("duplicate_usage")
    assert report["error_code"] == "duplicate-provider-usage"


async def test_protocol_owner_probe_rejects_tools_without_leaking_arguments() -> None:
    report, _factory, _ledger_instance = await _run("unexpected_tool")

    assert report["error_code"] == "unexpected-tool-event"
    rendered = json.dumps(report, sort_keys=True)
    assert "must-never-leak" not in rendered
    assert "private-call-id" not in rendered


async def test_protocol_owner_probe_timeout_closes_socket_and_releases_leases(monkeypatch) -> None:
    monkeypatch.setattr(eval_harness, "LIVE_EVAL_TURN_TIMEOUT_S", 0.01)
    report, factory, ledger = await _run("hang")

    assert report["error_code"] == "bootstrap-timeout"
    assert factory.session is not None and factory.session.close_count == 1
    assert ledger.snapshot(_API_KEY, DEFAULT_MODEL)["eval_trials"] == 0
    assert ledger.diagnostic_is_active(_API_KEY) is False


async def test_protocol_owner_probe_cancellation_closes_socket_and_releases_leases() -> None:
    ledger = _ledger()
    factory = _SessionFactory("hang")
    service = LiveEvalService(provider_budget=ledger)
    task = asyncio.create_task(
        service.run_protocol_owner(
            api_key=_API_KEY,
            max_cost_usd=5.0,
            session_factory=factory,
        )
    )
    await factory.created.wait()
    assert factory.session is not None
    await factory.session.connected.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert factory.session.close_count == 1
    assert ledger.snapshot(_API_KEY, DEFAULT_MODEL)["eval_trials"] == 0
    assert ledger.diagnostic_is_active(_API_KEY) is False


@pytest.mark.parametrize("owner", ["production", "diagnostic"])
async def test_protocol_owner_probe_never_opens_while_provider_owner_is_active(owner: str) -> None:
    ledger = _ledger()
    lease = (
        ledger.production_started(_API_KEY, DEFAULT_MODEL)
        if owner == "production"
        else ledger.diagnostic_started(_API_KEY)
    )
    factory = _SessionFactory()
    try:
        report = await LiveEvalService(provider_budget=ledger).run_protocol_owner(
            api_key=_API_KEY,
            max_cost_usd=5.0,
            session_factory=factory,
        )
    finally:
        ledger.release(lease)

    assert report["error_code"] == "diagnostic-capacity"
    assert factory.calls == []


async def test_protocol_owner_probe_respects_service_lock_before_provider_open() -> None:
    factory = _SessionFactory()
    service = LiveEvalService(provider_budget=_ledger())
    await service._lock.acquire()
    try:
        report = await service.run_protocol_owner(
            api_key=_API_KEY,
            max_cost_usd=5.0,
            session_factory=factory,
        )
    finally:
        service._lock.release()

    assert report["status"] == "busy"
    assert report["error_code"] == "diagnostic-busy"
    assert factory.calls == []


async def test_protocol_owner_probe_rejects_prospective_cost_without_open_or_wait(
    monkeypatch,
) -> None:
    monkeypatch.setattr(eval_harness, "LIVE_EVAL_WORST_RESPONSE_COST_USD", 3.0)

    async def forbidden_sleep(_seconds: float) -> None:
        raise AssertionError("a prospective over-cap probe must never wait")

    factory = _SessionFactory()
    report = await LiveEvalService(
        sleep=forbidden_sleep,
        provider_budget=_ledger(),
    ).run_protocol_owner(
        api_key=_API_KEY,
        max_cost_usd=5.0,
        session_factory=factory,
    )

    assert report["classification"] == "budget-exhausted"
    assert report["error_code"] == "prospective-budget-exceeded"
    assert factory.calls == []


async def test_protocol_owner_probe_waits_and_rechecks_local_capacity_on_same_socket() -> None:
    class Clock:
        def __init__(self) -> None:
            self.now = 0.0
            self.waits: list[float] = []

        def monotonic(self) -> float:
            return self.now

        async def sleep(self, seconds: float) -> None:
            self.waits.append(seconds)
            self.now += seconds
            await asyncio.sleep(0)

    clock = Clock()
    ledger = ProviderBudgetCoordinator(default_limit=40_000, monotonic=clock.monotonic)
    factory = _SessionFactory("clamp_capacity_after_bootstrap")
    report = await LiveEvalService(
        sleep=clock.sleep,
        monotonic=clock.monotonic,
        provider_budget=ledger,
    ).run_protocol_owner(
        api_key=_API_KEY,
        max_cost_usd=5.0,
        session_factory=factory,
    )

    session = factory.session
    assert report["ok"] is True
    assert report["checks"]["capacity_wait_s"] > 0
    assert report["budget"]["rate_limit_wait_s"] == pytest.approx(
        report["checks"]["capacity_wait_s"], abs=0.001
    )
    assert report["budget"]["rate_limit_wait_s"] < eval_harness.PROTOCOL_OWNER_PROBE_DEADLINE_S
    assert session is not None
    assert len(factory.calls) == session.connect_count == session.close_count == 1
    assert ledger.snapshot(_API_KEY, DEFAULT_MODEL)["eval_trials"] == 0
    assert ledger.diagnostic_is_active(_API_KEY) is False


async def test_protocol_owner_status_retains_probe_without_replacing_full_preflight(
    monkeypatch,
) -> None:
    service = LiveEvalService(provider_budget=_ledger())
    service._retain_report(
        {
            "ok": True,
            "status": "complete",
            "run_id": "full-preflight",
            "release_preflight_passed": True,
        },
        kwargs={"run_id": "full-preflight", "model": DEFAULT_MODEL},
        requested_full_profile=True,
    )

    captured: dict[str, Any] = {}

    async def completed_probe(**kwargs: Any) -> dict[str, Any]:
        captured.update(kwargs)
        return {
            "ok": True,
            "status": "complete",
            "kind": "protocol-owner",
            "run_id": kwargs["run_id"],
            "decision": "GO_TO_RELEASE_GATE",
            "classification": "protocol-owner-proven",
            "checks": {"passed": True},
        }

    monkeypatch.setattr(service, "run_protocol_owner", completed_probe)
    started = service.start_protocol_owner(
        api_key=_API_KEY,
        max_cost_usd=5.0,
        **_ACTIVE_VAD_CONFIG,
    )
    assert started["status"] == "running"
    assert service._job is not None
    await service._job

    retained = service.status(started["run_id"])
    assert retained["kind"] == "protocol-owner"
    assert retained["status"] == "complete"
    assert {key: captured[key] for key in _ACTIVE_VAD_CONFIG} == _ACTIVE_VAD_CONFIG
    assert service.status()["run_id"] == "full-preflight"
    assert service.status()["release_preflight_passed"] is True


async def test_protocol_owner_background_cancellation_retains_full_preflight(
    monkeypatch,
) -> None:
    service = LiveEvalService(provider_budget=_ledger())
    service._retain_report(
        {
            "ok": True,
            "status": "complete",
            "run_id": "full-before-cancel",
            "release_preflight_passed": True,
        },
        kwargs={"run_id": "full-before-cancel", "model": DEFAULT_MODEL},
        requested_full_profile=True,
    )
    entered = asyncio.Event()

    async def hanging_probe(**_kwargs: Any) -> dict[str, Any]:
        entered.set()
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    monkeypatch.setattr(service, "run_protocol_owner", hanging_probe)
    started = service.start_protocol_owner(api_key=_API_KEY, max_cost_usd=5.0)
    await entered.wait()
    await service.aclose()

    cancelled = service.status(started["run_id"])
    assert cancelled["status"] == "cancelled"
    assert cancelled["kind"] == "protocol-owner"
    assert service.status()["run_id"] == "full-before-cancel"
    assert service.status()["release_preflight_passed"] is True
