import test from 'node:test';
import assert from 'node:assert/strict';
import {timerTransition} from '../../podvoice/gatekeeper/static/podview/timer-model.js';
import {TimerView} from '../../podvoice/gatekeeper/static/podview/timer-view.js';
import {TimerNotice} from '../../podvoice/gatekeeper/static/podview/timer-notice.js';
import {readFileSync} from 'node:fs';

test('overview Timer icon Button centers its grid track as well as its24px icon',()=>{
 const css=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/ui-kit.css',import.meta.url),'utf8'),legacy=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-redesign.css',import.meta.url),'utf8'),selector='pv-widget-host[data-view=active] #now-view:not([hidden])>#timer-card .timer-panel.pv-hero>.timer-open',rule=css.slice(css.indexOf(selector+'{'),css.indexOf('}',css.indexOf(selector+'{'))+1);
 assert.match(legacy,/\.timer-open\{[^}]*justify-content:flex-start/,'the retained legacy content alignment would otherwise pack the implicit track left');
 assert.match(rule,/display:grid;place-items:center;place-content:center/);assert.match(rule,/width:var\(--pv-hit\)/);assert.match(rule,/height:var\(--pv-hit\)/);assert.equal((64-24)/2,20,'the24px Icon has equal20px space inside its64px Button');
});

function element(name,writes){
 const values={hidden:false,disabled:false,textContent:''},attrs=new Map(),styles=new Map(),selectors=new Map(),listeners=new Map();
 const node={name,children:[],selectors,listeners,dataset:new Proxy({}, {set(target,key,value){writes.push(`${name}.data.${key}`);target[key]=value;return true;}}),style:{getPropertyValue:key=>styles.get(key)||'',setProperty(key,value){writes.push(`${name}.style.${key}`);styles.set(key,String(value));}},getAttribute:key=>attrs.get(key)??null,removeAttribute(key){writes.push(`${name}.remove.${key}`);attrs.delete(key);},setAttribute(key,value){writes.push(`${name}.attr.${key}`);attrs.set(key,String(value));},querySelector:selector=>selectors.get(selector),querySelectorAll:()=>[],addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);},append(child){writes.push(`${name}.append`);if(child.parentNode)child.parentNode.children=child.parentNode.children.filter(n=>n!==child);child.parentNode=node;node.children.push(child);},insertBefore(child,before){writes.push(`${name}.insert`);node.children=node.children.filter(n=>n!==child);const index=node.children.indexOf(before);node.children.splice(index<0?node.children.length:index,0,child);},replaceChildren(){writes.push(`${name}.replaceChildren`);node.children=[];},focus(){node.focused=true;},scrollIntoView(){writes.push(`${name}.scroll`);}};
 for(const property of Object.keys(values))Object.defineProperty(node,property,{get:()=>values[property],set:value=>{writes.push(`${name}.${property}`);values[property]=value;}});
 let markup='';Object.defineProperty(node,'innerHTML',{get:()=>markup,set(html){markup=html;writes.push(`${name}.innerHTML`);for(const selector of ['.timer-open','.timer-count','.timer-instrument','.timer-copy strong','.timer-state','.timer-finish'])selectors.set(selector,element(`${name}${selector}`,writes));if(html.includes('timer-actions')){selectors.set('.timer-actions',element('actions',writes));const buttons=[['toggle','']].map(([action,seconds])=>{const button=element(action+seconds,writes);button.dataset.timerAction=action;button.dataset.seconds=seconds;return button;});node.querySelectorAll=selector=>selector==='[data-timer-action]'?buttons:[];}}});
 return node;
}
function fixture(){
 const writes=[],dispatched=[],form=element('form',writes),detail=element('detail',writes),overviewList=element('overview',writes),shortcut=element('shortcut',writes),note=element('note',writes),recent=element('recent',writes),list=element('detailList',writes),running=element('running',writes);
 const controls=['output','.timer-selected>span','[data-adjust="-60"]','[data-adjust="60"]','.timer-start','.timer-validation'];for(const selector of controls)form.selectors.set(selector,element(`form:${selector}`,writes));
 const presets=[3,5,10,15].map(n=>{const b=element(`preset:${n}`,writes);b.dataset.minutes=String(n);return b;});form.querySelectorAll=selector=>selector==='[data-minutes]'?presets:[];form.elements=[element('name',writes),element('hours',writes),element('minutes',writes),element('seconds',writes),...presets,...controls.filter(s=>s.includes('adjust')||s==='.timer-start').map(s=>form.querySelector(s))];
 for(const [selector,node]of [['.timer-active-list',list],['.timer-running',running],['#timers-live-note',note],['.timer-recent',recent]])detail.selectors.set(selector,node);
 detail.append(form);detail.append(note);
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
  for(const key of [`overview:${timer.id}`,`detail:${timer.id}`]){const completed=f.view.nodes.get(key);assert.equal(completed.querySelector('.timer-count').textContent,'Tiden er gået');assert.equal(completed.querySelector('.timer-state').textContent,'');assert.equal(completed.querySelector('.timer-state').hidden,true);const label=completed.querySelector('.timer-open').getAttribute('aria-label');assert.equal(label.split('Tiden er gået').length-1,1);assert.doesNotMatch(label,/0:00/);if(key.startsWith('overview:'))assert.match(label,/Åbn timerdetaljer$/);}
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
 const detail=f.view.nodes.get('detail:local'),buttons=detail.querySelectorAll('[data-timer-action]');assert.equal(buttons.length,1);assert.equal(detail.querySelector('.timer-actions').hidden,false);buttons[0].listeners.get('click')();assert.equal(f.dispatched[0].action,'pause');assert.equal(f.dispatched[0].id,'local');
 f.view.host.state.timer={...local,status:'paused'};f.view.render(f.view.host.state);assert.equal(buttons[0].textContent,'Fortsæt');buttons[0].listeners.get('click')();assert.equal(f.dispatched[1].action,'resume');assert.equal(detail.querySelectorAll('[data-timer-action]')[0],buttons[0]);
 f.view.host.state.connected=false;f.view.render(f.view.host.state);assert(buttons.every(b=>b.disabled));buttons[0].listeners.get('click')();assert.equal(f.dispatched.length,2);
 f.view.host.live=true;f.view.host.state.connected=true;f.view.host.state.timer={...local,ownerBootId:'native'};f.view.render(f.view.host.state);assert.equal(detail.querySelector('.timer-actions').hidden,true);assert(buttons.every(b=>b.disabled));buttons[0].listeners.get('click')();assert.equal(f.dispatched.length,2);
 }finally{globalThis.document=prior;}
});

