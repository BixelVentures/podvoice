"""Automatic client evidence through existing authentication; no household calls."""

import asyncio
import hashlib
import json
import threading
from types import SimpleNamespace

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_bridge import owner

from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE
from gatekeeper.web import create_app

HEADERS = {"X-Remote-User-Id": "a" * 32, "X-PodView-Request": "1"}
URL = "/view/api/client-diagnostics?room=kitchen"
UUID = "01234567-0123-4567-89ab-0123456789ab"


def batch(bridge, **changes):
    return {
        "schema": "podview.client-diagnostics.v1",
        "batchId": UUID,
        "roomId": "kitchen",
        "bootId": bridge.boot_id,
        "uiBuild": "20261023-unified-ui22",
        "records": [{"stage": "request", "code": "timeout", "seq": 1, "ageMs": 2}],
        **changes,
    }


@pytest.fixture
async def rig(tmp_path):
    session, timers = owner()
    path = tmp_path / "diagnostics" / "records.json"
    app = create_app(
        StatusHub(),
        {"kitchen": session},
        podview_control_policy=json.dumps({"roomId": "kitchen", "music": [], "vacuum": []}),
        podview_controller_enabled=True,
        podview_controller_generation="c" * 64,
        podview_controller_store=tmp_path / "controller" / "registry.json",
        podview_client_diagnostics_store=path,
    )
    bridge = app[BRIDGE]
    bridge._controller_registry.initialize()
    peer = ["172.30.32.2"]

    @web.middleware
    async def socket_peer(request, handler):
        return await handler(request.clone(remote=peer[0]))

    app.middlewares.insert(0, socket_peer)
    async with TestClient(TestServer(app)) as client:
        yield SimpleNamespace(
            app=app, bridge=bridge, client=client, peer=peer, path=path, timers=timers
        )


async def test_admin_upload_durable_read_and_lost_ack_retry_are_exact(rig):
    value = batch(rig.bridge)
    value["records"][0].update(requestId=UUID, current=False, connected=False, endpoint="music")
    response = await rig.client.post(URL, json=value, headers=HEADERS)
    assert response.status == 200
    ack = await response.json()
    assert ack == {
        "schema": "podview.client-diagnostics-ack.v1",
        "ok": True,
        "batchId": UUID,
        "acceptedCount": 1,
        "duplicate": False,
        "stored": True,
    }
    before = rig.path.read_bytes()
    response = await rig.client.post(URL, json=value, headers=HEADERS)
    assert await response.json() == {**ack, "duplicate": True}
    assert rig.path.read_bytes() == before
    response = await rig.client.get(URL, headers=HEADERS)
    assert response.status == 200 and response.headers["Cache-Control"] == "no-store"
    result = await response.json()
    assert result["schema"] == "podview.client-diagnostics.read.v1"
    assert len(result["records"]) == 1
    row = result["records"][0]["row"]
    assert row["current"] is False and row["connected"] is False
    assert row["requestRef"] == hashlib.sha256(UUID.encode()).hexdigest()[:16]
    assert UUID not in rig.path.read_text() and "a" * 32 not in rig.path.read_text()
    changed = {**value, "uiBuild": None}
    assert (await rig.client.post(URL, json=changed, headers=HEADERS)).status == 409
    assert rig.path.read_bytes() == before
    assert not rig.timers.command.await_count and not rig.bridge._grants


@pytest.mark.parametrize(
    "code",
    [
        "renewal_readonly",
        "renewal_invalid_dto",
        "renewal_owner_changed",
        "renewal_candidate_reused",
        "renewal_card_nonunique",
        "renewal_card_mismatch",
        "renewal_focus_changed",
        "renewal_cancelled",
        "renewal_other",
    ],
)
def test_music_renewal_codes_are_accepted_by_closed_validation(code):
    from gatekeeper.podview_client_diagnostics import parse_batch

    value = batch(
        SimpleNamespace(boot_id="b" * 32),
        records=[{"stage": "control_intent", "code": code, "seq": 1, "ageMs": 0}],
    )
    assert parse_batch(json.dumps(value).encode()).rows[0]["code"] == code


