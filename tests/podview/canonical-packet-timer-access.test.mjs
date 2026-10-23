import {cleanupWeather} from '../../podvoice/gatekeeper/static/podview/weather-view.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {initialScene,sceneTransition} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
import {liveScene} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
import {TimerView} from '../../podvoice/gatekeeper/static/podview/timer-view.js';
function fixture(current=null){const status={dataset:{},hidden:true,textContent:'',setAttribute(){}},finish={hidden:false,disabled:false},form={hidden:true,elements:[{}],setAttribute(){},append(node){node.parentNode=this;}};return {currentTimer:current,form,connected:false,canStart:false,detail:{querySelector:()=>status},nodes:new Map([['detail:actual',{querySelector:()=>finish,querySelectorAll:()=>[],append(node){node.parentNode=this;}}]]),updatePicker(){},status,finish};}
test('TimerView retains an unavailable first-empty draft without granting Start',()=>{const v=fixture();TimerView.prototype.renderAccess.call(v,{connected:false,canStart:false,canCancel:false,feedback:'Timerstyring er ikke tilgængelig lige nu.'});assert.equal(v.form.hidden,false);assert.equal(v.canStart,false);assert.equal(v.form.elements[0].disabled,true);assert.equal(v.status.hidden,false);assert.equal(v.status.textContent,'Timerstyring er ikke tilgængelig lige nu.');});
test('TimerView retains current timer and disables cancellation on lost authority',()=>{const timer={id:'actual',remaining:73},v=fixture(timer);TimerView.prototype.renderAccess.call(v,{connected:false,canStart:false,canCancel:false});assert.equal(v.currentTimer,timer);assert.equal(v.form.hidden,true,'unresolved timer never reveals new timer controls');assert.equal(v.canStart,false);assert.equal(v.form.elements[0].disabled,true);assert.equal(v.finish.hidden,false);assert.equal(v.finish.disabled,true);assert.equal(v.canCancel,false);});
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
 for(const [feedback,pending,busy,blocked] of [['',true,true,true],['Afventer opdateret timer',false,true,true],['Venter på hjemmet…',false,true,true],['Udfald ukendt · handlingen gentages ikke',false,false,true],['',false,false,false]]){
  const view=fixture();view.status.setAttribute=function(k,v){this[k]=v;};view.form.setAttribute=function(k,v){this[k]=v;};view.renderAccess=TimerView.prototype.renderAccess;
  render.call({timerView:view,liveActionPending:pending,liveActionFeedback:feedback},true,{timers:{status:'observed'},capabilities:{timerActions:['timer.start','timer.cancel']}});
  assert.equal(view.form['aria-busy'],String(busy),feedback);assert.equal(view.status['aria-busy'],String(busy),feedback);assert.equal(view.canStart,!blocked);assert.equal(view.canCancel,!pending);
  if(busy){assert.equal(view.status.hidden,true);assert.equal(view.status.textContent,'');}
 }
});

