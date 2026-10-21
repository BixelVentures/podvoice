import test from 'node:test';
import assert from 'node:assert/strict';
import {initialScene,sceneTransition as step} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {visibleTimers,timerTime} from '../../podvoice/gatekeeper/static/podview/timer-model.js';
test('already existing owner timers expire independently and cancelling one preserves the other',()=>{let s=step(initialScene(),{type:'timer-start',seconds:30,name:'Pasta',now:0});const first=s.timer.id;s={...s,extraTimers:[{id:'owner-existing',name:'Ovn',duration:90,status:'running',remaining:90,deadline:91000}]};const second='owner-existing';s=step(s,{type:'tick',now:31000});assert.equal(visibleTimers(s).find(t=>t.id===first).status,'done');assert.equal(visibleTimers(s).find(t=>t.id===second).remaining,60);s=step(s,{type:'timer',id:first,action:'cancel'});assert.deepEqual(visibleTimers(s).map(t=>t.id),[second]);});
test('duration limits, offline starts, history dedupe and stale notice IDs',()=>{const base=initialScene();for(const seconds of [0,-1,86401,1.5,NaN])assert.equal(step(base,{type:'timer-start',seconds,now:0}),base);let off=step(base,{type:'offline'});assert.equal(step(off,{type:'timer-start',seconds:60,now:0}),off);let s=step(base,{type:'timer-start',seconds:86400,name:'Ovn',now:0});s=step(s,{type:'timer-start',seconds:86400,name:'Ovn',now:1});assert.equal(s.timerHistory.length,1);assert.equal(timerTime(86400),'24:00:00');assert.equal(step(s,{type:'timer-notice-dismiss',id:'missing'}),s);});
test('timer details return to overview then Ro without stopping timers',()=>{let s=step(initialScene(),{type:'timer-start',now:0});s=step(s,{type:'show',id:'timers'});assert.equal(s.focus,'timers');s=step(s,{type:'device-back'});assert.equal(s.focus,'now');assert.equal(s.timer.status,'running');const timer=s.timer;s=step(s,{type:'back'});assert.equal(s.focus,'photo');assert.equal(s.timer,timer);});

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

test('native finished alert offers explicit stop until owner confirms drained or stopped',async()=>{
 const {timerFinishLabel}=await import('../../podvoice/gatekeeper/static/podview/timer-model.js');const timer={status:'done',ownerBootId:'actual-owner',noticeDismissed:true,physicalStopped:false,physicalDrained:false};
 assert.equal(timerFinishLabel(timer),'Stop alarm');assert.equal(timerFinishLabel({...timer,physicalStopped:true}),'Færdig');assert.equal(timerFinishLabel({...timer,physicalDrained:true}),'Færdig');assert.equal(timerFinishLabel({...timer,ownerBootId:undefined}),'Færdig');assert.equal(timerFinishLabel({status:'running',ownerBootId:'actual-owner'}),'Annuller');
});

test('unnamed creation keeps duration and native identity without fabricating a task name',()=>{const state=step(initialScene(),{type:'timer-start',seconds:300,now:1000});assert.equal(state.timer.name,'');assert.equal(state.timer.duration,300);assert.equal(state.timer.deadline,301000);assert.deepEqual(state.timerHistory,[{name:'',seconds:300}]);const cancelled=step(state,{type:'timer',id:state.timer.id,action:'cancel'});const again=step(cancelled,{type:'timer-start',seconds:300,now:2000});assert.notEqual(again.timer.id,state.timer.id);assert.equal(again.timerHistory.length,1);});

test('active duration is immutable until cancellation; pause resume and expiry preserve one timer',()=>{
 let s=step(initialScene(),{type:'timer-start',seconds:300,now:1000});const id=s.timer.id;
 for(const status of ['running','paused']){const active={...s,timer:{...s.timer,status}};for(const action of ['add','replace'])for(const seconds of [60,300])assert.equal(step(active,{type:'timer',id,action,seconds,now:2000}),active);assert.equal(step(active,{type:'timer-start',seconds:180,now:2000}),active);}
 s=step(s,{type:'timer',id,action:'pause',now:21000});assert.equal(s.timer.remaining,280);const frozen=s.timer;s=step(s,{type:'tick',now:999999});assert.equal(s.timer,frozen);
 s=step(s,{type:'timer',id,action:'resume',now:1000000});assert.equal(s.timer.deadline,1280000);s=step(s,{type:'tick',now:1280000});assert.equal(s.timer.status,'done');
 s=step(s,{type:'timer',id,action:'cancel'});s=step(s,{type:'timer-start',seconds:180,now:1280001});assert.notEqual(s.timer.id,id);assert.equal(s.timer.duration,180);assert.equal(visibleTimers(s).length,1);
});
test('extension and pause never mutate offline, stale, live or native timers and reject excessive duration',()=>{
 const state=step(initialScene(),{type:'timer-start',seconds:86400,now:1000}),id=state.timer.id;
 assert.equal(step(state,{type:'timer',id,action:'add',seconds:60,now:2000}),state);
 for(const s of [{...state,connected:false},{...state,live:true},{...state,timer:{...state.timer,stale:true}},{...state,timer:{...state.timer,ownerBootId:'native'}}])for(const action of ['pause','resume','add'])assert.equal(step(s,{type:'timer',id,action,seconds:60,now:2000}),s);
});
