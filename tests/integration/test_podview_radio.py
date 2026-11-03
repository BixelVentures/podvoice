"""Real guarded PodView routes -> independent mocked native radio HTTP owner."""

import asyncio
import json
import time
from types import SimpleNamespace

import httpx
import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_bridge import owner

from gatekeeper.hub import StatusHub
from gatekeeper.podview import _PAIR_COOKIE, BRIDGE
from gatekeeper.podview_radio import STATIONS, NativeRadio, validate_native
from gatekeeper.web import create_app

HEADERS = {"X-PodView-Request": "1"}


def native_state():
    now = time.time()
    return {
        "schema": "podconnect.radio.v1",
        "enabled": True,
        "blocked_reasons": [],
        "stations": [{"id": i, "name": name} for i, name in STATIONS],
        "targets": [
            {
                "id": "speaker-a",
                "name": "Stuen",
                "availability": "available",
                "selectable": True,
                "default": True,
            },
            {
                "id": "speaker-b",
                "name": "Køkken",
                "availability": "available",
                "selectable": True,
                "default": False,
            },
        ],
        "capabilities": ["start", "stop", "move", "volume"],
        "actions": ["start"],
        "state": "stopped",
        "station_id": "p3",
        "target_id": "speaker-a",
        "generation": 4,
        "revision": 5,
        "process_id": "native-process-a",
        "physical_result_verified": False,
        "retrieved_at": now,
        "valid_until": now + 5,
        "observed_at": now,
        "source_kind": "none",
        "owner_generation": 7,
        "volume_percent": 30,
    }


class Rig:
    def __init__(self):
        self.value = native_state()
        self.calls = []
        self.hook = None
        self.post_hook = None
        self.unknown = False
        self.reject = False
        self.result_reply = None
        self.result_hook = None

    async def request(self, request):
        assert request.headers["X-PodConnect-Token"] == "existing-private-token"
        assert request.url.host == "native.invalid"
        self.calls.append(
            (
                request.method,
                request.url.path,
                json.loads(request.content) if request.content else None,
            )
        )
        if request.method == "GET":
            if request.url.path == "/api/radio/result":
                if self.result_hook:
                    await self.result_hook()
                return (
                    httpx.Response(200, json=self.result_reply)
                    if self.result_reply is not None
                    else httpx.Response(409, text="result not terminal")
                )
            assert request.url.path == "/api/radio/state"
            if self.hook:
                await self.hook()
            return httpx.Response(200, json=self.value)
        assert request.url.path == "/api/radio/action"
        if self.post_hook:
            await self.post_hook()
        if self.unknown:
            raise httpx.ReadTimeout("unknown", request=request)
        return httpx.Response(
            503 if self.reject else 200,
            json={
                "schema": "podconnect.radio-action.v1",
                "action_id": json.loads(request.content)["action_id"],
                "status": "rejected" if self.reject else "accepted",
                "retry_allowed": False,
            },
        )


@pytest.fixture
async def rig():
    rig = Rig()
    native_http = httpx.AsyncClient(
        base_url="http://native.invalid",
        headers={"X-PodConnect-Token": "existing-private-token"},
        transport=httpx.MockTransport(rig.request),
    )
    native = NativeRadio("http://native.invalid", "existing-private-token", client=native_http)
    session, _ = owner()
    session._epoch = 1.0
    session._live_input_revision = 0
    session.brain.input_sequence = 0
    session.brain._connection_generation = 1
    from gatekeeper.tools import ToolRouter

    tools = ToolRouter(None)
    tools.podview_radio_native = native
    app = create_app(StatusHub(), {"kitchen": session}, tools=tools, locked=True)
    rig.bridge = app[BRIDGE]
    rig.token = rig.bridge.grant_timer_control("kitchen")
    async with TestClient(TestServer(app)) as client:
        rig.client = client
        yield rig


def offer_body(rig, **extra):
    return {
        "bootId": rig.bridge.boot_id,
        "roomId": "kitchen",
        "revision": rig.value["revision"],
        "action": "start",
        "stationId": "p3",
        "targetId": "speaker-a",
        "volumePercent": None,
        **extra,
    }


async def post(rig, route, body, *, paired=True):
    headers = {**HEADERS}
    if paired:
        headers["Cookie"] = f"{_PAIR_COOKIE}={rig.token}"
    return await rig.client.post("/view/api/radio/" + route, json=body, headers=headers)


async def offer(rig, **extra):
    return await (await post(rig, "offer", offer_body(rig, **extra))).json()


def action_body(offer):
    return {k: offer[k] for k in ("bootId", "roomId", "taskId", "optionId")}


def effects(rig):
    return [row for row in rig.calls if row[0] == "POST"]


async def test_real_routes_passive_read_and_single_use_native_execution(rig):
    response = await rig.client.get("/view/api/radio?room=kitchen")
    value = await response.json()
    assert response.headers["Cache-Control"] == "no-store"
    assert [s["id"] for s in value["stations"]] == [i for i, _ in STATIONS]
    assert value["state"]["status"] == "stopped"
    assert value["state"]["sourceKind"] == "none"
    assert value["state"]["ownerGeneration"] == 7
    assert value["enabled"] and not effects(rig)
    task = await offer(rig)
    assert task["ok"] and not effects(rig)
    outcome = await (await post(rig, "actions", action_body(task))).json()
    assert outcome == {
        "ok": True,
        "schema": "podview.radio-action.v1",
        "status": "accepted",
        "retryAllowed": False,
    }
    assert len(effects(rig)) == 1
    command = effects(rig)[0][2]
    assert command == {
        "action_id": task["taskId"],
        "action": "start",
        "station_id": "p3",
        "target_id": "speaker-a",
        "volume_percent": None,
        "expected_process_id": "native-process-a",
        "expected_revision": 5,
        "expected_generation": 4,
        "expected_owner_generation": 7,
    }
    assert not (await (await post(rig, "actions", action_body(task))).json())["ok"]
    assert len(effects(rig)) == 1
    # POST acceptance never fabricates observed playback.
    value = await (await rig.client.get("/view/api/radio")).json()
    assert value["state"]["status"] == "stopped"


@pytest.mark.parametrize("station", [i for i, _ in STATIONS])
async def test_all_existing_station_ids_share_same_action_owner(rig, station):
    task = await offer(rig, stationId=station)
    assert task["ok"]
    assert (await (await post(rig, "actions", action_body(task))).json())["status"] == "accepted"
    assert effects(rig)[0][2]["station_id"] == station


