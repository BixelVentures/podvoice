import test from 'node:test';
import assert from 'node:assert/strict';
import {vehicleObservation} from '../../podvoice/gatekeeper/static/podview/ha-home-observation.js';
import {vehicleModel,vehicleStatus,vehicleUpdatedLabel} from '../../podvoice/gatekeeper/static/podview/vehicle-model.js';

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
