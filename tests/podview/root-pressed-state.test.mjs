import test from 'node:test';
import assert from 'node:assert/strict';
import {attachPressedState,pressScale} from '../../podview/ui/pressed-state.js';

// P3 press (docs/MOTION.md): Web Animations on the pressed control only, on compositor properties only (scale,
// opacity, translate): no box-shadow, left, top, width or height. Springs are plain keyframes, not a linear() easing,
// because WebKit's Core Animation path does not accelerate linear(). The fake nodes have no classList,
// setAttribute or style, so any class, attribute or inline-style write would throw.
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({documentRoot=false,reduced=false}={}){
 const target=()=>({handlers:new Map(),addEventListener(n,f){this.handlers.set(n,f);},
  removeEventListener(n){this.handlers.delete(n);}});
 const win=target(),computed=[];
 win.getComputedStyle=node=>{computed.push(node);return {scale:'0.985'};};
 const doc=Object.assign(target(),{defaultView:win,nodeType:documentRoot?9:undefined,
  documentElement:{dataset:{pvMotion:reduced?'reduced':'full'}}});
 const surface=Object.assign(target(),{ownerDocument:doc});
 const node=(...tokens)=>{
  const set=new Set(tokens.length?tokens:['button']),animations=[];
  return {tokens:set,animations,disabled:false,attributes:new Map(),
   matches:selector=>selector.split(',').some(part=>set.has(part.trim())),
   getAttribute(name){return this.attributes.get(name)??null;},closest:()=>null,
   getBoundingClientRect:()=>({left:100,top:50,width:200,height:100}),
   animate(frames,options){
    let resolve,reject;const finished=new Promise((a,b)=>{resolve=a;reject=b;});finished.catch(()=>{});
    const animation={frames,options,playState:'running',currentTime:40,finished,
     cancel(){if(this.playState==='running')reject(new Error('cancel'));this.playState='idle';},
     finish(){if(this.playState!=='running')return;this.playState='finished';resolve(this);}};
    animations.push(animation);return animation;}};
 };
 const button=node('button'),cleanup=attachPressedState(surface);
 const root=documentRoot?doc:surface;
 const event=(patch={})=>({type:'pointerdown',pointerId:1,clientX:150,clientY:60,button:0,isPrimary:true,
  composedPath:()=>[{},button,surface],...patch});
 const running=n=>n.animations.filter(a=>a.playState==='running');
 const finishAll=n=>{for(const a of n.animations)a.finish();};
 return {win,doc,surface,root,button,node,cleanup,event,running,finishAll,computed};
}
const props=animation=>Object.keys(animation.frames[0]).filter(key=>key!=='offset');
const COMPOSITOR=new Set(['scale','opacity','translate']);
// A spring release: keyframes from `from` to 1 with offsets, linear easing between them, never past 1 when damped.
function assertSpring(animation,from){
 const values=animation.frames.map(frame=>Number(frame.scale)),offsets=animation.frames.map(frame=>frame.offset);
 assert.equal(values[0],from);assert.equal(values.at(-1),1);
 assert.deepEqual([offsets[0],offsets.at(-1)],[0,1]);
 assert(offsets.every((offset,i)=>i===0||offset>offsets[i-1]),'offsets rise');
 assert(animation.frames.length>8,'the spring is sampled, not a two-point tween');
 assert.equal(animation.options.easing,undefined,'linear between keyframes, which Core Animation accelerates');
 assert(animation.options.duration>300&&animation.options.duration<1000,String(animation.options.duration));
}

test('tiles .97, buttons .98, icons and flat surfaces none, reduced motion none',()=>{
 const f=fixture();
 assert.equal(pressScale(f.node('button','.pv-card')),.97);
 assert.equal(pressScale(f.node('button')),.98);
 assert.equal(pressScale(f.node('button','.round:not(.main-control)')),1);
 assert.equal(pressScale(f.node('button','[data-pv-press=flat]')),1);
 assert.equal(pressScale(f.node('button','.pv-card'),true),1);
 f.cleanup();
});

