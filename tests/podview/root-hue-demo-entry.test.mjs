import test from 'node:test';
import assert from 'node:assert/strict';
import {previewScene} from '../../podvoice/gatekeeper/static/podview/preview-scenes.js';
import {sceneTransition as step,binding,lightSelection} from '../../podvoice/gatekeeper/static/podview/scene-model.js';
const now=1793088000000;
const light=s=>s.devices.find(device=>device.kind==='light');

test('normal demo entry opens the canonical kitchen scene controls rather than a scene-less legacy light',()=>{
 const canonical=light(previewScene('hue-kitchen',now));
 for(const stage of ['rest','now','music','timers','weather','night','stack','music-stack','visual-history','conversation-overview','conversation-complete']){
  const state=previewScene(stage,now),device=light(state);assert.ok(device,stage);
  for(const key of ['lights','lightScenes','lightSceneSelections','ownRoomId','lightSelectionId'])assert.deepEqual(device[key],canonical[key],`${stage}: canonical ${key}`);
  const opened=step(state,{type:'show',id:device.id});assert.equal(opened.focus,device.id);assert.equal(lightSelection(light(opened)).roomId,'kitchen');assert.equal(light(opened).lightScenes.length,6);
 }
});

test('normal light entry supports scene recall, manual override and relative room dimming without disturbing other activities',()=>{
 let s=previewScene('rest',now);s=step(s,{type:'show',id:light(s).id});
 const music=s.music,robots=s.devices.filter(device=>device.kind!=='light'),d=light(s);
 s=step(s,{type:'light-scene-select',...binding(s,d),optionId:'example-kitchen-2'});
 assert.deepEqual(light(s).lights.filter(lamp=>lamp.roomId==='kitchen').map(lamp=>lamp.brightness),[100,100]);
 let current=light(s);s=step(s,{type:'light-brightness',...binding(s,current),optionId:'hue-kitchen-1',value:50});
 assert.equal(light(s).lightSceneSelections.kitchen,undefined,'manual lamp change clears scene selection');
 current=light(s);s=step(s,{type:'light-room-level',...binding(s,current),roomId:'kitchen',optionId:null,value:50});
 assert.deepEqual(light(s).lights.filter(lamp=>lamp.roomId==='kitchen').map(lamp=>lamp.brightness),[25,50]);
 assert.equal(s.music,music);assert.deepEqual(s.devices.filter(device=>device.kind!=='light'),robots);
});

test('demo scene data does not erase unavailable or offline admission or create provider authority',()=>{
 const rest=previewScene('rest',now),conversation=previewScene('conversation-overview',now),offline=previewScene('conversation-offline',now);
 assert.equal(rest.connected,true);assert.equal(light(rest).exampleOnly,true);assert.notEqual(light(rest).live,true);
 assert.equal(light(conversation).status,'unavailable');assert.equal(conversation.focus,'now');
 assert.equal(offline.connected,false);assert.ok(!light(offline).lightObservation);assert.ok(!light(offline).lightScope);
 const d=light(offline),opened=step(offline,{type:'show',id:d.id});
 assert.equal(step(opened,{type:'light-scene-select',...binding(opened,d),optionId:'example-kitchen-2'}),opened,'offline demo cannot execute scene');
});

test('explicit light library and source-shaped fixtures keep their own authored status and membership',()=>{
 for(const status of ['on','off','mixed','unknown','fault','unavailable']){
  const d=light(previewScene(`light-detail-${status}`,now));assert.equal(d.lights.length,4);assert.equal(d.lightScenes,undefined);assert.equal(d.status,status);
 }
 const source=light(previewScene('hue-live-shaped',now));assert.ok(source.lightObservation);assert.equal(source.lightScope.areaId,'example_kitchen');assert.notEqual(source.ownRoomId,'kitchen');
 const names=new Set(light(previewScene('hue-many-rooms',now)).lights.map(lamp=>lamp.roomId));assert.equal(names.size,30);
});
