import {boundPlayback} from './room-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveQueueView,queueOffer} from '../../podvoice/gatekeeper/static/podview/live-queue-view.js';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
const offer=()=>({ok:true,schema:'podview.queue-offer.v1',bootId:'boot',roomId:'kitchen',accountId:'account',targetId:'device',expectedBindingId:'a'.repeat(64),taskId:'queue:'+'a'.repeat(32),revision:1,expiresInMs:8000,ownerEpoch:'epoch',pollSequence:4,truncated:false,items:[0,1].map(i=>({id:i.toString(16).padStart(24,'0'),title:'Repeated song',artist:'',uri:'spotify:track:'+'0'.repeat(22),artwork:null,order:i+1}))});
function rig(){let calls=0;const host={isConnected:true,liveSnapshot:{bootId:'boot',roomId:'kitchen',voice:{sessionId:'s'},capabilities:{queueSelection:true,musicRead:['queue']}},liveTransport:{connected:true,queueOffer:async()=>offer(),queueAction:async()=>{calls++;return {outcome:'unknown'};}},liveMedia:{account:'account',playback:{owner_epoch:'epoch',poll_sequence:4,target:{id:'device'},expiresAt:Date.now()+15000},renderQueue(){},refresh:async()=>{}}};host.liveMedia.playback=boundPlayback(host.liveSnapshot,host.liveMedia.playback);const view=new LiveQueueView(host);return {host,view,calls:()=>calls};}
test('closed native offer preserves repeated URI identities and rejects forged account/extra metadata',()=>{const value=offer(),snapshot={bootId:'boot',roomId:'kitchen'};assert.equal(queueOffer(value,snapshot,'account','device',Date.now(),'a'.repeat(64)).items.length,2);assert.equal(queueOffer({...value,accountId:'other'},snapshot,'account','device',Date.now(),'a'.repeat(64)),null);assert.equal(queueOffer({...value,taskAuthority:true},snapshot,'account','device',Date.now(),'a'.repeat(64)),null);assert.equal(queueOffer({...value,items:[value.items[0],value.items[0]]},snapshot,'account','device',Date.now(),'a'.repeat(64)),null);});
test('unknown command consumes occurrence and never replays or automatically requests another offer',async()=>{const {host,view,calls}=rig();let reads=0;host.liveTransport.queueOffer=async()=>{reads++;return offer();};await view.load('account',host.liveMedia.playback);assert(view.model('account',host.liveMedia.playback).items[1].selectable);await view.choose(offer().items[1]);await view.choose(offer().items[0]);assert.equal(calls(),1);assert.equal(reads,1,'one shown read; broker resolution needs no client refresh or retry');assert.equal(view.status,'unknown');assert(view.model('account',host.liveMedia.playback).items.every(x=>x.selectable&&x.renewUnknown));view.invalidate(true);});
test('owner, target and capability changes disable the existing offer',async()=>{for(const mutate of [h=>h.liveMedia.playback.owner_epoch='changed',h=>h.liveMedia.playback.target.id='other',h=>h.liveSnapshot.capabilities.queueSelection=false]){const {host,view,calls}=rig();await view.load('account',host.liveMedia.playback);mutate(host);await view.choose(offer().items[0]);assert.equal(calls(),0);view.invalidate(true);}});
test('inflight stale account completion discarded and cancellation retains no authority',async()=>{const {host,view}=rig();let finish;host.liveTransport.queueOffer=()=>new Promise(resolve=>finish=resolve);const pending=view.load('account',host.liveMedia.playback);host.liveMedia.account='other';finish(offer());assert.equal(await pending,false);assert.equal(view.offer,null);view.invalidate(true);});
test('queued expiry does not erase pending mutation feedback',async()=>{const original=globalThis.setTimeout;let timer;globalThis.setTimeout=fn=>{timer=fn;return 1;};try{const {host,view}=rig();await view.load('account',host.liveMedia.playback);let finish;host.liveTransport.queueAction=()=>new Promise(resolve=>finish=resolve);const mutation=view.choose(offer().items[1]);await new Promise(resolve=>setImmediate(resolve));timer();assert.equal(view.status,'pending');assert.equal(view.offer,null);finish({outcome:'unknown'});await mutation;assert.equal(view.status,'unknown');view.invalidate(true);}finally{globalThis.setTimeout=original;}});
test('same-origin authenticated queue transport sends only server task and opaque occurrence once',async()=>{const sent=[];const transport=new PodVoiceTransport({url:'https://home.invalid/api/ingress/secret/view/',fetch:async(url,init)=>{sent.push({url:String(url),init});const body=JSON.parse(init.body);return {ok:true,json:async()=>body.optionId?{ok:true,requestId:body.requestId,outcome:'accepted',retryAllowed:false,physicalResultVerified:false}:offer()};}});transport.connected=true;transport.snapshot={bootId:'boot',roomId:'kitchen',capabilities:{queueSelection:true,musicRead:['queue']}};await transport.queueOffer('account','device','a'.repeat(64));const result=await transport.queueAction(offer(),offer().items[1].id);assert.equal(result.outcome,'accepted');assert.equal(sent.length,2);const action=JSON.parse(sent[1].init.body);assert.deepEqual(Object.keys(action).sort(),['bootId','optionId','requestId','revision','roomId','taskId']);assert.equal(action.optionId,offer().items[1].id);assert.equal(sent[1].init.credentials,'same-origin');assert.equal(sent[1].init.headers['X-PodView-Request'],'1');assert(sent[1].url.startsWith('https://home.invalid/api/ingress/secret/view/api/'));});

