import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
const begin=source.indexOf('const radioModel={'),end=source.indexOf("if($('home-vehicle-status')",begin);
const counts={radio:0,vehicle:0};
class Radio{constructor(){counts.radio++;this.inputs=[];}render(value){this.inputs.push(value);}}
class Vehicle{constructor(){counts.vehicle++;this.inputs=[];}render(value){this.inputs.push(value);}}
const render=new Function('RadioView','VehicleView','projectVehicle','$','localRadioTransition',`return function(s){${source.slice(begin,end)}}`)(Radio,Vehicle,value=>value||{mode:'unconnected'},()=>({}),s=>s);
test('hidden detail owners are deferred, retained and refreshed only on opening',()=>{
 const host={live:false},s={focus:'now',connected:true,radioStationId:'p3',radioPlaying:true};render.call(host,s);assert.deepEqual(counts,{radio:0,vehicle:0});
 s.focus='radio';render.call(host,s);const radio=host.radioView;assert.equal(radio.inputs.length,1);render.call(host,s);assert.equal(radio.inputs.length,1);
 s.focus='now';s.radioStationId='p1';render.call(host,s);assert.equal(radio.inputs.length,1);s.focus='radio';render.call(host,s);assert.equal(host.radioView,radio);assert.equal(radio.inputs.at(-1).stationId,'p1');
 s.focus='vehicle';render.call(host,s);const vehicle=host.vehicleView;s.focus='now';s.vehicle={mode:'observed',batteryPercent:66};render.call(host,s);assert.equal(vehicle.inputs.length,1);s.focus='vehicle';render.call(host,s);assert.equal(vehicle.inputs.at(-1).batteryPercent,66);assert.deepEqual(counts,{radio:1,vehicle:1});
});

test('Tesla overview destination goes directly to its detail independently of the activity selector',()=>{const binding=source.split('\n').find(line=>line.includes("for(const [id,focus]of [['home-radio','radio'],['home-vehicle','vehicle']]"));const handlers=new Map(),events=[],host={dispatch:event=>events.push(event),focusHeading(){}};new Function('$',binding).call(host,id=>({addEventListener:(_,fn)=>handlers.set(id,fn)}));handlers.get('home-vehicle')();assert.deepEqual(events,[{type:'show',id:'vehicle'}]);});
