"""Actual client/HB/Thin/SDK; inert manager retirement is not native audio proof."""

import asyncio
import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import httpx
from test_talk_webrtc import setup
from test_thin_live import build, until
from test_thin_live_ten_cycles import CycleWireSDK, close_fixture, retain_aclose_observers

from gatekeeper import heartbeat as heartbeat_module
from gatekeeper.__main__ import _NoAttention
from gatekeeper.heartbeat import Heartbeat
from gatekeeper.openai_live import _load_live_sdk
from gatekeeper.podconnect import AttentionClient
from gatekeeper.talk import run_talk


async def test_current_retirement_closes_sole_native_owner_and_preserves_original_release(
    monkeypatch,
):
    # Actual attentionHandler HTTP replies from the producer's causal expiry regression:
    # producer receipt SHA256 76f03ae87c867fbe2eeb4930f418fa0ad9ab151331e05e106d9f4f3626972f11.
    # Native peers are inert; replay proves wire compatibility, not restoration in a room.
    fixture = json.loads(
        (Path(__file__).parents[1] / "fixtures/attention_retirement_manager.json").read_text()
    )
    process, room = fixture["expected"]["process"], fixture["room"]
    nonces = iter((uuid.UUID(fixture["session"]), uuid.uuid4()))
    monkeypatch.setattr(heartbeat_module, "uuid", SimpleNamespace(uuid4=lambda: next(nonces)))
    state = {"revision": 0, "session": None, "mode": "pending"}
    requests, sdks, observers, closes = [], [], [], []
    pending, transport = asyncio.Event(), asyncio.Event()

    session, _, _, _, device = build()
    session.room = room
    _load_live_sdk()  # Same actual pure bootstrap as production, before bounded SDK connect.

    def factory(**kwargs):
        sdk = CycleWireSDK(webrtc=False)
        sdk.allow_exit.set()
        sdk.socket.release.set()
        sdk.manager_release.set()
        sdks.append(sdk)
        return sdk.factory(**kwargs)

    session.live_brain.client_factory = factory
    retain_aclose_observers(session, observers, monkeypatch)
    original_close = session._request_close

    def observe_close(reason, **kwargs):
        result = original_close(reason, **kwargs)
        closes.append((reason, result))
        return result

    monkeypatch.setattr(session, "_request_close", observe_close)

    async def manager(request):
        if request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "rooms": {
                        room: {
                            "challenge": {"process": process, "revision": str(state["revision"])}
                        }
                    }
                },
            )
        body = json.loads(request.content)
        requests.append((request.url.path, body))
        if request.url.path.endswith("/release"):
            assert body == {
                "room": room,
                "session": state["session"],
                "expected": {"process": process, "revision": str(state["revision"])},
            }
            assert hb._task is hb._beat_task is None
            assert not hb._retired_beats and not hb._stopping_tasks
            return httpx.Response(
                200, json={"contract": "native_attention_v1", "outcome": "released"}
            )
        if body["begin"]:
            assert body["expected"] == {"process": process, "revision": str(state["revision"])}
            state["revision"] += 1
            state["session"] = body["session"]
            if state["revision"] == 1:
                assert body["session"] == fixture["session"]
                return httpx.Response(200, json=fixture["begin"])
            return httpx.Response(
                200,
                json={
                    "contract": "native_attention_v1",
                    "challenge": {"process": process, "revision": str(state["revision"])},
                },
            )
        assert body["session"] == state["session"]
        if state["mode"] == "pending":
            pending.set()
            return httpx.Response(fixture["pending_status"], text=fixture["pending_body"])
        if state["mode"] == "partial":
            return httpx.Response(fixture["partial_status"], text=fixture["partial_body"])
        if state["mode"] == "transport":
            transport.set()
            raise httpx.ReadTimeout("temporary transport outage", request=request)
        if state["mode"] == "retired":
            state["retired_reply"] = fixture["retired_body"]
            assert {
                "room": body["room"],
                "session": body["session"],
                "expected": body["expected"],
            } == {
                "room": fixture["room"],
                "session": fixture["session"],
                "expected": fixture["expected"],
            }
            return httpx.Response(fixture["retired_status"], json=state["retired_reply"])
        if state["mode"] == "stale":
            return httpx.Response(409, json=state["retired_reply"])
        return httpx.Response(
            200,
            json={
                "contract": "native_attention_v1",
                "challenge": {"process": process, "revision": str(state["revision"])},
            },
        )

    async with httpx.AsyncClient(
        base_url="http://inert-manager", transport=httpx.MockTransport(manager)
    ) as http:
        session.attention = AttentionClient("http://inert-manager", client=http)
        hb = session.heartbeat = Heartbeat(session.attention, period_ms=10, jitter_ms=0)
        try:
            await session.start()
            await session.wake()
            await until(lambda: hb._admitted)
            original, old_target, old_notifier = hb.lease, hb._target, hb._on_lease_retired
            await asyncio.wait_for(pending.wait(), 2)
            assert session._active and not session._transport_closing and not closes
            state["mode"] = "partial"
            assert await hb._beat_once(hb._target) is False
            assert session._active and not session._transport_closing and not closes
            state["mode"] = "transport"
            await asyncio.wait_for(transport.wait(), 2)
            assert session._active and hb.lease == original and not closes
            state["mode"] = "retired"
            await until(lambda: session._close_task is not None)
            owner = session._close_task
            old_notifier(original)  # Duplicate delivery must join the already requested close.
            assert closes == [("attention-lease-retired", owner)]
            await asyncio.wait_for(asyncio.shield(owner), 3)
            assert closes == [("attention-lease-retired", owner)]
            assert not session._active and not session._teardown_incomplete
            assert device.rearm_calls == 1 and hb.lease == original
            assert [body for path, body in requests if path.endswith("/release")] == [
                {"room": room, **original}
            ]
            assert not device.announced_urls  # Technical abort invents no spoken farewell.
            state["mode"] = "admit"
            await session.wake()
            await until(lambda: hb._admitted)
            assert hb.lease["session"] != original["session"]
            state["mode"] = "stale"
            assert await hb._beat_once(hb._target) is False  # Real HTTP replay of wake A's reply.
            assert session._active and not session._transport_closing
            before = list(requests)
            old_notifier(original)  # Delayed wake-A notification must not cross wake B.
            assert await hb._beat_once(old_target)
            assert requests == before and session._active and not session._transport_closing
            assert closes == [("attention-lease-retired", owner)]
            state["mode"] = "admit"
            await session.stop()
            assert device.rearm_calls == 2 and not session._teardown_incomplete
            assert sum(body.get("begin") is True for _, body in requests) == 2
            assert [body for path, body in requests if path.endswith("/release")] == [
                {"room": room, **original},
                {"room": room, **hb.lease},
            ]
        finally:
            state["mode"] = "admit"
            await close_fixture(session, sdks, observers=observers)


