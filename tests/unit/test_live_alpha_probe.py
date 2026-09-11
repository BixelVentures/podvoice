"""Live protocol probe regressions: documented envelopes, no provider credentials."""

import asyncio
import base64
import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "live_alpha_probe.py"
spec = importlib.util.spec_from_file_location("live_alpha_probe", SCRIPT)
assert spec and spec.loader
probe_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = probe_module
spec.loader.exec_module(probe_module)
Probe = probe_module.Probe
ProbeError = probe_module.ProbeError


def connection():
    return SimpleNamespace(
        response=SimpleNamespace(
            item=SimpleNamespace(create=AsyncMock()),
            create=AsyncMock(),
        )
    )


def envelope(kind, **fields):
    return {
        "type": "response.event",
        "event_id": "e",
        "delegation_id": "d",
        "event": {"type": kind, **fields},
    }


def created(response_id="r"):
    return envelope("response.created", response={"id": response_id})


def call(**overrides):
    return envelope(
        "response.output_item.done",
        output_index=0,
        sequence_number=2,
        item={
            "type": "function_call",
            "id": "fc",
            "call_id": "c",
            "name": "get_probe_status",
            "arguments": "{}",
            "status": "completed",
            **overrides,
        },
    )


def terminal(kind="response.completed", response_id="r"):
    return envelope(
        kind,
        response={
            "id": response_id,
            "status": kind.split(".")[1],
            "output": [],
            "usage": {"total_tokens": 7},
        },
    )


@pytest.mark.asyncio
async def test_completed_empty_output_retains_collected_tool_and_continues_once():
    probe, conn = Probe(), connection()
    await probe.handle(created(), conn)
    await probe.handle(call(), conn)
    conn.response.item.create.assert_not_called()
    await probe.handle(terminal(), conn)
    conn.response.item.create.assert_awaited_once_with(
        item={
            "type": "function_call_output",
            "call_id": "c",
            "output": '{"status":"isolated_probe_ok","home_access":false}',
        }
    )
    conn.response.create.assert_awaited_once_with()
    assert probe.backend_usage == [{"total_tokens": 7}]
    # Continue through actual subsequent lifecycle; outbound create is not an ACK.
    await probe.handle(created("r2"), conn)
    await probe.handle(terminal(response_id="r2"), conn)
    conn.response.create.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad",
    [
        call(name="ha_unlock"),
        call(arguments='{"x":1}'),
        call(arguments="{"),
        call(status="in_progress"),
    ],
)
async def test_invalid_batch_never_submits(bad):
    probe, conn = Probe(), connection()
    await probe.handle(created(), conn)
    with pytest.raises(ProbeError):
        await probe.handle(bad, conn)
    conn.response.item.create.assert_not_called()
    conn.response.create.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["response.failed", "response.incomplete"])
async def test_failed_terminal_never_executes(kind):
    probe, conn = Probe(), connection()
    await probe.handle(created(), conn)
    await probe.handle(call(), conn)
    with pytest.raises(ProbeError, match="backend_not_completed"):
        await probe.handle(terminal(kind), conn)
    conn.response.item.create.assert_not_called()


@pytest.mark.asyncio
async def test_duplicate_late_wrong_terminal_and_close_boundary():
    probe, conn = Probe(), connection()
    await probe.handle(created(), conn)
    await probe.handle(call(), conn)
    with pytest.raises(ProbeError, match="duplicate"):
        await probe.handle(call(), conn)
    with pytest.raises(ProbeError, match="unmatched"):
        await probe.handle(terminal(response_id="foreign"), conn)
    await probe.handle(terminal(), conn)
    with pytest.raises(ProbeError, match="orphan"):
        await probe.handle(call(call_id="late"), conn)
    probe.closing = True
    await probe.handle(created("late_response"), conn)
    await probe.handle(call(call_id="late"), conn)
    await probe.handle({"type": "session.closed", "usage": {"seconds": 4}}, conn)
    before = probe.report()
    await probe.handle({"type": "session.output_audio.delta", "delta": "AAAA"}, conn)
    await probe.handle({"type": "error", "error": {"message": "SECRET"}}, conn)
    assert probe.report() == before
    conn.response.item.create.assert_awaited_once()
    assert Probe().seen_calls == set()


