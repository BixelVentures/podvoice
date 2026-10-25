import {PlayerView} from '../../podvoice/gatekeeper/static/podview/player-view.js';
import {SpeakerOutputView} from '../../podvoice/gatekeeper/static/podview/speaker-output-view.js';
import {bindRoom,boundPlayback} from './room-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveControlView} from '../../podvoice/gatekeeper/static/podview/live-control-view.js';
class Node extends EventTarget{constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.isConnected=true;this.open=false;this.dataset={};this.textContent='';}append(...nodes){this.children.push(...nodes);}after(node){this.sibling=node;}setAttribute(name,value){this.attributes??={};this.attributes[name]=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}getAttribute(name){return this.attributes?.[name]??null;}replaceChildren(...nodes){this.children=nodes;}querySelector(){return null;}querySelectorAll(){return [];}focus(){}showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const observed=()=>({config_entry_id:'account',owner_epoch:'epoch',poll_sequence:1,expiresAt:Date.now()+15000,state:'playing',item:{uri:'spotify:track:0123456789ABCDEFGHIJKL'},target:{id:'device'}});
function fixture(){const previous=globalThis.document,nodes=new Map(),selectors=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,new Node('div'));return nodes.get(id);};globalThis.document={createElement:tag=>new Node(tag),getElementById:node,querySelector:selector=>selectors.get(selector)||null};const host=new Node('host');host.state={devices:[{id:'vacuum.actual',kind:'vacuum',live:true,stale:false,status:'cleaning'}]};host.liveMedia={playback:observed()};host.liveSnapshot={bootId:'boot',roomId:'room',capabilities:{controlSetup:['music']}};host.liveMedia.playback=boundPlayback(host.liveSnapshot,host.liveMedia.playback);host.querySelector=selector=>{if(!selectors.has(selector))selectors.set(selector,new Node('div'));return selectors.get(selector);};let reads=0;const writes=[];const offer=(options=['pause','resume','next','previous','volume'],volume=20)=>({ok:true,schema:'podview.control.v1',roomId:'room',bootId:'boot',domain:'music',taskId:'offer-'+(++reads),revision:1,expiresAt:Date.now()/1000+30,options:options.map(action=>({id:`opaque-${reads}-${action}`,action,label:action,argsSchema:action==='volume'?{kind:'percent',min:0,max:50}:{kind:'none'}})),expectedBindingId:host.liveMedia.playback.roomBinding.bindingId,setup:{volume}});host.liveTransport={connected:true,controlSetup:async()=>offer(),controlAction:async(task,id,args)=>{writes.push({task,id,args});return {ok:true,outcome:'accepted',requestId:'receipt'};}};const view=new LiveControlView(host);return {host,view,nodes,selectors,offer,writes,reads:()=>reads,restore(){view.cleanup();globalThis.document=previous;}};}


import {LiveQueueView} from '../../podvoice/gatekeeper/static/podview/live-queue-view.js';
import {NotificationQueue} from '../../podvoice/gatekeeper/static/podview/ui/notification-queue.js';
function queueFixture(){
 let serial=0,clock=0;const timers=new Map(),renders=[],actions=[],reads=[];
 const notifications=new NotificationQueue(item=>renders.push(item),{setTimer(callback){const id=++clock;timers.set(id,callback);return id;},clearTimer:id=>timers.delete(id)});
 const host={isConnected:true,liveSnapshot:{bootId:'boot',roomId:'kitchen',voice:{sessionId:'session'},capabilities:{queueSelection:true,musicRead:['queue']}},liveTransport:{connected:true},liveMedia:{account:'account',renderQueue(){},refresh:async()=>{}},showFeedback(message,pending,options){notifications.update(options.source,message,{pending});}};
 host.liveMedia.playback=boundPlayback(host.liveSnapshot,{owner_epoch:'epoch',poll_sequence:4,target:{id:'device'},expiresAt:Date.now()+15000});
 host.liveTransport.queueOffer=async()=>{const offer={ok:true,schema:'podview.queue-offer.v1',bootId:'boot',roomId:'kitchen',accountId:'account',targetId:'device',expectedBindingId:'a'.repeat(64),taskId:'queue:'+(++serial).toString(16).padStart(32,'0'),revision:1,expiresInMs:8000,ownerEpoch:'epoch',pollSequence:4,truncated:false,items:[{id:serial.toString(16).padStart(24,'0'),title:'Known queued song',artist:'Artist',uri:'spotify:track:'+'0'.repeat(22),artwork:null,order:1}]};reads.push(offer);return offer;};
 host.liveTransport.queueAction=async(offer,id)=>{actions.push({taskId:offer.taskId,id});return {outcome:'unknown'};};
 const view=new LiveQueueView(host);return {host,view,notifications,renders,actions,reads,close(){view.invalidate(true);notifications.cleanup();}};
}

