"""The panel's robot and car command rules (custom_components/podvoice/robot_control.py and
vehicle_control.py), each rule ported from the add-on, against inert HA-shaped fakes."""

import asyncio
import importlib
import sys
import types
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace as NS

import pytest

PACKAGE = Path(__file__).parents[2] / "custom_components/podvoice"


def _load(name):
    """Import a module of the integration package without its HA-bound __init__."""
    if "pv_cc" not in sys.modules:
        package = types.ModuleType("pv_cc")
        package.__path__ = [str(PACKAGE)]
        sys.modules["pv_cc"] = package
    return importlib.import_module(f"pv_cc.{name}")


class HomeAssistantError(Exception):
    pass


class ServiceValidationError(HomeAssistantError):
    pass


class Unauthorized(HomeAssistantError):
    pass


@pytest.fixture(autouse=True)
def ha_exceptions(monkeypatch):
    try:
        import homeassistant.exceptions as real  # noqa: F401
    except ImportError:
        fake = types.ModuleType("homeassistant.exceptions")
        fake.HomeAssistantError = HomeAssistantError
        fake.ServiceValidationError = ServiceValidationError
        fake.Unauthorized = Unauthorized
        monkeypatch.setitem(sys.modules, "homeassistant", types.ModuleType("homeassistant"))
        monkeypatch.setitem(sys.modules, "homeassistant.exceptions", fake)


def errors():
    return sys.modules["homeassistant.exceptions"]


vehicle = _load("vehicle_control")
robot = _load("robot_control")


def now():
    return datetime.now(UTC)


class State(NS):
    def as_dict(self):
        return {
            "entity_id": self.entity_id,
            "state": self.state,
            "attributes": dict(self.attributes),
            "last_updated": self.last_updated.isoformat(),
            "last_reported": self.last_reported.isoformat(),
        }


def state(entity_id, value, attributes=None, age=5):
    at = now() - timedelta(seconds=age)
    return State(
        entity_id=entity_id,
        state=value,
        attributes=attributes or {},
        last_changed=at,
        last_updated=at,
        last_reported=at,
    )


class States(dict):
    def get(self, entity_id, default=None):
        return super().get(entity_id, default)


class Registry:
    def __init__(self, rows):
        self.entities = {row.entity_id: row for row in rows}

    def async_get(self, entity_id):
        return self.entities.get(entity_id)


class DeviceView:
    """HA 2026.11's `DeviceRegistry.devices`: iterating yields the entries; any mapping use is deprecated (HA logs
    "uses `device_registry.devices` as a mapping"), so here it fails the test."""

    def __init__(self, rows):
        self._rows = rows

    def __iter__(self):
        return iter(self._rows)

    def __len__(self):
        return len(self._rows)

    def __getitem__(self, key):
        raise AssertionError("device_registry.devices used as a mapping")

    def __contains__(self, key):
        raise AssertionError("device_registry.devices used as a mapping")

    def __getattr__(self, name):
        raise AssertionError(f"device_registry.devices.{name} (deprecated mapping use)")


class Devices:
    def __init__(self, rows):
        self._by_id = {row.id: row for row in rows}
        self.devices = DeviceView(list(rows))

    def async_get(self, device_id):
        return self._by_id.get(device_id)


class Store:
    def __init__(self, data=None):
        self.data, self.saves = data, []

    async def async_load(self):
        return self.data

    async def async_save(self, data):
        import copy

        self.data = copy.deepcopy(data)
        self.saves.append(self.data)


class Services:
    def __init__(self):
        self.calls, self.fail = [], None

    async def async_call(self, domain, service, data, blocking=False, context=None):
        self.calls.append((domain, service, data))
        if self.fail is not None:
            raise self.fail


def entry_row(eid, key, device="car", platform="tesla_fleet", disabled=None):
    return NS(
        entity_id=eid,
        id="id-" + eid,
        unique_id="u-" + eid,
        platform=platform,
        config_entry_id="tesla",
        device_id=device,
        disabled_by=disabled,
        translation_key=key,
    )


# ---- Vehicle -------------------------------------------------------------------------------------


