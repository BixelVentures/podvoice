"""One bounded terminal log, without source content or account/session identifiers."""

import contextvars
import hashlib
import logging
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field

_LOG = logging.getLogger("podvoice.mood")
_PHASES = frozenset(
    {
        "playback_before",
        "time_context",
        "model",
        "playlist_search",
        "playback_after",
        "publish",
        "parallel_selection_search",
    }
)
_REASONS = frozenset(
    {
        "none",
        "not_ready",
        "time_owner_missing",
        "time_tool_missing",
        "time_result_invalid",
        "time_format_invalid",
        "request_too_large",
        "provider_capacity",
        "reservation_rejected",
        "owner_or_capacity_changed",
        "owner_changed",
        "response_too_large",
        "response_not_completed",
        "response_messages_invalid",
        "response_parts_invalid",
        "theme_ids_invalid",
        "provider_http",
        "provider_transport",
        "model_timeout",
        "model_parse",
        "provider_budget",
        "route_deadline",
        "owner_timeout",
        "route_exception",
        "cancelled",
    }
)
_KINDS = frozenset({"mood", "feeling"})
_OUTCOMES = frozenset(
    {
        "success",
        "cancelled",
        "mood_owner_unavailable",
        "mood_refresh_required",
        "mood_budget_unavailable",
        "mood_selection_unavailable",
        "mood_catalogue_unavailable",
        "mood_catalogue_empty",
        "mood_owner_replaced",
        "mood_source_rejected",
        "mood_unavailable",
        "feeling_owner_unavailable",
        "feeling_refresh_required",
        "feeling_restart_available",
        "feeling_budget_unavailable",
        "feeling_selection_unavailable",
        "feeling_catalogue_unavailable",
        "feeling_catalogue_empty",
        "feeling_owner_replaced",
        "feeling_source_rejected",
        "feeling_unavailable",
    }
)


@dataclass
class MoodDiagnostic:
    kind: str = "mood"
    phase: str = "playback_before"
    outcome: str = "mood_unavailable"
    reason: str = "none"
    http_status: int | None = None
    response: str = "none"
    candidate_set_present: bool = False
    selection_allowed: bool | None = None
    selection_reason: str = "other"
    trace_ref: str = "none"
    _clock: Callable[[], float] = field(default=time.monotonic, repr=False)
    _started: float = field(init=False, repr=False)
    _phase_started: float = field(init=False, repr=False)
    _durations: dict[str, float] = field(default_factory=dict, repr=False)

    def __post_init__(self):
        self._started = self._phase_started = self._clock()

    def step(self, phase):
        now = self._clock()
        previous = _closed(self.phase, _PHASES)
        if previous in _PHASES:
            self._durations[previous] = self._durations.get(previous, 0) + max(
                0, now - self._phase_started
            )
        self.phase, self._phase_started = _closed(phase, _PHASES), now

    def timings(self):
        self.step(self.phase)

        def milliseconds(seconds):
            return min(60000, max(0, round(seconds * 1000)))

        return (
            milliseconds(self._phase_started - self._started),
            *(
                milliseconds(self._durations.get(phase, 0))
                for phase in (
                    "playback_before",
                    "time_context",
                    "model",
                    "parallel_selection_search",
                    "playlist_search",
                    "playback_after",
                    "publish",
                )
            ),
        )


_CURRENT: contextvars.ContextVar[MoodDiagnostic | None] = contextvars.ContextVar(
    "mood_diagnostic", default=None
)


def begin(
    *,
    clock=time.monotonic,
    kind="mood",
    selection_allowed=None,
    selection_reason="other",
    trace_ref="none",
):
    diagnostic = MoodDiagnostic(
        _clock=clock,
        kind=_closed(kind, _KINDS),
        selection_allowed=selection_allowed if type(selection_allowed) is bool else None,
        selection_reason=_closed(
            selection_reason,
            {
                "none",
                "other",
                "room_start_unavailable",
                "move_fenced",
                "policy_room_mismatch",
                "grant_not_current",
                "tools_changed",
                "no_eligible_policy_target",
            },
        ),
        trace_ref=trace_ref
        if isinstance(trace_ref, str) and re.fullmatch(r"[a-f0-9]{16}", trace_ref)
        else "none",
    )
    return diagnostic, _CURRENT.set(diagnostic)


