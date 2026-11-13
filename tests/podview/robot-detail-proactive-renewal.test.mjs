import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base=new URL('../../podvoice/gatekeeper/static/podview/',import.meta.url);
let source=readFileSync(new URL('live-control-view.js',base),'utf8');
// Actual view and actual args/task validator; inert presentation ports, no transport.
source=source.replace("from './home-model.js'",`from '${new URL('home-model.js',base).href}'`).replace("from './robot-observation.js'",`from '${new URL('robot-observation.js',base).href}'`).replace("from './ha-home-observation.js'",`from '${new URL('ha-home-observation.js',base).href}'`).replace("import {RoomPlayerControls} from './room-player-controls.js';",'const RoomPlayerControls=class{status="";invalidate(){}render(){return {transport:false,canVolume:false};}optimisticPlaying(v){return v;}seekState(){return null;}observe(){}};').replace("from './ui/kit.js'",`from '${new URL('ui/kit.js',base).href}'`).replace("from './control-model.js'",`from '${new URL('control-model.js',base).href}'`).replace("from './media-observation.js'",`from '${new URL('media-observation.js',base).href}'`).replace("import './robot-control-panel.js';",'');
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
test('pending Start tolerates stale robot state while read and command authority stay distinct', async () => {
 const f = fixture(), response = deferred();
 let calls = 0;
 f.host.liveTransport.controlAction = () => { calls++; return response.promise; };
 try {
  await open(f);
  inline(f);
  const args = {areaIds: ['old-area'], repeat: 1};
  const start = f.view.send('old-start', args);
  const receipt = () => [...f.view.receipts.values()].at(-1);
  assert.equal(calls, 1);
  f.host.state.devices[0].stale = true;
  expire(f);
  assert.equal(receipt()?.outcome, 'pending');
  assert.equal(f.view.robotControlContext(), null, 'stale state grants no action authority');
  await f.view.send('old-start', args);
  assert.equal(calls, 1);

  f.host.liveSnapshot.capabilities.controlSetup = [];
  f.view.render();
  assert.equal(receipt()?.outcome, 'unknown', 'explicit capability revocation still invalidates custody');
  response.resolve({ok: false, outcome: 'unknown'});
  await start;
 } finally {
  f.view.cleanup();
 }
});
test('renewal preserves live task and panel until validated atomic replacement',async()=>{const f=fixture();try{await open(f);inline(f);const old=f.view.task,panel=f.view.robotPanel,reading=f.view.renewRobotTask(old);assert.equal(f.view.task,old);assert.equal(panel.disabled,false);assert.equal(f.view.robotPanel,panel);assert.equal(f.reads(),2);f.next.resolve(f.offer('fresh'));await reading;assert.equal(f.view.task.taskId,'fresh');assert.equal(f.view.robotPanel,panel);assert.equal(f.writes(),0);}finally{f.view.cleanup();}});
for(const changed of ['expired','operation','context','unknown'])test('renewal discards response on '+changed,async()=>{const f=fixture();try{await open(f);inline(f);const old=f.view.task,reading=f.view.renewRobotTask(old);if(changed==='expired')old.expiresAt=Date.now()/1000-1;else if(changed==='operation')f.view.pending=true;else if(changed==='context')f.host.liveSnapshot.bootId='new';else f.view.receipts.set('x',{bootId:'boot',roomId:'room',domain:'vacuum',target,outcome:'unknown'});f.next.resolve(f.offer('fresh'));await reading;assert.equal(f.view.task,old);assert.equal(f.writes(),0);if(changed==='expired'){await f.view.send('old-start',{areaIds:['old-area'],repeat:1});assert.equal(f.writes(),0);}}finally{f.view.cleanup();}});
test('dirty draft is remapped by owner only and late user changes reject response',async()=>{const f=fixture();try{await open(f);inline(f);const panel=f.view.robotPanel,old=f.view.task;let repeat=1;panel.cleaningDirty=true;panel.cleaningOptionId='old-start';panel.readCleaningDraft=()=>({areaIds:['old-area'],repeat,settingChoices:[]});let request;f.host.liveTransport.controlSetup=(domain,target,recipe,options)=>{request=options;return f.next.promise};const reading=f.view.renewRobotTask(old);assert.equal(request.draft.repeat,1);repeat=2;const next=f.offer('fresh');next.setup.draft={status:'restored',optionId:'fresh-start',areaIds:['fresh-area'],repeat:1,settingChoices:[]};f.next.resolve(next);await reading;assert.equal(f.view.task,old);assert.equal(f.writes(),0);}finally{f.view.cleanup();}});

