import test from 'node:test';
import assert from 'node:assert/strict';
import {TimerView} from '../../podvoice/gatekeeper/static/podview/timer-view.js';
import {TimerNotice} from '../../podvoice/gatekeeper/static/podview/timer-notice.js';

function element(name,writes){
 const values={hidden:false,disabled:false,textContent:''},attrs=new Map(),styles=new Map(),selectors=new Map(),listeners=new Map();
 const node={name,children:[],selectors,listeners,dataset:new Proxy({}, {set(target,key,value){writes.push(`${name}.data.${key}`);target[key]=value;return true;}}),style:{getPropertyValue:key=>styles.get(key)||'',setProperty(key,value){writes.push(`${name}.style.${key}`);styles.set(key,String(value));}},getAttribute:key=>attrs.get(key),setAttribute(key,value){writes.push(`${name}.attr.${key}`);attrs.set(key,String(value));},querySelector:selector=>selectors.get(selector),querySelectorAll:()=>[],addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);},append(child){writes.push(`${name}.append`);node.children.push(child);},insertBefore(child,before){writes.push(`${name}.insert`);node.children=node.children.filter(n=>n!==child);const index=node.children.indexOf(before);node.children.splice(index<0?node.children.length:index,0,child);},replaceChildren(){writes.push(`${name}.replaceChildren`);node.children=[];},focus(){node.focused=true;},scrollIntoView(){writes.push(`${name}.scroll`);}};
 for(const property of Object.keys(values))Object.defineProperty(node,property,{get:()=>values[property],set:value=>{writes.push(`${name}.${property}`);values[property]=value;}});
 Object.defineProperty(node,'innerHTML',{set(html){writes.push(`${name}.innerHTML`);for(const selector of ['.timer-open','.timer-count','.timer-instrument','.timer-copy strong','.timer-state','.timer-finish'])selectors.set(selector,element(`${name}${selector}`,writes));if(html.includes('timer-actions')){selectors.set('.timer-actions',element('actions',writes));const buttons=[['add','60'],['add','300'],['toggle','']].map(([action,seconds])=>{const button=element(action+seconds,writes);button.dataset.timerAction=action;button.dataset.seconds=seconds;return button;});node.querySelectorAll=selector=>selector==='[data-timer-action]'?buttons:[];}}});
 return node;
}
function fixture(){
 const writes=[],dispatched=[],form=element('form',writes),detail=element('detail',writes),overviewList=element('overview',writes),shortcut=element('shortcut',writes),note=element('note',writes),recent=element('recent',writes),list=element('detailList',writes),running=element('running',writes);
 const controls=['output','.timer-selected>span','[data-adjust="-60"]','[data-adjust="60"]','.timer-start','.timer-validation'];for(const selector of controls)form.selectors.set(selector,element(`form:${selector}`,writes));
 const presets=[1,5,10,15,30].map(n=>{const b=element(`preset:${n}`,writes);b.dataset.minutes=String(n);return b;});form.querySelectorAll=selector=>selector==='[data-minutes]'?presets:[];form.elements=[element('name',writes),element('hours',writes),element('minutes',writes),element('seconds',writes),...presets,...controls.filter(s=>s.includes('adjust')||s==='.timer-start').map(s=>form.querySelector(s))];
 for(const [selector,node]of [['.timer-active-list',list],['.timer-running',running],['#timers-live-note',note],['.timer-recent',recent]])detail.selectors.set(selector,node);
 const host={live:true,dispatch:event=>dispatched.push(event),focusHeading(){}};
 const view=Object.assign(Object.create(TimerView.prototype),{host,detail,form,overviewList,shortcut,nodes:new Map(),history:'[]',duration:300,accessModel:{connected:true,canStart:true,canCancel:true}});
 const document={getElementById:()=>null,createElement:()=>element(`card:${view.nodes.size}`,writes)};
 return {view,writes,dispatched,document,form,list};
}
const timer={id:'native-timer',name:'Pasta',status:'running',remaining:59,duration:60,deadline:190000,ownerBootId:'native-boot'};

