// Lys room page (LightRoomView) with the shell's own light nodes, in Vitest with a real DOM.
// Ported when the Lys screens moved to React:
// - »Lys-Ukendt« from tests/podview/svar-lys-canvas-parity.test.mjs (node:test + fake DOM; its Svar tests stay
//   there). Same assertions; the fake document became the real one, and the source scan for »Ikke opdateret«
//   reads the new room page sources.
// - tests/podview/hue-status-placement.browser.mjs and hue-empty-owner.browser.mjs (+ their .html pages): manual
//   browser pages that imported the shell's raw modules, which no browser can load since the shell imports TSX,
//   and no runner ran them. Same assertions, with the shell's real prototype methods; one adaptation: happy-dom
//   has no layout, so `visible` checks that a node is connected and not inside [hidden], without client rects.
// Updated to the room page's current copy (Lærred »A-Lys«), which the old page predates; the old views fail them the
// same way: the empty title is »Ikke forbundet« (was »Lys«), the setup copy is »Forbind lys i Home Assistant ...«
// (was »Hue ... Home Assistant«), and »Opdater lys« (a re-read, not a command) is the one visible empty-state button.
// Added: an identical render writes nothing to the DOM, and a tap on a lamp inside the room page's disclosure
// (one React root inside another) reaches its own lamp exactly once.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../../../widget-view.js';
import {LightRoomView} from './LightRoomView';
import {LightLampView} from './LightLampView';
import {lightSelection} from '../../../scene-model.js';
import {unconfiguredLight} from '../../../podvoice-view.js';
import {scopedLightDevice,validateHome} from '../../../home-model.js';

const prototype=customElements.get('pv-widget-host').prototype,proto=prototype;
const check=(ok,message)=>{if(!ok)throw Error(message);};
const visible=node=>!!node?.isConnected&&!node.closest('[hidden]');

function lightHost(connected){
 const lights=[{id:'k1',name:'Pendler',roomId:'kok',roomName:'Køkkenalrum',on:true,state:'on'},{id:'s1',name:'Gulvlampe',roomId:'stue',roomName:'Stue',on:false,state:'off'}];
 const light={id:'lys',kind:'light',status:'mixed',stale:!connected,lights,ownRoomId:'kok',scope:'room',exampleOnly:true,lightSelectionId:'room:kok'};
 const host={state:{connected:true,focus:'lys',devices:[light]},lightRooms:document.createElement('div'),dispatch(){}};
 document.createElement('section').append(host.lightRooms);return {host,light};
}
test('Lys-Ukendt says »Status ukendt« and shows the compact info line, never »Ikke opdateret«',()=>{
 const {host,light}=lightHost(false);
 assert.ok(lightSelection(light),'fixture must be a valid light selection');
 const view=new LightRoomView(host);view.render(light);
 assert.deepEqual([...view.rows.values()].map(e=>e.status.textContent),['Status ukendt','Status ukendt']);
 assert.equal(view.panelStatus.textContent,'Status ukendt');
 assert.equal(view.notice.hidden,false);assert.equal(view.notice.getAttribute('role'),'status');
 assert.equal(view.notice.textContent,'iLysoplysninger kunne ikke hentes. Prøv igen.');
 for(const e of view.rows.values())assert.equal(e.power.disabled,true);
 const fresh=lightHost(true);const freshView=new LightRoomView(fresh.host);freshView.render(fresh.light);
 assert.equal(freshView.notice.hidden,true);
 for(const name of ['LightRoomView.tsx','RoomPage.tsx'])assert.doesNotMatch(readFileSync(new URL(name,import.meta.url),'utf8'),/Ikke opdateret/);
});

