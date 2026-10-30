"""Durable receipts through actual ToolRouter policy, validation and POST boundary."""

import asyncio
import copy
import json
from unittest.mock import AsyncMock

import httpx
import pytest
from unit.test_device_control import MAP, MODE, MOP, ROBOT, Rig

from gatekeeper import cleaning_journal
from gatekeeper.cleaning_journal import CleaningJournal
from gatekeeper.device_control import CapabilityError
from gatekeeper.execution_policy import ExecutionContext
from gatekeeper.tools import ToolRouter


def bind(rig, path):
    rig.router = ToolRouter(
        None, client=rig.client, supervisor_token="test-token", cleaning_journal_path=path
    )
    rig.router._device_control._registry = AsyncMock(
        side_effect=lambda: copy.deepcopy(rig.registry)
    )
    rig.router._device_control._areas = AsyncMock(side_effect=lambda: copy.deepcopy(rig.areas))
    rig.configure()
    return rig.router._device_control


async def start(rig, turn="one"):
    context = ExecutionContext("session", turn)
    read = await rig.read(context=context)
    assert read["ok"], read
    return await rig.act(
        read["capability_token"],
        "vacuum.send_command",
        arguments={"command": "app_segment_clean", "area_ids": ["kitchen"], "repeat": 2},
        context=context,
    )


@pytest.fixture
async def setup(tmp_path):
    rig = Rig()
    path = tmp_path / "cleaning-journal.json"
    bind(rig, path)
    yield rig, path
    await rig.client.aclose()


async def test_accepted_recipe_survives_restart_closed_and_last_three(setup):
    rig, path = setup
    before_declarations = rig.router.declarations()
    for number in range(4):
        result = await start(rig, str(number))
        assert result["ok"] and result["data"]["accepted_by_ha"]
        assert result["data"]["physical_result_verified"] is False
    history = bind(rig, path).cleaning_history()
    assert history["durable"] is True
    assert len(history["items"]) == 3
    assert len(rig.writes) == 4
    assert rig.router.declarations() == before_declarations
    row = history["items"][0]
    assert row["outcome"] == "accepted_by_ha" and row["accepted_at"] is not None
    assert row["physical_result_verified"] is False
    recipe = row["recipe"]
    assert recipe["vacuum_entity_id"] == ROBOT
    assert recipe["map_entity_id"] == MAP and recipe["map_name"] == "Ground floor"
    assert recipe["area_ids"] == ["kitchen"] and recipe["segments"] == [16]
    assert recipe["repeat"] == 2
    assert {r["entity_id"]: r["value"] for r in recipe["verified_settings"]} == {
        ROBOT: "balanced",
        MODE: "vacuum_and_mop",
        MOP: "medium",
    }
    assert all(
        len(recipe[k]) == 64 for k in ("device_identity", "map_fingerprint", "mapping_identity")
    )
    raw = path.read_text()
    assert all(
        secret not in raw
        for secret in ("test-token", "capability_token", "session", "Authorization", "Bearer")
    )
    assert path.stat().st_mode & 0o777 == 0o600
    history["items"].clear()
    assert len(rig.router._device_control.cleaning_history()["items"]) == 3
    # A genuinely new committed turn can start after prior HA acceptance.
    assert (await start(rig, "after-restart"))["ok"]


@pytest.mark.parametrize("failure", ["disconnect", "timeout", "cancel"])
async def test_unknown_is_durable_before_interrupted_send_and_blocks_restart(setup, failure):
    rig, path = setup
    entered = asyncio.Event()

    async def interrupted():
        stored = json.loads(path.read_text())
        assert stored["records"][-1]["outcome"] == "unknown"
        assert stored["pending"][-1]["recipe"]["vacuum_entity_id"] == ROBOT
        entered.set()
        if failure == "disconnect":
            raise httpx.ReadError("inert disconnect")
        if failure == "timeout":
            raise httpx.ReadTimeout("inert timeout")
        await asyncio.Future()

    rig.write_hook = interrupted
    task = asyncio.create_task(start(rig))
    await asyncio.wait_for(entered.wait(), 1)
    if failure == "cancel":
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    else:
        assert (await task)["error_kind"] == "device_outcome_unknown"
    rig.write_hook = None
    adapter = bind(rig, path)
    assert adapter.cleaning_history()["items"][0]["outcome"] == "unknown"
    assert not (await start(rig, "after-restart"))["ok"]
    assert len(rig.writes) == 1


