// Ported from tests/podview/root-light-lamp-view.test.mjs (node:test + fake DOM) to Vitest with a real DOM, when
// the Lys screens moved to React. There was no near-duplicate copy. Same assertions. Adaptations: the fake document
// became the real one (the views' rows are mounted in it); the fake child arrays became [...children]; the fake
// `img.src` property became getAttribute('src') (a real src is an absolute URL). Added at the end: an identical
// render writes nothing to the DOM, a live lamp's toggle unlocks when the lamp is current again, a queued
// brightness behind a pending lamp command stays editable, and a lamp switching on takes the level behind it.
import {liveScene} from '../../../podvoice-view.js';
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {LightLampView} from './LightLampView';
import {previewScene} from '../../../preview-scenes.js';
import {sceneTransition,binding} from '../../../scene-model.js';

const doc=document;
const emit=(node,type,props={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,props);node.dispatchEvent(event);};
const localFixture=()=>{
 const events=[],host={ownerDocument:doc,live:false,state:previewScene('hue-kitchen',Date.now()),currentLightDevice(){return this.state.devices.find(row=>row.kind==='light');},dispatch(event){events.push(event);this.state=sceneTransition(this.state,event);}};
 const view=new LightLampView(host);document.body.append(view.node);view.render(host.currentLightDevice());return {host,view,events};
};
const browse=(f,room)=>{const d=f.host.currentLightDevice();f.host.dispatch({type:'light-select',...binding(f.host.state,d),optionId:'room:'+room});f.view.render(f.host.currentLightDevice());};
const liveFixture=()=>{
 const now=Date.now()/1000,scope={kind:'ha_area',areaId:'kitchen',areaName:'Køkken',bindingId:'b'.repeat(64),placementRevision:1,isOwnArea:true},items=[{entityId:'light.ceiling',areaId:'kitchen',name:'Pendler',state:'on',brightness:128,supportsBrightness:true},{entityId:'light.contact',areaId:'kitchen',name:'Kontakt',state:'off',brightness:null,supportsBrightness:false},{entityId:'light.unknown',areaId:'kitchen',name:'Ukendt',state:'unknown',brightness:null,supportsBrightness:true}],observation={status:'observed',source:'home_assistant_state',sourceEpoch:'a'.repeat(64),observedAt:now,validUntil:now+15,scope,complete:true,countUnit:'light_entities',items},effects=[];
 const light={id:'actual-lights',kind:'light',live:true,scope:'ha_area',source:'home_assistant_state',revision:1,status:'unknown',lightScope:scope,lightSourceEpoch:observation.sourceEpoch,lightObservation:observation,observedLights:items},host={ownerDocument:doc,live:true,state:{sessionId:'source-session',focus:light.id,connected:true,devices:[light]},liveSnapshot:{bootId:'boot',roomId:'screen',sessionId:'session',taskId:'task',inputRevision:1,capabilities:{controlSetup:['light']}},liveTransport:{connected:true,generation:1},currentLightDevice(){return this.state.devices[0];},actCurrentLight(...args){effects.push(args);return Promise.resolve({outcome:'accepted'});}};
 const view=new LightLampView(host);document.body.append(view.node);view.render(light);return {host,view,effects,light,observation};
};
const change=(entry,value)=>{emit(entry.field.input,'pointerdown');entry.field.input.value=String(value);emit(entry.field.input,'input');emit(entry.field.input,'change');};

