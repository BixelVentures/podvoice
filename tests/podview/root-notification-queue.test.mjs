import test from 'node:test';
import assert from 'node:assert/strict';
import {NotificationQueue} from '../../podvoice/gatekeeper/static/podview/ui/notification-queue.js';
function setup(){let serial=0;const timers=new Map(),renders=[];const queue=new NotificationQueue(item=>renders.push(item),{setTimer(callback,delay){const id=++serial;timers.set(id,{callback,delay});return id;},clearTimer:id=>timers.delete(id)});const expire=()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);timer.callback();};return{queue,timers,renders,expire};}
test('one notification surface queues independent outcomes and never restarts an unchanged event',()=>{const {queue,timers,renders,expire}=setup();queue.update('action','Modtaget');queue.update('action','Modtaget');assert.equal(timers.size,1);assert.equal(renders.length,1);assert.equal([...timers.values()][0].delay,6000);queue.update('journey','Musikken spiller');assert.equal(renders.length,1);expire();assert.equal(renders.at(-1).source,'journey');expire();assert.equal(renders.at(-1),null);queue.update('journey','Musikken spiller');assert.equal(timers.size,0);});
test('offline preempts a toast while retaining its outcome and resolves without replaying',()=>{const {queue,renders,expire}=setup();queue.update('action','Udfald ukendt');queue.update('connection','Offline',{priority:true,retry:true});assert.equal(renders.at(-1).source,'connection');assert.equal(renders.at(-1).retry,true);queue.update('connection','');assert.equal(renders.at(-1).message,'Udfald ukendt');expire();assert.equal(renders.at(-1),null);});
test('source replacement discards obsolete queued messages and cleanup cancels timers',()=>{const {queue,renders,timers,expire}=setup();queue.update('action','Første');queue.update('wake','Opdaterer');queue.update('wake','');queue.update('action','Næste',{pending:true});assert.equal(timers.size,1);expire();assert.equal(renders.at(-1),null);queue.update('connection','Ingen forbindelse');queue.cleanup();assert.equal(timers.size,0);assert.equal(renders.at(-1),null);});

test('default scheduler preserves the browser Window receiver for native timers',()=>{
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,calls=[];
 globalThis.setTimeout=function(callback,delay){assert.equal(this,globalThis);calls.push(['set',delay]);return 71;};globalThis.clearTimeout=function(id){assert.equal(this,globalThis);calls.push(['clear',id]);};
 try{const queue=new NotificationQueue(()=>{});queue.update('connection','Forbinder');queue.cleanup();assert.deepEqual(calls,[['set',6000],['clear',71]]);}finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});

test('dismiss removes only the current notice, retains queued sources and never re-adds unchanged updates',()=>{
 const {queue,timers,renders}=setup();queue.update('connection','Ikke forbundet',{retry:true});const first=queue.current;queue.update('journey','Musikken spiller');queue.update('wake','Opdateret');assert.equal(queue.dismiss(first),true);assert.equal(queue.current.source,'journey');assert.equal(queue.pending[0].source,'wake');assert.equal(timers.size,1);queue.update('connection','Ikke forbundet',{retry:true,priority:true});assert.equal(queue.current.source,'journey');assert.equal(queue.dismiss(first),false);assert.equal(queue.dismiss(),true);assert.equal(queue.current.source,'wake');queue.dismiss();assert.equal(renders.at(-1),null);queue.update('wake','Opdateret');assert.equal(timers.size,0);
});

test('stale timer callbacks cannot dismiss a priority notice or its later resumed outcome',()=>{
 const {queue,timers}=setup();queue.update('action','Modtaget');const oldClock=[...timers.values()][0].callback;queue.update('connection','Ikke forbundet',{priority:true});oldClock();assert.equal(queue.current.source,'connection');queue.dismiss();assert.equal(queue.current.source,'action');oldClock();assert.equal(queue.current.source,'action');const currentClock=[...timers.values()][0].callback;queue.cleanup();currentClock();assert.equal(queue.current,null);assert.equal(timers.size,0);
});
