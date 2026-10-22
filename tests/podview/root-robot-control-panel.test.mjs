import test from 'node:test';
import assert from 'node:assert/strict';
// Minimal DOM port for actual form events and emitted arguments. Browser layout
// and native focus behavior remain a separate QA gate.
class Node extends EventTarget{
 constructor(tag='host'){super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes=new Map();this.className='';this.classList={contains:name=>this.className.split(' ').includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...names])].join(' ');}};this.textContent='';this.value='';this.checked=false;this.isConnected=true;this.open=false;if(tag!=='host')this.disabled=false;}
 append(...nodes){this.children.push(...nodes);}
 prepend(...nodes){this.children=this.children.filter(node=>!nodes.includes(node));this.children.unshift(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(key,value){this.attributes.set(key,String(value));this[key]=String(value);if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
 getAttribute(key){if(key.startsWith('data-'))return this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]??null;return this.attributes.get(key)??null;}
 attachShadow(){this.shadowRoot=new Node('shadow');return this.shadowRoot;}
 querySelectorAll(selector){const matches=node=>selector.split(',').some(part=>{
  const attr=part.match(/\[([^=\]]+)=([^\]]+)\]/),tag=part.match(/^[a-z][a-z0-9-]*/i);
  return (!tag||node.tagName===tag[0].toUpperCase())&&(!attr||node[attr[1]]===attr[2])&&(!part.includes(':checked')||node.checked);
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
const {LiveControlView}=await import('../../podvoice/gatekeeper/static/podview/live-control-view.js');
const task=()=>({domain:'vacuum',mapName:'Stueetagen',options:[{id:'start-option',label:'Start rengøring',action:'start',argsSchema:{kind:'cleaning',areas:[{id:'area-k',label:'Køkken'},{id:'area-s',label:'Stue'}],repeat:{min:1,max:3}}},{id:'fan-option',label:'Sugestyrke',action:'set_option',argsSchema:{kind:'choice',choices:[{id:'fan-quiet',label:'quiet'},{id:'fan-max',label:'max'}]}}]});
const device={status:'docked',battery:null,observedAt:1770000000};
const emit=(node,type)=>node.dispatchEvent(new Event(type,{cancelable:true}));
// Compose both real owners: liveScene's connected flag is intentionally false,
// while only the transport and current server offer admit this live task.
async function livePanelFixture({connected=true,authorized=true}={}){
 const previousDocument=globalThis.document;
 globalThis.document={createElement:tag=>tag==='pv-robot-control-panel'?new RobotControlPanel():new Node(tag),getElementById:()=>null,body:new Node('body')};
 const host=new Node(),target={entityId:'vacuum.actual'};
 host.querySelector=()=>null;
 host.state={connected:false,devices:[{...device,id:target.entityId,kind:'vacuum',live:true,stale:false}]};
 host.liveSnapshot={bootId:'boot',roomId:'room',capabilities:{controlSetup:authorized?['vacuum']:[]}};
 let reads=0,writes=0;
 host.liveTransport={connected,controlSetup:async()=>{reads++;return {ok:true,schema:'podview.control.v1',bootId:'boot',roomId:'room',domain:'vacuum',taskId:'current-task',revision:1,expiresAt:Date.now()/1000+120,options:task().options};},controlAction:async()=>{writes++;throw Error('This regression must never send a robot command');}};
 const view=new LiveControlView(host);
 await view.open('vacuum',target,new Node('button'));
 return {host,view,reads:()=>reads,writes:()=>writes,cleanup(){view.cleanup();globalThis.document=previousDocument;}};
}
test('real live task enables admitted robot choices from transport connection despite scene connected=false',async()=>{
 const f=await livePanelFixture();try{
  const panel=f.view.robotPanel,room=panel.querySelector('[name=areaIds]');
  assert.ok(panel instanceof RobotControlPanel);assert.equal(f.host.state.connected,false);assert.equal(f.reads(),1);
  assert.equal(panel.value.connected,true);assert.equal(panel.observation.data.connected,true);assert.equal(room.disabled,false);
  assert.equal(panel.cleaningSubmit.disabled,true);emit(room,'click');
  assert.equal(panel.cleaningSubmit.disabled,false);assert.equal(panel.cleaningSubmit.textContent,'Start i Køkken');
  f.view.render();assert.equal(f.view.robotPanel,panel);assert.equal(room.checked,true);assert.equal(room.disabled,false);assert.equal(panel.cleaningSubmit.disabled,false);assert.equal(f.writes(),0);
 }finally{f.cleanup();}
});
for(const boundary of ['offline','revoked','pending','setup-pending','spent','stale','missing-task','expired'])test(`real live panel remains closed at ${boundary} despite scene connected=true`,async()=>{
 const f=await livePanelFixture();try{
  const panel=f.view.robotPanel,room=panel.querySelector('[name=areaIds]');emit(room,'click');
  f.host.state.connected=true;
  if(boundary==='offline')f.host.liveTransport.connected=false;
  else if(boundary==='revoked')f.host.liveSnapshot.capabilities.controlSetup=[];
  else if(boundary==='pending')f.view.pending=true;
  else if(boundary==='setup-pending')f.view.setupPending=true;
  else if(boundary==='spent')f.view.spent.set(f.view.task.taskId,f.view.task.expiresAt);
  else if(boundary==='stale')f.host.state.devices[0].stale=true;
  else if(boundary==='missing-task')f.view.task=null;
  else f.view.task.expiresAt=Date.now()/1000-1;
  f.view.render();assert.ok(panel.querySelectorAll('button,input,select').every(node=>node.disabled),boundary);assert.equal(f.writes(),0);
 }finally{f.cleanup();}
});
for(const boundary of ['offline','revoked'])test(`real live panel cannot open without ${boundary==='offline'?'transport connection':'current vacuum authority'}`,async()=>{
 const f=await livePanelFixture({connected:boundary!=='offline',authorized:boundary!=='revoked'});try{assert.equal(f.view.robotPanel,undefined);assert.equal(f.reads(),0);assert.equal(f.writes(),0);}finally{f.cleanup();}
});
test('room and repeat touch selections emit only admitted option and area IDs; observations retain the draft',()=>{
 const panel=new RobotControlPanel(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:task(),device};assert.equal(actions.length,0);
 const root=panel,form=root.querySelector('form'),submit=panel.cleaningSubmit,rooms=form.querySelectorAll('[name=areaIds]');assert.equal(submit.disabled,true);emit(form,'submit');assert.equal(actions.length,0);
 rooms[0].checked=true;const repeat=form.querySelectorAll('[name=repeat]');repeat[0].checked=false;repeat[2].checked=true;emit(form,'change');assert.equal(submit.disabled,false);
 panel.observed({...device,status:'cleaning',battery:42});assert.equal(root.querySelector('form'),form);assert.equal(rooms[0].checked,true);assert.equal(repeat[2].checked,true);assert.match(panel.observation.data.detail,/42 %/);
 emit(form,'submit');assert.deepEqual(actions,[{optionId:'start-option',args:{areaIds:['area-k'],repeat:3}}]);
 assert.equal(panel.transportControls.querySelector('button'),submit);assert.equal(submit.getAttribute('form'),form.id);assert.equal(submit.textContent,'Start i Køkken');assert.ok(!panel.querySelectorAll('button').some(node=>['Vælg alle','Fjern alle'].includes(node.textContent)));emit(rooms[1],'click');emit(form,'submit');assert.deepEqual(actions.at(-1).args.areaIds,['area-k','area-s']);emit(rooms[0],'click');emit(rooms[1],'click');assert.equal(submit.disabled,true);emit(form,'submit');assert.equal(actions.length,2);
});
test('setting choice uses its exact runtime ID and disabled controls cannot emit a command',()=>{
 const panel=new RobotControlPanel(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:task(),device};assert.doesNotMatch(panel.observation.data.detail,/Batteri/);
 const form=panel.querySelectorAll('form')[1],choices=form.querySelectorAll('[name=choiceId]'),submit=form.querySelectorAll('button').at(-1);assert.equal(panel.querySelector('select'),null);assert.deepEqual(choices.map(node=>node.value),['fan-quiet','fan-max']);assert.ok(choices.every(node=>node['aria-pressed']==='false'));assert.equal(submit.disabled,true);emit(form,'submit');assert.deepEqual(actions,[]);
 emit(choices[1],'click');assert.deepEqual(choices.map(node=>node['aria-pressed']),['false','true']);assert.deepEqual(actions,[]);emit(form,'submit');assert.deepEqual(actions,[{optionId:'fan-option',args:{choiceId:'fan-max'}}]);panel.disabled=true;assert.ok(panel.querySelectorAll('button').every(n=>n.disabled));assert.ok(panel.querySelectorAll('input').every(n=>n.disabled));emit(choices[0],'click');emit(form,'submit');assert.equal(choices[1]['aria-pressed'],'true');assert.equal(actions.length,1);
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
 const choice=root.querySelector('[name=choiceId]');assert.equal(choice.value,'upstairs-opaque');emit(choice,'click');emit(root.querySelector('form'),'submit');assert.deepEqual(actions,[{optionId:'map-opaque',args:{choiceId:'upstairs-opaque'}}]);
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
 assert.deepEqual(panel.querySelectorAll('legend').map(node=>node.textContent),['Vælg rum','Gennemløb']);
});


test('existing read-only care moves beside admitted robot controls and updates without resetting the cleaning draft',()=>{
 const at=Date.now()/1000,fact=(key,value,unit=null)=>({key,value,unit,updatedAt:at,stale:false});
 const observed={...device,telemetry:{status:'observed',items:[fact('filter_time_left',0,'h'),fact('dock_error','water_empty'),fact('dnd_start_time','22:00:00')]}};
 const panel=new RobotControlPanel(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:task(),device:observed};
 const care=panel.care,summary=care.querySelector('summary'),form=panel.querySelector('form'),area=form.querySelector('[name=areaIds]');emit(area,'click');care.open=true;
 assert.equal(care.hidden,false);assert.equal(summary.textContent,'Pleje og status');assert.deepEqual(care.querySelectorAll('h3').map(node=>node.textContent),['Vedligeholdelse','Dock og vand','Indstillinger']);assert.deepEqual(care.querySelectorAll('dd').map(node=>node.textContent),['0 timer tilbage','Mangler vand','22:00']);assert.equal(care.querySelectorAll('button,input,select').length,0);assert.deepEqual(actions,[]);
 panel.observed({...observed,stale:true});assert.equal(panel.care,care);assert.equal(care.open,true);assert.equal(care.querySelector('summary'),summary);assert.equal(panel.querySelector('form'),form);assert.equal(area.checked,true);assert.ok(care.querySelectorAll('dd').every(node=>node.textContent.endsWith(' · sidst kendt')));assert.deepEqual(actions,[]);
 panel.observed({...observed,telemetry:{status:'unavailable',items:[]}});assert.equal(care.hidden,true);assert.equal(panel.querySelector('form'),form);assert.equal(area.checked,true);assert.deepEqual(actions,[]);
});

const suggestionTask=()=>({domain:'vacuum',bootId:'boot-current',roomId:'room-current',taskId:'task-current',revision:1,expiresAt:Date.now()/1000+120,options:[{id:'a'.repeat(24),action:'start',label:'Start rengøring',argsSchema:{kind:'cleaning',areas:[{id:'b'.repeat(24),label:'Køkken'},{id:'c'.repeat(24),label:'Stue'}],repeat:{min:1,max:3}}}]});
const suggestionFor=task=>({schema:'podview.robot-suggestion.v1',bootId:task.bootId,roomId:task.roomId,taskId:task.taskId,revision:1,optionId:task.options[0].id,recipeId:'d'.repeat(32),areaIds:[task.options[0].argsSchema.areas[1].id],repeat:2,expiresAt:task.expiresAt,source:'ai_recipe_selection',basis:'recent_choices'});
test('a grounded proposal fills only current admitted areas/repeat on explicit apply and never starts',()=>{
 const panel=new RobotControlPanel(),admitted=suggestionTask(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:admitted,device};const form=panel.querySelector('form'),areas=form.querySelectorAll('[name=areaIds]'),repeats=form.querySelectorAll('[name=repeat]'),proposal=suggestionFor(admitted);
 assert.equal(panel.suggest(proposal),true);assert.equal(panel.proposalButton.hidden,false);assert.equal(panel.proposalCaption.textContent,'Fra dine seneste valg: Stue · 2 gange');assert.ok(panel.proposalZone.children.includes(panel.proposalCaption));assert.ok(panel.proposalZone.children.includes(panel.proposalButton));assert.equal(panel.proposalZone.hidden,false);assert.ok(panel.content.children.indexOf(panel.proposalZone)>panel.content.children.findIndex(node=>node.children.includes(form)));assert.ok(areas.every(input=>!input.checked));assert.deepEqual(actions,[]);
 emit(panel.proposalButton,'click');assert.deepEqual(areas.map(input=>input.checked),[false,true]);assert.deepEqual(repeats.map(input=>input.checked),[false,true,false]);assert.equal(form.querySelectorAll('p').find(node=>node.className==='summary').textContent,'Stue · 2 gange');assert.equal(panel.proposalButton.textContent,'Valgt');assert.deepEqual(actions,[]);assert.equal(panel.querySelector('form'),form);
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

const historicalTask=()=>{const admitted=suggestionTask();admitted.options.push({id:'e'.repeat(24),action:'reuse',label:'Brug denne rengøring',argsSchema:{kind:'none'}});admitted.historyDraft={source:'accepted_start_history',optionId:admitted.options[0].id,areaIds:[admitted.options[0].argsSchema.areas[0].id],repeat:2};return admitted;};
test('selected historical draft prefills existing editable form silently, survives observation and late AI, then explicit Start uses edited current IDs',()=>{
 const panel=new RobotControlPanel(),admitted=historicalTask(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:admitted,device};
 const form=panel.querySelector('form'),areas=form.querySelectorAll('[name=areaIds]'),repeats=form.querySelectorAll('[name=repeat]');assert.deepEqual(areas.map(x=>x.checked),[true,false]);assert.deepEqual(repeats.map(x=>x.checked),[false,true,false]);assert.deepEqual(actions,[]);assert.equal(panel.proposalCaption.textContent,'Dit tidligere rumvalg');assert.equal(panel.proposalButton.hidden,true);const saved=panel.querySelectorAll('button').find(n=>n.textContent==='Start uændret');assert.equal(saved,undefined);assert.equal(panel.querySelectorAll('button').filter(n=>n.classList.contains('pv-primary')&&n.classList.contains('start')&&n.getAttribute('data-kit-variant')==='primary').length,1);
 assert.equal(panel.suggest(suggestionFor(admitted)),false);assert.deepEqual(areas.map(x=>x.checked),[true,false]);areas[0].checked=false;areas[1].checked=true;repeats[1].checked=false;repeats[2].checked=true;emit(form,'change');panel.observed({...device,battery:45});assert.equal(panel.querySelector('form'),form);assert.equal(panel.suggest(suggestionFor(admitted)),false);assert.deepEqual(actions,[]);emit(form,'submit');assert.deepEqual(actions,[{optionId:admitted.options[0].id,args:{areaIds:[admitted.options[0].argsSchema.areas[1].id],repeat:3}}]);
 panel.disabled=true;emit(form,'submit');assert.equal(actions.length,1);
});
test('foreign or invalid history draft cannot prefill fields even at the public component boundary',()=>{
 for(const change of [d=>d.source='completed_cleaning',d=>d.areaIds=['foreign'],d=>d.repeat=0,d=>d.extra=true,d=>d.optionId='old']){const panel=new RobotControlPanel(),admitted=historicalTask();change(admitted.historyDraft);panel.data={task:admitted,device};assert.ok(panel.querySelectorAll('[name=areaIds]').every(x=>!x.checked));}
});

test('an authorized taskless read retains the real observation without terminal readonly or loading prose',()=>{
 const panel=new RobotControlPanel(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));
 panel.data={task:null,device,readOnly:false};
 assert.equal(panel.observation.data.text,'Ved basen');assert.equal(panel.querySelectorAll('form').length,0);assert.equal(panel.querySelectorAll('p').some(node=>/Kun status|ikke tilbudt|henter|venter/i.test(node.textContent)),false);assert.deepEqual(actions,[]);
 for(const readOnly of [true,undefined]){panel.data={task:null,device,readOnly};assert.equal(panel.observation.data.text,'Ved basen');assert.equal(panel.querySelectorAll('p').some(node=>node.textContent==='Kun status og pleje er tilgængelig.'),true);assert.equal(panel.querySelectorAll('form').length,0);}
 assert.deepEqual(actions,[]);
});


test('robot control keeps canonical status identity and connection while observations retain edited form',()=>{
 const panel=new RobotControlPanel();panel.data={task:task(),device:{...device,live:true,status:'cleaning',pending:true,battery:76},connected:true};
 const form=panel.querySelector('form');assert.equal(panel.observation.data.title,'Robotstøvsuger');assert.equal(panel.observation.data.resourceStatus,'cleaning');assert.equal(panel.observation.data.state,'pending');assert.equal(panel.observation.data.quietStatus,true);assert.equal(panel.observation.data.connected,true);assert.equal(panel.observation.data.text,'Rengør');
 panel.observed({...device,live:true,status:'stopped',stale:true,battery:130},{connected:false});assert.equal(panel.querySelector('form'),form);assert.equal(panel.observation.data.resourceStatus,'stopped');assert.equal(panel.observation.data.state,'ready');assert.equal(panel.observation.data.connected,false);assert.equal(panel.observation.data.text,'Sidst kendt: Ingen aktiv rengøring');assert.equal(panel.observation.data.detail,'');
});


test('room tiles and repeat segments use semantic buttons, retain IDs and never dispatch before Start',()=>{
 const panel=new RobotControlPanel(),actions=[];panel.addEventListener('robot-control-action',e=>actions.push(e.detail));panel.data={task:task(),device};
 const form=panel.querySelector('form'),rooms=form.querySelectorAll('[name=areaIds]'),repeats=form.querySelectorAll('[name=repeat]');
 assert.ok([...rooms,...repeats].every(node=>node.tagName==='BUTTON'&&node.type==='button'));
 assert.equal(form.querySelectorAll('input').length,0);assert.deepEqual(rooms.map(n=>n['aria-pressed']),['false','false']);
 emit(rooms[0],'click');emit(rooms[1],'click');emit(repeats[2],'click');assert.deepEqual(rooms.map(n=>n['aria-pressed']),['true','true']);assert.deepEqual(repeats.map(n=>n['aria-pressed']),['false','false','true']);assert.deepEqual(actions,[]);
 panel.observed(device);assert.equal(panel.querySelector('form'),form);assert.equal(rooms[0].value,'area-k');assert.equal(panel.querySelectorAll('svg').length,0);
 emit(form,'submit');assert.deepEqual(actions,[{optionId:'start-option',args:{areaIds:['area-k','area-s'],repeat:3}}]);
 panel.disabled=true;emit(rooms[0],'click');emit(repeats[0],'click');assert.deepEqual(rooms.map(n=>n.checked),[true,true]);assert.equal(repeats[2].checked,true);
});


test('real robot command and repeat controls bind shared Button or Segmented recipes without changing admitted IDs',()=>{
 const panel=new RobotControlPanel();panel.data={task:task(),device};const buttons=panel.querySelectorAll('button');
 assert.ok(buttons.length>0);for(const button of buttons){const family=button.getAttribute('data-kit');assert.ok(['button','chip','tile'].includes(family),button.textContent);if(button.name==='repeat'||button.name==='choiceId')assert.equal(family,'chip');}
 const original=panel.querySelector('form');panel.observed({...device,battery:50});assert.equal(panel.querySelector('form'),original);assert.deepEqual(panel.querySelectorAll('[name=areaIds]').map(button=>button.value),['area-k','area-s']);
});

test('identical current task payloads retain editable rooms, repeat and disclosure without reviving old task controls',()=>{
 const panel=new RobotControlPanel(),admitted=task(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:admitted,device};const form=panel.querySelector('form'),rooms=form.querySelectorAll('[name=areaIds]'),repeat=form.querySelectorAll('[name=repeat]');emit(rooms[1],'click');emit(repeat[2],'click');const settings=panel.querySelectorAll('details').find(node=>node.className.includes('settings'));settings.open=true;
 panel.data={task:JSON.parse(JSON.stringify(admitted)),device:{...device,battery:77}};assert.equal(panel.querySelector('form'),form);assert.equal(settings.open,true);assert.equal(rooms[1].checked,true);assert.equal(repeat[2].checked,true);emit(form,'submit');assert.deepEqual(actions,[{optionId:'start-option',args:{areaIds:['area-s'],repeat:3}}]);
 panel.data={task:{...task(),taskId:'replacement'},device};emit(form,'submit');assert.equal(actions.length,1,'detached old form cannot act on replacement task even when option ID is repeated');
});

test('transport hierarchy has one current primary command, and observation changes fence the retained old command',()=>{
 const panel=new RobotControlPanel(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));const option=(action,label)=>({id:`opaque-${action}`,action,label,argsSchema:{kind:'none'}}),admitted={domain:'vacuum',options:[option('return','Til basen'),option('pause','Pause rengøring'),option('stop','Stop rengøring'),option('resume','Fortsæt rengøring'),task().options[1]]};panel.data={task:admitted,device:{...device,status:'cleaning'}};
 const commands=panel.querySelectorAll('button').filter(node=>node.dataset.actionId),primary=commands.filter(node=>node.className.split(' ').includes('pv-primary'));assert.equal(primary.length,1);assert.equal(primary[0].textContent,'Pause rengøring');assert.equal(commands[0],primary[0]);assert.equal(commands.find(node=>node.dataset.actionId==='resume').disabled,true);assert.equal(panel.querySelectorAll('details').find(node=>node.className.includes('settings')).open,false);assert.equal(panel.querySelectorAll('p').some(node=>/ikke tilbudt/.test(node.textContent)),false);
 panel.observed({...device,status:'paused'});assert.equal(primary[0].disabled,true);emit(primary[0],'click');assert.deepEqual(actions,[]);const resume=commands.find(node=>node.dataset.actionId==='resume');assert.equal(resume.disabled,false);assert.equal(resume.classList.contains('pv-primary'),true);assert.equal(resume.getAttribute('data-kit-variant'),'primary');assert.equal(primary[0].classList.contains('pv-primary'),false);assert.equal(primary[0].getAttribute('data-kit-variant'),'secondary');assert.equal(panel.transportControls.children[0],resume);assert.equal(panel.transportControls.querySelectorAll('button').length,commands.length);const retainedButtons=[...panel.transportControls.children];panel.observed({...device,status:'paused',battery:42});assert.deepEqual(panel.transportControls.children,retainedButtons);assert.equal(panel.transportControls.children.filter(node=>node.classList.contains('pv-primary')).length,1);emit(resume,'click');assert.deepEqual(actions,[{optionId:'opaque-resume',args:{}}]);
 for(const patch of [{stale:true},{pending:true}]){panel.observed({...device,status:'paused',...patch});assert.equal(resume.disabled,true);emit(resume,'click');}panel.observed({...device,status:'paused'},{connected:false});emit(resume,'click');assert.equal(actions.length,1);
});

test('expired task and local-only selection are explicit at the actual form boundary',()=>{
 const panel=new RobotControlPanel(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:{...task(),expiresAt:Date.now()/1000-1},device};const form=panel.querySelector('form');for(const room of form.querySelectorAll('[name=areaIds]'))room.checked=true;emit(form,'change');emit(form,'submit');assert.deepEqual(actions,[]);assert.ok(panel.querySelectorAll('button').every(button=>button.disabled));
 panel.data={task:task(),device,localOnly:true};const localForm=panel.querySelector('form');assert.equal(panel.cleaningSubmit.textContent,'Start rengøring');assert.equal(panel.observation.data.detail,'');assert.equal(panel.value.localOnly,true);assert.ok(!localForm.querySelectorAll('p').some(node=>/Kun lokalt|Gem valg lokalt/.test(node.textContent)));assert.equal(panel.value.localOnly,true);assert.deepEqual(actions,[]);
});


test('status owns the Robot Hero while observed battery, area and duration remain secondary ListRow facts',()=>{
 const at=Date.now()/1000,fact=(key,value,unit)=>({key,value,unit,updatedAt:at,stale:false});const panel=new RobotControlPanel();panel.data={task:task(),device:{...device,live:true,status:'cleaning',battery:76,telemetry:{status:'observed',items:[fact('cleaning_area',23,'m²'),fact('cleaning_time',18,'min'),fact('filter_time_left',40,'h')]}}};assert.equal(panel.observation.data.text,'Rengør');assert.equal(panel.observation.data.value,undefined);assert.match(panel.observation.data.detail,/Batteri 76 %/);assert.match(panel.observation.data.detail,/23 m²/);assert.match(panel.observation.data.detail,/18 min/);const maintenance=panel.care.querySelectorAll('div').find(node=>node.className.includes('robot-care-row'));assert.equal(maintenance.getAttribute('data-kit'),'listrow');panel.observed({...device,status:'docked',battery:76});assert.equal(panel.observation.data.text,'Ved basen');assert.equal(panel.observation.data.value,undefined);
});


test('only the exact pending robot command owns busy state while all commands stay disabled',()=>{
 const panel=new RobotControlPanel(),offered={domain:'vacuum',options:[{id:'pause-id',action:'pause',label:'Pause',argsSchema:{kind:'none'}},{id:'return-id',action:'return',label:'Til basen',argsSchema:{kind:'none'}},{id:'stop-id',action:'stop',label:'Stop',argsSchema:{kind:'none'}}]};
 panel.data={task:offered,device:{...device,status:'cleaning',pending:{action:'pause'}},connected:true};let buttons=panel.transportControls.querySelectorAll('button');
 assert.deepEqual(buttons.map(button=>button.getAttribute('aria-busy')),['true','false','false']);assert(buttons.every(button=>button.disabled));
 panel.observed({...device,status:'cleaning',pending:true});assert(buttons.every(button=>button.getAttribute('aria-busy')==='false'));
 panel.observed({...device,status:'cleaning'},{pendingOptionId:'return-id'});assert.deepEqual(buttons.map(button=>button.getAttribute('aria-busy')),['false','true','false']);assert(buttons.every(button=>button.disabled));
 panel.observed({...device,status:'cleaning'},{pendingOptionId:null});assert(buttons.every(button=>button.getAttribute('aria-busy')==='false'));assert.equal(buttons[0].disabled,false);
 panel.data={task:task(),device,connected:true,pendingOptionId:'fan-option'};const apply=panel.querySelectorAll('form')[1].querySelectorAll('button').at(-1);assert.equal(apply.getAttribute('aria-busy'),'true');assert.equal(panel.cleaningSubmit.getAttribute('aria-busy'),'false');assert.equal(apply.disabled,true);
});
