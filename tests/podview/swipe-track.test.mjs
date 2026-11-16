// P9 track B (docs/MOTION.md §3.10.3): attachSwipeTrack tracks 1:1 after a 10px slop with an axis lock, estimates
// the release velocity by regression, projects the fling with UIScrollView's rate (±6 at most), meets the ends with
// the iOS rubber-band, catches a running spring (never a tap) and settles on the nearest cover after a cancel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {attachSwipeTrack,swipeVelocity,swipeTarget}
 from '../../podvoice/gatekeeper/static/podview/ui/gestures.js';
import {SPRING,rubberBand} from '../../podvoice/gatekeeper/static/podview/ui/motion.js';

function track(options={}){
 let time=0;const frames=[],settled=[],taps=[],listeners={},queue=[];
 const node={listeners,captured:null,getBoundingClientRect:()=>({left:0,top:0,width:1180,height:470}),
  addEventListener(type,fn){(listeners[type]??=[]).push(fn);},removeEventListener(type,fn){
   listeners[type]=(listeners[type]||[]).filter(f=>f!==fn);},setPointerCapture(id){this.captured=id;}};
 const raf=fn=>queue.push(fn),now=()=>time;
 const api=attachSwipeTrack(node,{pitch:430,count:10,index:3,raf,now,onFrame:p=>frames.push(p),
  onSettle:k=>settled.push(k),onTap:target=>taps.push(target),...options});
 const fire=(type,event)=>{const e={isPrimary:true,button:0,pointerId:1,target:'cover',defaultPrevented:false,
  preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...event};
  for(const fn of listeners[type]||[])fn(e);return e;};
 const step=ms=>{time+=ms;const run=queue.splice(0);for(const fn of run)fn();};
 const run=(limit=5000)=>{for(let t=0;t<limit&&queue.length;t+=16)step(16);};
 // A straight horizontal drag from x0 to x1 over `ms`, sampled every 8 ms.
 const drag=(x0,x1,ms,{y=200}={})=>{fire('pointerdown',{clientX:x0,clientY:y});
  for(let t=8;t<=ms;t+=8){time+=8;fire('pointermove',{clientX:x0+(x1-x0)*t/ms,clientY:y});}};
 return {node,api,fire,step,run,drag,frames,settled,taps,time:()=>time,advance:ms=>{time+=ms;}};
}

test('velocity comes from a regression over the last 80 ms, not the last delta',()=>{
 const samples=Array.from({length:20},(_,i)=>({t:i*8,x:i*16+(i%2?3:-3)}));
 assert(Math.abs(swipeVelocity(samples)-2000)<150,`${swipeVelocity(samples)}`);
 assert.equal(swipeVelocity([{t:0,x:0}]),0);
});

test('a fling is projected with v·0.499/pitch, limited to ±6 and to the ends',()=>{
 const fling=swipeTarget({p:3,start:3,velocity:-2000,pitch:430,count:42});
 assert.equal(fling.target,5,'2000 px/s from 3 lands on 5 (3 + 2.32)');
 assert.equal(fling.spec,SPRING.flick);assert(Math.abs(fling.velocity-2000/430)<1e-9);
 assert.equal(swipeTarget({p:3,start:3,velocity:-300,pitch:430,count:42}).target,3,'a light push stays');
 assert.equal(swipeTarget({p:3,start:3,velocity:-300,pitch:430,count:42}).spec,SPRING.snappy);
 assert.equal(swipeTarget({p:3,start:3,velocity:-20000,pitch:430,count:42}).target,9,'at most six covers');
 assert.equal(swipeTarget({p:8,start:8,velocity:-5000,pitch:430,count:10}).target,9,'never past the end');
 const reduced=swipeTarget({p:3.2,start:3,velocity:-5000,pitch:430,count:42,reduced:true});
 assert.equal(reduced.target,3,'reduced: no projection');assert.equal(reduced.spec,SPRING.quick);
});

