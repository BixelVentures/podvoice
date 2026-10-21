import test from 'node:test';
import assert from 'node:assert/strict';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
import {SetupFlow} from '../../podvoice/gatekeeper/static/podview/setup.js';
const snapshot=()=>({schema:'podview.snapshot.v1',bootId:'boot',roomId:'room',revision:1,voice:{active:false,sessionId:null,turnId:null},timers:{status:'unavailable',items:[]},capabilities:{musicRead:['top'],timerActions:['timer.start'],musicActions:['play'],musicSelection:true,queueSelection:true,controlSetup:['music']},controllerContinuity:{enabled:true,available:true}});
class Events{addEventListener(){}close(){}}
function fixture({status=403,snapshotStatus=200,setup=true,nonJSON=false}={}){
 const calls=[],renders=[];let flow;const state={status,snapshotStatus};
 const transport=new PodVoiceTransport({url:`https://example.test/view/${setup?'setup.html':''}`,locks:null,crypto:null,BroadcastChannel:null,EventSource:Events,onConnection:value=>flow?.connection(value),fetch:async(url)=>{const path=new URL(url).pathname;calls.push(path);const renew=path.endsWith('/controller/renew');const code=renew?state.status:state.snapshotStatus;return {ok:code===200,status:code,json:async()=>{if(renew&&nonJSON)throw Error('non-JSON denied response');return renew?(code===200?{ok:true,expiresIn:300}:{error:'controller_renewal_denied'}):snapshot();}};}});
 flow=new SetupFlow({transport,render:v=>renders.push(v),navigate:()=>{},schedule:()=>null,cancel:()=>{}});
 return {transport,flow,calls,renders,state};
}
function readonly(t){assert.equal(t.connected,true);assert.equal(t.controllerRenewed,false);assert.equal(t.cookieReadAuthority,false);for(const key of ['timerActions','musicActions','controlSetup'])assert.deepEqual(t.snapshot.capabilities[key],[]);for(const key of ['musicSelection','queueSelection'])assert.equal(t.snapshot.capabilities[key],false);}
for(const status of [401,403])for(const setup of [true,false])test(`renewal ${status} preserves verified reads and explicit pairing; setup=${setup}`,async()=>{const f=fixture({status,setup});try{await f.flow.start();readonly(f.transport);assert.equal(f.flow.phase,'ready');assert.equal(f.renders.at(-1).disabled,false);assert.equal(f.transport.recoveryBlocked,false);assert.equal(f.calls.length,2);await assert.rejects(f.transport.action({action:'timer.start',args:{},requestId:'x'}),/unsupported_action/);assert.equal(f.calls.length,2);
 // Simulate automatic reconnect; expired pre-denial capabilities cannot return.
 await f.transport.restart(true);readonly(f.transport);assert.equal(f.calls.filter(p=>p.endsWith('/controller/renew')).length,1);f.transport.accept(snapshot());readonly(f.transport);
 }finally{f.flow.close();}});
for(const snapshotStatus of [401,403])test(`snapshot ${snapshotStatus} remains hard stop`,async()=>{const f=fixture({snapshotStatus});try{await f.flow.start();assert.equal(f.transport.connected,false);assert.equal(f.transport.snapshot,null);assert.equal(f.transport.recoveryBlocked,true);assert.equal(f.transport.recoveryTimer,null);assert.equal(f.renders.at(-1).disabled,true);assert.equal(f.calls.length,1);}finally{f.flow.close();}});
test('explicit post-approval start can establish newly validated authority',async()=>{const f=fixture({setup:false});f.transport.onConnection=()=>{};try{await f.transport.start();readonly(f.transport);f.state.status=200;await f.transport.start();assert.equal(f.transport.controllerRenewed,true);assert.equal(f.transport.snapshot.capabilities.musicSelection,true);assert.equal(f.calls.filter(p=>p.endsWith('/controller/renew')).length,2);}finally{f.transport.close();}});

test('denial after a coalesced renewal deadline clears its expired retry schedule',async()=>{
 const set=globalThis.setTimeout,clear=globalThis.clearTimeout,jobs=new Map();let id=0;
 globalThis.setTimeout=(fn,ms)=>{jobs.set(++id,{fn,ms});return id;};globalThis.clearTimeout=id=>jobs.delete(id);
 const f=fixture();f.transport.controllerRenewRetryAt=Date.now()-1;
 try{await f.flow.start();readonly(f.transport);assert.equal(f.transport.controllerRenewRetryAt,null);assert.equal(f.transport.controllerRenewAt,null);assert.equal([...jobs.values()].some(j=>j.ms===0),false);await f.transport.restart(true);readonly(f.transport);assert.equal([...jobs.values()].some(j=>j.ms===0),false);assert.equal(f.calls.filter(p=>p.endsWith('/controller/renew')).length,1);}
 finally{f.flow.close();globalThis.setTimeout=set;globalThis.clearTimeout=clear;}
});

for(const status of [401,403])test(`non-JSON renewal ${status} remains read-only without automatic renewal retry`,async()=>{const f=fixture({status,nonJSON:true});try{await f.flow.start();readonly(f.transport);assert.equal(f.renders.at(-1).disabled,false);await f.transport.restart(true);readonly(f.transport);assert.equal(f.calls.filter(p=>p.endsWith('/controller/renew')).length,1);}finally{f.flow.close();}});
