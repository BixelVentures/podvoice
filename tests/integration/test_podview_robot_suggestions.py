"""Real journal/capability/task/selector chain; all provider/HA effects inert."""

import asyncio
import copy
import json
import time
from types import SimpleNamespace

import httpx
import pytest
from integration.test_podview_controls import fixture as fixture
from integration.test_podview_controls import setup_body
from unit.test_device_control import ROBOT

from gatekeeper.podview_enrichment import configured_robot_recipe_selector
from gatekeeper.podview_mood import MoodSelector
from gatekeeper.podview_mood_budget import OngoingAllowance, OngoingPolicy
from gatekeeper.provider_budget import ProviderBudgetCoordinator


@pytest.fixture
async def ai(fixture, tmp_path):
    rig, bridge, token = fixture
    device = rig.router._device_control
    offered = await device.display_setup(ROBOT, ("podview:seed", "inert-source"))
    cap = device._display_tickets[offered["capability_token"]]
    recipe = {
        "vacuum_entity_id": ROBOT,
        "device_identity": cap.identity,
        "map_entity_id": cap.map_entity,
        "map_name": cap.map_name,
        "map_fingerprint": cap.map_fingerprint,
        "mapping_identity": cap.mapping_identity,
        "area_ids": ["kitchen"],
        "segments": [16],
        "repeat": 1,
        "verified_settings": [],
    }
    record = device._cleaning_journal.begin(recipe)
    device._cleaning_journal.accepted(record)
    state = SimpleNamespace(
        rig=rig,
        bridge=bridge,
        token=token,
        recipe=recipe,
        record=record,
        calls=[],
        block=False,
        entered=asyncio.Event(),
        gate=asyncio.Event(),
        result="r0",
        status=200,
    )

    async def provider(req):
        assert str(req.url) == "https://api.openai.com/v1/responses" and req.method == "POST"
        body = json.loads(req.content)
        state.calls.append(body)
        state.entered.set()
        if state.block:
            await state.gate.wait()
        if state.status != 200:
            return httpx.Response(state.status, json={"error": "inert provider"})
        payload = {"recipe_id": state.result}
        if body["text"]["format"]["name"] == "podview_mood":
            payload = {"theme_ids": ["cooking", "italian", "calm"]}
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": json.dumps(payload)}],
                    }
                ],
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(provider))
    policy = OngoingPolicy(20, 200, "explicit-robot-purpose-same-global-counter")
    path = tmp_path / "existing-global.json"
    assert OngoingAllowance.provision(path, policy)
    allowance = OngoingAllowance.open(path, policy)
    assert allowance is not None
    shared = MoodSelector(
        client,
        "inert-key",
        "gpt-6-luna",
        allowance=allowance,
        budget=ProviderBudgetCoordinator(default_limit=500000),
    )
    shared.room_kind = "kitchen"
    selector = configured_robot_recipe_selector(shared)
    assert selector is not None
    rig.router.podview_mood_selector = shared
    rig.router.podview_robot_recipe_selector = selector
    state.selector, state.shared, state.allowance = selector, shared, allowance
    try:
        yield state
    finally:
        await selector.aclose()
        await client.aclose()


async def settled(ai):
    if ai.selector.jobs:
        await asyncio.gather(*ai.selector.jobs)


async def setup(ai):
    result = await ai.bridge.controls.setup(setup_body(ai.bridge), ai.token)
    assert result["ok"], result
    return result


async def test_controls_return_before_model_and_existing_snapshots_only_project(ai):
    ai.block = True
    offer = await asyncio.wait_for(setup(ai), timeout=1)
    assert "robotSuggestion" not in offer["setup"]
    await ai.entered.wait()
    assert len(ai.calls) == 1 and not ai.gate.is_set()
    for _ in range(5):
        assert "robotSuggestions" not in ai.bridge.snapshot("kitchen", ai.token)
    assert len(ai.calls) == 1
    ai.gate.set()
    await settled(ai)
    rows = ai.bridge.snapshot("kitchen", ai.token)["robotSuggestions"]
    assert len(rows) == 1
    row = rows[0]
    start = next(o for o in offer["options"] if o["action"] == "start")
    assert row["taskId"] == offer["taskId"] and row["optionId"] == start["id"]
    assert row["expiresAt"] == offer["expiresAt"]
    assert row["areaIds"] == [start["argsSchema"]["areas"][0]["id"]]
    assert row["recipeId"] == ai.record and row["basis"] == "recent_choices"
    assert not ai.rig.writes
    raw = json.dumps(ai.calls[0])
    assert all(
        value not in raw
        for value in [ROBOT, "kitchen", "Køkkenalrum", ai.record, "capability_token"]
    )
    assert len(raw.encode()) <= 4096 and ai.calls[0]["max_output_tokens"] == 128
    assert ai.allowance.snapshot["day_used"] == 1


