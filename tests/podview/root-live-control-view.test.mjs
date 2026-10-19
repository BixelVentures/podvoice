import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveControlView} from '../../podvoice/gatekeeper/static/podview/live-control-view.js';

// Minimal DOM port: exercise the shipped view's constructor, render and async
// handlers. Real browser focus/layout remains a separate QA gate.
class Node extends EventTarget {
 constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.isConnected=true;this.open=false;this.textContent='';}
 append(...nodes){this.children.push(...nodes);}
 after(node){this.sibling=node;}
 remove(){this.isConnected=false;}
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
 host.querySelector=()=>player;host.state={devices:[{id:target.entityId,kind:'vacuum',live:true,status:'docked',stale:false}]};
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
 const f=fixture();try{const opening=f.view.open('vacuum',target,new Node('button'));f.host.liveSnapshot.capabilities.controlSetup=[];f.view.render();f.host.liveSnapshot.capabilities.controlSetup=['vacuum'];f.view.render();f.setup.resolve(f.offer());await opening;assert.equal(f.view.task,null);assert.equal(f.view.robotPanel.disabled,true);assert.equal(f.view.robotPanel.data.task,null);assert.equal(f.calls(),0);}finally{f.view.cleanup();}
});
test('revocation disables existing robot controls and restoration does not revive its task',async()=>{
 const f=fixture();try{await open(f);const panel=f.view.robotPanel;assert.equal(panel.disabled,false);f.host.liveSnapshot.capabilities.controlSetup=[];f.view.render();assert.equal(panel.disabled,true);assert.equal(f.view.task,null);f.host.liveSnapshot.capabilities.controlSetup=['vacuum'];f.view.render();assert.equal(panel.disabled,true);await f.view.send('pause',{});assert.equal(f.calls(),0);}finally{f.view.cleanup();}
});
test('expired task becomes visibly inert before it can send',async()=>{
 const f=fixture();try{await open(f);f.view.task.expiresAt=Date.now()/1000-1;f.view.render();assert.equal(f.view.task,null);assert.equal(f.view.robotPanel.disabled,true);assert.match(f.view.note.textContent,/udløbet/);await f.view.send('pause',{});assert.equal(f.calls(),0);}finally{f.view.cleanup();}
});
test('disconnect preserves pending unknown and late accepted receipt, without stale DOM',async()=>{
 const f=fixture();try{await open(f);const sending=f.view.send('pause',{});f.host.isConnected=false;f.view.cleanup();assert.equal([...f.view.receipts.values()][0].outcome,'unknown');f.action.resolve({ok:true,outcome:'accepted',requestId:'receipt'});await sending;assert.equal([...f.view.receipts.values()][0].outcome,'accepted');assert.equal(f.view.task,null);assert.equal(f.calls(),1);f.host.isConnected=true;f.view.render();assert.match(f.view.receiptNote.textContent,/modtaget/);}finally{f.view.cleanup();}
});
test('receipts retain at most sixteen, hide on owner change and preserve known acceptance through disconnect',()=>{
 const f=fixture();try{f.view.domain='vacuum';f.view.target=target;for(let i=0;i<20;i++)f.view.remember({key:String(i),bootId:'boot',roomId:'room',domain:'vacuum',target,label:'Pause'},i%2?'accepted':'unknown');assert.equal(f.view.receipts.size,16);f.view.invalidate();assert.match(f.view.receiptNote.textContent,/modtaget/);f.host.liveSnapshot={...f.host.liveSnapshot,bootId:'new'};f.view.render();assert.equal(f.view.receiptNote.hidden,true);}finally{f.view.cleanup();}
});

for(const outcome of ['accepted','rejected','unknown'])test(`pending controls stay silent and inert before ${outcome} remains visible`,async()=>{
 const f=fixture();try{
  await open(f);const sending=f.view.send('pause',{});
  assert.equal(f.view.pending,true);assert.equal(f.view.robotPanel.disabled,true);
  assert.equal([...f.view.receipts.values()][0].outcome,'pending');
  assert.equal(f.view.note.textContent,'');assert.equal(f.view.receiptNote.hidden,true);assert.equal(f.view.receiptNote.textContent,'');
  assert.equal(f.view.slowTimer,undefined);
  await f.view.send('pause',{});assert.equal(f.calls(),1);
  f.action.resolve({ok:outcome==='accepted',outcome,requestId:'receipt'});await sending;
  assert.equal(f.view.pending,false);assert.equal(f.view.receiptNote.hidden,false);
  assert.match(f.view.receiptNote.textContent,outcome==='accepted'?/Anmodningen er modtaget\./:outcome==='unknown'?/ukendt.*gentages ikke/:/afvist/);
  assert.equal([...f.view.receipts.values()][0].outcome,outcome);
  await f.view.send('pause',{});assert.equal(f.calls(),1);
 }finally{f.view.cleanup();}
});

