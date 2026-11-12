import {radioStation,stations,pendingRadioPlayerModel} from './radio-model.js';
// The native owner reports playing when audio flows; read it again soon after an accepted receipt.
const RADIO_CONFIRM_READ_MS=200;
// Radio has its own source catalogue. No Spotify account, device or DTO is admitted.
const configurationReason=value=>{
 const reasons=value?.blockedReasons;
 if(!Array.isArray(reasons)||reasons.length!==1)return null;
 const [reason]=reasons;
 return ['radio_native_not_configured','radio_native_auth_rejected'].includes(reason)?reason:null;
};
const id=value=>typeof value==='string'&&value.length>0&&value.length<=128;
export function radioObservation(value,snapshot,previous=null,now=Date.now()){
 if(value?.schema!=='podview.radio.v1'||value.ok!==true||value.bootId!==snapshot?.bootId||value.roomId!==snapshot?.roomId||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.enabled!=='boolean'||value.physicalResultVerified!==false||!Array.isArray(value.actions)||value.actions.some(a=>!['start','stop','move','volume'].includes(a))||!Array.isArray(value.stations)||value.stations.length!==5||!stations.every((s,i)=>value.stations[i]?.id===s.id)||!Array.isArray(value.targets)||value.targets.length>64)return null;
 if(value.ownerProcessId!==undefined&&value.ownerProcessId!==null&&!id(value.ownerProcessId))return null;
 const seen=new Set();for(const t of value.targets){if(!id(t.id)||seen.has(t.id)||!id(t.name)||!['available','unavailable'].includes(t.availability)||typeof t.selectable!=='boolean'||typeof t.default!=='boolean')return null;seen.add(t.id);}
 const s=value.state;if(!s||!['idle','preparing','playing','stopped','error','unknown'].includes(s.status)||s.stationId!==null&&!radioStation(s.stationId)||s.targetId!==null&&!seen.has(s.targetId)||!Number.isSafeInteger(s.generation)||s.generation<0)return null;
 if(value.enabled&&(!['radio','spotify','none','unknown'].includes(s.sourceKind)||!Number.isSafeInteger(s.ownerGeneration)||s.ownerGeneration<0))return null;
 if(value.enabled&&(s.volumePercent!==null&&(!Number.isInteger(s.volumePercent)||s.volumePercent<0||s.volumePercent>100)))return null;
 if(value.enabled&&['playing','stopped','preparing'].includes(s.status)&&(!Number.isFinite(s.observedAt)||s.observedAt*1000>now+5000||now-s.observedAt*1000>30000))return null;
 if(value.enabled&&(s.status==='playing'&&(s.sourceKind!=='radio'||!s.stationId||!s.targetId)||s.sourceKind==='radio'&&!s.stationId))return null;
 if(value.enabled&&(!Number.isFinite(value.retrievedAt)||!Number.isFinite(value.validUntil)||value.retrievedAt*1000>now+5000||value.validUntil*1000<=now||value.validUntil-value.retrievedAt>60))return null;
 if(previous?.bootId===value.bootId&&previous.roomId===value.roomId&&!(id(previous.ownerProcessId)&&id(value.ownerProcessId)&&previous.ownerProcessId!==value.ownerProcessId)&&(value.revision<previous.revision||s.generation<previous.state.generation||Number.isSafeInteger(s.ownerGeneration)&&Number.isSafeInteger(previous.state.ownerGeneration)&&s.ownerGeneration<previous.state.ownerGeneration))return null;
 return value;
}
export class LiveRadioView{
 constructor(host){this.host=host;this.epoch=0;this.lastRead=0;this.pending=false;this.unknown=false;this.stationChoices=[];}
 scope(){const h=this.host,s=h.liveSnapshot;return JSON.stringify([s?.bootId,s?.roomId,s?.sessionId,s?.taskId,s?.inputRevision,s?.providerGeneration]);}
 setupIssue(){
  const v=this.value,s=this.host.liveSnapshot;
  return v&&s&&v.bootId===s.bootId&&v.roomId===s.roomId?configurationReason(v):null;
 }
 current(){const v=this.value,h=this.host;return !!(v?.enabled&&h.liveTransport?.connected&&!h.liveTransport.recoveryBlocked&&!h.browserOffline&&v.bootId===h.liveSnapshot?.bootId&&v.roomId===h.liveSnapshot?.roomId&&v.validUntil*1000>Date.now());}
 presentsPlayer(){return this.host.playerView?.sourceFocused?.('radio')!==false&&!(this.knownStopped()&&!this.pendingStart()&&this.host.playerView?.radioHistorySuperseded?.(this.stoppedHistory)===true);}
 hasSource(){const s=this.value?.state;return !!(this.value?.enabled&&this.value.bootId===this.host.liveSnapshot?.bootId&&this.value.roomId===this.host.liveSnapshot?.roomId&&s?.sourceKind==='radio'&&Number.isSafeInteger(s.ownerGeneration)&&radioStation(s.stationId));}
 knownStopped(){const v=this.value,s=v?.state,last=this.lastConfirmed,valid=!!(v?.enabled&&v.bootId===this.host.liveSnapshot?.bootId&&v.roomId===this.host.liveSnapshot?.roomId&&s?.sourceKind==='none'&&s.status==='stopped'&&last?.sourceKind==='radio'&&radioStation(last.stationId)&&typeof last.targetId==='string'&&!!last.targetId&&Number.isSafeInteger(last.generation)&&last.generation<=s.generation);if(!valid){this.stoppedHistory=null;return false;}const scope=JSON.stringify([v.bootId,v.roomId]),key=JSON.stringify([scope,s.generation,last.stationId,last.targetId]);if(this.stoppedHistory?.key!==key)this.stoppedHistory={key,scope,stationId:last.stationId,targetId:last.targetId,observedAt:s.observedAt,superseded:false};return true;}
 ownsPlayer(){return this.presentsPlayer()&&(this.hasSource()||this.knownStopped());}
 progress(){return this.pending&&this.current()&&this.pendingScope===this.scope()&&this.pendingTransport===this.host.liveTransport?this.pendingControl:null;}
 pendingStart(){const request=this.pendingRequest;return this.progress()&&request?.action==='start'&&radioStation(request.stationId)?request:null;}
 feedback(){const status=this.value?.state.status;return this.unknown||status==='unknown'?{state:'unknown',message:this.message||'Radioændringen er ikke bekræftet. Tjek afspilleren.'}:status==='error'||this.feedbackKind==='error'?{state:'error',message:this.message||'Radio kunne ikke afspilles.'}:null;}
 // An unconfirmed earlier action stays visible as feedback but is never replayed; a new explicit
 // tap is a new action and is allowed (R4).
 can(action){
  return this.current()&&!this.pending&&!['preparing','unknown'].includes(this.value.state.status)
   &&this.value.actions.includes(action);
 }
 stationChoiceScope(targetId=null){
  const transport=this.host.liveTransport;
  const preparing=this.progress()&&this.value.state.status==='preparing';
  const expected=targetId??(preparing?this.pendingRequest?.stationChoiceTarget:null);
  const target=targetId||preparing?this.value.targets.find(row=>row.id===expected
   &&row.selectable&&row.availability==='available'):this.target();
  if(!target)return null;
  return {
   key:JSON.stringify([this.scope(),this.epoch,this.ownerProcessId??this.value.ownerProcessId,
    transport.generation,target.id]),
   transport,targetId:target.id,
  };
 }
 sameStationScope(a,b){return !!(a&&b&&a.key===b.key&&a.transport===b.transport);}
 canChooseStation(){
  if(this.can('start'))return true;
  if(!this.progress()||this.value.state.status==='unknown')return false;
  // Native preparation withholds command offers. Keep collecting scoped input
  // from the already admitted operation; each next dispatch still needs a fresh offer.
  const canStage=this.value.actions.includes('start')
   ||this.value.state.status==='preparing'&&this.pendingRequest?.stationChoiceAllowed;
  return !!(canStage&&this.stationChoiceScope());
 }
 pendingStationChoice(){
  const scope=this.stationChoiceScope();
  const latest=this.stationChoices.findLast(choice=>choice.stationId&&this.sameStationScope(choice.scope,scope));
  return latest?.stationId??this.pendingStart()?.stationId??null;
 }
 observedStationId(){
  const state=this.value?.state;
  if(!state||state.sourceKind==='spotify')return null;
  if(this.knownStopped())return this.displayState().stationId;
  return ['playing','stopped'].includes(state.status)?state.stationId:this.lastConfirmed?.stationId??null;
 }
 async drainStationChoices(){
  while(this.stationChoices.length&&!this.pending){
   const next=this.stationChoices.shift();
   if(!this.sameStationScope(next.scope,this.stationChoiceScope()))continue;
   if(next.action==='stop'){
    const state=this.value.state,started=next.started;
    if(started&&state.sourceKind==='radio'&&state.status==='playing'
     &&state.generation===started.generation&&state.ownerGeneration===started.ownerGeneration
     &&state.stationId===next.afterStart.stationId&&state.targetId===next.afterStart.targetId
     &&this.can('stop'))await this.act('stop',{},next.origin);
   }else if(this.can('start')){
    await this.choose(next.stationId,next.origin);
   }
  }
  this.render();
 }
 scheduleRenewal(value,current){
  const remaining=value.validUntil*1000-Date.now();
  if(remaining<=1000||remaining>5000||!this.current()||this.host.ownerDocument?.visibilityState==='hidden')return;
  this.renewal=setTimeout(()=>{
   this.renewal=null;
   if(current()&&this.value===value&&this.current()&&this.host.ownerDocument?.visibilityState!=='hidden'){
    // Renew by reading the current owner. The prior deadline still applies while this read is pending.
    void this.refresh({immediate:true});
   }
  },remaining-1000);
  this.renewal.unref?.();
 }
 invalidate(revoke=false){this.stationChoices=[];this.closeOutputs();if(this.sentOperation){this.unknown=true;this.unknownGeneration=this.sentOperation.generation;this.unknownRevision=this.value?.revision??0;this.unknownBoot=this.sentOperation.bootId;this.message='Radioændringen er ikke bekræftet. Tjek afspilleren.';this.sentOperation=null;}if(this.value)this.value={...this.value,validUntil:0};this.epoch++;this.read=null;this.pending=false;this.pendingControl=null;this.pendingRequest=null;this.lastRead=0;clearTimeout(this.timer);this.settleResolve?.();this.settleResolve=null;clearTimeout(this.expiry);clearTimeout(this.renewal);if(revoke){this.feedbackKind=null;if(!this.unknown)this.message='';this.ownerProcessId=null;this.retiredOwners=null;this.value=null;this.lastConfirmed=null;this.stoppedHistory=null;this.nextTarget=null;}this.render();}
 async refresh({immediate=false}={}){const h=this.host,t=h.liveTransport;if(!h.isConnected||!t?.connected)return;const binding=JSON.stringify([h.liveSnapshot?.bootId,h.liveSnapshot?.roomId]);if(this.binding!==undefined&&this.binding!==binding)this.invalidate(true);this.binding=binding;if(this.read&&this.readScope!==this.scope()){this.epoch++;this.read=null;this.stationChoices=[];this.pending=false;this.pendingControl=null;this.pendingRequest=null;}if(this.read)return this.read;if(!immediate&&Date.now()-this.lastRead<5000)return;clearTimeout(this.renewal);let epoch=this.epoch;const key=this.scope(),diagnostic=this.sentOperation?.diagnostic||{},trace=(code,fields={})=>{try{t.recordDiagnostic?.('request',{domain:'radio',endpoint:'radio',...diagnostic,code,...fields});}catch{}};trace('start');this.readScope=key;this.lastRead=Date.now();const current=()=>h.isConnected&&h.liveTransport===t&&t.connected&&this.epoch===epoch&&this.scope()===key;this.read=(async()=>{try{const raw=await t.radio();if(!current()){trace('superseded',{current:false});return;}const issue=configurationReason(raw),setup=issue&&radioObservation(raw,h.liveSnapshot);if(setup&&!setup.enabled&&setup.ownerProcessId===null&&setup.validUntil===null&&setup.actions.length===0){
  // A negative configuration reply revokes controls without resetting the observed owner counters.
  this.value=this.value&&this.value.bootId===setup.bootId&&this.value.roomId===setup.roomId
   ?{...this.value,validUntil:0,actions:[],blockedReasons:setup.blockedReasons}:setup;
  this.stationChoices=[];this.closeOutputs();
  trace(issue==='radio_native_auth_rejected'?'http_denied':'capability_missing',{current:true});this.render();return;
 }const previous=this.value&&id(this.ownerProcessId)?{...this.value,ownerProcessId:this.ownerProcessId}:this.value,next=radioObservation(raw,h.liveSnapshot,previous);if(!next||id(next.ownerProcessId)&&this.retiredOwners?.has(next.ownerProcessId))throw Error('invalid_radio');const changed=id(this.ownerProcessId)&&id(next.ownerProcessId)&&this.ownerProcessId!==next.ownerProcessId;if(changed){this.feedbackKind=null;if(!this.unknown)this.message='';this.retiredOwners??=new Set();this.retiredOwners.add(this.ownerProcessId);if(this.retiredOwners.size>8)this.retiredOwners.delete(this.retiredOwners.values().next().value);this.epoch++;epoch=this.epoch;this.closeOutputs();this.stationChoices=[];this.pending=false;this.pendingControl=null;this.pendingRequest=null;this.sentOperation=null;this.lastConfirmed=null;this.stoppedHistory=null;this.nextTarget=null;clearTimeout(this.timer);this.settleResolve?.();this.settleResolve=null;const player=h.playerView;if(player){player.volumeMuteBinding='';player.volumeRestore=null;player.volumeMuteRequest=null;player.volumeMuteVM=null;if(player.sourceFocus?.kind==='radio')player.sourceFocus=null;}if(this.unknown){this.unknownGeneration=next.state.generation;this.unknownRevision=next.revision;this.unknownBoot=next.bootId;if(next.enabled&&['playing','stopped','idle'].includes(next.state.status)){this.unknown=false;this.message='';}}}if(id(next.ownerProcessId))this.ownerProcessId=next.ownerProcessId;this.value=next;trace(this.diagnosticReadFailed?'recovered':'ok',{current:true,source:'podradio',trust:'state_observation'});this.diagnosticReadFailed=false;if(next.enabled&&next.state.sourceKind==='radio'&&['playing','stopped'].includes(next.state.status))this.lastConfirmed={...next.state,targetName:next.targets.find(t=>t.id===next.state.targetId)?.name||''};if(this.unknown&&next.enabled&&(this.unknownBoot!==undefined&&next.bootId!==this.unknownBoot||next.state.generation>this.unknownGeneration||next.state.generation===this.unknownGeneration&&next.revision>this.unknownRevision)&&['playing','stopped','idle'].includes(next.state.status)){this.unknown=false;this.message='';}if(this.nextTarget&&!next.targets.some(row=>row.id===this.nextTarget&&row.selectable&&row.availability==='available'))this.nextTarget=null;clearTimeout(this.expiry);if(next.enabled)this.expiry=setTimeout(()=>{if(current())this.render();},Math.max(0,next.validUntil*1000-Date.now()));this.scheduleRenewal(next,current);this.render();}catch(error){trace(!current()?'superseded':error?.code==='read_access_denied'?'http_denied':error?.code==='read_transient'?'http_transient':error?.name==='TypeError'?'network':'error',{current:current()});if(current()){this.diagnosticReadFailed=true;if(error?.code==='read_access_denied'){this.invalidate(true);return;}this.value=this.value?{...this.value,validUntil:0,...(configurationReason(this.value)?{blockedReasons:[]}:null)}:null;this.render();}}finally{if(current())this.read=null;}})();return this.read;}
 target(){const v=this.value;if(!this.current())return null;const valid=t=>t&&t.selectable&&t.availability==='available',actual=v.targets.find(t=>v.state.sourceKind==='radio'&&v.state.status==='playing'&&t.id===v.state.targetId&&valid(t)),next=v.targets.find(t=>t.id===this.nextTarget&&valid(t)),display=this.displayState();if(actual||next)return actual||next;if(display.status==='stopped'&&display.targetId)return v.targets.find(t=>t.id===display.targetId&&valid(t))||null;return v.targets.find(t=>t.default&&valid(t))||null;}
 async choose(stationId,origin=null){
  if(!radioStation(stationId)||!this.canChooseStation())return;
  if(this.pending){
   this.stationChoices.push({stationId,origin,scope:this.stationChoiceScope()});
   this.render();
   return;
  }
  if(this.hasSource()&&this.value.state.status==='playing'&&this.value.state.stationId===stationId){
   if(this.host.playerView?.focusSource?.('radio',{targetId:this.value.state.targetId}))this.render();
   return;
  }
  const target=this.target();
  if(!target){
   this.waitingStation=stationId;
   this.openOutputs();
   return;
  }
  const args={stationId,targetId:target.id};
  return origin?this.act('start',args,origin):this.act('start',args);
 }
 async act(action,args={},origin=null){const diagnosticTransport=this.host.liveTransport;let diagnosticRef;try{diagnosticRef=globalThis.crypto?.randomUUID?.();}catch{}const diagnostic={domain:'radio',action,diagnosticRef,resourceId:args.targetId||this.value?.state.targetId,requestedValue:action==='volume'?args.volumePercent:action==='stop'?false:action==='start'||action==='move'?true:undefined},trace=(stage,fields={})=>{try{diagnosticTransport?.recordDiagnostic?.(stage,{...diagnostic,...fields});}catch{}};trace('control_intent',{code:'start'});if(!this.can(action)){trace('control_intent',{code:'capability_missing'});return;}const focusTicket=this.host.playerView?.beginSourceFocus?.('radio',{targetId:args.targetId||this.value?.state.targetId});const h=this.host,t=h.liveTransport,key=this.scope(),epoch=this.epoch,value=this.value,baseline=value.state.generation,measuredVolume=this.current()&&['radio','spotify'].includes(value.state.sourceKind)&&value.state.targetId===args.targetId&&Number.isFinite(value.state.observedAt)&&value.state.observedAt*1000<=Date.now()+5000&&Date.now()-value.state.observedAt*1000<=30000?value.state.volumePercent:null;const stationChoiceTarget=action==='start'?args.targetId:this.target()?.id;this.pending=true;this.pendingControl=Object.freeze(origin||{kind:action==='start'?'station':action==='move'?'output':action==='volume'?'volume':'transport',id:args.stationId||args.targetId||'play-pause'});this.pendingRequest=Object.freeze({action,stationId:args.stationId??null,targetId:args.targetId??null,targetName:value.targets.find(target=>target.id===args.targetId)?.name||'',volumePercent:Number.isInteger(measuredVolume)?measuredVolume:null,stationChoiceTarget,stationChoiceAllowed:value.actions.includes('start')});this.pendingScope=key;this.pendingTransport=t;this.pendingPhase='preparing';this.feedbackKind=null;this.message='';
  this.unknown=false;
  const request=this.pendingRequest;
  let observedStart=null;
  this.render();const current=()=>h.isConnected&&h.liveTransport===t&&t.connected&&key===this.scope()&&epoch===this.epoch;let sent=false,rejected=false,receiptLogged=false,observationLogged=false,loggedGeneration=baseline;let continueStations=false;const observation=(code,state)=>{observationLogged=true;trace('control_observation',{code,source:'podradio',trust:'state_observation',...(this.current()&&state?{observedValue:action==='volume'?state.volumePercent:state.status==='playing'}:{})});};try{trace('control_setup',{code:'start'});const offer=await t.radioOffer({bootId:value.bootId,roomId:value.roomId,revision:value.revision,action,stationId:args.stationId??null,targetId:args.targetId??null,volumePercent:args.volumePercent??null});if(!current()||offer.bootId!==value.bootId||offer.roomId!==value.roomId||!id(offer.taskId)||!id(offer.optionId)||!Number.isFinite(offer.expiresAt)||offer.expiresAt*1000<=Date.now())throw Error('invalid_offer');trace('control_setup',{code:'ok'});this.pendingPhase='sending';this.render();if(!current()||!this.current()){trace('control_setup',{code:'superseded',current:false});return;}sent=true;this.sentOperation={epoch,generation:baseline,bootId:value.bootId,diagnostic};trace('control_action',{code:'start'});const receipt=await t.radioAction(offer);trace('control_action',{code:['accepted','rejected','unknown'].includes(receipt?.status)?receipt.status:'unknown'});receiptLogged=true;if(!current())return;if(receipt.status!=='accepted'){rejected=receipt.status==='rejected';this.unknown=!rejected;throw Error('radio_not_accepted');}const deadline=Date.now()+8000;while(current()&&Date.now()<deadline){await this.refresh({immediate:true});if(!current())return;const s=this.value?.state;const matched=action==='stop'?['stopped','idle'].includes(s?.status):action==='volume'?s?.volumePercent===args.volumePercent:action==='move'?s?.status==='playing'&&s.targetId===args.targetId:s?.status==='playing'&&s.stationId===args.stationId&&s.targetId===args.targetId;if(this.current()&&s.generation>loggedGeneration&&!['error','unknown'].includes(s.status)){loggedGeneration=s.generation;trace('control_observation',{code:'observed',source:'podradio',trust:'state_observation',observedValue:action==='volume'?s.volumePercent:s.status==='playing'});}if(this.current()&&s.generation>baseline&&(matched||['error','unknown'].includes(s.status)||s.sourceKind==='spotify')){if(matched){observationLogged=true;if(action==='start'&&s.sourceKind==='radio')observedStart={generation:s.generation,ownerGeneration:s.ownerGeneration};}else observation(s.status==='unknown'?'unknown':s.status==='error'?'error':'superseded',s);continueStations=matched||s.status==='error';this.unknown=s.status==='unknown';if(this.unknown){this.unknownGeneration=s.generation;this.unknownRevision=this.value.revision;this.unknownBoot=value.bootId;}this.message=s.status==='unknown'?'Radioændringen er ikke bekræftet. Tjek afspilleren.':s.status==='playing'?'':s.status==='stopped'?'':s.status==='error'?'Radio kunne ikke afspilles.':'';return;}await new Promise(resolve=>{this.settleResolve=resolve;this.timer=setTimeout(resolve,RADIO_CONFIRM_READ_MS);});}observation('unconfirmed',this.value?.state);this.unknown=true;this.unknownGeneration=baseline;this.unknownRevision=value.revision;this.unknownBoot=value.bootId;this.message='Radioændringen er ikke bekræftet. Tjek afspilleren.';}catch{if(sent&&!receiptLogged)trace('control_action',{code:'unknown'});if(!sent)trace('control_setup',{code:current()?'rejected':'superseded',current:current()});if(current()){if(sent&&!rejected){this.unknown=true;this.unknownGeneration=baseline;this.unknownRevision=value.revision;this.unknownBoot=value.bootId;}if(!this.unknown){continueStations=true;this.host.playerView?.finishSourceFocus?.(focusTicket,'rejected');}this.feedbackKind=this.unknown?'unknown':'error';
    if (this.unknown) {
     this.message = 'Radioændringen er ikke bekræftet. Tjek afspilleren.';
    } else if (action === 'stop') {
     this.message = sent ? 'Radio kunne ikke stoppes.' : 'Stop blev ikke sendt.';
    } else {
     this.message = 'Radio kunne ikke startes. Prøv igen.';
    }
   }
  }finally{if(sent&&!observationLogged&&!rejected)observation(current()?'unconfirmed':'superseded');if(epoch===this.epoch){this.sentOperation=null;this.pending=false;this.pendingControl=null;this.pendingRequest=null;this.pendingPhase=null;if(!current()&&sent){this.unknown=true;this.unknownGeneration=baseline;this.unknownRevision=value.revision;this.unknownBoot=value.bootId;this.message='Radioændringen er ikke bekræftet. Tjek afspilleren.';}
   this.stationChoices=this.stationChoices.filter(choice=>{
    if(choice.afterStart!==request)return true;
    if(!observedStart)return false;
    choice.started=observedStart;
    return true;
   });
   const spotifyTookOver=value.state.sourceKind!=='spotify'&&this.value?.state.sourceKind==='spotify';
   const drain=current()&&continueStations&&!this.unknown&&!spotifyTookOver&&this.stationChoices.length>0;
   if(!drain)this.stationChoices=[];
   this.render();
   if(drain)await this.drainStationChoices();
  }
 }}

