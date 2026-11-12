"""Sport and fact cards from one parallel model call; never a transcript, never a delay."""

import asyncio

import pytest
from unit.test_podview_presentation import context

from gatekeeper.podview_enrichment import card_presentation
from gatekeeper.podview_receipts import VisualReceiptOwner

SPORT = {
    "kind": "sport",
    "title": "FC Barcelona mod Sevilla",
    "summary": "Barcelona vandt 3-1 hjemme",
    "match": {
        "home": "FC Barcelona",
        "away": "Sevilla",
        "homeScore": 3,
        "awayScore": 1,
        "date": "11. november 2026",
        "competition": "La Liga",
    },
    "scorers": [
        {"team": "home", "name": "Lewandowski", "minute": "12'"},
        {"team": "away", "name": "Lukébakio", "minute": None},
    ],
    "points": [],
}


class FakeSummarizer:
    available = True

    def __init__(self, card):
        self.card, self.calls = card, []

    async def summarize(self, question, sources):
        self.calls.append((question, sources))
        await asyncio.sleep(0)
        return card_presentation(self.card)


def search(
    owner,
    store,
    call_id="search-1",
    text="Barcelona slog Sevilla 3-1. Lewandowski scorede.",
    question="Hvem vandt FC Barcelonas kamp i går?",
    **changes,
):
    binding = context(owner, **changes)
    return store.offer(
        owner,
        room_id="kitchen",
        session_id=binding["session_id"],
        session_epoch=binding["session_epoch"],
        turn_id=binding["turn_id"],
        provider_generation=binding["provider_generation"],
        task_id=binding["task_id"],
        input_revision=binding["input_revision"],
        call_id=call_id,
        tool_name="google_web_sogning",
        result={"ok": True, "data": {"success": True, "result": {"output": text}}},
        current=lambda: True,
        read_current=lambda completed: True,
        delegation_id=binding["delegation_id"],
        question=question,
    )


async def settle(store):
    for task in list(store._card_tasks.values()):
        await task


async def test_search_result_gives_a_sport_card_in_parallel_and_in_history():
    owner, store = object(), VisualReceiptOwner()
    fake = FakeSummarizer(SPORT)
    store.configure_card_summarizer(fake)
    search(owner, store)
    await settle(store)
    item = store.snapshot("kitchen", owner)["items"][0]
    assert item["family"] == "sport-result" and item["displaySuggested"] is True
    assert item["content"]["match"]["homeScore"] == 3
    assert [r["team"] for r in item["content"]["scorers"]] == ["home", "away"]
    assert item["content"]["sources"][0]["label"] == "Google-søgning, opsummeret af PodVoice"
    assert store._history["kitchen"]["items"][0]["display"]["family"] == "sport-result"
    question, sources = fake.calls[0]
    assert question == "Hvem vandt FC Barcelonas kamp i går?"
    assert "Lewandowski" in str(sources)


async def test_several_searches_in_one_answer_give_one_card():
    owner, store = object(), VisualReceiptOwner()
    fake = FakeSummarizer(SPORT)
    store.configure_card_summarizer(fake)
    for n in range(4):
        search(owner, store, call_id=f"search-{n}", text=f"Kilde {n}: Barcelona 3-1.")
    await settle(store)
    assert len(fake.calls) == 1 and len(fake.calls[0][1]) == 4
    assert len(store.snapshot("kitchen", owner)["items"]) == 1
    assert len(store._history["kitchen"]["items"]) == 1


@pytest.mark.parametrize(
    "card",
    [
        {**SPORT, "kind": "ingen"},
        {**SPORT, "kind": "fakta", "points": []},
        {**SPORT, "kind": "sport", "match": None},
    ],
)
async def test_no_honest_basis_means_no_card(card):
    owner, store = object(), VisualReceiptOwner()
    store.configure_card_summarizer(FakeSummarizer(card))
    search(owner, store)
    await settle(store)
    assert store.snapshot("kitchen", owner)["items"] == []
    assert store._history == {}


async def test_topic_card_is_a_heading_with_keywords_not_sentences():
    owner, store = object(), VisualReceiptOwner()
    topic = {**SPORT, "kind": "emne", "title": "Månelandingen", "match": None, "points": ["1969"]}
    store.configure_card_summarizer(FakeSummarizer(topic))
    search(owner, store)
    await settle(store)
    item = store.snapshot("kitchen", owner)["items"][0]
    assert item["family"] == "key-points" and item["title"] == "Månelandingen"
    assert [p["text"] for p in item["content"]["points"]] == ["1969"]


async def test_without_a_summarizer_a_search_shows_no_card():
    owner, store = object(), VisualReceiptOwner()
    search(owner, store)
    assert store._card_tasks == {}
    assert store.snapshot("kitchen", owner)["items"] == []


async def test_long_live_web_result_still_starts_the_card_call(caplog):
    """Green 2.0.176: Live's own google_web_sogning result was long prose; it must still card."""
    caplog.set_level("INFO", logger="podvoice.podview")
    owner, store = object(), VisualReceiptOwner()
    fake = FakeSummarizer(SPORT)
    store.configure_card_summarizer(fake)
    long_text = (
        "FC Barcelona besejrede Sevilla med 3-1 på Estadi Olímpic Lluís Companys i går aftes, "
        "hvor Robert Lewandowski scorede to gange og Pedri lavede den første assist. " * 12
    )
    search(owner, store, text=long_text)
    await settle(store)
    assert fake.calls and len(fake.calls[0][1][0]["uddrag"]) <= 4000
    assert store.snapshot("kitchen", owner)["items"][0]["family"] == "sport-result"
    stages = [r.getMessage() for r in caplog.records if "podview card" in r.getMessage()]
    assert any("stage=start" in m for m in stages) and any("stage=publish" in m for m in stages)


