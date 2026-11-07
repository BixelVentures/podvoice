"""Extend the existing inert native service with actual catalogue/content/queue contracts."""

import copy
import hashlib
import json
import logging
import os
import secrets
import time
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from aiohttp import web
from integration.test_podview_music_control import Rig, content_owner
from integration.test_podview_queue_occurrence import accepted, bound_source, staged

# Reuse the existing app, authentication, playback observation and shutdown.
# Suppress only its CLI launcher: this file owns the isolated test server port.
with patch("aiohttp.web.run_app"):
    import music_e2e_server as base

from gatekeeper.podview import BRIDGE

cold = os.environ.get("MUSIC_COLD_CONTEXT") == "1"
reject_setup = os.environ.get("MUSIC_COLD_REJECT") == "1"
repeat_mood = os.environ.get("MUSIC_REPEAT_MOOD") == "1"
logging.getLogger("podvoice.music_start").setLevel(logging.INFO)
if os.environ.get("MUSIC_PREVIEW_RENEW") == "1":
    logging.getLogger("podvoice.mood").setLevel(logging.INFO)
    logging.getLogger("podvoice.podview").setLevel(logging.INFO)

content = Rig()
content_owner(content, action="play_context" if cold else "play_track")
if cold and repeat_mood:
    content.value["actions"].append("play_track")
tracks = [
    {"name": f"Katalogsang {i}", "artist": "Inert kunstner", "uri": f"spotify:track:{i:022d}"}
    for i in (11, 12, 13)
]
base.state.update(
    state="paused", song=1, queue=[21, 22], selections=[], queueSelections=[], nativeCalls=[]
)
if cold:
    # Both existing inerts describe one native owner; alias/content incarnation
    # must agree exactly, just as the real setup route requires.
    content.value["start_offer"]["native_incarnation"] = "a" * 32
    base.state["state"] = "no_active_playback"
    original_observation = base.observation

    def cold_observation(args):
        if base.state["state"] != "no_active_playback":
            value = original_observation(args)
            value["playback"]["provider_changed_at_ms"] = base.state.get("selected_at_ms")
            return value
        raw = base.payload("playback", "account")
        raw["poll_sequence"] = base.state["sequence"]
        raw["playback"] = {"state": "no_active_playback", "target": None, "item": None}
        value = base.project_owner("playback", raw, "account")["data"]
        if args.get("include_output"):
            value.update(
                schema="podconnect.playback.v3"
                if args.get("include_controls")
                else "podconnect.playback.v2",
                output={"status": "unavailable", "reason": "route_unavailable", "binding": None},
            )
            if args.get("include_controls"):
                value["controls"] = {
                    "status": "unavailable",
                    "reason": "route_unavailable",
                    "binding_id": None,
                    "valid_until": None,
                    "supported_actions": [],
                    "volume": None,
                }
                if args.get("request_id"):
                    value["settlement"] = None
        return value

    base.observation = cold_observation
    base.music.tools.podview_mood_selector = SimpleNamespace(available=False, room_kind="kitchen")

    async def mood_context(current):
        return {"hour": 20, "roomKind": "kitchen"} if current() else None

    base.music.tools.podview_mood_context = mood_context

original_transport = base.music.client


def settle(args):
    base.receipts[args["request_id"]] = {
        "schema": "podconnect.command_settlement.v1",
        "status": "confirmed",
        "request_id": args["request_id"],
        "command_sequence": args["command_sequence"],
        "owner_epoch": args["owner_epoch"],
        "observation": {
            "source": "native_bound_state",
            "effect_revision": str(base.state["sequence"]),
            "prepare_id": "c" * 32,
        },
    }


