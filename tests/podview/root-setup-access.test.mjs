import test from 'node:test';
import assert from 'node:assert/strict';
import {SetupFlow} from '../../podvoice/gatekeeper/static/podview/setup.js';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';

const id='a'.repeat(32);
const snapshot=()=>({schema:'podview.snapshot.v1',bootId:'boot',roomId:'kitchen',revision:1,voice:{active:false},timers:{status:'observed',items:[]},capabilities:{musicRead:[],timerActions:[]},controllerContinuity:{enabled:true,available:true}});
function client(reply){
 const calls=[];
 const transport=new PodVoiceTransport({url:'https://home.test/api/hassio_ingress/opaque/view/setup.html',fetch:async(url,options)=>{calls.push({url:String(url),options});return {ok:true,json:async()=>reply};}});
 transport.closed=false;transport.connected=true;transport.snapshot=snapshot();transport.room='kitchen';
 return {transport,calls};
}

test('new continuity metadata and original bounded metadata remain closed schemas',()=>{
 const {transport}=client({});
 try{
  assert.equal(transport.accept(snapshot()),true);
  const old=snapshot();old.controllerContinuity.maxDays=30;assert.equal(transport.accept(old),true);
  for(const mutate of [s=>s.controllerContinuity.extra=true,s=>s.controllerContinuity.maxDays=null,s=>s.controllerContinuity.maxDays=31,s=>s.controllerContinuity.available=1]){const value=snapshot();mutate(value);assert.equal(transport.accept(value),false);}
 }finally{transport.close();}
});
test('access request sends exact owner context once and never a copied credential',async()=>{
 const {transport,calls}=client({ok:true,requestId:id,matchSignal:'ABC234',expiresIn:300});
 try{
  assert.deepEqual(await transport.accessRequest('iPad'),{requestId:id,matchSignal:'ABC234',expiresIn:300});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://home.test/api/hassio_ingress/opaque/view/api/controller/request?room=kitchen');
  const options=calls[0].options;
  assert.equal(options.credentials,'same-origin');assert.equal(options.headers['X-PodView-Request'],'1');
  assert.deepEqual(JSON.parse(options.body),{bootId:'boot',roomId:'kitchen',name:'iPad'});
 }finally{transport.close();}
});
test('invalid labels and request IDs cannot issue requests',async()=>{
 const {transport,calls}=client({});
 try{
  for(const name of ['',null,' x','x\n','x'.repeat(49)])await assert.rejects(()=>transport.accessRequest(name));
  for(const requestId of ['',null,'a'.repeat(31),'A'.repeat(32),'<script>'])await assert.rejects(()=>transport.accessClaim(requestId));
  assert.equal(calls.length,0);
 }finally{transport.close();}
});
test('request response admits only the frozen non-secret receipt',async()=>{
 const good={ok:true,requestId:id,matchSignal:'ABC234',expiresIn:300};
 for(const mutate of [x=>x.expiresIn=301,x=>x.matchSignal='abcdef',x=>x.requestId='wrong',x=>x.cookie='secret',x=>x.ok=1]){
  const value={...good};mutate(value);const {transport,calls}=client(value);
  try{await assert.rejects(()=>transport.accessRequest('Mac'));assert.equal(calls.length,1);}finally{transport.close();}
 }
});
test('claim does not treat pending, malformed or extra data as approval',async()=>{
 for(const [reply,expected]of [[{ok:true,status:'pending',expiresIn:100},{status:'pending',expiresIn:100}],[{ok:true,status:'connected'},{status:'connected'}],[{ok:true,status:'connected',token:'secret'},null],[{ok:true,status:'pending',expiresIn:301},null],[{ok:true,status:'approved'},null]]){
  const {transport,calls}=client(reply);
  try{if(expected)assert.deepEqual(await transport.accessClaim(id),expected);else await assert.rejects(()=>transport.accessClaim(id));assert.equal(calls.length,1);assert.deepEqual(JSON.parse(calls[0].options.body),{bootId:'boot',roomId:'kitchen',requestId:id});}finally{transport.close();}
 }
});
test('changed owner after request rejects a late successful response',async()=>{
 let resolve;
 const {transport,calls}=client({});
 transport.fetch=async()=>new Promise(done=>{resolve=()=>done({ok:true,json:async()=>({ok:true,status:'connected'})});});
 const pending=transport.accessClaim(id);transport.snapshot={...snapshot(),bootId:'other'};resolve();
 try{await assert.rejects(()=>pending,/access_changed/);assert.equal(calls.length,0);}finally{transport.close();}
});