const timerOwnerSource=readFileSync(process.env.TIMER_OWNER_SOURCE||new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
function timerOwner({items=[{id:'exact',status:'finished',physicalStopped:false,physicalDrained:false}],result={ok:true,outcome:'accepted'},held=false,actualScene=false}={}){
 let now=1000,counter=0;const resolvers=[];const scheduled=new Map(),calls=[],messages=[];
 const snapshot=(overrides={})=>({bootId:'boot',roomId:'kitchen',revision:10,voice:{sessionId:'timer-session'},timers:{status:'observed',epoch:'epoch',items},capabilities:{homeRead:[],timerActions:['timer.start','timer.cancel']},...overrides});
 const begin=timerOwnerSource.indexOf(' connectPodVoice(){'),end=timerOwnerSource.indexOf(' renderVoice(){',begin),send=timerOwnerSource.indexOf(' async sendLiveTimer(request){'),sendEnd=timerOwnerSource.indexOf(' async loadLiveHome(){',send),reconcile=timerOwnerSource.indexOf(' suspendLiveTimer(){')>=0?timerOwnerSource.indexOf(' suspendLiveTimer(){'):timerOwnerSource.indexOf(' reconcileLiveTimer(snapshot){'),cleanup=timerOwnerSource.indexOf(' cleanup(){'),cleanupEnd=timerOwnerSource.indexOf(' dispatch(event){',cleanup);
 assert.ok(begin>=0&&end>begin&&send>=0&&sendEnd>send);
 class Transport{constructor(options){this.options=options;this.connected=true;}start(){return Promise.resolve();}close(){}action(request){calls.push(request);return held?new Promise(done=>{resolvers.push(done);}):Promise.resolve(result);}}
 const lightCleanup=timerOwnerSource.indexOf(' closeLightDetail('),lightCleanupEnd=timerOwnerSource.indexOf(' toggleLightOption(',lightCleanup);assert.ok(lightCleanup>=0&&lightCleanupEnd>lightCleanup);
 const methods=timerOwnerSource.slice(cleanup,cleanupEnd)+timerOwnerSource.slice(lightCleanup,lightCleanupEnd)+timerOwnerSource.slice(begin,end)+(reconcile>=0?timerOwnerSource.slice(reconcile,send):'')+timerOwnerSource.slice(send,sendEnd);
 const Host=new Function('cleanupWeather','$','PodVoiceTransport','liveScene','location','setTimeout','clearTimeout','Date','crypto',`return class {${methods}}`)(cleanupWeather,()=>null,Transport,actualScene?liveScene:(state)=>state,{search:''},(fn,delay)=>{const id=++counter;scheduled.set(id,{fn,at:now+delay});return id;},id=>scheduled.delete(id),{now:()=>now},{randomUUID:()=>`inert-request-${calls.length+1}`});
 const host=new Host();Object.assign(host,{isConnected:true,state:actualScene?{...initialScene(),focus:'timers'}:{devices:[],extraTimers:[],focus:'timers'},liveSnapshot:snapshot(),render(){},renderLive(){},showFeedback:text=>messages.push(text),invalidateLiveMusic(){}});if(actualScene){host.state=liveScene(host.state,host.liveSnapshot);host.live=true;host.dispatch=event=>{host.state=sceneTransition(host.state,event);};}host.connectPodVoice();host.liveStatus='connected';
 return {host,calls,messages,snapshot,settle:(value,index=0)=>resolvers[index](value),observe:value=>host.liveTransport.options.onSnapshot(value),advance:ms=>{now+=ms;for(const [id,timer]of [...scheduled])if(timer.at<=now){scheduled.delete(id);timer.fn();}},scheduled};
}
const cancelExact={action:'timer.cancel',args:{timer_id:'exact'}},startOne={action:'timer.start',args:{seconds:10,name:'Exact'}};
const unknownText='Udfald ukendt · handlingen gentages ikke';
test('accepted cancel has finite visible uncertainty without a second dispatch',async()=>{
 const t=timerOwner();await t.host.sendLiveTimer(cancelExact);assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');t.advance(11999);assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');t.advance(1);assert.equal(t.host.liveActionFeedback,unknownText);assert.equal(t.host.liveActionPending,false);
 await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,1);assert.equal(t.messages.length,1);
});
test('unrelated shared revision cannot resolve accepted timer cancellation',async()=>{
 const t=timerOwner();await t.host.sendLiveTimer(cancelExact);t.observe(t.snapshot({revision:11,voice:{phase:'RESPONDING'}}));assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,1);
});
test('equal shared revision exact scoped removal resolves observation without success claim',async()=>{
 const t=timerOwner();await t.host.sendLiveTimer(cancelExact);t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[]}}));assert.equal(t.host.liveActionFeedback,'');assert.equal(t.host.liveTimerAction,null);assert.equal(t.scheduled.size,0);assert.deepEqual(t.messages,['Timeranmodningen er modtaget']);assert.equal(t.calls.length,1);
});
test('drained or stopped audio is not timer removal or finished acknowledgement',async()=>{
 for(const proof of [{physicalStopped:true},{physicalDrained:true},{physicalStopped:true,physicalDrained:true}]){
  const t=timerOwner();await t.host.sendLiveTimer(cancelExact);t.observe(t.snapshot({revision:11,timers:{status:'observed',epoch:'epoch',items:[{id:'exact',status:'finished',...proof}]}}));assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');t.advance(12000);assert.equal(t.host.liveActionFeedback,unknownText);await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,1);
 }
});
test('new boot room or epoch retires old scope without claiming completion and permits fresh intent',async()=>{
 for(const result of [{ok:true,outcome:'accepted'},{ok:false,outcome:'unknown'}])for(const change of [{bootId:'foreign'},{roomId:'foreign'},{timers:{status:'observed',epoch:'foreign',items:[]}}]){
  const t=timerOwner({result});await t.host.sendLiveTimer(cancelExact);const count=t.messages.length;t.observe(t.snapshot({...change,timers:change.timers||{status:'observed',epoch:'epoch',items:[]}}));assert.equal(t.host.liveActionFeedback,'');assert.equal(t.host.liveTimerAction,null);assert.equal(t.messages.length,count);assert.equal(t.scheduled.size,0);await t.host.sendLiveTimer(startOne);assert.equal(t.calls.length,2);
 }
});
test('unavailable or disconnected data cannot retire or complete same-scope action',async()=>{
 for(const disconnected of [false,true]){const t=timerOwner();await t.host.sendLiveTimer(cancelExact);if(disconnected){t.host.liveStatus='disconnected';t.host.liveTransport.connected=false;}t.observe(t.snapshot({revision:11,timers:{status:disconnected?'observed':'unavailable',epoch:'epoch',items:[]}}));assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');assert.ok(t.host.liveTimerAction);}
});
test('snapshot arriving during held request is reconciled after receipt without replay',async()=>{
 const t=timerOwner({held:true}),pending=t.host.sendLiveTimer(cancelExact);t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[]}}));await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,1);assert.equal(t.host.liveActionPending,true);t.settle({ok:true,outcome:'accepted'});await pending;assert.equal(t.host.liveActionFeedback,'');assert.equal(t.host.liveActionPending,false);assert.equal(t.scheduled.size,0);
});
test('unknown cancel stays unknown on unrelated updates and only exact absence restores current controls',async()=>{
 const t=timerOwner({result:{ok:false,outcome:'unknown',retryAllowed:false}});await t.host.sendLiveTimer(cancelExact);assert.equal(t.host.liveActionFeedback,unknownText);t.observe(t.snapshot({revision:11}));assert.equal(t.host.liveActionFeedback,unknownText);await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,1);assert.equal(t.messages.length,0);t.observe(t.snapshot({revision:11,timers:{status:'observed',epoch:'epoch',items:[]}}));assert.equal(t.host.liveActionFeedback,'');assert.equal(t.host.liveTimerAction,null);assert.equal(t.calls.length,1);assert.equal(t.messages.length,0);
});
test('rejected request is not automatically repeated and fresh explicit request remains possible',async()=>{
 const t=timerOwner({result:{ok:false,error:'stale_action',retryAllowed:false}});await t.host.sendLiveTimer(cancelExact);assert.match(t.host.liveActionFeedback,/afvist/);assert.equal(t.calls.length,1);assert.equal(t.scheduled.size,0);await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,2);
});
test('accepted Start waits for real same-scope timer; unknown Start is not guessed by name',async()=>{
 const t=timerOwner({items:[],result:{ok:true,outcome:'accepted',timerId:'native-new'}});await t.host.sendLiveTimer(startOne);t.observe(t.snapshot({revision:11}));assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');t.observe(t.snapshot({revision:11,timers:{status:'observed',epoch:'epoch',items:[{id:'native-new',name:'Someone else',status:'running'}]}}));assert.equal(t.host.liveActionFeedback,'');assert.deepEqual(t.messages,['Timeranmodningen er modtaget']);assert.equal(t.calls.length,1);
 const u=timerOwner({items:[],result:{ok:false,outcome:'unknown'}});await u.host.sendLiveTimer(startOne);u.observe(u.snapshot({revision:11,timers:{status:'observed',epoch:'epoch',items:[{id:'unproven',name:'Exact',status:'running'}]}}));assert.equal(u.host.liveActionFeedback,unknownText);await u.host.sendLiveTimer(startOne);assert.equal(u.calls.length,1);
});
test('expired accepted wait remains visibly uncertain after its scheduled timer was cleaned up',async()=>{
 const t=timerOwner();await t.host.sendLiveTimer(cancelExact);t.scheduled.clear();t.advance(12000);t.observe(t.snapshot());assert.equal(t.host.liveActionFeedback,unknownText);assert.equal(t.calls.length,1);
});

