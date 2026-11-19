// Ported from tests/podview/root-timer-dom-delta.test.mjs (node:test + fake DOM) to Vitest with a real DOM, when
// the timer screen moved to React. Same assertions. Adaptations: the fake view built with Object.create became a
// real TimerView on the shell (timer-fixture.js); `writes` observes real DOM mutations under the fake DOM's names;
// listener calls became clicks/submit events; fake child arrays became [...children]; `.focused` became
// document.activeElement; the ±1 min buttons are found by their delta (the fake listed them in the wrong order);
// source-text checks of the old timer-view.js became checks of the rendered DOM and the dispatched event.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'vitest';
import {timerTransition} from '../../../timer-model.js';
import {TimerNotice} from '../../../timer-notice.js';
import {click, mountTimer, recordWrites} from './timer-fixture.js';

const podview = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = name => readFileSync(resolve(podview, name), 'utf8');

test('overview Timer icon Button centers its grid track as well as its24px icon',()=>{
 const css=read('ui-kit.css'),legacy=read('widget-redesign.css'),selector='pv-widget-host[data-view=active] #now-view:not([hidden])>#timer-card .timer-panel.pv-hero>.timer-open',rule=css.slice(css.indexOf(selector+'{'),css.indexOf('}',css.indexOf(selector+'{'))+1);
 assert.match(legacy,/\.timer-open\{[^}]*justify-content:flex-start/,'the retained legacy content alignment would otherwise pack the implicit track left');
 assert.match(rule,/display:grid;place-items:center;place-content:center/);assert.match(rule,/width:var\(--pv-hit\)/);assert.match(rule,/height:var\(--pv-hit\)/);assert.equal((64-24)/2,20,'the24px Icon has equal20px space inside its64px Button');
});

function fixture(){
 const dispatched=[],host={live:true,dispatch:event=>dispatched.push(event),focusHeading(){}};
 const view=mountTimer(host);view.accessModel={connected:true,canStart:true,canCancel:true};view.history='[]';
 const form=view.form,list=view.detail.querySelector('.timer-running .timer-active-list');
 return {view,writes:recordWrites(),dispatched,form,list};
}
const timer={id:'native-timer',name:'Pasta',status:'running',remaining:59,duration:60,deadline:190000,ownerBootId:'native-boot'};
const adjustButtons=card=>{const buttons=[...card.querySelectorAll('[data-timer-action]')];return {buttons,minus:buttons.find(b=>b.dataset.deltaSeconds==='-60'),plus:buttons.find(b=>b.dataset.deltaSeconds==='60')};};

test('unchanged timer projection performs zero DOM writes and one-second ticks only update digits, progress and necessary aria',()=>{
 const f=fixture();
 const state={connected:true,focus:'timers',timer,timerHistory:[]};f.view.render(state);const overview=f.view.nodes.get(`overview:${timer.id}`),detail=f.view.nodes.get(`detail:${timer.id}`),finish=detail.querySelector('.timer-finish');finish.focus();f.list.scrollTop=42;f.writes.length=0;
 f.view.render({...state,timer:{...timer}});assert.deepEqual([...f.writes],[]);
 // P5 (docs/MOTION.md §3.6): the first tick marks the rings as ticking (data-pv-progress, its interval) once.
 f.view.render({...state,timer:{...timer,remaining:58}});assert.deepEqual(f.writes.filter(write=>/\.data\.pvProgress$|\.style\.--pv-progress-interval$/.test(write)).length,4);f.writes.length=0;
 f.view.render({...state,timer:{...timer,remaining:57}});assert.equal(f.writes.length,6);assert.ok(f.writes.every(write=>/\.style\.--progress$|\.timer-count\.textContent$|\.timer-open\.attr\.aria-label$/.test(write)),f.writes.join('\n'));assert.equal(f.view.nodes.get(`overview:${timer.id}`),overview);assert.equal(f.view.nodes.get(`detail:${timer.id}`),detail);assert.equal(document.activeElement,finish);assert.equal(f.list.scrollTop,42);
});

test('live timer retains explicit authority through countdown and switches the same completion action immediately',()=>{
 const f=fixture();
 const state={connected:true,focus:'timers',timer,timerHistory:[]};f.view.render(state);const card=f.view.nodes.get(`detail:${timer.id}`),finish=card.querySelector('.timer-finish');assert.equal(finish.disabled,false);f.writes.length=0;f.view.render({...state,timer:{...timer,remaining:58}});assert.equal(f.writes.some(write=>write.endsWith('.disabled')),false,'a tick must not revoke/regrant existing controls');
 f.view.render({...state,timer:{...timer,status:'done',remaining:0}});assert.equal(f.view.nodes.get(`detail:${timer.id}`),card);assert.equal(finish.textContent,'Stop alarm');
 for(const key of [`overview:${timer.id}`,`detail:${timer.id}`]){const completed=f.view.nodes.get(key),detail=key.startsWith('detail:');assert.equal(completed.querySelector('.timer-count').textContent,detail?'0:00':'Tiden er gået');assert.equal(completed.querySelector('.timer-state').textContent,detail?'Alarmen ringer, til du stopper den.':'');assert.equal(completed.querySelector('.timer-state').hidden,!detail);const label=completed.querySelector('.timer-open').getAttribute('aria-label');assert.equal(label.split('Tiden er gået').length-1,1);if(!detail)assert.doesNotMatch(label,/0:00/);if(key.startsWith('overview:'))assert.match(label,/Åbn timerdetaljer$/);}
 click(finish);assert.deepEqual(f.dispatched,[{type:'timer',id:timer.id,action:'cancel'}]);
 f.view.render({...state,timer:{...timer,status:'done',remaining:0,physicalDrained:true}});assert.equal(finish.textContent,'Færdig');assert.equal(finish.getAttribute('aria-label'),'Færdig timer');f.view.renderAccess({connected:false});click(finish);assert.equal(f.dispatched.length,1,'lost authority must disable the same retained action');
});

