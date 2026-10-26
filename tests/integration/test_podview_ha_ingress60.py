"""Actual ingress HTTP + existing executors on inert HA/PodConnect transports.

The outer fixture middleware supplies the socket peer, never a forwarded header.
No pairing cookie, Voice PE connection, provider or household is used.
"""

import asyncio
import json
from dataclasses import replace
from types import SimpleNamespace

import httpx
import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from integration.test_cleaning_journal import bind
from integration.test_ha_timer_flow import build
from integration.test_podview_bridge import owner
from integration.test_podview_controls import (
    ACTUAL_BINDING_ID,
    action_body,
    actual_playback_response,
    setup_body,
)
from integration.test_podview_music import Rig as MusicReadRig
from integration.test_podview_music_control import Rig as MusicRig
from integration.test_podview_music_control import content_owner, room_owner
from integration.test_podview_queue_occurrence import accepted
from integration.test_podview_queue_occurrence import action as queue_action
from integration.test_podview_room_queue import SERVICES, staged
from integration.test_podview_room_queue import source as queue_source
from unit.test_device_control import ROBOT
from unit.test_device_control import Rig as RobotRig

from gatekeeper import podview as module
from gatekeeper import podview_controls as controls_module
from gatekeeper import podview_queue as queue_module
from gatekeeper.events import State
from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE
from gatekeeper.podview_queue import ACTION as QUEUE_ACTION
from gatekeeper.web import create_app

HEADERS = {"X-Remote-User-Id": "a" * 32, "X-PodView-Request": "1"}


@pytest.fixture
async def ingress(tmp_path):
    manager, _, timer_client, timer_tools, calls, _ = build()
    timers = timer_tools.timers
    assert (await timers.refresh("kitchen"))["ok"]
    robot = RobotRig()
    bind(robot, tmp_path / "cleaning.json")
    music = MusicRig()
    room_owner(music)
    original_music_client = music.client

    async def routed_music(request):
        if request.url.path.endswith("/get_playback_snapshot"):
            return actual_playback_response(request, target="device", homepod="42")
        return await music.handle(request)

    music.client = httpx.AsyncClient(transport=httpx.MockTransport(routed_music))
    music.tools._client = music.client
    music.tools._discovery = replace(
        music.tools._discovery,
        podconnect_services=music.tools._discovery.podconnect_services | {"get_playback_snapshot"},
    )
    music.tools._device_control = robot.router._device_control
    music.tools.timers = timers
    session, _ = owner()
    session.tools = music.tools
    session._active = False
    session.sm.state = State.IDLE
    configured = {
        "roomId": "kitchen",
        "music": [
            {
                "accountId": "account",
                "targetId": "device",
                "nativeRoomId": "native-room",
                "nativeHomepodId": "42",
                "actions": ["next", "play_track"],
                "maxVolume": 40,
            }
        ],
        "vacuum": [{"entityId": ROBOT, "actions": ["start"]}],
    }
    app = create_app(
        StatusHub(),
        {"kitchen": session},
        tools=music.tools,
        podview_control_policy=json.dumps(configured),
        locked=True,
    )
    peer = ["172.30.32.2"]

    @web.middleware
    async def socket_peer(request, handler):
        return await handler(request.clone(remote=peer[0]))

    app.middlewares.insert(0, socket_peer)
    async with TestClient(TestServer(app)) as client:
        yield SimpleNamespace(
            client=client,
            bridge=app[BRIDGE],
            session=session,
            peer=peer,
            manager=manager,
            timers=timers,
            timer_calls=calls,
            music=music,
            robot=robot,
        )
    await timer_client.aclose()
    await robot.client.aclose()
    await music.client.aclose()
    await original_music_client.aclose()


async def post(rig, path, body, headers=None):
    response = await rig.client.post(
        path, json=body, headers=HEADERS if headers is None else headers
    )
    assert response.headers.get("Set-Cookie") is None
    return await response.json()


async def snapshot(rig):
    response = await rig.client.get("/view/api/snapshot?room=kitchen", headers=HEADERS)
    assert response.status == 200 and response.headers.get("Set-Cookie") is None
    return await response.json()


