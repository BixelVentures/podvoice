"""Synthetic provider only: purpose/budget gate and closed model input/output."""

import json

import httpx
import pytest

from gatekeeper.podview_enrichment import MODEL, RequestAllowance
from gatekeeper.podview_mood import MoodSelector, configured_mood_selector
from gatekeeper.provider_budget import ProviderBudgetCoordinator


def response(ids):
    return httpx.Response(
        200,
        json={
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": json.dumps({"theme_ids": ids})}],
                }
            ],
        },
    )


async def test_real_selector_sends_only_coarse_context_and_owned_themes(tmp_path):
    seen = []

    def receive(request):
        body = json.loads(request.content)
        public = json.loads(body["input"][1]["content"])
        assert set(public) == {"hour", "dayPart", "roomKind", "themes"}
        assert public["dayPart"] == "evening"
        assert {row["id"] for row in public["themes"]} == {
            "morning_acoustic",
            "evening_jazz",
            "cooking",
            "italian",
            "indie",
            "calm",
        }
        assert all(set(theme) == {"id", "title"} for theme in public["themes"])
        assert "spotify" not in body["input"][1]["content"].lower()
        assert body["store"] is False and "tools" not in body
        seen.append(body)
        return response(["cooking", "italian", "calm"])

    async with httpx.AsyncClient(transport=httpx.MockTransport(receive)) as client:
        selector = MoodSelector(
            client,
            "inert-key",
            MODEL,
            allowance=RequestAllowance.prepare(tmp_path / "mood", 1, purpose="mood"),
            budget=ProviderBudgetCoordinator(),
        )
        selector.room_kind = "kitchen"
        assert await selector.select({"hour": 18, "roomKind": "kitchen"}, current=lambda: True) == [
            "cooking",
            "italian",
            "calm",
        ]
        assert (
            await selector.select({"hour": 18, "roomKind": "kitchen"}, current=lambda: True) is None
        )
        assert len(seen) == 1


async def test_selector_extra_spotify_fields_no_allowance_or_stale_owner_never_calls(tmp_path):
    hits = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: hits.append(request))
    ) as client:
        selector = MoodSelector(
            client,
            "inert-key",
            MODEL,
            allowance=RequestAllowance(1),
            budget=ProviderBudgetCoordinator(),
        )
        selector.room_kind = "kitchen"
        for content in (
            {"hour": 18, "roomKind": "kitchen", "playlists": []},
            {"hour": True, "roomKind": "kitchen"},
            {"hour": 18, "roomKind": "other"},
        ):
            assert await selector.select(content, current=lambda: True) is None
        assert (
            await selector.select({"hour": 18, "roomKind": "kitchen"}, current=lambda: False)
            is None
        )
        selector.allowance = None
        assert (
            await selector.select({"hour": 18, "roomKind": "kitchen"}, current=lambda: True) is None
        )
        assert hits == []


@pytest.mark.parametrize("ids", [["cooking"] * 3, ["cooking", "italian", "invented"], ["cooking"]])
async def test_model_cannot_generate_playlist_or_invent_owned_theme(ids):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: response(ids))
    ) as client:
        selector = MoodSelector(
            client,
            "inert-key",
            MODEL,
            allowance=RequestAllowance(1),
            budget=ProviderBudgetCoordinator(),
        )
        selector.room_kind = "kitchen"
        assert (
            await selector.select({"hour": 18, "roomKind": "kitchen"}, current=lambda: True) is None
        )


def test_separate_mood_purpose_marker_rejects_existing_visual_allowance(tmp_path):
    path = tmp_path / "budget"
    assert RequestAllowance.prepare(path, 1) is not None
    assert RequestAllowance.prepare(path, 2, purpose="mood") is None
    old = '{"model":"gpt-6-luna","max_requests":20}'
    assert configured_mood_selector(None, "key", old, tmp_path / "new") is None


async def test_coarse_time_uses_existing_ha_owner_and_drops_every_other_field():
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from gatekeeper.tools import ToolRouter

    router = ToolRouter(None)
    router.podview_mood_selector = SimpleNamespace(room_kind="kitchen")
    router.declarations = lambda: [{"name": "GetDateTime"}]
    owner = SimpleNamespace(
        call_tool=AsyncMock(
            return_value={
                "structuredContent": {
                    "time": "18:21:00",
                    "private": "NEVER_MODEL",
                    "date": "2026-10-15",
                }
            }
        )
    )
    router._mcp = owner
    assert await router.podview_mood_context(lambda: True) == {"hour": 18, "roomKind": "kitchen"}
    assert owner.call_tool.await_args.args == ("GetDateTime", {})
    owner.call_tool.return_value = {"structuredContent": {"time": "invented"}}
    assert await router.podview_mood_context(lambda: True) is None
    assert await router.podview_mood_context(lambda: False) is None


@pytest.mark.parametrize(
    ("hour", "period"), [(7, "morning"), (14, "afternoon"), (20, "evening"), (2, "night")]
)
async def test_daypart_guides_model_with_owned_six_theme_schema_only(hour, period):
    def receive(request):
        body = json.loads(request.content)
        public = json.loads(body["input"][1]["content"])
        assert public["dayPart"] == period and public["hour"] == hour
        assert set(public) == {"hour", "roomKind", "dayPart", "themes"}
        prompt = body["input"][0]["content"]
        assert all(
            term in prompt
            for term in (
                "morning",
                "afternoon",
                "evening",
                "explicit refresh",
                "not mandatory rotations",
            )
        )
        allowed = body["text"]["format"]["schema"]["properties"]["theme_ids"]["items"]["enum"]
        assert len(allowed) == 6 and "morning_acoustic" in allowed and "evening_jazz" in allowed
        assert "Jack Johnson" not in json.dumps(public) and "spotify:" not in json.dumps(public)
        return response(["morning_acoustic", "evening_jazz", "calm"])

    async with httpx.AsyncClient(transport=httpx.MockTransport(receive)) as client:
        selector = MoodSelector(
            client,
            "inert-key",
            MODEL,
            allowance=RequestAllowance(1),
            budget=ProviderBudgetCoordinator(),
        )
        selector.room_kind = "kitchen"
        assert await selector.select(
            {"hour": hour, "roomKind": "kitchen"}, current=lambda: True
        ) == ["morning_acoustic", "evening_jazz", "calm"]
