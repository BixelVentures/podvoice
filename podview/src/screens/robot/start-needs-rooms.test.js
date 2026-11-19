// Ported from tests/podview/robot-start-needs-rooms.test.mjs (node:test with a minimal fake DOM) to Vitest with a real
// DOM (happy-dom) when the robot control panel moved to React. Same assertions; each port was first run against the old
// robot-control-panel.js in the same real DOM. Adaptations for the real DOM: the fake's querySelectorAll and children
// were arrays, so NodeList and HTMLCollection get the array methods the assertions use (this file only), and a
// collection compared with an array is spread; `new Node(tag)` is document.createElement(tag); panels, the live host
// and a control that takes focus are placed in the document (the fake ones were always connected and focusable), each
// panel in its own form; the fake isConnected=false is a defined property; panels and stored drafts are removed after
// each test (the fake had no storage); a fixture file is read from tests/podview/fixtures. Where they occur: a missing
// shadow root or parent is null (the fake left it undefined); aria-pressed is read with getAttribute (the fake
// setAttribute also set a property); an img src is read with getAttribute (a real src is an absolute URL), the masked
// Stop icon's from its own src property; the fake remove() did nothing, so a Til basen moved into Mere stayed listed in
// the transport row and the busy test lists the commands in offer order.
import {afterEach, test} from 'vitest';
import {RobotControlPanel} from './RobotControlPanel';
import assert from 'node:assert/strict';
const ARRAY_METHODS=['find','filter','map','some','every','includes','flatMap','at','indexOf','findIndex','reduce',
 'slice','findLast'];
for(const type of [NodeList,HTMLCollection])for(const method of ARRAY_METHODS)if(!(method in type.prototype))
 Object.defineProperty(type.prototype,method,
  {configurable:true,value(...args){return Array.prototype[method].apply([...this],args);}});
const mount=panel=>{
 const form=document.createElement('form');form.append(panel);document.body.append(form);return panel;
};
afterEach(()=>{document.body.replaceChildren();localStorage.clear();sessionStorage.clear();});

// Green 16 Nov (2.1.11): no room was preselected, and the main robot button stood as a black,
// locked »Start rengøring«. The offer has no whole-home start, so the button never starts anything
// without rooms; it stays live as »Vælg rum« and leads to the room picker (S12, S13).
const task=()=>({domain:'vacuum',mapName:'Stueetagen',options:[{id:'start-option',label:'Start rengøring',
 action:'start',argsSchema:{kind:'cleaning',areas:[{id:'area-k',label:'Køkken'},{id:'area-s',label:'Stue'}],
  repeat:{min:1,max:3}}}]});
const now=()=>Date.now()/1000;
const dockFull=()=>({status:'docked',battery:100,observedAt:now(),live:true,
 telemetry:{status:'observed',items:[{key:'dock_error',value:'waste_water_tank_full',updatedAt:now()},
  {key:'dirty_box_full',value:true,updatedAt:now()}]}});
const emit=(node,type)=>node.dispatchEvent(new Event(type,{cancelable:true}));
const cleaningForm=panel=>panel.querySelectorAll('form').find(node=>node.className.split(/\s+/)
 .includes('robot-cleaning-form'));
const roomPicker=form=>form.querySelectorAll('fieldset').find(node=>node.className.split(/\s+/)
 .includes('choices'));

test('without a chosen room the main button is a live »Vælg rum« that only leads to the rooms',()=>{
 const panel=mount(new RobotControlPanel()),actions=[];
 panel.addEventListener('robot-control-action',event=>actions.push(event.detail));
 panel.data={task:task(),device:dockFull(),connected:true};
 const start=panel.cleaningSubmit,form=cleaningForm(panel),picker=roomPicker(form);
 assert.equal(start.querySelector('span').textContent,'Vælg rum');
 assert.equal(start.querySelector('img').getAttribute('src'),'assets/icons/check2.svg');
 assert.equal(start.disabled,false,'the main button is never a dead, locked button');
 assert.equal(start.dataset.unready,'false');
 assert.equal(start.dataset.needsRooms,'true');
 let scrolled=null;picker.scrollIntoView=options=>{scrolled=options;};
 emit(form,'submit');
 assert.deepEqual(actions,[],'nothing is started without rooms');
 assert.deepEqual(scrolled,{block:'center',behavior:'smooth'});
 assert.equal(document.activeElement,picker.querySelectorAll('button')[0],'the first room gets focus');
});

test('a full dirty-water tank on the dock does not lock Start; HA decides',()=>{
 const panel=mount(new RobotControlPanel()),actions=[];
 panel.addEventListener('robot-control-action',event=>actions.push(event.detail));
 panel.data={task:task(),device:dockFull(),connected:true};
 const start=panel.cleaningSubmit,form=cleaningForm(panel);
 emit(roomPicker(form).querySelectorAll('button')[0],'click');
 assert.equal(start.querySelector('span').textContent,'Start i Køkken');
 assert.equal(start.querySelector('img').getAttribute('src'),'assets/icons/play-fill.svg');
 assert.equal(start.disabled,false);
 assert.equal(start.dataset.needsRooms,'false');
 emit(form,'submit');
 assert.deepEqual(actions,[{optionId:'start-option',args:{areaIds:['area-k'],repeat:1}}]);
});

test('deselecting every room returns to »Vælg rum« instead of locking',()=>{
 const panel=mount(new RobotControlPanel());
 panel.data={task:task(),device:dockFull(),connected:true};
 const start=panel.cleaningSubmit,room=roomPicker(cleaningForm(panel)).querySelectorAll('button')[1];
 emit(room,'click');
 assert.equal(start.querySelector('span').textContent,'Start i Stue');
 emit(room,'click');
 assert.equal(start.querySelector('span').textContent,'Vælg rum');
 assert.equal(start.querySelector('img').getAttribute('src'),'assets/icons/check2.svg');
 assert.equal(start.disabled,false);
});

test('offline still locks the main button, also without rooms',()=>{
 const panel=mount(new RobotControlPanel());
 panel.data={task:task(),device:dockFull(),connected:false};
 assert.equal(panel.cleaningSubmit.querySelector('span').textContent,'Vælg rum');
 assert.equal(panel.cleaningSubmit.disabled,true);
});
