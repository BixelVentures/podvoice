import test from 'node:test';
import assert from 'node:assert/strict';
import {previewScene,previewStates} from '../../podvoice/gatekeeper/static/podview/preview-scenes.js';
import {sceneTransition,deviceActions} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
test('state previews retain resources independently of answer and connection status',()=>{
 for(const name of ['waiting','partial','ready','empty','error','offline','connecting','ended']){
  const s=previewScene(name);assert.equal(s.timer.status,'running',name);assert.equal(s.timer.remaining,60,name);assert.equal(s.music.playback.track,0,name);
 }
 const offline=previewScene('offline');assert.equal(offline.connected,false);assert.equal(offline.music.pending,null);
 assert.equal(previewScene('ended').pendingAnswer,null);
});
test('preview states distinguish unknown device result, completed timer and no activities',()=>{
 assert.equal(new Set(previewStates).size,previewStates.length);
 const unknown=previewScene('unknown');assert.equal(unknown.devices[0].status,'unknown');assert.deepEqual(deviceActions(unknown.devices[0]),[]);
 assert.equal(previewScene('complete').timer.status,'done');assert.equal(previewScene('nothing').timer,null);
 const rest=previewScene('rest');assert.equal(rest.focus,'photo');const active=sceneTransition(rest,{type:'show',id:'music'});assert.equal(active.music,rest.music);
});

test('stacked scenes preserve timer and devices when opening a detail',()=>{
 for(const name of ['stack','music-stack']){const s=previewScene(name);assert.equal(s.devices.length,2);assert.equal(s.timer.status,'running');const detail=sceneTransition(s,{type:'show',id:'demo-light'});assert.equal(detail.music,s.music);assert.equal(detail.timer,s.timer);assert.equal(detail.devices,s.devices);}
});
test('device detail returns one actual step without stopping resources',()=>{
 const s=previewScene('music-stack');const detail=sceneTransition(s,{type:'show',id:'demo-vacuum'});assert.equal(detail.detailOrigin,'music');const next=sceneTransition(detail,{type:'show',id:'demo-light'});assert.equal(next.detailOrigin,'music');const back=sceneTransition(next,{type:'device-back'});assert.equal(back.focus,'demo-vacuum');assert.equal(sceneTransition(back,{type:'back'}).focus,'music');assert.equal(back.music,s.music);assert.equal(back.timer,s.timer);assert.equal(back.devices,s.devices);
});

test('weather detail returns to the same task and keeps its resources',()=>{let s=previewScene('music-stack');const music=s.music,timer=s.timer;s=sceneTransition(s,{type:'show',id:'weather'});assert.equal(s.focus,'weather');s=sceneTransition(s,{type:'device-back'});assert.equal(s.focus,'music');assert.deepEqual(s.music,music);assert.deepEqual(s.timer,timer);});

test('the music entry keeps household fixtures when navigating to overview and rest',()=>{
 const s=previewScene('top');assert.deepEqual(s.devices.map(d=>d.kind),['vacuum','light']);
 const now=sceneTransition(s,{type:'show',id:'now'}),rest=sceneTransition(now,{type:'show',id:'photo'});
 assert.equal(now.devices,s.devices);assert.equal(rest.devices,s.devices);assert.equal(rest.music,s.music);
});