async def test_same_semantic_context_deduplicates_new_tasks_and_remaps_fresh_ids(ai):
    first = await setup(ai)
    await settled(ai)
    old = ai.bridge.snapshot("kitchen", ai.token)["robotSuggestions"][0]
    second = await setup(ai)
    await settled(ai)
    row = second["setup"]["robotSuggestion"]
    assert first["taskId"] != second["taskId"]
    assert row["taskId"] == second["taskId"] and row["recipeId"] == old["recipeId"]
    assert row["areaIds"] != old["areaIds"]
    assert len(ai.calls) == 1 and ai.allowance.snapshot["day_used"] == 1
    assert not ai.rig.writes


@pytest.mark.parametrize(
    "change",
    [
        "foreign_token",
        "foreign_room",
        "revoked",
        "spent",
        "expired",
        "journal_changed",
        "owner_changed",
    ],
)
async def test_projection_never_discloses_other_or_stale_task(ai, change):
    offer = await setup(ai)
    await settled(ai)
    task = ai.bridge.controls.tasks[offer["taskId"]]
    room, token = "kitchen", ai.token
    if change == "foreign_token":
        token = "another actor"
    elif change == "foreign_room":
        room = "another room"
    elif change == "revoked":
        ai.bridge._grants.clear()
    elif change == "spent":
        task["consumed"] = True
    elif change == "expired":
        task["deadline"] = 0
    elif change == "journal_changed":
        ai.rig.router._device_control._cleaning_journal.begin(ai.recipe)
    else:
        ai.rig.router._device_control._generation += 1
    assert ai.bridge.controls.robot_suggestions(room, token) == []
    assert not ai.rig.writes and len(ai.calls) == 1


async def test_late_provider_result_after_revocation_never_publishes(ai):
    ai.block = True
    await setup(ai)
    await ai.entered.wait()
    ai.bridge._grants.clear()
    ai.gate.set()
    await settled(ai)
    assert not any(entry["choice"] for entry in ai.selector.entries.values())
    assert not ai.rig.writes


@pytest.mark.parametrize("result,status", [("unowned", 200), (None, 200), ("r0", 429), ("r0", 500)])
async def test_optional_failure_is_memoized_and_manual_controls_survive(ai, result, status):
    ai.result, ai.status = result, status
    first = await setup(ai)
    await settled(ai)
    assert "robotSuggestions" not in ai.bridge.snapshot("kitchen", ai.token)
    second = await setup(ai)
    await settled(ai)
    assert second["options"] and first["options"] and len(ai.calls) == 1
    assert not ai.rig.writes


async def test_music_and_robot_charge_exact_same_global_ongoing_counter(ai):
    await setup(ai)
    await settled(ai)
    assert ai.allowance.snapshot["day_used"] == 1
    result = await ai.shared.select({"hour": 9, "roomKind": "kitchen"}, current=lambda: True)
    assert result == ["cooking", "italian", "calm"]
    assert ai.allowance.snapshot["day_used"] == 2 and len(ai.calls) == 2
    assert ai.selector.shared.allowance is ai.shared.allowance


async def test_owner_change_invalidates_inflight_and_shutdown_joins_cancellation(ai):
    ai.block = True
    await setup(ai)
    await ai.entered.wait()
    await ai.selector.aclose()
    assert not ai.selector.jobs and not ai.selector.entries
    assert not ai.rig.writes


async def test_unknown_pending_hidden_by_three_newer_records_blocks_suggestions(ai):
    journal = ai.rig.router._device_control._cleaning_journal
    journal.begin(ai.recipe)
    # Different robots can evict this unknown from the bounded three-row display,
    # but the existing durable pending blocker must still prevent an AI proposal.
    for n in range(3):
        recipe = copy.deepcopy(ai.recipe)
        recipe["vacuum_entity_id"] = "vacuum.other_" + str(n)
        record = journal.begin(recipe)
        journal.accepted(record)
    assert all(row["recipe"]["vacuum_entity_id"] != ROBOT for row in journal.history()["items"])
    offer = await setup(ai)
    await settled(ai)
    assert offer["options"] and not ai.calls
    assert "robotSuggestions" not in ai.bridge.snapshot("kitchen", ai.token)