async def test_only_stored_correlated_music_intents_reach_fail_open_client_log(rig, monkeypatch):
    from gatekeeper import podview as module
    from gatekeeper.podview_client_diagnostics import DiagnosticFailure

    logged = []
    monkeypatch.setattr(module._LOG, "info", lambda *args: logged.append(args))
    row = {
        "stage": "control_intent",
        "code": "renewal_readonly",
        "seq": 1,
        "ageMs": 0,
        "domain": "music",
        "requestId": UUID,
    }
    value = batch(
        rig.bridge,
        records=[
            row,
            {"stage": "request", "code": "ok", "seq": 2, "ageMs": 0},
            {
                "stage": "control_intent",
                "code": "start",
                "seq": 3,
                "ageMs": 0,
                "domain": "music",
            },
        ],
    )
    assert (await rig.client.post(URL, json=value, headers=HEADERS)).status == 200
    assert len(logged) == 1
    message = logged[0][0] % logged[0][1:]
    assert message == (
        "client_diagnostics source=client seq=1 requestRef="
        + hashlib.sha256(UUID.encode()).hexdigest()[:16]
        + " code=renewal_readonly"
    )
    assert UUID not in message and "kitchen" not in message and "a" * 32 not in message
    assert (await rig.client.post(URL, json=value, headers=HEADERS)).status == 200
    assert len(logged) == 1
    invalid = batch(
        rig.bridge,
        batchId="11111111-0123-4567-89ab-0123456789ab",
        records=[{**row, "code": "PRIVATE"}],
    )
    assert (await rig.client.post(URL, json=invalid, headers=HEADERS)).status == 400
    assert (await rig.client.post(URL, json=value, headers={})).status == 403
    assert len(logged) == 1

    async def unavailable(*args, **kwargs):
        raise DiagnosticFailure()

    original = rig.bridge.client_diagnostics.append
    monkeypatch.setattr(rig.bridge.client_diagnostics, "append", unavailable)
    fresh = batch(
        rig.bridge,
        batchId="22222222-0123-4567-89ab-0123456789ab",
        clientId="33333333-0123-4567-89ab-0123456789ab",
        records=[row],
    )
    assert (await rig.client.post(URL, json=fresh, headers=HEADERS)).status == 503
    assert len(logged) == 1
    monkeypatch.setattr(rig.bridge.client_diagnostics, "append", original)
    monkeypatch.setattr(
        module._LOG,
        "info",
        lambda *args: (_ for _ in ()).throw(RuntimeError("private")),
    )
    response = await rig.client.post(URL, json=fresh, headers=HEADERS)
    assert response.status == 200 and (await response.json())["stored"] is True
    assert not rig.timers.command.await_count and not rig.bridge._grants


@pytest.mark.parametrize("change", [{"bootId": "f" * 32}, {"roomId": "other"}])
async def test_wrong_boot_or_room_cannot_be_relabelled(rig, change):
    assert (
        await rig.client.post(URL, json=batch(rig.bridge, **change), headers=HEADERS)
    ).status == 409
    assert not rig.path.exists()


@pytest.mark.parametrize(
    "field", ["restored", "atMs", "errorClass", "message", "stack", "url", "args"]
)
async def test_unknown_or_private_fields_never_reach_store(rig, field):
    value = batch(rig.bridge)
    value["records"][0][field] = "PRIVATE_never_persist"
    assert (await rig.client.post(URL, json=value, headers=HEADERS)).status == 400
    assert not rig.path.exists()


async def test_controller_can_append_without_action_grant_but_cannot_read_or_renew(rig):
    registry = rig.bridge._controller_registry
    cookie, identity, _ = registry.enroll("kitchen", rig.bridge.controller_pin("kitchen"))
    before = registry.path.read_bytes()
    rig.peer[0] = "127.0.0.1"
    headers = {"X-PodView-Request": "1"}
    rig.client.session.cookie_jar.update_cookies({"podview_controller": cookie})
    assert (await rig.client.get(URL, headers=headers)).status == 403
    assert (await rig.client.post(URL, json=batch(rig.bridge), headers=headers)).status == 200
    assert registry.path.read_bytes() == before and not rig.bridge._grants
    registry.revoke(identity, room="kitchen")
    assert (await rig.client.post(URL, json=batch(rig.bridge), headers=headers)).status == 403
    assert not rig.timers.command.await_count


@pytest.mark.parametrize(
    "peer,headers",
    [
        ("127.0.0.1", HEADERS),
        ("172.30.32.2", {}),
        ("172.30.32.2", {**HEADERS, "Sec-Fetch-Site": "cross-site"}),
    ],
)
async def test_existing_ingress_origin_and_identity_guards_remain_closed(rig, peer, headers):
    rig.peer[0] = peer
    assert (await rig.client.post(URL, json=batch(rig.bridge), headers=headers)).status == 403
    assert not rig.path.exists()


async def test_boot_change_during_async_admission_cannot_store(rig, monkeypatch):
    from gatekeeper import podview_client_diagnostics as module

    entered, release = asyncio.Event(), asyncio.Event()
    original = module.ClientDiagnosticsStore.append

    async def held(*args, **kwargs):
        entered.set()
        await release.wait()
        return await original(*args, **kwargs)

    # Disk failure itself is tested against real private-file writer in unit tests.
    monkeypatch.setattr(module.ClientDiagnosticsStore, "append", held)
    pending = asyncio.create_task(rig.client.post(URL, json=batch(rig.bridge), headers=HEADERS))
    await entered.wait()
    rig.bridge.boot_id = "f" * 32
    release.set()
    assert (await pending).status == 409
    assert not rig.path.exists()


