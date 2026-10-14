// One animation owner per element. Read its visible position before cancelling;
// retarget from there, never combine old transforms with a new layout measurement.
export class SceneMotion {
 constructor(host){this.host=host;this.animations=new Map();this.scroll=new Map();}
 get reduced(){return this.host.dataset.motion==='reduced'||matchMedia('(prefers-reduced-motion: reduce)').matches;}
 cancel(){for(const animation of this.animations.values())animation.cancel();this.animations.clear();}
 animate(node,frames,duration=220){
  this.animations.get(node)?.cancel();if(this.reduced||!node?.getClientRects().length)return;
  const animation=node.animate(frames,{duration,easing:'cubic-bezier(.22,1,.36,1)'});this.animations.set(node,animation);
  animation.finished.catch(()=>{}).finally(()=>{if(this.animations.get(node)===animation)this.animations.delete(node);});
 }
 resources(){
  const nodes=[...this.host.querySelectorAll('.resource-preview,.timer-panel')].filter(n=>n.getClientRects().length),boxes=new Map(nodes.map(n=>[n,n.getBoundingClientRect()]));
  for(const n of nodes){this.animations.get(n)?.cancel();this.animations.delete(n);}return boxes;
 }
 settleResources(before,viewChanged=false){
  if(viewChanged||this.reduced)return;
  for(const node of this.host.querySelectorAll('.resource-preview,.timer-panel')){
   if(!node.getClientRects().length)continue;const a=before.get(node),b=node.getBoundingClientRect();
   if(!a){this.animate(node,[{opacity:.45},{opacity:1}],160);continue;}
   const dx=a.x-b.x,dy=a.y-b.y;
   if(Math.abs(dx)+Math.abs(dy)>.5)this.animate(node,[{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}],240);
  }
 }
 capture(focus){
  const feed=this.host.querySelector('.responses'),player=this.host.querySelector('.player');this.scroll.set(focus,feed.scrollTop);
  const box=player&&!player.hidden?player.getBoundingClientRect():null;this.cancel();return box;
 }
 enter(previous,next,oldPlayer,back=false){
  const feed=this.host.querySelector('.responses');feed.scrollTop=back?this.scroll.get(next)||0:0;
  const content=[...feed.children].find(node=>!node.hidden&&node.getClientRects().length&&node.id!=='resource-rail');
  if(content)this.animate(content,[{opacity:.65,transform:'translateY(6px)'},{opacity:1,transform:'none'}]);
  const player=this.host.querySelector('.player');if(!player||player.hidden)return;
  const box=player.getBoundingClientRect();if(oldPlayer?.width&&box.width){
   const dx=oldPlayer.x-box.x,dy=oldPlayer.y-box.y,sx=oldPlayer.width/box.width,sy=oldPlayer.height/box.height;
   if(Math.abs(dx)+Math.abs(dy)+Math.abs(oldPlayer.width-box.width)+Math.abs(oldPlayer.height-box.height)>.5)this.animate(player,[{transformOrigin:'0 0',transform:`translate(${dx}px,${dy}px) scale(${sx},${sy})`},{transformOrigin:'0 0',transform:'none'}],320);
  }
 }
}
