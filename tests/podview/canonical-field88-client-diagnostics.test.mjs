import test from 'node:test';
import assert from 'node:assert/strict';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
const make=(options={})=>new PodVoiceTransport({url:'https://ha.example/secret-ingress/view/',diagnosticStorage:null,...options});
const storage=()=>{let value=null,writes=0;return {getItem:()=>value,setItem:(key,text)=>{assert.equal(key,'podview.client-diagnostics.v1');value=text;writes++;},get value(){return value;},get writes(){return writes;}};};
const microtask=()=>new Promise(resolve=>queueMicrotask(resolve));
test('closed bounded diagnostics preserve faults through read noise and never export private fields',async()=>{
 const store=storage(),t=make({diagnosticStorage:store});
 t.recordDiagnostic('control_action',{code:'unknown',requestId:'01234567-89ab-4cde-8fab-0123456789ab',taskId:'secret-ticket',args:{volume:100},message:'SECRET',url:'https://secret.invalid',stack:'SECRET',count:5000});
 for(let i=0;i<400;i++)t.recordDiagnostic('request',{code:'ok',endpoint:'snapshot'});
 const view=t.diagnostics();assert.equal(view.records.length,128);assert.ok(view.dropped>0);assert.ok(view.records.some(row=>row.code==='unknown'));assert.doesNotMatch(JSON.stringify(view),/secret|SECRET|volume|stack|5000/);assert.equal(view.records[0].requestId,'01234567-89ab-4cde-8fab-0123456789ab');
 view.records[0].code='forged';view.records.push({payload:'SECRET'});assert.notEqual(t.diagnostics().records[0].code,'forged');await microtask();assert.equal(store.writes,1);assert.ok(store.value.length<65536);
 const reopened=make({diagnosticStorage:store});assert.ok(reopened.diagnostics().records.some(row=>row.code==='unknown'&&row.restored===true));assert.equal(reopened.connected,false);assert.equal(reopened.snapshot,null);assert.equal(reopened.diagnostics().restoredUntrusted,true);
});
test('same-turn fault storm is bounded and coalesces persistence without retries or new timers',async()=>{
 const store=storage(),t=make({diagnosticStorage:store});for(let i=0;i<500;i++)t.recordDiagnostic('browser',{code:'error'});assert.equal(t.diagnostics().records.length,128);assert.equal(store.writes,0);await microtask();assert.equal(store.writes,1);assert.equal(t.diagnostics().dropped,372);for(let i=0;i<5;i++)t.recordDiagnostic('browser',{code:'error'});await microtask();assert.equal(store.writes,1);assert.equal(t.diagnostics().pendingPersistence,true);
});
test('blocked, corrupt, oversized and quota storage do not affect transport or leak restored arbitrary fields',async()=>{
 for(const getItem of [()=>{throw Error('BLOCKED');},()=>'{bad',()=> ' '.repeat(65537)]){const t=make({diagnosticStorage:{getItem,setItem(){throw Error('QUOTA');}}});assert.equal(t.connected,false);assert.equal(t.diagnostics().records.length,0);t.recordDiagnostic('browser',{code:'error'});await microtask();assert.equal(t.diagnostics().records.length,1);}
 const t=make({diagnosticStorage:{getItem:()=>JSON.stringify({schema:'podview.client-diagnostics.v1',records:[{stage:'browser',code:'error',seq:1,atMs:1,body:{token:'SECRET'},message:'SECRET',requestId:'not-a-uuid'},{stage:'forged',code:'error',seq:2,atMs:1}]}),setItem(){throw Error('QUOTA');}}});assert.equal(t.diagnostics().records.length,1);assert.doesNotMatch(JSON.stringify(t.diagnostics()),/SECRET|token|forged|not-a-uuid/);t.recordDiagnostic('browser',{code:'error'});await microtask();assert.equal(t.diagnostics().storageAvailable,false);assert.equal(t.diagnostics().records.length,2);
});
test('default sessionStorage getter cannot break constructor when browser denies access',()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');try{Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){throw Error('DENIED');}});const t=new PodVoiceTransport({url:'https://ha.example/view/'});assert.equal(t.diagnostics().storageAvailable,false);assert.equal(t.closed,true);}finally{if(prior)Object.defineProperty(globalThis,'sessionStorage',prior);else delete globalThis.sessionStorage;}
});
test('request diagnostics distinguish HTTP, invalid JSON, network and timeout and send only once',async()=>{
 for(const [status,expected]of [[403,'http_denied'],[429,'http_transient'],[503,'http_transient'],[409,'http_error'],[200,'ok']]){let sent=0;const t=make({fetch:async()=>{sent++;return {ok:status===200,status,json:async()=>({ok:status===200})};}});t.closed=false;await t.request(t.endpoint('music',{kind:'playback',account:'PRIVATE'}));const row=t.diagnostics().records.at(-1);assert.equal(row.code,expected);assert.equal(row.httpStatus,status);assert.equal(row.endpoint,'music');assert.equal(row.kind,'playback');assert.equal(sent,1);assert.doesNotMatch(JSON.stringify(t.diagnostics()),/PRIVATE|secret-ingress|ha\.example/);}
 const bad=make({fetch:async()=>({ok:true,status:200,json:async()=>{throw new SyntaxError('PRIVATE BODY');}})});bad.closed=false;await assert.rejects(bad.request(bad.endpoint('home')),SyntaxError);assert.equal(bad.diagnostics().records.at(-1).code,'invalid_json');assert.doesNotMatch(JSON.stringify(bad.diagnostics()),/PRIVATE/);
 const networkError=new TypeError('PRIVATE URL'),network=make({fetch:async()=>{throw networkError;}});network.closed=false;await assert.rejects(network.request(network.endpoint('home')),error=>error===networkError);assert.equal(network.diagnostics().records.at(-1).code,'network');
 let calls=0;const timed=make({fetch:async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});timed.closed=false;await assert.rejects(timed.request(timed.endpoint('home'),{},1));assert.equal(calls,1);assert.equal(timed.diagnostics().records.at(-1).code,'timeout');
});
test('superseded reads, caller cancellation and observer errors stay distinct without changing delivery',async()=>{
 let done;const t=make({fetch:()=>new Promise(resolve=>done=()=>resolve({ok:true,status:200,json:async()=>({ok:true})}))});t.closed=false;const read=t.request(t.endpoint('home'));t.generation++;done();await assert.rejects(read,{name:'AbortError'});assert.equal(t.diagnostics().records.at(-1).code,'superseded');
 const cancel=new AbortController(),other=make({fetch:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});other.closed=false;const pending=other.request(other.endpoint('home'),{},10000,cancel.signal);cancel.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(other.diagnostics().records.at(-1).code,'cancelled');
 const prior=globalThis.reportError;try{globalThis.reportError=()=>{};t.onConnection=()=>{throw Error('PRIVATE');};t.notify('onConnection','connected');assert.equal(t.diagnostics().records.at(-1).stage,'observer');assert.doesNotMatch(JSON.stringify(t.diagnostics()),/PRIVATE/);}finally{globalThis.reportError=prior;}
});
test('command request correlation comes from its explicit local UUID, never request payload or response metadata',async()=>{
 const id='01234567-89ab-4cde-8fab-0123456789ab',fake='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const t=make({fetch:async()=>({ok:true,status:200,json:async()=>({ok:true,requestId:fake,outcome:'accepted'})})});t.closed=false;
 await t.request(new URL('control/actions',t.base),{method:'POST',body:JSON.stringify({requestId:fake,taskId:'PRIVATE'})},undefined,undefined,id);assert.equal(t.diagnostics().records.at(-1).requestId,id);assert.doesNotMatch(JSON.stringify(t.diagnostics()),/PRIVATE|aaaaaaaa/);
 const start=t.diagnostics().records.length;await t.request(new URL('control/setup',t.base),{method:'POST',body:JSON.stringify({requestId:fake})});assert.equal(t.diagnostics().records.slice(start).some(row=>row.requestId),false);
});

test('existing close flushes the final dirty fault inside the write throttle and restored sequence cannot overflow',async()=>{
 const store=storage(),t=make({diagnosticStorage:store});t.recordDiagnostic('browser',{code:'error'});await microtask();t.recordDiagnostic('volume_setup',{code:'invalid_dto'});assert.equal(store.writes,1);t.close();assert.equal(store.writes,2);assert.equal(t.diagnostics().pendingPersistence,false);const reopened=make({diagnosticStorage:store});assert.ok(reopened.diagnostics().records.some(row=>row.stage==='volume_setup'&&row.code==='invalid_dto'&&row.restored));
 const huge=make({diagnosticStorage:{getItem:()=>JSON.stringify({schema:'podview.client-diagnostics.v1',records:[{stage:'browser',code:'error',seq:Number.MAX_SAFE_INTEGER,atMs:1}]}),setItem(){}}});huge.recordDiagnostic('browser',{code:'error'});assert.deepEqual(huge.diagnostics().records.map(row=>row.seq),[1,2]);
});
