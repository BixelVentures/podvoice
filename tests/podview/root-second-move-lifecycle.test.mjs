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
 const wire=({base=100,effective=35,ceiling=35,state='playing',status='observed',reason=null,supported=actions,epoch='epoch',binding='a'.repeat(64),ttl=5}={})=>({ok:true,schema:'podview.room-playback.v3',bootId:'boot',roomId:'room',configEntryId:'account',status:'observed',reason:null,binding:{roomId:'room',accountId:'account',targetId:'device',nativeRoomId:'native-room',nativeHomepodId:'2',bindingId:binding,validUntil:Date.now()/1000+ttl},data:{ok:true,schema:'podconnect.playback.v1',config_entry_id:'account',owner_epoch:epoch,poll_sequence:1,physical_result_verified:false,observation:{status:'fresh',source:'spotify_web_api',observed_at:new Date(Date.now()).toISOString(),age_ms:0,max_age_ms:15000},playback:{state,target:{kind:'spotify_device',target_id:'device',name:'Bridge'},item:{type:'track',uri:'spotify:track:0123456789ABCDEFGHIJKL',name:'Song',artists:['Artist'],duration_ms:60000},progress_ms:1000,provider_changed_at_ms:null,shuffle:false,repeat:'off'}},controls:{status,reason,binding_id:status==='observed'?binding:null,valid_until:status==='observed'?Date.now()/1000+ttl:null,supported_actions:[...supported],volume:base===null?null:{base_percent:base,effective_percent:effective}},permissions:{actions:[...supported],maxVolume:supported.includes('volume')?ceiling:null}});
 host.liveMedia={account:'account'};const adopt=options=>{const body=wire(options);body.controls.valid_until=body.controls.status==='observed'?body.binding.validUntil:null;host.liveMedia.playback=roomPlaybackObservation(body,'account',host.liveSnapshot);return body;};adopt();
 const setups=[],effects=[],feedback=[];let serial=0,response;
 const offer=(requested,volume=35)=>{const n=++serial,chosen=requested?[requested]:actions;return {ok:true,schema:'podview.control.v1',bootId:'boot',roomId:'room',domain:'music',expectedBindingId:host.liveMedia.playback.roomBinding.bindingId,taskId:'control:'+n.toString(16).padStart(32,'0'),revision:1,expiresAt:Date.now()/1000+5,options:chosen.map((action,i)=>({id:(n*10+i).toString(16).padStart(24,'0'),action,label:action,argsSchema:action==='volume'?{kind:'percent',min:0,max:35}:{kind:'none'}})),setup:{volume}};};
 host.liveTransport={connected:true,generation:1,controlSetup:async(...args)=>{setups.push(args);return response?response(...args):offer(args[3]?.requestedAction);},controlIntent:async(intent)=>{effects.push(intent);return {ok:true,outcome:'accepted',requestId:intent.requestId};}};host.showFeedback=(message)=>feedback.push(message);
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
  if(options?.receiptRequestId)b.settlement={requestId:options.receiptRequestId,request_id:'epoch-'+destination+':'+sequence,command_sequence:sequence,owner_epoch:'epoch-'+destination,status:'confirmed',effect:{source:'native_bound_state',effect_revision:String(sequence)}};
  return Promise.resolve(b);
 });
 f.host.liveTransport.controlIntent=async(intent)=>{f.effects.push(intent);destination=speakers.findIndex(s=>s.speakerId===intent.target.speakerId);return {ok:true,outcome:'accepted',requestId:intent.requestId};};
 return {f,g,output,speakers,close(){output.cleanup();f.close();}};
}
test('public MOVE, confirmed fresh destination, roster refresh, then second MOVE uses fresh destination binding without fence resets',async()=>{
 const h=lifecycle(),{f,g,output,speakers}=h;try{
  await g.media.refresh({immediate:true});await output.open();
  assert.equal(output.rows.children[1].disabled,false);
  assert.equal(await f.view.moveSpeaker(speakers[1],()=>output.validUntil>Date.now()),true);await tick();
  assert.equal(f.effects.length,1);assert.equal(g.media.playback.roomBinding.nativeRoomId,'room-1');
  assert.equal([...f.view.receipts.values()].at(-1).settlementStatus,'confirmed');
  const firstRequest=f.effects[0].requestId,firstBinding=f.effects[0].target.expectedBindingId;
  await output.open();assert.equal(output.rows.children[2].disabled,false);
  assert.equal(await f.view.moveSpeaker(speakers[2],()=>output.validUntil>Date.now()),true);await tick();
  assert.equal(f.effects.length,2);assert.notEqual(f.effects[1].requestId,firstRequest);
  assert.notEqual(f.effects[1].target.expectedBindingId,firstBinding);
  assert.equal(f.effects[1].target.expectedBindingId,'1'.repeat(64));
  assert.equal(g.media.playback.roomBinding.nativeRoomId,'room-2');
  assert.equal([...f.view.receipts.values()].at(-1).settlementStatus,'confirmed');
 }finally{h.close();}
});
// The catalogue is a supplied DTO here; server selectability is covered separately.
test('Kitchen to Svend to Kitchen reopens the original row with fresh authority on one Spotify target',async()=>{
 const h=lifecycle(),{f,g,output,speakers}=h;try{
  await g.media.refresh({immediate:true});await output.open();
  const originalTarget=structuredClone(g.media.playback.target),originalBinding=g.media.playback.roomBinding.bindingId;
  const rowFor=speaker=>[...output.rows.children].find(row=>row.speakerRow.speakerId===speaker.speakerId);
  assert.equal(rowFor(speakers[0]).disabled,true);
  assert.equal(rowFor(speakers[1]).disabled,false);
  assert.equal(await f.view.moveSpeaker(speakers[1],()=>output.validUntil>Date.now()),true);await tick();
  assert.equal(f.effects.length,1);
  assert.equal(g.media.playback.roomBinding.nativeRoomId,speakers[1].nativeRoomId);
  assert.deepEqual(g.media.playback.target,originalTarget);
  const firstRequest=f.effects[0].requestId,returnBinding=g.media.playback.roomBinding.bindingId;
  assert.notEqual(returnBinding,originalBinding);
  await output.open();
  const kitchen=rowFor(speakers[0]),svend=rowFor(speakers[1]);
  assert.equal(kitchen.disabled,false);assert.equal(kitchen.getAttribute('aria-pressed'),'false');
  assert.equal(svend.disabled,true);assert.equal(svend.getAttribute('aria-pressed'),'true');
  assert.equal(await f.view.moveSpeaker(kitchen.speakerRow,()=>output.validUntil>Date.now()),true);await tick();
  assert.equal(f.effects.length,2);
  assert.deepEqual(f.effects.map(effect=>effect.action),['move_existing_session','move_existing_session']);
  assert.deepEqual(f.effects.map(effect=>effect.target.speakerId),[speakers[1].speakerId,speakers[0].speakerId]);
  assert.notEqual(f.effects[1].requestId,firstRequest);
  assert.equal(f.effects[1].target.expectedBindingId,returnBinding);
  assert.notEqual(f.effects[1].target.expectedBindingId,f.effects[0].target.expectedBindingId);
  assert(f.effects.every(effect=>effect.target.targetId===originalTarget.id));
  assert.equal(g.media.playback.roomBinding.nativeRoomId,speakers[0].nativeRoomId);
  assert.equal(g.media.playback.roomBinding.nativeHomepodId,speakers[0].homepodId);
  assert.deepEqual(g.media.playback.target,originalTarget);
  assert.equal([...f.view.receipts.values()].at(-1).settlementStatus,'confirmed');
  f.view.renderMusicControls();
  assert.equal(f.nodes.get('play-pause').disabled,false);assert.equal(f.nodes.get('volume').disabled,false);
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
  f.host.liveTransport.controlIntent=async(intent)=>{f.effects.push(intent);return new Promise(resolve=>release=result=>resolve({...result,requestId:intent.requestId}));};
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
  f.host.liveTransport.controlIntent=async(intent)=>{f.effects.push(intent);return {ok:true,outcome:'accepted',requestId:intent.requestId};};
  assert.equal(await f.view.musicIntent('resume'),true);assert.equal(f.effects.at(-1).target.expectedBindingId,'1'.repeat(64));
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
  f.host.liveTransport.controlIntent=async(intent)=>{f.effects.push(intent);const action=intent.action;if(action==='move_existing_session')destination=speakers.findIndex(s=>s.speakerId===intent.target.speakerId);else if(action==='resume')state='playing';else if(action==='pause')state='paused';requestId=intent.requestId;return {outcome:'accepted',requestId};};
  await g.media.refresh({immediate:true});await output.open();const track=g.media.playback.item?.uri;assert.equal(track,'spotify:track:0123456789ABCDEFGHIJKL');
  assert.equal(g.media.playback.state,'paused');assert.equal(await f.view.moveSpeaker(speakers[1],()=>output.validUntil>Date.now()),true);await tick();assert.equal(g.media.playback.roomBinding.nativeRoomId,'room-1');assert.equal(g.media.playback.state,'paused');
  assert.equal(await f.view.musicIntent('resume'),true);await tick();await g.media.refresh({immediate:true});await tick();assert.equal(f.effects.at(-1).target.expectedBindingId,'2'.repeat(64));assert.equal(g.media.playback.state,'playing');
  assert.equal(await f.view.musicIntent('pause'),true);await tick();await g.media.refresh({immediate:true});await tick();assert.equal(g.media.playback.state,'paused');
  await output.open();assert.equal(await f.view.moveSpeaker(speakers[0],()=>output.validUntil>Date.now()),true);await tick();assert.equal(g.media.playback.roomBinding.nativeRoomId,'native-room');assert.equal(g.media.playback.state,'paused');
  assert.equal(await f.view.musicIntent('resume'),true);await tick();assert.equal(f.effects.at(-1).target.expectedBindingId,'1'.repeat(64));assert.equal(g.media.playback.item?.uri,track);
 }finally{h.close();}
});

