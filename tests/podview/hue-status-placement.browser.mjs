import '../../podvoice/gatekeeper/static/podview/widget-view.js';
import {LightRoomView} from '../../podvoice/gatekeeper/static/podview/light-room-view.js';
import {scopedLightDevice,validateHome} from '../../podvoice/gatekeeper/static/podview/home-model.js';
const proto=customElements.get('pv-widget-host').prototype;
const assert=(ok,message)=>{if(!ok)throw Error(message);};
export async function run(){
 const now=Math.floor(Date.now()/1000),sourceEpoch='a'.repeat(64),bindingId='b'.repeat(64),transport={},results=[];
 const area={status:'observed',source:'home_assistant_area_registry',sourceEpoch,observedAt:now,validUntil:now+15,bindingId,placementRevision:1,ownAreaId:'own',selectedAreaId:'own',items:[{areaId:'own',areaName:'Køkken'}]},placement={status:'bound',areaId:'own',areaName:'Køkken',bindingId,placementRevision:1};
 function source(withScenes){const observation={status:'observed',source:'home_assistant_state',sourceEpoch,observedAt:now,validUntil:now+15,scope:{kind:'ha_area',areaId:'own',areaName:'Køkken',bindingId,placementRevision:1,isOwnArea:true},complete:true,items:[{entityId:'light.own',areaId:'own',name:'Loft',state:'on',brightness:128,supportsBrightness:true}],countUnit:'light_entities',scenes:withScenes?[{id:'c'.repeat(64),name:'Læsning',entityIds:['light.own']}]:[]};const home=validateHome({schema:'podview.home.v1',bootId:'boot',roomId:'screen',revision:1,observedAt:now,vacuum:{status:'unavailable',items:[]},lightAreas:area,lightPlacement:placement,lights:observation},'screen','boot');const light=scopedLightDevice(home.lights,home.revision);assert(light,'valid source payload');return light;}
 const visible=node=>node.isConnected&&!node.closest('[hidden]')&&node.getClientRects().length>0;
 for(const kind of ['unknown','rejected','read']){
  const container=document.createElement('section'),anchor=document.createElement('div'),lamps=document.createElement('div');document.body.append(container);container.append(anchor,lamps);
  let light=source(false);const context={key:'scope',transport,sourceEpoch,areas:area};
  const host={live:true,isConnected:true,state:{sessionId:'s',focus:light.id,devices:[light],connected:true},liveTransport:{connected:true},liveSnapshot:{capabilities:{controlSetup:['light']}},lightRooms:anchor,lightLamps:lamps,currentLightDevice:()=>light,lightAreaContext:()=>context};
  for(const method of ['lightLocalFeedback','renderLightStatus','renderLightScenes'])host[method]=proto[method];
  if(kind==='read')host.lightReadProblem={scopeKey:'scope',transport,focus:light.id,areaId:'own',text:'Lysstatus for Køkken kunne ikke hentes.'};else host.lightActionProblem={scopeKey:'scope',transport,focus:light.id,areaId:'own',sourceEpoch,observedAt:now,phase:kind,text:kind==='unknown'?'Lysets tilstand er ikke bekræftet.':'Den seneste lysændring blev afvist.'};
  host.lightRoomView=new LightRoomView(host);
  host.renderLightScenes(light);host.lightRoomView.render(light);const status=host.lightSceneStatus;
  assert(visible(status),kind+' initially attached without room/scene catalogue');assert(status.parentNode===container,kind+' independent of optional panel');
  // Real validated source transition, not deletion of a demo scene array.
  light=source(true);host.state.devices=[light];host.state.lightAreas=area;host.renderLightScenes(light);host.lightRoomView.render(light);
  assert(visible(status),kind+' with scenes');assert(status.parentNode===host.lightRoomView.panelHeader,kind+' grouped in room header');
  light=source(false);host.state.devices=[light];delete host.state.lightAreas;host.renderLightScenes(light);host.lightRoomView.render(light);
  assert(host.lightScenes.hidden,kind+' optional scene content hidden');assert(visible(status),kind+' survives scenes to no scenes');assert(host.lightSceneStatus===status,kind+' retains native node');
  // Queue expiry has no DOM custody over this node.
  host.renderLightScenes(light);host.lightRoomView.render(light);assert(visible(status),kind+' repeated render remains visible');
  results.push(kind+': PASS initial no-scenes + valid-source scenes→no-scenes + same retained native DOM');container.remove();
 }
 return results;
}