test('unchanged visible TimerNotice performs zero DOM writes and does not restart its bounded pulse',()=>{
 mountTimer({live:true,dispatch(){},focusHeading(){}});const elementNode=document.getElementById('timer-alert'),writes=recordWrites();let scheduled=0,cleared=0;const notice=new TimerNotice({dispatch(){},focusHeading(){}},elementNode,{setTimer(){return ++scheduled;},clearTimer(){cleared++;}}),done={id:'finished',name:'Pasta',status:'done'};
 notice.render(done,'music',true);writes.length=0;notice.render({...done},'music',true);assert.deepEqual([...writes],[]);assert.equal(scheduled,1);assert.equal(cleared,0);notice.cleanup();assert.equal(cleared,1);
});

test('timer observation wait marks the retained instrument busy without replacing countdown or replaying writes',()=>{
 const f=fixture();
 const state={connected:true,focus:'timers',timer,timerHistory:[]};f.view.render(state);const card=f.view.nodes.get(`detail:${timer.id}`),count=card.querySelector('.timer-count');
 f.view.renderAccess({connected:true,canCancel:true,pending:true});assert.equal(card.getAttribute('aria-busy'),'true');assert.equal(count.textContent,'0:59');assert.equal(card.querySelector('.timer-finish').disabled,true);
 f.writes.length=0;f.view.renderAccess({connected:true,canCancel:true,pending:true});assert.deepEqual([...f.writes],[]);
 f.view.renderAccess({connected:true,canCancel:true});assert.equal(card.getAttribute('aria-busy'),'false');assert.equal(card.querySelector('.timer-finish').disabled,false);
});

const recentList=f=>f.view.detail.querySelector('.timer-recent .timer-recent-list');
const recentRows=list=>[...list.children].map(button=>[Number(button.dataset.recentSeconds),button.getAttribute('aria-label')]);
test('recent durations remain available to inspect when an empty timer loses connection',()=>{
 const f=fixture();
 const history=[{name:'Pasta',seconds:600}],recent=f.view.detail.querySelector('.timer-recent'),list=recentList(f);
 f.view.accessModel={connected:false,canStart:false,canCancel:false};f.view.render({connected:false,focus:'timers',timer:null,timerHistory:history});assert.equal(recent.hidden,false);assert.equal(f.form.querySelector('.timer-start').disabled,true);assert.equal(list.children[0].disabled,true);
 f.writes.length=0;f.view.render({connected:false,focus:'timers',timer:null,timerHistory:history});assert.deepEqual([...f.writes],[]);
});

// Lærred »A-Timer« »Tidligere timere«: newest first as »Seneste«, the rest »Tidligere«; a tap fills the draft only.
test('recent timer pills refill the draft by duration without starting a timer',()=>{
 const f=fixture();
 const history=[{name:'Pasta',seconds:600},{name:'Te',seconds:180},{name:'Ovn',seconds:600}],list=recentList(f);let filled=null;f.view.fill=item=>{filled=item;};f.view.render({connected:true,focus:'timers',timer:null,timerHistory:history});
 assert.deepEqual(recentRows(list),[[600,'10:00, Seneste. Justér før start'],[180,'3:00, Tidligere. Justér før start']]);assert.equal(history[0].name,'Pasta');click(list.children[1]);assert.deepEqual(filled,{seconds:180});assert.deepEqual(f.dispatched,[]);
});

test('detail actions retain their nodes and dispatch only permitted local timer operations',()=>{
 const f=fixture();
 const local={...timer,ownerBootId:undefined,id:'local',deadline:Date.now()+59000};f.view.host.live=false;f.view.host.state={connected:true,focus:'timers',timer:local,timerHistory:[]};f.view.render(f.view.host.state);
 const detail=f.view.nodes.get('detail:local'),buttons=[...detail.querySelectorAll('[data-timer-action]')];assert.equal(buttons.filter(button=>!button.hidden).length,1);assert.equal(detail.querySelector('.timer-actions').hidden,false);click(buttons[0]);assert.equal(f.dispatched[0].action,'pause');assert.equal(f.dispatched[0].id,'local');
 f.view.host.state.timer={...local,status:'paused'};f.view.render(f.view.host.state);assert.equal(buttons[0].textContent,'Fortsæt');click(buttons[0]);assert.equal(f.dispatched[1].action,'resume');assert.equal(detail.querySelectorAll('[data-timer-action]')[0],buttons[0]);
 f.view.host.state.connected=false;f.view.render(f.view.host.state);assert(buttons.every(b=>b.disabled));click(buttons[0]);assert.equal(f.dispatched.length,2);
 f.view.host.live=true;f.view.host.state.connected=true;f.view.host.state.timer={...local,ownerBootId:'native'};f.view.render(f.view.host.state);assert.equal(detail.querySelector('.timer-actions').hidden,true);assert(buttons.every(b=>b.disabled));click(buttons[0]);assert.equal(f.dispatched.length,2);
});

