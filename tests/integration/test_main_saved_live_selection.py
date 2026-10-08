"""Run-owned saved selection over actual main, native Thin and Talk, inert I/O."""

from __future__ import annotations

import asyncio
import json
import os

import pytest
from integration.test_main_settings_save_contract import (
    _active_contract,
    _actual_main_app,
    _device_contract,
    _observed,
    _preferences,
)
from integration.test_talk_webrtc import BrowserWire
from integration.test_thin_live_ten_cycles import (
    CycleWireSDK,
    close_fixture,
    retain_aclose_observers,
)
from unit.test_provider_ack_readiness import _QueueWS

from gatekeeper import __main__ as main
from gatekeeper import settings as S
from gatekeeper.provider_budget import ProviderBudgetCoordinator
from gatekeeper.talk import run_talk
from gatekeeper.web import TALK


def _fault(path, kind):
    if kind == "missing":
        path.unlink()
    else:
        path.write_text(
            {
                "corrupt": "{broken",
                "future": '{"settings_version":12,"live_alpha":false}',
                "nonfinite": '{"settings_version":11,"live_alpha":false,"vad_threshold":1e309}',
            }[kind]
        )


@pytest.mark.parametrize("initial_live", [False, True])
async def test_actual_run_retains_verified_selection_across_fault_and_restores_next_native_wake(
    tmp_path, monkeypatch, initial_live
):
    path, options = tmp_path / "settings.json", tmp_path / "options.json"
    options.write_text(json.dumps({"openai_api_key": "inert-settings-contract"}))
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    original = _preferences(path, initial_live)
    async with _actual_main_app(monkeypatch, tmp_path / "boot", options) as actual:
        session = actual.sessions["kitchen"]
        selected = session.live_enabled
        assert actual.cfg.live_alpha is initial_live and actual.cfg.settings_path == path
        assert all(s.live_enabled is selected for s in actual.sessions.values())
        for kind in ("corrupt", "future", "nonfinite", "missing"):
            path.write_text(json.dumps(original))
            _fault(path, kind)
            assert S.load_settings(path, require_existing=True)["settings_source_untrusted"]
            assert selected() is initial_live
        async with asyncio.timeout(20):
            await session.wake()
        assert session._active and session.live_alpha is initial_live
        active = _active_contract(session)
        path.write_text(json.dumps({**original, "live_alpha": not initial_live}))
        assert selected() is (not initial_live)
        await session.wake()  # an active owner does not switch engines
        assert _active_contract(session) == active
        old_epoch, old_generation = session._epoch, session.voicepe.audio_generation
        retired_brain, retired_generation = session.brain, session.brain._connection_generation
        async with asyncio.timeout(15):
            await session.stop()
        assert not session._teardown_incomplete and session.voicepe.rearm_calls == 1
        async with asyncio.timeout(20):
            await session.wake()
        assert session.live_alpha is (not initial_live) and session._epoch > old_epoch
        assert session.voicepe.audio_generation > old_generation
        fresh = _active_contract(session)
        if initial_live:
            # Retained old adapter callback, with the retired connection identity.
            await retired_brain._handle(
                {
                    "type": "session.input_transcript.delta",
                    "delta": "retired",
                    "start_ms": 0,
                    "end_ms": 1,
                },
                retired_generation,
            )
            await retired_brain._handle(
                {"type": "session.closed", "reason": "close_requested"}, retired_generation
            )
        session._on_media_state(False, "retired-playback")
        assert _active_contract(session) == fresh and session._active
        assert not actual.forbidden


