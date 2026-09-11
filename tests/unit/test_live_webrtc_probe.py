"""Offline real probe orchestration with fake SDK; no API key, sockets or browser."""

import asyncio
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from aiohttp import web

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
for name in ("live_alpha_probe", "live_webrtc_probe"):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
M = sys.modules["live_webrtc_probe"]


class SDK:
    def __init__(self, *, snapshot_id="live_test"):
        self.incoming = asyncio.Queue()
        self.create_calls = []
        self.attach_calls = []
        self.sent = []
        self.snapshot_id = snapshot_id
        self.connection = SimpleNamespace(
            session=SimpleNamespace(update=self.update, close=self.close_session),
            response=SimpleNamespace(item=SimpleNamespace(create=AsyncMock()), create=AsyncMock()),
            recv_bytes=self.incoming.get,
        )
        self.manager = AsyncMock()
        self.manager.__aenter__.return_value = self.connection
        self.client = SimpleNamespace(
            live=SimpleNamespace(create=self.create, sideband=SimpleNamespace(connect=self.attach)),
            close=AsyncMock(),
        )

    def factory(self, **kwargs):
        assert kwargs["max_retries"] == 0
        return self.client

    async def create(self, **kwargs):
        self.create_calls.append(kwargs)
        return SimpleNamespace(
            session=SimpleNamespace(id="live_test"), transport=SimpleNamespace(sdp="answer")
        )

    def attach(self, **kwargs):
        self.attach_calls.append(kwargs)
        return self.manager

    async def update(self, **kwargs):
        self.sent.append(("session.update", kwargs))
        await self.incoming.put(
            json.dumps(
                {
                    "type": "session.updated",
                    "client_event_id": kwargs["event_id"],
                    "session": {"id": self.snapshot_id},
                }
            )
        )

    async def close_session(self):
        self.sent.append(("session.close", {}))
        await self.incoming.put(
            json.dumps(
                {"type": "session.closed", "usage": {"seconds": 2}, "reason": "close_requested"}
            )
        )


def build(tmp_path, sdk=None):
    sdk = sdk or SDK()
    return M.WebRTCProbe(
        "not-a-real-key", b"fixture", tmp_path / "report.json", client_factory=sdk.factory
    ), sdk


def test_media_configuration_disables_frontend_commands_and_restricts_events():
    config = M.configuration()
    assert "format" not in config["audio"]
    dc = config["client"]["data_channel"]
    assert dc["allowed_client_events"] == []
    assert {e["type"] for e in dc["allowed_server_events"]} == {
        "session.started",
        "session.closed",
        "error",
    }
    assert [t["name"] for t in config["delegation"]["responses"]["tools"]] == ["get_probe_status"]
    assert config["delegation"]["responses"]["max_output_tokens"] == 256


async def test_attach_precedes_answer_and_snapshot_proves_identity_without_started_replay(tmp_path):
    probe, sdk = build(tmp_path)
    try:
        result = await probe.create("offer")
        await probe.ready(result["session"]["id"])
        kinds = [e["kind"] for e in probe.records]
        assert kinds.index("sideband_attached") < kinds.index("answer_returned")
        assert "attachment_snapshot_confirmed" in kinds
        assert "sideband_session_started" not in kinds
        assert not probe.probe.started.is_set()  # No invented provider session.started.
        assert sdk.attach_calls[0]["session_id"] == "live_test"
        assert sdk.attach_calls[0]["max_retries"] == 0
        assert not any(kind == "session.start" for kind, _ in sdk.sent)
        sdk.connection.response.item.create.assert_awaited_once()
        sdk.connection.response.create.assert_awaited_once()
        assert (
            sdk.connection.response.item.create.call_args.kwargs["item"]["content"][0]["text"]
            == M.TYPED_TEXT
        )
        with pytest.raises(M.ProbeError, match="session_already_consumed"):
            await probe.create("second offer")
        assert len(sdk.create_calls) == 1
    finally:
        await probe.stop()
    assert probe.closed.is_set() and probe.done.is_set()
    assert probe.probe.voice_usage == {"seconds": 2}
    assert [kind for kind, _ in sdk.sent].count("session.close") == 1
    assert "not-a-real-key" not in probe.report_path.read_text()
    assert '"sdp"' not in probe.report_path.read_text()


