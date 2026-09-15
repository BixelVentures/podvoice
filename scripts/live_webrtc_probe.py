#!/usr/bin/env python3
"""Isolated one-session Live WebRTC/sideband proof. See docs/LIVE_WEBRTC_PROBE.md.

Optional --farewell-trial requires new private timeline/provider-audio/browser-capture
paths. It records sideband PCM24k with actual offsets and a muted audio-element
captureStream as WebM. Browser media capture is not physical speaker proof; a complete
farewell is judged from the artifacts, never assumed from the prompt or session.closed.
Unsupported, empty, missing or oversized capture fails the bounded trial.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
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
from live_alpha_probe import Probe, ProbeError, numeric_usage, session_config, wait_farewell_grace

TYPED_TEXT = "Hvad er prøvens status? Svar kort på dansk."
MAX_SESSION_S = 30
STARTUP_S = 15
CLOSE_S = 15
MAX_CAPTURE_BYTES = 3 * 1024 * 1024
STOP_OWNER_WAIT_S = 1.0


def configuration(*, farewell_trial=False):
    config = session_config(farewell_trial=farewell_trial)
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
    def __init__(
        self,
        key,
        fixture,
        report_path,
        *,
        port=18799,
        client_factory=None,
        farewell_trial=False,
        timeline=None,
        provider_audio=None,
        browser_audio=None,
    ):
        self.key, self.fixture, self.report_path = key, fixture, report_path
        self.origin = f"http://127.0.0.1:{port}"
        self.nonce = secrets.token_urlsafe(24)
        self.client_factory = client_factory
        self.used = False
        self.admission_closed = False
        self.stop_started = False
        self.cleanup_started = False
        self.client = self.connection = self.manager = None
        self.reader = self.deadline = self.stop_task = self.startup = None
        self.farewell_grace_task = None
        self.session_id = None
        self.updated = asyncio.Event()
        self.closed = asyncio.Event()
        self.done = asyncio.Event()
        self.farewell_trial = farewell_trial
        self.provider_audio, self.browser_audio = provider_audio, browser_audio
        self.provider_bytes = 0
        self.capture_used = False
        self.capture_saved = False
        self.capture_failed = False
        self.capture_done = asyncio.Event()
        self.probe = Probe(timeline=timeline, farewell_trial=farewell_trial)
        self.update_id = "attach_" + secrets.token_hex(8)
        self.records = []
        self.typed_task = None
        self.typed_sent = False
        self.backend_started = 0
        self.record("prepared", fixture_wav_sha256=hashlib.sha256(fixture).hexdigest())

    def record(self, kind, **fields):
        metadata = {
            k: v
            for k, v in fields.items()
            if type(v) is bool or (type(v) in (int, float) and math.isfinite(v))
        }
        if isinstance(fields.get("session_id"), str):
            metadata.update(self.probe.correlations({"id": fields["session_id"]}))
        self.probe.trace("webrtc." + kind, **metadata)
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
            async with asyncio.timeout(STARTUP_S) as startup_deadline:
                result = await self.client.live.create(
                    session=configuration(farewell_trial=self.farewell_trial),
                    transport={"type": "webrtc", "sdp": offer},
                )
                self.session_id = result.session.id
                self.record("session_created", session_id=self.session_id)
                if startup_deadline.expired():
                    self.admission_closed = True
                if not self.admission_closed:
                    self.deadline = asyncio.create_task(self.expire())
                self.manager = self.client.live.sideband.connect(
                    session_id=self.session_id,
                    max_retries=0,
                    graceful_close=True,
                    max_queue_size=65536,
                )
                # A late allocation after cancellation still owns one close path.
                async with asyncio.timeout(STARTUP_S):
                    self.connection = await self.manager.__aenter__()
                self.reader = asyncio.create_task(self.receive())
                if self.admission_closed or startup_deadline.expired():
                    raise ProbeError("startup_stopped")
                self.record("sideband_attached")
                await self.connection.session.update(event_id=self.update_id, session={})
                if self.admission_closed or startup_deadline.expired():
                    raise ProbeError("startup_stopped")
                # Some acknowledgments can need media progress. Do not wait before SDP answer.
                self.record("answer_returned")
                return {
                    "session": {"id": self.session_id},
                    "transport": {"type": "webrtc", "sdp": result.transport.sdp},
                }
        except BaseException:
            self.record("startup_failed", outcome="creation_or_finalization_may_be_unknown")
            if self.stop_started:
                await self._cleanup()
            else:
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
                if self.farewell_trial and kind in {
                    "session.delegation.created",
                    "session.input_transcript.delta",
                    "session.output_transcript.delta",
                    "session.instructions.appended",
                }:
                    await self.probe.handle(event, self.connection)
                if self.farewell_trial and kind == "session.output_audio.delta":
                    pcm = base64.b64decode(event["delta"], validate=True)
                    start, end = event.get("start_ms"), event.get("end_ms")
                    if (
                        not pcm
                        or len(pcm) % 2
                        or len(pcm) > 48000
                        or type(start) is not int
                        or type(end) is not int
                        or not 0 <= start <= end
                        or self.provider_bytes + len(pcm) > MAX_CAPTURE_BYTES
                    ):
                        raise ProbeError("invalid_reflected_audio")
                    if self.provider_audio is None:
                        raise ProbeError("provider_capture_unavailable")
                    offset = self.provider_bytes
                    self.provider_audio.write(pcm)
                    self.provider_audio.flush()
                    self.provider_bytes += len(pcm)
                    self.probe.trace(
                        "session.output_audio.delta",
                        start_ms=start,
                        end_ms=end,
                        byte_start=offset,
                        byte_end=self.provider_bytes,
                        sha256=hashlib.sha256(pcm).hexdigest(),
                        disposition="sideband_reflection_saved",
                    )
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
                    if self.probe.terminal_requested.is_set() and self.farewell_grace_task is None:
                        self.farewell_grace_task = asyncio.create_task(
                            self.close_after_farewell_grace(self.probe, self.session_id)
                        )
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

    async def close_after_farewell_grace(self, probe, session_id):
        elapsed = await wait_farewell_grace(probe)
        if (
            elapsed
            and probe.farewell_grace_elapsed
            and self.probe is probe
            and self.session_id == session_id
            and not self.admission_closed
            and not probe.closing
            and not self.closed.is_set()
        ):
            self.record("farewell_grace_close_requested", speech_completion_proven=False)
            self.request_stop()

    async def ready(self, session_id):
        if session_id != self.session_id or self.admission_closed or self.probe.closing:
            raise ProbeError("stale_browser_session")
        await asyncio.wait_for(self.updated.wait(), STARTUP_S)
        if self.admission_closed or self.probe.closing or self.typed_sent:
            raise ProbeError("typed_command_unavailable")
        self.typed_sent = True  # Atomic one-use admission; no lock spans network I/O.
        if self.farewell_trial:
            self.record("farewell_fixture_admitted")
            return  # The synthetic fixture drives primary speech; no typed backend kick.
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
            if self.stop_started:
                await self._cleanup()

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
        grace = self.farewell_grace_task
        if grace is not None and grace is not asyncio.current_task():
            grace.cancel()
            await asyncio.gather(grace, return_exceptions=True)
        owners = {
            task
            for task in (self.startup, self.typed_task)
            if task is not None and task is not asyncio.current_task()
        }
        for task in owners:
            task.cancel()
        if owners:
            finished, pending = await asyncio.wait(owners, timeout=STOP_OWNER_WAIT_S)
            await asyncio.gather(*finished, return_exceptions=True)
            if pending:
                self.record("command_cancellation_incomplete")
                if self.startup in pending:
                    return  # A late allocation owns cleanup; never release its client early.
                # An attached send can need client close to unblock. Keep its task
                # ownership, but start resource cleanup rather than waiting on itself.
        await self._cleanup()

    async def _cleanup(self):
        if self.cleanup_started:
            return
        self.cleanup_started = True
        try:
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
            typed = self.typed_task
            if typed is not None and typed is not current:
                finished, pending = await asyncio.wait({typed}, timeout=STOP_OWNER_WAIT_S)
                await asyncio.gather(*finished, return_exceptions=True)
                if pending:
                    self.record("typed_command_settlement_incomplete")
            self.record(
                "cleanup",
                final_usage_confirmed=self.closed.is_set() and "seconds" in self.probe.voice_usage,
            )
            self.done.set()

    def require_farewell_evidence(self):
        seconds = self.probe.voice_usage.get("seconds")
        if (
            not self.probe.terminal_requested.is_set()
            or not self.closed.is_set()
            or type(seconds) not in (int, float)
            or not math.isfinite(seconds)
            or seconds < 0
            or not self.provider_bytes
            or not self.capture_saved
            or self.capture_failed
            or self.probe.timeline_failed
        ):
            raise ProbeError("farewell_trial_evidence_incomplete")


def app_for(probe):
    app = web.Application(client_max_size=65536)

    async def route(request):
        probe.authorize(request, page=request.path == "/")
        if request.path == "/":
            return web.Response(
                text=HTML.replace("NONCE", probe.nonce).replace(
                    "const farewell=false;",
                    "const farewell=true;" if probe.farewell_trial else "const farewell=false;",
                ),
                content_type="text/html",
                headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
            )
        if request.path == "/fixture":
            return web.Response(body=probe.fixture, content_type="audio/wav")
        if request.path == "/capture":
            if not probe.farewell_trial or probe.browser_audio is None or probe.capture_used:
                raise web.HTTPConflict(text="capture_unavailable")
            if request.content_type != "audio/webm":
                raise web.HTTPBadRequest(text="capture_format")
            if request.headers.get("X-Capture-Failed") != "false":
                probe.capture_failed = True
                raise web.HTTPBadRequest(text="capture_failed")
            probe.capture_used = True
            total, digest = 0, hashlib.sha256()
            try:
                async with asyncio.timeout(5):
                    async for chunk in request.content.iter_chunked(65536):
                        total += len(chunk)
                        if total > MAX_CAPTURE_BYTES:
                            raise web.HTTPRequestEntityTooLarge(
                                max_size=MAX_CAPTURE_BYTES, actual_size=total
                            )
                        digest.update(chunk)
                        probe.browser_audio.write(chunk)
                    probe.browser_audio.flush()
                if total == 0:
                    raise web.HTTPBadRequest(text="capture_empty")
                probe.record(
                    "browser_media_capture_saved",
                    byte_count=total,
                    sha256=digest.hexdigest(),
                    physical_playback_verified=False,
                    initial_render_may_precede_capture=True,
                )
                probe.capture_saved = True
                return web.json_response({"ok": True})
            except Exception:
                probe.capture_failed = True
                probe.record("browser_media_capture_failed", byte_count=total)
                raise
            finally:
                probe.capture_done.set()
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
                        "captureSupported",
                        "captureFailed",
                        "captureStarted",
                        "captureStopRequested",
                    }
                    and (isinstance(v, bool) or (type(v) in (int, float) and math.isfinite(v)))
                }
                if fields.get("captureFailed") is True:
                    probe.capture_failed = True
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
    app.router.add_post("/capture", route)
    for path in ("/session", "/ready", "/stop", "/telemetry"):
        app.router.add_post(path, route)
    return app


HTML = """<!doctype html><meta charset="utf-8"><title>Isolated muted Live WebRTC proof</title>
<h1>Muted WebRTC / sideband proof</h1><p>Synthetic fixture only. No microphone permission or speakers.</p>
<button id="start">Start one bounded API session</button><button id="stop">Stop</button><pre id="status">Prepared; no provider connected.</pre>
<script>
const nonce='NONCE', status=document.querySelector('#status'), audio=new Audio(); audio.muted=true;
const farewell=false;
let recorder, captureReady, captured=[], captureBytes=0, captureStopping, captureStarted=false, captureFailed=false;
function startCapture(){
 if(!farewell||captureStarted)return;
 if(!audio.captureStream||!window.MediaRecorder||!MediaRecorder.isTypeSupported('audio/webm;codecs=opus')){captureFailed=true;post('/telemetry',{captureSupported:false,captureFailed:true}).catch(()=>{});stop();return;}
 try{
  const media=audio.captureStream(), tracks=media.getAudioTracks();if(!tracks.length)throw Error('Capture track unavailable');
  recorder=new MediaRecorder(new MediaStream(tracks),{mimeType:'audio/webm;codecs=opus'});
  captureReady=new Promise(resolve=>{recorder.onstop=resolve;});
  recorder.ondataavailable=e=>{if(!e.data.size)return;captureBytes+=e.data.size;if(captureBytes>3145728){captureFailed=true;post('/telemetry',{captureFailed:true}).catch(()=>{});stop();return;}captured.push(e.data);};
  recorder.onerror=()=>{captureFailed=true;post('/telemetry',{captureFailed:true}).catch(()=>{});stop();};
  recorder.start(250);captureStarted=true;post('/telemetry',{captureSupported:true,captureStarted:true}).catch(stop);
 }catch(_){captureFailed=true;post('/telemetry',{captureFailed:true}).catch(()=>{});stop();}
}
function finishCapture(){
 if(!farewell)return Promise.resolve();if(captureStopping)return captureStopping;
 captureStopping=new Promise(resolve=>{
  if(!recorder){captureFailed=true;post('/telemetry',{captureFailed:true}).catch(()=>{});resolve();return;}
  post('/telemetry',{captureStopRequested:true}).catch(()=>{});
  const deadline=setTimeout(()=>{captureFailed=true;post('/telemetry',{captureFailed:true}).catch(()=>{});resolve();},5000);
  captureReady.then(async()=>{try{if(captureFailed||!captured.length||captureBytes>3145728)throw Error('Capture unavailable');const r=await fetch('/capture',{method:'POST',headers:{'Content-Type':'audio/webm','X-Probe-Nonce':nonce,'X-Capture-Failed':'false'},body:new Blob(captured,{type:'audio/webm'})});if(!r.ok)throw Error('Capture save failed');}catch(_){captureFailed=true;post('/telemetry',{captureFailed:true}).catch(()=>{});}finally{clearTimeout(deadline);resolve();}});
  if(recorder.state!=='inactive')recorder.stop();
 });return captureStopping;
}
let peer, dc, ac, silent, source, stream, timer, fixtureTimer, lifetime, id, started=false, closed=false, outputPlaying=false, fixtureStarted=false, stopping=false;
function requireRunning(){if(stopping)throw Error('Probe stopped');}
async function post(path,data={}) { if(path==='/session'||path==='/ready')requireRunning();const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Probe-Nonce':nonce},body:JSON.stringify(data)});if(!r.ok)throw Error('Probe request failed');return r.json(); }
function muteNow(){stopping=true;document.querySelector('#start').disabled=true;clearTimeout(fixtureTimer);source?.stop();audio.muted=true;audio.pause();audio.srcObject=null;stream?.getTracks().forEach(t=>t.stop());}
async function cleanup(){clearInterval(timer);clearTimeout(lifetime);const capture=finishCapture();muteNow();dc?.close();peer?.close();await ac?.close();await capture;status.textContent='Closed. Finalization and browser media capture are separate; inspect server report.';post('/telemetry',{tracksStopped:true,closed,muted:audio.muted}).catch(()=>{});}
async function stop(){if(stopping)return;muteNow();status.textContent='Output muted and source stopped; collecting final usage.';post('/stop').catch(()=>{});setTimeout(cleanup,17000);}
document.querySelector('#stop').onclick=stop;
document.querySelector('#start').onclick=async()=>{
 if(stopping)return;
 document.querySelector('#start').disabled=true;
 try {
  lifetime=setTimeout(stop,45000); peer=new RTCPeerConnection();
  audio.onplaying=()=>{outputPlaying=true;startCapture();};peer.ontrack=e=>{if(stopping){e.track.stop();return;}audio.srcObject=new MediaStream([e.track]);audio.play().catch(stop);};
  ac=new AudioContext();await ac.resume();requireRunning();const dest=ac.createMediaStreamDestination();stream=dest.stream;
  silent=ac.createBufferSource();silent.buffer=ac.createBuffer(1,ac.sampleRate,ac.sampleRate);silent.loop=true;silent.connect(dest);silent.start();
  const fixture=await fetch('/fixture',{headers:{'X-Probe-Nonce':nonce}});requireRunning();if(!fixture.ok)throw Error('Fixture unavailable');const buffer=await ac.decodeAudioData(await fixture.arrayBuffer());requireRunning();
  stream.getTracks().forEach(t=>peer.addTrack(t,stream));dc=peer.createDataChannel('oai-events');
  dc.onmessage=async e=>{try{const ev=JSON.parse(e.data);if(ev.type==='session.started'){
   requireRunning();if(started||ev.session.id!==id)throw Error('Session identity mismatch');started=true;await post('/ready',{session_id:id});requireRunning();
   status.textContent=farewell?'Attached identity confirmed; synthetic farewell fixture starts now.':'Attached identity confirmed; typed-only probe uses silent input. Fixture follows in 8 seconds.';
   fixtureTimer=setTimeout(()=>{if(stopping)return;fixtureStarted=true;source=ac.createBufferSource();source.buffer=buffer;source.connect(dest);source.start();},farewell?0:8000);
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
    with contextlib.ExitStack() as files:
        timeline = provider_audio = browser_audio = None
        if args.farewell_trial:

            def private_file(path, mode):
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                return files.enter_context(os.fdopen(fd, mode))

            timeline = private_file(args.timeline, "w")
            provider_audio = private_file(args.provider_audio, "wb")
            browser_audio = private_file(args.browser_capture, "wb")
        probe = WebRTCProbe(
            key,
            fixture_wav(args.fixture, args.fixture_sha256),
            args.report,
            port=args.port,
            farewell_trial=args.farewell_trial,
            timeline=timeline,
            provider_audio=provider_audio,
            browser_audio=browser_audio,
        )
        runner = web.AppRunner(app_for(probe), access_log=None)
        await runner.setup()
        try:
            await web.TCPSite(runner, "127.0.0.1", args.port).start()
            print(f"Prepared, no API request yet: {probe.origin}/?nonce={probe.nonce}", flush=True)
            await asyncio.wait_for(probe.done.wait(), 180)
            if args.farewell_trial:
                try:
                    await asyncio.wait_for(probe.capture_done.wait(), 7)
                except TimeoutError:
                    probe.record("browser_media_capture_missing")
                await asyncio.sleep(1)  # Allow final capture failure/cleanup telemetry to arrive.
                probe.require_farewell_evidence()
                probe.record(
                    "farewell_trial_finalized",
                    semantic_farewell_verified=False,
                    physical_playback_verified=False,
                )
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
    parser.add_argument("--farewell-trial", action="store_true")
    parser.add_argument("--timeline", type=Path)
    parser.add_argument(
        "--provider-audio", type=Path, help="New private raw PCM24k sideband reflection file"
    )
    parser.add_argument(
        "--browser-capture",
        type=Path,
        help="New private WebM browser media capture; not speaker proof",
    )
    args = parser.parse_args()
    capture_paths = (args.timeline, args.provider_audio, args.browser_capture)
    if (args.farewell_trial and not all(capture_paths)) or (
        not args.farewell_trial and any(capture_paths)
    ):
        parser.error("--farewell-trial requires all three new capture/timeline paths")
    asyncio.run(run(args))
