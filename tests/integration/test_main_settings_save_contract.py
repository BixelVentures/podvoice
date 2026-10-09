"""Actual main.run settings hook with inert I/O; no migration or room proof."""

from __future__ import annotations

import asyncio
import copy
import json
import signal
import uuid
from contextlib import asynccontextmanager
from dataclasses import replace
from types import SimpleNamespace

import aiohttp
import httpx
import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration.test_thin_live import Device
from unit.test_openai_live import SDK
from unit.test_provider_ack_readiness import _HTTP, _Message, _QueueWS

from gatekeeper import __main__ as main
from gatekeeper import audio_trace, openai_realtime, settings
from gatekeeper.config import load_config
from gatekeeper.mcp_client import PROTOCOL_VERSION
from gatekeeper.provider_budget import ProviderBudgetCoordinator
from gatekeeper.web import SETTINGS_SET


def _active_contract(session):
    return (
        session.brain,
        session.brain._connection_generation,
        session.live_alpha,
        session.voicepe.audio_generation,
        session._epoch,
        session._history_session,
        copy.deepcopy(session.brain.tool_declarations),
        copy.deepcopy(session._tool_declaration_hashes),
        session._realtime_brain.instructions,
        session.live_brain.instructions,
        session.live_brain.backend_instructions,
        session._close_task,
        session._goodbye,
        session._live_idle_preclose_task,
    )


def _device_contract(tools):
    owner = tools._device_control
    return (
        owner,
        owner._generation,
        owner._enabled,
        owner._entities,
        copy.deepcopy(owner._tickets),
        copy.deepcopy(owner._starts),
        copy.deepcopy(tools.declarations()),
    )


async def _observed(predicate, *, main_task):
    async with asyncio.timeout(20):
        while not predicate():
            if main_task.done():
                await main_task
                raise AssertionError("main returned before settings app admission")
            await asyncio.sleep(0.005)


def _session_owners(session):
    fields = (
        "_reader",
        "_pump",
        "_beat",
        "_keepalive",
        "_goodbye",
        "_close_task",
        "_live_close_task",
        "_live_opening_task",
        "_live_rotation_task",
        "_live_idle_preclose_task",
        "_rearm_retry_task",
        "_teardown_retry_task",
        "_barge_task",
        "_followup_task",
        "_stop_context_task",
        "_direct_task",
    )
    return tuple(
        dict.fromkeys(
            [getattr(session, field) for field in fields]
            + list(session._tasks)
            + list(session._tool_tasks.values())
            + list(session._live_rotation_io)
            + list(session._live_idle_preclose_owners)
            + [
                getattr(session.heartbeat, "_task", None),
                getattr(session.heartbeat, "_beat_task", None),
                session.playback._task,
                session.live_brain._reader,
                session.live_brain._startup_task,
                session._realtime_brain._capacity_reader_task,
            ]
        )
    )


async def _join_observer(task):
    if not task.done():
        task.cancel()
    async with asyncio.timeout(2):
        await asyncio.gather(task, return_exceptions=True)
    assert task.done(), "fixture observer was not joined"


def _assert_session_terminal(session, retained, observers):
    assert all(task is None or task.done() for task in retained)
    assert all(task is None or task.done() for task in _session_owners(session))
    assert all(task.done() for task in observers)
    assert session.playback._task is None and session.voicepe.closed
    assert not session._active and not session._teardown_incomplete
    live = session.live_brain
    assert live._reader is None and live._startup_task is None
    assert live._connection is None and live._manager is None
    assert live._client is None and live._lease is None
    assert session._realtime_brain._ws is None and session._realtime_brain._http is None


