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
test('paired controls enable only issued actions and observed bounded volume in retained geometry',async()=>{const f=fixture();try{f.host.liveTransport.controlSetup=async()=>f.offer(['pause','next','volume'],35);await f.view.prepareMusic();f.view.renderMusicControls();assert.equal(f.nodes.get('play-pause').hidden,false);assert.equal(f.nodes.get('next').hidden,false);assert.equal(f.nodes.get('previous').hidden,false);assert.equal(f.nodes.get('previous').disabled,true);assert.equal(f.nodes.get('volume').value,'35');assert.equal(f.nodes.get('volume').max,'100');assert.equal(f.nodes.get('volume').dataset.actionMax,'50');assert.equal(f.writes.length,0);f.view.musicOffer.task.volume=null;f.view.renderMusicControls();assert.equal(f.selectors.get('.player .volume').hidden,false);assert.equal(f.nodes.get('volume').disabled,true);assert.equal(f.nodes.get('volume-value').textContent,'—');}finally{f.restore();}});
test('unpaired, stale or unnamed target can neither fetch setup nor send',async()=>{for(const change of [f=>f.host.liveSnapshot.capabilities.controlSetup=[],f=>f.host.liveMedia.playback.stale=true,f=>f.host.liveMedia.playback.target=null,f=>f.host.liveTransport.connected=false]){const f=fixture();try{change(f);await f.view.prepareMusic();assert.equal(await f.view.musicIntent('pause'),false);assert.equal(f.reads(),0);assert.equal(f.writes.length,0);}finally{f.restore();}}});
test('each explicit click uses fresh owner-issued task and ID exactly once without modal',async()=>{const f=fixture();try{await f.view.prepareMusic();const displayTask=f.view.musicOffer.task;assert.equal(await f.view.musicIntent('pause'),true);assert.equal(f.writes.length,1);assert.notEqual(f.writes[0].task.taskId,displayTask.taskId);assert.equal(f.writes[0].id,'opaque-2-pause');assert.deepEqual(f.writes[0].args,{});assert.equal(f.view.dialog.open,false);assert.equal(await f.view.musicIntent('pause'),true);assert.equal(f.writes.length,2);assert.notEqual(f.writes[0].task.taskId,f.writes[1].task.taskId,'a second explicit click obtains different fresh authority');}finally{f.restore();}});
test('rapid repeated click while setup or write pending admits one write',async()=>{const f=fixture();try{await f.view.prepareMusic();const setup=deferred(),action=deferred();f.host.liveTransport.controlSetup=()=>setup.promise;f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return action.promise;};const first=f.view.musicIntent('next');assert.equal(await f.view.musicIntent('next'),true);assert.equal(f.writes.length,0,'second explicit intent is retained, not prematurely dispatched');setup.resolve(f.offer());await new Promise(done=>setImmediate(done));assert.equal(f.writes.length,1);assert.equal(await f.view.musicIntent('next'),false);action.resolve({ok:true,outcome:'accepted'});await first;assert.equal(f.writes.length,1);}finally{f.restore();}});
for(const [name,change]of [['account',f=>f.host.liveMedia.playback.config_entry_id='other'],['epoch',f=>f.host.liveMedia.playback.owner_epoch='new'],['target',f=>f.host.liveMedia.playback.target.id='other'],['item',f=>f.host.liveMedia.playback.item.uri='spotify:track:0123456789ABCDEFGHIJKM'],['boot',f=>f.host.liveSnapshot.bootId='new'],['room',f=>f.host.liveSnapshot.roomId='other'],['permission',f=>f.host.liveSnapshot.capabilities.controlSetup=[]],['freshness',f=>f.host.liveMedia.playback.expiresAt=Date.now()-1]])test(`late ${name} replacement before fresh setup completes sends nothing`,async()=>{const f=fixture();try{await f.view.prepareMusic();const setup=deferred();f.host.liveTransport.controlSetup=()=>setup.promise;const request=f.view.musicIntent('pause');change(f);setup.resolve(f.offer());await request;assert.equal(f.writes.length,0);}finally{f.restore();}});
test('permission revoke then restore does not revive an in-flight same-context offer',async()=>{const f=fixture();try{await f.view.prepareMusic();const setup=deferred();f.host.liveTransport.controlSetup=()=>setup.promise;const request=f.view.musicIntent('pause');f.host.liveSnapshot.capabilities.controlSetup=[];f.view.render();f.host.liveSnapshot.capabilities.controlSetup=['music'];f.view.render();setup.resolve(f.offer());await request;assert.equal(f.writes.length,0);}finally{f.restore();}});
test('volume requires known setup value, exact max and explicit integer; next setup can withdraw action',async()=>{const f=fixture();try{await f.view.prepareMusic();f.host.liveTransport.controlSetup=async()=>f.offer(['volume'],null);assert.equal(await f.view.musicIntent('volume',{percent:30}),false);assert.equal(f.writes.length,0);f.view.musicOffer=null;f.view.musicAttempt=null;f.host.liveTransport.controlSetup=async()=>f.offer(['volume'],20);await f.view.prepareMusic();assert.equal(await f.view.musicIntent('volume',{percent:51}),false);assert.equal(f.writes.length,0);f.view.musicOffer=null;f.view.musicAttempt=null;await f.view.prepareMusic();f.host.liveTransport.controlSetup=async()=>f.offer(['pause'],20);assert.equal(await f.view.musicIntent('volume',{percent:30}),false);assert.equal(f.writes.length,0);}finally{f.restore();}});
test('unknown outcomes retain spent IDs and never retry from a repeated click or refresh',async()=>{const f=fixture();try{await f.view.prepareMusic();f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return {ok:false,outcome:'unknown',requestId:'r'};};assert.equal(await f.view.musicIntent('next'),true);assert.equal(await f.view.musicIntent('next'),false);await f.view.prepareMusic();assert.equal(f.writes.length,1);assert.match(f.view.musicStatus.textContent,/ukendt/);}finally{f.restore();}});
test('late accepted receipt after owner replacement remains correlated and changes no new controls',async()=>{const f=fixture();try{await f.view.prepareMusic();const action=deferred();f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return action.promise;};const request=f.view.musicIntent('pause');await new Promise(done=>setImmediate(done));assert.equal(f.writes.length,1);f.host.liveMedia.playback.config_entry_id='other';action.resolve({ok:true,outcome:'accepted',requestId:'r'});await request;assert.equal(f.view.musicStatus.hidden,true);assert.equal([...f.view.receipts.values()].at(-1).target.accountId,'account');assert.equal(f.view.musicOffer,null,'a dispatched effect invalidates executable sibling grants');assert.equal(f.view.musicIntentOffer.context.target.accountId,'account','only non-executable action knowledge remains');}finally{f.restore();}});

