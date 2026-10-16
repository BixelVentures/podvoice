"""Actual typed source owner -> presentation -> weather consumer, synthetic input only."""

import copy
import json
import time
from datetime import datetime
from types import SimpleNamespace

from unit.test_podview_presentation import context, message
from unit.test_weather_result import weather_payload

from gatekeeper.podview_receipts import VisualReceiptOwner
from gatekeeper.podview_weather_brief import project, read_brief


def test_actual_source_owner_presentation_and_weather_projection_preserve_one_receipt(monkeypatch):
    clock = [0.0]
    sink, owner = VisualReceiptOwner(clock=lambda: clock[0]), object()
    raw = weather_payload()
    stamp = datetime.fromisoformat(raw["data"]["result"]["retrieved_at"]).timestamp()
    monkeypatch.setattr(time, "time", lambda: stamp)
    assert sink.offer(
        owner,
        room_id="kitchen",
        session_id="session",
        session_epoch=1,
        turn_id="live:1:response-tools",
        provider_generation=1,
        task_id="answer:delegation",
        input_revision=1,
        call_id="weather-call",
        tool_name="weather_forecast",
        result=raw,
        current=lambda: True,
        read_current=lambda completed: True,
        delegation_id="delegation",
    )
    original = sink._rooms["kitchen"]["source_registry"]["weather-call"]
    final = message("fact-card")
    final["presentation"].update(
        origin="owner_sources",
        sourceCalls=["weather-call"],
        summary="En jakke kan være rar i det kølige vejr.",
        content={"facts": [{"callId": "weather-call", "field": "temperature"}]},
    )
    assert sink.offer_completed_answer(**context(owner, message=json.dumps(final)))
    admitted = read_brief(SimpleNamespace(podview_receipts=sink), "kitchen", owner)
    assert admitted is not None
    home = copy.deepcopy(admitted["weather"])
    shown = project(home, admitted, "Mårslet")
    assert shown["data"]["aiAdvice"]["weatherReceiptId"] == original["item"]["receiptId"]
    assert shown["data"]["aiAdvice"]["evidenceFactIds"] == ["fact:0"]
    assert shown["data"]["current"]["temperature"] == raw["data"]["result"]["temperature"]
    assert shown["data"]["source"] == raw["data"]["result"]["source"]
    assert shown["data"]["displayLocation"]["name"] == "Mårslet"
    assert shown["data"]["aiAdvice"]["validUntil"] <= admitted["validUntil"]
    # The producer's next genuine presentation revokes this old weather brief.
    assert sink.offer_completed_answer(
        **context(owner, response_id="next", message=json.dumps(message()))
    )
    assert read_brief(SimpleNamespace(podview_receipts=sink), "kitchen", owner) is None
