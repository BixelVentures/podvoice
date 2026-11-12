import {robotCurrentSetup,robotTransportOffer} from './home-model.js';
import {robotExperience} from './robot-observation.js';
import {scopedLightsObservation} from './ha-home-observation.js';
import {applyKitComponent,applyKitDialog,syncKitSlider} from './ui/kit.js';
import {RoomPlayerControls} from './room-player-controls.js';
import {controlTask,controlArgs} from './control-model.js';
import {roomObservationCurrent,roomObservationDisplay,roomObservationBound,playbackBinding,
 waitForMusicLane,releaseMusicLane} from './media-observation.js';
import './robot-control-panel.js';
const robotRebindReasons=new Set(['robot_deny_source_missing','robot_deny_source_domain','robot_deny_source_registered','robot_deny_source_consumed','robot_deny_source_token','robot_deny_source_deadline','robot_deny_source_setup','robot_deny_source_domain_access','robot_deny_source_binding','robot_deny_source_current_other','robot_deny_fresh_current','robot_deny_room','robot_deny_target','robot_deny_binding','robot_deny_rule','robot_deny_mutation','robot_deny_boot','robot_deny_device','robot_deny_authority','robot_deny_draft_identity','robot_deny_draft_scope','robot_deny_offer_presence_vacuum_transport_offer','robot_deny_offer_presence_dock_offer','robot_deny_offer_presence_settings_offer','robot_deny_offer_changed_vacuum_transport_offer','robot_deny_offer_changed_dock_offer','robot_deny_offer_changed_settings_offer','robot_deny_public_options','robot_deny_mapping_exception','robot_deny_other']);
const setupDiagnosticCodes=new Set(['invalid_setup','scope_not_paired','busy','invalid_target','target_not_granted','setup_capacity','stale_setup','setup_unavailable','invalid_dto','stale_binding']);
const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;if(tag==='button')applyKitComponent(n,'button',{variant:cls?.split(/\s+/).includes('pv-primary')?'primary':'secondary'});return n;};
// Restore focus only when one replacement has the same explicit accessible label.
// This never identifies an action for execution or reuses an expired option.
const robotFocusLabel=node=>{if(!node||!['BUTTON','INPUT','SELECT'].includes(node.tagName))return null;const explicit=node.getAttribute?.('aria-label'),label=typeof explicit==='string'&&explicit.trim()?explicit.trim():node.tagName==='BUTTON'?node.textContent?.trim():null;if(!label)return null;return JSON.stringify([node.tagName,node.type||'',label]);};
// Presentation-only client. All tickets, scopes and effect owners stay server-side.
export class LiveControlView{
 constructor(host){this.host=host;this.generation=0;this.opening=0;this.spent=new Map();this.receipts=new Map();this.dialog=make('dialog',undefined,'pv-component');const header=make('header'),title=make('h2','Betjening'),close=make('button','Luk','dialog-close');this.title=title;title.id='control-title';this.dialog.setAttribute('aria-labelledby',title.id);close.type='button';close.addEventListener('click',()=>this.dialog.close());header.append(title,close);this.note=make('p','', 'pv-meta');this.note.setAttribute('role','status');this.body=make('div',undefined,'pv-content');this.receiptNote=make('p','','pv-meta');this.receiptNote.setAttribute('role','status');this.receiptNote.hidden=true;this.dialog.append(header,this.note,this.receiptNote,this.body);applyKitDialog(this.dialog,{header,description:this.note,content:this.body,close});host.append(this.dialog);this.dialog.addEventListener('close',()=>{if(this.dialog.dataset?.presentationClose==='true'){delete this.dialog.dataset.presentationClose;return;}this.robotEntryKey=null;this.opening++;this.clearRobotRefresh();this.task=null;this.robotSuggestion=null;clearTimeout(this.expiryTimer);this.body.replaceChildren();this.robotPanel=null;this.body.setAttribute('aria-busy','false');if(this.opener?.isConnected)this.opener.focus();});
  this.musicButton=make('button','Betjen musik','text-control');this.musicButton.type='button';this.musicButton.addEventListener('click',()=>this.openMusic(this.musicButton));
  this.musicStatus=make('p');this.musicStatus.hidden=true;this.musicDetailStatus=this.musicStatus;
  for(const id of ['volume','detail-volume']){const input=document.getElementById(id);if(!input)continue;input.addEventListener('pointerdown',()=>{const gesture=this.host.playerView?.volumeGestures?.get(input);if(this.host.liveRadio?.ownsPlayer()||gesture&&(gesture.sourceKind!=='music'||!this.host.playerView.volumeGestureCurrent(gesture)))return;this.musicVolumeGesture=input;});input.addEventListener('input',()=>{
   const gesture=this.host.playerView?.volumeGestures?.get(input);if(this.host.liveRadio?.ownsPlayer()||gesture&&(gesture.sourceKind!=='music'||!this.host.playerView.volumeGestureCurrent(gesture)))return;
   const p=this.player.playback(),bounds=this.player.can('volume',p)?{min:0,max:p.controls.maxVolume??0}:null;
   if(input.disabled||!bounds)return;
   const attempted=Number(input.value);if(!Number.isInteger(attempted))return;const legal=Math.max(bounds.min,Math.min(bounds.max,attempted));this.musicVolumeGesture=input;
   if(legal!==attempted){input.value=String(legal);this.host.showFeedback?.(`Højst ${bounds.max} %`,false,{source:'music-volume'});}
   input.setAttribute('aria-valuetext',`${legal} %`);const output=document.getElementById(id==='volume'?'volume-value':'detail-volume-value');if(output)output.textContent=`${legal} %`;syncKitSlider(input);
  });for(const event of ['pointerup','pointercancel','change','blur'])input.addEventListener(event,()=>{if(this.musicVolumeGesture===input)this.musicVolumeGesture=null;});}
  this.robotButton=make('button','Betjen robot','text-control');this.robotButton.setAttribute('data-robot-control','true');this.robotButton.type='button';this.robotButton.addEventListener('click',()=>this.openRobot(this.robotButton));
 }
 controlOpen(){return this.dialog.open||this.domain==='vacuum'&&this.robotInline===true&&this.robotEntry?.hidden===false;}
 mountRobotInline(){if(!this.robotEntry){this.robotEntry=make('section',undefined,'device-history');this.robotEntry.dataset.robotRooms='true';this.robotEntry.dataset.detailZone='controls';}this.robotInline=true;this.robotEntry.hidden=false;const children=[this.note,this.receiptNote,this.body,this.robotButton];for(const [index,node]of children.entries()){const current=this.robotEntry.children[index];if(current!==node){if(typeof this.robotEntry.insertBefore==='function')this.robotEntry.insertBefore(node,current||null);else this.robotEntry.append(node);}}if(this.robotPanel){const card=this.host.deviceNodes?.get(this.target?.entityId);if(card){card.hidden=true;card.inert=true;card.parentNode.hidden=true;}this.note.hidden=true;this.robotButton.hidden=true;}}
 allowed(domain){return this.host.liveTransport?.connected&&this.host.liveSnapshot?.capabilities.controlSetup?.includes(domain);}
 render(){
  for(const entry of this.lightActions?.values()||[]){
   if(entry.operation&&!entry.operation.context.current())entry.operation.revoked=true;
   if(entry.feedback&&!entry.feedback.context.current())entry.feedback.revoked=true;
  }
  if(this.domain==='light'&&this.lightContext&&!this.lightContext.current()){this.lightContext=null;this.invalidate('Lysenes adgang eller område er ændret · hent betjeningen igen.',false);}
  const snapshot=this.host.liveSnapshot,authority=JSON.stringify([snapshot?.bootId,snapshot?.roomId,!!this.host.liveTransport?.connected]),robotAuthority=JSON.stringify([snapshot?.bootId,snapshot?.roomId,this.host.liveTransport?.generation,!!this.host.liveTransport?.connected,!!this.allowed('vacuum')]);
  const offlineDraft=this.robotOfflineDraftCurrent(this.expiredRobot)?this.expiredRobot:null;
  if(this.expiredRobot?.offline&&!offlineDraft)this.clearRobotRefresh();
  if(this.domain!=='light'&&this.authority!==undefined&&this.authority!==authority)this.invalidate('Adgangen eller forbindelsen er ændret · hent betjeningen igen.',false,false,offlineDraft);
  else if(this.domain==='vacuum'&&this.robotAuthority!==undefined&&(this.robotAuthority!==robotAuthority||this.robotAuthorityTransport!==this.host.liveTransport)){this.host.liveTransport?.recordDiagnostic?.('robot_renewal',{code:'robot_authority_changed'});this.invalidate('Robotbetjeningen er ændret · hent den igen.',false,true,offlineDraft);}
  this.robotAuthority=robotAuthority;this.robotAuthorityTransport=this.host.liveTransport;
  const robotTask = this.task?.domain === 'vacuum' ? this.task : null;
  const robotContext = this.robotControlOffer?.task === robotTask ? this.robotControlOffer?.context : null;
  if (robotTask && !this.robotControlCurrent(robotContext)) {
   // Retain the same form for display only during a transient robot read failure.
   const retainRobotForm = !this.pending && !this.setupPending && !this.activeOperation && !this.spent.has(robotTask.taskId)
    && this.robotPanel && this.robotControlCurrent(robotContext, {allowStale: true});
   if (!retainRobotForm && !this.robotTaskReceiptCurrent({allowTransientDock: true})) {
    this.host.liveTransport?.recordDiagnostic?.('robot_renewal',{code:'robot_offer_invalid'});
    this.invalidate('Robotbetjeningen er ændret · hent den igen.',false,true);
   }
  }
  this.authority=authority;const musicContext=this.musicContext(),musicAuthority=musicContext?.key??null,presentationAuthority=musicContext?.presentationKey??null;
  const pendingPlayback=this.host.liveMedia?.playback,pendingBinding=pendingPlayback?.roomBinding,pendingPresentation=!!playbackBinding(pendingPlayback,snapshot,this.host.liveMedia?.account)&&['playing','paused'].includes(pendingPlayback?.state)?JSON.stringify([snapshot.bootId,snapshot.roomId,this.host.liveTransport?.generation??null,pendingPlayback.config_entry_id,pendingPlayback.owner_epoch,pendingPlayback.target?.id,pendingBinding.bindingId,pendingBinding.nativeRoomId,pendingBinding.nativeHomepodId,pendingBinding.targetId]):null;
  const samePresentation=(!!musicContext&&this.musicPresentationAuthority===presentationAuthority||!!this.musicSettlementReceipt(true)||this.musicIntentPending&&this.musicOperation?.domain==='music'&&['pause','resume','next','previous','volume','seek'].includes(this.musicOperation.action)&&this.musicOperation.presentationKey===pendingPresentation||this.musicIntentPending&&this.musicOperation?.action==='move_existing_session'&&this.musicOperation.receiptTransport===this.host.liveTransport&&this.musicOperation.receiptTransportGeneration===this.host.liveTransport?.generation&&this.musicOperation.receiptGeneration===this.generation&&this.musicOperation.receiptMusicGeneration===(this.musicGeneration||0)&&this.musicOperation.receiptOwnerScope===JSON.stringify([snapshot?.capabilities?.musicRead,snapshot?.capabilities?.controlSetup?.includes('music')])&&roomObservationBound(pendingPlayback,snapshot,this.host.liveMedia?.account)&&pendingPlayback.config_entry_id===this.musicOperation.destination.accountId&&pendingBinding?.nativeRoomId===this.musicOperation.destination.nativeRoomId&&pendingBinding?.nativeHomepodId===this.musicOperation.destination.nativeHomepodId)&&this.musicPresentationTransport===this.host.liveTransport;
  if(this.musicAuthority!==undefined&&(this.musicAuthority!==musicAuthority||this.musicPresentationAuthority!==presentationAuthority||this.musicPresentationTransport!==this.host.liveTransport))this.invalidateMusic('Musikken er ændret · hent betjeningen igen.',false,samePresentation);
  this.musicAuthority=musicAuthority;this.musicPresentationAuthority=presentationAuthority;this.musicPresentationTransport=this.host.liveTransport;
  if(this.task&&this.task.expiresAt*1000<=Date.now())this.expireTask();
  const p=this.host.liveMedia?.playback,d=this.host.state.devices.find(x=>x.id===this.host.state.focus&&x.kind==='vacuum');this.musicButton.hidden=!this.allowed('music')||!roomObservationCurrent(p,snapshot);this.musicButton.disabled=!!this.musicIntentPending;this.robotButton.hidden=!d?.live;this.robotButton.disabled=!!(this.pending||this.setupPending);const robotEntryLabel=this.allowed('vacuum')&&!d?.stale?'Betjen robot':'Se robot';if(this.robotButton.textContent!==robotEntryLabel)this.robotButton.textContent=robotEntryLabel;
  if(d&&!d.stale){const activity=robotExperience(d).activity,key=JSON.stringify([d.id,d.status,activity]);this.robotObservedId=d.id;this.robotObservedState=key;this.robotObservedStatus=d.status;}const robotCard=d&&this.host.deviceNodes?.get(d.id);if(robotCard&&this.robotInline&&this.domain==='vacuum'&&this.target?.entityId!==d.id){this.opening++;if(this.expiredRobot?.offline)this.clearRobotRefresh();this.robotDeferredDraft=null;this.task=null;this.robotSuggestion=null;this.target={entityId:d.id};this.buildOptions();}if(robotCard){if(!this.robotEntry){this.robotEntry=make('section',undefined,'device-history');this.robotEntry.dataset.robotRooms='true';this.robotEntry.dataset.detailZone='controls';this.robotEntry.append(this.robotButton);}if(this.robotEntry.parentNode!==robotCard.parentNode.parentNode)robotCard.parentNode.after(this.robotEntry);this.robotEntry.hidden=false;}else if(this.robotEntry)this.robotEntry.hidden=true;if(robotCard&&robotCard.dataset.controlEntry!=='true')robotCard.dataset.controlEntry='true';
  if(this.robotPanel&&(this.dialog.open||this.robotInline)&&this.domain==='vacuum'){const device=this.robotDevice(),ready=!!(this.controlOpen()&&this.task&&this.task.draft?.status!=='awaiting_water'&&!this.pending&&!this.setupPending&&!this.spent.has(this.task.taskId)&&this.allowed('vacuum')&&device?.live===true&&!device.stale);this.robotPanel.observed?.(this.robotView(device),{currentSetup:this.currentRobotSetup(device),loading:this.setupPending,connected:!!this.host.liveTransport?.connected,pendingOptionId:this.pending&&this.activeOperation?.domain==='vacuum'&&this.activeOperation.taskId===this.task?.taskId?this.activeOperation.optionId:null,pendingChoiceId:this.pending&&this.activeOperation?.domain==='vacuum'&&this.activeOperation.taskId===this.task?.taskId?this.activeOperation.choiceId??null:null,pendingValue:this.pending&&this.activeOperation?.domain==='vacuum'&&this.activeOperation.taskId===this.task?.taskId?this.activeOperation.value??null:null,directActions:this.robotDirectOffer(device)?.actions||[],directReadGap:this.robotTransientHomeRead(device),directBlocked:this.robotDirectBlocked(device),directPendingAction:this.robotDirectOffer(device)?.pending??null});this.robotPanel.disabled=!ready;const candidates=ready?[this.robotSuggestion,...(Array.isArray(snapshot.robotSuggestions)&&snapshot.robotSuggestions.length<=12?snapshot.robotSuggestions:[])]:[];this.robotPanel.suggest?.(candidates.find(value=>this.robotPanel.validSuggestion?.(value)));}
  if(this.robotInline&&d){this.robotButton.hidden=!!(this.robotPanel||this.task||this.setupPending);if(robotCard&&this.robotPanel){robotCard.hidden=true;robotCard.inert=true;robotCard.parentNode.hidden=true;}}
  if(this.refreshButton)this.refreshButton.disabled=!this.canRefreshRobot();
  this.renderReceipt();this.renderMusicControls();
  if(!this.suspending&&robotCard&&!this.dialog.open&&!this.pending&&!this.setupPending&&![...this.receipts.values()].some(row=>row.bootId===snapshot?.bootId&&row.roomId===snapshot?.roomId&&row.domain==='vacuum'&&row.target?.entityId===d.id&&this.robotReceiptUnknown(row))){const key=JSON.stringify([snapshot?.bootId,snapshot?.roomId,d.id,d.status,!!this.allowed('vacuum'),!!d.stale]);const observedAfterAcceptance=this.robotAwait?.target?.entityId===d.id&&this.robotAwait.bootId===snapshot?.bootId&&this.robotAwait.roomId===snapshot?.roomId&&Number.isFinite(d.revision)&&d.revision>this.robotAwait.observedRevision;if(this.robotEntryKey!==key||observedAfterAcceptance){this.robotEntryKey=key;this.robotAwait=null;this.openRobot(this.robotButton);}}else if(!robotCard)this.robotEntryKey=null;
 }
 receiptText(row){if(row.domain==='music'){if(row.outcome==='unknown'||row.settlementStatus==='unknown')return 'Kunne ikke bekræfte ændringen. Tjek afspilleren.';if(row.outcome==='rejected'||row.settlementStatus==='rejected')return 'Ændringen blev ikke gennemført. Prøv igen.';if(row.settlementStatus==='confirmed')return ({pause:'Musikken er sat på pause.',resume:'Afspilningen er startet.',next:'Skiftet til næste nummer.',previous:'Skiftet til forrige nummer.',volume:'Lydstyrken er ændret.',move_existing_session:'Højttaleren er skiftet.'})[row.action]||'Ændringen er bekræftet.';if(row.settlementStatus==='superseded')return 'Et nyere valg har erstattet ændringen.';if(row.outcome==='accepted')return 'Venter på højttaleren…';}if(row.outcome==='accepted'&&row.settlementStatus)return row.settlementStatus==='confirmed'?'Handlingen er bekræftet af kilden.':row.settlementStatus==='rejected'?'Handlingen blev afvist af kilden.':row.settlementStatus==='superseded'?'Handlingen er afløst af en nyere handling.':row.settlementStatus==='unknown'?'Udfaldet er ukendt · handlingen gentages ikke.':'Anmodningen er modtaget · afventer bekræftelse.';if(row.partial&&row.outcome!=='accepted')return 'Nogle indstillinger blev ændret. Rengøringen er ikke bekræftet startet.'+(row.outcome==='unknown'?' Udfaldet er ukendt · handlingen gentages ikke.':'');return row.outcome==='accepted'?'Anmodningen er modtaget.':row.outcome==='unknown'?'Udfaldet er ukendt · handlingen gentages ikke.':row.outcome==='pending'?(row.domain==='vacuum'?'Sender anmodning…':''):'Handlingen blev afvist.';}
 remember(operation,outcome,requestId,details){
  try{this.host.liveTransport?.recordDiagnostic?.('control_action',{code:['accepted','unknown','rejected'].includes(outcome)?outcome:'start',requestId,pending:outcome==='pending'});}catch{/* Journal failure cannot prevent receipt custody. */}const row={...operation,outcome,requestId,...(operation.domain==='vacuum'?{...(typeof details?.partial==='boolean'?{partial:details.partial}:{}),...(Number.isInteger(details?.completedSteps)&&details.completedSteps>=0&&details.completedSteps<=64?{completedSteps:details.completedSteps}:{}),...(typeof details?.startSent==='boolean'?{startSent:details.startSent}:{})}:{})};this.receipts.delete(operation.key);this.receipts.set(operation.key,row);
  while(this.receipts.size>16)this.receipts.delete(this.receipts.keys().next().value);
  if(this.host.isConnected)this.renderReceipt();
 }
 renderReceipt(){
  const s=this.host.liveSnapshot,target=JSON.stringify(this.target),row=[...this.receipts.values()].reverse().find(r=>r.bootId===s?.bootId&&r.roomId===s?.roomId&&r.domain===this.domain&&JSON.stringify(r.target)===target);
  const visible=!!(row&&row.outcome!=='pending'),text=visible?`${row.label}: ${this.receiptText(row)}`:'',inline=this.domain==='vacuum'&&this.robotInline&&typeof this.robotPanel?.observed==='function';this.receiptNote.hidden=!visible||inline;this.receiptNote.textContent=inline?'':text;this.note.hidden=inline||!!(row?.domain==='vacuum');if(inline){
   const controlFeedback=this.task?.draft?.status==='awaiting_water'
    ?{text:'Dine valg er bevaret. Start afventer en aktuel vandstatus.',state:'unknown'}
    :visible?{text,state:row.outcome==='rejected'?'error':row.outcome}:null;
   this.robotPanel.observed(this.robotView(this.robotDevice()),{controlFeedback});
  }if(this.domain==='vacuum')for(const button of this.robotPanel?.querySelectorAll?.('button')||[]){const busy=!!(row?.outcome==='pending'&&this.pending&&this.activeOperation?.key===row.key&&button.dataset.controlOptionId===row.optionId);const family=button.dataset.kit;if(button.dataset.controlOptionId&&button.dataset.directRobot!=='true'&&['button','chip','tile','toggle'].includes(family))applyKitComponent(button,family,{feedback:'progress',loading:busy});}
 }
 invalidateMusic(message='Musikken er ændret · hent betjeningen igen.',render=true,preservePresentation=false){
  if(!preservePresentation){clearTimeout(this.musicSettlementTimer);this.musicSettlementTimer=null;}
  // Music observations cannot revoke a different domain's task or async owner.
  const presentationKey=preservePresentation?this.musicContext()?.presentationKey:null,p=this.host.liveMedia?.playback,s=this.host.liveSnapshot,b=p?.roomBinding,receiptPresentationKey=presentationKey??(!!playbackBinding(p,s,this.host.liveMedia?.account)&&['playing','paused'].includes(p?.state)?JSON.stringify([s.bootId,s.roomId,this.host.liveTransport?.generation??null,p.config_entry_id,p.owner_epoch,p.target?.id,b.bindingId,b.nativeRoomId,b.nativeHomepodId,b.targetId]):null);
  this.musicGeneration=(this.musicGeneration||0)+1;
  const operation=this.musicOperation;
  if(this.musicIntentPending&&operation?.domain==='music'){if(preservePresentation&&(operation.presentationKey===receiptPresentationKey||operation.action==='move_existing_session'&&operation.receiptTransport===this.host.liveTransport&&operation.receiptTransportGeneration===this.host.liveTransport?.generation&&operation.receiptGeneration===this.generation&&operation.receiptOwnerScope===JSON.stringify([s?.capabilities?.musicRead,s?.capabilities?.controlSetup?.includes('music')])&&roomObservationBound(p,s,this.host.liveMedia?.account)&&p.config_entry_id===operation.destination.accountId&&b?.nativeRoomId===operation.destination.nativeRoomId&&b?.nativeHomepodId===operation.destination.nativeHomepodId)&&['pause','resume','next','previous','volume','seek','move_existing_session'].includes(operation.action)&&operation.receiptMusicGeneration===(this.musicGeneration||0)-1)operation.receiptMusicGeneration=this.musicGeneration;else{this.remember(operation,'unknown');if(operation.action==='move_existing_session'&&this.musicFence)this.moveUnknownFence={bootId:this.musicFence.bootId,roomId:this.musicFence.roomId,accountId:this.musicFence.target.accountId,ownerEpoch:this.musicFence.ownerEpoch,pollSequence:this.musicFence.pollSequence};if(this.musicFence)this.musicFence={...this.musicFence,outcome:'unknown'};}}
  else if(this.musicFence?.outcome!=='unknown'&&!(preservePresentation&&this.musicSettlementReceipt(true)))this.musicFence=null;
  if(this.task?.domain==='music'||(!this.task&&this.dialog.open&&this.domain==='music'&&!this.musicIntentPending))this.invalidate(message,false);
  if(render)this.render();
 }
 robotOfflineDraftCurrent(context){
  const {liveSnapshot:snapshot,liveTransport:transport}=this.host;
  const current=transport?.snapshot??snapshot;
  return context?.offline===true&&!!transport&&context.transport===transport&&!transport.recoveryBlocked&&
   this.domain==='vacuum'&&JSON.stringify(this.target)===context.target&&this.robotDevice()?.live===true&&
   [snapshot,current].every(s=>s?.bootId===context.bootId&&s.roomId===context.roomId&&
    s.capabilities?.controlSetup?.includes('vacuum'))&&
   !this.pending&&!this.activeOperation&&!this.robotOverviewOperation&&
   !this.spent.has(context.taskId)&&!this.spent.has(context.draft.taskId)&&
   ![...this.receipts.values()].some(row=>row.bootId===context.bootId&&row.roomId===context.roomId&&
    row.domain==='vacuum'&&JSON.stringify(row.target)===context.target&&this.robotReceiptUnknown(row));
 }
 connectionLost(){
  const task=this.task,expired=this.expiredRobot;
  let context=expired?.draft?{...expired,offline:true}:null;
  if(task?.domain==='vacuum'&&this.robotControlOffer?.task===task){
   const draft=this.readRobotDraft(task,this.robotPanel);
   if(draft)context={offline:true,bootId:task.bootId,roomId:task.roomId,taskId:task.taskId,
    target:JSON.stringify(this.target),transport:this.robotControlOffer.context?.transport,
    draft,modeDrafts:this.robotPanel?.readModeDrafts?.()??null};
  }
  this.invalidate(undefined,true,false,this.robotOfflineDraftCurrent(context)?context:null);
 }
 restoreOfflineRobotDraft(context){
  if(this.robotOfflineDraftCurrent(context))this.setRobotRefresh({
   ...context,generation:this.generation,opening:this.opening,
   transportGeneration:this.host.liveTransport.generation,
  });
 }
 invalidate(message='Forbindelsen mangler · hent betjeningen igen.',render=true,robotOnly=false,offlineDraft=null){
   this.robotDeferredDraft=null;
  if(robotOnly){
   this.clearRobotRefresh();clearTimeout(this.robotOverviewExpiry);clearTimeout(this.robotOverviewRenewal);clearTimeout(this.expiryTimer);this.robotOverviewOffer=null;this.robotOverviewRead=null;this.robotOverviewAttempt=null;this.robotEntryKey=null;this.robotAwait=null;this.opening++;this.task=null;this.robotControlOffer=null;this.robotSuggestion=null;this.body.setAttribute('aria-busy','false');
   const operation=this.activeOperation?.domain==='vacuum'?this.activeOperation:null;
   if(operation){this.remember(operation,'unknown');this.robotOverviewFence={bootId:operation.bootId,roomId:operation.roomId,entityId:operation.target.entityId,outcome:'unknown'};}
   // In-flight custody stays held until its original await settles; a new
   // domain cannot start and then be cleared by the old operation's finally.
   if(this.controlOpen())this.note.textContent=message;const device=this.robotDevice();this.robotPanel?.observed?.(this.robotView(device),{connected:!!this.host.liveTransport?.connected,directActions:this.robotDirectOffer(device)?.actions||[],directReadGap:this.robotTransientHomeRead(device),directBlocked:this.robotDirectBlocked(device),directPendingAction:this.robotDirectOffer(device)?.pending??null});for(const el of this.body.querySelectorAll('button,input,select'))if(!this.robotPanel?.contains?.(el))el.disabled=true;if(this.robotPanel)this.robotPanel.disabled=true;this.restoreOfflineRobotDraft(offlineDraft);if(render)this.render();return;
  }
  this.player.invalidate();
  clearTimeout(this.musicSettlementTimer);this.musicSettlementTimer=null;clearTimeout(this.robotReadTimer);this.robotReadTimer=null;
  this.musicPresentationAuthority=null;this.musicPresentationTransport=null;this.clearRobotRefresh();clearTimeout(this.robotOverviewExpiry);clearTimeout(this.robotOverviewRenewal);this.robotOverviewOffer=null;this.robotOverviewRead=null;this.robotOverviewAttempt=null;if(this.robotOverviewOperation){this.remember(this.robotOverviewOperation,'unknown');this.robotOverviewFence={bootId:this.robotOverviewOperation.bootId,roomId:this.robotOverviewOperation.roomId,entityId:this.robotOverviewOperation.target.entityId,outcome:'unknown'};}this.musicGeneration=(this.musicGeneration||0)+1;this.generation++;this.opening++;this.body.setAttribute('aria-busy','false');this.task=null;this.robotControlOffer=null;this.robotSuggestion=null;clearTimeout(this.expiryTimer);
  if(this.musicIntentPending&&this.musicFence)this.musicFence={...this.musicFence,outcome:'unknown'};
  if(this.pending&&this.activeOperation){this.remember(this.activeOperation,'unknown');this.note.textContent='Forbindelsen blev afbrudt · handlingen gentages ikke.';}else if(this.controlOpen())this.note.textContent=message;
  for(const el of this.body.querySelectorAll('button,input,select'))el.disabled=true;if(this.robotPanel)this.robotPanel.disabled=true;this.restoreOfflineRobotDraft(offlineDraft);if(render)this.render();
 }
 musicContext(recovery=false){
  const p=this.host.liveMedia?.playback,s=this.host.liveSnapshot;
  if(this.suspending||!this.host.isConnected||!(this.allowed('music')||recovery&&this.host.liveTransport?.connected&&s?.capabilities?.musicMoveRecovery?.includes(p?.config_entry_id)===true)||!roomObservationCurrent(p,s)||!p?.target?.id||!['playing','paused'].includes(p.state)||typeof p.config_entry_id!=='string'||!p.config_entry_id||typeof p.owner_epoch!=='string'||!p.owner_epoch)return null;
  const binding=playbackBinding(p,s,p.config_entry_id);if(!binding)return null;
  const target={accountId:p.config_entry_id,kind:'spotify_device',targetId:p.target.id,expectedBindingId:binding.bindingId};
  const key=JSON.stringify([s.bootId,s.roomId,p.config_entry_id,p.owner_epoch,p.target.id,binding.bindingId,binding.nativeRoomId,binding.nativeHomepodId,binding.targetId]);
  const presentationKey=JSON.stringify([s.bootId,s.roomId,this.host.liveTransport.generation??null,p.config_entry_id,p.owner_epoch,p.target.id,binding.bindingId,binding.nativeRoomId,binding.nativeHomepodId,binding.targetId]);
  return {key,presentationKey,target,binding,pollSequence:p.poll_sequence,bootId:s.bootId,roomId:s.roomId,ownerEpoch:p.owner_epoch,recovery:recovery&&!this.allowed('music')};
 }
 moveUnknownApplies(context=this.musicContext()){const f=this.moveUnknownFence;return !!(f&&context&&f.bootId===context.bootId&&f.roomId===context.roomId&&f.accountId===context.target.accountId&&f.ownerEpoch===context.ownerEpoch&&!(this.host.liveMedia?.playback?.projectionVersion===3&&Number.isFinite(context.pollSequence)&&Number.isFinite(f.pollSequence)&&context.pollSequence>f.pollSequence));}
 // Player taps go to the room player (room-player-controls.js); only a speaker move uses the lane.
 get player(){return this.roomPlayer??=new RoomPlayerControls(this.host);}
 musicUnknownBlocks(){return false;}
 optimisticPlaying(observed){return this.player.optimisticPlaying(observed);}
 musicSeekState(trackUri){return this.player.seekState(trackUri);}
 observePlayer(playback){this.player.observe(playback);}
 playerStatus(){return this.player.status;}
 musicSettlementReceipt(includeTerminal=false){
  const fence=this.musicFence,receipt=fence?.settlementReceipt,context=this.musicContext(),snapshot=this.host.liveSnapshot,transport=this.host.liveTransport,playback=this.host.liveMedia?.playback,binding=playback?.roomBinding;
  // Receipt read custody may outlive the old observation's TTL. It never
  // provides fresh controls; replacement playback must still pass the parser.
  const presentationKey=context?.presentationKey??(this.host.isConnected&&this.allowed('music')&&!!playbackBinding(playback,snapshot,this.host.liveMedia?.account)&&['playing','paused'].includes(playback?.state)?JSON.stringify([snapshot.bootId,snapshot.roomId,transport?.generation??null,playback.config_entry_id,playback.owner_epoch,playback.target?.id,binding.bindingId,binding.nativeRoomId,binding.nativeHomepodId,binding.targetId]):null);
  if(!receipt||fence.outcome!=='accepted'||!(receipt.presentationKey===presentationKey||receipt.kind==='move'&&roomObservationBound(playback,snapshot,this.host.liveMedia?.account)&&playback.config_entry_id===receipt.destination.accountId&&binding?.nativeRoomId===receipt.destination.nativeRoomId&&binding?.nativeHomepodId===receipt.destination.nativeHomepodId)||receipt.transport!==transport||receipt.transportGeneration!==transport?.generation||receipt.generation!==this.generation||receipt.kind==='move'&&this.receipts.get(receipt.operationKey)?.settlementOwnerEpoch&&this.receipts.get(receipt.operationKey).settlementOwnerEpoch!==playback?.owner_epoch||receipt.ownerScope!==JSON.stringify([snapshot?.capabilities?.musicRead,snapshot?.capabilities?.controlSetup?.includes('music')])||this.receipts.get(receipt.operationKey)?.requestId!==receipt.requestId||this.receipts.get(receipt.operationKey)?.outcome!=='accepted'||!includeTerminal&&['confirmed','rejected','superseded','unknown'].includes(fence.settlementStatus))return null;
  return receipt;
 }
 // A move is settled when the room read shows the music on the chosen speaker.
 observeMusicSettlement(playback,receipt,capturedRead=false){
  if(!receipt||receipt.kind!=='move'||this.musicSettlementReceipt()!==receipt)return false;
  const b=playbackBinding(playback,this.host.liveSnapshot,receipt.destination.accountId);
  if(!b||b.nativeRoomId!==receipt.destination.nativeRoomId||b.nativeHomepodId!==receipt.destination.nativeHomepodId)return false;
  const row=this.receipts.get(receipt.operationKey);
  this.host.liveTransport?.recordDiagnostic?.('playback_confirmation',{domain:'music',action:receipt.action,requestId:receipt.requestId,code:'confirmed'});
  this.receipts.set(receipt.operationKey,{...row,settlementStatus:'confirmed'});
  this.musicFence={...this.musicFence,settlementStatus:'confirmed'};
  clearTimeout(this.musicSettlementTimer);this.musicSettlementTimer=null;
  releaseMusicLane(this,'free');this.renderReceipt();return true;
 }
 scheduleMusicSettlementDeadline(receipt){
  clearTimeout(this.musicSettlementTimer);
  this.musicSettlementTimer=setTimeout(()=>{
   this.musicSettlementTimer=null;
   if(this.musicFence?.settlementReceipt!==receipt||this.musicFence.outcome!=='accepted'||['confirmed','rejected','superseded','unknown'].includes(this.musicFence.settlementStatus))return;
   const row=this.receipts.get(receipt.operationKey);if(row)this.receipts.set(receipt.operationKey,{...row,settlementStatus:'unknown'});
   this.musicFence={...this.musicFence,outcome:'unknown',settlementStatus:'unknown'};delete this.musicFence.volumeDraft;
   releaseMusicLane(this, 'unknown');
   if(receipt.kind==='move'&&receipt.choice&&this.host.liveOutputs?.pendingChoice===receipt.choice)this.host.liveOutputs.pendingChoice=null;
   this.host.liveTransport?.recordDiagnostic?.('control_action',{domain:'music',action:receipt.action,requestId:receipt.requestId,code:'unknown'});
   if(this.host.isConnected){this.renderMusicControls();this.host.liveOutputs?.sync();}
  },30000);this.musicSettlementTimer.unref?.();
 }
 musicCurrent(context){return !!context&&this.musicContext(context.recovery===true)?.key===context.key;}
 // A queue choice holds the lane without being a transport operation. It opts in,
 // so transport taps made meanwhile are queued instead of dropped (K3, A9).
 beginMusicIntent({queuesTransport=false}={}){
  if(this.musicIntentPending)return null;
  this.musicIntentQueuesTransport=queuesTransport===true;
  clearTimeout(this.musicSettlementTimer);this.musicSettlementTimer=null;
  if(this.musicFence?.outcome==='accepted')this.musicFence=null;
  if(this.host.liveSelection?.feedback?.settlementReceipt)this.host.liveSelection.feedback={...this.host.liveSelection.feedback,settlementReceipt:null,awaitingObservation:false};
  const selectionFeedback=this.host.liveSelection?.feedback;if(selectionFeedback?.outcome==='accepted'&&['Anmodningen er modtaget · afventer observeret afspilning.','Anmodningen er modtaget · afventer bekræftelse fra kilden.'].includes(selectionFeedback.message))this.host.liveSelection.feedback={...selectionFeedback,message:'',awaitingObservation:false};
  const token={};this.musicIntentOwner=token;this.musicIntentPending=true;
  this.musicGeneration=(this.musicGeneration||0)+1;
  this.host.liveMedia?.queueControls?.invalidate(false);this.host.liveMedia?.queueControls?.redraw?.();if(this.host.liveMedia)this.host.liveMedia.queueReadKey=null;if(this.host.liveSelection)this.host.liveSelection.offer=null;
  return token;
 }
 endMusicIntent(token,outcome){
  if(!token||this.musicIntentOwner!==token)return;this.musicIntentOwner=null;this.musicIntentPending=false;
  this.musicIntentQueuesTransport=false;
  // A choice waiting in waitForMusicLane gets its turn; after UNKNOWN it is not sent.
  releaseMusicLane(this, outcome === 'unknown' ? 'unknown' : 'free');
  if(this.host.isConnected){this.renderMusicControls();this.host.liveOutputs?.sync();}
 }
 // An in-flight operation keeps its spent marker until it settles, even past offer expiry;
 // otherwise any unrelated refresh (e.g. a music push) would turn a running Start into UNKNOWN.
 pruneSpent(){const active=this.pending?this.activeOperation?.taskId:null;for(const[id,expiry]of this.spent)if(id!==active&&expiry*1000<=Date.now())this.spent.delete(id);}
 renderMusicControls(){
  if(this.host.liveRadio?.pendingStart?.()&&this.host.liveRadio?.presentsPlayer?.()!==false
   ||this.host.liveRadio?.ownsPlayer()){
   this.host.liveRadio.renderControls();
   return;
  }
  const {transport,canVolume}=this.player.render();
  const status=this.player.status;
  for(const node of [this.musicStatus,this.musicDetailStatus]){node.hidden=!status;node.textContent=status;}
  if(transport||canVolume)this.musicButton.hidden=true;
  this.host.setAttribute('data-native-music-controls',transport||canVolume?'true':'false');
 }
 async moveSpeaker(speaker,catalogueCurrent=()=>false,choice=null){
  const transport=this.host.liveTransport,requestId=globalThis.crypto.randomUUID(),issuedAt=Date.now(),action='move_existing_session',diagnostic={domain:'music',action,requestId};
  transport?.recordDiagnostic?.('control_intent',{...diagnostic,code:'start'});
  const reject=code=>{transport?.recordDiagnostic?.('control_intent',{...diagnostic,code});return false;};
  const context=this.musicContext(true),snapshot=this.host.liveSnapshot,binding=context?.binding;
  if(!context||!binding||!catalogueCurrent()||this.moveUnknownApplies(context)||this.musicUnknownBlocks(context))return reject('scope_changed');
  
  // A move chosen while another music action runs, or before its effect is settled, waits for it (H1).
  const fence = this.musicFence;
  const unsettled = fence?.key === context.key && fence.outcome === 'accepted'
   && !['confirmed', 'rejected', 'superseded'].includes(fence.settlementStatus);
  if (this.musicIntentPending || unsettled) {
   const generation = this.generation;
   const turn = await waitForMusicLane(this, true);
   if (turn === 'free') {
    if (this.host.liveTransport !== transport || this.generation !== generation
     || this.musicContext(true)?.presentationKey !== context.presentationKey) return reject('scope_changed');
    return this.moveSpeaker(speaker, catalogueCurrent, choice);
   }
   if (turn === 'unknown') {
    const message = 'Den forrige handling kunne ikke bekræftes · højttaleren blev ikke skiftet.';
    this.host.showFeedback?.(message, false, {source: 'music-intent'});
   }
   return reject('intent_pending');
  }
  
  if(speaker?.kind!=='configured_alias'||speaker.accountId!==context.target.accountId||!/^[a-f0-9]{64}$/.test(speaker.speakerId)||speaker.selectable!==true||speaker.availability!=='available'||typeof speaker.nativeRoomId!=='string'||!speaker.nativeRoomId||typeof speaker.homepodId!=='string'||!/^[1-9][0-9]{0,19}$/.test(speaker.homepodId)||speaker.nativeRoomId===binding.nativeRoomId&&speaker.homepodId===binding.nativeHomepodId)return reject('invalid_target');
  const token=this.beginMusicIntent();if(!token)return reject('intent_pending');
  const destination=Object.freeze({accountId:speaker.accountId,nativeRoomId:speaker.nativeRoomId,nativeHomepodId:speaker.homepodId}),ownerScope=JSON.stringify([snapshot?.capabilities?.musicRead,snapshot?.capabilities?.controlSetup?.includes('music')]),generation=this.generation,musicGeneration=this.musicGeneration||0,transportGeneration=transport.generation;
  const operation={key:context.bootId+':'+requestId,bootId:context.bootId,roomId:context.roomId,domain:'music',target:{...context.target,speakerId:speaker.speakerId},label:'Skift højttaler',action,presentationKey:context.presentationKey,destination,receiptTransport:transport,receiptTransportGeneration:transportGeneration,receiptGeneration:generation,receiptOwnerScope:ownerScope,receiptMusicGeneration:musicGeneration};
  this.musicOperation=operation;const focusTicket=this.host.playerView?.beginSourceFocus?.('music',destination);this.musicFence={...context,action,outcome:'pending'};this.remember(operation,'pending',requestId);this.renderMusicControls();this.host.liveOutputs?.sync();
  const current=()=>{const p=this.host.liveMedia?.playback,s=this.host.liveSnapshot,b=p?.roomBinding;return generation===this.generation&&operation.receiptMusicGeneration===(this.musicGeneration||0)&&this.host.isConnected&&transport.connected&&this.host.liveTransport===transport&&transport.generation===transportGeneration&&ownerScope===JSON.stringify([s?.capabilities?.musicRead,s?.capabilities?.controlSetup?.includes('music')])&&(this.musicCurrent(context)||roomObservationBound(p,s,this.host.liveMedia?.account)&&p.config_entry_id===destination.accountId&&b?.nativeRoomId===destination.nativeRoomId&&b?.nativeHomepodId===destination.nativeHomepodId);};
  try{
   const promise=transport.controlIntent({bootId:context.bootId,roomId:context.roomId,action,target:operation.target,args:{},requestId,issuedAt});try{this.host.ownerDocument?.getElementById('rooms')?.close();}catch{}
   const result=await promise;this.remember(operation,result.outcome,requestId);
   if(result.outcome==='unknown')this.moveUnknownFence={bootId:context.bootId,roomId:context.roomId,accountId:context.target.accountId,ownerEpoch:context.ownerEpoch,pollSequence:context.pollSequence};
   if(!current()){transport.recordDiagnostic?.('control_action',{...diagnostic,code:'scope_changed',current:false});return true;}
   this.musicFence={...context,action,outcome:result.outcome};
   if(result.outcome==='accepted'&&this.host.liveMedia?.playback?.projectionVersion===3){this.musicFence.settlementReceipt=Object.freeze({kind:'move',choice,requestId,operationKey:operation.key,action,presentationKey:context.presentationKey,destination,origin:Object.freeze({nativeRoomId:binding.nativeRoomId,nativeHomepodId:binding.nativeHomepodId}),transport,transportGeneration,generation,ownerScope});this.scheduleMusicSettlementDeadline(this.musicFence.settlementReceipt);void Promise.resolve().then(()=>current()?this.host.liveMedia?.refresh?.({immediate:true}):undefined).catch(()=>{});}
   return true;
  }catch{this.remember(operation,'unknown',requestId);this.moveUnknownFence={bootId:context.bootId,roomId:context.roomId,accountId:context.target.accountId,ownerEpoch:context.ownerEpoch,pollSequence:context.pollSequence};if(current())this.musicFence={...context,action,outcome:'unknown'};return true;}
  finally{this.host.playerView?.finishSourceFocus?.(focusTicket,this.musicFence?.outcome);if(this.musicOperation===operation)this.musicOperation=null;this.endMusicIntent(token,this.musicFence?.outcome);if(this.host.isConnected){this.renderMusicControls();this.host.liveOutputs?.sync();}}
 }
 // An explicit tap is one direct room player call, queued behind a running one, never replayed.
 musicIntent(action,input={}){
  if(!['pause','resume','next','previous','volume','seek'].includes(action))return Promise.resolve(false);
  return this.player.intent(action,input);
 }
 journalDevice(transport,stage,fields){try{transport?.recordDiagnostic?.(stage,fields);}catch{/* Diagnostics never own dispatch or presentation. */}}
 vehicleJournalValue(action,args={},actual){
  const levels={off:0,low:1,medium:2,high:3};let value;args=args&&typeof args==='object'?args:{};
  if(actual!==undefined){if(['lock','unlock'].includes(action))value=actual?.locked;else if(['climateOn','climateOff'].includes(action))value=actual?.climate?.status==='heat_cool'?true:actual?.climate?.status==='off'?false:undefined;else if(action==='temperature')value=actual?.climate?.targetTemperatureC;else if(['defrostOn','defrostOff'].includes(action))value=actual?.climate?.defrost;else if(action==='driverSeatHeat')value=levels[actual?.climate?.driverSeatHeat];else if(action==='passengerSeatHeat')value=levels[actual?.climate?.passengerSeatHeat];else if(action==='rearTrunkToggle')value=actual?.access?.rearTrunk==='open'?true:actual?.access?.rearTrunk==='closed'?false:undefined;}
  else if(['lock','climateOn','defrostOn'].includes(action))value=true;else if(['unlock','climateOff','defrostOff'].includes(action))value=false;else if(action==='temperature')value=args.temperature;else if(['driverSeatHeat','passengerSeatHeat'].includes(action))value=levels[args.option];else if(action==='rearTrunkToggle')value=args.direction==='open'?true:args.direction==='closed'?false:undefined;
  return typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=86400?value:undefined;
 }
 trackDeviceJournal(domain,operation,requestId,requestedValue,resourceId,current){
  try{if(typeof requestId!=='string'||!requestId)return;const h=this.host,t=h.liveTransport,s=h.liveSnapshot;
  // Bounded metadata for existing reads only; never consulted by action guards.
  this.deviceJournalPending=[...(this.deviceJournalPending||[]).filter(row=>row.until>Date.now()),{domain,action:operation.action,requestId,requestedValue,resourceId,current,transport:t,generation:t.generation,boot:s.bootId,room:s.roomId,after:Date.now()/1000,until:Date.now()+30000,target:operation.target,settingKey:operation.settingKey,observedRevision:operation.observedRevision}].slice(-16);
  }catch{/* Optional journal metadata cannot change an outcome. */}
 }
 observeDeviceJournal(home){try{
  const h=this.host,s=h.liveSnapshot,t=h.liveTransport,keep=[];
  for(const row of this.deviceJournalPending||[]){if(row.transport!==t||row.generation!==t.generation||row.boot!==s?.bootId||row.room!==s?.roomId||Date.now()>row.until||!row.current())continue;
   let value,ready=false,fresh=false;
   if(row.domain==='vehicle'&&home.vehicleBinding===row.resourceId&&home.vehicle&&home.observedAt>=row.after){ready=true;fresh=home.vehicle.stale!==true&&home.vehicle.observedAt>=row.after;value=this.vehicleJournalValue(row.action,{},home.vehicle);}
   if(row.domain==='light'&&home.lights?.status==='observed'&&home.lights.scope.areaId===row.target.areaId&&home.lights.observedAt>=row.after){const selected=home.lights.items.filter(item=>!row.target.entityId||item.entityId===row.target.entityId);if(selected.length){ready=true;fresh=true;const values=selected.map(item=>row.action==='brightness'?item.state==='off'?0:typeof item.brightness==='number'?Math.round(item.brightness/255*100):undefined:item.state==='on'?true:item.state==='off'?false:undefined);if(row.action!=='scene'&&values.every(item=>item!==undefined&&item===values[0]))value=values[0];}}
   if(row.domain==='vacuum'&&home.vacuum?.status==='observed'&&home.revision>row.observedRevision){const item=home.vacuum.items.find(item=>item.entityId===row.resourceId&&item.observedAt>=row.after);if(item){ready=true;fresh=true;if(row.action==='settings'){const setting=item.telemetry?.status==='observed'?item.telemetry.items.find(item=>item.key===row.settingKey&&!item.stale&&item.retrievedAt>=row.after):null;value=setting?.value;if(!(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=86400))value=undefined;fresh=value!==undefined;}}}
   if(!ready){keep.push(row);continue;}this.journalDevice(t,'control_observation',{domain:row.domain,action:row.action,requestId:row.requestId,resourceId:row.resourceId,code:fresh&&(value!==undefined||row.action==='scene'||row.domain==='vacuum'&&row.action!=='settings')?'observed':'unconfirmed',source:'home_assistant',trust:'state_observation',...(row.requestedValue!==undefined?{requestedValue:row.requestedValue}:{}),...(value!==undefined?{observedValue:value}:{})});
  }this.deviceJournalPending=keep;
 }catch{/* Observation logging cannot interrupt home adoption. */}}
 async prepareVehicle(action,owner,args={}){
  const h=this.host,s=h.liveSnapshot,t=h.liveTransport,requestedValue=this.vehicleJournalValue(action,args),resourceId=h.state?.vehicleBinding,diagnostic={domain:'vehicle',action,resourceId,...(requestedValue!==undefined?{requestedValue}:{})};
  if(!owner||h.vehicleView!==owner||!['lock','unlock','climateOn','climateOff','temperature','defrostOn','defrostOff','driverSeatHeat','passengerSeatHeat','rearTrunkToggle'].includes(action)||h.state?.focus!=='vehicle'||!h.isConnected||!this.allowed('vehicle')||!s?.capabilities?.vehicleActions?.includes(action)||this.vehicleOperation){this.journalDevice(t,'control_intent',{...diagnostic,code:this.vehicleOperation?'intent_pending':'capability_missing'});return null;}
  this.journalDevice(t,'control_intent',{...diagnostic,code:'start'});
  const generation=t.generation,scope=JSON.stringify([s.bootId,s.roomId,s.capabilities?.homeRead?.includes('vehicle')]),current=()=>h.isConnected&&h.liveTransport===t&&t.connected&&t.generation===generation&&this.allowed('vehicle')&&h.liveSnapshot?.capabilities?.vehicleActions?.includes(action)&&JSON.stringify([h.liveSnapshot.bootId,h.liveSnapshot.roomId,h.liveSnapshot.capabilities?.homeRead?.includes('vehicle')])===scope;
  const presentationCurrent=()=>!owner.disposed&&h.vehicleView===owner&&
   h.liveSnapshot?.bootId===s.bootId&&h.liveSnapshot?.roomId===s.roomId&&
   (!h.state?.vehicleBinding||h.state.vehicleBinding===resourceId);
  const receiptCurrent=()=>presentationCurrent()&&current();
  const observationCurrent=()=>receiptCurrent()&&s.capabilities?.homeRead?.includes('vehicle')===true&&
   h.liveSnapshot?.capabilities?.homeRead?.includes('vehicle')===true&&
   typeof resourceId==='string'&&h.state.vehicleBinding===resourceId;
  const waitForObservation=callback=>{
   const timer=setTimeout(callback,60000);  // A woken Tesla can take 10–30 s, then report.
   return ()=>clearTimeout(timer);
  };
  const operation={action,diagnostic,diagnosticTransport:t,requestedValue,resourceId,
   presentationCurrent,receiptCurrent,observationCurrent,waitForObservation,current:()=>receiptCurrent()&&h.state?.focus==='vehicle'};
  this.vehicleOperation=operation;
  this.journalDevice(t,'control_setup',{...diagnostic,code:'start'});
  try{const raw=await t.controlSetup('vehicle',{action,args});if(this.vehicleOperation!==operation||!operation.current())throw Error('changed');const task=controlTask(raw,h.liveSnapshot,'vehicle');if(task.options[0].action!==action||JSON.stringify(task.confirmation.args??{})!==JSON.stringify(args)||this.spent.has(task.taskId))throw Error('invalid');operation.task=task;this.journalDevice(t,'control_setup',{...diagnostic,code:'ok'});return {confirmation:task.confirmation,operation};}catch{this.journalDevice(t,'control_setup',{...diagnostic,code:operation.current()?'setup_unavailable':'superseded'});if(this.vehicleOperation===operation)this.vehicleOperation=null;return null;}
 }
 cancelVehicle(operation){if(this.vehicleOperation===operation){if(operation)this.journalDevice(operation.diagnosticTransport,'control_intent',{...operation.diagnostic,code:'cancelled'});this.vehicleOperation=null;}}
 async sendVehicle(operation){
  if(this.vehicleOperation!==operation||!operation?.current()||!operation.task||this.spent.has(operation.task.taskId)){this.journalDevice(operation?.diagnosticTransport,'control_intent',{...operation?.diagnostic,code:'scope_changed'});if(this.vehicleOperation===operation)this.vehicleOperation=null;return {status:'failed'};}
  const task=operation.task,option=task.options[0];let args;try{args=controlArgs(task,option.id,task.confirmation.requiresOverride?{acknowledgePriorUnresolved:true}:{});}catch{this.journalDevice(operation.diagnosticTransport,'control_intent',{...operation.diagnostic,code:'invalid_dto'});this.vehicleOperation=null;return {status:'failed'};}
  this.spent.set(task.taskId,task.expiresAt);let sent=false;try{if(!operation.current())throw Error('changed');sent=true;const response=await this.host.liveTransport.controlAction(task,option.id,args),status=response?.outcome==='accepted'&&response.ok===true?'accepted':response?.outcome==='rejected'&&response.ok===false?'failed':'unknown',late=this.vehicleOperation!==operation||!operation.receiptCurrent();if(!late&&status!=='failed'){this.trackDeviceJournal('vehicle',operation,response?.requestId,operation.requestedValue,operation.resourceId,operation.receiptCurrent);void this.host.loadLiveHome?.({afterCurrent:true});}return {status,late,...(response?.vehicleError?{error:response.vehicleError}:{})};}catch{const late=this.vehicleOperation!==operation||!operation.receiptCurrent();if(!late&&sent)void this.host.loadLiveHome?.({afterCurrent:true});return {status:sent?'unknown':'failed',late};}finally{if(this.vehicleOperation===operation)this.vehicleOperation=null;}
 }
 lightActionContext(target,observation,currentObservation){
  if(!this.allowed('light')||!this.host.isConnected||typeof currentObservation!=='function'||!target||Object.keys(target).sort().join(',')!==(Object.hasOwn(target,'sceneId')?'areaId,sceneId':Object.hasOwn(target,'entityId')?'areaId,entityId':'areaId'))return false;
  const source=scopedLightsObservation(observation),transport=this.host.liveTransport,transportGeneration=transport.generation;
  if(source?.status!=='observed'||source.scope.areaId!==target.areaId||!source.items.length)return false;
  const scene=Object.hasOwn(target,'sceneId')?source.scenes?.find(row=>row.id===target.sceneId):null;if(Object.hasOwn(target,'sceneId')&&!scene)return false;
  const selected=source.items.filter(row=>scene?scene.entityIds.includes(row.entityId):!Object.hasOwn(target,'entityId')||row.entityId===target.entityId);if(!selected.length||selected.some(row=>!['on','off'].includes(row.state)))return false;
  const ids=selected.map(row=>row.entityId).sort(),scope=source.scope,members=JSON.stringify(source.items.map(row=>row.entityId).sort()),owner=()=>JSON.stringify([this.host.liveSnapshot?.bootId,this.host.liveSnapshot?.roomId,this.host.state?.focus]),ownerKey=owner();
  const levels=selected.map(row=>row.state==='off'?0:row.brightness===null?null:Math.round(row.brightness/255*100)),brightnessPercent=levels.every(value=>value!==null&&value===levels[0])?levels[0]:null;
  const context={transport,ownerKey,sourceObservedAt:source.observedAt,observation:currentObservation,brightnessPercent,scene:scene?structuredClone(scene):null,title:scene?`${source.scope.areaName} · ${scene.name}`:Object.hasOwn(target,'entityId')?`${source.scope.areaName} · ${selected[0].name}`:`Lys · ${source.scope.areaName}`,sourceEpoch:source.sourceEpoch,scope:source.scope,ids,brightness:selected.every(row=>row.supportsBrightness),current:()=>{let current;try{current=scopedLightsObservation(currentObservation());}catch{return false;}return this.host.isConnected&&this.host.liveTransport===transport&&transport.generation===transportGeneration&&this.allowed('light')&&owner()===ownerKey&&current?.status==='observed'&&current.sourceEpoch===source.sourceEpoch&&(!scene||JSON.stringify(current.scenes?.find(row=>row.id===scene.id))===JSON.stringify(scene))&&Object.keys(scope).every(key=>current.scope[key]===scope[key])&&JSON.stringify(current.items.map(row=>row.entityId).sort())===members&&ids.every(id=>current.items.some(row=>row.entityId===id&&['on','off'].includes(row.state)&&row.supportsBrightness===selected.find(item=>item.entityId===id).supportsBrightness));}};
  return context.current()?context:null;
 }
 lightTaskCurrent(context,task){
  return !!context&&task?.domain==='light'&&context.current()&&(task.lightSetup.sceneId??null)===(context.scene?.id??null)&&(!context.scene||JSON.stringify(task.lightSetup.scenes)===JSON.stringify([context.scene]))&&Object.keys(context.scope).every(key=>task.lightSetup.scope[key]===context.scope[key])&&JSON.stringify([...task.lightSetup.entityIds].sort())===JSON.stringify(context.ids)&&(!task.options.some(option=>option.action==='brightness')||context.brightness)&&task.options.every(option=>option.action!=='scene'||context.scene&&option.argsSchema.choices.length===1&&option.argsSchema.choices[0].id===context.scene.id);
 }
 openLight(target,observation,opener,currentObservation){
  const lightRunning=[...this.lightActions?.values()||[]].some(entry=>entry.operation);
  if(this.pending||this.setupPending||lightRunning)return false;const context=this.lightActionContext(target,observation,currentObservation);if(!context)return false;this.lightContext=context;return this.open('light',{...target},opener);
 }
 updateLightAction(operation,phase,details={}){
  const state={target:{...operation.target},action:operation.action,phase,pending:['preparing','sending'].includes(phase),message:phase==='accepted'?'Anmodningen er modtaget.':phase==='unknown'?'Udfaldet er ukendt · handlingen gentages ikke.':phase==='rejected'?'Handlingen kunne ikke udføres med den aktuelle adgang.':'',...details};
  // Light state is kept per light (area, lamp or scene key); the latest update moves to the end (L1).
  const lights=this.lightActions??=new Map(),entry=lights.get(operation.identity)||{};
  lights.delete(operation.identity);lights.set(operation.identity,entry);
  if(state.pending&&operation.action==='brightness'){
   const queue=entry.queue;
   const latest=queue?.kind==='brightness'&&this.canQueueLightInput(operation.target,'brightness')
    ?queue.pending.at(-1):undefined;
   state.requestedPercent=latest??operation.requestedPercent;
  }
  entry.feedback=operation;entry.state=state;if(this.host.isConnected&&!operation.revoked&&operation.context.current()){this.host.onLightActionStatus?.(state,operation);this.host.render?.();}return state;
 }
 lightActionFeedbackCurrent(operation){if(!operation||operation.revoked||this.suspending)return false;if(!operation.context.current()){operation.revoked=true;return false;}return true;}
 canQueueLightInput(target,kind){
  const entry=this.lightActions?.get(JSON.stringify([target.areaId,target.entityId??null,null]));
  const queue=entry?.queue,operation=entry?.operation;
  return !!queue&&!!operation&&!operation.revoked&&!this.suspending&&queue.kind===kind
   &&queue.target.areaId===target.areaId&&queue.target.entityId===target.entityId&&queue.context.current();
 }
 async submitLightInput(target,observation,kind,input,currentObservation){
  const brightness=kind==='brightness';
  const percent=brightness?input?.percent:null;
  if(brightness&&(!Number.isInteger(percent)||percent<0||percent>100))return;
  const lights=this.lightActions??=new Map(),key=JSON.stringify([target.areaId,target.entityId??null,null]);
  const entry=lights.get(key)||{},running=entry.queue;lights.set(key,entry);
  if(running){
   if(!this.canQueueLightInput(target,kind))return;
   if(brightness){
    running.pending[0]=percent;
    this.updateLightAction(entry.operation,entry.state.phase);
   }else if(running.pending.length<32)running.pending.push(null);
   return;
  }
  const context=this.lightActionContext(target,observation,currentObservation);
  if(!context||brightness&&!context.brightness||entry.operation)return;
  const queue={target:{...target},kind,context,pending:[percent]};
  entry.queue=queue;
  try{
   while(queue.pending.length&&context.current()){
    const wanted=queue.pending.shift();
    const source=scopedLightsObservation(currentObservation());
    const result=await this.actLight(target,source,kind,brightness?{percent:wanted}:{},currentObservation);
    if(result?.outcome!=='accepted'||result.late||!context.current()){
     queue.blocked=true;
     return result;
    }
    const refreshed=scopedLightsObservation(currentObservation());
    const observed=refreshed.items.filter(item=>context.ids.includes(item.entityId));
    const matches=observed.every(item=>{
     if(!brightness)return item.state===(result.action==='turn_on'?'on':'off');
     const value=item.state==='off'?0:item.brightness===null?null:Math.round(item.brightness/255*100);
     return value===wanted;
    });
    if(!result.refreshed||refreshed.observedAt<=result.observedBeforeSend||!matches){
     queue.blocked=true;
     if(queue.pending.length)this.host.showFeedback?.('Hent aktuel lysstatus, før du prøver igen.',false);
     return result;
    }
    if(!queue.pending.length||brightness&&queue.pending[0]===wanted)return result;
   }
  }finally{
   if(entry.queue===queue)entry.queue=null;
  }
 }
 async actLight(target,observation,action,input={},currentObservation){
  const unavailable={outcome:'rejected',phase:'rejected',pending:false,refreshed:false};
  const t=this.host.liveTransport;
  try{target=structuredClone(target);input=structuredClone(input);}catch{return unavailable;}
  const resourceId=target?.entityId||target?.sceneId||target?.areaId;
  const identity=JSON.stringify([target?.areaId,target?.entityId??null,target?.sceneId??null]);
  const lights=this.lightActions??=new Map();
  if(lights.get(identity)?.operation||this.pending||this.setupPending||this.domain==='light'&&this.controlOpen()
   ||!['toggle','turn_on','turn_off','brightness','scene'].includes(action))return unavailable;
  const context=this.lightActionContext(target,observation,currentObservation);
  if(!context||action==='brightness'&&!context.brightness||action==='scene'&&!context.scene)return unavailable;
  const operation={target,action,context,identity,sent:false,revoked:false,
   requestedPercent:action==='brightness'?input.percent:undefined};
  const entry=lights.get(identity)||{};
  entry.operation=operation;
  lights.set(identity,entry);
  // Independent lamp intents share the broker's one setup/action slot per HA area.
  const lanes=this.lightAreaLanes??=new Map(),areaId=target.areaId,previous=lanes.get(areaId);
  let release;
  const turn=new Promise(resolve=>{release=resolve;});
  lanes.set(areaId,turn);
  this.updateLightAction(operation,'preparing');
  const current=()=>this.lightActions?.get(identity)?.operation===operation
   &&!operation.revoked&&!this.suspending&&context.current();
  let completion;
  try{
   const prior=previous?await previous:null;
   completion=prior;
   if(!current()||this.pending||this.setupPending||this.domain==='light'&&this.controlOpen())return unavailable;
   const source=scopedLightsObservation(context.observation());
   const affected=prior?.ids.some(id=>context.ids.includes(id));
   if(prior?.unknown||affected&&(!prior.refreshed||source.observedAt<=prior.observedBeforeSend)){
    this.host.showFeedback?.('Hent aktuel lysstatus, før du prøver igen.',false);
    return unavailable;
   }
   if(action==='toggle'){
    const on=source.items.some(item=>context.ids.includes(item.entityId)&&item.state==='on');
    operation.action=on?'turn_off':'turn_on';
   }
   const result=await this.sendLightOperation(operation,input,current,source,resourceId,t);
   if(operation.sent&&(result.outcome==='accepted'||result.outcome==='unknown')){
    // Without an area read, a distinct lamp cannot clear an older overlapping intent's fence.
    const unobserved=prior&&!prior.refreshed&&!result.refreshed;
    completion={ids:unobserved?[...new Set([...prior.ids,...context.ids])]:context.ids,
     observedBeforeSend:unobserved?Math.max(prior.observedBeforeSend,operation.observedBeforeSend)
      :operation.observedBeforeSend,refreshed:result.refreshed,unknown:result.outcome==='unknown'};
   }
   return result;
  }finally{
   if(entry.operation===operation){
    const late=!current();
    entry.operation=null;
    if(entry.state.pending)this.updateLightAction(operation,'rejected',{late});
   }
   if(lanes.get(areaId)===turn)lanes.delete(areaId);
   release(completion);
  }
 }
 async sendLightOperation(operation,input,current,source,resourceId,t){
  const {identity,context,target,action}=operation;
  const requestedValue=action==='turn_on'?true:action==='turn_off'?false:operation.requestedPercent;
  const diagnostic={domain:'light',action,resourceId,...(requestedValue!==undefined?{requestedValue}:{})};
  this.journalDevice(t,'control_intent',{...diagnostic,code:'start'});
  this.pruneSpent();
  const unknowns=this.lightUnknowns??=new Map();
  for(const [key,fence] of unknowns)if(fence.until<=Date.now())unknowns.delete(key);
  const unknown=unknowns.get(identity);
  if(unknown&&unknown.sourceEpoch===context.sourceEpoch&&source.observedAt<=unknown.observedAt){
   this.journalDevice(t,'control_intent',{...diagnostic,code:'unknown_fence'});
   return {outcome:'unknown',phase:'unknown',pending:false,refreshed:false};
  }
  unknowns.delete(identity);
  if(unknowns.size>=64){
   this.journalDevice(t,'control_intent',{...diagnostic,code:'unknown_fence',count:64});
   return {outcome:'rejected',phase:'rejected',pending:false,refreshed:false};
  }
  let task,result;
  try{
   this.journalDevice(t,'control_setup',{...diagnostic,code:'start'});
   const raw=await context.transport.controlSetup('light',target);
   if(!current())throw Error('light_context_changed');
   task=controlTask(raw,this.host.liveSnapshot,'light');
   if(this.spent.has(task.taskId)||!this.lightTaskCurrent(context,task))throw Error('light_offer_changed');
   const candidates=task.options.filter(row=>row.action===action);
   if(candidates.length!==1)throw Error('light_action_not_offered');
   const option=candidates[0],args=controlArgs(task,option.id,input);
   this.journalDevice(t,'control_setup',{...diagnostic,code:'ok'});
   if(!current()||!this.lightTaskCurrent(context,task))throw Error('light_context_changed');
   this.spent.set(task.taskId,task.expiresAt);
   this.updateLightAction(operation,'sending');
   if(!current())throw Error('light_context_changed');
   operation.observedBeforeSend=scopedLightsObservation(context.observation()).observedAt;
   operation.sent=true;
   operation.label=option.label;
   result=await context.transport.controlAction(task,option.id,args);
   if(!['accepted','rejected','unknown'].includes(result?.outcome)||result.ok!==(result.outcome==='accepted')){
    result={ok:false,outcome:'unknown'};
   }
  }catch{
   const code=operation.sent?'unknown':current()?'setup_unavailable':'superseded';
   this.journalDevice(t,operation.sent?'control_action':'control_setup',{...diagnostic,code});
   result={ok:false,outcome:operation.sent?'unknown':'rejected'};
  }
  const outcome=result.outcome;
  if(operation.sent){
   this.remember({key:task.bootId+':'+task.taskId,bootId:task.bootId,roomId:task.roomId,
    taskId:task.taskId,domain:'light',target,label:operation.label},outcome,result.requestId,result);
   if(outcome==='unknown')unknowns.set(identity,{sourceEpoch:context.sourceEpoch,
    observedAt:Math.max(source.observedAt,Date.now()/1000),until:Date.now()+15000});
   else unknowns.delete(identity);
  }
  if(operation.sent&&outcome!=='rejected'&&current())this.trackDeviceJournal('light',operation,result.requestId,
   requestedValue,resourceId,()=>!operation.revoked&&!this.suspending&&context.current());
  let refreshed=false;
  if(outcome==='accepted'&&current()&&typeof this.host.readLightArea==='function'){
   try{refreshed=await this.host.readLightArea(target.areaId,{preserveControls:true})===true;}catch{refreshed=false;}
  }
  try{
   const snap=this.host.liveSnapshot;
   this.observeDeviceJournal({bootId:snap?.bootId,roomId:snap?.roomId,lights:scopedLightsObservation(context.observation())});
  }catch{}
  return this.updateLightAction(operation,outcome,{outcome,requestId:result.requestId,refreshed,late:!current(),
   observedBeforeSend:operation.observedBeforeSend});
 }

