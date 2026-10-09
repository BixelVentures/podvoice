"""Typed HA native timer services; no countdown, scheduler or speech semantics."""

from __future__ import annotations

import hashlib
import json
import time

import httpx

from . import constants as C

TOOLS = {"podvoice_start_timer", "podvoice_timer_status", "podvoice_cancel_timer"}
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


class HomeAssistantTimers:
    def __init__(self, client: httpx.AsyncClient | None, token: str) -> None:
        self.client, self.token = client, token
        self.contract = ""
        self.bindings: dict[str, tuple[str, str]] = {}
        self.snapshots: dict[str, dict] = {}
        self.observed_at: dict[str, float] = {}
        self.ready: set[str] = set()

    def discover(self, domains: list) -> None:
        self.contract = ""
        for domain in domains:
            if domain.get("domain") != "podvoice":
                continue
            services = domain.get("services", {})
            status, command = services.get("timer_status", {}), services.get("timer_command", {})
            if (
                status.get("response") != {"optional": False}
                or command.get("response") != {"optional": False}
                or set(status.get("fields", {})) != {"endpoint"}
                or set(command.get("fields", {})) != _FIELDS
            ):
                return
            actions = (
                command["fields"]["action"].get("selector", {}).get("select", {}).get("options")
            )
            if actions != [
                "start",
                "cancel",
                "acknowledge_finished",
                "claim_alert",
                "report_alert",
            ]:
                return
            self.contract = hashlib.sha256(
                json.dumps(services, sort_keys=True).encode()
            ).hexdigest()
            return

    def bind(self, endpoint: str, kind: str, identity: str) -> None:
        binding = (kind, identity.lower())
        if self.bindings.get(endpoint) != binding:
            self.snapshots.pop(endpoint, None)
            self.observed_at.pop(endpoint, None)
        self.bindings[endpoint] = binding
        self.ready.add(endpoint)

    def unbind(self, endpoint: str) -> None:
        self.ready.discard(endpoint)

    def available(self, endpoint: str) -> bool:
        # Freshness bounds service admission only; never used to count down a timer.
        return bool(
            self.contract
            and endpoint in self.ready
            and endpoint in self.snapshots
            and time.monotonic() - self.observed_at.get(endpoint, 0) <= 15
        )

    async def _service(self, service: str, args: dict, *, mutation: bool = False) -> dict:
        if not self.client or not self.token or not self.contract:
            return {"ok": False, "error_kind": "timer_unavailable"}
        try:
            response = await self.client.post(
                f"{C.SUPERVISOR_CORE_API}/services/podvoice/{service}?return_response",
                headers={"Authorization": f"Bearer {self.token}"},
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

    async def refresh(self, endpoint: str) -> dict:
        data = await self._service("timer_status", {"endpoint": endpoint})
        binding = data.get("binding", {})
        expected = self.bindings.get(endpoint)
        if (
            not isinstance(binding, dict)
            or not data.get("ok")
            or data.get("contract") != "podvoice_native_timers_v1"
            or data.get("endpoint") != endpoint
            or not expected
            or (binding.get("kind"), binding.get("identity")) != expected
            or not isinstance(binding.get("device_id"), str)
            or not isinstance(data.get("timers"), list)
            or not isinstance(data.get("finished"), list)
        ):
            self.snapshots.pop(endpoint, None)
            return {"ok": False, "error_kind": "timer_endpoint_unavailable"}
        rows = data["timers"] + data["finished"]
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
        self.snapshots[endpoint] = data
        self.observed_at[endpoint] = time.monotonic()
        return data

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
        rows = []
        for name, description in descriptions.items():
            properties = {}
            if name == "podvoice_start_timer":
                properties = {
                    "seconds": {"type": "integer", "minimum": 1, "maximum": 86400},
                    "name": {"type": "string", "maxLength": 120},
                }
            elif name == "podvoice_cancel_timer":
                properties = {"timer_id": {"type": "string", "minLength": 1, "maxLength": 200}}
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
        **args,
    ) -> dict:
        snapshot = self.snapshots.get(endpoint)
        if not snapshot:
            return {"ok": False, "error_kind": "timer_endpoint_unavailable"}
        if execution_guard is not None and not execution_guard():
            return {"ok": False, "error_kind": "stale_execution"}
        return await self._service(
            "timer_command",
            {
                "endpoint": endpoint,
                "epoch": epoch or snapshot["epoch"],
                "request_id": request_id,
                "action": action,
                **args,
            },
            mutation=True,
        )

    async def dispatch(
        self, name: str, args: dict, endpoint: str, session: str, call_id: str, execution_guard=None
    ) -> dict:
        old = self.snapshots.get(endpoint, {}).get("epoch")
        old_contract = self.contract
        state = await self.refresh(endpoint)
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
                **args,
            )
            if ack.get("ok"):
                result["physical_stop_confirmed"] = finished["physical_stopped"]
                result["physical_drained"] = finished["physical_drained"]
        return result