for (const status of ['rejected','superseded']) test(`MOVE ${status} on observed original route releases exact pending choice`, async()=>{
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

test('MOVE interim unknown keeps its choice until a later correlated rejection',async()=>{
 const h=lifecycle(),{f,g,output}=h;try{
  await g.media.refresh({immediate:true});const p=g.media.playback,choice=Object.freeze({speakerId:'2'.repeat(64)}),receipt={kind:'move',choice,requestId:'req-1',operationKey:'op-1',destination:{accountId:'account',nativeRoomId:'room-1',nativeHomepodId:'3'},origin:{accountId:'account',nativeRoomId:'native-room',nativeHomepodId:'2'}};
  output.pendingChoice=choice;f.view.musicFence={outcome:'accepted',settlementReceipt:receipt};f.view.receipts.set('op-1',{});f.view.musicSettlementReceipt=()=>receipt;
  p.settlement={requestId:'req-1',request_id:'epoch:1',command_sequence:1,owner_epoch:p.owner_epoch,status:'unknown',effect:null};
  assert.equal(f.view.observeMusicSettlement(p,receipt,true),true);assert.equal(output.pendingChoice,choice);assert.equal(f.view.musicFence.settlementStatus,'unconfirmed');
  p.settlement={...p.settlement,status:'rejected'};assert.equal(f.view.observeMusicSettlement(p,receipt,true),true);assert.equal(output.pendingChoice,null);assert.equal(f.effects.length,0);
 }finally{h.close();}
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

for(const reason of ['owner_changed','account_unavailable'])for(const action of ['pause','resume'])test(`30s fresh v3 ${reason} recovers ${action} without snapshots`,async()=>{
 const oldNow=Date.now,oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;let now=oldNow(),serial=0;const started=now,timers=new Map();Date.now=()=>now;globalThis.setTimeout=(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:now+ms});return id;};globalThis.clearTimeout=id=>timers.delete(id);
 const f=fixture(),g=integrate(f);let mode='ready',seq=0;try{
  g.setRead((_kind,_account,_query,options)=>{if(mode==='unavailable')return Promise.resolve({ok:true,schema:'podview.room-playback.v3',bootId:'boot',roomId:'room',configEntryId:'account',status:'unavailable',reason,binding:null,data:null,controls:{status:'unavailable',reason,binding_id:null,valid_until:null,supported_actions:[],volume:null},permissions:{actions:[],maxVolume:null},...(options?.receiptRequestId?{settlement:null}:{})});const b=g.body({state:action==='resume'?'paused':'playing'});b.data.poll_sequence=++seq;return Promise.resolve(b);});
  await g.media.refresh({immediate:true});assert.equal(f.nodes.get('play-pause').disabled,false);
  f.host.liveTransport.controlIntent=async(intent)=>{f.effects.push(intent);return {outcome:f.effects.length===1?'rejected':'accepted',requestId:intent.requestId};};assert.equal(await f.view.musicIntent(action),true);assert.equal(f.effects.length,1);
  for(let i=0;i<12;i++){const entry=timers.get(g.media.freshnessTimer);assert.ok(entry,`step=${i} seq=${seq} state=${g.media.readState} timer=${g.media.freshnessTimer}`);timers.delete(g.media.freshnessTimer);now=entry.at;entry.fn();await tick();}
  assert.ok(now-started>=30000);assert.ok(seq>=12);assert.equal(f.nodes.get('play-pause').disabled,false);
  mode='unavailable';let entry=timers.get(g.media.freshnessTimer);timers.delete(g.media.freshnessTimer);now=entry.at;entry.fn();await tick();assert.equal(f.nodes.get('play-pause').disabled,true);
  mode='ready';entry=timers.get(g.media.freshnessTimer);assert.ok(entry,'transient read must schedule recovery without snapshot');timers.delete(g.media.freshnessTimer);now=entry.at;entry.fn();await tick();assert.equal(f.nodes.get('play-pause').disabled,false);
  assert.equal(await f.view.musicIntent(action),true);assert.equal(f.effects.length,2);
 }finally{f.close();Date.now=oldNow;globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;}
});

for(const failure of ['network','http','timeout','abort'])test(`transient ${failure} error after expiry must schedule recovery without snapshot`,async()=>{
 const action='pause';
 const oldNow=Date.now,oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;let now=oldNow(),serial=0;const started=now,timers=new Map();Date.now=()=>now;globalThis.setTimeout=(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:now+ms});return id;};globalThis.clearTimeout=id=>timers.delete(id);
 const f=fixture(),g=integrate(f);let mode='ready',seq=0;try{
  g.setRead((_kind,_account,_query,options)=>{if(mode==='unavailable'){const e=failure==='network'?new TypeError('network'):new Error(failure);if(failure==='http')e.code='read_transient';if(failure==='timeout')e.name='TimeoutError';if(failure==='abort')e.name='AbortError';return Promise.reject(e);}const b=g.body({state:action==='resume'?'paused':'playing'});b.data.poll_sequence=++seq;return Promise.resolve(b);});
  await g.media.refresh({immediate:true});assert.equal(f.nodes.get('play-pause').disabled,false);
  f.host.liveTransport.controlIntent=async(intent)=>{f.effects.push(intent);return {outcome:f.effects.length===1?'rejected':'accepted',requestId:intent.requestId};};assert.equal(await f.view.musicIntent(action),true);assert.equal(f.effects.length,1);
  for(let i=0;i<12;i++){const entry=timers.get(g.media.freshnessTimer);assert.ok(entry,`step=${i} seq=${seq} state=${g.media.readState} timer=${g.media.freshnessTimer}`);timers.delete(g.media.freshnessTimer);now=entry.at;entry.fn();await tick();}
  assert.ok(now-started>=30000);assert.ok(seq>=12);assert.equal(f.nodes.get('play-pause').disabled,false);
  mode='unavailable';let entry=timers.get(g.media.freshnessTimer);timers.delete(g.media.freshnessTimer);now=entry.at+6000;entry.fn();await tick();assert.equal(f.nodes.get('play-pause').disabled,true);
  mode='ready';entry=timers.get(g.media.freshnessTimer);assert.ok(entry,'transient read must schedule recovery without snapshot');timers.delete(g.media.freshnessTimer);now=entry.at;entry.fn();await tick();assert.equal(f.nodes.get('play-pause').disabled,false);
  assert.equal(await f.view.musicIntent(action),true);assert.equal(f.effects.length,2);
 }finally{f.close();Date.now=oldNow;globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;}
});

