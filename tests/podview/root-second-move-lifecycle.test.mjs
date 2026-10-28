import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveControlView} from '../../podvoice/gatekeeper/static/podview/live-control-view.js';
import {SpeakerOutputView} from '../../podvoice/gatekeeper/static/podview/speaker-output-view.js';
import {LiveQueueView} from '../../podvoice/gatekeeper/static/podview/live-queue-view.js';
import {LiveMediaView} from '../../podvoice/gatekeeper/static/podview/live-media-view.js';
import {roomPlaybackObservation} from '../../podvoice/gatekeeper/static/podview/media-observation.js';
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
 host.liveTransport={connected:true,generation:1,controlSetup:async(...args)=>{setups.push(args);return response?response(...args):offer(args[3]?.requestedAction);},controlAction:async(task,id,args)=>{effects.push({task,id,args});return {ok:true,outcome:'accepted',requestId:'receipt'};}};host.showFeedback=(message)=>feedback.push(message);
 const view=new LiveControlView(host);return {host,view,nodes,setups,effects,feedback,wire,adopt,offer,setResponse:fn=>response=fn,close(){view.cleanup();globalThis.document=previous;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const settle=(requestId,status='confirmed',sequence=1)=>({requestId,request_id:'epoch:'+sequence,command_sequence:sequence,owner_epoch:'epoch',status,effect:status==='confirmed'?{source:'native_bound_state',effect_revision:'1'}:null});
function integrate(f){
 const initial=f.host.liveMedia.playback,reads=[];let respond;
 const media=Object.create(LiveMediaView.prototype);Object.assign(media,{host:f.host,account:'account',playback:initial,generation:0,lastRead:0,pending:false,rows:new Map(),queueControls:{invalidate(){},redraw(){}},render(){f.view.render();},loadQueue:async()=>{}});f.host.liveMedia=media;f.host.liveControls=f.view;
 const body=(options={})=>{const result=f.wire(options);result.controls.valid_until=result.binding.validUntil;return result;};
 f.host.liveTransport.music=(...args)=>{reads.push(args);return respond?respond(...args):Promise.resolve({...body(),...(args[3]?.receiptRequestId?{settlement:null}:{})});};
 return {media,reads,body,setRead(fn){respond=fn;}};
}

function lifecycle(){
 const f=fixture(),g=integrate(f);f.host.liveSnapshot.capabilities.musicRead.push('targets');
 const room=document.getElementById('rooms'),note=new Node('p');room.querySelector=()=>note;
 f.host.ownerDocument=document;const output=new SpeakerOutputView(f.host);f.host.liveOutputs=output;
 let destination=0,sequence=1;
 const speakers=[0,1,2].map(i=>({speakerId:String(i+1).repeat(64),accountId:'account',kind:'configured_alias',nativeRoomId:i?'room-'+i:'native-room',homepodId:String(i+2),name:['Kitchen','Svend','Frida'][i],availability:'available',default:i===0,nativeSelected:false,outputSelected:false,selectable:true}));
 const catalogue=()=>({ok:true,schema:'podview.speaker-catalogue.v1',bootId:'boot',roomId:'room',accountId:'account',status:'observed',catalogueId:'d'.repeat(64),retrievedAt:Date.now()/1000,source:'podconnect.get_targets',speakers,moveAvailable:true,physicalResultVerified:false});
 g.setRead((kind,account,query,options)=>{
  if(kind==='speakers')return Promise.resolve(catalogue());
  const b=g.body({epoch:'epoch-'+destination,binding:String(destination+10).slice(-1).repeat(64)});b.binding.nativeRoomId=speakers[destination].nativeRoomId;b.binding.nativeHomepodId=speakers[destination].homepodId;b.data.poll_sequence=sequence++;
  if(options?.receiptRequestId)b.settlement={requestId:options.receiptRequestId,request_id:'epoch-'+destination+':'+destination,command_sequence:destination,owner_epoch:'epoch-'+destination,status:'confirmed',effect:{source:'native_bound_state',effect_revision:String(destination)}};
  return Promise.resolve(b);
 });
 f.host.liveTransport.controlSetup=async(domain,target)=>{f.setups.push({domain,target});const task=f.offer();task.options=[{id:'move:'+target.speakerId,action:'move_existing_session',label:'Move',argsSchema:{kind:'none'}}];return task;};
 f.host.liveTransport.controlAction=async(task,id,args)=>{f.effects.push({task,id,args});destination=speakers.findIndex(s=>'move:'+s.speakerId===id);return {ok:true,outcome:'accepted',requestId:'move-'+destination};};
 return {f,g,output,speakers,close(){output.cleanup();f.close();}};
}
test('public MOVE, confirmed fresh destination, roster refresh, then second MOVE uses fresh destination binding without fence resets',async()=>{
 const h=lifecycle(),{f,g,output,speakers}=h;try{
  await g.media.refresh({immediate:true});await output.open();
  assert.equal(output.rows.children[1].disabled,false);
  assert.equal(await f.view.moveSpeaker(speakers[1],()=>output.validUntil>Date.now()),true);await tick();
  assert.equal(f.effects.length,1);assert.equal(g.media.playback.roomBinding.nativeRoomId,'room-1');
  assert.equal([...f.view.receipts.values()].at(-1).settlementStatus,'confirmed');
  const firstTask=f.effects[0].task.taskId,firstBinding=f.setups[0].target.expectedBindingId;
  await output.open();assert.equal(output.rows.children[2].disabled,false);
  assert.equal(await f.view.moveSpeaker(speakers[2],()=>output.validUntil>Date.now()),true);await tick();
  assert.equal(f.effects.length,2);assert.notEqual(f.effects[1].task.taskId,firstTask);
  assert.notEqual(f.setups[1].target.expectedBindingId,firstBinding);
  assert.equal(f.setups[1].target.expectedBindingId,'1'.repeat(64));
  assert.equal(g.media.playback.roomBinding.nativeRoomId,'room-2');
  assert.equal([...f.view.receipts.values()].at(-1).settlementStatus,'confirmed');
 }finally{h.close();}
});
for(const failure of ['stale','missing'])test('fresh roster cannot authorize MOVE with '+failure+' playback observation',async()=>{
 const h=lifecycle(),{f,g,output,speakers}=h;try{
  await g.media.refresh({immediate:true});await output.open();
  if(failure==='missing')g.media.playback=null;else g.media.playback={...g.media.playback,expiresAt:Date.now()-1};
  output.sync();assert.equal(output.rows.children[1].disabled,true);
  assert.equal(await f.view.moveSpeaker(speakers[1],()=>output.validUntil>Date.now()),false);
  assert.equal(f.effects.length,0);assert.equal(f.setups.length,0);
 }finally{h.close();}
});

for(const order of ['response-first','observation-first'])test(`v3 MOVE ${order} restores fresh controls and queue after matching settlement`,async()=>{
 const h=lifecycle(),{f,g,output,speakers}=h;let release;const queue=new LiveQueueView(f.host);try{
  f.host.liveSnapshot.capabilities.musicRead.push('queue');f.host.liveSnapshot.capabilities.queueSelection=true;
  g.media.queueControls=queue;g.media.renderQueue=()=>{};
  await g.media.refresh({immediate:true});await output.open();
  const destination=()=>{const b=g.body({epoch:'epoch-1',binding:'1'.repeat(64)});b.binding.nativeRoomId='room-1';b.binding.nativeHomepodId='3';b.data.poll_sequence=2;return b;};
  g.setRead((_kind,_account,_query,options)=>{const b=destination();if(options?.receiptRequestId)b.settlement={requestId:options.receiptRequestId,request_id:'epoch-1:1',command_sequence:1,owner_epoch:'epoch-1',status:'confirmed',effect:{source:'native_bound_state',effect_revision:'1'}};return Promise.resolve(b);});
  f.host.liveTransport.controlAction=async(task,id,args)=>{f.effects.push({task,id,args});return new Promise(resolve=>release=resolve);};
  const moving=f.view.moveSpeaker(speakers[1],()=>output.validUntil>Date.now());await tick();assert.equal(f.effects.length,1);
  if(order==='observation-first')await g.media.refresh({immediate:true});
  release({outcome:'accepted',requestId:'move-1'});await moving;await tick();
  if(order==='response-first')await g.media.refresh({immediate:true});
  await tick();f.view.renderMusicControls();
  assert.equal(g.media.playback.roomBinding.nativeRoomId,'room-1');
  assert.equal([...f.view.receipts.values()].at(-1).settlementStatus,'confirmed');
  assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.nodes.get('volume').disabled,false);
  f.host.liveTransport.queueOffer=async(account,target,binding)=>({ok:true,schema:'podview.queue-offer.v1',bootId:'boot',roomId:'room',accountId:account,targetId:target,expectedBindingId:binding,taskId:'queue:'+'a'.repeat(32),revision:1,expiresInMs:8000,ownerEpoch:g.media.playback.owner_epoch,pollSequence:g.media.playback.poll_sequence,truncated:false,items:[{id:'1'.repeat(24),title:'Next',artist:'Artist',uri:'spotify:track:'+'0'.repeat(22),artwork:null,order:1}]});
  assert.equal(await queue.load('account',g.media.playback),true);assert.equal(queue.model('account',g.media.playback).items[0].selectable,true);assert.equal(f.effects.length,1);
 }finally{queue.invalidate(true);release?.({outcome:'unknown'});h.close();}
});

test('resume is never sent to old route while a selected MOVE is pending or unknown',async()=>{
 const h=lifecycle(),{f,g,output}=h;try{
  await g.media.refresh({immediate:true});
  for(const outcome of ['pending','unknown']){
   output.pendingChoice={speakerId:'2'.repeat(64),name:'Svend',accountId:'account',bootId:'boot',roomId:'room',transport:f.host.liveTransport};
   f.view.musicFence={...f.view.musicContext(),outcome};
   const before=f.effects.length;
   assert.equal(await f.view.musicIntent('resume'),false);
   assert.equal(f.effects.length,before);
  }
 }finally{h.close();}
});

test('paused MOVE keeps paused observation and resumes on confirmed new binding',async()=>{
 const h=lifecycle(),{f,g,output,speakers}=h;try{
  f.adopt({state:'paused'});g.media.playback=f.host.liveMedia.playback;
  await output.open();
  const pausedDestination=()=>{const body=g.body({state:'paused',epoch:'epoch-1',binding:'1'.repeat(64)});body.binding.nativeRoomId='room-1';body.binding.nativeHomepodId='3';return body;};
  g.setRead((_kind,_account,_query,options)=>{const body=pausedDestination();if(options?.receiptRequestId)body.settlement={requestId:options.receiptRequestId,request_id:'epoch-1:1',command_sequence:1,owner_epoch:'epoch-1',status:'confirmed',effect:{source:'native_bound_state',effect_revision:'1'}};return Promise.resolve(body);});
  assert.equal(await f.view.moveSpeaker(speakers[1],()=>output.validUntil>Date.now()),true);await tick();
  assert.equal(g.media.playback.state,'paused');assert.equal(g.media.playback.roomBinding.nativeRoomId,'room-1');
  f.host.liveTransport.controlSetup=async(domain,target)=>{f.setups.push({domain,target});const task=f.offer('resume');return task;};
  f.host.liveTransport.controlAction=async(task,id,args)=>{f.effects.push({task,id,args});return {ok:true,outcome:'accepted',requestId:'resume-1'};};
  assert.equal(await f.view.musicIntent('resume'),true);assert.equal(f.setups.at(-1).target.expectedBindingId,'1'.repeat(64));
 }finally{h.close();}
});

test('paused kitchen → Svend → play → pause → kitchen → play uses confirmed bindings and retains selected track',async()=>{
 const h=lifecycle(),{f,g,output,speakers}=h;let destination=0,state='paused',seq=1,requestId='';
 try{
  const read=(kind,_account,_query,options)=>{
   if(kind==='speakers')return Promise.resolve({ok:true,schema:'podview.speaker-catalogue.v1',bootId:'boot',roomId:'room',accountId:'account',status:'observed',catalogueId:'d'.repeat(64),retrievedAt:Date.now()/1000,source:'podconnect.get_targets',speakers,moveAvailable:true,physicalResultVerified:false});
   const b=g.body({state,epoch:'epoch-'+destination,binding:String(destination+1).repeat(64)});b.binding.nativeRoomId=speakers[destination].nativeRoomId;b.binding.nativeHomepodId=speakers[destination].homepodId;b.data.poll_sequence=seq++;
   if(options?.receiptRequestId)b.settlement={requestId:options.receiptRequestId,request_id:'epoch-'+destination+':'+seq,command_sequence:seq,owner_epoch:'epoch-'+destination,status:'confirmed',effect:{source:'native_bound_state',effect_revision:String(seq)}};
   return Promise.resolve(b);
  };
  g.setRead(read);
  f.host.liveTransport.controlSetup=async(domain,target)=>{f.setups.push({domain,target});if(target.speakerId){const t=f.offer();t.options=[{id:'move:'+target.speakerId,action:'move_existing_session',label:'Move',argsSchema:{kind:'none'}}];return t;}return f.offer(state==='paused'?'resume':'pause');};
  f.host.liveTransport.controlAction=async(task,id,args)=>{f.effects.push({task,id,args});const action=task.options.find(o=>o.id===id).action;if(action==='move_existing_session')destination=speakers.findIndex(s=>'move:'+s.speakerId===id);else if(action==='resume')state='playing';else if(action==='pause')state='paused';requestId='request-'+f.effects.length;return {outcome:'accepted',requestId};};
  await g.media.refresh({immediate:true});await output.open();const track=g.media.playback.item?.uri;assert.equal(track,'spotify:track:0123456789ABCDEFGHIJKL');
  assert.equal(g.media.playback.state,'paused');assert.equal(await f.view.moveSpeaker(speakers[1],()=>output.validUntil>Date.now()),true);await tick();assert.equal(g.media.playback.roomBinding.nativeRoomId,'room-1');assert.equal(g.media.playback.state,'paused');
  assert.equal(await f.view.musicIntent('resume'),true);await tick();await g.media.refresh({immediate:true});await tick();assert.equal(f.setups.at(-1).target.expectedBindingId,'2'.repeat(64));assert.equal(g.media.playback.state,'playing');
  assert.equal(await f.view.musicIntent('pause'),true);await tick();await g.media.refresh({immediate:true});await tick();assert.equal(g.media.playback.state,'paused');
  await output.open();assert.equal(await f.view.moveSpeaker(speakers[0],()=>output.validUntil>Date.now()),true);await tick();assert.equal(g.media.playback.roomBinding.nativeRoomId,'native-room');assert.equal(g.media.playback.state,'paused');
  assert.equal(await f.view.musicIntent('resume'),true);await tick();assert.equal(f.setups.at(-1).target.expectedBindingId,'1'.repeat(64));assert.equal(g.media.playback.item?.uri,track);
 }finally{h.close();}
});

for (const status of ['rejected','unknown','superseded']) test(`MOVE ${status} on observed original route releases exact pending choice`, async()=>{
 const h=lifecycle(), {f,g,output}=h; try {
  await g.media.refresh({immediate:true});
  const p=g.media.playback, choice=Object.freeze({speakerId:'2'.repeat(64)}), receipt={kind:'move',choice,requestId:'req-1',operationKey:'op-1',destination:{accountId:'account',nativeRoomId:'room-1',nativeHomepodId:'3'},origin:{accountId:'account',nativeRoomId:'native-room',nativeHomepodId:'2'}};
  output.pendingChoice=choice; f.view.musicFence={outcome:'accepted',settlementReceipt:receipt}; f.view.receipts.set('op-1',{});
  f.view.musicSettlementReceipt=()=>receipt;
  p.settlement={requestId:'req-1',request_id:'epoch:1',command_sequence:1,owner_epoch:p.owner_epoch,status,effect:null};
  assert.equal(f.view.observeMusicSettlement(p,receipt,true),true,'terminal response on original route must be observed');
  assert.equal(output.pendingChoice,null);
 } finally {h.close();}
});

test('late rejected old A cannot clear newer A choice identity',async()=>{
 const h=lifecycle(),{f,g,output}=h;try{
  await g.media.refresh({immediate:true});await output.open();
  const completions=[]; f.view.moveSpeaker=()=>new Promise(resolve=>completions.push(resolve));
  const row=output.rows.children[1];row.dispatchEvent(new Event('click'));
  const old=output.pendingChoice;assert.ok(old);
  row.dispatchEvent(new Event('click')); const newest=output.pendingChoice;
  assert.ok(newest);assert.notEqual(newest,old);assert.equal(newest.speakerId,old.speakerId);
  completions[0](false);await tick();assert.equal(output.pendingChoice,newest);
  completions[1](false);await tick();assert.equal(output.pendingChoice,null);
 }finally{h.close();}
});

for (const scenario of ['foreign-route','foreign-epoch','confirmed-origin','confirmed-destination','rejected-destination']) test(`MOVE settlement validates ${scenario}`,async()=>{
 const h=lifecycle(),{f,g,output}=h;try{
  await g.media.refresh({immediate:true});const base=g.media.playback,choice=Object.freeze({speakerId:'2'.repeat(64)});
  const receipt={kind:'move',choice,requestId:'req-1',operationKey:'op-1',destination:{accountId:'account',nativeRoomId:'room-1',nativeHomepodId:'3'},origin:{accountId:'account',nativeRoomId:'native-room',nativeHomepodId:'2'}};
  output.pendingChoice=choice;f.view.musicFence={outcome:'accepted',settlementReceipt:receipt};f.view.receipts.set('op-1',{});f.view.musicSettlementReceipt=()=>receipt;
  const status=scenario.startsWith('confirmed')?'confirmed':'rejected';
  let binding=base.roomBinding;if(scenario==='foreign-route')binding={...binding,nativeRoomId:'foreign-room',nativeHomepodId:'7'};if(scenario.endsWith('destination'))binding={...binding,nativeRoomId:'room-1',nativeHomepodId:'3'};
  const p={...base,roomBinding:binding,settlement:{requestId:'req-1',request_id:'epoch:1',command_sequence:1,owner_epoch:scenario==='foreign-epoch'?'foreign':base.owner_epoch,status,effect:status==='confirmed'?{source:'native_bound_state',effect_revision:'1'}:null}};
  const expected=['confirmed-destination','rejected-destination'].includes(scenario);assert.equal(f.view.observeMusicSettlement(p,receipt,true),expected);
  if(!expected)assert.equal(output.pendingChoice,choice);
 }finally{h.close();}
});
