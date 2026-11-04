// Browser-side JIT and permanent UNKNOWN cases are replaced by direct v3
// lifecycle tests in root-second-move-lifecycle.test.mjs. Queue and selection
// retain their own shared music-effect conflict checks below.
import {boundPlayback} from './room-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveControlView} from '../../podvoice/gatekeeper/static/podview/live-control-view.js';
class Node extends EventTarget{constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.isConnected=true;this.open=false;this.dataset={};this.textContent='';}append(...nodes){this.children.push(...nodes);}after(node){this.sibling=node;}setAttribute(name,value){this.attributes??={};this.attributes[name]=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}getAttribute(name){return this.attributes?.[name]??null;}replaceChildren(...nodes){this.children=nodes;}querySelector(){return null;}querySelectorAll(){return [];}focus(){}showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const observed=()=>({config_entry_id:'account',owner_epoch:'epoch',poll_sequence:1,expiresAt:Date.now()+15000,state:'playing',item:{uri:'spotify:track:0123456789ABCDEFGHIJKL'},target:{id:'device'}});
function fixture(){const previous=globalThis.document,nodes=new Map(),selectors=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,new Node('div'));return nodes.get(id);};globalThis.document={createElement:tag=>new Node(tag),getElementById:node,querySelector:selector=>selectors.get(selector)||null};const host=new Node('host');host.state={devices:[{id:'vacuum.actual',kind:'vacuum',live:true,stale:false,status:'cleaning'}]};host.liveMedia={playback:observed()};host.liveSnapshot={bootId:'boot',roomId:'room',capabilities:{controlSetup:['music']}};host.liveMedia.playback=boundPlayback(host.liveSnapshot,host.liveMedia.playback);host.querySelector=selector=>{if(!selectors.has(selector))selectors.set(selector,new Node('div'));return selectors.get(selector);};let reads=0;const writes=[];const offer=(options=['pause','resume','next','previous','volume'],volume=20)=>({ok:true,schema:'podview.control.v1',roomId:'room',bootId:'boot',domain:'music',taskId:'offer-'+(++reads),revision:1,expiresAt:Date.now()/1000+30,options:options.map(action=>({id:`opaque-${reads}-${action}`,action,label:action,argsSchema:action==='volume'?{kind:'percent',min:0,max:50}:{kind:'none'}})),expectedBindingId:host.liveMedia.playback.roomBinding.bindingId,setup:{volume}});host.liveTransport={connected:true,controlSetup:async()=>offer(),controlAction:async(task,id,args)=>{writes.push({task,id,args});return {ok:true,outcome:'accepted',requestId:'receipt'};}};const view=new LiveControlView(host);return {host,view,nodes,selectors,offer,writes,reads:()=>reads,restore(){view.cleanup();globalThis.document=previous;}};}

test('passive setup failure remains inline without toast churn',async()=>{const f=fixture();try{const messages=[];f.host.showFeedback=(text,pending)=>messages.push({text,pending});f.host.liveTransport.controlSetup=async()=>{throw Error('inert unavailable');};await f.view.prepareMusic();for(let i=0;i<5;i++)f.view.renderMusicControls();assert.equal(f.view.musicStatus.textContent,'Kan ikke styre højttaleren lige nu. Prøv igen om lidt.');assert.deepEqual(messages,[]);assert.equal(f.writes.length,0);}finally{f.restore();}});

// Queue and selection still arbitrate conflicting music effects. The ordinary
// direct command is admitted from fresh v3 facts, without browser-side JIT.
function enableV3(f){
 const p=f.host.liveMedia.playback,b=p.roomBinding;b.validUntil=Date.now()/1000+15;
 Object.assign(p,{projectionVersion:3,observationStatus:'observed',controls:{status:'observed',binding_id:b.bindingId,valid_until:b.validUntil,volume:{base_percent:35,effective_percent:35}},permissions:{actions:['pause','resume','next','previous','volume'],maxVolume:35}});
 f.host.liveTransport.controlIntent=async intent=>{f.writes.push(intent);return {outcome:'accepted',requestId:intent.requestId};};
}

