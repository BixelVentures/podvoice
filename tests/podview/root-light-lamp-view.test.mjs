import {liveScene} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {LightLampView} from '../../podvoice/gatekeeper/static/podview/light-lamp-view.js';
import {previewScene} from '../../podvoice/gatekeeper/static/podview/preview-scenes.js';
import {sceneTransition,binding} from '../../podvoice/gatekeeper/static/podview/scene-model.js';

class Node extends EventTarget{
 constructor(tag){super();this.tagName=tag.toUpperCase();this.attributes=new Map();this.dataset={};this.children=[];this.className='';this.style={values:new Map(),getPropertyValue(key){return this.values.get(key)||'';},setProperty(key,value){this.values.set(key,value);}};this.classList={add:(...names)=>{this.className=[this.className,...names].filter(Boolean).join(' ');}};if(['input','button'].includes(tag))this.disabled=false;}
 getAttribute(name){return this.attributes.get(name)??null;}
 setAttribute(name,value){this.attributes.set(name,String(value));if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
 removeAttribute(name){this.attributes.delete(name);}
 append(...nodes){this.children.push(...nodes);for(const node of nodes)node.parentNode=this;}
 click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
}
const doc={createElement:tag=>new Node(tag)};
const emit=(node,type,props={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,props);node.dispatchEvent(event);};
const localFixture=()=>{
 const events=[],host={ownerDocument:doc,live:false,state:previewScene('hue-kitchen',Date.now()),currentLightDevice(){return this.state.devices.find(row=>row.kind==='light');},dispatch(event){events.push(event);this.state=sceneTransition(this.state,event);}};
 const view=new LightLampView(host);view.render(host.currentLightDevice());return {host,view,events};
};
const browse=(f,room)=>{const d=f.host.currentLightDevice();f.host.dispatch({type:'light-select',...binding(f.host.state,d),optionId:'room:'+room});f.view.render(f.host.currentLightDevice());};
const liveFixture=()=>{
 const now=Date.now()/1000,scope={kind:'ha_area',areaId:'kitchen',areaName:'Køkken',bindingId:'b'.repeat(64),placementRevision:1,isOwnArea:true},items=[{entityId:'light.ceiling',areaId:'kitchen',name:'Pendler',state:'on',brightness:128,supportsBrightness:true},{entityId:'light.contact',areaId:'kitchen',name:'Kontakt',state:'off',brightness:null,supportsBrightness:false},{entityId:'light.unknown',areaId:'kitchen',name:'Ukendt',state:'unknown',brightness:null,supportsBrightness:true}],observation={status:'observed',source:'home_assistant_state',sourceEpoch:'a'.repeat(64),observedAt:now,validUntil:now+15,scope,complete:true,countUnit:'light_entities',items},effects=[];
 const light={id:'actual-lights',kind:'light',live:true,scope:'ha_area',source:'home_assistant_state',revision:1,status:'unknown',lightScope:scope,lightSourceEpoch:observation.sourceEpoch,lightObservation:observation,observedLights:items},host={ownerDocument:doc,live:true,state:{sessionId:'source-session',focus:light.id,connected:true,devices:[light]},liveSnapshot:{bootId:'boot',roomId:'screen',sessionId:'session',taskId:'task',inputRevision:1,capabilities:{controlSetup:['light']}},liveTransport:{connected:true,generation:1},currentLightDevice(){return this.state.devices[0];},actCurrentLight(...args){effects.push(args);return Promise.resolve({outcome:'accepted'});}};
 const view=new LightLampView(host);view.render(light);return {host,view,effects,light,observation};
};
const change=(entry,value)=>{emit(entry.field.input,'pointerdown');entry.field.input.value=String(value);emit(entry.field.input,'input');emit(entry.field.input,'change');};

test('selected room lamps use retained ListRow Toggle and horizontal SliderField without rendering effects',()=>{
 const f=localFixture();assert.equal(f.view.node.className,'light-lamp-list');assert.equal(f.view.rows.size,2);assert.deepEqual(f.events,[]);
 for(const entry of f.view.rows.values()){assert.equal(entry.node.dataset.kit,'listrow');assert.equal(entry.heading,entry.toggle);assert.equal(entry.heading.tagName,'BUTTON');assert.deepEqual(entry.heading.children,[entry.icon,entry.name,entry.state]);assert.equal(entry.icon.dataset.kit,'icon');assert.equal(entry.icon.alt,'');assert.equal(entry.icon.src,'assets/icons/lightbulb.svg');assert.equal(entry.node.children[1],entry.field.node);assert.equal(entry.toggle.dataset.kit,'toggle');assert.equal(entry.toggle.getAttribute('role'),'switch');assert.equal(entry.field.input.dataset.kit,'slider');assert.equal(entry.field.label.textContent,'Lysstyrke');assert.equal(entry.field.description.textContent,'');assert.equal(entry.field.input.getAttribute('aria-labelledby'),`${entry.name.id} ${entry.field.label.id}`);assert.notEqual(entry.field.input.getAttribute('aria-orientation'),'vertical');assert.equal(entry.field.input.value,'60');assert.equal(entry.state.textContent,'Tændt');assert.equal(entry.node.dataset.lampId,entry.id);}
 const first=f.view.rows.get('hue-kitchen-1');f.view.render(f.host.currentLightDevice());assert.equal(f.view.rows.get('hue-kitchen-1'),first);assert.deepEqual(f.events,[]);assert.ok(!f.view.node.children.some(node=>node.tagName==='DIALOG'));
 browse(f,'living');assert.equal([...f.view.rows.values()].filter(row=>!row.node.hidden).length,6);assert.equal(first.node.hidden,true);assert.equal(first.toggle.disabled,true);browse(f,'kitchen');assert.equal(f.view.rows.get(first.id),first);assert.equal(first.node.hidden,false);f.view.cleanup();
});

test('local inline lamp toggle and brightness affect only the exact lamp while preserving room, scene definitions and resources',()=>{
 const f=localFixture(),entry=f.view.rows.get('hue-kitchen-1'),before=f.host.state,d=f.host.currentLightDevice(),definition=d.lightScenes,neighbours=d.lights.filter(row=>row.id!==entry.id),placement=d.ownRoomId,selection=d.lightSelectionId;
 entry.toggle.click();assert.deepEqual(f.events[0],{type:'light-toggle',sessionId:before.sessionId,taskId:d.id,revision:d.revision,optionId:entry.id});assert.equal(f.host.currentLightDevice().lights.find(row=>row.id===entry.id).on,false);assert.equal(entry.state.textContent,'Slukket');change(entry,35);
 assert.equal(f.events[1].type,'light-brightness');assert.equal(f.events[1].optionId,entry.id);assert.equal(f.events[1].value,35);assert.equal(f.events.length,2,'sibling slider never also toggles the lamp');assert.equal(f.host.currentLightDevice().lights.find(row=>row.id===entry.id).brightness,35);
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
 const f=liveFixture(),entry=f.view.rows.get('light.ceiling'),contact=f.view.rows.get('light.contact'),unknown=f.view.rows.get('light.unknown');assert.equal(entry.field.input.value,'50');assert.equal(entry.field.output.textContent,'50 %');assert.equal(entry.toggle.disabled,false);assert.equal(contact.field.node.hidden,true);assert.equal(contact.toggle.disabled,false);assert.equal(unknown.toggle.disabled,true);assert.equal(unknown.toggle.getAttribute('aria-checked'),null);assert.equal(unknown.state.textContent,'Status ukendt');assert.equal(unknown.field.output.textContent,'Niveau ukendt');
 entry.toggle.click();assert.deepEqual(f.effects[0],['turn_off',{}, {entityId:'light.ceiling'}]);assert.equal(f.light.observedLights[0].state,'on');assert.equal(entry.state.textContent,'Tændt');change(entry,35);assert.deepEqual(f.effects[1],['brightness',{percent:35},{entityId:'light.ceiling'}]);assert.equal(f.light.observedLights[0].brightness,128);assert.equal(entry.field.output.textContent,'50 %');contact.toggle.click();assert.deepEqual(f.effects[2],['turn_on',{}, {entityId:'light.contact'}]);assert.equal(f.light.observedLights[1].state,'off');assert.equal(f.effects.length,3);
});

test('readable live rows remain disabled when observations, transport or capabilities are stale, unknown or unadmitted',()=>{
 for(const reason of ['expired','unavailable','binding','no-source','transport','capability','pending']){
  const f=liveFixture(),entry=f.view.rows.get('light.ceiling');if(reason==='expired')f.observation.validUntil=Date.now()/1000-1;if(reason==='unavailable'){f.light.observedLights[0].state='unavailable';f.light.observedLights[0].brightness=null;}if(reason==='binding')f.observation.scope.areaId='foreign';if(reason==='no-source')f.light.lightObservation=null;if(reason==='transport')f.host.liveTransport.connected=false;if(reason==='capability')f.host.liveSnapshot.capabilities.controlSetup=[];if(reason==='pending')f.host.liveControls={lightActionState:{pending:true}};f.view.render(f.light);assert.equal(entry.toggle.disabled,true,reason);assert.equal(entry.field.input.disabled,true,reason);entry.toggle.click();change(entry,40);assert.deepEqual(f.effects,[],reason);assert.equal(entry.name.textContent,'Pendler');
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
 const f=localFixture(),d=f.host.currentLightDevice(),rows=[...f.view.rows.values()];f.host.lightCommandFeedback={target:{entityId:rows[0].id},action:'turn_off'};f.view.render(d);assert.equal(rows[0].toggle.getAttribute('aria-busy'),'true');assert.equal(rows[1].toggle.getAttribute('aria-busy'),'false');assert.equal(rows[0].state.textContent,'Tændt');f.host.lightCommandFeedback={target:{entityId:rows[0].id},action:'brightness'};f.view.render(d);assert.equal(rows[0].toggle.getAttribute('aria-busy'),'false');assert.equal(rows[0].field.node.getAttribute('aria-busy'),'true');f.host.lightCommandFeedback=null;f.view.render(d);assert.equal(rows[0].field.node.getAttribute('aria-busy'),'false');
});

 test('actual liveScene local authority latch cannot disable fresh admitted live lamps',()=>{
 const f=liveFixture();f.host.liveSnapshot={...f.host.liveSnapshot,voice:{sessionId:'live-session'},timers:{status:'observed',items:[]},capabilities:{homeRead:['light'],controlSetup:['light']}};
 f.host.state=liveScene({...f.host.state,extraTimers:[],answers:[],music:{playback:{}}},f.host.liveSnapshot);assert.equal(f.host.state.connected,false);
 f.view.render(f.light);const row=f.view.rows.get('light.ceiling');assert.equal(row.toggle.disabled,false);assert.equal(row.field.input.disabled,false);assert.equal(row.state.textContent,'Tændt');
 for(const reason of ['transport','blocked','browser','capability','expired']){const saved=f.observation.validUntil;f.host.liveTransport.connected=reason!=='transport';f.host.liveTransport.recoveryBlocked=reason==='blocked';f.host.browserOffline=reason==='browser';f.host.liveSnapshot.capabilities.controlSetup=reason==='capability'?[]:['light'];if(reason==='expired')f.observation.validUntil=Date.now()/1000-1;f.view.render(f.light);assert.equal(row.toggle.disabled,true,reason);assert.equal(row.field.input.disabled,true,reason);f.observation.validUntil=saved;}
 assert.deepEqual(f.effects,[]);f.view.cleanup();
 });
