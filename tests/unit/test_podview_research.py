"""Inactive source proposal: real adapter contract, owner races and finite admission."""

import asyncio
import copy
from dataclasses import replace
from types import SimpleNamespace

import pytest
from unit.test_weather_result import weather_payload

from gatekeeper.podview_enrichment import RequestAllowance
from gatekeeper.podview_research import (
    OwnerReadAdapter,
    ResearchBinding,
    ResearchOwner,
    ResearchPolicy,
    extract,
)


def binding(**kwargs):
    return ResearchBinding(
        **dict(
            dict(
                owner=object(),
                room="r0",
                session="s",
                session_epoch=1,
                turn="t",
                generation=1,
                task="answer:t",
                input_revision=1,
                answer_revision=1,
            ),
            **kwargs,
        )
    )


class MCP:
    initialized = True
    url = "http://ha/mcp_server/sse"

    def __init__(self):
        self.calls = []
        self.result = {
            "structuredContent": {"success": True, "result": {"output": "Actual excerpt"}}
        }
        self.before_result = lambda: None
        self.gate = None

    async def call_tool(self, name, args, *, execution_guard):
        assert execution_guard()
        self.calls.append((name, copy.deepcopy(args)))
        if self.gate:
            await self.gate.wait()
        self.before_result()
        return copy.deepcopy(self.result)


def router(tool="google_web_sogning"):
    declaration = {
        "name": tool,
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
            "additionalProperties": False,
        },
    }
    if tool != "google_web_sogning":
        declaration["parameters"] = {"type": "object", "additionalProperties": False}
    r = SimpleNamespace(_mcp=MCP(), _mcp_epoch=1)
    r._discovery = SimpleNamespace(
        mcp_tools=[declaration],
        mcp_names={tool},
        retry_state="ready",
        api_id="assist",
        endpoint=r._mcp.url,
    )
    r._mcp_api_id = lambda owner: "assist"
    r._safe_endpoint = lambda url: url
    r._podview_weather_declaration = lambda: declaration
    return r


def web_policy():
    return ResearchPolicy(frozenset({"google_web_sogning"}), True, 5_000)


def owner(r=None, **kwargs):
    return ResearchOwner(
        OwnerReadAdapter(r or router()),
        policy=web_policy(),
        allowance=RequestAllowance(6),
        **kwargs,
    )


async def complete(o):
    await asyncio.gather(*o._jobs)


def offer(o, b, published, **kwargs):
    return o.offer(
        b,
        tool="google_web_sogning",
        args={"query": "exact model query"},
        current=kwargs.get("current", lambda: True),
        publish=published.append,
    )


async def test_default_disabled_and_unknown_paid_helper_no_calls():
    r = router()
    o = ResearchOwner(OwnerReadAdapter(r))
    assert not offer(o, binding(), [])
    assert r._mcp.calls == []
    with pytest.raises(ValueError):
        ResearchPolicy(frozenset({"google_web_sogning"}))
    with pytest.raises(ValueError):
        ResearchPolicy(frozenset({"HassMediaSearchAndPlay"}))
    with pytest.raises(ValueError):
        ResearchPolicy(frozenset({"weather_forecast", "HassGetWeather"}))
    with pytest.raises(ValueError):
        ResearchOwner(OwnerReadAdapter(r), allowance=RequestAllowance(7))


async def test_real_native_mcp_adapter_fetches_exact_query_nonblocking_and_closed_excerpt():
    r, published, b = router(), [], binding()
    o = owner(r)
    assert offer(o, b, published)
    assert published == [] and r._mcp.calls == []  # no speech await or synchronous source send
    await complete(o)
    assert r._mcp.calls == [("google_web_sogning", {"query": "exact model query"})]
    item = published[0]
    assert item["family"] == "fact-card" and item["allowedActions"] == []
    assert item["content"]["facts"][0]["value"] == "Actual excerpt"
    source = o.source(b, item["receiptId"])
    assert source["sourceText"] == "Actual excerpt"
    assert source["provenance"]["externalSourcesProvided"] is False
    assert "url" not in str(item["content"]["sources"])
    assert o.source(replace(b, owner=object()), item["receiptId"]) is None
    assert o.source(replace(b, answer_revision=2), item["receiptId"]) is None