@pytest.mark.parametrize("initial_live", [False, True])
async def test_actual_committed_save_updates_selection_before_fault_and_first_wake(
    tmp_path, monkeypatch, initial_live
):
    path, options = tmp_path / "settings.json", tmp_path / "options.json"
    options.write_text(json.dumps({"openai_api_key": "inert-settings-contract"}))
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    _preferences(path, initial_live)
    original_bytes = path.read_bytes()
    async with _actual_main_app(monkeypatch, tmp_path / "boot", options) as actual:
        session = actual.sessions["kitchen"]
        selected = session.live_enabled
        device, count = _device_contract(actual.tools), len(actual.configure_calls)
        response = await actual.client.post("/api/settings", json={"live_alpha": "true"})
        assert response.status == 400
        replace = os.replace

        def deny(source, destination):
            if destination == path:
                raise PermissionError("inert source refusal")
            return replace(source, destination)

        with monkeypatch.context() as selected_patch:
            selected_patch.setattr(os, "replace", deny)
            response = await actual.client.post(
                "/api/settings", json={"live_alpha": not initial_live}
            )
        assert response.status == 503
        assert len(actual.configure_calls) == count and _device_contract(actual.tools) == device
        _fault(path, "corrupt")
        assert selected() is initial_live  # failed Save did not change the retained bit
        # Restore the exact source; commit the opposite mode, without an intervening reader.
        path.write_bytes(original_bytes)
        assert path.read_bytes() == original_bytes
        response = await actual.client.post("/api/settings", json={"live_alpha": not initial_live})
        assert response.status == 200
        _fault(path, "missing")
        async with asyncio.timeout(20):
            await session.wake()
        assert session._active and session.live_alpha is (not initial_live)
        assert actual.cfg.live_alpha is initial_live  # boot snapshot stays immutable
        assert not actual.forbidden


@pytest.mark.parametrize("initial_live", [False, True])
async def test_actual_config_to_run_fault_keeps_same_snapshot_and_absolute_address(
    tmp_path, monkeypatch, initial_live
):
    path, options = tmp_path / "settings.json", tmp_path / "options.json"
    other = tmp_path / "other.json"
    options.write_text(json.dumps({"openai_api_key": "inert-settings-contract"}))
    original = _preferences(path, initial_live)
    _preferences(other, not initial_live)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("PODVOICE_SETTINGS", "settings.json")
    run, prepare = main.run, main._prepare_saved_live_alpha
    prepared, reads, diagnoses = [], [], []
    read = main.load_settings

    def observed_read(path=None, **kwargs):
        reads.append(path)
        return read(path, **kwargs)

    async def diagnostic(host, psk):
        diagnoses.append((host, psk))
        return {"ok": True}

    async def observed_prepare(enabled):
        prepared.append(enabled)
        await prepare(enabled)

    async def fault_after_config(cfg):
        assert cfg.settings_path == path and cfg.live_alpha is initial_live
        _fault(path, "corrupt")
        monkeypatch.setenv("PODVOICE_SETTINGS", str(other))
        await run(cfg)

    monkeypatch.setattr(main, "run", fault_after_config)
    monkeypatch.setattr(main, "load_settings", observed_read)
    monkeypatch.setattr(main, "check_status", diagnostic)
    monkeypatch.setattr(main, "run_s2", diagnostic)
    monkeypatch.setattr(main, "_prepare_saved_live_alpha", observed_prepare)
    async with _actual_main_app(monkeypatch, tmp_path / "boot", options) as actual:
        session = actual.sessions["kitchen"]
        assert prepared == [initial_live] and session.live_enabled() is initial_live
        response = await actual.client.get("/api/settings")
        assert response.status == 409  # GET uses the original address, not the env replacement
        original_other = other.read_bytes()
        response = await actual.client.post("/api/settings", json={"live_alpha": not initial_live})
        assert response.status == 400 and other.read_bytes() == original_other
        path.write_text(json.dumps(original))
        response = await actual.client.post("/api/settings", json={"live_alpha": not initial_live})
        assert response.status == 200 and other.read_bytes() == original_other
        assert S.load_settings(path)["live_alpha"] is (not initial_live)
        assert (await actual.client.get("/api/voicepe/status?room=kitchen")).status == 200
        assert (await actual.client.post("/api/voicepe/s2?room=kitchen")).status == 200
        assert diagnoses == [("fixture-one.local", ""), ("fixture-one.local", "")]
        assert reads and all(address == path for address in reads)
        async with asyncio.timeout(20):
            await session.wake()
        assert session.live_alpha is (not initial_live)
    # Separate actual run has its own seed and fixed path; no process-global last bit.
    monkeypatch.setattr(main, "run", run)
    monkeypatch.setenv("PODVOICE_SETTINGS", str(other))
    _preferences(other, initial_live)
    async with _actual_main_app(monkeypatch, tmp_path / "other-boot", options) as actual:
        assert actual.cfg.settings_path == other and actual.cfg.live_alpha is initial_live
        assert actual.sessions["kitchen"].live_enabled() is initial_live


