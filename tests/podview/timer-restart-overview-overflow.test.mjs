import test from 'node:test';
import assert from 'node:assert/strict';
import {initialScene,sceneTransition as step} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {liveTimerRequest} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
import {overviewGroupOverflow} from '../../podvoice/gatekeeper/static/podview/home-model.js';

const snapshot=(items,actions=['timer.start','timer.cancel'])=>({
 timers:{status:'observed',items},capabilities:{timerActions:actions}
});
const finished={id:'done-1',name:'Pasta',status:'finished',secondsLeft:0,durationSeconds:600,sourceRevision:'4'};

test('Start igen restarts a finished local timer with the same duration and label',()=>{
 let s=step(initialScene(),{type:'timer-start',seconds:600,name:'Pasta',now:0});
 s=step(s,{type:'tick',now:600000});
 assert.equal(s.timer.status,'done');
 s=step(s,{type:'timer',id:s.timer.id,action:'restart',now:700000});
 assert.equal(s.timer.status,'running');
 assert.equal(s.timer.duration,600);
 assert.equal(s.timer.remaining,600);
 assert.equal(s.timer.name,'Pasta');
 assert.equal(s.timer.deadline,1300000);
 const running=step(s,{type:'timer',id:s.timer.id,action:'restart',now:800000});
 assert.equal(running,s,'a running timer is never restarted');
});

test('Start igen asks the gatekeeper to restart only a finished native timer with known duration',()=>{
 assert.deepEqual(liveTimerRequest(snapshot([finished]),true,{type:'timer',action:'restart',id:'done-1'}),
  {action:'timer.restart',args:{timer_id:'done-1'}});
 const noDuration={...finished,durationSeconds:undefined};
 assert.equal(liveTimerRequest(snapshot([noDuration]),true,{type:'timer',action:'restart',id:'done-1'}),null);
 const running={...finished,id:'run-1',status:'running',secondsLeft:30};
 assert.equal(liveTimerRequest(snapshot([finished,running]),true,{type:'timer',action:'restart',id:'done-1'}),null);
 assert.equal(liveTimerRequest(snapshot([finished],['timer.start']),true,{type:'timer',action:'restart',id:'done-1'}),null);
 assert.equal(liveTimerRequest(snapshot([finished]),false,{type:'timer',action:'restart',id:'done-1'}),null);
});

test('extra robots and lights leave the grid; the group card counts them and opens the first',()=>{
 const overflow=overviewGroupOverflow([
  {id:'vacuum.a',kind:'vacuum'},{id:'light.a',kind:'light'},{id:'vacuum.b',kind:'vacuum'},
  {id:'vacuum.c',kind:'vacuum'},{id:'vacuum.hidden',kind:'vacuum',hidden:true},{id:'home-weather',kind:undefined}
 ]);
 assert.deepEqual(overflow.get('vacuum.a'),{extra:false,more:2,openId:'vacuum.b'});
 assert.deepEqual(overflow.get('vacuum.b'),{extra:true,more:0,openId:null});
 assert.deepEqual(overflow.get('vacuum.c'),{extra:true,more:0,openId:null});
 assert.deepEqual(overflow.get('light.a'),{extra:false,more:0,openId:null});
 assert.equal(overflow.has('vacuum.hidden'),false);
 assert.equal(overflow.has('home-weather'),false);
});
