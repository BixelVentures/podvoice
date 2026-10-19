import {requestWithin} from './request-deadline.js';
const haIngress = value => value?.admission?.kind==='ha_ingress'&&value.admission.authenticated===true&&Object.keys(value.admission).sort().join(',')==='authenticated,kind';
// Same-origin HA-ingress transport. Import only in live /view/ mode.
// No provider credentials, cross-origin bridge, action retries or offline actions. Recovery only reacquires reads and existing grants.
export class PodVoiceTransport {
 constructor({url = globalThis.location?.href, room, fetch = globalThis.fetch?.bind(globalThis), EventSource = globalThis.EventSource, onSnapshot = () => {}, onControllerRenewed = () => {}, onConnection = () => {}, locks = globalThis.navigator?.locks, BroadcastChannel = globalThis.window ? globalThis.BroadcastChannel : undefined, crypto = globalThis.crypto} = {}) {
  const page = new URL(url);
  if (!['https:', 'http:'].includes(page.protocol) || !/\/view\//.test(page.pathname)) throw new Error('PodVoice ingress /view/ is required');
  const prefix = page.pathname.slice(0, page.pathname.lastIndexOf('/view/') + 6);
  this.base = new URL(`${prefix}api/`, page.origin);
  this.room = room; this.fetch = fetch; this.EventSource = EventSource;
  this.locks=locks;this.BroadcastChannel=BroadcastChannel;this.crypto=crypto;this.cookieScope=page.origin+prefix;this.requireLocalRenewal=/\/setup(?:\.html)?$/.test(page.pathname);this.peerSeen=new Map();this.peerSequence=0;this.coordinationMode=locks?.request?'serialized':'read-hints-only';
  this.onSnapshot = onSnapshot; this.onControllerRenewed=onControllerRenewed; this.onConnection = onConnection;
  this.controllerRenewalOwner={}; this.snapshot = null; this.connected = false; this.closed = true; this.generation = 0;
 }
 async coordinate(){
  if(this.coordinatorPromise)return this.coordinatorPromise;
  const epoch=this.coordinatorEpoch||0;
  this.coordinatorPromise=(async()=>{if(!this.crypto?.subtle){this.coordinationMode='read-hints-only';return;}const digest=await this.crypto.subtle.digest('SHA-256',new TextEncoder().encode(this.cookieScope));if(this.closed||epoch!==(this.coordinatorEpoch||0))return;this.coordinatorName='podview-controller-'+[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');if(this.BroadcastChannel){this.peerId=this.crypto.randomUUID();this.peerChannel=new this.BroadcastChannel(this.coordinatorName);this.peerChannel.onmessage=event=>this.receiveControllerNotice(event.data);}})();
  return this.coordinatorPromise;
 }
 receiveControllerNotice(value){
  if(this.closed||haIngress(this.snapshot)||this.recoveryBlocked||!value||Object.keys(value).sort().join(',')!=='sender,sequence,type,version'||value.version!==1||value.type!=='controller-cookie-changed'||typeof value.sender!=='string'||!value.sender||value.sender.length>64||value.sender===this.peerId||!Number.isSafeInteger(value.sequence)||value.sequence<1)return;
  const seen=this.peerSeen.get(value.sender)||0;if(value.sequence<=seen||!this.peerSeen.has(value.sender)&&this.peerSeen.size>=32)return;this.peerSeen.set(value.sender,value.sequence);this.peerRevision=(this.peerRevision||0)+1;this.peerReadPending=true;this.schedulePeerRead();
 }
 schedulePeerRead(){
  if(this.closed||haIngress(this.snapshot)||this.recoveryBlocked||!this.peerReadPending||this.restartCount||this.peerReadTimer)return;
  this.peerReadTimer=setTimeout(()=>{this.peerReadTimer=null;if(this.closed||this.recoveryBlocked||this.restartCount)return;this.peerReadPending=false;this.peerReadAt=Date.now();this.restart(false,false).catch(()=>{});},Math.max(50,1000-(Date.now()-(this.peerReadAt||0))));
 }
 async renewController(room,generation,coalesce=false,peerRevision=0){
  const channel=this.peerChannel;
  const perform=async()=>{if(this.closed||generation!==this.generation)return null;if(coalesce&&(this.peerRevision||0)>peerRevision)return {coalesced:true};this.renewHttpPending=true;
   try{const response=await this.request(this.endpoint('controller/renew'),{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({roomId:room})},undefined,null);const result=await response.json();if(response.ok&&result.ok===true&&result.expiresIn===300)channel?.postMessage({version:1,type:'controller-cookie-changed',sender:this.peerId,sequence:++this.peerSequence});return response;}
   finally{this.renewHttpPending=false;if(channel&&channel!==this.peerChannel)channel.close();}
  };
  return this.locks?.request&&this.coordinatorName?this.locks.request(this.coordinatorName,{mode:'exclusive'},perform):perform();
 }
 endpoint(path, params = {}) {
  if (!['snapshot','events','music','actions','pair','home','answers','controller/renew','controller/request','controller/claim'].includes(path)) throw new Error('unsupported_endpoint');
  const url = new URL(path, this.base);
  if (this.room) url.searchParams.set('room', this.room);
  for (const [key,value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key,value);
  return url;
 }
 accept(value) {
  if (this.closed || value?.schema !== 'podview.snapshot.v1' || typeof value.bootId !== 'string' || !Number.isInteger(value.revision) || value.revision < 1 || typeof value.roomId !== 'string' || !value.voice || !value.timers || !value.capabilities) return false;
  if (!['observed','unavailable'].includes(value.timers.status)||!Array.isArray(value.timers.items)||!Array.isArray(value.capabilities.musicRead)||!Array.isArray(value.capabilities.timerActions)) return false;
  if(value.capabilities.homeRead!==undefined&&(!Array.isArray(value.capabilities.homeRead)||value.capabilities.homeRead.some(x=>!['vacuum','weather'].includes(x))))return false;
  if(value.capabilities.controlSetup!==undefined&&(!Array.isArray(value.capabilities.controlSetup)||value.capabilities.controlSetup.some(x=>!['music','vacuum'].includes(x))))return false;
  if((value.answerHistoryRevision!==undefined||value.answerHistoryRemovalRevision!==undefined||value.answerHistoryReceiptIds!==undefined)&&(!Number.isSafeInteger(value.answerHistoryRevision)||value.answerHistoryRevision<0||!Number.isSafeInteger(value.answerHistoryRemovalRevision)||value.answerHistoryRemovalRevision<0||value.answerHistoryRemovalRevision>value.answerHistoryRevision||!Array.isArray(value.answerHistoryReceiptIds)||value.answerHistoryReceiptIds.length>20||value.answerHistoryReceiptIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))||new Set(value.answerHistoryReceiptIds).size!==value.answerHistoryReceiptIds.length))return false;
  if(value.capabilities.answerRead!==undefined&&typeof value.capabilities.answerRead!=='boolean')return false;
  if(value.capabilities.musicSelection!==undefined&&typeof value.capabilities.musicSelection!=='boolean')return false;
  if(value.capabilities.queueSelection!==undefined&&typeof value.capabilities.queueSelection!=='boolean')return false;
  if(value.capabilities.answerRead===true){const a=value.answers;if(a?.readOnlyCompleted!==undefined&&(a.readOnlyCompleted!==true||value.voice.active!==false||value.voice.sessionId!==null||!a.sessionId))return false;if(!a||!Number.isInteger(a.revision)||a.revision<0||['sessionId','turnId','taskId'].some(k=>a[k]!==null&&(typeof a[k]!=='string'||!a[k]||a[k].length>160))||(a.inputRevision!==null&&(!Number.isInteger(a.inputRevision)||a.inputRevision<0)))return false;const empty=a.sessionId===null;if(empty?(a.turnId!==null||a.taskId!==null||a.inputRevision!==null):(a.turnId===null||a.taskId===null||a.inputRevision===null))return false;}
  if(value.visualPending!==undefined){const p=value.visualPending;if(!p||Object.keys(p).sort().join(',')!=='inputRevision,revision,roomId,sessionId,taskId,turnId'||p.roomId!==value.roomId||value.voice.active!==true||value.voice.phase==='CLOSING'||p.sessionId!==value.voice.sessionId||['sessionId','turnId','taskId'].some(k=>typeof p[k]!=='string'||!p[k]||p[k].length>160)||!Number.isInteger(p.inputRevision)||p.inputRevision<0||!Number.isInteger(p.revision)||p.revision<0||p.revision!==value.answers?.revision||value.capabilities.answerRead!==true)return false;}
  if((value.admission!==undefined||this.normalHAMode)&&!haIngress(value))return false;
  const normalHA=haIngress(value);
  if(value.controllerContinuity!==undefined){const c=value.controllerContinuity;if(!c||!['available,enabled','available,enabled,maxDays'].includes(Object.keys(c).sort().join(','))||typeof c.enabled!=='boolean'||typeof c.available!=='boolean'||('maxDays'in c&&(!Number.isInteger(c.maxDays)||c.maxDays<0||c.maxDays>30)))return false;}
  if (this.room && value.roomId !== this.room) return false;
  if (this.snapshot?.bootId === value.bootId && this.snapshot.revision > value.revision) return false;
  if(this.snapshot?.bootId===value.bootId&&this.snapshot.roomId===value.roomId&&value.answerHistoryRevision!==undefined&&(this.snapshot.answerHistoryRevision>value.answerHistoryRevision||this.snapshot.answerHistoryRemovalRevision>value.answerHistoryRemovalRevision))return false;
  const writable=!!(value.capabilities.timerActions.length||value.capabilities.musicActions?.length||value.capabilities.controlSetup?.length||value.capabilities.musicSelection===true||value.capabilities.queueSelection===true);
  if(!normalHA&&this.lastWritableProjection===true&&!writable&&value.controllerContinuity?.enabled===true&&value.controllerContinuity.available===true){this.controllerRenewed=false;this.cookieReadAuthority=false;this.recoveryReadOnly=false;}
  this.lastWritableProjection=writable;
  if(normalHA||value.controllerContinuity?.enabled===true&&value.controllerContinuity.available===false){
   this.controllerRenewed=false;this.cookieReadAuthority=false;this.controllerRenewAt=null;clearTimeout(this.recoveryTimer);this.recoveryTimer=null;clearTimeout(this.controllerRenewTimer);this.controllerRenewTimer=null;
  }
  if(!normalHA&&(this.controllerRenewalDenied||value.controllerContinuity?.enabled===true&&this.controllerRenewed!==true&&!this.cookieReadAuthority))value={...value,capabilities:{...value.capabilities,timerActions:[],musicActions:[],musicSelection:false,queueSelection:false,controlSetup:[]}};
  if(normalHA){
   this.normalHAMode=true;
   this.controllerRenewRetryAt=null;this.coordinatorEpoch=(this.coordinatorEpoch||0)+1;this.coordinatorPromise=null;this.coordinatorName=null;
   if(this.peerChannel){this.peerChannel.onmessage=null;this.peerChannel.close();this.peerChannel=null;}this.peerSeen.clear();this.peerReadPending=false;clearTimeout(this.peerReadTimer);this.peerReadTimer=null;
  }
  this.room = value.roomId; this.snapshot = value; this.connected = true;
  if(normalHA||value.controllerContinuity?.enabled!==true||value.controllerContinuity.available===false||this.controllerRenewed===true||this.cookieReadAuthority){clearTimeout(this.recoveryTimer);this.recoveryTimer=null;this.recoveryAttempt=0;}
  if(!normalHA&&value.controllerContinuity?.enabled===true&&value.controllerContinuity.available===true&&!this.controllerRenewed&&!this.cookieReadAuthority)this.scheduleRecovery();
  this.onConnection('connected'); this.onSnapshot(value);clearTimeout(this.freshnessTimer);this.freshnessTimer=setTimeout(()=>{if(!this.closed)this.disconnected();},6000);return true;
 }
 async start() {this.controllerRenewalDenied=false;return this.restart(false,true,!this.requireLocalRenewal);}
 scheduleRecovery(){
  if(this.closed||this.recoveryBlocked||this.recoveryTimer)return;
  const generation=this.generation,attempt=this.recoveryAttempt||0;
  this.recoveryAttempt=Math.min(attempt+1,6);
  const delay=Math.min(30000,1000*2**Math.min(attempt,5));
  this.recoveryTimer=setTimeout(()=>{this.recoveryTimer=null;if(!this.closed&&!this.recoveryBlocked&&generation===this.generation)this.restart(true,!this.recoveryReadOnly).catch(()=>{});},delay);
 }
 async restart(retrying=false,renew=true,coalesce=false){this.restartCount=(this.restartCount||0)+1;try{return await this.restartRead(retrying,renew,coalesce);}finally{this.restartCount--;this.schedulePeerRead();}}
 async restartRead(retrying=false,renew=true,coalesce=false) {
  // Enrollment denial does not revoke verified reads; automatic recovery stays read-only.
  renew=renew&&!this.controllerRenewalDenied;
  const attempt=retrying?this.recoveryAttempt||0:0;
  const peerRevision=this.peerRevision||0,renewAt=this.controllerRenewAt;this.close(false); this.closed = false;this.recoveryAttempt=attempt;this.recoveryReadOnly=!renew;this.controllerRenewAt=renew?null:renewAt;
  const generation = this.generation;
  this.controller = new AbortController();
  this.onConnection('connecting');
  try {
   let response = await this.request(this.endpoint('snapshot'), {credentials:'same-origin', cache:'no-store', signal:this.controller.signal});
   let value = await response.json();
   if (generation !== this.generation) return;
   if([401,403].includes(response.status)){this.recoveryBlocked=true;throw Error('transport_access_denied');}
   if((value?.admission!==undefined||this.normalHAMode)&&!haIngress(value))throw Error('invalid_admission');
   const normalHA=haIngress(value);
   if(!normalHA){await this.coordinate();if(generation!==this.generation||this.closed)return;}
   let renewed=false;
   if(!normalHA&&renew&&response.ok&&value?.controllerContinuity?.enabled===true&&value.controllerContinuity.available===true){
    try{
     const renewal=await this.renewController(value.roomId,generation,coalesce,peerRevision);if(!renewal)return;
     if(renewal.coalesced){renew=false;this.recoveryReadOnly=true;this.controllerRenewAt=renewAt;this.controllerRenewRetryAt=Date.now()+30000;this.peerReadPending=false;}
     else{const result=await renewal.json();if(generation!==this.generation)return;if([401,403].includes(renewal.status)){this.controllerRenewalDenied=true;this.recoveryReadOnly=true;this.controllerRenewAt=null;this.controllerRenewRetryAt=null;throw Error('controller_renewal_denied');}renewed=renewal.ok&&result.ok===true&&result.expiresIn===300;}
     if(renewed||renewal.coalesced){response=await this.request(this.endpoint('snapshot'),{credentials:'same-origin',cache:'no-store'});value=await response.json();if(generation!==this.generation)return;if([401,403].includes(response.status)){this.recoveryBlocked=true;throw Error('transport_access_denied');}if(renewed)renewed=response.ok;}
    }catch{if(generation!==this.generation)return;}

   }
   if(generation!==this.generation)return;
   if(this.recoveryBlocked)throw Error('transport_access_denied');
   this.controllerRenewed=renewed;this.cookieReadAuthority=!normalHA&&!this.controllerRenewalDenied&&!renew&&response.ok;
   if(!haIngress(value)&&(this.controllerRenewalDenied||value?.controllerContinuity?.enabled===true&&!renewed&&!this.cookieReadAuthority))value={...value,capabilities:{...value.capabilities,timerActions:[],musicActions:[],musicSelection:false,queueSelection:false,controlSetup:[]}};
   if (!response.ok || !this.accept(value)) throw new Error(value.error || 'invalid_snapshot');
   if(generation!==this.generation||this.closed)return;
   if(this.controllerRenewed===true)this.onControllerRenewed({owner:this.controllerRenewalOwner,generation});
   if(generation!==this.generation||this.closed)return;
   if(this.controllerRenewed===true){this.controllerRenewAt=Date.now()+240000;this.controllerRenewRetryAt=null;}
   if(!normalHA&&(this.controllerRenewAt||this.controllerRenewRetryAt)&&value.controllerContinuity?.available!==false)this.controllerRenewTimer=setTimeout(()=>{if(!this.closed&&generation===this.generation)this.restart(false,true,true).catch(()=>{});},Math.max(0,Math.max(this.controllerRenewAt||0,this.controllerRenewRetryAt||0)-Date.now()));
   this.stream = new this.EventSource(this.endpoint('events'), {withCredentials:false});
   this.stream.addEventListener('snapshot', event => {
    if (generation !== this.generation) return;
    try { if (!this.accept(JSON.parse(event.data))) this.disconnected(); } catch { this.disconnected(); }
   });
   this.stream.onerror = () => { if (generation === this.generation) this.disconnected(); };
   if(!normalHA&&value.controllerContinuity?.enabled===true&&value.controllerContinuity.available===true&&!renewed&&!this.cookieReadAuthority)this.scheduleRecovery();
  } catch (error) { if (generation === this.generation) { this.disconnected(); throw error; } }
 }
 disconnected() { this.connected = false; this.onConnection('disconnected');this.scheduleRecovery(); }
 async request(url,options,ms,signal=this.controller?.signal){const generation=this.generation,read=!options?.method||options.method==='GET';const result=await requestWithin(async(target,init)=>{const response=await this.fetch(target,init);let body;try{body=await response.json();}catch(error){if([401,403].includes(response.status))body={error:"transport_access_denied"};else{if(read&&([408,429].includes(response.status)||response.status>=500&&response.status<=599))error.code='read_transient';throw error;}}return {ok:response.ok,status:response.status,json:async()=>body};},url,options,signal,ms);if(read&&(this.closed||generation!==this.generation))throw new DOMException('Read owner changed','AbortError');return result;}
 async home(){
  if(!this.connected||!this.snapshot.capabilities.homeRead?.length)throw new Error('home_unavailable');
  const response=await this.request(this.endpoint('home'),{credentials:'same-origin',cache:'no-store'});if(!response.ok){const error=new Error('home_unavailable');if([401,403].includes(response.status))error.code='read_access_denied';else if([408,429].includes(response.status)||response.status>=500&&response.status<=599)error.code='read_transient';throw error;}return response.json();
 }
 async controlSetup(domain,target,recipeId){if(!this.connected||!this.snapshot.capabilities.controlSetup?.includes(domain))throw Error('control_not_paired');const s=this.snapshot,url=new URL('control/setup',this.base);const response=await this.request(url,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({bootId:s.bootId,roomId:s.roomId,domain,target,...(recipeId?{recipeId}:{})})});if(!response.ok)throw Error('control_setup_denied');return response.json();}
 async controlAction(task,optionId,args){
  const unknown=requestId=>({ok:false,requestId,outcome:'unknown',retryAllowed:false,physicalResultVerified:false});
  if(!this.connected||this.snapshot.bootId!==task.bootId||this.snapshot.roomId!==task.roomId||!this.snapshot.capabilities.controlSetup?.includes(task.domain))return {ok:false,outcome:'rejected',retryAllowed:false,physicalResultVerified:false};
  const requestId=crypto.randomUUID(),url=new URL('control/actions',this.base);
  try{const response=await this.request(url,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({bootId:task.bootId,roomId:task.roomId,taskId:task.taskId,revision:task.revision,requestId,optionId,args})});const body=await response.json();
   if(!response.ok||!body||body.requestId!==requestId||!['accepted','unknown','rejected'].includes(body.outcome)||typeof body.ok!=='boolean'||body.ok!==(body.outcome==='accepted')||body.retryAllowed!==false||body.physicalResultVerified!==false)return unknown(requestId);
   return {ok:body.ok,requestId,outcome:body.outcome,retryAllowed:false,physicalResultVerified:false};
  }catch{return unknown(requestId);}
 }
 async answers(history=false){if(!this.connected||this.snapshot.capabilities.answerRead!==true)throw Error('answers_unavailable');const response=await this.request(this.endpoint('answers',history===true?{history:'1'}:{}),{credentials:'same-origin',cache:'no-store'});if(!response.ok){const error=Error('answers_unavailable');if([401,403].includes(response.status))error.code='read_access_denied';throw error;}return response.json();}
 async source(id){if(!this.connected||this.snapshot.capabilities.answerRead!==true||!/^[a-f0-9]{32}$/.test(id))throw Error('source_unavailable');const url=new URL('sources/'+id,this.base);url.searchParams.set('room',this.room);const response=await this.request(url,{credentials:'same-origin',cache:'no-store'});if(!response.ok){const error=Error('source_unavailable');if([401,403].includes(response.status))error.code='read_access_denied';throw error;}return response.json();}
 async music(kind, account, query) {
  if (!this.connected || !this.snapshot.capabilities.musicRead?.includes(kind==='speakers'?'targets':kind)) throw new Error('music_unavailable');
  if(kind==='search'&&(typeof query!=='string'||query.trim()!==query||query.length<1||query.length>160))throw new Error('invalid_query');
  const response = await this.request(this.endpoint('music', {kind,account,...(kind==='search'?{query}:['mood','feeling'].includes(kind)&&query==='refresh'?{refresh:'1'}:['mood','feeling'].includes(kind)&&query==='renew'?{renew:'1'}:{})}), {credentials:'same-origin',cache:'no-store',signal:this.controller.signal});
  const body = await response.json(); if (!response.ok || !body.ok){const error=new Error(body.error || 'music_unavailable');if([401,403].includes(response.status))error.code='read_access_denied';else if([408,429].includes(response.status)||response.status>=500&&response.status<=599)error.code='read_transient';throw error;}
  return body;
 }
 async queueOffer(accountId,targetId){const s=this.snapshot;if(!this.connected||s?.capabilities.queueSelection!==true||typeof accountId!=='string'||!accountId||typeof targetId!=='string'||!targetId)throw Error('queue_not_paired');const response=await this.request(new URL('music/queue/offer',this.base),{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({bootId:s.bootId,roomId:s.roomId,accountId,targetId})},16000);const body=await response.json();if(!response.ok||body.ok!==true)throw Error('queue_offer_unavailable');return body;}
 async queueAction(task,optionId){const rejected={ok:false,outcome:'rejected',retryAllowed:false,physicalResultVerified:false},s=this.snapshot;if(!this.connected||s?.capabilities.queueSelection!==true||s.bootId!==task.bootId||s.roomId!==task.roomId||!task.items?.some(row=>row.id===optionId))return rejected;const requestId=crypto.randomUUID(),unknown={...rejected,requestId,outcome:'unknown'};try{const response=await this.request(new URL('music/queue/actions',this.base),{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({bootId:task.bootId,roomId:task.roomId,taskId:task.taskId,revision:task.revision,requestId,optionId})});const body=await response.json();if(!response.ok||body.requestId!==requestId||!['accepted','unknown','rejected'].includes(body.outcome)||typeof body.ok!=='boolean'||body.ok!==(body.outcome==='accepted')||body.retryAllowed!==false||body.physicalResultVerified!==false)return unknown;return body;}catch{return unknown;}}
 async musicSelectionSetup(candidateSetId,target,candidateIds){
  const s=this.snapshot;
  if(!this.connected||s?.capabilities.musicSelection!==true||!/^[a-f0-9]{64}$/.test(candidateSetId)||target?.kind!=='spotify_device'||typeof target.accountId!=='string'||!target.accountId||typeof target.targetId!=='string'||!target.targetId)throw new Error('selection_unavailable');
  if(target.speakerId!==undefined&&!/^[a-f0-9]{64}$/.test(target.speakerId))throw new Error('invalid_destination');
  if(candidateIds!==undefined&&(!Array.isArray(candidateIds)||candidateIds.length<1||candidateIds.length>3||new Set(candidateIds).size!==candidateIds.length||candidateIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{24}$/.test(id))))throw new Error('invalid_candidates');
  const url=new URL('music/selection/setup',this.base);
  const response=await this.request(url,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({bootId:s.bootId,roomId:s.roomId,candidateSetId,target:{accountId:target.accountId,kind:'spotify_device',targetId:target.targetId,...(target.speakerId?{speakerId:target.speakerId}:{})},...(candidateIds===undefined?{}:{candidateIds:[...candidateIds]})})});
  const body=await response.json();if(!response.ok||body?.ok!==true)throw new Error(body?.error||'selection_unavailable');return body;
 }
 async musicSelectionAction(offer,optionId){
  const rejected={ok:false,outcome:'rejected',retryAllowed:false,physicalResultVerified:false};
  if(!this.connected||this.snapshot?.capabilities.musicSelection!==true||this.snapshot.bootId!==offer?.bootId||this.snapshot.roomId!==offer?.roomId||Date.now()>=offer?.expiresAt||!offer.options?.some(option=>option.id===optionId))return rejected;
  const requestId=crypto.randomUUID(),url=new URL('music/selection/actions',this.base);
  try{const response=await this.request(url,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({bootId:offer.bootId,roomId:offer.roomId,taskId:offer.taskId,revision:offer.revision,requestId,optionId,confirmedVolumePercent:offer.startVolumePercent})});const body=await response.json();
   if(!response.ok||body?.requestId!==requestId||!['accepted','rejected','unknown'].includes(body.outcome)||body.retryAllowed!==false||body.physicalResultVerified!==false||body.ok!==(body.outcome==='accepted'))return {ok:false,requestId,outcome:'unknown',retryAllowed:false,physicalResultVerified:false};
   return body;
  }catch{return {ok:false,requestId,outcome:'unknown',retryAllowed:false,physicalResultVerified:false};}
 }
 async accessRequest(name) {
  if(haIngress(this.snapshot)||!this.connected||this.snapshot?.controllerContinuity?.available!==true||typeof name!=='string'||name!==name.trim()||!name||name.length>48||/[\u0000-\u001f\u007f]/u.test(name))throw Error('access_unavailable');
  return this.accessExchange('controller/request',{name});
 }
 async accessClaim(requestId) {
  if(haIngress(this.snapshot)||!this.connected||this.snapshot?.controllerContinuity?.available!==true||typeof requestId!=='string'||!/^[a-f0-9]{32}$/.test(requestId))throw Error('access_unavailable');
  return this.accessExchange('controller/claim',{requestId});
 }
 async accessExchange(path,args) {
  if(haIngress(this.snapshot))throw Error('access_unavailable');
  const {bootId,roomId}=this.snapshot,generation=this.generation;
  const response=await this.request(this.endpoint(path),{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({bootId,roomId,...args})});
  const body=await response.json();
  if(this.closed||!this.connected||this.generation!==generation||this.snapshot?.bootId!==bootId||this.snapshot?.roomId!==roomId)throw Error('access_changed');
  if(!response.ok||body?.ok!==true){const error=Error('access_denied');if(['controller_limit','request_expired','request_denied'].includes(body?.error))error.code=body.error;throw error;}
  const keys=Object.keys(body).sort().join(',');
  if(path==='controller/request'){
   if(keys!=='expiresIn,matchSignal,ok,requestId'||typeof body.requestId!=='string'||!/^[a-f0-9]{32}$/.test(body.requestId)||typeof body.matchSignal!=='string'||!/^[A-Z0-9]{6}$/.test(body.matchSignal)||body.expiresIn!==300)throw Error('invalid_access_request');
   return {requestId:body.requestId,matchSignal:body.matchSignal,expiresIn:body.expiresIn};
  }
  if(keys==='ok,status'&&body.status==='connected')return {status:'connected'};
  if(keys==='expiresIn,ok,status'&&body.status==='pending'&&Number.isInteger(body.expiresIn)&&body.expiresIn>=0&&body.expiresIn<=300)return {status:'pending',expiresIn:body.expiresIn};
  throw Error('invalid_access_status');
 }
 async pair(code) {
  if (haIngress(this.snapshot)||!this.connected || !this.room) throw new Error('disconnected');
  const response = await this.request(this.endpoint('pair'), {method:'POST',credentials:'same-origin',cache:'no-store',signal:this.controller.signal,headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({roomId:this.room,code})});
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'pairing_denied');
  // Cookie is HttpOnly: reopen SSE so its request captures the newly paired cookie.
  await this.start();
  return result;
 }
 async action({action, args, requestId}) {
  if (!this.connected || !this.snapshot) throw new Error('control_not_paired');
  const snapshot = this.snapshot;
  if (!snapshot.capabilities.timerActions.includes(action)) throw new Error('unsupported_action');
  const body = {bootId:snapshot.bootId,roomId:snapshot.roomId,taskId:`timers:${snapshot.timers.epoch}`,revision:snapshot.revision,requestId,action,args};
  // Exactly one send. A transport failure is UNKNOWN, never permission to resend.
  try {
   const response = await this.request(this.endpoint('actions'), {method:'POST',credentials:'same-origin',cache:'no-store',signal:this.controller.signal,headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify(body)});
   return await response.json();
  } catch { return {ok:false,requestId,outcome:'unknown',retryAllowed:false}; }
 }
 close(disposeCoordinator=true) {
  if(disposeCoordinator){this.coordinatorEpoch=(this.coordinatorEpoch||0)+1;this.coordinatorPromise=null;const channel=this.peerChannel;this.peerChannel=null;if(channel){channel.onmessage=null;if(!this.renewHttpPending)channel.close();}this.peerSeen.clear();this.peerReadPending=false;clearTimeout(this.peerReadTimer);this.peerReadTimer=null;this.controllerRenewAt=null;this.controllerRenewRetryAt=null;}
  clearTimeout(this.recoveryTimer);this.recoveryTimer=null;this.recoveryAttempt=0;this.recoveryBlocked=false;
  clearTimeout(this.controllerRenewTimer);this.controllerRenewTimer=null;this.controllerRenewed=false;this.cookieReadAuthority=false;
  this.generation++; this.closed = true; this.connected = false;
  clearTimeout(this.freshnessTimer);this.controller?.abort(); this.stream?.close(); this.stream = null;
 }
}
