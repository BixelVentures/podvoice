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

test('scoped light detail reads stay same-origin GETs and cannot widen capability',async()=>{
 const calls=[],t=new PodVoiceTransport({url:'https://ha.example/prefix/view/',room:'kitchen',fetch:async(url,init)=>{calls.push({url:new URL(url),init});return {ok:true,status:200,json:async()=>({schema:'podview.home.v1'})};}});
 t.closed=false;t.connected=true;t.controller=new AbortController();t.snapshot={...snap(),capabilities:{homeRead:['light']}};
 try{await t.home({lightArea:'room_a'});assert.equal(calls.length,1);assert.equal(calls[0].url.origin,'https://ha.example');assert.equal(calls[0].url.pathname,'/prefix/view/api/home');assert.equal(calls[0].url.searchParams.get('lightArea'),'room_a');assert.equal(calls[0].url.searchParams.get('room'),'kitchen');assert.equal(calls[0].init.method,undefined);assert.equal(calls[0].init.body,undefined);
  for(const lightArea of ['',null,'a'.repeat(129),'room\nother'])await assert.rejects(()=>t.home({lightArea}));
  t.snapshot.capabilities.homeRead=['weather'];await assert.rejects(()=>t.home({lightArea:'room_a'}));assert.equal(calls.length,1);
 }finally{t.close();}
});
test('scoped light read cannot publish after transport owner replacement',async()=>{
 let resolve;const t=new PodVoiceTransport({url:'https://ha.example/view/',fetch:()=>new Promise(r=>resolve=r)});t.closed=false;t.connected=true;t.controller=new AbortController();t.snapshot={...snap(),capabilities:{homeRead:['light']}};
 try{const read=t.home({lightArea:'room_a'});t.generation++;resolve({ok:true,status:200,json:async()=>({lights:{scope:{areaId:'room_a'}}})});await assert.rejects(read,{name:'AbortError'});}finally{t.close();}
});
test('weather advice uses one exact same-origin source-bound POST with no client forecast or retries',async()=>{
 const calls=[],binding={bootId:'test',roomId:'kitchen',weatherKey:'a'.repeat(64),availability:'available'},dto={schema:'podview.passive-weather-advice.v1'};
 const t=new PodVoiceTransport({url:'https://ha.example/prefix/view/',fetch:async(url,init)=>{calls.push({url:new URL(url),init});return {ok:true,status:200,json:async()=>dto};}});t.closed=false;t.connected=true;t.snapshot={...snap(),capabilities:{homeRead:['weather']}};t.controller=new AbortController();
 try{assert.deepEqual(await t.weatherAdvice(binding),dto);assert.equal(calls.length,1);assert.equal(calls[0].url.origin,'https://ha.example');assert.equal(calls[0].url.pathname,'/prefix/view/api/weather-advice');assert.equal(calls[0].url.search,'?room=kitchen');assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.headers['X-PodView-Request'],'1');assert.deepEqual(JSON.parse(calls[0].init.body),{bootId:'test',roomId:'kitchen',weatherKey:'a'.repeat(64)});
 for(const change of [{roomId:'other'},{bootId:'new'},{weatherKey:'invalid'},{availability:'unavailable'}])await assert.rejects(t.weatherAdvice({...binding,...change}));assert.equal(calls.length,1);
 }finally{t.close();}
});
test('weather admission failures and owner replacement never retry or admit a late result',async()=>{
 const binding={bootId:'test',roomId:'kitchen',weatherKey:'a'.repeat(64),availability:'available'};
 for(const status of [401,403,409,503]){let calls=0;const t=new PodVoiceTransport({url:'https://ha.example/view/',fetch:async()=>{calls++;return {ok:false,status,json:async()=>({error:'weather_advice_unavailable'})};}});t.closed=false;t.connected=true;t.snapshot={...snap(),capabilities:{homeRead:['weather']}};try{await assert.rejects(t.weatherAdvice(binding),error=>{assert.equal(error.code,status===409?'stale_weather_binding':[401,403].includes(status)?'read_access_denied':undefined);return true;});assert.equal(calls,1);}finally{t.close();}}
 let resolve;const t=new PodVoiceTransport({url:'https://ha.example/view/',fetch:()=>new Promise(r=>resolve=r)});t.closed=false;t.connected=true;t.snapshot={...snap(),capabilities:{homeRead:['weather']}};const pending=t.weatherAdvice(binding);t.snapshot={...t.snapshot,bootId:'new'};resolve({ok:true,status:200,json:async()=>({})});await assert.rejects(pending,{name:'AbortError'});t.close();
});