test('timer-only overview preserves its card through ticks and returns to neutral start after cancellation',()=>{
 const f=fixture(),prior=globalThis.document;globalThis.document=f.document;
 try{
  f.view.overview=element('activitySlot',f.writes);
  const state={connected:true,focus:'now',timer,timerHistory:[],devices:[]};f.view.host.state=state;f.view.render(state);f.view.renderOverviewActivities(state);
  const card=f.view.nodes.get(`overview:${timer.id}`);assert.equal(f.view.overviewSelectedId,`timer:${timer.id}`);assert.equal(f.view.overviewList.hidden,false);assert.equal(f.view.shortcut.hidden,true);
  f.view.renderOverviewActivities({...state,timer:{...timer,remaining:58}});assert.equal(f.view.nodes.get(`overview:${timer.id}`),card);assert.equal(f.view.activityChoices,undefined);assert.equal(f.view.activityResource,undefined);
  f.view.renderOverviewActivities({...state,timer:null});assert.equal(f.view.shortcut.hidden,false);assert.equal(f.view.overviewList.hidden,true);assert.equal(card.hidden,true);
 }finally{globalThis.document=prior;}
});

test('timer activity changes leave movement to the outer scene owner, including hidden detail updates and later navigation',()=>{
 const f=fixture(),prior=globalThis.document,priorMedia=globalThis.matchMedia;globalThis.document=f.document;globalThis.matchMedia=()=>({matches:false});
 try{
  f.view.overview=element('activitySlot',f.writes);f.view.overviewList.animate=f.view.shortcut.animate=()=>{throw Error('nested timer entrance must not compete with SceneMotion');};
  const empty={connected:true,focus:'timers',timer:null,timerHistory:[],devices:[]};f.view.host.state=empty;f.view.renderOverviewActivities(empty);
  const state={...empty,timer};f.view.host.state=state;f.view.renderOverviewActivities(state);const card=f.view.nodes.get(`overview:${timer.id}`);
  f.view.renderOverviewActivities({...state,focus:'now'});f.writes.length=0;f.view.renderOverviewActivities({...state,focus:'now',timer:{...timer,remaining:58}});
  assert.equal(f.view.nodes.get(`overview:${timer.id}`),card);assert.equal(f.view.activityAnimation,null);assert.equal(f.writes.some(write=>/\.innerHTML$|\.append$|\.insert$/.test(write)),false);
  f.view.renderOverviewActivities(empty);assert.equal(f.view.overviewList.hidden,true);assert.equal(f.view.shortcut.hidden,false);assert.equal(f.view.activityAnimation,null);
 }finally{globalThis.document=prior;globalThis.matchMedia=priorMedia;}
});