async def test_controller_revocation_during_disk_admission_remains_closed(rig, monkeypatch):
    registry = rig.bridge._controller_registry
    cookie, identity, _ = registry.enroll("kitchen", rig.bridge.controller_pin("kitchen"))
    rig.peer[0] = "127.0.0.1"
    rig.client.session.cookie_jar.update_cookies({"podview_controller": cookie})
    entered, release = threading.Event(), threading.Event()
    original = rig.bridge.client_diagnostics._load

    def held(directory):
        entered.set()
        assert release.wait(5)
        return original(directory)

    monkeypatch.setattr(rig.bridge.client_diagnostics, "_load", held)
    pending = asyncio.create_task(
        rig.client.post(URL, json=batch(rig.bridge), headers={"X-PodView-Request": "1"})
    )
    assert await asyncio.to_thread(entered.wait, 2)
    registry.revoke(identity, room="kitchen")
    release.set()
    assert (await pending).status == 403
    assert not rig.path.exists() and not rig.bridge._grants


async def test_post_storage_failure_returns_503_without_durable_ack(rig, monkeypatch):
    def fail(*args):
        raise OSError("PRIVATE_disk_exception")

    monkeypatch.setattr(rig.bridge.client_diagnostics, "_write", fail)
    response = await rig.client.post(URL, json=batch(rig.bridge), headers=HEADERS)
    assert response.status == 503
    result = await response.json()
    assert result["error"] == "diagnostics_unavailable" and "stored" not in result
    assert "PRIVATE" not in json.dumps(result) and not rig.path.exists()


async def test_two_authorized_clients_persist_distinct_seq_one_flows_without_grants_or_rate_escape(
    rig,
):
    client_a = "11111111-0123-4567-89ab-0123456789ab"
    client_b = "22222222-0123-4567-89ab-0123456789ab"
    request_b = "33333333-0123-4567-89ab-0123456789ab"
    for index, (client_id, request_id) in enumerate(((client_a, UUID), (client_b, request_b))):
        rows = [
            {
                "stage": stage,
                "code": code,
                "domain": "vacuum",
                "action": "pause",
                "requestId": request_id,
                "seq": seq,
                "ageMs": 0,
                **(
                    {"source": "home_assistant", "trust": "state_observation"}
                    if stage == "control_observation"
                    else {}
                ),
            }
            for seq, (stage, code) in enumerate(
                (
                    ("control_intent", "start"),
                    ("control_action", "accepted"),
                    ("control_observation", "observed"),
                ),
                1,
            )
        ]
        value = batch(
            rig.bridge,
            batchId=f"{100 + index:08x}-0123-4567-89ab-0123456789ab",
            clientId=client_id,
            records=rows,
        )
        response = await rig.client.post(URL, json=value, headers=HEADERS)
        assert response.status == 200
        assert (await response.json())["stored"] is True
    persisted = await (await rig.client.get(URL, headers=HEADERS)).json()
    assert len(persisted["records"]) == 6
    assert [entry["row"]["seq"] for entry in persisted["records"]] == [1, 2, 3, 1, 2, 3]
    assert [entry["serverSeq"] for entry in persisted["records"]] == [1, 2, 3, 4, 5, 6]
    assert len({entry["principalRef"] for entry in persisted["records"]}) == 1
    assert {entry["row"]["requestRef"] for entry in persisted["records"]} == {
        hashlib.sha256(request.encode()).hexdigest()[:16] for request in (UUID, request_b)
    }
    for request_id in (UUID, request_b):
        request_ref = hashlib.sha256(request_id.encode()).hexdigest()[:16]
        flow = [
            entry["row"]
            for entry in persisted["records"]
            if entry["row"]["requestRef"] == request_ref
        ]
        assert [(row["stage"], row["code"]) for row in flow] == [
            ("control_intent", "start"),
            ("control_action", "accepted"),
            ("control_observation", "observed"),
        ]
        assert flow[-1]["trust"] == "state_observation"
    disk = json.loads(rig.path.read_text())
    assert len({entry["key"] for entry in disk["batches"]}) == 2
    assert len({entry["clientRef"] for entry in disk["batches"]}) == 2
    assert client_a not in rig.path.read_text() and client_b not in rig.path.read_text()
    rig.bridge.sessions["bedroom"] = owner()[0]
    value = batch(
        rig.bridge,
        batchId="00000102-0123-4567-89ab-0123456789ab",
        clientId=client_a,
        roomId="bedroom",
    )
    assert (
        await rig.client.post(
            "/view/api/client-diagnostics?room=bedroom", json=value, headers=HEADERS
        )
    ).status == 429
    # Caller IDs cannot create authority and rotation cannot widen total admission.
    assert (await rig.client.post(URL, json=batch(rig.bridge, clientId=client_a))).status == 403
    for index in range(2, 12):
        value = batch(
            rig.bridge,
            batchId=f"{100 + index:08x}-0123-4567-89ab-0123456789ab",
            clientId=f"{index + 10:08x}-0123-4567-89ab-0123456789ab",
        )
        assert (await rig.client.post(URL, json=value, headers=HEADERS)).status == 200
    value = batch(
        rig.bridge,
        batchId="00000200-0123-4567-89ab-0123456789ab",
        clientId="ffffffff-0123-4567-89ab-0123456789ab",
    )
    assert (await rig.client.post(URL, json=value, headers=HEADERS)).status == 429
    assert not rig.timers.command.await_count and not rig.bridge._grants


