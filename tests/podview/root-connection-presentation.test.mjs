import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NotificationQueue} from '../../podvoice/gatekeeper/static/podview/ui/notification-queue.js';
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
 const note={dataset:{},hidden:true,replaceChildren(...nodes){this.children=nodes;for(const node of nodes)node.parentNode=this;}},doc={createTextNode(value){return{nodeValue:value};},createElement(){return{disabled:false,addEventListener(type,callback){this[type]=callback;}}}};
 const render=new Function('$','connectionPresentation','document','applyKitComponent',`return function ${code}`)(()=>note,connectionPresentation,doc,()=>{});
 let finish;const calls=[],host={live:true,liveStatus:'disconnected',isConnected:true,renderVoice(){},showFeedback(message){this.lastNotification=message;},liveTransport:{restart(...args){calls.push(args);return new Promise(resolve=>finish=resolve);}}};host.renderLive=()=>render.call(host,connectionPresentation({status:host.liveStatus,snapshot:host.liveSnapshot}));host.renderLive();host.connectionRetry.click();host.connectionRetry.click();assert.deepEqual(calls,[[false,false]]);assert.notEqual(host.connectionRetry.disabled,true);finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(host.connectionRetry.disabled,false);
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

test('conversation reconnecting and disconnected project distinct persistent labels through the actual topbar without restoring control',async()=>{
 const {previewScene}=await import('../../podvoice/gatekeeper/static/podview/preview-scenes.js'),source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),start=source.indexOf(' renderTopbarClock('),end=source.indexOf('\n renderTopbarScroll(',start),code=source.slice(start,end).trim(),nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,getAttribute:()=>null});return nodes.get(id);},nav={dataset:{}},render=new Function('$','connectionPresentation',`return function ${code}`)(node,connectionPresentation);
 for(const [stage,label,state] of [['conversation-reconnecting','Genopretter forbindelse…','connecting'],['conversation-offline','Forbindelsen er afbrudt','offline']]){
  const scene=previewScene(stage),before=JSON.stringify(scene),host={state:scene,dataset:{},querySelector:()=>nav};render.call(host,new Date('2026-10-23T10:00:00Z'));
  assert.equal(node('header-date').textContent,label);assert.equal(node('photo-date').textContent,label);assert.equal(connectionPresentation(scene.connectionPreview).state,state);assert.equal(scene.connected,false);assert.equal(JSON.stringify(scene),before);assert.equal(scene.music.pending,null);assert.ok(scene.answers.length);assert.ok(scene.timer);
 }
 const live={live:true,liveStatus:'connecting',liveSnapshot:{},state:{connected:false},dataset:{},querySelector:()=>nav};render.call(live,new Date());assert.equal(node('header-date').textContent,'Genopretter forbindelse…');live.liveStatus='disconnected';render.call(live,new Date());assert.equal(node('header-date').textContent,'Forbindelsen er afbrudt');
 live.browserOffline=true;render.call(live,new Date());assert.equal(node('header-date').textContent,'Ingen netværksforbindelse');assert.equal(node('photo-date').textContent,'Ingen netværksforbindelse');live.browserOffline=false;live.liveStatus='connected';render.call(live,new Date('2026-10-23T10:00:00Z'));assert.notEqual(node('photo-date').textContent,'Ingen netværksforbindelse');
});


