import test from 'node:test';import assert from 'node:assert/strict';import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
const snap=()=>({schema:'podview.snapshot.v1',bootId:'test',revision:1,roomId:'kitchen',voice:{phase:'IDLE'},timers:{status:'observed',items:[]},capabilities:{musicRead:[],timerActions:[]}});
class Stream{addEventListener(){}close(){}}
test('nested malformed snapshots cannot mark the display connected',()=>{const t=new PodVoiceTransport({url:'https://ha.example/view/'});t.closed=false;for(const mutate of [s=>s.timers.items=null,s=>s.timers.status='invented',s=>s.capabilities.musicRead=null,s=>s.capabilities.timerActions=null]){const s=snap();mutate(s);assert.equal(t.accept(s),false);assert.equal(t.connected,false);}assert.equal(t.accept(snap()),true);t.close();});
test('default browser fetch retains its required global receiver',async()=>{const previous=globalThis.fetch;globalThis.fetch=async function(){assert.equal(this,globalThis);return {ok:true,json:async()=>snap()};};try{const t=new PodVoiceTransport({url:'https://ha.example/view/',EventSource:Stream});await t.start();assert.equal(t.connected,true);t.close();}finally{globalThis.fetch=previous;}});
test('scoped action requires exact successful terminal receipt and sends only once',async()=>{
 for(const malformed of ['http','physical','retry','identity','ok','outcome','none']){
  let calls=0;const t=new PodVoiceTransport({url:'https://ha.example/view/',fetch:async(url,init)=>{calls++;const request=JSON.parse(init.body);const body={ok:true,requestId:request.requestId,outcome:'accepted',physicalResultVerified:false,retryAllowed:false};if(malformed==='physical')body.physicalResultVerified=true;if(malformed==='retry')body.retryAllowed=true;if(malformed==='identity')body.requestId='other';if(malformed==='ok')body.ok=false;if(malformed==='outcome')body.outcome='executed';return {ok:malformed!=='http',json:async()=>body};}});t.connected=true;t.snapshot={...snap(),capabilities:{controlSetup:['vacuum']}};
  const result=await t.controlAction({bootId:'test',roomId:'kitchen',taskId:'task',revision:1,domain:'vacuum'},'opaque',{});assert.equal(calls,1);assert.equal(result.outcome,malformed==='none'?'accepted':'unknown');assert.equal(result.retryAllowed,false);assert.equal(result.physicalResultVerified,false);t.close();
 }
});

test('music reads distinguish transient HTTP failures from access and invalid-response failures without retries',async()=>{
 for(const status of [401,403,404,409,408,429,500,503,599,200])for(const malformed of [false,true]){
  let calls=0;const t=new PodVoiceTransport({url:'https://ha.example/view/',fetch:async()=>{calls++;return {ok:status===200,status,json:async()=>{if(malformed)throw new SyntaxError('invalid JSON');return {ok:false,error:'music_unavailable'};}};}});
  t.closed=false;t.connected=true;t.controller=new AbortController();t.snapshot={...snap(),capabilities:{musicRead:['playback']}};
  try{await assert.rejects(()=>t.music('playback','account'),error=>{
   const code=[401,403].includes(status)?'read_access_denied':[408,429].includes(status)||status>=500?'read_transient':undefined;
   assert.equal(error.code,code,`${status} malformed=${malformed}`);return true;
  });assert.equal(calls,1);}finally{t.close();}
 }
});

test('home reads distinguish actual access denial from transient failures without retries',async()=>{
 for(const status of [401,403,404,409,408,429,500,503,599,200])for(const malformed of [false,true]){
  let calls=0;const t=new PodVoiceTransport({url:'https://ha.example/view/',fetch:async()=>{calls++;return {ok:status===200,status,json:async()=>{if(malformed)throw new SyntaxError('invalid JSON');return {schema:'podview.home.v1'};}};}});
  t.closed=false;t.connected=true;t.controller=new AbortController();t.snapshot={...snap(),capabilities:{homeRead:['weather','vacuum']}};
  try{if(status===200&&!malformed)assert.deepEqual(await t.home(),{schema:'podview.home.v1'});else await assert.rejects(()=>t.home(),error=>{
   const code=[401,403].includes(status)?'read_access_denied':[408,429].includes(status)||status>=500?'read_transient':undefined;
   assert.equal(error.code,code,`${status} malformed=${malformed}`);return true;
  });assert.equal(calls,1);}finally{t.close();}
 }
});