test('completed timer retains actual alarm time in the existing card after bounded audio, with honest blocked-audio copy',()=>{
 const f=fixture(),prior=globalThis.document;globalThis.document=f.document;
 try{const at=new Date(2026,9,20,18,5).getTime(),done={...timer,status:'done',remaining:0};f.view.notice={completions:new Map([[timer.id,{at,exhausted:true,played:true}]])};const card=f.view.card(done,f.list,`detail:${timer.id}`);assert.equal(card.querySelector('.timer-state').textContent,'Timeren ringede kl. 18.05');f.view.notice.completions.get(timer.id).played=false;f.view.card(done,f.list,`detail:${timer.id}`);assert.equal(card.querySelector('.timer-state').textContent,'Timeren blev færdig kl. 18.05');assert.equal(f.view.nodes.get(`detail:${timer.id}`),card);
 }finally{globalThis.document=prior;}
});
test('running and paused timers hide creation and prevent draft changes until cancellation',()=>{
 const f=fixture(),prior=globalThis.document;globalThis.document=f.document;
 try{f.view.host.live=false;for(const status of ['running','paused']){const current={...timer,status,ownerBootId:undefined};f.view.render({connected:true,focus:'timers',timer:current,timerHistory:[]});assert.equal(f.form.hidden,true);assert.equal(f.view.canStart,false);for(const button of f.form.querySelectorAll('[data-minutes]'))assert.equal(button.disabled,true);assert.equal(f.form.querySelector('.timer-start').disabled,true);const draft=f.view.duration;f.view.fill({seconds:180});assert.equal(f.view.duration,draft);assert.equal(f.view.currentTimer,current);}
 f.view.render({connected:true,focus:'timers',timer:{...timer,status:'cancelled'},timerHistory:[]});assert.equal(f.form.hidden,false);assert.equal(f.view.canStart,true);assert.equal(f.form.querySelector('.timer-start').disabled,false);
 }finally{globalThis.document=prior;}
});

test('recent durations stay hidden during an active timer and retain three unique recipes',()=>{const f=fixture(),previous=globalThis.document;globalThis.document={createElement:()=>element('recentChoices',f.writes),getElementById:()=>null};try{const history=[{seconds:60},{seconds:120},{seconds:60},{seconds:180},{seconds:240}],recent=f.view.detail.querySelector('.timer-recent');recent.selectors.set('div',element('recentItems',f.writes));f.view.render({connected:true,focus:'timers',timer:{id:'active',status:'running',remaining:120,total:120,endsAt:Date.now()+120000},timerHistory:history});assert.equal(recent.hidden,true);assert.deepEqual(f.view.recentChoices.data.items.map(row=>JSON.parse(row.id)),[60,120,180]);assert.deepEqual(f.dispatched,[]);}finally{globalThis.document=previous;}});

