// Ported from tests/podview/root-robot-compact-successor.test.mjs (node:test with a minimal fake DOM) to Vitest with a
// real DOM (happy-dom) when the robot control panel moved to React. Same assertions; each port was first run against
// the old robot-control-panel.js in the same real DOM. Adaptations for the real DOM: the fake's querySelectorAll and
// children were arrays, so NodeList and HTMLCollection get the array methods the assertions use (this file only), and a
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
const task=()=>({domain:'vacuum',mapName:'Stueetagen',options:[{id:'start-option',label:'Start rengøring',action:'start',argsSchema:{kind:'cleaning',areas:[{id:'area-k',label:'Køkken'},{id:'area-s',label:'Stue'}],repeat:{min:1,max:3}}},{id:'fan-option',label:'Sugestyrke',action:'set_option',argsSchema:{kind:'choice',choices:[{id:'fan-quiet',label:'quiet'},{id:'fan-max',label:'max'}]}}]});
const device={status:'docked',battery:null,observedAt:1770000000};
const emit=(node,type)=>{if(type==='click'&&node.type==='radio'){if(node.disabled)return;for(const input of node.parentNode.parentNode.querySelectorAll('input'))input.checked=input===node;return node.dispatchEvent(new Event('change',{cancelable:true}));}return node.dispatchEvent(new Event(type,{cancelable:true}));};
const selectedString=node=>String(node.type==='radio'?node.checked:node.getAttribute('aria-pressed')==='true');
const settingTitle=node=>node.querySelector('legend')?.textContent||node.querySelector('h4')?.textContent;
const cleaningForm=panel=>panel.querySelectorAll('form').find(node=>node.className.split(/\s+/).includes('robot-cleaning-form'))||null;
const settingForms=panel=>panel.querySelectorAll('form,fieldset,section').filter(node=>node.className.split(/\s+/).includes('setting'));
test('compact setup keeps Type first and every offered ID while irrelevant known levels hide without losing choices',()=>{
 const admitted=task(),start=admitted.options[0],settings=[{id:'water',key:'water',label:'Water',current:'wet',choices:[{id:'wet',label:'medium'},{id:'dry',label:'low'}]},{id:'fan',key:'suction',label:'Fan',current:'normal',choices:[{id:'normal',label:'balanced'},{id:'strong',label:'max'}]},{id:'mode',key:'cleaning_mode',label:'Mode',current:'both',choices:[{id:'both',label:'vacuum_and_mop'},{id:'vac',label:'vacuum'},{id:'mop',label:'mop'},{id:'custom',label:'Custom job'}]}];start.argsSchema.settings=settings;const panel=mount(new RobotControlPanel()),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:admitted,device,connected:true};
 assert.deepEqual(panel.cleaningOptions.querySelectorAll('legend').map(node=>node.textContent),['Type','Sugeevne','Vandmængde','Antal gange']);assert.equal(panel.cleaningOptions.tagName,'SECTION');assert.equal(panel.dataset.cleaningReady,'true');assert.equal(new Set(panel.startSettingControls.map(row=>row.rail.inputs[0].name)).size,3);assert(panel.cleaningOptions.querySelectorAll('input').every(input=>input.type==='radio'));assert.equal(panel.cleaningOptions.querySelectorAll('button').length,0);
 const choice=value=>panel.querySelectorAll('input[data-robot-choice-kind=settingChoice]').find(input=>input.value===value),control=key=>panel.startSettingControls.find(row=>row.setting.key===key);emit(choice('strong'),'click');emit(choice('mop'),'click');assert.equal(control('suction').rail.node.hidden,true);assert.equal(control('water').rail.node.hidden,false);assert.deepEqual(actions,[]);assert.equal(panel.readCleaningDraft().settingChoices.find(row=>row.settingId==='fan').choiceId,'strong');emit(choice('vac'),'click');assert.equal(control('suction').rail.node.hidden,false);assert.equal(control('suction').selected,'normal');assert.equal(control('water').rail.node.hidden,true);emit(choice('both'),'click');assert.equal(control('suction').selected,'strong');emit(choice('vac'),'click');assert.equal(control('suction').selected,'normal');assert.deepEqual(actions,[]);emit(choice('custom'),'click');assert.equal(control('water').rail.node.hidden,false);assert.equal(control('suction').rail.node.hidden,false);assert.equal(control('suction').selected,null);assert.equal(panel.cleaningSubmit.dataset.needsRooms,'true');
 emit(choice('vac'),'click');emit(panel.querySelector('[name=areaIds]'),'click');emit(cleaningForm(panel),'submit');assert.equal(actions.length,1);assert.equal(actions[0].args.settingChoices.length,3);assert.deepEqual(actions[0].args.settingChoices.find(row=>row.settingId==='water'),{settingId:'water',choiceId:'wet'});
});