async def music_offer(rig):
    return await post(
        rig,
        "/view/api/control/setup",
        {
            **setup_body(rig.bridge, "music"),
            "target": {
                "accountId": "account",
                "kind": "spotify_device",
                "targetId": "device",
                "expectedBindingId": ACTUAL_BINDING_ID,
            },
        },
    )


def timer_command(snap):
    return {
        "bootId": snap["bootId"],
        "roomId": "kitchen",
        "taskId": "timers:" + snap["timers"]["epoch"],
        "revision": snap["revision"],
        "requestId": "timer-start",
        "action": "timer.start",
        "args": {"seconds": 60, "name": "Prøvetimer"},
    }


async def test_normal_ha_http_starts_robot_music_and_timer_once_without_cookies(ingress):
    r = ingress
    snap = await snapshot(r)
    assert snap["admission"] == {"kind": "ha_ingress", "authenticated": True}
    assert snap["voice"]["active"] is False
    assert set(snap["capabilities"]["controlSetup"]) == {"music", "vacuum"}
    assert snap["capabilities"]["timerActions"] == ["timer.start", "timer.cancel"]
    assert not r.client.session.cookie_jar
    offer = await music_offer(r)
    assert offer["ok"], offer
    command = action_body(offer, offer["options"][0])
    result = await post(r, "/view/api/control/actions", command)
    assert result["outcome"] == "accepted" and result["physicalResultVerified"] is False
    assert await post(r, "/view/api/control/actions", command) == result
    sends = [c for c in r.music.calls if c[1].endswith("control_room_playback")]
    assert len(sends) == 1
    assert (sends[0][3]["room_id"], sends[0][3]["homepod_id"], sends[0][3]["target_id"]) == (
        "native-room",
        "42",
        "device",
    )

    offer = await post(r, "/view/api/control/setup", setup_body(r.bridge))
    assert offer["ok"], offer
    option = next(o for o in offer["options"] if o["action"] == "start")
    command = action_body(
        offer, option, {"areaIds": [option["argsSchema"]["areas"][0]["id"]], "repeat": 1}
    )
    command["requestId"] = "robot-start"
    result = await post(r, "/view/api/control/actions", command)
    assert result["outcome"] == "accepted" and result["physicalResultVerified"] is False
    assert await post(r, "/view/api/control/actions", command) == result
    assert len(r.robot.writes) == 1

    command = timer_command(await snapshot(r))
    result = await post(r, "/view/api/actions", command)
    assert result["outcome"] == "accepted" and result["physicalResultVerified"] is False
    assert await post(r, "/view/api/actions", command) == result
    assert r.manager.starts == 1
    assert not r.client.session.cookie_jar and module._HA_REQUEST.get() is None


