"""Reject false protocol proof; no credentials or physical/provider semantics."""

import asyncio
import base64
import copy
import importlib.util
import json
import re
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest
from unit.test_openai_live import SDK, DiagnosticWireSDK, call, created, terminal

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
spec = importlib.util.spec_from_file_location(
    "live_idle_check_eval", ROOT / "scripts/live_idle_check_eval.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def observations():
    rows = []

    def emit(kind, elapsed_s, **fields):
        rows.append(dict(kind=kind, seq=len(rows), elapsed_s=elapsed_s, **fields))

    emit("LiveTranscript", 1, direction="in", text="Hvad er to plus to?")
    emit("opening_answer_observed", 2)
    emit("output_energy", 2, nonzero_bytes=100)
    emit("idle_check_request", 6.1, request_id="check", generation=1)
    emit("append_wire_id", 6.2, event_id_sha256=module.rig.digest(b"append"))
    emit(
        "raw_control",
        6.3,
        protocol_type="session.delegation.created",
        generation=1,
        correlations={
            "client_event_id": module.rig.digest(b"append"),
            "delegation_id": module.rig.digest(b"d"),
            "delegation_response_id": module.rig.digest(b"r1"),
        },
    )
    emit("LiveBackendStarted", 6.4, response_id="r1", delegation_id="d", generation=1)
    emit("idle_check_ack", 6.5, request_id="check", generation=1)
    emit(
        "idle_verdict",
        6.6,
        request_id="check",
        generation=1,
        verdict="clear_to_close",
        response_id="r1",
        delegation_id="d",
    )
    emit("tool_results_return", 6.7, response_id="r1", generation=1)
    emit("LiveBackendStarted", 6.8, response_id="r2", delegation_id="d", generation=1)
    emit("idle_backend_settled", 6.9, response_id="r2", delegation_id="d", generation=1)
    emit("observation_finished", 10.7)
    return rows


def assess(rows, case="quiet", **kwargs):
    return module.assess(
        case,
        rows,
        clean=kwargs.get("clean", True),
        usage_complete=kwargs.get("usage_complete", True),
    )


def test_complete_observation_is_only_protocol_never_room_or_runtime_approval():
    report = assess(observations())
    assert report["verdict"] == "OBSERVED_PASS"
    assert report["physical_close"] == report["input_after_fence_preserved"] == "UNKNOWN"
    assert not report["runtime_activation_approved"]
    assert not report["request_token_is_wire_proof"]


@pytest.mark.parametrize(
    "missing",
    [
        "idle_check_request",
        "idle_check_ack",
        "raw_control",
        "append_wire_id",
        "LiveBackendStarted",
        "tool_results_return",
        "idle_backend_settled",
        "observation_finished",
        "output_energy",
        "LiveTranscript",
    ],
)
def test_missing_causal_edge_cannot_pass(missing):
    assert assess([r for r in observations() if r["kind"] != missing])["verdict"] == "UNKNOWN"


@pytest.mark.parametrize(
    "field,bad",
    [
        ("client_event_id", "unrelated"),
        ("delegation_id", "different"),
        ("delegation_response_id", "different"),
    ],
)
def test_same_model_token_cannot_bridge_unrelated_wire_response(field, bad):
    rows = observations()
    next(r for r in rows if r["kind"] == "raw_control")["correlations"][field] = bad
    report = assess(rows)
    assert not report["wire_parent_correlated"]
    assert report["verdict"] == "UNKNOWN"


@pytest.mark.parametrize(
    "kind",
    ["idle_verdict", "idle_check_ack", "idle_backend_settled", "LiveBackendStarted", "raw_control"],
)
def test_delayed_event_from_previous_generation_cannot_authorize_check(kind):
    rows = observations()
    next(r for r in rows if r["kind"] == kind)["generation"] = 2
    assert assess(rows)["verdict"] == "UNKNOWN"


def test_duplicate_or_late_cleanup_settlement_does_not_manufacture_success():
    rows = observations()
    settlement = next(r for r in rows if r["kind"] == "idle_backend_settled")
    rows.append(dict(settlement, seq=len(rows), elapsed_s=11))
    # Duplicate outside observation cannot add evidence.
    assert assess(rows)["verdict"] == "OBSERVED_PASS"
    rows = [r for r in rows if r is not settlement]
    assert assess(rows)["verdict"] == "UNKNOWN"
    rows = observations()
    duplicate = copy.deepcopy(settlement)
    duplicate["seq"] = 11
    rows.insert(-1, duplicate)
    assert assess(rows)["verdict"] == "UNKNOWN"


@pytest.mark.parametrize("bad", ["Hvad er tre plus tre?", "", "Peter, nu taler jeg med dig"])
def test_correct_answer_does_not_prove_misheard_or_missing_known_input(bad):
    rows = observations()
    rows[0]["text"] = bad
    assert assess(rows)["verdict"] == "UNKNOWN"


def test_transcript_before_audio_cannot_start_idle_clock():
    rows = observations()
    next(r for r in rows if r["kind"] == "output_energy")["elapsed_s"] = 5
    assert assess(rows)["verdict"] == "UNKNOWN"


def test_unknown_late_or_failed_continuation_cannot_pass():
    rows = observations()
    next(r for r in rows if r["kind"] == "idle_backend_settled")["elapsed_s"] = 8.2
    assert assess(rows)["verdict"] == "UNKNOWN"
    assert assess(observations(), clean=False)["verdict"] == "UNKNOWN"
    assert assess(observations(), usage_complete=False)["verdict"] == "UNKNOWN"


def test_caption_gap_and_nonzero_output_cannot_prove_silent_check():
    rows = observations()
    rows.insert(-1, dict(kind="output_energy", seq=11, elapsed_s=9, nonzero_bytes=1))
    assert assess(rows)["verdict"] == "UNKNOWN"


def tv_observations():
    rows = observations()[:-1]
    rows.extend(
        dict(
            kind="source_frame",
            elapsed_s=2.1 + n * 0.02,
            frame=n + 1,
            background_bytes=640,
        )
        for n in range(430)
    )
    rows.append(dict(kind="observation_finished", elapsed_s=10.7))
    rows.sort(key=lambda row: row["elapsed_s"])
    for sequence, row in enumerate(rows):
        row["seq"] = sequence
    return rows


def test_continuous_source_requires_cadence_not_sum_of_bytes():
    assert assess(tv_observations(), "tv")["verdict"] == "OBSERVED_PASS"
    rows = tv_observations()
    frame = next(r for r in rows if r["kind"] == "source_frame")
    frame["frame"] = 999
    assert assess(rows, "tv")["verdict"] == "UNKNOWN"
    rows = tv_observations()
    next(r for r in rows if r["kind"] == "source_frame")["background_bytes"] = 0
    assert assess(rows, "tv")["verdict"] == "UNKNOWN"


@pytest.mark.parametrize("start,end", [(7, 10.7), (5, 10.7), (2.1, 7)])
def test_tv_must_cover_idle_decision_and_final_observation(start, end):
    rows = [
        r
        for r in tv_observations()
        if r["kind"] != "source_frame" or start <= r["elapsed_s"] <= end
    ]
    report = assess(rows, "tv")
    assert not report["continuous_background_source_observed"]
    assert report["verdict"] == "UNKNOWN"


def test_late_followup_never_claims_actual_close_cancellation_proof():
    report = assess(tv_observations(), "tv-followup")
    assert report["verdict"] == "UNKNOWN"
    assert report["late_followup_is_observation_only"]


def test_experiment_has_only_enum_resolver_no_domain_or_end_tools(tmp_path):
    evidence = module.rig.Evidence(tmp_path / "probe", starts=1)
    primary, backend = module.configuration()
    live = module.IdleLive(
        "not-a-key",
        evidence,
        tool_declarations=[module.DECLARATION],
        instructions=primary,
        backend_instructions=backend,
    )
    config = live._configuration()
    tools = config["delegation"]["responses"]["tools"]
    assert [tool["name"] for tool in tools] == ["report_idle_check"]
    assert tools[0]["parameters"]["additionalProperties"] is False
    assert "INTERNAL_IDLE_CHECK" in config["instructions"]
    assert "complete silently" in config["delegation"]["responses"]["instructions"]
    evidence.close()


@pytest.mark.asyncio
async def test_real_adapter_append_ack_never_invents_delegation_or_verdict(tmp_path):
    sdk = SDK()
    evidence = module.rig.Evidence(tmp_path / "probe", starts=1)
    primary, backend = module.configuration()
    live = module.IdleLive(
        "not-a-key",
        evidence,
        tool_declarations=[module.DECLARATION],
        instructions=primary,
        backend_instructions=backend,
        client_factory=sdk.factory,
        provider_budget=module.rig.ProviderBudgetCoordinator(),
        timeout_s=0.2,
    )
    try:
        await live.connect()
        await live.append_instructions("INTERNAL_IDLE_CHECK request_id=check")
        append = sdk.session.instructions.append.await_args.kwargs
        matches = [r for r in evidence.rows if r["kind"] == "append_wire_id"]
        assert [r["event_id_sha256"] for r in matches] == [
            module.rig.digest(append["event_id"].encode())
        ]
        assert not any(r["kind"] == "idle_verdict" for r in evidence.rows)
        sdk.response.create.assert_not_awaited()
        assert not live._append_waiters
    finally:
        await live.close()
        evidence.close()


class IdleWireSDK(DiagnosticWireSDK):
    """Scripted peer behind the actual SDK codec; never model-behaviour proof."""

    def __init__(self, *, correlation=True, result_failure=False, source_clock=None):
        super().__init__()
        self.correlation = correlation
        self.source_clock = source_clock
        self.frames = 0
        if result_failure:
            self.fail_type = "response.item.create"

    async def send(self, data):
        await super().send(data)
        event = json.loads(data)
        if event["type"] == "session.input_audio.append":
            self.frames += 1
            if self.source_clock is not None:
                self.source_clock.advance_frame()
            if self.frames == 26:
                for direction, text in (("input", "Hvad er to plus to?"), ("output", "Fire.")):
                    await self.incoming.put(
                        {
                            "type": f"session.{direction}_transcript.delta",
                            "delta": text,
                            "start_ms": 500,
                            "end_ms": 520,
                        }
                    )
                await self.incoming.put(
                    {
                        "type": "session.output_audio.delta",
                        "delta": base64.b64encode(b"\x01\x00" * 480).decode(),
                    }
                )
        elif event["type"] == "session.instructions.append":
            from openai.types.live import DelegationCreatedEvent, InstructionsAppendedEvent

            ack = {
                "type": "session.instructions.appended",
                "event_id": "ack",
                "client_event_id": event["event_id"],
                "start_ms": 600,
                "end_ms": 600,
            }
            delegation = {
                "type": "session.delegation.created",
                "event_id": "delegate",
                "offset_ms": 610,
                "delegation": {
                    "type": "delegation",
                    "target": "responses",
                    "id": "d1",
                    "response_id": "r1",
                },
            }
            if self.correlation:
                delegation["client_event_id"] = event["event_id"]
            # Both shapes are legal in the installed SDK: absent parent is UNKNOWN.
            InstructionsAppendedEvent.model_validate(ack)
            DelegationCreatedEvent.model_validate(delegation)
            request_id = re.search(r"request_id=([a-f0-9]{32})", event["content"])[1]
            verdict = json.dumps(
                dict(request_id=request_id, verdict="clear_to_close", reason="quiet")
            )
            for incoming in (
                ack,
                delegation,
                created(),
                call(name=module.TOOL, arguments=verdict),
                terminal(),
            ):
                await self.incoming.put(incoming)
        elif event["type"] == "response.create":
            await self.incoming.put(created("r2"))
            await self.incoming.put(terminal("r2"))


@pytest.mark.asyncio
async def test_instruction_ack_uses_installed_sdk_without_forcing_backend():
    # Cold SDK imports belong to fixture setup, outside the protocol deadline.
    importlib.import_module("openai.resources.live.live")
    from gatekeeper.live_prompt import live_instructions
    from gatekeeper.openai_live import OpenAILiveSession
    from gatekeeper.prompt import SYSTEM_PROMPT_DA
    from gatekeeper.provider_budget import ProviderBudgetCoordinator
    from gatekeeper.thin import LIVE_END_CONVERSATION_DECLARATION

    class NativeWire(DiagnosticWireSDK):
        async def send(self, data):
            await super().send(data)
            event = json.loads(data)
            if event["type"] == "session.instructions.append":
                await self.incoming.put(
                    {
                        "type": "session.instructions.appended",
                        "event_id": "checkpoint-ack",
                        "client_event_id": event["event_id"],
                        "start_ms": 1000,
                        "end_ms": 1000,
                    }
                )

    sdk = NativeWire()
    primary, backend = live_instructions(SYSTEM_PROMPT_DA)
    live = OpenAILiveSession(
        "not-a-key",
        instructions=primary,
        backend_instructions=backend,
        tool_declarations=[LIVE_END_CONVERSATION_DECLARATION],
        client_factory=sdk.factory,
        provider_budget=ProviderBudgetCoordinator(),
        timeout_s=2,
    )
    try:
        await live.connect()
        content = "Keep listening quietly unless the caller addresses you."
        await live.append_instructions(content)
        append = [event for event in sdk.wire if event["type"] == "session.instructions.append"]
        assert len(append) == 1
        assert append[0]["delegation_id"] is None
        assert append[0]["content"] == content
        assert not live._append_waiters
        assert live.backend_sequence == 0
        assert live._terminal_receipt is None
        assert not any(event["type"] == "response.create" for event in sdk.wire)
        schema = live._validators["end_conversation"]
        assert schema.is_valid({"silent": True})
        assert not schema.is_valid({"silent": True, "idle_checkpoint_id": "12" * 16})
    finally:
        await live.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("record_task", [False, True])
@pytest.mark.parametrize("case", ["quiet", "tv"])
@pytest.mark.parametrize(
    "correlation,result_failure", [(True, False), (False, False), (True, True)]
)
async def test_full_probe_through_installed_sdk_keeps_missing_and_failed_edges_unknown(
    tmp_path, monkeypatch, case, correlation, result_failure, record_task
):
    # This is a scripted protocol test, not host/room latency evidence. Advance
    # probe time only when the real SDK sends an input frame; slow SDK imports or
    # host scheduling cannot consume its observation or alter its source cadence.
    class SourceClock:
        now = 0.0
        frames = 0

        def __init__(self):
            self.deadlines = []
            self.changed = asyncio.Event()
            self.source_task = None

        def monotonic(self):
            # Preserve event ordering within one source-frame interval.
            self.now += 0.000001
            return self.now

        def advance_frame(self):
            self.source_task = asyncio.current_task()
            self.frames += 1
            self.now = round(self.frames * module.rig.FRAME_S, 9)
            self.changed.set()
            self.changed = asyncio.Event()
            for deadline in self.deadlines:
                if self.now >= deadline.when:
                    deadline.expired = True
                    deadline.task.cancel()

        async def sleep(self, delay):
            target = self.now + delay
            # Source and idle polling yield fairly; only source sends move time.
            if asyncio.current_task() is self.source_task:
                # Let both the SDK reader and probe consumer observe this frame's
                # scripted events before the next frame advances source time.
                await asyncio.sleep(0)
                await asyncio.sleep(0)
                return
            while self.now < target:
                await self.changed.wait()
            await asyncio.sleep(0)

        @asynccontextmanager
        async def timeout(self, delay):
            deadline = SimpleNamespace(
                when=self.now + delay, task=asyncio.current_task(), expired=False
            )
            self.deadlines.append(deadline)
            try:
                yield
            except asyncio.CancelledError:
                if deadline.expired:
                    raise TimeoutError from None
                raise
            finally:
                self.deadlines.remove(deadline)

    clock = SourceClock()
    probe_asyncio = SimpleNamespace(
        sleep=clock.sleep,
        timeout=clock.timeout,
        create_task=asyncio.create_task,
        gather=asyncio.gather,
        CancelledError=asyncio.CancelledError,
    )
    monkeypatch.setattr(module, "asyncio", probe_asyncio)
    monkeypatch.setattr(module.rig, "time", SimpleNamespace(monotonic=clock.monotonic))
    monkeypatch.setattr(module, "IDLE_S", 0.12)
    monkeypatch.setattr(module, "POST_CHECK_S", 0.12)
    monkeypatch.setattr(module, "OBSERVATION_S", 2)
    sdk = IdleWireSDK(correlation=correlation, result_failure=result_failure, source_clock=clock)
    evidence = module.rig.Evidence(tmp_path / "wire", starts=1)
    try:
        # Independent real-time hang guard; production adapter deadlines remain real.
        async with asyncio.timeout(30):
            report = await module.evaluate(
                "not-a-key",
                case,
                {name: b"\x01\x00" * 320 for name in ("math", "followup", "tv")},
                evidence,
                client_factory=sdk.factory,
                record_task=record_task,
            )
    finally:
        evidence.close()
    assert report["verdict"] == (
        "OBSERVED_PASS" if correlation and not result_failure else "UNKNOWN"
    )
    assert report["physical_close"] == "UNKNOWN"
    assert report["protocol_variant"] == ("record-task" if record_task else "steering")
    assert not report["runtime_activation_approved"]
    assert report["clean_shutdown"]
    assert sdk.frames >= 26
    assert report["known_opening_input_observed"]
    assert report["opening_audio_then_idle_observed"]
    assert report["continuous_background_source_observed"]
    assert report["wire_parent_correlated"] is correlation
    types = [event["type"] for event in sdk.wire]
    assert types.count("session.start") == types.count("session.close") == 1
    assert types.count("session.instructions.append") == 1
    assert types.count("response.item.create") == 1
    assert types.count("response.create") == (0 if result_failure else 1)
