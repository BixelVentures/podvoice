// Motion tokens (docs/MOTION.md §3.1, §3.11). Four durations, three easings and the springs.
// scripts/gen-motion-tokens.mjs writes the CSS custom properties in ui-kit.css from these values.
import {PageLayer} from './page-motion.js';
import {RoLayer} from './ro-motion.js';
export const DUR=Object.freeze({tap:100,quick:160,base:240,ambient:1400,reduced:150});
export const SPRING=Object.freeze({
 quick:Object.freeze({duration:.30,bounce:0}),
 smooth:Object.freeze({duration:.45,bounce:0}),
 snappy:Object.freeze({duration:.40,bounce:.15}),
 flick:Object.freeze({duration:.50,bounce:.20}),
});
export const EASE=Object.freeze({
 out:'cubic-bezier(.2,0,0,1)',in:'cubic-bezier(.4,0,1,1)',inout:'cubic-bezier(.45,0,.55,1)',
});

// Apple's duration/bounce model with mass 1: k=(2π/duration)², ζ=1−bounce, c=2ζω.
export function springParams({duration,bounce=0}){
 const omega=2*Math.PI/duration,zeta=1-bounce;
 return {k:omega*omega,c:2*zeta*omega,zeta,omega};
}
// Normalised step response from 0 to 1, starting at rest. t in seconds.
function stepResponse(spec){
 const {omega,zeta}=springParams(spec);
 if(zeta>=1)return t=>1-Math.exp(-omega*t)*(1+omega*t);
 const damped=omega*Math.sqrt(1-zeta*zeta);
 return t=>1-Math.exp(-zeta*omega*t)*(Math.cos(damped*t)+(zeta*omega/damped)*Math.sin(damped*t));
}
// Last time the response is further than eps from rest, sampled every 0.5 ms for up to 5 s.
function settleTime(x,eps=.001){
 let last=0;
 for(let t=0;t<5;t+=.0005)if(Math.abs(x(t)-1)>eps)last=t;
 return last;
}
// Ramer–Douglas–Peucker on the sampled curve, so linear() stays within the tolerance.
function simplify(values,times,tolerance){
 const keep=[0,values.length-1];
 const split=(i,j)=>{
  let best=-1,index=-1;
  for(let k=i+1;k<j;k++){
   const line=values[i]+(values[j]-values[i])*(times[k]-times[i])/(times[j]-times[i]);
   const error=Math.abs(line-values[k]);
   if(error>best){best=error;index=k;}
  }
  if(best>tolerance){keep.push(index);split(i,index);split(index,j);}
 };
 split(0,values.length-1);
 return keep.sort((a,b)=>a-b);
}
const trimNumber=(value,digits)=>value.toFixed(digits).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
// CSS linear() approximation of a spring plus its settle time (to 0.1 %), which is the CSS duration.
export function springCurve(spec,{tolerance=.004}={}){
 const x=stepResponse(spec),settle=settleTime(x),samples=600;
 const times=Array.from({length:samples+1},(_,i)=>settle*i/samples),values=times.map(x);
 values[samples]=1;
 const points=simplify(values,times,tolerance).map(i=>{
  const value=trimNumber(values[i],3);
  return i===0||i===samples?value:`${value} ${trimNumber(100*times[i]/settle,1)}%`;
 });
 return {easing:`linear(${points.join(', ')})`,ms:Math.round(settle*1000)};
}

