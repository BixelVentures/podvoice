import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveControlView} from '../../podvoice/gatekeeper/static/podview/live-control-view.js';

// Minimal DOM port: exercise the shipped view's constructor, render and async
// handlers. Real browser focus/layout remains a separate QA gate.
class Node extends EventTarget {
 constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.isConnected=true;this.open=false;this.textContent='';this.dataset={};}
 append(...nodes){for(const node of nodes){if(node.parentNode){const index=node.parentNode.children.indexOf(node);if(index>=0)node.parentNode.children.splice(index,1);}this.children.push(node);node.parentNode=this;}}
 after(node){this.sibling=node;if(this.parentNode){const index=this.parentNode.children.indexOf(this);this.parentNode.children.splice(index+1,0,node);node.parentNode=this.parentNode;}}
 remove(){this.isConnected=false;}
 setAttribute(name,value){this[name]=String(value);}
 getAttribute(name){return this[name]??null;}
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
 host.querySelector=()=>player;host.state={devices:[{id:target.entityId,kind:'vacuum',live:true,status:'docked',stale:false}]};
 host.liveSnapshot={bootId:'boot',roomId:'room',capabilities:{controlSetup:['vacuum']}};
 const setup=deferred(),action=deferred();let calls=0;
 host.liveTransport={connected:true,controlSetup:()=>setup.promise,controlAction:()=>{calls++;return action.promise;}};
 const view=new LiveControlView(host);
 const offer=()=>({ok:true,schema:'podview.control.v1',roomId:'room',bootId:'boot',domain:'vacuum',taskId:'task',revision:1,expiresAt:Date.now()/1000+15,options:[{id:'pause',action:'pause',label:'Pause rengøring',argsSchema:{kind:'none'}}],setup:{mapName:null}});
 return {host,view,setup,action,offer,calls:()=>calls};
}
async function open(f){const pending=f.view.open('vacuum',target,new Node('button'));f.setup.resolve(f.offer());await pending;assert.ok(f.view.task);}
test('presentation close preserves task and unknown receipt while manual close retains cleanup',()=>{
 const f=fixture();try{
  const task={taskId:'task',expiresAt:Date.now()/1000+10};f.view.task=task;f.view.receipts.set('unknown',{outcome:'unknown'});f.view.dialog.showModal();f.view.dialog.dataset.presentationClose='true';f.view.dialog.close();
  assert.equal(f.view.task,task);assert.equal(f.view.receipts.get('unknown').outcome,'unknown');assert.equal(f.calls(),0);
  f.view.dialog.showModal();f.view.dialog.close();assert.equal(f.view.task,null);assert.equal(f.view.receipts.get('unknown').outcome,'unknown');
 }finally{f.view.cleanup();}
});
