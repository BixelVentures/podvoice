"""Closed normal-response presentation; no provider calls, actions or model quota."""

import json
import time
from datetime import datetime

import pytest
from unit.test_weather_result import weather_payload

from gatekeeper.podview_presentation import explanation_content, final_message
from gatekeeper.podview_receipts import VisualReceiptOwner

CONTENTS = {
    "concise": {"visualValue": "reference"},
    "comparison": {"columns": ["Materiale"], "items": [{"label": "Papirfly", "values": ["Papir"]}]},
    "choices": {"items": [{"label": "Tegn", "detail": "Et lokalt forslag"}]},
    "chart": {
        "unit": "eksempler",
        "unitSingular": "eksempel",
        "items": [{"label": "Undervisningseksempel", "value": 3}],
    },
    "steps": {"steps": ["Fold papiret på midten."]},
    "checklist": {"items": [{"label": "Find papir"}]},
    "fact-card": {
        "facts": [{"label": "Princip", "value": "Rotation", "detail": "En generel AI-forklaring"}]
    },
    "answer-timeline": {
        "events": [{"time": "Først", "label": "Find materialer", "detail": "Et foreslået forløb"}]
    },
    "simple-diagram": {"nodes": [{"label": "Pedaler", "detail": "Driver kæden"}]},
    "sourced-image": {"ownedImage": "bicycle_drivetrain"},
}


def message(family="concise"):
    return {
        "spoken": "Sådan virker det.",
        "presentation": {
            "family": family,
            "title": "En forklaring",
            "summary": "Et undervisningseksempel.",
            "origin": "ai_explanation",
            "content": CONTENTS[family],
            "sourceCalls": [],
        },
    }


def context(owner, **changes):
    args = dict(
        owner=owner,
        room_id="kitchen",
        session_id="session",
        session_epoch=1,
        turn_id="live:1:response-final",
        provider_generation=1,
        task_id="answer:delegation",
        input_revision=1,
        delegation_id="delegation",
        response_id="response-final",
        message=json.dumps(message()),
        question_context="Hvordan virker cyklens kæde og pedaler?",
        current=lambda: True,
        read_current=lambda completed: True,
    )
    args.update(changes)
    return args


@pytest.mark.parametrize(
    "family", [family for family in CONTENTS if family not in {"fact-card", "chart"}]
)
def test_each_existing_format_has_real_closed_producer_data_and_server_owned_ids(family):
    owner, sink = object(), VisualReceiptOwner()
    assert sink.offer_completed_answer(**context(owner, message=json.dumps(message(family))))
    row = sink.snapshot("kitchen", owner)["items"][0]
    assert row["schema"] == "podview.presentation.v1" and row["family"] == family
    assert row["allowedActions"] == [] and row["provenance"] == {"kind": "ai_explanation"}
    assert row["content"]["sources"][0]["scope"] == "conversation_answer"
    assert (
        sink.source("kitchen", row["receiptId"], owner)["schema"]
        == "podview.presentation.source.v1"
    )
    assert sink.source("other", row["receiptId"], owner) is None
    assert sink._selector is None and sink._selection is None


@pytest.mark.parametrize(
    "raw",
    [
        '{"spoken":"x","spoken":"y","presentation":null}',
        '{"spoken":"x","presentation":null,"actions":[]}',
        "```json\n{}\n```",
        "{bad}",
        "[" + '"x"' * 2200 + "]",
    ],
)
def test_malformed_ambiguous_oversized_or_executable_envelopes_are_not_literal_fallback(raw):
    assert final_message(raw) is None


def test_plain_text_has_no_visual_presentation_and_model_urls_ids_or_completion_rejected():
    assert final_message("En kort forklaring.")["presentation"] is None
    for family, bad in [
        ("checklist", {"items": [{"label": "Rent", "checked": True}]}),
        ("choices", {"items": [{"id": "forged", "label": "Tryk", "detail": "..."}]}),
        ("sourced-image", {"ownedImage": "https://unowned.invalid/image.png"}),
    ]:
        p = message(family)["presentation"]
        p["content"] = bad
        with pytest.raises(ValueError):
            explanation_content(p, "a" * 32)


