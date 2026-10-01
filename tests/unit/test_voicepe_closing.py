"""Native status identity/order via actual VoicePELink; simulated electrical evidence."""

import asyncio
import json
from unittest.mock import AsyncMock

import pytest

from gatekeeper.voicepe import CallbackSourceProvenance, VoicePELink


def link():
    out = VoicePELink("pv.local", "psk", room="r0")
    out.supports_closing_led_tx = True
    out._source_pcm_nonce = 123
    out._source_pcm_previous = CallbackSourceProvenance(123, 1, 1, 0, 2, 0, 0, 0, 0, 0)
    out._call_service = AsyncMock(return_value=True)
    return out


def ack(out, token=1, phase="command_admitted", **extra):
    out._accept_native_closing_status(
        json.dumps(
            {
                "v": 1,
                "nonce": 123,
                "capture_epoch": 1,
                "token": token,
                "phase": phase,
                "tx_sequence": 9,
                "tx_us": 4294967295,
                **extra,
            }
        )
    )


async def test_admission_is_not_tx_done_out_of_order_and_old_owner_inert():
    out = link()
    task = asyncio.create_task(
        out.begin_live_closing(1, deadline=asyncio.get_running_loop().time() + 0.5)
    )
    await asyncio.sleep(0)
    ack(out, phase="led_tx_done")
    ack(out, token=2)
    assert not task.done()
    ack(out)
    assert not task.done()
    ack(out, phase="led_tx_done", nonce=124)
    assert not task.done()
    ack(out, phase="led_tx_done")
    result = await task
    assert result["tx_us"] == 4294967295
    await out.cancel_live_closing(1)
    ack(out, phase="led_tx_done")
    assert out._native_closing_owner is None
    assert out._call_service.call_args.args[0] == "podvoice_live_closing_cancel"


@pytest.mark.parametrize("boundary", ["stop", "disconnect", "timeout"])
async def test_stop_disconnect_deadline_retire_waiter_and_delayed_ack(boundary):
    out = link()
    task = asyncio.create_task(
        out.begin_live_closing(1, deadline=asyncio.get_running_loop().time() + 0.03)
    )
    await asyncio.sleep(0)
    ack(out)
    if boundary == "stop":
        await out.stop_streaming()
    elif boundary == "disconnect":
        await out._on_disconnect()
    with pytest.raises(TimeoutError if boundary == "timeout" else asyncio.CancelledError):
        await task
    ack(out, phase="led_tx_done")
    assert out._native_closing_owner is None


async def test_boundary_operation_preserves_queued_pcm_and_audio_epoch():
    out = link()
    out._enqueue_audio(b"\1\0", None, audio_epoch=out.audio_generation)
    epoch = out.audio_generation
    task = asyncio.create_task(
        out.begin_live_closing(1, deadline=asyncio.get_running_loop().time() + 0.5)
    )
    await asyncio.sleep(0)
    ack(out)
    ack(out, phase="led_tx_done")
    await task
    assert out.audio_generation == epoch
    assert out._audio_q.get_nowait().pcm == b"\1\0"


async def test_cancelled_led_ack_wait_sends_exact_cancel_and_rejects_late_tx():
    out = link()
    task = asyncio.create_task(
        out.begin_live_closing(7, deadline=asyncio.get_running_loop().time() + 0.5)
    )
    await asyncio.sleep(0)
    ack(out, token=7, phase="command_admitted")
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    out._call_service.assert_any_await("podvoice_live_closing_cancel", {"nonce": 123, "token": 7})
    ack(out, token=7, phase="led_tx_done")
    assert out._native_closing_owner is None


async def test_provenance_opt_in_preserves_plain_transition_pcm():
    out = link()
    out.supports_callback_source_provenance = True
    out._source_pcm_nonce = None
    out._source_pcm_previous = None
    first, transition = b"\x01\x00" * 320, b"\x02\x00" * 320
    out._enqueue_audio(first, None, audio_epoch=out.audio_generation)
    nonce = await out.enable_callback_source_provenance()
    out._enqueue_audio(transition, None, audio_epoch=out.audio_generation)
    old, new = out._audio_q.get_nowait(), out._audio_q.get_nowait()
    assert old.pcm == first and new.pcm == transition
    assert new.callback_source is None
    assert new.source_problem == "missing_or_malformed_source_header"
    assert out._source_pcm_nonce == nonce
