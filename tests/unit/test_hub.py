"""Unit tests for StatusHub (snapshot + SSE broadcast + metrics)."""

from __future__ import annotations

import asyncio

from gatekeeper.hub import StatusHub


async def test_snapshot_shape_and_state_levels():
    hub = StatusHub(simulate=True)
    hub.register_room("kitchen")
    hub.set_state("kitchen", "LOUNGE_WINDOW")
    snap = hub.snapshot()
    assert snap["simulate"] is True
    assert set(snap["services"]) == {"gemini", "voicepe", "podconnect"}
    room = snap["rooms"][0]
    assert room["room"] == "kitchen"
    assert room["state"] == "LOUNGE_WINDOW"
    assert room["level"] == 35 and room["ducked"] is True


async def test_subscribe_receives_broadcasts():
    hub = StatusHub()
    q = await hub.subscribe()
    hub.set_state("kitchen", "LISTENING")
    ev = await asyncio.wait_for(q.get(), timeout=1)
    assert ev["type"] == "state" and ev["state"] == "LISTENING" and ev["level"] == 5
    hub.set_service("gemini", "up")
    ev2 = await asyncio.wait_for(q.get(), timeout=1)
    assert ev2 == {"type": "service", "name": "gemini", "status": "up"}
    hub.unsubscribe(q)


async def test_metrics_increment_and_transcript():
    hub = StatusHub()
    q = await hub.subscribe()
    hub.incr("sessions")
    hub.incr("sessions")
    assert hub.snapshot()["metrics"]["sessions"] == 2
    hub.transcript("kitchen", "in", "tænd lyset")
    # drain: 2 metrics events then 1 transcript
    kinds = [(await asyncio.wait_for(q.get(), timeout=1))["type"] for _ in range(3)]
    assert kinds == ["metrics", "metrics", "transcript"]


async def test_service_only_broadcasts_on_change():
    hub = StatusHub()
    q = await hub.subscribe()
    hub.set_service("podconnect", "up")
    hub.set_service("podconnect", "up")  # no-op, no second event
    ev = await asyncio.wait_for(q.get(), timeout=1)
    assert ev["status"] == "up"
    assert q.empty()
