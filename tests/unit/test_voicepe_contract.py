"""Firmware-contract verification: the add-on must LOUDLY report any mismatch between
what it assumes (services/entities) and what the flashed firmware actually publishes.
The 0.82 lesson: a missing service silently no-op'ed and hid the repeated-wake bug."""

from __future__ import annotations

import logging
from types import SimpleNamespace

from gatekeeper.voicepe import VoicePELink


class _Svc:
    def __init__(self, name: str) -> None:
        self.name = name


FULL_SERVICES = [
    "podvoice_stream_start",
    "podvoice_stream_stop",
    "podvoice_rearm_wake_word",
    "podvoice_reply_expect",
    "podvoice_reply_cancel",
]
FULL_CAPABILITIES = [
    "podvoice_channel_v1",
    "same_breath_v1",
    "wake_audio_boundary_v1",
    "deterministic_rearm_v1",
    "podvoice_playback_events_v1",
]


class MediaPlayerInfo:  # _resolve_entities matches on the CLASS NAME
    def __init__(self, object_id: str, key: int) -> None:
        self.object_id = object_id
        self.key = key


class LightInfo:
    def __init__(self, object_id: str, key: int) -> None:
        self.object_id = object_id
        self.key = key


class _StubClient:
    def __init__(self, service_names: list[str], entities: list) -> None:
        self._services = [_Svc(n) for n in service_names]
        self._entities = entities
        self.executed: list[str] = []

    async def list_entities_services(self):
        return self._entities, self._services

    async def execute_service(self, svc, args):
        self.executed.append(svc.name)

    def media_player_command(self, **kwargs):
        self.executed.append(f"media:{kwargs.get('key')}")

    def send_voice_assistant_event(self, kind, data):
        self.executed.append(f"event:{kind}")


def _link(client: _StubClient) -> VoicePELink:
    link = VoicePELink("pv-test.local", "psk", room="stue")
    link._client = client  # type: ignore[assignment]
    return link


async def test_contract_ok_with_full_firmware(caplog):
    client = _StubClient(
        FULL_SERVICES,
        [
            MediaPlayerInfo("external_media_player", 7),
            LightInfo("led_ring", 9),
            EventInfo("podvoice_event", 3, FULL_CAPABILITIES),
        ],
    )
    link = _link(client)
    await link._resolve_entities()
    with caplog.at_level(logging.WARNING, logger="gatekeeper.voicepe"):
        report = link._verify_contract()
    assert report["ok"] is True
    assert report["missing_required"] == []
    assert report["missing_capabilities"] == []
    # va_abort/stop_word are known-optional (degraded, not broken) — no WARNING lines.
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING]


async def test_contract_mismatch_is_loud_and_reported(caplog):
    client = _StubClient(["podvoice_stream_stop"], [])  # no stream_start, no media_player
    link = _link(client)
    reports: list[dict] = []
    link.on_contract = reports.append
    await link._resolve_entities()
    with caplog.at_level(logging.WARNING, logger="gatekeeper.voicepe"):
        report = link._verify_contract()
    assert report["ok"] is False
    assert report["missing_required"] == [
        "podvoice_rearm_wake_word",
        "podvoice_reply_cancel",
        "podvoice_reply_expect",
        "podvoice_stream_start",
    ]
    assert "media_player" in report["missing_entities"]
    warnings = [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]
    assert any("FIRMWARE MISMATCH" in w and "podvoice_stream_start" in w for w in warnings)
    assert any("media_player" in w for w in warnings)
    assert reports and reports[0]["ok"] is False  # pushed to the panel wiring


async def test_missing_service_call_warns_once_not_silent(caplog):
    client = _StubClient(["podvoice_stream_start", "podvoice_stream_stop"], [])
    link = _link(client)
    await link._resolve_entities()
    with caplog.at_level(logging.WARNING, logger="gatekeeper.voicepe"):
        await link._call_service("podvoice_va_abort")  # not on this firmware
        await link._call_service("podvoice_va_abort")
    warnings = [r for r in caplog.records if "SKIPPED" in r.getMessage()]
    assert len(warnings) == 1  # loud, but once per connect — no log spam
    assert client.executed == []  # and truly skipped


