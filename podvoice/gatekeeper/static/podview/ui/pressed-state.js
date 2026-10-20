// Pointer feedback is presentation only; activation remains the native click.
export function attachPressedState(surface){
 let pressed=null,pointerId=null,origin=null;const win=surface.ownerDocument?.defaultView;
 const clear=()=>{pressed?.classList.remove('is-pressed');pressed=null;pointerId=null;origin=null;};
 const down=event=>{clear();if(event.isPrimary===false||event.button>0)return;const path=event.composedPath?.()||[event.target];const target=path.find(node=>node?.matches?.('button,a[href],[role="button"]'));
  if(!target||target.disabled||target.getAttribute?.('aria-disabled')==='true'||target.closest?.('[inert]'))return;
  pressed=target;pointerId=event.pointerId;origin={x:event.clientX,y:event.clientY};target.classList.add('is-pressed');
 };
 const up=event=>{if(event.pointerId===pointerId)clear();};
 const move=event=>{if(event.pointerId===pointerId&&origin&&Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>10)clear();};
 surface.addEventListener('pointerdown',down,true);surface.addEventListener('pointermove',move,true);
 for(const name of ['pointerup','pointercancel','lostpointercapture'])win?.addEventListener(name,up,true);
 win?.addEventListener('blur',clear);const visibility=()=>{if(surface.ownerDocument?.hidden)clear();};surface.ownerDocument?.addEventListener('visibilitychange',visibility);
 return ()=>{clear();surface.removeEventListener('pointerdown',down,true);surface.removeEventListener('pointermove',move,true);for(const name of ['pointerup','pointercancel','lostpointercapture'])win?.removeEventListener(name,up,true);win?.removeEventListener('blur',clear);surface.ownerDocument?.removeEventListener('visibilitychange',visibility);};
}