test('passive robot status changes do not reset the open detail scroll position',async()=>{
 const f=fixture(),feed={scrollTop:137};try{await open(f);inline(f);f.host.querySelector=selector=>selector==='#device-view'?feed:null;const device=f.host.state.devices[0];device.status='cleaning';f.view.render();device.status='paused';f.view.render();assert.equal(feed.scrollTop,137);}finally{f.view.cleanup();}
});

test('changed draft performs at most one bounded read retry without sending a command',async()=>{const f=fixture();try{await open(f);inline(f);const old=f.view.task,panel=f.view.robotPanel,first=deferred(),second=deferred(),requests=[];let count=1;panel.cleaningDirty=true;panel.cleaningOptionId='old-start';panel.readCleaningDraft=()=>({areaIds:['old-area'],repeat:count,settingChoices:[]});f.host.liveTransport.controlSetup=(domain,target,recipe,options)=>{requests.push(options.draft);return requests.length===1?first.promise:second.promise};const reading=f.view.renewRobotTask(old);count=2;const one=f.offer('fresh1');one.setup.draft={status:'restored',optionId:'fresh1-start',areaIds:['fresh1-area'],repeat:1,settingChoices:[]};first.resolve(one);await reading;assert.equal(f.view.task,old);await new Promise(resolve=>setTimeout(resolve,300));assert.equal(requests.length,2);assert.equal(requests[1].repeat,2);count=3;const two=f.offer('fresh2');two.setup.draft={status:'restored',optionId:'fresh2-start',areaIds:['fresh2-area'],repeat:2,settingChoices:[]};second.resolve(two);await new Promise(resolve=>setTimeout(resolve,300));assert.equal(requests.length,2);assert.equal(f.view.task,old);assert.equal(f.writes(),0);}finally{f.view.cleanup();}});

test('draft-change retry cannot reissue after scope changes',async()=>{const f=fixture();try{await open(f);inline(f);const old=f.view.task,panel=f.view.robotPanel,first=deferred();let count=1,reads=0;panel.cleaningDirty=true;panel.cleaningOptionId='old-start';panel.readCleaningDraft=()=>({areaIds:['old-area'],repeat:count,settingChoices:[]});f.host.liveTransport.controlSetup=()=>{reads++;return first.promise};const reading=f.view.renewRobotTask(old);count=2;const response=f.offer('fresh');response.setup.draft={status:'restored',optionId:'fresh-start',areaIds:['fresh-area'],repeat:1,settingChoices:[]};first.resolve(response);await reading;f.host.liveSnapshot.bootId='other';await new Promise(resolve=>setTimeout(resolve,300));assert.equal(reads,1);assert.equal(f.writes(),0);}finally{f.view.cleanup();}});

test('overview uses fresh native action offer during unrelated setup read and fences changed authority',async()=>{
 for(const changed of ['revision','status','scope','stale','entity','expired','access','disconnect']){
  const f=fixture();try{
   const d=f.host.state.devices[0];d.status='cleaning';d.revision=1;d.transportActions={status:'observed',source:'home_assistant_state',entityId:d.id,observedAt:Date.now()/1000,actions:['pause']};
   f.host.state.focus='now';f.host.state.homeScope=JSON.stringify(['boot','room']);let reads=0;f.host.liveTransport.controlSetup=()=>{reads++;return f.next.promise;};
   const read=f.host.liveTransport.controlSetup('vacuum',target),updated={...d,revision:2,transportActions:{...d.transportActions}};
   if(changed==='status')updated.status='paused';if(changed==='scope')f.host.liveSnapshot.roomId='other';if(changed==='stale')updated.stale=true;if(changed==='entity')updated.transportActions.entityId='vacuum.other';if(changed==='expired')updated.transportActions.observedAt-=16;if(changed==='access')f.host.liveSnapshot.capabilities.controlSetup=[];if(changed==='disconnect')f.host.liveTransport.connected=false;
   f.host.state.devices=[updated];
   if(changed==='revision')assert.equal(f.view.robotOverviewAction(updated)?.id,'pause');else assert.equal(f.view.robotOverviewAction(updated),null);
   f.next.resolve(f.offer('offered'));await read;assert.equal(reads,1);assert.equal(f.writes(),0);
  }finally{f.view.cleanup();}
 }
});

