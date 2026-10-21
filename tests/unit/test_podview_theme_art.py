"""Finite cache/provider boundary; synthetic transport, never paid image evidence."""

import asyncio
import base64
import hashlib
import json
from dataclasses import asdict

import httpx
import pytest

from gatekeeper.podview_theme_art import (
    MODEL,
    ThemeArtOwner,
    ThemeArtPolicy,
    ThemeArtStore,
    _webp,
    configured_theme_art,
)
from gatekeeper.provider_budget import ProviderBudgetCoordinator


def webp():
    # Synthetic image-bearing WebP container for header/size boundaries. These tests
    # do not claim real decoding, image quality, provider access or browser evidence.
    frame = b"\x10\x00\x00\x9d\x01\x2a" + (1024).to_bytes(2, "little") * 2
    body = b"WEBPVP8 " + len(frame).to_bytes(4, "little") + frame
    return b"RIFF" + len(body).to_bytes(4, "little") + body


def response(raw=None):
    return httpx.Response(
        200,
        json={
            "data": [{"b64_json": base64.b64encode(webp() if raw is None else raw).decode()}],
            "usage": {"total_tokens": 5},
        },
    )


def owner(tmp_path, client, *, budget=None, maximum=6):
    store = ThemeArtStore(tmp_path / "art", ThemeArtPolicy("synthetic-test-approval", maximum))
    return ThemeArtOwner(client, "inert-key", store, budget=budget or ProviderBudgetCoordinator())


def entries(value):
    return json.loads(value.store.ledger.read_bytes())["entries"]


@pytest.mark.parametrize(
    "raw",
    ["", "{}", "[]", '{"purpose":"mood"}', '{"model":"invented"}', '{"model":"x","model":"x"}'],
)
def test_default_off_or_invalid_has_no_filesystem_or_provider_work(tmp_path, raw):
    assert configured_theme_art(object(), "inert-key", raw, tmp_path / "off") is None
    assert not (tmp_path / "off").exists()


def test_policy_exact_closed_provider_contract_and_not_existing_allowance():
    policy = ThemeArtPolicy("review-pending")
    assert ThemeArtPolicy.parse(json.dumps(asdict(policy))) == policy
    for field, value in [
        ("model", "gpt-6-luna"),
        ("purpose", "podview_mood_v1"),
        ("max_images", 7),
        ("max_images", True),
        ("quality", "auto"),
        ("size", "auto"),
        ("approval_ref", ""),
    ]:
        with pytest.raises(ValueError):
            ThemeArtPolicy.parse(json.dumps({**asdict(policy), field: value}))


async def test_closed_input_fixed_provider_parameters_and_persistent_cache(tmp_path):
    calls = []

    def receive(request):
        body = json.loads(request.content)
        assert str(request.url) == "https://api.openai.com/v1/images/generations"
        assert request.headers["Authorization"] == "Bearer inert-key"
        assert {key: value for key, value in body.items() if key != "prompt"} == {
            "model": MODEL,
            "n": 1,
            "size": "1024x1024",
            "quality": "low",
            "output_format": "webp",
            "output_compression": 80,
            "background": "opaque",
            "moderation": "auto",
        }
        assert not any(
            word in body["prompt"]
            for word in ("kitchen-private", "account-alpha", "transcript-secret")
        )
        calls.append(body)
        return response()

    async with httpx.AsyncClient(transport=httpx.MockTransport(receive)) as client:
        value = owner(tmp_path, client)
        assert await value.generate("unknown-private", current=lambda: True) is None
        assert await value.generate("calm", current=lambda: False) is None
        path = await value.generate("calm", current=lambda: True)
        assert path == f"theme-art/calm/{hashlib.sha256(webp()).hexdigest()}.webp"
        assert value.store.read("calm", path.split("/")[-1][:-5]) == webp()
        restarted = owner(tmp_path, client)
        assert await restarted.generate("calm", current=lambda: True) == path
        assert len(calls) == 1
        assert entries(value)["calm"]["provenance"] == "generated-theme-illustration"


async def test_warmup_is_one_explicit_nonblocking_worker_with_six_lifetime_attempts(tmp_path):
    calls = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: calls.append(request) or response())
    ) as client:
        policy = json.dumps(asdict(ThemeArtPolicy("synthetic-test-approval")))
        value = configured_theme_art(client, "inert-key", policy, tmp_path / "art")
        assert value is not None and calls == []
        value.start()
        task = value._task
        value.start()
        assert value._task is task
        await task
        assert len(calls) == len(entries(value)) == 6
        await value.aclose()
        restarted = owner(tmp_path, client)
        restarted.start()
        await restarted._task
        assert len(calls) == 6
        await restarted.aclose()
        with pytest.raises(ValueError):
            ThemeArtStore(tmp_path / "art", ThemeArtPolicy("different-approval"))