async def test_reflash_rearms_the_missing_service_warning(caplog):
    client = _StubClient(["podvoice_stream_start", "podvoice_stream_stop"], [])
    link = _link(client)
    await link._resolve_entities()
    with caplog.at_level(logging.WARNING, logger="gatekeeper.voicepe"):
        await link._call_service("podvoice_va_abort")
        await link._resolve_entities()  # reconnect (e.g. after a reflash)
        await link._call_service("podvoice_va_abort")
    warnings = [r for r in caplog.records if "SKIPPED" in r.getMessage()]
    assert len(warnings) == 2  # warned fresh after the reconnect


class _ConnectableClient(_StubClient):
    """Stub rich enough to run the full _on_connect path."""

    async def device_info(self):
        class Info:
            esphome_version = "2026.6.3"

        return Info()

    def subscribe_voice_assistant(self, **kwargs):
        return lambda: None

    def subscribe_states(self, cb):
        return lambda: None


async def test_link_state_is_truthful(caplog):
    """The panel dot must track REAL connects/disconnects — not 'loop started'.
    Field bug: the device DHCP'd to a new IP and the dot stayed green for days
    while every wake died silently."""
    client = _ConnectableClient(
        ["podvoice_stream_start", "podvoice_stream_stop"],
        [MediaPlayerInfo("external_media_player", 7), LightInfo("led_ring", 9)],
    )
    link = _link(client)
    states: list[bool] = []
    link.on_link = states.append
    await link._on_connect()
    assert states == [True]  # green only after a REAL completed connect
    await link._on_disconnect(expected_disconnect=False)
    assert states == [True, False]  # and honest about losing the device


async def test_raw_ip_host_gets_a_warning(caplog):
    import logging

    with caplog.at_level(logging.WARNING, logger="gatekeeper.voicepe"):
        VoicePELink("192.168.86.25", "psk", room="stue")
        VoicePELink("podvoice-pe-0a7e7a.local", "psk", room="stue")
    hints = [r for r in caplog.records if "raw IP" in r.getMessage()]
    assert len(hints) == 1  # the IP host warns; the .local host does not


async def test_cached_ip_is_offered_alongside_the_hostname(tmp_path, monkeypatch):
    """mDNS can stop resolving (field: 'Name has no usable address' -> puck OFFLINE for
    minutes). The link must offer BOTH the .local name and the last known IP."""
    import json as _json

    from gatekeeper import voicepe as vp

    cache = tmp_path / "ip.json"
    cache.write_text(_json.dumps({"pv.local": "192.168.86.140"}))
    monkeypatch.setattr(vp.VoicePELink, "_IP_CACHE", cache)

    captured: dict = {}

    class _FakeClient:
        def __init__(self, address, port, password, noise_psk=None):
            captured["address"] = address

    class _FakeReconnect:
        def __init__(self, **kw):
            pass

        async def start(self):
            return None

    import sys
    import types

    mod = types.ModuleType("aioesphomeapi")
    mod.APIClient = _FakeClient
    mod.ReconnectLogic = _FakeReconnect
    monkeypatch.setitem(sys.modules, "aioesphomeapi", mod)

    link = vp.VoicePELink("pv.local", "psk", room="stue")
    await link.start()
    # A LIST here breaks the client (0.98: it stringifies and then fails to resolve
    # "['pv.local']"). One plain string, always — the cached IP is used only when the
    # configured name does not resolve in this container.
    assert isinstance(captured["address"], str)
    assert captured["address"] in ("pv.local", "192.168.86.140")


# ------------------------------------------------------- B1-2b direct PCM path contract
class EventInfo:
    """_resolve_entities matches on the CLASS NAME, like the other entity stubs."""

    def __init__(self, object_id: str, key: int, event_types: list[str]) -> None:
        self.object_id = object_id
        self.key = key
        self.event_types = event_types


async def test_old_pause_required_firmware_is_reported_degraded():
    client = _StubClient(
        ["podvoice_stream_start", "podvoice_stream_stop"],
        [MediaPlayerInfo("external_media_player", 7), LightInfo("led_ring", 9)],
    )
    link = _link(client)
    await link._resolve_entities()
    report = link._verify_contract()
    assert report["ok"] is False
    assert report["missing_capabilities"] == [
        "podvoice_channel_v1",
        "same_breath_v1",
        "wake_audio_boundary_v1",
        "deterministic_rearm_v1",
        "podvoice_playback_events_v1",
    ]
    assert link.supports_same_breath is False


