import {PodVoiceTransport} from './podvoice-transport.js';

// Only HA's administrator can approve access. Credentials stay in server-set
// HttpOnly cookies, never in the setup renderer.
export class SetupFlow {
 constructor({transport,render,navigate,now=()=>Date.now(),schedule=(fn,ms)=>globalThis.setTimeout(fn,ms),cancel=id=>globalThis.clearTimeout(id),load=()=>null,save=()=>{},forget=()=>{}}) {
  Object.assign(this,{transport,render,navigate,now,schedule,cancel,load,save,forget});
  this.phase='connecting';this.closed=false;this.request=null;this.timer=null;this.sequence=0;
 }
 update(status='') {
  if(this.closed)return;
  const pending=['requesting','pending','finishing'].includes(this.phase);
  const available=this.transport.connected&&this.transport.snapshot?.controllerContinuity?.available===true;
  this.render({status,disabled:pending||this.phase==='unknown'||!available,nameDisabled:pending||this.phase==='linked',button:this.phase==='linked'?'Åbn PodView':this.phase==='pending'?'Afventer godkendelse':'Bed om adgang',pending:this.phase==='pending',adminVisible:this.phase==='pending'||this.phase==='linked'});
 }
 connection(state) {
  if(this.closed)return;
  if(state==='connected'){
   if(this.transport.namedControllerRenewed===true&&this.phase!=='finishing'){this.linked();return;}
   if(this.phase==='linked'&&this.transport.namedControllerRenewed!==true){this.phase=this.transport.namedRenewalDenied===true?'error':'unknown';this.update(this.transport.namedRenewalDenied===true?'Skærmadgangen skal godkendes igen. Fjern om nødvendigt den gamle skærm under Konfigurér i Home Assistant, og bed om adgang igen.':'Skærmadgangen kunne ikke bekræftes. Åbn siden igen for at kontrollere forbindelsen.');return;}
   if(this.transport.controllerRenewed===true&&this.phase!=='finishing'){this.open();return;}
   if(this.phase==='connecting'||this.phase==='offline'){
    this.phase='ready';this.update(this.transport.namedRenewalDenied===true?'Skærmadgangen skal godkendes igen. Fjern om nødvendigt den gamle skærm under Konfigurér i Home Assistant, og bed om adgang igen.':this.transport.snapshot?.controllerContinuity?.available===true?'':'PodView er ikke klar til tilknytning. Prøv igen senere.');
    if(this.transport.snapshot?.controllerContinuity?.available===true)this.resume();
   }
  }else if(state==='disconnected'){
   const uncertain=['requesting','pending','finishing','unknown'].includes(this.phase);
   this.sequence++;this.cancel(this.timer);this.timer=null;this.phase=uncertain?'unknown':'offline';
   this.update('Forbindelsen blev afbrudt. Åbn siden igen, når PodView er tilgængelig.');
  }
 }
 resume() {
  let saved;try{saved=this.load();}catch{return;}
  if(!saved)return;
  const valid=Object.keys(saved).sort().join(',')==='bootId,deadline,matchSignal,name,requestId,roomId'&&saved.bootId===this.transport.snapshot.bootId&&saved.roomId===this.transport.snapshot.roomId&&typeof saved.requestId==='string'&&/^[a-f0-9]{32}$/.test(saved.requestId)&&typeof saved.matchSignal==='string'&&/^[A-Z0-9]{6}$/.test(saved.matchSignal)&&typeof saved.name==='string'&&saved.name.length>0&&saved.name.length<=48&&saved.name===saved.name.trim()&&!/[\u0000-\u001f\u007f]/u.test(saved.name)&&Number.isFinite(saved.deadline)&&saved.deadline>this.now()&&saved.deadline<=this.now()+300000;
  if(!valid){this.forget();return;}
  this.request=saved;this.phase='pending';this.waiting();const sequence=++this.sequence;this.timer=this.schedule(()=>this.poll(sequence),Math.min(2000,saved.deadline-this.now()));
 }
 waiting() {this.update(`Vælg Konfigurér i Home Assistant, og godkend “${this.request.name}” med mærket ${this.request.matchSignal}.`);}
 async start() {
  this.update();
  try{await this.transport.start();if(!this.closed&&this.transport.namedControllerRenewed===true)this.linked();}catch{if(!this.closed)this.connection('disconnected');}
 }
 async submit(name) {
  if(this.phase==='linked'){if(this.transport.namedControllerRenewed===true)this.open();else this.fail({});return;}
  if(this.closed||!['ready','error'].includes(this.phase)||!this.transport.connected)return;
  name=typeof name==='string'?name.trim():'';
  if(!name||name.length>48||/[\u0000-\u001f\u007f]/u.test(name)){this.update('Skriv et navn på højst 48 tegn.');return;}
  const sequence=++this.sequence,requestedAt=this.now();this.phase='requesting';this.update();
  try{
   const request=await this.transport.accessRequest(name);
   if(this.closed||sequence!==this.sequence)return;
   this.request={requestId:request.requestId,matchSignal:request.matchSignal,name,deadline:requestedAt+request.expiresIn*1000,bootId:this.transport.snapshot.bootId,roomId:this.transport.snapshot.roomId};
   try{this.save(this.request);}catch{/* Storage is optional; never store a credential. */}
   this.phase='pending';this.waiting();
   this.timer=this.schedule(()=>this.poll(sequence),2000);
  }catch(error){if(!this.closed&&sequence===this.sequence)this.fail(error);}
 }
 async poll(sequence) {
  this.timer=null;
  if(this.closed||sequence!==this.sequence||this.phase!=='pending')return;
  if(this.now()>=this.request.deadline){this.fail({code:'request_expired'});return;}
  try{
   // Claim may consume approval. A reload must not replay an unknown claim.
   // Only an authoritative pending response makes this request resumable again.
   this.forget();
   const result=await this.transport.accessClaim(this.request.requestId);
   if(this.closed||sequence!==this.sequence)return;
   if(result.status==='connected'){
    this.phase='finishing';this.update();
    await this.transport.start();
    if(this.closed||sequence!==this.sequence)return;
    if(this.transport.namedControllerRenewed===true){this.linked();return;}
    if(this.transport.controllerRenewed!==true)throw Error('access_not_confirmed');
    this.open();return;
   }
   // Responses may shorten the wait, never extend its original deadline.
   this.request.deadline=Math.min(this.request.deadline,this.now()+result.expiresIn*1000);
   try{this.save(this.request);}catch{/* Keep the current in-memory request. */}
   if(this.now()>=this.request.deadline){this.fail({code:'request_expired'});return;}
   this.timer=this.schedule(()=>this.poll(sequence),Math.min(2000,this.request.deadline-this.now()));
  }catch(error){if(!this.closed&&sequence===this.sequence)this.fail(error);}
 }
 fail(error) {
  this.cancel(this.timer);this.timer=null;this.phase=['controller_limit','request_expired','request_denied'].includes(error?.code)?'error':'unknown';
  this.forget();
  const copy={controller_limit:'To enheder er allerede tilknyttet. Fjern én i Home Assistant først.',request_expired:'Anmodningen udløb. Bed om adgang igen.',request_denied:'Anmodningen blev afvist. Du kan bede om adgang igen.'};
  this.update(copy[error?.code]||'Adgangen kunne ikke bekræftes. Åbn siden igen for at kontrollere forbindelsen.');
 }
 linked() {if(this.closed)return;this.cancel(this.timer);this.timer=null;this.forget();this.phase='linked';this.update(this.transport.namedIntentStored===false?'Skærmen er tilknyttet nu, men browseren kan ikke huske skærmvalget. Åbn denne side igen for at bekræfte adgangen. Vælg “PodViews rum” under Konfigurér i Home Assistant.':'Skærmen er tilknyttet. Vælg “PodViews rum” for denne skærm under Konfigurér i Home Assistant. Et gemt rum giver ikke i sig selv lysbetjening.');}
 open() {if(this.closed)return;const room=this.transport.snapshot?.roomId;this.forget();this.close();this.navigate('./'+(room?'?'+new URLSearchParams({room}).toString():''));}
 close() {if(this.closed)return;this.closed=true;this.sequence++;this.cancel(this.timer);this.timer=null;this.transport.close();}
}