for(const failure of ['denied','invalid','superseded'])test(`playback ${failure} never schedules transient recovery`,async()=>{
 const oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;let serial=0;const timers=new Map();globalThis.setTimeout=(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;};globalThis.clearTimeout=id=>timers.delete(id);
 const f=fixture(),g=integrate(f);let fail=false,release;try{
  g.setRead(()=>{if(!fail)return Promise.resolve(g.body());if(failure==='denied')return Promise.reject(Object.assign(new TypeError('denied'),{code:'read_access_denied'}));if(failure==='invalid')return Promise.resolve({ok:true,schema:'invalid'});return new Promise((_resolve,reject)=>release=reject);});
  await g.media.refresh({immediate:true});assert.ok(g.media.freshnessTimer);fail=true;
  const pending=g.media.refresh({immediate:true});if(failure==='superseded'){f.host.liveTransport.connected=false;release(new TypeError('network'));}await pending;await tick();
  assert.equal(g.media.freshnessTimer,null);assert.equal(f.effects.length,0);
 }finally{f.close();globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;}
});
test('network recovery never clears an unknown music action or replays it',async()=>{
 const oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;let serial=0;const timers=new Map();globalThis.setTimeout=(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;};globalThis.clearTimeout=id=>timers.delete(id);
 const f=fixture(),g=integrate(f);let fail=false;try{
  g.setRead(()=>fail?Promise.reject(new TypeError('network')):Promise.resolve(g.body()));await g.media.refresh({immediate:true});
  f.host.liveTransport.controlIntent=async(intent)=>{f.effects.push(intent);return {outcome:'unknown',requestId:intent.requestId};};assert.equal(await f.view.musicIntent('pause'),true);assert.equal(f.effects.length,1);
  fail=true;await g.media.refresh({immediate:true});assert.equal(f.view.musicFence.outcome,'unknown');const timer=timers.get(g.media.freshnessTimer);assert.ok(timer);fail=false;timer.fn();await tick();
  assert.equal(f.view.musicFence.outcome,'unknown');assert.equal(f.effects.length,1,'recovery never replays');assert.equal(f.nodes.get('play-pause').disabled,false,'unknown never locks transport');
 }finally{f.close();globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;}
});
test('repeated transient playback failures stop at the existing three retry bound',async()=>{
 const oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;let serial=0;const timers=new Map();globalThis.setTimeout=(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;};globalThis.clearTimeout=id=>timers.delete(id);
 const f=fixture(),g=integrate(f);let calls=0;try{
  g.setRead(()=>{calls++;return Promise.reject(new TypeError('network'));});await g.media.refresh({immediate:true});
  for(let i=0;i<3;i++){const id=g.media.freshnessTimer,entry=timers.get(id);assert.ok(entry);timers.delete(id);entry.fn();await tick();}
  assert.equal(calls,4);assert.equal(g.media.freshnessTimer,null);assert.equal(f.effects.length,0);
 }finally{f.close();globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;}
});

