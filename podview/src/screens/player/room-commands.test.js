// The room player's buttons (room-commands.ts), ported from tests/podview/room-player.test.mjs (node:test) with the
// room-player-controls.js it tested. Same assertions; added: the 800 ms busy ring, the 6 s window for an effect
// toast, the wish that yields after 6 s, and what the store publishes for the player.
import assert from 'node:assert/strict';
import {afterEach, test, vi} from 'vitest';
import {playbackBinding, roomObservationDisplay, roomPlayerObservation} from '../../lib/api/media';
import {OTHER_ACCOUNT, livePlayerModel} from './player-model';
import {RUNNING_RING_MS, createRoomCommands} from './room-commands';
import {resetPlayer, usePlayer} from './store';

afterEach(() => {
  vi.useRealTimers();
  resetPlayer();
});
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
 return {host,controls:createRoomCommands(host),calls,releases,feedback};
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
 // No text stays in the player; the next room read decides (Green 13/11).
 assert.equal(controls.status,'');
 assert.equal(feedback.filter(Boolean).length,0,'nothing before the room is read');
 controls.observe({state:'playing',item:{uri:'spotify:track:'+'0'.repeat(22)}});
 assert.equal(feedback.filter(Boolean).at(-1),'Højttaleren afviste handlingen. Prøv igen.','one short toast');
 assert.equal(controls.status,'');
});

test('a refused pause that the room shows anyway shows nothing',async()=>{
 const {controls,releases,feedback}=rig(()=>({outcome:'rejected'}));
 const sent=controls.intent('pause');
 releases.shift()();
 assert.equal(await sent,false);
 await flush();
 controls.observe({state:'paused',item:{uri:'spotify:track:'+'0'.repeat(22)}});
 assert.deepEqual(feedback.filter(Boolean),[]);
 assert.equal(controls.status,'');
});

test('no grant means no actions: a tap sends nothing',async()=>{
 const {host,controls,calls}=rig();
 host.liveMedia.playback=roomPlayerObservation(body({actions:[],maxVolume:null}),'account',snapshot);
 assert.equal(await controls.intent('pause'),false);
 assert.deepEqual(calls,[]);
});

test('f) the away player shows the real Spotify cover PodConnect reports, never a guessed one',()=>{
 const cover={kind:'album_cover',provider:'spotify',url:'https://i.scdn.co/image/ab67616d0000b273'+'a'.repeat(24)};
 const elsewhere={state:'playing',targetId:'mac',targetName:'MacBook Pro',title:'Let It Be',artist:'The Beatles',
  uri:'spotify:track:'+'b'.repeat(22),positionMs:1000,positionAt:Date.now()-500,durationMs:243000,artwork:cover};
 const p=roomPlayerObservation(body({state:'idle',actions:['pause'],maxVolume:null,elsewhere}),'account',snapshot);
 assert.deepEqual(livePlayerModel(p,true,'ready',snapshot,'Køkkenalrum').artwork,cover);
 const forged=roomPlayerObservation(body({state:'idle',actions:['pause'],maxVolume:null,
  elsewhere:{...elsewhere,artwork:{...cover,url:'https://evil.example/x.jpg'}}}),'account',snapshot);
 assert.equal(livePlayerModel(forged,true,'ready',snapshot,'Køkkenalrum').artwork,undefined);
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
 host.liveMedia.playback=roomPlayerObservation(body({state:'idle',actions:['pause','next','move_here'],maxVolume:null,
  elsewhere}),'account',snapshot);
 const moved=controls.intent('move_here');
 assert.equal(controls.moving(),true,'"Flyt til" shows at once');
 await flush();releases.shift()();
 assert.equal(await moved,true);
 assert.deepEqual(calls.at(-1),['move_here',undefined]);
});

test('anden konto: their track is shown read-only, without a name and without controls',()=>{
 const p=roomPlayerObservation(body({account:'other',actions:[],maxVolume:null}),'account',snapshot);
 assert.equal(p.otherAccount,true);
 const discovering={...snapshot,capabilities:{musicRead:['targets','playback','mood']}};
 const model=livePlayerModel(p,true,'ready',discovering,'Køkkenalrum');
 assert.deepEqual([model.readOnly,model.placement,model.title,model.canOutput],
  [true,'other-account','Hey Jude',false]);
 assert.equal(model.canDiscover,true,'»Vælg musik« (own music) stays possible');
 assert.deepEqual(p.controls,{actions:[],maxVolume:null});
 assert.equal(OTHER_ACCOUNT,'En anden Spotify-konto spiller her');
});

