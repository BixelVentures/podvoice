import test from 'node:test';
import assert from 'node:assert/strict';
import {renderRobotHistory} from '../../podvoice/gatekeeper/static/podview/live-home-view.js';
import {LocalRobotView} from '../../podvoice/gatekeeper/static/podview/local-robot-view.js';

class Node {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.hidden=false;this.attributes={};this.listeners={};}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 querySelector(tag){return this.children.flatMap(node=>[node,...node.descendants()]).find(node=>node.tagName===tag)||null;}
 descendants(){return this.children.flatMap(node=>[node,...node.descendants()]);}
 closest(){return this.parent||this;}
 setAttribute(name,value){this.attributes[name]=value;}
 getAttribute(name){return this.attributes[name]??null;}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=null;}}
 insertBefore(node,before){node.remove();node.parent=this;const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,node);}
 addEventListener(name,handler){this.listeners[name]=handler;}
}
function fixture(device,allowed=false){
 const root=new Node(),history=new Node('section'),timeline=new Node('pv-activity-timeline');root.append(history);history.append(timeline);root.id='device-view';timeline.id='device-timeline';
 globalThis.document={createElement:tag=>new Node(tag),getElementById:id=>[root,...root.descendants()].find(node=>node.id===id)||null};
 const calls=[],host={liveSnapshot:{bootId:'boot',roomId:'room',capabilities:{homeRead:['vacuum']}},state:{focus:device.id,devices:[device],homeScope:JSON.stringify(['boot','room'])},liveControls:{allowed:()=>allowed,openRobot:(button,id)=>calls.push(id)}};
 return {root,history,timeline,host,calls,section:()=>document.getElementById('robot-recent')};
}
const now=()=>Date.now()/1000;
const fact=(key,value,unit=null)=>({key,entityId:`sensor.${key}`,value,unit,updatedAt:now(),retrievedAt:now(),stale:false});
const device=(extra={})=>({id:'vacuum.actual',kind:'vacuum',live:true,source:'home_assistant_state',status:'docked',stale:false,history:{status:'observed',items:[]},telemetry:{status:'observed',items:[]},...extra});
const request=(id,outcome='accepted_by_ha')=>({id,recordedAt:now()-50,outcome,recipe:{mapName:'Stueetage',areaIds:['actual-area'],repeat:1}});
function withDocument(run){const previous=globalThis.document;try{run();}finally{globalThis.document=previous;}}

