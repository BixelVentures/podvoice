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
    assert set(snap["services"]) == {"openai", "voicepe", "podconnect", "mcp"}
    room = snap["rooms"][0]
    assert room["room"] == "kitchen"
    assert room["state"] == "LOUNGE_WINDOW"
    assert room["level"] == 35 and room["ducked"] is True
    assert room["last_latency_ts"] is None
    assert snap["state_activity"][-1]["state"] == "LOUNGE_WINDOW"
    assert snap["state_activity"][-1]["turn_cue"] is False


async def test_subscribe_receives_broadcasts():
    hub = StatusHub()
    q = await hub.subscribe()
    hub.set_state("kitchen", "LISTENING", turn_cue=True)
    ev = await asyncio.wait_for(q.get(), timeout=1)
    assert ev["type"] == "state" and ev["state"] == "LISTENING" and ev["level"] == 0
    assert ev["turn_cue"] is True
    assert hub.snapshot()["state_activity"][-1]["state"] == "LISTENING"
    assert hub.snapshot()["state_activity"][-1]["turn_cue"] is True
    hub.set_service("openai", "up")
    ev2 = await asyncio.wait_for(q.get(), timeout=1)
    assert ev2 == {"type": "service", "name": "openai", "status": "up"}
    hub.unsubscribe(q)


async def test_metrics_increment_and_transcript():
    hub = StatusHub()
    q = await hub.subscribe()
    hub.incr("sessions")
    hub.incr("sessions")
    hub.incr("false_barges")
    assert hub.snapshot()["metrics"]["sessions"] == 2
    assert hub.snapshot()["metrics"]["false_barges"] == 1
    hub.transcript("kitchen", "in", "tænd lyset")
    # drain: 3 metrics events then 1 transcript
    kinds = [(await asyncio.wait_for(q.get(), timeout=1))["type"] for _ in range(4)]
    assert kinds == ["metrics", "metrics", "metrics", "transcript"]


async def test_tool_activity_is_recorded_and_broadcast():
    hub = StatusHub()
    q = await hub.subscribe()
    hub.tool_call("kitchen", "google_web_sogning", {"ok": True})
    ev = await asyncio.wait_for(q.get(), timeout=1)
    assert ev["type"] == "tool"
    assert ev["room"] == "kitchen"
    assert ev["name"] == "google_web_sogning"
    assert ev["ok"] is True
    assert hub.snapshot()["tool_activity"][-1]["name"] == "google_web_sogning"


async def test_stuetest_start_records_metric_baseline_and_event():
    hub = StatusHub()
    hub.incr("tool_calls", 3)
    q = await hub.subscribe()
    started = hub.start_stuetest()
    snap = hub.snapshot()
    assert snap["stuetest_started_at"] == started
    assert snap["stuetest_metric_baseline"]["tool_calls"] == 3
    events = [await asyncio.wait_for(q.get(), timeout=1) for _ in range(2)]
    assert [e["type"] for e in events] == ["activity", "stuetest"]


async def test_latency_records_timestamp():
    hub = StatusHub()
    hub.set_latency("kitchen", 987.6)
    room = hub.snapshot()["rooms"][0]
    assert room["last_latency_ms"] == 988
    assert isinstance(room["last_latency_ts"], float)
    hub.set_latency("kitchen", None)
    room = hub.snapshot()["rooms"][0]
    assert room["last_latency_ms"] is None
    assert room["last_latency_ts"] is None


async def test_service_only_broadcasts_on_change():
    hub = StatusHub()
    q = await hub.subscribe()
    hub.set_service("podconnect", "up")
    hub.set_service("podconnect", "up")  # no-op, no second event
    ev = await asyncio.wait_for(q.get(), timeout=1)
    assert ev["status"] == "up"
    assert q.empty()