// Direct commands have no browser-side JIT offer. These tests exercise the view's
// public transport port; the server separately validates authority and target.
test('Pause remains correlated across a same-output track change and never performs browser setup',async()=>{
 const f=fixture();let finish;
 try{
  f.view.render();
  f.host.liveTransport.controlSetup=()=>{throw Error('explicit action must not request setup');};
  f.host.liveTransport.controlIntent=intent=>{f.effects.push(intent);return new Promise(resolve=>finish=()=>resolve({ok:true,outcome:'accepted',requestId:intent.requestId}));};
  const pending=f.view.musicIntent('pause');assert.equal(f.effects.length,1);
  const intent=f.effects[0];assert.equal(intent.action,'pause');assert.deepEqual(intent.args,{});assert.equal(intent.target.expectedBindingId,'a'.repeat(64));
  f.host.liveMedia.playback.item={...f.host.liveMedia.playback.item,uri:'spotify:track:1123456789ABCDEFGHIJKL'};
  f.host.liveMedia.playback.poll_sequence++;f.view.render();finish();await pending;
  assert.equal(f.effects.length,1);assert.equal([...f.view.receipts.values()].at(-1).outcome,'accepted');
  assert.equal(f.view.musicFence.outcome,'accepted');
 }finally{finish?.();f.close();}
});

