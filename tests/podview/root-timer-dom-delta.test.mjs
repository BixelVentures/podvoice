import test from 'node:test';
import assert from 'node:assert/strict';
import {TimerView} from '../../podvoice/gatekeeper/static/podview/timer-view.js';
import {TimerNotice} from '../../podvoice/gatekeeper/static/podview/timer-notice.js';

function element(name,writes){
 const values={hidden:false,disabled:false,textContent:''},attrs=new Map(),styles=new Map(),selectors=new Map(),listeners=new Map();
 const node={name,children:[],selectors,listeners,dataset:new Proxy({}, {set(target,key,value){writes.push(`${name}.data.${key}`);target[key]=value;return true;}}),style:{getPropertyValue:key=>styles.get(key)||'',setProperty(key,value){writes.push(`${name}.style.${key}`);styles.set(key,String(value));}},getAttribute:key=>attrs.get(key),setAttribute(key,value){writes.push(`${name}.attr.${key}`);attrs.set(key,String(value));},querySelector:selector=>selectors.get(selector),querySelectorAll:()=>[],addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);},append(child){writes.push(`${name}.append`);node.children.push(child);},insertBefore(child,before){writes.push(`${name}.insert`);node.children=node.children.filter(n=>n!==child);const index=node.children.indexOf(before);node.children.splice(index<0?node.children.length:index,0,child);},replaceChildren(){writes.push(`${name}.replaceChildren`);node.children=[];},focus(){node.focused=true;},scrollIntoView(){writes.push(`${name}.scroll`);}};
 for(const property of Object.keys(values))Object.defineProperty(node,property,{get:()=>values[property],set:value=>{writes.push(`${name}.${property}`);values[property]=value;}});
 Object.defineProperty(node,'innerHTML',{set(){writes.push(`${name}.innerHTML`);for(const selector of ['.timer-open','.timer-count','.timer-instrument','.timer-copy strong','.timer-state','.timer-finish'])selectors.set(selector,element(`${name}${selector}`,writes));}});
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
  f.view.render({...state,timer:{...timer,status:'done',remaining:0}});assert.equal(f.view.nodes.get(`detail:${timer.id}`),card);assert.equal(finish.textContent,'Stop alarm');finish.listeners.get('click')();assert.deepEqual(f.dispatched,[{type:'timer',id:timer.id,action:'cancel'}]);
  f.view.render({...state,timer:{...timer,status:'done',remaining:0,physicalDrained:true}});assert.equal(finish.textContent,'Færdig');assert.equal(finish.getAttribute('aria-label'),'Færdig Pasta');f.view.renderAccess({connected:false});finish.listeners.get('click')();assert.equal(f.dispatched.length,1,'lost authority must disable the same retained action');
 }finally{globalThis.document=prior;}
});

test('unchanged visible TimerNotice performs zero DOM writes and does not reset its expiry',()=>{
 const writes=[],elementNode=element('notice',writes);for(const selector of ['.notice-copy>span','#timer-alert-dismiss','#timer-alert-open'])elementNode.selectors.set(selector,element(selector,writes));let scheduled=0,cleared=0;const notice=new TimerNotice({dispatch(){},focusHeading(){}},elementNode,{setTimer(){return ++scheduled;},clearTimer(){cleared++;}}),done={id:'finished',name:'Pasta',status:'done'};
 notice.render(done,'music',true);writes.length=0;notice.render({...done},'music',true);assert.deepEqual(writes,[]);assert.equal(scheduled,1);assert.equal(cleared,0);notice.cleanup();assert.equal(cleared,1);
});