async def test_shipped_talk_no_attention_stays_unowned_through_stop_and_next_wake(monkeypatch):
    wire, _, session, _, _ = setup()
    session.attention = session.heartbeat = _NoAttention()
    sdks, observers = [], []
    _load_live_sdk()

    def factory(**kwargs):
        sdk = CycleWireSDK(webrtc=True)
        sdk.allow_exit.set()
        sdk.socket.release.set()
        sdk.manager_release.set()
        sdks.append(sdk)
        wire.sdk = sdk
        return sdk.factory(**kwargs)

    session.live_brain.client_factory = factory
    retain_aclose_observers(session, observers, monkeypatch)
    task = asyncio.create_task(run_talk(wire, session, session.voicepe))
    try:
        for cycle in range(2):
            wire.send("wake", command_id=f"wake-{cycle}")
            await until(lambda cycle=cycle: wire.result(f"wake-{cycle}") is not None)
            assert wire.result(f"wake-{cycle}")["status"] == "accepted"
            assert session._active and session.heartbeat.lease is None
            assert not hasattr(session.heartbeat, "start_with_retirement")
            wire.send("stop", command_id=f"stop-{cycle}")
            await until(lambda cycle=cycle: wire.result(f"stop-{cycle}") is not None)
            assert wire.result(f"stop-{cycle}")["status"] == "accepted"
            assert not session._active and not session._teardown_incomplete
    finally:
        await close_fixture(session, sdks, observers=observers, wire=wire, talk_task=task)
