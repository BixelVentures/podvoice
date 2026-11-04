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
 for(const [status,expected]of [[403,'http_denied'],[429,'http_transient'],[503,'http_transient'],[409,'http_error'],[200,'ok']]){let sent=0;const t=make({fetch:async()=>{sent++;return {ok:status===200,status,json:async()=>({ok:status===200})};}});t.closed=false;const logged=new Promise(resolve=>{const record=t.recordDiagnostic.bind(t);t.recordDiagnostic=(stage,fields)=>{record(stage,fields);if(stage==='request'&&fields.code!=='start')resolve();};});await t.request(t.endpoint('music',{kind:'playback',account:'PRIVATE'}));await logged;const row=t.diagnostics().records.at(-1);assert.equal(row.code,expected);assert.equal(row.httpStatus,status);assert.equal(row.endpoint,'music');assert.equal(row.kind,'playback');assert.equal(sent,1);assert.doesNotMatch(JSON.stringify(t.diagnostics()),/PRIVATE|secret-ingress|ha\.example/);}
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
test('robot renewal diagnostics keep bounded reason only, excluding private offer data',()=>{
 const t=make();for(const code of ['robot_rebind_same','robot_rebind_context','robot_rebind_denied','robot_rebind_absent','robot_rebind_invalid','robot_rebind_draft','robot_rebind_dialog','robot_rebind_restored','robot_authority_changed','robot_offer_invalid','robot_open_reset'])t.recordDiagnostic('robot_renewal',{code,taskId:'PRIVATE-TASK',optionId:'PRIVATE-OPTION',room:'PRIVATE-ROOM',message:'PRIVATE'});const rows=t.diagnostics().records;assert.equal(rows.length,11);assert.equal(rows.at(-1).code,'robot_open_reset');assert.doesNotMatch(JSON.stringify(rows),/PRIVATE/);
});

test('robot owner deadline reason survives browser diagnostic persistence without private identifiers',async()=>{
 const store=storage(),t=make({diagnosticStorage:store});t.recordDiagnostic('robot_renewal',{code:'robot_deny_source_deadline',taskId:'PRIVATE-TASK',optionId:'PRIVATE-OPTION'});await microtask();const reloaded=make({diagnosticStorage:store});assert.ok(reloaded.diagnostics().records.some(row=>row.code==='robot_deny_source_deadline'));assert.doesNotMatch(store.value,/PRIVATE/);
});

test('bounded domain action and observation provenance survive diagnostics without physical claims',()=>{
 const t=make(),requestId='01234567-89ab-4cde-8fab-0123456789ab';
 for(const [domain,action]of [['vacuum','stop'],['vacuum','return'],['light','turn_off'],['vehicle','temperature'],['timer','timer.cancel'],['radio','move']]){
  t.recordDiagnostic('control_intent',{code:'start',domain,action,requestId,payload:'PRIVATE'});
  t.recordDiagnostic('control_observation',{code:'observed',domain,action,requestId,source:'home_assistant',trust:'state_observation',entityId:'PRIVATE'});
 }
 const rows=t.diagnostics().records;assert.equal(rows.length,12);assert.ok(rows.every(row=>row.domain&&row.action&&row.requestId===requestId));assert.ok(rows.filter(row=>row.stage==='control_observation').every(row=>row.source==='home_assistant'&&row.trust==='state_observation'&&row.code!=='confirmed'));assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|payload|entityId/);
 const before=rows.length;
 for(const fields of [{domain:'music',action:'return',source:'podconnect',trust:'owner_settlement',code:'observed'},{domain:'vehicle',action:'temperature',source:'home_assistant',trust:'state_observation',code:'confirmed'},{domain:'vehicle',action:'temperature',source:'PRIVATE',trust:'state_observation',code:'observed'},{domain:'vehicle',action:'temperature',source:'home_assistant',trust:'owner_settlement',code:'observed'}])t.recordDiagnostic('control_observation',fields);
 assert.equal(t.diagnostics().records.length,before);
 t.recordDiagnostic('home_read',{domain:'home',code:'superseded',endpoint:'home',current:false});t.recordDiagnostic('home_read',{domain:'home',code:'recovered',source:'home_assistant',trust:'state_observation'});
 assert.deepEqual(t.diagnostics().records.slice(-2).map(row=>row.code),['superseded','recovered']);
});

test('task actions log their actual wire UUID and outcome without an alternate effect identifier',async()=>{
 let wire;const t=make({fetch:async(url,init)=>{wire=JSON.parse(init.body);return {ok:true,status:200,json:async()=>({ok:true,requestId:wire.requestId,outcome:'accepted',retryAllowed:false,physicalResultVerified:false})};}});t.closed=false;t.connected=true;t.snapshot={bootId:'boot',roomId:'room',capabilities:{controlSetup:['light']}};
 const result=await t.controlAction({bootId:'boot',roomId:'room',taskId:'inert-task',revision:1,domain:'light',options:[{id:'opaque',action:'turn_off'}]},'opaque',{});
 assert.equal(result.requestId,wire.requestId);assert.deepEqual(Object.keys(wire).sort(),['args','bootId','optionId','requestId','revision','roomId','taskId']);const rows=t.diagnostics().records.filter(row=>row.stage==='control_action');assert.deepEqual(rows.map(row=>row.code),['start','accepted']);assert.ok(rows.every(row=>row.requestId===wire.requestId&&row.domain==='light'&&row.action==='turn_off'));
});