for(const scenario of ['503','invalid DTO','superseded'])test(`control setup logs closed terminal ${scenario} without payload`,async()=>{
 const f=fixture(),events=[],held=deferred();f.host.liveTransport.recordDiagnostic=(stage,fields)=>events.push({stage,...fields});
 try{
  f.host.liveTransport.controlSetup=async()=>{if(scenario==='503')throw Error('503 PRIVATE TOKEN https://secret.example');if(scenario==='invalid DTO')return {...f.offer(),options:[]};return held.promise;};
  const read=f.view.prepareMusic();if(scenario==='superseded'){f.view.invalidateMusic(undefined,false);held.resolve(f.offer());}await read;
  assert.equal(events[0].code,'start');assert.equal(events.filter(e=>e.stage==='control_setup').at(-1).code,scenario==='503'?'failure':scenario==='invalid DTO'?'invalid_dto':'superseded');
  assert.equal(JSON.stringify(events).includes('PRIVATE'),false);assert.equal(JSON.stringify(events).includes('spotify:'),false);assert.equal(f.writes.length,0);
 }finally{f.restore();}
});
test('filtered volume malformed offer produces closed diagnostic without changing failed-read policy',async()=>{
 const f=fixture(),events=[];f.host.liveTransport.recordDiagnostic=(stage,fields)=>events.push({stage,...fields});
 try{f.host.liveTransport.controlSetup=async(d,t,r,o)=>o?.requestedAction?{...f.offer(['volume']),options:[]}:f.offer(['pause'],null);await f.view.prepareMusic();await f.view.prepareVolume();await f.view.prepareVolume();assert.deepEqual(events.filter(e=>e.stage==='volume_setup').map(e=>e.code),['start','invalid_dto']);assert.equal(f.writes.length,0);}finally{f.restore();}
});
test('queue valid-empty is distinct from invalid DTO and unknown action keeps existing request correlation',async()=>{
 const f=queueFixture(),events=[];f.host.liveTransport.recordDiagnostic=(stage,fields)=>events.push({stage,...fields});const original=f.host.liveTransport.queueOffer;
 try{
  f.host.liveTransport.queueOffer=async()=>({...await original(),items:[]});await f.view.load('account',f.host.liveMedia.playback);assert.equal(events.at(-1).code,'empty');assert.equal(events.at(-1).count,0);
  f.host.liveTransport.queueOffer=async()=>({...await original(),items:[{secret:'PRIVATE'}]});await f.view.load('account',f.host.liveMedia.playback);assert.equal(events.at(-1).code,'invalid_dto');
  f.host.liveTransport.queueOffer=original;await f.view.load('account',f.host.liveMedia.playback);f.host.liveTransport.queueAction=async()=>({outcome:'unknown',requestId:'00000000-0000-4000-8000-000000000001'});await f.view.choose(f.view.offer.items[0]);assert.equal(events.at(-1).code,'unknown');assert.equal(events.at(-1).requestId,'00000000-0000-4000-8000-000000000001');assert.equal(JSON.stringify(events).includes('PRIVATE'),false);assert.equal(JSON.stringify(events).includes('Known queued song'),false);
 }finally{f.close();}
});

