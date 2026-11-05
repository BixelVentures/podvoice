import test from 'node:test';
import assert from 'node:assert/strict';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
const snapshot=(room='kitchen',boot='a'.repeat(32))=>({schema:'podview.snapshot.v1',bootId:boot,revision:1,roomId:room,admission:{kind:'ha_ingress',authenticated:true},voice:{phase:'IDLE'},timers:{status:'observed',items:[]},capabilities:{musicRead:[],timerActions:[]}});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const ack=(body,changes={})=>({ok:true,status:200,json:async()=>({schema:'podview.client-diagnostics-ack.v1',ok:true,batchId:body.batchId,acceptedCount:body.records.length,duplicate:false,stored:true,...changes})});
async function rig(run,{diagnosticStorage=null,diagnosticBuild='actual-build-fixture'}={}){
 const prior={now:Date.now,set:setTimeout,clear:clearTimeout};let now=1700000000000,id=0;const timers=new Map(),requests=[];
 Date.now=()=>now;globalThis.setTimeout=(fn,delay=0)=>{timers.set(++id,{fn,at:now+delay});return id;};globalThis.clearTimeout=id=>timers.delete(id);
 let response=async body=>ack(body);
 const t=new PodVoiceTransport({url:'https://ha.example/private-ingress/view/',diagnosticStorage,diagnosticBuild,fetch:async(url,init)=>{assert.equal(new URL(url).pathname,'/private-ingress/view/api/client-diagnostics');const body=JSON.parse(init.body);requests.push({body,text:init.body,init});return response(body,init);}});
 const accept=(room='kitchen',boot='a'.repeat(32))=>{t.closed=false;assert.equal(t.accept(snapshot(room,boot)),true);};
 try{await run({t,requests,accept,respond:fn=>{response=fn;},jump:ms=>{now+=ms;},timers,settle:async()=>{for(let i=0;i<8;i++)await Promise.resolve();}});}finally{t.close();Date.now=prior.now;globalThis.setTimeout=prior.set;globalThis.clearTimeout=prior.clear;}
}

test('automatic upload projects closed16-row8KiB envelope and never instruments its own POST',()=>rig(async({t,requests,accept})=>{
 accept();for(let i=0;i<20;i++)t.recordDiagnostic('browser',{code:'error',current:false,message:'PRIVATE',url:'https://secret',args:{volume:100}});
 const before=t.diagnostics().records.length;await t.flushDiagnosticUpload();assert.equal(requests.length,1);
 const {body,text,init}=requests[0];assert.deepEqual(Object.keys(body).sort(),['batchId','bootId','clientId','records','roomId','schema','uiBuild']);assert.match(body.batchId,/^[a-f0-9-]{36}$/);assert.equal(body.uiBuild,'actual-build-fixture');assert.ok(body.records.length>0&&body.records.length<=16);assert.ok(Buffer.byteLength(text,'utf8')<=8192);assert.equal(init.credentials,'same-origin');
 assert.ok(body.records.every(row=>Number.isInteger(row.ageMs)&&row.ageMs>=0&&row.ageMs<=604800000&&!('atMs'in row)&&!('restored'in row)));assert.ok(body.records.some(row=>row.current===false));assert.doesNotMatch(text,/PRIVATE|secret|volume/);assert.equal(t.diagnostics().records.length,before);
}));

test('inflight durable ACK acknowledges only its immutable batch, not newly emitted rows',()=>rig(async({t,requests,accept,respond,settle})=>{
 accept();t.recordDiagnostic('browser',{code:'error'});const held=deferred();respond(()=>held.promise);const flush=t.flushDiagnosticUpload();await settle();assert.equal(requests.length,1);const first=requests[0].body;
 t.recordDiagnostic('volume_state',{code:'unknown_value'});await t.flushDiagnosticUpload();assert.equal(requests.length,1);
 held.resolve(ack(first));await flush;assert.ok(first.records.every(row=>t.diagnosticUploadAcked.has(row.seq)));const last=t.diagnostics().records.at(-1);assert.equal(t.diagnosticUploadAcked.has(last.seq),false);
}));

test('restored and pre-snapshot rows never acquire a later authenticated emission scope',()=>rig(async({t,requests,accept})=>{
 t.recordDiagnostic('queue_read',{code:'error'});accept();t.recordDiagnostic('volume_state',{code:'unknown_value'});await t.flushDiagnosticUpload();const rows=requests.flatMap(r=>r.body.records);assert.equal(rows.some(r=>r.stage==='queue_read'),false);assert.equal(rows.some(r=>r.stage==='artwork'),false);assert.ok(rows.some(r=>r.stage==='volume_state'));
},{diagnosticStorage:{getItem:()=>JSON.stringify({schema:'podview.client-diagnostics.v1',records:[{seq:1,atMs:1700000000000,stage:'artwork',code:'resource_error'}]}),setItem(){}}}));

