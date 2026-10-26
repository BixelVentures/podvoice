"""Bounded synthetic-only diagnostics; no provider or real budget operations."""

import asyncio
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from gatekeeper import mood_diagnostics as diag
from gatekeeper.podview_enrichment import MODEL, RequestAllowance
from gatekeeper.podview_mood import MoodSelector
from gatekeeper.provider_budget import ProviderBudgetCoordinator
from gatekeeper.tools import ToolRouter

SECRET = "NEVER_LOG_token_account_query_raw_ai"


def terminal(caplog):
    return [
        r.getMessage().split(" total_ms=", 1)[0]
        for r in caplog.records
        if r.name == "podvoice.mood"
    ]


def test_closed_fields_and_context_reset_even_if_log_handler_raises(caplog, monkeypatch):
    caplog.set_level(logging.INFO, logger="podvoice.mood")
    record, token = diag.begin()
    record.phase, record.outcome = [SECRET], {"private": SECRET}
    diag.note(SECRET, SECRET)
    diag.finish(record, token)
    assert terminal(caplog) == [
        "mood_result phase=other outcome=other reason=other http_status=none kind=mood"
    ]
    assert diag._CURRENT.get() is None
    record, token = diag.begin()
    monkeypatch.setattr(diag._LOG, "info", lambda *a: (_ for _ in ()).throw(ValueError(SECRET)))
    diag.finish(record, token)
    assert diag._CURRENT.get() is None and SECRET not in caplog.text


async def test_concurrent_contexts_never_mix_and_nested_task_inherits_only_own_attempt(caplog):
    caplog.set_level(logging.INFO, logger="podvoice.mood")
    entered, release = asyncio.Event(), asyncio.Event()

    async def first():
        record, token = diag.begin()
        record.phase = "model"
        entered.set()
        await release.wait()
        async with asyncio.TaskGroup() as group:
            group.create_task(async_note())
        diag.finish(record, token)

    async def async_note():
        diag.note("model_timeout")

    task = asyncio.create_task(first())
    await entered.wait()
    record, token = diag.begin()
    record.phase, record.outcome = "publish", "success"
    diag.finish(record, token)
    release.set()
    await task
    assert terminal(caplog) == [
        "mood_result phase=publish outcome=success reason=none http_status=none kind=mood",
        "mood_result phase=model outcome=mood_unavailable reason=model_timeout http_status=none kind=mood",
    ]
    assert diag._CURRENT.get() is None


@pytest.mark.parametrize(
    "mode,reason,status",
    [
        ("http", "provider_http", "400"),
        ("transport", "provider_transport", "none"),
        ("timeout", "model_timeout", "none"),
        ("parse", "model_parse", "none"),
        ("incomplete", "response_not_completed", "none"),
        ("messages", "response_messages_invalid", "none"),
    ],
)
async def test_actual_model_failure_is_classified_without_raw_error_or_extra_calls(
    caplog, mode, reason, status
):
    caplog.set_level(logging.INFO, logger="podvoice.mood")
    sends = []

    def receive(request):
        sends.append(request)
        if mode == "transport":
            raise httpx.ConnectError(SECRET, request=request)
        if mode == "timeout":
            raise TimeoutError(SECRET)
        if mode == "http":
            return httpx.Response(400, text=SECRET)
        if mode == "parse":
            return httpx.Response(200, content=SECRET.encode())
        return httpx.Response(
            200,
            json={"status": "incomplete" if mode == "incomplete" else "completed", "output": []},
        )

    record, token = diag.begin()
    record.phase = "model"
    allowance = RequestAllowance(1)
    async with httpx.AsyncClient(transport=httpx.MockTransport(receive)) as client:
        selector = MoodSelector(
            client, SECRET, MODEL, allowance=allowance, budget=ProviderBudgetCoordinator()
        )
        selector.room_kind = "kitchen"
        assert (
            await selector.select({"hour": 18, "roomKind": "kitchen"}, current=lambda: True) is None
        )
    diag.finish(record, token)
    assert len(sends) == 1 and allowance.remaining == 0
    assert terminal(caplog) == [
        f"mood_result phase=model outcome=mood_unavailable reason={reason} http_status={status} kind=mood"
    ]
    assert SECRET not in caplog.text and diag._CURRENT.get() is None


