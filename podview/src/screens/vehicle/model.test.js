// Bil's presentation model (model.ts) with the shell's home read (home-model.js) and the admitted observation
// (lib/api/vehicle.ts): the resource rail entry, stale and sleeping cars, the passive charge-cue fixture. Ported from
// the legacy node suites named below when the model moved to TypeScript; same scenarios and assertions.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {vehicleCueHome} from '../../../../scripts/live-fixture.mjs';
import {validateHome,applyHome} from '../../../home-model.js';
import {initialScene} from '../../../scene-model.js';
import {vehicleObservation} from '../../lib/api/vehicle';
import {vehicleChargeUpdate,vehicleFixture,vehicleModel,vehicleRailPresentation,vehicleStatus,vehicleUpdatedLabel} from './model';

// From tests/podview/root-vehicle-rail.test.mjs.
const context={live:true,connected:true,readGranted:true,scope:'boot/room',sourceScope:'boot/room'};
const sample=(charging='charging')=>vehicleObservation({status:'observed',source:'home_assistant_state',observedAt:100,entityIds:['sensor.car_charge'],data:{batteryPercent:72,charging:{status:charging,powerKw:11,endsAt:200},climate:{}}});

test('Ro charging projection navigates with known passive facts and no command authority',()=>{
 const input=sample(),before=structuredClone(input),rail=vehicleRailPresentation(input,context);
 assert.equal(rail.id,'vehicle');assert.equal(rail.target,'vehicle');assert.equal(rail.kind,'vehicle');assert.equal(rail.title,'Tesla');assert.equal(rail.detail,'Lader');assert.equal(rail.value,'72 %');assert.equal(rail.stale,false);assert.equal(rail.exampleOnly,false);assert.equal(rail.observedAt,100);assert.deepEqual(rail.actions,[]);assert.deepEqual(rail.facts.map(({id,label,value,stale})=>({id,label,value,stale})),[{id:'power',label:'Ladeeffekt',value:'11 kW',stale:false},{id:'ends',label:'Opladning færdig',value:new Date(200000).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}),stale:false}]);assert.deepEqual(structuredClone(input),before);
});

test('Ro preserves legitimately retained charging as last-known on stale or disconnected data',()=>{
 for(const [input,options]of [[{...sample(),stale:true},context],[sample(),{...context,connected:false}]]){
  const rail=vehicleRailPresentation(input,options);assert.equal(rail.detail,'Lader');assert.equal(rail.stale,true);assert.equal(rail.status,'stale');assert.equal(rail.resourceStatus,'stale');assert.equal(rail.value,'72 %');assert.ok(rail.facts.every(fact=>fact.stale));assert.deepEqual(rail.actions,[]);
 }
});

test('Ro fails closed for counterfeit observations, lost access, foreign scope and noncharging states',()=>{
 for(const input of [null,{},structuredClone(sample()),{kind:'vehicle',mode:'observed',charging:{status:'charging'}},vehicleFixture({charging:true}),...['complete','stopped','disconnected','starting',null].map(sample)])assert.equal(vehicleRailPresentation(input,context),null);
 for(const patch of [{readGranted:false},{scope:''},{scope:'other'},{sourceScope:'other'}])assert.equal(vehicleRailPresentation(sample(),{...context,...patch}),null);
 assert.equal(vehicleRailPresentation(sample()),null);
});

test('explicit local charging fixture stays local and does not imply live authority',()=>{
 const fixture=vehicleFixture({charging:true}),local={...context,live:false,scope:'local',sourceScope:'local'},rail=vehicleRailPresentation(fixture,local);
 assert.equal(rail.detail,'Lader');assert.equal(rail.exampleOnly,true);assert.equal(rail.observedAt,null);assert.deepEqual(rail.actions,[]);
 for(const patch of [{live:true},{connected:false},{readGranted:false},{scope:'foreign',sourceScope:'foreign'}])assert.equal(vehicleRailPresentation(fixture,{...local,...patch}),null);
 for(const input of [vehicleFixture(),{...fixture,exampleOnly:false},{...fixture,fixtureCase:'parked'}])assert.equal(vehicleRailPresentation(input,local),null);
});

test('Ro does not invent battery, charging power or completion time when source omits them',()=>{
 const input=vehicleObservation({status:'observed',source:'home_assistant_state',observedAt:100,entityIds:['sensor.car_charge'],data:{charging:{status:'charging'},climate:{}}}),rail=vehicleRailPresentation(input,context);
 assert.equal(rail.value,'');assert.deepEqual(rail.facts,[]);assert.equal(rail.detail,'Lader');
});

