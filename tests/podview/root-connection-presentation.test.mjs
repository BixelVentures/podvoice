import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {connectionPresentation} from '../../podvoice/gatekeeper/static/podview/podvoice-view.js';
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
test('existing inline retry rereads only, blocks duplicate clicks and restores control after completion',async()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),start=source.indexOf(' renderConnectionNotice('),end=source.indexOf('\n renderLive(){',start),code=source.slice(start,end).trim();
 const note={dataset:{},hidden:true,replaceChildren(...nodes){this.children=nodes;for(const node of nodes)node.parentNode=this;}},doc={createTextNode(value){return{nodeValue:value};},createElement(){return{addEventListener(type,callback){this[type]=callback;}}}};
 const render=new Function('$','connectionPresentation','document','applyKitComponent',`return function ${code}`)(()=>note,connectionPresentation,doc,()=>{});
 let finish;const calls=[],host={live:true,liveStatus:'disconnected',isConnected:true,renderVoice(){},showFeedback(message){this.lastNotification=message;},liveTransport:{restart(...args){calls.push(args);return new Promise(resolve=>finish=resolve);}}};host.renderLive=()=>render.call(host,connectionPresentation({status:host.liveStatus,snapshot:host.liveSnapshot}));host.renderLive();host.connectionRetry.click();host.connectionRetry.click();assert.deepEqual(calls,[[false,false]]);assert.equal(host.connectionRetry.disabled,true);finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(host.connectionRetry.disabled,false);
 host.liveStatus='connected';host.liveSnapshot={capabilities:{homeRead:['vacuum']}};host.renderLive();assert.equal(host.lastNotification,'');host.connectionRetry.click();assert.equal(calls.length,1);
});

test('first-run library previews have no playing fixture, weather data, device or answer claims',async()=>{
 const {previewScene,firstRunPreviewStates}=await import('../../podvoice/gatekeeper/static/podview/preview-scenes.js');
 for(const stage of firstRunPreviewStates){const state=previewScene(stage);assert.equal(state.focus,'now');assert.equal(state.connected,false);assert.equal(state.music.playback.active,false);assert.equal(state.music.playback.playing,false);assert.equal(state.weatherPreview,'empty');assert.deepEqual(state.devices,[]);assert.deepEqual(state.answers,[]);assert.equal(state.timer,null);assert.ok(connectionPresentation(state.connectionPreview).text);}
});

test('browser offline takes precedence in the one connection notice without offering an unusable retry',()=>{for(const status of ['connected','connecting','disconnected']){const model=connectionPresentation({status,blocked:true,browserOffline:true,snapshot:{}});assert.equal(model.state,'offline');assert.match(model.text,/Ingen netværksforbindelse/);assert.equal(model.retry,false);}assert.equal(connectionPresentation({status:'connected',browserOffline:false}).text,'');});

test('connection owner marks all seven retained first-connection cards busy and clears all on resolution',()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),start=source.indexOf(' renderConnectionNotice('),end=source.indexOf('\n renderLive(){',start),code=source.slice(start,end).trim();
 const cards=new Map(['timer-card','home-weather','home-music','home-radio','home-vehicle','robot','light'].map(id=>[id,{attrs:new Map(),getAttribute(key){return this.attrs.get(key);},setAttribute(key,value){this.attrs.set(key,value);}}])),note={dataset:{},replaceChildren(...nodes){for(const node of nodes)node.parentNode=this;}},doc={createTextNode:()=>({}),createElement:()=>({addEventListener(){}})};
 const render=new Function('$','connectionPresentation','document','applyKitComponent',`return function ${code}`)(id=>cards.get(id),connectionPresentation,doc,()=>{}),host={showFeedback(message){this.lastNotification=message;},deviceRows:new Map([['robot',cards.get('robot')],['light',cards.get('light')]])};render.call(host,connectionPresentation({status:'connecting'}));assert.equal(cards.size,7);for(const card of cards.values())assert.equal(card.getAttribute('aria-busy'),'true');render.call(host,connectionPresentation({status:'connected'}));for(const card of cards.values())assert.equal(card.getAttribute('aria-busy'),'false');assert.equal(host.lastNotification,'');
});
