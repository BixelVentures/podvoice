import {boundPlayback} from './room-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveControlView} from '../../podvoice/gatekeeper/static/podview/live-control-view.js';
class Node extends EventTarget{constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.isConnected=true;this.open=false;this.dataset={};this.textContent='';}append(...nodes){this.children.push(...nodes);}after(node){this.sibling=node;}setAttribute(name,value){this.attributes??={};this.attributes[name]=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}getAttribute(name){return this.attributes?.[name]??null;}replaceChildren(...nodes){this.children=nodes;}querySelector(){return null;}querySelectorAll(){return [];}focus(){}showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const observed=()=>({config_entry_id:'account',owner_epoch:'epoch',poll_sequence:1,expiresAt:Date.now()+15000,state:'playing',item:{uri:'spotify:track:0123456789ABCDEFGHIJKL'},target:{id:'device'}});
function fixture(){const previous=globalThis.document,nodes=new Map(),selectors=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,new Node('div'));return nodes.get(id);};globalThis.document={createElement:tag=>new Node(tag),getElementById:node,querySelector:selector=>selectors.get(selector)||null};const host=new Node('host');host.state={devices:[{id:'vacuum.actual',kind:'vacuum',live:true,stale:false,status:'cleaning'}]};host.liveMedia={playback:observed()};host.liveSnapshot={bootId:'boot',roomId:'room',capabilities:{controlSetup:['music']}};host.liveMedia.playback=boundPlayback(host.liveSnapshot,host.liveMedia.playback);host.querySelector=selector=>{if(!selectors.has(selector))selectors.set(selector,new Node('div'));return selectors.get(selector);};let reads=0;const writes=[];const offer=(options=['pause','resume','next','previous','volume'],volume=20)=>({ok:true,schema:'podview.control.v1',roomId:'room',bootId:'boot',domain:'music',taskId:'offer-'+(++reads),revision:1,expiresAt:Date.now()/1000+30,options:options.map(action=>({id:`opaque-${reads}-${action}`,action,label:action,argsSchema:action==='volume'?{kind:'percent',min:0,max:50}:{kind:'none'}})),expectedBindingId:host.liveMedia.playback.roomBinding.bindingId,setup:{volume}});host.liveTransport={connected:true,controlSetup:async()=>offer(),controlAction:async(task,id,args)=>{writes.push({task,id,args});return {ok:true,outcome:'accepted',requestId:'receipt'};}};const view=new LiveControlView(host);return {host,view,nodes,selectors,offer,writes,reads:()=>reads,restore(){view.cleanup();globalThis.document=previous;}};}


