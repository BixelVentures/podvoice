"""The wall's screen (custom_components/podvoice/wall_screen.py): the signed-in user's own Companion device is the
wall, and Automatisk dæmpning dims it at 21:00 and restores the day level at 07:00, exactly once each."""

from __future__ import annotations

import importlib
import sys
import types
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = "podvoice_wall_under_test"


class Registries:
    """Device and entity registries as wall_screen.py reads them."""

    def __init__(self) -> None:
        self.devices: dict[str, SimpleNamespace] = {}
        self.by_identifier: dict[tuple, SimpleNamespace] = {}
        self.entities: dict[str, SimpleNamespace] = {}

    def add(self, device_id, app_id, name, entity_ids, model="iPad Air"):
        device = SimpleNamespace(id=device_id, name=name, name_by_user=None, model=model)
        self.devices[device_id] = device
        self.by_identifier[("mobile_app", app_id)] = device
        for entity_id in entity_ids:
            self.entities[entity_id] = SimpleNamespace(entity_id=entity_id, device_id=device_id)


REG = Registries()


def _load():
    device_registry = SimpleNamespace(
        async_get=lambda device_id: REG.devices.get(device_id),
    )
    entity_registry = SimpleNamespace(async_get=lambda entity_id: REG.entities.get(entity_id))
    stubs = {
        "voluptuous": {
            "Schema": lambda *args, **kwargs: None,
            "Optional": lambda key: key,
            "All": lambda *args: None,
            "Range": lambda **kwargs: None,
        },
        "homeassistant": {},
        "homeassistant.config_entries": {"ConfigEntry": object},
        "homeassistant.core": {
            "HomeAssistant": object,
            "ServiceCall": object,
            "SupportsResponse": SimpleNamespace(ONLY="only"),
            "callback": lambda func: func,
        },
        "homeassistant.exceptions": {"Unauthorized": PermissionError},
        "homeassistant.helpers": {},
        "homeassistant.helpers.device_registry": {
            "async_get": lambda hass: device_registry,
            # A mobile_app entry owns one device; the fake keys entries as »entry-<app id>«.
            "async_entries_for_config_entry": lambda registry, entry_id: [
                device
                for (domain, app_id), device in REG.by_identifier.items()
                if domain == "mobile_app" and f"entry-{app_id}" == entry_id
            ],
        },
        "homeassistant.helpers.entity_registry": {
            "async_get": lambda hass: entity_registry,
            "async_entries_for_device": lambda registry, device_id: [
                item for item in REG.entities.values() if item.device_id == device_id
            ],
        },
        "homeassistant.helpers.event": {
            "async_call_later": lambda *args, **kwargs: lambda: None,
            "async_track_time_change": lambda *args, **kwargs: lambda: None,
            "async_track_time_interval": lambda *args, **kwargs: lambda: None,
        },
        "homeassistant.helpers.storage": {"Store": object},
        "homeassistant.util": {
            "slugify": lambda text: text.lower().replace(" ", "_").replace("-", "_")
        },
        "homeassistant.util.dt": {"now": datetime.now},
    }
    saved = {name: sys.modules.get(name) for name in stubs}
    for name, values in stubs.items():
        stub = types.ModuleType(name)
        stub.__dict__.update(values)
        sys.modules[name] = stub
    sys.modules["homeassistant.util"].dt = sys.modules["homeassistant.util.dt"]
    package = types.ModuleType(PACKAGE)
    package.__path__ = [str(ROOT / "custom_components/podvoice")]
    sys.modules[PACKAGE] = package
    try:
        return importlib.import_module(f"{PACKAGE}.wall_screen")
    finally:
        for name, previous in saved.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous


wall_screen = _load()


class States:
    def __init__(self, values: dict[str, str]) -> None:
        self.values = values

    def get(self, entity_id):
        value = self.values.get(entity_id)
        return SimpleNamespace(entity_id=entity_id, state=value) if value is not None else None

    def async_all(self, domain):
        return [self.get(key) for key in sorted(self.values) if key.startswith(domain + ".")]


class Services:
    def __init__(self, names: set[str]) -> None:
        self.names = names
        self.sent: list[tuple[str, dict]] = []
        self.fail = False

    def has_service(self, domain, service):
        return domain == "notify" and service in self.names

    async def async_call(self, domain, service, data, blocking):
        assert blocking
        if self.fail:
            raise RuntimeError("app did not answer")
        self.sent.append((service, data))


class Store:
    def __init__(self) -> None:
        self.data = None
        self.saves = 0

    async def async_load(self):
        return self.data

    async def async_save(self, data):
        self.saves += 1
        self.data = dict(data)


