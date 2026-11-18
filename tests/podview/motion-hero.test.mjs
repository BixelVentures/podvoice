// P7 hero (docs/MOTION.md §3.8): SceneMotion.hero names exactly one element pv-hero at a time (the source while the
// old page is captured, then the target after present()), runs as a push or pop, clears the name when done, and
// renders at once without view transitions. Reduced names nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SceneMotion} from '../../podview/ui/motion.js';

function fixture({reduced=false,transitions=true}={}){
 const log=[],root={dataset:{}},listeners=new Map();let finish;
 const doc={documentElement:root,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:()=>{},
  startViewTransition:transitions?update=>{log.push(['capture',...named()]);const transition={
   ready:Promise.resolve(),updateCallbackDone:Promise.resolve(),skipTransition(){log.push(['skip']);},
   finished:new Promise(resolve=>{finish=resolve;})};queueMicrotask(()=>{update();log.push(['new',...named()]);});
   return transition;}:undefined};
 const nodes=[];const node=id=>{const n={id,isConnected:true,style:{viewTransitionName:''},getClientRects:()=>[{}]};
  nodes.push(n);return n;};
 const named=()=>nodes.filter(n=>n.style.viewTransitionName==='pv-hero').map(n=>n.id);
 const host={dataset:{motion:reduced?'reduced':'system'},isConnected:true,ownerDocument:doc};
 return {motion:new SceneMotion(host),node,log,root,named,done:()=>finish()};
}

test('the source carries the name while the old page is captured, the target after present()',async()=>{
 const f=fixture(),cover=f.node('cover'),photo=f.node('photo');let presented=0;
 f.motion.hero({source:cover,target:()=>photo,present:()=>presented++});
 assert.equal(f.root.dataset.pvNav,'push');
 await Promise.resolve();await Promise.resolve();
 assert.deepEqual(f.log,[['capture','cover'],['new','photo']]);assert.equal(presented,1);
 f.done();await new Promise(resolve=>setTimeout(resolve));
 assert.deepEqual(f.named(),[],'the name is cleared');assert.equal(f.root.dataset.pvNav,undefined);
});

test('back runs as a pop; a missing or hidden target leaves the page transition alone',async()=>{
 const f=fixture(),photo=f.node('photo');
 f.motion.hero({source:photo,target:()=>null,back:true,present:()=>{}});
 assert.equal(f.root.dataset.pvNav,'pop');await Promise.resolve();await Promise.resolve();
 assert.deepEqual(f.log,[['capture','photo'],['new']]);
});

test('reduced names nothing; without view transitions it renders at once',async()=>{
 const reduced=fixture({reduced:true}),cover=reduced.node('cover');
 reduced.motion.hero({source:cover,target:()=>cover,present:()=>{}});
 await Promise.resolve();await Promise.resolve();assert.deepEqual(reduced.log,[['capture'],['new']]);
 const plain=fixture({transitions:false});let presented=0;
 assert.equal(plain.motion.hero({source:plain.node('cover'),target:()=>null,present:()=>presented++}),null);
 assert.equal(presented,1);
});

test('CSS: the hero group flies on the smooth spring',()=>{
 const css=readFileSync(new URL('../../podview/ui-kit.css',import.meta.url),'utf8');
 assert(css.includes('::view-transition-group(pv-hero){animation-duration:661ms;'+
  'animation-timing-function:var(--pv-spring-0)}'));
});
