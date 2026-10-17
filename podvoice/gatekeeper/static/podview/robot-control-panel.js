const make=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
// Presentation follows admitted options, never an assumed Roborock model or service.
export function robotControlGroups(task){
 const options=task?.domain==='vacuum'?task.options||[]:[];
 return {cleaning:options.find(o=>o.action==='start'&&o.argsSchema.kind==='cleaning')||null,settings:options.filter(o=>o.action==='set_option'&&['choice','number','time'].includes(o.argsSchema.kind)),transport:options.filter(o=>['resume','pause','return','stop'].includes(o.action)&&o.argsSchema.kind==='none'),reuse:options.find(o=>o.action==='reuse'&&o.argsSchema.kind==='none')||null};
}
const statusText=device=>(device?.stale?'Sidst kendt: ':'')+(({cleaning:'Rengør',paused:'Rengøring på pause',docking:'På vej til basen',docked:'Ved basen',stopped:'Klar til rengøring',fault:'Robotten melder en fejl',unavailable:'Ikke tilgængelig',unknown:'Status ukendt'})[device?.status]||'Status ukendt');
export class RobotControlPanel extends (globalThis.HTMLElement||class{}){
 constructor(){super();this.content=make('div',undefined,'pv-component');}
 set data(value){this.value=value;this.build();}
 set disabled(value){this._disabled=!!value;this.syncDisabled();}
 syncDisabled(){for(const el of this.querySelectorAll('button,input,select'))el.disabled=this._disabled||el.dataset.unready==='true';}
 emit(name,detail){if(this._disabled)return;this.dispatchEvent(new CustomEvent(name,{detail,bubbles:true,composed:true}));}
 observed(device){this.value={...this.value,device};this.updateObservation();}
 updateObservation(){const d=this.value?.device;if(!this.observation)return;this.observation.data={title:d?.name||'Robot',text:statusText(d),detail:[Number.isFinite(d?.battery)?`Batteri ${d.battery} %`:null,d?.stale?'Sidst kendte status':null].filter(Boolean).join(' · '),actions:[]};}
 action(option,args={}){this.emit('robot-control-action',{optionId:option.id,args});}
 build(){
  const {task,device}=this.value||{},groups=robotControlGroups(task);this.replaceChildren(this.content);this.content.replaceChildren();
  // Reuse the canonical robot instrument; this adapter adds only admitted native controls.
  this.observation=make('pv-vacuum-widget');this.content.append(this.observation);this.updateObservation();
  if(groups.transport.length){const section=make('section',undefined,'device-history'),buttons=make('div',undefined,'pv-actions transport');section.append(make('h3','Aktuel rengøring'));for(const option of groups.transport){const button=make('button',option.label,option.action==='stop'?'pv-button pv-ghost stop':['pause','resume'].includes(option.action)?'pv-button pv-primary':'pv-button');button.type='button';button.addEventListener('click',()=>this.action(option));buttons.append(button);}section.append(buttons);this.content.append(section);}
  if(groups.reuse){const section=make('section',undefined,'device-history');section.append(make('h3','Gentag den valgte rengøring'),make('p','Den tidligere opsætning kontrolleres mod robotten og det aktuelle kort.','pv-meta history-note'));const button=make('button','Start denne rengøring','pv-button pv-primary start');button.type='button';button.addEventListener('click',()=>this.action(groups.reuse));section.append(button);this.content.append(section);}
  if(groups.cleaning)this.buildCleaning(groups.cleaning,task.mapName);
  if(groups.settings.length){const details=make('details',undefined,'device-history settings');details.open=!groups.cleaning;details.append(make('summary','Indstillinger'),make('p','Anvend én indstilling ad gangen. Hent derefter den aktuelle betjening, før du ændrer mere eller starter rengøringen.','pv-meta'));for(const option of groups.settings)this.buildSetting(details,option);this.content.append(details);}
  if(!groups.cleaning&&!groups.reuse&&!groups.settings.length)this.content.append(make('p','Områdevalg og indstillinger er ikke tilbudt i den aktuelle betjening.','pv-meta empty'));
  else if(!groups.settings.length&&!groups.reuse)this.content.append(make('p','Sugestyrke og moppeindstillinger er ikke tilbudt i den aktuelle betjening.','pv-meta empty'));
  this.syncDisabled();
 }
 buildCleaning(option,mapName){
  const schema=option.argsSchema,section=make('section',undefined,'device-history'),form=make('form'),heading=make('div',undefined,'heading'),all=make('button','Vælg alle','pv-button pv-ghost');all.type='button';heading.append(all);form.append(heading);if(mapName)form.append(make('p',mapName,'pv-meta'));const choices=make('fieldset',undefined,'choices');choices.append(make('legend','Vælg områder'));for(const area of schema.areas){const label=make('label',undefined,'choice'),input=make('input');input.type='checkbox';input.name='areaIds';input.value=area.id;label.append(input,make('span',area.label));choices.append(label);}form.append(choices);
  const repeat=make('fieldset',undefined,'repeat');repeat.append(make('legend','Antal rengøringer'));for(let n=schema.repeat.min;n<=schema.repeat.max;n++){const label=make('label',undefined,'choice'),input=make('input');input.type='radio';input.name='repeat';input.value=String(n);input.checked=n===schema.repeat.min;label.append(input,make('span',`${n} ${n===1?'gang':'gange'}`));repeat.append(label);}const summary=make('p','Vælg mindst ét område','summary'),submit=make('button','Start rengøring','pv-button pv-primary start');submit.type='submit';submit.dataset.unready='true';form.append(repeat,summary,submit);
  const update=()=>{const selected=[...choices.querySelectorAll(':checked')],count=Number(form.querySelector('[name=repeat]:checked').value);summary.textContent=selected.length?`${selected.length===schema.areas.length?'Alle områder':selected.map(el=>schema.areas.find(a=>a.id===el.value).label).join(', ')} · ${count} ${count===1?'gang':'gange'}`:'Vælg mindst ét område';submit.dataset.unready=String(!selected.length);all.textContent=selected.length===schema.areas.length?'Fjern alle':'Vælg alle';this.syncDisabled();};
  form.addEventListener('change',update);all.addEventListener('click',()=>{const checked=choices.querySelectorAll(':checked').length!==schema.areas.length;for(const input of choices.querySelectorAll('input'))input.checked=checked;update();});form.addEventListener('submit',event=>{event.preventDefault();const areaIds=[...choices.querySelectorAll(':checked')].map(x=>x.value);if(areaIds.length)this.action(option,{areaIds,repeat:Number(form.querySelector('[name=repeat]:checked').value)});});section.append(form);this.content.append(section);
 }
 buildSetting(parent,option){
  const schema=option.argsSchema,form=make('form',undefined,'setting'),select=make(schema.kind==='choice'?'select':'input');select.required=true;select.setAttribute('aria-label',option.label+(schema.kind==='number'?` (${schema.unit})`:''));
  if(schema.kind==='choice'){const placeholder=make('option','Vælg indstilling');placeholder.value='';placeholder.disabled=true;placeholder.selected=true;select.append(placeholder);for(const choice of schema.choices){const row=make('option',choice.label);row.value=choice.id;select.append(row);}}
  else{select.type=schema.kind;select.value=String(schema.current);if(schema.kind==='number'){select.min=String(schema.min);select.max=String(schema.max);select.step=String(schema.step);}else select.step='1';}
  const submit=make('button',`Anvend ${option.label.toLocaleLowerCase('da-DK')}`,'pv-button');submit.type='submit';submit.dataset.unready='true';
  for(const type of ['input','change'])select.addEventListener(type,()=>{const valid=schema.kind==='choice'?schema.choices.some(choice=>choice.id===select.value):schema.kind==='number'?Number.isFinite(select.valueAsNumber)&&select.valueAsNumber>=schema.min&&select.valueAsNumber<=schema.max&&select.valueAsNumber!==schema.current&&select.checkValidity?.()!==false:/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(select.value)&&(select.value.length===5||select.value.length===8)&&select.value!==schema.current;submit.dataset.unready=String(!valid);this.syncDisabled();});
  form.append(make('h4',option.label+(schema.kind==='number'?` (${schema.unit})`:'')),select,submit);
  form.addEventListener('submit',event=>{event.preventDefault();if(this._disabled||submit.dataset.unready==='true')return;const valid=schema.kind==='choice'?schema.choices.some(choice=>choice.id===select.value):schema.kind==='number'?Number.isFinite(select.valueAsNumber)&&select.valueAsNumber>=schema.min&&select.valueAsNumber<=schema.max&&select.valueAsNumber!==schema.current&&select.checkValidity?.()!==false:/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(select.value)&&(select.value.length===5||select.value.length===8)&&select.value!==schema.current;if(valid)this.action(option,schema.kind==='choice'?{choiceId:select.value}:schema.kind==='number'?{value:select.valueAsNumber}:{time:select.value});});parent.append(form);
 }

}
if(globalThis.customElements&&!customElements.get('pv-robot-control-panel'))customElements.define('pv-robot-control-panel',RobotControlPanel);