@pytest.mark.parametrize(
    "mode,reason",
    [
        ("mcp_missing", "time_owner_missing"),
        ("tool_missing", "time_tool_missing"),
        ("nested", "time_format_invalid"),
        ("bad_time", "time_format_invalid"),
    ],
)
async def test_actual_coarse_context_reports_only_failure_category(caplog, mode, reason):
    caplog.set_level(logging.INFO, logger="podvoice.mood")
    router = ToolRouter(None)
    router.podview_mood_selector = SimpleNamespace(room_kind="kitchen")
    router.declarations = lambda: [] if mode == "tool_missing" else [{"name": "GetDateTime"}]
    reply = (
        {"structuredContent": {"success": True, "result": {"time": SECRET}}}
        if mode == "nested"
        else {"structuredContent": {"time": SECRET}}
    )
    owner = SimpleNamespace(call_tool=AsyncMock(return_value=reply))
    router._mcp = None if mode == "mcp_missing" else owner
    record, token = diag.begin()
    record.phase = "time_context"
    assert await router.podview_mood_context(lambda: True) is None
    diag.finish(record, token)
    assert terminal(caplog) == [
        f"mood_result phase=time_context outcome=mood_unavailable reason={reason} http_status=none kind=mood"
    ]
    assert SECRET not in caplog.text
    assert owner.call_tool.await_count == (0 if mode in {"mcp_missing", "tool_missing"} else 1)


@pytest.mark.parametrize("after_await", [False, True])
async def test_valid_time_with_owner_loss_is_not_misreported_as_payload_error(caplog, after_await):
    caplog.set_level(logging.INFO, logger="podvoice.mood")
    router = ToolRouter(None)
    router.podview_mood_selector = SimpleNamespace(room_kind="kitchen")
    router.declarations = lambda: [{"name": "GetDateTime"}]
    alive = [after_await]

    async def result(*a, **k):
        alive[0] = False
        return {"structuredContent": {"time": "18:21:00"}}

    owner = SimpleNamespace(call_tool=AsyncMock(side_effect=result))
    router._mcp = owner
    record, token = diag.begin()
    record.phase = "time_context"
    assert await router.podview_mood_context(lambda: alive[0]) is None
    diag.finish(record, token)
    assert record.reason == "owner_changed"
    assert owner.call_tool.await_count == int(after_await)
    assert "time_result_invalid" not in caplog.text


def test_monotonic_phase_timings_are_bounded_closed_and_do_not_log_content(caplog):
    caplog.set_level(logging.INFO, logger="podvoice.mood")
    now = [10.0]
    record, token = diag.begin(clock=lambda: now[0])
    for instant, phase in [
        (10.125, "time_context"),
        (10.175, "model"),
        (10.875, "playlist_search"),
        (11.075, "playback_after"),
        (11.100, "publish"),
    ]:
        now[0] = instant
        record.step(phase)
    now[0] = 11.105
    record.outcome = "success"
    diag.finish(record, token)
    assert (
        caplog.records[-1]
        .getMessage()
        .endswith(
            "total_ms=1105 playback_before_ms=125 time_context_ms=50 model_ms=700 parallel_selection_search_ms=0 playlist_search_ms=200 playback_after_ms=25 publish_ms=5"
        )
    )
    assert len(caplog.records) == 1 and diag._CURRENT.get() is None
    record, token = diag.begin(clock=lambda: now[0])
    now[0] += 100
    record.step(SECRET)
    diag.finish(record, token)
    assert "total_ms=60000 playback_before_ms=60000" in caplog.records[-1].getMessage()
    assert SECRET not in caplog.text


@pytest.mark.parametrize("kind", ["mood", "feeling"])
@pytest.mark.parametrize(
    "suffix",
    [
        "owner_unavailable",
        "refresh_required",
        "budget_unavailable",
        "selection_unavailable",
        "catalogue_unavailable",
        "catalogue_empty",
        "owner_replaced",
        "source_rejected",
        "unavailable",
    ],
)
def test_tab_failure_outcomes_remain_distinct(caplog, kind, suffix):
    caplog.set_level(logging.INFO, logger="podvoice.mood")
    record, token = diag.begin(kind=kind)
    record.outcome = f"{kind}_{suffix}"
    diag.finish(record, token)
    assert f"outcome={kind}_{suffix}" in caplog.text
    assert f"kind={kind}" in caplog.text
    assert diag._CURRENT.get() is None


def test_tab_kind_is_closed_even_after_mutation(caplog):
    caplog.set_level(logging.INFO, logger="podvoice.mood")
    record, token = diag.begin(kind=SECRET)
    record.kind = [SECRET]
    diag.finish(record, token)
    assert "kind=other" in caplog.text and SECRET not in caplog.text


def test_parallel_selection_search_has_own_honest_phase(caplog):
    caplog.set_level(logging.INFO, logger="podvoice.mood")
    now = [10.0]
    record, token = diag.begin(clock=lambda: now[0])
    record.step("parallel_selection_search")
    now[0] += 2.5
    record.step("publish")
    diag.finish(record, token)
    text = caplog.records[-1].getMessage()
    assert "model_ms=0 parallel_selection_search_ms=2500 playlist_search_ms=0" in text
