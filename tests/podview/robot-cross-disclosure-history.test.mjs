import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderRobotHistory} from '../../podvoice/gatekeeper/static/podview/live-home-view.js';

const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8');
const begin=source.indexOf(' renderLightScenes(light){'),end=source.indexOf('\n renderLightAdjustments(',begin);
assert.ok(begin>=0&&end>begin);
const renderLightScenes=new Function('lightSelection',`return ({${source.slice(begin,end)}}).renderLightScenes`)(()=>null);

test('leaving light hides its lamps disclosure; a sceneless light retains ownership of it',()=>{
 const host={live:true,renderLightStatus(){},lightScenes:{hidden:false},lightLampDisclosure:{hidden:false},lightSceneStatus:{hidden:true}};
 renderLightScenes.call(host,null);
 assert.equal(host.lightScenes.hidden,true);
 assert.equal(host.lightLampDisclosure.hidden,true,'a light control must not leak into Robot');
 host.lightLampDisclosure.hidden=false;
 renderLightScenes.call(host,{kind:'light',lightScenes:[]});
 assert.equal(host.lightLampDisclosure.hidden,false,'renderLightScenes must not hide actual sceneless-light lamps');
});

test('robot history has one heading and preserves fresh, stale and empty meanings',()=>{
 const title={textContent:'Seneste hændelser'},section={hidden:false},timeline={hidden:false,closest:()=>section,addEventListener(){}};
 const root={querySelector:()=>null},oldDocument=globalThis.document;
 globalThis.document={getElementById:id=>({'device-history-title':title,'device-timeline':timeline,'device-view':root}[id]||null)};
 try {
  const now=Date.now()/1000,device={id:'vacuum',kind:'vacuum',live:true,source:'home_assistant_state',status:'docked',stale:false,history:{status:'observed',items:[{id:'a',recordedAt:now,outcome:'accepted_by_ha',recipe:{areaIds:[]}}]},telemetry:{status:'observed',items:[]}};
  const host={liveSnapshot:{bootId:'boot',roomId:'room',capabilities:{homeRead:['vacuum']}},state:{focus:'vacuum',devices:[device],homeScope:JSON.stringify(['boot','room']),connected:true},liveControls:{allowed:()=>false}};
  renderRobotHistory(host);assert.equal(title.textContent,'Seneste hændelser');assert.equal(timeline.data.stateText,'');assert.equal(timeline.data.items.length,1);
  device.stale=true;renderRobotHistory(host);assert.equal(title.textContent,'Sidst kendte hændelser');assert.equal(timeline.data.stateText,'');assert.equal(timeline.data.items.length,1);
  device.stale=false;device.history.items=[];renderRobotHistory(host);assert.equal(title.textContent,'Seneste hændelser');assert.equal(timeline.data.stateText,'Ingen hændelser at vise endnu.');
 } finally {globalThis.document=oldDocument;}
});