test('timer-only overview preserves its card through ticks and returns to neutral start after cancellation',()=>{
 const f=fixture();
 const state={connected:true,focus:'now',timer,timerHistory:[],devices:[]};f.view.host.state=state;f.view.render(state);f.view.renderOverviewActivities(state);
 const card=f.view.nodes.get(`overview:${timer.id}`);assert.equal(f.view.overviewSelectedId,`timer:${timer.id}`);assert.equal(f.view.overviewList.hidden,false);assert.equal(f.view.shortcut.hidden,true);
 f.view.renderOverviewActivities({...state,timer:{...timer,remaining:58}});assert.equal(f.view.nodes.get(`overview:${timer.id}`),card);assert.equal(f.view.activityChoices,undefined);assert.equal(f.view.activityResource,undefined);
 f.view.renderOverviewActivities({...state,timer:null});assert.equal(f.view.shortcut.hidden,false);assert.equal(f.view.overviewList.hidden,true);assert.equal(card.hidden,true);
});

test('timer activity changes leave movement to the outer scene owner, including hidden detail updates and later navigation',()=>{
 const f=fixture();
 f.view.overviewList.animate=f.view.shortcut.animate=()=>{throw Error('nested timer entrance must not compete with SceneMotion');};
 const empty={connected:true,focus:'timers',timer:null,timerHistory:[],devices:[]};f.view.host.state=empty;f.view.renderOverviewActivities(empty);
 const state={...empty,timer};f.view.host.state=state;f.view.renderOverviewActivities(state);const card=f.view.nodes.get(`overview:${timer.id}`);
 f.view.renderOverviewActivities({...state,focus:'now'});f.writes.length=0;f.view.renderOverviewActivities({...state,focus:'now',timer:{...timer,remaining:58}});
 assert.equal(f.view.nodes.get(`overview:${timer.id}`),card);assert.equal(f.view.activityAnimation,null);assert.equal(f.writes.some(write=>/\.innerHTML$|\.append$|\.insert$/.test(write)),false);
 f.view.renderOverviewActivities(empty);assert.equal(f.view.overviewList.hidden,true);assert.equal(f.view.shortcut.hidden,false);assert.equal(f.view.activityAnimation,null);
});

test('completed timer retains actual alarm time in the existing card after bounded audio, with honest blocked-audio copy',()=>{
 const f=fixture();
 const at=new Date(2026,9,20,18,5).getTime(),done={...timer,status:'done',remaining:0};f.view.notice={completions:new Map([[timer.id,{at,exhausted:true,played:true}]])};const card=f.view.card(done,f.list,`detail:${timer.id}`);assert.equal(card.querySelector('.timer-copy strong').textContent,'Timeren ringede kl. 18.05');f.view.notice.completions.get(timer.id).played=false;f.view.card(done,f.list,`detail:${timer.id}`);assert.equal(card.querySelector('.timer-copy strong').textContent,'Timeren blev færdig kl. 18.05');assert.equal(f.view.nodes.get(`detail:${timer.id}`),card);
});
test('lærred »Timer-faerdig« v193: a ringing timer says when it rang, that it rings, and offers »Stop alarm« as the alarm key',()=>{
 const f=fixture();
 f.view.host.live=false;const at=new Date(2026,9,20,18,5).getTime(),done={...timer,status:'done',remaining:0,ownerBootId:undefined};
 f.view.notice={completions:new Map([[timer.id,{at,exhausted:false,played:true}]])};
 const card=f.view.card(done,f.list,`detail:${timer.id}`),finish=card.querySelector('.timer-finish');
 assert.equal(card.querySelector('.timer-copy strong').textContent,'Timeren ringede 18.05');
 assert.equal(card.querySelector('.timer-state').textContent,'Alarmen ringer, til du stopper den.');
 assert.equal(finish.textContent,'Stop alarm');assert.equal(finish.getAttribute('data-kit-variant'),'alarm');assert.equal(finish.getAttribute('data-kit-size'),'56');
 // Without the bell's record the local timer is only finished: no ringing copy and no alarm key.
 f.view.notice={completions:new Map()};f.view.card(done,f.list,`detail:${timer.id}`);
 assert.notEqual(card.querySelector('.timer-copy strong').textContent,'Timeren ringede 18.05');
 assert.notEqual(finish.textContent,'Stop alarm');assert.equal(finish.getAttribute('data-kit-variant'),'secondary');
});
test('running and paused timers hide creation and prevent draft changes until cancellation',()=>{
 const f=fixture();
 f.view.host.live=false;for(const status of ['running','paused']){const current={...timer,status,ownerBootId:undefined};f.view.render({connected:true,focus:'timers',timer:current,timerHistory:[]});assert.equal(f.form.hidden,true);assert.equal(f.view.canStart,false);for(const button of f.form.querySelectorAll('[data-minutes]'))assert.equal(button.disabled,true);assert.equal(f.form.querySelector('.timer-start').disabled,true);const draft=f.view.duration;f.view.fill({seconds:180});assert.equal(f.view.duration,draft);assert.equal(f.view.currentTimer,current);}
 f.view.render({connected:true,focus:'timers',timer:{...timer,status:'cancelled'},timerHistory:[]});assert.equal(f.form.hidden,false);assert.equal(f.view.canStart,true);assert.equal(f.form.querySelector('.timer-start').disabled,false);
});