async def _complete_session_shutdown(session, retained, observers):
    """Retain the shielded close, then complete any skipped public adapter suffix."""
    initial_terminal_error = None
    try:
        _assert_session_terminal(session, retained, observers)
    except AssertionError as exc:
        initial_terminal_error = exc
    else:
        # Normal main has already closed shared Attention after every session.
        # Public aclose repeats release_music; replaying it is not an inert check.
        return
    primary = asyncio.create_task(session.aclose(), name="settings-fixture-aclose")
    observers.append(primary)
    failure = None
    try:
        async with asyncio.timeout(15):
            await asyncio.shield(primary)
    except BaseException as exc:
        failure = exc
    finally:
        secondary = []

        async def finish(operation):
            try:
                await operation
            except BaseException as exc:
                secondary.append(exc)

        for observer in tuple(dict.fromkeys(observers)):
            await finish(_join_observer(observer))
        owner = session._close_task
        if owner is not None:
            try:
                async with asyncio.timeout(15):
                    await asyncio.shield(owner)
            except BaseException as exc:
                secondary.append(exc)
                await finish(_join_observer(owner))
        retry = asyncio.create_task(session.aclose(), name="settings-fixture-aclose-suffix")
        observers.append(retry)
        try:
            async with asyncio.timeout(15):
                await asyncio.shield(retry)
        except BaseException as exc:
            secondary.append(exc)
        finally:
            await finish(_join_observer(retry))
            owner = session._close_task
            if owner is not None and not owner.done():
                await finish(_join_observer(owner))
            # Failure rescue may cancel only these exact session-owned handles.
            for task in tuple(dict.fromkeys((*retained, *_session_owners(session)))):
                if task is not None and not task.done():
                    await finish(_join_observer(task))
        try:
            _assert_session_terminal(session, retained, observers)
        except BaseException as exc:
            secondary.append(exc)
        if failure is None and secondary:
            failure = secondary.pop(0)
        if failure is not None:
            for exc in secondary:
                failure.add_note(f"session cleanup failed: {exc!r}")
    if failure is not None:
        failure.add_note(f"initial session terminal check: {initial_terminal_error!r}")
        raise failure


