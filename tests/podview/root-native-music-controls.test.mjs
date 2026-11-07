// Legacy browser JIT command/option/scheduler assertions were retired. Direct
// ports, authority and lifecycle races are exercised in root-second-move-lifecycle
// and the actual browser-to-service flow in tests/browser/music_actual_e2e.cjs.
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
import {roomPlaybackObservation} from '../../podvoice/gatekeeper/static/podview/media-observation.js';
import {PlayerView} from '../../podvoice/gatekeeper/static/podview/player-view.js';
import {SpeakerOutputView} from '../../podvoice/gatekeeper/static/podview/speaker-output-view.js';
import {boundPlayback} from './room-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveControlView} from '../../podvoice/gatekeeper/static/podview/live-control-view.js';
class Node extends EventTarget{constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.isConnected=true;this.open=false;this.dataset={};this.textContent='';}append(...nodes){this.children.push(...nodes);}after(node){this.sibling=node;}setAttribute(name,value){this.attributes??={};this.attributes[name]=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}getAttribute(name){return this.attributes?.[name]??null;}replaceChildren(...nodes){this.children=nodes;}querySelector(){return null;}querySelectorAll(){return [];}focus(){}showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const observed=()=>({config_entry_id:'account',owner_epoch:'epoch',poll_sequence:1,expiresAt:Date.now()+15000,state:'playing',item:{uri:'spotify:track:0123456789ABCDEFGHIJKL'},target:{id:'device'}});
function fixture(){const previous=globalThis.document,nodes=new Map(),selectors=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,new Node('div'));return nodes.get(id);};globalThis.document={createElement:tag=>new Node(tag),getElementById:node,querySelector:selector=>selectors.get(selector)||null};const host=new Node('host');host.showFeedback=(message,pending)=>{host.feedbackMessage=message;};host.state={devices:[{id:'vacuum.actual',kind:'vacuum',live:true,stale:false,status:'cleaning'}]};host.liveMedia={playback:observed()};host.liveSnapshot={bootId:'boot',roomId:'room',capabilities:{controlSetup:['music']}};host.liveMedia.playback=boundPlayback(host.liveSnapshot,host.liveMedia.playback);host.querySelector=selector=>{if(!selectors.has(selector))selectors.set(selector,new Node('div'));return selectors.get(selector);};let reads=0;const writes=[];const offer=(options=['pause','resume','next','previous','volume'],volume=20)=>({ok:true,schema:'podview.control.v1',roomId:'room',bootId:'boot',domain:'music',taskId:'offer-'+(++reads),revision:1,expiresAt:Date.now()/1000+30,options:options.map(action=>({id:`opaque-${reads}-${action}`,action,label:action,argsSchema:action==='volume'?{kind:'percent',min:0,max:50}:{kind:'none'}})),expectedBindingId:host.liveMedia.playback.roomBinding.bindingId,setup:{volume}});host.liveTransport={connected:true,controlSetup:async()=>offer(),controlAction:async(task,id,args)=>{writes.push({task,id,args});return {ok:true,outcome:'accepted',requestId:'receipt'};}};const view=new LiveControlView(host);return {host,view,nodes,selectors,offer,writes,reads:()=>reads,restore(){view.cleanup();globalThis.document=previous;}};}
test('paired controls enable only issued actions and observed bounded volume in retained geometry',async()=>{const f=fixture();try{f.host.liveTransport.controlSetup=async()=>f.offer(['pause','next','volume'],35);await f.view.prepareMusic();f.view.renderMusicControls();assert.equal(f.nodes.get('play-pause').hidden,false);assert.equal(f.nodes.get('next').hidden,false);assert.equal(f.nodes.get('previous').hidden,false);assert.equal(f.nodes.get('previous').disabled,true);assert.equal(f.nodes.get('volume').value,'35');assert.equal(f.nodes.get('volume').max,'100');assert.equal(f.nodes.get('volume').dataset.actionMax,'50');assert.equal(f.writes.length,0);f.view.musicOffer.task.volume=null;f.view.renderMusicControls();assert.equal(f.selectors.get('.player .volume').hidden,false);assert.equal(f.nodes.get('volume').disabled,true);assert.equal(f.nodes.get('volume-value').textContent,'—');}finally{f.restore();}});
test('unpaired, stale or unnamed target can neither fetch setup nor send',async()=>{for(const change of [f=>f.host.liveSnapshot.capabilities.controlSetup=[],f=>f.host.liveMedia.playback.stale=true,f=>f.host.liveMedia.playback.target=null,f=>f.host.liveTransport.connected=false]){const f=fixture();try{change(f);await f.view.prepareMusic();assert.equal(await f.view.musicIntent('pause'),false);assert.equal(f.reads(),0);assert.equal(f.writes.length,0);}finally{f.restore();}}});

test('cleanup cancels source expiry without starting another preparation',async()=>{const f=fixture();try{await f.view.prepareMusic();const reads=f.reads();f.view.cleanup();await new Promise(done=>setImmediate(done));assert.equal(f.reads(),reads);assert.equal(f.view.musicOffer,null);assert.equal(f.writes.length,0);}finally{f.restore();}});

test('periodic observation preserves only an active pointer gesture and hides ambiguous volume actions',async()=>{const f=fixture();try{await f.view.prepareMusic();f.view.renderMusicControls();const input=f.nodes.get('volume');input.dispatchEvent(new Event('pointerdown'));input.value='31';f.view.renderMusicControls();assert.equal(input.value,'31');input.dispatchEvent(new Event('pointerup'));f.view.renderMusicControls();assert.equal(input.value,'20');const duplicate={...f.view.musicOffer.task.options.find(o=>o.action==='volume'),id:'other-volume'};f.view.musicOffer.task.options.push(duplicate);f.view.renderMusicControls();assert.equal(f.selectors.get('.player .volume').hidden,false);assert.equal(f.nodes.get('volume').disabled,true);assert.equal(f.nodes.get('volume-value').textContent,'20 %');}finally{f.restore();}});

const alias=()=>({speakerId:'b'.repeat(64),accountId:'account',kind:'configured_alias',nativeRoomId:'r1',homepodId:'43',availability:'available',selectable:true,outputSelected:false});
function enableMove(f){f.host.liveTransport.controlSetup=async(domain,target)=>{f.moveTargets??=[];f.moveTargets.push(target);const value=f.offer(['move_existing_session']);value.options[0]={id:'move:'+alias().speakerId,action:'move_existing_session',label:'Flyt til actual Svend',argsSchema:{kind:'none'}};return value;};}

test('unsupported, unknown, selected or unpaired aliases cannot send a direct move',async()=>{for(const mutate of [a=>a.selectable=false,a=>a.availability='unknown',a=>{a.nativeRoomId='actual-room';a.homepodId='77';},a=>a.homepodId=null,a=>a.accountId='foreign',a=>a.speakerId='name']){const f=fixture();try{actualOutput(f);f.host.liveTransport.controlIntent=async intent=>{f.writes.push(intent);return {outcome:'rejected',requestId:intent.requestId};};const row=alias();mutate(row);assert.equal(await f.view.moveSpeaker(row,()=>true),false);assert.equal(f.writes.length,0);assert.equal(await f.view.moveSpeaker(alias(),()=>true),true,'valid control proves the fixture can dispatch');assert.equal(f.writes.length,1);}finally{f.restore();}}});

test('music-only invalidation preserves pending vacuum ownership and its eventual real receipt',async()=>{
 const f=fixture();try{
  f.host.liveSnapshot.capabilities.controlSetup.push('vacuum');
  const raw={ok:true,schema:'podview.control.v1',bootId:'boot',roomId:'room',domain:'vacuum',taskId:'vacuum-task',revision:1,expiresAt:Date.now()/1000+60,options:[{id:'pause',action:'pause',label:'Pause rengøring',argsSchema:{kind:'none'}}],setup:{mapName:null}};
  f.host.liveTransport.controlSetup=async domain=>domain==='vacuum'?raw:f.offer();await f.view.open('vacuum',{entityId:'vacuum.actual'});const task=f.view.task;assert.ok(task);assert.equal(f.view.robotControlOffer.task,task);assert.equal(f.view.robotControlCurrent(f.view.robotControlOffer.context),true);
  const pause=new Node('button');pause.dataset.kit='button';pause.dataset.controlOptionId='pause';f.view.robotPanel.querySelectorAll=()=>[pause];
  const hold=deferred();f.host.liveTransport.controlAction=async()=>hold.promise;
  const running=f.view.send('pause',{}),generation=f.view.generation,opening=f.view.opening,operation=f.view.activeOperation;
  assert.equal(operation.domain,'vacuum');assert.equal(f.view.pending,true);assert.equal(pause.dataset.feedback,'progress');assert.equal(pause.getAttribute('aria-busy'),'true');assert.equal(f.view.receiptNote.hidden,true);
  f.view.invalidateMusic(undefined,false);
  assert.equal(f.view.task,task);assert.equal(f.view.generation,generation);assert.equal(f.view.opening,opening);assert.equal(f.view.pending,true);assert.equal(f.view.activeOperation,operation);assert.equal(f.view.receipts.get(operation.key).outcome,'pending');
  hold.resolve({ok:true,outcome:'accepted',requestId:'vacuum-receipt'});await running;
  assert.equal(f.view.receipts.get(operation.key).outcome,'accepted');assert.equal(f.view.note.textContent,'');assert.equal(f.view.note.hidden,true);assert.match(f.view.receiptNote.textContent,/modtaget/);assert.equal(pause.getAttribute('aria-busy'),'false');assert.equal(f.view.task,task);
  f.view.setupPending=true;const openingBefore=f.view.opening;f.view.invalidateMusic(undefined,false);assert.equal(f.view.setupPending,true);assert.equal(f.view.opening,openingBefore);f.view.setupPending=false;
  f.view.invalidate(undefined,false);assert.equal(f.view.task,null);
 }finally{f.restore();}
});

