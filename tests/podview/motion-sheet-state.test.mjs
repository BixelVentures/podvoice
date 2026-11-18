// docs/MOTION.md PR 5: P2 sheet/dialog in and out (§3.3) and P6 button state (§3.7).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createKitComponent,runKitButtonAction,setKitButtonState}
 from '../../podvoice/gatekeeper/static/podview/ui/kit.js';
import {SceneMotion,springBezier,SPRING,DUR} from '../../podvoice/gatekeeper/static/podview/ui/motion.js';

const dir=new URL('../../podvoice/gatekeeper/static/podview/',import.meta.url);
const read=name=>readFileSync(new URL(name,dir),'utf8');
const css=read('podview.css');
// Every fragment appears in order in the text, whitespace-insensitive.
const inOrder=(text,fragments,label)=>{
 const flat=text.replace(/\s+/g,' ');let at=0;
 for(const fragment of fragments){const next=flat.indexOf(fragment,at);assert.ok(next>=0,`${label}: ${fragment}`);
  at=next+fragment.length;}
};
// The body of the one rule with exactly this selector.
const rule=selector=>{
 const at=css.indexOf(selector+'{');assert.ok(at>=0,`rule ${selector}`);
 return css.slice(at+selector.length+1,css.indexOf('}',at)).replace(/\s+/g,' ');
};

class Element extends EventTarget{
 constructor(tag){super();this.tagName=tag.toUpperCase();this.className='';this.attributes=new Map();
  this.children=[];this.dataset={};if(this.tagName==='BUTTON')this.disabled=false;}
 setAttribute(name,value){this.attributes.set(name,String(value));
  if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);}
 getAttribute(name){return this.attributes.get(name)??null;}
 append(...nodes){this.children.push(...nodes);}
}
const document={createElement:tag=>new Element(tag)};
const button=()=>createKitComponent('button',{document,text:'Opdater liste'});

test('P6: busy at once, done only for a confirmed outcome, unknown back to idle',async()=>{
 const node=button();let release;
 const run=runKitButtonAction(node,()=>new Promise(done=>{release=done;}));
 assert.equal(node.getAttribute('aria-busy'),'true');assert.equal(node.dataset.pvState,'busy');
 release(true);assert.equal(await run,true);
 assert.equal(node.getAttribute('aria-busy'),'false');assert.equal(node.dataset.pvState,'done');
 await runKitButtonAction(node,async()=>'ok');
 assert.equal(node.dataset.pvState,undefined,'an unconfirmed result is never shown as done');
 await runKitButtonAction(node,async()=>({rooms:3}),{confirmed:result=>result.rooms>0});
 assert.equal(node.dataset.pvState,'done','the owner decides what confirms');
});

test('P6: a failure ends in error with no tick, and the next tap starts clean',async()=>{
 const node=button();
 await runKitButtonAction(node,async()=>{throw new Error('netværk');});
 assert.equal(node.dataset.pvState,'error');assert.equal(node.dataset.state,'error');
 assert.equal(node.getAttribute('aria-busy'),'false');
 let seen;await runKitButtonAction(node,()=>{seen={...node.dataset};return true;});
 assert.equal(seen.state,undefined);assert.equal(seen.pvState,'busy');assert.equal(node.dataset.pvState,'done');
 assert.throws(()=>setKitButtonState(node,'shake'),TypeError);
});

test('P6: the spinner and the icon it replaces wait 400 ms; the spinner spins at 900 ms',()=>{
 inOrder(css,['--pv-busy-delay:400ms;',
  '--pv-busy-spinner:pv-busy-in var(--pv-dur-quick) var(--pv-ease-out) var(--pv-busy-delay) both,',
  'pv-spin 900ms linear var(--pv-busy-delay) infinite;',
  '--pv-busy-yield:pv-busy-in var(--pv-dur-quick) var(--pv-ease-in) var(--pv-busy-delay) reverse both}'],'busy');
 assert.ok(css.includes('@keyframes pv-busy-in{from{opacity:var(--pv-busy-from,0)}}'));
 for(const selector of ['.pv-kit.pv-kit-button[aria-busy=true]:not(.result-play)::after',
  '.pv-kit:is(.pv-kit-button,.pv-kit-chip,.pv-kit-toggle,.pv-kit-tile)'+
   '[data-feedback=progress][aria-busy=true]::after',
  '.pv-kit-choice-group[data-choice-variant=level][aria-busy=true]>legend::after'])
  assert.match(rule(selector),/animation:var\(--pv-busy-spinner\)/,selector);
 // No busy kit part disappears at once: the icon and label hand over to the spinner after the same delay.
 const busyHidden=[...css.matchAll(/([^{}]*\.pv-kit[^{}]*\[aria-busy=true\][^{}]*)\{[^{}]*visibility:hidden/g)]
  .map(m=>m[1].trim()).filter(selector=>!/result-play|queue|radio|vehicle/.test(selector));
 assert.deepEqual(busyHidden,[]);
 assert.ok((css.match(/animation:var\(--pv-busy-yield\)!important/g)||[]).length>=5);
});

test('P6: done ticks 1 → 1.04 → 1 on the snappy spring; error fades colour in base; reduced drops motion',()=>{
 assert.match(css,/@keyframes pv-tick\{30%\{scale:1\.04\}\}/);
 assert.equal(rule('.pv-kit[data-pv-state=done]'),'animation:pv-tick var(--pv-spring-snappy)');
 assert.equal(rule(':root[data-pv-motion=reduced] .pv-kit[data-pv-state=done]'),'animation:none');
 const error=rule('body :is(button,a[href],summary,[role=button]).pv-kit[data-pv-state=error]');
 assert.match(error,/background-color var\(--pv-dur-base\) var\(--pv-ease-out\)/);
 assert.doesNotMatch(css,/@keyframes pv-shake|translate[XY]?\(-?\d+px\)[^}]*\[data-pv-state=error\]/);
 inOrder(css,[':root[data-pv-motion=reduced]{--pv-busy-spinner:',
  'pv-busy-in var(--pv-dur-reduced) linear var(--pv-busy-delay) both}'],'reduced spinner');
});