@pytest.mark.asyncio
async def test_error_response_item_rejection_is_not_success():
    probe, conn = Probe(), connection()
    await probe.handle(created(), conn)
    await probe.handle(call(), conn)
    await probe.handle(terminal(), conn)
    with pytest.raises(ProbeError, match=r"^provider_error$"):
        await probe.handle(
            {"type": "error", "error": {"client_event_id": "x", "message": "SECRET"}}, conn
        )
    assert not probe.report()["final_usage_confirmed"]


@pytest.mark.asyncio
async def test_audio_validation_backpressure_and_usage_snapshots():
    probe, conn = Probe(), connection()
    await probe.handle({"type": "session.started"}, conn)
    for bad in ["!!!", base64.b64encode(b"x").decode()]:
        with pytest.raises(ProbeError):
            await probe.handle({"type": "session.output_audio.delta", "delta": bad}, conn)
    event = {"type": "session.output_audio.delta", "delta": "AAA="}
    for _ in range(100):
        await probe.handle(event, conn)
    with pytest.raises(ProbeError, match="backpressure"):
        await probe.handle(event, conn)
    for seconds in (2, 5):
        await probe.handle({"type": "session.usage.updated", "usage": {"seconds": seconds}}, conn)
    assert probe.report()["voice_usage_latest"] == {"seconds": 5}
    assert not probe.report()["final_usage_confirmed"]
    await probe.handle({"type": "session.closed", "usage": {"seconds": 6}}, conn)
    assert probe.report()["final_usage_confirmed"]


@pytest.mark.asyncio
async def test_file_speed_input_is_paced_and_does_not_wait_for_output(monkeypatch):
    probe, conn = Probe(), connection()
    conn.session = SimpleNamespace(input_audio=SimpleNamespace(append=AsyncMock()))
    chunks = iter([b"x" * 480, b"x" * 480, b"x" * 960, b""])
    monkeypatch.setattr(probe_module.os, "read", lambda *_: next(chunks))
    monkeypatch.setattr(probe_module, "fd_ready", AsyncMock())

    async def stop_after_two(_):
        if probe.counts["input_bytes_sent"] == 1920:
            probe.closing = True

    sleep = AsyncMock(side_effect=stop_after_two)
    monkeypatch.setattr(probe_module.asyncio, "sleep", sleep)
    await probe_module.send_audio(probe, conn, 0)
    assert conn.session.input_audio.append.await_count == 2
    assert sleep.await_args_list == [((0.02,),), ((0.02,),)]
    assert probe.counts["input_bytes_sent"] == 1920


@pytest.mark.asyncio
async def test_close_deadline_cancels_sender_and_receiver(monkeypatch):
    probe = Probe()
    events = asyncio.Queue()

    class FakeConnection:
        def __init__(self):
            self.session = SimpleNamespace(
                start=AsyncMock(side_effect=self.start), close=AsyncMock()
            )

        async def start(self, **_):
            await events.put(SimpleNamespace(model_dump=lambda: {"type": "session.started"}))

        def __aiter__(self):
            return self

        async def __anext__(self):
            return await events.get()

    async def blocked(*_):
        await asyncio.Event().wait()

    monkeypatch.setattr(probe_module.sys, "stdin", SimpleNamespace(fileno=lambda: 0))
    monkeypatch.setattr(probe_module, "send_audio", blocked)
    monkeypatch.setattr(probe_module, "output_audio", blocked)
    conn = FakeConnection()
    with pytest.raises(TimeoutError):
        await probe_module.run(conn, probe, duration=0.01, close_timeout=0.01)
    conn.session.close.assert_awaited_once()
    assert probe.closing
    assert not probe.finalized.is_set()


def test_sdk_live_schema_and_methods():
    pytest.importorskip("openai.types.live")
    from openai.resources.live.live import AsyncLiveConnection
    from openai.types.live.response_event import ResponseEvent
    from openai.types.live.session_config_param import SessionConfigParam
    from openai.types.responses.response_output_item_done_event import ResponseOutputItemDoneEvent
    from pydantic import TypeAdapter

    config = TypeAdapter(SessionConfigParam).validate_python(probe_module.session_config())
    assert config["delegation"]["responses"]["model"] == "gpt-5.6-luna"
    event = call()
    parsed = ResponseEvent.model_validate(event)
    item = ResponseOutputItemDoneEvent.model_validate(parsed.event)
    assert item.item.call_id == "c"
    assert "response_id" not in ResponseOutputItemDoneEvent.model_fields
    assert hasattr(AsyncLiveConnection, "send")


