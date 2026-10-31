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

for(const hint of ['absent','present','denied'])test(`HA session uses server capabilities without named renewal: ${hint}`,async()=>{
 const value=snapshot();value.capabilities.controlSetup=['music','vacuum','light','vehicle'];value.capabilities.vehicleActions=['unlock'];
 const h=rig({url:ROOT,screenEnrollment:false,handler:path=>{assert.equal(path,'snapshot','normal HA must not renew a named profile');return reply(value);}});
 if(hint!=='absent')h.store.setItem(h.key,JSON.stringify(intent()));if(hint==='denied')h.transport.namedRenewalDenied=true;
 try{await h.transport.start();assert.deepEqual(h.transport.snapshot.capabilities.controlSetup,value.capabilities.controlSetup);assert.deepEqual(h.transport.snapshot.capabilities.vehicleActions,['unlock']);assert.equal(h.transport.namedControllerRenewed,false);assert.equal(h.calls.length,1);}finally{h.transport.close();}
});

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

test('normal page ignores public intent and never renews or enrolls',async()=>{
 const h=rig({url:ROOT,screenEnrollment:false});h.store.setItem(h.key,JSON.stringify(intent()));
 try{
  await h.transport.start();
  assert.equal(h.transport.namedControllerRenewed,false);
  assert.equal(h.transport.controllerRenewed,false);
  await assert.rejects(h.transport.accessRequest('Mac'));
  await assert.rejects(h.transport.accessClaim(REQUEST));
  await assert.rejects(h.transport.pair('123456'));
  assert.deepEqual(posts(h.calls).map(call=>call.path),[]);
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

test('explicit setup named-cookie 403 clears the hint while preserving server HA actor capabilities',async()=>{
 const h=rig({handler:path=>path==='controller/renew'?reply({ok:false,error:'denied'},403):reply(snapshot())});h.store.setItem(h.key,JSON.stringify(intent()));
 try{
  await h.transport.start();assert.equal(h.transport.connected,true);
  assert.equal(h.transport.namedControllerRenewed,false);assert.equal(h.transport.namedRenewalDenied,true);assert.equal(h.transport.namedLaneWanted,false);
  assert.equal(h.store.getItem(h.key),null);assert.equal(h.transport.controllerRenewed,false);
  assert.deepEqual(h.transport.snapshot.admission,admission);
  assert.deepEqual(h.transport.snapshot.capabilities,snapshot().capabilities);
  h.transport.accept({...snapshot(),revision:2});assert.deepEqual(h.transport.snapshot.capabilities.controlSetup,['music','vacuum','light']);
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

for(const change of ['boot','continuity'])test(`later HA SSE ${change} suspends named proof but retains recovery hint`,async()=>{
 const h=rig();try{
  await h.transport.start();assert.equal(h.transport.namedControllerRenewed,true);
  const value={...snapshot(),revision:2};
  if(change==='boot')value.bootId='boot-two';
  if(change==='continuity')value.controllerContinuity.available=false;
  h.transport.stream.snapshot({data:JSON.stringify(value)});
  assert.equal(h.transport.namedControllerRenewed,false);assert.notEqual(h.store.getItem(h.key),null);
  assert.deepEqual(h.transport.snapshot.capabilities.controlSetup,['music','vacuum','light']);
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

test('unconfirmed setup renewal retains intent and server HA authority',async()=>{
 for(const failure of ['503','malformed']){
  const h=rig({handler:path=>path==='controller/renew'?(failure==='503'?reply({ok:false,error:'unavailable'},503):reply({...renewal(),controllerExpiresAt:'invalid'})):reply(snapshot())});
  const saved=JSON.stringify(intent());h.store.setItem(h.key,saved);
  try{
   await h.transport.start();
   assert.equal(h.transport.connected,true);assert.equal(h.transport.namedControllerRenewed,false);
   assert.equal(h.transport.namedRenewalDenied,false);assert.equal(h.transport.namedRenewalUnconfirmed,true);
   assert.equal(h.transport.controllerRenewed,false);assert.equal(h.store.getItem(h.key),saved);
   assert.deepEqual(h.transport.snapshot.admission,admission);
   assert.deepEqual(h.transport.snapshot.capabilities,snapshot().capabilities);
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
   assert.deepEqual(h.transport.snapshot.capabilities,snapshot().capabilities);
   assert.deepEqual(posts(h.calls).map(call=>call.path),['controller/renew','controller/renew']);
  }finally{flow.close();h.transport.close();}
 }
});

for(const failure of ['network','503-json','503-html','200-html'])test(`post-renew ${failure} retains verified HA reads without named proof and validates the existing profile on explicit retry`,async()=>{
 // This exact retry scheduler owns its clock as well as its fake timers.
 const previousSet=globalThis.setTimeout,previousClear=globalThis.clearTimeout,previousNow=Date.now,clockNow=previousNow(),jobs=new Map();let serial=0,reads=0,announced=0;
 Date.now=()=>clockNow;
 globalThis.setTimeout=(callback,ms)=>{jobs.set(++serial,{callback,ms});return serial;};globalThis.clearTimeout=id=>jobs.delete(id);
 const h=rig({handler:path=>{
  if(path==='controller/renew')return reply(renewal());
  if(++reads===2){if(failure==='network')throw new TypeError('inert fetch outage');if(failure.endsWith('html'))return {ok:failure==='200-html',status:failure==='200-html'?200:503,json:async()=>{throw new SyntaxError('inert HTML');}};return reply({ok:false,error:'unavailable'},503);}
  return reply(snapshot());
 }}),saved=JSON.stringify(intent());h.store.setItem(h.key,saved);h.transport.onControllerRenewed=()=>announced++;
 try{
  await h.transport.start().catch(()=>{});assert.equal(h.transport.connected,true,'the independently verified first HA read remains available');assert.equal(h.transport.namedControllerRenewed,false);assert.equal(h.transport.controllerRenewed,false);assert.equal(h.transport.namedRenewalUnconfirmed,true);assert.equal(h.transport.namedRenewalDenied,false);assert.equal(announced,0);assert.equal(h.store.getItem(h.key),saved);
  assert.deepEqual(h.transport.snapshot.admission,admission);assert.deepEqual(h.transport.snapshot.capabilities,snapshot().capabilities);
  assert.equal([...jobs.values()].some(job=>job.ms===30000),false,'setup does not automatically renew after an unconfirmed result');await h.transport.restart(false,true);
  assert.equal(h.transport.connected,true);assert.equal(h.transport.namedControllerRenewed,true);assert.equal(announced,1);assert.deepEqual(h.transport.snapshot.capabilities,snapshot().capabilities);assert.equal(h.store.getItem(h.key),saved);assert(h.calls.every(call=>['snapshot','controller/renew'].includes(call.path)),'recovery never enrolls or sends effects');
 }finally{h.transport.close();globalThis.setTimeout=previousSet;globalThis.clearTimeout=previousClear;Date.now=previousNow;}
});

test('a post-renew snapshot cannot downgrade an initially authenticated HA connection into legacy admission',async()=>{
 let reads=0,announced=0;const delivered=[];
 const h=rig({handler:path=>{if(path==='controller/renew')return reply(renewal());const value=snapshot();if(++reads===2)delete value.admission;return reply(value);}});h.transport.onSnapshot=value=>delivered.push(value);h.transport.onControllerRenewed=()=>announced++;
 try{await h.transport.start().catch(()=>{});assert.equal(h.transport.namedControllerRenewed,false);assert.equal(h.transport.controllerRenewed,false);assert.equal(h.transport.connected,false);assert.equal(announced,0);assert.equal(delivered.some(value=>!value.admission),false);assert.equal(h.store.getItem(h.key),null);}finally{h.transport.close();}
});

test('post-renew read denial remains terminal and cannot become a transient profile retry',async()=>{
 let reads=0,announced=0;const h=rig({handler:path=>path==='controller/renew'?reply(renewal()):reply(snapshot(),++reads===2?403:200)});h.store.setItem(h.key,JSON.stringify(intent()));h.transport.onControllerRenewed=()=>announced++;
 try{await assert.rejects(()=>h.transport.start());assert.equal(h.transport.connected,false);assert.equal(h.transport.recoveryBlocked,true);assert.equal(h.transport.namedControllerRenewed,false);assert.equal(h.transport.namedRenewalDenied,true);assert.equal(h.store.getItem(h.key),null);assert.equal(announced,0);assert.equal(h.transport.recoveryTimer??null,null);assert.equal(h.transport.namedRenewTimer??null,null);}finally{h.transport.close();}
});

for(const status of [401,403])test(`native HTML ${status} after renewal remains an authoritative denial through the request decoder`,async()=>{
 let reads=0,announced=0;const h=rig({handler:path=>{
  if(path==='controller/renew')return reply(renewal());
  if(++reads===2)return {ok:false,status,json:async()=>{throw new SyntaxError('inert HTML denial');}};
  return reply(snapshot());
 }});h.store.setItem(h.key,JSON.stringify(intent()));h.transport.onControllerRenewed=()=>announced++;
 try{
  await assert.rejects(()=>h.transport.start(),/transport_access_denied/);
  assert.equal(h.transport.connected,false);assert.equal(h.transport.recoveryBlocked,true);
  assert.equal(h.transport.namedControllerRenewed,false);assert.equal(h.transport.namedRenewalDenied,true);
  assert.equal(h.store.getItem(h.key),null);assert.equal(announced,0);
  assert.equal(h.transport.recoveryTimer??null,null);assert.equal(h.transport.namedRenewTimer??null,null);
  assert.deepEqual(h.calls.map(call=>call.path),['snapshot','controller/renew','snapshot']);
 }finally{h.transport.close();}
});

for(const delay of [5000,6001])test(`a failed post-renew read after ${delay}ms cannot restart the first snapshot freshness window`,async()=>{
 const previousSet=globalThis.setTimeout,previousClear=globalThis.clearTimeout,previousNow=Date.now,jobs=new Map();let serial=0,reads=0,now=previousNow();
 globalThis.setTimeout=(callback,ms)=>{jobs.set(++serial,{callback,ms});return serial;};globalThis.clearTimeout=id=>jobs.delete(id);Date.now=()=>now;
 const h=rig({handler:path=>{if(path==='controller/renew')return reply(renewal());if(++reads===2){now+=delay;throw new TypeError('inert delayed read failure');}return reply(snapshot());}}),saved=JSON.stringify(intent());h.store.setItem(h.key,saved);
 const fire=async ms=>{const entry=[...jobs.entries()].find(([,job])=>job.ms===ms);assert.ok(entry,`scheduled ${ms}ms`);jobs.delete(entry[0]);now+=ms;entry[1].callback();await new Promise(resolve=>previousSet(resolve,0));};
 try{
  await h.transport.start().catch(()=>{});assert.equal(h.transport.namedControllerRenewed,false);assert.equal(h.transport.namedRenewalDenied,false);assert.equal(h.store.getItem(h.key),saved);
  if(delay===5000){assert.equal(h.transport.connected,true);assert.equal([...jobs.values()].some(job=>job.ms===6000),false,'the old projection has only one second left');await fire(1000);assert.equal(h.transport.connected,false);}
  else{assert.equal(h.transport.connected,false);assert.equal(h.transport.snapshot,null,'expired initial data is not admitted as a new heartbeat');}
  await fire(1000);assert.equal(h.transport.connected,true);assert.equal(h.transport.namedControllerRenewed,true);assert(h.calls.every(call=>['snapshot','controller/renew'].includes(call.path)));
 }finally{h.transport.close();Date.now=previousNow;globalThis.setTimeout=previousSet;globalThis.clearTimeout=previousClear;}
});
test('renewal replaces old event stream and stale stream cannot remove Tesla authority',async()=>{
 let generation=0;const value=()=>{const v=snapshot();v.capabilities.controlSetup.push('vehicle');v.capabilities.vehicleActions=['unlock'];return v};
 const h=rig({handler:path=>{if(path==='controller/renew'){generation++;return reply(renewal());}return reply(value());}});h.store.setItem(h.key,JSON.stringify(intent()));
 try{await h.transport.start();const old=h.transport.stream;assert.equal(generation,1);assert.deepEqual(h.transport.snapshot.capabilities.vehicleActions,['unlock']);await h.transport.restart(false,true);assert.equal(generation,2);assert.equal(old.closed,true);assert.notEqual(h.transport.stream,old);const stale=value();stale.revision=2;stale.capabilities.controlSetup=stale.capabilities.controlSetup.filter(x=>x!=='vehicle');stale.capabilities.vehicleActions=[];old.snapshot({data:JSON.stringify(stale)});assert.deepEqual(h.transport.snapshot.capabilities.vehicleActions,['unlock']);assert(h.transport.snapshot.capabilities.controlSetup.includes('vehicle'));}finally{h.transport.close();}
});
test('other same-profile renewal cannot strip vehicle actions on a still-open stream',async()=>{
 const store=storage();let epoch=0;const make=()=>{const v=snapshot();v.capabilities.controlSetup.push('vehicle');v.capabilities.vehicleActions=['unlock'];return v};const handler=path=>{if(path==='controller/renew'){epoch++;return reply(renewal());}return reply(make())};const a=rig({store,handler}),b=rig({store,handler});store.setItem(a.key,JSON.stringify(intent()));
 try{await a.transport.start();const old=a.transport.stream;await b.transport.start();assert.equal(epoch,2);const stale=make();stale.revision=2;stale.capabilities.controlSetup=stale.capabilities.controlSetup.filter(x=>x!=='vehicle');stale.capabilities.vehicleActions=[];old.snapshot({data:JSON.stringify(stale)});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(old.closed,true);assert.notEqual(a.transport.stream,old);assert.deepEqual(a.transport.snapshot.capabilities.vehicleActions,['unlock']);}finally{a.transport.close();b.transport.close();}
});
test('a fresh read after lost vehicle capability honors real withdrawal without renewal loop',async()=>{
 let grant=true,reads=0;const value=()=>{const v=snapshot();if(grant){v.capabilities.controlSetup.push('vehicle');v.capabilities.vehicleActions=['unlock'];}return v};const h=rig({handler:path=>{if(path==='controller/renew')return reply(renewal());reads++;return reply(value());}});h.store.setItem(h.key,JSON.stringify(intent()));
 try{await h.transport.start();const old=h.transport.stream;grant=false;const withdrawn=value();withdrawn.revision=2;old.snapshot({data:JSON.stringify(withdrawn)});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(old.closed,true);assert.equal(h.transport.snapshot.capabilities.controlSetup.includes('vehicle'),false);const count=reads;h.transport.stream.snapshot({data:JSON.stringify(withdrawn)});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(reads,count);assert.equal(h.transport.snapshot.capabilities.controlSetup.includes('vehicle'),false);}finally{h.transport.close();}
});

test('two successive other-tab renewals each rebind and preserve fresh Tesla capability',async()=>{
 const store=storage();let epoch=0;const value=()=>{const v=snapshot();v.capabilities.controlSetup.push('vehicle');v.capabilities.vehicleActions=['unlock'];return v};const handler=path=>{if(path==='controller/renew'){epoch++;return reply(renewal());}return reply(value())};const a=rig({store,handler}),b=rig({store,handler});store.setItem(a.key,JSON.stringify(intent()));
 try{await a.transport.start();await b.transport.start();for(let n=0;n<2;n++){if(n)await b.transport.restart(false,true);const old=a.transport.stream,stale=value();stale.revision=2+n;stale.capabilities.controlSetup=stale.capabilities.controlSetup.filter(x=>x!=='vehicle');stale.capabilities.vehicleActions=[];old.snapshot({data:JSON.stringify(stale)});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(old.closed,true);assert.notEqual(a.transport.stream,old);assert.deepEqual(a.transport.snapshot.capabilities.vehicleActions,['unlock']);}assert.equal(epoch,3);}finally{a.transport.close();b.transport.close();}
});

for(const reason of ['boot','temporarily unavailable'])test(`explicit setup profile renews after ${reason} without another claim`,async()=>{
 let value=snapshot(),denied=false;const h=rig({handler:path=>path==='controller/renew'?reply(denied?{ok:false,error:'denied'}:renewal(),denied?403:200):reply(value)});h.store.setItem(h.key,JSON.stringify(intent()));
 try{await h.transport.start();const original=h.store.getItem(h.key);let changed=snapshot();changed.revision=2;if(reason==='boot')changed.bootId='boot-two';else changed.controllerContinuity.available=false;h.transport.stream.snapshot({data:JSON.stringify(changed)});assert.equal(h.transport.namedControllerRenewed,false);assert.equal(h.store.getItem(h.key),original);value=snapshot();value.revision=3;if(reason==='boot')value.bootId='boot-two';await h.transport.restart(false,true);assert.equal(h.transport.namedControllerRenewed,true);assert.equal(h.store.getItem(h.key),original);denied=true;await h.transport.restart(false,true);assert.equal(h.transport.namedRenewalDenied,true);assert.equal(h.store.getItem(h.key),null);assert(h.calls.every(c=>['snapshot','controller/renew'].includes(c.path)));}finally{h.transport.close();}
});
test('boot change schedules automatic same-cookie renewal with no enrollment',async()=>{
 let value=snapshot(),renewals=0;const h=rig({handler:path=>{if(path==='controller/renew'){renewals++;return reply(renewal());}return reply(value);}});h.store.setItem(h.key,JSON.stringify(intent()));
 try{await h.transport.start();value=snapshot();value.bootId='boot-two';value.revision=2;h.transport.stream.snapshot({data:JSON.stringify(value)});assert.equal(h.transport.namedControllerRenewed,false);await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(renewals,2);assert.equal(h.transport.namedControllerRenewed,true);assert(h.calls.every(c=>['snapshot','controller/renew'].includes(c.path)));}finally{h.transport.close();}
});
test('temporary continuity outage recovers automatically when the owner returns',async()=>{
 let value=snapshot(),renewals=0;const h=rig({handler:path=>{if(path==='controller/renew'){renewals++;return reply(renewal());}return reply(value);}});h.store.setItem(h.key,JSON.stringify(intent()));
 try{await h.transport.start();const hint=h.store.getItem(h.key);value=snapshot();value.revision=2;value.controllerContinuity.available=false;h.transport.stream.snapshot({data:JSON.stringify(value)});assert.equal(h.transport.namedControllerRenewed,false);assert.equal(h.store.getItem(h.key),hint);value=snapshot();value.revision=3;h.transport.stream.snapshot({data:JSON.stringify(value)});await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(renewals,2);assert.equal(h.transport.namedControllerRenewed,true);assert.equal(h.store.getItem(h.key),hint);await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(renewals,2,'successful recovery must not schedule an extra renewal');assert(h.calls.every(c=>['snapshot','controller/renew'].includes(c.path)));}finally{h.transport.close();}
});

for(const status of [401,403])test(`ordinary HA snapshot ${status} blocks access without renewal or enrollment`,async()=>{
 const h=rig({url:ROOT,screenEnrollment:false,handler:path=>reply(snapshot(),status)});h.store.setItem(h.key,JSON.stringify(intent()));try{await assert.rejects(()=>h.transport.start(),/transport_access_denied/);assert.equal(h.transport.recoveryBlocked,true);assert.equal(h.transport.connected,false);assert.deepEqual(h.calls.map(call=>call.path),['snapshot']);assert.equal(posts(h.calls).length,0);}finally{h.transport.close();}
});