def green():
    """The Green's shape: the family iPad (kiosk on) and two iPhones that also have kiosk sensors."""
    REG.__init__()
    REG.add("dev-ipad", "app-ipad", "Fam iPad", ["sensor.fam_ipad_kiosk_brightness"])
    REG.add(
        "dev-anna", "app-anna", "Anna iPhone", ["sensor.anna_iphone_kiosk_brightness"], "iPhone 15"
    )
    REG.add(
        "dev-mads", "app-mads", "Mads iPhone", ["sensor.mads_iphone_kiosk_brightness"], "iPhone 16"
    )
    entries = [
        SimpleNamespace(
            entry_id="entry-app-ipad",
            data={"user_id": "user-fam", "device_id": "app-ipad", "device_name": "Fam iPad"},
        ),
        SimpleNamespace(
            entry_id="entry-app-anna",
            data={"user_id": "user-anna", "device_id": "app-anna", "device_name": "Anna iPhone"},
        ),
        SimpleNamespace(
            entry_id="entry-app-mads",
            data={"user_id": "user-mads", "device_id": "app-mads", "device_name": "Mads iPhone"},
        ),
    ]
    states = States(
        {
            "sensor.anna_iphone_kiosk_brightness": "40",
            "binary_sensor.anna_iphone_kiosk_mode": "on",
            "sensor.fam_ipad_kiosk_brightness": "70",
            "binary_sensor.fam_ipad_kiosk_mode": "on",
            "sensor.mads_iphone_kiosk_brightness": "55",
            "binary_sensor.mads_iphone_kiosk_mode": "off",
        }
    )
    services = Services({"mobile_app_fam_ipad", "mobile_app_anna_iphone", "mobile_app_mads_iphone"})
    return SimpleNamespace(
        states=states,
        services=services,
        config_entries=SimpleNamespace(
            async_entries=lambda domain: entries if domain == "mobile_app" else []
        ),
        data={},
    )


def test_the_wall_is_the_signed_in_users_own_device():
    hass = green()
    # The family user's iPad, though »anna_iphone« comes first by name and is in kiosk mode too.
    assert wall_screen.wall_for_user(hass, "user-fam")["slug"] == "fam_ipad"
    assert wall_screen.wall_for_user(hass, "user-fam")["source"] == "user"
    assert wall_screen.wall_for_user(hass, "user-fam")["notify"] == "mobile_app_fam_ipad"
    assert wall_screen.wall_for_user(hass, "user-mads")["slug"] == "mads_iphone"
    # A user with no Companion device: the old rule (kiosk mode on first, then by name).
    fallback = wall_screen.wall_for_user(hass, "user-guest")
    assert (fallback["slug"], fallback["source"]) == ("anna_iphone", "rule")


class Clock:
    def __init__(self, hour: int, minute: int = 0) -> None:
        self.at = datetime(2026, 11, 26, hour, minute)

    def __call__(self):
        return self.at

    def set(self, hour: int, minute: int = 0, day: int = 26) -> None:
        self.at = datetime(2026, 11, day, hour, minute)


async def _screen(hour: int):
    hass, clock, store = green(), Clock(hour), Store()
    screen = wall_screen.WallScreen(hass, store, now=clock)
    await screen.async_load()
    screen.wall = wall_screen.wall_for_user(hass, "user-fam")
    return hass, clock, store, screen


async def test_auto_dim_dims_at_21_and_restores_at_7_exactly_once():
    hass, clock, store, screen = await _screen(20)
    await screen.async_reconcile()
    assert hass.services.sent == []
    clock.set(21)
    await screen.async_reconcile()
    await screen.async_reconcile()  # The 5-minute check and the time listener: still one send.
    level = {"message": "kiosk_set_brightness", "data": {"level": wall_screen.NIGHT_BRIGHTNESS}}
    assert hass.services.sent == [("mobile_app_fam_ipad", level)]
    # The day level was the wall's own (70 %) before it was dimmed.
    assert screen.day_brightness == 70 and store.data["applied"] == "night"
    clock.set(3, day=27)
    await screen.async_reconcile()
    assert len(hass.services.sent) == 1
    clock.set(7, day=27)
    await screen.async_reconcile()
    await screen.async_reconcile()
    assert hass.services.sent[1:] == [
        ("mobile_app_fam_ipad", {"message": "kiosk_set_brightness", "data": {"level": 70}})
    ]
    assert screen.applied == "day"


async def test_the_day_level_is_the_last_one_set_with_the_slider():
    hass, clock, _, screen = await _screen(21)
    screen.day_brightness = 45
    await screen.async_reconcile()
    clock.set(7, day=27)
    await screen.async_reconcile()
    assert hass.services.sent[-1][1]["data"]["level"] == 45


async def test_off_never_dims_and_turning_it_off_at_night_restores():
    hass, _clock, _, screen = await _screen(22)
    screen.auto_dim = False
    await screen.async_reconcile()
    assert hass.services.sent == []
    screen.auto_dim = True
    await screen.async_reconcile()
    screen.auto_dim = False
    await screen.async_reconcile()
    assert [data["data"]["level"] for _, data in hass.services.sent] == [10, 70]


async def test_without_kiosk_nothing_is_sent_and_a_failed_send_is_tried_again():
    hass, clock, _, screen = await _screen(21)
    hass.states.values["binary_sensor.fam_ipad_kiosk_mode"] = "off"
    await screen.async_reconcile()
    assert hass.services.sent == [] and screen.applied == "day"
    hass.states.values["binary_sensor.fam_ipad_kiosk_mode"] = "on"
    hass.services.fail = True
    await screen.async_reconcile()
    assert screen.applied == "day"
    hass.services.fail = False
    clock.set(21, 5)
    await screen.async_reconcile()
    assert len(hass.services.sent) == 1 and screen.applied == "night"


async def test_settings_survive_a_restart():
    hass, clock, store, screen = await _screen(21)
    await screen.async_reconcile()
    again = wall_screen.WallScreen(hass, store, now=clock)
    await again.async_load()
    assert (again.applied, again.day_brightness, again.wall["slug"]) == ("night", 70, "fam_ipad")
    await again.async_reconcile()
    assert len(hass.services.sent) == 1
