import {renderPlayerControls} from './player-view.js';
import {controlTask,controlArgs} from './control-model.js';
import {observationFresh,roomObservationCurrent,mediaRoomBinding} from './media-observation.js';
import './robot-control-panel.js';
const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
// Presentation-only client. All tickets, scopes and effect owners stay server-side.
export class LiveControlView{
 constructor(host){this.host=host;this.generation=0;this.opening=0;this.spent=new Map();this.receipts=new Map();this.dialog=make('dialog',undefined,'live-control-dialog');const header=make('header'),title=make('h2','Betjening'),close=make('button','Luk','dialog-close');this.title=title;title.id='control-title';this.dialog.setAttribute('aria-labelledby',title.id);close.type='button';close.addEventListener('click',()=>this.dialog.close());header.append(title,close);this.note=make('p','', 'control-feedback');this.note.setAttribute('role','status');this.body=make('div',undefined,'control-options');this.receiptNote=make('p','','control-feedback');this.receiptNote.setAttribute('role','status');this.receiptNote.hidden=true;this.dialog.append(header,this.note,this.receiptNote,this.body);host.append(this.dialog);this.dialog.addEventListener('close',()=>{this.opening++;this.task=null;clearTimeout(this.expiryTimer);this.body.replaceChildren();this.body.setAttribute('aria-busy','false');if(this.opener?.isConnected)this.opener.focus();});
  this.musicButton=make('button','Betjen musik','text-control');this.musicButton.type='button';this.musicButton.addEventListener('click',()=>this.openMusic(this.musicButton));
  this.musicStatus=make('p');this.musicDetailStatus=this.musicStatus;
  for(const id of ['volume','detail-volume']){const input=document.getElementById(id);if(!input)continue;input.addEventListener('pointerdown',()=>{this.musicVolumeGesture=input;});for(const event of ['pointerup','pointercancel','change','blur'])input.addEventListener(event,()=>{if(this.musicVolumeGesture===input)this.musicVolumeGesture=null;});}
  this.robotButton=make('button','Betjen robot','text-control');this.robotButton.type='button';this.robotButton.addEventListener('click',()=>this.openRobot(this.robotButton));document.getElementById('device-detail').after(this.robotButton);
 }
 allowed(domain){return this.host.liveTransport?.connected&&this.host.liveSnapshot?.capabilities.controlSetup?.includes(domain);}
 render(){
  const snapshot=this.host.liveSnapshot,authority=JSON.stringify([snapshot?.bootId,snapshot?.roomId,!!this.allowed('music'),!!this.allowed('vacuum')]);
  if(this.authority!==undefined&&this.authority!==authority)this.invalidate('Adgangen eller forbindelsen er ændret · hent betjeningen igen.',false);
  this.authority=authority;const musicAuthority=this.musicContext()?.key??null;if(this.musicAuthority!==undefined&&this.musicAuthority!==musicAuthority)this.invalidate('Musikken er ændret · hent betjeningen igen.',false);this.musicAuthority=musicAuthority;
  if(this.task&&this.task.expiresAt*1000<=Date.now())this.invalidate('Betjeningen er udløbet · hent den igen.',false);
  const p=this.host.liveMedia?.playback,d=this.host.state.devices.find(x=>x.id===this.host.state.focus&&x.kind==='vacuum');this.musicButton.hidden=!this.allowed('music')||!roomObservationCurrent(p,snapshot);this.musicButton.disabled=this.pending||this.setupPending;this.robotButton.hidden=!this.allowed('vacuum')||!d?.live;this.robotButton.disabled=this.pending||this.setupPending||d?.stale;
  if(this.robotPanel&&this.dialog.open&&this.domain==='vacuum'){const device=this.robotDevice();this.robotPanel.observed?.(device);this.robotPanel.disabled=!!(this.pending||this.setupPending||!this.task||this.spent.has(this.task.taskId)||!this.allowed('vacuum')||device?.stale);}
  this.renderReceipt();this.renderMusicControls();if(!this.suspending)this.prepareMusic();
 }
 receiptText(row){return row.outcome==='accepted'?'Anmodningen er modtaget · afventer observeret status.':row.outcome==='unknown'?'Udfaldet er ukendt · handlingen gentages ikke.':row.outcome==='pending'?'Handlingen afventer svar fra hjemmet.':'Handlingen blev afvist.';}
 remember(operation,outcome,requestId){
  const row={...operation,outcome,requestId};this.receipts.delete(operation.key);this.receipts.set(operation.key,row);
  while(this.receipts.size>16)this.receipts.delete(this.receipts.keys().next().value);
  if(this.host.isConnected)this.renderReceipt();
 }
 renderReceipt(){
  const s=this.host.liveSnapshot,target=JSON.stringify(this.target),row=[...this.receipts.values()].reverse().find(r=>r.bootId===s?.bootId&&r.roomId===s?.roomId&&r.domain===this.domain&&JSON.stringify(r.target)===target);
  this.receiptNote.hidden=!row;this.receiptNote.textContent=row?`${row.label}: ${this.receiptText(row)}`:'';
 }
 invalidate(message='Forbindelsen mangler · hent betjeningen igen.',render=true){
  this.generation++;this.opening++;this.body.setAttribute('aria-busy','false');this.task=null;this.musicOffer=null;this.musicAttempt=null;clearTimeout(this.musicExpiryTimer);clearTimeout(this.expiryTimer);
  if(this.pending&&this.musicFence)this.musicFence={...this.musicFence,outcome:'unknown'};
  if(this.pending&&this.activeOperation){this.remember(this.activeOperation,'unknown');this.note.textContent='Forbindelsen blev afbrudt · handlingen gentages ikke.';}else if(this.dialog.open)this.note.textContent=message;
  for(const el of this.body.querySelectorAll('button,input,select'))el.disabled=true;if(this.robotPanel)this.robotPanel.disabled=true;if(render)this.render();
 }
 musicContext(){
  const p=this.host.liveMedia?.playback,s=this.host.liveSnapshot;
  if(this.suspending||!this.host.isConnected||!this.allowed('music')||!roomObservationCurrent(p,s)||!p?.target?.id||!['playing','paused'].includes(p.state)||typeof p.config_entry_id!=='string'||!p.config_entry_id||typeof p.owner_epoch!=='string'||!p.owner_epoch)return null;
  const target={accountId:p.config_entry_id,kind:'spotify_device',targetId:p.target.id};
  const binding=mediaRoomBinding(s,p.config_entry_id);
  const key=JSON.stringify([s.bootId,s.roomId,p.config_entry_id,p.owner_epoch,p.target.id,p.item?.uri??null,p.state,binding.bindingId,binding.nativeRoomId,binding.nativeHomepodId,binding.targetId]);
  return {key,target,pollSequence:p.poll_sequence,bootId:s.bootId,roomId:s.roomId};
 }
 musicCurrent(context){return !!context&&this.musicContext()?.key===context.key;}
 pruneSpent(){for(const[id,expiry]of this.spent)if(expiry*1000<=Date.now())this.spent.delete(id);}
 async prepareMusic(){
  this.pruneSpent();
  const context=this.musicContext();if(!context||this.pending||this.setupPending||this.musicReadPending||this.musicIntentPending)return;
  if(this.musicFence?.key===context.key&&this.musicFence.outcome==='unknown')return;
  if(this.musicFence?.key===context.key&&this.musicFence.outcome==='accepted'&&context.pollSequence>this.musicFence.pollSequence){this.musicFence=null;this.musicOffer=null;this.musicAttempt=null;}
  if(this.musicOffer?.context.key===context.key&&this.musicOffer.task.expiresAt*1000>Date.now())return;
  if(this.musicAttempt===context.key)return; // failed/expired read never retries automatically
  this.musicOffer=null;this.musicAttempt=context.key;this.musicReadPending=true;const generation=this.generation;
  try{const value=await this.host.liveTransport.controlSetup('music',context.target);if(generation!==this.generation||!this.musicCurrent(context))return;const task=controlTask(value,this.host.liveSnapshot,'music');this.musicOffer={task,context};clearTimeout(this.musicExpiryTimer);this.musicExpiryTimer=setTimeout(()=>{this.renderMusicControls();},Math.max(0,task.expiresAt*1000-Date.now()));}
  catch{}finally{this.musicReadPending=false;if(this.host.isConnected)this.renderMusicControls();}
 }
 renderMusicControls(){
  const context=this.musicContext(),offer=this.musicOffer;
  const fresh=!!context&&offer?.context.key===context.key&&offer.task.expiresAt*1000>Date.now();
  const options=fresh?offer.task.options:[],blocked=this.pending||this.setupPending||this.musicIntentPending||!fresh||this.spent.has(offer?.task.taskId)||this.musicFence?.key===context?.key&&this.musicFence?.outcome==='unknown';
  const has=action=>options.filter(option=>option.action===action).length===1,toggle=context&&this.host.liveMedia.playback.state==='playing'?'pause':'resume';
  const transport=has(toggle)||has('next')||has('previous');
  const volumes=options.filter(option=>option.action==='volume'),volume=volumes.length===1?volumes[0]:null,actualVolume=fresh?offer.task.volume:null;
  const canVolume=!!volume&&Number.isInteger(actualVolume)&&actualVolume>=volume.argsSchema.min&&actualVolume<=volume.argsSchema.max;
  renderPlayerControls(this.host,{playing:toggle==='pause',previous:has('previous'),next:has('next'),toggle:has(toggle),blocked,volume:canVolume?actualVolume:null,canVolume,min:volume?.argsSchema.min??0,max:volume?.argsSchema.max??100,gesture:this.musicVolumeGesture});
  const fence=this.musicFence,feedback=fence&&context&&fence.key===context.key?fence.outcome==='pending'?'Afventer hjemmet…':fence.outcome==='unknown'?'Udfald ukendt · gentages ikke':fence.outcome==='accepted'?'Afventer status':fence.outcome==='rejected'?'Handlingen blev afvist':fence.outcome==='unavailable'?'Betjeningen kunne ikke hentes':fence.outcome==='invalid'?'Kontrollér dit valg':'' : '';
  for(const node of [this.musicStatus,this.musicDetailStatus]){node.hidden=!feedback;node.textContent=feedback;}
  if(feedback){this.host.showFeedback?.(feedback,true);this.musicFeedback=feedback;}else if(this.musicFeedback&&this.host.feedbackMessage===this.musicFeedback){this.host.showFeedback?.('',false);this.musicFeedback='';}
  if(transport||canVolume)this.musicButton.hidden=true;
  this.host.setAttribute('data-native-music-controls',transport||canVolume?'true':'false');
 }
 async moveSpeaker(speaker,catalogueCurrent=()=>false){
  this.pruneSpent();const context=this.musicContext(),snapshot=this.host.liveSnapshot,binding=context&&mediaRoomBinding(snapshot,context.target.accountId),transport=this.host.liveTransport;
  if(!context||!binding||!catalogueCurrent()||this.pending||this.setupPending||this.musicReadPending||this.musicIntentPending||this.musicFence?.key===context.key&&['unknown','accepted'].includes(this.musicFence.outcome)||speaker?.kind!=='configured_alias'||speaker.accountId!==context.target.accountId||!/^[a-f0-9]{64}$/.test(speaker.speakerId)||speaker.selectable!==true||speaker.availability!=='available'||typeof speaker.nativeRoomId!=='string'||!speaker.nativeRoomId||typeof speaker.homepodId!=='string'||! /^[1-9][0-9]{0,19}$/.test(speaker.homepodId)||speaker.outputSelected===true||speaker.nativeRoomId===binding.nativeRoomId&&speaker.homepodId===binding.nativeHomepodId)return false;
  const generation=this.generation,bindingKey=JSON.stringify(binding),optionId='move:'+speaker.speakerId,operationCurrent=()=>generation===this.generation&&this.host.liveTransport===transport&&this.musicCurrent(context)&&JSON.stringify(mediaRoomBinding(this.host.liveSnapshot,context.target.accountId))===bindingKey,current=()=>operationCurrent()&&catalogueCurrent();
  this.musicIntentPending=true;this.setupPending=true;this.musicOffer=null;this.musicAttempt=context.key;clearTimeout(this.musicExpiryTimer);this.renderMusicControls();this.host.liveOutputs?.sync();let operation=null,sent=false;
  try{
   const value=await transport.controlSetup('music',{...context.target,speakerId:speaker.speakerId});if(!current())return false;
   const task=controlTask(value,this.host.liveSnapshot,'music');if(task.options.length!==1||task.options[0].id!==optionId||task.options[0].action!=='move_existing_session'||task.options[0].argsSchema.kind!=='none'||this.spent.has(task.taskId))throw Error('invalid_move_offer');
   const args=controlArgs(task,optionId,{});if(!current())return false;
   this.spent.set(task.taskId,task.expiresAt);this.setupPending=false;this.pending=true;
   operation={key:task.bootId+':'+task.taskId,bootId:task.bootId,roomId:task.roomId,taskId:task.taskId,domain:'music',target:{...context.target,speakerId:speaker.speakerId},label:task.options[0].label};this.activeOperation=operation;this.musicFence={...context,outcome:'pending'};this.remember(operation,'pending');this.renderMusicControls();this.host.liveOutputs?.sync();sent=true;
   const response=transport.controlAction(task,optionId,args);try{this.host.ownerDocument?.getElementById('rooms')?.close();}catch{}const result=await response;this.remember(operation,result.outcome,result.requestId);if(!operationCurrent())return true;this.musicFence={...context,outcome:result.outcome};return true;
  }catch{if(sent&&operation){this.remember(operation,'unknown');if(operationCurrent())this.musicFence={...context,outcome:'unknown'};}else if(operationCurrent())this.musicFence={...context,outcome:'unavailable'};return sent;}
  finally{this.setupPending=false;this.musicIntentPending=false;if(operation){this.pending=false;this.activeOperation=null;}if(this.host.isConnected){this.renderMusicControls();this.host.liveOutputs?.sync();}}
 }
 async musicIntent(action,input={}){
  this.pruneSpent();
  const context=this.musicContext(),offered=this.musicOffer;
  if(!context||this.pending||this.setupPending||this.musicIntentPending||this.musicReadPending||this.musicFence?.key===context.key&&this.musicFence?.outcome==='unknown'||!offered||offered.context.key!==context.key||offered.task.expiresAt*1000<=Date.now()||this.spent.has(offered.task.taskId)||offered.task.options.filter(o=>o.action===action).length!==1||!['pause','resume','next','previous','volume'].includes(action))return false;
  if((action==='pause'&&this.host.liveMedia.playback.state!=='playing')||(action==='resume'&&this.host.liveMedia.playback.state!=='paused'))return false;
  this.musicIntentPending=true;this.spent.set(offered.task.taskId,offered.task.expiresAt);this.renderMusicControls();const generation=this.generation;let operation=null,sent=false;
  try{
   // Each explicit click obtains a fresh native offer; no stored visual option
   // becomes authority for a changed account/track/owner or old permission.
   const value=await this.host.liveTransport.controlSetup('music',context.target);
   if(generation!==this.generation||!this.musicCurrent(context))return false;
   const task=controlTask(value,this.host.liveSnapshot,'music'),matches=task.options.filter(o=>o.action===action),option=matches.length===1?matches[0]:null;
   this.musicOffer={task,context};if(!option||this.spent.has(task.taskId))return false;
   if(action==='volume'&&task.volume===null)return false;
   let args;try{args=controlArgs(task,option.id,input);}catch{this.musicFence={...context,outcome:'invalid'};return false;}
   if(generation!==this.generation||!this.musicCurrent(context))return false;
   this.spent.set(task.taskId,task.expiresAt);this.pending=true;
   operation={key:task.bootId+':'+task.taskId,bootId:task.bootId,roomId:task.roomId,taskId:task.taskId,domain:'music',target:{...context.target},label:option.label};this.activeOperation=operation;
   this.musicFence={...context,outcome:'pending'};this.remember(operation,'pending');this.renderMusicControls();sent=true;
   const result=await this.host.liveTransport.controlAction(task,option.id,args);this.remember(operation,result.outcome,result.requestId);
   if(generation!==this.generation||!this.musicCurrent(context))return true;
   this.musicFence={...context,outcome:result.outcome};return true;
  }catch{if(sent&&operation){this.remember(operation,'unknown');if(generation===this.generation&&this.musicCurrent(context))this.musicFence={...context,outcome:'unknown'};}else if(generation===this.generation&&this.musicCurrent(context))this.musicFence={...context,outcome:'unavailable'};return sent;}
  finally{this.musicIntentPending=false;if(operation){this.pending=false;this.activeOperation=null;}if(this.host.isConnected)this.renderMusicControls();}
 }
 openMusic(opener){const p=this.host.liveMedia?.playback;if(!p?.target||!this.allowed('music'))return;this.open('music',{accountId:p.config_entry_id,kind:'spotify_device',targetId:p.target.id},opener);}
 openRobot(opener,recipeId){const d=this.host.state.devices.find(x=>x.id===this.host.state.focus&&x.kind==='vacuum');if(!d?.live||!this.allowed('vacuum'))return;this.open('vacuum',{entityId:d.id},opener,recipeId);}
 async open(domain,target,opener,recipeId){if(this.pending||this.setupPending||!this.host.isConnected||!this.allowed(domain))return;this.render();for(const[id,expiry]of this.spent)if(expiry*1000<=Date.now())this.spent.delete(id);const retain=this.domain===domain&&JSON.stringify(this.target)===JSON.stringify(target);this.title.textContent=domain==='music'?'Betjen musik':'Rengøring';this.opener=opener;this.domain=domain;this.target=target;this.recipeId=recipeId;this.task=null;if(!retain)this.body.replaceChildren();for(const el of this.body.querySelectorAll('button,input,select'))el.disabled=true;if(this.robotPanel)this.robotPanel.disabled=true;this.body.setAttribute('aria-busy','true');this.note.textContent='';if(!this.dialog.open)this.dialog.showModal();const opening=++this.opening,generation=this.generation;this.setupPending=true;this.render();
  try{const snap=this.host.liveSnapshot,value=await this.host.liveTransport.controlSetup(domain,target,recipeId);if(opening!==this.opening||generation!==this.generation||!this.host.isConnected||!this.allowed(domain)||!this.dialog.open||this.host.liveSnapshot.bootId!==snap.bootId||this.host.liveSnapshot.roomId!==snap.roomId)return;this.task=controlTask(value,this.host.liveSnapshot,domain);this.note.textContent=this.task.mapName||'Vælg en handling';this.buildOptions();clearTimeout(this.expiryTimer);this.expiryTimer=setTimeout(()=>{if(this.task)this.invalidate('Betjeningen er udløbet · hent den igen.');},Math.max(0,this.task.expiresAt*1000-Date.now()));}
  catch{if(opening===this.opening&&generation===this.generation)this.note.textContent='Betjeningen kunne ikke hentes. Adgangen eller status kan have ændret sig.';}
  finally{if(opening===this.opening)this.body.setAttribute('aria-busy','false');this.setupPending=false;this.render();}
 }
 robotDevice(){return this.host.state.devices.find(d=>d.kind==='vacuum'&&d.id===this.target?.entityId);}
 buildOptions(){this.body.replaceChildren();this.robotPanel=null;if(this.task.domain==='vacuum'){const device=this.robotDevice(),panel=document.createElement('pv-robot-control-panel');panel.data={task:this.task,device,history:device?.history};panel.addEventListener('robot-control-action',event=>this.send(event.detail.optionId,event.detail.args));panel.addEventListener('robot-control-recipe',event=>this.open('vacuum',this.target,this.opener,event.detail.recipeId));this.robotPanel=panel;this.body.append(panel);return;}for(const option of this.task.options){const section=make('section',undefined,'control-option'),form=make('form'),schema=option.argsSchema;if(schema.kind!=='none')form.append(make('h3',option.label));
   if(schema.kind==='choice'){const grid=make('div',undefined,'control-choice-grid');for(const c of schema.choices){const label=make('label'),input=make('input');input.type='radio';input.name='choiceId';input.value=c.id;input.required=true;label.append(input,make('span',c.label));grid.append(label);}form.append(grid);}
   if(schema.kind==='cleaning'){const grid=make('div',undefined,'control-choice-grid');for(const area of schema.areas){const label=make('label'),input=make('input');input.type='checkbox';input.name='areaIds';input.value=area.id;label.append(input,make('span',area.label));grid.append(label);}const repeat=make('select');repeat.name='repeat';repeat.setAttribute('aria-label','Antal rengøringer');for(let n=1;n<=3;n++){const o=make('option',n===1?'1 gang':n+' gange');o.value=String(n);repeat.append(o);}form.append(grid,repeat);}
   if(schema.kind==='percent'){const label=make('label','Vælg lydstyrke'),input=make('input'),value=make('output');input.type='range';input.name='percent';input.min='0';input.max=String(schema.max);input.step='1';input.value=String(Math.min(schema.max,this.task.volume??0));value.textContent=this.task.volume===null?'Vælg på skyderen':input.value+' %';input.setAttribute('aria-label','Vælg lydstyrke');input.addEventListener('input',()=>{value.textContent=input.value+' %';form.querySelector('[type=submit]').disabled=false;});label.append(input,value);form.append(label);}
   const submit=make('button',schema.kind==='none'?option.label:schema.kind==='percent'?'Indstil lydstyrke':schema.kind==='choice'?'Anvend indstilling':'Start rengøring');submit.type='submit';submit.disabled=schema.kind==='percent'&&this.task.volume===null;form.append(submit);form.addEventListener('submit',event=>{event.preventDefault();let args={};if(schema.kind==='choice')args={choiceId:form.elements.choiceId.value};if(schema.kind==='cleaning')args={areaIds:[...form.querySelectorAll('[name=areaIds]:checked')].map(x=>x.value),repeat:Number(form.elements.repeat.value)};if(schema.kind==='percent')args={percent:Number(form.elements.percent.value)};this.send(option.id,args);});section.append(form);this.body.append(section);}}
 async send(optionId,input){this.render();const task=this.task;if(!task||this.pending||this.spent.has(task.taskId)||!this.allowed(task.domain))return;let args;try{args=controlArgs(task,optionId,input);}catch{this.note.textContent='Kontrollér dit valg, eller hent en ny betjening.';return;}this.spent.set(task.taskId,task.expiresAt);this.pending=true;const operation={key:task.bootId+':'+task.taskId,bootId:task.bootId,roomId:task.roomId,taskId:task.taskId,domain:task.domain,target:{...this.target},label:task.options.find(x=>x.id===optionId).label};this.activeOperation=operation;this.remember(operation,'pending');this.note.textContent='Afventer hjemmet…';for(const el of this.body.querySelectorAll('button,input,select'))el.disabled=true;this.render();const generation=this.generation,opening=this.opening;clearTimeout(this.slowTimer);this.slowTimer=setTimeout(()=>{if(this.pending&&generation===this.generation&&opening===this.opening&&this.host.isConnected)this.note.textContent='Hjemmet svarer langsomt · handlingen er sendt én gang.';},1500);
  try{const result=await this.host.liveTransport.controlAction(task,optionId,args);this.remember(operation,result.outcome,result.requestId);if(generation!==this.generation||opening!==this.opening||!this.host.isConnected)return;this.note.textContent=result.ok?'Anmodningen er modtaget · afventer observeret status.':result.outcome==='unknown'?'Udfaldet er ukendt · handlingen gentages ikke.':'Handlingen blev afvist · hent aktuel betjening.';if(result.outcome!=='unknown'){const refresh=make('button','Hent aktuel betjening','text-control');refresh.type='button';refresh.addEventListener('click',()=>this.open(this.domain,this.target,this.opener,this.recipeId));this.body.append(refresh);}}
  catch{this.remember(operation,'unknown');if(generation===this.generation&&opening===this.opening&&this.host.isConnected)this.note.textContent='Udfaldet er ukendt · handlingen gentages ikke.';}
  finally{clearTimeout(this.slowTimer);this.pending=false;this.activeOperation=null;if(this.host.isConnected)this.render();}
 }
 cleanup(){this.suspending=true;clearTimeout(this.musicExpiryTimer);clearTimeout(this.slowTimer);clearTimeout(this.expiryTimer);this.invalidate();this.suspending=false;}
}
