"""Scope, idempotency and expiry custody; these are not Core/audio acceptance."""

import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest

SOURCE = Path(__file__).resolve().parents[2] / "custom_components/podvoice/timer_bridge.py"
spec = importlib.util.spec_from_file_location("podvoice_ha_timer_bridge", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
TimerBridge = module.TimerBridge


class CoreTimers:
    def __init__(self):
        self.timers = {}
        self.handlers = {}
        self.starts = 0

    def is_timer_device(self, device):
        return device in self.handlers

    def register_handler(self, device, handler):
        self.handlers[device] = handler
        return lambda: self.handlers.pop(device)

    def start_timer(self, device, hours, minutes, seconds, language, name=None):
        assert hours is minutes is None
        self.starts += 1
        timer = SimpleNamespace(
            id=str(self.starts),
            device_id=device,
            name=name,
            seconds_left=seconds,
            is_active=True,
            conversation_command=None,
        )
        self.timers[timer.id] = timer
        self.handlers[device]("started", timer)
        return timer.id

    def cancel_timer(self, timer_id):
        timer = self.timers.pop(timer_id)
        self.handlers[timer.device_id]("cancelled", timer)

    def finish(self, timer_id):
        timer = self.timers.pop(timer_id)
        timer.seconds_left, timer.is_active = 0, False
        self.handlers[timer.device_id]("finished", timer)
        return timer


@pytest.fixture
def bridge():
    return TimerBridge(CoreTimers(), {"kitchen": "ha-kitchen", "talk": "ha-talk"})


def command(bridge, request="call-one", **kwargs):
    return bridge.command(endpoint="kitchen", epoch=bridge.epoch, request_id=request, **kwargs)


def test_duplicate_conflict_and_new_core_epoch_do_not_repeat(bridge):
    result = command(bridge, action="start", seconds=30, name="pasta")
    assert command(bridge, action="start", seconds=30, name="pasta") == result
    assert command(bridge, action="start", seconds=31)["error"] == "request_id_conflict"
    restarted = TimerBridge(CoreTimers(), {"kitchen": "new-ha-device"})
    stale = restarted.command(
        endpoint="kitchen", epoch=bridge.epoch, request_id="call-one", action="start", seconds=30
    )
    assert stale["outcome"] == "unknown" and stale["retry_allowed"] is False
    assert restarted.manager.starts == 0 and bridge.manager.starts == 1


def test_multiple_same_name_require_exact_id_and_cannot_cross_device(bridge):
    one = command(bridge, action="start", seconds=20, name="pasta")
    two = command(bridge, "two", action="start", seconds=50, name="pasta")
    talk = bridge.command(
        endpoint="talk", epoch=bridge.epoch, request_id="talk", action="start", seconds=10
    )
    assert len(bridge.snapshot("kitchen")["timers"]) == 2
    assert command(bridge, "bad", action="cancel")["error"] == "exact_timer_id_required"
    assert (
        command(bridge, "foreign", action="cancel", timer_id=talk["id"])["error"]
        == "timer_not_found"
    )
    assert command(bridge, "stop", action="cancel", timer_id=one["id"])["state"] == "cancelled"
    assert [x["id"] for x in bridge.snapshot("kitchen")["timers"]] == [two["id"]]
    assert bridge.snapshot("talk")["timers"][0]["id"] == talk["id"]


def test_expiry_survives_client_disconnect_and_stop_is_not_physical_ack(bridge):
    created = command(bridge, action="start", seconds=1)
    timer = bridge.manager.finish(created["id"])
    bridge.manager.handlers["ha-kitchen"]("finished", timer)  # duplicate callback
    state = bridge.snapshot("kitchen")
    assert state["timers"] == [] and len(state["finished"]) == 1
    stopped = command(bridge, "stop", action="cancel", timer_id=timer.id)
    assert stopped["physical_stop_confirmed"] is False
    assert bridge.snapshot("kitchen")["finished"][0]["stop_requested"] is True
    command(bridge, "drain", action="acknowledge_finished", timer_id=timer.id)
    bridge.manager.handlers["ha-kitchen"]("finished", timer)
    assert bridge.snapshot("kitchen")["finished"] == []


def test_close_ignores_held_stale_handler_and_does_not_cancel_core_timer(bridge):
    created = command(bridge, action="start", seconds=60)
    handler = bridge.manager.handlers["ha-kitchen"]
    timer = bridge.manager.timers[created["id"]]
    bridge.close()
    handler("finished", timer)
    assert created["id"] in bridge.manager.timers
    assert bridge._finished["kitchen"] == {}
    assert bridge.snapshot("kitchen")["error"] == "endpoint_unavailable"


def test_existing_native_handler_is_never_overwritten():
    manager = CoreTimers()

    def old(event, timer):
        pass

    manager.handlers["ha-device"] = old
    with pytest.raises(ValueError, match="already has a handler"):
        TimerBridge(manager, {"kitchen": "ha-device"})
    assert manager.handlers["ha-device"] is old


@pytest.mark.parametrize("duration", [True, False, 0, -1, 86401, 1.5, "10"])
def test_duration_rejected_before_any_native_side_effect(bridge, duration):
    assert command(bridge, action="start", seconds=duration)["error"] == "invalid_duration"
    assert bridge.manager.starts == 0


def test_full_request_ledger_never_evicts_old_side_effect_receipts(bridge, monkeypatch):
    monkeypatch.setattr(module, "MAX_REQUESTS", 1)
    first = command(bridge, action="start", seconds=20)
    assert command(bridge, "new", action="start", seconds=20)["error"] == "request_ledger_full"
    assert command(bridge, action="start", seconds=20) == first
    assert bridge.manager.starts == 1


def test_partial_native_failure_keeps_tombstone_and_never_replays(bridge, monkeypatch):
    native = bridge.manager.start_timer

    def partial(*args, **kwargs):
        native(*args, **kwargs)
        raise RuntimeError("shutdown after native effect")

    monkeypatch.setattr(bridge.manager, "start_timer", partial)
    failed = command(bridge, action="start", seconds=20)
    assert failed["error"] == "native_outcome_unknown" and failed["retry_allowed"] is False
    assert command(bridge, action="start", seconds=20) == failed
    assert bridge.manager.starts == 1


def test_saturated_ledger_keeps_terminal_cleanup_and_bounded_receipts(bridge, monkeypatch):
    monkeypatch.setattr(module, "MAX_REQUESTS", 1)
    monkeypatch.setattr(module, "MAX_CLEANUP_REQUESTS", 2)
    created = command(bridge, action="start", seconds=1)
    bridge.manager.finish(created["id"])
    for idx in range(5):
        assert command(bridge, str(idx), action="cancel", timer_id=created["id"])["ok"]
    assert len(bridge._cleanup_requests) <= 2
    assert command(bridge, "ack", action="acknowledge_finished", timer_id=created["id"])["ok"]
    assert command(bridge, action="start", seconds=1) == created
    assert bridge.manager.starts == 1


def test_claimed_alarm_custody_unknown_recovery_and_truthful_stop(bridge):
    created = command(bridge, action="start", seconds=1)
    bridge.manager.finish(created["id"])
    scope = {"timer_id": created["id"], "alert_id": "delivery-one", "sink_id": "voice_pe:mac"}
    assert command(bridge, "claim", action="claim_alert", **scope)["ok"]
    assert (
        command(bridge, "early-ack", action="acknowledge_finished", timer_id=created["id"])["error"]
        == "alert_drain_required"
    )
    assert command(bridge, "started", action="report_alert", phase="started", **scope)[
        "physical_started"
    ]
    assert command(bridge, "unknown", action="report_alert", phase="unknown", **scope)["ok"]
    assert (
        command(bridge, "cancel", action="cancel", timer_id=created["id"])[
            "physical_stop_confirmed"
        ]
        is False
    )
    foreign = {**scope, "sink_id": "another-browser"}
    assert (
        command(bridge, "foreign", action="report_alert", phase="stopped", **foreign)["error"]
        == "stale_alert_owner"
    )
    stopped = command(bridge, "terminal-ack", action="report_alert", phase="stopped", **scope)
    assert stopped["physical_stopped"] and not stopped["physical_drained"]
    assert command(bridge, "cancel-again", action="cancel", timer_id=created["id"])[
        "physical_stop_confirmed"
    ]
    assert command(bridge, "ack", action="acknowledge_finished", timer_id=created["id"])["ok"]
    assert bridge.snapshot("kitchen")["finished"] == []


def test_unknown_native_cancel_survives_cleanup_eviction(bridge, monkeypatch):
    monkeypatch.setattr(module, "MAX_CLEANUP_REQUESTS", 1)
    created = command(bridge, action="start", seconds=20)
    attempts = []

    def uncertain(timer_id):
        attempts.append(timer_id)
        raise RuntimeError("uncertain native cancellation")

    monkeypatch.setattr(bridge.manager, "cancel_timer", uncertain)
    result = command(bridge, "stop", action="cancel", timer_id=created["id"])
    assert result["error"] == "native_outcome_unknown"
    second = command(bridge, "another-stop", action="cancel", timer_id=created["id"])
    assert second == result and len(attempts) == 1
    # Native expiry still works and exact finished receipt release stays available.
    bridge.manager.finish(created["id"])
    assert command(bridge, "finish-stop", action="cancel", timer_id=created["id"])["ok"]
    assert command(bridge, "finish-ack", action="acknowledge_finished", timer_id=created["id"])[
        "ok"
    ]
    assert command(bridge, "stop", action="cancel", timer_id=created["id"]) == result
    assert len(attempts) == 1
