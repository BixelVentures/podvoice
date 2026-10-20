// Screen-only lifecycle. No HA controls, fabricated sun observation or permission
// renewal. Night uses an explicit Copenhagen clock schedule until sun is admitted.
export function screenClock(now){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',hour12:false}).formatToParts(now),get=type=>parts.find(part=>part.type===type)?.value;
 return {day:`${get('year')}-${get('month')}-${get('day')}`,hour:Number(get('hour'))%24};
}
export function screenBusy(host){
 const s=host.state||{},voice=host.live?host.liveSnapshot?.voice?.active===true:['LISTENING','THINKING','AI_SPEAKING'].includes(s.voicePreviewPhase);
 return [s.timer,...s.extraTimers||[]].some(t=>t?.status==='done')||voice||!!s.music?.pending||!!host.liveActionPending||!!host.liveControls?.pending||!!host.liveControls?.musicIntentPending||!!host.liveControls?.setupPending||!!host.liveSelection?.pending||!!host.liveMedia?.queueControls?.pending||!!s.pendingAnswer||!!s.conflict||!!host.ownerDocument?.querySelector('dialog[open], details[open]')||s.devices?.some(device=>device.pending)||s.answers?.some(answer=>!answer.hidden&&!answer.historical&&['steps','checklist'].includes(answer.kind));
}
export function safeScreenReload(host,now=Date.now()){
 const s=host.state||{};
 // Local browser state has no durable owner. Keep every retained answer and
 // resource rather than risk losing it to a speculative maintenance reload.
 return host.live===true&&host.liveSnapshot?.voice?.active===false&&now-(host.lastInteractionAt||0)>=90000&&host.liveStatus==='connected'&&host.liveTransport?.connected===true&&s.focus==='photo'&&!screenBusy(host)&&!(s.answers?.length)&&![s.timer,...s.extraTimers||[]].some(timer=>timer&&timer.status!=='cancelled')&&host.dataset.playback!=='active'&&!s.music?.pending;
}
export function detailFocus(host){const s=host.state||{};return ['weather','timers','radio','vehicle','player'].includes(s.focus)||!!s.devices?.some(d=>d.id===s.focus);}
export class ScreenLifecycle{
 constructor(host,win=window,clock=globalThis){this.host=host;this.win=win;this.clock=clock;this.timer=null;this.step=0;this.attached=false;this.pendingReload=false;this.lastReloadDay=null;this.wakeSnapshot=undefined;this.wakeRequested=false;this.wakeInFlight=false;this.wakeSerial=0;this.blankSince=null;this.blankReload=false;this.lastClock=null;this.visibility=()=>{if(host.ownerDocument.visibilityState==='hidden'){this.stopTimer();this.resetIdle();this.releaseWakeLock();this.resetDetail();this.pointers.clear();this.clock.clearTimeout(this.quietTimer);this.quietTimer=null;host.motion?.releaseGeometry(false);return;}this.lockBlocked=false;this.wake();};this.error=()=>{if(this.kiosk)this.pendingReload=true;};this.preference=()=>this.sync();this.idleTimer=null;this.idleAt=null;this.nightWakeUntil=0;this.nightTimer=null;this.wakeLock=null;this.lockPending=false;this.lockBlocked=false;this.lockSerial=0;this.displayIntent=false;this.network=()=>{host.browserOffline=this.win.navigator?.onLine===false;if(host.live)host.renderLive?.();else host.render?.();};this.nightClick=e=>{if(this.nightClickUntil>(this.clock.now?.()??Date.now())){e.preventDefault?.();e.stopImmediatePropagation?.();this.nightClickUntil=0;}};this.detailTimer=null;this.detailKey=null;this.pointers=new Set();this.blur=()=>{this.resetDetail();this.pointers.clear();this.clock.clearTimeout(this.quietTimer);this.quietTimer=null;host.motion?.releaseGeometry(false);};this.quietTimer=null;this.interaction=e=>{const now=this.clock.now?.()??Date.now();host.lastInteractionAt=now;this.idleAt=now;this.resetIdle(false);if(e.type==='pointerdown'){this.displayIntent=true;this.lockBlocked=false;if(host.state?.focus==='photo'&&host.dataset.night==='true'&&(host.contains?.(e.target)??true)){this.nightWakeUntil=now+30000;this.nightClickUntil=now+1000;this.clock.clearTimeout(this.nightTimer);this.nightTimer=this.clock.setTimeout(()=>{this.nightTimer=null;this.sync();},30000);e.preventDefault?.();e.stopImmediatePropagation?.();host.dispatch({type:'show',id:'photo'});}}if(['pointerdown','touchstart'].includes(e.type)){this.clock.clearTimeout(this.quietTimer);this.quietTimer=null;this.pointers.add(e.type==='touchstart'?'touch':e.pointerId);host.motion?.holdGeometry();}if(['pointerup','pointercancel'].includes(e.type))this.pointers.delete(e.pointerId);if(['touchend','touchcancel'].includes(e.type)&&!e.touches?.length)this.pointers.delete('touch');if(!this.pointers.size&&(host.motion?.geometry?.size||['pointerup','pointercancel','touchend','touchcancel'].includes(e.type))){this.clock.clearTimeout(this.quietTimer);this.quietTimer=this.clock.setTimeout(()=>{this.quietTimer=null;host.motion?.releaseGeometry();},2000);}this.resetDetail();this.sync();};}
 attach(){
  if(this.attached)return;this.attached=true;this.kiosk=new URLSearchParams(this.win.location.search).get('kiosk')==='1';this.host.dataset.kiosk=String(this.kiosk);
  this.media=this.win.matchMedia?.('(prefers-reduced-motion: reduce)');if(this.media?.addEventListener)this.media.addEventListener('change',this.preference);else this.media?.addListener?.(this.preference);
  for(const type of ['pointerdown','pointerup','pointercancel','touchstart','touchend','touchcancel','wheel','keydown','scroll'])this.host.ownerDocument.addEventListener(type,this.interaction,true);this.host.ownerDocument.addEventListener('visibilitychange',this.visibility);this.host.ownerDocument.addEventListener('click',this.nightClick,true);this.win.addEventListener('online',this.network);this.win.addEventListener('offline',this.network);this.host.browserOffline=this.win.navigator?.onLine===false;this.win.addEventListener('blur',this.blur);this.win.addEventListener('error',this.error);this.win.addEventListener('unhandledrejection',this.error);
  if(this.kiosk){const viewport=this.host.ownerDocument.querySelector('meta[name="viewport"]');if(viewport){this.viewport=viewport;this.originalViewport=viewport.content;viewport.content='width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';}}
  try{this.lastReloadDay=this.win.sessionStorage.getItem('podview-screen-reload-day');}catch{}
  this.sync();this.schedule();
 }
 stopTimer(){if(this.timer!==null)this.clock.clearTimeout(this.timer);this.timer=null;}
 schedule(){this.stopTimer();if(!this.attached||!this.host.isConnected||this.host.ownerDocument.visibilityState==='hidden')return;this.timer=this.clock.setTimeout(()=>{this.timer=null;this.step++;this.sync();this.schedule();},60000);}
 resetDetail(){if(this.detailTimer!==null)this.clock.clearTimeout(this.detailTimer);this.detailTimer=null;this.detailKey=null;}
 syncDetail(){
  const host=this.host,focus=host.state?.focus;
  const eligible=this.attached&&host.isConnected&&host.ownerDocument.visibilityState!=='hidden'&&detailFocus(host)&&!screenBusy(host)&&!this.pointers.size;
  if(!eligible){this.resetDetail();return;}
  if(this.detailKey===focus&&this.detailTimer!==null)return;
  this.resetDetail();this.detailKey=focus;
  this.detailTimer=this.clock.setTimeout(()=>{this.detailTimer=null;if(this.detailKey===host.state?.focus&&detailFocus(host)&&!screenBusy(host)&&!this.pointers.size&&host.ownerDocument.visibilityState!=='hidden'){this.detailKey=null;host.dispatch({type:'back'});host.focusHeading?.();}else this.resetDetail();},60000);
 }
 resetIdle(resetTime=true){if(this.idleTimer!==null)this.clock.clearTimeout(this.idleTimer);this.idleTimer=null;if(resetTime)this.idleAt=null;}
 syncIdle(){
  const host=this.host,s=host.state||{},answer=s.answers?.some(a=>a.id===s.focus&&!a.hidden),activeInput=host.ownerDocument.activeElement?.matches?.('input,textarea,select,[contenteditable=true]');
  if(host.ownerDocument.visibilityState==='hidden'||s.focus==='photo'||answer||screenBusy(host)||this.pointers.size||activeInput){this.resetIdle();return;}
  if(this.idleTimer!==null)return;const now=this.clock.now?.()??Date.now();this.idleAt??=now;
  this.idleTimer=this.clock.setTimeout(()=>{this.idleTimer=null;const current=host.state||{};if(!this.attached||!host.isConnected||host.ownerDocument.visibilityState==='hidden'||screenBusy(host)||this.pointers.size||host.ownerDocument.activeElement?.matches?.('input,textarea,select,[contenteditable=true]')||current.answers?.some(a=>a.id===current.focus&&!a.hidden)){this.resetIdle();return;}this.idleAt=null;host.dispatch({type:'show',id:'photo'});},Math.max(0,180000-(now-this.idleAt)));
 }
 releaseWakeLock(){this.lockSerial++;const lock=this.wakeLock;this.wakeLock=null;if(lock)Promise.resolve(lock.release()).catch(()=>{});}
 syncWakeLock(){
  const allowed=this.attached&&this.host.isConnected&&this.host.ownerDocument.visibilityState!=='hidden'&&(this.host.live||this.kiosk||this.displayIntent),api=this.win.navigator?.wakeLock;
  if(!allowed){if(this.wakeLock)this.releaseWakeLock();return;}if(!api?.request||this.wakeLock||this.lockPending||this.lockBlocked)return;
  const serial=++this.lockSerial;this.lockPending=true;
  Promise.resolve().then(()=>{if(serial!==this.lockSerial||!this.attached)return null;return api.request('screen');}).then(lock=>{if(!lock)return;if(serial!==this.lockSerial||!this.attached||this.host.ownerDocument.visibilityState==='hidden'){return Promise.resolve(lock.release()).catch(()=>{});}this.wakeLock=lock;lock.addEventListener?.('release',()=>{if(this.wakeLock===lock){this.wakeLock=null;this.lockBlocked=true;}});},()=>{if(serial===this.lockSerial)this.lockBlocked=true;}).finally(()=>{this.lockPending=false;if(serial!==this.lockSerial&&this.attached)this.syncWakeLock();});
 }
 sync(){
  if(!this.attached||!this.host.isConnected)return;this.syncDetail();this.syncIdle();this.syncWakeLock();const now=this.clock.now?.()??Date.now(),{day,hour}=screenClock(new Date(now)),host=this.host,rest=host.state?.focus==='photo';
  host.dataset.night=String((host.previewStage==='night'||hour>=22||hour<6)&&now>=this.nightWakeUntil);host.dataset.nightSource=host.previewStage==='night'?'local-preview':'clock-schedule';
  const drift=rest?[[0,0],[4,0],[0,4],[-4,0],[0,-4]][this.step%5]:[0,0];host.style.setProperty('--drift-x',`${drift[0]}px`);host.style.setProperty('--drift-y',`${drift[1]}px`);
  if(this.wakeRequested&&(!screenBusy(host)||host.liveTransport?.connected!==true))this.refreshAfterWake();
  if(this.wakeSnapshot!==undefined&&host.liveStatus==='connected'&&host.liveSnapshot!==this.wakeSnapshot){this.wakeSnapshot=undefined;const note=host.ownerDocument.getElementById('connection-note');const copy=host.connectionCopy?.parentNode===note?host.connectionCopy:null;if((copy?copy.nodeValue:note?.textContent)==='Opdaterer…'){note.hidden=true;if(copy)copy.nodeValue='';else note.textContent='';}}
  if(this.wakeSnapshot!==undefined&&['connecting','connected'].includes(host.liveStatus)){const note=host.ownerDocument.getElementById('connection-note');if(note){note.hidden=false;if(host.connectionCopy?.parentNode===note)host.connectionCopy.nodeValue='Opdaterer…';else note.textContent='Opdaterer…';if(host.connectionRetry)host.connectionRetry.hidden=true;}}
  if(!this.kiosk||host.ownerDocument.visibilityState==='hidden')return;
  const crossedMaintenance=this.lastClock&&hour>=4&&(this.lastClock.day!==day||this.lastClock.hour<4);
  this.lastClock={day,hour};
  if((hour===4||crossedMaintenance)&&day!==this.lastReloadDay)this.pendingReload=true;
  const frame=host.querySelector('.frame'),blank=!host.getClientRects().length||!frame||!frame.getClientRects().length;
  if(blank){this.blankSince??=now;this.blankReload=now-this.blankSince>=5000;}else{this.blankSince=null;this.blankReload=false;}
  if((this.pendingReload||this.blankReload)&&day!==this.lastReloadDay&&safeScreenReload(host,now)){
   this.lastReloadDay=day;this.pendingReload=false;try{this.win.sessionStorage.setItem('podview-screen-reload-day',day);}catch{return;}
   this.win.location.reload();
  }
 }
 wake(){
  const host=this.host;if(!host.isConnected)return;
  if(!screenBusy(host))host.dispatch({type:'show',id:'photo'});
  if(host.live&&host.liveTransport&&!this.wakeInFlight){this.wakeRequested=true;if(!screenBusy(host)||host.liveTransport.connected!==true)this.refreshAfterWake();}
  this.sync();this.schedule();
 }
 refreshAfterWake(){
  const host=this.host,transport=host.liveTransport;if(!this.attached||!host.isConnected||!transport||this.wakeInFlight||host.ownerDocument.visibilityState==='hidden')return;
  this.wakeRequested=false;this.wakeSnapshot=host.liveSnapshot??null;
  // An existing transport restart already owns the fresh snapshot. Do not
  // interrupt a pending task or start a second permission/connection cycle.
  if(transport.restartCount)return;
  this.wakeInFlight=true;const serial=++this.wakeSerial;
  Promise.resolve().then(()=>{if(serial!==this.wakeSerial||!this.attached||!host.isConnected||host.liveTransport!==transport)return;if(screenBusy(host)&&transport.connected===true){this.wakeRequested=true;return;}return transport.restart(false,false,false);}).catch(()=>{}).finally(()=>{if(serial===this.wakeSerial)this.wakeInFlight=false;});
 }
 cleanup(){this.resetIdle();this.clock.clearTimeout(this.nightTimer);this.nightTimer=null;this.nightClickUntil=0;this.releaseWakeLock();this.resetDetail();this.clock.clearTimeout(this.quietTimer);this.quietTimer=null;this.pointers.clear();this.host.motion?.releaseGeometry(false);this.stopTimer();this.wakeSerial++;this.wakeInFlight=false;this.wakeRequested=false;this.wakeSnapshot=undefined;this.blankSince=null;this.blankReload=false;if(!this.attached)return;this.attached=false;for(const type of ['pointerdown','pointerup','pointercancel','touchstart','touchend','touchcancel','wheel','keydown','scroll'])this.host.ownerDocument.removeEventListener(type,this.interaction,true);this.host.ownerDocument.removeEventListener('visibilitychange',this.visibility);this.host.ownerDocument.removeEventListener('click',this.nightClick,true);this.win.removeEventListener('online',this.network);this.win.removeEventListener('offline',this.network);this.win.removeEventListener('blur',this.blur);this.win.removeEventListener('error',this.error);this.win.removeEventListener('unhandledrejection',this.error);if(this.media?.removeEventListener)this.media.removeEventListener('change',this.preference);else this.media?.removeListener?.(this.preference);if(this.viewport)this.viewport.content=this.originalViewport;this.viewport=null;this.host.style.setProperty('--drift-x','0px');this.host.style.setProperty('--drift-y','0px');}
}
