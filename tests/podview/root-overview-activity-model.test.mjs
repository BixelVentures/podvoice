import test from 'node:test';
import assert from 'node:assert/strict';
import {overviewActivities,selectOverviewActivity} from '../../podvoice/gatekeeper/static/podview/overview-activity-model.js';
test('activity slot includes real active timers and robot tasks, never idle or unavailable devices',()=>{
 const timer={id:'t',status:'running'},robot={id:'r',kind:'vacuum',status:'cleaning'};
 const rows=overviewActivities([timer,{id:'cancelled',status:'cancelled'}],[robot,{id:'idle',kind:'vacuum',status:'docked'},{id:'fake',kind:'vacuum',status:'cleaning',presentationOnly:true},{id:'light',kind:'light',status:'on'}]);
 assert.deepEqual(rows.map(x=>x.id),['timer:t','device:r']);assert.equal(rows[0].resource,timer);assert.equal(rows[1].resource,robot);
});
test('manual selection survives updates; disappeared selection falls back to timer; empty stays neutral',()=>{
 const rows=overviewActivities([{id:'t',status:'paused'}],[{id:'r',kind:'vacuum',status:'fault'}]);
 assert.equal(selectOverviewActivity(rows,null).id,'timer:t');assert.equal(selectOverviewActivity(rows,'device:r').id,'device:r');assert.equal(selectOverviewActivity(rows.slice(0,1),'device:r').id,'timer:t');assert.equal(selectOverviewActivity([],null),null);
});
test('resource namespaces prevent timer/device ID collisions and preserve input order',()=>{
 const rows=overviewActivities([{id:'same',status:'done'},{id:'second',status:'running'}],[{id:'same',kind:'vacuum',status:'docking'}]);
 assert.deepEqual(rows.map(x=>x.id),['timer:same','timer:second','device:same']);
});
test('charging requires admitted current vehicle observation; unavailable or stale never invents activity',()=>{
 const vehicle={mode:'observed',source:'home_assistant_state',stale:false,charging:{status:'charging'}};
 assert.equal(overviewActivities([],[],vehicle)[0].id,'vehicle:charging');
 for(const invalid of [{...vehicle,stale:true},{...vehicle,mode:'unavailable'},{...vehicle,source:'unknown'},{...vehicle,charging:{status:'idle'}},null])assert.deepEqual(overviewActivities([],[],invalid),[]);
});
