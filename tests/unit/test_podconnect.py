"""Unit tests for the PodConnect Attention client (PLAN.md §7.2)."""

from __future__ import annotations

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
