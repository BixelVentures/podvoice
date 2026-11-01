import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveMediaView} from '../../podvoice/gatekeeper/static/podview/live-media-view.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function rig(){
 const previous=globalThis.document,node=()=>({hidden:false,setAttribute(){},addEventListener(){},prepend(){},replaceChildren(){}});globalThis.document={createElement:node,getElementById:node};
 let serial=0,binding='a'.repeat(64);const reads=[];
 const host={isConnected:true,state:{focus:'player'},liveSnapshot:{bootId:'boot',roomId:'display',capabilities:{musicRead:['playback','queue'],queueSelection:true},mediaRoomBindings:[]},liveTransport:{connected:true},playerView:{renderPlayer(){},renderControls(){},renderQueue(){}},liveSelection:{pendingPlayer:()=>null}};
 const wire=()=>({ok:true,schema:'podview.room-playback.v2',bootId:'boot',roomId:'display',configEntryId:'account',status:'observed',reason:null,binding:{roomId:'display',accountId:'account',targetId:'actual',nativeRoomId:'actual-room',nativeHomepodId:'2',bindingId:binding,validUntil:Date.now()/1000+10},data:{ok:true,schema:'podconnect.playback.v1',config_entry_id:'account',owner_epoch:'epoch',poll_sequence:2,physical_result_verified:false,observation:{status:'fresh',source:'spotify_web_api',observed_at:new Date().toISOString(),age_ms:0,max_age_ms:15000},playback:{state:'playing',target:{kind:'spotify_device',target_id:'actual',name:'Bridge'},item:{type:'track',uri:'spotify:track:0123456789ABCDEFGHIJKL',name:'Song',artists:['Artist'],duration_ms:60000},progress_ms:1000,provider_changed_at_ms:null,shuffle:false,repeat:'off'}}});
 host.liveTransport.music=async()=>wire();host.liveTransport.queueOffer=async(account,target,expected)=>{reads.push({account,target,expected});return {ok:true,schema:'podview.queue-offer.v1',bootId:'boot',roomId:'display',accountId:account,targetId:target,expectedBindingId:expected,taskId:'queue:'+(++serial).toString(16).padStart(32,'0'),revision:1,expiresInMs:8000,ownerEpoch:'epoch',pollSequence:2,truncated:false,items:[]};};
 const media=new LiveMediaView(host);host.liveMedia=media;media.account='account';
 return {host,media,reads,wire,replaceBinding:()=>binding='b'.repeat(64),async refresh(){await media.refresh({immediate:true});await tick();},close(){media.queueControls.invalidate(true);globalThis.document=previous;}};
}
test('already open player reads queue once when fresh actual playback arrives, and once for replacement binding',async()=>{const f=rig();try{await f.media.loadQueue();assert.equal(f.reads.length,0);await f.refresh();assert.equal(f.reads.length,1);assert.equal(f.media.queueControls.status,'ready');await f.refresh();assert.equal(f.reads.length,1);f.replaceBinding();await f.refresh();assert.equal(f.reads.length,2);assert.equal(f.reads[1].expected,'b'.repeat(64));}finally{f.close();}});
test('explicit player opening already read the queue: unchanged playback does not read again',async()=>{const f=rig();try{f.host.state.focus='now';await f.refresh();assert.equal(f.reads.length,0);f.host.state.focus='player';await f.media.loadQueue();await f.refresh();assert.equal(f.reads.length,1);}finally{f.close();}});
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
 await f.media.loadQueue({automatic:true});await tick();assert.equal(f.reads.length,0);
 }finally{f.close();}});
test('pending selection settling permits one read on the next actual observation, not every poll',async()=>{const f=rig();try{f.host.liveSelection.feedback={pending:true};await f.refresh();assert.equal(f.reads.length,0);f.host.liveSelection.feedback=null;await f.refresh();await f.refresh();assert.equal(f.reads.length,1);}finally{f.close();}});
test('failed automatic queue read does not retry on unchanged polls',async()=>{const f=rig();try{let reads=0;f.host.liveTransport.queueOffer=async()=>{reads++;throw Error('unavailable');};await f.refresh();await f.refresh();assert.equal(reads,1);assert.equal(f.media.queueControls.status,'error');}finally{f.close();}});
test('late queue for replaced actual binding cannot overwrite the new queue',async()=>{const f=rig();let release;try{const source=f.host.liveTransport.queueOffer;let first=true;f.host.liveTransport.queueOffer=async(...args)=>{const reply=await source(...args);if(first){first=false;return new Promise(resolve=>release=()=>resolve(reply));}return reply;};await f.refresh();assert.equal(f.media.queueControls.pending,true);f.replaceBinding();await f.refresh();assert.equal(f.reads.length,2);const accepted=f.media.queueControls.offer;assert.equal(accepted.expectedBindingId,'b'.repeat(64));release();await tick();assert.equal(f.media.queueControls.offer,accepted);}finally{release?.();f.close();}});
for(const terminal of [false,true])test(`same binding readmission after observed unbound state ${terminal?'preserves UNKNOWN command fence':'reads queue once again'}`,async()=>{const f=rig();try{
 await f.refresh();assert.equal(f.reads.length,1);
 if(terminal){f.media.queueControls.consumed=true;f.media.queueControls.status='unknown';}
 f.host.liveTransport.music=async()=>({...f.wire(),status:'account_observed',reason:'route_unavailable',binding:null});
 await f.refresh();assert.equal(f.media.playback.accountObserved,true);assert.equal(f.reads.length,1);
 f.host.liveTransport.music=async()=>f.wire();await f.refresh();await f.refresh();
 assert.equal(f.reads.length,terminal?1:2);
 if(!terminal)assert.equal(f.media.queueControls.status,'ready');
 }finally{f.close();}});

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