def test_exact_delegation_continuation_uses_original_source_ids_values_and_expiry(monkeypatch):
    now = [0.0]
    sink, owner = VisualReceiptOwner(clock=lambda: now[0]), object()
    weather = weather_payload()
    stamp = datetime.fromisoformat(weather["data"]["result"]["retrieved_at"]).timestamp()
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
        result=weather,
        current=lambda: True,
        read_current=lambda completed: True,
        delegation_id="delegation",
    )
    source = sink._rooms["kitchen"]["source_registry"]["weather-call"]
    source_id, original_deadline = source["item"]["receiptId"], source["deadline"]
    now[0] = 60
    final = message("fact-card")
    final["presentation"].update(
        origin="owner_sources",
        sourceCalls=["weather-call"],
        summary="Se dagens vejr.",
        content={"facts": [{"callId": "weather-call", "field": "temperature"}]},
    )
    assert sink.offer_completed_answer(**context(owner, message=json.dumps(final)))
    row = sink.snapshot("kitchen", owner)["items"][0]
    assert row["turnId"] == "live:1:response-tools"
    assert row["provenance"]["receiptIds"] == [source_id]
    assert row["content"]["facts"][0]["value"] == "15.1 °C"
    assert sink._rooms["kitchen"]["items"][0]["deadline"] <= original_deadline
    brief = sink.read_weather_brief("kitchen", owner)
    assert brief["weatherReceiptId"] == source_id and brief["weather"]["status"] == "observed"
    assert brief["evidenceFactIds"] == ["fact:0"]
    # A newer nonweather result must withdraw the old advice.
    assert sink.offer_completed_answer(
        **context(owner, response_id="next", message=json.dumps(message()))
    )
    assert sink.read_weather_brief("kitchen", owner) is None
    now[0] = 121
    assert sink.source("kitchen", row["receiptId"], owner) is None


def source_fixture():
    clock = [0.0]
    owner, sink = object(), VisualReceiptOwner(clock=lambda: clock[0])
    assert sink.offer(
        owner,
        room_id="kitchen",
        session_id="session",
        session_epoch=1,
        turn_id="live:1:source-response",
        provider_generation=1,
        task_id="answer:delegation",
        input_revision=1,
        call_id="actual-source",
        tool_name="google_web_sogning",
        result={"ok": True, "data": 2004},
        current=lambda: True,
        read_current=lambda completed: True,
        delegation_id="delegation",
    )
    final = message("fact-card")
    final["presentation"].update(
        origin="owner_sources",
        sourceCalls=["actual-source"],
        content={"facts": [{"callId": "actual-source", "field": "answer"}]},
    )
    return owner, sink, clock, final


@pytest.mark.parametrize(
    "change", ["owner", "session", "generation", "revision", "delegation", "expiry", "missing"]
)
def test_no_current_session_bucket_or_foreign_source_fallback(change):
    owner, sink, clock, final = source_fixture()
    args = context(owner, message=json.dumps(final))
    if change == "owner":
        args["owner"] = object()
    if change == "session":
        args["session_id"] = "other"
    if change == "generation":
        args["provider_generation"] = 2
    if change == "revision":
        args["input_revision"] = 2
    if change == "delegation":
        args.update(delegation_id="other", task_id="answer:other")
    if change == "expiry":
        clock[0] = 121
    if change == "missing":
        final["presentation"]["sourceCalls"] = ["different-call"]
        args["message"] = json.dumps(final)
    assert not sink.offer_completed_answer(**args)
    assert sink.snapshot("kitchen")["items"] == []


