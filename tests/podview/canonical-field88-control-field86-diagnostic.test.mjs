import {PlayerView} from '../../podvoice/gatekeeper/static/podview/player-view.js';
import {SpeakerOutputView} from '../../podvoice/gatekeeper/static/podview/speaker-output-view.js';
import {boundPlayback} from './room-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveControlView} from '../../podvoice/gatekeeper/static/podview/live-control-view.js';
class Node extends EventTarget{constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.isConnected=true;this.open=false;this.dataset={};this.textContent='';}append(...nodes){this.children.push(...nodes);}after(node){this.sibling=node;}setAttribute(name,value){this.attributes??={};this.attributes[name]=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}getAttribute(name){return this.attributes?.[name]??null;}replaceChildren(...nodes){this.children=nodes;}querySelector(){return null;}querySelectorAll(){return [];}focus(){}showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const observed=()=>({config_entry_id:'account',owner_epoch:'epoch',poll_sequence:1,expiresAt:Date.now()+15000,state:'playing',item:{uri:'spotify:track:0123456789ABCDEFGHIJKL'},target:{id:'device'}});
function fixture(){const previous=globalThis.document,nodes=new Map(),selectors=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,new Node('div'));return nodes.get(id);};globalThis.document={createElement:tag=>new Node(tag),getElementById:node,querySelector:selector=>selectors.get(selector)||null};const host=new Node('host');host.state={devices:[{id:'vacuum.actual',kind:'vacuum',live:true,stale:false,status:'cleaning'}]};host.liveMedia={playback:observed()};host.liveSnapshot={bootId:'boot',roomId:'room',capabilities:{controlSetup:['music']}};host.liveMedia.playback=boundPlayback(host.liveSnapshot,host.liveMedia.playback);host.querySelector=selector=>{if(!selectors.has(selector))selectors.set(selector,new Node('div'));return selectors.get(selector);};let reads=0;const writes=[];const offer=(options=['pause','resume','next','previous','volume'],volume=20)=>({ok:true,schema:'podview.control.v1',roomId:'room',bootId:'boot',domain:'music',taskId:'offer-'+(++reads),revision:1,expiresAt:Date.now()/1000+30,options:options.map(action=>({id:`opaque-${reads}-${action}`,action,label:action,argsSchema:action==='volume'?{kind:'percent',min:0,max:50}:{kind:'none'}})),expectedBindingId:host.liveMedia.playback.roomBinding.bindingId,setup:{volume}});host.liveTransport={connected:true,controlSetup:async()=>offer(),controlAction:async(task,id,args)=>{writes.push({task,id,args});return {ok:true,outcome:'accepted',requestId:'receipt'};}};const view=new LiveControlView(host);return {host,view,nodes,selectors,offer,writes,reads:()=>reads,restore(){view.cleanup();globalThis.document=previous;}};}

// Desired-behavior diagnostic only: no production change, no external effects.
test('expiry of one read-only control offer reacquires one offer while the same observed route remains fresh',async()=>{
 const f=fixture(),originalNow=Date.now,originalSet=setTimeout,originalClear=clearTimeout;let at=originalNow(),expiry;
 try{Date.now=()=>at;globalThis.setTimeout=fn=>{expiry=fn;return 1;};globalThis.clearTimeout=()=>{};f.host.liveTransport.controlSetup=async()=>({...f.offer(['pause','volume'],35),expiresAt:(at+1000)/1000});await f.view.prepareMusic();f.view.renderMusicControls();assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.nodes.get('volume').disabled,false);const poll=f.host.liveMedia.playback.poll_sequence;at+=1001;assert.ok(f.host.liveMedia.playback.expiresAt>at);expiry();await Promise.resolve();await Promise.resolve();assert.equal(f.host.liveMedia.playback.poll_sequence,poll);assert.equal(f.writes.length,0);assert.equal(f.reads(),2,'original expiry should initiate one bounded read-only renewal, not wait for a new provider poll');
 }finally{f.restore();Date.now=originalNow;globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});