test('cleaning map context belongs to the canonical area form, not a duplicate dialog note',async()=>{
 const f=fixture();try{
  const opening=f.view.open('vacuum',target,new Node('button'));
  const offered=f.offer();offered.setup.mapName='Stueplan (2025)';offered.options=[{id:'clean-opaque',action:'start',label:'Start rengøring',argsSchema:{kind:'cleaning',areas:[{id:'kitchen-opaque',label:'Køkkenalrum'}],repeat:{min:1,max:3}}}];
  f.setup.resolve(offered);await opening;
  assert.equal(f.view.note.textContent,'');
  assert.equal(f.view.robotPanel.data.task.mapName,'Stueplan (2025)');
  assert.equal(f.view.robotPanel.data.task.options[0].id,'clean-opaque');
  assert.equal(f.calls(),0);
 }finally{f.view.cleanup();}
});
test('robot tasks without an area form retain supplied map context in the dialog note',async()=>{
 const f=fixture();try{
  const opening=f.view.open('vacuum',target,new Node('button')),offered=f.offer();offered.setup.mapName='Stueplan (2025)';
  f.setup.resolve(offered);await opening;
  assert.equal(f.view.note.textContent,'Stueplan (2025)');assert.equal(f.calls(),0);
 }finally{f.view.cleanup();}
});


test('the single existing robot entry stays inside its observed status card and never starts the robot',()=>{
 const f=fixture(),actions=new Node('div'),card={actions,dataset:{}};actions.append=(node)=>{actions.children.push(node);node.parentNode=actions;};f.host.deviceNodes=new Map([[target.entityId,card]]);f.host.state={focus:target.entityId,devices:[{id:target.entityId,kind:'vacuum',live:true,status:'docked',stale:false}]};
 try{f.view.render();assert.equal(f.view.robotButton.parentNode,actions);assert.equal(actions.children.length,1);assert.equal(f.view.robotButton.hidden,false);assert.equal(card.dataset.controlEntry,'true');f.view.render();assert.equal(actions.children.length,1);assert.equal(f.calls(),0);assert.equal(f.view.dialog.open,false);
  f.host.state.devices[0].stale=true;f.view.render();assert.equal(f.view.robotButton.disabled,false);assert.equal(f.view.robotButton.textContent,'Se robot');assert.equal(f.calls(),0);f.host.liveSnapshot.capabilities.controlSetup=[];f.view.render();assert.equal(f.view.robotButton.hidden,false);assert.equal(f.view.robotButton.parentNode,actions);assert.equal(f.calls(),0);
 }finally{f.view.cleanup();}
});


test('already observed robot care opens the same read-only dialog without control admission or setup calls',()=>{
 const f=fixture();let reads=0;f.host.liveTransport.controlSetup=()=>{reads++;throw Error('must not read a control offer');};f.host.liveSnapshot.capabilities.controlSetup=[];f.host.state={focus:target.entityId,devices:[{id:target.entityId,kind:'vacuum',live:true,status:'docked',stale:false}]};
 try{f.view.render();assert.equal(f.view.robotButton.textContent,'Se robot');f.view.openRobot(f.view.robotButton);assert.equal(f.view.dialog.open,true);assert.equal(f.view.task,null);assert.equal(f.view.robotPanel.data.task,null);assert.equal(f.view.robotPanel.disabled,true);assert.equal(reads,0);assert.equal(f.calls(),0);let observed='not-updated';f.view.robotPanel.observed=device=>{observed=device;};f.host.state.devices=[];f.view.render();assert.equal(observed,undefined);assert.equal(f.view.robotButton.hidden,true);}finally{f.view.cleanup();}
});
test('a failed robot setup keeps the canonical observed care panel without admitting controls',async()=>{
 const f=fixture();f.host.state={focus:target.entityId,devices:[{id:target.entityId,kind:'vacuum',live:true,status:'docked',stale:false}]};
 try{const opening=f.view.open('vacuum',target,f.view.robotButton);const initial=f.view.robotPanel;assert.ok(initial);assert.equal(initial.data.task,null);assert.equal(initial.disabled,true);f.setup.reject(Error('source unavailable'));await opening;assert.equal(f.view.robotPanel,initial);assert.equal(initial.disabled,true);assert.equal(f.view.task,null);assert.match(f.view.note.textContent,/kunne ikke hentes/);assert.equal(f.calls(),0);}finally{f.view.cleanup();}
});


test('an admitted robot task cannot write after its observed device disappears or becomes stale',async()=>{
 const f=fixture();try{await open(f);assert.equal(f.view.robotPanel.disabled,false);f.host.state.devices=[];f.view.render();assert.equal(f.view.robotPanel.disabled,true);await f.view.send('pause',{});assert.equal(f.calls(),0);f.host.state.devices=[{id:target.entityId,kind:'vacuum',live:true,status:'cleaning',stale:true}];f.view.render();assert.equal(f.view.robotPanel.disabled,true);await f.view.send('pause',{});assert.equal(f.calls(),0);}finally{f.view.cleanup();}
});