test('P2 sheet: in 24px on the smooth spring with a base fade, out 16px in quick accelerating away',()=>{
 inOrder(rule('dialog'),['opacity:0;translate:0 16px;',
  'transition:opacity var(--pv-dur-quick) var(--pv-ease-in),translate var(--pv-dur-quick) var(--pv-ease-in),',
  'display var(--pv-dur-quick) allow-discrete,overlay var(--pv-dur-quick) allow-discrete'],'out');
 inOrder(rule('dialog[open]'),['opacity:1;translate:none;',
  'transition:opacity var(--pv-dur-base) var(--pv-ease-out),translate var(--pv-spring-smooth),'],'in');
 assert.ok(css.includes('@starting-style{dialog[open]{opacity:0;translate:0 24px}dialog[open]::backdrop{opacity:0}}'));
 inOrder(rule('dialog[open]::backdrop'),['transition:opacity var(--pv-dur-base) var(--pv-ease-out)'],'backdrop in');
 inOrder(rule('dialog::backdrop'),['transition:opacity var(--pv-dur-quick) var(--pv-ease-in)'],'backdrop out');
 inOrder(rule(':root[data-pv-motion=reduced] dialog,:root[data-pv-motion=reduced] dialog[open]'),
  ['translate:none;','transition:opacity var(--pv-dur-reduced) linear,'],'reduced');
 // No dialog pins translate any more, so every sheet can move.
 assert.doesNotMatch(css,/dialog[^{}]*\{[^{}]*translate:none!important/);
});

test('P2 alert, bar and toast variants follow their rows in §3.3',()=>{
 inOrder(rule('dialog#timer-alert'),['opacity:0;scale:.98;',
  'transition:opacity var(--pv-dur-quick) var(--pv-ease-in),scale var(--pv-dur-quick) var(--pv-ease-in),'],'alert out');
 inOrder(rule('dialog#timer-alert[open]'),['opacity:1;scale:none;',
  'transition:opacity var(--pv-dur-quick) var(--pv-ease-out),scale var(--pv-spring-snappy),'],'alert in');
 assert.ok(css.includes('@starting-style{dialog#timer-alert[open]{opacity:0;scale:.94}}'));
 inOrder(css,['.robot-sticky{position:fixed!important;',
  'transition:transform var(--pv-spring-smooth),opacity var(--pv-dur-base) var(--pv-ease-out),visibility 0s}',
  '.robot-sticky[data-shown=false]{transform:translateY(-100%);',
  'transition:transform var(--pv-dur-quick) var(--pv-ease-in), opacity var(--pv-dur-quick) var(--pv-ease-in),',
  'visibility 0s var(--pv-dur-quick)}'],'bar');
 inOrder(css,['#svar-today>.svar-today-new.svar-today-new{',
  '--pv-enter-y:-12px;--pv-enter-scale:.96;animation:pv-enter-up var(--pv-spring-snappy) backwards}'],'toast pill');
});

test('P2 toast: the feedback line enters from 8px on the snappy spring and leaves with a quick fade',()=>{
 const previous=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:false});
 try{
  const host={dataset:{},isConnected:true,ownerDocument:{documentElement:{dataset:{}}}};
  const motion=new SceneMotion(host),calls=[];
  const node={hidden:true,dataset:{},textContent:'Sendt',getClientRects(){return this.hidden?[]:[{}];},
   animate(frames,options){const a={frames,options,finished:new Promise(()=>{}),cancel(){}};calls.push(a);return a;}};
  motion.feedback(node,true);
  const snappy=springBezier(SPRING.snappy);
  assert.equal(calls[0].options.duration,snappy.ms);assert.equal(calls[0].options.easing,snappy.easing);
  assert.deepEqual(calls[0].frames[0],{opacity:0,transform:'translateY(8px)',offset:0});
  assert.deepEqual(calls[0].frames[1],{opacity:1,offset:.75});
  motion.feedback(node,false);
  assert.equal(calls[1].options.duration,DUR.quick);assert.equal(calls[1].options.easing,'cubic-bezier(.4,0,1,1)');
  motion.cancel();
 }finally{globalThis.matchMedia=previous;}
});
