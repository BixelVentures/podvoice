"""Actual aggregate route, no HTTP server or external connections."""

# ruff: noqa: F811 - imported pytest fixtures are injected by name.

import asyncio
import logging

import pytest
from integration.test_podview_mood_playlists import mood_rig  # noqa: F401
from integration.test_podview_mood_preview import read, unpaired
from integration.test_podview_music_selection import rig  # noqa: F401

from gatekeeper import mood_diagnostics as diag


@pytest.mark.parametrize(
    "mode,phase,outcome,reason",
    [
        ("success", "publish", "success", "none"),
        ("owner", "playback_before", "mood_owner_unavailable", "none"),
        ("exception", "playlist_search", "mood_unavailable", "route_exception"),
        ("read_timeout", "playlist_search", "mood_unavailable", "route_exception"),
        ("owner_timeout", "publish", "success", "owner_timeout"),
        ("budget", "publish", "success", "not_ready"),
        ("selection", "publish", "success", "none"),
        ("catalogue", "playlist_search", "mood_catalogue_unavailable", "none"),
        ("cancel", "parallel_selection_search", "cancelled", "cancelled"),
    ],
)
async def test_actual_terminal_record_one_per_attempt_and_cleanup(
    mood_rig, caplog, monkeypatch, mode, phase, outcome, reason
):
    caplog.set_level(logging.INFO, logger="podvoice.mood")
    bridge = unpaired(mood_rig)
    original = mood_rig.router.podview_read

    if mode == "owner":
        original_snapshot = bridge.snapshot
        snapshots = 0

        def replaced_snapshot(room):
            nonlocal snapshots
            snapshots += 1
            result = original_snapshot(room)
            if snapshots == 2:
                result["voice"]["phase"] = "CLOSING"
            return result

        monkeypatch.setattr(bridge, "snapshot", replaced_snapshot)

    async def replacement(*a, **k):
        if mode == "exception":
            raise ValueError("NEVER_LOG_PRIVATE_EXCEPTION")
        if mode == "read_timeout":
            raise TimeoutError("NEVER_LOG_PRIVATE_EXCEPTION")
        if mode == "cancel":
            raise asyncio.CancelledError()
        return await original(*a, **k)

    mood_rig.router.podview_read = replacement
    if mode == "owner_timeout":

        async def timed_out_context(*a, **k):
            raise TimeoutError("NEVER_LOG_PRIVATE_EXCEPTION")

        mood_rig.router.podview_mood_context = timed_out_context
    if mode == "budget":
        mood_rig.router.podview_mood_selector.available = False
    if mode == "selection":
        mood_rig.router.podview_mood_selector.select.return_value = None
    if mode == "catalogue":
        mood_rig.playlist_account = "foreign"
    if mode == "cancel":
        with pytest.raises(asyncio.CancelledError):
            await read(mood_rig)
    else:
        body = await read(mood_rig)
        assert body.get("error", "success") == outcome
    raw_lines = [r.getMessage() for r in caplog.records if r.name == "podvoice.mood"]
    lines = [line.split(" total_ms=", 1)[0] for line in raw_lines]
    for line in raw_lines:
        durations = dict(pair.split("=") for pair in line.split()[6:])
        assert set(durations) == {
            "total_ms",
            "playback_before_ms",
            "time_context_ms",
            "model_ms",
            "parallel_selection_search_ms",
            "playlist_search_ms",
            "playback_after_ms",
            "publish_ms",
        }
        assert all(value.isdecimal() and 0 <= int(value) <= 60000 for value in durations.values())
    assert lines == [
        f"mood_result phase={phase} outcome={outcome} reason={reason} http_status=none kind=mood"
    ]
    assert not bridge._music_busy and diag._CURRENT.get() is None
    assert "NEVER_LOG_PRIVATE_EXCEPTION" not in caplog.text
    assert mood_rig.router.podview_mood_selector.select.await_count == (
        0 if mode in {"owner", "owner_timeout", "budget"} else 1
    )


async def test_total_deadline_diagnostic_uses_inert_expiry_barrier(mood_rig, caplog, monkeypatch):
    caplog.set_level(logging.INFO, logger="podvoice.mood")
    bridge = unpaired(mood_rig)
    entered = asyncio.Event()
    timers = []
    real_timeout = asyncio.timeout

    def capture(seconds):
        timer = real_timeout(seconds)
        if 9 < seconds <= 10:
            timers.append(timer)
        return timer

    async def blocked(*a, **k):
        entered.set()
        await asyncio.Event().wait()

    mood_rig.router.podview_read = blocked
    monkeypatch.setattr(asyncio, "timeout", capture)
    task = asyncio.create_task(read(mood_rig))
    await entered.wait()
    assert len(timers) == 1
    timers[0].reschedule(asyncio.get_running_loop().time())
    assert (await task)["error"] == "mood_unavailable"
    assert not bridge._music_busy
    raw_lines = [r.getMessage() for r in caplog.records if r.name == "podvoice.mood"]
    lines = [line.split(" total_ms=", 1)[0] for line in raw_lines]
    for line in raw_lines:
        durations = dict(pair.split("=") for pair in line.split()[6:])
        assert set(durations) == {
            "total_ms",
            "playback_before_ms",
            "time_context_ms",
            "model_ms",
            "parallel_selection_search_ms",
            "playlist_search_ms",
            "playback_after_ms",
            "publish_ms",
        }
        assert all(value.isdecimal() and 0 <= int(value) <= 60000 for value in durations.values())
    assert lines == [
        "mood_result phase=parallel_selection_search outcome=mood_unavailable reason=route_deadline http_status=none kind=mood"
    ]
    assert mood_rig.router.podview_mood_selector.select.await_count == 1


