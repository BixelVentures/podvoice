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
    """CI splits the suite with PYTEST_SHARD=i/n; each test lands in exactly one shard."""
    import os

    shard = os.environ.get("PYTEST_SHARD", "")
    if not shard:
        return
    index, total = (int(part) for part in shard.split("/"))
    # Round-robin over sorted test ids spreads the few slow tests (and their parameters).
    order = {nodeid: position for position, nodeid in enumerate(sorted(i.nodeid for i in items))}
    selected = [item for item in items if order[item.nodeid] % total == index]
    deselected = [item for item in items if order[item.nodeid] % total != index]
    config.hook.pytest_deselected(items=deselected)
    items[:] = selected


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "virtual_time: run the test on an event loop whose clock only advances when idle "
        "(tests/virtual_time.py)",
    )


def pytest_asyncio_loop_factories(config: pytest.Config, item: pytest.Item):
    """``virtual_time`` tests run on a loop whose clock only advances when it is idle."""
    import asyncio

    if item.get_closest_marker("virtual_time") is None:
        return {"asyncio": asyncio.new_event_loop}
    import virtual_time

    virtual_time.install()
    return {"virtual_time": virtual_time.VirtualTimeEventLoop}
