import test from 'node:test';
import assert from 'node:assert/strict';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
import {LiveControlView} from '../../podvoice/gatekeeper/static/podview/live-control-view.js';
import {boundPlayback} from './room-fixture.mjs';

// Exact server setup failure envelope: podview_controls.py:152–153, setup:449–902.
const reasons=['invalid_setup','scope_not_paired','busy','invalid_target','target_not_granted','setup_capacity','stale_setup','setup_unavailable'];
class Node extends EventTarget{
 constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.isConnected=true;this.open=false;this.dataset={};this.textContent='';}
 append(...nodes){this.children.push(...nodes);}after(node){this.sibling=node;}replaceChildren(...nodes){this.children=nodes;}
 setAttribute(name,value){this.attributes??={};this.attributes[name]=String(value);}getAttribute(name){return this.attributes?.[name]??null;}
 querySelector(){return null;}querySelectorAll(){return [];}focus(){}showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}
}
function fixture(){
 const previous=globalThis.document,nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,new Node('div'));return nodes.get(id);};
 globalThis.document={createElement:tag=>new Node(tag),getElementById:node,querySelector:()=>null};
 const snapshot={bootId:'test',roomId:'room',capabilities:{controlSetup:['music']}},host=new Node('host');host.state={devices:[]};host.liveSnapshot=snapshot;
 host.liveMedia={playback:boundPlayback(snapshot,{owner_epoch:'epoch',poll_sequence:1,expiresAt:Date.now()+15000,state:'playing',item:{uri:'spotify:track:0123456789ABCDEFGHIJKL'},target:{id:'device'}})};
 const selectors=new Map();host.querySelector=selector=>{if(!selectors.has(selector))selectors.set(selector,new Node('div'));return selectors.get(selector);};
 const calls=[];let response;
 const transport=new PodVoiceTransport({url:'https://inert.invalid/view/',diagnosticStorage:null,fetch:async(url,options)=>{const path=new URL(url).pathname;calls.push({path,body:JSON.parse(options.body)});assert.equal(path,'/view/api/control/setup','no effect or other request is permitted');return {ok:true,status:200,json:async()=>await response};}});
 transport.closed=false;transport.connected=true;transport.snapshot=snapshot;transport.controller=new AbortController();host.liveTransport=transport;
 const view=new LiveControlView(host);
 const offer=(actions=['pause'],volume=null)=>({ok:true,schema:'podview.control.v1',roomId:'room',bootId:'test',domain:'music',taskId:'task',revision:1,expiresAt:Date.now()/1000+30,expectedBindingId:host.liveMedia.playback.roomBinding.bindingId,options:actions.map(action=>({id:action,action,label:action,argsSchema:action==='volume'?{kind:'percent',min:0,max:35}:{kind:'none'}})),setup:{volume}});
 return {host,view,transport,calls,offer,reply:value=>{response=value;},rows:()=>transport.diagnostics().records,cleanup(){view.cleanup();transport.close();globalThis.document=previous;}};
}
const terminal=(f,stage)=>f.rows().filter(row=>row.stage===stage&&row.code!=='start').at(-1);
function noEffects(f,count){assert.equal(f.calls.length,count);assert.ok(f.calls.every(call=>call.path==='/view/api/control/setup'));assert.notEqual(f.view.pending,true);}