@pytest.mark.asyncio
async def test_eof_becomes_counted_silence_until_explicit_stop(monkeypatch):
    probe, conn = Probe(), connection()
    conn.session = SimpleNamespace(input_audio=SimpleNamespace(append=AsyncMock()))
    monkeypatch.setattr(probe_module.os, "read", lambda *_: b"")
    monkeypatch.setattr(probe_module, "fd_ready", AsyncMock())

    async def stop_after_frame(_):
        probe.closing = True

    monkeypatch.setattr(probe_module.asyncio, "sleep", stop_after_frame)
    await probe_module.send_audio(probe, conn, 0)
    assert probe.counts["synthetic_silence_bytes"] == 960
    assert base64.b64decode(conn.session.input_audio.append.await_args.kwargs["audio"]) == bytes(
        960
    )
    assert not probe.finalized.is_set()


@pytest.mark.asyncio
async def test_matching_closed_event_confirms_finalization_not_physical_drain(monkeypatch):
    probe = Probe()
    events = asyncio.Queue()

    class FakeConnection:
        def __init__(self):
            self.session = SimpleNamespace(
                start=AsyncMock(side_effect=self.start), close=AsyncMock(side_effect=self.close)
            )

        async def start(self, **_):
            await events.put(SimpleNamespace(model_dump=lambda: {"type": "session.started"}))

        async def close(self):
            await events.put(
                SimpleNamespace(
                    model_dump=lambda: {"type": "session.closed", "usage": {"seconds": 1}}
                )
            )

        def __aiter__(self):
            return self

        async def __anext__(self):
            return await events.get()

    async def blocked(*_):
        await asyncio.Event().wait()

    monkeypatch.setattr(probe_module.sys, "stdin", SimpleNamespace(fileno=lambda: 0))
    monkeypatch.setattr(probe_module, "send_audio", blocked)
    monkeypatch.setattr(probe_module, "output_audio", blocked)
    conn = FakeConnection()
    await probe_module.run(conn, probe, duration=0.01, close_timeout=0.1)
    conn.session.close.assert_awaited_once()
    assert probe.report()["final_usage_confirmed"]
    assert not probe.report()["physical_playback_verified"]


def test_cli_rejects_terminal_or_files_without_opening_provider(monkeypatch, capsys):
    pytest.importorskip("openai.types.live")
    from unittest.mock import Mock

    import openai

    client = Mock(side_effect=AssertionError("network must not be attempted"))
    monkeypatch.setattr(openai, "AsyncOpenAI", client)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT)])
    monkeypatch.setattr(probe_module.sys, "stdin", SimpleNamespace(fileno=lambda: 42))
    monkeypatch.setattr(probe_module.sys, "stdout", SimpleNamespace(fileno=lambda: 43))
    monkeypatch.setattr(probe_module.os, "fstat", lambda _: SimpleNamespace(st_mode=0))
    assert probe_module.main() == 1
    client.assert_not_called()
    assert '"error": "stdin_stdout_must_be_pipes"' in capsys.readouterr().err


@pytest.mark.asyncio
async def test_backend_completing_during_close_keeps_usage_without_submitting_tools():
    probe, conn = Probe(), connection()
    await probe.handle(created(), conn)
    await probe.handle(call(), conn)
    probe.closing = True
    assert probe.report()["backend_responses_missing_terminal"] == 1
    await probe.handle(terminal(), conn)
    await probe.handle({"type": "session.closed", "usage": {"seconds": 8}}, conn)
    assert probe.backend_usage == [{"total_tokens": 7}]
    assert probe.report()["backend_responses_missing_terminal"] == 0
    assert probe.report()["backend_terminal_usage_missing"] == 0
    conn.response.item.create.assert_not_called()
    conn.response.create.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("closing", [False, True])
async def test_nested_backend_error_is_terminal_in_active_and_closing_session(closing):
    probe, conn = Probe(), connection()
    probe.closing = closing
    with pytest.raises(ProbeError, match=r"^backend_error$"):
        await probe.handle(envelope("error", message="SECRET", code="bad_request"), conn)
    assert not probe.report()["session_closed_received"]
    assert not probe.report()["final_usage_confirmed"]
    conn.response.item.create.assert_not_called()
    conn.response.create.assert_not_called()