@pytest.mark.parametrize("failure", ["replace", "file_fsync", "directory_fsync"])
async def test_storage_failure_before_send_preserves_previous_acceptance(
    setup, monkeypatch, failure
):
    rig, path = setup
    assert (await start(rig, "accepted"))["ok"]
    original = json.loads(path.read_text())["records"][-1]
    if failure == "replace":
        monkeypatch.setattr(
            cleaning_journal.os, "replace", lambda *_: (_ for _ in ()).throw(OSError("disk failed"))
        )
    else:
        actual = cleaning_journal.os.fsync
        count = 0

        def fail(fd):
            nonlocal count
            count += 1
            if count == (1 if failure == "file_fsync" else 2):
                raise OSError("disk failed")
            actual(fd)

        monkeypatch.setattr(cleaning_journal.os, "fsync", fail)
    result = await start(rig, "fails-before-send")
    assert not result["ok"] and len(rig.writes) == 1
    assert original in json.loads(path.read_text())["records"]
    assert not (await start(rig, "also-denied"))["ok"]
    assert len(rig.writes) == 1


@pytest.mark.parametrize("failure", ["replace", "file_fsync", "directory_fsync"])
async def test_acceptance_save_failure_preserves_known_ha_result(setup, monkeypatch, failure):
    rig, path = setup
    adapter = rig.router._device_control
    original_replace, original_fsync = cleaning_journal.os.replace, cleaning_journal.os.fsync
    calls = 0

    def fail_at_acceptance(*args):
        nonlocal calls
        calls += 1
        fail_at = {"replace": 2, "file_fsync": 3, "directory_fsync": 4}[failure]
        if calls == fail_at:
            raise OSError("acceptance receipt durability failed after confirmed HA response")
        return (original_replace if failure == "replace" else original_fsync)(*args)

    monkeypatch.setattr(
        cleaning_journal.os, "replace" if failure == "replace" else "fsync", fail_at_acceptance
    )
    result = await start(rig)
    assert result["ok"] and result["data"]["accepted_by_ha"] is True
    assert result["data"]["physical_result_verified"] is False
    assert result["data"]["history_recorded"] is False
    assert "error_kind" not in result
    assert len(rig.writes) == 1
    assert not (await start(rig))["ok"]  # Same owner remains terminal.
    assert not (await start(rig, "same-process-new-turn"))["ok"]
    assert adapter.cleaning_history()["status"] == "unavailable"
    assert len(rig.writes) == 1
    bind(rig, path)
    after_restart = await start(rig, "after-restart")
    if failure == "directory_fsync":
        # Accepted rename is visible. The previous result was known accepted,
        # so a genuinely new committed turn is not replay of an unknown effect.
        assert after_restart["ok"] and len(rig.writes) == 2
    else:
        # The durable unknown admission remains when accepted replacement failed.
        assert not after_restart["ok"] and len(rig.writes) == 1


@pytest.mark.parametrize(
    "content",
    [b"{broken", b"x" * (65536 + 1), b'{"version":1,"records":[],"pending":[],"token":"secret"}'],
)
async def test_corrupt_journal_fails_closed_without_commands(setup, content):
    rig, path = setup
    path.write_bytes(content)
    adapter = bind(rig, path)
    assert adapter.cleaning_history() == {"status": "unavailable", "items": []}
    assert not (await start(rig))["ok"]
    assert not rig.writes


async def test_missing_parent_is_unwritable_and_sends_no_command(setup, tmp_path):
    rig, _ = setup
    bind(rig, tmp_path / "missing" / "journal.json")
    assert not (await start(rig))["ok"]
    assert not rig.writes