async def test_timer_outage_keeps_ready_robot_and_selected_music_available(ingress):
    r = ingress
    old_timer_command = timer_command(await snapshot(r))
    r.timers.ready.clear()
    assert (await post(r, "/view/api/actions", old_timer_command))["error"] == "timer_unavailable"
    content_owner(r.music)
    r.music.tools._discovery = replace(
        r.music.tools._discovery,
        podconnect_services=r.music.tools._discovery.podconnect_services | {"search_tracks"},
    )
    reader = MusicReadRig()
    original = r.music.client

    async def transport(request):
        if request.url.path.endswith("/search_tracks"):
            return await reader.request(request)
        return await r.music.handle(request)

    r.music.client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    r.music.tools._client = r.music.client
    try:
        snap = await snapshot(r)
        assert snap["timers"]["status"] == "unavailable"
        assert snap["capabilities"]["timerActions"] == []
        assert set(snap["capabilities"]["controlSetup"]) == {"music", "vacuum"}
        assert snap["capabilities"]["musicSelection"] is True
        search = await (
            await r.client.get(
                "/view/api/music?kind=search&account=account&query=jazz", headers=HEADERS
            )
        ).json()
        assert search["ok"], search
        offer = await post(
            r,
            "/view/api/music/selection/setup",
            {
                "bootId": r.bridge.boot_id,
                "roomId": "kitchen",
                "candidateSetId": search["candidateSet"]["candidateSetId"],
                "target": {"accountId": "account", "kind": "spotify_device", "targetId": "device"},
            },
        )
        assert offer["ok"], offer
        command = {
            "bootId": r.bridge.boot_id,
            "roomId": "kitchen",
            "taskId": offer["taskId"],
            "revision": offer["revision"],
        }
        command.update(
            optionId=offer["options"][1]["id"],
            requestId="selected-track",
            confirmedVolumePercent=35,
        )
        result = await post(r, "/view/api/music/selection/actions", command)
        assert result["outcome"] == "accepted" and result["physicalResultVerified"] is False
        assert await post(r, "/view/api/music/selection/actions", command) == result
        sends = [c for c in r.music.calls if c[1].endswith("start_room_selected_content")]
        assert len(sends) == 1
        assert (sends[0][3]["room_id"], sends[0][3]["homepod_id"]) == ("native-room", "42")
        assert sends[0][3]["args"]["track_uri"] == "spotify:track:" + "0" * 21 + "1"
        offer = await post(r, "/view/api/control/setup", setup_body(r.bridge))
        assert offer["ok"], offer
        option = next(o for o in offer["options"] if o["action"] == "start")
        command = action_body(
            offer, option, {"areaIds": [option["argsSchema"]["areas"][0]["id"]], "repeat": 1}
        )
        assert (await post(r, "/view/api/control/actions", command))["outcome"] == "accepted"
        assert len(r.robot.writes) == 1 and r.manager.starts == 0
    finally:
        await original.aclose()
        await reader.client.aclose()


@pytest.mark.parametrize(
    "peer,headers",
    [
        ("172.30.32.2", {}),
        ("127.0.0.1", HEADERS),
        ("172.30.32.3", HEADERS),
        ("172.30.32.2", {**HEADERS, "X-Remote-User-Id": "A" * 32}),
        ("172.30.32.2", {**HEADERS, "X-Remote-User-Id": "a" * 31}),
        (
            "172.30.32.2",
            [
                ("X-Remote-User-Id", "a" * 32),
                ("X-Remote-User-Id", "a" * 32),
                ("X-PodView-Request", "1"),
            ],
        ),
        ("172.30.32.2", {**HEADERS, "Sec-Fetch-Site": "cross-site"}),
        ("172.30.32.2", {"X-Remote-User-Id": "a" * 32}),
    ],
)
async def test_http_identity_and_csrf_fail_closed(ingress, peer, headers):
    r = ingress
    r.peer[0] = peer
    response = await r.client.post(
        "/view/api/control/setup", json=setup_body(r.bridge), headers=headers
    )
    assert response.status == 403
    assert not r.robot.writes and not r.music.calls and r.manager.starts == 0


@pytest.mark.parametrize("change", ["room", "task", "actor", "owner", "native"])
async def test_music_task_actor_room_and_native_owner_fences(ingress, change):
    r = ingress
    if change == "native":
        r.music.value["native"]["homepod_id"] = "other-homepod"
        offer = await music_offer(r)
        assert not offer["ok"]
    else:
        offer = await music_offer(r)
        assert offer["ok"], offer
        command = action_body(offer, offer["options"][0])
        headers = HEADERS
        if change == "room":
            command["roomId"] = "other"
        elif change == "task":
            command["taskId"] = "other-task"
        elif change == "actor":
            headers = {**HEADERS, "X-Remote-User-Id": "b" * 32}
        elif change == "owner":
            r.music.tools._token = "replacement-server-token"
        assert not (await post(r, "/view/api/control/actions", command, headers))["ok"]
    assert not [c for c in r.music.calls if c[1].endswith("control_room_playback")]
    assert not r.robot.writes and r.manager.starts == 0


async def test_unknown_music_is_retained_across_requests_and_timer_outage_without_replay(ingress):
    r = ingress
    offer = await music_offer(r)
    command = action_body(offer, offer["options"][0])
    r.music.raw = b"not-json"
    result = await post(r, "/view/api/control/actions", command)
    assert result["outcome"] == "unknown" and result["retryAllowed"] is False
    r.music.raw = None
    r.timers.ready.clear()
    assert await post(r, "/view/api/control/actions", command) == result
    assert not (await post(r, "/view/api/control/actions", {**command, "requestId": "new"}))["ok"]
    assert not (
        await post(
            r, "/view/api/control/actions", command, {**HEADERS, "X-Remote-User-Id": "b" * 32}
        )
    )["ok"]
    sends = [c for c in r.music.calls if c[1].endswith("control_room_playback")]
    assert len(sends) == 1 and not r.robot.writes