def request_trace(headers):
    """Hash only a single canonical UUID4; invalid diagnostic input is ignored."""
    try:
        values = (
            headers.getall("X-PodView-Trace", [])
            if hasattr(headers, "getall")
            else [headers.get("X-PodView-Trace", "")]
        )
        value = values[0] if len(values) == 1 else ""
        if isinstance(value, str) and re.fullmatch(
            r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", value
        ):
            return hashlib.sha256(value.encode("ascii")).hexdigest()[:16]
    except Exception:
        pass
    return "none"


def selection_reason(bridge, room, token, writable):
    """Inspect existing in-memory predicates, for diagnostics, never authority."""
    try:
        if writable:
            return "none"
        music = bridge.controls.music
        policy = bridge.controls.policy
        checks = (
            (not music.room_start_available, "room_start_unavailable"),
            (policy.get("roomId") != room, "policy_room_mismatch"),
            (not bridge._grant_current(room, token), "grant_not_current"),
            (music.tools is not bridge.tools, "tools_changed"),
            (
                not any(
                    "play_context" in row["actions"]
                    and music.context_available
                    and all(
                        isinstance(row.get(key), str) and row[key]
                        for key in ("nativeRoomId", "nativeHomepodId")
                    )
                    for row in policy["music"]
                ),
                "no_eligible_policy_target",
            ),
        )
        return next((label for failed, label in checks if failed), "other")
    except Exception:
        return "other"


def _closed(value, allowed):
    return value if isinstance(value, str) and value in allowed else "other"


def note(reason: str, http_status=None):
    diagnostic = _CURRENT.get()
    if diagnostic is not None:
        diagnostic.reason = _closed(reason, _REASONS)
        diagnostic.http_status = (
            http_status if type(http_status) is int and 100 <= http_status <= 599 else None
        )


def finish(diagnostic, token):
    _CURRENT.reset(token)
    try:
        _LOG.info(
            "mood_result phase=%s outcome=%s reason=%s http_status=%s kind=%s "
            "total_ms=%s playback_before_ms=%s time_context_ms=%s model_ms=%s "
            "parallel_selection_search_ms=%s playlist_search_ms=%s playback_after_ms=%s publish_ms=%s "
            "response=%s candidate_set_present=%s selection_allowed=%s selection_reason=%s trace_ref=%s",
            _closed(diagnostic.phase, _PHASES),
            _closed(diagnostic.outcome, _OUTCOMES),
            _closed(diagnostic.reason, _REASONS),
            diagnostic.http_status
            if type(diagnostic.http_status) is int and 100 <= diagnostic.http_status <= 599
            else "none",
            _closed(diagnostic.kind, _KINDS),
            *diagnostic.timings(),
            _closed(diagnostic.response, {"preview", "full", "none"}),
            diagnostic.candidate_set_present is True,
            diagnostic.selection_allowed
            if type(diagnostic.selection_allowed) is bool
            else "unknown",
            _closed(
                diagnostic.selection_reason,
                {
                    "none",
                    "other",
                    "room_start_unavailable",
                    "move_fenced",
                    "policy_room_mismatch",
                    "grant_not_current",
                    "tools_changed",
                    "no_eligible_policy_target",
                },
            ),
            diagnostic.trace_ref
            if isinstance(diagnostic.trace_ref, str)
            and re.fullmatch(r"[a-f0-9]{16}", diagnostic.trace_ref)
            else "none",
        )
    except Exception:
        pass  # Observability must not replace a response or interrupt cancellation cleanup.


def admission(kind, reason, status):
    """Record only fixed route decisions before an aggregate attempt exists."""
    try:
        _LOG.info(
            "mood_admission kind=%s reason=%s http_status=%s",
            _closed(kind, _KINDS),
            _closed(
                reason,
                frozenset(
                    {
                        "guard_denied",
                        "room_required",
                        "invalid_request",
                        "not_admitted",
                        "busy",
                        "read_busy",
                        "selection_busy",
                        "owner_changed",
                        "tools_unavailable",
                    }
                ),
            ),
            status if type(status) is int and status in {400, 403, 409, 429, 503} else "other",
        )
    except Exception:
        pass
