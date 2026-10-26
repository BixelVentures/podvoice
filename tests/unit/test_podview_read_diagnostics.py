import asyncio
import hashlib
from types import SimpleNamespace

import pytest
from aiohttp import web
from multidict import CIMultiDict, MultiDict

from gatekeeper import podview, podview_queue
from gatekeeper import podview_read_diagnostics as rd


async def test_concurrent_and_redacted(caplog):
    ids = ["12345678-1234-4abc-8abc-123456789abc", "87654321-1234-4abc-9abc-123456789abc"]
    seen = []

    async def handler(request):
        await asyncio.sleep(0)
        seen.append(rd.read_hash())
        return SimpleNamespace(status=200, body=b"PRIVATE")

    with caplog.at_level("WARNING", logger="podvoice.podview"):
        result = await asyncio.gather(
            *(
                rd.observe_read(
                    SimpleNamespace(headers=CIMultiDict({"X-PodView-Read-Id": i})),
                    handler,
                    "playback",
                )
                for i in ids
            )
        )
        await rd.observe_read(
            SimpleNamespace(headers=CIMultiDict({"X-PodView-Read-Id": "PRIVATE"})), handler, "queue"
        )
    assert all(x.status == 200 for x in result)
    assert seen[:2] == [hashlib.sha256(i.encode()).hexdigest()[:16] for i in ids]
    assert seen[2] == "none" and rd.read_hash() == "none"
    assert all(i not in caplog.text for i in ids)
    assert "PRIVATE" not in caplog.text
    assert not caplog.records


async def test_logger_failure_preserves_response(monkeypatch):
    calls = []

    def fail(*args, **kwargs):
        calls.append(True)
        raise RuntimeError("secret")

    monkeypatch.setattr(rd._LOG, "warning", fail)
    expected = web.json_response({"ok": False, "error": "music_unavailable"}, status=503)

    async def handler(request):
        return expected

    response = await rd.observe_read(
        SimpleNamespace(
            headers=CIMultiDict({"X-PodView-Read-Id": "12345678-1234-4abc-8abc-123456789abc"})
        ),
        handler,
        "playback",
    )
    assert response is expected and response.status == 503
    assert calls == [True] and rd.read_hash() == "none"


async def test_actual_wrappers_limit_scope_and_preserve_failure(caplog, monkeypatch):
    secret = "PRIVATE-TITLE"
    token = "12345678-1234-4abc-8abc-123456789abc"
    digest = hashlib.sha256(token.encode("ascii")).hexdigest()[:16]

    async def music(request):
        return web.json_response(
            {"ok": True, "status": "unavailable", "reason": "stale_observation", "data": secret}
        )

    async def queue(request):
        return web.json_response({"ok": False, "error": "queue_not_paired", "data": secret})

    monkeypatch.setattr(podview, "_music", music)
    monkeypatch.setattr(podview_queue, "queue_http", queue)
    request = SimpleNamespace(
        query=MultiDict(kind="playback"), headers=CIMultiDict({"X-PodView-Read-Id": token})
    )
    with caplog.at_level("WARNING", logger="podvoice.podview"):
        response = await podview._observed_music(request)
        assert response.status == 200 and secret.encode() in response.body
        await podview._observed_queue_offer(request)
        request.query = MultiDict(kind="targets")
        await podview._observed_music(request)
        duplicate = CIMultiDict([("X-PodView-Read-Id", token), ("X-PodView-Read-Id", token)])
        request.headers = duplicate
        request.query = MultiDict(kind="playback")
        await podview._observed_music(request)
    assert len(caplog.records) == 2
    assert all(digest in r.message for r in caplog.records)
    assert "stale_observation" in caplog.text and "queue_not_paired" in caplog.text
    assert token not in caplog.text and secret not in caplog.text


async def test_handler_exception_identity_and_context_reset(monkeypatch):
    expected = RuntimeError("private exception")
    calls = []

    def broken_logger(*args, **kwargs):
        calls.append(True)
        raise ValueError("logger failure")

    async def handler(request):
        assert rd.read_hash() != "none"
        raise expected

    monkeypatch.setattr(rd._LOG, "warning", broken_logger)
    request = SimpleNamespace(
        headers=CIMultiDict({"X-PodView-Read-Id": "12345678-1234-4abc-8abc-123456789abc"})
    )
    with pytest.raises(RuntimeError) as caught:
        await rd.observe_read(request, handler, "playback")
    assert caught.value is expected and calls == [True]
    assert rd.read_hash() == "none"