// Reduced motion has one source (docs/MOTION.md §3.0 rule 6): the system preference, or the node or an
// ancestor (across shadow roots) marked data-motion=reduced. Pass a captured MediaQueryList to reuse it.
export const REDUCED_MOTION_QUERY='(prefers-reduced-motion: reduce)';
export function reducedMotionQuery(view=globalThis){return view?.matchMedia?.(REDUCED_MOTION_QUERY)??null;}
export function isReduced(node,media=reducedMotionQuery(node?.ownerDocument?.defaultView||globalThis)){
 if(media?.matches===true)return true;
 for(let n=node,depth=0;n&&depth<32;n=n.getRootNode?.()?.host,depth++){
  if(n.dataset?.motion==='reduced'||n.closest?.('[data-motion="reduced"]'))return true;
 }
 return false;
}
// The one writer of data-pv-motion (§3.0 rule 6). CSS asks only :root[data-pv-motion=reduced]; a shadow tree,
// which cannot see :root, asks :host([data-pv-motion=reduced]) on its host instead.
export function writeMotionAttribute(target,reduced){
 const value=reduced?'reduced':'full';
 if(target?.dataset&&target.dataset.pvMotion!==value)target.dataset.pvMotion=value;
 return reduced;
}
// Keeps target's data-pv-motion equal to isReduced(source) when the system preference or source's data-motion
// changes, also while nothing animates. Returns {sync, dispose}.
export function mirrorReducedMotion(source,target=source?.ownerDocument?.documentElement??source){
 const view=source?.ownerDocument?.defaultView||globalThis,media=reducedMotionQuery(view);
 const sync=()=>writeMotionAttribute(target,isReduced(source,media));
 sync();media?.addEventListener?.('change',sync);
 const Observer=view.MutationObserver,observer=typeof Observer==='function'?new Observer(sync):null;
 observer?.observe(source,{attributes:true,attributeFilter:['data-motion']});
 return {sync,dispose(){media?.removeEventListener?.('change',sync);observer?.disconnect();}};
}

const SNAPPY=springCurve(SPRING.snappy),SMOOTH=springCurve(SPRING.smooth),QUICK=springCurve(SPRING.quick);
// P5 digits (docs/MOTION.md §3.6). A value whose text is figures with separators, signs and units rolls; anything
// with words is plain text. The sign of the change comes from the figures: up rolls the old figure up and away and
// brings the new one from below; down is the reverse.
const DIGIT_TEXT=/^[\d\s.,:%°CF+\-\u2212]*\d[\d\s.,:%°CF+\-\u2212]*$/;
const isDigit=char=>char>='0'&&char<='9';
export function valueDirection(previous,next){
 const read=text=>{const figures=String(text).replace(/\D/g,'');if(!figures)return NaN;
  return (/^\s*[-\u2212]/.test(text)?-1:1)*Number(figures);};
 const a=read(previous),b=read(next);
 return Number.isFinite(a)&&Number.isFinite(b)&&a!==b?Math.sign(b-a):0;
}
// Which characters roll: digits that changed, right-aligned so 9:59 -> 10:00 keeps its columns, outside the last
// `still` characters (seconds change without motion). Index into `next`.
export function rollingDigits(previous,next,{still=0}={}){
 const changed=[],shift=next.length-previous.length;
 for(let index=0;index<next.length-still;index++){
  const before=previous[index-shift];
  if(isDigit(next[index])&&before!==next[index])changed.push(index);
 }
 return changed;
}
// Shared by views that may run without a SceneMotion (fixtures): roll when there is one, else plain text.
export function showValue(motion,node,text,options){
 if(!node)return;
 if(typeof motion?.value==='function'){motion.value(node,text,options);return;}
 if(node.textContent!==text)node.textContent=text;
}
// P5 progress: a tick runs linear over its interval so the ring never stops or jumps; a user change (or one from
// another app) travels on the smooth spring; the first value is drawn in place. CSS reads data-pv-progress.
export function showProgress(node,property,value,{source='none',interval=1000}={}){
 if(!node?.style)return;
 const text=String(value);if(node.style.getPropertyValue(property)===text)return;
 if(node.dataset&&node.dataset.pvProgress!==source)node.dataset.pvProgress=source;
 const ms=`${Math.max(0,Math.round(interval))}ms`;
 if(source==='tick'&&node.style.getPropertyValue('--pv-progress-interval')!==ms)
  node.style.setProperty('--pv-progress-interval',ms);
 node.style.setProperty(property,text);
}
const TOAST_IN=[{opacity:0,transform:'translateY(8px)',offset:0},{opacity:1,offset:.75},
 {opacity:1,transform:'none',offset:1}];
