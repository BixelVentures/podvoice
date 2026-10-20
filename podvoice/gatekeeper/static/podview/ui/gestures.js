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
 const down=e=>{if(!active()||!e.isPrimary||e.button!==0)return;clear();const rect=surface.getBoundingClientRect();const blocked=!!e.target.closest(interactive);const target=e.target.closest('[data-customize]');start={context:context(),id:e.pointerId,x:e.clientX,y:e.clientY,at:performance.now(),target:e.target,edge:e.clientX-rect.left<36,contentSwipe:!!e.target.closest('pv-step-guide'),bottom:rect.bottom-e.clientY<28,detailDown:detail()&&e.pointerType!=='mouse'&&e.pointerType!=='touch'&&atScrollTop(e.target,surface),interactive:blocked,longPressed:false};if(target&&!blocked){longPress=setTimeout(()=>{if(start&&active()&&start.context===context()){start.longPressed=true;customize?.(target.dataset.customize);preview(0);}},550);}};
 const move=e=>{if(!start||e.pointerId!==start.id)return;if(!active()||start.context!==context()){cancel();return;}const dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.hypot(dx,dy)>10)clear();if(start.lock===undefined&&Math.hypot(dx,dy)>10)start.lock=Math.abs(dx)>Math.abs(dy)*1.6?'horizontal':'vertical';if(!start.interactive&&start.edge&&start.lock==='horizontal'&&dx>0)preview(Math.min(1,dx/Math.max(120,width()*.24)));else preview(0);};
 const end=e=>{if(!start||e.pointerId!==start.id)return;clear();const s=start;start=null;preview(0);if(s.longPressed||!active()||s.context!==context())return;const intent=gestureIntent({dx:e.clientX-s.x,dy:e.clientY-s.y,duration:performance.now()-s.at,edge:s.edge,bottom:s.bottom,interactive:s.interactive||(s.lock==='vertical'&&!s.bottom&&!s.detailDown),detailDown:s.detailDown&&atScrollTop(s.target,surface),contentSwipe:s.contentSwipe,width:width()});if(intent)navigate(intent,{target:s.target});};
 const cancel=()=>{clear();start=null;touchStart=null;wheelState={};preview(0);};
 const wheel=e=>{const blocked=!!e.target.closest('input,select,textarea,dialog,[contenteditable],.weather-hours,.comparison,.chart');const result=wheelGesture(wheelState,{dx:e.deltaX,dy:e.deltaY,at:performance.now(),blocked:blocked||e.ctrlKey||!active(),mode:e.deltaMode});wheelState=result.state;if(result.capture)e.preventDefault();if(result.intent){preview(0);navigate(result.intent,{target:e.target});}};
 const pointerCancel=()=>{const touch=touchStart;cancel();touchStart=touch;};
 const touchDown=e=>{touchStart=null;if(!active()||!detail()||e.touches.length!==1||e.target.closest(interactive)||!atScrollTop(e.target,surface))return;const p=e.touches[0];touchStart={x:p.clientX,y:p.clientY,id:p.identifier,target:e.target,context:context(),at:performance.now()};};
 const touchMove=e=>{if(touchStart&&(e.touches.length!==1||!atScrollTop(touchStart.target,surface)))touchStart=null;};
 const touchEnd=e=>{const s=touchStart;touchStart=null;if(!s||!active()||!detail()||s.context!==context()||!atScrollTop(s.target,surface))return;const p=[...e.changedTouches].find(t=>t.identifier===s.id);if(p&&gestureIntent({dx:p.clientX-s.x,dy:p.clientY-s.y,duration:performance.now()-s.at,detailDown:true})==='back')navigate('back',{target:s.target});};
 surface.addEventListener('touchstart',touchDown,{passive:true});surface.addEventListener('touchmove',touchMove,{passive:true});surface.addEventListener('touchend',touchEnd,{passive:true});surface.addEventListener('touchcancel',cancel);
 surface.ownerDocument?.defaultView?.addEventListener('blur',cancel);
 surface.addEventListener('wheel',wheel,{passive:false});
 surface.addEventListener('pointerdown',down);surface.addEventListener('pointermove',move);surface.addEventListener('pointerup',end);surface.addEventListener('pointercancel',pointerCancel);surface.addEventListener('lostpointercapture',pointerCancel);
 return ()=>{cancel();surface.removeEventListener('touchstart',touchDown);surface.removeEventListener('touchmove',touchMove);surface.removeEventListener('touchend',touchEnd);surface.removeEventListener('touchcancel',cancel);surface.ownerDocument?.defaultView?.removeEventListener('blur',cancel);surface.removeEventListener('wheel',wheel);surface.removeEventListener('pointerdown',down);surface.removeEventListener('pointermove',move);surface.removeEventListener('pointerup',end);surface.removeEventListener('pointercancel',pointerCancel);surface.removeEventListener('lostpointercapture',pointerCancel);};
}
export function transitionContent(element,{direction=0,duration=240}={}){
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches||element.closest('[data-motion=reduced]');const opacity=getComputedStyle(element).opacity;const transform=getComputedStyle(element).transform;const previous=element.getAnimations().find(a=>a.id==='pv-content-transition');previous?.cancel();if(element.isConnected===false||typeof element.animate!=='function')return;const frames=reduced?[{opacity:Math.min(.72,Number(opacity))},{opacity:1}]:[{opacity:Math.min(.72,Number(opacity)),transform:transform==='none'?`translateX(${direction*14}px)`:transform},{opacity:1,transform:'translateX(0)'}];const animation=element.animate(frames,{duration:reduced?120:duration,easing:'cubic-bezier(.2,0,0,1)'});animation.id='pv-content-transition';return animation;
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
