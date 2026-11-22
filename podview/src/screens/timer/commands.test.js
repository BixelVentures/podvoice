// The live timer command lifecycle (commands.ts). Ported from timer-access.test.js, which drove the shell's
// sendLiveTimer / reconcileLiveTimer / suspendLiveTimer through sliced widget-view.js source. Same scenarios and
// assertions: the rig keeps the old host's names (`host.sendLiveTimer`, `host.liveActionFeedback`, …) as views of
// the command store, so each test body is unchanged; the fake transport is the registered API.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {snapshotSchema} from '../../lib/api/schemas';
import {timerRequest as liveTimerRequest} from '../../lib/api/timer-actions';
import {createTimerCommands} from './commands';

function timerOwner({items=[{id:'exact',status:'finished',physicalStopped:false,physicalDrained:false}],result={ok:true,outcome:'accepted'},held=false}={}){
 let now=1000,counter=0,current=null;const resolvers=[];const scheduled=new Map(),calls=[],messages=[],journal=[];
 const snapshot=(overrides={})=>({bootId:'boot',roomId:'kitchen',revision:10,voice:{sessionId:'timer-session'},timers:{status:'observed',epoch:'epoch',items},capabilities:{homeRead:[],timerActions:['timer.start','timer.cancel']},...overrides});
 // The SSE stream's admitted snapshot, as the cache holds it.
 const read=value=>snapshotSchema.parse({schema:'podview.snapshot.v1',...value});
 // One transport per connection: the registered API (diagnostics are its journal).
 const transport=()=>({connected:true,generation:undefined,options:{},timerAction:request=>{calls.push(request);return held?new Promise(done=>{resolvers.push(done);}):Promise.resolve(result);},
  diagnostics:{generation:()=>api.generation,blocked:()=>false,record:(stage,row)=>journal.push({stage,...row})}});
 let api=transport();
 const commands=createTimerCommands({api:()=>api,snapshot:()=>current,connected:()=>host.liveStatus==='connected'&&api.connected,
  now:()=>now,setTimer:(fn,delay)=>{const id=++counter;scheduled.set(id,{fn,at:now+delay});return id;},clearTimer:id=>scheduled.delete(id),
  randomUUID:()=>`inert-request-${calls.length+1}`,toast:text=>messages.push(text)});
 const state=()=>commands.getState();
 const host={
  isConnected:true,liveStatus:'connected',
  get liveActionFeedback(){return state().feedback;},get liveActionPending(){return state().pending;},
  get liveTimerAction(){return state().action;},get liveTimerPhase(){return state().phase;},
  get liveTimerFences(){return state().fences;},get liveTimerAdjusts(){return state().queued;},
  get liveSnapshot(){return current;},set liveSnapshot(value){current=value;},
  get liveTransport(){return api;},
  sendLiveTimer:request=>commands.send(request),
  // The shell's cleanup and reconnect suspend the command; a new connection is a new transport.
  cleanup(){commands.suspend();},suspendLiveTimer(){commands.suspend();},
  connectPodVoice(){commands.suspend();api=transport();api.options.onConnection=status=>{if(status!=='connected')commands.suspend();};host.liveStatus='connecting';},
 };
 host.connectPodVoice();current=read(snapshot());host.liveStatus='connected';
 return {host,calls,messages,journal,snapshot,settle:(value,index=0)=>resolvers[index](value),observe:value=>{current=read(value);commands.reconcile(current);},advance:ms=>{now+=ms;for(const [id,timer]of [...scheduled])if(timer.at<=now){scheduled.delete(id);timer.fn();}},scheduled};
}
const cancelExact={action:'timer.cancel',args:{timer_id:'exact'}},startOne={action:'timer.start',args:{seconds:10,name:'Exact'}};
const unknownText='Udfald ukendt · handlingen gentages ikke';

