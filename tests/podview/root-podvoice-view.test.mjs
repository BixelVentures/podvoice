import test from 'node:test';import assert from 'node:assert/strict';
import {initialScene} from '../../podvoice/gatekeeper/static/podview/scene-model.js';import {liveScene,liveLocalEvent} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
test('live light entry is whole-house and unconnected even if a snapshot supplies unadmitted light metadata',()=>{const s=liveScene(initialScene(),{voice:{},timers:{status:'observed',items:[]},capabilities:{homeRead:['light'],controlSetup:['light']},lights:{status:'observed',items:[{entityId:'light.kitchen',state:'on'}]}});const d=s.devices[0];assert.equal(d.name,'Lys');assert.equal(d.scope,'home');assert.equal(d.id,'podvoice-light-unconfigured');assert.equal(d.status,'unavailable');assert.equal(d.pending,null);assert.deepEqual(d.timeline,[]);assert.equal(liveLocalEvent({type:'device-action',action:'turn_on'},s),false);});
test('live snapshots remove fixture resources and never grant mutation',()=>{const s=liveScene(initialScene(),{voice:{sessionId:'real'},timers:{status:'observed',items:[{id:'actual',name:'Pasta',secondsLeft:9,status:'running'}]}});assert.equal(s.timer.id,'actual');assert.equal(s.connected,false);assert.equal(s.music.playback.active,false);assert.equal(s.devices.length,1);assert.equal(s.devices[0].status,'unavailable');assert.equal(s.devices[0].kind,'light');assert.deepEqual(s.answers,[]);assert.equal(liveLocalEvent({type:'timer-start'}),false);assert.equal(liveLocalEvent({type:'device-action'}),false);assert.equal(liveLocalEvent({type:'show',id:'weather'}),false);assert.equal(liveLocalEvent({type:'show',id:'timers'}),true);});
test('unavailable authoritative timers do not become an invented empty observation',()=>{const s=liveScene(initialScene(),{voice:{},timers:{status:'unavailable',items:[{id:'old',name:'Old',secondsLeft:10,status:'running'}]}});assert.equal(s.timer,null);});
import {liveTimerRequest} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
test('paired timer controls use only announced capability and exact native IDs',()=>{
 const s={timers:{status:'observed',items:[{id:'native'}]},capabilities:{timerActions:['timer.start','timer.cancel']}};
 const empty={...s,timers:{status:'observed',items:[]}};
 const start={type:'timer-start',seconds:60,name:'Pasta'};
 assert.deepEqual(liveTimerRequest(empty,true,start),{action:'timer.start',args:{seconds:60,name:'Pasta'}});
 assert.deepEqual(liveTimerRequest(empty,true,{...start,name:''}),{action:'timer.start',args:{seconds:60,name:''}});
 assert.equal(liveTimerRequest(s,true,start),null);
 assert.equal(liveTimerRequest(empty,false,start),null);
 assert.equal(liveTimerRequest({...empty,capabilities:{timerActions:[]}},true,start),null);
 assert.equal(liveTimerRequest(empty,true,{...start,seconds:1.5}),null);
 assert.equal(liveTimerRequest(s,true,{type:'timer',id:'another',action:'cancel'}),null);
 assert.deepEqual(liveTimerRequest(s,true,{type:'timer',id:'native',action:'cancel'}),{action:'timer.cancel',args:{timer_id:'native'}});
});

test('unconfigured light remains visible without enabling a command or inventing HA state',()=>{const s=liveScene(initialScene(),{voice:{},timers:{status:'observed',items:[]}});assert.equal(s.devices[0].hidden,false);assert.equal(liveLocalEvent({type:'show',id:s.devices[0].id}),true);assert.equal(liveLocalEvent({type:'device-action',action:'turn_on'}),false);});

test('unavailable timer snapshots retain observed values as stale and disable mutations',()=>{const base={...initialScene(),timer:{id:'native',remaining:12,status:'running'},extraTimers:[]};const snap={voice:{},timers:{status:'unavailable',items:[]},capabilities:{timerActions:['timer.cancel']}};const state=liveScene(base,snap);assert.equal(state.timer.remaining,12);assert.equal(state.timer.stale,true);assert.equal(liveTimerRequest(snap,true,{type:'timer',id:'native',action:'cancel'}),null);});

test('withdrawn home read permission removes retained robot data and leaves its detail',()=>{const base={...initialScene(),focus:'vacuum.actual',devices:[{id:'vacuum.actual',source:'home_assistant_state',status:'cleaning'}]};const snap={voice:{},timers:{status:'observed',items:[]},capabilities:{homeRead:[]}};const state=liveScene(base,snap);assert.equal(state.focus,'now');assert.equal(state.devices.some(d=>d.id==='vacuum.actual'),false);});

import {liveTimerHistory} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
test('native recent settings remain original newest-first drafts, never commands',()=>{const rows=[{id:'old',name:'Pasta',seconds:600,acceptedAt:100},{id:'new',name:'Te',seconds:300,acceptedAt:200}];const v={status:'observed',scope:'core_lifetime',items:rows};assert.equal(liveTimerHistory(v,300000)[0].name,'Te');assert.equal(liveTimerHistory(v,300000)[1].seconds,600);assert.equal(liveTimerHistory({...v,scope:'browser'},300000).length,0);assert.equal(liveTimerHistory({...v,items:[rows[0],rows[0]]},300000).length,0);assert.equal(liveTimerHistory({status:'unavailable',scope:'core_lifetime',items:rows},300000).length,0);});