test('held completion after actual cleanup cannot mutate feedback or schedule detached work',async()=>{
 const t=timerOwner({held:true}),pending=t.host.sendLiveTimer(cancelExact);t.host.isConnected=false;t.host.cleanup();assert.equal(t.host.liveActionFeedback,unknownText);assert.equal(t.host.liveActionPending,false);const retained=t.host.liveTimerAction;t.settle({ok:true,outcome:'accepted'});await pending;assert.equal(t.host.liveActionFeedback,unknownText);assert.equal(t.host.liveTimerAction,retained);assert.equal(t.messages.length,0);assert.equal(t.scheduled.size,0);assert.equal(t.calls.length,1);
});
test('same-scope reconnect preserves uncertainty and blocks original dispatch until exact absence',async()=>{
 const t=timerOwner({held:true}),pending=t.host.sendLiveTimer(cancelExact);t.host.cleanup();t.host.connectPodVoice();t.host.liveStatus='connected';t.observe(t.snapshot({revision:11}));assert.equal(t.host.liveActionFeedback,unknownText);assert.ok(t.host.liveTimerAction);await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,1);t.settle({ok:true,outcome:'accepted'});await pending;assert.equal(t.host.liveActionFeedback,unknownText);assert.equal(t.messages.length,0);assert.equal(t.scheduled.size,0);t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[]}}));assert.equal(t.host.liveActionFeedback,'');assert.equal(t.host.liveTimerAction,null);
});
test('old held completion cannot overwrite a newer operation after authoritative scope replacement',async()=>{
 const t=timerOwner({held:true}),old=t.host.sendLiveTimer(cancelExact);t.observe(t.snapshot({bootId:'new',timers:{status:'observed',epoch:'epoch',items:[]}}));assert.equal(t.host.liveTimerAction,null);const next=t.host.sendLiveTimer(startOne),operation=t.host.liveTimerAction;assert.equal(t.calls.length,2);assert.equal(t.host.liveActionPending,true);t.settle({ok:true,outcome:'accepted'},0);await old;assert.equal(t.host.liveTimerAction,operation);assert.equal(t.host.liveActionPending,true);assert.equal(t.host.liveActionFeedback,'');assert.equal(t.messages.length,0);t.settle({ok:false,outcome:'unknown'},1);await next;assert.equal(t.host.liveActionFeedback,unknownText);assert.equal(t.host.liveTimerAction,operation);
});
test('transient transport disconnect fences late receipt while preserving same-scope UNKNOWN',async()=>{
 const t=timerOwner({held:true}),pending=t.host.sendLiveTimer(cancelExact);t.host.liveTransport.connected=false;t.host.liveTransport.options.onConnection('disconnected');assert.equal(t.host.liveActionFeedback,unknownText);assert.equal(t.host.liveActionPending,false);t.settle({ok:true,outcome:'accepted'});await pending;assert.equal(t.messages.length,0);assert.equal(t.scheduled.size,0);t.host.liveTransport.connected=true;t.host.liveTransport.options.onConnection('connected');t.observe(t.snapshot({revision:11}));assert.equal(t.host.liveActionFeedback,unknownText);await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,1);
});


