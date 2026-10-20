import test from 'node:test';
import assert from 'node:assert/strict';
import {TimerNotice} from '../../podvoice/gatekeeper/static/podview/timer-notice.js';
import {timerTransition} from '../../podvoice/gatekeeper/static/podview/timer-model.js';
class FakeElement {
 constructor(){this.hidden=true;this.open=false;this.dataset={};this.listeners=new Map();this.textContent='';this.children=new Map();this.opens=0;this.closes=0;}
 querySelector(s){if(!this.children.has(s))this.children.set(s,new FakeElement());return this.children.get(s);}
 addEventListener(t,f){this.listeners.set(t,f);}removeEventListener(t,f){if(this.listeners.get(t)===f)this.listeners.delete(t);}
 showModal(){this.open=true;this.opens++;}close(){this.open=false;this.closes++;}focus(){this.focused=true;}
}
function setup(){const jobs=new Map(),all=new Map(),dispatched=[];let serial=0;const element=new FakeElement(),previous={isConnected:true,focus(){this.restored=true;}};element.ownerDocument={activeElement:previous};const notice=new TimerNotice({dispatch:e=>dispatched.push(e)},element,{setTimer(fn,ms){const id=++serial;jobs.set(id,{fn,ms});all.set(id,fn);return id;},clearTimer:id=>jobs.delete(id)});return{notice,element,jobs,all,dispatched,previous};}
const done={id:'one',name:'Pasta',status:'done'},access={canCancel:true};
const render=(n,t=done,live=false,a=access)=>n.render(t,'music',live,true,t?.id,a);

test('fullscreen completion opens despite visible timer and music feedback, retaining one entry and pulse budget',()=>{const f=setup();render(f.notice);assert.equal(f.element.open,true);assert.equal(f.element.hidden,false);assert.equal(f.element.opens,1);assert.equal([...f.jobs.values()][0].ms,60000);assert.equal(f.element.dataset.pulse,'true');render(f.notice,{...done});assert.equal(f.element.opens,1);assert.equal(f.jobs.size,2);const job=[...f.jobs.values()][0];job.fn();assert.equal(f.element.dataset.pulse,'false');assert.equal(f.element.open,true,'pulse expiry must never acknowledge an alarm');render(f.notice,{...done});assert.equal(f.element.dataset.pulse,'false');f.notice.cleanup();});

test('Stop targets only the authorized timer; native completion stays until observed owner change',()=>{const f=setup();render(f.notice,{...done,ownerBootId:'boot'},true);assert.equal(f.notice.stop.textContent,'Stop alarm');f.notice.stop.listeners.get('click')();assert.deepEqual(f.dispatched,[{type:'timer',id:'one',action:'cancel'}]);assert.equal(f.element.open,true);render(f.notice,{...done,ownerBootId:'boot'},true,{canCancel:false,pending:true});f.notice.stop.listeners.get('click')();assert.equal(f.dispatched.length,1);assert.equal(f.notice.status.textContent,'Afventer timerens svar');render(f.notice,{...done,status:'cancelled'},true);assert.equal(f.element.open,false);assert.equal(f.previous.restored,true);});

test('offline and per-ID fenced native alarms never dispatch stop; dismissal remains honest acknowledgment',()=>{for(const a of [{canCancel:false},{canCancel:true,cancelBlockedIds:['one']}]){const f=setup();render(f.notice,{...done,ownerBootId:'boot'},true,a);assert.equal(f.notice.stop.disabled,true);assert.match(f.notice.status.textContent,/Luk visning stopper ikke alarmen/);f.notice.stop.listeners.get('click')();assert.deepEqual(f.dispatched,[]);f.notice.closeButton.listeners.get('click')();assert.deepEqual(f.dispatched,[{type:'timer-notice-dismiss',id:'one'}]);const state={timer:done,extraTimers:[{id:'two',status:'done'}]};const next=timerTransition(state,f.dispatched[0]);assert.equal(next.timer.status,'done');assert.equal(next.timer.noticeDismissed,true);assert.equal(next.extraTimers[0].noticeDismissed,undefined);assert.equal(f.previous.restored,true);}});

