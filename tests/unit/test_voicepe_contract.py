"""Firmware-contract verification: the add-on must LOUDLY report any mismatch between
what it assumes (services/entities) and what the flashed firmware actually publishes.
The 0.82 lesson: a missing service silently no-op'ed and hid the repeated-wake bug."""

from __future__ import annotations

import logging

from gatekeeper.voicepe import VoicePELink


class _Svc:
    def __init__(self, name: str) -> None:
        self.name = name


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


def _link(client: _StubClient) -> VoicePELink:
    link = VoicePELink("pv-test.local", "psk", room="stue")
    link._client = client  # type: ignore[assignment]
    return link


async def test_contract_ok_with_full_firmware(caplog):
    client = _StubClient(
        ["podvoice_stream_start", "podvoice_stream_stop"],
        [MediaPlayerInfo("external_media_player", 7), LightInfo("led_ring", 9)],
    )
    link = _link(client)
    await link._resolve_entities()
    with caplog.at_level(logging.WARNING, logger="gatekeeper.voicepe"):
        report = link._verify_contract()
    assert report["ok"] is True
    assert report["missing_required"] == []
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
    assert report["missing_required"] == ["podvoice_stream_start"]
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
    assert captured["address"] == ["pv.local", "192.168.86.140"]
