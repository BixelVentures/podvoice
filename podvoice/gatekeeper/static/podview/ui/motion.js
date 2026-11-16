// Motion tokens (docs/MOTION.md §3.1, §3.11). Four durations, three easings and the springs.
// scripts/gen-motion-tokens.mjs writes the CSS custom properties in ui-kit.css from these values.
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
// iOS rubber-band: resistance grows with overscroll x and never reaches the dimension.
export function rubberBand(x,dimension,c=.55){return (1-1/(x*c/dimension+1))*dimension;}
// Distance a fling travels under UIScrollView deceleration (rate per ms).
export function project(velocityPxPerS,rate=.998){return velocityPxPerS/1000*rate/(1-rate);}

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

// Analytic damped spring with velocity handoff. Frame-rate independent and testable without a DOM.
// Values are in the caller's units; velocity is units per second; time comes from now() in ms.
export class Spring{
 constructor(spec,{value=0,velocity=0,onFrame,onRest,raf,now,precision=.001,restVelocity=.01}={}){
  this.params=springParams(spec);this.onFrame=onFrame;this.onRest=onRest;
  this.raf=raf||(callback=>globalThis.requestAnimationFrame(callback));
  this.now=now||(()=>globalThis.performance.now());
  this.precision=precision;this.restVelocity=restVelocity;
  this.anchor={value,velocity,target:value,time:0};this.frame=null;this.running=false;
 }
 // Position and velocity at a time, solved in closed form from the last anchor.
 sample(time){
  const {value,velocity,target,time:start}=this.anchor;
  if(!this.running)return {value,velocity};
  const t=Math.max(0,(time-start)/1000),{omega,zeta}=this.params,x0=value-target;
  if(zeta>=1){
   const b=velocity+omega*x0,decay=Math.exp(-omega*t);
   return {value:target+decay*(x0+b*t),velocity:decay*(velocity-omega*b*t)};
  }
  const a=zeta*omega,damped=omega*Math.sqrt(1-zeta*zeta),c=(velocity+a*x0)/damped;
  const decay=Math.exp(-a*t),cos=Math.cos(damped*t),sin=Math.sin(damped*t);
  return {value:target+decay*(x0*cos+c*sin),velocity:decay*(velocity*cos-(a*c+x0*damped)*sin)};
 }
 get value(){return this.sample(this.now()).value;}
 get velocity(){return this.sample(this.now()).velocity;}
 get target(){return this.anchor.target;}
 get resting(){return !this.running;}
 // Retarget from the visible value, keeping the current velocity unless one is given.
 to(target,{velocity}={}){
  const time=this.now(),current=this.sample(time);
  this.anchor={value:current.value,velocity:velocity??current.velocity,target,time};this.running=true;
  if(this.frame===null)this.schedule();
  return this;
 }
 // Catch in flight: keep the visible value and drop the velocity.
 stop(){
  const time=this.now(),current=this.sample(time);
  this.anchor={value:current.value,velocity:0,target:current.value,time};this.running=false;this.frame=null;
  return this;
 }
 schedule(){
  const frame={};this.frame=frame;
  this.raf(()=>{if(this.frame===frame){this.frame=null;this.tick();}});
 }
 tick(){
  if(!this.running)return;
  const time=this.now(),{value,velocity}=this.sample(time),target=this.anchor.target;
  if(Math.abs(value-target)<this.precision&&Math.abs(velocity)<this.restVelocity){
   this.anchor={value:target,velocity:0,target,time};this.running=false;
   this.onFrame?.(target,0);this.onRest?.(target);return;
  }
  this.onFrame?.(value,velocity);this.schedule();
 }
}

const SNAPPY=springCurve(SPRING.snappy);
const TOAST_IN=[{opacity:0,transform:'translateY(8px)',offset:0},{opacity:1,offset:.75},
 {opacity:1,transform:'none',offset:1}];