test('accepted cancel has finite visible uncertainty without a second dispatch',async()=>{
 const t=timerOwner();await t.host.sendLiveTimer(cancelExact);assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');t.advance(11999);assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');t.advance(1);assert.equal(t.host.liveActionFeedback,unknownText);assert.equal(t.host.liveActionPending,false);
 await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,1);assert.equal(t.messages.length,1);
});
test('unrelated shared revision cannot resolve accepted timer cancellation',async()=>{
 const t=timerOwner();await t.host.sendLiveTimer(cancelExact);t.observe(t.snapshot({revision:11,voice:{phase:'RESPONDING'}}));assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,1);
});
test('equal shared revision exact scoped removal resolves observation without success claim',async()=>{
 const t=timerOwner();await t.host.sendLiveTimer(cancelExact);t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[]}}));assert.equal(t.host.liveActionFeedback,'');assert.equal(t.host.liveTimerAction,null);assert.equal(t.scheduled.size,0);assert.deepEqual(t.messages,['Timeranmodningen er modtaget']);assert.equal(t.calls.length,1);
});
test('drained or stopped audio is not timer removal or finished acknowledgement',async()=>{
 for(const proof of [{physicalStopped:true},{physicalDrained:true},{physicalStopped:true,physicalDrained:true}]){
  const t=timerOwner();await t.host.sendLiveTimer(cancelExact);t.observe(t.snapshot({revision:11,timers:{status:'observed',epoch:'epoch',items:[{id:'exact',status:'finished',...proof}]}}));assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');t.advance(12000);assert.equal(t.host.liveActionFeedback,unknownText);await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,1);
 }
});
test('new boot room or epoch retires old scope without claiming completion and permits fresh intent',async()=>{
 for(const result of [{ok:true,outcome:'accepted'},{ok:false,outcome:'unknown'}])for(const change of [{bootId:'foreign'},{roomId:'foreign'},{timers:{status:'observed',epoch:'foreign',items:[]}}]){
  const t=timerOwner({result});await t.host.sendLiveTimer(cancelExact);const count=t.messages.length;t.observe(t.snapshot({...change,timers:change.timers||{status:'observed',epoch:'epoch',items:[]}}));assert.equal(t.host.liveActionFeedback,'');assert.equal(t.host.liveTimerAction,null);assert.equal(t.messages.length,count);assert.equal(t.scheduled.size,0);await t.host.sendLiveTimer(startOne);assert.equal(t.calls.length,2);
 }
});
test('unavailable or disconnected data cannot retire or complete same-scope action',async()=>{
 for(const disconnected of [false,true]){const t=timerOwner();await t.host.sendLiveTimer(cancelExact);if(disconnected){t.host.liveStatus='disconnected';t.host.liveTransport.connected=false;}t.observe(t.snapshot({revision:11,timers:{status:disconnected?'observed':'unavailable',epoch:'epoch',items:[]}}));assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');assert.ok(t.host.liveTimerAction);}
});
test('snapshot arriving during held request is reconciled after receipt without replay',async()=>{
 const t=timerOwner({held:true}),pending=t.host.sendLiveTimer(cancelExact);t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[]}}));await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,1);assert.equal(t.host.liveActionPending,true);t.settle({ok:true,outcome:'accepted'});await pending;assert.equal(t.host.liveActionFeedback,'');assert.equal(t.host.liveActionPending,false);assert.equal(t.scheduled.size,0);
});
test('unknown cancel stays unknown on unrelated updates and only exact absence restores current controls',async()=>{
 const t=timerOwner({result:{ok:false,outcome:'unknown',retryAllowed:false}});await t.host.sendLiveTimer(cancelExact);assert.equal(t.host.liveActionFeedback,unknownText);t.observe(t.snapshot({revision:11}));assert.equal(t.host.liveActionFeedback,unknownText);await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,1);assert.equal(t.messages.length,0);t.observe(t.snapshot({revision:11,timers:{status:'observed',epoch:'epoch',items:[]}}));assert.equal(t.host.liveActionFeedback,'');assert.equal(t.host.liveTimerAction,null);assert.equal(t.calls.length,1);assert.equal(t.messages.length,0);
});
test('rejected request is not automatically repeated and fresh explicit request remains possible',async()=>{
 const t=timerOwner({result:{ok:false,error:'stale_action',retryAllowed:false}});await t.host.sendLiveTimer(cancelExact);assert.match(t.host.liveActionFeedback,/afvist/);assert.equal(t.calls.length,1);assert.equal(t.scheduled.size,0);await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,2);
});
test('accepted Start waits for real same-scope timer; unknown Start is not guessed by name',async()=>{
 const t=timerOwner({items:[],result:{ok:true,outcome:'accepted',timerId:'native-new'}});await t.host.sendLiveTimer(startOne);t.observe(t.snapshot({revision:11}));assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');t.observe(t.snapshot({revision:11,timers:{status:'observed',epoch:'epoch',items:[{id:'native-new',name:'Someone else',status:'running'}]}}));assert.equal(t.host.liveActionFeedback,'');assert.deepEqual(t.messages,['Timeranmodningen er modtaget']);assert.equal(t.calls.length,1);
 const u=timerOwner({items:[],result:{ok:false,outcome:'unknown'}});await u.host.sendLiveTimer(startOne);u.observe(u.snapshot({revision:11,timers:{status:'observed',epoch:'epoch',items:[{id:'unproven',name:'Exact',status:'running'}]}}));assert.equal(u.host.liveActionFeedback,unknownText);await u.host.sendLiveTimer(startOne);assert.equal(u.calls.length,1);
});
test('expired accepted wait remains visibly uncertain after its scheduled timer was cleaned up',async()=>{
 const t=timerOwner();await t.host.sendLiveTimer(cancelExact);t.scheduled.clear();t.advance(12000);t.observe(t.snapshot());assert.equal(t.host.liveActionFeedback,unknownText);assert.equal(t.calls.length,1);
});
test('held completion after actual cleanup cannot mutate feedback or schedule detached work',async()=>{
 const t=timerOwner({held:true}),pending=t.host.sendLiveTimer(cancelExact);t.host.isConnected=false;t.host.cleanup();assert.equal(t.host.liveActionFeedback,unknownText);assert.equal(t.host.liveActionPending,false);const retained=t.host.liveTimerAction;t.settle({ok:true,outcome:'accepted'});await pending;assert.equal(t.host.liveActionFeedback,unknownText);assert.equal(t.host.liveTimerAction,retained);assert.equal(t.messages.length,0);assert.equal(t.scheduled.size,0);assert.equal(t.calls.length,1);
});
test('same-scope reconnect preserves uncertainty and blocks original dispatch until exact absence',async()=>{
 const t=timerOwner({held:true}),pending=t.host.sendLiveTimer(cancelExact);t.host.cleanup();t.host.connectPodVoice();t.host.liveStatus='connected';t.observe(t.snapshot({revision:11}));assert.equal(t.host.liveActionFeedback,unknownText);assert.ok(t.host.liveTimerAction);await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,1);t.settle({ok:true,outcome:'accepted'});await pending;assert.equal(t.host.liveActionFeedback,unknownText);assert.equal(t.messages.length,0);assert.equal(t.scheduled.size,0);t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[]}}));assert.equal(t.host.liveActionFeedback,'');assert.equal(t.host.liveTimerAction,null);
});
test('old held completion cannot overwrite a newer operation after authoritative scope replacement',async()=>{
 const t=timerOwner({held:true}),old=t.host.sendLiveTimer(cancelExact);t.observe(t.snapshot({bootId:'new',timers:{status:'observed',epoch:'epoch',items:[]}}));assert.equal(t.host.liveTimerAction,null);const next=t.host.sendLiveTimer(startOne),operation=t.host.liveTimerAction;assert.equal(t.calls.length,2);assert.equal(t.host.liveActionPending,true);t.settle({ok:true,outcome:'accepted'},0);await old;assert.equal(t.host.liveTimerAction,operation);assert.equal(t.host.liveActionPending,true);assert.equal(t.host.liveActionFeedback,'');assert.equal(t.messages.length,0);t.settle({ok:false,outcome:'unknown'},1);await next;assert.equal(t.host.liveActionFeedback,unknownText);assert.equal(t.host.liveTimerAction,operation);
});
test('transient transport disconnect fences late receipt while preserving same-scope UNKNOWN',async()=>{
 const t=timerOwner({held:true}),pending=t.host.sendLiveTimer(cancelExact);t.host.liveTransport.connected=false;t.host.liveTransport.options.onConnection('disconnected');assert.equal(t.host.liveActionFeedback,unknownText);assert.equal(t.host.liveActionPending,false);t.settle({ok:true,outcome:'accepted'});await pending;assert.equal(t.messages.length,0);assert.equal(t.scheduled.size,0);t.host.liveTransport.connected=true;t.host.liveTransport.options.onConnection('connected');t.observe(t.snapshot({revision:11}));assert.equal(t.host.liveActionFeedback,unknownText);await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,1);
});
test('additional accepted Start requires a new scoped timer ID, not changed existing timers',async()=>{
 const t=timerOwner({items:[{id:'existing',status:'running'}],result:{ok:true,outcome:'accepted',timerId:'second'}});await t.host.sendLiveTimer(startOne);
 t.observe(t.snapshot({revision:11,timers:{status:'observed',epoch:'epoch',items:[{id:'existing',status:'finished'}]}}));assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');
 t.observe(t.snapshot({revision:11,timers:{status:'observed',epoch:'epoch',items:[{id:'existing',status:'finished'},{id:'second',status:'running'}]}}));assert.equal(t.host.liveTimerAction,null);assert.equal(t.host.liveActionFeedback,'');assert.equal(t.scheduled.size,0);
 await t.host.sendLiveTimer(startOne);assert.equal(t.calls.length,2);assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');
 assert.equal(t.calls.length,2);
});
test('additional timer snapshot before accepted receipt resolves without duplicate dispatch',async()=>{
 const t=timerOwner({items:[{id:'existing',status:'running'}],held:true}),pending=t.host.sendLiveTimer(startOne);
 t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[{id:'existing',status:'running'},{id:'second',status:'running'}]}}));assert.equal(t.host.liveActionPending,true);await t.host.sendLiveTimer(startOne);assert.equal(t.calls.length,1);
 t.settle({ok:true,outcome:'accepted',timerId:'second'});await pending;assert.equal(t.host.liveTimerAction,null);assert.equal(t.host.liveActionFeedback,'');assert.equal(t.scheduled.size,0);
});
test('new scoped timer before rejected or unknown receipt does not become successful Start',async()=>{
 for(const result of [{ok:false,error:'stale_action'},{ok:false,outcome:'unknown'}]){
  const t=timerOwner({items:[{id:'existing',status:'running'}],held:true}),pending=t.host.sendLiveTimer(startOne);
  t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[{id:'existing',status:'running'},{id:'other-owner',status:'running'}]}}));t.settle(result);await pending;
  assert.equal(t.messages.length,0);assert.equal(t.scheduled.size,0);assert.equal(t.calls.length,1);
  if(result.outcome==='unknown'){assert.equal(t.host.liveActionFeedback,unknownText);assert.ok(t.host.liveTimerAction);await t.host.sendLiveTimer(startOne);assert.equal(t.calls.length,1);}
  else {assert.match(t.host.liveActionFeedback,/afvist/);assert.equal(t.host.liveTimerAction,null);}
 }
});
test('old rejected receipt after scope replacement cannot overwrite newer timer action',async()=>{
 const t=timerOwner({held:true}),old=t.host.sendLiveTimer(startOne);t.observe(t.snapshot({roomId:'other'}));const next=t.host.sendLiveTimer(startOne),operation=t.host.liveTimerAction;
 t.settle({ok:false,error:'stale_action'},0);await old;assert.equal(t.host.liveTimerAction,operation);assert.equal(t.host.liveActionPending,true);assert.equal(t.host.liveActionFeedback,'');
 t.settle({ok:false,outcome:'unknown'},1);await next;assert.equal(t.host.liveActionFeedback,unknownText);
});
test('accepted Start requires exact receipt ID, including from an empty list',async()=>{
 for(const items of [[],[{id:'existing',status:'running'}]])for(const timerId of [undefined,'','x'.repeat(201),42,'receipt-id']){
  const t=timerOwner({items,result:{ok:true,outcome:'accepted',timerId}});await t.host.sendLiveTimer(startOne);
  t.observe(t.snapshot({revision:11,timers:{status:'observed',epoch:'epoch',items:[...items,{id:'unrelated',name:'Exact',status:'running'}]}}));assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');assert.ok(t.host.liveTimerAction);
  t.advance(12000);assert.equal(t.host.liveActionFeedback,unknownText);await t.host.sendLiveTimer(startOne);assert.equal(t.calls.length,1);
  t.observe(t.snapshot({revision:12,timers:{status:'observed',epoch:'epoch',items:[...items,{id:'receipt-id',status:'running'}]}}));assert.equal(t.host.liveActionFeedback,timerId==='receipt-id'?'':unknownText);
 }
});
test('UNKNOWN Start allows independent observed Cancel while retaining original Start fence',async()=>{
 const t=timerOwner({items:[],held:true});const start=t.host.sendLiveTimer(startOne);t.settle({ok:false,outcome:'unknown'});await start;
 t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[{id:'actual',status:'finished'}]}}));
 const cancel=t.host.sendLiveTimer({action:'timer.cancel',args:{timer_id:'actual'}});assert.equal(t.calls.length,2);t.settle({ok:true,outcome:'accepted'},1);await cancel;
 t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[]}}));assert.equal(t.host.liveTimerAction,null);await t.host.sendLiveTimer(startOne);assert.equal(t.calls.length,2);assert.equal(t.host.liveTimerFences.length,1);
});
test('UNKNOWN cancellation blocks same ID but permits distinct observed timer cancellation',async()=>{
 const t=timerOwner({items:[{id:'exact'},{id:'other'}],result:{ok:false,outcome:'unknown'}});await t.host.sendLiveTimer(cancelExact);await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,1);
 await t.host.sendLiveTimer({action:'timer.cancel',args:{timer_id:'other'}});assert.equal(t.calls.length,2);await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,2);
});
test('fresh scoped removal resolves parked UNKNOWN cancellation after independent cancellation without replay',async()=>{
 const t=timerOwner({items:[{id:'exact'},{id:'other'}],result:{ok:false,outcome:'unknown'}});await t.host.sendLiveTimer(cancelExact);await t.host.sendLiveTimer({action:'timer.cancel',args:{timer_id:'other'}});assert.equal(t.host.liveTimerFences.length,1);
 t.observe(t.snapshot({revision:11,timers:{status:'unavailable',epoch:null,items:[]}}));assert.equal(t.host.liveTimerFences.length,1,'unavailable is not removal');
 t.observe(t.snapshot({revision:12,timers:{status:'observed',epoch:'epoch',items:[{id:'exact'},{id:'other'}]}}));assert.equal(t.host.liveTimerFences.length,1,'unrelated newer status does not clear cancellation');
 t.observe(t.snapshot({revision:13,timers:{status:'observed',epoch:'epoch',items:[]}}));assert.equal(t.host.liveTimerAction,null);assert.equal(t.host.liveTimerFences.length,0,'exact disappearance resolves both independent cancellation fences');assert.equal(t.calls.length,2,'no effect is replayed');
 await t.host.sendLiveTimer(startOne);assert.equal(t.calls.length,3,'a new explicit Start is permitted after exact cancellation removal');
});
test('timer journal binds requested seconds, actual receipt and snapshot observation to original wire request',async()=>{
 const t=timerOwner({items:[],result:{ok:true,outcome:'accepted',timerId:'native-new'}});await t.host.sendLiveTimer(startOne);const requestId=t.calls[0].requestId;
 assert.deepEqual(t.journal.map(row=>[row.stage,row.code]),[['control_intent','start'],['control_action','start'],['control_action','accepted']]);
 assert(t.journal.every(row=>row.requestId===requestId&&row.domain==='timer'&&row.action==='timer.start'&&row.requestedValue===10));
 t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[{id:'native-new',status:'running',secondsLeft:9}]}}));
 const observed=t.journal.at(-1);assert.equal(observed.stage,'control_observation');assert.equal(observed.code,'observed');assert.equal(observed.requestId,requestId);assert.equal(observed.resourceId,'native-new');assert.equal(observed.observedValue,9);assert.equal(observed.source,'snapshot');assert.equal(observed.trust,'state_observation');assert(!JSON.stringify(t.journal).includes('Exact'));assert.equal(t.calls.length,1);
});
test('finished timer acknowledgement retains actual cancel action and sink failures cannot change cancellation',async()=>{
 const t=timerOwner();await t.host.sendLiveTimer(cancelExact);t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[]}}));const observed=t.journal.find(row=>row.stage==='control_observation');assert.equal(observed.action,'timer.cancel');assert.equal(observed.requestedValue,false);assert.equal(observed.observedValue,false);assert.equal(observed.code,'observed');assert.equal(observed.requestId,t.calls[0].requestId);
 const failed=timerOwner();failed.host.liveTransport.recordDiagnostic=()=>{throw Error('inert sink failure');};await failed.host.sendLiveTimer(cancelExact);failed.observe(failed.snapshot({timers:{status:'observed',epoch:'epoch',items:[]}}));assert.equal(failed.calls.length,1);assert.equal(failed.host.liveTimerAction,null);assert.equal(failed.host.liveActionFeedback,'');
});
test('late same-scope timer receipt survives reconnect only as an action fact, without inventing observation',async()=>{
 const t=timerOwner({held:true});t.host.liveTransport.generation=1;const pending=t.host.sendLiveTimer(cancelExact);t.host.liveTransport.generation=2;t.host.suspendLiveTimer();t.settle({ok:true,outcome:'accepted'});await pending;
 const outcome=t.journal.find(row=>row.stage==='control_action'&&row.code==='accepted');assert.equal(outcome.requestId,t.calls[0].requestId);assert.equal(outcome.current,false);assert.equal(t.journal.some(row=>row.stage==='control_observation'&&row.code==='observed'),false);assert.equal(t.calls.length,1);
 for(const boundary of ['boot','room','admission','grant']){const denied=timerOwner({held:true}),operation=denied.host.sendLiveTimer(cancelExact);if(boundary==='boot')denied.host.liveSnapshot={...denied.host.liveSnapshot,bootId:'other'};if(boundary==='room')denied.host.liveSnapshot={...denied.host.liveSnapshot,roomId:'other'};if(boundary==='admission')denied.host.liveSnapshot={...denied.host.liveSnapshot,admission:{kind:'ha_ingress',authenticated:true}};if(boundary==='grant')denied.host.liveSnapshot.capabilities.timerActions=[];denied.settle({ok:true,outcome:'accepted'});await operation;assert.equal(denied.journal.some(row=>row.stage==='control_action'&&row.code==='accepted'),false);assert.equal(denied.calls.length,1);}
});