test('cleanup cancels source expiry without starting another preparation',async()=>{const f=fixture();try{await f.view.prepareMusic();const reads=f.reads();f.view.cleanup();await new Promise(done=>setImmediate(done));assert.equal(f.reads(),reads);assert.equal(f.view.musicOffer,null);assert.equal(f.writes.length,0);}finally{f.restore();}});
test('setup failure visibly reports an unavailable read and sends nothing',async()=>{const f=fixture();try{await f.view.prepareMusic();f.host.liveTransport.controlSetup=async()=>{throw Error('offline read');};assert.equal(await f.view.musicIntent('pause'),false);assert.match(f.view.musicStatus.textContent,/kunne ikke hentes/);assert.equal(f.writes.length,0);}finally{f.restore();}});

test('periodic observation preserves only an active pointer gesture and hides ambiguous volume actions',async()=>{const f=fixture();try{await f.view.prepareMusic();f.view.renderMusicControls();const input=f.nodes.get('volume');input.dispatchEvent(new Event('pointerdown'));input.value='31';f.view.renderMusicControls();assert.equal(input.value,'31');input.dispatchEvent(new Event('pointerup'));f.view.renderMusicControls();assert.equal(input.value,'20');const duplicate={...f.view.musicOffer.task.options.find(o=>o.action==='volume'),id:'other-volume'};f.view.musicOffer.task.options.push(duplicate);f.view.renderMusicControls();assert.equal(f.selectors.get('.player .volume').hidden,false);assert.equal(f.nodes.get('volume').disabled,true);assert.equal(f.nodes.get('volume-value').textContent,'20 %');}finally{f.restore();}});

test('account leave then return cannot revive the old pending setup',async()=>{const f=fixture();try{await f.view.prepareMusic();f.view.render();const setup=deferred();f.host.liveTransport.controlSetup=()=>setup.promise;const request=f.view.musicIntent('pause');f.host.liveMedia.playback.config_entry_id='other';f.view.render();f.host.liveMedia.playback.config_entry_id='account';f.view.render();setup.resolve(f.offer());await request;assert.equal(f.writes.length,0);}finally{f.restore();}});

test('shared feedback clearing cannot erase a later timer or other-domain notice',async()=>{const f=fixture();try{const messages=[];f.host.showFeedback=(message)=>{f.host.feedbackMessage=message;messages.push(message);};await f.view.prepareMusic();f.host.liveTransport.controlAction=async()=>({outcome:'unknown'});await f.view.musicIntent('next');assert.match(messages.at(-1),/ukendt/);f.host.feedbackMessage='Timeranmodningen er modtaget';f.host.liveMedia.playback.config_entry_id='other';f.view.renderMusicControls();assert.equal(f.host.feedbackMessage,'Timeranmodningen er modtaget');assert.equal(messages.includes(''),false);}finally{f.restore();}});


const alias=()=>({speakerId:'b'.repeat(64),accountId:'account',kind:'configured_alias',nativeRoomId:'r1',homepodId:'43',availability:'available',selectable:true,outputSelected:false});
function enableMove(f){f.host.liveTransport.controlSetup=async(domain,target)=>{f.moveTargets??=[];f.moveTargets.push(target);const value=f.offer(['move_existing_session']);value.options[0]={id:'move:'+alias().speakerId,action:'move_existing_session',label:'Flyt til actual Svend',argsSchema:{kind:'none'}};return value;};}
test('move obtains one exact alias option and sends once without changing player target/binding/metadata',async()=>{const f=fixture();try{enableMove(f);const before=JSON.stringify([f.host.liveSnapshot,f.host.liveMedia.playback]);assert.equal(await f.view.moveSpeaker(alias(),()=>true),true);assert.equal(f.moveTargets.length,1);assert.deepEqual(f.moveTargets[0],{accountId:'account',kind:'spotify_device',targetId:'device',expectedBindingId:'a'.repeat(64),speakerId:'b'.repeat(64)});assert.equal(f.writes.length,1);assert.equal(f.writes[0].id,'move:'+'b'.repeat(64));assert.deepEqual(f.writes[0].args,{});assert.equal(JSON.stringify([f.host.liveSnapshot,f.host.liveMedia.playback]),before);assert.equal(await f.view.moveSpeaker(alias(),()=>true),false);assert.equal(f.writes.length,1);assert.equal(f.view.musicOffer,null);}finally{f.restore();}});
test('rapid move/transport clicks share central setup/write pending and consume once',async()=>{const f=fixture();try{const setup=deferred(),write=deferred();enableMove(f);const make=f.host.liveTransport.controlSetup;f.host.liveTransport.controlSetup=()=>setup.promise;f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return write.promise;};const moving=f.view.moveSpeaker(alias(),()=>true);assert.equal(await f.view.moveSpeaker(alias(),()=>true),false);assert.equal(await f.view.musicIntent('pause'),false);setup.resolve(await make('music',{}));await new Promise(done=>setImmediate(done));assert.equal(f.writes.length,1);assert.equal(await f.view.moveSpeaker(alias(),()=>true),false);write.resolve({outcome:'accepted'});await moving;assert.equal(f.writes.length,1);}finally{f.restore();}});
for(const change of ['revoke','binding','account','transport','catalogue','generation'])test(`held move setup cannot act after ${change}`,async()=>{const f=fixture();try{enableMove(f);const make=f.host.liveTransport.controlSetup,hold=deferred();f.host.liveTransport.controlSetup=()=>hold.promise;let catalogue=true;const moving=f.view.moveSpeaker(alias(),()=>catalogue);if(change==='revoke')f.host.liveSnapshot.capabilities.controlSetup=[];if(change==='binding')f.host.liveSnapshot.mediaRoomBindings[0].bindingId='c'.repeat(64);if(change==='account')f.host.liveMedia.playback.config_entry_id='foreign';if(change==='transport')f.host.liveTransport={...f.host.liveTransport};if(change==='catalogue')catalogue=false;if(change==='generation')f.view.invalidate('changed',false);hold.resolve(await make('music',{}));await moving;assert.equal(f.writes.length,0);}finally{f.restore();}});
for(const change of ['wrongoption','wrongaction','extraoption','wrongroom','wrongboot','revision','expired','spent'])test(`move denies ${change} task without a write`,async()=>{const f=fixture();try{enableMove(f);const make=f.host.liveTransport.controlSetup;f.host.liveTransport.controlSetup=async(...args)=>{const v=await make(...args);if(change==='wrongoption')v.options[0].id='move:'+'c'.repeat(64);if(change==='wrongaction')v.options[0].action='pause';if(change==='extraoption')v.options.push({...v.options[0],id:'another'});if(change==='wrongroom')v.roomId='foreign';if(change==='wrongboot')v.bootId='old';if(change==='revision')v.revision=2;if(change==='expired')v.expiresAt=Date.now()/1000-1;if(change==='spent')f.view.spent.set(v.taskId,v.expiresAt);return v;};assert.equal(await f.view.moveSpeaker(alias(),()=>true),false);assert.equal(f.writes.length,0);}finally{f.restore();}});
test('move unknown never retries or repopulates the old offer',async()=>{const f=fixture();try{enableMove(f);f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return {outcome:'unknown'};};assert.equal(await f.view.moveSpeaker(alias(),()=>true),true);await f.view.prepareMusic();assert.equal(await f.view.moveSpeaker(alias(),()=>true),false);assert.equal(f.writes.length,1);assert.equal(f.view.musicOffer,null);}finally{f.restore();}});
test('ordinary SSE binding publication during move response cannot republish or replay old controls',async()=>{const f=fixture();try{enableMove(f);const hold=deferred();f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return hold.promise;};const moving=f.view.moveSpeaker(alias(),()=>true);await new Promise(done=>setImmediate(done));assert.equal(f.writes.length,1);const next={...f.host.liveSnapshot.mediaRoomBindings[0],nativeRoomId:'r1',nativeHomepodId:'43',bindingId:'c'.repeat(64)};f.host.liveSnapshot.mediaRoomBindings=[next];f.host.liveMedia.playback={...f.host.liveMedia.playback,roomBinding:{...next},poll_sequence:2};f.view.render();f.view.musicFence={key:'new-request',outcome:'pending'};hold.resolve({outcome:'accepted',requestId:'old-move'});await moving;assert.equal(f.view.musicFence.key,'new-request');assert.equal(f.writes.length,1);assert.equal(f.host.liveSnapshot.mediaRoomBindings[0].nativeRoomId,'r1');assert.equal([...f.view.receipts.values()].at(-1).outcome,'accepted');}finally{f.restore();}});
test('unsupported, unknown, selected or unpaired aliases cannot request a move setup',async()=>{for(const mutate of [a=>a.selectable=false,a=>a.availability='unknown',a=>{a.nativeRoomId='actual-room';a.homepodId='77';},a=>a.homepodId=null,a=>a.accountId='foreign',a=>a.speakerId='name']){const f=fixture();try{actualOutput(f);enableMove(f);const row=alias();mutate(row);assert.equal(await f.view.moveSpeaker(row,()=>true),false);assert.equal(f.moveTargets,undefined);}finally{f.restore();}}});