test('invalid ACK retains exact telemetry batch and bounded retry never creates product traffic',()=>rig(async({t,requests,accept,respond,jump})=>{
 accept();t.recordDiagnostic('browser',{code:'error'});respond(body=>ack(body,{acceptedCount:0}));await t.flushDiagnosticUpload();const first=requests[0].text;assert.equal(t.diagnosticUploadAcked.size,0);
 jump(10000);respond(body=>ack(body,{duplicate:true}));await t.flushDiagnosticUpload();assert.equal(requests.length,2);assert.equal(requests[1].text,first,'retry preserves batchId and original ageMs');assert.ok(t.diagnosticUploadAcked.size>0);
}));

test('new batches obey10-second cadence and uploadfailure cannot generate a diagnostic recursion',()=>rig(async({t,requests,accept,respond,jump})=>{
 accept();t.recordDiagnostic('browser',{code:'error'});await t.flushDiagnosticUpload();t.recordDiagnostic('queue_read',{code:'error'});await t.flushDiagnosticUpload();assert.equal(requests.length,1);jump(10000);
 const before=t.diagnostics().records.length;respond(async()=>({ok:false,status:429,json:async()=>({schema:'podview.client-diagnostics-ack.v1',ok:false,error:'diagnostics_capacity'})}));await t.flushDiagnosticUpload();assert.equal(requests.length,2);await t.flushDiagnosticUpload();assert.equal(requests.length,2);assert.equal(t.diagnostics().records.length,before);
}));

test('close cancels an upload and old ACK cannot acknowledge rows after owner replacement',()=>rig(async({t,requests,accept,respond,settle})=>{
 accept();t.recordDiagnostic('browser',{code:'error'});const held=deferred();respond(()=>held.promise);const flush=t.flushDiagnosticUpload();await settle();const first=requests[0];t.close(false);assert.equal(first.init.signal.aborted,true);accept('kitchen','b'.repeat(32));t.recordDiagnostic('queue_read',{code:'error'});
 held.resolve(ack(first.body));await flush;assert.equal(first.body.records.some(row=>t.diagnosticUploadAcked.has(row.seq)),false);assert.equal(t.connected,true);
}));

test('403 stops uploads across same-generation heartbeat; accepted reconnect permits retry without command effects',()=>rig(async({t,requests,accept,respond,jump})=>{
 accept();t.recordDiagnostic('browser',{code:'error'});respond(async()=>({ok:false,status:403,json:async()=>({schema:'podview.client-diagnostics-ack.v1',ok:false,error:'diagnostics_denied'})}));await t.flushDiagnosticUpload();assert.equal(t.diagnosticUploadStopped,true);
 jump(10000);accept();await t.flushDiagnosticUpload();assert.equal(requests.length,1,'heartbeat cannot clear denial');
 t.close(false);accept();respond(body=>ack(body,{duplicate:true}));await t.flushDiagnosticUpload();assert.equal(requests.length,2);assert.equal(requests[1].text,requests[0].text);assert.equal(t.connected,true);
}));

test('new room scope excludes old emitted rows and future or older-than7days rows',()=>rig(async({t,requests,accept,jump})=>{
 accept();t.recordDiagnostic('queue_read',{code:'error'});t.close(false);t.room='bedroom';accept('bedroom','b'.repeat(32));
 t.recordDiagnostic('volume_state',{code:'unknown_value'});jump(-1);await t.flushDiagnosticUpload();assert.equal(requests.length,0,'future rows are excluded, not clamped');jump(604800002);await t.flushDiagnosticUpload();assert.equal(requests.length,0,'too-old rows are excluded');
 t.recordDiagnostic('artwork',{code:'decode_error'});await t.flushDiagnosticUpload();assert.equal(requests.length,1);assert.equal(requests[0].body.roomId,'bedroom');assert.ok(requests[0].body.records.every(row=>row.stage==='artwork'));
}));

