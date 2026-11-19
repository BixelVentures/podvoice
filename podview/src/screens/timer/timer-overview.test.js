// Ported to Vitest with a real DOM when the timer screen moved to React:
// - tests/podview/root-timer-overview.test.mjs (identical to canonical-next-timer-overview.test.mjs; both deleted),
// - tests/podview/root-activity-gesture.test.mjs (deleted),
// - the overview test of tests/podview/root-answer-timer-composition.test.mjs and the Radio M test of
//   tests/podview/root-overview-priorities.test.mjs (moved here; the rest of those files stays in node:test).
// Same assertions. The fake views (TimerView.prototype.<method>.call on a stub) became a real TimerView on the shell;
// a stub card() became a spy on the real card(); stub nodes are the real #timer-card, its bar and shortcut; the
// Radio M test drives the real renderOverviewActivities instead of a copy of its source text.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {timerPresentation} from './presentation';
import {timerTransition,timersFor,timerStateLabel,timerTime} from '../../../timer-model.js';
import {previewScene} from '../../../preview-scenes.js';
import {sceneTransition,overviewPriorities,devicePresentation,lightSelection,robotRecentCompletion,initialScene} from '../../../scene-model.js';
import {robotExperience} from '../../../robot-observation.js';
import {vehicleRailPresentation} from '../../../vehicle-model.js';
import {localRadioTransition} from '../../../radio-model.js';
import {mountTimer} from './timer-fixture.js';
const podview=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const widgetSource=readFileSync(resolve(podview,'widget-view.js'),'utf8');

test('timer UI exposes one current record while preserving every native ID internally',()=>{
 const timers=[
  {id:'later',status:'running',deadline:9000,remaining:9},
  {id:'attention',status:'done',noticeDismissed:false,deadline:null,remaining:0},
  {id:'sooner',status:'running',deadline:3000,remaining:3}
 ];
 const view=timerPresentation(timers);
 assert.deepEqual(view.visible.map(timer=>timer.id),['attention']);
 assert.deepEqual(view.all.map(timer=>timer.id),['later','attention','sooner']);
 assert.equal(view.canStart,false);
});

test('without an unfinished alert, the UI selects the running timer ending first',()=>{
 const timers=[
  {id:'later',status:'running',deadline:9000,remaining:9},
  {id:'paused',status:'paused',deadline:null,remaining:1},
  {id:'sooner',status:'running',deadline:3000,remaining:3}
 ];
 const view=timerPresentation(timers);
 assert.equal(view.current.id,'sooner');
 assert.equal(view.canStart,false);
});

test('a finished timer normalizes remaining data to zero and stays current after notice dismissal',()=>{
 const finished={id:'finished',status:'done',noticeDismissed:true,remaining:1,deadline:null};
 const next={id:'next',status:'running',remaining:12,deadline:12000};
 const view=timerPresentation([next,finished]);
 assert.equal(view.current.id,'finished');
 assert.equal(view.current.remaining,0);
 assert.equal(view.current.status,'done');
 assert.equal(view.all[1].remaining,1);
 assert.equal(view.canStart,false);
});

test('timer start becomes available only after the current record is resolved',()=>{
 assert.equal(timerPresentation([]).canStart,true);
 assert.equal(timerPresentation([{id:'old',status:'cancelled'}]).canStart,true);
 assert.equal(timerPresentation([{id:'old',status:'done',noticeDismissed:true}]).canStart,false);
});

test('successful timer start renders its countdown without a spurious start validation warning',()=>{
 const view=mountTimer({live:false,dispatch(){},focusHeading(){}}),form=view.form,blocked=view.detail.querySelector('#timers-live-note');
 let state={connected:true,focus:'timers',timer:null,extraTimers:[],timerHistory:[],timerSerial:0};
 view.render(state);assert.equal(form.hidden,false);
 state=timerTransition(state,{type:'timer-start',seconds:60,now:1000});
 // History rendering is covered separately; retain its signature here to
 // isolate the actual current-timer render path that generated the warning.
 view.history=JSON.stringify(state.timerHistory.map(item=>item.seconds));
 view.render(state);
 assert.equal(view.currentTimer.remaining,60);
 assert.equal(form.hidden,true);
 assert.equal(blocked.hidden,true,'a valid start must not display a conflict warning');
 assert.equal(timerTransition(state,{type:'timer-start',seconds:120,now:1000}),state,'the single-timer guard must remain intact');
 state=timerTransition(state,{type:'tick',now:61000});
 view.render(state);assert.equal(view.currentTimer.status,'done');assert.equal(blocked.hidden,true);
 state=timerTransition(state,{type:'timer',id:state.timer.id,action:'cancel'});
 view.render(state);assert.equal(form.hidden,false);assert.equal(view.currentTimer,null);
});



