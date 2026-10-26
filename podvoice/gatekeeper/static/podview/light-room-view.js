import {applyKitComponent} from './ui/kit.js';
import {binding,lightSelection} from './scene-model.js';
import {scopedLightsObservation} from './ha-home-observation.js';

const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
const attr=(node,name,value)=>{if(node.getAttribute(name)!==String(value))node.setAttribute(name,String(value));};
const make=(tag,className)=>{const node=document.createElement(tag);node.className=className;return node;};

/** Retained ListRow + Button composition. The host owns all real effects. */
export class LightRoomView{
 constructor(host){
  this.host=host;this.rows=new Map();this.node=make('section','light-room-view');this.node.hidden=true;
  this.list=make('div','light-room-list');this.toolbar=make('div','light-room-toolbar');this.selectorLabel=make('label','light-room-selector');const label=make('span','light-room-select-label');text(label,'Scener i');this.selector=make('select','light-room-select');this.selector.setAttribute('aria-label','Rum for scener');applyKitComponent(this.selector,'button',{variant:'secondary'});this.selectorLabel.append(label,this.selector);this.options=new Map();this.selector.addEventListener('change',()=>this.selectRoom(this.selector.value));
  this.home=make('button','light-home-power');this.home.type='button';text(this.home,'Sluk alle lys i hjemmet');applyKitComponent(this.home,'button',{identity:'light',variant:'secondary'});
  this.home.addEventListener('click',()=>{const d=this.current(),model=this.model(d);if(!model||model.live||!model.globalEnabled)return;this.host.dispatch({type:'light-home-power',...binding(this.host.state,d),action:'turn_off'});});
  this.toolbar.append(this.selectorLabel,this.home);this.node.append(this.list,this.toolbar);
 }
 current(){return this.host.currentLightDevice?.()||this.host.state?.devices?.find(row=>row.id===this.deviceId);}
 model(light){
  if(!light||light.kind!=='light')return null;
  const live=light.live===true;
  if(live){
   const catalogue=this.host.state?.lightAreas,items=Array.isArray(catalogue?.items)?catalogue.items:[],source=!light.stale?scopedLightsObservation(light.lightObservation):null,connected=!!(this.host.live&&this.host.isConnected&&this.host.liveTransport?.connected),permitted=connected&&this.host.liveSnapshot?.capabilities?.controlSetup?.includes('light')&&!this.host.lightAreaPending&&!this.host.liveControls?.lightActionState?.pending;
   const rows=items.filter(row=>typeof row.areaId==='string'&&typeof row.areaName==='string').map(row=>{
    const current=source?.status==='observed'&&source.scope.areaId===row.areaId,known=current&&source.items.length>0&&source.items.every(item=>['on','off'].includes(item.state)),on=known?source.items.filter(item=>item.state==='on').length:null;
    return {id:row.areaId,name:row.areaName,selected:light.lightScope?.areaId===row.areaId,status:known?(on?'Tændt':'Slukket'):light.lightScope?.areaId===row.areaId&&(light.stale||!connected)?'Sidst kendt':'Status ukendt',action:known?(on?'turn_off':'turn_on'):null,enabled:!!(permitted&&known),live:true};
   });
   return {live:true,rows,placement:items.find(row=>row.areaId===catalogue?.ownAreaId)?.areaName||'',globalEnabled:false};
  }
  if(!lightSelection(light))return null;
  const groups=new Map();for(const lamp of light.lights){if(!groups.has(lamp.roomId))groups.set(lamp.roomId,{id:lamp.roomId,name:lamp.roomName,lamps:[]});groups.get(lamp.roomId).lamps.push(lamp);}
  const selected=lightSelection(light).roomId,connected=this.host.state?.connected===true,known=connected&&!light.stale&&['on','off','mixed'].includes(light.status),enabled=known&&light.exampleOnly===true&&!light.pending&&this.host.state?.focus===light.id;
  const rows=[...groups.values()].map(room=>{const on=room.lamps.filter(row=>row.on).length,roomKnown=room.lamps.every(row=>row.state===undefined||['on','off'].includes(row.state));return {id:room.id,name:room.name,selected:selected===room.id,status:!connected||light.stale?'Sidst kendt':known&&roomKnown?(on?'Tændt':'Slukket'):'Status ukendt',action:known&&roomKnown?(on?'turn_off':'turn_on'):null,enabled:enabled&&roomKnown,live:false};});
  rows.sort((a,b)=>Number(b.id===light.ownRoomId)-Number(a.id===light.ownRoomId));
  return {live:false,rows,placement:groups.get(light.ownRoomId)?.name||'',globalEnabled:enabled&&rows.every(row=>row.action!==null)&&light.scope==='home'&&light.lights.some(row=>row.on)};
 }
 selectRoom(id){
  const d=this.current(),model=this.model(d),row=model?.rows.find(row=>row.id===id);if(!row||row.selected)return;
  if(model.live){void Promise.resolve(this.host.readLightArea?.(id)).finally(()=>this.render(this.current()));this.render(d);}else this.host.dispatch({type:'light-select',...binding(this.host.state,d),optionId:`room:${id}`});
 }
 createRow(id){
  const node=make('div','light-room-row'),copy=make('span','light-room-copy'),name=make('strong','light-room-name'),status=make('span','light-room-status'),power=make('button','light-room-power');power.type='button';applyKitComponent(power,'tile',{identity:'light',variant:'power'});power.dataset&&(power.dataset.pvPress='quiet');const icon=make('img','light-room-icon');icon.src='assets/icons/lightbulb.svg';icon.alt='';applyKitComponent(icon,'icon');copy.append(name,status);power.append(icon,copy);node.append(power);
  power.addEventListener('click',()=>{const d=this.current(),model=this.model(d),row=model?.rows.find(row=>row.id===id);if(!row?.enabled||!row.action)return;if(model.live)this.host.actCurrentLight?.(row.action,{}, {areaId:id});else this.host.dispatch({type:'light-room-power',...binding(this.host.state,d),roomId:id,action:row.action});});
  const entry={node,name,status,power};this.rows.set(id,entry);return entry;
 }
 render(light){
  this.deviceId=light?.id;const model=this.model(light);if(!model||!model.rows.length){if(!this.node.hidden)this.node.hidden=true;if(!this.home.hidden)this.home.hidden=true;return this.node;}
  if(!this.node.parentNode)this.host.lightRooms?.after(this.node);if(this.node.hidden)this.node.hidden=false;
  const ids=new Set(model.rows.map(row=>row.id));for(const[id,entry]of this.rows)if(!ids.has(id)){entry.node.remove();this.rows.delete(id);}
  model.rows.forEach((row,index)=>{const entry=this.rows.get(row.id)||this.createRow(row.id);text(entry.name,row.name);text(entry.status,row.status);attr(entry.power,'data-power-on',row.action==='turn_off');if(row.action)attr(entry.power,'aria-pressed',row.action==='turn_off');else if(entry.power.getAttribute('aria-pressed')!==null)entry.power.removeAttribute?.('aria-pressed');attr(entry.node,'data-selected',row.selected);attr(entry.power,'aria-label',row.action?`${row.action==='turn_off'?'Sluk':'Tænd'} alle lys i ${row.name}`:`Lys i ${row.name} kræver aktuel status`);attr(entry.power,'aria-disabled',!row.enabled);if(entry.power.disabled!==!row.enabled)entry.power.disabled=!row.enabled;if(this.list.children[index]!==entry.node)this.list.insertBefore(entry.node,this.list.children[index]||null);});
  for(const row of model.rows){let option=this.options.get(row.id);if(!option){option=make('option','');option.value=row.id;this.selector.append(option);this.options.set(row.id,option);}text(option,row.name);}for(const[id,option]of this.options)if(!ids.has(id)){option.remove();this.options.delete(id);}const selection=model.rows.find(row=>row.selected)?.id||'';if(this.selector.value!==selection)this.selector.value=selection;
  if(this.home.hidden!==model.live)this.home.hidden=model.live;if(this.home.disabled!==!model.globalEnabled)this.home.disabled=!model.globalEnabled;
  return this.node;
 }
}