import {LiveQueueView} from '../../podvoice/gatekeeper/static/podview/live-queue-view.js';
import {LiveMusicSelectionView} from '../../podvoice/gatekeeper/static/podview/live-music-selection-view.js';
import {collectionSample,collectionSelection} from '../../podvoice/gatekeeper/static/podview/music-selection-model.js';
function attachQueue(f){
 Object.assign(f.host.liveSnapshot.capabilities,{queueSelection:true,musicRead:['queue','top','targets','playback'],musicSelection:true});f.host.liveMedia.account='account';f.host.liveMedia.renderQueue=()=>{};f.host.liveMedia.refresh=async()=>{};f.host.liveControls=f.view;
 let n=0;const requests=[];const issue=()=>({ok:true,schema:'podview.queue-offer.v1',bootId:'boot',roomId:'room',accountId:'account',targetId:'device',expectedBindingId:'a'.repeat(64),taskId:'queue:'+(++n).toString(16).padStart(32,'0'),revision:1,expiresInMs:8000,ownerEpoch:'epoch',pollSequence:1,truncated:false,items:[{id:n.toString(16).padStart(24,'0'),title:'Retained choice',artist:'Artist',uri:'spotify:track:'+'0'.repeat(22),artwork:null,order:1}]});
 f.host.liveTransport.queueOffer=async()=>{const raw=issue();requests.push(raw);return raw;};const actions=[];f.host.liveTransport.queueAction=async(task,id)=>{actions.push({task,id});return {outcome:'unknown'};};const queue=new LiveQueueView(f.host);f.host.liveMedia.queueControls=queue;return {queue,issue,requests,actions};
}
function attachSelection(f){
 f.host.state.focus='music';const track={name:'Chosen song',artist:'Artist',uri:'spotify:track:'+'1'.repeat(22)},raw={ok:true,data:{config_entry_id:'account',tracks:[track]},selection:{requested_limit:20,source_sample_count:1,returned_count:1,more_in_sample:false,size_limited:false},candidateSet:{schema:'podview.music-search-context.v1',bootId:'boot',roomId:'room',configEntryId:'account',source:'spotify_web_api',query:'top:collection',sourceKind:'top',candidateSetId:'a'.repeat(64),revisionScope:'music_selection',sessionId:'touch:session',turnId:'touch:turn',taskId:'touch:task',inputRevision:1,revision:1,items:[{id:'a'.repeat(24),index:0}]}};
 const source=collectionSelection(collectionSample(raw,'account','top',f.host.liveSnapshot),[0]),entry={source,cards:[]},selection=Object.create(LiveMusicSelectionView.prototype),node=()=>new Node('div');
 assert.ok(source);Object.assign(selection,{host:f.host,account:'account',generation:0,active:false,used:false,pending:false,source,offer:null,targets:[{accountId:'account',kind:'spotify_device',targetId:'device',name:'Actual room'}],dialog:node(),searchDialog:node(),note:node(),detail:node(),volume:node(),confirmButton:node(),targetSelect:node(),targetLabel:node(),collectionMode:true,collectionEntry:entry,collectionIndex:0,searchScope:{bootId:'boot',roomId:'room',accountId:'account'},render(){}});selection.targetSelect.value='device';f.host.liveSelection=selection;f.host.liveCatalogue={key:()=> 'top',entries:new Map([['top',entry]])};f.host.liveMedia.render=()=>f.view.renderMusicControls();
 const setup=()=>({ok:true,schema:'podview.music-selection.v1',candidateSetId:'a'.repeat(64),accountId:'account',target:{kind:'spotify_device',targetId:'device'},taskId:'music-selection:'+'b'.repeat(32),revision:1,startVolumePercent:35,expiresIn:40,options:[{id:'c'.repeat(24),label:track.name,artist:track.artist}]});
 return {selection,setup};
}
test('queue broker resolution holds the same effect lane as transport and preserves the shown opaque option',async()=>{
 const f=fixture();let finish;try{
  const q=attachQueue(f);enableV3(f);await q.queue.load('account',f.host.liveMedia.playback);const shown=q.queue.offer,visible=shown.items[0],held=deferred();finish=()=>held.resolve({outcome:'unknown'});f.host.liveTransport.queueAction=(task,id)=>{q.actions.push({task,id});return held.promise;};
  const choosing=q.queue.choose(visible);assert.equal(f.view.musicIntentPending,true);assert.equal(await f.view.musicIntent('pause'),false);assert.equal(f.writes.length,0);assert.equal(q.actions.length,1);assert.equal(q.actions[0].task,shown);assert.equal(q.actions[0].id,visible.id);assert.equal(q.requests.length,1);
  finish();await choosing;assert.equal(f.view.musicIntentPending,false);assert.equal(q.actions.length,1);assert.equal(q.actions[0].task.taskId,shown.taskId);assert.equal(q.actions[0].id,visible.id);assert.equal(q.queue.status,'unknown');await q.queue.choose(visible);assert.equal(q.actions.length,1,'UNKNOWN cannot be replayed');
 }finally{finish?.();f.host.liveMedia.queueControls?.invalidate(true);f.restore();}
});
test('selection setup through receipt owns the same lane; volume and queue cannot issue competing effects',async()=>{
 const f=fixture();try{
  const q=attachQueue(f);enableV3(f);await q.queue.load('account',f.host.liveMedia.playback);const visible=q.queue.offer.items[0],s=attachSelection(f),setupHeld=deferred(),actionHeld=deferred();let setups=0,effects=0;f.host.liveTransport.musicSelectionSetup=()=>{setups++;return setupHeld.promise;};f.host.liveTransport.musicSelectionAction=()=>{effects++;return actionHeld.promise;};
  const selecting=s.selection.setup(true);assert.equal(f.view.musicIntentPending,true);assert.equal(setups,1);assert.equal(await f.view.musicIntent('volume',{percent:20}),false);await q.queue.choose(visible);assert.equal(q.actions.length,0);assert.equal(f.writes.length,0);
  setupHeld.resolve(s.setup());await new Promise(resolve=>setImmediate(resolve));assert.equal(effects,1);assert.equal(f.view.musicIntentPending,true,'lane includes the pending effect');assert.equal(await f.view.musicIntent('next'),false);
  actionHeld.resolve({outcome:'unknown'});await selecting;assert.equal(effects,1);assert.equal(f.view.musicIntentPending,false);assert.equal(f.view.musicOffer,null);assert.equal(q.queue.offer,null);assert.equal(s.selection.offer,null);assert.equal(f.writes.length,0);clearTimeout(s.selection.expiryTimer);
 }finally{f.host.liveMedia.queueControls?.invalidate(true);f.restore();}
});
test('a superseded selection setup cannot unlock the current setup or send its old offer',async()=>{
 const f=fixture();try{
  attachQueue(f);const s=attachSelection(f),first=deferred(),second=deferred();let reads=0,effects=0;f.host.liveTransport.musicSelectionSetup=()=>++reads===1?first.promise:second.promise;f.host.liveTransport.musicSelectionAction=async()=>{effects++;return {outcome:'unknown'};};
  const old=s.selection.setup(true),replacement=s.selection.setup(true);first.resolve(s.setup());await old;assert.equal(f.view.musicIntentPending,true);assert.equal(effects,0);assert.equal(await f.view.musicIntent('pause'),false);second.resolve(s.setup());await replacement;assert.equal(effects,1);assert.equal(f.view.musicIntentPending,false);clearTimeout(s.selection.expiryTimer);
 }finally{f.host.liveMedia.queueControls?.invalidate(true);f.restore();}
});