def vehicle_hass(climate="heat_cool", lock="locked", trunk="closed", unit="°C"):
    stamp = (now() - timedelta(seconds=30)).timestamp() * 1000
    coordinator = NS(
        data={
            "state": "online",
            "vehicle_state_timestamp": stamp,
            "vehicle_state_locked": lock == "locked",
            "vehicle_state_rt": 0 if trunk == "closed" else 1,
            "charge_state_timestamp": stamp,
            "charge_state_battery_level": 71,
            "charge_state_battery_range": 200,
            "charge_state_charging_state": "Disconnected",
        }
    )
    car = NS(vin="VIN1", coordinator=coordinator)
    entry = NS(
        entry_id="tesla",
        domain="tesla_fleet",
        state=NS(value="loaded"),
        runtime_data=NS(vehicles=[car]),
    )
    rows = [
        entry_row("lock.model_y_lock", "vehicle_state_locked"),
        entry_row("climate.model_y_climate", "driver_temp"),
        entry_row("switch.model_y_defrost", "climate_state_defrost_mode"),
        entry_row("select.model_y_seat_left", "climate_state_seat_heater_left"),
        entry_row("select.model_y_seat_right", "climate_state_seat_heater_right"),
        entry_row("cover.model_y_trunk", "vehicle_state_rt"),
        entry_row("sensor.model_y_battery", "charge_state_battery_level"),
        entry_row("sensor.other_battery", "charge_state_battery_range", disabled="user"),
        entry_row("sensor.foreign", "charge_state_battery_range", platform="other"),
    ]
    device = NS(
        id="car",
        config_entry_id="tesla",
        disabled_by=None,
        identifiers={("tesla_fleet", "VIN1")},
        name="Model Y",
        name_by_user=None,
    )
    states = States(
        {
            "lock.model_y_lock": state("lock.model_y_lock", lock),
            "climate.model_y_climate": state(
                "climate.model_y_climate",
                climate,
                {
                    "hvac_modes": ["off", "heat_cool"],
                    "supported_features": 1 | 128 | 256,
                    "min_temp": 15,
                    "max_temp": 28,
                },
            ),
            "switch.model_y_defrost": state("switch.model_y_defrost", "off"),
            "select.model_y_seat_left": state(
                "select.model_y_seat_left", "off", {"options": ["off", "low", "medium", "high"]}
            ),
            "select.model_y_seat_right": state(
                "select.model_y_seat_right", "off", {"options": ["off", "low", "medium", "high"]}
            ),
            "cover.model_y_trunk": state("cover.model_y_trunk", trunk, {"supported_features": 3}),
        }
    )
    hass = NS(
        states=states,
        services=Services(),
        config=NS(units=NS(temperature_unit=unit)),
        config_entries=NS(async_entries=lambda domain: [entry] if domain == "tesla_fleet" else []),
    )
    return hass, (Devices([device]), Registry(rows))


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


@pytest.fixture
def car(monkeypatch):
    hass, registries = vehicle_hass()
    monkeypatch.setattr(vehicle, "_registries", lambda _hass: registries)
    clock = Clock()
    store = Store()
    commands = vehicle.VehicleCommands(hass, vehicle.RiskStore(store), clock=clock)
    return NS(hass=hass, commands=commands, clock=clock, store=store, registries=registries)


def run(coro):
    return asyncio.run(coro)


def send(car, action, actor="user-1", **extra):
    return run(car.commands.command(actor, {"device_id": "car", "action": action, **extra}))


def test_discovery_reads_roles_from_the_registry(car):
    [found] = vehicle.discover(car.hass)
    assert found.device_id == "car" and found.name == "Model Y"
    assert found.entities["locked"] == "lock.model_y_lock"
    assert found.entities["batteryPercent"] == "sensor.model_y_battery"
    assert "rangeKm" not in found.entities  # disabled and foreign-platform rows are not roles
    assert found.controls["lock"] == "lock.model_y_lock"


def test_display_read_projects_coordinator_fields_with_timestamps(car):
    [found] = vehicle.discover(car.hass)
    result = vehicle.read(car.hass, found, {"revision": 0})
    assert result["status"] == "observed"
    assert result["data"]["locked"] is True and result["data"]["batteryPercent"] == 71
    assert result["connection"]["state"] == "online"
    assert result["temperatureRange"] == {"min": 15, "max": 28, "step": 0.5}
    assert "lock" in result["controls"] and "unlock" in result["controls"]


