"""Import explicit PodVoice endpoints without pretending ESPHome is configured."""

from homeassistant.config_entries import ConfigFlow

from . import DOMAIN, ENDPOINT_SCHEMA


class PodVoiceConfigFlow(ConfigFlow, domain=DOMAIN):
    """One HA entry owns the configured timer delivery endpoints."""

    VERSION = 1

    async def async_step_import(self, user_input: dict) -> dict:
        await self.async_set_unique_id("podvoice_timer_endpoints")
        self._abort_if_unique_id_configured()
        endpoints = [ENDPOINT_SCHEMA(item) for item in user_input["endpoints"]]
        return self.async_create_entry(title="PodVoice", data={"endpoints": endpoints})
