"""Synthetic SafeEval admission uses actual production schemas and no HA fallback."""

import json
from pathlib import Path

import pytest

from gatekeeper import podconnect_targets as targets
from gatekeeper.eval_harness import SafeEvalTools, _admit_eval_tools, load_scenarios

FIXTURE = Path(__file__).parents[1] / "fixtures/podconnect_target_services.json"


def admitted():
    page = json.loads(FIXTURE.read_text())
    declarations = targets.declarations((), targets.contracts(page["services"]))
    scenarios = tuple(s for s in load_scenarios() if s.id.startswith("music-"))
    assert {s.id for s in scenarios} == {
        "music-account-clarification",
        "music-explicit-stable-target",
        "music-transfer-unknown-no-retry",
    }
    return _admit_eval_tools(scenarios, declarations)


async def test_production_schema_fixtures_ambiguity_namespaces_and_no_network(monkeypatch):
    from gatekeeper.tools import ToolRouter

    async def forbidden(*args, **kwargs):
        raise AssertionError("SafeEval must never reach production dispatch")

    monkeypatch.setattr(ToolRouter, "dispatch", forbidden)
    admission = admitted()
    tools = SafeEvalTools(
        declarations=admission.declarations, fixture_contracts=admission.contracts
    )
    accounts = await tools.dispatch("podconnect_get_targets", {})
    assert len(accounts["data"]["accounts"]) == 2 and tools.fixture_side_effects == 0
    catalog = await tools.dispatch("podconnect_get_targets", {"config_entry_id": "synthetic-north"})
    rows = catalog["data"]["targets"]
    assert len({r["name"] for r in rows}) == 1
    assert {r["kind"] for r in rows} == set(targets.KINDS)
    args = {
        "config_entry_id": "synthetic-north",
        "kind": "configured_alias",
        "target_id": "room-north",
    }
    local = await tools.dispatch("podconnect_move_playback", args)
    assert local["data"]["accepted_local"] is True and tools.fixture_side_effects == 1
    assert "playing" not in local["data"] and "provider_request_accepted" not in local["data"]
    unknown = await tools.dispatch(
        "podconnect_move_playback",
        {
            "config_entry_id": "synthetic-north",
            "kind": "spotify_device",
            "target_id": "spotify-north",
        },
    )
    assert unknown["error_kind"] == "unknown_outcome" and tools.fixture_side_effects == 1
    refused = await tools.dispatch("podconnect_move_playback", {**args, "kind": "observed_output"})
    assert refused["error_kind"] == "eval_fixture_args_mismatch"
    assert (await tools.dispatch("unreviewed_music_tool", {}))["error_kind"] == "eval_tool_refused"


def test_missing_or_changed_production_schema_fails_before_provider():
    declarations = targets.declarations(
        (), targets.contracts(json.loads(FIXTURE.read_text())["services"])
    )
    scenarios = tuple(s for s in load_scenarios() if s.id.startswith("music-"))
    with pytest.raises(ValueError, match="missing"):
        _admit_eval_tools(scenarios, declarations[:1])
    move = declarations[1]
    move["parameters"]["properties"]["kind"]["enum"] = ["observed_output"]
    with pytest.raises(ValueError, match="canonical eval args"):
        _admit_eval_tools(scenarios, declarations)


def test_existing_profile_and_exact_new_contract_provenance():
    from gatekeeper.eval_harness import DATA_EVAL_PATH, SCENARIOS_PATH

    source = json.loads(SCENARIOS_PATH.read_text())
    contracts = {r["exact_tool_name"]: r for r in source["fixture_contracts"]}
    assert contracts["podconnect_get_targets"]["risk"] == "read_only"
    assert contracts["podconnect_move_playback"]["risk"] == "low_risk"
    original_data = json.loads(DATA_EVAL_PATH.read_text())
    assert {r["exact_tool_name"] for r in original_data["fixture_contracts"]} == {
        "podconnect_recently_played",
        "podconnect_top_tracks",
        "podconnect_liked",
    }
    provenance = json.loads(FIXTURE.read_text())["provenance"]
    assert provenance["upstream_tag"] == "2026.8.2"
    assert len(provenance["source_hashes"]) == 5
    assert all(len(v) == 64 for v in provenance["source_hashes"].values())
