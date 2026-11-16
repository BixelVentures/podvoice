import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 DUR,EASE,SPRING,springParams,springCurve,rubberBand,project,
} from '../../podvoice/gatekeeper/static/podview/ui/motion.js';
import {KIT_CSS,motionTokenBlock,replaceBlock} from '../../scripts/gen-motion-tokens.mjs';

const kit=readFileSync(KIT_CSS,'utf8');
const delivered=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/podview.css',import.meta.url),'utf8');
// Generated values are wrapped after a comma; joining the lines gives the exact single-line value back.
const token=(css,name)=>{
 const match=css.match(new RegExp(`${name}:([^;]+);`));
 assert.ok(match,`${name} is declared`);
 return match[1].replace(/,\n\s+/g,', ');
};

test('ui-kit.css holds exactly the block the generator writes from ui/motion.js',()=>{
 assert.equal(replaceBlock(kit),kit,'run node scripts/gen-motion-tokens.mjs');
 assert.ok(kit.includes(motionTokenBlock()));
 assert.ok(delivered.includes(motionTokenBlock()),'podview.css carries the same block');
});

test('CSS spring curves match the JS springCurve byte for byte',()=>{
 assert.equal(token(kit,'--pv-spring-0'),springCurve(SPRING.quick).easing);
 assert.equal(token(kit,'--pv-spring-0'),springCurve(SPRING.smooth).easing);
 assert.equal(token(kit,'--pv-spring-15'),springCurve(SPRING.snappy).easing);
 assert.equal(token(kit,'--pv-spring-quick'),'441ms var(--pv-spring-0)');
 assert.equal(token(kit,'--pv-spring-smooth'),'661ms var(--pv-spring-0)');
 assert.equal(token(kit,'--pv-spring-snappy'),'557ms var(--pv-spring-15)');
});

test('the curves are the ones approved in docs/MOTION.md §3.1',()=>{
 assert.equal(springCurve(SPRING.quick).easing,'linear(0, 0.005 1.2%, 0.02 2.3%, 0.083 5.2%, 0.164 7.8%, '
  +'0.46 16.8%, 0.555 20.2%, 0.638 23.5%, 0.708 26.8%, 0.766 30.2%, 0.816 33.7%, 0.86 37.5%, 0.899 42%, '
  +'0.929 46.8%, 0.953 52.3%, 0.971 58.5%, 0.991 73.7%, 1)');
 assert.equal(springCurve(SPRING.snappy).easing,'linear(0, 0.006 1.3%, 0.024 2.7%, 0.054 4.2%, 0.097 5.8%, '
  +'0.187 8.7%, 0.516 18.2%, 0.612 21.3%, 0.695 24.5%, 0.766 27.7%, 0.824 30.8%, 0.873 34.2%, 0.913 37.7%, '
  +'0.946 41.5%, 0.971 45.8%, 0.989 50.5%, 1 55.8%, 1.006 68%, 1)');
 assert.deepEqual(['quick','smooth','snappy'].map(name=>springCurve(SPRING[name]).ms),[441,661,557]);
});

test('durations and easings are the four plus reduced, and three curves',()=>{
 assert.deepEqual(DUR,{tap:100,quick:160,base:240,ambient:1400,reduced:150});
 for(const [name,ms]of Object.entries(DUR))assert.equal(token(kit,`--pv-dur-${name}`),`${ms}ms`);
 for(const [name,value]of Object.entries(EASE))assert.equal(token(kit,`--pv-ease-${name}`),value);
 assert.equal(token(kit,'--pv-ease-out'),'cubic-bezier(.2,0,0,1)');
});

test('spring parameters follow the duration/bounce model',()=>{
 const smooth=springParams({duration:.45,bounce:0});
 assert.ok(Math.abs(smooth.k-195.0)<.1);assert.ok(Math.abs(smooth.c-27.93)<.01);assert.equal(smooth.zeta,1);
 const quick=springParams(SPRING.quick),snappy=springParams(SPRING.snappy),flick=springParams(SPRING.flick);
 assert.ok(Math.abs(quick.k-438.6)<.1);assert.ok(Math.abs(quick.c-41.89)<.01);
 assert.ok(Math.abs(snappy.k-246.7)<.1);assert.ok(Math.abs(snappy.c-26.70)<.01);
 assert.ok(Math.abs(snappy.zeta-.85)<1e-9);
 assert.ok(Math.abs(flick.k-157.9)<.1);assert.ok(Math.abs(flick.c-20.11)<.01);
});

test('rubber band starts at zero, grows monotonically and never reaches the dimension',()=>{
 assert.equal(rubberBand(0,40),0);
 let previous=0;
 for(const x of [1,10,40,100,1000,1e6]){const y=rubberBand(x,40);assert.ok(y>previous);assert.ok(y<40);previous=y;}
 assert.ok(40-rubberBand(1e9,40)<1e-4);
});

test('fling projection uses the UIScrollView deceleration rate',()=>{
 assert.ok(Math.abs(project(1000,.998)-499)<1e-9);
 assert.ok(Math.abs(project(1000)-499)<1e-9);
 assert.ok(Math.abs(project(1000,.99)-99)<1e-9);
});