@asynccontextmanager
async def _actual_main_app(monkeypatch, folder, options, *, supervisor_token="inert-supervisor"):
    """Forward constructors/scheduling; retain the app built by unmodified run."""
    folder.mkdir(parents=True, exist_ok=True)
    state = SimpleNamespace(
        app=None,
        sessions={},
        built_sessions=[],
        traces=[],
        tools=None,
        timers=None,
        usage=None,
        clients=[],
        realtime_http=[],
        sdk=[],
        main_tasks=[],
        aclose_observers={},
        stop_callbacks={},
        configure_calls=[],
        requests=[],
        forbidden=[],
        restart_status=204,
        restart_calls=[],
        runner_cleaned=False,
        task=None,
    )
    client = None
    primary = None
    with monkeypatch.context() as patches:
        patches.setenv("SUPERVISOR_TOKEN", supervisor_token)
        patches.setenv("PODVOICE_OPTIONS", str(options))
        patches.setenv("PODVOICE_HISTORY", str(folder / "history.jsonl"))
        patches.setenv("PODVOICE_USAGE", str(folder / "usage.json"))
        cfg = load_config(options)
        assert cfg.supervisor_token == supervisor_token
        state.cfg = cfg
        # Synthetic protocol owner only: these receipts never prove native restore.
        attention_process = "00000000-0000-4000-8000-000000000010"
        attention_rooms = {
            room.room: {"revision": 0, "session": None, "active": False} for room in cfg.rooms
        }

        def transport(request):
            path = request.url.path
            state.requests.append((request.method, str(request.url)))
            if (
                request.method == "POST"
                and str(request.url) == "http://supervisor/addons/self/restart"
            ):
                state.restart_calls.append(request)
                if state.restart_status == "transport-error":
                    raise httpx.ConnectError("inert restart transport failure", request=request)
                return httpx.Response(state.restart_status, json={})
            if request.method == "GET" and path == "/core/api/services":
                return httpx.Response(200, json=[])
            if request.method == "POST" and path == "/core/api/mcp/assist":
                body = json.loads(request.content)
                method = body["method"]
                if method == "notifications/initialized":
                    return httpx.Response(202)
                if method == "initialize":
                    result = {
                        "protocolVersion": PROTOCOL_VERSION,
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "inert-settings-fixture", "version": "1"},
                    }
                elif method == "tools/list":
                    result = {
                        "tools": [
                            {
                                "name": "GetLiveContext",
                                "description": "Read-only inert fixture context",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {},
                                    "additionalProperties": False,
                                },
                            }
                        ]
                    }
                elif method == "tools/call" and body["params"]["name"] == "GetLiveContext":
                    result = {"content": [{"type": "text", "text": '{"fixture_context":true}'}]}
                else:
                    state.forbidden.append((request.method, str(request.url), method))
                    raise AssertionError("unadmitted MCP fixture operation")
                return httpx.Response(
                    200, json={"jsonrpc": "2.0", "id": body["id"], "result": result}
                )
            if request.method == "GET" and path == "/api/rooms":
                return httpx.Response(200, json=[])
            if path == "/api/attention" and request.method == "GET":
                return httpx.Response(
                    200,
                    json={
                        "rooms": {
                            room: {
                                "challenge": {
                                    "process": attention_process,
                                    "revision": str(owner["revision"]),
                                }
                            }
                            for room, owner in attention_rooms.items()
                        }
                    },
                )
            if path in {"/api/attention", "/api/attention/release"} and request.method == "POST":
                body = json.loads(request.content)
                owner = attention_rooms.get(body.get("room"))
                if owner is None:
                    return httpx.Response(404, json={"error": "unknown synthetic room"})
                nonce = body.get("session")
                try:
                    valid_nonce = type(nonce) is str and str(uuid.UUID(nonce)) == nonce
                except (ValueError, AttributeError):
                    valid_nonce = False
                challenge = {
                    "process": attention_process,
                    "revision": str(owner["revision"]),
                }
                if not valid_nonce:
                    return httpx.Response(409, json={"error": "strict synthetic owner required"})
                if path == "/api/attention/release":
                    if (
                        set(body) != {"room", "session", "expected"}
                        or nonce != owner["session"]
                        or body["expected"] != challenge
                    ):
                        return httpx.Response(409, json={"error": "stale synthetic release"})
                    owner["active"] = False
                    # Inert boundary only; no native/output/applied result is fabricated.
                    return httpx.Response(
                        200, json={"contract": "native_attention_v1", "outcome": "released"}
                    )
                if (
                    set(body)
                    != {
                        "room",
                        "level",
                        "owner",
                        "ttl_ms",
                        "fade_ms",
                        "session",
                        "expected",
                        "begin",
                    }
                    or type(body["begin"]) is not bool
                ):
                    return httpx.Response(400, json={"error": "invalid synthetic engage"})
                if body["begin"]:
                    if owner["active"] and nonce == owner["session"]:
                        expected = {
                            "process": attention_process,
                            "revision": str(owner["revision"] - 1),
                        }
                        if body["expected"] != expected:
                            return httpx.Response(409, json={"error": "stale synthetic BEGIN"})
                    elif (
                        owner["active"]
                        or nonce == owner["session"]
                        or body["expected"] != challenge
                    ):
                        return httpx.Response(409, json={"error": "stale synthetic BEGIN"})
                    else:
                        owner["revision"] += 1
                        owner["session"] = nonce
                elif (
                    not owner["active"]
                    or nonce != owner["session"]
                    or body["expected"] != challenge
                ):
                    return httpx.Response(409, json={"error": "stale synthetic UPDATE"})
                owner["active"] = True
                return httpx.Response(
                    200,
                    json={
                        "contract": "native_attention_v1",
                        "outcome": "pending",
                        "challenge": {
                            "process": attention_process,
                            "revision": str(owner["revision"]),
                        },
                    },
                )
            if (
                request.method == "POST"
                and str(request.url) == "https://api.openai.com/v1/audio/speech"
            ):
                # Startup's original prewarm owns this refusal; no TTS audio produced.
                return httpx.Response(503, json={"error": "inert speech unavailable"})
            state.forbidden.append((request.method, str(request.url)))
            raise AssertionError("unadmitted outbound fixture operation")

        def http_client(*args, **kwargs):
            result = httpx.AsyncClient(*args, **kwargs, transport=httpx.MockTransport(transport))
            state.clients.append(result)
            return result

        patches.setattr(
            main, "httpx", SimpleNamespace(AsyncClient=http_client, Timeout=httpx.Timeout)
        )
        original_attention = main.AttentionClient
        patches.setattr(
            main,
            "AttentionClient",
            lambda base_url, token=None: original_attention(
                base_url, token, client=http_client(base_url=base_url)
            ),
        )
        original_speech = main.Speech
        patches.setattr(
            main,
            "Speech",
            lambda key, **kwargs: original_speech(key, **kwargs, client=http_client()),
        )
        original_trace = audio_trace.AudioTraceRecorder

        def trace(**kwargs):
            owner = original_trace(folder / "audio", **kwargs)
            state.traces.append(owner)
            return owner

        patches.setattr(audio_trace, "AudioTraceRecorder", trace)
        original_tools = main.ToolRouter

        def router(*args, **kwargs):
            owner = original_tools(*args, **kwargs)
            state.tools = owner
            configure = owner.configure_device_control

            def observed_configure(values):
                before = _device_contract(owner)
                result = configure(values)
                state.configure_calls.append(
                    (copy.deepcopy(values), before, _device_contract(owner))
                )
                return result

            owner.configure_device_control = observed_configure
            return owner

        patches.setattr(main, "ToolRouter", router)
        original_timers = main.TimerManager

        def timers(*args, **kwargs):
            owner = original_timers(*args, **kwargs)
            state.timers = owner
            return owner

        patches.setattr(main, "TimerManager", timers)
        original_usage = main.UsageMeter

        def usage(*args, **kwargs):
            owner = original_usage(*args, **kwargs)
            state.usage = owner
            return owner

        patches.setattr(main, "UsageMeter", usage)
        patches.setattr(main, "VoicePELink", lambda _host, _psk, *, room: Device(room=room))
        patches.setattr(main, "_host_ip_for", lambda _host: "192.0.2.1")
        patches.setattr(main, "_ROOM_NAMES", {})

        def realtime_client():
            wire = _QueueWS()
            wire.incoming.put_nowait(
                _Message({"type": "session.updated", "session": {"type": "realtime"}})
            )
            owner = _HTTP(wire)
            state.realtime_http.append(owner)
            return owner

        patches.setattr(
            openai_realtime,
            "aiohttp",
            SimpleNamespace(ClientSession=realtime_client, WSMsgType=aiohttp.WSMsgType),
        )
        original_build = main._build_session

        def build(*args, **kwargs):
            session = original_build(*args, **kwargs)
            state.built_sessions.append(session)
            observers = state.aclose_observers[session] = []
            original_close = session.aclose

            async def observed_close():
                observer = asyncio.current_task()
                if observer not in observers:
                    observers.append(observer)
                await original_close()

            session.aclose = observed_close
            sdk = SDK()
            budget = ProviderBudgetCoordinator()
            session.live_brain.client_factory = sdk.factory
            session.live_brain.provider_budget = budget
            session._realtime_brain.provider_budget = budget
            state.sdk.append(sdk)
            return session

        patches.setattr(main, "_build_session", build)
        original_create = main.create_app

        def create(*args, **kwargs):
            app = original_create(*args, **kwargs)
            state.app, state.sessions = app, args[1]
            hook = app[SETTINGS_SET]
            assert hook.__code__.co_qualname == "run.<locals>.save_runtime_settings"
            assert hook.__globals__ is vars(main)
            assert any(cell.cell_contents is state.tools for cell in hook.__closure__)
            return app

        patches.setattr(main, "create_app", create)

        async def cleanup_runner():
            state.runner_cleaned = True

        async def start_web(app):
            assert app is state.app
            return SimpleNamespace(cleanup=cleanup_runner)

        patches.setattr(main, "start_web", start_web)
        main_asyncio = SimpleNamespace(**vars(asyncio))

        def create_owned_task(coroutine, **kwargs):
            task = asyncio.create_task(coroutine, **kwargs)
            state.main_tasks.append(task)
            return task

        main_asyncio.create_task = create_owned_task
        patches.setattr(main, "asyncio", main_asyncio)
        loop = asyncio.get_running_loop()
        patches.setattr(
            loop,
            "add_signal_handler",
            lambda signum, callback: state.stop_callbacks.setdefault(signum, callback),
        )
        try:
            state.task = asyncio.create_task(main.run(cfg), name="fixture-actual-main")
            await _observed(
                lambda: (
                    state.app is not None
                    and signal.SIGTERM in state.stop_callbacks
                    and all(s.voicepe.started for s in state.sessions.values())
                ),
                main_task=state.task,
            )
            client = TestClient(TestServer(state.app), timeout=aiohttp.ClientTimeout(total=5))
            await client.start_server()
            state.client = client
            yield state
        except BaseException as exc:
            primary = exc
            raise
        finally:
            cleanup_errors = []
            retained = {session: _session_owners(session) for session in state.built_sessions}

            async def finish(operation, *, bound=15):
                try:
                    async with asyncio.timeout(bound):
                        await operation
                except BaseException as exc:
                    cleanup_errors.append(exc)

            if state.task is not None:
                stop = state.stop_callbacks.get(signal.SIGTERM)
                if stop is not None:
                    stop()
                elif not state.task.done():
                    state.task.cancel()
                await finish(asyncio.shield(state.task))
                if not state.task.done():
                    state.task.cancel()
                    await finish(asyncio.shield(state.task), bound=2)
            for task in state.main_tasks:
                if not task.done():
                    task.cancel()
                await finish(asyncio.gather(task, return_exceptions=True), bound=2)
            # Only this exact fixture's metering task: not a global task sweep.
            push = getattr(state.usage, "_push_task", None)
            if push is not None:
                if not push.done():
                    push.cancel()
                await finish(asyncio.gather(push, return_exceptions=True), bound=2)
            if client is not None:
                await finish(client.close())
            for session in state.built_sessions:
                # The helper owns bounded observer/true-close/suffix joins itself.
                try:
                    observers = state.aclose_observers[session]
                    already_terminal = False
                    try:
                        _assert_session_terminal(session, retained[session], observers)
                    except AssertionError:
                        pass
                    else:
                        already_terminal = True
                    observer_count, request_count = len(observers), len(state.requests)
                    await _complete_session_shutdown(session, retained[session], observers)
                    if already_terminal:
                        assert len(observers) == observer_count
                        assert len(state.requests) == request_count
                except BaseException as exc:
                    cleanup_errors.append(exc)
            for owner in state.realtime_http:
                if not owner.closed:
                    await finish(owner.close())
            for owner in state.traces:
                # Main normally joins this writer; rescue only the exact retained writer.
                if owner._writer is not None and owner._writer.thread.is_alive():
                    await finish(owner.wait_pending(timeout_s=3))
                    await finish(owner.shutdown(timeout_s=1))
                if owner._writer is not None and owner._writer.thread.is_alive():
                    cleanup_errors.append(RuntimeError("fixture trace writer was not joined"))
            for owner in state.clients:
                if not owner.is_closed:
                    await finish(owner.aclose())
            if state.task is not None and not state.task.done():
                cleanup_errors.append(RuntimeError("actual main task was not joined"))
            if any(not task.done() for task in state.main_tasks):
                cleanup_errors.append(RuntimeError("actual main background task was not joined"))
            if push is not None and not push.done():
                cleanup_errors.append(RuntimeError("fixture metering task was not joined"))
            if cleanup_errors:
                if primary is None:
                    raise cleanup_errors[0]
                for exc in cleanup_errors:
                    primary.add_note(f"actual-main fixture cleanup failed: {exc!r}")