test('live timer dial duration comes only from matching native accepted history',()=>{const snap={voice:{},timers:{status:'observed',items:[{id:'native',name:'Te',secondsLeft:40,status:'running'}]},timerHistory:{status:'observed',scope:'core_lifetime',items:[{id:'native',name:'Te',seconds:60,acceptedAt:100}]}};assert.equal(liveScene(initialScene(),snap).timer.duration,60);assert.equal(liveScene(initialScene(),{...snap,timerHistory:{...snap.timerHistory,items:[{...snap.timerHistory.items[0],id:'other'}]}}).timer.duration,null);assert.equal(liveScene(initialScene(),{...snap,timerHistory:{...snap.timerHistory,items:[{...snap.timerHistory.items[0],seconds:10}]}}).timer.duration,null);assert.equal(liveScene(initialScene(),{...snap,timerHistory:{...snap.timerHistory,status:'unavailable'}}).timer.duration,null);});

test('finished owner status overrides stale one-second countdown without mutating its snapshot',()=>{
 const snap={bootId:'boot-a',voice:{},timers:{status:'observed',items:[{id:'native',name:'Te',secondsLeft:1,status:'finished'}]}};
 const scene=liveScene(initialScene(),snap);assert.equal(scene.timer.remaining,0);assert.equal(scene.timer.status,'done');assert.equal(snap.timers.items[0].secondsLeft,1);
 const dismissed={...scene,timer:{...scene.timer,noticeDismissed:true}};
 assert.equal(liveScene(dismissed,snap).timer.noticeDismissed,true);
 assert.equal(liveScene(dismissed,{...snap,bootId:'boot-b'}).timer.noticeDismissed,undefined);
});

test('interleaved real home reads and live snapshots keep vacuum then light without priority jumps',async()=>{const {applyHome}=await import('../../podvoice/gatekeeper/static/podview/home-model.js');const snapshot={voice:{sessionId:null},timers:{status:'observed',items:[]},capabilities:{homeRead:['vacuum']}};let scene=liveScene(initialScene(),snapshot);const observed=state=>({revision:1,vacuum:{status:'observed',items:[{entityId:'vacuum.actual',name:'Robot',state,source:'home_assistant_state',history:{items:[]}}]}});for(const state of ['cleaning','paused','docked']){scene=applyHome(scene,observed(state));const row=scene.devices.find(d=>d.kind==='vacuum');assert.deepEqual(scene.devices.map(d=>d.kind),['vacuum','light']);for(let i=0;i<3;i++){scene=liveScene(scene,snapshot);assert.deepEqual(scene.devices.map(d=>d.kind),['vacuum','light']);assert.equal(scene.devices[0],row);}}scene=applyHome(scene,{revision:2,vacuum:{status:'unavailable',items:[]}});scene=liveScene(scene,snapshot);assert.deepEqual(scene.devices.map(d=>d.kind),['vacuum','light']);assert.equal(scene.devices[0].stale,true);});

test('finished native delivery facts survive projection without local stop proof',()=>{
 const snap={bootId:'native-boot',voice:{},timers:{status:'observed',items:[{id:'native-id',name:'Te',secondsLeft:0,status:'finished',alertState:'started',physicalStopped:false,physicalDrained:false}]}};
 const projected=liveScene(initialScene(),snap);assert.equal(projected.timer.alertState,'started');assert.equal(projected.timer.physicalStopped,false);assert.equal(projected.timer.physicalDrained,false);
 const dismissed=liveScene({...projected,timer:{...projected.timer,noticeDismissed:true}},snap);assert.equal(dismissed.timer.physicalStopped,false);assert.equal(dismissed.timer.id,'native-id');assert.deepEqual(liveTimerRequest({...snap,capabilities:{timerActions:['timer.cancel']}},true,{type:'timer',id:'native-id',action:'cancel'}),{action:'timer.cancel',args:{timer_id:'native-id'}});
 const stopped=liveScene(projected,{...snap,timers:{...snap.timers,items:[{...snap.timers.items[0],alertState:'stopped',physicalStopped:true}]}});assert.equal(stopped.timer.physicalStopped,true);assert.equal(projected.timer.physicalStopped,false);
 const malformed=liveScene(projected,{...snap,timers:{...snap.timers,items:[{...snap.timers.items[0],physicalStopped:'true',physicalDrained:1,alertState:'invented'}]}});assert.equal(malformed.timer.physicalStopped,null);assert.equal(malformed.timer.physicalDrained,null);assert.equal(malformed.timer.alertState,null);
});


test('reconnection leaves a removed read-only empty detail instead of stranding focus on a blank route',()=>{
 for(const kind of ['light','vacuum']){const placeholder={id:`podview-${kind}-empty`,kind,status:'unavailable',live:true,presentationOnly:true,pending:null,timeline:[]},base={...initialScene(),focus:placeholder.id,devices:[placeholder]},snapshot={voice:{},timers:{status:'observed',items:[]},capabilities:{homeRead:[]}};const next=liveScene(base,snapshot);assert.equal(next.focus,'now');assert.equal(next.devices.some(device=>device.id===placeholder.id),false);assert.equal(next.devices.every(device=>!device.pending),true);}
});
