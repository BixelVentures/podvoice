// Presentation-only press feedback; native click and keyboard activation keep ownership.
// P3 (docs/MOTION.md §3.4): this only sets .is-pressed; CSS owns the scale, overlay and their timing.
const FLAT='.pv-widget,[data-pv-press=flat]';
export function attachPressedState(surface){
 const doc=surface.ownerDocument||surface,root=doc.nodeType===9?doc:surface,win=doc.defaultView,held=new Map();
 let pressed=null,pointerId=null,origin=null,pointerFocus=null,pointerModality=false;
 const unavailable=target=>!target||target.disabled||target.getAttribute?.('aria-disabled')==='true'||target.closest?.('[inert]');
 let circle=null;
 // Flat surfaces (widgets) answer a press with a circle under the finger instead of shrinking.
 // The circle is the surface's own ::after, placed by custom properties; no nodes are added.
 const markCircle=(target,event)=>{
  const box=target.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top;
  const size=2*Math.hypot(Math.max(x,box.width-x),Math.max(y,box.height-y));
  target.style.setProperty('--pv-press-x',`${x}px`);target.style.setProperty('--pv-press-y',`${y}px`);
  target.style.setProperty('--pv-press-size',`${size}px`);target.dataset.pvCircle='down';circle=target;
 };
 const releaseCircle=()=>{if(circle?.dataset)circle.dataset.pvCircle='up';circle=null;};
 // A tap that ends before the press was painted keeps it for one painted frame, so the release
 // still has a pressed state to spring back from. A new press on the same control takes it over.
 const unpress=(target,release)=>{
  const frame=held.get(target);held.delete(target);
  if(!release||frame?.painted!==false||typeof win?.requestAnimationFrame!=='function'){
   target?.classList.remove('is-pressed');return;
  }
  const token={};held.set(target,token);
  win.requestAnimationFrame(()=>win.requestAnimationFrame(()=>{
   if(held.get(target)!==token)return;held.delete(target);target.classList.remove('is-pressed');
  }));
 };
 const clear=(release=false)=>{releaseCircle();if(pressed)unpress(pressed,release);pressed=null;
  pointerId=null;origin=null;};
 const clearFocus=()=>{pointerFocus?.removeAttribute?.('data-pv-pointer-focus');pointerFocus=null;};
 const down=event=>{
  if(event.isPrimary===false||event.button>0)return;if(event.pointerId!=='keyboard')pointerModality=true;clear();const path=event.composedPath?.()||[event.target],index=path.findIndex(node=>node?.matches?.('button,a[href],summary,[role="button"]')),target=path[index];
  // A nested native field owns its gesture and selection, not its card wrapper.
  if(index<0||path.slice(0,index+1).some(node=>node?.matches?.('input,select,textarea,[role="slider"],[contenteditable]:not([contenteditable="false"])'))||unavailable(target))return;
  if(event.pointerId!=='keyboard'){clearFocus();pointerFocus=target;target.setAttribute?.('data-pv-pointer-focus','true');}
  // No style or layout read here: it would force a style pass before the press can paint.
  pressed=target;pointerId=event.pointerId;origin={x:event.clientX,y:event.clientY};held.delete(target);
  target.classList.add('is-pressed');
  if(typeof win?.requestAnimationFrame==='function'){
   const frame={painted:false};held.set(target,frame);win.requestAnimationFrame(()=>{frame.painted=true;});
  }
  if(event.pointerId!=='keyboard'&&target.matches?.(FLAT))markCircle(target,event);
 };
 const up=event=>{
  if(event.pointerId!==pointerId)return;
  // Release keeps a fast tap visible for a frame; cancellation and lost capture end the press at once.
  clear(event.type==='pointerup'||event.type===undefined);
 };
 const move=event=>{if(event.pointerId===pointerId&&origin&&Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>10)clear();};
 const keydown=event=>{pointerModality=false;clearFocus();if(event.repeat||!['Enter',' '].includes(event.key))return;down({...event,composedPath:()=>event.composedPath?.()||[event.target],isPrimary:true,button:0,pointerId:'keyboard',clientX:0,clientY:0});};
 const keyup=event=>{if(pointerId==='keyboard'&&['Enter',' '].includes(event.key))clear(true);};
 const focusin=event=>{if(!pointerModality)return;const path=event.composedPath?.()||[event.target],index=path.findIndex(node=>node?.matches?.('button,a[href],summary,[role="button"]')),target=path[index];clearFocus();if(index<0||path.slice(0,index+1).some(node=>node?.matches?.('input,select,textarea,[role="slider"],[contenteditable]:not([contenteditable="false"])'))||unavailable(target))return;pointerFocus=target;target.setAttribute?.('data-pv-pointer-focus','true');};
 const cancel=()=>{clear();for(const target of held.keys())target.classList.remove('is-pressed');held.clear();};
 const visibility=()=>{if(doc.hidden)cancel();};
 root.addEventListener('focusin',focusin,true);root.addEventListener('keydown',keydown,true);win?.addEventListener('keyup',keyup,true);root.addEventListener('pointerdown',down,true);root.addEventListener('pointermove',move,true);
 for(const name of ['pointerup','pointercancel','lostpointercapture'])win?.addEventListener(name,up,true);
 win?.addEventListener('blur',cancel);doc.addEventListener?.('visibilitychange',visibility);
 return ()=>{cancel();clearFocus();root.removeEventListener('focusin',focusin,true);root.removeEventListener('keydown',keydown,true);win?.removeEventListener('keyup',keyup,true);root.removeEventListener('pointerdown',down,true);root.removeEventListener('pointermove',move,true);for(const name of ['pointerup','pointercancel','lostpointercapture'])win?.removeEventListener(name,up,true);win?.removeEventListener('blur',cancel);doc.removeEventListener?.('visibilitychange',visibility);};
}
