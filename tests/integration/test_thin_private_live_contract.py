"""Actual SDK/Thin/native and Talk admission; synthetic I/O, never room/provider proof."""

import asyncio
import hashlib
import json
from unittest.mock import Mock

import pytest
from aiohttp.test_utils import make_mocked_request
from test_talk_webrtc import BrowserWire
from test_thin_live import build
from test_thin_live_ten_cycles import (
    CycleWireSDK,
    close_fixture,
    observed,
    retain_aclose_observers,
)

from gatekeeper.audio_trace import AudioTraceRecorder
from gatekeeper.hub import StatusHub
from gatekeeper.live_prompt import live_instructions
from gatekeeper.openai_live import OpenAILiveSession
from gatekeeper.provider_budget import ProviderBudgetCoordinator
from gatekeeper.talk import BrowserLink, run_talk
from gatekeeper.web import _audio_trace_arm, _private_live_contract, create_app


def request(app, body, *, remote="127.0.0.1", path="/api/audio-trace/arm"):
    raw = json.dumps(body).encode()
    transport = Mock()
    transport.get_extra_info.side_effect = lambda name, default=None: (
        (remote, 1111) if name == "peername" else default
    )
    req = make_mocked_request(
        "POST",
        path,
        app=app,
        transport=transport,
        headers={"Content-Type": "application/json", "Content-Length": str(len(raw))},
    )
    req._read_bytes = raw
    return req


@pytest.mark.asyncio
@pytest.mark.parametrize("adapter", ["native", "talk"])
async def test_actual_sdk_send_and_thin_opening_use_same_once_constructed_private_contract(
    adapter, tmp_path, monkeypatch
):
    native = adapter == "native"
    wire = None if native else BrowserWire()
    link = None if native else BrowserLink(wire.send_json, wire.send_bytes)
    session, _, _, tools, _ = build(device=link)
    if not native:
        session.room = "talk"
    sdk = CycleWireSDK(webrtc=not native)
    if wire:
        wire.sdk = sdk
    primary, backend = live_instructions("exact boot custom prompt")
    live = session.live_brain = OpenAILiveSession(
        "inert fixture key",
        tool_declarations=[],
        client_factory=sdk.factory,
        provider_budget=ProviderBudgetCoordinator(),
        timeout_s=2,
        instructions=primary,
        backend_instructions=backend,
        room_context="" if wire else "exact boot room",
    )
    recorder = AudioTraceRecorder(tmp_path, automatic=False)
    session._private_contract_recorder = recorder
    session._private_contract_source_prompt = "exact boot custom prompt"
    assert session.audio_trace is None  # Private Talk capture cannot enable audio capture.
    cap = recorder.arm_private_contract(session.room, adapter)
    observers, task = [], None
    retain_aclose_observers(session, observers, monkeypatch)
    configs = []
    original_configuration = live._configuration

    def configured(*args, **kwargs):
        result = original_configuration(*args, **kwargs)
        configs.append(result)
        return result

    monkeypatch.setattr(live, "_configuration", configured)
    try:
        if native:
            await session.start()
            await session.wake()
        else:
            task = asyncio.create_task(run_talk(wire, session, link))
            wire.send("wake", command_id="private-wake")
            await observed(lambda: wire.result("private-wake") is not None)
            assert wire.result("private-wake")["status"] == "accepted"
        stale = live.private_contract_observer
        result = recorder.consume_private_contract(cap)
        assert result["status"] == "captured" and result["not_provider_echo"]
        assert len(configs) == 1
        if native:
            sent = [event["session"] for event in sdk.wire if event["type"] == "session.start"]
            assert sent == configs
            assert live.provider_session_started
        else:
            assert sdk.client.live.create.await_count == 1
            assert sdk.client.live.create.call_args.kwargs["session"] is configs[0]
            assert [
                event["session"] for event in sdk.wire if event["type"] == "session.update"
            ] == [{}]
            assert not live.provider_session_started  # Attachment ACK is not started.
            assert link._streaming
        source, payload = result["source"], result["payload"]
        assert source["history_session"] == session._history_session
        assert source["thin_epoch"] == session._epoch
        assert source["brain_owner"] == id(live)
        assert source["domain_declarations"] == tools.declarations()
        assert source["system_prompt"] == "exact boot custom prompt"
        cfg = configs[0]
        fingerprints = payload["effective_contract"]["expected_fingerprints"]
        assert fingerprints == {
            "primary_sha256": hashlib.sha256(cfg["instructions"].encode()).hexdigest(),
            "backend_sha256": hashlib.sha256(
                cfg["delegation"]["responses"]["instructions"].encode()
            ).hexdigest(),
            "tools_sha256": hashlib.sha256(
                json.dumps(cfg["delegation"]["responses"]["tools"], sort_keys=True).encode()
            ).hexdigest(),
            "context_sha256": hashlib.sha256(live.room_context.encode()).hexdigest(),
            "model": cfg["model"],
            "backend_model": cfg["delegation"]["responses"]["model"],
            "voice": cfg["audio"]["output"]["voice"],
        }
        stages = [e["stage"] for e in result["stages"]]
        assert stages[-1] == "thin_opening_return"
        assert result["thin_opening_observed"]
        actual_ref = live._diagnostic_ref("session_live")
        assert result["stages"][-1]["provider_session_ref"] == actual_ref
        assert "adapter_ready_return" in stages
        if native:
            assert stages[0] == "native_start_attempt" and "native_started" in stages
        else:
            assert stages[0] == "talk_create_attempt"
            assert "talk_attachment_ack" in stages and "talk_primary_started" in stages
            assert "native_started" not in stages
        assert not tools.calls
        assert cap not in json.dumps(recorder.snapshot())
        fresh = recorder.arm_private_contract(session.room, adapter)
        stale("native_started", live._connection_generation)
        assert recorder._private_contract["source"] is None
        assert recorder.consume_private_contract(fresh)["status"] == "unknown"
    finally:
        await close_fixture(session, [sdk], observers, wire=wire, talk_task=task)


