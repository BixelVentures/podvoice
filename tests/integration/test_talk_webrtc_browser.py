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
    exit_handlers = "\n".join(
        line
        for line in html.split("// ---- In-panel talk console ----", 1)[1]
        .split("</script>", 1)[0]
        .splitlines()
        if line.strip().startswith(
            ('window.addEventListener("pagehide",', 'window.addEventListener("beforeunload",')
        )
    )
    assert len(exit_handlers.splitlines()) == 2
    harness = r"""
const assert = require('node:assert/strict');
let sent = [], peers = [], permissionCalls = 0, replaceGate = null, offerGate = null, permissionGate = null;
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
var exitCallbacks={};
var window={self:{},top:{},addEventListener(name,callback){exitCallbacks[name]=callback;}};
// A lexical mock also works when Node exposes a getter-only global navigator.
const navigator={mediaDevices:{async getUserMedia(){permissionCalls++;if(permissionGate)return await permissionGate;return stream();}}};
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
 replaceGate=null;
 halted=false;await openLivePeer(request('typed-hold'));await answerLivePeer(answer('typed-hold'));
 handleLiveMessage({...answer('typed-hold'),type:'live_ready'});
 let permissionsBefore=permissionCalls;
 handleLiveMessage({...answer('typed-hold'),type:'live_hold',rotation_token:'typed-token'});
 let heldTyped=livePeer, heldDC=heldTyped.pc.dc;
 assert.equal(heldTyped.held,true);assert.notEqual(heldTyped.pc.connectionState,'closed');
 assert.equal(heldTyped.input.getAudioTracks()[0].readyState,'ended');
 assert.equal(pendingLiveRotation.microphone,false);assert.equal(sent.at(-1).type,'live_held');
 assert.equal(await micStart(),false);assert.equal(permissionCalls,permissionsBefore);
 heldDC.onmessage({data:JSON.stringify({type:'session.closed',usage:{seconds:3}})});
 handleLiveMessage({...answer('typed-hold'),type:'live_finalized'});
 heldDC.onclose(); // Officially finalized transport closure must retain rotation intent.
 assert.equal(livePeer,heldTyped);assert.equal(heldTyped.pc.dc,heldDC);
 assert.notEqual(heldTyped.pc.connectionState,'closed');
 await openLivePeer({...request('typed-fresh'),rotation_token:'typed-token'});
 assert.equal(heldTyped.pc.connectionState,'closed');
 assert.equal(permissionCalls,permissionsBefore);assert.equal(livePeer.microphone,false);
 await answerLivePeer(answer('typed-fresh'));
 handleLiveMessage({...answer('typed-fresh'),type:'live_ready'});
 assert.equal(sent.at(-1).type,'live_resumed');assert.equal(sent.at(-1).capture_ready,true);
 assert.equal(await micStart(),true);
 let oldPeer=livePeer, oldTrack=oldPeer.input.getAudioTracks()[0];
 handleLiveMessage({...answer('typed-fresh'),type:'live_hold',rotation_token:'voice-token'});
 assert.equal(oldTrack.readyState,'ended');assert.equal(oldTrack.enabled,false);
 assert.equal(livePeer,oldPeer);assert.notEqual(oldPeer.pc.connectionState,'closed');
 handleLiveMessage({...answer('typed-fresh'),type:'live_ready'});assert.equal(oldTrack.enabled,false);
 oldPeer.pc.dc.onmessage({data:JSON.stringify({type:'session.closed',usage:{seconds:4}})});
 handleLiveMessage({...answer('typed-fresh'),type:'live_finalized'});
 assert.notEqual(oldPeer.pc.connectionState,'closed');
 assert.equal(pendingLiveRotation.microphone,true);assert.equal(capStream,null);
 await openLivePeer({...request('voice-fresh'),rotation_token:'voice-token'});
 assert.equal(oldPeer.pc.connectionState,'closed');
 let restored=livePeer, newTrack=restored.input.getAudioTracks()[0];
 assert.equal(permissionCalls,permissionsBefore+2);assert.notEqual(newTrack,oldTrack);
 assert.equal(newTrack.enabled,false);assert.equal(capNode,null);assert.equal(restored.microphone,true);
 await answerLivePeer(answer('voice-fresh'));assert.equal(newTrack.enabled,false);
 oldPeer.pc.dc.onmessage({data:JSON.stringify({type:'session.started',session:{id:'provider-typed-fresh'}})});
 assert.equal(livePeer,restored);assert.equal(newTrack.enabled,false);
 handleLiveMessage({...answer('voice-fresh'),type:'live_ready'});
 assert.equal(newTrack.enabled,true);assert.equal(sent.at(-1).rotation_token,'voice-token');
 handleLiveMessage({...answer('voice-fresh'),type:'live_hold',rotation_token:'permission-token'});
 let releasePermission;permissionGate=new Promise(r=>releasePermission=r);
 let restoring=openLivePeer({...request('permission-fresh'),rotation_token:'permission-token'});
 await Promise.resolve();await Promise.resolve();
 handleLiveMessage({...request('permission-fresh'),type:'live_stop'});
 let lateStream=stream();releasePermission(lateStream);await restoring;permissionGate=null;
 assert.equal(lateStream.getAudioTracks()[0].readyState,'ended');assert.equal(livePeer,null);
 assert.equal(pendingLiveRotation,null);
 assert.equal(sent.some(x=>x.type==='live_offer'&&x.attempt_id==='permission-fresh'),false);
 halted=false;await openLivePeer({...request('replay-token'),rotation_token:'permission-token'});
 assert.equal(livePeer,null); // Stop revoked the carry-over permission intent.
 halted=false;await openLivePeer(request('stop-held'));await answerLivePeer(answer('stop-held'));
 handleLiveMessage({...answer('stop-held'),type:'live_ready'});assert.equal(await micStart(),true);
 let stopHeldPeer=livePeer;
 handleLiveMessage({...answer('stop-held'),type:'live_hold',rotation_token:'stop-held-token'});
 assert.equal(livePeer,stopHeldPeer);assert.notEqual(stopHeldPeer.pc.connectionState,'closed');
 handleLiveMessage({...answer('stop-held'),type:'live_stop'});
 assert.equal(stopHeldPeer.pc.connectionState,'closed');assert.equal(livePeer,null);
 assert.equal(pendingLiveRotation,null);assert.equal(sent.at(-1).type,'live_stopped');
 for (const name of ['pagehide','beforeunload']) {
   halted=false;await openLivePeer(request(name));await answerLivePeer(answer(name));
   handleLiveMessage({...answer(name),type:'live_ready'});
   assert.equal(await micStart(),true);
   let owned=livePeer, microphone=owned.input.getAudioTracks()[0];
   owned.pc.ontrack({streams:[stream()]});let audio=owned.audio;
   assert.equal(microphone.readyState,'live');assert.notEqual(owned.pc.connectionState,'closed');
   exitCallbacks[name](); // Execute the actual shipped page-exit listener.
   assert.equal(livePeer,null);assert.equal(micOn,false);
   assert.equal(microphone.readyState,'ended');assert.equal(owned.pc.connectionState,'closed');
   assert.equal(audio.paused,true);assert.equal(audio.srcObject,null);
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
"""
    result = subprocess.run(
        [node, "-e", harness + helpers + mic + exit_handlers + cases],
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