async function expiryFixture(run,expectedWrites=0){
 const f=fixture(),originalNow=Date.now,originalSet=setTimeout,originalClear=clearTimeout;
 let at=originalNow();const callbacks=[];
 try{
  Date.now=()=>at;globalThis.setTimeout=fn=>{callbacks.push(fn);return callbacks.length;};globalThis.clearTimeout=()=>{};
  f.host.liveTransport.generation=1;
  f.host.liveTransport.controlSetup=async()=>({...f.offer(['pause','volume'],35),expiresAt:(at+1000)/1000});
  await f.view.prepareMusic();
  await run({...f,callbacks,advance:ms=>{at+=ms;},flush:async()=>{await Promise.resolve();await Promise.resolve();}});
  assert.equal(f.writes.length,expectedWrites,'only the explicitly requested command may dispatch');
 }finally{f.restore();Date.now=originalNow;globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
}
for(const [name,block] of [
 ['expired playback',f=>{f.host.liveMedia.playback.expiresAt=Date.now();}],
 ['UNKNOWN',f=>{f.view.musicFence={...f.view.musicContext(),outcome:'unknown'};}],
 ['accepted intent',f=>{f.view.musicFence={...f.view.musicContext(),outcome:'accepted'};}],
 ['pending action',f=>{f.view.pending=true;}],
 ['pending setup',f=>{f.view.setupPending=true;}],
 ['pending explicit intent',f=>{f.view.musicIntentPending=true;}],
 ['spent offer',f=>{f.view.spent.set(f.view.musicOffer.task.taskId,Date.now()/1000+30);}],
 ['disconnected',f=>{f.host.liveTransport.connected=false;}],
 ['new transport generation',f=>{f.host.liveTransport.generation++;}],
 ['cleanup',f=>{f.view.cleanup();}],
])test(`offer expiry does not renew across ${name}`,()=>expiryFixture(async f=>{
 block(f);f.advance(1001);f.callbacks[0]();await f.flush();assert.equal(f.reads(),1);
}));

test('a failed expiry renewal stays fenced on that poll; a new source poll may read again',()=>expiryFixture(async f=>{
 let failures=0;f.host.liveTransport.controlSetup=async()=>{failures++;throw Error('unavailable');};
 f.advance(1001);f.callbacks[0]();await f.flush();
 assert.equal(failures,1);assert.equal(f.view.musicFence.readFailure,true);
 f.callbacks[0]();await f.view.prepareMusic();await f.view.prepareMusic();assert.equal(failures,1);
 f.host.liveMedia.playback.poll_sequence++;await f.view.prepareMusic();assert.equal(failures,2);
}));

test('old expiry callbacks cannot replace or renew a newer offer',()=>expiryFixture(async f=>{
 const first=f.callbacks[0];f.advance(1001);first();await f.flush();
 assert.equal(f.reads(),2);const next=f.view.musicOffer;
 first();await f.flush();assert.equal(f.reads(),2);assert.equal(f.view.musicOffer,next);
 f.advance(1001);f.callbacks[1]();await f.flush();assert.equal(f.reads(),3,'each newly issued unused offer owns its own expiry');
}));

test('old expiry callback cannot disturb an invalidated and replaced owner',()=>expiryFixture(async f=>{
 const first=f.callbacks[0];f.view.invalidateMusic('changed',false);
 f.host.liveTransport={...f.host.liveTransport,generation:2};
 await f.view.prepareMusic();const next=f.view.musicOffer;assert.equal(f.reads(),2);
 f.advance(1001);first();await f.flush();assert.equal(f.view.musicOffer,next);assert.equal(f.reads(),2);
}));

test('fast transport controls remain usable while independent filtered volume read is held',async()=>{
 const f=fixture(),held=deferred(),calls=[];
 try{
  f.host.liveTransport.controlSetup=async(domain,target,recipe,filter)=>{calls.push(filter?.requestedAction??'transport');return filter?.requestedAction==='volume'?held.promise:f.offer(['pause'],null);};
  await f.view.prepareMusic();const reading=f.view.prepareVolume();f.view.renderMusicControls();
  assert.deepEqual(calls,['transport','volume']);assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.nodes.get('volume').disabled,true);
  await f.view.prepareVolume();assert.equal(calls.length,2,'coalesced volume read');
  held.resolve(f.offer(['volume'],35));await reading;
  assert.equal(f.nodes.get('volume').disabled,false);assert.equal(f.nodes.get('volume-value').textContent,'35 %');
  assert.notEqual(f.view.musicOffer.task.taskId,f.view.volumeOffer.task.taskId);
  const offered=f.view.volumeOffer.task.taskId;
  f.host.liveTransport.controlSetup=async(domain,target,recipe,filter)=>{assert.deepEqual(filter,{requestedAction:'volume'});return f.offer(['volume'],35);};
  assert.equal(await f.view.musicIntent('volume',{percent:30}),true);
  assert.equal(f.writes.length,1);assert.notEqual(f.writes[0].task.taskId,offered);assert.deepEqual(f.writes[0].args,{percent:30});
 }finally{f.restore();}
});