async def test_mismatched_sideband_snapshot_cannot_open_typed_input(tmp_path, monkeypatch):
    monkeypatch.setattr(M, "STARTUP_S", 0.03)
    monkeypatch.setattr(M, "CLOSE_S", 0.03)
    probe, sdk = build(tmp_path, SDK(snapshot_id="live_other"))
    await probe.create("offer")
    await asyncio.wait_for(probe.done.wait(), 1)
    assert not probe.updated.is_set()
    with pytest.raises(M.ProbeError):
        await probe.ready("live_test")
    sdk.connection.response.item.create.assert_not_awaited()


async def test_stop_prevents_late_ready_and_does_not_duplicate_close(tmp_path):
    probe, sdk = build(tmp_path)
    await probe.create("offer")
    await asyncio.gather(probe.stop(), probe.stop())
    with pytest.raises(M.ProbeError, match="stale_browser_session"):
        await probe.ready("live_test")
    assert [kind for kind, _ in sdk.sent].count("session.close") == 1
    sdk.connection.response.item.create.assert_not_awaited()


@pytest.mark.parametrize(
    "host,origin,nonce",
    [
        ("127.0.0.1:18799", "https://attacker.invalid", "correct"),
        ("evil.invalid:18799", "http://127.0.0.1:18799", "correct"),
        ("127.0.0.1:18799", "http://127.0.0.1:18799", "wrong"),
    ],
)
def test_origin_host_and_nonce_all_required(tmp_path, host, origin, nonce):
    probe, _ = build(tmp_path)
    request = SimpleNamespace(
        host=host,
        method="POST",
        headers={"Origin": origin, "X-Probe-Nonce": probe.nonce if nonce == "correct" else nonce},
    )
    with pytest.raises(web.HTTPForbidden):
        probe.authorize(request)


def test_fixed_fixture_hash_and_format_are_checked_offline(tmp_path):
    path = tmp_path / "fixture.pcm"
    pcm = b"\x01\x00" * 2400
    path.write_bytes(pcm)
    wav = M.fixture_wav(path, hashlib.sha256(pcm).hexdigest())
    assert wav[:4] == b"RIFF" and wav[44:] == pcm
    with pytest.raises(ValueError, match="SHA256"):
        M.fixture_wav(path, "0" * 64)
    path.write_bytes(b"\x01")
    with pytest.raises(ValueError, match="aligned"):
        M.fixture_wav(path, "0" * 64)


def test_browser_uses_only_synthetic_media_and_never_sends_provider_commands():
    assert "getUserMedia" not in M.HTML
    assert "createMediaStreamDestination" in M.HTML and "silent.loop=true" in M.HTML
    assert "audio.muted=true" in M.HTML
    assert "dc.send(" not in M.HTML
    assert "OPENAI_API_KEY" not in M.HTML
    assert "setTimeout(stop,45000)" in M.HTML
    assert "currentTime" in M.HTML and "jitterBufferEmittedCount" in M.HTML


async def test_stop_cancels_inflight_creation_without_a_late_attachment(tmp_path):
    probe, sdk = build(tmp_path)
    entered = asyncio.Event()

    async def delayed_create(**kwargs):
        entered.set()
        await asyncio.Event().wait()

    sdk.client.live.create = delayed_create
    startup = asyncio.create_task(probe.create("offer"))
    await asyncio.wait_for(entered.wait(), 1)
    await asyncio.wait_for(probe.stop(), 1)
    assert startup.cancelled()
    assert sdk.attach_calls == []
    assert probe.done.is_set()
    sdk.client.close.assert_awaited_once()


async def test_server_deadline_requests_close_and_collects_final_usage(tmp_path, monkeypatch):
    monkeypatch.setattr(M, "MAX_SESSION_S", 0.01)
    probe, sdk = build(tmp_path)
    await probe.create("offer")
    await asyncio.wait_for(probe.done.wait(), 1)
    assert probe.closed.is_set()
    assert [kind for kind, _ in sdk.sent].count("session.close") == 1


@pytest.mark.parametrize("scheduled", [False, True])
async def test_stop_before_first_offer_permanently_closes_creation_admission(tmp_path, scheduled):
    probe, sdk = build(tmp_path)
    if scheduled:
        probe.request_stop()  # No yield: admission must close before the task runs.
    else:
        await probe.stop()
    with pytest.raises(M.ProbeError, match="probe_already_stopped"):
        await probe.create("late offer after fixture or ICE completed")
    assert sdk.create_calls == [] and sdk.attach_calls == []
    assert probe.client is None and not probe.used
    if probe.stop_task:
        await probe.stop_task
    assert probe.done.is_set()


