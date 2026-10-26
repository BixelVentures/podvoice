import test from 'node:test';import assert from 'node:assert/strict';
import {robotObservation,robotFacts,robotValue,robotActivity,robotExperience} from '../../podvoice/gatekeeper/static/podview/robot-observation.js';
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

test('dock activity is shared, bounded and independent from control authority',()=>{
 const d={kind:'vacuum',status:'docked',telemetry:{status:'observed',items:[row('status','washing_the_mop')]}};
 assert.equal(robotActivity(d),'Vasker moppe');assert.equal(robotActivity(d,now()+301),null);
 assert.equal(robotActivity({...d,status:'unavailable'}),null);
 assert.equal(robotActivity({...d,telemetry:{status:'observed',items:[row('status','imaginary_activity')]}}),null);
 assert.equal(robotActivity({...d,telemetry:{status:'observed',items:[row('battery_charging',true,null,0,'binary_sensor')]}}),'Oplader');
 assert.equal(robotActivity({...d,status:'cleaning',telemetry:{status:'observed',items:[row('battery_charging',true,null,0,'binary_sensor')]}}),null);
});

test('recovery is specific to error namespace, preserves unknown values and carries no command authority',()=>{
 const d={status:'fault',telemetry:{status:'observed',items:[row('vacuum_error','5'),row('dock_error','water_empty')]}};
 const before=JSON.stringify(d),x=robotExperience(d);
 assert.equal(x.issues[0].title,'Hovedbørsten sidder fast');assert.match(x.issues[0].help,/Sluk robotten/);assert.equal(x.issues[0].raw,'5');
 assert.equal(x.issues[1].title,'Rent vand mangler');assert.equal(x.activity,null);assert.equal(x.actions,undefined);assert.equal(x.completed,undefined);assert.equal(JSON.stringify(d),before);
 for(const raw of ['water_empty','constructor','__proto__','toString','future_error']){
  const projected=robotExperience({status:'fault',telemetry:{status:'observed',items:[row('vacuum_error',raw)]}});
  assert.equal(projected.issues[0].title,'Robotten melder en fejl');assert.equal(projected.issues[0].raw,raw);
 }
});
test('stale, future and unavailable telemetry never create current errors, maintenance or activity',()=>{
 const items=[row('vacuum_error','charging_error'),row('status','washing_the_mop'),row('filter_time_left',-1,'h'),row('water_shortage',true,null,0,'binary_sensor')];
 for(const d of [{status:'docked',stale:true},{status:'unavailable'},{status:'unknown'}]){
  const result=robotExperience({...d,telemetry:{status:'observed',items}});assert.deepEqual(result.issues,[]);assert.deepEqual(result.maintenance,[]);assert.equal(result.activity,null);
 }
 const d={status:'docked',telemetry:{status:'observed',items}};assert.deepEqual(robotExperience(d,now()+301).issues,[]);assert.equal(robotActivity(d,now()+301),null);
 const future=structuredClone(d);future.telemetry.items.forEach(r=>r.updatedAt=now()+60);assert.deepEqual(robotExperience(future).issues,[]);assert.equal(robotActivity(future),null);
});
test('water and maintenance recovery remain separate and redundant known tank alerts are deduplicated',()=>{
 const items=[row('dock_error','water_empty'),row('clean_box_empty',true,null,0,'binary_sensor'),row('dirty_box_full',true,null,0,'binary_sensor'),row('filter_time_left',0,'h'),row('sensor_time_left',5,'h')];
 const x=robotExperience({status:'docked',telemetry:{status:'observed',items}});
 assert.deepEqual(x.issues.map(r=>r.title),['Rent vand mangler','Snavset vandbeholder er fuld']);assert.equal(x.maintenance.length,1);assert.equal(x.maintenance[0].severity,'reminder');assert.equal(x.maintenance[0].key,'filter_time_left');
});
test('charging retains explicitly reported unfinished job without promising automatic resume or result',()=>{
 const items=[row('battery_charging',true,null,0,'binary_sensor'),row('in_cleaning',true,null,0,'binary_sensor'),row('battery',18,'%'),row('dnd_switch',true,null,0,'switch'),row('dnd_start_time','22:00:00'),row('dnd_end_time','08:00:00')];
 const d={status:'docked',telemetry:{status:'observed',items}},x=robotExperience(d);
 assert.equal(x.activity,'Oplader · turen er ikke afsluttet');assert.equal(x.jobActive,true);assert.equal(x.battery,18);assert.equal(x.charging,true);assert.deepEqual(x.dnd,{enabled:true,start:'22:00:00',end:'08:00:00'});assert.equal(x.dnd.active,undefined);assert.equal(x.resumeAt,undefined);assert.equal(x.completed,undefined);
 items.find(r=>r.key==='in_cleaning').value=false;assert.equal(robotExperience(d).activity,'Oplader');
 assert.equal(robotExperience({...d,status:'cleaning'}).activity,null);
 items.push(row('status','imaginary_activity'));assert.equal(robotExperience({...d,status:'cleaning'}).activity,null);
});
test('fresh dock operation wins over charging context but is not an asserted cleaning result',()=>{
 const d={status:'docked',telemetry:{status:'observed',items:[row('status','washing_the_mop'),row('battery_charging',true,null,0,'binary_sensor'),row('in_cleaning',true,null,0,'binary_sensor')]}};
 assert.equal(robotExperience(d).activity,'Vasker moppe');assert.equal(robotExperience(d).jobActive,true);assert.equal(robotExperience(d).completed,undefined);
});
test('explicit charging aliases do not imply cleaning completion and contradicting fresh flags stay quiet',()=>{
 const d={status:'docked',telemetry:{status:'observed',items:[row('status','charging')]}};
 assert.equal(robotExperience(d).activity,'Oplader');
 d.telemetry.items.push(row('battery_charging',false,null,0,'binary_sensor'));assert.equal(robotExperience(d).activity,null);
 d.telemetry.items=[row('status','charging_complete')];const x=robotExperience(d);assert.equal(x.activity,'Opladet');assert.equal(x.completed,undefined);assert.equal(x.jobActive,null);
});
test('dock switch read keys require actual switch entities and project observations without authority',()=>{
 for(const [key,label] of [['mop_washing','Vasker moppe'],['dust_emptying','Tømmer støvbeholder'],['mop_drying','Tørrer moppe']]){
  const observed=robotObservation(telemetry([row(key,true,null,0,'switch')]),'vacuum.robot');assert.equal(observed.status,'observed');
  const d={status:'docked',telemetry:observed};assert.equal(robotExperience(d).activity,label);assert.equal(robotExperience(d).actions,undefined);
  assert.equal(robotExperience(d,now()+301).activity,null);
  assert.equal(robotObservation(telemetry([row(key,true,null,0,'binary_sensor')]),'vacuum.robot').status,'unavailable');
  assert.equal(robotFacts(d).details[0].group,'dock');
 }
});
test('contradictory dock switches stay unknown unless specific fresh status resolves the activity',()=>{
 const items=[row('mop_washing',true,null,0,'switch'),row('dust_emptying',true,null,0,'switch'),row('battery_charging',true,null,0,'binary_sensor')],d={status:'docked',telemetry:{status:'observed',items}};
 const conflict=robotExperience(d);assert.equal(conflict.activity,null);assert.equal(conflict.issues[0].key,'dock_activity_conflict');assert.match(conflict.issues[0].raw,/mop_washing/);
 items.push(row('status','washing_the_mop'));assert.equal(robotExperience(d).activity,'Vasker moppe');assert.deepEqual(robotExperience(d).issues,[]);
 items[items.length-1].stale=true;assert.equal(robotExperience(d).activity,null);
 assert.deepEqual(robotExperience({...d,stale:true}).issues,[]);
});
