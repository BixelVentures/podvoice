// P3 press feedback (docs/MOTION.md). Native click and keyboard activation keep ownership; this only paints.
// One delegated capture listener finds the control; the feedback is Web Animations on that control alone: scale
// (tiles .97, buttons .98, icons none), a 12% overlay, a dim for quiet controls and a circle under the finger for
// flat surfaces. Down follows the finger in --pv-dur-tap; release springs back on Motion's quick spring. Nothing
// writes a class, an attribute or an inline style, so a press never invalidates selectors elsewhere on the page
// (the stylesheet has hundreds of :has() rules) and never wakes a MutationObserver. Reduced: no scale, no growth.
import {DUR,EASE,SPRING} from './motion.js';
import {springTiming} from './native-motion.js';

const CONTROL='button,a[href],summary,[role="button"]';
const FIELD='input,select,textarea,[role="slider"],[contenteditable]:not([contenteditable="false"])';
const FLAT='.pv-widget,[data-pv-press=flat]',QUIET='[data-pv-press=quiet]';
const ICON='.round:not(.main-control),.pv-dialog-close,.volume-mute,.pv-toggle:not(.light-lamp-toggle),'+
 '[data-pv-press=icon]';
const TILE='.pv-tile,.pv-card,.pv-hero,.resource-preview,.result,.queue-track,.cover-button,.timer-shortcut,'+
 '.svar-today-row';
const OVERLAY='inset 0 0 0 999px color-mix(in srgb,currentColor 12%,transparent)';
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
  // The circle is placed from one layout read, taken before anything is written.
  const box=event.pointerId!=='keyboard'&&target.matches(FLAT)?target.getBoundingClientRect():null;
  const previous=live.get(target),still=reduced(),scale=pressScale(target,still);
  // A press that lands on a release still in flight starts from where the control is now.
  const from=previous?.release.some(a=>a.playState==='running')?win.getComputedStyle(target).scale:'1';
  stop(target);
  const state={hold:[],release:[],scale,circle:null};live.set(target,state);
  const hold={duration:DUR.tap,easing:EASE.out,fill:'forwards'};
  if(scale<1)state.hold.push(target.animate([{scale:from==='none'?'1':from},{scale:String(scale)}],hold));
  if(target.matches(QUIET))state.hold.push(target.animate([{opacity:.64},{opacity:.64}],{duration:1,fill:'forwards'}));
  else state.hold.push(target.animate([{boxShadow:OVERLAY},{boxShadow:OVERLAY}],{duration:1,fill:'forwards'}));
  if(box){
   const x=event.clientX-box.left,y=event.clientY-box.top;
   const size=`${2*Math.hypot(Math.max(x,box.width-x),Math.max(y,box.height-y))}px`;
   state.circle={left:`${x}px`,top:`${y}px`,width:size,height:size};
   state.hold.push(target.animate([{...state.circle,opacity:1,scale:still?1:.2},{...state.circle,opacity:1,scale:1}],
    {...hold,pseudoElement:'::after'}));
  }
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
  if(state.scale<1)state.release.push(target.animate([{scale:String(state.scale)},{scale:'1'}],
   {...springTiming(SPRING.quick),delay,fill:'forwards'}));
  if(target.matches(QUIET))state.release.push(target.animate([{opacity:.64,offset:0}],fade));
  else state.release.push(target.animate([{boxShadow:OVERLAY,offset:0}],fade));
  if(state.circle)state.release.push(target.animate([{...state.circle,opacity:1,scale:1},
   {...state.circle,opacity:0,scale:1}],{...fade,pseudoElement:'::after'}));
  Promise.all(state.release.map(animation=>animation.finished)).then(()=>{
   if(live.get(target)===state)stop(target);},()=>{});
 };
 const clear=(animated=false)=>{if(pressed)release(pressed,animated);pressed=null;pointerId=null;origin=null;};
 const down=event=>{
  if(event.isPrimary===false||event.button>0)return;
  clear();
  const target=controlIn(event.composedPath?.()||[event.target]);
  if(!target||unavailable(target))return;
  pressed=target;pointerId=event.pointerId;origin={x:event.clientX,y:event.clientY};
  press(target,event);
 };
 const up=event=>{
  if(event.pointerId!==pointerId)return;
  // Release springs back; cancellation and lost capture end the press at once.
  clear(event.type==='pointerup'||event.type===undefined);
 };
 const move=event=>{
  if(event.pointerId===pointerId&&origin&&Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>10)clear();
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
