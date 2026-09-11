"""Native held ACK fences queued and scheduled capture across a provider rotation."""

import asyncio

import pytest
from test_voicepe_contract import TextSensorState, _link, _StubClient, _Svc


def link_fixture():
    client = _StubClient([], [])
    link = _link(client)
    link.supports_live_capture_hold = True
    link._capture_status_key = 77
    link._user_services = {
        name: _Svc(name)
        for name in ("podvoice_capture_hold", "podvoice_capture_resume", "podvoice_stream_stop")
    }
    return link, client


async def started(link, client):
    task = asyncio.create_task(link.hold_live_capture())
    await asyncio.sleep(0)
    assert client.executed[-1] == "podvoice_capture_hold"
    return task, client.executed_args[-1]["token"]


def ack(link, token, phase, high=None):
    link._on_state(TextSensorState(f"{token}:{phase}:{token if high is None else high}", key=77))


async def test_held_ack_cuts_queue_and_delayed_audio_before_waiter_runs():
    link, client = link_fixture()
    epoch = link._audio_epoch
    await link._handle_audio(b"queued", audio_epoch=epoch)
    delayed = link._handle_audio(b"delayed", audio_epoch=epoch)
    task, token = await started(link, client)
    ack(link, token + 1, "held")
    assert not task.done() and link._audio_epoch == epoch
    ack(link, token, "held")
    assert link._audio_epoch == epoch + 1 and link._audio_q.empty()
    await delayed
    assert link._audio_q.empty()
    assert await task == token
    resume = asyncio.create_task(link.resume_live_capture(token))
    await asyncio.sleep(0)
    ack(link, token, "held")
    assert not resume.done()
    await link._handle_audio(b"fresh", audio_epoch=link._audio_epoch)
    ack(link, token, "resumed")
    await resume
    assert link._audio_q.get_nowait() == b"fresh"
    with pytest.raises(RuntimeError, match="stale"):
        await link.resume_live_capture(token)


@pytest.mark.parametrize("phase", ["hold", "resume"])
@pytest.mark.parametrize("stop", ["stop", "disconnect"])
async def test_stop_disconnect_retires_waiter_and_late_ack(phase, stop):
    link, client = link_fixture()
    task, token = await started(link, client)
    if phase == "resume":
        ack(link, token, "held")
        await task
        task = asyncio.create_task(link.resume_live_capture(token))
        await asyncio.sleep(0)
    if stop == "stop":
        await link.stop_streaming()
    else:
        await link._on_disconnect()
    with pytest.raises(asyncio.CancelledError):
        await task
    epoch = link._audio_epoch
    ack(link, token, "held" if phase == "hold" else "resumed")
    assert link._audio_epoch == epoch
    with pytest.raises(RuntimeError, match="stale"):
        await link.resume_live_capture(token)


async def test_device_high_water_survives_reconnect_and_fault_does_not_hold():
    link, client = link_fixture()
    high = link._capture_counter + 100
    ack(link, high, "idle", high)
    task, token = await started(link, client)
    assert token > high
    ack(link, token, "fault", token + 100)
    with pytest.raises(RuntimeError, match="firmware"):
        await task
    task, fresh = await started(link, client)
    assert fresh > token + 100
    ack(link, fresh, "held")
    await task
    await link.stop_streaming()


def test_subscriber_disconnect_retires_capture_before_other_automations():
    from pathlib import Path

    source = (Path(__file__).parents[2] / "esphome/voice-pe-podvoice-base.yaml").read_text()
    handler = (
        source.split("voice_assistant:", 1)[1]
        .split("  on_client_disconnected:", 1)[1]
        .split("  on_error:", 1)[0]
    )
    assert "id(pv_audio).stop_streaming();" in handler
    assert handler.index("id(pv_audio).stop_streaming();") < handler.index("voice_assistant.stop:")
