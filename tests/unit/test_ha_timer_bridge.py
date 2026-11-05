"""Scope, idempotency and expiry custody; these are not Core/audio acceptance."""

import hashlib
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
            seconds=seconds,
            updated_at=1,
            is_active=True,
            conversation_command=None,
        )
        self.timers[timer.id] = timer
        self.handlers[device]("started", timer)
        return timer.id

    def _updated(self, timer):
        timer.updated_at += 1
        self.handlers[timer.device_id]("updated", timer)

    def add_time(self, timer_id, seconds):
        timer = self.timers[timer_id]
        timer.seconds = timer.seconds_left = max(0, timer.seconds_left + seconds)
        self._updated(timer)

    def pause_timer(self, timer_id):
        timer = self.timers[timer_id]
        timer.seconds = timer.seconds_left
        timer.is_active = False
        self._updated(timer)

    def unpause_timer(self, timer_id):
        timer = self.timers[timer_id]
        timer.is_active = True
        self._updated(timer)

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


def test_successful_cancel_fences_held_finish_without_crossing_room_or_core_epoch(bridge):
    created = command(bridge, action="start", seconds=30)
    held_timer = bridge.manager.timers[created["id"]]
    held_callback = bridge.manager.handlers["ha-kitchen"]
    result = command(bridge, "cancel", action="cancel", timer_id=created["id"])
    assert result["state"] == "cancelled"
    assert command(bridge, "cancel", action="cancel", timer_id=created["id"]) == result
    assert (
        command(bridge, "second-stop", action="cancel", timer_id=created["id"])["error"]
        == "timer_not_found"
    )
    held_timer.seconds_left, held_timer.is_active = 0, False
    # Inject a held native callback; this does not claim Core emits this ordering.
    held_callback("finished", held_timer)
    held_callback("finished", held_timer)
    assert bridge.snapshot("kitchen")["finished"] == []
    foreign = SimpleNamespace(**{**vars(held_timer), "device_id": "ha-talk"})
    held_callback("finished", foreign)
    assert bridge.snapshot("kitchen")["finished"] == []
    bridge.manager.handlers["ha-talk"]("finished", foreign)
    assert bridge.snapshot("talk")["finished"][0]["id"] == created["id"]
    restarted = TimerBridge(CoreTimers(), {"kitchen": "ha-kitchen"})
    next_timer = command(restarted, action="start", seconds=30)
    assert next_timer["id"] == created["id"] and restarted.epoch != bridge.epoch
    assert not restarted.command(
        endpoint="kitchen",
        epoch=bridge.epoch,
        request_id="old-cancel",
        action="cancel",
        timer_id=next_timer["id"],
    )["ok"]
    restarted.manager.finish(next_timer["id"])
    assert restarted.snapshot("kitchen")["finished"][0]["id"] == next_timer["id"]


def test_unknown_cancel_does_not_suppress_later_native_finish(bridge, monkeypatch):
    created = command(bridge, action="start", seconds=30)

    def failed_cancel(timer_id):
        raise RuntimeError("native cancellation outcome unknown")

    monkeypatch.setattr(bridge.manager, "cancel_timer", failed_cancel)
    result = command(bridge, "cancel", action="cancel", timer_id=created["id"])
    assert not result["ok"] and result["error"] == "native_outcome_unknown"
    bridge.manager.finish(created["id"])
    row = bridge.snapshot("kitchen")["finished"][0]
    assert row["id"] == created["id"] and row["alert_state"] == "pending"
    assert not row["physical_stopped"] and not row["stop_requested"]


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


def test_recent_settings_are_original_accepted_receipts_not_countdowns(bridge, monkeypatch):
    monkeypatch.setattr(module.time, "time", lambda: 100.0)
    first = command(bridge, "first", action="start", seconds=600, name="Pasta")
    bridge.manager.timers[first["id"]].seconds_left = 5
    monkeypatch.setattr(module.time, "time", lambda: 200.0)
    second = command(bridge, "second", action="start", seconds=300, name="Æg")
    bridge.manager.finish(second["id"])
    command(bridge, "cancel", action="cancel", timer_id=first["id"])
    assert command(bridge, "first", action="start", seconds=600, name="Pasta") == first
    recent = bridge.snapshot("kitchen")["recent"]
    assert recent == [
        {"id": second["id"], "name": "Æg", "seconds": 300, "accepted_at": 200.0},
        {"id": first["id"], "name": "Pasta", "seconds": 600, "accepted_at": 100.0},
    ]
    assert bridge.snapshot("talk")["recent"] == []
    restarted = TimerBridge(CoreTimers(), {"kitchen": "new"})
    assert restarted.snapshot("kitchen")["recent"] == []


