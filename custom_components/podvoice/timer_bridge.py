"""Device-scoped delivery bridge to HA's native intent timers.

This module never counts down. Core owns TimerInfo, tasks and expiry; this bridge
retains only completed request receipts and undelivered FINISHED notifications.
All methods are synchronous on HA's event loop: an operation and its receipt have
no cancellation window or competing coroutine between the native effect and cache.
"""

from __future__ import annotations

import secrets
from collections import OrderedDict
from collections.abc import Callable
from typing import Any

MAX_REQUESTS = 8192
MAX_TIMERS_PER_ENDPOINT = 32
MAX_CLEANUP_REQUESTS = 1024


class TimerBridge:
    """One Core lifetime, using only explicitly registered PodVoice devices."""

    def __init__(
        self, manager: Any, devices: dict[str, str], identities: dict | None = None
    ) -> None:
        self.manager = manager
        self.devices = dict(devices)
        self.identities = identities or {}
        self.epoch = secrets.token_hex(16)
        self._requests: dict[tuple[str, str], tuple[tuple, dict]] = {}
        self._cleanup_requests: OrderedDict[tuple[str, str], tuple[tuple, dict]] = OrderedDict()
        self._starts = 0
        self._uncertain_cancels: dict[tuple[str, str], dict] = {}
        self._finished: dict[str, dict[str, dict]] = {key: {} for key in devices}
        self._acknowledged: set[tuple[str, str]] = set()
        self._unregister: list[Callable[[], None]] = []
        self._closed = False
        for endpoint, device_id in self.devices.items():
            if manager.is_timer_device(device_id):
                # Never replace an ESPHome/other integration's native handler.
                self.close()
                raise ValueError("timer device already has a handler")
            self._unregister.append(
                manager.register_handler(device_id, self._handler(endpoint, device_id))
            )

    def _handler(self, endpoint: str, device_id: str) -> Callable:
        def receive(event: str, timer: Any) -> None:
            if self._closed or timer.device_id != device_id:
                return
            if event == "finished" and (endpoint, timer.id) not in self._acknowledged:
                self._finished[endpoint].setdefault(
                    timer.id,
                    {
                        "id": timer.id,
                        "name": timer.name or "",
                        "state": "finished",
                        "seconds_left": 0,
                        "stop_requested": False,
                        "alerted": False,
                        "alert_id": "",
                        "sink_id": "",
                        "alert_state": "pending",
                        "physical_started": False,
                        "physical_drained": False,
                        "physical_stopped": False,
                    },
                )

        return receive

    def _reply(self, **payload: Any) -> dict:
        return {
            "epoch": self.epoch,
            "owner": "home_assistant_intent",
            "restart_contract": "core_restart_clears_timers",
            **payload,
        }

    def _remember(self, key: tuple, signature: tuple, result: dict) -> None:
        if signature[0] == "start":
            self._requests[key] = (signature, dict(result))
        else:
            # Cleanup is exact timer/alert-owner scoped and cannot create a timer.
            # Evicting its response never evicts an unknown/successful create receipt.
            self._cleanup_requests[key] = (signature, dict(result))
            self._cleanup_requests.move_to_end(key)
            while len(self._cleanup_requests) > MAX_CLEANUP_REQUESTS:
                self._cleanup_requests.popitem(last=False)

    def snapshot(self, endpoint: str) -> dict:
        if self._closed or endpoint not in self.devices:
            return self._reply(ok=False, error="endpoint_unavailable")
        device_id = self.devices[endpoint]
        timers = [
            {
                "id": timer.id,
                "name": timer.name or "",
                "seconds_left": timer.seconds_left,
                "state": "active" if timer.is_active else "paused",
            }
            for timer in self.manager.timers.values()
            if timer.device_id == device_id and not timer.conversation_command
        ]
        return self._reply(
            ok=True,
            contract="podvoice_native_timers_v1",
            endpoint=endpoint,
            binding={"device_id": device_id, **self.identities.get(endpoint, {})},
            timers=timers,
            finished=[dict(item) for item in self._finished[endpoint].values()],
        )

    def command(
        self,
        *,
        endpoint: str,
        epoch: str,
        request_id: str,
        action: str,
        seconds: int | None = None,
        name: str = "",
        timer_id: str = "",
        language: str = "da",
        alert_id: str = "",
        phase: str = "",
        sink_id: str = "",
    ) -> dict:
        """Execute one complete classified tool call, never a retry in a new epoch."""
        if self._closed or endpoint not in self.devices:
            return self._reply(ok=False, error="endpoint_unavailable")
        if epoch != self.epoch:
            return self._reply(
                ok=False, error="core_epoch_changed", outcome="unknown", retry_allowed=False
            )
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 200:
            return self._reply(ok=False, error="invalid_request_id")
        signature = (action, seconds, name, timer_id, language, alert_id, phase, sink_id)
        key = (endpoint, request_id)
        if old := self._requests.get(key) or self._cleanup_requests.get(key):
            if old[0] != signature:
                return self._reply(ok=False, error="request_id_conflict")
            return dict(old[1])
        # No LRU eviction: a late duplicate must not create a second timer.
        if action == "start" and self._starts >= MAX_REQUESTS:
            return self._reply(ok=False, error="request_ledger_full", retry_allowed=False)
        if action not in ("start", "cancel", "acknowledge_finished", "claim_alert", "report_alert"):
            return self._reply(ok=False, error="unsupported_action")
        if not isinstance(name, str) or len(name) > 120:
            return self._reply(ok=False, error="invalid_name")
        if not isinstance(language, str) or not 1 <= len(language) <= 20:
            return self._reply(ok=False, error="invalid_language")
        device_id = self.devices[endpoint]
        if action in ("claim_alert", "report_alert"):
            finished = self._finished[endpoint].get(timer_id)
            if not finished or not isinstance(alert_id, str) or not 1 <= len(alert_id) <= 200:
                return self._reply(ok=False, error="invalid_alert_owner")
            if action == "claim_alert":
                if not isinstance(sink_id, str) or not 1 <= len(sink_id) <= 200:
                    return self._reply(ok=False, error="invalid_sink_identity")
                if finished["alert_id"] or finished["stop_requested"]:
                    return self._reply(ok=False, error="alert_already_claimed")
                finished.update(alert_id=alert_id, sink_id=sink_id, alert_state="requested")
            else:
                if finished["alert_id"] != alert_id or finished["sink_id"] != sink_id:
                    return self._reply(ok=False, error="stale_alert_owner")
                state = finished["alert_state"]
                if phase == state:
                    return self._reply(ok=True, **dict(finished))
                if phase == "started" and state == "requested":
                    finished.update(alert_state="started", physical_started=True)
                elif phase == "drained" and state in ("started", "stopped", "unknown"):
                    finished.update(
                        alert_state="drained",
                        physical_drained=True,
                        alerted=finished["physical_started"],
                    )
                elif phase == "stopped" and state in ("requested", "started", "unknown"):
                    finished.update(alert_state="stopped", physical_stopped=True)
                elif phase == "unknown" and state in ("requested", "started"):
                    finished["alert_state"] = "unknown"
                elif phase != state:
                    return self._reply(ok=False, error="invalid_alert_sequence")
            result = self._reply(ok=True, **dict(finished))
            self._remember(key, signature, result)
            return result
        if alert_id or phase or sink_id:
            return self._reply(ok=False, error="unexpected_alert_arguments")
        if action == "start":
            if type(seconds) is not int or not 1 <= seconds <= 86400 or timer_id:
                return self._reply(ok=False, error="invalid_duration")
            state = self.snapshot(endpoint)
            if len(state["timers"]) + len(state["finished"]) >= MAX_TIMERS_PER_ENDPOINT:
                return self._reply(ok=False, error="too_many_timers")
            unknown = self._reply(ok=False, error="native_outcome_unknown", retry_allowed=False)
            self._starts += 1
            self._requests[key] = (signature, unknown)
            try:
                created = self.manager.start_timer(
                    device_id,
                    None,
                    None,
                    seconds,
                    language,
                    name=name or None,
                )
            except Exception:
                # A native exception may follow a partial effect (for example
                # shutdown task admission). Keep the tombstone, never repeat it.
                return dict(unknown)
            result = self._reply(
                ok=True, id=created, state="active", seconds=seconds, name=name, audible=False
            )
        else:
            if not isinstance(timer_id, str) or not timer_id or seconds is not None or name:
                return self._reply(ok=False, error="exact_timer_id_required")
            finished = self._finished[endpoint].get(timer_id)
            timer = self.manager.timers.get(timer_id)
            if action == "cancel" and timer is not None and timer.device_id == device_id:
                if uncertain := self._uncertain_cancels.get((endpoint, timer_id)):
                    return dict(uncertain)  # Never replay an unresolved native mutation.
                unknown = self._reply(ok=False, error="native_outcome_unknown", retry_allowed=False)
                self._remember(key, signature, unknown)
                try:
                    self.manager.cancel_timer(timer_id)
                except Exception:
                    # One held unknown per exact native timer, plus its immutable
                    # original call receipt. Later cleanup cache eviction cannot
                    # replay a cancellation whose native result is uncertain.
                    self._uncertain_cancels[(endpoint, timer_id)] = dict(unknown)
                    self._requests[key] = (signature, dict(unknown))
                    return dict(unknown)
                result = self._reply(ok=True, id=timer_id, state="cancelled")
            elif finished is not None:
                if action == "cancel":
                    if finished["stop_requested"]:
                        return self._reply(
                            ok=True,
                            id=timer_id,
                            state="stop_requested",
                            physical_stop_confirmed=finished["physical_stopped"],
                            physical_drained=finished["physical_drained"],
                        )
                    finished["stop_requested"] = True
                    result = self._reply(
                        ok=True, id=timer_id, state="stop_requested", physical_stop_confirmed=False
                    )
                else:
                    if finished["alert_id"] and not (
                        finished["physical_drained"] or finished["physical_stopped"]
                    ):
                        return self._reply(ok=False, error="alert_drain_required")
                    self._finished[endpoint].pop(timer_id)
                    self._acknowledged.add((endpoint, timer_id))
                    result = self._reply(ok=True, id=timer_id, state="acknowledged")
            else:
                return self._reply(ok=False, error="timer_not_found")
        self._remember(key, signature, result)
        return result

    def close(self) -> None:
        """Stop delivery; Core timers remain Core-owned and are not reset/recreated."""
        self._closed = True
        for unregister in self._unregister:
            unregister()
        self._unregister.clear()