@pytest.mark.parametrize("change", ["owner", "epoch", "discovery", "schema", "endpoint", "ready"])
async def test_owner_adapter_revokes_same_name_or_equal_content_replacements(change):
    r = router()
    old = r._mcp

    def mutate():
        if change == "owner":
            r._mcp = MCP()
        if change == "epoch":
            r._mcp_epoch += 1
        if change == "discovery":
            r._discovery = copy.deepcopy(r._discovery)
        if change == "schema":
            r._discovery.mcp_tools[0]["parameters"]["minProperties"] = 2
        if change == "endpoint":
            old.url = "http://different"
        if change == "ready":
            r._discovery.retry_state = "failed"

    old.before_result = mutate
    o, published = owner(r), []
    assert offer(o, binding(), published)
    await complete(o)
    assert len(old.calls) == 1 and published == []


@pytest.mark.parametrize(
    "field,value",
    [
        ("session", "next"),
        ("turn", "next"),
        ("generation", 2),
        ("task", "next"),
        ("input_revision", 2),
        ("answer_revision", 2),
    ],
)
async def test_old_result_cannot_publish_after_current_owner_turn_replacement(field, value):
    r, published = router(), []
    state = [binding()]
    captured = state[0]
    r._mcp.before_result = lambda: state.__setitem__(0, replace(captured, **{field: value}))
    o = owner(r)
    assert offer(o, captured, published, current=lambda: state[0] is captured)
    await complete(o)
    assert published == []


async def test_exact_cache_reuses_original_expiry_no_call_and_never_crosses_task():
    r, published, b = router(), [], binding()
    now, wall = [0], [100]
    o = owner(r, clock=lambda: now[0], wall=lambda: wall[0])
    assert offer(o, b, published)
    await complete(o)
    original = copy.deepcopy(published[0])
    wall[0] = 150
    assert offer(o, b, published)
    assert published[-1] == original and len(r._mcp.calls) == 1
    assert not o.offer(
        b,
        tool="google_web_sogning",
        args={"query": "another"},
        current=lambda: True,
        publish=published.append,
    )
    wall[0] = 221
    assert o.source(b, original["receiptId"]) is None
    assert not offer(o, b, published)  # expired single-use turn cannot refresh/retry
    assert offer(o, replace(b, task="next", answer_revision=2), published)
    await complete(o)
    assert len(r._mcp.calls) == 2


async def test_finite_allowance_errors_oversize_are_charged_and_never_retry():
    r, published, b = router(), [], binding()
    r._mcp.result = {"isError": True, "content": [{"type": "text", "text": "bad"}]}
    o = owner(r)
    for index in range(6):
        assert offer(o, replace(b, turn=f"t{index}"), published)
        await complete(o)
    assert len(r._mcp.calls) == 6 and published == []
    assert not offer(o, replace(b, turn="t7"), published)
    assert not offer(o, replace(b, turn="t0"), published)
    assert o.allowance.remaining == 0


async def test_currency_checked_before_source_send_and_bad_args_fail_closed():
    r, published = router(), []
    o = owner(r)
    assert not offer(o, binding(), published, current=lambda: False)
    for args in ({}, {"query": "x", "play": True}, {"query": "x" * 241}):
        assert not o.offer(
            binding(),
            tool="google_web_sogning",
            args=args,
            current=lambda: True,
            publish=published.append,
        )
    assert r._mcp.calls == [] and o.allowance.remaining == 6


async def test_close_during_inflight_clears_source_and_no_late_publish():
    r, published = router(), []
    r._mcp.gate = asyncio.Event()
    o = owner(r)
    assert offer(o, binding(), published)
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    o.close()
    r._mcp.gate.set()
    await complete(o)
    assert published == [] and not offer(o, binding(), published)


async def test_cancellation_resistant_late_read_inert_and_deadline_charged(monkeypatch):
    r, published, now = router(), [], [0]
    o = owner(r, clock=lambda: now[0])
    gate = asyncio.Event()

    async def resist(*args, **kwargs):
        try:
            await gate.wait()
        except asyncio.CancelledError:
            await gate.wait()
        return {"ok": True, "data": "late"}

    o.adapter.read = resist
    real_wait = asyncio.wait

    async def timeout(tasks, **kwargs):
        await asyncio.sleep(0)
        now[0] = 5
        return set(), tasks

    monkeypatch.setattr(asyncio, "wait", timeout)
    assert offer(o, binding(), published)
    await complete(o)
    assert published == [] and len(o._reads) == 1
    assert not offer(o, binding(turn="new"), published)
    # Closed owner revokes source even if cancellation is swallowed.
    o.close()
    gate.set()
    await real_wait(o._reads, timeout=1)
    assert published == [] and o.allowance.remaining == 5