test('fullscreen alarm selects the next unacknowledged native ID across every underlying scene',()=>{
 const first={id:'first',status:'done',noticeDismissed:true},stale={id:'stale',status:'done',stale:true},next={id:'next',status:'done'},other={id:'last',status:'done'};
 let presented;const view=mountTimer({state:{timer:first,extraTimers:[stale,next,other]},dispatch(){}});Object.assign(view,{currentTimer:first,canCancel:true,accessModel:{cancelBlockedIds:['last']},notice:{completions:new Map(),render(...args){presented=args;}}});
 for(const focus of ['photo','now','music','timers','answer-one']){view.renderNotice(focus,true,true);assert.equal(presented[0],next);assert.equal(presented[5].canCancel,true);assert.deepEqual(presented[5].cancelBlockedIds,['last']);}
 next.noticeDismissed=true;view.renderNotice('music',true,false);assert.equal(presented[0],other);
 other.status='cancelled';view.renderNotice('music',true,false);assert.equal(presented[0],first,'dismissed fallback is rejected by the notice without changing resource ownership');
});

test('the actual overview owner hides idle Start whenever its broad timer bar is present',()=>{
 const view=mountTimer({live:false,dispatch(){}});view.canCancel=true;
 for(const status of ['running','paused','done'])for(const stale of [false,true]){view.renderOverviewActivities({timer:{id:'actual',status,stale,remaining:60,duration:120},extraTimers:[]});assert.equal(view.overviewList.hidden,false);assert.equal(view.shortcut.hidden,true,'hidden attribute is the canonical idle-shortcut suppression');assert.equal(view.overview.dataset.activityKind,'timer');assert.equal(view.overview.dataset.activityId,'timer:actual');}
 view.renderOverviewActivities({timer:null,extraTimers:[]});assert.equal(view.overviewList.hidden,true);assert.equal(view.shortcut.hidden,false);assert.equal(view.overview.dataset.activityKind,'empty');
});

// From root-activity-gesture.test.mjs.
test('timer-only overview installs no activity carousel or horizontal gesture owner',()=>{
 const view=mountTimer({live:true,dispatch(){}}),{overview,shortcut,overviewList}=view;
 overview.addEventListener=()=>assert.fail('timer-only overview must not capture gestures');
 for(const state of [{timer:null,devices:[{id:'robot',kind:'vacuum',status:'cleaning'}]},{timer:null,vehicle:{mode:'observed',source:'home_assistant_state',charging:{status:'charging'}}}]){view.renderOverviewActivities(state);assert.equal(shortcut.hidden,false);assert.equal(overviewList.hidden,true);assert.equal(view.overviewSelectedId,null);assert.equal(view.activityChoices,undefined);assert.equal(view.activityResource,undefined);}
 assert.equal(view.bindActivityGesture,undefined);assert.equal(view.finishActivityGesture,undefined);
});