// From tests/podview/root-vehicle-stale.test.mjs.
test('a fresh page displays an explicitly stale vehicle as last known, without commands or a charging cue',()=>{
 const stamp=1700000000,vehicle={status:'stale',source:'home_assistant_state',observedAt:stamp,entityIds:['sensor.car_battery','sensor.car_charging'],data:{batteryPercent:27,charging:{status:'charging',powerKw:3,endsAt:1700007200}}};
 const input={schema:'podview.home.v1',bootId:'boot',roomId:'room',revision:1,observedAt:stamp+3600,vacuum:{status:'unavailable',items:[]},vehicle};
 const home=validateHome(input,'room','boot');
 const scene=applyHome({devices:[],focus:'vehicle',homeScope:null},home,['vehicle']);
 const model=vehicleModel(scene.vehicle);
 assert.equal(model.mode,'observed');assert.equal(model.stale,true);assert.equal(model.observedAt,stamp);
 assert.equal(model.charging.endsAt,null);const rail=vehicleRailPresentation(scene.vehicle,{live:true,connected:true,readGranted:true,scope:'s',sourceScope:'s'});assert.equal(rail.detail,'Lader');assert.equal(rail.facts.some(f=>f.id==='ends'),false);assert.equal(model.status,'Lader');assert.deepEqual(model.actions,[]);
 assert.equal(vehicleChargeUpdate(null,model,{connected:true,scope:'s',sourceScope:'s',readGranted:true}).eligible,false);
 assert.equal(applyHome(scene,home,[]).vehicle,null);
 assert.equal(applyHome(scene,{...home,bootId:'other',vehicle:null},['vehicle']).vehicle,null);
});

// From tests/podview/root-vehicle-sleep.test.mjs.
// B3: Tesla's own state beside the lock, like the Tesla app ("Låst · I dvale siden 17.40").
const now=new Date(2026,10,11,21,40),at=(h,m,dayOffset=0)=>new Date(2026,10,11+dayOffset,h,m).getTime()/1000;
const car=(connection,extra={})=>vehicleObservation({status:'stale',source:'tesla_fleet_snapshot',observedAt:at(17,30),entityIds:['sensor.car_battery','binary_sensor.car_status','lock.car'],data:{batteryPercent:62,locked:true},fieldObservedAt:{batteryPercent:at(17,40),locked:at(17,30)},historicalFields:[],...(connection?{connection}:{}),...extra});

test('sleep is a state with its duration; offline is never called sleep',()=>{
 const asleep=car({state:'asleep',since:at(17,40)});
 // Header: lock state with sleep and its start; overview: short form.
 assert.equal(vehicleStatus(asleep,now.getTime()),'Låst · I dvale siden 17.40');
 assert.equal(vehicleStatus(asleep,now.getTime(),{short:true}),'Låst · I dvale');
 assert.equal(vehicleStatus({...asleep,connectionSince:at(9,44,-1)},now.getTime()),'Låst · I dvale siden i går 09.44');
 assert.equal(vehicleStatus({...asleep,connectionSince:at(17,40,-3)},now.getTime()),'Låst · I dvale siden 8. nov. 17.40');
 assert.equal(vehicleStatus({...asleep,connectionSince:null},now.getTime()),'Låst · I dvale');
 assert.equal(vehicleModel(asleep).shortStatus,'Låst · I dvale');
 // Awake: sleep disappears and only the lock state remains.
 assert.equal(vehicleModel(car({state:'online',since:at(21,0)})).shortStatus,'Låst');
 assert.equal(vehicleStatus(car({state:'offline',since:at(17,40)}),now.getTime()),'Ikke forbundet');
 assert.equal(vehicleStatus(car({state:'online',since:at(17,40)}),now.getTime()),'Låst');
 assert.equal(vehicleStatus(car(null),now.getTime()),'Låst');
 assert.equal(vehicleModel(asleep).batteryPercent,62);
 assert.equal(car({state:'dozing',since:1}).connectionState,null);
});

test('the time shown is when the car last reported the shown values, in plain Danish',()=>{
 const asleep=car({state:'asleep',since:at(17,40)});
 assert.equal(vehicleUpdatedLabel(asleep,now),'Opdateret: 17.40');
 const yesterday=car(null,{fieldObservedAt:{batteryPercent:at(17,40,-1)},observedAt:at(17,40,-1)});
 assert.equal(vehicleUpdatedLabel(yesterday,now),'Opdateret: i går 17.40');
 const older=car(null,{fieldObservedAt:{batteryPercent:at(17,40,-2)},observedAt:at(17,40,-2)});
 assert.equal(vehicleUpdatedLabel(older,now),'Opdateret: 9. nov. 17.40');
 assert.doesNotMatch(vehicleModel(asleep).status,/Sidst kendt|observation/);
 const haOnly=vehicleObservation({status:'observed',source:'home_assistant_state',observedAt:at(17,40),entityIds:['sensor.car_battery'],data:{batteryPercent:62}});
 assert.equal(vehicleUpdatedLabel(haOnly,now),'','HA re-report time is not the car\'s own update time');
});

// From tests/podview/root-live-vehicle-cue-fixture.test.mjs.
test('passive vehicle fixture uses actual admitted observations, newer change, identical value and stale retention',()=>{
 let state=initialScene();const observed=[];
 for(let step=0;step<4;step++){
  const dto=vehicleCueHome(step,'vehicle-charge-cue',1000);dto.vehicle.bindingId='a'.repeat(64);const home=validateHome(dto,'vehicle-charge-cue','test-only');
  state=applyHome(state,home,['vehicle']);observed.push(vehicleModel(state.vehicle));
  assert.equal(dto.bootId,'test-only');assert.equal(dto.roomId,'vehicle-charge-cue');
 }
 assert.deepEqual(observed.map(v=>v.batteryPercent),[71,72,72,72]);
 assert.deepEqual(observed.map(v=>v.stale===true),[false,false,false,true]);
 assert.equal(observed[1].charging.status,'charging');
 assert.equal(observed[2].observedAt>observed[1].observedAt,true,'unchanged percentage still has newer observation');
 assert.deepEqual(observed[0].actions,[],'observation does not grant commands');
});