def test_web_actual_example_closed_shape_preserves_exact_excerpt_only():
    data = "Første kildeudsagn. Andet kildeudsagn. Tredje kildeudsagn. Fjerde kildeudsagn. Femte kildeudsagn. Sjette kildeudsagn. Syvende kildeudsagn."
    item = extract(
        "google_web_sogning",
        {"ok": True, "data": {"success": True, "result": {"output": data}}},
        now=100,
    )
    assert item["sourceText"] == data and item["provenance"]["textTruncated"] is True
    assert [f["value"] for f in item["facts"]] == [part + "." for part in data.split(". ")[:6]]
    assert (
        extract("google_web_sogning", {"ok": True, "data": {"output": "x" * 700}}, now=100) is None
    )
    for bad in (
        {"output": "x", "token": "secret"},
        {"output": "x", "url": "fake"},
        {"success": False, "result": "x"},
        "x" * 1201,
        True,
    ):
        assert extract("google_web_sogning", {"ok": True, "data": bad}, now=100) is None


def test_actual_weather_forecast_timeline_no_invented_ranges_or_continuity(monkeypatch):
    from datetime import datetime

    from gatekeeper import podview_weather
    from gatekeeper.weather_result import compact_weather_result

    data = weather_payload()
    stamp = datetime.fromisoformat(data["data"]["result"]["retrieved_at"]).timestamp()
    monkeypatch.setattr(podview_weather.time, "time", lambda: stamp)
    packed = compact_weather_result("weather_forecast", data)
    item = extract("weather_forecast", packed, now=stamp)
    assert item["family"] == "answer-timeline"
    assert item["events"][0]["time"] == data["data"]["result"]["forecast"][1]["datetime"]
    assert item["provenance"]["continuousCoverage"] is False
    source_coverage = packed["data"]["result"]["forecast"]
    assert item["provenance"]["coverage"]["totalRows"] == source_coverage["total_rows"] == 48
    assert item["provenance"]["coverage"]["returnedRows"] == source_coverage["returned_rows"]
    assert item["provenance"]["coverage"]["truncated"] is source_coverage["truncated"] is True
    assert "templow" not in str(item) and "high" not in str(item)
    assert item["validUntil"] == stamp + 120
    assert extract("weather_forecast", packed, now=stamp + 901) is None


@pytest.mark.parametrize("tool", ["google_web_sogning", "weather_forecast"])
async def test_actual_owner_payload_roundtrips_native_browser_validator(tool, monkeypatch):
    """Catch backend-to-native payload drift, including timestamps and forecast status."""
    import json
    import subprocess
    from datetime import datetime
    from pathlib import Path

    from gatekeeper import podview_weather

    r, b, published = router(tool), binding(), []
    source = weather_payload()
    stamp = datetime.fromisoformat(source["data"]["result"]["retrieved_at"]).timestamp()
    monkeypatch.setattr(podview_weather.time, "time", lambda: stamp)
    policy = web_policy()
    args = {"query": "exact model query"}
    if tool == "weather_forecast":
        r._mcp.result = {"structuredContent": source["data"]}
        policy = ResearchPolicy(frozenset({tool}))
        args = {}
    o = ResearchOwner(
        OwnerReadAdapter(r), policy=policy, allowance=RequestAllowance(6), wall=lambda: stamp
    )
    assert o.offer(b, tool=tool, args=args, current=lambda: True, publish=published.append)
    await complete(o)
    assert len(published) == 1
    item = published[0]
    context = {
        k: item[k]
        for k in (
            "roomId",
            "sessionId",
            "sessionEpoch",
            "turnId",
            "taskId",
            "inputRevision",
            "answerRevision",
            "providerGeneration",
        )
    }
    path = Path(__file__).parents[2] / "podvoice/gatekeeper/static/podview/research-answers.js"
    script = f"""import {{researchAnswer}} from {json.dumps(path.as_uri())};
let input='';for await(const chunk of process.stdin) input+=chunk;
const {{item,context,now}}=JSON.parse(input);
const answer=researchAnswer(item,context,now);
if(answer.kind!==item.family) process.exit(1);"""
    completed = await asyncio.to_thread(
        subprocess.run,
        ["node", "--input-type=module", "-e", script],
        input=json.dumps({"item": item, "context": context, "now": stamp * 1000}),
        text=True,
        capture_output=True,
        timeout=5,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr


async def test_cache_revoked_by_in_place_declaration_change():
    r, published, b = router(), [], binding()
    o = owner(r)
    assert offer(o, b, published)
    await complete(o)
    receipt = published[0]["receiptId"]
    r._discovery.mcp_tools[0]["description"] = "changed same declaration"
    assert o.source(b, receipt) is None
    assert not offer(o, b, published)
    assert len(r._mcp.calls) == 1