test('unchanged timer projection performs zero DOM writes and one-second ticks only update digits, progress and necessary aria',()=>{
 const f=fixture(),prior=globalThis.document;globalThis.document=f.document;
 try{const state={connected:true,focus:'timers',timer,timerHistory:[]};f.view.render(state);const overview=f.view.nodes.get(`overview:${timer.id}`),detail=f.view.nodes.get(`detail:${timer.id}`),finish=detail.querySelector('.timer-finish');finish.focus();f.list.scrollTop=42;f.writes.length=0;
  f.view.render({...state,timer:{...timer}});assert.deepEqual(f.writes,[]);
  f.view.render({...state,timer:{...timer,remaining:58}});assert.equal(f.writes.length,6);assert.ok(f.writes.every(write=>/\.style\.--progress$|\.timer-count\.textContent$|\.timer-open\.attr\.aria-label$/.test(write)),f.writes.join('\n'));assert.equal(f.view.nodes.get(`overview:${timer.id}`),overview);assert.equal(f.view.nodes.get(`detail:${timer.id}`),detail);assert.equal(finish.focused,true);assert.equal(f.list.scrollTop,42);
 }finally{globalThis.document=prior;}
});

test('live timer retains explicit authority through countdown and switches the same completion action immediately',()=>{
 const f=fixture(),prior=globalThis.document;globalThis.document=f.document;
 try{const state={connected:true,focus:'timers',timer,timerHistory:[]};f.view.render(state);const card=f.view.nodes.get(`detail:${timer.id}`),finish=card.querySelector('.timer-finish');assert.equal(finish.disabled,false);f.writes.length=0;f.view.render({...state,timer:{...timer,remaining:58}});assert.equal(f.writes.some(write=>write.endsWith('.disabled')),false,'a tick must not revoke/regrant existing controls');
  f.view.render({...state,timer:{...timer,status:'done',remaining:0}});assert.equal(f.view.nodes.get(`detail:${timer.id}`),card);assert.equal(finish.textContent,'Stop alarm');
  for(const key of [`overview:${timer.id}`,`detail:${timer.id}`]){const completed=f.view.nodes.get(key);assert.equal(completed.querySelector('.timer-count').textContent,'Tiden er gået');assert.equal(completed.querySelector('.timer-state').textContent,'');assert.equal(completed.querySelector('.timer-state').hidden,true);assert.equal(completed.querySelector('.timer-open').getAttribute('aria-label').split('Tiden er gået').length-1,1);assert.doesNotMatch(completed.querySelector('.timer-open').getAttribute('aria-label'),/0:00/);}
  finish.listeners.get('click')();assert.deepEqual(f.dispatched,[{type:'timer',id:timer.id,action:'cancel'}]);
  f.view.render({...state,timer:{...timer,status:'done',remaining:0,physicalDrained:true}});assert.equal(finish.textContent,'Færdig');assert.equal(finish.getAttribute('aria-label'),'Færdig timer');f.view.renderAccess({connected:false});finish.listeners.get('click')();assert.equal(f.dispatched.length,1,'lost authority must disable the same retained action');
 }finally{globalThis.document=prior;}
});

test('unchanged visible TimerNotice performs zero DOM writes and does not restart its bounded pulse',()=>{
 const writes=[],elementNode=element('notice',writes);for(const selector of ['.notice-copy>span','#timer-alert-dismiss','#timer-alert-open'])elementNode.selectors.set(selector,element(selector,writes));elementNode.open=false;elementNode.showModal=()=>{elementNode.open=true;};elementNode.close=()=>{elementNode.open=false;};let scheduled=0,cleared=0;const notice=new TimerNotice({dispatch(){},focusHeading(){}},elementNode,{setTimer(){return ++scheduled;},clearTimer(){cleared++;}}),done={id:'finished',name:'Pasta',status:'done'};
 notice.render(done,'music',true);writes.length=0;notice.render({...done},'music',true);assert.deepEqual(writes,[]);assert.equal(scheduled,1);assert.equal(cleared,0);notice.cleanup();assert.equal(cleared,1);
});

