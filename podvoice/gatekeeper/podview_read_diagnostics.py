"""Redacted, passive read correlation; never participates in authorization."""

import contextvars
import logging
import re

_READ_HASH: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "podview_read_hash", default=None
)
_UUID4 = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
_LOG = logging.getLogger("podvoice.podview")


def read_hash():
    return _READ_HASH.get() or "none"