test('recent selection UI is removed for every state without changing stored recipe history',()=>withDocument(()=>{
 for(const status of ['docked','cleaning','paused','stopped','fault']){const saved=request('saved'),d=device({status,history:{status:'observed',items:[saved]}}),f=fixture(d,true),recent=new Node('section'),choices=new Node('pv-choice-list');recent.id='robot-recent';recent.append(choices);recent.robotHistoryNodes={recipes:new Map([['saved',saved]])};f.root.append(recent);const before=JSON.stringify(d.history);renderRobotHistory(f.host);assert.equal(recent.hidden,true);assert.equal(recent.children.length,0);assert.equal(recent.robotHistoryNodes,undefined);assert.equal(JSON.stringify(d.history),before);assert.deepEqual(f.calls,[]);assert.equal(f.root.descendants().some(node=>node.tagName==='pv-choice-list'),false);}
}));
test('history creates no replacement recent choices, filler or second control section',()=>withDocument(()=>{
 const f=fixture(device({history:{status:'observed',items:[request('saved')]}}),true);renderRobotHistory(f.host);assert.equal(f.section(),null);assert.equal(f.history.hidden,true);assert.deepEqual(f.timeline.data.items,[]);assert.equal(f.root.children.length,1);assert.deepEqual(f.calls,[]);
}));
test('independent native start and end facts keep source timestamps and stale labels without invented cycle metrics',()=>withDocument(()=>{
 const d=device({stale:true,telemetry:{status:'observed',items:[fact('last_clean_start',now()-2000),fact('last_clean_end',now()-1000),fact('cleaning_area',45,'m²')]}}),before=JSON.stringify(d),f=fixture(d);renderRobotHistory(f.host);assert.equal(f.history.hidden,false);assert.deepEqual(f.timeline.data.items.map(row=>row.id),['robot-fact:last_clean_end','robot-fact:last_clean_start']);assert.deepEqual(f.timeline.data.items.map(row=>row.label),['Senest afsluttet · sidst kendt','Senest startet · sidst kendt']);assert.ok(f.timeline.data.items.every(row=>!row.label.includes('45')));assert.equal(JSON.stringify(d),before);
}));
test('unknown action result remains an explicitly unconfirmed request, never a completed cycle',()=>withDocument(()=>{
 const accepted=request('accepted'),unknown=request('unknown','unknown'),f=fixture(device({history:{status:'observed',items:[accepted,unknown]}}),true);renderRobotHistory(f.host);assert.deepEqual(f.timeline.data.items.map(row=>row.id),['robot-request:unknown']);assert.match(f.timeline.data.items[0].label,/^Udfald ukendt/);assert.ok(f.timeline.data.items.every(row=>!/færdig|afsluttet/.test(row.label)));assert.equal(f.section(),null);assert.deepEqual(f.calls,[]);
}));
test('observed facts and unknown requests retain independent source ordering',()=>withDocument(()=>{
 const start=fact('last_clean_start',now()-120),end=fact('last_clean_end',now()-10),older=request('older'),middle=request('middle','unknown');older.recordedAt=now()-180;middle.recordedAt=now()-60;const f=fixture(device({telemetry:{status:'observed',items:[start,end]},history:{status:'observed',items:[older,middle]}}));renderRobotHistory(f.host);assert.deepEqual(f.timeline.data.items.map(row=>row.id),['robot-fact:last_clean_end','robot-request:middle','robot-fact:last_clean_start']);
}));
test('read scope revocation clears visible events without altering internal history',()=>withDocument(()=>{
 for(const change of ['read','boot','room','blocked']){const d=device({telemetry:{status:'observed',items:[fact('last_clean_end',now()-10)]},history:{status:'observed',items:[request('saved')]}}),f=fixture(d,true);renderRobotHistory(f.host);const before=JSON.stringify(d.history);if(change==='read')f.host.liveSnapshot.capabilities.homeRead=[];if(change==='boot')f.host.liveSnapshot.bootId='foreign';if(change==='room')f.host.liveSnapshot.roomId='foreign';if(change==='blocked')f.host.liveTransport={recoveryBlocked:true};renderRobotHistory(f.host);assert.equal(f.history.hidden,true);assert.deepEqual(f.timeline.data.items,[]);assert.equal(JSON.stringify(d.history),before);assert.equal(f.section(),null);}
}));
test('same canonical timeline survives empty, actual facts, unavailable data and unrelated setting observations',()=>withDocument(()=>{
 const d=device(),f=fixture(d),timeline=f.timeline;renderRobotHistory(f.host);assert.equal(f.history.hidden,true);d.telemetry.items=[fact('last_clean_end',now()-10)];renderRobotHistory(f.host);assert.equal(f.history.hidden,false);const before=timeline.data;let updates=0;Object.defineProperty(timeline,'data',{get:()=>before,set:()=>updates++});d.telemetry.items.push(fact('filter_time_left',40,'h'));renderRobotHistory(f.host);assert.equal(updates,0);assert.equal(f.timeline,timeline);assert.equal(f.section(),null);
}));
test('render repairs overwritten canonical timeline without producing recipe selection controls',()=>withDocument(()=>{
 const f=fixture(device({telemetry:{status:'observed',items:[fact('last_clean_end',now()-10)]}}));renderRobotHistory(f.host);const original=f.timeline.data;f.timeline.data={items:[]};renderRobotHistory(f.host);assert.deepEqual(f.timeline.data,original);assert.equal(f.section(),null);
}));