async def test_actual_sender_recovers_from_background_pressure_without_acknowledging_it(rig):
    """A real JS sender reaches the real HTTP/store boundary; no provider is called."""
    from pathlib import Path

    from gatekeeper import podview_client_diagnostics as module

    store = rig.bridge.client_diagnostics
    now = [1_800_000_000.0]
    store.clock = lambda: now[0]
    for index in range(32):
        now[0] += 61
        body = batch(
            rig.bridge,
            batchId=f"{index:08x}-0123-4567-89ab-0123456789ab",
            records=[
                {"stage": "control_action", "code": "unknown", "seq": seq, "ageMs": 0}
                for seq in range(1, 17)
            ],
        )
        await store.append(module.parse_batch(json.dumps(body).encode()), "seed", lambda: True)
    now[0] += 61
    before = rig.path.read_bytes()
    script = r"""
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const {PodVoiceTransport}=await import(process.argv[3]);
const base=process.argv[1],boot=process.argv[2],requests=[];let offset=0;const realNow=Date.now;Date.now=()=>realNow()+offset;
const t=new PodVoiceTransport({url:base+'/view/',crypto:webcrypto,diagnosticStorage:null,fetch:async(url,init)=>{const response=await fetch(url,{...init,headers:{...init.headers,'X-Remote-User-Id':'a'.repeat(32)}});requests.push({body:JSON.parse(init.body),status:response.status,payload:await response.clone().json()});return response;}});
t.closed=false;assert.equal(t.accept({schema:'podview.snapshot.v1',bootId:boot,revision:1,roomId:'kitchen',admission:{kind:'ha_ingress',authenticated:true},voice:{phase:'IDLE'},timers:{status:'observed',items:[]},capabilities:{musicRead:[],timerActions:[]}}),true);
t.recordDiagnostic('control_setup',{code:'start'});await t.flushDiagnosticUpload();assert.equal(requests[0].status,429);assert.equal(requests[0].payload.error,'diagnostics_background_pressure');assert.equal(createHash('sha256').update(readFileSync(process.argv[4])).digest('hex'),process.argv[5],'429 persists neither rows nor batch ACK');assert.equal(t.diagnosticUploadBatch,null);assert.equal(t.diagnosticUploadAcked.size,0);assert(t.diagnostics().dropped>0);
t.recordDiagnostic('control_intent',{code:'start',domain:'music',action:'resume'});offset+=11000;await t.flushDiagnosticUpload();assert.equal(requests[1].status,200);assert.notEqual(requests[0].body.batchId,requests[1].body.batchId);const action=requests[1].body.records.find(r=>r.stage==='control_intent');assert(action);assert(t.diagnosticUploadAcked.has(action.seq));t.close();console.log(JSON.stringify(requests.map(x=>({status:x.status,batchId:x.body.batchId}))));
"""
    source = (
        Path(__file__).parents[2] / "podvoice/gatekeeper/static/podview/podvoice-transport.js"
    ).as_uri()
    process = await asyncio.create_subprocess_exec(
        "node",
        "--input-type=module",
        "-e",
        script,
        str(rig.client.make_url("/")).rstrip("/"),
        rig.bridge.boot_id,
        source,
        str(rig.path),
        hashlib.sha256(before).hexdigest(),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=20)
    assert process.returncode == 0, stderr.decode()
    statuses = json.loads(stdout)
    assert [item["status"] for item in statuses] == [429, 200]
    assert rig.path.read_bytes() != before
    data = json.loads(rig.path.read_bytes())
    assert len(data["records"]) == 512
    assert any(item["row"]["stage"] == "control_intent" for item in data["records"])
    assert not any(item["row"]["stage"] == "control_setup" for item in data["records"])