@pytest.mark.parametrize("blocked_method", ["item", "response"])
@pytest.mark.parametrize("stop_mode", ["stop", "deadline"])
async def test_stop_fences_and_cancels_blocked_typed_send_without_waiting_for_sdk(
    tmp_path, blocked_method, stop_mode, monkeypatch
):
    if stop_mode == "deadline":
        monkeypatch.setattr(M, "MAX_SESSION_S", 0.03)
    probe, sdk = build(tmp_path)
    entered = asyncio.Event()

    async def blocked(**kwargs):
        entered.set()
        await asyncio.Event().wait()

    if blocked_method == "item":
        sdk.connection.response.item.create.side_effect = blocked
    else:
        sdk.connection.response.create.side_effect = blocked
    await probe.create("offer")
    typed = asyncio.create_task(probe.ready("live_test"))
    await asyncio.wait_for(entered.wait(), 1)
    if stop_mode == "stop":
        await asyncio.wait_for(probe.stop(), 1)
    else:
        await asyncio.wait_for(probe.done.wait(), 1)
    assert probe.probe.closing and probe.done.is_set() and typed.cancelled()
    assert [kind for kind, _ in sdk.sent].count("session.close") == 1
    if blocked_method == "item":
        sdk.connection.response.create.assert_not_awaited()
    assert not any(e["kind"] == "typed_probe_submitted" for e in probe.records)


@pytest.mark.parametrize("boundary", ["fixture", "ice"])
def test_browser_stop_before_late_fixture_or_ice_completion_cannot_post_session(boundary):
    import shutil
    import subprocess

    node = shutil.which("node")
    if not node:
        pytest.skip("Node is required for offline browser-controller regression")
    script = M.HTML.split("<script>", 1)[1].split("</script>", 1)[0]
    harness = r"""
const vm=require('vm'), fs=require('fs'), assert=require('assert');
const {script,boundary}=JSON.parse(fs.readFileSync(0,'utf8'));
const nodes={'#start':{},'#stop':{},'#status':{}}, posts=[];let pc, fixtureEntered=false, releaseFixture;
const fixtureWait=new Promise(resolve=>releaseFixture=resolve);
const track={stop(){}};
class AC {constructor(){this.sampleRate=24000;}async resume(){}async close(){}createBuffer(){return {}}createBufferSource(){return {connect(){},start(){},stop(){}}}createMediaStreamDestination(){return {stream:{getTracks:()=>[track]}}}async decodeAudioData(){return {}}}
class Peer {constructor(){pc=this;this.iceGatheringState='gathering';}addTrack(){}createDataChannel(){return {close(){}}}async createOffer(){return {sdp:'offer'}}async setLocalDescription(d){this.localDescription=d}close(){}}
const context={document:{querySelector:id=>nodes[id]},Audio:class{pause(){}},AudioContext:AC,RTCPeerConnection:Peer,window:{addEventListener(){}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},fetch:async(path)=>{posts.push(path);if(path==='/fixture'){fixtureEntered=true;if(boundary==='fixture')await fixtureWait;}return {ok:true,json:async()=>({}),arrayBuffer:async()=>new ArrayBuffer(2)}}};
vm.runInNewContext(script,context);
(async()=>{const starting=nodes['#start'].onclick();for(let i=0;i<50;i++){if(boundary==='fixture'?fixtureEntered:pc?.onicegatheringstatechange)break;await new Promise(setImmediate);}assert(boundary==='fixture'?fixtureEntered:pc.onicegatheringstatechange);await nodes['#stop'].onclick();if(boundary==='fixture')releaseFixture();else{pc.iceGatheringState='complete';pc.onicegatheringstatechange();}await starting;assert(!posts.includes('/session'));assert(posts.includes('/stop'));assert(nodes['#start'].disabled);})().catch(e=>{console.error(e);process.exitCode=1});
"""
    result = subprocess.run(
        [node, "-e", harness],
        input=json.dumps({"script": script, "boundary": boundary}),
        text=True,
        capture_output=True,
        timeout=5,
    )
    assert result.returncode == 0, result.stderr


