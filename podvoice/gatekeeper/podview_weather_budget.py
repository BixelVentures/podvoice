"""Compatibility seam for the retired local weather-generation quota.

Weather advice has no local daily limit or interval between distinct weather keys.
The provider's shared capacity/token budget and the owner's weather-key cache still
own admission. Existing quota files are left untouched and are no longer read.
"""

from __future__ import annotations

import time
from pathlib import Path


class WeatherAllowance:
    """Non-metering compatibility with trusted startup and the provider adapter."""

    def __init__(self, path: Path, *, clock=time.time, snapshot: dict | None = None):
        self.path = Path(path)

    @property
    def remaining(self) -> int:
        # A positive admission hint, not a request count or a refillable balance.
        return 1

    @property
    def available(self) -> bool:
        return True

    def reserve(self) -> bool:
        return True

    async def reserve_async(self) -> bool:
        return True

    @classmethod
    def provision(cls, path: Path, *, clock=time.time) -> WeatherAllowance:
        """Keep legacy state intact; local quota storage cannot gate generation."""
        return cls(path, clock=clock)
