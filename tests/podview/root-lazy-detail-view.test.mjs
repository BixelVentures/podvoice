import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
import {homeConnectionPresentation} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
import {vehicleChargeUpdate} from '../../podvoice/gatekeeper/static/podview/vehicle-model.js';
import {vehicleObservation} from '../../podvoice/gatekeeper/static/podview/ha-home-observation.js';
const begin=source.indexOf('const homeConnection='),end=source.indexOf("if($('home-vehicle-status')",begin);
const counts={radio:0,vehicle:0};
class Radio{constructor(){counts.radio++;this.inputs=[];}render(value){this.inputs.push(value);}}
class Vehicle{constructor(){counts.vehicle++;this.inputs=[];this.options=[];}render(value,options){this.inputs.push(value);this.options.push(options);}}
const render=new Function('RadioView','VehicleView','projectVehicle','$','localRadioTransition','homeConnectionPresentation',`return function(s){const viewChanged=this.lastRenderedFocus!==s.focus;this.lastRenderedFocus=s.focus;${source.slice(begin,end)}}`)(Radio,Vehicle,value=>value||{mode:'unconnected'},()=>({}),s=>s,homeConnectionPresentation);
test('hidden detail owners are deferred, retained and refreshed only on opening',()=>{
 const host={live:false},s={focus:'now',connected:true,radioStationId:'p3',radioPlaying:true};render.call(host,s);assert.deepEqual(counts,{radio:0,vehicle:0});
 s.focus='radio';render.call(host,s);const radio=host.radioView;assert.equal(radio.inputs.length,1);render.call(host,s);assert.equal(radio.inputs.length,1);
 s.focus='now';s.radioStationId='p1';render.call(host,s);assert.equal(radio.inputs.length,1);s.focus='radio';render.call(host,s);assert.equal(host.radioView,radio);assert.equal(radio.inputs.at(-1).stationId,'p1');
 s.focus='vehicle';render.call(host,s);const vehicle=host.vehicleView;assert.equal(vehicle.options.at(-1).chargeContext.suppress,true);assert.equal(vehicle.options.at(-1).connected,true);s.focus='now';s.vehicle={mode:'observed',batteryPercent:66};render.call(host,s);assert.equal(vehicle.inputs.length,1);s.focus='vehicle';render.call(host,s);assert.equal(vehicle.inputs.at(-1).batteryPercent,66);assert.equal(vehicle.options.at(-1).chargeContext.suppress,true,'opening seeds the current observation without replay');render.call(host,s);assert.equal(vehicle.options.at(-1).chargeContext.suppress,false);const renders=vehicle.inputs.length;render.call(host,s);assert.equal(vehicle.inputs.length,renders,'settled unchanged observation still performs no detail render');assert.deepEqual(counts,{radio:1,vehicle:1});
});

test('Tesla overview destination goes directly to its detail independently of the activity selector',()=>{const binding=source.split('\n').find(line=>line.includes("for(const [id,focus]of [['home-radio','radio'],['home-vehicle','vehicle']]"));const handlers=new Map(),events=[],host={dispatch:event=>events.push(event),focusHeading(){}};new Function('$',binding).call(host,id=>({addEventListener:(_,fn)=>handlers.set(id,fn)}));handlers.get('home-vehicle')();assert.deepEqual(events,[{type:'show',id:'vehicle'}]);});

test('actual vehicle caller binds charge feedback to admitted state homeScope, never an absent host field',()=>{
 const scope=JSON.stringify(['boot','room']),s={focus:'vehicle',connected:false,homeScope:scope},host={live:true,liveTransport:{connected:true},liveSnapshot:{bootId:'boot',roomId:'room',capabilities:{homeRead:['vehicle']}},homeScope:'must-not-be-used'},sample=at=>vehicleObservation({status:'observed',source:'home_assistant_state',observedAt:at,entityIds:['sensor.car_charge'],data:{batteryPercent:at===100?71:72,charging:{status:'charging'},climate:{}}});
 let previous;const observe=(at,sourceScope)=>{s.homeScope=sourceScope;s.vehicle=sample(at);render.call(host,s);const context=host.vehicleView.options.at(-1).chargeContext;assert.equal(context.connected,true);assert.equal(context.scope,scope);assert.equal(context.sourceScope,sourceScope);previous=vehicleChargeUpdate(previous,s.vehicle,context);return previous.cue;};
 assert.equal(observe(100,scope),false);assert.equal(observe(101,undefined),false);assert.equal(previous.eligible,false,'missing admitted scope cannot borrow the current owner scope');assert.equal(observe(102,'foreign'),false);assert.equal(previous.eligible,false);assert.equal(observe(103,scope),false,'first matched recovery only seeds source data');s.vehicle={...sample(104),batteryPercent:73};render.call(host,s);previous=vehicleChargeUpdate(previous,s.vehicle,host.vehicleView.options.at(-1).chargeContext);assert.equal(previous.cue,true,'a matching new actual reading can cue despite scene.connected remaining false');assert.equal(host.vehicleView.options.at(-1).connected,false,'presentation context never grants fixture command authority');
});
