import {Spring,SPRING,rubberBand,project} from './motion.js';
// An element marked data-pv-gesture-owner (P9, docs/MOTION.md §3.10.3) owns every gesture inside it, except in the
// 36px back-edge zone, which it leaves to the back gesture.
const OWNER='[data-pv-gesture-owner]';
const ownedAway=(event,rect)=>!!event.target.closest?.(OWNER)&&event.clientX-rect.left>=SWIPE_EDGE;
// Navigation is recognition only. Resource/session ownership never lives in a gesture.
export function gestureIntent({dx,dy,duration=500,edge=false,bottom=false,interactive=false,contentSwipe=false,detailDown=false,width=1024}){
 if(interactive||!Number.isFinite(dx)||!Number.isFinite(dy))return null;
 const horizontal=Math.abs(dx)>Math.abs(dy)*1.6,vertical=Math.abs(dy)>Math.abs(dx)*1.6;
 const distance=Math.max(55,Math.min(90,width*.075));
 if(detailDown&&vertical&&dy>90&&duration<1000)return 'back';
 if(bottom&&vertical&&dy<-distance&&duration<1200)return 'controls';
 if(edge&&horizontal&&dx>distance&&duration<1200)return 'back';
 if(contentSwipe&&horizontal&&Math.abs(dx)>distance&&duration<1200)return dx<0?'next-view':'previous-view';
 return null;
}
export function attachGestures(surface,{navigate,customize,preview=()=>{},active=()=>true,context=()=>null,detail=()=>false,width=()=>surface.clientWidth}){
 let start,longPress,touchStart,wheelState={};const interactive='button,input,select,textarea,a,summary,dialog,[contenteditable],.pv-list,.result-list,.comparison,.chart,.weather-hours';
 const clear=()=>{clearTimeout(longPress);longPress=null;};
 const down=e=>{if(!active()||!e.isPrimary||e.button!==0)return;clear();const rect=surface.getBoundingClientRect();const blocked=!!e.target.closest(interactive)||ownedAway(e,rect);const target=e.target.closest('[data-customize]');start={context:context(),id:e.pointerId,x:e.clientX,y:e.clientY,at:performance.now(),target:e.target,edge:e.clientX-rect.left<36,contentSwipe:!!e.target.closest('pv-step-guide'),bottom:rect.bottom-e.clientY<28,detailDown:detail()&&e.pointerType!=='mouse'&&e.pointerType!=='touch'&&atScrollTop(e.target,surface),interactive:blocked,longPressed:false};if(target&&!blocked){longPress=setTimeout(()=>{if(start&&active()&&start.context===context()){start.longPressed=true;customize?.(target.dataset.customize);preview(0);}},550);}};
 const move=e=>{if(!start||e.pointerId!==start.id)return;if(!active()||start.context!==context()){cancel();return;}const dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.hypot(dx,dy)>10)clear();if(start.lock===undefined&&Math.hypot(dx,dy)>10)start.lock=Math.abs(dx)>Math.abs(dy)*1.6?'horizontal':'vertical';if(!start.interactive&&start.edge&&start.lock==='horizontal'&&dx>0)preview(Math.min(1,dx/Math.max(120,width()*.24)));else preview(0);};
 const end=e=>{if(!start||e.pointerId!==start.id)return;clear();const s=start;start=null;preview(0);if(s.longPressed||!active()||s.context!==context())return;const intent=gestureIntent({dx:e.clientX-s.x,dy:e.clientY-s.y,duration:performance.now()-s.at,edge:s.edge,bottom:s.bottom,interactive:s.interactive||(s.lock==='vertical'&&!s.bottom&&!s.detailDown),detailDown:s.detailDown&&atScrollTop(s.target,surface),contentSwipe:s.contentSwipe,width:width()});if(intent)navigate(intent,{target:s.target});};
 const cancel=()=>{clear();start=null;touchStart=null;wheelState={};preview(0);};
 const wheel=e=>{const blocked=!!e.target.closest('input,select,textarea,dialog,[contenteditable],.weather-hours,.comparison,.chart');const result=wheelGesture(wheelState,{dx:e.deltaX,dy:e.deltaY,at:performance.now(),blocked:blocked||e.ctrlKey||!active(),mode:e.deltaMode});wheelState=result.state;if(result.capture)e.preventDefault();if(result.intent){preview(0);navigate(result.intent,{target:e.target});}};
 const pointerCancel=()=>{const touch=touchStart;cancel();touchStart=touch;};
 const touchDown=e=>{touchStart=null;if(!active()||!detail()||e.touches.length!==1||e.target.closest(interactive)||e.target.closest(OWNER)||!atScrollTop(e.target,surface))return;const p=e.touches[0];touchStart={x:p.clientX,y:p.clientY,id:p.identifier,target:e.target,context:context(),at:performance.now()};};
 const touchMove=e=>{if(touchStart&&(e.touches.length!==1||!atScrollTop(touchStart.target,surface)))touchStart=null;};
 const touchEnd=e=>{const s=touchStart;touchStart=null;if(!s||!active()||!detail()||s.context!==context()||!atScrollTop(s.target,surface))return;const p=[...e.changedTouches].find(t=>t.identifier===s.id);if(p&&gestureIntent({dx:p.clientX-s.x,dy:p.clientY-s.y,duration:performance.now()-s.at,detailDown:true})==='back')navigate('back',{target:s.target});};
 surface.addEventListener('touchstart',touchDown,{passive:true});surface.addEventListener('touchmove',touchMove,{passive:true});surface.addEventListener('touchend',touchEnd,{passive:true});surface.addEventListener('touchcancel',cancel);
 surface.ownerDocument?.defaultView?.addEventListener('blur',cancel);
 surface.addEventListener('wheel',wheel,{passive:false});
 surface.addEventListener('pointerdown',down);surface.addEventListener('pointermove',move);surface.addEventListener('pointerup',end);surface.addEventListener('pointercancel',pointerCancel);surface.addEventListener('lostpointercapture',pointerCancel);
 return ()=>{cancel();surface.removeEventListener('touchstart',touchDown);surface.removeEventListener('touchmove',touchMove);surface.removeEventListener('touchend',touchEnd);surface.removeEventListener('touchcancel',cancel);surface.ownerDocument?.defaultView?.removeEventListener('blur',cancel);surface.removeEventListener('wheel',wheel);surface.removeEventListener('pointerdown',down);surface.removeEventListener('pointermove',move);surface.removeEventListener('pointerup',end);surface.removeEventListener('pointercancel',pointerCancel);surface.removeEventListener('lostpointercapture',pointerCancel);};
}

