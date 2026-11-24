"""The panel's room cleaning rules (custom_components/podvoice/robot_cleaning.py) and the car's
recent events (vehicle_control.history_events), against inert HA-shaped fakes."""

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
    if "pv_cc" not in sys.modules:
        package = types.ModuleType("pv_cc")
        package.__path__ = [str(PACKAGE)]
        sys.modules["pv_cc"] = package
    return importlib.import_module(f"pv_cc.{name}")


cleaning = _load("robot_cleaning")
robot = _load("robot_control")
vehicle = _load("vehicle_control")
ROBOROCK = 4 | 8 | 16 | 32 | 8192


def run(coroutine):
    return asyncio.run(coroutine)


def now():
    return datetime.now(UTC)


def state(entity_id, value, attributes=None, age=60):
    at = now() - timedelta(seconds=age)
    return NS(
        entity_id=entity_id,
        state=value,
        attributes=attributes or {},
        last_changed=at,
        last_updated=at,
        last_reported=at,
        as_dict=lambda: {},
    )


class States(dict):
    def get(self, entity_id, default=None):
        return super().get(entity_id, default)


class Registry:
    def __init__(self, rows):
        self.entities = {row.entity_id: row for row in rows}

    def async_get(self, entity_id):
        return self.entities.get(entity_id)


class Areas:
    def __init__(self, names):
        self.names = names

    def async_get_area(self, area_id):
        name = self.names.get(area_id)
        return NS(id=area_id, name=name) if name else None


class Services:
    def __init__(self):
        self.calls, self.fail = [], None

    async def async_call(self, domain, service, data, blocking=False, context=None):
        self.calls.append((domain, service, data))
        if self.fail is not None and service in self.fail:
            raise RuntimeError("no answer")


class Store:
    def __init__(self, data=None):
        self.data = data

    async def async_load(self):
        return self.data

    async def async_save(self, data):
        self.data = data


def row(entity_id, key=None, platform="roborock", options=None):
    return NS(
        entity_id=entity_id,
        id="id-" + entity_id,
        unique_id="u-" + entity_id,
        platform=platform,
        config_entry_id="rr",
        device_id="robot",
        disabled_by=None,
        translation_key=key,
        options=options or {},
    )


MAPPING = {
    "area_mapping": {
        "kitchen": ["1_16"],
        "living": ["1_17", "1_18"],
        "office": ["2_20"],
        "split": ["1_19", "2_21"],
        "stale": ["1_99"],
        "deleted": ["1_22"],
    },
    "last_seen_segments": [
        {"id": "1_16", "group": "Stueplan"},
        {"id": "1_17", "group": "Stueplan"},
        {"id": "1_18", "group": "Stueplan"},
        {"id": "1_19", "group": "Stueplan"},
        {"id": "1_22", "group": "Stueplan"},
        {"id": "2_20", "group": "1. sal"},
        {"id": "2_21", "group": "1. sal"},
    ],
}


@pytest.fixture
def home(monkeypatch):
    rows = [
        row("vacuum.qrevo", options={"vacuum": MAPPING}),
        row("select.qrevo_mode", "cleaning_mode"),
        row("select.qrevo_water", "mop_intensity"),
        row("select.qrevo_map", "selected_map"),
    ]
    registry = Registry(rows)
    areas = Areas({"kitchen": "Køkken", "living": "Stue", "office": "Kontor", "split": "Gang"})
    states = States(
        {
            "vacuum.qrevo": state(
                "vacuum.qrevo",
                "docked",
                {
                    "supported_features": ROBOROCK,
                    "fan_speed": "balanced",
                    "fan_speed_list": ["quiet", "balanced", "turbo"],
                },
            ),
            "select.qrevo_mode": state(
                "select.qrevo_mode", "vac_and_mop", {"options": ["vacuum", "mop", "vac_and_mop"]}
            ),
            "select.qrevo_water": state(
                "select.qrevo_water", "moderate", {"options": ["off", "mild", "moderate"]}
            ),
            "select.qrevo_map": state(
                "select.qrevo_map", "Stueplan", {"options": ["Stueplan", "1. sal"]}
            ),
        }
    )
    devices = NS(devices={}, async_get=lambda _id: NS(id="robot", name="Qrevo", name_by_user=None))
    monkeypatch.setattr(cleaning, "_registries", lambda _hass: (areas, registry))
    monkeypatch.setattr(robot, "_registries", lambda _hass: (devices, registry))

    async def no_addon(_hass):
        return {"status": "addon_unavailable", "items": []}

    monkeypatch.setattr(cleaning, "read_addon_journal", no_addon)
    hass = NS(states=states, services=Services())
    hass.journal = cleaning.Journal(Store())
    return hass


def offer(hass):
    return cleaning.offer(hass, cleaning._robot(hass, "vacuum.qrevo"))