async def test_projections_and_optional_setup_context_do_no_disk_reads(ai, monkeypatch):
    journal = ai.rig.router._device_control._cleaning_journal
    monkeypatch.setattr(
        journal, "_load", lambda: (_ for _ in ()).throw(AssertionError("optional disk read"))
    )
    offer = await setup(ai)
    await settled(ai)
    for _ in range(3):
        assert (
            ai.bridge.snapshot("kitchen", ai.token)["robotSuggestions"][0]["taskId"]
            == offer["taskId"]
        )
    assert len(ai.calls) == 1 and not ai.rig.writes


@pytest.mark.parametrize(
    "change", ["empty", "foreign_device", "foreign_map", "foreign_mapping", "future", "unhealthy"]
)
async def test_only_real_eligible_current_recipe_sources_admit_model_work(ai, change):
    journal = ai.rig.router._device_control._cleaning_journal
    if change == "empty":
        journal._state["records"] = []
    elif change == "unhealthy":
        journal._healthy = False
    else:
        row = journal._state["records"][0]
        if change == "future":
            row["recorded_at"] = time.time() + 10000
        else:
            key = {
                "foreign_device": "device_identity",
                "foreign_map": "map_fingerprint",
                "foreign_mapping": "mapping_identity",
            }[change]
            row["recipe"][key] = "b" * 64
    offer = await setup(ai)
    await settled(ai)
    assert offer["options"] and not ai.calls and not ai.rig.writes
    assert "robotSuggestions" not in ai.bridge.snapshot("kitchen", ai.token)


async def test_journal_semantic_change_invalidates_cached_choice_once(ai):
    await setup(ai)
    await settled(ai)
    journal = ai.rig.router._device_control._cleaning_journal
    recipe = copy.deepcopy(ai.recipe)
    recipe["repeat"] = 2
    record = journal.begin(recipe)
    journal.accepted(record)
    offer = await setup(ai)
    await settled(ai)
    row = ai.bridge.snapshot("kitchen", ai.token)["robotSuggestions"][0]
    assert row["taskId"] == offer["taskId"] and row["recipeId"] == record and row["repeat"] == 2
    assert len(ai.calls) == 2 and not ai.rig.writes


async def test_four_second_whole_job_deadline_never_delays_or_retries_controls(ai, monkeypatch):
    timers = []
    real_timeout = asyncio.timeout

    def capture(seconds):
        timer = real_timeout(seconds)
        if seconds == 4:
            timers.append(timer)
        return timer

    monkeypatch.setattr(asyncio, "timeout", capture)
    ai.block = True
    offer = await asyncio.wait_for(setup(ai), 1)
    await ai.entered.wait()
    assert len(timers) == 1 and offer["options"]
    timers[0].reschedule(asyncio.get_running_loop().time())
    await settled(ai)
    assert not ai.selector.jobs and not ai.rig.writes
    assert "robotSuggestions" not in ai.bridge.snapshot("kitchen", ai.token)
    await setup(ai)
    await settled(ai)
    assert len(ai.calls) == 1


async def test_exhausted_shared_quota_never_provisions_or_spends_another_bundle(ai):
    for _ in range(20):
        assert ai.allowance.reserve()
    assert not ai.allowance.reserve() and ai.allowance.remaining == 0
    offer = await setup(ai)
    await settled(ai)
    assert offer["options"] and not ai.calls and not ai.rig.writes
    assert ai.allowance.snapshot["day_used"] == 20


async def test_cache_and_inflight_capacity_are_bounded_to_twelve_device_entries(ai):
    offer = await setup(ai)
    context = copy.deepcopy(ai.bridge.controls.tasks[offer["taskId"]]["robot_planning"])
    await settled(ai)
    ai.block = True
    for i in range(20):
        changed = copy.deepcopy(context)
        changed["vacuum"] = "vacuum.capacity_" + str(i)
        ai.selector.schedule(changed, lambda: True)
    assert len(ai.selector.entries) == 12
    assert len(ai.selector.jobs) <= 12
    assert not ai.rig.writes


async def test_changed_policy_never_reveals_cached_proposal_to_same_actor(ai):
    await setup(ai)
    await settled(ai)
    assert ai.bridge.controls.robot_suggestions("kitchen", ai.token)
    ai.bridge.controls.policy["vacuum"][0]["actions"].remove("start")
    assert ai.bridge.controls.robot_suggestions("kitchen", ai.token) == []
    assert len(ai.calls) == 1 and not ai.rig.writes