test('normal atomic MOVE destination observation restores controls without manual fence or attempt reset',async()=>{const f=fixture();try{await f.view.prepareMusic();f.view.render();const before=f.view.musicContext().key;enableMove(f);const hold=deferred();f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return hold.promise;};const moving=f.view.moveSpeaker(alias(),()=>true);await new Promise(done=>setImmediate(done));assert.equal(f.writes.length,1);const next={...f.host.liveSnapshot.mediaRoomBindings[0],nativeRoomId:'r1',nativeHomepodId:'43',bindingId:'c'.repeat(64)};f.host.liveSnapshot.mediaRoomBindings=[next];f.host.liveMedia.playback={...f.host.liveMedia.playback,roomBinding:{...next},poll_sequence:2};f.host.liveTransport.controlSetup=async()=>f.offer(['pause','next','volume'],27);f.view.render();assert.notEqual(f.view.musicContext().key,before);assert.equal(f.view.musicOffer,null);assert.equal(f.view.musicAttempt,null);hold.resolve({outcome:'accepted'});await moving;f.view.render();await new Promise(done=>setImmediate(done));assert.equal(f.view.musicOffer.context.key,f.view.musicContext().key);assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.nodes.get('volume').disabled,false);assert.equal(f.nodes.get('volume').value,'27');assert.equal(f.view.musicFence?.outcome,'accepted','legacy POST acceptance remains a receipt, never source confirmation');assert.equal(f.view.musicFence?.settlementStatus,undefined);assert.equal(f.writes.length,1);}finally{f.restore();}});
test('volume intent awaiting setup cannot follow an atomic same-engine destination replacement',async()=>{const f=fixture();try{await f.view.prepareMusic();const hold=deferred();f.host.liveTransport.controlSetup=()=>hold.promise;const intent=f.view.musicIntent('volume',{percent:27});const next={...f.host.liveSnapshot.mediaRoomBindings[0],nativeRoomId:'r1',nativeHomepodId:'43',bindingId:'c'.repeat(64)};f.host.liveSnapshot.mediaRoomBindings=[next];f.host.liveMedia.playback={...f.host.liveMedia.playback,roomBinding:{...next}};hold.resolve(f.offer());await intent;assert.equal(f.writes.length,0);}finally{f.restore();}});

test('MOVE closes existing rooms once only after admitted native dispatch starts, before response',async()=>{const f=fixture();try{enableMove(f);const before=JSON.stringify([f.host.liveSnapshot,f.host.liveMedia.playback]),hold=deferred(),events=[];f.host.ownerDocument={getElementById:id=>id==='rooms'?{close(){events.push('close');}}:document.getElementById(id)};f.host.liveTransport.controlAction=async(task,id,args)=>{events.push('dispatch');f.writes.push({task,id,args});return hold.promise;};const moving=f.view.moveSpeaker(alias(),()=>true);await new Promise(done=>setImmediate(done));assert.deepEqual(events,['dispatch','close']);assert.equal(JSON.stringify([f.host.liveSnapshot,f.host.liveMedia.playback]),before);assert.equal(await f.view.moveSpeaker(alias(),()=>true),false);assert.deepEqual(events,['dispatch','close']);hold.resolve({outcome:'accepted'});await moving;assert.deepEqual(events,['dispatch','close']);}finally{f.restore();}});
test('invalid or revoked MOVE admission never closes rooms',async()=>{for(const change of ['invalid','revoked']){const f=fixture();try{enableMove(f);let closed=0;f.host.ownerDocument={getElementById:id=>id==='rooms'?{close(){closed++;}}:document.getElementById(id)};const hold=deferred(),make=f.host.liveTransport.controlSetup;f.host.liveTransport.controlSetup=()=>hold.promise;const moving=f.view.moveSpeaker(alias(),()=>true);const task=await make('music',{});if(change==='invalid')task.options[0].id='wrong';else f.host.liveSnapshot.capabilities.controlSetup=[];hold.resolve(task);await moving;assert.equal(closed,0);assert.equal(f.writes.length,0);}finally{f.restore();}}});
test('rooms close exception cannot block dispatch or turn accepted MOVE into unknown',async()=>{const f=fixture();try{enableMove(f);f.host.ownerDocument={getElementById:id=>id==='rooms'?{close(){throw Error('detached dialog');}}:document.getElementById(id)};assert.equal(await f.view.moveSpeaker(alias(),()=>true),true);assert.equal(f.writes.length,1);assert.equal([...f.view.receipts.values()].at(-1).outcome,'accepted');}finally{f.restore();}});

