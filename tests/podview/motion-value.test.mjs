// P5 value change (docs/MOTION.md §3.6): digits roll with direction, seconds stay still, progress ticks linear and
// user changes travel on the smooth spring. Reduced digits only fade, over --pv-dur-tap.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SceneMotion,DUR,valueDirection,rollingDigits,showValue,showProgress,springCurve,SPRING}
 from '../../podview/ui/motion.js';

const QUICK=springCurve(SPRING.quick);
class KeyframeEffect{get pseudoElement(){return null;}}
function dom(){
 const doc={defaultView:{KeyframeEffect},createElement:()=>new El(doc)};
 class El{
  constructor(owner){this.ownerDocument=owner;this.dataset={};this.children=[];this.text='';this.animations=[];
   this.writes=0;this.style=style();}
  get firstChild(){return this.children[0]??null;}
  get textContent(){return this.children.length?this.children.map(child=>child.textContent).join(''):this.text;}
  set textContent(value){this.writes++;this.children=[];this.text=String(value);}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.writes++;this.children=nodes;}
  getClientRects(){return [{}];}
  animate(frames,options){const animation={frames,options,cancelled:false,cancel(){this.cancelled=true;},
   finished:new Promise(()=>{})};this.animations.push(animation);return animation;}
 }
 return {doc,node:()=>new El(doc)};
}
function style(){const values=new Map();return {getPropertyValue:key=>values.get(key)??'',
 setProperty(key,value){values.set(key,value);},values};}
function motion({reduced=false}={}){
 return new SceneMotion({dataset:{motion:reduced?'reduced':'system'},ownerDocument:{documentElement:{dataset:{}}}});
}
const rolls=node=>node.children.map((slot,index)=>({index,slot,glyph:slot.firstChild})).filter(({slot,glyph})=>
 glyph.animations.length+slot.animations.length>0);

test('direction follows the sign of the change; a clock can force forward',()=>{
 assert.equal(valueDirection('18.09','18.10'),1);
 assert.equal(valueDirection('10:00','9:59'),-1);
 assert.equal(valueDirection('-3°','2°'),1);
 assert.equal(valueDirection('−2°','−3°'),-1);
 assert.equal(valueDirection('15°','15°'),0);
 assert.equal(valueDirection('—','15°'),0);
});

test('only changed digits roll, right-aligned, and the last `still` characters never do',()=>{
 assert.deepEqual(rollingDigits('18.09','18.10'),[3,4]);
 assert.deepEqual(rollingDigits('4:05','4:04',{still:2}),[]);
 assert.deepEqual(rollingDigits('4:00','3:59',{still:2}),[0]);
 assert.deepEqual(rollingDigits('10:00','9:59',{still:2}),[0]);
 assert.deepEqual(rollingDigits('9:59','10:00',{still:2}),[0,1]);
});

test('a minute change keeps the slots and rolls only the changed figures up on the quick spring',()=>{
 const {node}=dom(),clock=node(),m=motion();
 m.value(clock,'18.09',{direction:1});
 const slots=[...clock.children];
 assert.equal(clock.textContent,'18.09');assert.equal(rolls(clock).length,0,'the first value is drawn in place');
 m.value(clock,'18.09',{direction:1});assert.equal(rolls(clock).length,0,'an identical value does not restart');
 m.value(clock,'18.10',{direction:1});
 assert.deepEqual(clock.children,slots,'slots are kept');assert.equal(clock.textContent,'18.10');
 assert.deepEqual(rolls(clock).map(r=>r.index),[3,4]);
 for(const {slot,glyph}of rolls(clock)){
  const [into]=glyph.animations,[out]=slot.animations;
  assert.deepEqual(into.frames,[{opacity:0,transform:'translateY(30%)'},{opacity:1,transform:'none'}]);
  assert.equal(into.options.duration,QUICK.ms);assert.equal(into.options.easing,QUICK.easing);
  assert.equal(out.options.pseudoElement,'::before','the old figure leaves as ::before, nothing is cloned');
  assert.deepEqual(out.frames,[{opacity:1,transform:'none'},{opacity:0,transform:'translateY(-30%)'}]);
 }
 assert.equal(rolls(clock)[0].slot.dataset.pvWas,'0');assert.equal(rolls(clock)[1].slot.dataset.pvWas,'9');
});

