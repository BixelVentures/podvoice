"""Pinned HA V1 cache shape through actual service handler and addon projector.

HA registries/coordinator are inert objects; no Roborock RPC or physical effects.
"""

import importlib.util
from datetime import UTC, datetime, timedelta
from enum import IntEnum
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest

from gatekeeper.podview_robot import project_job

SOURCE = Path(__file__).parents[2] / "custom_components/podvoice/robot_snapshot.py"
spec = importlib.util.spec_from_file_location("ha_robot_snapshot", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InCleaning(IntEnum):
    complete = 0
    global_clean_not_complete = 1
    zone_clean_not_complete = 2
    segment_clean_not_complete = 3


def fixture():
    now = datetime.now(UTC)
    request = dict(
        entity_id="vacuum.qrevo",
        config_entry_id="entry",
        device_id="robot",
        unique_id="duid_slug",
        model="roborock.vacuum.a75",
    )
    registry = NS(
        entity_id=request["entity_id"],
        platform="roborock",
        disabled_by=None,
        config_entry_id="entry",
        device_id="robot",
        unique_id="duid_slug",
    )
    device = NS(manufacturer="Roborock", model=request["model"], config_entries={"entry"})
    state = NS(state="cleaning", last_changed=now - timedelta(seconds=20))
    status = NS(in_cleaning=InCleaning.segment_clean_not_complete, current_map=2, repeat=2)
    data = NS(
        rooms={16: object(), 17: object(), 18: object()},
        blocks=bytes([16, 18]),
        additional_parameters={"map_index": 42, "map_sequence": 79},
    )
    home = NS(home_map_content={2: NS(map_data=data)}, current_map_data=NS(map_flag=2))
    maps = NS(current_map=2, current_map_info=NS(map_flag=2))
    coordinator = NS(
        duid_slug="duid_slug",
        last_update_success=True,
        properties_api=NS(status=status, home=home, maps=maps, map_content=NS(map_data=data)),
        last_home_update=now - timedelta(seconds=5),
        _last_update_success_time=now - timedelta(seconds=4),
    )
    entry = NS(domain="roborock", state=NS(value="loaded"), runtime_data={"owner": coordinator})
    supervisor = NS(id="supervisor", is_active=True, is_admin=True, system_generated=True)
    hass = NS(
        config_entries=NS(async_get_entry=lambda _: entry),
        states=NS(get=lambda _: state),
        data={"supervisor": supervisor},
        auth=NS(async_get_user=AsyncMock(return_value=supervisor)),
    )
    module._supervisor = lambda hass: hass.data.get("supervisor")
    context = NS(user_id="supervisor", parent_id=None)
    entities = NS(async_get=lambda _: registry)
    devices = NS(async_get=lambda _: device)
    handler = module.make_robot_snapshot_handler(hass, lambda _: entities, lambda _: devices)
    return NS(
        request=request,
        registry=registry,
        device=device,
        state=state,
        status=status,
        data=data,
        home=home,
        maps=maps,
        coordinator=coordinator,
        entry=entry,
        hass=hass,
        handler=handler,
        context=context,
        supervisor=supervisor,
    )


async def read(f):
    return await f.handler(NS(data=f.request, context=f.context))


async def test_selected_room_set_and_repeat_survive_actual_handler_addon_boundary():
    f = fixture()
    raw = await read(f)
    projected = project_job(raw, "vacuum.qrevo")
    assert projected == raw
    assert projected["scope"] == "selected"
    assert projected["segmentIds"] == [16, 18]  # Full block11 set, not current position.
    assert projected["repeat"] == 2
    assert projected["mapId"] == 2
    assert set(raw) == {
        "schema",
        "status",
        "source",
        "vacuumEntityId",
        "mapId",
        "mapIndex",
        "mapSequence",
        "scope",
        "segmentIds",
        "roomIds",
        "repeat",
        "observedAt",
        "statusObservedAt",
        "mapObservedAt",
    }


async def test_whole_home_is_explicit_and_does_not_reuse_old_selected_blocks():
    f = fixture()
    f.status.in_cleaning = InCleaning.global_clean_not_complete
    f.data.blocks = bytes([16])
    raw = await read(f)
    assert project_job(raw, "vacuum.qrevo")["segmentIds"] == [16, 17, 18]
    assert raw["scope"] == "all"


@pytest.mark.parametrize(
    "failure",
    [
        "post-run",
        "zone",
        "stale-map",
        "stale-status",
        "old-job-map",
        "future",
        "changed-map",
        "missing-map-id",
        "empty-blocks",
        "foreign-block",
        "duplicate-block",
        "bad-repeat",
        "bool-repeat",
        "entity",
        "unique",
        "model",
        "config",
        "disabled",
        "owner-unloaded",
        "owner-failed",
        "owner-ambiguous",
        "bad-config-type",
        "extra-request",
    ],
)
async def test_no_observed_job_without_coherent_active_bound_cache(failure):
    f = fixture()
    if failure == "post-run":
        f.status.in_cleaning = InCleaning.complete
    elif failure == "zone":
        f.status.in_cleaning = InCleaning.zone_clean_not_complete
    elif failure == "stale-map":
        f.coordinator.last_home_update -= timedelta(seconds=61)
    elif failure == "stale-status":
        f.coordinator._last_update_success_time -= timedelta(seconds=61)
    elif failure == "old-job-map":
        f.state.last_changed = datetime.now(UTC)
    elif failure == "future":
        f.coordinator.last_home_update += timedelta(seconds=120)
    elif failure == "changed-map":
        f.status.current_map = 3
    elif failure == "missing-map-id":
        del f.data.additional_parameters["map_sequence"]
    elif failure == "empty-blocks":
        f.data.blocks = b""
    elif failure == "foreign-block":
        f.data.blocks = bytes([25])
    elif failure == "duplicate-block":
        f.data.blocks = bytes([16, 16])
    elif failure == "bad-repeat":
        f.status.repeat = 0
    elif failure == "bool-repeat":
        f.status.repeat = True
    elif failure == "entity":
        f.registry.entity_id = "vacuum.other"
    elif failure == "unique":
        f.registry.unique_id = "changed"
    elif failure == "model":
        f.device.model = "different"
    elif failure == "config":
        f.registry.config_entry_id = "changed"
    elif failure == "disabled":
        f.registry.disabled_by = "user"
    elif failure == "owner-unloaded":
        f.entry.state.value = "not_loaded"
    elif failure == "owner-failed":
        f.coordinator.last_update_success = False
    elif failure == "owner-ambiguous":
        f.entry.runtime_data["second"] = f.coordinator
    elif failure == "bad-config-type":
        f.device.config_entries = "prefix-entry-suffix"
    elif failure == "extra-request":
        f.request["command"] = "app_start"
    raw = await read(f)
    assert raw == {"schema": "podview.robot_job.v1", "status": "unavailable"}
    assert project_job(raw, "vacuum.qrevo") == {"status": "unavailable"}


@pytest.mark.parametrize(
    "patch",
    [
        {"mapId": True},
        {"mapSequence": -1},
        {"scope": "guessed"},
        {"scope": []},
        {"segmentIds": [True]},
        {"segmentIds": [16, 16]},
        {"segmentIds": [256]},
        {"repeat": True},
        {"observedAt": float("nan")},
        {"mapObservedAt": 0},
        {"vacuumEntityId": "vacuum.other"},
        {"extra": "untrusted"},
    ],
)
async def test_addon_closed_boundary_rejects_bad_payload(patch):
    f = fixture()
    raw = await read(f)
    assert project_job(raw, "vacuum.qrevo")["status"] == "observed"
    assert project_job({**raw, **patch}, "vacuum.qrevo") == {"status": "unavailable"}


async def test_addon_does_not_relabel_stale_cached_job_as_current(monkeypatch):
    f = fixture()
    raw = await read(f)
    monkeypatch.setattr(module.time, "time", lambda: raw["observedAt"] + 61)
    assert project_job(raw, "vacuum.qrevo") == {"status": "unavailable"}


@pytest.mark.parametrize(
    "denied", ["missing", "foreign", "inactive", "nonadmin", "nonsystem", "parent"]
)
async def test_only_actual_supervisor_identity_can_read(denied):
    f = fixture()
    if denied == "missing":
        f.context.user_id = None
    elif denied == "foreign":
        f.hass.auth.async_get_user.return_value = NS(**vars(f.supervisor))
    elif denied == "inactive":
        f.supervisor.is_active = False
    elif denied == "nonadmin":
        f.supervisor.is_admin = False
    elif denied == "nonsystem":
        f.supervisor.system_generated = False
    else:
        f.context.parent_id = "parent"
    with pytest.raises(ValueError, match="authenticated Supervisor required"):
        await read(f)
