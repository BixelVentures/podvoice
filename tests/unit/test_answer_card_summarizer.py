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
    owner, store, call_id="search-1", text="Barcelona slog Sevilla 3-1. Lewandowski scorede."
):
    binding = context(owner)
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
        question="Hvem vandt FC Barcelonas kamp i går?",
    )


async def settle(store):
    for task in list(store._card_tasks.values()):
        await task


async def test_search_result_gives_a_sport_card_in_parallel_and_in_history():
    owner, store = object(), VisualReceiptOwner()
    fake = FakeSummarizer(SPORT)
    store.configure_card_summarizer(fake)
    assert search(owner, store)
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
        assert search(owner, store, call_id=f"search-{n}", text=f"Kilde {n}: Barcelona 3-1.")
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
    assert search(owner, store)
    await settle(store)
    assert store.snapshot("kitchen", owner)["items"] == []
    assert store._history == {}


async def test_topic_card_is_a_heading_with_keywords_not_sentences():
    owner, store = object(), VisualReceiptOwner()
    topic = {**SPORT, "kind": "emne", "title": "Månelandingen", "match": None, "points": ["1969"]}
    store.configure_card_summarizer(FakeSummarizer(topic))
    assert search(owner, store)
    await settle(store)
    item = store.snapshot("kitchen", owner)["items"][0]
    assert item["family"] == "key-points" and item["title"] == "Månelandingen"
    assert [p["text"] for p in item["content"]["points"]] == ["1969"]


async def test_without_a_summarizer_a_search_shows_no_card():
    owner, store = object(), VisualReceiptOwner()
    assert search(owner, store)
    assert store._card_tasks == {}
    assert store.snapshot("kitchen", owner)["items"] == []