async def test_same_breath_capability_is_read_from_firmware():
    client = _StubClient([], [EventInfo("podvoice_event", 3, ["same_breath_v1"])])
    link = _link(client)
    await link._resolve_entities()
    assert link.supports_same_breath is True


async def test_clean_wake_audio_boundary_capability_is_read_from_firmware():
    client = _StubClient([], [EventInfo("podvoice_event", 3, ["wake_audio_boundary_v1"])])
    link = _link(client)
    await link._resolve_entities()
    assert link.supports_wake_audio_boundary is True


async def test_clean_podvoice_channel_capability_is_read_from_firmware():
    client = _StubClient([], [EventInfo("podvoice_event", 3, ["podvoice_channel_v1"])])
    link = _link(client)
    await link._resolve_entities()
    assert link.supports_podvoice_channel is True


async def test_deterministic_rearm_capability_is_read_from_firmware():
    client = _StubClient([], [EventInfo("podvoice_event", 3, ["deterministic_rearm_v1"])])
    link = _link(client)
    await link._resolve_entities()
    assert link.supports_deterministic_rearm is True


async def test_playback_event_capability_and_edges_are_read_from_firmware():
    client = _StubClient(
        [],
        [
            EventInfo("podvoice_event", 3, ["podvoice_playback_events_v1"]),
            MediaPlayerInfo("external_media_player", 7),
        ],
    )
    link = _link(client)
    await link._resolve_entities()
    assert link.supports_playback_events is True

    edges: list[bool] = []
    link.on_media_state = edges.append
    link._on_state(SimpleNamespace(event_type="podvoice_playback_started", key=3))
    link._on_state(SimpleNamespace(event_type="podvoice_playback_started", key=3))
    link._on_state(SimpleNamespace(event_type="podvoice_playback_finished", key=3))
    link._on_state(SimpleNamespace(event_type="podvoice_playback_finished", key=3))
    assert edges == [True, False]

    # A different event entity and contradictory legacy media state cannot mutate the
    # explicit firmware-owned lifecycle.
    link._on_state(SimpleNamespace(event_type="podvoice_playback_started", key=999))
    assert edges == [True, False]

    class MediaPlayerEntityState:
        key = 7
        state = 4

    link._on_state(MediaPlayerEntityState())
    assert edges == [True, False]  # explicit-capability firmware ignores legacy state

    link._on_state(SimpleNamespace(event_type="podvoice_playback_started", key=3))
    assert link._announcing is True
    link._on_state(SimpleNamespace(event_type="podvoice_playback_fault", key=3))
    assert link._announcing is False
    link._on_state(SimpleNamespace(event_type="podvoice_playback_started", key=3))
    assert edges[-1] is True  # a fault cannot poison the next correlated start
    await link._on_disconnect(expected_disconnect=True)
    assert link._announcing is False


async def test_rearm_calls_the_dedicated_firmware_service():
    client = _StubClient(FULL_SERVICES, [])
    link = _link(client)
    await link._resolve_entities()
    await link.rearm_wake_word()
    assert client.executed == ["podvoice_rearm_wake_word"]


async def test_reply_is_armed_before_the_media_command():
    client = _StubClient(
        FULL_SERVICES,
        [
            MediaPlayerInfo("external_media_player", 7),
            EventInfo("podvoice_event", 3, FULL_CAPABILITIES),
        ],
    )
    link = _link(client)
    await link._resolve_entities()
    await link.play_url("http://podvoice.local/reply/r0.flac")
    assert client.executed == ["podvoice_reply_expect", "media:7"]