@pytest.mark.parametrize("replacement", ["owner", "binding"])
async def test_held_timer_cannot_execute_after_owner_or_binding_replacement(ingress, replacement):
    r = ingress
    command = timer_command(await snapshot(r))
    entered, release = asyncio.Event(), asyncio.Event()
    original = r.timers.refresh

    async def held_refresh(room):
        value = await original(room)
        entered.set()
        await release.wait()
        return value

    r.timers.refresh = held_refresh
    pending = asyncio.create_task(post(r, "/view/api/actions", command))
    try:
        await asyncio.wait_for(entered.wait(), 2)
        if replacement == "owner":
            r.session.tools.timers = owner()[1]
        else:
            r.timers.bindings["kitchen"] = ("voice_pe", "another-native-device")
    finally:
        release.set()
    result = await asyncio.wait_for(pending, 2)
    assert not result["ok"] and r.manager.starts == 0
    assert not [call for call in r.timer_calls if "action" in call]
    assert not r.robot.writes and not r.music.calls


@pytest.mark.parametrize(
    "query,location", [("?room=kitchen", "./?room=kitchen"), ("?room=unknown", "./"), ("", "./")]
)
async def test_normal_ha_old_setup_bookmark_opens_main_ui(ingress, query, location):
    response = await ingress.client.get(
        "/view/setup.html" + query, headers=HEADERS, allow_redirects=False
    )
    assert response.status == 302 and response.headers["Location"] == location
    assert response.headers["Cache-Control"] == "no-store"
    assert not ingress.client.session.cookie_jar


async def test_request_authority_ends_for_inherited_task_after_http_response(ingress):
    r = ingress
    release = asyncio.Event()
    captured = []
    tasks = []

    async def read_hook():
        if captured:
            return
        scope = module._HA_REQUEST.get()
        token = next(iter(r.bridge._ha_actors))
        captured.append(scope)
        assert scope["active"] and r.bridge._grant_current("kitchen", token)

        async def inherited():
            await release.wait()
            return r.bridge._grant_current("kitchen", token)

        tasks.append(asyncio.create_task(inherited()))

    r.music.hook = read_hook
    try:
        assert (await music_offer(r))["ok"]
        assert len(captured) == 1 and captured[0]["active"] is False
        release.set()
        assert await asyncio.wait_for(tasks[0], 2) is False
        assert module._HA_REQUEST.get() is None
        assert not [c for c in r.music.calls if c[1].endswith("control_room_playback")]
    finally:
        release.set()
        await asyncio.gather(*tasks)


async def test_ha_identity_does_not_widen_configured_target_policy(ingress):
    r = ingress
    robot = {**setup_body(r.bridge), "target": {"entityId": "vacuum.ungranted"}}
    assert (await post(r, "/view/api/control/setup", robot))["error"] == "target_not_granted"
    music = {
        **setup_body(r.bridge, "music"),
        "target": {
            "accountId": "account",
            "kind": "spotify_device",
            "targetId": "ungranted",
            "expectedBindingId": ACTUAL_BINDING_ID,
        },
    }
    assert (await post(r, "/view/api/control/setup", music))["error"] == "target_not_granted"
    assert not r.robot.writes and not r.music.calls and r.manager.starts == 0


async def test_supervisor_missing_identity_cannot_downgrade_to_valid_legacy_cookie(ingress):
    r = ingress
    grant = r.bridge.grant_timer_control("kitchen")
    response = await r.client.post(
        "/view/api/control/setup",
        json=setup_body(r.bridge),
        headers={"X-PodView-Request": "1", "Cookie": f"podview_control={grant}"},
    )
    assert response.status == 403
    assert not r.robot.writes and not r.music.calls