test('a card only scales (no overlay, shadow or colour) and springs back without overshoot; reduced dims it',async()=>{
 const f=fixture(),card=f.node('button','.pv-card'),path=()=>[card,f.surface];
 f.root.handlers.get('pointerdown')(f.event({composedPath:path}));
 assert.deepEqual(card.animations.map(props),[['scale']],'touch-down is one compositor animation');
 assert.deepEqual(card.animations[0].frames,[{scale:'1'},{scale:'0.97'}]);
 assert.deepEqual([card.animations[0].options.duration,card.animations[0].options.easing],[100,'cubic-bezier(.2,0,0,1)']);
 f.finishAll(card);f.win.handlers.get('pointerup')(f.event({type:'pointerup'}));
 const release=f.running(card);
 assert.deepEqual(release.map(props),[['scale']]);assertSpring(release[0],.97);
 assert(release[0].frames.every(frame=>Number(frame.scale)<=1),'critically damped: the spring never passes 1');
 f.finishAll(card);await flush();f.cleanup();
 const r=fixture({reduced:true}),still=r.node('button','.pv-card');
 r.root.handlers.get('pointerdown')(r.event({composedPath:()=>[still,r.surface]}));
 assert.deepEqual(still.animations.map(props),[['opacity']]);
 assert.deepEqual(still.animations[0].frames,[{opacity:1},{opacity:.8}]);
 r.cleanup();
});

test('down scales in --pv-dur-tap and dims at once; release springs back on Motion\'s quick spring',async()=>{
 const f=fixture();f.root.handlers.get('pointerdown')(f.event());
 const [scale,dim]=f.button.animations;
 assert.deepEqual(scale.frames,[{scale:'1'},{scale:'0.98'}]);
 assert.deepEqual([scale.options.duration,scale.options.fill],[100,'forwards']);
 assert.deepEqual(dim.frames,[{opacity:.84},{opacity:.84}]);
 f.finishAll(f.button);
 f.win.handlers.get('pointerup')(f.event({type:'pointerup'}));
 const release=f.running(f.button);
 assert.deepEqual(release.map(props),[['scale'],['opacity']]);
 assertSpring(release[0],.98);
 assert.deepEqual(release[1].frames,[{opacity:.84,offset:0}],'the dim fades to the control\'s own opacity');
 for(const animation of f.button.animations)assert(props(animation).every(key=>COMPOSITOR.has(key)));
 assert.deepEqual([release[1].options.duration,release[1].options.delay],[160,0]);
 f.finishAll(f.button);await flush();
 assert.equal(f.running(f.button).length,0,'press and release end together');
 assert.equal(f.button.animations.every(a=>a.playState==='idle'),true,'nothing is left behind');
 f.cleanup();
});

test('a tap released before the touch-down finished shows the whole press first',async()=>{
 const f=fixture();f.root.handlers.get('pointerdown')(f.event());
 f.win.handlers.get('pointerup')(f.event({type:'pointerup'}));
 const release=f.button.animations.slice(2);
 assert.deepEqual(release.map(props),[['scale'],['opacity']],'the release exists at once');
 assert.deepEqual(release.map(a=>a.options.delay),[60,60],'and starts when the 100 ms touch-down ends');
 assert.deepEqual(release[0].frames[0],{scale:'0.98',offset:0});
 f.cleanup();
});

test('a new press on a releasing control starts from where it is',async()=>{
 const f=fixture();f.root.handlers.get('pointerdown')(f.event());f.finishAll(f.button);
 f.win.handlers.get('pointerup')(f.event({type:'pointerup'}));
 f.root.handlers.get('pointerdown')(f.event());
 assert.deepEqual(f.computed,[f.button]);
 assert.deepEqual(f.running(f.button).map(a=>a.frames[0].scale??'dim'),['0.985','dim']);
 f.cleanup();
});

test('quiet controls dim further; flat surfaces only dim, with no ripple and no layout read',async()=>{
 const f=fixture(),quiet=f.node('button','[data-pv-press=quiet]'),flat=f.node('button','[data-pv-press=flat]');
 f.root.handlers.get('pointerdown')(f.event({composedPath:()=>[quiet,f.surface]}));
 assert.deepEqual(quiet.animations.map(props),[['scale'],['opacity']]);
 assert.equal(quiet.animations[1].frames[0].opacity,.64);
 f.win.handlers.get('pointerup')(f.event({type:'pointerup'}));
 let measured=false;flat.getBoundingClientRect=()=>{measured=true;return {};};
 f.root.handlers.get('pointerdown')(f.event({composedPath:()=>[flat,f.surface]}));
 assert.deepEqual(flat.animations.map(props),[['opacity']],'flat never shrinks');
 assert.equal(flat.animations.some(a=>a.options.pseudoElement),false,'no ripple pseudo-element');
 assert.equal(measured,false);
 f.finishAll(flat);f.win.handlers.get('pointerup')(f.event({type:'pointerup'}));
 assert.deepEqual(f.running(flat).map(a=>a.frames),[[{opacity:.84,offset:0}]]);
 for(const animation of flat.animations)assert(props(animation).every(key=>COMPOSITOR.has(key)));
 f.cleanup();
});

