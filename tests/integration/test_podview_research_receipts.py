"""Inactive opt-in uses existing successful tool receipt hooks and ingress routes."""

import asyncio
import json
import subprocess
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration import test_podview_receipt_hooks as hooks
from integration.test_podview_bridge import owner
from unit.test_podview_receipts import offer, selected_store
from unit.test_weather_result import weather_payload

from gatekeeper import podview_weather
from gatekeeper.hub import StatusHub
from gatekeeper.podview_receipts import VisualReceiptOwner
from gatekeeper.weather_result import compact_weather_result
from gatekeeper.web import create_app


@pytest.mark.parametrize("surface", ["voicepe", "talk", "live"])
@pytest.mark.parametrize("outcome", ["current", "failed", "session", "revision", "sink_failed"])
async def test_completed_conversation_active_search_reused_after_ack_no_repeat(
    surface, outcome, monkeypatch
):
    def factory(**kwargs):
        store = selected_store(**kwargs)
        store.configure_research_mode("completed_receipts_v1")
        return store

    monkeypatch.setattr(hooks, "selected_store", factory)
    # Actual Thin native/GPT Live successful-submission paths; no new semantic
    # producer/question engine, no duplicate Google read or additional model call.
    await hooks.test_receipts_follow_actual_successful_current_submission(surface, outcome)


async def test_empty_opt_in_preserves26_and_invalid_policy_or_no_selector_disabled():
    store = VisualReceiptOwner()
    store.configure_research_mode("completed_receipts_v1")
    assert not store.research_enabled
    store = selected_store()
    assert not store.research_enabled
    store.configure_research_mode("unknown")
    assert not store.research_enabled
    store.configure_research_mode("completed_receipts_v1")
    assert store.research_enabled
    assert offer(store)
    with pytest.raises(RuntimeError):
        store.configure_research_mode("")
    await store._selection


@pytest.mark.parametrize("family", ["weather", "web"])
async def test_real_source_to_actual_ingress_native_union_and_source_view(family, monkeypatch):
    session, _ = owner()
    alive = [True]
    store = selected_store()
    store.configure_research_mode("completed_receipts_v1")
    original = weather_payload()
    stamp = datetime.fromisoformat(original["data"]["result"]["retrieved_at"]).timestamp()
    monkeypatch.setattr(podview_weather.time, "time", lambda: stamp)
    tool = "weather_forecast" if family == "weather" else "google_web_sogning"
    result = (
        compact_weather_result(tool, original)
        if family == "weather"
        else {
            "ok": True,
            "data": {
                "success": True,
                "result": {"output": "Actual externally returned useful search text, unchanged."},
            },
        }
    )
    assert offer(
        store,
        owner=session,
        session_id="s1",
        tool_name=tool,
        result=result,
        current=lambda: alive[0],
    )
    await store._selection
    tools = SimpleNamespace(podview_receipts=store)
    app = create_app(StatusHub(), {"kitchen": session, "bedroom": owner()[0]}, tools=tools)
    async with TestClient(TestServer(app)) as client:
        snapshot = await (await client.get("/view/api/snapshot?room=kitchen")).json()
        assert snapshot["capabilities"]["researchVisual"] is True
        answers = await (await client.get("/view/api/answers?room=kitchen")).json()
        row = answers["items"][0]
        assert row["family"] == ("answer-timeline" if family == "weather" else "fact-card")
        assert row["answerRevision"] == snapshot["answers"]["answerRevision"] == answers["revision"]
        path = "/view/api/sources/" + row["receiptId"]
        source = await (await client.get(path + "?room=kitchen")).json()
        assert source["schema"] == "podview.research.source.v1"
        assert (await client.get(path + "?room=bedroom")).status == 404
        assert (
            await client.get(path + "?room=kitchen", headers={"Sec-Fetch-Site": "cross-site"})
        ).status == 403
        if family == "weather":
            assert source["provenance"]["coverage"]["totalRows"] == 48
            assert source["provenance"]["coverage"]["truncated"] is True
        else:
            assert source["sourceText"] == result["data"]["result"]["output"]
            assert source["externalSourcesProvided"] is False
        module = Path(__file__).parents[2] / "podvoice/gatekeeper/static/podview/owner-answers.js"
        script = f"""import {{ownedAnswers,ownedSource}} from {json.dumps(module.as_uri())};
let input='';for await(const chunk of process.stdin) input+=chunk;
const {{answers,snapshot,source,now}}=JSON.parse(input);
const answer=ownedAnswers(answers,snapshot,0,now).items[0];
const detail=ownedSource(source,answer.receiptId,now,snapshot);
if(answer.kind!==source.family||detail.validUntil!==answer.validUntil)process.exit(1);
const bad={{...snapshot,answers:{{...snapshot.answers,answerRevision:snapshot.answers.answerRevision+1}}}};
let rejected=false;try{{ownedSource(source,answer.receiptId,now,bad)}}catch{{rejected=true}}
if(!rejected)process.exit(2);"""
        checked = await asyncio.to_thread(
            subprocess.run,
            ["node", "--input-type=module", "-e", script],
            input=json.dumps(
                dict(answers=answers, snapshot=snapshot, source=source, now=stamp * 1000)
            ),
            text=True,
            capture_output=True,
            # This is a host-process budget for starting Node, not a product-latency assertion.
            timeout=30,
            check=False,
        )
        assert checked.returncode == 0, checked.stderr
        alive[0] = False
        assert (await client.get(path + "?room=kitchen")).status == 404
        assert (await (await client.get("/view/api/answers?room=kitchen")).json())["items"] == []


