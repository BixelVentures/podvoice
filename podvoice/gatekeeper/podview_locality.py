"""Private authenticated HA home location; public output contains no coordinates."""

import asyncio
import math
import re
import time
from pathlib import Path

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
        and value["observedAt"] <= now < value["validUntil"] <= value["observedAt"] + 30
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
            coordinates = [body.get("latitude"), body.get("longitude")]
            if any(
                type(x) not in (int, float) or not math.isfinite(x) or abs(x) > limit
                for x, limit in zip(coordinates, (90, 180), strict=True)
            ):
                return None
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
                validUntil=observed + 30,
            )
            return label if valid_label(label) else None
    except Exception:
        return None
