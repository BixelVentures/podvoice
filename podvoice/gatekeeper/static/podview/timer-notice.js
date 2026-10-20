// One canonical completion surface. Closing this view never claims to stop a
// native alarm: only the existing, authority-checked timer action can do that.
export class TimerNotice {
 constructor(host,element,{setTimer=(...args)=>globalThis.setTimeout(...args),clearTimer=(...args)=>globalThis.clearTimeout(...args),now=()=>Date.now(),createAudio=()=>typeof Audio==='function'?new Audio('assets/audio/timer-bell.wav'):null,onElapsed=()=>{}}={}){
  this.host=host;this.element=element;this.setTimer=setTimer;this.clearTimer=clearTimer;this.timer=null;this.id=null;this.disposed=false;this.pulsedIds=new Set();this.now=now;this.createAudio=createAudio;this.onElapsed=onElapsed;this.completions=new Map();this.audioTimer=null;this.audioGeneration=0;
  this.add=element.querySelector('#timer-alert-add');
  this.name=element.querySelector('.notice-copy>span');this.stop=element.querySelector('#timer-alert-dismiss');this.closeButton=element.querySelector('#timer-alert-open');this.status=element.querySelector('#timer-alert-status');
  this.onStop=()=>{if(!this.id||!this.allowed||this.disposed)return;this.stopAudio();this.host.dispatch({type:'timer',id:this.id,action:'cancel'});};
  this.onAdd=()=>{if(!this.id||!this.canAdd||this.disposed)return;const id=this.id;this.pulsedIds.delete(id);this.stopAudio();this.completions.delete(id);this.host.dispatch({type:'timer',id,action:'add',seconds:60,now:Date.now()});};
  this.onDismiss=()=>this.dismiss(this.id);
  this.onCancel=event=>{event.preventDefault();this.dismiss(this.id);};
  this.onMotion=()=>{if(this.motion?.matches){this.clearExpiry();this.setPulse(false);}};
  this.attach();
 }
 attach(){if(this.attached)return;this.disposed=false;this.attached=true;this.stop.addEventListener('click',this.onStop);this.add?.addEventListener('click',this.onAdd);this.closeButton.addEventListener('click',this.onDismiss);this.element.addEventListener('cancel',this.onCancel);this.motion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');this.motion?.addEventListener?.('change',this.onMotion);}
 setPulse(active){const value=String(active);if(this.element.dataset.pulse!==value)this.element.dataset.pulse=value;}
 render(timer,focus,live,feedbackVisible=false,visibleTimerId=null,access={}){
  if(this.disposed)this.attach();
  const show=!!timer&&timer.status==='done'&&!timer.stale&&!timer.noticeDismissed,id=show?String(timer.id):null;
  if(!show){if(timer?.status==='running')this.completions.delete(String(timer.id));this.hide();return;}
  const changed=this.id!==id;
  if(changed){this.clearExpiry();this.id=id;const pulse=!this.pulsedIds.has(id)&&!this.motion?.matches&&this.host.dataset?.motion!=='reduced';this.pulsedIds.add(id);this.setPulse(pulse);if(pulse)this.schedule(id,60000,()=>this.setPulse(false));}
  if(changed&&!live&&!timer.ownerBootId)this.startAudio(timer);
  if(this.element.dataset.timerId!==id)this.element.dataset.timerId=id;
  const title='Timeren er færdig';if(this.name.textContent!==title)this.name.textContent=title;
  const nativeActive=live&&typeof timer.ownerBootId==='string'&&!timer.physicalStopped&&!timer.physicalDrained;
  this.allowed=access.canCancel===true&&!access.cancelBlockedIds?.includes(id);
  this.canAdd=!live&&!timer.ownerBootId&&this.allowed&&access.connected!==false;
  if(this.add){this.add.hidden=live||!!timer.ownerBootId;this.add.disabled=!this.canAdd;}
  const label=nativeActive?'Stop alarm':live?'Færdig':'Stop',busy=access.pending===true||access.waiting===true;
  if(this.stop.textContent!==label)this.stop.textContent=label;if(this.stop.disabled!==!this.allowed)this.stop.disabled=!this.allowed;
  const message=access.feedback||this.audioFeedback||(busy?'Afventer timerens svar':!this.allowed?(nativeActive?'Alarmen kan ikke stoppes herfra lige nu. Luk visning stopper ikke alarmen.':'Timeren kan ikke afsluttes herfra lige nu.'):'');
  if(this.status){if(this.status.textContent!==message)this.status.textContent=message;if(this.status.hidden!==!message)this.status.hidden=!message;}
  if(this.element.hidden)this.element.hidden=false;
  if(!this.element.open){this.returnFocus=this.element.ownerDocument?.activeElement;this.element.showModal();(this.allowed?this.stop:this.closeButton).focus({preventScroll:true});}
 }
 startAudio(timer){
  this.stopAudio();const id=String(timer.id),retained=this.completions.get(id);
  const record=retained||{at:Number.isFinite(timer.deadline)?timer.deadline:this.now(),started:this.now(),played:false,exhausted:false};this.completions.set(id,record);this.audioFeedback='';
  try{this.audio=this.createAudio();}catch{this.audio=null;}if(!this.audio)this.audioFeedback='Lyd kunne ikke afspilles. Timeren er stadig færdig.';const generation=++this.audioGeneration;
  const tick=()=>{if(this.disposed||this.id!==id||generation!==this.audioGeneration)return;const remaining=300000-(this.now()-record.started);if(remaining<=0){record.exhausted=true;this.stopAudio();this.dismiss(id);this.onElapsed();return;}
   if(this.audio&&!this.audioFeedback){try{this.audio.currentTime=0;Promise.resolve(this.audio.play()).then(()=>{if(generation===this.audioGeneration)record.played=true;},()=>{if(generation!==this.audioGeneration)return;this.audioFeedback='Lyd kunne ikke afspilles. Timeren er stadig færdig.';if(this.status){this.status.textContent=this.audioFeedback;this.status.hidden=false;}});}catch{this.audioFeedback='Lyd kunne ikke afspilles. Timeren er stadig færdig.';if(this.status){this.status.textContent=this.audioFeedback;this.status.hidden=false;}}}
   this.audioTimer=this.setTimer(tick,Math.min(4000,remaining));
  };if(retained)this.audioTimer=this.setTimer(tick,0);else tick();
 }
 stopAudio(){this.audioGeneration++;if(this.audioTimer!==null)this.clearTimer(this.audioTimer);this.audioTimer=null;if(this.audio){try{this.audio.pause();this.audio.currentTime=0;}catch{}}this.audio=null;this.audioFeedback='';}
 schedule(id,delay,callback){let handle;handle=this.setTimer(()=>{if(this.timer!==handle)return;this.timer=null;if(this.id===id&&!this.disposed)callback();},delay);this.timer=handle;}
 clearExpiry(){if(this.timer!==null){this.clearTimer(this.timer);this.timer=null;}}
 hide(){this.stopAudio();this.clearExpiry();this.id=null;this.allowed=false;this.canAdd=false;this.setPulse(false);if(this.element.open)this.element.close();if(!this.element.hidden)this.element.hidden=true;const target=this.returnFocus;this.returnFocus=null;if(target?.isConnected)target.focus({preventScroll:true});}
 dismiss(id){if(!id||this.id!==id||this.disposed)return;this.hide();this.host.dispatch({type:'timer-notice-dismiss',id});}
 cleanup(){this.disposed=true;this.attached=false;this.hide();this.stop.removeEventListener('click',this.onStop);this.add?.removeEventListener('click',this.onAdd);this.closeButton.removeEventListener('click',this.onDismiss);this.element.removeEventListener('cancel',this.onCancel);this.motion?.removeEventListener?.('change',this.onMotion);this.motion=null;}
}
