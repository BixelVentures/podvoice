"""Tool bridge: curated HA tools + allowlist + generic PodConnect passthrough."""

from __future__ import annotations

import json

import httpx

from gatekeeper import constants as C
from gatekeeper.ha_tools import HAToolBridge

SVC = C.SUPERVISOR_CORE_API
PC = "http://pc:8099"


def _bridge(client, exposed=(), pc=True, room_players=None):
    return HAToolBridge(
        "tok",
        client,
        podconnect_base_url=PC if pc else "",
        podconnect_token="sek",
        exposed=exposed,
        room_players=room_players,
    )


async def test_declarations_include_home_and_podconnect():
    async with httpx.AsyncClient() as client:
        names = {d["name"] for d in _bridge(client).declarations()}
    assert {
        "list_home",
        "turn_on",
        "media_control",
        "set_volume",
        "add_todo",
        "podconnect",
    } <= names


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


async def test_set_volume_scales_to_level(respx_mock):
    route = respx_mock.post(f"{SVC}/services/media_player/volume_set").respond(200, json=[])
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["media_player"]).dispatch(
            "set_volume", {"entity_id": "media_player.hp", "volume_pct": 50}
        )
    assert r["ok"] is True
    assert json.loads(route.calls.last.request.content)["volume_level"] == 0.5


async def test_list_home_filters_to_exposed(respx_mock):
    states = [
        {"entity_id": "light.kitchen", "state": "on", "attributes": {"friendly_name": "Kitchen"}},
        {"entity_id": "lock.front", "state": "locked", "attributes": {}},
    ]
    respx_mock.get(f"{SVC}/states").respond(200, json=states)
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["light"]).dispatch("list_home", {})
    assert [e["entity_id"] for e in r["entities"]] == ["light.kitchen"]  # lock not exposed


async def test_podconnect_passthrough_with_token(respx_mock):
    route = respx_mock.get(f"{PC}/api/state").respond(200, json={"playing": True})
    async with httpx.AsyncClient() as client:
        r = await _bridge(client).dispatch("podconnect", {"method": "GET", "path": "/api/state"})
    assert r["ok"] is True and r["result"] == {"playing": True}
    assert route.calls.last.request.headers["X-PodConnect-Token"] == "sek"


async def test_podconnect_play_post(respx_mock):
    route = respx_mock.post(f"{PC}/api/play").respond(200, json={"ok": True})
    async with httpx.AsyncClient() as client:
        r = await _bridge(client).dispatch(
            "podconnect", {"method": "POST", "path": "/api/play", "body": {"room": "r0"}}
        )
    assert r["ok"] is True and route.called


async def test_list_services_filters_to_allowed_domains(respx_mock):
    services = [
        {
            "domain": "vacuum",
            "services": {
                "start": {"fields": {}},
                "send_command": {"fields": {"command": {}, "params": {}}},
                "set_fan_speed": {"fields": {"fan_speed": {}}},
            },
        },
        {"domain": "lock", "services": {"lock": {"fields": {}}}},
    ]
    respx_mock.get(f"{SVC}/services").respond(200, json=services)
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["vacuum"]).dispatch("list_services", {})
    assert "vacuum" in r["services"] and "lock" not in r["services"]  # only exposed domains
    assert "fan_speed" in r["services"]["vacuum"]["set_fan_speed"]["fields"]


async def test_home_call_vacuum_allowed(respx_mock):
    route = respx_mock.post(f"{SVC}/services/vacuum/start").respond(200, json=[])
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=["vacuum"]).dispatch(
            "home_call", {"domain": "vacuum", "service": "start", "entity_id": "vacuum.roborock"}
        )
    assert r["ok"] is True and route.called


async def test_home_call_denied_when_unexposed(respx_mock):
    async with httpx.AsyncClient() as client:
        r = await _bridge(client, exposed=[]).dispatch(
            "home_call", {"domain": "vacuum", "service": "start", "entity_id": "vacuum.roborock"}
        )
    assert r["ok"] is False


async def test_play_music_searches_then_plays_best_match(respx_mock):
    search = respx_mock.post(url__regex=r".*/services/media_player/search_media.*").respond(
        200,
        json={
            "service_response": {
                "media_player.kitchen": {
                    "result": [
                        {
                            "title": "Dua Lipa",
                            "media_content_id": "spotify:artist:6M2wZ",
                            "media_content_type": "artist",
                            "can_play": True,
                        }
                    ]
                }
            }
        },
    )
    play = respx_mock.post(f"{SVC}/services/media_player/play_media").respond(200, json=[])
    async with httpx.AsyncClient() as client:
        b = _bridge(client, room_players={"kitchen": "media_player.kitchen"})
        r = await b.dispatch("play_music", {"query": "Dua Lipa", "room": "kitchen"})
    assert r["ok"] is True and search.called
    body = json.loads(play.calls.last.request.content)
    assert body["entity_id"] == "media_player.kitchen"  # one speaker, not all
    assert body["media_content_id"] == "spotify:artist:6M2wZ"  # the resolved URI, not raw text


async def test_play_music_uri_skips_search(respx_mock):
    search = respx_mock.post(url__regex=r".*/services/media_player/search_media.*")
    play = respx_mock.post(f"{SVC}/services/media_player/play_media").respond(200, json=[])
    async with httpx.AsyncClient() as client:
        b = _bridge(client, room_players={"kitchen": "media_player.kitchen"})
        r = await b.dispatch(
            "play_music", {"query": "x", "uri": "spotify:track:abc", "room": "kitchen"}
        )
    assert r["ok"] is True and not search.called  # uri -> no search step
    assert json.loads(play.calls.last.request.content)["media_content_id"] == "spotify:track:abc"


async def test_play_music_no_search_match_is_soft_error(respx_mock):
    respx_mock.post(url__regex=r".*/services/media_player/search_media.*").respond(
        200, json={"service_response": {"media_player.kitchen": {"result": []}}}
    )
    async with httpx.AsyncClient() as client:
        b = _bridge(client, room_players={"kitchen": "media_player.kitchen"})
        r = await b.dispatch("play_music", {"query": "zzzz", "room": "kitchen"})
    assert r["ok"] is False and "matched" in r["error"]


async def test_play_music_without_speaker_is_soft_error(respx_mock):
    async with httpx.AsyncClient() as client:
        r = await _bridge(client).dispatch("play_music", {"query": "Dua Lipa", "room": "nowhere"})
    assert r["ok"] is False and "speaker" in r["error"]


async def test_unknown_tool_and_ha_error_are_soft(respx_mock):
    respx_mock.post(f"{SVC}/services/homeassistant/turn_on").respond(500)
    async with httpx.AsyncClient() as client:
        b = _bridge(client, exposed=["light"])
        assert (await b.dispatch("nope", {}))["ok"] is False
        assert (await b.dispatch("turn_on", {"entity_id": "light.x"}))["ok"] is False