def test_recent_settings_bounded_deduplicated_and_unknown_excluded(bridge, monkeypatch):
    for index in range(15):
        created = command(bridge, str(index), action="start", seconds=index + 1, name="Mad")
        bridge.manager.finish(created["id"])
        command(bridge, "ack" + str(index), action="acknowledge_finished", timer_id=created["id"])
    duplicate_settings = command(bridge, "new-use", action="start", seconds=15, name="Mad")
    recent = bridge.snapshot("kitchen")["recent"]
    assert len(recent) == 12 and recent[0]["id"] == duplicate_settings["id"]
    assert [r["seconds"] for r in recent] == list(range(15, 3, -1))

    def uncertain(*args, **kwargs):
        raise RuntimeError("possibly started")

    monkeypatch.setattr(bridge.manager, "start_timer", uncertain)
    assert not command(bridge, "unknown", action="start", seconds=555)["ok"]
    assert bridge.snapshot("kitchen")["recent"] == recent


def adjustment(bridge, timer, request="adjust-one", **overrides):
    return command(
        bridge,
        request,
        **{
            "action": "adjust",
            "timer_id": timer.id,
            "delta_seconds": 60,
            "expected_revision": str(timer.updated_at),
            **overrides,
        },
    )


@pytest.mark.parametrize("active,delta", [(True, 60), (True, -60), (False, 60), (False, -60)])
def test_adjust_same_native_identity_observation_and_original_history(bridge, active, delta):
    created = command(bridge, action="start", seconds=120, name="Mad")
    timer = bridge.manager.timers[created["id"]]
    timer.is_active = active
    old_revision = str(timer.updated_at)
    result = adjustment(bridge, timer, delta_seconds=delta)
    assert result["ok"] and result["request_id"] == "adjust-one"
    assert result["id"] == timer.id and bridge.manager.timers[timer.id] is timer
    assert result["expected_revision"] == old_revision and result["revision"] != old_revision
    assert result["duration_seconds"] == result["seconds_left"] == 120 + delta
    assert timer.is_active == active and result["state"] == ("active" if active else "paused")
    assert bridge.manager.starts == 1
    assert bridge.snapshot("kitchen")["recent"][0]["seconds"] == 120
    row = bridge.snapshot("kitchen")["timers"][0]
    assert row["revision"] == result["revision"] and row["duration_seconds"] == 120 + delta


@pytest.mark.parametrize("delta", [True, False, 0, 86401, -86401, "60", 60.5, None])
def test_invalid_adjust_delta_has_no_effect_or_reservation(bridge, delta):
    created = command(bridge, action="start", seconds=120)
    timer = bridge.manager.timers[created["id"]]
    assert adjustment(bridge, timer, delta_seconds=delta)["error"] == "invalid_adjustment"
    assert timer.seconds_left == 120 and len(bridge._requests) == 1


@pytest.mark.parametrize("revision", ["", "01", "-1", "1.0", 1, "9" * 25])
def test_invalid_revision_never_mutates(bridge, revision):
    timer = bridge.manager.timers[command(bridge, action="start", seconds=120)["id"]]
    result = adjustment(bridge, timer, expected_revision=revision)
    assert not result["ok"] and timer.seconds_left == 120


def test_adjust_exact_owner_revision_and_bounds(bridge):
    timer = bridge.manager.timers[command(bridge, action="start", seconds=120)["id"]]
    assert adjustment(bridge, timer, expected_revision="999")["error"] == "stale_timer_revision"
    assert adjustment(bridge, timer, delta_seconds=-120)["error"] == "invalid_duration"
    assert adjustment(bridge, timer, delta_seconds=86400)["error"] == "invalid_duration"
    foreign = bridge.command(
        endpoint="talk",
        epoch=bridge.epoch,
        request_id="foreign",
        action="adjust",
        timer_id=timer.id,
        delta_seconds=60,
        expected_revision="1",
    )
    assert foreign["error"] == "timer_not_found"
    assert len(bridge._requests) == 1 and timer.updated_at == 1