def test_lock_is_sent_directly_and_its_effect_stays_unresolved(car):
    result = send(car, "lock")
    assert result["outcome"] == "accepted"
    assert car.hass.services.calls == [("lock", "lock", {"entity_id": "lock.model_y_lock"})]
    risk = run(car.commands.risk.risk(vehicle.device_key("tesla", "car")))
    assert risk == {
        "revision": 2,
        "unresolved": {"access": ["locked"], "climate": []},
        "pending": False,
    }
    # Reserved durably before the send, settled after it.
    assert car.store.saves[0][vehicle.device_key("tesla", "car")]["pending"] is not None


@pytest.mark.parametrize("action", sorted(vehicle.CONFIRM - {"temperature", "rearTrunkToggle"}))
def test_every_other_action_needs_a_confirmation_token(car, action):
    args = {"option": "low"} if "Seat" in action else {}
    result = send(car, action, args=args)
    assert result["outcome"] == "confirmation_required"
    assert result["confirmation"]["nativeWakePossible"] is True
    assert car.hass.services.calls == []


def test_confirmation_token_sends_once(car):
    token = send(car, "unlock")["confirmation"]["token"]
    assert send(car, "unlock", confirmation=token)["outcome"] == "accepted"
    assert car.hass.services.calls == [("lock", "unlock", {"entity_id": "lock.model_y_lock"})]
    again = send(car, "unlock", confirmation=token)
    assert again == {**again, "outcome": "rejected", "reason": "confirmation_unknown"}
    assert len(car.hass.services.calls) == 1


def test_confirmation_token_expires_after_15_seconds(car):
    token = send(car, "unlock")["confirmation"]["token"]
    car.clock.now += 15.5
    assert send(car, "unlock", confirmation=token)["reason"] == "confirmation_expired"
    assert car.hass.services.calls == []


def test_confirmation_token_is_bound_to_user_action_and_arguments(car):
    token = send(car, "temperature", args={"temperature": 21.0})["confirmation"]["token"]
    assert send(car, "temperature", actor="user-2", confirmation=token, args={"temperature": 21.0})[
        "reason"
    ] == ("confirmation_unknown")
    token = send(car, "temperature", args={"temperature": 21.0})["confirmation"]["token"]
    assert send(car, "temperature", confirmation=token, args={"temperature": 22.0})["reason"] == (
        "confirmation_unknown"
    )
    token = send(car, "unlock")["confirmation"]["token"]
    assert send(car, "climateOff", confirmation=token)["reason"] == "confirmation_unknown"
    assert car.hass.services.calls == []


def test_earlier_opposite_request_requires_an_acknowledged_override(car):
    token = send(car, "unlock")["confirmation"]["token"]
    send(car, "unlock", confirmation=token)
    # Lock is normally direct; an unresolved unlock makes it a confirmed override.
    result = send(car, "lock")
    confirmation = result["confirmation"]
    assert result["outcome"] == "confirmation_required"
    assert confirmation["requiresOverride"] is True
    assert confirmation["priorUnresolved"]["access"] == ["unlocked"]
    assert send(car, "lock", confirmation=confirmation["token"])["reason"] == (
        "acknowledgement_required"
    )
    token = send(car, "lock")["confirmation"]["token"]
    result = send(car, "lock", confirmation=token, acknowledge_prior_unresolved=True)
    assert result["outcome"] == "accepted"


def test_climate_dependent_controls_need_climate_on(car, monkeypatch):
    car.hass.states["climate.model_y_climate"] = state(
        "climate.model_y_climate",
        "off",
        car.hass.states["climate.model_y_climate"].attributes,
    )
    for action, args in (("temperature", {"temperature": 21.0}), ("defrostOn", {})):
        assert send(car, action, args=args)["reason"] == "setup_unavailable"


def test_unknown_climate_still_admits_dependents(car):
    car.hass.states["climate.model_y_climate"] = state(
        "climate.model_y_climate", "unknown", car.hass.states["climate.model_y_climate"].attributes
    )
    assert send(car, "defrostOn")["outcome"] == "confirmation_required"


@pytest.mark.parametrize("value", [14.5, 28.5, 21.3])
def test_temperature_outside_range_or_step_is_refused(car, value):
    assert send(car, "temperature", args={"temperature": value})["reason"] == "invalid_arguments"


def test_temperature_needs_celsius(car):
    car.hass.config.units.temperature_unit = "°F"
    assert send(car, "temperature", args={"temperature": 21.0})["reason"] == "setup_unavailable"


