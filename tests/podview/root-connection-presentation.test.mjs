// The host's connection notice, retry and topbar labels moved to podview/src/shell/connection.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionPresentation} from '../../podview/podvoice-view.js';
test('first connection never claims retained data and denied access gives HA guidance',()=>{
 assert.match(connectionPresentation({status:'connecting'}).text,/Forbinder/);assert.equal(connectionPresentation({status:'connecting'}).retry,false);
 const first=connectionPresentation({status:'disconnected'});assert.match(first.text,/endnu/);assert.doesNotMatch(first.text,/seneste/);assert.equal(first.retry,true);
 assert.match(connectionPresentation({status:'disconnected',snapshot:{}}).text,/seneste/);
 const denied=connectionPresentation({status:'disconnected',blocked:true});assert.equal(denied.state,'denied');assert.match(denied.text,/Home Assistant.*login/);
});
test('empty screen capability set differs from no household devices, unknown capability sets stay unasserted',()=>{
 const snapshot={capabilities:{homeRead:[],musicRead:[],timerActions:[],answerRead:false}};
 assert.equal(connectionPresentation({status:'connected',snapshot}).state,'empty');assert.doesNotMatch(connectionPresentation({status:'connected',snapshot}).text,/ingen enheder/i);
 for(const capabilities of [{...snapshot.capabilities,homeRead:['vacuum']},{...snapshot.capabilities,musicRead:['mood']},{...snapshot.capabilities,answerRead:true},{...snapshot.capabilities,timerActions:['timer.start']},{}])assert.equal(connectionPresentation({status:'connected',snapshot:{capabilities}}).text,'');
});

test('first-run library previews have no playing fixture, weather data, device or answer claims',async()=>{
 const {previewScene,firstRunPreviewStates}=await import('../../podview/preview-scenes.js');
 for(const stage of firstRunPreviewStates){const state=previewScene(stage);assert.equal(state.focus,'now');assert.equal(state.connected,false);assert.equal(state.music.playback.active,false);assert.equal(state.music.playback.playing,false);assert.equal(state.weatherPreview,'empty');assert.deepEqual(state.devices,[]);assert.deepEqual(state.answers,[]);assert.equal(state.timer,null);assert.ok(connectionPresentation(state.connectionPreview).text);}
});

test('browser offline takes precedence in the one connection notice without offering an unusable retry',()=>{for(const status of ['connected','connecting','disconnected']){const model=connectionPresentation({status,blocked:true,browserOffline:true,snapshot:{}});assert.equal(model.state,'offline');assert.match(model.text,/Ingen netværksforbindelse/);assert.equal(model.retry,false);}assert.equal(connectionPresentation({status:'connected',browserOffline:false}).text,'');});








