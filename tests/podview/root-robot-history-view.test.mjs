import test from 'node:test';
import assert from 'node:assert/strict';
import {renderRobotHistory} from '../../podvoice/gatekeeper/static/podview/live-home-view.js';

class Node {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.hidden=false;this.attributes={};this.listeners={};}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 querySelector(tag){return this.children.flatMap(node=>[node,...node.descendants()]).find(node=>node.tagName===tag)||null;}
 descendants(){return this.children.flatMap(node=>[node,...node.descendants()]);}
 closest(){return this.parent||this;}
 setAttribute(name,value){this.attributes[name]=value;}
 addEventListener(name,handler){this.listeners[name]=handler;}
}
function fixture(device,allowed=false){
 const root=new Node(),history=new Node('section'),timeline=new Node('pv-activity-timeline');root.append(history);history.append(timeline);root.id='device-view';timeline.id='device-timeline';
 globalThis.document={createElement:tag=>new Node(tag),getElementById:id=>[root,...root.descendants()].find(node=>node.id===id)||null};
 const calls=[],host={state:{focus:device.id,devices:[device]},liveControls:{allowed:()=>allowed,openRobot:(button,id)=>calls.push(id)}};
 return {root,history,timeline,host,calls,section:()=>document.getElementById('robot-recent')};
}
const now=()=>Date.now()/1000;
const fact=(key,value,unit=null)=>({key,entityId:`sensor.${key}`,value,unit,updatedAt:now(),retrievedAt:now(),stale:false});
const device=(extra={})=>({id:'vacuum.actual',kind:'vacuum',live:true,status:'docked',stale:false,history:{status:'observed',items:[]},telemetry:{status:'observed',items:[]},...extra});
const request=(id,outcome='accepted_by_ha')=>({id,recordedAt:now()-50,outcome,recipe:{mapName:'Stueetage',areaIds:['actual-area'],repeat:1}});
function withDocument(run){const previous=globalThis.document;try{run();}finally{globalThis.document=previous;}}

test('missing live history keeps canonical section and neutral copy for cleaning/fault/stale',()=>withDocument(()=>{
 for(const status of ['cleaning','fault','docked'])for(const stale of [false,true])for(const historyStatus of ['observed','unavailable']){
  const f=fixture(device({status,stale,history:{status:historyStatus,items:[]}}));renderRobotHistory(f.host);
  assert.equal(f.history.hidden,false);assert.equal(f.timeline.hidden,false);
  assert.equal(document.getElementById('robot-history-empty'),null);assert.equal(f.timeline.data.state,'empty');assert.equal(f.timeline.data.stateText,historyStatus==='observed'?'Ingen hændelser at vise endnu.':'Hændelser er ikke tilgængelige lige nu.');
  assert.deepEqual(f.timeline.data.items,[]);assert.equal(f.section().descendants().some(node=>node.className==='robot-recipe-row'),false);
 }
}));

test('independent native start/end facts use shared timeline, source order and stale labels without completion inference',()=>withDocument(()=>{
 const d=device({stale:true,telemetry:{status:'observed',items:[fact('last_clean_start',now()-2000),fact('last_clean_end',now()-1000)]}}),before=JSON.stringify(d),f=fixture(d);
 renderRobotHistory(f.host);assert.equal(f.history.hidden,false);assert.equal(f.timeline.hidden,false);
 assert.deepEqual(f.timeline.data.items.map(x=>x.id),['robot-fact:last_clean_end','robot-fact:last_clean_start']);
 assert.deepEqual(f.timeline.data.items.map(x=>x.label),['Senest afsluttet · sidst kendt','Senest startet · sidst kendt']);
 assert.equal(f.section().descendants().some(node=>node.textContent==='Seneste rengøring'),false);assert.equal(JSON.stringify(d),before);
}));

test('shared device renderer overwrite is repaired on every render even when history signature is unchanged',()=>withDocument(()=>{
 const f=fixture(device({telemetry:{status:'observed',items:[fact('last_clean_end',now()-100)]}}));renderRobotHistory(f.host);
 const before=f.timeline.data;f.timeline.data={items:[]};renderRobotHistory(f.host);
 assert.deepEqual(f.timeline.data,before);assert.equal(f.timeline.hidden,false);
}));

test('request journal shares canonical history; unknown never offers reuse or claims completion',()=>withDocument(()=>{
 const accepted=request('accepted'),unknown=request('unknown','unknown');accepted.recordedAt=unknown.recordedAt+1;
 const f=fixture(device({history:{status:'observed',items:[accepted,unknown]}}),true);renderRobotHistory(f.host);
 assert.equal(f.history.hidden,false);assert.equal(f.timeline.hidden,false);
 assert.equal(f.section().querySelector('pv-activity-timeline'),null);
 assert.equal(f.section().descendants().some(node=>node.textContent==='Senest anmodet'),false);
 assert.match(f.timeline.data.items[0].label,/^Start anmodet/);assert.match(f.timeline.data.items[1].label,/^Udfald ukendt/);
 assert.equal(f.timeline.data.items.some(row=>/afsluttet|færdig/i.test(row.label)),false);
 const buttons=f.section().descendants().filter(node=>node.tagName==='button');assert.equal(buttons.length,1);assert.equal(buttons[0].className,'pv-button pv-ghost');buttons[0].listeners.click();assert.deepEqual(f.calls,['accepted']);
 assert.equal(document.getElementById('robot-history-empty'),null);
 assert.deepEqual(f.timeline.data.items.map(row=>row.id),['robot-request:accepted','robot-request:unknown']);
}));

