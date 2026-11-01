import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveQueueView} from '../../podvoice/gatekeeper/static/podview/live-queue-view.js';
import {NotificationQueue} from '../../podvoice/gatekeeper/static/podview/ui/notification-queue.js';
import {boundPlayback} from './room-fixture.mjs';

function fixture(){
 let serial=0,clock=0;const timers=new Map(),renders=[],actions=[],reads=[];
 const notifications=new NotificationQueue(item=>renders.push(item),{setTimer(callback){const id=++clock;timers.set(id,callback);return id;},clearTimer:id=>timers.delete(id)});
 const host={isConnected:true,liveSnapshot:{bootId:'boot',roomId:'kitchen',voice:{sessionId:'session'},capabilities:{queueSelection:true,musicRead:['queue']}},liveTransport:{connected:true},liveMedia:{account:'account',renderQueue(){},refresh:async()=>{}},showFeedback(message,pending,options){notifications.update(options.source,message,{pending});}};
 host.liveMedia.playback=boundPlayback(host.liveSnapshot,{owner_epoch:'epoch',poll_sequence:4,target:{id:'device'},expiresAt:Date.now()+15000});
 host.liveTransport.queueOffer=async()=>{const offer={ok:true,schema:'podview.queue-offer.v1',bootId:'boot',roomId:'kitchen',accountId:'account',targetId:'device',expectedBindingId:'a'.repeat(64),taskId:'queue:'+(++serial).toString(16).padStart(32,'0'),revision:1,expiresInMs:8000,ownerEpoch:'epoch',pollSequence:4,truncated:false,items:[{id:serial.toString(16).padStart(24,'0'),title:'Known queued song',artist:'Artist',uri:'spotify:track:'+'0'.repeat(22),artwork:null,order:1}]};reads.push(offer);return offer;};
 host.liveTransport.queueAction=async(offer,id)=>{actions.push({taskId:offer.taskId,id});return {outcome:'unknown'};};
 const view=new LiveQueueView(host);return {host,view,notifications,renders,actions,reads,close(){view.invalidate(true);notifications.cleanup();}};
}

for(const outcome of ['unknown','rejected','thrown'])test(`a fresh server-issued queue choice can show the same ${outcome} failure after the prior toast is dismissed`,async()=>{
 const f=fixture();try{
  const action=f.host.liveTransport.queueAction;f.host.liveTransport.queueAction=async(...args)=>{await action(...args);if(outcome==='thrown')throw Error('network');return {outcome};};
  await f.view.load('account',f.host.liveMedia.playback);const first=f.view.offer;await f.view.choose(first.items[0]);const message=f.notifications.current.message;assert.match(message,outcome==='rejected'?/afvist/:/ikke bekræftes/);assert.equal(f.actions.length,1);f.notifications.dismiss();assert.equal(f.notifications.current,null);
  const quiet=f.renders.length;f.view.redraw();f.view.model('account',f.host.liveMedia.playback);await f.view.choose(first.items[0]);assert.equal(f.renders.length,quiet);assert.equal(f.actions.length,1,'dismissal never unconsumes the previous task');
  await f.view.load('account',f.host.liveMedia.playback);const second=f.view.offer;assert.notEqual(second.taskId,first.taskId);assert.notEqual(second.items[0].id,first.items[0].id);await f.view.choose(second.items[0]);assert.equal(f.actions.length,2);assert.equal(f.notifications.current?.message,message,'new explicit owner operation must produce its own truthful outcome');assert.equal(f.renders.filter(item=>item?.message===message).length,2);await f.view.choose(second.items[0]);assert.equal(f.actions.length,2,'the second offer is still consumed exactly once');
 }finally{f.close();}
});

