// Page push and pop as live layers (docs/MOTION.md §0, §3.2), with no view transition and nothing snapshotted, as
// UINavigationController and Ionic's ios.transition.ts. The leaving page starts moving in the frame after the tap,
// before anything renders (a compositor animation, so it keeps moving while the new page renders). The new page then
// renders off-screen at 100 % (one render, never again during the motion), its images are decoded, one frame is
// drawn, and it slides in. The leaving page stays mounted and painted (kept out of the flow under its own [hidden])
// until the motion ends. Push: new 100 % -> 0 over the old, which goes 0 -> -33 % under a dim. Pop: the top page
// goes 0 -> 100 % over the one beneath, which comes from -33 % as its dim lifts. A paper plate moves with the top
// page, so nothing shows through its gaps. Only transform and opacity animate. A touch finishes it at once.
// Reduced: the new page cross-fades in over the old in REDUCED_MS.
export const PAGE_MOTION=Object.freeze({ms:500,easing:'cubic-bezier(.32,.72,0,1)',under:-33,dim:.1});
const REDUCED_MS=200,DECODE_WAIT=120;
// Inline properties the layer sets on a page while it moves; all are removed at the end.
const HELD=['display','position','left','top','width','height','margin','z-index','pointer-events','background-color',
 'box-sizing'];