def start(hass, **extra):
    current = offer(hass)
    request = {
        "entity_id": "vacuum.qrevo",
        "area_ids": ["kitchen"],
        "repeat": 1,
        "settings": {},
        "expected_state": "docked",
        "revision": current["revision"],
        **extra,
    }
    return run(cleaning.start(hass, hass.journal, request))


def test_only_whole_areas_of_the_active_floor_are_rooms(home):
    current = offer(home)
    assert current["mapName"] == "Stueplan"
    assert [(r["id"], r["name"]) for r in current["rooms"]] == [
        ("kitchen", "Køkken"),
        ("living", "Stue"),
    ]
    assert current["method"] == "segment_clean"
    assert current["repeat"] == {"min": 1, "max": 3}
    home.states["select.qrevo_map"] = state(
        "select.qrevo_map", "1. sal", {"options": ["Stueplan", "1. sal"]}
    )
    assert [r["id"] for r in offer(home)["rooms"]] == ["office"]


def test_without_an_area_mapping_nothing_can_be_started(home):
    home_row = cleaning._robot(home, "vacuum.qrevo")["entity"]
    home_row.options = {}
    current = offer(home)
    assert current["rooms"] == [] and current["reason"] == "area_mapping_not_configured"
    assert start(home)["reason"] == "unsupported_action"


def test_roborock_start_sends_settings_first_then_segments_with_repeat(home):
    answer = start(
        home,
        area_ids=["living", "kitchen"],
        repeat=2,
        settings={"suction": "turbo", "cleaning_mode": "vacuum", "mop_intensity": "moderate"},
    )
    assert answer["outcome"] == "accepted"
    assert answer["applied"] == ["cleaning_mode", "suction"]
    assert home.services.calls == [
        ("select", "select_option", {"entity_id": "select.qrevo_mode", "option": "vacuum"}),
        ("vacuum", "set_fan_speed", {"entity_id": "vacuum.qrevo", "fan_speed": "turbo"}),
        (
            "vacuum",
            "send_command",
            {
                "entity_id": "vacuum.qrevo",
                "command": "app_segment_clean",
                "params": [{"segments": [17, 18, 16], "repeat": 2}],
            },
        ),
    ]


def test_a_setting_without_an_answer_stops_before_the_start(home):
    home.services.fail = {"set_fan_speed"}
    answer = start(home, settings={"cleaning_mode": "vacuum", "suction": "turbo"})
    assert answer == {
        "outcome": "unknown",
        "reason": "setting_failed",
        "applied": ["cleaning_mode"],
    }
    assert [call[1] for call in home.services.calls] == ["select_option", "set_fan_speed"]
    assert run(home.journal.records("vacuum.qrevo")) == []


@pytest.mark.parametrize(
    ("extra", "reason"),
    [
        ({"area_ids": ["office"]}, "unknown_room"),
        ({"repeat": 4}, "unsupported_repeat"),
        ({"settings": {"suction": "max"}}, "unsupported_setting"),
        ({"settings": {"mop_mode": "deep"}}, "unsupported_setting"),
        ({"revision": "0" * 64}, "changed_observation"),
        ({"expected_state": "idle"}, "changed_observation"),
    ],
)
def test_start_refusals_send_nothing(home, extra, reason):
    assert start(home, **extra) == {"outcome": "rejected", "reason": reason}
    assert home.services.calls == []


def test_a_working_robot_cannot_start(home):
    home.states["vacuum.qrevo"] = state(
        "vacuum.qrevo", "cleaning", {"supported_features": ROBOROCK}
    )
    assert start(home, expected_state="cleaning")["reason"] == "not_ready"


def test_unknown_start_blocks_until_ha_shows_the_robot_again(home):
    home.services.fail = {"send_command"}
    assert start(home)["outcome"] == "unknown"
    [record] = run(home.journal.records("vacuum.qrevo"))
    assert record["outcome"] == "unknown"
    home.services.fail = None
    assert start(home)["reason"] == "previous_unknown"
    # HA showed the robot after the unknown start: it no longer blocks.
    home.states["vacuum.qrevo"] = state(
        "vacuum.qrevo", "docked", {"supported_features": ROBOROCK}, age=-1
    )
    assert not cleaning.blocked(home, "vacuum.qrevo", [record])
    # Nor after fifteen minutes.
    old = {**record, "recordedAt": record["recordedAt"] - cleaning.UNKNOWN_BLOCK_SECONDS}
    home.states["vacuum.qrevo"] = state("vacuum.qrevo", "docked", {}, age=3600)
    assert not cleaning.blocked(home, "vacuum.qrevo", [old])


def test_the_journal_keeps_three_starts_per_robot(home):
    journal = home.journal
    for index in range(5):
        run(
            journal.begin(
                "vacuum.qrevo", {"areaIds": ["kitchen"], "repeat": index % 3 + 1, "settings": {}}
            )
        )
    run(journal.begin("vacuum.s8", {"areaIds": ["office"], "repeat": 1, "settings": {}}))
    assert len(run(journal.records("vacuum.qrevo"))) == 3
    assert len(run(journal.records("vacuum.s8"))) == 1