test('reduced motion keeps the dim and drops scale',()=>{
 const f=fixture({reduced:true}),flat=f.node('button','[data-pv-press=flat]');
 f.root.handlers.get('pointerdown')(f.event());
 assert.deepEqual(f.button.animations.map(props),[['opacity']]);
 f.root.handlers.get('pointerdown')(f.event({composedPath:()=>[flat,f.surface]}));
 assert.deepEqual(flat.animations.map(props),[['opacity']]);
 f.cleanup();
});

test('scroll drag, cancellation, lost capture, scroll, blur, background and cleanup end a press at once',async()=>{
 for(const reason of ['move','pointercancel','lostpointercapture','scroll','blur','background','cleanup']){
  const f=fixture();f.root.handlers.get('pointerdown')(f.event());
  if(reason==='move')f.root.handlers.get('pointermove')(f.event({type:'pointermove',clientY:80}));
  else if(reason==='cleanup')f.cleanup();
  else if(reason==='scroll')f.doc.handlers.get('scroll')();
  else if(reason==='background'){f.doc.hidden=true;f.doc.handlers.get('visibilitychange')();}
  else f.win.handlers.get(reason)(f.event({type:reason}));
  await flush();
  assert.equal(f.running(f.button).length,0,reason);assert.equal(f.button.animations.length,2,reason);
  f.cleanup();
 }
});

test('disabled, aria-disabled and inert controls never acknowledge',()=>{
 for(const denied of ['disabled','aria','inert']){
  const f=fixture();
  if(denied==='disabled')f.button.disabled=true;
  if(denied==='aria')f.button.attributes.set('aria-disabled','true');
  if(denied==='inert')f.button.closest=()=>({inert:true});
  f.root.handlers.get('pointerdown')(f.event());assert.equal(f.button.animations.length,0,denied);f.cleanup();
 }
});

test('secondary pointers cannot replace or cancel the primary press',async()=>{
 const f=fixture();f.root.handlers.get('pointerdown')(f.event());
 f.root.handlers.get('pointerdown')(f.event({pointerId:2,isPrimary:false}));
 f.win.handlers.get('pointercancel')(f.event({type:'pointercancel',pointerId:2}));
 assert.equal(f.running(f.button).length,2);f.cleanup();
});

test('Enter and Space press and release like a pointer; a repeat is ignored',async()=>{
 const f=fixture();
 f.root.handlers.get('keydown')(f.event({type:'keydown',key:'Enter',repeat:false}));
 assert.equal(f.button.animations.length,2);f.finishAll(f.button);
 f.root.handlers.get('keydown')(f.event({type:'keydown',key:'Enter',repeat:true}));
 assert.equal(f.button.animations.length,2);
 f.win.handlers.get('keyup')(f.event({type:'keyup',key:'Enter'}));await flush();
 assert.deepEqual(f.running(f.button).map(props),[['scale'],['opacity']]);
 f.cleanup();assert.equal(f.root.handlers.size,0);assert.equal(f.win.handlers.size,0);
});

test('native fields and sliders inside an interactive card keep their gesture',()=>{
 for(const kind of ['input','select','textarea']){
  const f=fixture(),field=f.node(kind);
  f.root.handlers.get('pointerdown')(f.event({composedPath:()=>[field,f.button,f.surface]}));
  assert.equal(f.button.animations.length,0,kind);f.cleanup();
 }
});

test('native disclosure summaries and delegated body-sibling controls share the same press owner',()=>{
 const f=fixture({documentRoot:true}),summary=f.node('summary');assert.equal(f.surface.handlers.size,0);
 f.doc.handlers.get('pointerdown')(f.event({composedPath:()=>[summary,f.doc]}));
 assert.equal(summary.animations.length,2);f.cleanup();assert.equal(f.doc.handlers.size,0);
});

test('a control whose transition is its feedback (data-pv-press=none, the Ro photo) shows no press',()=>{
 const f=fixture(),photo=f.node('button','[data-pv-press=none]');
 f.root.handlers.get('pointerdown')(f.event({composedPath:()=>[photo,f.surface]}));
 assert.equal(photo.animations.length,0);f.cleanup();
});