test('recent timers stay visible but wait during an active timer and keep five unique durations',()=>{const f=fixture();const history=[{seconds:60},{seconds:120},{seconds:60},{seconds:180},{seconds:240},{seconds:300},{seconds:360}],recent=f.view.detail.querySelector('.timer-recent'),list=recentList(f);f.view.render({connected:true,focus:'timers',timer:{id:'active',status:'running',remaining:120,total:120,endsAt:Date.now()+120000},timerHistory:history});assert.equal(recent.hidden,false);assert.deepEqual([...list.children].map(button=>Number(button.dataset.recentSeconds)),[60,120,180,240,300]);assert([...list.children].every(button=>button.disabled));click(list.children[0]);assert.deepEqual(f.dispatched,[]);});

test('top slot stays Timer with combined activity and neutral without a timer while robot and Tesla retain their own state',()=>{
 const f=fixture();
 // The fake slot had no children; the real #timer-card keeps exactly its own bar and shortcut.
 const slotChildren=[...f.view.overview.children];
 const robot={id:'robot-stable',kind:'vacuum',status:'cleaning',battery:76},vehicle={mode:'observed',source:'home_assistant_state',charging:{status:'charging'},batteryPercent:42};
 for(const domain of ['combined','robot-only','Tesla-only']){
  const state={connected:true,focus:'now',timer:domain==='combined'?timer:null,timerHistory:[],devices:domain==='Tesla-only'?[]:[robot],vehicle:domain==='robot-only'?null:vehicle};f.view.host.state=state;f.view.renderOverviewActivities(state);
  assert.equal(f.view.overview.dataset.activityKind,domain==='combined'?'timer':'empty');assert.equal(f.view.shortcut.hidden,domain==='combined');assert.equal(f.view.overviewList.hidden,domain!=='combined');assert.equal(f.view.activityChoices,undefined);assert.equal(f.view.activityResource,undefined);assert.deepEqual([...f.view.overview.children],slotChildren);assert.equal(state.devices[0],domain==='Tesla-only'?undefined:robot);assert.equal(state.vehicle,domain==='robot-only'?null:vehicle);assert.deepEqual(f.dispatched,[]);
 }
 const done={...timer,status:'done',remaining:0};f.view.renderOverviewActivities({timer:done,extraTimers:[{...timer,id:'another',status:'running'}],devices:[robot],vehicle});assert.equal(f.view.overviewActivities.length,1);assert.equal(f.view.overviewSelectedId,`timer:${timer.id}`);const card=f.view.nodes.get(`overview:${timer.id}`);assert.equal(card.querySelector('.timer-count').textContent,'Tiden er gået');assert.equal(card.querySelector('.timer-finish').textContent,'Stop alarm');
});

test('overview reads ring and copy before two sibling actions whose native focus order is Cancel then detail',()=>{
 const f=fixture();
 const state={connected:true,focus:'now',timer,timerHistory:[]};f.view.host.state=state;f.view.render(state);const card=f.view.nodes.get(`overview:${timer.id}`),roots=[],stack=[],buttons=[];
 // Parse the actual produced markup, rather than inventing a fake child order. The first class names the part.
 for(const token of card.innerHTML.matchAll(/<(\/)?([a-z][\w-]*)([^>]*)>/gi)){
  if(token[1]){stack.pop();continue;}
  const node={tag:token[2],className:(/class="([^"]*)"/.exec(token[3])?.[1]||'').split(' ')[0],parent:stack.at(-1),children:[]};(node.parent?.children||roots).push(node);if(node.tag==='button')buttons.push(node);if(!['img','input','br'].includes(node.tag)&&!token[3].endsWith('/'))stack.push(node);
 }
 assert.deepEqual(roots.map(node=>node.className),['timer-instrument','timer-copy','timer-finish','timer-open']);assert.deepEqual(buttons.map(node=>node.className),['timer-finish','timer-open']);assert.ok(buttons.every(node=>!node.parent),'both controls are native siblings, with no nested action');assert.equal(buttons[1].children[0].className,'timer-chevron');
 const open=card.querySelector('.timer-open'),finish=card.querySelector('.timer-finish');assert.equal(open.getAttribute('data-kit'),'button');assert.match(open.getAttribute('aria-label'),/Timer · 0:59 · Slutter .+ · Åbn timerdetaljer/);click(finish);assert.deepEqual(f.dispatched,[{type:'timer',id:timer.id,action:'cancel'}]);click(open);assert.deepEqual(f.dispatched.at(-1),{type:'show',id:'timers'});
 f.view.render({...state,connected:false,timer:{...timer,status:'paused'}});f.view.renderAccess({connected:false});assert.equal(f.view.nodes.get(`overview:${timer.id}`),card);assert.equal(card.querySelector('.timer-open'),open);assert.equal(card.querySelector('.timer-finish'),finish);assert.match(open.getAttribute('aria-label'),/På pause/);assert.equal(finish.disabled,true);const count=f.dispatched.length;click(finish);assert.equal(f.dispatched.length,count);click(open);assert.deepEqual(f.dispatched.at(-1),{type:'show',id:'timers'},'navigation survives loss of command authority');
});


test('stale running timer retains its measured dial but exposes the freshness state to the shared detail recipe',()=>{
 const f=fixture();
 const state={connected:false,focus:'timers',timer:{...timer,stale:true},timerHistory:[]};f.view.render(state);
 const card=f.view.nodes.get(`detail:${timer.id}`),count=card.querySelector('.timer-count'),status=card.querySelector('.timer-state');
 assert.equal(card.dataset.stale,'true');assert.equal(count.textContent,'0:59');assert.match(status.textContent,/ikke opdateret/i);assert.equal(status.hidden,false);
 f.writes.length=0;f.view.render(state);assert.deepEqual([...f.writes],[],'identical stale data must not restart the instrument');
 f.view.render({...state,connected:true,timer:{...timer,stale:false}});assert.equal(card.dataset.stale,'false');assert.equal(card.querySelector('.timer-count'),count);
});

