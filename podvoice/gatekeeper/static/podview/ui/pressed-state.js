// Presentation-only press feedback; native click and keyboard activation keep ownership.
export function attachPressedState(surface){
 const doc=surface.ownerDocument||surface,root=doc.nodeType===9?doc:surface,win=doc.defaultView,feedback=new Map();let pressed=null,pointerId=null,origin=null,pointerFocus=null,pointerModality=false;
 const unavailable=target=>!target||target.disabled||target.getAttribute?.('aria-disabled')==='true'||target.closest?.('[inert]');
 const clear=()=>{pressed?.classList.remove('is-pressed');pressed=null;pointerId=null;origin=null;};
 const clearFocus=()=>{pointerFocus?.removeAttribute?.('data-pv-pointer-focus');pointerFocus=null;};
 const cancelFeedback=target=>{feedback.get(target)?.cancel();feedback.delete(target);};
 const acknowledge=(target,shadow)=>{
  if(unavailable(target)||target.isConnected===false||doc.hidden||typeof target.animate!=='function')return;
  cancelFeedback(target);const quiet=target.dataset?.pvPress==='quiet',animation=target.animate(quiet?[{opacity:.64},{opacity:1}]:[{boxShadow:'inset 0 0 0 999px color-mix(in srgb,currentColor 12%,transparent)'},{boxShadow:shadow||'none'}],{duration:90,easing:'cubic-bezier(.2,0,0,1)'});feedback.set(target,animation);
  animation.finished?.catch(()=>{}).finally(()=>{if(feedback.get(target)===animation)feedback.delete(target);});
 };
 const down=event=>{
  if(event.isPrimary===false||event.button>0)return;if(event.pointerId!=='keyboard')pointerModality=true;clear();const path=event.composedPath?.()||[event.target],index=path.findIndex(node=>node?.matches?.('button,a[href],summary,[role="button"]')),target=path[index];
  // A nested native field owns its gesture and selection, not its card wrapper.
  if(index<0||path.slice(0,index+1).some(node=>node?.matches?.('input,select,textarea,[role="slider"],[contenteditable]:not([contenteditable="false"])'))||unavailable(target))return;
  cancelFeedback(target);if(event.pointerId!=='keyboard'){clearFocus();pointerFocus=target;target.setAttribute?.('data-pv-pointer-focus','true');}
  const shadow=win?.getComputedStyle?.(target)?.boxShadow||'none';pressed=target;pointerId=event.pointerId;origin={x:event.clientX,y:event.clientY,shadow};target.classList.add('is-pressed');
 };
 const up=event=>{if(event.pointerId!==pointerId)return;const target=pressed,shadow=origin?.shadow;clear();if(event.type==='pointerup'||event.type===undefined)acknowledge(target,shadow);};
 const move=event=>{if(event.pointerId===pointerId&&origin&&Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>10)clear();};
 const keydown=event=>{pointerModality=false;clearFocus();if(event.repeat||!['Enter',' '].includes(event.key))return;down({...event,composedPath:()=>event.composedPath?.()||[event.target],isPrimary:true,button:0,pointerId:'keyboard',clientX:0,clientY:0});};
 const keyup=event=>{if(pointerId==='keyboard'&&['Enter',' '].includes(event.key)){const target=pressed,shadow=origin?.shadow;clear();acknowledge(target,shadow);}};
 const focusin=event=>{if(!pointerModality)return;const path=event.composedPath?.()||[event.target],index=path.findIndex(node=>node?.matches?.('button,a[href],summary,[role="button"]')),target=path[index];clearFocus();if(index<0||path.slice(0,index+1).some(node=>node?.matches?.('input,select,textarea,[role="slider"],[contenteditable]:not([contenteditable="false"])'))||unavailable(target))return;pointerFocus=target;target.setAttribute?.('data-pv-pointer-focus','true');};
 const cancel=()=>{clear();for(const animation of feedback.values())animation.cancel();feedback.clear();};
 const visibility=()=>{if(doc.hidden)cancel();};
 root.addEventListener('focusin',focusin,true);root.addEventListener('keydown',keydown,true);win?.addEventListener('keyup',keyup,true);root.addEventListener('pointerdown',down,true);root.addEventListener('pointermove',move,true);
 for(const name of ['pointerup','pointercancel','lostpointercapture'])win?.addEventListener(name,up,true);
 win?.addEventListener('blur',cancel);doc.addEventListener?.('visibilitychange',visibility);
 return ()=>{cancel();clearFocus();root.removeEventListener('focusin',focusin,true);root.removeEventListener('keydown',keydown,true);win?.removeEventListener('keyup',keyup,true);root.removeEventListener('pointerdown',down,true);root.removeEventListener('pointermove',move,true);for(const name of ['pointerup','pointercancel','lostpointercapture'])win?.removeEventListener(name,up,true);win?.removeEventListener('blur',cancel);doc.removeEventListener?.('visibilitychange',visibility);};
}
