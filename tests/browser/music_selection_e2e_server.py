"""Extend the existing inert native service with actual catalogue/content/queue contracts."""

import asyncio
import copy
import hashlib
import json
import logging
import os
import re
import secrets
import time
from dataclasses import replace
from unittest.mock import patch

import httpx
import music_shelves_fixture as shelves
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
voice_journey = base.voice_journey
# K2/K4: three fast skips through a queue that advances with the song, then an autoplay context.
queue_skip = os.environ.get("MUSIC_QUEUE_SKIP_TEST") == "1"
queue_journey = os.environ.get("MUSIC_QUEUE_JOURNEY") == "1" or voice_journey or queue_skip
queue_identity = os.environ.get("MUSIC_QUEUE_IDENTITY_TEST") == "1"
account_rollover = os.environ.get("MUSIC_ACCOUNT_ROLLOVER_TEST") == "1"
queue_cold_tail = os.environ.get("MUSIC_QUEUE_COLD_TAIL") == "1"
recent_session = os.environ.get("MUSIC_RECENT_SESSION_TEST") == "1"
# Green timing: the speaker confirms the start natively at 2.7 s, while the Spotify
# Web API observation (and PodConnect's playback event) only shows the new item later.
start_latency = os.environ.get("MUSIC_START_LATENCY_TEST") in {"1", "mood"}
SPEAKER_CONFIRMS_S = 2.7
SPOTIFY_OBSERVES_S = 4.5
latency_tasks: list[asyncio.Task] = []
logging.getLogger("podvoice.music_start").setLevel(logging.INFO)

# Find musik starts the tapped tile's context (play_context); voice starts a song (play_track).
content = Rig()
content_owner(content, action="play_context")
if not cold:
    content.value["actions"].append("play_track")
# The voice journey's song source (recently_played / top_tracks); Find musik shows shelves only.
tracks = [
    {"name": f"Katalogsang {i}", "artist": "Inert kunstner", "uri": f"spotify:track:{i:022d}"}
    for i in (11, 12, 13)
]
# Each started context plays one inert song: the first distinct context song 11, the next 12, ...
CONTEXT = re.compile(r"^spotify:(playlist|album|artist|show):[A-Za-z0-9]{22}$")
context_songs: dict[str, int] = {}
# Find musik's library and AI shelves (tests/music_shelves_fixture.py): inert PodConnect replies.
SHELF_SERVICES = shelves.NEW_SERVICES | {"get_user_playlists", "search_playlists"}
base.state.update(
    state="playing" if base.output_transfer else "paused",
    song=1,
    queue=[21, 22, 23, 24] if queue_journey or base.output_transfer else [21, 22],
    selections=[],
    queueSelections=[],
    nativeCalls=[],
)
if account_rollover:
    base.state.update(state="playing", song=30, queue=[31, 32])
    # Two accounts in one room: each PodConnect account has its own room player.
    base.ROOM_PLAYERS["media_player.kokkenalrum_b"] = ("account-b", "native-room")
    base.SONG_OVERRIDES["media_player.kokkenalrum"] = 10
if queue_skip:
    base.state.update(state="playing", song=20, queue=list(range(21, 29)))
if recent_session:
    # The first started context's song has a room-player cover (HA's proxy image through PodVoice).
    base.TRACK_COVERS.add(11)
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

