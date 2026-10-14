import test from 'node:test';import assert from 'node:assert/strict';
import {initialScene} from '../../podvoice/gatekeeper/static/podview/scene-model.js';import {liveScene,liveLocalEvent} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
test('live snapshots remove fixture resources and never grant mutation',()=>{const s=liveScene(initialScene(),{voice:{sessionId:'real'},timers:{status:'observed',items:[{id:'actual',name:'Pasta',secondsLeft:9,status:'running'}]}});assert.equal(s.timer.id,'actual');assert.equal(s.connected,false);assert.equal(s.music.playback.active,false);assert.equal(s.devices.length,1);assert.equal(s.devices[0].id,'podvoice-light-unconfigured');assert.equal(s.devices[0].status,'unavailable');assert.equal(s.devices[0].pending,null);assert.deepEqual(s.devices[0].timeline,[]);assert.deepEqual(s.answers,[]);assert.equal(liveLocalEvent({type:'timer-start'}),false);assert.equal(liveLocalEvent({type:'device-action'}),false);assert.equal(liveLocalEvent({type:'show',id:'weather'}),false);assert.equal(liveLocalEvent({type:'show',id:'timers'}),true);});
test('unavailable authoritative timers do not become an invented empty observation',()=>{const s=liveScene(initialScene(),{voice:{},timers:{status:'unavailable',items:[{id:'old',name:'Old',secondsLeft:10,status:'running'}]}});assert.equal(s.timer,null);});
import {liveTimerRequest} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
test('paired timer controls use only announced capability and exact native IDs',()=>{const s={timers:{status:'observed',items:[{id:'native'}]},capabilities:{timerActions:['timer.start','timer.cancel']}};const start={type:'timer-start',seconds:60,name:'Pasta'};assert.deepEqual(liveTimerRequest(s,true,start),{action:'timer.start',args:{seconds:60,name:'Pasta'}});assert.equal(liveTimerRequest(s,false,start),null);assert.equal(liveTimerRequest({...s,capabilities:{timerActions:[]}},true,start),null);assert.equal(liveTimerRequest(s,true,{...start,seconds:1.5}),null);assert.equal(liveTimerRequest(s,true,{type:'timer',id:'another',action:'cancel'}),null);assert.deepEqual(liveTimerRequest(s,true,{type:'timer',id:'native',action:'cancel'}),{action:'timer.cancel',args:{timer_id:'native'}});});

import {voiceStatus} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
test('idle does not claim physical readiness and real owner phases have truthful labels',()=>{
 assert.equal(voiceStatus('IDLE'),'Ingen aktiv samtale');
 assert.equal(voiceStatus('AI_SPEAKING'),'Svarer…');
 assert.notEqual(voiceStatus('LOUNGE_WINDOW'),'Forbundet');
 assert.notEqual(voiceStatus('CLOSING'),'Forbundet');
});
test('paused native timer stays paused without inventing a countdown or pause capability',()=>{
 const scene=liveScene(initialScene(),{voice:{},timers:{status:'observed',items:[{id:'paused-native',name:'Pasta',secondsLeft:42,status:'paused'}]}});
 assert.equal(scene.timer.status,'paused');assert.equal(scene.timer.remaining,42);assert.equal(scene.timer.deadline,null);
});
import {readFileSync} from 'node:fs';
test('packaged live HTML fails closed before JavaScript starts',()=>{
 const html=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/index.html',import.meta.url),'utf8');
 for(const id of ['music-response','music-refinements','header-weather'])assert.match(html,new RegExp('id="'+id+'" hidden'));
 assert.match(html,/<aside class="player" hidden/);
 assert.match(html,/<p id="connection-note" class="connection-note" role="status">Forbinder til PodVoice…<\/p>/);
});