async def test_farewell_sideband_keeps_reflected_tail_and_closes_after_backend_continuation(
    tmp_path,
):
    import io

    sdk = SDK()
    timeline, provider_audio = io.StringIO(), io.BytesIO()
    probe = M.WebRTCProbe(
        "fake-key",
        b"fixture",
        tmp_path / "report.json",
        client_factory=sdk.factory,
        farewell_trial=True,
        timeline=timeline,
        provider_audio=provider_audio,
        browser_audio=io.BytesIO(),
    )
    await probe.create("offer")
    await probe.ready("live_test")
    sdk.connection.response.item.create.assert_not_awaited()
    sdk.connection.response.create.assert_not_awaited()
    assert (
        sdk.create_calls[0]["session"]["delegation"]["responses"]["tools"][0]["name"]
        == "finish_farewell_probe"
    )

    async def close_with_tail():
        sdk.sent.append(("session.close", {}))
        await sdk.incoming.put(
            json.dumps(
                {
                    "type": "session.output_audio.delta",
                    "delta": "AQACAA==",
                    "start_ms": 20,
                    "end_ms": 21,
                }
            )
        )
        await sdk.incoming.put(json.dumps({"type": "session.closed", "usage": {"seconds": 2}}))

    sdk.connection.session.close = close_with_tail

    async def continue_backend(**_):
        assert not probe.probe.terminal_requested.is_set()
        for event in [
            {"type": "response.created", "response": {"id": "r2"}},
            {
                "type": "response.completed",
                "response": {"id": "r2", "status": "completed", "usage": {"total_tokens": 2}},
            },
        ]:
            await sdk.incoming.put(
                json.dumps({"type": "response.event", "delegation_id": "d", "event": event})
            )

    sdk.connection.response.create.side_effect = continue_backend
    for event in [
        {"type": "response.created", "response": {"id": "r"}},
        {
            "type": "response.output_item.done",
            "item": {
                "type": "function_call",
                "name": "finish_farewell_probe",
                "call_id": "c",
                "status": "completed",
                "arguments": "{}",
            },
        },
        {
            "type": "response.completed",
            "response": {"id": "r", "status": "completed", "usage": {"total_tokens": 1}},
        },
    ]:
        await sdk.incoming.put(
            json.dumps({"type": "response.event", "delegation_id": "d", "event": event})
        )
    await asyncio.wait_for(probe.done.wait(), 1)
    assert provider_audio.getvalue() == b"\x01\x00\x02\x00"
    assert probe.closed.is_set() and probe.probe.terminal_requested.is_set()
    sdk.connection.response.item.create.assert_awaited_once()
    sdk.connection.response.create.assert_awaited_once()
    assert probe.probe.backend_usage == [{"total_tokens": 1}, {"total_tokens": 2}]
    assert [x[0] for x in sdk.sent].count("session.close") == 1
    rows = [json.loads(row) for row in timeline.getvalue().splitlines()]
    pcm = next(row for row in rows if row["source_event"] == "session.output_audio.delta")
    assert pcm["start_ms"] == 20 and pcm["end_ms"] == 21
    assert "fake-key" not in timeline.getvalue()


@pytest.mark.parametrize("payload", [b"webm-fixture", b"", b"x" * (M.MAX_CAPTURE_BYTES + 1)])
async def test_browser_capture_upload_is_authenticated_bounded_one_use_and_never_speaker_proof(
    tmp_path, payload
):
    import io

    sdk = SDK()
    output = io.BytesIO()
    probe = M.WebRTCProbe(
        "fake",
        b"fixture",
        tmp_path / "report.json",
        client_factory=sdk.factory,
        farewell_trial=True,
        browser_audio=output,
    )
    app = M.app_for(probe)
    handler = next(
        route.handler for route in app.router.routes() if route.resource.canonical == "/capture"
    )

    class Content:
        async def iter_chunked(self, size):
            for at in range(0, len(payload), size):
                yield payload[at : at + size]

    request = SimpleNamespace(
        path="/capture",
        method="POST",
        host="127.0.0.1:18799",
        content_type="audio/webm",
        headers={"Origin": probe.origin, "X-Probe-Nonce": probe.nonce, "X-Capture-Failed": "false"},
        content=Content(),
    )
    if payload and len(payload) <= M.MAX_CAPTURE_BYTES:
        assert (await handler(request)).status == 200
        assert output.getvalue() == payload and probe.capture_saved
        assert probe.records[-1]["physical_playback_verified"] is False
    else:
        with pytest.raises(web.HTTPException):
            await handler(request)
        assert not probe.capture_saved
    assert probe.capture_done.is_set()
    with pytest.raises(web.HTTPConflict):
        await handler(request)
    request.headers["X-Probe-Nonce"] = "wrong"
    with pytest.raises(web.HTTPForbidden):
        await handler(request)