async def test_missing_summarizer_is_logged_as_a_skip(caplog):
    caplog.set_level("INFO", logger="podvoice.podview")
    owner, store = object(), VisualReceiptOwner()
    search(owner, store)
    assert any("reason=no_summarizer" in r.getMessage() for r in caplog.records)


# Green 2.0.182: the follow-up "hvem scorede" logged stage=skip reason=ValueError and
# never reached the screen. Its card names the scorers but the model marks unknown
# fields with empty strings. A follow-up is a new section on the same card: a new
# history entry in the same conversation, which PodView threads under the first.
FOLLOW_UP = {
    **SPORT,
    "title": "Målscorere: Barcelona mod Sevilla",
    "summary": "Lewandowski scorede to gange",
    "match": {
        "home": "FC Barcelona",
        "away": "Sevilla",
        "homeScore": None,
        "awayScore": None,
        "date": "11. november 2026",
        "competition": "",
    },
    "scorers": [
        {"team": "home", "name": "Lewandowski", "minute": ""},
        {"team": "home", "name": "Pedri", "minute": "67'"},
    ],
}


async def ask_and_follow_up(store, owner, follow_up):
    store.configure_card_summarizer(FakeSummarizer(SPORT))
    search(owner, store)
    await settle(store)
    store.configure_card_summarizer(FakeSummarizer(follow_up))
    search(
        owner,
        store,
        call_id="search-2",
        text="Lewandowski scorede to gange, Pedri én.",
        question="Hvem scorede?",
        turn_id="live:2:response-final",
        input_revision=2,
        response_id="response-follow-up",
    )
    await settle(store)
    return store.history("kitchen", owner)["items"]


async def test_follow_up_extends_the_same_card_as_a_new_sport_section():
    owner, store = object(), VisualReceiptOwner()
    history = await ask_and_follow_up(store, owner, FOLLOW_UP)
    assert [item["family"] for item in history] == ["sport-result", "sport-result"]
    assert {item["sessionId"] for item in history} == {"session"}
    newest = history[0]["content"]
    assert [row["name"] for row in newest["scorers"]] == ["Lewandowski", "Pedri"]
    assert newest["match"]["competition"] is None and newest["scorers"][0]["minute"] is None
    assert store.snapshot("kitchen", owner)["items"][0]["family"] == "sport-result"


async def test_follow_up_that_fails_validation_still_adds_a_simple_section(caplog):
    caplog.set_level("INFO", logger="podvoice.podview")
    owner, store = object(), VisualReceiptOwner()
    broken = {**FOLLOW_UP, "match": {**FOLLOW_UP["match"], "date": ""}}
    history = await ask_and_follow_up(store, owner, broken)
    assert [item["family"] for item in history] == ["key-points", "sport-result"]
    assert {item["sessionId"] for item in history} == {"session"}
    section = history[0]
    assert section["title"] == "Målscorere: Barcelona mod Sevilla"
    points = [p["text"] for p in section["content"]["points"]]
    assert points == ["Lewandowski", "Pedri 67'", "Lewandowski scorede to gange"]
    assert "Lewandowski scorede to gange, Pedri én." not in str(section)  # never the source text
    assert store.snapshot("kitchen", owner)["items"][0]["family"] == "key-points"
    stages = [r.getMessage() for r in caplog.records if "podview card" in r.getMessage()]
    assert not any("stage=skip" in m for m in stages)


async def test_validation_failure_log_names_field_and_rule_but_no_content(caplog):
    caplog.set_level("INFO", logger="podvoice.podview")
    owner, store = object(), VisualReceiptOwner()
    broken = {**FOLLOW_UP, "match": {**FOLLOW_UP["match"], "date": ""}}
    await ask_and_follow_up(store, owner, broken)
    invalid = [r.getMessage() for r in caplog.records if "stage=invalid" in r.getMessage()]
    assert invalid == [
        "podview card stage=invalid room=kitchen family=sport-result field=match.date rule=empty"
    ]
    everything = " ".join(r.getMessage() for r in caplog.records)
    for content in ("Barcelona", "Sevilla", "Lewandowski", "Pedri", "Målscorere", "67"):
        assert content not in everything


async def test_card_without_any_usable_field_is_still_skipped_without_content(caplog):
    caplog.set_level("INFO", logger="podvoice.podview")
    owner, store = object(), VisualReceiptOwner()
    broken = {**FOLLOW_UP, "title": "<b>", "match": {**FOLLOW_UP["match"], "date": ""}}
    history = await ask_and_follow_up(store, owner, broken)
    assert [item["family"] for item in history] == ["sport-result"]
    messages = [r.getMessage() for r in caplog.records if "podview card" in r.getMessage()]
    assert any("field=match.date rule=empty" in m for m in messages)
    assert any("stage=skip room=kitchen reason=InvalidPresentationField" in m for m in messages)