 control(event){if(event.type==='toggle'){
  const origin={kind:'transport',id:event.controlId||'play-pause'};
  // A waiting Stop belongs to this start's confirmed station, never the previous one.
  const start=this.pendingStart();
  if(start){
   if(!this.stationChoices.some(choice=>choice.afterStart===start)){
    this.stationChoices.push({action:'stop',origin,scope:this.stationChoiceScope(start.targetId),afterStart:start});
   }
   this.render();
   return;
  }
  const display=this.displayState();
  if(display.status==='playing')return this.act('stop',{},origin);
  if(display.stationId)return this.choose(display.stationId,origin);
 }if(event.type==='volume')return this.act('volume',{volumePercent:Number(event.value)});}
 displayState(){const s=this.value?.state||{};return this.knownStopped()?{...this.lastConfirmed,status:'stopped',sourceKind:'none',generation:s.generation}:!['playing','stopped'].includes(s.status)&&this.lastConfirmed?this.lastConfirmed:s;}
 renderControls(){const request=this.pendingStart();if(request){
  // The start stays tappable: the toggle queues Stop and shows that wish at once.
  const stopping=this.stationChoices.some(choice=>choice.afterStart===request);
  const pendingLabel=stopping?'Stopper radio…':`Starter ${radioStation(request.stationId).label}…`;
  this.host.playerView.renderControls({sourceKind:'radio',playing:!stopping,loadingControlId:'play-pause',pendingLabel,
   blocked:false,toggle:true,volume:request.volumePercent,canVolume:false});
  return;
 }const s=this.value?.state||{},display=this.displayState(),volume=this.knownStopped()?null:s.volumePercent;this.host.playerView.renderControls({sourceKind:'radio',loadingControlId:this.progress()?.kind==='transport'?this.progress().id:null,playing:display.status==='playing',toggle:this.can(display.status==='playing'?'stop':'start'),blocked:!this.current()||this.pending,volume:Number.isInteger(volume)?volume:null,canVolume:!this.knownStopped()&&this.can('volume')});}
 playerModel(){const request=this.pendingStart();if(request){const station=radioStation(request.stationId);return pendingRadioPlayerModel(station.id,request.volumePercent,request.targetName);}if(!this.hasSource()&&!this.knownStopped())return null;const s=this.value.state,display=this.displayState(),station=radioStation(display.stationId)||radioStation(s.stationId),target=this.value.targets.find(t=>t.id===display.targetId);return {active:true,sourceKind:'radio',playing:display.status==='playing',fresh:this.current()&&!this.knownStopped()&&['playing','stopped'].includes(s.status),title:station.label,artist:'Direkte radio',fixtureArt:`assets/radio-${station.id}.svg`,target:target?.name||display.targetName||'',volume:this.knownStopped()?null:s.volumePercent??null,canOutput:this.current(),canDiscover:true,canSeek:false,controlStatus:'',feedback:this.feedback()};}
 renderPlayer(){if(!this.presentsPlayer())return false;const model=this.playerModel();if(!model)return false;this.host.playerView.renderPlayer(model);this.renderControls();this.host.playerView.renderQueue([],{sourceKind:'radio'});return true;}
 render(){const h=this.host;if(!h.isConnected)return;const feedback=this.value&&h.liveSnapshot&&this.value.bootId===h.liveSnapshot.bootId&&this.value?.roomId===h.liveSnapshot?.roomId&&(this.unknown||this.feedbackKind||this.value.enabled===true&&(this.value.state.sourceKind==='radio'||this.lastConfirmed?.sourceKind==='radio'))?this.feedback():null;h.showFeedback?.(feedback?.message||'',false,{source:'radio'});h.radioSignature=null;h.render?.();if(!this.renderPlayer())h.liveMedia?.render?.();h.playerView?.renderRadioProgress?.(!this.presentsPlayer()||this.pendingStart()?null:this.progress());h.renderOverviewFacts?.();if(this.outputOpen)this.syncOutputs();}
 closeOutputs(){const outputs=this.host.liveOutputs,owned=this.outputOpen||outputs?.radioSheet===true;this.waitingStation=null;this.outputOpen=false;if(!owned)return;for(const button of outputs?.radioRows?.values?.()||[]){button.disabled=true;button.radioSelectable=()=>false;button.radioChoose=()=>{};}outputs?.radioRows?.clear?.();if(outputs?.radioSheet){outputs.radioSheet=false;outputs.rows?.replaceChildren?.();}const dialog=this.host.ownerDocument?.getElementById?.('rooms');if(dialog?.open)dialog.close?.();}
 openOutputs(){this.host.playerView?.focusSource?.('radio',{targetId:this.value?.state.targetId});const h=this.host;h.liveOutputs?.bindRadioClose();const dialog=h.ownerDocument.getElementById('rooms');this.outputOpen=true;if(!dialog.open)dialog.showModal();void this.refresh({immediate:true}).then(()=>{if(this.outputOpen&&dialog.open)this.syncOutputs();});this.syncOutputs();}
 syncOutputs(){const h=this.host,value=this.value,epoch=this.epoch,scope=this.scope();if(!h.liveOutputs||!this.outputOpen||!h.ownerDocument.getElementById('rooms').open)return;h.liveOutputs.renderRadioOutputs({targets:value?.targets||[],actualTargetId:this.ownsPlayer()&&value.state.status==='playing'?value.state.targetId:null,lastTargetId:this.ownsPlayer()&&value.state.status!=='playing'?this.displayState().targetId:null,nextTargetId:this.nextTarget,message:this.unknown?'Radiohandlingen har ukendt udfald.':'Vælg højttaler til radio.',selectable:row=>this.outputOpen&&this.epoch===epoch&&this.value===value&&this.scope()===scope&&this.current()&&!this.pending&&!this.unknown&&row.selectable&&row.availability==='available'&&!(this.ownsPlayer()&&value.state.targetId===row.id&&value.state.status==='playing')&&(this.waitingStation?this.can('start'):this.ownsPlayer()&&value.state.status==='playing'?this.can('move'):this.can('start')),onChoose:row=>{if(!this.outputOpen||this.epoch!==epoch||this.value!==value||this.scope()!==scope||!this.current()||this.pending||this.unknown)return;this.nextTarget=row.id;const station=this.waitingStation;this.waitingStation=null;this.outputOpen=false;h.ownerDocument.getElementById('rooms').close();if(station)void this.act('start',{stationId:station,targetId:row.id},{kind:'output',id:row.id});else if(this.ownsPlayer()&&value.state.status==='playing')void this.act('move',{targetId:row.id},{kind:'output',id:row.id});else {this.message='';this.render();}}});}

 cleanup(){this.invalidate(true);this.settleResolve?.();}
}
