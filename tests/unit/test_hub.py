"""Unit tests for StatusHub (snapshot + SSE broadcast + metrics)."""

from __future__ import annotations

import asyncio

from gatekeeper.hub import StatusHub


async def test_snapshot_shape_and_state_levels():
    hub = StatusHub()
    hub.register_room("kitchen")
    hub.set_state("kitchen", "LOUNGE_WINDOW")
    snap = hub.snapshot()
    assert "simulate" not in snap
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
    assert ev2["type"] == "service"
    assert ev2["name"] == "openai"
    assert ev2["status"] == "up"
    assert ev2["detail"]["reason"] == "Seneste kontrol lykkedes"
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
    assert hub.snapshot()["latency_activity"][-1]["ms"] == 988
    hub.set_latency("kitchen", None)
    room = hub.snapshot()["rooms"][0]
    assert room["last_latency_ms"] is None
    assert room["last_latency_ts"] is None


async def test_timeline_records_bounded_lifecycle_edge_and_broadcasts():
    hub = StatusHub()
    q = await hub.subscribe()
    hub.timeline("kitchen", "playback_started", session="42", at_ms=1234, ignored={"x": 1})
    ev = await asyncio.wait_for(q.get(), timeout=1)
    assert ev["type"] == "timeline"
    assert ev["event"] == "playback_started"
    assert ev["session"] == "42"
    assert ev["at_ms"] == 1234
    assert "ignored" not in ev
    assert hub.snapshot()["timeline_activity"][-1]["event"] == "playback_started"


async def test_groundtest_records_sequential_physical_verdicts():
    hub = StatusHub()
    started = hub.start_groundtest(2, room="kitchen", provenance={"fingerprint": "v1"})
    assert started["current_index"] == 0
    assert started["run_id"]
    assert started["case_id"]

    failed = hub.record_groundtest(
        0,
        "wrong_hearing",
        {"inputs": ["Ja klokken"], "outputs": ["Klokken er tre."], "latency_ms": 3000},
    )
    assert failed["current_index"] == 1
    assert failed["step_started_at"] is None
    assert failed["failed_at"] is not None
    assert failed["completed_at"] is not None
    assert failed["results"][0]["outcome"] == "wrong_hearing"

    restarted = hub.start_groundtest(2, room="kitchen", provenance={"fingerprint": "v1"})
    first_case_id = restarted["case_id"]
    after_first = hub.record_groundtest(
        0, "correct", {"timeline_session": "s1", "provider_generation": 1}
    )
    assert after_first["completed_at"] is None
    assert after_first["case_id"] != first_case_id
    assert after_first["step_started_at"] is not None

    pending = hub.record_groundtest(
        1, "correct", {"inputs": ["Hvilken dag?"], "outputs": ["Onsdag."]}
    )
    assert pending["completed_at"] is None
    assert pending["awaiting_final_wake"] is True
    assert pending["final_wake_id"]

    complete = hub.complete_groundtest_final_wake("correct", {"machine_ok": True})
    assert complete["completed_at"] is not None
    assert complete["awaiting_final_wake"] is False
    assert complete["final_wake"]["machine_ok"] is True


async def test_service_only_broadcasts_on_change():
    hub = StatusHub()
    q = await hub.subscribe()
    hub.set_service("podconnect", "up")
    hub.set_service("podconnect", "up")  # no-op, no second event
    ev = await asyncio.wait_for(q.get(), timeout=1)
    assert ev["status"] == "up"
    assert q.empty()


async def test_service_broadcasts_a_new_live_reason_even_when_colour_is_unchanged():
    hub = StatusHub()
    q = await hub.subscribe()
    hub.set_service(
        "openai",
        "down",
        reason="Realtime-forbindelsen blev afbrudt",
        source="aktiv session",
    )
    event = await asyncio.wait_for(q.get(), timeout=1)
    assert event["status"] == "down"
    assert event["detail"]["reason"] == "Realtime-forbindelsen blev afbrudt"
    assert event["detail"]["source"] == "aktiv session"
    assert q.empty()


async def test_legacy_brain_service_is_canonical_openai_truth():
    hub = StatusHub()
    q = await hub.subscribe()
    hub.set_service("brain", "up")
    event = await asyncio.wait_for(q.get(), timeout=1)
    assert event["type"] == "service"
    assert event["name"] == "openai"
    assert event["status"] == "up"
    assert "brain" not in hub.snapshot()["services"]
    assert hub.snapshot()["services"]["openai"] == "up"
    detail = hub.snapshot()["service_details"]["openai"]
    assert detail["observed_at"] is not None
    assert detail["source"] == "runtime"


async def test_live_fragment_is_never_broadcast_as_complete_turn(tmp_path):
    from gatekeeper.history import History

    history = History(tmp_path / "history.jsonl")
    hub = StatusHub(history=history)
    q = await hub.subscribe()
    hub.transcript_fragment("r0", "out", "Hello", ts=1, session="a", generation=2)
    hub.transcript_fragment("r0", "out", " there", ts=2, session="a", generation=2)
    events = [q.get_nowait(), q.get_nowait()]
    assert all(e["type"] == "transcript_fragment" and e["kind"] == "segment" for e in events)
    assert events[0]["segment_id"] == events[1]["segment_id"]
    assert history.conversations()[0]["turns"][0]["text"] == "Hello there"
    hub.unsubscribe(q)


async def test_talk_live_fragments_preserve_generation_and_interruption(tmp_path):
    from gatekeeper.history import History
    from gatekeeper.talk import TalkHub

    emitted = []

    async def send(event):
        emitted.append(event)

    history = History(tmp_path / "history.jsonl")
    hub = TalkHub(send, history=history)
    for direction, text, generation in [
        ("out", "A", 1),
        ("out", "B", 1),
        ("in", "C", 1),
        ("out", "D", 1),
        ("out", "E", 2),
    ]:
        hub.transcript_fragment("talk", direction, text, session="s", generation=generation)
    await asyncio.gather(*hub._pending)
    assert [e["type"] for e in emitted] == ["transcript_fragment"] * 5
    assert emitted[0]["segment_id"] == emitted[1]["segment_id"]
    assert len({e["segment_id"] for e in emitted}) == 4
    assert [t["text"] for t in history.conversations()[0]["turns"]] == ["AB", "C", "D", "E"]


async def test_live_without_history_breaks_segments_at_complete_transcript():
    hub = StatusHub()
    q = await hub.subscribe()
    hub.transcript_fragment("r0", "out", "a", ts=1, session="s", generation=1)
    hub.transcript("r0", "out", "complete", ts=2, session="s")
    hub.transcript_fragment("r0", "out", "b", ts=3, session="s", generation=1)
    first, complete, last = [q.get_nowait() for _ in range(3)]
    assert first["segment_id"] != last["segment_id"]
    assert complete["type"] == "transcript" and "kind" not in complete
    hub.unsubscribe(q)
