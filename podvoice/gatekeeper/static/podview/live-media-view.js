import {LiveQueueView} from './live-queue-view.js';
import {roomPlaybackObservation,roomObservationBound,accountObservationBound,roomObservationCurrent,roomObservationDisplay,playbackBinding,playbackObservationCurrent} from './media-observation.js';
import {livePlayerModel,liveQueueModel} from './player-view.js';
const $=id=>document.getElementById(id);
// A transient source read may retain the exact-bound display, never controls.
// Explicit denials and invalid ownership clear it; unavailable is not idle.
export class LiveMediaView{
 constructor(host){this.host=host;this.queueControls=new LiveQueueView(host);this.generation=0;this.rows=new Map();this.account=null;this.lastRead=0;this.pending=false;this.queuePending=false;this.accounts=document.createElement('pv-choice-list');this.accounts.hidden=true;this.accounts.data={items:[],selected:null,stateText:''};this.accounts.setAttribute('aria-label','Musikkonto');this.accounts.addEventListener('pv-action',event=>{if(event.target!==this.accounts||event.detail?.action_id!=='choose')return;event.stopPropagation();this.selectAccount(event.detail.option_id);});$('music-response').prepend(this.accounts);}

 get canChooseAccount(){const read=this.host.liveSnapshot?.capabilities?.musicRead||[];return this.host.liveTransport?.connected===true&&this.readState==='account-selection'&&!this.account&&read.includes('targets')&&read.includes('playback')&&(this.accounts.data?.items?.length||0)>1;}
 focusAccountChoice(){if(!this.canChooseAccount)return false;this.accounts.hidden=false;this.accounts.setAttribute('tabindex','-1');this.accounts.focus?.();return true;}
 setAccount(account){if(this.account===account)return;this.account=account;this.host.liveMusicAccountChanged?.(account);this.accounts.data={...this.accounts.data,selected:account};}
 selectAccount(account){const choices=this.accounts.data?.items||[];if(!choices.some(b=>b.id===account)||this.account===account)return;this.invalidate(true,true);this.setAccount(account);this.refresh();}
 invalidate(revoke=false,preserveChoices=false){if(this.host.liveTransport?.recoveryBlocked===true)revoke=true;if(this.playback&&!roomObservationBound(this.playback,this.host.liveSnapshot,this.account)&&!accountObservationBound(this.playback,this.host.liveSnapshot,this.account))revoke=true;this.queueControls.invalidate(revoke);this.generation++;this.readState='offline';this.lastRead=0;this.pending=false;if(this.playback)this.playback={...this.playback,stale:true,displayRetained:!revoke};if(revoke){this.establishedReadScope=null;this.playback=null;this.queue=null;this.queueError=false;this.setAccount(null);if(!preserveChoices){this.accounts.data={items:[],selected:null,stateText:''};this.accounts.hidden=true;}$('queue').replaceChildren();this.rows.clear();}this.queuePending=false;if(this.queue)this.queue={...this.queue,stale:true};this.render();}
 clearRoom(){this.establishedReadScope=null;this.generation++;this.pending=false;this.playback=null;this.queue=null;this.queuePending=false;this.queueError=false;this.rows.clear();this.queueControls.invalidate(true);this.host.liveControls?.invalidateMusic(undefined,false);}
 // Capture before the command; this closure can only request one passive read after acceptance.
 captureAcceptedPlayRefresh(){
  const host=this.host,transport=host.liveTransport,account=this.account,scope=()=>JSON.stringify([host.liveSnapshot?.bootId,host.liveSnapshot?.roomId,host.liveSnapshot?.mediaRoomBindings,host.liveSnapshot?.providerGeneration,host.liveSnapshot?.voice,host.liveSnapshot?.sessionId,host.liveSnapshot?.taskId,host.liveSnapshot?.inputRevision]),key=scope();let used=false;
  return ()=>{
   if(used)return this.acceptedRefresh?.promise;used=true;
   if(!account||!host.isConnected||!transport?.connected||host.liveTransport!==transport||this.account!==account||scope()!==key||!host.liveSnapshot?.capabilities?.musicRead?.includes('playback'))return;
   if(this.acceptedRefresh?.key===key&&this.acceptedRefresh.transport===transport&&this.acceptedRefresh.account===account)return this.acceptedRefresh.promise;
   // An earlier in-flight poll cannot overwrite the read initiated after acceptance.
   this.generation++;this.pending=false;const job={key,transport,account};this.acceptedRefresh=job;
   job.promise=this.refresh({immediate:true}).finally(()=>{if(this.acceptedRefresh===job)this.acceptedRefresh=null;});return job.promise;
  };
 }
 async refresh({immediate=false}={}){
  this.host.liveOutputs?.refreshConfiguredLabel();
  const host=this.host,snap=host.liveSnapshot,allowed=snap?.capabilities.musicRead||[],bindingScope=JSON.stringify([snap?.bootId,snap?.roomId]),readScope=JSON.stringify([bindingScope,this.account]);if(this.bindingScope!==undefined&&this.bindingScope!==bindingScope){this.clearRoom();this.lastRead=0;}this.bindingScope=bindingScope;const configuredScope=JSON.stringify(snap?.mediaRoomBindings);if(this.configuredReadScope!==undefined&&this.configuredReadScope!==configuredScope&&this.playback?.projectionVersion!==2){this.clearRoom();this.lastRead=0;}this.configuredReadScope=configuredScope;if(this.playback&&!roomObservationBound(this.playback,snap,this.account)&&!accountObservationBound(this.playback,snap,this.account))this.clearRoom();if(!allowed.includes('playback')){this.establishedReadScope=null;if(this.playback||this.account)this.invalidate(true);return;}if(this.pending||!immediate&&Date.now()-this.lastRead<(this.refreshInterval||8000))return;if(this.playback&&!playbackObservationCurrent(this.playback,snap)){this.playback={...this.playback,displayRetained:true};this.queueControls.invalidate(false);}this.pending=true;this.refreshInterval=8000;if(!this.playback&&this.establishedReadScope!==readScope)this.readState='loading';this.render();this.lastRead=Date.now();const transport=host.liveTransport,generation=this.generation,boot=snap.bootId,room=snap.roomId,capabilities=JSON.stringify(allowed);let playbackResponse=false;
  const owner=()=>JSON.stringify([host.liveSnapshot?.providerGeneration,host.liveSnapshot?.voice,host.liveSnapshot?.sessionId,host.liveSnapshot?.taskId,host.liveSnapshot?.inputRevision]),ownerKey=owner();
  const current=()=>host.isConnected&&(!immediate||owner()===ownerKey)&&host.liveTransport===transport&&transport.connected&&generation===this.generation&&host.liveSnapshot.bootId===boot&&host.liveSnapshot.roomId===room&&host.liveSnapshot.capabilities.musicRead.includes('playback')&&JSON.stringify(host.liveSnapshot.capabilities.musicRead)===capabilities&&JSON.stringify([host.liveSnapshot.bootId,host.liveSnapshot.roomId])===bindingScope;
  try{
   if(!this.account){if(!allowed.includes('targets')){this.readState='unavailable';return;}const response=await host.liveTransport.music('targets');if(!current())return;const raw=response.ok===true?response.data?.accounts:null;if(!Array.isArray(raw)||raw.length>64)throw Error('invalid_accounts');if(!raw.length){this.readState='unavailable';return;}const seen=new Set(),options=raw.filter(row=>{if(typeof row?.config_entry_id!=='string'||!row.config_entry_id||row.config_entry_id.length>128||seen.has(row.config_entry_id)||typeof row.title!=='string'||!row.title||row.title.length>256)return false;seen.add(row.config_entry_id);return true;});if(!options.length)throw Error('invalid_accounts');this.accounts.data={items:options.map(row=>({id:row.config_entry_id,label:row.title})),selected:this.account,stateText:''};this.accounts.hidden=options.length===1;if(options.length!==1){this.readState='account-selection';return;}this.setAccount(options[0].config_entry_id);this.host.liveOutputs?.refreshConfiguredLabel();}
   const account=this.account,response=await host.liveTransport.music('playback',account);if(!current()||this.account!==account)return;playbackResponse=true;if(response.ok!==true)throw Error('unavailable_playback');const next=roomPlaybackObservation(response,account,host.liveSnapshot,this.playback);if(!next){this.clearRoom();this.establishedReadScope=JSON.stringify([bindingScope,this.account]);this.readState='unavailable';this.render();return;}if(next.projectionVersion===2&&next.observationStatus==='unavailable'){
    if(next.reason==='owner_changed')this.clearRoom();
    else if(this.playback&&(roomObservationBound(this.playback,snap,account)||accountObservationBound(this.playback,snap,account))){this.playback={...this.playback,stale:true,displayRetained:true};this.queueControls.invalidate(false);this.host.liveControls?.invalidateMusic(undefined,false);}
    this.readState='unavailable';this.render();return;
   }
   if(next.projectionVersion===2&&next.observationStatus==='idle'){this.clearRoom();this.readState='idle';this.render();return;}
   const previousBinding=playbackBinding(this.playback,snap,account),nextBinding=playbackBinding(next,snap,account),ownerChanged=this.playback&&next.owner_epoch!==this.playback.owner_epoch;
   if(ownerChanged||previousBinding?.bindingId!==nextBinding?.bindingId){this.queue=null;this.queueControls.invalidate(true);$('queue').replaceChildren();this.rows.clear();this.host.liveControls?.invalidateMusic(undefined,false);if(ownerChanged)this.host.liveMusicAccountChanged?.(account);}
   const actualLabel=nextBinding?host.liveOutputs?.actualLabel?.(nextBinding)||'':'';
   if(actualLabel)next.actualTargetLabel=actualLabel;this.playback=next;const refreshUntil=nextBinding?.validUntil===undefined?next.expiresAt:Math.min(next.expiresAt,nextBinding.validUntil*1000);this.refreshInterval=Math.max(1000,Math.min(8000,Math.floor((refreshUntil-Date.now())/2)));this.readState='ready';host.liveSelection?.observePlayback?.(next);this.render();
  }catch(error){if(current()){if(!playbackResponse&&(error?.code==='read_transient'||error instanceof TypeError||['AbortError','TimeoutError'].includes(error?.name))&&(roomObservationBound(this.playback,this.host.liveSnapshot,this.account)||accountObservationBound(this.playback,this.host.liveSnapshot,this.account))){this.playback={...this.playback,stale:true,displayRetained:true};this.queueControls.invalidate(false);}else this.clearRoom();this.establishedReadScope=JSON.stringify([bindingScope,this.account]);this.readState='error';this.render();}}finally{if(generation===this.generation){this.pending=false;if(this.readState==='loading')this.readState='unavailable';this.establishedReadScope=JSON.stringify([bindingScope,this.account]);if(this.host.isConnected)this.render();}}
 }
 async loadQueue(){
  if(!roomObservationCurrent(this.playback,this.host.liveSnapshot)||!this.host.liveTransport?.connected){this.queueControls.invalidate(!roomObservationDisplay(this.playback,this.host.liveSnapshot,this.account));this.renderQueue();return;}
  await this.queueControls.load(this.account,this.playback,{notify:true});
 }

