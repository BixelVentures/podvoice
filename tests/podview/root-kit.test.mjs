import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {KIT_COMPONENTS,createKitComponent,applyKitComponent,createKitTemplate,applyKitTemplate,applyKitDialog,createKitDialog,syncKitSlider} from '../../podview/ui/kit.js';
class Element extends EventTarget{
 constructor(tag){super();this.tagName=tag.toUpperCase();this.className='';this.attributes=new Map();this.dataset={};this.children=[];if(['BUTTON','INPUT'].includes(this.tagName))this.disabled=false;}
 setAttribute(name,value){this.attributes.set(name,String(value));if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
 getAttribute(name){return this.attributes.get(name)??null;}
 append(...nodes){this.children.push(...nodes);}
}
const document={createElement:tag=>new Element(tag)};
test('discovery Chips and overview Timer cancellation retain the canonical64px target and body text',()=>{
 const css=readFileSync(new URL('../../podview/ui-kit.css',import.meta.url),'utf8');
 assert.match(css,/--pv-hit:64px/);
 assert.ok(css.includes('pv-widget-host #music-refinements>button[data-kit=chip]{height:var(--pv-hit);min-height:var(--pv-hit);padding-block:0;font:var(--pv-t-body)}'));
 assert.ok(css.includes('pv-widget-host #now-view #timer-card .timer-active-list .timer-panel .timer-finish{height:var(--pv-hit);min-height:var(--pv-hit);padding:0 var(--pv-s3);font:var(--pv-t-body)}'));
 assert.match(css,/#timers-view :is\(\.timer-create,\.timer-running \.timer-panel\)\{[^}]*background:var\(--pv-dark\);color:var\(--pv-on-dark\)/,'Timer remains dark in both setup and active detail');
});
test('presentation update retains child identity, owner listener and author-owned state through loading, selection and repeated updates',()=>{
 const row=createKitComponent('tile',{document,className:'owned-room',identity:'robot',label:'Køkken'}),child=document.createElement('span');row.append(child);row.resourceId='room-kitchen';let clicks=0;row.addEventListener('click',()=>clicks++);
 for(let i=0;i<3;i++)applyKitComponent(row,'tile',{selected:true,loading:true,disabled:false});
 assert.equal(row.children[0],child);assert.equal(row.resourceId,'room-kitchen');row.dispatchEvent(new Event('click'));assert.equal(clicks,1);assert.equal(row.getAttribute('aria-pressed'),'true');assert.equal(row.getAttribute('aria-busy'),'true');assert.equal(row.disabled,false);
 applyKitComponent(row,'tile',{loading:false,disabled:true});assert.equal(row.children[0],child);assert.equal(row.getAttribute('aria-busy'),'false');assert.equal(row.disabled,true);assert.equal(row.getAttribute('aria-pressed'),'true');assert.equal(row.className.split(' ').filter(name=>name==='pv-kit-tile').length,1);
});
test('native control semantics and identity admission are shared without installing effect listeners',()=>{
 const toggle=createKitComponent('toggle',{document,selected:false,label:'Køkken'});assert.equal(toggle.getAttribute('role'),'switch');assert.equal(toggle.getAttribute('aria-checked'),'false');assert.equal(toggle.type,'button');
 const slider=createKitComponent('slider',{document});assert.equal(slider.type,'range');assert.equal(slider.min,'0');assert.equal(slider.max,'100');
 assert.equal(createKitComponent('card',{document,identity:'vejr'}).dataset.kitIdentity,'weather');assert.throws(()=>createKitComponent('hero',{document,identity:'custom-red'}),/Unknown kit identity/);
 assert.throws(()=>createKitComponent('new-device-family',{document}),/Unknown kit component/);
});
test('template decoration preserves domain content and public inventory has exactly twelve entries',()=>{
 const shell=createKitTemplate('detail',{document,className:'owned-detail'}),content=document.createElement('section');shell.append(content);applyKitTemplate(shell,'detail');assert.equal(shell.children[0],content);assert.equal(shell.dataset.kitTemplate,'detail');assert.match(shell.className,/owned-detail/);assert.equal(KIT_COMPONENTS.length,12);assert.equal(new Set(KIT_COMPONENTS.map(item=>item.id)).size,12);assert.throws(()=>createKitTemplate('other',{document}),/Unknown kit template/);
});

test('unchanged component and template renders perform zero DOM writes with native class and data reflection',()=>{
 const writes=[];class ObservedElement extends Element{
  constructor(tag){super(tag);this.classList={contains:token=>this.className.split(' ').includes(token),add:(...tokens)=>{writes.push('class');this.className=[...new Set([...this.className.split(' ').filter(Boolean),...tokens])].join(' ');}};Object.defineProperty(this,'disabled',{configurable:true,get:()=>this._disabled??false,set:value=>{writes.push('disabled');this._disabled=value;}});}
  setAttribute(name,value){writes.push(name);super.setAttribute(name,value);}
 }
 const observedDocument={createElement:tag=>new ObservedElement(tag)},options={document:observedDocument,identity:'robot',variant:'default',label:'Køkken',selected:true,loading:false,disabled:false},node=createKitComponent('toggle',options);
 applyKitTemplate(node,'detail');writes.length=0;
 for(let i=0;i<5;i++){applyKitComponent(node,'toggle',options);applyKitTemplate(node,'detail');}
 assert.deepEqual(writes,[]);
 applyKitComponent(node,'toggle',{loading:true});assert.deepEqual(writes,['aria-busy']);writes.length=0;
 applyKitComponent(node,'toggle',{loading:true});assert.deepEqual(writes,[]);
});
test('unchanged render also leaves className untouched for minimal host DOM implementations',()=>{
 const node=createKitComponent('tile',{document,selected:true,loading:false,disabled:false});let writes=0;let className=node.className;Object.defineProperty(node,'className',{get:()=>className,set:value=>{writes++;className=value;}});const original=node.setAttribute.bind(node);node.setAttribute=(...args)=>{writes++;original(...args);};
 applyKitComponent(node,'tile',{selected:true,loading:false,disabled:false});assert.equal(writes,0);
});

test('dialog decoration preserves native form submission and retained owner handlers without repeated writes',()=>{
 const dialog=document.createElement('dialog'),header=document.createElement('header'),content=document.createElement('div'),actions=document.createElement('footer'),close=document.createElement('button'),form=document.createElement('form');
 form.method='dialog';close.type='submit';close.value='cancel';dialog.id='rooms';form.append(header,content,actions);header.append(close);dialog.append(form);let closed=0;close.addEventListener('click',()=>closed++);
 const parts={header,content,actions,close};applyKitDialog(dialog,parts);
 const nodes=[dialog,header,content,actions,close],writes=[];
 for(const node of nodes){const original=node.setAttribute.bind(node);node.setAttribute=(...args)=>{writes.push(args);original(...args);};let value=node.className;Object.defineProperty(node,'className',{get:()=>value,set:next=>{writes.push('class');value=next;}});}
 applyKitDialog(dialog,parts);assert.deepEqual(writes,[]);assert.equal(dialog.children[0],form);assert.equal(form.method,'dialog');assert.equal(close.type,'submit');assert.equal(close.value,'cancel');assert.equal(dialog.id,'rooms');close.dispatchEvent(new Event('click'));assert.equal(closed,1);assert.match(actions.className,/pv-dialog-actions/);
});
test('dialog and toast recipes expose shared retained parts without inventing confirmation or timer actions',()=>{
 const dialog=createKitDialog({document,title:'Højttalere',description:'Vælg højttaler til din musik.'});
 assert.equal(dialog.dataset.kit,'dialog');assert.equal(dialog.dialogParts.heading.textContent,'Højttalere');assert.match(dialog.dialogParts.header.className,/pv-dialog-header/);assert.match(dialog.dialogParts.content.className,/pv-dialog-content/);assert.equal(dialog.dialogParts.close.type,'button');assert.equal(dialog.dialogParts.actions,undefined);
 const toast=createKitDialog({document,variant:'toast',message:'Forbindelsen er tilbage.'});
 assert.equal(toast.tagName,'P');assert.equal(toast.children.length,1);assert.equal(toast.children[0].tagName,'SPAN');assert.equal(toast.dialogParts.content.textContent,'Forbindelsen er tilbage.');assert.equal(toast.dialogParts.close,undefined);assert.equal(toast.dialogParts.header,undefined);
});


test('native Slider fill follows its actual bounded value on owner refresh and input without effects or repeated writes',()=>{
 const slider=document.createElement('input'),writes=[];slider.style={values:new Map(),getPropertyValue(key){return this.values.get(key)||'';},setProperty(key,value){this.values.set(key,value);writes.push([key,value]);}};
 slider.min='20';slider.max='80';slider.value='35';let actions=0;slider.addEventListener('change',()=>actions++);
 applyKitComponent(slider,'slider');assert.equal(slider.style.getPropertyValue('--pv-slider-progress'),'25%');
 writes.length=0;applyKitComponent(slider,'slider');assert.deepEqual(writes,[]);
 slider.value='65';slider.dispatchEvent(new Event('input'));assert.equal(slider.style.getPropertyValue('--pv-slider-progress'),'75%');assert.equal(actions,0);
 slider.value='100';assert.equal(syncKitSlider(slider),100);slider.value='0';assert.equal(syncKitSlider(slider),0);assert.equal(actions,0);
});


test('canonical native control dialog keeps 520px frame and 32px kit padding including narrow viewport rule',()=>{
 const css=readFileSync(new URL('../../podview/ui/library/library.css',import.meta.url),'utf8');
 const rule=css.match(/dialog\.pv-component\{([^}]+)\}/)[1];
 assert.match(rule,/width:min\(520px,calc\(100vw - 32px\)\)/);assert.match(rule,/padding:var\(--pv-s4\)/);assert.match(rule,/margin:auto/);assert.match(rule,/overflow:auto/);
 const narrow=css.match(/@media\(max-width:520px\)\{dialog\.pv-component\{([^}]+)\}/)[1];assert.match(narrow,/padding:var\(--pv-s4\)/);assert.doesNotMatch(narrow,/--pv-s3/);
 const kit=readFileSync(new URL('../../podview/ui-kit.css',import.meta.url),'utf8');assert.match(kit,/--pv-s4:32px/);
});