async def test_default_disabled_missing_native_is_honest_and_never_calls_spotify(rig):
    rig.bridge.radio.native = None
    value = await (await rig.client.get("/view/api/radio")).json()
    assert not value["enabled"] and value["actions"] == []
    assert value["retrievedAt"] is None and value["validUntil"] is None
    assert value["state"]["status"] == "unknown" and value["state"]["observedAt"] is None
    assert not (await offer(rig))["ok"] and not rig.calls


async def test_native_disabled_has_no_fake_observation_or_commands(rig):
    rig.value.update(
        enabled=False,
        blocked_reasons=["independent_radio_engine_missing"],
        actions=[],
        capabilities=[],
        state="idle",
        source_kind="unknown",
        observed_at=None,
        retrieved_at=None,
        valid_until=None,
    )
    for row in rig.value["targets"]:
        row["selectable"] = False
    value = await (await rig.client.get("/view/api/radio")).json()
    assert value["blockedReasons"] == ["independent_radio_engine_missing"]
    assert value["state"]["observedAt"] is None and value["retrievedAt"] is None
    assert not (await offer(rig))["ok"] and not effects(rig)


async def test_guard_pairing_and_closed_request_validation(rig):
    assert (await rig.client.post("/view/api/radio/offer", json=offer_body(rig))).status == 403
    assert (
        await rig.client.get("/view/api/radio", headers={"Sec-Fetch-Site": "cross-site"})
    ).status == 403
    assert (await rig.client.get("/view/api/radio?room=other")).status == 409
    assert not (await (await post(rig, "offer", offer_body(rig), paired=False)).json())["ok"]
    for change in (
        {"stationId": "https://arbitrary.invalid"},
        {"targetId": "foreign"},
        {"revision": 4},
        {"bootId": "old"},
        {"action": "resume"},
        {"action": "start", "volumePercent": 101},
        {"arbitrary": "field"},
    ):
        assert not (await offer(rig, **change))["ok"]
    response = await rig.client.post(
        "/view/api/radio/offer",
        data='{"roomId":"kitchen","roomId":"other"}',
        headers={**HEADERS, "Content-Type": "application/json"},
    )
    assert response.status == 400 and not effects(rig)


@pytest.mark.parametrize(
    "mutation",
    [
        "revision",
        "generation",
        "process_id",
        "owner_generation",
        "target",
        "session",
        "grant",
        "tools",
        "native",
        "expiry",
    ],
)
async def test_stale_offer_is_not_effect_authority(rig, mutation):
    task = await offer(rig)
    if mutation in {"revision", "generation", "owner_generation"}:
        rig.value[mutation] += 1
    elif mutation == "process_id":
        rig.value[mutation] = "new-process"
    elif mutation == "target":
        rig.value["targets"][0]["selectable"] = False
    elif mutation == "session":
        rig.bridge.sessions["kitchen"] = owner()[0]
    elif mutation == "grant":
        rig.bridge._grants.clear()
    elif mutation == "tools":
        rig.bridge.tools = SimpleNamespace()
    elif mutation == "native":
        rig.bridge.radio.native = None
    elif mutation == "expiry":
        rig.bridge.radio.tasks[task["taskId"]]["expires"] = time.time() - 1
    assert not (await (await post(rig, "actions", action_body(task))).json())["ok"]
    assert not effects(rig)


async def test_revocation_during_just_in_time_read_blocks_effect(rig):
    task = await offer(rig)

    async def revoke():
        rig.bridge._grants.clear()

    rig.hook = revoke
    assert not (await (await post(rig, "actions", action_body(task))).json())["ok"]
    assert not effects(rig)


async def test_unknown_post_fences_all_actions_and_does_not_retry(rig):
    task = await offer(rig)
    rig.unknown = True
    result = await (await post(rig, "actions", action_body(task))).json()
    assert result["status"] == "unknown" and not result["retryAllowed"]
    assert len(effects(rig)) == 1
    value = await (await rig.client.get("/view/api/radio")).json()
    assert not value["enabled"] and value["actions"] == [] and value["state"]["status"] == "unknown"
    assert not (await offer(rig))["ok"]
    assert not (await (await post(rig, "actions", action_body(task))).json())["ok"]
    assert len(effects(rig)) == 1


@pytest.mark.parametrize("source", ["none", "radio", "spotify"])
async def test_native_rejection_is_terminal_without_replay_or_source_change(rig, source):
    if source == "radio":
        rig.value.update(
            source_kind="radio", state="playing", station_id="p1", target_id="speaker-b"
        )
    elif source == "spotify":
        rig.value.update(
            source_kind="spotify", state="playing", station_id="", target_id="speaker-b"
        )
    before = await (await rig.client.get("/view/api/radio")).json()
    task = await offer(rig)
    assert task["ok"]
    rig.reject = True
    result = await (await post(rig, "actions", action_body(task))).json()
    assert result == {
        "ok": True,
        "schema": "podview.radio-action.v1",
        "status": "rejected",
        "retryAllowed": False,
    }
    service = rig.bridge.radio
    assert not service.unknown and service.unknown_proof is None and not service.busy
    assert task["taskId"] not in service.tasks
    after = await (await rig.client.get("/view/api/radio")).json()
    assert after["state"] == before["state"]
    assert after["actions"] == before["actions"] and after["enabled"] == before["enabled"]
    duplicate = await (await post(rig, "actions", action_body(task))).json()
    assert duplicate == {"ok": False, "error": "stale_radio_task", "retryAllowed": False}
    assert len(effects(rig)) == 1


async def test_two_clients_cannot_overlap_effects(rig):
    first, second = await offer(rig), await offer(rig, stationId="p1")
    entered, release = asyncio.Event(), asyncio.Event()

    async def wait():
        entered.set()
        await release.wait()

    rig.post_hook = wait
    running = asyncio.create_task(post(rig, "actions", action_body(first)))
    await entered.wait()
    assert not (await (await post(rig, "actions", action_body(second))).json())["ok"]
    release.set()
    assert (await (await running).json())["status"] == "accepted"
    assert len(effects(rig)) == 1