# PodVoice's AI shelves (badge and reason) from an inert selector that never calls a provider.
shelf_selector = shelves.FakeShelfSelector()
base.music.tools.podview_mood_selector = shelf_selector
base.state["failNextSetups"] = 0

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
    if request.url.path == "/core/api/template" or request.url.path.startswith(
        (
            "/core/api/states/media_player.",
            "/core/api/services/media_player/",
            "/core/api/media_player_proxy/",
        )
    ):
        return await base.room_player_service(request)
    args = json.loads(request.content)
    service = request.url.path.rsplit("/", 1)[-1]
    base.state["nativeCalls"].append({"service": service, "args": args})
    if account_rollover and service == "get_targets" and not args.get("config_entry_id"):
        return httpx.Response(
            200,
            json={
                "service_response": {
                    "accounts": [
                        {"config_entry_id": "account", "title": "Testkonto A"},
                        {"config_entry_id": "account-b", "title": "Testkonto B"},
                    ]
                }
            },
        )
    if account_rollover and service == "get_playback_snapshot":
        account = args["config_entry_id"]
        value = base.observation(args)
        if account == "account-b":
            value.update(config_entry_id=account, owner_epoch="b" * 32)
        else:
            assert account == "account"
            value["playback"]["item"].update(
                uri=f"spotify:track:{10:022d}", name="Isoleret sang 10"
            )
        return httpx.Response(200, json={"service_response": value})
    if (cold or recent_session) and service == "get_targets" and args.get("config_entry_id"):
        response = await base.native_service(request)
        value = response.json()["service_response"]
        if cold:
            value["targets"] = [row for row in value["targets"] if row["kind"] != "spotify_device"]
            if base.state["state"] == "no_active_playback":
                for row in value["targets"]:
                    if row["kind"] == "observed_output":
                        row["selected"] = False
        else:
            for row in value["targets"]:
                if row["kind"] == "spotify_device" and row["target_id"] == "device":
                    row["name"] = "Køkkenalrum HomePod"
        return httpx.Response(200, json={"service_response": value})
    if service in SHELF_SERVICES:
        return httpx.Response(200, json={"service_response": shelves.reply(service, args)})
    if service == "get_room_content_controls" and (
        (cold and reject_setup) or base.state["failNextSetups"] > 0
    ):
        # The room's speaker cannot be used for this start (one-shot when set by a journey).
        base.state["failNextSetups"] = max(0, base.state["failNextSetups"] - 1)
        return httpx.Response(503, json={"error": "inert_setup_unavailable"})
    if service in {"top_tracks", "recently_played"}:
        rows = copy.deepcopy(tracks)
        return httpx.Response(
            200,
            json={"service_response": {"config_entry_id": "account", "tracks": rows}},
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
                assert CONTEXT.match(uri), uri
            else:
                assert uri in {row["uri"] for row in tracks}
            observation = dict(
                song=context_songs.setdefault(uri, 11 + len(context_songs))
                if context_start
                else int(uri.rsplit(":", 1)[-1]),
                state="playing",
                volume=args["start_offer"]["start_volume_percent"],
                selected_at_ms=int(time.time() * 1000),
            )
            if start_latency:

                async def speaker_starts(args=args, observation=observation):
                    await asyncio.sleep(SPEAKER_CONFIRMS_S)
                    settle(args)
                    base.state["speakerConfirmedAtMs"] = time.time() * 1000
                    # The room player shows the HomePod's new output at the native confirmation.
                    base.state["roomView"] = {"song": observation["song"], "state": "playing"}
                    await base.emit_room_changed()
                    await asyncio.sleep(SPOTIFY_OBSERVES_S - SPEAKER_CONFIRMS_S)
                    base.state.update(observation)
                    base.state.pop("roomView", None)
                    base.state["sequence"] += 1
                    await base.emit_playback_changed()

                # Like PodConnect's settlement(): unknown until the native witness confirms.
                settle(args)
                base.receipts[args["request_id"]].update(status="unknown", observation=None)
                base.state["startAcceptedAtMs"] = time.time() * 1000
                latency_tasks.append(asyncio.get_running_loop().create_task(speaker_starts()))
            elif voice_journey:
                base.state["pendingVoiceObservation"] = observation
                base.state["pendingVoiceReceipt"] = args
                receipt = response.json()
                receipt["service_response"]["start_operation_id"] = args["start_offer"]["offer_id"]
                response = httpx.Response(response.status_code, json=receipt)
            else:
                base.state.update(observation)
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
            if not voice_journey and not start_latency:
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
        if queue_journey and base.state.get("queueReadFailure") is True:
            return httpx.Response(503, json={"error": "inert_queue_unavailable"})
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
        if voice_journey:
            value["native"] = copy.deepcopy(base.music.value["native"])
            value["route"] = copy.deepcopy(base.music.value["route"])
            value["queue"]["session_id"] = value["native"]["session_id"]
        if base.output_transfer:
            assert (args["room_id"], args["homepod_id"]) == (
                base.state["room"],
                base.state["homepod"],
            )
            value["native"].update(room_id=base.state["room"], homepod_id=base.state["homepod"])
            value["route"]["device_id"] = base.state["homepod"]
        if queue_identity and base.state["room"] == "bedroom":
            value["native"]["session_id"] = value["queue"]["session_id"] = "bedroom-session"
            value["route"]["session_epoch"] = "2"
        queue = base.state["queue"]
        if queue_skip:
            queue = [song for song in queue if song > base.state["song"]]
        if account_rollover:
            account = args["config_entry_id"]
            assert account in {"account", "account-b"}
            if account == "account-b":
                value.update(config_entry_id=account, owner_epoch="b" * 32)
                value["native"].update(account_user_id="native-account-b", session_id="session-b")
                value["queue"]["session_id"] = "session-b"
            else:
                queue = [11, 12]
        value["items"] = [
            {
                "option_id": f"{i:024x}",
                "index": index,
                "uri": f"spotify:track:{(22 if (queue_identity or voice_journey) and i == 21 else i):022d}",
                "name": f"Køsang {22 if (queue_identity or voice_journey) and i == 21 else i}",
                "artist": "Inert kunstner",
                "artwork": None,
                **(
                    {"name": "Nummer i køen", "artist": "", "metadata_known": False}
                    if queue_cold_tail and i == 25 and base.state["song"] == 22
                    else {}
                ),
            }
            for index, i in enumerate(queue)
        ]
        value["returned_count"] = len(value["items"])
        return httpx.Response(200, json={"service_response": value})
    if service == "prepare_room_queue":
        if voice_journey:
            assert args["native"] == base.music.value["native"]
            assert args["route"] == base.music.value["route"]
        return httpx.Response(200, json={"service_response": staged(args)})
    if service == "control_room_queue":
        if voice_journey:
            assert args["native"] == base.music.value["native"]
            assert args["route"] == base.music.value["route"]
        scope = {}
        if base.output_transfer:
            scope = {"room": args["room_id"], "homepod": args["homepod_id"]}
            assert scope == {"room": base.state["room"], "homepod": base.state["homepod"]}
        song = int(args["args"]["occurrence_id"], 16)
        assert song in base.state["queue"]
        index = base.state["queue"].index(song)
        base.state.update(song=song, state="playing")
        if queue_identity:
            base.state["queueEffectAtMs"] = time.time_ns() / 1_000_000
        if voice_journey:
            base.music.value["route"].update(route_revision="4", input_item_id="7")
        if queue_journey or base.output_transfer or account_rollover:
            base.state["queue"] = base.state["queue"][index + 1 :]
            if queue_cold_tail and song == 22:
                base.state["queue"].append(25)
        base.state["sequence"] += 1
        base.state["queueSelections"].append(
            {"index": index, "song": song, "requestId": args["request_id"]}
        )
        base.state["writes"].append(
            {
                "action": "play_queue_occurrence",
                "song": song,
                "requestId": args["request_id"],
                **scope,
            }
        )
        base.music.value["next_command_sequence"] += 1
        settle(args)
        return httpx.Response(200, json={"service_response": accepted(args)})
    if voice_journey and service == "control_room_playback":
        assert args["native"] == base.music.value["native"]
        assert args["route"] == base.music.value["route"]
    return await base.native_service(request)


base.music.client = httpx.AsyncClient(transport=httpx.MockTransport(native))
base.music.tools._client = base.music.client
base.music.tools._discovery = replace(
    base.music.tools._discovery,
    podconnect_services=base.music.tools._discovery.podconnect_services
    | {
        "get_queue",
        "top_tracks",
        *SHELF_SERVICES,
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
    ["play_context"] if cold else ["play_context", "play_track", "play_queue_occurrence"]
)
if base.output_transfer:
    base.app[BRIDGE].controls.policy["music"][1]["actions"].append("play_queue_occurrence")
if os.environ.get("MUSIC_START_ANY_SPEAKER") == "1":
    # The other room's speaker may also start music (as Frida's on Green), so a start can target it.
    policy = base.app[BRIDGE].controls.policy["music"]
    for rule in policy[:2]:
        wanted = [*policy[0]["actions"], "play_track", "play_context"]
        rule["actions"].extend(a for a in dict.fromkeys(wanted) if a not in rule["actions"])
if account_rollover:
    rule = copy.deepcopy(base.app[BRIDGE].controls.policy["music"][0])
    rule.update(accountId="account-b", default=False)
    base.app[BRIDGE].controls.policy["music"].append(rule)


if voice_journey:
    from integration.test_thin_live import approve_proposal, emit, fresh_confirmation_input, until
    from unit.test_openai_live import call, created, terminal

    from gatekeeper.live_prompt import live_instructions
    from gatekeeper.prompt import SYSTEM_PROMPT_DA

    voice = base.session
    sdk = base.voice_sdk
    voice.live_brain.instructions, voice.live_brain.backend_instructions = live_instructions(
        SYSTEM_PROMPT_DA
    )
    base.music.value["native"]["alias_incarnation"] = "a" * 32
    base.music.value["route"]["input_path_digest"] = "c" * 64
    original_voice_observation = base.observation

    def voice_observation(args):
        result = original_voice_observation(args)
        output = result.get("output", {}).get("binding")
        if output:
            fields = ("config_entry_id", "owner_epoch", "native", "route")
            material = [base.music.value[field] for field in fields]
            binding = hashlib.sha256(
                json.dumps(
                    material, sort_keys=True, separators=(",", ":"), allow_nan=False
                ).encode()
            ).hexdigest()
            output["binding_id"] = binding
            if "controls" in result:
                result["controls"]["binding_id"] = binding
        return result

    base.observation = voice_observation

    async def voice_tool(name, arguments):
        previous = sdk.response.item.create.await_count
        response_id = f"voice-journey-{previous}"
        await emit(
            sdk,
            created(response_id),
            call(response_id, name, json.dumps(arguments)),
            terminal(response_id),
        )
        await until(lambda: sdk.response.item.create.await_count > previous)
        return json.loads(sdk.response.item.create.await_args.kwargs["item"]["output"])

    async def voice_journey_step(request):
        step = (await request.json()).get("step")
        if step == "wake":
            await voice.start()
            await voice.wake()
            return web.json_response({"active": voice._active})
        if step == "choose":
            offered = await voice_tool("podview_music_options", {})
            assert offered["ok"], offered
            options = offered["data"]
            choice = await voice_tool(
                "podview_music_select_option",
                {
                    "taskId": options["taskId"],
                    "revision": options["revision"],
                    "optionId": options["options"][0]["id"],
                    "confirmedVolumePercent": options["startVolumePercent"],
                },
            )
            assert choice["needs_confirmation"], choice
            await until(lambda: voice._live_confirmation is not None)
            proposal = voice._live_confirmation
            await emit(
                sdk, created("voice-confirmation-prompt"), terminal("voice-confirmation-prompt")
            )
            await until(lambda: voice._live_confirmation_generation == 2)
            await fresh_confirmation_input(voice, sdk)
            before = sdk.response.item.create.await_count
            await approve_proposal(sdk, proposal)
            await until(lambda: sdk.response.item.create.await_count > before)
            result = json.loads(sdk.response.item.create.await_args.kwargs["item"]["output"])
            assert result["ok"] and result["data"]["outcome"] == "accepted", result
            return web.json_response({"accepted": True, "nativeStart": base.state["selections"][0]})
        if step == "observe":
            base.state.update(base.state.pop("pendingVoiceObservation"))
            base.state["sequence"] += 1
            base.music.value["native"]["session_id"] = "voice-native-session"
            base.state["observedNativeSession"] = base.music.value["native"]["session_id"]
            settle(base.state.pop("pendingVoiceReceipt"))
            await base.emit_playback_changed()
            return web.json_response({"session": base.state["observedNativeSession"]})
        raise web.HTTPBadRequest()

    base.app.router.add_post("/lab/voice-journey", voice_journey_step)


async def cleanup(_):
    if voice_journey:
        await base.session.aclose()
    await original_transport.aclose()
    await content.client.aclose()


if queue_journey:

    async def queue_state(request):
        condition = (await request.json()).get("condition")
        if queue_identity and condition in {
            "replace-session",
            "autoplay-no-queue",
            "autoplay-with-queue",
        }:
            if condition == "replace-session":
                base.state.update(room="bedroom", homepod="43", song=30, queue=[31, 32])
            elif condition == "autoplay-no-queue":
                base.state.update(song=32, queue=[])
            else:
                base.state.update(song=33, queue=[34, 35])
            base.state["queueReadFailure"] = condition == "autoplay-no-queue"
            base.state["sequence"] += 1
            await base.emit_playback_changed()
            return web.json_response({"condition": condition})
        if queue_skip and condition == "autoplay":
            # A new autoplay context: its queue is not readable for 2 s, then the source delivers it.
            base.state.update(song=40, state="playing", queue=[41, 42, 43], queueReadFailure=True)
            base.state["sequence"] += 1
            await base.emit_playback_changed()

            async def deliver():
                await asyncio.sleep(2)
                base.state["queueReadFailure"] = False
                base.state["sequence"] += 1
                await base.emit_playback_changed()

            latency_tasks.append(asyncio.get_running_loop().create_task(deliver()))
            return web.json_response({"condition": condition})
        if condition not in {"failed", "empty"}:
            raise web.HTTPBadRequest()
        base.state["queueReadFailure"] = condition == "failed"
        if condition == "empty":
            base.state["queue"] = []
        return web.json_response({"condition": condition})

    base.app.router.add_post("/lab/queue", queue_state)


async def find_musik_lab(request):
    """Find musik's journey switches: the next N setups find the room's speaker unusable."""
    if request.method == "POST":
        args = await request.json()
        base.state["failNextSetups"] = int(args.get("failNextSetups", 0))
    return web.json_response(
        {"failNextSetups": base.state["failNextSetups"], "contextSongs": context_songs}
    )


base.app.router.add_get("/lab/find-musik", find_musik_lab)
base.app.router.add_post("/lab/find-musik", find_musik_lab)
base.app.on_cleanup.append(cleanup)
web.run_app(
    base.app, host="127.0.0.1", port=int(os.environ.get("MUSIC_TEST_PORT", "18979")), print=None
)
