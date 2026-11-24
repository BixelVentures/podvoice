// The live room player's reader (room-player.ts) and the queue's presentation (queue-presentation.ts), ported from
// tests/podview/root-live-media-queue-lifecycle, music-session-queue-state, queue-elsewhere-bounded,
// root-loading-account-terminal, root-account-picker and touch-redraw (LiveMediaView became RoomPlayer). What the
// reader shows is what it publishes into the player store; the rigs read it back as the old renderQueue calls.
import assert from 'node:assert/strict';
import {afterEach, test as vitest, vi} from 'vitest';
import {LiveMusicCatalogueView} from '../../../live-music-view.js';
import {LiveQueueView, upcomingQueueRows} from '../../../live-queue-view.js';
import {roomPlayerWire} from '../../../../scripts/room-player-wire.mjs';
import {roomPlayerObservation} from '../../lib/api/media';
import {transportFaces} from './presentation';
import {QUEUE_PRESENTATION_PHASES, QUEUE_TROUBLE_MS, newQueuePresentation, queuePresentation, queueWaiting}
  from './queue-presentation';
import {createRoomCommands} from './room-commands';
import {RoomPlayer} from './room-player';
import {resetPlayer, usePlayer} from './store';

// node:test's (name, fn) and (name, options, fn) shapes.
const test = (name, a, b) => vitest(name, typeof a === 'function' ? a : b);
const tick = () => new Promise(resolve => setImmediate(resolve));
afterEach(() => {
  vi.useRealTimers();
  resetPlayer();
});

// The reader publishes the queue into the player store; each of its queue renders is forwarded to the rig's
// renderQueue (as the pre-React player received it).
function forwardQueue(host, media = host.liveMedia ?? host) {
  const render = media.renderQueue;
  media.renderQueue = function () {
    render.call(this);
    const {queue} = usePlayer.getState();
    host.playerView?.renderQueue?.(queue.items, queue.options);
  };
  return () => {
    media.renderQueue = render;
  };
}
const readerOn = host => new RoomPlayer(host, new LiveQueueView(host), upcomingQueueRows);

function rig(){
 const previous=globalThis.document,node=()=>({hidden:false,setAttribute(){},addEventListener(){},prepend(){},replaceChildren(){}});globalThis.document={createElement:node,getElementById:node};
 let serial=0,binding='a'.repeat(64);const reads=[];
 const host={isConnected:true,state:{focus:'player'},liveSnapshot:{bootId:'boot',roomId:'display',capabilities:{musicRead:['playback','queue'],queueSelection:true},mediaRoomBindings:[]},liveTransport:{connected:true},playerView:{renderPlayer(){},renderControls(){},renderQueue(){}},liveSelection:{pendingPlayer:()=>null}};
 // Authored playback answers in the room player's wire shape (podview.room-player.v1).
 Object.defineProperty(host.liveTransport,'music',{set(read){this.read=read;},get(){return async(...args)=>roomPlayerWire(await this.read(...args));}});
 const wire=()=>({ok:true,schema:'podview.room-playback.v2',bootId:'boot',roomId:'display',configEntryId:'account',status:'observed',reason:null,binding:{roomId:'display',accountId:'account',targetId:'actual',nativeRoomId:'actual-room',nativeHomepodId:'2',bindingId:binding,validUntil:Date.now()/1000+10},data:{ok:true,schema:'podconnect.playback.v1',config_entry_id:'account',owner_epoch:'epoch',poll_sequence:2,physical_result_verified:false,observation:{status:'fresh',source:'spotify_web_api',observed_at:new Date().toISOString(),age_ms:0,max_age_ms:15000},playback:{state:'playing',target:{kind:'spotify_device',target_id:'actual',name:'Bridge'},item:{type:'track',uri:'spotify:track:0123456789ABCDEFGHIJKL',name:'Song',artists:['Artist'],duration_ms:60000},progress_ms:1000,provider_changed_at_ms:null,shuffle:false,repeat:'off'}}});
 host.liveTransport.music=async()=>wire();host.liveTransport.queueOffer=async(account,target,expected)=>{reads.push({account,target,expected});return {ok:true,schema:'podview.queue-offer.v1',bootId:'boot',roomId:'display',accountId:account,targetId:target,expectedBindingId:expected,taskId:'queue:'+(++serial).toString(16).padStart(32,'0'),revision:1,expiresInMs:8000,ownerEpoch:'epoch',pollSequence:2,truncated:false,items:[]};};
 const media=readerOn(host);host.liveMedia=media;media.account='account';const stop=forwardQueue(host,media);
 return {host,media,reads,wire,replaceBinding:()=>binding='b'.repeat(64),async refresh(){await media.refresh({immediate:true});await tick();},close(){stop();media.queueControls.invalidate(true);clearTimeout(media.queueTroubleTimer);clearTimeout(media.freshnessTimer);globalThis.document=previous;}};
}
test('already open player reads queue once when fresh actual playback arrives, and once for replacement binding',async()=>{const f=rig();try{await f.media.loadQueue();assert.equal(f.reads.length,0);await f.refresh();assert.equal(f.reads.length,1);assert.equal(f.media.queueControls.status,'ready');await f.refresh();assert.equal(f.reads.length,1);f.replaceBinding();await f.refresh();assert.equal(f.reads.length,2);assert.equal(f.reads[1].expected,'b'.repeat(64));}finally{f.close();}});
test('queue is prefetched outside the player and reused when the player opens',async()=>{const f=rig();try{f.host.state.focus='now';await f.refresh();assert.equal(f.reads.length,1,'prefetch on a new song');f.host.state.focus='player';await f.media.loadQueue();await f.refresh();assert.equal(f.reads.length,1,'fresh prefetched queue is reused');}finally{f.close();}});
for(const state of ['outside','disconnected','selection-pending','selection-unknown','queue-pending','queue-unknown','wrong-owner','stale'])test(`automatic queue read stays closed for ${state}`,async()=>{const f=rig();try{
 f.host.state.focus='now';await f.refresh();f.host.state.focus='player';
 if(state==='outside')f.host.state.focus='music';
 if(state==='disconnected')f.host.liveTransport.connected=false;
 if(state==='selection-pending')f.host.liveSelection.feedback={pending:true};
 if(state==='selection-unknown')f.host.liveSelection.feedback={outcome:'unknown'};
 if(state==='queue-pending')f.media.queueControls.pending=true;
 if(state==='queue-unknown'){f.media.queueControls.status='unknown';f.media.queueControls.consumed=true;}
 if(state==='wrong-owner')f.host.liveSnapshot.bootId='replacement';
 if(state==='stale')f.media.playback.stale=true;
 const before=f.reads.length;await f.media.loadQueue({automatic:true});await tick();assert.equal(f.reads.length,before);
 }finally{f.close();}});