async def test_richer_cards_and_sources_require_ai_admission_and_stale_selection_fails():
    class Decline:
        available = True

        async def select(self, *args, **kwargs):
            return None

    store = VisualReceiptOwner()
    store.configure_selector(Decline())
    store.configure_research_mode("completed_receipts_v1")
    assert offer(
        store, result={"ok": True, "data": {"output": "Long actual source answer useful to keep."}}
    )
    await store._selection
    assert store.snapshot("kitchen")["items"] == []
    assert store.source("kitchen", store._rooms["kitchen"]["items"][0]["item"]["receiptId"]) is None
    store.close()


async def test_admitted_research_format_survives_selector_allowance_exhaustion():
    class Selector:
        available = True

        async def select(self, data, **kwargs):
            self.available = False
            return {"family": "fact-card", "content": data}

    selector = Selector()
    store = VisualReceiptOwner()
    store.configure_selector(selector)
    store.configure_research_mode("completed_receipts_v1")
    assert offer(store, result={"ok": True, "data": {"output": "An actual excerpt"}})
    await store._selection
    assert store.research_admitted and not store.research_enabled
    item = store.snapshot("kitchen")["items"][0]
    assert item["content"]["facts"][0]["value"] == "An actual excerpt"
    assert store.source("kitchen", item["receiptId"]) is not None


async def test_existing_selector_exact_budget_http_contract_selects_original_forecast_ids(
    monkeypatch,
):
    import httpx
    from unit.test_podview_visual_value import result

    from gatekeeper.podview_enrichment import MODEL, RequestAllowance, VisualSelector
    from gatekeeper.provider_budget import ProviderBudgetCoordinator

    original = weather_payload()
    stamp = datetime.fromisoformat(original["data"]["result"]["retrieved_at"]).timestamp()
    monkeypatch.setattr(podview_weather.time, "time", lambda: stamp)
    calls = []

    def respond(request):
        body = json.loads(request.content)
        assert body["model"] == MODEL and body["max_output_tokens"] == 256
        assert len(request.content) <= 4096 and "tools" not in body
        candidates = json.loads(body["input"][1]["content"])["facts"]
        assert len(candidates) == 6 and all(f["id"].startswith("period:") for f in candidates)
        calls.append(body)
        # Reverse model order cannot reverse the real forecast chronology.
        return result({"show": True, "fact_ids": [candidates[2]["id"], candidates[0]["id"]]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        allowance = RequestAllowance(1)
        selector = VisualSelector(
            client, "synthetic-key", MODEL, allowance=allowance, budget=ProviderBudgetCoordinator()
        )
        store = VisualReceiptOwner()
        store.configure_selector(selector)
        store.configure_research_mode("completed_receipts_v1")
        packed = compact_weather_result("weather_forecast", original)
        actor = object()
        assert offer(store, owner=actor, tool_name="weather_forecast", result=packed)
        await store._selection
        item = store.snapshot("kitchen")["items"][0]
        assert [e["id"] for e in item["content"]["events"]] == ["period:0", "period:2"]
        assert len(calls) == 1 and allowance.remaining == 0
        assert item["family"] == "answer-timeline" and store.research_admitted
        assert not offer(store, owner=actor, tool_name="weather_forecast", result=packed)
        assert len(calls) == 1
