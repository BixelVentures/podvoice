import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SpeakerOutputView} from '../../podvoice/gatekeeper/static/podview/speaker-output-view.js';
import {applyKitDialog} from '../../podvoice/gatekeeper/static/podview/ui/kit.js';

// Native-like document order and parent ownership matter here: a direct child
// of a grid Dialog is a separate track. Layout remains a browser QA gate.
class NativeNode extends EventTarget{
 constructor(tag,document){super();this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.parentNode=null;this.attributes=new Map();this.dataset={};this.className='';this._text='';if(this.tagName==='BUTTON')this.disabled=false;this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(' ');}};}
 get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
 set textContent(value){this._text=String(value);for(const node of this.children)node.parentNode=null;this.children=[];}
 append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
 prepend(...nodes){for(const node of [...nodes].reverse()){node.remove();node.parentNode=this;this.children.unshift(node);}}
 replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this._text='';this.append(...nodes);}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
 setAttribute(name,value){this.attributes.set(name,String(value));if(name==='class')this.className=String(value);if(name==='id')this.id=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
 getAttribute(name){return name==='class'?this.className:this.attributes.get(name)??null;}
 matches(selector){const tag=selector.match(/^[a-z][a-z0-9-]*/i)?.[0],classes=[...selector.matchAll(/\.([a-z0-9-]+)/gi)].map(match=>match[1]),id=selector.match(/#([a-z0-9-]+)/i)?.[1];return (!tag||this.tagName===tag.toUpperCase())&&classes.every(name=>this.classList.contains(name))&&(!id||this.id===id);}
 querySelectorAll(selector){return this.children.flatMap(node=>[...(selector.split(',').some(part=>node.matches(part.trim()))?[node]:[]),...node.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 click(){if(!this.disabled)this.dispatchEvent(new Event('click',{cancelable:true}));}
}
function fixture({existingActions=false}={}){
 const doc={createElement:tag=>new NativeNode(tag,doc)},rooms=doc.createElement('dialog'),form=doc.createElement('form'),header=doc.createElement('header'),title=doc.createElement('h2'),close=doc.createElement('button'),note=doc.createElement('p'),rows=doc.createElement('div');rooms.id='rooms';title.id='room-title';rows.id='room-options';form.setAttribute('method','dialog');header.append(title,close);form.append(header,note,rows);rooms.append(form);doc.getElementById=id=>rooms.id===id?rooms:rooms.querySelector('#'+id);
 applyKitDialog(rooms,{header,description:note,content:rows,close});
 let actions;if(existingActions){actions=doc.createElement('div');actions.className='pv-dialog-actions';form.append(actions);}
 const calls=[],effects=[],host={isConnected:true,ownerDocument:doc,liveSnapshot:{bootId:'boot',roomId:'room',capabilities:{musicRead:['targets']}},liveMedia:{account:'account'},liveTransport:{connected:true,music:async(...args)=>{calls.push(args);return {ok:true,schema:'podview.speaker-catalogue.v1',bootId:'boot',roomId:'room',accountId:'account',status:'observed',catalogueId:'c'.repeat(64),retrievedAt:Date.now()/1000,source:'podconnect.get_targets',speakers:[{speakerId:'a'.repeat(64),accountId:'account',kind:'configured_alias',nativeRoomId:'native-room',homepodId:'42',name:'Køkken',availability:'available',default:true,nativeSelected:true,outputSelected:false,selectable:false}],moveAvailable:false,physicalResultVerified:false};},controlAction:(...args)=>effects.push(args)},liveControls:{musicContext:()=>null,moveSpeaker:(...args)=>effects.push(args)}};
 const view=new SpeakerOutputView(host);return {doc,rooms,form,header,note,rows,actions,host,view,calls,effects};
}
for(const existingActions of [false,true])test(`speaker refresh belongs to one canonical actions slot inside the dialog form; existing slot=${existingActions}`,t=>{
 const f=fixture({existingActions});t.after(()=>f.view.cleanup());const actions=f.form.querySelector('.pv-dialog-actions');assert.ok(actions,'refresh uses the shared Dialog actions anatomy');assert.equal(f.view.refresh.parentNode,actions,'refresh cannot create a second stretchable direct Dialog track');assert.equal(actions.parentNode,f.form);assert.equal(f.rooms.children.includes(f.view.refresh),false);assert.deepEqual(f.rooms.children,[f.form]);assert.equal(f.form.querySelectorAll('.pv-dialog-actions').length,1);if(existingActions)assert.equal(actions,f.actions,'an existing canonical footer is reused');assert.deepEqual(actions.querySelectorAll('button'),[f.view.refresh]);assert.equal(f.view.refresh.type,'button','refresh cannot submit or close the dialog form');assert.equal(f.view.refresh.dataset.kit,'button');assert.equal(f.view.refresh.textContent,'Opdater liste');assert.deepEqual(f.calls,[]);assert.deepEqual(f.effects,[]);
});
test('relocated refresh retains one explicit passive catalogue read and no playback or device effect',async t=>{
 const f=fixture();t.after(()=>f.view.cleanup());assert.deepEqual(f.calls,[]);f.view.refresh.click();f.view.refresh.click();assert.deepEqual(f.calls,[['speakers','account']],'pending repeated activation cannot duplicate the read');assert.equal(f.view.refresh.disabled,true);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.view.refresh.disabled,false);assert.equal(f.rows.children.length,1);assert.equal(f.rows.children[0].disabled,true);assert.equal(f.rows.children[0].dataset.speakerId,'a'.repeat(64));assert.deepEqual(f.effects,[]);assert.equal(f.host.liveSnapshot.roomId,'room');
});
test('shared non-toast Dialog and its immediate form use intrinsic content tracks',async()=>{
 const css=await readFile(new URL('../../podvoice/gatekeeper/static/podview/ui-kit.css',import.meta.url),'utf8'),rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([,selector,body])=>({selector:selector.trim(),body})),intrinsic=rule=>/height\s*:\s*fit-content/.test(rule.body)&&/min-height\s*:\s*0/.test(rule.body)&&/grid-auto-rows\s*:\s*max-content/.test(rule.body)&&/align-content\s*:\s*start/.test(rule.body);
 assert.ok(rules.some(rule=>rule.selector.includes('.pv-kit-dialog')&&rule.selector.includes('toast')&&!rule.selector.includes('#quick-sheet')&&intrinsic(rule)),'content sizing belongs to the canonical non-toast Dialog, not only the settings sheet');assert.ok(rules.some(rule=>/\.pv-kit-dialog\s*>\s*form/.test(rule.selector)&&/grid-auto-rows\s*:\s*max-content/.test(rule.body)&&/align-content\s*:\s*start/.test(rule.body)),'the retained method=dialog form also uses content tracks');
});
