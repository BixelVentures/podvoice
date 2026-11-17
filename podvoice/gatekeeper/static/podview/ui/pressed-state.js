// P3 press feedback (docs/MOTION.md). Native click and keyboard activation keep ownership; this only paints.
// One delegated capture listener finds the control; the feedback is Web Animations on that control alone, and only
// on properties the compositor runs (Core Animation on the iPad, cc in Chromium): scale (tiles .97 and nothing else,
// buttons .98, icons and flat surfaces none) and opacity (buttons and flat surfaces dim a little, quiet controls
// more). No box-shadow overlay, no ripple circle (it animated left/top/width/height), no colour: those repaint on
// the main thread every frame. Down follows the finger in --pv-dur-tap;
// release springs back on Motion's quick spring (critically damped: no overshoot) as plain keyframes (springFrames),
// because WebKit does not accelerate a linear() easing. Nothing writes a class, an attribute or an inline style, so a
// press never invalidates selectors elsewhere on the page and never wakes a MutationObserver. Reduced: no scale; a
// tile dims instead.
// Inside a scroller a touch may be the start of a scroll, so the press waits, as UIScrollView's
// delaysContentTouches does: it shows once the finger has rested HOLD (150) ms, or at once on a quick tap's release
// (shown in full, then springing back). A scroll, a move past the slop or a pointercancel before that shows nothing;
// one after it ends the press where it is, without a spring back, so nothing hops.
import {DUR,EASE,SPRING} from './motion.js';
import {springFrames} from './native-motion.js';

const CONTROL='button,a[href],summary,[role="button"]';
const FIELD='input,select,textarea,[role="slider"],[contenteditable]:not([contenteditable="false"])';
const FLAT='.pv-widget,[data-pv-press=flat]',QUIET='[data-pv-press=quiet]',NONE='[data-pv-press=none]';
const ICON='.round:not(.main-control),.pv-dialog-close,.volume-mute,.pv-toggle:not(.light-lamp-toggle),'+
 '[data-pv-press=icon]';
const TILE='.pv-tile,.pv-card,.pv-hero,.resource-preview,.result,.queue-track,.cover-button,.timer-shortcut,'+
 '.svar-today-row';