const adjustRequest={action:'timer.adjust',args:{timer_id:'exact',delta_seconds:60,expected_revision:'9007199254740993'}};
const adjustRow={id:'exact',name:'Test',status:'running',secondsLeft:30,durationSeconds:100,sourceRevision:'9007199254740993'};
test('adjust waits for the correlated native revision and exact final tuple, with no replay',async()=>{
 const receipt={ok:true,outcome:'accepted',timerId:'exact',deltaSeconds:60,expectedSourceRevision:'9007199254740993',sourceRevision:'9007199254740994',durationSeconds:160,secondsLeft:90,status:'running'};
 const t=timerOwner({items:[adjustRow],result:receipt});t.host.liveSnapshot.capabilities.timerActions.push('timer.adjust');await t.host.sendLiveTimer(adjustRequest);assert.equal(t.calls.length,1);
 for(const row of [adjustRow,{...adjustRow,sourceRevision:receipt.sourceRevision,durationSeconds:159,secondsLeft:89},{...adjustRow,sourceRevision:receipt.sourceRevision,durationSeconds:160,secondsLeft:91}]){t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[row]}}));assert.ok(t.host.liveTimerAction);}
 t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[{...adjustRow,sourceRevision:receipt.sourceRevision,durationSeconds:160,secondsLeft:89}]}}));assert.equal(t.host.liveTimerAction,null);assert.equal(t.calls.length,1);
});
test('held adjustment permits only explicit exact cancel and late adjustment cannot replace it',async()=>{
 const t=timerOwner({items:[adjustRow],held:true});t.host.liveSnapshot.capabilities.timerActions.push('timer.adjust');const pending=t.host.sendLiveTimer(adjustRequest);const cancel=t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,2);const current=t.host.liveTimerAction;t.settle({ok:true,outcome:'accepted',timerId:'exact',sourceRevision:'9007199254740994'},0);await pending;assert.equal(t.host.liveTimerAction,current);t.settle({ok:false,outcome:'unknown'},1);await cancel;assert.equal(t.host.liveTimerAction,current);
});
test('unknown adjustment needs a newer native revision or actual removal; paused proof matches exactly',async()=>{
 const t=timerOwner({items:[adjustRow],result:{ok:false,outcome:'unknown'}});t.host.liveSnapshot.capabilities.timerActions.push('timer.adjust');await t.host.sendLiveTimer(adjustRequest);t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[adjustRow]}}));assert.ok(t.host.liveTimerAction);assert.equal(t.calls.length,1);t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[{...adjustRow,sourceRevision:'9007199254740994'}]}}));assert.equal(t.host.liveTimerAction,null,'newer native revision supersedes UNKNOWN without asserting success');assert.equal(t.calls.length,1);
 const receipt={ok:true,outcome:'accepted',timerId:'exact',deltaSeconds:60,expectedSourceRevision:'9007199254740993',sourceRevision:'9007199254740994',durationSeconds:160,secondsLeft:90,status:'paused'},p=timerOwner({items:[{...adjustRow,status:'paused'}],result:receipt});p.host.liveSnapshot.capabilities.timerActions.push('timer.adjust');await p.host.sendLiveTimer(adjustRequest);p.observe(p.snapshot({timers:{status:'observed',epoch:'epoch',items:[{...adjustRow,status:'paused',sourceRevision:receipt.sourceRevision,durationSeconds:160,secondsLeft:89}]}}));assert.ok(p.host.liveTimerAction);p.observe(p.snapshot({timers:{status:'observed',epoch:'epoch',items:[{...adjustRow,status:'paused',sourceRevision:receipt.sourceRevision,durationSeconds:160,secondsLeft:90}]}}));assert.equal(p.host.liveTimerAction,null);
});
test('accepted adjustment is superseded by a newer native revision without a read or effect claim',async()=>{
 const receipt={ok:true,outcome:'accepted',timerId:'exact',deltaSeconds:60,expectedSourceRevision:'9007199254740993',sourceRevision:'9007199254740994',durationSeconds:160,secondsLeft:90,status:'running'},t=timerOwner({items:[adjustRow],result:receipt});t.host.liveSnapshot.capabilities.timerActions.push('timer.adjust');await t.host.sendLiveTimer(adjustRequest);t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[{...adjustRow,sourceRevision:'9007199254740995'}]}}));assert.equal(t.host.liveTimerAction,null);assert.equal(t.calls.length,1);
});
test('timer adjustment journal keeps the signed requested delta with its actual outcome',async()=>{
 for(const outcome of ['accepted','unknown']){const t=timerOwner({items:[adjustRow],result:{ok:outcome==='accepted',outcome,timerId:'exact',deltaSeconds:-60,expectedSourceRevision:adjustRow.sourceRevision,sourceRevision:'9007199254740994',durationSeconds:40,secondsLeft:1,status:'running'}});t.host.liveSnapshot.capabilities.timerActions.push('timer.adjust');await t.host.sendLiveTimer({...adjustRequest,args:{...adjustRequest.args,delta_seconds:-60}});assert.equal(t.calls.length,1);assert.ok(t.journal.some(row=>row.stage==='control_action'&&row.code===outcome));assert.ok(t.journal.every(row=>row.requestedValue===-60&&row.action==='timer.adjust'));}
});
test('timer journal follows the original granted action across unrelated capability changes',async()=>{
 for(const change of ['added_adjust','removed_start','admission']){const t=timerOwner({items:[],result:{ok:true,outcome:'accepted',timerId:'native-new'}});await t.host.sendLiveTimer(startOne);const next=t.snapshot({timers:{status:'observed',epoch:'epoch',items:[{id:'native-new',status:'running',secondsLeft:9}]}});if(change==='added_adjust')next.capabilities.timerActions.push('timer.adjust');if(change==='removed_start')next.capabilities.timerActions=['timer.cancel','timer.adjust'];if(change==='admission')next.admission={kind:'ha_ingress',authenticated:true};t.observe(next);const observed=t.journal.filter(row=>row.stage==='control_observation'&&row.code==='observed');assert.equal(observed.length,change==='added_adjust'?1:0,change);if(observed.length)assert.equal(observed[0].requestId,t.calls[0].requestId);assert.equal(t.calls.length,1);}
});
// T1: +1/−1 tapped while an adjustment is in flight are queued in order and each sent once.
test('adjust taps during an in-flight adjustment are queued in order and each sent once against the fresh revision',async()=>{
 const t=timerOwner({items:[adjustRow],held:true});t.host.liveSnapshot.capabilities.timerActions.push('timer.adjust');
 const tap=(delta,row)=>liveTimerRequest(t.host.liveSnapshot,true,{type:'timer',action:'adjust',id:'exact',deltaSeconds:delta});
 const first=t.host.sendLiveTimer(tap(60));void t.host.sendLiveTimer(tap(60));void t.host.sendLiveTimer(tap(-60));
 assert.equal(t.calls.length,1,'only the first adjustment is sent while it is in flight');
 assert.equal(t.host.liveTimerPhase,'sending','the blocking state is a state field');
 t.settle({ok:true,outcome:'accepted',timerId:'exact',deltaSeconds:60,expectedSourceRevision:'9007199254740993',sourceRevision:'9007199254740994',durationSeconds:160,secondsLeft:90,status:'running'},0);await first;
 assert.equal(t.calls.length,1,'the next tap waits for the observed result');
 t.observe(t.snapshot({capabilities:{homeRead:[],timerActions:['timer.start','timer.cancel','timer.adjust']},timers:{status:'observed',epoch:'epoch',items:[{...adjustRow,sourceRevision:'9007199254740994',durationSeconds:160,secondsLeft:90}]}}));
 assert.equal(t.calls.length,2);assert.deepEqual(t.calls[1].args,{timer_id:'exact',delta_seconds:60,expected_revision:'9007199254740994'});
 t.settle({ok:true,outcome:'accepted',timerId:'exact',deltaSeconds:60,expectedSourceRevision:'9007199254740994',sourceRevision:'9007199254740995',durationSeconds:220,secondsLeft:150,status:'running'},1);
 await new Promise(resolve=>setImmediate(resolve));
 t.observe(t.snapshot({capabilities:{homeRead:[],timerActions:['timer.start','timer.cancel','timer.adjust']},timers:{status:'observed',epoch:'epoch',items:[{...adjustRow,sourceRevision:'9007199254740995',durationSeconds:220,secondsLeft:150}]}}));
 assert.equal(t.calls.length,3);assert.deepEqual(t.calls[2].args,{timer_id:'exact',delta_seconds:-60,expected_revision:'9007199254740995'});
});
test('adjust taps queued behind an UNKNOWN adjustment are not sent and the user is told',async()=>{
 const t=timerOwner({items:[adjustRow],held:true});t.host.liveSnapshot.capabilities.timerActions.push('timer.adjust');
 const tap=delta=>liveTimerRequest(t.host.liveSnapshot,true,{type:'timer',action:'adjust',id:'exact',deltaSeconds:delta});
 const first=t.host.sendLiveTimer(tap(60));void t.host.sendLiveTimer(tap(60));
 t.settle({ok:false,outcome:'unknown'},0);await first;
 t.observe(t.snapshot({capabilities:{homeRead:[],timerActions:['timer.start','timer.cancel','timer.adjust']},timers:{status:'observed',epoch:'epoch',items:[{...adjustRow,sourceRevision:'9007199254740994'}]}}));
 assert.equal(t.calls.length,1,'nothing is replayed after UNKNOWN');
 assert.ok(t.messages.some(text=>/ikke sendt/.test(text)),'the dropped tap is explained');
});