test('top slot stays Timer with combined activity and neutral without a timer while robot and Tesla retain their own state',()=>{
 const f=fixture(),prior=globalThis.document;globalThis.document=f.document;
 try{
  f.view.overview=element('timerSlot',f.writes);
  const robot={id:'robot-stable',kind:'vacuum',status:'cleaning',battery:76},vehicle={mode:'observed',source:'home_assistant_state',charging:{status:'charging'},batteryPercent:42};
  for(const domain of ['combined','robot-only','Tesla-only']){
   const state={connected:true,focus:'now',timer:domain==='combined'?timer:null,timerHistory:[],devices:domain==='Tesla-only'?[]:[robot],vehicle:domain==='robot-only'?null:vehicle};f.view.host.state=state;f.view.renderOverviewActivities(state);
   assert.equal(f.view.overview.dataset.activityKind,domain==='combined'?'timer':'empty');assert.equal(f.view.shortcut.hidden,domain==='combined');assert.equal(f.view.overviewList.hidden,domain!=='combined');assert.equal(f.view.activityChoices,undefined);assert.equal(f.view.activityResource,undefined);assert.deepEqual(f.view.overview.children,[]);assert.equal(state.devices[0],domain==='Tesla-only'?undefined:robot);assert.equal(state.vehicle,domain==='robot-only'?null:vehicle);assert.deepEqual(f.dispatched,[]);
  }
  const done={...timer,status:'done',remaining:0};f.view.renderOverviewActivities({timer:done,extraTimers:[{...timer,id:'another',status:'running'}],devices:[robot],vehicle});assert.equal(f.view.overviewActivities.length,1);assert.equal(f.view.overviewSelectedId,`timer:${timer.id}`);const card=f.view.nodes.get(`overview:${timer.id}`);assert.equal(card.querySelector('.timer-count').textContent,'Tiden er gået');assert.equal(card.querySelector('.timer-finish').textContent,'Stop alarm');
 }finally{globalThis.document=prior;}
});

test('overview reads ring and copy before two sibling actions whose native focus order is Cancel then detail',()=>{
 const f=fixture(),prior=globalThis.document;globalThis.document=f.document;
 try{
  const state={connected:true,focus:'now',timer,timerHistory:[]};f.view.host.state=state;f.view.render(state);const card=f.view.nodes.get(`overview:${timer.id}`),roots=[],stack=[],buttons=[];
  // Parse the actual produced markup, rather than inventing a fake child order.
  for(const token of card.innerHTML.matchAll(/<(\/)?([a-z][\w-]*)([^>]*)>/gi)){
   if(token[1]){stack.pop();continue;}
   const node={tag:token[2],className:/class="([^"]*)"/.exec(token[3])?.[1]||'',parent:stack.at(-1),children:[]};(node.parent?.children||roots).push(node);if(node.tag==='button')buttons.push(node);if(!['img','input','br'].includes(node.tag)&&!token[3].endsWith('/'))stack.push(node);
  }
  assert.deepEqual(roots.map(node=>node.className),['timer-instrument','timer-copy','timer-finish','timer-open']);assert.deepEqual(buttons.map(node=>node.className),['timer-finish','timer-open']);assert.ok(buttons.every(node=>!node.parent),'both controls are native siblings, with no nested action');assert.equal(buttons[1].children[0].className,'timer-chevron');
  const open=card.querySelector('.timer-open'),finish=card.querySelector('.timer-finish');assert.equal(open.getAttribute('data-kit'),'button');assert.match(open.getAttribute('aria-label'),/Timer · 0:59 · Slutter .+ · Åbn timerdetaljer/);finish.listeners.get('click')();assert.deepEqual(f.dispatched,[{type:'timer',id:timer.id,action:'cancel'}]);open.listeners.get('click')();assert.deepEqual(f.dispatched.at(-1),{type:'show',id:'timers'});
  f.view.render({...state,connected:false,timer:{...timer,status:'paused'}});f.view.renderAccess({connected:false});assert.equal(f.view.nodes.get(`overview:${timer.id}`),card);assert.equal(card.querySelector('.timer-open'),open);assert.equal(card.querySelector('.timer-finish'),finish);assert.match(open.getAttribute('aria-label'),/På pause/);assert.equal(finish.disabled,true);const count=f.dispatched.length;finish.listeners.get('click')();assert.equal(f.dispatched.length,count);open.listeners.get('click')();assert.deepEqual(f.dispatched.at(-1),{type:'show',id:'timers'},'navigation survives loss of command authority');
 }finally{globalThis.document=prior;}
});


