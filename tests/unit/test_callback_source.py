"""Scratch-only native private ABI; no provider, device or lifecycle activation."""

import asyncio
import importlib.util
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from aioesphomeapi import APIClient
from aioesphomeapi.api_pb2 import VoiceAssistantAudio
from aioesphomeapi.connection import APIConnection

name = "gatekeeper._callback_source_draft"
spec = importlib.util.spec_from_file_location(
    name, Path(__file__).parents[2] / "podvoice/gatekeeper/voicepe.py"
)
module = importlib.util.module_from_spec(spec)
sys.modules[name] = module
spec.loader.exec_module(module)
VoicePELink = module.VoicePELink
HEADER = module._SOURCE_PCM_HEADER


def packet(
    seq=1,
    start=0,
    end=2,
    overflow=0,
    send_loss=0,
    epoch=1,
    nonce=123,
    fence=0,
    fence_sample=0,
    fence_epoch=0,
):
    return HEADER.pack(
        b"PVC1",
        nonce,
        epoch,
        seq,
        start,
        end,
        overflow,
        send_loss,
        fence,
        fence_sample,
        fence_epoch,
    )


def link():
    value = VoicePELink("pv.local", "psk", room="r0")
    value._source_pcm_nonce = 123
    value._source_pcm_connection = value.connection_generation
    return value


def feed(value, metadata, pcm=b"\x01\x00\x02\x00"):
    value._enqueue_audio(pcm, metadata, audio_epoch=value.audio_generation)
    return value._audio_q.get_nowait()


def test_off_keeps_exact_pcm_and_legacy_optional_channel():
    value = VoicePELink("pv.local", "psk", room="r0")
    frame = feed(value, b"legacy second channel")
    assert (
        frame.pcm == b"\x01\x00\x02\x00"
        and frame.callback_source is None
        and frame.source_problem is None
    )


def test_same_message_source_and_fence_retain_bytes():
    value = link()
    frame = feed(value, packet(start=7, end=9, fence=2, fence_sample=8, fence_epoch=1))
    assert frame.callback_source.sample_start == 7
    assert frame.callback_source.fence_sample == 8
    assert frame.pcm == b"\x01\x00\x02\x00" and frame.source_problem is None


def test_loss_is_explicit_not_continuity_and_no_buffer_discard():
    value = link()
    frame = feed(value, packet())
    assert frame.callback_source.sample_end == 2
    frame = feed(value, packet(seq=3, start=7, end=9, overflow=2, send_loss=3))
    assert frame.source_problem is None
    assert frame.callback_source.native_send_loss_samples == 3
    assert frame.callback_source.overwrite_loss_samples == 2
    assert frame.callback_source.send_sequence == 3
    # Header retains the exact lost interval, never claims source completeness.
    assert frame.callback_source.sample_start == 7


@pytest.mark.parametrize(
    "header,reason",
    [
        (None, "missing_or_malformed_source_header"),
        (b"x", "missing_or_malformed_source_header"),
        (packet(nonce=124), "retired_or_unknown_source_nonce"),
        (packet(end=3), "invalid_source_interval"),
    ],
)
def test_malformed_preserves_pcm_but_never_invents_proof(header, reason):
    frame = feed(link(), header)
    assert frame.pcm == b"\x01\x00\x02\x00"
    assert frame.callback_source is None and frame.source_problem == reason


def test_duplicate_stale_out_of_order_and_unexplained_gap():
    value = link()
    feed(value, packet())
    assert feed(value, packet()).source_problem == "stale_or_out_of_order_source_header"
    assert feed(value, packet(seq=2, start=4, end=6)).source_problem == "unexplained_source_gap"
    frame = feed(value, packet(seq=2, start=2, end=4))
    assert frame.source_problem is None and frame.callback_source.sample_start == 2
    value._connection_generation += 1
    assert feed(value, packet(seq=3, start=4, end=6)).source_problem == "retired_native_connection"


def test_attempt_sequence_gap_requires_exact_positive_native_loss():
    value = link()
    feed(value, packet())
    assert (
        feed(value, packet(seq=3, start=2, end=4)).source_problem == "unexplained_send_sequence_gap"
    )
    assert (
        feed(value, packet(seq=2, start=3, end=5, send_loss=1)).source_problem
        == "unexplained_send_sequence_gap"
    )


