"""Actual NativeRadio HTTP owner and PodView, with inert radio/Spotify effects."""

import asyncio
import copy
import logging
import os
import time
from unittest.mock import patch

import httpx
from aiohttp import web
from integration.test_podview_radio import native_state

# Reuse the actual packaged app, ingress, stateful Spotify selection seam and
# cleanup. Only this CLI owns the server; no duplicate production application.
with patch("aiohttp.web.run_app"):
    import music_selection_e2e_server as selection

from gatekeeper.podview import BRIDGE
from gatekeeper.podview_radio import NativeRadio, validate_native

logging.getLogger("podvoice.radio").setLevel(logging.INFO)

base = selection.base
port = int(os.environ.get("RADIO_TEST_PORT", "18982"))
config_mode = os.environ.get("RADIO_CONFIG_TEST")
owner_token = os.environ.get("RADIO_FIXTURE_OWNER_TOKEN", "inert-radio-owner-token")
radio_fault = None
# Green timing: the native owner accepts at once and reports playing when audio flows.
start_latency = os.environ.get("RADIO_START_LATENCY_TEST") == "1"
RADIO_PLAYS_AFTER_S = 2.7
latency_tasks: list[asyncio.Task] = []
# Green timing: the native radio owner answers a volume command after 1.5 s.
volume_delay = os.environ.get("RADIO_VOLUME_TEST") == "1"
radio = native_state()
radio["targets"] = [
    {
        "id": "42",
        "name": "Køkkenalrum HomePod",
        "availability": "available",
        "selectable": True,
        "default": True,
    },
    {
        "id": "43",
        "name": "Soveværelse",
        "availability": "available",
        "selectable": True,
        "default": False,
    },
]
radio.update(target_id="42", state="stopped", source_kind="none")
base.state.update(radioWrites=[], radioReads=0, radioDeniedReads=0, sourceTransitions=[])


def radio_observation():
    now = time.time()
    value = copy.deepcopy(radio)
    value.update(retrieved_at=now, valid_until=now + 5, observed_at=now)
    value["actions"] = (
        ["start", "stop", "move", "volume"]
        if value["source_kind"] == "radio" and value["state"] == "playing"
        else []
        if value["state"] == "preparing"
        else ["start"]
    )
    return validate_native(value)


async def radio_read(request):
    if radio_fault == "unavailable":
        return web.Response(status=503)
    if radio_fault == "reject" or request.headers.get("X-PodConnect-Token") != owner_token:
        base.state["radioDeniedReads"] += 1
        return web.Response(status=401)
    base.state["radioReads"] += 1
    return web.json_response(radio_observation())


async def radio_action(request):
    if request.headers.get("X-PodConnect-Token") != owner_token:
        return web.Response(status=401)
    body = await request.json()
    assert set(body) == {
        "action_id",
        "action",
        "station_id",
        "target_id",
        "volume_percent",
        "expected_process_id",
        "expected_revision",
        "expected_generation",
        "expected_owner_generation",
    }
    matches = all(
        body["expected_" + field] == radio[field]
        for field in ("process_id", "revision", "generation", "owner_generation")
    )
    if not matches:
        return web.json_response(
            {
                "schema": "podconnect.radio-action.v1",
                "action_id": body["action_id"],
                "status": "rejected",
                "retry_allowed": False,
            },
            status=409,
        )
    if os.environ.get("RADIO_STATION_ORDER_TEST") == "rejected" and body["station_id"] == "p1":
        return web.json_response(
            {
                "schema": "podconnect.radio-action.v1",
                "action_id": body["action_id"],
                "status": "rejected",
                "retry_allowed": False,
            },
            status=409,
        )
    if body["action"] == "start":
        assert body["station_id"] in {row["id"] for row in radio["stations"]}
        assert body["target_id"] in {row["id"] for row in radio["targets"]}
        radio.update(
            state="preparing" if start_latency else "playing",
            source_kind="radio",
            station_id=body["station_id"],
            target_id=body["target_id"],
        )
        base.state["state"] = "paused"
        if start_latency:

            async def audio_flows():
                await asyncio.sleep(RADIO_PLAYS_AFTER_S)
                radio.update(state="playing")
                radio["generation"] += 1
                radio["revision"] += 1
                base.state["radioPlayingAtMs"] = time.time() * 1000

            latency_tasks.append(asyncio.get_running_loop().create_task(audio_flows()))
    elif body["action"] == "stop":
        assert radio["state"] == "playing" and radio["source_kind"] == "radio"
        radio.update(state="stopped", source_kind="none")
    elif body["action"] == "volume":
        assert radio["state"] == "playing" and radio["source_kind"] == "radio"
        if volume_delay:
            await asyncio.sleep(1.5)
        assert body["station_id"] is None and body["target_id"] is None
        assert type(body["volume_percent"]) is int and 0 <= body["volume_percent"] <= 100
        radio["volume_percent"] = body["volume_percent"]
    else:
        raise AssertionError("This bounded journey sends only Start, Volume and Stop")
    radio["generation"] += 1
    radio["revision"] += 1
    radio["owner_generation"] += 1
    base.state["radioWrites"].append(body)
    if body["action"] != "volume":
        base.state["sourceTransitions"].append(radio["source_kind"])
    return web.json_response(
        {
            "schema": "podconnect.radio-action.v1",
            "action_id": body["action_id"],
            "status": "accepted",
            "retry_allowed": False,
        }
    )


previous_music_client = base.music.client


async def native_music(request):
    result = await selection.native(request)
    if (
        request.url.path.endswith("start_room_selected_content")
        and result.json()["service_response"]["ok"]
    ):
        radio.update(state="playing", source_kind="spotify", volume_percent=base.state["volume"])
        radio["generation"] += 1
        radio["revision"] += 1
        radio["owner_generation"] += 1
        base.state["sourceTransitions"].append("spotify")
    return result


base.music.client = httpx.AsyncClient(transport=httpx.MockTransport(native_music))
base.music.tools._client = base.music.client
client_token = (
    ""
    if config_mode == "missing"
    else os.environ["RADIO_FIXTURE_CLIENT_TOKEN"]
    if config_mode == "mismatch"
    else owner_token
)
native_radio = NativeRadio(f"http://127.0.0.1:{port}", client_token)
base.music.tools.podview_radio_native = native_radio
base.app[BRIDGE].radio.native = native_radio
base.app.router.add_get("/api/radio/state", radio_read)
base.app.router.add_post("/api/radio/action", radio_action)


async def lab_radio(request):
    global radio_fault
    if request.method == "POST":
        radio_fault = (await request.json())["fault"]
        assert radio_fault in {"reject", "unavailable", None}
        return web.json_response({"ok": True})
    return web.json_response(radio_observation())


async def cleanup(_):
    await previous_music_client.aclose()


base.app.router.add_get("/lab/radio", lab_radio)
if config_mode == "rotate":
    base.app.router.add_post("/lab/radio", lab_radio)
base.app.on_cleanup.append(cleanup)
web.run_app(base.app, host="127.0.0.1", port=port, print=None)