test('renewal restores focus only to a uniquely labelled matching replacement without dispatching an action',async()=>{for(const duplicates of [false,true]){const f=fixture();try{await open(f);inline(f);const panel=f.view.robotPanel,old=f.view.task,button=new Node('button');button.type='button';button.dataset={};button.textContent='Pause';panel.replaceChildren(button);panel.contains=node=>panel.children.includes(node);button.focus();let replacement;Object.defineProperty(panel,'data',{set(value){this.value=value;replacement=new Node('button');replacement.type='button';replacement.dataset={};replacement.textContent='Pause';this.replaceChildren(replacement);if(duplicates){const second=new Node('button');second.type='button';second.dataset={};second.textContent='Pause';this.append(second);}document.activeElement=document.body;}});const read=f.view.renewRobotTask(old);f.next.resolve(f.offer('fresh'));await read;assert.equal(document.activeElement,duplicates?document.body:replacement);assert.equal(f.writes(),0);}finally{f.view.cleanup();}}});

test('reopening the same valid robot keeps controls live until an authenticated renewal resolves',async()=>{
 const f=fixture();try{await open(f);inline(f);const old=f.view.task,panel=f.view.robotPanel,first=panel.children[0];panel.disabled=false;const reading=f.view.openRobot(new Node('button'));assert.equal(f.reads(),2);assert.equal(f.view.task,old);assert.equal(panel.disabled,false);assert.equal(panel.children[0],first);f.next.resolve(f.offer('fresh'));await reading;assert.equal(f.view.task.taskId,'fresh');assert.equal(f.writes(),0);}finally{f.view.cleanup();}
});

test('reopening with changed authority or expired offer never uses the preservation path',async()=>{
 for(const changed of ['authority','expired']){const f=fixture();try{await open(f);inline(f);const old=f.view.task;if(changed==='authority')f.host.liveSnapshot.bootId='other';else old.expiresAt=Date.now()/1000-1;const reading=f.view.openRobot(new Node('button'));assert.notEqual(f.view.task,old);
 // Fejl 1 (13 Nov): an offer that only ran out keeps the live robot's panel usable while the fresh one is fetched.
 assert.equal(f.view.robotPanel.disabled,changed==='authority');f.next.resolve(f.offer('fresh'));await reading;assert.equal(f.writes(),0);}finally{f.view.cleanup();}}
});

test('pending and unknown states fence reopening without another read or any action',async()=>{
 for(const changed of ['pending','unknown','operation']){const f=fixture();try{await open(f);inline(f);const old=f.view.task;if(changed==='pending')f.view.pending=true;else if(changed==='operation')f.view.activeOperation={};else f.view.receipts.set('uncertain',{bootId:'boot',roomId:'room',domain:'vacuum',target,outcome:'unknown'});await f.view.openRobot(new Node('button'));assert.equal(f.reads(),1);assert.equal(f.view.task,old);assert.equal(f.writes(),0);}finally{f.view.cleanup();}}
});

test('spent offer cannot be retained by same-robot reopening',async()=>{
 const f=fixture();try{await open(f);inline(f);const old=f.view.task;f.view.spent.set(old.taskId,old.expiresAt);const reading=f.view.openRobot(new Node('button'));assert.notEqual(f.view.task,old);assert.equal(f.view.robotPanel.disabled,true);f.next.resolve(f.offer('fresh'));await reading;assert.equal(f.view.task.taskId,'fresh');assert.equal(f.writes(),0);}finally{f.view.cleanup();}
});

test('direct same-robot open with unknown outcome does not preserve the old offer',async()=>{const f=fixture();try{await open(f);inline(f);const old=f.view.task;f.view.receipts.set('uncertain',{bootId:'boot',roomId:'room',domain:'vacuum',target,outcome:'unknown'});const reading=f.view.open('vacuum',target,new Node('button'));assert.notEqual(f.view.task,old);assert.equal(f.view.robotPanel.disabled,true);f.next.resolve(f.offer('fresh'));await reading;assert.equal(f.writes(),0);}finally{f.view.cleanup();}});

test('first open without a current offer still waits for a validated setup',async()=>{const f=fixture();try{inline(f);const card=new Node('card');card.dataset={};card.parentNode={parentNode:f.host,after(){}};f.host.deviceNodes=new Map([[target.entityId,card]]);f.host.liveTransport.controlSetup=()=>f.next.promise;const reading=f.view.openRobot(new Node('button'));assert.equal(f.view.task,null);assert.equal(f.view.robotPanel.disabled,true);f.next.resolve(f.offer('first'));await reading;assert.equal(f.view.task.taskId,'first');assert.equal(f.writes(),0);}finally{f.view.cleanup();}});

