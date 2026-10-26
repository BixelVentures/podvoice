// Delayed LOCAL preview only. This owner has no network or vehicle capability.
// A timer is never evidence of a real wake, accepted command, or physical effect.
const seatLevels=seats=>seats&&typeof seats==='object'&&!Array.isArray(seats)&&Object.hasOwn(seats,'driver')&&Object.hasOwn(seats,'passenger')&&Object.keys(seats).length===2&&['driver','passenger'].every(seat=>Number.isInteger(seats[seat])&&seats[seat]>=0&&seats[seat]<=3);
function intentFor(event,vehicle){
 if(!event||event.revision!==vehicle.revision||['climate','defrost','temperature','seat-heat','climate-settings'].includes(event.action)&&event.confirmed!==true)return null;
 const intent={action:event.action,revision:event.revision};if(event.confirmed===true)intent.confirmed=true;
 switch(event.action){
 case 'lock':if(typeof event.value!=='boolean'||event.value===vehicle.locked||event.value===false&&event.confirmed!==true)return null;intent.value=event.value;break;
 case 'rear-trunk':if(!['open','closed'].includes(event.value)||event.value===vehicle.access?.rearTrunk||event.confirmed!==true)return null;intent.value=event.value;break;
 case 'climate':{const enabled=Object.hasOwn(event,'value')?event.value:vehicle.climate.status==='off';if(typeof enabled!=='boolean'||enabled===(vehicle.climate.status==='heat')&&!vehicle.climate.defrost)return null;intent.value=enabled;break;}
 case 'defrost':if(typeof event.value!=='boolean'||event.value===vehicle.climate.defrost)return null;intent.value=event.value;break;
 case 'temperature':if(!Number.isInteger(event.value)||event.value<16||event.value>30||event.value===vehicle.climate.targetTemperatureC)return null;intent.value=event.value;break;
 case 'seat-heat':if(!['driver','passenger'].includes(event.seat)||!Number.isInteger(event.value)||event.value<0||event.value>3||event.value===vehicle.climate.seats?.[event.seat]||event.value>0&&vehicle.climate.status==='off'&&event.confirmed!==true)return null;intent.seat=event.seat;intent.value=event.value;break;
 case 'climate-settings':if(!Number.isInteger(event.temperatureC)||event.temperatureC<16||event.temperatureC>30||!seatLevels(event.seats)||vehicle.climate.status==='off'&&Object.values(event.seats).some(level=>level>0)&&event.confirmed!==true)return null;intent.temperatureC=event.temperatureC;intent.seats=Object.freeze({...event.seats});if(intent.temperatureC===vehicle.climate.targetTemperatureC&&['driver','passenger'].every(seat=>intent.seats[seat]===vehicle.climate.seats?.[seat]))return null;break;
 default:return null;
 }
 return Object.freeze(intent);
}
function matchesDesired(intent,before,after){
 switch(intent.action){
 case 'lock':return after.locked===intent.value;
 case 'rear-trunk':return after.access?.rearTrunk===intent.value;
 case 'climate':return after.climate?.status===(intent.value?'heat':'off')&&after.climate.defrost===false;
 case 'defrost':return after.climate?.defrost===intent.value&&(!intent.value||after.climate.status==='heat');
 case 'temperature':return after.climate?.targetTemperatureC===intent.value;
 case 'seat-heat':return after.climate?.seats?.[intent.seat]===intent.value&&(intent.value===0||before.climate.status!=='off'||after.climate.status==='heat');
 case 'climate-settings':return after.climate?.targetTemperatureC===intent.temperatureC&&['driver','passenger'].every(seat=>after.climate?.seats?.[seat]===intent.seats[seat])&&(!Object.values(intent.seats).some(level=>level>0)||before.climate.status!=='off'||after.climate.status==='heat');
 default:return false;
 }
}
export class VehiclePreviewCommand{
 constructor(host,{wakeMs=2000,totalMs=6000,outcome='confirmed',setTimer=(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimer=id=>globalThis.clearTimeout(id)}={}){
  this.host=host;this.wakeMs=Number.isFinite(wakeMs)?Math.max(0,wakeMs):2000;this.totalMs=Number.isFinite(totalMs)?Math.max(this.wakeMs,totalMs):Math.max(this.wakeMs,6000);this.outcome=['confirmed','failed','unknown'].includes(outcome)?outcome:'unknown';this.setTimer=setTimer;this.clearTimer=clearTimer;this.generation=0;
 }
 // Navigation changes presentation only. The already-authorized fixture command
 // stays bound to its original session, exact vehicle object and revision.
 validBinding(operation){const state=this.host.state;return !this.disposed&&this.host.live===false&&state?.connected===true&&state.sessionId===operation.sessionId&&state.vehicle===operation.vehicle&&state.vehicle?.revision===operation.intent.revision;}
 sync(){const operation=this.pending;if(operation&&!operation.committing&&!this.validBinding(operation))this.finish(operation,{status:'unknown',reason:'binding-changed'});}
 send(event,{signal,onProgress}={}){
  if(this.disposed||this.pending)return Promise.resolve({status:'failed',reason:this.disposed?'disposed':'busy'});
  const state=this.host.state,vehicle=state?.vehicle;
  if(this.host.live!==false||state?.connected!==true||state.focus!=='vehicle'||vehicle?.kind!=='vehicle'||vehicle.mode!=='fixture'||vehicle.controlsPreview!==true||!Number.isSafeInteger(vehicle.revision)||vehicle.revision<0||typeof state.sessionId!=='string'||!state.sessionId||signal?.aborted)return Promise.resolve({status:'failed',reason:'not-available'});
  const intent=intentFor(event,vehicle);if(!intent)return Promise.resolve({status:'failed',reason:'invalid-intent'});
  return new Promise(resolve=>{
   const operation={generation:++this.generation,vehicle,sessionId:state.sessionId,intent,resolve,timers:[],signal,onProgress};this.pending=operation;
   operation.abort=()=>this.finish(operation,{status:'unknown',reason:'interrupted'});signal?.addEventListener('abort',operation.abort,{once:true});
   const progress=phase=>{if(this.pending!==operation||operation.generation!==this.generation)return;try{onProgress?.({phase,localPreview:true});}catch{this.finish(operation,{status:'failed',reason:'presentation-error'});}};
   operation.timers.push(this.setTimer(()=>{if(!this.validBinding(operation)){this.sync();return;}progress('awaiting');},this.wakeMs));
   operation.timers.push(this.setTimer(()=>{
    if(this.pending!==operation||operation.generation!==this.generation)return;
    if(!this.validBinding(operation)){this.sync();return;}
    if(this.outcome!=='confirmed'){this.finish(operation,{status:this.outcome,reason:'local-preview-outcome'});return;}
    operation.committing=true;
    try{this.host.dispatch({type:'vehicle-control',sessionId:operation.sessionId,...operation.intent});}catch{this.finish(operation,{status:'unknown',reason:'commit-interrupted'});return;}
    const current=this.host.state,after=current?.vehicle;
    const confirmed=this.pending===operation&&current?.sessionId===operation.sessionId&&current.connected===true&&after?.kind==='vehicle'&&after.mode==='fixture'&&after.controlsPreview===true&&after.revision===operation.intent.revision+1&&matchesDesired(operation.intent,operation.vehicle,after);
    this.finish(operation,confirmed?{status:'confirmed',revision:after.revision}:{status:'unknown',reason:'unconfirmed-state'});
   },this.totalMs));
   progress(vehicle.connectionState==='asleep'?'waking':'awaiting');
  });
 }
 finish(operation,result){if(this.pending!==operation||operation.generation!==this.generation)return;this.pending=null;for(const timer of operation.timers)this.clearTimer(timer);operation.signal?.removeEventListener('abort',operation.abort);operation.resolve({...result,localPreview:true});}
 dispose(){if(this.disposed)return;this.disposed=true;if(this.pending)this.finish(this.pending,{status:'unknown',reason:'disposed'});this.generation++;}
}