test('held vacuum setup remains eligible after music-only invalidation',async()=>{
 const f=fixture();try{
  f.host.liveSnapshot.capabilities.controlSetup.push('vacuum');f.view.musicAttempt=f.view.musicContext().key;
  const hold=deferred();f.host.liveTransport.controlSetup=async(domain)=>domain==='vacuum'?hold.promise:f.offer();
  const opening=f.view.open('vacuum',{entityId:'vacuum.actual'},new Node('button'));
  const generation=f.view.generation,sequence=f.view.opening;assert.equal(f.view.setupPending,true);
  f.view.invalidateMusic(undefined,false);assert.equal(f.view.setupPending,true);assert.equal(f.view.generation,generation);assert.equal(f.view.opening,sequence);
  hold.resolve({ok:true,schema:'podview.control.v1',bootId:'boot',roomId:'room',domain:'vacuum',taskId:'vacuum-held',revision:1,expiresAt:Date.now()/1000+60,options:[{id:'pause',action:'pause',label:'Pause rengøring',argsSchema:{kind:'none'}}],setup:{mapName:null}});
  await opening;assert.equal(f.view.task.taskId,'vacuum-held');assert.equal(f.view.robotPanel.disabled,false);
 }finally{f.restore();}
});

test('passive music offer read does not block a robot setup',async()=>{
 const f=fixture();const read=deferred();let preparation;
 try{
  f.host.liveSnapshot.capabilities.controlSetup.push('vacuum');
  f.host.liveTransport.controlSetup=async domain=>domain==='music'?read.promise:{ok:true,schema:'podview.control.v1',bootId:'boot',roomId:'room',domain:'vacuum',taskId:'robot-passive',revision:1,expiresAt:Date.now()/1000+60,options:[{id:'pause',action:'pause',label:'Pause',argsSchema:{kind:'none'}}],setup:{mapName:null}};
  preparation=f.view.prepareMusic();await f.view.open('vacuum',{entityId:'vacuum.actual'},new Node('button'));
  assert.equal(f.view.task.taskId,'robot-passive');assert.equal(f.view.musicReadPending,true);assert.equal(f.writes.length,0);
 }finally{read.resolve(f.offer());await preparation;f.restore();}
});

test('expired music offer renews once from a genuinely newer fresh observation without changing intent identity',async()=>{
 const previousNow=Date.now;let clock=previousNow();Date.now=()=>clock;const f=fixture();try{
  let calls=0;f.host.liveTransport.controlSetup=async()=>{calls++;return {...f.offer(['pause','next'],null),expiresAt:clock/1000+2};};
  await f.view.prepareMusic();f.view.renderMusicControls();const key=f.view.musicContext().key,firstTask=f.view.musicOffer.task.taskId;
  assert.equal(f.nodes.get('play-pause').disabled,false);clock+=2001;
  await f.view.prepareMusic();f.view.renderMusicControls();assert.equal(calls,1);assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.writes.length,0,'remaining clickable is not a command');
  f.host.liveMedia.playback={...f.host.liveMedia.playback,poll_sequence:2,expiresAt:clock+15000};await f.view.prepareMusic();f.view.renderMusicControls();
  assert.equal(f.view.musicContext().key,key);assert.equal(calls,2);assert.notEqual(f.view.musicOffer.task.taskId,firstTask);assert.equal(f.nodes.get('play-pause').disabled,false);
  await f.view.prepareMusic();await f.view.prepareMusic();assert.equal(calls,2);assert.equal(f.writes.length,0);
 }finally{f.restore();Date.now=previousNow;}
});

test('failed passive preparation is not retried on the same poll and UNKNOWN never writes by itself',async()=>{
 const previousNow=Date.now;let clock=previousNow();Date.now=()=>clock;const f=fixture();try{
  let calls=0;f.host.liveTransport.controlSetup=async()=>{calls++;throw Error('temporary read failure');};
  await f.view.prepareMusic();await f.view.prepareMusic();assert.equal(calls,1);
  f.host.liveMedia.playback={...f.host.liveMedia.playback,poll_sequence:2,expiresAt:clock+15000};await f.view.prepareMusic();assert.equal(calls,2);
  const key=f.view.musicContext().key;f.view.musicFence={...f.view.musicContext(),outcome:'unknown'};
  f.host.liveMedia.playback={...f.host.liveMedia.playback,poll_sequence:3,expiresAt:clock+15000};
  // UNKNOWN no longer locks idempotent controls: a newer poll may read controls again,
  // but nothing is ever written or replayed without an explicit tap.
  await f.view.prepareMusic();assert.equal(calls,3);assert.equal(f.view.musicContext().key,key);assert.equal(f.writes.length,0);
 }finally{f.restore();Date.now=previousNow;}
});

test('new-observation preparation is coalesced and late room replacement does not install its offer',async()=>{
 const f=fixture();try{
  const hold=deferred();let calls=0;f.host.liveTransport.controlSetup=()=>{calls++;return hold.promise;};
  const pending=f.view.prepareMusic();await f.view.prepareMusic();assert.equal(calls,1);
  f.host.liveSnapshot={...f.host.liveSnapshot,roomId:'other'};hold.resolve(f.offer(['pause'],null));await pending;
  assert.equal(f.view.musicOffer,null);assert.equal(f.view.musicReadPending,false);assert.equal(f.writes.length,0);
 }finally{f.restore();}
});

function actualOutput(f){
 const p=f.host.liveMedia.playback;f.host.liveSnapshot.capabilities.musicRead=['playback'];
 const binding={roomId:'room',accountId:'account',targetId:'actual-device',nativeRoomId:'actual-room',nativeHomepodId:'77',bindingId:'c'.repeat(64),validUntil:Date.now()/1000+15};
 Object.assign(p,{projectionVersion:2,observationStatus:'observed',roomBinding:binding,roomBound:true,readOnly:false,target:{id:binding.targetId},expiresAt:Date.now()+15000});return binding;
}

for(const echo of [undefined,'d'.repeat(64),'invalid'])test(`missing or foreign music binding echo ${echo} never becomes an offered or executable control`,async()=>{
 const f=fixture();try{actualOutput(f);f.host.liveTransport.controlSetup=async()=>({...f.offer(['pause']),expectedBindingId:echo});await f.view.prepareMusic();assert.equal(f.view.musicOffer,null);assert.equal(await f.view.musicIntent('pause'),false);assert.equal(f.writes.length,0);}finally{f.restore();}
});

test('current metadata without an actual route or with an expired actual binding cannot fetch controls',async()=>{
 for(const kind of ['account','expired']){const f=fixture();try{const binding=actualOutput(f);if(kind==='account')Object.assign(f.host.liveMedia.playback,{observationStatus:'account_observed',accountObserved:true,roomBound:false,roomBinding:null,readOnly:true});else binding.validUntil=Date.now()/1000-1;await f.view.prepareMusic();assert.equal(f.reads(),0);assert.equal(f.view.musicContext(),null);assert.equal(await f.view.musicIntent('next'),false);assert.equal(f.writes.length,0);}finally{f.restore();}}
});

for(const state of ['playing','paused'])for(const kind of ['no-capability','account-read-only'])test(`disabled ${kind} controls keep the ${state} observation label without acquiring an action`,async()=>{
 const f=fixture();try{
  actualOutput(f);f.host.liveMedia.playback.state=state;f.host.liveSnapshot.capabilities.controlSetup=[];
  if(kind==='account-read-only')Object.assign(f.host.liveMedia.playback,{observationStatus:'account_observed',accountObserved:true,roomBound:false,roomBinding:null,readOnly:true});
  f.view.renderMusicControls();
  for(const id of ['play-pause','detail-toggle']){assert.equal(f.nodes.get(id).getAttribute('aria-label'),state==='playing'?'Sæt musik på pause':'Fortsæt musikken');assert.equal(f.nodes.get(id).disabled,true);}
  assert.equal(f.view.musicContext(),null);assert.equal(await f.view.musicIntent(state==='playing'?'pause':'resume'),false);assert.equal(f.reads(),0);assert.equal(f.writes.length,0);
 }finally{f.restore();}
});

test('absolute 35 percent display keeps action max35 and visibly clamps a higher live input draft without an effect',async()=>{
 const f=fixture(),feedback=[];try{
  f.host.showFeedback=(message,pending)=>feedback.push({message,pending});f.host.liveTransport.controlSetup=async()=>{const raw=f.offer(['volume'],35);raw.options[0].argsSchema.max=35;return raw;};
  await f.view.prepareMusic();f.view.renderMusicControls();const input=f.nodes.get('volume');assert.equal(input.max,'100');assert.equal(input.value,'35');assert.equal(input.dataset.actionMax,'35');
  input.dispatchEvent(new Event('pointerdown'));input.value='100';input.dispatchEvent(new Event('input'));assert.equal(input.value,'35');assert.equal(input.getAttribute('aria-valuetext'),'35 %');assert.equal(feedback.at(-1).message,'Højst 35 %');assert.equal(f.writes.length,0,'draft input is not a command');
  input.dispatchEvent(new Event('pointerup'));assert.equal(await f.view.musicIntent('volume',{percent:100}),false);assert.equal(f.writes.length,0,'out-of-policy direct args remain rejected');
 }finally{f.restore();}
});

