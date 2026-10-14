import test from 'node:test';
import assert from 'node:assert/strict';
import {TimerNotice} from '../../podvoice/gatekeeper/static/podview/timer-notice.js';
import {timerTransition} from '../../podvoice/gatekeeper/static/podview/timer-model.js';

class FakeElement {
 constructor(){this.hidden=true;this.dataset={};this.listeners=new Map();this.textContent='';this.children=new Map();}
 querySelector(selector){if(!this.children.has(selector))this.children.set(selector,new FakeElement());return this.children.get(selector);}
 addEventListener(type,fn){this.listeners.set(type,fn);}
 removeEventListener(type,fn){if(this.listeners.get(type)===fn)this.listeners.delete(type);}
 removeAttribute(){}
}
function setup(){
 const jobs=new Map(),all=new Map(),dispatched=[];let serial=0;
 const setTimer=(fn,ms)=>{const id=++serial;jobs.set(id,{fn,ms});all.set(id,fn);return id;};
 const clearTimer=id=>jobs.delete(id);
 const element=new FakeElement();const host={dispatch:event=>dispatched.push(event),focusHeading(){}};
 const notice=new TimerNotice(host,element,{setTimer,clearTimer,noticeMs:7000});
 return {notice,element,jobs,all,dispatched};
}

test('timer notice expires by its own ID and cannot dismiss a newer finished timer',()=>{
 const {notice,element,jobs,all,dispatched}=setup();
 notice.render({id:'old',name:'Ovn',status:'done',noticeDismissed:false},'music',true,false);
 const oldExpiry=[...jobs.keys()][0],oldCallback=all.get(oldExpiry);
 notice.render({id:'new',name:'Pasta',status:'done',noticeDismissed:false},'music',true,false);
 oldCallback();
 assert.deepEqual(dispatched,[]);
 assert.equal(element.dataset.timerId,'new');
 const currentExpiry=[...jobs.keys()][0];jobs.get(currentExpiry).fn();
 assert.deepEqual(dispatched,[{type:'timer-notice-dismiss',id:'new'}]);
 assert.equal(element.hidden,true);
 const state={timer:{id:'new',status:'done',remaining:0},extraTimers:[{id:'other',status:'running',remaining:10}]};
 const afterNotice=timerTransition(state,dispatched[0]);
 assert.equal(afterNotice.timer.status,'done');
 assert.equal(afterNotice.extraTimers[0].status,'running');
 assert.equal(afterNotice.timer.noticeDismissed,true);
});

test('timer notice waits behind music feedback and cleanup cancels every owned timeout',()=>{
 const {notice,element,jobs}=setup();
 notice.render({id:'done',name:'Te',status:'done',noticeDismissed:false},'music',false,true);
 assert.equal(element.hidden,true);
 assert.equal([...jobs.values()][0].ms,350);
 notice.cleanup();
 assert.equal(jobs.size,0);
 assert.equal(element.listeners.size,0);
});

test('horizontal swipe dismisses only the toast and leaves the owner timer untouched',()=>{
 const {notice,element,dispatched}=setup();
 notice.render({id:'owner-timer',name:'Pasta',status:'done',noticeDismissed:false},'music',true,false);
 element.listeners.get('pointerdown')({isPrimary:true,pointerId:1,clientX:120,clientY:20});
 element.listeners.get('pointerup')({pointerId:1,clientX:55,clientY:22});
 assert.deepEqual(dispatched,[{type:'timer-notice-dismiss',id:'owner-timer'}]);
 assert.equal(element.hidden,true);
});

test('notice suppression matches the exact finished ID on a visible timer surface',()=>{
 const {notice,element,jobs}=setup();
 notice.render({id:'shown',status:'done',noticeDismissed:false},'photo',true,false,'shown');
 assert.equal(element.hidden,true);
 assert.equal(jobs.size,0);
 notice.render({id:'other',status:'done',noticeDismissed:false},'photo',true,false,'shown');
 assert.equal(element.hidden,false);
 assert.equal(element.dataset.timerId,'other');
 assert.equal([...jobs.values()][0].ms,7000);
});
