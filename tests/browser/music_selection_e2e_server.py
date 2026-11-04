"""Extend the existing inert native service with actual catalogue/content/queue contracts."""

import copy
import json
import os
import secrets
from dataclasses import replace
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

content = Rig()
content_owner(content)
tracks = [
    {"name": f"Katalogsang {i}", "artist": "Inert kunstner", "uri": f"spotify:track:{i:022d}"}
    for i in (11, 12, 13)
]
base.state.update(
    state="paused", song=1, queue=[21, 22], selections=[], queueSelections=[], nativeCalls=[]
)
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
            uri = args["args"]["track_uri"]
            assert uri in {row["uri"] for row in tracks}
            base.state.update(
                song=int(uri.rsplit(":", 1)[-1]),
                state="playing",
                volume=args["start_offer"]["start_volume_percent"],
            )
            base.state["sequence"] += 1
            base.state["selections"].append({"uri": uri, "requestId": args["request_id"]})
            base.state["writes"].append(
                {"action": "play_track", "uri": uri, "requestId": args["request_id"]}
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
    ["play_track", "play_queue_occurrence"]
)


async def cleanup(_):
    await original_transport.aclose()
    await content.client.aclose()


base.app.on_cleanup.append(cleanup)
web.run_app(
    base.app, host="127.0.0.1", port=int(os.environ.get("MUSIC_TEST_PORT", "18979")), print=None
)