test('selected room lamps use retained ListRow Toggle and horizontal SliderField without rendering effects',()=>{
 const f=localFixture();assert.equal(f.view.node.className,'light-lamp-list');assert.equal(f.view.rows.size,2);assert.deepEqual(f.events,[]);
 for(const entry of f.view.rows.values()){assert.equal(entry.node.dataset.kit,'listrow');assert.equal(entry.heading,entry.toggle);assert.equal(entry.heading.tagName,'BUTTON');assert.deepEqual([...entry.heading.children],[entry.icon,entry.name,entry.state]);assert.equal(entry.icon.dataset.kit,'icon');assert.equal(entry.icon.alt,'');assert.equal(entry.icon.getAttribute('src'),'assets/icons/lightbulb.svg');assert.equal(entry.node.children[1],entry.field.node);assert.equal(entry.toggle.dataset.kit,'toggle');assert.equal(entry.toggle.getAttribute('role'),'switch');assert.equal(entry.field.input.dataset.kit,'slider');assert.equal(entry.field.label.textContent,'Lysstyrke');assert.equal(entry.field.description.textContent,'');assert.equal(entry.field.input.getAttribute('aria-labelledby'),`${entry.name.id} ${entry.field.label.id}`);assert.notEqual(entry.field.input.getAttribute('aria-orientation'),'vertical');assert.equal(entry.field.input.value,'60');assert.equal(entry.state.textContent,'Tændt','A-Lys v193: the level sits beside the slider, not in the status');assert.match(entry.field.output.textContent,/^\d+ %$/);assert.equal(entry.node.dataset.lampId,entry.id);}
 const first=f.view.rows.get('hue-kitchen-1');f.view.render(f.host.currentLightDevice());assert.equal(f.view.rows.get('hue-kitchen-1'),first);assert.deepEqual(f.events,[]);assert.ok(![...f.view.node.children].some(node=>node.tagName==='DIALOG'));
 browse(f,'living');assert.equal([...f.view.rows.values()].filter(row=>!row.node.hidden).length,6);assert.equal(first.node.hidden,true);assert.equal(first.toggle.disabled,true);browse(f,'kitchen');assert.equal(f.view.rows.get(first.id),first);assert.equal(first.node.hidden,false);f.view.cleanup();
});

test('local inline lamp toggle and brightness affect only the exact lamp while preserving room, scene definitions and resources',()=>{
 const f=localFixture(),entry=f.view.rows.get('hue-kitchen-1'),before=f.host.state,d=f.host.currentLightDevice(),definition=d.lightScenes,neighbours=d.lights.filter(row=>row.id!==entry.id),placement=d.ownRoomId,selection=d.lightSelectionId;
 entry.toggle.click();assert.deepEqual(f.events[0],{type:'light-toggle',sessionId:before.sessionId,taskId:d.id,revision:d.revision,optionId:entry.id});assert.equal(f.host.currentLightDevice().lights.find(row=>row.id===entry.id).on,false);assert.equal(entry.state.textContent,'Slukket');
 // Lærred »A-Lys« v193: an off lamp's slider is dimmed and inert; switch the lamp on first.
 assert.equal(entry.field.node.dataset.lampLive,'false');assert.equal(entry.field.node.inert,true);change(entry,35);
 assert.equal(f.events.length,1,'an off lamp\'s slider sends nothing');
 entry.toggle.click();assert.equal(f.events[1].type,'light-toggle');assert.equal(entry.field.node.dataset.lampLive,'true');change(entry,35);
 assert.equal(f.events[2].type,'light-brightness');assert.equal(f.events[2].optionId,entry.id);assert.equal(f.events[2].value,35);assert.equal(f.events.length,3,'sibling slider never also toggles the lamp');assert.equal(f.host.currentLightDevice().lights.find(row=>row.id===entry.id).brightness,35);
 for(const row of neighbours)assert.equal(f.host.currentLightDevice().lights.find(next=>next.id===row.id),row);assert.equal(f.host.currentLightDevice().lightScenes,definition);assert.equal(f.host.currentLightDevice().ownRoomId,placement);assert.equal(f.host.currentLightDevice().lightSelectionId,selection);assert.equal(f.host.state.music,before.music);assert.equal(f.host.state.timer,before.timer);assert.equal(f.host.currentLightDevice().lightSceneSelections.kitchen,undefined);
});