@pytest.mark.parametrize("phase", ["create", "attach", "update"])
async def test_stop_retains_late_sdk_owner_until_explicit_remote_close(
    tmp_path, monkeypatch, phase
):
    monkeypatch.setattr(M, "STOP_OWNER_WAIT_S", 0.005)
    probe, sdk = build(tmp_path)
    entered, cancelled, release = asyncio.Event(), asyncio.Event(), asyncio.Event()

    async def blocked():
        entered.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            cancelled.set()
            await release.wait()

    if phase == "create":
        original = sdk.create

        async def delayed(**kwargs):
            await blocked()
            return await original(**kwargs)

        sdk.client.live.create = delayed
    elif phase == "attach":

        async def delayed():
            await blocked()
            return sdk.connection

        sdk.manager.__aenter__.side_effect = delayed
    else:
        original = sdk.update

        async def delayed(**kwargs):
            await blocked()
            return await original(**kwargs)

        sdk.connection.session.update = delayed
    startup = asyncio.create_task(probe.create("offer"))
    await entered.wait()
    stopping = asyncio.create_task(probe.stop())
    await cancelled.wait()
    await asyncio.wait_for(stopping, 0.2)
    assert not probe.done.is_set() and not probe.cleanup_started
    sdk.client.close.assert_not_awaited()
    release.set()
    with pytest.raises(M.ProbeError, match="startup_stopped"):
        await asyncio.wait_for(startup, 0.3)
    assert probe.session_id == "live_test" and probe.closed.is_set() and probe.done.is_set()
    assert [x[0] for x in sdk.sent].count("session.close") == 1
    assert not any(row["kind"] == "answer_returned" for row in probe.records)
    sdk.client.close.assert_awaited_once()
    sdk.manager.__aexit__.assert_awaited_once()
    sdk.connection.response.create.assert_not_awaited()


async def test_stop_closes_attached_sdk_to_unblock_resistant_typed_send(tmp_path, monkeypatch):
    monkeypatch.setattr(M, "STOP_OWNER_WAIT_S", 0.005)
    probe, sdk = build(tmp_path)
    await probe.create("offer")
    entered, client_closed = asyncio.Event(), asyncio.Event()

    async def resistant_send(**_):
        entered.set()
        try:
            await client_closed.wait()
        except asyncio.CancelledError:
            await client_closed.wait()

    sdk.connection.response.item.create.side_effect = resistant_send
    sdk.client.close.side_effect = client_closed.set
    typed = asyncio.create_task(probe.ready("live_test"))
    await entered.wait()
    await asyncio.wait_for(probe.stop(), 0.2)
    with pytest.raises(M.ProbeError, match="typed_command_stopped"):
        await typed
    assert probe.done.is_set() and probe.closed.is_set()
    assert probe.typed_task is None and typed.done()
    sdk.client.close.assert_awaited_once()
    sdk.manager.__aexit__.assert_awaited_once()
    sdk.connection.response.create.assert_not_awaited()
    assert [kind for kind, _ in sdk.sent].count("session.close") == 1
    await probe.stop()
    sdk.client.close.assert_awaited_once()