@pytest.mark.parametrize("initial_live", [False, True])
async def test_actual_missing_empty_and_known_room_fault_have_distinct_selection_policy(
    tmp_path, monkeypatch, initial_live
):
    path, options = tmp_path / "settings.json", tmp_path / "options.json"
    options.write_text(json.dumps({"openai_api_key": "inert-settings-contract"}))
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    _preferences(path, initial_live)
    async with _actual_main_app(monkeypatch, tmp_path / "boot", options) as actual:
        selected = actual.sessions["kitchen"].live_enabled
        path.unlink()
        assert S.load_settings(path)["live_alpha"] is False  # normal first-file API policy
        assert selected() is initial_live  # post-boot missing is not a trusted projection
        path.write_text("{}")
        assert selected() is False  # present empty object retains the documented default
        for malformed in ("true", 1, None, [], {}):
            path.write_text(json.dumps({"live_alpha": malformed}))
            assert selected() is False  # existing explicit boolean normalization
        path.write_text(json.dumps({"live_alpha": initial_live, "rooms": [None]}))
        assert not S.load_settings(path).get("settings_source_untrusted")
        assert selected() is initial_live  # bad room rows do not redefine a valid preference
    # A fresh run still admits no physical room owner from those known-invalid rows.
    async with _actual_main_app(monkeypatch, tmp_path / "room-fault", options) as actual:
        assert not actual.sessions and actual.cfg.live_alpha is initial_live
        assert callable(actual.app[TALK])