test('transient upload retry window ends after60seconds without changing playback transport or generating logs',()=>rig(async({t,requests,accept,respond,jump})=>{
 accept();t.recordDiagnostic('browser',{code:'error'});const count=t.diagnostics().records.length;respond(async()=>{throw new TypeError('PRIVATE NETWORK');});
 await t.flushDiagnosticUpload();const body=requests[0].text;
 for(let i=0;i<6;i++){jump(10000);await t.flushDiagnosticUpload();}
 assert.equal(requests.length,7);assert.ok(requests.every(r=>r.text===body));jump(10000);await t.flushDiagnosticUpload();assert.equal(requests.length,7);assert.equal(t.diagnosticUploadStopped,true);assert.equal(t.connected,true);assert.equal(t.diagnostics().records.length,count);
}));

test('emitting scoped diagnostic schedules automatic upload without caller flush or startup blocking',()=>rig(async({t,requests,accept,timers,jump,settle})=>{
 accept();t.recordDiagnostic('browser',{code:'error'});assert.equal(requests.length,0);assert.ok(t.diagnosticUploadTimer);
 const timerId=t.diagnosticUploadTimer,job=timers.get(timerId);assert.ok(job);jump(1000);timers.delete(timerId);job.fn();await settle();assert.equal(requests.length,1);assert.equal(t.connected,true);
}));

test('held ACK JSON body is bounded by the original4second upload deadline',()=>rig(async({t,requests,accept,respond,timers,jump,settle})=>{
 accept();t.recordDiagnostic('browser',{code:'error'});const body=deferred();respond(async()=>({ok:true,status:200,json:()=>body.promise}));
 let completed=false;const flush=t.flushDiagnosticUpload().then(()=>{completed=true;});await settle();assert.equal(requests.length,1);assert.equal(completed,false);
 const deadline=[...timers.entries()].find(([,job])=>job.at===Date.now()+4000);assert.ok(deadline,'original upload deadline remains armed while ACK JSON is held');jump(4000);timers.delete(deadline[0]);deadline[1].fn();await settle();await flush;
 assert.equal(completed,true);assert.equal(t.diagnosticUploadAcked.size,0);assert.equal(t.connected,true);
 body.resolve(await ack(requests[0].body).json());await settle();assert.equal(t.diagnosticUploadAcked.size,0,'late body cannot mark timed-out upload durable');
}));

test('raw target identity is upload-only and values retain requested versus observed meaning',()=>rig(async({t,requests,accept})=>{
 accept();t.recordDiagnostic('control_observation',{domain:'vehicle',action:'temperature',code:'observed',source:'home_assistant',trust:'state_observation',requestedValue:20.5,observedValue:20,resourceId:'climate.private_car'});
 assert.doesNotMatch(JSON.stringify(t.diagnostics()),/private_car|resourceId/);await t.flushDiagnosticUpload();const row=requests[0].body.records.find(row=>row.stage==='control_observation');assert.equal(row.resourceId,'climate.private_car');assert.equal(row.requestedValue,20.5);assert.equal(row.observedValue,20);assert.ok(Buffer.byteLength(requests[0].text)<=8192);
}));

test('upload cadence starts after completion so variable ingress latency cannot violate server admission spacing',()=>rig(async({t,requests,accept,respond,jump})=>{
 accept();let admittedAt;
 respond(async body=>{if(admittedAt===undefined)jump(25);else assert.ok(Date.now()-admittedAt>=10000,'server admission spacing survives a faster second delivery');admittedAt=Date.now();return ack(body);});
 t.recordDiagnostic('control_action',{code:'accepted'});await t.flushDiagnosticUpload();assert.equal(requests.length,1);
 t.recordDiagnostic('control_action',{code:'accepted'});jump(9975);await t.flushDiagnosticUpload();assert.equal(requests.length,1,'ten seconds from request start is too early after a delayed first admission');
 jump(25);await t.flushDiagnosticUpload();assert.equal(requests.length,2);assert.equal(t.diagnosticUploadBatch,null);
}));

test('telemetry client identity stays stable across room scopes and never becomes an action grant',()=>rig(async({t,requests,accept,jump})=>{
 accept();t.recordDiagnostic('control_action',{code:'accepted'});await t.flushDiagnosticUpload();const first=requests[0].body;assert.match(first.clientId,/^[a-f0-9-]{36}$/);assert.equal(first.clientId,first.batchId);
 jump(1000);t.room='bedroom';accept('bedroom');t.recordDiagnostic('control_action',{code:'accepted'});await t.flushDiagnosticUpload();assert.equal(requests.length,1,'same client changing room retains its cooldown');jump(9000);await t.flushDiagnosticUpload();const second=requests[1].body;assert.equal(second.clientId,first.clientId);assert.notEqual(second.batchId,first.batchId);assert.equal(second.roomId,'bedroom');assert.deepEqual(t.snapshot.capabilities.timerActions,[]);assert.doesNotMatch(JSON.stringify(t.diagnostics()),/clientId/);
}));

