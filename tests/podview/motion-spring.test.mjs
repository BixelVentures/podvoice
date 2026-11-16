import test from 'node:test';
import assert from 'node:assert/strict';
import {SPRING,Spring} from '../../podvoice/gatekeeper/static/podview/ui/motion.js';

// Fake clock and frame scheduler: each step advances time and runs the pending frame.
function clock(){
 let time=0,pending=[];
 return {
  now:()=>time,
  raf:callback=>{pending.push(callback);},
  step(ms){time+=ms;const frames=pending;pending=[];for(const frame of frames)frame();},
  run(ms,frameMs=1000/60){for(let t=0;t<ms;t+=frameMs)this.step(frameMs);},
  get pending(){return pending.length;},
 };
}

test('bounce 0 reaches its target without overshoot and comes to rest',()=>{
 const c=clock(),values=[];let rested=null;
 const spring=new Spring(SPRING.quick,{value:0,now:c.now,raf:c.raf,onFrame:v=>values.push(v),onRest:v=>{rested=v;}});
 spring.to(1);c.run(2000);
 assert.equal(rested,1);assert.equal(spring.resting,true);assert.equal(spring.value,1);
 assert.ok(values.every(v=>v<=1),'no overshoot');
 for(let i=1;i<values.length;i++)assert.ok(values[i]>=values[i-1],'monotonic');
 assert.equal(c.pending,0,'no frames after rest');
});

test('perceptual duration: bounce 0 is about 98.6 % there at its duration',()=>{
 const c=clock(),spring=new Spring(SPRING.smooth,{now:c.now,raf:c.raf});
 spring.to(1);c.step(450);
 assert.ok(Math.abs(spring.value-.986)<.001);
});

test('a retarget in flight keeps the visible value and its velocity',()=>{
 const c=clock(),spring=new Spring(SPRING.snappy,{now:c.now,raf:c.raf});
 spring.to(100);c.run(120);
 const before={value:spring.value,velocity:spring.velocity};
 spring.to(-50);
 assert.ok(Math.abs(spring.value-before.value)<1e-9);
 assert.ok(Math.abs(spring.velocity-before.velocity)<1e-9);
 c.step(1);
 assert.ok(Math.abs(spring.value-(before.value+before.velocity/1000))<.05,'continuous derivative');
});

test('an explicit handoff velocity is used and carries the value past the start',()=>{
 const c=clock(),spring=new Spring(SPRING.flick,{value:0,now:c.now,raf:c.raf});
 spring.to(0,{velocity:5});c.step(16);
 assert.ok(spring.value>0);assert.ok(spring.velocity<5);
});

test('stop catches the spring in flight: value kept, velocity dropped',()=>{
 const c=clock();let rested=false;
 const spring=new Spring(SPRING.smooth,{now:c.now,raf:c.raf,onRest:()=>{rested=true;}});
 spring.to(10);c.run(100);
 const value=spring.value;spring.stop();
 assert.equal(spring.value,value);assert.equal(spring.velocity,0);assert.equal(spring.resting,true);
 c.run(1000);assert.equal(spring.value,value);assert.equal(rested,false);
});

test('position at a time is the same at 30 Hz and 60 Hz',()=>{
 const at=(frameMs)=>{const c=clock(),s=new Spring(SPRING.snappy,{now:c.now,raf:c.raf});s.to(1);
  c.run(300,frameMs);return s.sample(c.now()).value;};
 const a=new Spring(SPRING.snappy,{now:()=>0,raf:()=>{}}).to(1).sample(300).value;
 assert.ok(Math.abs(at(1000/30)-at(1000/60))<.02);
 assert.ok(a>0&&a<1.01);
});

test('closed form: same start, same time gives identical values regardless of frames',()=>{
 const run=frames=>{const c=clock(),s=new Spring(SPRING.snappy,{now:c.now,raf:c.raf});s.to(1);
  for(const ms of frames)c.step(ms);return s.value;};
 assert.equal(run([300]),run([100,100,100]));
 assert.equal(run([300]),run(Array(30).fill(10)));
});
