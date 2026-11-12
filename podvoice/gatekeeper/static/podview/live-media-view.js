import {LiveQueueView,upcomingQueueRows} from './live-queue-view.js';
import {roomPlayerObservation,roomObservationBound,roomObservationCurrent,roomObservationDisplay,playbackBinding,playbackObservationCurrent} from './media-observation.js';
import {livePlayerModel,liveQueueModel} from './player-view.js';
// A screen without control access says so where the controls are, never a silent lock or "unknown".
export const NO_ACCESS='Skærmen har ikke adgang · Tilknyt';
export const PAUSED_KEEP_MS=10*60*1000;
const PAUSED_STORE='podview.pausedSince';
// The first time this screen saw the song paused; stored so a reload keeps the same 10 minutes.
export function pauseExpired(room,account,playback,now=Date.now()){
 let saved=null;
 try{saved=JSON.parse(globalThis.localStorage?.getItem(PAUSED_STORE)||'null');}catch{}
 if(playback?.state!=='paused'){
  if(saved&&playback?.state==='playing')try{globalThis.localStorage?.removeItem(PAUSED_STORE);}catch{}
  return false;
 }
 const key=JSON.stringify([room,account,playback.item?.uri??null]);
 if(saved?.key===key&&Number.isFinite(saved.at)&&saved.at<=now)return now-saved.at>=PAUSED_KEEP_MS;
 try{globalThis.localStorage?.setItem(PAUSED_STORE,JSON.stringify({key,at:now}));}catch{}
 return false;
}
// Shape-only parse failures. Scope, account, binding and owner failures are not listed: those still clear.
const malformedPlaybackAnswer=new Set(['invalid_media_text','invalid_playback_state','invalid_player_actions',
 'invalid_player_number']);
const $=id=>document.getElementById(id);
// While a chosen song starts, the room is read again shortly (Green: ~2 s late otherwise).
const SETTLEMENT_READ_MS=250,SETTLEMENT_READ_WINDOW_MS=15000,QUEUE_TROUBLE_MS=10000;
// A transient source read may retain the exact-bound display, never controls.
// Explicit denials and invalid ownership clear it; unavailable is not idle.
export class LiveMediaView{
 constructor(host){this.host=host;this.queueControls=new LiveQueueView(host);this.generation=0;this.rows=new Map();this.account=null;this.lastRead=0;this.pending=false;this.queuePending=false;this.accounts=document.createElement('pv-choice-list');this.accounts.hidden=true;this.accounts.data={items:[],selected:null,stateText:''};this.accounts.setAttribute('aria-label','Musikkonto');this.accounts.addEventListener('pv-action',event=>{if(event.target!==this.accounts||event.detail?.action_id!=='choose')return;event.stopPropagation();this.selectAccount(event.detail.option_id);});$('music-response').prepend(this.accounts);}