test('stale running timer retains its measured dial but exposes the freshness state to the shared detail recipe',()=>{
 const f=fixture(),prior=globalThis.document;globalThis.document=f.document;
 try{
  const state={connected:false,focus:'timers',timer:{...timer,stale:true},timerHistory:[]};f.view.render(state);
  const card=f.view.nodes.get(`detail:${timer.id}`),count=card.querySelector('.timer-count'),status=card.querySelector('.timer-state');
  assert.equal(card.dataset.stale,'true');assert.equal(count.textContent,'0:59');assert.match(status.textContent,/sidst kendt/i);assert.equal(status.hidden,false);
  f.writes.length=0;f.view.render(state);assert.deepEqual(f.writes,[],'identical stale data must not restart the instrument');
  f.view.render({...state,connected:true,timer:{...timer,stale:false}});assert.equal(card.dataset.stale,'false');assert.equal(card.querySelector('.timer-count'),count);
 }finally{globalThis.document=prior;}
});

test('actual recent duration quick-fills a draft without persistent selection, adjusts before explicit submit, and active timer hides draft/history',()=>{
 const f=fixture(),previous=globalThis.document;globalThis.document={createElement:()=>element('recentChoices',f.writes),getElementById:()=>null};
 try{
  f.view.host.live=false;const state={connected:true,focus:'timers',timer:null,timerSerial:0,timerHistory:[{seconds:600},{seconds:180},{seconds:NaN},{seconds:-1},{seconds:86401},{seconds:'60'},{seconds:600}]};f.view.host.state=state;f.view.host.dispatch=event=>{f.dispatched.push(event);f.view.host.state=event.type==='show'?{...f.view.host.state,focus:event.id}:timerTransition(f.view.host.state,event);};f.view.inputs={hours:{value:'0'},minutes:{value:'5'},seconds:{value:'0'}};f.view.detail.querySelector('.timer-recent').selectors.set('div',element('recentItems',f.writes));f.view.render(state);assert.deepEqual(f.view.recentChoices.data.items.map(item=>JSON.parse(item.id)),[600,180]);
  const choose=key=>f.view.recentChoices.listeners.get('pv-action')({stopPropagation(){},detail:{action_id:'choose',option_id:key}});choose('600');assert.equal(f.view.duration,600);assert.equal(f.view.inputs.minutes.value,10);assert.equal(f.form.querySelector('output').textContent,'10:00');assert.equal(f.view.recentChoices.data.selected,null);assert(f.form.querySelectorAll('[data-minutes]').every(button=>button.getAttribute('aria-pressed')==='false'));assert.deepEqual(f.dispatched,[]);assert.equal(f.view.host.state.timer,null);
  f.view.fill({seconds:660});assert.equal(f.view.duration,660);assert.equal(f.view.recentChoices.data.selected,null);assert.deepEqual(f.dispatched,[]);
  const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/timer-view.js',import.meta.url),'utf8'),start=source.indexOf("this.form.addEventListener('submit',"),body=source.slice(start,source.indexOf("\n  for(const b",start)),register=new Function('host',body.replace('this.form.addEventListener','this.form.addEventListener'));register.call(f.view,f.view.host);f.form.listeners.get('submit')({preventDefault(){}});assert.equal(f.dispatched.length,2);assert.deepEqual(f.dispatched[1],{type:'show',id:'now'});assert.equal(f.view.host.state.focus,'now');assert.equal(f.dispatched[0].type,'timer-start');assert.equal(f.dispatched[0].seconds,660);f.view.render(f.view.host.state);assert.equal(f.form.hidden,true);assert.equal(f.view.detail.querySelector('.timer-recent').hidden,true);const duration=f.view.duration;choose('180');assert.equal(f.view.duration,duration);assert.equal(f.dispatched.length,2);
 }finally{globalThis.document=previous;}
});


