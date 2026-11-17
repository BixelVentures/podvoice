// Page push and pop as live layers (docs/MOTION.md §0, §3.2), with no view transition and nothing snapshotted, as
// UINavigationController and Ionic's ios.transition.ts. The leaving page starts moving in the frame after the tap,
// before anything renders (a compositor animation, so it keeps moving while the new page renders). The new page then
// renders off-screen at 100 % (one render, never again during the motion), one frame is drawn, and it slides in.
// The leaving page stays mounted and painted, out of the flow and not yet [hidden], until the motion ends.
// Push: new 100 % -> 0 over the old, which goes 0 -> -33 % under a dim. Pop: the top page goes 0 -> 100 % over the
// one beneath, which comes from -33 % as its dim lifts. A paper plate moves with the top page, so nothing shows
// through its gaps. Only transform and opacity animate. A new navigation finishes it at once.
// Reduced: the new page cross-fades in over the old in REDUCED_MS.
//
// No hitches (docs/MOTION.md §0): every geometry read happens at the tap, while the layout is clean and before any
// write. The commit writes everything first and then renders, so the frame has one style and layout pass, and reads
// nothing. The page containers, plate and dim are permanent compositing layers (ui-kit.css), so no layer is made in
// the first frame. The plate and dim are made ahead of time (prepare(), while idle), and the images on hidden pages
// are decoded then too, so a tap neither inserts nodes nor waits for a decode. While a run is moving nothing else
// renders (holdRender(); the host renders once when it has ended).
import {begin as beginBusy} from './motion-busy.js';

export const PAGE_MOTION=Object.freeze({ms:500,easing:'cubic-bezier(.32,.72,0,1)',under:-33,dim:.1});
const REDUCED_MS=200,DECODE_WAIT=120;
// Inline properties the layer sets on a page while it moves; all are removed at the end.
const HELD=['display','position','left','top','width','height','margin','z-index','pointer-events','background-color',
 'box-sizing'];
const page=node=>node.id!=='resource-rail'&&!node.dataset?.pvPageLayer&&!(node.localName==='dialog'&&!node.open);