test('unknown otherwise irrelevant required setup value stays visible and blocks Start until explicit choice',()=>{
 const admitted=task();admitted.options[0].argsSchema.settings=[{id:'mode',key:'cleaning_mode',label:'Mode',current:'vac',choices:[{id:'vac',label:'vacuum'}]},{id:'water',key:'water',label:'Water',current:null,choices:[{id:'low',label:'low'}]}];const panel=mount(new RobotControlPanel());panel.data={task:admitted,device,connected:true};emit(panel.querySelector('[name=areaIds]'),'click');assert.equal(panel.startSettingControls.find(row=>row.setting.id==='water').rail.node.hidden,false);assert.equal(panel.cleaningSubmit.disabled,true);emit(panel.querySelectorAll('input[data-robot-choice-kind=settingChoice]').find(row=>row.value==='low'),'click');assert.equal(panel.startSettingControls.find(row=>row.setting.id==='water').rail.node.hidden,true);assert.equal(panel.cleaningSubmit.disabled,false);assert.equal(panel.readCleaningDraft().settingChoices.length,2);
});



// The 26 October product decision removes the former advanced/settings/care
// screens; these assertions replace their previous presentation acceptance.
test('source-offered base starts and stops use the Hero Disclosure and retain exact operation gates',()=>{
 const operations=['wash_start','empty_start','dry_start','wash_stop','empty_stop','dry_stop'];for(const operation of operations){const option={id:`opaque-${operation}`,label:operation,action:'dock',argsSchema:{kind:'dock',operation}},panel=mount(new RobotControlPanel()),effects=[];panel.addEventListener('robot-control-action',event=>effects.push(event.detail));panel.data={task:{domain:'vacuum',options:[option]},device,connected:true};const button=panel.transportControls.querySelectorAll('button').find(node=>node.dataset.dockOperation===operation);assert.ok(panel.observation.querySelectorAll('button').includes(button));assert.equal(panel.querySelectorAll('details').length,0);{const base=panel.baseDisclosure;assert.ok(base);assert.equal(base.node.parentNode,panel.transportControls);assert.equal(base.node.dataset.kitLayout,'header-more');assert.equal(base.panel.hidden,true);assert.ok(base.panel.querySelectorAll('button').includes(button));emit(base.trigger,'click');assert.equal(base.panel.hidden,false);assert.deepEqual(effects,[],'opening Base never dispatches a command');}assert.equal(button.dataset.dockOperation,operation);emit(button,'click');assert.deepEqual(effects,[{optionId:option.id,args:{}}]);assert.equal(panel.observation.data.text,'I basen','sending a base action does not fabricate observed activity');panel.observed({...device,pending:{optionId:option.id}});assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');emit(button,'click');assert.equal(effects.length,1);panel.observed(device,{connected:false});emit(button,'click');assert.equal(effects.length,1);}
});

test('status owns the Robot Hero while observed battery, area and duration remain secondary ListRow facts',()=>{
 const at=Date.now()/1000,fact=(key,value,unit)=>({key,value,unit,updatedAt:at,stale:false});const panel=mount(new RobotControlPanel());panel.data={task:task(),device:{...device,live:true,status:'cleaning',battery:76,telemetry:{status:'observed',items:[fact('cleaning_area',23,'m²'),fact('cleaning_time',18,'min'),fact('filter_time_left',40,'h')]}}};assert.equal(panel.observation.data.text,'Rengør');assert.equal(panel.observation.data.value,undefined);assert.match(panel.observation.data.detail,/Batteri 76 %/);assert.match(panel.observation.data.detail,/23 m²/);assert.match(panel.observation.data.detail,/18 min/);assert.equal(panel.care,null);panel.observed({...device,status:'docked',battery:76});assert.equal(panel.observation.data.text,'I basen');assert.equal(panel.observation.data.value,undefined);
});

