import test from 'node:test';
import assert from 'node:assert/strict';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';

const snapshot=()=>({schema:'podview.snapshot.v1',bootId:'boot',roomId:'room',revision:2,voice:{active:false},timers:{status:'observed',items:[]},capabilities:{musicRead:['mood'],homeRead:['weather'],timerActions:['timer.start'],controlSetup:['music','light'],musicSelection:true},controllerContinuity:{enabled:true,available:true}});
const make=()=>{const transport=new PodVoiceTransport({url:'https://inert.invalid/view/',locks:null,BroadcastChannel:null,crypto:null});transport.closed=false;return transport;};

test('accepted read stamp is observable only after complete validation and before accepted callbacks',()=>{
 const t=make(),seen=[];try{assert.equal(t.acceptedReadAt,null);t.onConnection=state=>{if(state==='connected')seen.push(t.acceptedReadAt);};t.onSnapshot=()=>seen.push(t.acceptedReadAt);const at=Date.now()-10;assert.equal(t.accept(snapshot(),at),true);assert.equal(t.acceptedReadAt,at);assert.deepEqual(seen,[at,at]);}finally{t.close();}
});

test('rejected snapshots cannot advance the last fully accepted read stamp',()=>{
 const t=make();try{const at=Date.now()-100;assert.equal(t.accept(snapshot(),at),true);for(const mutate of [s=>s.schema='invalid',s=>s.capabilities.homeRead=['invented'],s=>s.admission={kind:'ha_ingress',authenticated:false},s=>s.roomId='other',s=>s.revision=1,s=>s.timers.status='invalid']){const value=snapshot();mutate(value);assert.equal(t.accept(value,Date.now()),false);assert.equal(t.acceptedReadAt,at);}assert.equal(t.accept(snapshot(),Date.now()-6000),false);assert.equal(t.acceptedReadAt,at);}finally{t.close();}
});

test('accepted stamp keeps the original read time and remaining six-second watchdog rather than extending it',()=>{
 const beforeSet=globalThis.setTimeout,beforeClear=globalThis.clearTimeout,beforeNow=Date.now,jobs=new Map();let serial=0,now=100000;Date.now=()=>now;globalThis.setTimeout=(fn,ms)=>{jobs.set(++serial,{fn,ms});return serial;};globalThis.clearTimeout=id=>jobs.delete(id);const t=make();try{const value={...snapshot(),admission:{kind:'ha_ingress',authenticated:true}};assert.equal(t.accept(value,95000),true);assert.equal(t.acceptedReadAt,95000);assert.equal(jobs.get(t.freshnessTimer).ms,1000);now=101000;jobs.get(t.freshnessTimer).fn();assert.equal(t.connected,false);assert.equal(t.acceptedReadAt,95000,'disconnection does not pretend a newer accepted source');assert.equal(t.accept(value,95000),false);assert.equal(t.acceptedReadAt,95000);}finally{t.close();Date.now=beforeNow;globalThis.setTimeout=beforeSet;globalThis.clearTimeout=beforeClear;}
});

test('close clears the observation stamp and a late closed read cannot restore it',()=>{
 const t=make();const at=Date.now();assert.equal(t.accept(snapshot(),at),true);t.close();assert.equal(t.acceptedReadAt,null);assert.equal(t.accept(snapshot(),at),false);assert.equal(t.acceptedReadAt,null);assert.equal(t.connected,false);
});

test('the stamp cannot grant standalone authority and preserves HA server capabilities',()=>{
 const legacy=make(),named=make();try{assert.equal(legacy.accept(snapshot()),true);assert.equal(Number.isFinite(legacy.acceptedReadAt),true);assert.deepEqual(legacy.snapshot.capabilities.timerActions,[]);assert.deepEqual(legacy.snapshot.capabilities.controlSetup,[]);assert.equal(legacy.snapshot.capabilities.musicSelection,false);assert.notEqual(legacy.controllerRenewed,true);named.namedLaneWanted=true;named.namedRenewalUnconfirmed=true;assert.equal(named.accept({...snapshot(),admission:{kind:'ha_ingress',authenticated:true}}),true);assert.equal(Number.isFinite(named.acceptedReadAt),true);assert.deepEqual(named.snapshot.capabilities.controlSetup,['music','light']);assert.deepEqual(named.snapshot.capabilities.timerActions,['timer.start']);assert.equal(named.namedControllerRenewed,false);}finally{legacy.close();named.close();}
});
