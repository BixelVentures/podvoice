// Layout offsets exclude our active FLIP transform. Animation progress is not a new layout.
const resourceLayout=node=>{if(typeof node.offsetLeft!=='number')return null;const values=[];for(let n=node,depth=0;n&&depth<64;n=n.offsetParent,depth++)values.push(n,n.offsetLeft,n.offsetTop,n.offsetWidth,n.offsetHeight);return values;};
const sameLayout=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((value,index)=>value===b[index]);
// One animation owner per element. Read its visible position before cancelling;
// retarget from there, never combine old transforms with a new layout measurement.
export class SceneMotion {
 constructor(host){this.host=host;this.animations=new Map();this.scroll=new Map();this.media=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');this.onPreference=()=>{if(this.reduced)this.cancel();};this.listening=false;}
 get reduced(){return this.host.dataset.motion==='reduced'||this.media?.matches===true;}
 cancel(){for(const animation of this.animations.values())animation.cancel();this.animations.clear();if(this.listening){this.media.removeEventListener('change',this.onPreference);this.listening=false;}}
 animate(node,frames,duration=220){
  this.animations.get(node)?.cancel();this.animations.delete(node);if(this.reduced||!node?.getClientRects().length){if(!this.animations.size)this.cancel();return;}
  const animation=node.animate(frames,{duration,easing:'cubic-bezier(.22,1,.36,1)'});this.animations.set(node,animation);if(!this.listening&&this.media?.addEventListener){this.media.addEventListener('change',this.onPreference);this.listening=true;}
  animation.finished.catch(()=>{}).finally(()=>{if(this.animations.get(node)===animation)this.animations.delete(node);if(!this.animations.size)this.cancel();});
 }
 resources(){
  const nodes=[...this.host.querySelectorAll('.resource-preview,.timer-panel')].filter(n=>n.getClientRects().length),boxes=new Map(nodes.map(n=>[n,n.getBoundingClientRect()]));
  boxes.layouts=new Map(nodes.map(node=>[node,resourceLayout(node)]));return boxes;
 }
 settleResources(before,viewChanged=false){
  if(viewChanged||this.reduced){for(const node of before.keys()){this.animations.get(node)?.cancel();this.animations.delete(node);}if(!this.animations.size)this.cancel();return;}
  for(const node of this.host.querySelectorAll('.resource-preview,.timer-panel')){
   if(!node.getClientRects().length)continue;const a=before.get(node),active=this.animations.get(node);
   if(sameLayout(before.layouts?.get(node),resourceLayout(node)))continue;
   let b=node.getBoundingClientRect();if(!a){this.animate(node,[{opacity:.45},{opacity:1}],160);continue;}
   if(active){active.cancel();this.animations.delete(node);b=node.getBoundingClientRect();}
   const dx=a.x-b.x,dy=a.y-b.y;
   if(Math.abs(dx)+Math.abs(dy)>.5)this.animate(node,[{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}],240);
  }
  if(!this.animations.size)this.cancel();
 }
 capture(focus){
  const feed=this.host.querySelector('.responses'),player=this.host.querySelector('.player:not([hidden]),.player-empty:not([hidden])');this.scroll.set(focus,feed.scrollTop);
  const box=player&&!player.hidden?player.getBoundingClientRect():null;this.cancel();return box;
 }
 enter(previous,next,oldPlayer,back=false){
  const feed=this.host.querySelector('.responses');feed.scrollTop=back?this.scroll.get(next)||0:0;
  const content=[...feed.children].find(node=>!node.hidden&&node.getClientRects().length&&node.id!=='resource-rail');
  const changesRest=previous==='photo'||next==='photo';
  if(changesRest){const frame=this.host.querySelector('.frame');if(frame)this.animate(frame,[{opacity:.8,transform:'translateY(8px) scale(.99)',filter:'blur(.8px)'},{opacity:1,transform:'none',filter:'none'}],380);}
  else if(content)this.animate(content,[{opacity:.65,transform:'translateY(6px)'},{opacity:1,transform:'none'}]);
  const player=this.host.querySelector('.player:not([hidden]),.player-empty:not([hidden])');if(!player||player.hidden)return;
  const box=player.getBoundingClientRect();if(oldPlayer?.width&&box.width){
   const dx=oldPlayer.x-box.x,dy=oldPlayer.y-box.y,sx=oldPlayer.width/box.width,sy=oldPlayer.height/box.height;
   if(Math.abs(dx)+Math.abs(dy)+Math.abs(oldPlayer.width-box.width)+Math.abs(oldPlayer.height-box.height)>.5)this.animate(player,[{transformOrigin:'0 0',transform:`translate(${dx}px,${dy}px) scale(${sx},${sy})`},{transformOrigin:'0 0',transform:'none'}],changesRest?380:320);
  }
 }
}
