import test from 'node:test';
import assert from 'node:assert/strict';
// Minimal DOM port for actual form events and emitted arguments. Browser layout
// and native focus behavior remain a separate QA gate.
class Node extends EventTarget{
 constructor(tag='host'){super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.textContent='';this.value='';this.checked=false;if(tag!=='host')this.disabled=false;}
 append(...nodes){this.children.push(...nodes);}
 prepend(...nodes){this.children.unshift(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(key,value){this[key]=value;}
 attachShadow(){this.shadowRoot=new Node('shadow');return this.shadowRoot;}
 querySelectorAll(selector){const matches=node=>selector.split(',').some(part=>{
  const attr=part.match(/\[([^=\]]+)=([^\]]+)\]/),tag=part.match(/^[a-z][a-z0-9-]*/i);
  return (!tag||node.tagName===tag[0].toUpperCase())&&(!attr||node[attr[1]]===attr[2])&&(!part.includes(':checked')||node.checked);
 });return this.children.flatMap(node=>[...(matches(node)?[node]:[]),...node.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
globalThis.HTMLElement=Node;
globalThis.document={createElement:tag=>new Node(tag)};
const {RobotControlPanel}=await import('../../podvoice/gatekeeper/static/podview/robot-control-panel.js');
const task=()=>({domain:'vacuum',mapName:'Stueetagen',options:[{id:'start-option',label:'Start rengøring',action:'start',argsSchema:{kind:'cleaning',areas:[{id:'area-k',label:'Køkken'},{id:'area-s',label:'Stue'}],repeat:{min:1,max:3}}},{id:'fan-option',label:'Sugestyrke',action:'set_option',argsSchema:{kind:'choice',choices:[{id:'fan-quiet',label:'quiet'},{id:'fan-max',label:'max'}]}}]});
const device={status:'docked',battery:null,observedAt:1770000000};
const emit=(node,type)=>node.dispatchEvent(new Event(type,{cancelable:true}));
test('room and repeat touch selections emit only admitted option and area IDs; observations retain the draft',()=>{
 const panel=new RobotControlPanel(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:task(),device};assert.equal(actions.length,0);
 const root=panel,form=root.querySelector('form'),submit=form.querySelectorAll('button').at(-1),rooms=form.querySelectorAll('[name=areaIds]');assert.equal(submit.disabled,true);emit(form,'submit');assert.equal(actions.length,0);
 rooms[0].checked=true;const repeat=form.querySelectorAll('[name=repeat]');repeat[0].checked=false;repeat[2].checked=true;emit(form,'change');assert.equal(submit.disabled,false);
 panel.observed({...device,status:'cleaning',battery:42});assert.equal(root.querySelector('form'),form);assert.equal(rooms[0].checked,true);assert.equal(repeat[2].checked,true);assert.match(panel.observation.data.detail,/42 %/);
 emit(form,'submit');assert.deepEqual(actions,[{optionId:'start-option',args:{areaIds:['area-k'],repeat:3}}]);
 emit(form.querySelectorAll('button').find(node=>node.textContent==='Vælg alle'),'click');emit(form,'submit');assert.deepEqual(actions.at(-1).args.areaIds,['area-k','area-s']);
 emit(form.querySelectorAll('button').find(node=>node.textContent==='Fjern alle'),'click');assert.equal(submit.disabled,true);emit(form,'submit');assert.equal(actions.length,2);
});
test('setting choice uses its exact runtime ID and disabled controls cannot emit a command',()=>{
 const panel=new RobotControlPanel(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:task(),device};assert.doesNotMatch(panel.observation.data.detail,/Batteri/);
 const select=panel.querySelector('select'),form=panel.querySelectorAll('form')[1];assert.equal(select.querySelectorAll('option')[0].value,'');assert.deepEqual(select.querySelectorAll('option').slice(1).map(n=>n.value),['fan-quiet','fan-max']);
 select.value='fan-max';emit(select,'change');emit(form,'submit');assert.deepEqual(actions,[{optionId:'fan-option',args:{choiceId:'fan-max'}}]);panel.disabled=true;assert.ok(panel.querySelectorAll('button').every(n=>n.disabled));assert.ok(panel.querySelectorAll('input').every(n=>n.disabled));assert.equal(select.disabled,true);emit(form,'submit');assert.equal(actions.length,1);
});
test('supplied history does not create a parallel history or receipt actions inside robot controls',()=>{
 const panel=new RobotControlPanel(),actions=[],recipes=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.addEventListener('robot-control-recipe',event=>recipes.push(event.detail));
 const record={id:'recipe-accepted',recordedAt:1770000000,outcome:'accepted_by_ha',recipe:{mapName:'Stueetagen',areaIds:['kitchen'],repeat:2}};panel.data={task:{domain:'vacuum',options:[{id:'pause-opaque',label:'Pause rengøring',action:'pause',argsSchema:{kind:'none'}}]},device:{...device,status:'cleaning'},history:{status:'observed',items:[record,{...record,id:'recipe-unknown',outcome:'unknown'}]}};
 const root=panel,buttons=root.querySelectorAll('button');assert.deepEqual(buttons.map(n=>n.textContent),['Pause rengøring']);assert.equal(root.querySelectorAll('article').length,0);assert.equal(root.querySelectorAll('details').filter(node=>!node.hidden).length,0);assert.equal(root.querySelectorAll('summary').some(n=>n.textContent==='Seneste rengøringer'),false);assert.deepEqual(recipes,[]);assert.deepEqual(actions,[]);emit(buttons[0],'click');assert.deepEqual(actions,[{optionId:'pause-opaque',args:{}}]);
});
test('server-issued recipe reuse retains its primary exact-option action without a history renderer',()=>{
 const panel=new RobotControlPanel(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:{domain:'vacuum',options:[{id:'reuse-opaque',label:'Genbrug rengøring',action:'reuse',argsSchema:{kind:'none'}}]},device};
 const buttons=panel.querySelectorAll('button');assert.deepEqual(buttons.map(n=>n.textContent),['Start denne rengøring']);emit(buttons[0],'click');assert.deepEqual(actions,[{optionId:'reuse-opaque',args:{}}]);panel.disabled=true;emit(buttons[0],'click');assert.equal(actions.length,1);
});

test('server-issued resume uses the existing canonical transport group and exact opaque choice',()=>{
 const panel=new RobotControlPanel(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:{domain:'vacuum',options:[{id:'resume-opaque',label:'Fortsæt rengøring',action:'resume',argsSchema:{kind:'none'}}]},device:{...device,status:'paused'}};
 const buttons=panel.querySelectorAll('button');assert.deepEqual(buttons.map(b=>b.textContent),['Fortsæt rengøring']);emit(buttons[0],'click');assert.deepEqual(actions,[{optionId:'resume-opaque',args:{}}]);panel.disabled=true;emit(buttons[0],'click');assert.equal(actions.length,1);
});

test('a map-only admitted setting remains actionable without a contradictory empty-controls message',()=>{
 const panel=new RobotControlPanel(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:{domain:'vacuum',options:[{id:'map-opaque',label:'Kort',action:'set_option',argsSchema:{kind:'choice',choices:[{id:'upstairs-opaque',label:'1. Sal'}]}}]},device};
 const root=panel;assert.equal(root.querySelectorAll('p').some(n=>n.textContent==='Områdevalg og indstillinger er ikke tilbudt i den aktuelle betjening.'),false);assert.equal(root.querySelector('details').open,true);
 const select=root.querySelector('select');select.value='upstairs-opaque';emit(select,'change');emit(root.querySelector('form'),'submit');assert.deepEqual(actions,[{optionId:'map-opaque',args:{choiceId:'upstairs-opaque'}}]);
 panel.data={task:{domain:'vacuum',options:[]},device};assert.equal(root.querySelectorAll('p').some(n=>n.textContent==='Områdevalg og indstillinger er ikke tilbudt i den aktuelle betjening.'),true);
});

const {controlTask,controlArgs}=await import('../../podvoice/gatekeeper/static/podview/control-model.js');
const settingNow=Date.now(),settingSnapshot={roomId:'room',bootId:'boot'};
function typedSettings(){return controlTask({ok:true,schema:'podview.control.v1',roomId:'room',bootId:'boot',taskId:'settings-task',revision:1,expiresAt:settingNow/1000+30,domain:'vacuum',options:[
 {id:'volume-opaque',label:'Lydstyrke',action:'set_option',argsSchema:{kind:'number',min:0,max:100,step:1,unit:'%',current:90}},
 {id:'dnd-start-opaque',label:'Forstyr ikke fra',action:'set_option',argsSchema:{kind:'time',current:'22:00:00'}},
 {id:'dnd-end-opaque',label:'Forstyr ikke til',action:'set_option',argsSchema:{kind:'time',current:'08:00:00'}},
 {id:'dnd-opaque',label:'Forstyr ikke',action:'set_option',argsSchema:{kind:'choice',choices:[{id:'dnd-on',label:'Til'},{id:'dnd-off',label:'Fra'}]}},
 {id:'child-opaque',label:'Børnesikring',action:'set_option',argsSchema:{kind:'choice',choices:[{id:'child-on',label:'Til'},{id:'child-off',label:'Fra'}]}},
 {id:'empty-opaque',label:'Tømning',action:'set_option',argsSchema:{kind:'choice',choices:[{id:'empty-balanced',label:'Balanceret'},{id:'empty-max',label:'Maksimal'}]}},
]},settingSnapshot,'vacuum',settingNow);}
Object.defineProperty(Node.prototype,'valueAsNumber',{get(){return this.value.trim()?Number(this.value):NaN;}});
test('actual existing settings forms render numeric/time current values without authorizing defaults or input effects',()=>{
 const admitted=typedSettings(),panel=new RobotControlPanel(),intents=[];panel.addEventListener('robot-control-action',event=>intents.push({optionId:event.detail.optionId,args:controlArgs(admitted,event.detail.optionId,event.detail.args,settingNow)}));panel.data={task:admitted,device};
 const forms=panel.querySelectorAll('form');assert.equal(forms.length,6);assert.ok(forms.every(form=>form.className==='setting'));const [volume,start,end]=forms;const field=volume.querySelector('input'),submit=volume.querySelector('button');
 assert.equal(field.type,'number');assert.equal(field.value,'90');assert.equal(field.min,'0');assert.equal(field.max,'100');assert.equal(field.step,'1');assert.equal(submit.disabled,true);assert.equal(start.querySelector('input').type,'time');assert.equal(start.querySelector('input').value,'22:00:00');assert.equal(end.querySelector('input').value,'08:00:00');
 emit(volume,'submit');emit(start,'submit');assert.deepEqual(intents,[]);field.value='75';emit(field,'input');assert.equal(submit.disabled,false);assert.deepEqual(intents,[]);panel.observed({...device,battery:90});assert.equal(panel.querySelectorAll('form')[0],volume);assert.equal(field.value,'75');emit(volume,'submit');assert.deepEqual(intents,[{optionId:'volume-opaque',args:{value:75}}]);
 const clock=start.querySelector('input');clock.value='21:30';emit(clock,'change');assert.equal(start.querySelector('button').disabled,false);assert.equal(intents.length,1);emit(start,'submit');assert.deepEqual(intents.at(-1),{optionId:'dnd-start-opaque',args:{time:'21:30'}});assert.equal(end.querySelector('input').value,'08:00:00');
 panel.disabled=true;clock.value='20:00';emit(clock,'input');emit(start,'submit');assert.equal(intents.length,2);assert.ok(panel.querySelectorAll('button,input,select').every(node=>node.disabled));
});
test('malformed draft values and unknown setting schemas never become bounded control intents',()=>{
 const admitted=typedSettings(),panel=new RobotControlPanel(),intents=[];panel.addEventListener('robot-control-action',event=>{try{intents.push(controlArgs(admitted,event.detail.optionId,event.detail.args,settingNow));}catch{}});panel.data={task:admitted,device};const [volume,start]=panel.querySelectorAll('form'),number=volume.querySelector('input'),clock=start.querySelector('input');
 for(const value of ['','NaN','Infinity','-1','101','75.5']){number.value=value;emit(number,'input');emit(volume,'submit');}
 for(const time of ['24:00','21:60','21:30Z','2026-10-16T21:30','21:30\n','21:30:00\r\n']){clock.value=time;emit(clock,'change');emit(start,'submit');}assert.deepEqual(intents,[]);
 number.value='90';emit(number,'change');assert.equal(volume.querySelector('button').disabled,true);emit(volume,'submit');assert.deepEqual(intents,[]);
 panel.data={task:{domain:'vacuum',options:[{id:'unknown',label:'Ukendt',action:'set_option',argsSchema:{kind:'unknown'}}]},device};assert.equal(panel.querySelectorAll('form').length,0);
});

test('control adapter shares canonical observation and button presentation without a shadow stylesheet',()=>{
 const panel=new RobotControlPanel();panel.data={task:task(),device};
 assert.equal(panel.shadowRoot,undefined);
 assert.equal(panel.querySelectorAll('style').length,0);
 assert.equal(panel.observation.tagName,'PV-VACUUM-WIDGET');
 assert.deepEqual(panel.observation.data.actions,[]);
 assert.ok(panel.querySelectorAll('button').every(button=>button.className.split(' ').includes('pv-button')));
 assert.equal(panel.querySelectorAll('fieldset').length,2);
 assert.deepEqual(panel.querySelectorAll('legend').map(node=>node.textContent),['Vælg områder','Antal rengøringer']);
});


test('existing read-only care moves beside admitted robot controls and updates without resetting the cleaning draft',()=>{
 const at=Date.now()/1000,fact=(key,value,unit=null)=>({key,value,unit,updatedAt:at,stale:false});
 const observed={...device,telemetry:{status:'observed',items:[fact('filter_time_left',0,'h'),fact('dock_error','water_empty'),fact('dnd_start_time','22:00:00')]}};
 const panel=new RobotControlPanel(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:task(),device:observed};
 const care=panel.care,summary=care.querySelector('summary'),form=panel.querySelector('form'),area=form.querySelector('input');area.checked=true;care.open=true;
 assert.equal(care.hidden,false);assert.equal(summary.textContent,'Pleje og status');assert.deepEqual(care.querySelectorAll('h3').map(node=>node.textContent),['Vedligeholdelse','Dock og vand','Indstillinger']);assert.deepEqual(care.querySelectorAll('dd').map(node=>node.textContent),['0 timer tilbage','Mangler vand','22:00']);assert.equal(care.querySelectorAll('button,input,select').length,0);assert.deepEqual(actions,[]);
 panel.observed({...observed,stale:true});assert.equal(panel.care,care);assert.equal(care.open,true);assert.equal(care.querySelector('summary'),summary);assert.equal(panel.querySelector('form'),form);assert.equal(area.checked,true);assert.ok(care.querySelectorAll('dd').every(node=>node.textContent.endsWith(' · sidst kendt')));assert.deepEqual(actions,[]);
 panel.observed({...observed,telemetry:{status:'unavailable',items:[]}});assert.equal(care.hidden,true);assert.equal(panel.querySelector('form'),form);assert.equal(area.checked,true);assert.deepEqual(actions,[]);
});

const suggestionTask=()=>({domain:'vacuum',bootId:'boot-current',roomId:'room-current',taskId:'task-current',revision:1,expiresAt:Date.now()/1000+120,options:[{id:'a'.repeat(24),action:'start',label:'Start rengøring',argsSchema:{kind:'cleaning',areas:[{id:'b'.repeat(24),label:'Køkken'},{id:'c'.repeat(24),label:'Stue'}],repeat:{min:1,max:3}}}]});
const suggestionFor=task=>({schema:'podview.robot-suggestion.v1',bootId:task.bootId,roomId:task.roomId,taskId:task.taskId,revision:1,optionId:task.options[0].id,recipeId:'d'.repeat(32),areaIds:[task.options[0].argsSchema.areas[1].id],repeat:2,expiresAt:task.expiresAt,source:'ai_recipe_selection',basis:'recent_choices'});
test('a grounded proposal fills only current admitted areas/repeat on explicit apply and never starts',()=>{
 const panel=new RobotControlPanel(),admitted=suggestionTask(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:admitted,device};const form=panel.querySelector('form'),areas=form.querySelectorAll('[name=areaIds]'),repeats=form.querySelectorAll('[name=repeat]'),proposal=suggestionFor(admitted);
 assert.equal(panel.suggest(proposal),true);assert.equal(panel.proposalButton.hidden,false);assert.equal(panel.proposalCaption.textContent,'Forslag fra dine seneste valg: Stue · 2 gange');assert.ok(form.children.includes(panel.proposalCaption));assert.ok(form.children.includes(panel.proposalButton));assert.ok(!form.querySelector('div').children.includes(panel.proposalCaption));assert.ok(form.children.indexOf(panel.proposalButton)<form.children.indexOf(form.querySelector('fieldset')));assert.ok(areas.every(input=>!input.checked));assert.deepEqual(actions,[]);
 emit(panel.proposalButton,'click');assert.deepEqual(areas.map(input=>input.checked),[false,true]);assert.deepEqual(repeats.map(input=>input.checked),[false,true,false]);assert.equal(form.querySelectorAll('p').find(node=>node.className==='summary').textContent,'Stue · 2 gange');assert.equal(panel.proposalButton.textContent,'Forslag valgt');assert.deepEqual(actions,[]);assert.equal(panel.querySelector('form'),form);
 emit(form,'submit');assert.deepEqual(actions,[{optionId:admitted.options[0].id,args:{areaIds:[proposal.areaIds[0]],repeat:2}}]);
});
test('late proposals never overwrite a user draft or revive disconnected/readonly controls',()=>{
 const panel=new RobotControlPanel(),admitted=suggestionTask();panel.data={task:admitted,device};const form=panel.querySelector('form'),first=form.querySelector('[name=areaIds]');first.checked=true;emit(form,'change');assert.equal(panel.suggest(suggestionFor(admitted)),false);assert.equal(first.checked,true);assert.equal(panel.proposalButton.hidden,true);
 panel.data={task:admitted,device};panel.disabled=true;assert.equal(panel.suggest(suggestionFor(admitted)),false);assert.equal(panel.proposalButton.hidden,true);panel.disabled=false;panel.isConnected=false;assert.equal(panel.suggest(suggestionFor(admitted)),false);
 panel.data={task:null,device};assert.equal(panel.suggest(suggestionFor(admitted)),false);assert.equal(panel.querySelectorAll('form').length,0);
});
test('proposal validation closes every task binding and admitted field and rejects extras',()=>{
 const panel=new RobotControlPanel(),admitted=suggestionTask();panel.data={task:admitted,device};const valid=suggestionFor(admitted);assert.ok(panel.validSuggestion(valid));
 const invalid=[{bootId:'old'},{roomId:'foreign'},{taskId:'old'},{revision:2},{optionId:'e'.repeat(24)},{expiresAt:admitted.expiresAt-1},{recipeId:'not-an-id'},{areaIds:[]},{areaIds:[valid.areaIds[0],valid.areaIds[0]]},{areaIds:['e'.repeat(24)]},{repeat:0},{repeat:4},{repeat:1.5},{source:'completed_cleaning'},{basis:'dirty'},{extra:'unadmitted'}];for(const patch of invalid){assert.equal(panel.validSuggestion({...valid,...patch}),null,JSON.stringify(patch));assert.equal(panel.suggest({...valid,...patch}),false);assert.equal(panel.proposalCaption.hidden,true);}
 const expired={...admitted,expiresAt:Date.now()/1000-1};panel.data={task:expired,device};assert.equal(panel.validSuggestion(suggestionFor(expired)),null);
});
test('stale or consumed proposal cannot be applied after the current panel is disabled',()=>{
 const panel=new RobotControlPanel(),admitted=suggestionTask(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:admitted,device};panel.suggest(suggestionFor(admitted));panel.disabled=true;emit(panel.proposalButton,'click');assert.ok(panel.querySelectorAll('[name=areaIds]').every(input=>!input.checked));assert.deepEqual(actions,[]);assert.equal(panel.suggest(suggestionFor(admitted)),false);assert.equal(panel.proposalButton.hidden,true);
});
