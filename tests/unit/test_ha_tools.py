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


async def test_web_search_is_generic_conversation_process(respx_mock):
    # Web search is NOT a special tool — it's the same generic path as podconnect/media:
    # expose the `conversation` domain, then home_call conversation.process (return_response).
    # The buried speech envelope must be promoted to a flat `summary` the model can read,
    # while `data` keeps the full payload.
    respx_mock.get(f"{SVC}/services").respond(200, json=[])  # auto-correct: unknown -> honor flag
    route = respx_mock.post(url__regex=r".*/services/conversation/process.*").respond(
        200,
        json={
            "service_response": {"response": {"speech": {"plain": {"speech": "Canada vandt 3-2."}}}}
        },
    )
    async with httpx.AsyncClient() as client:
        b = _bridge(client, exposed=["conversation"])
        # No bespoke web_search tool exists — only the generic bridge.
        assert "web_search" not in {d["name"] for d in b.declarations()}
        r = await b.dispatch(
            "home_call",
            {
                "domain": "conversation",
                "service": "process",
                "return_response": True,
                "data": {"agent_id": "conversation.google_ai_search", "text": "Canada-kampen"},
            },
        )
    assert r["ok"] is True and route.called
    assert r["summary"] == "Canada vandt 3-2."  # the spoken answer, flat
    assert (
        r["data"]["response"]["speech"]["plain"]["speech"] == "Canada vandt 3-2."
    )  # full payload kept


async def test_home_call_surfaces_ha_error_body(respx_mock):
    # A 400 from HA must include HA's explanation (which field is missing), not a bare code,
    # and be classified (error_kind/status) so the model can self-correct.
    respx_mock.get(f"{SVC}/services").respond(200, json=[])
    respx_mock.post(url__regex=r".*/services/conversation/process.*").respond(
        400, json={"message": "required key not provided @ data['text']"}
    )
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["conversation"]).dispatch(
            "home_call",
            {
                "domain": "conversation",
                "service": "process",
                "return_response": True,
                "data": {"agent_id": "conversation.google_ai_search"},
            },
        )
    assert r["ok"] is False and "text" in r["error"] and "400" in r["error"]
    assert r["error_kind"] == "ha_400" and r["status"] == 400 and r["hint"]


async def test_home_call_empty_response_flags_empty(respx_mock):
    # A successful-but-empty data service is distinguishable from a failure (empty flag),
    # so the model says "no results" rather than refusing.
    respx_mock.get(f"{SVC}/services").respond(200, json=[])
    respx_mock.post(url__regex=r".*/services/podconnect/recently_played.*").respond(
        200, json={"service_response": {}}
    )
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["podconnect"]).dispatch(
            "home_call",
            {"domain": "podconnect", "service": "recently_played", "return_response": True},
        )
    assert r["ok"] is True and r.get("empty") is True and "summary" not in r


async def test_home_call_forces_return_response_for_only_services(respx_mock):
    # Discovery is authoritative: a SupportsResponse.ONLY service gets return_response even
    # if the model forgot the flag (no more 400 on a guess).
    respx_mock.get(f"{SVC}/services").respond(
        200,
        json=[
            {"domain": "podconnect", "services": {"top_tracks": {"response": {"optional": False}}}}
        ],
    )
    route = respx_mock.post(
        url__regex=r".*/services/podconnect/top_tracks\?return_response.*"
    ).respond(200, json={"service_response": {"tracks": ["x"]}})
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["podconnect"]).dispatch(
            "home_call",
            {"domain": "podconnect", "service": "top_tracks"},  # NOTE: no return_response flag
        )
    assert r["ok"] is True and route.called and r["data"] == {"tracks": ["x"]}


async def test_home_call_falsy_scalar_is_real_data_not_empty(respx_mock):
    # A falsy-but-meaningful payload (0, False, "") is REAL data — must not be flagged empty.
    respx_mock.get(f"{SVC}/services").respond(200, json=[])
    respx_mock.post(url__regex=r".*/services/podconnect/count.*").respond(
        200, json={"service_response": 0}
    )
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["podconnect"]).dispatch(
            "home_call",
            {"domain": "podconnect", "service": "count", "return_response": True},
        )
    assert r["ok"] is True and r["data"] == 0 and "empty" not in r