test('pending selection settling permits one read on the next actual observation, not every poll',async()=>{const f=rig();try{f.host.liveSelection.feedback={pending:true};await f.refresh();assert.equal(f.reads.length,0);f.host.liveSelection.feedback=null;await f.refresh();await f.refresh();assert.equal(f.reads.length,1);}finally{f.close();}});
test('failed automatic queue read does not retry on unchanged polls',async()=>{const f=rig();try{let reads=0;f.host.liveTransport.queueOffer=async()=>{reads++;throw Error('unavailable');};await f.refresh();await f.refresh();assert.equal(reads,1);assert.equal(f.media.queueControls.status,'error');}finally{f.close();}});
test('late queue for replaced actual binding cannot overwrite the new queue',async()=>{const f=rig();let release;try{const source=f.host.liveTransport.queueOffer;let first=true;f.host.liveTransport.queueOffer=async(...args)=>{const reply=await source(...args);if(first){first=false;return new Promise(resolve=>release=()=>resolve(reply));}return reply;};await f.refresh();assert.equal(f.media.queueControls.pending,true);f.replaceBinding();await f.refresh();assert.equal(f.reads.length,2);const accepted=f.media.queueControls.offer;assert.equal(accepted.expectedBindingId,'b'.repeat(64));release();await tick();assert.equal(f.media.queueControls.offer,accepted);}finally{release?.();f.close();}});

for(const explicit of [false,true])test(`held control intent does not latch an unstarted ${explicit?'explicit':'automatic'} queue read`,async()=>{const f=rig();try{
 let effects=0;f.host.liveTransport.queueAction=async()=>{effects++;throw Error('unexpected effect');};
 f.host.liveControls={musicIntentPending:true,render(){},invalidateMusic(){}};
 await f.refresh();if(explicit)await f.media.loadQueue();
 assert.equal(f.reads.length,0);assert.ok(f.media.queueReadKey==null,'unstarted read has no attempted key');
 const context=JSON.stringify(f.host.liveSnapshot);f.host.liveControls.musicIntentPending=false;
 await f.refresh();assert.equal(JSON.stringify(f.host.liveSnapshot),context);assert.equal(f.reads.length,1);assert.equal(f.media.queueControls.status,'ready');
 await f.refresh();assert.equal(f.reads.length,1);assert.equal(effects,0);
 }finally{f.close();}});

// A failed passive read may recover once, only after a new validated playback.
for(const recover of [true,false])test(`classified transient queue read retries once after playback; recovered=${recover}`,async()=>{const f=rig();try{
 const read=f.host.liveTransport.queueOffer;let calls=0;f.host.liveTransport.queueOffer=async(...args)=>{calls++;if(calls===1||!recover)throw Object.assign(Error('temporary read'),{code:'read_transient'});return read(...args);};
 await f.refresh();assert.equal(calls,1);assert.equal(f.media.queueControls.status,'error');
 await f.media.loadQueue({automatic:true});assert.equal(calls,1,'render/direct automatic calls cannot spend recovery');
 await f.refresh();assert.equal(calls,2,'one next successful playback permits one extra passive read');
 for(let i=0;i<4;i++)await f.refresh();assert.equal(calls,2,'neither repeated failure nor successful empty result rearms');
 assert.equal(f.media.queueControls.status,recover?'ready':'error');
 }finally{f.close();}});
test('failed playback does not spend queue recovery; pending intention defers it until a later successful playback',async()=>{const f=rig();try{
 let calls=0;f.host.liveTransport.queueOffer=async()=>{calls++;throw Object.assign(Error('temporary'),{code:'read_transient'});};await f.refresh();assert.equal(calls,1);
 f.host.liveTransport.music=async()=>{throw Object.assign(Error('playback unavailable'),{code:'read_transient'});};await f.refresh();assert.equal(calls,1);
 f.host.liveTransport.music=async()=>f.wire();f.host.liveControls={musicIntentPending:true,render(){},invalidateMusic(){}};await f.refresh();assert.equal(calls,1);
 f.host.liveControls.musicIntentPending=false;await f.refresh();assert.equal(calls,2);await f.refresh();assert.equal(calls,2);
 }finally{f.close();}});
for(const fence of ['queue-unknown','selection-unknown','consumed'])test(`transient queue recovery never crosses ${fence}`,async()=>{const f=rig();try{
 let calls=0;f.host.liveTransport.queueOffer=async()=>{calls++;throw Object.assign(Error('temporary'),{code:'read_transient'});};await f.refresh();assert.equal(calls,1);
 if(fence==='selection-unknown')f.host.liveSelection.feedback={outcome:'unknown'};else{f.media.queueControls.consumed=true;if(fence==='queue-unknown')f.media.queueControls.status='unknown';}
 await f.refresh();await f.refresh();assert.equal(calls,1);
 }finally{f.close();}});
test('old retry is not carried through media invalidation or a changed owner',async()=>{const f=rig();try{
 let calls=0;f.host.liveTransport.queueOffer=async()=>{calls++;throw Object.assign(Error('temporary'),{code:'read_transient'});};await f.refresh();assert.equal(calls,1);
 f.media.invalidate();await f.refresh();assert.equal(calls,1,'same old key cannot borrow old generation retry');
 const wire=f.wire;f.host.liveTransport.music=async()=>{const body=wire();body.data.owner_epoch='replacement';return body;};await f.refresh();assert.equal(calls,2,'new owner gets its independent initial read');
 await f.refresh();assert.equal(calls,3,'new owner has its own single recovery');await f.refresh();assert.equal(calls,3);
 }finally{f.close();}});
test('held recovery response cannot overwrite a replacement binding queue',async()=>{const f=rig();let release;try{
 const read=f.host.liveTransport.queueOffer;let calls=0;f.host.liveTransport.queueOffer=async(...args)=>{calls++;if(calls===1)throw Object.assign(Error('temporary'),{code:'read_transient'});const body=await read(...args);if(calls===2)return new Promise(resolve=>release=()=>resolve(body));return body;};
 await f.refresh();assert.equal(calls,1);await f.refresh();assert.equal(calls,2);assert.equal(f.media.queueControls.pending,true);
 f.replaceBinding();await f.refresh();assert.equal(calls,3);const accepted=f.media.queueControls.offer;assert.equal(accepted.expectedBindingId,'b'.repeat(64));release();await tick();assert.equal(f.media.queueControls.offer,accepted);await f.refresh();assert.equal(calls,3);
 }finally{release?.();f.close();}});
for(const code of ['read_access_denied',undefined])test(`non-transient queue error ${code||'generic'} never gains recovery budget`,async()=>{const f=rig();try{
 let calls=0;f.host.liveTransport.queueOffer=async()=>{calls++;throw Object.assign(Error('failed read'),{code});};await f.refresh();await f.refresh();await f.refresh();assert.equal(calls,1);assert.equal(f.media.queueReadRetry??null,null);
 }finally{f.close();}});


