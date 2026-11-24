"""Reading Home Assistant's device registry the supported way, on every pinned HA core."""

from __future__ import annotations


def device_entries(registry) -> list:
    """Every device entry in the registry.

    Iterating ``registry.devices`` is the supported enumeration: it yields the entries on HA 2026.11, where using it
    as a mapping (``.values()``, ``.get()``, subscription) is deprecated and logs a warning, and the ids on
    HA 2026.8, where it is a plain mapping and subscription is the way to the entry.
    """
    devices = registry.devices
    return [devices[item] if isinstance(item, str) else item for item in devices]