@pytest.mark.asyncio
async def test_shutdown_report_distinguishes_pending_and_absent_backend_usage():
    probe, conn = Probe(), connection()
    await probe.handle(created(), conn)
    no_usage = terminal()
    del no_usage["event"]["response"]["usage"]
    await probe.handle(no_usage, conn)
    await probe.handle(created("r2"), conn)
    probe.closing = True
    await probe.handle({"type": "session.closed", "usage": {"seconds": 8}}, conn)
    assert probe.report()["backend_responses_missing_terminal"] == 1
    assert probe.report()["backend_terminal_usage_missing"] == 1
    assert probe.report()["final_usage_confirmed"]  # Voice accounting only.


@pytest.mark.asyncio
@pytest.mark.parametrize("call_count", [1, 2])
async def test_stop_during_result_submission_prevents_remaining_work(call_count):
    probe, conn = Probe(), connection()
    await probe.handle(created(), conn)
    for index in range(call_count):
        await probe.handle(call(call_id=f"c{index}"), conn)

    async def stop_while_submission_is_inflight(**_):
        probe.closing = True
        await asyncio.sleep(0)

    conn.response.item.create.side_effect = stop_while_submission_is_inflight
    await probe.handle(terminal(), conn)
    conn.response.item.create.assert_awaited_once()
    conn.response.create.assert_not_called()
    assert probe.counts["stub_results_submitted"] == 1
    assert probe.backend_usage == [{"total_tokens": 7}]


@pytest.mark.asyncio
@pytest.mark.parametrize("source", [b"", b"\x01\x00" * 240])
async def test_real_pipe_eof_separates_source_bytes_from_synthetic_silence(source):
    import os

    probe, conn = Probe(), connection()
    conn.session = SimpleNamespace(input_audio=SimpleNamespace(append=AsyncMock()))
    read_fd, write_fd = os.pipe()
    try:
        os.write(write_fd, source)
        os.close(write_fd)
        write_fd = -1

        async def stop_after_frame(**_):
            probe.closing = True

        conn.session.input_audio.append.side_effect = stop_after_frame
        await asyncio.wait_for(probe_module.send_audio(probe, conn, read_fd), timeout=1)
        assert probe.counts["source_input_bytes"] == len(source)
        assert probe.counts["synthetic_silence_bytes"] == 960 - len(source)
        assert probe.counts["input_bytes_sent"] == 960
        payload = base64.b64decode(conn.session.input_audio.append.await_args.kwargs["audio"])
        assert payload == source + bytes(960 - len(source))
    finally:
        os.close(read_fd)
        if write_fd != -1:
            os.close(write_fd)


@pytest.mark.parametrize("source_bytes", [0, 960])
def test_cli_finalized_session_is_failed_when_source_is_empty(monkeypatch, capsys, source_bytes):
    pytest.importorskip("openai.types.live")
    import json
    import os
    from contextlib import asynccontextmanager

    import openai

    read_fd, write_fd = os.pipe()

    @asynccontextmanager
    async def fake_client(**_):
        @asynccontextmanager
        async def connect(**_):
            yield SimpleNamespace()

        yield SimpleNamespace(live=SimpleNamespace(connect=connect))

    async def finalized_run(connection, probe, duration):
        probe.started.set()
        probe.finalized.set()
        probe.voice_usage = {"seconds": 27}
        probe.counts["source_input_bytes"] = source_bytes
        probe.counts["synthetic_silence_bytes"] = 1339200
        probe.counts["input_bytes_sent"] = 1339200 + source_bytes

    try:
        monkeypatch.setattr(openai, "AsyncOpenAI", fake_client)
        monkeypatch.setattr(probe_module, "run", finalized_run)
        monkeypatch.setattr(sys, "argv", [str(SCRIPT)])
        monkeypatch.setattr(sys, "stdin", SimpleNamespace(fileno=lambda: read_fd))
        monkeypatch.setattr(sys, "stdout", SimpleNamespace(fileno=lambda: write_fd))
        assert probe_module.main() == (0 if source_bytes else 1)
        report = json.loads(capsys.readouterr().err)
        assert report["session_started"]
        assert report["session_closed_received"]
        assert report["final_usage_confirmed"]
        assert report["counters"]["source_input_bytes"] == source_bytes
        assert report["outcome"] == ("finalized" if source_bytes else "failed")
        if not source_bytes:
            assert report["error"] == "no_source_audio"
    finally:
        os.close(read_fd)
        os.close(write_fd)