test('only a fresh explicit notified queue read rearms its own failure, not passive reads or unrelated notices',async()=>{
 const f=fixture();try{
  let reads=0;f.host.liveTransport.queueOffer=async()=>{reads++;throw Error('network');};
  await f.view.load('account',f.host.liveMedia.playback,{notify:true});const message=f.notifications.current.message;f.notifications.dismiss();const quiet=f.renders.length;await f.view.load('account',f.host.liveMedia.playback);f.view.redraw();assert.equal(f.renders.length,quiet);assert.equal(f.notifications.current,null);
  f.notifications.update('connection','Offline',{priority:true});await f.view.load('account',f.host.liveMedia.playback,{notify:true});assert.equal(reads,3);assert.equal(f.notifications.current.source,'connection');assert.equal(f.notifications.pending.length,1);f.notifications.dismiss();assert.equal(f.notifications.current?.message,message);assert.equal(f.renders.filter(item=>item?.message===message).length,2);
  const visible=f.notifications.current;f.host.liveSnapshot.capabilities.queueSelection=false;await f.view.load('account',f.host.liveMedia.playback,{notify:true});assert.equal(f.notifications.current,visible,'an unoffered read cannot clear the actual queue notice');assert.equal(reads,3);
 }finally{f.close();}
});

function actualQueueOutput(f){
 const p=f.host.liveMedia.playback;f.host.liveSnapshot.capabilities.musicRead=['playback','queue'];
 const binding={roomId:'kitchen',accountId:'account',targetId:'actual-device',nativeRoomId:'actual-room',nativeHomepodId:'77',bindingId:'c'.repeat(64),validUntil:Date.now()/1000+15};
 Object.assign(p,{projectionVersion:2,observationStatus:'observed',roomBound:true,readOnly:false,target:{id:binding.targetId},roomBinding:binding});return binding;
}
test('queue read uses actual non-default binding and target; an offer cannot silently echo the configured default',async()=>{
 const f=fixture();try{
  const configured=structuredClone(f.host.liveSnapshot.mediaRoomBindings),binding=actualQueueOutput(f),read=f.host.liveTransport.queueOffer,requests=[];
  f.host.liveTransport.queueOffer=async(...args)=>{requests.push(args);return {...await read(),targetId:binding.targetId,expectedBindingId:binding.bindingId};};
  assert.equal(await f.view.load('account',f.host.liveMedia.playback),true);assert.deepEqual(requests,[['account','actual-device',binding.bindingId]]);assert.equal(f.view.offer.expectedBindingId,binding.bindingId);assert.equal(f.view.model('account',f.host.liveMedia.playback).items[0].selectable,true);
  f.host.liveTransport.queueOffer=async()=>({...await read(),targetId:binding.targetId});assert.equal(await f.view.load('account',f.host.liveMedia.playback),false);assert.equal(f.view.offer,null);assert.deepEqual(f.host.liveSnapshot.mediaRoomBindings,configured);assert.equal(f.actions.length,0);
 }finally{f.close();}
});
test('queue metadata without actual route, expired binding and late binding replacement never admit an offer',async()=>{
 for(const change of ['account','expired','replacement']){const f=fixture();try{
  const binding=actualQueueOutput(f),read=f.host.liveTransport.queueOffer;
  if(change==='account')Object.assign(f.host.liveMedia.playback,{observationStatus:'account_observed',accountObserved:true,roomBound:false,readOnly:true,roomBinding:null});
  if(change==='expired')binding.validUntil=Date.now()/1000-1;
  if(change!=='replacement'){assert.equal(await f.view.load('account',f.host.liveMedia.playback),false);assert.equal(f.reads.length,0);}
  else{let finish;f.host.liveTransport.queueOffer=()=>new Promise(resolve=>finish=resolve);const waiting=f.view.load('account',f.host.liveMedia.playback);f.host.liveMedia.playback={...f.host.liveMedia.playback,roomBinding:{...binding,bindingId:'d'.repeat(64)}};finish({...await read(),targetId:binding.targetId,expectedBindingId:binding.bindingId});assert.equal(await waiting,false);}
  assert.equal(f.view.offer,null);assert.equal(f.actions.length,0);
 }finally{f.close();}}
});

test('a foreign account parameter cannot borrow an otherwise current actual output for a queue read',async()=>{
 const f=fixture();try{actualQueueOutput(f);assert.equal(await f.view.load('foreign-account',f.host.liveMedia.playback),false);assert.equal(f.reads.length,0);assert.equal(f.actions.length,0);}finally{f.close();}
});