test('unchanged observations retain a lamp draft; cancellation or changed captured revision cannot commit it',()=>{
 for(const cancel of ['pointercancel','blur','revision-render','revision-no-render','room','disconnect','remove']){
  const f=localFixture(),entry=f.view.rows.get('hue-kitchen-1');emit(entry.field.input,'pointerdown');entry.field.input.value='25';emit(entry.field.input,'input');f.view.render(f.host.currentLightDevice());assert.equal(entry.field.input.value,'25');assert.deepEqual(f.events,[]);
  if(['pointercancel','blur'].includes(cancel))emit(entry.field.input,cancel);if(cancel.startsWith('revision')){f.host.state={...f.host.state,devices:f.host.state.devices.map(row=>({...row,revision:row.revision+1}))};if(cancel==='revision-render')f.view.render(f.host.currentLightDevice());}if(cancel==='room')browse(f,'living');if(cancel==='disconnect'){f.host.state={...f.host.state,connected:false};f.view.render(f.host.currentLightDevice());}if(cancel==='remove')f.host.state={...f.host.state,devices:[]};const count=f.events.length;emit(entry.field.input,'change');assert.equal(f.events.length,count,cancel);
 }
});

test('stale title clicks cannot toggle after session, focus or room ownership changes',()=>{
 for(const change of ['session','focus','revision','room','disconnected']){
  const f=localFixture(),entry=f.view.rows.get('hue-kitchen-1');if(change==='session')f.host.state={...f.host.state,sessionId:'changed'};if(change==='focus')f.host.state={...f.host.state,focus:'now'};if(change==='revision')f.host.state={...f.host.state,devices:f.host.state.devices.map(row=>({...row,revision:row.revision+1}))};if(change==='room'){const d=f.host.currentLightDevice();f.host.state=sceneTransition(f.host.state,{type:'light-select',...binding(f.host.state,d),optionId:'room:living'});}if(change==='disconnected')f.host.state={...f.host.state,connected:false};entry.toggle.click();assert.deepEqual(f.events,[],change);
 }
});

test('live inline controls use actual raw brightness and exact entity target without optimistic state or local events',()=>{
 const f=liveFixture(),entry=f.view.rows.get('light.ceiling'),contact=f.view.rows.get('light.contact'),unknown=f.view.rows.get('light.unknown');assert.equal(entry.field.input.value,'50');assert.equal(entry.field.output.textContent,'50 %');assert.equal(entry.toggle.disabled,false);assert.equal(contact.field.node.hidden,true);assert.equal(contact.toggle.disabled,false);assert.equal(unknown.toggle.disabled,true);assert.equal(unknown.toggle.getAttribute('aria-checked'),null);assert.equal(unknown.state.textContent,'Status ukendt');assert.equal(unknown.field.output.textContent,'—','A-Lys v193: an unknown lamp reads »—« beside its inert slider');assert.equal(unknown.field.node.dataset.lampLive,'false');
 entry.toggle.click();assert.deepEqual(f.effects[0],['turn_off',{}, {entityId:'light.ceiling'}]);assert.equal(f.light.observedLights[0].state,'on');assert.equal(entry.state.textContent,'Tændt','A-Lys v193: the level sits beside the slider, not in the status');assert.match(entry.field.output.textContent,/^\d+ %$/);change(entry,35);assert.deepEqual(f.effects[1],['brightness',{percent:35},{entityId:'light.ceiling'}]);assert.equal(f.light.observedLights[0].brightness,128);assert.equal(entry.field.output.textContent,'50 %');contact.toggle.click();assert.deepEqual(f.effects[2],['turn_on',{}, {entityId:'light.contact'}]);assert.equal(f.light.observedLights[1].state,'off');assert.equal(f.effects.length,3);
});