 get canChooseAccount(){const read=this.host.liveSnapshot?.capabilities?.musicRead||[];return this.host.liveTransport?.connected===true&&this.readState==='account-selection'&&!this.account&&read.includes('targets')&&read.includes('playback')&&(this.accounts.data?.items?.length||0)>1;}
 focusAccountChoice(){if(!this.canChooseAccount)return false;this.accounts.hidden=false;this.accounts.setAttribute('tabindex','-1');this.accounts.focus?.();return true;}
 setAccount(account){if(this.account===account)return;this.account=account;this.host.liveMusicAccountChanged?.(account);this.accounts.data={...this.accounts.data,selected:account};}
 selectAccount(account){const choices=this.accounts.data?.items||[];if(!choices.some(b=>b.id===account)||this.account===account)return;this.invalidate(true,true);this.setAccount(account);this.refresh();}
 invalidate(revoke=false,preserveChoices=false){this.recoveryAttempts=0;clearTimeout(this.freshnessTimer);this.freshnessTimer=null;this.queueReadRetry=null;if(this.host.liveTransport?.recoveryBlocked===true)revoke=true;if(this.playback&&!roomObservationBound(this.playback,this.host.liveSnapshot,this.account))revoke=true;this.queueControls.invalidate(revoke);this.generation++;this.readState='offline';this.lastRead=0;this.pending=false;if(this.playback)this.playback={...this.playback,stale:true,displayRetained:!revoke};if(revoke){this.establishedReadScope=null;this.playback=null;this.queue=null;this.queueError=false;this.setAccount(null);if(!preserveChoices){this.accounts.data={items:[],selected:null,stateText:''};this.accounts.hidden=true;}$('queue').replaceChildren();this.rows.clear();}this.queuePending=false;if(this.queue)this.queue={...this.queue,stale:true};this.render();}
 clearRoom(){this.recoveryAttempts=0;clearTimeout(this.freshnessTimer);this.freshnessTimer=null;this.queueReadRetry=null;this.establishedReadScope=null;this.generation++;this.pending=false;this.playback=null;this.queue=null;this.queuePending=false;this.queueError=false;this.rows.clear();this.queueControls.invalidate(true);this.host.liveControls?.invalidateMusic(undefined,false);}
 scheduleRecovery(){
  const host=this.host,snap=host.liveSnapshot,transport=host.liveTransport,generation=this.generation,account=this.account;
  const scope=JSON.stringify([snap?.bootId,snap?.roomId,snap?.capabilities?.musicRead]);
  if(!host.isConnected||!transport?.connected||!snap?.capabilities?.musicRead?.includes('playback')||this.recoveryAttempts>=3)return;
  clearTimeout(this.freshnessTimer);const base=[2000,4000,8000][this.recoveryAttempts||0],delay=Math.round(base*(0.85+0.3*Math.random()));this.recoveryAttempts=(this.recoveryAttempts||0)+1;
  this.freshnessTimer=setTimeout(()=>{this.freshnessTimer=null;const s=host.liveSnapshot;if(!host.isConnected||host.liveTransport!==transport||!transport.connected||this.generation!==generation||this.account!==account||JSON.stringify([s?.bootId,s?.roomId,s?.capabilities?.musicRead])!==scope)return;void this.refresh({immediate:true}).catch(()=>{});},delay);this.freshnessTimer.unref?.();
 }
 async refresh({immediate=false}={}){
  const host=this.host,snap=host.liveSnapshot,allowed=snap?.capabilities.musicRead||[];
  const readKey=()=>JSON.stringify([host.liveSnapshot?.bootId,host.liveSnapshot?.roomId,this.account,
   host.liveSnapshot?.capabilities?.musicRead,host.liveSnapshot?.musicRevision??null]);
  if(this.activeRead){
   if(this.activeRead.key===readKey()&&this.activeRead.transport===host.liveTransport
    &&this.activeRead.generation===this.generation)return this.activeRead.promise;
   this.pending=false;
  }
  host.liveOutputs?.refreshConfiguredLabel();
  const bindingScope=JSON.stringify([snap?.bootId,snap?.roomId]),readScope=JSON.stringify([bindingScope,this.account]);
  if(this.bindingScope!==undefined&&this.bindingScope!==bindingScope){this.clearRoom();this.lastRead=0;}
  this.bindingScope=bindingScope;
  if(this.playback&&!roomObservationBound(this.playback,snap,this.account))this.clearRoom();
  if(!allowed.includes('playback')){this.establishedReadScope=null;if(this.playback||this.account)this.invalidate(true);return;}
  if(this.pending||!immediate&&Date.now()-this.lastRead<(this.refreshInterval||8000))return;
  if(this.playback&&!playbackObservationCurrent(this.playback,snap)){
   this.playback={...this.playback,displayRetained:true};this.queueControls.invalidate(false);
  }
  clearTimeout(this.freshnessTimer);this.freshnessTimer=null;this.pending=true;
  const readJob={key:readKey(),account:this.account,transport:host.liveTransport,generation:this.generation};
  readJob.promise=new Promise(resolve=>readJob.resolve=resolve);this.activeRead=readJob;this.refreshInterval=8000;
  if(!this.playback&&this.establishedReadScope!==readScope)this.readState='loading';
  try{this.render();}catch(error){if(this.activeRead===readJob)this.activeRead=null;this.pending=false;readJob.resolve();throw error;}
  this.lastRead=Date.now();
  const transport=host.liveTransport,generation=this.generation,boot=snap.bootId,room=snap.roomId,capabilities=JSON.stringify(allowed);
  let playbackResponse=false;
  const diagnosticAt=Date.now(),readDiagnostic=transport.createReadDiagnostic?.(),record=value=>{
   if(typeof transport.recordReadDiagnostic==='function')transport.recordReadDiagnostic('music_read',value,readDiagnostic);
   else transport.recordDiagnostic?.('music_read',value);
  };
  record({code:'start'});
  const current=()=>host.isConnected&&readKey()===readJob.key&&host.liveTransport===transport&&transport.connected
   &&generation===this.generation&&host.liveSnapshot.bootId===boot&&host.liveSnapshot.roomId===room
   &&host.liveSnapshot.capabilities.musicRead.includes('playback')
   &&JSON.stringify(host.liveSnapshot.capabilities.musicRead)===capabilities;
  readJob.isCurrent=current;
  // The next read: soon while a chosen song is starting, otherwise a slow safety net under HA's events.
  const schedule=ms=>{
   const timerGeneration=this.generation,timerTransport=host.liveTransport;clearTimeout(this.freshnessTimer);
   this.freshnessTimer=setTimeout(()=>{
    this.freshnessTimer=null;
    if(host.isConnected&&host.liveTransport===timerTransport&&this.generation===timerGeneration)
     void this.refresh({immediate:true}).catch(()=>{});
   },ms);
   this.freshnessTimer.unref?.();
  };
  try{
   if(!this.account){if(!allowed.includes('targets')){this.readState='unavailable';return;}const response=await host.liveTransport.music('targets');if(!current())return;const raw=response.ok===true?response.data?.accounts:null;if(!Array.isArray(raw)||raw.length>64)throw Error('invalid_accounts');if(!raw.length){this.readState='unavailable';return;}const seen=new Set(),options=raw.filter(row=>{if(typeof row?.config_entry_id!=='string'||!row.config_entry_id||row.config_entry_id.length>128||seen.has(row.config_entry_id)||typeof row.title!=='string'||!row.title||row.title.length>256)return false;seen.add(row.config_entry_id);return true;});if(!options.length)throw Error('invalid_accounts');this.accounts.data={items:options.map(row=>({id:row.config_entry_id,label:row.title})),selected:this.account,stateText:''};this.accounts.hidden=options.length===1;if(options.length!==1){this.readState='account-selection';return;}this.setAccount(options[0].config_entry_id);readJob.account=this.account;readJob.key=readKey();this.host.liveOutputs?.refreshConfiguredLabel();}
   const account=this.account;
   const response=await host.liveTransport.music('playback',account,undefined,readDiagnostic?{readDiagnostic}:{});
   if(!current()||this.account!==account){record({code:'superseded',current:false,durationMs:Date.now()-diagnosticAt});return;}
   playbackResponse=true;
   const next=roomPlayerObservation(response,account,host.liveSnapshot);
   const selection=host.liveSelection?.settlementReceipt?.();
   const starting=selection?.kind==='selection'&&Date.now()-host.liveSelection.feedback?.requestedAt<SETTLEMENT_READ_WINDOW_MS;
   if(next.state==='unavailable'){
    record({code:'unavailable',durationMs:Date.now()-diagnosticAt});
    if(this.playback&&roomObservationBound(this.playback,snap,account)){
     this.playback={...this.playback,stale:true,displayRetained:true};this.queueControls.invalidate(false);
    }
    this.readState='unavailable';this.render();this.scheduleRecovery();return;
   }
   // g) A song paused in this room stays for 10 min, also across a reload; then the player is empty.
   const expired=pauseExpired(snap.roomId,account,next)&&!host.liveSelection?.feedback?.pending;
   if(next.state==='idle'||expired){
    record({code:'empty',durationMs:Date.now()-diagnosticAt});
    this.clearRoom();this.establishedReadScope=readScope;this.readState='idle';
    if(next.state==='idle')host.liveCatalogue?.observeIdlePlayback?.(account);
    // While an accepted selection starts, the room is read again soon.
    if(starting)schedule(SETTLEMENT_READ_MS);
    this.render();return;
   }
   const previousBinding=playbackBinding(this.playback,snap,account),nextBinding=playbackBinding(next,snap,account);
   if(previousBinding?.bindingId!==nextBinding?.bindingId){
    this.queueReadKey=null;this.queue=null;this.queueControls.invalidate(true);$('queue').replaceChildren();this.rows.clear();
   }
   const actualLabel=nextBinding?host.liveOutputs?.actualLabel?.(nextBinding)||'':'';
   if(actualLabel)next.actualTargetLabel=actualLabel;
   record({code:'ok',durationMs:Date.now()-diagnosticAt});
   this.playback=next;this.readState='ready';this.recoveryAttempts=0;
   host.liveControls?.observePlayer?.(next);
   host.liveSelection?.observePlayback?.(next,selection??null);
   schedule(starting?SETTLEMENT_READ_MS:8000);
   this.render();void this.loadQueue({automatic:true,afterPlayback:true});
  }catch(error){
   record({code:!current()?'superseded':error?.code==='read_access_denied'?'http_denied'
    :error?.code==='read_transient'?'http_transient':error?.name==='TimeoutError'?'timeout'
    :error?.name==='AbortError'?'cancelled':error?.name==='TypeError'?'network':'failure',
   current:current(),durationMs:Date.now()-diagnosticAt});
   if(current()){
    // A same-scope answer with an unexpected shape is no new owner: keep the known song (K5, A11).
    const malformed=playbackResponse&&malformedPlaybackAnswer.has(error?.message);
    const transient=malformed||!playbackResponse&&error?.code!=='read_access_denied'
     &&(error?.code==='read_transient'||error instanceof TypeError||['AbortError','TimeoutError'].includes(error?.name));
    if(transient&&roomObservationBound(this.playback,this.host.liveSnapshot,this.account)){
     this.playback={...this.playback,stale:'transient',displayRetained:true};this.queueControls.invalidate(false);
    }else{const attempts=this.recoveryAttempts;this.clearRoom();if(transient)this.recoveryAttempts=attempts;}
    this.establishedReadScope=readScope;this.readState='error';this.render();if(transient)this.scheduleRecovery();
   }
  }finally{
   try{
    if(generation===this.generation&&this.activeRead===readJob){
     this.pending=false;if(this.readState==='loading')this.readState='unavailable';
     this.establishedReadScope=readScope;if(this.host.isConnected)this.render();
    }
   }finally{if(this.activeRead===readJob)this.activeRead=null;readJob.resolve();}
  }
 }
 async loadQueue({automatic=false,afterPlayback=false,renewChoice=false}={}){
  const host=this.host,p=this.playback,queue=this.queueControls,feedback=host.liveSelection?.feedback;
  if(queue.pending||host.liveControls?.musicIntentPending)return;
  const recoverUnknown=automatic&&afterPlayback&&host.state?.focus==='player'
   &&queue.unknownRecoveryReady?.(this.account,p);
  const snapshot=host.liveSnapshot;
  const key=JSON.stringify([snapshot?.bootId,snapshot?.roomId,this.account,p?.roomBinding?.bindingId,
   p?.owner_epoch,p?.target?.id,p?.item?.uri??null]);
  const transport=host.liveTransport,generation=this.generation,transportGeneration=transport?.generation;
  const retry=this.queueReadRetry,sameRead=this.queueReadKey===key&&this.queueReadTransport===transport;
  const recovering=automatic&&sameRead&&afterPlayback&&retry?.key===key&&retry.transport===transport
   &&retry.transportGeneration===transportGeneration&&retry.generation===generation&&!retry.used;
  const recoverPreview=!!(recovering&&retry.previewPending&&p?.poll_sequence>retry.pollSequence);
  // An unresolved autoplay queue (context switch) or a failed read is read again on each newer source
  // observation until the upcoming songs arrive, instead of staying empty for the rest of the song (K4).
  const previewWaiting=automatic&&afterPlayback&&sameRead
   &&(queue.previewPending===true||queue.status==='error'&&queue.errorKind==='read')
   &&Number.isInteger(p?.poll_sequence)&&p.poll_sequence>(this.queuePreviewPoll??Infinity);
  if(automatic&&(queue.consumed&&!recoverUnknown&&!recoverPreview&&!previewWaiting||feedback?.pending
   ||feedback?.outcome==='unknown'||host.liveSelection?.pendingPlayer?.()||!queue.allowed?.(this.account,p)))return;
  // Prefetch: a new song's queue is read on every page so the player opens with it at once.
  // Re-reads of the same song only happen while the player is open.
  if(automatic&&sameRead&&host.state?.focus!=='player')return;
  // Opening the player reuses a fresh prefetched queue instead of reading it again.
  if(!automatic&&!renewChoice&&sameRead&&this.queuePrefetched===key&&queue.offer
   &&Number.isFinite(queue.offer.expiresAt)&&queue.offer.expiresAt>Date.now()+1000){
   this.queuePrefetched=null;
   this.renderQueue();
   return;
  }
  this.queuePrefetched=automatic&&host.state?.focus!=='player'?key:null;
  // Existing playback observations may refresh expired display custody. Expiry
  // alone schedules no read and never renews an action/occurrence authority.
  const expired=automatic&&sameRead&&afterPlayback&&queue.status==='stale'&&!queue.offer
   &&queue.retained?.transport===transport&&queue.retained?.transportGeneration===transportGeneration
   &&Number.isFinite(queue.retained?.shownOffer?.expiresAt)&&queue.retained.shownOffer.expiresAt<=Date.now();
  if(automatic&&sameRead&&!recovering&&!expired&&!recoverUnknown&&!previewWaiting)return;
  if(!roomObservationCurrent(this.playback,this.host.liveSnapshot)||!this.host.liveTransport?.connected){
   this.queueControls.invalidate(!roomObservationDisplay(this.playback,this.host.liveSnapshot,this.account));
   this.renderQueue();
   return;
  }
  // Consume before dispatch; no timer, repeated poll or failed retry can rearm it.
  if(recovering)retry.used=true;
  else this.queueReadRetry=null;
  this.queueReadKey=key;
  this.queueReadTransport=transport;
  const loaded=await queue.load(this.account,this.playback,{
   notify:!automatic&&!renewChoice,preserveChoices:renewChoice,
  });
  this.queuePreviewPoll=(queue.previewPending===true||queue.status==='error'&&queue.errorKind==='read')
   &&this.queueReadKey===key?p?.poll_sequence:null;
  if(!recovering&&queue.readRetryable===true&&(!queue.consumed||queue.previewPending)
   &&this.queueReadKey===key&&this.queueReadTransport===transport&&host.liveTransport===transport
   &&transport.generation===transportGeneration&&this.generation===generation){
   this.queueReadRetry={key,transport,transportGeneration,generation,used:false,
    previewPending:queue.previewPending,pollSequence:p?.poll_sequence};
  }
  return loaded;
 }

