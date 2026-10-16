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