// Layout offsets exclude our active FLIP transform. Animation progress is not a new layout.
const resourceLayout=node=>{if(typeof node.offsetLeft!=='number')return null;const values=[];for(let n=node,depth=0;n&&depth<64;n=n.offsetParent,depth++)values.push(n,n.offsetLeft,n.offsetTop,n.offsetWidth,n.offsetHeight);return values;};
const sameLayout=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((value,index)=>value===b[index]);
// One animation owner per element. Read its visible position before cancelling;
// retarget from there, never combine old transforms with a new layout measurement.
export class SceneMotion {
 constructor(host){this.host=host;this.animations=new Map();this.playerPaint=new Map();this.scroll=new Map();this.nestedScroll=new Map();this.geometry=new Map();this.clocks=new WeakMap();this.feedbackTokens=new WeakMap();this.feedbackStates=new WeakMap();this.media=reducedMotionQuery();this.onPreference=()=>{if(this.reduced)this.cancel();};this.listening=false;this.syncRoot();}
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
 updateClock(node,value){
  if(!node||typeof value!=='string')return;const previous=this.clocks.get(node);if(previous?.value===value)return;
  let digits=previous?.digits;if(!digits||digits.length!==value.length){digits=[...value].map(char=>{const span=node.ownerDocument.createElement('span');span.textContent=char;return span;});node.replaceChildren(...digits);this.clocks.set(node,{value,digits});return;}
  for(let index=0;index<digits.length;index++){if(previous.value[index]===value[index])continue;digits[index].textContent=value[index];this.animate(digits[index],[{opacity:.25},{opacity:1}],180,{fadeReduced:true});}
  this.clocks.set(node,{value,digits});
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
 holdGeometry(){
  if(this.geometry.size)return;
  // Freeze only existing layout boundaries; data and actions continue updating.
  // Resolved CSS height preserves fractions and excludes FLIP transforms.
  // Rounded offsetHeight would move later rows when the2s hold is released.
  const nodes=this.host.querySelectorAll('#now-view:not([hidden])>[data-overview-rank],.responses>section:not([hidden]):not(#now-view):not(#photo-view)>:not([hidden])');
  const snapshots=[];
  for(const node of nodes){if(!node.getClientRects().length||!node.style)continue;const resolved=typeof getComputedStyle==='function'?Number.parseFloat(getComputedStyle(node).height):NaN,height=Number.isFinite(resolved)&&resolved>0?resolved:node.offsetHeight;if(!height)continue;const saved={};for(const key of ['height','min-height','max-height'])saved[key]=[node.style.getPropertyValue(key),node.style.getPropertyPriority(key)];snapshots.push({node,height,saved});}
  for(const {node,height,saved}of snapshots){this.geometry.set(node,saved);for(const key of Object.keys(saved))node.style.setProperty(key,height+'px','important');}
 }
 releaseGeometry(animate=true){
  if(!this.geometry.size)return;
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
   else if(Math.abs(dx)+Math.abs(dy)>.5)this.animate(node,[{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}],240,{visible:true});
  }
  if(!this.animations.size)this.cancel();
 }
 capture(focus,next){
  this.releaseGeometry(false);
  const feed=this.host.querySelector('.responses');this.scroll.set(focus,feed.scrollTop);
  this.nestedScroll.set(focus,[...(feed.querySelectorAll?.('[data-scroll-axis],#weather-view,#vehicle-view,#radio-view,#device-view,#timers-view,#music-response,.answer-scroll')||[])].map(node=>[node,node.scrollTop,node.scrollLeft]));
  // Crossing Ro carries the persistent player's geometry. Ordinary details need
  // no card, heading or page rectangle and never touches player geometry.
  const player=focus==='photo'||next==='photo'?this.host.querySelector('.player:not([hidden]),.player-empty:not([hidden])'):null;
  const box=player?.getBoundingClientRect();this.cancel();return box||null;
 }
 enter(previous,next,oldPlayer,back=false){
  if(previous===next||this.host.isConnected===false)return;
  const feed=this.host.querySelector('.responses');feed.scrollTop=back?this.scroll.get(next)||0:0;
  if(back)for(const [node,top,left]of this.nestedScroll.get(next)||[]){node.scrollTop=top;node.scrollLeft=left;}
  const entering=next==='photo'?this.host.querySelector('#photo-view'):[...feed.children].find(node=>!node.hidden&&node.id!=='resource-rail'&&node.getClientRects().length);
  const crossesRest=previous==='photo'||next==='photo',duration=this.reduced?120:200;
  if(this.reduced){if(entering)this.animate(entering,[{opacity:.65},{opacity:1}],120,{fadeReduced:true});return;}
  // Ro and the active view stay in their own positions while their whole pane
  // gently appears. Detail navigation keeps the same small directional move.
  if(entering)this.animate(entering,crossesRest?[{opacity:.65},{opacity:1}]:[{opacity:1,transform:`translateX(${back?-16:16}px)`},{opacity:1,transform:'none'}],duration);
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
   const animation=this.animate(player,[{opacity:1,transform:`translate(${dx}px,${dy}px)`},{opacity:1,transform:'none'}],duration);
   if(animation)animation.finished.catch(()=>{}).finally(release);else release();
  }
 }
}
