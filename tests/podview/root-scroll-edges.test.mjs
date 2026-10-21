import test from 'node:test';
import assert from 'node:assert/strict';
import {scrollEdgeState,ScrollEdges} from '../../podvoice/gatekeeper/static/podview/ui/scroll-edges.js';
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
 class Host extends EventTarget {constructor(){super();this.nodes=[];}querySelectorAll(selector){assert.ok(selector.includes('#weather-view'));return this.nodes;}}
 globalThis.ResizeObserver=Observer;globalThis.MutationObserver=Observer;
 globalThis.requestAnimationFrame=fn=>{const id=nextFrame++;rafs.set(id,fn);return id;};
 globalThis.cancelAnimationFrame=id=>rafs.delete(id);
 globalThis.getComputedStyle=node=>({scrollSnapType:node.snap,overflowX:node.overflowX,overflowY:node.overflowY});
 const flush=()=>{for(const [id,fn] of [...rafs]){rafs.delete(id);fn();}};
 try{
  const host=new Host(),dialog=new Host(),queue=new Node('#queue'),edges=new ScrollEdges(host),list=new Node('.answer-scroll');
  dialog.nodes=[queue];host.ownerDocument={getElementById:id=>id==='music-detail'?dialog:null};host.contains=()=>false;
  host.nodes=[list];edges.attach();flush();
  assert.ok(edges.mutations.targets.has(dialog));assert.ok(edges.resize.targets.has(dialog));
  assert.equal(queue.dataset.scrollEdge,'');
  assert.equal(list.dataset.scrollEdge,'');
  list.visible=true;Observer.instances.find(observer=>observer instanceof globalThis.ResizeObserver&&observer.targets.has(list)).callback([]);flush();
  assert.equal(list.dataset.scrollAxis,'y');assert.equal(list.dataset.scrollEdge,'end');
  list.scrollTop=200;list.dispatchEvent(new Event('scroll'));assert.equal(list.dataset.scrollEdge,'start');
  list.overflowY='visible';list.dispatchEvent(new Event('scroll'));assert.equal(list.dataset.scrollEdge,undefined);
  list.overflowY='auto';list.dispatchEvent(new Event('scroll'));assert.equal(list.dataset.scrollEdge,'start');
  const replacement=new Node('.answer-scroll',true);host.nodes=[replacement];edges.mutations.callback([]);flush();
  assert.equal(list.dataset.scrollEdge,undefined);assert.equal(replacement.dataset.scrollEdge,'end');
  const weather=new Node('#weather-view',true);host.nodes=[weather];edges.mutations.callback([]);flush();assert.equal(weather.dataset.scrollEdge,'end');weather.scrollTop=200;weather.dispatchEvent(new Event('scroll'));assert.equal(weather.dataset.scrollEdge,'start');
  const hours=new Node('weather-hours',true);host.nodes=[hours];edges.mutations.callback([]);flush();
  assert.equal(hours.dataset.scrollAxis,'x');assert.equal(hours.dataset.scrollEdge,'end');
  hours.scrollLeft=150;hours.dispatchEvent(new Event('scroll'));assert.equal(hours.dataset.scrollEdge,'start end');
  hours.scrollLeft=300;hours.dispatchEvent(new Event('scroll'));assert.equal(hours.dataset.scrollEdge,'start');
  hours.scrollWidth=hours.clientWidth;hours.dispatchEvent(new Event('scroll'));assert.equal(hours.dataset.scrollEdge,'');
  // Opening the native body-sibling dialog and adding queue rows both use this owner.
  queue.visible=true;edges.mutations.callback([]);flush();assert.equal(queue.dataset.scrollEdge,'end');
  queue.scrollTop=queue.scrollHeight-queue.clientHeight;queue.dispatchEvent(new Event('scroll'));assert.equal(queue.dataset.scrollEdge,'start');
  queue.scrollHeight=500;edges.mutations.callback([]);flush();assert.equal(queue.dataset.scrollEdge,'start end');
  queue.clientHeight=500;edges.resize.callback([]);flush();assert.equal(queue.dataset.scrollEdge,'');
  queue.clientHeight=100;edges.resize.callback([]);flush();assert.equal(queue.dataset.scrollEdge,'start end');
  queue.visible=false;edges.mutations.callback([]);flush();assert.equal(queue.dataset.scrollEdge,'');
  edges.detach();assert.equal(hours.dataset.scrollEdge,undefined);assert.equal(hours.dataset.scrollAxis,undefined);
  assert.equal(queue.dataset.scrollEdge,undefined);assert.equal(queue.dataset.scrollAxis,undefined);
  queue.visible=true;queue.dispatchEvent(new Event('scroll'));dialog.dispatchEvent(new Event('load'));
  assert.equal(queue.dataset.scrollEdge,undefined);assert.equal(rafs.size,0);
  assert.equal(Observer.instances.filter(observer=>observer instanceof globalThis.ResizeObserver).at(-1).disconnected,true);
 }finally{
  for(const [name,value] of Object.entries(original)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}
 }
});