test('timer observation wait marks the retained instrument busy without replacing countdown or replaying writes',()=>{
 const f=fixture(),prior=globalThis.document;globalThis.document=f.document;
 try{const state={connected:true,focus:'timers',timer,timerHistory:[]};f.view.render(state);const card=f.view.nodes.get(`detail:${timer.id}`),count=card.querySelector('.timer-count');
  f.view.renderAccess({connected:true,canCancel:true,pending:true});assert.equal(card.getAttribute('aria-busy'),'true');assert.equal(count.textContent,'0:59');assert.equal(card.querySelector('.timer-finish').disabled,true);
  f.writes.length=0;f.view.renderAccess({connected:true,canCancel:true,pending:true});assert.deepEqual(f.writes,[]);
  f.view.renderAccess({connected:true,canCancel:true});assert.equal(card.getAttribute('aria-busy'),'false');assert.equal(card.querySelector('.timer-finish').disabled,false);
 }finally{globalThis.document=prior;}
});

test('recent durations remain available to inspect when an empty timer loses connection',()=>{
 const f=fixture(),prior=globalThis.document;globalThis.document=f.document;
 try{const history=[{name:'Pasta',seconds:600}],recent=f.view.detail.querySelector('.timer-recent');recent.selectors.set('div',element('recentItems',f.writes));
  f.view.accessModel={connected:false,canStart:false,canCancel:false};f.view.render({connected:false,focus:'timers',timer:null,timerHistory:history});assert.equal(recent.hidden,false);assert.equal(f.form.querySelector('.timer-start').disabled,true);
  f.writes.length=0;f.view.render({connected:false,focus:'timers',timer:null,timerHistory:history});assert.deepEqual(f.writes,[]);
 }finally{globalThis.document=prior;}
});

test('shared recent-choice rows refill by stable recipe key without starting a timer',()=>{
 const f=fixture(),prior=globalThis.document;globalThis.document=f.document;
 try{const history=[{name:'Pasta',seconds:600},{name:'Te',seconds:180},{name:'Ovn',seconds:600}],recent=f.view.detail.querySelector('.timer-recent');recent.selectors.set('div',element('recentItems',f.writes));let filled=null;f.view.fill=item=>{filled=item;};f.view.render({connected:true,focus:'timers',timer:null,timerHistory:history});const choices=f.view.recentChoices;assert.equal(choices.dataset.reuse,'true');assert.equal(choices.data.selected,null);assert.deepEqual(choices.data.items.map(item=>[item.label,item.detail]),[['Brug 10:00 igen','Justér før start'],['Brug 3:00 igen','Justér før start']]);assert.equal(history[0].name,'Pasta');const key=choices.data.items[1].id;choices.listeners.get('pv-action')({stopPropagation(){},detail:{action_id:'choose',option_id:key}});assert.deepEqual(filled,history[1]);assert.deepEqual(f.dispatched,[]);filled=null;choices.listeners.get('pv-action')({stopPropagation(){},detail:{action_id:'choose',option_id:'foreign'}});assert.equal(filled,null);
 }finally{globalThis.document=prior;}
});