def test_fence_idempotence_and_epoch_retirement():
    value = link()
    feed(value, packet(fence=1, fence_sample=2, fence_epoch=1))
    assert (
        feed(
            value, packet(seq=2, start=2, end=4, fence=1, fence_sample=3, fence_epoch=1)
        ).source_problem
        == "stale_or_out_of_order_source_header"
    )
    assert (
        feed(value, packet(seq=2, start=10, end=12, epoch=2)).source_problem
        == "stale_or_out_of_order_source_header"
    )  # fence may not disappear
    frame = feed(
        value, packet(seq=2, start=10, end=12, epoch=2, fence=1, fence_sample=2, fence_epoch=1)
    )
    assert frame.source_problem == "source_capture_epoch_changed"
    assert (
        feed(
            value, packet(seq=3, start=12, end=14, epoch=1, fence=1, fence_sample=2, fence_epoch=1)
        ).source_problem
        == "retired_source_capture_epoch"
    )


@pytest.mark.asyncio
async def test_fence_request_never_discards_queued_prefix_or_fakes_ack():
    value = link()
    value._user_services = {"podvoice_callback_fence": object()}
    value._call_service = AsyncMock(return_value=True)
    value._enqueue_audio(b"\x01\x00\x02\x00", packet(), audio_epoch=value.audio_generation)
    await value.request_callback_source_fence(7)
    assert value._audio_q.qsize() == 1
    frame = value._audio_q.get_nowait()
    assert frame.callback_source.fence_token == 0  # request delivery is not acknowledgement
    assert frame.pcm == b"\x01\x00\x02\x00"


class NativeConnection(APIConnection):
    def __init__(self, params):
        super().__init__(params, None, False, "source-proof")
        self.is_connected = True
        self.callbacks = {}

    def add_message_callback(self, callback, types):
        for kind in types:
            self.callbacks[kind] = callback
        return lambda: None

    def send_message(self, message):
        pass


@pytest.mark.asyncio
async def test_actual_pinned_native_subscriber_delivers_same_protobuf_metadata():
    value = link()
    client = APIClient("pv.local", 6053, "")
    connection = NativeConnection(client._params)
    client._connection = connection

    def audio(data, data2):
        value._enqueue_audio(data, data2, audio_epoch=value.audio_generation)

        async def done():
            pass

        return done()

    unsub = client.subscribe_voice_assistant(
        handle_start=AsyncMock(), handle_stop=AsyncMock(), handle_audio=audio
    )
    wire = VoiceAssistantAudio(
        data=b"\x01\x00\x02\x00", data2=packet(), end=False
    ).SerializeToString()
    parsed = VoiceAssistantAudio.FromString(wire)
    connection.callbacks[VoiceAssistantAudio](parsed)
    frame = value._audio_q.get_nowait()
    assert frame.callback_source.sample_start == 0 and frame.pcm == parsed.data
    assert frame.source_problem is None
    await asyncio.sleep(0)
    unsub()


@pytest.mark.asyncio
async def test_same_native_connection_stop_rearm_renews_nonce_and_rejects_late_frame(monkeypatch):
    value = link()
    value.supports_callback_source_provenance = True
    value._user_services = {"podvoice_source_provenance": object()}
    value._call_service = AsyncMock(return_value=True)
    old_epoch = value.audio_generation
    await value.stop_streaming()
    assert value._source_pcm_nonce is None
    # Correlated rearm uses the existing native owner and epoch boundary.
    value.cut_audio_boundary("rearm-ack")
    monkeypatch.setattr(module.secrets, "randbelow", lambda maximum: 123)
    new_nonce = await value.enable_callback_source_provenance()
    assert new_nonce == 124
    value._call_service.assert_awaited_with("podvoice_source_provenance", {"nonce": 124})
    # Coroutine queued under the old host epoch cannot enter the new queue.
    await value._handle_audio(b"\x01\x00\x02\x00", packet(), audio_epoch=old_epoch)
    assert value._audio_q.empty()
    # Physically older bytes arriving NOW cannot claim the new callback source.
    frame = feed(value, packet(nonce=123))
    assert (
        frame.callback_source is None and frame.source_problem == "retired_or_unknown_source_nonce"
    )
    fresh = feed(value, packet(nonce=124, epoch=2))
    assert fresh.callback_source.nonce == 124 and fresh.source_problem is None