import {LiveMusicCatalogueView} from '../../podvoice/gatekeeper/static/podview/live-music-view.js';
import {LiveMusicSelectionView} from '../../podvoice/gatekeeper/static/podview/live-music-selection-view.js';
const snapshot=()=>({bootId:'boot',roomId:'room',capabilities:{musicRead:['top','recent','liked','targets'],musicSelection:true},answers:{},voice:{}});
const art=index=>({kind:'album_cover',provider:'spotify',url:`https://i.scdn.co/image/cover${index}`});
function body(kind='top',count=6){return {ok:true,data:{config_entry_id:'account',tracks:Array.from({length:count},(_,index)=>({name:`Actual ${index}`,artist:'Actual artist',uri:`spotify:track:${String(index).padStart(22,'0')}`,artwork:art(index)}))},selection:{requested_limit:20,source_sample_count:count,returned_count:count,more_in_sample:false,size_limited:false},candidateSet:{schema:'podview.music-search-context.v1',bootId:'boot',roomId:'room',configEntryId:'account',source:'spotify_web_api',query:`${kind}:collection`,sourceKind:kind,candidateSetId:'a'.repeat(64),revisionScope:'music_selection',sessionId:'touch:session',turnId:'touch:turn',taskId:'touch:task',inputRevision:1,revision:1,items:Array.from({length:count},(_,index)=>({id:String(index).padStart(24,'a'),index}))}};}
function catalogue(){const renders=[],reads=[],host={state:{focus:'music'},isConnected:true,liveSnapshot:snapshot(),liveStatus:'connected',liveTransport:{connected:true},musicResults:{render:vm=>renders.push(vm)}};const view=new LiveMusicCatalogueView(host,kind=>reads.push(kind));host.liveCatalogue=view;view.updateCapabilities(true,snapshot().capabilities.musicRead);view.resetAccount('account');return {view,host,reads,renders,cleanup(){clearTimeout(view.expiryTimer);}};}
function selectionFixture({knownTarget=true}={}){const f=catalogue();f.view.select('top');f.view.tracks('top',body(),'account');const entry=f.view.entries.get(f.view.key()),view=Object.create(LiveMusicSelectionView.prototype),sent=[],setups=[];const target={accountId:'account',kind:'spotify_device',targetId:'device',name:'Actual speaker'};const node=()=>({textContent:'',hidden:false,disabled:false,value:'',open:false,setAttribute(){},replaceChildren(){},append(){},showModal(){this.open=true;},close(){this.open=false;}});Object.assign(view,{host:f.host,account:'account',generation:0,active:false,used:false,pending:false,source:null,offer:null,targets:[],dialog:node(),searchDialog:node(),note:node(),detail:node(),volume:node(),confirmButton:node(),targetSelect:node(),targetLabel:node(),render(){f.view.render();},showTargets(){}});f.host.liveSelection=view;bindRoom(f.host.liveSnapshot);f.host.liveMedia={account:'account',playback:knownTarget?{config_entry_id:'account',expiresAt:Date.now()+15000,state:'paused',target:{id:'device'}}:null};if(f.host.liveMedia.playback)f.host.liveMedia.playback=boundPlayback(f.host.liveSnapshot,f.host.liveMedia.playback);f.host.liveTransport.music=async()=>({ok:true,coverage:'account_targets',bootId:f.host.liveSnapshot.bootId,roomId:f.host.liveSnapshot.roomId,roomBinding:{...f.host.liveSnapshot.mediaRoomBindings[0]},data:{targets:[{...target,restricted:false,readOnly:false}]}});f.host.liveTransport.musicSelectionSetup=async(candidateSetId,issuedTarget,candidateIds)=>{setups.push({candidateSetId,issuedTarget,candidateIds});return {ok:true,schema:'podview.music-selection.v1',candidateSetId,accountId:'account',target:{kind:'spotify_device',targetId:'device'},taskId:'music-selection:'+'b'.repeat(32),revision:1,startVolumePercent:35,expiresIn:40,options:view.source.tracks.map((track,index)=>({id:String(index).padStart(24,'c'),label:track.name,artist:track.artist}))};};f.host.liveTransport.musicSelectionAction=async(offer,optionId)=>{sent.push({offer,optionId});return {outcome:'unknown'};};return {...f,view,entry,sent,setups,cleanup(){clearTimeout(f.view.expiryTimer);clearTimeout(view.expiryTimer);}};}

