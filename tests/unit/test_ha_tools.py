"""Tool bridge: curated allowlisted home tools + generic list/home_call access.

PodVoice only speaks Home Assistant generically — there is NO device-specific
integration here. Music/speakers (PodConnect), a vacuum, a fan, etc. are all reached
the same way: list_services + home_call.
"""

from __future__ import annotations

import json

import httpx

from gatekeeper import constants as C
from gatekeeper.ha_tools import HAToolBridge

SVC = C.SUPERVISOR_CORE_API


def _bridge(client, exposed=()):
    return HAToolBridge("tok", client, exposed=exposed)


async def test_declarations_are_generic_ha_only():
    async with httpx.AsyncClient() as client:
        names = {d["name"] for d in _bridge(client).declarations()}
    assert {"list_home", "list_services", "turn_on", "home_call", "add_todo"} <= names
    # No device-specific / PodConnect-Control machinery baked into PodVoice.
    assert not ({"music", "play_music", "podconnect", "media_control", "set_volume"} & names)


async def test_allowlist_denies_unexposed(respx_mock):
    route = respx_mock.post(f"{SVC}/services/homeassistant/turn_on")
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["switch"]).dispatch(
            "turn_on", {"entity_id": "light.kitchen"}
        )
    assert r["ok"] is False and "not exposed" in r["error"]
    assert not route.called  # never hit HA


async def test_turn_on_allowed_by_domain(respx_mock):
    route = respx_mock.post(f"{SVC}/services/homeassistant/turn_on").respond(200, json=[])
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["light"]).dispatch(
            "turn_on", {"entity_id": "light.kitchen"}
        )
    assert r["ok"] is True
    assert json.loads(route.calls.last.request.content)["entity_id"] == "light.kitchen"


async def test_list_home_filters_to_exposed(respx_mock):
    states = [
        {"entity_id": "light.kitchen", "state": "on", "attributes": {"friendly_name": "Kitchen"}},
        {"entity_id": "lock.front", "state": "locked", "attributes": {}},
    ]
    respx_mock.get(f"{SVC}/states").respond(200, json=states)
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["light"]).dispatch("list_home", {})
    assert [e["entity_id"] for e in r["entities"]] == ["light.kitchen"]  # lock not exposed


async def test_list_services_filters_to_allowed_domains(respx_mock):
    services = [
        {
            "domain": "podconnect",
            "services": {
                "play_from_library": {
                    "fields": {
                        "source": {
                            "description": "Which collection",
                            "selector": {"select": {"options": ["liked", "top_tracks", "recent"]}},
                        },
                        "shuffle": {"description": "Shuffle first"},
                    }
                },
                "top_tracks": {"fields": {}, "response": {"optional": False}},
            },
        },
        {"domain": "lock", "services": {"lock": {"fields": {}}}},
    ]
    respx_mock.get(f"{SVC}/services").respond(200, json=services)
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["podconnect"]).dispatch("list_services", {})
    assert "podconnect" in r["services"] and "lock" not in r["services"]  # only exposed domains
    pc = r["services"]["podconnect"]
    # the model can SEE the valid source values + that top_tracks returns data
    assert pc["play_from_library"]["fields"]["source"]["values"] == [
        "liked",
        "top_tracks",
        "recent",
    ]
    assert pc["top_tracks"]["returns_response"] is True
    assert pc["play_from_library"]["returns_response"] is False


async def test_home_call_plays_media_generically(respx_mock):
    # "Play X" is just a generic home_call on the exposed media_player — no special tool.
    route = respx_mock.post(f"{SVC}/services/media_player/play_media").respond(200, json=[])
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["media_player"]).dispatch(
            "home_call",
            {
                "domain": "media_player",
                "service": "play_media",
                "entity_id": "media_player.kitchen",
                "data": {"media_content_type": "music", "media_content_id": "spotify:track:abc"},
            },
        )
    assert r["ok"] is True and route.called
    assert json.loads(route.calls.last.request.content)["entity_id"] == "media_player.kitchen"


async def test_home_call_denied_when_unexposed(respx_mock):
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=[]).dispatch(
            "home_call", {"domain": "vacuum", "service": "start", "entity_id": "vacuum.roborock"}
        )
    assert r["ok"] is False


async def test_home_call_account_level_needs_domain_exposed(respx_mock):
    # No entity_id (account-level service) -> the DOMAIN must be exposed.
    async with httpx.AsyncClient() as client:
        denied = await _bridge(client, exposed=[]).dispatch(
            "home_call", {"domain": "podconnect", "service": "top_tracks"}
        )
    assert denied["ok"] is False and "podconnect" in denied["error"]


async def test_home_call_return_response_reads_data(respx_mock):
    route = respx_mock.post(url__regex=r".*/services/podconnect/top_tracks.*").respond(
        200, json={"service_response": {"tracks": ["a", "b", "c"]}}
    )
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["podconnect"]).dispatch(
            "home_call",
            {"domain": "podconnect", "service": "top_tracks", "return_response": True},
        )
    assert r["ok"] is True and route.called
    assert r["response"] == {"tracks": ["a", "b", "c"]}


async def test_list_entities_includes_area_and_domains(respx_mock):
    states = [
        {"entity_id": "light.kitchen", "state": "on", "attributes": {"friendly_name": "Kitchen"}},
        {"entity_id": "media_player.koek", "state": "idle", "attributes": {"friendly_name": "Køk"}},
    ]
    respx_mock.get(f"{SVC}/states").respond(200, json=states)
    respx_mock.post(f"{SVC}/template").respond(
        200, text='[["light.kitchen", "Køkken"], ["media_player.koek", "Køkken"]]'
    )
    async with httpx.AsyncClient() as client:
        r = await _bridge(client).list_entities()
    assert r["ok"] is True
    assert "media_player" in r["domains"] and "light" in r["domains"]
    by_id = {e["entity_id"]: e for e in r["entities"]}
    assert by_id["light.kitchen"]["area"] == "Køkken"
    assert by_id["media_player.koek"]["name"] == "Køk"


async def test_list_entities_survives_no_area_template(respx_mock):
    respx_mock.get(f"{SVC}/states").respond(
        200, json=[{"entity_id": "fan.office", "state": "on", "attributes": {}}]
    )
    respx_mock.post(f"{SVC}/template").respond(500)  # area lookup down -> still lists entities
    async with httpx.AsyncClient() as client:
        r = await _bridge(client).list_entities()
    assert r["ok"] is True and r["entities"][0]["area"] is None


async def test_unknown_tool_and_ha_error_are_soft(respx_mock):
    respx_mock.post(f"{SVC}/services/homeassistant/turn_on").respond(500)
    async with httpx.AsyncClient() as client:
        b = _bridge(client, exposed=["light"])
        assert (await b.dispatch("nope", {}))["ok"] is False
        assert (await b.dispatch("turn_on", {"entity_id": "light.x"}))["ok"] is False
