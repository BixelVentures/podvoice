import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base=new URL('../../podvoice/gatekeeper/static/podview/',import.meta.url);
let source=readFileSync(new URL('live-control-view.js',base),'utf8');
// Actual view and actual args/task validator; inert presentation ports, no transport.
source=source.replace("from './home-model.js'",`from '${new URL('home-model.js',base).href}'`).replace("from './robot-observation.js'",`from '${new URL('robot-observation.js',base).href}'`).replace("from './ha-home-observation.js'",`from '${new URL('ha-home-observation.js',base).href}'`).replace("import {renderPlayerControls} from './player-view.js';",'const renderPlayerControls=()=>{};').replace("from './ui/kit.js'",`from '${new URL('ui/kit.js',base).href}'`).replace("from './control-model.js'",`from '${new URL('control-model.js',base).href}'`).replace("from './media-observation.js'",`from '${new URL('media-observation.js',base).href}'`).replace("import './robot-control-panel.js';",'');
const {LiveControlView}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
class Node extends EventTarget {
 constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.isConnected=true;this.open=false;this.textContent='';this.disabled=false;}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
 after(){} setAttribute(name,value){this[name]=String(value);}
 getAttribute(name){return this[name]??null;}
 replaceChildren(...nodes){for(const node of this.children)node.parent=null;this.children=[];this.append(...nodes);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;}
 focus(){document.activeElement=this;} showModal(){this.open=true;}
 close(){this.open=false;this.dispatchEvent(new Event('close'));}
 querySelectorAll(selector){const tags=selector.split(',').map(x=>x.toUpperCase());return this.children.flatMap(n=>[...(tags.includes(n.tagName)?[n]:[]),...n.querySelectorAll(selector)]);}
 querySelector(s){return this.querySelectorAll(s)[0]||null;}
 set data(value){this.value=value;if(this.tagName==='PV-ROBOT-CONTROL-PANEL'){const field=new Node('input');field.checked=false;this.replaceChildren(field);}}
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {resolve,reject,promise}};
const target={entityId:'vacuum.actual'};
function fixture(){
 globalThis.document={createElement:tag=>new Node(tag),getElementById:()=>new Node('div'),activeElement:null,body:new Node('body')};
 const host=new Node('host');host.querySelector=()=>null;host.state={devices:[{id:target.entityId,kind:'vacuum',live:true,stale:false}]};
 host.liveSnapshot={bootId:'boot',roomId:'room',capabilities:{controlSetup:['vacuum']}};
 let reads=0,writes=0;const next=deferred();
 const offer=id=>({ok:true,schema:'podview.control.v1',roomId:'room',bootId:'boot',domain:'vacuum',taskId:id,revision:1,expiresAt:Date.now()/1000+15,options:[{id:id+'-start',action:'start',label:'Start',argsSchema:{kind:'cleaning',areas:[{id:id+'-area',label:'Same label'}],repeat:{min:1,max:3}}}],setup:{mapName:'Same map'}});
 host.liveTransport={connected:true,controlSetup:()=>{reads++;return reads===1?Promise.resolve(offer('old')):next.promise},controlAction:()=>{writes++;return Promise.resolve({ok:true,outcome:'accepted'})}};
 const view=new LiveControlView(host);
 return {host,view,next,offer,reads:()=>reads,writes:()=>writes};
}
async function open(f){await f.view.open('vacuum',target,new Node('button'));}
function expire(f){f.view.task.expiresAt=Date.now()/1000-1;f.view.render();}