test('a falling value rolls the other way and seconds change without motion',()=>{
 const {node}=dom(),count=node(),m=motion();
 m.value(count,'4:05',{still:2});m.value(count,'4:04',{still:2});
 assert.equal(count.textContent,'4:04');assert.equal(rolls(count).length,0,'seconds never roll');
 m.value(count,'4:00',{still:2});m.value(count,'3:59',{still:2});
 assert.deepEqual(rolls(count).map(r=>r.index),[0]);
 assert.deepEqual(rolls(count)[0].glyph.animations[0].frames[0],{opacity:0,transform:'translateY(-30%)'});
 const temperature=node();m.value(temperature,'15°');m.value(temperature,'14°');
 assert.deepEqual(rolls(temperature).map(r=>r.index),[1]);
 assert.equal(rolls(temperature)[0].glyph.animations[0].frames[0].transform,'translateY(-30%)');
});

test('words, a foreign write and a reroll are handled without stale slots',()=>{
 const {node}=dom(),count=node(),m=motion();
 m.value(count,'0:01');m.value(count,'Tiden er gået');
 assert.equal(count.children.length,0,'text with words is plain text');assert.equal(count.textContent,'Tiden er gået');
 m.value(count,'0:00');assert.equal(count.textContent,'0:00');assert.equal(rolls(count).length,0);
 count.textContent='9:00';m.value(count,'8:59');
 assert.equal(count.textContent,'8:59');assert.equal(rolls(count).length,0,'a node written by someone else restarts');
 m.value(count,'7:59');const first=rolls(count)[0].glyph.animations[0];m.value(count,'6:59');
 assert.equal(first.cancelled,true,'a new change of the same digit cancels the running roll');
});

test('reduced digits only fade over --pv-dur-tap; no pseudo roll',()=>{
 const {node}=dom(),clock=node(),m=motion({reduced:true});
 m.value(clock,'18.09',{direction:1});m.value(clock,'18.10',{direction:1});
 for(const {slot,glyph}of rolls(clock)){
  assert.deepEqual(glyph.animations[0].frames,[{opacity:0},{opacity:1}]);
  assert.equal(glyph.animations[0].options.duration,DUR.tap);assert.equal(slot.animations.length,0);
 }
 assert.equal(rolls(clock).length,2);
});

test('showValue rolls through a motion and writes plain text without one',()=>{
 const {node}=dom(),plain=node();showValue(null,plain,'12');assert.equal(plain.textContent,'12');
 const writes=plain.writes;showValue(undefined,plain,'12');assert.equal(plain.writes,writes);
 const calls=[];showValue({value:(...args)=>calls.push(args)},plain,'13',{still:2});
 assert.deepEqual(calls,[[plain,'13',{still:2}]]);
});

test('progress: ticks set linear over the interval, a user change marks the spring, equal values are not written',()=>{
 const ring={dataset:{},style:style()};
 showProgress(ring,'--progress','50',{source:'none'});
 assert.equal(ring.dataset.pvProgress,'none');assert.equal(ring.style.getPropertyValue('--progress'),'50');
 showProgress(ring,'--progress','49',{source:'tick',interval:1000});
 assert.equal(ring.dataset.pvProgress,'tick');
 assert.equal(ring.style.getPropertyValue('--pv-progress-interval'),'1000ms');
 showProgress(ring,'--progress','80',{source:'user'});assert.equal(ring.dataset.pvProgress,'user');
 showProgress(ring,'--progress','80',{source:'tick'});
 assert.equal(ring.dataset.pvProgress,'user','no change, no rewrite');
});

test('CSS: tick is linear over the tick, user is the smooth spring, reduced user is short and linear',()=>{
 const css=readFileSync(new URL('../../podview/ui-kit.css',import.meta.url),'utf8');
 const rule=(selector,body)=>assert(css.replace(/\s+/g,' ').includes(`${selector}{ ${body}}`)||
  css.replace(/\s+/g,' ').includes(`${selector}{${body}}`),`${selector}{${body}}`);
 const tick='transition:stroke-dasharray var(--pv-progress-interval,1000ms) linear';
 rule('[data-pv-progress=tick] .timer-progress',tick);
 rule('[data-pv-progress=user] .timer-progress','transition:stroke-dasharray var(--pv-spring-smooth)');
 // Progress is information: it stays continuous under the global reduced transition:none!important.
 rule(':root[data-pv-motion=reduced] [data-pv-progress=tick] .timer-progress',`${tick}!important`);
 rule(':root[data-pv-motion=reduced] [data-pv-progress=user] .timer-progress',
  'transition:stroke-dasharray var(--pv-dur-reduced) linear!important');
 assert.match(css,/\[data-pv-digit\]::before\{content:attr\(data-pv-was\);position:absolute;left:0;top:0;opacity:0;/);
});