test('known volume survives offer expiry and held refresh without retaining an executable grant',async()=>{
 const previousNow=Date.now;let clock=previousNow();Date.now=()=>clock;const f=fixture();try{
  actualOutput(f);f.host.liveTransport.controlSetup=async()=>({...f.offer(['pause','volume'],35),expiresAt:clock/1000+3});
  await f.view.prepareMusic();const input=f.nodes.get('volume');assert.equal(input.value,'35');assert.equal(input.disabled,false);
  clock+=3001;f.view.renderMusicControls();assert.equal(input.value,'35');assert.equal(f.nodes.get('volume-value').textContent,'35 %');assert.equal(input.disabled,false);assert.equal(f.writes.length,0,'no command is sent by passive expiry');
  const hold=deferred();f.host.liveTransport.controlSetup=()=>hold.promise;f.host.liveMedia.playback.poll_sequence++;const refresh=f.view.prepareMusic();f.view.renderMusicControls();assert.equal(input.value,'35');assert.equal(input.disabled,false);assert.equal(f.writes.length,0);
  hold.resolve(f.offer(['pause','volume'],35));await refresh;assert.equal(input.value,'35');assert.equal(input.disabled,false);assert.equal(f.writes.length,0);
 }finally{f.restore();Date.now=previousNow;}
});
for(const change of ['binding','output','account','epoch','boot','room','permission','transport','selected','idle','unbound','disconnect-cleanup'])test(`retained volume clears after actual ${change} custody replacement`,async()=>{
 const f=fixture();try{
  actualOutput(f);f.host.liveTransport.controlSetup=async()=>f.offer(['volume'],35);await f.view.prepareMusic();f.view.musicOffer.task.expiresAt=Date.now()/1000-1;
  const p=f.host.liveMedia.playback;
  if(change==='binding')p.roomBinding.bindingId='d'.repeat(64);
  if(change==='output'){p.target.id='different';p.roomBinding.targetId='different';}
  if(change==='account')p.config_entry_id='other';
  if(change==='epoch')p.owner_epoch='other';
  if(change==='boot')f.host.liveSnapshot.bootId='other';
  if(change==='room')f.host.liveSnapshot.roomId='other';
  if(change==='permission')f.host.liveSnapshot.capabilities.controlSetup=[];
  if(change==='transport')f.host.liveTransport={...f.host.liveTransport};
  if(change==='selected')f.host.liveSelection={pendingPlayer:()=>({target:'new intended output'})};
  if(change==='idle')p.state='no_active_playback';
  if(change==='unbound')Object.assign(p,{observationStatus:'account_observed',roomBound:false,roomBinding:null,readOnly:true});
  if(change==='disconnect-cleanup')f.view.cleanup();
  f.view.renderMusicControls();assert.equal(f.nodes.get('volume-value').textContent,'—');assert.equal(f.nodes.get('volume').dataset.kitValueKnown,'false');assert.equal(f.nodes.get('volume').disabled,true);assert.equal(await f.view.musicIntent('volume',{percent:30}),false);assert.equal(f.writes.length,0);
 }finally{f.restore();}
});
test('same output playback changes and temporary disconnect keep only the last known measurement',async()=>{
 const f=fixture();try{
  actualOutput(f);f.host.liveTransport.controlSetup=async()=>f.offer(['volume'],35);await f.view.prepareMusic();f.view.musicOffer=null;
  Object.assign(f.host.liveMedia.playback,{state:'paused',item:{uri:'spotify:track:0123456789ABCDEFGHIJKM'},poll_sequence:2,stale:true});f.host.liveTransport.connected=false;f.view.renderMusicControls();
  assert.equal(f.nodes.get('volume-value').textContent,'35 %');assert.equal(f.nodes.get('volume').disabled,true);assert.equal(await f.view.musicIntent('volume',{percent:30}),false);assert.equal(f.writes.length,0);
 }finally{f.restore();}
});
test('fresh unknown measurement supersedes retained volume rather than fabricating zero',async()=>{
 const f=fixture();try{await f.view.prepareMusic();f.view.musicOffer.task.volume=null;f.view.renderMusicControls();assert.equal(f.nodes.get('volume-value').textContent,'—');assert.equal(f.nodes.get('volume').dataset.kitValueKnown,'false');assert.equal(f.nodes.get('volume').disabled,true);}finally{f.restore();}
});

for(const failure of ['rejected','invalid'])test(`passive ${failure} setup explains disabled controls and recovers only from a new poll with valid setup`,async()=>{
 const f=fixture();const held=deferred();try{
  actualOutput(f);let reads=0;f.host.liveTransport.controlSetup=async()=>{reads++;if(failure==='rejected')throw Error('inert control_setup_denied');return {...f.offer(['pause','volume'],35),expectedBindingId:'d'.repeat(64)};};
  const playback=structuredClone(f.host.liveMedia.playback);await f.view.prepareMusic();
  assert.equal(f.view.musicOffer,null);assert.equal(f.view.musicFence.outcome,'unavailable');assert.equal(f.view.musicFence.readFailure,true);assert.equal(f.view.musicStatus.hidden,false);assert.equal(f.view.musicStatus.textContent,'Kan ikke styre højttaleren lige nu. Prøv igen om lidt.');assert.equal(f.nodes.get('play-pause').disabled,true);assert.equal(f.nodes.get('volume').disabled,true);assert.deepEqual(f.host.liveMedia.playback,playback);assert.equal(f.writes.length,0);
  await f.view.prepareMusic();assert.equal(reads,1,'failed setup does not repeat on the same source poll');assert.equal(await f.view.musicIntent('pause'),false);
  f.host.liveMedia.playback.poll_sequence++;f.host.liveTransport.controlSetup=()=>{reads++;return held.promise;};const refresh=f.view.prepareMusic();assert.equal(reads,2);f.view.renderMusicControls();assert.equal(f.nodes.get('play-pause').disabled,true);assert.equal(f.view.musicFence.readFailure,true,'an unaccepted read is not recovery');await f.view.prepareMusic();assert.equal(reads,2);
  held.resolve(f.offer(['pause','volume'],35));await refresh;assert.equal(f.view.musicFence,null);assert.equal(f.view.musicStatus.hidden,true);assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.nodes.get('volume').disabled,false);assert.equal(f.writes.length,0);
 }finally{held.resolve(f.offer(['pause','volume'],35));f.restore();}
});
for(const replacement of ['room','music-generation'])test(`late failed passive setup cannot report a failure after ${replacement} replacement`,async()=>{
 const f=fixture();const held=deferred();try{
  actualOutput(f);f.host.liveTransport.controlSetup=()=>held.promise;const read=f.view.prepareMusic();
  if(replacement==='room')f.host.liveSnapshot.roomId='other';else f.view.invalidateMusic(undefined,false);
  held.resolve({ok:false,error:'inert rejected'});await read;
  assert.equal(f.view.musicFence??null,null);assert.equal(f.view.musicStatus.hidden,true);assert.equal(f.view.musicOffer,null);assert.equal(f.writes.length,0);
 }finally{held.resolve({ok:false});f.restore();}
});

test('a voice revision leaves an in-flight vacuum receipt intact',async()=>{
 const f=fixture();let finish,running;try{
  f.host.liveSnapshot.capabilities.controlSetup.push('vacuum');const raw={ok:true,schema:'podview.control.v1',bootId:'boot',roomId:'room',domain:'vacuum',taskId:'held-vacuum',revision:1,expiresAt:Date.now()/1000+60,options:[{id:'robot-pause',action:'pause',label:'Pause',argsSchema:{kind:'none'}}],setup:{mapName:null}};f.host.liveTransport.controlSetup=async domain=>domain==='vacuum'?raw:f.offer();await f.view.open('vacuum',{entityId:'vacuum.actual'});await f.view.prepareMusic();
  f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return new Promise(resolve=>finish=resolve);};running=f.view.send('robot-pause',{});const operation=f.view.activeOperation;assert.equal(operation.domain,'vacuum');f.host.liveSnapshot.inputRevision=2;f.view.render();
  assert.equal(f.view.task.taskId,'held-vacuum');assert.equal(f.view.pending,true);assert.equal(f.view.activeOperation,operation);assert.equal(f.writes.length,1);finish({ok:true,outcome:'accepted',requestId:'vacuum-settled'});await running;assert.equal(f.view.pending,false);assert.equal(f.view.activeOperation,null);assert.equal(f.writes.length,1);
 }finally{finish?.({outcome:'unknown'});await running;f.restore();}
});