def test_seat_heat_also_risks_climate_on(car):
    result = send(car, "driverSeatHeat", args={"option": "high"})
    assert result["confirmation"]["effects"] == [["driverSeat", "high"], ["climate", "on"]]
    assert send(car, "driverSeatHeat", args={"option": "max"})["reason"] == "invalid_arguments"


def test_trunk_direction_must_match_observed_state(car):
    assert send(car, "rearTrunkToggle", args={"direction": "close"})["reason"] == (
        "invalid_arguments"
    )
    result = send(car, "rearTrunkToggle", args={"direction": "open"})
    assert result["confirmation"]["label"] == "Åbn bagagerum"
    token = result["confirmation"]["token"]
    assert send(car, "rearTrunkToggle", args={"direction": "open"}, confirmation=token)[
        "outcome"
    ] == ("accepted")
    assert car.hass.services.calls == [
        ("cover", "open_cover", {"entity_id": "cover.model_y_trunk"})
    ]
    # Any earlier trunk actuation is unresolved: the next one is an override.
    assert send(car, "rearTrunkToggle", args={"direction": "open"})["confirmation"][
        "requiresOverride"
    ]


def test_trunk_without_coordinator_evidence_is_refused(car):
    [found] = vehicle.discover(car.hass)
    found.vehicle.coordinator.data.pop("vehicle_state_rt")
    assert send(car, "rearTrunkToggle", args={"direction": "open"})["reason"] == (
        "setup_unavailable"
    )


def test_state_change_before_confirmation_fails_preflight_without_a_send(car):
    token = send(car, "climateOff")["confirmation"]["token"]
    car.hass.states["climate.model_y_climate"] = state("climate.model_y_climate", "unavailable", {})
    assert send(car, "climateOff", confirmation=token)["reason"] == "preflight_failed"
    assert car.hass.services.calls == []


def test_explicit_refusal_leaves_nothing_unresolved(car):
    car.hass.services.fail = errors().ServiceValidationError("Missing vehicle commands scope.")
    result = send(car, "lock")
    assert result["outcome"] == "rejected" and result["vehicleError"] == "missing_scope"
    risk = run(car.commands.risk.risk(vehicle.device_key("tesla", "car")))
    assert risk["unresolved"]["access"] == []


def test_integration_error_is_unknown_and_stays_unresolved(car):
    car.hass.services.fail = errors().HomeAssistantError("Could not wake up vehicle")
    result = send(car, "lock")
    assert result["outcome"] == "unknown" and result["vehicleError"] == "wake_failed"
    risk = run(car.commands.risk.risk(vehicle.device_key("tesla", "car")))
    assert risk["unresolved"]["access"] == ["locked"]


def test_pending_reservation_from_an_earlier_run_is_unresolved_at_startup():
    key = vehicle.device_key("tesla", "car")
    pending = {
        "nonceHash": "n",
        "effects": [["access", "unlocked"]],
        "actorHash": "a",
        "proposalHash": "p",
    }
    store = Store(
        {key: {"revision": 4, "unresolved": {"access": [], "climate": []}, "pending": pending}}
    )
    risk = run(vehicle.RiskStore(store).risk(key))
    assert risk == {
        "revision": 5,
        "unresolved": {"access": ["unlocked"], "climate": []},
        "pending": False,
    }


def test_a_send_in_flight_refuses_the_next_command(car):
    async def scenario():
        gate = asyncio.Event()

        async def slow(*args, **kwargs):
            car.hass.services.calls.append(args)
            await gate.wait()

        car.hass.services.async_call = slow
        first = asyncio.ensure_future(
            car.commands.command("u", {"device_id": "car", "action": "lock"})
        )
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        second = await car.commands.command("u", {"device_id": "car", "action": "lock"})
        gate.set()
        return await first, second

    first, second = run(scenario())
    assert first["outcome"] == "accepted"
    assert second["outcome"] == "rejected" and second["reason"] == "command_pending"


def test_error_codes_are_the_add_ons():
    assert vehicle.vehicle_error_code(401, "") == "access_denied"
    assert vehicle.vehicle_error_code(500, "Too many requests") == "rate_limited"
    assert vehicle.vehicle_error_code(500, "timed out") == "no_response"
    assert vehicle.vehicle_error_code(500, "nope") == "refused"


# ---- Robot ---------------------------------------------------------------------------------------


