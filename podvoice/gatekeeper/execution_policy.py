"""Server-owned authorization for tool side effects.

Realtime owns intent and the natural confirmation dialogue.  This module owns the
mechanical execution boundary: a model-produced function call is never itself proof
that a person approved a sensitive action.

The current voice/Talk transports intentionally have no approval channel.  Sensitive
calls therefore fail closed.  A future trusted UI/transport can use the three-step
``assess -> confirm -> consume`` hook without teaching this policy user phrases.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class Risk(StrEnum):
    READ_ONLY = "read_only"
    LOW_RISK = "low_risk"
    HIGH_RISK = "high_risk"
    UNKNOWN_SIDE_EFFECT = "unknown_side_effect"


@dataclass(frozen=True, slots=True)
class ExecutionContext:
    """Identity supplied by the conversation owner, never by the model."""

    session_id: str
    turn_id: str

    @property
    def valid(self) -> bool:
        return bool(self.session_id.strip() and self.turn_id.strip())


@dataclass(frozen=True, slots=True)
class Assessment:
    risk: Risk
    reason: str
    target: str

    @property
    def requires_approval(self) -> bool:
        return self.risk in {Risk.HIGH_RISK, Risk.UNKNOWN_SIDE_EFFECT}


@dataclass(frozen=True, slots=True)
class _Challenge:
    challenge_id: str
    context: ExecutionContext
    action: str
    target: str
    normalized_args: str
    args_sha256: str
    expires_at: float
    approval_turn_id: str | None = None


@dataclass(frozen=True, slots=True)
class _Approval:
    token: str
    proposal_context: ExecutionContext
    execution_context: ExecutionContext
    action: str
    target: str
    args_sha256: str
    expires_at: float


@dataclass(frozen=True, slots=True)
class ApprovedCall:
    """The exact server-held proposal released by a later trusted signal."""

    action: str
    args: dict[str, Any]
    context: ExecutionContext
    token: str


_DESTRUCTIVE = {"delete", "erase", "destroy", "remove", "wipe", "purge", "clear", "reset"}
_EXTERNAL_COMMUNICATION = {"notify", "send", "sms", "email", "telephone", "call"}
_PURCHASE = {"purchase", "buy", "order", "checkout", "payment", "pay"}
_PRIVATE_DISCLOSURE_TOOLS = {
    "podconnect_recently_played",
    "podconnect_top_tracks",
    "podconnect_liked",
}
_ACCESS_TARGETS = {"door", "dør", "gate", "port", "garage", "lås", "lock", "access"}
_TARGET_KEYS = (
    "entity_id",
    "entity",
    "device_id",
    "device",
    "name",
    "target",
    "area_id",
    "area",
    "room",
)
_TEMPERATURE_KEYS = ("temperature", "target_temperature", "target_temp", "temp")
_SAFE_TEMP_C = (17.0, 24.0)

# These are product-owned, exact contracts.  Dynamic MCP names are deliberately not
# inferred from substrings ("play" in "display", for example).  New reversible tools
# must be added through reviewed exact metadata rather than silently becoming trusted.
_EXPLICIT_READ_ONLY = {
    "GetDateTime",
    "GetLiveContext",
    "HassGetState",
    "HassClimateGetTemperature",
    "HassGetWeather",
    "google_web_sogning",
    "weather_forecast",
}
_EXPLICIT_LOW_RISK = {
    "HassLightSet",
    "HassMediaSearchAndPlay",
    "HassMediaPause",
    "HassMediaUnpause",
    "HassMediaNext",
    "HassMediaPrevious",
    "HassSetVolume",
    "podconnect_pause",
    "podconnect_play",
    "podconnect_next",
    "podconnect_previous",
    "podconnect_volume",
}


def _tokens(value: str) -> str:
    expanded = re.sub(r"(?<=[a-zæøå0-9])(?=[A-ZÆØÅ])", "_", value)
    return "_".join(part for part in expanded.casefold().replace("-", "_").split() if part)


def _contains(haystack: str, needles: tuple[str, ...]) -> bool:
    return any(needle in haystack for needle in needles)


def _words(value: str) -> set[str]:
    expanded = re.sub(r"(?<=[a-zæøå0-9])(?=[A-ZÆØÅ])", "_", value)
    return {part for part in re.split(r"[^a-zæøå0-9]+", expanded.casefold()) if part}


def _normalize(value: Any) -> Any:
    """Return a stable JSON value and reject ambiguous/non-finite arguments."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("non-finite number")
        return value
    if isinstance(value, list):
        return [_normalize(item) for item in value]
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise ValueError("argument keys must be strings")
        return {key: _normalize(value[key]) for key in sorted(value)}
    raise ValueError(f"unsupported argument type: {type(value).__name__}")