// Adopted reviewed live-control-readonly-v3.test.js coverage.
{
class Node extends EventTarget{
 constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.isConnected=true;this.open=false;this.dataset={};this.textContent='';}
 append(...nodes){this.children.push(...nodes);}after(node){this.sibling=node;}replaceChildren(...nodes){this.children=nodes;}
 setAttribute(name,value){this.attributes??={};this.attributes[name]=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);}getAttribute(name){return this.attributes?.[name]??null;}
 querySelector(){return null;}querySelectorAll(){return [];}focus(){}showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}
}
const actions=['pause','resume','next','previous','volume'];
function fixture(){
 const previous=globalThis.document,nodes=new Map(),selectors=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,new Node('div'));return nodes.get(id);};
 globalThis.document={createElement:tag=>new Node(tag),getElementById:node,querySelector:selector=>selectors.get(selector)||null};const host=new Node('host');host.state={focus:'player',devices:[]};host.liveSnapshot={bootId:'boot',roomId:'room',providerGeneration:1,capabilities:{musicRead:['playback'],controlSetup:['music']}};
 host.querySelector=selector=>{if(!selectors.has(selector))selectors.set(selector,new Node('div'));return selectors.get(selector);};
 const wire=({base=100,effective=35,ceiling=35,state='playing',status='observed',reason=null,supported=actions,epoch='epoch',binding='a'.repeat(64),ttl=5}={})=>({ok:true,schema:'podview.room-playback.v3',bootId:'boot',roomId:'room',configEntryId:'account',status:'observed',reason:null,binding:{roomId:'room',accountId:'account',targetId:'device',nativeRoomId:'native-room',nativeHomepodId:'2',bindingId:binding,validUntil:Date.now()/1000+ttl},data:{ok:true,schema:'podconnect.playback.v1',config_entry_id:'account',owner_epoch:epoch,poll_sequence:1,physical_result_verified:false,observation:{status:'fresh',source:'spotify_web_api',observed_at:new Date().toISOString(),age_ms:0,max_age_ms:15000},playback:{state,target:{kind:'spotify_device',target_id:'device',name:'Bridge'},item:{type:'track',uri:'spotify:track:0123456789ABCDEFGHIJKL',name:'Song',artists:['Artist'],duration_ms:60000},progress_ms:1000,provider_changed_at_ms:null,shuffle:false,repeat:'off'}},controls:{status,reason,binding_id:status==='observed'?binding:null,valid_until:status==='observed'?Date.now()/1000+ttl:null,supported_actions:[...supported],volume:base===null?null:{base_percent:base,effective_percent:effective}},permissions:{actions:[...supported],maxVolume:supported.includes('volume')?ceiling:null}});
 host.liveMedia={account:'account'};const adopt=options=>{const body=wire(options);body.controls.valid_until=body.controls.status==='observed'?body.binding.validUntil:null;host.liveMedia.playback=roomPlaybackObservation(body,'account',host.liveSnapshot);return body;};adopt();
 const setups=[],effects=[],feedback=[];let serial=0,response;
 const offer=(requested,volume=35)=>{const n=++serial,chosen=requested?[requested]:actions;return {ok:true,schema:'podview.control.v1',bootId:'boot',roomId:'room',domain:'music',expectedBindingId:host.liveMedia.playback.roomBinding.bindingId,taskId:'control:'+n.toString(16).padStart(32,'0'),revision:1,expiresAt:Date.now()/1000+5,options:chosen.map((action,i)=>({id:(n*10+i).toString(16).padStart(24,'0'),action,label:action,argsSchema:action==='volume'?{kind:'percent',min:0,max:35}:{kind:'none'}})),setup:{volume}};};
 host.liveTransport={connected:true,generation:1,controlSetup:async(...args)=>{setups.push(args);return response?response(...args):offer(args[3]?.requestedAction);},controlIntent:async(intent)=>{effects.push(intent);return {ok:true,outcome:'accepted',requestId:intent.requestId};}};host.showFeedback=(message)=>feedback.push(message);host.liveMedia.captureAcceptedPlayRefresh=()=>()=>Promise.resolve({status:'matched'});
 const view=new LiveControlView(host);return {host,view,nodes,setups,effects,feedback,wire,adopt,offer,setResponse:fn=>response=fn,close(){view.cleanup();globalThis.document=previous;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('fresh v3 draws readonly actions/base100 with policy35 and performs zero passive setups',async()=>{
 const f=fixture();try{f.view.render();await f.view.prepareMusic();await f.view.prepareVolume();await tick();assert.equal(f.setups.length,0);assert.equal(f.effects.length,0);assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.nodes.get('next').disabled,false);assert.equal(f.nodes.get('previous').disabled,false);assert.equal(f.nodes.get('volume').value,'100');assert.equal(f.nodes.get('volume').max,'100');assert.equal(f.nodes.get('volume').dataset.actionMax,'35');assert.equal(f.nodes.get('volume-value').textContent,'100 %');assert.equal(f.view.musicOffer,undefined);assert.equal(f.view.volumeOffer,undefined);assert.equal(f.view.musicIntentOffer,undefined);assert.equal(f.view.volumeIntentOffer,undefined);const facts=f.view.musicReadonlyControls();assert.deepEqual(Object.keys(facts).sort(),['actions','maxVolume','volume']);}finally{f.close();}
});
for(const action of ['pause','next','previous','volume'])test(`v3 explicit ${action} sends one direct intent without setup`,async()=>{
 const f=fixture();try{f.view.render();assert.equal(await f.view.musicIntent(action,action==='volume'?{percent:20}:{}),true);assert.equal(f.setups.length,0);assert.equal(f.effects.length,1);const intent=f.effects[0];assert.equal(intent.action,action);assert.equal(intent.target.expectedBindingId,'a'.repeat(64));assert.deepEqual(intent.args,action==='volume'?{percent:20}:{});assert.ok(intent.requestId);assert.equal(f.view.musicMeasurement.volume,100);f.view.render();assert.equal(f.effects.length,1);}finally{f.close();}
});
test('observed v3 seek sends the scoped absolute position and retains it until position is observed',async()=>{
 const f=fixture();
 try{
  const track=f.host.liveMedia.playback.item.uri;
  assert.equal(f.view.musicSeekState(track),null);
  const offered={supported:[...actions,'seek']};
  f.adopt(offered);
  const {witness}=f.view.musicSeekState(track),issued=Date.now();
  assert.equal(await f.view.musicIntent('seek',{positionMs:32000,witness}),true);
  assert.deepEqual(f.effects[0].args,{positionMs:32000,expectedOwnerEpoch:'epoch',expectedTrackUri:track});
  assert.equal(f.setups.length,0);
  assert.equal(f.view.musicSeekState(track).positionMs,32000);
  const receipt=f.view.musicSettlementReceipt();
  const observed=progressMs=>{
   f.adopt(offered);
   const p=f.host.liveMedia.playback;
   Object.assign(p,{observedAt:new Date(issued+1000).toISOString(),progressMs,settlement:{
    requestId:receipt.requestId,request_id:'epoch:7',owner_epoch:'epoch',command_sequence:7,status:'confirmed',
    effect:{source:'native_bound_state',effect_revision:'19'},
   }});
   assert.equal(f.view.observeMusicSettlement(p,receipt),true);
  };
  observed(2000);
  assert.equal(f.view.musicSeekState(track).positionMs,32000,'correlated old progress cannot snap back');
  observed(32500);
  assert.equal(f.view.musicSeekState(track).positionMs,null,'matching fresh progress owns the timeline');
  assert.equal(f.effects.length,1);
 }finally{f.close();}
});

test('only the latest queued absolute seek is sent; UNKNOWN is never replayed',async()=>{
 const f=fixture();
 let first,finish;
 try{
  f.adopt({supported:[...actions,'seek']});
  const track=f.host.liveMedia.playback.item.uri,{witness}=f.view.musicSeekState(track);
  f.host.liveTransport.controlIntent=intent=>{
   f.effects.push(intent);
   return f.effects.length===1?new Promise(resolve=>finish=()=>resolve({outcome:'unknown'}))
    :Promise.resolve({outcome:'accepted'});
  };
  first=f.view.musicIntent('seek',{positionMs:12000,witness});
  assert.equal(await f.view.musicIntent('seek',{positionMs:13000,witness}),true);
  assert.equal(await f.view.musicIntent('seek',{positionMs:14000,witness}),true);
  const queued=f.view.musicQueued.intents.at(-1).requestId;
  assert.equal(f.view.musicSeekState(track).positionMs,14000);
  finish();
  await first;
  await tick();
  assert.deepEqual(f.effects.map(intent=>intent.args.positionMs),[12000,14000]);
  assert.equal(f.effects[1].requestId,queued);
  assert.notEqual(f.effects[0].requestId,queued);
 }finally{finish?.();await first;f.close();}
});

for(const boundary of ['track','owner','account','binding','transport','permission','disconnect']){
 test(`a seek queued for the old player cannot execute after ${boundary}`,async()=>{
  const f=fixture();
  let first,finish;
  try{
   const offered={supported:[...actions,'seek']};
   f.adopt(offered);
   f.view.render();
   const track=f.host.liveMedia.playback.item.uri,{witness}=f.view.musicSeekState(track);
   f.host.liveTransport.controlIntent=intent=>{
    f.effects.push(intent);
    return new Promise(resolve=>finish=()=>resolve({outcome:'accepted'}));
   };
   first=f.view.musicIntent('seek',{positionMs:12000,witness});
   assert.equal(await f.view.musicIntent('seek',{positionMs:13000,witness}),true);
   if(boundary==='track')f.host.liveMedia.playback.item.uri='spotify:track:ABCDEFGHIJKLMNOPQRSTUV';
   if(boundary==='owner')f.adopt({...offered,epoch:'new-owner'});
   if(boundary==='account')f.host.liveMedia.account='other-account';
   if(boundary==='binding')f.adopt({...offered,binding:'b'.repeat(64)});
   if(boundary==='transport')f.host.liveTransport={...f.host.liveTransport};
   if(boundary==='permission')f.adopt();
   if(boundary==='disconnect')f.host.liveTransport.connected=false;
   f.view.render();
   // Restoring the original shape must not revive an intent cancelled on change.
   if(boundary!=='transport'){
    f.adopt(offered);
    f.host.liveTransport.connected=true;
    f.host.liveMedia.account='account';
    f.view.render();
   }
   finish();
   await first;
   await tick();
   assert.deepEqual(f.effects.map(intent=>intent.args.positionMs),[12000]);
  }finally{finish?.();await first;f.close();}
 });
}

test('seek does not coalesce across a queued skip or apply to its old track after acceptance',async()=>{
 const f=fixture();
 let first,finish;
 try{
  f.adopt({supported:[...actions,'seek']});
  const track=f.host.liveMedia.playback.item.uri,{witness}=f.view.musicSeekState(track);
  f.host.liveTransport.controlIntent=intent=>{
   f.effects.push(intent);
   return f.effects.length===1?new Promise(resolve=>finish=()=>resolve({outcome:'accepted'}))
    :Promise.resolve({outcome:'accepted'});
  };
  first=f.view.musicIntent('pause');
  await f.view.musicIntent('seek',{positionMs:12000,witness});
  await f.view.musicIntent('next');
  await f.view.musicIntent('seek',{positionMs:15000,witness});
  assert.deepEqual(f.view.musicQueued.intents.map(intent=>intent.action),['seek','next','seek']);
  finish();
  await first;
  await tick();
  assert.deepEqual(f.effects.map(intent=>[intent.action,intent.args.positionMs]),[
   ['pause',undefined],['seek',12000],['next',undefined],
  ]);
 }finally{finish?.();await first;f.close();}
});

test('v3 paused source offers resume without inferring an unavailable action',async()=>{
 const f=fixture();try{f.adopt({state:'paused',supported:['resume'],base:null,reason:'volume_unavailable'});f.view.render();assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(await f.view.musicIntent('pause'),false);assert.equal(f.setups.length,0);assert.equal(await f.view.musicIntent('resume'),true);assert.equal(f.effects.length,1);}finally{f.close();}
});
test('v3 gesture clamps a new draft to readonly policy35, never issues an effect or synthesizes an option',()=>{
 const f=fixture();try{f.view.render();const input=f.nodes.get('volume');input.value='80';input.dispatchEvent(new Event('input'));assert.equal(input.value,'35');assert.ok(f.feedback.includes('Højst 35 %'));assert.equal(f.setups.length,0);assert.equal(f.effects.length,0);assert.equal(f.view.volumeOffer,undefined);assert.equal(f.view.musicIntentOffer,undefined);}finally{f.close();}
});
test('v3 volume-unavailable preserves valid transport actions and never invents a volume',async()=>{
 const f=fixture();try{f.view.render();f.adopt({base:null,reason:'volume_unavailable',supported:['pause','next','previous']});f.view.render();assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.nodes.get('next').disabled,false);assert.equal(f.nodes.get('volume-value').textContent,'—');assert.equal(f.nodes.get('volume').disabled,true);assert.equal(await f.view.musicIntent('volume',{percent:20}),false);assert.equal(f.setups.length,0);}finally{f.close();}
});
test('readonly revocation clears hints without falling back to passive executable setup',async()=>{
 const f=fixture();try{f.view.render();f.adopt({status:'unavailable',reason:'control_not_granted',supported:[],base:null});f.view.render();assert.equal(f.nodes.get('play-pause').disabled,true);assert.equal(f.nodes.get('volume').disabled,true);assert.equal(f.nodes.get('volume-value').textContent,'—');assert.equal(f.view.musicReadonlyControls(),null);assert.equal(await f.view.musicIntent('pause'),false);assert.equal(f.setups.length,0);assert.equal(f.effects.length,0);}finally{f.close();}
});
test('fresh same-route readonly refresh during an unrelated held read never disables controls or requests setup',async()=>{
 const f=fixture();try{f.view.render();f.host.liveMedia.pending=true;for(let i=0;i<4;i++){f.adopt({base:100,effective:30+i});f.host.liveMedia.playback.poll_sequence=i+2;f.view.render();assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.nodes.get('volume').disabled,false);assert.equal(f.nodes.get('volume').value,'100');}assert.equal(f.setups.length,0);assert.equal(f.effects.length,0);}finally{f.close();}
});
test('v3 UNKNOWN never replays by itself; an explicit new tap is a new intent',async()=>{
 const f=fixture();try{f.view.render();f.host.liveTransport.controlIntent=async intent=>{f.effects.push(intent);return {outcome:'unknown',requestId:intent.requestId};};assert.equal(await f.view.musicIntent('pause'),true);f.view.render();await f.view.prepareMusic();f.host.liveMedia.playback.poll_sequence=2;f.view.render();assert.equal(f.effects.length,1,'reads and renders never replay');assert.equal(await f.view.musicIntent('pause'),true);assert.equal(f.effects.length,2);assert.notEqual(f.effects[0].requestId,f.effects[1].requestId);}finally{f.close();}
});
for(const change of ['owner','binding','disconnect'])test(`late direct receipt cannot publish after ${change}`,async()=>{
 const f=fixture();let finish,running;try{f.view.render();f.host.liveTransport.controlIntent=intent=>{f.effects.push(intent);return new Promise(resolve=>finish=()=>resolve({outcome:'accepted',requestId:intent.requestId}));};running=f.view.musicIntent('pause');assert.equal(f.effects.length,1);if(change==='owner')f.adopt({epoch:'new-owner'});if(change==='binding')f.adopt({binding:'b'.repeat(64)});if(change==='disconnect')f.host.liveTransport.connected=false;if(change==='revocation')f.adopt({status:'unavailable',reason:'control_not_granted',supported:[],base:null});f.view.render();const fence=f.view.musicFence;finish();await running;assert.equal(f.view.musicFence,fence);assert.equal(f.effects.length,1);}finally{finish?.();await running;f.close();}
});
test('readonly controls revoked after dispatch stay disabled when the historical receipt arrives',async()=>{
 const f=fixture();let finish,running;try{
  f.view.render();f.host.liveTransport.controlIntent=intent=>{f.effects.push(intent);return new Promise(resolve=>finish=()=>resolve({outcome:'accepted',requestId:intent.requestId}));};
  running=f.view.musicIntent('pause');f.adopt({status:'unavailable',reason:'control_not_granted',supported:[],base:null});f.view.render();finish();await running;
  assert.equal([...f.view.receipts.values()].at(-1).outcome,'accepted');assert.equal(f.nodes.get('play-pause').disabled,true);assert.equal(await f.view.musicIntent('pause'),false);assert.equal(f.effects.length,1);assert.equal(f.host.liveMedia.playback.state,'playing');
 }finally{finish?.();await running;f.close();}
});
test('accepted v3 feedback awaits its exact receipt despite a later readonly source poll',async()=>{
 const f=fixture();try{f.view.render();assert.equal(await f.view.musicIntent('volume',{percent:20}),true);await tick();assert.equal(f.view.musicFence.outcome,'accepted');assert.equal(f.view.musicStatus.hidden,true);const effects=f.effects.length,setups=f.setups.length;
  f.adopt({base:100,effective:35});f.host.liveMedia.playback.poll_sequence=2;f.view.render();await tick();assert.equal(f.view.musicFence.outcome,'accepted');assert.equal(f.view.musicSettlementReceipt().requestId,f.effects[0].requestId);assert.equal(f.view.musicStatus.hidden,true);assert.equal(f.nodes.get('volume-value').textContent,'20 %','unsettled explicit draft remains visible');assert.equal(f.view.musicMeasurement.volume,100,'later base100 is not proof of requested20');assert.equal(f.effects.length,effects);assert.equal(f.setups.length,setups);
 }finally{f.close();}
});
for(const change of ['remove-action','lower-ceiling'])test(`fresh v3 ${change} prevents an out-of-policy new draft`,async()=>{
 const f=fixture();try{if(change==='remove-action')f.adopt({supported:['pause'],base:100});else f.adopt({ceiling:20});f.view.render();assert.equal(await f.view.musicIntent('volume',{percent:30}),false);assert.equal(f.effects.length,0);}finally{f.close();}
});