test('renewal records only allowlisted server rejection reason with no task identifiers',async()=>{
 for(const reason of ['robot_deny_source_deadline','PRIVATE-TASK']){const f=fixture();try{await open(f);inline(f);const rows=[];f.host.liveTransport.recordDiagnostic=(stage,row)=>rows.push({stage,...row});const read=f.view.renewRobotTask(f.view.task);const next=f.offer('fresh');next.setup.rebind={status:'not_restored'};next.setup.rebindReason=reason;f.next.resolve(next);await read;assert.equal(rows.some(row=>row.code==='robot_deny_source_deadline'),reason==='robot_deny_source_deadline');assert.doesNotMatch(JSON.stringify(rows),/PRIVATE-TASK|old-start|fresh-start/);assert.equal(f.writes(),0);}finally{f.view.cleanup();}}
});

test('long robot offer starts renewal early enough for an eight-second setup without extending its authority',async()=>{
 const f=fixture(),realNow=Date.now,realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout;let now=1_000_000,timers=[];
 try{
  Date.now=()=>now;await open(f);inline(f);const old=f.view.task;old.expiresAt=(now+120_000)/1000;
  globalThis.setTimeout=(fn,delay)=>{const timer={fn,delay};timers.push(timer);return timer};globalThis.clearTimeout=()=>{};
  f.view.scheduleRobotTaskExpiry();const renewal=timers.find(timer=>timer.delay<120_000);assert(renewal.delay<120_000);
  now+=renewal.delay;renewal.fn();assert.equal(f.reads(),2);assert.equal(f.view.task,old);assert.equal(f.view.robotPanel.disabled,false);
  now+=8_000;assert(now<old.expiresAt*1000,'old offer is still valid after the bounded read');
  f.next.resolve(f.offer('fresh'));await Promise.resolve();await Promise.resolve();await Promise.resolve();assert.equal(f.view.task.taskId,'fresh');assert.equal(f.writes(),0);
 }finally{f.view.cleanup();Date.now=realNow;globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;}
});

test('short robot offer keeps the halfway renewal rule',async()=>{
 const f=fixture(),realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout;let timers=[];
 try{await open(f);inline(f);f.view.task.expiresAt=Date.now()/1000+15;clearTimeout(f.view.expiryTimer);clearTimeout(f.view.robotEarlyRenewal);globalThis.setTimeout=(fn,delay)=>{const timer={fn,delay};timers.push(timer);return timer};globalThis.clearTimeout=()=>{};f.view.scheduleRobotTaskExpiry();const renewal=timers.at(-1);assert(renewal.delay>7000&&renewal.delay<=7500);assert.equal(f.writes(),0);}finally{f.view.cleanup();globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;}
});

test('reopening an expired same-robot offer requests owner-validated draft restoration',async()=>{
 const f=fixture();try{await open(f);inline(f);const old=f.view.task,panel=f.view.robotPanel;panel.cleaningDirty=true;panel.cleaningOptionId='old-start';panel.readCleaningDraft=()=>({areaIds:['old-area'],repeat:2,settingChoices:[]});old.expiresAt=Date.now()/1000-1;let sent;f.host.liveTransport.controlSetup=(domain,target,recipe,options)=>{sent=options;return f.next.promise};const reading=f.view.openRobot(new Node('button'));assert.deepEqual(sent.draft,{taskId:old.taskId,revision:old.revision,optionId:'old-start',areaIds:['old-area'],repeat:2,settingChoices:[]});const response=f.offer('fresh');response.setup.draft={status:'not_restored'};f.next.resolve(response);await reading;assert.equal(f.view.task.taskId,'fresh');assert.equal(f.view.task.draft.status,'not_restored');assert.equal(f.writes(),0);}finally{f.view.cleanup();}
});

test('reopening after boot scope change does not submit previous draft',async()=>{
 const f=fixture();try{await open(f);inline(f);f.view.robotPanel.cleaningDirty=true;f.view.robotPanel.cleaningOptionId='old-start';f.view.robotPanel.readCleaningDraft=()=>({areaIds:['old-area'],repeat:2,settingChoices:[]});f.host.liveSnapshot.bootId='new-boot';let sent;f.host.liveTransport.controlSetup=(domain,target,recipe,options)=>{sent=options;return f.next.promise};const reading=f.view.openRobot(new Node('button'));assert.deepEqual(sent,{});const response=f.offer('fresh');response.bootId='new-boot';f.next.resolve(response);await reading;assert.equal(f.writes(),0);}finally{f.view.cleanup();}
});

