import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 MUSIC_SESSION_PHASES,newMusicSession,musicSession,controlsBlocked,musicSessionFromFeedback,playbackFreshness,
} from '../../podvoice/gatekeeper/static/podview/music-session-model.js';
import {
 QUEUE_PRESENTATION_PHASES,QUEUE_TROUBLE_MS,newQueuePresentation,queuePresentation,queueWaiting,
} from '../../podvoice/gatekeeper/static/podview/queue-presentation-model.js';
import {RoomPlayerControls} from '../../podvoice/gatekeeper/static/podview/room-player-controls.js';
import {LiveMediaView} from '../../podvoice/gatekeeper/static/podview/live-media-view.js';
import {LiveMusicSelectionView} from '../../podvoice/gatekeeper/static/podview/live-music-selection-view.js';
import {roomPlayerWire} from '../../scripts/room-player-wire.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));

// ---- A. music session reducer ----
const session=(...types)=>types.reduce((s,type)=>musicSession(s,{type,run:s.run}),
 musicSession(newMusicSession(),{type:'request'}));

test('music session: phases follow request, acceptance, confirmation and observation',()=>{
 assert.deepEqual(MUSIC_SESSION_PHASES,
  ['idle','requesting','accepted','confirmed','playing','rejected','unknown','expired']);
 assert.equal(newMusicSession().phase,'idle');
 assert.equal(session().phase,'requesting');
 assert.equal(session('accepted').phase,'accepted');
 assert.equal(session('accepted','confirmed').phase,'confirmed');
 assert.equal(session('accepted','confirmed','observed').phase,'playing');
 assert.equal(session('accepted','observed').phase,'playing');
 assert.equal(session('rejected').phase,'rejected');
 assert.equal(session('accepted','unknown').phase,'unknown');
 assert.equal(session('accepted','expired').phase,'expired');
});

test('music session: illegal and stale-run events return the same state',()=>{
 const requesting=session();
 for(const type of ['confirmed','observed','nonsense'])
  assert.equal(musicSession(requesting,{type,run:requesting.run}),requesting);
 const confirmed=session('accepted','confirmed');
 for(const type of ['accepted','expired','rejected','unknown'])
  assert.equal(musicSession(confirmed,{type,run:confirmed.run}),confirmed);
 const rejected=session('rejected');
 assert.equal(musicSession(rejected,{type:'accepted',run:rejected.run}),rejected);
 // A late answer from an earlier request cannot move the new one.
 const next=musicSession(requesting,{type:'request'});
 assert.equal(musicSession(next,{type:'accepted',run:requesting.run}),next);
 const reset=musicSession(next,{type:'reset'});
 assert.equal(reset.phase,'idle');assert.equal(musicSession(reset,{type:'accepted',run:next.run}),reset);
});

test('music session: only requesting and accepted block the controls',()=>{
 const blocked=Object.fromEntries(MUSIC_SESSION_PHASES.map(phase=>[phase,controlsBlocked({phase,run:1})]));
 assert.deepEqual(blocked,{idle:false,requesting:true,accepted:true,confirmed:false,playing:false,rejected:false,
  unknown:false,expired:false});
});

test('music session from feedback: a confirmed settlement unblocks even when the item cannot be proven',()=>{
 const base={outcome:'accepted',awaitingObservation:true,requestedAt:Date.now()};
 assert.equal(musicSessionFromFeedback(null).phase,'idle');
 assert.equal(musicSessionFromFeedback({pending:true}).phase,'requesting');
 assert.equal(musicSessionFromFeedback(base).phase,'accepted');
 // Destination not provable, target id changed, failed playlist progress or clock skew: no observation,
 // but the settlement is confirmed. Before the fix the buttons stayed locked for 30 s.
 assert.equal(musicSessionFromFeedback({...base,settlementStatus:'confirmed'}).phase,'confirmed');
 assert.equal(controlsBlocked(musicSessionFromFeedback({...base,settlementStatus:'confirmed'})),false);
 assert.equal(musicSessionFromFeedback({...base,settlementStatus:'confirmed',displayExpired:true}).phase,'confirmed');
 assert.equal(musicSessionFromFeedback({...base,displayObserved:true}).phase,'playing');
 assert.equal(musicSessionFromFeedback(base,{observed:true}).phase,'playing');
 assert.equal(musicSessionFromFeedback({...base,displayExpired:true}).phase,'expired');
 assert.equal(musicSessionFromFeedback({...base,settlementStatus:'rejected'}).phase,'rejected');
 assert.equal(musicSessionFromFeedback({...base,settlementStatus:'superseded'}).phase,'rejected');
 assert.equal(musicSessionFromFeedback({...base,settlementStatus:'unknown'}).phase,'unknown');
 assert.equal(musicSessionFromFeedback({outcome:'rejected'}).phase,'rejected');
 assert.equal(musicSessionFromFeedback({outcome:'unknown'}).phase,'unknown');
});

