import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {fixtureRequest} from '../../scripts/live-fixture.mjs';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
import {roomPlaybackObservation,roomObservationCurrent} from '../../podvoice/gatekeeper/static/podview/media-observation.js';
import {queueOffer} from '../../podvoice/gatekeeper/static/podview/live-queue-view.js';
const request=(endpoint,body,{method=body?'POST':'GET',headers={'content-type':'application/json','x-podview-request':'1'}}={})=>new Promise((resolve,reject)=>{
 const req=Readable.from(body?[JSON.stringify(body)]:[]);req.url=endpoint;req.method=method;req.headers=headers;
 let text='',status=200;const res={setHeader(){},writeHead(value){status=value;},end(value=''){text+=value;resolve({status,body:text.startsWith('{')?JSON.parse(text):text});}};
 fixtureRequest(req,res).catch(reject);
});
const setup=async room=>{
 const snap=(await request('/view/api/snapshot?room='+room)).body,binding=snap.mediaRoomBindings[0],envelope=(await request(`/view/api/music?room=${room}&kind=playback&account=${binding.accountId}`)).body,playback=roomPlaybackObservation(envelope,binding.accountId,snap);
 return {snap,binding,playback,body:{bootId:snap.bootId,roomId:room,accountId:binding.accountId,targetId:binding.targetId,expectedBindingId:binding.bindingId}};
};
const action=offer=>({bootId:offer.bootId,roomId:offer.roomId,taskId:offer.taskId,revision:offer.revision,requestId:crypto.randomUUID(),optionId:offer.items[0].id});
test('isolated queue fixture exposes only native room-bound read and queue authority, not timer/music controls',async()=>{
 for(const room of ['queue-rejected','queue-unknown','queue-read-error']){
  const {snap,binding,playback}=await setup(room);assert.equal(roomObservationCurrent(playback,snap),true);assert.equal(playback.item.name,'Bevaret fixturesang');assert.equal(playback.state,'paused');assert.equal(playback.progressMs,84000);assert.deepEqual(snap.capabilities.musicRead,['targets','playback','queue']);assert.equal(snap.capabilities.queueSelection,true);assert.deepEqual(snap.capabilities.controlSetup,[]);assert.deepEqual(snap.capabilities.timerActions,[]);assert.deepEqual(snap.capabilities.musicActions,[]);assert.equal(playback.roomBinding.bindingId,binding.bindingId);
  assert.throws(()=>roomPlaybackObservation({...envelopeFor(snap,binding),roomId:'other'},binding.accountId,snap));
 }
 const ordinary=(await request('/view/api/snapshot?room=media')).body;assert.equal(ordinary.capabilities.queueSelection,undefined);assert.equal(ordinary.mediaRoomBindings,undefined);
 assert.equal((await request('/view/?room=queue-rejected')).status,200,'fixture room still serves the existing product index');
});
function envelopeFor(snap,binding){return {ok:true,schema:'podview.room-playback.v1',bootId:snap.bootId,roomId:snap.roomId,configEntryId:binding.accountId,binding,status:'unavailable',data:null};}
test('native offers and rejected/unknown receipts cross the actual transport without provider effect or metadata loss',async()=>{
 for(const room of ['queue-rejected','queue-unknown']){
  const {snap,binding,playback,body}=await setup(room),sent=[];
  const transport=new PodVoiceTransport({url:`http://loopback.invalid/view/?room=${room}`,fetch:async(url,init)=>{sent.push({url:String(url),body:init.body&&JSON.parse(init.body)});const reply=await request(new URL(url).pathname+new URL(url).search,init.body&&JSON.parse(init.body));return {ok:reply.status===200,status:reply.status,json:async()=>reply.body};}});transport.closed=false;transport.connected=true;transport.snapshot=snap;
  try{
   const value=await transport.queueOffer(binding.accountId,binding.targetId,binding.bindingId),offer=queueOffer(value,snap,binding.accountId,binding.targetId,Date.now(),binding.bindingId);assert.ok(offer);assert.equal(offer.expectedBindingId,binding.bindingId);assert.equal(sent[0].body.expectedBindingId,binding.bindingId);assert.equal(queueOffer({...value,expectedBindingId:'f'.repeat(64)},snap,binding.accountId,binding.targetId,Date.now(),binding.bindingId),null);assert.equal(offer.ownerEpoch,playback.owner_epoch);assert.equal(offer.pollSequence,playback.poll_sequence);assert.equal(offer.items.length,2);assert.equal(new Set(offer.items.map(row=>row.id)).size,2);assert.equal(offer.items[0].title,'Bevaret køsang 1');
   const receipt=await transport.queueAction(offer,offer.items[0].id);assert.equal(receipt.outcome,room==='queue-unknown'?'unknown':'rejected');assert.equal(receipt.ok,false);assert.equal(receipt.retryAllowed,false);assert.equal(receipt.physicalResultVerified,false);assert.equal(receipt.requestId,sent[1].body.requestId);assert.equal(sent.length,2);assert.equal(new URL(sent[1].url).search,'','actual native action route binds JSON room instead of inventing a room query');
   const replay=(await request('/view/api/music/queue/actions',sent[1].body)).body;assert.deepEqual(replay,receipt,'same request returns its exact latched receipt');assert.equal((await request('/view/api/music/queue/actions',{...sent[1].body,requestId:crypto.randomUUID()})).status,409,'spent task cannot be repeated under another request');
   const next=queueOffer((await request('/view/api/music/queue/offer',body)).body,snap,binding.accountId,binding.targetId,Date.now(),binding.bindingId);assert.ok(next);assert.notEqual(next.taskId,offer.taskId);assert.ok(next.items.every(row=>!offer.items.some(old=>old.id===row.id)),'new explicit offer has fresh occurrence identities for a fresh failure event');
   const after=await setup(room);assert.equal(after.playback.item.uri,playback.item.uri);assert.equal(after.playback.state,playback.state);assert.equal(after.playback.progressMs,playback.progressMs);assert.deepEqual(next.items.map(row=>[row.order,row.title,row.uri]),offer.items.map(row=>[row.order,row.title,row.uri]));
  }finally{transport.close();}
 }
});
test('queue read error follows one admitted offer and returns503 without replacing retained source rows',async()=>{
 const {snap,binding,playback,body}=await setup('queue-read-error'),first=await request('/view/api/music/queue/offer',body),offer=queueOffer(first.body,snap,binding.accountId,binding.targetId,Date.now(),binding.bindingId);assert.equal(first.status,200);assert.ok(offer);
 const failed=await request('/view/api/music/queue/offer',body);assert.equal(failed.status,503);assert.deepEqual(failed.body,{ok:false,error:'fixture_queue_unavailable',retryAllowed:false});assert.equal(offer.items[0].title,'Bevaret køsang 1');assert.equal(offer.items.length,2);const after=await setup('queue-read-error');assert.equal(after.playback.item.uri,playback.item.uri);assert.equal(after.playback.progressMs,84000);
});
test('fixture rejects wrong scope, extra fields, missing native headers, stale task and forged occurrence before terminal receipt',async()=>{
 const {body}=await setup('queue-rejected');
 for(const change of [{bootId:'other'},{accountId:'other'},{targetId:'other'},{expectedBindingId:'f'.repeat(64)},{expectedBindingId:null},{extra:true}])assert.equal((await request('/view/api/music/queue/offer',{...body,...change})).status,409);
 assert.equal((await request('/view/api/music/queue/offer',{...body,roomId:'media'})).status,409);assert.equal((await request('/view/api/music/queue/offer?room=queue-unknown',body)).status,409);assert.equal((await request('/view/api/music/queue/offer',body,{headers:{'content-type':'application/json'}})).status,400);
 const missing={...body};delete missing.expectedBindingId;assert.equal((await request('/view/api/music/queue/offer',missing)).status,409);
 const offer=(await request('/view/api/music/queue/offer',body)).body,valid=action(offer);
 for(const change of [{bootId:'other'},{roomId:'queue-unknown'},{revision:2},{taskId:'queue:'+'0'.repeat(32)},{optionId:'0'.repeat(24)},{requestId:'a'.repeat(36)},{extra:true}])assert.equal((await request('/view/api/music/queue/actions',{...valid,...change})).status,409,JSON.stringify(change));
 assert.equal((await request('/view/api/music/queue/actions',valid)).body.outcome,'rejected','invalid requests did not consume the valid offer');
});
