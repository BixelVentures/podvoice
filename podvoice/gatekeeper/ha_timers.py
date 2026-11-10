"""Typed HA native timer services; no countdown, scheduler or speech semantics."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import math
import re
import time

import httpx

from . import constants as C

TOOLS = {
    "podvoice_start_timer",
    "podvoice_timer_status",
    "podvoice_cancel_timer",
    "podvoice_adjust_timer",
}
_FIELDS = {
    "endpoint",
    "epoch",
    "request_id",
    "action",
    "seconds",
    "name",
    "timer_id",
    "language",
    "alert_id",
    "phase",
    "sink_id",
}

_ACTIONS = ["start", "cancel", "acknowledge_finished", "claim_alert", "report_alert"]
_V2_FIELDS = _FIELDS | {"delta_seconds", "expected_revision", "lookup_only"}


def _revision(value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(r"(?:0|[1-9][0-9]{0,23})", value) is not None


def _adjust_metadata(row: dict) -> bool:
    return (
        type(row.get("duration_seconds")) is int
        and 1 <= row["duration_seconds"] <= 86400
        and _revision(row.get("revision"))
    )


class HomeAssistantTimers:
    def __init__(self, client: httpx.AsyncClient | None, token: str) -> None:
        self.client, self.token = client, token
        self.contract = ""
        self.command_service = "timer_command"
        self.bindings: dict[str, tuple[str, str] | tuple[str, str, str]] = {}
        self._registered_invalid: set[str] = set()
        self._registered_reads: dict[str, int] = {}
        self._status_read_serials: dict[str, int] = {}
        self.snapshots: dict[str, dict] = {}
        self.observed_at: dict[str, float] = {}
        self.ready: set[str] = set()

    def discover(self, domains: list) -> None:
        self.contract = ""
        self.command_service = "timer_command"
        for domain in domains:
            if domain.get("domain") != "podvoice":
                continue
            services = domain.get("services", {})
            status, command = services.get("timer_status", {}), services.get("timer_command", {})

            def valid(command, fields, actions):
                metadata = command.get("fields") if isinstance(command, dict) else None
                action = metadata.get("action") if isinstance(metadata, dict) else None
                selector = action.get("selector") if isinstance(action, dict) else None
                select = selector.get("select") if isinstance(selector, dict) else None
                return (
                    isinstance(command, dict)
                    and command.get("response") == {"optional": False}
                    and isinstance(metadata, dict)
                    and set(metadata) == fields
                    and isinstance(select, dict)
                    and select.get("options") == actions
                )

            if status.get("response") != {"optional": False} or set(status.get("fields", {})) != {
                "endpoint"
            }:
                return
            v2 = services.get("timer_command_v2", {})
            if valid(v2, _V2_FIELDS, [*_ACTIONS, "adjust"]):
                fields = v2["fields"]

                def exact_selectors(fields: dict, *, normalized: bool) -> bool:
                    # HA validates services.yaml before returning /api/services.
                    text = {"multiline": False, "multiple": False} if normalized else None
                    selectors: dict[str, dict] = {
                        key: {"text": text} for key in _V2_FIELDS - {"action"}
                    }
                    number = {"max": 86400, "mode": "box"}
                    if normalized:
                        number["step"] = 1
                    selectors["seconds"] = {"number": {"min": 1, **number}}
                    selectors["delta_seconds"] = {"number": {"min": -86400, **number}}
                    selectors["lookup_only"] = {"boolean": {} if normalized else None}
                    return all(
                        isinstance(fields[key], dict)
                        and fields[key].get("selector") == selector
                        and fields[key].get("required", False)
                        is (key in {"endpoint", "epoch", "request_id"})
                        for key, selector in selectors.items()
                    )

                if fields["action"].get("required") is True and (
                    exact_selectors(fields, normalized=True)
                    or exact_selectors(fields, normalized=False)
                ):
                    self.command_service = "timer_command_v2"
            if self.command_service != "timer_command_v2" and not valid(command, _FIELDS, _ACTIONS):
                return
            self.contract = hashlib.sha256(
                json.dumps(services, sort_keys=True).encode()
            ).hexdigest()
            return

    def bind(self, endpoint: str, kind: str, identity: str) -> None:
        binding = (kind, identity.lower())
        previous = self.bindings.get(endpoint)
        if previous is not None and len(previous) == 3:
            # Registered native source pins are immutable for this process lifetime.
            # An adapter bind must neither discard HA device identity nor replace it.
            if previous[:2] != binding:
                self._registered_invalid.add(endpoint)
                self.unbind(endpoint)
                self.snapshots.pop(endpoint, None)
            return
        if previous != binding:
            self.snapshots.pop(endpoint, None)
            self.observed_at.pop(endpoint, None)
        self.bindings[endpoint] = binding
        self.ready.add(endpoint)

    def unbind(self, endpoint: str) -> None:
        self._registered_reads[endpoint] = self._registered_reads.get(endpoint, 0) + 1
        self.ready.discard(endpoint)

    def available(self, endpoint: str) -> bool:
        # Freshness bounds service admission only; never used to count down a timer.
        return bool(
            self.contract
            and endpoint not in self._registered_invalid
            and endpoint in self.ready
            and endpoint in self.snapshots
            and time.monotonic() - self.observed_at.get(endpoint, 0) <= 15
        )

    async def _service(
        self, service: str, args: dict, *, mutation: bool = False, source=None
    ) -> dict:
        client, token, contract = (
            source if source is not None else (self.client, self.token, self.contract)
        )
        if not client or not token or not contract:
            return {"ok": False, "error_kind": "timer_unavailable"}
        try:
            response = await client.post(
                f"{C.SUPERVISOR_CORE_API}/services/podvoice/{service}?return_response",
                headers={"Authorization": f"Bearer {token}"},
                json=args,
            )
            response.raise_for_status()
            body = response.json().get("service_response")
            if (
                not isinstance(body, dict)
                or len(json.dumps(body)) > 65536
                or body.get("owner") != "home_assistant_intent"
                or not isinstance(body.get("epoch"), str)
                or len(body["epoch"]) != 32
                or type(body.get("ok")) is not bool
            ):
                raise ValueError("unknown timer response")
            return body
        except (httpx.HTTPError, ValueError, AttributeError):
            return {
                "ok": False,
                "error_kind": "unknown_outcome" if mutation else "timer_unavailable",
                "retry_allowed": False,
            }

    def _begin_status_read(self, endpoint: str) -> int:
        serial = self._registered_reads.get(endpoint, 0) + 1
        self._registered_reads[endpoint] = serial
        self._status_read_serials[endpoint] = serial
        return serial

    async def refresh(self, endpoint: str) -> dict:
        previous = self.bindings.get(endpoint)
        if previous is not None and len(previous) == 3:
            return await self.refresh_registered(endpoint, expected_kind="voice_pe")
        serial = self._begin_status_read(endpoint)
        source = (self.contract, self.client, self.token, previous)
        data = await self._service("timer_status", {"endpoint": endpoint})
        if self._registered_reads.get(endpoint) != serial:
            return {"ok": False, "error_kind": "stale_timer_read"}
        if source != (self.contract, self.client, self.token, self.bindings.get(endpoint)):
            return self._unavailable(endpoint)
        return self._accept_snapshot(endpoint, data, previous)

    async def refresh_registered(
        self, endpoint: str, *, expected_kind: str, live_identity: str | None = None
    ) -> dict:
        """Read one configured native endpoint, independent of optional physical I/O.

        Caller is the server-configured room owner, never a browser-selected identity.
        The authenticated HA integration owns registration. This method publishes data,
        never grants control or asserts physical output readiness. Talk cannot bootstrap.
        """
        if (
            expected_kind != "voice_pe"
            or not isinstance(endpoint, str)
            or not 1 <= len(endpoint) <= 160
            or endpoint in self._registered_invalid
        ):
            return self._unavailable(endpoint)
        serial = self._begin_status_read(endpoint)
        source = (self.contract, self.client, self.token)
        data = await self._service("timer_status", {"endpoint": endpoint})
        if self._registered_reads.get(endpoint) != serial:
            return {"ok": False, "error_kind": "stale_timer_read"}
        if source != (self.contract, self.client, self.token):
            return self._unavailable(endpoint)
        binding = data.get("binding")
        if (
            not isinstance(binding, dict)
            or set(binding) != {"kind", "identity", "device_id"}
            or binding.get("kind") != expected_kind
            or not isinstance(binding.get("identity"), str)
            or re.fullmatch(r"(?:[0-9a-f]{2}:){5}[0-9a-f]{2}", binding["identity"]) is None
            or not isinstance(binding.get("device_id"), str)
            or re.fullmatch(r"[A-Za-z0-9_-]{1,128}", binding["device_id"]) is None
            or not isinstance(data.get("epoch"), str)
            or re.fullmatch(r"[0-9a-f]{32}", data["epoch"]) is None
            or (live_identity is not None and live_identity != binding["identity"])
        ):
            return self._unavailable(endpoint)
        registered = (expected_kind, binding["identity"], binding["device_id"])
        previous = self.bindings.get(endpoint)
        if previous is not None and (
            previous != registered if len(previous) == 3 else previous != registered[:2]
        ):
            # Identity replacement cannot inherit a controller or silently re-pin.
            self._registered_invalid.add(endpoint)
            return self._unavailable(endpoint)
        # Validate every row before any binding, readiness or snapshot is published.
        accepted = self._accept_snapshot(endpoint, data, registered, publish=False)
        if accepted.get("ok") is not True:
            return accepted
        self.bindings[endpoint] = registered
        self.ready.add(endpoint)
        self.snapshots[endpoint] = data
        self.observed_at[endpoint] = time.monotonic()
        return data

    def _unavailable(self, endpoint: str) -> dict:
        self.ready.discard(endpoint)
        self.snapshots.pop(endpoint, None)
        return {"ok": False, "error_kind": "timer_endpoint_unavailable"}

    def _accept_snapshot(
        self, endpoint: str, data: dict, expected: tuple | None, *, publish=True
    ) -> dict:
        binding = data.get("binding", {})
        if (
            not isinstance(binding, dict)
            or not data.get("ok")
            or data.get("contract") != "podvoice_native_timers_v1"
            or data.get("endpoint") != endpoint
            or not expected
            or (binding.get("kind"), binding.get("identity")) != expected[:2]
            or (len(expected) == 3 and binding.get("device_id") != expected[2])
            or not isinstance(binding.get("device_id"), str)
            or not isinstance(data.get("timers"), list)
            or not isinstance(data.get("finished"), list)
        ):
            self.snapshots.pop(endpoint, None)
            return {"ok": False, "error_kind": "timer_endpoint_unavailable"}
        if len(expected) == 3 and (
            any(
                not isinstance(row, dict) or row.get("state") not in {"active", "paused"}
                for row in data["timers"]
            )
            or any(
                not isinstance(row, dict) or row.get("state") != "finished"
                for row in data["finished"]
            )
        ):
            self.snapshots.pop(endpoint, None)
            return {"ok": False, "error_kind": "malformed_timer_state"}
        rows = data["timers"] + data["finished"]
        if any(
            isinstance(row, dict)
            and (("duration_seconds" in row or "revision" in row) and not _adjust_metadata(row))
            for row in rows
        ):
            self.snapshots.pop(endpoint, None)
            return {"ok": False, "error_kind": "malformed_timer_state"}
        bool_fields = (
            "stop_requested",
            "alerted",
            "physical_started",
            "physical_drained",
            "physical_stopped",
        )
        if (
            len(rows) > 32
            or any(
                not isinstance(row, dict)
                or not isinstance(row.get("id"), str)
                or not 1 <= len(row["id"]) <= 200
                or not isinstance(row.get("name"), str)
                or len(row["name"]) > 120
                or type(row.get("seconds_left")) not in (int, float)
                or row["seconds_left"] < 0
                or (type(row["seconds_left"]) is float and not math.isfinite(row["seconds_left"]))
                for row in rows
            )
            or any(
                any(type(row.get(key)) is not bool for key in bool_fields)
                or not isinstance(row.get("alert_id"), str)
                or not isinstance(row.get("sink_id"), str)
                or row.get("alert_state")
                not in ("pending", "requested", "started", "drained", "stopped", "unknown")
                for row in data["finished"]
            )
        ):
            self.snapshots.pop(endpoint, None)
            return {"ok": False, "error_kind": "malformed_timer_state"}
        if publish:
            self.snapshots[endpoint] = data
            self.observed_at[endpoint] = time.monotonic()
        return data

    def adjust_available(self, endpoint: str, timer_id: str | None = None) -> bool:
        return bool(
            self.command_service == "timer_command_v2"
            and self.available(endpoint)
            and any(
                row.get("state") in {"active", "paused"}
                and _adjust_metadata(row)
                and (timer_id is None or row["id"] == timer_id)
                for row in self.snapshots[endpoint]["timers"]
            )
        )

    def declarations(self, endpoint: str) -> list[dict]:
        snapshot = self.snapshots.get(endpoint)
        if not self.available(endpoint) or not snapshot:
            return []
        descriptions = {
            "podvoice_start_timer": "Start a named HA-owned timer on this conversation's device. "
            "A start receipt is not expiry or audible delivery. Core restart clears native timers.",
            "podvoice_timer_status": "Read this device's current HA timers and finished delivery receipts. "
            "Do not invent remaining time or audible/stop proof.",
            "podvoice_cancel_timer": "Cancel one exact timer_id from fresh status. Never guess a name/ID. "
            "For a finished timer this requests alert stop; do not claim physical silence until confirmed.",
        }
        if self.adjust_available(endpoint):
            descriptions["podvoice_adjust_timer"] = (
                "Adjust one exact active/paused HA timer by delta_seconds from current status. "
                "The native owner validates its current revision; never invent IDs or duration."
            )
        rows = []
        for name, description in descriptions.items():
            properties = {}
            if name == "podvoice_start_timer":
                properties = {
                    "seconds": {"type": "integer", "minimum": 1, "maximum": 86400},
                    "name": {"type": "string", "maxLength": 120},
                }
            elif name in {"podvoice_cancel_timer", "podvoice_adjust_timer"}:
                properties = {"timer_id": {"type": "string", "minLength": 1, "maxLength": 200}}
                if name == "podvoice_adjust_timer":
                    properties["delta_seconds"] = {
                        "type": "integer",
                        "minimum": -86400,
                        "maximum": 86400,
                        "not": {"const": 0},
                    }
            rows.append(
                {
                    "name": name,
                    "description": description
                    + f" HA contract {self.contract}; epoch {snapshot['epoch']}.",
                    "parameters": {
                        "type": "object",
                        "properties": properties,
                        "required": ["seconds"]
                        if name == "podvoice_start_timer"
                        else list(properties),
                        "additionalProperties": False,
                    },
                }
            )
        return rows

    async def command(
        self,
        endpoint: str,
        *,
        request_id: str,
        action: str,
        epoch: str | None = None,
        execution_guard=None,
        deadline: float | None = None,
        **args,
    ) -> dict:
        def local_rejected(error):
            return {
                "ok": False,
                "error_kind": error,
                **({"outcome": "rejected", "retry_allowed": False} if action == "adjust" else {}),
            }

        snapshot = self.snapshots.get(endpoint)
        if not snapshot:
            return local_rejected("timer_endpoint_unavailable")
        service = self.command_service
        source = (self.client, self.token, self.contract)
        binding = self.bindings.get(endpoint)
        chosen_epoch = epoch or snapshot["epoch"]
        deadline = time.monotonic() + C.TOOL_TIMEOUT_S if deadline is None else deadline
        params = {
            "endpoint": endpoint,
            "epoch": chosen_epoch,
            "request_id": request_id,
            "action": action,
            **copy.deepcopy(args),
        }
        if action == "adjust":
            timer_id, delta = args.get("timer_id"), args.get("delta_seconds")
            row = next((row for row in snapshot.get("timers", []) if row["id"] == timer_id), None)
            if (
                set(args) - {"timer_id", "delta_seconds", "expected_revision"}
                or not isinstance(timer_id, str)
                or not self.adjust_available(endpoint, timer_id)
                or type(delta) is not int
                or delta == 0
                or not -86400 <= delta <= 86400
                or row is None
                or chosen_epoch != snapshot["epoch"]
            ):
                return local_rejected("bad_args")
            expected = args.get("expected_revision", row["revision"])
            if not _revision(expected) or expected != row["revision"]:
                return local_rejected("stale_timer_revision")
            params["expected_revision"] = expected

        def current():
            return (
                source == (self.client, self.token, self.contract)
                and service == self.command_service
                and binding == self.bindings.get(endpoint)
                and endpoint in self.ready
                and endpoint not in self._registered_invalid
                and chosen_epoch == self.snapshots.get(endpoint, {}).get("epoch")
                and (execution_guard is None or execution_guard())
            )

        if not current():
            return local_rejected("stale_execution")
        self._registered_reads[endpoint] = self._registered_reads.get(endpoint, 0) + 1
        serial = self._registered_reads[endpoint]
        try:
            unknown = {"ok": False, "error_kind": "unknown_outcome", "retry_allowed": False}

            async def send(payload):
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not current():
                    return unknown
                try:
                    return await asyncio.wait_for(
                        self._service(service, payload, mutation=True, source=source), remaining
                    )
                except TimeoutError:
                    return unknown

            result = await send(params)
            if not current():
                return unknown
            if (
                service == "timer_command_v2"
                and result.get("error_kind") == "unknown_outcome"
                and time.monotonic() < deadline
            ):
                result = await send({**params, "lookup_only": True})
                if not current():
                    return unknown
                if result.get("ok") is not True:
                    result = unknown
            if action == "adjust" and result.get("ok") is True:
                fields = {
                    "epoch",
                    "owner",
                    "restart_contract",
                    "ok",
                    "request_id",
                    "id",
                    "delta_seconds",
                    "expected_revision",
                    "duration_seconds",
                    "revision",
                    "seconds_left",
                    "state",
                }
                if (
                    set(result) != fields
                    or result["epoch"] != chosen_epoch
                    or result["restart_contract"] != "core_restart_clears_timers"
                    or result["request_id"] != request_id
                    or result["id"] != params["timer_id"]
                    or type(result["delta_seconds"]) is not int
                    or result["delta_seconds"] != params["delta_seconds"]
                    or result["expected_revision"] != params["expected_revision"]
                    or not _adjust_metadata(result)
                    or int(result["revision"]) <= int(params["expected_revision"])
                    or type(result["seconds_left"]) is not int
                    or not 1 <= result["seconds_left"] <= result["duration_seconds"]
                    or result["state"] not in {"active", "paused"}
                ):
                    return unknown
                if self._registered_reads.get(endpoint) == serial:
                    updated = copy.deepcopy(snapshot)
                    updated["timers"] = [
                        {
                            **row,
                            **{
                                key: result[key]
                                for key in ("duration_seconds", "revision", "seconds_left", "state")
                            },
                        }
                        if row["id"] == result["id"]
                        else row
                        for row in updated["timers"]
                    ]
                    self.snapshots[endpoint] = updated
                    self.observed_at[endpoint] = time.monotonic()
            return result
        finally:
            # Even outer cancellation or a failed guard must retire reads that
            # started while this mutation was in flight. Cancellation propagates.
            self._registered_reads[endpoint] = self._registered_reads.get(endpoint, 0) + 1

    async def dispatch(
        self,
        name: str,
        args: dict,
        endpoint: str,
        session: str,
        call_id: str,
        execution_guard=None,
        *,
        deadline: float | None = None,
    ) -> dict:
        deadline = time.monotonic() + C.TOOL_TIMEOUT_S if deadline is None else deadline
        old = self.snapshots.get(endpoint, {}).get("epoch")
        old_contract = self.contract
        cancel = name == "podvoice_cancel_timer"
        if cancel:
            source = (self.client, self.token, old_contract, self.command_service)
            binding = self.bindings.get(endpoint)
            expected_read = self._registered_reads.get(endpoint, 0) + 1
        state = await self.refresh(endpoint)
        if cancel and state.get("error_kind") == "stale_timer_read":
            latest = self._registered_reads.get(endpoint)
            remaining = deadline - time.monotonic()

            def cancel_source_current():
                return (
                    source == (self.client, self.token, self.contract, self.command_service)
                    and binding == self.bindings.get(endpoint)
                    and old == self.snapshots.get(endpoint, {}).get("epoch")
                    and (execution_guard is None or execution_guard())
                )

            # Exactly one competing status read may have superseded this preflight.
            # Unbinds and mutations also advance the serial, but cannot qualify here.
            if (
                latest == expected_read + 1
                and latest == self._status_read_serials.get(endpoint)
                and remaining > 0
                and cancel_source_current()
            ):
                try:
                    async with asyncio.timeout(remaining):
                        refreshed = await self.refresh(endpoint)
                except TimeoutError:
                    pass  # The original preflight failed before any mutation.
                else:
                    if cancel_source_current():
                        state = refreshed
        if (
            not state.get("ok")
            or state.get("epoch") != old
            or not old_contract
            or self.contract != old_contract
        ):
            return {"ok": False, "error_kind": "stale_schema", "retry_allowed": False}
        if name == "podvoice_timer_status":
            return state if not args else {"ok": False, "error_kind": "bad_args"}
        if not session or not call_id:
            return {"ok": False, "error_kind": "missing_completed_call"}
        request = hashlib.sha256(json.dumps([session, endpoint, call_id]).encode()).hexdigest()
        if name == "podvoice_start_timer":
            if (
                set(args) - {"seconds", "name"}
                or type(args.get("seconds")) is not int
                or not 1 <= args["seconds"] <= 86400
                or not isinstance(args.get("name", ""), str)
                or len(args.get("name", "")) > 120
            ):
                return {"ok": False, "error_kind": "bad_args"}
            return await self.command(
                endpoint,
                request_id=request,
                action="start",
                epoch=old,
                execution_guard=execution_guard,
                deadline=deadline,
                **args,
            )
        if name == "podvoice_adjust_timer":
            return await self.command(
                endpoint,
                request_id=request,
                action="adjust",
                epoch=old,
                execution_guard=execution_guard,
                deadline=deadline,
                **args,
            )
        if (
            name != "podvoice_cancel_timer"
            or set(args) != {"timer_id"}
            or not isinstance(args["timer_id"], str)
        ):
            return {"ok": False, "error_kind": "bad_args"}
        result = await self.command(
            endpoint,
            request_id=request,
            action="cancel",
            epoch=old,
            execution_guard=execution_guard,
            deadline=deadline,
            **args,
        )
        current = await self.refresh(endpoint)
        finished = next(
            (row for row in current.get("finished", []) if row["id"] == args["timer_id"]), None
        )
        if (
            result.get("ok")
            and finished
            and (
                not finished["alert_id"]
                or finished["physical_drained"]
                or finished["physical_stopped"]
            )
        ):
            ack = await self.command(
                endpoint,
                request_id=request + "-ack",
                action="acknowledge_finished",
                epoch=old,
                execution_guard=execution_guard,
                deadline=deadline,
                **args,
            )
            if ack.get("ok"):
                result["physical_stop_confirmed"] = finished["physical_stopped"]
                result["physical_drained"] = finished["physical_drained"]
        return result