// Drive the real queue expiry callback without sleeping or issuing effects.
function expiryRig(){
 const originalNow=Date.now,originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
 let now=originalNow(),serial=0;const timers=new Map();Date.now=()=>now;
 globalThis.setTimeout=(fn,delay)=>{const id=++serial;timers.set(id,{fn,at:now+delay});return id;};globalThis.clearTimeout=id=>timers.delete(id);
 const f=rig(),wire=f.wire,read=f.host.liveTransport.queueOffer;let effects=0;
 f.host.liveTransport.music=async()=>{const body=wire();body.data.observation.observed_at=new Date(now).toISOString();return body;};
 f.host.liveTransport.queueAction=async()=>{effects++;throw Error('unexpected effect');};
 f.host.liveTransport.queueOffer=async(...args)=>{const body=await read(...args);if(f.reads.length>1)body.items=[{id:'f'.repeat(24),order:1,title:'Upcoming fixture',artist:'Fixture',uri:'spotify:track:1111111111111111111111',artwork:null}];return body;};
 return {...f,expire(){const timer=timers.get(f.media.queueControls.expiryTimer);assert.ok(timer,'real queue expiry was scheduled');now=timer.at+1;timers.delete(f.media.queueControls.expiryTimer);timer.fn();},effects:()=>effects,close(){f.close();Date.now=originalNow;globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}};
}
test('expired successful empty queue reads upcoming rows on next validated same-track playback only',async()=>{const f=expiryRig();try{
 await f.refresh();assert.equal(f.reads.length,1);assert.deepEqual(f.media.queueControls.offer.items,[]);const uri=f.media.playback.item.uri;
 f.expire();assert.equal(f.media.queueControls.status,'stale');f.media.renderQueue();await f.media.loadQueue({automatic:true});assert.equal(f.reads.length,1,'expiry, render and automatic call alone never fetch');
 await f.refresh();assert.equal(f.media.playback.item.uri,uri);assert.equal(f.reads.length,2,'next actual playback re-observation refreshes expired successful queue');assert.equal(f.media.queueControls.model('account',f.media.playback).items[0].title,'Upcoming fixture');
 await f.refresh();assert.equal(f.reads.length,2,'fresh offer does not refresh on each poll');assert.equal(f.effects(),0);
 }finally{f.close();}});
for(const fence of ['unknown','consumed','intent-pending','selection-pending','outside','account-only','stale-playback'])test(`expired successful queue refresh respects ${fence}`,async()=>{const f=expiryRig();try{
 await f.refresh();f.expire();
 if(fence==='unknown'){f.media.queueControls.status='unknown';f.media.queueControls.consumed=true;}
 if(fence==='consumed')f.media.queueControls.consumed=true;
 if(fence==='intent-pending')f.host.liveControls={musicIntentPending:true,render(){},invalidateMusic(){}};
 if(fence==='selection-pending')f.host.liveSelection.feedback={pending:true};
 if(fence==='outside')f.host.state.focus='music';
 if(fence==='account-only'){const read=f.host.liveTransport.read;f.host.liveTransport.music=async()=>({...await read(),status:'account_observed',reason:'route_unavailable',binding:null});}
 if(fence==='stale-playback')f.host.liveTransport.music=async()=>{throw Object.assign(Error('read failed'),{code:'read_transient'});};
 await f.refresh();assert.equal(f.reads.length,1);assert.equal(f.effects(),0);
 }finally{f.close();}});
test('expired queue refresh late response cannot overwrite replacement binding queue',async()=>{const f=expiryRig();let release;try{
 const read=f.host.liveTransport.queueOffer;f.host.liveTransport.queueOffer=async(...args)=>{const body=await read(...args);if(f.reads.length===2)return new Promise(resolve=>release=()=>resolve(body));return body;};
 await f.refresh();f.expire();await f.refresh();assert.equal(f.reads.length,2);assert.equal(f.media.queueControls.pending,true);
 f.replaceBinding();await f.refresh();assert.equal(f.reads.length,3);const accepted=f.media.queueControls.offer;assert.equal(accepted.expectedBindingId,'b'.repeat(64));release();await tick();assert.equal(f.media.queueControls.offer,accepted);assert.equal(f.effects(),0);
 }finally{release?.();f.close();}});

test('fresh actual playback preserves every admitted upcoming native occurrence',async()=>{
 const f=rig();try{
  const native=f.host.liveTransport.queueOffer;const rendered=[];f.host.playerView.renderQueue=(items,meta)=>rendered.push({items,meta});
  f.host.liveTransport.queueOffer=async(...args)=>{const reply=await native(...args);reply.items=[0,1,2].map((index)=>({id:(index+1).toString(16).padStart(24,'0'),order:index+1,title:`Sang ${index+1}`,artist:'Artist',uri:`spotify:track:${String(index+1).repeat(22)}`,artwork:null}));return reply;};
  await f.refresh();assert.equal(f.reads.length,1);assert.equal(f.media.queueControls.status,'ready');const latest=rendered.at(-1);assert.deepEqual(latest.items.map(row=>row.title),['Sang 1','Sang 2','Sang 3']);assert.deepEqual(latest.items.map(row=>row.order),[1,2,3]);assert.equal(latest.meta.status,'ready');
 }finally{f.close();}
});

test('player queue read follows actual binding even when transport setup is unavailable',async()=>{
 const f=rig();try{
  f.host.liveTransport.music=async()=>({...f.wire(),schema:'podview.room-playback.v3',controls:{status:'unavailable',reason:'control_not_granted',binding_id:null,valid_until:null,supported_actions:[],volume:null},permissions:{actions:[],maxVolume:null}});
  await f.refresh();assert.equal(f.reads.length,1);assert.equal(f.media.queueControls.status,'ready');
  f.replaceBinding();await f.refresh();assert.equal(f.reads.length,2);assert.equal(f.reads[1].expected,'b'.repeat(64));
 }finally{f.close();}
});

test('missing queue permission explicitly blocks the read despite fresh playback',async()=>{
 const f=rig();try{f.host.liveSnapshot.capabilities.queueSelection=false;await f.refresh();assert.equal(f.reads.length,0);assert.equal(f.media.queueControls.offer,null);}finally{f.close();}
});