test('anden konto: "unknown", "own" and no attribute behave exactly like today',()=>{
 for(const account of ['unknown','own',undefined]){
  const p=roomPlayerObservation(body({account}),'account',snapshot);
  assert.equal(p.otherAccount,false);
  const model=livePlayerModel(p,true,'ready',snapshot,'Køkkenalrum');
  assert.deepEqual([model.readOnly,model.placement,model.canOutput],[false,'room',true]);
 }
});

test('a quick call changes its button once; only a slow one (800 ms) shows the busy ring', async () => {
  vi.useFakeTimers();
  const {controls, releases} = rig();
  const first = controls.intent('next');
  assert.equal(usePlayer.getState().busy.ring, null, 'no ring at once');
  assert.equal(usePlayer.getState().busy.transport, true, 'the transport group is busy while it runs');
  await vi.advanceTimersByTimeAsync(RUNNING_RING_MS - 1);
  assert.equal(usePlayer.getState().busy.ring, null);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(usePlayer.getState().busy.ring, 'next', 'a slow call shows its ring');
  releases.shift()();
  assert.equal(await first, true);
  assert.deepEqual(usePlayer.getState().busy, {ring: null, transport: false, volume: false});
  // A quick call never rings.
  const quick = controls.intent('previous');
  await vi.advanceTimersByTimeAsync(100);
  releases.shift()();
  await quick;
  await vi.advanceTimersByTimeAsync(RUNNING_RING_MS);
  assert.equal(usePlayer.getState().busy.ring, null);
});

test('the controls stay usable during a call: transport and volume are published enabled', async () => {
  const {controls, releases} = rig();
  void controls.intent('volume', {percent: 20});
  const published = usePlayer.getState().controls;
  assert.equal(published.blocked, false);
  assert.equal(published.toggle, true);
  assert.equal(published.canVolume, true);
  assert.equal(published.volume, 20, 'the wished volume shows at once');
  assert.equal(published.max, 40, 'the room maximum bounds the slider');
  assert.equal(usePlayer.getState().busy.volume, true);
  releases.shift()();
  await flush();
});

test('a failed effect toast only within 6 s of the failure; later reads say nothing', async () => {
  vi.useFakeTimers();
  const {controls, releases, feedback} = rig(() => ({outcome: 'unknown'}));
  const sent = controls.intent('pause');
  releases.shift()();
  assert.equal(await sent, false);
  await vi.advanceTimersByTimeAsync(6001);
  controls.observe({state: 'playing', item: {uri: 'spotify:track:' + '0'.repeat(22)}});
  assert.deepEqual(feedback.filter(Boolean), [], 'too late: the room read decides silently');
  const again = controls.intent('pause');
  releases.shift()();
  await again;
  controls.observe({state: 'playing', item: {uri: 'spotify:track:' + '0'.repeat(22)}});
  assert.equal(feedback.filter(Boolean).at(-1), 'Højttaleren svarede ikke. Tjek afspilleren, før du prøver igen.');
});

test('a wish yields to the room after 6 s even when no read arrives; a reached wish yields at once', async () => {
  vi.useFakeTimers();
  const {controls, releases} = rig();
  const sent = controls.intent('pause');
  releases.shift()();
  await sent;
  assert.equal(controls.optimisticPlaying(true), false);
  await vi.advanceTimersByTimeAsync(6000);
  assert.equal(controls.optimisticPlaying(true), true, 'the observed state again');
  const volume = controls.intent('volume', {percent: 10});
  releases.shift()();
  await volume;
  controls.observe({...roomPlayerObservation(body({volumePercent: 10}), 'account', snapshot)});
  assert.equal(controls.wish(), null, 'the room shows it: the wish is gone');
});

test('a tap waiting behind a refused call is dropped, never sent', async () => {
  let n = 0;
  const {controls, calls, releases} = rig(() => (n++ === 0 ? {outcome: 'rejected'} : {outcome: 'accepted'}));
  const first = controls.intent('next');
  const second = controls.intent('next');
  releases.shift()();
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.deepEqual(calls, [['next', undefined]]);
});