function inline(f){f.host.state.focus=target.entityId;f.view.robotInline=true;f.view.robotEntry=new Node('section');f.view.robotEntry.hidden=false;}
test('renewal preserves live task and panel until validated atomic replacement',async()=>{const f=fixture();try{await open(f);inline(f);const old=f.view.task,panel=f.view.robotPanel,reading=f.view.renewRobotTask(old);assert.equal(f.view.task,old);assert.equal(panel.disabled,false);assert.equal(f.view.robotPanel,panel);assert.equal(f.reads(),2);f.next.resolve(f.offer('fresh'));await reading;assert.equal(f.view.task.taskId,'fresh');assert.equal(f.view.robotPanel,panel);assert.equal(f.writes(),0);}finally{f.view.cleanup();}});
for(const changed of ['expired','operation','context','unknown'])test('renewal discards response on '+changed,async()=>{const f=fixture();try{await open(f);inline(f);const old=f.view.task,reading=f.view.renewRobotTask(old);if(changed==='expired')old.expiresAt=Date.now()/1000-1;else if(changed==='operation')f.view.pending=true;else if(changed==='context')f.host.liveSnapshot.bootId='new';else f.view.receipts.set('x',{bootId:'boot',roomId:'room',domain:'vacuum',target,outcome:'unknown'});f.next.resolve(f.offer('fresh'));await reading;assert.equal(f.view.task,old);assert.equal(f.writes(),0);if(changed==='expired'){await f.view.send('old-start',{areaIds:['old-area'],repeat:1});assert.equal(f.writes(),0);}}finally{f.view.cleanup();}});
test('dirty draft is remapped by owner only and late user changes reject response',async()=>{const f=fixture();try{await open(f);inline(f);const panel=f.view.robotPanel,old=f.view.task;let repeat=1;panel.cleaningDirty=true;panel.cleaningOptionId='old-start';panel.readCleaningDraft=()=>({areaIds:['old-area'],repeat,settingChoices:[]});let request;f.host.liveTransport.controlSetup=(domain,target,recipe,options)=>{request=options;return f.next.promise};const reading=f.view.renewRobotTask(old);assert.equal(request.draft.repeat,1);repeat=2;const next=f.offer('fresh');next.setup.draft={status:'restored',optionId:'fresh-start',areaIds:['fresh-area'],repeat:1,settingChoices:[]};f.next.resolve(next);await reading;assert.equal(f.view.task,old);assert.equal(f.writes(),0);}finally{f.view.cleanup();}});

test('passive robot status changes do not reset the open detail scroll position',async()=>{
 const f=fixture(),feed={scrollTop:137};try{await open(f);inline(f);f.host.querySelector=selector=>selector==='#device-view'?feed:null;const device=f.host.state.devices[0];device.status='cleaning';f.view.render();device.status='paused';f.view.render();assert.equal(feed.scrollTop,137);}finally{f.view.cleanup();}
});

test('changed draft performs at most one bounded read retry without sending a command',async()=>{const f=fixture();try{await open(f);inline(f);const old=f.view.task,panel=f.view.robotPanel,first=deferred(),second=deferred(),requests=[];let count=1;panel.cleaningDirty=true;panel.cleaningOptionId='old-start';panel.readCleaningDraft=()=>({areaIds:['old-area'],repeat:count,settingChoices:[]});f.host.liveTransport.controlSetup=(domain,target,recipe,options)=>{requests.push(options.draft);return requests.length===1?first.promise:second.promise};const reading=f.view.renewRobotTask(old);count=2;const one=f.offer('fresh1');one.setup.draft={status:'restored',optionId:'fresh1-start',areaIds:['fresh1-area'],repeat:1,settingChoices:[]};first.resolve(one);await reading;assert.equal(f.view.task,old);await new Promise(resolve=>setTimeout(resolve,300));assert.equal(requests.length,2);assert.equal(requests[1].repeat,2);count=3;const two=f.offer('fresh2');two.setup.draft={status:'restored',optionId:'fresh2-start',areaIds:['fresh2-area'],repeat:2,settingChoices:[]};second.resolve(two);await new Promise(resolve=>setTimeout(resolve,300));assert.equal(requests.length,2);assert.equal(f.view.task,old);assert.equal(f.writes(),0);}finally{f.view.cleanup();}});

test('draft-change retry cannot reissue after scope changes',async()=>{const f=fixture();try{await open(f);inline(f);const old=f.view.task,panel=f.view.robotPanel,first=deferred();let count=1,reads=0;panel.cleaningDirty=true;panel.cleaningOptionId='old-start';panel.readCleaningDraft=()=>({areaIds:['old-area'],repeat:count,settingChoices:[]});f.host.liveTransport.controlSetup=()=>{reads++;return first.promise};const reading=f.view.renewRobotTask(old);count=2;const response=f.offer('fresh');response.setup.draft={status:'restored',optionId:'fresh-start',areaIds:['fresh-area'],repeat:1,settingChoices:[]};first.resolve(response);await reading;f.host.liveSnapshot.bootId='other';await new Promise(resolve=>setTimeout(resolve,300));assert.equal(reads,1);assert.equal(f.writes(),0);}finally{f.view.cleanup();}});