// Layout offsets exclude our active FLIP transform. Animation progress is not a new layout.
const resourceLayout=node=>{if(typeof node.offsetLeft!=='number')return null;const values=[];for(let n=node,depth=0;n&&depth<64;n=n.offsetParent,depth++)values.push(n,n.offsetLeft,n.offsetTop,n.offsetWidth,n.offsetHeight);return values;};
const sameLayout=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((value,index)=>value===b[index]);
// One animation owner per element. Read its visible position before cancelling;
// retarget from there, never combine old transforms with a new layout measurement.
export class SceneMotion {
 constructor(host){this.host=host;this.animations=new Map();this.playerPaint=new Map();this.scroll=new Map();this.nestedScroll=new Map();this.geometry=new Map();this.clocks=new WeakMap();this.feedbackTokens=new WeakMap();this.feedbackStates=new WeakMap();this.media=reducedMotionQuery();this.onPreference=()=>{if(this.reduced)this.cancel();};this.listening=false;this.syncRoot();
  // Where the last touch landed: Ro shrinks into it (Ro -> Hjem). Passive, on the host, so it lives as long as
  // the host.
  host.addEventListener?.('pointerdown',event=>{this.touch={x:event.clientX,y:event.clientY,at:event.timeStamp};},
   {capture:true,passive:true});
  // The Ro layer's cover is mounted and its photo decoded once, while the screen is idle.
  this.ro=new RoLayer(host);this.pages=new PageLayer(host);const view=host.ownerDocument?.defaultView;
  const idle=view?.requestIdleCallback?.bind(view)??(view?.setTimeout?(work=>view.setTimeout(work,500)):null);
  idle?.(()=>this.ro.prepare(),{timeout:2000});}
 get reduced(){return isReduced(this.host,this.media??null);}
 // CSS asks only :root[data-pv-motion=reduced]; this is the one writer. Written only when it changes.
 syncRoot(){
  return writeMotionAttribute(this.host.ownerDocument?.documentElement,this.reduced);
 }
 cancel(){this.syncRoot();for(const animation of this.animations.values())animation.cancel();this.animations.clear();for(const [node,saved]of this.playerPaint){if(saved.value===undefined)delete node.dataset.scenePlayerMoving;else node.dataset.scenePlayerMoving=saved.value;}this.playerPaint.clear();if(this.listening){this.media.removeEventListener('change',this.onPreference);this.listening=false;}}
 animate(node,frames,duration=280,options={}){
  this.animations.get(node)?.cancel();this.animations.delete(node);
  if(this.reduced&&!options.fadeReduced||(!options.visible&&!node?.getClientRects().length)||this.host.isConnected===false||typeof node.animate!=='function'){if(!this.animations.size)this.cancel();return null;}
  if(this.reduced){frames=frames.map(frame=>({opacity:frame.opacity??1}));duration=120;options={};}
  const animation=node.animate(frames,{duration,delay:options.delay||0,fill:'backwards',easing:options.easing||EASE.out});this.animations.set(node,animation);
  if(!this.listening&&this.media?.addEventListener){this.media.addEventListener('change',this.onPreference);this.listening=true;}
  animation.finished.catch(()=>{}).finally(()=>{if(this.animations.get(node)===animation){this.animations.delete(node);}if(!this.animations.size)this.cancel();});return animation;
 }
 // P5 value (docs/MOTION.md §3.6): one character per slot; only changed digits roll on the quick spring. The old
 // figure leaves as the slot's ::before (data-pv-was), so the text stays the value and nothing is cloned.
 // `direction` overrides the sign (a clock always moves on), `still` keeps the last characters still (seconds).
 // Reduced: changed digits fade in over --pv-dur-tap. Text with words, the first value and a node someone else
 // has written are drawn in place.
 value(node,text,{direction,still=0}={}){
  if(!node||typeof text!=='string')return;
  const previous=this.clocks.get(node),doc=node.ownerDocument;
  if(previous?.value===text&&node.textContent===text)return;
  if(!DIGIT_TEXT.test(text)||!doc?.createElement){
   this.clocks.delete(node);if(node.textContent!==text)node.textContent=text;return;}
  const known=previous&&node.textContent===previous.value?previous:null;
  let slots=known?.slots;
  if(!slots||slots.length!==text.length){
   slots=[...text].map(char=>{const slot=doc.createElement('span'),glyph=doc.createElement('span');
    slot.dataset.pvDigit='';glyph.textContent=char;slot.append(glyph);return slot;});
   node.replaceChildren(...slots);
  }
  this.clocks.set(node,{value:text,slots});
  if(!known)return;
  const changed=new Set(rollingDigits(known.value,text,{still})),sign=direction??valueDirection(known.value,text);
  const reduced=this.reduced,shift=text.length-known.value.length;
  for(let index=0;index<slots.length;index++){
   const slot=slots[index],glyph=slot.firstChild;
   if(glyph.textContent!==text[index])glyph.textContent=text[index];
   if(changed.has(index))this.roll(slot,known.value[index-shift]??'',sign||1,reduced);
  }
 }
 roll(slot,was,sign,reduced){
  const glyph=slot.firstChild;this.rolls??=new WeakMap();
  for(const animation of this.rolls.get(slot)||[])animation.cancel();
  if(typeof glyph?.animate!=='function'||!slot.getClientRects?.().length){this.rolls.delete(slot);return;}
  if(reduced){
   this.rolls.set(slot,[glyph.animate([{opacity:0},{opacity:1}],{duration:DUR.tap,easing:EASE.out})]);return;}
  const timing={duration:QUICK.ms,easing:QUICK.easing},animations=[glyph.animate(
   [{opacity:0,transform:`translateY(${sign*30}%)`},{opacity:1,transform:'none'}],{...timing,fill:'backwards'})];
  const effect=slot.ownerDocument?.defaultView?.KeyframeEffect,pseudo=!!effect&&'pseudoElement' in effect.prototype;
  if(was&&pseudo){
   slot.dataset.pvWas=was;
   const out=slot.animate([{opacity:1,transform:'none'},{opacity:0,transform:`translateY(${-sign*30}%)`}],
    {...timing,pseudoElement:'::before'});
   out.finished.then(()=>{if(slot.dataset.pvWas===was)delete slot.dataset.pvWas;},()=>{});
   animations.push(out);
  }
  this.rolls.set(slot,animations);
 }
 // P2 toast (§3.3): in from 8px on the snappy spring while the opacity reaches 1 at the quick duration
 // (eased progress .75 of the snappy curve is ~150 ms); out is a quick fade that accelerates away.
 feedback(node,visible){
  if(!node)return;const previous=this.feedbackStates.get(node),signature=JSON.stringify([node.dataset?.source||'',node.textContent||'']);
  if(previous?.visible===visible&&(!visible||previous.signature===signature))return;
  const token={};this.feedbackTokens.set(node,token);this.feedbackStates.set(node,{visible,signature});
  if(visible){
   node.hidden=false;
   if(previous?.visible)this.animate(node,[{opacity:.7},{opacity:1}],120,{fadeReduced:true});
   else this.animate(node,TOAST_IN,SNAPPY.ms,{fadeReduced:true,easing:SNAPPY.easing});
   return;
  }
  const animation=this.animate(node,[{opacity:1},{opacity:0}],DUR.quick,{fadeReduced:true,easing:EASE.in});if(!animation){node.hidden=true;return;}animation.finished.then(()=>{if(this.feedbackTokens.get(node)===token&&this.feedbackStates.get(node)?.visible===false)node.hidden=true;},()=>{if(this.feedbackTokens.get(node)===token&&this.feedbackStates.get(node)?.visible===false)node.hidden=true;});
 }
 // A touch defers the hold to the next render (applyDeferredHold), so a press reads and writes no layout: the
 // freeze is only needed once something is about to re-render under the finger.
 deferHold(){if(!this.geometry.size)this.holdPending=true;}
 applyDeferredHold(){if(!this.holdPending)return;this.holdPending=false;this.holdGeometry();}
 holdGeometry(){
  this.holdPending=false;if(this.geometry.size)return;
  // Freeze only existing layout boundaries; data and actions continue updating.
  // Resolved CSS height preserves fractions and excludes FLIP transforms.
  // Rounded offsetHeight would move later rows when the2s hold is released.
  const nodes=this.host.querySelectorAll('#now-view:not([hidden])>[data-overview-rank],.responses>section:not([hidden]):not(#now-view):not(#photo-view)>:not([hidden])');
  const snapshots=[];
  for(const node of nodes){if(!node.getClientRects().length||!node.style)continue;const resolved=typeof getComputedStyle==='function'?Number.parseFloat(getComputedStyle(node).height):NaN,height=Number.isFinite(resolved)&&resolved>0?resolved:node.offsetHeight;if(!height)continue;const saved={};for(const key of ['height','min-height','max-height'])saved[key]=[node.style.getPropertyValue(key),node.style.getPropertyPriority(key)];snapshots.push({node,height,saved});}
  for(const {node,height,saved}of snapshots){this.geometry.set(node,saved);for(const key of Object.keys(saved))node.style.setProperty(key,height+'px','important');}
 }
 releaseGeometry(animate=true){
  this.holdPending=false;if(!this.geometry.size)return;
  const before=new Map([...this.geometry.keys()].filter(n=>n.getClientRects().length).map(n=>[n,n.getBoundingClientRect()]));before.layouts=new Map([...before.keys()].map(n=>[n,resourceLayout(n)]));
  for(const [node,saved]of this.geometry)for(const [key,[value,priority]]of Object.entries(saved)){if(value)node.style.setProperty(key,value,priority);else node.style.removeProperty(key);}
  this.geometry.clear();if(animate)this.settleResources(before);
 }
 resources(){
  // Navigation owns the incoming pane; resource reconciliation is skipped
  // for that render, so avoid measuring the entire old grid a second time.
  if(this.host.lastRenderedFocus!==undefined&&this.host.lastRenderedFocus!==this.host.state?.focus)return new Map();
  if([this.host.state?.timer,...this.host.state?.extraTimers||[]].some(t=>t?.status==='done'))this.releaseGeometry(false);
  // The outer overview card owns its entire subtree. Measuring and animating
  // its preview/panel as well would apply the same grid displacement twice.
  const nodes=[...this.host.querySelectorAll('.resource-preview,.timer-panel,#now-view>[data-overview-rank]')].filter(n=>n.getClientRects().length).filter((node,index,all)=>!all.some(parent=>parent!==node&&parent.contains?.(node))),boxes=new Map(nodes.map(n=>[n,n.getBoundingClientRect()]));
  boxes.layouts=new Map(nodes.map(node=>[node,resourceLayout(node)]));return boxes;
 }
 settleResources(before,viewChanged=false){
  if(viewChanged||this.reduced){for(const node of before.keys()){this.animations.get(node)?.cancel();this.animations.delete(node);}if(!this.animations.size)this.cancel();return;}
  const candidates=[...new Set([...before.keys(),...this.host.querySelectorAll('.resource-preview,.timer-panel,#now-view>[data-overview-rank]')])],visible=new Set(candidates.filter(node=>node.getClientRects().length));
  const nodes=[...visible].filter((node,index,all)=>!all.some(parent=>parent!==node&&parent.contains?.(node)));
  for(const node of before.keys())if(!visible.has(node)){this.animations.get(node)?.cancel();this.animations.delete(node);}
  // Complete geometry reads first. A WAAPI start/cancel invalidates layout, so
  // measuring the next sibling after it would serialize a grid of forced layouts.
  const changes=nodes.filter(node=>!sameLayout(before.layouts?.get(node),resourceLayout(node)));
  const active=changes.filter(node=>this.animations.has(node));
  for(const node of active){this.animations.get(node).cancel();this.animations.delete(node);}
  const measured=changes.map(node=>({node,a:before.get(node),b:node.getBoundingClientRect()}));
  for(const {node,a,b}of measured){
   if(!a){this.animate(node,[{opacity:.45},{opacity:1}],120,{visible:true});continue;}
   const dx=a.x-b.x,dy=a.y-b.y;
   const timerResize=node.id==='timer-card'&&a.width>0&&a.height>0&&b.width>0&&b.height>0&&(Math.abs(a.width-b.width)+Math.abs(a.height-b.height)>.5);
   if(timerResize)this.animate(node,[{transformOrigin:'0 0',transform:`translate(${dx}px,${dy}px) scale(${a.width/b.width},${a.height/b.height})`},{transformOrigin:'0 0',transform:'none'}],240,{visible:true});
   // P4 reorder (docs/MOTION.md §3.5): the Hjem cards slide on the smooth spring.
   else if(Math.abs(dx)+Math.abs(dy)>.5)this.animate(node,[{transform:`translate(${dx}px,${dy}px)`},
    {transform:'none'}],SMOOTH.ms,{visible:true,easing:SMOOTH.easing});
  }
  if(!this.animations.size)this.cancel();
 }
 capture(focus,next){
  this.skipPage();this.releaseGeometry(false);
  const feed=this.host.querySelector('.responses');this.scroll.set(focus,feed.scrollTop);
  this.nestedScroll.set(focus,[...(feed.querySelectorAll?.('[data-scroll-axis],#weather-view,#vehicle-view,#radio-view,#device-view,#timers-view,#music-response,.answer-scroll')||[])].map(node=>[node,node.scrollTop,node.scrollLeft]));
  // Crossing Ro without the Ro layer (no Web Animations) carries the persistent player's geometry. The Ro layer
  // needs none (Ro's player fades), and ordinary details need no card, heading or page rectangle.
  const crossesRest=focus==='photo'||next==='photo';
  const player=crossesRest&&!this.layered()?
   this.host.querySelector('.player:not([hidden]),.player-empty:not([hidden])'):null;
  const box=player?.getBoundingClientRect();this.cancel();return box||null;
 }
 layered(){return this.ro.available();}
 get moving(){return this.ro.moving||this.pages.moving||!!this.pageTransition;}
 // Called first in every render: a render while Ro <-> Hjem or a page moves waits for the layer's own render, or
 // (Ro -> Hjem) is drawn under the Ro layer.
 holdRender(){return this.ro.holdRender()||this.pages.holdRender();}
 // P1 page (docs/MOTION.md §3.2). Push and pop run on live layers (ui/page-motion.js): the old page moves in the
 // next frame, the new one renders once off-screen and slides in, and the old stays painted until the end. Ro <->
 // active also runs on live layers (roPage()). Neither uses a view transition; hero() still does. Without Web
 // Animations, the page renders at once and enter() moves the pane.
 page(previous,next,{back=false,present}){
  this.skipPage();
  if(previous===next){present();return null;}
  if(!this.layered()){present();return null;}
  if(previous==='photo'||next==='photo')return this.roPage(next==='photo',present);
  if(!this.pages.available()){present();return null;}
  return this.layer(this.pages,run=>this.pages.go({back,reduced:this.reduced,...run}),present,{touch:false});
 }
 // Runs a live-layer transition: present() renders inside the layer's commit (enter() leaves the motion to it and
 // focus waits for it: afterPage). Ro: a touch anywhere finishes it at once (the cover hides what is under it).
 // Pages: a touch acts on what is under the finger, where it is drawn; jumping the pages to their end in the touch
 // would move the control away between touch-down and release and lose the tap. A new navigation finishes it.
 layer(owner,start,present,{touch=true}={}){
  const doc=this.host.ownerDocument;this.updatePending=true;
  const commit=()=>{this.inPageUpdate=true;try{present();}finally{this.inPageUpdate=false;this.flushAfterPage();}};
  const skip=()=>owner.finish();
  const done=()=>{if(touch)doc.removeEventListener('pointerdown',skip,{capture:true});};
  if(touch)doc.addEventListener('pointerdown',skip,{capture:true,passive:true});
  return start({present:commit,done});
 }
 // Ro <-> Hjem (ui/ro-motion.js). Hjem -> Ro grows from the moon button, Ro -> Hjem shrinks into the finger.
 roPage(toRo,present){
  const reduced=this.reduced;
  return this.layer(this.ro,run=>toRo?this.ro.open({point:this.moonPoint(),reduced,...run}):
   this.ro.close({point:this.touchPoint(),reduced,...run}),present);
 }
 // Hjem -> Ro starts at the moon button; without a visible one (Ro after idle, from a detail), at the middle.
 moonPoint(){
  const button=this.host.querySelector('#show-photo'),box=button&&!button.hidden?button.getBoundingClientRect():null;
  return box?.width?{x:box.left+box.width/2,y:box.top+box.height/2}:null;
 }
 touchPoint(){
  const view=this.host.ownerDocument.defaultView||globalThis;
  return this.touch&&typeof view.performance?.now==='function'&&view.performance.now()-this.touch.at<2000?
   {x:this.touch.x,y:this.touch.y}:null;
 }
 transitions(){
  const doc=this.host.ownerDocument;
  return typeof doc?.startViewTransition==='function'&&this.host.isConnected!==false&&
   !!doc.documentElement?.dataset;
 }
 // P7 hero (docs/MOTION.md §3.8): a push or pop page transition in which one element (source) flies to its
 // counterpart on the new page (target(), looked up after present()) on the smooth spring while everything else
 // moves as a page. The name pv-hero is on exactly one element at a time (two would abort the transition): on the
 // source while the old page is captured, then on the target. Without view transitions it renders at once, as page()
 // does. Reduced: no flight; the pages only fade.
 hero({source,target,present,back=false}){
  this.skipPage();
  if(!this.transitions()){present();return null;}
  return this.transition({kind:back?'pop':'push',present,hero:this.reduced?null:{source,target}});
 }
 // data-pv-nav names the kind for the stylesheet. It is the only write on the root, and the direction's custom
 // properties live on ::view-transition, so setting and clearing it restyles the root alone, not the whole page.
 transition({kind,present,hero}){
  const doc=this.host.ownerDocument,root=doc.documentElement,named=[];
  const name=node=>{node.style.viewTransitionName='pv-hero';named.push(node);};
  const from=hero?.source?.isConnected&&hero.source.getClientRects?.().length?hero.source:null;
  if(from)name(from);
  root.dataset.pvNav=kind;this.updatePending=true;
  const update=()=>{
   this.inPageUpdate=true;try{present();}finally{this.inPageUpdate=false;this.flushAfterPage();}
   if(!from)return;
   from.style.viewTransitionName='';
   const to=hero.target?.();
   if(to&&to!==from&&to.isConnected&&to.getClientRects().length)name(to);
  };
  const transition=doc.startViewTransition(update);
  this.pageTransition=transition;
  const skip=()=>transition.skipTransition();
  doc.addEventListener('pointerdown',skip,{capture:true,passive:true});
  for(const step of [transition.ready,transition.updateCallbackDone])step?.catch?.(()=>{});
  transition.finished.catch(()=>{}).finally(()=>{
   doc.removeEventListener('pointerdown',skip,{capture:true});
   for(const node of named)node.style.viewTransitionName='';
   if(this.pageTransition===transition){this.pageTransition=null;delete root.dataset.pvNav;}
  });
  return transition;
 }
 // Work that needs the new page (focus) runs after the page transition's update has rendered it, or at once when
 // no update is waiting. Focusing before the update would restyle the old page in the tap, ahead of the capture.
 afterPage(work){if(this.updatePending)(this.afterUpdate??=[]).push(work);else work();}
 flushAfterPage(){
  this.updatePending=false;const work=this.afterUpdate||[];this.afterUpdate=[];for(const run of work)run();
 }
 skipPage(){this.pageTransition?.skipTransition();this.ro?.finish();this.pages?.finish();}
 // Navigations whose caller works on the new page's DOM straight after dispatch (focus, scroll) render at once
 // and use the enter() motion instead of a view transition, whose update would run a frame later.
 enter(previous,next,oldPlayer,back=false){
  if(previous===next||this.host.isConnected===false)return;
  const feed=this.host.querySelector('.responses');feed.scrollTop=back?this.scroll.get(next)||0:0;
  if(back)for(const [node,top,left]of this.nestedScroll.get(next)||[]){node.scrollTop=top;node.scrollLeft=left;}
  // Inside a view transition the snapshots carry the move; only the scroll position is ours.
  if(this.inPageUpdate)return;
  const entering=next==='photo'?this.host.querySelector('#photo-view'):[...feed.children].find(node=>!node.hidden&&node.id!=='resource-rail'&&node.getClientRects().length);
  const crossesRest=previous==='photo'||next==='photo';
  if(this.reduced){if(entering)this.animate(entering,[{opacity:.65},{opacity:1}],120,{fadeReduced:true});return;}
  // Lateral: Ro and the active view stay in place while the pane fades over --pv-dur-base and the player
  // travels on the smooth spring. Push/pop without a view transition: the pane comes 48px on the smooth spring;
  // its opacity is full at eased .85 (~240 ms). It starts at .65, not 0, because the old page is already gone.
  if(entering){
   if(crossesRest)this.animate(entering,[{opacity:.65},{opacity:1}],DUR.base);
   else this.animate(entering,[{opacity:.65,transform:`translateX(${back?-48:48}px)`,offset:0},{opacity:1,offset:.85},
    {opacity:1,transform:'none',offset:1}],SMOOTH.ms,{easing:SMOOTH.easing});
  }
  if(previous!=='photo'&&next!=='photo')return;
  const player=this.host.querySelector('.player:not([hidden]),.player-empty:not([hidden])');
  if(!player||player.hidden||!oldPlayer?.width)return;
  const box=player.getBoundingClientRect(),dx=oldPlayer.x-box.x,dy=oldPlayer.y-box.y;
  if(Math.abs(dx)+Math.abs(dy)>.5){
   // A transformed, clipped backdrop-filter grid can split its backdrop into
   // compositor tiles. Keep its existing translucent material during travel,
   // and resume backdrop sampling only at the settled position.
   const saved={value:player.dataset.scenePlayerMoving};this.playerPaint.set(player,saved);player.dataset.scenePlayerMoving='true';
   const release=()=>{if(this.playerPaint.get(player)!==saved)return;if(saved.value===undefined)delete player.dataset.scenePlayerMoving;else player.dataset.scenePlayerMoving=saved.value;this.playerPaint.delete(player);};
   const animation=this.animate(player,[{opacity:1,transform:`translate(${dx}px,${dy}px)`},{opacity:1,transform:'none'}],
    SMOOTH.ms,{easing:SMOOTH.easing});
   if(animation)animation.finished.catch(()=>{}).finally(release);else release();
  }
 }
}