@pytest.mark.asyncio
@pytest.mark.parametrize("remote", ["192.0.2.20", "127.0.0.1"])
async def test_private_arm_and_body_capability_are_strict_even_when_lan_open(remote, tmp_path):
    recorder = AudioTraceRecorder(tmp_path, automatic=False)
    app = create_app(StatusHub(), {"kitchen": object()}, audio_trace=recorder, locked=False)
    response = await _audio_trace_arm(
        request(app, {"private_contract": True, "room": "talk", "adapter": "talk"}, remote=remote)
    )
    if remote != "127.0.0.1":
        assert response.status == 403 and recorder._private_contract is None
        return
    assert response.status == 200 and response.headers["Cache-Control"] == "no-store"
    cap = json.loads(response.body)["capability"]
    assert recorder._armed_room is None
    assert cap not in json.dumps(recorder.snapshot())
    bad = await _private_live_contract(
        request(app, {"capability": "x" * 43}, path="/api/audio-trace/private-contract")
    )
    assert bad.status == 404
    denied = await _private_live_contract(
        request(
            app, {"capability": cap}, remote="192.0.2.20", path="/api/audio-trace/private-contract"
        )
    )
    assert denied.status == 403
    queried = await _private_live_contract(
        request(
            app, {"capability": cap}, path="/api/audio-trace/private-contract?capability=secret"
        )
    )
    assert queried.status == 400
    good = await _private_live_contract(
        request(app, {"capability": cap}, path="/api/audio-trace/private-contract")
    )
    assert good.status == 200 and json.loads(good.body)["status"] == "unknown"
    again = await _private_live_contract(
        request(app, {"capability": cap}, path="/api/audio-trace/private-contract")
    )
    assert again.status == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["cancel", "error", "observer_raise"])
