// docs/MOTION.md PR 4: one reduced-motion source in CSS, shared keyframes, loops that last as long as their state,
// one alarm pulse and no layout-property animation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mirrorReducedMotion,writeMotionAttribute} from '../../podvoice/gatekeeper/static/podview/ui/motion.js';
import * as gestures from '../../podvoice/gatekeeper/static/podview/ui/gestures.js';
import {stylesheetSources} from '../../scripts/build-assets.mjs';

const dir=new URL('../../podvoice/gatekeeper/static/podview/',import.meta.url);
const read=name=>readFileSync(new URL(name,dir),'utf8');
const sources=stylesheetSources.map(name=>[name,read(name)]);
const bundled=read('podview.css');
// Every declaration of a property in the bundled stylesheet.
const declarations=(css,property)=>[...css.matchAll(new RegExp(`(?:^|[;{\\s])${property}\\s*:([^;}]*)`,'g'))]
 .map(m=>m[1].trim());
const keyframes=css=>Object.fromEntries([...css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)]
 .map(m=>[m[1],m[2]]));

test('CSS asks only :root[data-pv-motion=reduced] for reduced motion',()=>{
 for(const [name,css] of sources){
  assert.doesNotMatch(css,/prefers-reduced-motion/,`${name} queries the media feature itself`);
  assert.doesNotMatch(css,/\[data-motion=["']?reduced/,`${name} asks the host attribute itself`);
 }
 assert.ok((bundled.match(/:root\[data-pv-motion=reduced\]/g)||[]).length>=80);
 assert.doesNotMatch(bundled,/:root\[data-pv-motion=reduced\]\s+:root/,'no doubled root prefix');
});

test('the shadow-scoped workshop sheet asks its host mirror, since :root is not visible there',()=>{
 const legacy=read('ui/legacy-components.css');
 assert.doesNotMatch(legacy,/prefers-reduced-motion/);
 assert.match(legacy,
  /:host\(\[data-pv-motion=reduced\]\) \*,[^{}]*\{animation:none!important;transition:none!important/);
 assert.match(read('ui/components.js'),/mirrorReducedMotion\(this,this\)/);
});

function mirrorFixture({matches=false}={}){
 const listeners=new Set(),media={matches,addEventListener:(type,fn)=>listeners.add(fn),
  removeEventListener:(type,fn)=>listeners.delete(fn)};
 const observers=[];
 class Observer{constructor(callback){this.callback=callback;observers.push(this);}
  observe(node,options){this.node=node;this.options=options;}disconnect(){this.disconnected=true;}}
 const root={dataset:{}},view={matchMedia:()=>media,MutationObserver:Observer};
 const host={dataset:{},closest:()=>null,getRootNode:()=>({}),ownerDocument:{documentElement:root,defaultView:view}};
 return {media,listeners,observers,root,host};
}

test('the mirror writes data-pv-motion and follows the system preference while nothing animates',()=>{
 const f=mirrorFixture(),mirror=mirrorReducedMotion(f.host);
 assert.equal(f.root.dataset.pvMotion,'full');assert.equal(f.listeners.size,1);
 f.media.matches=true;for(const fn of f.listeners)fn();
 assert.equal(f.root.dataset.pvMotion,'reduced');
 mirror.dispose();assert.equal(f.listeners.size,0);assert.equal(f.observers[0].disconnected,true);
});

test('the mirror follows the host data-motion attribute (library preview) without a cancel',()=>{
 const f=mirrorFixture(),mirror=mirrorReducedMotion(f.host);
 assert.deepEqual(f.observers[0].options,{attributes:true,attributeFilter:['data-motion']});
 assert.equal(f.observers[0].node,f.host);
 f.host.dataset.motion='reduced';f.observers[0].callback([]);assert.equal(f.root.dataset.pvMotion,'reduced');
 f.host.dataset.motion='normal';f.observers[0].callback([]);assert.equal(f.root.dataset.pvMotion,'full');
 mirror.dispose();
});

test('a shadow host can be its own mirror target and an unchanged value is not rewritten',()=>{
 const f=mirrorFixture({matches:true});mirrorReducedMotion(f.host,f.host);
 assert.equal(f.host.dataset.pvMotion,'reduced');assert.equal(f.root.dataset.pvMotion,undefined);
 let writes=0;const target={dataset:new Proxy({},{set(t,k,v){writes++;t[k]=v;return true;}})};
 writeMotionAttribute(target,false);writeMotionAttribute(target,false);assert.equal(writes,1);
});

test('the product host and the library page install the mirror',()=>{
 assert.match(read('widget-view.js'),/this\.motionMirror\?\?=mirrorReducedMotion\(this\)/);
 assert.match(read('widget-view.js'),/disconnectedCallback\(\)\{this\.motionMirror\?\.dispose\(\)/);
 assert.match(read('library.js'),/^mirrorReducedMotion\(document\.documentElement\);$/m);
});

// The press circle (P3) is a Web Animation from ui/pressed-state.js, not a keyframes rule.
const SHARED=['pv-spin','pv-busy-in','pv-skeleton','pv-pulse','pv-eq','pv-enter-up','pv-tick','pv-page-in','pv-page-out'];
const WEATHER=['pv-weather-drift','pv-weather-glow','pv-weather-flash','pv-weather-mist'];
test('keyframes are consolidated to the shared set (toward the 13 of §3.11)',()=>{
 const names=Object.keys(keyframes(bundled)).sort();
 // pv-music-eq still paints three bars on one pseudo; it needs <i> markup before it can become pv-eq.
 // pv-shelf (MOTION.md §3.10.2, PR 11) scales shelf cards on a scroll-driven timeline where the engine has one.
 assert.deepEqual(names,[...SHARED,...WEATHER,'pv-music-eq','pv-shelf'].sort());
 assert.ok(names.length<=15,'13 of §3.11 plus pv-music-eq and pv-shelf');
 for(const removed of ['pv-advice-pending','music-control-ack','pv-connecting-sheen','music-refresh-ack',
  'timer-alarm-ring','pv-queue-eq','pv-control-pending','pv-music-play-pending','pv-press-circle'])
  assert.doesNotMatch(bundled,new RegExp(`\\b${removed}\\b`),removed);
});

test('the shared keyframes animate only opacity and individual transform properties',()=>{
 const frames=keyframes(bundled);
 for(const name of SHARED){
  const properties=[...frames[name].matchAll(/([a-z-]+)\s*:/g)].map(m=>m[1]);
  for(const property of properties)assert.ok(['opacity','rotate','scale','translate'].includes(property),
   `${name} animates ${property}`);
 }
 for(const [name,body] of Object.entries(frames)){
  if(name==='pv-music-eq')continue;
  assert.doesNotMatch(body,/(?:^|[{;])\s*(left|right|top|bottom|width|height|background-position|background-size)\s*:/,
   `${name} animates a layout or paint property`);
 }
});

test('loops last while their state lasts: no counted iterations',()=>{
 for(const value of declarations(bundled,'animation')){
  for(const item of value.split(/,(?![^(]*\))/)){
   const counts=item.replace(/var\([^)]*\)|calc\([^)]*\)|linear\([^)]*\)|cubic-bezier\([^)]*\)/g,'')
    .split(/\s+/).filter(token=>/^\d+(\.\d+)?$/.test(token));
   assert.ok(counts.every(count=>count==='1'),`counted loop in "${item.trim()}"`);
  }
 }
 for(const value of declarations(bundled,'animation-iteration-count'))assert.match(value,/^(1|infinite)$/);
});

test('the timer alarm runs one pulse, on its surface, and the hidden icon carries none',()=>{
 const loops=[...bundled.matchAll(/#timer-alert[^{}]*\{[^{}]*animation:[^;}]*infinite/g)].map(m=>m[0]);
 assert.equal(loops.length,1,loops.join('\n'));
 assert.match(loops[0],/\[data-pulse=true\]::before\{--pv-pulse-low:\.45;--pv-pulse-scale:1;\s*/);
 assert.match(loops[0],/animation:pv-pulse var\(--pv-dur-ambient\) var\(--pv-ease-inout\) infinite/);
 assert.doesNotMatch(bundled,/notice-icon::before\{animation/);
});

test('toggles move their thumb with transform, the queue EQ scales and the recipe dots never animate width',()=>{
 // The radio needle still slides on left: its position is a percentage of the scale, which translate cannot
 // express without new markup. It is the one remaining layout transition.
 const needle='left .5s cubic-bezier(.2,.9,.3,1)';
 assert.equal(declarations(bundled,'transition').filter(value=>value===needle).length,1);
 for(const value of declarations(bundled,'transition').filter(value=>value!==needle)){
  assert.doesNotMatch(value,/(?:^|,)\s*(left|right|top|bottom|width|height)\b/,`layout transition: ${value}`);
 }
 assert.match(bundled,/\.light-room-power\[aria-pressed=true\]::before\{\s*transform:translateX\(22px\)!important\}/);
 assert.match(bundled,/#screen-device-auto-dim\[aria-checked=true\]::after\{transform:translateX\(22px\)\}/);
 assert.match(bundled,/button\[role=switch\]\[aria-checked=true\]::before\{transform:translate\(26px,-50%\)\}/);
 assert.match(bundled,
  /\.queue-eq>i\{\s*display:block;width:4px;height:16px;[^}]*transform-origin:50% 100%;\s*animation:pv-eq 900ms/);
 // P9 (MOTION.md §3.10.3): the dots are a fixed pool drawn with transform and opacity from p; no width, no rebuild.
 assert.doesNotMatch(bundled,/\[data-recipe-explore-dots\]>i[^{]*\{[^}]*(transition|[^-]width:28px)/);
});

test('dead motion is gone and live motion stays',()=>{
 assert.equal('transitionContent' in gestures,false);
 // A touch defers the hold to the next render, so the press itself reads and writes no layout.
 assert.match(read('ui/screen-lifecycle.js'),/host\.motion\?\.deferHold\?\.\(\)/);
 assert.match(read('widget-view.js'),/render\(\)\{[^]*?this\.motion\?\.applyDeferredHold\(\)/);
 assert.doesNotMatch(read('ui/legacy-components.css'),/@keyframes ack|pulse-once/);
});
