// The connection model and the player's source focus as explicit state machines, with one
// regression test per bug they replace.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newConnection,connectionStep,connectionPhase,liveStatusOf,canAct}
 from '../../podview/connection-model.js';
import {PodVoiceTransport} from '../../podview/podvoice-transport.js';
import {connectionPresentation} from '../../podview/podvoice-view.js';
import {AnswerAutoReturn,CANCELLED_LIMIT} from '../../podview/ui/answer-auto-return.js';

const run=(...types)=>types.reduce((s,type)=>connectionStep(s,typeof type==='string'?{type}:type),newConnection());

test('connection model: every phase and what it allows',()=>{
 assert.equal(connectionPhase(newConnection()),'closed');
 assert.equal(connectionPhase(run('start')),'connecting');
 assert.equal(connectionPhase(run('start','connected')),'connected');
 assert.equal(canAct(run('start','connected')),true);
 const grace=run('start','connected','connecting');
 assert.equal(connectionPhase(grace),'reconnecting');
 assert.equal(liveStatusOf(grace),'reconnecting');
 assert.equal(canAct(grace),false);
 assert.equal(connectionPhase(connectionStep(grace,{type:'grace-expired'})),'connecting');
 assert.equal(connectionPhase(run('start','connected','lost')),'offline');
 assert.equal(liveStatusOf(run('start','connected','lost')),'disconnected');
 assert.equal(connectionPhase(run('start','denied','connecting','lost')),'blocked');
 assert.equal(connectionPhase(run('start','expired','lost')),'session-expired');
 assert.equal(connectionPhase(run('start','expired','connecting')),'connecting');
 assert.equal(connectionPhase(run('start','denied','start')),'connecting');
 const offline=run('start','connected',{type:'browser',offline:true});
 assert.equal(connectionPhase(offline),'offline');assert.equal(canAct(offline),false);
 assert.equal(connectionPhase(connectionStep(offline,{type:'browser',offline:false})),'connected');
});

function transportRig(statuses){
 let reads=0;const statusFor=()=>statuses[Math.min(reads,statuses.length)-1];
 class Stream{addEventListener(){}close(){}}
 const t=new PodVoiceTransport({url:'https://ha.invalid/view/',EventSource:Stream,fetch:async url=>{
  if(new URL(url).pathname.endsWith('/snapshot'))reads++;
  const status=statusFor();return {ok:status===200,status,json:async()=>({error:'denied'})};}});
 return {t,reads:()=>reads};
}

test('bug: a 403 block survives restart(); only an explicit retry lifts it',async()=>{
 const {t,reads}=transportRig([403,403]);
 try{
  await assert.rejects(()=>t.start(),/transport_access_denied/);
  assert.equal(t.recoveryBlocked,true);assert.equal(t.phase,'blocked');
  const before=reads();
  await assert.rejects(()=>t.restart(false,false),/transport_access_denied/);
  assert.equal(t.recoveryBlocked,true,'restart() must not forget the 403');
  assert.equal(reads(),before,'a blocked transport does not read again by itself');
  assert.equal(t.canAct,false);
  await assert.rejects(()=>t.retry(),/transport_access_denied/);
  assert.equal(reads(),before+1,'an explicit retry reads again');
 }finally{t.close();}
});

function widgetMethods(){
 const source=readFileSync(new URL('../../podview/widget-view.js',import.meta.url),'utf8');
 const start=source.indexOf(' deferConnecting(status){'),end=source.indexOf(' // The browser\'s network flag');
 return new Function(`return {${source.slice(start,end)}};`)();
}

test('bug: the grace period reports reconnecting, never connected while the transport is down',()=>{
 const timers=[],st=globalThis.setTimeout,ct=globalThis.clearTimeout;
 globalThis.setTimeout=(job,ms)=>{timers.push({job,ms});return timers.length;};globalThis.clearTimeout=()=>{};
 try{
  const transport={connection:run('start','connected','connecting'),connected:false,onConnection:()=>{},
   get phase(){return connectionPhase(this.connection);},get liveStatus(){return liveStatusOf(this.connection);},
   graceExpired(){this.connection=connectionStep(this.connection,{type:'grace-expired'});}};
  const host={...widgetMethods(),liveTransport:transport,liveSnapshot:{bootId:'b'},liveStatus:'connected',isConnected:true};
  assert.equal(host.deferConnecting('connecting'),true,'the last snapshot stays on screen');
  assert.notEqual(host.liveStatus,'connected');assert.equal(host.liveStatus,'reconnecting');
  assert.equal(connectionPresentation({status:host.liveStatus,snapshot:host.liveSnapshot}).state,'ready',
   'the grace period shows no connection notice');
  timers[0].job();assert.equal(transport.phase,'connecting');
  assert.equal(host.deferConnecting('connecting'),false,'after the grace period the reconnect is shown');
 }finally{globalThis.setTimeout=st;globalThis.clearTimeout=ct;}
});

test('bug: the browser network flag lives in the transport connection model',()=>{
 const {t}=transportRig([200]);
 try{
  t.dispatchConnection({type:'start'});t.dispatchConnection({type:'connected'});t.connected=true;
  assert.equal(t.canAct,true);
  t.setBrowserOffline(true);
  assert.equal(t.browserOffline,true);assert.equal(t.phase,'offline');assert.equal(t.liveStatus,'disconnected');
  assert.equal(t.canAct,false);
  t.setBrowserOffline(false);assert.equal(t.liveStatus,'connected');
 }finally{t.close();}
});


// The player's source focus moved to Vitest with the player's session (src/screens/player/source-focus.test.js).

test('bug: the auto-return cancelled set is pruned',()=>{
 const host={state:{},ownerDocument:{addEventListener(){},removeEventListener(){}}};
 const owner=new AnswerAutoReturn(host,{setTimeout:()=>1,clearTimeout:()=>{}});
 for(let i=0;i<CANCELLED_LIMIT*5;i++){owner.identity=`answer-${i}`;owner.cancel(true);}
 assert.equal(owner.cancelled.size,CANCELLED_LIMIT);
 assert.equal(owner.cancelled.has(`answer-${CANCELLED_LIMIT*5-1}`),true,'the newest cancellation is kept');
 assert.equal(owner.cancelled.has('answer-0'),false,'the oldest is forgotten');
});