test('expired passive grants and a held replacement do not disable explicit intent; late passive result cannot replace JIT authority',async()=>{
 const f=fixture();try{
  f.host.liveTransport.controlSetup=async()=>f.offer(['pause','next','volume'],35);await f.view.prepareMusic();f.view.musicOffer.task.expiresAt=Date.now()/1000-1;
  const held=deferred();let setups=0;f.host.liveMedia.playback.poll_sequence++;f.host.liveTransport.controlSetup=()=>++setups===1?held.promise:Promise.resolve(f.offer(['pause','next','volume'],35));
  const passive=f.view.prepareMusic();f.view.renderMusicControls();assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.nodes.get('next').disabled,false);assert.equal(f.nodes.get('volume').disabled,false);assert.equal(f.nodes.get('volume').value,'35');
  assert.equal(await f.view.musicIntent('pause'),true);assert.equal(setups,2);assert.equal(f.writes.length,1);assert.equal(f.writes[0].id,'opaque-2-pause');const fence=f.view.musicFence;
  held.resolve(f.offer(['previous'],null));await passive;assert.equal(f.view.musicFence,fence);assert.equal(f.view.musicOffer,null);assert.equal(f.writes.length,1);assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.nodes.get('previous').disabled,true,'a late passive offer cannot invent availability');
 }finally{f.restore();}
});
test('each separate volume gesture stays available after accepted effect but uses a newly issued task, invalidating siblings',async()=>{
 const f=fixture();try{
  let invalidations=0;f.host.liveMedia.queueControls={invalidate(revoke){assert.equal(revoke,false);invalidations++;},redraw(){}};f.host.liveTransport.controlSetup=async()=>f.offer(['volume'],35);await f.view.prepareMusic();const original=JSON.stringify(f.host.liveMedia.playback);
  for(const percent of [30,25]){assert.equal(await f.view.musicIntent('volume',{percent}),true);f.view.renderMusicControls();assert.equal(f.nodes.get('volume').disabled,false);assert.equal(f.nodes.get('volume').value,String(percent),'the thumb retains the explicit draft');assert.equal(f.nodes.get('volume-value').textContent,`${percent} %`,'numeric output retains explicit intent; measurement is asserted separately');assert.equal(f.view.musicMeasurement.volume,35);assert.equal(f.view.musicOffer,null);assert.equal(f.view.volumeOffer,null);}
  assert.equal(invalidations,2);assert.equal(f.writes.length,2);assert.notEqual(f.writes[0].task.taskId,f.writes[1].task.taskId);assert.deepEqual(f.writes.map(row=>row.args),[{percent:30},{percent:25}]);assert.equal(JSON.stringify(f.host.liveMedia.playback),original);
 }finally{f.restore();}
});
test('held JIT setup admits one effect only; UNKNOWN blocks further intent and never replays',async()=>{
 const f=fixture();try{
  await f.view.prepareMusic();const held=deferred();let reads=0;f.host.liveTransport.controlSetup=()=>{reads++;return held.promise;};f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return {outcome:'unknown'};};
  const first=f.view.musicIntent('next');assert.equal(await f.view.musicIntent('next'),true);assert.equal(reads,1);assert.equal(f.nodes.get('next').disabled,false);assert.equal(f.view.musicDeferred.action,'next');held.resolve(f.offer());await first;assert.equal(f.writes.length,1);assert.equal(await f.view.musicIntent('next'),false);await f.view.prepareMusic();assert.equal(reads,1);assert.equal(f.writes.length,1);
 }finally{f.restore();}
});
test('old owner and newly withdrawn actions cannot dispatch despite retained intent affordance',async()=>{
 for(const mode of ['owner','withdrawn']){const f=fixture();try{
  await f.view.prepareMusic();const held=deferred();f.host.liveTransport.controlSetup=()=>held.promise;const intent=f.view.musicIntent('pause');if(mode==='owner')f.host.liveMedia.playback.owner_epoch='new-owner';held.resolve(f.offer(['next'],35));await intent;assert.equal(f.writes.length,0);f.view.renderMusicControls();if(mode==='owner'){assert.equal(f.nodes.get('play-pause').disabled,true);assert.equal(await f.view.musicIntent('pause'),false);}
 }finally{f.restore();}}
});
test('passive setup failure remains inline without toast churn; explicit failed intent retains honest feedback',async()=>{
 const f=fixture();try{
  const messages=[];f.host.showFeedback=(text,pending)=>{f.host.feedbackMessage=text;messages.push({text,pending});};f.host.liveTransport.controlSetup=async()=>{throw Error('inert unavailable');};await f.view.prepareMusic();for(let i=0;i<5;i++)f.view.renderMusicControls();assert.equal(f.view.musicStatus.textContent,'Betjeningen kunne ikke hentes');assert.deepEqual(messages,[]);assert.equal(f.writes.length,0);
  f.host.liveMedia.playback.poll_sequence++;f.host.liveTransport.controlSetup=async()=>f.offer(['pause'],35);await f.view.prepareMusic();f.host.liveTransport.controlSetup=async()=>{throw Error('inert unavailable');};assert.equal(await f.view.musicIntent('pause'),false);assert.equal(messages[0].text,'Sætter på pause…');assert.equal(messages.at(-1).text,'Betjeningen kunne ikke hentes');assert.equal(f.writes.length,0);assert.equal(f.nodes.get('play-pause').disabled,false,'an explicit later click may obtain fresh authority');
 }finally{f.restore();}
});