test('readable live rows remain disabled when observations, transport or capabilities are stale, unknown or unadmitted',()=>{
 for(const reason of ['expired','unavailable','binding','no-source','transport','capability','pending']){
  const f=liveFixture(),entry=f.view.rows.get('light.ceiling');if(reason==='expired')f.observation.validUntil=Date.now()/1000-1;if(reason==='unavailable'){f.light.observedLights[0].state='unavailable';f.light.observedLights[0].brightness=null;}if(reason==='binding')f.observation.scope.areaId='foreign';if(reason==='no-source')f.light.lightObservation=null;if(reason==='transport')f.host.liveTransport.connected=false;if(reason==='capability')f.host.liveSnapshot.capabilities.controlSetup=[];if(reason==='pending')f.host.liveControls={lightActions:new Map([[JSON.stringify(['kitchen','light.ceiling',null]),{state:{pending:true}}]])};f.view.render(f.light);assert.equal(entry.toggle.disabled,true,reason);assert.equal(entry.field.input.disabled,true,reason);entry.toggle.click();change(entry,40);assert.deepEqual(f.effects,[],reason);assert.equal(entry.name.textContent,'Pendler');
 }
});

test('a live gesture rejects source, transport and native owner changes before commit',()=>{
 for(const reason of ['source','transport','generation','task','revision','brightness']){
  const f=liveFixture(),entry=f.view.rows.get('light.ceiling');emit(entry.field.input,'pointerdown');entry.field.input.value='45';emit(entry.field.input,'input');if(reason==='source')f.observation.sourceEpoch='c'.repeat(64);if(reason==='transport')f.host.liveTransport={...f.host.liveTransport};if(reason==='generation')f.host.liveTransport.generation++;if(reason==='task')f.host.liveSnapshot.taskId='changed';if(reason==='revision')f.host.liveSnapshot.inputRevision++;if(reason==='brightness')f.light.observedLights[0].brightness=200;emit(entry.field.input,'change');assert.deepEqual(f.effects,[],reason);
 }
});

test('source-shaped preview displays observed lamps without acquiring live or local effect authority',()=>{
 const f=localFixture();f.host.state=previewScene('hue-live-shaped',Date.now());f.view.render(f.host.currentLightDevice());const visible=[...f.view.rows.values()].filter(row=>!row.node.hidden);assert.equal(visible.length,2);assert.deepEqual(visible.map(row=>row.name.textContent),['Pendler','Bordlys']);for(const row of visible){assert.equal(row.field.output.textContent,'60 %');assert.equal(row.toggle.disabled,true);assert.equal(row.field.input.disabled,true);row.toggle.click();change(row,35);}assert.deepEqual(f.events,[]);
});

test('legacy local Home lamp list keeps all exact lamp identities and labels their actual room',()=>{
 const f=localFixture();f.host.state=previewScene('light-detail-on',Date.now());const d=f.host.currentLightDevice();assert.equal(d.lightSelectionId,'home');f.view.render(d);const visible=[...f.view.rows.values()].filter(row=>!row.node.hidden);assert.equal(visible.length,d.lights.length);assert.equal(visible.length,4);
 for(const row of d.lights){const entry=f.view.rows.get(row.id);assert.equal(entry.name.textContent,`${row.roomName} · ${row.name}`);assert.equal(entry.field.description.textContent,'');assert.equal(entry.field.input.getAttribute('aria-labelledby'),`${entry.name.id} ${entry.field.label.id}`);assert.equal(entry.toggle.disabled,false);}
 const entry=visible.find(row=>row.id==='living-floor'),others=d.lights.filter(row=>row.id!==entry.id);entry.toggle.click();assert.equal(f.events.at(-1).optionId,'living-floor');for(const row of others)assert.equal(f.host.currentLightDevice().lights.find(next=>next.id===row.id),row);assert.equal(f.host.currentLightDevice().lightSelectionId,'home');
});