@pytest.mark.parametrize("status", [401, 403, 429, 500])
async def test_provider_failure_halts_batch_no_next_request_or_debit_and_no_retry(tmp_path, status):
    calls = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: calls.append(request) or httpx.Response(status)
        )
    ) as client:
        value = owner(tmp_path, client)
        value.start()
        await value._task
        assert len(calls) == 1
        assert entries(value) == {"morning_acoustic": {"state": "attempted"}}
        assert await value.generate("calm", current=lambda: True) is None
        restarted = owner(tmp_path, client)
        restarted.start()
        await restarted._task
        assert len(calls) == 1
        assert entries(restarted) == entries(value)


async def test_unknown_outcome_and_timeout_are_never_refunded_or_retried(tmp_path, monkeypatch):
    import gatekeeper.podview_theme_art as art

    monkeypatch.setattr(art, "DEADLINE_S", 0.01)
    calls = []

    async def receive(request):
        calls.append(request)
        await asyncio.Event().wait()

    async with httpx.AsyncClient(transport=httpx.MockTransport(receive)) as client:
        value = owner(tmp_path, client)
        assert await value.generate("calm", current=lambda: True) is None
        assert entries(value) == {"calm": {"state": "attempted"}}
        assert await owner(tmp_path, client).generate("calm", current=lambda: True) is None
        assert len(calls) == 1


async def test_same_and_cross_owner_one_inflight_and_stale_completion_cannot_publish(tmp_path):
    entered, finish = asyncio.Event(), asyncio.Event()
    current = True
    calls = []

    async def receive(request):
        calls.append(request)
        entered.set()
        await finish.wait()
        return response()

    async with httpx.AsyncClient(transport=httpx.MockTransport(receive)) as client:
        value, other = owner(tmp_path, client), owner(tmp_path, client)
        task = asyncio.create_task(value.generate("calm", current=lambda: current))
        await entered.wait()
        assert await value.generate("indie", current=lambda: True) is None
        assert await other.generate("indie", current=lambda: True) is None
        current = False
        finish.set()
        assert await task is None
        assert len(calls) == 1 and value.store.url("calm") is None
        assert entries(value) == {"calm": {"state": "attempted"}}


async def test_cancellation_resistant_transport_cannot_publish_late(tmp_path):
    entered = asyncio.Event()

    async def receive(request):
        entered.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            return response()

    async with httpx.AsyncClient(transport=httpx.MockTransport(receive)) as client:
        value = owner(tmp_path, client)
        task = asyncio.create_task(value.generate("calm", current=lambda: True))
        await entered.wait()
        task.cancel()
        assert await task is None
        assert value.store.url("calm") is None
        assert entries(value)["calm"] == {"state": "attempted"}


async def test_shutdown_fences_worker_and_preserves_unknown_debit(tmp_path):
    entered = asyncio.Event()

    async def receive(request):
        entered.set()
        await asyncio.Event().wait()

    async with httpx.AsyncClient(transport=httpx.MockTransport(receive)) as client:
        value = owner(tmp_path, client)
        value.start()
        await entered.wait()
        await value.aclose()
        assert entries(value) == {"morning_acoustic": {"state": "attempted"}}
        assert value._task.done()
        value.start()
        assert value._task.done()


@pytest.mark.parametrize("mutate", ["missing", "tamper", "symlink", "hardlink"])
async def test_invalid_cache_keeps_static_fallback_and_cannot_regenerate(tmp_path, mutate):
    calls = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: calls.append(request) or response())
    ) as client:
        value = owner(tmp_path, client)
        url = await value.generate("calm", current=lambda: True)
        digest = url.rsplit("/", 1)[1][:-5]
        path = value.store.directory / f"calm-{digest}.webp"
        if mutate == "missing":
            path.unlink()
        elif mutate == "tamper":
            path.write_bytes(b"corrupt")
        elif mutate == "symlink":
            target = tmp_path / "target"
            target.write_bytes(webp())
            path.unlink()
            path.symlink_to(target)
        else:
            (tmp_path / "hardlink").hardlink_to(path)
        assert value.store.url("calm") is None
        assert value.store.read("calm", digest) is None
        assert await value.generate("calm", current=lambda: True) is None
        assert len(calls) == 1