test('retained volume intent cannot bypass the latest range or an explicit unknown measurement',async()=>{
 for(const mode of ['range','unknown']){const f=fixture();try{
  f.host.liveTransport.controlSetup=async()=>f.offer(['volume'],35);await f.view.prepareMusic();f.view.musicOffer.task.expiresAt=Date.now()/1000-1;
  f.host.liveTransport.controlSetup=async()=>{const raw=f.offer(['volume'],mode==='unknown'?null:35);raw.options[0].argsSchema.max=30;return raw;};
  assert.equal(await f.view.musicIntent('volume',{percent:35}),false);assert.equal(f.writes.length,0);assert.equal(f.nodes.get('volume-value').textContent,mode==='unknown'?'—':'35 %');if(mode==='unknown')assert.equal(f.nodes.get('volume').disabled,true);
 }finally{f.restore();}}
});

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
  const q=attachQueue(f);await f.view.prepareMusic();await q.queue.load('account',f.host.liveMedia.playback);const shown=q.queue.offer,visible=shown.items[0],held=deferred();finish=()=>held.resolve({outcome:'unknown'});f.host.liveTransport.queueAction=(task,id)=>{q.actions.push({task,id});return held.promise;};
  const choosing=q.queue.choose(visible);assert.equal(f.view.musicIntentPending,true);assert.equal(await f.view.musicIntent('pause'),true);assert.equal(f.writes.length,0);assert.equal(q.actions.length,1);assert.equal(q.actions[0].task,shown);assert.equal(q.actions[0].id,visible.id);assert.equal(q.requests.length,1);
  finish();await choosing;assert.equal(f.view.musicIntentPending,false);assert.equal(q.actions.length,1);assert.equal(q.actions[0].task.taskId,shown.taskId);assert.equal(q.actions[0].id,visible.id);assert.equal(q.queue.status,'unknown');await q.queue.choose(visible);assert.equal(q.actions.length,1,'UNKNOWN cannot be replayed');
 }finally{finish?.();f.host.liveMedia.queueControls?.invalidate(true);f.restore();}
});
test('selection setup through receipt owns the same lane; volume and queue cannot issue competing effects',async()=>{
 const f=fixture();try{
  const q=attachQueue(f);await f.view.prepareMusic();await q.queue.load('account',f.host.liveMedia.playback);const visible=q.queue.offer.items[0],s=attachSelection(f),setupHeld=deferred(),actionHeld=deferred();let setups=0,effects=0;f.host.liveTransport.musicSelectionSetup=()=>{setups++;return setupHeld.promise;};f.host.liveTransport.musicSelectionAction=()=>{effects++;return actionHeld.promise;};
  const selecting=s.selection.setup(true);assert.equal(f.view.musicIntentPending,true);assert.equal(setups,1);assert.equal(await f.view.musicIntent('volume',{percent:20}),true);await q.queue.choose(visible);assert.equal(q.actions.length,0);assert.equal(f.writes.length,0);
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

test('latest explicitly chosen volume is coalesced in one slot and dispatched only with a second fresh JIT task',async()=>{
 const f=fixture();try{
  const initial=()=>f.offer(['pause','volume'],35);f.host.liveTransport.controlSetup=async()=>initial();await f.view.prepareMusic();const held=deferred();let reads=0;f.host.liveTransport.controlSetup=()=>++reads===1?held.promise:Promise.resolve(f.offer(['volume'],35));
  const first=f.view.musicIntent('volume',{percent:30});assert.equal(f.nodes.get('volume').disabled,false);assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.selectors.get('.player .volume').getAttribute('aria-busy'),'true');
  assert.equal(await f.view.musicIntent('volume',{percent:25}),true);assert.equal(await f.view.musicIntent('volume',{percent:20}),true);assert.equal(f.view.musicDeferred.input.percent,20);assert.equal(reads,1);assert.equal(f.writes.length,0);
  held.resolve(f.offer(['volume'],35));await first;await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.writes.map(row=>row.args),[{percent:30},{percent:20}]);assert.equal(reads,2);assert.notEqual(f.writes[0].task.taskId,f.writes[1].task.taskId);assert.equal(f.view.musicDeferred,null);assert.equal(f.nodes.get('volume').value,'20','the thumb retains the latest explicitly dispatched draft');assert.equal(f.nodes.get('volume-value').textContent,'20 %','numeric output retains latest explicit intent; measurement is asserted separately');assert.equal(f.view.musicMeasurement.volume,35);assert.equal(f.nodes.get('volume').disabled,false);
 }finally{f.restore();}
});
test('Pause during held volume setup is retained once, not overwritten by excess input, and runs after the first receipt',async()=>{
 const f=fixture();try{
  const messages=[];f.host.showFeedback=text=>messages.push(text);await f.view.prepareMusic();const setupHeld=deferred(),actionHeld=deferred();let reads=0;f.host.liveTransport.controlSetup=()=>++reads===1?setupHeld.promise:Promise.resolve(f.offer(['pause'],35));f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return f.writes.length===1?actionHeld.promise:{outcome:'accepted'};};
  const first=f.view.musicIntent('volume',{percent:30});assert.equal(await f.view.musicIntent('pause'),true);assert.equal(await f.view.musicIntent('next'),false);assert.equal(f.view.musicDeferred.action,'pause');assert.ok(messages.includes('Afvent den igangværende handling.'));setupHeld.resolve(f.offer(['volume'],35));await new Promise(resolve=>setImmediate(resolve));assert.equal(f.writes.length,1);assert.equal(reads,1,'no second setup before first receipt');
  actionHeld.resolve({outcome:'accepted'});await first;await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,2);assert.deepEqual(f.writes.map(row=>row.id.split('-').at(-1)),['volume','pause']);assert.equal(f.view.musicIntentPending,false);
 }finally{f.restore();}
});
for(const ending of ['unknown','owner-change','disconnect'])test(`a deferred NEW volume is cancelled after ${ending}, without command replay`,async()=>{
 const f=fixture();try{
  const messages=[];f.host.showFeedback=text=>messages.push(text);await f.view.prepareMusic();const held=deferred();let reads=0;f.host.liveTransport.controlSetup=()=>{reads++;return held.promise;};f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return {outcome:'unknown'};};
  const first=f.view.musicIntent('volume',{percent:30});assert.equal(await f.view.musicIntent('volume',{percent:20}),true);if(ending==='owner-change')f.host.liveMedia.playback.owner_epoch='different-owner';if(ending==='disconnect')f.host.liveTransport.connected=false;held.resolve(f.offer(['volume'],35));await first;await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,1);assert.equal(f.writes.length,ending==='unknown'?1:0);assert.equal(f.view.musicDeferred,null);assert.ok(messages.includes('Det ventende valg blev ikke sendt.'));assert.equal(f.view.musicIntentPending,false);
 }finally{f.restore();}
});

