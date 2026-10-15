export class TimerNotice {
 constructor(host,element,{setTimer=(...args)=>globalThis.setTimeout(...args),clearTimer=(...args)=>globalThis.clearTimeout(...args),noticeMs=7000}={}){
  this.host=host;this.element=element;this.setTimer=setTimer;this.clearTimer=clearTimer;this.noticeMs=noticeMs;this.timer=null;this.id=null;this.pointer=null;this.disposed=false;this.waiting=false;
  this.name=element.querySelector('.notice-copy>span');this.feedback=element.ownerDocument?.getElementById('playback-status');
  this.onDismiss=()=>this.dismiss(this.id);
  this.onOpen=()=>{if(this.id){host.dispatch({type:'show',id:'timers'});host.focusHeading();}};
  this.onPointerDown=e=>{if(e.isPrimary===false)return;this.pointer={id:e.pointerId,x:e.clientX,y:e.clientY};};
  this.onPointerUp=e=>{const start=this.pointer;this.pointer=null;if(!start||e.pointerId!==start.id)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.abs(dx)>=56&&Math.abs(dx)>Math.abs(dy)*1.4)this.dismiss(this.id);};
  this.onPointerCancel=()=>{this.pointer=null;};
  this.attach();
 }
 attach(){if(!this.disposed&&this.attached)return;this.disposed=false;this.attached=true;this.element.querySelector('#timer-alert-dismiss').addEventListener('click',this.onDismiss);this.element.querySelector('#timer-alert-open').addEventListener('click',this.onOpen);this.element.addEventListener('pointerdown',this.onPointerDown);this.element.addEventListener('pointerup',this.onPointerUp);this.element.addEventListener('pointercancel',this.onPointerCancel);}
 render(timer,focus,live,feedbackVisible=false,visibleTimerId=null){
  if(this.disposed)this.attach();
  const timerId=timer?String(timer.id):null,represented=!!timerId&&visibleTimerId===timerId,show=!!timer&&timer.status==='done'&&!timer.stale&&!timer.noticeDismissed&&!represented,id=show?timerId:null;
  const waiting=show&&feedbackVisible;
  if(this.id!==id||this.waiting!==waiting){this.clearExpiry();this.id=id;this.waiting=waiting;}
  this.element.hidden=!show||waiting;
  if(!show){this.id=null;return;}
  this.element.dataset.timerId=id;this.name.textContent=timer.name||'Timer ved bordet';
  if(waiting){if(this.timer===null)this.schedule(id,350,()=>{if(this.host.timerView?.renderNotice)this.host.timerView.renderNotice();else this.render(timer,focus,live,this.feedback?.hidden===false,visibleTimerId);});return;}
  if(this.timer===null)this.schedule(id,this.noticeMs,()=>this.dismiss(id));
 }
 schedule(id,delay,callback){let handle;handle=this.setTimer(()=>{if(this.timer!==handle)return;this.timer=null;if(this.id===id&&!this.disposed)callback();},delay);this.timer=handle;}
 clearExpiry(){if(this.timer!==null){this.clearTimer(this.timer);this.timer=null;}}
 dismiss(id){if(!id||this.id!==id||this.disposed)return;this.clearExpiry();this.element.hidden=true;this.id=null;this.host.dispatch({type:'timer-notice-dismiss',id});}
 cleanup(){this.disposed=true;this.attached=false;this.clearExpiry();this.pointer=null;this.element.hidden=true;this.element.querySelector('#timer-alert-dismiss').removeEventListener('click',this.onDismiss);this.element.querySelector('#timer-alert-open').removeEventListener('click',this.onOpen);this.element.removeEventListener('pointerdown',this.onPointerDown);this.element.removeEventListener('pointerup',this.onPointerUp);this.element.removeEventListener('pointercancel',this.onPointerCancel);}
}
