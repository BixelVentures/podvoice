import test from 'node:test';
import assert from 'node:assert/strict';
import {lightMaterialObservation as observe,lightMaterialValues,installLightMaterial} from './light-material.js';
const lamp=(brightness,on=true)=>({brightness,on,dimmable:true});
const device={id:'light',kind:'light',status:'on',exampleOnly:true,lights:[lamp(20)]};
test('only an actual shared level is projected; mixed/unequal levels never become averages',()=>{
 assert.deepEqual(observe(device,[lamp(20),lamp(20)]),{state:'on',level:20});
 assert.deepEqual(observe(device,[lamp(20),lamp(80)]),{state:'on',level:null});
 assert.deepEqual(observe(device,[lamp(20),lamp(80,false)]),{state:'mixed',level:null});
 assert.deepEqual(observe(device,[lamp(20,false)]),{state:'off',level:null});
 for(const patch of [{stale:true},{status:'unknown'},{live:true},{exampleOnly:false}])assert.equal(observe({...device,...patch},device.lights).state,'unknown');
 for(const value of [-1,101,NaN,null])assert.equal(observe(device,[lamp(value)]).level,null);
 assert.equal(observe(device,device.lights,false).state,'unknown');
 const low=lightMaterialValues({state:'on',level:20}),high=lightMaterialValues({state:'on',level:80});assert(low.opacity<high.opacity);assert(low.scale<high.scale);assert.equal(lightMaterialValues({state:'unknown',level:80}).opacity,0);
});
test('binding is idempotent, pending settles, and cleanup prevents callback resurrection',()=>{
 const document=new EventTarget(),media=new EventTarget();document.documentElement={dataset:{design:'candidate'}};let callback,writes=0;
 class Observer{constructor(fn){callback=fn;}observe(){}disconnect(){}}
 const values=new Map(),node={dataset:{target:'light'},style:{getPropertyValue:k=>values.get(k)||'',setProperty(k,v){writes++;values.set(k,v);},removeProperty:k=>values.delete(k)}};
 const render=function(){return 7;},cleanup=function(){return 8;};
 const host={live:false,isConnected:true,dataset:{},state:{connected:true,devices:[structuredClone(device)]},render,cleanup,querySelectorAll:()=>[node]};
 const options={document,media,Observer};installLightMaterial(host,options);const wrapper=host.render;installLightMaterial(host,options);assert.equal(host.render,wrapper);
 assert.equal(node.dataset.lightMaterial,'on');assert.equal(node.dataset.lightLevelKnown,'true');const count=writes;assert.equal(host.render(),7);assert.equal(writes,count);
 host.state.devices[0].pending={action:'brightness'};host.render();assert.equal(node.dataset.lightMaterialMotion,'settled');assert.equal(values.get('--pv-light-observed-level'),'20');
 delete host.state.devices[0].pending;media.matches=true;media.dispatchEvent(new Event('change'));assert.equal(node.dataset.lightMaterialMotion,'settled');
 host.state.devices[0].stale=true;host.render();assert.equal(node.dataset.lightMaterial,'unknown');assert.equal(values.get('--pv-light-material-opacity'),'0');assert(!values.has('--pv-light-observed-level'));
 assert.equal(host.cleanup(),8);assert.equal(host.render,render);assert.equal(host.cleanup,cleanup);callback();wrapper.call(host);assert.equal(node.dataset.lightMaterial,undefined);assert.equal(values.size,0);
});
