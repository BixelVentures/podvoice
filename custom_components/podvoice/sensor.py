"""``sensor.podview_fotoalbum``: Ro's shared album at a glance (diagnostic).

The state is the number of cached photos; the attributes are the album's name, the last sync, the last error and the
link with its album id left out. A state is written only when one of them changed (the recorder is on slow eMMC).
"""

from __future__ import annotations

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import photos


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([PodViewPhotoAlbum(hass, entry)])


class PodViewPhotoAlbum(SensorEntity):
    """The number of photos Ro has from the shared iCloud album."""

    _attr_name = "PodView fotoalbum"
    _attr_icon = "mdi:image-multiple"
    _attr_native_unit_of_measurement = "billeder"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_should_poll = False

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entity_id = "sensor.podview_fotoalbum"
        self._attr_unique_id = f"{entry.entry_id}_podview_fotoalbum"
        self._written: tuple | None = None
        self._compute()

    def _compute(self) -> tuple:
        album = photos.album_of(self.hass)
        status = album.status() if album else {"configured": False, "album": "", "count": 0}
        self._attr_native_value = status["count"] if status["configured"] else None
        self._attr_extra_state_attributes = {
            "album": status.get("album") or None,
            "last_sync": status.get("last_sync"),
            "last_error": status.get("last_error"),
            "link": photos.link_for_diagnostics(album) or None,
        }
        return (self._attr_native_value, *self._attr_extra_state_attributes.values())

    async def async_added_to_hass(self) -> None:
        album = photos.album_of(self.hass)
        if album is not None:
            self.async_on_remove(album.listen(self._refresh))
        self._written = self._compute()

    @callback
    def _refresh(self) -> None:
        signature = self._compute()
        if signature != self._written:
            self._written = signature
            self.async_write_ha_state()