test('disconnected cleanup cannot rearm retained rows through stale synthetic events or render',()=>{
 const f=localFixture(),entry=f.view.rows.get('hue-kitchen-1');f.host.isConnected=false;f.view.cleanup();f.view.toggle(entry);f.view.render(f.host.currentLightDevice());f.view.toggle(entry);change(entry,40);assert.deepEqual(f.events,[]);assert.equal(entry.toggle.disabled,true);assert.equal(entry.field.input.disabled,true);assert.equal(entry.binding,null);
});

test('individual command progress stays on its own toggle or Slider and cleans up',()=>{
 const f=localFixture(),d=f.host.currentLightDevice(),rows=[...f.view.rows.values()];f.host.lightCommandFeedback={target:{entityId:rows[0].id},action:'turn_off'};f.view.render(d);assert.equal(rows[0].toggle.getAttribute('aria-busy'),'true');assert.equal(rows[1].toggle.getAttribute('aria-busy'),'false');assert.equal(rows[0].state.textContent,'Tændt','A-Lys v193: the level sits beside the slider, not in the status');f.host.lightCommandFeedback={target:{entityId:rows[0].id},action:'brightness'};f.view.render(d);assert.equal(rows[0].toggle.getAttribute('aria-busy'),'false');assert.equal(rows[0].field.node.getAttribute('aria-busy'),'true');f.host.lightCommandFeedback=null;f.view.render(d);assert.equal(rows[0].field.node.getAttribute('aria-busy'),'false');
});

 test('actual liveScene local authority latch cannot disable fresh admitted live lamps',()=>{
 const f=liveFixture();f.host.liveSnapshot={...f.host.liveSnapshot,voice:{sessionId:'live-session'},timers:{status:'observed',items:[]},capabilities:{homeRead:['light'],controlSetup:['light']}};
 f.host.state=liveScene({...f.host.state,extraTimers:[],answers:[],music:{playback:{}}},f.host.liveSnapshot);assert.equal(f.host.state.connected,false);
 f.view.render(f.light);const row=f.view.rows.get('light.ceiling');assert.equal(row.toggle.disabled,false);assert.equal(row.field.input.disabled,false);assert.equal(row.state.textContent,'Tændt','A-Lys v193: the level sits beside the slider, not in the status');
 for(const reason of ['transport','blocked','browser','capability','expired']){const saved=f.observation.validUntil;f.host.liveTransport.connected=reason!=='transport';f.host.liveTransport.recoveryBlocked=reason==='blocked';f.host.browserOffline=reason==='browser';f.host.liveSnapshot.capabilities.controlSetup=reason==='capability'?[]:['light'];if(reason==='expired')f.observation.validUntil=Date.now()/1000-1;f.view.render(f.light);assert.equal(row.toggle.disabled,true,reason);assert.equal(row.field.input.disabled,true,reason);f.observation.validUntil=saved;}
 assert.deepEqual(f.effects,[]);f.view.cleanup();
 });
// L1: a pending command for one lamp never greys another lamp.
test('another lamp stays tappable while one lamp command is pending',()=>{
 const f=liveFixture();
 f.host.liveControls={lightActions:new Map([[JSON.stringify(['kitchen','light.ceiling',null]),{state:{pending:true}}]])};
 f.view.render(f.light);
 const ceiling=f.view.rows.get('light.ceiling'),contact=f.view.rows.get('light.contact');
 assert.equal(ceiling.toggle.disabled,true,'the pending lamp waits');
 assert.equal(contact.toggle.disabled,false,'the other lamp is not greyed');
 contact.toggle.click();assert.equal(f.effects.length,1,'the other lamp sends its own command');
});

const writesDuring=(node,action)=>{
 const observer=new MutationObserver(()=>{});observer.observe(node,{subtree:true,childList:true,attributes:true,characterData:true});
 action();const records=observer.takeRecords();observer.disconnect();return records;
};