test('the finger moves p 1:1 after the 10px slop with a horizontal lock and pointer capture',()=>{
 const f=track();f.fire('pointerdown',{clientX:600,clientY:200});
 f.fire('pointermove',{clientX:594,clientY:200});assert.equal(f.frames.length,1,'nothing before 10px');
 f.fire('pointermove',{clientX:588,clientY:200});assert.equal(f.node.captured,1);
 f.fire('pointermove',{clientX:158,clientY:200});
 assert(Math.abs(f.frames.at(-1)-4)<1e-9,'430px to the left is one cover on');
});

test('a mostly vertical move is left to the browser',()=>{
 const f=track();f.fire('pointerdown',{clientX:600,clientY:200});f.fire('pointermove',{clientX:606,clientY:220});
 f.fire('pointermove',{clientX:300,clientY:230});assert.equal(f.frames.length,1);assert.equal(f.node.captured,null);
});

test('a fling of 2000 px/s from 3 settles on 5 on the flick spring with the finger velocity',()=>{
 const f=track();f.drag(600,520,40);f.fire('pointerup',{clientX:520,clientY:200});
 const first=f.frames.length;f.step(16);assert(f.frames.at(-1)>f.frames[first-1],'it keeps going');
 f.run();assert.deepEqual(f.settled,[5]);assert.equal(f.frames.at(-1),5);
});

test('past the first cover the finger meets the rubber-band, and the release returns to 0',()=>{
 const f=track({index:0});f.fire('pointerdown',{clientX:400,clientY:200});
 f.fire('pointermove',{clientX:412,clientY:200});f.fire('pointermove',{clientX:812,clientY:200});
 const expected=-rubberBand(400,1180)/430;
 assert(Math.abs(f.frames.at(-1)-expected)<1e-9,`${f.frames.at(-1)} vs ${expected}`);
 assert(f.frames.at(-1)>-400/430,'resistance');
 f.advance(300);f.fire('pointerup',{clientX:812,clientY:200});f.run();assert.deepEqual(f.settled,[0]);
});

test('a touch on a running spring catches it where it is; that touch is never a tap',()=>{
 const f=track();f.drag(600,520,40);f.fire('pointerup',{clientX:520,clientY:200});
 f.step(16);f.step(16);const flying=f.frames.at(-1);
 const down=f.fire('pointerdown',{clientX:300,clientY:200});assert(down);
 assert.equal(f.frames.at(-1),flying,'caught at the visible value');
 f.fire('pointerup',{clientX:300,clientY:200});assert.deepEqual(f.taps,[]);
 const click=f.fire('click',{});assert.equal(click.defaultPrevented,true,'its click is swallowed');
 f.run();assert.deepEqual(f.settled,[Math.round(flying)]);
});

test('a short touch is a tap on its own target; the click that follows is swallowed, a keyboard click is not',()=>{
 const f=track();f.fire('pointerdown',{clientX:600,clientY:200,target:'neighbour'});
 f.fire('pointerup',{clientX:603,clientY:200});assert.deepEqual(f.taps,['neighbour']);
 assert.equal(f.fire('click',{}).defaultPrevented,true);
 f.fire('keydown',{key:'Enter'});assert.equal(f.fire('click',{}).defaultPrevented,false);
});

test('the edge zone belongs to the back gesture',()=>{
 const f=track();f.fire('pointerdown',{clientX:20,clientY:200});f.fire('pointermove',{clientX:300,clientY:200});
 assert.equal(f.frames.length,1);
});

test('a cancel settles on the nearest cover on the quick spring',()=>{
 const f=track();f.drag(600,330,80);f.fire('pointercancel',{});f.run();assert.deepEqual(f.settled,[4]);
});

test('to() retargets a running spring and keeps its velocity',()=>{
 const f=track();f.api.to(4);f.step(16);f.step(16);const v1=f.frames.at(-1);f.api.to(5);f.step(16);
 assert(f.frames.at(-1)>v1);f.run();assert.deepEqual(f.settled,[5]);
});

test('a finger that rests before lifting has no velocity left',()=>{
 const f=track();f.drag(600,520,40);f.advance(200);f.fire('pointerup',{clientX:520,clientY:200});f.run();
 assert.deepEqual(f.settled,[3]);
});
