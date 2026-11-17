// Main-thread cost while things move (docs/MOTION.md §0): ScrollEdges and CssFlags do nothing while a page or Ro
// layer moves (ui/motion-busy.js) and run once when it has landed; inline style writes never wake ScrollEdges; and
// springs are sampled keyframes, because WebKit's Core Animation path does not accelerate a linear() easing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {begin,end,isBusy,onIdle} from '../../podvoice/gatekeeper/static/podview/ui/motion-busy.js';
import {linearPoints,springFrames,springTiming} from '../../podvoice/gatekeeper/static/podview/ui/native-motion.js';
import {SPRING} from '../../podvoice/gatekeeper/static/podview/ui/motion.js';
import {ScrollEdges} from '../../podvoice/gatekeeper/static/podview/ui/scroll-edges.js';
import {CssFlags} from '../../podvoice/gatekeeper/static/podview/ui/css-flags.js';

test('onIdle runs at once when nothing moves, and once after the last of several movements',()=>{
 let runs=0;const count=()=>runs++;
 onIdle(count);assert.equal(runs,1);
 const page=begin(),ro=begin();assert.equal(isBusy(),true);
 onIdle(count);onIdle(count);page();assert.equal(runs,1,'still one movement open');
 end(ro);assert.equal(runs,2,'one run for the same callback');assert.equal(isBusy(),false);
 ro();assert.equal(runs,2,'ending twice is harmless');
 const cancelled=begin(),cancel=onIdle(count);cancel();cancelled();assert.equal(runs,2);
});

test('a movement that never ends is closed after two seconds',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let runs=0;begin();onIdle(()=>runs++);
 t.mock.timers.tick(1999);assert.equal(runs,0);t.mock.timers.tick(1);assert.equal(runs,1);assert.equal(isBusy(),false);
});

test('linear() points are spread evenly where CSS spreads them',()=>{
 assert.deepEqual(linearPoints('linear(0, 0.5, 1)'),[[0,0],[.5,.5],[1,1]]);
 assert.deepEqual(linearPoints('linear(0, 0.2 40%, 0.6, 1)'),[[0,0],[.4,.2],[.7,.6],[1,1]]);
 assert.deepEqual(linearPoints('ease'),[[0,0],[1,1]]);
});

test('springFrames samples Motion\'s spring as keyframes with the same duration',()=>{
 const {keyframes,duration}=springFrames(SPRING.snappy,p=>({scale:String(p)}));
 const {easing,duration:css}=springTiming(SPRING.snappy),points=linearPoints(easing);
 assert.equal(duration,css);assert.equal(keyframes.length,points.length);
 assert.deepEqual(keyframes.map(frame=>frame.offset),points.map(([time])=>time));
 assert.deepEqual(keyframes.map(frame=>Number(frame.scale)),points.map(([,value])=>value));
 assert(keyframes.some(frame=>Number(frame.scale)>1),'a bouncy spring overshoots');
});

function scrollFixture(){
 const original={ResizeObserver:globalThis.ResizeObserver,MutationObserver:globalThis.MutationObserver,
  requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame,
  getComputedStyle:globalThis.getComputedStyle};
 const rafs=[],observed=[];let reads=0;
 class Observer {constructor(callback){this.callback=callback;}observe(target,options){observed.push(options);}
  unobserve(){}disconnect(){}}
 globalThis.ResizeObserver=Observer;globalThis.MutationObserver=Observer;
 globalThis.requestAnimationFrame=fn=>rafs.push(fn);globalThis.cancelAnimationFrame=id=>{rafs[id-1]=()=>{};};
 globalThis.getComputedStyle=()=>{reads++;return {scrollSnapType:'none',overflowY:'auto',overflowX:'auto'};};
 const node=Object.assign(new EventTarget(),{dataset:{},classList:{contains:()=>false},clientHeight:100,
  scrollHeight:300,scrollTop:0,getClientRects:()=>[{}]});
 const host=Object.assign(new EventTarget(),{querySelectorAll:()=>[node],ownerDocument:{getElementById:()=>null}});
 const flush=()=>{for(const fn of rafs.splice(0))fn();};
 const restore=()=>{for(const [name,value] of Object.entries(original))
  if(value===undefined)delete globalThis[name];else globalThis[name]=value;};
 return {host,node,flush,observed,reads:()=>reads,rafs,restore};
}

test('ScrollEdges ignores inline style, and measures once after a movement instead of during it',()=>{
 const f=scrollFixture();
 try{
  const edges=new ScrollEdges(f.host);edges.attach();f.flush();
  assert.equal(f.observed[0].attributeFilter.includes('style'),false,'motion code writes inline style every phase');
  const before=f.reads(),moving=begin();
  for(let i=0;i<5;i++){edges.mutations.callback([{type:'childList'}]);edges.resize.callback([]);f.flush();}
  f.node.dispatchEvent(new Event('scroll'));f.flush();
  assert.equal(f.reads(),before,'no measurement while the page moves');assert.equal(f.rafs.length,0);
  moving();assert.equal(f.rafs.length,1,'one pass is queued when it lands');f.flush();
  assert.equal(f.reads(),before+1,'one pass for the whole push');assert.equal(f.node.dataset.scrollEdge,'end');
  edges.mutations.callback([{type:'childList'}]);edges.mutations.callback([{type:'childList'}]);
  assert.equal(f.rafs.length,1,'triggers in one frame share one pass');
  edges.detach();
 }finally{f.restore();}
});

test('CssFlags syncs once per frame from its observer, and once after a movement',()=>{
 const rafs=[],queries=[];
 const original={MutationObserver:globalThis.MutationObserver};
 globalThis.MutationObserver=class {constructor(callback){this.callback=callback;}observe(){}disconnect(){}};
 const anchor={querySelector(selector){queries.push(selector);return null;},hasAttribute:()=>false,toggleAttribute(){}};
 const doc={documentElement:anchor,body:anchor,defaultView:{requestAnimationFrame:fn=>rafs.push(fn),
  cancelAnimationFrame(){}}};
 const host={ownerDocument:doc,querySelector:()=>anchor,...anchor,querySelector(selector){
  if(selector===':scope>.frame')return anchor;queries.push(selector);return null;}};
 try{
  const flags=new CssFlags(host);flags.attach();const perSync=queries.length;queries.length=0;
  const record={type:'attributes',attributeName:'hidden'};
  flags.observer.callback([record]);flags.observer.callback([record]);
  assert.equal(queries.length,0,'nothing synchronous');assert.equal(rafs.length,1);
  rafs.shift()();assert.equal(queries.length,perSync,'one sync');queries.length=0;
  const moving=begin();flags.observer.callback([record]);flags.observer.callback([record]);
  assert.equal(rafs.length,0);assert.equal(queries.length,0);
  moving();assert.equal(rafs.length,1);rafs.shift()();assert.equal(queries.length,perSync,'one sync after');
  flags.sync();assert.equal(queries.length,2*perSync,'the host\'s own sync after a render stays immediate');
  flags.detach();
 }finally{globalThis.MutationObserver=original.MutationObserver;}
});
