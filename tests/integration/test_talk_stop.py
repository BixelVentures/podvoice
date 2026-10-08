"""Talk socket Stop bypasses blocked commands; Thin remains the sole close owner."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from aiohttp import WSMsgType
from test_thin_live import build, until
from unit.test_openai_live import SDK, created

from gatekeeper.openai_live import LiveAudioChunk
from gatekeeper.talk import BrowserLink, run_talk


class HistoricalWavBrowserLink(BrowserLink):
    """Historical WS/WAV fixture; native capability and ACK are explicitly simulated."""

    supports_live_semantic_stop = True
    _stop_generation = 0

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.supports_live_webrtc = False

    async def set_live_context(self):
        self._stop_generation += 1
        return True  # Fixture admission only; no firmware or physical proof.


class Wire:
    def __init__(self):
        self.incoming = asyncio.Queue()
        self.outgoing = []

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self.incoming.get()
        if item is None:
            raise StopAsyncIteration
        return item

    async def send_json(self, payload):
        self.outgoing.append(payload)

    async def send_bytes(self, payload):
        pass

    def send(self, kind, **fields):
        self.incoming.put_nowait(
            SimpleNamespace(type=WSMsgType.TEXT, data=json.dumps({"type": kind, **fields}))
        )

    def result(self, command_id):
        return next(
            (
                e
                for e in self.outgoing
                if e.get("type") == "command_result" and e.get("command_id") == command_id
            ),
            None,
        )


@pytest.mark.parametrize("command", ["wake", "text"])
async def test_stop_preempts_running_command_fences_queue_and_keeps_media_receiver_alive(command):
    wire = Wire()
    entered, cancelled, close_entered, close_release = (asyncio.Event() for _ in range(4))
    calls, media = [], []

    class Session:
        _active = False

        async def start(self):
            pass

        async def wake(self):
            calls.append("wake")
            if not entered.is_set():
                entered.set()
                try:
                    await asyncio.Event().wait()
                except asyncio.CancelledError:
                    cancelled.set()
                    raise
            self._active = True

        async def submit_text(self, text, command_id):
            calls.append("text")
            await self.wake()
            return {"status": "accepted", "command_id": command_id}

        async def stop(self, **_):
            calls.append("stop")
            close_entered.set()
            await close_release.wait()
            self._active = False

        async def aclose(self):
            calls.append("aclose")

    link = BrowserLink(wire.send_json, wire.send_bytes)
    link.supports_live_webrtc = False  # This fixture exercises the existing WS transport.
    link.media_state = lambda *args: media.append(args)
    task = asyncio.create_task(run_talk(wire, Session(), link))
    try:
        wire.send(command, command_id="running", text="fixture")
        await asyncio.wait_for(entered.wait(), 1)
        wire.send("wake", command_id="queued-wake")
        wire.send("text", command_id="queued-text", text="must not send")
        wire.send("stop", command_id="stop-1")
        wire.send("stop", command_id="stop-2")
        wire.send("wake", command_id="during-close")
        await asyncio.wait_for(close_entered.wait(), 1)
        await asyncio.wait_for(cancelled.wait(), 1)
        wire.send("media", announcing=False, playback_id="old")
        wire.send("ping", ping_id="while-closing")
        await until(
            lambda: media and any(e.get("ping_id") == "while-closing" for e in wire.outgoing)
        )
        assert calls.count("stop") == 1
        close_release.set()
        await until(
            lambda: wire.result("stop-2") is not None and wire.result("during-close") is not None
        )
        for command_id in ("running", "queued-wake", "queued-text", "during-close"):
            assert wire.result(command_id)["status"] == "rejected"
            assert wire.result(command_id)["code"] == "stopped"
        assert calls.count("wake") == 1
        wire.send("wake", command_id="fresh")
        await until(lambda: wire.result("fresh") is not None)
        assert wire.result("fresh")["status"] == "accepted"
        assert calls.count("wake") == 2
        wire.send("stop", command_id="stop-1")  # Duplicate old Stop must not close this wake.
        wire.send("ping", ping_id="after-replay")
        await until(lambda: any(e.get("ping_id") == "after-replay" for e in wire.outgoing))
        assert calls.count("stop") == 1
    finally:
        close_release.set()
        wire.incoming.put_nowait(None)
        await asyncio.wait_for(task, 2)


@pytest.mark.parametrize("resists_cancellation", [False, True])
async def test_real_thin_alpha_stop_cancels_blocked_sdk_startup_before_late_release(
    resists_cancellation,
):
    wire, entered, cancelled = Wire(), asyncio.Event(), asyncio.Event()
    release = asyncio.Event()
    link = HistoricalWavBrowserLink(wire.send_json, wire.send_bytes)
    session, _, _, _, _ = build(device=link)

    class BlockedSDK(SDK):
        async def __aenter__(self):
            entered.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                if resists_cancellation:
                    await release.wait()
                    return self
                raise

    sdk = BlockedSDK()
    session.live_brain.client_factory = sdk.factory
    task = asyncio.create_task(run_talk(wire, session, link))
    try:
        wire.send("wake", command_id="opening")
        await asyncio.wait_for(entered.wait(), 1)
        wire.send("text", command_id="old-text", text="never submit")
        wire.send("wake", command_id="old-wake")
        wire.send("stop", command_id="stop")
        await asyncio.wait_for(cancelled.wait(), 1)
        wire.send("ping", ping_id="startup-cancelled")
        await until(lambda: any(e.get("ping_id") == "startup-cancelled" for e in wire.outgoing))
        release.set()
        await until(lambda: wire.result("stop") is not None)
        assert wire.result("stop")["status"] == "accepted"
        assert not session._active
        assert session._live_opening_task is None or session._live_opening_task.done()
        assert sdk.released and sdk.client.close.await_count == 1
        sdk.session.start.assert_not_called()
        sdk.response.item.create.assert_not_called()
        assert not session.live_brain.provider_budget.snapshot("test", "gpt-5.6-luna")[
            "production_sessions"
        ]
        await until(lambda: wire.result("old-wake") is not None)
        assert wire.result("old-wake")["code"] == wire.result("old-text")["code"] == "stopped"
        retired_generation = session.live_brain._connection_generation
        fresh_sdk = SDK()
        session.live_brain.client_factory = fresh_sdk.factory
        wire.send("wake", command_id="fresh-real-wake")
        await until(lambda: wire.result("fresh-real-wake") is not None)
        assert wire.result("fresh-real-wake")["status"] == "accepted"
        assert session._active and session.live_alpha
        assert session.live_brain._connection_generation > retired_generation
        fresh_sdk.session.start.assert_awaited_once()
        sdk.session.start.assert_not_called()
        current_stream = session._live_stream

        # Delayed old provider PCM/backend evidence cannot enter the new stream.
        await session.live_brain._handle(created("retired-response"), retired_generation)
        await session.live_brain._handle(
            {"type": "session.output_audio.delta", "delta": "AAA="}, retired_generation
        )
        await session._on_live_event(LiveAudioChunk(b"\x01\x00" * 1920, retired_generation))
        assert session._live_output_bytes == 0
        assert session._live_stream is current_stream and not current_stream.cancelled
        assert "retired-response" not in session.live_brain._seen_responses
        fresh_sdk.response.item.create.assert_not_called()

        # Replay the exact old Stop ID, then use pong as the socket-processing fence.
        wire.send("stop", command_id="stop")
        wire.send("ping", ping_id="real-next-wake-after-stop-replay")
        await until(
            lambda: any(
                e.get("ping_id") == "real-next-wake-after-stop-replay" for e in wire.outgoing
            )
        )
        assert session._active and session._live_stream is current_stream
        fresh_sdk.session.close.assert_not_called()
        sdk.session.start.assert_not_called()
    finally:
        wire.incoming.put_nowait(None)
        await asyncio.wait_for(task, 2)


async def test_failed_close_remains_fenced_without_blocking_socket_errors():
    wire = Wire()
    calls = []

    class Session:
        async def start(self):
            pass

        async def wake(self):
            calls.append("wake")

        async def stop(self, **_):
            calls.append("stop")
            raise RuntimeError("close failed")

        async def aclose(self):
            calls.append("aclose")

    link = BrowserLink(wire.send_json, wire.send_bytes)
    link.supports_live_webrtc = False  # This fixture exercises the existing WS transport.
    task = asyncio.create_task(run_talk(wire, Session(), link))
    wire.send("stop", command_id="stop")
    await until(lambda: wire.result("stop") is not None)
    assert wire.result("stop")["status"] == "rejected"
    wire.send("wake", command_id="must-stay-fenced")
    await until(lambda: wire.result("must-stay-fenced") is not None)
    assert wire.result("must-stay-fenced")["code"] == "stopped"
    assert calls == ["stop"]
    wire.incoming.put_nowait(SimpleNamespace(type=WSMsgType.ERROR))
    await asyncio.wait_for(task, 2)
    assert calls == ["stop", "aclose"]


@pytest.mark.parametrize("stop_first", [False, True])
async def test_disconnect_closes_real_thin_before_joining_cancel_resistant_typed_send(stop_first):
    wire = Wire()
    link = HistoricalWavBrowserLink(wire.send_json, wire.send_bytes)
    session, sdk, _, _, _ = build(device=link)
    entered, cancelled, released_by_cleanup = (asyncio.Event() for _ in range(3))

    async def blocked_send(**_):
        entered.set()
        while not released_by_cleanup.is_set():
            try:
                await released_by_cleanup.wait()
            except asyncio.CancelledError:
                cancelled.set()

    async def cleanup():
        released_by_cleanup.set()

    sdk.response.item.create.side_effect = blocked_send
    sdk.client.close.side_effect = cleanup
    task = asyncio.create_task(run_talk(wire, session, link))
    try:
        wire.send("wake", command_id="wake")
        await until(lambda: wire.result("wake") is not None)
        wire.send("text", command_id="blocked-text", text="isolated fixture")
        await asyncio.wait_for(entered.wait(), 1)
        if stop_first:
            wire.send("stop", command_id="stop-before-disconnect")
            await asyncio.wait_for(cancelled.wait(), 1)
        wire.incoming.put_nowait(None)
        await asyncio.wait_for(released_by_cleanup.wait(), 1)
        await asyncio.wait_for(task, 1)
        assert session._closing and not session._active
        sdk.session.close.assert_awaited_once()
        sdk.client.close.assert_awaited_once()
        assert sdk.released
        assert not session.live_brain.provider_budget.snapshot("test", "gpt-5.6-luna")[
            "production_sessions"
        ]
        assert (
            wire.result("blocked-text") is None
            or wire.result("blocked-text")["status"] == "rejected"
        )
    finally:
        # Only test-failure cleanup: passing path is released solely by SDK.close.
        released_by_cleanup.set()
        wire.incoming.put_nowait(None)
        await asyncio.wait_for(task, 2)


@pytest.mark.parametrize("resists_cancellation", [False, True])
async def test_disconnect_fences_real_thin_shielded_wake_before_late_sdk_start(
    resists_cancellation,
):
    wire = Wire()
    entered, cancelled, release = (asyncio.Event() for _ in range(3))
    link = HistoricalWavBrowserLink(wire.send_json, wire.send_bytes)
    session, _, _, _, _ = build(device=link)

    class StartupSDK(SDK):
        async def __aenter__(self):
            entered.set()
            try:
                await release.wait()
            except asyncio.CancelledError:
                cancelled.set()
                if resists_cancellation:
                    await release.wait()
                    return self
                raise
            return self

    sdk = StartupSDK()
    session.live_brain.client_factory = sdk.factory
    task = asyncio.create_task(run_talk(wire, session, link))
    try:
        wire.send("wake", command_id="opening")
        await asyncio.wait_for(entered.wait(), 1)
        wire.incoming.put_nowait(None)
        await asyncio.wait_for(cancelled.wait(), 1)
        release.set()
        await asyncio.wait_for(task, 2)
        assert session._closing and not session._active
        sdk.session.start.assert_not_called()
        assert sdk.released and sdk.client.close.await_count == 1
        assert session._live_opening_task is None or session._live_opening_task.done()
        assert not session.live_brain.provider_budget.snapshot("test", "gpt-5.6-luna")[
            "production_sessions"
        ]
    finally:
        release.set()
        await asyncio.wait_for(task, 2)


async def test_disconnect_reports_but_retains_command_still_pending_after_close(
    monkeypatch, caplog
):
    from gatekeeper import talk as talk_module

    monkeypatch.setattr(talk_module, "_COMMAND_JOIN_DIAGNOSTIC_S", 0.01)
    wire = Wire()
    entered, closed, release = (asyncio.Event() for _ in range(3))

    class Session:
        async def start(self):
            pass

        async def submit_text(self, text, command_id):
            entered.set()
            while not release.is_set():
                try:
                    await release.wait()
                except asyncio.CancelledError:
                    pass
            return {"status": "accepted"}

        async def aclose(self):
            closed.set()

    task = asyncio.create_task(run_talk(wire, Session(), None))
    try:
        wire.send("text", command_id="stubborn", text="fixture")
        await asyncio.wait_for(entered.wait(), 1)
        wire.incoming.put_nowait(None)
        await asyncio.wait_for(closed.wait(), 1)
        await until(lambda: "retaining ownership" in caplog.text)
        assert not task.done()  # No returned-success or unowned background command.
        release.set()
        await asyncio.wait_for(task, 1)
        assert wire.result("stubborn")["status"] == "rejected"
    finally:
        release.set()
        await asyncio.wait_for(task, 1)


def _exit_session_owners(session):
    """Only known handles of these two fixture sessions, never a global task sweep."""
    return tuple(
        dict.fromkeys(
            [
                session._reader,
                session._pump,
                session._beat,
                session._keepalive,
                session._close_task,
                session._live_close_task,
                session._live_opening_task,
                session._live_rotation_task,
                session._live_idle_preclose_task,
                session._goodbye,
                session._rearm_retry_task,
                session._teardown_retry_task,
                *session._tasks,
                *session._tool_tasks.values(),
                *session._live_rotation_io,
                *session._live_idle_preclose_owners,
                session.heartbeat._task,
                session.heartbeat._beat_task,
                session.playback._task,
                session.live_brain._reader,
                session.live_brain._startup_task,
            ]
        )
    )


def _observe_exit_aclose(session, monkeypatch):
    """Forward exact owners, recording returned adapter calls outside adapter state."""
    original = session.aclose
    seen = SimpleNamespace(public=[], suffix_tasks=[], adapters={"playback": [], "voicepe": []})

    async def observe():
        seen.public.append(asyncio.current_task())
        await original()

    def observe_adapter(owner, name):
        original_adapter = owner.aclose

        async def close():
            receipt = SimpleNamespace(task=asyncio.current_task(), returned=False, error=None)
            seen.adapters[name].append(receipt)
            try:
                await original_adapter()
                receipt.returned = True
            except BaseException as exc:
                receipt.error = exc
                raise

        monkeypatch.setattr(owner, "aclose", close)

    observe_adapter(session.playback, "playback")
    observe_adapter(session.voicepe, "voicepe")
    monkeypatch.setattr(session, "aclose", observe)
    return seen


async def _finish_exit_session(session, retained, seen):
    """Join public/true close; finish only genuinely skipped existing adapter suffixes."""
    errors = []

    async def observe(task, label, *, cancel=False):
        if task is None:
            return
        if cancel and not task.done():
            task.cancel()
        _, pending = await asyncio.wait({task}, timeout=2)
        if pending:
            errors.append(TimeoutError(label + " did not join"))
            return
        if not task.cancelled():
            failure = task.exception()
            if failure is not None:
                errors.append(failure)

    if not seen.public:
        # Initial shutdown only. A cancelled existing observer never permits a second Thin teardown.
        public = asyncio.create_task(session.aclose(), name="talk-exit-fixture-aclose")
        seen.public.append(public)
    for public in tuple(dict.fromkeys(seen.public)):
        await observe(public, "public close observer")
        if not public.done():
            await observe(public, "cancelled public close observer", cancel=True)
    owner = session._close_task
    await observe(owner, "true Thin close")
    if owner is not None and not owner.done():
        await observe(owner, "true Thin close failure rescue", cancel=True)
    for name, adapter in (("playback", session.playback), ("voicepe", session.voicepe)):
        for receipt in seen.adapters[name]:
            if receipt.error is not None:
                errors.append(receipt.error)
        if not any(receipt.returned for receipt in seen.adapters[name]):
            # These are exactly the adapter methods after Thin.aclose's shielded owner.
            # No new Thin.aclose, _teardown, provider close, heartbeat or attention release.
            suffix = asyncio.create_task(adapter.aclose(), name="talk-exit-fixture-" + name)
            seen.suffix_tasks.append(suffix)
            await observe(suffix, name + " public adapter suffix")
            if not suffix.done():
                await observe(suffix, name + " cancelled suffix", cancel=True)
    owners = tuple(retained)
    try:
        owners = tuple(dict.fromkeys((*retained, *_exit_session_owners(session))))
    except BaseException as exc:
        errors.append(exc)
    for task in owners:
        if task is not None and not task.done():
            errors.append(AssertionError("owned session task survived public close"))
            await observe(task, "exact fixture-owned failure rescue", cancel=True)
    try:
        assert all(task is None or task.done() for task in owners)
        assert all(task.done() for task in (*seen.public, *seen.suffix_tasks))
        assert all(any(receipt.returned for receipt in rows) for rows in seen.adapters.values())
        assert session.playback._task is None
        if isinstance(session.voicepe, BrowserLink):
            # BrowserLink.aclose is an actual no-op, not socket/track or native closed proof.
            assert not session.voicepe._streaming
        else:
            assert session.voicepe.closed  # Existing field on this exact FakeVoicePELink fixture.
        assert not session._active and not session._teardown_incomplete
        live = session.live_brain
        assert live._reader is None and live._startup_task is None
        assert live._connection is None and live._manager is None
        assert live._client is None and live._lease is None
    except BaseException as exc:
        errors.append(exc)
    if errors:
        primary = errors[0]
        for error in errors[1:]:
            primary.add_note(f"exact fixture cleanup: {error!r}")
        raise primary


async def test_panel_exit_stop_closes_only_its_actual_thin_and_fresh_input_reopens(monkeypatch):
    """Actual socket/Thin owners with inert SDK/Voice PE; never physical media proof."""
    wire = Wire()
    link = HistoricalWavBrowserLink(wire.send_json, wire.send_bytes)
    session, sdk, _, _, _ = build(device=link)
    voice_session, voice_sdk, _, _, voice_link = build()
    original_stop = session.stop
    stop_reasons = []

    async def observe_stop(**kwargs):
        stop_reasons.append(kwargs.get("reason"))
        await original_stop(**kwargs)

    monkeypatch.setattr(session, "stop", observe_stop)
    task = None
    primary = None
    observers = _observe_exit_aclose(session, monkeypatch)
    voice_observers = _observe_exit_aclose(voice_session, monkeypatch)
    try:
        await voice_session.start()
        await voice_session.wake()
        voice_stream = voice_session._live_stream
        voice_generation = voice_session.live_brain._connection_generation
        voice_audio_generation = voice_link.audio_generation
        assert voice_session._active
        task = asyncio.create_task(run_talk(wire, session, link))
        wire.send("wake", command_id="visible-wake")
        await until(lambda: wire.result("visible-wake") is not None)
        assert wire.result("visible-wake")["status"] == "accepted"
        assert session._active
        retired_generation = session.live_brain._connection_generation

        # Same payload shape as the shipped Afslut/tab-exit sender, on this socket only.
        wire.send("stop")
        await until(
            lambda: any(
                e.get("type") == "command_result" and e.get("command_id") != "visible-wake"
                for e in wire.outgoing
            )
        )
        stopped = next(
            e
            for e in wire.outgoing
            if e.get("type") == "command_result" and e.get("command_id") != "visible-wake"
        )
        assert stopped["status"] == "accepted"
        assert stop_reasons == ["panel"]
        assert not session._active
        sdk.session.close.assert_awaited_once()
        sdk.client.close.assert_awaited_once()
        assert voice_session._active and voice_session._live_stream is voice_stream
        assert voice_session.live_brain._connection_generation == voice_generation
        assert voice_link.audio_generation == voice_audio_generation
        voice_sdk.session.close.assert_not_called()
        voice_sdk.client.close.assert_not_called()

        fresh_sdk = SDK()
        session.live_brain.client_factory = fresh_sdk.factory
        wire.send("wake", command_id="explicit-return-wake")
        await until(lambda: wire.result("explicit-return-wake") is not None)
        assert wire.result("explicit-return-wake")["status"] == "accepted"
        assert session._active
        assert session.live_brain._connection_generation > retired_generation
        fresh_sdk.session.start.assert_awaited_once()
        wire.send("stop", command_id=stopped["command_id"])
        wire.send("ping", ping_id="replayed-exit-processing-fence")
        await until(
            lambda: any(e.get("ping_id") == "replayed-exit-processing-fence" for e in wire.outgoing)
        )
        assert stop_reasons == ["panel"]
        assert session._active and voice_session._active
        fresh_sdk.session.close.assert_not_called()
        voice_sdk.session.close.assert_not_called()
    except BaseException as exc:
        primary = exc
    finally:
        secondary = []
        retained, voice_retained = (), ()
        try:
            retained = _exit_session_owners(session)
        except BaseException as exc:
            secondary.append(exc)
        try:
            voice_retained = _exit_session_owners(voice_session)
        except BaseException as exc:
            secondary.append(exc)
        wire.incoming.put_nowait(None)
        if task is not None:
            _, pending = await asyncio.wait({task}, timeout=2)
            if pending:
                secondary.append(TimeoutError("Talk public-close observation timed out"))
        for owned, held, seen in (
            (session, retained, observers),
            (voice_session, voice_retained, voice_observers),
        ):
            try:
                await _finish_exit_session(owned, held, seen)
            except BaseException as exc:
                secondary.append(exc)
        if task is not None:
            if not task.done():
                task.cancel()
            _, pending = await asyncio.wait({task}, timeout=2)
            if pending:
                secondary.append(AssertionError("exact run_talk owner did not join"))
            elif not task.cancelled() and task.exception() is not None:
                secondary.append(task.exception())
        if primary is None and secondary:
            primary = secondary.pop(0)
        if primary is not None:
            for error in secondary:
                primary.add_note(f"Talk-exit fixture cleanup: {error!r}")
    if primary is not None:
        raise primary


@pytest.mark.parametrize("cancel_observation", [False, True])
async def test_exit_fixture_joins_true_close_and_adapter_suffix_after_observation_cancel(
    cancel_observation,
    monkeypatch,
):
    session, sdk, _, _, _ = build()
    entered, release = asyncio.Event(), asyncio.Event()

    async def held_sdk_close():
        entered.set()
        await release.wait()

    sdk.client.close.side_effect = held_sdk_close
    observers = _observe_exit_aclose(session, monkeypatch)
    observer = None
    retained = ()
    primary = None
    try:
        await session.start()
        await session.wake()
        retained = _exit_session_owners(session)
        observer = asyncio.create_task(session.aclose(), name="cancelled-exit-public-close")
        await asyncio.wait_for(entered.wait(), 1)
        owner, playback = session._close_task, session.playback._task
        assert owner is not None and not owner.done()
        assert playback is not None and not playback.done()
        assert not session.voicepe.closed
        if cancel_observation:
            observer.cancel()
        else:
            # Bounded observation timeout never cancels the true close owner.
            with pytest.raises(TimeoutError):
                async with asyncio.timeout(0):
                    await asyncio.shield(observer)
            assert not observer.done() and not owner.done()
            observer.cancel()
        done, pending = await asyncio.wait({observer}, timeout=2)
        assert done == {observer} and not pending and observer.cancelled()
        assert not owner.done() and not playback.done() and not session.voicepe.closed
        release.set()
        await _finish_exit_session(session, retained, observers)
        assert session._close_task is owner and owner.done()
        assert playback.done() and session.playback._task is None and session.voicepe.closed
        sdk.client.close.assert_awaited_once()
        assert all(task.done() for task in (*observers.public, *observers.suffix_tasks))
        assert len(session.attention.release_calls) == 1
    except BaseException as exc:
        primary = exc
    finally:
        release.set()
        try:
            await _finish_exit_session(session, retained, observers)
            assert len(session.attention.release_calls) == 1
            assert len(observers.adapters["playback"]) == 1
            assert len(observers.adapters["voicepe"]) == 1
        except BaseException as exc:
            if primary is None:
                primary = exc
            else:
                primary.add_note(f"cancel-observer fixture cleanup: {exc!r}")
    if primary is not None:
        raise primary
