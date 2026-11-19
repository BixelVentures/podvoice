"""Find musik AI shelves through the existing mood selector, budget and provider client."""

import json

import httpx

from gatekeeper.podview_enrichment import MODEL, RequestAllowance
from gatekeeper.podview_mood import MoodSelector
from gatekeeper.provider_budget import ProviderBudgetCoordinator

FACTS = {
    "slots": ["moment", "artist", "daypart", "season"],
    "weekday": "torsdag",
    "dayPart": "afternoon",
    "hour": 14,
    "date": "2026-11-19",
    "season": "efterår",
    "daysToChristmas": 35,
    "weather": {"condition": "rainy", "temperature": 8},
    "topArtists": ["Nina Simone"],
}


def answer(shelves):
    text = json.dumps({"shelves": shelves})
    return httpx.Response(
        200,
        json={
            "status": "completed",
            "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
        },
    )


def selector(client, allowance):
    value = MoodSelector(
        client, "inert-key", MODEL, allowance=allowance, budget=ProviderBudgetCoordinator()
    )
    value.room_kind = "kitchen"
    return value


GOOD = [
    {
        "slot": "moment",
        "title": " Til en regnvejrs-torsdag ",
        "basis": ["weather", "weekday", "weekday"],
        "queries": ["rainy day jazz", "rainy day jazz", "cozy acoustic"],
    }
]


async def test_one_budgeted_call_with_only_coarse_facts(tmp_path):
    seen = []

    def receive(request):
        body = json.loads(request.content)
        seen.append(body)
        assert json.loads(body["input"][1]["content"]) == FACTS
        assert body["store"] is False and "tools" not in body
        schema = body["text"]["format"]["schema"]["properties"]["shelves"]["items"]
        assert schema["properties"]["slot"]["enum"] == FACTS["slots"]
        return answer(GOOD)

    async with httpx.AsyncClient(transport=httpx.MockTransport(receive)) as client:
        owner = selector(client, RequestAllowance.prepare(tmp_path / "mood", 1, purpose="mood"))
        result = await owner.shelves(FACTS, current=lambda: True)
        assert result == [
            {
                "slot": "moment",
                "title": "Til en regnvejrs-torsdag",
                "basis": ["weather", "weekday"],
                "queries": ["rainy day jazz", "cozy acoustic"],
            }
        ]
        # The allowance is spent: no second call, no fabricated answer.
        assert await owner.shelves(FACTS, current=lambda: True) is None
        assert len(seen) == 1


async def test_unknown_facts_unavailable_budget_or_stale_owner_never_call():
    hits = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: hits.append(request))
    ) as client:
        owner = selector(client, RequestAllowance(1))
        assert await owner.shelves({**FACTS, "history": ["x"]}, current=lambda: True) is None
        assert await owner.shelves({**FACTS, "slots": ["radio"]}, current=lambda: True) is None
        assert await owner.shelves(FACTS, current=lambda: False) is None
        empty = selector(client, RequestAllowance(0))
        assert await empty.shelves(FACTS, current=lambda: True) is None
    assert hits == []


async def test_out_of_contract_model_output_is_rejected(tmp_path):
    bad = [
        [{**GOOD[0], "slot": "radio"}],
        [{**GOOD[0], "basis": ["mood"]}],
        [{**GOOD[0], "queries": []}],
        [{**GOOD[0], "title": "x" * 60}],
        [{**GOOD[0], "extra": 1}],
        [GOOD[0], GOOD[0]],
    ]
    for index, shelves in enumerate(bad):
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request, shelves=shelves: answer(shelves))
        ) as client:
            allowance = RequestAllowance.prepare(tmp_path / f"m{index}", 1, purpose="mood")
            owner = selector(client, allowance)
            assert await owner.shelves(FACTS, current=lambda: True) is None
