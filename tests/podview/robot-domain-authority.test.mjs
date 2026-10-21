import {installDOMAttributes} from './helpers/dom-attributes.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveControlView} from '../../podvoice/gatekeeper/static/podview/live-control-view.js';

// Minimal DOM port: exercise the shipped view's constructor, render and async
// handlers. Real browser focus/layout remains a separate QA gate.
class Node extends EventTarget {
 constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.isConnected=true;this.open=false;this.textContent='';}
 append(...nodes){this.children.push(...nodes);}
 after(node){this.sibling=node;}
 setAttribute(name,value){this[name]=value;}
 replaceChildren(...nodes){this.children=nodes;}
 focus(){}
 showModal(){this.open=true;}
 close(){this.open=false;this.dispatchEvent(new Event('close'));}
 querySelectorAll(selector){const tags=selector.split(',').map(x=>x.toUpperCase());return this.children.flatMap(n=>[...(tags.includes(n.tagName)?[n]:[]),...n.querySelectorAll(selector)]);}
}
installDOMAttributes(Node);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const target={entityId:'vacuum.actual'};
function fixture(){
 const detail=new Node('div'),player=new Node('div'),host=new Node('host');
 globalThis.document={createElement:tag=>new Node(tag),getElementById:()=>detail};
 host.querySelector=()=>player;host.state={focus:'vacuum.actual',devices:[{id:'vacuum.actual',kind:'vacuum',live:true,stale:false}]};
 host.liveSnapshot={bootId:'boot',roomId:'room',capabilities:{controlSetup:['vacuum']}};
 const setup=deferred(),action=deferred();let calls=0;
 host.liveTransport={connected:true,controlSetup:()=>setup.promise,controlAction:()=>{calls++;return action.promise;}};
 const view=new LiveControlView(host);
 const offer=()=>({ok:true,schema:'podview.control.v1',roomId:'room',bootId:'boot',domain:'vacuum',taskId:'task',revision:1,expiresAt:Date.now()/1000+15,options:[{id:'pause',action:'pause',label:'Pause rengøring',argsSchema:{kind:'none'}}],setup:{mapName:null}});
 return {host,view,setup,action,offer,calls:()=>calls};
}
async function open(f){const pending=f.view.open('vacuum',target,new Node('button'));f.setup.resolve(f.offer());await pending;assert.ok(f.view.task);}
for(const transition of ['loss','gain'])for(const phase of ['pending','open'])test(`music-only ${transition} preserves ${phase} robot setup without action`,async()=>{
 const f=fixture();try{
  f.host.liveSnapshot.capabilities.controlSetup=transition==='loss'?['music','vacuum']:['vacuum'];
  let opening;if(phase==='pending')opening=f.view.open('vacuum',target,new Node('button'));else await open(f);
  const generation=f.view.generation,panel=f.view.robotPanel,task=f.view.task;
  f.host.liveSnapshot.capabilities.controlSetup=transition==='loss'?['vacuum']:['music','vacuum'];f.view.render();
  assert.equal(f.view.generation,generation,'unrelated music permission must not invalidate robot owner');
  if(opening){f.setup.resolve(f.offer());await opening;assert.ok(f.view.task);assert.ok(f.view.robotPanel);}else{assert.equal(f.view.task,task);assert.equal(f.view.robotPanel,panel);assert.equal(panel.disabled,false);}
  assert.equal(f.calls(),0);assert.equal(f.view.robotButton.hidden,false);assert.doesNotMatch(f.view.note.textContent,/Adgangen eller forbindelsen/);
 }finally{f.view.cleanup();}
});
for(const change of ['vacuum','disconnect','boot','room'])for(const phase of ['pending','open'])test(`${change} still invalidates ${phase} robot and rejects late setup`,async()=>{
 const f=fixture();try{let opening;if(phase==='pending')opening=f.view.open('vacuum',target,new Node('button'));else await open(f);const generation=f.view.generation;
  if(change==='vacuum')f.host.liveSnapshot.capabilities.controlSetup=[];if(change==='disconnect')f.host.liveTransport.connected=false;if(change==='boot')f.host.liveSnapshot.bootId='new';if(change==='room')f.host.liveSnapshot.roomId='new';f.view.render();assert.ok(f.view.generation>generation);
  if(opening){f.setup.resolve(f.offer());await opening;}assert.equal(f.view.task,null);if(f.view.robotPanel)assert.equal(f.view.robotPanel.disabled,true);await f.view.send('pause',{});assert.equal(f.calls(),0);
 }finally{f.view.cleanup();}
});
test('music-only change retains pending action and UNKNOWN/spent fence with one explicit send',async()=>{
 const f=fixture();try{await open(f);const sending=f.view.send('pause',{});assert.equal(f.calls(),1);f.host.liveSnapshot.capabilities.controlSetup=['music','vacuum'];f.view.render();assert.equal(f.view.pending,true);assert.equal(f.view.robotPanel.disabled,true);await f.view.send('pause',{});assert.equal(f.calls(),1);f.action.resolve({ok:false,outcome:'unknown',requestId:'receipt'});await sending;f.host.liveSnapshot.capabilities.controlSetup=['vacuum'];f.view.render();assert.equal([...f.view.receipts.values()][0].outcome,'unknown');assert.equal(f.view.spent.has('task'),true);assert.equal(f.view.robotPanel.disabled,true);await f.view.send('pause',{});assert.equal(f.calls(),1);}finally{f.view.cleanup();}
});
