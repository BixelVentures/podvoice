import test from 'node:test';
import assert from 'node:assert/strict';
import {scrollEdgeState} from '../../podvoice/gatekeeper/static/podview/ui/scroll-edges.js';
test('scroll fades show remaining content and clear at each real endpoint',()=>{
 assert.equal(scrollEdgeState({position:0,viewport:300,content:300}),'');
 assert.equal(scrollEdgeState({position:0,viewport:300,content:900}),'end');
 assert.equal(scrollEdgeState({position:250,viewport:300,content:900}),'start end');
 assert.equal(scrollEdgeState({position:600,viewport:300,content:900}),'start');
 assert.equal(scrollEdgeState({position:-12,viewport:300,content:900}),'end');
 assert.equal(scrollEdgeState({position:612,viewport:300,content:900}),'start');
 assert.equal(scrollEdgeState({position:0,viewport:300,content:300.5}),'');
 assert.equal(scrollEdgeState({position:0,viewport:0,content:900}),'');
 assert.equal(scrollEdgeState({position:NaN,viewport:300,content:900}),'');
});

test('ScrollEdges tracks visibility and content changes, and removes its own effects on detach',async()=>{
 const {ScrollEdges}=await import('../../podvoice/gatekeeper/static/podview/ui/scroll-edges.js');
 const original={ResizeObserver:globalThis.ResizeObserver,MutationObserver:globalThis.MutationObserver,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame,getComputedStyle:globalThis.getComputedStyle};
 const rafs=new Map();let nextFrame=1;
 class Observer {constructor(callback){this.callback=callback;this.targets=new Set();this.disconnected=false;Observer.instances.push(this);}observe(target){this.targets.add(target);}unobserve(target){this.targets.delete(target);}disconnect(){this.disconnected=true;this.targets.clear();}}
 Observer.instances=[];
 class Node extends EventTarget {
  constructor(selector,visible=false){super();this.selector=selector;this.visible=visible;this.dataset={};this.classList={contains:value=>value==='weather-hours'&&this.selector===value};this.clientWidth=200;this.scrollWidth=500;this.clientHeight=100;this.scrollHeight=300;this.scrollLeft=0;this.scrollTop=0;this.snap='none';this.overflowX='auto';this.overflowY='auto';}
  getClientRects(){return this.visible?[{}]:[];}
 }
 class Host extends EventTarget {constructor(){super();this.nodes=[];}querySelectorAll(){return this.nodes;}}
 globalThis.ResizeObserver=Observer;globalThis.MutationObserver=Observer;
 globalThis.requestAnimationFrame=fn=>{const id=nextFrame++;rafs.set(id,fn);return id;};
 globalThis.cancelAnimationFrame=id=>rafs.delete(id);
 globalThis.getComputedStyle=node=>({scrollSnapType:node.snap,overflowX:node.overflowX,overflowY:node.overflowY});
 const flush=()=>{for(const [id,fn] of [...rafs]){rafs.delete(id);fn();}};
 try{
  const host=new Host(),edges=new ScrollEdges(host),list=new Node('.answer-scroll');host.nodes=[list];edges.attach();flush();
  assert.equal(list.dataset.scrollEdge,'');
  list.visible=true;Observer.instances.find(observer=>observer instanceof globalThis.ResizeObserver&&observer.targets.has(list)).callback([]);flush();
  assert.equal(list.dataset.scrollAxis,'y');assert.equal(list.dataset.scrollEdge,'end');
  list.scrollTop=200;list.dispatchEvent(new Event('scroll'));assert.equal(list.dataset.scrollEdge,'start');
  list.overflowY='visible';list.dispatchEvent(new Event('scroll'));assert.equal(list.dataset.scrollEdge,undefined);
  list.overflowY='auto';list.dispatchEvent(new Event('scroll'));assert.equal(list.dataset.scrollEdge,'start');
  const replacement=new Node('.answer-scroll',true);host.nodes=[replacement];edges.mutations.callback([]);flush();
  assert.equal(list.dataset.scrollEdge,undefined);assert.equal(replacement.dataset.scrollEdge,'end');
  const hours=new Node('weather-hours',true);host.nodes=[hours];edges.mutations.callback([]);flush();
  assert.equal(hours.dataset.scrollAxis,'x');assert.equal(hours.dataset.scrollEdge,'end');
  hours.scrollLeft=150;hours.dispatchEvent(new Event('scroll'));assert.equal(hours.dataset.scrollEdge,'start end');
  hours.scrollLeft=300;hours.dispatchEvent(new Event('scroll'));assert.equal(hours.dataset.scrollEdge,'start');
  hours.scrollWidth=hours.clientWidth;hours.dispatchEvent(new Event('scroll'));assert.equal(hours.dataset.scrollEdge,'');
  edges.detach();assert.equal(hours.dataset.scrollEdge,undefined);assert.equal(hours.dataset.scrollAxis,undefined);
  assert.equal(Observer.instances.filter(observer=>observer instanceof globalThis.ResizeObserver).at(-1).disconnected,true);
 }finally{
  for(const [name,value] of Object.entries(original)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}
 }
});