def _preferences(path, initial_live):
    return settings.save_settings(
        {
            "live_alpha": initial_live,
            "rooms": [
                {"voicepe_host": "fixture-one.local", "room": "kitchen"},
                {"voicepe_host": "fixture-two.local", "room": "bedroom"},
            ],
            "podconnect_token": "inert-secret",
            "extended_device_control": True,
            "device_control_entities": ["vacuum.fixture"],
        },
        path,
    )


@pytest.mark.parametrize("initial_live", [False, True])
async def test_actual_main_save_keeps_active_owner_until_next_wake_and_isolates_restart(
    tmp_path, monkeypatch, initial_live
):
    path, options = tmp_path / "settings.json", tmp_path / "options.json"
    options.write_text(json.dumps({"openai_api_key": "inert-settings-contract"}))
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    original_saved = _preferences(path, initial_live)
    original_bytes = path.read_bytes()
    expected = {**original_saved, "live_alpha": not initial_live}
    async with _actual_main_app(monkeypatch, tmp_path / "boot-one", options) as actual:
        session = actual.sessions["kitchen"]
        async with asyncio.timeout(20):
            await session.wake()
        active, device = _active_contract(session), _device_contract(actual.tools)
        timer = actual.timers
        assert session._active and session.live_alpha is initial_live
        assert timer.list_timers()["timers"] == []
        configure_count = len(actual.configure_calls)
        for invalid in (
            {"live_alpha": "true"},
            {"rooms": [{"voicepe_host": "partial.local"}]},
            {"device_control_entities": ["light.invalid"]},
        ):
            response = await actual.client.post("/api/settings", json=invalid)
            assert response.status == 400 and (await response.json())["ok"] is False
            assert path.read_bytes() == original_bytes
            assert _active_contract(session) == active and _device_contract(actual.tools) == device
            assert len(actual.configure_calls) == configure_count
            assert actual.timers is timer and timer.list_timers()["timers"] == []
            assert actual.restart_calls == []
        response = await actual.client.post(
            "/api/settings",
            json={"live_alpha": not initial_live, "podconnect_token": settings.SECRET_MASK},
        )
        assert response.status == 200 and (await response.json())["settings"] == settings.masked(
            expected
        )
        assert json.loads(path.read_text()) == expected and settings.load_settings(path) == expected
        assert len(actual.configure_calls) == configure_count + 1
        assert actual.configure_calls[-1][0] == expected
        assert _active_contract(session) == active and _device_contract(actual.tools) == device
        assert actual.restart_calls == []
        response = await actual.client.get("/api/settings")
        readback = await response.json()
        assert readback["live_alpha"] is (not initial_live)
        assert readback["live_alpha_active"] == {"kitchen": initial_live, "bedroom": None}
        assert readback["podconnect_token"] == settings.SECRET_MASK
        fresh_cfg = load_config(options)
        assert fresh_cfg.live_alpha is (not initial_live)
        assert actual.cfg.live_alpha is initial_live
        assert replace(fresh_cfg, live_alpha=actual.cfg.live_alpha) == actual.cfg
        await session.wake()
        assert _active_contract(session) == active
        old_generation = session.voicepe.audio_generation
        async with asyncio.timeout(15):
            await session.stop()
        assert not session._active and not session._teardown_incomplete
        assert session.voicepe.rearm_calls == 1 and not session.voicepe.streaming
        assert session.voicepe.audio_generation > old_generation
        async with asyncio.timeout(20):
            await session.wake()
        assert session._active and session.live_alpha is (not initial_live)
        assert session.brain is not active[0]
        assert session.brain is (session._realtime_brain if initial_live else session.live_brain)
        assert _device_contract(actual.tools) == device
        assert actual.timers is timer and timer.list_timers()["timers"] == []
        saved_bytes = path.read_bytes()
        for result in (204, 500, "transport-error"):
            actual.restart_status = result
            before = len(actual.restart_calls)
            response = await actual.client.post("/api/restart", json={})
            assert response.status == 200 and (await response.json())["ok"] is (result == 204)
            assert len(actual.restart_calls) == before + 1
            assert actual.restart_calls[-1].headers["Authorization"] == "Bearer inert-supervisor"
            assert path.read_bytes() == saved_bytes
            # Scripted supervisor HTTP does not restart the running main/session.
            assert session._active and session.live_alpha is (not initial_live)
        assert not actual.forbidden
    assert actual.runner_cleaned and all(s.voicepe.closed for s in actual.sessions.values())
    # Fresh boot is a new actual run/load, not a claim of real Supervisor reboot.
    async with _actual_main_app(monkeypatch, tmp_path / "boot-two", options) as boot:
        assert settings.load_settings(path) == expected
        assert not boot.sessions["kitchen"]._active
        async with asyncio.timeout(20):
            await boot.sessions["kitchen"].wake()
        assert boot.sessions["kitchen"].live_alpha is (not initial_live)
        assert boot.tools._device_control._enabled and boot.tools._device_control._entities == (
            "vacuum.fixture",
        )
        assert boot.cfg.live_alpha is (not initial_live)
        assert actual.cfg.live_alpha is initial_live
        assert replace(boot.cfg, live_alpha=actual.cfg.live_alpha) == actual.cfg
        assert not boot.forbidden


