import test from 'node:test';
import assert from 'node:assert/strict';
import {robotDetailMetadata} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
test('ongoing wash at a coarse docked state does not turn current measurements into a previous-cycle result',()=>{
 const at=Date.now()/1000,telemetry={status:'observed',items:[{key:'cleaning_area',value:12.5,unit:'m²',updatedAt:at,stale:false},{key:'cleaning_time',value:600,unit:'s',updatedAt:at,stale:false},{key:'in_cleaning',value:true,updatedAt:at,stale:false}]};
 assert.equal(robotDetailMetadata({kind:'vacuum',status:'docked',battery:76,telemetry},at),'Batteri 76 %');
 assert.equal(robotDetailMetadata({kind:'vacuum',status:'docked',battery:76,localJob:{active:true},telemetry:{...telemetry,items:telemetry.items.filter(row=>row.key!=='in_cleaning')}},at),'Batteri 76 %');
 assert.equal(robotDetailMetadata({kind:'vacuum',status:'cleaning',battery:76,telemetry},at),'Batteri 76 % · 12,5 m² · 10 min');
});