test('unknown MOVE needs newer observation and a new explicit request',async()=>{
 const f=fixture();try{f.view.render();f.host.liveTransport.controlIntent=async intent=>{f.effects.push(intent);return {outcome:'unknown',requestId:intent.requestId};};assert.equal(await f.view.moveSpeaker(alias(),()=>true),true);assert.equal(await f.view.moveSpeaker(alias(),()=>true),false);f.adopt();f.host.liveMedia.playback.poll_sequence=2;f.view.render();assert.equal(f.effects.length,1);assert.equal(await f.view.moveSpeaker(alias(),()=>true),true);assert.notEqual(f.effects[0].requestId,f.effects[1].requestId);}finally{f.close();}
});
test('transport exception retains its own unknown action without replay',async()=>{
 const f=fixture();try{let calls=0;f.view.render();f.host.liveTransport.controlIntent=async()=>{calls++;throw Error('network');};assert.equal(await f.view.musicIntent('pause'),true);assert.equal(f.view.musicFence.action,'pause');assert.equal(f.view.musicFence.outcome,'unknown');assert.equal(f.view.moveUnknownFence,undefined);f.view.render();assert.equal(calls,1,'no automatic replay');assert.equal(await f.view.musicIntent('pause'),true);assert.equal(calls,2,'explicit tap is a new intent');}finally{f.close();}
});
for(const change of ['busy','invalid-target','binding-drift'])test(`unknown MOVE new explicit choice respects ${change}`,async()=>{
 const f=fixture();try{f.view.render();f.host.liveTransport.controlIntent=async intent=>{f.effects.push(intent);return {outcome:'unknown',requestId:intent.requestId};};assert.equal(await f.view.moveSpeaker(alias(),()=>true),true);f.adopt();f.host.liveMedia.playback.poll_sequence=2;f.view.render();const speaker=alias();if(change==='busy')f.view.musicIntentPending=true;if(change==='invalid-target')speaker.selectable=false;if(change==='binding-drift')f.host.liveMedia.playback.roomBinding.validUntil=Date.now()/1000-1;assert.equal(await f.view.moveSpeaker(speaker,()=>true),false);assert.equal(f.effects.length,1);}finally{f.close();}
});

