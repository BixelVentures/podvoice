import test from 'node:test';
import assert from 'node:assert/strict';
import {initialScene,sceneTransition as step} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {visibleTimers,timerTime} from '../../podvoice/gatekeeper/static/podview/timer-model.js';
test('already existing owner timers expire independently and cancelling one preserves the other',()=>{let s=step(initialScene(),{type:'timer-start',seconds:30,name:'Pasta',now:0});const first=s.timer.id;s={...s,extraTimers:[{id:'owner-existing',name:'Ovn',duration:90,status:'running',remaining:90,deadline:91000}]};const second='owner-existing';s=step(s,{type:'tick',now:31000});assert.equal(visibleTimers(s).find(t=>t.id===first).status,'done');assert.equal(visibleTimers(s).find(t=>t.id===second).remaining,60);s=step(s,{type:'timer',id:first,action:'cancel'});assert.deepEqual(visibleTimers(s).map(t=>t.id),[second]);});
test('duration limits, offline starts, history dedupe and stale notice IDs',()=>{const base=initialScene();for(const seconds of [0,-1,86401,1.5,NaN])assert.equal(step(base,{type:'timer-start',seconds,now:0}),base);let off=step(base,{type:'offline'});assert.equal(step(off,{type:'timer-start',seconds:60,now:0}),off);let s=step(base,{type:'timer-start',seconds:86400,name:'Ovn',now:0});s=step(s,{type:'timer-start',seconds:86400,name:'Ovn',now:1});assert.equal(s.timerHistory.length,1);assert.equal(timerTime(86400),'24:00:00');assert.equal(step(s,{type:'timer-notice-dismiss',id:'missing'}),s);});
test('timer details return to their origin without stopping timers',()=>{let s=step(initialScene(),{type:'timer-start',now:0});s=step(s,{type:'show',id:'timers'});assert.equal(s.focus,'timers');s=step(s,{type:'device-back'});assert.equal(s.focus,'music');assert.equal(s.timer.status,'running');});

import {timerStateLabel} from '../../podvoice/gatekeeper/static/podview/timer-model.js';
test('all timer surfaces distinguish stale, paused and finished authoritative state',()=>{assert.equal(timerStateLabel({status:'running',stale:true}),'Sidst kendte tid');assert.equal(timerStateLabel({status:'paused'}),'På pause');assert.equal(timerStateLabel({status:'done'}),'Tiden er gået');});

import {timerProgress} from '../../podvoice/gatekeeper/static/podview/timer-model.js';
test('progress never invents a total from native remaining time',()=>{
 for(const duration of [null,undefined,0,-1,NaN,Infinity])assert.equal(timerProgress({duration,remaining:30}),null);
 assert.equal(timerProgress({duration:60,remaining:30}),50);
 assert.equal(timerProgress({duration:60,remaining:61}),null);
 assert.equal(timerProgress({duration:60,remaining:0}),0);
 assert.equal(timerProgress({duration:60,remaining:-1}),null);
});

test('running, paused, hidden and dismissed finished timers block an extra local start',()=>{
 for(const timer of [{status:'running'},{status:'paused'},{status:'running',hidden:true},{status:'done',noticeDismissed:true}]){
  const s={...initialScene(),timer:{id:'existing',remaining:1,...timer}};
  assert.equal(step(s,{type:'timer-start',seconds:10,now:0}),s);
 }
 const existing={id:'other-owner',status:'done',remaining:0};const s={...initialScene(),extraTimers:[existing]};
 assert.equal(step(s,{type:'timer-start',seconds:10,now:0}),s);assert.equal(s.extraTimers[0],existing);
});

test('invalid timer clocks are inert and a pause racing expiry becomes finished',()=>{
 const s=step(initialScene(),{type:'timer-start',seconds:1,now:0});
 for(const now of [undefined,NaN,Infinity]){assert.equal(step(s,{type:'tick',now}),s);assert.equal(step(s,{type:'timer',id:s.timer.id,action:'pause',now}),s);}
 const finished=step(s,{type:'timer',id:s.timer.id,action:'pause',now:1000});
 assert.equal(finished.timer.remaining,0);assert.equal(finished.timer.status,'done');
});