@pytest.mark.parametrize("change", ["removed_target", "removed_action"])
async def test_prepared_target_and_action_policy_rechecked_after_native_read(ingress, change):
    r = ingress
    entered, release = asyncio.Event(), asyncio.Event()

    async def held_read():
        entered.set()
        await release.wait()

    r.music.hook = held_read
    pending = asyncio.create_task(music_offer(r))
    try:
        await asyncio.wait_for(entered.wait(), 2)
        if change == "removed_target":
            # A second ready target must not keep the removed target's authority alive.
            second = {**r.bridge.controls.policy["music"][0], "targetId": "second-device"}
            r.bridge.controls.policy["music"] = [second]
        else:
            r.bridge.controls.policy["music"][0]["actions"].remove("next")
    finally:
        release.set()
    assert not (await asyncio.wait_for(pending, 2))["ok"]
    assert not [c for c in r.music.calls if c[1].endswith("control_room_playback")]
    assert not r.robot.writes


@pytest.mark.parametrize("change", ["removed_target", "removed_action"])
async def test_prepared_action_loses_permission_before_dispatch(ingress, change):
    r = ingress
    offer = await music_offer(r)
    assert offer["ok"]
    command = action_body(offer, offer["options"][0])
    if change == "removed_target":
        second = {**r.bridge.controls.policy["music"][0], "targetId": "second-device"}
        r.bridge.controls.policy["music"] = [second]
    else:
        r.bridge.controls.policy["music"][0]["actions"].remove("next")
    result = await post(r, "/view/api/control/actions", command)
    assert not result["ok"]
    assert not [c for c in r.music.calls if c[1].endswith("control_room_playback")]
    assert not r.robot.writes


async def test_another_user_setup_preserves_task_and_unknown_receipt_without_replay(
    ingress, monkeypatch
):
    r = ingress
    other = {**HEADERS, "X-Remote-User-Id": "b" * 32}
    offer = await music_offer(r)
    assert offer["ok"]
    setup = {
        **setup_body(r.bridge, "music"),
        "target": {
            "accountId": "account",
            "kind": "spotify_device",
            "targetId": "device",
            "expectedBindingId": ACTUAL_BINDING_ID,
        },
    }
    assert (await post(r, "/view/api/control/setup", setup, other))["ok"]
    command = action_body(offer, offer["options"][0])
    r.music.raw = b"not-json"
    result = await post(r, "/view/api/control/actions", command)
    assert result["outcome"] == "unknown" and result["retryAllowed"] is False
    r.music.raw = None
    assert (await post(r, "/view/api/control/setup", setup, other))["ok"]
    assert await post(r, "/view/api/control/actions", command) == result
    controls = r.bridge.controls
    deadline = controls.tasks[offer["taskId"]]["deadline"]
    assert next(iter(controls.receipts.values()))[2] == deadline
    monkeypatch.setattr(controls_module, "time", SimpleNamespace(monotonic=lambda: deadline + 1))
    assert not (await post(r, "/view/api/control/actions", command))["ok"]
    controls._retire_receipts()
    assert not controls.receipts
    assert len([c for c in r.music.calls if c[1].endswith("control_room_playback")]) == 1