 renderQueue(){
  const snapshot=this.host.liveSnapshot,read=snapshot?.capabilities?.musicRead||[];
  if(this.playback&&!read.includes('playback'))this.clearRoom();
  if(!read.includes('queue')||!roomObservationDisplay(this.playback,snapshot,this.account)||!roomObservationBound(this.playback,snapshot,this.account)){
   if(this.queueControls.retained||this.queueControls.offer||this.queueControls.pending)this.queueControls.invalidate(true);
   this.host.playerView.renderQueue([],{status:'unavailable',empty:this.playback?.accountObserved===true?'Højttaleren er ikke bekræftet · køen er ikke tilgængelig.':!read.includes('queue')?'Køen er ikke tilgængelig med den aktuelle adgang.':'Køen kunne ikke bekræftes for rummet.'});
   return;
  }
  const native=this.queueControls.model(this.account,this.playback);
  if(native){
   const status=native.status,empty=status==='ready'?'Ingen sange i køen.':status==='stale'?'Ingen sange i den sidst kendte kø.':status==='error'?(this.queueControls.errorKind==='choice'?'Køvalget blev afvist.':'Køen kunne ikke hentes.'):status==='unknown'?'Køvalg kunne ikke bekræftes.':status==='loading'||status==='pending'?'':'Ingen bekræftet kø at vise.';
   this.host.playerView.renderQueue(native.items,{status,empty,errorKind:native.errorKind});return;
  }
  const admitted=snapshot?.capabilities?.queueSelection===true,connected=!!this.host.liveTransport?.connected,current=roomObservationCurrent(this.playback,snapshot);
  const status=admitted&&connected&&current?this.queueControls.status:'unavailable';
  const empty=!admitted?'Køen er ikke tilgængelig med den aktuelle adgang.':!connected?'Forbindelsen mangler for køen.':!current?'Køen kunne ikke bekræftes for rummet.':status==='error'?(this.queueControls.errorKind==='choice'?'Køvalget blev afvist.':'Køen kunne ikke hentes.'):status==='unknown'?'Køvalg kunne ikke bekræftes.':status==='loading'||status==='pending'?'':'Ingen bekræftet kø at vise.';
  this.host.playerView.renderQueue([],{status,empty,errorKind:this.queueControls.errorKind});
 }

