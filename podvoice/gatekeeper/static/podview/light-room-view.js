import {applyKitComponent,applyKitTextRole,createKitChoiceGroup,revealKitItem} from './ui/kit.js';
import {binding,lightSelection,lightHomeRestoreAvailable} from './scene-model.js';
import {scopedLightsObservation} from './ha-home-observation.js';

const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
const attr=(node,name,value)=>{if(node.getAttribute(name)!==String(value))node.setAttribute(name,String(value));};
const make=(tag,className)=>{const node=document.createElement(tag);node.className=className;return node;};

/** Retained ListRow + Button composition. The host owns all real effects. */
export class LightRoomView{
 constructor(host){
  this.host=host;this.rows=new Map();this.node=make('section','light-room-view');this.node.hidden=true;
  this.list=make('div','light-room-list');this.toolbar=make('div','light-room-toolbar');this.navigationHost=make('div','light-room-navigation');
  this.home=make('button','light-home-power');this.home.type='button';applyKitComponent(this.home,'button',{variant:'secondary'});const icon=make('img','');icon.src='assets/icons/house.svg';icon.alt='';applyKitComponent(icon,'icon');this.homeLabel=make('span','');this.home.append(icon,this.homeLabel);
  this.home.addEventListener('click',()=>{const d=this.current(),model=this.model(d);if(!model||model.live)return;if(model.globalRestore)this.host.dispatch({type:'light-home-restore',...binding(this.host.state,d)});else if(model.globalEnabled)this.host.dispatch({type:'light-home-power',...binding(this.host.state,d),action:'turn_off'});});
  this.panel=make('section','light-room-panel');applyKitComponent(this.panel,'card');this.panel.hidden=true;this.panel.id='light-room-controls';this.panelHeading=make('h2','light-room-panel-title');applyKitTextRole(this.panelHeading,'headline');this.panelHeading.id='light-room-panel-title';this.panel.setAttribute('aria-labelledby',this.panelHeading.id);this.panelHeader=make('header','');applyKitComponent(this.panelHeader,'sectionheader');this.panelHeader.setAttribute('data-kit-layout','stacked');this.panelHeader.append(this.panelHeading);this.panel.append(this.panelHeader);
  this.panelStatus=make('span','light-room-panel-status');this.panelHeader.append(this.panelStatus);
  this.kicker=make('span','light-room-kicker');this.kicker.hidden=true;this.panelHeader.prepend(this.kicker);
  this.refresh=make('button','light-room-refresh');this.refresh.type='button';this.refresh.textContent='Opdater lys';
  this.refresh.hidden=true;this.refresh.addEventListener('click',()=>{if(!this.refresh.disabled)void this.host.loadLiveHome?.();});
  this.empty=make('p','');applyKitTextRole(this.empty,'body');this.empty.hidden=true;this.panel.append(this.empty,this.refresh);
  // Lærred »Lys-Ukendt«: when the light status could not be read, one compact info line stands under the rooms.
  this.notice=make('p','light-room-notice');this.notice.setAttribute('role','status');this.notice.hidden=true;
  const glyph=make('i','');glyph.setAttribute('aria-hidden','true');glyph.textContent='i';const noticeText=make('span','');
  noticeText.textContent='Lysoplysninger kunne ikke hentes. Prøv igen.';this.notice.append(glyph,noticeText);
  this.toolbar.append(this.navigationHost,this.home);this.node.append(this.list,this.notice,this.toolbar,this.panel);
 }
 current(){return this.host.currentLightDevice?.()||this.host.state?.devices?.find(row=>row.id===this.deviceId);}
 model(light){
  if(!light||light.kind!=='light')return null;
  const live=light.live===true;
  if(live){
   const catalogue=this.host.state?.lightAreas,items=Array.isArray(catalogue?.items)?catalogue.items:[];
   const source=!light.stale?scopedLightsObservation(light.lightObservation):null;
   const transport=this.host.liveTransport;
   const connected=!!(this.host.live&&this.host.isConnected&&transport?.connected
    &&!transport.recoveryBlocked&&!this.host.browserOffline);
   const permitted=connected&&this.host.liveSnapshot?.capabilities?.controlSetup?.includes('light')
    &&!this.host.lightAreaPending;
   const controls=this.host.liveControls;
   const rows=items.filter(row=>typeof row.areaId==='string'&&typeof row.areaName==='string').map(row=>{
    const current=source?.status==='observed'&&source.scope.areaId===row.areaId,known=current&&source.items.length>0&&source.items.every(item=>['on','off'].includes(item.state)),on=known?source.items.filter(item=>item.state==='on').length:null;
    // Only a pending command for this room's own light blocks its tile (L1).
    const pending=controls?.lightActions?.get(JSON.stringify([row.areaId,null,null]))?.state?.pending;
    const enabled=permitted&&known&&(!pending||controls.canQueueLightInput?.({areaId:row.areaId},'toggle'));
    return {id:row.areaId,name:row.areaName,own:row.areaId===catalogue?.ownAreaId,selected:light.lightScope?.areaId===row.areaId,
     lamps:current?source.items.length:null,lampsOn:on,status:known?(on?'Tændt':'Slukket'):'Status ukendt',action:known?(on?'turn_off':'turn_on'):null,enabled:!!enabled,live:true};
   });
   return {live:true,stale:!!(light.stale||!connected),rows,placement:items.find(row=>row.areaId===catalogue?.ownAreaId)?.areaName||'',globalEnabled:false};
  }
  if(!lightSelection(light))return null;
  const groups=new Map();for(const lamp of light.lights){if(!groups.has(lamp.roomId))groups.set(lamp.roomId,{id:lamp.roomId,name:lamp.roomName,lamps:[]});groups.get(lamp.roomId).lamps.push(lamp);}
  const selected=lightSelection(light).roomId,connected=this.host.state?.connected===true,known=connected&&!light.stale&&['on','off','mixed'].includes(light.status),enabled=known&&light.exampleOnly===true&&!light.pending&&this.host.state?.focus===light.id;
  const rows=[...groups.values()].map(room=>{const on=room.lamps.filter(row=>row.on).length,roomKnown=room.lamps.every(row=>row.state===undefined||['on','off'].includes(row.state));return {id:room.id,name:room.name,own:room.id===light.ownRoomId,selected:selected===room.id,lamps:room.lamps.length,lampsOn:connected&&!light.stale&&known&&roomKnown?on:null,status:!connected||light.stale?'Status ukendt':known&&roomKnown?(on?'Tændt':'Slukket'):'Status ukendt',action:known&&roomKnown?(on?'turn_off':'turn_on'):null,enabled:enabled&&roomKnown,live:false};});
  rows.sort((a,b)=>Number(b.id===light.ownRoomId)-Number(a.id===light.ownRoomId));
  return {live:false,stale:!connected||!!light.stale,rows,placement:groups.get(light.ownRoomId)?.name||'',globalRestore:lightHomeRestoreAvailable(this.host.state,light),globalEnabled:enabled&&rows.every(row=>row.action!==null)&&light.scope==='home'&&light.lights.some(row=>row.on)};
 }
 selectRoom(id){
  const d=this.current(),model=this.model(d),row=model?.rows.find(row=>row.id===id);if(!row||row.selected)return;
  if(model.live){void Promise.resolve(this.host.readLightArea?.(id)).finally(()=>this.render(this.current()));this.render(d);}else this.host.dispatch({type:'light-select',...binding(this.host.state,d),optionId:`room:${id}`});
 }
 createRow(id){
  // Lærred »A-Lys«: the card chooses the room; the switch bottom right is the product's room power.
  const node=make('div','light-room-row'),select=make('button','light-room-select'),copy=make('span','light-room-copy'),
   tag=make('span','light-room-tag'),name=make('strong','light-room-name'),status=make('span','light-room-status'),
   power=make('button','light-room-power');
  applyKitTextRole(name,'group-title');applyKitTextRole(status,'body');select.type='button';power.type='button';
  applyKitComponent(power,'tile',{identity:'light',variant:'power'});power.dataset&&(power.dataset.pvPress='quiet');
  const icon=make('img','light-room-icon');icon.src='assets/icons/lightbulb.svg';icon.alt='';applyKitComponent(icon,'icon');
  copy.append(tag,name,status);select.append(copy);power.append(icon);node.append(select,power);
  select.addEventListener('click',()=>this.selectRoom(id));
  power.addEventListener('click',()=>{
   const d=this.current(),model=this.model(d),row=model?.rows.find(row=>row.id===id);
   if(!row?.enabled||!row.action)return;
   if(model.live)this.host.actCurrentLight?.('toggle',{}, {areaId:id});
   else this.host.dispatch({type:'light-room-power',...binding(this.host.state,d),roomId:id,action:row.action});
  });
  const entry={node,select,tag,name,status,power};this.rows.set(id,entry);return entry;
 }
 revealSelection(id){
  const reveal=()=>{this.revealFrame=null;if(this.host.isConnected===false||this.selectedRoom!==id)return;revealKitItem(this.rows.get(id)?.node,this.list);revealKitItem(this.navigation.inputs.find(input=>input.checked)?.parentElement,this.navigation.node.children[1]);};
  if(this.revealFrame)globalThis.cancelAnimationFrame?.(this.revealFrame);if(typeof globalThis.requestAnimationFrame==='function')this.revealFrame=globalThis.requestAnimationFrame(reveal);else reveal();
 }
 cleanup(){if(this.revealFrame)globalThis.cancelAnimationFrame?.(this.revealFrame);this.revealFrame=null;}

