"""Device-scoped delivery bridge to HA's native intent timers.

This module never counts down. Core owns TimerInfo, tasks and expiry; this bridge
retains only completed request receipts and undelivered FINISHED notifications.
All methods are synchronous on HA's event loop: an operation and its receipt have
no cancellation window or competing coroutine between the native effect and cache.
"""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
import time
from collections import OrderedDict
from collections.abc import Callable
from typing import Any

_LOGGER = logging.getLogger(__name__)

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
        if signature[0] in {"start", "adjust"}:
            self._requests[key] = (signature, dict(result))
        else:
            # Cleanup is exact timer/alert-owner scoped and cannot create a timer.
            # Evicting its response never evicts an unknown/successful create receipt.
            self._cleanup_requests[key] = (signature, dict(result))
            self._cleanup_requests.move_to_end(key)
            while len(self._cleanup_requests) > MAX_CLEANUP_REQUESTS:
                self._cleanup_requests.popitem(last=False)

    def _recent(self, endpoint: str) -> list[dict]:
        # Existing terminal start receipts own identity/time; this is not a new timer store.
        rows, seen = [], set()
        for (room, _), (signature, receipt) in reversed(self._requests.items()):
            if room != endpoint or signature[0] != "start" or receipt.get("ok") is not True:
                continue
            settings = (receipt["name"], receipt["seconds"])
            if settings in seen:
                continue
            seen.add(settings)
            rows.append({key: receipt[key] for key in ("id", "name", "seconds", "accepted_at")})
            if len(rows) == 12:
                break
        return rows

    @staticmethod
    def _native_metadata(timer: Any) -> dict:
        seconds = getattr(timer, "seconds", None)
        revision = getattr(timer, "updated_at", None)
        if (
            type(seconds) is not int
            or not 1 <= seconds <= 86400
            or type(revision) is not int
            or revision < 0
            or len(str(revision)) > 24
        ):
            return {}
        return {"duration_seconds": seconds, "revision": str(revision)}

    def _adjust(
        self, key: tuple, signature: tuple, timer_id: str, delta: int, revision: str
    ) -> dict:
        def reject(error):
            return self._reply(ok=False, error=error, outcome="rejected", retry_allowed=False)

        timer = self.manager.timers.get(timer_id)
        if timer is None or timer.device_id != self.devices[key[0]] or timer.conversation_command:
            return reject("timer_not_found")
        metadata = self._native_metadata(timer)
        if not metadata or not all(
            callable(getattr(self.manager, method, None))
            for method in ("add_time", "pause_timer", "unpause_timer")
        ):
            return reject("adjust_unavailable")
        if metadata["revision"] != revision:
            return reject("stale_timer_revision")
        if type(timer.is_active) is not bool:
            return reject("adjust_unavailable")
        remaining = timer.seconds_left
        if type(remaining) is not int or not 1 <= remaining <= 86400:
            return reject("invalid_remaining")
        if not 1 <= remaining + delta <= 86400:
            return reject("invalid_duration")
        if self._starts >= MAX_REQUESTS:
            return reject("request_ledger_full")
        correlation = {
            "request_id": key[1],
            "id": timer_id,
            "delta_seconds": delta,
            "expected_revision": revision,
        }
        unknown = self._reply(
            ok=False,
            error="native_outcome_unknown",
            outcome="unknown",
            retry_allowed=False,
            **correlation,
        )
        self._starts += 1  # Shared non-evicting start/adjust admission budget.
        self._requests[key] = (signature, dict(unknown))
        was_active = timer.is_active
        frozen_rejected = False
        phase = "validate"
        try:
            if was_active and delta < 0:
                # Core re-reads the clock in add_time. Freeze before the final
                # lower-bound check so a second boundary cannot create an alarm.
                phase = "pause"
                self.manager.pause_timer(timer_id)
            phase = "validate"
            frozen = timer.seconds_left
            if type(frozen) is not int or not 1 <= frozen + delta <= 86400:
                frozen_rejected = True
            else:
                phase = "add"
                self.manager.add_time(timer_id, delta)
            if was_active and not timer.is_active:
                phase = "resume"
                self.manager.unpause_timer(timer_id)
            phase = "validate"
            if self.manager.timers.get(timer_id) is not timer or timer.is_active != was_active:
                raise ValueError("native timer changed")
            final = self._native_metadata(timer)
            remaining = timer.seconds_left
            if (
                not final
                or int(final["revision"]) <= int(revision)
                or type(remaining) is not int
                or not 1 <= remaining <= final["duration_seconds"]
            ):
                raise ValueError("invalid native result")
            result = self._reply(
                ok=not frozen_rejected,
                **({"error": "invalid_duration", "outcome": "rejected"} if frozen_rejected else {}),
                **correlation,
                **final,
                seconds_left=remaining,
                state="active" if timer.is_active else "paused",
            )
        except Exception:
            # Restoration is best-effort; failure never becomes accepted or a
            # replayable request. Preserve native events rather than hiding them.
            recovery = "not_needed"
            try:
                if (
                    was_active
                    and self.manager.timers.get(timer_id) is timer
                    and not timer.is_active
                ):
                    recovery = "failed"
                    self.manager.unpause_timer(timer_id)
                    recovery = "restored" if timer.is_active else "failed"
            except Exception:
                recovery = "failed"
            try:
                _LOGGER.warning(
                    "native_timer_adjust phase=%s outcome=unknown recovery=%s request_ref=%s",
                    phase,
                    recovery,
                    hashlib.sha256(key[1].encode()).hexdigest()[:16],
                )
            except Exception:
                pass  # Diagnostics never change the receipt or native effects.
            return dict(unknown)
        self._remember(key, signature, result)
        return result

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
                **self._native_metadata(timer),
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
            recent=self._recent(endpoint),
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
        delta_seconds: int | None = None,
        expected_revision: str = "",
        lookup_only: bool = False,
    ) -> dict:
        """Execute one complete classified tool call, never a retry in a new epoch."""

        def reject(error):
            return self._reply(
                ok=False, error=error, **({"outcome": "rejected"} if action == "adjust" else {})
            )

        if self._closed or endpoint not in self.devices:
            return reject("endpoint_unavailable")
        if epoch != self.epoch:
            return self._reply(
                ok=False, error="core_epoch_changed", outcome="unknown", retry_allowed=False
            )
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 200:
            return reject("invalid_request_id")
        if type(lookup_only) is not bool:
            return reject("invalid_lookup")
        if action not in (
            "start",
            "cancel",
            "acknowledge_finished",
            "claim_alert",
            "report_alert",
            "adjust",
        ):
            return reject("unsupported_action")
        if not isinstance(name, str) or len(name) > 120:
            return reject("invalid_name")
        if not isinstance(language, str) or not 1 <= len(language) <= 20:
            return reject("invalid_language")
        if any(
            not isinstance(value, str)
            for value in (timer_id, alert_id, phase, sink_id, expected_revision)
        ):
            return reject("invalid_arguments")
        if action == "adjust":
            if (
                type(delta_seconds) is not int
                or not 1 <= abs(delta_seconds) <= 86400
                or not re.fullmatch(r"(?:0|[1-9][0-9]{0,23})", expected_revision)
                or not 1 <= len(timer_id) <= 200
                or seconds is not None
                or name
                or alert_id
                or phase
                or sink_id
            ):
                return reject("invalid_adjustment")
        elif delta_seconds is not None or expected_revision:
            return reject("unexpected_adjust_arguments")
        if action == "start" and (
            type(seconds) is not int or not 1 <= seconds <= 86400 or timer_id
        ):
            return reject("invalid_duration")
        if (
            action != "start"
            and action != "adjust"
            and (not timer_id or seconds is not None or name)
        ):
            return reject("exact_timer_id_required")
        if action in ("start", "cancel", "acknowledge_finished") and (alert_id or phase or sink_id):
            return reject("unexpected_alert_arguments")
        if action in ("claim_alert", "report_alert") and (
            not 1 <= len(alert_id) <= 200
            or not 1 <= len(sink_id) <= 200
            or (action == "claim_alert" and phase)
            or (
                action == "report_alert"
                and phase not in ("started", "drained", "stopped", "unknown")
            )
        ):
            return reject("invalid_alert_arguments")
        signature = (
            action,
            seconds,
            name,
            timer_id,
            language,
            alert_id,
            phase,
            sink_id,
            delta_seconds,
            expected_revision,
        )
        key = (endpoint, request_id)
        if old := self._requests.get(key) or self._cleanup_requests.get(key):
            if old[0] != signature:
                return reject("request_id_conflict")
            return dict(old[1])
        if lookup_only:
            return self._reply(ok=False, error="request_not_found", retry_allowed=False)
        if action == "adjust":
            return self._adjust(key, signature, timer_id, delta_seconds, expected_revision)
        # No LRU eviction: a late duplicate must not create a second timer.
        if action == "start" and self._starts >= MAX_REQUESTS:
            return self._reply(ok=False, error="request_ledger_full", retry_allowed=False)
        if action not in ("start", "cancel", "acknowledge_finished", "claim_alert", "report_alert"):
            return reject("unsupported_action")
        if not isinstance(name, str) or len(name) > 120:
            return reject("invalid_name")
        if not isinstance(language, str) or not 1 <= len(language) <= 20:
            return reject("invalid_language")
        device_id = self.devices[endpoint]
        if action in ("claim_alert", "report_alert"):
            finished = self._finished[endpoint].get(timer_id)
            if not finished or not isinstance(alert_id, str) or not 1 <= len(alert_id) <= 200:
                return reject("invalid_alert_owner")
            if action == "claim_alert":
                if not isinstance(sink_id, str) or not 1 <= len(sink_id) <= 200:
                    return reject("invalid_sink_identity")
                if finished["alert_id"] or finished["stop_requested"]:
                    return reject("alert_already_claimed")
                finished.update(alert_id=alert_id, sink_id=sink_id, alert_state="requested")
            else:
                if finished["alert_id"] != alert_id or finished["sink_id"] != sink_id:
                    return reject("stale_alert_owner")
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
                    return reject("invalid_alert_sequence")
            result = self._reply(ok=True, **dict(finished))
            self._remember(key, signature, result)
            return result
        if alert_id or phase or sink_id:
            return reject("unexpected_alert_arguments")
        if action == "start":
            if type(seconds) is not int or not 1 <= seconds <= 86400 or timer_id:
                return reject("invalid_duration")
            state = self.snapshot(endpoint)
            if len(state["timers"]) + len(state["finished"]) >= MAX_TIMERS_PER_ENDPOINT:
                return reject("too_many_timers")
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
                ok=True,
                id=created,
                state="active",
                seconds=seconds,
                name=name,
                audible=False,
                accepted_at=time.time(),
            )
        else:
            if not isinstance(timer_id, str) or not timer_id or seconds is not None or name:
                return reject("exact_timer_id_required")
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
                self._acknowledged.add((endpoint, timer_id))
                self._finished[endpoint].pop(timer_id, None)
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
                        return reject("alert_drain_required")
                    self._finished[endpoint].pop(timer_id)
                    self._acknowledged.add((endpoint, timer_id))
                    result = self._reply(ok=True, id=timer_id, state="acknowledged")
            else:
                return reject("timer_not_found")
        self._remember(key, signature, result)
        return result

    def close(self) -> None:
        """Stop delivery; Core timers remain Core-owned and are not reset/recreated."""
        self._closed = True
        for unregister in self._unregister:
            unregister()
        self._unregister.clear()