test('hue status placement: the scene status stays in the room card through scenes and no scenes',()=>{
 const assert=check;
 const now=Math.floor(Date.now()/1000),sourceEpoch='a'.repeat(64),bindingId='b'.repeat(64),transport={};
 const area={status:'observed',source:'home_assistant_area_registry',sourceEpoch,observedAt:now,validUntil:now+15,bindingId,placementRevision:1,ownAreaId:'own',selectedAreaId:'own',items:[{areaId:'own',areaName:'Køkken'}]},placement={status:'bound',areaId:'own',areaName:'Køkken',bindingId,placementRevision:1};
 function source(withScenes){const observation={status:'observed',source:'home_assistant_state',sourceEpoch,observedAt:now,validUntil:now+15,scope:{kind:'ha_area',areaId:'own',areaName:'Køkken',bindingId,placementRevision:1,isOwnArea:true},complete:true,items:[{entityId:'light.own',areaId:'own',name:'Loft',state:'on',brightness:128,supportsBrightness:true}],countUnit:'light_entities',scenes:withScenes?[{id:'c'.repeat(64),name:'Læsning',entityIds:['light.own']}]:[]};const home=validateHome({schema:'podview.home.v1',bootId:'boot',roomId:'screen',revision:1,observedAt:now,vacuum:{status:'unavailable',items:[]},lightAreas:area,lightPlacement:placement,lights:observation},'screen','boot');const light=scopedLightDevice(home.lights,home.revision);assert(light,'valid source payload');return light;}
 for(const kind of ['unknown','rejected','read']){
  const container=document.createElement('section'),anchor=document.createElement('div'),lamps=document.createElement('div');document.body.append(container);container.append(anchor,lamps);
  let light=source(false);const context={key:'scope',transport,sourceEpoch,areas:area};
  const host={live:true,isConnected:true,state:{sessionId:'s',focus:light.id,devices:[light],connected:true},liveTransport:{connected:true},liveSnapshot:{capabilities:{controlSetup:['light']}},lightRooms:anchor,lightLamps:lamps,currentLightDevice:()=>light,lightAreaContext:()=>context};
  for(const method of ['lightLocalFeedback','renderLightStatus','renderLightScenes'])host[method]=proto[method];
  if(kind==='read')host.lightReadProblem={scopeKey:'scope',transport,focus:light.id,areaId:'own',text:'Lysstatus for Køkken kunne ikke hentes.'};else host.lightActionProblem={scopeKey:'scope',transport,focus:light.id,areaId:'own',sourceEpoch,observedAt:now,phase:kind,text:kind==='unknown'?'Lysets tilstand er ikke bekræftet.':'Den seneste lysændring blev afvist.'};
  host.lightRoomView=new LightRoomView(host);
  host.renderLightScenes(light);host.lightRoomView.render(light);const status=host.lightSceneStatus;
  assert(visible(status),kind+' initially attached without room/scene catalogue');assert(status.parentNode===host.lightRoomView.panelHeader&&visible(host.lightRoomView.panel),kind+' retained status in the canonical empty Card');
  // Real validated source transition, not deletion of a demo scene array.
  light=source(true);host.state.devices=[light];host.state.lightAreas=area;host.renderLightScenes(light);host.lightRoomView.render(light);
  assert(visible(status),kind+' with scenes');assert(status.parentNode===host.lightRoomView.panelHeader,kind+' grouped in room header');
  light=source(false);host.state.devices=[light];delete host.state.lightAreas;host.renderLightScenes(light);host.lightRoomView.render(light);
  assert(host.lightScenes.hidden,kind+' optional scene content hidden');assert(visible(status),kind+' survives scenes to no scenes');assert(host.lightSceneStatus===status,kind+' retains native node');
  // Queue expiry has no DOM custody over this node.
  host.renderLightScenes(light);host.lightRoomView.render(light);assert(visible(status),kind+' repeated render remains visible');
  container.remove();
 }
});

