import {scopedLightsObservation} from './ha-home-observation.js';
import {applyKitComponent,applyKitDialog,syncKitSlider} from './ui/kit.js';
import {renderPlayerControls} from './player-view.js';
import {controlTask,controlArgs} from './control-model.js';
import {roomObservationCurrent,roomObservationDisplay,roomObservationBound,playbackBinding} from './media-observation.js';
import './robot-control-panel.js';
const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;if(tag==='button')applyKitComponent(n,'button',{variant:cls?.split(/\s+/).includes('pv-primary')?'primary':'secondary'});return n;};
// Presentation-only client. All tickets, scopes and effect owners stay server-side.
export class LiveControlView{
 constructor(host){this.host=host;this.generation=0;this.opening=0;this.spent=new Map();this.receipts=new Map();this.dialog=make('dialog',undefined,'pv-component');const header=make('header'),title=make('h2','Betjening'),close=make('button','Luk','dialog-close');this.title=title;title.id='control-title';this.dialog.setAttribute('aria-labelledby',title.id);close.type='button';close.addEventListener('click',()=>this.dialog.close());header.append(title,close);this.note=make('p','', 'pv-meta');this.note.setAttribute('role','status');this.body=make('div',undefined,'pv-content');this.receiptNote=make('p','','pv-meta');this.receiptNote.setAttribute('role','status');this.receiptNote.hidden=true;this.dialog.append(header,this.note,this.receiptNote,this.body);applyKitDialog(this.dialog,{header,description:this.note,content:this.body,close});host.append(this.dialog);this.dialog.addEventListener('close',()=>{this.opening++;this.clearRobotRefresh();this.task=null;this.robotSuggestion=null;clearTimeout(this.expiryTimer);this.body.replaceChildren();this.robotPanel=null;this.body.setAttribute('aria-busy','false');if(this.opener?.isConnected)this.opener.focus();});
  this.musicButton=make('button','Betjen musik','text-control');this.musicButton.type='button';this.musicButton.addEventListener('click',()=>this.openMusic(this.musicButton));
  this.musicStatus=make('p');this.musicStatus.hidden=true;this.musicDetailStatus=this.musicStatus;
  for(const id of ['volume','detail-volume']){const input=document.getElementById(id);if(!input)continue;input.addEventListener('pointerdown',()=>{this.musicVolumeGesture=input;});input.addEventListener('input',()=>{
   const context=this.musicContext(),offer=this.currentVolumeOffer(context),options=offer?.task.options.filter(option=>option.action==='volume')||[],option=options.length===1?options[0]:null;
   if(input.disabled||!context||offer?.context.key!==context.key||offer.task.expiresAt*1000<=Date.now()||this.pending||this.setupPending||this.musicIntentPending||this.spent.has(offer.task.taskId)||!Number.isInteger(offer.task.volume)||!option)return;
   const attempted=Number(input.value);if(!Number.isInteger(attempted))return;const legal=Math.max(option.argsSchema.min,Math.min(option.argsSchema.max,attempted));
   if(legal!==attempted){input.value=String(legal);this.host.showFeedback?.(`Højst ${option.argsSchema.max} %`,false,{source:'music-volume'});}
   input.setAttribute('aria-valuetext',`${legal} %`);const output=document.getElementById(id==='volume'?'volume-value':'detail-volume-value');if(output)output.textContent=`${legal} %`;syncKitSlider(input);
  });for(const event of ['pointerup','pointercancel','change','blur'])input.addEventListener(event,()=>{if(this.musicVolumeGesture===input)this.musicVolumeGesture=null;});}
  this.robotButton=make('button','Betjen robot','text-control');this.robotButton.setAttribute('data-robot-control','true');this.robotButton.type='button';this.robotButton.addEventListener('click',()=>this.openRobot(this.robotButton));
 }
 allowed(domain){return this.host.liveTransport?.connected&&this.host.liveSnapshot?.capabilities.controlSetup?.includes(domain);}
 render(){
  if(this.domain==='light'&&this.lightContext&&!this.lightContext.current()){this.lightContext=null;this.invalidate('Lysenes adgang eller område er ændret · hent betjeningen igen.',false);}
  const snapshot=this.host.liveSnapshot,authority=JSON.stringify([snapshot?.bootId,snapshot?.roomId,!!this.host.liveTransport?.connected,!!this.allowed('vacuum')]);
  if(this.domain!=='light'&&this.authority!==undefined&&this.authority!==authority)this.invalidate('Adgangen eller forbindelsen er ændret · hent betjeningen igen.',false);
  this.authority=authority;const musicAuthority=this.musicContext()?.key??null;if(this.musicAuthority!==undefined&&this.musicAuthority!==musicAuthority)this.invalidateMusic('Musikken er ændret · hent betjeningen igen.',false);this.musicAuthority=musicAuthority;
  if(this.task&&this.task.expiresAt*1000<=Date.now())this.expireTask();
  const p=this.host.liveMedia?.playback,d=this.host.state.devices.find(x=>x.id===this.host.state.focus&&x.kind==='vacuum');this.musicButton.hidden=!this.allowed('music')||!roomObservationCurrent(p,snapshot);this.musicButton.disabled=this.pending||this.setupPending||this.musicIntentPending;this.robotButton.hidden=!d?.live;this.robotButton.disabled=!!(this.pending||this.setupPending||this.musicIntentPending);const robotEntryLabel=this.allowed('vacuum')&&!d?.stale?'Betjen robot':'Se robot';if(this.robotButton.textContent!==robotEntryLabel)this.robotButton.textContent=robotEntryLabel;
  const robotCard=d&&this.host.deviceNodes?.get(d.id);if(robotCard){if(!this.robotEntry){this.robotEntry=make('section',undefined,'device-history');this.robotEntry.dataset.robotRooms='true';this.robotEntry.append(make('h2','Rum og rengøring'),this.robotButton);}if(this.robotEntry.parentNode!==robotCard.parentNode.parentNode)robotCard.parentNode.after(this.robotEntry);this.robotEntry.hidden=false;}else if(this.robotEntry)this.robotEntry.hidden=true;if(robotCard&&robotCard.dataset.controlEntry!=='true')robotCard.dataset.controlEntry='true';
  if(this.robotPanel&&this.dialog.open&&this.domain==='vacuum'){const device=this.robotDevice(),ready=!!(this.task&&!this.pending&&!this.setupPending&&!this.musicIntentPending&&!this.spent.has(this.task.taskId)&&this.allowed('vacuum')&&device?.live===true&&!device.stale);this.robotPanel.observed?.(device,{loading:this.setupPending,connected:!!this.host.liveTransport?.connected,pendingOptionId:this.pending&&this.activeOperation?.domain==='vacuum'&&this.activeOperation.taskId===this.task?.taskId?this.activeOperation.optionId:null});this.robotPanel.disabled=!ready;const candidates=ready?[this.robotSuggestion,...(Array.isArray(snapshot.robotSuggestions)&&snapshot.robotSuggestions.length<=12?snapshot.robotSuggestions:[])]:[];this.robotPanel.suggest?.(candidates.find(value=>this.robotPanel.validSuggestion?.(value)));}
  if(this.refreshButton)this.refreshButton.disabled=!this.canRefreshRobot();
  this.renderReceipt();this.renderMusicControls();if(!this.suspending){this.prepareMusic();this.prepareVolume();}
 }
 receiptText(row){return row.outcome==='accepted'?'Anmodningen er modtaget.':row.outcome==='unknown'?'Udfaldet er ukendt · handlingen gentages ikke.':row.outcome==='pending'?'':'Handlingen blev afvist.';}
 remember(operation,outcome,requestId){
  const row={...operation,outcome,requestId};this.receipts.delete(operation.key);this.receipts.set(operation.key,row);
  while(this.receipts.size>16)this.receipts.delete(this.receipts.keys().next().value);
  if(this.host.isConnected)this.renderReceipt();
 }
 renderReceipt(){
  const s=this.host.liveSnapshot,target=JSON.stringify(this.target),row=[...this.receipts.values()].reverse().find(r=>r.bootId===s?.bootId&&r.roomId===s?.roomId&&r.domain===this.domain&&JSON.stringify(r.target)===target);
  const visible=row&&row.outcome!=='pending';this.receiptNote.hidden=!visible;this.receiptNote.textContent=visible?`${row.label}: ${this.receiptText(row)}`:'';
 }
 invalidateMusic(message='Musikken er ændret · hent betjeningen igen.',render=true){
  // Music observations cannot revoke a different domain's task or async owner.
  this.musicGeneration=(this.musicGeneration||0)+1;this.musicOffer=null;this.musicAttempt=null;this.musicAttemptPoll=null;this.musicRead=null;this.musicReadPending=false;this.volumeOffer=null;this.volumeAttempt=null;this.volumeRead=null;clearTimeout(this.volumeExpiryTimer);clearTimeout(this.musicExpiryTimer);
  const operation=this.activeOperation;
  if(this.pending&&operation?.domain==='music'){this.remember(operation,'unknown');if(this.musicFence)this.musicFence={...this.musicFence,outcome:'unknown'};}
  else if(this.musicFence?.outcome!=='unknown')this.musicFence=null;
  if(this.task?.domain==='music'||(!this.task&&this.dialog.open&&this.domain==='music'&&!this.musicIntentPending))this.invalidate(message,false);
  if(render)this.render();
 }
 invalidate(message='Forbindelsen mangler · hent betjeningen igen.',render=true){
  this.clearRobotRefresh();this.musicGeneration=(this.musicGeneration||0)+1;this.generation++;this.opening++;this.body.setAttribute('aria-busy','false');this.task=null;this.robotSuggestion=null;this.musicOffer=null;this.musicAttempt=null;this.musicAttemptPoll=null;this.musicRead=null;this.musicReadPending=false;this.volumeOffer=null;this.volumeAttempt=null;this.volumeRead=null;clearTimeout(this.volumeExpiryTimer);clearTimeout(this.musicExpiryTimer);clearTimeout(this.expiryTimer);
  if(this.pending&&this.musicFence)this.musicFence={...this.musicFence,outcome:'unknown'};
  if(this.pending&&this.activeOperation){this.remember(this.activeOperation,'unknown');this.note.textContent='Forbindelsen blev afbrudt · handlingen gentages ikke.';}else if(this.dialog.open)this.note.textContent=message;
  for(const el of this.body.querySelectorAll('button,input,select'))el.disabled=true;if(this.robotPanel)this.robotPanel.disabled=true;if(render)this.render();
 }
 musicContext(){
  const p=this.host.liveMedia?.playback,s=this.host.liveSnapshot;
  if(this.suspending||!this.host.isConnected||!this.allowed('music')||!roomObservationCurrent(p,s)||!p?.target?.id||!['playing','paused'].includes(p.state)||typeof p.config_entry_id!=='string'||!p.config_entry_id||typeof p.owner_epoch!=='string'||!p.owner_epoch)return null;
  const binding=playbackBinding(p,s,p.config_entry_id);if(!binding)return null;
  const target={accountId:p.config_entry_id,kind:'spotify_device',targetId:p.target.id,expectedBindingId:binding.bindingId};
  const key=JSON.stringify([s.bootId,s.roomId,p.config_entry_id,p.owner_epoch,p.target.id,p.item?.uri??null,p.state,binding.bindingId,binding.nativeRoomId,binding.nativeHomepodId,binding.targetId]);
  return {key,target,binding,pollSequence:p.poll_sequence,bootId:s.bootId,roomId:s.roomId};
 }
 // A measured value is display custody, never an executable control grant.
 musicVolumeMeasurement(context,offer){
  const p=this.host.liveMedia?.playback,s=this.host.liveSnapshot,transport=this.host.liveTransport,binding=p?.roomBinding;
  const bound=!this.suspending&&this.host.isConnected&&s?.capabilities?.controlSetup?.includes('music')&&roomObservationBound(p,s,this.host.liveMedia?.account??p?.config_entry_id)&&['playing','paused'].includes(p?.state)&&!this.host.liveSelection?.pendingPlayer?.();
  const key=bound?JSON.stringify([s.bootId,s.roomId,s.providerGeneration??null,p.config_entry_id,p.owner_epoch,p.target.id,binding.bindingId,binding.nativeRoomId,binding.nativeHomepodId,binding.targetId]):null;
  if(!key||this.musicMeasurement?.key!==key||this.musicMeasurement?.transport!==transport)this.musicMeasurement=null;
  if(key&&context&&offer?.context.key===context.key&&offer.task.expectedBindingId===binding.bindingId&&offer.task.expiresAt*1000>Date.now()){
   this.musicMeasurement=Number.isInteger(offer.task.volume)?{key,transport,volume:offer.task.volume}:null;
  }
  return this.musicMeasurement?.volume??null;
 }
 musicCurrent(context){return !!context&&this.musicContext()?.key===context.key;}
 pruneSpent(){for(const[id,expiry]of this.spent)if(expiry*1000<=Date.now())this.spent.delete(id);}
 async prepareMusic(){
  this.pruneSpent();
  const context=this.musicContext();if(!context||this.pending||this.setupPending||this.musicReadPending||this.musicIntentPending)return;
  if(this.musicFence?.key===context.key&&this.musicFence.outcome==='unknown')return;
  if(this.musicFence?.key===context.key&&this.musicFence.outcome==='accepted'&&context.pollSequence>this.musicFence.pollSequence){this.musicFence=null;this.musicOffer=null;this.musicAttempt=null;this.musicAttemptPoll=null;}
  if(this.musicOffer?.context.key===context.key&&this.musicOffer.task.expiresAt*1000>Date.now())return;
  if(this.musicAttempt===context.key&&this.musicAttemptPoll===context.pollSequence)return; // One read per fresh source observation; intent fences keep the stable context.
  this.musicOffer=null;this.musicAttempt=context.key;this.musicAttemptPoll=context.pollSequence;this.musicReadPending=true;const generation=this.generation,musicGeneration=this.musicGeneration||0,transport=this.host.liveTransport,transportGeneration=transport.generation,read={context,transport,generation,musicGeneration,transportGeneration};this.musicRead=read;
  try{const value=await transport.controlSetup('music',context.target);if(this.musicRead!==read||this.host.liveTransport!==transport||transport.generation!==transportGeneration||generation!==this.generation||musicGeneration!==(this.musicGeneration||0)||!this.musicCurrent(context))return;if(value.expectedBindingId!==context.target.expectedBindingId)throw Error('music_binding_changed');const task=controlTask(value,this.host.liveSnapshot,'music');this.musicOffer={task,context};if(this.musicFence?.key===context.key&&this.musicFence.readFailure===true)this.musicFence=null;clearTimeout(this.musicExpiryTimer);const issuedOffer=this.musicOffer;this.musicExpiryTimer=setTimeout(()=>{
   // Only this unused, successfully issued offer may renew its passive read.
   // Failure/intent fences keep their original one-read-per-source-poll policy.
   if(this.musicOffer!==issuedOffer||generation!==this.generation||musicGeneration!==(this.musicGeneration||0)||this.host.liveTransport!==transport||transport.generation!==transportGeneration)return;
   this.renderMusicControls();
   if(task.expiresAt*1000>Date.now()||!this.musicCurrent(context)||this.pending||this.setupPending||this.musicReadPending||this.musicIntentPending||this.spent.has(task.taskId)||this.musicFence?.key===context.key||this.musicAttempt!==context.key||this.musicAttemptPoll!==context.pollSequence)return;
   this.musicAttempt=null;this.musicAttemptPoll=null;void this.prepareMusic();
  },Math.max(0,task.expiresAt*1000-Date.now()));}
  catch{if(this.musicRead===read&&this.host.liveTransport===transport&&transport.generation===transportGeneration&&generation===this.generation&&musicGeneration===(this.musicGeneration||0)&&this.musicCurrent(context))this.musicFence={...context,outcome:'unavailable',readFailure:true};}finally{if(this.musicRead===read){this.musicRead=null;this.musicReadPending=false;if(this.host.isConnected){if(this.host.liveMedia?.render)this.host.liveMedia.render();else this.renderMusicControls();}}}
 }
 currentVolumeOffer(context=this.musicContext()){
  return [this.volumeOffer,this.musicOffer].find(offer=>context&&offer?.context.key===context.key&&offer.task.expiresAt*1000>Date.now()&&Number.isInteger(offer.task.volume)&&offer.task.options.filter(o=>o.action==='volume').length===1&&!this.spent.has(offer.task.taskId))??null;
 }
 async prepareVolume(){
  const context=this.musicContext();
  if(!context||!this.musicOffer||this.musicOffer.context.key!==context.key||this.musicOffer.task.expiresAt*1000<=Date.now()||this.currentVolumeOffer(context)||this.volumeRead||this.pending||this.setupPending||this.musicIntentPending||this.musicFence?.key===context.key&&!(this.musicFence.readFailure===true&&this.musicFence.failedAction==='volume'&&context.pollSequence>this.musicFence.pollSequence))return;
  if(this.volumeAttempt?.key===context.key&&this.volumeAttempt.pollSequence===context.pollSequence)return;
  const transport=this.host.liveTransport,generation=this.generation,musicGeneration=this.musicGeneration||0,transportGeneration=transport.generation;
  const read={context,transport};this.volumeRead=read;this.volumeAttempt=context;
  const current=()=>this.volumeRead===read&&generation===this.generation&&musicGeneration===(this.musicGeneration||0)&&this.host.liveTransport===transport&&transport.generation===transportGeneration&&this.musicCurrent(context);
  try{
   const value=await transport.controlSetup('music',context.target,undefined,{requestedAction:'volume'});
   if(!current()||this.pending||this.setupPending||this.musicIntentPending||this.musicFence?.key===context.key&&!(this.musicFence.readFailure===true&&this.musicFence.failedAction==='volume'&&context.pollSequence>this.musicFence.pollSequence))return;
   if(value.expectedBindingId!==context.target.expectedBindingId)throw Error('music_binding_changed');
   const task=controlTask(value,this.host.liveSnapshot,'music');
   if(task.options.length!==1||task.options[0].action!=='volume'||!Number.isInteger(task.volume)||this.spent.has(task.taskId))throw Error('invalid_volume_offer');
   const offer={task,context};this.volumeOffer=offer;if(this.musicFence?.key===context.key&&this.musicFence.failedAction==='volume'&&this.musicFence.readFailure===true)this.musicFence=null;clearTimeout(this.volumeExpiryTimer);
   this.volumeExpiryTimer=setTimeout(()=>{
    if(this.volumeOffer!==offer||generation!==this.generation||musicGeneration!==(this.musicGeneration||0)||this.host.liveTransport!==transport||transport.generation!==transportGeneration)return;
    this.renderMusicControls();
    if(task.expiresAt*1000>Date.now()||!this.musicCurrent(context)||this.pending||this.setupPending||this.musicIntentPending||this.musicFence?.key===context.key||this.spent.has(task.taskId))return;
    if(this.volumeAttempt===context)this.volumeAttempt=null;
    void this.prepareVolume();
   },Math.max(0,task.expiresAt*1000-Date.now()));
  }catch{/* Failure remains one passive attempt for this source poll. */}
  finally{if(this.volumeRead===read){this.volumeRead=null;if(this.host.isConnected)this.renderMusicControls();}}
 }
 renderMusicControls(){
  const context=this.musicContext(),offer=this.musicOffer;
  const fresh=!!context&&offer?.context.key===context.key&&offer.task.expiresAt*1000>Date.now();
  const options=fresh?offer.task.options:[],blocked=this.pending||this.setupPending||this.musicIntentPending||!fresh||this.spent.has(offer?.task.taskId)||this.musicFence?.key===context?.key&&this.musicFence?.outcome==='unknown';
  const has=action=>options.filter(option=>option.action===action).length===1,toggle=context&&this.host.liveMedia.playback.state==='playing'?'pause':'resume';
  const playback=this.host.liveMedia?.playback,displayPlaying=roomObservationDisplay(playback,this.host.liveSnapshot,this.host.liveMedia?.account)&&playback.state==='playing';
  const transport=has(toggle)||has('next')||has('previous');
  const volumeOffer=this.currentVolumeOffer(context),volumes=volumeOffer?.task.options.filter(option=>option.action==='volume')??[],volume=volumes.length===1?volumes[0]:null,actualVolume=this.musicVolumeMeasurement(context,volumeOffer??(offer?.task.options.some(option=>option.action==='volume')?offer:null));
  const canVolume=!!volume&&Number.isInteger(actualVolume)&&actualVolume>=0&&actualVolume<=100;
  const volumeBlocked=this.pending||this.setupPending||this.musicIntentPending||!volumeOffer||this.spent.has(volumeOffer?.task.taskId)||this.musicFence?.key===context?.key&&this.musicFence?.outcome==='unknown';
  renderPlayerControls(this.host,{playing:displayPlaying,previous:has('previous'),next:has('next'),toggle:has(toggle),blocked,volumeBlocked,volume:actualVolume,canVolume,min:volume?.argsSchema.min??0,max:volume?.argsSchema.max??100,gesture:this.musicVolumeGesture});
  const fence=this.musicFence,feedback=fence&&context&&fence.key===context.key?fence.outcome==='preparing'?'Afventer svar…':fence.outcome==='pending'?'Afventer svar…':fence.outcome==='unknown'?'Udfald ukendt · gentages ikke':fence.outcome==='accepted'?'Anmodningen er modtaget':fence.outcome==='rejected'?'Handlingen blev afvist':fence.outcome==='unavailable'?'Betjeningen kunne ikke hentes':fence.outcome==='invalid'?'Kontrollér dit valg':'' : '';
  for(const node of [this.musicStatus,this.musicDetailStatus]){node.hidden=!feedback;node.textContent=feedback;}
  if(feedback){this.host.showFeedback?.(feedback,['preparing','pending'].includes(fence.outcome));this.musicFeedback=feedback;}else if(this.musicFeedback&&this.host.feedbackMessage===this.musicFeedback){this.host.showFeedback?.('',false);this.musicFeedback='';}
  if(transport||canVolume)this.musicButton.hidden=true;
  this.host.setAttribute('data-native-music-controls',transport||canVolume?'true':'false');
 }
 async moveSpeaker(speaker,catalogueCurrent=()=>false){
  this.pruneSpent();const context=this.musicContext(),snapshot=this.host.liveSnapshot,binding=context?.binding,transport=this.host.liveTransport;
  if(!context||!binding||!catalogueCurrent()||this.pending||this.setupPending||this.musicIntentPending||this.musicFence?.key===context.key&&['unknown','accepted'].includes(this.musicFence.outcome)||speaker?.kind!=='configured_alias'||speaker.accountId!==context.target.accountId||!/^[a-f0-9]{64}$/.test(speaker.speakerId)||speaker.selectable!==true||speaker.availability!=='available'||typeof speaker.nativeRoomId!=='string'||!speaker.nativeRoomId||typeof speaker.homepodId!=='string'||! /^[1-9][0-9]{0,19}$/.test(speaker.homepodId)||speaker.nativeRoomId===binding.nativeRoomId&&speaker.homepodId===binding.nativeHomepodId)return false;
  // Explicit MOVE supersedes a passive offer read; fresh native admission still owns the effect.
  if(this.musicReadPending){this.musicGeneration=(this.musicGeneration||0)+1;this.musicRead=null;this.musicReadPending=false;}
  const generation=this.generation,musicGeneration=this.musicGeneration||0,optionId='move:'+speaker.speakerId,operationCurrent=()=>generation===this.generation&&musicGeneration===(this.musicGeneration||0)&&this.host.liveTransport===transport&&this.musicCurrent(context),current=()=>operationCurrent()&&catalogueCurrent();
  this.musicIntentPending=true;this.setupPending=true;this.musicOffer=null;this.musicAttempt=context.key;this.musicAttemptPoll=context.pollSequence;clearTimeout(this.musicExpiryTimer);this.renderMusicControls();this.host.liveOutputs?.sync();let operation=null,sent=false;
  try{
   const value=await transport.controlSetup('music',{...context.target,speakerId:speaker.speakerId});if(!current())return false;
   if(value.expectedBindingId!==context.target.expectedBindingId)throw Error('music_binding_changed');const task=controlTask(value,this.host.liveSnapshot,'music');if(task.options.length!==1||task.options[0].id!==optionId||task.options[0].action!=='move_existing_session'||task.options[0].argsSchema.kind!=='none'||this.spent.has(task.taskId))throw Error('invalid_move_offer');
   const args=controlArgs(task,optionId,{});if(!current())return false;
   this.spent.set(task.taskId,task.expiresAt);this.setupPending=false;this.pending=true;
   operation={key:task.bootId+':'+task.taskId,bootId:task.bootId,roomId:task.roomId,taskId:task.taskId,domain:'music',target:{...context.target,speakerId:speaker.speakerId},label:task.options[0].label};this.activeOperation=operation;this.musicFence={...context,outcome:'pending'};this.remember(operation,'pending');this.renderMusicControls();this.host.liveOutputs?.sync();sent=true;
   const response=transport.controlAction(task,optionId,args);try{this.host.ownerDocument?.getElementById('rooms')?.close();}catch{}const result=await response;this.remember(operation,result.outcome,result.requestId);if(!operationCurrent())return true;this.musicFence={...context,outcome:result.outcome};return true;
  }catch{if(sent&&operation){this.remember(operation,'unknown');if(operationCurrent())this.musicFence={...context,outcome:'unknown'};}else if(operationCurrent())this.musicFence={...context,outcome:'unavailable'};return sent;}
  finally{this.setupPending=false;this.musicIntentPending=false;if(operation&&this.activeOperation===operation){this.pending=false;this.activeOperation=null;}if(this.host.isConnected){this.renderMusicControls();this.host.liveOutputs?.sync();}}
 }
 async musicIntent(action,input={}){
  this.pruneSpent();
  const context=this.musicContext(),offered=action==='volume'?this.currentVolumeOffer(context):this.musicOffer;
  if(!context||this.pending||this.setupPending||this.musicIntentPending||(action!=='volume'&&this.musicReadPending)||this.musicFence?.key===context.key&&this.musicFence?.outcome==='unknown'||!offered||offered.context.key!==context.key||offered.task.expiresAt*1000<=Date.now()||this.spent.has(offered.task.taskId)||offered.task.options.filter(o=>o.action===action).length!==1||!['pause','resume','next','previous','volume'].includes(action))return false;
  if((action==='pause'&&this.host.liveMedia.playback.state!=='playing')||(action==='resume'&&this.host.liveMedia.playback.state!=='paused'))return false;
  const refreshAccepted=this.host.liveMedia?.captureAcceptedPlayRefresh?.(Object.freeze({kind:'control',action,requestedAt:Date.now(),itemUri:this.host.liveMedia.playback.item?.uri}));
  this.musicIntentPending=true;this.spent.set(offered.task.taskId,offered.task.expiresAt);this.musicFence={...context,outcome:'preparing'};this.renderMusicControls();const generation=this.generation,musicGeneration=this.musicGeneration||0,transport=this.host.liveTransport,transportGeneration=transport.generation;let operation=null,sent=false;
  try{
   // Each explicit click obtains a fresh native offer; no stored visual option
   // becomes authority for a changed account/track/owner or old permission.
   const value=await transport.controlSetup('music',context.target,undefined,action==='volume'?{requestedAction:'volume'}:{});
   if(generation!==this.generation||musicGeneration!==(this.musicGeneration||0)||this.host.liveTransport!==transport||transport.generation!==transportGeneration||!this.musicCurrent(context)||this.pending||this.setupPending||this.activeOperation)return false;
   if(value.expectedBindingId!==context.target.expectedBindingId)throw Error('music_binding_changed');const task=controlTask(value,this.host.liveSnapshot,'music'),matches=task.options.filter(o=>o.action===action),option=matches.length===1?matches[0]:null;
   if(action==='volume'){if(task.options.length!==1||task.options[0].action!=='volume')return false;this.volumeOffer={task,context};}else this.musicOffer={task,context};if(!option||this.spent.has(task.taskId))return false;
   if(action==='volume'&&task.volume===null)return false;
   let args;try{args=controlArgs(task,option.id,input);}catch{this.musicFence={...context,outcome:'invalid'};return false;}
   if(generation!==this.generation||musicGeneration!==(this.musicGeneration||0)||this.host.liveTransport!==transport||transport.generation!==transportGeneration||!this.musicCurrent(context)||this.pending||this.setupPending||this.activeOperation)return false;
   this.spent.set(task.taskId,task.expiresAt);this.pending=true;
   operation={key:task.bootId+':'+task.taskId,bootId:task.bootId,roomId:task.roomId,taskId:task.taskId,domain:'music',target:{...context.target},label:option.label};this.activeOperation=operation;
   this.musicFence={...context,outcome:'pending'};this.remember(operation,'pending');this.renderMusicControls();sent=true;
   const result=await transport.controlAction(task,option.id,args);this.remember(operation,result.outcome,result.requestId);
   if(generation!==this.generation||musicGeneration!==(this.musicGeneration||0)||this.host.liveTransport!==transport||transport.generation!==transportGeneration||!this.musicCurrent(context))return true;
   this.musicFence={...context,outcome:result.outcome};if(result.outcome==='accepted')void Promise.resolve().then(()=>refreshAccepted?.()).catch(()=>{});return true;
  }catch{if(sent&&operation){this.remember(operation,'unknown');if(generation===this.generation&&musicGeneration===(this.musicGeneration||0)&&this.musicCurrent(context))this.musicFence={...context,outcome:'unknown'};}else if(generation===this.generation&&musicGeneration===(this.musicGeneration||0)&&this.musicCurrent(context))this.musicFence={...context,outcome:'unavailable'};return sent;}
  finally{if(generation===this.generation&&musicGeneration===(this.musicGeneration||0)&&this.musicCurrent(context)&&this.musicFence?.key===context.key&&this.musicFence.outcome==='preparing')this.musicFence={...context,outcome:'unavailable'};
   if(!sent&&generation===this.generation&&musicGeneration===(this.musicGeneration||0)&&this.host.liveTransport===transport&&transport.generation===transportGeneration&&this.musicCurrent(context)&&this.musicFence?.key===context.key&&this.musicFence.outcome==='unavailable'){
    // A failed preparation never reuses its consumed display task. Only a new
    // source poll may obtain a replacement; no action is replayed.
    if(action==='volume'){this.volumeOffer=null;this.volumeAttempt=context;clearTimeout(this.volumeExpiryTimer);}
    else{this.musicOffer=null;this.musicAttempt=context.key;this.musicAttemptPoll=context.pollSequence;clearTimeout(this.musicExpiryTimer);}
    this.musicFence={...context,outcome:'unavailable',readFailure:true,failedAction:action};
   }
   this.musicIntentPending=false;if(operation&&this.activeOperation===operation){this.pending=false;this.activeOperation=null;}if(this.host.isConnected){
   this.renderMusicControls();
   // Release the shared intent slot without starting a passive preparation read.
   this.musicButton.disabled=!!(this.pending||this.setupPending||this.musicIntentPending);
   const device=this.host.state.devices.find(x=>x.id===this.host.state.focus&&x.kind==='vacuum');this.robotButton.disabled=!!(this.pending||this.setupPending||this.musicIntentPending||device?.stale);
   if(this.robotPanel&&this.dialog.open&&this.domain==='vacuum')this.robotPanel.disabled=!!(this.pending||this.setupPending||this.musicIntentPending||!this.task||this.spent.has(this.task.taskId)||!this.allowed('vacuum')||this.robotDevice()?.live!==true||this.robotDevice()?.stale);
  }}
 }
 openLight(target,observation,opener,currentObservation){
  if(!this.allowed('light')||this.pending||this.setupPending||this.musicIntentPending||!this.host.isConnected||typeof currentObservation!=='function'||!target||Object.keys(target).sort().join(',')!==(Object.hasOwn(target,'entityId')?'areaId,entityId':'areaId'))return false;
  const source=scopedLightsObservation(observation),transport=this.host.liveTransport;
  if(source?.status!=='observed'||source.scope.areaId!==target.areaId||!source.items.length)return false;
  const selected=source.items.filter(row=>!Object.hasOwn(target,'entityId')||row.entityId===target.entityId);if(!selected.length||selected.some(row=>!['on','off'].includes(row.state)))return false;
  const ids=selected.map(row=>row.entityId).sort(),scope=source.scope,members=JSON.stringify(source.items.map(row=>row.entityId).sort()),owner=()=>JSON.stringify([this.host.liveSnapshot?.bootId,this.host.liveSnapshot?.roomId,this.host.liveSnapshot?.providerGeneration,this.host.liveSnapshot?.voice,this.host.liveSnapshot?.sessionId,this.host.liveSnapshot?.taskId,this.host.liveSnapshot?.inputRevision]),ownerKey=owner();
  const context={title:Object.hasOwn(target,'entityId')?`${source.scope.areaName} · ${selected[0].name}`:`Lys · ${source.scope.areaName}`,sourceEpoch:source.sourceEpoch,scope:source.scope,ids,brightness:selected.every(row=>row.supportsBrightness),current:()=>{let current;try{current=scopedLightsObservation(currentObservation());}catch{return false;}return this.host.isConnected&&this.host.liveTransport===transport&&this.allowed('light')&&owner()===ownerKey&&current?.status==='observed'&&current.sourceEpoch===source.sourceEpoch&&Object.keys(scope).every(key=>current.scope[key]===scope[key])&&JSON.stringify(current.items.map(row=>row.entityId).sort())===members&&ids.every(id=>current.items.some(row=>row.entityId===id&&['on','off'].includes(row.state)&&row.supportsBrightness===selected.find(item=>item.entityId===id).supportsBrightness));}};
  if(!context.current())return false;this.lightContext=context;return this.open('light',{...target},opener);
 }
 openMusic(opener){const context=this.musicContext();if(!context)return;this.open('music',context.target,opener);}
 openRobot(opener,recipeId){const d=this.host.state.devices.find(x=>x.id===this.host.state.focus&&x.kind==='vacuum');if(!d?.live||this.pending||this.setupPending||this.musicIntentPending||!this.host.isConnected)return;if(!this.allowed('vacuum')||d.stale){this.opening++;clearTimeout(this.expiryTimer);this.clearRobotRefresh();this.opener=opener;this.domain='vacuum';this.target={entityId:d.id};this.task=null;this.robotSuggestion=null;this.title.textContent='Robotstøvsuger';this.note.textContent='Kun status og pleje er tilgængelig.';this.buildOptions();this.body.setAttribute('aria-busy','false');if(!this.dialog.open)this.dialog.showModal();return;}this.open('vacuum',{entityId:d.id},opener,recipeId);}
 async open(domain,target,opener,recipeId,refreshContext){if(domain==='music'&&JSON.stringify(this.musicContext()?.target)!==JSON.stringify(target))return;if(this.pending||this.setupPending||this.musicIntentPending||!this.host.isConnected||!this.allowed(domain)||domain==='light'&&!this.lightContext?.current())return;this.render();for(const[id,expiry]of this.spent)if(expiry*1000<=Date.now())this.spent.delete(id);const retain=this.domain===domain&&JSON.stringify(this.target)===JSON.stringify(target);this.title.textContent=domain==='music'?'Betjen musik':domain==='light'?this.lightContext.title:'Rengøring';this.opener=opener;this.domain=domain;this.target=target;this.recipeId=recipeId;this.task=null;if(!retain)this.body.replaceChildren();for(const el of this.body.querySelectorAll('button,input,select'))el.disabled=true;if(this.robotPanel)this.robotPanel.disabled=true;this.body.setAttribute('aria-busy','true');this.note.textContent=domain==='light'?'Henter aktuel betjening…':'';if(!this.dialog.open)this.dialog.showModal();const opening=++this.opening,generation=this.generation;this.setupPending=true;if(domain==='vacuum'&&(!retain||!this.robotPanel))this.buildOptions();this.render();
  try{const snap=this.host.liveSnapshot,value=await this.host.liveTransport.controlSetup(domain,target,recipeId);if(opening!==this.opening||generation!==this.generation||!this.host.isConnected||!this.allowed(domain)||!this.dialog.open||this.host.liveSnapshot.bootId!==snap.bootId||this.host.liveSnapshot.roomId!==snap.roomId)return;if(refreshContext&&(this.expiredRobot!==refreshContext||this.pending||this.activeOperation||this.musicIntentPending||this.robotDevice()?.live!==true||this.robotDevice()?.stale||[...this.receipts.values()].some(row=>row.bootId===snap.bootId&&row.roomId===snap.roomId&&row.domain==='vacuum'&&JSON.stringify(row.target)===refreshContext.target&&row.outcome==='unknown')))return;if(domain==='music'&&(JSON.stringify(this.musicContext()?.target)!==JSON.stringify(target)||value.expectedBindingId!==target.expectedBindingId))throw Error('music_binding_changed');const admitted=controlTask(value,this.host.liveSnapshot,domain);if(domain==='light'&&(!this.lightContext?.current()||Object.keys(this.lightContext.scope).some(key=>admitted.lightSetup.scope[key]!==this.lightContext.scope[key])||JSON.stringify([...admitted.lightSetup.entityIds].sort())!==JSON.stringify(this.lightContext.ids)||admitted.options.some(option=>option.action==='brightness')&&!this.lightContext.brightness))throw Error('light_scope_changed');if(admitted.historyDraft&&(domain!=='vacuum'||typeof recipeId!=='string'||!recipeId))throw Error('unrequested_history_draft');this.task=admitted;this.robotSuggestion=domain==='vacuum'?value.setup?.robotSuggestion:null;this.note.textContent=domain==='vacuum'&&this.task.options.some(option=>option.action==='start'&&option.argsSchema.kind==='cleaning')?'':this.task.mapName||'Vælg en handling';this.buildOptions();clearTimeout(this.expiryTimer);this.expiryTimer=setTimeout(()=>{if(this.task){this.expireTask();this.render();}},Math.max(0,this.task.expiresAt*1000-Date.now()));}
  catch{if(opening===this.opening&&generation===this.generation)this.note.textContent='Betjeningen kunne ikke hentes. Adgangen eller status kan have ændret sig.';}
  finally{if(opening===this.opening)this.body.setAttribute('aria-busy','false');this.setupPending=false;this.render();}
 }
 clearRobotRefresh(){this.expiredRobot=null;this.refreshButton?.remove();this.refreshButton=null;}
 canRefreshRobot(){
  const context=this.expiredRobot,s=this.host.liveSnapshot,device=this.robotDevice();
  return !!context&&context.generation===this.generation&&context.opening===this.opening&&this.dialog.open&&this.host.isConnected&&this.allowed('vacuum')&&this.domain==='vacuum'&&s?.bootId===context.bootId&&s?.roomId===context.roomId&&JSON.stringify(this.target)===context.target&&device?.live===true&&!device.stale&&!this.pending&&!this.setupPending&&!this.musicIntentPending&&!this.activeOperation&&![...this.receipts.values()].some(row=>row.bootId===context.bootId&&row.roomId===context.roomId&&row.domain==='vacuum'&&JSON.stringify(row.target)===context.target&&row.outcome==='unknown');
 }
 expireTask(){
  const task=this.task;if(!task)return;
  const eligible=task.domain==='vacuum'&&!this.pending&&!this.setupPending&&!this.musicIntentPending&&!this.activeOperation&&!this.spent.has(task.taskId);
  this.invalidate('Betjeningen er udløbet · hent den igen.',false);
  if(!eligible)return;
  this.expiredRobot={generation:this.generation,opening:this.opening,bootId:task.bootId,roomId:task.roomId,target:JSON.stringify(this.target)};
  if(!this.canRefreshRobot()){this.expiredRobot=null;return;}
  const refresh=make('button','Hent aktuel betjening','pv-button pv-ghost');refresh.type='button';refresh.addEventListener('click',()=>this.refreshRobot());this.refreshButton=refresh;this.body.append(refresh);
 }
 async refreshRobot(){
  if(!this.canRefreshRobot())return;
  const context=this.expiredRobot,button=this.refreshButton,restoreFocus=document.activeElement===button,focusUnclaimed=()=>[button,document.body,this.dialog].includes(document.activeElement);
  await this.open('vacuum',this.target,this.opener,this.recipeId,context);
  if(context.generation!==this.generation||!this.dialog.open||!this.host.isConnected)return;
  if(this.task&&this.domain==='vacuum'&&JSON.stringify(this.target)===context.target){
   this.clearRobotRefresh();this.note.textContent='Betjeningen er opdateret · vælg områder og indstillinger igen.';
   if(restoreFocus&&focusUnclaimed())this.robotPanel?.querySelector('input,select,button')?.focus();
  }else if(this.expiredRobot===context){context.opening=this.opening;this.render();if(restoreFocus&&focusUnclaimed()&&this.canRefreshRobot())button.focus();}
 }
 robotDevice(){return this.host.state.devices.find(d=>d.kind==='vacuum'&&d.id===this.target?.entityId);}
 buildOptions(){this.body.replaceChildren();this.robotPanel=null;if(this.task?.domain==='vacuum'||this.domain==='vacuum'){const device=this.robotDevice(),panel=document.createElement('pv-robot-control-panel');panel.data={task:this.task,device,loading:this.setupPending,connected:!!this.host.liveTransport?.connected,history:device?.history,readOnly:!this.allowed('vacuum')||device?.live!==true||!!device.stale};panel.addEventListener('robot-control-action',event=>this.send(event.detail.optionId,event.detail.args));panel.addEventListener('robot-control-recipe',event=>this.open('vacuum',this.target,this.opener,event.detail.recipeId));this.robotPanel=panel;panel.disabled=!this.task;this.body.append(panel);return;}for(const option of this.task.options){const section=make('section',undefined,'pv-content'),form=make('form',undefined,'pv-content'),schema=option.argsSchema;if(schema.kind!=='none'&&!(this.task.domain==='light'&&schema.kind==='percent'))form.append(make('h3',option.label));
   if(schema.kind==='choice'){const grid=make('div',undefined,'pv-actions');for(const c of schema.choices){const label=make('label'),input=make('input');input.type='radio';input.name='choiceId';input.value=c.id;input.required=true;label.append(input,make('span',c.label));grid.append(label);}form.append(grid);}
   if(schema.kind==='cleaning'){const grid=make('div',undefined,'pv-actions');for(const area of schema.areas){const label=make('label'),input=make('input');input.type='checkbox';input.name='areaIds';input.value=area.id;label.append(input,make('span',area.label));grid.append(label);}const repeat=make('select');repeat.name='repeat';repeat.setAttribute('aria-label','Antal rengøringer');for(let n=1;n<=3;n++){const o=make('option',n===1?'1 gang':n+' gange');o.value=String(n);repeat.append(o);}form.append(grid,repeat);}
   if(schema.kind==='percent'){const label=make('label',this.task.domain==='light'?'Lysstyrke':'Vælg lydstyrke'),input=make('input'),value=make('output');input.type='range';input.name='percent';input.min='0';input.max=String(this.task.domain==='music'?100:schema.max);input.step='1';input.value=String(this.task.volume===null&&this.task.domain==='music'?50:Math.min(schema.max,this.task.volume??0));value.textContent=this.task.volume===null?'Vælg på skyderen':input.value+' %';input.setAttribute('aria-label',this.task.domain==='light'?'Lysstyrke':'Vælg lydstyrke');applyKitComponent(input,'slider');input.addEventListener('input',()=>{const attempted=Number(input.value),limited=this.task?.domain==='music'&&Number.isInteger(attempted)&&attempted>schema.max;if(limited){input.value=String(schema.max);syncKitSlider(input);}value.textContent=input.value+' %'+(limited?' · Højst '+schema.max+' %':'');form.querySelector('[type=submit]').disabled=false;});label.append(input,value);form.append(label);}
   const submit=make('button',schema.kind==='none'?option.label:schema.kind==='percent'?(this.task.domain==='light'?'Indstil lysstyrke':'Indstil lydstyrke'):schema.kind==='choice'?'Anvend indstilling':'Start rengøring','pv-button pv-primary');submit.type='submit';submit.disabled=schema.kind==='percent'&&this.task.volume===null;form.append(submit);form.addEventListener('submit',event=>{event.preventDefault();let args={};if(schema.kind==='choice')args={choiceId:form.elements.choiceId.value};if(schema.kind==='cleaning')args={areaIds:[...form.querySelectorAll('[name=areaIds]:checked')].map(x=>x.value),repeat:Number(form.elements.repeat.value)};if(schema.kind==='percent')args={percent:Number(form.elements.percent.value)};this.send(option.id,args);});section.append(form);this.body.append(section);}}
 async send(optionId,input){this.render();const task=this.task;if(!task||this.pending||this.musicIntentPending||this.spent.has(task.taskId)||!this.allowed(task.domain)||task.domain==='light'&&!this.lightContext?.current()||task.domain==='music'&&(JSON.stringify(this.musicContext()?.target)!==JSON.stringify(this.target)||task.expectedBindingId!==this.target.expectedBindingId)||task.domain==='vacuum'&&(this.robotDevice()?.live!==true||this.robotDevice()?.stale))return;let args;try{args=controlArgs(task,optionId,input);}catch{this.note.textContent='Kontrollér dit valg, eller hent en ny betjening.';return;}this.spent.set(task.taskId,task.expiresAt);this.pending=true;const operation={key:task.bootId+':'+task.taskId,bootId:task.bootId,roomId:task.roomId,taskId:task.taskId,domain:task.domain,optionId,target:{...this.target},label:task.options.find(x=>x.id===optionId).label};this.activeOperation=operation;this.remember(operation,'pending');this.note.textContent='';for(const el of this.body.querySelectorAll('button,input,select'))el.disabled=true;this.render();const generation=this.generation,opening=this.opening;
  try{const result=await this.host.liveTransport.controlAction(task,optionId,args);this.remember(operation,result.outcome,result.requestId);if(generation!==this.generation||opening!==this.opening||!this.host.isConnected)return;this.note.textContent=result.ok?'Anmodningen er modtaget.':result.outcome==='unknown'?'Udfaldet er ukendt · handlingen gentages ikke.':'Handlingen blev afvist · hent aktuel betjening.';if(result.outcome!=='unknown'){const refresh=make('button','Hent aktuel betjening','pv-button pv-ghost');refresh.type='button';refresh.addEventListener('click',()=>this.open(this.domain,this.target,this.opener,this.recipeId));this.body.append(refresh);}}
  catch{this.remember(operation,'unknown');if(generation===this.generation&&opening===this.opening&&this.host.isConnected)this.note.textContent='Udfaldet er ukendt · handlingen gentages ikke.';}
  finally{clearTimeout(this.slowTimer);this.pending=false;this.activeOperation=null;if(this.host.isConnected)this.render();}
 }
 cleanup(){this.musicMeasurement=null;this.suspending=true;clearTimeout(this.musicExpiryTimer);clearTimeout(this.slowTimer);clearTimeout(this.expiryTimer);this.invalidate();this.suspending=false;}
}