// K2: the chosen occurrence leaves the upcoming list once it plays; the known follower stays inert.
test('accepted occurrence keeps the queue through the real playback refresh and a transient fresh queue read',async()=>{
 const f=rig();let rejectRead;try{
  const rendered=[];f.host.playerView.renderQueue=items=>rendered.push(items);const source=f.host.liveTransport.queueOffer,selectedUri='spotify:track:'+'9'.repeat(22),nextUri='spotify:track:'+'8'.repeat(22);let song=null,effects=0,queueReads=0;
  f.host.liveTransport.music=async()=>{const value=f.wire();if(song)value.data.playback.item.uri=song;return value;};
  f.host.liveTransport.queueOffer=async(...args)=>{const value=await source(...args);queueReads++;if(queueReads===2)return new Promise((_,reject)=>rejectRead=reject);return {...value,items:[{id:String(queueReads).padStart(24,'0'),title:'Known queued song',artist:'Artist',uri:selectedUri,artwork:null,order:1},{id:String(queueReads+50).padStart(24,'0'),title:'Following queued song',artist:'Artist',uri:nextUri,artwork:null,order:2}]};};
  f.host.liveTransport.queueAction=async()=>{effects++;song=selectedUri;return {outcome:'accepted'};};
  await f.refresh();const q=f.media.queueControls,shown=q.offer,[old,follower]=q.model('account',f.media.playback).items;
  const choosing=q.choose(old);await tick();assert.equal(f.media.playback.item.uri,selectedUri);assert.equal(queueReads,2,'one new read follows accepted choice even when current track changes');
  let model=q.model('account',f.media.playback);assert.deepEqual(model.items.map(row=>row.id),[follower.id],'the playing choice is not listed as upcoming');assert.equal(model.status,'loading');assert.equal(rendered.at(-1)[0].title,follower.title,'mounted player renderer keeps known rows during the fresh read');await q.choose(old);assert.equal(effects,1);
  rejectRead(Object.assign(Error('temporary'),{code:'read_transient'}));await choosing;model=q.model('account',f.media.playback);assert.equal(model.items[0].id,follower.id);assert.equal(model.items[0].selectable,false);assert.equal(model.status,'stale');assert.equal(rendered.at(-1)[0].title,follower.title);await q.choose(follower);assert.equal(effects,1);
  await f.media.loadQueue();model=q.model('account',f.media.playback);assert.notEqual(q.offer.taskId,shown.taskId);assert.deepEqual(model.items.map(row=>row.title),[follower.title]);assert.notEqual(model.items[0].id,follower.id);assert.equal(model.items[0].selectable,true);assert.equal(effects,1);
  f.host.liveTransport.queueOffer=async(...args)=>({...await source(...args),items:[]});await f.media.loadQueue();assert.deepEqual(q.model('account',f.media.playback).items,[],'fresh authoritative empty may clear the display');assert.equal(effects,1);
 }finally{rejectRead?.(Error('cleanup'));f.close();}
});

// CI music_selection (queueIdentityJourney, PR #526): the queue lists Køsang 22 twice and the second one is chosen.
// The new song shows at once, while the new queue read runs. In that same render the occurrence the room moved past
// (the first Køsang 22) is never listed or tappable, and the chosen one is not listed as upcoming.
function duplicateRig(){
 const f=rig(),source=f.host.liveTransport.queueOffer,twice='spotify:track:'+'2'.repeat(22);
 const next='spotify:track:'+'3'.repeat(22),later='spotify:track:'+'4'.repeat(22);let song=null,reads=0,release;
 f.host.liveTransport.music=async()=>{const value=f.wire();if(song)value.data.playback.item.uri=song;return value;};
 f.host.liveTransport.queueOffer=async(...args)=>{const value=await source(...args);reads++;
  const rows=reads===1?[['a',twice,'Køsang 22'],['b',twice,'Køsang 22'],['c',next,'Køsang 23'],['d',later,'Køsang 24']]
   :[['e',next,'Køsang 23'],['f',later,'Køsang 24']];
  const body={...value,items:rows.map(([id,uri,title],index)=>({id:id.repeat(24),uri,title,artist:'Artist',artwork:null,
   order:index+1}))};
  return reads===1?body:new Promise(resolve=>release=()=>resolve(body));};
 f.host.liveTransport.queueAction=async()=>{song=twice;return {outcome:'accepted'};};
 const shown=()=>{const {queue}=usePlayer.getState();
  return {status:queue.options.status,upcoming:queue.items.filter(row=>!row.current).map(row=>row.id[0]),
   selectable:queue.items.filter(row=>row.selectable).map(row=>row.id[0])};};
 return {...f,twice,shown,setSong:uri=>{song=uri;},release:()=>release?.(),reads:()=>reads};
}
test('a chosen repeated song: the passed occurrence is gone in the same render that shows the new song',async()=>{
 const f=duplicateRig();let choosing;try{
  await f.refresh();const q=f.media.queueControls,rows=q.model('account',f.media.playback).items;
  assert.deepEqual(f.shown().upcoming,['a','b','c','d']);
  choosing=q.choose(rows[1]);await tick();
  assert.equal(f.media.playback.item.uri,f.twice,'the chosen song shows');assert.equal(f.reads(),2,'its queue read runs');
  assert.deepEqual(f.shown().upcoming,['c','d'],'neither the passed nor the playing occurrence is listed');
  assert.deepEqual(f.shown().selectable.filter(id=>id==='a'||id==='b'),[],'no passed occurrence is tappable');
  f.release();await choosing;assert.deepEqual(f.shown().upcoming,['e','f']);assert.equal(f.shown().status,'ready');
 }finally{f.release();f.close();}
});
test('a repeated song reached without a choice: rows that cannot say which occurrence plays are never ready',
 async()=>{const f=duplicateRig();try{
  await f.refresh();assert.equal(f.shown().status,'ready');
  // Another app moved the room on to Køsang 22: the rows hold it twice and nothing names the occurrence.
  f.setSong(f.twice);await f.refresh();assert.equal(f.reads(),2,'its queue read runs');
  assert.notEqual(f.shown().status,'ready','the old rows are not this song\'s ready queue');
  assert.deepEqual(f.shown().selectable,[],'and nothing in them is tappable');
  f.release();await tick();assert.deepEqual(f.shown().upcoming,['e','f']);assert.equal(f.shown().status,'ready');
 }finally{f.release();f.close();}
});