@pytest.mark.parametrize("kind", ["missing-ledger", "corrupt-ledger", "missing-marker"])
async def test_restart_fails_closed_instead_of_provisioning_again(tmp_path, kind):
    async with httpx.AsyncClient() as client:
        value = owner(tmp_path, client)
        if kind == "missing-ledger":
            value.store.ledger.unlink()
        elif kind == "corrupt-ledger":
            value.store.ledger.write_text("{}")
        else:
            (value.store.directory / "purpose").unlink()
        with pytest.raises((OSError, ValueError)):
            owner(tmp_path, client)


@pytest.mark.parametrize(
    "raw",
    [
        b"invalid",
        b"RIFF"
        + (22).to_bytes(4, "little")
        + b"WEBPVP8X"
        + (10).to_bytes(4, "little")
        + b"\0" * 4
        + (1023).to_bytes(3, "little") * 2,
        webp()[:-1],
        webp().replace((1024).to_bytes(2, "little"), (16383).to_bytes(2, "little")),
    ],
)
async def test_invalid_or_header_only_success_is_spent_not_published(tmp_path, raw):
    assert not _webp(raw)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: response(raw))
    ) as client:
        value = owner(tmp_path, client)
        assert await value.generate("calm", current=lambda: True) is None
        assert value.store.url("calm") is None
        assert entries(value) == {"calm": {"state": "attempted"}}


async def test_exhausted_shared_coordinator_has_no_image_send_or_debit(tmp_path):
    calls = []
    budget = ProviderBudgetCoordinator(default_limit=1)
    budget.account_usage("inert-key", MODEL, 10)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: calls.append(request) or response())
    ) as client:
        value = owner(tmp_path, client, budget=budget)
        assert await value.generate("calm", current=lambda: True) is None
        assert entries(value) == {} and calls == []


def test_config_cannot_inherit_image_policy_from_panel_or_untrusted_settings(tmp_path, monkeypatch):
    from gatekeeper import config, settings

    policy = json.dumps(asdict(ThemeArtPolicy("synthetic-test-approval")))
    monkeypatch.setattr(settings, "_resolve", lambda path: tmp_path / "settings.json")
    monkeypatch.setattr(
        settings, "load_settings", lambda path: {"podview_theme_art_policy": "panel-forged"}
    )
    monkeypatch.setattr(config, "load_options", lambda path=None: {})
    assert config.load_config().podview_theme_art_policy == ""
    monkeypatch.setattr(
        config, "load_options", lambda path=None: {"podview_theme_art_policy": policy}
    )
    assert config.load_config().podview_theme_art_policy == policy
    assert (
        config.from_options(
            {"settings_source_untrusted": True, "podview_theme_art_policy": policy}
        ).podview_theme_art_policy
        == ""
    )


async def test_oversize_or_unusable_provider_result_is_never_cached(tmp_path):
    from gatekeeper.podview_theme_art import MAX_RESPONSE_BYTES

    results = [
        httpx.Response(200, content=b"x" * (MAX_RESPONSE_BYTES + 1)),
        httpx.Response(200, json={"data": [{"b64_json": "invalid base64"}]}),
        httpx.Response(200, json={"data": [{"url": "https://unowned.invalid/art.webp"}]}),
        httpx.Response(200, content=b'{"data":[],"data":[]}'),
    ]
    for index, result in enumerate(results):
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request, result=result: result)
        ) as client:
            value = owner(tmp_path / str(index), client)
            assert await value.generate("calm", current=lambda: True) is None
            assert value.store.url("calm") is None
            assert entries(value) == {"calm": {"state": "attempted"}}


async def test_diagnostic_key_owner_blocks_images_without_debit(tmp_path):
    budget = ProviderBudgetCoordinator()
    diagnostic = budget.diagnostic_started("inert-key")
    calls = []
    try:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: calls.append(request) or response())
        ) as client:
            value = owner(tmp_path, client, budget=budget)
            assert await value.generate("calm", current=lambda: True) is None
            assert calls == [] and entries(value) == {}
    finally:
        budget.release(diagnostic)


async def test_expired_deadline_cannot_publish_when_transport_suppresses_cancel(
    tmp_path, monkeypatch
):
    import gatekeeper.podview_theme_art as art

    monkeypatch.setattr(art, "DEADLINE_S", 0.01)

    async def receive(request):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            return response()

    async with httpx.AsyncClient(transport=httpx.MockTransport(receive)) as client:
        value = owner(tmp_path, client)
        assert await value.generate("calm", current=lambda: True) is None
        assert value.store.url("calm") is None
        assert entries(value) == {"calm": {"state": "attempted"}}
