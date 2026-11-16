import test from 'node:test';
import assert from 'node:assert/strict';
// Minimal DOM port for actual form events and emitted arguments. Browser layout
// and native focus behavior remain a separate QA gate.
class Node extends EventTarget{
 constructor(tag='host'){super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes=new Map();this.className='';this.classList={contains:name=>this.className.split(' ').includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...names])].join(' ');}};this.textContent='';this.value='';this.checked=false;this.isConnected=true;this.open=false;if(tag!=='host')this.disabled=false;}
 append(...nodes){for(const node of nodes){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(child=>child!==node);node.parentNode=this;}this.children.push(...nodes);}
 contains(node){for(let n=node;n;n=n.parentNode)if(n===this)return true;return false;}
 prepend(...nodes){for(const node of nodes)node.parentNode=this;this.children=this.children.filter(node=>!nodes.includes(node));this.children.unshift(...nodes);}
 replaceChildren(...nodes){for(const node of this.children)node.parentNode=undefined;this.children=[];this.append(...nodes);}
 setAttribute(key,value){this.attributes.set(key,String(value));this[key]=String(value);if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
 removeAttribute(key){this.attributes.delete(key);delete this[key];if(key.startsWith('data-'))delete this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())];}
 getAttribute(key){if(key.startsWith('data-'))return this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]??null;return this.attributes.get(key)??null;}
 attachShadow(){this.shadowRoot=new Node('shadow');return this.shadowRoot;}
 querySelectorAll(selector){const matches=node=>selector.split(',').some(part=>{
  const attr=part.match(/\[([^=\]]+)=([^\]]+)\]/),tag=part.match(/^[a-z][a-z0-9-]*/i);
  return (!tag||node.tagName===tag[0].toUpperCase())&&(!attr||(node[attr[1]]??node.getAttribute(attr[1]))===attr[2])&&(!part.includes(':checked')||node.checked);
 });return this.children.flatMap(node=>[...(matches(node)?[node]:[]),...node.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 focus(){document.activeElement=this;}
 showModal(){this.open=true;}
 close(){this.open=false;this.dispatchEvent(new Event('close'));}
 remove(){}
}
globalThis.HTMLElement=Node;
globalThis.document={createElement:tag=>new Node(tag)};
const {RobotControlPanel}=await import('../../podvoice/gatekeeper/static/podview/robot-control-panel.js');

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
 const panel=new RobotControlPanel(),actions=[];
 panel.addEventListener('robot-control-action',event=>actions.push(event.detail));
 panel.data={task:task(),device:dockFull(),connected:true};
 const start=panel.cleaningSubmit,form=cleaningForm(panel),picker=roomPicker(form);
 assert.equal(start.querySelector('span').textContent,'Vælg rum');
 assert.equal(start.querySelector('img').src,'assets/icons/check2.svg');
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
 const panel=new RobotControlPanel(),actions=[];
 panel.addEventListener('robot-control-action',event=>actions.push(event.detail));
 panel.data={task:task(),device:dockFull(),connected:true};
 const start=panel.cleaningSubmit,form=cleaningForm(panel);
 emit(roomPicker(form).querySelectorAll('button')[0],'click');
 assert.equal(start.querySelector('span').textContent,'Start i Køkken');
 assert.equal(start.querySelector('img').src,'assets/icons/play-fill.svg');
 assert.equal(start.disabled,false);
 assert.equal(start.dataset.needsRooms,'false');
 emit(form,'submit');
 assert.deepEqual(actions,[{optionId:'start-option',args:{areaIds:['area-k'],repeat:1}}]);
});

test('deselecting every room returns to »Vælg rum« instead of locking',()=>{
 const panel=new RobotControlPanel();
 panel.data={task:task(),device:dockFull(),connected:true};
 const start=panel.cleaningSubmit,room=roomPicker(cleaningForm(panel)).querySelectorAll('button')[1];
 emit(room,'click');
 assert.equal(start.querySelector('span').textContent,'Start i Stue');
 emit(room,'click');
 assert.equal(start.querySelector('span').textContent,'Vælg rum');
 assert.equal(start.querySelector('img').src,'assets/icons/check2.svg');
 assert.equal(start.disabled,false);
});

test('offline still locks the main button, also without rooms',()=>{
 const panel=new RobotControlPanel();
 panel.data={task:task(),device:dockFull(),connected:false};
 assert.equal(panel.cleaningSubmit.querySelector('span').textContent,'Vælg rum');
 assert.equal(panel.cleaningSubmit.disabled,true);
});