test('accepted selection retains known queue rows as inert display until fresh changed-revision metadata arrives',async()=>{
 const f=rig();try{
  const source=f.host.liveTransport.queueOffer,selectedUri='spotify:track:'+'9'.repeat(22),nextUri='spotify:track:'+'8'.repeat(22),laterUri='spotify:track:'+'7'.repeat(22);let song=null,reads=0,effects=0;const rendered=[];
  f.host.playerView.renderQueue=items=>rendered.push(items);
  f.host.liveTransport.music=async()=>{const value=f.wire();if(song)value.data.playback.item.uri=song;return value;};
  // The first queue also knows a later song; it stays as inert display once the choice plays (K2).
  f.host.liveTransport.queueOffer=async(...args)=>{const value=await source(...args);reads++;return {...value,items:[{id:String(reads).padStart(24,'0'),title:reads===2?'Nummer i køen':reads===1?'Actual selected song':'Actual next song',artist:'Artist',uri:reads===1?selectedUri:nextUri,artwork:null,order:1,metadataKnown:reads!==2},...(reads===1?[{id:'5'.repeat(24),title:'Known later song',artist:'Artist',uri:laterUri,artwork:null,order:2,metadataKnown:true}]:[])]};};
  f.host.liveTransport.queueAction=async()=>{effects++;song=selectedUri;return {outcome:'accepted'};};
  await f.refresh();const q=f.media.queueControls,[old,later]=q.model('account',f.media.playback).items,oldTask=q.offer.taskId;
  await q.choose(old);let model=q.model('account',f.media.playback);assert.equal(reads,2);assert.equal(model.metadataPending,true);assert.equal(model.status,'stale');assert.deepEqual(model.items.map(row=>row.id),[later.id],'the playing choice is not listed as upcoming');assert.equal(model.items[0].title,later.title);assert.equal(model.items[0].selectable,false);assert.equal(rendered.at(-1)[0].title,later.title);assert.equal(q.offer,null);assert.notEqual(q.retained.shownOffer.taskId,oldTask);assert.notEqual(q.retained.shownOffer.items[0].id,old.id);await q.choose(old);assert.equal(effects,1,'retained display cannot borrow fresh task authority');
  await f.media.loadQueue();model=q.model('account',f.media.playback);assert.equal(model.metadataPending,false);assert.equal(model.items[0].title,'Actual next song');assert.equal(model.items[0].uri,nextUri);assert.notEqual(model.items[0].id,old.id);assert.equal(model.items[0].selectable,true);assert.equal(effects,1);
  f.host.liveTransport.queueOffer=async(...args)=>({...await source(...args),items:[]});await f.media.loadQueue();assert.deepEqual(q.model('account',f.media.playback).items,[]);assert.equal(effects,1);
 }finally{f.close();}
});

for(const outcome of ['accepted','unknown','rejected'])test(`playback changes before the queue ${outcome} reply: accepted refreshes metadata, a refusal reads a fresh offer, unknown waits`,async()=>{
 const f=rig();let reply;try{
  const source=f.host.liveTransport.queueOffer,selectedUri='spotify:track:'+'9'.repeat(22);let song=null,effects=0;
  f.host.liveTransport.music=async()=>{const value=f.wire();if(song)value.data.playback.item.uri=song;return value;};
  f.host.liveTransport.queueOffer=async(...args)=>{const value=await source(...args);return {...value,items:[{id:String(f.reads.length).padStart(24,'0'),title:'Actual queue song',artist:'Artist',uri:selectedUri,artwork:null,order:1},{id:String(f.reads.length+50).padStart(24,'0'),title:'Following queue song',artist:'Artist',uri:'spotify:track:'+'8'.repeat(22),artwork:null,order:2}]};};
  f.host.liveTransport.queueAction=()=>{effects++;return new Promise(resolve=>reply=resolve);};
  await f.refresh();const q=f.media.queueControls,[old,follower]=q.model('account',f.media.playback).items,oldTask=q.offer.taskId,choosing=q.choose(old);await tick();song=selectedUri;await f.refresh();assert.deepEqual(q.model('account',f.media.playback).items.map(row=>row.id),[follower.id],'the playing song is not listed as upcoming (K2)');assert.equal(q.model('account',f.media.playback).items[0].selectable,false);assert.equal(f.reads.length,1);reply({outcome});await choosing;
  // Green 13/11: a refused choice spent its offer, so a fresh one is read and the queue stays usable.
  assert.equal(effects,1);assert.equal(f.reads.length,outcome==='unknown'?1:2);const model=q.model('account',f.media.playback);assert.equal(model.items[0].title,follower.title);
  if(outcome!=='unknown'){assert.equal(model.items[0].selectable,true);assert.notEqual(q.offer.taskId,oldTask);assert.equal(model.status==='error',false);}else{assert.equal(q.consumed,true);assert.equal(model.items[0].selectable,outcome==='unknown');await q.choose(old);await f.refresh();assert.equal(f.reads.length,1);assert.equal(effects,1);}
 }finally{reply?.({outcome:'unknown'});f.close();}
});

test('player opens with the prefetched queue ready (no loading paint), without hiding real denial',async()=>{const f=rig();try{f.host.state.focus='now';await f.refresh();const models=[];f.host.playerView.renderQueue=(items,options)=>models.push({items,options});f.host.state.focus='player';f.media.renderQueue();assert.equal(models.at(-1).options.status,'ready');assert.equal(models.at(-1).options.empty,'Ingen sange i køen.');f.host.liveSnapshot.capabilities.queueSelection=false;f.media.renderQueue();assert.notEqual(models.at(-1).options.status,'loading');assert.ok(models.at(-1).items.every(item=>!item.selectable),'denied selection keeps rows read-only');f.host.liveSnapshot.capabilities.musicRead=['playback'];f.media.renderQueue();assert.equal(models.at(-1).options.status,'unavailable','denied queue read hides the queue');}finally{f.close();}});

test('selected track presentation retains an already observed inert queue without granting a new action',async()=>{const f=rig();try{const original=f.host.liveTransport.queueOffer;f.host.liveTransport.queueOffer=async(...args)=>{const result=await original(...args);result.items=[{id:'a'.repeat(24),order:1,title:'Kendt køsang',artist:'Artist',uri:'spotify:track:QUEUEDSONG0123456789AB',artwork:null}];return result;};await f.refresh();assert.equal(f.media.queueControls.retained.items.length,1);f.media.queueControls.invalidate(false);const calls=[];f.host.playerView.renderQueue=(items,options)=>calls.push({items,options});f.host.liveSelection.feedback={pending:true};f.host.liveSelection.pendingPlayer=()=>({title:'Valgt sang',uri:'spotify:track:ABCDEFGHIJKL0123456789'});f.media.render();assert.equal(calls.at(-1).items[0].title,'Kendt køsang');assert.equal(calls.at(-1).items[0].selectable,false);assert.equal(f.reads.length,1);}finally{f.close();}});