test('user initiated failed queue read emits one existing toast event while passive failure stays quiet and redraw never repeats it',async()=>{const {host,view}=rig(),events=[];host.showFeedback=(...args)=>events.push(args);host.liveTransport.queueOffer=async()=>{throw Error('network');};await view.load('account',host.liveMedia.playback);assert.deepEqual(events,[]);await view.load('account',host.liveMedia.playback,{notify:true});assert.equal(view.status,'error');assert.equal(events.length,2);assert.deepEqual(events[0],['',false,{source:'queue'}]);assert.equal(events[1][2].source,'queue');assert.equal(events.filter(([message])=>message).length,1);view.redraw();view.redraw();assert.equal(events.length,2);assert.equal(view.offer,null);view.invalidate(true);});
for(const outcome of ['rejected','unknown','thrown'])test(`failed queue choice ${outcome} emits one truthful existing toast and cannot repeat effect`,async()=>{const {host,view}=rig(),events=[];let effects=0;host.showFeedback=(...args)=>events.push(args);host.liveTransport.queueAction=async()=>{effects++;if(outcome==='thrown')throw Error('network');return {outcome};};await view.load('account',host.liveMedia.playback);await view.choose(offer().items[0]);await view.choose(offer().items[0]);view.redraw();assert.equal(effects,1);assert.equal(events.length,2);assert.deepEqual(events[0],['',false,{source:'queue'}]);assert.equal(events.filter(([message])=>message).length,1);assert.match(events[1][0],outcome==='rejected'?/afvist/:/ikke bekræftes/);assert.equal(events[1][2].source,'queue');assert.equal(view.offer,null);view.invalidate(true);});

for(const index of [0,1])test(`broker resolution receives the shown repeated URI occurrence ${index+1} with its original opaque identity`,async()=>{
 const {host,view}=rig(),sent=[];let reads=0;host.liveTransport.queueOffer=async()=>{const value=offer();value.taskId='queue:'+(++reads).toString(16).padStart(32,'0');value.items=value.items.map((row,i)=>({...row,id:(reads*10+i).toString(16).padStart(24,'0')}));return value;};host.liveTransport.queueAction=async(task,id)=>{sent.push({task,id});return {outcome:'unknown'};};
 try{await view.load('account',host.liveMedia.playback);const visible=view.offer.items[index],oldTask=view.offer.taskId;await view.choose(visible);assert.equal(reads,1);assert.equal(sent.length,1);assert.equal(sent[0].task.taskId,oldTask);assert.equal(sent[0].id,sent[0].task.items[index].id);assert.equal(sent[0].id,visible.id);assert.equal(sent[0].task.items[index].uri,visible.uri);}finally{view.invalidate(true);}
});
test('broker rejection of a changed ordered URI sequence cannot trigger client occurrence replacement',async()=>{
 for(const changed of ['length','uri','order']){const {host,view,calls}=rig();try{
  const initial=()=>{const value=offer();value.items.push({...value.items[0],id:'f'.repeat(24),uri:'spotify:track:'+'1'.repeat(22),order:3});return value;};host.liveTransport.queueOffer=async()=>initial();await view.load('account',host.liveMedia.playback);const shown=view.offer,selected=shown.items[1];
  host.liveTransport.queueOffer=async()=>{const value=initial();if(changed==='length')value.items.pop();else if(changed==='uri')value.items[0].uri='spotify:track:'+'2'.repeat(22);else value.items=[value.items[2],value.items[1],value.items[0]].map((row,index)=>({...row,order:index+1}));return value;};const posts=[];host.liveTransport.queueAction=async(task,id)=>{posts.push({task,id});return {outcome:'rejected'};};await view.choose(selected);assert.equal(posts.length,1);assert.equal(posts[0].task,shown);assert.equal(posts[0].id,selected.id);assert.equal(calls(),0);/* Green 13/11: a refusal is a toast, never a standing queue error. */assert.equal(view.status,'ready');assert.equal(view.errorKind,null);
 }finally{view.invalidate(true);}}
});

function autoplayOffer(queueKind='preview'){
 const value={...offer(),queueKind};
 value.items=value.items.map((row,index)=>({...row,displayId:'display-'+String(index+1).repeat(24)}));
 if(queueKind==='promotion'){
  value.taskId='queue:'+'b'.repeat(32);
  value.items=value.items.map((row,index)=>({...row,id:String(index+3).repeat(24)}));
 }
 return value;
}