@pytest.mark.parametrize("commit_unknown", [False, True])
async def test_another_user_queue_offer_preserves_first_users_native_task(
    ingress, monkeypatch, commit_unknown
):
    r = ingress
    r.bridge.controls.policy["music"][0]["actions"].append(QUEUE_ACTION)
    r.music.tools._discovery = replace(
        r.music.tools._discovery,
        podconnect_services=r.music.tools._discovery.podconnect_services | SERVICES,
    )
    original = r.music.client
    calls = []
    queue_read_deadlines = []

    async def transport(request):
        body = json.loads(request.content)
        calls.append((request.url.path, body))
        assert request.headers["Authorization"] == "Bearer server-only"
        if request.url.path.endswith("get_playback_snapshot"):
            return actual_playback_response(request, target="device", homepod="42")
        if request.url.path.endswith("get_room_queue_controls"):
            value = queue_source()
            # Each read is fresh evidence; stable occurrence IDs still refer to
            # the same queue revision, while admission gets a new observation.
            value["queue"]["observation_id"] = f"{len(calls):032x}"
            queue_read_deadlines.append(
                queue_module.time.monotonic() + value["queue"]["expires_in_ms"] / 1000
            )
            value["config_entry_id"] = "account"
            value["target"]["target_id"] = value["native"]["target_id"] = "device"
            value["native"]["homepod_id"] = value["route"]["device_id"] = "42"
        elif request.url.path.endswith("prepare_room_queue"):
            value = staged(body)
        else:
            assert request.url.path.endswith("control_room_queue")
            if commit_unknown:
                return httpx.Response(200, content=b"not-json")
            value = accepted(body)
        return httpx.Response(200, json={"service_response": value})

    r.music.client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    r.music.tools._client = r.music.client
    try:
        body = {
            "bootId": r.bridge.boot_id,
            "roomId": "kitchen",
            "accountId": "account",
            "targetId": "device",
            "expectedBindingId": ACTUAL_BINDING_ID,
        }
        offer_a = await post(r, "/view/api/music/queue/offer", body)
        assert offer_a["ok"], offer_a
        other = {**HEADERS, "X-Remote-User-Id": "b" * 32}
        assert (await post(r, "/view/api/music/queue/offer", body, other))["ok"]
        command = queue_action(offer_a)
        assert not (await post(r, "/view/api/music/queue/actions", command, other))["ok"]
        shown = r.bridge.queue.tasks[offer_a["taskId"]]
        original_deadline = shown["deadline"]
        original_source = json.loads(json.dumps(shown["source"]))
        result = await post(r, "/view/api/music/queue/actions", command)
        assert result["outcome"] == ("unknown" if commit_unknown else "accepted")
        assert result["physicalResultVerified"] is False and result["retryAllowed"] is False
        # A later foreign offer must not erase the first user's replay memory.
        assert (await post(r, "/view/api/music/queue/offer", body, other))["ok"]
        assert await post(r, "/view/api/music/queue/actions", command) == result
        assert [path.rsplit("/", 1)[-1] for path, _ in calls] == [
            "get_playback_snapshot",
            "get_room_queue_controls",
            "get_playback_snapshot",
            "get_room_queue_controls",
            "get_playback_snapshot",
            "get_room_queue_controls",
            "prepare_room_queue",
            "control_room_queue",
            "get_playback_snapshot",
            "get_room_queue_controls",
        ]
        queue = r.bridge.queue
        # Retained presentation is unchanged; the fresh one-use admission,
        # optionally tightened by preparation, owns this receipt's custody.
        deadline = next(iter(queue.receipts.values()))[2]
        assert shown["deadline"] == original_deadline and shown["source"] == original_source
        assert shown["consumed"] and deadline <= queue_read_deadlines[2]
        monkeypatch.setattr(queue_module, "time", SimpleNamespace(monotonic=lambda: deadline + 1))
        queue.retire()
        assert not queue.receipts
        assert not (await post(r, "/view/api/music/queue/actions", command))["ok"]
        assert len([path for path, _ in calls if path.endswith("control_room_queue")]) == 1
        assert not r.robot.writes and r.manager.starts == 0
    finally:
        await original.aclose()


async def test_explicit_ha_enrollment_asset_is_html_only(ingress):
    r = ingress
    response = await r.client.get(
        "/view/setup.html?enrollment=1&room=kitchen", headers=HEADERS, allow_redirects=False
    )
    assert response.status == 200
    assert '<form id="pair-form">' in await response.text()
    assert "Set-Cookie" not in response.headers
    assert not r.client.session.cookie_jar
    assert not r.bridge._grants and not r.bridge._controller_grants
    assert not r.bridge._controller_requests
    assert not r.robot.writes and not r.music.calls and r.manager.starts == 0


