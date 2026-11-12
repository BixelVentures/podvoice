"""Extend the existing inert native service with actual catalogue/content/queue contracts."""

import asyncio
import base64
import copy
import hashlib
import json
import logging
import os
import secrets
import time
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from aiohttp import web
from integration.test_podview_music_control import Rig, content_owner
from integration.test_podview_queue_occurrence import accepted, bound_source, staged
from unit.test_podview_theme_art import webp

# Reuse the existing app, authentication, playback observation and shutdown.
# Suppress only its CLI launcher: this file owns the isolated test server port.
with patch("aiohttp.web.run_app"):
    import music_e2e_server as base

from gatekeeper.podview import BRIDGE
from gatekeeper.podview_mood import THEMES
from gatekeeper.podview_theme_art import _LEGACY_STYLE, ThemeArtOwner, ThemeArtPolicy, ThemeArtStore

cold = os.environ.get("MUSIC_COLD_CONTEXT") == "1"
reject_setup = os.environ.get("MUSIC_COLD_REJECT") == "1"
repeat_mood = os.environ.get("MUSIC_REPEAT_MOOD") == "1"
voice_journey = base.voice_journey
# K2/K4: three fast skips through a queue that advances with the song, then an autoplay context.
queue_skip = os.environ.get("MUSIC_QUEUE_SKIP_TEST") == "1"
queue_journey = os.environ.get("MUSIC_QUEUE_JOURNEY") == "1" or voice_journey or queue_skip
queue_identity = os.environ.get("MUSIC_QUEUE_IDENTITY_TEST") == "1"
account_rollover = os.environ.get("MUSIC_ACCOUNT_ROLLOVER_TEST") == "1"
queue_cold_tail = os.environ.get("MUSIC_QUEUE_COLD_TAIL") == "1"
discovery_loading = os.environ.get("MUSIC_DISCOVERY_LOADING_TEST") in {"1", "revisit", "cover"}
discovery_cover = os.environ.get("MUSIC_DISCOVERY_LOADING_TEST") == "cover"
personal_playlist_cover = os.environ.get("MUSIC_PERSONAL_PLAYLIST_COVER") == "1"
library_race = os.environ.get("MUSIC_LIBRARY_BUSY_TEST")
library_race_release = asyncio.Event()
library_race_arrivals = 0
recent_session = os.environ.get("MUSIC_RECENT_SESSION_TEST") == "1"
# Green timing: the speaker confirms the start natively at 2.7 s, while the Spotify
# Web API observation (and PodConnect's playback event) only shows the new item later.
start_latency = os.environ.get("MUSIC_START_LATENCY_TEST") in {"1", "mood"}
SPEAKER_CONFIRMS_S = 2.7
SPOTIFY_OBSERVES_S = 4.5
latency_tasks: list[asyncio.Task] = []
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
    for i in (
        range(11, 23) if recent_session else range(11, 18) if discovery_loading else (11, 12, 13)
    )
]
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
if queue_skip:
    base.state.update(state="playing", song=20, queue=list(range(21, 29)))
if recent_session:
    tracks[0].update(
        name="Coming Home",
        artwork={
            "provider": "spotify",
            "kind": "album_cover",
            "url": "https://i.scdn.co/image/InertComingHome",
        },
    )
    original_recent_observation = base.observation

    def recent_observation(args):
        observed = original_recent_observation(args)
        if base.state["song"] == 11:
            observed["playback"]["item"].update(
                name=tracks[0]["name"], artwork=tracks[0]["artwork"]
            )
        return observed

    base.observation = recent_observation
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

