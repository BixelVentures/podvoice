"""Panel services: the bridge to the PodVoice add-on (answers, alarm). Placeholder until its owner fills it."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

DOMAIN = "podvoice"


async def async_setup_services(hass: HomeAssistant, entry: ConfigEntry) -> list[str]:
    """Register this module's services; return their names so unload removes them."""
    return []
