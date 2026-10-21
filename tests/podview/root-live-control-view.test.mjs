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


test('the single robot control entry stays below its status hero and never starts the robot',()=>{
 const f=fixture(),detail=new Node('section'),hero=new Node('div'),actions=new Node('div'),card=new Node('pv-vacuum-widget');card.actions=actions;detail.append(hero);hero.append(card);card.append(actions);f.host.deviceNodes=new Map([[target.entityId,card]]);f.host.state={focus:target.entityId,devices:[{id:target.entityId,kind:'vacuum',live:true,status:'docked',stale:false}]};
 try{f.view.render();const entry=f.view.robotEntry;assert.equal(entry.parentNode,detail);assert.deepEqual(detail.children,[hero,entry]);assert.equal(f.view.robotButton.parentNode,entry);assert.equal(actions.children.length,0);assert.equal(f.view.robotButton.hidden,false);assert.equal(card.dataset.controlEntry,'true');f.view.render();assert.equal(f.view.robotEntry,entry);assert.deepEqual(detail.children,[hero,entry]);assert.equal(entry.children.filter(node=>node===f.view.robotButton).length,1);assert.equal(f.calls(),0);assert.equal(f.view.dialog.open,false);
  f.host.state.devices[0].stale=true;f.view.render();assert.equal(f.view.robotButton.disabled,false);assert.equal(f.view.robotButton.textContent,'Se robot');assert.equal(f.calls(),0);f.host.liveSnapshot.capabilities.controlSetup=[];f.view.render();assert.equal(f.view.robotButton.hidden,false);assert.equal(f.view.robotButton.parentNode,entry);assert.equal(f.calls(),0);f.host.state.focus='now';f.view.render();assert.equal(entry.hidden,true);assert.equal(f.calls(),0);
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

function historicalOffer(f){return {...f.offer(),options:[{id:'reuse-current',action:'reuse',label:'Brug denne rengøring',argsSchema:{kind:'none'}},{id:'start-current',action:'start',label:'Start rengøring',argsSchema:{kind:'cleaning',areas:[{id:'area-current',label:'Køkken'}],repeat:{min:1,max:3}}}],setup:{historyDraft:{source:'accepted_start_history',optionId:'start-current',areaIds:['area-current'],repeat:2}}};}
test('only an explicitly selected historical recipe setup can publish its validated task-bound draft with no action',async()=>{
 for(const selected of [true,false]){const f=fixture();try{const opening=f.view.open('vacuum',target,new Node('button'),selected?'selected-recipe':undefined);f.setup.resolve(historicalOffer(f));await opening;assert.equal(f.calls(),0);if(selected){assert.deepEqual(f.view.task.historyDraft,{source:'accepted_start_history',optionId:'start-current',areaIds:['area-current'],repeat:2});assert.equal(f.view.robotPanel.data.task,f.view.task);}else{assert.equal(f.view.task,null);assert.match(f.view.note.textContent,/kunne ikke hentes/);}}finally{f.view.cleanup();}}
});
test('a selected historical setup arriving after room replacement cannot prefill or dispatch',async()=>{
 const f=fixture();try{const opening=f.view.open('vacuum',target,new Node('button'),'selected-recipe');f.host.liveSnapshot.roomId='other';f.setup.resolve(historicalOffer(f));await opening;assert.equal(f.view.task,null);assert.equal(f.calls(),0);}finally{f.view.cleanup();}
});

test('authorized robot setup pending and failure never project terminal readonly over the retained widget',async()=>{
 const f=fixture();f.host.state.focus=target.entityId;
 try{const opening=f.view.open('vacuum',target,f.view.robotButton),panel=f.view.robotPanel;
 assert.equal(f.view.title.textContent,'Rengøring');assert.equal(f.view.body['aria-busy'],'true');assert.equal(panel.data.task,null);assert.equal(panel.data.readOnly,false);assert.equal(panel.data.device.status,'docked');assert.equal(panel.disabled,true);assert.equal(f.view.note.textContent,'');assert.equal(f.calls(),0);
 f.setup.reject(Error('source read failed'));await opening;
 assert.equal(f.view.robotPanel,panel);assert.equal(panel.data.readOnly,false);assert.equal(f.view.body['aria-busy'],'false');assert.match(f.view.note.textContent,/kunne ikke hentes/);assert.equal(panel.disabled,true);await f.view.send('pause',{});assert.equal(f.calls(),0);
 }finally{f.view.cleanup();}
});
for(const cause of ['missing-admission','stale-observation'])test(`actual ${cause} retains the honest status-only projection without fetching or effects`,()=>{
 const f=fixture();f.host.state.focus=target.entityId;let reads=0;f.host.liveTransport.controlSetup=()=>{reads++;return f.setup.promise;};
 try{if(cause==='missing-admission')f.host.liveSnapshot.capabilities.controlSetup=[];else f.host.state.devices[0].stale=true;
 f.view.openRobot(f.view.robotButton);assert.equal(f.view.title.textContent,'Robotstøvsuger');assert.equal(f.view.robotPanel.data.readOnly,true);assert.equal(f.view.robotPanel.data.task,null);assert.equal(f.view.robotPanel.disabled,true);assert.match(f.view.note.textContent,/Kun status/);assert.equal(f.view.body['aria-busy'],'false');assert.equal(reads,0);assert.equal(f.calls(),0);
 }finally{f.view.cleanup();}
});


test('kit-bound admitted volume form preserves schema and native submit authority',()=>{
 const f=fixture();try{
  const requests=[];f.view.send=(id,args)=>requests.push({id,args});f.view.domain='music';f.view.task={domain:'music',volume:23,options:[{id:'volume-opaque',action:'volume',label:'Lydstyrke',argsSchema:{kind:'percent',min:0,max:45}}]};f.view.buildOptions();
  const form=f.view.body.querySelectorAll('form')[0],range=form.querySelectorAll('input')[0],submit=form.querySelectorAll('button')[0];
  assert.equal(f.view.dialog.getAttribute('data-kit'),'dialog');assert.equal(range.getAttribute('data-kit'),'slider');assert.equal(range.value,'23');assert.equal(range.max,'45');assert.equal(range.type,'range');assert.equal(submit.type,'submit');assert.equal(submit.getAttribute('data-kit-variant'),'primary');assert.deepEqual(requests,[]);
  form.elements={percent:range};range.value='31';form.dispatchEvent(new Event('submit',{cancelable:true}));assert.deepEqual(requests,[{id:'volume-opaque',args:{percent:31}}]);
  const close=f.view.dialog.children[0].children[1];assert.equal(close.getAttribute('data-kit'),'button');const serial=f.view.opening;close.dispatchEvent(new Event('click'));assert.equal(f.view.opening,serial+1);assert.deepEqual(f.view.body.children,[]);assert.equal(requests.length,1);
 }finally{f.view.cleanup();}
});
