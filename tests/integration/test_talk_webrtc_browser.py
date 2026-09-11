"""Execute shipped Talk JS with browser API fakes: signaling/ownership, never media proof."""

import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "podvoice/gatekeeper/static/index.html"


def test_shipped_browser_peer_identity_stop_late_offer_and_typed_to_mic():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is required for the shipped browser JavaScript regression")
    html = SCRIPT.read_text()
    helpers = html.split("// ---- Live WebRTC: one peer for one server-issued attempt ----", 1)[
        1
    ].split("// ---- End Live WebRTC ----", 1)[0]
    mic = (
        "async function micStart()"
        + html.split("async function micStart()", 1)[1].split("  if (window.isSecureContext", 1)[0]
    )
    harness = r"""
const assert = require('node:assert/strict');
let sent = [], peers = [], permissionCalls = 0, replaceGate = null, offerGate = null;
var ws = {}, wsReady = true, socketGeneration = 1, halted = false, capStream = null, capCtx = null, capNode = null,
    playCtx = null, micOn = false, micRequestSerial = 0;
var micHint = {}, micBtn = {classList:{add(){},remove(){}},setAttribute(){}};
function track(){return {enabled:true,readyState:'live',stop(){this.readyState='ended';}};}
function stream(){let t=track();return {getTracks:()=>[t],getAudioTracks:()=>[t]};}
function ensurePlay(){if(!playCtx)playCtx={sampleRate:24000,createMediaStreamDestination:()=>({stream:stream()}),
 createBuffer:()=>({}),createBufferSource:()=>({connect(){},start(){},stop(){this.stopped=true;},disconnect(){}})};}
function sendJson(x){sent.push(x);}
function logLine(){}
function setState(){}
var window={self:{},top:{}};
var navigator={mediaDevices:{async getUserMedia(){permissionCalls++;return stream();}}};
class RTCPeerConnection{
 constructor(){this.iceGatheringState='complete';this.connectionState='new';peers.push(this);}
 addTrack(t){this.sender={track:t,async replaceTrack(next){if(replaceGate)await replaceGate;this.track=next;}};return this.sender;}
 createDataChannel(){this.dc={};return this.dc;}
 async createOffer(){if(offerGate)await offerGate;return {type:'offer',sdp:'v=0\r\n'+peers.length};}
 async setLocalDescription(x){this.localDescription=x;}
 async setRemoteDescription(x){this.remoteDescription=x;}
 close(){this.connectionState='closed';if(this.onconnectionstatechange)this.onconnectionstatechange();}
}
class Audio{play(){return Promise.resolve();}pause(){this.paused=true;}}
function request(id){return {type:'live_offer_request',attempt_id:id,connection_id:'conn'};}
function answer(id,gen=1){return {type:'live_answer',attempt_id:id,connection_id:'conn',provider_session_id:'provider-'+id,generation:gen,sdp:'v=0\r\nanswer'};}
"""
    cases = r"""
(async()=>{
 await openLivePeer(request('a'));
 assert.equal(permissionCalls,0); // Typed first never asks for microphone permission.
 assert.equal(sent.filter(x=>x.type==='live_offer').length,1);
 let p=livePeer, clock=p.input.getAudioTracks()[0];
 assert.equal(clock.enabled,true); // Real silent input clock, matching the protocol probe.
 await answerLivePeer(answer('wrong'));assert.equal(p.pc.remoteDescription,undefined);
 await answerLivePeer(answer('a'));
 p.pc.dc.onmessage({data:JSON.stringify({type:'session.started',session:{id:'provider-a'}})});
 assert.equal(sent.at(-1).type,'live_started');
 handleLiveMessage({...answer('a'),type:'live_ready'});
 assert.equal(p.ready,true);
 assert.equal(await micStart(),true); // Upgrade existing silent sender, no extra peer/PCM graph.
 assert.equal(permissionCalls,1);assert.equal(peers.length,1);assert.equal(capNode,null);
 assert.equal(clock.readyState,'ended');assert.equal(p.input.getAudioTracks()[0].enabled,true);
 let realMic=p.input.getAudioTracks()[0];
 handleLiveMessage({...answer('a'),type:'live_stop'});
 assert.equal(realMic.readyState,'ended');assert.equal(p.pc.connectionState,'closed');
 assert.equal(sent.at(-1).type,'live_stopped');
 halted=false;await openLivePeer(request('b'));let current=livePeer;
 handleLiveMessage({...answer('a'),type:'live_stop'});
 assert.equal(livePeer,current);assert.equal(halted,false); // Old Stop cannot kill current peer.
 closeLivePeer();halted=false;
 let releaseOffer;offerGate=new Promise(r=>releaseOffer=r);
 let opening=openLivePeer(request('late'));
 await Promise.resolve();halted=true;closeLivePeer();releaseOffer();await opening;offerGate=null;
 assert.equal(sent.some(x=>x.type==='live_offer'&&x.attempt_id==='late'),false);
 halted=false;await openLivePeer(request('replace'));await answerLivePeer(answer('replace'));
 handleLiveMessage({...answer('replace'),type:'live_ready'});
 let releaseReplace;replaceGate=new Promise(r=>releaseReplace=r);
 let replacing=micStart();await Promise.resolve();await Promise.resolve();
 let pending=livePeer.pendingInput.getAudioTracks()[0];
 handleLiveMessage({...answer('replace'),type:'live_stop'});
 assert.equal(pending.readyState,'ended');releaseReplace();assert.equal(await replacing,false);
 assert.equal(livePeer,null);assert.equal(micOn,false);
})().catch(e=>{console.error(e);process.exitCode=1;});
"""
    result = subprocess.run(
        [node, "-e", harness + helpers + mic + cases], text=True, capture_output=True, timeout=10
    )
    assert result.returncode == 0, result.stderr
