"""Private authenticated HA home location; public output contains no coordinates."""

import asyncio
import math
import re
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

from . import constants as C
from .offline_locality import Resolver

DATASET_SHA = "5a00e7740328397d7d6ce49ec52d45dbba06c2539c3af5bd41cab496da35a37b"
_resolver = None


def resolver():
    global _resolver
    if _resolver is None:
        _resolver = Resolver.load(Path(__file__).with_name("locality_data"), DATASET_SHA)
    return _resolver


def finite(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except (ValueError, OverflowError):
        return False


def valid_label(value, now=None):
    now = time.time() if now is None else now
    keys = {"name", "source", "method", "scope", "datasetVersion", "observedAt", "validUntil"}
    return (
        isinstance(value, dict)
        and set(value) == keys
        and value["source"] == "ha_home_geonames"
        and value["method"] == "nearest_populated_place"
        and value["scope"] == "ha_home"
        and isinstance(value["name"], str)
        and value["name"].startswith("Ved ")
        and 4 < len(value["name"]) <= 80
        and value["name"][4:] == value["name"][4:].strip()
        and value["name"].isprintable()
        and isinstance(value["datasetVersion"], str)
        and re.fullmatch("[a-f0-9]{64}", value["datasetVersion"]) is not None
        and all(finite(value[k]) for k in ("observedAt", "validUntil"))
        and value["observedAt"] <= now < value["validUntil"] <= value["observedAt"] + 60
    )


async def read(client, token, current):
    if client is None or not token or not current():
        return None
    try:
        deadline = time.monotonic() + 2
        async with asyncio.timeout(2):
            response = await client.get(
                f"{C.SUPERVISOR_CORE_API}/config",
                headers={"Authorization": f"Bearer {token}"},
                follow_redirects=False,
                timeout=2,
            )
            if response.status_code != 200 or not current():
                return None
            observed = time.time()
            body = response.json()
            if not isinstance(body, dict):
                return None
            coordinates: list[int | float] = []
            for raw, limit in zip(
                (body.get("latitude"), body.get("longitude")), (90, 180), strict=True
            ):
                if type(raw) not in (int, float):
                    return None
                coordinate = cast(int | float, raw)
                if not math.isfinite(coordinate) or abs(coordinate) > limit:
                    return None
                coordinates.append(coordinate)
            estimate = resolver().resolve(*coordinates)
            if (
                estimate.get("status") != "estimated"
                or not current()
                or time.monotonic() >= deadline
            ):
                return None
            label = dict(
                name=estimate["displayLabel"],
                source="ha_home_geonames",
                method="nearest_populated_place",
                scope="ha_home",
                datasetVersion=estimate["datasetSha256"],
                observedAt=observed,
                validUntil=observed + 60,
            )
            return label if valid_label(label) else None
    except Exception:
        return None


class LocalityOwner:
    """One server-owned request, renewed only by admitted weather reads.

    A request may outlive its HTTP response, never the app or its HA binding.
    Returned observations retain their original timestamps; no stale grace period.
    """

    def __init__(self):
        self._binding: object = None
        self._task: asyncio.Task | None = None
        self._label: dict | None = None
        self._generation = 0
        self._closed = False

    def _invalidate(self):
        self._generation += 1
        self._label = None
        if self._task is not None and not self._task.done():
            self._task.cancel()

    def ensure(self, binding: object, client: Any, token: str, current: Callable[[], bool]):
        if self._closed:
            return
        if binding != self._binding or not current():
            self._invalidate()
            self._binding = binding
        if not current() or client is None or not token:
            return
        # Do not create a replacement until the cancelled request has terminated.
        # This keeps one owned task even across repeated discovery/client changes.
        if self._task is not None and not self._task.done():
            return
        now = time.time()
        if (
            self._label is not None
            and valid_label(self._label, now)
            and now - self._label["observedAt"] < 15
        ):
            return
        generation = self._generation

        def admitted():
            return not self._closed and generation == self._generation and current()

        async def fetch():
            label = await read(client, token, admitted)
            if generation == self._generation and not self._closed:
                self._label = label if admitted() and valid_label(label) else None

        self._task = asyncio.create_task(fetch(), name="podview-home-locality")

    def value(self, binding: object, current: Callable[[], bool]):
        if binding != self._binding:
            return None
        if self._closed or not current():
            self._invalidate()
            return None
        if self._label is None or not valid_label(self._label):
            self._label = None
            return None
        return dict(self._label)

    async def aclose(self):
        self._closed = True
        self._invalidate()
        if self._task is not None:
            await asyncio.gather(self._task, return_exceptions=True)
        self._task = None
        self._binding = None