def test_recipes_are_reusable_only_as_they_were(home):
    assert (
        start(home, area_ids=["kitchen"], repeat=2, settings={"suction": "turbo"})["outcome"]
        == "accepted"
    )
    state_now = run(cleaning.cleaning_state(home, home.journal, "vacuum.qrevo"))
    [item] = state_now["journal"]["items"]
    assert item["reusable"] and item["areaNames"] == ["Køkken"] and item["source"] == "panel"
    assert state_now["journal"]["addon"] == "addon_unavailable"
    home.services.calls.clear()
    assert start(
        home, area_ids=["kitchen"], repeat=1, settings={"suction": "turbo"}, recipe_id=item["id"]
    ) == {
        "outcome": "rejected",
        "reason": "recipe_changed",
    }
    assert home.services.calls == []
    answer = start(
        home, area_ids=["kitchen"], repeat=2, settings={"suction": "turbo"}, recipe_id=item["id"]
    )
    assert answer["outcome"] == "accepted"


def test_addon_receipts_join_by_entity_and_name_current_settings():
    current = {
        "rooms": [{"id": "kitchen", "name": "Køkken", "segments": ["1_16"]}],
        "mapName": "Stueplan",
        "method": "segment_clean",
        "repeat": {"min": 1, "max": 3},
        "settings": [
            {
                "key": "suction",
                "entityId": "vacuum.qrevo",
                "options": ["quiet", "turbo"],
                "current": "quiet",
            },
        ],
    }
    good = cleaning._addon_item(
        {
            "id": "a" * 32,
            "entityId": "vacuum.qrevo",
            "recordedAt": 100.0,
            "acceptedAt": 101.0,
            "outcome": "accepted_by_ha",
            "recipe": {
                "areaIds": ["kitchen"],
                "mapName": "Stueplan",
                "repeat": 2,
                "completeSetup": True,
                "verifiedSettings": [{"entityId": "vacuum.qrevo", "value": "turbo"}],
            },
        }
    )
    unknown_setting = {**good, "id": "b" * 32, "entityValues": {"select.gone": "x"}}
    other_robot = {**good, "id": "c" * 32, "entityId": "vacuum.s8"}
    items = cleaning.journal_items(
        [], [good, unknown_setting, other_robot], current, "vacuum.qrevo"
    )
    assert [(i["id"][0], i["source"], i["reusable"]) for i in items] == [
        ("a", "addon", True),
        ("b", "addon", False),
    ]
    assert items[0]["settings"] == {"suction": "turbo"} and items[0]["outcome"] == "accepted"
    assert cleaning._addon_item({"id": "x"}) is None


def test_setting_refusals_and_a_value_already_shown(home):
    base = {
        "entity_id": "vacuum.qrevo",
        "key": "mop_intensity",
        "setting_entity_id": "select.qrevo_water",
    }
    assert run(cleaning.setting(home, {**base, "value": "mild", "expected_current": "off"}))[
        "reason"
    ] == ("changed_observation")
    assert (
        run(cleaning.setting(home, {**base, "value": "intense", "expected_current": "moderate"}))[
            "reason"
        ]
        == "unsupported_setting"
    )
    assert run(
        cleaning.setting(home, {**base, "value": "moderate", "expected_current": "moderate"})
    ) == {"outcome": "accepted"}
    assert home.services.calls == []
    assert run(
        cleaning.setting(home, {**base, "value": "mild", "expected_current": "moderate"})
    ) == {"outcome": "accepted"}
    assert home.services.calls == [
        ("select", "select_option", {"entity_id": "select.qrevo_water", "option": "mild"})
    ]


def test_vehicle_events_are_real_changes_within_a_day_newest_first():
    at = datetime.now(UTC).timestamp()

    def recorded(value, ago):
        return NS(state=value, last_changed=datetime.fromtimestamp(at - ago, UTC))

    changes = {
        "lock.car": [
            recorded("locked", 90000),
            recorded("unlocked", 3600),
            recorded("unlocked", 3000),
            recorded("locked", 600),
        ],
        "sensor.charge": [
            recorded("disconnected", 7200),
            recorded("unknown", 5000),
            recorded("charging", 4000),
        ],
        "climate.car": [recorded("off", 7000), recorded("heat_cool", 100)],
    }
    entities = {"locked": "lock.car", "charging": "sensor.charge", "climate": "climate.car"}
    events = vehicle.history_events(changes, entities, at)
    assert [(e["field"], e["value"]) for e in events] == [
        ("climate", "heat_cool"),
        ("locked", "locked"),
        ("locked", "unlocked"),
    ]