async def test_actual_native_start_fault_does_not_inherit_admission_or_observer_authority(
    outcome, tmp_path, monkeypatch
):
    session, _, _, _, _ = build()
    sdk = CycleWireSDK(webrtc=False)
    live = session.live_brain = OpenAILiveSession(
        "inert fixture key",
        tool_declarations=[],
        client_factory=sdk.factory,
        provider_budget=ProviderBudgetCoordinator(),
        timeout_s=2,
    )
    recorder = AudioTraceRecorder(tmp_path, automatic=False)
    session._private_contract_recorder = recorder
    cap = recorder.arm_private_contract(session.room, "native")
    observers = []
    retain_aclose_observers(session, observers, monkeypatch)
    opening = None
    try:
        await session.start()
        if outcome == "observer_raise":
            original = recorder.bind_private_contract

            def raised(source):
                original(source)

                def callback(*args):
                    raise RuntimeError("private observer must not enter runtime error logs")

                return callback

            monkeypatch.setattr(recorder, "bind_private_contract", raised)
            await session.wake()
            assert session._active and live.provider_session_started
            result = recorder.consume_private_contract(cap)
            assert result["status"] == "unknown" and result["payload"] is None
            assert len([e for e in sdk.wire if e["type"] == "session.start"]) == 1
        elif outcome == "cancel":
            sdk.block_type = "session.start"
            opening = asyncio.create_task(session.wake())
            observers.append(opening)
            await asyncio.wait_for(sdk.blocked.wait(), 3)
            result = recorder.consume_private_contract(cap)
            assert result["status"] == "captured"
            stages = [e["stage"] for e in result["stages"]]
            assert stages == ["native_start_attempt"]
            assert not live.provider_session_started
            assert not result["thin_opening_observed"]
            assert "thin_opening_return" not in stages
            opening.cancel()
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(asyncio.shield(opening), 3)
            assert opening.done()
        else:
            sdk.fail_type = "session.start"
            await session.wake()
            assert not session._active
            assert not live.provider_session_started
            # Failed opening has expired its exact private owner; no old claim survives.
            assert recorder.consume_private_contract(cap) is None
            assert not any(e["type"] == "response.item.create" for e in sdk.wire)
    finally:
        await close_fixture(session, [sdk], observers)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "adapter,ordinary_trace",
    [("native", False), ("talk", False), ("native", True)],
    ids=["native-private-only", "talk-private-only", "native-coexisting-trace"],
)
@pytest.mark.parametrize("ending", ["normal", "error"])
async def test_actual_close_restores_private_owner_before_fresh_capture_and_rejects_old_callbacks(
    adapter, ordinary_trace, ending, tmp_path, monkeypatch
):
    native = adapter == "native"
    wire = None if native else BrowserWire()
    link = None if native else BrowserLink(wire.send_json, wire.send_bytes)
    session, _, _, _, _ = build(device=link)
    if wire:
        session.room = "talk"
    recorder = AudioTraceRecorder(tmp_path, automatic=False)
    session._private_contract_recorder = recorder
    if ordinary_trace:
        session.audio_trace = recorder
        recorder.arm(session.room)
    else:
        assert session.audio_trace is None
    sdks, observers = [], []
    task = None

    def factory(**kwargs):
        sdk = CycleWireSDK(webrtc=not native)
        sdk.allow_exit.set()
        if wire:
            wire.sdk = sdk
        sdks.append(sdk)
        return sdk.factory(**kwargs)

    live = session.live_brain = OpenAILiveSession(
        "inert fixture key",
        tool_declarations=[],
        client_factory=factory,
        provider_budget=ProviderBudgetCoordinator(),
        timeout_s=2,
    )
    retain_aclose_observers(session, observers, monkeypatch)
    try:
        cap_a = recorder.arm_private_contract(session.room, adapter)
        slot_a = recorder._private_contract
        if native:
            await session.start()
            await asyncio.wait_for(session.wake(), 3)
        else:
            task = asyncio.create_task(run_talk(wire, session, link))
            wire.send("wake", command_id="private-a")
            await observed(lambda: wire.result("private-a") is not None)
            assert wire.result("private-a")["status"] == "accepted"
        callback_a = live.private_contract_observer
        history_a, epoch_a, generation_a = (
            session._history_session,
            session._epoch,
            live._connection_generation,
        )
        assert callback_a is not None
        assert slot_a["payload"] is not None
        assert session._provider_trace_observer_installed is ordinary_trace
        closing = asyncio.create_task(
            session.stop() if ending == "normal" else session._fail("private-fixture-error")
        )
        observers.append(closing)
        await asyncio.wait_for(asyncio.shield(closing), 13)
        assert closing.done() and not closing.cancelled() and closing.exception() is None
        assert not session._active and not session._teardown_incomplete
        assert session._close_task is None or session._close_task.done()
        assert live._reader is None and live._connection is None
        assert live._manager is None and live._client is None and live._lease is None
        # Assert the actual normal/error teardown, BEFORE outer fixture rescue.
        assert live.private_contract_observer is None
        assert session._private_contract_observer is None
        assert session._private_contract_brain is None
        assert not session._provider_trace_observer_installed
        assert recorder._private_contract is None
        assert recorder._private_contract_expiry is None
        assert slot_a == {}  # Retained old callback/expiry cannot retain raw values.
        assert recorder.consume_private_contract(cap_a) is None

        cap_b = recorder.arm_private_contract(session.room, adapter)
        slot_b = recorder._private_contract
        handle_b = recorder._private_contract_expiry
        callback_a("native_started", generation_a)
        recorder._expire_private_contract(slot_a)
        recorder.expire_private_contract_owner(history_a, epoch_a)
        assert recorder._private_contract is slot_b
        assert recorder._private_contract_expiry is handle_b
        assert slot_b["source"] is None and slot_b["payload"] is None
        if native:
            await asyncio.wait_for(session.wake(), 3)
        else:
            wire.send("wake", command_id="private-b")
            await observed(lambda: wire.result("private-b") is not None)
            assert wire.result("private-b")["status"] == "accepted"
        assert session.brain is live and len(sdks) == 2
        assert session._history_session != history_a and session._epoch != epoch_a
        assert live._connection_generation > generation_a
        assert live.private_contract_observer is not None
        assert live.private_contract_observer is not callback_a
        frozen_b = json.dumps(recorder._private_contract_result(slot_b), sort_keys=True)
        callback_a("native_started", live._connection_generation)
        recorder._expire_private_contract(slot_a)
        recorder.expire_private_contract_owner(history_a, epoch_a)
        assert json.dumps(recorder._private_contract_result(slot_b), sort_keys=True) == frozen_b
        result_b = recorder.consume_private_contract(cap_b)
        assert result_b["status"] == "captured" and result_b["thin_opening_observed"]
        assert result_b["provider_generation"] == live._connection_generation
        assert result_b["source"]["history_session"] == session._history_session
        assert result_b["source"]["thin_epoch"] == session._epoch
        assert recorder._private_contract is None and slot_b == {}
    finally:
        import sys

        primary = sys.exception()
        failures = []
        try:
            await close_fixture(session, sdks, observers, wire=wire, talk_task=task)
        except BaseException as exc:
            failures.append(exc)
        try:
            assert await recorder.shutdown()
        except BaseException as exc:
            failures.append(exc)
        if failures:
            if primary is not None:
                for exc in failures:
                    primary.add_note(f"Private capture fixture cleanup: {type(exc).__name__}")
            else:
                first, *rest = failures
                for exc in rest:
                    first.add_note(f"Private capture fixture cleanup: {type(exc).__name__}")
                raise first