test('observed facts and request journal interleave by source timestamps without implying completion',()=>withDocument(()=>{
 const start=fact('last_clean_start',now()-120),end=fact('last_clean_end',now()-10);
 const older=request('older');older.recordedAt=now()-180;
 const middle=request('middle','unknown');middle.recordedAt=now()-60;
 const f=fixture(device({telemetry:{status:'observed',items:[start,end]},history:{status:'observed',items:[older,middle]}}));renderRobotHistory(f.host);
 assert.deepEqual(f.timeline.data.items.map(row=>row.id),['robot-fact:last_clean_end','robot-request:middle','robot-fact:last_clean_start','robot-request:older']);
 assert.match(f.timeline.data.items[1].label,/^Udfald ukendt/);
 assert.equal(f.section().querySelector('pv-activity-timeline'),null);
}));

test('all existing rich facts and open disclosure survive; grant removal removes reuse only',()=>withDocument(()=>{
 const f=fixture(device({telemetry:{status:'observed',items:[fact('filter_time_left',-12,'h'),fact('battery',56,'%'),{...fact('child_lock',false),entityId:'switch.child_lock'}]},history:{status:'observed',items:[request('saved')]}}),true);
 renderRobotHistory(f.host);const details=f.section().querySelector('details');details.open=true;
 assert.ok(details.descendants().some(node=>node.tagName==='dt'&&node.textContent==='Filter'));assert.ok(details.descendants().some(node=>node.tagName==='dd'&&node.textContent==='12 timer over interval'));assert.ok(details.descendants().some(node=>node.tagName==='dt'&&node.textContent==='Børnelås'));assert.ok(details.descendants().some(node=>node.tagName==='dd'&&node.textContent==='Nej'));
 f.host.liveControls.allowed=()=>false;renderRobotHistory(f.host);assert.equal(f.section().querySelector('details').open,true);
 assert.equal(f.section().descendants().some(node=>node.tagName==='button'),false);
}));

test('return to canonical local/light detail restores timeline visibility and hides live-only content',()=>withDocument(()=>{
 const f=fixture(device({history:{status:'observed',items:[request('recent')]}}));renderRobotHistory(f.host);f.host.state.devices=[{id:'light',kind:'light',live:false}];f.host.state.focus='light';
 renderRobotHistory(f.host);assert.equal(f.history.hidden,false);assert.equal(f.timeline.hidden,false);assert.equal(f.section().hidden,true);assert.equal(document.getElementById('robot-history-empty'),null);
}));

test('existing care disclosure contains semantic groups and dl rows, not new history/cards',()=>withDocument(()=>{const stale=fact('dock_error','water_empty');stale.stale=true;stale.updatedAt=now()-600;const f=fixture(device({telemetry:{status:'observed',items:[fact('filter_time_left',-80.1,'h'),stale,{...fact('dnd_start_time','22:00:00'),entityId:'time.dnd_start_time'}]}}));renderRobotHistory(f.host);const details=f.section().querySelector('details');assert.equal(details.children[0].textContent,'Pleje og indstillinger');assert.deepEqual(details.descendants().filter(n=>n.tagName==='h3').map(n=>n.textContent),['Vedligeholdelse','Dock og vand','Indstillinger']);assert.equal(details.descendants().filter(n=>n.tagName==='dl').length,3);assert.equal(details.descendants().filter(n=>n.tagName==='dt').length,3);assert.equal(details.descendants().filter(n=>n.tagName==='dd').length,3);assert.ok(details.descendants().some(n=>n.textContent==='Mangler vand · sidst kendt'));assert.equal(details.descendants().some(n=>n.tagName==='button'||n.tagName==='pv-activity-timeline'),false);}));
test('empty care groups are omitted and zero is retained',()=>withDocument(()=>{const f=fixture(device({telemetry:{status:'observed',items:[fact('filter_time_left',0,'h')]}}));renderRobotHistory(f.host);const details=f.section().querySelector('details');assert.deepEqual(details.descendants().filter(n=>n.tagName==='h3').map(n=>n.textContent),['Vedligeholdelse']);assert.ok(details.descendants().some(n=>n.textContent==='0 timer tilbage'));}));

test('same canonical timeline survives observed empty, real events and unavailable transitions',()=>withDocument(()=>{const d=device(),f=fixture(d),timeline=f.timeline;renderRobotHistory(f.host);assert.equal(f.timeline,timeline);assert.equal(timeline.hidden,false);d.history={status:'observed',items:[request('one')]};renderRobotHistory(f.host);assert.equal(timeline.data.items.length,1);assert.equal(timeline.data.state,'ready');d.history={status:'unavailable',items:[]};renderRobotHistory(f.host);assert.equal(timeline.hidden,false);assert.equal(timeline.data.items.length,0);assert.equal(timeline.data.state,'empty');assert.equal(f.history.children.length,1);assert.equal(document.getElementById('robot-history-empty'),null);}));