if discovery_cover:
    base.music.tools.podview_mood_selector = SimpleNamespace(available=False)

    async def no_mood_context(_current):
        return None

    base.music.tools.podview_mood_context = no_mood_context
    directory = Path(os.environ["MUSIC_TEST_DATA"]) / "theme-art"
    policy = ThemeArtPolicy("inert-browser-cover-proof", max_images=2)
    store = ThemeArtStore(directory, policy)
    assert store.reserve("italian")
    store.publish("italian", webp())
    base.state["retiredThemeArt"] = store.url("italian")
    ledger = json.loads(store.ledger.read_bytes())
    ledger["policy_sha256"] = policy._fingerprint(_LEGACY_STYLE)
    store.ledger.write_text(json.dumps(ledger))
    store = ThemeArtStore(directory, policy)
    assert store.retired("italian")
    assert store.reserve("cooking")
    # A synthetic lossless 1024x1024 illustration with actual image data.
    # Keep the header-only helper above for the intentionally retired entry.
    cooking_image = base64.b64decode(
        "UklGRlwAAABXRUJQVlA4TFAAAAAv/8P/AA9wT9ProD+jaf7jAWTCEPqX9hNgEf2fg"
        "PI///M///M///M//8/mnv/4j//4j//4j//4j//4j//4j//4j/84j//5n//5n//5n/+ZHw=="
    )
    store.publish("cooking", cooking_image)
    if personal_playlist_cover:
        base.state["personalPlaylistCache"] = store.url("cooking")
    assert not store.reserve("calm")

    base.state["imageProviderCalls"] = []

    def image_provider(request):
        base.state["imageProviderCalls"].append(str(request.url))
        return httpx.Response(503)

    image_client = httpx.AsyncClient(transport=httpx.MockTransport(image_provider))
    base.music.tools.podview_theme_art = ThemeArtOwner(image_client, "inert-key", store)

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
    if personal_playlist_cover and service == "get_user_playlists":
        assert args == {"config_entry_id": "account", "limit": 20}
        first = {
            "uri": "spotify:playlist:" + "A" * 22,
            "name": "Personlig testplayliste A",
            "artwork": {
                "provider": "spotify",
                "kind": "playlist_cover",
                "url": "https://i.scdn.co/image/InertFailedPersonalCover",
            },
        }
        second = {
            "uri": "spotify:playlist:" + "A" * 21 + "B",
            "name": "Personlig testplayliste B",
        }
        return httpx.Response(
            200,
            json={
                "service_response": {
                    "ok": True,
                    "schema": "podconnect.user_playlists.v1",
                    "config_entry_id": "account",
                    "owner_epoch": "a" * 32,
                    "source": "spotify_web_api",
                    "coverage": "first_page",
                    "limit": 20,
                    "returned_count": 2,
                    "source_has_more": False,
                    "playlists": [first, second],
                }
            },
        )
    if (cold or discovery_cover) and service == "search_playlists":
        if library_race:
            await library_race_release.wait()
        suffix = hashlib.sha256(args["query"].encode()).hexdigest()[:22]
        playlist = {"uri": "spotify:playlist:" + suffix, "name": "Kold jazz " + suffix[:4]}
        if discovery_cover and args["query"] == THEMES["cooking"]["query"]:
            playlist["artwork"] = {
                "provider": "spotify",
                "kind": "playlist_cover",
                "url": "https://i.scdn.co/image/InertFailedMoodCover",
            }
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
                    "playlists": [playlist],
                }
            },
        )
    if cold and reject_setup and service == "get_room_content_controls":
        return httpx.Response(503, json={"error": "inert_setup_unavailable"})
    if service in {"top_tracks", "recently_played"}:
        rows = copy.deepcopy(tracks)
        if discovery_cover and service == "recently_played":
            calls = sum(row["service"] == service for row in base.state["nativeCalls"])
            rows[0]["artwork"] = {
                "provider": "spotify",
                "kind": "album_cover",
                "url": (
                    "https://i.scdn.co/image/InertRecentCover"
                    if calls == 1
                    else "https://invalid.example/not-a-cover"
                ),
            }
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
                assert uri.startswith("spotify:playlist:")
            else:
                assert uri in {row["uri"] for row in tracks}
            observation = dict(
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
            if start_latency:

                async def speaker_starts(args=args, observation=observation):
                    await asyncio.sleep(SPEAKER_CONFIRMS_S)
                    settle(args)
                    base.state["speakerConfirmedAtMs"] = time.time() * 1000
                    await asyncio.sleep(SPOTIFY_OBSERVES_S - SPEAKER_CONFIRMS_S)
                    base.state.update(observation)
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
        *({"get_user_playlists"} if personal_playlist_cover else set()),
        *({"search_playlists"} if cold or discovery_cover else set()),
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
if base.output_transfer:
    base.app[BRIDGE].controls.policy["music"][1]["actions"].append("play_queue_occurrence")
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
    if discovery_cover:
        await image_client.aclose()


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

if library_race:

    @web.middleware
    async def observe_library_race(request, handler):
        global library_race_arrivals
        if request.path == "/view/api/music" and request.query.get("kind") == "account_playlists":
            library_race_arrivals += 1
        return await handler(request)

    async def library_race_gate(request):
        if request.method == "POST":
            if library_race == "owner-change":
                base.session._epoch = getattr(base.session, "_epoch", 0) + 1
            library_race_release.set()
        calls = base.state["nativeCalls"]
        return web.json_response(
            {
                "moodReads": sum(row["service"] == "search_playlists" for row in calls),
                "libraryReads": sum(row["service"] == "get_user_playlists" for row in calls),
                "libraryArrivals": library_race_arrivals,
            }
        )

    base.app.middlewares.append(observe_library_race)
    base.app.router.add_get("/lab/library-race", library_race_gate)
    base.app.router.add_post("/lab/library-race", library_race_gate)

base.app.on_cleanup.append(cleanup)
web.run_app(
    base.app, host="127.0.0.1", port=int(os.environ.get("MUSIC_TEST_PORT", "18979")), print=None
)
