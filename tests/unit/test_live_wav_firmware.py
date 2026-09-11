"""Optional Live codec never becomes an OFF requirement or reuses firmware identity."""

from pathlib import Path

import pytest
from unit.test_voicepe_contract import (
    FULL_CAPABILITIES,
    FULL_SERVICES,
    EventInfo,
    MediaPlayerInfo,
    TextSensorInfo,
    _link,
    _StubClient,
)

from gatekeeper.voicepe import EXPECTED_FIRMWARE_BUILD, LIVE_FIRMWARE_BUILD


def entities(capabilities):
    return [
        MediaPlayerInfo("external_media_player", 7),
        TextSensorInfo("podvoice_rearm_ack", 4),
        TextSensorInfo("podvoice_reply_status", 5),
        TextSensorInfo("podvoice_stop_context", 43),
        EventInfo("podvoice_event", 3, capabilities),
    ]


@pytest.mark.parametrize(
    "marker,wav,ok",
    [
        (EXPECTED_FIRMWARE_BUILD, False, True),
        (LIVE_FIRMWARE_BUILD, True, True),
        (LIVE_FIRMWARE_BUILD, False, False),
        ("podvoice_build_unknown", True, False),
    ],
)
async def test_exact_build_policy_requires_optional_codec_only_for_alpha(marker, wav, ok):
    caps = [marker if c == EXPECTED_FIRMWARE_BUILD else c for c in FULL_CAPABILITIES]
    if wav:
        caps.append("podvoice_live_wav_v1")
    link = _link(_StubClient(FULL_SERVICES, entities(caps)))
    await link._resolve_entities()
    assert link.supports_live_wav is wav
    assert link._verify_contract()["ok"] is ok


async def test_codec_is_not_inherited_after_reconnect_and_unrelated_event_cannot_supply_it():
    caps = [*FULL_CAPABILITIES, "podvoice_live_wav_v1"]
    client = _StubClient(FULL_SERVICES, entities(caps))
    link = _link(client)
    await link._resolve_entities()
    assert link.supports_live_wav
    client._entities = [
        *entities(FULL_CAPABILITIES),
        EventInfo("other", 99, ["podvoice_live_wav_v1"]),
    ]
    await link._resolve_entities()
    assert not link.supports_live_wav
    assert link._verify_contract()["ok"]


async def test_alpha_cannot_relax_existing_mic_playback_rearm_contract():
    caps = [LIVE_FIRMWARE_BUILD if c == EXPECTED_FIRMWARE_BUILD else c for c in FULL_CAPABILITIES]
    caps.append("podvoice_live_wav_v1")
    for required in [
        "same_breath_v1",
        "wake_audio_boundary_v1",
        "correlated_reset_rearm_v2",
        "podvoice_playback_events_v1",
        "correlated_stop_context_v2",
    ]:
        link = _link(_StubClient(FULL_SERVICES, entities([c for c in caps if c != required])))
        await link._resolve_entities()
        assert not link._verify_contract()["ok"]


def test_alpha_overlay_has_distinct_identity_pinned_standard_codec_and_no_parallel_graph():
    root = Path(__file__).resolve().parents[2]
    alpha = (root / "esphome/podvoice-live-alpha.yaml").read_text()
    baseline = (root / "esphome/podvoice.yaml").read_text()
    assert f"podvoice_build_marker: {EXPECTED_FIRMWARE_BUILD}" in baseline
    assert '"${podvoice_build_marker}"' in baseline
    assert "podvoice_live_wav_v1" not in baseline
    assert "!include podvoice.yaml" in alpha
    assert f"podvoice_build_marker: {LIVE_FIRMWARE_BUILD}" in alpha
    assert 'name: esphome/micro-decoder\n        ref: "0.2.0"' in alpha
    assert 'name: esphome/micro-wav\n        ref: "0.1.0"' in alpha
    assert "wav: {}" in alpha
    assert "id: !extend podvoice_event" in alpha
    for forbidden in ["speaker:", "microphone:", "i2s_audio:", "podvoice_audio:", "gain_factor:"]:
        assert forbidden not in alpha