test('radio diagnostic reference remains metadata and its action wire is unchanged',async()=>{
 let wire;const t=make({fetch:async(url,init)=>{wire=JSON.parse(init.body);return {ok:true,status:200,json:async()=>({ok:true,schema:'podview.radio-action.v1',status:'accepted',retryAllowed:false})};}});t.closed=false;t.connected=true;t.snapshot={bootId:'boot',roomId:'room'};const diagnosticRef='01234567-89ab-4cde-8fab-0123456789ab';
 t.recordDiagnostic('control_intent',{domain:'radio',action:'stop',diagnosticRef,code:'start'});await t.radioAction({bootId:'boot',roomId:'room',taskId:'inert-task',optionId:'opaque'});
 assert.deepEqual(wire,{bootId:'boot',roomId:'room',taskId:'inert-task',optionId:'opaque'});assert.equal(t.diagnostics().records[0].diagnosticRef,diagnosticRef);assert.equal(t.diagnostics().records[0].requestId,undefined);
});

test('values remain bounded primitives and target IDs never enter browser diagnostics or session history',async()=>{
 const store=storage(),t=make({diagnosticStorage:store});t.recordDiagnostic('control_observation',{domain:'vehicle',action:'temperature',code:'observed',source:'home_assistant',trust:'state_observation',requestedValue:20.5,observedValue:20,resourceId:'climate.private_car'});
 const row=t.diagnostics().records[0];assert.equal(row.requestedValue,20.5);assert.equal(row.observedValue,20);assert.equal(row.resourceId,undefined);assert.equal(row.resourceRef,undefined);await microtask();assert.doesNotMatch(store.value,/private_car|resourceId/);
 for(const value of [null,'20.5',{},[],NaN,Infinity,-Infinity,86400.1,-86400.1]){t.recordDiagnostic('control_action',{code:'accepted',requestedValue:value,observedValue:value});const saved=t.diagnostics().records.at(-1);assert.equal(saved.requestedValue,undefined);assert.equal(saved.observedValue,undefined);}
 t.recordDiagnostic('control_action',{code:'accepted',requestedValue:true,observedValue:false});assert.equal(t.diagnostics().records.at(-1).requestedValue,true);assert.equal(t.diagnostics().records.at(-1).observedValue,false);
});

test('telemetry identity crypto failure cannot break initialization or actual control dispatch',async()=>{
 let sends=0;const t=make({crypto:{randomUUID(){throw Error('inert telemetry crypto failure');}},fetch:async(url,init)=>{sends++;const body=JSON.parse(init.body);return {ok:true,status:200,json:async()=>({ok:true,requestId:body.requestId,outcome:'accepted',retryAllowed:false,physicalResultVerified:false})};}});t.closed=false;t.connected=true;t.snapshot={bootId:'a'.repeat(32),roomId:'room',capabilities:{controlSetup:['light']}};t.syncDiagnosticScope(t.snapshot);
 try{t.recordDiagnostic('control_intent',{domain:'light',action:'turn_off',code:'start'});assert.equal(await t.flushDiagnosticUpload(),false);const result=await t.controlAction({bootId:t.snapshot.bootId,roomId:'room',taskId:'inert-task',revision:1,domain:'light',options:[{id:'opaque',action:'turn_off'}]},'opaque',{});assert.equal(result.outcome,'accepted');assert.equal(sends,1);assert.equal(t.diagnosticClientId,undefined);}finally{t.close();}
});

test('home owner and request diagnostics share an existing token hash without changing fetch wire',async()=>{
 const calls=[],crypto={randomUUID:()=> '01234567-89ab-4cde-8fab-0123456789ab',subtle:{digest:async()=>new Uint8Array(32).fill(17).buffer}},t=make({crypto,fetch:async(url,init)=>{calls.push({url:String(url),init});return {ok:true,status:200,json:async()=>({ok:true})};}});t.closed=false;t.connected=true;t.snapshot={roomId:'room',capabilities:{homeRead:['light']}};
 await t.home({lightArea:'kitchen'});const token=t.createReadDiagnostic();t.recordReadDiagnostic('home_read',{domain:'home',code:'start'},token);await t.home({lightArea:'kitchen',readDiagnostic:token});t.recordReadDiagnostic('home_read',{domain:'home',code:'ok'},token);for(let n=0;n<8;n++)await Promise.resolve();
 assert.equal(calls.length,2);assert.equal(calls[0].url,calls[1].url);assert.deepEqual(new URL(calls[1].url).searchParams.get('lightArea'),'kitchen');for(const {init}of calls){assert.deepEqual(Object.keys(init).filter(key=>key!=='signal').sort(),['cache','credentials']);assert.equal(new Headers(init.headers).has('X-PodView-Read-Id'),false);assert.equal(init.body,undefined);}
 const rows=t.diagnostics().records.filter(row=>row.readHash);assert.equal(rows.length,4);assert.deepEqual(rows.map(row=>[row.stage,row.code]),[['home_read','start'],['request','start'],['request','ok'],['home_read','ok']]);assert.ok(rows.every(row=>row.readHash==='1111111111111111'));
});

test('forged home tokens and failed diagnostic sinks never change home request or result',async()=>{
 const calls=[],t=make({fetch:async(url,init)=>{calls.push({url:String(url),init});return {ok:true,status:200,json:async()=>({ok:true})};}});t.closed=false;t.connected=true;t.snapshot={roomId:'room',capabilities:{homeRead:['vacuum']}};
 assert.deepEqual(await t.home({readDiagnostic:{forged:true}}),{ok:true});assert.equal(t.diagnostics().records.some(row=>row.readHash),false);const token=t.createReadDiagnostic();t.recordDiagnostic=()=>{throw Error('inert sink failure');};assert.deepEqual(await t.home({readDiagnostic:token}),{ok:true});for(let n=0;n<8;n++)await Promise.resolve();assert.equal(calls.length,2);assert.equal(calls[0].url,calls[1].url);assert.ok(calls.every(({init})=>!new Headers(init.headers).has('X-PodView-Read-Id')&&init.body===undefined));
});
