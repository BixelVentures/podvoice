import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {previewScene} from '../../podvoice/gatekeeper/static/podview/preview-scenes.js';
import {sceneTransition} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {TimerView,timerPresentation} from '../../podvoice/gatekeeper/static/podview/timer-view.js';
import {timersFor,timerStateLabel,timerTime} from '../../podvoice/gatekeeper/static/podview/timer-model.js';
import {robotExperience} from '../../podvoice/gatekeeper/static/podview/robot-observation.js';
import {devicePresentation,lightSelection,robotRecentCompletion} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {vehicleRailPresentation} from '../../podvoice/gatekeeper/static/podview/vehicle-model.js';

const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
const start=source.indexOf(' renderResourceRail(){'),end=source.indexOf('\n render(){',start);
const railMethod=new Function('$','timerPresentation','timersFor','timerStateLabel','timerTime','devicePresentation','lightSelection','createResourceTile','updateResourceTile','robotExperience','robotRecentCompletion','vehicleRailPresentation',`return ({${source.slice(start,end)}}).renderResourceRail;`);
function fixture(state){
 const rail={hidden:false,children:[],append(node){this.children.push(node);},insertBefore(node,before){const previous=this.children.indexOf(node);if(previous>=0)this.children.splice(previous,1);const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,node);}},updates=[],actions=[];
 const tile={hidden:false,dataset:{},kind:'timer'};
 const host={state,resourceButtons:new Map([[state.timer.id,tile]]),dispatch:event=>actions.push(event),focusHeading(){}};
 host.renderRail=railMethod(()=>rail,timerPresentation,timersFor,timerStateLabel,timerTime,devicePresentation,lightSelection,()=>({hidden:false,dataset:{}}),(node,resource)=>updates.push(resource),robotExperience,robotRecentCompletion,vehicleRailPresentation);
 return {host,rail,tile,updates,actions};
}

test('canonical answer composition omits inline timer through running, paused and finished states without stopping the resource',()=>{
 for(const status of ['running','paused','done']){
  const state=previewScene('conversation-followup',100000);state.devices=[];state.timer={...state.timer,status};const timer=state.timer,f=fixture(state);
  f.host.renderRail();f.host.renderRail();
  assert.equal(f.rail.hidden,true,status);assert.equal(f.tile.hidden,true,status);assert.deepEqual(f.updates,[]);assert.deepEqual(f.actions,[]);assert.equal(f.host.state.timer,timer);assert.equal(f.host.state.timer.deadline,622000);
 }
});

test('Back from an answer sends the same running timer to the actual overview bar renderer and retains music',()=>{
 const state=previewScene('conversation-followup',100000);state.devices=[];const timer=state.timer,music=state.music,f=fixture(state);f.host.renderRail();
 const returned=sceneTransition(state,{type:'back'});assert.equal(returned.focus,'now');assert.equal(returned.timer,timer);assert.equal(returned.music,music);
 const cards=[],finish={disabled:false},view={overviewList:{hidden:true},shortcut:{hidden:false},overview:{dataset:{}},nodes:new Map(),canCancel:true,card(current,container,key){cards.push({current,container,key});return {querySelector:()=>finish};}};
 TimerView.prototype.renderOverviewActivities.call(view,returned);
 assert.equal(view.overviewList.hidden,false);assert.equal(view.overview.dataset.activityKind,'timer');assert.equal(cards.length,1);assert.equal(cards[0].current,timer);assert.equal(cards[0].key,`overview:${timer.id}`);assert.equal(cards[0].current.status,'running');assert.equal(cards[0].current.deadline,622000);assert.equal(cards[0].current.remaining,522);
 // Ro keeps its established supporting rail; hiding a visual answer never cancels its timer.
 f.host.state={...returned,focus:'photo'};f.host.renderRail();assert.equal(f.rail.hidden,false);assert.equal(f.tile.hidden,false);assert.equal(f.updates[0].id,timer.id);assert.deepEqual(f.actions,[]);
});

test('Ro shows only running or finished timers and preserves paused timers outside its activity row',()=>{
 for(const status of ['running','done','paused']){
  const state=previewScene('conversation-followup',100000);state.focus='photo';state.devices=[];state.timer={...state.timer,status};const timer=state.timer,music=state.music,f=fixture(state);
  f.host.renderRail();assert.equal(f.rail.hidden,status==='paused',status);assert.equal(f.tile.hidden,status==='paused',status);assert.deepEqual(f.updates.map(row=>row.id),status==='paused'?[]:[timer.id]);assert.equal(f.host.state.timer,timer);assert.equal(f.host.state.music,music);assert.deepEqual(f.actions,[]);
 }
});