test('Pause can dispatch before volume arrives and late volume cannot adopt through its intent fence',async()=>{
 const f=fixture(),held=deferred();
 try{
  f.host.liveTransport.controlSetup=async(d,t,r,filter)=>filter?.requestedAction==='volume'?held.promise:f.offer(['pause'],null);
  await f.view.prepareMusic();const reading=f.view.prepareVolume();
  assert.equal(await f.view.musicIntent('pause'),true);assert.equal(f.writes.length,1);
  held.resolve(f.offer(['volume'],35));await reading;assert.equal(f.view.volumeOffer,null,'the superseded executable offer stays retired');assert.equal(f.view.volumeIntentOffer,undefined,'the late volume read never established intent knowledge');assert.equal(f.writes.length,1);
 }finally{f.restore();}
});
for(const mode of ['failure','foreign binding','UNKNOWN','disconnect','cleanup','new generation'])test(`independent volume read cannot adopt after ${mode}`,async()=>{
 const f=fixture(),held=deferred();let volumeReads=0;
 try{
  f.host.liveTransport.controlSetup=async(d,t,r,filter)=>{if(filter?.requestedAction==='volume'){volumeReads++;return held.promise;}return f.offer(['pause'],null);};
  await f.view.prepareMusic();const reading=f.view.prepareVolume();let response=f.offer(['volume'],35);
  if(mode==='failure')response={ok:false};
  if(mode==='foreign binding')response.expectedBindingId='f'.repeat(64);
  if(mode==='UNKNOWN')f.view.musicFence={...f.view.musicContext(),outcome:'unknown'};
  if(mode==='disconnect')f.host.liveTransport.connected=false;
  if(mode==='cleanup')f.view.cleanup();
  if(mode==='new generation')f.host.liveTransport.generation=1;
  held.resolve(response);await reading;assert.equal(f.view.volumeOffer??null,null);assert.equal(f.writes.length,0);
  await f.view.prepareVolume();assert.equal(volumeReads,1,'failed or revoked read does not loop');
 }finally{f.restore();}
});

test('independent volume expiry renews only its own successful task and old timer cannot replay',()=>expiryFixture(async f=>{
 f.view.musicOffer.task.options=f.view.musicOffer.task.options.filter(o=>o.action!=='volume');
 f.view.musicOffer.task.expiresAt=Date.now()/1000+10;
 f.host.liveTransport.controlSetup=async(d,t,r,filter)=>{assert.equal(filter?.requestedAction,'volume');return {...f.offer(['volume'],35),expiresAt:(Date.now()+1000)/1000};};
 await f.view.prepareVolume();const first=f.callbacks.at(-1),normal=f.view.musicOffer;
 f.advance(1001);first();await f.flush();assert.equal(f.reads(),3);assert.equal(f.view.musicOffer,normal);
 const renewed=f.view.volumeOffer;first();await f.flush();assert.equal(f.reads(),3);assert.equal(f.view.volumeOffer,renewed);
}));

test('fresh independent volume stays usable during expired transport offer and held transport renewal',()=>expiryFixture(async f=>{
 f.view.musicOffer.task.options=f.view.musicOffer.task.options.filter(o=>o.action!=='volume');
 const held=deferred();let filtered=0;
 f.host.liveTransport.controlSetup=async(d,t,r,filter)=>{
  if(filter?.requestedAction==='volume'){filtered++;return {...f.offer(['volume'],35),expiresAt:Date.now()/1000+10};}
  return held.promise;
 };
 await f.view.prepareVolume();f.advance(1001);
 const renewal=f.view.prepareMusic();f.view.renderMusicControls();
 assert.equal(f.nodes.get('play-pause').disabled,false,'known Pause remains an explicit intent requiring fresh JIT');assert.equal(f.writes.length,0);
 assert.equal(f.nodes.get('volume').disabled,false,'volume owns independent freshness, not the expired Pause grant');
 assert.equal(f.nodes.get('volume-value').textContent,'35 %');
 assert.equal(await f.view.musicIntent('volume',{percent:30}),true);
 assert.equal(filtered,2,'explicit volume obtains its own new filtered authority');assert.equal(f.writes.length,1);
 assert.deepEqual(f.writes[0].args,{percent:30});
 held.resolve(f.offer(['pause'],null));await renewal;
},1));

test('expired volume retains measured35 and usable intent while only a new JIT may dispatch',()=>expiryFixture(async f=>{
 f.view.musicOffer.task.options=f.view.musicOffer.task.options.filter(o=>o.action!=='volume');
 f.view.musicOffer.task.volume=null;f.view.musicOffer.task.expiresAt=Date.now()/1000+10;
 const held=deferred();let reads=0;
 f.host.liveTransport.controlSetup=async(d,t,r,filter)=>{
  assert.equal(filter?.requestedAction,'volume');
  if(++reads===1)return {...f.offer(['volume'],35),expiresAt:(Date.now()+1000)/1000};
  return held.promise;
 };
 await f.view.prepareVolume();assert.equal(f.nodes.get('volume-value').textContent,'35 %');
 const expiry=f.callbacks.at(-1);f.advance(1001);expiry();await f.flush();
 assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.nodes.get('volume').disabled,false);
 assert.equal(f.nodes.get('volume-value').textContent,'35 %','not reading volume cannot erase its last measured value');
 const intent=f.view.musicIntent('volume',{percent:30});assert.equal(f.writes.length,0,'clickability is not authority while JIT is held');
 held.resolve({ok:false});assert.equal(await intent,false,'malformed fresh setup cannot dispatch');await f.flush();assert.equal(f.nodes.get('volume-value').textContent,'35 %');
}));