test('actual recent duration quick-fills a draft without persistent selection, adjusts before explicit submit, and active timer hides the draft',()=>{
 const f=fixture();
 f.view.host.live=false;const state={connected:true,focus:'timers',timer:null,timerSerial:0,timerHistory:[{seconds:600},{seconds:180},{seconds:NaN},{seconds:-1},{seconds:86401},{seconds:'60'},{seconds:600}]};f.view.host.state=state;f.view.host.dispatch=event=>{f.dispatched.push(event);f.view.host.state=event.type==='show'?{...f.view.host.state,focus:event.id}:timerTransition(f.view.host.state,event);};const list=recentList(f);f.view.render(state);assert.deepEqual([...list.children].map(button=>Number(button.dataset.recentSeconds)),[600,180]);
 const choose=key=>click([...list.children].find(button=>button.dataset.recentSeconds===key));choose('600');assert.equal(f.view.duration,600);assert.equal(f.view.inputs.minutes.value,'10');assert.equal(f.form.querySelector('output').textContent,'10:00');assert([...f.form.querySelectorAll('[data-minutes]')].every(button=>button.getAttribute('aria-pressed')==='false'));assert.deepEqual(f.dispatched,[]);assert.equal(f.view.host.state.timer,null);
 f.view.fill({seconds:660});assert.equal(f.view.duration,660);assert.deepEqual(f.dispatched,[]);
 f.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));assert.equal(f.dispatched.length,2);assert.deepEqual(f.dispatched[1],{type:'show',id:'now'});assert.equal(f.view.host.state.focus,'now');assert.equal(f.dispatched[0].type,'timer-start');assert.equal(f.dispatched[0].seconds,660);assert.equal(f.dispatched[0].name,'');f.view.render(f.view.host.state);assert.equal(f.form.hidden,true);assert.equal(f.view.detail.querySelector('.timer-recent').hidden,false);const duration=f.view.duration;choose('180');assert.equal(f.view.duration,duration);assert.equal(f.dispatched.length,2);
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
 const f=fixture();
 const base={connected:true,focus:'now',timer:{...timer,name:'Pasta',status:'running'},timerHistory:[]};f.view.host.state=base;f.view.render(base);const overview=f.view.nodes.get(`overview:${timer.id}`),detail=f.view.nodes.get(`detail:${timer.id}`),title=overview.querySelector('.timer-copy strong');assert.equal(title.textContent,'Timer');assert.equal(title.hidden,false);assert.equal(overview.dataset.kitTone,'dark');assert.equal(detail.dataset.kitTone,'dark');
 const done={...base,timer:{...base.timer,status:'done',remaining:0,noticeDismissed:true,physicalDrained:true}};f.view.host.state=done;f.view.render(done);f.view.renderOverviewActivities(done);assert.equal(f.view.nodes.get(`overview:${timer.id}`),overview);assert.equal(title.hidden,true);assert.equal(title.textContent,'');assert.equal(overview.querySelector('.timer-count').textContent,'Tiden er gået');assert.equal(overview.hidden,false);assert.equal(overview.dataset.timerId,timer.id);assert.equal(overview.querySelector('.timer-finish').textContent,'Færdig');assert.doesNotMatch(overview.querySelector('.timer-open').getAttribute('aria-label'),/Pasta/);assert.equal(f.view.shortcut.hidden,true);assert.deepEqual(f.dispatched,[],'dismissed alarm does not remove the finished activity');
 click(overview.querySelector('.timer-finish'));assert.deepEqual(f.dispatched,[{type:'timer',id:timer.id,action:'cancel'}]);
 f.view.render(base);assert.equal(title.textContent,'Timer');assert.equal(title.hidden,false);assert.equal(f.view.nodes.get(`detail:${timer.id}`),detail);
 // Was a check of timer-view.js's markup: the draft is the dark kit card and has no name field.
 assert.ok(f.form.matches('form.timer-create.pv-card[data-kit-tone="dark"]'));assert.equal(f.form.classList[0],'timer-create');assert.equal(f.view.detail.querySelector('input[name="name"]'),null);
});