test('Ro robot activity leaves unknown and inactive states quiet and retains the same tile across pending and completion',()=>{
 const state=previewScene('conversation-followup',100000);state.focus='photo';state.timer={...state.timer,status:'cancelled'};state.devices=[{id:'robot',kind:'vacuum',status:'cleaning',timeline:[]}];const f=fixture(state),music=state.music;
 f.host.renderRail();const node=f.host.resourceButtons.get('robot');assert.ok(node);assert.equal(f.rail.hidden,false);
 for(const status of ['paused','docking','fault']){state.devices=[{...state.devices[0],status}];f.host.renderRail();assert.equal(f.rail.hidden,false,status);assert.equal(f.host.resourceButtons.get('robot'),node);}
 for(const status of ['docked','stopped','unknown','unavailable']){state.devices=[{...state.devices[0],status,pending:null}];f.host.renderRail();assert.equal(f.rail.hidden,true,status);assert.equal(node.hidden,true);}
 state.devices=[{...state.devices[0],status:'docked',pending:{operation:1}}];f.host.renderRail();assert.equal(f.rail.hidden,false);assert.equal(node.hidden,false);assert.equal(f.host.resourceButtons.get('robot'),node);f.host.renderRail();assert.equal(f.rail.children.filter(row=>row===node).length,1);assert.deepEqual(f.actions,[]);assert.equal(state.music,music);
});

test('unbound live and local lights never enter Ro through on-state, fault, pending or a matching room/speaker label',()=>{
 const state=previewScene('conversation-followup',100000);state.focus='photo';state.timer={...state.timer,status:'cancelled'};state.devices=[];const f=fixture(state),retained={hidden:false,dataset:{}};f.host.resourceButtons.set('lights',retained);
 for(const live of [false,true])for(const status of ['on','mixed','off','unknown','fault'])for(const pending of [null,{operation:1}]){
  const light={id:'lights',kind:'light',live,exampleOnly:!live,status,pending,scope:'home',name:'Køkkenet',roomId:'r0',roomName:'Køkkenet',lightSelectionId:'room:kitchen',lights:[{id:'kitchen-lamp',roomId:'kitchen',roomName:'Køkkenet',name:'Lampe',on:true}],observedLights:[{entityId:'light.kitchen_lamp',name:'Lampe',state:'on'}],timeline:[]};state.devices=[light];f.host.live=live;f.host.liveSnapshot={roomId:'r0',mediaRoomBindings:[{nativeRoomId:'r0',name:'Køkkenet'}]};f.host.renderRail();assert.equal(f.rail.hidden,true,`${live}/${status}/${!!pending}`);assert.equal(retained.hidden,true);assert.equal(state.devices[0],light);
 }
 assert.deepEqual(f.updates,[]);assert.deepEqual(f.actions,[]);
});

test('Ro includes fresh dock work under coarse docked status but keeps idle charging and stale work quiet',()=>{
 const now=Date.now()/1000,state=previewScene('conversation-followup',100000);state.focus='photo';state.timer={...state.timer,status:'cancelled'};state.devices=[];const f=fixture(state),row=(key,value,updatedAt=now)=>({key,value,updatedAt});
 for(const telemetry of [[row('mop_washing',true)],[row('dust_emptying',true)],[row('mop_drying',true)],[row('status','going_to_wash_the_mop')]]){state.devices=[{id:'robot',kind:'vacuum',status:'docked',timeline:[],telemetry:{status:'observed',items:telemetry}}];f.host.renderRail();assert.equal(f.rail.hidden,false);assert.equal(f.host.resourceButtons.get('robot').hidden,false);}
 for(const change of [{telemetry:{status:'observed',items:[row('battery_charging',true)]}},{telemetry:{status:'observed',items:[row('mop_washing',true,now-301)]}},{stale:true,telemetry:{status:'observed',items:[row('mop_washing',true)]}},{telemetry:{status:'observed',items:[row('mop_washing',true),row('dust_emptying',true)]}}]){state.devices=[{id:'robot',kind:'vacuum',status:'docked',timeline:[],...change}];f.host.renderRail();assert.equal(f.rail.hidden,true);assert.equal(f.host.resourceButtons.get('robot').hidden,true);}
 assert.deepEqual(f.actions,[]);
});
