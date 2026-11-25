"""The place Vejr names (podvoice.weather_place): the add-on's city, else HA's place, never a forecast's name."""

import importlib.util
import sys
import types
from pathlib import Path
from types import SimpleNamespace


def _load():
    """The module with only the HA names it imports stubbed (unit tests run without HA core)."""
    stubs = {
        "voluptuous": {"Schema": lambda *args, **kwargs: None},
        "homeassistant": {},
        "homeassistant.config_entries": {"ConfigEntry": object},
        "homeassistant.core": {
            "HomeAssistant": object,
            "ServiceCall": object,
            "SupportsResponse": SimpleNamespace(ONLY="only"),
        },
        "homeassistant.exceptions": {"Unauthorized": PermissionError},
    }
    saved = {name: sys.modules.get(name) for name in stubs}
    for name, values in stubs.items():
        stub = types.ModuleType(name)
        stub.__dict__.update(values)
        sys.modules[name] = stub
    try:
        source = Path(__file__).resolve().parents[2] / "custom_components/podvoice/weather_place.py"
        spec = importlib.util.spec_from_file_location("podvoice_ha_weather_place", source)
        loaded = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = loaded
        spec.loader.exec_module(loaded)
        return loaded
    finally:
        for name, previous in saved.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous


module = _load()


class Addons:
    def __init__(self, options):
        self.options = options

    async def list(self):
        return [SimpleNamespace(slug="a0d7b954_podvoice"), SimpleNamespace(slug="other")]

    async def addon_info(self, slug):
        assert slug == "a0d7b954_podvoice"
        return SimpleNamespace(options=self.options)


def hass(location_name="Home", zone="Hjem"):
    states = {"zone.home": SimpleNamespace(attributes={"friendly_name": zone})} if zone else {}
    return SimpleNamespace(
        config=SimpleNamespace(location_name=location_name), states=SimpleNamespace(get=states.get)
    )


def supervisor(monkeypatch, options):
    handler = types.ModuleType("homeassistant.components.hassio.handler")
    if options is None:

        def get_supervisor_client(_hass):
            raise RuntimeError("no supervisor")
    else:

        def get_supervisor_client(_hass):
            return SimpleNamespace(addons=Addons(options))

    handler.get_supervisor_client = get_supervisor_client
    for name in ("homeassistant", "homeassistant.components", "homeassistant.components.hassio"):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
    monkeypatch.setitem(sys.modules, "homeassistant.components.hassio.handler", handler)


async def test_the_addons_city_is_the_place(monkeypatch):
    supervisor(monkeypatch, {"podview_weather_city": " Mårslet "})
    assert await module.weather_place(hass()) == {
        "ok": True,
        "name": "Mårslet",
        "source": "configured_label",
    }


async def test_without_the_addons_city_ha_location_name_then_the_home_zone(monkeypatch):
    supervisor(monkeypatch, {"podview_weather_city": ""})
    result = await module.weather_place(hass(location_name="Tranbjerg"))
    assert result == {"ok": True, "name": "Tranbjerg", "source": "ha_location_name"}
    supervisor(monkeypatch, None)
    result = await module.weather_place(hass(location_name="Home", zone="Mårslet"))
    assert result == {"ok": True, "name": "Mårslet", "source": "ha_zone_home"}


async def test_never_a_generic_word_or_a_forecast_entitys_name(monkeypatch):
    supervisor(monkeypatch, {"podview_weather_city": "Forecast Hjem"})
    result = await module.weather_place(hass(location_name="Home", zone="Hjem"))
    assert result == {"ok": True, "name": "", "source": "none"}
    for name in ("Forecast Hjem", "forecast", "Home", "hjemmet", "a/b", "", None, 7, "x" * 81):
        assert module.place_name(name) == ""