test('mismatched Pause or Resume is rejected before acquiring the effect lane or requesting a task',async()=>{
 for(const state of ['playing','paused']){const f=fixture();try{
  f.host.liveMedia.playback.state=state;await f.view.prepareMusic();const before=f.reads();assert.equal(await f.view.musicIntent(state==='playing'?'resume':'pause'),false);assert.equal(f.view.musicIntentPending,undefined);assert.equal(f.view.musicIntentOwner,undefined);assert.equal(f.reads(),before);assert.equal(f.writes.length,0);assert.equal(await f.view.musicIntent(state==='playing'?'pause':'resume'),true);assert.equal(f.writes.length,1);
 }finally{f.restore();}}
});

function presentationFixture(){const f=fixture(),p=f.host.liveMedia.playback;f.host.liveSnapshot.capabilities.musicRead=['playback'];Object.assign(p,{projectionVersion:2,observationStatus:'observed',roomBound:true,readOnly:false,roomBinding:{roomId:'room',accountId:'account',targetId:'actual-device',nativeRoomId:'actual-room',nativeHomepodId:'77',bindingId:'c'.repeat(64),validUntil:Date.now()/1000+15},target:{id:'actual-device'}});return f;}
for(const change of ['track','state'])for(const reading of ['held','failed'])test(`fresh same actual route ${change} retains only readonly presentation through ${reading} setup`,async()=>{
 const f=presentationFixture();let resolve;try{
  f.host.liveTransport.controlSetup=async()=>f.offer(['pause','resume','next','previous','volume'],35);await f.view.prepareMusic();f.view.render();const prior=f.view.musicContext(),oldTask=f.view.musicOffer.task,oldBinding=JSON.stringify(f.host.liveMedia.playback.roomBinding);let reads=0;
  f.host.liveTransport.controlSetup=()=>{reads++;return reading==='held'?new Promise(done=>resolve=done):Promise.reject(Error('inert unavailable'));};
  if(change==='track')f.host.liveMedia.playback.item={uri:'spotify:track:'+'1'.repeat(22)};else f.host.liveMedia.playback.state='paused';f.host.liveMedia.playback.poll_sequence++;f.view.render();if(reading==='failed')await new Promise(done=>setImmediate(done));
  const current=f.view.musicContext();assert.notEqual(current.key,prior.key);assert.equal(current.presentationKey,prior.presentationKey);assert.equal(JSON.stringify(f.host.liveMedia.playback.roomBinding),oldBinding);assert.equal(reads,1);assert.equal(f.view.musicOffer,null);assert.equal(f.view.volumeOffer,null);assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.nodes.get('volume').disabled,false);assert.equal(f.nodes.get('volume-value').textContent,'35 %');assert.equal(f.writes.length,0);
  const hint=f.view.musicIntentOffer;assert.deepEqual(Object.keys(hint.task),['options']);assert.ok(hint.task.options.every(option=>Object.keys(option).sort().join(',')==='action,argsSchema'));assert.equal(hint.task.taskId,undefined);assert.equal(hint.task.revision,undefined);assert.equal(hint.task.expiresAt,undefined);assert.deepEqual(Object.keys(hint.context),['presentationKey']);assert.ok(oldTask.taskId,'old source task was not mutated or rebound');
  if(reading==='failed')assert.equal(f.view.musicStatus.textContent,'Betjeningen kunne ikke hentes');
 }finally{resolve?.(f.offer());f.restore();}
});
for(const change of ['track','state'])test(`explicit action after ${change} uses a fresh current JIT task, never readonly retained IDs`,async()=>{
 const f=presentationFixture();const passive=deferred(),jit=deferred();try{
  await f.view.prepareMusic();f.view.render();const old=f.view.musicOffer.task;let reads=0,expected;f.host.liveTransport.controlSetup=()=>++reads===1?passive.promise:jit.promise;f.host.liveMedia.captureAcceptedPlayRefresh=value=>{expected=value;return()=>{};};
  if(change==='track')f.host.liveMedia.playback.item={uri:'spotify:track:'+'1'.repeat(22)};else f.host.liveMedia.playback.state='paused';f.host.liveMedia.playback.poll_sequence++;f.view.render();const action=change==='state'?'resume':'pause',intent=f.view.musicIntent(action);assert.equal(reads,2);assert.equal(f.writes.length,0,'no effect while fresh authority is pending');const fresh=f.offer([action],35);jit.resolve(fresh);assert.equal(await intent,true);assert.equal(f.writes.length,1);assert.equal(f.writes[0].task.taskId,fresh.taskId);assert.notEqual(f.writes[0].task.taskId,old.taskId);assert.equal(f.writes[0].id,fresh.options[0].id);assert.equal(expected,undefined,'eligible controls never invoke the removed state matcher');assert.equal(f.host.liveMedia.playback.state,change==='state'?'paused':'playing','receipt does not change actual state');
  passive.resolve(f.offer(['previous'],null));await new Promise(done=>setImmediate(done));assert.equal(f.writes.length,1);assert.equal(f.view.musicOffer,null,'late passive task cannot revive an executable sibling');
 }finally{jit.resolve(f.offer());passive.resolve(f.offer());f.restore();}
});
test('a second URI change still rejects a held JIT and cancels a deferred explicit action',async()=>{
 const f=presentationFixture(),held=deferred();try{
  await f.view.prepareMusic();f.view.render();f.host.liveMedia.playback.item={uri:'spotify:track:'+'1'.repeat(22)};f.host.liveTransport.controlSetup=()=>held.promise;f.view.render();const intent=f.view.musicIntent('pause');assert.equal(await f.view.musicIntent('next'),true);f.host.liveMedia.playback.item={uri:'spotify:track:'+'2'.repeat(22)};f.view.render();assert.equal(f.view.musicDeferred,null);held.resolve(f.offer());assert.equal(await intent,false);await new Promise(done=>setImmediate(done));assert.equal(f.writes.length,0);
 }finally{held.resolve(f.offer());f.restore();}
});
for(const change of ['transport','transport-generation','provider','boot','room','account','epoch','binding','native-room','native-homepod','target','offline','stale','capability'])test(`readonly control hints do not survive actual ${change} custody replacement`,async()=>{
 const f=presentationFixture();let resolve;try{
  await f.view.prepareMusic();f.view.render();f.host.liveTransport.controlSetup=()=>new Promise(done=>resolve=done);const p=f.host.liveMedia.playback;
  if(change==='transport')f.host.liveTransport={...f.host.liveTransport};if(change==='transport-generation')f.host.liveTransport.generation=1;if(change==='provider')f.host.liveSnapshot.providerGeneration=1;if(change==='boot')f.host.liveSnapshot.bootId='replacement';if(change==='room')f.host.liveSnapshot.roomId='replacement';if(change==='account')p.config_entry_id='replacement';if(change==='epoch')p.owner_epoch='replacement';if(change==='binding')p.roomBinding.bindingId='d'.repeat(64);if(change==='native-room')p.roomBinding.nativeRoomId='replacement';if(change==='native-homepod')p.roomBinding.nativeHomepodId='88';if(change==='target'){p.target.id='replacement';p.roomBinding.targetId='replacement';}if(change==='offline')f.host.liveTransport.connected=false;if(change==='stale')p.stale=true;if(change==='capability')f.host.liveSnapshot.capabilities.controlSetup=[];
  f.view.render();assert.equal(f.view.musicIntentOffer,null);assert.equal(f.view.volumeIntentOffer,null);assert.equal(f.nodes.get('play-pause').disabled,true);assert.equal(f.nodes.get('volume').disabled,true);assert.equal(f.writes.length,0);
 }finally{resolve?.(f.offer());f.restore();}
});
test('unchanged UNKNOWN fence and never-offered Resume are not overridden by presentation retention',async()=>{
 const f=presentationFixture();let resolve;try{
  f.host.liveTransport.controlSetup=async()=>f.offer(['pause','volume'],35);await f.view.prepareMusic();f.view.render();const unknown={...f.view.musicContext(),outcome:'unknown'};f.view.musicFence=unknown;f.view.renderMusicControls();assert.equal(await f.view.musicIntent('pause'),false);assert.equal(f.nodes.get('play-pause').disabled,true);assert.equal(f.writes.length,0);
  f.host.liveTransport.controlSetup=()=>new Promise(done=>resolve=done);f.host.liveMedia.playback.state='paused';f.view.render();assert.equal(f.view.musicFence,unknown,'old receipt is not relabelled as success');assert.equal(f.nodes.get('play-pause').disabled,true,'Resume was never offered');assert.equal(f.nodes.get('volume').disabled,false);assert.equal(await f.view.musicIntent('resume'),false);assert.equal(f.writes.length,0);
 }finally{resolve?.(f.offer());f.restore();}
});