test('an identical render writes nothing to the DOM',()=>{
 for(const f of [localFixture(),liveFixture()]){
  const light=()=>f.host.currentLightDevice();f.view.render(light());
  const rows=[...f.view.rows.values()],nodes=rows.map(row=>[row.node,row.toggle,row.field.input,row.field.output]);
  assert.deepEqual(writesDuring(f.view.node,()=>{for(let i=0;i<3;i++)f.view.render(light());}),[]);
  assert.deepEqual([...f.view.rows.values()].map(row=>[row.node,row.toggle,row.field.input,row.field.output]),nodes);
 }
 // A held draft is kept and nothing is rewritten while the observation stays the same.
 const f=localFixture(),entry=f.view.rows.get('hue-kitchen-1');emit(entry.field.input,'pointerdown');entry.field.input.value='25';
 emit(entry.field.input,'input');assert.deepEqual(writesDuring(f.view.node,()=>f.view.render(f.host.currentLightDevice())),[]);
 assert.equal(entry.field.input.value,'25');assert.equal(entry.field.output.textContent,'25 %');
});

test('a live lamp toggle disabled while its lamp was not current unlocks when the lamp is current again',()=>{
 const f=liveFixture(),entry=f.view.rows.get('light.ceiling');f.host.liveTransport.connected=false;f.view.render(f.light);
 assert.equal(entry.toggle.disabled,true);assert.equal(entry.toggle.getAttribute('aria-disabled'),'true');
 f.host.liveTransport.connected=true;f.view.render(f.light);
 assert.equal(entry.toggle.disabled,false,'taps never stay locked');assert.equal(entry.toggle.getAttribute('aria-disabled'),'false');
 entry.toggle.click();assert.deepEqual(f.effects,[['turn_off',{}, {entityId:'light.ceiling'}]]);
});

test('a brightness queued behind a pending lamp command stays editable and commits as the latest wish',()=>{
 const f=liveFixture(),entry=f.view.rows.get('light.ceiling'),queue={blocked:false};
 f.host.liveControls={lightActions:new Map([[JSON.stringify(['kitchen','light.ceiling',null]),{state:{pending:true,action:'brightness'},queue}]]),
  canQueueLightInput:(target,kind)=>target.entityId==='light.ceiling'&&kind==='brightness'};
 f.host.lightCommandFeedback={target:{entityId:'light.ceiling'},action:'brightness',requestedPercent:30};f.view.render(f.light);
 assert.equal(entry.toggle.disabled,true,'the toggle waits for the pending command');assert.equal(entry.field.input.disabled,false);
 assert.equal(entry.field.input.value,'30','the slider shows the requested level');assert.equal(entry.field.node.getAttribute('aria-busy'),'true');
 emit(entry.field.input,'pointerdown');entry.field.input.value='70';emit(entry.field.input,'input');
 f.view.render(f.light);assert.equal(entry.field.input.value,'70','the gesture keeps its draft through a render');
 emit(entry.field.input,'change');assert.deepEqual(f.effects,[['brightness',{percent:70},{entityId:'light.ceiling'}]]);
 queue.blocked=true;emit(entry.field.input,'pointerdown');entry.field.input.value='20';emit(entry.field.input,'input');
 emit(entry.field.input,'change');assert.equal(f.effects.length,1,'a blocked queue takes no further wish');
});

test('a lamp that is switching on takes the level behind it; an off lamp without one stays inert',()=>{
 const f=liveFixture(),contact=f.view.rows.get('light.ceiling');f.light.observedLights[0].state='off';
 f.observation.items[0].state='off';f.view.render(f.light);
 assert.equal(contact.field.node.dataset.lampLive,'false');assert.equal(contact.field.node.inert,true);
 for(const key of [['kitchen','light.ceiling',null],['kitchen',null,null]]){
  f.host.liveControls={lightActions:new Map([[JSON.stringify(key),{state:{pending:true,action:'turn_on'}}]])};f.view.render(f.light);
  assert.equal(contact.field.node.dataset.lampLive,'true',JSON.stringify(key));assert.equal(contact.field.node.inert,false);
 }
});