test('late accepted refresh for source A cannot clear or duplicate the pending queue read for replacement B',async()=>{
 const f=fixture();let finishRefresh,finishB,enteredRefresh;
 const refreshStarted=new Promise(resolve=>enteredRefresh=resolve);
 try{
  const a=actualQueueOutput(f),read=f.host.liveTransport.queueOffer;
  f.host.liveTransport.queueOffer=async()=>({...await read(),targetId:a.targetId,expectedBindingId:a.bindingId});
  await f.view.load('account',f.host.liveMedia.playback);const first=f.view.offer;
  f.host.liveTransport.queueAction=async()=>({outcome:'accepted'});
  f.host.liveMedia.refresh=()=>{enteredRefresh();return new Promise(resolve=>finishRefresh=resolve);};
  const choosing=f.view.choose(first.items[0]);await refreshStarted;
  const b={...a,bindingId:'d'.repeat(64),targetId:'replacement-device'};
  f.host.liveMedia.playback={...f.host.liveMedia.playback,target:{id:b.targetId},roomBinding:b};f.view.invalidate();
  let readsB=0;f.host.liveTransport.queueOffer=()=>{readsB++;return new Promise(resolve=>finishB=resolve);};
  const loadingB=f.view.load('account',f.host.liveMedia.playback),generationB=f.view.generation;
  assert.equal(f.view.pending,true);finishRefresh();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(readsB,1,'old accepted continuation must not request a second B offer');assert.equal(f.view.generation,generationB);assert.equal(f.view.pending,true,'B retains its pending ownership');await choosing;
  const offerB={...await read(),targetId:b.targetId,expectedBindingId:b.bindingId};finishB(offerB);assert.equal(await loadingB,true);assert.equal(f.view.offer.taskId,offerB.taskId);assert.equal(f.view.pending,false);
 }finally{finishRefresh?.();f.close();}
});

test('accepted queue choice with unchanged source still refreshes and obtains one fresh offer',async()=>{
 const f=fixture();try{
  let refreshes=0;f.host.liveTransport.queueAction=async()=>({outcome:'accepted'});f.host.liveMedia.refresh=async()=>{refreshes++;};
  await f.view.load('account',f.host.liveMedia.playback);const first=f.view.offer;await f.view.choose(first.items[0]);
  assert.equal(refreshes,1);assert.equal(f.reads.length,2,'shown read + post-accepted read; broker owns click-time resolution');assert.notEqual(f.view.offer.taskId,first.taskId);assert.equal(f.view.status,'ready');assert.equal(f.view.pending,false);
 }finally{f.close();}
});

test('queue rows remain on same track transient error, but never survive an observed track switch or resurrect when it switches back',async()=>{
 const f=fixture();try{
  const a='spotify:track:'+'a'.repeat(22),b='spotify:track:'+'b'.repeat(22),p=f.host.liveMedia.playback;p.item={uri:a};await f.view.load('account',p);const first=f.view.model('account',p).items;assert.equal(first.length,1);
  f.host.liveTransport.queueOffer=async()=>{throw Object.assign(Error('temporary'),{code:'read_transient'});};await f.view.load('account',p);assert.equal(f.view.model('account',p).items[0].id,first[0].id);
  f.host.liveMedia.playback={...p,item:{uri:b}};assert.equal(f.view.model('account',f.host.liveMedia.playback),null);assert.equal(f.view.retained,null);assert.equal(f.view.offer,null);
  f.host.liveMedia.playback={...p,item:{uri:a}};assert.equal(f.view.model('account',f.host.liveMedia.playback),null);assert.equal(f.actions.length,0);
 }finally{f.close();}
});

test('confirmed empty queue removes old rows without deduplicating valid repeated URIs',async()=>{
 const f=fixture();try{const read=f.host.liveTransport.queueOffer;f.host.liveMedia.playback.item={uri:'spotify:track:'+'a'.repeat(22)};
  f.host.liveTransport.queueOffer=async()=>{const value=await read();value.items.push({...value.items[0],id:'b'.repeat(24),order:2});return value;};await f.view.load('account',f.host.liveMedia.playback);assert.equal(f.view.model('account',f.host.liveMedia.playback).items.length,2);
  f.host.liveTransport.queueOffer=async()=>({...await read(),items:[]});await f.view.load('account',f.host.liveMedia.playback);assert.deepEqual(f.view.model('account',f.host.liveMedia.playback).items,[]);assert.equal(f.actions.length,0);
 }finally{f.close();}
});