test('hue empty owner: one room card, one lamp owner and no effects from empty to rooms and scenes and back',()=>{
 const assert=check;
 const now=Math.floor(Date.now()/1000),sourceEpoch='a'.repeat(64),bindingId='b'.repeat(64),effects=[];
 const areas={status:'observed',source:'home_assistant_area_registry',sourceEpoch,observedAt:now,validUntil:now+15,bindingId,placementRevision:1,ownAreaId:'own',selectedAreaId:'own',items:[{areaId:'own',areaName:'Køkken'}]},placement={status:'bound',areaId:'own',areaName:'Køkken',bindingId,placementRevision:1};
 function source(withScenes){const lights={status:'observed',source:'home_assistant_state',sourceEpoch,observedAt:now,validUntil:now+15,scope:{kind:'ha_area',areaId:'own',areaName:'Køkken',bindingId,placementRevision:1,isOwnArea:true},complete:true,items:[{entityId:'light.own',areaId:'own',name:'Loftlys',state:'on',brightness:128,supportsBrightness:true}],countUnit:'light_entities',scenes:withScenes?[{id:'c'.repeat(64),name:'Læsning',entityIds:['light.own']}]:[]};const home=validateHome({schema:'podview.home.v1',bootId:'boot',roomId:'screen',revision:withScenes?2:1,observedAt:now,vacuum:{status:'unavailable',items:[]},lightAreas:areas,lightPlacement:placement,lights},'screen','boot');const device=scopedLightDevice(home.lights,home.revision);assert(device,'source must pass actual home validation');return device;}
 const container=document.createElement('section'),anchor=document.createElement('div'),lampAnchor=document.createElement('div');container.id='hue-empty-owner-test';container.append(anchor,lampAnchor);document.body.append(container);
 let device=unconfiguredLight();const host={ownerDocument:document,live:true,isConnected:true,state:{sessionId:'s',focus:device.id,devices:[device],connected:true},liveTransport:{connected:true,generation:1},liveSnapshot:{bootId:'boot',roomId:'screen',capabilities:{controlSetup:[]}},lightRooms:anchor,lightLamps:lampAnchor,currentLightDevice(){return this.state.devices[0];},lightAreaContext(){return null;},closeLightDetail(){},syncLightArea(){},dispatch(){effects.push('dispatch');},liveControls:{actLight(){effects.push('actLight');}}};
 for(const method of ['lightLocalFeedback','renderLightStatus','renderLightScenes','renderLiveLightControl','actCurrentLight'])host[method]=prototype[method];host.inlineLamps=new LightLampView(host);host.lightRoomView=new LightRoomView(host);
 host.render=()=>{const current=host.currentLightDevice();host.renderLiveLightControl(current);host.renderLightScenes(current);host.inlineLamps.render(current);host.lightRoomView.render(current);};
 const adopt=(next,{catalogue=true}={})=>{device=next;host.state={...host.state,focus:next.id,devices:[next],...(catalogue?{lightAreas:areas,lightPlacement:placement}:{lightAreas:null,lightPlacement:null})};host.render();};
 try{
  adopt(device,{catalogue:false});const panel=host.lightRoomView.panel;
  assert(visible(panel),'unconfigured native light must expose the canonical Card');assert(panel.dataset.kitComponent==='card'||panel.classList.contains('pv-kit-card'),'existing registered Card');assert(host.lightRoomView.panelHeading.textContent==='Ikke forbundet','empty title is honest');assert(visible(host.lightRoomView.empty),'empty explanation visible');assert(/Forbind lys i Home Assistant/.test(host.lightRoomView.empty.textContent),'setup copy explains the actual source');assert(host.lightRoomView.list.hidden&&host.lightRoomView.toolbar.hidden,'no invented room catalogue or room actions');assert(host.lightScenes.hidden&&host.lightLampDisclosure.hidden,'no fictional scenes or lamps');assert(host.lightControlButton.hidden&&host.lightRefreshButton.hidden,'no generic modal CTA or meaningless refresh');assert(!container.querySelector('dialog'),'no modal introduced');assert([...container.querySelectorAll('button:not(.light-room-refresh),input')].every(node=>!visible(node)),'empty composition exposes no command controls');host.lightRoomView.home.click();assert(effects.length===0,'empty state creates no effects');
  host.state={...host.state,homeReadStatus:{light:'error'},lightAreas:null,lightPlacement:null};host.render();assert(/kunne ikke hentes/.test(host.lightRoomView.empty.textContent)&&!/Hue er tilsluttet/.test(host.lightRoomView.empty.textContent),'temporary read failure uses recovery copy, not setup copy');assert(host.lightRoomView.panel===panel&&visible(panel),'read error retains the same exposed Card');
  host.state={...host.state,homeReadStatus:{},lightAreas:{status:'unavailable'}};host.render();assert(/kunne ikke hentes/.test(host.lightRoomView.empty.textContent),'explicit unavailable catalogue uses read recovery copy');
  host.state={...host.state,homeReadStatus:{light:'error'},lightAreas:{status:'unbound'},lightPlacement:{status:'unbound'}};host.render();assert(/Forbind lys i Home Assistant/.test(host.lightRoomView.empty.textContent)&&!/kunne ikke hentes/.test(host.lightRoomView.empty.textContent),'actual unbound placement keeps setup copy despite a concurrent read error');
  host.state={...host.state,homeReadStatus:{light:'denied'},lightAreas:null,lightPlacement:null};host.render();assert(/Adgang.*mangler/.test(host.lightRoomView.empty.textContent)&&!/Hue er tilsluttet/.test(host.lightRoomView.empty.textContent),'denied access uses access recovery copy, not setup copy');
  host.state={...host.state,homeReadStatus:{},lightAreas:null,lightPlacement:null};host.render();assert(effects.length===0,'copy recovery states do not issue effects');
  adopt(source(false));assert(host.lightRoomView.panel===panel&&visible(panel),'scene-less source retains the same canonical Card');assert(host.lightScenes.hidden,'no scene catalogue invented');assert(visible(host.lightRoomView.empty)&&/ingen scener/.test(host.lightRoomView.empty.textContent),'scene-less copy is explicit');assert(host.lightLampDisclosure.parentNode===panel&&!host.lightLampDisclosure.hidden,'actual lamps disclosure is in the same room Card');assert(host.inlineLamps.node.parentNode===host.lightLampDisclosurePanel,'native lamp owner is inside disclosure, not a standalone sibling');assert(host.inlineLamps.rows.size===1&&host.inlineLamps.rows.has('light.own'),'only actual observed entity is projected');assert(host.lightControlButton.hidden,'native lamps do not reintroduce generic modal CTA');
  const retainedLamp=host.inlineLamps.rows.get('light.own');adopt(source(true));assert(host.lightRoomView.panel===panel&&visible(panel),'data recovery does not replace the Card');assert(!host.lightScenes.hidden&&host.lightScenes.parentNode===panel,'actual scene section appears in retained Card');assert(host.lightSceneButtons.size===1,'only the admitted scene is shown');assert(host.lightRoomView.empty.hidden,'empty copy disappears on scene recovery');assert(host.inlineLamps.rows.get('light.own')===retainedLamp,'actual lamp node retained across recovery');host.render();assert(container.querySelectorAll('#light-room-controls').length===1,'no duplicate panel after repeat');assert(container.querySelectorAll('#light-lamps-trigger').length===1,'no duplicate Disclosure after repeat');assert(container.querySelectorAll('#light-scene-level').length===1,'no duplicate shared dimmer');adopt(unconfiguredLight(),{catalogue:false});assert(host.lightRoomView.panel===panel&&visible(panel),'loss of data returns to the same Card');assert(host.lightScenes.hidden&&host.lightLampDisclosure.hidden&&host.lightRoomView.list.hidden,'stale command surfaces do not remain visible');assert(effects.length===0,'all source transitions are inert');
 }finally{clearTimeout(host.lightAreaExpiry);host.lightRoomView.cleanup();host.inlineLamps.cleanup();container.remove();}
});