test('expired same-context reopen accepts only owner-restored draft with fresh choices',async()=>{
 const f=fixture();try{await open(f);inline(f);const old=f.view.task,panel=f.view.robotPanel;panel.cleaningDirty=true;panel.cleaningOptionId='old-start';panel.readCleaningDraft=()=>({areaIds:['old-area'],repeat:2,settingChoices:[]});old.expiresAt=Date.now()/1000-1;f.host.liveTransport.controlSetup=()=>f.next.promise;const reading=f.view.openRobot(new Node('button'));const response=f.offer('fresh');response.setup.draft={status:'restored',optionId:'fresh-start',areaIds:['fresh-area'],repeat:2,settingChoices:[]};f.next.resolve(response);await reading;assert.deepEqual(f.view.task.draft,response.setup.draft);assert.equal(f.view.robotPanel.value.task.draft.status,'restored');assert.equal(f.writes(),0);}finally{f.view.cleanup();}
});

test('dirty selection survives expiration while robot detail is hidden through owner remap',async()=>{
 const f=fixture();try{await open(f);inline(f);const old=f.view.task,panel=f.view.robotPanel;panel.cleaningDirty=true;panel.cleaningOptionId='old-start';panel.readCleaningDraft=()=>({areaIds:['old-area'],repeat:2,settingChoices:[]});f.view.robotEntry.hidden=true;f.host.state.focus='now';f.view.expireTask();f.host.state.focus=target.entityId;f.view.robotEntry.hidden=false;let sent;f.host.liveTransport.controlSetup=(domain,target,recipe,options)=>{sent=options;return f.next.promise};const reading=f.view.openRobot(new Node('button'));assert.equal(sent?.draft?.taskId,old.taskId);const response=f.offer('fresh');response.setup.draft={status:'restored',optionId:'fresh-start',areaIds:['fresh-area'],repeat:2,settingChoices:[]};f.next.resolve(response);await reading;assert.equal(f.view.task.draft.status,'restored');assert.equal(f.writes(),0);}finally{f.view.cleanup();}
});

test('hidden expired draft is never sent across changed authority or spent or unknown',async()=>{
 for(const change of ['boot','room','transport','transport-generation','spent','unknown']){const f=fixture();try{await open(f);inline(f);const old=f.view.task,panel=f.view.robotPanel;panel.cleaningDirty=true;panel.cleaningOptionId='old-start';panel.readCleaningDraft=()=>({areaIds:['old-area'],repeat:2,settingChoices:[]});f.view.robotEntry.hidden=true;f.host.state.focus='now';f.view.expireTask();if(change==='boot')f.host.liveSnapshot.bootId='other';if(change==='room')f.host.liveSnapshot.roomId='other';if(change==='transport')f.host.liveTransport={...f.host.liveTransport};if(change==='transport-generation')f.host.liveTransport.generation=10;if(change==='spent')f.view.spent.set(old.taskId,Date.now()/1000+10);if(change==='unknown')f.view.receipts.set('x',{bootId:'boot',roomId:'room',domain:'vacuum',target,outcome:'unknown'});f.host.state.focus=target.entityId;f.view.robotEntry.hidden=false;let sent;f.host.liveTransport.controlSetup=(domain,target,recipe,options)=>{sent=options;return f.next.promise};const read=f.view.openRobot(new Node('button'));assert.equal(sent?.draft,undefined,change);f.next.resolve(f.offer('fresh'));await read;assert.equal(f.writes(),0);}finally{f.view.cleanup();}}
});

test('hidden expired draft uses explicit owner rejection feedback',async()=>{
 const f=fixture();try{await open(f);inline(f);const panel=f.view.robotPanel;panel.cleaningDirty=true;panel.cleaningOptionId='old-start';panel.readCleaningDraft=()=>({areaIds:['old-area'],repeat:2,settingChoices:[]});f.view.robotEntry.hidden=true;f.host.state.focus='now';f.view.expireTask();f.host.state.focus=target.entityId;f.view.robotEntry.hidden=false;let feedback;panel.observed=(device,data)=>{if(data.controlFeedback)feedback=data.controlFeedback};const read=f.view.openRobot(new Node('button'));const response=f.offer('fresh');response.setup.draft={status:'not_restored'};f.next.resolve(response);await read;assert.equal(f.view.task.draft.status,'not_restored');assert.match(feedback.text,/ikke genskabes/);assert.equal(f.writes(),0);}finally{f.view.cleanup();}
});

