import {requestWithin} from './request-deadline.js';
const controlSetupFailureCodes=new Set(['invalid_setup','scope_not_paired','busy','invalid_target','target_not_granted','setup_capacity','stale_setup','setup_unavailable']);
const diagnosticStages=new Set(['request','observer','sse','freshness','connection','control_setup','volume_setup','control_action','music_read','playback_confirmation','queue_read','queue_action','browser','lifecycle','control_state','volume_state','artwork']);
const diagnosticCodes=new Set([...controlSetupFailureCodes,'start','ok','accepted','unknown','rejected','http_denied','http_transient','http_error','invalid_json','timeout','cancelled','network','failure','invalid_dto','stale_binding','superseded','empty','unavailable','matched','unconfirmed','expiry','error','cleanup','disconnected','connecting','connected','unhandled_rejection','read_inflight','intent_pending','spent','unknown_fence','capability_missing','unknown_value','resource_error','decode_error','other']);
const diagnosticEndpoints=new Set(['snapshot','events','home','answers','actions','pair','controller/renew','controller/request','controller/claim','music','source','weather-advice','control/setup','control/actions','music/queue/offer','music/queue/actions','music/selection/setup','music/selection/actions','other']);
const diagnosticKinds=new Set(['targets','playback','speakers','mood','feeling','top','recent','search','account_playlists','queue','other']);
const diagnosticQuiet=new Set(['start','ok','connected','connecting','matched','empty','accepted','cleanup','superseded','cancelled']);
function diagnosticRow(value){
 if(!value||!diagnosticStages.has(value.stage))return null;
 const row={stage:value.stage,code:diagnosticCodes.has(value.code)?value.code:'other'};
 for(const key of ['seq','atMs','generation','localRequestSeq','durationMs','count'])if(Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<=(key==='durationMs'?120000:key==='count'?64:Number.MAX_SAFE_INTEGER))row[key]=value[key];
 if(Number.isInteger(value.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599)row.httpStatus=value.httpStatus;
 for(const key of ['current','pending','connected','restored'])if(typeof value[key]==='boolean')row[key]=value[key];
 if(diagnosticEndpoints.has(value.endpoint))row.endpoint=value.endpoint;
 if(diagnosticKinds.has(value.kind))row.kind=value.kind;
 if(typeof value.requestId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.requestId))row.requestId=value.requestId.toLowerCase();
 return Object.freeze(row);
}
const haIngress = value => value?.admission?.kind==='ha_ingress'&&value.admission.authenticated===true&&Object.keys(value.admission).sort().join(',')==='authenticated,kind';
// Same-origin HA-ingress transport. Import only in live /view/ mode.
// No provider credentials, cross-origin bridge, action retries or offline actions. Recovery only reacquires reads and existing grants.
export class PodVoiceTransport {
 constructor({url = globalThis.location?.href, room, fetch = globalThis.fetch?.bind(globalThis), EventSource = globalThis.EventSource, onSnapshot = () => {}, onControllerRenewed = () => {}, onConnection = () => {}, locks = globalThis.navigator?.locks, BroadcastChannel = globalThis.window ? globalThis.BroadcastChannel : undefined, crypto = globalThis.crypto, screenEnrollment = false, namedIntentStorage, diagnosticStorage, diagnosticBuild} = {}) {
  const page = new URL(url);
  if (!['https:', 'http:'].includes(page.protocol) || !/\/view\//.test(page.pathname)) throw new Error('PodVoice ingress /view/ is required');
  const prefix = page.pathname.slice(0, page.pathname.lastIndexOf('/view/') + 6);
  this.base = new URL(`${prefix}api/`, page.origin);
  this.room = room; this.fetch = fetch; this.EventSource = EventSource;
  this.diagnosticBuild=diagnosticBuild===undefined?globalThis.document?.querySelector?.('meta[name="podview-build"]')?.content:diagnosticBuild;this.diagnosticScopes=new WeakMap();this.diagnosticUploadAcked=new Set();this.diagnosticUploadAt=-Infinity;this.diagnosticUploadEpoch=0;
  this.diagnosticRows=[];this.diagnosticSequence=0;this.diagnosticDropped=0;this.diagnosticRequestSequence=0;this.diagnosticStorageAvailable=false;this.diagnosticPersistAt=-Infinity;this.diagnosticDirty=false;this.diagnosticPersistPending=false;
  try{this.diagnosticStorage=diagnosticStorage===undefined?globalThis.sessionStorage:diagnosticStorage;const saved=this.diagnosticStorage?.getItem('podview.client-diagnostics.v1');if(typeof saved==='string'&&saved.length<=65536){const value=JSON.parse(saved);if(value?.schema==='podview.client-diagnostics.v1'&&Array.isArray(value.records)&&value.records.length<=128){this.diagnosticRows=value.records.map(diagnosticRow).filter(row=>row&&Number.isSafeInteger(row.seq)&&Number.isSafeInteger(row.atMs)).map((row,index)=>Object.freeze({...row,seq:index+1,restored:true}));this.diagnosticSequence=Math.max(0,...this.diagnosticRows.map(row=>row.seq));}}this.diagnosticStorageAvailable=!!this.diagnosticStorage;}catch{this.diagnosticStorage=null;}

  this.locks=locks;this.BroadcastChannel=BroadcastChannel;this.crypto=crypto;this.cookieScope=page.origin+prefix;this.requireLocalRenewal=/\/setup(?:\.html)?$/.test(page.pathname);this.peerSeen=new Map();this.peerSequence=0;this.coordinationMode=locks?.request?'serialized':'read-hints-only';
  this.screenEnrollment=screenEnrollment===true&&this.requireLocalRenewal;
  try{this.namedIntentStorage=namedIntentStorage===undefined?globalThis.localStorage:namedIntentStorage;}catch{this.namedIntentStorage=null;}
  this.namedIntentKey='podview.named-screen.intent.v1:'+this.cookieScope;
  this.namedControllerRenewed=false;this.namedLaneWanted=false;this.namedRenewalDenied=false;this.namedRenewalUnconfirmed=false;
  this.onSnapshot = onSnapshot; this.onControllerRenewed=onControllerRenewed; this.onConnection = onConnection;
  this.controllerRenewalOwner={}; this.snapshot = null; this.acceptedReadAt = null; this.connected = false; this.closed = true; this.generation = 0;
 }
 // Content-free diagnostics never own authority, retries, UI state or dispatch.
 recordDiagnostic(stage,fields={}){
  try{
   const row=diagnosticRow({...fields,stage,seq:++this.diagnosticSequence,atMs:Date.now(),generation:this.generation||0,connected:this.connected===true,restored:false});if(!row)return;
   const critical=!diagnosticQuiet.has(row.code);
   if(this.diagnosticRows.length>=128){const quiet=this.diagnosticRows.findIndex(entry=>diagnosticQuiet.has(entry.code));if(quiet<0&&!critical){this.diagnosticDropped++;return;}this.diagnosticRows.splice(quiet<0?0:quiet,1);this.diagnosticDropped++;}
   this.diagnosticRows.push(row);if(this.diagnosticScope)this.diagnosticScopes.set(row,this.diagnosticScope);this.scheduleDiagnosticUpload();
   if(critical)this.diagnosticDirty=true;
   if(this.diagnosticDirty&&this.diagnosticStorage&&!this.diagnosticPersistPending&&Date.now()-this.diagnosticPersistAt>=1000){this.diagnosticPersistPending=true;queueMicrotask(()=>{this.diagnosticPersistPending=false;this.flushDiagnostics();});}
  }catch{/* Diagnostic failure can never alter an operation or recursively log. */}
 }
 flushDiagnostics(){try{if(!this.diagnosticDirty||!this.diagnosticStorage)return false;this.diagnosticPersistAt=Date.now();this.diagnosticStorage.setItem('podview.client-diagnostics.v1',JSON.stringify({schema:'podview.client-diagnostics.v1',records:this.diagnosticRows}));this.diagnosticStorageAvailable=true;this.diagnosticDirty=false;return true;}catch{this.diagnosticStorageAvailable=false;return false;}}
 diagnostics(){return {schema:'podview.client-diagnostics.v1',capacity:128,dropped:this.diagnosticDropped,storageAvailable:this.diagnosticStorageAvailable,pendingPersistence:this.diagnosticDirty,restoredUntrusted:true,records:this.diagnosticRows.map(row=>({...row}))};}
 // Telemetry is independent of product requests: never recurse, renew authority or replay commands.
 syncDiagnosticScope(value){
  if(!value||typeof value.roomId!=='string'||!value.roomId||typeof value.bootId!=='string'||!/^[a-f0-9]{32}$/.test(value.bootId))return;
  const scope=JSON.stringify([value.roomId,value.bootId]);
  if(scope!==this.diagnosticScope){this.stopDiagnosticUpload();this.diagnosticScope=scope;this.diagnosticUploadBatch=null;this.diagnosticUploadAcked.clear();this.diagnosticUploadAt=-Infinity;this.diagnosticUploadStopped=false;}
  if(this.diagnosticAdmittedGeneration!==this.generation){this.diagnosticAdmittedGeneration=this.generation;this.diagnosticUploadStopped=false;}this.scheduleDiagnosticUpload();
 }
 stopDiagnosticUpload(){clearTimeout(this.diagnosticUploadTimer);this.diagnosticUploadTimer=null;this.diagnosticUploadEpoch++;this.diagnosticUploadController?.abort();this.diagnosticUploadController=null;}
 scheduleDiagnosticUpload(){
  if(this.closed||!this.diagnosticScope||this.diagnosticUploadStopped||this.diagnosticUploadTimer||this.diagnosticUploadController)return;
  if(!this.diagnosticUploadBatch&&!this.diagnosticRows.some(row=>!row.restored&&this.diagnosticScopes.get(row)===this.diagnosticScope&&!this.diagnosticUploadAcked.has(row.seq)))return;
  this.diagnosticUploadTimer=setTimeout(()=>{this.diagnosticUploadTimer=null;this.flushDiagnosticUpload().catch(()=>{});},Math.max(1000,10000-(Date.now()-this.diagnosticUploadAt)));
 }
 async flushDiagnosticUpload(){
  clearTimeout(this.diagnosticUploadTimer);this.diagnosticUploadTimer=null;
  if(this.closed||!this.diagnosticScope||this.diagnosticUploadStopped||this.diagnosticUploadController||Date.now()-this.diagnosticUploadAt<10000)return false;
  const scope=this.diagnosticScope,epoch=this.diagnosticUploadEpoch,now=Date.now();
  if(!this.diagnosticUploadBatch){
   const batchId=this.crypto?.randomUUID?.();if(typeof batchId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(batchId))return false;
   const records=[],seqs=[],[roomId,bootId]=JSON.parse(scope),uiBuild=typeof this.diagnosticBuild==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(this.diagnosticBuild)?this.diagnosticBuild:null;
   const body={schema:'podview.client-diagnostics.v1',batchId,roomId,bootId,uiBuild,records};
   for(const entry of this.diagnosticRows){
    if(entry.restored||this.diagnosticScopes.get(entry)!==scope||this.diagnosticUploadAcked.has(entry.seq))continue;
    const ageMs=now-entry.atMs;if(!Number.isSafeInteger(ageMs)||ageMs<0||ageMs>604800000)continue;
    const row={...diagnosticRow(entry),ageMs};delete row.atMs;delete row.restored;
    records.push(row);if(new TextEncoder().encode(JSON.stringify(body)).length>8192){records.pop();break;}seqs.push(entry.seq);if(records.length===16)break;
   }
   if(!records.length)return false;
   this.diagnosticUploadBatch={batchId,body:JSON.stringify(body),seqs,scope,createdAt:now};
  }
  const batch=this.diagnosticUploadBatch;if(batch.scope!==scope)return false;
  if(now-batch.createdAt>60000){this.diagnosticUploadStopped=true;return false;}
  const controller=new AbortController();this.diagnosticUploadController=controller;this.diagnosticUploadAt=now;
  try{
   const url=new URL('client-diagnostics',this.base);url.searchParams.set('room',this.snapshot.roomId);
   const {response,ack}=await requestWithin(async(target,options)=>{const response=await this.fetch(target,options);if(response.status!==200)return {response,ack:null};let abort;try{const ack=await Promise.race([response.json(),new Promise((resolve,reject)=>{abort=()=>reject(options.signal.reason||new DOMException('Aborted','AbortError'));if(options.signal.aborted)abort();else options.signal.addEventListener('abort',abort,{once:true});})]);return {response,ack};}finally{if(abort)options.signal.removeEventListener('abort',abort);}},url,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:batch.body},controller.signal,4000);
   if(this.closed||epoch!==this.diagnosticUploadEpoch||scope!==this.diagnosticScope)return false;
   if([400,403,409,413].includes(response.status)){this.diagnosticUploadStopped=true;return false;}
   if(response.status!==200)return false;
   if(this.closed||epoch!==this.diagnosticUploadEpoch||scope!==this.diagnosticScope)return false;
   if(!ack||Object.keys(ack).sort().join(',')!=='acceptedCount,batchId,duplicate,ok,schema,stored'||ack.schema!=='podview.client-diagnostics-ack.v1'||ack.ok!==true||ack.stored!==true||typeof ack.duplicate!=='boolean'||ack.batchId!==batch.batchId||ack.acceptedCount!==batch.seqs.length)return false;
   for(const seq of batch.seqs)this.diagnosticUploadAcked.add(seq);
   const live=new Set(this.diagnosticRows.map(row=>row.seq));for(const seq of this.diagnosticUploadAcked)if(!live.has(seq))this.diagnosticUploadAcked.delete(seq);
   this.diagnosticUploadBatch=null;return true;
  }catch{return false;}finally{if(this.diagnosticUploadController===controller){this.diagnosticUploadController=null;if(!this.closed&&epoch===this.diagnosticUploadEpoch)this.scheduleDiagnosticUpload();}}
 }
 // A public intent hint can request validation only. The HttpOnly cookie,
 // registry/pin and server response remain the sole profile authority.
 namedIntent(room){
  try{const v=JSON.parse(this.namedIntentStorage?.getItem(this.namedIntentKey)||'null');return !!v&&Object.keys(v).sort().join(',')==='cookieScope,roomId,version'&&v.version===1&&v.cookieScope===this.cookieScope&&v.roomId===room;}catch{return false;}
 }
 rememberNamedIntent(room){try{this.namedIntentStorage?.setItem(this.namedIntentKey,JSON.stringify({version:1,cookieScope:this.cookieScope,roomId:room}));}catch{/* Optional non-secret intent; never a credential. */}this.namedIntentStored=this.namedIntent(room);}
 forgetNamedIntent(){this.namedLaneWanted=false;this.namedControllerRenewed=false;this.namedIntentStored=false;this.namedRenewAt=null;clearTimeout(this.namedRenewTimer);this.namedRenewTimer=null;try{this.namedIntentStorage?.removeItem(this.namedIntentKey);}catch{/* Denial still closes the in-memory lane. */}}
 async coordinate(){
  if(this.coordinatorPromise)return this.coordinatorPromise;
  const epoch=this.coordinatorEpoch||0;
  this.coordinatorPromise=(async()=>{if(!this.crypto?.subtle){this.coordinationMode='read-hints-only';return;}const digest=await this.crypto.subtle.digest('SHA-256',new TextEncoder().encode(this.cookieScope));if(this.closed||epoch!==(this.coordinatorEpoch||0))return;this.coordinatorName='podview-controller-'+[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');if(this.BroadcastChannel){this.peerId=this.crypto.randomUUID();this.peerChannel=new this.BroadcastChannel(this.coordinatorName);this.peerChannel.onmessage=event=>this.receiveControllerNotice(event.data);}})();
  return this.coordinatorPromise;
 }
 receiveControllerNotice(value){
  if(this.closed||haIngress(this.snapshot)&&!this.namedLaneWanted||this.recoveryBlocked||!value||Object.keys(value).sort().join(',')!=='sender,sequence,type,version'||value.version!==1||value.type!=='controller-cookie-changed'||typeof value.sender!=='string'||!value.sender||value.sender.length>64||value.sender===this.peerId||!Number.isSafeInteger(value.sequence)||value.sequence<1)return;
  const seen=this.peerSeen.get(value.sender)||0;if(value.sequence<=seen||!this.peerSeen.has(value.sender)&&this.peerSeen.size>=32)return;this.peerSeen.set(value.sender,value.sequence);this.peerRevision=(this.peerRevision||0)+1;this.peerReadPending=true;this.schedulePeerRead();
 }
 schedulePeerRead(){
  if(this.closed||haIngress(this.snapshot)&&!this.namedLaneWanted||this.recoveryBlocked||!this.peerReadPending||this.restartCount||this.peerReadTimer)return;
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
 accept(value,readAt=Date.now()) {
  if (Date.now()-readAt>=6000||this.closed || value?.schema !== 'podview.snapshot.v1' || typeof value.bootId !== 'string' || !Number.isInteger(value.revision) || value.revision < 1 || typeof value.roomId !== 'string' || !value.voice || !value.timers || !value.capabilities) return false;
  if (!['observed','unavailable'].includes(value.timers.status)||!Array.isArray(value.timers.items)||!Array.isArray(value.capabilities.musicRead)||!Array.isArray(value.capabilities.timerActions)) return false;
  if(value.capabilities.homeRead!==undefined&&(!Array.isArray(value.capabilities.homeRead)||value.capabilities.homeRead.some(x=>!['vacuum','weather','light','vehicle'].includes(x))))return false;
  if(value.capabilities.controlSetup!==undefined&&(!Array.isArray(value.capabilities.controlSetup)||value.capabilities.controlSetup.some(x=>!['music','vacuum','light'].includes(x))))return false;
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
  if(normalHA&&this.namedControllerRenewed===true&&(
   this.snapshot&&(this.snapshot.bootId!==value.bootId||this.snapshot.roomId!==value.roomId)
   ||value.controllerContinuity?.enabled!==true||value.controllerContinuity.available!==true)){
   this.namedRenewalDenied=true;this.forgetNamedIntent();this.namedLaneWanted=false;
  }
  const writable=!!(value.capabilities.timerActions.length||value.capabilities.musicActions?.length||value.capabilities.controlSetup?.length||value.capabilities.musicSelection===true||value.capabilities.queueSelection===true);
  if(!normalHA&&this.lastWritableProjection===true&&!writable&&value.controllerContinuity?.enabled===true&&value.controllerContinuity.available===true){this.controllerRenewed=false;this.cookieReadAuthority=false;this.recoveryReadOnly=false;}
  this.lastWritableProjection=writable;
  if(normalHA||value.controllerContinuity?.enabled===true&&value.controllerContinuity.available===false){
   this.controllerRenewed=false;this.cookieReadAuthority=false;this.controllerRenewAt=null;clearTimeout(this.recoveryTimer);this.recoveryTimer=null;clearTimeout(this.controllerRenewTimer);this.controllerRenewTimer=null;
  }
  if(!normalHA&&(this.controllerRenewalDenied||value.controllerContinuity?.enabled===true&&this.controllerRenewed!==true&&!this.cookieReadAuthority))value={...value,capabilities:{...value.capabilities,timerActions:[],musicActions:[],musicSelection:false,queueSelection:false,controlSetup:[]}};
  if(normalHA&&(this.namedRenewalDenied||this.namedLaneWanted&&this.namedRenewalUnconfirmed))value={...value,capabilities:{...value.capabilities,controlSetup:value.capabilities.controlSetup?.filter(domain=>domain!=='light')}};
  if(normalHA){
   this.normalHAMode=true;
  }
  if(normalHA&&!this.namedLaneWanted){
   this.controllerRenewRetryAt=null;this.coordinatorEpoch=(this.coordinatorEpoch||0)+1;this.coordinatorPromise=null;this.coordinatorName=null;
   if(this.peerChannel){this.peerChannel.onmessage=null;this.peerChannel.close();this.peerChannel=null;}this.peerSeen.clear();this.peerReadPending=false;clearTimeout(this.peerReadTimer);this.peerReadTimer=null;
  }
  this.room = value.roomId; this.snapshot = value; this.acceptedReadAt = readAt; this.connected = true;this.syncDiagnosticScope(value);
  if(normalHA||value.controllerContinuity?.enabled!==true||value.controllerContinuity.available===false||this.controllerRenewed===true||this.cookieReadAuthority){clearTimeout(this.recoveryTimer);this.recoveryTimer=null;this.recoveryAttempt=0;}
  if(!normalHA&&value.controllerContinuity?.enabled===true&&value.controllerContinuity.available===true&&!this.controllerRenewed&&!this.cookieReadAuthority)this.scheduleRecovery();
  clearTimeout(this.freshnessTimer);this.freshnessTimer=setTimeout(()=>{if(!this.closed){this.recordDiagnostic('freshness',{code:'expiry'});this.disconnected();}},Math.min(6000,Math.max(0,6000-(Date.now()-readAt))));
  const generation=this.generation;this.notify('onConnection','connected');if(!this.closed&&generation===this.generation&&this.snapshot===value)this.notify('onSnapshot',value);return true;
 }
 // Presentation observers may report their own error; they cannot turn a valid
 // server read into a transport failure or prevent the next heartbeat.
 notify(name,...args){try{this[name](...args);}catch(error){this.recordDiagnostic('observer',{code:'error'});try{if(typeof globalThis.reportError==='function')globalThis.reportError(error);else console.error('PodView presentation observer:',error);}catch{/* Reporting must not revoke the accepted read. */}}}
 async start() {this.controllerRenewalDenied=false;if(this.screenEnrollment)this.namedRenewalDenied=false;return this.restart(false,true,!this.requireLocalRenewal);}
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
  this.notify('onConnection','connecting');
  try {
   let response = await this.request(this.endpoint('snapshot'), {credentials:'same-origin', cache:'no-store', signal:this.controller.signal});
   let value = await response.json(),readAt=Date.now();
   if (generation !== this.generation) return;
   if([401,403].includes(response.status)){this.recoveryBlocked=true;throw Error('transport_access_denied');}
   if((value?.admission!==undefined||this.normalHAMode)&&!haIngress(value))throw Error('invalid_admission');
   const normalHA=haIngress(value);
   const boot=value.bootId,room=value.roomId;
   const named=normalHA&&!this.namedRenewalDenied&&(this.screenEnrollment||this.namedIntent(room));
   this.namedLaneWanted=named;
   if(!normalHA||named){await this.coordinate();if(generation!==this.generation||this.closed)return;}
   let renewed=false;
   if((!normalHA||named)&&renew&&response.ok&&value?.controllerContinuity?.enabled===true&&value.controllerContinuity.available===true){
    try{
     const renewal=await this.renewController(value.roomId,generation,coalesce,peerRevision);if(!renewal)return;
     if(renewal.coalesced){renew=false;this.recoveryReadOnly=true;this.controllerRenewAt=renewAt;this.controllerRenewRetryAt=Date.now()+30000;this.peerReadPending=false;}
     else{const result=await renewal.json();if(generation!==this.generation||this.closed)return;if([401,403].includes(renewal.status)&&named){this.namedRenewalDenied=true;this.forgetNamedIntent();throw Error('named_controller_renewal_denied');}if([401,403].includes(renewal.status)){this.controllerRenewalDenied=true;this.recoveryReadOnly=true;this.controllerRenewAt=null;this.controllerRenewRetryAt=null;throw Error('controller_renewal_denied');}renewed=renewal.ok&&result.ok===true&&result.expiresIn===300;
      if(named){const keys=Object.keys(result).sort().join(',');renewed=renewed&&keys==='controllerExpiresAt,expiresIn,ok'&&(result.controllerExpiresAt===null||typeof result.controllerExpiresAt==='number'&&Number.isFinite(result.controllerExpiresAt)&&result.controllerExpiresAt>Date.now()/1000);}
     }
     if(renewed||renewal.coalesced){
      // A renewal receipt is not the mandatory post-renew read. Keep the
      // independently verified first projection if that read fails transiently,
      // but do not publish named proof or its light authority from it.
      const confirmed=renewed;renewed=false;
      const freshResponse=await this.request(this.endpoint('snapshot'),{credentials:'same-origin',cache:'no-store'}),freshValue=await freshResponse.json();if(generation!==this.generation)return;
      if([401,403].includes(freshResponse.status)){if(named){this.namedRenewalDenied=true;this.forgetNamedIntent();}this.recoveryBlocked=true;throw Error('transport_access_denied');}
      if(!freshResponse.ok)throw Error('post_renew_read_unavailable');
      response=freshResponse;value=freshValue;readAt=Date.now();
      if(named&&(value.bootId!==boot||value.roomId!==room||!haIngress(value))){this.namedRenewalDenied=true;this.forgetNamedIntent();throw Error('named_controller_owner_changed');}
      renewed=confirmed;
     }
    }catch{if(generation!==this.generation)return;}

   }
   if(generation!==this.generation)return;
   if(this.recoveryBlocked)throw Error('transport_access_denied');
   if(normalHA&&!haIngress(value))throw Error('invalid_admission');
   if(Date.now()-readAt>=6000)throw Error('snapshot_expired');
   this.namedRenewalUnconfirmed=named&&renew&&!renewed;
   this.controllerRenewed=!normalHA&&renewed;this.namedControllerRenewed=named&&renewed;this.cookieReadAuthority=!normalHA&&!this.controllerRenewalDenied&&!renew&&response.ok;
   if(!haIngress(value)&&(this.controllerRenewalDenied||value?.controllerContinuity?.enabled===true&&!renewed&&!this.cookieReadAuthority))value={...value,capabilities:{...value.capabilities,timerActions:[],musicActions:[],musicSelection:false,queueSelection:false,controlSetup:[]}};
   if (!response.ok || !this.accept(value,readAt)){if(named){this.namedRenewalDenied=true;this.forgetNamedIntent();}throw new Error(value.error || 'invalid_snapshot');}
   if(generation!==this.generation||this.closed)return;
   if(this.namedControllerRenewed===true)this.rememberNamedIntent(room);
   if(this.controllerRenewed===true||this.namedControllerRenewed===true)this.notify('onControllerRenewed',{owner:this.controllerRenewalOwner,generation});
   if(generation!==this.generation||this.closed)return;
   if(this.controllerRenewed===true){this.controllerRenewAt=Date.now()+240000;this.controllerRenewRetryAt=null;}
   if(!normalHA&&(this.controllerRenewAt||this.controllerRenewRetryAt)&&value.controllerContinuity?.available!==false)this.controllerRenewTimer=setTimeout(()=>{if(!this.closed&&generation===this.generation)this.restart(false,true,true).catch(()=>{});},Math.max(0,Math.max(this.controllerRenewAt||0,this.controllerRenewRetryAt||0)-Date.now()));
   if(named&&!this.namedRenewalDenied){
    const at=Date.now()+(renewed?240000:30000);
    this.namedRenewAt=at;
    if(renewed||!this.screenEnrollment&&this.namedIntent(room))this.namedRenewTimer=setTimeout(()=>{if(!this.closed&&generation===this.generation)this.restart(false,true,true).catch(()=>{});},Math.max(0,at-Date.now()));
   }
   this.stream = new this.EventSource(this.endpoint('events'), {withCredentials:false});
   this.stream.addEventListener('snapshot', event => {
    if (generation !== this.generation) return;
    try { if (!this.accept(JSON.parse(event.data))){this.recordDiagnostic('sse',{code:'invalid_dto'});this.disconnected();} } catch { this.recordDiagnostic('sse',{code:'invalid_json'});this.disconnected(); }
   });
   this.stream.onerror = () => { if (generation === this.generation){this.recordDiagnostic('sse',{code:'error'});this.disconnected();} };
   if(!normalHA&&value.controllerContinuity?.enabled===true&&value.controllerContinuity.available===true&&!renewed&&!this.cookieReadAuthority)this.scheduleRecovery();
  } catch (error) { if (generation === this.generation) { this.disconnected(); throw error; } }
 }
 disconnected() { this.recordDiagnostic('connection',{code:'disconnected'});this.connected = false; this.notify('onConnection','disconnected');this.scheduleRecovery(); }
 async request(url,options,ms,signal=this.controller?.signal,diagnosticRequestId){
  const generation=this.generation,read=!options?.method||options.method==='GET',started=Date.now(),localRequestSeq=++this.diagnosticRequestSequence;let endpoint='other',kind='other',requestId=diagnosticRequestId,httpStatus,code;
  try{const target=new URL(url,this.base),path=target.origin===this.base.origin&&target.pathname.startsWith(this.base.pathname)?target.pathname.slice(this.base.pathname.length):'other';if(diagnosticEndpoints.has(path))endpoint=path;const candidate=target.searchParams.get('kind');if(diagnosticKinds.has(candidate))kind=candidate;
  }catch{/* No URL, arguments or payload is ever included in diagnostics. */}
  this.recordDiagnostic('request',{code:'start',endpoint,kind,localRequestSeq,requestId});
  try{
   const result=await requestWithin(async(target,init)=>{const response=await this.fetch(target,init);httpStatus=response.status;let body;try{body=await response.json();}catch(error){code='invalid_json';if([401,403].includes(response.status))body={error:'transport_access_denied'};else{if(read&&([408,429].includes(response.status)||response.status>=500&&response.status<=599))error.code='read_transient';throw error;}}
    code=[401,403].includes(response.status)?'http_denied':[408,429].includes(response.status)||response.status>=500&&response.status<=599?'http_transient':!response.ok?'http_error':'ok';
    return {ok:response.ok,status:response.status,json:async()=>body};
   },url,options,signal,ms);
   if(read&&(this.closed||generation!==this.generation)){code='superseded';throw new DOMException('Read owner changed','AbortError');}return result;
  }catch(error){if(!code)code=error?.name==='TimeoutError'?'timeout':error?.name==='AbortError'?(signal?.aborted?'cancelled':'timeout'):error instanceof TypeError?'network':'failure';throw error;}
  finally{this.recordDiagnostic('request',{code:code||'failure',endpoint,kind,localRequestSeq,requestId,httpStatus,durationMs:Math.min(120000,Math.max(0,Date.now()-started)),current:generation===this.generation});}
 }

 async home({lightArea}={}){
  if(!this.connected||!this.snapshot.capabilities.homeRead?.length)throw new Error('home_unavailable');
  if(lightArea!==undefined&&(!this.snapshot.capabilities.homeRead.includes('light')||typeof lightArea!=='string'||!lightArea||lightArea.length>128||/[\u0000-\u001f\u007f]/u.test(lightArea)))throw new Error('light_area_unavailable');
  const response=await this.request(this.endpoint('home',lightArea===undefined?{}:{lightArea}),{credentials:'same-origin',cache:'no-store'});if(!response.ok){const error=new Error('home_unavailable');if([401,403].includes(response.status))error.code='read_access_denied';else if([408,429].includes(response.status)||response.status>=500&&response.status<=599)error.code='read_transient';throw error;}return response.json();
 }
 async weatherAdvice(binding,{signal}={}){
  const snapshot=this.snapshot,generation=this.generation;
  if(!this.connected||!snapshot?.capabilities.homeRead?.includes('weather')||binding?.availability!=='available'||binding.bootId!==snapshot.bootId||binding.roomId!==snapshot.roomId||!/^[a-f0-9]{64}$/.test(binding.weatherKey||''))throw Error('weather_advice_unavailable');
  const url=new URL('weather-advice',this.base);url.searchParams.set('room',snapshot.roomId);
  const response=await this.request(url,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({bootId:snapshot.bootId,roomId:snapshot.roomId,weatherKey:binding.weatherKey})},6000,signal||this.controller?.signal);
  if(this.closed||!this.connected||generation!==this.generation||this.snapshot?.bootId!==snapshot.bootId||this.snapshot?.roomId!==snapshot.roomId||!this.snapshot.capabilities.homeRead?.includes('weather'))throw new DOMException('Weather owner changed','AbortError');
  if(!response.ok){const error=Error('weather_advice_unavailable');if(response.status===409)error.code='stale_weather_binding';else if([401,403].includes(response.status))error.code='read_access_denied';throw error;}
  return response.json();
 }
 async controlSetup(domain,target,recipeId,setupOptions={}){if(!setupOptions||typeof setupOptions!=='object'||Array.isArray(setupOptions)||Object.keys(setupOptions).some(key=>key!=='requestedAction')||Object.hasOwn(setupOptions,'requestedAction')&&(setupOptions.requestedAction!=='volume'||domain!=='music'||recipeId!==undefined||target?.speakerId!==undefined))throw Error('invalid_setup_request');if(domain==='music'&&(!target||typeof target!=='object'||Array.isArray(target)||!['accountId,expectedBindingId,kind,targetId','accountId,expectedBindingId,kind,speakerId,targetId'].includes(Object.keys(target).sort().join(','))||target.kind!=='spotify_device'||typeof target.accountId!=='string'||!target.accountId||target.accountId.length>128||typeof target.targetId!=='string'||!target.targetId||target.targetId.length>1024||typeof target.expectedBindingId!=='string'||!/^[a-f0-9]{64}$/.test(target.expectedBindingId)||target.speakerId!==undefined&&(typeof target.speakerId!=='string'||!/^[a-f0-9]{64}$/.test(target.speakerId))))throw Error('invalid_music_target');if(!this.connected||!this.snapshot.capabilities.controlSetup?.includes(domain))throw Error('control_not_paired');const s=this.snapshot,url=new URL('control/setup',this.base);const response=await this.request(url,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({bootId:s.bootId,roomId:s.roomId,domain,target,...(recipeId?{recipeId}:{}),...(setupOptions.requestedAction?{requestedAction:setupOptions.requestedAction}:{})})});if(!response.ok)throw Error('control_setup_denied');const body=await response.json();if(domain==='music'){if(body?.ok===false){const valid=Object.keys(body).sort().join(',')==='error,ok,retryAllowed'&&body.retryAllowed===false&&controlSetupFailureCodes.has(body.error);throw Object.assign(Error(valid?'control_setup_rejected':'invalid_control_setup'),{diagnosticCode:valid?body.error:'invalid_dto'});}if(body?.expectedBindingId!==target.expectedBindingId)throw Object.assign(Error('music_binding_changed'),{diagnosticCode:'stale_binding'});}return body;}
 async controlAction(task,optionId,args){
  const unknown=requestId=>({ok:false,requestId,outcome:'unknown',retryAllowed:false,physicalResultVerified:false});
  if(!this.connected||this.snapshot.bootId!==task.bootId||this.snapshot.roomId!==task.roomId||!this.snapshot.capabilities.controlSetup?.includes(task.domain))return {ok:false,outcome:'rejected',retryAllowed:false,physicalResultVerified:false};
  const requestId=crypto.randomUUID(),url=new URL('control/actions',this.base);
  try{const response=await this.request(url,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({bootId:task.bootId,roomId:task.roomId,taskId:task.taskId,revision:task.revision,requestId,optionId,args})},undefined,undefined,requestId);const body=await response.json();
   if(!response.ok||!body||body.requestId!==requestId||!['accepted','unknown','rejected'].includes(body.outcome)||typeof body.ok!=='boolean'||body.ok!==(body.outcome==='accepted')||body.retryAllowed!==false||body.physicalResultVerified!==false)return unknown(requestId);
   const detail=task.domain==='vacuum'&&typeof body.partial==='boolean'&&Number.isInteger(body.completedSteps)&&body.completedSteps>=0&&body.completedSteps<=64?{partial:body.partial,completedSteps:body.completedSteps}:{};
   return {ok:body.ok,requestId,outcome:body.outcome,retryAllowed:false,physicalResultVerified:false,...detail};
  }catch{return unknown(requestId);}
 }
 async answers(history=false){if(history!==false&&history!==true&&history!=='segments')throw Error('invalid_answers_mode');if(!this.connected||this.snapshot.capabilities.answerRead!==true)throw Error('answers_unavailable');const response=await this.request(this.endpoint('answers',history===true?{history:'1'}:history==='segments'?{history:'segments'}:{}),{credentials:'same-origin',cache:'no-store'});if(!response.ok){const error=Error('answers_unavailable');if([401,403].includes(response.status))error.code='read_access_denied';throw error;}return response.json();}
 async source(id){if(!this.connected||this.snapshot.capabilities.answerRead!==true||!/^[a-f0-9]{32}$/.test(id))throw Error('source_unavailable');const url=new URL('sources/'+id,this.base);url.searchParams.set('room',this.room);const response=await this.request(url,{credentials:'same-origin',cache:'no-store'});if(!response.ok){const error=Error('source_unavailable');if([401,403].includes(response.status))error.code='read_access_denied';throw error;}return response.json();}
 async music(kind, account, query, {includeControls=false,receiptRequestId=null}={}) {
  if(typeof includeControls!=='boolean'||includeControls&&(kind!=='playback'||query!==undefined||typeof account!=='string'||!account||account.length>1024))throw new Error('invalid_music_controls_read');
  if(receiptRequestId!==null&&(!includeControls||typeof receiptRequestId!=='string'||Array.from(receiptRequestId).length<1||Array.from(receiptRequestId).length>120))throw new Error('invalid_music_receipt_selector');
  if (!this.connected || !this.snapshot.capabilities.musicRead?.includes(kind==='speakers'?'targets':kind)) throw new Error('music_unavailable');
  if(kind==='search'&&(typeof query!=='string'||query.trim()!==query||query.length<1||query.length>160))throw new Error('invalid_query');
  const response = await this.request(this.endpoint('music', {kind,account,...(includeControls?{include_controls:'1'}:{}),...(receiptRequestId===null?{}:{receipt_request_id:receiptRequestId}),...(kind==='search'?{query}:['mood','feeling'].includes(kind)&&query==='refresh'?{refresh:'1'}:['mood','feeling'].includes(kind)&&query==='renew'?{renew:'1'}:{})}), {credentials:'same-origin',cache:'no-store',signal:this.controller.signal});
  const body = await response.json(); if (!response.ok || !body.ok){const error=new Error(body.error || 'music_unavailable');if([401,403].includes(response.status))error.code='read_access_denied';else if([408,429].includes(response.status)||response.status>=500&&response.status<=599)error.code='read_transient';throw error;}
  return body;
 }
 async queueOffer(accountId,targetId,expectedBindingId){const s=this.snapshot;if(!this.connected||s?.capabilities.queueSelection!==true||typeof accountId!=='string'||!accountId||accountId.length>128||typeof targetId!=='string'||!targetId||targetId.length>1024||typeof expectedBindingId!=='string'||!/^[a-f0-9]{64}$/.test(expectedBindingId))throw Error('queue_not_paired');const response=await this.request(new URL('music/queue/offer',this.base),{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({bootId:s.bootId,roomId:s.roomId,accountId,targetId,expectedBindingId})},16000);const body=await response.json();if(!response.ok||body.ok!==true||body.expectedBindingId!==expectedBindingId)throw Error('queue_offer_unavailable');return body;}
 async queueAction(task,optionId){const rejected={ok:false,outcome:'rejected',retryAllowed:false,physicalResultVerified:false},s=this.snapshot;if(!this.connected||s?.capabilities.queueSelection!==true||s.bootId!==task.bootId||s.roomId!==task.roomId||!task.items?.some(row=>row.id===optionId))return rejected;const requestId=crypto.randomUUID(),unknown={...rejected,requestId,outcome:'unknown'};try{const response=await this.request(new URL('music/queue/actions',this.base),{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({bootId:task.bootId,roomId:task.roomId,taskId:task.taskId,revision:task.revision,requestId,optionId})},undefined,undefined,requestId);const body=await response.json();if(!response.ok||body.requestId!==requestId||!['accepted','unknown','rejected'].includes(body.outcome)||typeof body.ok!=='boolean'||body.ok!==(body.outcome==='accepted')||body.retryAllowed!==false||body.physicalResultVerified!==false)return unknown;return body;}catch{return unknown;}}
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
  try{const response=await this.request(url,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({bootId:offer.bootId,roomId:offer.roomId,taskId:offer.taskId,revision:offer.revision,requestId,optionId,confirmedVolumePercent:offer.startVolumePercent})},undefined,undefined,requestId);const body=await response.json();
   if(!response.ok||body?.requestId!==requestId||!['accepted','rejected','unknown'].includes(body.outcome)||body.retryAllowed!==false||body.physicalResultVerified!==false||body.ok!==(body.outcome==='accepted'))return {ok:false,requestId,outcome:'unknown',retryAllowed:false,physicalResultVerified:false};
   return body;
  }catch{return {ok:false,requestId,outcome:'unknown',retryAllowed:false,physicalResultVerified:false};}
 }
 async accessRequest(name) {
  if(haIngress(this.snapshot)&&!this.screenEnrollment||!this.connected||this.snapshot?.controllerContinuity?.available!==true||typeof name!=='string'||name!==name.trim()||!name||name.length>48||/[\u0000-\u001f\u007f]/u.test(name))throw Error('access_unavailable');
  return this.accessExchange('controller/request',{name});
 }
 async accessClaim(requestId) {
  if(haIngress(this.snapshot)&&!this.screenEnrollment||!this.connected||this.snapshot?.controllerContinuity?.available!==true||typeof requestId!=='string'||!/^[a-f0-9]{32}$/.test(requestId))throw Error('access_unavailable');
  return this.accessExchange('controller/claim',{requestId});
 }
 async accessExchange(path,args) {
  if(haIngress(this.snapshot)&&!this.screenEnrollment||!['controller/request','controller/claim'].includes(path))throw Error('access_unavailable');
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
   const response = await this.request(this.endpoint('actions'), {method:'POST',credentials:'same-origin',cache:'no-store',signal:this.controller.signal,headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify(body)},undefined,undefined,requestId);
   const result=await response.json();
   if(response.status===409&&result?.ok===false&&result.retryAllowed===false&&Object.keys(result).every(key=>['ok','error','retryAllowed'].includes(key))&&['invalid_action','control_not_paired','invalid_request','timer_unavailable','stale_action','unsupported_action','request_capacity'].includes(result.error))return {...result,requestId,outcome:'rejected'};
   if((!response.ok&&response.status!==409)||(response.status===409&&result?.ok!==false)||result?.requestId!==requestId||typeof result.ok!=='boolean'||!['accepted','unknown','rejected'].includes(result.outcome)||result.ok!==(result.outcome==='accepted')||result.retryAllowed!==false||action==='timer.start'&&result.ok&&(typeof result.timerId!=='string'||result.timerId.length<1||result.timerId.length>200))return {ok:false,requestId,outcome:'unknown',retryAllowed:false};
   return result;
  } catch { return {ok:false,requestId,outcome:'unknown',retryAllowed:false}; }
 }
 close(disposeCoordinator=true) {
  this.stopDiagnosticUpload();this.recordDiagnostic('lifecycle',{code:'cleanup'});clearTimeout(this.diagnosticUploadTimer);this.diagnosticUploadTimer=null;if(disposeCoordinator)this.flushDiagnostics();
  if(disposeCoordinator){this.coordinatorEpoch=(this.coordinatorEpoch||0)+1;this.coordinatorPromise=null;const channel=this.peerChannel;this.peerChannel=null;if(channel){channel.onmessage=null;if(!this.renewHttpPending)channel.close();}this.peerSeen.clear();this.peerReadPending=false;clearTimeout(this.peerReadTimer);this.peerReadTimer=null;this.controllerRenewAt=null;this.controllerRenewRetryAt=null;}
  clearTimeout(this.recoveryTimer);this.recoveryTimer=null;this.recoveryAttempt=0;this.recoveryBlocked=false;
  clearTimeout(this.namedRenewTimer);this.namedRenewTimer=null;this.namedControllerRenewed=false;
  clearTimeout(this.controllerRenewTimer);this.controllerRenewTimer=null;this.controllerRenewed=false;this.cookieReadAuthority=false;
  this.generation++; this.closed = true; this.connected = false; this.acceptedReadAt = null;
  clearTimeout(this.freshnessTimer);this.controller?.abort(); this.stream?.close(); this.stream = null;
 }
}
