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