for(const reason of reasons)for(const stage of ['control_setup','volume_setup'])test(`HTTP200 ${reason} is a closed ${stage} application refusal, never a binding mismatch or grant`,async()=>{
 const f=fixture();try{
  if(stage==='volume_setup'){f.reply(f.offer());await f.view.prepareMusic();assert.ok(f.view.musicOffer);}
  f.reply({ok:false,error:reason,retryAllowed:false});
  await(stage==='volume_setup'?f.view.prepareVolume():f.view.prepareMusic());
  const request=f.rows().filter(row=>row.stage==='request'&&row.code!=='start').at(-1);
  assert.equal(request.httpStatus,200);assert.equal(request.code,'ok');assert.equal(request.current,true);
  const result=terminal(f,stage);assert.equal(result.current,true);assert.equal(result.code,reason);
  if(stage==='control_setup'){assert.equal(f.view.musicOffer,null);assert.equal(f.view.musicFence.outcome,'unavailable');}else assert.equal(f.view.volumeOffer??null,null);
  noEffects(f,stage==='volume_setup'?2:1);
  await(stage==='volume_setup'?f.view.prepareVolume():f.view.prepareMusic());noEffects(f,stage==='volume_setup'?2:1);
 }finally{f.cleanup();}
});
for(const stage of ['control_setup','volume_setup'])test(`a successful ${stage} offer with a wrong binding stays a distinct strict binding rejection`,async()=>{
 const f=fixture();try{
  if(stage==='volume_setup'){f.reply(f.offer());await f.view.prepareMusic();}
  f.reply({...f.offer(stage==='volume_setup'?['volume']:['pause'],35),expectedBindingId:'b'.repeat(64)});
  await(stage==='volume_setup'?f.view.prepareVolume():f.view.prepareMusic());
  assert.equal(terminal(f,stage).code,'stale_binding');assert.equal((stage==='volume_setup'?f.view.volumeOffer:f.view.musicOffer)??null,null);noEffects(f,stage==='volume_setup'?2:1);
 }finally{f.cleanup();}
});
test('matching successful control and volume offers are still admitted without effects',async()=>{
 const f=fixture();try{f.reply(f.offer());await f.view.prepareMusic();assert.ok(f.view.musicOffer);assert.equal(terminal(f,'control_setup').code,'ok');f.reply(f.offer(['volume'],35));await f.view.prepareVolume();assert.equal(f.view.volumeOffer.task.volume,35);assert.equal(terminal(f,'volume_setup').code,'ok');noEffects(f,2);}finally{f.cleanup();}
});
for(const ending of ['owner','generation','disconnect','cleanup'])test(`late closed refusal after ${ending} cannot install a fence or authority for the replacement`,async()=>{
 const f=fixture();let finish;try{
  f.reply(new Promise(resolve=>finish=resolve));const reading=f.view.prepareMusic();
  if(ending==='owner')f.host.liveMedia.playback.owner_epoch='new-owner';
  if(ending==='generation')f.transport.generation++;
  if(ending==='disconnect')f.transport.connected=false;
  if(ending==='cleanup')f.view.cleanup();
  const fence=f.view.musicFence;finish({ok:false,error:'busy',retryAllowed:false});await reading;
  assert.equal(f.view.musicFence,fence);assert.equal(f.view.musicOffer,null);noEffects(f,1);
 }finally{f.cleanup();}
});
test('UNKNOWN blocks passive setup and explicit replay even if HTTP200 would issue a valid offer',async()=>{
 const f=fixture();try{f.view.musicFence={...f.view.musicContext(),outcome:'unknown'};f.reply(f.offer());await f.view.prepareMusic();assert.equal(await f.view.musicIntent('pause'),false);noEffects(f,0);assert.equal(f.view.musicFence.outcome,'unknown');}finally{f.cleanup();}
});
for(const body of [{ok:false,error:'unlisted_private_text',retryAllowed:false},{ok:false,error:'busy',retryAllowed:true},{ok:false,error:'busy',retryAllowed:false,privatePayload:'never log'}])test(`malformed refusal remains closed and cannot leak raw fields (${Object.keys(body).length} fields)`,async()=>{
 const f=fixture();try{f.reply(body);await f.view.prepareMusic();assert.equal(f.view.musicOffer,null);noEffects(f,1);const diagnostics=JSON.stringify(f.rows());assert.equal(diagnostics.includes('unlisted_private_text'),false);assert.equal(diagnostics.includes('never log'),false);assert.equal(terminal(f,'control_setup').code,'invalid_dto');}finally{f.cleanup();}
});

test('all closed refusals already remain unavailable and one-read fenced without executable authority',async()=>{
 for(const reason of reasons)for(const stage of ['control_setup','volume_setup']){
  const f=fixture();try{
   if(stage==='volume_setup'){f.reply(f.offer());await f.view.prepareMusic();}
   f.reply({ok:false,error:reason,retryAllowed:false});await(stage==='volume_setup'?f.view.prepareVolume():f.view.prepareMusic());
   if(stage==='control_setup'){assert.equal(f.view.musicOffer,null);assert.equal(f.view.musicFence.outcome,'unavailable');}else assert.equal(f.view.volumeOffer??null,null);
   await(stage==='volume_setup'?f.view.prepareVolume():f.view.prepareMusic());noEffects(f,stage==='volume_setup'?2:1);
  }finally{f.cleanup();}
 }
});

for(const reason of reasons)for(const action of ['pause','volume'])test(`explicit ${action} JIT HTTP200 ${reason} preserves exact refusal and consumes the old grant without an effect`,async()=>{
 const f=fixture();try{
  f.reply(f.offer(['pause','volume'],35));await f.view.prepareMusic();const old=f.view.musicOffer.task,context=f.view.musicContext();
  assert.ok(old.options.some(option=>option.action===action));assert.equal(f.calls.length,1);
  f.reply({ok:false,error:reason,retryAllowed:false});
  assert.equal(await f.view.musicIntent(action,action==='volume'?{percent:20}:{}),false);
  noEffects(f,2);assert.equal(f.calls[1].body.requestedAction,action==='volume'?'volume':undefined);
  assert.equal(f.calls[1].body.target.expectedBindingId,context.target.expectedBindingId);
  const result=terminal(f,action==='volume'?'volume_setup':'control_setup');assert.equal(result.code,reason);assert.equal(result.current,true);
  assert.equal(f.view.musicFence.key,context.key);assert.equal(f.view.musicFence.outcome,'unavailable');assert.equal(f.view.musicIntentPending,false);
  assert.equal(f.view.spent.has(old.taskId),true,'the original displayed executable grant stays consumed');assert.equal(f.view.musicOffer,null);assert.equal(f.view.volumeOffer??null,null);
  for(let i=0;i<3;i++)f.view.renderMusicControls();noEffects(f,2);assert.equal(f.view.spent.has(old.taskId),true,'redraw cannot renew or reuse the consumed grant');
 }finally{f.cleanup();}
});
