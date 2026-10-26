import {createKitComponent,createKitSliderField,applyKitComponent,applyKitTextRole} from './ui/kit.js';
import {lightSelection} from './scene-model.js';
import {scopedLightsObservation} from './ha-home-observation.js';

// The retained ListRow/Toggle/Slider composition has no effect authority.
// Every user event re-reads the exact lamp through its existing host owner.
export class LightLampView{
 constructor(host){
  this.host=host;this.document=host.ownerDocument||globalThis.document;this.rows=new Map();this.node=this.document.createElement('div');this.node.className='light-lamp-list';
 }
 snapshot(light){
  const h=this.host,local=!h.live&&light?.exampleOnly===true&&light.live!==true,selection=local?lightSelection(light):null,source=light?.live===true?scopedLightsObservation(light.lightObservation):null;
  const area=local?selection?.roomId:light?.lightScope?.areaId,scopeName=local?selection?.label:light?.lightScope?.areaName;
  const active=!!light&&h.isConnected!==false&&h.state?.focus===light.id&&h.state?.connected!==false&&!light.stale&&!light.pending&&!h.lightAreaPending&&!h.liveControls?.lightActionState?.pending;
  const authority=local?typeof h.state?.sessionId==='string'&&!!h.state.sessionId&&Number.isSafeInteger(light.revision)&&!!selection&&['on','off','mixed'].includes(light.status):h.live===true&&!!source&&source.status==='observed'&&source.scope.areaId===area&&h.liveTransport?.connected===true&&h.liveSnapshot?.capabilities?.controlSetup?.includes('light');
  const raw=local?(selection?.kind==='home'?light.lights:area?light.lights.filter(row=>row.roomId===area):[]):light?.live===true&&Array.isArray(light.observedLights)?light.observedLights.filter(row=>row.areaId===area):[];
  const seen=new Set(),rows=[];
  for(const row of raw){
   const id=local?row.id:row.entityId;if(typeof id!=='string'||seen.has(id)||(!local&&!/^light\.[a-z0-9_]+$/.test(id)))continue;seen.add(id);
   const lampName=typeof row.name==='string'&&row.name.trim()?row.name.slice(0,160):'Lys',name=local&&selection?.kind==='home'?`${row.roomName} · ${lampName}`:lampName,known=local?typeof row.on==='boolean':row.state==='on'||row.state==='off',on=known?(local?row.on:row.state==='on'):null,dimmable=local?row.dimmable===true:row.supportsBrightness===true;
   const observed=local?row.brightness:Number.isInteger(row.brightness)&&row.brightness>=0&&row.brightness<=255?Math.round(row.brightness/255*100):null,level=known&&on===false?0:known&&Number.isFinite(observed)&&observed>=0&&observed<=100?observed:null;
   const snapshot=h.liveSnapshot,owner=JSON.stringify([snapshot?.bootId,snapshot?.roomId,snapshot?.sessionId,snapshot?.taskId,snapshot?.inputRevision,snapshot?.providerGeneration,h.liveTransport?.generation]);
   const key=JSON.stringify([local,h.state?.sessionId,light.id,light.revision,h.state?.focus,area,source?.sourceEpoch,source?.scope?.bindingId,source?.scope?.placementRevision,source?.items.map(item=>item.entityId).sort(),on,level,dimmable,owner]);
   const admitted=local||!!source?.items.some(item=>item.entityId===id&&item.areaId===area&&item.state===row.state&&item.brightness===row.brightness&&item.supportsBrightness===row.supportsBrightness);
   const binding=active&&authority&&admitted&&known?{key,local,sessionId:h.state.sessionId,taskId:light.id,revision:light.revision,optionId:id,transport:h.liveTransport}:null;
   rows.push({id,name,on,level,dimmable,binding,stale:light.stale===true||h.state?.connected===false||light.live===true&&(!source||h.live&&h.liveTransport?.connected!==true)||local&&!['on','off','mixed'].includes(light.status),unavailable:!local&&row.state==='unavailable',scopeName});
  }
  return rows;
 }
 current(id){
  return this.snapshot(this.host.currentLightDevice?.()).find(row=>row.id===id);
 }
 matches(binding,current){
  return !!binding&&!!current?.binding&&binding.key===current.binding.key&&binding.transport===current.binding.transport;
 }
 createRow(id){
  const doc=this.document,node=createKitComponent('listrow',{document:doc,tag:'section',identity:'light',className:'light-lamp-row'}),heading=createKitComponent('toggle',{document:doc,tag:'button',identity:'light',variant:'row',className:'light-lamp-heading light-lamp-toggle'}),name=doc.createElement('span'),state=doc.createElement('span'),icon=doc.createElement('img'),toggle=heading;
  applyKitTextRole(name,'group-title');applyKitTextRole(state,'body');node.dataset.lampId=id;name.className='light-lamp-name';name.id='light-lamp-name-'+encodeURIComponent(id);state.className='light-lamp-state';toggle.type='button';icon.className='light-lamp-icon';icon.src='assets/icons/lightbulb.svg';icon.alt='';applyKitComponent(icon,'icon');heading.append(icon,name,state);
  const entry={id,node,heading,icon,name,state,toggle,binding:null},field=createKitSliderField({document:doc,id:'light-lamp-'+encodeURIComponent(id),label:'Lysstyrke',identity:'light',getContext:()=>entry.binding,onCommit:(value,binding)=>this.commit(entry,value,binding)});
  field.input.setAttribute('aria-labelledby',`${name.id} ${field.label.id}`);field.node.classList.add('light-lamp-level');entry.field=field;node.append(heading,field.node);toggle.addEventListener('click',()=>this.toggle(entry));this.node.append(node);this.rows.set(id,entry);return entry;
 }
 toggle(entry){
  const current=this.current(entry.id);if(!this.matches(entry.binding,current)){entry.field.cancelDraft();this.render(this.host.currentLightDevice?.());return;}
  if(current.binding.local)this.host.dispatch?.({type:'light-toggle',sessionId:current.binding.sessionId,taskId:current.binding.taskId,revision:current.binding.revision,optionId:entry.id});
  else void this.host.actCurrentLight?.(current.on?'turn_off':'turn_on',{}, {entityId:entry.id});
  this.render(this.host.currentLightDevice?.());
 }
 commit(entry,value,binding){
  const current=this.current(entry.id);if(!Number.isInteger(value)||value<0||value>100||!current?.dimmable||!this.matches(binding,current)){entry.field.cancelDraft();this.render(this.host.currentLightDevice?.());return;}
  if(current.binding.local)this.host.dispatch?.({type:'light-brightness',sessionId:current.binding.sessionId,taskId:current.binding.taskId,revision:current.binding.revision,optionId:entry.id,value});
  else void this.host.actCurrentLight?.('brightness',{percent:value},{entityId:entry.id});
  this.render(this.host.currentLightDevice?.());
 }
 render(light){
  const rows=this.snapshot(light),visible=new Set(rows.map(row=>row.id));if(this.node.hidden!==!rows.length)this.node.hidden=!rows.length;
  for(const row of rows){
   const entry=this.rows.get(row.id)||this.createRow(row.id),current=this.current(row.id),binding=this.matches(row.binding,current)?row.binding:null;
   if(entry.binding?.key!==binding?.key||entry.binding?.transport!==binding?.transport)entry.field.cancelDraft();entry.binding=binding;if(entry.node.hidden)entry.node.hidden=false;
   if(entry.name.textContent!==row.name)entry.name.textContent=row.name;
   const status=row.on===null?(row.unavailable?'Ikke tilgængelig':'Status ukendt'):row.stale?`Sidst kendt · ${row.on?'tændt':'slukket'}`:row.on?'Tændt':'Slukket';if(entry.state.textContent!==status)entry.state.textContent=status;
   const command=this.host.lightCommandFeedback,busy=!!command&&command.target?.entityId===row.id&&['turn_on','turn_off'].includes(command.action);applyKitComponent(entry.toggle,'toggle',{feedback:'progress',loading:busy,identity:'light',variant:'row',label:`Tænd/sluk ${row.name}`,disabled:!binding,...(row.on===null?{}:{selected:row.on})});if(row.on===null)entry.toggle.removeAttribute('aria-checked');
   if(entry.field.node.hidden!==!row.dimmable)entry.field.node.hidden=!row.dimmable;entry.model={value:row.level,valueText:row.level===null?'Niveau ukendt':`${row.level} %`,scope:'',disabled:!binding||!row.dimmable||row.level===null,pending:!!command&&command.action==='brightness'&&command.target?.entityId===row.id};entry.field.setModel(entry.model);
  }
  for(const [id,entry]of this.rows)if(!visible.has(id)){if(!entry.node.hidden)entry.node.hidden=true;entry.binding=null;entry.toggle.disabled=true;entry.field.cancelDraft();entry.field.setModel({...entry.model,disabled:true});}
  return this.node;
 }
 cleanup(){for(const entry of this.rows.values()){entry.binding=null;entry.toggle.disabled=true;entry.field.cancelDraft();entry.field.setModel({...entry.model,disabled:true});}}
}
