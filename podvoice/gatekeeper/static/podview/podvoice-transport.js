import {requestWithin} from './request-deadline.js';
// Same-origin HA-ingress transport. Import only in live /view/ mode.
// No provider credentials, cross-origin bridge, background retries or offline actions.
export class PodVoiceTransport {
 constructor({url = globalThis.location?.href, room, fetch = globalThis.fetch?.bind(globalThis), EventSource = globalThis.EventSource, onSnapshot = () => {}, onConnection = () => {}} = {}) {
  const page = new URL(url);
  if (!['https:', 'http:'].includes(page.protocol) || !/\/view\//.test(page.pathname)) throw new Error('PodVoice ingress /view/ is required');
  const prefix = page.pathname.slice(0, page.pathname.lastIndexOf('/view/') + 6);
  this.base = new URL(`${prefix}api/`, page.origin);
  this.room = room; this.fetch = fetch; this.EventSource = EventSource;
  this.onSnapshot = onSnapshot; this.onConnection = onConnection;
  this.snapshot = null; this.connected = false; this.closed = true; this.generation = 0;
 }
 endpoint(path, params = {}) {
  if (!['snapshot','events','music','actions','pair','home','answers'].includes(path)) throw new Error('unsupported_endpoint');
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
  if(value.capabilities.answerRead!==undefined&&typeof value.capabilities.answerRead!=='boolean')return false;
  if(value.capabilities.musicSelection!==undefined&&typeof value.capabilities.musicSelection!=='boolean')return false;
  if(value.capabilities.answerRead===true){const a=value.answers;if(!a||!Number.isInteger(a.revision)||a.revision<0||['sessionId','turnId','taskId'].some(k=>a[k]!==null&&(typeof a[k]!=='string'||!a[k]||a[k].length>160))||(a.inputRevision!==null&&(!Number.isInteger(a.inputRevision)||a.inputRevision<0)))return false;const empty=a.sessionId===null;if(empty?(a.turnId!==null||a.taskId!==null||a.inputRevision!==null):(a.turnId===null||a.taskId===null||a.inputRevision===null))return false;}
  if (this.room && value.roomId !== this.room) return false;
  if (this.snapshot?.bootId === value.bootId && this.snapshot.revision > value.revision) return false;
  this.room = value.roomId; this.snapshot = value; this.connected = true;
  this.onConnection('connected'); this.onSnapshot(value);clearTimeout(this.freshnessTimer);this.freshnessTimer=setTimeout(()=>{if(!this.closed)this.disconnected();},6000);return true;
 }
 async start() {
  this.close(); this.closed = false;
  const generation = this.generation;
  this.controller = new AbortController();
  this.onConnection('connecting');
  try {
   const response = await this.request(this.endpoint('snapshot'), {credentials:'same-origin', cache:'no-store', signal:this.controller.signal});
   const value = await response.json();
   if (generation !== this.generation) return;
   if (!response.ok || !this.accept(value)) throw new Error(value.error || 'invalid_snapshot');
   this.stream = new this.EventSource(this.endpoint('events'), {withCredentials:false});
   this.stream.addEventListener('snapshot', event => {
    if (generation !== this.generation) return;
    try { if (!this.accept(JSON.parse(event.data))) this.disconnected(); } catch { this.disconnected(); }
   });
   this.stream.onerror = () => { if (generation === this.generation) this.disconnected(); };
  } catch (error) { if (generation === this.generation) { this.disconnected(); throw error; } }
 }
 disconnected() { this.connected = false; this.onConnection('disconnected'); }
 async request(url,options){return requestWithin(async(target,init)=>{const response=await this.fetch(target,init);const body=await response.json();return {ok:response.ok,json:async()=>body};},url,options,this.controller?.signal);}
 async home(){
  if(!this.connected||!this.snapshot.capabilities.homeRead?.length)throw new Error('home_unavailable');
  const response=await this.request(this.endpoint('home'),{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('home_unavailable');return response.json();
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
 async answers(){if(!this.connected||this.snapshot.capabilities.answerRead!==true)throw Error('answers_unavailable');const response=await this.request(this.endpoint('answers'),{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('answers_unavailable');return response.json();}
 async source(id){if(!this.connected||this.snapshot.capabilities.answerRead!==true||!/^[a-f0-9]{32}$/.test(id))throw Error('source_unavailable');const url=new URL('sources/'+id,this.base);url.searchParams.set('room',this.room);const response=await this.request(url,{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('source_unavailable');return response.json();}
 async music(kind, account, query) {
  if (!this.connected || !this.snapshot.capabilities.musicRead?.includes(kind)) throw new Error('music_unavailable');
  if(kind==='search'&&(typeof query!=='string'||query.trim()!==query||query.length<1||query.length>160))throw new Error('invalid_query');
  const response = await this.request(this.endpoint('music', {kind,account,...(kind==='search'?{query}:{})}), {credentials:'same-origin',cache:'no-store',signal:this.controller.signal});
  const body = await response.json(); if (!response.ok || !body.ok) throw new Error(body.error || 'music_unavailable');
  return body;
 }
 async musicSelectionSetup(candidateSetId,target){
  const s=this.snapshot;
  if(!this.connected||s?.capabilities.musicSelection!==true||!/^[a-f0-9]{64}$/.test(candidateSetId)||target?.kind!=='spotify_device'||typeof target.accountId!=='string'||!target.accountId||typeof target.targetId!=='string'||!target.targetId)throw new Error('selection_unavailable');
  const url=new URL('music/selection/setup',this.base);
  const response=await this.request(url,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({bootId:s.bootId,roomId:s.roomId,candidateSetId,target:{accountId:target.accountId,kind:'spotify_device',targetId:target.targetId}})});
  const body=await response.json();if(!response.ok||body?.ok!==true)throw new Error(body?.error||'selection_unavailable');return body;
 }
 async musicSelectionAction(offer,optionId){
  const rejected={ok:false,outcome:'rejected',retryAllowed:false,physicalResultVerified:false};
  if(!this.connected||this.snapshot?.capabilities.musicSelection!==true||this.snapshot.bootId!==offer?.bootId||this.snapshot.roomId!==offer?.roomId||Date.now()>=offer?.expiresAt||!offer.options?.some(option=>option.id===optionId))return rejected;
  const requestId=crypto.randomUUID(),url=new URL('music/selection/actions',this.base);
  try{const response=await this.request(url,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-PodView-Request':'1'},body:JSON.stringify({bootId:offer.bootId,roomId:offer.roomId,taskId:offer.taskId,revision:offer.revision,requestId,optionId,confirmedVolumePercent:offer.observedVolumePercent})});const body=await response.json();
   if(!response.ok||body?.requestId!==requestId||!['accepted','rejected','unknown'].includes(body.outcome)||body.retryAllowed!==false||body.physicalResultVerified!==false||body.ok!==(body.outcome==='accepted'))return {ok:false,requestId,outcome:'unknown',retryAllowed:false,physicalResultVerified:false};
   return body;
  }catch{return {ok:false,requestId,outcome:'unknown',retryAllowed:false,physicalResultVerified:false};}
 }
 async pair(code) {
  if (!this.connected || !this.room) throw new Error('disconnected');
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
 close() {
  this.generation++; this.closed = true; this.connected = false;
  clearTimeout(this.freshnessTimer);this.controller?.abort(); this.stream?.close(); this.stream = null;
 }
}