test('held setup A cannot block new item B or clear its newer pending read on late completion',async()=>{
 const f=fixture(),a=deferred(),b=deferred();let calls=0;
 try{
  f.host.liveTransport.controlSetup=async()=>++calls===1?a.promise:b.promise;
  const readingA=f.view.prepareMusic();assert.equal(calls,1);
  const oldOffer=f.offer(['pause'],null);
  f.host.liveMedia.playback={...f.host.liveMedia.playback,item:{uri:'spotify:track:1123456789ABCDEFGHIJKL'},poll_sequence:2};
  f.view.invalidateMusic('source changed',false);
  const readingB=f.view.prepareMusic();assert.equal(calls,2,'fresh current owner starts without waiting for A deadline');
  const jobB=f.view.musicRead;assert.equal(f.view.musicReadPending,true);
  a.resolve(oldOffer);await readingA;
  assert.equal(f.view.musicRead,jobB);assert.equal(f.view.musicReadPending,true);assert.equal(f.view.musicOffer,null);
  await f.view.prepareMusic();assert.equal(calls,2,'B stays coalesced after A finally');
  const newOffer=f.offer(['pause'],null);b.resolve(newOffer);await readingB;
  assert.equal(f.view.musicOffer.task.taskId,newOffer.taskId);assert.equal(f.view.musicReadPending,false);assert.equal(f.writes.length,0);
 }finally{f.restore();}
});

test('failed explicit Pause setup retires consumed display grant; only newer source poll recovers without replay',async()=>{
 const f=fixture();let calls=0,fail=false;
 try{
  f.host.liveTransport.controlSetup=async()=>{calls++;if(fail)throw Error('503');return f.offer(['pause'],null);};
  await f.view.prepareMusic();const original=f.view.musicOffer.task;
  fail=true;assert.equal(await f.view.musicIntent('pause'),false);assert.equal(calls,2);assert.equal(f.writes.length,0);
  assert.equal(f.view.musicOffer,null);assert.equal(f.view.spent.has(original.taskId),true);
  fail=false;await f.view.prepareMusic();assert.equal(calls,2,'same poll cannot retry preparation');
  f.host.liveMedia.playback.poll_sequence++;await f.view.prepareMusic();f.view.renderMusicControls();
  assert.equal(calls,3);assert.notEqual(f.view.musicOffer.task.taskId,original.taskId);assert.equal(f.view.spent.has(original.taskId),true);
  assert.equal(f.view.musicFence,null);assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.writes.length,0);
 }finally{f.restore();}
});

test('failed volume preparation retires sibling grants while preserving intents and renews only from newer source',async()=>{
 const f=fixture();let volumeCalls=0,fail=false;
 try{
  f.host.liveTransport.controlSetup=async(d,t,r,filter)=>{if(filter?.requestedAction==='volume'){volumeCalls++;if(fail)throw Error('503');return f.offer(['volume'],35);}return f.offer(['pause'],null);};
  await f.view.prepareMusic();await f.view.prepareVolume();const pause=f.view.musicOffer,attempt=f.view.musicAttempt;
  fail=true;assert.equal(await f.view.musicIntent('volume',{percent:30}),false);
  assert.equal(f.view.musicOffer,null,'global sequence sibling is no longer executable');assert.equal(f.view.musicAttempt,null);assert.equal(f.view.musicIntentOffer.task,pause.task,'only same-owner presentation knowledge survives');assert.equal(f.view.spent.has(pause.task.taskId),false);
  assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.nodes.get('volume').disabled,false);assert.equal(f.writes.length,0);
  fail=false;await f.view.prepareVolume();assert.equal(volumeCalls,2,'same poll cannot retry');
  f.host.liveMedia.playback.poll_sequence++;await f.view.prepareMusic();await f.view.prepareVolume();
  assert.equal(volumeCalls,3);assert.notEqual(f.view.musicOffer.task.taskId,pause.task.taskId,'fresh siblings use new server tasks');assert.equal(f.view.musicFence,null);
  assert.equal(f.nodes.get('volume').disabled,false);assert.equal(f.writes.length,0);
 }finally{f.restore();}
});