def test_negative_final_frozen_check_restores_activity_and_caches_rejection(bridge, monkeypatch):
    timer = bridge.manager.timers[command(bridge, action="start", seconds=61)["id"]]
    pause = bridge.manager.pause_timer

    def crossed_boundary(ident):
        timer.seconds_left = 60
        pause(ident)

    monkeypatch.setattr(bridge.manager, "pause_timer", crossed_boundary)
    result = adjustment(bridge, timer, delta_seconds=-60)
    assert result["error"] == "invalid_duration" and result["outcome"] == "rejected"
    assert timer.seconds_left == 60 and timer.is_active and timer.updated_at == 3
    assert (
        command(
            bridge,
            "adjust-one",
            action="adjust",
            timer_id=timer.id,
            delta_seconds=-60,
            expected_revision="1",
        )
        == result
    )


def test_lookup_historical_receipt_precedes_native_revision_and_capacity(bridge, monkeypatch):
    timer = bridge.manager.timers[command(bridge, action="start", seconds=120)["id"]]
    result = adjustment(bridge, timer)
    bridge.manager.finish(timer.id)
    monkeypatch.setattr(module, "MAX_REQUESTS", 0)
    args = dict(action="adjust", timer_id=timer.id, delta_seconds=60, expected_revision="1")
    assert command(bridge, "adjust-one", lookup_only=True, **args) == result
    assert command(bridge, "adjust-one", **args) == result
    assert (
        command(bridge, "adjust-one", lookup_only=True, **{**args, "delta_seconds": -60})["error"]
        == "request_id_conflict"
    )
    before = dict(bridge._requests)
    assert command(bridge, "missing", lookup_only=True, **args)["error"] == "request_not_found"
    assert bridge._requests == before
    assert (
        bridge.command(
            endpoint="kitchen", epoch="old", request_id="adjust-one", lookup_only=True, **args
        )["error"]
        == "core_epoch_changed"
    )
    assert (
        bridge.command(
            endpoint="talk", epoch=bridge.epoch, request_id="adjust-one", lookup_only=True, **args
        )["error"]
        == "request_not_found"
    )


def test_lookup_alias_semantics_start_receipt_and_strict_signature(bridge):
    created = command(bridge, action="start", seconds=120)
    assert command(bridge, lookup_only=True, action="start", seconds=120) == created
    assert (
        command(bridge, lookup_only="true", action="start", seconds=120)["error"]
        == "invalid_lookup"
    )
    assert (
        command(bridge, lookup_only=True, action="start", seconds=True)["error"]
        == "invalid_duration"
    )
    assert (
        command(bridge, lookup_only=True, action="start", seconds=120, delta_seconds=60)["error"]
        == "unexpected_adjust_arguments"
    )
    assert bridge.manager.starts == 1


def test_adjust_non_evicting_shared_start_budget_and_cleanup(bridge, monkeypatch):
    monkeypatch.setattr(module, "MAX_REQUESTS", 2)
    monkeypatch.setattr(module, "MAX_CLEANUP_REQUESTS", 1)
    timer = bridge.manager.timers[command(bridge, action="start", seconds=120)["id"]]
    result = adjustment(bridge, timer)
    assert adjustment(bridge, timer, request="new-adjust")["error"] == "request_ledger_full"
    assert command(bridge, "new-start", action="start", seconds=5)["error"] == "request_ledger_full"
    bridge.manager.finish(timer.id)
    command(bridge, "cleanup", action="cancel", timer_id=timer.id)
    command(bridge, "ack", action="acknowledge_finished", timer_id=timer.id)
    assert (
        command(
            bridge,
            "adjust-one",
            lookup_only=True,
            action="adjust",
            timer_id=timer.id,
            delta_seconds=60,
            expected_revision="1",
        )
        == result
    )