@pytest.mark.parametrize(
    "query,location",
    [
        ("?enrollment=0&room=kitchen", "./?room=kitchen"),
        ("?enrollment=true&room=kitchen", "./?room=kitchen"),
        ("?enrollment=1&enrollment=1&room=kitchen", "./?room=kitchen"),
        ("?enrollment=1&room=kitchen&room=kitchen", "./?room=kitchen"),
        ("?enrollment=1&room=unknown", "./"),
        ("?enrollment=1", "./"),
        ("?enrollment=1&room=kitchen&extra=1", "./?room=kitchen"),
    ],
)
async def test_invalid_explicit_enrollment_keeps_ha_bookmark_redirect(ingress, query, location):
    response = await ingress.client.get(
        "/view/setup.html" + query, headers=HEADERS, allow_redirects=False
    )
    assert response.status == 302 and response.headers["Location"] == location
    assert "Set-Cookie" not in response.headers
    assert not ingress.bridge._grants and not ingress.bridge._controller_requests


@pytest.mark.parametrize(
    "peer,headers",
    [
        ("172.30.32.2", {}),
        ("172.30.32.2", {**HEADERS, "X-Remote-User-Id": "A" * 32}),
        ("127.0.0.1", HEADERS),
        ("172.30.32.3", HEADERS),
        ("172.30.32.2", {**HEADERS, "Sec-Fetch-Site": "cross-site"}),
        ("172.30.32.2", {**HEADERS, "Sec-Fetch-Site": "same-site"}),
    ],
)
async def test_marked_enrollment_never_bypasses_actual_ingress_guard(ingress, peer, headers):
    ingress.peer[0] = peer
    response = await ingress.client.get(
        "/view/setup.html?enrollment=1&room=kitchen", headers=headers, allow_redirects=False
    )
    assert response.status == 403
    assert "Set-Cookie" not in response.headers
    assert not ingress.bridge._grants and not ingress.bridge._controller_requests


async def test_explicit_ha_asset_then_existing_request_claim_renew_contract(tmp_path):
    from integration.test_podview_device_approval import configured

    app, bridge, timers = configured(tmp_path)

    @web.middleware
    async def ingress_peer(request, handler):
        return await handler(request.clone(remote="172.30.32.2"))

    app.middlewares.insert(0, ingress_peer)
    async with TestClient(TestServer(app)) as client:
        html = await client.get(
            "/view/setup.html?enrollment=1&room=kitchen", headers=HEADERS, allow_redirects=False
        )
        assert html.status == 200 and "Set-Cookie" not in html.headers
        assert not bridge._grants and not bridge._controller_requests
        denied = await client.post(
            "/view/api/controller/renew", json={"roomId": "kitchen"}, headers=HEADERS
        )
        assert denied.status == 403
        requested = await client.post(
            "/view/api/controller/request",
            json={"bootId": bridge.boot_id, "roomId": "kitchen", "name": "Explicit fixture"},
            headers=HEADERS,
        )
        assert requested.status == 200
        data = await requested.json()
        assert set(data) == {"ok", "requestId", "matchSignal", "expiresIn"}
        assert requested.cookies["podview_controller_request"]["httponly"]
        body = {"bootId": bridge.boot_id, "roomId": "kitchen", "requestId": data["requestId"]}
        pending = await client.post("/view/api/controller/claim", json=body, headers=HEADERS)
        assert (await pending.json())["status"] == "pending"
        assert not bridge._grants
        bridge.approve_controller_request("kitchen", data["requestId"], bridge._controller_registry)
        claimed = await client.post("/view/api/controller/claim", json=body, headers=HEADERS)
        assert await claimed.json() == {"ok": True, "status": "connected"}
        assert claimed.cookies["podview_controller"]["httponly"]
        renewed = await client.post(
            "/view/api/controller/renew", json={"roomId": "kitchen"}, headers=HEADERS
        )
        assert renewed.status == 200
        assert set(await renewed.json()) == {"ok", "expiresIn", "controllerExpiresAt"}
        assert timers.command.await_count == 0


@pytest.mark.parametrize("asset", ["%2E%2E/podview.py", "%2E%2E/%2E%2E/config.yaml"])
async def test_enrollment_marker_never_opens_outside_asset_root(ingress, asset):
    response = await ingress.client.get(
        "/view/" + asset + "?enrollment=1&room=kitchen", headers=HEADERS, allow_redirects=False
    )
    assert response.status == 404
    assert "Set-Cookie" not in response.headers
    assert not ingress.bridge._grants and not ingress.bridge._controller_requests
