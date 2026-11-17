// Ro <-> Hjem as two live layers (docs/MOTION.md §0), with no view transition and nothing snapshotted.
// The Ro photo is a persistent cover inside the host (.pv-ro-cover): a round mask with the screen-sized photo inside.
// Only transform and opacity animate, on the cover's own layers (WebKit does not composite clip-path, bug 185816):
// the mask scales while the photo inside is counter-scaled, so the photo stands still and only the circle's edge moves.
// Hjem -> Ro: the circle grows from the moon button over Hjem, which is not rendered again until the circle covers it;
// then Ro renders under the cover, its photo is decoded, and Ro's clock, caption and player fade in as the cover goes.
// Ro -> Hjem: Ro's clock, caption and player fade out, Hjem renders under the cover, and one frame later the circle
// shrinks into the finger. Reduced: the cover cross-fades in REDUCED_MS.
export const RO_REVEAL=Object.freeze({ms:560,bezier:Object.freeze([.45,0,.2,1])});
export const RO_CLOSE=Object.freeze({ms:480,bezier:Object.freeze([.4,0,.2,1])});
export const RO_FOREGROUND=Object.freeze({out:120,in:200});
export const REDUCED_MS=200;
const STEPS=40,START_RADIUS=28,END_RADIUS=6;
// Ro's own content over the photo: it fades instead of being covered or uncovered at once.
const FOREGROUND='#photo-view>:not(img),#photo-weather,#resource-rail,.player,#player-empty,.connection-note';

// CSS cubic-bezier(x1,y1,x2,y2) as a function of progress (Newton, then bisection).
export function cubicBezier([x1,y1,x2,y2]){
 const curve=(a,b,t)=>((1-3*b+3*a)*t+(3*b-6*a))*t*t+3*a*t,slope=(a,b,t)=>3*(1-3*b+3*a)*t*t+2*(3*b-6*a)*t+3*a;
 return x=>{
  if(x<=0)return 0;if(x>=1)return 1;
  let t=x;
  for(let i=0;i<8;i++){
   const error=curve(x1,x2,t)-x;if(Math.abs(error)<1e-7)return curve(y1,y2,t);
   const d=slope(x1,x2,t);if(Math.abs(d)<1e-6)break;t-=error/d;
  }
  let lo=0,hi=1;t=x;
  for(let i=0;i<40;i++){const v=curve(x1,x2,t);if(Math.abs(v-x)<1e-7)break;if(v<x)lo=t;else hi=t;t=(lo+hi)/2;}
  return curve(y1,y2,t);
 };
}
// Keyframes for a circle at (x, y) whose radius goes from -> to: a mask of size 2·size scaled by radius/size, and the
// content inside it counter-scaled so it stays where it is. The eased radius is sampled into linear keyframes, so the
// mask and the content are exact inverses at every keyframe (each scale interpolates linearly between them).
export function circleFrames({x,y,from,to,size,bezier,steps=STEPS}){
 const ease=cubicBezier(bezier),mask=[],content=[];
 for(let i=0;i<=steps;i++){
  const offset=i/steps,radius=from+(to-from)*ease(offset),scale=Math.max(radius,.5)/size;
  mask.push({offset,transform:`translate(${x}px,${y}px) scale(${scale}) translate(${-size}px,${-size}px)`});
  content.push({offset,transform:`translate(${size}px,${size}px) scale(${1/scale}) translate(${-x}px,${-y}px)`});
 }
 return {mask,content};
}

