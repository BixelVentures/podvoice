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

test('ordinary vacuum action preserves only explicit boolean startSent metadata without retrying',async()=>{
 for(const outcome of ['accepted','unknown'])for(const startSent of [false,true,undefined,null,'false',0,1,{}]){
  let calls=0;const t=new PodVoiceTransport({url:'https://ha.example/view/',fetch:async(url,init)=>{calls++;assert.equal(new URL(url).pathname,'/view/api/control/actions');const request=JSON.parse(init.body);assert.deepEqual(request.args,{});return {ok:true,json:async()=>({ok:outcome==='accepted',requestId:request.requestId,outcome,physicalResultVerified:false,retryAllowed:false,partial:outcome==='unknown',completedSteps:2,...(startSent!==undefined?{startSent}:{})})};}});
  t.connected=true;t.snapshot={...snap(),capabilities:{controlSetup:['vacuum']}};
  try{const result=await t.controlAction({bootId:'test',roomId:'kitchen',taskId:'task',revision:1,domain:'vacuum'},'opaque',{});assert.equal(calls,1);assert.equal(result.outcome,outcome);assert.equal(result.partial,outcome==='unknown');assert.equal(result.completedSteps,2);assert.equal(result.retryAllowed,false);assert.equal(result.physicalResultVerified,false);assert.equal(Object.hasOwn(result,'startSent'),typeof startSent==='boolean');if(typeof startSent==='boolean')assert.equal(result.startSent,startSent);}finally{t.close();}
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

test('music setup and queue offer carry one exact actual-binding precondition while effect bodies remain opaque',async()=>{
 const calls=[],id='c'.repeat(64),target={accountId:'account',kind:'spotify_device',targetId:'actual-device',expectedBindingId:id};
 const t=new PodVoiceTransport({url:'https://ha.example/ingress/opaque/view/',fetch:async(url,init)=>{const body=JSON.parse(init.body);calls.push({url:new URL(url),init,body});return {ok:true,status:200,json:async()=>({ok:true,expectedBindingId:body.target?.expectedBindingId??body.expectedBindingId})};}});
 t.closed=false;t.connected=true;t.controller=new AbortController();t.snapshot={...snap(),capabilities:{controlSetup:['music'],queueSelection:true}};
 try{
  await t.controlSetup('music',target);await t.controlSetup('music',{...target,speakerId:'b'.repeat(64)});await t.queueOffer('account','actual-device',id);
  assert.deepEqual(calls[0].body,{bootId:'test',roomId:'kitchen',domain:'music',target});assert.deepEqual(calls[1].body.target,{...target,speakerId:'b'.repeat(64)});
  assert.deepEqual(calls[2].body,{bootId:'test',roomId:'kitchen',accountId:'account',targetId:'actual-device',expectedBindingId:id});
  for(const call of calls){assert.equal(call.url.origin,'https://ha.example');assert(call.url.pathname.startsWith('/ingress/opaque/view/api/'));assert.equal(call.init.credentials,'same-origin');assert.equal(call.init.headers['X-PodView-Request'],'1');}
  for(const invalid of [undefined,null,'a'.repeat(63),'A'.repeat(64)]){await assert.rejects(()=>t.controlSetup('music',{...target,expectedBindingId:invalid}));await assert.rejects(()=>t.queueOffer('account','actual-device',invalid));}
  await assert.rejects(()=>t.controlSetup('music',{...target,grant:true}));assert.equal(calls.length,3,'invalid expectations never reach the server');
 }finally{t.close();}
});

test('music and queue transport reject absent or mismatched offer echoes without replaying a request',async()=>{
 for(const echo of [undefined,null,'d'.repeat(64)]){
  let calls=0;const t=new PodVoiceTransport({url:'https://ha.example/view/',fetch:async()=>{calls++;return {ok:true,status:200,json:async()=>({ok:true,expectedBindingId:echo})};}});
  t.closed=false;t.connected=true;t.controller=new AbortController();t.snapshot={...snap(),capabilities:{controlSetup:['music'],queueSelection:true}};
  try{await assert.rejects(()=>t.controlSetup('music',{accountId:'account',kind:'spotify_device',targetId:'actual-device',expectedBindingId:'c'.repeat(64)}));await assert.rejects(()=>t.queueOffer('account','actual-device','c'.repeat(64)));assert.equal(calls,2);}finally{t.close();}
 }
});

test('explicit volume-only setup uses the existing endpoint without changing normal transport setup',async()=>{
 const calls=[],target={accountId:'account',kind:'spotify_device',targetId:'actual-device',expectedBindingId:'c'.repeat(64)};
 const t=new PodVoiceTransport({url:'https://ha.example/prefix/view/',fetch:async(url,init)=>{const body=JSON.parse(init.body);calls.push({url:new URL(url),body});return {ok:true,status:200,json:async()=>({expectedBindingId:body.target.expectedBindingId})};}});
 t.closed=false;t.connected=true;t.snapshot={...snap(),capabilities:{controlSetup:['music']}};
 try{
  await t.controlSetup('music',target,undefined,{requestedAction:'volume'});await t.controlSetup('music',target);
  assert.equal(calls[0].url.pathname,'/prefix/view/api/control/setup');assert.deepEqual(calls[0].body,{bootId:'test',roomId:'kitchen',domain:'music',target,requestedAction:'volume'});
  assert.deepEqual(calls[1].body,{bootId:'test',roomId:'kitchen',domain:'music',target});
 }finally{t.close();}
});
test('volume setup filter is closed to music volume without recipe or MOVE',async()=>{
 let calls=0;const target={accountId:'account',kind:'spotify_device',targetId:'actual-device',expectedBindingId:'c'.repeat(64)};
 const t=new PodVoiceTransport({url:'https://ha.example/view/',fetch:async()=>{calls++;throw Error('must not fetch');}});t.closed=false;t.connected=true;t.snapshot={...snap(),capabilities:{controlSetup:['music','vacuum']}};
 try{
  for(const options of [null,[],{requestedAction:'pause'},{requestedAction:'volume',force:true},{requestedAction:undefined},{unexpected:true}])await assert.rejects(t.controlSetup('music',target,undefined,options),/invalid_setup_request/);
  await assert.rejects(t.controlSetup('vacuum',target,undefined,{requestedAction:'volume'}),/invalid_setup_request/);
  await assert.rejects(t.controlSetup('music',target,'recipe',{requestedAction:'volume'}),/invalid_setup_request/);
  await assert.rejects(t.controlSetup('music',{...target,speakerId:'b'.repeat(64)},undefined,{requestedAction:'volume'}),/invalid_setup_request/);
  assert.equal(calls,0);
 }finally{t.close();}
});


test('answer transport has exactly current, receipt-history and transcript-segment GET modes with unchanged ingress credentials',async()=>{
 const calls=[],body={schema:'podview.transcript-history.v1',roomId:'kitchen',bootId:'test',items:[]},t=new PodVoiceTransport({url:'https://ha.example/ingress/opaque/view/',room:'kitchen',fetch:async(url,init)=>{calls.push({url:new URL(url),init});return {ok:true,status:200,json:async()=>body};}});t.closed=false;t.connected=true;t.controller=new AbortController();t.snapshot={...snap(),capabilities:{answerRead:true}};
 try{for(const mode of [false,true,'segments'])assert.equal(await t.answers(mode),body);assert.deepEqual(calls.map(call=>call.url.searchParams.get('history')),[null,'1','segments']);for(const call of calls){assert.equal(call.url.origin,'https://ha.example');assert.equal(call.url.pathname,'/ingress/opaque/view/api/answers');assert.equal(call.url.searchParams.get('room'),'kitchen');assert.equal(call.init.credentials,'same-origin');assert.equal(call.init.cache,'no-store');assert.equal(call.init.method||'GET','GET');assert.equal(call.init.body,undefined);}for(const mode of [null,0,1,'1','true','segment','',{},[]])await assert.rejects(()=>t.answers(mode),/invalid_answers_mode/);assert.equal(calls.length,3,'invalid modes never dispatch a read');}finally{t.close();}
});
test('transcript segment transport keeps existing denial and unavailable semantics without retry or effect requests',async()=>{
 for(const status of [401,403,503]){let calls=0;const t=new PodVoiceTransport({url:'https://ha.example/view/',fetch:async()=>{calls++;return {ok:false,status,json:async()=>({error:'denied'})};}});t.closed=false;t.connected=true;t.snapshot={...snap(),capabilities:{answerRead:true}};try{await assert.rejects(()=>t.answers('segments'),error=>error.message==='answers_unavailable'&&([401,403].includes(status)?error.code==='read_access_denied':error.code===undefined));assert.equal(calls,1);}finally{t.close();}}
 let calls=0;const t=new PodVoiceTransport({url:'https://ha.example/view/',fetch:async()=>{calls++;throw Error('must not fetch');}});t.closed=false;t.connected=true;t.snapshot={...snap(),capabilities:{answerRead:false}};try{await assert.rejects(()=>t.answers('segments'),/answers_unavailable/);t.snapshot.capabilities.answerRead=true;t.connected=false;await assert.rejects(()=>t.answers('segments'),/answers_unavailable/);assert.equal(calls,0);}finally{t.close();}
});
test('vacuum draft setup sends exact partial opaque payload and rejects unsafe combinations',async()=>{let sent;const t=new PodVoiceTransport({url:'https://ha.example/view/',fetch:async(url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({ok:true})}}});t.connected=true;t.snapshot={...snap(),capabilities:{controlSetup:['vacuum']}};const hex=n=>n.toString(16).padStart(24,'0'),draft={taskId:'control:'+hex(1),revision:1,optionId:hex(2),areaIds:[],repeat:2,settingChoices:[{settingId:hex(3),choiceId:hex(4)}]};await t.controlSetup('vacuum',{entityId:'vacuum.test'},undefined,{draft});assert.deepEqual(sent.draft,draft);assert.equal('recipeId' in sent,false);await assert.rejects(()=>t.controlSetup('vacuum',{entityId:'vacuum.test'},'recipe',{draft}));await assert.rejects(()=>t.controlSetup('music',{},undefined,{draft}));await assert.rejects(()=>t.controlSetup('vacuum',{entityId:'vacuum.test'},undefined,{draft:{...draft,areaIds:['old']}}));});

test('MOVE recovery is account scoped, fresh offer bound and consumed without granting ordinary controls',async()=>{
 const id='c'.repeat(64),speakerId='b'.repeat(64),calls=[];let serial=0;const t=new PodVoiceTransport({url:'https://ha.example/view/',fetch:async(url,init)=>{const data=JSON.parse(init.body);calls.push(data);if(new URL(url).pathname.endsWith('/control/setup')){return {ok:true,json:async()=>({ok:true,schema:'podview.control.v1',bootId:'test',roomId:'kitchen',domain:'music',taskId:'control:'+String(++serial).padStart(32,'0'),revision:1,expiresAt:Date.now()/1000+10,expectedBindingId:id,options:[{id:'move:'+speakerId,label:'Flyt',action:'move_existing_session',argsSchema:{kind:'none'}}],setup:{volume:null}})};}return {ok:true,json:async()=>({ok:false,requestId:data.requestId,outcome:'unknown',retryAllowed:false,physicalResultVerified:false})};}});t.closed=false;t.connected=true;t.snapshot={...snap(),capabilities:{controlSetup:[],musicMoveRecovery:['account']}};
 const target={accountId:'account',kind:'spotify_device',targetId:'device',expectedBindingId:id,speakerId};try{await assert.rejects(()=>t.controlSetup('music',{...target,accountId:'other'}));await assert.rejects(()=>t.controlSetup('music',Object.fromEntries(Object.entries(target).filter(([k])=>k!=='speakerId'))));const task=await t.controlSetup('music',target);assert.equal((await t.controlAction(task,task.options[0].id,{})).outcome,'unknown');assert.equal((await t.controlAction(task,task.options[0].id,{})).outcome,'rejected');assert.equal(calls.length,2);const fresh=await t.controlSetup('music',target);t.snapshot.capabilities.musicMoveRecovery=[];assert.equal((await t.controlAction(fresh,fresh.options[0].id,{})).outcome,'rejected');assert.equal(calls.length,3);}finally{t.close();}
});

test('only a fresh vacuum cleaning start receives the extended receipt wait',async()=>{
 const t=new PodVoiceTransport({url:'https://ha.example/view/'}),calls=[];t.connected=true;t.snapshot={...snap(),capabilities:{controlSetup:['vacuum','music']}};
 t.request=async(url,options,ms,signal)=>{const body=JSON.parse(options.body);calls.push({url:new URL(url).pathname,ms,signal,optionId:body.optionId});return {ok:true,json:async()=>({ok:true,requestId:body.requestId,outcome:'accepted',retryAllowed:false,physicalResultVerified:false})};};
 const base={bootId:'test',roomId:'kitchen',taskId:'task',revision:1,domain:'vacuum',expiresAt:Date.now()/1000+30};
 const cases=[
  {name:'fresh cleaning start',task:{...base,options:[{id:'chosen',action:'start',argsSchema:{kind:'cleaning'}}]},wait:35000},
  {name:'expired cleaning start',task:{...base,expiresAt:Date.now()/1000-1,options:[{id:'chosen',action:'start',argsSchema:{kind:'cleaning'}}]}},
  {name:'non-cleaning start',task:{...base,options:[{id:'chosen',action:'start',argsSchema:{kind:'none'}}]}},
  {name:'reuse',task:{...base,options:[{id:'chosen',action:'reuse',argsSchema:{kind:'cleaning'}}]}},
  {name:'dock',task:{...base,options:[{id:'chosen',action:'return',argsSchema:{kind:'none'}}]}},
  {name:'music',task:{...base,domain:'music',options:[{id:'chosen',action:'start',argsSchema:{kind:'cleaning'}}]}},
  {name:'foreign option',task:{...base,options:[{id:'other',action:'start',argsSchema:{kind:'cleaning'}}]}}
 ];
 try{for(const item of cases){const result=await t.controlAction(item.task,'chosen',{});assert.equal(result.outcome,'accepted',item.name);assert.equal(calls.at(-1).ms,item.wait,item.name);assert.equal(calls.at(-1).signal,undefined,item.name+' uses existing parent signal default');assert.equal(calls.at(-1).url,'/view/api/control/actions');}assert.equal(calls.length,cases.length);}finally{t.close();}
});
test('native timer revision pair is closed and adjustment receipts are correlated exactly',async()=>{
 const row={id:'native',status:'running',secondsLeft:30,durationSeconds:100,sourceRevision:'9007199254740993'};const t=new PodVoiceTransport({url:'https://ha.example/view/'});t.closed=false;
 for(const item of [{...row,sourceRevision:'01'},{...row,durationSeconds:null},(({sourceRevision,...rest})=>rest)(row)]){const s=snap();s.timers.items=[item];assert.equal(t.accept(s),false);}
 const s=snap();s.timers.items=[row];s.timers.epoch='epoch';s.capabilities.timerActions=['timer.adjust'];assert.equal(t.accept(s),true);t.connected=true;t.controller=new AbortController();let calls=0,change={};t.request=async()=>{calls++;return {ok:true,status:200,json:async()=>({ok:true,requestId:'request',outcome:'accepted',retryAllowed:false,timerId:'native',deltaSeconds:60,expectedSourceRevision:row.sourceRevision,sourceRevision:'9007199254740994',durationSeconds:160,secondsLeft:90,status:'running',...change})};};const args={timer_id:'native',delta_seconds:60,expected_revision:row.sourceRevision};
 assert.equal((await t.action({action:'timer.adjust',args,requestId:'request'})).outcome,'accepted');for(const bad of [{timerId:'other'},{deltaSeconds:-60},{expectedSourceRevision:'1'},{sourceRevision:row.sourceRevision},{durationSeconds:0},{secondsLeft:0},{secondsLeft:161},{sourceRevision:'1'.repeat(25)},{status:'finished'}]){change=bad;assert.equal((await t.action({action:'timer.adjust',args,requestId:'request'})).outcome,'unknown');}const before=calls;await assert.rejects(t.action({action:'timer.adjust',args:{...args,expected_revision:'2'},requestId:'request'}));assert.equal(calls,before);t.close();
});
