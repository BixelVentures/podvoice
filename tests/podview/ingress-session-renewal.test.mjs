// After an HA Core restart the Supervisor ingress session answers 401 until HA's app panel renews it.
// PodView renews quietly and keeps recovering by itself (a wall screen never needs a tap), never a raw 401.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
import {connectionPresentation} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
import {replaceWhenAdmitted} from '../../podvoice/gatekeeper/static/podview/ingress-kiosk.js';

const snap=()=>({schema:'podview.snapshot.v1',bootId:'boot',revision:1,roomId:'room',voice:{active:false},
 timers:{status:'observed',items:[],epoch:1},capabilities:{musicRead:[],timerActions:[],musicSelection:false,
 queueSelection:false,controlSetup:[]},admission:{kind:'ha_ingress',authenticated:true}});
const unauthorized={ok:false,status:401,json:async()=>{throw SyntaxError('401: Unauthorized is not JSON');}};

async function rig(fn){
 const st=globalThis.setTimeout,ct=globalThis.clearTimeout,jobs=new Map();let id=0;
 globalThis.setTimeout=(job,ms)=>{jobs.set(++id,{job,ms});return id;};
 globalThis.clearTimeout=key=>jobs.delete(key);
 const flush=()=>new Promise(resolve=>st(resolve,0));
 const tick=async()=>{const entry=[...jobs].find(([,x])=>x.ms===1000);assert.ok(entry,'renewal poll is armed');
  jobs.delete(entry[0]);entry[1].job();await flush();};
 const state={cookie:'ingress_session=old',deny:0,reads:0,statuses:[]};
 class Stream{addEventListener(){}close(){}}
 const t=new PodVoiceTransport({url:'https://ha.invalid/api/hassio_ingress/token/view/',EventSource:Stream,
  cookies:()=>state.cookie,onConnection:status=>state.statuses.push(status),
  fetch:async url=>{if(new URL(url).pathname.endsWith('/snapshot')){state.reads++;
   if(state.deny>0){state.deny--;return unauthorized;}}
   return {ok:true,status:200,json:async()=>snap()};}});
 try{await fn({t,state,jobs,tick,flush});}finally{t.close();globalThis.setTimeout=st;globalThis.clearTimeout=ct;}
}

test('401 waits quietly for HA to renew the ingress session, then reconnects once',()=>rig(async h=>{
 h.state.deny=1;
 const started=h.t.start();await h.flush();
 assert.equal(h.state.reads,1);assert.deepEqual(h.state.statuses,['connecting']);
 await h.tick();assert.equal(h.state.reads,1,'no read until the session is renewed');
 h.state.cookie='other=1; ingress_session=new';
 await h.tick();await started;
 assert.equal(h.state.reads,2);assert.equal(h.t.connected,true);
 assert.equal(h.t.recoveryBlocked,false);assert.equal(h.t.sessionExpired,false);
 assert.deepEqual(h.state.statuses,['connecting','connected'],'no error state while renewing');
}));

// Fejl 14 (13 Nov): after a Core restart the iPad wall screen stayed "disconnected" until someone
// left and re-entered the panel. A 401 that outlives one renewal is still HA's ingress session:
// PodView shows the calm offline state and keeps recovering by itself, never needing a tap.
test('a 401 that survives one renewal keeps recovering by itself until HA admits PodView again',()=>rig(async h=>{
 h.state.deny=2;
 const started=h.t.start(),failed=assert.rejects(started,/ingress_session_expired/);await h.flush();
 for(let i=0;i<66;i++)await h.tick();
 await failed;
 assert.equal(h.state.reads,2,'one quiet retry inside the first attempt');
 assert.equal(h.t.recoveryBlocked,false,'an expired ingress session is never a terminal denial');
 assert.equal(h.t.sessionExpired,true);
 const shown=connectionPresentation({status:'disconnected',snapshot:snap(),blocked:h.t.recoveryBlocked,sessionExpired:h.t.sessionExpired});
 assert.equal(shown.state,'offline');assert.doesNotMatch(JSON.stringify(shown),/401|Unauthorized|Adgang/);
 const recovery=[...h.jobs].find(([,x])=>x.ms<=30000);assert.equal(h.jobs.size,1,'only the recovery timer is armed');
 assert.ok(recovery,'automatic recovery is armed');
 // HA's panel renews the session (60 s tick); the armed recovery reconnects without any tap.
 h.state.cookie='ingress_session=renewed';
 h.jobs.delete(recovery[0]);recovery[1].job();await h.flush();await h.flush();
 assert.equal(h.t.connected,true);assert.equal(h.t.sessionExpired,false);assert.equal(h.state.reads,3);
}));

test('PodVoice 403 stays a terminal access denial without waiting',()=>rig(async h=>{
 h.t.fetch=async()=>({ok:false,status:403,json:async()=>({ok:false,error:'denied'})});
 await assert.rejects(h.t.start(),/transport_access_denied/);
 assert.equal(h.jobs.size,0);assert.equal(h.t.sessionExpired,false);
 assert.equal(connectionPresentation({status:'disconnected',blocked:true}).state,'denied');
}));

test('closing during the renewal wait cancels it without a late read',()=>rig(async h=>{
 h.state.deny=1;
 const started=h.t.start();await h.flush();
 h.t.close();await started;
 assert.equal(h.jobs.size,0);assert.equal(h.state.reads,1);assert.equal(h.t.connected,false);
}));

function frame(cookie, statuses){
 const replaced=[],state={cookie,statuses:[...statuses],probes:0};
 const win={location:{replace:url=>replaced.push(url)},document:{get cookie(){return state.cookie;}},
  fetch:async()=>{state.probes++;return {status:state.statuses.shift()??200};}};
 return {win,replaced,state};
}

test('kiosk navigation never loads a document into HA\'s raw 401 page', async()=>{
 const url='https://ha.invalid/api/hassio_ingress/token/view/';
 const ok=frame('ingress_session=a',[200]);
 assert.equal(await replaceWhenAdmitted(ok.win,url,{delay:0}),true);assert.deepEqual(ok.replaced,[url]);

 const renewed=frame('ingress_session=a',[401,200]);
 const pending=replaceWhenAdmitted(renewed.win,url,{delay:0});
 renewed.state.cookie='ingress_session=b';
 assert.equal(await pending,true);assert.deepEqual(renewed.replaced,[url]);assert.equal(renewed.state.probes,2);

 const stuck=frame('ingress_session=a',[401,401]);
 assert.equal(await replaceWhenAdmitted(stuck.win,url,{delay:0,ticks:3}),false);
 assert.deepEqual(stuck.replaced,[],'stays on the working page');assert.equal(stuck.state.probes,2);
});