// Trackpads report horizontal wheel bursts; touch/mouse gestures use pointer events.
export function wheelGesture(state,{dx,dy,at,blocked=false,mode=0}){
 if(blocked||mode!==0||!Number.isFinite(dx)||!Number.isFinite(dy)||!Number.isFinite(at))return {state:{},capture:false,intent:null};
 const fresh=!Number.isFinite(state.at)||at-state.at>180;
 const next=fresh?{at,total:0,fired:false,axis:null}:{...state,at};
 if(next.axis===null&&Math.abs(dx)+Math.abs(dy)>2)next.axis=Math.abs(dx)>Math.abs(dy)*2?'horizontal':'vertical';
 const capture=next.axis==='horizontal'&&dx<0;
 if(capture&&!next.fired)next.total+=-dx;
 const intent=capture&&!next.fired&&next.total>=110?'back':null;
 if(intent)next.fired=true;
 return {state:next,capture,intent};
}

// A downward gesture may return only if every containing scroll area began at top.
function atScrollTop(target,surface){for(let n=target;n&&n!==surface;n=n.parentElement)if(n.scrollTop>1)return false;return true;}

// P9 track B (docs/MOTION.md §3.10.3): a 1-D swipe track with a fractional index p (0…count−1). The finger moves p
// 1:1 (pitch px per index) after a 10px slop with an axis lock; past either end it meets the iOS rubber-band (c .55).
// On release the fling is projected with UIScrollView's rate (p + v·0.499/pitch), limited to ±maxJump from the
// start, and a Spring carries p there with the finger's velocity: flick above 300 px/s, snappy below. A touch on a
// running spring catches it (never a tap). A short touch that caught nothing is a tap. Reduced: the finger still
// tracks 1:1; the release settles on quick and never travels more than one index. Vertical gestures stay with the
// browser (touch-action: pan-y). onFrame(p) draws, onStart() runs when p starts to move, onSettle(index) once the
// spring rests, onTap(target) for a tap.
export const SWIPE_SLOP=10,SWIPE_EDGE=36;
export function swipeVelocity(samples,window=80){
 const last=samples.at(-1);if(!last)return 0;
 const recent=samples.filter(s=>last.t-s.t<=window);if(recent.length<2)return 0;
 const n=recent.length,mt=recent.reduce((a,s)=>a+s.t,0)/n,mx=recent.reduce((a,s)=>a+s.x,0)/n;
 let num=0,den=0;for(const s of recent){num+=(s.t-mt)*(s.x-mx);den+=(s.t-mt)**2;}
 return den>0?num/den*1000:0;
}
export function swipeTarget({p,start,velocity,pitch,count,reduced=false,maxJump=6}){
 const last=Math.max(0,count-1),index=-velocity/pitch;
 const projected=p+(reduced?0:project(-velocity)/pitch);
 const reach=reduced?1:maxJump,round=Math.round(start);
 const target=Math.max(0,Math.min(last,Math.max(round-reach,Math.min(round+reach,Math.round(projected)))));
 const spec=reduced?SPRING.quick:Math.abs(velocity)>300?SPRING.flick:SPRING.snappy;
 return {target,velocity:index,spec};
}
export function attachSwipeTrack(node,{pitch,count,index=0,onFrame=()=>{},onSettle=()=>{},onTap=()=>{},
 onStart=()=>{},reduced=()=>false,edge=SWIPE_EDGE,maxJump=6,raf,now}={}){
 let p=index,spring=null,gesture=null,suppress=false;
 const clock=now||(()=>globalThis.performance.now());
 const draw=value=>{p=value;onFrame(p);};
 const settle=(target,{velocity=0,spec=SPRING.snappy}={})=>{
  onStart();
  spring=new Spring(reduced()?SPRING.quick:spec,{value:p,velocity,raf,now,onFrame:draw,
   onRest:value=>{spring=null;draw(value);onSettle(Math.round(value));}});
  spring.to(target,{velocity});
 };
 const width=()=>gesture?.width||node.getBoundingClientRect?.().width||pitch;
 const bounded=raw=>{
  const last=count-1,size=width();
  if(raw<0)return -rubberBand(-raw*pitch,size)/pitch;
  if(raw>last)return last+rubberBand((raw-last)*pitch,size)/pitch;
  return raw;
 };
 const down=event=>{
  suppress=false;
  if(!event.isPrimary||event.button>0)return;
  const rect=node.getBoundingClientRect();
  if(event.clientX-rect.left<edge)return;
  const caught=!!spring&&!spring.resting;
  if(caught){spring.stop();p=spring.value;spring=null;onStart();draw(p);}
  gesture={id:event.pointerId,x0:event.clientX,y0:event.clientY,p0:p,start:Math.round(p),caught,phase:'slop',
   width:rect.width,target:event.target,samples:[{t:clock(),x:event.clientX}]};
 };
 const move=event=>{
  if(!gesture||event.pointerId!==gesture.id)return;
  const dx=event.clientX-gesture.x0,dy=event.clientY-gesture.y0;
  if(gesture.phase==='slop'){
   if(Math.hypot(dx,dy)<SWIPE_SLOP)return;
   if(Math.abs(dx)>Math.abs(dy)*1.2){
    gesture.phase='drag';gesture.x0=event.clientX;gesture.p0=p;onStart();
    try{node.setPointerCapture?.(event.pointerId);}catch{}
   }else{const caught=gesture.caught;gesture=null;if(caught)settle(Math.round(p),{spec:SPRING.quick});return;}
  }
  const points=event.getCoalescedEvents?.()||[];
  for(const point of points.length?points:[event])gesture.samples.push({t:clock(),x:point.clientX});
  gesture.samples=gesture.samples.filter(s=>gesture.samples.at(-1).t-s.t<=100);
  draw(bounded(gesture.p0-(event.clientX-gesture.x0)/pitch));
 };
 const up=event=>{
  if(!gesture||event.pointerId!==gesture.id)return;
  const g=gesture;gesture=null;suppress=true;
  if(g.phase==='slop'){
   if(g.caught)settle(Math.round(p));
   else onTap(g.target,event);
   return;
  }
  // The release point counts: a finger that rested before lifting has no velocity left.
  g.samples.push({t:clock(),x:event.clientX});
  const velocity=swipeVelocity(g.samples),last=count-1;
  if(p<0||p>last){settle(p<0?0:last,{velocity:-velocity/pitch});return;}
  const next=swipeTarget({p,start:g.start,velocity,pitch,count,reduced:reduced(),maxJump});
  settle(next.target,{velocity:next.velocity,spec:next.spec});
 };
 const cancel=event=>{
  if(!gesture||event.pointerId!==gesture.id)return;
  const g=gesture;gesture=null;
  if(g.phase==='drag'||g.caught)settle(Math.max(0,Math.min(count-1,Math.round(p))),{spec:SPRING.quick});
 };
 const click=event=>{if(suppress){suppress=false;event.preventDefault();event.stopImmediatePropagation();}};
 const key=()=>{suppress=false;};
 node.addEventListener('pointerdown',down);node.addEventListener('pointermove',move);
 node.addEventListener('pointerup',up);node.addEventListener('pointercancel',cancel);
 node.addEventListener('click',click,true);node.addEventListener('keydown',key,true);
 draw(p);
 return {
  get value(){return p;},
  get moving(){return !!gesture||!!spring;},
  // Animate to an index (a tap on a neighbour, the arrow keys); a running spring keeps its velocity.
  to(target){
   const k=Math.max(0,Math.min(count-1,target));
   if(spring&&!spring.resting){spring.to(k);return;}
   settle(k);
  },
  target(){return spring&&!spring.resting?spring.target:Math.round(p);},
  stop(){if(spring){spring.stop();spring=null;}gesture=null;},
  dispose(){
   this.stop();
   node.removeEventListener('pointerdown',down);node.removeEventListener('pointermove',move);
   node.removeEventListener('pointerup',up);node.removeEventListener('pointercancel',cancel);
   node.removeEventListener('click',click,true);node.removeEventListener('keydown',key,true);
  },
 };
}