 render(){
  if(this.playback&&!this.host.liveSnapshot?.capabilities?.musicRead?.includes('playback'))this.clearRoom();
  if(this.playback&&!roomObservationBound(this.playback,this.host.liveSnapshot,this.account)&&!accountObservationBound(this.playback,this.host.liveSnapshot,this.account))this.clearRoom();
  if(this.playback&&(roomObservationBound(this.playback,this.host.liveSnapshot,this.account)||accountObservationBound(this.playback,this.host.liveSnapshot,this.account))&&!playbackObservationCurrent(this.playback,this.host.liveSnapshot)&&this.playback.displayRetained!==true){
   // Snapshot and navigation render before refresh; keep only the old display, never its offer.
   this.playback={...this.playback,displayRetained:true};this.queueControls.invalidate(false);
  }
  if(!this.host.liveSnapshot?.capabilities.musicRead.includes('queue')&&this.queue){this.queue=null;this.queueError=false;}
  const p=roomObservationDisplay(this.playback,this.host.liveSnapshot,this.account)?this.playback:null,feedback=this.host.liveSelection?.feedback;
  // A fresh independent room observation owns current playback status. It does
  // not turn a previous UNKNOWN request into success or restore its action.
  const observed=Date.parse(p?.observedAt),currentStatus=feedback?.outcome==='unknown'&&!feedback.pending&&this.readState==='ready'&&this.host.liveTransport?.connected===true&&roomObservationCurrent(p,this.host.liveSnapshot)&&['playing','paused'].includes(p?.state)&&/^spotify:(track|episode):[A-Za-z0-9]{22}$/.test(p.item?.uri||'')&&p.config_entry_id===feedback.accountId&&p.target?.id===feedback.targetId&&(!feedback.destination||this.host.liveOutputs?.observedDestination?.(feedback.destination.speakerId)===true)&&Number.isFinite(observed)&&Number.isFinite(feedback.requestedAt)&&observed>=feedback.requestedAt&&/^spotify:(track|episode|playlist):[A-Za-z0-9]{22}$/.test(feedback.uri||'')&&(!/^spotify:(track|episode):/.test(feedback.uri)||p.item?.uri===feedback.uri);
  if(currentStatus){if(this.selectionReceiptFeedback!==feedback){this.selectionReceiptFeedback=feedback;if(!this.host.feedbackMessage||this.host.feedbackMessage===feedback.message)this.host.showFeedback?.(feedback.message,false);}}else if(this.selectionReceiptFeedback!==feedback)this.selectionReceiptFeedback=null;
  const selected=this.host.liveSelection?.pendingPlayer?.(),model=livePlayerModel(p,!!this.host.liveTransport?.connected,this.readState,this.host.liveSnapshot,this.host.liveOutputs?.configuredLabel()||'',this.host.liveOutputs?.actualLabel?.(playbackBinding(p,this.host.liveSnapshot,this.account))||p?.actualTargetLabel||'');
  this.host.playerView.renderPlayer({...model,nextDestinationLabel:!model.active&&!selected?this.host.liveOutputs?.nextDestinationLabel?.()||'':'',canChooseAccount:this.canChooseAccount,feedback:currentStatus?null:feedback,...(selected?{...selected,active:true,playing:false,fresh:false,loading:true,sourceKind:'music',progressMs:null,durationMs:null,positionFresh:false,canSeek:false,canOutput:false,feedback:{...feedback,message:'Starter afspilning…',pending:true}}:{})});
  if(!this.host.liveControls)this.host.playerView.renderControls({playing:p?.state==='playing',blocked:true});
  if(selected)this.host.playerView.renderQueue([],{status:'pending',empty:'Starter afspilning…'});else this.renderQueue();this.host.liveControls?.render();if(selected)this.host.playerView.renderControls({playing:false,blocked:true,volume:null,canVolume:false});this.host.liveCatalogue?.render();this.host.renderOverviewFacts?.();
 }
}
