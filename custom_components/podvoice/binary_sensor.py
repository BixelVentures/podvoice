"""Whether the PodView wall screen is alive, from the panel's own heartbeat.

The recorder sits on slow eMMC, so a heartbeat does not write a state row: the state is
written when it means something (online/offline, bundle, staleness, room) and otherwise
at most every ten minutes.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_time_interval

from . import panel_ws

ONLINE_FOR = timedelta(seconds=180)
CHECK_EVERY = timedelta(seconds=30)
REFRESH_EVERY = timedelta(minutes=10)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([PodViewWallOnline(entry, panel_ws.panel_health(hass))])


class PodViewWallOnline(BinarySensorEntity):
    """On while the last PodView heartbeat is younger than three minutes."""

    _attr_name = "PodView væg online"
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_should_poll = False
    _unrecorded_attributes = frozenset({"last_heartbeat", "uptime_s"})

    def __init__(self, entry: ConfigEntry, health: panel_ws.PanelHealth) -> None:
        self._health = health
        self._attr_unique_id = f"{entry.entry_id}_podview_wall_online"
        self._written: tuple | None = None
        self._written_at: datetime | None = None
        self._written_heartbeat: datetime | None = None
        self._compute(panel_ws.utcnow())

    def _compute(self, now: datetime) -> tuple:
        health = self._health
        last = health.last_heartbeat
        self._attr_is_on = last is not None and now - last < ONLINE_FOR
        self._attr_extra_state_attributes = {
            "last_heartbeat": last.isoformat() if last else None,
            "bundle": health.bundle,
            "expected_bundle": health.expected_bundle,
            "stale": health.stale,
            "uptime_s": health.uptime_s,
            "room": health.room,
        }
        return (self._attr_is_on, health.bundle, health.expected_bundle, health.stale, health.room)

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self._health.listen(self._refresh))
        self.async_on_remove(async_track_time_interval(self.hass, self._tick, CHECK_EVERY))
        # The platform writes the first state right after this.
        now = panel_ws.utcnow()
        self._written, self._written_at = self._compute(now), now
        self._written_heartbeat = self._health.last_heartbeat

    @callback
    def _tick(self, _now: datetime) -> None:
        self._refresh()

    @callback
    def _refresh(self) -> None:
        now = panel_ws.utcnow()
        signature = self._compute(now)
        changed = signature != self._written
        refresh = (
            self._health.last_heartbeat != self._written_heartbeat
            and (self._written_at is None or now - self._written_at >= REFRESH_EVERY)
        )
        if changed or refresh:
            self._written, self._written_at = signature, now
            self._written_heartbeat = self._health.last_heartbeat
            self.async_write_ha_state()