test('late accepted direct receipt stays recorded but cannot publish into a replacement owner',async()=>{
 const f=fixture();let finish;
 try{
  let refreshes=0;f.host.liveMedia.refresh=async()=>{refreshes++;};
  f.view.render();f.host.liveTransport.controlIntent=intent=>{f.effects.push(intent);return new Promise(resolve=>finish=()=>resolve({ok:true,outcome:'accepted',requestId:intent.requestId}));};
  const pending=f.view.musicIntent('pause');assert.equal(f.effects.length,1);
  f.adopt({epoch:'other-owner',binding:'b'.repeat(64)});f.view.render();const replacementFence=f.view.musicFence;
  finish();await pending;assert.equal(f.view.musicFence,replacementFence);
  const receipt=[...f.view.receipts.values()].at(-1);assert.equal(receipt.outcome,'accepted');assert.equal(receipt.target.expectedBindingId,'a'.repeat(64));
  assert.equal(f.effects.length,1);await tick();assert.equal(refreshes,0,'late old receipt cannot refresh a replacement owner');
 }finally{finish?.();f.close();}
});

test('measured 100 stays truthful with max 35; lowering and mute are explicit bounded commands',async()=>{
 const f=fixture();
 try{
  f.view.render();assert.equal(f.nodes.get('volume-value').textContent,'100 %');assert.equal(f.nodes.get('volume').dataset.actionMax,'35');
  assert.equal(await f.view.musicIntent('volume',{percent:36}),false);assert.equal(await f.view.musicIntent('volume',{percent:1.5}),false);assert.equal(f.effects.length,0);
  assert.equal(await f.view.musicIntent('volume',{percent:35}),true);assert.deepEqual(f.effects[0].args,{percent:35});assert.equal(f.view.musicMeasurement.volume,100);
  // A new observation permits a new explicit input; it does not infer volume.
  f.adopt({base:100,effective:35,ceiling:35});f.host.liveMedia.playback.poll_sequence=2;f.view.render();
  assert.equal(await f.view.musicIntent('volume',{percent:0}),true);assert.deepEqual(f.effects[1].args,{percent:0});assert.equal(f.view.musicMeasurement.volume,100);
 }finally{f.close();}
});