@pytest.mark.parametrize("initial_live", [False, True])
async def test_actual_main_device_control_save_has_separate_shared_authorization_boundary(
    tmp_path, monkeypatch, initial_live
):
    path, options = tmp_path / "settings.json", tmp_path / "options.json"
    options.write_text(json.dumps({"openai_api_key": "inert-settings-contract"}))
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    _preferences(path, initial_live)
    async with _actual_main_app(monkeypatch, tmp_path / "boot", options) as actual:
        session = actual.sessions["kitchen"]
        async with asyncio.timeout(20):
            await session.wake()
        active, before = _active_contract(session), _device_contract(actual.tools)
        old_control_names = {row["name"] for row in actual.tools._device_control.declarations()}
        assert old_control_names
        response = await actual.client.post(
            "/api/settings", json={"extended_device_control": False}
        )
        assert response.status == 200 and (await response.json())["ok"] is True
        assert _active_contract(session) == active
        after = _device_contract(actual.tools)
        assert after[0] is before[0] and after[1] == before[1] + 1
        assert after[2] is False and after[3] == before[3]
        assert after[4] == {} and after[5] == before[5]
        assert not (old_control_names & {row["name"] for row in after[6]})
        request_count = len(actual.requests)
        for name in sorted(old_control_names):
            result = await actual.tools.dispatch(
                name, {}, expected_declaration_sha256=active[7][name]
            )
            assert result["ok"] is False and result["error_kind"] == "stale_schema"
        assert len(actual.requests) == request_count
        async with asyncio.timeout(15):
            await session.stop()
        assert not session._teardown_incomplete and session.voicepe.rearm_calls == 1
        async with asyncio.timeout(20):
            await session.wake()
        assert session.live_alpha is initial_live
        assert not (old_control_names & set(session._tool_declaration_hashes))
        assert not (old_control_names & {row["name"] for row in session.brain.tool_declarations})
        assert actual.timers.list_timers()["timers"] == [] and not actual.forbidden