test('scroll edge observation writes only a changed axis/edge and never deletes absent attributes',async()=>{
 const {ScrollEdges}=await import('../../podvoice/gatekeeper/static/podview/ui/scroll-edges.js'),previous=globalThis.getComputedStyle,writes=[];const dataset=new Proxy({}, {set:(target,key,value)=>{writes.push(['set',key,value]);target[key]=value;return true;},deleteProperty:(target,key)=>{writes.push(['delete',key]);delete target[key];return true;}});const node={dataset,classList:{contains:()=>false},clientHeight:100,scrollHeight:300,scrollTop:0,getClientRects:()=>[{}],overflow:'auto'};globalThis.getComputedStyle=node=>({scrollSnapType:'none',overflowY:node.overflow});
 try{const edges=new ScrollEdges({});edges.measure(node);assert.deepEqual(writes,[['set','scrollAxis','y'],['set','scrollEdge','end']]);writes.length=0;for(let i=0;i<20;i++)edges.measure(node);assert.equal(writes.length,0);node.scrollTop=200;edges.measure(node);assert.deepEqual(writes,[['set','scrollEdge','start']]);writes.length=0;node.overflow='visible';edges.measure(node);assert.deepEqual(writes,[['delete','scrollAxis'],['delete','scrollEdge']]);writes.length=0;for(let i=0;i<20;i++)edges.measure(node);assert.equal(writes.length,0);}finally{globalThis.getComputedStyle=previous;}
});

test('main response edges use eight pixels while horizontal/default edges retain their existing threshold',()=>{
 assert.equal(scrollEdgeState({position:8,viewport:100,content:300,threshold:8}),'end');
 assert.equal(scrollEdgeState({position:9,viewport:100,content:300,threshold:8}),'start end');
 assert.equal(scrollEdgeState({position:192,viewport:100,content:300,threshold:8}),'start');
 assert.equal(scrollEdgeState({position:2,viewport:100,content:300}),'start end');
});

test('navigation scan reads every scroll container before writing any fade attributes',async()=>{
 const {ScrollEdges}=await import('../../podvoice/gatekeeper/static/podview/ui/scroll-edges.js'),previous=globalThis.getComputedStyle,events=[];
 const makeNode=()=>({dataset:new Proxy({}, {set(target,key,value){events.push('write');target[key]=value;return true;}}),classList:{contains:()=>false},clientHeight:100,scrollHeight:300,scrollTop:0,getClientRects(){events.push('read');return [{}];},addEventListener(){},removeEventListener(){}});
 const nodes=Array.from({length:8},makeNode),edges=new ScrollEdges({querySelectorAll:()=>nodes});edges.resize={observe(){},unobserve(){}};
 globalThis.getComputedStyle=()=>{events.push('read');return {scrollSnapType:'none',overflowY:'auto'};};
 try{edges.scan();const firstWrite=events.indexOf('write');assert.equal(events.slice(firstWrite).includes('read'),false,'attribute changes must not invalidate layout before another container is measured');assert.ok(nodes.every(node=>node.dataset.scrollEdge==='end'));events.length=0;edges.scan();assert.equal(events.includes('write'),false,'unchanged navigation scan must not restyle fades');}finally{globalThis.getComputedStyle=previous;}
});

test('resize and image load reuse discovered containers while DOM changes rediscover them',async()=>{
 const {ScrollEdges}=await import('../../podvoice/gatekeeper/static/podview/ui/scroll-edges.js'),previous={getComputedStyle:globalThis.getComputedStyle,requestAnimationFrame:globalThis.requestAnimationFrame};let queries=0,frame;const node={dataset:{},classList:{contains:()=>false},clientHeight:100,scrollHeight:300,scrollTop:0,getClientRects:()=>[{}],addEventListener(){},removeEventListener(){}};
 const edges=new ScrollEdges({querySelectorAll(){queries++;return [node];}});edges.resize={observe(){},unobserve(){}};globalThis.getComputedStyle=()=>({scrollSnapType:'none',overflowY:'auto'});globalThis.requestAnimationFrame=fn=>{frame=fn;return 1;};const flush=()=>{const fn=frame;frame=null;fn();};
 try{edges.refresh();flush();assert.equal(queries,1);node.scrollHeight=100;edges.onChange();flush();assert.equal(queries,1);assert.equal(node.dataset.scrollEdge,'');node.scrollHeight=300;edges.onChange();edges.refresh(true);flush();assert.equal(queries,2,'structural invalidation must survive an already queued resize');assert.equal(node.dataset.scrollEdge,'end');}finally{Object.assign(globalThis,previous);}
});

test('nested detail scrolling reveals the shared top fade only after eight pixels',()=>{
 const previous=globalThis.getComputedStyle;globalThis.getComputedStyle=()=>({scrollSnapType:'none',overflowY:'auto'});
 try{const node={dataset:{},classList:{contains:()=>false},clientHeight:400,scrollHeight:1000,scrollTop:8,getClientRects:()=>[{}]},edges=new ScrollEdges({});edges.measure(node);assert.equal(node.dataset.scrollEdge,'end');node.scrollTop=9;edges.measure(node);assert.equal(node.dataset.scrollEdge,'start end');node.scrollTop=592;edges.measure(node);assert.equal(node.dataset.scrollEdge,'start');}finally{globalThis.getComputedStyle=previous;}
});
