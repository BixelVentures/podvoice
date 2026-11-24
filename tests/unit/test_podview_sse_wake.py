"""Receipt wake subscriptions and HA event routing; no providers, network or actions."""

import asyncio

from unit.test_podview_presentation import context
from unit.test_weather_result import weather_payload

from gatekeeper.podview_receipts import VisualReceiptOwner


def publish(sink, room="kitchen", typed=True):
    if typed:
        return sink.offer_completed_answer(**context(object(), room_id=room))
    weather = weather_payload()
    return sink.offer(
        object(),
        room_id=room,
        session_id="session",
        session_epoch=1,
        turn_id="turn",
        provider_generation=1,
        task_id="task",
        input_revision=1,
        call_id="call",
        tool_name="weather_forecast",
        result=weather,
        current=lambda: True,
        direct_weather=True,
    )


async def test_loop_thread_dispatch_and_broken_observer_do_not_change_acceptance():
    sink = VisualReceiptOwner()
    event = sink.subscribe("kitchen")
    await asyncio.to_thread(sink._notify, "kitchen")
    await asyncio.wait_for(event.wait(), 0.3)
    sink.unsubscribe(event)

    class ClosedLoop:
        def call_soon_threadsafe(self, *args):
            raise RuntimeError("loop closed")

    sink._subscribers[asyncio.Event()] = ("kitchen", ClosedLoop())
    assert publish(sink)
    assert sink.snapshot("kitchen")["items"]


async def test_subscription_bound_and_closed_owner():
    sink = VisualReceiptOwner()
    events = [sink.subscribe("kitchen") for _ in range(8)]
    assert all(events) and sink.subscribe("office") is None
    sink.unsubscribe(events[0])
    assert sink.subscribe("office") is not None
    sink.close()
    assert sink.subscribe("kitchen") is None


def test_podconnect_playback_event_wakes_only_music():
    from gatekeeper.tools import ToolRouter

    event_types = (
        "state_changed",
        "entity_registry_updated",
        "area_registry_updated",
        "device_registry_updated",
        "podconnect_playback_changed",
    )
    seen = []
    message = {
        "type": "event",
        "id": 5,
        "event": {"event_type": "podconnect_playback_changed", "data": {"config_entry_id": "x"}},
    }
    ToolRouter._podview_home_event(
        message,
        event_types,
        lambda: {"music": {"*"}, "vacuum": {"vacuum.a"}},
        lambda k, r: seen.append(k),
    )
    assert seen == [{"music"}]
    seen.clear()
    ToolRouter._podview_home_event(
        message, event_types, lambda: {"music": set()}, lambda k, r: seen.append(k)
    )
    assert seen == []