for(const change of ['revoked','target','binding','disconnected'])test(`direct Pause rejects ${change} before dispatch`,async()=>{
 const f=fixture();try{
  if(change==='revoked')f.adopt({base:null,status:'unavailable',reason:'control_not_granted',supported:[]});
  if(change==='target')f.host.liveMedia.playback.target.id='foreign';
  if(change==='binding')f.host.liveMedia.playback.roomBinding.validUntil=Date.now()/1000-1;
  if(change==='disconnected')f.host.liveTransport.connected=false;
  assert.equal(await f.view.musicIntent('pause'),false);assert.equal(f.effects.length,0);
 }finally{f.close();}
});

test('UNKNOWN is not replayed on reads; a newer observation permits a new explicit request identity',async()=>{
 const f=fixture();try{
  f.host.liveTransport.controlIntent=async intent=>{f.effects.push(intent);return {ok:false,outcome:'unknown',requestId:intent.requestId};};
  assert.equal(await f.view.musicIntent('pause'),true);assert.equal(f.effects.length,1);
  f.view.render();await f.view.prepareMusic();assert.equal(f.effects.length,1);
  f.adopt();f.host.liveMedia.playback.poll_sequence=2;f.view.render();assert.equal(f.effects.length,1,'a read is not a command');
  assert.equal(await f.view.musicIntent('pause'),true);assert.equal(f.effects.length,2);assert.notEqual(f.effects[0].requestId,f.effects[1].requestId);
 }finally{f.close();}
});