test('start return token waits for exact owner success and expires on leave, scope change, cleanup or replacement',()=>{
 const f=fixture();f.view.host.live=false;f.view.host.state={focus:'timers',sessionId:'s',generation:1};f.view.host.liveSnapshot={bootId:'b',roomId:'r'};const token=()=>({sessionId:'s',generation:1,bootId:'b',roomId:'r'});
 const pending=token();f.view.startNavigation=pending;assert.deepEqual(f.dispatched,[],'pending/rejected/unknown cannot navigate without the owner callback');f.view.completeStartNavigation({ ...pending });assert.deepEqual(f.dispatched,[],'another request identity cannot complete');f.view.completeStartNavigation(pending);assert.deepEqual(f.dispatched,[{type:'show',id:'now'}]);f.view.completeStartNavigation(pending);assert.equal(f.dispatched.length,1);
 for(const change of [{focus:'music'},{sessionId:'other'},{generation:2}]){f.view.host.state={focus:'timers',sessionId:'s',generation:1,...change};const current=token();f.view.startNavigation=current;f.view.completeStartNavigation(current);assert.equal(f.dispatched.length,1);}
 f.view.host.state={focus:'timers',sessionId:'s',generation:1};const old=token(),newer=token();f.view.startNavigation=newer;f.view.completeStartNavigation(old);assert.equal(f.view.startNavigation,newer);assert.equal(f.dispatched.length,1);f.view.host.live=true;f.view.host.liveSnapshot={bootId:'changed',roomId:'r'};f.view.completeStartNavigation(newer);assert.equal(f.dispatched.length,1);
 const cleaned=token();f.view.startNavigation=cleaned;f.view.cleanup();f.view.completeStartNavigation(cleaned);assert.equal(f.dispatched.length,1);
});


test('live start navigation requires the exact current fresh observed timer and leaves playback intact',()=>{
 const f=fixture(),playback={track:4,room:'Køkkenet'},state={focus:'timers',sessionId:'s',generation:1,music:{playback}};f.view.host.state=state;f.view.host.live=true;
 const token=()=>({sessionId:'s',generation:1,bootId:'b',roomId:'r',epoch:7}),snapshot=items=>({bootId:'b',roomId:'r',timers:{status:'observed',epoch:7,items}}),fresh={id:'exact',status:'running',stale:false};
 for(const value of [snapshot([]),snapshot([{...fresh,id:'other'}]),snapshot([{...fresh,stale:true}]),snapshot([{...fresh,status:'done'}]),{...snapshot([fresh]),timers:{...snapshot([fresh]).timers,status:'unavailable'}},{...snapshot([fresh]),timers:{...snapshot([fresh]).timers,epoch:8}}]){f.view.host.liveSnapshot=value;const current=token();f.view.startNavigation=current;f.view.completeStartNavigation(current,'exact');assert.deepEqual(f.dispatched,[]);}
 f.view.host.liveSnapshot=snapshot([fresh]);const current=token();f.view.startNavigation=current;f.view.completeStartNavigation(current,'exact');assert.deepEqual(f.dispatched,[{type:'show',id:'now'}]);assert.equal(f.view.host.state.music.playback,playback);
});

