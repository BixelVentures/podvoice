#!/usr/bin/env python3
"""Isolated one-session Live WebRTC/sideband proof. See docs/LIVE_WEBRTC_PROBE.md."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import hashlib
import hmac
import io
import json
import math
import os
import secrets
import time
import wave
from pathlib import Path

from aiohttp import web
from live_alpha_probe import Probe, ProbeError, numeric_usage, session_config

TYPED_TEXT = "Hvad er prøvens status? Svar kort på dansk."
MAX_SESSION_S = 30
STARTUP_S = 15
CLOSE_S = 15


def configuration():
    config = session_config()
    config["audio"].pop("format")  # WebRTC negotiates media; PCM format is WS-only.
    config["client"] = {
        "data_channel": {
            "allowed_client_events": [],
            "allowed_server_events": [
                {"type": t} for t in ("session.started", "session.closed", "error")
            ],
        }
    }
    return config


def fixture_wav(path: Path, expected_sha: str):
    pcm = path.read_bytes()
    if not 0 < len(pcm) <= 24000 * 2 * 10 or len(pcm) % 2:
        raise ValueError("fixture must be aligned mono PCM16 24kHz, at most 10 seconds")
    if not hmac.compare_digest(hashlib.sha256(pcm).hexdigest(), expected_sha):
        raise ValueError("fixture SHA256 mismatch")
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(pcm)
    return output.getvalue()


class WebRTCProbe:
    def __init__(self, key, fixture, report_path, *, port=18799, client_factory=None):
        self.key, self.fixture, self.report_path = key, fixture, report_path
        self.origin = f"http://127.0.0.1:{port}"
        self.nonce = secrets.token_urlsafe(24)
        self.client_factory = client_factory
        self.used = False
        self.admission_closed = False
        self.stop_started = False
        self.client = self.connection = self.manager = None
        self.reader = self.deadline = self.stop_task = self.startup = None
        self.session_id = None
        self.updated = asyncio.Event()
        self.closed = asyncio.Event()
        self.done = asyncio.Event()
        self.probe = Probe()
        self.update_id = "attach_" + secrets.token_hex(8)
        self.records = []
        self.typed_task = None
        self.typed_sent = False
        self.backend_started = 0
        self.record("prepared", fixture_wav_sha256=hashlib.sha256(fixture).hexdigest())

    def record(self, kind, **fields):
        self.records.append({"kind": kind, "monotonic_s": time.monotonic(), **fields})
        self.report_path.write_text(
            json.dumps(
                {
                    "scope": "synthetic muted browser transport; no physical/drain/semantic proof",
                    "records": self.records,
                    "probe": self.probe.report(),
                },
                indent=2,
            )
        )

    def authorize(self, request, *, page=False):
        nonce = request.query.get("nonce", "") if page else request.headers.get("X-Probe-Nonce", "")
        if request.host != self.origin.removeprefix("http://") or not hmac.compare_digest(
            nonce, self.nonce
        ):
            raise web.HTTPForbidden()
        if request.method == "POST" and request.headers.get("Origin") != self.origin:
            raise web.HTTPForbidden()

    async def create(self, offer):
        if self.admission_closed or self.probe.closing or self.done.is_set():
            raise ProbeError("probe_already_stopped")
        if self.used:
            raise ProbeError("session_already_consumed")
        self.used = True  # Before any await: no duplicate creates, even on failure.
        self.startup = asyncio.current_task()
        factory = self.client_factory
        if factory is None:
            from openai import AsyncOpenAI

            factory = AsyncOpenAI
        self.client = factory(api_key=self.key, max_retries=0, timeout=STARTUP_S)
        try:
            async with asyncio.timeout(STARTUP_S):
                result = await self.client.live.create(
                    session=configuration(), transport={"type": "webrtc", "sdp": offer}
                )
                if self.admission_closed:
                    raise ProbeError("startup_stopped")
                self.session_id = result.session.id
                self.record("session_created", session_id=self.session_id)
                self.deadline = asyncio.create_task(self.expire())
                self.manager = self.client.live.sideband.connect(
                    session_id=self.session_id,
                    max_retries=0,
                    graceful_close=True,
                    max_queue_size=65536,
                )
                self.connection = await self.manager.__aenter__()
                if self.admission_closed:
                    raise ProbeError("startup_stopped")
                self.record("sideband_attached")
                self.reader = asyncio.create_task(self.receive())
                await self.connection.session.update(event_id=self.update_id, session={})
                # Some acknowledgments can need media progress. Do not wait before SDP answer.
                self.record("answer_returned")
                return {
                    "session": {"id": self.session_id},
                    "transport": {"type": "webrtc", "sdp": result.transport.sdp},
                }
        except BaseException:
            self.record("startup_failed", outcome="creation_or_finalization_may_be_unknown")
            await self.stop()
            raise
        finally:
            self.startup = None

    async def receive(self):
        try:
            while True:
                # SDK sideband typed union omits reflected PCM; documented raw receiver preserves it.
                event = json.loads(await self.connection.recv_bytes())
                kind = event.get("type")
                if kind == "session.updated" and event.get("client_event_id") == self.update_id:
                    if event.get("session", {}).get("id") != self.session_id:
                        raise ProbeError("attachment_identity_mismatch")
                    self.record("snapshot_identity", session_id=self.session_id)
                    self.updated.set()
                    self.record("attachment_snapshot_confirmed")
                elif kind == "session.started":
                    if event.get("session", {}).get("id") != self.session_id:
                        raise ProbeError("started_identity_mismatch")
                    self.probe.started.set()
                    self.record(
                        "sideband_session_started",
                        matches=event.get("session", {}).get("id") == self.session_id,
                    )
                elif kind == "response.event":
                    if event.get("event", {}).get("type") == "response.created":
                        self.backend_started += 1
                        if self.backend_started > 4:
                            raise ProbeError("backend_response_limit")
                    if (
                        event.get("event", {}).get("type") == "response.output_item.done"
                        and event["event"].get("item", {}).get("type") == "function_call"
                    ):
                        if len(self.probe.seen_calls) >= 2:
                            raise ProbeError("stub_call_limit")
                    await self.probe.backend(event, self.connection)
                    self.record("backend_event", event=event["event"]["type"])
                elif kind in {"session.closed", "session.usage.updated"}:
                    await self.probe.handle(event, self.connection)
                    self.record(kind, usage=numeric_usage(event.get("usage")))
                    if kind == "session.closed":
                        self.closed.set()
                        return
                elif kind == "error":
                    raise ProbeError("provider_error")
        except Exception as exc:
            self.record(
                "receiver_failed",
                code=str(exc) if isinstance(exc, ProbeError) else type(exc).__name__,
                finalization_confirmed=self.closed.is_set(),
            )
            self.request_stop()

    async def ready(self, session_id):
        if session_id != self.session_id or self.admission_closed or self.probe.closing:
            raise ProbeError("stale_browser_session")
        await asyncio.wait_for(self.updated.wait(), STARTUP_S)
        if self.admission_closed or self.probe.closing or self.typed_sent:
            raise ProbeError("typed_command_unavailable")
        self.typed_sent = True  # Atomic one-use admission; no lock spans network I/O.
        self.typed_task = asyncio.current_task()
        try:
            async with asyncio.timeout(STARTUP_S):
                await self.connection.response.item.create(
                    item={
                        "type": "message",
                        "role": "user",
                        "content": [{"type": "input_text", "text": TYPED_TEXT}],
                    }
                )
                if self.admission_closed or self.probe.closing:
                    raise ProbeError("typed_command_stopped")
                await self.connection.response.create()
                if not self.probe.closing:
                    self.record("typed_probe_submitted", provider_ack="unavailable")
        finally:
            self.typed_task = None

    async def expire(self):
        await asyncio.sleep(MAX_SESSION_S)
        await self.stop()

    def request_stop(self):
        self.admission_closed = True
        self.probe.closing = True
        if self.stop_task is None or self.stop_task.done():
            self.stop_task = asyncio.create_task(self.stop())

    async def stop(self):
        self.admission_closed = True
        if self.stop_started:
            return
        self.stop_started = True
        self.probe.closing = True  # Fence before any await, including stalled SDK commands.
        try:
            owners = {
                task
                for task in (self.startup, self.typed_task)
                if task is not None and task is not asyncio.current_task()
            }
            for task in owners:
                task.cancel()
            if owners:
                finished, pending = await asyncio.wait(owners, timeout=1)
                await asyncio.gather(*finished, return_exceptions=True)
                if pending:
                    self.record("command_cancellation_incomplete")
            if self.connection is not None and not self.closed.is_set():
                self.record("close_requested")
                async with asyncio.timeout(CLOSE_S):
                    await self.connection.session.close()
                    await self.closed.wait()
        except Exception:
            self.record("finalization_incomplete")
        finally:
            current = asyncio.current_task()
            for task in (self.reader, self.deadline):
                if task is not None and task is not current:
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
            with contextlib.suppress(Exception):
                async with asyncio.timeout(3):
                    if self.manager is not None:
                        await self.manager.__aexit__(None, None, None)
                    if self.client is not None:
                        await self.client.close()
            self.record(
                "cleanup",
                final_usage_confirmed=self.closed.is_set() and "seconds" in self.probe.voice_usage,
            )
            self.done.set()


def app_for(probe):
    app = web.Application(client_max_size=65536)

    async def route(request):
        probe.authorize(request, page=request.path == "/")
        if request.path == "/":
            return web.Response(
                text=HTML.replace("NONCE", probe.nonce),
                content_type="text/html",
                headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
            )
        if request.path == "/fixture":
            return web.Response(body=probe.fixture, content_type="audio/wav")
        data = await request.json()
        if not isinstance(data, dict):
            raise web.HTTPBadRequest()
        try:
            if request.path == "/session":
                sdp = data.get("sdp")
                if not isinstance(sdp, str) or not sdp.strip() or len(sdp) > 60000:
                    raise web.HTTPBadRequest()
                return web.json_response(await probe.create(sdp))
            if request.path == "/ready":
                await probe.ready(data.get("session_id"))
            elif request.path == "/stop":
                probe.request_stop()
            elif request.path == "/telemetry":
                # No arbitrary browser text, URLs, SDP, candidate addresses or credentials in evidence.
                if len(probe.records) >= 512:
                    raise web.HTTPTooManyRequests()
                fields = {
                    k: v
                    for k, v in data.items()
                    if k
                    in {
                        "currentTime",
                        "bytesReceived",
                        "packetsReceived",
                        "totalSamplesReceived",
                        "jitterBufferEmittedCount",
                        "audioContextTime",
                        "muted",
                        "fixtureStarted",
                        "started",
                        "closed",
                        "outputPlaying",
                        "peerConnected",
                        "tracksStopped",
                    }
                    and (isinstance(v, bool) or (type(v) in (int, float) and math.isfinite(v)))
                }
                probe.record("browser", **fields)
            return web.json_response({"ok": True})
        except web.HTTPException:
            raise
        except Exception:
            probe.record("request_failed", path=request.path)
            probe.request_stop()
            raise web.HTTPConflict(text="probe_boundary_failed") from None

    app.router.add_get("/", route)
    app.router.add_get("/fixture", route)
    for path in ("/session", "/ready", "/stop", "/telemetry"):
        app.router.add_post(path, route)
    return app


HTML = """<!doctype html><meta charset="utf-8"><title>Isolated muted Live WebRTC proof</title>
<h1>Muted WebRTC / sideband proof</h1><p>Synthetic fixture only. No microphone permission or speakers.</p>
<button id="start">Start one bounded API session</button><button id="stop">Stop</button><pre id="status">Prepared; no provider connected.</pre>
<script>
const nonce='NONCE', status=document.querySelector('#status'), audio=new Audio(); audio.muted=true;
let peer, dc, ac, silent, source, stream, timer, fixtureTimer, lifetime, id, started=false, closed=false, outputPlaying=false, fixtureStarted=false, stopping=false;
function requireRunning(){if(stopping)throw Error('Probe stopped');}
async function post(path,data={}) { if(path==='/session'||path==='/ready')requireRunning();const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Probe-Nonce':nonce},body:JSON.stringify(data)});if(!r.ok)throw Error('Probe request failed');return r.json(); }
function muteNow(){stopping=true;document.querySelector('#start').disabled=true;clearTimeout(fixtureTimer);source?.stop();audio.muted=true;audio.pause();audio.srcObject=null;stream?.getTracks().forEach(t=>t.stop());}
async function cleanup(){clearInterval(timer);clearTimeout(lifetime);muteNow();dc?.close();peer?.close();await ac?.close();status.textContent='Closed. Finalization and browser drain are separate; inspect server report.';post('/telemetry',{tracksStopped:true,closed,muted:audio.muted}).catch(()=>{});}
async function stop(){if(stopping)return;muteNow();status.textContent='Output muted and source stopped; collecting final usage.';post('/stop').catch(()=>{});setTimeout(cleanup,17000);}
document.querySelector('#stop').onclick=stop;
document.querySelector('#start').onclick=async()=>{
 if(stopping)return;
 document.querySelector('#start').disabled=true;
 try {
  lifetime=setTimeout(stop,45000); peer=new RTCPeerConnection();
  audio.onplaying=()=>{outputPlaying=true;};peer.ontrack=e=>{if(stopping){e.track.stop();return;}audio.srcObject=new MediaStream([e.track]);audio.play().catch(stop);};
  ac=new AudioContext();await ac.resume();requireRunning();const dest=ac.createMediaStreamDestination();stream=dest.stream;
  silent=ac.createBufferSource();silent.buffer=ac.createBuffer(1,ac.sampleRate,ac.sampleRate);silent.loop=true;silent.connect(dest);silent.start();
  const fixture=await fetch('/fixture',{headers:{'X-Probe-Nonce':nonce}});requireRunning();if(!fixture.ok)throw Error('Fixture unavailable');const buffer=await ac.decodeAudioData(await fixture.arrayBuffer());requireRunning();
  stream.getTracks().forEach(t=>peer.addTrack(t,stream));dc=peer.createDataChannel('oai-events');
  dc.onmessage=async e=>{try{const ev=JSON.parse(e.data);if(ev.type==='session.started'){
   requireRunning();if(started||ev.session.id!==id)throw Error('Session identity mismatch');started=true;await post('/ready',{session_id:id});requireRunning();
   status.textContent='Attached identity confirmed; typed-only probe uses silent input. Fixture follows in 8 seconds.';
   fixtureTimer=setTimeout(()=>{if(stopping)return;fixtureStarted=true;source=ac.createBufferSource();source.buffer=buffer;source.connect(dest);source.start();},8000);
  }else if(ev.type==='session.closed'){closed=true;await cleanup();}else if(ev.type==='error'){await stop();}}catch(_){await stop();}};
  dc.onclose=()=>{if(!closed)stop();};peer.onconnectionstatechange=()=>{if(['failed','closed'].includes(peer.connectionState)&&!stopping)stop();};
  await peer.setLocalDescription(await peer.createOffer());
  await new Promise((resolve,reject)=>{if(peer.iceGatheringState==='complete')return resolve();const t=setTimeout(()=>reject(Error('ICE timeout')),10000);peer.onicegatheringstatechange=()=>{if(peer.iceGatheringState==='complete'){clearTimeout(t);resolve();}};});
  requireRunning();const result=await post('/session',{sdp:peer.localDescription.sdp});id=result.session.id;requireRunning();await peer.setRemoteDescription({type:'answer',sdp:result.transport.sdp});
  timer=setInterval(async()=>{if(stopping)return;let sample={started,closed,muted:audio.muted,outputPlaying,fixtureStarted,currentTime:audio.currentTime,audioContextTime:ac.currentTime,peerConnected:peer.connectionState==='connected'};
   (await peer.getStats()).forEach(s=>{if(s.type==='inbound-rtp'&&s.kind==='audio')for(const k of ['bytesReceived','packetsReceived','totalSamplesReceived','jitterBufferEmittedCount'])if(Number.isFinite(s[k]))sample[k]=s[k];});post('/telemetry',sample).catch(stop);},500);
 }catch(_){status.textContent='Probe failed; server report records the boundary.';await stop();}
};
window.addEventListener('pagehide',()=>{muteNow();fetch('/stop',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json','X-Probe-Nonce':nonce},body:'{}'}).catch(()=>{});});
</script>"""


async def run(args):
    key = os.environ.pop("OPENAI_API_KEY", "")
    if not key:
        raise ValueError("OPENAI_API_KEY must exist only in the server environment")
    probe = WebRTCProbe(
        key, fixture_wav(args.fixture, args.fixture_sha256), args.report, port=args.port
    )
    runner = web.AppRunner(app_for(probe), access_log=None)
    await runner.setup()
    try:
        await web.TCPSite(runner, "127.0.0.1", args.port).start()
        print(f"Prepared, no API request yet: {probe.origin}/?nonce={probe.nonce}", flush=True)
        await asyncio.wait_for(probe.done.wait(), 180)
        await asyncio.sleep(1)  # Permit final browser telemetry before local server exits.
    finally:
        await probe.stop()
        await runner.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--fixture-sha256", required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--port", type=int, default=18799)
    asyncio.run(run(parser.parse_args()))
