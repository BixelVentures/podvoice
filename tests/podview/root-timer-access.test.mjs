import test from 'node:test';
import assert from 'node:assert/strict';
import {TimerView} from '../../podvoice/gatekeeper/static/podview/timer-view.js';
function fixture(current=null){const status={hidden:true,textContent:'',setAttribute(){}},finish={hidden:false,disabled:false},form={hidden:true,elements:[{}],setAttribute(){}};return {currentTimer:current,form,connected:false,canStart:false,detail:{querySelector:()=>status},nodes:new Map([['detail:actual',{querySelector:()=>finish}]]),updatePicker(){},status,finish};}
test('TimerView retains an unavailable first-empty draft without granting Start',()=>{const v=fixture();TimerView.prototype.renderAccess.call(v,{connected:false,canStart:false,canCancel:false,feedback:'Timerstyring er ikke tilgængelig lige nu.'});assert.equal(v.form.hidden,false);assert.equal(v.canStart,false);assert.equal(v.form.elements[0].disabled,true);assert.equal(v.status.hidden,false);assert.equal(v.status.textContent,'Timerstyring er ikke tilgængelig lige nu.');});
test('TimerView retains current timer and disables cancellation on lost authority',()=>{const timer={id:'actual',remaining:73},v=fixture(timer);TimerView.prototype.renderAccess.call(v,{connected:false,canStart:false,canCancel:false});assert.equal(v.currentTimer,timer);assert.equal(v.form.hidden,true);assert.equal(v.finish.hidden,false);assert.equal(v.finish.disabled,true);assert.equal(v.canCancel,false);});
test('pending and unknown preserve anatomy and block both actions; recovery only restores actual permissions',()=>{const v=fixture();for(const blocked of [{pending:true},{awaitingObservation:true,feedback:'Udfald ukendt · handlingen gentages ikke'}]){TimerView.prototype.renderAccess.call(v,{connected:true,canStart:true,canCancel:true,...blocked});assert.equal(v.form.hidden,false);assert.equal(v.canStart,false);assert.equal(v.canCancel,false);}TimerView.prototype.renderAccess.call(v,{connected:true,canStart:true,canCancel:false});assert.equal(v.canStart,true);assert.equal(v.canCancel,false);assert.equal(v.status.hidden,true);});
import {readFileSync} from 'node:fs';
test('actual live adapter keeps the empty form when no timer action is granted',()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),start=source.indexOf('  const canStart=connected&&snapshot?.timers'),end=source.indexOf("  if($('results').hidden",start);
 assert.ok(start>=0&&end>start);const view=fixture();view.renderAccess=TimerView.prototype.renderAccess;
 const host={timerView:view,liveActionPending:false,liveActionFeedback:''};
 new Function('connected','snapshot',source.slice(start,end)).call(host,false,{timers:{status:'unavailable'},capabilities:{timerActions:[]}});
 assert.equal(view.form.hidden,false);assert.equal(view.canStart,false);assert.equal(view.canCancel,false);assert.equal(view.status.textContent,'Timerstyring er ikke tilgængelig lige nu.');
});
test('actual adapter distinguishes active observation wait from unknown outcome in aria-busy',()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),start=source.indexOf('  const canStart=connected&&snapshot?.timers'),end=source.indexOf("  if($('results').hidden",start),render=new Function('connected','snapshot',source.slice(start,end));
 for(const [feedback,pending,busy,canStart,canCancel] of [['',true,true,false,false],['Afventer opdateret timer',false,true,false,true],['Venter på hjemmet…',false,true,false,true],['Udfald ukendt · handlingen gentages ikke',false,false,false,true],['',false,false,true,true]]){
  const view=fixture();view.status.setAttribute=function(k,v){this[k]=v;};view.form.setAttribute=function(k,v){this[k]=v;};view.renderAccess=TimerView.prototype.renderAccess;
  render.call({timerView:view,liveActionPending:pending,liveActionFeedback:feedback},true,{timers:{status:'observed'},capabilities:{timerActions:['timer.start','timer.cancel']}});
  assert.equal(view.form['aria-busy'],String(busy),feedback);assert.equal(view.status['aria-busy'],String(busy),feedback);assert.equal(view.canStart,canStart,feedback);assert.equal(view.canCancel,canCancel,feedback);
  if(busy){assert.equal(view.status.hidden,true);assert.equal(view.status.textContent,'');}
 }
});