function setup({load=()=>null,save=()=>{},forget=()=>{}}={}){
 let now=0,serial=0;const jobs=new Map(),views=[],navigations=[],calls=[];
 const transport={connected:true,controllerRenewed:false,snapshot:snapshot(),close(){this.closed=true;},async start(){calls.push('start');},async accessRequest(name){calls.push(['request',name]);return {requestId:id,matchSignal:'ABC234',expiresIn:300};},async accessClaim(requestId){calls.push(['claim',requestId]);return {status:'pending',expiresIn:298};}};
 const flow=new SetupFlow({transport,render:value=>views.push(value),navigate:url=>navigations.push(url),now:()=>now,schedule:(fn,ms)=>{const key=++serial;jobs.set(key,{fn,ms});return key;},cancel:key=>jobs.delete(key),load,save,forget});
 flow.connection('connected');
 return {flow,transport,jobs,views,navigations,calls,advance:ms=>{now+=ms;},async tick(){const [key,job]=jobs.entries().next().value;jobs.delete(key);now+=job.ms;await job.fn();}};
}
test('single request becomes bounded pending; repeated submit never creates another',async()=>{
 const r=setup();await r.flow.submit(' iPad ');await r.flow.submit('Other');
 assert.deepEqual(r.calls,[['request','iPad']]);assert.equal(r.flow.phase,'pending');
 assert.equal(r.views.at(-1).disabled,true);assert.match(r.views.at(-1).status,/ABC234/);assert.equal(r.jobs.size,1);
 await r.tick();assert.deepEqual(r.calls.at(-1),['claim',id]);assert.equal(r.jobs.size,1);r.flow.close();assert.equal(r.jobs.size,0);
});
test('actual renewed authority is required before automatic navigation',async()=>{
 const r=setup();r.transport.accessClaim=async()=>({status:'connected'});r.transport.start=async()=>{r.transport.controllerRenewed=true;r.flow.connection('connected');};
 await r.flow.submit('Mac');await r.tick();
 assert.deepEqual(r.navigations,['./?room=kitchen']);assert.equal(r.transport.closed,true);assert.equal(r.jobs.size,0);
 const denied=setup();denied.transport.accessClaim=async()=>({status:'connected'});
 await denied.flow.submit('Mac');await denied.tick();assert.deepEqual(denied.navigations,[]);assert.equal(denied.flow.phase,'unknown');assert.equal(denied.views.at(-1).disabled,true);
});
test('already remembered browser opens without asking or polling',()=>{
 const r=setup();r.transport.controllerRenewed=true;r.flow.connection('connected');
 assert.deepEqual(r.navigations,['./?room=kitchen']);assert.equal(r.calls.length,0);assert.equal(r.jobs.size,0);
});
test('timeout never creates new access request and later response cannot extend it',async()=>{
 const r=setup();await r.flow.submit('iPad');r.advance(299000);await r.tick();
 assert.equal(r.flow.phase,'error');assert.equal(r.jobs.size,0);assert.equal(r.calls.filter(x=>Array.isArray(x)&&x[0]==='request').length,1);assert.match(r.views.at(-1).status,/udløb/);
});
test('unknown network result stops; no silent request or claim replay',async()=>{
 const r=setup();r.transport.accessClaim=async()=>{throw Error('offline');};await r.flow.submit('Mac');await r.tick();
 assert.equal(r.flow.phase,'unknown');assert.equal(r.jobs.size,0);assert.equal(r.views.at(-1).disabled,true);await r.flow.submit('Mac');assert.equal(r.calls.filter(x=>Array.isArray(x)&&x[0]==='request').length,1);
});
test('pagehide and disconnect invalidate late results without navigation',async()=>{
 for(const stop of ['close','disconnect']){
  const r=setup();let resolve;r.transport.accessClaim=()=>new Promise(done=>{resolve=done;});await r.flow.submit('Mac');
  const ticking=r.tick();if(stop==='close')r.flow.close();else r.flow.connection('disconnected');resolve({status:'connected'});await ticking;
  assert.deepEqual(r.navigations,[]);assert.equal(r.jobs.size,0);
 }
});
test('disconnect and repeated reconnect cannot silently turn an unknown pending into a new request',async()=>{
 const r=setup();await r.flow.submit('Mac');r.flow.connection('disconnected');r.flow.connection('disconnected');r.flow.connection('connected');await r.flow.submit('iPad');
 assert.equal(r.flow.phase,'unknown');assert.equal(r.views.at(-1).disabled,true);assert.deepEqual(r.calls,[['request','Mac']]);assert.equal(r.jobs.size,0);
});
test('return from HA resumes only the public original request and deadline',async()=>{
 let saved;const first=setup({save:value=>{saved=structuredClone(value);}});await first.flow.submit('iPad');first.flow.close();
 assert.deepEqual(Object.keys(saved).sort(),['bootId','deadline','matchSignal','name','requestId','roomId']);
 const returned=setup({load:()=>saved});assert.equal(returned.flow.phase,'pending');assert.equal(returned.flow.request.deadline,saved.deadline);await returned.tick();assert.deepEqual(returned.calls,[['claim',id]]);returned.flow.close();
});
test('stale or forged saved context cannot claim or create new authority',()=>{
 const good={bootId:'boot',roomId:'kitchen',deadline:300000,name:'Mac',requestId:id,matchSignal:'ABC234'};
 for(const mutate of [x=>x.bootId='other',x=>x.roomId='other',x=>x.deadline=300001,x=>x.deadline=0,x=>x.secret='bad',x=>x.matchSignal='<html>',x=>x.name='bad\nname']){
  const value={...good};mutate(value);let forgotten=0;const r=setup({load:()=>value,forget:()=>forgotten++});assert.equal(r.flow.phase,'ready');assert.equal(r.jobs.size,0);assert.equal(r.calls.length,0);assert.equal(forgotten,1);r.flow.close();
 }
});
test('unknown or interrupted consuming claim is never replayed after reload',async()=>{
 for(const interrupt of ['network','pagehide']){
  let saved=null,claims=0;const storage={load:()=>saved,save:value=>{saved=structuredClone(value);},forget:()=>{saved=null;}};
  const first=setup(storage);let resolve;
  first.transport.accessClaim=async()=>{claims++;if(interrupt==='network')throw Error('offline');return new Promise(done=>{resolve=done;});};
  await first.flow.submit('Mac');const ticking=first.tick();
  if(interrupt==='pagehide'){first.flow.close();resolve({status:'pending',expiresIn:298});}
  await ticking;assert.equal(saved,null);
  const reloaded=setup(storage);assert.equal(reloaded.flow.phase,'ready');assert.equal(reloaded.jobs.size,0);assert.equal(claims,1);reloaded.flow.close();first.flow.close();
 }
});
test('known pending receipt restores only its shorter original waiting deadline',async()=>{
 let saved;const storage={load:()=>saved,save:value=>{saved=structuredClone(value);},forget:()=>{saved=null;}};
 const first=setup(storage);await first.flow.submit('Mac');first.transport.accessClaim=async()=>({status:'pending',expiresIn:100});await first.tick();assert.equal(saved.deadline,102000);first.flow.close();
 const reloaded=setup(storage);assert.equal(reloaded.flow.phase,'pending');assert.equal(reloaded.flow.request.deadline,102000);assert.equal(reloaded.jobs.size,1);reloaded.flow.close();
});