// UIScrollView delays content touches 150 ms; UIKit's tap slop is ~10 pt. A pressed button dims to BUTTON_DIM (as a
// UIButton highlight), a quiet control to QUIET_DIM, a reduced-motion tile to TILE_DIM.
const HOLD=150,SLOP=10,BUTTON_DIM=.84,QUIET_DIM=.64,TILE_DIM=.8;
export function pressScale(node,reduced=false){
 if(reduced||node.matches(FLAT)||node.matches(ICON))return 1;
 return node.matches(TILE)?.97:.98;
}
// The control a press belongs to, or null when a native field inside it owns the gesture.
function controlIn(path){
 const index=path.findIndex(node=>node?.matches?.(CONTROL));
 if(index<0||path.slice(0,index+1).some(node=>node?.matches?.(FIELD)))return null;
 return path[index];
}
// Whether the control sits in something the finger can scroll (the path runs from the control outwards). Which
// ancestors can scroll at all (overflow auto/scroll) is read once per control; only whether one of them overflows
// now is read on each touch, so a press reads no style.
const scrollers=new WeakMap();
function inScroller(control,path,win){
 let candidates=scrollers.get(control);
 if(!candidates){
  candidates=path.filter(node=>{
   if(node?.nodeType!==1||node===node.ownerDocument?.documentElement)return false;
   const style=win.getComputedStyle(node);return /auto|scroll/.test(`${style.overflowX} ${style.overflowY}`);
  });
  scrollers.set(control,candidates);
 }
 return candidates.some(node=>node.scrollHeight>node.clientHeight+1||node.scrollWidth>node.clientWidth+1);
}
export function attachPressedState(surface){
 const doc=surface.ownerDocument||surface,root=doc.nodeType===9?doc:surface,win=doc.defaultView;
 // Per control: the animations holding the pressed look, and a token that stale releases check.
 const live=new Map();
 let pressed=null,pointerId=null,origin=null;
 const unavailable=target=>!target||target.disabled||target.getAttribute?.('aria-disabled')==='true'||
  target.closest?.('[inert]');
 const reduced=()=>doc.documentElement?.dataset?.pvMotion==='reduced';
 const stop=target=>{const state=live.get(target);if(!state)return;live.delete(target);
  for(const animation of [...state.hold,...state.release])animation.cancel();};
 const press=(target,event)=>{
  if(typeof target.animate!=='function')return;
  const previous=live.get(target),still=reduced(),scale=pressScale(target,still);
  // A press that lands on a release still in flight starts from where the control is now.
  const from=previous?.release.some(a=>a.playState==='running')?win.getComputedStyle(target).scale:'1';
  stop(target);
  const tile=target.matches(TILE);
  // dim: the opacity a button, flat surface or quiet control holds while pressed (null: none).
  const dim=tile?null:target.matches(QUIET)?QUIET_DIM:BUTTON_DIM;
  const state={hold:[],release:[],scale,tile,dim};live.set(target,state);
  const hold={duration:DUR.tap,easing:EASE.out,fill:'forwards'};
  if(scale<1)state.hold.push(target.animate([{scale:from==='none'?'1':from},{scale:String(scale)}],hold));
  // A card or tile (UICollectionViewCell, SwiftUI's press) only scales: no colour, shadow or brightness change.
  // With reduced motion it dims instead, on the same curve. A button dims at once, as a UIButton highlights.
  if(tile){if(still)state.hold.push(target.animate([{opacity:1},{opacity:TILE_DIM}],hold));}
  else if(dim!==null)state.hold.push(target.animate([{opacity:dim},{opacity:dim}],{duration:1,fill:'forwards'}));
 };
 // Release starts when the touch-down has finished (a delay, not a wait), so even the fastest tap shows the whole
 // press before it springs back, and the release exists from the moment of release. The press holds until the
 // release takes over; both end together, at the control's resting style.
 const release=(target,animated)=>{
  const state=live.get(target);if(!state)return;
  if(!animated){stop(target);return;}
  const down=state.hold[0];
  const delay=down?.playState==='running'?Math.max(0,DUR.tap-(Number(down.currentTime)||0)):0;
  const fade={duration:reduced()?DUR.reduced:DUR.quick,easing:EASE.out,delay,fill:'forwards'};
  if(state.scale<1){
   const {keyframes,duration}=springFrames(SPRING.quick,
    progress=>({scale:String(state.scale+(1-state.scale)*progress)}));
   state.release.push(target.animate(keyframes,{duration,delay,fill:'forwards'}));
  }
  if(state.tile){if(reduced())state.release.push(target.animate([{opacity:TILE_DIM,offset:0}],fade));}
  else if(state.dim!==null)state.release.push(target.animate([{opacity:state.dim,offset:0}],fade));
  Promise.all(state.release.map(animation=>animation.finished)).then(()=>{
   if(live.get(target)===state)stop(target);},()=>{});
 };
 // waiting: a touch in a scroller whose press is not shown yet (timer and the down event to show it from).
 let waiting=null;
 const clear=(animated=false)=>{
  if(waiting){win.clearTimeout(waiting.timer);waiting=null;}
  else if(pressed)release(pressed,animated);
  pressed=null;pointerId=null;origin=null;
 };
 const down=event=>{
  if(event.isPrimary===false||event.button>0)return;
  clear();
  const path=event.composedPath?.()||[event.target],target=controlIn(path);
  // data-pv-press=none: the control's own transition is its feedback (Ro: its photo shrinks into the finger).
  if(!target||unavailable(target)||target.matches(NONE))return;
  pressed=target;pointerId=event.pointerId;origin={x:event.clientX,y:event.clientY};
  if(event.pointerType==='touch'&&inScroller(target,path.slice(path.indexOf(target)+1),win)){
   const from={pointerId:event.pointerId,clientX:event.clientX,clientY:event.clientY};
   const show=()=>{if(!waiting||pressed!==target)return;waiting=null;press(target,from);};
   waiting={from,timer:win.setTimeout(show,HOLD)};
   return;
  }
  press(target,event);
 };
 const up=event=>{
  if(event.pointerId!==pointerId)return;
  // A quick tap in a scroller shows its press now, in full, and springs back with the rest.
  if(waiting&&event.type==='pointerup'){const {from}=waiting;win.clearTimeout(waiting.timer);waiting=null;
   press(pressed,from);}
  // Release springs back; cancellation and lost capture end the press at once.
  clear(event.type==='pointerup'||event.type===undefined);
 };
 const move=event=>{
  if(event.pointerId===pointerId&&origin&&Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>SLOP)clear();
 };
 const keydown=event=>{
  if(event.repeat||!['Enter',' '].includes(event.key))return;
  down({composedPath:()=>event.composedPath?.()||[event.target],isPrimary:true,button:0,pointerId:'keyboard',
   clientX:0,clientY:0});
 };
 const keyup=event=>{if(pointerId==='keyboard'&&['Enter',' '].includes(event.key))clear(true);};
 const cancel=()=>{clear();for(const target of [...live.keys()])stop(target);};
 const scrolled=()=>{if(pressed)clear();};
 const visibility=()=>{if(doc.hidden)cancel();};
 // iOS applies :active (used by a few row backgrounds) only on documents that listen for touches.
 const touch=()=>{};
 const rootEvents=[['keydown',keydown],['pointerdown',down],['pointermove',move],['touchstart',touch]];
 const windowEvents=[['keyup',keyup],['pointerup',up],['pointercancel',up],['lostpointercapture',up]];
 for(const [name,listener] of rootEvents)root.addEventListener(name,listener,{capture:true,passive:true});
 for(const [name,listener] of windowEvents)win?.addEventListener(name,listener,true);
 win?.addEventListener('blur',cancel);doc.addEventListener?.('visibilitychange',visibility);
 doc.addEventListener?.('scroll',scrolled,{capture:true,passive:true});
 return ()=>{
  cancel();
  for(const [name,listener] of rootEvents)root.removeEventListener(name,listener,{capture:true});
  for(const [name,listener] of windowEvents)win?.removeEventListener(name,listener,true);
  win?.removeEventListener('blur',cancel);doc.removeEventListener?.('visibilitychange',visibility);
  doc.removeEventListener?.('scroll',scrolled,{capture:true});
 };
}