@pytest.mark.parametrize("cancel", [False, True])
async def test_raising_log_handler_cannot_replace_actual_success_or_cancellation(
    mood_rig, monkeypatch, cancel
):
    bridge = unpaired(mood_rig)
    monkeypatch.setattr(diag._LOG, "info", lambda *a: (_ for _ in ()).throw(ValueError("PRIVATE")))
    if cancel:

        async def cancelled(*a, **k):
            raise asyncio.CancelledError()

        mood_rig.router.podview_read = cancelled
        with pytest.raises(asyncio.CancelledError):
            await read(mood_rig)
    else:
        assert (await read(mood_rig))["ok"] is True
    assert not bridge._music_busy and diag._CURRENT.get() is None


@pytest.mark.parametrize("kind", ["mood", "feeling"])
@pytest.mark.parametrize("empty", [False, True])
async def test_actual_tab_caller_preserves_kind_and_catalogue_failure(
    mood_rig, caplog, kind, empty
):
    import json

    from integration.test_podview_mood_preview import request

    from gatekeeper.podview import _music

    caplog.set_level(logging.INFO, logger="podvoice.mood")
    bridge = unpaired(mood_rig)
    reads = []

    async def catalogue(read_kind, account, query):
        reads.append(read_kind)
        return {
            "ok": True,
            "data": {
                "config_entry_id": account,
                "owner_epoch": "a" * 32,
                "source": "spotify_web_api",
                "playlists": []
                if empty
                else [
                    {
                        "uri": "spotify:playlist:" + chr(96 + len(reads)) * 22,
                        "name": "Synthetic playlist",
                    }
                ],
            },
        }

    mood_rig.router.podview_read = catalogue
    req = request(mood_rig)
    req.query["kind"] = kind
    response = await _music(req)
    body = json.loads(response.body)
    outcome = f"{kind}_catalogue_empty" if empty else "success"
    assert body.get("error", "success") == outcome
    lines = [r.getMessage() for r in caplog.records if r.name == "podvoice.mood"]
    assert len(lines) == 1 and f"outcome={outcome}" in lines[0] and f"kind={kind}" in lines[0]
    assert reads == ["playlist_search"] * (
        (9 if empty else 6) if kind == "mood" else (6 if empty else 3)
    )
    assert mood_rig.router.podview_mood_selector.select.await_count == int(kind == "mood")
    assert bridge.controls.music.setup_context.await_count == 0
    assert bridge.controls.music.execute_context.await_count == 0
    assert not bridge._music_busy and diag._CURRENT.get() is None


@pytest.mark.parametrize(
    "mode,status,reason",
    [
        ("guard", 403, "guard_denied"),
        ("room", 409, "room_required"),
        ("invalid", 400, "invalid_request"),
        ("admission", 403, "not_admitted"),
        ("busy", 429, "read_busy"),
        ("selection_busy", 429, "selection_busy"),
    ],
)
async def test_early_admission_is_fixed_private_and_has_no_provider_call(
    mood_rig, caplog, mode, status, reason
):
    from integration.test_podview_mood_preview import request

    from gatekeeper.podview import BRIDGE, _music

    caplog.set_level(logging.INFO, logger="podvoice.mood")
    req = request(mood_rig, account="PRIVATE_ACCOUNT")
    bridge = mood_rig.app[BRIDGE]
    if mode == "guard":
        req.remote = "8.8.8.8"
    elif mode == "room":
        req.query["room"] = "PRIVATE_ROOM"
    elif mode == "invalid":
        req.query["PRIVATE_QUERY"] = "PRIVATE_VALUE"
    elif mode == "admission":
        mood_rig.router.podview_mood_selector = None
    elif mode == "selection_busy":
        bridge.music_selection.busy = lambda room: True
    else:
        bridge._music_busy = True
    before = list(mood_rig.calls)
    response = await _music(req)
    assert response.status == status
    assert mood_rig.calls == before
    records = [r.getMessage() for r in caplog.records if r.name == "podvoice.mood"]
    assert records == [f"mood_admission kind=mood reason={reason} http_status={status}"]
    assert "PRIVATE" not in " ".join(records)


async def test_admission_logger_failure_preserves_rejection(mood_rig, monkeypatch):
    from integration.test_podview_mood_preview import request

    from gatekeeper.podview import BRIDGE, _music

    def broken(*args, **kwargs):
        raise ValueError("PRIVATE_LOGGER_FAILURE")

    monkeypatch.setattr(diag._LOG, "info", broken)
    mood_rig.app[BRIDGE]._music_busy = True
    response = await _music(request(mood_rig))
    assert response.status == 429