test('UNKNOWN renews the open queue on a newer same-track owner observation, only for new input',async()=>{
 const f=rig();
 try{
  const source=f.host.liveTransport.queueOffer, writes=[];
  let poll=2;
  f.host.liveTransport.music=async()=>{
   const body=f.wire();
   body.data.poll_sequence=poll;
   return body;
  };
  f.host.liveTransport.queueOffer=async(...args)=>{
   const value=await source(...args);
   const uri='spotify:track:'+'9'.repeat(22);
   return {...value,pollSequence:poll,items:[
    {id:'a'.repeat(24),order:1,title:'First choice',artist:'Artist',uri,artwork:null},
    {id:'b'.repeat(24),order:2,title:'New explicit choice',artist:'Artist',uri,artwork:null},
   ]};
  };
  f.host.liveTransport.queueAction=async(task,id)=>{
   writes.push({taskId:task.taskId,id});
   return {outcome:writes.length===1?'unknown':'accepted'};
  };
  await f.refresh();
  const queue=f.media.queueControls,oldTask=queue.offer.taskId;
  await queue.choose(queue.model('account',f.media.playback).items[0]);
  await f.refresh();
  assert.equal(f.reads.length,1,'same poll cannot renew a spent offer');
  poll++;
  await f.refresh();
  assert.equal(f.reads.length,2,'new owner observation restores a fresh read without leaving queue');
  assert.deepEqual(writes,[{taskId:oldTask,id:'a'.repeat(24)}]);
  const freshTask=queue.offer.taskId;
  assert.notEqual(freshTask,oldTask);
  await queue.choose(queue.model('account',f.media.playback).items[1]);
  assert.deepEqual(writes,[{taskId:oldTask,id:'a'.repeat(24)},{taskId:freshTask,id:'b'.repeat(24)}]);
 }finally{f.close();}
});

for(const resolves of [false,true])test(`unresolved autoplay keeps rows read-only; resolves=${resolves}`,async()=>{
 const f=rig(),rendered=[];
 const pending=()=>Object.assign(Error('pending'),{code:'queue_preview_pending'});
 let attempts=0,effects=0;
 try{
  const source=f.host.liveTransport.queueOffer;
  f.host.playerView.renderQueue=(items,options)=>rendered.push({items,options});
  f.host.liveTransport.queueAction=async()=>{effects++;return {outcome:'unknown'};};
  f.host.liveTransport.queueOffer=async(...args)=>{
   const attempt=++attempts;
   if(attempt===2||attempt===3&&!resolves)throw pending();
   const body=await source(...args);
   if(attempt===1){
    body.items=[{id:'1'.repeat(24),title:'Retained',artist:'',uri:'spotify:track:'+'1'.repeat(22),
     artwork:null,order:1}];
   }
   return body;
  };
  await f.refresh();
  const queue=f.media.queueControls,old=queue.model('account',f.media.playback).items[0];
  await f.media.loadQueue();
  assert.equal(attempts,2);
  assert.equal(queue.offer,null);
  assert.equal(queue.status,'stale');
  assert.equal(rendered.at(-1).items[0].title,'Retained');
  assert.equal(rendered.at(-1).items[0].selectable,false);
  await queue.choose(old);
  assert.equal(effects,0);
  await f.refresh();
  await f.refresh();
  await f.refresh();
  assert.equal(attempts,3,'one existing playback-gated recovery read, no polling or replay');
  const last=rendered.at(-1);
  assert.equal(last.options.status,resolves?'ready':'stale');
  assert.deepEqual(last.items.map(item=>item.title),resolves?[]:['Retained']);
  assert.equal(effects,0);
 }finally{f.close();}
});

test('initial unresolved autoplay is pending rather than a confirmed empty queue',async()=>{
 const f=rig(),rendered=[];
 try{
  f.host.playerView.renderQueue=(items,options)=>rendered.push({items,options});
  f.host.liveTransport.queueOffer=async()=>{
   throw Object.assign(Error('pending'),{code:'queue_preview_pending'});
  };
  await f.refresh();
  const last=rendered.at(-1);
  assert.equal(last.options.status,'loading');
  assert.equal(last.options.empty,'');
  assert.deepEqual(last.items,[]);
  assert.equal(f.media.queueControls.offer,null);
 }finally{f.close();}
});