test('playback freshness normalises stale to fresh, transient or stale',()=>{
 assert.equal(playbackFreshness({}),'fresh');
 assert.equal(playbackFreshness({stale:false}),'fresh');
 assert.equal(playbackFreshness({stale:null}),'fresh');
 assert.equal(playbackFreshness({stale:'transient'}),'transient');
 assert.equal(playbackFreshness({stale:true}),'stale');
 assert.equal(playbackFreshness({stale:'other'}),'stale');
});

test('regression: player controls refuse a transiently stale room read',()=>{
 const controls=new RoomPlayerControls({liveTransport:{connected:true}});
 const p=stale=>({stale,controls:{actions:['pause','resume','next']}});
 assert.equal(controls.can('pause',p(undefined)),true);
 assert.equal(controls.can('pause',p('transient')),false);
 assert.equal(controls.can('next',p(true)),false);
});

test('regression: the optimistic wish is cleared by a timer when OPTIMISTIC_MS runs out',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let renders=0;
 const controls=new RoomPlayerControls({liveMedia:{render(){renders++;}}});
 controls.render=()=>{};
 const wish={scope:'s',at:Date.now(),playing:false};
 controls.desired=wish;controls.expireWish(wish);
 t.mock.timers.tick(5999);assert.equal(controls.desired,wish);
 t.mock.timers.tick(1);assert.equal(controls.desired,null);assert.equal(renders,1);
 // A newer wish is never cleared by the older timer.
 const newer={scope:'s',at:Date.now(),volume:20};
 controls.desired=wish;controls.expireWish(wish);controls.desired=newer;
 t.mock.timers.tick(6000);assert.equal(controls.desired,newer);
 controls.invalidate();
});

function controlRig(hold){
 const previous=globalThis.document,buttons=new Map();
 const button=id=>{
  if(!buttons.has(id))buttons.set(id,{id,hidden:false,disabled:false,dataset:{},attrs:{},
   getAttribute(name){return this.attrs[name]??null;},setAttribute(name,value){this.attrs[name]=value;}});
  return buttons.get(id);
 };
 const doc={getElementById:id=>/volume/.test(id)?null:button(id),querySelector:()=>null};
 globalThis.document=doc;
 const playback={state:'paused',
  controls:{actions:['pause','resume','next','previous','volume'],maxVolume:100},volume:30};
 const host={ownerDocument:doc,querySelector:()=>null,liveTransport:{connected:true},
  liveSelection:{controlHold:()=>hold}};
 const controls=new RoomPlayerControls(host);controls.playback=()=>playback;
 return {controls,buttons,close(){globalThis.document=previous;}};
}

test('regression: RoomPlayerControls is the single owner and a confirmed hold leaves play/pause usable',()=>{
 const confirmed=controlRig({blocked:false,playing:true,phase:'confirmed'});
 try{
  confirmed.controls.render();
  assert.equal(confirmed.buttons.get('play-pause').disabled,false);
  assert.equal(confirmed.buttons.get('play-pause').attrs['aria-label'],'Sæt musik på pause');
 }finally{confirmed.close();}
 const accepted=controlRig({blocked:true,playing:false,phase:'accepted'});
 try{
  const result=accepted.controls.render();
  assert.equal(accepted.buttons.get('play-pause').disabled,true);
  assert.equal(accepted.buttons.get('next').disabled,true);
  assert.equal(result.transport,false);assert.equal(result.canVolume,false);
 }finally{accepted.close();}
 const none=controlRig(null);
 try{none.controls.render();assert.equal(none.buttons.get('play-pause').disabled,false);}finally{none.close();}
});

test('regression: selection hold follows the session, not the 30 s display wait',()=>{
 const view=Object.create(LiveMusicSelectionView.prototype);
 let feedback={outcome:'accepted',awaitingObservation:true,requestedAt:Date.now()};
 view.host={liveMedia:{playback:null}};
 view.playerFeedback=()=>feedback;view.pendingPlayer=()=>({title:'Song'});view.selectionItemObserved=()=>false;
 assert.deepEqual(view.controlHold(),{blocked:true,playing:false,phase:'accepted'});
 feedback={...feedback,settlementStatus:'confirmed'};
 assert.deepEqual(view.controlHold(),{blocked:false,playing:true,phase:'confirmed'});
 view.pendingPlayer=()=>null;
 assert.equal(view.controlHold(),null);
});

