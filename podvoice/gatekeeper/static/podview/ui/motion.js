// Layout offsets exclude our active FLIP transform. Animation progress is not a new layout.
const resourceLayout=node=>{if(typeof node.offsetLeft!=='number')return null;const values=[];for(let n=node,depth=0;n&&depth<64;n=n.offsetParent,depth++)values.push(n,n.offsetLeft,n.offsetTop,n.offsetWidth,n.offsetHeight);return values;};
const sameLayout=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((value,index)=>value===b[index]);
// One animation owner per element. Read its visible position before cancelling;
// retarget from there, never combine old transforms with a new layout measurement.
export class SceneMotion {
 constructor(host){this.host=host;this.animations=new Map();this.playerPaint=new Map();this.scroll=new Map();this.nestedScroll=new Map();this.geometry=new Map();this.clocks=new WeakMap();this.feedbackTokens=new WeakMap();this.feedbackStates=new WeakMap();this.media=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');this.onPreference=()=>{if(this.reduced)this.cancel();};this.listening=false;}
 get reduced(){return this.host.dataset.motion==='reduced'||this.media?.matches===true;}
 cancel(){this.releaseNavigationGuard?.();for(const animation of this.animations.values())animation.cancel();this.animations.clear();for(const [node,saved]of this.playerPaint){if(saved.value===undefined)delete node.dataset.scenePlayerMoving;else node.dataset.scenePlayerMoving=saved.value;}this.playerPaint.clear();if(this.listening){this.media.removeEventListener('change',this.onPreference);this.listening=false;}}
 guardNavigation(node,duration){
  this.releaseNavigationGuard?.();if(!node?.addEventListener)return;
  // Pointer starts and clicks in newly revealed content are withheld. Native keyboard
  // activation, the persistent player and navigation controls remain available.
  const block=event=>{if(event.type==='pointerdown'||event.detail>0){event.preventDefault();event.stopImmediatePropagation();}};
  node.addEventListener('pointerdown',block,true);node.addEventListener('click',block,true);const timer=setTimeout(()=>release(),duration);
  const release=()=>{clearTimeout(timer);node.removeEventListener('pointerdown',block,true);node.removeEventListener('click',block,true);if(this.releaseNavigationGuard===release)this.releaseNavigationGuard=null;};
  this.releaseNavigationGuard=release;
 }
 animate(node,frames,duration=280,options={}){
  this.animations.get(node)?.cancel();this.animations.delete(node);
  if(this.reduced&&!options.fadeReduced||(!options.visible&&!node?.getClientRects().length)||this.host.isConnected===false||typeof node.animate!=='function'){if(!this.animations.size)this.cancel();return null;}
  if(this.reduced){frames=frames.map(frame=>({opacity:frame.opacity??1}));duration=120;options={};}
  const animation=node.animate(frames,{duration,delay:options.delay||0,fill:'backwards',easing:'cubic-bezier(.2,0,0,1)'});this.animations.set(node,animation);
  if(!this.listening&&this.media?.addEventListener){this.media.addEventListener('change',this.onPreference);this.listening=true;}
  animation.finished.catch(()=>{}).finally(()=>{if(this.animations.get(node)===animation){this.animations.delete(node);}if(!this.animations.size)this.cancel();});return animation;
 }
 updateClock(node,value){
  if(!node||typeof value!=='string')return;const previous=this.clocks.get(node);if(previous?.value===value)return;
  let digits=previous?.digits;if(!digits||digits.length!==value.length){digits=[...value].map(char=>{const span=node.ownerDocument.createElement('span');span.textContent=char;return span;});node.replaceChildren(...digits);this.clocks.set(node,{value,digits});return;}
  for(let index=0;index<digits.length;index++){if(previous.value[index]===value[index])continue;digits[index].textContent=value[index];this.animate(digits[index],[{opacity:.25},{opacity:1}],180,{fadeReduced:true});}
  this.clocks.set(node,{value,digits});
 }
 feedback(node,visible){
  if(!node)return;const previous=this.feedbackStates.get(node),signature=JSON.stringify([node.dataset?.source||'',node.textContent||'']);
  if(previous?.visible===visible&&(!visible||previous.signature===signature))return;
  const token={};this.feedbackTokens.set(node,token);this.feedbackStates.set(node,{visible,signature});
  if(visible){node.hidden=false;this.animate(node,previous?.visible?[{opacity:.7},{opacity:1}]:[{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'none'}],previous?.visible?120:160,{fadeReduced:true});return;}
  const animation=this.animate(node,[{opacity:1},{opacity:0}],120,{fadeReduced:true});if(!animation){node.hidden=true;return;}animation.finished.then(()=>{if(this.feedbackTokens.get(node)===token)node.hidden=true;},()=>{});
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
  this.guardNavigation(entering,duration);
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