// From root-answer-timer-composition.test.mjs.
const railStart=widgetSource.indexOf(' renderResourceRail(){'),railEnd=widgetSource.indexOf('\n render(){',railStart);
const railMethod=new Function('$','timerPresentation','timersFor','timerStateLabel','timerTime','devicePresentation','lightSelection','createResourceTile','updateResourceTile','robotExperience','robotRecentCompletion','vehicleRailPresentation',`return ({${widgetSource.slice(railStart,railEnd)}}).renderResourceRail;`);
function railFixture(state){
 const rail={hidden:false,children:[],append(node){this.children.push(node);},insertBefore(node,before){const previous=this.children.indexOf(node);if(previous>=0)this.children.splice(previous,1);const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,node);}},updates=[],actions=[];
 const tile={hidden:false,dataset:{},kind:'timer'};
 const host={state,resourceButtons:new Map([[state.timer.id,tile]]),dispatch:event=>actions.push(event),focusHeading(){}};
 host.renderRail=railMethod(()=>rail,timerPresentation,timersFor,timerStateLabel,timerTime,devicePresentation,lightSelection,()=>({hidden:false,dataset:{}}),(node,resource)=>updates.push(resource),robotExperience,robotRecentCompletion,vehicleRailPresentation);
 return {host,rail,tile,updates,actions};
}
test('Back from an answer sends the same running timer to the actual overview bar renderer and retains music',()=>{
 const state=previewScene('conversation-followup',100000);state.devices=[];const timer=state.timer,music=state.music,f=railFixture(state);f.host.renderRail();
 const returned=sceneTransition(state,{type:'back'});assert.equal(returned.focus,'now');assert.equal(returned.timer,timer);assert.equal(returned.music,music);
 const cards=[],view=mountTimer({live:false,dispatch(){}}),card=view.card.bind(view);view.canCancel=true;view.card=(current,container,key)=>{cards.push({current,container,key});return card(current,container,key);};
 view.renderOverviewActivities(returned);
 assert.equal(view.overviewList.hidden,false);assert.equal(view.overview.dataset.activityKind,'timer');assert.equal(cards.length,1);assert.equal(cards[0].current,timer);assert.equal(cards[0].key,`overview:${timer.id}`);assert.equal(cards[0].current.status,'running');assert.equal(cards[0].current.deadline,622000);assert.equal(cards[0].current.remaining,522);
 // Ro keeps its established supporting rail; hiding a visual answer never cancels its timer.
 f.host.state={...returned,focus:'photo'};f.host.renderRail();assert.equal(f.rail.hidden,false);assert.equal(f.tile.hidden,false);assert.equal(f.updates[0].id,timer.id);assert.deepEqual(f.actions,[]);
});

// From root-overview-priorities.test.mjs.
test('automatic Radio M follows the actual broad timer projection and preserves authored library sizes',()=>{
 const alignSource=widgetSource.slice(widgetSource.indexOf(' alignOverview(){'),widgetSource.indexOf('\n renderOverviewMediaCards(')).trim();
 const timer=mountTimer({live:false,dispatch(){}});timer.canCancel=true;
 const radio={dataset:{},style:{}},overview=timer.overview,nodes={'home-radio':radio,'timer-card':overview},align=new Function('$','overviewPriorities','timersFor',`return function ${alignSource}`)(id=>nodes[id],overviewPriorities,timersFor);
 let state=localRadioTransition(initialScene(),{type:'radio-select',stationId:'p3'});state={...state,focus:'radio'};const original={station:state.radioStationId,room:state.music.playback.room,track:state.music.playback.track},host={state,dataset:{},style:{getPropertyValue:()=>'',setProperty(){}}};
 const update=()=>{host.state=state;timer.renderOverviewActivities(state);align.call(host);assert.equal(state.radioStationId,original.station);assert.equal(state.music.playback.room,original.room);assert.equal(state.music.playback.track,original.track);};
 update();assert.equal(radio.dataset.overviewSize,'s');state=sceneTransition(state,{type:'timer-start',seconds:60,now:1000});update();assert.equal(radio.dataset.overviewSize,'m');state=sceneTransition(state,{type:'timer',id:state.timer.id,action:'pause',now:2000});update();assert.equal(radio.dataset.overviewSize,'m');state=sceneTransition(state,{type:'timer',id:state.timer.id,action:'resume',now:3000});state=sceneTransition(state,{type:'tick',now:100000});update();assert.equal(state.timer.status,'done');assert.equal(radio.dataset.overviewSize,'m');
 for(const size of ['s','m','l']){radio.dataset.kitSize=size;update();assert.equal(radio.dataset.kitSize,size);assert.equal(radio.dataset.overviewSize,'m');}delete radio.dataset.kitSize;
 state=sceneTransition(state,{type:'timer',id:state.timer.id,action:'cancel'});update();assert.equal(radio.dataset.overviewSize,'s');
});