export class PageLayer {
 constructor(host){this.host=host;this.run=null;}
 get doc(){return this.host.ownerDocument;}
 get view(){return this.doc.defaultView||globalThis;}
 get moving(){return !!this.run;}
 feed(){return this.host.querySelector('.responses');}
 available(){return typeof this.host.animate==='function'&&this.host.isConnected!==false&&!!this.feed();}
 visiblePage(feed){
  return [...feed.children].find(node=>!node.hidden&&node.id!=='resource-rail'&&!node.dataset?.pvPageLayer&&
   node.getClientRects().length)||null;
 }
 // The plate (paper that moves with the top page) and the dim, made once inside the page area and hidden at rest.
 helpers(feed){
  if(this.plate?.parentNode===feed)return;
  const make=kind=>{const node=this.doc.createElement('div');node.dataset.pvPageLayer=kind;node.hidden=true;
   node.setAttribute('aria-hidden','true');feed.append(node);return node;};
  this.plate=make('plate');this.dim=make('dim');
 }
 // present() renders the new page. The old page moves at once; the new page's motion starts once it is drawn.
 go({back=false,reduced=false,present,done}){
  this.finish();
  const feed=this.feed(),old=this.visiblePage(feed);
  if(!old){present();done?.();return null;}
  this.helpers(feed);
  const view=this.view,display=view.getComputedStyle(old).display,box=old.getBoundingClientRect();
  const run={back,reduced,present,done,old,display,box,animations:[],committed:false,held:[]};this.run=run;
  const timing={duration:PAGE_MOTION.ms,easing:PAGE_MOTION.easing,fill:'forwards'};
  if(!reduced){
   // The leaving page moves in the next frame: under to -33 % (push), or out to 100 % (pop).
   const to=back?'100%':`${PAGE_MOTION.under}%`;
   run.animations.push(old.animate({transform:['translateX(0)',`translateX(${to})`]},timing));
  }
  // The render waits one drawn frame, so the leaving page is already moving (on the compositor) when it runs.
  view.requestAnimationFrame(()=>view.requestAnimationFrame(()=>{if(this.run===run)this.commit(run);}));
  return run;
 }
 // Until the commit nothing else renders (the new page is rendered once, by the commit). After it the new page is
 // live: data that arrives renders at once, as it would at rest.
 holdRender(){return !!this.run&&!this.run.committed&&!this.committing;}
 commit(run){
  const feed=this.feed(),view=this.view;
  run.committed=true;this.committing=true;
  try{run.present();}finally{this.committing=false;}
  const entering=this.visiblePage(feed),old=run.old;
  if(!entering||entering===old||!old.isConnected){this.end(run);return;}
  run.entering=entering;
  // Keep the old page painted and styled as it was (not [hidden]: its own rules ask for that), out of the flow,
  // where it was. It is hidden again when the motion ends.
  if(old.hidden){old.hidden=false;run.unhid=true;}
  // A render during the motion hides it again (the state no longer shows it); it is shown again before the frame.
  const Observer=view.MutationObserver;
  if(run.unhid&&typeof Observer==='function'){
   run.observer=new Observer(()=>{if(this.run===run&&old.hidden)old.hidden=false;});
   run.observer.observe(old,{attributes:true,attributeFilter:['hidden']});
  }
  const area=feed.getBoundingClientRect(),scale=area.width?feed.offsetWidth/area.width:1;
  const left=(run.box.left-area.left)*scale+feed.scrollLeft-feed.clientLeft;
  const top=(run.box.top-area.top)*scale+feed.scrollTop-feed.clientTop;
  const width=run.box.width*scale,height=run.box.height*scale;
  const viewTop=feed.scrollTop,viewHeight=feed.clientHeight,viewWidth=feed.clientWidth;
  const hold=(node,values)=>{run.held.push(node);
   for(const [name,value]of Object.entries(values))node.style.setProperty(name,value,'important');};
  const back=run.back,reduced=run.reduced;
  hold(old,{display:run.display,position:'absolute',left:`${left}px`,top:`${top}px`,width:`${width}px`,
   height:`${height}px`,margin:'0','box-sizing':'border-box','pointer-events':'none',
   'z-index':back&&!reduced?'3':'0'});
  const cover={display:'block',position:'absolute',left:'0',top:`${viewTop}px`,width:`${viewWidth}px`,
   height:`${viewHeight}px`,margin:'0','pointer-events':'none'};
  hold(this.plate,{...cover,'z-index':'2','background-color':'var(--pv-screen-paper)'});
  hold(this.dim,{...cover,'z-index':'1','background-color':'#000'});
  // The page on top carries the paper under its own content too; the new page sits above the old on push.
  if(!back)hold(entering,{position:'relative','z-index':'3'});
  // Everything new starts where it begins, paused, until the new page is drawn.
  const timing={duration:reduced?REDUCED_MS:PAGE_MOTION.ms,easing:reduced?'linear':PAGE_MOTION.easing,fill:'both'};
  const moves=[];
  const add=(node,frames)=>{const animation=node.animate(frames,timing);animation.pause();moves.push(animation);};
  const under=`translateX(${PAGE_MOTION.under}%)`;
  if(reduced){
   add(entering,{opacity:[0,1]});add(this.plate,{opacity:[0,1]});
   if(back)hold(entering,{position:'relative','z-index':'3'});
   add(this.dim,{opacity:[0,0]});
  }else if(back){
   add(entering,{transform:[under,'translateX(0)']});
   add(this.dim,{opacity:[PAGE_MOTION.dim,0]});
   // The plate rides with the leaving page, using the same clock as its motion.
   const plate=this.plate.animate({transform:['translateX(0)','translateX(100%)']},
    {duration:PAGE_MOTION.ms,easing:PAGE_MOTION.easing,fill:'forwards'});
   plate.currentTime=run.animations[0]?.currentTime??0;moves.push(plate);
  }else{
   add(entering,{transform:['translateX(100%)','translateX(0)']});
   add(this.plate,{transform:['translateX(100%)','translateX(0)']});
   add(this.dim,{opacity:[0,PAGE_MOTION.dim]});
  }
  run.animations.push(...moves);
  // Images on the new page are decoded (or given DECODE_WAIT) and one frame is drawn before it moves.
  const images=[...entering.querySelectorAll('img')].filter(img=>img.decode&&!img.complete);
  const decoded=Promise.race([Promise.all(images.map(img=>img.decode().catch(()=>{}))),
   new Promise(resolve=>view.setTimeout(resolve,DECODE_WAIT))]);
  const frame=()=>new Promise(resolve=>view.requestAnimationFrame(()=>resolve()));
  decoded.then(frame).then(()=>{
   if(this.run!==run)return;
   for(const animation of moves)if(animation.playState==='paused')animation.play();
   Promise.all(run.animations.map(animation=>animation.finished)).then(()=>{if(this.run===run)this.end(run);},
    ()=>{});
  });
 }
 end(run){
  if(this.run!==run)return;this.run=null;
  for(const animation of run.animations)animation.cancel();
  for(const node of run.held)for(const name of HELD)node.style.removeProperty(name);
  run.observer?.disconnect();
  if(run.unhid)run.old.hidden=true;
  run.done?.();
 }
 // A new navigation or a touch: the new page, in place, at once.
 finish(){
  const run=this.run;if(!run)return;
  if(!run.committed){run.committed=true;this.committing=true;try{run.present();}finally{this.committing=false;}}
  this.end(run);
 }
}
