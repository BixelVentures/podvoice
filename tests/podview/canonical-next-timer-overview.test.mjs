import test from 'node:test';
import assert from 'node:assert/strict';
import {TimerView,timerPresentation} from '../../podvoice/gatekeeper/static/podview/timer-view.js';

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

test('a finished timer projects 0:00 and stays current after notice dismissal',()=>{
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

test('retained hidden timer nodes cannot cause duplicate toast on overview or detail',()=>{
 const old={hidden:true,dataset:{timerId:'old'}},current={hidden:false,dataset:{timerId:'current'}};
 const rail={hidden:true,children:[]},overview={querySelectorAll:()=>[old,current]},detail={hidden:false,querySelectorAll:()=>[old,current]};
 const previous=globalThis.document;globalThis.document={getElementById:id=>id==='resource-rail'?rail:{hidden:false}};
 try{let represented;const view={host:{state:{}},currentTimer:{id:'current',status:'done',remaining:0},overviewList:overview,detail,notice:{render(...args){represented=args[4];}}};
  for(const focus of ['now','timers']){TimerView.prototype.renderNotice.call(view,focus,true,false);assert.equal(represented,'current');}
  rail.hidden=false;rail.children=[old,current];TimerView.prototype.renderNotice.call(view,'photo',true,false);assert.equal(represented,'current');
  current.dataset.timerId='other';TimerView.prototype.renderNotice.call(view,'photo',true,false);assert.equal(represented,null);
 }finally{globalThis.document=previous;}
});

test('successful timer start renders its countdown without a spurious start validation warning',async()=>{
 const {timerTransition}=await import('../../podvoice/gatekeeper/static/podview/timer-model.js');
 const blocked={hidden:true},running={},list={children:[]},recent={hidden:true,querySelector:()=>({replaceChildren(){}})};
 const detail={querySelector:selector=>({'.timer-active-list':list,'.timer-running':running,'.timer-blocked':blocked,'.timer-recent':recent})[selector]};
 const form={elements:[]},view={nodes:new Map(),overviewList:{children:[]},shortcut:{},detail,form,history:'[]',updatePicker(){},card(){return undefined;}};
 const previous=globalThis.document;globalThis.document={getElementById:()=>null};
 try{
  let state={connected:true,focus:'timers',timer:null,extraTimers:[],timerHistory:[],timerSerial:0};
  TimerView.prototype.render.call(view,state);assert.equal(form.hidden,false);
  state=timerTransition(state,{type:'timer-start',seconds:60,now:1000});
  // History rendering is covered separately; retain its signature here to
  // isolate the actual current-timer render path that generated the warning.
  view.history=JSON.stringify(state.timerHistory);
  TimerView.prototype.render.call(view,state);
  assert.equal(view.currentTimer.remaining,60);
  assert.equal(form.hidden,true);
  assert.equal(blocked.hidden,true,'a valid start must not display a conflict warning');
  assert.equal(timerTransition(state,{type:'timer-start',seconds:120,now:1000}),state,'the single-timer guard must remain intact');
  state=timerTransition(state,{type:'tick',now:61000});
  TimerView.prototype.render.call(view,state);assert.equal(view.currentTimer.status,'done');assert.equal(blocked.hidden,true);
  state=timerTransition(state,{type:'timer',id:state.timer.id,action:'cancel'});
  TimerView.prototype.render.call(view,state);assert.equal(form.hidden,false);assert.equal(view.currentTimer,null);
 }finally{globalThis.document=previous;}
});