 render(light){
  this.deviceId=light?.id;const model=this.model(light);
  // Leaving for a non-device page keeps the rooms as they are while the light page slides out (ui/page-motion.js).
  const state=this.host.state,elsewhere=state?.devices?state.devices.some(d=>d.id===state.focus):true;
  if(!light||light.kind!=='light'){if(!this.node.hidden&&elsewhere)this.node.hidden=true;return this.node;}
  if(!this.node.parentNode)this.host.lightRooms?.after(this.node);if(this.node.hidden)this.node.hidden=false;
  const empty=!model?.rows?.length;this.list.hidden=empty;const notice=!empty&&model.stale===true;if(this.notice.hidden!==!notice)this.notice.hidden=!notice;this.toolbar.hidden=empty;this.empty.hidden=!empty;
  if(empty){
   this.panel.hidden=false;this.panelStatus.hidden=true;
   const unbound=this.host.state?.lightPlacement?.status==='unbound'||this.host.state?.lightAreas?.status==='unbound',read=this.host.state?.homeReadStatus?.light;
   const copy=!unbound&&read==='denied'?'Adgang til lysoplysninger mangler. Kontrollér adgangen i Home Assistant.':!unbound&&(read==='error'||this.host.state?.lightAreas?.status==='unavailable')?'Lysoplysninger kunne ikke hentes. Prøv igen, når forbindelsen er klar.':'';
   // Lærred »A-Lys« (ikke forbundet): the title, the canvas' copy and »Opdater lys« re-reads the home.
   text(this.panelHeading,copy?'Lys':'Ikke forbundet');
   text(this.empty,copy||'Forbind lys i Home Assistant for at se og styre dem her.');
   const place=this.host.state?.lightPlacement?.areaName,kicker=typeof place==='string'&&place?`${place} · denne skærms rum`:'';
   text(this.kicker,kicker);if(this.kicker.hidden!==!kicker)this.kicker.hidden=!kicker;
   const refreshable=this.host.live===true&&!!this.host.liveTransport?.connected&&!this.host.liveHomePending;
   if(this.refresh.hidden)this.refresh.hidden=false;if(this.refresh.disabled!==!refreshable)this.refresh.disabled=!refreshable;
   if(this.host.lightSceneStatus&&this.host.lightSceneStatus.parentNode!==this.panelHeader)this.panelHeader.append(this.host.lightSceneStatus);
   if(this.host.lightScenes)this.host.lightScenes.hidden=true;if(this.host.lightLampDisclosure)this.host.lightLampDisclosure.hidden=true;
   if(this.host.inlineLamps?.node)this.host.inlineLamps.node.hidden=true;
   return this.node;
  }
  if(!this.node.parentNode)this.host.lightRooms?.after(this.node);if(this.node.hidden)this.node.hidden=false;
  if(!this.refresh.hidden)this.refresh.hidden=true;if(!this.kicker.hidden)this.kicker.hidden=true;
  const ids=new Set(model.rows.map(row=>row.id));for(const[id,entry]of this.rows)if(!ids.has(id)){entry.node.remove();this.rows.delete(id);}
  model.rows.forEach((row,index)=>{const entry=this.rows.get(row.id)||this.createRow(row.id),command=this.host.lightCommandFeedback,busy=!!command&&command.target?.areaId===row.id&&!command.target.sceneId&&!command.target.entityId&&['turn_on','turn_off'].includes(command.action);applyKitComponent(entry.power,'tile',{feedback:'progress',loading:busy&&row.enabled===true});text(entry.tag,row.own?'Denne skærms rum':'Rum');text(entry.name,row.name);text(entry.status,row.status);attr(entry.power,'data-power-on',row.action==='turn_off');if(row.action)attr(entry.power,'aria-pressed',row.action==='turn_off');else if(entry.power.getAttribute('aria-pressed')!==null)entry.power.removeAttribute?.('aria-pressed');attr(entry.node,'data-selected',row.selected);attr(entry.node,'data-power-on',row.action==='turn_off');
   attr(entry.select,'aria-pressed',row.selected);attr(entry.select,'aria-label',`Vis ${row.name}`);attr(entry.power,'aria-label',row.action?`${row.action==='turn_off'?'Sluk':'Tænd'} alle lys i ${row.name}`:`Lys i ${row.name} kræver aktuel status`);attr(entry.power,'aria-disabled',!row.enabled);if(entry.power.disabled!==!row.enabled)entry.power.disabled=!row.enabled;if(this.list.children[index]!==entry.node)this.list.insertBefore(entry.node,this.list.children[index]||null);});
  const signature=JSON.stringify(model.rows.map(row=>[row.id,row.name]));if(this.navigationSignature!==signature){this.navigationSignature=signature;this.navigation?.node.remove();this.navigation=createKitChoiceGroup({document,id:'light-room',label:'Rum',variant:'navigation',choices:model.rows.map(row=>({value:row.id,label:row.name})),value:model.rows.find(row=>row.selected)?.id,onChange:id=>this.selectRoom(id)});this.navigationHost.append(this.navigation.node);}this.navigation.setValue(model.rows.find(row=>row.selected)?.id||'');
  const selected=model.rows.find(row=>row.selected);text(this.panelHeading,selected?.name||'Lys');
  const lampsKnown=Number.isInteger(selected?.lamps)&&Number.isInteger(selected?.lampsOn);
  text(this.panelStatus,lampsKnown?`${selected.lampsOn} af ${selected.lamps} lamper tændt`:selected?.status||'');
  if(this.panelStatus.hidden!==!selected)this.panelStatus.hidden=!selected;
  const count=this.host.lightLampCount;if(count)text(count,Number.isInteger(selected?.lamps)?`${selected.lamps} stk.`:'');
  // A room with one or two lamps shows them at once; more stay folded until »Lamper« is tapped.
  if(selected&&this.selectedRoom!==selected.id){this.selectedRoom=selected.id;this.revealSelection(selected.id);
   if(Number.isInteger(selected.lamps))this.host.lightLampDisclosureControl?.setExpanded(selected.lamps<=2);}
  const hasScenes=!!this.host.lightScenes&&!this.host.lightScenes.hidden,lamps=this.host.inlineLamps?.node,hasLamps=!!lamps&&!lamps.hidden;
  this.panel.hidden=false;this.empty.hidden=hasScenes;text(this.empty,'Der er ingen scener tilgængelige i dette rum.');
  if(this.host.lightSceneStatus&&this.host.lightSceneStatus.parentNode!==this.panelHeader)this.panelHeader.append(this.host.lightSceneStatus);
  if(this.host.lightScenes?.parentNode!==this.panel&&this.host.lightScenes)this.panel.append(this.host.lightScenes);
  if(this.host.lightLampDisclosure){this.host.lightLampDisclosure.hidden=!hasLamps;if(hasLamps){if(this.host.lightLampDisclosure.parentNode!==this.panel)this.panel.append(this.host.lightLampDisclosure);if(lamps.parentNode!==this.host.lightLampDisclosurePanel)this.host.lightLampDisclosurePanel.append(lamps);}}

  if(this.home.hidden!==model.live)this.home.hidden=model.live;const homeEnabled=!!(model.globalEnabled||model.globalRestore);if(this.home.disabled!==!homeEnabled)this.home.disabled=!homeEnabled;text(this.homeLabel,model.globalRestore?'Gendan lys':'Sluk alt');attr(this.home,'aria-label',model.globalRestore?'Gendan lyset i hjemmet som før slukning':'Sluk alle lys i hjemmet');attr(this.home,'title',model.globalRestore?'Gendan lyset i hjemmet som før slukning':'Sluk alle lys i hjemmet');
  return this.node;
 }
}
