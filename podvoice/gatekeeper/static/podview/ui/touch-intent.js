// Keep native click/keyboard activation; reject only a cancelled touch/pen press.
// In particular, touch implicit pointer capture can deliver click to the original
// button even when release occurred beyond its bounds.
export function attachTouchIntent(surface,{window:events=surface.ownerDocument.defaultView,now=()=>performance.now()}={}){
 const document=surface.ownerDocument;
 const selector='button,a[href],summary,input[type="button"],input[type="submit"],input[type="reset"],[role="button"]';
 let press=null,released=null,expiry=null;
 const path=e=>e.composedPath?.()||[e.target];
 const controlFor=e=>path(e).find(node=>node?.matches?.(selector));
 const available=control=>control.isConnected&&!control.disabled&&!control.closest('[inert],[hidden],[aria-disabled="true"]');
 const clearExpiry=()=>{if(expiry!==null)events.clearTimeout(expiry);expiry=null;};
 const clearFeedback=()=>{press?.control.removeAttribute('data-touch-cancelled');};
 const clear=()=>{clearFeedback();press=null;released=null;clearExpiry();};
 const hit=(control,e)=>{
  if(!available(control))return false;
  const box=control.getBoundingClientRect();
  if(e.clientX<box.left||e.clientX>=box.right||e.clientY<box.top||e.clientY>=box.bottom)return false;
  // Rects alone include areas hidden by scrolling or another surface.
  let target=document.elementFromPoint?.(e.clientX,e.clientY);
  while(target?.shadowRoot?.elementFromPoint){const inner=target.shadowRoot.elementFromPoint(e.clientX,e.clientY);if(!inner||inner===target)break;target=inner;}
  return !document.elementFromPoint||target===control||control.contains(target);
 };
 const cancel=()=>{if(press){press.cancelled=true;press.control.setAttribute('data-touch-cancelled','true');}};
 const release=()=>{
  if(!press)return;
  clearFeedback();released={...press,at:now()};press=null;clearExpiry();
  expiry=events.setTimeout(()=>{released=null;expiry=null;},1000);
 };
 const down=e=>{
  if(e.isPrimary===false){cancel();return;}
  clear();
  if(!['touch','pen'].includes(e.pointerType)||e.button!==0)return;
  const control=controlFor(e);if(!control||!available(control))return;
  press={control,id:e.pointerId,cancelled:false};
 };
 const move=e=>{if(press&&e.pointerId===press.id&&!hit(press.control,e))cancel();};
 const up=e=>{if(!press||e.pointerId!==press.id)return;if(!hit(press.control,e))cancel();release();};
 const aborted=e=>{if(press&&e.pointerId===press.id){cancel();release();}};
 const scrolled=e=>{if(press&&(e.target===document||e.target.contains?.(press.control)))cancel();};
 const blur=()=>{cancel();release();};
 const click=e=>{
  // Keyboard, accessibility activation and programmatic .click() have detail 0.
  // Never consume them because a previous touch happened to be cancelled.
  if(e.detail===0||e.pointerType==='mouse')return;
  const candidate=press||released;if(!candidate)return;
  const pointerClick=['touch','pen'].includes(e.pointerType);
  const samePointer=pointerClick&&e.pointerId===candidate.id;
  const legacyTouch=!e.pointerType&&(!released||now()-released.at<1000)&&path(e).includes(candidate.control);
  if(!samePointer&&!legacyTouch)return;
  const blocked=candidate.cancelled||!available(candidate.control);
  clear();
  if(blocked){e.preventDefault();e.stopImmediatePropagation();}
 };
 const bindings=[[surface,'pointerdown',down],[events,'pointermove',move],[events,'pointerup',up],[events,'pointercancel',aborted],[events,'lostpointercapture',aborted],[document,'scroll',scrolled],[events,'blur',blur],[surface,'click',click]];
 for(const [target,type,listener] of bindings)target.addEventListener(type,listener,true);
 return ()=>{clear();for(const [target,type,listener] of bindings)target.removeEventListener(type,listener,true);};
}
