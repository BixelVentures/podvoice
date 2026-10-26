"""Redacted, passive read correlation; never participates in authorization."""

import contextvars
import hashlib
import json
import logging
import re

_READ_HASH = contextvars.ContextVar("podview_read_hash", default=None)
_UUID4 = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
_LOG = logging.getLogger("podvoice.podview")


def read_hash():
    return _READ_HASH.get() or "none"


async def observe_read(request, handler, kind):
    """Observe response class with only an optional canonical client read hash."""
    try:
        values = request.headers.getall("X-PodView-Read-Id", [])
        value = values[0] if len(values) == 1 else ""
    except Exception:
        value = ""
    digest = (
        hashlib.sha256(value.encode("ascii")).hexdigest()[:16] if _UUID4.fullmatch(value) else None
    )
    token = _READ_HASH.set(digest)
    try:
        try:
            response = await handler(request)
        except Exception:
            _log(kind, digest, "exception", "none")
            raise
        reason = "none"
        failed = False
        try:
            body = json.loads(response.body) if response.body else {}
            if isinstance(body, dict):
                if body.get("status") == "unavailable":
                    failed = True
                    reason = body.get("reason")
                elif body.get("ok") is False:
                    failed = True
                    reason = body.get("error")
        except (ValueError, TypeError, AttributeError):
            pass
        allowed = {
            "stale_observation",
            "account_unavailable",
            "owner_changed",
            "invalid_queue_offer",
            "invalid_queue_target",
            "queue_not_paired",
            "queue_unavailable",
            "music_unavailable",
        }
        reason = reason if isinstance(reason, str) and reason in allowed else "other"
        if response.status >= 400 or failed:
            _log(kind, digest, reason, response.status)
        return response
    finally:
        _READ_HASH.reset(token)


def _log(kind, digest, reason, status):
    try:
        if digest:
            _LOG.warning(
                "podview_read kind=%s readHash=%s reason=%s http_status=%s",
                kind,
                digest,
                reason,
                status,
            )
    except Exception:
        pass