@pytest.mark.parametrize(
    "action,station,target,volume",
    [("stop", None, None, None), ("move", None, "speaker-b", None), ("volume", None, None, 42)],
)
async def test_radio_controls_use_only_native_radio_owner(rig, action, station, target, volume):
    rig.value.update(
        state="playing", source_kind="radio", actions=["start", "stop", "move", "volume"]
    )
    task = await offer(rig, action=action, stationId=station, targetId=target, volumePercent=volume)
    assert task["ok"]
    assert (await (await post(rig, "actions", action_body(task))).json())["status"] == "accepted"
    assert effects(rig)[0][2]["action"] == action


@pytest.mark.parametrize(
    "change",
    [
        {"retrieved_at": 0},
        {"valid_until": 0},
        {"observed_at": 0},
        {"state": "playing", "source_kind": "none"},
        {"target_id": "foreign"},
        {"station_id": "foreign"},
        {"source_kind": "untrusted"},
        {"capabilities": ["arbitrary"]},
    ],
)
def test_native_projection_rejects_stale_or_fabricated_authority(change):
    value = native_state()
    value.update(change)
    with pytest.raises((ValueError, TypeError)):
        validate_native(value)


async def test_wrong_option_or_other_room_does_not_consume_real_task(rig):
    task = await offer(rig)
    body = action_body(task)
    for change in ({"optionId": "wrong"}, {"roomId": "other"}, {"bootId": "wrong"}):
        assert not (await (await post(rig, "actions", {**body, **change})).json())["ok"]
    assert not effects(rig)
    assert (await (await post(rig, "actions", body)).json())["status"] == "accepted"


def voice_args(operation="read", **extra):
    return {
        "operation": operation,
        "action": None,
        "stationId": None,
        "targetId": None,
        "volumePercent": None,
        "taskId": None,
        "optionId": None,
        **extra,
    }


async def test_actual_tool_router_voice_shares_radio_task_and_native_owner(rig):
    from gatekeeper.execution_policy import ExecutionContext

    router = rig.bridge.tools
    context = ExecutionContext("s1", "live:1:response-one", "live")
    declaration = next(d for d in router.declarations() if d["name"] == "podview_radio")
    assert declaration["parameters"]["additionalProperties"] is False
    schema = router._schema_sha256_for_declarations([declaration])

    async def dispatch(args, **kwargs):
        return await router.dispatch(
            "podview_radio",
            args,
            execution_context=context,
            execution_guard=lambda: True,
            expected_declaration_sha256=schema,
            **kwargs,
        )

    read = await dispatch(voice_args())
    assert read["schema"] == "podview.radio.v1" and not effects(rig)
    task = await dispatch(voice_args("offer", action="start", stationId="p1", targetId="speaker-a"))
    assert task["ok"] and task["taskId"] in rig.bridge.radio.tasks
    result = await dispatch(voice_args("execute", taskId=task["taskId"], optionId=task["optionId"]))
    assert result["status"] == "accepted" and effects(rig)[0][2]["station_id"] == "p1"
    assert not (
        await dispatch(voice_args("execute", taskId=task["taskId"], optionId=task["optionId"]))
    )["ok"]
    assert len(effects(rig)) == 1


async def test_voice_schema_guard_and_changed_turn_reject_without_effect(rig):
    from gatekeeper.execution_policy import ExecutionContext

    router = rig.bridge.tools
    context = ExecutionContext("s1", "live:1:response-one", "live")
    for args in (
        voice_args(arbitrary="extra"),
        voice_args("offer", action="start", stationId="foreign", targetId="speaker-a"),
    ):
        value = await router.dispatch(
            "podview_radio", args, execution_context=context, execution_guard=lambda: True
        )
        assert not value["ok"]
    task = await router.dispatch(
        "podview_radio",
        voice_args("offer", action="start", stationId="p3", targetId="speaker-a"),
        execution_context=context,
        execution_guard=lambda: True,
    )
    rig.bridge.sessions["kitchen"]._live_input_revision += 1
    result = await router.dispatch(
        "podview_radio",
        voice_args("execute", taskId=task["taskId"], optionId=task["optionId"]),
        execution_context=context,
        execution_guard=lambda: True,
    )
    assert not result["ok"] and not effects(rig)
    result = await router.dispatch(
        "podview_radio", voice_args(), execution_context=context, execution_guard=lambda: False
    )
    assert not result["ok"] and not effects(rig)