def normalize_arguments(args: dict[str, Any]) -> str:
    return json.dumps(_normalize(args), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _args_sha256(args: dict[str, Any]) -> str:
    return hashlib.sha256(normalize_arguments(args).encode()).hexdigest()


def _target(args: dict[str, Any]) -> str:
    selected = {key: args[key] for key in _TARGET_KEYS if key in args}
    return normalize_arguments(selected) if selected else "{}"


def _temperatures_c(args: dict[str, Any]) -> list[float]:
    values: list[float] = []
    unit = str(args.get("temperature_unit") or args.get("unit") or "C").casefold()
    for key in _TEMPERATURE_KEYS:
        value = args.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        temp = float(value)
        if not math.isfinite(temp):
            raise ValueError("non-finite temperature")
        if unit in {"f", "°f", "fahrenheit"}:
            temp = (temp - 32.0) * 5.0 / 9.0
        elif unit not in {"c", "°c", "celsius"}:
            raise ValueError("unknown temperature unit")
        values.append(temp)
    return values


def assess_tool(
    name: str,
    args: dict[str, Any],
    description: str = "",
    *,
    trusted_risk: Risk | None = None,
) -> Assessment:
    """Classify only the structured tool call, never user/model prose."""
    action = _tokens(name)
    words = set(action.split("_"))
    target = _target(args)
    target_words = _words(target)
    description_text = description.casefold()
    temperature_action = "climate" in action or "temperature" in action or "thermostat" in action

    if words & _DESTRUCTIVE:
        return Assessment(Risk.HIGH_RISK, "destructive_action", target)
    if words & _EXTERNAL_COMMUNICATION:
        return Assessment(Risk.HIGH_RISK, "external_communication", target)
    if words & _PURCHASE:
        return Assessment(Risk.HIGH_RISK, "purchase_or_payment", target)
    if name in _PRIVATE_DISCLOSURE_TOOLS:
        return Assessment(Risk.HIGH_RISK, "private_account_disclosure", target)
    if "disarm" in action or ("alarm" in action and _contains(action, ("off", "disable"))):
        return Assessment(Risk.HIGH_RISK, "alarm_disarm", target)
    if words & {"unlock", "unlatch"}:
        return Assessment(Risk.HIGH_RISK, "unlock_access", target)
    # Declaration prose can strengthen a denial but never grant permission.
    if _contains(description_text, ("unlock", "disarm", "purchase", "delete")):
        return Assessment(Risk.HIGH_RISK, "sensitive_tool_description", target)
    # Exact product-reviewed reads must be recognized before the generic
    # climate/temperature mutation classifier.
    if name in _EXPLICIT_READ_ONLY:
        return Assessment(Risk.READ_ONLY, "known_exact_read_contract", target)
    # A trusted grant comes only from server-side canonical state (or an explicit
    # reviewed product contract), never from model slots or provider prose.  Keep
    # intrinsically destructive action names above this boundary.
    if trusted_risk in {Risk.READ_ONLY, Risk.LOW_RISK}:
        return Assessment(trusted_risk, "explicit_trusted_contract", target)
    if words & {"open", "on", "activate"} and target_words & _ACCESS_TARGETS:
        return Assessment(Risk.HIGH_RISK, "open_access", target)

    if temperature_action:
        try:
            temperatures = _temperatures_c(args)
        except ValueError:
            return Assessment(Risk.HIGH_RISK, "unverifiable_temperature", target)
        if not temperatures:
            return Assessment(Risk.UNKNOWN_SIDE_EFFECT, "temperature_without_target", target)
        if any(not (_SAFE_TEMP_C[0] <= value <= _SAFE_TEMP_C[1]) for value in temperatures):
            return Assessment(Risk.HIGH_RISK, "unsafe_temperature", target)
        # Range alone is not enough: the product contract also limits a frictionless
        # change to +/-3 C from the canonical HA state.  Only ToolRouter can prove
        # that, because model arguments and declaration prose are not authority.
        return Assessment(Risk.UNKNOWN_SIDE_EFFECT, "unverified_temperature_delta", target)

    if name in _EXPLICIT_LOW_RISK:
        return Assessment(Risk.LOW_RISK, "known_exact_reversible_contract", target)

    # Descriptions can strengthen a denial but never grant permission.  They are
    # provider-controlled prose and therefore not an authorization primitive.
    return Assessment(Risk.UNKNOWN_SIDE_EFFECT, "unknown_potential_side_effect", target)


class ExecutionPolicy:
    """Short-lived, one-shot approvals bound to an exact structured call."""

    def __init__(
        self,
        *,
        ttl_s: float = 30.0,
        clock: Callable[[], float] = time.monotonic,
        trusted_tools: dict[str, Risk] | None = None,
    ) -> None:
        if ttl_s <= 0:
            raise ValueError("ttl_s must be positive")
        self._ttl_s = ttl_s
        self._clock = clock
        self._trusted_tools = dict(trusted_tools or {})
        if any(
            risk not in {Risk.READ_ONLY, Risk.LOW_RISK} for risk in self._trusted_tools.values()
        ):
            raise ValueError("trusted tool overrides may only grant read-only or low-risk")
        self._challenges: dict[str, _Challenge] = {}
        self._approvals: dict[str, _Approval] = {}
        self._consumed_confirmation_turns: set[ExecutionContext] = set()

    def authorize(
        self,
        name: str,
        args: dict[str, Any],
        *,
        description: str = "",
        context: ExecutionContext | None = None,
        approval_token: str | None = None,
        trusted_risk: Risk | None = None,
    ) -> dict[str, Any] | None:
        """Return ``None`` when execution is allowed, otherwise a tool result."""
        try:
            assessment = assess_tool(
                name,
                args,
                description,
                trusted_risk=trusted_risk or self._trusted_tools.get(name),
            )
            args_sha256 = _args_sha256(args)
        except (TypeError, ValueError) as exc:
            return {
                "ok": False,
                "error_kind": "invalid_arguments",
                "error": f"tool arguments cannot be authorized: {exc}",
            }
        if not assessment.requires_approval:
            return None

        self._prune()
        if approval_token and context and context.valid:
            approval = self._approvals.pop(approval_token, None)
            if approval and self._matches(
                approval, context, name, assessment.target, args_sha256, self._clock()
            ):
                return None

        result: dict[str, Any] = {
            "ok": False,
            "error_kind": "needs_confirmation",
            "needs_confirmation": True,
            "risk": assessment.risk.value,
            "reason": assessment.reason,
            "action": name,
            "target": assessment.target,
            "arguments_sha256": args_sha256,
            "error": "the action requires explicit server-side approval before execution",
        }
        if context and context.valid:
            challenge_id = secrets.token_urlsafe(24)
            self._challenges[challenge_id] = _Challenge(
                challenge_id,
                context,
                name,
                assessment.target,
                normalize_arguments(args),
                args_sha256,
                self._clock() + self._ttl_s,
            )
            result["approval"] = {
                "challenge_id": challenge_id,
                "expires_in_s": self._ttl_s,
                "session_id": context.session_id,
                "turn_id": context.turn_id,
            }
        else:
            result["approval"] = {
                "available": False,
                "reason": "missing trusted session/turn context",
            }
        return result

    def confirm(
        self,
        challenge_id: str,
        *,
        confirmation_context: ExecutionContext,
    ) -> ApprovedCall | None:
        """Release the exact proposal after a trusted explicit later-turn signal.

        This does not inspect speech or model text.  The signal must arrive on a later
        turn in the same session; no current PodVoice transport calls this method.
        """
        self._prune()
        challenge = self._challenges.pop(challenge_id, None)
        now = self._clock()
        if (
            challenge is None
            or not confirmation_context.valid
            or confirmation_context in self._consumed_confirmation_turns
        ):
            return None
        if (
            challenge.context.session_id != confirmation_context.session_id
            or challenge.approval_turn_id != confirmation_context.turn_id
        ):
            return None
        if challenge.expires_at < now:
            return None
        self._consumed_confirmation_turns.add(confirmation_context)
        token = secrets.token_urlsafe(32)
        self._approvals[token] = _Approval(
            token,
            challenge.context,
            confirmation_context,
            challenge.action,
            challenge.target,
            challenge.args_sha256,
            min(challenge.expires_at, now + self._ttl_s),
        )
        args = json.loads(challenge.normalized_args)
        if not isinstance(args, dict):  # normalize_arguments(dict) guarantees this
            return None
        return ApprovedCall(challenge.action, args, confirmation_context, token)

    def begin_turn(self, context: ExecutionContext) -> None:
        """Bind pending challenges to exactly the immediately following user turn.

        ThinSession calls this once at its authoritative new-turn boundary. A
        challenge is created after that edge on the proposal turn, becomes eligible
        on the next edge, and is deleted on any later edge. No speech or model text is
        inspected here.
        """
        if not context.valid:
            return
        self._prune()
        updated: dict[str, _Challenge] = {}
        for challenge_id, challenge in self._challenges.items():
            if challenge.context.session_id != context.session_id:
                updated[challenge_id] = challenge
                continue
            if challenge.context.turn_id == context.turn_id:
                updated[challenge_id] = challenge
                continue
            if challenge.approval_turn_id is None:
                updated[challenge_id] = _Challenge(
                    challenge.challenge_id,
                    challenge.context,
                    challenge.action,
                    challenge.target,
                    challenge.normalized_args,
                    challenge.args_sha256,
                    challenge.expires_at,
                    context.turn_id,
                )
            # A challenge already bound to an older next turn expires here.
        self._challenges = updated

    def clear_session(self, session_id: str) -> None:
        """Invalidate pending and approved actions during conversation teardown."""
        self._challenges = {
            key: value
            for key, value in self._challenges.items()
            if value.context.session_id != session_id
        }
        self._approvals = {
            key: value
            for key, value in self._approvals.items()
            if value.proposal_context.session_id != session_id
        }
        self._consumed_confirmation_turns = {
            context
            for context in self._consumed_confirmation_turns
            if context.session_id != session_id
        }

    def _prune(self) -> None:
        now = self._clock()
        self._challenges = {
            key: value for key, value in self._challenges.items() if value.expires_at >= now
        }
        self._approvals = {
            key: value for key, value in self._approvals.items() if value.expires_at >= now
        }

    @staticmethod
    def _matches(
        approval: _Approval,
        context: ExecutionContext,
        action: str,
        target: str,
        args_sha256: str,
        now: float,
    ) -> bool:
        return (
            approval.expires_at >= now
            and approval.execution_context == context
            and approval.action == action
            and approval.target == target
            and secrets.compare_digest(approval.args_sha256, args_sha256)
        )
