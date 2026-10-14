import test from 'node:test';
import assert from 'node:assert/strict';
import {timerPresentation} from '../../podvoice/gatekeeper/static/podview/timer-view.js';

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