test('Escape explicitly acknowledges the view without claiming native stop',()=>{const f=setup();render(f.notice,{...done,ownerBootId:'boot'},true);let prevented=false;f.element.listeners.get('cancel')({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.deepEqual(f.dispatched,[{type:'timer-notice-dismiss',id:'one'}]);assert.equal(f.element.open,false);});

test('replacing timer fences old pulse callback and stale dismissal; unchanged dialog preserves focus',()=>{const f=setup();render(f.notice);const old=[...f.all.values()][0];render(f.notice,{...done,id:'two'});old();f.notice.dismiss('one');assert.equal(f.element.dataset.pulse,'true');assert.equal(f.element.dataset.timerId,'two');assert.equal(f.element.opens,1);assert.deepEqual(f.dispatched,[]);f.notice.dismiss('two');assert.equal(f.jobs.size,0);});

test('stale, dismissed and stopped observations cannot present a new alarm; cleanup removes every listener and timer',()=>{const f=setup();for(const t of [{...done,stale:true},{...done,noticeDismissed:true},{...done,status:'cancelled'}]){render(f.notice,t);assert.equal(f.element.open,false);}render(f.notice);const old=[...f.all.values()][0];f.notice.cleanup();old();assert.equal(f.element.open,false);assert.equal(f.jobs.size,0);assert.equal(f.element.listeners.size,0);assert.equal(f.notice.stop.listeners.size,0);assert.equal(f.notice.closeButton.listeners.size,0);render(f.notice);assert.equal(f.element.open,true);f.notice.cleanup();});

test('reduced motion suppresses pulse and changing preference cancels its timer without hiding alarm',()=>{const prior=globalThis.matchMedia;let callback;const media={matches:true,addEventListener(t,f){callback=f;},removeEventListener(t,f){assert.equal(f,callback);callback=null;}};globalThis.matchMedia=()=>media;try{const f=setup();render(f.notice);assert.equal(f.jobs.size,1);assert.equal(f.element.dataset.pulse,'false');media.matches=false;callback();render(f.notice,{...done,id:'two'});assert.equal(f.jobs.size,2);media.matches=true;callback();assert.equal(f.jobs.size,1);assert.equal(f.element.open,true);assert.equal(f.element.dataset.pulse,'false');f.notice.cleanup();assert.equal(callback,null);}finally{globalThis.matchMedia=prior;}});

test('alarm uses a generic title while local Stop still resolves the individual timer',()=>{
 const f=setup();render(f.notice);assert.equal(f.notice.name.textContent,'Timeren er færdig');
 f.notice.stop.listeners.get('click')();const state={timer:done,extraTimers:[{id:'two',name:'Te',status:'done'}]};const after=timerTransition(state,f.dispatched[0]);assert.equal(after.timer.status,'cancelled');assert.equal(after.extraTimers[0].status,'done');
 render(f.notice,after.extraTimers[0]);assert.equal(f.notice.name.textContent,'Timeren er færdig');render(f.notice,{id:'unnamed',status:'done',name:'  '});assert.equal(f.notice.name.textContent,'Timeren er færdig');f.notice.cleanup();
});

test('completed local timer can restart for one minute; native, offline and fenced timers cannot',()=>{
 const f=setup();render(f.notice);assert.equal(f.notice.add.hidden,false);assert.equal(f.notice.add.disabled,false);f.notice.add.listeners.get('click')();const event=f.dispatched[0];assert.equal(event.id,'one');assert.equal(event.action,'add');assert.equal(event.seconds,60);
 const next=timerTransition({connected:true,timer:done,extraTimers:[]},event);render(f.notice,next.timer);assert.equal(f.element.open,false);assert.equal(next.timer.remaining,60);render(f.notice,{...next.timer,status:'done'});assert.equal(f.element.dataset.pulse,'true','a restarted timer receives a new bounded alarm');
 for(const [timer,live,a] of [[{...done,ownerBootId:'native'},false,access],[done,true,access],[done,false,{canCancel:false}],[done,false,{canCancel:true,connected:false}]]){render(f.notice,timer,live,a);const count=f.dispatched.length;f.notice.add.listeners.get('click')();assert.equal(f.dispatched.length,count);assert.equal(f.notice.add.disabled,true);}
 f.notice.cleanup();assert.equal(f.notice.add.listeners.size,0);
});

function audibleFixture({reject=false}={}){
 let clock=1000,serial=0,plays=0,pauses=0,elapsed=0;const jobs=new Map(),events=[],element=new FakeElement(),audio={currentTime:0,play(){plays++;return reject?Promise.reject(new Error('autoplay blocked')):Promise.resolve();},pause(){pauses++;}};
 const host={dispatch(event){events.push(event);}},notice=new TimerNotice(host,element,{now:()=>clock,createAudio:()=>audio,setTimer(fn,ms){const id=++serial;jobs.set(id,{at:clock+ms,fn});return id;},clearTimer:id=>jobs.delete(id),onElapsed:()=>elapsed++});
 return{notice,element,jobs,events,get plays(){return plays;},get pauses(){return pauses;},get elapsed(){return elapsed;},advance(ms){const until=clock+ms;for(;;){const next=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>until)break;clock=next[1].at;jobs.delete(next[0]);next[1].fn();}clock=until;}};
}
test('browser bell repeats every four seconds, stops at five minutes and retains timestamp without cancelling timer',async()=>{
 const f=audibleFixture();render(f.notice,{...done,deadline:900});await Promise.resolve();assert.equal(f.plays,1);render(f.notice,{...done,deadline:900});assert.equal(f.plays,1,'unchanged render must not restart bell');f.advance(3999);assert.equal(f.plays,1);f.advance(1);assert.equal(f.plays,2);f.advance(296000);assert.equal(f.plays,75);assert.equal(f.jobs.size,0);assert.equal(f.element.open,false);assert.equal(f.elapsed,1);assert.deepEqual(f.events,[{type:'timer-notice-dismiss',id:'one'}]);assert.equal(f.notice.completions.get('one').at,900);assert.equal(f.notice.completions.get('one').played,true);assert.equal(f.notice.completions.get('one').exhausted,true);f.advance(60000);assert.equal(f.plays,75);
});
test('autoplay rejection stays nonfatal and honest, retains visual alarm, and cannot become repeated rejected plays',async()=>{
 const f=audibleFixture({reject:true});render(f.notice);await Promise.resolve();assert.equal(f.element.open,true);assert.match(f.notice.status.textContent,/Lyd kunne ikke afspilles/);assert.equal(f.notice.status.hidden,false);f.advance(8000);assert.equal(f.plays,1);assert.equal(f.notice.completions.get('one').played,false);f.notice.cleanup();assert.equal(f.jobs.size,0);assert.equal(f.element.open,false);
});
test('dismiss, Stop, restart and disconnect cancel browser audio callbacks; native alarms never gain browser audio',()=>{
 for(const action of ['dismiss','stop','add','cleanup']){const f=audibleFixture();render(f.notice);const before=f.plays;if(action==='dismiss')f.notice.dismiss('one');else if(action==='cleanup')f.notice.cleanup();else f.notice[action].listeners.get('click')();f.advance(8000);assert.equal(f.plays,before,action);assert(f.pauses>0);f.notice.cleanup();assert.equal(f.jobs.size,0);}
 for(const [timer,live] of [[{...done,ownerBootId:'native'},false],[done,true]]){const f=audibleFixture();render(f.notice,timer,live);f.advance(8000);assert.equal(f.plays,0);f.notice.cleanup();}
});

test('missing or throwing Audio constructor cannot suppress the five-minute visual expiry',()=>{
 for(const createAudio of [()=>null,()=>{throw new Error('Audio unavailable');}]){
  let now=0,serial=0,elapsed=0;const jobs=new Map(),events=[],element=new FakeElement();const notice=new TimerNotice({dispatch:e=>events.push(e)},element,{now:()=>now,createAudio,setTimer(fn,ms){const id=++serial;jobs.set(id,{fn,at:now+ms});return id;},clearTimer:id=>jobs.delete(id),onElapsed:()=>elapsed++});
  render(notice);assert.equal(element.open,true);assert.match(notice.status.textContent,/Lyd kunne ikke afspilles/);now=300000;for(const [id,job]of [...jobs])if(job.at<=now){jobs.delete(id);job.fn();}assert.equal(element.open,false);assert.equal(elapsed,1);assert.equal(jobs.size,0);assert.equal(notice.completions.get('one').exhausted,true);assert.equal(notice.completions.get('one').played,false);assert.deepEqual(events,[{type:'timer-notice-dismiss',id:'one'}]);notice.cleanup();
 }
});

test('disconnect and reconnect retain the original alarm deadline instead of restarting or losing expiry',()=>{
 const f=audibleFixture();render(f.notice);f.advance(100000);f.notice.cleanup();f.advance(200001);assert.equal(f.jobs.size,0);render(f.notice);f.advance(0);assert.equal(f.element.open,false);assert.equal(f.elapsed,1);assert.equal(f.jobs.size,0);assert.equal(f.notice.completions.get('one').started,1000);assert.equal(f.notice.completions.get('one').exhausted,true);
});
