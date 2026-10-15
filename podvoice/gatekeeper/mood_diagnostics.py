"""One bounded terminal log, without source content or account/session identifiers."""

import contextvars
import logging
from dataclasses import dataclass

_LOG = logging.getLogger("podvoice.mood")
_PHASES = frozenset(
    {"playback_before", "time_context", "model", "playlist_search", "playback_after", "publish"}
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
    }
)


@dataclass
class MoodDiagnostic:
    phase: str = "playback_before"
    outcome: str = "mood_unavailable"
    reason: str = "none"
    http_status: int | None = None


_CURRENT: contextvars.ContextVar[MoodDiagnostic | None] = contextvars.ContextVar(
    "mood_diagnostic", default=None
)


def begin():
    diagnostic = MoodDiagnostic()
    return diagnostic, _CURRENT.set(diagnostic)


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
            "mood_result phase=%s outcome=%s reason=%s http_status=%s",
            _closed(diagnostic.phase, _PHASES),
            _closed(diagnostic.outcome, _OUTCOMES),
            _closed(diagnostic.reason, _REASONS),
            diagnostic.http_status
            if type(diagnostic.http_status) is int and 100 <= diagnostic.http_status <= 599
            else "none",
        )
    except Exception:
        pass  # Observability must not replace a response or interrupt cancellation cleanup.
