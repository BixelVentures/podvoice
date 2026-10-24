import test from 'node:test';
import assert from 'node:assert/strict';
import {createEnrollmentFixture,enrollmentRoom as room,enrollmentBoot as bootId} from '../../scripts/enrollment-fixture.mjs';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
import {SetupFlow} from '../../podvoice/gatekeeper/static/podview/setup.js';
const headers={'Content-Type':'application/json','X-PodView-Request':'1'};
async function rig(){
 const clock=Date.now(),fixture=createEnrollmentFixture({now:()=>clock});await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${fixture.server.address().port}`,jar=new Map();
 const request=async(url,init={})=>{const h=new Headers(init.headers);if(jar.size)h.set('Cookie',[...jar].map(([k,v])=>k+'='+v).join('; '));const response=await fetch(new URL(url,base),{...init,headers:h});for(const cookie of response.headers.getSetCookie()){const [name,value]=cookie.split(';')[0].split('=');jar.set(name,value);}return response;};
 const post=(route,body,extra={})=>request('/view/api/controller/'+route+'?room='+room,{method:'POST',headers,body:JSON.stringify(body),...extra});
 const approve=receipt=>request('/fixture/approve',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({bootId,roomId:room,requestId:receipt.requestId,matchSignal:receipt.matchSignal}),redirect:'manual'});
 return {fixture,base,jar,request,post,approve};
}
test('actual SetupFlow + native transport require explicit authored approval, validated renewal and a fresh HA snapshot before linked',async()=>{
 const r=await rig(),storage=new Map(),views=[],jobs=new Map();let sequence=0;
 class Stream{addEventListener(){}close(){}}
 const transport=new PodVoiceTransport({url:r.base+'/view/setup.html?room='+room,room,screenEnrollment:true,fetch:r.request,EventSource:Stream,locks:null,BroadcastChannel:null,namedIntentStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
 const flow=new SetupFlow({transport,render:view=>views.push(view),navigate:()=>{},schedule:fn=>{jobs.set(++sequence,fn);return sequence;},cancel:id=>jobs.delete(id)});transport.onConnection=value=>flow.connection(value);
 try{
  await transport.start();assert.equal(flow.phase,'ready');assert.deepEqual(r.fixture.journal.map(e=>e.event),['snapshot','renew_denied']);assert.equal(transport.namedControllerRenewed,false);
  await flow.submit('Fixtureskærm');assert.equal(flow.phase,'pending');assert.match(r.jar.get('podview_controller_request'),/^[A-Za-z0-9_-]{43}$/);assert.equal(r.jar.has('podview_controller'),false);
  await flow.poll(flow.sequence);assert.equal(flow.phase,'pending');assert.equal(r.fixture.journal.at(-1).event,'claim_pending');assert.equal(transport.namedControllerRenewed,false);
  const receipt=r.fixture.journal.find(e=>e.event==='request');assert.equal((await r.approve(receipt)).status,303);
  await flow.poll(flow.sequence);assert.equal(flow.phase,'linked');assert.equal(transport.namedControllerRenewed,true);assert.equal(views.at(-1).button,'Åbn PodView');assert.match(views.at(-1).status,/PodViews rum/);assert.match(r.jar.get('podview_controller'),/^[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/);
  const events=r.fixture.journal.map(e=>e.event),claim=events.indexOf('claim_connected'),renew=events.indexOf('renew_validated');assert.ok(claim>events.indexOf('authored_admin_approval'));assert.ok(renew>claim);assert.equal(events[renew+1],'snapshot','renewal is followed by a new snapshot read');assert.deepEqual(transport.snapshot.capabilities.controlSetup,[]);assert.deepEqual(transport.snapshot.capabilities.timerActions,[]);
 }finally{flow.close();transport.close();await r.fixture.close();}
});
test('request, claim and renew are closed native contracts with HttpOnly path-scoped fake cookies and no replay',async()=>{
 const r=await rig();try{
  const response=await r.post('request',{bootId,roomId:room,name:'Lokalt eksempel'}),receipt=await response.json();assert.equal(response.status,200);assert.deepEqual(Object.keys(receipt).sort(),['expiresIn','matchSignal','ok','requestId']);assert.match(response.headers.getSetCookie()[0],/; HttpOnly; SameSite=Strict; Path=\/view\/; Max-Age=300$/);
  const body={bootId,roomId:room,requestId:receipt.requestId},proof=r.jar.get('podview_controller_request');r.jar.clear();assert.equal((await r.post('claim',body)).status,403);r.jar.set('podview_controller_request','foreign');assert.equal((await r.post('claim',body)).status,403);r.jar.set('podview_controller_request',proof);
  assert.deepEqual(await(await r.post('claim',body)).json(),{ok:true,status:'pending',expiresIn:300});
  assert.equal((await r.post('renew',{roomId:room})).status,403);await r.approve(receipt);const connected=await r.post('claim',body);assert.deepEqual(await connected.json(),{ok:true,status:'connected'});assert.equal(connected.headers.getSetCookie().length,2);assert.ok(connected.headers.getSetCookie().every(c=>c.includes('HttpOnly')&&c.includes('Path=/view/')));
  assert.equal((await r.post('claim',body)).status,403);const renewed=await r.post('renew',{roomId:room});assert.deepEqual(await renewed.json(),{ok:true,expiresIn:300,controllerExpiresAt:null});
 }finally{await r.fixture.close();}
});
test('foreign scope, extra fields, paths, headers and every product effect are denied without creating an approval',async()=>{
 const r=await rig();try{
  for(const body of [{bootId:'other',roomId:room,name:'Test'},{bootId,roomId:'foreign',name:'Test'},{bootId,roomId:room,name:'Test',extra:true},{bootId,roomId:room,name:' Test'},{bootId,roomId:room,name:'x\n'}])assert.equal((await r.post('request',body)).status,409);
  assert.equal((await r.post('request',{bootId,roomId:room,name:'Test'},{headers:{'Content-Type':'application/json'}})).status,400);
  assert.equal((await r.request('/view/api/controller/request?room=foreign',{method:'POST',headers,body:JSON.stringify({bootId,roomId:room,name:'Test'})})).status,409);
  for(const route of ['actions','pair','control/actions','control/setup','music/selection/actions','controller/request/extra','controller/%72equest'])assert.equal((await r.request('/view/api/'+route+'?room='+room,{method:'POST',headers,body:'{}'})).status,403,route);
  assert.equal((await r.post('request',{bootId,roomId:room,name:'Test'},{headers:{...headers,Origin:'https://foreign.invalid'}})).status,403);
  assert.equal(r.fixture.journal.some(e=>e.event==='request'),false);assert.equal((await r.request('/view/api/snapshot?room=foreign')).status,409);
  const html=await r.request('/view/setup.html?room='+room);assert.equal(html.status,200);assert.match(await html.text(),/setup\.js/);const admin=await(await r.request('/fixture/admin')).text();assert.match(admin,/ingen Home Assistant/);assert.equal((await r.request('/view/%2e%2e/package.json')).status,404);
 }finally{await r.fixture.close();}
});

test('QA frame loads the unchanged canonical product at an exact native viewport without scripts or enrollment writes',async()=>{
 const r=await rig();try{
  const response=await r.request('/fixture-frame');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^text\/html/);const html=await response.text();
  assert.match(html,/<iframe[^>]*src="\/view\/\?room=enrollment"[^>]*width="1280" height="800"/);assert.match(html,/width:1280px;height:800px/);assert.equal(/<script/i.test(html),false);assert.deepEqual(r.fixture.journal,[]);
  const product=await r.request('/view/?room='+room);assert.equal(product.status,200);assert.match(await product.text(),/widget-host/);assert.deepEqual(r.fixture.journal,[]);
  assert.equal((await r.request('/fixture-frame',{method:'POST',body:'{}'})).status,403);
 }finally{await r.fixture.close();}
});