def test_registry_carries_only_same_explicit_delegation_over_multiple_response_ids():
    owner, sink, clock, final = source_fixture()
    clock[0] = 30
    assert sink.offer(
        owner,
        room_id="kitchen",
        session_id="session",
        session_epoch=1,
        turn_id="live:1:second-source-response",
        provider_generation=1,
        task_id="answer:delegation",
        input_revision=1,
        call_id="second-source",
        tool_name="google_web_sogning",
        result={"ok": True, "data": 2005},
        current=lambda: True,
        read_current=lambda completed: True,
        delegation_id="delegation",
    )
    final["presentation"]["sourceCalls"].append("second-source")
    final["presentation"]["content"]["facts"].append({"callId": "second-source", "field": "answer"})
    clock[0] = 60
    assert sink.offer_completed_answer(**context(owner, message=json.dumps(final)))
    row = sink.snapshot("kitchen", owner)["items"][0]
    assert [f["value"] for f in row["content"]["facts"]] == ["2004", "2005"]
    assert sink._rooms["kitchen"]["items"][0]["deadline"] <= 120


def test_replay_selector_suppression_stop_and_normal_close_keep_original_lifecycle():
    owner, sink = object(), VisualReceiptOwner()
    active = [True]
    args = context(owner, current=lambda: active[0], read_current=lambda completed: completed)
    assert sink.offer_completed_answer(**args)
    assert not sink.offer_completed_answer(**args)
    sink._rooms["kitchen"]["selection_offered"] = True
    assert not sink.offer_completed_answer(**{**args, "response_id": "other"})
    sink.complete("kitchen", owner, "session", 1)
    active[0] = False
    assert sink.snapshot("kitchen", owner)["readOnlyCompleted"] is True
    sink.revoke("kitchen", owner, "session", 1)
    assert not sink.snapshot("kitchen", owner)["items"]


@pytest.mark.parametrize("family", ["fact-card", "chart"])
def test_generated_facts_and_chart_numbers_never_fabricate_a_concise_fallback(family):
    owner, sink = object(), VisualReceiptOwner()
    assert not sink.offer_completed_answer(**context(owner, message=json.dumps(message(family))))
    assert sink.snapshot("kitchen", owner)["items"] == []
    assert sink._history == {}


def test_missing_or_tampered_pinned_asset_does_not_publish_an_image(monkeypatch):
    import gatekeeper.podview_presentation as producer

    monkeypatch.setattr(producer, "owned_image_sources", lambda: {})
    owner, sink = object(), VisualReceiptOwner()
    assert not sink.offer_completed_answer(
        **context(owner, message=json.dumps(message("sourced-image")))
    )
    assert sink.snapshot("kitchen", owner)["items"] == []
    assert sink._history == {}


@pytest.mark.parametrize(
    ("temperatures", "unit"),
    [
        ([-5.2], "°C"),
        ([-5.2, 3.1], "°C"),
        ([-12.0, -5.2], "°C"),
        ([0.0], "°C"),
        ([-2.2, 32.0], "°F"),
    ],
)
def test_source_negative_temperature_does_not_rewrite_value_to_fit_chart(
    monkeypatch, temperatures, unit
):
    weather = weather_payload(2)
    stamp = datetime.fromisoformat(weather["data"]["result"]["retrieved_at"]).timestamp()
    monkeypatch.setattr(time, "time", lambda: stamp)
    owner, sink = object(), VisualReceiptOwner()
    calls = []
    source_values = []
    for index, value in enumerate(temperatures):
        current = weather_payload(2)
        current["data"]["result"].update(
            temperature=value, temperature_unit=unit, location=f"Måling {index}"
        )
        call_id = f"weather-{index}"
        calls.append(call_id)
        assert sink.offer(
            owner,
            room_id="kitchen",
            session_id="session",
            session_epoch=1,
            turn_id="live:1:source",
            provider_generation=1,
            task_id="answer:delegation",
            input_revision=1,
            call_id=call_id,
            tool_name="weather_forecast",
            result=current,
            current=lambda: True,
            read_current=lambda completed: True,
            delegation_id="delegation",
        )
        source_values.append(current["data"]["result"]["temperature"])
    final = message("chart")
    final["presentation"].update(
        origin="owner_sources",
        sourceCalls=calls,
        content={"items": [{"callId": call, "field": "temperature"} for call in calls]},
    )
    assert sink.offer_completed_answer(**context(owner, message=json.dumps(final)))
    row = sink.snapshot("kitchen", owner)["items"][0]
    assert row["family"] == "chart"
    assert [item["value"] for item in row["content"]["items"]] == temperatures == source_values
    assert row["content"]["unit"] == row["content"]["unitSingular"] == unit
    records = sink._rooms["kitchen"]["source_registry"]
    assert row["provenance"] == {
        "kind": "owner_sources",
        "receiptIds": [records[call]["item"]["receiptId"] for call in calls],
    }
    assert [
        records[call]["weather"]["data"]["current"]["temperature"] for call in calls
    ] == temperatures
    source = sink.source("kitchen", row["receiptId"], owner)
    assert all(
        f"Måling {index}: {value} {unit}" in source["sourceText"]
        for index, value in enumerate(temperatures)
    )


