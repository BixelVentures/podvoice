"""Exact registry area, freshness and bounded read admission; no HA or effect calls."""

import asyncio
import copy
from dataclasses import FrozenInstanceError, replace
from unittest.mock import AsyncMock

import pytest

from gatekeeper.podview_lights import (
    MAX_BYTES,
    LightsScope,
    current_area_lights,
    project_area_lights,
    read_area_lights,
)

SCOPE = LightsScope("kitchen-id", "opaque-controller-placement", 3, True)


def area(ids=None, name="Køkkenet", area_id="kitchen-id"):
    return {"areaId": area_id, "areaName": name, "entityIds": ids or []}


def state(eid="light.ceiling", value="on", **attributes):
    return {"entity_id": eid, "state": value, "attributes": attributes}


def project(ids=None, states=None, scope=SCOPE):
    ids = ["light.ceiling"] if ids is None else ids
    states = [state()] if states is None else states
    return project_area_lights(
        scope=scope,
        source_epoch="ha-source-1",
        area=area(ids),
        states=states,
        observed_at=100.0,
    )


async def read(registry=None, states=None, **overrides):
    values = {
        "scope": SCOPE,
        "source_epoch": "ha-source-1",
        "read_area": AsyncMock(return_value=area() if registry is None else registry),
        "read_states": AsyncMock(return_value=[] if states is None else states),
        "current": lambda: True,
        "now": lambda: 100.0,
    }
    values.update(overrides)
    return await read_area_lights(**values)


def test_closed_projection_is_exact_area_order_and_entity_count_not_physical_lamp_count():
    # HA's source-owned group and its members can coexist. The unit is explicit;
    # names and member labels never decide inclusion or physical lamp cardinality.
    result = project(
        ["light.group", "light.ceiling", "light.floor"],
        [
            state("light.floor", "unknown", brightness=None),
            state("light.ceiling", "off", friendly_name="Køkken", brightness=0),
            state("light.group", "on", entity_id=["light.ceiling", "light.floor"]),
        ],
    )
    assert result == {
        "status": "observed",
        "source": "home_assistant_state",
        "sourceEpoch": "ha-source-1",
        "observedAt": 100.0,
        "validUntil": 115.0,
        "scope": {
            "kind": "ha_area",
            "areaId": "kitchen-id",
            "areaName": "Køkkenet",
            "bindingId": "opaque-controller-placement",
            "placementRevision": 3,
            "isOwnArea": True,
        },
        "complete": True,
        "countUnit": "light_entities",
        "items": [
            {
                "entityId": "light.group",
                "areaId": "kitchen-id",
                "name": "light.group",
                "state": "on",
                "brightness": None,
                "supportsBrightness": False,
            },
            {
                "entityId": "light.ceiling",
                "areaId": "kitchen-id",
                "name": "Køkken",
                "state": "off",
                "brightness": 0,
                "supportsBrightness": False,
            },
            {
                "entityId": "light.floor",
                "areaId": "kitchen-id",
                "name": "light.floor",
                "state": "unknown",
                "brightness": None,
                "supportsBrightness": False,
            },
        ],
    }


@pytest.mark.parametrize("value", ["unknown", "unavailable", "invalid", "", "ON"])
def test_unknown_states_are_never_zero_or_off(value):
    row = project(states=[state(value=value)])["items"][0]
    assert row["state"] == (value if value in {"unknown", "unavailable"} else "unknown")
    assert row["brightness"] is None


@pytest.mark.parametrize("brightness", [None, -1, 256, True, "0", 0.5])
def test_invalid_or_unknown_brightness_remains_null(brightness):
    assert project(states=[state(brightness=brightness)])["items"][0]["brightness"] is None


@pytest.mark.parametrize("brightness", [0, 128, 255])
def test_actual_brightness_keeps_exact_ha_0_to_255_units(brightness):
    assert project(states=[state(brightness=brightness)])["items"][0]["brightness"] == brightness