// Preserve the former history regression guards while the removed recipe UI
// remains absent: read custody and command custody are independent.
test('offline, revoked control, stale and pending observations preserve read-authorized facts without exposing saved-choice actions',()=>withDocument(()=>{
 for(const change of ['offline','control','stale','pending']){
  const d=device({telemetry:{status:'observed',items:[fact('last_clean_end',now()-10)]},history:{status:'observed',items:[request('saved')]}}),f=fixture(d,true),before=JSON.stringify(d.history);
  renderRobotHistory(f.host);f.host.liveControls.allowed=()=>false;
  if(change==='offline')f.host.state.connected=false;if(change==='stale')d.stale=true;if(change==='pending')d.pending={operation:'current'};
  renderRobotHistory(f.host);assert.equal(f.history.hidden,false,change);assert.equal(f.timeline.data.items[0].id,'robot-fact:last_clean_end',change);assert.equal(f.timeline.hidden,false);assert.equal(f.section(),null);assert.equal(JSON.stringify(d.history),before);assert.deepEqual(f.calls,[]);
 }
}));
test('local accepted requests cannot become accepted live facts or create recipe controls',()=>withDocument(()=>{
 const d=device({live:false,history:{status:'observed',items:[request('local','accepted_local')]}}),f=fixture(d,true);f.host.localRobot={areaLabels:new Map([['actual-area','Køkken']]),allowed:()=>true,openRobot:(_,id)=>f.calls.push(id)};
 renderRobotHistory(f.host);assert.equal(f.history.hidden,true);assert.deepEqual(f.timeline.data.items,[]);assert.equal(f.section(),null);assert.deepEqual(f.calls,[]);
 f.host.live=true;d.live=true;renderRobotHistory(f.host);assert.equal(f.history.hidden,false);assert.match(f.timeline.data.items[0].label,/^Udfald ukendt/);assert.equal(f.section(),null);assert.deepEqual(f.calls,[]);
}));
test('same timeline handles observed-empty, unknown requests and unavailable history without replacement or empty filler',()=>withDocument(()=>{
 const d=device(),f=fixture(d),timeline=f.timeline;renderRobotHistory(f.host);assert.equal(f.history.hidden,true);assert.equal(timeline.hidden,false);assert.equal(timeline.data.state,'empty');assert.equal(timeline.data.stateText,'Ingen hændelser at vise endnu.');
 d.history={status:'observed',items:[request('one','unknown')]};renderRobotHistory(f.host);assert.equal(f.history.hidden,false);assert.equal(timeline.data.items.length,1);assert.equal(timeline.data.state,'ready');
 d.history={status:'unavailable',items:[]};renderRobotHistory(f.host);assert.equal(f.history.hidden,true);assert.equal(timeline.hidden,false);assert.deepEqual(timeline.data.items,[]);assert.equal(timeline.data.state,'empty');assert.equal(timeline.data.stateText,'Hændelser er ikke tilgængelige lige nu.');assert.equal(f.timeline,timeline);assert.equal(f.history.children.length,1);assert.equal(document.getElementById('robot-history-empty'),null);assert.equal(f.section(),null);
}));
test('unchanged history performs no reassignment while a new unknown request updates the retained timeline once',()=>withDocument(()=>{
 const d=device({telemetry:{status:'observed',items:[fact('filter_time_left',40,'h')]},history:{status:'observed',items:[request('one','unknown')]}}),f=fixture(d);renderRobotHistory(f.host);let data=f.timeline.data,updates=0;
 Object.defineProperty(f.timeline,'data',{get:()=>data,set:value=>{updates++;data=value;}});f.host.state.devices=[structuredClone(d)];renderRobotHistory(f.host);renderRobotHistory(f.host);assert.equal(updates,0);assert.equal(f.section(),null);
 f.host.state.devices[0].history.items.push(request('two','unknown'));renderRobotHistory(f.host);assert.equal(updates,1);assert.equal(data.items.length,2);assert.equal(f.section(),null);
}));
test('local disconnected placeholder creates neither a Robot control task nor an empty history section',()=>withDocument(()=>{
 const f=fixture(device({id:'podview-vacuum-empty',presentationOnly:true,source:undefined,status:'unavailable',history:{status:'unavailable',items:[]}}));f.host.live=false;const view=Object.assign(Object.create(LocalRobotView.prototype),{host:f.host,button:{hidden:false},entry:{hidden:false}});f.host.localRobot=view;f.history.hidden=false;view.render();assert.equal(f.history.hidden,true);assert.equal(f.section(),null);assert.equal(view.entry.hidden,true);assert.equal(view.task,undefined);assert.deepEqual(f.calls,[]);
}));
