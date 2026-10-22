import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
const snapshot=(allowed=true)=>({schema:'podview.snapshot.v1',bootId:'boot',revision:1,roomId:'room',voice:{active:false},timers:{status:'observed',items:[]},capabilities:{musicRead:['targets'],timerActions:allowed?['timer.start']:[],controlSetup:allowed?['vacuum']:[],musicSelection:allowed,queueSelection:allowed},controllerContinuity:{enabled:true,available:true}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function rig({locked=true,rotateGrant=false}={}){const channels=[],streams=[],calls=[],tails=new Map(),cookieJar={control:"grant-0"};let active=0,maxActive=0,allowed=true,grantSerial=0;
 class Channel{constructor(name){this.name=name;channels.push(this);}postMessage(data){for(const c of channels)if(c!==this&&!c.closed&&c.name===this.name)queueMicrotask(()=>c.onmessage?.({data}));}close(){this.closed=true;}}
 class Stream{constructor(url){this.url=url;this.grant=cookieJar.control;this.closed=false;streams.push(this);}addEventListener(name,fn){this[name]=fn;}emit(value=snapshot(this.grant===cookieJar.control)){this.snapshot({data:JSON.stringify(value)});}close(){this.closed=true;}}
 const locks={request(name,_options,fn){const before=tails.get(name)||Promise.resolve();const result=before.then(fn);tails.set(name,result.catch(()=>{}));return result;}};
 const fetch=async(url,options)=>{const path=new URL(url).pathname;calls.push({path,method:options.method||'GET'});if(path.endsWith('/controller/renew')){active++;maxActive=Math.max(active,maxActive);await sleep(10);active--;if(rotateGrant)cookieJar.control=`grant-${++grantSerial}`;return {ok:true,status:200,json:async()=>({ok:true,expiresIn:300})};}if(rotateGrant&&path.endsWith("/control/setup"))return {ok:true,status:200,json:async()=>({ok:true,taskId:"task-current"})};return {ok:true,status:200,json:async()=>snapshot(allowed)};};
 const make=(url='https://inert.invalid/api/hassio_ingress/test/view/')=>new PodVoiceTransport({url,fetch,EventSource:Stream,locks:locked?locks:null,BroadcastChannel:Channel,crypto:webcrypto});return {make,channels,streams,calls,cookieJar,max:()=>maxActive,setAllowed:value=>allowed=value};}
test('two transports serialize complete renewal HTTP for the same ingress cookie path',async()=>{const h=rig(),a=h.make(),b=h.make();try{await Promise.all([a.start(),b.start()]);await sleep(100);assert.equal(h.max(),1);assert.equal(h.calls.filter(c=>c.path.endsWith('/controller/renew')).length,1);assert.equal(a.connected,true);assert.equal(b.connected,true);}finally{a.close();b.close();}});
test('peer hints reconnect reads only, preserve own deadline and never assert local renewal',async()=>{const h=rig(),a=h.make();try{await a.start();const due=a.controllerRenewAt;const channel=h.channels[0];assert.ok(channel);const initial=h.calls.length;h.setAllowed(false);const notice={version:1,type:'controller-cookie-changed',sender:'peer',sequence:1};channel.onmessage({data:notice});channel.onmessage({data:notice});channel.onmessage({data:{...notice,sequence:0}});await sleep(100);assert.equal(h.calls.slice(initial).filter(c=>c.path.endsWith('/controller/renew')).length,0);assert.equal(h.calls.slice(initial).filter(c=>c.path.endsWith('/snapshot')).length,1);assert.equal(a.controllerRenewed,false);assert.equal(a.controllerRenewAt,due);assert.deepEqual(a.snapshot.capabilities.controlSetup,[]);assert.equal(a.connected,true);}finally{a.close();}});
test('lock scope isolates distinct ingress cookie paths and notices contain no authority',async()=>{const h=rig(),a=h.make('https://inert.invalid/a/view/'),b=h.make('https://inert.invalid/b/view/');try{await Promise.all([a.start(),b.start()]);assert.equal(h.max(),2);assert.notEqual(h.channels[0].name,h.channels[1].name);assert.ok(h.channels.every(c=>!c.name.includes('/view/')));}finally{a.close();b.close();}});
test('missing locks provides read hints only without peer-triggered renewal',async()=>{const h=rig({locked:false}),a=h.make();try{await a.start();assert.equal(a.coordinationMode,'read-hints-only');const initial=h.calls.length;h.channels[0].onmessage({data:{version:1,type:'controller-cookie-changed',sender:'peer',sequence:1}});await sleep(100);assert.equal(h.calls.slice(initial).filter(c=>c.path.endsWith('/controller/renew')).length,0);}finally{a.close();}});

// Await actual HTTP entry and peer coordination, not WebCrypto completion order.
async function startInRenewalOrder(first,second){
 let enter,release;const entered=new Promise(resolve=>enter=resolve),held=new Promise(resolve=>release=resolve),original=first.fetch;
 first.fetch=async(url,options)=>{if(new URL(url).pathname.endsWith('/controller/renew')){enter();await held;}return original(url,options);};
 const started=first.start();await entered;const following=second.start();await second.coordinate();release();await Promise.all([started,following]);
}
test('setup page never mistakes a peer notice for its own completed enrollment renewal',async()=>{const h=rig(),a=h.make(),b=h.make('https://inert.invalid/api/hassio_ingress/test/view/setup.html');try{await startInRenewalOrder(a,b);assert.equal(b.controllerRenewed,true);assert.equal(h.calls.filter(c=>c.path.endsWith('/controller/renew')).length,2);}finally{a.close();b.close();}});
test('coalesced new main tab has bounded followup attempt without fabricated grant deadline',async()=>{const h=rig(),a=h.make(),b=h.make();try{await startInRenewalOrder(a,b);assert.equal(b.controllerRenewed,false);assert.equal(b.controllerRenewAt,undefined);assert.ok(b.controllerRenewRetryAt>Date.now());assert.ok(b.controllerRenewRetryAt<=Date.now()+30000);assert.equal(h.calls.filter(c=>c.path.endsWith('/controller/renew')).length,1);}finally{a.close();b.close();}});
test('expired projected cookie authority triggers bounded grant recovery rather than permanent read-only state',async()=>{const h=rig(),a=h.make();try{await a.start();h.channels[0].onmessage({data:{version:1,type:'controller-cookie-changed',sender:'peer',sequence:1}});await sleep(100);assert.equal(a.cookieReadAuthority,true);const stream=h.streams.at(-1);stream.emit(snapshot(false));assert.equal(a.cookieReadAuthority,false);assert.equal(a.recoveryReadOnly,false);assert.ok(a.recoveryTimer);const timer=a.recoveryTimer;stream.emit(snapshot(false));assert.equal(a.recoveryTimer,timer);assert.deepEqual(a.snapshot.capabilities.controlSetup,[]);}finally{a.close();}});
test('late GET response from old generation cannot publish after peer reconnect',async()=>{const h=rig(),a=h.make();try{await a.start();let release;const original=a.fetch;a.fetch=async(url,options)=>new URL(url).pathname.endsWith('/home')?new Promise(r=>release=r):original(url,options);const held=a.request(a.endpoint('home'),{credentials:'same-origin'});h.channels[0].onmessage({data:{version:1,type:'controller-cookie-changed',sender:'peer',sequence:1}});await sleep(100);release({ok:true,status:200,json:async()=>({ok:true})});await assert.rejects(held,{name:'AbortError'});}finally{a.close();}});
test('queued scheduled renew coalesces with expired own deadline without an immediate timer loop',async()=>{const h=rig(),a=h.make(),b=h.make();try{await Promise.all([a.start(),b.start()]);await sleep(100);a.controllerRenewAt=Date.now()-100;b.controllerRenewAt=Date.now()-100;const count=h.calls.filter(c=>c.path.endsWith('/controller/renew')).length;await Promise.all([a.restart(false,true,true),b.restart(false,true,true)]);await sleep(100);assert.equal(h.calls.filter(c=>c.path.endsWith('/controller/renew')).length,count+1);const coalesced=[a,b].find(t=>t.controllerRenewRetryAt);assert.ok(coalesced);assert.ok(coalesced.controllerRenewAt<Date.now());assert.ok(coalesced.controllerRenewRetryAt>Date.now()+29000);assert.equal(coalesced.controllerRenewed,false);}finally{a.close();b.close();}});
test('closing during held renew keeps serialization until HTTP completion without reviving the closed owner',async()=>{const h=rig(),a=h.make(),b=h.make();let release,entered;const waiting=new Promise(r=>entered=r);const original=a.fetch;a.fetch=async(url,options)=>{if(new URL(url).pathname.endsWith('/controller/renew')){entered();await new Promise(r=>release=r);}return original(url,options);};try{const first=a.start();await waiting;a.close();const second=b.start();await sleep(30);assert.equal(h.calls.filter(c=>c.path.endsWith('/controller/renew')).length,0);release();await Promise.all([first,second]);assert.equal(a.closed,true);assert.equal(a.connected,false);assert.equal(a.controllerRenewed,false);assert.equal(b.connected,true);assert.equal(h.max(),1);}finally{release?.();a.close();b.close();}});

test('previously scheduled peer timer cannot interrupt a later held own renewal',async()=>{const h=rig(),a=h.make();let release;try{await a.start();h.channels[0].onmessage({data:{version:1,type:'controller-cookie-changed',sender:'peer',sequence:1}});const original=a.fetch;let entered;const begun=new Promise(r=>entered=r);a.fetch=async(url,options)=>{if(new URL(url).pathname.endsWith('/controller/renew')){entered();await new Promise(r=>release=r);}return original(url,options);};const renewing=a.restart(false,true);await begun;const generation=a.generation;await sleep(100);assert.equal(a.generation,generation,'peer timer must defer until held renewal completes');release();await renewing;}finally{release?.();a.close();}});

test('setup-first renewal is local while the ordinary peer may coalesce',async()=>{const h=rig(),a=h.make(),b=h.make('https://inert.invalid/api/hassio_ingress/test/view/setup.html');try{await startInRenewalOrder(b,a);assert.equal(b.controllerRenewed,true);assert.equal(a.controllerRenewed,false);assert.equal(h.calls.filter(c=>c.path.endsWith('/controller/renew')).length,1);assert.equal(h.max(),1);assert.equal(a.connected,true);assert.equal(b.connected,true);}finally{a.close();b.close();}});

// This fake cookie jar models same-profile browser propagation; backend grant
// rotation is independently checked by test_podview_controller_continuity.py.
test('same-profile second-tab renewal makes old SSE stale, then peer read restores only current control permission',async()=>{
 const h=rig({locked:false,rotateGrant:true}),eventsA=[],eventsB=[],a=h.make(),b=h.make();
 a.onSnapshot=s=>eventsA.push(s);b.onSnapshot=s=>eventsB.push(s);
 try{
  await a.start();
  const aOldStream=h.streams.at(-1),oldGrant=h.cookieJar.control;
  assert.equal(a.snapshot.capabilities.controlSetup[0],'vacuum');
  assert.equal(aOldStream.grant,oldGrant);
  await b.start();
  const currentGrant=h.cookieJar.control;
  assert.notEqual(currentGrant,oldGrant);
  assert.equal(aOldStream.closed,false);
  assert.deepEqual(b.snapshot.capabilities.controlSetup,['vacuum']);

  // The already-open stream continues with its captured cookie and projects no
  // writable capability after the other tab rotated this one profile grant.
  aOldStream.emit();
  assert.deepEqual(a.snapshot.capabilities.controlSetup,[]);
  await assert.rejects(a.controlSetup('vacuum',{entityId:'vacuum.test'}),/control_not_paired/);

  // The cookie-change peer notice must make A read again under the shared current
  // cookie, not renew and rotate it a third time. The transport schedules this
  // as a bounded read, so allow its actual callback to run.
  await sleep(1200);
  assert.deepEqual(a.snapshot.capabilities.controlSetup,['vacuum']);
  assert.ok(eventsA.some(s=>s.capabilities.controlSetup?.length===0));
  assert.ok(eventsA.some(s=>s.capabilities.controlSetup?.includes('vacuum')));
  assert.ok(eventsB.some(s=>s.capabilities.controlSetup?.includes('vacuum')));
  assert.equal(h.cookieJar.control,currentGrant);
  assert.equal(h.calls.filter(c=>c.path.endsWith('/controller/renew')).length,2);
  assert.equal(h.calls.filter(c=>c.path.endsWith('/snapshot')).length,5);

  // Permission recovery only enables the existing user-driven setup boundary.
  // No control setup is auto-issued by reconnect, and no action is replayed.
  assert.equal(h.calls.filter(c=>c.path.endsWith('/control/setup')).length,0);
  assert.equal(h.calls.filter(c=>c.path.endsWith('/control/actions')).length,0);
  const offered=await a.controlSetup('vacuum',{entityId:'vacuum.test'});
  assert.equal(offered.taskId,'task-current');
  assert.equal(h.calls.filter(c=>c.path.endsWith('/control/setup')).length,1);
  assert.equal(h.calls.filter(c=>c.path.endsWith('/control/actions')).length,0);
 }finally{a.close();b.close();}
});
