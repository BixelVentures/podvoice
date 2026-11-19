import test from 'node:test';
import assert from 'node:assert/strict';
import {inferKind,installFrameMeter,shortUserAgent,summarizeFrames}
 from '../../podview/ui/frame-meter.js';

test('frame summary counts slow frames, max and p95', () => {
 const deltas=[...Array(18).fill(16.7),21,40];
 assert.deepEqual(summarizeFrames(deltas),
  {frames:20,over17:2,over20:2,over34:1,over50:0,maxFrameMs:40,p95FrameMs:21});
 assert.deepEqual(summarizeFrames([]),
  {frames:0,over17:0,over20:0,over34:0,over50:0,maxFrameMs:null,p95FrameMs:null});
});

test('kind follows the host view before and after the touch', () => {
 const home={shell:'active',level:'home',view:'now'},ro={shell:'rest',level:'home',view:'photo'};
 const radio={shell:'active',level:'detail',view:'radio'},none={scrolled:false,animations:0};
 assert.equal(inferKind(home,ro,none),'ro-open');
 assert.equal(inferKind(ro,home,none),'ro-close');
 assert.equal(inferKind(home,radio,none),'push');
 assert.equal(inferKind(radio,home,none),'pop');
 assert.equal(inferKind(home,home,{scrolled:true,animations:2}),'scroll');
 assert.equal(inferKind(home,home,{scrolled:false,animations:1}),'press');
 assert.equal(inferKind(home,home,none),'tap');
});

test('user agent is short and printable', () => {
 const ua='Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 ö';
 assert.equal(shortUserAgent(ua),'(iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 ?');
});

function fakeWindow(){
 const listeners={},docListeners={},frames=[],timers=[];let clock=1000;
 class Element{animate(){let finish;const finished=new Promise(resolve=>{finish=resolve;});
  return {effect:{getTiming:()=>({iterations:1})},finished,finish};}}
 const host={dataset:{view:'active',level:'home'},state:{focus:'now'}};
 const win={Element,devicePixelRatio:2,navigator:{userAgent:'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X)'},
  location:{pathname:'/api/hassio_ingress/tok/view/',search:'',origin:'https://ha.local'},
  performance:{now:()=>clock},requestAnimationFrame:fn=>frames.push(fn),
  setTimeout:fn=>timers.push(fn),clearTimeout(){},
  addEventListener:(type,fn)=>(listeners[type]??=[]).push(fn),
  document:{hidden:false,documentElement:{dataset:{}},querySelector:()=>host,getElementById:()=>null,
   addEventListener:(type,fn)=>(docListeners[type]??=[]).push(fn)}};
 const fire=(type,event={})=>{for(const fn of listeners[type]||[])fn(event);};
 const frame=ms=>{clock+=ms;const run=frames.splice(0);for(const fn of run)fn(clock);};
 return {win,host,fire,frame,frames,timers};
}

test('a touch records one session, idle costs nothing, flush posts through ingress', async () => {
 const w=fakeWindow(),posts=[];
 const meter=installFrameMeter(w.win,{fetch:(url,options)=>{posts.push({url:String(url),options});
  return Promise.resolve();}});
 assert.equal(w.frames.length,0,'no rAF loop while idle');
 w.fire('pointerdown',{clientX:10,clientY:10});
 const press=new w.win.Element().animate();
 for(let i=0;i<6;i++)w.frame(16.7);w.fire('pointerup');
 w.host.state.focus='radio';w.host.dataset.level='detail';
 const push=new w.win.Element().animate();
 for(let i=0;i<5;i++)w.frame(16.7);
 w.frame(50);
 press.finish();push.finish();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(meter.flush(),false,'never flushes during a session');
 for(let i=0;i<20&&meter.active();i++)w.frame(16.7);
 assert.equal(meter.active(),false,'session ends once motion settles');
 assert.equal(w.frames.length,0,'rAF stops with the session');
 assert.equal(posts.length,1,'the deferred flush runs after the session');
 assert.equal(posts[0].url,'https://ha.local/api/hassio_ingress/tok/view/api/frames');
 assert.equal(posts[0].options.headers['X-PodView-Request'],'1');
 assert.equal(posts[0].options.keepalive,true);
 const [row]=JSON.parse(posts[0].options.body).sessions;
 assert.equal(row.kind,'push');assert.equal(row.from,'now');assert.equal(row.to,'radio');
 assert.equal(row.animations,2);assert.equal(row.over34,1);assert.equal(row.over50,0);
 assert.equal(row.maxFrameMs,50);assert.equal(row.dpr,2);
 assert(row.startLatencyMs>=0&&row.startLatencyMs<20,`latency ${row.startLatencyMs}`);
 assert.equal(meter.pending(),0);
});