for(const outcome of ['unknown','accepted'])test(`MOVE ${outcome} after catalogue expiry retains operation fence across actual catalogue reopen`,async()=>{
 const f=fixture();let outputs;try{
  enableMove(f);f.host.liveControls=f.view;f.host.liveMedia.account='account';f.host.liveSnapshot.capabilities.musicRead=['targets'];const rows=new Node('div'),note=new Node('p'),rooms=new Node('dialog');rooms.querySelector=()=>note;f.host.ownerDocument={createElement:tag=>new Node(tag),getElementById:id=>id==='room-options'?rows:id==='rooms'?rooms:id==='room-title'?new Node('h2'):document.getElementById(id)};
  const speaker=alias();f.host.liveTransport.music=async()=>({ok:true,schema:'podview.speaker-catalogue.v1',bootId:'boot',roomId:'room',accountId:'account',status:'observed',catalogueId:'d'.repeat(64),retrievedAt:Date.now()/1000,source:'podconnect.get_targets',speakers:[{...speaker,name:'Faktisk alias',default:false,nativeSelected:false}],moveAvailable:true,physicalResultVerified:false});
  outputs=new SpeakerOutputView(f.host);f.host.liveOutputs=outputs;await outputs.open();assert.equal(rows.children[0].disabled,false);
  const hold=deferred(),before=JSON.stringify([f.host.liveSnapshot,f.host.liveMedia.playback]);f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return hold.promise;};const moving=f.view.moveSpeaker(rows.children[0].speakerRow,()=>outputs.validUntil>Date.now());await new Promise(done=>setImmediate(done));assert.equal(f.writes.length,1);
  outputs.validUntil=Date.now()-1;hold.resolve({outcome,requestId:'terminal'});await moving;assert.equal(f.view.musicFence.outcome,outcome);assert.equal([...f.view.receipts.values()].at(-1).outcome,outcome);assert.equal(JSON.stringify([f.host.liveSnapshot,f.host.liveMedia.playback]),before);
  await outputs.open();assert.equal(rows.children[0].disabled,true);assert.equal(await f.view.moveSpeaker(speaker,()=>true),false);assert.equal(f.writes.length,1);if(outcome==='unknown'){await f.view.prepareMusic();assert.equal(f.view.musicOffer,null);}
 }finally{outputs?.cleanup();f.restore();}
});