test('one retained feedback slot follows only the visible timer surface across unknown, replacement and reset',()=>{
 const f=fixture();
 const view=f.view,note=view.detail.querySelector('#timers-live-note'),unknown='Udfald ukendt · handlingen gentages ikke',empty={connected:true,focus:'timers',timer:null,timerHistory:[]};
 view.host.state=empty;view.render(empty);view.renderAccess({connected:true,canStart:true,awaitingObservation:true,feedback:unknown});
 assert.equal(note.parentNode,f.form);assert.equal(note.dataset.kitSlot,'feedback');assert.equal(note.textContent,unknown);assert.equal(note.hidden,false);assert.equal(view.canStart,false);assert.equal(f.form.hidden,false);
 f.writes.length=0;view.renderAccess({connected:true,canStart:true,awaitingObservation:true,feedback:unknown});assert.deepEqual([...f.writes],[],'unchanged feedback neither moves nor rewrites its retained slot');
 const first={...empty,timer};view.host.state=first;view.render(first);const firstCard=view.nodes.get(`detail:${timer.id}`),firstOverview=view.nodes.get(`overview:${timer.id}`);
 assert.equal(note.parentNode,firstCard);assert.equal([...f.form.children].includes(note),false);assert.equal([...firstOverview.children].includes(note),false);assert.equal(firstCard.hidden,false);assert.equal(firstCard.querySelector('.timer-count').textContent,'0:59');
 const second={...empty,timer:{...timer,id:'replacement',remaining:120,duration:180}};view.host.state=second;view.render(second);const secondCard=view.nodes.get('detail:replacement');
 assert.equal(view.detail.querySelector('#timers-live-note'),note);assert.equal(note.parentNode,secondCard);assert.equal(firstCard.hidden,true);assert.equal([...firstCard.children].includes(note),false);assert.equal([...view.nodes.get('overview:replacement').children].includes(note),false);assert.equal(secondCard.querySelector('.timer-count').textContent,'2:00');
 view.renderAccess({connected:true,canCancel:true,feedback:''});assert.equal(note.hidden,true);assert.equal(note.textContent,'');assert.equal(note.parentNode,secondCard);assert.equal(view.canCancel,true);
 view.host.state=empty;view.render(empty);assert.equal(note.parentNode,f.form);assert.equal(f.form.hidden,false);assert.equal(secondCard.hidden,true);assert.equal([...secondCard.children].includes(note),false);assert.equal(note.hidden,true);assert.equal(view.detail.querySelector('#timers-live-note'),note);assert.deepEqual(f.dispatched,[]);
});

function liveClockFixture(){
 const beforeSet=globalThis.setTimeout,beforeClear=globalThis.clearTimeout,beforeNow=Date.now,jobs=new Map();let serial=0,now=100000;
 globalThis.setTimeout=(fn,ms)=>{jobs.set(++serial,{fn,at:now+ms,ms});return serial;};globalThis.clearTimeout=id=>jobs.delete(id);Date.now=()=>now;
 const f=fixture();f.view.presentationNow=()=>now;
 Object.assign(f.view.host,{isConnected:true,liveStatus:'connected',liveSnapshot:{bootId:'native-boot',roomId:'kitchen',timers:{status:'observed',epoch:'timer-epoch',items:[]}},liveTransport:{connected:true,acceptedReadAt:now}});
 const receive=(remaining,status='running',extra={})=>{const native={...timer,remaining,status,deadline:null,...extra};f.view.host.liveSnapshot.timers.items=[{id:native.id,secondsLeft:remaining,status:status==='done'?'finished':status}];f.view.host.liveTransport.acceptedReadAt=now;f.view.host.state={connected:false,focus:'timers',timer:native,timerHistory:[]};f.view.render(f.view.host.state);return native;};
 return {...f,jobs,receive,get now(){return now;},advance(ms){now+=ms;for(const[id,job]of [...jobs])if(job.at<=now){jobs.delete(id);job.fn();}},restore(){f.view.cleanup();Date.now=beforeNow;globalThis.setTimeout=beforeSet;globalThis.clearTimeout=beforeClear;}};
}

test('native Timer displays every second between two-second observations without resetting on duplicate source count',()=>{
 const f=liveClockFixture();try{const native=f.receive(60),overview=f.view.nodes.get('overview:native-timer'),detail=f.view.nodes.get('detail:native-timer'),finish=detail.querySelector('.timer-finish');finish.focus();f.list.scrollTop=42;assert.equal(detail.querySelector('.timer-count').textContent,'1:00');assert.equal(f.jobs.size,1);assert.equal([...f.jobs.values()][0].ms,1000);
  f.writes.length=0;f.advance(1000);assert.equal(detail.querySelector('.timer-count').textContent,'0:59');f.receive(60);assert.equal(detail.querySelector('.timer-count').textContent,'0:59','duplicate SSE must not repaint the cached minute');f.advance(1000);f.receive(58);assert.equal(detail.querySelector('.timer-count').textContent,'0:58');assert.equal(overview.querySelector('.timer-count').textContent,'0:58');assert.equal(f.view.nodes.get('detail:native-timer'),detail);assert.equal(f.view.nodes.get('overview:native-timer'),overview);assert.equal(document.activeElement,finish);assert.equal(f.list.scrollTop,42);assert.equal(f.writes.some(write=>write.endsWith('.disabled')),false);assert.deepEqual(f.dispatched,[]);assert.equal(native.remaining,60);assert.equal(native.deadline,null);
 }finally{f.restore();}
});

test('native display zero is not completion, an alarm or a command; only observed finished changes status',()=>{
 const f=liveClockFixture();try{const native=f.receive(1),card=f.view.nodes.get('detail:native-timer');f.advance(1000);assert.equal(card.querySelector('.timer-count').textContent,'0:00');assert.equal(card.dataset.status,'running');assert.equal(card.querySelector('.timer-finish').textContent,'Annuller');assert.equal(native.status,'running');assert.equal(f.jobs.size,0);assert.deepEqual(f.dispatched,[]);f.receive(0,'done');assert.equal(card.querySelector('.timer-count').textContent,'0:00');assert.equal(card.dataset.status,'done');assert.equal(card.querySelector('.timer-finish').textContent,'Stop alarm');assert.deepEqual(f.dispatched,[]);}finally{f.restore();}
});

