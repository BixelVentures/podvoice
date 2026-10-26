import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base=new URL('../../podvoice/gatekeeper/static/podview/',import.meta.url);
let source=readFileSync(new URL('live-control-view.js',base),'utf8');
// Actual view and actual args/task validator; inert presentation ports, no transport.
source=source.replace("from './robot-observation.js'",`from '${new URL('robot-observation.js',base).href}'`).replace("from './ha-home-observation.js'",`from '${new URL('ha-home-observation.js',base).href}'`).replace("import {renderPlayerControls} from './player-view.js';",'const renderPlayerControls=()=>{};').replace("from './ui/kit.js'",`from '${new URL('ui/kit.js',base).href}'`).replace("from './control-model.js'",`from '${new URL('control-model.js',base).href}'`).replace("from './media-observation.js'",`from '${new URL('media-observation.js',base).href}'`).replace("import './robot-control-panel.js';",'');
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
test('expiry offers explicit refresh; read retains disabled draft and success retains the panel while resetting incompatible draft/focus onto fresh IDs',async()=>{
 const f=fixture();try{await open(f);const old=f.view.robotPanel;old.querySelector('input').checked=true;expire(f);assert.equal(f.reads(),1);assert.ok(f.view.refreshButton,'expiry needs in-dialog recovery');assert.equal(old.disabled,true);f.view.refreshButton.focus();const reading=f.view.refreshRobot();assert.equal(f.reads(),2);assert.equal(f.view.robotPanel,old);assert.equal(old.querySelector('input').checked,true);assert.equal(old.disabled,true);assert.equal(f.view.body['aria-busy'],'true');await f.view.refreshRobot();assert.equal(f.reads(),2);f.next.resolve(f.offer('fresh'));await reading;assert.equal(f.view.robotPanel,old);assert.equal(f.view.robotPanel.querySelector('input').checked,false);assert.equal(document.activeElement,f.view.robotPanel.querySelector('input'));assert.match(f.view.note.textContent,/vælg områder og indstillinger igen/);assert.equal(f.view.task.taskId,'fresh');assert.equal(f.view.refreshButton,null);assert.equal(f.writes(),0);await f.view.send('old-start',{areaIds:['old-area'],repeat:1});assert.equal(f.writes(),0);await f.view.send('fresh-start',{areaIds:['fresh-area'],repeat:1});assert.equal(f.writes(),1);}finally{f.view.cleanup();}
});
test('failed refresh retains old disabled content and allows another explicit attempt only',async()=>{const f=fixture();try{await open(f);const old=f.view.robotPanel;expire(f);const reading=f.view.refreshRobot();f.next.reject(Error('read failed'));await reading;assert.equal(f.view.robotPanel,old);assert.equal(old.disabled,true);assert.equal(f.view.task,null);assert.equal(f.reads(),2);assert.equal(f.view.refreshButton.disabled,false);assert.equal(f.writes(),0);}finally{f.view.cleanup();}});
for(const blocked of ['pending','unknown'])test(blocked+' cannot offer expiry recovery',async()=>{const f=fixture();try{await open(f);if(blocked==='pending')f.view.pending=true;else f.view.receipts.set('x',{bootId:'boot',roomId:'room',domain:'vacuum',target,outcome:'unknown'});expire(f);assert.equal(f.view.refreshButton??null,null);assert.equal(f.reads(),1);assert.equal(f.writes(),0);}finally{f.view.cleanup();}});
for(const changed of ['disconnect','close','boot','unknown','stale','removed'])test(changed+' during refresh rejects fresh task',async()=>{const f=fixture();try{await open(f);expire(f);assert.ok(f.view.refreshButton);const reading=f.view.refreshRobot();if(changed==='disconnect'){f.host.isConnected=false;f.view.cleanup();}else if(changed==='close')f.view.dialog.close();else if(changed==='boot'){f.host.liveSnapshot.bootId='replacement';f.view.render();}else if(changed==='stale')f.host.state.devices[0].stale=true;else if(changed==='removed')f.host.state.devices=[];else f.view.receipts.set('x',{bootId:'boot',roomId:'room',domain:'vacuum',target,outcome:'unknown'});f.next.resolve(f.offer('fresh'));await reading;assert.equal(f.view.task,null);assert.equal(f.writes(),0);if(!['unknown','stale','removed'].includes(changed))assert.equal(f.view.refreshButton??null,null);else assert.equal(f.view.refreshButton.disabled,true);}finally{f.view.cleanup();}});

for(const blocked of ['pending','unknown'])test(blocked+' after expiry prevents clicking refresh',async()=>{const f=fixture();try{await open(f);expire(f);assert.ok(f.view.refreshButton);if(blocked==='pending')f.view.pending=true;else f.view.receipts.set('x',{bootId:'boot',roomId:'room',domain:'vacuum',target,outcome:'unknown'});await f.view.refreshRobot();assert.equal(f.reads(),1);assert.equal(f.writes(),0);}finally{f.view.cleanup();}});

for(const outcome of ['success','failure'])for(const moved of [false,true])test(`${outcome} restores abandoned refresh focus but respects deliberate navigation: moved=${moved}`,async()=>{const f=fixture();try{await open(f);expire(f);const button=f.view.refreshButton;button.focus();const reading=f.view.refreshRobot();const close=f.view.dialog.querySelector('button');document.activeElement=moved?close:document.body;if(outcome==='failure')f.next.reject(Error('scripted failure'));else f.next.resolve(f.offer('fresh'));await reading;assert.equal(document.activeElement,moved?close:outcome==='failure'?button:f.view.robotPanel.querySelector('input'));if(outcome==='failure')assert.equal(button.disabled,false);assert.equal(f.writes(),0);}finally{f.view.cleanup();}});