async def test_home_call_explicit_return_response_survives_none_mode(respx_mock):
    # Catalog says the service has no response block (mode 'none'), but the model explicitly
    # asked for a response -> we must NOT silently drop it (re-triggers the 0.30 data-loss bug).
    respx_mock.get(f"{SVC}/services").respond(
        200,
        json=[{"domain": "podconnect", "services": {"history": {}}}],  # no 'response' key
    )
    route = respx_mock.post(
        url__regex=r".*/services/podconnect/history\?return_response.*"
    ).respond(200, json={"service_response": {"tracks": ["a"]}})
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["podconnect"]).dispatch(
            "home_call",
            {"domain": "podconnect", "service": "history", "return_response": True},
        )
    assert r["ok"] is True and route.called and r["data"] == {"tracks": ["a"]}


async def test_home_call_normalizes_mixed_case_domain(respx_mock):
    # A mixed-case domain guess must resolve (gate + auto-correct + URL all agree).
    respx_mock.get(f"{SVC}/services").respond(200, json=[])
    route = respx_mock.post(url__regex=r".*/services/conversation/process.*").respond(
        200, json={"service_response": {"response": {"speech": {"plain": {"speech": "hej"}}}}}
    )
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["conversation"]).dispatch(
            "home_call",
            {
                "domain": "Conversation",
                "service": "Process",
                "return_response": True,
                "data": {"text": "hej"},
            },
        )
    assert r["ok"] is True and route.called and r["summary"] == "hej"


async def test_home_call_intent_error_is_a_failure(respx_mock):
    # A conversation/intent agent that FAILED (response_type=='error') is surfaced as a
    # failure (not counted ok), but its message is kept for the model to relay.
    respx_mock.get(f"{SVC}/services").respond(200, json=[])
    respx_mock.post(url__regex=r".*/services/conversation/process.*").respond(
        200,
        json={
            "service_response": {
                "response": {
                    "response_type": "error",
                    "speech": {"plain": {"speech": "Jeg kunne ikke nå søgningen."}},
                }
            }
        },
    )
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["conversation"]).dispatch(
            "home_call",
            {
                "domain": "conversation",
                "service": "process",
                "return_response": True,
                "data": {"text": "x"},
            },
        )
    assert r["ok"] is False and r["error_kind"] == "intent_error"
    assert r["error"] == "Jeg kunne ikke nå søgningen."


async def test_home_call_account_level_allowed_via_exposed_entity(respx_mock):
    # Exposing an ENTITY of a domain enables that domain's account-level data services.
    respx_mock.get(f"{SVC}/services").respond(200, json=[])
    route = respx_mock.post(url__regex=r".*/services/podconnect/top_tracks.*").respond(
        200, json={"service_response": {"tracks": ["a"]}}
    )
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["podconnect.living_room"]).dispatch(
            "home_call",
            {"domain": "podconnect", "service": "top_tracks", "return_response": True},
        )
    assert r["ok"] is True and route.called and r["data"] == {"tracks": ["a"]}


async def test_web_search_blocked_when_conversation_not_exposed(respx_mock):
    # Same gating as everything else: not exposed -> denied, HA never hit.
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=[]).dispatch(
            "home_call",
            {"domain": "conversation", "service": "process", "return_response": True},
        )
    assert r["ok"] is False and "conversation" in r["error"]


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
    # A non-speech payload (a list/dict) passes through UNCHANGED under `data` with no
    # `summary` — the normalizer must never flatten history/track lists.
    respx_mock.get(f"{SVC}/services").respond(200, json=[])
    route = respx_mock.post(url__regex=r".*/services/podconnect/top_tracks.*").respond(
        200, json={"service_response": {"tracks": ["a", "b", "c"]}}
    )
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["podconnect"]).dispatch(
            "home_call",
            {"domain": "podconnect", "service": "top_tracks", "return_response": True},
        )
    assert r["ok"] is True and route.called
    assert r["data"] == {"tracks": ["a", "b", "c"]} and "summary" not in r


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