test('additional accepted Start requires a new scoped timer ID, not changed existing timers',async()=>{
 const t=timerOwner({items:[{id:'existing',status:'running'}],result:{ok:true,outcome:'accepted',timerId:'second'}});await t.host.sendLiveTimer(startOne);
 t.observe(t.snapshot({revision:11,timers:{status:'observed',epoch:'epoch',items:[{id:'existing',status:'finished'}]}}));assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');
 t.observe(t.snapshot({revision:11,timers:{status:'observed',epoch:'epoch',items:[{id:'existing',status:'finished'},{id:'second',status:'running'}]}}));assert.equal(t.host.liveTimerAction,null);assert.equal(t.host.liveActionFeedback,'');assert.equal(t.scheduled.size,0);
 await t.host.sendLiveTimer(startOne);assert.equal(t.calls.length,2);assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');
 assert.equal(t.calls.length,2);
});
test('additional timer snapshot before accepted receipt resolves without duplicate dispatch',async()=>{
 const t=timerOwner({items:[{id:'existing',status:'running'}],held:true}),pending=t.host.sendLiveTimer(startOne);
 t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[{id:'existing',status:'running'},{id:'second',status:'running'}]}}));assert.equal(t.host.liveActionPending,true);await t.host.sendLiveTimer(startOne);assert.equal(t.calls.length,1);
 t.settle({ok:true,outcome:'accepted',timerId:'second'});await pending;assert.equal(t.host.liveTimerAction,null);assert.equal(t.host.liveActionFeedback,'');assert.equal(t.scheduled.size,0);
});
test('new scoped timer before rejected or unknown receipt does not become successful Start',async()=>{
 for(const result of [{ok:false,error:'stale_action'},{ok:false,outcome:'unknown'}]){
  const t=timerOwner({items:[{id:'existing',status:'running'}],held:true}),pending=t.host.sendLiveTimer(startOne);
  t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[{id:'existing',status:'running'},{id:'other-owner',status:'running'}]}}));t.settle(result);await pending;
  assert.equal(t.messages.length,0);assert.equal(t.scheduled.size,0);assert.equal(t.calls.length,1);
  if(result.outcome==='unknown'){assert.equal(t.host.liveActionFeedback,unknownText);assert.ok(t.host.liveTimerAction);await t.host.sendLiveTimer(startOne);assert.equal(t.calls.length,1);}
  else {assert.match(t.host.liveActionFeedback,/afvist/);assert.equal(t.host.liveTimerAction,null);}
 }
});
test('old rejected receipt after scope replacement cannot overwrite newer timer action',async()=>{
 const t=timerOwner({held:true}),old=t.host.sendLiveTimer(startOne);t.observe(t.snapshot({roomId:'other'}));const next=t.host.sendLiveTimer(startOne),operation=t.host.liveTimerAction;
 t.settle({ok:false,error:'stale_action'},0);await old;assert.equal(t.host.liveTimerAction,operation);assert.equal(t.host.liveActionPending,true);assert.equal(t.host.liveActionFeedback,'');
 t.settle({ok:false,outcome:'unknown'},1);await next;assert.equal(t.host.liveActionFeedback,unknownText);
});

