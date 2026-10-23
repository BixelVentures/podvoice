import test from 'node:test';
import assert from 'node:assert/strict';
import {vehicleCueHome} from '../../scripts/live-fixture.mjs';
import {validateHome,applyHome} from '../../podvoice/gatekeeper/static/podview/home-model.js';
import {initialScene} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {vehicleModel} from '../../podvoice/gatekeeper/static/podview/vehicle-model.js';
test('passive vehicle fixture uses actual admitted observations, newer change, identical value and stale retention',()=>{
 let state=initialScene();const observed=[];
 for(let step=0;step<4;step++){
  const dto=vehicleCueHome(step,'vehicle-charge-cue',1000),home=validateHome(dto,'vehicle-charge-cue','test-only');
  state=applyHome(state,home,['vehicle']);observed.push(vehicleModel(state.vehicle));
  assert.equal(dto.bootId,'test-only');assert.equal(dto.roomId,'vehicle-charge-cue');
 }
 assert.deepEqual(observed.map(v=>v.batteryPercent),[71,72,72,72]);
 assert.deepEqual(observed.map(v=>v.stale===true),[false,false,false,true]);
 assert.equal(observed[1].charging.status,'charging');
 assert.equal(observed[2].observedAt>observed[1].observedAt,true,'unchanged percentage still has newer observation');
 assert.deepEqual(observed[0].actions,[],'observation does not grant commands');
});