export class RoLayer {
 constructor(host){this.host=host;this.run=null;this.box=null;}
 get doc(){return this.host.ownerDocument;}
 get view(){return this.doc.defaultView||globalThis;}
 available(){return typeof this.host.animate==='function'&&this.host.isConnected!==false&&!!this.doc?.createElement;}
 get moving(){return !!this.run;}
 // Made once and kept mounted (hidden by the stylesheet), so a transition inserts nothing into the host.
 // mask (the circle) > stage (the screen, counter-scaled) > photo (Ro's photo box, drawn by .photo-view's own rules).
 cover(){
  if(this.node?.isConnected)return this.node;
  const doc=this.doc,make=name=>{const node=doc.createElement('div');node.className=name;return node;};
  const cover=make('pv-ro-cover'),mask=make('pv-ro-mask'),stage=make('pv-ro-stage');
  const photo=make('pv-ro-photo photo-view');
  const image=doc.createElement('img'),source=this.host.querySelector('#photo-view>img');
  cover.setAttribute('aria-hidden','true');cover.inert=true;
  image.alt='';image.decoding='sync';image.src=source?.currentSrc||source?.src||'ambient.webp';
  photo.append(image);stage.append(photo);mask.append(stage);cover.append(mask);this.host.append(cover);
  Object.assign(this,{node:cover,mask,stage,photo,image,placed:null});
  return cover;
 }
 // Decodes the photo ahead of the first transition, so no frame shows the cover without it.
 prepare(){
  if(!this.available())return Promise.resolve();
  this.cover();return this.image.decode?this.image.decode().catch(()=>{}):Promise.resolve();
 }
 // The cover's own coordinates (the stage may scale the body that holds it): its size and a client point in it.
 frame(){
  const box=this.node.getBoundingClientRect();
  const width=this.node.offsetWidth||box.width,height=this.node.offsetHeight||box.height;
  const scale=box.width?width/box.width:1;
  return {width,height,scale,local:({x,y})=>({x:(x-box.left)*scale,y:(y-box.top)*scale})};
 }
 // Ro's photo box, read while Ro is on screen; the cover draws its photo there. Before the first read: the whole cover.
 remember(){
  const photo=this.host.querySelector('#photo-view');if(!photo||photo.hidden||!photo.getClientRects().length)return;
  this.cover();const frame=this.frame(),box=photo.getBoundingClientRect(),at=frame.local({x:box.left,y:box.top});
  this.box={left:at.x,top:at.y,width:box.width*frame.scale,height:box.height*frame.scale,
   radius:this.view.getComputedStyle(photo).borderRadius};
 }
 // Writes only when the screen or Ro's box changed (normally once): the mask's size and the photo's box.
 place(frame){
  const size=Math.ceil(Math.hypot(frame.width,frame.height));
  const box=this.box||{left:0,top:0,width:frame.width,height:frame.height,radius:'0px'};
  const key=JSON.stringify([size,frame.width,frame.height,box]);
  if(this.placed!==key){
   this.placed=key;
   Object.assign(this.mask.style,{width:`${2*size}px`,height:`${2*size}px`});
   Object.assign(this.stage.style,{width:`${frame.width}px`,height:`${frame.height}px`});
   Object.assign(this.photo.style,{left:`${box.left}px`,top:`${box.top}px`,width:`${box.width}px`,
    height:`${box.height}px`,borderRadius:box.radius});
  }
  return size;
 }
 foreground(){
  return [...this.host.querySelectorAll(FOREGROUND)].filter(node=>!node.hidden&&node.getClientRects().length);
 }
 // The circle's centre in cover coordinates (a client point, or the middle) and the radius to the farthest corner.
 circle(frame,point){
  const at=point?frame.local(point):{x:frame.width/2,y:frame.height/2};
  return {x:at.x,y:at.y,to:Math.ceil(Math.hypot(Math.max(at.x,frame.width-at.x),Math.max(at.y,frame.height-at.y)))};
 }
 // Hjem -> Ro: the circle grows from point (client coordinates); present() renders Ro once it covers the screen.
 open({point,present,reduced,done}){
  this.finish();this.cover();
  const frame=this.frame(),size=this.place(frame),{x,y,to}=this.circle(frame,point);
  const run={kind:'open',present,done,animations:[],fades:[],committed:false};this.run=run;
  const show={visibility:['visible','visible']};
  let reveal;
  if(reduced){
   reveal=this.node.animate({...show,opacity:[0,1]},{duration:REDUCED_MS,easing:'linear',fill:'forwards'});
   run.animations.push(reveal,...this.still(x,y,to,size));
  }else{
   const frames=circleFrames({x,y,from:START_RADIUS,to,size,bezier:RO_REVEAL.bezier});
   const timing={duration:RO_REVEAL.ms,easing:'linear',fill:'forwards'};
   reveal=this.mask.animate(frames.mask,timing);
   run.animations.push(this.node.animate(show,timing),reveal,this.stage.animate(frames.content,timing));
  }
  reveal.finished.then(()=>{if(this.run===run)this.commit(run,{fadeIn:true,reduced});},()=>{});
  return run;
 }
 // Ro -> Hjem: Ro's content fades, present() renders Hjem under the full cover, and one frame after that the circle
 // shrinks into point (client coordinates).
 close({point,present,reduced,done}){
  this.finish();this.cover();this.remember();
  const frame=this.frame(),size=this.place(frame),{x,y,to}=this.circle(frame,point);
  const run={kind:'close',present,done,animations:[],committed:false,covered:false};this.run=run;
  run.fades=this.foreground().map(node=>node.animate({opacity:[1,0]},
   {duration:RO_FOREGROUND.out,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'}));
  run.cover=()=>{
   if(this.run!==run||run.covered)return;run.covered=true;
   run.animations.push(this.node.animate({visibility:['visible','visible']},{duration:1e6,fill:'forwards'}),
    ...this.still(x,y,to,size));
   this.commit(run,{fadeIn:false,reduced});
   for(const animation of run.fades)animation.cancel();
   // Hjem has rendered under the cover; it is drawn once before the circle starts to uncover it.
   const raf=callback=>this.view.requestAnimationFrame(callback);
   raf(()=>raf(()=>{if(this.run===run)this.shrink(run,{x,y,to,size,reduced});}));
  };
  if(run.fades.length)Promise.all(run.fades.map(a=>a.finished)).then(run.cover,()=>{});else run.cover();
  return run;
 }
 shrink(run,{x,y,to,size,reduced}){
  const timing={duration:reduced?REDUCED_MS:RO_CLOSE.ms,easing:'linear',fill:'forwards'};
  let last;
  if(reduced)last=this.node.animate({visibility:['visible','visible'],opacity:[1,0]},timing);
  else{
   const frames=circleFrames({x,y,from:to,to:END_RADIUS,size,bezier:RO_CLOSE.bezier});
   last=this.mask.animate(frames.mask,timing);
   // The last dot fades as it reaches the finger.
   run.animations.push(this.stage.animate(frames.content,timing),this.node.animate([
    {visibility:'visible',opacity:1,offset:0},{visibility:'visible',opacity:1,offset:.75},
    {visibility:'visible',opacity:0,offset:1}],timing));
  }
  run.animations.push(last);
  last.finished.then(()=>{if(this.run===run)this.end(run);},()=>{});
 }
 // The cover at full size, held while the screen under it renders.
 still(x,y,to,size){
  const frames=circleFrames({x,y,from:to,to,size,bezier:[0,0,1,1],steps:1}),hold={duration:1e6,fill:'forwards'};
  return [this.mask.animate(frames.mask,hold),this.stage.animate(frames.content,hold)];
 }
 // A render while a transition runs. Hjem -> Ro: Hjem stays as it is until the circle covers it (the render waits;
 // present() renders everything). Ro -> Hjem while Ro's content fades: cover now, and render under it.
 holdRender(){
  const run=this.run;if(!run||this.committing||run.committed)return false;
  if(run.kind==='open')return true;
  run.cover();return false;
 }
 commit(run,{fadeIn,reduced}){
  if(!run.committed){run.committed=true;this.committing=true;try{run.present();}finally{this.committing=false;}}
  if(!fadeIn)return;
  // Ro is rendered under the cover. Its photo is decoded and one frame is drawn before the cover goes.
  const real=this.host.querySelector('#photo-view>img');
  const decoded=real?.decode?real.decode().catch(()=>{}):Promise.resolve();
  decoded.then(()=>new Promise(resolve=>this.view.requestAnimationFrame(()=>resolve()))).then(()=>{
   if(this.run!==run)return;
   this.remember();
   for(const node of this.foreground())node.animate({opacity:[0,1]},
    {duration:reduced?REDUCED_MS:RO_FOREGROUND.in,easing:'cubic-bezier(0,0,.2,1)'});
   this.end(run);
  });
 }
 end(run){
  if(this.run!==run)return;this.run=null;
  for(const animation of [...run.animations,...(run.fades||[])])animation.cancel();
  run.done?.();
 }
 // A new navigation, a touch or cancel(): the screen the state asks for, at once.
 finish(){
  const run=this.run;if(!run)return;
  if(!run.committed){run.committed=true;this.committing=true;try{run.present();}finally{this.committing=false;}}
  this.end(run);
 }
}