async def native(request):
    args = json.loads(request.content)
    service = request.url.path.rsplit("/", 1)[-1]
    base.state["nativeCalls"].append({"service": service, "args": args})
    if cold and service == "get_targets" and args.get("config_entry_id"):
        response = await base.native_service(request)
        value = response.json()["service_response"]
        value["targets"] = [row for row in value["targets"] if row["kind"] != "spotify_device"]
        if base.state["state"] == "no_active_playback":
            for row in value["targets"]:
                if row["kind"] == "observed_output":
                    row["selected"] = False
        return httpx.Response(200, json={"service_response": value})
    if cold and service == "search_playlists":
        suffix = hashlib.sha256(args["query"].encode()).hexdigest()[:22]
        return httpx.Response(
            200,
            json={
                "service_response": {
                    "ok": True,
                    "schema": "podconnect.search_playlists.v1",
                    "config_entry_id": "account",
                    "owner_epoch": "a" * 32,
                    "source": "spotify_web_api",
                    "query": args["query"],
                    "limit": 3,
                    "returned_count": 1,
                    "playlists": [
                        {"uri": "spotify:playlist:" + suffix, "name": "Kold jazz " + suffix[:4]}
                    ],
                }
            },
        )
    if cold and reject_setup and service == "get_room_content_controls":
        return httpx.Response(503, json={"error": "inert_setup_unavailable"})
    if service in {"top_tracks", "recently_played"}:
        return httpx.Response(
            200,
            json={
                "service_response": {"config_entry_id": "account", "tracks": copy.deepcopy(tracks)}
            },
        )
    if service in {
        "get_room_content_controls",
        "prepare_room_selected_content",
        "start_room_selected_content",
        "cancel_room_content_preparation",
    }:
        content.value.update(
            poll_sequence=base.state["sequence"],
            next_command_sequence=base.music.value["next_command_sequence"],
        )
        content.value["observation"]["observed_at"] = base.timestamp()
        response = await content.handle(request)
        if service == "start_room_selected_content":
            context_start = args["action"] == "play_context"
            uri = args["args"]["context_uri" if context_start else "track_uri"]
            if context_start:
                assert uri.startswith("spotify:playlist:")
            else:
                assert uri in {row["uri"] for row in tracks}
            base.state.update(
                song=(
                    12
                    if repeat_mood
                    and base.state["selections"]
                    and uri != base.state["selections"][0]["uri"]
                    else 11
                )
                if context_start
                else int(uri.rsplit(":", 1)[-1]),
                state="playing",
                volume=args["start_offer"]["start_volume_percent"],
                selected_at_ms=int(time.time() * 1000),
            )
            base.state["sequence"] += 1
            base.state["selections"].append({"uri": uri, "requestId": args["request_id"]})
            base.state["writes"].append(
                {
                    "action": args["action"],
                    "uri": uri,
                    "requestId": args["request_id"],
                }
            )
            base.music.value["next_command_sequence"] += 1
            settle(args)
        return response
    if service == "get_queue":
        value = base.payload("queue", "account")
        value["currently_playing"].update(
            uri=f"spotify:track:{base.state['song']:022d}",
            name=f"Isoleret sang {base.state['song']}",
        )
        value["items"] = [
            {
                **value["currently_playing"],
                "uri": f"spotify:track:{song:022d}",
                "name": f"Køsang {song}",
                "option_id": f"queue:{song}",
            }
            for song in base.state["queue"]
        ]
        value["returned_count"] = len(value["items"])
        return httpx.Response(200, json={"service_response": value})
    if service == "get_room_queue_controls":
        value = bound_source()
        value.update(
            config_entry_id="account",
            poll_sequence=base.state["sequence"],
            next_command_sequence=base.music.value["next_command_sequence"],
            target={"kind": "spotify_device", "target_id": "device", "name": "Kitchen"},
        )
        value["queue"]["observation_id"] = secrets.token_hex(16)
        value["native"].update(target_id="device", homepod_id="42")
        value["route"]["device_id"] = "42"
        value["items"] = [
            {
                "option_id": f"{i:024x}",
                "index": index,
                "uri": f"spotify:track:{i:022d}",
                "name": f"Køsang {i}",
                "artist": "Inert kunstner",
                "artwork": None,
            }
            for index, i in enumerate(base.state["queue"])
        ]
        value["returned_count"] = len(value["items"])
        return httpx.Response(200, json={"service_response": value})
    if service == "prepare_room_queue":
        return httpx.Response(200, json={"service_response": staged(args)})
    if service == "control_room_queue":
        song = int(args["args"]["occurrence_id"], 16)
        assert song in base.state["queue"]
        index = base.state["queue"].index(song)
        base.state.update(song=song, state="playing")
        base.state["sequence"] += 1
        base.state["queueSelections"].append(
            {"index": index, "song": song, "requestId": args["request_id"]}
        )
        base.state["writes"].append(
            {"action": "play_queue_occurrence", "song": song, "requestId": args["request_id"]}
        )
        base.music.value["next_command_sequence"] += 1
        settle(args)
        return httpx.Response(200, json={"service_response": accepted(args)})
    return await base.native_service(request)


base.music.client = httpx.AsyncClient(transport=httpx.MockTransport(native))
base.music.tools._client = base.music.client
base.music.tools._discovery = replace(
    base.music.tools._discovery,
    podconnect_services=base.music.tools._discovery.podconnect_services
    | {
        "get_queue",
        "top_tracks",
        *({"search_playlists"} if cold else set()),
        "recently_played",
        "get_room_content_controls",
        "prepare_room_selected_content",
        "start_room_selected_content",
        "cancel_room_content_preparation",
        "get_room_queue_controls",
        "prepare_room_queue",
        "control_room_queue",
    },
)
base.app[BRIDGE].controls.policy["music"][0]["actions"].extend(
    (["play_context", "play_track"] if repeat_mood else ["play_context"])
    if cold
    else ["play_track", "play_queue_occurrence"]
)


async def cleanup(_):
    await original_transport.aclose()
    await content.client.aclose()


base.app.on_cleanup.append(cleanup)
web.run_app(
    base.app, host="127.0.0.1", port=int(os.environ.get("MUSIC_TEST_PORT", "18979")), print=None
)