function presentationFixture(){const f=fixture(),p=f.host.liveMedia.playback;f.host.liveSnapshot.capabilities.musicRead=['playback'];Object.assign(p,{projectionVersion:2,observationStatus:'observed',roomBound:true,readOnly:false,roomBinding:{roomId:'room',accountId:'account',targetId:'actual-device',nativeRoomId:'actual-room',nativeHomepodId:'77',bindingId:'c'.repeat(64),validUntil:Date.now()/1000+15},target:{id:'actual-device'}});return f;}

for(const change of ['transport','transport-generation','boot','room','account','epoch','binding','native-room','native-homepod','target','offline','stale','capability'])test(`readonly control hints do not survive actual ${change} custody replacement`,async()=>{
 const f=presentationFixture();let resolve;try{
  await f.view.prepareMusic();f.view.render();f.host.liveTransport.controlSetup=()=>new Promise(done=>resolve=done);const p=f.host.liveMedia.playback;
  if(change==='transport')f.host.liveTransport={...f.host.liveTransport};if(change==='transport-generation')f.host.liveTransport.generation=1;if(change==='provider')f.host.liveSnapshot.providerGeneration=1;if(change==='boot')f.host.liveSnapshot.bootId='replacement';if(change==='room')f.host.liveSnapshot.roomId='replacement';if(change==='account')p.config_entry_id='replacement';if(change==='epoch')p.owner_epoch='replacement';if(change==='binding')p.roomBinding.bindingId='d'.repeat(64);if(change==='native-room')p.roomBinding.nativeRoomId='replacement';if(change==='native-homepod')p.roomBinding.nativeHomepodId='88';if(change==='target'){p.target.id='replacement';p.roomBinding.targetId='replacement';}if(change==='offline')f.host.liveTransport.connected=false;if(change==='stale')p.stale=true;if(change==='capability')f.host.liveSnapshot.capabilities.controlSetup=[];
  f.view.render();assert.equal(f.view.musicIntentOffer,null);assert.equal(f.view.volumeIntentOffer,null);assert.equal(f.nodes.get('play-pause').disabled,true);assert.equal(f.nodes.get('volume').disabled,true);assert.equal(f.writes.length,0);
 }finally{resolve?.(f.offer());f.restore();}
});