test('regression: live media render no longer overwrites the controls after liveControls.render',()=>{
 const source=fs.readFileSync(new URL('../../podvoice/gatekeeper/static/podview/live-media-view.js',
  import.meta.url),'utf8');
 assert.doesNotMatch(source,/liveControls\?\.render\(\);if\(selected\)this\.host\.playerView\.renderControls/);
});

// ---- C. queue presentation reducer ----
const q=(s,type,at=0)=>queuePresentation(s,{type,run:s.run,at});

test('queue presentation: phases and run token',()=>{
 assert.deepEqual(QUEUE_PRESENTATION_PHASES,
  ['idle','loading','ready','empty','preview-pending','retry-wait','unavailable','choosing']);
 const s=newQueuePresentation('k');
 assert.equal(s.phase,'idle');
 assert.equal(q(s,'read',5).phase,'loading');assert.equal(q(s,'read',5).troubleSince,5);
 assert.equal(q(q(s,'read'),'rows').phase,'ready');
 assert.equal(q(q(s,'read'),'empty').phase,'empty');
 assert.equal(q(s,'preview').phase,'preview-pending');
 assert.equal(q(s,'not-allowed').phase,'retry-wait');
 assert.equal(q(q(s,'read'),'choice').phase,'choosing');
 // Illegal or stale-run events return the same object.
 assert.equal(queuePresentation(s,{type:'rows',run:s.run+1}),s);
 assert.equal(q(s,'unknown-event'),s);
 const choosing=q(s,'choice');
 assert.equal(q(choosing,'read'),choosing);assert.equal(q(choosing,'not-allowed'),choosing);
 assert.equal(q(choosing,'trouble',QUEUE_TROUBLE_MS*2),choosing);
});

test('queue presentation: a problem is named only after QUEUE_TROUBLE_MS, then stays until an answer',()=>{
 let s=q(newQueuePresentation(),'read',1000);
 assert.equal(queueWaiting(s),true);
 assert.equal(q(s,'trouble',1000+QUEUE_TROUBLE_MS-1),s);
 s=q(s,'trouble',1000+QUEUE_TROUBLE_MS);
 assert.equal(s.phase,'unavailable');assert.equal(queueWaiting(s),false);
 assert.equal(q(s,'pending',99999),s);
 assert.equal(q(s,'rows').phase,'ready');
 const ready=q(s,'rows');assert.equal(ready.troubleSince,null);
 assert.equal(q(ready,'pending',7).phase,'loading');assert.equal(q(ready,'pending',7).troubleSince,7);
});

test('regression: a new song (reset) clears the trouble time',()=>{
 const waiting=q(newQueuePresentation('song-1'),'read',0);
 const reset=queuePresentation(waiting,{type:'reset',key:'song-2'});
 assert.equal(reset.troubleSince,null);assert.equal(reset.phase,'idle');assert.equal(reset.key,'song-2');
 assert.equal(queuePresentation(reset,{type:'trouble',run:waiting.run,at:QUEUE_TROUBLE_MS}),reset);
});

test('regression: queue choice pending/accepted is choosing, never loading then unavailable',()=>{
 let s=q(newQueuePresentation(),'read',0);
 s=q(s,'choice',1);
 assert.equal(s.phase,'choosing');assert.equal(queueWaiting(s),false);
 assert.equal(q(s,'trouble',QUEUE_TROUBLE_MS*5).phase,'choosing');
});

// ---- Integration with LiveMediaView (same rig as root-live-media-queue-lifecycle) ----
function rig(){
 const previous=globalThis.document;
 const node=()=>({hidden:false,setAttribute(){},addEventListener(){},prepend(){},replaceChildren(){}});
 globalThis.document={createElement:node,getElementById:node};
 let serial=0,uri='spotify:track:0123456789ABCDEFGHIJKL';const reads=[],queues=[];
 const host={isConnected:true,state:{focus:'player'},
  liveSnapshot:{bootId:'boot',roomId:'display',capabilities:{musicRead:['playback','queue'],queueSelection:true},
   mediaRoomBindings:[]},
  liveTransport:{connected:true},
  playerView:{renderPlayer(){},renderControls(){},renderQueue(items,options){queues.push({items,...options});}},
  liveSelection:{pendingPlayer:()=>null}};
 Object.defineProperty(host.liveTransport,'music',{set(read){this.read=read;},
  get(){return async(...args)=>roomPlayerWire(await this.read(...args));}});
 const wire=()=>({ok:true,schema:'podview.room-playback.v2',bootId:'boot',roomId:'display',configEntryId:'account',
  status:'observed',reason:null,binding:{roomId:'display',accountId:'account',targetId:'actual',
   nativeRoomId:'actual-room',nativeHomepodId:'2',bindingId:'a'.repeat(64),validUntil:Date.now()/1000+10},
  data:{ok:true,schema:'podconnect.playback.v1',config_entry_id:'account',owner_epoch:'epoch',poll_sequence:2,
   physical_result_verified:false,observation:{status:'fresh',source:'spotify_web_api',
    observed_at:new Date().toISOString(),age_ms:0,max_age_ms:15000},
   playback:{state:'playing',target:{kind:'spotify_device',target_id:'actual',name:'Bridge'},
    item:{type:'track',uri,name:'Song',artists:['Artist'],duration_ms:60000},progress_ms:1000,
    provider_changed_at_ms:null,shuffle:false,repeat:'off'}}});
 host.liveTransport.music=async()=>wire();
 host.liveTransport.queueOffer=async(account,target,expected)=>{reads.push({account,target,expected});
  return {ok:true,schema:'podview.queue-offer.v1',bootId:'boot',roomId:'display',accountId:account,targetId:target,
   expectedBindingId:expected,taskId:'queue:'+(++serial).toString(16).padStart(32,'0'),revision:1,expiresInMs:8000,
   ownerEpoch:'epoch',pollSequence:2,truncated:false,items:[]};};
 const media=new LiveMediaView(host);host.liveMedia=media;media.account='account';
 return {host,media,reads,queues,song:next=>uri=next,
  async refresh(){await media.refresh({immediate:true});await tick();},
  close(){media.queueControls.invalidate(true);clearTimeout(media.queueTroubleTimer);clearTimeout(media.freshnessTimer);
   globalThis.document=previous;}};
}