async def test_retention_never_evicts_unknown_vacuum_blocker(setup):
    rig, path = setup
    rig.write_hook = AsyncMock(side_effect=httpx.ReadError("unknown"))
    assert not (await start(rig))["ok"]
    original = json.loads(path.read_text())["pending"][0]["recipe"]
    # Other vacuum owners can complete while this original vacuum stays blocked.
    journal = CleaningJournal(path)
    for number in range(4):
        other = {**original, "vacuum_entity_id": f"vacuum.other_{number}"}
        other.pop("settings_inventory", None)  # Historical independent-owner fixture.
        admission = journal.begin(other)
        journal.accepted(admission)
    assert len(journal.history()["items"]) == 3
    assert all(row["recipe"]["vacuum_entity_id"] != ROBOT for row in journal.history()["items"])
    rig.write_hook = None
    bind(rig, path)
    assert not (await start(rig, "after-retention"))["ok"]
    assert len(rig.writes) == 1


async def test_two_loaded_owners_cannot_overwrite_unknown_admission(setup):
    rig, path = setup
    stale = CleaningJournal(path)
    rig.write_hook = AsyncMock(side_effect=httpx.ReadError("unknown"))
    assert not (await start(rig))["ok"]
    recipe = json.loads(path.read_text())["pending"][0]["recipe"]
    with pytest.raises(cleaning_journal.JournalError):
        stale.begin(recipe)
    assert len(json.loads(path.read_text())["pending"]) == 1


async def test_history_respects_current_allowlist_and_unknown_storage_bound(setup, monkeypatch):
    rig, path = setup
    assert (await start(rig))["ok"]
    recipe = json.loads(path.read_text())["records"][0]["recipe"]
    adapter = rig.router._device_control
    rig.configure(entities=["vacuum.other"])
    assert adapter.cleaning_history()["items"] == []
    rig.configure(False)
    with pytest.raises(CapabilityError):
        adapter.cleaning_history()
    journal = CleaningJournal(path)
    monkeypatch.setattr(cleaning_journal, "_MAX_PENDING", 1)
    recipe.pop("settings_inventory", None)  # Historical independent-owner fixtures.
    journal.begin({**recipe, "vacuum_entity_id": "vacuum.other"})
    before = path.read_bytes()
    with pytest.raises(cleaning_journal.JournalError):
        journal.begin({**recipe, "vacuum_entity_id": "vacuum.third"})
    assert path.read_bytes() == before


@pytest.mark.parametrize("kind", ["duplicate", "fifo", "symlink"])
async def test_nonregular_or_ambiguous_storage_fails_closed(setup, kind):
    rig, path = setup
    if kind == "duplicate":
        path.write_text('{"version":1,"records":[],"pending":[{}],"pending":[]}')
    elif kind == "fifo":
        cleaning_journal.os.mkfifo(path)
    else:
        target = path.with_suffix(".other")
        target.write_text('{"version":1,"records":[],"pending":[]}')
        path.symlink_to(target)
    bind(rig, path)
    assert not (await start(rig))["ok"]
    assert not rig.writes


async def test_passive_history_projection_retains_latest_three_without_authority(setup):
    from gatekeeper.podview import _home_vacuum

    rig, path = setup
    for number in range(4):
        assert (await start(rig, str(number)))["ok"]
    bind(rig, path)
    data = await rig.router.podview_home_read()
    projected = _home_vacuum(data)
    row = projected["items"][0]
    history = row["history"]
    assert history["status"] == "observed"
    assert len(history["items"]) == 3
    times = [item["recordedAt"] for item in history["items"]]
    assert times == sorted(times, reverse=True)
    assert all(item["actions"] == [] for item in history["items"])
    assert all(item["physicalResultVerified"] is False for item in history["items"])
    assert history["items"][0]["recipe"]["areaIds"] == ["kitchen"]
    serialized = json.dumps(projected)
    for private in (
        "device_identity",
        "map_fingerprint",
        "mapping_identity",
        "segments",
        "capability_token",
        "test-token",
    ):
        assert private not in serialized
    assert len(rig.writes) == 4  # Display read issued no mutation.
    rig.router.configure_device_control({"extended_device_control": False})
    assert await rig.router.podview_home_read() == {"status": "unavailable", "items": []}