test('accepted Start requires exact receipt ID, including from an empty list',async()=>{
 for(const items of [[],[{id:'existing',status:'running'}]])for(const timerId of [undefined,'','x'.repeat(201),42,'receipt-id']){
  const t=timerOwner({items,result:{ok:true,outcome:'accepted',timerId}});await t.host.sendLiveTimer(startOne);
  t.observe(t.snapshot({revision:11,timers:{status:'observed',epoch:'epoch',items:[...items,{id:'unrelated',name:'Exact',status:'running'}]}}));assert.equal(t.host.liveActionFeedback,'Afventer opdateret timer');assert.ok(t.host.liveTimerAction);
  t.advance(12000);assert.equal(t.host.liveActionFeedback,unknownText);await t.host.sendLiveTimer(startOne);assert.equal(t.calls.length,1);
  t.observe(t.snapshot({revision:12,timers:{status:'observed',epoch:'epoch',items:[...items,{id:'receipt-id',status:'running'}]}}));assert.equal(t.host.liveActionFeedback,timerId==='receipt-id'?'':unknownText);
 }
});

test('UNKNOWN Start allows independent observed Cancel while retaining original Start fence',async()=>{
 const t=timerOwner({items:[],held:true});const start=t.host.sendLiveTimer(startOne);t.settle({ok:false,outcome:'unknown'});await start;
 t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[{id:'actual',status:'finished'}]}}));
 const cancel=t.host.sendLiveTimer({action:'timer.cancel',args:{timer_id:'actual'}});assert.equal(t.calls.length,2);t.settle({ok:true,outcome:'accepted'},1);await cancel;
 t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[]}}));assert.equal(t.host.liveTimerAction,null);await t.host.sendLiveTimer(startOne);assert.equal(t.calls.length,2);assert.equal(t.host.liveTimerFences.length,1);
});
test('UNKNOWN cancellation blocks same ID but permits distinct observed timer cancellation',async()=>{
 const t=timerOwner({items:[{id:'exact'},{id:'other'}],result:{ok:false,outcome:'unknown'}});await t.host.sendLiveTimer(cancelExact);await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,1);
 await t.host.sendLiveTimer({action:'timer.cancel',args:{timer_id:'other'}});assert.equal(t.calls.length,2);await t.host.sendLiveTimer(cancelExact);assert.equal(t.calls.length,2);
});
test('TimerView exposes only independent Cancel buttons while Start is uncertain',()=>{
 const v=fixture({id:'other'}),blocked={hidden:false,disabled:false},other={hidden:false,disabled:true};v.nodes=new Map([['exact',{dataset:{timerId:'exact'},querySelector:()=>blocked,querySelectorAll:()=>[]}],['other',{dataset:{timerId:'other'},querySelector:()=>other,querySelectorAll:()=>[]}]]);
 TimerView.prototype.renderAccess.call(v,{connected:true,canStart:true,canCancel:true,awaitingObservation:true,allowIndependentCancel:true,cancelBlockedIds:['exact'],feedback:unknownText});assert.equal(v.canStart,false);assert.equal(blocked.disabled,true);assert.equal(other.disabled,false);
});

