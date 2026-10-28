import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateHome,applyHome} from '../../podvoice/gatekeeper/static/podview/home-model.js';
import {vehicleModel,vehicleChargeUpdate,vehicleRailPresentation} from '../../podvoice/gatekeeper/static/podview/vehicle-model.js';

test('a fresh page displays an explicitly stale vehicle as last known, without commands or a charging cue',()=>{
 const stamp=1700000000,vehicle={status:'stale',source:'home_assistant_state',observedAt:stamp,entityIds:['sensor.car_battery','sensor.car_charging'],data:{batteryPercent:27,charging:{status:'charging',powerKw:3,endsAt:1700007200}}};
 const input={schema:'podview.home.v1',bootId:'boot',roomId:'room',revision:1,observedAt:stamp+3600,vacuum:{status:'unavailable',items:[]},vehicle};
 const home=validateHome(input,'room','boot');
 const scene=applyHome({devices:[],focus:'vehicle',homeScope:null},home,['vehicle']);
 const model=vehicleModel(scene.vehicle);
 assert.equal(model.mode,'observed');assert.equal(model.stale,true);assert.equal(model.observedAt,stamp);
 assert.equal(model.charging.endsAt,null);const rail=vehicleRailPresentation(scene.vehicle,{live:true,connected:true,readGranted:true,scope:'s',sourceScope:'s'});assert.equal(rail.detail,'Sidst kendt opladning');assert.equal(rail.facts.some(f=>f.id==='ends'),false);assert.equal(model.status,'Sidst kendt: Lader');assert.deepEqual(model.actions,[]);
 assert.equal(vehicleChargeUpdate(null,model,{connected:true,scope:'s',sourceScope:'s',readGranted:true}).eligible,false);
 assert.equal(applyHome(scene,home,[]).vehicle,null);
 assert.equal(applyHome(scene,{...home,bootId:'other',vehicle:null},['vehicle']).vehicle,null);
});