test('Pause dispatches while an independent playback read is held without inventing a result',async()=>{
 const f=fixture(),g=integrate(f);let release,calls=0;
 try{
  g.setRead(()=>++calls===1?new Promise(resolve=>release=resolve):Promise.resolve(g.body()));
  const reading=g.media.refresh({immediate:true});await tick();assert.equal(g.media.pending,true);
  assert.equal(await f.view.musicIntent('pause'),true);assert.equal(f.effects.length,1);assert.equal(f.effects[0].action,'pause');
  assert.equal(g.media.playback.state,'playing','accepted command is not an observed state change');
  release(g.body());await reading;assert.equal(f.effects.length,1);
 }finally{release?.(g.body());f.close();}
});

test('pending music does not block opening a robot control',async()=>{
 const f=fixture();let finish;
 try{
  f.host.state.devices=[{id:'vacuum.actual',kind:'vacuum',live:true,stale:false,status:'cleaning'}];f.host.liveSnapshot.capabilities.controlSetup.push('vacuum');
  const task={ok:true,schema:'podview.control.v1',bootId:'boot',roomId:'room',domain:'vacuum',taskId:'vacuum-independent',revision:1,expiresAt:Date.now()/1000+60,options:[{id:'pause',action:'pause',label:'Pause',argsSchema:{kind:'none'}}],setup:{mapName:null}};
  f.host.liveTransport.controlSetup=async domain=>{assert.equal(domain,'vacuum');return task;};
  f.host.liveTransport.controlIntent=intent=>{f.effects.push(intent);return new Promise(resolve=>finish=()=>resolve({outcome:'accepted',requestId:intent.requestId}));};
  const music=f.view.musicIntent('pause');assert.equal(f.effects.length,1);
  await f.view.open('vacuum',{entityId:'vacuum.actual'});assert.equal(f.view.task?.taskId,'vacuum-independent');
  const robot=[];f.host.liveTransport.controlAction=async(task,id,args)=>{robot.push({task,id,args});return {ok:true,outcome:'accepted',requestId:'robot-receipt'};};
  await f.view.send('pause',{});assert.equal(robot.length,1);assert.equal(robot[0].id,'pause');
  finish();await music;assert.equal(f.effects.length,1);
 }finally{finish?.();f.close();}
});

for(const state of ['playing','paused'])test(`direct transport sends an idempotent toggle even when the observation lags (${state})`,async()=>{
 const f=fixture();try{f.adopt({state});assert.equal(await f.view.musicIntent(state==='playing'?'resume':'pause'),true);assert.equal(f.effects.length,1);assert.equal(await f.view.musicIntent(state==='playing'?'pause':'resume'),true);assert.equal(f.effects.length,2);}finally{f.close();}
});

