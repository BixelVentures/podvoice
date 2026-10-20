// Layout offsets exclude our active FLIP transform. Animation progress is not a new layout.
const resourceLayout=node=>{if(typeof node.offsetLeft!=='number')return null;const values=[];for(let n=node,depth=0;n&&depth<64;n=n.offsetParent,depth++)values.push(n,n.offsetLeft,n.offsetTop,n.offsetWidth,n.offsetHeight);return values;};
const sameLayout=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((value,index)=>value===b[index]);
// One animation owner per element. Read its visible position before cancelling;
// retarget from there, never combine old transforms with a new layout measurement.
export class SceneMotion {
 constructor(host){this.host=host;this.animations=new Map();this.scroll=new Map();this.exits=new Map();this.waits=new Map();this.geometry=new Map();this.media=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');this.onPreference=()=>{if(this.reduced)this.cancel();};this.listening=false;}
 get reduced(){return this.host.dataset.motion==='reduced'||this.media?.matches===true;}
 cancel(){for(const animation of this.animations.values())animation.cancel();this.animations.clear();for(const timer of this.waits.values())clearTimeout(timer);this.waits.clear();for(const restore of this.exits.values())restore();this.exits.clear();if(this.listening){this.media.removeEventListener('change',this.onPreference);this.listening=false;}}
 animate(node,frames,duration=280,options={}){
  this.animations.get(node)?.cancel();this.animations.delete(node);clearTimeout(this.waits.get(node));this.waits.delete(node);
  if(this.reduced&&!options.fadeReduced||!node?.getClientRects().length||this.host.isConnected===false||typeof node.animate!=='function'){if(!this.animations.size)this.cancel();return null;}
  if(this.reduced){frames=frames.map(frame=>({opacity:frame.opacity??1}));duration=120;options={};}
  const animation=node.animate(frames,{duration,delay:options.delay||0,fill:'backwards',easing:'cubic-bezier(.2,0,0,1)'});this.animations.set(node,animation);
  if(options.ready&&animation.pause){animation.pause();const release=()=>{if(this.animations.get(node)!==animation)return;clearTimeout(this.waits.get(node));this.waits.delete(node);animation.play();};this.waits.set(node,setTimeout(release,80));Promise.resolve(options.ready).then(release,release);}
  if(!this.listening&&this.media?.addEventListener){this.media.addEventListener('change',this.onPreference);this.listening=true;}
  animation.finished.catch(()=>{}).finally(()=>{if(this.animations.get(node)===animation){this.animations.delete(node);clearTimeout(this.waits.get(node));this.waits.delete(node);this.exits.get(node)?.();this.exits.delete(node);}if(!this.animations.size)this.cancel();});return animation;
 }
 card(focus){
  const selector={weather:'#home-weather',music:'#home-music',timers:'#timer-card',radio:'#home-radio',vehicle:'#home-vehicle'}[focus];
  const card=selector?this.host.querySelector(selector):[...(this.host.querySelectorAll?.('.resource-preview')||[])].find(node=>node.dataset.target===focus&&node.getClientRects().length);
  const owner=card?.overviewShell||card;return owner?.getClientRects().length?owner:null;
 }
 overlay(node,box,duration){
  if(!node?.style||!box?.width)return;
  const style=node.getAttribute('style'),hidden=node.hidden,inert=node.inert;
  node.hidden=false;node.inert=true;Object.assign(node.style,{position:'fixed',left:box.x+'px',top:box.y+'px',width:box.width+'px',height:box.height+'px',margin:'0',zIndex:'8',pointerEvents:'none'});
  this.exits.set(node,()=>{if(style===null)node.removeAttribute('style');else node.setAttribute('style',style);node.hidden=hidden;node.inert=inert;});
  if(!this.animate(node,[{opacity:1},{opacity:0}],duration,{fadeReduced:true})){this.exits.get(node)?.();this.exits.delete(node);}
 }
 holdGeometry(){
  if(this.geometry.size)return;
  // Freeze only existing layout boundaries; data and actions continue updating.
  const nodes=this.host.querySelectorAll('#now-view:not([hidden])>[data-overview-rank],.responses>section:not([hidden]):not(#now-view):not(#photo-view)>:not([hidden])');
  for(const node of nodes){if(!node.getClientRects().length||!node.style||!node.offsetHeight)continue;const saved={};for(const key of ['height','min-height','max-height'])saved[key]=[node.style.getPropertyValue(key),node.style.getPropertyPriority(key)];this.geometry.set(node,saved);for(const key of Object.keys(saved))node.style.setProperty(key,node.offsetHeight+'px','important');}
 }
 releaseGeometry(animate=true){
  if(!this.geometry.size)return;
  const before=new Map([...this.geometry.keys()].filter(n=>n.getClientRects().length).map(n=>[n,n.getBoundingClientRect()]));before.layouts=new Map([...before.keys()].map(n=>[n,resourceLayout(n)]));
  for(const [node,saved]of this.geometry)for(const [key,[value,priority]]of Object.entries(saved)){if(value)node.style.setProperty(key,value,priority);else node.style.removeProperty(key);}
  this.geometry.clear();if(animate)this.settleResources(before);
 }
 resources(){
  // Navigation already captured its FLIP origin; resource reconciliation is skipped
  // for that render, so avoid measuring the entire old grid a second time.
  if(this.host.lastRenderedFocus!==undefined&&this.host.lastRenderedFocus!==this.host.state?.focus)return new Map();
  if([this.host.state?.timer,...this.host.state?.extraTimers||[]].some(t=>t?.status==='done'))this.releaseGeometry(false);
  const nodes=[...this.host.querySelectorAll('.resource-preview,.timer-panel,#now-view>[data-overview-rank]')].filter(n=>n.getClientRects().length),boxes=new Map(nodes.map(n=>[n,n.getBoundingClientRect()]));
  boxes.layouts=new Map(nodes.map(node=>[node,resourceLayout(node)]));return boxes;
 }
 settleResources(before,viewChanged=false){
  if(viewChanged||this.reduced){for(const node of before.keys()){this.animations.get(node)?.cancel();this.animations.delete(node);}if(!this.animations.size)this.cancel();return;}
  for(const node of new Set([...before.keys(),...this.host.querySelectorAll('.resource-preview,.timer-panel,#now-view>[data-overview-rank]')])){
   if(!node.getClientRects().length)continue;const a=before.get(node),active=this.animations.get(node);
   if(sameLayout(before.layouts?.get(node),resourceLayout(node)))continue;
   let b=node.getBoundingClientRect();if(!a){this.animate(node,[{opacity:.45},{opacity:1}],160);continue;}
   if(active){active.cancel();this.animations.delete(node);b=node.getBoundingClientRect();}
   const dx=a.x-b.x,dy=a.y-b.y;
   // Idle72→active112 changes layout once. Retained siblings FLIP the40px
   // displacement; the same timer shell scales in place, never animates height.
   const timerResize=node.id==='timer-card'&&a.width>0&&a.height>0&&b.width>0&&b.height>0&&(Math.abs(a.width-b.width)+Math.abs(a.height-b.height)>.5);
   if(timerResize)this.animate(node,[{transformOrigin:'0 0',transform:`translate(${dx}px,${dy}px) scale(${a.width/b.width},${a.height/b.height})`},{transformOrigin:'0 0',transform:'none'}],240);
   else if(Math.abs(dx)+Math.abs(dy)>.5)this.animate(node,[{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}],240);
  }
  if(!this.animations.size)this.cancel();
 }
 capture(focus,next){
  this.releaseGeometry(false);
  const feed=this.host.querySelector('.responses'),player=this.host.querySelector('.player:not([hidden]),.player-empty:not([hidden])');this.scroll.set(focus,feed.scrollTop);
  const box=player&&!player.hidden?player.getBoundingClientRect():null,content=[...feed.children].find(node=>!node.hidden&&node.getClientRects().length&&node.id!=='resource-rail'&&!this.exits.has(node)),card=this.card(next),heading=content?.querySelector?.('.response-heading');
  const origin=card||heading||content,originBox=origin?.getBoundingClientRect?.(),outgoing=content,oldContent=content?.getBoundingClientRect?.();
  this.cancel();return {...box,originBox,outgoing,oldContent};
 }
 enter(previous,next,oldPlayer,back=false){
  if(previous===next||this.host.isConnected===false)return;
  const feed=this.host.querySelector('.responses');feed.scrollTop=back?this.scroll.get(next)||0:0;
  const content=[...feed.children].find(node=>!node.hidden&&node.getClientRects().length&&node.id!=='resource-rail');
  const entering=next==='photo'?this.host.querySelector('#photo-view'):content,duration=back?240:280;
  if(this.reduced){if(oldPlayer?.outgoing&&oldPlayer.outgoing!==entering)this.overlay(oldPlayer.outgoing,oldPlayer.oldContent,120);if(entering)this.animate(entering,[{opacity:0},{opacity:1}],120,{fadeReduced:true});return;}
  if(previous==='photo'&&next==='now'){
   const cards=[...(this.host.querySelectorAll?.('#now-view>[data-overview-rank]')||[])].filter(node=>node.getClientRects().length).slice(0,6);
   if(oldPlayer?.outgoing)this.overlay(oldPlayer.outgoing,oldPlayer.oldContent,200);
   if(cards.length)cards.forEach((node,index)=>this.animate(node,[{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'none'}],160,{delay:index*30}));
   else if(entering)this.animate(entering,[{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'none'}],200);
  }else{
   const target=next==='now'?this.card(previous):entering?.querySelector?.('.response-heading'),a=oldPlayer?.originBox,b=target?.getBoundingClientRect?.();
   const sections=[...(entering?.children||[])].filter(node=>node!==target&&!node.contains?.(target)&&node.getClientRects().length).slice(0,3);
   if(oldPlayer?.outgoing&&oldPlayer.outgoing!==entering)this.overlay(oldPlayer.outgoing,oldPlayer.oldContent,90);
   if(target&&a?.width&&a.height&&b?.width&&b.height){
    this.animate(target,[{opacity:.25,transformOrigin:'0 0',transform:`translate(${a.x-b.x}px,${a.y-b.y}px) scale(${a.width/b.width},${a.height/b.height})`},{opacity:1,transformOrigin:'0 0',transform:'none'}],duration);
    sections.forEach((node,index)=>this.animate(node,[{opacity:0},{opacity:1}],duration-120-index*30,{delay:120+index*30}));
   }else if(entering)this.animate(entering,[{opacity:0,transform:next==='photo'?'none':'translateY(6px)'},{opacity:1,transform:'none'}],duration);
  }
  const player=this.host.querySelector('.player:not([hidden]),.player-empty:not([hidden])');if(!player||player.hidden)return;
  if(previous==='photo'&&next==='now'){
   const cover=player.querySelector?.('#cover');let ready;
   if(cover?.complete&&cover.naturalWidth&&typeof cover.decode==='function'){try{ready=cover.decode();}catch{}}
   this.animate(player,[{opacity:1,transform:'translateX(16px)'},{opacity:1,transform:'none'}],240,{ready});
  }else if(next==='photo'){
   const box=player.getBoundingClientRect();if(oldPlayer?.width&&box.width){const dx=oldPlayer.x-box.x,dy=oldPlayer.y-box.y;if(Math.abs(dx)+Math.abs(dy)>.5)this.animate(player,[{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}],240);}
  }
 }
}