def robot_hass(value="cleaning", features=4 | 8 | 16 | 8192):
    rows = [
        NS(
            entity_id="vacuum.qrevo",
            id="r1",
            unique_id="duid",
            platform="roborock",
            config_entry_id="rr",
            device_id="robot",
            disabled_by=None,
            translation_key=None,
        ),
        NS(
            entity_id="sensor.qrevo_battery",
            id="r2",
            unique_id="b",
            platform="roborock",
            config_entry_id="rr",
            device_id="robot",
            disabled_by=None,
            translation_key="battery",
        ),
        NS(
            entity_id="sensor.qrevo_dock_error",
            id="r3",
            unique_id="d",
            platform="roborock",
            config_entry_id="rr",
            device_id="dock",
            disabled_by=None,
            translation_key="dock_error",
        ),
    ]
    devices = Devices(
        [
            NS(id="robot", via_device_id=None, name="Qrevo", name_by_user=None, model="m"),
            NS(id="dock", via_device_id="robot", name="Dock", name_by_user=None, model="d"),
        ]
    )
    states = States(
        {
            "vacuum.qrevo": state(
                "vacuum.qrevo", value, {"supported_features": features, "friendly_name": "Qrevo"}
            ),
            "sensor.qrevo_battery": state(
                "sensor.qrevo_battery", "87", {"unit_of_measurement": "%"}
            ),
            "sensor.qrevo_dock_error": state("sensor.qrevo_dock_error", "ok"),
        }
    )
    hass = NS(states=states, services=Services())
    return hass, (devices, Registry(rows))


@pytest.fixture
def vac(monkeypatch):
    hass, registries = robot_hass()
    monkeypatch.setattr(robot, "_registries", lambda _hass: registries)
    monkeypatch.setattr(robot, "_job", lambda _hass, _robot: None)
    return hass


def robot_send(hass, action, expected_state="cleaning", features=4 | 8 | 16 | 8192):
    return run(
        robot.command(
            hass,
            {
                "entity_id": "vacuum.qrevo",
                "action": action,
                "expected_state": expected_state,
                "expected_features": features,
            },
        )
    )


def test_transport_actions_follow_state_and_feature_bits():
    every = 4 | 8 | 16 | 8192
    assert robot.transport_actions("cleaning", every) == ["pause", "stop", "return"]
    assert robot.transport_actions("paused", every) == ["resume", "stop", "return"]
    assert robot.transport_actions("returning", every) == ["stop"]
    assert robot.transport_actions("idle", every) == ["return"]
    assert robot.transport_actions("docked", every) == []
    assert robot.transport_actions("cleaning", 8) == ["stop"]
    assert robot.transport_actions("cleaning", True) == []


def test_robot_panel_state_reads_device_and_dock_fields(vac):
    [row] = robot.panel_state(vac)["robots"]
    assert row["entityId"] == "vacuum.qrevo" and row["name"] == "Qrevo"
    assert row["actions"] == ["pause", "stop", "return"]
    battery = next(item for item in row["telemetry"] if item["key"] == "battery")
    assert battery["value"] == 87 and battery["unit"] == "%"
    assert any(item["key"] == "dock_error" for item in row["telemetry"])


def test_robot_command_sends_the_admitted_action(vac):
    assert robot_send(vac, "pause") == {"outcome": "accepted"}
    assert vac.services.calls == [("vacuum", "pause", {"entity_id": "vacuum.qrevo"})]


def test_robot_command_refuses_a_changed_observation(vac):
    assert robot_send(vac, "pause", expected_state="paused")["reason"] == "changed_observation"
    assert robot_send(vac, "pause", features=4)["reason"] == "changed_observation"
    assert vac.services.calls == []


def test_robot_command_refuses_an_action_the_state_does_not_admit(vac):
    assert robot_send(vac, "resume")["reason"] == "unsupported_action"
    assert vac.services.calls == []


def test_robot_command_unavailable_state_is_rejected(vac):
    vac.states["vacuum.qrevo"] = state("vacuum.qrevo", "error", {"supported_features": 28})
    assert robot_send(vac, "stop")["outcome"] == "rejected"


def test_robot_command_without_an_answer_is_unknown(vac):
    vac.services.fail = RuntimeError("socket closed")
    assert robot_send(vac, "stop")["outcome"] == "unknown"
    assert len(vac.services.calls) == 1
