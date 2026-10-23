import test from 'node:test';
import assert from 'node:assert/strict';
import {PodVoiceTransport} from '../../podvoice/gatekeeper/static/podview/podvoice-transport.js';
const snap = (revision=1) => ({schema:'podview.snapshot.v1',bootId:'b1',roomId:'kitchen',revision,voice:{phase:'LISTENING'},timers:{status:'observed',epoch:'e1',items:[]},capabilities:{musicRead:['liked'],timerActions:[]}});
class Stream {constructor(url){this.url=url;this.events={};Stream.last=this;}addEventListener(name,callback){this.events[name]=callback;}close(){this.closed=true;}send(value){this.events.snapshot({data:JSON.stringify(value)});}}
test('requires ingress, preserves prefix, handles snapshots and disconnect without replay',async()=>{
 assert.throws(()=>new PodVoiceTransport({url:'https://example.com/'}));
 const seen=[];const calls=[];
 const transport=new PodVoiceTransport({url:'https://ha.example/api/hassio_ingress/token/view/',EventSource:Stream,onSnapshot:v=>seen.push(v.revision),fetch:async(url,options)=>{calls.push([url.toString(),options]);return {ok:true,json:async()=>snap()};}});
 assert.throws(()=>transport.endpoint('https://attacker.example/'));
 await transport.start();assert.equal(calls[0][0],'https://ha.example/api/hassio_ingress/token/view/api/snapshot');
 Stream.last.send(snap(3));Stream.last.send(snap(2));assert.deepEqual(seen,[1,3]);
 assert.equal(transport.connected,false);Stream.last.send(snap(3));assert.equal(transport.connected,true);
 Stream.last.onerror();assert.equal(transport.connected,false);
 await assert.rejects(transport.action({action:'timer.start',args:{seconds:5},requestId:'r1',grant:'g1'}));
 assert.equal(calls.length,1);transport.close();Stream.last.send(snap(4));assert.deepEqual(seen,[1,3,3]);
});
test('timer controls remain disabled by server and unknown send never retries',async()=>{
 let count=0;const transport=new PodVoiceTransport({url:'https://ha.example/view/',EventSource:Stream,fetch:async()=>{count++;if(count>1)throw Error('network');return{ok:true,json:async()=>snap()};}});
 await transport.start();await assert.rejects(transport.action({action:'timer.start',grant:'g'}));assert.equal(count,1);
 transport.snapshot.capabilities.timerActions=['timer.start'];const result=await transport.action({action:'timer.start',grant:'g',requestId:'r1',args:{seconds:5}});
 assert.equal(result.outcome,'unknown');assert.equal(result.retryAllowed,false);assert.equal(count,2);transport.close();
});

test('rejects malformed nested state before granting connected status',()=>{
 const transport=new PodVoiceTransport({url:'https://ha.example/view/'});transport.closed=false;
 for (const changed of [{timers:{status:'invented',items:[]}},{timers:{status:'observed',items:{}}},{capabilities:{musicRead:true,timerActions:[]}}]) assert.equal(transport.accept({...snap(),...changed}),false);
 assert.equal(transport.connected,false);
});

test('pairing retains authority only in HttpOnly cookie and reopens snapshot stream',async()=>{
 const calls=[];let paired=false;
 const transport=new PodVoiceTransport({url:'https://ha.example/api/hassio_ingress/t/view/',EventSource:Stream,fetch:async(url,opts)=>{
  calls.push([url.toString(),opts]);
  if(url.pathname.endsWith('/pair')) {paired=true;return {ok:true,json:async()=>({ok:true,paired:true,expiresIn:300})};}
  if(url.pathname.endsWith('/actions')) return {ok:true,json:async()=>({ok:true,outcome:'accepted'})};
  const value=snap();if(paired)value.capabilities.timerActions=['timer.start','timer.cancel'];
  return {ok:true,json:async()=>value};
 }});
 await transport.start();const previous=Stream.last;
 await transport.pair('x'.repeat(43));assert.equal(previous.closed,true);
 assert.deepEqual(transport.snapshot.capabilities.timerActions,['timer.start','timer.cancel']);
 await transport.action({action:'timer.start',args:{seconds:300,name:'Pasta'},requestId:'r1'});
 const request=calls.at(-1)[1];assert.equal(request.credentials,'same-origin');assert.equal(request.headers['X-PodView-Grant'],undefined);
 transport.close();
 assert.equal(JSON.stringify(transport).includes('x'.repeat(43)),false);
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
 const calls=[],binding={bootId:snap().bootId,roomId:'kitchen',weatherKey:'a'.repeat(64),availability:'available'},dto={schema:'podview.passive-weather-advice.v1'};
 const t=new PodVoiceTransport({url:'https://ha.example/prefix/view/',fetch:async(url,init)=>{calls.push({url:new URL(url),init});return {ok:true,status:200,json:async()=>dto};}});t.closed=false;t.connected=true;t.snapshot={...snap(),capabilities:{homeRead:['weather']}};t.controller=new AbortController();
 try{assert.deepEqual(await t.weatherAdvice(binding),dto);assert.equal(calls.length,1);assert.equal(calls[0].url.origin,'https://ha.example');assert.equal(calls[0].url.pathname,'/prefix/view/api/weather-advice');assert.equal(calls[0].url.search,'?room=kitchen');assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.headers['X-PodView-Request'],'1');assert.deepEqual(JSON.parse(calls[0].init.body),{bootId:snap().bootId,roomId:'kitchen',weatherKey:'a'.repeat(64)});
 for(const change of [{roomId:'other'},{bootId:'new'},{weatherKey:'invalid'},{availability:'unavailable'}])await assert.rejects(t.weatherAdvice({...binding,...change}));assert.equal(calls.length,1);
 }finally{t.close();}
});
test('weather admission failures and owner replacement never retry or admit a late result',async()=>{
 const binding={bootId:snap().bootId,roomId:'kitchen',weatherKey:'a'.repeat(64),availability:'available'};
 for(const status of [401,403,409,503]){let calls=0;const t=new PodVoiceTransport({url:'https://ha.example/view/',fetch:async()=>{calls++;return {ok:false,status,json:async()=>({error:'weather_advice_unavailable'})};}});t.closed=false;t.connected=true;t.snapshot={...snap(),capabilities:{homeRead:['weather']}};try{await assert.rejects(t.weatherAdvice(binding),error=>{assert.equal(error.code,status===409?'stale_weather_binding':[401,403].includes(status)?'read_access_denied':undefined);return true;});assert.equal(calls,1);}finally{t.close();}}
 let resolve;const t=new PodVoiceTransport({url:'https://ha.example/view/',fetch:()=>new Promise(r=>resolve=r)});t.closed=false;t.connected=true;t.snapshot={...snap(),capabilities:{homeRead:['weather']}};const pending=t.weatherAdvice(binding);t.snapshot={...t.snapshot,bootId:'new'};resolve({ok:true,status:200,json:async()=>({})});await assert.rejects(pending,{name:'AbortError'});t.close();
});
