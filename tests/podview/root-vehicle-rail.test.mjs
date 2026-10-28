import test from 'node:test';
import assert from 'node:assert/strict';
import {vehicleFixture,vehicleRailPresentation} from '../../podvoice/gatekeeper/static/podview/vehicle-model.js';
import {vehicleObservation} from '../../podvoice/gatekeeper/static/podview/ha-home-observation.js';

const context={live:true,connected:true,readGranted:true,scope:'boot/room',sourceScope:'boot/room'};
const sample=(charging='charging')=>vehicleObservation({status:'observed',source:'home_assistant_state',observedAt:100,entityIds:['sensor.car_charge'],data:{batteryPercent:72,charging:{status:charging,powerKw:11,endsAt:200},climate:{}}});

test('Ro charging projection navigates with known passive facts and no command authority',()=>{
 const input=sample(),before=structuredClone(input),rail=vehicleRailPresentation(input,context);
 assert.equal(rail.id,'vehicle');assert.equal(rail.target,'vehicle');assert.equal(rail.kind,'vehicle');assert.equal(rail.title,'Tesla');assert.equal(rail.detail,'Lader');assert.equal(rail.value,'72 %');assert.equal(rail.stale,false);assert.equal(rail.exampleOnly,false);assert.equal(rail.observedAt,100);assert.deepEqual(rail.actions,[]);assert.deepEqual(rail.facts.map(({id,label,value,stale})=>({id,label,value,stale})),[{id:'power',label:'Ladeeffekt',value:'11 kW',stale:false},{id:'ends',label:'Opladning færdig',value:new Date(200000).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}),stale:false}]);assert.deepEqual(structuredClone(input),before);
});

test('Ro preserves legitimately retained charging as last-known on stale or disconnected data',()=>{
 for(const [input,options]of [[{...sample(),stale:true},context],[sample(),{...context,connected:false}]]){
  const rail=vehicleRailPresentation(input,options);assert.equal(rail.detail,'Sidst kendt opladning');assert.equal(rail.stale,true);assert.equal(rail.status,'stale');assert.equal(rail.resourceStatus,'stale');assert.equal(rail.value,'72 %');assert.ok(rail.facts.every(fact=>fact.stale));assert.deepEqual(rail.actions,[]);
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