for(const kind of ['prepare','intent','move'])test(`music-only invalidation fences held ${kind} setup even when context returns to the same key`,async()=>{
 const f=fixture();try{
  if(kind==='intent')await f.view.prepareMusic();
  if(kind==='move')enableMove(f);
  const make=f.host.liveTransport.controlSetup,hold=deferred();f.host.liveTransport.controlSetup=()=>hold.promise;
  const running=kind==='prepare'?f.view.prepareMusic():kind==='intent'?f.view.musicIntent('pause'):f.view.moveSpeaker(alias(),()=>true);
  const generation=f.view.generation,opening=f.view.opening,key=f.view.musicContext().key;
  f.view.invalidateMusic(undefined,false);
  assert.equal(f.view.generation,generation);assert.equal(f.view.opening,opening);assert.equal(f.view.musicContext().key,key);
  hold.resolve(await make('music',{}));await running;
  assert.equal(f.view.musicOffer,null);assert.equal(f.writes.length,0);assert.equal(f.view.musicReadPending||false,false);assert.equal(f.view.musicIntentPending||false,false);
 }finally{f.restore();}
});
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
test('music-only invalidation retains an unknown fence after a dispatched music write without revoking a vacuum task',async()=>{
 const f=fixture();try{
  await f.view.prepareMusic();f.view.domain='vacuum';const task={domain:'vacuum',taskId:'unrelated',expiresAt:Date.now()/1000+60};f.view.task=task;
  const hold=deferred();f.host.liveTransport.controlAction=async()=>hold.promise;
  const sending=f.view.musicIntent('pause');await new Promise(done=>setImmediate(done));assert.equal(f.view.activeOperation.domain,'music');
  f.view.invalidateMusic(undefined,false);assert.equal(f.view.task,task);assert.equal(f.view.musicFence.outcome,'unknown');
  hold.resolve({ok:true,outcome:'accepted',requestId:'late'});await sending;
  assert.equal(f.view.musicFence.outcome,'unknown');assert.equal(f.view.task,task);assert.equal(await f.view.musicIntent('pause'),false);
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

test('held music intent reserves effect ownership against robot open and send',async()=>{
 const f=fixture();const setup=deferred(),write=deferred();let intent;
 try{
  f.host.liveSnapshot.capabilities.controlSetup.push('vacuum');
  const vacuumOffer={ok:true,schema:'podview.control.v1',bootId:'boot',roomId:'room',domain:'vacuum',taskId:'robot-ready',revision:1,expiresAt:Date.now()/1000+60,options:[{id:'pause',action:'pause',label:'Pause',argsSchema:{kind:'none'}}],setup:{mapName:null}};
  f.host.liveTransport.controlSetup=async domain=>domain==='vacuum'?vacuumOffer:f.offer();
  await f.view.open('vacuum',{entityId:'vacuum.actual'},new Node('button'));
  const task=f.view.task;await f.view.prepareMusic();
  f.host.liveTransport.controlSetup=()=>setup.promise;
  f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return write.promise;};
  intent=f.view.musicIntent('pause');f.view.render();
  assert.equal(f.view.robotButton.disabled,true);assert.equal(f.view.robotPanel.disabled,true);
  const opening=f.view.opening;f.view.open('vacuum',{entityId:'vacuum.other'},new Node('button'));
  assert.equal(f.view.opening,opening);assert.equal(f.view.task,task);
  await f.view.send('pause',{});assert.equal(f.writes.length,0);
  setup.resolve(f.offer());await new Promise(done=>setImmediate(done));
  assert.equal(f.writes.length,1);assert.equal(f.view.activeOperation.domain,'music');
  write.resolve({ok:true,outcome:'accepted'});await intent;
  assert.equal(f.view.robotButton.disabled,false);assert.equal(f.view.robotPanel.disabled,false);
  await f.view.send('pause',{});assert.equal(f.writes.length,2);assert.equal(f.writes[1].task.domain,'vacuum');
 }finally{setup.resolve(f.offer());write.resolve({ok:true,outcome:'accepted'});await intent;f.restore();}
});
test('late music setup cannot replace an already occupied effect slot',async()=>{
 const f=fixture();const setup=deferred();let intent;
 try{
  await f.view.prepareMusic();f.host.liveTransport.controlSetup=()=>setup.promise;
  intent=f.view.musicIntent('pause');
  const operation={domain:'vacuum',key:'existing'};f.view.activeOperation=operation;f.view.pending=true;
  setup.resolve(f.offer());assert.equal(await intent,false);
  assert.equal(f.writes.length,0);assert.equal(f.view.activeOperation,operation);assert.equal(f.view.pending,true);
 }finally{setup.resolve(f.offer());await intent;f.view.pending=false;f.view.activeOperation=null;f.restore();}
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

test('failed passive preparation is not retried on the same poll and a newer read cannot bypass UNKNOWN intent',async()=>{
 const previousNow=Date.now;let clock=previousNow();Date.now=()=>clock;const f=fixture();try{
  let calls=0;f.host.liveTransport.controlSetup=async()=>{calls++;throw Error('temporary read failure');};
  await f.view.prepareMusic();await f.view.prepareMusic();assert.equal(calls,1);
  f.host.liveMedia.playback={...f.host.liveMedia.playback,poll_sequence:2,expiresAt:clock+15000};await f.view.prepareMusic();assert.equal(calls,2);
  const key=f.view.musicContext().key;f.view.musicFence={...f.view.musicContext(),outcome:'unknown'};
  f.host.liveMedia.playback={...f.host.liveMedia.playback,poll_sequence:3,expiresAt:clock+15000};
  await f.view.prepareMusic();assert.equal(calls,2);assert.equal(f.view.musicContext().key,key);assert.equal(await f.view.musicIntent('pause'),false);assert.equal(f.writes.length,0);assert.equal(f.view.musicFence.outcome,'unknown');
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


test('explicit MOVE supersedes only passive preparation and discards its late offer',async()=>{
 const f=fixture();try{
  const passive=deferred(),move=deferred();enableMove(f);const make=f.host.liveTransport.controlSetup;let reads=0;
  f.host.liveTransport.controlSetup=(domain,target)=>{reads++;return target.speakerId?move.promise:passive.promise;};
  const reading=f.view.prepareMusic();assert.equal(f.view.musicReadPending,true);
  const moving=f.view.moveSpeaker(alias(),()=>true);assert.equal(reads,2);assert.equal(f.view.setupPending,true);assert.equal(f.writes.length,0);
  passive.resolve(f.offer(['pause','next']));await reading;assert.equal(f.view.musicOffer,null);assert.equal(f.view.setupPending,true);
  move.resolve(await make('music',{}));assert.equal(await moving,true);assert.equal(f.writes.length,1);assert.equal(f.writes[0].id,'move:'+alias().speakerId);assert.equal(f.view.musicOffer,null);
 }finally{f.restore();}
});
for(const reason of ['stale','expired','unknown','pending','setup','intent'])test(`passive preparation cannot unlock MOVE after ${reason}`,async()=>{
 const f=fixture();try{
  const passive=deferred();f.host.liveTransport.controlSetup=()=>passive.promise;const reading=f.view.prepareMusic();
  if(reason==='stale')f.host.liveMedia.playback.stale=true;
  if(reason==='expired')f.host.liveMedia.playback.expiresAt=Date.now()-1;
  if(reason==='unknown')f.view.musicFence={key:f.view.musicContext().key,outcome:'unknown'};
  if(reason==='pending')f.view.pending=true;
  if(reason==='setup')f.view.setupPending=true;
  if(reason==='intent')f.view.musicIntentPending=true;
  assert.equal(await f.view.moveSpeaker(alias(),()=>true),false);assert.equal(f.reads(),0);assert.equal(f.writes.length,0);
  passive.resolve(f.offer());await reading;
 }finally{f.restore();}
});

test('late passive offer after MOVE UNKNOWN cannot restore controls or retry the effect',async()=>{
 const f=fixture();try{
  const passive=deferred();enableMove(f);const make=f.host.liveTransport.controlSetup;
  f.host.liveTransport.controlSetup=(domain,target)=>target.speakerId?make(domain,target):passive.promise;
  const reading=f.view.prepareMusic();f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return {outcome:'unknown'};};
  assert.equal(await f.view.moveSpeaker(alias(),()=>true),true);assert.equal(f.writes.length,1);assert.equal(f.view.musicFence.outcome,'unknown');
  passive.resolve(f.offer(['pause','next']));await reading;assert.equal(f.view.musicOffer,null);assert.equal(f.view.musicFence.outcome,'unknown');
  assert.equal(await f.view.moveSpeaker(alias(),()=>true),false);await f.view.prepareMusic();assert.equal(f.writes.length,1);assert.equal(f.view.musicOffer,null);
 }finally{f.restore();}
});

function actualOutput(f){
 const p=f.host.liveMedia.playback;f.host.liveSnapshot.capabilities.musicRead=['playback'];
 const binding={roomId:'room',accountId:'account',targetId:'actual-device',nativeRoomId:'actual-room',nativeHomepodId:'77',bindingId:'c'.repeat(64),validUntil:Date.now()/1000+15};
 Object.assign(p,{projectionVersion:2,observationStatus:'observed',roomBinding:binding,roomBound:true,readOnly:false,target:{id:binding.targetId},expiresAt:Date.now()+15000});return binding;
}
test('actual non-default v2 source owns control target and echoed ID without mutating the configured destination',async()=>{
 const f=fixture();try{
  const configured=structuredClone(f.host.liveSnapshot.mediaRoomBindings),binding=actualOutput(f),targets=[];
  f.host.liveTransport.controlSetup=async(domain,target)=>{targets.push(structuredClone(target));return f.offer(['pause']);};
  await f.view.prepareMusic();assert.deepEqual(targets,[{accountId:'account',kind:'spotify_device',targetId:'actual-device',expectedBindingId:binding.bindingId}]);
  assert.equal(await f.view.musicIntent('pause'),true);assert.equal(f.writes.length,1);assert.equal(f.writes[0].task.expectedBindingId,binding.bindingId);
  assert.deepEqual(f.host.liveSnapshot.mediaRoomBindings,configured);assert.equal(f.host.liveMedia.playback.target.id,'actual-device');
 }finally{f.restore();}
});
for(const echo of [undefined,'d'.repeat(64),'invalid'])test(`missing or foreign music binding echo ${echo} never becomes an offered or executable control`,async()=>{
 const f=fixture();try{actualOutput(f);f.host.liveTransport.controlSetup=async()=>({...f.offer(['pause']),expectedBindingId:echo});await f.view.prepareMusic();assert.equal(f.view.musicOffer,null);assert.equal(await f.view.musicIntent('pause'),false);assert.equal(f.writes.length,0);}finally{f.restore();}
});
test('an explicit intent rejects a foreign fresh echo after a valid display offer',async()=>{
 const f=fixture();try{actualOutput(f);await f.view.prepareMusic();f.host.liveTransport.controlSetup=async()=>({...f.offer(['pause']),expectedBindingId:'d'.repeat(64)});assert.equal(await f.view.musicIntent('pause'),false);assert.equal(f.writes.length,0);}finally{f.restore();}
});
test('current metadata without an actual route or with an expired actual binding cannot fetch controls',async()=>{
 for(const kind of ['account','expired']){const f=fixture();try{const binding=actualOutput(f);if(kind==='account')Object.assign(f.host.liveMedia.playback,{observationStatus:'account_observed',accountObserved:true,roomBound:false,roomBinding:null,readOnly:true});else binding.validUntil=Date.now()/1000-1;await f.view.prepareMusic();assert.equal(f.reads(),0);assert.equal(f.view.musicContext(),null);assert.equal(await f.view.musicIntent('next'),false);assert.equal(f.writes.length,0);}finally{f.restore();}}
});
test('actual binding replacement while fresh setup is held cannot send even though the default is unchanged',async()=>{
 const f=fixture();try{actualOutput(f);await f.view.prepareMusic();const waiting=deferred();f.host.liveTransport.controlSetup=()=>waiting.promise;const intent=f.view.musicIntent('pause');const previous=f.offer(['pause']);f.host.liveMedia.playback={...f.host.liveMedia.playback,roomBinding:{...f.host.liveMedia.playback.roomBinding,bindingId:'d'.repeat(64)}};waiting.resolve(previous);assert.equal(await intent,false);assert.equal(f.writes.length,0);}finally{f.restore();}
});
test('MOVE source is the current actual binding and expiry refresh alone does not replace that source identity',async()=>{
 const f=fixture();try{const binding=actualOutput(f);enableMove(f);const key=f.view.musicContext().key;binding.validUntil+=10;assert.equal(f.view.musicContext().key,key);assert.equal(await f.view.moveSpeaker(alias(),()=>true),true);assert.deepEqual(f.moveTargets[0],{accountId:'account',kind:'spotify_device',targetId:'actual-device',expectedBindingId:binding.bindingId,speakerId:alias().speakerId});assert.equal(f.writes.length,1);}finally{f.restore();}
});

test('a stale selected-output catalogue hint cannot override the actual MOVE source identity',async()=>{
 const f=fixture();try{actualOutput(f);enableMove(f);assert.equal(await f.view.moveSpeaker({...alias(),outputSelected:true},()=>true),true);assert.equal(f.writes.length,1);assert.equal(f.moveTargets[0].targetId,'actual-device');}finally{f.restore();}
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

test('observed100 stays truthful while a current max35 offer enables explicit lowering to35',async()=>{
 const f=fixture();try{
  actualOutput(f);f.host.liveTransport.controlSetup=async()=>{const raw=f.offer(['volume'],100);raw.options[0].argsSchema.max=35;return raw;};
  await f.view.prepareMusic();const input=f.nodes.get('volume');
  assert.equal(input.value,'100');assert.equal(input.max,'100');assert.equal(input.getAttribute('aria-valuetext'),'100 %');assert.equal(input.dataset.actionMax,'35');assert.equal(input.disabled,false);assert.equal(f.writes.length,0,'known high measurement never causes an implicit lowering');
  assert.equal(await f.view.musicIntent('volume',{percent:35}),true);assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0].args,{percent:35});assert.equal(input.value,'35','the slider retains the explicit choice while its numeric output stays measured');assert.equal(f.view.musicMeasurement.volume,100);assert.equal(f.nodes.get('volume-value').textContent,'100 %');
 }finally{f.restore();}
});
test('observed100 with a max35 offer permits the existing explicit mute action without inventing measured zero',async()=>{
 const f=fixture();try{
  actualOutput(f);let measured=100;f.host.live=true;f.host.liveTransport.controlSetup=async()=>{const raw=f.offer(['volume'],measured);raw.options[0].argsSchema.max=35;return raw;};
  const player=Object.create(PlayerView.prototype);Object.assign(player,{host:f.host,volumeMute:new Node('button'),rows:new Map()});f.host.playerView=player;
  let intent;f.host.music=event=>{assert.deepEqual(event,{type:'volume',value:0});intent=f.view.musicIntent('volume',{percent:event.value});};
  await f.view.prepareMusic();assert.equal(player.volumeMute.disabled,false);assert.equal(player.volumeMute.getAttribute('aria-pressed'),'false');assert.equal(f.writes.length,0);
  player.syncVolumeMute({volume:100,blocked:false,canVolume:true,min:1,max:35});assert.equal(player.volumeMute.disabled,true);player.toggleVolumeMute();assert.equal(intent,undefined,'mute cannot cross an action minimum');f.view.renderMusicControls();assert.equal(player.volumeMute.disabled,false);
  player.toggleVolumeMute();await intent;assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0].args,{percent:0});assert.equal(f.nodes.get('volume').value,'0');assert.equal(f.nodes.get('volume-value').textContent,'100 %');assert.equal(player.volumeMute.getAttribute('aria-pressed'),'false','mute follows measured volume, never the requested result');
  assert.equal(await f.view.musicIntent('volume',{percent:0}),true);assert.equal(f.writes.length,2,'a new explicit mute obtains fresh task authority');assert.notEqual(f.writes[0].task.taskId,f.writes[1].task.taskId);
  measured=0;f.host.liveMedia.playback.poll_sequence++;await f.view.prepareMusic();assert.equal(f.nodes.get('volume').value,'0');assert.equal(f.nodes.get('volume').disabled,false);assert.equal(player.volumeMute.getAttribute('aria-pressed'),'true');assert.equal(player.volumeRestore,100);assert.equal(player.volumeMute.disabled,true,'restore100 cannot exceed the fresh35 limit');player.toggleVolumeMute();assert.equal(f.writes.length,2);
 }finally{f.restore();}
});
for(const block of ['stale','expired','unknown','out-of-policy'])test(`high measured volume never bypasses ${block} control admission`,async()=>{
 const f=fixture();try{
  actualOutput(f);f.host.liveTransport.controlSetup=async()=>{const raw=f.offer(['volume'],100);raw.options[0].argsSchema.max=35;return raw;};await f.view.prepareMusic();
  assert.equal(f.nodes.get('volume').disabled,false);
  if(block==='stale')f.host.liveMedia.playback.stale=true;
  if(block==='expired')f.view.musicOffer.task.expiresAt=Date.now()/1000-1;
  if(block==='unknown')f.view.musicFence={...f.view.musicContext(),outcome:'unknown'};
  f.view.renderMusicControls();if(!['out-of-policy','expired'].includes(block))assert.equal(f.nodes.get('volume').disabled,true);
  assert.equal(await f.view.musicIntent('volume',{percent:block==='out-of-policy'?36:0}),block==='expired');assert.equal(f.writes.length,block==='expired'?1:0);if(block==='expired')assert.ok(f.writes[0].task.expiresAt*1000>Date.now(),'only the freshly issued task can dispatch');assert.equal(f.nodes.get('volume-value').textContent,'100 %');
 }finally{f.restore();}
});

for(const ending of ['failure','owner-change'])test(`explicit music intent shows immediate preparing feedback and cleans it after ${ending}`,async()=>{
 const f=fixture(),messages=[];let finish,reject;try{
  f.host.showFeedback=(message,pending)=>{messages.push({message,pending});f.host.feedbackMessage=message;};await f.view.prepareMusic();f.host.liveTransport.controlSetup=()=>new Promise((resolve,fail)=>{finish=resolve;reject=fail;});
  const intent=f.view.musicIntent('pause');assert.equal(f.view.musicStatus.textContent,'Afventer svar…');assert.equal(f.view.musicStatus.hidden,false);assert.deepEqual(messages.at(-1),{message:'Afventer svar…',pending:true});assert.equal(f.writes.length,0);assert.equal(f.view.musicDeferred,undefined);
  if(ending==='failure')reject(Error('inert unavailable'));else{f.host.liveMedia.playback.target.id='foreign';f.view.renderMusicControls();assert.equal(f.view.musicStatus.hidden,true);finish(f.offer(['pause']));}
  assert.equal(await intent,false);assert.equal(f.view.musicIntentPending,false);assert.equal(f.writes.length,0);assert.notEqual(f.view.musicStatus.textContent,'Afventer svar…');if(ending==='failure'){assert.match(f.view.musicStatus.textContent,/kunne ikke hentes/);assert.equal(messages.at(-1).pending,false);}
 }finally{finish?.(f.offer(['pause']));f.restore();}
});

for(const outcome of ['accepted','rejected','unknown'])test(`only an accepted music command schedules one ordinary read without a control matcher: ${outcome}`,async()=>{
 const f=fixture();try{let reads=0,captures=0;f.host.liveMedia.captureAcceptedPlayRefresh=()=>{captures++;return()=>{};};f.host.liveMedia.refresh=async()=>{reads++;};await f.view.prepareMusic();f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return {outcome};};assert.equal(await f.view.musicIntent('pause'),true);await Promise.resolve();assert.equal(captures,0);assert.equal(reads,outcome==='accepted'?1:0);assert.equal(f.writes.length,1);assert.equal(await f.view.musicIntent('pause'),outcome!=='unknown');assert.equal(f.writes.length,outcome==='unknown'?1:2);if(outcome!=='unknown')assert.notEqual(f.writes[0].task.taskId,f.writes[1].task.taskId);}finally{f.restore();}
});
test('accepted command after an actual owner change does not trigger the captured passive refresh',async()=>{
 const f=fixture();try{let reads=0;f.host.liveMedia.captureAcceptedPlayRefresh=()=>()=>{reads++;};await f.view.prepareMusic();const held=deferred();f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return held.promise;};const intent=f.view.musicIntent('pause');await new Promise(resolve=>setImmediate(resolve));f.host.liveMedia.playback.target.id='foreign';held.resolve({outcome:'accepted'});assert.equal(await intent,true);await Promise.resolve();assert.equal(reads,0);assert.equal(f.writes.length,1);}finally{f.restore();}
});

for(const reason of ['withdrawn-option','unknown-volume','spent-task'])test(`preparing feedback terminates honestly when fresh setup returns ${reason}`,async()=>{
 const f=fixture(),messages=[];try{
  f.host.showFeedback=(message,pending)=>messages.push({message,pending});await f.view.prepareMusic();const old=f.view.musicOffer.task;
  f.host.liveTransport.controlSetup=async()=>{if(reason==='spent-task')return {...f.offer(['pause']),taskId:old.taskId};return reason==='withdrawn-option'?f.offer(['next']):f.offer(['volume'],null);};
  assert.equal(await f.view.musicIntent(reason==='unknown-volume'?'volume':'pause',reason==='unknown-volume'?{percent:20}:{}),false);assert.equal(f.writes.length,0);assert.equal(f.view.musicIntentPending,false);assert.equal(f.view.musicFence.outcome,'unavailable');assert.match(f.view.musicStatus.textContent,/kunne ikke hentes/);assert.equal(messages.at(-1).pending,false);assert.equal(messages.some(value=>value.message==='Afventer svar…'&&value.pending),true);
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

test('accepted v2 control makes one ordinary read without manufacturing playback or selecting a source receipt',async()=>{
 const f=fixture();try{
  let matcherCalls=0,reads=0;f.host.liveMedia.captureAcceptedPlayRefresh=()=>{matcherCalls++;};f.host.liveMedia.refresh=async()=>{reads++;};
  await f.view.prepareMusic();const before=structuredClone(f.host.liveMedia.playback);
  assert.equal(await f.view.musicIntent('pause'),true);await new Promise(done=>setImmediate(done));
  assert.equal(matcherCalls,0);assert.equal(reads,1);assert.equal(f.view.musicSettlementReceipt(),null);assert.deepEqual(f.host.liveMedia.playback,before);assert.equal(f.writes.length,1);
 }finally{f.restore();}
});

test('lowering observed100 remains single-flight through held setup and UNKNOWN without replay or optimistic measurement',async()=>{
 const f=fixture();const held=deferred();let intent;try{
  actualOutput(f);const offer=()=>{const raw=f.offer(['volume'],100);raw.options[0].argsSchema.max=35;return raw;};f.host.liveTransport.controlSetup=async()=>offer();await f.view.prepareMusic();
  f.host.liveTransport.controlSetup=()=>held.promise;f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return {outcome:'unknown'};};
  intent=f.view.musicIntent('volume',{percent:35});assert.equal(f.nodes.get('volume').disabled,false);assert.equal(f.nodes.get('volume').value,'35');assert.equal(f.nodes.get('volume-value').textContent,'100 %');assert.equal(await f.view.musicIntent('volume',{percent:0}),true);assert.equal(f.view.musicDeferred.input.percent,0);assert.equal(f.writes.length,0);
  held.resolve(offer());await intent;assert.deepEqual(f.writes.map(write=>write.args),[{percent:35}]);assert.equal(f.view.musicFence.outcome,'unknown');assert.equal(f.nodes.get('volume').value,'100');assert.equal(f.nodes.get('volume').disabled,true);assert.equal(await f.view.musicIntent('volume',{percent:0}),false);assert.equal(f.writes.length,1);
 }finally{held.resolve(f.offer(['volume'],100));await intent;f.restore();}
});

for(const failure of ['rejected','invalid'])test(`passive ${failure} setup explains disabled controls and recovers only from a new poll with valid setup`,async()=>{
 const f=fixture();const held=deferred();try{
  actualOutput(f);let reads=0;f.host.liveTransport.controlSetup=async()=>{reads++;if(failure==='rejected')throw Error('inert control_setup_denied');return {...f.offer(['pause','volume'],35),expectedBindingId:'d'.repeat(64)};};
  const playback=structuredClone(f.host.liveMedia.playback);await f.view.prepareMusic();
  assert.equal(f.view.musicOffer,null);assert.equal(f.view.musicFence.outcome,'unavailable');assert.equal(f.view.musicFence.readFailure,true);assert.equal(f.view.musicStatus.hidden,false);assert.equal(f.view.musicStatus.textContent,'Betjeningen kunne ikke hentes');assert.equal(f.nodes.get('play-pause').disabled,true);assert.equal(f.nodes.get('volume').disabled,true);assert.deepEqual(f.host.liveMedia.playback,playback);assert.equal(f.writes.length,0);
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
test('passive setup never replaces an UNKNOWN command fence with read failure or recovery',async()=>{
 const f=fixture();try{
  actualOutput(f);await f.view.prepareMusic();f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return {outcome:'unknown'};};await f.view.musicIntent('pause');
  const fence=f.view.musicFence,reads=f.reads();f.host.liveMedia.playback.poll_sequence++;f.host.liveTransport.controlSetup=async()=>{throw Error('must not read past unknown');};await f.view.prepareMusic();
  assert.equal(f.view.musicFence,fence);assert.equal(f.view.musicFence.outcome,'unknown');assert.equal(f.view.musicFence.readFailure,undefined);assert.equal(f.view.musicStatus.textContent,'Udfald ukendt · gentages ikke');assert.equal(f.reads(),reads);assert.equal(f.writes.length,1);
 }finally{f.restore();}
});

for(const change of ['inputRevision','taskId','robot-status','vacuum-capability','robot-expiry'])test(`Robot-only ${change} invalidates Robot custody while pending fixed-player music retains its owner and receipt`,async()=>{
 const f=fixture();let finish,running;try{
  f.host.liveSnapshot.capabilities.controlSetup.push('vacuum');const raw={ok:true,schema:'podview.control.v1',bootId:'boot',roomId:'room',domain:'vacuum',taskId:'vacuum-seam',revision:1,expiresAt:Date.now()/1000+60,options:[{id:'robot-pause',action:'pause',label:'Pause rengøring',argsSchema:{kind:'none'}}],setup:{mapName:null}};
  f.host.liveTransport.controlSetup=async domain=>domain==='vacuum'?raw:f.offer(['pause','volume'],35);await f.view.open('vacuum',{entityId:'vacuum.actual'});await f.view.prepareMusic();assert.ok(f.view.robotControlOffer);assert.ok(f.view.musicIntentOffer);
  f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return new Promise(resolve=>finish=resolve);};running=f.view.musicIntent('pause');await new Promise(resolve=>setImmediate(resolve));assert.equal(f.writes.length,1);
  const operation=f.view.activeOperation,generation=f.view.generation,musicGeneration=f.view.musicGeneration,hint=f.view.musicIntentOffer,context=f.view.musicContext();assert.equal(operation.domain,'music');
  if(change==='robot-expiry')f.view.task.expiresAt=Date.now()/1000-1;else if(change==='robot-status')f.host.state.devices[0].status='paused';else if(change==='vacuum-capability')f.host.liveSnapshot.capabilities.controlSetup=['music'];else f.host.liveSnapshot[change]='new-robot-actor';f.view.render();
  assert.equal(f.view.task,null);assert.equal(f.view.robotControlOffer,null);assert.equal(f.view.musicContext().key,context.key);assert.equal(f.view.musicGeneration,musicGeneration);assert.equal(f.view.generation,generation);assert.equal(f.view.musicIntentOffer,hint);assert.equal(f.view.activeOperation,operation);assert.equal(f.view.pending,true);assert.equal(f.view.musicFence.outcome,'pending');assert.equal(f.view.receipts.get(operation.key).outcome,'pending');
  await f.view.send('robot-pause',{});assert.equal(f.writes.length,1,'invalidated Robot task cannot dispatch');finish({ok:true,outcome:'accepted',requestId:'same-music-owner'});await running;assert.equal(f.view.receipts.get(operation.key).outcome,'accepted');assert.equal(f.view.musicFence.outcome,'accepted');assert.equal(f.writes.length,1);
 }finally{finish?.({outcome:'unknown'});await running;f.restore();}
});

for(const change of ['boot','room','disconnect'])test(`shared ${change} still invalidates Robot and pending music together`,async()=>{
 const f=fixture();let finish,running;try{
  f.host.liveSnapshot.capabilities.controlSetup.push('vacuum');const raw={ok:true,schema:'podview.control.v1',bootId:'boot',roomId:'room',domain:'vacuum',taskId:'shared-seam',revision:1,expiresAt:Date.now()/1000+60,options:[{id:'robot-pause',action:'pause',label:'Pause',argsSchema:{kind:'none'}}],setup:{mapName:null}};f.host.liveTransport.controlSetup=async domain=>domain==='vacuum'?raw:f.offer();await f.view.open('vacuum',{entityId:'vacuum.actual'});await f.view.prepareMusic();
  f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return new Promise(resolve=>finish=resolve);};running=f.view.musicIntent('pause');await new Promise(resolve=>setImmediate(resolve));const musicGeneration=f.view.musicGeneration,operation=f.view.activeOperation;
  if(change==='boot')f.host.liveSnapshot.bootId='new-boot';if(change==='room')f.host.liveSnapshot.roomId='new-room';if(change==='disconnect')f.host.liveTransport.connected=false;f.view.render();
  assert.equal(f.view.task,null);assert.equal(f.view.robotControlOffer,null);assert.ok(f.view.musicGeneration>musicGeneration);assert.equal(f.view.musicIntentOffer,null);assert.equal(f.view.musicFence.outcome,'unknown');assert.equal(f.view.receipts.get(operation.key).outcome,'unknown');await f.view.send('robot-pause',{});assert.equal(f.writes.length,1);
 }finally{finish?.({outcome:'unknown'});await running;f.restore();}
});
test('Robot-only invalidation retains the in-flight vacuum lock until its real receipt settles',async()=>{
 const f=fixture();let finish,running;try{
  f.host.liveSnapshot.capabilities.controlSetup.push('vacuum');const raw={ok:true,schema:'podview.control.v1',bootId:'boot',roomId:'room',domain:'vacuum',taskId:'held-vacuum',revision:1,expiresAt:Date.now()/1000+60,options:[{id:'robot-pause',action:'pause',label:'Pause',argsSchema:{kind:'none'}}],setup:{mapName:null}};f.host.liveTransport.controlSetup=async domain=>domain==='vacuum'?raw:f.offer();await f.view.open('vacuum',{entityId:'vacuum.actual'});await f.view.prepareMusic();
  f.host.liveTransport.controlAction=async(task,id,args)=>{f.writes.push({task,id,args});return new Promise(resolve=>finish=resolve);};running=f.view.send('robot-pause',{});const operation=f.view.activeOperation;assert.equal(operation.domain,'vacuum');f.host.liveSnapshot.inputRevision=2;f.view.render();
  assert.equal(f.view.task,null);assert.equal(f.view.pending,true);assert.equal(f.view.activeOperation,operation);assert.equal(await f.view.musicIntent('pause'),false);assert.equal(f.writes.length,1);finish({ok:true,outcome:'accepted',requestId:'vacuum-settled'});await running;assert.equal(f.view.pending,false);assert.equal(f.view.activeOperation,null);assert.equal(f.writes.length,1);
 }finally{finish?.({outcome:'unknown'});await running;f.restore();}
});
