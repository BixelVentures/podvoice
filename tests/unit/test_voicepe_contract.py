"""Firmware-contract verification: the add-on must LOUDLY report any mismatch between
what it assumes (services/entities) and what the flashed firmware actually publishes.
The 0.82 lesson: a missing service silently no-op'ed and hid the repeated-wake bug."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from types import SimpleNamespace

import pytest

from gatekeeper.voicepe import VoicePELink


class _Svc:
    def __init__(self, name: str) -> None:
        self.name = name


FULL_SERVICES = [
    "podvoice_stream_start",
    "podvoice_stream_stop",
    "podvoice_rearm_wake_word",
    "podvoice_reply_expect",
    "podvoice_reply_play",
    "podvoice_reply_cancel",
    "podvoice_reply_silence",
]
FULL_CAPABILITIES = [
    "podvoice_channel_v1",
    "same_breath_v1",
    "wake_audio_boundary_v1",
    "deterministic_rearm_v1",
    "physical_rearm_ack_v1",
    "continuous_rearm_v1",
    "physical_rearm_audio_progress_v1",
    "correlated_reset_rearm_v2",
    "correlated_playback_v2",
    "podvoice_build_11345",
    "podvoice_playback_events_v1",
]
REARM_CAPABILITIES = [
    "physical_rearm_ack_v1",
    "continuous_rearm_v1",
    "physical_rearm_audio_progress_v1",
    "correlated_reset_rearm_v2",
    "podvoice_build_11345",
]


class MediaPlayerInfo:  # _resolve_entities matches on the CLASS NAME
    def __init__(self, object_id: str, key: int) -> None:
        self.object_id = object_id
        self.key = key


class LightInfo:
    def __init__(self, object_id: str, key: int) -> None:
        self.object_id = object_id
        self.key = key


class TextSensorInfo:
    def __init__(self, object_id: str, key: int) -> None:
        self.object_id = object_id
        self.key = key


class TextSensorState:
    def __init__(self, state: str, key: int = 4) -> None:
        self.state = state
        self.key = key


class _StubClient:
    def __init__(self, service_names: list[str], entities: list) -> None:
        self._services = [_Svc(n) for n in service_names]
        self._entities = entities
        self.executed: list[str] = []
        self.executed_args: list[dict] = []
        self.service_hook = None

    async def list_entities_services(self):
        return self._entities, self._services

    async def execute_service(self, svc, args):
        self.executed.append(svc.name)
        self.executed_args.append(dict(args))
        if self.service_hook is not None:
            self.service_hook(svc.name, dict(args))

    def media_player_command(self, **kwargs):
        self.executed.append(f"media:{kwargs.get('key')}")

    def send_voice_assistant_event(self, kind, data):
        self.executed.append(f"event:{kind}")


def _link(client: _StubClient) -> VoicePELink:
    link = VoicePELink("pv-test.local", "psk", room="stue")
    link._client = client  # type: ignore[assignment]
    link._rearm_token = 0
    link._playback_token = 100

    def acknowledge_firmware(name: str, args: dict) -> None:
        if name == "podvoice_reply_expect":
            link._handle_playback_ack(f"{args['token']}:armed")
        elif name in ("podvoice_reply_cancel", "podvoice_reply_silence"):
            link._handle_playback_ack(f"{args['token']}:cancelled")

    client.service_hook = acknowledge_firmware
    return link


async def test_contract_ok_with_full_firmware(caplog):
    client = _StubClient(
        FULL_SERVICES,
        [
            MediaPlayerInfo("external_media_player", 7),
            LightInfo("led_ring", 9),
            TextSensorInfo("podvoice_rearm_ack", 4),
            TextSensorInfo("podvoice_playback_ack", 5),
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


async def test_stop_playback_uses_exact_firmware_owned_cancel():
    client = _StubClient(
        FULL_SERVICES,
        [MediaPlayerInfo("external_media_player", 7)],
    )
    link = _link(client)
    await link._resolve_entities()
    link._playback_expected_token = 100
    link._playback_expected_id = "reply"
    link._playback_phase = "started"
    link._announcing = True

    assert await link.stop_playback() is True
    assert client.executed == ["podvoice_reply_cancel"]
    assert link._announcing is False


async def test_stop_playback_waits_for_exact_drained_cancel_ack():
    client = _StubClient(FULL_SERVICES, [MediaPlayerInfo("external_media_player", 7)])
    link = _link(client)
    await link._resolve_entities()
    link._playback_expected_token = 100
    link._playback_expected_id = "reply"
    link._playback_phase = "started"
    link._announcing = True
    client.service_hook = None

    stop = asyncio.create_task(link.stop_playback())
    await asyncio.sleep(0)
    assert not stop.done()
    link._handle_playback_ack("99:cancelled")
    assert not stop.done()
    link._handle_playback_ack("100:cancelled")

    assert await stop is True
    assert link._announcing is False
    assert link._playback_expected_token is None


async def test_rebooted_device_cancel_fault_falls_back_to_orphan_silence():
    client = _StubClient(FULL_SERVICES, [MediaPlayerInfo("external_media_player", 7)])
    link = _link(client)
    await link._resolve_entities()
    link._playback_expected_token = 100
    link._playback_expected_id = "reply-before-reboot"
    link._playback_phase = "started"
    link._announcing = True

    def rebooted_firmware(name: str, args: dict) -> None:
        if name == "podvoice_reply_cancel":
            link._handle_playback_ack(f"{args['token']}:fault")
        elif name == "podvoice_reply_silence":
            link._handle_playback_ack(f"{args['token']}:cancelled")

    client.service_hook = rebooted_firmware
    assert await link.stop_playback() is False
    assert link._playback_expected_token is None
    assert await link.stop_playback() is True
    assert client.executed == ["podvoice_reply_cancel", "podvoice_reply_silence"]
    assert link._announcing is False


async def test_stop_playback_fails_closed_when_reply_cancel_cannot_be_sent():
    client = _StubClient(
        FULL_SERVICES,
        [MediaPlayerInfo("external_media_player", 7)],
    )
    link = _link(client)
    await link._resolve_entities()
    link._announcing = True

    async def refuse_cancel(_service, _args):
        raise ConnectionError("device disconnected")

    client.execute_service = refuse_cancel  # type: ignore[method-assign]

    assert await link.stop_playback() is False
    assert link._announcing is True


async def test_stop_playback_recovers_unknown_orphan_without_public_entity():
    client = _StubClient(FULL_SERVICES, [])
    link = _link(client)
    await link._resolve_entities()

    assert await link.stop_playback() is True
    assert client.executed == ["podvoice_reply_silence"]
    assert client.executed_args == [{"token": 100}]


async def test_contract_rejects_an_otherwise_complete_wrong_firmware_build():
    wrong_build = [
        capability
        for capability in FULL_CAPABILITIES
        if not capability.startswith("podvoice_build_")
    ] + ["podvoice_build_11342"]
    client = _StubClient(
        FULL_SERVICES,
        [
            MediaPlayerInfo("external_media_player", 7),
            TextSensorInfo("podvoice_rearm_ack", 4),
            TextSensorInfo("podvoice_playback_ack", 5),
            EventInfo("podvoice_event", 3, wrong_build),
        ],
    )
    link = _link(client)
    await link._resolve_entities()

    report = link._verify_contract()

    assert report["ok"] is False
    assert report["firmware_build"] == "podvoice_build_11342"
    assert report["missing_capabilities"] == ["podvoice_build_11345"]


async def test_contract_rejects_multiple_firmware_build_markers():
    capabilities = [*FULL_CAPABILITIES, "podvoice_build_11342"]
    client = _StubClient(
        FULL_SERVICES,
        [
            MediaPlayerInfo("external_media_player", 7),
            TextSensorInfo("podvoice_rearm_ack", 4),
            TextSensorInfo("podvoice_playback_ack", 5),
            EventInfo("podvoice_event", 3, capabilities),
        ],
    )
    link = _link(client)
    await link._resolve_entities()

    report = link._verify_contract()

    assert report["ok"] is False
    assert report["firmware_build"] is None
    assert report["firmware_builds"] == ["podvoice_build_11342", "podvoice_build_11345"]
    assert report["missing_capabilities"] == ["podvoice_build_11345"]


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
        "podvoice_reply_play",
        "podvoice_reply_silence",
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
        FULL_SERVICES,
        [
            MediaPlayerInfo("external_media_player", 7),
            LightInfo("led_ring", 9),
            TextSensorInfo("podvoice_rearm_ack", 4),
            TextSensorInfo("podvoice_playback_ack", 5),
            EventInfo("podvoice_event", 3, FULL_CAPABILITIES),
        ],
    )
    link = _link(client)
    states: list[bool] = []
    link.on_link = states.append
    await link._on_connect()
    assert states == [True]  # green only after a REAL completed connect
    await link._on_disconnect(expected_disconnect=False)
    assert states == [True, False]  # and honest about losing the device


async def test_full_admission_cancels_queued_same_generation_recovery():
    client = _ConnectableClient(
        FULL_SERVICES,
        [
            MediaPlayerInfo("external_media_player", 7),
            TextSensorInfo("podvoice_rearm_ack", 4),
            TextSensorInfo("podvoice_playback_ack", 5),
            EventInfo("podvoice_event", 3, FULL_CAPABILITIES),
        ],
    )
    client.connected_address = "192.168.86.193"
    link = _link(client)
    started = asyncio.Event()

    async def delayed_recovery():
        started.set()
        await asyncio.Event().wait()

    recovery = asyncio.create_task(delayed_recovery())
    link._recovery_task = recovery
    await started.wait()
    await link._on_connect()
    await asyncio.sleep(0)
    assert recovery.cancelled()
    assert link._recovery_token == 1


async def test_contract_rejection_has_zero_subscription_or_settings_side_effects():
    client = _ConnectableClient([], [])
    subscribed: list[str] = []
    client.subscribe_voice_assistant = lambda **kwargs: subscribed.append("voice")
    client.subscribe_states = lambda callback: subscribed.append("states")
    link = _link(client)
    link.mic_gain = 7
    link.wake_word = "hey_jarvis"
    with pytest.raises(RuntimeError, match="contract is not admitted"):
        await link._on_connect()
    assert subscribed == []
    assert client.executed == []


async def test_generation_admission_failure_force_disconnects_and_queues_bounded_recovery(
    monkeypatch,
):
    import sys
    import types

    from gatekeeper import voicepe as vp

    disconnects: list[bool] = []
    subscriptions: list[str] = []
    reconnects: list[object] = []
    recoveries: list[str] = []

    class Client:
        def __init__(self, address, port, password, **kwargs):
            self.address = address

        async def device_info(self):
            return SimpleNamespace(esphome_version="broken")

        async def list_entities_services(self):
            return [], []

        def subscribe_voice_assistant(self, **kwargs):
            subscriptions.append("voice")

        def subscribe_states(self, callback):
            subscriptions.append("states")

        async def disconnect(self, force=False):
            disconnects.append(force)

    class Reconnect:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            reconnects.append(self)

        async def start(self):
            return None

        async def stop(self):
            return None

    package = types.ModuleType("aioesphomeapi")
    package.APIClient = Client
    package.ReconnectLogic = Reconnect
    monkeypatch.setitem(sys.modules, "aioesphomeapi", package)

    link = vp.VoicePELink("pv.local", "psk", room="stue")
    monkeypatch.setattr(link, "_host_resolves", lambda: True)

    async def record_recovery(generation: int, error_kind: str, token: int):
        recoveries.append(error_kind)

    link._recover_address = record_recovery  # type: ignore[method-assign]
    await link.start()
    await reconnects[0].kwargs["on_connect"]()
    recovery = link._recovery_task
    assert recovery is not None
    await recovery
    assert disconnects == [True]
    assert subscriptions == []
    assert recoveries == ["_VoicePEAdmissionError"]
    assert link._link_up is False


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
        def __init__(self, address, port, password, noise_psk=None, expected_name=None):
            captured["address"] = address
            captured["expected_name"] = expected_name

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
    assert captured["expected_name"] == "pv"


async def test_stale_cached_ip_rotates_to_native_discovery_and_survives_next_dhcp_change(
    tmp_path, monkeypatch
):
    """Exact field chain: cached .162 refuses, the same .local identity appears at
    .193, later disconnects, and appears at .200. Each old generation is fully stopped
    before the next one starts; readiness follows only completed handshakes."""
    import json as _json
    import sys
    import types

    from gatekeeper import voicepe as vp

    cache = tmp_path / "ip.json"
    cache.write_text(_json.dumps({"pv.local": "192.168.86.162"}))
    monkeypatch.setattr(vp.VoicePELink, "_IP_CACHE", cache)
    monkeypatch.setattr(vp.VoicePELink, "_host_resolves", lambda self: False)
    monkeypatch.setattr(vp.VoicePELink, "_RECOVERY_BACKOFF_S", (0.0,))
    discovered = ["192.168.86.193"]
    events: list[str] = []
    clients: list[object] = []
    reconnects: list[object] = []
    service_calls: list[tuple[str, dict]] = []
    subscriptions: list[tuple[str, str]] = []
    reconnect_admission_entered = asyncio.Event()
    reconnect_admission_release = asyncio.Event()

    class SocketAPIError(Exception):
        pass

    class FakeClient:
        def __init__(self, address, port, password, noise_psk=None, expected_name=None):
            self.address = address
            self.connected_address = address
            self.expected_name = expected_name
            clients.append(self)

        async def disconnect(self, force=False):
            events.append(f"disconnect:{self.address}:{force}")

        async def device_info(self):
            return SimpleNamespace(esphome_version="2026.6.3")

        async def list_entities_services(self):
            return (
                [
                    MediaPlayerInfo("external_media_player", 7),
                    TextSensorInfo("podvoice_rearm_ack", 4),
                    TextSensorInfo("podvoice_playback_ack", 5),
                    EventInfo("podvoice_event", 3, FULL_CAPABILITIES),
                ],
                [
                    _Svc(name)
                    for name in [
                        *FULL_SERVICES,
                        "podvoice_set_mic_channel",
                        "podvoice_set_mic_gain",
                        "podvoice_set_wake_word",
                    ]
                ],
            )

        def subscribe_voice_assistant(self, **kwargs):
            subscriptions.append((self.address, "voice"))
            return lambda: events.append(f"unsub-va:{self.address}")

        def subscribe_states(self, callback):
            subscriptions.append((self.address, "states"))
            return lambda: events.append(f"unsub-states:{self.address}")

        async def execute_service(self, service, args):
            service_calls.append((service.name, dict(args)))

    class FakeReconnect:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.address = kwargs["client"].address
            reconnects.append(self)

        async def start(self):
            events.append(f"start:{self.address}")

        async def stop(self):
            events.append(f"stop:{self.address}")

    async def resolve(hosts, port, **kwargs):
        assert hosts == ["pv.local"]
        assert kwargs["timeout"] == 5.0
        return [(2, 1, 6, "", (discovered[0], port))]

    package = types.ModuleType("aioesphomeapi")
    package.__path__ = []
    package.APIClient = FakeClient
    package.ReconnectLogic = FakeReconnect
    resolver = types.ModuleType("aioesphomeapi.host_resolver")
    resolver.async_resolve_host = resolve
    monkeypatch.setitem(sys.modules, "aioesphomeapi", package)
    monkeypatch.setitem(sys.modules, "aioesphomeapi.host_resolver", resolver)

    link = vp.VoicePELink("pv.local", "psk", room="stue")
    states: list[bool] = []
    link.on_link = states.append
    link.mic_channel = 1
    link.mic_gain = 7
    link.wake_word = "hey_jarvis"

    async def physical_reconnect_admission():
        events.append("physical-reconnect-rearm")
        reconnect_admission_entered.set()
        await reconnect_admission_release.wait()

    link.on_reconnect = physical_reconnect_admission
    await link.start()
    assert clients[0].address == "192.168.86.162"
    assert clients[0].expected_name == "pv"

    await reconnects[0].kwargs["on_connect_error"](SocketAPIError("refused"))
    recovery = link._recovery_task
    assert recovery is not None
    await recovery
    assert [client.address for client in clients] == ["192.168.86.162", "192.168.86.193"]
    assert (
        events.index("stop:192.168.86.162")
        < events.index("disconnect:192.168.86.162:True")
        < events.index("start:192.168.86.193")
    )

    admitted = asyncio.create_task(reconnects[1].kwargs["on_connect"]())
    await reconnect_admission_entered.wait()
    assert states == []  # link remains false through tuning, wake and physical rearm
    assert subscriptions == [
        ("192.168.86.193", "voice"),
        ("192.168.86.193", "states"),
    ]
    assert service_calls == [
        ("podvoice_set_mic_channel", {"channel": 1}),
        ("podvoice_set_mic_gain", {"gain": 7}),
        ("podvoice_set_wake_word", {"name": "hey_jarvis"}),
    ]
    reconnect_admission_release.set()
    await admitted
    assert states == [True]
    assert _json.loads(cache.read_text())["pv.local"] == "192.168.86.193"

    # The refused .162 generation can report late/duplicate callbacks, but can neither
    # republish link state nor subscribe/recover after the admitted .193 generation.
    await reconnects[0].kwargs["on_disconnect"](False)
    await reconnects[0].kwargs["on_connect_error"](SocketAPIError("late"))
    await reconnects[0].kwargs["on_connect"]()
    assert states == [True]
    assert len(reconnects) == 2
    assert len(subscriptions) == 2

    await reconnects[1].kwargs["on_disconnect"](False)
    assert states == [True, False]
    discovered[0] = "192.168.86.200"
    await reconnects[1].kwargs["on_connect_error"](SocketAPIError("refused"))
    recovery = link._recovery_task
    assert recovery is not None
    await recovery
    await reconnects[2].kwargs["on_connect"]()
    assert states == [True, False, True]
    assert _json.loads(cache.read_text())["pv.local"] == "192.168.86.200"


def test_native_resolver_addrinfo_shape_yields_numeric_candidate():
    from aioesphomeapi.host_resolver import AddrInfo, IPv4Sockaddr

    result = VoicePELink._numeric_addresses(
        [AddrInfo(2, 1, 6, IPv4Sockaddr("192.168.86.193", 6053))]
    )
    assert result == ["192.168.86.193"]


async def test_discovery_failures_back_off_globally_then_later_rotate_once(monkeypatch):
    import sys
    import types

    from gatekeeper import voicepe as vp

    delays: list[float] = []
    resolver_calls = 0
    resolver_active = 0
    resolver_peak = 0
    clients: list[str] = []
    reconnects: list[object] = []

    async def no_wait(delay: float):
        delays.append(delay)

    monkeypatch.setattr(vp.asyncio, "sleep", no_wait)

    class SocketAPIError(Exception):
        pass

    class Client:
        def __init__(self, address, port, password, **kwargs):
            self.address = address
            clients.append(address)

        async def disconnect(self, force=False):
            return None

    class Reconnect:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            reconnects.append(self)

        async def start(self):
            return None

        async def stop(self):
            return None

    async def resolve(hosts, port, **kwargs):
        nonlocal resolver_calls, resolver_active, resolver_peak
        resolver_calls += 1
        resolver_active += 1
        resolver_peak = max(resolver_peak, resolver_active)
        try:
            if resolver_calls <= 6:
                return []
            return [(2, 1, 6, "", ("192.168.86.193", port))]
        finally:
            resolver_active -= 1

    package = types.ModuleType("aioesphomeapi")
    package.__path__ = []
    package.APIClient = Client
    package.ReconnectLogic = Reconnect
    resolver = types.ModuleType("aioesphomeapi.host_resolver")
    resolver.async_resolve_host = resolve
    monkeypatch.setitem(sys.modules, "aioesphomeapi", package)
    monkeypatch.setitem(sys.modules, "aioesphomeapi.host_resolver", resolver)

    link = vp.VoicePELink("pv.local", "psk", room="stue")
    monkeypatch.setattr(link, "_host_resolves", lambda: False)
    monkeypatch.setattr(link, "_load_cached_ip", lambda: "192.168.86.162")
    await link.start()
    for _ in range(7):
        await reconnects[0].kwargs["on_connect_error"](SocketAPIError("offline"))
        recovery = link._recovery_task
        assert recovery is not None
        await recovery
    assert delays[:7] == [1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 60.0]
    assert resolver_peak == 1
    assert clients == ["192.168.86.162", "192.168.86.193"]


async def test_auth_error_does_not_rotate_and_stale_generation_callbacks_are_inert(
    tmp_path, monkeypatch
):
    import json as _json
    import sys
    import types

    from gatekeeper import voicepe as vp

    cache = tmp_path / "ip.json"
    cache.write_text(_json.dumps({"pv.local": "192.168.86.162"}))
    monkeypatch.setattr(vp.VoicePELink, "_IP_CACHE", cache)
    monkeypatch.setattr(vp.VoicePELink, "_host_resolves", lambda self: False)
    monkeypatch.setattr(vp.VoicePELink, "_RECOVERY_BACKOFF_S", (0.0,))
    reconnects: list[object] = []

    class FakeClient:
        def __init__(self, address, port, password, **kwargs):
            self.address = address

        async def disconnect(self, force=False):
            return None

    class FakeReconnect:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            reconnects.append(self)

        async def start(self):
            return None

        async def stop(self):
            return None

    package = types.ModuleType("aioesphomeapi")
    package.__path__ = []
    package.APIClient = FakeClient
    package.ReconnectLogic = FakeReconnect
    monkeypatch.setitem(sys.modules, "aioesphomeapi", package)

    link = vp.VoicePELink("pv.local", "psk", room="stue")
    states: list[bool] = []
    link.on_link = states.append
    await link.start()
    generation = link._connection_generation
    InvalidEncryptionKeyAPIError = type("InvalidEncryptionKeyAPIError", (Exception,), {})
    await reconnects[0].kwargs["on_connect_error"](InvalidEncryptionKeyAPIError("bad psk"))
    assert link._recovery_task is None

    recoveries: list[tuple[int, str]] = []

    async def record_recovery(generation: int, error_kind: str, token: int):
        recoveries.append((generation, error_kind))

    link._recover_address = record_recovery  # type: ignore[method-assign]
    wrong_device = InvalidEncryptionKeyAPIError("wrong encrypted device")
    wrong_device.received_name = "some-other-esphome"
    await reconnects[0].kwargs["on_connect_error"](wrong_device)
    recovery = link._recovery_task
    assert recovery is not None
    await recovery
    assert recoveries == [(generation, "InvalidEncryptionKeyAPIError")]

    link._connection_generation += 1
    await reconnects[0].kwargs["on_disconnect"](False)
    assert states == []
    assert link._connection_generation == generation + 1


@pytest.mark.parametrize("cached", ["garbage", "0.0.0.0", "::", "224.0.0.1", "127.0.0.1"])
def test_unsafe_cached_addresses_are_never_used(tmp_path, monkeypatch, cached):
    import json as _json

    from gatekeeper import voicepe as vp

    cache = tmp_path / "ip.json"
    cache.write_text(_json.dumps({"pv.local": cached}))
    monkeypatch.setattr(vp.VoicePELink, "_IP_CACHE", cache)
    assert vp.VoicePELink("pv.local", "psk", room="stue")._load_cached_ip() == ""


async def test_generation_stop_force_disconnects_even_when_reconnect_stop_fails():
    calls: list[str] = []

    class Reconnect:
        async def stop(self):
            calls.append("stop")
            raise TimeoutError("stuck")

    class Client:
        async def disconnect(self, force=False):
            calls.append(f"disconnect:{force}")

    with pytest.raises(TimeoutError, match="stuck"):
        await VoicePELink._stop_connection_generation(Reconnect(), Client())
    assert calls == ["stop", "disconnect:True"] * 3


async def test_generation_cleanup_retries_before_any_new_client_can_start():
    calls: list[str] = []

    class Reconnect:
        attempts = 0

        async def stop(self):
            self.attempts += 1
            calls.append(f"stop:{self.attempts}")
            if self.attempts == 1:
                raise TimeoutError("transient")

    class Client:
        async def disconnect(self, force=False):
            calls.append(f"disconnect:{force}")

    await VoicePELink._stop_connection_generation(Reconnect(), Client())
    assert calls == ["stop:1", "disconnect:True", "stop:2", "disconnect:True"]


async def test_close_cancels_discovery_and_prevents_late_generation(tmp_path, monkeypatch):
    import json as _json
    import sys
    import types

    from gatekeeper import voicepe as vp

    cache = tmp_path / "ip.json"
    cache.write_text(_json.dumps({"pv.local": "192.168.86.162"}))
    monkeypatch.setattr(vp.VoicePELink, "_IP_CACHE", cache)
    monkeypatch.setattr(vp.VoicePELink, "_host_resolves", lambda self: False)
    monkeypatch.setattr(vp.VoicePELink, "_RECOVERY_BACKOFF_S", (0.0,))
    resolver_started = asyncio.Event()
    release_resolver = asyncio.Event()
    clients: list[object] = []
    reconnects: list[object] = []

    class SocketAPIError(Exception):
        pass

    class FakeClient:
        def __init__(self, address, port, password, **kwargs):
            self.address = address
            clients.append(self)

        async def disconnect(self, force=False):
            return None

    class FakeReconnect:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            reconnects.append(self)

        async def start(self):
            return None

        async def stop(self):
            return None

    async def resolve(hosts, port, **kwargs):
        assert kwargs["timeout"] == 5.0
        resolver_started.set()
        await release_resolver.wait()
        return [(2, 1, 6, "", ("192.168.86.193", port))]

    package = types.ModuleType("aioesphomeapi")
    package.__path__ = []
    package.APIClient = FakeClient
    package.ReconnectLogic = FakeReconnect
    resolver = types.ModuleType("aioesphomeapi.host_resolver")
    resolver.async_resolve_host = resolve
    monkeypatch.setitem(sys.modules, "aioesphomeapi", package)
    monkeypatch.setitem(sys.modules, "aioesphomeapi.host_resolver", resolver)

    link = vp.VoicePELink("pv.local", "psk", room="stue")
    await link.start()
    await reconnects[0].kwargs["on_connect_error"](SocketAPIError("refused"))
    await resolver_started.wait()
    await link.aclose()
    release_resolver.set()
    await asyncio.sleep(0)
    assert len(clients) == 1
    assert link._client is None


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
        "physical_rearm_ack_v1",
        "continuous_rearm_v1",
        "physical_rearm_audio_progress_v1",
        "correlated_reset_rearm_v2",
        "correlated_playback_v2",
        "podvoice_build_11345",
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


async def test_physical_rearm_ack_capability_is_read_from_firmware():
    client = _StubClient([], [EventInfo("podvoice_event", 3, REARM_CAPABILITIES)])
    link = _link(client)
    await link._resolve_entities()
    assert link.supports_physical_rearm_ack is True
    assert link.supports_continuous_rearm is True
    assert link.supports_rearm_audio_progress is True


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
    assert link._announcing is True  # disconnect cannot fabricate physical silence


async def test_correlated_playback_ack_carries_exact_playback_id():
    client = _StubClient(
        FULL_SERVICES,
        [
            MediaPlayerInfo("external_media_player", 7),
            TextSensorInfo("podvoice_playback_ack", 5),
            EventInfo("podvoice_event", 3, FULL_CAPABILITIES),
        ],
    )
    link = _link(client)
    await link._resolve_entities()
    edges: list[tuple[bool, str | None]] = []
    link.on_media_state = lambda state, playback_id=None: edges.append((state, playback_id))

    await link.play_url("http://podvoice.local/reply/r0.flac", playback_id="pv-play-7")
    link._on_state(TextSensorState("100:started", key=5))
    link._on_state(TextSensorState("100:finished", key=5))

    assert client.executed_args == [{"token": 100, "url": "http://podvoice.local/reply/r0.flac"}]
    assert edges == [(True, "pv-play-7"), (False, "pv-play-7")]
    assert link._playback_expected_token is None


async def test_correlated_playback_rejects_superseded_duplicate_and_out_of_order_edges():
    client = _StubClient(
        FULL_SERVICES,
        [
            MediaPlayerInfo("external_media_player", 7),
            TextSensorInfo("podvoice_playback_ack", 5),
            EventInfo("podvoice_event", 3, FULL_CAPABILITIES),
        ],
    )
    link = _link(client)
    await link._resolve_entities()
    edges: list[tuple[bool, str | None]] = []
    link.on_media_state = lambda state, playback_id=None: edges.append((state, playback_id))

    link._on_state(TextSensorState("99:finished", key=5))  # retained state before arm
    await link.play_url("http://podvoice.local/reply/a.flac", playback_id="A")
    assert await link.play_url("http://podvoice.local/reply/b.flac", playback_id="B") is False
    link._on_state(TextSensorState("100:started", key=5))
    link._on_state(TextSensorState("100:finished", key=5))
    assert await link.play_url("http://podvoice.local/reply/b.flac", playback_id="B") is True
    link._on_state(TextSensorState("100:finished", key=5))  # superseded token
    link._on_state(TextSensorState("101:finished", key=5))  # finish-before-start
    link._on_state(TextSensorState("101:started", key=5))
    link._on_state(TextSensorState("101:started", key=5))  # duplicate
    link._on_state(TextSensorState("101:finished", key=5))
    link._on_state(TextSensorState("101:finished", key=5))  # duplicate after clear

    assert edges == [(True, "A"), (False, "A"), (True, "B"), (False, "B")]


async def test_correlated_playback_fault_and_disconnect_fail_closed():
    client = _StubClient(
        FULL_SERVICES,
        [
            MediaPlayerInfo("external_media_player", 7),
            TextSensorInfo("podvoice_playback_ack", 5),
            EventInfo("podvoice_event", 3, FULL_CAPABILITIES),
        ],
    )
    link = _link(client)
    await link._resolve_entities()
    faults: list[str | None] = []
    link.on_playback_fault = faults.append

    await link.play_url("http://podvoice.local/reply/a.flac", playback_id="A")
    link._on_state(TextSensorState("999:fault", key=5))
    link._on_state(TextSensorState("100:fault", key=5))
    assert faults == ["A"]

    await link.play_url("http://podvoice.local/reply/b.flac", playback_id="B")
    await link._on_disconnect(expected_disconnect=True)
    link._on_state(TextSensorState("101:started", key=5))
    assert link._playback_expected_id == "B"
    assert link._playback_phase == "armed"
    assert faults == ["A"]


async def test_rearm_calls_the_dedicated_firmware_service():
    client = _StubClient(
        FULL_SERVICES,
        [
            TextSensorInfo("podvoice_rearm_ack", 4),
            EventInfo("podvoice_event", 3, REARM_CAPABILITIES),
        ],
    )
    link = _link(client)
    await link._resolve_entities()
    task = asyncio.create_task(link.rearm_wake_word())
    await asyncio.sleep(0)
    link._on_state(TextSensorState("0:recovered"))
    assert await task == "recovered"
    assert client.executed == ["podvoice_rearm_wake_word"]
    assert client.executed_args == [{"token": 0}]


def test_rearm_wait_budget_includes_silence_and_full_detector_recovery():
    root = Path(__file__).parents[2]
    voicepe_source = (root / "podvoice" / "gatekeeper" / "voicepe.py").read_text()
    thin_source = (root / "podvoice" / "gatekeeper" / "thin.py").read_text()
    firmware = (root / "esphome" / "podvoice.yaml").read_text()
    assert "await asyncio.wait_for(waiter.wait(), timeout=9.0)" in voicepe_source
    assert "TEARDOWN_REARM_TIMEOUT_S = 9.5" in thin_source
    rearm_silence = firmware.split("- id: podvoice_rearm_after_silence", 1)[1].split(
        "- id: podvoice_recover_wake_word", 1
    )[0]
    recovery = firmware.split("- id: podvoice_recover_wake_word", 1)[1].split(
        "- id: podvoice_finish_reply", 1
    )[0]
    assert "timeout: 3s" in rearm_silence
    assert "timeout: 2s" in recovery
    assert "timeout: 3s" in recovery


async def test_rearm_recovery_is_degraded_not_physical_proof():
    client = _StubClient(
        FULL_SERVICES,
        [
            TextSensorInfo("podvoice_rearm_ack", 4),
            EventInfo("podvoice_event", 3, REARM_CAPABILITIES),
        ],
    )
    link = _link(client)
    await link._resolve_entities()
    task = asyncio.create_task(link.rearm_wake_word())
    await asyncio.sleep(0)
    link._on_state(TextSensorState("0:recovered"))
    assert await task == "recovered"
    assert link.wake_readiness == "recovered"


async def test_rearm_fault_fails_immediately():
    client = _StubClient(
        FULL_SERVICES,
        [
            TextSensorInfo("podvoice_rearm_ack", 4),
            EventInfo("podvoice_event", 3, REARM_CAPABILITIES),
        ],
    )
    link = _link(client)
    await link._resolve_entities()
    task = asyncio.create_task(link.rearm_wake_word())
    await asyncio.sleep(0)
    link._on_state(TextSensorState("0:fault"))
    with pytest.raises(RuntimeError, match="recovery fejlede"):
        await task
    assert link.wake_readiness == "fault"


async def test_rearm_is_single_flight_and_ack_cannot_cross_calls():
    client = _StubClient(
        FULL_SERVICES,
        [
            TextSensorInfo("podvoice_rearm_ack", 4),
            EventInfo("podvoice_event", 3, REARM_CAPABILITIES),
        ],
    )
    link = _link(client)
    await link._resolve_entities()
    first = asyncio.create_task(link.rearm_wake_word())
    second = asyncio.create_task(link.rearm_wake_word())
    await asyncio.sleep(0)
    assert client.executed == ["podvoice_rearm_wake_word"]
    link._on_state(TextSensorState("0:recovered"))
    assert await first == "recovered"
    await asyncio.sleep(0)
    assert client.executed == ["podvoice_rearm_wake_word", "podvoice_rearm_wake_word"]
    link._on_state(TextSensorState("1:recovered"))
    assert await second == "recovered"


async def test_late_rearm_ack_cannot_settle_the_next_token():
    client = _StubClient(
        FULL_SERVICES,
        [
            TextSensorInfo("podvoice_rearm_ack", 4),
            EventInfo("podvoice_event", 3, REARM_CAPABILITIES),
        ],
    )
    link = _link(client)
    await link._resolve_entities()

    first = asyncio.create_task(link.rearm_wake_word())
    await asyncio.sleep(0)
    link._on_state(TextSensorState("0:recovered"))
    assert await first == "recovered"

    second = asyncio.create_task(link.rearm_wake_word())
    await asyncio.sleep(0)
    link._on_state(TextSensorState("0:recovered"))
    await asyncio.sleep(0)
    assert second.done() is False
    link._on_state(TextSensorState("1:recovered"))
    assert await second == "recovered"


async def test_disconnect_settles_pending_rearm_and_late_ack_is_ignored():
    client = _StubClient(
        FULL_SERVICES,
        [
            TextSensorInfo("podvoice_rearm_ack", 4),
            EventInfo("podvoice_event", 3, REARM_CAPABILITIES),
        ],
    )
    link = _link(client)
    await link._resolve_entities()
    task = asyncio.create_task(link.rearm_wake_word())
    await asyncio.sleep(0)
    await link._on_disconnect(expected_disconnect=True)
    # The stale state can arrive before the waiting coroutine gets its next event-loop
    # turn; it must not overwrite the terminal disconnect outcome.
    link._on_state(TextSensorState("0:recovered"))
    with pytest.raises(RuntimeError, match="forsvandt"):
        await task
    assert link.wake_readiness == "fault"


async def test_mic_queue_keeps_the_end_of_a_long_request_on_backpressure():
    link = VoicePELink("pv-test.local", "psk", room="stue")
    for number in range(601):
        await link._handle_audio(number.to_bytes(2, "little"))
    assert link._audio_q.qsize() == 600
    assert await link._audio_q.get() == (1).to_bytes(2, "little")
    newest = b""
    while not link._audio_q.empty():
        newest = link._audio_q.get_nowait()
    assert newest == (600).to_bytes(2, "little")


async def test_correlated_reply_uses_one_device_owned_play_command():
    client = _StubClient(
        FULL_SERVICES,
        [
            MediaPlayerInfo("external_media_player", 7),
            TextSensorInfo("podvoice_rearm_ack", 4),
            TextSensorInfo("podvoice_playback_ack", 5),
            EventInfo("podvoice_event", 3, FULL_CAPABILITIES),
        ],
    )
    link = _link(client)
    await link._resolve_entities()
    await link.play_url("http://podvoice.local/reply/r0.flac", playback_id="pv-play-1")
    assert client.executed == ["podvoice_reply_play"]
    assert client.executed_args == [{"token": 100, "url": "http://podvoice.local/reply/r0.flac"}]


async def test_foreign_announcement_fault_ack_prevents_bus_mutation_and_reply_command():
    client = _StubClient(
        FULL_SERVICES,
        [
            MediaPlayerInfo("external_media_player", 7),
            TextSensorInfo("podvoice_playback_ack", 5),
            EventInfo("podvoice_event", 3, FULL_CAPABILITIES),
        ],
    )
    link = _link(client)
    await link._resolve_entities()
    client.service_hook = lambda name, args: (
        link._handle_playback_ack(f"{args['token']}:fault")
        if name == "podvoice_reply_expect"
        else None
    )
    prepared: list[str] = []

    played = await link.play_uncorrelated("timer", lambda: prepared.append("bus-mutated"))

    assert played is False
    assert prepared == []
    assert client.executed == ["podvoice_reply_expect"]
    assert client.executed_args == [{"token": 100}]
    assert link._playback_expected_token is None


async def test_foreign_start_after_reservation_faults_before_device_owned_launch():
    client = _StubClient(
        FULL_SERVICES,
        [
            MediaPlayerInfo("external_media_player", 7),
            TextSensorInfo("podvoice_playback_ack", 5),
            EventInfo("podvoice_event", 3, FULL_CAPABILITIES),
        ],
    )
    link = _link(client)
    await link._resolve_entities()
    edges: list[tuple[bool, str]] = []
    link.on_media_state = lambda playing, playback_id: edges.append((playing, playback_id))

    def interleave_foreign_start(name: str, args: dict) -> None:
        if name == "podvoice_reply_expect":
            link._handle_playback_ack(f"{args['token']}:armed")
        elif name == "podvoice_reply_play":
            link._handle_playback_ack(f"{args['token']}:fault")

    client.service_hook = interleave_foreign_start
    assert await link.play_uncorrelated("reply", lambda: None) is False
    link._handle_playback_ack("100:started")
    link._handle_playback_ack("100:finished")

    assert client.executed == ["podvoice_reply_expect", "podvoice_reply_play"]
    assert edges == []
    assert link._playback_expected_token is None


async def test_missing_arm_ack_times_out_without_bus_mutation_or_media_command():
    client = _StubClient(
        FULL_SERVICES,
        [
            MediaPlayerInfo("external_media_player", 7),
            TextSensorInfo("podvoice_playback_ack", 5),
            EventInfo("podvoice_event", 3, FULL_CAPABILITIES),
        ],
    )
    link = _link(client)
    await link._resolve_entities()
    client.service_hook = None
    prepared: list[str] = []

    played = await link.play_uncorrelated("timer", lambda: prepared.append("bus-mutated"))

    assert played is False
    assert prepared == []
    assert client.executed == ["podvoice_reply_expect", "podvoice_reply_cancel"]
    assert client.executed_args == [{"token": 100}, {"token": 100}]
    assert link._playback_expected_token is None


async def test_uncorrelated_timer_announcement_plays_only_without_active_reply_lease():
    client = _StubClient(
        FULL_SERVICES,
        [
            MediaPlayerInfo("external_media_player", 7),
            TextSensorInfo("podvoice_rearm_ack", 4),
            TextSensorInfo("podvoice_playback_ack", 5),
            EventInfo("podvoice_event", 3, FULL_CAPABILITIES),
        ],
    )
    link = _link(client)
    await link._resolve_entities()
    reply_edges: list[tuple[bool, str]] = []
    link.on_media_state = lambda playing, playback_id: reply_edges.append((playing, playback_id))
    assert await link.play_url("http://podvoice.local/timer.flac") is True
    assert client.executed == ["podvoice_reply_expect", "podvoice_reply_play"]
    assert client.executed_args == [
        {"token": 100},
        {"token": 100, "url": "http://podvoice.local/timer.flac"},
    ]

    # The timer owns the sole player until its exact auxiliary token finishes.
    assert (
        await link.play_url("http://podvoice.local/reply/r0.flac", playback_id="blocked-reply")
        is False
    )
    link._on_state(TextSensorState("100:started", key=5))
    link._on_state(TextSensorState("100:finished", key=5))
    assert reply_edges == []
    assert link._playback_expected_token is None

    assert (
        await link.play_url("http://podvoice.local/reply/r0.flac", playback_id="active-reply")
        is True
    )
    expected = (link._playback_expected_token, link._playback_expected_id, link._playback_phase)
    prepared: list[str] = []
    assert (
        await link.play_uncorrelated(
            "http://podvoice.local/timer.flac", lambda: prepared.append("mutated-bus")
        )
        is False
    )
    assert prepared == []

    assert client.executed == [
        "podvoice_reply_expect",
        "podvoice_reply_play",
        "podvoice_reply_play",
    ]
    assert client.executed_args == [
        {"token": 100},
        {"token": 100, "url": "http://podvoice.local/timer.flac"},
        {"token": 101, "url": "http://podvoice.local/reply/r0.flac"},
    ]
    assert (
        link._playback_expected_token,
        link._playback_expected_id,
        link._playback_phase,
    ) == expected


async def test_uncorrelated_timer_is_cancelled_before_next_reply_and_old_ack_is_inert():
    client = _StubClient(
        FULL_SERVICES,
        [
            MediaPlayerInfo("external_media_player", 7),
            TextSensorInfo("podvoice_rearm_ack", 4),
            TextSensorInfo("podvoice_playback_ack", 5),
            EventInfo("podvoice_event", 3, FULL_CAPABILITIES),
        ],
    )
    link = _link(client)
    await link._resolve_entities()
    prepared: list[str] = []

    assert await link.play_uncorrelated("timer", lambda: prepared.append("timer")) is True
    assert await link.stop_uncorrelated_playback() is True
    assert link._playback_expected_token is None
    assert await link.play_url("reply", playback_id="reply-after-timer") is True
    link._on_state(TextSensorState("100:started", key=5))
    link._on_state(TextSensorState("100:finished", key=5))
    assert link._playback_expected_token == 101
    assert link._playback_expected_id == "reply-after-timer"
    assert link._playback_phase == "armed"
    assert client.executed == [
        "podvoice_reply_expect",
        "podvoice_reply_play",
        "podvoice_reply_cancel",
        "podvoice_reply_play",
    ]
    assert client.executed_args == [
        {"token": 100},
        {"token": 100, "url": "timer"},
        {"token": 100},
        {"token": 101, "url": "reply"},
    ]


async def test_correlated_reply_fails_closed_when_device_play_service_fails():
    client = _StubClient(FULL_SERVICES, [MediaPlayerInfo("external_media_player", 7)])
    link = _link(client)
    await link._resolve_entities()

    async def refuse_arm(_service, _args):
        raise ConnectionError("device disconnected")

    client.execute_service = refuse_arm  # type: ignore[method-assign]
    await link.play_url("http://podvoice.local/reply/r0.flac", playback_id="reply")

    assert client.executed == []
    assert link._playback_expected_token is None


async def test_stream_service_results_are_not_discarded():
    client = _StubClient(FULL_SERVICES, [])
    link = _link(client)
    await link._resolve_entities()

    assert await link.start_streaming() is True
    assert await link.stop_streaming() is True
    assert client.executed == ["podvoice_stream_start", "podvoice_stream_stop"]

    link._user_services.pop("podvoice_stream_start")
    assert await link.start_streaming() is False


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
        [*FULL_SERVICES, "podvoice_set_wake_word"],
        [
            MediaPlayerInfo("external_media_player", 7),
            LightInfo("led_ring", 9),
            TextSensorInfo("podvoice_rearm_ack", 4),
            TextSensorInfo("podvoice_playback_ack", 5),
            EventInfo("podvoice_event", 3, FULL_CAPABILITIES),
        ],
    )
    link = _link(client)
    link.wake_word = "hey_jarvis"
    await link._on_connect()
    assert client.executed.count("podvoice_set_wake_word") == 1
    await link._on_connect()  # e.g. after a reboot
    assert client.executed.count("podvoice_set_wake_word") == 2