for(const superseded of [false,true])test(`selection receipt and finite confirmation share UUID even when presentation superseded=${superseded}`,async()=>{
 const f=selectionFixture(),events=[],confirmation=deferred(),requestId='00000000-0000-4000-8000-000000000002';
 f.host.liveTransport.recordDiagnostic=(stage,fields)=>events.push({stage,...fields});
 f.host.liveTransport.musicSelectionAction=async()=>({outcome:'accepted',requestId});
 f.host.liveMedia.captureAcceptedPlayRefresh=()=>()=>confirmation.promise;
 try{
  await f.view.chooseCard(f.entry.cards[0]);assert.equal(events.at(-1).code,'accepted');assert.equal(events.at(-1).requestId,requestId);
  if(superseded){f.view.resultTicket=null;f.view.feedback=null;f.host.liveTransport={connected:true,recordDiagnostic(){throw Error('must use captured transport');}};}
  confirmation.resolve({status:'unconfirmed'});await Promise.resolve();await Promise.resolve();
  assert.deepEqual(events.at(-1),{stage:'playback_confirmation',code:'unconfirmed',requestId});
  if(superseded)assert.equal(f.view.feedback,null);else assert.equal(f.view.feedback.awaitingObservation,false);
  assert.equal(JSON.stringify(events).includes('spotify:'),false);assert.equal(JSON.stringify(events).includes('Actual'),false);
 }finally{f.cleanup();}
});

test('control-state diagnostics emit only independent reason transitions or transport replacement',async()=>{
 const f=fixture(),events=[],held=deferred(),volumeHeld=deferred();f.host.liveTransport.recordDiagnostic=(stage,fields)=>events.push({stage,...fields});
 const states=()=>events.filter(e=>e.stage.endsWith('_state'));
 try{
  f.host.liveTransport.controlSetup=()=>held.promise;const read=f.view.prepareMusic();f.view.renderMusicControls();
  assert.equal(states().find(e=>e.stage==='control_state').code,'read_inflight');const initial=states().length;f.view.renderMusicControls();assert.equal(states().length,initial);
  held.resolve(f.offer(['pause'],null));await read;assert.equal(states().filter(e=>e.stage==='control_state').at(-1).code,'ok');
  f.host.liveTransport.controlSetup=()=>volumeHeld.promise;const volumeRead=f.view.prepareVolume();f.view.renderMusicControls();
  assert.equal(states().filter(e=>e.stage==='volume_state').at(-1).code,'read_inflight');assert.equal(f.nodes.get('play-pause').disabled,false);
  volumeHeld.resolve(f.offer(['volume'],35));await volumeRead;assert.equal(states().filter(e=>e.stage==='volume_state').at(-1).code,'ok');
  f.view.musicFence={...f.view.musicContext(),outcome:'unknown'};f.view.renderMusicControls();assert.deepEqual(states().slice(-2).map(e=>e.code),['unknown_fence','unknown_fence']);
  f.view.musicFence=null;f.view.spent.set(f.view.musicOffer.task.taskId,Date.now()/1000+30);f.view.renderMusicControls();assert.equal(states().filter(e=>e.stage==='control_state').at(-1).code,'ok','spent display task is not an intent lock or executable authority');assert.equal(f.writes.length,0);
  f.view.spent.clear();f.view.musicOffer.task.expiresAt=Date.now()/1000-1;f.view.renderMusicControls();assert.equal(states().filter(e=>e.stage==='control_state').at(-1).code,'ok','expired display task does not disable a fresh-JIT intent');assert.equal(f.writes.length,0);
  const before=states().length;f.view.renderMusicControls();assert.equal(states().length,before);
  f.host.liveTransport={...f.host.liveTransport};f.view.renderMusicControls();assert.equal(states().length,before+2);
  f.view.pending=true;f.view.renderMusicControls();assert.deepEqual(states().slice(-2).map(e=>e.code),['intent_pending','intent_pending']);f.view.pending=false;
  f.view.volumeOffer.task.volume=null;f.view.renderMusicControls();assert.equal(states().filter(e=>e.stage==='volume_state').at(-1).code,'unknown_value');
  f.view.volumeOffer.task.expiresAt=Date.now()/1000-1;f.view.renderMusicControls();assert.equal(states().filter(e=>e.stage==='volume_state').at(-1).code,'expiry');
  f.host.liveTransport.connected=false;f.view.renderMusicControls();assert.deepEqual(states().slice(-2).map(e=>e.code),['capability_missing','capability_missing']);
  assert.equal(f.writes.length,0);
 }finally{f.restore();}
});