test('detail actions retain their nodes and dispatch only permitted local timer operations',()=>{
 const f=fixture(),prior=globalThis.document;globalThis.document=f.document;
 try{const local={...timer,ownerBootId:undefined,id:'local',deadline:Date.now()+59000};f.view.host.live=false;f.view.host.state={connected:true,focus:'timers',timer:local,timerHistory:[]};f.view.render(f.view.host.state);
 const detail=f.view.nodes.get('detail:local'),buttons=detail.querySelectorAll('[data-timer-action]');assert.equal(buttons.length,3);assert.equal(detail.querySelector('.timer-actions').hidden,false);buttons[0].listeners.get('click')();assert.equal(f.dispatched[0].action,'add');assert.equal(f.dispatched[0].seconds,60);assert.equal(f.dispatched[0].id,'local');
 f.view.host.state.timer={...local,status:'paused'};f.view.render(f.view.host.state);assert.equal(buttons[2].textContent,'Fortsæt');buttons[2].listeners.get('click')();assert.equal(f.dispatched[1].action,'resume');assert.equal(detail.querySelectorAll('[data-timer-action]')[0],buttons[0]);
 f.view.host.state.connected=false;f.view.render(f.view.host.state);assert(buttons.every(b=>b.disabled));buttons[1].listeners.get('click')();assert.equal(f.dispatched.length,2);
 f.view.host.live=true;f.view.host.state.connected=true;f.view.host.state.timer={...local,ownerBootId:'native'};f.view.render(f.view.host.state);assert.equal(detail.querySelector('.timer-actions').hidden,true);assert(buttons.every(b=>b.disabled));buttons[2].listeners.get('click')();assert.equal(f.dispatched.length,2);
 }finally{globalThis.document=prior;}
});

test('overview activity selection preserves timer card and manual selection through ticks',()=>{
 const f=fixture(),prior=globalThis.document;globalThis.document=f.document;
 try{
  f.view.overview=element('activitySlot',f.writes);f.view.activityChoices=element('choices',f.writes);f.view.activityResource=element('resource',f.writes);
  const state={connected:true,focus:'now',timer,timerHistory:[],devices:[]};f.view.host.state=state;f.view.render(state);f.view.renderOverviewActivities(state);
  const card=f.view.nodes.get(`overview:${timer.id}`);assert.equal(f.view.overviewSelectedId,`timer:${timer.id}`);assert.equal(f.view.overviewList.hidden,false);assert.equal(f.view.shortcut.hidden,true);
  const choiceData=f.view.activityChoices.data;f.view.renderOverviewActivities({...state,timer:{...timer,remaining:58}});
  assert.equal(f.view.nodes.get(`overview:${timer.id}`),card);assert.equal(f.view.activityChoices.data,choiceData,'ticks do not re-render the selector');
  f.view.renderOverviewActivities({...state,timer:null});assert.equal(f.view.shortcut.hidden,false);assert.equal(f.view.overviewList.hidden,true);assert.equal(card.hidden,true);
 }finally{globalThis.document=prior;}
});

test('completed timer retains actual alarm time in the existing card after bounded audio, with honest blocked-audio copy',()=>{
 const f=fixture(),prior=globalThis.document;globalThis.document=f.document;
 try{const at=new Date(2026,9,20,18,5).getTime(),done={...timer,status:'done',remaining:0};f.view.notice={completions:new Map([[timer.id,{at,exhausted:true,played:true}]])};const card=f.view.card(done,f.list,`detail:${timer.id}`);assert.equal(card.querySelector('.timer-state').textContent,'Timeren ringede kl. 18.05');f.view.notice.completions.get(timer.id).played=false;f.view.card(done,f.list,`detail:${timer.id}`);assert.equal(card.querySelector('.timer-state').textContent,'Timeren blev færdig kl. 18.05');assert.equal(f.view.nodes.get(`detail:${timer.id}`),card);
 }finally{globalThis.document=prior;}
});
test('running timer leaves its next-duration presets editable without granting a second Start',()=>{
 const f=fixture(),prior=globalThis.document;globalThis.document=f.document;
 try{f.view.host.live=false;f.view.render({connected:true,focus:'timers',timer:{...timer,ownerBootId:undefined},timerHistory:[]});assert.equal(f.form.hidden,false);assert.equal(f.view.canStart,false);for(const button of f.form.querySelectorAll('[data-minutes]'))assert.equal(button.disabled,false);assert.equal(f.form.querySelector('.timer-start').disabled,true);
 }finally{globalThis.document=prior;}
});