test('a new voice turn and provider generation do not cancel same-output Pause',async()=>{
 const f=fixture();let finish;
 try{
  f.view.render();f.host.liveTransport.controlIntent=intent=>{f.effects.push(intent);return new Promise(resolve=>finish=()=>resolve({outcome:'accepted',requestId:intent.requestId}));};
  const pending=f.view.musicIntent('pause');f.host.liveSnapshot.voice={sessionId:'new-session',turnId:'new-turn'};f.host.liveSnapshot.providerGeneration++;
  f.host.liveSnapshot.taskId='new-task';f.host.liveSnapshot.inputRevision=2;f.view.render();finish();await pending;
  assert.equal(f.effects.length,1);assert.equal(f.view.musicFence.outcome,'accepted');
 }finally{finish?.();f.close();}
});
// H1: a speaker chosen while Pause is in flight stays chosen and moves once Pause has settled.
test('a speaker tapped while Pause is pending stays chosen and is moved once after Pause settles',async()=>{
 const h=lifecycle(),{f,g,output}=h;let release;try{
  await g.media.refresh({immediate:true});await output.open();f.view.render();
  const plain=f.host.liveTransport.controlIntent;
  f.host.liveTransport.controlIntent=intent=>{
   if(intent.action!=='pause')return plain(intent);
   f.effects.push(intent);return new Promise(resolve=>release=()=>resolve({ok:true,outcome:'accepted',requestId:intent.requestId}));
  };
  const pausing=f.view.musicIntent('pause');await tick();assert.equal(f.view.musicIntentPending,true);
  output.sync();const row=[...output.rows.children].find(b=>b.speakerRow.name==='Svend');assert.equal(row.disabled,false,'the speaker row is not locked');
  row.dispatchEvent(new Event('click'));await tick();
  assert.equal(output.pendingChoiceLabel(),'Svend','the chosen speaker is shown at once');
  assert.deepEqual(f.effects.map(e=>e.action),['pause'],'the move waits for Pause');
  release();await pausing;for(let i=0;i<6;i++)await tick();
  assert.deepEqual(f.effects.map(e=>e.action),['pause','move_existing_session'],'the move is sent exactly once');
  assert.equal(f.effects[1].target.speakerId,'2'.repeat(64));
 }finally{release?.();h.close();}
});
test('a speaker tapped while Pause is pending is not moved when Pause ends UNKNOWN, and the user is told',async()=>{
 const h=lifecycle(),{f,g,output}=h;let release;try{
  await g.media.refresh({immediate:true});await output.open();f.view.render();
  f.host.liveTransport.controlIntent=intent=>{f.effects.push(intent);return new Promise(resolve=>release=()=>resolve({ok:true,outcome:'unknown',requestId:intent.requestId}));};
  const pausing=f.view.musicIntent('pause');await tick();output.sync();
  [...output.rows.children].find(b=>b.speakerRow.name==='Svend').dispatchEvent(new Event('click'));await tick();
  release();await pausing;for(let i=0;i<6;i++)await tick();
  assert.deepEqual(f.effects.map(e=>e.action),['pause'],'nothing is sent after UNKNOWN');
  assert.ok(f.feedback.some(text=>/ikke skiftet/.test(text)),'the user gets a concrete message');
  assert.equal(output.pendingChoiceLabel(),'','the waiting choice is cleared');
 }finally{release?.();h.close();}
});
for(const replacement of ['new-route','new-owner','new-transport'])test(`a waiting speaker choice cannot move a replacement playback context (${replacement})`,async()=>{
 const h=lifecycle(),{f,speakers}=h;try{
  // Queue acceptance releases this shared lane even when its readback now has a different owner.
  const token=f.view.beginMusicIntent({queuesTransport:true});
  const moving=f.view.moveSpeaker(speakers[1],()=>true);
  assert.deepEqual(f.effects,[]);
  // The catalogue stays valid for the same account even when the origin changes.
  if(replacement==='new-route')f.adopt({binding:'b'.repeat(64)});
  if(replacement==='new-owner')f.adopt({epoch:'other-owner'});
  if(replacement==='new-transport')f.host.liveTransport={...f.host.liveTransport};
  f.view.endMusicIntent(token,'accepted');
  assert.equal(await moving,false);
  assert.deepEqual(f.effects,[]);
 }finally{h.close();}
});
// A1/A7/A10: one transient failed read keeps the player usable while the lease is still valid.
for(const failure of ['network','http','timeout'])test(`a single transient ${failure} read failure keeps controls while the lease is valid`,async()=>{
 const oldNow=Date.now;let now=oldNow();Date.now=()=>now;
 const f=fixture(),g=integrate(f);let fail=false;try{
  g.setRead(()=>{if(fail){const e=failure==='network'?new TypeError('network'):new Error(failure);if(failure==='http')e.code='read_transient';if(failure==='timeout')e.name='TimeoutError';return Promise.reject(e);}return Promise.resolve(g.body({ttl:15}));});
  await g.media.refresh({immediate:true});f.view.render();assert.equal(f.nodes.get('play-pause').disabled,false);
  fail=true;now+=2000;await g.media.refresh({immediate:true});f.view.render();
  assert.equal(f.nodes.get('play-pause').disabled,false,'the player stays usable after one transient failure');
  assert.equal(f.nodes.get('volume').disabled,false,'volume stays usable');
  assert.equal(await f.view.musicIntent('pause'),true);await tick();assert.deepEqual(f.effects.map(e=>e.action),['pause']);
  now+=20000;f.view.render();assert.equal(f.nodes.get('play-pause').disabled,true,'an expired lease still removes control');
 }finally{f.close();Date.now=oldNow;}
});
