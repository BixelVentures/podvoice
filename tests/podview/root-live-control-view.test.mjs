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
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const target={entityId:'vacuum.actual'};
function fixture(){
 const detail=new Node('div'),player=new Node('div'),host=new Node('host');
 globalThis.document={createElement:tag=>new Node(tag),getElementById:()=>detail};
 host.querySelector=()=>player;host.state={devices:[]};
 host.liveSnapshot={bootId:'boot',roomId:'room',capabilities:{controlSetup:['vacuum']}};
 const setup=deferred(),action=deferred();let calls=0;
 host.liveTransport={connected:true,controlSetup:()=>setup.promise,controlAction:()=>{calls++;return action.promise;}};
 const view=new LiveControlView(host);
 const offer=()=>({ok:true,schema:'podview.control.v1',roomId:'room',bootId:'boot',domain:'vacuum',taskId:'task',revision:1,expiresAt:Date.now()/1000+15,options:[{id:'pause',action:'pause',label:'Pause rengøring',argsSchema:{kind:'none'}}],setup:{mapName:null}});
 return {host,view,setup,action,offer,calls:()=>calls};
}
async function open(f){const pending=f.view.open('vacuum',target,new Node('button'));f.setup.resolve(f.offer());await pending;assert.ok(f.view.task);}
for(const outcome of ['accepted','unknown'])test(`late ${outcome} survives dialog close without republishing old controls or resending`,async()=>{
 const f=fixture();try{await open(f);const sending=f.view.send('pause',{});f.view.dialog.close();f.action.resolve({ok:outcome==='accepted',outcome,requestId:'receipt'});await sending;
  assert.equal(f.calls(),1);assert.equal(f.view.task,null);assert.equal(f.view.body.children.length,0);assert.equal([...f.view.receipts.values()][0].outcome,outcome);
  await f.view.open('vacuum',target,new Node('button'));assert.match(f.view.receiptNote.textContent,outcome==='accepted'?/modtaget/:/ukendt/);
  await f.view.send('pause',{});assert.equal(f.calls(),1);
 }finally{f.view.cleanup();}
});
test('scope revoke then restore fences an in-flight setup in the same boot',async()=>{
 const f=fixture();try{const opening=f.view.open('vacuum',target,new Node('button'));f.host.liveSnapshot.capabilities.controlSetup=[];f.view.render();f.host.liveSnapshot.capabilities.controlSetup=['vacuum'];f.view.render();f.setup.resolve(f.offer());await opening;assert.equal(f.view.task,null);assert.equal(f.view.body.children.length,0);assert.equal(f.calls(),0);}finally{f.view.cleanup();}
});
test('revocation disables existing robot controls and restoration does not revive its task',async()=>{
 const f=fixture();try{await open(f);const panel=f.view.robotPanel;assert.equal(panel.disabled,false);f.host.liveSnapshot.capabilities.controlSetup=[];f.view.render();assert.equal(panel.disabled,true);assert.equal(f.view.task,null);f.host.liveSnapshot.capabilities.controlSetup=['vacuum'];f.view.render();assert.equal(panel.disabled,true);await f.view.send('pause',{});assert.equal(f.calls(),0);}finally{f.view.cleanup();}
});
test('expired task becomes visibly inert before it can send',async()=>{
 const f=fixture();try{await open(f);f.view.task.expiresAt=Date.now()/1000-1;f.view.render();assert.equal(f.view.task,null);assert.ok(f.view.body.querySelectorAll('button').every(x=>x.disabled));assert.match(f.view.note.textContent,/udløbet/);await f.view.send('pause',{});assert.equal(f.calls(),0);}finally{f.view.cleanup();}
});
test('disconnect preserves pending unknown and late accepted receipt, without stale DOM',async()=>{
 const f=fixture();try{await open(f);const sending=f.view.send('pause',{});f.host.isConnected=false;f.view.cleanup();assert.equal([...f.view.receipts.values()][0].outcome,'unknown');f.action.resolve({ok:true,outcome:'accepted',requestId:'receipt'});await sending;assert.equal([...f.view.receipts.values()][0].outcome,'accepted');assert.equal(f.view.task,null);assert.equal(f.calls(),1);f.host.isConnected=true;f.view.render();assert.match(f.view.receiptNote.textContent,/modtaget/);}finally{f.view.cleanup();}
});
test('receipts retain at most sixteen, hide on owner change and preserve known acceptance through disconnect',()=>{
 const f=fixture();try{f.view.domain='vacuum';f.view.target=target;for(let i=0;i<20;i++)f.view.remember({key:String(i),bootId:'boot',roomId:'room',domain:'vacuum',target,label:'Pause'},i%2?'accepted':'unknown');assert.equal(f.view.receipts.size,16);f.view.invalidate();assert.match(f.view.receiptNote.textContent,/modtaget/);f.host.liveSnapshot={...f.host.liveSnapshot,bootId:'new'};f.view.render();assert.equal(f.view.receiptNote.hidden,true);}finally{f.view.cleanup();}
});
