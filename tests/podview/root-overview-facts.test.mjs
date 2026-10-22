import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deviceOverviewFacts,devicePresentation,initialScene} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {previewScene} from '../../podvoice/gatekeeper/static/podview/preview-scenes.js';
import {vehicleFixture,vehicleModel} from '../../podvoice/gatekeeper/static/podview/vehicle-model.js';
import {localPlayerModel} from '../../podvoice/gatekeeper/static/podview/player-view.js';
import {timerTime,timerStateLabel} from '../../podvoice/gatekeeper/static/podview/timer-model.js';
import {liveWeatherModel,localWeatherModel,WEATHER_CHANGE_EXAMPLE} from '../../podvoice/gatekeeper/static/podview/weather-view.js';

// Actual host projection with an inert port at the canonical retained renderer.
// This proves data survives the adapter; browser evidence owns density/layout.
const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
const method=source.slice(source.indexOf(' renderOverviewFacts('),source.indexOf(' renderResourceRail(){')).trim();
function projection({live=false,vm=localPlayerModel(initialScene()),vehicle=vehicleFixture({charging:true}),timer=null,state=initialScene()}={}){
 const calls=new Map(),nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{id});return nodes.get(id);};
 const render=new Function('$','updateResourceFacts','projectVehicle','timerTime','timerStateLabel','liveWeatherModel','localWeatherModel','WEATHER_CHANGE_EXAMPLE',`return function ${method}`)(node,(target,value)=>calls.set(target.id,value),vehicleModel,timerTime,timerStateLabel,liveWeatherModel,localWeatherModel,WEATHER_CHANGE_EXAMPLE);
 const host={live,state,playerView:{progressVM:vm,rows:new Map(),queue:{dataset:{status:'ready'}}},timerView:{currentTimer:timer,nodes:new Map(timer?[[`overview:${timer.id}`,{querySelector:()=>node('active-timer')}]]:[])}};
 render.call(host,vehicle);return {calls,host,render};
}
test('robot sized cards receive admitted area/time/room/battery/history and never derive an ETA',()=>{
 const now=Date.now(),scene=previewScene('robot-overview-cleaning',now),robot=scene.devices.find(row=>row.kind==='vacuum'),shown=devicePresentation(robot);
 assert.equal(robot.exampleOnly,true);assert.equal(robot.telemetry.source,'local_preview');assert.deepEqual(shown.facts.slice(0,3).map(row=>row.id),['room','cleaning_area','cleaning_time']);assert.equal(shown.facts.find(row=>row.id==='battery').value,'76 %');assert.match(shown.context,/Senest afsluttet/);assert.equal(shown.facts.some(row=>/ETA|Slutter/.test(row.label)),false);
 const stale=deviceOverviewFacts({...robot,stale:true},now/1000);assert.equal(stale.facts.some(row=>row.id==='room'||row.id==='progress'),false);assert(stale.facts.every(row=>row.stale));
 const missing=deviceOverviewFacts({kind:'vacuum',status:'docked',battery:0});assert.deepEqual(missing.facts,[{id:'battery',label:'Batteri',value:'0 %',stale:false}]);assert.equal(missing.context,'');assert.deepEqual(deviceOverviewFacts({...robot,presentationOnly:true}),{facts:[],context:''});
});
test('light facts keep observed lamp counts/brightness and never invent room names for HA rows',()=>{
 const live={kind:'light',live:true,source:'home_assistant_state',status:'mixed',observedLights:[{entityId:'light.one',name:'Loftlys',state:'on',brightness:128},{entityId:'light.two',name:'Bordlys',state:'off',brightness:0}]},shown=deviceOverviewFacts(live);
 assert.equal(shown.facts[0].value,'1 af 2');assert.equal(shown.facts.find(row=>row.id==='brightness:light.one').value,'50 %');assert.equal(shown.facts.some(row=>row.id==='rooms'),false);
 assert.deepEqual(deviceOverviewFacts({...live,source:'unknown',observedLights:undefined}),{facts:[],context:''});assert(deviceOverviewFacts({...live,stale:true}).facts.every(row=>row.stale));
});
test('music/vehicle/weather/timer adapters preserve real known metadata through the shared fact port',()=>{
 const timer={id:'timer-one',status:'running',remaining:160,duration:300,deadline:Date.now()+160000},f=projection({timer}),music=f.calls.get('home-music').facts,car=f.calls.get('home-vehicle').facts;
 assert.deepEqual(music.slice(0,3).map(row=>row.id),['artist','remaining','room']);assert.equal(music.find(row=>row.id==='duration').value,'3:00');assert.equal(car.find(row=>row.id==='battery').value,'72 %');assert.equal(car.find(row=>row.id==='power').value,'11 kW');assert(car.some(row=>row.id==='ends'));assert.equal(f.calls.has('active-timer'),false,'active dial/deadline keep their existing owner');assert.equal(f.calls.has('home-weather'),false,'hour forecast keeps its existing owner');assert.deepEqual(f.calls.get('open-timers').facts,[]);
});
test('radio and empty/stale variants omit unsupported program/album/future-time fields',()=>{
 const f=projection({vm:{active:true,sourceKind:'radio',title:'P3',target:'Stuen',exampleOnly:true,previewLabel:'Radio · ingen lyd',playing:true}});assert.deepEqual(f.calls.get('home-radio').facts.map(row=>row.id),['station','radio-room']);assert.deepEqual(f.calls.get('home-music').facts,[]);
 const empty=projection({live:true,vm:{active:false},vehicle:vehicleModel(null)});for(const id of ['home-music','home-radio','home-vehicle','open-timers'])assert.deepEqual(empty.calls.get(id).facts,[],id);
 const paused=projection({vm:{active:true,title:'Observed song',artist:'Observed artist',target:'Observed room',playing:false,fresh:false,positionFresh:false,progressMs:20000,durationMs:60000}});assert(paused.calls.get('home-music').facts.every(row=>row.stale));assert.equal(paused.calls.get('home-music').facts.some(row=>row.id==='album'),false);
});


test('Robot Hero metadata puts actual battery first and qualifies inactive cleaning measurements',async()=>{
 const {robotDetailMetadata}=await import('../../podvoice/gatekeeper/static/podview/scene-model.js'),at=Date.now()/1000,telemetry={status:'observed',items:[{key:'cleaning_area',value:12.5,unit:'m²',updatedAt:at,stale:false},{key:'cleaning_time',value:600,unit:'s',updatedAt:at,stale:false}]};
 assert.equal(robotDetailMetadata({kind:'vacuum',status:'docked',battery:76,telemetry},at),'Batteri 76 % · Senest: 12,5 m² · 10 min');
 assert.equal(robotDetailMetadata({kind:'vacuum',status:'cleaning',battery:76,telemetry},at),'Batteri 76 % · 12,5 m² · 10 min');
 assert.equal(robotDetailMetadata({kind:'vacuum',status:'paused',battery:0,telemetry},at),'Batteri 0 % · 12,5 m² · 10 min');
 assert.equal(robotDetailMetadata({kind:'vacuum',status:'docked',battery:null}), '');
 assert.match(robotDetailMetadata({kind:'vacuum',status:'docked',battery:76,stale:true,telemetry},at),/sidst kendt/);
});
