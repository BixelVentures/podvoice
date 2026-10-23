"""Real ingress route and owner-bound bridge regressions; no physical claims."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from aiohttp.test_utils import TestClient, TestServer

from gatekeeper.events import State
from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE, PodViewBridge, _trusted
from gatekeeper.podview_enrichment import VisualSelector
from gatekeeper.web import create_app


def owner():
    timers = SimpleNamespace(
        available=lambda room: True,
        snapshots={
            "kitchen": {
                "epoch": "a" * 32,
                "timers": [{"id": "t1", "name": "Pasta", "seconds_left": 60, "state": "active"}],
                "finished": [],
            }
        },
        bindings={"kitchen": ("voice_pe", "device-a")},
        command=AsyncMock(
            return_value={"ok": True, "id": "created-timer", "secret": "never forward"}
        ),
    )

    async def dispatch(name, args, room, session_id, request_id, execution_guard=None):
        if execution_guard is not None and not execution_guard():
            return {"ok": False}
        return await timers.command(room, **args)

    timers.dispatch = AsyncMock(side_effect=dispatch)
    session = SimpleNamespace(
        _active=True,
        _history_session="s1",
        _external_turn_id=lambda: "s1:1",
        sm=SimpleNamespace(state=State.LISTENING),
        tools=SimpleNamespace(timers=timers),
        brain=SimpleNamespace(api_key="SECRET"),
    )
    return session, timers


def envelope(bridge):
    snap = bridge.snapshot("kitchen")
    return {
        "bootId": snap["bootId"],
        "roomId": "kitchen",
        "taskId": "timers:" + "a" * 32,
        "revision": snap["revision"],
        "requestId": "request-1",
        "action": "timer.start",
        "args": {"seconds": 300, "name": "Pasta"},
    }


async def test_real_app_snapshot_events_and_csrf_default_fail_closed():
    session, timers = owner()
    app = create_app(StatusHub(), {"kitchen": session}, locked=True)
    async with TestClient(TestServer(app)) as client:
        r = await client.get("/view/api/snapshot")
        data = await r.json()
        assert data["voice"] == {
            "phase": "LISTENING",
            "sessionId": "s1",
            "turnId": "s1:1",
            "active": True,
        }
        assert data["timers"]["items"][0]["secondsLeft"] == 60
        assert data["capabilities"]["timerActions"] == []
        assert "SECRET" not in json.dumps(data)
        assert (await client.get("/view/api/snapshot?room=other")).status == 409
        assert (
            await client.get("/view/api/snapshot", headers={"Sec-Fetch-Site": "cross-site"})
        ).status == 403
        body = envelope(app[BRIDGE])
        assert (await client.post("/view/api/actions", json=body)).status == 403
        response = await client.post(
            "/view/api/actions", json=body, headers={"X-PodView-Request": "1"}
        )
        assert (await response.json())["error"] == "control_not_paired"
        assert not timers.command.await_count
        stream = await client.get("/view/api/events")
        assert (await stream.content.readline()).strip() == b"event: snapshot"
        assert (await stream.content.readline()).startswith(b"id: ")
        event = json.loads((await stream.content.readline()).decode().removeprefix("data: "))
        assert event["bootId"] == data["bootId"]
        stream.close()


def test_strict_source_and_freshness_does_not_infer_expiry():
    assert _trusted("172.30.32.2") and _trusted("127.0.0.1")
    assert not _trusted("172.30.32.3") and not _trusted("192.168.1.20") and not _trusted(None)
    session, timers = owner()
    bridge = PodViewBridge({"kitchen": session})
    first = bridge.snapshot("kitchen")
    timers.available = lambda room: False
    second = bridge.snapshot("kitchen")
    assert second["timers"]["items"] == [] and second["timers"]["status"] == "unavailable"
    assert second["revision"] > first["revision"]
    session._active = False
    assert bridge.snapshot("kitchen")["voice"]["sessionId"] is None


async def test_exact_pairing_revision_and_duplicate_requests_run_at_most_once():
    session, timers = owner()
    bridge = PodViewBridge({"kitchen": session})
    token = bridge.grant_timer_control("kitchen")
    body = envelope(bridge)
    assert (await bridge.action({**body, "revision": 0}, token))["error"] == "stale_action"
    assert (await bridge.action(body, "wrong"))["error"] == "control_not_paired"
    first, duplicate = await asyncio.gather(bridge.action(body, token), bridge.action(body, token))
    assert first == duplicate and first["outcome"] == "accepted"
    assert first["timerId"] == "created-timer"
    assert timers.command.await_count == 1 and not first["physicalResultVerified"]
    assert (await bridge.action({**body, "args": {"seconds": 600}}, token))[
        "error"
    ] == "request_reused"
    bridge.revoke("kitchen")
    assert (await bridge.action(body, token))["error"] == "control_not_paired"


async def test_unknown_outcome_is_fenced_and_never_retried():
    session, timers = owner()
    timers.command.side_effect = TimeoutError()
    bridge = PodViewBridge({"kitchen": session})
    token = bridge.grant_timer_control("kitchen")
    body = envelope(bridge)
    result = await bridge.action(body, token)
    assert result["outcome"] == "unknown" and result["retryAllowed"] is False
    assert await bridge.action(body, token) == result
    assert timers.command.await_count == 1


async def test_music_facade_is_bounded_cached_and_error_details_redacted():
    session, _ = owner()
    tools = SimpleNamespace(
        declarations=lambda: [{"name": "podconnect_liked"}],
        podview_music_reads=lambda: ["liked"],
        podview_music_binding=lambda: (),
        podview_read=AsyncMock(return_value={"ok": False, "error": "Bearer SECRET"}),
    )
    app = create_app(StatusHub(), {"kitchen": session}, tools=tools)
    async with TestClient(TestServer(app)) as client:
        for _ in range(3):
            r = await client.get("/view/api/music?kind=liked")
            assert "SECRET" not in await r.text()
        assert tools.podview_read.await_count == 1
        assert (await client.get("/view/api/music?kind=move")).status == 400
        assert app[BRIDGE].snapshot("kitchen")["capabilities"]["musicRead"] == ["liked"]


async def test_selector_copies_only_source_facts_and_rejects_invented_ids():
    content = {
        "summary": "Svar",
        "facts": [
            {"id": "f1", "label": "Tid", "value": "12", "detail": "minutter", "sourceId": "s1"}
        ],
        "sources": [
            {
                "id": "s1",
                "label": "HA",
                "kind": "owner_receipt",
                "receiptId": "a" * 32,
                "scope": "tool_result",
            }
        ],
    }
    selected = {"show": True, "fact_ids": ["f1"]}

    def respond(request):
        assert request.url.path == "/v1/responses"
        body = json.loads(request.content)
        assert body["store"] is False and body["text"]["format"]["strict"] is True
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": json.dumps(selected)}],
                    }
                ],
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        from gatekeeper.podview_enrichment import MODEL, RequestAllowance
        from gatekeeper.provider_budget import ProviderBudgetCoordinator

        selector = VisualSelector(
            client,
            "secret",
            MODEL,
            allowance=RequestAllowance(2),
            budget=ProviderBudgetCoordinator(),
        )
        result = await selector.select(content, current=lambda: True)
        assert result["content"] == content
        selected["fact_ids"] = ["invented"]
        assert await selector.select(content, current=lambda: True) is None


async def test_replaced_owner_epoch_binding_expiry_and_bad_ids_reject(monkeypatch):
    session, timers = owner()
    bridge = PodViewBridge({"kitchen": session})
    token = bridge.grant_timer_control("kitchen")
    body = envelope(bridge)
    malformed = {**body, "action": "timer.cancel", "args": {"timer_id": []}}
    assert (await bridge.action(malformed, token))["error"] == "unsupported_action"
    timers.bindings["kitchen"] = ("voice_pe", "device-b")
    assert (await bridge.action(body, token))["error"] == "control_not_paired"
    timers.bindings["kitchen"] = ("voice_pe", "device-a")
    timers.snapshots["kitchen"]["epoch"] = "b" * 32
    assert (await bridge.action(body, token))["error"] == "control_not_paired"
    timers.snapshots["kitchen"]["epoch"] = "a" * 32
    bridge.sessions["kitchen"] = owner()[0]
    assert (await bridge.action(body, token))["error"] == "control_not_paired"
    bridge.sessions["kitchen"] = session
    monkeypatch.setattr("gatekeeper.podview.time.monotonic", lambda: float("inf"))
    assert (await bridge.action(body, token))["error"] == "control_not_paired"
    assert timers.command.await_count == 0


def test_music_projection_never_copies_extra_provider_fields():
    from gatekeeper.podview import _music_public

    raw = {
        "ok": True,
        "access_token": "secret",
        "data": {
            "authorization": "secret",
            "config_entry_id": "account-1",
            "tracks": [
                {
                    "name": "Song",
                    "artist": "Band",
                    "uri": "spotify:track:id",
                    "artwork": {
                        "kind": "album_cover",
                        "provider": "spotify",
                        "url": "https://i.scdn.co/image/ab67616d0000b2730123456789abcdef",
                    },
                    "access_token": "secret",
                }
            ],
        },
        "selection": {
            "requested_limit": 1,
            "source_sample_count": 1,
            "returned_count": 1,
            "more_in_sample": False,
            "size_limited": False,
            "coverage": "untrusted source text",
        },
    }
    public = _music_public("recent", raw)
    assert public["data"]["tracks"] == [
        {
            "name": "Song",
            "artist": "Band",
            "uri": "spotify:track:id",
            "artwork": {
                "kind": "album_cover",
                "provider": "spotify",
                "url": "https://i.scdn.co/image/ab67616d0000b2730123456789abcdef",
            },
        }
    ]
    assert public["selection"]["coverage"].startswith("Source sample only")
    assert public["data"]["config_entry_id"] == "account-1"
    assert not _music_public("recent", raw, "account-other")["ok"]
    assert "secret" not in json.dumps(public)
    targets = _music_public(
        "targets",
        {
            "ok": True,
            "data": {
                "config_entry_id": "account-1",
                "targets": [
                    {
                        "kind": "configured_alias",
                        "target_id": "room-a",
                        "name": "Stuen",
                        "binding": {"registry": "secret"},
                    }
                ],
            },
        },
    )
    assert targets["data"]["targets"][0]["targetId"] == "room-a"
    assert "secret" not in json.dumps(targets)


async def test_screen_reads_do_not_refresh_shared_discovery():
    from gatekeeper.tools import ToolRouter

    router = ToolRouter.__new__(ToolRouter)
    router._token = "server-only"
    discovery = SimpleNamespace(podconnect_services={"get_targets", "recently_played"})
    router._discovery = discovery
    router._refresh_podconnect_services = AsyncMock(
        side_effect=AssertionError("must not rediscover")
    )
    router.declarations = lambda: [{"name": "podconnect_get_targets"}]

    def handler(request):
        assert request.method == "POST"
        if "get_targets" in request.url.path:
            return httpx.Response(
                200,
                json={
                    "service_response": {"accounts": [{"config_entry_id": "a1", "title": "Music"}]}
                },
            )
        return httpx.Response(
            200,
            json={
                "service_response": {
                    "config_entry_id": "a1",
                    "tracks": [{"name": "Song", "artist": "Band", "uri": "spotify:track:1"}],
                }
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        router._client = client
        assert (await router.podview_read("targets"))["ok"]
        assert (await router.podview_read("recent"))["ok"]
    assert router._discovery is discovery
    assert router._refresh_podconnect_services.await_count == 0


async def test_actual_thin_projection_does_not_create_or_close_session():
    from test_thin_live_idle import setup

    session, _, link = await setup(output=False)
    try:
        before = (session._history_session, session._active, session._epoch, link.rearm_calls)
        bridge = PodViewBridge({session.room: session})
        for _ in range(3):
            data = bridge.snapshot(session.room)
            assert data["voice"]["sessionId"] == session._history_session
        assert (
            session._history_session,
            session._active,
            session._epoch,
            link.rearm_calls,
        ) == before
    finally:
        await session.aclose()


async def test_admin_pairing_cookie_authority_and_single_use_across_restart(tmp_path):
    import hashlib

    code = "x" * 43
    digest = hashlib.sha256(code.encode()).hexdigest()
    session, timers = owner()
    options = dict(
        podview_pairing_room="kitchen",
        podview_pairing_sha256=digest,
        podview_pairing_store=tmp_path / "used",
    )
    app = create_app(StatusHub(), {"kitchen": session}, locked=True, **options)
    headers = {"X-PodView-Request": "1"}
    async with TestClient(TestServer(app)) as client:
        assert (
            await client.post("/view/api/pair", json={"roomId": "kitchen", "code": code})
        ).status == 403
        assert (
            await client.post(
                "/view/api/pair",
                json={"roomId": "kitchen", "code": code},
                headers={**headers, "Sec-Fetch-Site": "cross-site"},
            )
        ).status == 403
        for body in ({"roomId": "other", "code": code}, {"roomId": "kitchen", "code": "y" * 43}):
            assert (await client.post("/view/api/pair", json=body, headers=headers)).status == 403
        before = await (await client.get("/view/api/snapshot")).json()
        response = await client.post(
            "/view/api/pair", json={"roomId": "kitchen", "code": code}, headers=headers
        )
        assert response.status == 200
        assert await response.json() == {"ok": True, "paired": True, "expiresIn": 300}
        cookie = response.headers["Set-Cookie"]
        assert "HttpOnly" in cookie and "SameSite=Strict" in cookie and "Path=/view/" in cookie
        assert code not in cookie and digest not in cookie
        paired = await (await client.get("/view/api/snapshot")).json()
        assert paired["capabilities"]["timerActions"] == ["timer.start", "timer.cancel"]
        assert paired["revision"] == before["revision"]
        body = envelope(app[BRIDGE])
        action = await client.post("/view/api/actions", json=body, headers=headers)
        assert (await action.json())["outcome"] == "accepted"
        assert timers.command.await_count == 1
        duplicate = await client.post("/view/api/actions", json=body, headers=headers)
        assert (await duplicate.json())["outcome"] == "accepted" and timers.command.await_count == 1
        assert (
            await client.post(
                "/view/api/pair", json={"roomId": "kitchen", "code": code}, headers=headers
            )
        ).status == 403
        app[BRIDGE].revoke("kitchen")
        assert (await (await client.get("/view/api/snapshot")).json())["capabilities"][
            "timerActions"
        ] == []
        assert (await (await client.post("/view/api/actions", json=body, headers=headers)).json())[
            "error"
        ] == "control_not_paired"
    reboot = PodViewBridge(
        {"kitchen": session},
        pairing_room="kitchen",
        pairing_sha256=digest,
        pairing_store=tmp_path / "used",
    )
    assert reboot.pair("kitchen", code) is None


def test_pairing_admission_bounds_and_unavailable_owner(tmp_path):
    import hashlib
    import time

    session, timers = owner()
    code = "x" * 43

    def bridge():
        return PodViewBridge(
            {"kitchen": session},
            pairing_room="kitchen",
            pairing_sha256=hashlib.sha256(code.encode()).hexdigest(),
            pairing_store=tmp_path / "used",
        )

    gate = bridge()
    for _ in range(5):
        assert gate.pair("kitchen", "z" * 43) is None
    assert gate.pair("kitchen", code) is None
    gate = bridge()
    gate._pairing_deadline = time.monotonic() - 1
    assert gate.pair("kitchen", code) is None
    timers.available = lambda room: False
    assert bridge().pair("kitchen", code) is None
    assert not (tmp_path / "used").exists()


async def test_ingress_cookie_scope_and_secure_flag(tmp_path):
    import hashlib

    session, _ = owner()
    code = "a" * 43
    app = create_app(
        StatusHub(),
        {"kitchen": session},
        podview_pairing_room="kitchen",
        podview_pairing_sha256=hashlib.sha256(code.encode()).hexdigest(),
        podview_pairing_store=tmp_path / "used",
    )
    async with TestClient(TestServer(app)) as client:
        headers = {
            "X-PodView-Request": "1",
            "X-Ingress-Path": "/api/hassio_ingress/opaque-token",
            "X-Forwarded-Proto": "https",
        }
        bad = await client.post(
            "/view/api/pair",
            json={"roomId": "kitchen", "code": code},
            headers={**headers, "X-Ingress-Path": "//attacker/"},
        )
        assert bad.status == 403
        response = await client.post(
            "/view/api/pair", json={"roomId": "kitchen", "code": code}, headers=headers
        )
        assert response.status == 200
        assert "Path=/api/hassio_ingress/opaque-token/view/" in response.headers["Set-Cookie"]
        assert "Secure" in response.headers["Set-Cookie"]


@pytest.mark.parametrize(
    "phase", ["active", "unclaimed", "requested", "started", "unknown", "drained", "stopped"]
)
async def test_paired_cancel_uses_real_owner_reconciliation_and_preserves_unconfirmed_alerts(phase):
    from integration.test_ha_timer_flow import build

    manager, native, client, tools, calls, _ = build()
    async with client:
        created = native.command(
            endpoint="kitchen",
            epoch=native.epoch,
            request_id="fixture-create",
            action="start",
            seconds=60,
            name="Pasta",
        )
        if phase != "active":
            manager.finish(created["id"])
            if phase != "unclaimed":
                scope = {
                    "timer_id": created["id"],
                    "alert_id": "actual-alert",
                    "sink_id": "voice_pe:fixture",
                }
                assert native.command(
                    endpoint="kitchen",
                    epoch=native.epoch,
                    request_id="claim",
                    action="claim_alert",
                    **scope,
                )["ok"]
                if phase != "requested":
                    assert native.command(
                        endpoint="kitchen",
                        epoch=native.epoch,
                        request_id="started",
                        action="report_alert",
                        phase="started",
                        **scope,
                    )["ok"]
                if phase in ("unknown", "drained", "stopped"):
                    assert native.command(
                        endpoint="kitchen",
                        epoch=native.epoch,
                        request_id=phase,
                        action="report_alert",
                        phase=phase,
                        **scope,
                    )["ok"]
        await tools.timers.refresh("kitchen")
        session, _ = owner()
        session.tools = tools
        bridge = PodViewBridge({"kitchen": session})
        token = bridge.grant_timer_control("kitchen")
        snapshot = bridge.snapshot("kitchen")
        body = {
            "bootId": snapshot["bootId"],
            "roomId": "kitchen",
            "taskId": "timers:" + native.epoch,
            "revision": snapshot["revision"],
            "requestId": "screen-finish",
            "action": "timer.cancel",
            "args": {"timer_id": created["id"]},
        }
        result = await bridge.action(body, token)
        assert result["outcome"] == "accepted" and result["physicalResultVerified"] is False
        after = native.snapshot("kitchen")
        should_remove = phase in ("active", "unclaimed", "drained", "stopped")
        assert (not after["timers"] and not after["finished"]) is should_remove
        actions = [c["action"] for c in calls if "action" in c]
        assert actions == (
            ["cancel", "acknowledge_finished"]
            if phase in ("unclaimed", "drained", "stopped")
            else ["cancel"]
        )
        calls_before = len(calls)
        assert await bridge.action(body, token) == result
        assert len(calls) == calls_before
        if not should_remove:
            assert (
                after["finished"][0]["stop_requested"]
                and not after["finished"][0]["physical_stopped"]
            )


@pytest.mark.parametrize("replacement", ["epoch", "owner"])
async def test_cancel_reconciliation_never_acknowledges_after_owner_or_epoch_change(replacement):
    from integration.test_ha_timer_flow import build

    manager, native, client, tools, calls, _ = build()
    async with client:
        created = native.command(
            endpoint="kitchen",
            epoch=native.epoch,
            request_id="fixture-create",
            action="start",
            seconds=60,
        )
        manager.finish(created["id"])
        await tools.timers.refresh("kitchen")
        session, _ = owner()
        session.tools = tools
        bridge = PodViewBridge({"kitchen": session})
        token = bridge.grant_timer_control("kitchen")
        snapshot = bridge.snapshot("kitchen")
        body = {
            "bootId": snapshot["bootId"],
            "roomId": "kitchen",
            "taskId": "timers:" + native.epoch,
            "revision": snapshot["revision"],
            "requestId": "screen-finish",
            "action": "timer.cancel",
            "args": {"timer_id": created["id"]},
        }
        refresh = tools.timers.refresh
        refreshes = 0

        async def replace_before_second_status(room):
            nonlocal refreshes
            refreshes += 1
            if refreshes == 2:
                if replacement == "epoch":
                    native.epoch = "b" * 32
                else:
                    bridge.sessions["kitchen"] = owner()[0]
            return await refresh(room)

        tools.timers.refresh = replace_before_second_status
        result = await bridge.action(body, token)
        assert result["physicalResultVerified"] is False
        assert [c["action"] for c in calls if "action" in c] == ["cancel"]
        assert len(native.snapshot("kitchen")["finished"]) == 1
        before = len(calls)
        assert (await bridge.action(body, token))["error"] == "control_not_paired"
        assert len(calls) == before


async def test_native_paused_state_is_preserved_and_unknown_state_denies_control():
    session, timers = owner()
    bridge = PodViewBridge({"kitchen": session})
    token = bridge.grant_timer_control("kitchen")
    timers.snapshots["kitchen"]["timers"][0]["state"] = "paused"
    assert bridge.snapshot("kitchen")["timers"]["items"][0]["status"] == "paused"
    timers.snapshots["kitchen"]["timers"][0]["state"] = "invented"
    snapshot = bridge.snapshot("kitchen", token)
    assert snapshot["timers"]["status"] == "unavailable"
    assert snapshot["timers"]["items"] == [] and snapshot["capabilities"]["timerActions"] == []
    assert (await bridge.action(envelope(bridge), token))["error"] == "timer_unavailable"
    assert not timers.command.await_count


async def test_passive_home_projects_cleaning_without_touching_voice_tickets():
    from gatekeeper.tools import ToolRouter

    calls = []

    def respond(request):
        calls.append((request.method, request.url.path))
        assert request.method == "GET"
        assert request.url.path.endswith("/states/vacuum.robot")
        return httpx.Response(
            200,
            json={
                "entity_id": "vacuum.robot",
                "state": "cleaning",
                "attributes": {
                    "friendly_name": "Robot",
                    "battery_level": 78,
                    "token": "PRIVATE",
                    "map": "PRIVATE",
                },
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        tools = ToolRouter(None, supervisor_token="PRIVATE", client=http)
        tools.configure_device_control(
            {"extended_device_control": True, "device_control_entities": ["vacuum.robot"]}
        )
        voice_ticket = object()
        tools._device_control._tickets["voice-ticket"] = voice_ticket
        tools._device_control._starts[("vacuum.robot", ("voice", "turn"))] = True
        session, _ = owner()
        app = create_app(StatusHub(), {"kitchen": session}, tools=tools, locked=True)
        async with TestClient(TestServer(app)) as client:
            snap = await (await client.get("/view/api/snapshot")).json()
            assert snap["capabilities"]["homeRead"] == ["vacuum", "light"]
            first = await (await client.get("/view/api/home")).json()
            second = await (await client.get("/view/api/home")).json()
            assert first == second
            assert first["schema"] == "podview.home.v1"
            row = first["vacuum"]["items"][0]
            assert row["state"] == "cleaning" and row["battery"] == 78
            assert row["actions"] == [] and row["history"]["status"] == "unavailable"
            assert "PRIVATE" not in json.dumps(first)
            assert len(calls) == 1
            assert tools._device_control._tickets == {"voice-ticket": voice_ticket}
            assert tools._device_control._starts == {("vacuum.robot", ("voice", "turn")): True}
            assert (
                await client.get("/view/api/home", headers={"Sec-Fetch-Site": "cross-site"})
            ).status == 403
            tools._device_control._token = ""
            revoked = await (await client.get("/view/api/home")).json()
            assert revoked["vacuum"] == {"status": "unavailable", "items": []}
            assert len(calls) == 1
            tools._device_control._token = "PRIVATE"
            tools.configure_device_control({"extended_device_control": False})
            denied = await (await client.get("/view/api/home")).json()
            assert denied["vacuum"] == {"status": "unavailable", "items": []}
            assert len(calls) == 1


@pytest.mark.parametrize("replace_owner", [False, True])
async def test_passive_home_rejects_generation_or_owner_change_during_read(replace_owner):
    from gatekeeper.device_control import DeviceControl
    from gatekeeper.tools import ToolRouter

    entered, release = asyncio.Event(), asyncio.Event()

    async def respond(request):
        entered.set()
        await release.wait()
        return httpx.Response(
            200, json={"entity_id": "vacuum.robot", "state": "cleaning", "attributes": {}}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        tools = ToolRouter(None, supervisor_token="PRIVATE", client=http)
        tools.configure_device_control(
            {"extended_device_control": True, "device_control_entities": ["vacuum.robot"]}
        )
        task = asyncio.create_task(tools.podview_home_read())
        await entered.wait()
        if replace_owner:
            tools._device_control = DeviceControl(http, "PRIVATE")
        else:
            tools.configure_device_control({"extended_device_control": False})
        release.set()
        assert await task == {"status": "unavailable", "items": []}


@pytest.mark.parametrize("state", ["unknown", "unavailable", "error"])
async def test_passive_home_preserves_observed_fault_states_without_inventing_reason(state):
    from gatekeeper.tools import ToolRouter

    def respond(request):
        return httpx.Response(
            200,
            json={
                "entity_id": "vacuum.robot",
                "state": state,
                "attributes": {"battery_level": True},
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        tools = ToolRouter(None, supervisor_token="PRIVATE", client=http)
        tools.configure_device_control(
            {"extended_device_control": True, "device_control_entities": ["vacuum.robot"]}
        )
        data = await tools.podview_home_read()
        assert data["items"][0]["state"] == state
        assert data["items"][0]["battery"] is None
        assert "reason" not in data["items"][0]


async def test_home_domains_are_independent_and_weather_revocation_clears_cache():
    weather_owner = [object()]
    weather = {"status": "observed", "data": {"source": "admitted_weather", "current": None}}
    tools = SimpleNamespace(
        podview_home_available=lambda: False,
        podview_home_binding=lambda: None,
        podview_home_read=AsyncMock(side_effect=RuntimeError("vacuum unavailable")),
        podview_weather_available=lambda: weather_owner[0] is not None,
        podview_weather_binding=lambda: weather_owner[0],
        podview_weather_read=AsyncMock(return_value=weather),
    )
    session, _ = owner()
    app = create_app(StatusHub(), {"kitchen": session}, tools=tools, locked=True)
    async with TestClient(TestServer(app)) as client:
        snapshot = await (await client.get("/view/api/snapshot")).json()
        assert snapshot["capabilities"]["homeRead"] == ["weather"]
        first = await (await client.get("/view/api/home")).json()
        assert first["weather"] == weather
        assert first["vacuum"] == {"status": "unavailable", "items": []}
        weather_owner[0] = None
        second = await (await client.get("/view/api/home")).json()
        assert second["weather"] == {"status": "unavailable", "data": None}
        assert second["revision"] > first["revision"]


async def test_home_session_replacement_discards_inflight_domains():
    entered, release = asyncio.Event(), asyncio.Event()

    async def read():
        entered.set()
        await release.wait()
        return {"status": "observed", "data": {"source": "old_owner"}}

    tools = SimpleNamespace(
        podview_home_available=lambda: False,
        podview_home_binding=lambda: None,
        podview_home_read=AsyncMock(return_value={"status": "unavailable", "items": []}),
        podview_weather_available=lambda: True,
        podview_weather_binding=lambda: "owner",
        podview_weather_read=read,
    )
    session, _ = owner()
    sessions = {"kitchen": session}
    app = create_app(StatusHub(), sessions, tools=tools, locked=True)
    async with TestClient(TestServer(app)) as client:
        pending = asyncio.create_task(client.get("/view/api/home"))
        await entered.wait()
        sessions["kitchen"] = owner()[0]
        release.set()
        result = await (await pending).json()
        assert result["weather"] == {"status": "unavailable", "data": None}
        assert result["vacuum"] == {"status": "unavailable", "items": []}
        assert not app[BRIDGE]._home_busy


async def test_passive_home_does_not_advertise_closed_transport():
    from gatekeeper.tools import ToolRouter

    http = httpx.AsyncClient()
    tools = ToolRouter(None, supervisor_token="PRIVATE", client=http)
    tools.configure_device_control(
        {"extended_device_control": True, "device_control_entities": ["vacuum.robot"]}
    )
    session, _ = owner()
    bridge = PodViewBridge({"kitchen": session}, tools=tools)
    assert bridge.snapshot("kitchen")["capabilities"]["homeRead"] == ["vacuum", "light"]
    await http.aclose()
    assert bridge.snapshot("kitchen")["capabilities"]["homeRead"] == []


async def test_actual_weather_advice_reaches_home_and_cache_cannot_extend_its_period(monkeypatch):
    from datetime import timedelta

    from unit.test_weather_result import _advice_payload, _PassiveWeatherMCP

    from gatekeeper import podview_weather

    payload, result, fixed = _advice_payload(monkeypatch, temperature=6)
    result["forecast"][0]["datetime"] = (fixed + timedelta(minutes=5)).isoformat()
    result["forecast"].append(
        {"datetime": (fixed + timedelta(days=1)).isoformat(), "temperature": 6}
    )
    fixture = _PassiveWeatherMCP()
    fixture.payload = payload
    async with httpx.AsyncClient(transport=httpx.MockTransport(fixture.respond)) as http:
        tools = await fixture.router(http)
        declarations = tools.declarations()
        session, _ = owner()
        app = create_app(StatusHub(), {"kitchen": session}, tools=tools, locked=True)
        async with TestClient(TestServer(app)) as client:
            first = await (await client.get("/view/api/home")).json()
            advice = first["weather"]["data"]["advice"]
            assert advice["summary"] == "Overvej en varm jakke."
            assert advice["children"] == "Tag en varm jakke med."
            assert advice["evidence"][0]["value"] == 6
            assert advice["validUntil"] == fixed.timestamp() + 300
            assert (await (await client.get("/view/api/home")).json()) == first
            assert len(fixture.calls) == 1
            monkeypatch.setattr(podview_weather.time, "time", lambda: advice["validUntil"])
            expired = await (await client.get("/view/api/home")).json()
            assert expired["weather"]["status"] == "observed"
            assert expired["weather"]["data"]["advice"] is None
            assert expired["weather"]["data"]["retrievedAt"] == result["retrieved_at"]
            assert len(fixture.calls) == 2  # Only existing reads; no helper/model/dispatch.
        assert tools.declarations() == declarations
        assert tools._dispatch.await_count == 0 and tools._refresh.await_count == 0


def _weather_brief_route_fixture():
    import time
    from datetime import UTC, datetime, timedelta

    from gatekeeper.podview_weather import weather_projection

    now = datetime.now(UTC)
    stamp = now.isoformat()
    weather = weather_projection(
        {
            "ok": True,
            "data": {
                "success": True,
                "result": {
                    "source": "Met.no",
                    "location": "hjemmet",
                    "temperature_unit": "°C",
                    "precipitation_unit": "mm",
                    "wind_speed_unit": "km/h",
                    "retrieved_at": stamp,
                    "state_updated_at": stamp,
                    "temperature": 13.9,
                    "condition": "cloudy",
                    "forecast_type": "daily",
                    "forecast": [
                        {
                            "datetime": (now + timedelta(days=1)).isoformat(),
                            "temperature": 17.2,
                            "templow": 9.1,
                        }
                    ],
                },
            },
        }
    )
    current = [
        {
            "schema": "podview.weather-brief.v1",
            "receiptId": "ai-receipt",
            "roomId": "kitchen",
            "sessionId": "s1",
            "turnId": "s1:1",
            "taskId": "weather-task",
            "inputRevision": 1,
            "providerGeneration": 2,
            "validUntil": time.time() + 60,
            "summary": "En jakke kan være rar i det kølige vejr.",
            "summaryKind": "ai_advice",
            "weatherReceiptId": "weather-receipt",
            "evidenceFactIds": ["fact:0"],
            "weather": weather,
        }
    ]
    session, _ = owner()

    def read(room, actual):
        assert room == "kitchen" and actual is session
        return current[0]

    tools = SimpleNamespace(
        podview_home_available=lambda: False,
        podview_home_binding=lambda: None,
        podview_home_read=AsyncMock(return_value={"status": "unavailable", "items": []}),
        podview_weather_available=lambda: True,
        podview_weather_binding=lambda: "actual-weather-owner",
        podview_weather_read=AsyncMock(return_value=weather),
        podview_receipts=SimpleNamespace(read_weather_brief=read, aclose=AsyncMock()),
        podview_weather_city="Mårslet",
    )
    return session, tools, current


async def test_real_home_route_ai_revocation_bypasses_five_second_cache():
    session, tools, current = _weather_brief_route_fixture()
    app = create_app(StatusHub(), {"kitchen": session}, tools=tools, locked=True)
    async with TestClient(TestServer(app)) as client:
        first = await (await client.get("/view/api/home")).json()
        assert first["weather"]["data"]["aiAdvice"]["receiptId"] == "ai-receipt"
        assert first["weather"]["data"]["displayLocation"]["name"] == "Mårslet"
        current[0] = None  # Exact owner withdrew on Stop/new input.
        second = await (await client.get("/view/api/home")).json()
        assert "aiAdvice" not in second["weather"]["data"]
        assert tools.podview_weather_read.await_count == 2
        assert second["revision"] > first["revision"]


async def test_real_home_route_held_read_cannot_attach_revoked_ai_brief():
    session, tools, current = _weather_brief_route_fixture()
    entered, release = asyncio.Event(), asyncio.Event()
    weather = current[0]["weather"]

    async def held():
        entered.set()
        await release.wait()
        return weather

    tools.podview_weather_read = held
    app = create_app(StatusHub(), {"kitchen": session}, tools=tools, locked=True)
    async with TestClient(TestServer(app)) as client:
        pending = asyncio.create_task(client.get("/view/api/home"))
        await entered.wait()
        current[0] = None
        release.set()
        result = await (await pending).json()
        assert result["weather"] == weather
        assert "aiAdvice" not in result["weather"]["data"]


@pytest.mark.parametrize("timer_id", [None, "", "x" * 201, 17, [], {}])
async def test_started_timer_without_bounded_native_id_stays_unknown_and_not_replayed(timer_id):
    session, timers = owner()
    timers.command.return_value = {"ok": True, "id": timer_id, "secret": "never forward"}
    bridge = PodViewBridge({"kitchen": session})
    token = bridge.grant_timer_control("kitchen")
    body = envelope(bridge)
    result = await bridge.action(body, token)
    assert result["ok"] is False and result["outcome"] == "unknown"
    assert result["retryAllowed"] is False and result["physicalResultVerified"] is False
    assert "timerId" not in result and "secret" not in result
    assert await bridge.action(body, token) == result
    assert timers.command.await_count == 1


@pytest.mark.parametrize("boundary", ["owner", "binding", "epoch", "grant"])
@pytest.mark.parametrize("action", ["timer.start", "timer.cancel"])
async def test_timer_receipt_cannot_accept_post_dispatch_authority_change(boundary, action):
    session, timers = owner()
    bridge = PodViewBridge({"kitchen": session})
    token = bridge.grant_timer_control("kitchen")
    body = envelope(bridge)
    if action == "timer.cancel":
        body.update(action=action, args={"timer_id": "t1"})

    async def changed(*args, **kwargs):
        if boundary == "owner":
            session.tools.timers = SimpleNamespace()
        elif boundary == "binding":
            timers.bindings["kitchen"] = ("voice_pe", "replacement")
        elif boundary == "epoch":
            timers.snapshots["kitchen"]["epoch"] = "b" * 32
        else:
            bridge.revoke("kitchen")
        return {"ok": True, "id": "created-timer"}

    timers.command.side_effect = changed
    result = await bridge.action(body, token)
    assert result["ok"] is False and result["outcome"] == "unknown"
    assert result["retryAllowed"] is False and "timerId" not in result
    assert timers.command.await_count == 1


async def test_start_receipt_names_only_new_ha_timer_with_existing_snapshot_row():
    from integration.test_ha_timer_flow import build

    _, native, client, tools, calls, _ = build()
    old = native.command(
        endpoint="kitchen", epoch=native.epoch, request_id="old", action="start", seconds=60
    )
    async with client:
        await tools.timers.refresh("kitchen")
        session, _ = owner()
        session.tools = tools
        bridge = PodViewBridge({"kitchen": session})
        token = bridge.grant_timer_control("kitchen")
        body = envelope(bridge)
        body["taskId"] = "timers:" + native.epoch
        result = await bridge.action(body, token)
        assert result["ok"] and result["outcome"] == "accepted"
        native_ids = {row["id"] for row in native.snapshot("kitchen")["timers"]}
        assert result["timerId"] in native_ids - {old["id"]}
        assert bridge.snapshot("kitchen")["timers"]["items"][0]["id"] == old["id"]
        assert result["physicalResultVerified"] is False
        assert await bridge.action(body, token) == result
        assert [row["action"] for row in calls if "action" in row] == ["start"]
