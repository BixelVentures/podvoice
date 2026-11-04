import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../dist/widget-view.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf(' updateHomeRevision(snapshot){'),source.indexOf(' invalidateLiveMusic('));
const Host=new Function('validateHome','applyHome',`return class {${code}}`)((body,room,boot)=>{assert.equal(body.roomId,room);assert.equal(body.bootId,boot);return body;},(state,home)=>({...state,value:home.value}));
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject}};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(){const host=new Host(),calls=[];const transport={connected:true,generation:1,home(){const job=deferred();calls.push(job);return job.promise;}};Object.assign(host,{state:{devices:[]},isConnected:true,liveTransport:transport,liveSnapshot:{bootId:'boot',roomId:'room',capabilities:{homeRead:['vacuum']}},render(){}});return {host,transport,calls};}
const revision=(scope,n)=>({scope,revision:n}),body=(scope,n,value)=>({bootId:'boot',roomId:'room',sourceRevision:revision(scope,n),vacuum:{status:'observed'},value});
test('home events coalesce without starving a slow valid read',async()=>{
 const f=fixture(),scope='a'.repeat(64);f.host.liveSnapshot.homeRevision=revision(scope,1);f.host.updateHomeRevision(f.host.liveSnapshot);assert.equal(f.calls.length,1);
 f.host.liveSnapshot.homeRevision=revision(scope,2);f.host.updateHomeRevision(f.host.liveSnapshot);f.host.liveSnapshot.homeRevision=revision(scope,3);f.host.updateHomeRevision(f.host.liveSnapshot);assert.equal(f.calls.length,1);
 f.calls[0].resolve(body(scope,1,'first'));await tick();assert.equal(f.host.state.value,'first');assert.equal(f.calls.length,2);
 f.calls[1].resolve(body(scope,3,'latest'));await tick();assert.equal(f.host.state.value,'latest');assert.equal(f.calls.length,2);assert.equal(f.host.liveHomePending,false);
});
test('scope changes fence late old reads and their cleanup',async()=>{
 const f=fixture(),a='a'.repeat(64),b='b'.repeat(64);f.host.liveSnapshot.homeRevision=revision(a,1);f.host.updateHomeRevision(f.host.liveSnapshot);
 f.host.liveSnapshot.homeRevision=revision(b,0);f.host.updateHomeRevision(f.host.liveSnapshot);assert.equal(f.calls.length,2);f.calls[0].resolve(body(a,1,'old'));await tick();assert.equal(f.host.state.value,undefined);assert.equal(f.host.liveHomePending,true);
 f.calls[1].resolve(body(b,0,'new'));await tick();assert.equal(f.host.state.value,'new');assert.equal(f.host.liveHomePending,false);
});
test('older-than-applied result is not shown and triggers one needed follow-up',async()=>{
 const f=fixture(),scope='a'.repeat(64);f.host.liveHomeDesired=revision(scope,2);f.host.liveHomeApplied=revision(scope,2);f.host.state.value='already shown';f.host.liveSnapshot.homeRevision=revision(scope,2);f.host.loadLiveHome();
 f.host.liveSnapshot.homeRevision=revision(scope,3);f.host.updateHomeRevision(f.host.liveSnapshot);f.calls[0].resolve(body(scope,1,'obsolete'));await tick();assert.equal(f.host.state.value,'already shown');assert.equal(f.calls.length,2);
 f.calls[1].resolve(body(scope,3,'latest'));await tick();assert.equal(f.host.state.value,'latest');assert.equal(f.calls.length,2);
});
test('transport rejects malformed and regressing home revision fields',async()=>{
 const {PodVoiceTransport}=await import('../../dist/podvoice-transport.js');const t=new PodVoiceTransport({url:'https://ha.example/view/',diagnosticStorage:null});t.closed=false;const scope='a'.repeat(64),snapshot={schema:'podview.snapshot.v1',bootId:'boot',roomId:'room',revision:1,voice:{},timers:{status:'observed',items:[]},capabilities:{musicRead:[],timerActions:[],homeRead:['vacuum']},homeRevision:revision(scope,2)};
 try{assert.equal(t.accept(snapshot),true);for(const value of [{scope:'invalid',revision:3},{scope,revision:-1},{scope,revision:2,extra:true},{scope,revision:1}])assert.equal(t.accept({...snapshot,revision:2,homeRevision:value}),false);assert.equal(t.accept({...snapshot,revision:2,homeRevision:revision(scope,3)}),true);}finally{t.close();}
});

test('event during a failed read gets one bounded follow-up',async()=>{
 const f=fixture(),scope='a'.repeat(64);f.host.liveSnapshot.homeRevision=revision(scope,1);f.host.updateHomeRevision(f.host.liveSnapshot);f.host.liveSnapshot.homeRevision=revision(scope,2);f.host.updateHomeRevision(f.host.liveSnapshot);f.calls[0].reject(Error('temporary'));await tick();assert.equal(f.calls.length,2);f.calls[1].reject(Error('still unavailable'));await tick();assert.equal(f.calls.length,2);assert.equal(f.host.liveHomePending,false);
});