def test_weather_wire_expiry_does_not_exceed_millisecond_source_clock(monkeypatch):
    from gatekeeper.podview_receipts import _facts

    weather = weather_payload()
    stamp = datetime.fromisoformat(weather["data"]["result"]["retrieved_at"])
    precise = stamp.replace(microsecond=123456)
    weather["data"]["result"]["retrieved_at"] = precise.isoformat()
    monkeypatch.setattr(time, "time", lambda: precise.timestamp())
    provenance = _facts("weather_forecast", weather)[3]
    assert provenance["validUntil"] * 1000 <= int(precise.timestamp() * 1000) + 900000


@pytest.mark.parametrize(
    "question", [None, "Lav italiensk tomatsuppe", "Hvilken cykel skal jeg købe?"]
)
def test_model_bicycle_title_cannot_authorize_unrelated_or_missing_user_context(question):
    owner, sink = object(), VisualReceiptOwner()
    data = message("sourced-image")
    data["presentation"].update(title="Cyklens kæde", summary="Cyklens pedaler og baghjul")
    assert not sink.offer_completed_answer(
        **context(owner, message=json.dumps(data), question_context=question)
    )
    assert sink.snapshot("kitchen", owner)["items"] == []
    assert sink._history == {}


def test_unrelated_context_removes_optional_diagram_illustration_only():
    owner, sink = object(), VisualReceiptOwner()
    data = message("simple-diagram")
    data["presentation"]["content"] = {
        **data["presentation"]["content"],
        "ownedImage": "bicycle_drivetrain",
    }
    assert sink.offer_completed_answer(
        **context(owner, message=json.dumps(data), question_context="Forklar en tomatplante")
    )
    row = sink.snapshot("kitchen", owner)["items"][0]
    assert row["family"] == "simple-diagram" and "illustration" not in row["content"]


@pytest.mark.parametrize(
    "raw",
    [
        "Musikken spiller nu.",
        "Timeren er startet.",
        "Tak, vi tales ved.",
        "En lang talt forklaring uden udtrykkeligt valgt visuelt indhold. " * 6,
        json.dumps({"spoken": "Rengøringen er sat i gang.", "presentation": None}),
        "{malformed}",
        json.dumps({"spoken": "Modtaget.", "presentation": {"family": "unknown"}}),
    ],
)
def test_spoken_only_null_acknowledgements_and_malformed_output_never_create_visual_or_history(raw):
    owner, sink = object(), VisualReceiptOwner()
    assert not sink.offer_completed_answer(**context(owner, message=raw))
    assert sink.snapshot("kitchen", owner)["items"] == []
    assert sink._history == {} and sink._selection is None
    if not raw.startswith("{"):
        assert final_message(raw) == {"spoken": raw, "presentation": None}


@pytest.mark.parametrize(
    "raw_content",
    [
        {},
        {"visualValue": "acknowledgement"},
        {"visualValue": True},
        {"visualValue": "reference", "automatic": True},
    ],
)
def test_concise_requires_closed_explicit_reference_judgment(raw_content):
    owner, sink = object(), VisualReceiptOwner()
    data = message("concise")
    data["spoken"] = "Musikken spiller nu."
    data["presentation"]["summary"] = data["spoken"]
    data["presentation"]["content"] = raw_content
    raw = json.dumps(data)
    assert (
        final_message(raw)["spoken"] == data["spoken"]
    )  # Declining the visual keeps voice extraction.
    assert not sink.offer_completed_answer(**context(owner, message=raw))
    assert sink.snapshot("kitchen", owner)["items"] == []
    assert sink._history == {}


