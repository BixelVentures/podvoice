"""Real ingress route and owner-bound bridge regressions; no physical claims."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from gatekeeper.events import State
from gatekeeper.podview import PodViewBridge, _trusted
from gatekeeper.podview_enrichment import VisualSelector


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


async def test_native_paused_state_is_preserved_and_unknown_state_is_unavailable():
    session, timers = owner()
    bridge = PodViewBridge({"kitchen": session})
    timers.snapshots["kitchen"]["timers"][0]["state"] = "paused"
    assert bridge.snapshot("kitchen")["timers"]["items"][0]["status"] == "paused"
    timers.snapshots["kitchen"]["timers"][0]["state"] = "invented"
    snapshot = bridge.snapshot("kitchen")
    assert snapshot["timers"]["status"] == "unavailable"
    assert snapshot["timers"]["items"] == [] and snapshot["capabilities"]["timerActions"] == []
    assert not timers.command.await_count


@pytest.mark.parametrize(
    "invalid", [{"revision": None}, {"revision": "01"}, {"duration_seconds": 30}]
)
def test_native_timer_invalid_segment_metadata_cannot_fall_back_to_historical_duration(invalid):
    session, timers = owner()
    row = timers.snapshots["kitchen"]["timers"][0]
    row.update(duration_seconds=120, revision="900719925474099312345")
    timers.adjust_available = lambda room, timer_id=None: (
        room == "kitchen" and timer_id in (None, "t1")
    )
    bridge = PodViewBridge({"kitchen": session})
    assert bridge.snapshot("kitchen")["timers"]["items"][0]["durationSeconds"] == 120
    row.update(invalid)
    snapshot = bridge.snapshot("kitchen")
    assert snapshot["timers"]["status"] == "unavailable" and snapshot["timers"]["items"] == []
    assert snapshot["capabilities"]["timerActions"] == []
