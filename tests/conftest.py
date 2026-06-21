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