test('music and queue diagnostic spans carry their own per-call read contexts without altering playback',async()=>{const f=rig();try{
 let seq=0;const records=[],playbackContexts=[],queueContexts=[],music=f.host.liveTransport.music,queue=f.host.liveTransport.queueOffer;
 f.host.liveTransport.createReadDiagnostic=()=>Object.freeze({seq:++seq});f.host.liveTransport.recordReadDiagnostic=(stage,row,context)=>records.push({stage,row,context});
 f.host.liveTransport.music=async(...args)=>{playbackContexts.push(args[3]?.readDiagnostic);return music(...args);};f.host.liveTransport.queueOffer=async(...args)=>{queueContexts.push(args[3]?.readDiagnostic);return queue(...args);};
 await f.refresh();assert.equal(f.media.playback.item.name,'Song');assert.equal(f.media.queueControls.status,'ready');assert.equal(f.reads.length,1);
 assert.ok(playbackContexts[0]);assert.ok(queueContexts[0]);assert.notEqual(playbackContexts[0],queueContexts[0]);assert.ok(records.filter(r=>r.stage==='music_read').every(r=>r.context===playbackContexts[0]));assert.ok(records.filter(r=>r.stage==='queue_read').every(r=>r.context===queueContexts[0]));
 assert.deepEqual(records.filter(r=>r.stage==='music_read').map(r=>r.row.code),['start','ok']);assert.deepEqual(records.filter(r=>r.stage==='queue_read').map(r=>r.row.code),['start','empty']);
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
 if(fence==='account-only'){const read=f.host.liveTransport.music;f.host.liveTransport.music=async()=>({...await read(),status:'account_observed',reason:'route_unavailable',binding:null});}
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


test('accepted occurrence keeps the queue through the real playback refresh and a transient fresh queue read',async()=>{
 const f=rig();let rejectRead;try{
  const rendered=[];f.host.playerView.renderQueue=items=>rendered.push(items);const source=f.host.liveTransport.queueOffer,selectedUri='spotify:track:'+'9'.repeat(22);let song=null,effects=0,queueReads=0;
  f.host.liveTransport.music=async()=>{const value=f.wire();if(song)value.data.playback.item.uri=song;return value;};
  f.host.liveTransport.queueOffer=async(...args)=>{const value=await source(...args);queueReads++;if(queueReads===2)return new Promise((_,reject)=>rejectRead=reject);return {...value,items:[{id:String(queueReads).padStart(24,'0'),title:'Known queued song',artist:'Artist',uri:selectedUri,artwork:null,order:1}]};};
  f.host.liveTransport.queueAction=async()=>{effects++;song=selectedUri;return {outcome:'accepted'};};
  await f.refresh();const q=f.media.queueControls,shown=q.offer,old=q.model('account',f.media.playback).items[0];
  const choosing=q.choose(old);await tick();assert.equal(f.media.playback.item.uri,selectedUri);assert.equal(queueReads,2,'one new read follows accepted choice even when current track changes');
  let model=q.model('account',f.media.playback);assert.equal(model.items[0].title,old.title);assert.equal(model.items[0].selectable,false);assert.equal(model.status,'loading');assert.equal(rendered.at(-1)[0].title,old.title,'mounted player renderer keeps known rows during the fresh read');await q.choose(old);assert.equal(effects,1);
  rejectRead(Object.assign(Error('temporary'),{code:'read_transient'}));await choosing;model=q.model('account',f.media.playback);assert.equal(model.items[0].id,old.id);assert.equal(model.items[0].selectable,false);assert.equal(model.status,'stale');assert.equal(rendered.at(-1)[0].title,old.title);await q.choose(old);assert.equal(effects,1);
  await f.media.loadQueue();model=q.model('account',f.media.playback);assert.notEqual(q.offer.taskId,shown.taskId);assert.notEqual(model.items[0].id,old.id);assert.equal(model.items[0].selectable,true);assert.equal(effects,1);
  f.host.liveTransport.queueOffer=async(...args)=>({...await source(...args),items:[]});await f.media.loadQueue();assert.deepEqual(q.model('account',f.media.playback).items,[],'fresh authoritative empty may clear the display');assert.equal(effects,1);
 }finally{rejectRead?.(Error('cleanup'));f.close();}
});

test('accepted selection retains known queue rows as inert display until fresh changed-revision metadata arrives',async()=>{
 const f=rig();try{
  const source=f.host.liveTransport.queueOffer,selectedUri='spotify:track:'+'9'.repeat(22),nextUri='spotify:track:'+'8'.repeat(22);let song=null,reads=0,effects=0;const rendered=[];
  f.host.playerView.renderQueue=items=>rendered.push(items);
  f.host.liveTransport.music=async()=>{const value=f.wire();if(song)value.data.playback.item.uri=song;return value;};
  f.host.liveTransport.queueOffer=async(...args)=>{const value=await source(...args);reads++;return {...value,items:[{id:String(reads).padStart(24,'0'),title:reads===2?'Nummer i køen':reads===1?'Actual selected song':'Actual next song',artist:'Artist',uri:reads===1?selectedUri:nextUri,artwork:null,order:1,metadataKnown:reads!==2}]};};
  f.host.liveTransport.queueAction=async()=>{effects++;song=selectedUri;return {outcome:'accepted'};};
  await f.refresh();const q=f.media.queueControls,old=q.model('account',f.media.playback).items[0],oldTask=q.offer.taskId;
  await q.choose(old);let model=q.model('account',f.media.playback);assert.equal(reads,2);assert.equal(model.metadataPending,true);assert.equal(model.status,'stale');assert.equal(model.items[0].title,old.title);assert.equal(model.items[0].id,old.id);assert.equal(model.items[0].selectable,false);assert.equal(rendered.at(-1)[0].title,old.title);assert.equal(q.offer,null);assert.notEqual(q.retained.shownOffer.taskId,oldTask);assert.notEqual(q.retained.shownOffer.items[0].id,old.id);await q.choose(old);assert.equal(effects,1,'retained display cannot borrow fresh task authority');
  await f.media.loadQueue();model=q.model('account',f.media.playback);assert.equal(model.metadataPending,false);assert.equal(model.items[0].title,'Actual next song');assert.equal(model.items[0].uri,nextUri);assert.notEqual(model.items[0].id,old.id);assert.equal(model.items[0].selectable,true);assert.equal(effects,1);
  f.host.liveTransport.queueOffer=async(...args)=>({...await source(...args),items:[]});await f.media.loadQueue();assert.deepEqual(q.model('account',f.media.playback).items,[]);assert.equal(effects,1);
 }finally{f.close();}
});

for(const outcome of ['accepted','unknown','rejected'])test(`playback changes before the queue ${outcome} reply: only accepted may refresh queue metadata`,async()=>{
 const f=rig();let reply;try{
  const source=f.host.liveTransport.queueOffer,selectedUri='spotify:track:'+'9'.repeat(22);let song=null,effects=0;
  f.host.liveTransport.music=async()=>{const value=f.wire();if(song)value.data.playback.item.uri=song;return value;};
  f.host.liveTransport.queueOffer=async(...args)=>{const value=await source(...args);return {...value,items:[{id:String(f.reads.length).padStart(24,'0'),title:'Actual queue song',artist:'Artist',uri:selectedUri,artwork:null,order:1}]};};
  f.host.liveTransport.queueAction=()=>{effects++;return new Promise(resolve=>reply=resolve);};
  await f.refresh();const q=f.media.queueControls,old=q.model('account',f.media.playback).items[0],oldTask=q.offer.taskId,choosing=q.choose(old);await tick();song=selectedUri;await f.refresh();assert.equal(q.model('account',f.media.playback).items[0].selectable,false);assert.equal(f.reads.length,1);reply({outcome});await choosing;
  assert.equal(effects,1);assert.equal(f.reads.length,outcome==='accepted'?2:1);const model=q.model('account',f.media.playback);assert.equal(model.items[0].title,old.title);
  if(outcome==='accepted'){assert.equal(model.items[0].selectable,true);assert.notEqual(q.offer.taskId,oldTask);}else{assert.equal(q.consumed,true);assert.equal(model.items[0].selectable,false);await q.choose(old);await f.refresh();assert.equal(f.reads.length,1);assert.equal(effects,1);}
 }finally{reply?.({outcome:'unknown'});f.close();}
});
