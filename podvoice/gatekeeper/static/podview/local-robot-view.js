import './robot-control-panel.js';
import {renderRobotHistory} from './live-home-view.js';
import {controlArgs} from './control-model.js';
const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const startId='a'.repeat(24),reuseId='e'.repeat(24),areas=[{id:'b'.repeat(24),label:'Køkkenet'},{id:'c'.repeat(24),label:'Stue'},{id:'f'.repeat(24),label:'Entré'}];
// Local example adapter: no transport, fetch, source credentials or physical effects.
// The live product's existing panel and history renderer own all presentation.
export class LocalRobotView{
 constructor(host){
  this.host=host;this.areaLabels=new Map(areas.map(area=>[area.id,area.label]));this.serial=0;this.seed();this.button=make('button','Vælg rengøring','text-control pv-button');this.button.type='button';this.button.setAttribute('data-robot-control','true');this.button.addEventListener('click',()=>this.openRobot(this.button,this.savedRecipeId));
 }
 ensurePanel(){
  if(this.entry)return;
  this.entry=make('section',undefined,'device-history');this.entry.dataset.robotRooms='true';this.entry.dataset.detailZone='controls';this.receipt=make('p','','pv-meta');this.receipt.setAttribute('role','status');this.receipt.hidden=true;this.panel=make('pv-robot-control-panel');this.entry.append(this.panel,this.receipt,this.button);this.panel.addEventListener('robot-control-action',event=>this.act(event.detail));
 }
 seed(){if(this.host.live)return;for(const d of this.host.state.devices.filter(row=>row.kind==='vacuum'&&!row.live))if(!d.history){d.exampleOnly=true;if(['now','rest','quiet','music','weather','timers','top'].includes(this.host.previewStage||'rest'))d.status='docked';d.history={status:'observed',items:[{id:'d'.repeat(32),recordedAt:Date.now()/1000-3600,outcome:'accepted_local',recipe:{mapName:'Stueplan',areaIds:[areas[0].id],repeat:2}}]};}}
 allowed(domain){return !this.host.live&&domain==='vacuum'&&this.host.state.connected!==false;}
 render(){
  if(this.host.live)return;
  this.seed();this.button.hidden=true;
  const d=this.host.state.devices.find(row=>row.id===this.host.state.focus&&row.kind==='vacuum'&&!row.live),card=d&&this.host.deviceNodes?.get(d.id);
  if(!d){if(this.entry)this.entry.hidden=true;if(this.host.state.devices.some(row=>row.id===this.host.state.focus&&row.kind==='vacuum'))renderRobotHistory(this.host);return;}
  this.ensurePanel();if(card&&this.entry.parentNode!==card.parentNode.parentNode)card.parentNode.before(this.entry);this.entry.hidden=false;
  if(card){card.dataset.controlEntry='true';card.dataset.localRobot='true';}
  if(this.deviceId!==d.id||!this.task||this.taskStatus!==d.status)this.openRobot(this.button);
  this.button.hidden=!!this.task&&this.task.expiresAt*1000>Date.now();this.button.disabled=!this.allowed('vacuum');this.panel.observed(d,{connected:this.host.state.connected});this.panel.disabled=!this.allowed('vacuum')||!this.task||this.task.expiresAt*1000<=Date.now();renderRobotHistory(this.host);
 }
 openRobot(opener,recipeId,selectedAreaId){
  const d=this.host.state.devices.find(row=>row.id===this.host.state.focus&&row.kind==='vacuum'&&!row.live);if(!d||!this.allowed('vacuum')||selectedAreaId&&!areas.some(area=>area.id===selectedAreaId))return;const record=recipeId?d.history?.items.find(row=>row.id===recipeId&&row.outcome==='accepted_local'):null;if(recipeId&&!record)return;
  this.ensurePanel();this.opener=opener;if(this.deviceId!==d.id)this.savedRecipeId=null;this.deviceId=d.id;this.taskStatus=d.status;this.taskDeviceRevision=d.revision;const canStart=['docked','stopped','complete','idle'].includes(d.status),transport=d.status==='cleaning'?['pause','return','stop']:d.status==='paused'?['resume','return','stop']:[];this.task={domain:'vacuum',bootId:'local-example',roomId:'local-example',taskId:`local-robot-${++this.serial}`,revision:1,expiresAt:Date.now()/1000+300,mapName:'Stueplan',options:canStart?[{id:startId,action:'start',label:'Start rengøring',argsSchema:{kind:'cleaning',areas,repeat:{min:1,max:3}}}]:transport.map(action=>({id:({pause:'1',resume:'2',return:'3',stop:'4'})[action].repeat(24),action,label:({pause:'Pause',resume:'Fortsæt',return:'Til basen',stop:'Stop'})[action],argsSchema:{kind:'none'}}))};
  if(record&&canStart){this.task.options.push({id:reuseId,action:'reuse',label:'Brug igen',argsSchema:{kind:'none'}});this.task.historyDraft={source:'accepted_start_history',optionId:startId,areaIds:[...record.recipe.areaIds],repeat:record.recipe.repeat};}
  this.panel.data={task:this.task,device:d,connected:this.host.state.connected,selectedAreaId,localOnly:true};this.panel.disabled=false;this.receipt.hidden=true;this.entry.hidden=false;if(this.button)this.button.hidden=true;
  const previous=canStart&&!record&&!selectedAreaId&&d.history?.items.filter(row=>row.outcome==='accepted_local'&&/^[a-f0-9]{32}$/.test(row.id)).sort((a,b)=>b.recordedAt-a.recordedAt)[0];
  const suggested=previous&&this.panel.suggest({schema:'podview.robot-suggestion.v1',source:'ai_recipe_selection',basis:'recent_choices',bootId:this.task.bootId,roomId:this.task.roomId,taskId:this.task.taskId,revision:this.task.revision,expiresAt:this.task.expiresAt,recipeId:previous.id,optionId:startId,areaIds:[...previous.recipe.areaIds],repeat:previous.recipe.repeat});
 }
 act(detail){
  if(this.host.live||this.entry?.hidden!==false||this.host.state.focus!==this.deviceId||!this.allowed('vacuum')||!this.task)return;const d=this.host.state.devices.find(row=>row.id===this.deviceId&&!row.live),option=this.task.options.find(row=>row.id===detail.optionId);if(!d||!option||d.status!==this.taskStatus||d.revision!==this.taskDeviceRevision)return;let args;try{args=controlArgs(this.task,detail.optionId,detail.args);}catch{return;}
  if(option.action==='start'){
   if(!['docked','stopped','complete','idle'].includes(d.status))return;
   const record={id:(++this.serial).toString(16).padStart(32,'0'),recordedAt:Date.now()/1000,outcome:'accepted_local',recipe:{mapName:this.task.mapName,...args}};d.history={status:'observed',items:[record,...(d.history?.items||[])].slice(0,12)};this.savedRecipeId=record.id;d.status='cleaning';
  }else{
   if(option.action==='pause'&&d.status!=='cleaning'||option.action==='resume'&&d.status!=='paused'||!['pause','resume','return','stop'].includes(option.action))return;
   d.status=({pause:'paused',resume:'cleaning',return:'docking',stop:'stopped'})[option.action];
  }
  d.revision=(d.revision||0)+1;d.pending=null;this.task=null;this.panel.disabled=true;this.host.render();this.receipt.textContent=option.action==='start'?`${args.areaIds.map(id=>areas.find(area=>area.id===id).label).join(', ')} · ${args.repeat} ${args.repeat===1?'gang':'gange'}`:'';this.receipt.hidden=!this.receipt.textContent;
 }
 cleanup(){this.task=null;this.button.remove();this.entry?.remove();}
}