for(const stop of ['paused','stale','offline','expired-heartbeat'])test(`native presentation clock freezes on ${stop} and cannot create freshness`,()=>{
 const f=liveClockFixture();try{f.receive(60);f.advance(1000);const card=f.view.nodes.get('detail:native-timer');if(stop==='paused')f.receive(59,'paused');else if(stop==='stale')f.receive(60,'running',{stale:true});else if(stop==='offline'){f.view.host.liveTransport.connected=false;f.view.renderAccess({connected:false});}else f.view.host.liveTransport.acceptedReadAt=f.now-6000;const before=card.querySelector('.timer-count').textContent;f.advance(1000);f.advance(1000);assert.equal(card.querySelector('.timer-count').textContent,before);assert.equal(f.jobs.size,0);assert.deepEqual(f.dispatched,[]);}finally{f.restore();}
});

test('timer owner replacement and removal retire the old presentation clock; cleanup leaves no callbacks',()=>{
 const f=liveClockFixture();try{f.receive(60);f.advance(500);f.view.host.liveSnapshot.timers.epoch='replacement';f.receive(60);assert.equal(f.jobs.size,1);assert.equal([...f.jobs.values()][0].ms,1000);f.advance(500);assert.equal(f.view.nodes.get('detail:native-timer').querySelector('.timer-count').textContent,'1:00');f.advance(500);assert.equal(f.view.nodes.get('detail:native-timer').querySelector('.timer-count').textContent,'0:59');f.view.host.liveSnapshot.timers.items=[];f.view.host.state={...f.view.host.state,timer:null};f.view.render(f.view.host.state);assert.equal(f.jobs.size,0);f.receive(30);assert.equal(f.jobs.size,1);f.view.cleanup();assert.equal(f.jobs.size,0);assert.deepEqual(f.dispatched,[]);}finally{f.restore();}
});

test('delayed native presentation callback derives elapsed time once and keeps the next second boundary',()=>{
 const f=liveClockFixture();try{f.receive(60);f.advance(3250);const card=f.view.nodes.get('detail:native-timer');assert.equal(card.querySelector('.timer-count').textContent,'0:57');assert.equal(f.jobs.size,1);assert.equal([...f.jobs.values()][0].ms,750);f.advance(750);assert.equal(card.querySelector('.timer-count').textContent,'0:56');assert.equal([...f.jobs.values()][0].ms,1000);assert.equal(f.view.host.state.timer.remaining,60);assert.equal(f.view.host.liveTransport.acceptedReadAt,100000,'display time never renews source freshness');assert.deepEqual(f.dispatched,[]);}finally{f.restore();}
});

for(const field of ['boot','room','id'])test(`native ${field} replacement cannot inherit the previous countdown anchor`,()=>{
 const f=liveClockFixture();try{f.receive(60);f.advance(500);const extra={};if(field==='boot'){f.view.host.liveSnapshot.bootId='next-boot';extra.ownerBootId='next-boot';}if(field==='room')f.view.host.liveSnapshot.roomId='next-room';if(field==='id')extra.id='next-timer';f.receive(60,'running',extra);const id=extra.id||'native-timer',card=f.view.nodes.get(`detail:${id}`);assert.equal(card.querySelector('.timer-count').textContent,'1:00');assert.equal(f.jobs.size,1);assert.equal([...f.jobs.values()][0].ms,1000);f.advance(500);assert.equal(card.querySelector('.timer-count').textContent,'1:00');f.advance(500);assert.equal(card.querySelector('.timer-count').textContent,'0:59');assert.deepEqual(f.dispatched,[]);}finally{f.restore();}
});

test('shared Timer clock also updates the photo mini-rail once without creating another clock or effect',()=>{
 const f=liveClockFixture();try{const native=f.receive(60),rail=[];f.view.host.renderResourceRail=()=>{rail.push(f.view.presentationTimer(f.view.host.state.timer).remaining);};f.view.presentationTimer(native);f.view.presentationTimer(native);assert.equal(f.jobs.size,1);f.advance(1000);assert.deepEqual(rail,[59]);assert.equal(f.jobs.size,1,'card and rail share the same already scheduled timeout');assert.equal(f.view.nodes.get('detail:native-timer').querySelector('.timer-count').textContent,'0:59');assert.equal(native.remaining,60);assert.deepEqual(f.dispatched,[]);f.view.cleanup();assert.equal(f.jobs.size,0);f.advance(5000);assert.deepEqual(rail,[59]);assert.deepEqual(f.dispatched,[]);}finally{f.restore();}
});


test('long-hour overview retains full time and stable actions while its narrow layout prevents copy-row overlap',()=>{
 const f=fixture();
 const long={...timer,remaining:6138,duration:7200,deadline:null},state={connected:true,focus:'now',timer:long,timerHistory:[]};
 f.view.host.state=state;f.view.render(state);const card=f.view.nodes.get(`overview:${timer.id}`),open=card.querySelector('.timer-open'),finish=card.querySelector('.timer-finish');
 assert.equal(card.querySelector('.timer-count').textContent,'1:42:18');assert.equal(card.querySelector('.timer-instrument').dataset.long,'true');assert.equal(card.querySelector('.timer-state').textContent,'Tæller ned');assert.match(open.getAttribute('aria-label'),/1:42:18 · Tæller ned/);
 f.view.render({...state,timer:{...long,remaining:6137}});assert.equal(card.querySelector('.timer-finish'),finish);assert.equal(card.querySelector('.timer-open'),open);assert.deepEqual(f.dispatched,[]);
 const css=read('ui-kit.css'),start=css.indexOf('/* Long-hour overview keeps both metadata rows readable at the narrower product width. */'),rule=css.slice(start,css.indexOf('/* Native controls',start));
 assert.notEqual(start,-1);assert.match(rule,/@media\(min-width:760px\) and \(max-width:1100px\)/);assert.match(rule,/:has\(>\.timer-instrument\[data-long=true\]\)>\.timer-copy>\.timer-count\{font:var\(--pv-t-value\);line-height:44px;white-space:nowrap\}/);
 const copyRule=css.slice(css.indexOf('.timer-panel.pv-hero>.timer-copy>:is(strong,.timer-state){'),css.indexOf('}',css.indexOf('.timer-panel.pv-hero>.timer-copy>:is(strong,.timer-state){')));
 assert.match(copyRule,/min-width:0/);assert.match(copyRule,/white-space:nowrap/);assert.match(copyRule,/overflow:hidden;text-overflow:ellipsis/);
});


