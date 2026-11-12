// Presentation-only press feedback; native click and keyboard activation keep ownership.
export function attachPressedState(surface){
 const doc=surface.ownerDocument||surface,root=doc.nodeType===9?doc:surface,win=doc.defaultView,feedback=new Map();let pressed=null,pointerId=null,origin=null,pointerFocus=null,pointerModality=false;
 const unavailable=target=>!target||target.disabled||target.getAttribute?.('aria-disabled')==='true'||target.closest?.('[inert]');
 let litePressed=null;
 const clearLite=()=>{if(!litePressed)return;litePressed.style.removeProperty('transform');
  litePressed.style.removeProperty('background-image');litePressed=null;};
 const clear=()=>{clearLite();if(!lite())pressed?.classList.remove('is-pressed');pressed=null;pointerId=null;origin=null;};
 const clearFocus=()=>{pointerFocus?.removeAttribute?.('data-pv-pointer-focus');pointerFocus=null;};
 const cancelFeedback=target=>{feedback.get(target)?.cancel();feedback.delete(target);};
 // 12 % of the button's own colour. Computed in JS instead of color-mix(), which Chrome < 111
 // (old Android WebView on wall screens) rejects, leaving taps without any feedback.
 const pressOverlay=target=>{
  const rgb=win?.getComputedStyle?.(target)?.color?.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
  const alpha=rgb?Math.round((rgb[4]===undefined?1:+rgb[4])*12)/100:.12;
  return rgb?`rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`:`rgba(0, 0, 0, ${alpha})`;
 };
 const acknowledge=(target,shadow)=>{
  if(unavailable(target)||target.isConnected===false||doc.hidden||typeof target.animate!=='function')return;
  cancelFeedback(target);
  const quiet=target.dataset?.pvPress==='quiet';
  const frames=quiet
   ?[{opacity:.64},{opacity:1}]
   :[{boxShadow:`inset 0 0 0 999px ${pressOverlay(target)}`},{boxShadow:shadow||'none'}];
  const animation=target.animate(frames,{duration:90,easing:'cubic-bezier(.2,0,0,1)'});feedback.set(target,animation);
  animation.finished?.catch(()=>{}).finally(()=>{if(feedback.get(target)===animation)feedback.delete(target);});
 };
 // Strip mode (html[data-lite]): the touched element is marked pressed at once (Chrome on Android only
 // sets :active after it decides tap vs scroll, so quick taps showed nothing). No style read, focus
 // marker or release animation; moving >10 px, scrolling or cancelling clears it.
 const lite=()=>doc.documentElement?.hasAttribute?.('data-lite')===true;
 const liteDown=event=>{
  if(event.isPrimary===false||event.button>0)return;clear();
  const path=event.composedPath?.()||[event.target];
  const index=path.findIndex(node=>node?.matches?.('button,a[href],summary,[role="button"]')),target=path[index];
  const field='input,select,textarea,[role="slider"],[contenteditable]:not([contenteditable="false"])';
  if(index<0||path.slice(0,index+1).some(node=>node?.matches?.(field))||unavailable(target))return;
  pressed=target;pointerId=event.pointerId;origin={x:event.clientX,y:event.clientY,shadow:'none'};
  // Inline style, not a class: the is-pressed class is matched by many :has() rules and restyled the
  // whole page (~0.6 s per tap on Frameo); an inline style restyles only the touched element.
  if(target.id!=='photo-view'&&target.style){
   target.style.setProperty('transform','scale(.97)','important');
   target.style.setProperty('background-image','linear-gradient(rgba(27,29,28,.14),rgba(27,29,28,.14))','important');
   litePressed=target;
  }
 };
 const down=event=>{
  if(lite())return liteDown(event);
  if(event.isPrimary===false||event.button>0)return;if(event.pointerId!=='keyboard')pointerModality=true;clear();const path=event.composedPath?.()||[event.target],index=path.findIndex(node=>node?.matches?.('button,a[href],summary,[role="button"]')),target=path[index];
  // A nested native field owns its gesture and selection, not its card wrapper.
  if(index<0||path.slice(0,index+1).some(node=>node?.matches?.('input,select,textarea,[role="slider"],[contenteditable]:not([contenteditable="false"])'))||unavailable(target))return;
  cancelFeedback(target);if(event.pointerId!=='keyboard'){clearFocus();pointerFocus=target;target.setAttribute?.('data-pv-pointer-focus','true');}
  const shadow=win?.getComputedStyle?.(target)?.boxShadow||'none';pressed=target;pointerId=event.pointerId;origin={x:event.clientX,y:event.clientY,shadow};target.classList.add('is-pressed');
 };
 const up=event=>{
  if(event.pointerId!==pointerId)return;const target=pressed,shadow=origin?.shadow;clear();
  if(!lite()&&(event.type==='pointerup'||event.type===undefined))acknowledge(target,shadow);
 };
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
