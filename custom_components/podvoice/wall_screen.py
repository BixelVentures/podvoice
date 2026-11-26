"""The wall's screen (»Skærm og enhed«): which Companion device is the wall, and Automatisk dæmpning.

The wall is the iPad running the Home Assistant Companion app in kiosk mode. It is the ``mobile_app`` device the
signed-in Home Assistant user registered (the mobile_app config entry's data holds the user id), not the first one
by name: the Green has the family iPad and iPhones that also expose kiosk sensors. Only when the asking user has no
such device is the old rule used (the device in kiosk mode first, then by name).

``podvoice.wall`` (any signed-in user) answers which device that is, and takes the wall's two screen settings:
``auto_dim`` (on by default) and ``day_brightness`` (the last level set with the slider). Asked by a user whose
device is in kiosk mode, it also remembers that device as the wall the schedule dims.

With Automatisk dæmpning on, a time listener dims the wall at 21:00 (Home Assistant's time zone) to
``NIGHT_BRIGHTNESS`` with ``notify.mobile_app_<device>`` / ``kiosk_set_brightness`` and restores the day level at
07:00. It is idempotent: the applied phase is stored, so a restart, the 5-minute check or a second listener never
sends it twice, and a failed send is tried again at the next check. Without kiosk mode nothing is sent; only Ro's
night screen changes (Rest.tsx).
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse, callback
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import (
    async_call_later,
    async_track_time_change,
    async_track_time_interval,
)
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from homeassistant.util import slugify

DOMAIN = "podvoice"
DATA_KEY = "podvoice_wall_screen"
STORE_KEY = "podvoice.wall_screen"
NIGHT_BRIGHTNESS = 10
NIGHT_FROM, NIGHT_UNTIL = 21, 7
CHECK = timedelta(minutes=5)
SEND_TIMEOUT_S = 20.0
_KIOSK = re.compile(r"^sensor\.([a-z0-9_]+)_kiosk_brightness$")
_LOGGER = logging.getLogger(__name__)


def is_night(now: datetime) -> bool:
    return now.hour >= NIGHT_FROM or now.hour < NIGHT_UNTIL


def _device_info(hass: HomeAssistant, slug: str, device_id: str | None, source: str) -> dict:
    device = dr.async_get(hass).async_get(device_id) if device_id else None
    notify = f"mobile_app_{slug}"
    return {
        "slug": slug,
        "device_id": device_id,
        "name": (device.name_by_user or device.name) if device else None,
        "model": device.model if device else None,
        "notify": notify if hass.services.has_service("notify", notify) else None,
        "brightness": f"sensor.{slug}_kiosk_brightness",
        "kiosk_mode": f"binary_sensor.{slug}_kiosk_mode",
        "source": source,
    }


def _kiosk_on(hass: HomeAssistant, device: dict) -> bool:
    state = hass.states.get(device["kiosk_mode"])
    return state is not None and state.state == "on"


def devices_of_user(hass: HomeAssistant, user_id: str | None) -> list[dict]:
    """The Companion devices the user registered that have a kiosk brightness sensor (kiosk mode on first)."""
    if not user_id:
        return []
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    found: list[dict] = []
    for entry in hass.config_entries.async_entries("mobile_app"):
        data = entry.data or {}
        if data.get("user_id") != user_id:
            continue
        device = devices.async_get_device(
            identifiers={("mobile_app", str(data.get("device_id", "")))}
        )
        if device is None:
            continue
        for item in er.async_entries_for_device(entities, device.id):
            if match := _KIOSK.match(item.entity_id):
                found.append(_device_info(hass, match.group(1), device.id, "user"))
                break
        else:
            # No kiosk sensor is registered: the notify service still names the device.
            name = data.get("device_name")
            if isinstance(name, str) and name:
                found.append(_device_info(hass, slugify(name), device.id, "user"))
    return sorted(found, key=lambda item: (not _kiosk_on(hass, item), item["slug"]))


def devices_by_rule(hass: HomeAssistant) -> list[dict]:
    """The old rule: every device with a kiosk brightness sensor, the one in kiosk mode first, then by name."""
    registry = er.async_get(hass)
    found = []
    for state in hass.states.async_all("sensor"):
        if match := _KIOSK.match(state.entity_id):
            entry = registry.async_get(state.entity_id)
            found.append(
                _device_info(hass, match.group(1), entry.device_id if entry else None, "rule")
            )
    return sorted(found, key=lambda item: (not _kiosk_on(hass, item), item["slug"]))


def wall_for_user(hass: HomeAssistant, user_id: str | None) -> dict | None:
    try:
        mine = devices_of_user(hass, user_id)
    except Exception:  # The registries could not be read: the old rule.
        _LOGGER.debug("PodView wall lookup by user failed", exc_info=True)
        mine = []
    if mine:
        return mine[0]
    rule = devices_by_rule(hass)
    return rule[0] if rule else None


class WallScreen:
    """The stored settings and the dimming schedule."""

    def __init__(
        self, hass: HomeAssistant, store: Store, now: Callable[[], datetime] = dt_util.now
    ) -> None:
        self.hass = hass
        self._store = store
        self._now = now
        self.auto_dim = True
        self.day_brightness: int | None = None
        self.wall: dict | None = None
        self.applied = "day"
        self._saved: dict | None = None
        self._lock = asyncio.Lock()

    def _data(self) -> dict:
        return {
            "auto_dim": self.auto_dim,
            "day_brightness": self.day_brightness,
            "wall": self.wall,
            "applied": self.applied,
        }

    async def async_load(self) -> None:
        try:
            data = await self._store.async_load()
        except Exception:
            data = None
        if isinstance(data, dict):
            self._saved = data
            self.auto_dim = data.get("auto_dim") is not False
            level = data.get("day_brightness")
            self.day_brightness = level if isinstance(level, int) and 0 <= level <= 100 else None
            self.wall = data.get("wall") if isinstance(data.get("wall"), dict) else None
            self.applied = "night" if data.get("applied") == "night" else "day"

    async def _async_save(self) -> None:
        data = self._data()
        if data != self._saved:
            try:
                await self._store.async_save(data)
                self._saved = data
            except Exception:
                _LOGGER.warning("PodView wall settings could not be saved")

    def kiosk(self) -> bool:
        return self.wall is not None and _kiosk_on(self.hass, self.wall)

    async def _send(self, level: int) -> bool:
        wall = self.wall
        notify = f"mobile_app_{wall['slug']}" if wall else None
        if not wall or not notify or not self.hass.services.has_service("notify", notify):
            return False
        try:
            async with asyncio.timeout(SEND_TIMEOUT_S):
                await self.hass.services.async_call(
                    "notify",
                    notify,
                    {"message": "kiosk_set_brightness", "data": {"level": level}},
                    blocking=True,
                )
        except Exception as err:  # Never raise out of the schedule; the next check tries again.
            _LOGGER.info("PodView wall brightness not sent: %s", type(err).__name__)
            return False
        return True

    def _reading(self) -> int | None:
        if not self.wall:
            return None
        state = self.hass.states.get(self.wall["brightness"])
        try:
            value = round(float(state.state)) if state else None
        except ValueError:
            return None
        return value if value is not None and 0 <= value <= 100 else None

    async def async_reconcile(self, _now: Any = None) -> None:
        """Bring the wall to the phase it should be in; nothing is sent when it is already there."""
        async with self._lock:
            want = "night" if self.auto_dim and is_night(self._now()) else "day"
            if want == self.applied:
                return
            if want == "night":
                if not self.kiosk():
                    return
                if self.day_brightness is None:
                    reading = self._reading()
                    if reading is not None and reading > NIGHT_BRIGHTNESS:
                        self.day_brightness = reading
                if await self._send(NIGHT_BRIGHTNESS):
                    self.applied = "night"
            elif self.day_brightness is None or not self.kiosk():
                self.applied = "day"  # Nothing to restore to (or no kiosk): the day simply begins.
            elif await self._send(self.day_brightness):
                self.applied = "day"
            await self._async_save()

    def answer(self, device: dict | None) -> dict:
        kiosk = device is not None and _kiosk_on(self.hass, device)
        return {
            "ok": True,
            "device": device,
            "auto_dim": self.auto_dim,
            "day_brightness": self.day_brightness,
            "night_brightness": NIGHT_BRIGHTNESS,
            "kiosk": kiosk,
            "dims_screen": kiosk and device is not None and device.get("notify") is not None,
        }


async def async_setup_services(hass: HomeAssistant, entry: ConfigEntry) -> list[str]:
    """Register ``podvoice.wall`` and start the dimming schedule."""
    screen = WallScreen(hass, Store(hass, 1, STORE_KEY, private=True))
    await screen.async_load()
    hass.data[DATA_KEY] = screen
    unsubscribe = [
        async_track_time_change(
            hass, screen.async_reconcile, hour=[NIGHT_FROM, NIGHT_UNTIL], minute=0, second=0
        ),
        async_track_time_interval(hass, screen.async_reconcile, CHECK, name="PodView wall dimming"),
        async_call_later(hass, 30, screen.async_reconcile),
    ]
    hass.data[DATA_KEY + "_unsub"] = unsubscribe

    async def wall(call: ServiceCall) -> dict:
        user_id = call.context.user_id
        user = await hass.auth.async_get_user(user_id) if user_id else None
        if user is None or not user.is_active:
            raise Unauthorized(context=call.context)
        device = wall_for_user(hass, user.id)
        if device is not None and device["source"] == "user" and _kiosk_on(hass, device):
            screen.wall = device
        elif screen.wall is None and device is not None and _kiosk_on(hass, device):
            screen.wall = device
        if "auto_dim" in call.data:
            screen.auto_dim = call.data["auto_dim"]
        if "day_brightness" in call.data:
            screen.day_brightness = call.data["day_brightness"]
        await screen._async_save()
        if "auto_dim" in call.data:
            hass.async_create_task(screen.async_reconcile(), "PodView wall dimming")
        return screen.answer(device)

    hass.services.async_register(
        DOMAIN,
        "wall",
        wall,
        schema=vol.Schema(
            {
                vol.Optional("auto_dim"): bool,
                vol.Optional("day_brightness"): vol.All(int, vol.Range(min=0, max=100)),
            }
        ),
        supports_response=SupportsResponse.ONLY,
    )
    return ["wall"]


@callback
def async_unload(hass: HomeAssistant) -> None:
    for remove in hass.data.pop(DATA_KEY + "_unsub", []):
        remove()
    hass.data.pop(DATA_KEY, None)