 openMusic(opener){const context=this.musicContext();if(!context)return;this.open('music',context.target,opener);}
 async openRobot(opener,recipeId){
  const d=this.host.state.devices.find(x=>x.id===this.host.state.focus&&x.kind==='vacuum'),snapshot=this.host.liveSnapshot,unknown=[...this.receipts.values()].some(row=>row.bootId===snapshot?.bootId&&row.roomId===snapshot?.roomId&&row.domain==='vacuum'&&row.target?.entityId===d?.id&&this.robotReceiptUnknown(row));
  if(recipeId!==undefined&&d&&(['cleaning','paused'].includes(d.status)||robotExperience(d).jobActive===true))return;
  if(!d?.live||d.pending||this.pending||this.setupPending||this.robotOverviewOperation||this.activeOperation||unknown||!this.host.isConnected)return;
  if(!this.allowed('vacuum')||d.stale){
   if(d.id===this.target?.entityId&&this.robotOfflineDraftCurrent(this.expiredRobot))return;
   if (d.stale && this.allowed('vacuum') && this.robotInline && this.robotPanel
    && d.id === this.target?.entityId && (this.task?.domain === 'vacuum' || this.expiredRobot)) return;
   this.opening++;
   clearTimeout(this.expiryTimer);
   this.clearRobotRefresh();
   this.opener=opener;
   this.domain='vacuum';
   this.target={entityId:d.id};
   this.task=null;
   this.robotSuggestion=null;
   this.title.textContent='Robotstøvsuger';
   this.note.textContent='Kun status og pleje er tilgængelig.';
   this.buildOptions();
   this.body.setAttribute('aria-busy','false');
   this.mountRobotInline();
   this.renderReceipt();
   return;
  }
  if(recipeId===undefined&&this.expiredRobot){if(d.id===this.target?.entityId&&this.expiredRobot.target===JSON.stringify({entityId:d.id})){this.robotInline=true;this.mountRobotInline();if(this.canRefreshRobot()){await this.refreshRobot();return;}if(this.robotOfflineDraftCurrent(this.expiredRobot))return;}this.clearRobotRefresh();}
  // A journal ID only asks the existing source owner for a validated, editable offer.
  // No stored labels, service values or old opaque choice IDs become command authority.
  const now=Date.now()/1000,experience=robotExperience(d),idle=experience.jobActive!==true&&!experience.issues.length&&(experience.activity===null||['Oplader','Opladet'].includes(experience.activity)),fresh=Number.isFinite(d.observedAt)&&d.observedAt<=now&&now-d.observedAt<=300,existing=this.target?.entityId===d.id?this.robotPanel:null;
  const previous=recipeId===undefined&&!this.storedRobotDraft({entityId:d.id})&&['docked','stopped'].includes(d.status)&&idle&&fresh&&!existing?.cleaningDirty&&!existing?.value?.selectedAreaId&&!existing?.value?.task?.historyDraft&&d.history?.status==='observed'&&Array.isArray(d.history.items)&&d.history.items.length<=3?d.history.items.filter(row=>/^[a-f0-9]{32}$/.test(row.id)&&row.outcome==='accepted_by_ha'&&Number.isFinite(row.recordedAt)&&row.recordedAt>=0&&row.recordedAt<=now).sort((a,b)=>b.recordedAt-a.recordedAt)[0]:null;
  this.robotInline=true;this.mountRobotInline();const context=this.robotControlContext({entityId:d.id}),reading=this.open('vacuum',{entityId:d.id},opener,recipeId,undefined,previous?.id),opening=this.opening,generation=this.generation;await reading;
  if(!previous||this.task?.historyDraft&&this.task.options.some(option=>option.action==='start'&&option.argsSchema.kind==='cleaning'))return;
  // At most one ordinary setup read after a denied/unavailable old recipe. Never retry an effect.
  if(opening!==this.opening||generation!==this.generation||!this.robotControlCurrent(context)||!this.controlOpen()||this.host.state.focus!==d.id||this.pending||this.setupPending||this.activeOperation||this.robotOverviewOperation||this.robotPanel?.cleaningDirty||[...this.receipts.values()].some(row=>row.bootId===snapshot?.bootId&&row.roomId===snapshot?.roomId&&row.domain==='vacuum'&&row.target?.entityId===d.id&&this.robotReceiptUnknown(row)))return;
  await this.open('vacuum',{entityId:d.id},opener);
 }
 async open(domain,target,opener,recipeId,refreshContext,restoreHistoryId){if(domain==='vacuum'&&!restoreHistoryId&&recipeId===undefined&&this.recipeId===undefined&&!refreshContext&&this.domain==='vacuum'&&JSON.stringify(this.target)===JSON.stringify(target)&&this.robotInline&&this.controlOpen()&&this.robotPanel&&this.task?.domain==='vacuum'&&this.robotControlOffer?.task===this.task&&this.robotControlCurrent(this.robotControlOffer.context)&&![...this.receipts.values()].some(row=>row.bootId===this.task.bootId&&row.roomId===this.task.roomId&&row.domain==='vacuum'&&row.target?.entityId===target?.entityId&&this.robotReceiptUnknown(row))&&this.task.expiresAt*1000>Date.now()&&!this.spent.has(this.task.taskId)&&!this.pending&&!this.setupPending&&!this.activeOperation&&!this.robotOverviewOperation){this.opener=opener;await this.renewRobotTask(this.task);return;}if(domain==='music'&&JSON.stringify(this.musicContext()?.target)!==JSON.stringify(target))return;if(this.pending||this.robotOverviewOperation||this.setupPending||!this.host.isConnected||!this.allowed(domain)||domain==='light'&&!this.lightContext?.current())return;const preOpenTask=this.task,preOpenPanel=this.robotPanel,preOpenDraft=domain==='vacuum'&&this.domain==='vacuum'&&JSON.stringify(this.target)===JSON.stringify(target)&&preOpenTask?.domain==='vacuum'&&preOpenTask.bootId===this.host.liveSnapshot?.bootId&&preOpenTask.roomId===this.host.liveSnapshot?.roomId&&!this.spent.has(preOpenTask.taskId)&&!this.activeOperation&&!this.robotOverviewOperation&&![...this.receipts.values()].some(row=>row.bootId===preOpenTask.bootId&&row.roomId===preOpenTask.roomId&&row.domain==='vacuum'&&row.target?.entityId===target?.entityId&&this.robotReceiptUnknown(row))&&preOpenPanel?this.readRobotDraft(preOpenTask,preOpenPanel):null;this.render();for(const[id,expiry]of this.spent)if(expiry*1000<=Date.now())this.spent.delete(id);const retain=this.domain===domain&&JSON.stringify(this.target)===JSON.stringify(target);const reopenDraft=retain&&!refreshContext?preOpenDraft:null;this.robotDeferredDraft=null;if(reopenDraft&&!reopenDraft.settingChoices)reopenDraft.settingChoices=[];if(domain==='vacuum'&&retain&&this.task)this.host.liveTransport?.recordDiagnostic?.('robot_renewal',{code:'robot_open_reset'});this.title.textContent=domain==='music'?'Betjen musik':domain==='light'?this.lightContext.title:'Rengøring';this.opener=opener;this.domain=domain;this.target=target;this.recipeId=recipeId;this.task=null;if(!retain)this.body.replaceChildren();for(const el of this.body.querySelectorAll('button,input,select'))if(domain!=='vacuum'||!this.robotPanel?.contains?.(el))el.disabled=true;if(this.robotPanel)this.robotPanel.disabled=true;this.body.setAttribute('aria-busy','true');this.note.textContent=domain==='light'?'Henter aktuel betjening…':'';if(domain==='vacuum'&&this.robotInline)this.mountRobotInline();else{this.robotInline=false;this.dialog.append(this.note,this.receiptNote,this.body);if(!this.dialog.open)this.dialog.showModal();}const opening=++this.opening,generation=this.generation,transport=this.host.liveTransport,transportGeneration=transport.generation,robotContext=domain==='vacuum'?this.robotControlContext(target):null;this.setupPending=true;if(domain==='vacuum'&&(!retain||!this.robotPanel))this.buildOptions();this.render();
  const stored=domain==='vacuum'&&!refreshContext&&!reopenDraft&&recipeId===undefined&&!restoreHistoryId?this.storedRobotDraft(target):null;
  try{const snap=this.host.liveSnapshot,draft=refreshContext?.draft??reopenDraft??stored?.draft,value=await transport.controlSetup(domain,target,draft?undefined:recipeId,draft?{draft}:restoreHistoryId?{restoreHistoryId}:{});if(domain==='vacuum'&&(!!draft!==Object.hasOwn(value?.setup??{},'draft')))throw Error('draft_response_mismatch');if(this.host.liveTransport!==transport||transport.generation!==transportGeneration||opening!==this.opening||generation!==this.generation||!this.host.isConnected||!this.allowed(domain)||!this.controlOpen()||domain==='vacuum'&&this.robotInline&&this.host.state.focus!==target.entityId||this.host.liveSnapshot.bootId!==snap.bootId||this.host.liveSnapshot.roomId!==snap.roomId)return;if(domain==='vacuum'&&!this.robotControlCurrent(robotContext))return;if(refreshContext&&(this.expiredRobot!==refreshContext||this.pending||this.activeOperation||this.robotDevice()?.live!==true||this.robotDevice()?.stale||[...this.receipts.values()].some(row=>row.bootId===snap.bootId&&row.roomId===snap.roomId&&row.domain==='vacuum'&&JSON.stringify(row.target)===refreshContext.target&&this.robotReceiptUnknown(row))))return;if(domain==='music'&&(JSON.stringify(this.musicContext()?.target)!==JSON.stringify(target)||value.expectedBindingId!==target.expectedBindingId))throw Error('music_binding_changed');const admitted=controlTask(value,this.host.liveSnapshot,domain);if(this.spent.has(admitted.taskId))throw Error('consumed_control_offer');if(domain==='light'&&!this.lightTaskCurrent(this.lightContext,admitted))throw Error('light_scope_changed');const historyId=draft?undefined:recipeId??restoreHistoryId;if(admitted.historyDraft&&(domain!=='vacuum'||typeof historyId!=='string'||!historyId))throw Error('unrequested_history_draft');this.task=admitted;if(domain==='vacuum')this.robotControlOffer={task:admitted,context:robotContext};this.robotSuggestion=domain==='vacuum'?value.setup?.robotSuggestion:null;this.note.textContent=domain==='vacuum'&&this.task.options.some(option=>option.action==='start'&&option.argsSchema.kind==='cleaning')?'':this.task.mapName||'Vælg en handling';this.showRobotDraft(admitted,draft);if(draft&&(admitted.draft?.status==='not_restored'||admitted.draft?.status==='restored'&&(refreshContext??stored)?.modeDrafts&&!this.robotPanel?.applyModeDrafts?.((refreshContext??stored).modeDrafts)))this.robotPanel?.observed?.(this.robotView(this.robotDevice()),{controlFeedback:{text:'Dine tidligere valg kunne ikke genskabes. Vælg rum og indstillinger igen.',state:'unknown'}});this.scheduleRobotTaskExpiry();}
  catch(error){if(opening===this.opening&&generation===this.generation){this.note.textContent=error?.message==='draft_not_restored'?'Dine valg kunne ikke genskabes. Hent betjeningen og vælg igen.':'Betjeningen kunne ikke hentes. Adgangen eller status kan have ændret sig.';if(error?.message==='draft_not_restored')this.robotPanel?.observed?.(this.robotView(this.robotDevice()),{controlFeedback:{text:this.note.textContent,state:'unknown'}});}}
  finally{if(opening===this.opening)this.body.setAttribute('aria-busy','false');this.setupPending=false;this.render();}
 }
 readRobotDraft(task,panel) {
  if (task.draft?.status === 'awaiting_water') return this.robotDeferredDraft;
  if (!panel?.cleaningDirty || !panel.readCleaningDraft) return null;
  const draft = panel.readCleaningDraft();
  return {taskId:task.taskId,revision:task.revision,optionId:panel.cleaningOptionId,
   ...draft,settingChoices:draft.settingChoices || []};
 }
 showRobotDraft(task,draft) {
  if (task.draft?.status === 'not_restored') this.clearStoredRobotDraft(this.target);
  if (task.draft?.status !== 'awaiting_water') {
   this.robotDeferredDraft = null;
   this.buildOptions();
   return;
  }
  // The old form is presentation only. Only a later server remap can authorize its values.
  this.robotDeferredDraft = draft;
  this.robotPanel.disabled = true;
 }
 scheduleRobotTaskExpiry(){
  clearTimeout(this.expiryTimer);clearTimeout(this.robotEarlyRenewal);clearTimeout(this.robotRenewalRetry);const task=this.task;if(!task)return;const remaining=task.expiresAt*1000-Date.now();this.expiryTimer=setTimeout(()=>{if(this.task===task){this.expireTask();this.render();}},Math.max(0,remaining));
  if(task.domain==='vacuum'&&this.robotInline&&remaining>1000)this.robotEarlyRenewal=setTimeout(()=>{if(this.task===task)this.renewRobotTask(task);},remaining-Math.min(15000,remaining/2));
 }
 async renewRobotTask(task,attempt=0){
  const panel=this.robotPanel,device=this.robotDevice(),context=this.robotControlOffer?.context,transport=this.host.liveTransport,opening=this.opening,generation=this.generation;
  const unknown=()=>[...this.receipts.values()].some(row=>row.bootId===task.bootId&&row.roomId===task.roomId&&row.domain==='vacuum'&&JSON.stringify(row.target)===JSON.stringify(this.target)&&this.robotReceiptUnknown(row));
  const current=()=>this.task===task&&this.robotPanel===panel&&this.robotControlOffer?.task===task&&this.robotControlCurrent(context)&&this.host.liveTransport===transport&&this.opening===opening&&this.generation===generation&&this.robotInline&&this.controlOpen()&&this.host.state.focus===this.target?.entityId&&!this.pending&&!this.setupPending&&!this.activeOperation&&!this.robotOverviewOperation&&!this.spent.has(task.taskId)&&!unknown()&&task.expiresAt*1000>Date.now();
  if(!panel||!device||!current()||this.robotRenewalRead)return;
  const draft=this.readRobotDraft(task,panel);
  const draftSignature=JSON.stringify(draft),read={task};this.robotRenewalRead=read;
  try{
   const raw=await transport.controlSetup('vacuum',this.target,undefined,{renewTaskId:task.taskId,...(draft?{draft}:{})});
   if(this.robotRenewalRead!==read||!current()||!!draft!==Object.hasOwn(raw?.setup??{},'draft'))return;
   const latest=this.readRobotDraft(task,panel);if(JSON.stringify(latest)!==draftSignature){if(attempt===0&&task.expiresAt*1000-Date.now()>1250){clearTimeout(this.robotRenewalRetry);this.robotRenewalRetry=setTimeout(()=>{if(current())this.renewRobotTask(task,1);},250);}return;}
   const admitted=controlTask(raw,this.host.liveSnapshot,'vacuum');if(this.spent.has(admitted.taskId))return;
   if(admitted.rebind?.status==='not_restored'&&robotRebindReasons.has(raw.setup?.rebindReason))transport.recordDiagnostic?.('robot_renewal',{code:raw.setup.rebindReason});
   const focused=globalThis.document?.activeElement,focusLabel=panel.contains?.(focused)?robotFocusLabel(focused):null;this.task=admitted;this.robotControlOffer={task:admitted,context};this.robotSuggestion=raw.setup?.robotSuggestion??null;this.showRobotDraft(admitted,draft);if(focusLabel&&(!globalThis.document.activeElement||globalThis.document.activeElement===globalThis.document.body||globalThis.document.activeElement===focused)){const matches=[...panel.querySelectorAll('button,input,select')].filter(node=>!node.disabled&&robotFocusLabel(node)===focusLabel);if(matches.length===1)matches[0].focus?.({preventScroll:true});}if(draft&&admitted.draft?.status==='not_restored')this.robotPanel?.observed?.(this.robotView(this.robotDevice()),{controlFeedback:{text:'Dine tidligere valg kunne ikke genskabes. Vælg rum og indstillinger igen.',state:'unknown'}});this.scheduleRobotTaskExpiry();this.render();
  }catch{}finally{if(this.robotRenewalRead===read)this.robotRenewalRead=null;}
 }
 clearRobotRefresh(){clearTimeout(this.robotEarlyRenewal);clearTimeout(this.robotRenewalRetry);this.robotRenewalRead=null;this.expiredRobot=null;this.refreshButton?.remove();this.refreshButton=null;}
 setRobotRefresh(context){
  this.expiredRobot=context;
  const refresh=make('button','Hent aktuel betjening','pv-button pv-ghost');
  refresh.type='button';
  refresh.addEventListener('click',()=>this.refreshRobot());
  this.refreshButton=refresh;
  this.body.append(refresh);
  if(this.robotInline)refresh.hidden=true;
 }
 canRefreshRobot(){
  const context=this.expiredRobot,s=this.host.liveSnapshot,device=this.robotDevice();
  const recovered=!context?.offline||this.robotOfflineDraftCurrent(context)&&
   this.host.liveTransport.snapshot===s&&this.host.state.homeScope===JSON.stringify([s.bootId,s.roomId]);
  return !!context&&recovered&&!this.spent.has(context.taskId)&&context.transport===this.host.liveTransport&&context.transportGeneration===this.host.liveTransport?.generation&&context.generation===this.generation&&context.opening===this.opening&&this.controlOpen()&&this.host.isConnected&&this.allowed('vacuum')&&this.domain==='vacuum'&&s?.bootId===context.bootId&&s?.roomId===context.roomId&&JSON.stringify(this.target)===context.target&&device?.live===true&&!device.stale&&!this.pending&&!this.setupPending&&!this.activeOperation&&![...this.receipts.values()].some(row=>row.bootId===context.bootId&&row.roomId===context.roomId&&row.domain==='vacuum'&&JSON.stringify(row.target)===context.target&&this.robotReceiptUnknown(row));
 }
 robotTaskReceiptCurrent({allowTransientDock = false} = {}) {
  const task = this.task, operation = this.activeOperation;
  const transport = this.host.liveTransport, snapshot = this.host.liveSnapshot;
  const option = task?.options?.find(row => row.id === operation?.optionId);
  const cleaningStart = option?.action === 'start' && option.argsSchema?.kind === 'cleaning';
  const dockReadGap = allowTransientDock && option?.action === 'dock' && option.argsSchema?.kind === 'dock'
   && task.expiresAt * 1000 > Date.now() && this.robotTransientHomeRead(this.robotDevice());
  // This guard retains only the original reply. The task has already been spent.
  return task?.domain === 'vacuum' && this.pending === true && operation?.domain === 'vacuum'
   && operation.receiptTask === task && operation.taskId === task.taskId
   && operation.bootId === task.bootId && operation.roomId === task.roomId
   && (cleaningStart || dockReadGap) && this.spent.has(task.taskId)
   && this.host.isConnected && transport?.connected && transport === operation.receiptTransport
   && transport.generation === operation.receiptTransportGeneration
   && snapshot?.bootId === task.bootId && snapshot?.roomId === task.roomId
   && JSON.stringify(this.target) === JSON.stringify(operation.target)
   && this.robotControlOffer?.task === task
   && this.robotControlCurrent(this.robotControlOffer.context, {allowStale: true});
 }
 expireTask(){
  const task=this.task;if(!task||this.robotTaskReceiptCurrent())return;
  const draft=task.domain==='vacuum'?this.readRobotDraft(task,this.robotPanel):null,modeDrafts=draft?this.robotPanel?.readModeDrafts?.()??null:null;const previousEntryKey=this.robotEntryKey;const eligible=task.domain==='vacuum'&&!this.pending&&!this.setupPending&&!this.activeOperation&&!this.spent.has(task.taskId)&&![...this.receipts.values()].some(row=>row.bootId===task.bootId&&row.roomId===task.roomId&&row.domain==='vacuum'&&JSON.stringify(row.target)===JSON.stringify(this.target)&&this.robotReceiptUnknown(row));
  this.invalidate('Betjeningen er udløbet · hent den igen.',false,task.domain==='vacuum');
  if(!eligible)return;this.robotEntryKey=previousEntryKey;
  this.setRobotRefresh({generation:this.generation,opening:this.opening,bootId:task.bootId,roomId:task.roomId,taskId:task.taskId,target:JSON.stringify(this.target),transport:this.host.liveTransport,transportGeneration:this.host.liveTransport?.generation,draft,modeDrafts});
  if(this.robotInline&&this.canRefreshRobot())queueMicrotask(()=>{if(this.canRefreshRobot())this.refreshRobot();});
 }
 // The unsent robot choices outlive a full reload. The server remaps them onto a fresh offer (30 min).
 robotDraftKey(target){return `podview.robotDraft.v1:${target?.entityId}`;}
 storedRobotDraft(target){
  try{
   const row=JSON.parse(globalThis.localStorage.getItem(this.robotDraftKey(target)));
   return row&&Date.now()-row.savedAt<1800000&&row.draft&&typeof row.draft.taskId==='string'?row:null;
  }catch{return null;}
 }
 clearStoredRobotDraft(target){try{globalThis.localStorage.removeItem(this.robotDraftKey(target));}catch{}}
 persistRobotDraft(){
  const task=this.task;
  if(task?.domain!=='vacuum'||!this.robotPanel||this.spent.has(task.taskId))return;
  const draft=this.readRobotDraft(task,this.robotPanel);
  if(!draft)return;
  try{
   globalThis.localStorage.setItem(this.robotDraftKey(this.target),JSON.stringify({savedAt:Date.now(),draft,modeDrafts:this.robotPanel.readModeDrafts?.()??null}));
  }catch{}
 }
 // A Start tapped on an offer that expired unnoticed is the user's explicit action: it waits for the
 // renewed offer and is sent once, with the restored choices, or the user is told it was not sent.
 queueExpiredRobotStart(optionId){
  const task=this.task,option=task?.options?.find(row=>row.id===optionId);
  if(task?.domain!=='vacuum'||task.expiresAt*1000>Date.now()||this.spent.has(task.taskId)||this.pending||this.activeOperation||option?.action!=='start'||option.argsSchema?.kind!=='cleaning')return false;
  this.robotQueuedStart={target:JSON.stringify(this.target),at:Date.now()};
  this.expireTask();this.render();
  if(!this.expiredRobot)this.finishQueuedRobotStart(false);
  return true;
 }
 finishQueuedRobotStart(restored){
  const queued=this.robotQueuedStart;this.robotQueuedStart=null;
  if(!queued||queued.target!==JSON.stringify(this.target))return;
  const option=restored&&this.task?.draft?.status==='restored'&&Date.now()-queued.at<20000?this.task.options.find(row=>row.action==='start'&&row.argsSchema?.kind==='cleaning'):null,draft=option?this.robotPanel?.readCleaningDraft?.():null;
  if(option&&draft?.areaIds?.length){this.send(option.id,draft);return;}
  this.robotPanel?.observed?.(this.robotView(this.robotDevice()),{controlFeedback:{text:'Din Start blev ikke sendt, fordi betjeningen var udløbet. Tjek dine valg og tryk Start igen.',state:'unknown'}});
 }
 async refreshRobot(){
  if(!this.canRefreshRobot()){this.finishQueuedRobotStart(false);return;}
  const context=this.expiredRobot,button=this.refreshButton,restoreFocus=document.activeElement===button,focusUnclaimed=()=>[button,document.body,this.dialog].includes(document.activeElement);
  await this.open('vacuum',this.target,this.opener,this.recipeId,context);
  if(context.generation!==this.generation||!this.controlOpen()||!this.host.isConnected){this.finishQueuedRobotStart(false);return;}
  if(this.task&&this.domain==='vacuum'&&JSON.stringify(this.target)===context.target){
   this.clearRobotRefresh();queueMicrotask(()=>this.finishQueuedRobotStart(true));this.note.textContent=context.draft&&this.task.draft?.status==='restored'?'Betjeningen er opdateret · dine valg er bevaret.':context.draft?'Dine tidligere valg kunne ikke genskabes. Vælg rum og indstillinger igen.':'Betjeningen er opdateret · vælg områder og indstillinger igen.';
   if(restoreFocus&&focusUnclaimed())this.robotPanel?.querySelector('input,select,button')?.focus();
  }else if(this.expiredRobot===context){this.finishQueuedRobotStart(false);button.hidden=false;context.opening=this.opening;this.render();if(restoreFocus&&focusUnclaimed()&&this.canRefreshRobot())button.focus();}
 }
 robotControlContext(target = this.target, {allowStale = false} = {}) {
  const snapshot = this.host.liveSnapshot, transport = this.host.liveTransport;
  const device = this.host.state.devices.find(row => row.id === target?.entityId && row.kind === 'vacuum');
  if (!this.host.isConnected || !this.allowed('vacuum') || device?.live !== true || !allowStale && device.stale) {
   return null;
  }
  return {key: JSON.stringify([snapshot.bootId, snapshot.roomId, target.entityId, device.status]),
   transport, generation: transport.generation};
 }
 robotControlCurrent(context, options) {
  return !!context && this.robotControlContext(this.target, options)?.key === context.key
   && this.host.liveTransport === context.transport && context.transport.generation === context.generation;
 }
 // The overview owns a separate bounded offer; it never borrows the open music/dialog task.
 robotReceiptUnknown(row){
  if(row.outcome!=='unknown')return false;
  const device=this.host.state.devices.find(d=>d.id===row.target?.entityId&&d.kind==='vacuum');
  return !(row.direct===true&&device?.live===true&&!device.stale&&this.robotDirectOffer(device)&&Number.isFinite(device.revision)&&device.revision>row.observedRevision);
 }
 robotTransientHomeRead(device){
  const snapshot=this.host.liveSnapshot,transport=this.host.liveTransport;
  const scope=this.robotPanel?.value?.presentationScope,read=this.host.state.homeReadStatus;
  const homeScope=JSON.stringify([snapshot?.bootId,snapshot?.roomId]);
  // A read error can retain the prompt, but cannot retain an action offer.
  return !!(scope&&device?.live===true&&device.stale&&!device.presentationOnly
   &&scope.deviceId===device.id&&scope.bootId===snapshot?.bootId&&scope.roomId===snapshot?.roomId
   &&scope.transport===transport&&scope.generation===transport?.generation
   &&this.allowed('vacuum')&&snapshot.capabilities.homeRead?.includes('vacuum')
   &&this.host.state.homeScope===homeScope&&read?.scope===homeScope&&read.vacuum==='error'&&read.transient===true);
 }
 robotDirectOffer(device){
  const snap=this.host.liveSnapshot,transport=this.host.liveTransport,homeScope=JSON.stringify([snap?.bootId,snap?.roomId]),state=({docking:'returning',stopped:'idle',fault:'error'})[device?.status]||device?.status;
  if(!this.host.isConnected||!transport?.connected||!this.allowed('vacuum')||this.host.state.homeScope!==homeScope||device?.live!==true||device.stale||device.presentationOnly||!this.host.state.devices.includes(device))return null;
  const offer=robotTransportOffer(device.transportActions,device.id,state),view=this.robotView(device);
  // A tapped Pause/Fortsæt keeps the row it was tapped in until HA confirms or the hold times out:
  // HA's transitional states (idle, returning, unknown) do not reshape or empty the row (S3).
  // Its slot shows pending meanwhile.
  const held=view!==device&&this.robotOptimistic?.actions;
  return held?{...offer,entityId:device.id,actions:[...held],
   pending:{paused:'resume',cleaning:'pause'}[view.status]??null}:offer;
 }
 // Optimistic presentation of the robot's own tap until HA reports that status (max 10 s).
 robotView(device){const o=this.robotOptimistic;if(!device||!o||o.entityId!==device.id)return device;if(device.status===o.status||Date.now()-o.at>10000){this.robotOptimistic=null;return device;}return {...device,status:o.status};}
 // Robot transport is idempotent: a pending or unconfirmed tap never locks the controls.
 robotDirectBlocked(device){return false;
  const s=this.host.liveSnapshot,f=this.robotOverviewFence;
  return !!(this.robotOverviewOperation||this.pending||device?.pending||f&&f.bootId===s?.bootId&&f.roomId===s?.roomId&&f.entityId===device?.id&&['accepted','unknown'].includes(f.outcome)&&!(Number.isFinite(device?.revision)&&device.revision>f.revision));
 }
 scheduleRobotObservation(transport,bootId,roomId,transportGeneration){
  clearTimeout(this.robotReadTimer);let attempts=0;
  const read=()=>{this.robotReadTimer=null;if(!this.host.isConnected||this.host.liveTransport!==transport||!transport.connected||transport.generation!==transportGeneration||!this.allowed('vacuum')||this.host.liveSnapshot?.bootId!==bootId||this.host.liveSnapshot?.roomId!==roomId)return;if(this.host.liveHomePending){if(++attempts<40)this.robotReadTimer=setTimeout(read,250);return;}void this.host.loadLiveHome?.();};
  read();
 }
 async robotDirectIntent(entityId,action){
  const transport=this.host.liveTransport,snapshot=this.host.liveSnapshot,requestId=globalThis.crypto.randomUUID(),issuedAt=Date.now(),diag={domain:'vacuum',action,requestId,resourceId:entityId};
  this.journalDevice(transport,'control_intent',{...diag,code:'start'});
  const device=this.host.state.devices.find(row=>row.id===entityId&&row.kind==='vacuum'),offer=this.robotDirectOffer(device),fence=this.robotOverviewFence;
  const reject=code=>{this.journalDevice(transport,'control_intent',{...diag,code});return false;};
  if(!['pause','resume','stop','return'].includes(action)||!offer?.actions.includes(action))return reject('capability_missing');
  // A tap while this screen's robot command runs is queued and sent once it settles (S2, S3).
  const ownRobotCommand=this.pending&&this.activeOperation?.domain==='vacuum';
  const priorRobotOperation=this.robotOverviewOperation||(ownRobotCommand?this.activeOperation:null);
  if(priorRobotOperation&&priorRobotOperation.target.entityId!==entityId)return reject('intent_pending');
  if(!ownRobotCommand&&(this.pending||device.pending)){
   const message='Robotten svarer stadig på den forrige kommando · prøv igen om et øjeblik.';
   this.host.showFeedback?.(message,false,{source:'robot'});
   return reject('intent_pending');
  }
  
  const swap={pause:'resume',resume:'pause'};
  this.robotOptimistic = {entityId,
   status: {pause:'paused',resume:'cleaning',stop:'stopped',return:'docking'}[action], at:Date.now(),
   actions: swap[action]?offer.actions.map(row=>row===action?swap[row]:row):null};
  clearTimeout(this.robotOptimisticTimer);this.robotOptimisticTimer=setTimeout(()=>{this.robotOptimisticTimer=null;if(!this.host.isConnected)return;this.refreshRobotOverview();const d=this.robotDevice();if(d)this.robotPanel?.observed?.(this.robotView(d),{directActions:this.robotDirectOffer(d)?.actions||[],directPendingAction:this.robotDirectOffer(d)?.pending??null});},10050);
  if(priorRobotOperation){this.robotQueued={entityId,action,operation:priorRobotOperation};this.refreshRobotOverview();this.robotPanel?.observed?.(this.robotView(device),{directActions:this.robotDirectOffer(device)?.actions||[],directPendingAction:this.robotDirectOffer(device)?.pending??null});this.journalDevice(transport,'control_intent',{...diag,code:'queued'});return true;}
  const transportGeneration=transport.generation,current=()=>this.host.isConnected&&this.host.liveTransport===transport&&transport.connected&&transport.generation===transportGeneration&&this.host.liveSnapshot?.bootId===snapshot.bootId&&this.host.liveSnapshot?.roomId===snapshot.roomId&&this.allowed('vacuum');
  const operation={key:snapshot.bootId+':'+requestId,bootId:snapshot.bootId,roomId:snapshot.roomId,domain:'vacuum',direct:true,target:{entityId},label:({pause:'Pause',resume:'Fortsæt',stop:'Afslut rengøring',return:'Kør til basen'})[action],action,observedRevision:device.revision};
  let outcome='unknown';
  this.robotOverviewOperation=operation;this.remember(operation,'pending',requestId);this.refreshRobotOverview();this.robotPanel?.observed?.(this.robotView(device),{directActions:this.robotDirectOffer(device)?.actions||[],directPendingAction:this.robotDirectOffer(device)?.pending??null});
  try{
   const result=await transport.controlIntent({bootId:snapshot.bootId,roomId:snapshot.roomId,domain:'vacuum',action,target:{entityId},args:{},requestId,issuedAt});
   outcome=result.outcome;
   this.remember(operation,result.outcome,requestId,result);
   if(current()&&['accepted','unknown'].includes(result.outcome))this.trackDeviceJournal('vacuum',operation,requestId,undefined,entityId,current);
   if(current()){this.robotOverviewFence={bootId:snapshot.bootId,roomId:snapshot.roomId,entityId,revision:device.revision,outcome:result.outcome};if(result.outcome==='accepted'||result.outcome==='unknown')this.scheduleRobotObservation(transport,snapshot.bootId,snapshot.roomId,transportGeneration);}
   return true;
  }catch{this.remember(operation,'unknown',requestId);if(current())this.trackDeviceJournal('vacuum',operation,requestId,undefined,entityId,current);if(current()){this.robotOverviewFence={bootId:snapshot.bootId,roomId:snapshot.roomId,entityId,revision:device.revision,outcome:'unknown'};this.scheduleRobotObservation(transport,snapshot.bootId,snapshot.roomId,transportGeneration);}return true;}
  finally{
   const owned=this.robotOverviewOperation===operation;
   if(owned)this.robotOverviewOperation=null;
   if(owned&&outcome==='rejected'&&this.robotOptimistic?.entityId===entityId)this.robotOptimistic=null;
   const queued=this.robotQueued?.operation===operation?this.robotQueued:null;
   if(queued){
    this.robotQueued=null;this.robotOptimistic=null;
    if(owned&&current()){
     if(outcome==='accepted')void this.robotDirectIntent(queued.entityId,queued.action);
     else this.host.showFeedback?.('Robottens næste kommando blev ikke sendt.',false,{source:'robot'});
    }
   }
   if(owned&&current()){this.robotPanel?.observed?.(this.robotView(this.robotDevice()),{directPendingAction:this.robotDirectOffer(this.robotDevice())?.pending??null});this.refreshRobotOverview();this.render();}
  }
 }
 robotOverviewContext(device){
  const snapshot=this.host.liveSnapshot,transport=this.host.liveTransport;
  if(this.suspending||!this.host.isConnected||!this.allowed('vacuum')||!['now','photo'].includes(this.host.state.focus)||device?.live!==true||device.stale||device.presentationOnly||!['cleaning','paused'].includes(device.status)||!this.host.state.devices.includes(device))return null;
  return {key:JSON.stringify([snapshot.bootId,snapshot.roomId,this.host.state.focus,device.id,device.status]),bootId:snapshot.bootId,roomId:snapshot.roomId,entityId:device.id,status:device.status,revision:device.revision,transport,transportGeneration:transport.generation};
 }
 robotOverviewCurrent(context){const device=this.host.state.devices.find(row=>row.id===context?.entityId);return !!context&&this.robotOverviewContext(device)?.key===context.key&&this.host.liveTransport===context.transport&&context.transport.generation===context.transportGeneration;}
 robotOverviewAction(device){
  const context=this.robotOverviewContext(device),offer=this.robotDirectOffer(device),view=this.robotView(device),action=view?.status==='cleaning'?'pause':view?.status==='paused'?'resume':null;
  if(!context||!action||!offer?.actions.includes(action))return null;
  return {id:action,label:action==='pause'?'Pause':'Fortsæt',resourceId:device.id,status:view.status,revision:device.revision,disabled:false};
 }
 refreshRobotOverview(){for(const device of this.host.state.devices){const row=this.host.deviceRows?.get(device.id);if(row)this.host.renderOverviewAction?.(row,device);}}
 async prepareRobotOverview(){} // The native home observation owns this offer.
 async robotOverviewIntent(entityId,action){const device=this.host.state.devices.find(row=>row.id===entityId),choice=this.robotOverviewAction(device);if(!choice||choice.id!==action)return false;return this.robotDirectIntent(entityId,action);}
 currentRobotSetup(device){
  clearTimeout(this.robotSetupExpiry);this.robotSetupExpiry=null;
  const snapshot=this.host.liveSnapshot,scope=JSON.stringify([snapshot?.bootId,snapshot?.roomId]),setup=typeof snapshot?.bootId==='string'&&!!snapshot.bootId&&typeof snapshot?.roomId==='string'&&!!snapshot.roomId&&device?.live===true&&!device.stale&&['cleaning','paused'].includes(device.status)&&this.host.liveTransport?.connected===true&&this.host.state.homeScope===scope?robotCurrentSetup(device.currentSetup,device.id):null;
  if(setup){const panel=this.robotPanel,target=device.id,expiry=setup.observedAt*1000+60001;this.robotSetupExpiry=setTimeout(()=>{if(this.robotPanel!==panel||this.robotDevice()?.id!==target)return;this.robotPanel?.observed?.(this.robotView(this.robotDevice()),{currentSetup:null});},Math.max(0,expiry-Date.now()));}
  return setup;
 }
 robotDevice(){return this.host.state.devices.find(d=>d.kind==='vacuum'&&d.id===this.target?.entityId);}
 buildOptions(){if(this.task?.domain==='vacuum'||this.domain==='vacuum'){const device=this.robotDevice(),existing=this.robotPanel,panel=existing||document.createElement('pv-robot-control-panel'),scrollOwner=this.host.querySelector?.('#device-view'),scrollTop=scrollOwner?.scrollTop;panel.data={task:this.task,device:this.robotView(device),presentationScope:this.host.liveTransport?{bootId:this.host.liveSnapshot?.bootId,roomId:this.host.liveSnapshot?.roomId,transport:this.host.liveTransport,generation:this.host.liveTransport.generation,deviceId:device?.id}:null,currentSetup:this.currentRobotSetup(device),loading:this.setupPending,connected:!!this.host.liveTransport?.connected,history:device?.history,readOnly:!this.allowed('vacuum')||device?.live!==true||!!device.stale,directActions:this.robotDirectOffer(device)?.actions||[],directReadGap:this.robotTransientHomeRead(device),directBlocked:this.robotDirectBlocked(device),directPendingAction:this.robotDirectOffer(device)?.pending??null};if(!existing){panel.addEventListener('robot-draft-changed',()=>setTimeout(()=>this.persistRobotDraft(),0));panel.addEventListener('robot-control-expired-start',event=>this.queueExpiredRobotStart(event.detail.optionId));panel.addEventListener('robot-control-action',event=>this.send(event.detail.optionId,event.detail.args));panel.addEventListener('robot-direct-action',event=>this.robotDirectIntent(this.target?.entityId,event.detail.action));panel.addEventListener('robot-control-recipe',event=>this.openRobot(this.opener,event.detail.recipeId));}this.robotPanel=panel;this.currentRobotSetup(device);panel.disabled=!this.task;if(panel.renewalDiagnostic){this.host.liveTransport?.recordDiagnostic?.('robot_renewal',{code:panel.renewalDiagnostic});panel.renewalDiagnostic=null;}
   // Remove the expired-offer helper without detaching the current robot panel.
   if(panel.parentNode===this.body){
    for(const child of [...this.body.children])if(child!==panel)child.remove();
   }else this.body.replaceChildren(panel);
   if(scrollOwner)scrollOwner.scrollTop=scrollTop;
   return;
  }
  this.body.replaceChildren();this.robotPanel=null;for(const option of this.task.options){const section=make('section',undefined,'pv-content'),form=make('form',undefined,'pv-content'),schema=option.argsSchema;if(schema.kind!=='none'&&!(this.task.domain==='light'&&schema.kind==='percent'))form.append(make('h3',option.label));
   if(schema.kind==='choice'){const grid=make('div',undefined,'pv-actions');for(const c of schema.choices){const label=make('label'),input=make('input');input.type='radio';input.name='choiceId';input.value=c.id;input.required=true;if(this.task.domain==='light'&&option.action==='scene'&&schema.choices.length===1)input.checked=true;label.append(input,make('span',c.label));grid.append(label);}form.append(grid);}
   if(schema.kind==='cleaning'){const grid=make('div',undefined,'pv-actions');for(const area of schema.areas){const label=make('label'),input=make('input');input.type='checkbox';input.name='areaIds';input.value=area.id;label.append(input,make('span',area.label));grid.append(label);}const repeat=make('select');repeat.name='repeat';repeat.setAttribute('aria-label','Antal rengøringer');for(let n=1;n<=3;n++){const o=make('option',n===1?'1 gang':n+' gange');o.value=String(n);repeat.append(o);}form.append(grid,repeat);}
   if(schema.kind==='percent'){const label=make('label',this.task.domain==='light'?'Lysstyrke':'Vælg lydstyrke'),input=make('input'),value=make('output');input.type='range';input.name='percent';input.min='0';input.max=String(this.task.domain==='music'?100:schema.max);input.step='1';const observedPercent=this.task.domain==='light'?this.lightContext?.brightnessPercent??null:this.task.volume;input.value=String(observedPercent===null?50:Math.min(schema.max,observedPercent));value.textContent=observedPercent===null?(this.task.domain==='light'?'Vælg lysstyrke': 'Vælg på skyderen'):input.value+' %';input.setAttribute('aria-label',this.task.domain==='light'?'Lysstyrke':'Vælg lydstyrke');applyKitComponent(input,'slider');input.addEventListener('input',()=>{const attempted=Number(input.value),limited=this.task?.domain==='music'&&Number.isInteger(attempted)&&attempted>schema.max;if(limited){input.value=String(schema.max);syncKitSlider(input);}value.textContent=input.value+' %'+(limited?' · Højst '+schema.max+' %':'');form.querySelector('[type=submit]').disabled=false;});label.append(input,value);form.append(label);}
   const submit=make('button',schema.kind==='none'?option.label:schema.kind==='percent'?(this.task.domain==='light'?'Indstil lysstyrke':'Indstil lydstyrke'):schema.kind==='choice'?(this.task.domain==='light'&&option.action==='scene'?'Aktivér scene':'Anvend indstilling'):'Start rengøring','pv-button pv-primary');submit.type='submit';submit.disabled=schema.kind==='percent'&&(this.task.domain==='light'?this.lightContext?.brightnessPercent==null:this.task.volume===null);form.append(submit);form.addEventListener('submit',event=>{event.preventDefault();let args={};if(schema.kind==='choice')args={choiceId:form.elements.choiceId.value};if(schema.kind==='cleaning')args={areaIds:[...form.querySelectorAll('[name=areaIds]:checked')].map(x=>x.value),repeat:Number(form.elements.repeat.value)};if(schema.kind==='percent')args={percent:Number(form.elements.percent.value)};this.send(option.id,args);});section.append(form);this.body.append(section);}}
 async send(optionId,input){this.render();const task=this.task;if(!task||task.draft?.status==='awaiting_water'||this.pending||this.spent.has(task.taskId)||!this.allowed(task.domain)||task.domain==='light'&&([...this.lightActions?.values()||[]].some(entry=>entry.operation)||!this.lightContext?.current())||task.domain==='music'&&(JSON.stringify(this.musicContext()?.target)!==JSON.stringify(this.target)||task.expectedBindingId!==this.target.expectedBindingId)||task.domain==='vacuum'&&(this.robotControlOffer?.task!==task||!this.robotControlCurrent(this.robotControlOffer?.context)||this.robotDevice()?.live!==true||this.robotDevice()?.stale||this.robotInline&&this.host.state.focus!==this.target?.entityId))return;let args;try{args=controlArgs(task,optionId,input);}catch{this.note.textContent='Kontrollér dit valg, eller hent en ny betjening.';return;}this.spent.set(task.taskId,task.expiresAt);this.pending=true;const operation={key:task.bootId+':'+task.taskId,bootId:task.bootId,roomId:task.roomId,taskId:task.taskId,domain:task.domain,optionId,observedRevision:task.domain==='vacuum'?this.robotDevice()?.revision:null,...(task.domain==='vacuum'?{choiceId:typeof args.choiceId==='string'?args.choiceId:null,value:typeof args.value==='number'?args.value:null}:{}),target:{...this.target},label:task.options.find(x=>x.id===optionId).label};this.activeOperation=operation;if(task.domain==='vacuum'){const selected=task.options.find(row=>row.id===optionId);operation.action=selected.action==='set_option'?'settings':selected.action==='reuse'?'start':selected.action;operation.settingKey=selected.settingKey;this.journalDevice(this.host.liveTransport,'control_intent',{domain:'vacuum',action:operation.action,resourceId:operation.target.entityId,code:'start',...(typeof args.value==='boolean'||typeof args.value==='number'?{requestedValue:args.value}:{})});}this.remember(operation,'pending');this.note.textContent='';for(const el of this.body.querySelectorAll('button,input,select'))el.disabled=true;this.render();const generation=this.generation,opening=this.opening,transport=this.host.liveTransport,transportGeneration=transport.generation;let refreshScene=false,outcome='unknown';
  try{
   const option=task.options.find(row=>row.id===optionId);
   if(task.domain==='vacuum'&&(option?.action==='start'&&option.argsSchema?.kind==='cleaning'
     ||option?.action==='dock'&&option.argsSchema?.kind==='dock')){
    operation.receiptTask=task;
    operation.receiptTransport=transport;
    operation.receiptTransportGeneration=transportGeneration;
   }
   const result=await this.host.liveTransport.controlAction(task,optionId,args);outcome=result.outcome;refreshScene=task.domain==='light'&&!!this.target?.sceneId&&result.outcome==='accepted';this.remember(operation,result.outcome,result.requestId,result);if(task.domain==='vacuum'){this.journalDevice(transport,'control_action',{domain:'vacuum',action:operation.action,requestId:result.requestId,resourceId:operation.target.entityId,code:result.outcome});if(['accepted','unknown'].includes(result.outcome))this.trackDeviceJournal('vacuum',operation,result.requestId,typeof args.value==='boolean'||typeof args.value==='number'?args.value:undefined,operation.target.entityId,()=>this.host.isConnected&&this.host.liveTransport===transport&&transport.connected&&transport.generation===transportGeneration&&this.host.liveSnapshot?.bootId===task.bootId&&this.host.liveSnapshot?.roomId===task.roomId&&this.allowed('vacuum'));}if(generation!==this.generation||opening!==this.opening||!this.host.isConnected)return;if(task.domain==='vacuum'&&result.outcome==='accepted'){if(task.options.find(row=>row.id===optionId)?.action==='start')this.clearStoredRobotDraft(this.target);this.robotAwait={...operation,observedRevision:this.robotDevice()?.revision};if(task.options.find(row=>row.id===optionId)?.action==='set_option')this.scheduleRobotObservation(transport,task.bootId,task.roomId,transportGeneration);}this.note.textContent=task.domain==='vacuum'?'':result.partial&&result.outcome!=='accepted'?'Nogle indstillinger blev ændret. Rengøringen er ikke bekræftet startet.':result.ok?'Anmodningen er modtaget.':result.outcome==='unknown'?'Udfaldet er ukendt · handlingen gentages ikke.':'Handlingen blev afvist · hent aktuel betjening.';if(result.outcome!=='unknown'){const refresh=make('button','Hent aktuel betjening','pv-button pv-ghost');refresh.type='button';refresh.addEventListener('click',()=>this.open(this.domain,this.target,this.opener,this.recipeId));this.body.append(refresh);}}
  catch{this.remember(operation,'unknown');if(generation===this.generation&&opening===this.opening&&this.host.isConnected)this.note.textContent=task.domain==='vacuum'?'':'Udfaldet er ukendt · handlingen gentages ikke.';}
  finally{
   const owned=this.activeOperation===operation;
   if(owned){clearTimeout(this.slowTimer);this.pending=false;this.activeOperation=null;}
   const queued=this.robotQueued?.operation===operation?this.robotQueued:null;
   if(queued){
    this.robotQueued=null;this.robotOptimistic=null;
    const current=owned&&generation===this.generation&&opening===this.opening&&this.host.isConnected
     &&this.host.liveTransport===transport&&transport.connected&&transport.generation===transportGeneration
     &&this.host.liveSnapshot?.bootId===task.bootId&&this.host.liveSnapshot?.roomId===task.roomId
     &&this.target?.entityId===queued.entityId&&this.allowed('vacuum');
    if(current){
     if(outcome==='accepted')void this.robotDirectIntent(queued.entityId,queued.action).then(sent=>{
      if(!sent)this.host.showFeedback?.('Robottens næste kommando blev ikke sendt.',false,{source:'robot'});
     });
     else this.host.showFeedback?.('Robottens næste kommando blev ikke sendt.',false,{source:'robot'});
    }
   }
   if(this.host.isConnected)this.render();
  }
  if(refreshScene&&typeof this.host.readLightArea==='function'&&generation===this.generation&&opening===this.opening&&this.controlOpen()&&this.lightContext?.current()){const previous=this.lightContext,refreshed=await this.host.readLightArea(this.target.areaId,{preserveControls:true});if(refreshed===true&&generation===this.generation&&opening===this.opening&&this.controlOpen()&&previous.current())await this.openLight(this.target,previous.observation(),this.opener,previous.observation);}
 }
 cleanup(){clearTimeout(this.robotSetupExpiry);this.robotSetupExpiry=null;for(const entry of this.lightActions?.values()||[])if(entry.operation)entry.operation.revoked=true;this.lightActions=new Map();this.robotEntryKey=null;this.robotAwait=null;this.suspending=true;clearTimeout(this.slowTimer);clearTimeout(this.expiryTimer);this.invalidate();this.suspending=false;}
}