test('opening another robot never restores expired draft for previous robot',async()=>{
 const f=fixture();try{await open(f);inline(f);const panel=f.view.robotPanel;panel.cleaningDirty=true;panel.cleaningOptionId='old-start';panel.readCleaningDraft=()=>({areaIds:['old-area'],repeat:2,settingChoices:[]});f.view.robotEntry.hidden=true;f.host.state.focus='now';f.view.expireTask();const other={entityId:'vacuum.other'};f.host.state.devices.push({id:other.entityId,kind:'vacuum',live:true,stale:false});f.host.state.focus=other.entityId;f.view.robotEntry.hidden=false;let sent,requested;f.host.liveTransport.controlSetup=(domain,target,recipe,options)=>{requested=target;sent=options;return f.next.promise};const read=f.view.openRobot(new Node('button'));assert.deepEqual(requested,other);assert.equal(sent?.draft,undefined);f.next.resolve(f.offer('fresh'));await read;assert.equal(f.writes(),0);}finally{f.view.cleanup();}
});

test('unknown for this robot before hidden expiry creates neither custody nor recovery; another robot does not block custody',async()=>{
 for(const same of [true,false]){const f=fixture();try{await open(f);inline(f);const panel=f.view.robotPanel;panel.cleaningDirty=true;panel.cleaningOptionId='old-start';panel.readCleaningDraft=()=>({areaIds:['old-area'],repeat:2,settingChoices:[]});f.view.receipts.set('unknown',{bootId:'boot',roomId:'room',domain:'vacuum',target:same?target:{entityId:'vacuum.other'},outcome:'unknown'});f.view.robotEntry.hidden=true;f.host.state.focus='now';f.view.expireTask();assert.equal(!!f.view.expiredRobot,!same);assert.equal(!!f.view.refreshButton,!same);assert.equal(f.writes(),0);}finally{f.view.cleanup();}}
});

test('reopening robot setup leaves panel descendants to its own disabled gate',async()=>{
 const f=fixture();try{await open(f);inline(f);const panel=f.view.robotPanel,base=new Node('button'),outside=new Node('button');base.dataset={};outside.dataset={};base.disabled=false;panel.replaceChildren(base);panel.contains=node=>node===base;f.view.body.append(outside);let baseWrites=0,baseDisabled=false;Object.defineProperty(base,'disabled',{get:()=>baseDisabled,set:value=>{baseWrites++;baseDisabled=value;}});f.view.task=null;const read=f.view.open('vacuum',target,new Node('button'));assert.equal(baseWrites,0,'opening must not transiently disable panel-owned Base');assert.equal(outside.disabled,true,'non-panel controls remain disabled');assert.equal(panel.disabled,false,'a live robot keeps its panel usable while setup is fetched (fejl 1)');f.next.resolve(f.offer('fresh'));await read;assert.equal(f.writes(),0);}finally{f.view.cleanup();}
});
// S2/S3: Pause tapped while Start is still in flight is queued and sent once Start settles.
test('a robot transport tap during a pending Start is queued and sent once when Start settles',async()=>{
 const f=fixture();try{
  await open(f);inline(f);const d=f.host.state.devices[0];
  const held=deferred(),intents=[];
  f.host.liveTransport.controlAction=()=>held.promise;
  f.host.liveTransport.controlIntent=async intent=>{intents.push(intent);return {outcome:'accepted',requestId:intent.requestId};};
  const starting=f.view.send('old-start',{areaIds:['old-area'],repeat:1});
  assert.equal(f.view.pending,true);
  Object.assign(d,{status:'cleaning',revision:1,transportActions:{status:'observed',source:'home_assistant_state',entityId:d.id,observedAt:Date.now()/1000,actions:['pause']}});
  f.host.state.homeScope=JSON.stringify(['boot','room']);
  assert.equal(await f.view.robotDirectIntent(d.id,'pause'),true,'the tap is taken, not refused');
  assert.equal(intents.length,0,'nothing is sent while Start is in flight');
  held.resolve({ok:true,outcome:'accepted'});await starting;for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(intents.map(row=>row.action),['pause'],'Pause is sent exactly once after Start');
 }finally{f.view.cleanup();}
});
