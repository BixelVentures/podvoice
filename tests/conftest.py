"""Shared test fixtures and a deterministic fake clock.

The gatekeeper core (state, audio, podconnect, heartbeat, gatekeeper, config) is
stdlib/httpx-only and imports cleanly without the Gemini / ESPHome SDKs, so the
unit suite runs anywhere. SDK-bound modules are exercised only through fakes.
"""

from __future__ import annotations

import pytest


class FakeClock:
    """Monotonic clock you can advance by hand."""

    def __init__(self, start: float = 1000.0) -> None:
        self._t = start

    def time(self) -> float:
        return self._t

    def advance(self, seconds: float) -> None:
        self._t += seconds


@pytest.fixture
def fake_clock() -> FakeClock:
    return FakeClock()


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """CI splits the suite with PYTEST_SHARD=i/n; each test file lands in exactly one shard."""
    import os

    shard = os.environ.get("PYTEST_SHARD", "")
    if not shard:
        return
    index, total = (int(part) for part in shard.split("/"))
    files = sorted({str(item.path) for item in items})
    mine = {path for position, path in enumerate(files) if position % total == index}
    selected = [item for item in items if str(item.path) in mine]
    config.hook.pytest_deselected(items=[item for item in items if str(item.path) not in mine])
    items[:] = selected