test('persistent connection uses existing status and retry without replacing an action receipt',()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),start=source.indexOf(' renderConnectionNotice('),end=source.indexOf('\n renderLive(){',start),code=source.slice(start,end).trim(),timers=new Map(),items=[];let serial=0,focused=false;
 const nodes={network:{children:[],append(node){if(node.parentNode&&node.parentNode!==this)node.parentNode.children=node.parentNode.children.filter(x=>x!==node);this.children.push(node);node.parentNode=this;}},sheet:{open:true},summary:{focus(){focused=true;}}};const doc={activeElement:null,createElement(){return {hidden:false,addEventListener(type,fn){this[type]=fn;}}}};const q=new NotificationQueue(item=>items.push(item),{setTimer:f=>{timers.set(++serial,f);return serial;},clearTimer:id=>timers.delete(id)});
 const lookup=id=>({'screen-device-network':nodes.network,'quick-sheet':nodes.sheet,'screen-device-more-summary':nodes.summary})[id];const render=new Function('$','document','applyKitComponent',`return function ${code}`)(lookup,doc,()=>{}),host={ownerDocument:doc,state:{},showFeedback:(message,pending,options)=>q.update(options.source,message,{pending,...options})};
 q.update('action','Handling modtaget');render.call(host,connectionPresentation({status:'disconnected',snapshot:{}}));assert.equal(q.current.source,'action');assert.equal(nodes.network.children.at(-1),host.connectionRetry);assert.equal(host.connectionRetry.hidden,false);doc.activeElement=host.connectionRetry;render.call(host,connectionPresentation({status:'connected',snapshot:{capabilities:{homeRead:['vacuum']}}}));assert.equal(host.connectionRetry.hidden,true);assert.equal(focused,true);assert.equal(q.current.source,'action');q.dismiss();assert.equal(q.current,null);
 render.call(host,connectionPresentation({status:'connected',snapshot:{capabilities:{homeRead:[],musicRead:[],timerActions:[],answerRead:false}}}));assert.equal(q.current.source,'connection');assert.match(q.current.message,/Intet indhold/);q.cleanup();
});


test('identical connection clock renders never rewrite status or description attributes',()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),start=source.indexOf(' renderTopbarClock('),end=source.indexOf('\n renderTopbarScroll(',start),nodes=new Map();let writes=0;
 const node=id=>{if(!nodes.has(id)){const attrs=new Map();nodes.set(id,{textContent:'',hidden:false,getAttribute:key=>attrs.get(key)??null,setAttribute(key,value){writes++;attrs.set(key,value);},removeAttribute(key){writes++;attrs.delete(key);}});}return nodes.get(id);};const nav={dataset:{}},render=new Function('$','connectionPresentation',`return function ${source.slice(start,end).trim()}`)(node,connectionPresentation),host={live:true,liveStatus:'disconnected',liveSnapshot:{},state:{},dataset:{},querySelector:()=>nav},time=new Date('2026-10-23T10:00:00Z');
 render.call(host,time);assert.ok(writes>0);writes=0;render.call(host,time);assert.equal(writes,0);host.liveStatus='connected';host.liveSnapshot={capabilities:{homeRead:['vacuum']}};render.call(host,time);writes=0;render.call(host,time);assert.equal(writes,0);
});


test('retry remains visible, busy and focused during connecting, then hides safely on recovery',()=>{
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js',import.meta.url),'utf8'),start=source.indexOf(' renderConnectionNotice('),end=source.indexOf('\n renderLive(){',start);let focused=false,writes=0;const attrs=new Map(),button={hidden:false,disabled:false,getAttribute:key=>attrs.get(key)??null,setAttribute(key,value){writes++;attrs.set(key,value);},addEventListener(){}};const nodes={network:{append(node){node.parentNode=this;}},sheet:{open:true},summary:{focus(){focused=true;}}},doc={activeElement:button},lookup=id=>({'screen-device-network':nodes.network,'quick-sheet':nodes.sheet,'screen-device-more-summary':nodes.summary})[id],render=new Function('$','document','applyKitComponent',`return function ${source.slice(start,end).trim()}`)(lookup,doc,()=>{}),host={ownerDocument:doc,connectionRetry:button,connectionRetryPending:true,showFeedback(){}};
 render.call(host,connectionPresentation({status:'connecting',snapshot:{}}));assert.equal(button.hidden,false);assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-disabled'),'true');assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(focused,false);writes=0;render.call(host,connectionPresentation({status:'connecting',snapshot:{}}));assert.equal(writes,0);host.connectionRetryPending=false;render.call(host,connectionPresentation({status:'connected',snapshot:{capabilities:{homeRead:['vacuum']}}}));assert.equal(button.hidden,true);assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-disabled'),'false');assert.equal(button.getAttribute('aria-busy'),'false');assert.equal(focused,true);
});
