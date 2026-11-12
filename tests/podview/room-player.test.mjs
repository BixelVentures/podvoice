import test from 'node:test';
import assert from 'node:assert/strict';
import {roomPlayerObservation,roomObservationDisplay,playbackBinding}
 from '../../podvoice/gatekeeper/static/podview/media-observation.js';
import {RoomPlayerControls} from '../../podvoice/gatekeeper/static/podview/room-player-controls.js';
import {livePlayerModel} from '../../podvoice/gatekeeper/static/podview/player-view.js';

globalThis.document??={getElementById:()=>null};
const snapshot={bootId:'boot',roomId:'kitchen',capabilities:{musicRead:['targets','playback']}};
// Music started outside PodView (HA play_media or the Spotify app): no PodConnect session proof.
const body=(changes={})=>({ok:true,schema:'podview.room-player.v1',bootId:'boot',roomId:'kitchen',
 configEntryId:'account',state:'playing',source:'spotify',title:'Hey Jude',artist:'The Beatles',album:'1',
 uri:'spotify:track:'+'a'.repeat(22),artworkUrl:'music/player/artwork?room=kitchen&account=account&v=1',
 positionMs:12500,positionAt:Date.now()-1000,durationMs:431000,volumePercent:27,
 actions:['pause','resume','next','previous','seek','volume'],maxVolume:40,session:null,...changes});

test('a room player read without PodConnect output proof is shown with its controls',()=>{
 const p=roomPlayerObservation(body(),'account',snapshot);
 assert.equal(roomObservationDisplay(p,snapshot),true);
 assert.equal(playbackBinding(p,snapshot),null,'no session: the queue waits, the player does not');
 const model=livePlayerModel(p,true,'ready',snapshot,'Køkkenalrum');
 assert.equal(model.readOnly,false);
 assert.equal(model.title,'Hey Jude');
 assert.equal(model.target,'Køkkenalrum');
 assert.equal(model.playing,true);
 assert.deepEqual(p.controls,{actions:['pause','resume','next','previous','seek','volume'],maxVolume:40});
});

test('idle, unavailable and foreign scopes are not shown; malformed shapes are refused',()=>{
 for(const state of ['idle','unavailable'])
  assert.equal(roomObservationDisplay(roomPlayerObservation(body({state}),'account',snapshot),snapshot),false);
 assert.equal(roomPlayerObservation(body({state:'buffering'}),'account',snapshot).state,'buffering');
 assert.throws(()=>roomPlayerObservation(body({roomId:'other'}),'account',snapshot));
 assert.throws(()=>roomPlayerObservation(body({actions:['explode']}),'account',snapshot));
 assert.throws(()=>roomPlayerObservation(body({state:'off'}),'account',snapshot));
});

function rig(answer=()=>({outcome:'accepted'})){
 const calls=[],releases=[],feedback=[];
 const host={liveSnapshot:snapshot,ownerDocument:{getElementById:()=>null},querySelector:()=>null,
  showFeedback:message=>feedback.push(message),
  liveTransport:{connected:true,generation:1,recordDiagnostic(){},
   playerAction:(account,action,value)=>{
    calls.push([action,value]);
    return new Promise(resolve=>releases.push(()=>resolve(answer(action))));
   }},
  liveMedia:{account:'account',render(){},refresh:async()=>{}}};
 host.liveMedia.playback=roomPlayerObservation(body(),'account',snapshot);
 return {host,controls:new RoomPlayerControls(host),calls,releases,feedback};
}
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

test('a tap flips at once, a second tap waits its turn and is sent once',async()=>{
 const {controls,calls,releases}=rig();
 const first=controls.intent('pause');
 assert.equal(controls.optimisticPlaying(true),false,'pause shows immediately');
 const second=controls.intent('next');
 assert.deepEqual(calls,[['pause',undefined]],'the next tap queues behind the running call');
 releases.shift()();await flush();
 assert.deepEqual(calls,[['pause',undefined],['next',undefined]]);
 releases.shift()();
 assert.deepEqual(await Promise.all([first,second]),[true,true]);
});

test('volume is clamped to the room maximum and the latest waiting value wins',async()=>{
 const {controls,calls,releases}=rig();
 void controls.intent('pause');
 void controls.intent('volume',{percent:90});
 void controls.intent('volume',{percent:30});
 assert.equal(controls.volume(),30);
 releases.shift()();await flush();
 assert.deepEqual(calls.slice(1),[['volume',30]]);
 releases.shift()();await flush();
 void controls.intent('volume',{percent:95});
 assert.deepEqual(calls.at(-1),['volume',40]);
});

test('a rejected call is shown honestly and never retried',async()=>{
 const {controls,calls,releases,feedback}=rig(()=>({outcome:'rejected'}));
 const sent=controls.intent('next');
 releases.shift()();
 assert.equal(await sent,false);
 await flush();
 assert.deepEqual(calls,[['next',undefined]]);
 assert.equal(feedback.at(-1),'Højttaleren afviste handlingen. Prøv igen.');
 assert.equal(controls.status,'Højttaleren afviste handlingen. Prøv igen.');
});

test('no grant means no actions: a tap sends nothing',async()=>{
 const {host,controls,calls}=rig();
 host.liveMedia.playback=roomPlayerObservation(body({actions:[],maxVolume:null}),'account',snapshot);
 assert.equal(await controls.intent('pause'),false);
 assert.deepEqual(calls,[]);
});

test('f) the own account on another device keeps its controls and offers "Flyt til" the room',async()=>{
 const elsewhere={state:'playing',targetId:'iphone-id',targetName:'iPhone',title:'Let It Be',artist:'The Beatles',
  uri:null,positionMs:1000,positionAt:Date.now()-500,durationMs:243000};
 const {host,controls,calls,releases}=rig();
 host.liveMedia.playback=roomPlayerObservation(body({state:'idle',actions:['pause','next','previous'],maxVolume:null,
  elsewhere}),'account',snapshot);
 const p=host.liveMedia.playback;
 assert.equal(roomObservationDisplay(p,snapshot),true);
 const model=livePlayerModel(p,true,'ready',snapshot,'Køkkenalrum');
 assert.deepEqual([model.placement,model.target,model.title,model.playing],['elsewhere','iPhone','Let It Be',true]);
 assert.deepEqual(p.controls.actions,['pause','next','previous'],'only what the device offers');
 const paused=controls.intent('pause');
 assert.equal(controls.optimisticPlaying(true),false);
 releases.shift()();
 assert.equal(await paused,true);
 const next=controls.intent('next');await flush();releases.shift()();
 assert.equal(await next,true);
 assert.deepEqual(calls,[['pause',undefined],['next',undefined]]);
 assert.equal(await controls.intent('volume',{percent:20}),false,'volume only if the device offers it');
});