if(typeof document!=='undefined'){
 const form=document.getElementById('pair-form'),field=document.getElementById('device-name'),submit=document.getElementById('pair-submit'),status=document.getElementById('pair-status'),approval=document.getElementById('approval-actions'),back=document.querySelector('main > a');
 if(form&&field&&submit&&status){
  // Convenience label only; the administrator verifies the actual request.
  field.value=/iPad/.test(navigator.userAgent)||/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1?'iPad':/Mac/.test(navigator.platform||navigator.userAgent)?'Mac':'PodView-skærm';
  let flow;
  try{
   const transport=new PodVoiceTransport({screenEnrollment:true,room:new URLSearchParams(location.search).get('room')||undefined,onConnection:state=>flow?.connection(state)});
   const storageKey='podview.access.pending.v1';
   flow=new SetupFlow({transport,render:view=>{submit.disabled=view.disabled;submit.textContent=view.button;field.disabled=view.nameDisabled;status.textContent=view.status;if(approval)approval.hidden=!view.adminVisible;if(back&&transport.snapshot?.roomId)back.href='./?'+new URLSearchParams({room:transport.snapshot.roomId}).toString();},navigate:url=>location.replace(url),load:()=>{try{return JSON.parse(sessionStorage.getItem(storageKey));}catch{return null;}},save:value=>{try{sessionStorage.setItem(storageKey,JSON.stringify(value));}catch{/* Current tab can still complete setup. */}},forget:()=>{try{sessionStorage.removeItem(storageKey);}catch{/* Storage is not authority. */}}});
   form.addEventListener('submit',event=>{event.preventDefault();flow.submit(field.value);});
   window.addEventListener('pagehide',()=>flow.close(),{once:true});
   flow.start();
  }catch{status.textContent='Åbn PodView gennem Home Assistant for at forbinde enheden.';}
 }
}