test('accepted queue choice with pending preview recovers on one newer playback read without another action',async()=>{
 const f=rig();
 const pending=()=>Object.assign(Error('pending'),{code:'queue_preview_pending'});
 let attempts=0,effects=0,poll=2;
 try{
  const source=f.host.liveTransport.queueOffer;
  f.host.liveTransport.music=async()=>{
   const value=f.wire();
   value.data.poll_sequence=poll;
   return value;
  };
  f.host.liveTransport.queueOffer=async(...args)=>{
   if(++attempts===2)throw pending();
   const body=await source(...args);
   body.pollSequence=poll;
   body.items=[{id:String(attempts).repeat(24),title:'Queue track',artist:'',order:1,artwork:null,
    uri:'spotify:track:'+'2'.repeat(22)}];
   return body;
  };
  f.host.liveTransport.queueAction=async()=>{effects++;return {outcome:'accepted'};};
  await f.refresh();
  const queue=f.media.queueControls,old=queue.model('account',f.media.playback).items[0];
  await queue.choose(old);
  assert.equal(attempts,2);
  assert.equal(effects,1);
  assert.equal(queue.consumed,true);
  assert.equal(queue.model('account',f.media.playback).items[0].selectable,false);
  await f.refresh();
  assert.equal(attempts,2,'a repeated playback observation does not spend the continuation');
  poll++;
  await f.refresh();
  await f.refresh();
  assert.equal(attempts,3,'only one passive read follows accepted → pending');
  assert.equal(effects,1);
  const fresh=queue.model('account',f.media.playback).items[0];
  assert.notEqual(fresh.id,old.id);
  assert.equal(fresh.selectable,true);
  await queue.choose(old);
  assert.equal(effects,1);
 }finally{f.close();}
});
// Owner 17/11 »reload-flash af køen«: opening Kø re-reads a queue that is already known. The known rows and their
// »N numre« line stay (status ready, no placeholders) while that read runs; the answer only patches them.
test('opening Kø with a known queue keeps the rows as they are while the re-read runs',async()=>{
 const f=rig(),rendered=[];
 try{
  f.host.playerView.renderQueue=(items,options)=>rendered.push({items,options});
  const offer=f.host.liveTransport.queueOffer;
  const withRows=async(...args)=>{const value=await offer(...args);
   value.items=[1,2].map(n=>({id:String(n).padStart(24,'0'),title:`Queued ${n}`,artist:'Artist',
    uri:`spotify:track:${String(n).padStart(22,'0')}`,artwork:null,order:n}));return value;};
  f.host.liveTransport.queueOffer=withRows;
  await f.refresh();
  assert.deepEqual(rendered.at(-1).items.map(item=>item.title),['Queued 1','Queued 2']);
  let release;
  f.host.liveTransport.queueOffer=(...args)=>new Promise(resolve=>{release=()=>resolve(withRows(...args));});
  const reading=f.media.loadQueue();await tick();
  assert.equal(f.media.queueControls.pending,true,'the re-read runs');
  f.media.renderQueue();
  const shown=rendered.at(-1);
  assert.deepEqual(shown.items.map(item=>item.title),['Queued 1','Queued 2']);
  assert.equal(shown.options.status,'ready','no loading or »ikke opdateret« flash');
  assert.equal(shown.options.placeholders,false);
  release();await reading;
 }finally{f.close();}
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
function sessionRig(){
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
 const media=readerOn(host);host.liveMedia=media;media.account='account';const stop=forwardQueue(host,media);
 return {host,media,reads,queues,song:next=>uri=next,
  async refresh(){await media.refresh({immediate:true});await tick();},
  close(){stop();media.queueControls.invalidate(true);clearTimeout(media.queueTroubleTimer);clearTimeout(media.freshnessTimer);
   globalThis.document=previous;}};
}

test('regression: a not-allowed queue read waits and is read again once it becomes allowed',async()=>{
 const f=sessionRig();
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
 const f=sessionRig();
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
 const f=sessionRig();
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

// ---- B. the room player's commands (room-commands.ts, was RoomPlayerControls) ----
const SNAP = {bootId: 'boot', roomId: 'kitchen'};
function roomRead(state = 'paused', actions = ['pause', 'resume', 'next', 'previous', 'volume']) {
  return roomPlayerObservation({ok: true, schema: 'podview.room-player.v1', bootId: 'boot', roomId: 'kitchen',
    configEntryId: 'account', state, source: 'spotify', title: 'Song', artist: 'Artist', album: null,
    uri: 'spotify:track:' + 'a'.repeat(22), positionMs: 1000, positionAt: Date.now(), durationMs: 60000,
    volumePercent: 30, artworkUrl: null, actions, maxVolume: 100, session: null, elsewhere: null}, 'account', SNAP);
}

test('regression: player controls refuse a transiently stale room read', () => {
  const controls = createRoomCommands({liveTransport: {connected: true}});
  const p = stale => ({stale, expiresAt: Date.now() + 10000, controls: {actions: ['pause', 'resume', 'next']}});
  assert.equal(controls.can('pause', p(undefined)), true);
  assert.equal(controls.can('pause', p('transient')), false);
  assert.equal(controls.can('next', p(true)), false);
});

test('regression: the optimistic wish is cleared by a timer when OPTIMISTIC_MS runs out', async () => {
  vi.useFakeTimers();
  let renders = 0, answer;
  const host = {liveSnapshot: SNAP, liveTransport: {connected: true, generation: 0,
    playerAction: () => new Promise(resolve => {
      answer = resolve;
    })}, liveMedia: {account: 'account', playback: roomRead('playing'), render() {
    renders++;
  }}};
  const controls = createRoomCommands(host);
  void controls.intent('pause');
  const wish = controls.getState().desired;
  assert.equal(wish.playing, false);
  answer({outcome: 'accepted'});
  await vi.advanceTimersByTimeAsync(0);
  const before = renders;
  await vi.advanceTimersByTimeAsync(5998);
  assert.equal(controls.getState().desired, wish);
  await vi.advanceTimersByTimeAsync(2);
  assert.equal(controls.getState().desired, null);
  assert.equal(renders, before + 1);
  // A newer wish is never cleared by the older timer.
  void controls.intent('volume', {percent: 20});
  const newer = controls.getState().desired;
  answer({outcome: 'accepted'});
  await vi.advanceTimersByTimeAsync(3000);
  void controls.intent('volume', {percent: 25});
  const newest = controls.getState().desired;
  assert.notEqual(newest, newer);
  answer({outcome: 'accepted'});
  await vi.advanceTimersByTimeAsync(3500);
  assert.equal(controls.getState().desired, newest, 'the older wish\'s timer does not clear the newer one');
  controls.invalidate();
});

function controlRig(hold) {
  const host = {liveSnapshot: SNAP, liveTransport: {connected: true}, liveSelection: {controlHold: () => hold},
    liveMedia: {account: 'account', playback: roomRead('paused')}};
  return createRoomCommands(host);
}
const shown = () => transportFaces(usePlayer.getState().controls);

test('regression: the room player commands are the single owner and a confirmed hold leaves play/pause usable', () => {
  controlRig({blocked: false, playing: true, phase: 'confirmed'}).render();
  assert.equal(shown().toggleDisabled, false);
  assert.equal(shown().toggleLabel, 'Sæt musik på pause');
  const result = controlRig({blocked: true, playing: false, phase: 'accepted'}).render();
  assert.equal(shown().toggleDisabled, true);
  assert.equal(shown().nextDisabled, true);
  assert.equal(result.transport, false);
  assert.equal(result.canVolume, false);
  controlRig(null).render();
  assert.equal(shown().toggleDisabled, false);
});


// ---- Musik-Koe: music elsewhere has no room queue ----
function elsewhereFixture(playback){
 const shown=[];
 const view=Object.create(RoomPlayer.prototype);
 Object.assign(view,{account:'account',playback,queuePresentation:newQueuePresentation(),upcoming:upcomingQueueRows,queueTroubleSince:null,queueTroubleTimer:null,
  queueControls:{retained:null,offer:null,pending:false,invalidations:0,invalidate(){this.invalidations++;},
   model(){return null;},status:'stale'},
  host:{isConnected:true,liveSnapshot:{bootId:'boot',roomId:'kitchen',
   capabilities:{queueSelection:true,musicRead:['playback','queue']}},
   playerView:{renderQueue:(items,options)=>shown.push({items,options})}}});
 return {view,shown};
}

test('Musik-Koe: playback on another device resolves to the empty state at once, not loading rows',()=>{
 const {view,shown}=elsewhereFixture({state:'playing',elsewhere:true,source:'spotify',
  item:{type:'track',uri:'spotify:track:'+'1'.repeat(22),name:'Heartless',artists:['Kanye West']}});
 try{
  const stop=forwardQueue(view.host,view);
  view.renderQueue();stop();
  const {items,options}=shown.at(-1);
  assert.deepEqual(items,[]);
  assert.notEqual(options.status,'loading','no skeleton for a queue that cannot come');
  assert.equal(options.placeholders,false);
  assert.equal(options.empty,'Køen kan ikke vises lige nu. Musikken spiller videre.');
  assert.equal(view.queueTroubleTimer,null,'nothing waits to resolve it later');
 }finally{clearTimeout(view.queueTroubleTimer);}
});

// ---- account discovery ----
for(const outcome of ['empty','malformed','error'])test(`actual account discovery ${outcome} terminal clears catalogue busy without a spinner or fake music`,async()=>{let settle,terminalClears=0;const held=new Promise((resolve,reject)=>settle=outcome==='error'?reject:resolve),renders=[];const host={isConnected:true,state:{focus:'music'},liveSnapshot:{bootId:'boot',roomId:'room',capabilities:{musicRead:['targets','playback','top']}},liveStatus:'connected',liveTransport:{connected:true,music:()=>held},musicResults:{render:vm=>renders.push(vm)},playerView:{renderPlayer(){},renderControls(){},renderQueue(){}}};const media=Object.create(RoomPlayer.prototype);Object.assign(media,{host,generation:0,queuePresentation:newQueuePresentation(),lastRead:0,pending:false,account:null,rows:new Map(),queueControls:{model:()=>null,invalidate:revoke=>{assert.equal(revoke,true);terminalClears++;}}});host.liveMedia=media;host.liveCatalogue=new LiveMusicCatalogueView(host,()=>{});host.liveCatalogue.updateCapabilities(true,host.liveSnapshot.capabilities.musicRead);const reading=media.refresh();assert.equal(renders.at(-1).busy,true);settle(outcome==='error'?new Error('mock failure'):outcome==='empty'?{ok:true,data:{accounts:[]}}:{ok:true,data:{accounts:'malformed'}});await reading;assert.equal(terminalClears,outcome==='empty'?0:1);assert.equal(media.rows.size,0);assert.equal(media.pending,false);assert.equal(renders.at(-1).busy,false);assert.equal(renders.at(-1).cards.length,0);assert.equal(media.readState,outcome==='empty'?'unavailable':'error');});

function accountFixture(count){let options=Array.from({length:count},(_,i)=>({config_entry_id:`a${i}`,title:`Account ${i}`}));const calls=[];const host={isConnected:true,liveSnapshot:{bootId:'boot',roomId:'room',capabilities:{musicRead:['targets','playback']}},liveTransport:{connected:true,async music(kind,account){calls.push([kind,account]);return kind==='targets'?{ok:true,data:{accounts:options}}:{ok:false};}}};const view=Object.assign(Object.create(RoomPlayer.prototype),{host,generation:0,queuePresentation:newQueuePresentation(),rows:new Map(),account:null,lastRead:0,pending:false,accounts:{hidden:true,data:{items:[],selected:null}},queueControls:{invalidate(){}},render(){}});return {view,calls,options(value){options=value;}};}
test('sole account auto-selects without displaying redundant account picker',async()=>{const {view,calls}=accountFixture(1);await view.refresh();assert.equal(view.account,'a0');assert.equal(view.accounts.hidden,true);assert.equal(view.accounts.data.selected,'a0');assert.deepEqual(calls,[['targets',undefined],['playback','a0']]);});
test('multiple accounts retain visible choice and never auto-select or read playback',async()=>{const {view,calls}=accountFixture(2);await view.refresh();assert.equal(view.account,null);assert.equal(view.accounts.hidden,false);assert.equal(view.readState,'account-selection');assert.equal(view.accounts.data.items.length,2);assert.deepEqual(calls,[['targets',undefined]]);});
test('revoked multiple-account choice clears and refreshed sole account is selected invisibly',async()=>{const original=globalThis.document;globalThis.document={getElementById(){return {replaceChildren(){}};}};try{const f=accountFixture(2);await f.view.refresh();f.view.invalidate(true);assert.equal(f.view.accounts.hidden,true);assert.deepEqual(f.view.accounts.data.items,[]);f.options([{config_entry_id:'new',title:'Current account'}]);await f.view.refresh();assert.equal(f.view.account,'new');assert.equal(f.view.accounts.hidden,true);assert.deepEqual(f.view.accounts.data.items,[{id:'new',label:'Current account'}]);}finally{globalThis.document=original;}});

test('the player refresh waits while a finger is down and runs right after', () => {
  vi.useFakeTimers();
  const view = Object.create(RoomPlayer.prototype);
  let published = 0;
  const stop = usePlayer.subscribe(() => published++);
  view.host = {touching: true};
  view.render();
  assert.equal(vi.getTimerCount(), 1, 'redraw postponed, not run under the finger');
  assert.equal(published, 0);
  stop();
});

test('regression: the room player render never overwrites the controls after liveControls.render', async () => {
  const {default: source} = await import('./room-player.ts?raw');
  assert.match(source, /if \(controls\) controls\.render\?\.\(\);\n\s*else if \(selected\) publishControls/);
});

// ---- C. the queue's readiness belongs to the song it was read for ----
// CI journey music_selection (queueIdentityJourney): song 32's queue read failed, so song 30's rows 31 and 32 were
// still retained when song 33 began; the read for song 33 was running. Those rows were shown as »ready« (the K1 rule
// that keeps a known queue during a re-read) until song 33's own rows arrived.
test('rows read for an earlier song are never shown as a ready queue while the current song\'s read runs', () => {
  const p = {...roomRead('playing'), roomBinding: {roomId: 'kitchen', accountId: 'account', bindingId: 'b'.repeat(64),
    targetId: 't', nativeRoomId: 'r', nativeHomepodId: '42', validUntil: Date.now() / 1000 + 60}};
  const earlier = [{id: 'o31', title: 'Køsang 31', order: 1}, {id: 'o32', title: 'Køsang 32', order: 2}];
  const queue = (retainedKey, status) => ({pending: true, status: 'loading', errorKind: null, previewPending: false,
    offer: null, retained: {key: retainedKey, items: earlier, metadataPending: false}, invalidate() {},
    allowed: () => true, load: async () => undefined,
    // The owner's model: the retained rows after the playing song (song 33 is not among them), its own status, and
    // whether the playing song is one of the rows.
    model: () => ({status, errorKind: null, follows: earlier.some(row => row.uri === p.item.uri),
      items: earlier.map(row => ({...row, selectable: false}))})});
  const shown = (retainedKey, status) => {
    resetPlayer();
    const host = {isConnected: true, liveSnapshot: {...SNAP, capabilities: {musicRead: ['playback', 'queue'],
      queueSelection: true}}, liveTransport: {connected: true}};
    const media = new RoomPlayer(host, queue(retainedKey, status), upcomingQueueRows);
    media.account = 'account';
    media.playback = p;
    media.renderQueue();
    return usePlayer.getState().queue.options.status;
  };
  // Song 33: the owner cleared the rows' authority (they were read for an earlier song).
  assert.notEqual(shown(null, 'stale'), 'ready', 'an earlier song\'s rows are not this song\'s ready queue');
  // Re-opening Kø on the same song keeps the known rows calm while their re-read runs (K1).
  assert.equal(shown('same-song-key', 'stale'), 'ready');
  // A queue choice or a skip moved along the same rows: the song now playing is one of them, so the rows after it
  // are still the queue while it is read again (owner 17/11, the cold-tail recovery journey).
  earlier.unshift({id: 'o30', title: 'Song', uri: p.item.uri, artist: 'Artist', order: 0});
  assert.equal(shown(null, 'stale'), 'ready');
});