async def test_actual_http_projection_matches_canonical_javascript_validator(rig):
    """Optional explicit cross-repository contract check against canonical UI bytes."""
    import os
    import shutil
    import subprocess
    from pathlib import Path

    canonical = os.environ.get("PODVIEW_CANONICAL_ROOT")
    if not canonical:
        pytest.skip("Set PODVIEW_CANONICAL_ROOT for the explicit canonical UI pair")
    module = Path(canonical) / "dist" / "live-radio-view.js"
    assert module.is_file()
    node = shutil.which("node")
    assert node
    projected = []
    for state, source in (("stopped", "none"), ("playing", "radio")):
        rig.value.update(state=state, source_kind=source)
        projected.append(await (await rig.client.get("/view/api/radio")).json())
    rig.value.update(
        enabled=False,
        state="idle",
        source_kind="unknown",
        actions=[],
        capabilities=[],
        blocked_reasons=["independent_radio_engine_missing"],
        retrieved_at=None,
        valid_until=None,
        observed_at=None,
    )
    for target in rig.value["targets"]:
        target["selectable"] = False
    projected.append(await (await rig.client.get("/view/api/radio")).json())
    script = """
import assert from 'node:assert/strict';
const {radioObservation}=await import(process.argv[1]);
let text='';for await(const chunk of process.stdin)text+=chunk;
for(const value of JSON.parse(text)){
 const snapshot={bootId:value.bootId,roomId:value.roomId};
 assert.ok(radioObservation(value,snapshot));
 assert.equal(radioObservation({...value,roomId:'foreign'},snapshot),null);
 assert.equal(radioObservation({...value,state:{...value.state,generation:-1}},snapshot),null);
}
"""
    result = await asyncio.to_thread(
        subprocess.run,
        [node, "--input-type=module", "-e", script, module.as_uri()],
        input=json.dumps(projected),
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


async def test_native_go_empty_ids_are_absence_and_error_text_is_never_forwarded(rig):
    rig.value.update(
        enabled=False,
        blocked_reasons=["native_all_effect_path_fences"],
        actions=[],
        capabilities=[],
        state="idle",
        source_kind="unknown",
        station_id="",
        target_id="",
        observed_at=None,
        retrieved_at=None,
        valid_until=None,
        error="private upstream diagnostic",
    )
    for row in rig.value["targets"]:
        row["selectable"] = False
    value = await (await rig.client.get("/view/api/radio")).json()
    assert value["state"]["stationId"] is None and value["state"]["targetId"] is None
    assert value["blockedReasons"] == ["native_all_effect_path_fences"]
    assert "private" not in json.dumps(value)
    assert not (await offer(rig))["ok"] and not effects(rig)


async def test_cancellation_after_native_send_keeps_unknown_fence(rig):
    task = await offer(rig)
    entered = asyncio.Event()

    async def wait():
        entered.set()
        await asyncio.Event().wait()

    rig.post_hook = wait
    running = asyncio.create_task(rig.bridge.radio.action(action_body(task), rig.token))
    await entered.wait()
    running.cancel()
    with pytest.raises(asyncio.CancelledError):
        await running
    assert rig.bridge.radio.unknown and not rig.bridge.radio.busy
    assert not (await offer(rig))["ok"] and len(effects(rig)) == 1


async def test_actual_thin_live_batches_offer_execute_across_response_ids_and_revoke_input(rig):
    from integration.test_thin_live import build, emit, until
    from unit.test_openai_live import call, created, terminal

    session, sdk, _, _, _ = build()
    router = rig.bridge.tools
    session.tools = router
    rig.bridge.sessions["kitchen"] = session
    observed = []
    dispatch = router.dispatch

    async def record(name, args, **kwargs):
        result = await dispatch(name, args, **kwargs)
        observed.append((kwargs["execution_context"], kwargs["execution_guard"], result))
        return result

    router.dispatch = record
    await session.start()
    try:
        await session.wake()
        first = voice_args("offer", action="start", stationId="p3", targetId="speaker-a")
        await emit(
            sdk,
            created("radio-offer"),
            call(name="podview_radio", arguments=json.dumps(first)),
            terminal("radio-offer"),
        )
        await until(lambda: len(observed) == 1)
        context1, old_guard, task = observed[0]
        assert context1.turn_id.startswith("live:")
        assert context1.turn_id != session._external_turn_id()
        assert task["ok"] and not effects(rig)
        second = voice_args("execute", taskId=task["taskId"], optionId=task["optionId"])
        await emit(
            sdk,
            created("radio-execute"),
            call(call_id="execute", name="podview_radio", arguments=json.dumps(second)),
            terminal("radio-execute"),
        )
        await until(lambda: len(observed) == 2)
        assert observed[1][0].turn_id != context1.turn_id
        assert not old_guard()  # prior admitted batch was retired by actual provider
        assert observed[1][2]["status"] == "accepted" and len(effects(rig)) == 1
        await emit(
            sdk,
            created("radio-next-offer"),
            call(call_id="offer2", name="podview_radio", arguments=json.dumps(first)),
            terminal("radio-next-offer"),
        )
        await until(lambda: len(observed) == 3)
        task2 = observed[2][2]
        assert task2["ok"]
        revision = session._live_input_revision
        await emit(
            sdk,
            {
                "type": "session.input_transcript.delta",
                "delta": "Nej",
                "start_ms": 1000,
                "end_ms": 1200,
            },
        )
        await until(lambda: session._live_input_revision > revision)
        stale = voice_args("execute", taskId=task2["taskId"], optionId=task2["optionId"])
        await emit(
            sdk,
            created("radio-stale"),
            call(call_id="stale", name="podview_radio", arguments=json.dumps(stale)),
            terminal("radio-stale"),
        )
        await until(lambda: len(observed) == 4)
        assert not observed[3][2]["ok"] and len(effects(rig)) == 1
    finally:
        await session.aclose()


@pytest.mark.parametrize(
    "change", ["epoch", "revision", "input", "brain", "connection", "mute", "missing_revision"]
)
async def test_voice_continuity_cannot_rebind_an_old_offer(rig, change):
    from gatekeeper.execution_policy import ExecutionContext

    router = rig.bridge.tools
    context = ExecutionContext("s1", "live:1:first-response", "live")
    task = await router.dispatch(
        "podview_radio",
        voice_args("offer", action="start", stationId="p3", targetId="speaker-a"),
        execution_context=context,
        execution_guard=lambda: True,
    )
    assert task["ok"]
    session = rig.bridge.sessions["kitchen"]
    if change == "epoch":
        session._epoch += 1
    elif change == "revision":
        session._live_input_revision += 1
    elif change == "input":
        session.brain.input_sequence += 1
    elif change == "brain":
        session.brain = SimpleNamespace(input_sequence=0, _connection_generation=1)
    elif change == "connection":
        session.brain._connection_generation += 1
    elif change == "mute":
        session._muted = True
    elif change == "missing_revision":
        del session._live_input_revision
    result = await router.dispatch(
        "podview_radio",
        voice_args("execute", taskId=task["taskId"], optionId=task["optionId"]),
        execution_context=ExecutionContext("s1", "live:1:second-response", "live"),
        execution_guard=lambda: True,
    )
    assert not result["ok"] and not effects(rig)


@pytest.mark.parametrize("native_outcome", ["accepted", "rejected"])
async def test_actual_canonical_transport_calls_real_radio_routes(rig, native_outcome):
    import os
    import shutil
    import subprocess
    from pathlib import Path

    canonical = os.environ.get("PODVIEW_CANONICAL_ROOT")
    if not canonical:
        pytest.skip("Set PODVIEW_CANONICAL_ROOT for the explicit canonical UI pair")
    rig.reject = native_outcome == "rejected"
    module = Path(canonical) / "dist" / "podvoice-transport.js"
    assert module.is_file()
    node = shutil.which("node")
    assert node
    script = """
import assert from 'node:assert/strict';
const {PodVoiceTransport}=await import(process.argv[1]);
let text='';for await(const chunk of process.stdin)text+=chunk;const p=JSON.parse(text);
const transport=new PodVoiceTransport({url:p.url,room:'kitchen',fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Cookie:p.cookie}})});
transport.closed=false;transport.connected=true;transport.controller=new AbortController();
transport.snapshot={bootId:p.boot,roomId:'kitchen'};
const state=await transport.radio();assert.equal(state.schema,'podview.radio.v1');
const offer=await transport.radioOffer({bootId:p.boot,roomId:'kitchen',revision:state.revision,action:'start',stationId:'p3',targetId:'speaker-a',volumePercent:null});
const result=await transport.radioAction(offer);assert.equal(result.status,p.nativeOutcome);assert.equal(result.retryAllowed,false);
const observed=await transport.radio();assert.equal(observed.state.status,'stopped');
"""
    result = await asyncio.to_thread(
        subprocess.run,
        [node, "--input-type=module", "-e", script, module.as_uri()],
        input=json.dumps(
            {
                "url": str(rig.client.make_url("/view/")),
                "cookie": f"{_PAIR_COOKIE}={rig.token}",
                "boot": rig.bridge.boot_id,
                "nativeOutcome": native_outcome,
            }
        ),
        text=True,
        capture_output=True,
        check=False,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    assert len(effects(rig)) == 1 and effects(rig)[0][2]["station_id"] == "p3"


def export_go_radio_contract(output, command=None):
    """Invoke actual Go serializers in the explicitly paired, inert sibling tree."""
    import os
    import shutil
    import subprocess
    from pathlib import Path

    root = Path(
        os.environ.get(
            "PODVIEW_RADIO_GO_ROOT", str(Path(__file__).resolve().parents[3] / "podconnect")
        )
    )
    manager = root / "podconnect" / "manager"
    go = os.environ.get("PODVIEW_RADIO_GO") or shutil.which("go")
    if not go or not (manager / "radio_contract_export_test.go").is_file():
        pytest.skip("Explicit Go/Python radio pair requires Go and sibling contract exporter")
    result = subprocess.run(
        [
            go,
            "test",
            "-ldflags=-linkmode=external",
            "-run",
            "^TestRadioExportBridgeContract$",
            "-count=1",
            ".",
        ],
        cwd=manager,
        env={
            **os.environ,
            "PODVIEW_RADIO_CONTRACT_OUTPUT": str(output),
            "PODVIEW_RADIO_CONTRACT_COMMAND": json.dumps(command) if command is not None else "",
        },
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr + result.stdout
    return json.loads(output.read_text())


@pytest.fixture(scope="module")
def actual_go_radio_contract(tmp_path_factory):
    return export_go_radio_contract(tmp_path_factory.mktemp("radio-go-wire") / "contract.json")


async def test_actual_go_snapshots_cross_native_bridge_and_canonical_parser(
    rig, actual_go_radio_contract
):
    import os
    import shutil
    import subprocess
    from pathlib import Path

    canonical = os.environ.get("PODVIEW_CANONICAL_ROOT")
    if not canonical:
        pytest.skip("Explicit canonical radio parser root required")
    projected = []
    for name, raw in actual_go_radio_contract["cases"].items():
        rig.value = raw
        value = await (await rig.client.get("/view/api/radio?room=kitchen")).json()
        assert value["state"]["generation"] == raw["generation"], name
        assert value["state"]["sourceKind"] == raw["source_kind"], name
        assert value["state"]["observedAt"] == raw["observed_at"], name
        if raw["valid_until"] is None:
            assert not value["enabled"] and value["actions"] == [], name
            assert value["retrievedAt"] is None and value["validUntil"] is None, name
            assert not (await offer(rig, targetId="r1"))["ok"], name
        else:
            assert value["enabled"] and value["actions"] == raw["actions"], name
        if name == "spotify":
            assert value["state"]["status"] == "idle" and value["actions"] == ["start"]
        if name == "unknown":
            assert value["state"]["status"] == "unknown"
        assert not effects(rig), name
        projected.append(value)
    script = """
import assert from 'node:assert/strict';
const {radioObservation}=await import(process.argv[1]);let text='';for await(const c of process.stdin)text+=c;
for(const value of JSON.parse(text))assert.ok(radioObservation(value,{bootId:value.bootId,roomId:value.roomId}),JSON.stringify(value));
"""
    result = await asyncio.to_thread(
        subprocess.run,
        [
            shutil.which("node"),
            "--input-type=module",
            "-e",
            script,
            (Path(canonical) / "dist/live-radio-view.js").as_uri(),
        ],
        input=json.dumps(projected),
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("name", ["accepted", "unknown", "rejected"])
async def test_actual_go_http_receipt_uses_native_adapter_without_retry(
    actual_go_radio_contract, name
):
    entry = actual_go_radio_contract["receipts"][name]
    calls = []

    async def request(request):
        calls.append(json.loads(request.content))
        return httpx.Response(entry["status_code"], json=entry["body"])

    async with httpx.AsyncClient(
        base_url="http://native.invalid", transport=httpx.MockTransport(request)
    ) as client:
        native = NativeRadio("http://native.invalid", "inert-token", client=client)
        receipt = await native.execute({"action_id": "contract-" + name})
    assert receipt["status"] == name and receipt["retry_allowed"] is False
    assert len(calls) == 1


@pytest.mark.parametrize(
    "change",
    [
        {"capabilities": ["start", "start"]},
        {"capabilities": ["spotify_pause"]},
        {"capabilities": ["stop"]},
        {"actions": ["start", "start"]},
        {"actions": ["spotify_pause"]},
        {"actions": ["start", "stop"]},
        {"state": "unknown", "actions": ["start"]},
        {"state": "preparing", "actions": ["start"]},
    ],
)
def test_protocol_capability_does_not_grant_unoffered_or_inapplicable_actions(change):
    raw = native_state()
    raw.update(change)
    with pytest.raises(ValueError):
        validate_native(raw)


@pytest.mark.parametrize(
    "state,source,actions",
    [
        ("idle", "none", ["start"]),
        ("stopped", "none", ["start"]),
        ("preparing", "radio", []),
        ("unknown", "unknown", []),
        ("playing", "radio", ["start", "stop", "move", "volume"]),
    ],
)
def test_capabilities_are_protocol_support_not_current_action_equality(state, source, actions):
    raw = native_state()
    raw.update(state=state, source_kind=source, actions=actions)
    assert validate_native(raw)["actions"] == actions


@pytest.mark.parametrize(
    "change",
    [
        {"valid_until": 1e15},
        {"observed_at": None},
        {"capabilities": ["start", "stop", "move", "volume", "start"]},
    ],
)
def test_partial_observation_or_unbounded_lease_never_becomes_radio_authority(change):
    raw = native_state()
    raw.update(change)
    with pytest.raises(ValueError):
        validate_native(raw)


async def unknown_start(rig):
    task = await offer(rig)
    rig.unknown = True
    outcome = await (await post(rig, "actions", action_body(task))).json()
    assert outcome["status"] == "unknown"
    rig.unknown = False
    return task


def terminal_result(rig, task, *, outcome="committed"):
    now = time.time()
    return {
        "schema": "podconnect.radio-result.v1",
        "process_id": "native-process-a",
        "action_id": task["taskId"],
        "generation": 5,
        "terminal": True,
        "outcome": outcome,
        "observation": {
            "state": "playing",
            "source_kind": "radio",
            "station_id": "p3",
            "target_id": "speaker-a",
            "owner_generation": 8,
            "observed_at": now,
            "valid_until": now + 5,
            "volume_percent": 30,
        },
    }


def recovered_state(result):
    raw = native_state()
    observation = result["observation"]
    raw.update(
        **observation,
        retrieved_at=observation["observed_at"],
        generation=6,
        revision=7,
        actions=["start", "stop", "move", "volume"],
    )
    return raw


async def test_unknown_recovers_only_correlated_terminal_result_then_fresh_native_read(rig):
    task = await unknown_start(rig)
    rig.result_reply = terminal_result(rig, task)
    rig.value.update(
        state="unknown",
        source_kind="unknown",
        generation=5,
        revision=6,
        retrieved_at=None,
        valid_until=None,
        observed_at=None,
        actions=[],
    )

    async def settle():
        rig.value = recovered_state(rig.result_reply)

    rig.result_hook = settle
    rig.bridge._grants.clear()  # passive reconciliation cannot renew this retired grant
    value = await (await rig.client.get("/view/api/radio")).json()
    assert value["enabled"] and value["state"]["status"] == "playing"
    assert not rig.bridge.radio.unknown and rig.bridge.radio.unknown_proof is None
    assert not (await (await post(rig, "actions", action_body(task))).json())["ok"]
    assert not (await offer(rig))["ok"]  # cleared UNKNOWN does not grant a revoked actor
    assert len(effects(rig)) == 1


async def test_arbitrary_new_native_snapshot_does_not_settle_unknown(rig):
    task = await unknown_start(rig)
    rig.value = recovered_state(terminal_result(rig, task))
    value = await (await rig.client.get("/view/api/radio")).json()
    assert not value["enabled"] and rig.bridge.radio.unknown
    assert not (await offer(rig))["ok"] and len(effects(rig)) == 1


@pytest.mark.parametrize(
    "mutation",
    [
        "process",
        "action",
        "generation",
        "nonterminal",
        "stale",
        "station",
        "target",
        "extra",
        "future",
        "unknown",
    ],
)
async def test_wrong_or_stale_result_cannot_unlock_unknown(rig, mutation):
    task = await unknown_start(rig)
    rig.result_reply = terminal_result(rig, task)
    result = rig.result_reply
    if mutation == "process":
        result["process_id"] = "other"
    if mutation == "action":
        result["action_id"] = "other"
    if mutation == "generation":
        result["generation"] += 1
    if mutation == "nonterminal":
        result["terminal"] = False
    if mutation == "stale":
        result["observation"]["observed_at"] = time.time() - 10
    if mutation == "future":
        result["observation"]["valid_until"] = time.time() + 60
    if mutation == "station":
        result["observation"]["station_id"] = "p1"
    if mutation == "target":
        result["observation"]["target_id"] = "speaker-b"
    if mutation == "extra":
        result["observation"]["extra"] = True
    if mutation == "unknown":
        result["observation"]["state"] = "unknown"
    rig.value = recovered_state(terminal_result(rig, task))
    value = await (await rig.client.get("/view/api/radio")).json()
    assert not value["enabled"] and rig.bridge.radio.unknown
    assert len(effects(rig)) == 1


@pytest.mark.parametrize(
    "replacement", ["native_process", "native_client", "tools", "bridge_boot", "old_observation"]
)
async def test_terminal_result_cannot_cross_source_replacement(rig, replacement):
    task = await unknown_start(rig)
    rig.result_reply = terminal_result(rig, task)
    rig.value = recovered_state(rig.result_reply)

    async def replace():
        if replacement == "native_process":
            rig.value["process_id"] = "replacement"
        if replacement == "native_client":
            rig.bridge.radio.native = None
        if replacement == "tools":
            rig.bridge.tools = SimpleNamespace()
        if replacement == "bridge_boot":
            rig.bridge.boot_id = "replacement"
        if replacement == "old_observation":
            rig.value["observed_at"] -= 1

    rig.result_hook = replace
    value = await (await rig.client.get("/view/api/radio")).json()
    assert not value["enabled"] and rig.bridge.radio.unknown
    assert len(effects(rig)) == 1


@pytest.mark.parametrize("method,limit", [("read", 32768), ("execute", 4096), ("result", 8192)])
async def test_native_adapter_stops_streaming_after_bounded_bytes(method, limit):
    consumed = []

    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            for index in range(100):
                consumed.append(index)
                yield b"x" * 1024

    async def request(request):
        return httpx.Response(200, stream=Stream())

    async with httpx.AsyncClient(
        base_url="http://native.invalid", transport=httpx.MockTransport(request)
    ) as client:
        native = NativeRadio("http://native.invalid", "inert", client=client)
        with pytest.raises(ValueError, match="bounded body"):
            if method == "read":
                await native.read()
            elif method == "execute":
                await native.execute({"action_id": "bounded"})
            else:
                await native.result({"process_id": "p", "action_id": "a", "generation": 1})
    assert len(consumed) == limit // 1024 + 1


async def test_native_action_timeout_covers_bounded_preflight_plus_effect_without_retry():
    observed = []

    async def request(request):
        observed.append(request.extensions["timeout"])
        return httpx.Response(
            200,
            json={
                "schema": "podconnect.radio-action.v1",
                "action_id": "one",
                "status": "accepted",
                "retry_allowed": False,
            },
        )

    async with httpx.AsyncClient(
        base_url="http://native.invalid", transport=httpx.MockTransport(request)
    ) as client:
        native = NativeRadio("http://native.invalid", "inert", client=client)
        await native.execute({"action_id": "one"})
    assert len(observed) == 1 and observed[0]["read"] == 15 and observed[0]["connect"] == 1


async def test_real_go_action_and_result_handlers_cross_entire_bridge_unknown_recovery(
    rig, actual_go_radio_contract, tmp_path
):
    scenario = actual_go_radio_contract["scenario"]
    phase, posts, result_reads = "initial", [], []

    async def request(request):
        nonlocal scenario, phase
        if request.method == "POST":
            assert request.url.path == "/api/radio/action"
            command = json.loads(request.content)
            posts.append(command)
            actual = await asyncio.to_thread(
                export_go_radio_contract, tmp_path / "actual-command.json", command
            )
            scenario = actual["scenario"]
            phase = "unknown"
            return httpx.Response(scenario["post_status"], json=scenario["post_body"])
        if request.url.path == "/api/radio/result":
            result_reads.append(dict(request.url.params))
            proof = scenario["result_body"]
            assert dict(request.url.params) == {
                "process_id": proof["process_id"],
                "action_id": proof["action_id"],
                "generation": str(proof["generation"]),
            }
            phase = "final"
            return httpx.Response(scenario["result_status"], json=proof)
        assert request.url.path == "/api/radio/state"
        return httpx.Response(200, json=scenario[phase])

    async with httpx.AsyncClient(
        base_url="http://native.invalid", transport=httpx.MockTransport(request)
    ) as client:
        native = NativeRadio("http://native.invalid", "inert-token", client=client)
        rig.bridge.radio.native = native
        initial = await (await rig.client.get("/view/api/radio")).json()
        assert initial["enabled"] and initial["actions"] == ["start"]
        rig.value = scenario["initial"]
        task = await offer(rig, revision=initial["revision"], targetId="r1")
        assert task["ok"]
        result = await (await post(rig, "actions", action_body(task))).json()
        assert result["status"] == "unknown" and rig.bridge.radio.unknown
        with pytest.raises(TypeError):
            rig.bridge.radio.unknown_proof["action_id"] = "other"
        recovered = await (await rig.client.get("/view/api/radio")).json()
        assert recovered["enabled"] and recovered["state"]["status"] == "playing"
        assert recovered["state"]["stationId"] == "p3" and recovered["state"]["targetId"] == "r1"
        assert not rig.bridge.radio.unknown and rig.bridge.radio.unknown_proof is None
        assert len(posts) == 1 and len(result_reads) == 1
        assert not (await (await post(rig, "actions", action_body(task))).json())["ok"]
        assert len(posts) == 1


@pytest.mark.parametrize("outcome", ["rejected", "preempted"])
async def test_terminal_external_owner_recovery_never_projects_requested_radio_as_playing(
    rig, outcome
):
    task = await unknown_start(rig)
    rig.result_reply = terminal_result(rig, task, outcome=outcome)
    rig.result_reply["observation"].update(
        source_kind="spotify", station_id="", target_id="speaker-b", owner_generation=9
    )

    async def observe_external():
        rig.value = recovered_state(rig.result_reply)
        rig.value["actions"] = ["start"]

    rig.result_hook = observe_external
    value = await (await rig.client.get("/view/api/radio")).json()
    assert value["enabled"] and not rig.bridge.radio.unknown
    assert value["state"]["status"] == "idle" and value["state"]["sourceKind"] == "spotify"
    assert value["state"]["stationId"] is None and value["actions"] == ["start"]
    assert len(effects(rig)) == 1
    assert not (await (await post(rig, "actions", action_body(task))).json())["ok"]


@pytest.mark.parametrize("method", ["read", "execute", "result"])
async def test_native_adapter_rejects_unexpected_success_status(method):
    async def request(request):
        return httpx.Response(201, json=native_state())

    async with httpx.AsyncClient(
        base_url="http://native.invalid", transport=httpx.MockTransport(request)
    ) as client:
        native = NativeRadio("http://native.invalid", "inert", client=client)
        with pytest.raises(ValueError, match="status"):
            if method == "read":
                await native.read()
            elif method == "execute":
                await native.execute({"action_id": "one"})
            else:
                await native.result({"process_id": "p", "action_id": "a", "generation": 1})


async def test_unknown_result_whole_read_budget_expires_without_losing_custody(rig, monkeypatch):
    import gatekeeper.podview_radio as module

    task = await unknown_start(rig)
    proof = rig.bridge.radio.unknown_proof
    entered, cancelled = asyncio.Event(), asyncio.Event()

    async def wait():
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    rig.result_hook = wait
    monkeypatch.setattr(module, "RADIO_READ_BUDGET_SECONDS", 0.02)
    value = await (await rig.client.get("/view/api/radio")).json()
    assert entered.is_set() and cancelled.is_set()
    assert not value["enabled"] and rig.bridge.radio.unknown
    assert rig.bridge.radio.unknown_proof is proof and len(effects(rig)) == 1
    assert not (await (await post(rig, "actions", action_body(task))).json())["ok"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("station_id", "p1"),
        ("target_id", "speaker-b"),
        ("source_kind", "spotify"),
        ("state", "stopped"),
        ("volume_percent", 31),
    ],
)
async def test_terminal_proof_and_fresh_snapshot_cannot_conflict_under_same_owner(
    rig, field, value
):
    task = await unknown_start(rig)
    rig.result_reply = terminal_result(rig, task)

    async def conflict():
        rig.value = recovered_state(rig.result_reply)
        rig.value[field] = value
        if field in {"source_kind", "state"}:
            rig.value["actions"] = ["start"]

    rig.result_hook = conflict
    result = await (await rig.client.get("/view/api/radio")).json()
    assert not result["enabled"] and rig.bridge.radio.unknown
    assert len(effects(rig)) == 1


async def test_correlated_terminal_radio_result_allows_newer_observed_external_owner_without_replay(
    rig,
):
    task = await unknown_start(rig)
    rig.result_reply = terminal_result(rig, task)

    async def newer_owner():
        rig.value = recovered_state(rig.result_reply)
        rig.value.update(
            source_kind="spotify",
            station_id="",
            target_id="speaker-b",
            owner_generation=9,
            actions=["start"],
        )

    rig.result_hook = newer_owner
    value = await (await rig.client.get("/view/api/radio")).json()
    assert value["enabled"] and not rig.bridge.radio.unknown
    assert value["state"]["status"] == "idle" and value["state"]["sourceKind"] == "spotify"
    assert len(effects(rig)) == 1


async def test_total_native_effect_deadline_stops_trickling_body_and_retains_unknown_custody(
    rig, monkeypatch
):
    import gatekeeper.podview_radio as module

    chunks, posts, closed = [], [], asyncio.Event()

    class Trickle(httpx.AsyncByteStream):
        async def __aiter__(self):
            for index in range(10000):
                await asyncio.sleep(0.005)
                chunks.append(index)
                yield b" "  # every chunk arrives inside the HTTP inactivity timeout

        async def aclose(self):
            closed.set()

    async def request(request):
        if request.method == "POST":
            posts.append(json.loads(request.content))
            return httpx.Response(200, stream=Trickle())
        if request.url.path == "/api/radio/result":
            return httpx.Response(409, text="still unknown")
        return httpx.Response(200, json=rig.value)

    async with httpx.AsyncClient(
        base_url="http://native.invalid", transport=httpx.MockTransport(request)
    ) as client:
        rig.bridge.radio.native = NativeRadio("http://native.invalid", "inert", client=client)
        task = await offer(rig)
        assert task["ok"]
        monkeypatch.setattr(module, "RADIO_ACTION_BUDGET_SECONDS", 0.04)
        result = await (await post(rig, "actions", action_body(task))).json()
        assert result["status"] == "unknown" and result["retryAllowed"] is False
        assert closed.is_set() and 0 < len(chunks) < 100
        assert len(posts) == 1 and rig.bridge.radio.unknown
        assert not rig.bridge.radio.busy and rig.bridge.radio.unknown_proof is not None
        assert not (await (await post(rig, "actions", action_body(task))).json())["ok"]
        assert not (await offer(rig))["ok"]
        assert len(posts) == 1


async def test_manager_restart_has_own_counter_domain_and_does_not_replay_offer(rig):
    before = await (await rig.client.get("/view/api/radio?room=kitchen")).json()
    task = await offer(rig)
    rig.value.update(process_id="native-process-b", revision=0, generation=0, owner_generation=0)
    after = await (await rig.client.get("/view/api/radio?room=kitchen")).json()
    assert after["bootId"] == before["bootId"] == rig.bridge.boot_id
    assert before["ownerProcessId"] == "native-process-a"
    assert after["ownerProcessId"] == "native-process-b"
    assert (
        after["revision"] == after["state"]["generation"] == after["state"]["ownerGeneration"] == 0
    )
    assert after["enabled"] and not effects(rig)
    stale = await (await post(rig, "actions", action_body(task))).json()
    assert stale["error"] == "stale_radio_task" and not effects(rig)
    fresh = await offer(rig)
    assert fresh["ok"]
    outcome = await (await post(rig, "actions", action_body(fresh))).json()
    assert outcome["status"] == "accepted"
    assert len(effects(rig)) == 1
    assert effects(rig)[0][2]["expected_process_id"] == "native-process-b"
    assert effects(rig)[0][2]["expected_revision"] == 0
    assert not (await (await post(rig, "actions", action_body(fresh))).json())["ok"]
    assert len(effects(rig)) == 1


async def test_missing_native_has_no_invented_manager_process(rig):
    rig.bridge.radio.native = None
    value = await (await rig.client.get("/view/api/radio?room=kitchen")).json()
    assert value["ownerProcessId"] is None
    assert not value["enabled"] and value["actions"] == [] and not effects(rig)


@pytest.mark.parametrize("action,volume", [("stop", None), ("volume", 0), ("volume", 100)])
async def test_current_owned_radio_controls_survive_closed_new_destination_admission(
    rig, action, volume
):
    rig.value.update(state="playing", source_kind="radio", actions=["stop", "volume"])
    for row in rig.value["targets"]:
        row.update(selectable=False, availability="unavailable")
    value = await (await rig.client.get("/view/api/radio?room=kitchen")).json()
    assert value["enabled"] and value["actions"] == ["stop", "volume"]
    assert value["state"]["targetId"] == "speaker-a"
    assert all(not target["selectable"] for target in value["targets"])
    assert not (await offer(rig))["ok"]
    assert not (await offer(rig, action="move", stationId=None, targetId="speaker-b"))["ok"]
    task = await offer(rig, action=action, stationId=None, targetId=None, volumePercent=volume)
    assert task["ok"]
    outcome = await (await post(rig, "actions", action_body(task))).json()
    assert outcome["status"] == "accepted"
    assert len(effects(rig)) == 1
    assert effects(rig)[0][2]["action"] == action


@pytest.mark.parametrize(
    "change",
    [
        {"target_id": "unknown-target"},
        {"target_id": None},
        {"source_kind": "spotify"},
        {"observed_at": None},
        {"state": "stopped"},
        {"retrieved_at": 0},
        {"volume_percent": None},
    ],
)
def test_closed_admission_never_mints_current_radio_control_authority(change):
    raw = native_state()
    raw.update(state="playing", source_kind="radio", actions=["stop", "volume"])
    for row in raw["targets"]:
        row.update(selectable=False, availability="unavailable")
    raw.update(change)
    with pytest.raises(ValueError):
        validate_native(raw)


async def test_unknown_custody_survives_manager_restart_without_replay(rig):
    task = await unknown_start(rig)
    boot = rig.bridge.boot_id
    count = len(effects(rig))
    rig.value.update(process_id="native-process-b", revision=0, generation=0, owner_generation=0)
    rig.calls.clear()
    value = await (await rig.client.get("/view/api/radio?room=kitchen")).json()
    assert value["bootId"] == boot and value["ownerProcessId"] == "native-process-b"
    assert value["revision"] == value["state"]["ownerGeneration"] == 0
    assert value["state"]["status"] == "unknown"
    assert value["actions"] == [] and not value["enabled"]
    assert value["blockedReasons"] == ["radio_outcome_unknown"]
    assert not (await offer(rig))["ok"]
    assert not (await (await post(rig, "actions", action_body(task))).json())["ok"]
    assert count == 1 and not effects(rig)
    assert all(path != "/api/radio/result" for _, path, _ in rig.calls)


@pytest.mark.parametrize("action", ["start", "move"])
def test_new_destination_actions_still_require_selectable_destination(action):
    raw = native_state()
    raw.update(state="playing", source_kind="radio", actions=[action])
    for target in raw["targets"]:
        target.update(selectable=False, availability="unavailable")
    with pytest.raises(ValueError):
        validate_native(raw)