@pytest.mark.parametrize("initial_live", [False, True])
@pytest.mark.parametrize("first", ["wake", "text"])
async def test_actual_main_talk_mic_and_typed_share_saved_selection_and_fence_retired_peer(
    tmp_path, monkeypatch, initial_live, first
):
    path, options = tmp_path / "settings.json", tmp_path / "options.json"
    options.write_text(json.dumps({"openai_api_key": "inert-settings-contract"}))
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    original = _preferences(path, initial_live)
    async with _actual_main_app(monkeypatch, tmp_path / "boot", options) as actual:
        wire, observers, sdks = BrowserWire(), [], []
        session, link = actual.app[TALK](wire.send_json, wire.send_bytes)
        assert session.live_enabled is actual.sessions["kitchen"].live_enabled
        # Keep the existing inert wire and actual Realtime parser/readiness owner.
        # Only the peer response is supplied; never resolve the pending ACK future.
        realtime = session._realtime_brain
        ack_rows, provider_events = [], []
        original_observer, original_send = realtime.provider_observer, _QueueWS.send_json

        def provenance(row):
            provider_events.append(dict(row))
            if original_observer is not None:
                original_observer(row)

        async def acknowledge_sent_item(socket, payload):
            await original_send(socket, payload)
            item = payload.get("item", {})
            if (
                payload.get("type") == "conversation.item.create"
                and item.get("type") == "message"
                and item.get("role") == "user"
            ):
                assert socket is realtime._ws
                generation = realtime._connection_generation
                event = {
                    "type": "conversation.item.added",
                    "event_id": "inert-ack-" + payload["event_id"],
                    "item": dict(item),
                }
                ack_rows.append((socket, generation, item["id"], event))
                await socket.emit(event)

        monkeypatch.setattr(realtime, "provider_observer", provenance)
        monkeypatch.setattr(_QueueWS, "send_json", acknowledge_sent_item)
        session.live_brain.provider_budget = ProviderBudgetCoordinator()
        session._realtime_brain.provider_budget = session.live_brain.provider_budget

        def factory(**kwargs):
            sdk = CycleWireSDK(webrtc=True)
            sdk.allow_exit.set()
            wire.sdk = sdk
            sdks.append(sdk)
            return sdk.factory(**kwargs)

        session.live_brain.client_factory = factory
        retain_aclose_observers(session, observers, monkeypatch)
        task = asyncio.create_task(run_talk(wire, session, link), name="settings-actual-talk")
        failure = None
        try:
            _fault(path, "corrupt")
            wire.send(first, command_id="first", text="inert typed fixture")
            await _observed(lambda: wire.result("first") is not None, main_task=task)
            assert wire.result("first")["status"] in {"accepted", "submitted"}
            assert session._active and session.live_alpha is initial_live
            if initial_live:
                assert link._live_handshake is not None and link._live_handshake.valid
                assert sdks and sdks[-1].wire  # actual SDK serializer/parser, inert peer
            active = session.brain, session._epoch, session.live_alpha
            old_peer = link._live_handshake
            path.write_text(json.dumps({**original, "live_alpha": not initial_live}))
            assert session.live_enabled() is (not initial_live)
            assert (session.brain, session._epoch, session.live_alpha) == active
            wire.send("stop", command_id="old-stop")
            await _observed(lambda: wire.result("old-stop") is not None, main_task=task)
            assert wire.result("old-stop")["status"] == "accepted"
            assert not session._active and not session._teardown_incomplete
            wire.send(
                "text" if first == "wake" else "wake", command_id="fresh", text="fresh fixture"
            )
            await _observed(lambda: wire.result("fresh") is not None, main_task=task)
            assert wire.result("fresh")["status"] in {"accepted", "submitted"}
            assert session._active and session.live_alpha is (not initial_live)
            fresh = session.brain, session._epoch, session.live_alpha, link._live_handshake
            if old_peer is not None:
                wire.send("live_fault", attempt_id=old_peer.attempt_id)
                wire.primary_started(
                    {
                        "attempt_id": old_peer.attempt_id,
                        "provider_session_id": old_peer.provider_session_id,
                        "generation": old_peer.generation,
                    }
                )
            wire.send("stop", command_id="old-stop")  # retired command receipt is not a new close
            wire.send("ping", ping_id="retired-input-processed")
            await _observed(
                lambda: any(e.get("ping_id") == "retired-input-processed" for e in wire.outgoing),
                main_task=task,
            )
            assert (
                session.brain,
                session._epoch,
                session.live_alpha,
                link._live_handshake,
            ) == fresh
            assert session._active and not actual.forbidden
            typed_command = "first" if first == "text" else "fresh"
            typed_live = initial_live if first == "text" else not initial_live
            assert len(ack_rows) == int(not typed_live)
            if typed_live:
                assert wire.result(typed_command)["status"] == "submitted"
            else:
                assert wire.result(typed_command)["status"] == "accepted"
                socket, generation, item_id, ack = ack_rows[0]
                assert ack["item"]["id"] == item_id and ack["item"]["type"] == "message"
                assert ack["item"]["role"] == "user"
                assert socket in [owner.ws for owner in actual.realtime_http]
                added = [row for row in provider_events if row["kind"] == "conversation_item_added"]
                accepted = [row for row in provider_events if row["kind"] == "accepted_input_turn"]
                assert any(
                    row["item_id"] == item_id
                    and row["generation"] == generation
                    and row["provider_event_type"] == "conversation.item.added"
                    for row in added
                )
                assert any(
                    row["committed_item_id"] == item_id
                    and row["root_item_id"] == item_id
                    and row["generation"] == generation
                    and row["input_kind"] == "text"
                    for row in accepted
                )
        except BaseException as exc:
            failure = exc
            raise
        finally:
            try:
                await close_fixture(session, sdks, observers, wire=wire, talk_task=task)
                assert session._realtime_brain._ws is None and session._realtime_brain._http is None
            except BaseException as exc:
                if failure is None:
                    raise
                failure.add_note(f"actual Talk cleanup: {exc!r}")