test('composed recovery snapshot sends one direct move and never replays UNKNOWN',async()=>{
 const f=fixture(),requests=[];const t=new PodVoiceTransport({url:'https://ha.example/view/',fetch:async(url,init)=>{const body=JSON.parse(init.body);requests.push({path:new URL(url).pathname,body});return {ok:true,status:200,json:async()=>({ok:false,requestId:body.requestId,outcome:'unknown',retryAllowed:false,physicalResultVerified:false})};}});try{t.closed=false;t.connected=true;t.controller=new AbortController();f.host.liveSnapshot.capabilities.controlSetup=[];f.host.liveSnapshot.capabilities.musicMoveRecovery=['account'];t.snapshot=f.host.liveSnapshot;f.host.liveTransport=t;f.view.render();assert.equal(await f.view.musicIntent('pause'),false);assert.equal(await f.view.moveSpeaker(alias(),()=>true),true);assert.equal(requests.length,1);assert.equal(requests[0].path,'/view/api/control/actions');assert.equal(requests[0].body.target.speakerId,alias().speakerId);assert.equal(await f.view.moveSpeaker(alias(),()=>true),false);assert.equal(requests.length,1);}finally{t.close();f.close();}
});
test('recovery snapshot permits explicit MOVE only for active account while ordinary controls remain unavailable',async()=>{
 const f=fixture();try{f.host.liveSnapshot.capabilities.controlSetup=[];f.host.liveSnapshot.capabilities.musicMoveRecovery=['other'];f.view.render();assert.equal(f.view.musicContext(true),null);f.host.liveSnapshot.capabilities.musicMoveRecovery=['account'];f.view.render();assert.equal(f.view.musicContext(),null);assert.ok(f.view.musicContext(true));assert.equal(await f.view.musicIntent('pause'),false);f.setResponse(()=>{const v=f.offer('move_existing_session');v.options[0].id='move:'+alias().speakerId;return v;});assert.equal(await f.view.moveSpeaker(alias(),()=>true),true);assert.equal(f.effects.length,1);}finally{f.close();}
});
}