test('native v2 detail adjustment dispatches its exact row only, without rewriting countdown or overview',()=>{
 const f=fixture();
 const source={...timer,remaining:180,duration:300,sourceRevision:'9'},state={connected:true,focus:'timers',timer:source,timerHistory:[]};f.view.host.state=state;f.view.accessModel={connected:true,canCancel:true,canAdjust:true};f.view.render(state);
 const card=f.view.nodes.get(`detail:${source.id}`),{buttons,minus,plus}=adjustButtons(card);assert.equal(card.querySelector('.timer-actions').hidden,false);assert.equal(buttons[0].hidden,true,'native Pause is not invented');assert(!minus.hidden&&!minus.disabled&&!plus.hidden&&!plus.disabled);assert.equal(f.view.nodes.get(`overview:${source.id}`).querySelectorAll('[data-timer-action]').length,0,'overview actions remain unchanged');
 click(plus);assert.deepEqual(f.dispatched,[{type:'timer',action:'adjust',id:source.id,deltaSeconds:60}]);assert.equal(state.timer,source);assert.equal(source.remaining,180);assert.equal(source.duration,300);
 f.view.host.state={...state,timer:{...source,stale:true}};click(minus);assert.equal(f.dispatched.length,1,'a row that became stale before click cannot dispatch');
});

test('pending native adjustment retains its chosen spinner and exact Cancel without geometry or node churn',()=>{
 const f=fixture();
 const source={...timer,remaining:180,duration:300,sourceRevision:'9'},state={connected:true,focus:'timers',timer:source,timerHistory:[]};f.view.host.state=state;f.view.render(state);const card=f.view.nodes.get(`detail:${source.id}`),{minus,plus}=adjustButtons(card),count=card.querySelector('.timer-count');
 const access={connected:true,canCancel:true,canAdjust:true,pending:true,waiting:true,allowIndependentCancel:true,adjustPending:{timerId:source.id,deltaSeconds:60}};f.view.renderAccess(access);assert(!minus.disabled&&!plus.disabled,'+1/−1 stay tappable during the adjustment');assert.equal(plus.getAttribute('aria-busy'),'true');assert.equal(minus.getAttribute('aria-busy'),'false');assert.equal(plus.getAttribute('data-kit-variant'),'icon');assert.equal(plus.getAttribute('data-feedback'),'progress');assert.equal(card.querySelector('.timer-finish').disabled,false);assert.equal(count.textContent,'3:00');
 click(plus);assert.deepEqual(f.dispatched,[{type:'timer',action:'adjust',id:source.id,deltaSeconds:60}],'the tap goes to the host queue');f.dispatched.length=0;click(card.querySelector('.timer-finish'));assert.deepEqual(f.dispatched,[{type:'timer',id:source.id,action:'cancel'}]);f.writes.length=0;f.view.renderAccess(access);assert.deepEqual([...f.writes],[],'unchanged pending render preserves the same controls');assert.equal(adjustButtons(card).plus,plus);
 f.view.renderAccess({...access,pending:false,waiting:false,adjustPending:null,awaitingObservation:true,adjustBlockedIds:[source.id]});assert.equal(plus.getAttribute('aria-busy'),'false');assert(minus.disabled&&plus.disabled);assert.equal(card.querySelector('.timer-finish').disabled,false);
});

test('v1 metadata and revoked adjust permission never expose active adjustments; live bounds revalidate at click',()=>{
 const f=fixture();
 let source={...timer,remaining:180,duration:300},state={connected:true,focus:'timers',timer:source,timerHistory:[]};f.view.host.state=state;f.view.accessModel={connected:true,canCancel:true,canAdjust:true};f.view.render(state);const card=f.view.nodes.get(`detail:${source.id}`),{minus,plus}=adjustButtons(card);assert.equal(card.querySelector('.timer-actions').hidden,true,'v1 duration history is not v2 authority');
 source={...source,sourceRevision:'10',remaining:60,duration:86400};state={...state,timer:source};f.view.host.state=state;f.view.render(state);assert(!minus.hidden&&!plus.hidden);assert(minus.disabled&&plus.disabled,'source underflow and cap disable the respective existing Buttons');
 source={...source,remaining:120,duration:300};state={...state,timer:source};f.view.host.state=state;f.view.render(state);assert(!minus.disabled&&!plus.disabled);f.view.host.state={...state,timer:{...source,remaining:60}};click(minus);assert.equal(f.dispatched.length,0,'source bound changed after render');
 f.view.renderAccess({connected:true,canCancel:true,canAdjust:false});assert.equal(card.querySelector('.timer-actions').hidden,true);click(plus);assert.equal(f.dispatched.length,0);
});