test('voice or answer revision change retains known queue as stale display but revokes old occurrence authority',async()=>{
 const f=fixture();try{const p=f.host.liveMedia.playback;p.item={uri:'spotify:track:'+'a'.repeat(22)};await f.view.load('account',p);const old=f.view.model('account',p).items[0];assert.equal(old.selectable,true);
  f.host.liveSnapshot.voice={sessionId:'next'};const changed=f.view.model('account',p);assert.equal(changed.items[0].title,old.title);assert.equal(changed.items[0].selectable,false);assert.equal(changed.status,'stale');await f.view.choose(old);assert.equal(f.actions.length,0);
  f.host.liveSnapshot.voice={sessionId:'session'};assert.equal(f.view.model('account',p).items[0].selectable,false,'returning to an old voice scope never resurrects a revoked occurrence');f.host.liveSnapshot.answers={taskId:'new',inputRevision:2,revision:2};assert.equal(f.view.model('account',p).items[0].selectable,false);await f.view.choose(old);assert.equal(f.actions.length,0);
 }finally{f.close();}
});

test('incomplete queue metadata cannot overwrite known rows or fabricate replacement',async()=>{
 const f=fixture();try{const p=f.host.liveMedia.playback;p.item={uri:'spotify:track:'+'a'.repeat(22)};await f.view.load('account',p);const known=f.view.model('account',p).items[0],read=f.host.liveTransport.queueOffer;
  f.host.liveTransport.queueOffer=async()=>{const value=await read();value.items[0].title='';return value;};assert.equal(await f.view.load('account',p),false);const retained=f.view.model('account',p);assert.equal(retained.items[0].id,known.id);assert.equal(retained.items[0].title,known.title);assert.equal(retained.status,'error');assert.equal(f.actions.length,0);
 }finally{f.close();}
});

test('queue metadataKnown is closed, legacy true, and unknown rows are not an empty queue',async()=>{
 const f=fixture();try{const p=f.host.liveMedia.playback,read=f.host.liveTransport.queueOffer;p.item={uri:'spotify:track:'+'a'.repeat(22)};
  f.host.liveTransport.queueOffer=async()=>{const x=await read();x.items[0].metadataKnown=false;x.items[0].title='Nummer i køen';return x;};assert.equal(await f.view.load('account',p),true);let state=f.view.model('account',p);assert.equal(state.metadataPending,true);assert.deepEqual(state.items,[]);assert.equal(state.status,'stale');assert.equal(f.actions.length,0);
  f.host.liveTransport.queueOffer=async()=>{const x=await read();x.items[0].metadataKnown='false';return x;};assert.equal(await f.view.load('account',p),false);assert.equal(f.view.model('account',p).metadataPending,true);
  f.host.liveTransport.queueOffer=async()=>({...await read(),items:[]});assert.equal(await f.view.load('account',p),true);state=f.view.model('account',p);assert.equal(state.metadataPending,false);assert.deepEqual(state.items,[]);assert.equal(state.status,'ready');
 }finally{f.close();}
});