 // One presentation of the queue (K2/K4): known rows stay while a new read runs, loading shows
 // placeholder rows, and a problem is only named once it has lasted QUEUE_TROUBLE_MS.
 renderQueue(){
  const snapshot=this.host.liveSnapshot,read=snapshot?.capabilities?.musicRead||[],queue=this.queueControls;
  if(this.playback&&!read.includes('playback'))this.clearRoom();
  const readable=read.includes('queue'),admitted=snapshot?.capabilities?.queueSelection===true;
  let items=[],status,empty,errorKind=null;
  if(!readable||!roomObservationDisplay(this.playback,snapshot,this.account)||!roomObservationBound(this.playback,snapshot,this.account)){
   // Access rules revoke at once. A briefly unconfirmed route keeps the known rows as read-only display.
   // An account-level observation is not this room's route: its queue is never shown here.
   if(!readable||!this.playback||this.playback.accountObserved===true){
    if(queue.retained||queue.offer||queue.pending)queue.invalidate(true);
   }
   else if(queue.offer||queue.pending)queue.invalidate(false);
   if(queue.retained)items=upcomingQueueRows(queue.retained?.items||[],this.playback?.item).map(row=>({...row,selectable:false}));
   status=items.length?'stale':'unavailable';
   empty=!readable?'Køen er ikke tilgængelig med den aktuelle adgang.':'';
  }else{
   const native=queue.model(this.account,this.playback);
   if(native){
    status=native.status;errorKind=native.errorKind;
    empty=native.metadataPending?'Køens oplysninger er ikke tilgængelige endnu.':status==='ready'?'Ingen sange i køen.':status==='stale'?'Ingen sange i den seneste kø.':status==='error'?(queue.errorKind==='choice'?'Køvalget blev afvist.':''):status==='unknown'?'Køvalg kunne ikke bekræftes.':'';
    items=this.host.liveSelection?.pendingPlayer?.()?native.items.map(item=>({...item,selectable:false})):native.items;
   }else{
    status=admitted?queue.status:'unavailable';errorKind=queue.errorKind;
    empty=!admitted?'Køen er ikke tilgængelig med den aktuelle adgang.':status==='error'&&errorKind==='choice'?'Køvalget blev afvist.':status==='unknown'?'Køvalg kunne ikke bekræftes.':'';
   }
  }
  // Known rows outlive a failed read as the last known queue; a read failure is not shown as an error.
  if(items.length&&status==='error'&&errorKind!=='choice'){status='stale';errorKind=null;}
  // Settled answers show at once: rows, an authoritative empty queue, a choice outcome or an access rule.
  const settled=items.length>0||!readable||!admitted||['ready','unknown'].includes(status)||status==='error'&&errorKind==='choice'
   ||status==='stale'&&queue.retained?.items?.length===0&&!queue.retained.metadataPending;
  if(settled){this.queueTroubleSince=null;clearTimeout(this.queueTroubleTimer);this.queueTroubleTimer=null;}
  else{
   this.queueTroubleSince??=Date.now();
   const remaining=this.queueTroubleSince+QUEUE_TROUBLE_MS-Date.now();
   if(remaining>0){
    status='loading';empty='';errorKind=null;
    if(!this.queueTroubleTimer){
     this.queueTroubleTimer=setTimeout(()=>{this.queueTroubleTimer=null;if(this.host.isConnected)this.renderQueue();},remaining);
     this.queueTroubleTimer.unref?.();
    }
   }else{
    status='unavailable';errorKind=null;
    // Known songs that have all played, or an unresolved autoplay queue: more songs are on the way.
    empty=queue.previewPending||queue.retained?.items?.length>0?'Flere sange kommer…'
     :'Køen kan ikke vises lige nu. Musikken spiller videre.';
   }
  }
  this.host.playerView.renderQueue(items,{status,empty,errorKind,placeholders:status==='loading'});
 }

