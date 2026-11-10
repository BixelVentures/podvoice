import {applyKitComponent,applyKitDialog} from './ui/kit.js';
import {observationFresh,mediaRoomBinding,playbackBinding,roomObservationCurrent,waitForMusicLane}
 from './media-observation.js';
import {sourceMusicCards} from './music-results.js';
import {selectionRequestTargets,searchSample,selectionCurrent,selectionOffer,collectionCurrent} from './music-selection-model.js';
const LANE_WAITING = 'Dit valg sendes, når den igangværende handling er færdig.';
const LANE_UNKNOWN = 'Den forrige handling kunne ikke bekræftes · dit valg blev ikke sendt.';

const selectionDisplayWaitMs=30000;
const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;if(tag==='button')applyKitComponent(node,'button',{variant:cls?.split(/\s+/).includes('pv-primary')?'primary':'secondary'});return node;};

// The browser presents server choices. It never supplies a track URI as action authority.
export class LiveMusicSelectionView{
 constructor(host){
  this.host=host;this.generation=0;this.account=null;this.source=null;this.offer=null;this.targets=[];this.active=false;this.used=false;
  this.panel=make('section','pv-content');this.panel.setAttribute('aria-label','Søg efter musik');
  this.form=make('form','pv-actions');this.input=make('input');this.input.type='search';this.input.maxLength=160;this.input.required=true;this.input.placeholder='Søg efter en sang';this.input.setAttribute('aria-label','Søg efter en sang');this.submit=make('button','pv-button pv-primary','Søg');this.submit.type='submit';this.form.append(this.input,this.submit);
  this.back=make('button','pv-button pv-ghost','Til dine sange');this.back.type='button';this.back.hidden=true;this.back.addEventListener('click',()=>this.leave());
  this.note=make('p','pv-meta','Søg efter en sang.');this.note.setAttribute('role','status');
  this.targetLabel=make('label','pv-meta','Afspil på');this.targetSelect=make('select');this.targetSelect.setAttribute('aria-label','Vælg højttaler');this.targetLabel.append(this.targetSelect);this.targetLabel.hidden=true;
  this.results=host.querySelector('#result-list');this.panel.append(this.form,this.back,this.note,this.targetLabel);
  this.searchDialog=make('dialog','pv-component');this.searchDialog.setAttribute('aria-label','Søg efter musik');const closeSearch=make('button','pv-button pv-ghost','Luk');closeSearch.type='button';closeSearch.addEventListener('click',()=>this.searchDialog.close());this.searchDialog.append(this.panel,closeSearch);applyKitDialog(this.searchDialog,{content:this.panel});host.append(this.searchDialog);
  this.dialog=make('dialog','pv-component');const header=make('header'),actions=make('div','pv-actions');this.title=make('h2',null,'Bekræft musik');this.title.id='music-confirm-title';this.dialog.setAttribute('aria-labelledby',this.title.id);this.detail=make('p');this.volume=make('p','pv-meta');this.confirmButton=make('button','pv-button pv-primary','Afspil');this.confirmButton.type='button';const cancel=make('button','pv-button pv-ghost','Annuller');cancel.type='button';cancel.addEventListener('click',()=>this.dialog.close());this.confirmButton.addEventListener('click',()=>this.send());this.dialog.addEventListener('close',()=>{if(this.dialog.dataset?.presentationClose==='true'){delete this.dialog.dataset.presentationClose;return;}this.restoreRecoveryFocus();});header.append(this.title);actions.append(this.confirmButton,cancel);this.dialog.append(header,this.detail,this.volume,actions);applyKitDialog(this.dialog,{header,description:this.detail,actions});host.append(this.dialog);
  this.form.addEventListener('submit',event=>{event.preventDefault();this.search();});this.targetSelect.addEventListener('change',()=>this.setup());
 }
 context(){const s=this.host.liveSnapshot;return this.host.isConnected&&this.host.liveTransport?.connected&&s&&typeof this.account==='string'&&!!this.account&&this.account===this.host.liveMedia?.account?{bootId:s.bootId,roomId:s.roomId,accountId:this.account}:null;}
 // Passive target discovery is short-lived request metadata, never a setup or play grant.
 targetReadScope(){const context=this.context(),s=this.host.liveSnapshot;return context&&this.host.state?.focus==='music'&&this.host.liveTransport?.recoveryBlocked!==true&&s.capabilities?.musicRead?.includes('targets')&&s.capabilities.musicSelection===true&&mediaRoomBinding(s,this.account)?JSON.stringify([context,s.mediaRoomBindings,s.providerGeneration,s.voice,s.sessionId,s.taskId,s.inputRevision,s.capabilities.musicRead,s.capabilities.musicSelection]):null;}
 async readTargets(passive=false,allowExpiredRetry=true){
  const scope=this.targetReadScope(),transport=this.host.liveTransport,account=this.account;
  const transportGeneration=transport?.generation;
  if(!scope){this.targetRead=null;return null;}
  const current=ticket=>this.targetRead===ticket&&this.targetReadScope()===scope
   &&this.host.liveTransport===transport&&transport.generation===transportGeneration&&this.account===account;
  const settle=async ticket=>{
   const targets=await ticket.promise;
   if(!current(ticket))return null;
   if(!passive&&(ticket.expiredOnArrival||targets&&ticket.passive&&ticket.expiresAt<=Date.now())){
    // Only replace an expired read. Never repeat setup or a playback effect.
    if(!allowExpiredRetry)return null;
    this.targetRead=null;
    return this.readTargets(false,false);
   }
   return targets;
  };
  const previous=this.targetRead;
  if(previous?.scope===scope&&previous.transport===transport&&previous.transportGeneration===transportGeneration){
   if(previous.pending)return settle(previous);
   if(passive)return previous.targets;
   if(previous.targets&&previous.expiresAt>Date.now())return previous.targets;
  }
  const ticket={scope,transport,transportGeneration,passive,pending:true,targets:null,expiresAt:0,requestedAt:Date.now()};
  this.targetRead=ticket;
  ticket.promise=(async()=>{
   try{
    const body=await transport.music('targets',account);
    if(!current(ticket))return null;
    const targets=selectionRequestTargets(body,account,this.host.liveSnapshot);
    if(!targets)return null;
    const arrivedAt=Date.now(),observedAt=typeof body.observedAt==='number'?body.observedAt*1000:NaN;
    if(Object.hasOwn(body,'observedAt')){
     if(!Number.isFinite(observedAt)||observedAt>arrivedAt+5000)return null;
     if(observedAt+10000<=arrivedAt){
      ticket.expiredOnArrival=targets.length>0;
      return null;
     }
    }
    ticket.expiresAt=Number.isFinite(observedAt)?Math.min(observedAt+10000,ticket.requestedAt+10000):0;
    ticket.targets=targets;
    return targets;
   }catch{return null;}finally{ticket.pending=false;}
  })();
  return settle(ticket);
 }
 prefetchTargets(){const scope=this.targetReadScope();if(!scope){this.targetRead=null;this.targetPrefetchPaused=null;return;}if(this.targetPrefetchPaused===scope)return;if(this.targetRead?.scope===scope&&this.targetRead.transport===this.host.liveTransport)return;this.targetRead=null;if(this.pending||this.active||this.collectionMode)return;void this.readTargets(true);}
 current(context,generation){const now=this.context(),s=this.host.liveSnapshot,r=this.recoveryContinuation,focus=globalThis.document?.activeElement,i=this.intent;if(i&&(this.host.state&&this.host.state.focus!=='music'||JSON.stringify(s?.mediaRoomBindings)!==i.binding||JSON.stringify([s?.providerGeneration,s?.voice,s?.sessionId,s?.taskId,s?.inputRevision])!==i.owner||focus&&focus!==i.focus&&focus!==globalThis.document?.body))return false;if(r&&(this.host.state?.focus!=='music'||this.host.liveCatalogue?.entries.get(this.host.liveCatalogue.key())!==r.entry||!r.entry.cards.includes(r.card)||r.entry.actionDispatched||JSON.stringify(s?.mediaRoomBindings)!==r.binding||JSON.stringify([s?.providerGeneration,s?.voice,s?.sessionId,s?.taskId,s?.inputRevision])!==r.owner||focus&&focus!==r.focus&&focus!==globalThis.document?.body&&focus!==this.targetSelect))return false;return !!now&&!!context&&generation===this.generation&&now.bootId===context.bootId&&now.roomId===context.roomId&&now.accountId===context.accountId&&s.capabilities.musicRead?.includes(this.collectionMode?this.source?.sourceKind:'search')&&(!this.collectionMode||this.host.liveCatalogue?.entries.get(this.host.liveCatalogue.key())===this.collectionEntry&&collectionCurrent(this.source,s,this.account));}
 // A result ticket carries presentation only; it cannot retain a source, task or action grant.
 feedbackScope(answerTask=this.feedbackAnswerTask){const context=this.context(),s=this.host.liveSnapshot;return context?JSON.stringify([context,s?.mediaRoomBindings,s?.providerGeneration,s?.voice,s?.sessionId,s?.taskId,s?.inputRevision,s?.capabilities?.musicRead,s?.capabilities?.musicSelection,answerTask?[s?.answers?.sessionId,s?.answers?.turnId,s?.answers?.taskId,s?.answers?.inputRevision,s?.answers?.revision]:null]):null;}
 resultCurrent(ticket){const focus=globalThis.document?.activeElement;return !!ticket&&this.resultTicket===ticket&&ticket.scope!==null&&ticket.scope===this.feedbackScope()&&(!focus||focus===ticket.focus||focus===globalThis.document?.body);}
 invalidate(message='Søg efter en sang.',retained=null){if(!this.used)this.host.liveControls?.endMusicIntent?.(this.musicIntentLock);this.musicIntentLock=null;this.resultTicket=retained?.ticket||null;this.expiryFeedbackScope=retained?.scope||null;this.pendingFeedbackScope=null;this.pendingCardId=null;this.pendingCardSource=null;this.pendingCardIndex=null;this.feedbackAnswerTask=retained?.answerTask===true;this.intent=null;this.selectionIndex=null;this.feedback=retained?.feedback||null;this.recovery=null;this.recoveryContinuation=null;this.generation++;clearTimeout(this.expiryTimer);if(this.dialog.open)this.dialog.close();this.active=false;this.collectionMode=false;this.collectionEntry=null;this.collectionIndex=null;this.retainedTracks=null;this.source=null;this.searchScope=null;this.offer=null;this.targets=[];this.used=false;this.pending=false;this.targetSelect.replaceChildren();this.targetLabel.hidden=true;this.note.textContent=message;this.host.liveMedia?.render?.();this.render();}
 setAccount(account){if(this.account===account)return;this.targetRead=null;this.account=account;this.input.value='';this.active=false;this.invalidate(account?'Søg efter en sang.':'Vælg en musikkonto.');}
 ownerChanged(account){this.targetRead=null;this.host.liveCatalogue?.invalidateAuthority(false);this.invalidate('Afspilningen er ændret · søg igen.');this.setAccount(account);}
 onSnapshot(){this.prefetchTargets();if(this.resultTicket&&!this.resultCurrent(this.resultTicket)||this.expiryFeedbackScope&&this.expiryFeedbackScope!==this.feedbackScope()){this.resultTicket=null;this.expiryFeedbackScope=null;this.feedback=null;this.host.liveMedia?.render?.();}const snapshot=this.host.liveSnapshot,capabilities=snapshot?.capabilities,authority=JSON.stringify([snapshot?.bootId,snapshot?.roomId,capabilities?.musicRead,capabilities?.musicSelection===true,snapshot?.mediaRoomBindings]);if(this.authority!==undefined&&this.authority!==authority){this.authority=authority;this.host.liveCatalogue?.invalidateAuthority(false);this.invalidate('Forbindelsen eller adgangen er ændret · søg igen.');return;}this.authority=authority;const context=this.context();if(this.source&&(!context||context.bootId!==this.searchScope?.bootId||context.roomId!==this.searchScope?.roomId||context.accountId!==this.searchScope?.accountId||this.source.context&&capabilities?.musicSelection!==true)){this.invalidate('Forbindelsen eller adgangen er ændret · søg igen.');return;}if(this.collectionMode&&this.source&&!collectionCurrent(this.source,snapshot,this.account)){const expired=this.source.expiresAt<=Date.now()&&collectionCurrent({...this.source,expiresAt:Number.MAX_SAFE_INTEGER},snapshot,this.account),ticket=this.resultCurrent(this.resultTicket)?this.resultTicket:null,scope=this.feedbackScope(),focus=globalThis.document?.activeElement,setupCurrent=!this.collectionEntry?.actionDispatched&&this.pending&&this.pendingFeedbackScope===scope&&(!focus||focus===this.recoveryContinuation?.focus||focus===globalThis.document?.body||focus===this.targetSelect),retained=expired&&scope&&(ticket||setupCurrent)?{ticket,scope,answerTask:this.feedbackAnswerTask,feedback:ticket?this.feedback:{message:'Forslaget er udløbet. Hent nye forslag.',pending:false}}:null;if(retained&&!ticket&&this.collectionEntry)this.collectionEntry.selectionUnavailable=true;this.invalidate('Afspilningsvalget skal bekræftes igen.',retained);return;}if(this.offer&&!selectionCurrent(this.offer,snapshot,this.account,this.source)){const timeExpired=this.offer.expiresAt<=Date.now()&&selectionCurrent({...this.offer,expiresAt:Date.now()+1},snapshot,this.account,this.source);if(this.collectionEntry)this.collectionEntry.selectionExpired=timeExpired&&!this.collectionEntry.actionDispatched;this.offer=null;this.chosen=null;if(this.dialog.open)this.dialog.close();this.used=true;if(this.collectionEntry)this.collectionEntry.selectionSpent=true;this.note.textContent='Valget er udløbet eller ændret · søg igen.';}this.render();}
 async search(){
  const query=this.input.value.trim(),context=this.context();if(!context||!this.host.liveSnapshot.capabilities.musicRead?.includes('search')||query.length<1||query.length>160)return;
  this.host.liveCatalogue?.invalidateAuthority(false);const retained=this.source?.tracks;this.invalidate('');this.retainedTracks=retained;this.active=true;this.searchScope=context;const generation=this.generation;this.pending=true;this.render();
  try{const body=await this.host.liveTransport.music('search',context.accountId,query);if(!this.current(context,generation))return;const source=searchSample(body,context.accountId,query,this.host.liveSnapshot);if(!source)throw Error('invalid_search');this.source=source;this.showTracks(source.tracks);if(!source.tracks.length){this.note.textContent='Ingen sange fundet.';return;}
   if(!source.context||this.host.liveSnapshot.capabilities.musicSelection!==true){this.note.textContent='Søgeresultater fra Spotify · afspilning er ikke tilgængelig her.';return;}
   const targets=await this.readTargets();if(!this.current(context,generation)||this.source!==source)return;if(!targets)throw Error('invalid_targets');this.targets=targets;this.showTargets();this.targetLabel.hidden=true;this.note.textContent='';if(this.searchDialog.open)this.searchDialog.close();
  }catch{if(this.current(context,generation))this.note.textContent='Søgningen kunne ikke bruges · prøv en ny søgning.';}
  finally{if(generation===this.generation){this.pending=false;this.render();}}
 }
 // A caller may open the existing search task without adding a permanent form.
 openSearch(query=''){this.searchDialog.setAttribute('aria-label','Søg efter musik');this.input.value=query;this.searchDialog.showModal();}
 leave(){this.targetPrefetchPaused=this.targetReadScope();this.targetRead=null;this.invalidate('Vælg musik.');if(this.searchDialog?.open)this.searchDialog.close();this.host.liveCatalogue?.render();}
 showTracks(){this.render();}
 async chooseCard(card){const transport=this.host.liveTransport;let requestId;try{const id=transport?.crypto?.randomUUID?.();if(typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))requestId=id;}catch{}const trace={requestId,transport,transportGeneration:transport?.generation,diagnosticScope:transport?.diagnosticScope,bootId:this.host.liveSnapshot?.bootId,roomId:this.host.liveSnapshot?.roomId,outcome:'rejected'};try{transport?.recordDiagnostic?.('control_intent',{code:'start',domain:'music',requestId});}catch{}try{return await this.chooseCardIntent(card,trace);}catch(error){trace.outcome='unknown';throw error;}finally{try{if(this.host.liveTransport===trace.transport&&transport?.generation===trace.transportGeneration&&transport?.diagnosticScope===trace.diagnosticScope&&this.host.liveSnapshot?.bootId===trace.bootId&&this.host.liveSnapshot?.roomId===trace.roomId)transport?.recordDiagnostic?.('control_intent',{code:trace.outcome,domain:'music',requestId});}catch{}}}
 async waitForSelectionLane(source, choiceCurrent) {
  const controls = this.host.liveControls;
  const transport = this.host.liveTransport;
  const generation = transport?.generation;
  const answerTask = source?.context?.revisionScope === 'answer_task';
  const scope = this.feedbackScope(answerTask);
  const focus = this.host.state?.focus;
  let destination;
  try { destination = this.host.liveOutputs?.selectionDestination?.(); }
  catch { return null; }
  // A waiter only retains the explicit selection's identity, never playback authority.
  const current = () => !!scope && this.host.liveControls === controls && this.host.liveTransport === transport
   && transport.generation === generation && this.host.state?.focus === focus
   && this.feedbackScope(answerTask) === scope && this.destinationCurrent({destination}) && choiceCurrent();
  const feedback = {message: LANE_WAITING, pending: true};
  this.feedback = feedback;
  this.host.liveMedia?.render?.();
  const turn = await waitForMusicLane(controls);
  if (this.feedback === feedback) {
   this.feedback = turn === 'unknown' && current() ? {message: LANE_UNKNOWN, pending: false} : null;
   this.host.liveMedia?.render?.();
  }
  return turn === 'free' ? current : null;
 }
 async chooseCardIntent(card,trace){
  if (this.host.liveControls?.musicIntentPending && !this.musicIntentLock) {
   const active = this.active;
   const catalogue = active ? null : this.host.liveCatalogue;
   const key = catalogue?.key();
   const entry = catalogue?.entries.get(key);
   const source = active ? this.source : entry?.source;
   const index = card.optionIndex;
   const track = source?.tracks[index];
   const uri = card.uri;
   const candidate = source?.context?.candidateSetId;
   const generation = this.generation;
   const choiceCurrent = active
    ? () => this.active && this.source === source && this.generation === generation
     && source?.context?.candidateSetId === candidate && card.optionIndex === index && card.uri === uri
     && !!track && source.tracks[index] === track && track.uri === uri
    : () => !this.active && this.host.liveCatalogue === catalogue && catalogue?.key() === key
     && !!entry && catalogue.entries.get(key) === entry && entry.cards.includes(card) && card.uri === uri;
   const current = await this.waitForSelectionLane(source, choiceCurrent);
   if (!current) return;
   if (!current()) { trace.outcome = 'superseded'; return; }
  }
  if(!this.active)return this.chooseCollection(card,trace);if(this.pending||this.used||!this.source?.context){trace.outcome=this.pending?'busy':this.used?'spent':'stale_setup';return;}const index=card.optionIndex;if(!Number.isInteger(index)||!this.source.tracks[index]){trace.outcome='invalid_target';return;}this.intent={focus:globalThis.document?.activeElement,binding:JSON.stringify(this.host.liveSnapshot?.mediaRoomBindings),owner:JSON.stringify([this.host.liveSnapshot?.providerGeneration,this.host.liveSnapshot?.voice,this.host.liveSnapshot?.sessionId,this.host.liveSnapshot?.taskId,this.host.liveSnapshot?.inputRevision])};this.selectionIndex=index;const binding=mediaRoomBinding(this.host.liveSnapshot,this.account),target=binding&&this.targets.find(row=>row.accountId===this.account&&row.targetId===binding.targetId);if(!target){trace.outcome='invalid_target';this.feedback={message:'Højttaleren i rummet kan ikke bruges lige nu.',pending:false};this.host.liveMedia?.render?.();return;}this.pendingCardId=card.id;this.pendingCardSource=this.source;this.pendingCardIndex=index;this.feedbackAnswerTask=this.source.context?.revisionScope==='answer_task';this.pendingFeedbackScope=this.feedbackScope();this.feedback={message:'Afventer afspilning i rummet.',pending:true};this.host.liveMedia?.render?.();this.targetSelect.value=target.targetId;if(selectionCurrent(this.offer,this.host.liveSnapshot,this.account,this.source)&&this.destinationCurrent(this.offer))return this.openConfirm(index,trace);return this.setup(false,trace);}
 expireCollection(entry){if(this.collectionEntry!==entry)return;this.offer=null;this.chosen=null;if(this.dialog.open)this.dialog.close();this.used=true;entry.selectionSpent=true;entry.selectionExpired=!entry.actionDispatched;this.note.textContent='Afspilningsvalget er udløbet.';this.render();}
 async chooseCollection(card,trace){
  const catalogue=this.host.liveCatalogue,entry=catalogue?.entries.get(catalogue.key()),index=entry?.cards.findIndex(row=>row.id===card.id);
  let continuation=null;
  if (!entry || index < 0 || entry.cards[index] !== card || this.recovery || this.pending
   || entry.actionDispatched && !catalogue.canRenewEntry?.(entry, card)) {
   if (trace) trace.outcome = this.recovery || this.pending ? 'busy' : !entry || index < 0 ? 'invalid_target' : 'spent';
   return;
  }
  if(!collectionCurrent(entry.source,this.host.liveSnapshot,this.account)||entry.selectionExpired||entry.actionDispatched||['account_playlists','recent'].includes(entry.sourceKind)&&!entry.source.tracks.some(track=>track.uri===card.uri)){
   if(!catalogue.canRenewEntry?.(entry,card))return;
   const context=JSON.stringify(this.context()),binding=JSON.stringify(this.host.liveSnapshot?.mediaRoomBindings),focus=globalThis.document?.activeElement,key=catalogue.key();
   const retainedSource=entry.source,previousPreview=entry.preview,originTransport=this.host.liveTransport,originGeneration=originTransport?.generation,renewal=catalogue.renewForCard(card,trace),recovery={entry,card};this.recovery=recovery;this.source=retainedSource;this.searchScope=this.context();this.pendingCardId=card.id;this.pendingCardSource=retainedSource;this.pendingCardIndex=index;this.feedbackAnswerTask=retainedSource?.context?.revisionScope==='answer_task';this.pendingFeedbackScope=this.feedbackScope();const renewalFeedback={message:'Klargør dit musikvalg.',pending:true};this.feedback=renewalFeedback;this.host.liveMedia?.render?.();
   let renewed=false,renewalOwned=false;try{renewed=await renewal;}catch{}finally{renewalOwned=this.recovery===recovery;if(renewalOwned)this.recovery=null;else renewed=false;if(this.feedback===renewalFeedback){this.feedback=null;this.host.liveMedia?.render?.();}}
   const currentFocus=globalThis.document?.activeElement,sameScope=renewalOwned&&this.host.state?.focus==='music'&&context===JSON.stringify(this.context())&&binding===JSON.stringify(this.host.liveSnapshot?.mediaRoomBindings)&&key===catalogue.key()&&catalogue.entries.get(key)===entry&&entry.cards[index]===card&&this.pendingFeedbackScope===this.feedbackScope()&&this.host.liveTransport===originTransport&&originTransport?.generation===originGeneration&&(!currentFocus||currentFocus===focus||currentFocus===globalThis.document?.body);
   if(!renewed&&sameScope&&entry.preview&&entry.preview!==previousPreview&&entry.preview.readOnly===true&&entry.source===null){this.resultTicket={scope:this.feedbackScope(),focus};this.feedback={message:'Musikvalget fejlede · prøv igen.',pending:false,outcome:'rejected'};this.host.liveMedia?.render?.();}
   if(renewed&&trace){if(this.host.state?.focus!=='music'||currentFocus&&currentFocus!==focus&&currentFocus!==globalThis.document?.body)trace.outcome='renewal_focus_changed';else if(context!==JSON.stringify(this.context())||binding!==JSON.stringify(this.host.liveSnapshot?.mediaRoomBindings)||key!==catalogue.key()||catalogue.entries.get(key)!==entry)trace.outcome='renewal_owner_changed';else if(entry.cards[index]!==card)trace.outcome='renewal_card_mismatch';else if(entry.actionDispatched)trace.outcome='renewal_other';}
   if(!renewed||this.host.state?.focus!=='music'||context!==JSON.stringify(this.context())||binding!==JSON.stringify(this.host.liveSnapshot?.mediaRoomBindings)||key!==catalogue.key()||catalogue.entries.get(key)!==entry||entry.cards[index]!==card||entry.actionDispatched||currentFocus&&currentFocus!==focus&&currentFocus!==globalThis.document?.body)return;
   continuation={entry,card,binding,focus,row:this.host.musicResults?.rows?.get(card.id),context,owner:JSON.stringify([this.host.liveSnapshot?.providerGeneration,this.host.liveSnapshot?.voice,this.host.liveSnapshot?.sessionId,this.host.liveSnapshot?.taskId,this.host.liveSnapshot?.inputRevision])};
  }
  if(!this.context()||!this.host.liveSnapshot.capabilities.musicRead?.includes('targets')||this.pending||entry.selectionSpent||entry.selectionUnavailable||!collectionCurrent(entry.source,this.host.liveSnapshot,this.account))return;
  const selectionIndex=['account_playlists','recent'].includes(entry.sourceKind)?entry.source.tracks.findIndex(track=>track.uri===card.uri):index;
  if(selectionIndex<0)return;
  this.invalidate('');continuation??={entry,card,binding:JSON.stringify(this.host.liveSnapshot?.mediaRoomBindings),focus:globalThis.document?.activeElement,context:JSON.stringify(this.context()),owner:JSON.stringify([this.host.liveSnapshot?.providerGeneration,this.host.liveSnapshot?.voice,this.host.liveSnapshot?.sessionId,this.host.liveSnapshot?.taskId,this.host.liveSnapshot?.inputRevision])};this.recoveryContinuation=continuation;this.feedback={message:'Afventer afspilning i rummet.',pending:true};this.feedbackAnswerTask=entry.source.context.revisionScope==='answer_task';this.pendingFeedbackScope=this.feedbackScope();this.collectionMode=true;this.collectionEntry=entry;this.collectionIndex=selectionIndex;this.source=entry.source;this.pendingCardId=card.id;this.pendingCardSource=this.source;this.pendingCardIndex=selectionIndex;this.searchScope=this.context();this.pending=true;this.host.liveMedia?.render?.();this.render();const generation=this.generation,context=this.context(),source=this.source;
  try{const targets=await this.readTargets();if(!this.current(context,generation)||this.source!==source){if(trace)trace.outcome='superseded';return;}if(!targets)throw Error('invalid_targets');this.targets=targets;this.showTargets();this.pending=false;
   const binding=mediaRoomBinding(this.host.liveSnapshot,this.account),current=binding&&targets.find(target=>target.accountId===this.account&&target.targetId===binding.targetId);
   if(current){this.targetSelect.value=current.targetId;await this.setup(true,trace);}else{this.targetRead=null;this.feedback={message:'Højttaleren i rummet kan ikke bruges lige nu.',pending:false};this.host.liveMedia?.render?.();}
  }catch{if(this.current(context,generation)){this.targetRead=null;this.feedback={message:'Afspilning i rummet kunne ikke klargøres.',pending:false};this.host.liveMedia?.render?.();}}
  finally{if(generation===this.generation){this.pending=false;if(!this.current(context,generation)){this.feedback=null;this.host.liveMedia?.render?.();}this.render();}}
 }
 showTargets(){this.targetSelect.replaceChildren();const placeholder=make('option',null,'Vælg højttaler');placeholder.value='';this.targetSelect.append(placeholder);for(const target of this.targets){const option=make('option',null,target.name);option.value=target.targetId;this.targetSelect.append(option);}this.targetLabel.hidden=true;this.render();}
 destinationCurrent(offer){try{return (offer?.destination?.speakerId??null)===(this.host.liveOutputs?.selectionDestination?.()?.speakerId??null);}catch{return false;}}
 async setup(targetsFresh=false,trace=null){
  let target=this.targets.find(row=>row.targetId===this.targetSelect.value);const source=this.source,context=this.context();this.offer=null;this.chosen=null;if(this.dialog.open)this.dialog.close();clearTimeout(this.expiryTimer);this.render();if(!target||!source?.context||!context||this.used||this.collectionMode&&!collectionCurrent(source,this.host.liveSnapshot,this.account))return;
  const controls=this.host.liveControls;if(controls&&!this.musicIntentLock){this.musicIntentLock=controls.beginMusicIntent?.();if(!this.musicIntentLock){if(trace)trace.outcome='busy';this.feedback={message:'Afventer den igangværende musikhandling.',pending:false};this.host.liveMedia?.render?.();return;}}
  const intentLock=this.musicIntentLock,generation=++this.generation;this.pending=true;this.note.textContent='';this.render();
  try{if(this.targetRead&&!targetsFresh){const targets=await this.readTargets();if(!this.current(context,generation)||this.source!==source){if(trace)trace.outcome='superseded';return;}target=targets?.find(row=>row.targetId===target.targetId);if(!target)throw Error('invalid_targets');this.targets=targets;}const destination=this.host.liveOutputs?.selectionDestination?.();if(destination)target={...target,speakerId:destination.speakerId,name:destination.name};const requestedAt=Date.now(),body=await this.host.liveTransport.musicSelectionSetup(source.context.candidateSetId,target,source.candidateIds,{traceId:trace?.requestId});if(!this.current(context,generation)||this.source!==source||this.targetSelect.value!==target.targetId||this.host.liveSnapshot.capabilities.musicSelection!==true){if(trace)trace.outcome='superseded';return;}if(JSON.stringify(this.host.liveOutputs?.selectionDestination?.()??null)!==JSON.stringify(destination??null))throw Error('destination_changed');const offer=selectionOffer(body,source,target,requestedAt);if(!offer||!selectionCurrent(offer,this.host.liveSnapshot,this.account,source)||this.collectionEntry?.dispatchHistory?.some(row=>row.taskId===offer.taskId))throw Error('invalid_offer');this.offer=offer;if(this.searchDialog?.open)this.searchDialog.close();this.note.textContent=`${target.name} · startlydstyrke ${offer.startVolumePercent} %. Vælg sang for at bekræfte.`;this.expiryTimer=setTimeout(()=>{if(this.offer===offer){this.offer=null;this.chosen=null;if(this.dialog.open)this.dialog.close();this.used=true;if(this.collectionEntry){this.collectionEntry.selectionSpent=true;this.collectionEntry.selectionExpired=!this.collectionEntry.actionDispatched;}this.note.textContent=this.collectionMode?'Afspilningsvalget er udløbet.':'Valget er udløbet · søg igen.';this.render();}},Math.max(0,offer.expiresAt-Date.now()));
  }catch{if(this.current(context,generation)){if(this.collectionMode||this.intent){this.feedback={message:'Højttaleren i rummet kan ikke bruges lige nu.',pending:false};this.host.liveMedia?.render?.();}else this.note.textContent='Højttaleren kan ikke bruges ved den aktuelle lydstyrke · vælg igen senere.';}}
  finally{if(generation===this.generation){this.pending=false;if(!this.current(context,generation)){this.feedback=null;this.host.liveMedia?.render?.();}this.render();if(this.offer&&this.current(context,generation)){const index=this.collectionMode?this.collectionIndex:this.selectionIndex;if(Number.isInteger(index))await this.openConfirm(index,trace);}}if(generation===this.generation&&this.musicIntentLock===intentLock){controls?.endMusicIntent?.(intentLock);this.musicIntentLock=null;}}
 }
 restoreRecoveryFocus(){
  const r=this.recoveryContinuation,d=globalThis.document,active=d?.activeElement,row=r?.row,catalogue=this.host.liveCatalogue,s=this.host.liveSnapshot;
  if(!r||!row||row.isConnected!==true||row.disabled||row.getAttribute?.('aria-disabled')==='true'||this.pending||r.entry.actionDispatched||this.dialog.open||this.searchDialog?.open||this.host.state?.focus!=='music'||r.context!==JSON.stringify(this.context())||r.binding!==JSON.stringify(s?.mediaRoomBindings)||r.owner!==JSON.stringify([s?.providerGeneration,s?.voice,s?.sessionId,s?.taskId,s?.inputRevision])||catalogue?.entries.get(catalogue.key())!==r.entry||!r.entry.cards.includes(r.card)||this.host.musicResults?.rows?.get(r.card.id)!==row||this.source!==r.entry.source||!collectionCurrent(this.source,s,this.account)||!selectionCurrent(this.offer,s,this.account,this.source)||d?.querySelector?.('dialog[open]'))return;
  if(active&&active!==d?.body&&active.isConnected!==false&&!active.disabled&&!this.dialog.contains?.(active))return;
  this.recoveryContinuation=null;row.focus();
 }
 openConfirm(index,trace=null){const offer=this.offer,source=this.source;if(this.pending||this.used)return;if(this.host.liveControls&&!this.musicIntentLock){if(this.collectionMode)this.collectionIndex=index;else this.selectionIndex=index;return this.setup(true,trace);}if(!(this.collectionMode||this.intent)||!this.current(this.searchScope,this.generation)||!selectionCurrent(offer,this.host.liveSnapshot,this.account,source)||!offer?.options[index]){this.feedback={message:'Afspilningsvalget er ikke længere tilgængeligt.',pending:false};this.host.liveMedia?.render?.();return;}this.chosen=offer.options[index];return this.send(trace);}
 async send(trace=null){if(this.host.liveControls&&!this.musicIntentLock){
  const {offer,source,chosen,collectionMode,collectionEntry,generation} = this;
  const index = offer?.options.indexOf(chosen);
  if(Number.isInteger(index)&&index>=0){
  if (this.host.liveControls.musicIntentPending) {
   const track = source?.tracks[index];
   const uri = track?.uri;
   const optionId = chosen.id;
   const candidate = source?.context?.candidateSetId;
   const target = this.targetSelect.value;
   const catalogue = this.host.liveCatalogue;
   const current = await this.waitForSelectionLane(source, () => this.offer === offer && this.chosen === chosen
    && offer.options[index] === chosen && chosen.id === optionId && this.source === source
    && source?.context?.candidateSetId === candidate && !!track && source.tracks[index] === track && track.uri === uri
    && this.collectionMode === collectionMode && this.collectionEntry === collectionEntry
    && (!collectionMode || catalogue === this.host.liveCatalogue
     && catalogue?.entries.get(catalogue.key()) === collectionEntry)
    && this.generation === generation && this.targetSelect.value === target && this.destinationCurrent(offer));
   if (!current) return;
   if (!current()) { if(trace)trace.outcome = 'superseded'; return; }
  }
  if(this.collectionMode)this.collectionIndex=index;else this.selectionIndex=index;return this.setup(true,trace);}return;}const intentLock=this.musicIntentLock;let destination,nativeDestination;try{destination=this.host.liveOutputs?.selectionDestination?.();nativeDestination=this.host.liveOutputs?.selectionWitness?.();if(!destination){const configured=mediaRoomBinding(this.host.liveSnapshot,this.account);if(configured)nativeDestination=Object.freeze({accountId:configured.accountId,nativeRoomId:configured.nativeRoomId,nativeHomepodId:configured.nativeHomepodId});}}catch{if(!this.used&&!this.pending){this.feedback={message:'Højttalervalget er udløbet · vælg højttaler igen.',pending:false};this.host.liveMedia?.render?.();}return;}const offer=this.offer,source=this.source,option=this.chosen,context=this.context();if((offer?.destination?.speakerId??null)!==(destination?.speakerId??null)||this.pending||this.used||!context||!option||(this.collectionMode||this.intent)&&!this.current(context,this.generation)||!selectionCurrent(offer,this.host.liveSnapshot,this.account,source)||!offer.options.some(row=>row.id===option.id)){this.dialog.close();return;}const focusTicket=this.host.playerView?.beginSourceFocus?.('music',nativeDestination);this.used=true;
  const entry = this.collectionEntry;
  const dispatch = entry ? Object.freeze({
   candidateSetId: source.context.candidateSetId, taskId: offer.taskId,
   revision: offer.revision, optionId: option.id, cardId: this.pendingCardId,
  }) : null;
  if (entry) {
   entry.selectionSpent = true;
   entry.actionDispatched = true;
   entry.selectionConfirmed = false;
   delete entry.selectionSettlementStatus;
   entry.dispatchedCardId = this.pendingCardId;
   entry.dispatchedCandidateId = source.context.candidateSetId;
   entry.dispatchHistory = [...(entry.dispatchHistory || []), dispatch];
   entry.selectionExpired = false;
  }
  this.pending=true;this.dialog.close();this.note.textContent='';if(this.collectionMode||this.intent){const index=offer.options.indexOf(option);this.feedback={message:offer.destination?`Afventer afspilning i ${offer.destination.name}.`:'Afventer afspilning i rummet.',pending:true,...(offer.destination?{destination:{...offer.destination}}:{}),...(nativeDestination?{nativeDestination}:{}),accountId:this.account,targetId:offer.target.targetId,uri:source.tracks[index]?.uri,requestedAt:Date.now()};this.host.liveMedia?.render?.();}this.feedbackAnswerTask=source.context?.revisionScope==='answer_task';const ticket=this.feedback?{scope:this.feedbackScope(),focus:globalThis.document?.activeElement}:null;this.resultTicket=ticket;this.expiryFeedbackScope=null;this.render();const generation=this.generation,diagnosticTransport=this.host.liveTransport,diagnosticTransportGeneration=diagnosticTransport.generation,diagnosticScope=trace?trace.diagnosticScope:diagnosticTransport.diagnosticScope,diagnosticBoot=trace?trace.bootId:this.host.liveSnapshot?.bootId,diagnosticRoom=trace?trace.roomId:this.host.liveSnapshot?.roomId;let diagnosticRequestId;let outcome='unknown',message='Udfaldet er ukendt · handlingen gentages ikke.';
  const transportGeneration = diagnosticTransport.generation;
  try{const fastReadUntil=Math.min(offer.expiresAt,Number.isFinite(source.expiresAt)?source.expiresAt:offer.expiresAt);if(nativeDestination&&this.resultCurrent(ticket))this.feedback={...this.feedback,settlementReceipt:Object.freeze({kind:'selection',requestId:null,transport:diagnosticTransport,transportGeneration,ticket,fastReadUntil,destination:Object.freeze({...nativeDestination}),entry})};if(trace)trace.outcome='unknown';const result=await diagnosticTransport.musicSelectionAction(offer,option.id,{requestId:trace?.requestId});if(outcome==='unknown'&&result.outcome==='accepted'&&typeof result.requestId==='string'&&result.requestId.length>0&&Array.from(result.requestId).length<=120&&nativeDestination&&this.resultCurrent(ticket)&&diagnosticTransport===this.host.liveTransport&&diagnosticTransport.generation===transportGeneration)this.feedback={...this.feedback,settlementReceipt:Object.freeze({kind:'selection',requestId:result.requestId,transport:diagnosticTransport,transportGeneration,ticket,fastReadUntil,destination:Object.freeze({...nativeDestination}),entry})};if(result.outcome==='rejected'&&result.ok===false&&result.retryAllowed===false&&result.physicalResultVerified===false&&typeof result.requestId==='string'&&result.requestId.length>0&&Array.from(result.requestId).length<=120&&generation===this.generation&&this.resultCurrent(ticket)&&diagnosticTransport===this.host.liveTransport&&diagnosticTransport.generation===transportGeneration&&entry&&entry===this.collectionEntry&&this.host.liveCatalogue?.entries.get(this.host.liveCatalogue.key())===entry&&entry.actionDispatched)entry.selectionSettlementStatus='rejected';diagnosticRequestId=result.requestId;try{if(this.host.liveTransport===diagnosticTransport&&(!trace||trace.transport===diagnosticTransport&&trace.transportGeneration===diagnosticTransportGeneration)&&diagnosticTransport.generation===diagnosticTransportGeneration&&diagnosticTransport.diagnosticScope===diagnosticScope&&this.host.liveSnapshot?.bootId===diagnosticBoot&&this.host.liveSnapshot?.roomId===diagnosticRoom)diagnosticTransport.recordDiagnostic?.('control_action',{code:['accepted','unknown','rejected'].includes(result.outcome)?result.outcome:'other',domain:'music',requestId:diagnosticRequestId});}catch{}outcome=result.outcome;if(trace)trace.outcome=generation!==this.generation||diagnosticTransport!==this.host.liveTransport||diagnosticTransport.generation!==transportGeneration?'superseded':['accepted','unknown','rejected'].includes(outcome)?outcome:'unknown';message=result.outcome==='accepted'?'Anmodningen er modtaget · afventer observeret afspilning.':result.outcome==='unknown'?'Udfaldet er ukendt · handlingen gentages ikke.':'Afspilningen blev afvist · vælg igen.';if(generation===this.generation)this.note.textContent=message;}catch{if(generation===this.generation)this.note.textContent=message;}finally{
   // Preserve the exact dispatch outcome across disconnects without restoring stale player feedback.
   if (outcome === 'unknown' && dispatch && entry.actionDispatched && entry.dispatchHistory?.at(-1) === dispatch) {
    entry.selectionSettlementStatus = 'unknown';
   }
   this.host.playerView?.finishSourceFocus?.(focusTicket,outcome);this.host.liveControls?.endMusicIntent?.(intentLock,outcome);if(this.musicIntentLock===intentLock)this.musicIntentLock=null;if(generation===this.generation){this.pending=false;this.offer=null;if(this.collectionMode||this.intent){this.feedback=this.resultCurrent(ticket)?{...this.feedback,message:this.note.textContent,outcome,pending:false,awaitingObservation:this.note.textContent==='Anmodningen er modtaget · afventer observeret afspilning.'}:null;this.note.textContent='';this.host.liveMedia?.render?.();}this.render();}else if(this.resultCurrent(ticket)){this.feedback={...this.feedback,message,outcome,pending:false,awaitingObservation:message==='Anmodningen er modtaget · afventer observeret afspilning.'};this.host.liveMedia?.render?.();}}if(outcome==='accepted'&&generation===this.generation&&this.resultCurrent(ticket)){
  clearTimeout(this.expiryTimer);
  const remaining=this.feedback.requestedAt+selectionDisplayWaitMs-Date.now();
  this.expiryTimer=setTimeout(()=>{
   if(this.resultCurrent(ticket)&&this.playerFeedback()?.displayExpired)this.host.liveMedia?.render?.();
  },Math.max(0,remaining));
  this.expiryTimer.unref?.();
 }if(outcome==='accepted'&&this.host.state?.focus==='music'&&this.resultCurrent(ticket))void Promise.resolve().then(()=>this.resultCurrent(ticket)&&this.host.liveTransport===diagnosticTransport&&diagnosticTransport.generation===diagnosticTransportGeneration?this.host.liveMedia?.refresh?.({immediate:true}):undefined).catch(()=>{});}

 // Presentation of the explicit choice is not playback evidence or action authority.
 playerFeedback(){
  const feedback=this.feedback;
  if(feedback?.outcome!=='accepted'||!feedback.awaitingObservation||feedback.displayObserved||['rejected','superseded'].includes(feedback.settlementStatus)||!Number.isFinite(feedback.requestedAt)||Date.now()-feedback.requestedAt<selectionDisplayWaitMs)return feedback;
  return {...feedback,displayExpired:true,message:'Kunne ikke bekræfte det valgte nummer.'};
 }
 pendingPlayer(feedback=this.playerFeedback()){
  if(!feedback||!this.context()||this.pendingFeedbackScope!==this.feedbackScope())return null;
  if(this.resultTicket&&!this.resultCurrent(this.resultTicket))return null;
  const source=this.pendingCardSource;if(source!==this.source)return null;const track=source?.tracks?.[this.pendingCardIndex];if(!track||!/^spotify:(track|episode|playlist):[A-Za-z0-9]{22}$/.test(track.uri||''))return null;
  if(feedback.outcome==='accepted'){
   if(feedback.displayObserved||!Number.isFinite(feedback.requestedAt)||feedback.displayExpired||['rejected','superseded'].includes(feedback.settlementStatus)||this.selectionItemObserved(this.host.liveMedia?.playback,feedback,track.uri))return null;
  }else if(!(feedback.pending||feedback.awaitingObservation))return null;
  return {title:track.name||track.title||'',artist:track.artist||'',uri:track.uri,artwork:track.artwork,themeArt:/^spotify:playlist:/.test(track.uri)?sourceMusicCards([track],this.collectionEntry?.kind||this.host.liveCatalogue?.selected)[0]?.themeArt:null,themeId:track.themeId,target:feedback.destination?.name||this.host.liveOutputs?.nextDestinationLabel?.()||this.offer?.target?.name||this.host.liveOutputs?.configuredLabel?.()||'Højttaleren i rummet'};
 }
 selectionItemObserved(playback,feedback,uri=feedback.uri){
  if(!roomObservationCurrent(playback,this.host.liveSnapshot)||!['playing','paused'].includes(playback.state)||playback.config_entry_id!==feedback.accountId||playback.target?.id!==feedback.targetId)return false;
  if(feedback.nativeDestination?!this.destinationObserved(playback,feedback.nativeDestination):feedback.destination&&this.host.liveOutputs?.observedDestination?.(feedback.destination.speakerId)!==true)return false;
  const observedAt=Date.parse(playback.observedAt);
  if(!Number.isFinite(observedAt)||!Number.isFinite(feedback.requestedAt)||observedAt<feedback.requestedAt)return false;
  if(/^spotify:(track|episode):/.test(uri||''))return playback.item?.uri===uri;
  // Route confirmation alone says nothing about the playlist's first item.
  return /^spotify:playlist:/.test(uri||'')&&feedback.settlementStatus==='confirmed'&&playback.owner_epoch===feedback.settlementTuple?.owner_epoch&&/^spotify:(track|episode):/.test(playback.item?.uri||'')&&Number.isFinite(playback.providerChangedAtMs)&&playback.providerChangedAtMs>=feedback.requestedAt&&playback.providerChangedAtMs<=observedAt;
 }
 destinationObserved(playback,destination){const binding=playbackBinding(playback,this.host.liveSnapshot,destination.accountId);return !!binding&&binding.accountId===destination.accountId&&binding.nativeRoomId===destination.nativeRoomId&&binding.nativeHomepodId===destination.nativeHomepodId;}
 settlementReceipt(includeTerminal=false){const feedback=this.feedback,receipt=feedback?.settlementReceipt,transport=this.host.liveTransport;return receipt&&feedback.outcome==='accepted'&&this.resultCurrent(receipt.ticket)&&receipt.transport===transport&&transport.connected&&receipt.transportGeneration===transport.generation&&(!feedback.settlementTuple||!this.host.liveMedia?.playback?.owner_epoch||feedback.settlementTuple.owner_epoch===this.host.liveMedia.playback.owner_epoch)&&this.host.liveSnapshot?.capabilities?.musicSelection===true&&this.host.liveSnapshot.capabilities.musicRead?.includes('playback')&&(includeTerminal||!['confirmed','rejected','superseded'].includes(feedback.settlementStatus))?receipt:null;}
 observePlayback(playback,receipt=null){const feedback=this.feedback;if(!this.context()){this.feedback=null;this.resultTicket=null;return false;}if(this.resultTicket&&!this.resultCurrent(this.resultTicket))return false;
  let settled=false;const settlement=playback?.settlement;
  if(receipt&&playback?.projectionVersion===3&&this.settlementReceipt()===receipt&&settlement?.requestId===receipt.requestId&&settlement.owner_epoch===playback.owner_epoch&&this.destinationObserved(playback,receipt.destination)&&(!feedback.settlementTuple||feedback.settlementTuple.request_id===settlement.request_id&&feedback.settlementTuple.command_sequence===settlement.command_sequence&&feedback.settlementTuple.owner_epoch===settlement.owner_epoch)){
   const status=settlement.status;if(feedback.settlementStatus!==status||!feedback.settlementTuple)try{receipt.transport?.recordDiagnostic?.('playback_confirmation',{code:['confirmed','rejected','superseded','unknown'].includes(status)?status:'other',domain:'music',requestId:receipt.requestId});}catch{}if(status==='confirmed'&&receipt.entry)receipt.entry.selectionConfirmed=true;
   // A terminal or unknown outcome allows a deliberate new choice through fresh authority.
   const entry = receipt.entry, catalogue = this.host.liveCatalogue;
   if (entry && entry === this.collectionEntry && catalogue?.entries.get(catalogue.key()) === entry
    && entry.actionDispatched) {
    if (['rejected', 'superseded', 'unknown'].includes(status)) entry.selectionSettlementStatus = status;
    else delete entry.selectionSettlementStatus;
   }
   this.feedback={...feedback,settlementStatus:status,settlementTuple:{request_id:settlement.request_id,command_sequence:settlement.command_sequence,owner_epoch:settlement.owner_epoch},pending:false,...(['rejected','superseded'].includes(status)?{awaitingObservation:false}:{}),message:status==='confirmed'?(feedback.displayObserved?'':'Anmodningen er modtaget · afventer observeret afspilning.'):status==='rejected'?'Afspilningen blev afvist af kilden.':status==='superseded'?'Afspilningen er afløst af en nyere handling.':status==='unknown'?'Kilden har endnu ikke bekræftet anmodningen. Handlingen gentages ikke.':feedback.displayObserved===true?'':'Anmodningen er modtaget · afventer bekræftelse fra kilden.'};settled=true;
  }
  // A later room observation owns display; it never confirms the request.
  const current=this.feedback;
  if(!current?.awaitingObservation||current.pending||!this.selectionItemObserved(playback,current))return settled;
  this.feedback={...current,awaitingObservation:false,...(current.outcome==='accepted'?{displayObserved:true,...(['Anmodningen er modtaget · afventer observeret afspilning.','Anmodningen er modtaget · afventer bekræftelse fra kilden.'].includes(current.message)?{message:''}:{})}:{})};
  return settled;
 }


 render(){const noteHidden=!!this.pending||!this.note.textContent;if(this.note.hidden!==noteHidden)this.note.hidden=noteHidden;const connected=!!this.context(),searchAllowed=connected&&this.host.liveSnapshot.capabilities.musicRead?.includes(this.collectionMode?this.source?.sourceKind:'search'),formHidden=!!this.collectionMode,panelLabel=this.collectionMode?'Vælg højttaler':'Søg efter musik',inputDisabled=!searchAllowed||!!this.pending,backHidden=!this.active&&!this.collectionMode,targetDisabled=!!this.pending||!!this.used||!this.source?.context||this.host.liveSnapshot?.capabilities.musicSelection!==true;
  if(this.form&&this.form.hidden!==formHidden)this.form.hidden=formHidden;if(this.panel.getAttribute?.('aria-label')!==panelLabel)this.panel.setAttribute?.('aria-label',panelLabel);if(this.panel.hidden!==!searchAllowed)this.panel.hidden=!searchAllowed;for(const node of [this.submit,this.input])if(node.disabled!==inputDisabled)node.disabled=inputDisabled;if(this.back.hidden!==backHidden)this.back.hidden=backHidden;if(!this.targetLabel.hidden)this.targetLabel.hidden=true;if(this.targetSelect.disabled!==targetDisabled)this.targetSelect.disabled=targetDisabled;
  if(this.collectionMode){this.host.liveCatalogue?.render();return;}if(!this.active)return;
  const pendingCurrent=(this.pending||this.feedback?.pending===true)&&connected&&typeof this.pendingCardId==='string'&&this.pendingCardSource===this.source&&this.pendingFeedbackScope===this.feedbackScope(),valid=!this.pending&&!this.used&&selectionCurrent(this.offer,this.host.liveSnapshot,this.account,this.source),cards=sourceMusicCards(this.source?.tracks||this.retainedTracks||[]).map((card,index)=>({...card,id:valid?this.offer.options[index].id:pendingCurrent&&index===this.pendingCardIndex?this.pendingCardId:card.id,optionIndex:index}));
  this.host.musicResults.render({cards:this.source||this.retainedTracks?cards:this.host.liveCatalogue?.cards||[],collection:this.host.liveCatalogue?.selected||'mood',heading:this.source?'Søgeresultater':'Din musik',status:this.intent?'':this.note.textContent,connected,pendingId:pendingCurrent?this.pendingCardId:null,busy:this.pending&&!this.intent,canRefresh:false,canChoose:!this.used&&!!this.source?.context&&(valid||this.targets.length>0)});
 }
 cleanup(){this.targetPrefetchPaused=this.targetReadScope();this.targetRead=null;this.invalidate('Forbindelsen mangler.');if(this.searchDialog?.open)this.searchDialog.close();clearTimeout(this.expiryTimer);}
}