// Adopted reviewed music-volume-draft.test.js coverage.
{
class Node extends EventTarget{
 constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.isConnected=true;this.open=false;this.dataset={};this.textContent='';}
 append(...nodes){this.children.push(...nodes);}after(node){this.sibling=node;}replaceChildren(...nodes){this.children=nodes;}
 setAttribute(name,value){this.attributes??={};this.attributes[name]=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);}getAttribute(name){return this.attributes?.[name]??null;}
 querySelector(){return null;}querySelectorAll(){return [];}focus(){}showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}
}
const actions=['pause','resume','next','previous','volume'];
function fixture(){
 const previous=globalThis.document,nodes=new Map(),selectors=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,new Node('div'));return nodes.get(id);};
 globalThis.document={createElement:tag=>new Node(tag),getElementById:node,querySelector:selector=>selectors.get(selector)||null};const host=new Node('host');host.state={focus:'player',devices:[]};host.liveSnapshot={bootId:'boot',roomId:'room',providerGeneration:1,capabilities:{musicRead:['playback'],controlSetup:['music']}};
 host.querySelector=selector=>{if(!selectors.has(selector))selectors.set(selector,new Node('div'));return selectors.get(selector);};
 const wire=({base=100,effective=35,ceiling=35,state='playing',status='observed',reason=null,supported=actions,epoch='epoch',binding='a'.repeat(64),ttl=5}={})=>({ok:true,schema:'podview.room-playback.v3',bootId:'boot',roomId:'room',configEntryId:'account',status:'observed',reason:null,binding:{roomId:'room',accountId:'account',targetId:'device',nativeRoomId:'native-room',nativeHomepodId:'2',bindingId:binding,validUntil:Date.now()/1000+ttl},data:{ok:true,schema:'podconnect.playback.v1',config_entry_id:'account',owner_epoch:epoch,poll_sequence:1,physical_result_verified:false,observation:{status:'fresh',source:'spotify_web_api',observed_at:new Date().toISOString(),age_ms:0,max_age_ms:15000},playback:{state,target:{kind:'spotify_device',target_id:'device',name:'Bridge'},item:{type:'track',uri:'spotify:track:0123456789ABCDEFGHIJKL',name:'Song',artists:['Artist'],duration_ms:60000},progress_ms:1000,provider_changed_at_ms:null,shuffle:false,repeat:'off'}},controls:{status,reason,binding_id:status==='observed'?binding:null,valid_until:status==='observed'?Date.now()/1000+ttl:null,supported_actions:[...supported],volume:base===null?null:{base_percent:base,effective_percent:effective}},permissions:{actions:[...supported],maxVolume:supported.includes('volume')?ceiling:null}});
 host.liveMedia={account:'account'};const adopt=options=>{const body=wire(options);body.controls.valid_until=body.controls.status==='observed'?body.binding.validUntil:null;host.liveMedia.playback=roomPlaybackObservation(body,'account',host.liveSnapshot);return body;};adopt();
 const setups=[],effects=[],feedback=[];let serial=0,response;
 const offer=(requested,volume=35)=>{const n=++serial,chosen=requested?[requested]:actions;return {ok:true,schema:'podview.control.v1',bootId:'boot',roomId:'room',domain:'music',expectedBindingId:host.liveMedia.playback.roomBinding.bindingId,taskId:'control:'+n.toString(16).padStart(32,'0'),revision:1,expiresAt:Date.now()/1000+5,options:chosen.map((action,i)=>({id:(n*10+i).toString(16).padStart(24,'0'),action,label:action,argsSchema:action==='volume'?{kind:'percent',min:0,max:35}:{kind:'none'}})),setup:{volume}};};
 host.liveTransport={connected:true,generation:1,controlSetup:async(...args)=>{setups.push(args);return response?response(...args):offer(args[3]?.requestedAction);},controlIntent:async(intent)=>{effects.push(intent);return {ok:true,outcome:'accepted',requestId:intent.requestId};}};host.showFeedback=(message)=>feedback.push(message);host.liveMedia.captureAcceptedPlayRefresh=()=>()=>Promise.resolve({status:'matched'});
 const view=new LiveControlView(host);return {host,view,nodes,setups,effects,feedback,wire,adopt,offer,setResponse:fn=>response=fn,close(){view.cleanup();globalThis.document=previous;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const settle=(requestId,status='confirmed',sequence=1)=>({requestId,request_id:'epoch:'+sequence,command_sequence:sequence,owner_epoch:'epoch',status,effect:status==='confirmed'?{source:'native_bound_state',effect_revision:'1'}:null});
test('released slider preserves the explicit35 draft through a held700ms response instead of jumping to observed70',async()=>{
 const priorNow=Date.now;let clock=priorNow();Date.now=()=>clock;const f=fixture();let release,running;try{f.adopt({base:70,effective:70,ceiling:100});f.view.render();const input=f.nodes.get('volume');assert.equal(input.value,'70');input.dispatchEvent(new Event('pointerdown'));input.value='35';input.dispatchEvent(new Event('input'));assert.equal(input.value,'35');assert.equal(f.nodes.get('volume-value').textContent,'35 %');input.dispatchEvent(new Event('pointerup'));f.host.liveTransport.controlIntent=intent=>{f.effects.push(intent);return new Promise(resolve=>release=()=>resolve({outcome:'accepted',requestId:intent.requestId}));};running=f.view.musicIntent('volume',{percent:35});clock+=700;f.view.renderMusicControls();assert.equal(f.effects.length,1,'explicit intent has dispatched once');assert.equal(f.host.liveMedia.playback.controls.volume.base_percent,70,'the actual measurement remains untouched');assert.equal(input.value,'35','pending rerender cannot replace the chosen thumb with old observed70');assert.equal(f.nodes.get('volume-value').textContent,'35 %','numeric output retains chosen value; actual measurement is separately asserted');assert.equal(input.getAttribute('aria-valuetext'),'35 % valgt · observeret 70 %');assert.equal(f.feedback.length,0);release();await running;
 }finally{release?.();await running;f.close();Date.now=priorNow;}
});
for(const outcome of ['unknown','rejected'])test('volume POST '+outcome+' restores measured value without replay',async()=>{const f=fixture();try{f.adopt({base:70,effective:70,ceiling:100});f.view.render();f.host.liveTransport.controlIntent=async(intent)=>{f.effects.push(intent);return {outcome,requestId:intent.requestId};};assert.equal(await f.view.musicIntent('volume',{percent:35}),true);f.view.renderMusicControls();assert.equal(f.nodes.get('volume').value,'70');assert.equal(f.nodes.get('volume-value').textContent,'70 %');assert.equal(f.view.musicFence.volumeDraft,undefined);assert.equal(f.host.liveMedia.playback.controls.volume.base_percent,70);assert.equal(f.effects.length,1);if(outcome==='unknown'){assert.equal(f.nodes.get('volume').disabled,false,'unknown never locks volume');assert.equal(f.effects.length,1,'no automatic replay');}}finally{f.close();}});
// Direct rejected/unknown volume outcomes above preserve the measured value.

for(const status of ['unknown','confirmed','rejected','superseded'])test('volume source '+status+' preserves the truthful measurement until settlement',async()=>{const f=fixture();try{f.adopt({base:70,effective:70,ceiling:100});f.view.render();assert.equal(await f.view.musicIntent('volume',{percent:35}),true);assert.equal(f.nodes.get('volume').value,'35');assert.equal(f.nodes.get('volume-value').textContent,'35 %');const receipt=f.view.musicSettlementReceipt(),body=f.wire({base:70,effective:70,ceiling:100});body.controls.valid_until=body.binding.validUntil;body.settlement=settle(receipt.requestId,status);const p=roomPlaybackObservation(body,'account',f.host.liveSnapshot,undefined,{receiptRequestId:receipt.requestId});f.host.liveMedia.playback=p;assert.equal(f.view.observeMusicSettlement(p,receipt),true);f.view.renderMusicControls();assert.equal(f.view.musicMeasurement.volume,70);if(status==='unknown'){assert.equal(f.nodes.get('volume').value,'35');assert.equal(f.nodes.get('volume').getAttribute('aria-valuetext'),'35 % valgt · observeret 70 %');assert.equal(f.view.musicFence.settlementStatus,'unconfirmed');assert.equal(f.view.musicSettlementReceipt(),receipt,'interim source UNKNOWN retains the accepted receipt for passive reconciliation');const later=f.wire({base:35,effective:35,ceiling:100});later.controls.valid_until=later.binding.validUntil;later.settlement=settle(receipt.requestId,'confirmed');const confirmed=roomPlaybackObservation(later,'account',f.host.liveSnapshot,undefined,{receiptRequestId:receipt.requestId});f.host.liveMedia.playback=confirmed;assert.equal(f.view.observeMusicSettlement(confirmed,receipt),true);assert.equal(f.view.receipts.get(receipt.operationKey).settlementStatus,'confirmed');f.view.renderMusicControls();assert.equal(f.view.musicMeasurement.volume,35);}else{assert.equal(f.nodes.get('volume').value,'70');assert.equal(f.nodes.get('volume-value').textContent,'70 %');assert.equal(f.view.musicFence.volumeDraft,undefined);}assert.equal(f.effects.length,1);}finally{f.close();}});
test('actual matching measurement retires draft and updates both sliders from the source',async()=>{const f=fixture();try{f.adopt({base:70,effective:70,ceiling:100});f.view.render();await f.view.musicIntent('volume',{percent:35});f.adopt({base:35,effective:35,ceiling:100});f.view.renderMusicControls();for(const id of ['volume','detail-volume'])assert.equal(f.nodes.get(id).value,'35');assert.equal(f.nodes.get('volume-value').textContent,'35 %');assert.equal(f.view.musicFence.volumeDraft,undefined);assert.equal(f.view.musicMeasurement.volume,35);}finally{f.close();}});
test('zero draft never changes measured mute or remembered volume before source confirmation',async()=>{const f=fixture();try{f.adopt({base:70,effective:70,ceiling:100});f.view.render();let muteVM;f.host.playerView={syncVolumeMute:vm=>muteVM=vm};await f.view.musicIntent('volume',{percent:0});assert.equal(f.nodes.get('volume').value,'0');assert.equal(f.nodes.get('volume-value').textContent,'0 %');assert.equal(muteVM.volume,70,'mute consumes the real measured volume, not the zero draft');assert.equal(f.host.liveMedia.playback.controls.volume.base_percent,70);assert.equal(muteVM.canVolume,true);}finally{f.close();}});
for(const boundary of ['route','explicit-invalidate'])test('volume draft clears on '+boundary+' while a direct response is held',async()=>{const f=fixture();let release,running;try{f.adopt({base:70,effective:70,ceiling:100});f.view.render();f.host.liveTransport.controlIntent=intent=>{f.effects.push(intent);return new Promise(resolve=>release=()=>resolve({outcome:'accepted',requestId:intent.requestId}));};running=f.view.musicIntent('volume',{percent:35});assert.equal(f.nodes.get('volume').value,'35');if(boundary==='route'){f.adopt({base:15,effective:15,ceiling:100,binding:'b'.repeat(64)});f.view.render();}else{f.view.invalidateMusic(undefined,false);f.view.renderMusicControls();}assert.notEqual(f.nodes.get('volume').value,'35');release();await running;assert.equal(f.effects.length,1);assert.equal(f.view.musicFence?.volumeDraft,undefined);}finally{release?.();await running;f.close();}});
test('new pointer gesture supersedes an old unresolved draft, and keyboard commit owns its new value',async()=>{const f=fixture();let release,running;try{f.adopt({base:70,effective:70,ceiling:100});f.view.render();await f.view.musicIntent('volume',{percent:35});const input=f.nodes.get('volume');assert.equal(input.value,'35');input.dispatchEvent(new Event('pointerdown'));input.value='25';input.dispatchEvent(new Event('input'));f.view.renderMusicControls();assert.equal(input.value,'25');assert.equal(f.view.musicFence.volumeDraft,undefined);input.dispatchEvent(new Event('pointerup'));f.host.liveTransport.controlIntent=intent=>{f.effects.push(intent);return new Promise(resolve=>release=()=>resolve({outcome:'accepted',requestId:intent.requestId}));};running=f.view.musicIntent('volume',{percent:25});assert.equal(input.value,'25');release();await running;input.value='20';input.dispatchEvent(new Event('input'));f.view.renderMusicControls();assert.equal(input.value,'20','keyboard input owns presentation through a passive rerender');input.dispatchEvent(new Event('change'));f.host.liveTransport.controlIntent=intent=>{f.effects.push(intent);return new Promise(resolve=>release=()=>resolve({outcome:'accepted',requestId:intent.requestId}));};running=f.view.musicIntent('volume',{percent:20});assert.equal(input.value,'20');assert.match(input.getAttribute('aria-valuetext'),/20 % valgt · observeret 70 %/);release();await running;assert.equal(f.effects.length,3);}finally{release?.();await running;f.close();}});

test('expired actual binding removes an unresolved volume draft without renewing its deadline or replaying the held request',async()=>{const now=Date.now;let clock=now();Date.now=()=>clock;const f=fixture();let release,running;try{f.adopt({base:70,effective:70,ceiling:100});f.view.render();const until=f.host.liveMedia.playback.roomBinding.validUntil;f.host.liveTransport.controlIntent=intent=>{f.effects.push(intent);return new Promise(resolve=>release=()=>resolve({outcome:'accepted',requestId:intent.requestId}));};running=f.view.musicIntent('volume',{percent:35});assert.equal(f.nodes.get('volume').value,'35');clock+=6000;f.view.renderMusicControls();assert.equal(f.view.musicFence.volumeDraft,undefined);assert.equal(f.nodes.get('volume').value,'70');assert.equal(f.nodes.get('volume').disabled,true,'last measured display does not retain action authority');assert.equal(f.host.liveMedia.playback.roomBinding.validUntil,until);release();await running;assert.equal(f.effects.length,1);}finally{release?.();await running;f.close();Date.now=now;}});

test('radio range input never consumes retained Spotify bounds or mutates its volume draft',()=>{const f=fixture();try{f.adopt({base:35,effective:35,ceiling:35});f.view.render();const input=f.nodes.get('volume'),draft={percent:22};f.view.musicFence={volumeDraft:draft};f.host.liveRadio={ownsPlayer:()=>true,renderControls(){}};input.dispatchEvent(new Event('pointerdown'));input.value='81';input.dispatchEvent(new Event('input'));assert.equal(input.value,'81');assert.equal(f.view.musicFence.volumeDraft,draft);assert.equal(f.view.musicVolumeGesture,undefined);assert.deepEqual(f.effects,[]);assert.equal(f.feedback.some(text=>text.includes('Højst')),false);}finally{f.close();}});


test('explicit volume commits during held Next coalesce and send only the latest after accepted with fresh authority',async()=>{const f=fixture();let release,running;try{f.adopt({base:35,effective:35,ceiling:100});f.view.render();f.host.liveTransport.controlIntent=intent=>{f.effects.push(intent);if(intent.action==='next')return new Promise(resolve=>release=()=>resolve({outcome:'accepted',requestId:intent.requestId}));return Promise.resolve({outcome:'accepted',requestId:intent.requestId});};running=f.view.musicIntent('next');assert.equal(await f.view.musicIntent('volume',{percent:50}),true);assert.equal(f.nodes.get('volume').value,'50');assert.equal(f.nodes.get('volume').getAttribute('aria-valuetext'),'50 % valgt · observeret 35 %');assert.equal(await f.view.musicIntent('volume',{percent:60}),true);f.view.invalidateMusic(undefined,false,true);assert.equal(f.view.musicDeferred?.percent,60,'same-source reconciliation preserves explicit input');assert.equal(f.effects.length,1);release();await running;await tick();assert.deepEqual(f.effects.map(x=>x.action),['next','volume']);assert.deepEqual(f.effects[1].args,{percent:60});assert.notEqual(f.effects[0].requestId,f.effects[1].requestId);assert.equal(f.host.liveMedia.playback.controls.volume.base_percent,35);assert.equal(f.view.musicDeferred,null);}finally{release?.();await running;f.close();}});
for(const boundary of ['unknown','rejected','binding','disconnect','access','lower-ceiling','volume-removed'])test(`deferred volume never sends after ${boundary}`,async()=>{const f=fixture();let release,running;try{f.adopt({base:35,effective:35,ceiling:100});f.view.render();f.host.liveTransport.controlIntent=intent=>{f.effects.push(intent);return new Promise(resolve=>release=()=>resolve({outcome:boundary==='unknown'?'unknown':boundary==='rejected'?'rejected':'accepted',requestId:intent.requestId}));};running=f.view.musicIntent('next');assert.equal(await f.view.musicIntent('volume',{percent:50}),true);if(boundary==='binding')f.adopt({base:35,effective:35,ceiling:100,binding:'b'.repeat(64)});if(boundary==='disconnect')f.host.liveTransport.connected=false;if(boundary==='access')f.host.liveSnapshot.capabilities.controlSetup=[];if(boundary==='lower-ceiling'){f.adopt({base:35,effective:35,ceiling:40});f.view.renderMusicControls();assert.equal(f.nodes.get('volume').value,'35');}if(boundary==='volume-removed'){f.adopt({base:35,effective:35,ceiling:100,supported:['pause','next','previous']});f.view.renderMusicControls();assert.equal(f.nodes.get('volume').disabled,true);}release();await running;await tick();assert.deepEqual(f.effects.map(x=>x.action),['next']);assert.equal(f.view.musicDeferred,null);assert.ok(f.feedback.some(text=>/ikke sendt/.test(text)),boundary);}finally{release?.();await running;f.close();}});

test('three fast Next taps skip three songs in order, one at a time (A3)',async()=>{
 const f=fixture();const releases=[];try{f.view.render();
  f.host.liveTransport.controlIntent=intent=>{f.effects.push(intent);return new Promise(resolve=>releases.push(()=>resolve({outcome:'accepted',requestId:intent.requestId})));};
  const first=f.view.musicIntent('next');await tick();
  assert.equal(await f.view.musicIntent('next'),true);assert.equal(await f.view.musicIntent('next'),true);
  assert.equal(f.effects.length,1,'one command on the wire at a time');assert.equal(f.nodes.get('next').disabled,false);
  for(let n=0;n<3;n++){releases[n]?.();for(let i=0;i<5;i++)await tick();}
  await first;assert.deepEqual(f.effects.map(e=>e.action),['next','next','next']);assert.equal(new Set(f.effects.map(e=>e.requestId)).size,3);
 }finally{for(const release of releases)release();f.close();}
});
test('held pause then two explicit toggles keep Pause, Resume, Pause in FIFO order (A9)', async () => {
 const f = fixture(), releases = [];
 let first;
 try {
  f.adopt({supported: ['pause', 'next', 'previous', 'volume']});
  f.host.liveTransport.controlIntent = intent => {
   f.effects.push(intent);
   return new Promise(resolve => releases.push(() => resolve({outcome: 'accepted', requestId: intent.requestId})));
  };
  const toggle = () => f.view.musicIntent(
   f.view.optimisticPlaying(f.host.liveMedia.playback.state === 'playing') ? 'pause' : 'resume',
  );
  f.view.render();
  first = toggle();
  assert.equal(f.nodes.get('play-pause').getAttribute('aria-label'), 'Fortsæt musikken');
  assert.equal(await toggle(), true);
  assert.equal(f.nodes.get('play-pause').getAttribute('aria-label'), 'Sæt musik på pause');
  assert.equal(await toggle(), true);
  assert.equal(f.nodes.get('play-pause').getAttribute('aria-label'), 'Fortsæt musikken');
  assert.equal(f.nodes.get('play-pause').disabled, false);
  assert.deepEqual(f.effects.map(intent => intent.action), ['pause']);

  f.adopt({state: 'paused', supported: ['resume', 'next', 'previous', 'volume']});
  releases[0]();
  await first;
  await tick();
  assert.deepEqual(f.effects.map(intent => intent.action), ['pause', 'resume']);
  assert.equal(f.nodes.get('play-pause').getAttribute('aria-label'), 'Fortsæt musikken');

  f.adopt({supported: ['pause', 'next', 'previous', 'volume']});
  releases[1]();
  await tick();
  assert.deepEqual(f.effects.map(intent => intent.action), ['pause', 'resume', 'pause']);
  f.adopt({state: 'paused', supported: ['resume', 'next', 'previous', 'volume']});
  releases[2]();
  await tick();
  assert.equal(new Set(f.effects.map(intent => intent.requestId)).size, 3);
  assert.equal(f.nodes.get('play-pause').getAttribute('aria-label'), 'Fortsæt musikken');
 } finally {
  for (const release of releases) release();
  await first;
  f.close();
 }
});

for (const boundary of ['same-owner', 'binding', 'transport', 'access']) {
 test(`queued explicit skips never replay UNKNOWN after ${boundary}`, async () => {
  const f = fixture();
  let finish, first;
  try {
   f.host.liveTransport.controlIntent = intent => {
    f.effects.push(intent);
    const receipt = {outcome: 'accepted', requestId: intent.requestId};
    return f.effects.length === 1
     ? new Promise(resolve => { finish = () => resolve({...receipt, outcome: 'unknown'}); })
     : Promise.resolve(receipt);
   };
   first = f.view.musicIntent('next');
   assert.equal(await f.view.musicIntent('previous'), true);
   assert.equal(await f.view.musicIntent('next'), true);
   if (boundary === 'binding') f.adopt({binding: 'b'.repeat(64)});
   if (boundary === 'transport') f.host.liveTransport = {...f.host.liveTransport};
   if (boundary === 'access') f.host.liveSnapshot.capabilities.controlSetup = [];
   finish();
   await first;
   await tick();
   const expected = boundary === 'same-owner' ? ['next', 'previous', 'next'] : ['next'];
   assert.deepEqual(f.effects.map(intent => intent.action), expected);
   assert.equal(new Set(f.effects.map(intent => intent.requestId)).size, expected.length);
  } finally {
   finish?.();
   await first;
   f.close();
  }
 });
}

test('revoking and restoring music access cannot resurrect a queued tap', async () => {
 const f = fixture();
 let finish, first;
 try {
  f.host.liveTransport.controlIntent = intent => {
   f.effects.push(intent);
   const receipt = {outcome: 'accepted', requestId: intent.requestId};
   return f.effects.length === 1
    ? new Promise(resolve => { finish = () => resolve(receipt); })
    : Promise.resolve(receipt);
  };
  first = f.view.musicIntent('next');
  assert.equal(await f.view.musicIntent('previous'), true);
  f.host.liveSnapshot.capabilities.controlSetup = [];
  f.view.invalidateMusic(undefined, false, true);
  f.host.liveSnapshot.capabilities.controlSetup = ['music'];
  finish();
  await first;
  await tick();
  assert.deepEqual(f.effects.map(intent => intent.action), ['next']);
  assert.equal(await f.view.musicIntent('previous'), true);
  assert.deepEqual(f.effects.map(intent => intent.action), ['next', 'previous']);
 } finally {
  finish?.();
  await first;
  f.close();
 }
});

test('the latest explicit volume survives queued skips on the same output', async () => {
 const f = fixture(), releases = [];
 let first;
 try {
  f.adopt({base: 35, effective: 35, ceiling: 100});
  f.host.liveTransport.controlIntent = intent => {
   f.effects.push(intent);
   return new Promise(resolve => releases.push(() => resolve({outcome: 'accepted', requestId: intent.requestId})));
  };
  first = f.view.musicIntent('next');
  assert.equal(await f.view.musicIntent('volume', {percent: 50}), true);
  assert.equal(await f.view.musicIntent('previous'), true);
  assert.equal(await f.view.musicIntent('volume', {percent: 60}), true);
  releases[0]();
  await first;
  assert.deepEqual(f.effects.map(intent => intent.action), ['next', 'previous']);
  assert.equal(f.nodes.get('volume').value, '60');
  releases[1]();
  await tick();
  assert.deepEqual(f.effects.map(intent => intent.action), ['next', 'previous', 'volume']);
  assert.deepEqual(f.effects.at(-1).args, {percent: 60});
  releases[2]();
  await tick();
 } finally {
  for (const release of releases) release();
  await first;
  f.close();
 }
});

test('a tap during an in-flight intent is queued and sent next, never dropped or disabled',async()=>{
 const f=fixture();let release;try{f.view.render();
  f.host.liveTransport.controlIntent=intent=>{f.effects.push(intent);return f.effects.length===1?new Promise(resolve=>release=()=>resolve({outcome:'accepted',requestId:intent.requestId})):Promise.resolve({outcome:'accepted',requestId:intent.requestId});};
  const first=f.view.musicIntent('next');await tick();
  assert.equal(f.effects.length,1);assert.equal(f.nodes.get('next').disabled,false,'controls stay usable while sending');
  assert.equal(await f.view.musicIntent('next'),true,'second tap is accepted for sending');assert.equal(f.effects.length,1);
  release();await first;for(let i=0;i<5;i++)await tick();
  assert.equal(f.effects.length,2);assert.deepEqual(f.effects.map(e=>e.action),['next','next']);assert.notEqual(f.effects[0].requestId,f.effects[1].requestId);
 }finally{release?.();f.close();}
});

}

 test('household music copy never promotes ACK to success and keeps UNKNOWN free of retry advice',()=>{const f=fixture();try{
 for(const [action,label]of Object.entries({pause:'Musikken er sat på pause.',resume:'Afspilningen er startet.',next:'Skiftet til næste nummer.',previous:'Skiftet til forrige nummer.',volume:'Lydstyrken er ændret.'})){
 const row={domain:'music',action,outcome:'accepted'};assert.equal(f.view.receiptText(row),'Venter på højttaleren…');assert.equal(f.view.receiptText({...row,settlementStatus:'confirmed'}),label);assert.equal(f.view.receiptText({...row,settlementStatus:'unknown'}),'Kunne ikke bekræfte ændringen. Tjek afspilleren.');
 }
 assert.equal(f.view.receiptText({domain:'vacuum',outcome:'accepted'}),'Anmodningen er modtaget.');
 assert.match(f.view.receiptText({domain:'music',outcome:'rejected'}),/Prøv igen/);
 }finally{f.restore();}});
test('agreed music feedback: pending controls, no success toast, one failure and honest passive status',async()=>{const f=fixture();try{await f.view.prepareMusic();const c=f.view.musicContext(),calls=[];f.host.showFeedback=(message,pending)=>{calls.push({message,pending});f.host.feedbackMessage=message;};f.view.musicFence={key:c.key,action:'pause',outcome:'pending'};f.view.renderMusicControls();assert.equal(f.view.musicInlineStatus,'');assert.equal(calls.length,0);assert.equal(f.nodes.get('play-pause').getAttribute('aria-busy'),'true');f.view.musicFence={key:c.key,action:'pause',outcome:'accepted',settlementStatus:'confirmed'};f.view.renderMusicControls();assert.equal(calls.length,0);f.view.musicFence={key:c.key,action:'pause',outcome:'unknown'};f.view.renderMusicControls();assert.equal(calls.at(-1).message,'Kunne ikke bekræfte ændringen. Tjek afspilleren.');assert.equal(f.view.musicInlineStatus,'');f.view.musicFence={key:c.key,outcome:'unavailable',readFailure:true};f.view.renderMusicControls();assert.equal(f.view.musicInlineStatus,'Kan ikke styre højttaleren lige nu. Prøv igen om lidt.');}finally{f.restore();}});