@pytest.mark.parametrize(
    "summary",
    [
        "A → B",
        "Varme udvider luften; afkøling får den til at trække sig sammen. Sæt forsøget op, så beholderen er åben.",
    ],
)
def test_useful_explicit_concise_reference_uses_same_registered_renderer_without_length_heuristic(
    summary,
):
    owner, sink = object(), VisualReceiptOwner()
    data = message("concise")
    data["presentation"]["summary"] = summary
    assert sink.offer_completed_answer(**context(owner, message=json.dumps(data)))
    item = sink.snapshot("kitchen", owner)["items"][0]
    assert item["family"] == "concise" and item["displaySuggested"] is True
    assert item["content"]["summary"] == summary
    assert set(item["content"]) == {"summary", "sources"}  # Admission signal is not a new UI shape.
    assert sink._history["kitchen"]["items"][0]["display"]["content"] == item["content"]


def test_spoken_followup_decline_preserves_existing_useful_answer_and_archive():
    import copy

    owner, sink = object(), VisualReceiptOwner()
    assert sink.offer_completed_answer(**context(owner, message=json.dumps(message("steps"))))
    before = copy.deepcopy(sink.snapshot("kitchen", owner))
    archive = copy.deepcopy(sink._history["kitchen"], {id(owner): owner})
    assert not sink.offer_completed_answer(
        **context(owner, response_id="spoken-ack", message="Ja, timeren er startet.")
    )
    assert sink.snapshot("kitchen", owner) == before
    assert sink._history["kitchen"] == archive


@pytest.mark.parametrize(
    "family,content",
    [
        ("comparison", {"columns": ["A"], "items": []}),
        ("steps", {"steps": []}),
        ("choices", {"items": [{"label": "A"}]}),
        ("simple-diagram", {"nodes": []}),
    ],
)
def test_malformed_explicit_family_never_falls_back_to_spoken_text(family, content):
    owner, sink = object(), VisualReceiptOwner()
    data = message(family)
    data["presentation"]["content"] = content
    raw = json.dumps(data)
    assert final_message(raw)["spoken"] == data["spoken"]
    assert not sink.offer_completed_answer(**context(owner, message=raw))
    assert sink.snapshot("kitchen", owner)["items"] == [] and sink._history == {}


def test_backend_instructions_reserve_visuals_for_semantic_added_value_without_an_extra_call():
    from gatekeeper.podview_presentation import BACKEND_PRESENTATION_INSTRUCTIONS

    assert 'concise content{visualValue:"reference"}' in BACKEND_PRESENTATION_INSTRUCTIONS
    assert "presentation:null" in BACKEND_PRESENTATION_INSTRUCTIONS
    assert "kommando-kvittering" in BACKEND_PRESENTATION_INSTRUCTIONS
    assert "konkret visuel merværdi" in BACKEND_PRESENTATION_INSTRUCTIONS
    assert "Ingen ekstra modelrunde" in BACKEND_PRESENTATION_INSTRUCTIONS


@pytest.mark.parametrize("failure", ["missing", "tampered"])
def test_real_owned_webp_asset_must_exist_and_match_pin(monkeypatch, failure):
    from pathlib import Path

    import gatekeeper.podview_presentation as producer

    original = Path.read_bytes

    def read(path):
        if path.name == "bicycle-drivetrain-illustration.webp":
            if failure == "missing":
                raise FileNotFoundError("inert missing asset")
            return b"wrong asset bytes"
        return original(path)

    monkeypatch.setattr(Path, "read_bytes", read)
    assert producer.owned_image_sources() == {}
    owner, sink = object(), VisualReceiptOwner()
    assert not sink.offer_completed_answer(
        **context(owner, message=json.dumps(message("sourced-image")))
    )
    assert sink.snapshot("kitchen", owner)["items"] == [] and not sink._history
