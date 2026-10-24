import test from 'node:test';
import assert from 'node:assert/strict';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
import {SetupFlow} from '../../podvoice/gatekeeper/static/podview/setup.js';

const ROOT='https://ha.test/api/hassio_ingress/opaque/view/';
const REQUEST='a'.repeat(32);
const admission={kind:'ha_ingress',authenticated:true};
const snapshot=()=>({schema:'podview.snapshot.v1',bootId:'boot-one',roomId:'kitchen',revision:1,voice:{active:false},timers:{status:'observed',epoch:'timers',items:[]},capabilities:{musicRead:['targets'],homeRead:['light','weather'],timerActions:['timer.start'],controlSetup:['music','vacuum','light'],musicSelection:true,queueSelection:true},controllerContinuity:{enabled:true,available:true},admission:{...admission}});
const renewal=()=>({ok:true,expiresIn:300,controllerExpiresAt:Date.now()/1000+3600});
const reply=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(body)});
const intent=(scope=ROOT,roomId='kitchen')=>({version:1,cookieScope:scope,roomId});
function storage(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
class Events{addEventListener(name,listener){this[name]=listener;}close(){this.closed=true;}}
function rig({url=ROOT+'setup.html',screenEnrollment=true,store=storage(),handler}={}){
 const calls=[];let snapshots=0;
 const transport=new PodVoiceTransport({url,screenEnrollment,namedIntentStorage:store,EventSource:Events,locks:null,BroadcastChannel:null,crypto:null,fetch:async(url,init={})=>{const parsed=new URL(url),path=parsed.pathname.slice(parsed.pathname.lastIndexOf('/api/')+5);calls.push({url:parsed,init,path});if(handler)return handler(path,init,++snapshots);return reply(path==='controller/renew'?renewal():snapshot());}});
 return {transport,calls,store,key:transport.namedIntentKey};
}
function posts(calls){return calls.filter(call=>call.init.method==='POST');}
function assertCookiePost(call,body){assert.equal(call.url.origin,new URL(ROOT).origin);assert.equal(call.init.credentials,'same-origin');assert.equal(call.init.cache,'no-store');assert.equal(call.init.headers['X-PodView-Request'],'1');assert.deepEqual(JSON.parse(call.init.body),body);assert.equal('Authorization' in call.init.headers,false);}

test('explicit HA setup renewal creates separate named proof only after a fresh same-owner snapshot',async()=>{
 const h=rig();try{
  await h.transport.start();
  assert.deepEqual(h.calls.map(call=>call.path),['snapshot','controller/renew','snapshot']);
  assertCookiePost(h.calls[1],{roomId:'kitchen'});
  assert.equal(h.transport.namedControllerRenewed,true);
  assert.equal(h.transport.controllerRenewed,false);
  assert.deepEqual(h.transport.snapshot.admission,admission);
  assert.deepEqual(h.transport.snapshot.capabilities,snapshot().capabilities);
  assert.deepEqual(JSON.parse(h.store.getItem(h.key)),intent());
  assert.equal(h.store.values.size,1);
  assert.equal(h.transport.namedRenewAt>Date.now()+230000,true);
 }finally{h.transport.close();}
});

for(const path of ['', 'library.html'])test(`enrollment flag on ordinary ${path||'root'} page cannot request claim pair or rotate cookie`,async()=>{
 const h=rig({url:ROOT+path});try{
  await h.transport.start();
  assert.equal(h.transport.screenEnrollment,false);
  await assert.rejects(h.transport.accessRequest('Mac'),/access_unavailable/);
  await assert.rejects(h.transport.accessClaim(REQUEST),/access_unavailable/);
  await assert.rejects(h.transport.pair('123456'));
  assert.deepEqual(h.calls.map(call=>call.path),['snapshot']);
  assert.equal(h.transport.namedControllerRenewed,false);
 }finally{h.transport.close();}
});

test('default HA setup without opt-in keeps original capabilities and forbids legacy enrollment',async()=>{
 const h=rig({screenEnrollment:false});try{
  await h.transport.start();
  await assert.rejects(h.transport.accessRequest('Mac'));
  await assert.rejects(h.transport.accessClaim(REQUEST));
  await assert.rejects(h.transport.pair('123456'));
  assert.equal(posts(h.calls).length,0);
  assert.deepEqual(h.transport.snapshot.capabilities,snapshot().capabilities);
  assert.equal(h.store.getItem(h.key),null);
 }finally{h.transport.close();}
});

test('normal page public intent can only validate its existing cookie and never enroll',async()=>{
 const h=rig({url:ROOT,screenEnrollment:false});h.store.setItem(h.key,JSON.stringify(intent()));
 try{
  await h.transport.start();
  assert.equal(h.transport.namedControllerRenewed,true);
  assert.equal(h.transport.controllerRenewed,false);
  await assert.rejects(h.transport.accessRequest('Mac'));
  await assert.rejects(h.transport.accessClaim(REQUEST));
  await assert.rejects(h.transport.pair('123456'));
  assert.deepEqual(posts(h.calls).map(call=>call.path),['controller/renew']);
 }finally{h.transport.close();}
});

for(const bad of [intent(ROOT+'other/'),intent(ROOT,'other-room'),{...intent(),version:2},{...intent(),token:'forged'},null,'not-json'])test(`forged intent is not authority ${JSON.stringify(bad)}`,async()=>{
 const h=rig({url:ROOT,screenEnrollment:false});h.store.setItem(h.key,typeof bad==='string'?bad:JSON.stringify(bad));
 try{await h.transport.start();assert.equal(posts(h.calls).length,0);assert.equal(h.transport.namedControllerRenewed,false);assert.equal(h.transport.controllerRenewed,false);}
 finally{h.transport.close();}
});

for(const mutate of [x=>delete x.controllerExpiresAt,x=>x.extra=true,x=>x.expiresIn=299,x=>x.ok=1,x=>x.controllerExpiresAt='future',x=>x.controllerExpiresAt=Date.now()/1000-1])test(`malformed renewal cannot create named proof ${mutate}`,async()=>{
 const bad=renewal();mutate(bad);const h=rig({handler:path=>reply(path==='controller/renew'?bad:snapshot())});
 try{await h.transport.start();assert.equal(h.transport.namedControllerRenewed,false);assert.equal(h.transport.controllerRenewed,false);assert.equal(h.store.getItem(h.key),null);assert.deepEqual(h.calls.map(call=>call.path),['snapshot','controller/renew']);}
 finally{h.transport.close();}
});

test('nonexpiring authoritative named cookie receipt is admitted with null expiry',async()=>{
 const h=rig({handler:path=>reply(path==='controller/renew'?{...renewal(),controllerExpiresAt:null}:snapshot())});
 try{await h.transport.start();assert.equal(h.transport.namedControllerRenewed,true);assert.deepEqual(JSON.parse(h.store.getItem(h.key)),intent());}
 finally{h.transport.close();}
});

test('named-cookie 403 clears only named hint and light setup while preserving HA actor capabilities',async()=>{
 const h=rig({url:ROOT,screenEnrollment:false,handler:path=>path==='controller/renew'?reply({ok:false,error:'denied'},403):reply(snapshot())});h.store.setItem(h.key,JSON.stringify(intent()));
 try{
  await h.transport.start();assert.equal(h.transport.connected,true);
  assert.equal(h.transport.namedControllerRenewed,false);assert.equal(h.transport.namedRenewalDenied,true);assert.equal(h.transport.namedLaneWanted,false);
  assert.equal(h.store.getItem(h.key),null);assert.equal(h.transport.controllerRenewed,false);
  assert.deepEqual(h.transport.snapshot.admission,admission);
  assert.deepEqual(h.transport.snapshot.capabilities,{...snapshot().capabilities,controlSetup:['music','vacuum']});
  h.transport.accept({...snapshot(),revision:2});assert.deepEqual(h.transport.snapshot.capabilities.controlSetup,['music','vacuum']);
  assert.deepEqual(posts(h.calls).map(call=>call.path),['controller/renew']);
 }finally{h.transport.close();}
});

for(const change of ['boot','room','denied','invalid','continuity'])test(`fresh snapshot ${change} cannot publish successful named enrollment`,async()=>{
 let count=0;
 const h=rig({handler:path=>{if(path==='controller/renew')return reply(renewal());const value=snapshot();if(++count===2){if(change==='boot')value.bootId='boot-two';if(change==='room')value.roomId='office';if(change==='invalid')value.revision=0;if(change==='continuity')value.controllerContinuity.available=false;}return reply(value,change==='denied'&&count===2?403:200);}});
 try{
  await h.transport.start().catch(()=>{});
  assert.equal(h.transport.namedControllerRenewed,false);
  assert.equal(h.store.getItem(h.key),null);
  assert.equal(h.transport.controllerRenewed,false);
 }finally{h.transport.close();}
});

test('held old-generation renewal cannot revive named proof or write intent after close',async()=>{
 let enter,release;const entered=new Promise(resolve=>enter=resolve),held=new Promise(resolve=>release=resolve);
 const h=rig({handler:async path=>{if(path==='controller/renew'){enter();await held;return reply(renewal());}return reply(snapshot());}});
 try{const pending=h.transport.start();await entered;h.transport.close();release();await pending.catch(()=>{});assert.equal(h.transport.closed,true);assert.equal(h.transport.namedControllerRenewed,false);assert.equal(h.store.getItem(h.key),null);}
 finally{release?.();h.transport.close();}
});

for(const change of ['boot','continuity'])test(`later HA SSE ${change} removes named proof and hint without stripping unrelated HA actions`,async()=>{
 const h=rig();try{
  await h.transport.start();assert.equal(h.transport.namedControllerRenewed,true);
  const value={...snapshot(),revision:2};
  if(change==='boot')value.bootId='boot-two';
  if(change==='continuity')value.controllerContinuity.available=false;
  h.transport.stream.snapshot({data:JSON.stringify(value)});
  assert.equal(h.transport.namedControllerRenewed,false);assert.equal(h.store.getItem(h.key),null);
  assert.deepEqual(h.transport.snapshot.capabilities.controlSetup,['music','vacuum']);
  assert.deepEqual(h.transport.snapshot.capabilities.timerActions,['timer.start']);
  assert.equal(h.transport.snapshot.capabilities.musicSelection,true);
  assert.equal(h.transport.controllerRenewed,false);
 }finally{h.transport.close();}
});

test('peer cookie notice grants no named proof or enrollment and only triggers a read refresh',async()=>{
 const h=rig({url:ROOT,screenEnrollment:false});h.store.setItem(h.key,JSON.stringify(intent()));
 try{
  await h.transport.start();const before=posts(h.calls).length;
  h.transport.receiveControllerNotice({version:1,type:'controller-cookie-changed',sender:'other-tab',sequence:1});
  await h.transport.restart(false,false);
  assert.equal(h.transport.namedControllerRenewed,false);
  assert.equal(h.transport.controllerRenewed,false);
  assert.equal(posts(h.calls).length,before);
  assert.equal(h.calls.at(-1).path,'snapshot');
 }finally{h.transport.close();}
});

test('actual HA request claim renew snapshot chain stays linked until explicit Åbn PodView',async()=>{
 let approved=false,flow;const views=[],navigation=[],jobs=new Map();let serial=0;
 const h=rig({handler:path=>{if(path==='controller/request')return reply({ok:true,requestId:REQUEST,matchSignal:'ABC234',expiresIn:300});if(path==='controller/claim'){approved=true;return reply({ok:true,status:'connected'});}if(path==='controller/renew')return approved?reply(renewal()):reply({ok:false,error:'not_paired'},403);return reply(snapshot());}});
 // The existing renderer mutates one retained button from Flow's view model.
 const button={textContent:'Bed om adgang',disabled:false};
 flow=new SetupFlow({transport:h.transport,render:view=>{views.push(view);button.textContent=view.button;button.disabled=view.disabled;},navigate:url=>navigation.push(url),schedule:(fn,ms)=>{const key=++serial;jobs.set(key,{fn,ms});return key;},cancel:key=>jobs.delete(key)});
 h.transport.onConnection=state=>flow.connection(state);
 try{
  await flow.start();assert.equal(flow.phase,'ready');
  await flow.submit(' Mac ');assert.equal(flow.phase,'pending');
  assert.match(views.at(-1).status,/ABC234/);assert.equal(jobs.size,1);
  const job=[...jobs.values()][0];jobs.clear();await job.fn();
  assert.equal(flow.phase,'linked');assert.equal(h.transport.namedControllerRenewed,true);
  assert.equal(h.transport.controllerRenewed,false);assert.deepEqual(navigation,[]);
  assert.equal(button.textContent,'Åbn PodView');assert.equal(button.disabled,false);
  assert.equal(views.at(-1).nameDisabled,true);assert.equal(views.at(-1).adminVisible,true);
  assert.match(views.at(-1).status,/PodViews rum/);assert.match(views.at(-1).status,/Home Assistant/);
  assert.deepEqual(posts(h.calls).map(call=>call.path),['controller/renew','controller/request','controller/claim','controller/renew']);
  assertCookiePost(h.calls.find(call=>call.path==='controller/request'),{bootId:'boot-one',roomId:'kitchen',name:'Mac'});
  assertCookiePost(h.calls.find(call=>call.path==='controller/claim'),{bootId:'boot-one',roomId:'kitchen',requestId:REQUEST});
  assert.equal(jobs.size,0);await flow.submit('ignored');
  assert.deepEqual(navigation,['./?room=kitchen']);assert.equal(flow.closed,true);
  assert.deepEqual(JSON.parse(h.store.getItem(h.key)),intent());
 }finally{flow.close();h.transport.close();}
});

test('connected claim without valid renewed named proof cannot link or navigate',async()=>{
 const jobs=new Map(),views=[],navigation=[];let flow;
 const h=rig({handler:path=>path==='controller/request'?reply({ok:true,requestId:REQUEST,matchSignal:'ABC234',expiresIn:300}):path==='controller/claim'?reply({ok:true,status:'connected'}):path==='controller/renew'?reply({...renewal(),controllerExpiresAt:'not-a-receipt'}):reply(snapshot())});
 flow=new SetupFlow({transport:h.transport,render:view=>views.push(view),navigate:url=>navigation.push(url),schedule:fn=>{jobs.set(1,fn);return 1;},cancel:key=>jobs.delete(key)});h.transport.onConnection=state=>flow.connection(state);
 try{await flow.start();await flow.submit('Mac');const job=jobs.get(1);jobs.clear();await job();assert.equal(flow.phase,'unknown');assert.deepEqual(navigation,[]);assert.equal(views.at(-1).disabled,true);assert.equal(h.store.getItem(h.key),null);}
 finally{flow.close();h.transport.close();}
});

test('unconfirmed existing-cookie renewal retains public retry intent but filters only light authority',async()=>{
 for(const failure of ['503','malformed']){
  const h=rig({url:ROOT,screenEnrollment:false,handler:path=>path==='controller/renew'?(failure==='503'?reply({ok:false,error:'unavailable'},503):reply({...renewal(),controllerExpiresAt:'invalid'})):reply(snapshot())});
  const saved=JSON.stringify(intent());h.store.setItem(h.key,saved);
  try{
   await h.transport.start();
   assert.equal(h.transport.connected,true);assert.equal(h.transport.namedControllerRenewed,false);
   assert.equal(h.transport.namedRenewalDenied,false);assert.equal(h.transport.namedRenewalUnconfirmed,true);
   assert.equal(h.transport.controllerRenewed,false);assert.equal(h.store.getItem(h.key),saved);
   assert.deepEqual(h.transport.snapshot.admission,admission);
   assert.deepEqual(h.transport.snapshot.capabilities,{...snapshot().capabilities,controlSetup:['music','vacuum']});
   assert.deepEqual(posts(h.calls).map(call=>call.path),['controller/renew']);
   assert.equal(h.transport.namedRenewAt>Date.now()+29000,true);
  }finally{h.transport.close();}
 }
});

test('linked setup stops claiming successful linkage when current named proof becomes unconfirmed or denied',async()=>{
 for(const failure of ['unconfirmed','denied']){
  let mode='valid',flow;const views=[],navigation=[];
  const h=rig({handler:path=>path==='controller/renew'?(mode==='valid'?reply(renewal()):failure==='denied'?reply({ok:false,error:'denied'},403):reply({ok:false,error:'unavailable'},503)):reply(snapshot())});
  flow=new SetupFlow({transport:h.transport,render:view=>views.push(view),navigate:url=>navigation.push(url)});
  h.transport.onConnection=state=>flow.connection(state);
  try{
   await flow.start();assert.equal(flow.phase,'linked');assert.match(views.at(-1).status,/Skærmen er tilknyttet/);
   mode='failed';await h.transport.start();
   assert.equal(h.transport.connected,true);assert.equal(h.transport.namedControllerRenewed,false);
   assert.equal(flow.phase,failure==='denied'?'error':'unknown');
   assert.doesNotMatch(views.at(-1).status,/Skærmen er tilknyttet/);
   assert.match(views.at(-1).status,failure==='denied'?/godkendes igen/:/ikke bekræftes/);
   assert.notEqual(views.at(-1).button,'Åbn PodView');assert.deepEqual(navigation,[]);
   assert.deepEqual(h.transport.snapshot.capabilities,{...snapshot().capabilities,controlSetup:['music','vacuum']});
   assert.deepEqual(posts(h.calls).map(call=>call.path),['controller/renew','controller/renew']);
  }finally{flow.close();h.transport.close();}
 }
});