@pytest.mark.parametrize("fault", ["pause", "add", "restore"])
def test_native_adjust_partial_failure_keeps_unknown_and_never_replays(
    bridge, monkeypatch, fault, caplog
):
    timer = bridge.manager.timers[command(bridge, action="start", seconds=120)["id"]]
    counts = []
    method = {"pause": "pause_timer", "add": "add_time", "restore": "unpause_timer"}[fault]
    original = getattr(bridge.manager, method)

    def partial(*args):
        counts.append(method)
        original(*args)
        raise RuntimeError("native partial effect")

    monkeypatch.setattr(bridge.manager, method, partial)
    result = adjustment(bridge, timer, delta_seconds=-60)
    assert result["outcome"] == "unknown" and result["retry_allowed"] is False
    assert (
        command(
            bridge,
            "adjust-one",
            action="adjust",
            timer_id=timer.id,
            delta_seconds=-60,
            expected_revision="1",
        )
        == result
    )
    assert (
        command(
            bridge,
            "adjust-one",
            lookup_only=True,
            action="adjust",
            timer_id=timer.id,
            delta_seconds=-60,
            expected_revision="1",
        )
        == result
    )
    assert counts == [method] and bridge.manager.starts == 1
    records = [row for row in caplog.records if "native_timer_adjust" in row.message]
    assert len(records) == 1
    expected_phase = {"pause": "pause", "add": "add", "restore": "resume"}[fault]
    message = records[0].message
    assert f"phase={expected_phase} outcome=unknown" in message
    assert "request_ref=" + hashlib.sha256(b"adjust-one").hexdigest()[:16] in message
    assert "adjust-one" not in message and "native partial effect" not in message
    assert "recovery=" in message and not records[0].exc_info


def test_restore_failure_is_unknown_and_can_remain_paused(bridge, monkeypatch):
    timer = bridge.manager.timers[command(bridge, action="start", seconds=120)["id"]]

    def fail(ident):
        raise RuntimeError("cannot restore")

    monkeypatch.setattr(bridge.manager, "unpause_timer", fail)
    result = adjustment(bridge, timer, delta_seconds=-60)
    assert result["outcome"] == "unknown" and not timer.is_active
    assert timer.seconds_left == 60


@pytest.mark.parametrize(
    "bad",
    [
        {},
        {"seconds": True, "updated_at": 1},
        {"seconds": 5, "updated_at": -1},
        {"seconds": 5, "updated_at": "1"},
    ],
)
def test_old_or_invalid_native_metadata_omits_pair_without_breaking_v1(bridge, bad):
    timer = bridge.manager.timers[command(bridge, action="start", seconds=120)["id"]]
    del timer.seconds
    del timer.updated_at
    vars(timer).update(bad)
    row = bridge.snapshot("kitchen")["timers"][0]
    assert "duration_seconds" not in row and "revision" not in row
    assert (
        command(
            bridge,
            "adjust",
            action="adjust",
            timer_id=timer.id,
            delta_seconds=60,
            expected_revision="1",
        )["error"]
        == "adjust_unavailable"
    )
    assert command(bridge, "cancel", action="cancel", timer_id=timer.id)["ok"]


def test_missing_native_method_disables_adjust_only(bridge, monkeypatch):
    timer = bridge.manager.timers[command(bridge, action="start", seconds=120)["id"]]
    monkeypatch.setattr(bridge.manager, "add_time", None)
    assert adjustment(bridge, timer)["error"] == "adjust_unavailable"
    assert command(bridge, "cancel", action="cancel", timer_id=timer.id)["ok"]


def test_native_noop_or_invalid_post_effect_metadata_is_unknown(bridge, monkeypatch):
    timer = bridge.manager.timers[command(bridge, action="start", seconds=120)["id"]]
    monkeypatch.setattr(bridge.manager, "add_time", lambda *args: None)
    assert adjustment(bridge, timer)["outcome"] == "unknown"


def test_zero_duration_omits_native_pair(bridge):
    timer = bridge.manager.timers[command(bridge, action="start", seconds=120)["id"]]
    timer.seconds = timer.seconds_left = 0
    timer.is_active = False
    row = bridge.snapshot("kitchen")["timers"][0]
    assert "duration_seconds" not in row and "revision" not in row