test('regression: a not-allowed queue read waits and is read again once it becomes allowed',async()=>{
 const f=rig();
 try{
  f.host.state.focus='now';f.host.liveSnapshot.capabilities.queueSelection=false;
  await f.refresh();
  f.host.state.focus='player';
  // Opening the player while the queue is not allowed yet: no read, no "already read" key.
  const loaded=await f.media.loadQueue();
  assert.equal(loaded,false);assert.equal(f.reads.length,0);
  assert.equal(f.media.queueReadKey,null);
  assert.equal(f.media.queuePresentation.phase,'retry-wait');
  f.host.liveSnapshot.capabilities.queueSelection=true;
  await f.refresh();
  assert.equal(f.reads.length,1,'the queue is read once it is allowed');
 }finally{f.close();}
});

test('regression: clearRoom and a new song reset the queue trouble time and timer',async()=>{
 const f=rig();
 try{
  let release;f.host.liveTransport.queueOffer=()=>new Promise(resolve=>release=resolve);
  await f.refresh();
  assert.equal(f.queues.at(-1).status,'loading');
  assert.ok(Number.isFinite(f.media.queueTroubleSince));
  assert.ok(f.media.queueTroubleTimer);
  // An old song that has waited 11 s would be named unavailable ...
  f.media.queuePresentation={...f.media.queuePresentation,troubleSince:Date.now()-QUEUE_TROUBLE_MS-1000};
  f.media.renderQueue();
  assert.equal(f.queues.at(-1).status,'unavailable');
  // ... but a new song starts its own wait.
  f.song('spotify:track:ZYXWVUTSRQPONMLKJIHGFE');
  await f.refresh();
  assert.equal(f.queues.at(-1).status,'loading');
  assert.ok(Date.now()-f.media.queueTroubleSince<1000);
  f.media.clearRoom();
  assert.equal(f.media.queueTroubleSince,null);assert.equal(f.media.queueTroubleTimer,null);
  assert.equal(f.media.queuePresentation.troubleSince,null);
  release?.({ok:false});
 }finally{f.close();}
});

test('regression: a pending queue choice is rendered as the choice, not as loading',async()=>{
 const f=rig();
 try{
  await f.refresh();
  assert.equal(f.queues.at(-1).status,'ready');
  f.media.queueControls.model=()=>({status:'pending',items:[],errorKind:null});
  f.media.renderQueue();
  assert.equal(f.queues.at(-1).status,'pending');
  assert.equal(f.media.queuePresentation.phase,'choosing');
  f.media.queueControls.model=()=>({status:'accepted',items:[],errorKind:null});
  f.media.queuePresentation={...f.media.queuePresentation,troubleSince:Date.now()-QUEUE_TROUBLE_MS*2};
  f.media.renderQueue();
  assert.equal(f.queues.at(-1).status,'accepted');
 }finally{f.close();}
});

test('regression: player-view cleanup cancels the queue placeholders it owns',()=>{
 const source=fs.readFileSync(new URL('../../podvoice/gatekeeper/static/podview/player-view.js',
  import.meta.url),'utf8');
 assert.doesNotMatch(source,/queuePlaceholders/);
 assert.match(source,/\.\.\.\(this\.placeholders\|\|\[\]\)\]\.map\(row=>row\.children\[1\]\)/);
});