@pytest.mark.parametrize(
    "attributes,expected",
    [
        ({"brightness": 120}, False),
        ({"supported_color_modes": ["brightness"]}, True),
        ({"supported_color_modes": ["color_temp", "hs"]}, True),
        ({"supported_color_modes": ["white", "rgb"]}, True),
        ({"supported_color_modes": ["white"]}, False),
        ({"supported_color_modes": ["unknown", "brightness"]}, False),
        ({"supported_color_modes": ["onoff", "brightness"]}, False),
        ({"supported_color_modes": ["brightness", "rgb"]}, False),
        ({"supported_color_modes": ["onoff"], "supported_features": 1}, False),
        ({"supported_color_modes": "brightness", "supported_features": 1}, False),
        ({"supported_color_modes": ["made_up"], "supported_features": 1}, False),
        ({"supported_color_modes": [], "supported_features": 1}, False),
        ({"supported_features": 1}, True),
        ({"supported_features": 5}, True),
        ({"supported_features": 2}, False),
        ({"supported_features": True}, False),
        ({"supported_features": -1}, False),
    ],
)
def test_slider_support_is_declared_by_actual_ha_attributes(attributes, expected):
    assert project(states=[state(**attributes)])["items"][0]["supportsBrightness"] is expected


def test_assumed_state_never_claims_observed_on_and_private_source_fields_do_not_escape():
    raw = state(assumed_state=True, friendly_name="Loft", secret="private")
    raw["context"] = {"user_id": "private"}
    result = project(states=[raw])
    assert result["items"][0]["state"] == "unknown"
    assert "private" not in str(result)


@pytest.mark.parametrize(
    "registry,states",
    [
        (area(["light.a", "light.a"]), [state("light.a"), state("light.a")]),
        (area(["light.a"]), [state("light.other")]),
        (area(["light.a", "light.b"]), [state("light.a"), state("light.a")]),
        (area(["light.a"]), []),
        (area([]), [state()]),
        (area(["switch.a"]), [state("switch.a")]),
        (area(["light.A"]), [state("light.A")]),
        (area(["light.a"], area_id="same-name-other-id"), [state("light.a")]),
        (area(["light.a"], name=""), [state("light.a")]),
        ({**area(), "complete": False}, []),
        (None, []),
    ],
)
def test_partial_ambiguous_or_wrong_area_source_never_gets_complete_dto(registry, states):
    with pytest.raises(ValueError):
        project_area_lights(
            scope=SCOPE, source_epoch="ha-source-1", area=registry, states=states, observed_at=100
        )


async def test_known_empty_area_is_observed_complete_and_never_calls_empty_target_reader():
    state_reader = AsyncMock(side_effect=AssertionError("empty must not invoke HA defaults"))
    result = await read(read_states=state_reader)
    assert result["status"] == "observed" and result["complete"] is True
    assert result["items"] == [] and result["scope"]["areaId"] == SCOPE.area_id
    state_reader.assert_not_called()


async def test_unbound_has_no_reads_scope_or_counts_and_no_all_home_fallback():
    registry = AsyncMock()
    states = AsyncMock()
    result = await read(scope=None, read_area=registry, read_states=states)
    assert result == {
        "status": "unbound",
        "source": "home_assistant_state",
        "sourceEpoch": "ha-source-1",
        "observedAt": None,
        "validUntil": None,
        "scope": None,
        "complete": False,
        "items": [],
        "countUnit": "light_entities",
    }
    registry.assert_not_called()
    states.assert_not_called()


async def test_supplied_registry_membership_including_inherited_device_area_is_exact():
    # The registry owner resolves entity area or inherited device area. This layer
    # neither infers area from labels nor widens to other entities in /states.
    registry = AsyncMock(return_value=area(["light.direct", "light.inherited"]))
    states = AsyncMock(return_value=[state("light.direct"), state("light.inherited")])
    result = await read(read_area=registry, read_states=states)
    registry.assert_awaited_once_with("kitchen-id")
    states.assert_awaited_once_with(("light.direct", "light.inherited"))
    assert len(result["items"]) == 2
    assert result["status"] == "observed"


@pytest.mark.parametrize("after", ["area", "states", "projection"])
async def test_owner_change_at_every_await_and_delivery_fences_late_result(after):
    current = True

    async def registry(_):
        nonlocal current
        if after == "area":
            current = False
        return area(["light.a"])

    async def states(_):
        nonlocal current
        if after == "states":
            current = False
        return [state("light.a")]

    def now():
        nonlocal current
        if after == "projection":
            current = False
        return 100.0

    result = await read(read_area=registry, read_states=states, current=lambda: current, now=now)
    assert result["status"] == "unavailable" and result["complete"] is False
    assert result["items"] == [] and result["observedAt"] is None