test('dismissed finished timer retains exact activity and actions without a floating Timer label or native name',()=>{
 const f=fixture(),prior=globalThis.document;globalThis.document=f.document;
 try{
  f.view.overview={dataset:{}};const base={connected:true,focus:'now',timer:{...timer,name:'Pasta',status:'running'},timerHistory:[]};f.view.host.state=base;f.view.render(base);const overview=f.view.nodes.get(`overview:${timer.id}`),detail=f.view.nodes.get(`detail:${timer.id}`),title=overview.querySelector('.timer-copy strong');assert.equal(title.textContent,'Timer');assert.equal(title.hidden,false);assert.equal(overview.dataset.kitTone,'dark');assert.equal(detail.dataset.kitTone,'dark');
  const done={...base,timer:{...base.timer,status:'done',remaining:0,noticeDismissed:true,physicalDrained:true}};f.view.host.state=done;f.view.render(done);f.view.renderOverviewActivities(done);assert.equal(f.view.nodes.get(`overview:${timer.id}`),overview);assert.equal(title.hidden,true);assert.equal(title.textContent,'');assert.equal(overview.querySelector('.timer-count').textContent,'Tiden er gået');assert.equal(overview.hidden,false);assert.equal(overview.dataset.timerId,timer.id);assert.equal(overview.querySelector('.timer-finish').textContent,'Færdig');assert.doesNotMatch(overview.querySelector('.timer-open').getAttribute('aria-label'),/Pasta/);assert.equal(f.view.shortcut.hidden,true);assert.deepEqual(f.dispatched,[],'dismissed alarm does not remove the finished activity');
  overview.querySelector('.timer-finish').listeners.get('click')();assert.deepEqual(f.dispatched,[{type:'timer',id:timer.id,action:'cancel'}]);
  f.view.render(base);assert.equal(title.textContent,'Timer');assert.equal(title.hidden,false);assert.equal(f.view.nodes.get(`detail:${timer.id}`),detail);
  const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/timer-view.js',import.meta.url),'utf8');assert.match(source,/<form class="timer-create pv-card" data-kit-tone="dark"/);assert.match(source,/seconds:this\.duration,name:''/);assert.doesNotMatch(source,/<input[^>]*name="name"/);
 }finally{globalThis.document=prior;}
});

test('one retained feedback slot follows only the visible timer surface across unknown, replacement and reset',()=>{
 const f=fixture(),prior=globalThis.document;globalThis.document=f.document;
 try{
  const view=f.view,note=view.detail.querySelector('#timers-live-note'),unknown='Udfald ukendt · handlingen gentages ikke',empty={connected:true,focus:'timers',timer:null,timerHistory:[]};
  view.host.state=empty;view.render(empty);view.renderAccess({connected:true,canStart:true,awaitingObservation:true,feedback:unknown});
  assert.equal(note.parentNode,f.form);assert.equal(note.dataset.kitSlot,'feedback');assert.equal(note.textContent,unknown);assert.equal(note.hidden,false);assert.equal(view.canStart,false);assert.equal(f.form.hidden,false);
  f.writes.length=0;view.renderAccess({connected:true,canStart:true,awaitingObservation:true,feedback:unknown});assert.deepEqual(f.writes,[],'unchanged feedback neither moves nor rewrites its retained slot');
  const first={...empty,timer};view.host.state=first;view.render(first);const firstCard=view.nodes.get(`detail:${timer.id}`),firstOverview=view.nodes.get(`overview:${timer.id}`);
  assert.equal(note.parentNode,firstCard);assert.equal(f.form.children.includes(note),false);assert.equal(firstOverview.children.includes(note),false);assert.equal(firstCard.hidden,false);assert.equal(firstCard.querySelector('.timer-count').textContent,'0:59');
  const second={...empty,timer:{...timer,id:'replacement',remaining:120,duration:180}};view.host.state=second;view.render(second);const secondCard=view.nodes.get('detail:replacement');
  assert.equal(view.detail.querySelector('#timers-live-note'),note);assert.equal(note.parentNode,secondCard);assert.equal(firstCard.hidden,true);assert.equal(firstCard.children.includes(note),false);assert.equal(view.nodes.get('overview:replacement').children.includes(note),false);assert.equal(secondCard.querySelector('.timer-count').textContent,'2:00');
  view.renderAccess({connected:true,canCancel:true,feedback:''});assert.equal(note.hidden,true);assert.equal(note.textContent,'');assert.equal(note.parentNode,secondCard);assert.equal(view.canCancel,true);
  view.host.state=empty;view.render(empty);assert.equal(note.parentNode,f.form);assert.equal(f.form.hidden,false);assert.equal(secondCard.hidden,true);assert.equal(secondCard.children.includes(note),false);assert.equal(note.hidden,true);assert.equal(view.detail.querySelector('#timers-live-note'),note);assert.deepEqual(f.dispatched,[]);
 }finally{globalThis.document=prior;}
});