test('an identical room render writes nothing to the DOM',()=>{
 for(const connected of [true,false]){
  const {host,light}=lightHost(connected),view=new LightRoomView(host);view.render(light);
  const parts=[view.panel,view.list,...[...view.rows.values()].map(row=>row.power)];
  const observer=new MutationObserver(()=>{});observer.observe(view.node,{subtree:true,childList:true,attributes:true,characterData:true});
  for(let i=0;i<3;i++)view.render(light);
  assert.deepEqual(observer.takeRecords(),[]);observer.disconnect();
  assert.deepEqual([view.panel,view.list,...[...view.rows.values()].map(row=>row.power)],parts);
 }
 const empty=lightHost(true),view=new LightRoomView(empty.host),none=unconfiguredLight();view.render(none);
 const observer=new MutationObserver(()=>{});observer.observe(view.node,{subtree:true,childList:true,attributes:true,characterData:true});
 view.render(none);assert.deepEqual(observer.takeRecords(),[]);observer.disconnect();
});

test('a lamp inside the room page reaches its own lamp exactly once; a room tap reaches its room once',()=>{
 const {host,light}=lightHost(true),events=[];light.lights[0].dimmable=true;light.lights[0].brightness=60;
 Object.assign(host,{state:{...host.state,sessionId:'s'},ownerDocument:document,currentLightDevice:()=>light,
  dispatch:event=>events.push(event)});light.revision=1;
 const disclosure=document.createElement('section'),panel=document.createElement('div');disclosure.append(panel);
 host.lightLampDisclosure=disclosure;host.lightLampDisclosurePanel=panel;
 document.body.append(host.lightRooms.parentNode);
 host.inlineLamps=new LightLampView(host);host.inlineLamps.render(light);
 const rooms=new LightRoomView(host);host.lightRoomView=rooms;rooms.render(light);
 assert.equal(host.inlineLamps.node.parentNode,panel);assert.equal(disclosure.parentNode,rooms.panel);
 host.inlineLamps.rows.get('k1').toggle.click();
 assert.deepEqual(events.map(event=>[event.type,event.optionId]),[['light-toggle','k1']]);
 rooms.rows.get('stue').power.click();
 assert.deepEqual(events.slice(1).map(event=>[event.type,event.roomId,event.action]),[['light-room-power','stue','turn_on']]);
});