test('autoplay offer accepts mapped preview and partial promotion, never malformed display identity',()=>{
 const snapshot={bootId:'boot',roomId:'kitchen'};
 const parse=value=>queueOffer(value,snapshot,'account','device',Date.now(),'a'.repeat(64));
 const preview=autoplayOffer(),promotion=autoplayOffer('promotion');
 delete promotion.items[1].displayId;
 assert.equal(parse(preview).items[1].displayId,preview.items[1].displayId);
 assert.equal(parse(promotion).items[0].id,promotion.items[0].id);
 assert.equal(parse(promotion).items[1].displayId,undefined);
 const invalid=[
  {...preview,queueKind:'unknown'},
  {...offer(),items:preview.items},
  {...preview,items:[preview.items[0],{...preview.items[1],displayId:preview.items[0].displayId}]},
  {...preview,items:[preview.items[0],offer().items[1]]},
  {...preview,items:[{...preview.items[0],displayId:'display-no'},preview.items[1]]},
  {...preview,items:[{...preview.items[0],id:preview.items[0].displayId},preview.items[1]]},
  {...offer(),queueKind:'promotion'},
 ];
 for(const value of invalid)assert.equal(parse(value),null);
});

test('preview remains visible through transient failure but promotion requires the fresh opaque witness',async()=>{
 const {host,view}=rig(),p=host.liveMedia.playback,sent=[];
 try{
  host.liveTransport.queueOffer=async()=>autoplayOffer();
  assert.equal(await view.load('account',p),true);
  const old=view.model('account',p).items[1];
  assert.equal(old.selectable,true);
  host.liveTransport.queueOffer=async()=>{
   throw Object.assign(Error('temporary'),{code:'read_transient'});
  };
  assert.equal(await view.load('account',p),false);
  const retained=view.model('account',p).items[1];
  assert.equal(retained.displayId,old.displayId);
  assert.equal(retained.title,old.title);
  assert.equal(retained.selectable,false);
  host.liveTransport.queueAction=async(task,id)=>{sent.push([task.taskId,id]);return {outcome:'unknown'};};
  await view.choose(old);
  assert.deepEqual(sent,[]);
  const promotion=autoplayOffer('promotion');
  host.liveTransport.queueOffer=async()=>promotion;
  assert.equal(await view.load('account',p),true);
  const next=view.model('account',p).items[1];
  assert.equal(next.displayId,old.displayId);
  assert.notEqual(next.id,old.id);
  await view.choose(old);
  await view.choose({...next,id:next.displayId});
  assert.deepEqual(sent,[]);
  await view.choose(next);
  assert.deepEqual(sent,[[promotion.taskId,promotion.items[1].id]]);
 }finally{view.invalidate(true);}
});

test('a second preview tap waits locally and cannot carry over to the promotion witness',async()=>{
 const {host,view}=rig(),p=host.liveMedia.playback,sent=[];
 let finish,reads=0;
 try{
  host.liveTransport.queueOffer=async()=>autoplayOffer(reads++?'promotion':'preview');
  host.liveTransport.queueAction=(task,id)=>{
   sent.push([task.queueKind,id]);
   return new Promise(resolve=>{finish=resolve;});
  };
  await view.load('account',p);
  const shown=view.model('account',p).items;
  const choosing=view.choose(shown[0]);
  await view.choose(shown[1]);
  assert.equal(view.model('account',p).items[1].pending,true);
  assert.deepEqual(sent,[['preview',shown[0].id]]);
  finish({outcome:'accepted'});
  await choosing;
  assert.equal(reads,2,'the existing post-action refresh is the only additional read');
  assert.deepEqual(sent,[['preview',shown[0].id]]);
  const promoted=view.model('account',p).items[1];
  assert.equal(promoted.displayId,shown[1].displayId);
  assert.equal(promoted.selectable,true);
 }finally{finish?.({outcome:'rejected'});view.invalidate(true);}
});

test('revoked autoplay authority cannot revive the retained row after read access returns',async()=>{
 const {host,view,calls}=rig(),p=host.liveMedia.playback;
 try{
  host.liveTransport.queueOffer=async()=>autoplayOffer();
  await view.load('account',p);
  const first=view.model('account',p).items[0];
  host.liveSnapshot.capabilities.queueSelection=false;
  assert.equal(view.model('account',p).items[0].selectable,false);
  host.liveSnapshot.capabilities.queueSelection=true;
  const retained=view.model('account',p).items[0];
  assert.equal(retained.displayId,first.displayId);
  assert.equal(retained.selectable,false);
  await view.choose(first);
  assert.equal(calls(),0);
 }finally{view.invalidate(true);}
});

test('transport never posts a display identifier, including a malformed offer that repeats it as an id',async()=>{
 const transport=new PodVoiceTransport({url:'https://home.invalid/view/',fetch:async()=>assert.fail('POST')});
 const value=autoplayOffer(),displayId=value.items[0].displayId;
 value.items[0].id=displayId;
 transport.connected=true;
 transport.snapshot={bootId:'boot',roomId:'kitchen',capabilities:{queueSelection:true}};
 try{
  assert.equal((await transport.queueAction(value,displayId)).outcome,'rejected');
 }finally{transport.close();}
});