test('authoritative background pressure drops only rejected background and uploads later action under a new batch ID',()=>rig(async({t,requests,accept,respond,jump,settle})=>{
 accept();t.recordDiagnostic('control_setup',{code:'start'});const held=deferred();respond(()=>held.promise);const first=t.flushDiagnosticUpload();await settle();const firstBatch=requests[0].body;t.recordDiagnostic('control_intent',{code:'start',domain:'music',action:'resume'});const action=t.diagnostics().records.find(row=>row.stage==='control_intent');held.resolve({status:429,json:async()=>({ok:false,error:'diagnostics_background_pressure',retryAllowed:false})});await first;assert.equal(t.diagnosticUploadAcked.size,0);assert.equal(t.diagnosticUploadBatch,null);assert.ok(t.diagnostics().dropped>0);assert.ok(t.diagnostics().records.some(row=>row.seq===action.seq));jump(10000);respond(body=>ack(body));await t.flushDiagnosticUpload();assert.notEqual(requests[1].body.batchId,firstBatch.batchId);assert.ok(requests[1].body.records.some(row=>row.seq===action.seq));assert.ok(t.diagnosticUploadAcked.has(action.seq));
}));
for(const row of [{stage:'control_intent'},{stage:'control_action'},{stage:'control_observation'},{stage:'queue_action'},{stage:'playback_confirmation'},...['actions','control/actions','radio/actions','music/queue/actions','music/selection/setup','music/selection/actions'].map(endpoint=>({stage:'request',endpoint}))])test(`pressure response never drops action ${row.stage}:${row.endpoint||''}`,()=>rig(async({t,requests,accept,respond})=>{accept();t.recordDiagnostic(row.stage,{code:'start',...(row.stage==='control_observation'?{domain:'music',source:'podconnect',trust:'owner_settlement'}:{}),...(row.endpoint?{endpoint:row.endpoint}:{})});respond(async()=>({status:429,json:async()=>({ok:false,error:'diagnostics_background_pressure',retryAllowed:false})}));await t.flushDiagnosticUpload();assert.ok(t.diagnosticUploadBatch);assert.equal(t.diagnosticUploadAcked.size,0);assert.ok(t.diagnostics().records.some(r=>r.stage===row.stage&&(!row.endpoint||r.endpoint===row.endpoint)));}));

test('late pressure response cannot discard rows after generation changes',()=>rig(async({t,accept,respond,settle})=>{accept();t.recordDiagnostic('browser',{code:'error'});const held=deferred();respond(()=>held.promise);const read=t.flushDiagnosticUpload();await settle();const batch=t.diagnosticUploadBatch,before=t.diagnostics().records.length;t.generation++;held.resolve({status:429,json:async()=>({ok:false,error:'diagnostics_background_pressure',retryAllowed:false})});await read;assert.equal(t.diagnosticUploadBatch,batch);assert.equal(t.diagnostics().records.length,before);assert.equal(t.diagnosticUploadAcked.size,0);}));
test('unknown 429 body retains original batch and all rows',()=>rig(async({t,accept,respond,jump,requests})=>{accept();t.recordDiagnostic('browser',{code:'error'});respond(async()=>({status:429,json:async()=>({ok:false,error:'diagnostics_background_pressure',retryAllowed:false,extra:true})}));await t.flushDiagnosticUpload();const body=requests[0].text,count=t.diagnostics().records.length;jump(10000);await t.flushDiagnosticUpload();assert.equal(requests[1].text,body);assert.equal(t.diagnostics().records.length,count);assert.equal(t.diagnosticUploadAcked.size,0);}));
test('background-pressure rejection cannot discard correlated explicit setup or acknowledge its batch',()=>rig(async({t,accept,respond,jump,requests})=>{accept();const ref='01234567-89ab-4cde-8fab-0123456789ab';t.recordDiagnostic('control_setup',{code:'ok',domain:'radio',action:'stop',diagnosticRef:ref});respond(async()=>({status:429,json:async()=>({ok:false,error:'diagnostics_background_pressure',retryAllowed:false})}));await t.flushDiagnosticUpload();const first=requests[0].text;assert.ok(t.diagnosticUploadBatch);assert.equal(t.diagnosticUploadAcked.size,0);assert.ok(t.diagnostics().records.some(row=>row.diagnosticRef===ref));jump(10000);respond(body=>ack(body));await t.flushDiagnosticUpload();assert.equal(requests[1].text,first);assert.ok(t.diagnosticUploadAcked.size>0);}));