async def test_expired_startup_cannot_return_answer_even_if_create_swallows_cancellation(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(M, "STARTUP_S", 0.005)
    probe, sdk = build(tmp_path)
    cancelled, release = asyncio.Event(), asyncio.Event()
    original = sdk.create

    async def delayed(**kwargs):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            await release.wait()
        return await original(**kwargs)

    sdk.client.live.create = delayed
    startup = asyncio.create_task(probe.create("offer"))
    await asyncio.wait_for(cancelled.wait(), 0.2)
    release.set()
    with pytest.raises(M.ProbeError, match="startup_stopped"):
        await asyncio.wait_for(startup, 0.3)
    assert probe.done.is_set() and probe.closed.is_set()
    assert [x[0] for x in sdk.sent].count("session.close") == 1
    assert not any(row["kind"] == "answer_returned" for row in probe.records)


@pytest.mark.parametrize("seconds", [None, True, {}, float("nan"), float("inf"), -1])
def test_farewell_evidence_rejects_missing_or_invalid_final_usage(tmp_path, seconds):
    probe, _ = build(tmp_path)
    probe.probe.terminal_requested.set()
    probe.closed.set()
    probe.provider_bytes = 4
    probe.capture_saved = True
    probe.probe.voice_usage = {"seconds": seconds}
    with pytest.raises(M.ProbeError, match="evidence_incomplete"):
        probe.require_farewell_evidence()


async def test_capture_failure_is_sticky_and_blocks_otherwise_saved_trial(tmp_path):
    probe, _ = build(tmp_path)
    probe.probe.terminal_requested.set()
    probe.closed.set()
    probe.probe.voice_usage = {"seconds": 2}
    probe.provider_bytes = 4
    probe.capture_saved = True
    probe.require_farewell_evidence()
    handler = next(
        route.handler
        for route in M.app_for(probe).router.routes()
        if route.resource.canonical == "/telemetry"
    )
    request = SimpleNamespace(
        path="/telemetry",
        method="POST",
        host="127.0.0.1:18799",
        headers={"Origin": probe.origin, "X-Probe-Nonce": probe.nonce},
        json=AsyncMock(return_value={"captureFailed": True}),
    )
    await handler(request)
    request.json.return_value = {"captureFailed": False}
    await handler(request)
    assert probe.capture_failed
    with pytest.raises(M.ProbeError, match="evidence_incomplete"):
        probe.require_farewell_evidence()


@pytest.mark.parametrize(
    "scenario", ["supported", "already_ended", "unsupported", "recorder_error"]
)
def test_embedded_browser_capture_is_muted_and_flushes_final_chunk_or_fails_explicitly(scenario):
    import shutil
    import subprocess

    node = shutil.which("node")
    if not node:
        pytest.skip("Node required for embedded controller regression")
    script = (
        M.HTML.replace("const farewell=false;", "const farewell=true;")
        .split("<script>", 1)[1]
        .split("</script>", 1)[0]
    )
    harness = r"""
const vm=require('vm'),fs=require('fs'),assert=require('assert');
const {script,scenario}=JSON.parse(fs.readFileSync(0,'utf8'));
const nodes={'#start':{},'#stop':{},'#status':{}},posts=[];let current,recorderStops=0;
class Recorder{static isTypeSupported(){return true;}constructor(){current=this;this.state='inactive';}start(){this.state='recording';}stop(){recorderStops++;this.state='inactive';queueMicrotask(()=>{this.ondataavailable({data:new Blob(['final-audio-tail'])});this.onstop();});}}
class Audio{constructor(){this.muted=false;}pause(){}captureStream(){return {getAudioTracks:()=>[{}]};}}
if(scenario==='unsupported')Audio.prototype.captureStream=undefined;
const context={document:{querySelector:id=>nodes[id]},Audio,MediaRecorder:Recorder,MediaStream:class{constructor(t){this.tracks=t;}},Blob,window:{MediaRecorder:Recorder,addEventListener(){}},setTimeout:(f,ms)=>{const t=setTimeout(f,ms);t.unref();return t;},clearTimeout,clearInterval,fetch:async(path,opts)=>{posts.push({path,opts});return {ok:true,json:async()=>({})};}};
vm.createContext(context);vm.runInContext(script,context);
(async()=>{vm.runInContext('startCapture()',context);if(scenario==='unsupported'){await new Promise(setImmediate);assert(posts.some(p=>p.path==='/stop'));assert(posts.some(p=>p.opts?.body?.includes('"captureSupported":false')));assert(!posts.some(p=>p.path==='/capture'));return;}
 if(scenario==='already_ended'){current.stop();await new Promise(setImmediate);}
 if(scenario==='recorder_error'){current.ondataavailable({data:new Blob(['partial'])});current.onerror();}
 await vm.runInContext('cleanup()',context);const capture=posts.filter(p=>p.path==='/capture');if(scenario==='recorder_error'){assert.equal(capture.length,0);assert.equal(vm.runInContext('captureFailed',context),true);return;}assert.equal(capture.length,1);assert.equal(capture[0].opts.headers['X-Capture-Failed'],'false');assert.equal(await capture[0].opts.body.text(),'final-audio-tail');assert.equal(recorderStops,1);assert.equal(vm.runInContext('audio.muted',context),true);assert(posts.some(p=>p.opts?.body?.includes('"captureStopRequested":true')));
})().catch(e=>{console.error(e);process.exitCode=1;});
"""
    result = subprocess.run(
        [node, "-e", harness],
        input=json.dumps({"script": script, "scenario": scenario}),
        text=True,
        capture_output=True,
        timeout=5,
    )
    assert result.returncode == 0, result.stderr
