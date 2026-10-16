import test from 'node:test';
import assert from 'node:assert/strict';
// Minimal DOM port for actual form events and emitted arguments. Browser layout
// and native focus behavior remain a separate QA gate.
class Node extends EventTarget{
 constructor(tag='host'){super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.textContent='';this.value='';this.checked=false;if(tag!=='host')this.disabled=false;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(key,value){this[key]=value;}
 attachShadow(){this.shadowRoot=new Node('shadow');return this.shadowRoot;}
 querySelectorAll(selector){const matches=node=>selector.split(',').some(part=>{
  const attr=part.match(/\[([^=\]]+)=([^\]]+)\]/),tag=part.match(/^[a-z]+/i);
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
 const root=panel.shadowRoot,form=root.querySelector('form'),submit=form.querySelectorAll('button').at(-1),rooms=form.querySelectorAll('[name=areaIds]');assert.equal(submit.disabled,true);emit(form,'submit');assert.equal(actions.length,0);
 rooms[0].checked=true;const repeat=form.querySelectorAll('[name=repeat]');repeat[0].checked=false;repeat[2].checked=true;emit(form,'change');assert.equal(submit.disabled,false);
 panel.observed({...device,status:'cleaning',battery:42});assert.equal(root.querySelector('form'),form);assert.equal(rooms[0].checked,true);assert.equal(repeat[2].checked,true);assert.match(panel.observation.meta.textContent,/42 %/);
 emit(form,'submit');assert.deepEqual(actions,[{optionId:'start-option',args:{areaIds:['area-k'],repeat:3}}]);
 emit(form.querySelector('button'),'click');emit(form,'submit');assert.deepEqual(actions.at(-1).args.areaIds,['area-k','area-s']);
 emit(form.querySelector('button'),'click');assert.equal(submit.disabled,true);emit(form,'submit');assert.equal(actions.length,2);
});
test('setting choice uses its exact runtime ID and disabled controls cannot emit a command',()=>{
 const panel=new RobotControlPanel(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:task(),device};assert.doesNotMatch(panel.observation.meta.textContent,/Batteri/);
 const select=panel.shadowRoot.querySelector('select'),form=panel.shadowRoot.querySelectorAll('form')[1];assert.equal(select.querySelectorAll('option')[0].value,'');assert.deepEqual(select.querySelectorAll('option').slice(1).map(n=>n.value),['fan-quiet','fan-max']);
 select.value='fan-max';emit(select,'change');emit(form,'submit');assert.deepEqual(actions,[{optionId:'fan-option',args:{choiceId:'fan-max'}}]);panel.disabled=true;assert.ok(panel.shadowRoot.querySelectorAll('button').every(n=>n.disabled));assert.ok(panel.shadowRoot.querySelectorAll('input').every(n=>n.disabled));assert.equal(select.disabled,true);emit(form,'submit');assert.equal(actions.length,1);
});
test('supplied history does not create a parallel history or receipt actions inside robot controls',()=>{
 const panel=new RobotControlPanel(),actions=[],recipes=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.addEventListener('robot-control-recipe',event=>recipes.push(event.detail));
 const record={id:'recipe-accepted',recordedAt:1770000000,outcome:'accepted_by_ha',recipe:{mapName:'Stueetagen',areaIds:['kitchen'],repeat:2}};panel.data={task:{domain:'vacuum',options:[{id:'pause-opaque',label:'Pause rengøring',action:'pause',argsSchema:{kind:'none'}}]},device:{...device,status:'cleaning'},history:{status:'observed',items:[record,{...record,id:'recipe-unknown',outcome:'unknown'}]}};
 const root=panel.shadowRoot,buttons=root.querySelectorAll('button');assert.deepEqual(buttons.map(n=>n.textContent),['Pause rengøring']);assert.equal(root.querySelectorAll('article').length,0);assert.equal(root.querySelectorAll('details').length,0);assert.equal(root.querySelectorAll('summary').some(n=>n.textContent==='Seneste rengøringer'),false);assert.deepEqual(recipes,[]);assert.deepEqual(actions,[]);emit(buttons[0],'click');assert.deepEqual(actions,[{optionId:'pause-opaque',args:{}}]);
});
test('server-issued recipe reuse retains its primary exact-option action without a history renderer',()=>{
 const panel=new RobotControlPanel(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:{domain:'vacuum',options:[{id:'reuse-opaque',label:'Genbrug rengøring',action:'reuse',argsSchema:{kind:'none'}}]},device};
 const buttons=panel.shadowRoot.querySelectorAll('button');assert.deepEqual(buttons.map(n=>n.textContent),['Start denne rengøring']);emit(buttons[0],'click');assert.deepEqual(actions,[{optionId:'reuse-opaque',args:{}}]);panel.disabled=true;emit(buttons[0],'click');assert.equal(actions.length,1);
});

test('server-issued resume uses the existing canonical transport group and exact opaque choice',()=>{
 const panel=new RobotControlPanel(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:{domain:'vacuum',options:[{id:'resume-opaque',label:'Fortsæt rengøring',action:'resume',argsSchema:{kind:'none'}}]},device:{...device,status:'paused'}};
 const buttons=panel.shadowRoot.querySelectorAll('button');assert.deepEqual(buttons.map(b=>b.textContent),['Fortsæt rengøring']);emit(buttons[0],'click');assert.deepEqual(actions,[{optionId:'resume-opaque',args:{}}]);panel.disabled=true;emit(buttons[0],'click');assert.equal(actions.length,1);
});

test('a map-only admitted setting remains actionable without a contradictory empty-controls message',()=>{
 const panel=new RobotControlPanel(),actions=[];panel.addEventListener('robot-control-action',event=>actions.push(event.detail));panel.data={task:{domain:'vacuum',options:[{id:'map-opaque',label:'Kort',action:'set_option',argsSchema:{kind:'choice',choices:[{id:'upstairs-opaque',label:'1. Sal'}]}}]},device};
 const root=panel.shadowRoot;assert.equal(root.querySelectorAll('p').some(n=>n.textContent==='Områdevalg og indstillinger er ikke tilbudt i den aktuelle betjening.'),false);assert.equal(root.querySelector('details').open,true);
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
 const forms=panel.shadowRoot.querySelectorAll('form');assert.equal(forms.length,6);assert.ok(forms.every(form=>form.className==='setting'));const [volume,start,end]=forms;const field=volume.querySelector('input'),submit=volume.querySelector('button');
 assert.equal(field.type,'number');assert.equal(field.value,'90');assert.equal(field.min,'0');assert.equal(field.max,'100');assert.equal(field.step,'1');assert.equal(submit.disabled,true);assert.equal(start.querySelector('input').type,'time');assert.equal(start.querySelector('input').value,'22:00:00');assert.equal(end.querySelector('input').value,'08:00:00');
 emit(volume,'submit');emit(start,'submit');assert.deepEqual(intents,[]);field.value='75';emit(field,'input');assert.equal(submit.disabled,false);assert.deepEqual(intents,[]);panel.observed({...device,battery:90});assert.equal(panel.shadowRoot.querySelectorAll('form')[0],volume);assert.equal(field.value,'75');emit(volume,'submit');assert.deepEqual(intents,[{optionId:'volume-opaque',args:{value:75}}]);
 const clock=start.querySelector('input');clock.value='21:30';emit(clock,'change');assert.equal(start.querySelector('button').disabled,false);assert.equal(intents.length,1);emit(start,'submit');assert.deepEqual(intents.at(-1),{optionId:'dnd-start-opaque',args:{time:'21:30'}});assert.equal(end.querySelector('input').value,'08:00:00');
 panel.disabled=true;clock.value='20:00';emit(clock,'input');emit(start,'submit');assert.equal(intents.length,2);assert.ok(panel.shadowRoot.querySelectorAll('button,input,select').every(node=>node.disabled));
});
test('malformed draft values and unknown setting schemas never become bounded control intents',()=>{
 const admitted=typedSettings(),panel=new RobotControlPanel(),intents=[];panel.addEventListener('robot-control-action',event=>{try{intents.push(controlArgs(admitted,event.detail.optionId,event.detail.args,settingNow));}catch{}});panel.data={task:admitted,device};const [volume,start]=panel.shadowRoot.querySelectorAll('form'),number=volume.querySelector('input'),clock=start.querySelector('input');
 for(const value of ['','NaN','Infinity','-1','101','75.5']){number.value=value;emit(number,'input');emit(volume,'submit');}
 for(const time of ['24:00','21:60','21:30Z','2026-10-16T21:30','21:30\n','21:30:00\r\n']){clock.value=time;emit(clock,'change');emit(start,'submit');}assert.deepEqual(intents,[]);
 number.value='90';emit(number,'change');assert.equal(volume.querySelector('button').disabled,true);emit(volume,'submit');assert.deepEqual(intents,[]);
 panel.data={task:{domain:'vacuum',options:[{id:'unknown',label:'Ukendt',action:'set_option',argsSchema:{kind:'unknown'}}]},device};assert.equal(panel.shadowRoot.querySelectorAll('form').length,0);
});
