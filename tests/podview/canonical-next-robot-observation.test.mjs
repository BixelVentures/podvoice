import test from 'node:test';import assert from 'node:assert/strict';
import {robotObservation,robotFacts,robotValue} from '../../podvoice/gatekeeper/static/podview/robot-observation.js';
import {validateHome,applyHome} from '../../podvoice/gatekeeper/static/podview/home-model.js';
const now=()=>Date.now()/1000;
const row=(key,value,unit=null,age=0,domain='sensor')=>({key,entityId:`${domain}.${key}`,value,unit,updatedAt:now()-age,retrievedAt:now(),stale:age>300});
const telemetry=items=>({schema:'podview.robot.v1',status:'observed',source:'home_assistant_roborock',vacuumEntityId:'vacuum.robot',items});
test('closed robot telemetry rejects owner/source/unit/type/domain confusion',()=>{
 for(const mutate of [v=>v.vacuumEntityId='vacuum.other',v=>v.source='model',v=>v.items[0].unit='ft²',v=>v.items[0].value=true,v=>v.items[0].key='camera',v=>v.items[0].entityId='select.cleaning_area',v=>v.items.push({...v.items[0]}),v=>v.items[0].updatedAt=now()+30]){const v=telemetry([row('cleaning_area',23,'m²')]);mutate(v);assert.equal(robotObservation(v,'vacuum.robot').status,'unavailable');}
});
test('active status uses actual progress/room/area/time only when cleaning and fresh',()=>{
 const observation=robotObservation(telemetry([row('current_room','Køkken'),row('clean_percent',0,'%'),row('cleaning_area',12.5,'m²'),row('cleaning_time',600,'s')]),'vacuum.robot');
 const d={status:'cleaning',telemetry:observation};assert.deepEqual(robotFacts(d).summary,['Køkken','0 %','12,5 m²','10 min']);
 assert.deepEqual(robotFacts({...d,status:'docked'}).summary,[]);assert.deepEqual(robotFacts({...d,stale:true}).summary,[]);assert.deepEqual(robotFacts(d,now()+600).summary,[]);
});
test('native history stays distinct from command acceptance; no duration or completion inferred',()=>{
 const observed=robotObservation(telemetry([row('last_clean_start',now()-1000),row('last_clean_end',now()-500)]),'vacuum.robot');const facts=robotFacts({status:'docked',telemetry:observed,history:{items:[{outcome:'accepted_by_ha'}]}});
 assert.equal(facts.history.length,2);assert.equal(facts.history[1].label,'Senest afsluttet');assert.deepEqual(facts.summary,[]);assert.equal(facts.duration,undefined);assert.equal(facts.physicalResultVerified,undefined);
});
test('negative maintenance retains signed source but displays interval meaning and stale dock warning is quiet',()=>{
 const observed=robotObservation(telemetry([row('filter_time_left',-12,'h'),row('clean_box_empty',true,null,0,'binary_sensor'),row('dirty_box_full',true,null,600,'binary_sensor')]),'vacuum.robot');
 const facts=robotFacts({status:'docked',telemetry:observed});assert.deepEqual(facts.attention,['Rent vand mangler']);assert.equal(facts.details.find(x=>x.label==='Filter').value,'12 timer over interval');assert.equal(facts.details.find(x=>x.label==='Snavset vandbeholder fuld').stale,true);
});
test('freshness is recomputed; projections discard capabilities and commands',()=>{
 const source=row('cleaning_area',23,'m²',600);source.stale=false;source.commands=['start'];const observed=robotObservation(telemetry([source]),'vacuum.robot');assert.equal(observed.items[0].stale,true);assert.equal(observed.items[0].commands,undefined);
 const home=validateHome({schema:'podview.home.v1',roomId:'r',revision:1,observedAt:now(),vacuum:{status:'observed',items:[{entityId:'vacuum.robot',name:'Robot',state:'cleaning',source:'home_assistant_state',observedAt:now(),telemetry:telemetry([row('clean_percent',38,'%')]),actions:['start']}]}},'r');const scene=applyHome({devices:[]},home);assert.equal(scene.devices[0].telemetry.items[0].value,38);assert.equal(scene.devices[0].actions,undefined);
 const offline=applyHome(scene,{revision:2,vacuum:{status:'unavailable',items:[]}});assert.deepEqual(robotFacts(offline.devices[0]).summary,[]);
});
test('numeric source duration is converted only using admitted units',()=>{assert.equal(robotValue(row('cleaning_time',120,'s')),'2 min');assert.equal(robotValue(row('cleaning_time',2,'min')),'2 min');});

import {robotRoom} from '../../podvoice/gatekeeper/static/podview/robot-observation.js';
test('cleaning room label is hidden at dock, after expiry and when room is not supplied',()=>{const device={status:'cleaning',telemetry:robotObservation(telemetry([row('current_room','Køkken')]),'vacuum.robot')};assert.equal(robotRoom(device),'Køkken');assert.equal(robotRoom({...device,status:'docked'}),null);assert.equal(robotRoom(device,now()+600),null);assert.equal(robotRoom({status:'cleaning',telemetry:{status:'observed',items:[]}}),null);});