 observedPlayerModel(){const p=roomObservationDisplay(this.playback,this.host.liveSnapshot,this.account)?this.playback:null;return livePlayerModel(p,!!this.host.liveTransport?.connected,(['connecting','connected'].includes(this.host.liveStatus)&&!this.host.liveSnapshot&&!this.playback)?'loading':this.readState,this.host.liveSnapshot,this.host.liveOutputs?.configuredLabel()||'',this.host.liveOutputs?.actualLabel?.(playbackBinding(p,this.host.liveSnapshot,this.account))||p?.actualTargetLabel||'');}

 render(){
  if(this.host.liveRadio?.renderPlayer())return;
  if(this.playback&&!this.host.liveSnapshot?.capabilities?.musicRead?.includes('playback'))this.clearRoom();
  if(this.playback&&!roomObservationBound(this.playback,this.host.liveSnapshot,this.account))this.clearRoom();
  if(this.playback&&roomObservationBound(this.playback,this.host.liveSnapshot,this.account)&&!playbackObservationCurrent(this.playback,this.host.liveSnapshot)&&this.playback.displayRetained!==true){
   // Snapshot and navigation render before refresh; keep only the old display, never its offer.
   this.playback={...this.playback,displayRetained:true};this.queueControls.invalidate(false);
  }
  if(!this.host.liveSnapshot?.capabilities.musicRead.includes('queue')&&this.queue){this.queue=null;this.queueError=false;}
  const p=roomObservationDisplay(this.playback,this.host.liveSnapshot,this.account)?this.playback:null,feedback=this.host.liveSelection?.feedback;
  // A fresh independent room observation owns current playback status. It does
  // not turn a previous UNKNOWN request into success or restore its action.
  const observed=Date.parse(p?.observedAt),currentStatus=feedback?.outcome==='unknown'&&!feedback.pending&&this.readState==='ready'&&this.host.liveTransport?.connected===true&&roomObservationCurrent(p,this.host.liveSnapshot)&&['playing','paused'].includes(p?.state)&&/^spotify:(track|episode):[A-Za-z0-9]{22}$/.test(p.item?.uri||'')&&p.config_entry_id===feedback.accountId&&p.target?.id===feedback.targetId&&(feedback.nativeDestination?this.host.liveSelection?.destinationObserved?.(p,feedback.nativeDestination)===true:!feedback.destination||this.host.liveOutputs?.observedDestination?.(feedback.destination.speakerId)===true)&&Number.isFinite(observed)&&Number.isFinite(feedback.requestedAt)&&observed>=feedback.requestedAt&&/^spotify:(track|episode|playlist):[A-Za-z0-9]{22}$/.test(feedback.uri||'')&&(!/^spotify:(track|episode):/.test(feedback.uri)||p.item?.uri===feedback.uri);
  if(currentStatus){if(this.selectionReceiptFeedback!==feedback){this.selectionReceiptFeedback=feedback;if(!this.host.feedbackMessage||this.host.feedbackMessage===feedback.message)this.host.showFeedback?.(feedback.message,false);}}else if(this.selectionReceiptFeedback!==feedback)this.selectionReceiptFeedback=null;
  const selection=this.host.liveSelection,playerFeedback=selection?.playerFeedback?.()??feedback,selected=selection?.pendingPlayer?.(playerFeedback),model=this.observedPlayerModel();if(model.active&&typeof model.playing==='boolean'&&this.host.liveControls?.optimisticPlaying)model.playing=this.host.liveControls.optimisticPlaying(model.playing);
  const controls=this.host.liveControls,controlStatus=!selected&&model.active?(controls?.playerStatus?.()||(this.host.liveTransport?.connected&&Array.isArray(this.host.liveSnapshot?.capabilities?.controlSetup)&&!this.host.liveSnapshot.capabilities.controlSetup.includes('music')?NO_ACCESS:'')):'';
  const pendingChoice=this.host.liveOutputs?.pendingChoiceLabel?.()||'';
    // The speaker's native confirmation of this exact request plays the chosen item before
  // Spotify's observation names it. Controls still wait for that observation's authority.
  const confirmed=!!selected&&playerFeedback?.settlementStatus==='confirmed';
  this.host.playerView.renderPlayer({...model,...(model.active&&pendingChoice?{selectedTarget:pendingChoice}:{}),controlStatus,nextDestinationLabel:!model.active&&!selected?this.host.liveOutputs?.nextDestinationLabel?.()||'':'',canChooseAccount:this.canChooseAccount,feedback:currentStatus?null:playerFeedback,...(selected?{...selected,active:true,playing:confirmed,fresh:false,loading:!confirmed,sourceKind:'music',progressMs:null,durationMs:null,positionFresh:false,canSeek:false,canOutput:false,feedback:confirmed?null:{...feedback,message:'Starter afspilning…',pending:true}}:{})});
  if(!this.host.liveControls)this.host.playerView.renderControls({playing:p?.state==='playing',blocked:true});
  this.renderQueue();this.host.liveControls?.render();if(selected)this.host.playerView.renderControls({playing:confirmed,blocked:true,volume:null,canVolume:false});this.host.liveCatalogue?.render();this.host.renderOverviewFacts?.();
 }
}