async def test_direct_support_is_read_off_the_firmware_not_a_setting():
    """Capability detection requires the safe private-speaker v3 graph.

    1.11.0 advertised reply_played but shared VA's speaker with the media player, so
    RESPONSE_FINISHED could wedge forever. That firmware must remain announce-only."""
    old = _StubClient(
        ["podvoice_stream_start", "podvoice_stream_stop"],
        [EventInfo("podvoice_event", 3, ["wake_okay_nabu", "wake_stop"])],
    )
    link = _link(old)
    await link._resolve_entities()
    assert link.supports_direct is False  # announce-only firmware

    broken_1110 = _StubClient(
        ["podvoice_stream_start", "podvoice_stream_stop"],
        [EventInfo("podvoice_event", 3, ["wake_okay_nabu", "wake_stop", "reply_played"])],
    )
    link2 = _link(broken_1110)
    await link2._resolve_entities()
    assert link2.supports_direct is False

    unsafe_v2 = _StubClient(
        ["podvoice_stream_start", "podvoice_stream_stop"],
        [
            EventInfo(
                "podvoice_event",
                3,
                ["wake_okay_nabu", "wake_stop", "direct_speaker_v2", "reply_played"],
            )
        ],
    )
    link3 = _link(unsafe_v2)
    await link3._resolve_entities()
    assert link3.supports_direct is False  # crashes before first wake: still legacy UDP

    marker_without_prepare = _StubClient(
        ["podvoice_stream_start", "podvoice_stream_stop"],
        [EventInfo("podvoice_event", 3, ["direct_speaker_v3", "reply_played"])],
    )
    link4 = _link(marker_without_prepare)
    await link4._resolve_entities()
    assert link4.supports_direct is False

    fixed = _StubClient(
        ["podvoice_stream_start", "podvoice_stream_stop", "podvoice_direct_prepare"],
        [EventInfo("podvoice_event", 3, ["direct_speaker_v3", "reply_played"])],
    )
    link5 = _link(fixed)
    await link5._resolve_entities()
    assert link5.supports_direct is True


async def test_tts_start_must_carry_non_empty_text(monkeypatch):
    """THE 0.67 bug, locked shut.

    voice_assistant.cpp opens its TTS_START handler with
        if (text.empty()) { ESP_LOGW("No text in TTS_START event"); return; }
    so an empty data map returns BEFORE firing on_tts_start (our 24 kHz rate pin) and
    BEFORE speaker_->start(). The resampler then keeps whatever rate the shared
    external_media_player last decoded (48 kHz) and our 24 kHz reply plays at 2x — the
    "chipmunk" that got the whole direct path reverted. Same for TTS_END's url."""
    import sys
    import types

    sent: list[tuple[str, object]] = []

    class _T:
        VOICE_ASSISTANT_TTS_START = "tts_start"
        VOICE_ASSISTANT_TTS_STREAM_START = "tts_stream_start"
        VOICE_ASSISTANT_TTS_END = "tts_end"
        VOICE_ASSISTANT_TTS_STREAM_END = "tts_stream_end"

    mod = types.ModuleType("aioesphomeapi.model")
    mod.VoiceAssistantEventType = _T
    pkg = types.ModuleType("aioesphomeapi")
    pkg.model = mod
    monkeypatch.setitem(sys.modules, "aioesphomeapi", pkg)
    monkeypatch.setitem(sys.modules, "aioesphomeapi.model", mod)

    class _C:
        def send_voice_assistant_event(self, kind, data):
            sent.append((kind, data))

    link = _link(_StubClient([], []))
    link._client = _C()  # type: ignore[assignment]
    link.supports_direct = True
    link._api_audio_ready = True
    assert await link.begin_direct_reply() is True

    by_kind = dict(sent)
    assert by_kind["tts_start"].get("text"), "TTS_START without text -> the device bails out"
    assert by_kind["tts_end"].get("url"), "TTS_END without url -> never reaches STREAMING_RESPONSE"


async def test_direct_readiness_is_lost_on_disconnect(monkeypatch):
    client = _StubClient([], [])
    link = _link(client)
    link._api_audio_ready = True
    await link._on_disconnect(expected_disconnect=False)
    assert link._api_audio_ready is False


async def test_wake_word_is_reasserted_on_every_connect():
    """Like the mic tuning: a runtime change lives in RAM and dies with the next power
    cut (the 1.6.0 gain lesson). The SETTING has to be re-applied on each connect, or the
    puck quietly goes back to answering "Okay Nabu"."""
    client = _ConnectableClient(
        ["podvoice_stream_start", "podvoice_stream_stop", "podvoice_set_wake_word"],
        [MediaPlayerInfo("external_media_player", 7), LightInfo("led_ring", 9)],
    )
    link = _link(client)
    link.wake_word = "hey_jarvis"
    await link._on_connect()
    assert client.executed.count("podvoice_set_wake_word") == 1
    await link._on_connect()  # e.g. after a reboot
    assert client.executed.count("podvoice_set_wake_word") == 2