test('rotating occurrence IDs reuse only same URI metadata while retaining the new action identity',async()=>{
 const f=fixture();try{const p=f.host.liveMedia.playback,read=f.host.liveTransport.queueOffer;p.item={uri:'spotify:track:'+'a'.repeat(22)};
  await f.view.load('account',p);const original=f.view.model('account',p).items[0];f.host.liveTransport.queueOffer=async()=>{const x=await read();x.items[0]={...x.items[0],id:original.id,uri:original.uri,title:'Nummer i køen',artist:'',metadataKnown:false};return x;};assert.equal(await f.view.load('account',p),true);let state=f.view.model('account',p);assert.equal(state.items[0].title,original.title);assert.equal(state.items[0].artist,original.artist);assert.equal(state.metadataPending,false);
  f.host.liveTransport.queueOffer=async()=>{const x=await read();x.items[0]={...x.items[0],id:'f'.repeat(24),uri:original.uri,title:'Nummer i køen',metadataKnown:false};return x;};assert.equal(await f.view.load('account',p),true);state=f.view.model('account',p);assert.equal(state.items[0].id,'f'.repeat(24));assert.equal(state.items[0].title,original.title);assert.equal(f.view.offer.items[0].id,'f'.repeat(24));assert.equal(state.metadataPending,false);const sent=[];f.host.liveTransport.queueAction=async(offer,id)=>{sent.push({taskId:offer.taskId,id});return {outcome:'rejected'};};const selected=state.items[0],currentTask=f.view.offer.taskId;await f.view.choose(selected);assert.equal(sent.length,1);assert.equal(sent[0].taskId,currentTask,'action uses the fresh offer');assert.equal(sent[0].id,'f'.repeat(24),'action uses current offer occurrence, never the metadata donor id');f.host.liveTransport.queueOffer=async()=>{const x=await read();x.items[0]={...x.items[0],uri:'spotify:track:'+'z'.repeat(22),title:'Nummer i køen',metadataKnown:false};return x;};assert.equal(await f.view.load('account',p),true);state=f.view.model('account',p);assert.deepEqual(state.items,[]);assert.equal(state.metadataPending,true);assert.equal(f.actions.length,0);
 }finally{f.close();}
});

test('duplicate queue occurrences use real metadata but retain each new id and order',async()=>{
 const f=fixture();try{const p=f.host.liveMedia.playback,read=f.host.liveTransport.queueOffer;p.item={uri:'spotify:track:'+'a'.repeat(22)};
  f.host.liveTransport.queueOffer=async()=>{const x=await read();x.items.push({...x.items[0],id:'b'.repeat(24),order:2,title:'Nummer i køen',metadataKnown:false});return x;};assert.equal(await f.view.load('account',p),true);const state=f.view.model('account',p);assert.equal(state.items.length,2);assert.equal(state.items[1].title,state.items[0].title);assert.notEqual(state.items[0].id,state.items[1].id);assert.deepEqual(state.items.map(x=>x.order),[1,2]);assert.deepEqual(f.view.offer.items.map(x=>x.id),state.items.map(x=>x.id));assert.equal(f.actions.length,0);
 }finally{f.close();}
});

test('queue metadata is never borrowed across a current song or owner scope change',async()=>{
 for(const change of ['song','owner']){const f=fixture();try{let p=f.host.liveMedia.playback;const read=f.host.liveTransport.queueOffer;p.item={uri:'spotify:track:'+'a'.repeat(22)};await f.view.load('account',p);const old=f.view.model('account',p).items[0];p=f.host.liveMedia.playback=change==='song'?{...p,item:{uri:'spotify:track:'+'b'.repeat(22)}}:{...p,owner_epoch:'new-epoch'};f.host.liveTransport.queueOffer=async()=>{const x=await read();x.ownerEpoch=p.owner_epoch;x.items[0]={...x.items[0],uri:old.uri,title:'Nummer i køen',metadataKnown:false};return x;};assert.equal(await f.view.load('account',p),true);const state=f.view.model('account',p);assert.deepEqual(state.items,[]);assert.equal(state.metadataPending,true);assert.equal(f.actions.length,0);}finally{f.close();}}
});

test('conflicting metadata for same URI is never guessed for an unknown occurrence',async()=>{
 const f=fixture();try{const p=f.host.liveMedia.playback,read=f.host.liveTransport.queueOffer;p.item={uri:'spotify:track:'+'a'.repeat(22)};f.host.liveTransport.queueOffer=async()=>{const x=await read();x.items.push({...x.items[0],id:'b'.repeat(24),order:2,title:'Different actual title'});return x;};await f.view.load('account',p);f.host.liveTransport.queueOffer=async()=>{const x=await read();x.items[0].metadataKnown=false;x.items[0].title='Nummer i køen';return x;};await f.view.load('account',p);const state=f.view.model('account',p);assert.equal(state.metadataPending,true);assert.deepEqual(state.items,[]);assert.equal(f.actions.length,0);}finally{f.close();}
});