async def test_deadline_cancels_held_reader_without_retry_or_partial_observation():
    entered = asyncio.Event()
    cancelled = asyncio.Event()

    async def held(_):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    states = AsyncMock(side_effect=held)
    result = await read(area(["light.a"]), read_states=states, deadline_seconds=0.01)
    assert entered.is_set() and cancelled.is_set()
    assert result["status"] == "unavailable" and result["items"] == []
    states.assert_awaited_once()


async def test_outer_cancellation_propagates_and_drains_injected_read():
    entered = asyncio.Event()
    cancelled = asyncio.Event()

    async def held(_):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    task = asyncio.create_task(read(read_area=held))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancelled.is_set()


@pytest.mark.parametrize("count,expected", [(64, "observed"), (65, "unavailable")])
async def test_64_entity_bound_never_truncates_or_widens_target_set(count, expected):
    ids = [f"light.item_{n}" for n in range(count)]
    state_reader = AsyncMock(return_value=[state(eid) for eid in ids])
    result = await read(area(ids), read_states=state_reader)
    assert result["status"] == expected
    assert len(result["items"]) == (64 if count == 64 else 0)
    if count == 65:
        state_reader.assert_not_called()


@pytest.mark.parametrize("bad", ["oversize", "nan", "missing", "exception"])
async def test_transport_invalid_and_oversize_fail_closed(bad):
    raw = state()
    if bad == "oversize":
        raw["attributes"]["unprojected"] = "x" * MAX_BYTES
    elif bad == "nan":
        raw["attributes"]["brightness"] = float("nan")
    elif bad == "missing":
        raw.pop("attributes")
    states = (
        AsyncMock(side_effect=OSError("offline"))
        if bad == "exception"
        else AsyncMock(return_value=[raw])
    )
    result = await read(area(["light.ceiling"]), read_states=states)
    assert result["status"] == "unavailable" and result["complete"] is False


def test_retained_observation_preserves_timestamp_expires_exactly_and_is_detached():
    original = project()
    retained = current_area_lights(original, scope=SCOPE, source_epoch="ha-source-1", now=114.9)
    assert retained == original and retained is not original
    retained["items"][0]["name"] = "mutated"
    assert original["items"][0]["name"] != "mutated"
    assert original["observedAt"] == 100 and original["validUntil"] == 115
    assert current_area_lights(original, scope=SCOPE, source_epoch="ha-source-1", now=115) is None
    assert current_area_lights(original, scope=SCOPE, source_epoch="ha-source-1", now=99) is None


@pytest.mark.parametrize(
    "scope,epoch",
    [
        (replace(SCOPE, area_id="other-area"), "ha-source-1"),
        (replace(SCOPE, binding_id="other-controller"), "ha-source-1"),
        (replace(SCOPE, placement_revision=4), "ha-source-1"),
        (replace(SCOPE, is_own_area=False), "ha-source-1"),
        (SCOPE, "ha-source-2"),
    ],
)
def test_profile_area_placement_source_and_own_area_fence_cached_observation(scope, epoch):
    assert current_area_lights(project(), scope=scope, source_epoch=epoch, now=101) is None


@pytest.mark.parametrize(
    "change",
    [
        lambda x: x.update(extra="not admitted"),
        lambda x: x.update(validUntil=116),
        lambda x: x.update(complete=1),
        lambda x: x["scope"].update(extra=True),
        lambda x: x["scope"].update(isOwnArea=1),
        lambda x: x["scope"].update(placementRevision=3.0),
        lambda x: x["items"][0].update(extra=True),
        lambda x: x["items"][0].update(areaId="other"),
        lambda x: x["items"][0].update(brightness=True),
        lambda x: x["items"][0].update(supportsBrightness=1),
        lambda x: x["items"].append(copy.deepcopy(x["items"][0])),
    ],
)
def test_cached_dto_remains_closed_and_cannot_create_freshness_or_count_authority(change):
    value = project()
    change(value)
    assert current_area_lights(value, scope=SCOPE, source_epoch="ha-source-1", now=101) is None


def test_scope_is_immutable_and_two_same_session_room_controllers_remain_distinct():
    with pytest.raises(FrozenInstanceError):
        SCOPE.area_id = "other"
    second = replace(SCOPE, binding_id="second-controller-same-session-room")
    assert project(scope=second)["scope"]["bindingId"] != project()["scope"]["bindingId"]
    assert current_area_lights(project(), scope=second, source_epoch="ha-source-1", now=101) is None