export class PageLayer {
 constructor(host){this.host=host;this.run=null;}
 get doc(){return this.host.ownerDocument;}
 get view(){return this.doc.defaultView||globalThis;}
 get moving(){return !!this.run;}
 feed(){return this.host.querySelector('.responses');}
 available(){return typeof this.host.animate==='function'&&this.host.isConnected!==false&&!!this.feed();}
 // The page on screen, from attributes alone (no layout): one page in the feed is not [hidden]. Only when that is
 // ambiguous does it ask the layout.
 visiblePage(feed,except=null){
  const pages=[...feed.children].filter(node=>node!==except&&!node.hidden&&page(node));
  return pages.length<2?pages[0]||null:pages.find(node=>node.getClientRects().length)||null;
 }
 // The plate (paper that moves with the top page) and the dim, made once inside the page area and hidden at rest.
 helpers(feed){
  if(this.plate?.parentNode===feed)return;
  const make=kind=>{const node=this.doc.createElement('div');node.dataset.pvPageLayer=kind;node.hidden=true;
   node.setAttribute('aria-hidden','true');feed.append(node);return node;};
  this.plate=make('plate');this.dim=make('dim');
 }
 // Ahead of time, while idle: the plate and dim exist, and the loaded images on the hidden pages are decoded.
 prepare(){
  const feed=this.feed();if(!feed||this.run)return;
  this.helpers(feed);
  for(const img of feed.querySelectorAll('img'))if(img.decode&&img.complete&&img.currentSrc&&
   !this.decoded?.has(img.currentSrc)){(this.decoded??=new Set()).add(img.currentSrc);img.decode().catch(()=>{});}
 }
 // present() renders the new page. The old page moves at once; the new page's motion starts once it is drawn.
 go({back=false,reduced=false,present,done}){
  this.finish();
  const feed=this.feed(),old=this.visiblePage(feed);
  if(!old){present();done?.();return null;}
  this.helpers(feed);
  // Every read the run needs, now: nothing has been written in this tap, so the layout is clean.
  const view=this.view,display=view.getComputedStyle(old).display,box=old.getBoundingClientRect();
  const area=feed.getBoundingClientRect(),scale=area.width?feed.offsetWidth/area.width:1;
  const geometry={left:(box.left-area.left)*scale-feed.clientLeft,top:(box.top-area.top)*scale-feed.clientTop,
   width:box.width*scale,height:box.height*scale,viewWidth:feed.clientWidth,viewHeight:feed.clientHeight};
  const run={back,reduced,present,done,old,display,geometry,animations:[],committed:false,held:[],idle:beginBusy()};
  this.run=run;
  // Busy (ui/motion-busy.js) from here until end(), the one place a run stops: its motion finished, or finish().
  if(!reduced){
   // The leaving page moves in the next frame: under to -33 % (push), or out to 100 % (pop).
   const to=back?'100%':`${PAGE_MOTION.under}%`;
   run.animations.push(old.animate({transform:['translateX(0)',`translateX(${to})`]},
    {duration:PAGE_MOTION.ms,easing:PAGE_MOTION.easing,fill:'forwards'}));
  }
  // The render waits one drawn frame, so the leaving page is already moving (on the compositor) when it runs.
  // Reduced has nothing moving to wait for: it renders in the next frame.
  const commit=()=>{if(this.run===run)this.commit(run);};
  view.requestAnimationFrame(reduced?commit:()=>view.requestAnimationFrame(commit));
  return run;
 }
 // Nothing renders while a run is moving, except the run's own render (the commit).
 holdRender(){return !!this.run&&!this.committing;}
 // The feed scrolls to the new page's position inside present() (SceneMotion.enter: 0 on push, the page's own on
 // pop). The nodes are placed for that position without reading it; the frame after corrects them if the browser
 // clamped it.
 expectedScroll(run){return run.back?this.host.motion?.scroll?.get?.(this.host.state?.focus)||0:0;}
 place(run,scrollTop){
  const g=run.geometry,set=(node,name,value)=>node.style.setProperty(name,`${value}px`,'important');
  set(run.old,'left',g.left);set(run.old,'top',g.top+scrollTop);
  for(const node of [this.plate,this.dim])set(node,'top',scrollTop);
  run.scrollTop=scrollTop;
 }
 // The old page keeps its look until the motion ends: a render that hides it (the state no longer shows it) is
 // remembered, not applied, so its subtree is not thrown away and rebuilt in the commit, and its own :not([hidden])
 // rules still hold. end() applies the hide.
 keep(run){
  const old=run.old,own=Object.getOwnPropertyDescriptor(this.view.HTMLElement.prototype,'hidden');
  run.hidden=old.hidden;
  Object.defineProperty(old,'hidden',{configurable:true,get:()=>run.hidden,set:value=>{run.hidden=!!value;}});
  if(run.hidden)own.set.call(old,false);
  run.release=()=>{delete old.hidden;if(run.hidden)old.hidden=true;};
 }
 commit(run){
  const feed=this.feed(),view=this.view,old=run.old,g=run.geometry,back=run.back,reduced=run.reduced;
  run.committed=true;
  // Every write before the render, so the render's one layout (SceneMotion.enter scrolls the feed) lays out all of
  // it: the old page out of the flow where it is, the plate and dim over the visible part of the feed.
  const hold=(node,values)=>{run.held.push(node);
   for(const [name,value]of Object.entries(values))node.style.setProperty(name,value,'important');};
  hold(old,{display:run.display,position:'absolute',width:`${g.width}px`,height:`${g.height}px`,margin:'0',
   'box-sizing':'border-box','pointer-events':'none','z-index':back&&!reduced?'3':'0'});
  const cover={display:'block',position:'absolute',left:'0',width:`${g.viewWidth}px`,height:`${g.viewHeight}px`,
   margin:'0','pointer-events':'none'};
  hold(this.plate,{...cover,'z-index':'2','background-color':'var(--pv-screen-paper)'});
  hold(this.dim,{...cover,'z-index':'1','background-color':'#000'});
  this.place(run,this.expectedScroll(run));
  this.keep(run);
  this.committing=true;
  try{run.present();}finally{this.committing=false;}
  const entering=this.visiblePage(feed,old);
  if(!entering||!old.isConnected){this.end(run);return;}
  run.entering=entering;
  // The page on top carries the paper under its own content too; the new page sits above the old on push.
  if(!back||reduced)hold(entering,{position:'relative','z-index':'3'});
  // Everything new starts where it begins, paused, until the new page is drawn.
  const timing={duration:reduced?REDUCED_MS:PAGE_MOTION.ms,easing:reduced?'linear':PAGE_MOTION.easing,fill:'both'};
  const moves=[];
  const add=(node,frames)=>{const animation=node.animate(frames,timing);animation.pause();moves.push(animation);};
  const under=`translateX(${PAGE_MOTION.under}%)`;
  if(reduced){
   add(entering,{opacity:[0,1]});add(this.plate,{opacity:[0,1]});add(this.dim,{opacity:[0,0]});
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
  // Images still loading on the new page get up to DECODE_WAIT (loaded ones were decoded while idle); one frame
  // is drawn, and then it moves.
  const images=[...entering.querySelectorAll('img')].filter(img=>img.decode&&!img.complete);
  const decoded=images.length?Promise.race([Promise.all(images.map(img=>img.decode().catch(()=>{}))),
   new Promise(resolve=>view.setTimeout(resolve,DECODE_WAIT))]):Promise.resolve();
  decoded.then(()=>new Promise(resolve=>view.requestAnimationFrame(resolve))).then(()=>{
   if(this.run!==run)return;
   // The frame has been laid out, so this read is free; it differs only when the browser clamped the scroll.
   const scrollTop=feed.scrollTop;if(Math.abs(scrollTop-run.scrollTop)>.5)this.place(run,scrollTop);
   for(const animation of moves)if(animation.playState==='paused')animation.play();
   Promise.all(run.animations.map(animation=>animation.finished)).then(()=>{if(this.run===run)this.end(run);},
    ()=>{});
  });
 }
 end(run){
  if(this.run!==run)return;this.run=null;// Not busy any more (see go()).
  run.idle?.();
  for(const animation of run.animations)animation.cancel();
  for(const node of run.held)for(const name of HELD)node.style.removeProperty(name);
  run.release?.();
  run.done?.();
 }
 // A new navigation: the new page, in place, at once.
 finish(){
  const run=this.run;if(!run)return;
  if(!run.committed){run.committed=true;this.committing=true;try{run.present();}finally{this.committing=false;}}
  this.end(run);
 }
}