async def test_actual_main_restart_without_supervisor_token_never_sends_request(
    tmp_path, monkeypatch
):
    path, options = tmp_path / "settings.json", tmp_path / "options.json"
    options.write_text(json.dumps({"openai_api_key": "inert-settings-contract"}))
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    _preferences(path, False)
    original_bytes = path.read_bytes()
    async with _actual_main_app(
        monkeypatch, tmp_path / "boot", options, supervisor_token=""
    ) as actual:
        response = await actual.client.post("/api/restart", json={})
        assert response.status == 200 and (await response.json())["ok"] is False
        assert actual.restart_calls == [] and path.read_bytes() == original_bytes
        assert not actual.forbidden


@pytest.mark.parametrize("interruption", ["timeout", "cancel"])
async def test_actual_main_interrupted_close_joins_true_owner_and_adapter_suffix(
    tmp_path, monkeypatch, interruption
):
    path, options = tmp_path / "settings.json", tmp_path / "options.json"
    options.write_text(json.dumps({"openai_api_key": "inert-settings-contract"}))
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    _preferences(path, True)
    entered, release = asyncio.Event(), asyncio.Event()
    original_failure = RuntimeError("intentional original settings fixture failure")
    with pytest.raises(
        RuntimeError, match="intentional original settings fixture failure"
    ) as caught:
        async with _actual_main_app(monkeypatch, tmp_path / "boot", options) as actual:
            session = actual.sessions["kitchen"]
            async with asyncio.timeout(20):
                await session.wake()
            sdk = session.live_brain._manager
            assert sdk in actual.sdk
            original_exit = sdk.__aexit__

            async def held_exit(*args):
                entered.set()
                await release.wait()
                return await original_exit(*args)

            monkeypatch.setattr(sdk, "__aexit__", held_exit)
            retained = _session_owners(session)
            playback = session.playback._task
            assert playback is not None and not playback.done()
            try:
                actual.stop_callbacks[signal.SIGTERM]()
                async with asyncio.timeout(20):
                    await entered.wait()
                owner = session._close_task
                assert owner is not None and not owner.done()
                assert actual.task in actual.aclose_observers[session]
                if interruption == "timeout":
                    # Only the observer bound changes; production close bounds do not.
                    with pytest.raises(TimeoutError):
                        async with asyncio.timeout(0.001):
                            await asyncio.shield(actual.task)
                    assert not actual.task.done() and not owner.done()
                actual.task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    async with asyncio.timeout(15):
                        await asyncio.shield(actual.task)
                assert actual.task.done() and not owner.done()
                assert not session.voicepe.closed and not playback.done()
                release.set()
                await _complete_session_shutdown(
                    session, retained, actual.aclose_observers[session]
                )
                # These assertions precede the outer context's rescue.
                assert owner.done() and session._close_task is owner and sdk.released
                assert playback.done() and session.playback._task is None
                _assert_session_terminal(session, retained, actual.aclose_observers[session])
                raise original_failure
            finally:
                release.set()
    assert caught.value is original_failure