test('unavailable epoch does not erase retained Start fence through actual access projection',async()=>{
 const t=timerOwner({items:[],held:true}),start=t.host.sendLiveTimer(startOne);t.settle({ok:false,outcome:'unknown'});await start;
 t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[{id:'alarm',status:'finished'}]}}));const cancel=t.host.sendLiveTimer({action:'timer.cancel',args:{timer_id:'alarm'}});t.settle({ok:true,outcome:'accepted'},1);await cancel;t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[]}}));
 const begin=timerOwnerSource.indexOf('  const canStart=connected&&snapshot?.timers'),end=timerOwnerSource.indexOf("  if($('results').hidden",begin),render=new Function('connected','snapshot',timerOwnerSource.slice(begin,end));t.host.timerView={renderAccess(value){this.access=value;}};
 t.observe(t.snapshot({timers:{status:'unavailable',epoch:null,items:[]}}));render.call(t.host,true,t.host.liveSnapshot);assert.equal(t.host.liveTimerFences.length,1);await t.host.sendLiveTimer(startOne);assert.equal(t.calls.length,2);
 t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[]}}));render.call(t.host,true,t.host.liveSnapshot);assert.equal(t.host.timerView.access.awaitingObservation,true);await t.host.sendLiveTimer(startOne);assert.equal(t.calls.length,2);
});

test('retained UNKNOWN Start explains disabled empty form after independent observed cancellation',async()=>{
 const t=timerOwner({items:[],held:true}),start=t.host.sendLiveTimer(startOne);t.settle({ok:false,outcome:'unknown'});await start;
 t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[{id:'alarm',status:'finished'}]}}));const stop=t.host.sendLiveTimer({action:'timer.cancel',args:{timer_id:'alarm'}});t.settle({ok:true,outcome:'accepted'},1);await stop;t.observe(t.snapshot({timers:{status:'observed',epoch:'epoch',items:[]}}));
 const begin=timerOwnerSource.indexOf('  const canStart=connected&&snapshot?.timers'),end=timerOwnerSource.indexOf("  if($('results').hidden",begin),render=new Function('connected','snapshot',timerOwnerSource.slice(begin,end)),view=fixture();view.renderAccess=TimerView.prototype.renderAccess;t.host.timerView=view;
 render.call(t.host,true,t.host.liveSnapshot);assert.equal(view.form.hidden,false);assert.equal(view.canStart,false);assert.equal(view.status.hidden,false);assert.equal(view.status.textContent,'En tidligere timerhandling har ukendt udfald. Ny timerstart er derfor blokeret.');assert.equal(t.host.liveActionFeedback,'');assert.equal(t.host.liveTimerFences.length,1);await t.host.sendLiveTimer(startOne);assert.equal(t.calls.length,2);
 t.observe(t.snapshot({timers:{status:'observed',epoch:'new-authoritative-epoch',items:[]}}));render.call(t.host,true,t.host.liveSnapshot);assert.equal(view.canStart,true);assert.equal(view.status.hidden,true);assert.equal(view.status.textContent,'');
});


test('actual TimerView return consumes fresh liveScene and snapshot in both receipt-first and snapshot-first orders',async()=>{
 for(const order of ['receipt-first','snapshot-first']){
  const t=timerOwner({items:[],held:true,actualScene:true}),view=Object.assign(Object.create(TimerView.prototype),{host:t.host}),token={sessionId:t.host.state.sessionId,generation:t.host.state.generation,bootId:'boot',roomId:'kitchen',epoch:'epoch'};view.startNavigation=token;t.host.timerView=view;let returns=0;t.host.focusHeading=()=>{returns++;assert.equal(t.host.state.timer?.id,'native-exact','navigation sees the adopted timer scene');assert.equal(t.host.liveSnapshot.timers.items[0].id,'native-exact','navigation sees the authoritative snapshot');};
  const music=t.host.state.music,pending=t.host.sendLiveTimer(startOne),observed=t.snapshot({revision:11,timers:{status:'observed',epoch:'epoch',items:[{id:'native-exact',name:'Exact',secondsLeft:10,status:'running'}]}});
  assert.equal(t.host.state.focus,'timers');if(order==='snapshot-first'){t.observe(observed);assert.equal(t.host.state.focus,'timers');}
  t.settle({ok:true,outcome:'accepted',timerId:'native-exact'});await pending;if(order==='receipt-first'){assert.equal(t.host.state.focus,'timers','accepted receipt alone cannot navigate');t.observe(observed);}
  assert.equal(t.host.state.focus,'now',order);assert.equal(t.host.state.timer.id,'native-exact');assert.equal(t.host.state.timer.status,'running');assert.equal(returns,1);assert.equal(t.host.state.music.playback.room,music.playback.room);assert.equal(t.calls.length,1);
 }
});
