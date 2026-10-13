"""Unit tests for the PodConnect Attention client (PLAN.md §7.2)."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
import respx

from gatekeeper.podconnect import (
    AttentionClient,
    AttentionDown,
    UnknownRoom,
    Unsupervised,
)

BASE = "http://podconnect.test"


def _client(token: str | None = None) -> AttentionClient:
    return AttentionClient(BASE, token=token)


@respx.mock
async def test_engage_posts_voice_owner_and_level_ttl():
    route = respx.post(f"{BASE}/api/attention").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )
    c = _client()
    out = await c.engage("kitchen", 5, ttl_ms=2000)
    assert out == {"ok": True}
    assert route.called
    body = route.calls.last.request.read()
    import json

    payload = json.loads(body)
    assert payload == {
        "room": "kitchen",
        "level": 5,
        "owner": "voice",
        "ttl_ms": 2000,
        "fade_ms": 0,
    }
    await c.aclose()


@respx.mock
async def test_engage_is_idempotent_two_calls_ok():
    respx.post(f"{BASE}/api/attention").mock(return_value=httpx.Response(200, json={"ok": True}))
    c = _client()
    await c.engage("kitchen", 35, ttl_ms=8000)
    await c.engage("kitchen", 35, ttl_ms=8000)
    assert not c.degraded
    await c.aclose()


@respx.mock
async def test_token_header_sent_when_set():
    route = respx.post(f"{BASE}/api/attention").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )
    c = _client(token="s3cret")
    await c.engage("kitchen", 5)
    assert route.calls.last.request.headers.get("X-PodConnect-Token") == "s3cret"
    await c.aclose()


@respx.mock
async def test_no_token_header_when_unset():
    route = respx.post(f"{BASE}/api/attention").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )
    c = _client()
    await c.engage("kitchen", 5)
    assert "X-PodConnect-Token" not in route.calls.last.request.headers
    await c.aclose()


@respx.mock
async def test_connection_error_raises_attention_down_and_degrades():
    respx.post(f"{BASE}/api/attention").mock(side_effect=httpx.ConnectError("refused"))
    c = _client()
    with pytest.raises(AttentionDown):
        await c.engage("kitchen", 5)
    assert c.degraded is True
    await c.aclose()


@respx.mock
async def test_read_timeout_raises_attention_down_and_degrades():
    respx.post(f"{BASE}/api/attention").mock(side_effect=httpx.ReadTimeout("slow"))
    c = _client()
    with pytest.raises(AttentionDown):
        await c.engage("kitchen", 5)
    assert c.degraded is True
    await c.aclose()


@respx.mock
async def test_5xx_raises_attention_down_and_degrades():
    respx.post(f"{BASE}/api/attention").mock(return_value=httpx.Response(500))
    c = _client()
    with pytest.raises(AttentionDown):
        await c.engage("kitchen", 5)
    assert c.degraded is True
    await c.aclose()


@respx.mock
async def test_404_raises_unknown_room_no_degrade():
    respx.post(f"{BASE}/api/attention").mock(return_value=httpx.Response(404))
    c = _client()
    with pytest.raises(UnknownRoom):
        await c.engage("nowhere", 5)
    assert c.degraded is False
    await c.aclose()


@respx.mock
async def test_503_raises_unsupervised_and_degrades():
    respx.post(f"{BASE}/api/attention").mock(return_value=httpx.Response(503))
    c = _client()
    with pytest.raises(Unsupervised):
        await c.engage("kitchen", 5)
    assert c.degraded is True
    await c.aclose()


@respx.mock
async def test_recover_clears_degraded_on_next_success():
    route = respx.post(f"{BASE}/api/attention")
    route.side_effect = [
        httpx.Response(500),
        httpx.Response(200, json={"ok": True}),
    ]
    c = _client()
    with pytest.raises(AttentionDown):
        await c.engage("kitchen", 5)
    assert c.degraded is True
    await c.engage("kitchen", 5)
    assert c.degraded is False
    await c.aclose()


@respx.mock
async def test_release_posts_room_and_returns_ok():
    route = respx.post(f"{BASE}/api/attention/release").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )
    c = _client()
    out = await c.release("kitchen")
    assert out == {"ok": True}
    import json

    payload = json.loads(route.calls.last.request.read())
    assert payload == {"room": "kitchen"}
    await c.aclose()


@respx.mock
async def test_state_gets_attention():
    respx.get(f"{BASE}/api/attention").mock(
        return_value=httpx.Response(200, json={"kitchen": {"level": 35}})
    )
    c = _client()
    out = await c.state()
    assert out == {"kitchen": {"level": 35}}
    await c.aclose()


_RELEASE_EXPECTED = {"process": "00000000-0000-4000-8000-000000000010", "revision": "1"}
_RELEASE_LEASE = {"session": "00000000-0000-4000-8000-000000000011", "expected": _RELEASE_EXPECTED}


def _release_snapshot(outcome="pending", **fields):
    return {
        "contract": "native_attention_v1",
        "outcome": outcome,
        "active": False,
        "challenge": dict(_RELEASE_EXPECTED),
        **fields,
    }


async def test_release_pending_reads_only_original_room_until_released():
    requests = []
    reads = 0
    lease = {"session": _RELEASE_LEASE["session"], "expected": dict(_RELEASE_EXPECTED)}

    async def wire(request):
        nonlocal reads
        requests.append((request.method, request.url.path, request.content))
        if request.method == "POST":
            assert json.loads(request.content) == {"room": "kitchen", **_RELEASE_LEASE}
            # A caller mutation after admission cannot replace the owned expectation.
            lease["expected"]["revision"] = "99"
            return httpx.Response(200, json=_release_snapshot())
        reads += 1
        return httpx.Response(
            200,
            json={"rooms": {"kitchen": _release_snapshot("released" if reads == 2 else "pending")}},
        )

    async with httpx.AsyncClient(base_url=BASE, transport=httpx.MockTransport(wire)) as http:
        client = AttentionClient(BASE, client=http)
        result = await asyncio.wait_for(client.release("kitchen", lease=lease), 2)
    assert result["outcome"] == "released"
    assert [(method, path) for method, path, _ in requests] == [
        ("POST", "/api/attention/release"),
        ("GET", "/api/attention"),
        ("GET", "/api/attention"),
    ]


@pytest.mark.parametrize(
    "response",
    [
        None,
        {},
        _release_snapshot(contract="other"),
        _release_snapshot(outcome=[]),
        _release_snapshot(active=True),
        _release_snapshot(challenge={"process": _RELEASE_EXPECTED["process"], "revision": "2"}),
        _release_snapshot(
            challenge={"process": "00000000-0000-4000-8000-000000000099", "revision": "1"}
        ),
        _release_snapshot(challenge={**_RELEASE_EXPECTED, "extra": True}),
    ],
)
async def test_release_unknown_or_wrong_initial_pending_cannot_poll(response):
    methods = []

    async def wire(request):
        methods.append(request.method)
        return httpx.Response(200, content=json.dumps(response).encode())

    async with httpx.AsyncClient(base_url=BASE, transport=httpx.MockTransport(wire)) as http:
        with pytest.raises(AttentionDown):
            await AttentionClient(BASE, client=http).release("kitchen", lease=_RELEASE_LEASE)
    assert methods == ["POST"]


@pytest.mark.parametrize(
    "state",
    [
        None,
        {"rooms": []},
        {"rooms": {"other": _release_snapshot("released")}},
        {"rooms": {"kitchen": _release_snapshot("released", active=True)}},
        {"rooms": {"kitchen": _release_snapshot("released", contract="other")}},
        {"rooms": {"kitchen": _release_snapshot(outcome="unknown")}},
        {
            "rooms": {
                "kitchen": _release_snapshot(
                    "released", challenge={"process": _RELEASE_EXPECTED["process"], "revision": "2"}
                )
            }
        },
        {
            "rooms": {
                "kitchen": _release_snapshot(
                    "released",
                    challenge={"process": "00000000-0000-4000-8000-000000000099", "revision": "1"},
                )
            }
        },
    ],
)
async def test_release_pending_never_adopts_another_current_owner(state):
    methods = []

    async def wire(request):
        methods.append(request.method)
        return httpx.Response(
            200,
            content=json.dumps(_release_snapshot() if request.method == "POST" else state).encode(),
        )

    async with httpx.AsyncClient(base_url=BASE, transport=httpx.MockTransport(wire)) as http:
        with pytest.raises(AttentionDown):
            await AttentionClient(BASE, client=http).release("kitchen", lease=_RELEASE_LEASE)
    assert methods == ["POST", "GET"]


@pytest.mark.parametrize("finish", ["cancel", "deadline"])
async def test_release_settlement_is_joined_by_existing_caller_boundary(finish):
    entered, joined = asyncio.Event(), asyncio.Event()
    never = asyncio.Event()
    methods = []

    async def wire(request):
        methods.append(request.method)
        if request.method == "POST":
            return httpx.Response(200, json=_release_snapshot())
        entered.set()
        try:
            await never.wait()
        finally:
            joined.set()

    async with httpx.AsyncClient(base_url=BASE, transport=httpx.MockTransport(wire)) as http:
        task = asyncio.create_task(
            AttentionClient(BASE, client=http).release("kitchen", lease=_RELEASE_LEASE)
        )
        try:
            await asyncio.wait_for(entered.wait(), 1)
            if finish == "cancel":
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await task
            else:
                with pytest.raises(TimeoutError):
                    await asyncio.wait_for(task, 0.02)
            assert joined.is_set() and task.done()
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    assert methods == ["POST", "GET"]


async def test_release_original_custody_receipt_from_new_manager_needs_no_get():
    methods = []
    receipt = _release_snapshot(
        "released", challenge={"process": "00000000-0000-4000-8000-000000000099", "revision": "3"}
    )

    async def wire(request):
        methods.append(request.method)
        return httpx.Response(200, json=receipt)

    async with httpx.AsyncClient(base_url=BASE, transport=httpx.MockTransport(wire)) as http:
        result = await AttentionClient(BASE, client=http).release("kitchen", lease=_RELEASE_LEASE)
    assert result == receipt and methods == ["POST"]


@pytest.mark.parametrize(
    "revision, valid",
    [(str((1 << 64) - 1), True), (str(1 << 64), False), ("0" + str((1 << 64) - 1), False)],
)
async def test_release_pending_uint64_revision_admission_boundary(revision, valid):
    """A valid pre-MAX challenge can admit a MAX original lease exactly once."""
    expected = {**_RELEASE_EXPECTED, "revision": revision}
    lease = {**_RELEASE_LEASE, "expected": expected}
    methods = []

    async def wire(request):
        methods.append(request.method)
        if request.method == "POST":
            assert json.loads(request.content) == {"room": "kitchen", **lease}
            return httpx.Response(200, json=_release_snapshot(challenge=expected))
        return httpx.Response(
            200, json={"rooms": {"kitchen": _release_snapshot("released", challenge=expected)}}
        )

    async with httpx.AsyncClient(base_url=BASE, transport=httpx.MockTransport(wire)) as http:
        client = AttentionClient(BASE, client=http)
        if valid:
            result = await asyncio.wait_for(client.release("kitchen", lease=lease), 1)
            assert result["challenge"] == expected and result["outcome"] == "released"
        else:
            with pytest.raises(AttentionDown):
                await client.release("kitchen", lease=lease)
    assert methods == (["POST", "GET"] if valid else ["POST"])
