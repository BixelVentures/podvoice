import './robot-control-panel.js';
import {renderRobotHistory} from './live-home-view.js';
import {controlArgs} from './control-model.js';
const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const startId='a'.repeat(24),reuseId='e'.repeat(24),areas=[{id:'b'.repeat(24),label:'Køkken'},{id:'c'.repeat(24),label:'Stue'},{id:'f'.repeat(24),label:'Entré'}];
// Local example adapter: no transport, fetch, source credentials or physical effects.
// The live product's existing panel and history renderer own all presentation.
export class LocalRobotView{
 constructor(host){
  this.host=host;this.areaLabels=new Map(areas.map(area=>[area.id,area.label]));this.serial=0;this.seed();this.dialog=make('dialog',undefined,'pv-component');const header=make('header'),title=make('h2','Rengøring'),close=make('button','Luk','dialog-close');title.id='local-robot-title';this.dialog.setAttribute('aria-labelledby',title.id);close.type='button';close.addEventListener('click',()=>this.dialog.close());header.append(title,close);this.note=make('p','Robotten er ikke forbundet. Du kan vælge områder og gemme rengøringen.','pv-meta');this.receipt=make('p','','pv-meta');this.receipt.setAttribute('role','status');this.receipt.hidden=true;this.body=make('div',undefined,'pv-content');this.panel=make('pv-robot-control-panel');this.body.append(this.panel);this.dialog.append(header,this.note,this.receipt,this.body);host.append(this.dialog);
  this.button=make('button','Vælg rengøring','text-control');this.button.type='button';this.button.setAttribute('data-robot-control','true');this.button.addEventListener('click',()=>this.openRobot(this.button));this.panel.addEventListener('robot-control-action',event=>this.act(event.detail));this.dialog.addEventListener('close',()=>{this.task=null;if(this.opener?.isConnected)this.opener.focus();});
 }
 seed(){if(this.host.live)return;for(const d of this.host.state.devices.filter(row=>row.kind==='vacuum'&&!row.live))if(!d.history){d.exampleOnly=true;if(['now','rest','quiet','music','weather','timers','top'].includes(this.host.previewStage||'rest'))d.status='docked';d.history={status:'observed',items:[{id:'d'.repeat(32),recordedAt:Date.now()/1000-3600,outcome:'accepted_local',recipe:{mapName:'Stueplan',areaIds:[areas[0].id],repeat:2}}]};}}
 allowed(domain){return !this.host.live&&domain==='vacuum'&&this.host.state.connected!==false;}
 render(){
  if(this.host.live)return;
  this.seed();
  const d=this.host.state.devices.find(row=>row.id===this.host.state.focus&&row.kind==='vacuum'&&!row.live);if(this.button.hidden!==!d)this.button.hidden=!d;if(this.button.disabled!==!this.allowed('vacuum'))this.button.disabled=!this.allowed('vacuum');const card=d&&this.host.deviceNodes?.get(d.id);if(card){if(!this.entry){this.entry=make('section',undefined,'device-history');this.entry.dataset.robotRooms='true';this.entry.append(make('h2','Vælg rum'));this.rooms=make('pv-choice-list');this.rooms.setAttribute('aria-label','Vælg rum til rengøring');this.rooms.addEventListener('pv-action',event=>{if(event.detail?.action_id!=='choose')return;event.stopPropagation();this.openRobot(this.rooms,undefined,event.detail.option_id);});this.entry.append(this.rooms);}if(this.entry.parentNode!==card.parentNode.parentNode)card.parentNode.after(this.entry);this.entry.hidden=!d;const data={items:areas.map(area=>({id:area.id,label:area.label,detail:'Vælg rengøring'})),selected:null,quietStatus:true,connected:this.allowed('vacuum')};const signature=JSON.stringify(data);if(this.roomSignature!==signature){this.rooms.data=data;this.roomSignature=signature;}}else if(this.entry)this.entry.hidden=true;if(card&&card.dataset.controlEntry!=='true')card.dataset.controlEntry='true';renderRobotHistory(this.host);
  if(this.dialog.open){const current=this.host.state.devices.find(row=>row.id===this.deviceId);this.panel.observed(current,{connected:this.host.state.connected});this.panel.disabled=!this.allowed('vacuum')||!current||!this.task||this.task?.expiresAt*1000<=Date.now();}
 }
 openRobot(opener,recipeId,selectedAreaId){
  const d=this.host.state.devices.find(row=>row.id===this.host.state.focus&&row.kind==='vacuum'&&!row.live);if(!d||!this.allowed('vacuum')||selectedAreaId&&!areas.some(area=>area.id===selectedAreaId))return;const record=recipeId?d.history?.items.find(row=>row.id===recipeId&&row.outcome==='accepted_local'):null;if(recipeId&&!record)return;
  this.opener=opener;this.deviceId=d.id;this.task={domain:'vacuum',bootId:'local-example',roomId:'local-example',taskId:`local-robot-${++this.serial}`,revision:1,expiresAt:Date.now()/1000+300,mapName:'Stueplan',options:[{id:startId,action:'start',label:'Gem rengøring',argsSchema:{kind:'cleaning',areas,repeat:{min:1,max:3}}}]};
  if(record){this.task.options.push({id:reuseId,action:'reuse',label:'Brug igen',argsSchema:{kind:'none'}});this.task.historyDraft={source:'accepted_start_history',optionId:startId,areaIds:[...record.recipe.areaIds],repeat:record.recipe.repeat};}
  this.panel.data={task:this.task,device:d,connected:this.host.state.connected,selectedAreaId};this.panel.disabled=false;this.receipt.hidden=true;if(!this.dialog.open)this.dialog.showModal();
  const previous=!record&&!selectedAreaId&&d.history?.items.filter(row=>row.outcome==='accepted_local'&&/^[a-f0-9]{32}$/.test(row.id)).sort((a,b)=>b.recordedAt-a.recordedAt)[0];
  const suggested=previous&&this.panel.suggest({schema:'podview.robot-suggestion.v1',source:'ai_recipe_selection',basis:'recent_choices',bootId:this.task.bootId,roomId:this.task.roomId,taskId:this.task.taskId,revision:this.task.revision,expiresAt:this.task.expiresAt,recipeId:previous.id,optionId:startId,areaIds:[...previous.recipe.areaIds],repeat:previous.recipe.repeat});
  this.note.textContent=suggested?'Du kan genbruge dit seneste valg eller vælge andre områder og gentagelser. Robotten er ikke forbundet.': 'Robotten er ikke forbundet. Du kan vælge områder og gemme rengøringen.';
 }
 act(detail){
  if(this.host.live||!this.dialog.open||!this.allowed('vacuum')||!this.task||detail.optionId!==startId)return;const d=this.host.state.devices.find(row=>row.id===this.deviceId&&!row.live);if(!d)return;let args;try{args=controlArgs(this.task,detail.optionId,detail.args);}catch{return;}
  const record={id:(++this.serial).toString(16).padStart(32,'0'),recordedAt:Date.now()/1000,outcome:'accepted_local',recipe:{mapName:this.task.mapName,...args}};d.history={status:'observed',items:[record,...(d.history?.items||[])].slice(0,12)};this.task=null;this.panel.disabled=true;this.receipt.textContent=`Gemt: ${args.areaIds.map(id=>areas.find(area=>area.id===id).label).join(', ')} · ${args.repeat} ${args.repeat===1?'gang':'gange'}. Robotten er ikke startet.`;this.receipt.hidden=false;this.host.render();
 }
 cleanup(){this.task=null;this.dialog.remove();this.button.remove();this.entry?.remove();}
}
